package handler

import (
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"
)

// SettingsHandler manages workspace feature flags and preferences.
type SettingsHandler struct {
	db *sql.DB
}

func NewSettingsHandler(db *sql.DB) *SettingsHandler {
	return &SettingsHandler{db: db}
}

// defaultSettings lists every known setting key with its default value.
// GET always returns all keys; missing rows fall back to this map.
var defaultSettings = map[string]string{
	"interactive_messages_enabled": "false", // off until admin enables it
	"canned_responses_enabled":     "true",
	"auto_reply_enabled":           "true",
	"typing_indicators_enabled":    "true",
}

// GetSettings handles GET /v1/settings.
// Returns all workspace settings as a flat JSON object of string values.
// Accessible by any authenticated agent (not admin-only — agents need to read flags).
func (h *SettingsHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	tenantID := claims.TenantID
	if tenantID == "" {
		tenantID = "00000000-0000-0000-0000-000000000001"
	}

	rows, err := h.db.QueryContext(r.Context(),
		`SELECT key, value FROM workspace_settings WHERE tenant_id = $1`, tenantID,
	)
	if err != nil {
		log.Printf("[settings] get: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "get settings"})
		return
	}
	defer rows.Close()

	// Start with all defaults, then overlay DB values.
	result := make(map[string]string, len(defaultSettings))
	for k, v := range defaultSettings {
		result[k] = v
	}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			result[k] = v
		}
	}

	// Convert "true"/"false" strings to actual booleans for the frontend.
	out := make(map[string]any, len(result))
	for k, v := range result {
		if v == "true" {
			out[k] = true
		} else if v == "false" {
			out[k] = false
		} else {
			out[k] = v
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// UpdateSettings handles PUT /v1/settings.
// Admin-only. Accepts a flat JSON object; unknown keys are ignored.
func (h *SettingsHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	tenantID := claims.TenantID
	if tenantID == "" {
		tenantID = "00000000-0000-0000-0000-000000000001"
	}

	defer r.Body.Close()
	var incoming map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 32*1024)).Decode(&incoming); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}

	now := time.Now()
	for key := range defaultSettings {
		raw, ok := incoming[key]
		if !ok {
			continue
		}
		var val string
		switch v := raw.(type) {
		case bool:
			if v {
				val = "true"
			} else {
				val = "false"
			}
		case string:
			val = v
		default:
			continue
		}
		if _, err := h.db.ExecContext(r.Context(),
			`INSERT INTO workspace_settings (tenant_id, key, value, updated_at)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
			tenantID, key, val, now,
		); err != nil {
			log.Printf("[settings] upsert %s: %v", key, err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "save setting"})
			return
		}
	}

	// Return the full updated settings object.
	h.GetSettings(w, r)
}

// GetPublicSettings handles GET /v1/settings/public — no auth required.
// Returns only the feature flags the frontend needs before login (none currently,
// but the endpoint exists for future public config like maintenance mode).
func (h *SettingsHandler) GetPublicSettings(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{})
}

