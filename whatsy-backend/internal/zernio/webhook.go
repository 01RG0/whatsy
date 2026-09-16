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

// Known webhook event types.
const (
	EventInboxMessageCreated = "inbox.message.created"
	EventInboxMessageStatus  = "inbox.message.status"
	EventConversationUpdated = "conversation.updated"
)

const signaturePrefix = "sha256="

// WebhookEvent is the envelope delivered to the webhook endpoint.
// Type is one of inbox.message.created, inbox.message.status, or
// conversation.updated. Payload holds the typed event body as raw JSON
// so callers can unmarshal into InboundMessagePayload,
// MessageStatusPayload, or ConversationUpdatedPayload.
type WebhookEvent struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// UnmarshalJSON accepts both {type,payload} and the {event,data} aliases
// used by some Zernio inbox deliveries.
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

	e.Type = aux.Type
	if e.Type == "" {
		e.Type = aux.Event
	}

	e.Payload = aux.Payload
	if len(e.Payload) == 0 {
		e.Payload = aux.Data
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

// ParseWebhookEvent unmarshals a webhook JSON body into a WebhookEvent.
func ParseWebhookEvent(body []byte) (*WebhookEvent, error) {
	if len(body) == 0 {
		return nil, fmt.Errorf("zernio: empty webhook body")
	}

	var event WebhookEvent
	if err := json.Unmarshal(body, &event); err != nil {
		return nil, fmt.Errorf("zernio: parse webhook event: %w", err)
	}
	if event.Type == "" {
		return nil, fmt.Errorf("zernio: webhook event missing type")
	}

	switch event.Type {
	case EventInboxMessageCreated, EventInboxMessageStatus, EventConversationUpdated:
	default:
		// log and ignore unknown event types for forward-compatibility
		log.Printf("[zernio] ignoring unknown webhook event type %q", event.Type)
		return &event, nil
	}

	return &event, nil
}
