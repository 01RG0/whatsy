// Package handler implements the HTTP and WebSocket transport layer.
package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/whatsy/backend/internal/config"
	"github.com/whatsy/backend/internal/eventlog"
	"github.com/whatsy/backend/internal/presence"
	"github.com/whatsy/backend/internal/repository"
	"github.com/whatsy/backend/internal/service"
	ws "github.com/whatsy/backend/internal/websocket"
	"github.com/whatsy/backend/internal/zernio"
	"nhooyr.io/websocket"
)

type Handler struct {
	db          *sql.DB
	convRepo    *repository.ConversationRepo
	msgRepo     *repository.MessageRepo
	chatService *service.ChatService
	hub         *ws.Hub
	presenceMgr *presence.Manager
	cfg         *config.Config
}

func New(db *sql.DB, convRepo *repository.ConversationRepo, msgRepo *repository.MessageRepo, chatService *service.ChatService, hub *ws.Hub, presenceMgr *presence.Manager, cfg *config.Config) *Handler {
	return &Handler{db: db, convRepo: convRepo, msgRepo: msgRepo, chatService: chatService, hub: hub, presenceMgr: presenceMgr, cfg: cfg}
}

func (h *Handler) ListConversations(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, max-age=10")
	claims, _ := ClaimsFromContext(r.Context())
	tenantID, ok := TenantIDFromContext(r.Context())
	if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "workspace missing"}); return }
	accountID := ""
	if claims != nil {
		accountID = claims.AgentID
	}
	// "platform" is accepted for API compatibility but is a platform name, not
	// an agent id; it must not overwrite the assigned_to_me filter key.
	_ = r.URL.Query().Get("platform")

	conversations, err := h.convRepo.ListForTenant(r.Context(), tenantID, accountID, r.URL.Query().Get("filter"), r.URL.Query().Get("search"), r.URL.Query().Get("search_type"), r.URL.Query().Get("label"), queryLimit(r, 100), r.URL.Query().Get("before"))
	if err != nil {
		log.Printf("[error] list conversations: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list conversations"})
		return
	}
	writeJSON(w, http.StatusOK, conversations)
}

func (h *Handler) GetMessages(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	tenantID, ok := TenantIDFromContext(r.Context())
	if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "workspace missing"}); return }
	convID := chi.URLParam(r, "id")
	messages, err := h.msgRepo.ListByConversationForTenant(r.Context(), tenantID, convID, queryLimit(r, 100), r.URL.Query().Get("before"))
	if err != nil {
		log.Printf("list messages for conversation %s: %v", convID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list messages"})
		return
	}

	// If no messages exist in local DB (e.g. older conversation where worker only synced metadata),
	// fetch message history on-demand from Zernio and reload.
	if len(messages) == 0 && r.URL.Query().Get("before") == "" {
		var zernioConvID, accountID string
		_ = h.db.QueryRowContext(r.Context(),
			`SELECT COALESCE(c.zernio_conversation_id, ''),
			        COALESCE(wc.account_id, '')
			 FROM conversations c
			 LEFT JOIN whatsapp_connections wc ON (wc.tenant_id = c.tenant_id OR c.tenant_id IS NULL) AND wc.status = 'connected'
			 WHERE c.id = $1::uuid
			 ORDER BY wc.id DESC LIMIT 1`,
			convID,
		).Scan(&zernioConvID, &accountID)

		if zernioConvID != "" {
			h.syncConversationOnDemand(r.Context(), tenantID, convID, zernioConvID, accountID)
			if reloaded, err := h.msgRepo.ListByConversationForTenant(r.Context(), tenantID, convID, queryLimit(r, 100), ""); err == nil && len(reloaded) > 0 {
				messages = reloaded
			}
		}
	}

	writeJSON(w, http.StatusOK, messages)
}

// SearchMessages returns messages matching q, newest first, together with
// the participant information for each message's conversation.
func (h *Handler) SearchMessages(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := TenantIDFromContext(r.Context())
	if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "workspace missing"}); return }
	query := r.URL.Query().Get("q")
	if len([]rune(query)) < 2 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "q must be at least 2 characters"})
		return
	}

	convID := strings.TrimSpace(r.URL.Query().Get("conversation_id"))
	if convID == "" {
		convID = strings.TrimSpace(r.URL.Query().Get("conversationId"))
	}

	var searchQuery string
	var args []any
	limit := queryLimit(r, 20)

	if convID != "" {
		searchQuery = `SELECT m.id, m.conversation_id, m.content, m.direction, m.timestamp,
			s.name AS student_name, s.phone AS student_phone
			FROM messages m
			JOIN conversations c ON c.id = m.conversation_id
			JOIN students s ON s.id = c.student_id
			WHERE c.tenant_id = $1::uuid AND m.conversation_id = $2::uuid AND m.content ILIKE '%' || $3 || '%'
			ORDER BY m.timestamp DESC
			LIMIT $4`
		args = []any{tenantID, convID, query, limit}
	} else {
		searchQuery = `SELECT m.id, m.conversation_id, m.content, m.direction, m.timestamp,
			s.name AS student_name, s.phone AS student_phone
			FROM messages m
			JOIN conversations c ON c.id = m.conversation_id
			JOIN students s ON s.id = c.student_id
			WHERE c.tenant_id = $1::uuid AND m.content ILIKE '%' || $2 || '%'
			ORDER BY m.timestamp DESC
			LIMIT $3`
		args = []any{tenantID, query, limit}
	}

	rows, err := h.db.QueryContext(r.Context(), searchQuery, args...)
	if err != nil {
		log.Printf("[error] search messages: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "search messages"})
		return
	}
	defer rows.Close()

	type searchResult struct {
		ID             string `json:"id"`
		ConversationID string `json:"conversationId"`
		Content        string `json:"content"`
		Direction      string `json:"direction"`
		Timestamp      any    `json:"timestamp"`
		StudentName    string `json:"studentName"`
		StudentPhone   string `json:"studentPhone"`
	}
	results := make([]searchResult, 0)
	for rows.Next() {
		var result searchResult
		if err := rows.Scan(&result.ID, &result.ConversationID, &result.Content, &result.Direction, &result.Timestamp, &result.StudentName, &result.StudentPhone); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "search messages"})
			return
		}
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "search messages"})
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *Handler) SendMessage(w http.ResponseWriter, r *http.Request) {
	if !h.requireConversationTenant(w, r, chi.URLParam(r, "id")) { return }
	defer r.Body.Close()
	var payload zernio.SendMessagePayload
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	agentID := ""
	if claims, ok := ClaimsFromContext(r.Context()); ok {
		agentID = claims.AgentID
	}
	tenantID, _ := TenantIDFromContext(r.Context())

	message, err := h.chatService.SendOutboundMessage(r.Context(), chi.URLParam(r, "id"), payload, agentID, tenantID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "send message"})
		return
	}
	writeJSON(w, http.StatusCreated, message)
}

func (h *Handler) MarkRead(w http.ResponseWriter, r *http.Request) {
	if !h.requireConversationTenant(w, r, chi.URLParam(r, "id")) { return }
	tenantID, _ := TenantIDFromContext(r.Context())
	if err := h.chatService.MarkConversationRead(r.Context(), chi.URLParam(r, "id"), tenantID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "mark conversation read"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) MarkUnread(w http.ResponseWriter, r *http.Request) {
	if !h.requireConversationTenant(w, r, chi.URLParam(r, "id")) { return }
	if err := h.chatService.MarkConversationUnread(r.Context(), chi.URLParam(r, "id")); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "mark conversation unread"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}


// AssignConversation assigns an agent to a conversation and notifies all clients.
func (h *Handler) AssignConversation(w http.ResponseWriter, r *http.Request) {
	if !h.requireConversationTenant(w, r, chi.URLParam(r, "id")) { return }
	defer r.Body.Close()
	var payload struct {
		AgentID string `json:"agentId"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	// Empty agentId means unassign.

	conversationID := chi.URLParam(r, "id")
	updated, err := h.convRepo.AssignAgent(r.Context(), conversationID, payload.AgentID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "assign conversation"})
		return
	}
	if !updated {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "conversation not found"})
		return
	}

	conversation, err := h.convRepo.GetByID(r.Context(), conversationID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "get conversation"})
		return
	}
	if conversation == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "conversation not found"})
		return
	}
	h.hub.BroadcastToAll(ws.ConversationUpdatedEvent{Event: ws.EventConversationUpdated, Conversation: *conversation})
	writeJSON(w, http.StatusOK, conversation)
}

func (h *Handler) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "read webhook body"})
		return
	}
	// Only validate HMAC when a secret is configured. If no secret is set,
	// webhooks are accepted without verification (development / initial setup).
	if h.cfg != nil && h.cfg.ZernioWebhookSecret != "" {
		signature := r.Header.Get("X-Zernio-Signature")
		if signature == "" {
			signature = r.Header.Get("X-Hub-Signature-256")
		}
		if !zernio.ValidateSignature([]byte(h.cfg.ZernioWebhookSecret), body, signature) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid signature"})
			return
		}
	}

	event, err := zernio.ParseWebhookEventWithType(body, r.Header.Get("X-Zernio-Event"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid webhook event"})
		return
	}

	switch event.Type {
	case zernio.EventInboxMessageCreated, zernio.LegacyEventInboxMessageCreated:
		var payload zernio.InboundMessagePayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			eventlog.WebhookError(event.Type, err)
		} else if payload.ConversationID == "" {
			eventlog.WebhookError(event.Type, fmt.Errorf("missing conversationId"))
		} else {
			eventlog.Webhook(event.Type, payload.ConversationID)
			eventlog.TraceStep1WebhookHit(payload.MessageID, payload.ConversationID)
			if err := h.chatService.HandleInboundMessage(r.Context(), payload); err != nil {
				eventlog.WebhookError(event.Type, err)
			}
		}
	case zernio.EventInboxMessageSent:
		var payload zernio.InboundMessagePayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			eventlog.WebhookError(event.Type, err)
		} else if payload.ConversationID == "" {
			eventlog.WebhookError(event.Type, fmt.Errorf("missing conversationId"))
		} else {
			eventlog.Webhook(event.Type, payload.ConversationID)
			if err := h.chatService.HandleInboundMessage(r.Context(), payload); err != nil {
				eventlog.WebhookError(event.Type, err)
			}
		}
	case zernio.EventConversationStarted, zernio.LegacyEventConversationUpdated:
		var payload zernio.ConversationUpdatedPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			eventlog.WebhookError(event.Type, err)
		} else {
			eventlog.Webhook(event.Type, "")
			h.hub.BroadcastToAll(payload)
		}
	case zernio.EventMessageDeleted:
		var payload zernio.MessageDeletedPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			eventlog.WebhookError(event.Type, err)
		} else {
			zernioMsgID := firstNonEmpty(payload.PlatformMessageID, payload.MessageID)
			eventlog.Webhook(event.Type, zernioMsgID)
			localMsgID := zernioMsgID
			if zernioMsgID != "" {
				if msg, err := h.msgRepo.GetByZernioID(r.Context(), zernioMsgID); err == nil && msg != nil {
					localMsgID = msg.ID
				}
				_ = h.msgRepo.MarkRevokedByZernioID(r.Context(), zernioMsgID)
			}
			h.hub.BroadcastToAll(ws.MessageDeletedEvent{
				Event:          ws.EventMessageDeleted,
				MessageID:      localMsgID,
				ConversationID: payload.ConversationID,
			})
		}
	case zernio.EventReactionReceived:
		var payload zernio.ReactionPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			eventlog.WebhookError(event.Type, err)
		} else {
			zernioMsgID := firstNonEmpty(payload.PlatformMessageID, payload.MessageID)
			eventlog.Webhook(event.Type, zernioMsgID)
			localMsgID := zernioMsgID
			if msg, err := h.msgRepo.GetByZernioID(r.Context(), zernioMsgID); err == nil && msg != nil {
				localMsgID = msg.ID
			}
			h.hub.BroadcastToAll(ws.ReactionEvent{
				Event:          ws.EventReaction,
				MessageID:      localMsgID,
				ConversationID: payload.ConversationID,
				Emoji:          payload.Emoji,
			})
		}
	default:
		if zernio.IsStatusEvent(event.Type) {
			var payload zernio.MessageStatusPayload
			if err := json.Unmarshal(event.Payload, &payload); err != nil {
				eventlog.WebhookError(event.Type, err)
			} else {
				// Prefer PlatformMessageID (wamid) — that is what the DB stores as
				// zernio_message_id after the message.sent claim (cd9700c).
				zernioMsgID := firstNonEmpty(payload.PlatformMessageID, payload.MessageID)
				eventlog.Webhook(event.Type, zernioMsgID)
				if err := h.chatService.HandleMessageStatus(r.Context(), payload); err != nil {
					eventlog.WebhookError(event.Type, err)
				}
				// Resolve local message ID so the frontend can match it in the store.
				localMsgID := zernioMsgID
				if msg, err := h.msgRepo.GetByZernioID(r.Context(), zernioMsgID); err == nil && msg != nil {
					localMsgID = msg.ID
				}
				h.hub.BroadcastToAll(ws.MessageStatusEvent{
					Event:     ws.EventMessageStatus,
					MessageID: localMsgID,
					Status:    payload.Status,
				})
			}
		} else {
			eventlog.Webhook(event.Type, "unhandled")
		}
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) ServeWebSocket(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		log.Printf("websocket upgrade: %v", err)
		return
	}
	client := ws.NewClient(h.hub, conn, claims.AgentID, claims.Name, claims.Avatar)
	h.hub.Register(client)
	eventlog.WSConnect(claims.AgentID)
	// The HTTP request context is canceled when this handler returns, which is
	// immediately after the websocket handshake. Use a connection-lifetime
	// context so the pumps remain active until the websocket closes.
	connectionContext := context.Background()
	go client.ReadPump(connectionContext)
	go client.WritePump(connectionContext)
}

func queryLimit(r *http.Request, defaultLimit int) int {
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit <= 0 {
		return defaultLimit
	}
	if limit > 200 {
		return 200
	}
	return limit
}

// requireConversationTenant prevents direct-ID access to another workspace's
// messages or state-changing conversation endpoints.
// RetryFailedMessages resets all outbound messages failed in the last 24h
// back to pending and retries delivery. Returns sent/failed/total counts.
func (h *Handler) RetryFailedMessages(w http.ResponseWriter, r *http.Request) {
	sent, failed, total := h.chatService.RetryFailedMessages(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"total":  total,
		"sent":   sent,
		"failed": failed,
	})
}

func (h *Handler) requireConversationTenant(w http.ResponseWriter, r *http.Request, conversationID string) bool {
	tenantID, ok := TenantIDFromContext(r.Context())
	if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "workspace missing"}); return false }
	var exists bool
	err := h.db.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM conversations WHERE id = $1 AND (tenant_id = $2::uuid OR tenant_id IS NULL))`, conversationID, tenantID).Scan(&exists)
	if err != nil { writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "verify conversation access"}); return false }
	if !exists { writeJSON(w, http.StatusNotFound, map[string]string{"error": "conversation not found"}); return false }
	_, _ = h.db.ExecContext(r.Context(), `UPDATE conversations SET tenant_id = $2::uuid WHERE id = $1 AND tenant_id IS NULL`, conversationID, tenantID)
	return true
}

func (h *Handler) getZernioKey(ctx context.Context, tenantID string) string {
	var value sql.NullString
	_ = h.db.QueryRowContext(ctx,
		`SELECT value FROM workspace_settings WHERE tenant_id = $1 AND key = 'zernio_api_key'`,
		tenantID,
	).Scan(&value)
	if value.Valid && value.String != "" {
		return value.String
	}
	return h.cfg.ZernioAPIKey
}

func (h *Handler) syncConversationOnDemand(ctx context.Context, tenantID, dbConvID, zernioConvID, accountID string) {
	if zernioConvID == "" {
		return
	}
	key := h.getZernioKey(ctx, tenantID)
	if key == "" {
		return
	}

	apiURL := "https://zernio.com/api/v1/inbox/conversations/" + url.PathEscape(zernioConvID) + "/messages?limit=100"
	if accountID != "" {
		apiURL += "&accountId=" + url.QueryEscape(accountID)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		log.Printf("[on-demand-sync] create request failed: %v", err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[on-demand-sync] fetch messages failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("[on-demand-sync] zernio http %d: %s", resp.StatusCode, string(body))
		return
	}

	var pageData struct {
		Messages []struct {
			ID             string          `json:"id"`
			ConversationID string          `json:"conversationId"`
			Message        string          `json:"message"`
			Type           string          `json:"type"`
			Direction      string          `json:"direction"`
			DeliveryStatus string          `json:"deliveryStatus"`
			SentAt         time.Time       `json:"sentAt"`
			CreatedAt      time.Time       `json:"createdAt"`
			Attachments    json.RawMessage `json:"attachments"`
			Contacts       []struct {
				Name struct {
					FormattedName string `json:"formatted_name"`
				} `json:"name"`
				Phones []struct {
					Phone string `json:"phone"`
					WaID  string `json:"wa_id"`
				} `json:"phones"`
			} `json:"contacts"`
			Metadata struct {
				QuotedMessageID string `json:"quotedMessageId"`
			} `json:"metadata"`
		} `json:"messages"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&pageData); err != nil {
		log.Printf("[on-demand-sync] decode messages failed: %v", err)
		return
	}

	for _, msg := range pageData.Messages {
		if msg.ID == "" {
			continue
		}
		direction := "inbound"
		if msg.Direction == "outgoing" {
			direction = "outbound"
		}
		status := msg.DeliveryStatus
		if status == "" {
			status = "sent"
		}
		ts := msg.SentAt
		if ts.IsZero() {
			ts = msg.CreatedAt
		}
		if ts.IsZero() {
			ts = time.Now().UTC()
		}

		contentType := msg.Type
		if contentType == "" {
			var attachList []struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(msg.Attachments, &attachList) == nil && len(attachList) > 0 && attachList[0].Type != "" {
				contentType = attachList[0].Type
			}
		}
		if contentType == "" {
			contentType = "text"
		}

		content := msg.Message
		contactPhone := ""
		if contentType == "contacts" && len(msg.Contacts) > 0 {
			c := msg.Contacts[0]
			if content == "" && c.Name.FormattedName != "" {
				content = c.Name.FormattedName
			}
			if len(c.Phones) > 0 {
				if c.Phones[0].Phone != "" {
					contactPhone = c.Phones[0].Phone
				} else if c.Phones[0].WaID != "" {
					contactPhone = c.Phones[0].WaID
				}
			}
		}

		attachmentsJSON := "[]"
		if len(msg.Attachments) > 0 && string(msg.Attachments) != "null" {
			attachmentsJSON = string(msg.Attachments)
		}

		var replyToJSON any
		if msg.Metadata.QuotedMessageID != "" {
			type replyToPayload struct {
				ID string `json:"id"`
			}
			if b, err := json.Marshal(replyToPayload{ID: msg.Metadata.QuotedMessageID}); err == nil {
				replyToJSON = string(b)
			}
		}

		_, _ = h.db.ExecContext(ctx,
			`INSERT INTO messages
			    (conversation_id, direction, content_type, content, status, zernio_message_id, attachments, timestamp, reply_to, contact_phone)
			 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10)
			 ON CONFLICT (zernio_message_id) DO NOTHING`,
			dbConvID, direction, contentType, content, status, msg.ID, attachmentsJSON, ts, replyToJSON, contactPhone,
		)
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

func queryOffset(r *http.Request, defaultOffset int) int {
	offset, err := strconv.Atoi(r.URL.Query().Get("offset"))
	if err != nil || offset < 0 {
		return defaultOffset
	}
	return offset
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("write JSON response: %v", err)
	}
}
