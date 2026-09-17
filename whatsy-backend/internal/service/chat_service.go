// Package service contains application-level chat workflows.
package service

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"github.com/whatsy/backend/internal/domain"
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
	if localConvID == "" {
		return fmt.Errorf("inbound message: no local conversation found for zernio id %q", payload.ConversationID)
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
	if err := s.convRepo.IncrementUnread(ctx, message.ConversationID); err != nil {
		return fmt.Errorf("increment conversation unread count: %w", err)
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
		attType := payload.AttachmentType
		if attType == "" {
			attType = "file"
		}
		message.Attachments = []domain.Attachment{{
			URL:      payload.AttachmentURL,
			Type:     attachmentKind(domain.ContentType(attType)),
			Name:     payload.AttachmentName,
			MimeType: payload.AttachmentType,
		}}
	}

	if err := s.msgRepo.Create(ctx, &message); err != nil {
		return nil, fmt.Errorf("create outbound message: %w", err)
	}
	if agentID != "" && message.SenderName == "" {
		var name, avatar string
		_ = s.db.QueryRowContext(ctx, "SELECT name, avatar FROM agents WHERE id = $1", agentID).Scan(&name, &avatar)
		message.SenderName = name
		message.SenderAvatar = avatar
	}
	if err := s.convRepo.UpdateLastMessage(ctx, conversationID, message.Content, string(message.Type)); err != nil {
		return nil, fmt.Errorf("update conversation last message: %w", err)
	}

	conversation, err := s.convRepo.GetByID(ctx, conversationID)
	if err != nil {
		return nil, fmt.Errorf("get updated conversation: %w", err)
	}
	if conversation == nil {
		return nil, fmt.Errorf("get updated conversation: conversation %q not found", conversationID)
	}
	s.hub.BroadcastToAll(websocket.NewMessageEvent{
		Event:     websocket.EventNewMessage,
		StudentID: conversationID,
		Message:   message,
	})
	s.hub.BroadcastToAll(websocket.ConversationUpdatedEvent{
		Event:        websocket.EventConversationUpdated,
		Conversation: *conversation,
	})

	// Deliver to Zernio in the background — update status when done.
	go func() {
		sent, err := s.zernioClient.SendMessage(context.Background(), zernioConvID, payload)
		if err != nil {
			log.Printf("[SendOutboundMessage] zernio delivery failed for message %s: %v", message.ID, err)
			_ = s.msgRepo.UpdateZernioIDAndStatus(context.Background(), message.ID, "", domain.StatusFailed)
			return
		}
		_ = s.msgRepo.UpdateZernioIDAndStatus(context.Background(), message.ID, sent.ID, domain.StatusSent)
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
			if err := s.zernioClient.MarkRead(ctx, zernioConvID, accountID); err != nil {
				log.Printf("mark Zernio conversation read: %v", err)
			}
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

func outboundContentType(payload zernio.SendMessagePayload) domain.ContentType {
	if payload.VoiceNote {
		return domain.ContentTypeVoiceNote
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

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

