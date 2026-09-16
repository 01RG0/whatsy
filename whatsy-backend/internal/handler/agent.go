package handler

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

// AgentHandler serves agent profile endpoints.
type AgentHandler struct {
	db *sql.DB
}

// NewAgentHandler creates an AgentHandler backed by db.
func NewAgentHandler(db *sql.DB) *AgentHandler {
	return &AgentHandler{db: db}
}

type agent struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	Avatar    string    `json:"avatar"`
	CreatedAt time.Time `json:"createdAt"`
}

type updateCurrentAgentRequest struct {
	Name   *string `json:"name"`
	Avatar *string `json:"avatar"`
}

const agentColumns = "id::text, name, email, role, avatar, created_at"

// List returns all agents ordered by name.
func (h *AgentHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.QueryContext(r.Context(), "SELECT "+agentColumns+" FROM agents ORDER BY name")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list agents"})
		return
	}
	defer rows.Close()

	agents := make([]agent, 0)
	for rows.Next() {
		var a agent
		if err := rows.Scan(&a.ID, &a.Name, &a.Email, &a.Role, &a.Avatar, &a.CreatedAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list agents"})
			return
		}
		agents = append(agents, a)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list agents"})
		return
	}
	writeJSON(w, http.StatusOK, agents)
}

// Me returns the authenticated agent.
func (h *AgentHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	h.getByID(w, r, claims.AgentID)
}

// UpdateMe updates the authenticated agent's name and/or avatar.
func (h *AgentHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	defer r.Body.Close()

	var request updateCurrentAgentRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if request.Name == nil && request.Avatar == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name or avatar is required"})
		return
	}

	_, err := h.db.ExecContext(r.Context(), `UPDATE agents
		SET name = COALESCE($1, name), avatar = COALESCE($2, avatar), updated_at = NOW()
		WHERE id = $3`, request.Name, request.Avatar, claims.AgentID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "update agent"})
		return
	}
	h.getByID(w, r, claims.AgentID)
}

// Get returns an agent by id.
func (h *AgentHandler) Get(w http.ResponseWriter, r *http.Request) {
	h.getByID(w, r, chi.URLParam(r, "id"))
}

func (h *AgentHandler) getByID(w http.ResponseWriter, r *http.Request, id string) {
	var a agent
	err := h.db.QueryRowContext(r.Context(), "SELECT "+agentColumns+" FROM agents WHERE id = $1", id).
		Scan(&a.ID, &a.Name, &a.Email, &a.Role, &a.Avatar, &a.CreatedAt)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "get agent"})
		return
	}
	writeJSON(w, http.StatusOK, a)
}
