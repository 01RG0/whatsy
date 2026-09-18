package handler

import (
	"database/sql"
	"io"
	"log"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"
)

// MediaHandler proxies WhatsApp media from Zernio to authenticated clients.
type MediaHandler struct {
	zernioAPIKey string
	db           *sql.DB
}

// NewMediaHandler creates a MediaHandler using the supplied Zernio API key and database.
func NewMediaHandler(zernioAPIKey string, db *sql.DB) *MediaHandler {
	return &MediaHandler{
		zernioAPIKey: zernioAPIKey,
		db:           db,
	}
}

// Get proxies GET /v1/whatsapp/media/{mediaId} from Zernio.
func (h *MediaHandler) Get(w http.ResponseWriter, r *http.Request) {
	mediaID := chi.URLParam(r, "mediaId")

	accountID := r.URL.Query().Get("accountId")
	if accountID == "" && h.db != nil {
		_ = h.db.QueryRowContext(r.Context(),
			`SELECT account_id FROM whatsapp_connections WHERE status='connected' AND COALESCE(account_id, '') <> '' ORDER BY id DESC LIMIT 1`,
		).Scan(&accountID)
	}

	targetURL := "https://zernio.com/api/v1/whatsapp/media/" + url.PathEscape(mediaID)
	if accountID != "" {
		targetURL += "?accountId=" + url.QueryEscape(accountID)
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, targetURL, nil)
	if err != nil {
		log.Printf("[media] error creating request for media %s: %v", mediaID, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "fetch media"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+h.zernioAPIKey)

	// Forward Range header if present (useful for audio/video streaming)
	if rangeHdr := r.Header.Get("Range"); rangeHdr != "" {
		req.Header.Set("Range", rangeHdr)
	}

	response, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[media] error fetching media %s from Zernio: %v", mediaID, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "fetch media"})
		return
	}
	defer response.Body.Close()

	if response.StatusCode == http.StatusNotFound {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		log.Printf("[media] Zernio media %s not found (404): %s", mediaID, string(body))
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media not found"})
		return
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		log.Printf("[media] Zernio media %s error status %d: %s", mediaID, response.StatusCode, string(body))
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "fetch media"})
		return
	}

	if contentType := response.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	if contentLength := response.Header.Get("Content-Length"); contentLength != "" {
		w.Header().Set("Content-Length", contentLength)
	}
	if contentRange := response.Header.Get("Content-Range"); contentRange != "" {
		w.Header().Set("Content-Range", contentRange)
	}
	if acceptRanges := response.Header.Get("Accept-Ranges"); acceptRanges != "" {
		w.Header().Set("Accept-Ranges", acceptRanges)
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.WriteHeader(response.StatusCode)
	if _, err := io.Copy(w, response.Body); err != nil {
		// The response has already begun, so a status code can no longer be sent.
		return
	}
}
