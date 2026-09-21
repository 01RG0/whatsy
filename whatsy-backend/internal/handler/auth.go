// Package handler implements the HTTP and WebSocket transport layer.
package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/lib/pq"
	"github.com/whatsy/backend/pkg/utils"
)

var nonAlphanumRe = regexp.MustCompile(`[^a-z0-9]+`)

// slugify converts a display name to a URL-safe lowercase slug.
func slugify(s string) string {
	s = strings.ToLower(s)
	s = nonAlphanumRe.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

// AuthHandler exposes public authentication endpoints for agents.
type AuthHandler struct {
	db         *sql.DB
	jwtSecret  string
}

// NewAuthHandler creates an AuthHandler backed by the given database and JWT secret.
func NewAuthHandler(db *sql.DB, jwtSecret string) *AuthHandler {
	return &AuthHandler{db: db, jwtSecret: jwtSecret}
}

type registerRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

type registerResponse struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	TenantID string `json:"tenantId"`
	Token    string `json:"token"`
}

// Register handles POST /v1/auth/register.
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if req.Email == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email is required"})
		return
	}
	if len(req.Password) < 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password must be at least 8 characters"})
		return
	}

	hash, err := utils.HashPassword(req.Password)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "hash password"})
		return
	}

	// First registrant becomes admin and owns a new tenant workspace.
	// Subsequent registrations join as agents under the default tenant.
	isFirstAgent := false
	var count int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM agents").Scan(&count); err == nil && count == 0 {
		isFirstAgent = true
	}
	targetRole := "agent"
	if isFirstAgent {
		targetRole = "admin"
	}

	// Resolve which tenant to assign this agent to.
	// First agent: create a new tenant. Everyone else: use default tenant.
	var tenantID string
	if isFirstAgent {
		slug := slugify(req.Name)
		if err := h.db.QueryRow(
			`INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`,
			req.Name+"'s Workspace", slug,
		).Scan(&tenantID); err != nil {
			// Slug collision: append random suffix.
			if err2 := h.db.QueryRow(
				`INSERT INTO tenants (name, slug) VALUES ($1, $2 || '-' || substr(md5(random()::text), 1, 6)) RETURNING id`,
				req.Name+"'s Workspace", slug,
			).Scan(&tenantID); err2 != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "create workspace"})
				return
			}
		}
	} else {
		// Default tenant for standalone deployments (single workspace).
		if err := h.db.QueryRow(
			`SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1`,
		).Scan(&tenantID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "resolve workspace"})
			return
		}
	}

	var id, name, email, role string
	err = h.db.QueryRow(
		`INSERT INTO agents (id, name, email, password_hash, role, avatar, tenant_id)
		 VALUES (gen_random_uuid(), $1, $2, $3, $4, '', $5)
		 RETURNING id, name, email, role`,
		req.Name, req.Email, hash, targetRole, tenantID,
	).Scan(&id, &name, &email, &role)
	if err != nil {
		if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "email already registered"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "register agent"})
		return
	}

	// Set tenant owner after agent row exists.
	if isFirstAgent {
		_, _ = h.db.Exec(`UPDATE tenants SET owner_id = $1 WHERE id = $2`, id, tenantID)
	}

	// Start the first session for this new agent.
	var sessionVersion int64
	if err := h.db.QueryRow(
		`UPDATE agents SET session_version = session_version + 1 WHERE id = $1 RETURNING session_version`, id,
	).Scan(&sessionVersion); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "create session"})
		return
	}

	token, err := utils.GenerateToken(h.jwtSecret, id, name, role, sessionVersion)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "generate token"})
		return
	}

	writeJSON(w, http.StatusCreated, registerResponse{
		ID: id, Name: name, Email: email, Role: role, TenantID: tenantID, Token: token,
	})
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResponse struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	Avatar   string `json:"avatar"`
	TenantID string `json:"tenantId"`
	Token    string `json:"token"`
}

// Login handles POST /v1/auth/login.
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	var id, name, email, role, avatar, passwordHash string
	var tenantIDPtr *string
	err := h.db.QueryRow(
		`SELECT id, name, email, password_hash, role, avatar, tenant_id::text FROM agents WHERE email = $1`,
		req.Email,
	).Scan(&id, &name, &email, &passwordHash, &role, &avatar, &tenantIDPtr)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}
	tenantID := ""
	if tenantIDPtr != nil {
		tenantID = *tenantIDPtr
	}

	if !utils.CheckPassword(req.Password, passwordHash) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}

	// Read current session version — do NOT increment on login so other devices stay valid.
	// session_version is only incremented on explicit "log out all devices" action.
	var sessionVersion int64
	if err := h.db.QueryRow(
		`SELECT session_version FROM agents WHERE id = $1`, id,
	).Scan(&sessionVersion); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "create session"})
		return
	}

	token, err := utils.GenerateToken(h.jwtSecret, id, name, role, sessionVersion)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "generate token"})
		return
	}

	writeJSON(w, http.StatusOK, loginResponse{
		ID: id, Name: name, Email: email, Role: role, Avatar: avatar, TenantID: tenantID, Token: token,
	})
}