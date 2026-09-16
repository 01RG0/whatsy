package websocket

import (
	"encoding/json"

	"github.com/whatsy/backend/internal/domain"
)

// EventType defines outgoing server-to-client event types.
type EventType string

const (
	EventNewMessage             EventType = "NEW_MESSAGE"
	EventMessageStatus          EventType = "MESSAGE_STATUS"
	EventStudentViewersChanged  EventType = "STUDENT_VIEWERS_CHANGED"
	EventAgentTypingLock        EventType = "AGENT_TYPING_LOCK"
	EventTypingLockReleased     EventType = "TYPING_LOCK_RELEASED"
	EventConversationUpdated    EventType = "CONVERSATION_UPDATED"
)

// ActionType defines incoming client-to-server action types.
type ActionType string

const (
	ActionSubscribeStudent   ActionType = "SUBSCRIBE_STUDENT"
	ActionUnsubscribeStudent ActionType = "UNSUBSCRIBE_STUDENT"
	ActionTypingStart        ActionType = "TYPING_START"
	ActionTypingStop         ActionType = "TYPING_STOP"
)

// Server → Client event payloads

// NewMessageEvent: {event:'NEW_MESSAGE', studentId:string, message:{...}}
type NewMessageEvent struct {
	Event     EventType      `json:"event"`
	StudentID string         `json:"studentId"`
	Message   domain.Message `json:"message"`
}

// MessageStatusEvent: {event:'MESSAGE_STATUS', messageId:string, status:string}
type MessageStatusEvent struct {
	Event     EventType `json:"event"`
	MessageID string    `json:"messageId"`
	Status    string    `json:"status"`
}

// StudentViewersChangedEvent: {event:'STUDENT_VIEWERS_CHANGED', studentId:string, viewers:[{agentId,name,avatar}]}
type StudentViewersChangedEvent struct {
	Event     EventType           `json:"event"`
	StudentID string              `json:"studentId"`
	Viewers   []domain.ViewerInfo `json:"viewers"`
}

// AgentTypingLockEvent: {event:'AGENT_TYPING_LOCK', studentId:string, lockedBy:{agentId,name,avatar}, expiresInMs:number}
type AgentTypingLockEvent struct {
	Event       EventType         `json:"event"`
	StudentID   string            `json:"studentId"`
	LockedBy    domain.ViewerInfo `json:"lockedBy"`
	ExpiresInMs int64             `json:"expiresInMs"`
}

// TypingLockReleasedEvent: {event:'TYPING_LOCK_RELEASED', studentId:string}
type TypingLockReleasedEvent struct {
	Event     EventType `json:"event"`
	StudentID string    `json:"studentId"`
}

// ConversationUpdatedEvent: {event:'CONVERSATION_UPDATED', conversation:{...}}
type ConversationUpdatedEvent struct {
	Event        EventType           `json:"event"`
	Conversation domain.Conversation `json:"conversation"`
}

// Client → Server action payloads

// ClientAction represents the incoming JSON message structure from a client.
type ClientAction struct {
	Action    ActionType      `json:"action"`
	StudentID string          `json:"studentId,omitempty"`
	Data      json.RawMessage `json:"data,omitempty"`
}
