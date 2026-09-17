package zernio

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"strings"
)

// SignatureHeader is the GitHub-style HMAC header Zernio (and Meta) send
// on webhook deliveries.
const SignatureHeader = "X-Hub-Signature-256"

// WebhookEvent is the envelope delivered to the webhook endpoint. The docs
// describe a flat shape: {id, event: "message.received", message: {...},
// conversation: {...}, account: {...}, timestamp}. Payload holds the raw body
// so callers can unmarshal into InboundMessagePayload, MessageStatusPayload,
// or ConversationUpdatedPayload.
type WebhookEvent struct {
	Type    string          `json:"type"`
	Event   string          `json:"event"`
	Payload json.RawMessage `json:"payload"`
}

// UnmarshalJSON accepts both the documented flat shape ({event, ...}) and the
// legacy {type,payload} envelope.
func (e *WebhookEvent) UnmarshalJSON(data []byte) error {
	var aux struct {
		Type    string          `json:"type"`
		Event   string          `json:"event"`
		Payload json.RawMessage `json:"payload"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	e.Event = aux.Event
	e.Type = aux.Type
	if e.Type == "" {
		e.Type = aux.Event
	}
	// Payload is the whole body for the flat shape; Payload()/Data() for the
	// legacy envelope.
	e.Payload = aux.Payload
	if len(e.Payload) == 0 {
		e.Payload = aux.Data
	}
	if len(e.Payload) == 0 {
		// Flat event shape: the payload is the whole body itself.
		e.Payload = data
	}
	return nil
}

// ValidateSignature verifies an HMAC-SHA256 webhook signature.
// sigHeader is the value of X-Hub-Signature-256, in the form "sha256=<hex>".
// The MAC is computed over the raw request body. Comparison is constant-time.
func ValidateSignature(secret, payload []byte, sigHeader string) bool {
	if len(secret) == 0 || sigHeader == "" {
		return false
	}

	if len(sigHeader) < len(signaturePrefix) ||
		!strings.EqualFold(sigHeader[:len(signaturePrefix)], signaturePrefix) {
		return false
	}

	provided, err := hex.DecodeString(strings.TrimSpace(sigHeader[len(signaturePrefix):]))
	if err != nil || len(provided) == 0 {
		return false
	}

	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write(payload)
	expected := mac.Sum(nil)

	return subtle.ConstantTimeCompare(provided, expected) == 1
}

const signaturePrefix = "sha256="

// ParseWebhookEvent unmarshals a webhook JSON body into a WebhookEvent.
func ParseWebhookEvent(body []byte) (*WebhookEvent, error) {
	return ParseWebhookEventWithType(body, "")
}

// ParseWebhookEventWithType also accepts the event name supplied by Zernio's
// X-Zernio-Event header. Current webhook deliveries put the event name in
// that header while older deliveries included it in the JSON body.
func ParseWebhookEventWithType(body []byte, eventType string) (*WebhookEvent, error) {
	if len(body) == 0 {
		return nil, fmt.Errorf("zernio: empty webhook body")
	}

	var event WebhookEvent
	if err := json.Unmarshal(body, &event); err != nil {
		return nil, fmt.Errorf("zernio: parse webhook event: %w", err)
	}
	if event.Type == "" {
		event.Type = eventType
	}
	if event.Type == "" {
		return nil, fmt.Errorf("zernio: webhook event missing type")
	}

	switch event.Type {
	case EventInboxMessageCreated, EventInboxMessageSent,
		EventInboxMessageStatus, EventMessageRead, EventMessageFailed,
		EventConversationStarted,
		LegacyEventInboxMessageCreated, LegacyEventInboxMessageStatus,
		LegacyEventConversationUpdated:
	default:
		// log and ignore unknown event types for forward-compatibility
		log.Printf("[zernio] ignoring unknown webhook event type %q", event.Type)
		return &event, nil
	}

	return &event, nil
}
