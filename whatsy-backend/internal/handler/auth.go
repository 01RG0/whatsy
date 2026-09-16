// Package handler implements the HTTP and WebSocket transport layer.
package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/lib/pq"
	"github.com/whatsy/backend/pkg/utils"
)

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

	var id, name, email, role string
	err = h.db.QueryRow(
		`INSERT INTO agents (id, name, email, password_hash, role, avatar)
		 VALUES (gen_random_uuid(), $1, $2, $3, $4, '')
		 RETURNING id, name, email, role`,
		req.Name, req.Email, hash, req.Role,
	).Scan(&id, &name, &email, &role)
	if err != nil {
		if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "email already registered"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "register agent"})
		return
	}

	token, err := utils.GenerateToken(h.jwtSecret, id, name, role)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "generate token"})
		return
	}

	writeJSON(w, http.StatusCreated, registerResponse{
		ID: id, Name: name, Email: email, Role: role, Token: token,
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
	err := h.db.QueryRow(
		`SELECT id, name, email, password_hash, role, avatar FROM agents WHERE email = $1`,
		req.Email,
	).Scan(&id, &name, &email, &passwordHash, &role, &avatar)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}

	if !utils.CheckPassword(req.Password, passwordHash) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}

	token, err := utils.GenerateToken(h.jwtSecret, id, name, role)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "generate token"})
		return
	}

	writeJSON(w, http.StatusOK, loginResponse{
		ID: id, Name: name, Email: email, Role: role, Avatar: avatar, Token: token,
	})
}