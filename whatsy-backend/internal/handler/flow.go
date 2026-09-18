package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/whatsy/backend/internal/zernio"
)

// FlowHandler proxies the WhatsApp Flow lifecycle while keeping the Zernio key server-side.
type FlowHandler struct {
	db     *sql.DB
	client *zernio.Client
}

func NewFlowHandler(db *sql.DB, client *zernio.Client) *FlowHandler {
	return &FlowHandler{db: db, client: client}
}

func (h *FlowHandler) accountID(r *http.Request) (string, error) {
	var accountID string
	err := h.db.QueryRowContext(r.Context(), `
		SELECT account_id FROM whatsapp_connections
		WHERE status = 'connected' AND COALESCE(account_id, '') <> ''
		ORDER BY id DESC LIMIT 1`).Scan(&accountID)
	return accountID, err
}

func (h *FlowHandler) withAccount(w http.ResponseWriter, r *http.Request, action func(string) (map[string]any, error)) {
	accountID, err := h.accountID(r)
	if err == sql.ErrNoRows || accountID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "connect a WhatsApp number first"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "resolve WhatsApp account"})
		return
	}
	response, err := action(accountID)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *FlowHandler) List(w http.ResponseWriter, r *http.Request) {
	h.withAccount(w, r, func(accountID string) (map[string]any, error) {
		return h.client.ListWhatsAppFlows(r.Context(), accountID)
	})
}

func (h *FlowHandler) Create(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var request struct {
		Name       string   `json:"name"`
		Categories []string `json:"categories"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}
	h.withAccount(w, r, func(accountID string) (map[string]any, error) {
		return h.client.CreateWhatsAppFlow(r.Context(), accountID, request.Name, request.Categories)
	})
}

func (h *FlowHandler) UploadJSON(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var request struct {
		FlowJSON json.RawMessage `json:"flow_json"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || len(request.FlowJSON) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "flow_json is required"})
		return
	}
	h.withAccount(w, r, func(accountID string) (map[string]any, error) {
		var flowJSON any
		if err := json.Unmarshal(request.FlowJSON, &flowJSON); err != nil {
			return nil, err
		}
		return h.client.UploadWhatsAppFlowJSON(r.Context(), accountID, chi.URLParam(r, "id"), flowJSON)
	})
}

func (h *FlowHandler) Preview(w http.ResponseWriter, r *http.Request) {
	h.withAccount(w, r, func(accountID string) (map[string]any, error) {
		return h.client.PreviewWhatsAppFlow(r.Context(), accountID, chi.URLParam(r, "id"))
	})
}

func (h *FlowHandler) Publish(w http.ResponseWriter, r *http.Request) {
	h.withAccount(w, r, func(accountID string) (map[string]any, error) {
		return h.client.PublishWhatsAppFlow(r.Context(), accountID, chi.URLParam(r, "id"))
	})
}
