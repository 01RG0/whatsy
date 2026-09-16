package handler

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// WhatsAppConnectionHandler serves WhatsApp connection management endpoints.
type WhatsAppConnectionHandler struct {
	db         *sql.DB
	zernioKey  string
	zernioBase string
}

// NewWhatsAppConnectionHandler creates a handler backed by db and zernioKey.
func NewWhatsAppConnectionHandler(db *sql.DB, zernioKey string) *WhatsAppConnectionHandler {
	base := os.Getenv("ZERNIO_BASE_URL")
	if base == "" {
		base = "https://zernio.com/api"
	}
	return &WhatsAppConnectionHandler{db: db, zernioKey: zernioKey, zernioBase: base}
}

// Status returns the current WhatsApp connection status.
func (h *WhatsAppConnectionHandler) Status(w http.ResponseWriter, r *http.Request) {
	var status, phone, name, updatedAt string
	var connectedAt *time.Time
	err := h.db.QueryRowContext(r.Context(),
		`SELECT status, phone_number, display_name, connected_at, updated_at
		 FROM whatsapp_connections ORDER BY id DESC LIMIT 1`,
	).Scan(&status, &phone, &name, &connectedAt, &updatedAt)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":      "disconnected",
			"phoneNumber": "",
			"displayName": "",
			"connectedAt": nil,
		})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query connection"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      status,
		"phoneNumber": phone,
		"displayName": name,
		"connectedAt": connectedAt,
	})
}

// QRCode proxies a QR code generation request to Zernio and returns the result.
func (h *WhatsAppConnectionHandler) QRCode(w http.ResponseWriter, r *http.Request) {
	resp, err := h.zernioGet(r, "/v1/whatsapp/qr")
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "zernio unreachable"})
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body) //nolint:errcheck
}

// Connect stores a Cloud API phone-number-id + token in the DB.
func (h *WhatsAppConnectionHandler) Connect(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var req struct {
		PhoneNumberID string `json:"phoneNumberId"`
		AccessToken   string `json:"accessToken"`
		PhoneNumber   string `json:"phoneNumber"`
		DisplayName   string `json:"displayName"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if req.PhoneNumberID == "" || req.AccessToken == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "phoneNumberId and accessToken required"})
		return
	}
	now := time.Now()
	_, err := h.db.ExecContext(r.Context(),
		`INSERT INTO whatsapp_connections (status, phone_number_id, access_token, phone_number, display_name, connected_at, updated_at)
		 VALUES ('connected', $1, $2, $3, $4, $5, $5)
		 ON CONFLICT (phone_number_id) DO UPDATE
		 SET status='connected', access_token=$2, phone_number=$3, display_name=$4, connected_at=$5, updated_at=$5`,
		req.PhoneNumberID, req.AccessToken, req.PhoneNumber, req.DisplayName, now,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "save connection"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "connected", "connectedAt": now})
}

// Disconnect marks the current connection as disconnected.
func (h *WhatsAppConnectionHandler) Disconnect(w http.ResponseWriter, r *http.Request) {
	_, err := h.db.ExecContext(r.Context(),
		`UPDATE whatsapp_connections SET status='disconnected', updated_at=NOW()
		 WHERE id = (SELECT id FROM whatsapp_connections ORDER BY id DESC LIMIT 1)`,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "disconnect"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "disconnected"})
}

// SetWebhook stores webhook config and optionally registers it with Zernio.
func (h *WhatsAppConnectionHandler) SetWebhook(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var req struct {
		URL    string `json:"url"`
		Secret string `json:"secret"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if req.URL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "url is required"})
		return
	}
	_, err := h.db.ExecContext(r.Context(),
		`INSERT INTO whatsapp_webhooks (url, secret, created_at, updated_at)
		 VALUES ($1, $2, NOW(), NOW())
		 ON CONFLICT (url) DO UPDATE SET secret=$2, updated_at=NOW()`,
		req.URL, req.Secret,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "save webhook"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "webhook configured"})
}

// SendTest sends a test message via Zernio on behalf of the user.
func (h *WhatsAppConnectionHandler) SendTest(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var req struct {
		To      string `json:"to"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if req.To == "" || req.Message == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "to and message are required"})
		return
	}

	payload := map[string]any{
		"to":      req.To,
		"type":    "text",
		"content": req.Message,
	}
	body, _ := json.Marshal(payload)
	resp, err := h.zernioPost(r, "/v1/whatsapp/messages", body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "zernio unreachable"})
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body) //nolint:errcheck
}

func (h *WhatsAppConnectionHandler) zernioGet(r *http.Request, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, h.zernioBase+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", h.zernioKey))
	return http.DefaultClient.Do(req)
}

func (h *WhatsAppConnectionHandler) zernioPost(r *http.Request, path string, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, h.zernioBase+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", h.zernioKey))
	req.Header.Set("Content-Type", "application/json")
	return http.DefaultClient.Do(req)
}
