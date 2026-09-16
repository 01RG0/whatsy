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

// SendMessagePayload is the JSON body for POST .../messages.
type SendMessagePayload struct {
	AccountID      string   `json:"accountId"`
	ConversationID string   `json:"conversationId,omitempty"`
	ParticipantID  string   `json:"participantId,omitempty"`
	Message        string   `json:"message"`
	AttachmentURL  string   `json:"attachmentUrl,omitempty"`
	AttachmentType string   `json:"attachmentType,omitempty"`
	AttachmentName string   `json:"attachmentName,omitempty"`
	VoiceNote      bool     `json:"voiceNote,omitempty"`
	ReplyTo        string   `json:"replyTo,omitempty"`
	Buttons        []string `json:"buttons,omitempty"`
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
func (c *Client) MarkRead(ctx context.Context, conversationID string) error {
	if conversationID == "" {
		return fmt.Errorf("zernio: conversation id is required")
	}
	path := "/inbox/conversations/" + url.PathEscape(conversationID) + "/read"
	return c.doJSON(ctx, http.MethodPost, path, struct{}{}, nil)
}

// SendTypingIndicator shows a typing indicator in a conversation.
func (c *Client) SendTypingIndicator(ctx context.Context, conversationID string) error {
	if conversationID == "" {
		return fmt.Errorf("zernio: conversation id is required")
	}
	path := "/inbox/conversations/" + url.PathEscape(conversationID) + "/typing"
	return c.doJSON(ctx, http.MethodPost, path, struct{}{}, nil)
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

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
