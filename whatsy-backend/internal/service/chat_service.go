// Package service contains application-level chat workflows.
package service

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/whatsy/backend/internal/domain"
	"github.com/whatsy/backend/internal/eventlog"
	"github.com/whatsy/backend/internal/repository"
	"github.com/whatsy/backend/internal/websocket"
	"github.com/whatsy/backend/internal/zernio"
)

// ZernioSender is the subset of the Zernio client used by ChatService.
type ZernioSender interface {
	SendMessage(ctx context.Context, conversationID string, payload zernio.SendMessagePayload) (*zernio.SentMessage, error)
	MarkRead(ctx context.Context, conversationID, accountID string) error
}

// AutoReplier evaluates auto-reply rules for inbound messages.
type AutoReplier interface {
	CheckAndReply(ctx context.Context, message domain.Message, convID string, chatService *ChatService) (bool, error)
}

// WSBroadcaster publishes chat events to connected WebSocket clients.
type WSBroadcaster interface {
	BroadcastToRoom(studentID string, event interface{})
	BroadcastToAll(event interface{})
}

// ChatService coordinates persistence, Zernio calls, and live chat updates.
type ChatService struct {
	db                  *sql.DB
	convRepo            *repository.ConversationRepo
	msgRepo             *repository.MessageRepo
	zernioClient  ZernioSender
	hub           WSBroadcaster
	autoReplier   AutoReplier
}

func NewChatService(db *sql.DB, convRepo *repository.ConversationRepo, msgRepo *repository.MessageRepo, zernioClient ZernioSender, hub WSBroadcaster) *ChatService {
	return &ChatService{
		db:           db,
		convRepo:     convRepo,
		msgRepo:      msgRepo,
		zernioClient: zernioClient,
		hub:          hub,
	}
}

// SetAutoReplier wires the database-driven auto-reply evaluator.
func (s *ChatService) SetAutoReplier(ar AutoReplier) {
	s.autoReplier = ar
}

// zernioAccountID resolves the connected WhatsApp account id. Webhook and
// send flows need it: /read and /typing require accountId in the body, and
// outbound sends must carry the accountId of the connected account.
func (s *ChatService) zernioAccountID(ctx context.Context) string {
	var accountID string
	_ = s.db.QueryRowContext(ctx,
		`SELECT account_id FROM whatsapp_connections WHERE status='connected' AND COALESCE(account_id, '') <> '' ORDER BY id DESC LIMIT 1`,
	).Scan(&accountID)
	return accountID
}

// HandleInboundMessage persists a Zernio message and notifies active clients.
// Repeated webhook deliveries are ignored using Zernio's message identifier.
func (s *ChatService) HandleInboundMessage(ctx context.Context, payload zernio.InboundMessagePayload) error {
	// Resolve the Zernio conversation ID to our local PostgreSQL UUID.
	localConvID, err := s.convRepo.GetLocalIDByZernioID(ctx, payload.ConversationID)
	if err != nil {
		return fmt.Errorf("resolve conversation id for zernio id %q: %w", payload.ConversationID, err)
	}
	// Auto-create the conversation on-the-fly when the worker hasn't synced it yet.
	// This prevents the first message from a new contact being permanently dropped.
	if localConvID == "" {
		localConvID, err = s.autoCreateConversation(ctx, payload)
		if err != nil {
			return fmt.Errorf("inbound message: auto-create conversation for zernio id %q: %w", payload.ConversationID, err)
		}
		masked := "****"
		if len(payload.From) > 4 {
			masked = "****" + payload.From[len(payload.From)-4:]
		}
		log.Printf("[chat] auto-created conversation %s for zernio id %q (from %s)", localConvID, payload.ConversationID, masked)
	}

	// Prefer the platform message id (WhatsApp wamid): it is the same id
	// delivered on message.delivered/.read/.failed status updates.
	dedupeID := firstNonEmpty(payload.PlatformMessageID, payload.MessageID)
	if dedupeID != "" {
		existing, err := s.msgRepo.GetByZernioID(ctx, dedupeID)
		if err != nil {
			return fmt.Errorf("check inbound message duplicate: %w", err)
		}
		if existing != nil {
			return nil
		}
	}

	message := domain.Message{
		ConversationID:  localConvID,
		Direction:       payload.Direction,
		Type:            domain.ContentType(payload.Type),
		Content:         payload.Content,
		Status:          domain.StatusDelivered,
		ZernioMessageID: dedupeID,
		CreatedAt:       payload.Timestamp,
	}
	if message.Direction == "" {
		message.Direction = "inbound"
	}
	if message.Type == "" {
		message.Type = domain.ContentTypeText
	}
	// Inbound interactive tap: contact replied to a button or list row.
	if payload.InteractiveType != "" {
		message.Type = domain.ContentTypeInteractive
		message.Interactive = &domain.Interactive{
			Body: payload.Content,
			Buttons: []domain.InteractiveButton{{
				ID:    payload.InteractiveId,
				Title: payload.InteractiveTitle,
				Type:  payload.InteractiveType,
			}},
		}
	}
	if len(payload.Attachments) > 0 {
		message.Attachments = make([]domain.Attachment, len(payload.Attachments))
		for i, a := range payload.Attachments {
			t := a.Type
			if t == "" {
				t = string(message.Type)
			}
			message.Attachments[i] = domain.Attachment{URL: a.URL, Type: attachmentKind(domain.ContentType(t))}
		}
	} else if payload.MediaURL != "" {
		message.Attachments = []domain.Attachment{{URL: payload.MediaURL, Type: attachmentKind(message.Type)}}
	}

	if err := s.msgRepo.Create(ctx, &message); err != nil {
		return fmt.Errorf("create inbound message: %w", err)
	}
	eventlog.TraceStep2MessageSaved(message.Direction, message.ID, message.ConversationID)
	if message.Direction == "outbound" {
		// Message sent from WA Business app (outbound echo) — agent already saw and
		// replied, so clear unread rather than increment it.
		if err := s.convRepo.ResetUnread(ctx, message.ConversationID); err != nil {
			log.Printf("reset unread on outbound echo: %v", err)
		}
	} else {
		if err := s.convRepo.IncrementUnread(ctx, message.ConversationID); err != nil {
			return fmt.Errorf("increment conversation unread count: %w", err)
		}
	}
	if err := s.convRepo.UpdateLastMessage(ctx, message.ConversationID, message.Content, string(message.Type)); err != nil {
		return fmt.Errorf("update conversation last message: %w", err)
	}

	conversation, err := s.convRepo.GetByID(ctx, message.ConversationID)
	if err != nil {
		return fmt.Errorf("get updated conversation: %w", err)
	}
	if conversation == nil {
		return fmt.Errorf("get updated conversation: conversation %q not found", message.ConversationID)
	}

	s.hub.BroadcastToAll(websocket.NewMessageEvent{
		Event:     websocket.EventNewMessage,
		StudentID: message.ConversationID,
		Message:   message,
	})
	// Also push the updated conversation to every connected client so all
	// agents' sidebars reorder and show the new unread count without refresh.
	s.hub.BroadcastToAll(websocket.ConversationUpdatedEvent{
		Event:        websocket.EventConversationUpdated,
		Conversation: *conversation,
	})

	// Fire the database-driven auto-reply rules (best-effort).
	if s.autoReplier != nil && message.Direction == "inbound" {
		if replied, err := s.autoReplier.CheckAndReply(ctx, message, message.ConversationID, s); err != nil {
			log.Printf("auto-reply: %v", err)
		} else if replied {
			if err := s.convRepo.ResetUnread(ctx, message.ConversationID); err != nil {
				log.Printf("auto-reply: reset unread: %v", err)
			}
		}
	}
	return nil
}

// HandleMessageStatus applies a message.delivered / message.read /
// message.failed webhook to the stored message. For WhatsApp the webhook's
// platformMessageId equals the wamid returned by the send call, which we
// stored as zernio_message_id.
func (s *ChatService) HandleMessageStatus(ctx context.Context, payload zernio.MessageStatusPayload) error {
	dedupeID := firstNonEmpty(payload.PlatformMessageID, payload.MessageID)
	if dedupeID == "" {
		return nil
	}
	if err := s.msgRepo.UpdateStatusByZernioID(ctx, dedupeID, domain.DeliveryStatus(payload.Status)); err != nil {
		return fmt.Errorf("update message status: %w", err)
	}
	return nil
}

// SendOutboundMessage persists the message immediately and returns it to the
// caller, then delivers it to Zernio asynchronously. This makes the send feel
// instant in the UI — the message appears right away with status "pending" and
// flips to "sent" (or "failed") once Zernio responds.
func (s *ChatService) SendOutboundMessage(ctx context.Context, conversationID string, payload zernio.SendMessagePayload, agentID string) (*domain.Message, error) {
	if payload.AccountID == "" {
		payload.AccountID = s.zernioAccountID(ctx)
	}
	if payload.AccountID == "" {
		return nil, fmt.Errorf("send message: no connected WhatsApp account; connect a number first")
	}

	// Resolve Zernio conversation ID upfront — needed by the background goroutine.
	zernioConvID, err := s.convRepo.GetZernioIDByLocalID(ctx, conversationID)
	if err != nil {
		return nil, fmt.Errorf("resolve zernio conversation id: %w", err)
	}
	if zernioConvID == "" {
		return nil, fmt.Errorf("send message: conversation %q has no zernio_conversation_id", conversationID)
	}

	// Normalize attachment attributes according to Zernio specs: image, video, audio, file
	if payload.VoiceNote || payload.AttachmentType == "audio" || payload.AttachmentType == "voice_note" {
		payload.VoiceNote = true
		payload.AttachmentType = "audio"
	} else if payload.AttachmentType == "document" {
		payload.AttachmentType = "file"
	}

	if payload.AttachmentURL != "" {
		if payload.AttachmentType == "" {
			payload.AttachmentType = "file"
		}
		if payload.AttachmentType == "file" && payload.AttachmentName == "" {
			payload.AttachmentName = "Document"
		}
	}

	// Persist immediately with StatusPending so the message appears in the UI at once.
	message := domain.Message{
		ConversationID: conversationID,
		Direction:      "outbound",
		Type:           outboundContentType(payload),
		Content:        payload.Message,
		Status:         domain.StatusPending,
		SentByAgentID:  agentID,
	}
	if payload.AttachmentURL != "" {
		message.Attachments = []domain.Attachment{{
			URL:      payload.AttachmentURL,
			Type:     attachmentKind(domain.ContentType(payload.AttachmentType)),
			Name:     payload.AttachmentName,
			MimeType: payload.AttachmentType,
		}}
	}
	// Store outbound buttons/list so the agent's UI shows what was sent.
	if len(payload.Buttons) > 0 {
		iv := &domain.Interactive{Body: payload.Message}
		for _, b := range payload.Buttons {
			iv.Buttons = append(iv.Buttons, domain.InteractiveButton{ID: b.Payload, Title: b.Title, Type: b.Type})
		}
		message.Interactive = iv
	} else if len(payload.QuickReplies) > 0 {
		iv := &domain.Interactive{Body: payload.Message}
		for _, qr := range payload.QuickReplies {
			iv.Buttons = append(iv.Buttons, domain.InteractiveButton{ID: qr.Payload, Title: qr.Title, Type: qr.Type})
		}
		message.Interactive = iv
	} else if payload.Interactive != nil {
		iv := &domain.Interactive{}
		if payload.Interactive.Body != nil {
			iv.Body = payload.Interactive.Body.Text
		}
		if payload.Interactive.Action != nil {
			for _, sec := range payload.Interactive.Action.Sections {
				ls := domain.ListSection{Title: sec.Title}
				for _, row := range sec.Rows {
					ls.Rows = append(ls.Rows, domain.InteractiveButton{ID: row.ID, Title: row.Title})
				}
				iv.ListSections = append(iv.ListSections, ls)
			}
		}
		message.Interactive = iv
	}

	// If the agent is replying to a previous message, look it up to store the
	// quote context and resolve its WhatsApp message ID for the quoted-reply API.
	if payload.ReplyTo != "" {
		if replied, err := s.msgRepo.GetByID(ctx, payload.ReplyTo); err == nil && replied != nil {
			senderName := replied.SenderName
			if replied.Direction == "outbound" {
				senderName = "You"
			}
			message.ReplyTo = &domain.ReplyTo{
				ID:         replied.ID,
				SenderName: senderName,
				Content:    replied.Content,
			}
			// Use the platform wamid so WhatsApp renders a native quoted-reply bubble.
			payload.ReplyTo = replied.ZernioMessageID
		}
	}

	if err := s.msgRepo.Create(ctx, &message); err != nil {
		return nil, fmt.Errorf("create outbound message: %w", err)
	}
	eventlog.TraceStep2MessageSaved("outbound", message.ID, message.ConversationID)

	// Resolve agent name synchronously so the returned message has it.
	if agentID != "" && message.SenderName == "" {
		var name, avatar string
		_ = s.db.QueryRowContext(ctx, "SELECT name, avatar FROM agents WHERE id = $1", agentID).Scan(&name, &avatar)
		message.SenderName = name
		message.SenderAvatar = avatar
	}

	// Update conversation + broadcast in background so the POST returns fast.
	go func() {
		bgCtx := context.Background()
		_ = s.convRepo.UpdateLastMessage(bgCtx, conversationID, message.Content, string(message.Type))
		_ = s.convRepo.ResetUnread(bgCtx, conversationID)
		conversation, err := s.convRepo.GetByID(bgCtx, conversationID)
		if err == nil && conversation != nil {
			s.hub.BroadcastToAll(websocket.ConversationUpdatedEvent{
				Event:        websocket.EventConversationUpdated,
				Conversation: *conversation,
			})
		}
	}()

	// Broadcast the new message to other connected tabs immediately.
	s.hub.BroadcastToAll(websocket.NewMessageEvent{
		Event:     websocket.EventNewMessage,
		StudentID: conversationID,
		Message:   message,
	})

	// Deliver to Zernio in background, then push status update to frontend.
	go func() {
		start := time.Now()
		sent, err := s.zernioClient.SendMessage(context.Background(), zernioConvID, payload)
		dur := time.Since(start).Milliseconds()
		eventlog.ZernioSend(message.ID, conversationID, dur, err)
		if err != nil {
			_ = s.msgRepo.UpdateZernioIDAndStatus(context.Background(), message.ID, "", domain.StatusFailed)
			s.hub.BroadcastToAll(websocket.MessageStatusEvent{
				Event:     websocket.EventMessageStatus,
				MessageID: message.ID,
				Status:    string(domain.StatusFailed),
			})
			return
		}
		_ = s.msgRepo.UpdateZernioIDAndStatus(context.Background(), message.ID, sent.ID, domain.StatusSent)
		s.hub.BroadcastToAll(websocket.MessageStatusEvent{
			Event:     websocket.EventMessageStatus,
			MessageID: message.ID,
			Status:    string(domain.StatusSent),
		})
	}()

	return &message, nil
}

// MarkConversationRead clears local unread state, updates Zernio (blue ticks;
// no-op on coexistence numbers where the phone owns read state), and notifies
// connected clients of the new conversation state.
func (s *ChatService) MarkConversationRead(ctx context.Context, conversationID string) error {
	if err := s.convRepo.ResetUnread(ctx, conversationID); err != nil {
		return fmt.Errorf("reset conversation unread count: %w", err)
	}
	if accountID := s.zernioAccountID(ctx); accountID != "" {
		zernioConvID, err := s.convRepo.GetZernioIDByLocalID(ctx, conversationID)
		if err == nil && zernioConvID != "" {
			go func() {
				if err := s.zernioClient.MarkRead(context.Background(), zernioConvID, accountID); err != nil {
					log.Printf("mark Zernio conversation read: %v", err)
				}
			}()
		}
	}

	conversation, err := s.convRepo.GetByID(ctx, conversationID)
	if err != nil {
		return fmt.Errorf("get updated conversation: %w", err)
	}
	if conversation == nil {
		return fmt.Errorf("get updated conversation: conversation %q not found", conversationID)
	}
	s.hub.BroadcastToAll(websocket.ConversationUpdatedEvent{
		Event:        websocket.EventConversationUpdated,
		Conversation: *conversation,
	})
	return nil
}

// MarkConversationUnread flags the conversation as manually unread, sets unread_count to at least 1,
// and notifies connected clients of the updated conversation state via WebSocket.
func (s *ChatService) MarkConversationUnread(ctx context.Context, conversationID string) error {
	if err := s.convRepo.MarkUnread(ctx, conversationID); err != nil {
		return fmt.Errorf("mark conversation unread: %w", err)
	}

	conversation, err := s.convRepo.GetByID(ctx, conversationID)
	if err != nil {
		return fmt.Errorf("get updated conversation: %w", err)
	}
	if conversation == nil {
		return fmt.Errorf("get updated conversation: conversation %q not found", conversationID)
	}
	s.hub.BroadcastToAll(websocket.ConversationUpdatedEvent{
		Event:        websocket.EventConversationUpdated,
		Conversation: *conversation,
	})
	return nil
}


// RetryStuckMessages finds outbound messages stuck in "pending" (from a
// killed goroutine during deploy) and retries their Zernio delivery.
func (s *ChatService) RetryStuckMessages(ctx context.Context) {
	msgs, err := s.msgRepo.ListStuckPending(ctx, 30)
	if err != nil {
		log.Printf("[startup] retry stuck messages: %v", err)
		return
	}
	if len(msgs) == 0 {
		return
	}
	log.Printf("[startup] retrying %d stuck pending messages", len(msgs))

	accountID := s.zernioAccountID(ctx)
	for _, msg := range msgs {
		zernioConvID, err := s.convRepo.GetZernioIDByLocalID(ctx, msg.ConversationID)
		if err != nil || zernioConvID == "" {
			log.Printf("[startup] retry: skip msg %s — no zernio conv id", msg.ID)
			_ = s.msgRepo.UpdateZernioIDAndStatus(ctx, msg.ID, "", domain.StatusFailed)
			continue
		}

		payload := zernio.SendMessagePayload{
			AccountID: accountID,
			Message:   msg.Content,
		}
		if len(msg.Attachments) > 0 {
			att := msg.Attachments[0]
			payload.AttachmentURL = att.URL
			payload.AttachmentType = att.MimeType
			payload.AttachmentName = att.Name
			if msg.Type == domain.ContentTypeVoiceNote || payload.AttachmentType == "audio" || payload.AttachmentType == "voice_note" {
				payload.VoiceNote = true
				payload.AttachmentType = "audio"
			} else if payload.AttachmentType == "document" {
				payload.AttachmentType = "file"
			}
			if payload.AttachmentType == "file" && payload.AttachmentName == "" {
				payload.AttachmentName = "Document"
			}
		}

		sent, err := s.zernioClient.SendMessage(ctx, zernioConvID, payload)
		if err != nil {
			log.Printf("[startup] retry: msg %s failed: %v", msg.ID, err)
			_ = s.msgRepo.UpdateZernioIDAndStatus(ctx, msg.ID, "", domain.StatusFailed)
			s.hub.BroadcastToAll(websocket.MessageStatusEvent{
				Event:     websocket.EventMessageStatus,
				MessageID: msg.ID,
				Status:    string(domain.StatusFailed),
			})
			continue
		}
		_ = s.msgRepo.UpdateZernioIDAndStatus(ctx, msg.ID, sent.ID, domain.StatusSent)
		s.hub.BroadcastToAll(websocket.MessageStatusEvent{
			Event:     websocket.EventMessageStatus,
			MessageID: msg.ID,
			Status:    string(domain.StatusSent),
		})
		log.Printf("[startup] retry: msg %s sent ok", msg.ID)
	}
}

func outboundContentType(payload zernio.SendMessagePayload) domain.ContentType {
	if payload.VoiceNote {
		return domain.ContentTypeVoiceNote
	}
	if len(payload.Buttons) > 0 || len(payload.QuickReplies) > 0 || payload.Interactive != nil {
		return domain.ContentTypeInteractive
	}
	if payload.AttachmentType != "" {
		return domain.ContentType(payload.AttachmentType)
	}
	return domain.ContentTypeText
}

// attachmentKind maps Zernio content/attachment types to the four attachment
// kinds the frontend understands: image, audio, video, document.
func attachmentKind(t domain.ContentType) string {
	switch t {
	case domain.ContentTypeImage:
		return "image"
	case domain.ContentTypeAudio, domain.ContentTypeVoiceNote:
		return "audio"
	case domain.ContentTypeVideo:
		return "video"
	default:
		return "document"
	}
}

// autoCreateConversation creates a student + conversation row from a webhook
// payload when the worker hasn't synced the contact yet. Uses an upsert on
// phone so duplicate rows are never created for the same number.
func (s *ChatService) autoCreateConversation(ctx context.Context, payload zernio.InboundMessagePayload) (string, error) {
	phone := payload.From
	if phone == "" {
		phone = "unknown-" + payload.ConversationID
	}
	if len(phone) > 0 && phone[0] != '+' {
		phone = "+" + phone
	}

	name := payload.ParticipantName
	if name == "" {
		name = phone
	}

	var studentID string
	err := s.db.QueryRowContext(ctx,
		`INSERT INTO students (name, phone, created_at, updated_at)
		 VALUES ($1, $2, NOW(), NOW())
		 ON CONFLICT (phone) DO UPDATE
		   SET name = CASE WHEN students.name = students.phone OR students.name LIKE '+unknown-%' THEN EXCLUDED.name ELSE students.name END,
		       updated_at = NOW()
		 RETURNING id`,
		name, phone,
	).Scan(&studentID)
	if err != nil {
		return "", fmt.Errorf("upsert student: %w", err)
	}

	var convID string
	err = s.db.QueryRowContext(ctx,
		`INSERT INTO conversations
		    (student_id, platform, last_message, last_message_at, unread_count, zernio_conversation_id, created_at, updated_at)
		 VALUES ($1, 'whatsapp', '', NOW(), 0, $2, NOW(), NOW())
		 ON CONFLICT (zernio_conversation_id) DO UPDATE SET updated_at = NOW()
		 RETURNING id`,
		studentID, payload.ConversationID,
	).Scan(&convID)
	if err != nil {
		return "", fmt.Errorf("upsert conversation: %w", err)
	}
	return convID, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

