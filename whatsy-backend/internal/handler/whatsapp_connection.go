package handler

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// WhatsAppConnectionHandler serves WhatsApp connection management endpoints.
type WhatsAppConnectionHandler struct {
	db         *sql.DB
	zernioKey  string
	zernioBase string
}

// NewWhatsAppConnectionHandler creates a handler backed by db and zernioKey.
// zernioBase must NOT include the /v1 prefix; endpoint paths below add it.
func NewWhatsAppConnectionHandler(db *sql.DB, zernioKey string) *WhatsAppConnectionHandler {
	base := os.Getenv("ZERNIO_BASE_URL")
	if base == "" {
		base = "https://zernio.com/api"
	}
	base = strings.TrimSuffix(strings.TrimRight(base, "/"), "/v1")
	return &WhatsAppConnectionHandler{db: db, zernioKey: zernioKey, zernioBase: base}
}

// Status returns the WhatsApp connection status.
// Zernio is the live source of truth; DB 'disconnected' only blocks if Zernio
// has no account connected *after* the disconnect time (i.e. no new signup).
func (h *WhatsAppConnectionHandler) Status(w http.ResponseWriter, r *http.Request) {
	// Always ask Zernio first — it knows about new signups the DB doesn't
	resp, err := h.zernioGet(r, "/v1/accounts?platform=whatsapp")
	if err == nil {
		defer resp.Body.Close()
		var zResp struct {
			Accounts []struct {
				ID          string `json:"_id"` // SocialAccount schema: _id is the account id
				Username    string `json:"username"`
				DisplayName string `json:"displayName"`
				IsActive    bool   `json:"isActive"`
				CreatedAt   string `json:"createdAt"`
			} `json:"accounts"`
		}
		if decErr := json.NewDecoder(resp.Body).Decode(&zResp); decErr == nil && len(zResp.Accounts) > 0 {
			a := zResp.Accounts[0]

			// Check if DB has a 'disconnected' flag set after this account was created
			var dbUpdatedAt sql.NullTime
			_ = h.db.QueryRowContext(r.Context(),
				`SELECT updated_at FROM whatsapp_connections WHERE status='disconnected' ORDER BY id DESC LIMIT 1`,
			).Scan(&dbUpdatedAt)

			// If we have a disconnected flag and it was set AFTER this account was created → user chose to disconnect
			if dbUpdatedAt.Valid {
				// Parse Zernio createdAt
				acctCreated, parseErr := time.Parse(time.RFC3339, a.CreatedAt)
				if parseErr == nil && dbUpdatedAt.Time.After(acctCreated) {
					// This account existed before our disconnect — honour the disconnect
					writeJSON(w, http.StatusOK, map[string]any{
						"status":      "disconnected",
						"phoneNumber": "",
						"displayName": "",
					})
					return
				}
			}

			// New or re-connected account — sync to DB and return connected
			_, _ = h.db.ExecContext(r.Context(),
				`INSERT INTO whatsapp_connections (status, phone_number_id, phone_number, display_name, account_id, connected_at, updated_at)
				 VALUES ('connected', $1, $2, $3, $4, NOW(), NOW())
				 ON CONFLICT (phone_number_id) DO UPDATE
				 SET status='connected', phone_number=$2, display_name=$3, account_id=$4, updated_at=NOW()`,
				a.ID, a.Username, a.DisplayName, a.ID,
			)
			writeJSON(w, http.StatusOK, map[string]any{
				"status":         "connected",
				"phoneNumber":    a.Username,
				"displayName":    a.DisplayName,
				"accountId":      a.ID,
				"isSandbox":      false,
				"webhookHealthy": a.IsActive,
			})
			return
		}
	}

	// Zernio unreachable or no accounts — fall back to DB
	var dbStatus, phone, name string
	var accountID sql.NullString
	dbErr := h.db.QueryRowContext(r.Context(),
		`SELECT status, phone_number, display_name, account_id FROM whatsapp_connections ORDER BY id DESC LIMIT 1`,
	).Scan(&dbStatus, &phone, &name, &accountID)
	if dbErr != nil {
		writeJSON(w, http.StatusOK, map[string]any{"status": "disconnected", "phoneNumber": "", "displayName": ""})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      dbStatus,
		"phoneNumber": phone,
		"displayName": name,
		"accountId":   accountID.String,
	})
}

// QRCode auto-fetches the Zernio profileId and returns an Embedded Signup auth URL.
// The browser opens this URL to go through Meta's OAuth (which includes the real QR scan).
func (h *WhatsAppConnectionHandler) QRCode(w http.ResponseWriter, r *http.Request) {
	profileID, err := h.fetchProfileID(r)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not fetch profile: " + err.Error()})
		return
	}
	redirectURL := r.URL.Query().Get("redirectUrl")
	if redirectURL == "" {
		redirectURL = "https://yourapp.com/connection"
	}
	// onboarding=api (Cloud API only, default) or business_app (coexistence — keeps WA Business app running)
	onboarding := r.URL.Query().Get("onboarding")
	if onboarding != "business_app" {
		onboarding = "api"
	}
	path := fmt.Sprintf("/v1/connect/whatsapp?profileId=%s&redirect_url=%s&onboarding=%s&signup=hosted",
		url.QueryEscape(profileID), url.QueryEscape(redirectURL), onboarding)
	resp, err := h.zernioGet(r, path)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "zernio unreachable"})
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body) //nolint:errcheck
}

// Connect connects a WhatsApp number via Zernio credentials (headless / Cloud API).
// Auto-fetches the profileId — user only needs phoneNumberId, wabaId, accessToken.
func (h *WhatsAppConnectionHandler) Connect(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var req struct {
		PhoneNumberID string `json:"phoneNumberId"`
		WabaID        string `json:"wabaId"`
		AccessToken   string `json:"accessToken"`
		Pin           string `json:"pin"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if req.PhoneNumberID == "" || req.WabaID == "" || req.AccessToken == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "phoneNumberId, wabaId and accessToken are required"})
		return
	}

	profileID, err := h.fetchProfileID(r)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not fetch profile: " + err.Error()})
		return
	}

	payload := map[string]any{
		"profileId":     profileID,
		"accessToken":   req.AccessToken,
		"wabaId":        req.WabaID,
		"phoneNumberId": req.PhoneNumberID,
	}
	if req.Pin != "" {
		payload["pin"] = req.Pin
	}
	body, _ := json.Marshal(payload)
	resp, err := h.zernioPost(r, "/v1/connect/whatsapp/credentials", body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "zernio unreachable"})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		w.Write(respBody) //nolint:errcheck
		return
	}

	var zResp struct {
		Account struct {
			AccountID   string `json:"accountId"`
			Username    string `json:"username"`
			DisplayName string `json:"displayName"`
		} `json:"account"`
	}
	_ = json.Unmarshal(respBody, &zResp)

	_, _ = h.db.ExecContext(r.Context(),
		`INSERT INTO whatsapp_connections (status, phone_number_id, phone_number, display_name, account_id, connected_at, updated_at)
		 VALUES ('connected', $1, $2, $3, $4, NOW(), NOW())
		 ON CONFLICT (phone_number_id) DO UPDATE
		 SET status='connected', phone_number=$2, display_name=$3, account_id=$4, connected_at=NOW(), updated_at=NOW()`,
		req.PhoneNumberID, zResp.Account.Username, zResp.Account.DisplayName, zResp.Account.AccountID,
	)
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "connected",
		"phoneNumber": zResp.Account.Username,
		"displayName": zResp.Account.DisplayName,
		"accountId":   zResp.Account.AccountID,
	})
}

// Disconnect removes the account from Zernio and marks it disconnected in DB.
func (h *WhatsAppConnectionHandler) Disconnect(w http.ResponseWriter, r *http.Request) {
	// Look up accountId to call Zernio delete
	var accountID sql.NullString
	_ = h.db.QueryRowContext(r.Context(),
		`SELECT account_id FROM whatsapp_connections WHERE status='connected' ORDER BY id DESC LIMIT 1`,
	).Scan(&accountID)

	// Call Zernio DELETE /v1/accounts/{accountId} if we have one
	if accountID.Valid && accountID.String != "" {
		req, err := http.NewRequestWithContext(r.Context(), http.MethodDelete,
			fmt.Sprintf("%s/v1/accounts/%s", h.zernioBase, accountID.String), nil)
		if err == nil {
			req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", h.zernioKey))
			resp, _ := http.DefaultClient.Do(req)
			if resp != nil {
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
			}
		}
	}

	// Mark all rows disconnected in DB
	res, err := h.db.ExecContext(r.Context(),
		`UPDATE whatsapp_connections SET status='disconnected', updated_at=NOW()`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "disconnect"})
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		_, _ = h.db.ExecContext(r.Context(),
			`INSERT INTO whatsapp_connections (status, phone_number_id, phone_number, display_name, connected_at, updated_at)
			 VALUES ('disconnected', '_sentinel', '', '', NOW(), NOW())
			 ON CONFLICT (phone_number_id) DO UPDATE SET status='disconnected', updated_at=NOW()`)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "disconnected"})
}

// SetWebhook stores webhook config.
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

// SendTest sends a test WhatsApp message via Zernio's inbox API.
func (h *WhatsAppConnectionHandler) SendTest(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var req struct {
		To           string `json:"to"`
		Message      string `json:"message"`
		TemplateName string `json:"templateName"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if req.To == "" || (req.Message == "" && req.TemplateName == "") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "to and (message or templateName) are required"})
		return
	}

	// Look up accountId from DB (set during Connect), fall back to sandbox
	var accountID sql.NullString
	_ = h.db.QueryRowContext(r.Context(),
		`SELECT account_id FROM whatsapp_connections WHERE status='connected' ORDER BY id DESC LIMIT 1`,
	).Scan(&accountID)
	if !accountID.Valid || accountID.String == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "no connected WhatsApp account; connect a number first"})
		return
	}

	// Strip leading + so participantId is digits only (Zernio requirement)
	to := req.To
	if len(to) > 0 && to[0] == '+' {
		to = to[1:]
	}

	payload := map[string]any{
		"accountId":     accountID.String,
		"participantId": to,
	}
	if req.TemplateName != "" {
		payload["templateName"] = req.TemplateName
		payload["templateLanguage"] = "en"
	} else {
		payload["message"] = req.Message
	}

	body, _ := json.Marshal(payload)
	resp, err := h.zernioPost(r, "/v1/inbox/conversations", body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "zernio unreachable"})
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body) //nolint:errcheck
}

// fetchProfileID auto-fetches the first Zernio profile ID for this API key.
func (h *WhatsAppConnectionHandler) fetchProfileID(r *http.Request) (string, error) {
	resp, err := h.zernioGet(r, "/v1/profiles")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var result struct {
		Profiles []struct {
			ID string `json:"_id"`
		} `json:"profiles"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode profiles: %w", err)
	}
	if len(result.Profiles) == 0 {
		return "", fmt.Errorf("no profiles found in Zernio account")
	}
	return result.Profiles[0].ID, nil
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
