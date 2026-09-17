// Package handler implements the HTTP and WebSocket transport layer.
package handler

import (
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/whatsy/backend/internal/config"
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
	claims, _ := ClaimsFromContext(r.Context())
	accountID := ""
	if claims != nil {
		accountID = claims.AgentID
	}
	// "platform" is accepted for API compatibility but is a platform name, not
	// an agent id; it must not overwrite the assigned_to_me filter key.
	_ = r.URL.Query().Get("platform")

	conversations, err := h.convRepo.List(r.Context(), accountID, r.URL.Query().Get("filter"), r.URL.Query().Get("search"), queryLimit(r, 50))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list conversations"})
		return
	}
	writeJSON(w, http.StatusOK, conversations)
}

func (h *Handler) GetMessages(w http.ResponseWriter, r *http.Request) {
	messages, err := h.msgRepo.ListByConversation(r.Context(), chi.URLParam(r, "id"), queryLimit(r, 100), r.URL.Query().Get("before"))
	if err != nil {
		log.Printf("list messages for conversation %s: %v", chi.URLParam(r, "id"), err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list messages"})
		return
	}
	writeJSON(w, http.StatusOK, messages)
}

// SearchMessages returns messages matching q, newest first, together with
// the participant information for each message's conversation.
func (h *Handler) SearchMessages(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if len([]rune(query)) < 2 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "q must be at least 2 characters"})
		return
	}

	const searchQuery = `SELECT m.id, m.conversation_id, m.content, m.direction, m.timestamp,
		s.name AS student_name, s.phone AS student_phone
		FROM messages m
		JOIN conversations c ON c.id = m.conversation_id
		JOIN students s ON s.id = c.student_id
		WHERE m.content ILIKE '%' || $1 || '%'
		ORDER BY m.timestamp DESC
		LIMIT $2`
	rows, err := h.db.QueryContext(r.Context(), searchQuery, query, queryLimit(r, 20))
	if err != nil {
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

	message, err := h.chatService.SendOutboundMessage(r.Context(), chi.URLParam(r, "id"), payload, agentID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "send message"})
		return
	}
	writeJSON(w, http.StatusCreated, message)
}

func (h *Handler) MarkRead(w http.ResponseWriter, r *http.Request) {
	if err := h.chatService.MarkConversationRead(r.Context(), chi.URLParam(r, "id")); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "mark conversation read"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// AssignConversation assigns an agent to a conversation and notifies all clients.
func (h *Handler) AssignConversation(w http.ResponseWriter, r *http.Request) {
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
		if !zernio.ValidateSignature([]byte(h.cfg.ZernioWebhookSecret), body, r.Header.Get("x-hub-signature-256")) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid signature"})
			return
		}
	}

	event, err := zernio.ParseWebhookEvent(body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid webhook event"})
		return
	}

	switch event.Type {
	case zernio.EventInboxMessageCreated, zernio.LegacyEventInboxMessageCreated:
		var payload zernio.InboundMessagePayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			log.Printf("webhook: decode inbound message: %v", err)
		} else if payload.ConversationID == "" {
			log.Printf("webhook: inbound message missing conversationId")
		} else if err := h.chatService.HandleInboundMessage(r.Context(), payload); err != nil {
			log.Printf("webhook: handle inbound message: %v", err)
		}
	case zernio.EventInboxMessageSent:
		// Outgoing echo: the send endpoint already persisted the message.
	case zernio.EventConversationStarted, zernio.LegacyEventConversationUpdated:
		var payload zernio.ConversationUpdatedPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			log.Printf("webhook: decode conversation update: %v", err)
		} else {
			h.hub.BroadcastToAll(payload)
		}
	default:
		if zernio.IsStatusEvent(event.Type) {
			var payload zernio.MessageStatusPayload
			if err := json.Unmarshal(event.Payload, &payload); err != nil {
				log.Printf("webhook: decode message status: %v", err)
			} else if err := h.chatService.HandleMessageStatus(r.Context(), payload); err != nil {
				log.Printf("webhook: update message status: %v", err)
			} else {
				h.hub.BroadcastToAll(ws.MessageStatusEvent{
					Event:     ws.EventMessageStatus,
					MessageID: firstNonEmpty(payload.PlatformMessageID, payload.MessageID),
					Status:    payload.Status,
				})
			}
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
	go client.ReadPump(r.Context())
	go client.WritePump(r.Context())
}

func queryLimit(r *http.Request, defaultLimit int) int {
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit <= 0 {
		return defaultLimit
	}
	return limit
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
