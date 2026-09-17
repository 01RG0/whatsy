package handler

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
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

// TeamStats returns aggregated team KPIs.
func (h *AgentHandler) TeamStats(w http.ResponseWriter, r *http.Request) {
	var totalAgents int
	if err := h.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM agents").Scan(&totalAgents); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "stats"})
		return
	}
	var messagesToday int
	h.db.QueryRowContext(r.Context(),
		"SELECT COUNT(*) FROM messages WHERE direction='outbound' AND timestamp >= NOW() - INTERVAL '24 hours'",
	).Scan(&messagesToday) //nolint:errcheck — zero is a safe default

	writeJSON(w, http.StatusOK, map[string]any{
		"totalAgents":     totalAgents,
		"onlineNow":       0,
		"messagesToday":   messagesToday,
		"avgResponseTime": "—",
	})
}

// InviteAgent creates a new agent account directly with the provided (or auto-generated) password.
func (h *AgentHandler) InviteAgent(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var req struct {
		Email    string `json:"email"`
		Role     string `json:"role"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if req.Email == "" || req.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email and name are required"})
		return
	}
	if req.Role == "" {
		req.Role = "agent"
	}
	if req.Password == "" {
		req.Password = randomPassword(12)
	}
	if len(req.Password) < 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password must be at least 8 characters"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "hash password"})
		return
	}

	var a agent
	err = h.db.QueryRowContext(r.Context(),
		`INSERT INTO agents (name, email, password_hash, role)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id::text, name, email, role, avatar, created_at`,
		req.Name, req.Email, string(hash), req.Role,
	).Scan(&a.ID, &a.Name, &a.Email, &a.Role, &a.Avatar, &a.CreatedAt)
	if err != nil {
		if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "email already exists"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "create agent"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"agent": a})
}

// UpdateAgent updates any agent's role/name/avatar (admin operation).
func (h *AgentHandler) UpdateAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	defer r.Body.Close()
	var req struct {
		Name   *string `json:"name"`
		Avatar *string `json:"avatar"`
		Role   *string `json:"role"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	res, err := h.db.ExecContext(r.Context(),
		`UPDATE agents SET
			name   = COALESCE($1, name),
			avatar = COALESCE($2, avatar),
			role   = COALESCE($3, role),
			updated_at = NOW()
		 WHERE id = $4`,
		req.Name, req.Avatar, req.Role, id,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "update agent"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return
	}
	h.getByID(w, r, id)
}

// DeleteAgent permanently removes an agent (cannot delete yourself).
func (h *AgentHandler) DeleteAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	claims, ok := ClaimsFromContext(r.Context())
	if ok && claims.AgentID == id {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot delete yourself"})
		return
	}
	res, err := h.db.ExecContext(r.Context(), "DELETE FROM agents WHERE id = $1", id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "delete agent"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "agent removed"})
}

const passwordChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

func randomPassword(n int) string {
	b := make([]byte, n)
	for i := range b {
		idx, _ := rand.Int(rand.Reader, big.NewInt(int64(len(passwordChars))))
		b[i] = passwordChars[idx.Int64()]
	}
	return string(b)
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
