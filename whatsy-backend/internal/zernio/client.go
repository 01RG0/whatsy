package zernio

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	defaultBaseURL = "https://zernio.com/api/v1"
	defaultTimeout = 30 * time.Second
	maxErrorBody   = 1 << 20 // 1 MiB
)

// Client is an outbound Zernio API client.
type Client struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

// NewClient constructs a Client that talks to https://zernio.com/api/v1.
func NewClient(apiKey string) *Client {
	return &Client{
		apiKey:  apiKey,
		baseURL: defaultBaseURL,
		httpClient: &http.Client{
			Timeout: defaultTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

// Button is a reply button for outbound interactive messages (max 3 per message).
// Mutually exclusive with QuickReplies.
type Button struct {
	Type    string `json:"type"`    // always "postback"
	Title   string `json:"title"`
	Payload string `json:"payload"`
}

// QuickReply is a quick-reply option (max 13 per message).
// Mutually exclusive with Buttons.
type QuickReply struct {
	Type    string `json:"type"`    // always "postback"
	Title   string `json:"title"`
	Payload string `json:"payload"`
}

// InteractiveAction holds the action part of a list/CTA interactive message.
type InteractiveAction struct {
	Button   string               `json:"button,omitempty"`
	Sections []InteractiveSection `json:"sections,omitempty"`
}

// InteractiveSection is a section within a list message.
type InteractiveSection struct {
	Title string           `json:"title,omitempty"`
	Rows  []InteractiveRow `json:"rows,omitempty"`
}

// InteractiveRow is a selectable row within a list section.
type InteractiveRow struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
}

// InteractiveBody holds the body text of an interactive message.
type InteractiveBody struct {
	Text string `json:"text"`
}

// Interactive represents a WhatsApp interactive message (list, CTA URL, flow).
// Set in the `interactive` field of SendMessagePayload.
type Interactive struct {
	Type   string             `json:"type"`             // "list" | "cta_url" | "location_request_message" | "flow"
	Body   *InteractiveBody   `json:"body,omitempty"`
	Action *InteractiveAction `json:"action,omitempty"`
}

// SendMessagePayload is the JSON body for POST /v1/inbox/conversations/{id}/messages.
// accountId is required by the Zernio send-message endpoint; message, or an
// attachment, must be present. attachmentType is one of image, video, audio,
// file. quickReplies and buttons are mutually exclusive (max 13 / max 3).
type SendMessagePayload struct {
	AccountID      string       `json:"accountId"`
	ConversationID string       `json:"conversationId,omitempty"`
	ParticipantID  string       `json:"participantId,omitempty"`
	Message        string       `json:"message"`
	AttachmentURL  string       `json:"attachmentUrl,omitempty"`
	AttachmentType string       `json:"attachmentType,omitempty"` // image, video, audio, file
	AttachmentName string       `json:"attachmentName,omitempty"` // WhatsApp document display name
	VoiceNote      bool         `json:"voiceNote,omitempty"`      // WhatsApp audio -> PTT (.ogg OPUS)
	ReplyTo        string       `json:"replyTo,omitempty"`        // WhatsApp: platform message id (wamid)
	Buttons        []Button     `json:"buttons,omitempty"`        // max 3, mutually exclusive with QuickReplies
	QuickReplies   []QuickReply `json:"quickReplies,omitempty"`   // max 13
	Interactive    *Interactive `json:"interactive,omitempty"`    // list / CTA URL / flow
}

// SentMessage is returned after a successful send.
type SentMessage struct {
	ID        string    `json:"id"`
	Status    string    `json:"status"`
	Timestamp time.Time `json:"timestamp"`
}

// APIError is a non-2xx response from the Zernio API.
type APIError struct {
	StatusCode int
	Message    string
	Body       string
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("zernio: http %d: %s", e.StatusCode, e.Message)
	}
	return fmt.Sprintf("zernio: http %d", e.StatusCode)
}

// SendMessage posts a message to an inbox conversation.
func (c *Client) SendMessage(ctx context.Context, conversationID string, payload SendMessagePayload) (*SentMessage, error) {
	if conversationID == "" {
		return nil, fmt.Errorf("zernio: conversation id is required")
	}
	if payload.ConversationID == "" {
		payload.ConversationID = conversationID
	}

	path := "/inbox/conversations/" + url.PathEscape(conversationID) + "/messages"

	var envelope sendMessageResponse
	if err := c.doJSON(ctx, http.MethodPost, path, payload, &envelope); err != nil {
		return nil, err
	}

	msg := envelope.toSentMessage()
	if msg.ID == "" {
		return nil, fmt.Errorf("zernio: send message: response missing message id")
	}
	return msg, nil
}

// MarkRead marks all unread incoming messages in a conversation as read.
// accountId is a required body field per the Zernio docs.
func (c *Client) MarkRead(ctx context.Context, conversationID, accountID string) error {
	if conversationID == "" {
		return fmt.Errorf("zernio: conversation id is required")
	}
	if accountID == "" {
		return fmt.Errorf("zernio: account id is required")
	}
	path := "/inbox/conversations/" + url.PathEscape(conversationID) + "/read"
	return c.doJSON(ctx, http.MethodPost, path, map[string]string{"accountId": accountID}, nil)
}

// SendTypingIndicator shows a typing indicator in a conversation.
// accountId is a required body field per the Zernio docs. The endpoint is
// best-effort: it returns 200 with success=false when the platform call fails.
func (c *Client) SendTypingIndicator(ctx context.Context, conversationID, accountID string) error {
	if conversationID == "" {
		return fmt.Errorf("zernio: conversation id is required")
	}
	if accountID == "" {
		return fmt.Errorf("zernio: account id is required")
	}
	path := "/inbox/conversations/" + url.PathEscape(conversationID) + "/typing"
	return c.doJSON(ctx, http.MethodPost, path, map[string]string{"accountId": accountID}, nil)
}

// ListWhatsAppFlows returns the flows for a connected WhatsApp account.
func (c *Client) ListWhatsAppFlows(ctx context.Context, accountID string) (map[string]any, error) {
	var response map[string]any
	path := "/whatsapp/flows?accountId=" + url.QueryEscape(accountID)
	if err := c.doJSON(ctx, http.MethodGet, path, nil, &response); err != nil {
		return nil, err
	}
	return response, nil
}

// CreateWhatsAppFlow creates a draft flow.
func (c *Client) CreateWhatsAppFlow(ctx context.Context, accountID, name string, categories []string) (map[string]any, error) {
	var response map[string]any
	err := c.doJSON(ctx, http.MethodPost, "/whatsapp/flows", map[string]any{
		"accountId":  accountID,
		"name":       name,
		"categories": categories,
	}, &response)
	if err != nil {
		return nil, err
	}
	return response, nil
}

// UploadWhatsAppFlowJSON uploads a draft flow definition for Meta validation.
func (c *Client) UploadWhatsAppFlowJSON(ctx context.Context, accountID, flowID string, flowJSON any) (map[string]any, error) {
	var response map[string]any
	err := c.doJSON(ctx, http.MethodPut, "/whatsapp/flows/"+url.PathEscape(flowID)+"/json", map[string]any{
		"accountId": accountID,
		"flow_json": flowJSON,
	}, &response)
	if err != nil {
		return nil, err
	}
	return response, nil
}

// PreviewWhatsAppFlow returns a public preview URL for a draft or published flow.
func (c *Client) PreviewWhatsAppFlow(ctx context.Context, accountID, flowID string) (map[string]any, error) {
	var response map[string]any
	path := "/whatsapp/flows/" + url.PathEscape(flowID) + "/preview?accountId=" + url.QueryEscape(accountID)
	if err := c.doJSON(ctx, http.MethodGet, path, nil, &response); err != nil {
		return nil, err
	}
	return response, nil
}

// PublishWhatsAppFlow publishes a validated draft. Published flows are immutable.
func (c *Client) PublishWhatsAppFlow(ctx context.Context, accountID, flowID string) (map[string]any, error) {
	var response map[string]any
	err := c.doJSON(ctx, http.MethodPost, "/whatsapp/flows/"+url.PathEscape(flowID)+"/publish", map[string]string{"accountId": accountID}, &response)
	if err != nil {
		return nil, err
	}
	return response, nil
}

type sendMessageResponse struct {
	Success   bool      `json:"success"`
	ID        string    `json:"id"`
	MessageID string    `json:"messageId"`
	Status    string    `json:"status"`
	Timestamp time.Time `json:"timestamp"`
	Data      struct {
		MessageID      string    `json:"messageId"`
		ID             string    `json:"id"`
		Status         string    `json:"status"`
		Timestamp      time.Time `json:"timestamp"`
		ConversationID string    `json:"conversationId"`
	} `json:"data"`
}

func (r sendMessageResponse) toSentMessage() *SentMessage {
	id := firstNonEmpty(r.Data.MessageID, r.Data.ID, r.MessageID, r.ID)
	status := r.Data.Status
	if status == "" {
		status = r.Status
	}
	if status == "" {
		status = "sent"
	}
	ts := r.Data.Timestamp
	if ts.IsZero() {
		ts = r.Timestamp
	}
	if ts.IsZero() {
		ts = time.Now().UTC()
	}
	return &SentMessage{ID: id, Status: status, Timestamp: ts}
}

// PatchContactTags overwrites the tags array on a Zernio contact. This is
// best-effort: callers should fire it in a goroutine and ignore errors.
func (c *Client) PatchContactTags(ctx context.Context, zernioContactID string, tags []string) error {
	if zernioContactID == "" {
		return nil
	}
	if tags == nil {
		tags = []string{}
	}
	return c.doJSON(ctx, "PATCH", "/contacts/"+url.PathEscape(zernioContactID), map[string]any{"tags": tags}, nil)
}

func (c *Client) doJSON(ctx context.Context, method, path string, body any, dest any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("zernio: marshal request: %w", err)
		}
		rdr = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.endpoint(path), rdr)
	if err != nil {
		return fmt.Errorf("zernio: create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("zernio: request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxErrorBody))
	if err != nil {
		return fmt.Errorf("zernio: read response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return newAPIError(resp.StatusCode, respBody)
	}

	if dest == nil || len(respBody) == 0 {
		return nil
	}
	if err := json.Unmarshal(respBody, dest); err != nil {
		return fmt.Errorf("zernio: decode response: %w", err)
	}
	return nil
}

func (c *Client) endpoint(path string) string {
	return strings.TrimRight(c.baseURL, "/") + path
}

func newAPIError(status int, body []byte) *APIError {
	apiErr := &APIError{StatusCode: status, Body: string(body)}
	var envelope struct {
		Error   string `json:"error"`
		Message string `json:"message"`
		Code    string `json:"code"`
	}
	if json.Unmarshal(body, &envelope) == nil {
		apiErr.Message = firstNonEmpty(envelope.Error, envelope.Message, envelope.Code)
	}
	return apiErr
}

// EnsureWebhookActive fetches webhook settings and re-enables any that are
// inactive. Called on server startup so deploys that cause consecutive failures
// don't permanently silence inbound messages.
func (c *Client) EnsureWebhookActive(ctx context.Context) error {
	var resp struct {
		Webhooks []struct {
			ID       string `json:"_id"`
			Name     string `json:"name"`
			URL      string `json:"url"`
			IsActive bool   `json:"isActive"`
		} `json:"webhooks"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/webhooks/settings", nil, &resp); err != nil {
		return fmt.Errorf("list webhooks: %w", err)
	}
	for _, wh := range resp.Webhooks {
		if wh.IsActive {
			continue
		}
		body := map[string]interface{}{"_id": wh.ID, "isActive": true}
		if err := c.doJSON(ctx, http.MethodPut, "/webhooks/settings", body, nil); err != nil {
			return fmt.Errorf("re-enable webhook %s (%s): %w", wh.Name, wh.ID, err)
		}
		fmt.Printf("[startup] re-enabled disabled webhook %q (%s)\n", wh.Name, wh.URL)
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
