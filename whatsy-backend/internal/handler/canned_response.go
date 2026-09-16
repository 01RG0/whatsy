package handler

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
)

// CannedResponseHandler serves reusable message responses.
type CannedResponseHandler struct {
	db *sql.DB
}

// NewCannedResponseHandler creates a canned response handler.
func NewCannedResponseHandler(db *sql.DB) *CannedResponseHandler {
	return &CannedResponseHandler{db: db}
}

type cannedResponse struct {
	ID       string `json:"id"`
	Shortcut string `json:"shortcut"`
	Content  string `json:"content"`
}

type createCannedResponseRequest struct {
	Shortcut string `json:"shortcut"`
	Content  string `json:"content"`
}

// List returns canned responses ordered by shortcut.
func (h *CannedResponseHandler) List(w http.ResponseWriter, r *http.Request) {
	responses, err := h.query(r, `SELECT id, shortcut, content FROM canned_responses ORDER BY shortcut`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list canned responses"})
		return
	}
	writeJSON(w, http.StatusOK, responses)
}

// Search returns canned responses whose shortcut contains q.
func (h *CannedResponseHandler) Search(w http.ResponseWriter, r *http.Request) {
	responses, err := h.query(r, `SELECT id, shortcut, content FROM canned_responses WHERE shortcut ILIKE '%' || $1 || '%' ORDER BY shortcut`, r.URL.Query().Get("q"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "search canned responses"})
		return
	}
	writeJSON(w, http.StatusOK, responses)
}

// Create stores a new canned response.
func (h *CannedResponseHandler) Create(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	var request createCannedResponseRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	if _, err := h.db.ExecContext(r.Context(), `INSERT INTO canned_responses (id, shortcut, content) VALUES (gen_random_uuid(), $1, $2)`, request.Shortcut, request.Content); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "create canned response"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (h *CannedResponseHandler) query(r *http.Request, query string, args ...any) ([]cannedResponse, error) {
	rows, err := h.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	responses := make([]cannedResponse, 0)
	for rows.Next() {
		var response cannedResponse
		if err := rows.Scan(&response.ID, &response.Shortcut, &response.Content); err != nil {
			return nil, err
		}
		responses = append(responses, response)
	}
	return responses, rows.Err()
}
