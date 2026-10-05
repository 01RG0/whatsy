// Package service contains application-level chat workflows.
package service

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/whatsy/backend/internal/domain"
	"github.com/whatsy/backend/internal/eventlog"
	"github.com/whatsy/backend/internal/repository"
	"github.com/whatsy/backend/internal/storage"
	"github.com/whatsy/backend/internal/websocket"
	"github.com/whatsy/backend/internal/zernio"
)

// mediaCacheSem caps concurrent cacheMedia goroutines at 3 to prevent them
// from exhausting the DB connection pool during bursts of inbound media.
var mediaCacheSem = make(chan struct{}, 3)

// ZernioSender is the subset of the Zernio client used by ChatService.
type ZernioSender interface {
	SendMessage(ctx context.Context, conversationID string, payload zernio.SendMessagePayload) (*zernio.SentMessage, error)
	SendMessageWithKey(ctx context.Context, conversationID string, payload zernio.SendMessagePayload, apiKey string) (*zernio.SentMessage, error)
	MarkRead(ctx context.Context, conversationID, accountID string) error
	MarkReadWithKey(ctx context.Context, conversationID, accountID, apiKey string) error
	FetchAccountID(ctx context.Context) (string, error)
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

type tenantCache struct {
	mu        sync.RWMutex
	byAccount map[string]string
	fallback  string
	expiresAt time.Time
}

// ChatService coordinates persistence, Zernio calls, and live chat updates.
type ChatService struct {
	db           *sql.DB
	convRepo     *repository.ConversationRepo
	msgRepo      *repository.MessageRepo
	zernioClient ZernioSender
	hub          WSBroadcaster
	autoReplier  AutoReplier
	r2           *storage.R2Client
	zernioAPIKey string
	tc           tenantCache
}

func NewChatService(db *sql.DB, convRepo *repository.ConversationRepo, msgRepo *repository.MessageRepo, zernioClient ZernioSender, hub WSBroadcaster, zernioAPIKey string) *ChatService {
	return &ChatService{
		db:           db,
		convRepo:     convRepo,
		msgRepo:      msgRepo,
		zernioClient: zernioClient,
		hub:          hub,
		zernioAPIKey: zernioAPIKey,
	}
}

// SetAutoReplier wires the database-driven auto-reply evaluator.
func (s *ChatService) SetAutoReplier(ar AutoReplier) {
	s.autoReplier = ar
}

// SetR2 wires the Cloudflare R2 storage client for media caching.
func (s *ChatService) SetR2(r2 *storage.R2Client) {
	s.r2 = r2
}

// zernioAccountID resolves the connected WhatsApp account id for the given
// tenant. When tenantID is non-empty the query is scoped to that tenant;
// otherwise it falls back to the first connected account across all tenants
// (used by startup recovery paths that have no tenant context).
func (s *ChatService) zernioAccountID(ctx context.Context, tenantID string) string {
	var accountID string
	if tenantID != "" {
		_ = s.db.QueryRowContext(ctx,
			`SELECT account_id FROM whatsapp_connections WHERE status='connected' AND tenant_id=$1 AND COALESCE(account_id,'') <> '' ORDER BY id DESC LIMIT 1`,
			tenantID,
		).Scan(&accountID)
	} else {
		_ = s.db.QueryRowContext(ctx,
			`SELECT account_id FROM whatsapp_connections WHERE status='connected' AND COALESCE(account_id, '') <> '' ORDER BY id DESC LIMIT 1`,
		).Scan(&accountID)
	}
	return accountID
}

// getZernioKey returns the Zernio API key configured for the given tenant.
// When tenantID is empty or the tenant has no key in workspace_settings, it
// falls back to the global key from the environment.
func (s *ChatService) getZernioKey(ctx context.Context, tenantID string) string {
	if tenantID == "" {
		return s.zernioAPIKey
	}
	var key string
	_ = s.db.QueryRowContext(ctx,
		`SELECT value FROM workspace_settings WHERE tenant_id=$1 AND key='zernio_api_key' LIMIT 1`,
		tenantID,
	).Scan(&key)
	if key == "" {
		return s.zernioAPIKey
	}
	return key
}

// resolveAccountID returns the WhatsApp accountId for background retry paths
// that have no tenant context. It first checks the DB; if the column is NULL
// (common after fresh deploys) it falls back to asking the Zernio API directly.
func (s *ChatService) resolveAccountID(ctx context.Context) string {
	if id := s.zernioAccountID(ctx, ""); id != "" {
		return id
	}
	id, err := s.zernioClient.FetchAccountID(ctx)
	if err != nil {
		log.Printf("[retry] fallback FetchAccountID error: %v", err)
		return ""
	}
	if id != "" {
		log.Printf("[retry] using accountId from Zernio API fallback: %s", id)
	}
	return id
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

	// Outbound race-condition guard: SendOutboundMessage saves the message with
	// StatusPending and no zernio_message_id, then sets the ID asynchronously.
	// The message.sent webhook can arrive before that update completes, causing
	// a duplicate row. Claim the most-recent pending outbound message for this
	// conversation instead of creating a new one.
	if payload.Direction == "outgoing" && dedupeID != "" {
		var claimedID string
		// $3 = Zernio ObjectID: covers the case where UpdateZernioIDAndStatus ran
		// first and stored the ObjectID before this webhook arrived.
		objectID := payload.MessageID
		_ = s.db.QueryRowContext(ctx,
			`UPDATE messages SET zernio_message_id = $1, status = 'sent'
			 WHERE id = (
			     SELECT id FROM messages
			     WHERE conversation_id = $2
			       AND direction = 'outbound'
			       AND status IN ('pending', 'sent')
			       AND (zernio_message_id IS NULL OR zernio_message_id = '' OR zernio_message_id = $3)
			     ORDER BY created_at DESC
			     LIMIT 1
			 )
			 RETURNING id`,
			dedupeID, localConvID, objectID,
		).Scan(&claimedID)
		if claimedID != "" {
			s.hub.BroadcastToAll(websocket.MessageStatusEvent{
				Event:     websocket.EventMessageStatus,
				MessageID: claimedID,
				Status:    string(domain.StatusSent),
			})
			return nil
		}
		// Claim failed — a concurrent webhook (e.g. message.created arriving at
		// the same time as message.sent) may have already claimed the row.
		// Re-check before falling through to INSERT to avoid a duplicate row.
		if existing2, err2 := s.msgRepo.GetByZernioID(ctx, dedupeID); err2 == nil && existing2 != nil {
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
		ContactPhone:    payload.ContactPhone,
		IsForwarded:     payload.IsForwarded,
	}
	if message.Direction == "" {
		message.Direction = "inbound"
	}
	if message.Type == "" {
		message.Type = domain.ContentTypeText
	}

	// Resolve quoted-reply context: look up the quoted message by its wamid (or local ID)
	// so we can show a preview bubble in the UI.
	if payload.ReplyTo != nil && payload.ReplyTo.ZernioMessageID != "" {
		quoted, err := s.msgRepo.GetByZernioID(ctx, payload.ReplyTo.ZernioMessageID)
		if err != nil || quoted == nil {
			quoted, _ = s.msgRepo.GetByID(ctx, payload.ReplyTo.ZernioMessageID)
		}

		if quoted != nil {
			var senderName string
			if quoted.Direction == "outbound" {
				senderName = "You"
			} else if quoted.SenderName != "" {
				senderName = quoted.SenderName
			} else {
				convID := quoted.ConversationID
				if convID == "" {
					convID = localConvID
				}
				if conv, err := s.convRepo.GetByID(ctx, convID); err == nil && conv != nil && conv.Participant.DisplayName != "" {
					senderName = conv.Participant.DisplayName
				} else if payload.ParticipantName != "" {
					senderName = payload.ParticipantName
				} else {
					senderName = "Contact"
				}
			}

			var content string
			if quoted.Content != "" {
				content = quoted.Content
			} else if payload.ReplyTo.Content != "" {
				content = payload.ReplyTo.Content
			} else {
				switch quoted.Type {
				case domain.ContentTypeImage:
					content = "📷 Photo"
				case domain.ContentTypeAudio, domain.ContentTypeVoiceNote:
					content = "🎵 Voice message"
				case domain.ContentTypeVideo:
					content = "🎥 Video"
				case domain.ContentTypeDocument:
					content = "📄 Document"
				case domain.ContentTypeSticker:
					content = "Sticker"
				default:
					content = ""
				}
			}

			message.ReplyTo = &domain.ReplyTo{
				ID:         quoted.ID,
				SenderName: senderName,
				Content:    content,
			}
		} else {
			// Quoted message not in DB (e.g. failed send, old message) — store
			// the fallback data so the frontend can still show a preview.
			message.ReplyTo = &domain.ReplyTo{
				ID:         payload.ReplyTo.ZernioMessageID,
				SenderName: payload.ReplyTo.SenderName,
				Content:    payload.ReplyTo.Content,
			}
		}
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

	// Broadcast the new message immediately after it is persisted so agents'
	// browsers display it without waiting for the remaining DB operations below.
	s.hub.BroadcastToAll(websocket.NewMessageEvent{
		Event:     websocket.EventNewMessage,
		StudentID: message.ConversationID,
		Message:   message,
	})

	if message.Type == domain.ContentTypeSticker && len(message.Attachments) > 0 {
		for _, att := range message.Attachments {
			if att.URL != "" {
				go s.cacheSticker(att.URL)
			}
		}
	}

	// Cache inbound media immediately so it survives Meta CDN expiry.
	// We cache audio (voice notes), images, and video — the types that commonly expire.
	switch message.Type {
	case domain.ContentTypeAudio, domain.ContentTypeVoiceNote,
		domain.ContentTypeImage, domain.ContentTypeVideo:
		for _, att := range message.Attachments {
			if att.URL != "" {
				attURL := att.URL
				ct := message.Type
				go s.cacheMedia(attURL, ct)
			}
		}
	}

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
	if err := s.convRepo.UpdateLastMessage(ctx, message.ConversationID, message.Content); err != nil {
		return fmt.Errorf("update conversation last message: %w", err)
	}

	conversation, err := s.convRepo.GetByID(ctx, message.ConversationID)
	if err != nil {
		return fmt.Errorf("get updated conversation: %w", err)
	}
	if conversation == nil {
		return fmt.Errorf("get updated conversation: conversation %q not found", message.ConversationID)
	}

	// Push the updated conversation to every connected client so all
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
	// Prefer platformMessageId (wamid) — that is what HandleInboundMessage
	// stores as zernio_message_id. Zernio's internal messageId is a fallback.
	dedupeID := firstNonEmpty(payload.PlatformMessageID, payload.MessageID)
	if dedupeID == "" {
		return nil
	}
	if err := s.msgRepo.UpdateStatusByZernioID(ctx, dedupeID, domain.DeliveryStatus(payload.Status)); err != nil {
		if strings.Contains(err.Error(), "no message with zernio_message_id") {
			return nil
		}
		return fmt.Errorf("update message status: %w", err)
	}
	return nil
}

// SendOutboundMessage persists the message immediately and returns it to the
// caller, then delivers it to Zernio asynchronously. This makes the send feel
// instant in the UI — the message appears right away with status "pending" and
// flips to "sent" (or "failed") once Zernio responds.
func (s *ChatService) SendOutboundMessage(ctx context.Context, conversationID string, payload zernio.SendMessagePayload, agentID string, tenantID string) (*domain.Message, error) {
	if payload.AccountID == "" {
		payload.AccountID = s.zernioAccountID(ctx, tenantID)
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
	if payload.Forwarded {
		message.IsForwarded = true
	}
	if len(payload.Contacts) > 0 {
		c := payload.Contacts[0]
		if message.Content == "" {
			message.Content = c.Name.FormattedName
		}
		if len(c.Phones) > 0 {
			message.ContactPhone = c.Phones[0].Phone
		}
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
		if replied, err := s.msgRepo.GetByID(ctx, payload.ReplyTo); err == nil && replied != nil &&
			replied.ConversationID == conversationID {
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
		} else {
			payload.ReplyTo = "" // don't forward untrusted/foreign message IDs to Zernio
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
		_ = s.convRepo.UpdateLastMessage(bgCtx, conversationID, message.Content)
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
	tenantKey := s.getZernioKey(ctx, tenantID)
	go func() {
		start := time.Now()
		sent, err := s.zernioClient.SendMessageWithKey(context.Background(), zernioConvID, payload, tenantKey)
		dur := time.Since(start).Milliseconds()
		eventlog.ZernioSend(message.ID, conversationID, dur, err)
		if err != nil {
			if errors.Is(err, zernio.ErrRateLimited) {
				// Keep as pending — RetryPendingOnce / StartRetryLoop will retry after the window resets.
				log.Printf("[chat] rate limited sending msg %s — left as pending for retry", message.ID)
				s.hub.BroadcastToAll(websocket.MessageStatusEvent{
					Event:     websocket.EventMessageStatus,
					MessageID: message.ID,
					Status:    string(domain.StatusPending),
				})
				return
			}
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
func (s *ChatService) MarkConversationRead(ctx context.Context, conversationID string, tenantID string) error {
	if err := s.convRepo.ResetUnread(ctx, conversationID); err != nil {
		return fmt.Errorf("reset conversation unread count: %w", err)
	}
	if accountID := s.zernioAccountID(ctx, tenantID); accountID != "" {
		zernioConvID, err := s.convRepo.GetZernioIDByLocalID(ctx, conversationID)
		if err == nil && zernioConvID != "" {
			tenantKey := s.getZernioKey(ctx, tenantID)
			go func() {
				if err := s.zernioClient.MarkReadWithKey(context.Background(), zernioConvID, accountID, tenantKey); err != nil {
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


// RetryPendingOnce finds outbound messages stuck in "pending" (from a
// killed goroutine during deploy) and retries their Zernio delivery.
// Called once at startup.
func (s *ChatService) RetryPendingOnce(ctx context.Context) {
	msgs, err := s.msgRepo.ListStuckPending(ctx, 30)
	if err != nil {
		log.Printf("[startup] retry stuck messages: %v", err)
		return
	}
	if len(msgs) == 0 {
		return
	}
	log.Printf("[retry-pending] retrying %d stuck pending messages", len(msgs))

	accountID := s.resolveAccountID(ctx)
	if accountID == "" {
		log.Printf("[retry-pending] skipping: could not resolve accountId")
		return
	}
	for _, msg := range msgs {
		zernioConvID, err := s.convRepo.GetZernioIDByLocalID(ctx, msg.ConversationID)
		if err != nil || zernioConvID == "" {
			log.Printf("[retry-pending] skip msg %s — no zernio conv id", msg.ID)
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
			log.Printf("[retry-pending] msg %s failed: %v", msg.ID, err)
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
		log.Printf("[retry-pending] msg %s sent ok", msg.ID)
	}
}

// RetryFailedMessages finds outbound messages with status "failed" from the
// last 2 hours, resets them to pending, and retries delivery. Processes at
// most 20 messages per call to avoid hammering the rate limit. Returns
// (sent, failed, total) counts.
func (s *ChatService) RetryFailedMessages(ctx context.Context) (sent, failed, total int) {
	msgs, err := s.msgRepo.ListRecentFailed(ctx, 2)
	if err != nil {
		log.Printf("[retry-failed] list failed messages: %v", err)
		return
	}
	if len(msgs) > 20 {
		msgs = msgs[:20]
	}
	total = len(msgs)
	if total == 0 {
		return
	}
	log.Printf("[retry-failed] retrying %d failed messages", total)

	accountID := s.resolveAccountID(ctx)
	if accountID == "" {
		log.Printf("[retry-failed] skipping: could not resolve accountId")
		return
	}
	for _, msg := range msgs {
		_ = s.msgRepo.UpdateZernioIDAndStatus(ctx, msg.ID, "", domain.StatusPending)

		zernioConvID, err := s.convRepo.GetZernioIDByLocalID(ctx, msg.ConversationID)
		if err != nil || zernioConvID == "" {
			log.Printf("[retry-failed] skip msg %s — no zernio conv id", msg.ID)
			_ = s.msgRepo.UpdateZernioIDAndStatus(ctx, msg.ID, "", domain.StatusFailed)
			failed++
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

		sentMsg, err := s.zernioClient.SendMessage(ctx, zernioConvID, payload)
		if err != nil {
			log.Printf("[retry-failed] msg %s failed: %v", msg.ID, err)
			_ = s.msgRepo.UpdateZernioIDAndStatus(ctx, msg.ID, "", domain.StatusFailed)
			s.hub.BroadcastToAll(websocket.MessageStatusEvent{
				Event:     websocket.EventMessageStatus,
				MessageID: msg.ID,
				Status:    string(domain.StatusFailed),
			})
			failed++
			continue
		}
		_ = s.msgRepo.UpdateZernioIDAndStatus(ctx, msg.ID, sentMsg.ID, domain.StatusSent)
		s.hub.BroadcastToAll(websocket.MessageStatusEvent{
			Event:     websocket.EventMessageStatus,
			MessageID: msg.ID,
			Status:    string(domain.StatusSent),
		})
		sent++
		log.Printf("[retry-failed] sent %d/%d messages", sent, total)
	}
	return
}

// StartRetryLoop recovers messages stuck in "pending" at startup.
// RetryFailedMessages is disabled (causes duplicate sends on rate-limit failures).
func (s *ChatService) StartRetryLoop(ctx context.Context) {
	s.RetryPendingOnce(ctx)
}

func outboundContentType(payload zernio.SendMessagePayload) domain.ContentType {
	if len(payload.Contacts) > 0 {
		return domain.ContentTypeContacts
	}
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

// attachmentKind maps Zernio content/attachment types to attachment kinds the frontend understands.
func attachmentKind(t domain.ContentType) string {
	switch t {
	case domain.ContentTypeImage:
		return "image"
	case domain.ContentTypeAudio, domain.ContentTypeVoiceNote:
		return "audio"
	case domain.ContentTypeVideo:
		return "video"
	case domain.ContentTypeSticker:
		return "sticker"
	default:
		return "document"
	}
}

func (s *ChatService) cacheSticker(rawURL string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	h := sha256.Sum256([]byte(rawURL))
	hash := hex.EncodeToString(h[:])

	var exists bool
	_ = s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM sticker_cache WHERE url_hash=$1)`, hash).Scan(&exists)
	if exists {
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		log.Printf("[sticker-cache] build request for %s: %v", rawURL, err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+s.zernioAPIKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[sticker-cache] fetch %s: %v", rawURL, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("[sticker-cache] upstream %d for %s", resp.StatusCode, rawURL)
		return
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		log.Printf("[sticker-cache] read body %s: %v", rawURL, err)
		return
	}
	mimeType := resp.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "image/webp"
	}

	if s.r2 != nil {
		key := "sticker/" + hash
		if storageURL, uploadErr := s.r2.Upload(ctx, key, data, mimeType); uploadErr == nil {
			_, _ = s.db.ExecContext(ctx,
				`INSERT INTO sticker_cache (url_hash, original_url, storage_url, mime_type) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
				hash, rawURL, storageURL, mimeType,
			)
			return
		} else {
			log.Printf("[sticker-cache] r2 upload failed, falling back to DB: %v", uploadErr)
		}
	}

	_, err = s.db.ExecContext(ctx,
		`INSERT INTO sticker_cache (url_hash, original_url, data, mime_type) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
		hash, rawURL, data, mimeType,
	)
	if err != nil {
		log.Printf("[sticker-cache] store %s: %v", rawURL, err)
	}
}

// cacheMedia downloads inbound media from Zernio and stores it in the
// media_cache table so it can be served even after Meta's CDN expires the URL.
// The cache key is SHA-256 of the raw attachment URL, matching what GetProxy uses.
func (s *ChatService) cacheMedia(rawURL string, contentType domain.ContentType) {
	// Acquire a semaphore slot; skip if 3 operations are already in flight so we
	// don't exhaust the DB connection pool during media bursts.
	select {
	case mediaCacheSem <- struct{}{}:
		defer func() { <-mediaCacheSem }()
	default:
		return // 3 already in flight, skip this one
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	h := sha256.Sum256([]byte(rawURL))
	hash := hex.EncodeToString(h[:])

	var exists bool
	_ = s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM media_cache WHERE url_hash=$1)`, hash).Scan(&exists)
	if exists {
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		log.Printf("[media-cache] build request for %s: %v", rawURL, err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+s.zernioAPIKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[media-cache] fetch %s: %v", rawURL, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("[media-cache] upstream %d for %s", resp.StatusCode, rawURL)
		return
	}
	const maxMediaSize = 16 << 20 // 16 MB cap — voice notes are typically <2 MB
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxMediaSize))
	if err != nil {
		log.Printf("[media-cache] read body %s: %v", rawURL, err)
		return
	}
	mimeType := resp.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = defaultMimeType(rawURL, contentType)
	}

	if s.r2 != nil {
		key := "media/" + hash
		if storageURL, uploadErr := s.r2.Upload(ctx, key, data, mimeType); uploadErr == nil {
			_, _ = s.db.ExecContext(ctx,
				`INSERT INTO media_cache (url_hash, original_url, storage_url, mime_type) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
				hash, rawURL, storageURL, mimeType,
			)
			return
		} else {
			log.Printf("[media-cache] r2 upload failed, falling back to DB: %v", uploadErr)
		}
	}

	_, err = s.db.ExecContext(ctx,
		`INSERT INTO media_cache (url_hash, original_url, data, mime_type) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
		hash, rawURL, data, mimeType,
	)
	if err != nil {
		log.Printf("[media-cache] store %s: %v", rawURL, err)
		return
	}
	log.Printf("[media-cache] cached %s (%d bytes, %s)", rawURL, len(data), mimeType)
}

// defaultMimeType infers a MIME type from URL extension or domain content type
// for use when the upstream server omits a Content-Type header.
func defaultMimeType(rawURL string, contentType domain.ContentType) string {
	lower := strings.ToLower(rawURL)
	switch {
	case strings.HasSuffix(lower, ".ogg"), strings.HasSuffix(lower, ".opus"):
		return "audio/ogg"
	case strings.HasSuffix(lower, ".webm"):
		return "audio/webm"
	case strings.HasSuffix(lower, ".mp3"):
		return "audio/mpeg"
	case strings.HasSuffix(lower, ".mp4"):
		return "video/mp4"
	case strings.HasSuffix(lower, ".aac"):
		return "audio/aac"
	case strings.HasSuffix(lower, ".jpg"), strings.HasSuffix(lower, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(lower, ".png"):
		return "image/png"
	case strings.HasSuffix(lower, ".gif"):
		return "image/gif"
	case strings.HasSuffix(lower, ".webp"):
		return "image/webp"
	}
	switch contentType {
	case domain.ContentTypeAudio, domain.ContentTypeVoiceNote:
		return "audio/ogg"
	case domain.ContentTypeImage:
		return "image/jpeg"
	case domain.ContentTypeVideo:
		return "video/mp4"
	}
	return "application/octet-stream"
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

	tenantID := s.resolveTenantID(ctx, payload.AccountID)

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
		    (student_id, platform, last_message, last_message_at, unread_count, zernio_conversation_id, tenant_id, created_at, updated_at)
		 VALUES ($1, 'whatsapp', '', NOW(), 0, $2, $3::uuid, NOW(), NOW())
		 ON CONFLICT (zernio_conversation_id) DO UPDATE SET
		     tenant_id = COALESCE(conversations.tenant_id, EXCLUDED.tenant_id),
		     updated_at = NOW()
		 RETURNING id`,
		studentID, payload.ConversationID, sql.NullString{String: tenantID, Valid: tenantID != ""},
	).Scan(&convID)
	if err != nil {
		return "", fmt.Errorf("upsert conversation: %w", err)
	}
	return convID, nil
}

func (s *ChatService) resolveTenantID(ctx context.Context, accountID string) string {
	lookupFromCache := func() string {
		tid := s.tc.byAccount[accountID]
		if tid == "" && accountID == "" {
			tid = s.tc.fallback
		}
		return tid
	}

	s.tc.mu.RLock()
	if time.Now().Before(s.tc.expiresAt) {
		tid := lookupFromCache()
		s.tc.mu.RUnlock()
		return tid
	}
	s.tc.mu.RUnlock()

	s.tc.mu.Lock()
	defer s.tc.mu.Unlock()
	if time.Now().Before(s.tc.expiresAt) {
		return lookupFromCache()
	}

	rows, err := s.db.QueryContext(ctx, `SELECT account_id, tenant_id FROM whatsapp_connections WHERE status = 'connected'`)
	if err != nil {
		// Clear stale cache on error so we return empty string, not stale data.
		s.tc.byAccount = nil
		s.tc.fallback = ""
		return ""
	}
	defer rows.Close()
	m := make(map[string]string)
	var fallback string
	for rows.Next() {
		var acc, tid string
		if rows.Scan(&acc, &tid) == nil {
			m[acc] = tid
			if fallback == "" {
				fallback = tid
			}
		}
	}
	if rows.Err() != nil {
		// Partial scan — do not commit to cache.
		s.tc.byAccount = nil
		s.tc.fallback = ""
		return ""
	}
	s.tc.byAccount = m
	s.tc.fallback = fallback
	s.tc.expiresAt = time.Now().Add(5 * time.Minute)
	return lookupFromCache()
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

