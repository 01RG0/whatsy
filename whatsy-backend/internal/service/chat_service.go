// Package service contains application-level chat workflows.
package service

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/whatsy/backend/internal/domain"
	"github.com/whatsy/backend/internal/repository"
	"github.com/whatsy/backend/internal/websocket"
	"github.com/whatsy/backend/internal/zernio"
)

// ZernioSender is the subset of the Zernio client used by ChatService.
type ZernioSender interface {
	SendMessage(ctx context.Context, conversationID string, payload zernio.SendMessagePayload) (*zernio.SentMessage, error)
	MarkRead(ctx context.Context, conversationID string) error
}

// WSBroadcaster publishes chat events to connected WebSocket clients.
type WSBroadcaster interface {
	BroadcastToRoom(studentID string, event interface{})
	BroadcastToAll(event interface{})
}

// ChatService coordinates persistence, Zernio calls, and live chat updates.
type ChatService struct {
	db           *sql.DB
	convRepo     *repository.ConversationRepo
	msgRepo      *repository.MessageRepo
	zernioClient ZernioSender
	hub          WSBroadcaster
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

// HandleInboundMessage persists a Zernio message and notifies active clients.
// Repeated webhook deliveries are ignored using Zernio's message identifier.
func (s *ChatService) HandleInboundMessage(ctx context.Context, payload zernio.InboundMessagePayload) error {
	zernioID := firstNonEmpty(payload.ZernioMessageID, payload.MessageID)
	if zernioID != "" {
		existing, err := s.msgRepo.GetByZernioID(ctx, zernioID)
		if err != nil {
			return fmt.Errorf("check inbound message duplicate: %w", err)
		}
		if existing != nil {
			return nil
		}
	}

	message := domain.Message{
		ConversationID:  payload.ConversationID,
		Direction:       payload.Direction,
		Type:            domain.ContentType(payload.Type),
		Content:         payload.Content,
		Status:          domain.StatusDelivered,
		ZernioMessageID: zernioID,
		CreatedAt:       payload.Timestamp,
	}
	if message.Direction == "" {
		message.Direction = "inbound"
	}
	if message.Type == "" {
		message.Type = domain.ContentTypeText
	}
	if payload.MediaURL != "" {
		message.Attachments = []domain.Attachment{{URL: payload.MediaURL, Type: string(message.Type)}}
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

	s.hub.BroadcastToRoom(conversation.Participant.ID, websocket.NewMessageEvent{
		Event:     websocket.EventNewMessage,
		StudentID: conversation.Participant.ID,
		Message:   message,
	})
	s.hub.BroadcastToAll(websocket.ConversationUpdatedEvent{
		Event:        websocket.EventConversationUpdated,
		Conversation: *conversation,
	})
	return nil
}

// SendOutboundMessage sends a message through Zernio, then persists and
// broadcasts the confirmed message.
func (s *ChatService) SendOutboundMessage(ctx context.Context, conversationID string, payload zernio.SendMessagePayload) (*domain.Message, error) {
	sent, err := s.zernioClient.SendMessage(ctx, conversationID, payload)
	if err != nil {
		return nil, fmt.Errorf("send Zernio message: %w", err)
	}
	if sent == nil {
		return nil, fmt.Errorf("send Zernio message: empty response")
	}

	message := domain.Message{
		ConversationID:  conversationID,
		Direction:       "outbound",
		Type:            outboundContentType(payload),
		Content:         payload.Message,
		Status:          domain.StatusSent,
		ZernioMessageID: sent.ID,
		CreatedAt:       sent.Timestamp,
	}
	if payload.AttachmentURL != "" {
		message.Attachments = []domain.Attachment{{
			URL:      payload.AttachmentURL,
			Type:     payload.AttachmentType,
			Name:     payload.AttachmentName,
			MimeType: payload.AttachmentType,
		}}
	}

	if err := s.msgRepo.Create(ctx, &message); err != nil {
		return nil, fmt.Errorf("create outbound message: %w", err)
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
	s.hub.BroadcastToRoom(conversation.Participant.ID, websocket.NewMessageEvent{
		Event:     websocket.EventNewMessage,
		StudentID: conversation.Participant.ID,
		Message:   message,
	})
	return &message, nil
}

// MarkConversationRead clears local unread state, updates Zernio, and notifies
// connected clients of the new conversation state.
func (s *ChatService) MarkConversationRead(ctx context.Context, conversationID string) error {
	if err := s.convRepo.ResetUnread(ctx, conversationID); err != nil {
		return fmt.Errorf("reset conversation unread count: %w", err)
	}
	if err := s.zernioClient.MarkRead(ctx, conversationID); err != nil {
		return fmt.Errorf("mark Zernio conversation read: %w", err)
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
