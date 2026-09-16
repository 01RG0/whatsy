package zernio

import "time"

// InboundMessagePayload is the body of an inbox.message.created event.
type InboundMessagePayload struct {
	ConversationID  string    `json:"conversationId"`
	MessageID       string    `json:"messageId"`
	Direction       string    `json:"direction"`
	Type            string    `json:"type"`
	Content         string    `json:"content"`
	MediaURL        string    `json:"mediaUrl,omitempty"`
	ZernioMessageID string    `json:"zernioMessageId,omitempty"`
	Timestamp       time.Time `json:"timestamp"`
	From            string    `json:"from"`
}

// MessageStatusPayload is the body of an inbox.message.status event.
type MessageStatusPayload struct {
	MessageID      string    `json:"messageId"`
	ConversationID string    `json:"conversationId,omitempty"`
	Status         string    `json:"status"`
	Timestamp      time.Time `json:"timestamp"`
}

// ConversationUpdatedPayload is the body of a conversation.updated event.
type ConversationUpdatedPayload struct {
	ConversationID string `json:"conversationId"`
	UnreadCount    int    `json:"unreadCount"`
	LastMessage    string `json:"lastMessage"`
	LastMessageAt  string `json:"lastMessageAt"`
}
