package handler

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"

	"github.com/lib/pq"
	"github.com/go-chi/chi/v5"
)

// AutoReplyHandler exposes CRUD endpoints for auto-reply rules.
type AutoReplyHandler struct {
	db *sql.DB
}

// NewAutoReplyHandler creates an AutoReplyHandler backed by the given database.
func NewAutoReplyHandler(db *sql.DB) *AutoReplyHandler {
	return &AutoReplyHandler{db: db}
}

type autoReplyRule struct {
	ID        string `json:"id"`
	Trigger   string `json:"trigger"`
	TriggerType string `json:"trigger_type"`
	Response  string `json:"response"`
	IsActive  bool   `json:"is_active"`
	Priority  int    `json:"priority"`
	CreatedAt string `json:"createdAt"`
}

type createAutoReplyRuleRequest struct {
	Trigger    string `json:"trigger"`
	TriggerType string `json:"trigger_type"`
	Response   string `json:"response"`
	Priority   int    `json:"priority"`
	IsActive   bool   `json:"is_active"`
}

// List handles GET /v1/auto-reply-rules.
func (h *AutoReplyHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.QueryContext(r.Context(), `SELECT id, trigger, trigger_type, response, is_active, priority, created_at FROM auto_reply_rules ORDER BY priority ASC`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list auto-reply rules"})
		return
	}
	defer rows.Close()

	rules := make([]autoReplyRule, 0)
	for rows.Next() {
		var rule autoReplyRule
		var createdAt string
		if err := rows.Scan(&rule.ID, &rule.Trigger, &rule.TriggerType, &rule.Response, &rule.IsActive, &rule.Priority, &createdAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "scan auto-reply rule"})
			return
		}
		rule.CreatedAt = createdAt
		rules = append(rules, rule)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list auto-reply rules"})
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

// Create handles POST /v1/auto-reply-rules.
func (h *AutoReplyHandler) Create(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	var req createAutoReplyRuleRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	var rule autoReplyRule
	var createdAt string
	err := h.db.QueryRow(
		`INSERT INTO auto_reply_rules (trigger, trigger_type, response, is_active, priority)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, trigger, trigger_type, response, is_active, priority, created_at`,
		req.Trigger, req.TriggerType, req.Response, req.IsActive, req.Priority,
	).Scan(&rule.ID, &rule.Trigger, &rule.TriggerType, &rule.Response, &rule.IsActive, &rule.Priority, &createdAt)
	if err != nil {
		if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "trigger already exists"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "create auto-reply rule"})
		return
	}
	rule.CreatedAt = createdAt
	writeJSON(w, http.StatusCreated, rule)
}

// Update handles PATCH /v1/auto-reply-rules/{id}.
func (h *AutoReplyHandler) Update(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	var req createAutoReplyRuleRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	id := chi.URLParam(r, "id")
	var rule autoReplyRule
	var createdAt string
	err := h.db.QueryRow(
		`UPDATE auto_reply_rules SET response = $1, is_active = $2 WHERE id = $3
		 RETURNING id, trigger, trigger_type, response, is_active, priority, created_at`,
		req.Response, req.IsActive, id,
	).Scan(&rule.ID, &rule.Trigger, &rule.TriggerType, &rule.Response, &rule.IsActive, &rule.Priority, &createdAt)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "auto-reply rule not found"})
		return
	}
	rule.CreatedAt = createdAt
	writeJSON(w, http.StatusOK, rule)
}

// Delete handles DELETE /v1/auto-reply-rules/{id}.
func (h *AutoReplyHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.db.ExecContext(r.Context(), `DELETE FROM auto_reply_rules WHERE id = $1`, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "delete auto-reply rule"})
		return
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "auto-reply rule not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}