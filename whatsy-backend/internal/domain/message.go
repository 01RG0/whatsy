package domain

import "time"

// ContentType matches all 11 types the frontend ZernioMessage.type field expects
type ContentType string

const (
	ContentTypeText        ContentType = "text"
	ContentTypeImage       ContentType = "image"
	ContentTypeAudio       ContentType = "audio"
	ContentTypeVoiceNote   ContentType = "voice_note"
	ContentTypeVideo       ContentType = "video"
	ContentTypeDocument    ContentType = "document"
	ContentTypeLocation    ContentType = "location"
	ContentTypeContacts    ContentType = "contacts"
	ContentTypeInteractive ContentType = "interactive"
	ContentTypeTemplate    ContentType = "template"
	ContentTypeSystem      ContentType = "system"
)

type DeliveryStatus string

const (
	StatusPending   DeliveryStatus = "pending"
	StatusSent      DeliveryStatus = "sent"
	StatusDelivered DeliveryStatus = "delivered"
	StatusRead      DeliveryStatus = "read"
	StatusFailed    DeliveryStatus = "failed"
)

type Attachment struct {
	URL             string  `json:"url"`
	Type            string  `json:"type"`
	Name            string  `json:"name"`
	SizeBytes       int64   `json:"sizeBytes"`
	MimeType        string  `json:"mimeType"`
	DurationSeconds float64 `json:"durationSeconds,omitempty"`
	ThumbnailURL    string  `json:"thumbnailUrl,omitempty"`
}

type InteractiveButton struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Type  string `json:"type"`
}

type ListSection struct {
	Title string              `json:"title"`
	Rows  []InteractiveButton `json:"rows"`
}

type Interactive struct {
	Header       string              `json:"header,omitempty"`
	Body         string              `json:"body"`
	Footer       string              `json:"footer,omitempty"`
	Buttons      []InteractiveButton `json:"buttons,omitempty"`
	ListSections []ListSection       `json:"listSections,omitempty"`
}

type ReplyTo struct {
	ID         string `json:"id"`
	SenderName string `json:"senderName"`
	Content    string `json:"content"`
}

type Reaction struct {
	AgentID string `json:"agentId"`
	Emoji   string `json:"emoji"`
}

type Message struct {
	ID               string         `json:"id"`
	ConversationID   string         `json:"conversationId"`
	Direction        string         `json:"direction"`
	Type             ContentType    `json:"type"`
	Content          string         `json:"content"`
	Status           DeliveryStatus `json:"status"`
	ZernioMessageID  string         `json:"zernioMessageId,omitempty"`
	SentByAgentID    string         `json:"sentByAgentId,omitempty"`
	SenderName       string         `json:"senderName,omitempty"`
	SenderAvatar     string         `json:"senderAvatar,omitempty"`
	CreatedAt        time.Time      `json:"createdAt"`
	Attachments      []Attachment   `json:"attachments,omitempty"`
	Interactive      *Interactive   `json:"interactive,omitempty"`
	ReplyTo          *ReplyTo       `json:"replyTo,omitempty"`
	Reactions        []Reaction     `json:"reactions,omitempty"`
}
