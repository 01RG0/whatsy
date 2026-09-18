package zernio

import (
	"encoding/json"
	"strings"
	"time"
)

// Known webhook event types (per the Zernio docs, "Inbox webhooks").
const (
	EventInboxMessageCreated = "message.received"  // new inbound message
	EventInboxMessageSent    = "message.sent"      // outgoing message (echo of own sends)
	EventInboxMessageStatus  = "message.delivered" // message.delivered / .read / .failed share this shape
	EventMessageRead         = "message.read"
	EventMessageFailed       = "message.failed"
	EventConversationStarted = "conversation.started"
	EventMessageDeleted      = "message.deleted"
	EventReactionReceived    = "reaction.received"

	EventConversationUpdated = "conversation.updated"

	// Legacy aliases kept for backwards compatibility with older deliveries.
	LegacyEventInboxMessageCreated = "inbox.message.created"
	LegacyEventInboxMessageStatus  = "inbox.message.status"
	LegacyEventConversationUpdated = "conversation.updated"
)

// statusEventNames are the inbox events that carry a delivery-status update.
var statusEventNames = map[string]bool{
	EventInboxMessageStatus: true,
	EventMessageRead:        true,
	EventMessageFailed:      true,
	LegacyEventInboxMessageStatus: true,
}

// IsStatusEvent reports whether the given event type carries a message
// delivery-status update (message.delivered / message.read / message.failed).
func IsStatusEvent(eventType string) bool {
	return statusEventNames[eventType]
}

// statusFromEvent maps a webhook event name to the delivery status it carries.
func statusFromEvent(eventType string) string {
	switch eventType {
	case EventInboxMessageStatus, LegacyEventInboxMessageStatus:
		return "delivered"
	case EventMessageRead:
		return "read"
	case EventMessageFailed:
		return "failed"
	}
	return ""
}

// InboundMessagePayload is the body of a message.received event. It supports
// both the documented flat shape ({event, message, conversation, account,
// timestamp}) and the legacy {type, payload:{...}} envelope.
type InboundMessagePayload struct {
	ConversationID    string
	MessageID         string // Zernio internal message id
	PlatformMessageID string // platform id (WhatsApp wamid); the dedupe/status key
	Direction         string // normalized to inbound|outbound
	Type              string
	Content           string
	MediaURL          string
	Attachments       []struct {
		Type string
		URL  string
	}
	AccountID       string // accountId of the connected WhatsApp account
	Timestamp       time.Time
	From            string // sender phone number
	ParticipantName string // sender display name from conversation.participant
}

type rawInboundMessage struct {
	Event   string `json:"event"`
	Type    string `json:"type"`
	Message struct {
		ID                string `json:"id"`
		ConversationID    string `json:"conversationId"`
		PlatformMessageID string `json:"platformMessageId"`
		Direction         string `json:"direction"` // incoming | outgoing
		Text              string `json:"text"`
		Type              string `json:"type"`
		Content           string `json:"content"`
		Attachments       []struct {
			Type string `json:"type"`
			URL  string `json:"url"`
		} `json:"attachments"`
		SentAt    time.Time `json:"sentAt"`
		Timestamp time.Time `json:"timestamp"`
		Sender    struct {
			ID          string `json:"id"`
			PhoneNumber string `json:"phoneNumber"`
			Name        string `json:"name"`
		} `json:"sender"`
	} `json:"message"`
	// Legacy flat payload fields.
	ConversationID  string    `json:"conversationId"`
	MessageID       string    `json:"messageId"`
	ZernioMessageID string    `json:"zernioMessageId"`
	Direction       string    `json:"direction"`
	Content         string    `json:"content"`
	MediaURL        string    `json:"mediaUrl"`
	Timestamp       time.Time `json:"timestamp"`
	From            string    `json:"from"`

	Conversation struct {
		ParticipantID       string `json:"participantId"`
		ParticipantName     string `json:"participantName"`
		ParticipantUsername string `json:"participantUsername"`
	} `json:"conversation"`

	Account struct {
		AccountID string `json:"accountId"`
	} `json:"account"`
}

// UnmarshalJSON accepts the documented message.received shape and the legacy
// flat payload. Direction is normalized: incoming -> inbound, outgoing -> outbound.
func (p *InboundMessagePayload) UnmarshalJSON(data []byte) error {
	var raw rawInboundMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	m := raw.Message
	// conversationId: nested first, then flat.
	p.ConversationID = firstNonEmpty(m.ConversationID, raw.ConversationID)
	// message id: platform id is the stable dedupe/status key on WhatsApp;
	// fall back to the internal id, then the legacy zernioMessageId/messageId.
	p.PlatformMessageID = m.PlatformMessageID
	p.MessageID = firstNonEmpty(m.ID, raw.MessageID, raw.ZernioMessageID)
	p.Timestamp = firstTime(m.SentAt, m.Timestamp, raw.Timestamp)
	p.AccountID = raw.Account.AccountID
	// message.sender.phoneNumber is E.164 (best source); conversation.participantUsername
	// is also E.164 for WhatsApp; participantId is the phone without +; legacy "from" last.
	p.From = firstNonEmpty(
		raw.Message.Sender.PhoneNumber,
		raw.Conversation.ParticipantUsername,
		raw.Conversation.ParticipantID,
		raw.From,
	)
	p.ParticipantName = firstNonEmpty(raw.Message.Sender.Name, raw.Conversation.ParticipantName)

	dir := firstNonEmpty(raw.Message.Direction, raw.Direction)
	switch strings.ToLower(dir) {
	case "incoming":
		p.Direction = "inbound"
	case "outgoing":
		p.Direction = "outbound"
	default:
		p.Direction = dir
	}

	p.Content = firstNonEmpty(m.Text, m.Content, raw.Content)
	p.Type = firstNonEmpty(m.Type, raw.Type)
	p.MediaURL = raw.MediaURL
	if p.MediaURL == "" && len(m.Attachments) > 0 {
		p.MediaURL = m.Attachments[0].URL
		if p.Type == "" {
			p.Type = m.Attachments[0].Type
		}
	}
	// WhatsApp attachment URLs point at GET /v1/whatsapp/media/{mediaId}; the
	// backend re-serves that path with auth, so keep the URL as-is client-side.
	if p.Type == "" {
		p.Type = "text"
	}
	if len(m.Attachments) > 0 {
		p.Attachments = make([]struct {
			Type string
			URL  string
		}, len(m.Attachments))
		for i, a := range m.Attachments {
			p.Attachments[i] = struct {
				Type string
				URL  string
			}{Type: a.Type, URL: a.URL}
		}
	} else if p.MediaURL != "" {
		p.Attachments = []struct {
			Type string
			URL  string
		}{{Type: p.Type, URL: p.MediaURL}}
	}
	return nil
}

// MessageStatusPayload is the body of a message.delivered / message.read /
// message.failed event. For WhatsApp the platformMessageId equals the wamid
// returned by the send-message endpoint, which is what we persist as the
// message's zernio_message_id.
type MessageStatusPayload struct {
	MessageID         string
	PlatformMessageID string
	ConversationID    string
	AccountID         string
	Status            string
	Timestamp         time.Time
}

type rawMessageStatus struct {
	Event     string `json:"event"`
	Message   struct {
		ID                string `json:"id"`
		PlatformMessageID string `json:"platformMessageId"`
		ConversationID    string `json:"conversationId"`
	} `json:"message"`
	Conversation struct {
		ID string `json:"id"`
	} `json:"conversation"`
	Account struct {
		AccountID string `json:"accountId"`
	} `json:"account"`
	Status     string    `json:"status"`
	StatusAt   time.Time `json:"statusAt"`
	Timestamp  time.Time `json:"timestamp"`
	// Legacy flat fields.
	MessageID       string `json:"messageId"`
	ConversationID  string `json:"conversationId"`
}

// UnmarshalJSON accepts the documented status shape and the legacy flat one.
// Status is derived from the event name when the body does not carry one.
func (p *MessageStatusPayload) UnmarshalJSON(data []byte) error {
	var raw rawMessageStatus
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	p.PlatformMessageID = raw.Message.PlatformMessageID
	p.MessageID = firstNonEmpty(raw.Message.ID, raw.MessageID)
	p.ConversationID = firstNonEmpty(raw.Message.ConversationID, raw.Conversation.ID, raw.ConversationID)
	p.AccountID = raw.Account.AccountID
	p.Timestamp = firstTime(raw.StatusAt, raw.Timestamp)
	p.Status = raw.Status
	if p.Status == "" {
		p.Status = statusFromEvent(raw.Event)
	}
	return nil
}

// ConversationUpdatedPayload is the body of a conversation.updated event
// (legacy) or the payload broadcast for conversation.started.
type ConversationUpdatedPayload struct {
	ConversationID string `json:"conversationId"`
	UnreadCount    int    `json:"unreadCount"`
	LastMessage    string `json:"lastMessage"`
	LastMessageAt  string `json:"lastMessageAt"`
}

// ReactionPayload is the body of a reaction.received event.
type ReactionPayload struct {
	MessageID         string `json:"messageId"`
	PlatformMessageID string `json:"platformMessageId"`
	ConversationID    string `json:"conversationId"`
	Emoji             string `json:"emoji"`
	From              string `json:"from"`
}

// UnmarshalJSON handles the nested message/conversation shape.
func (p *ReactionPayload) UnmarshalJSON(data []byte) error {
	var raw struct {
		Message struct {
			ID                string `json:"id"`
			PlatformMessageID string `json:"platformMessageId"`
			ConversationID    string `json:"conversationId"`
		} `json:"message"`
		Conversation struct {
			ID string `json:"id"`
		} `json:"conversation"`
		Reaction struct {
			Emoji string `json:"emoji"`
		} `json:"reaction"`
		// flat fallback
		MessageID      string `json:"messageId"`
		ConversationID string `json:"conversationId"`
		Emoji          string `json:"emoji"`
		From           string `json:"from"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	p.PlatformMessageID = raw.Message.PlatformMessageID
	p.MessageID = firstNonEmpty(raw.Message.ID, raw.MessageID)
	p.ConversationID = firstNonEmpty(raw.Message.ConversationID, raw.Conversation.ID, raw.ConversationID)
	p.Emoji = firstNonEmpty(raw.Reaction.Emoji, raw.Emoji)
	p.From = raw.From
	return nil
}

// MessageDeletedPayload is the body of a message.deleted event.
type MessageDeletedPayload struct {
	MessageID         string `json:"messageId"`
	PlatformMessageID string `json:"platformMessageId"`
	ConversationID    string `json:"conversationId"`
}

func (p *MessageDeletedPayload) UnmarshalJSON(data []byte) error {
	var raw struct {
		Message struct {
			ID                string `json:"id"`
			PlatformMessageID string `json:"platformMessageId"`
			ConversationID    string `json:"conversationId"`
		} `json:"message"`
		Conversation struct {
			ID string `json:"id"`
		} `json:"conversation"`
		MessageID      string `json:"messageId"`
		ConversationID string `json:"conversationId"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	p.PlatformMessageID = raw.Message.PlatformMessageID
	p.MessageID = firstNonEmpty(raw.Message.ID, raw.MessageID)
	p.ConversationID = firstNonEmpty(raw.Message.ConversationID, raw.Conversation.ID, raw.ConversationID)
	return nil
}

func firstTime(values ...time.Time) time.Time {
	for _, v := range values {
		if !v.IsZero() {
			return v
		}
	}
	return time.Time{}
}
