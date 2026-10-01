package handler

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"io"
	"log"
	"net/http"
	"net/url"
	"path"
	"strings"

	"github.com/go-chi/chi/v5"
)

// GetProxy proxies any Zernio media URL through our backend, adding the API key.
// The full Zernio URL is passed as ?url=<encoded> so we handle any URL format
// that Zernio might return (upload-direct, webhook attachments, etc.).
func (h *MediaHandler) GetProxy(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "url parameter required"})
		return
	}

	// Normalize http:// to https:// — some Zernio attachment URLs arrive over http.
	if strings.HasPrefix(rawURL, "http://") {
		rawURL = "https://" + rawURL[len("http://"):]
	}

	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "url must be a valid https URL"})
		return
	}

	hh := sha256.Sum256([]byte(rawURL))
	hash := hex.EncodeToString(hh[:])

	// Check sticker cache.
	if h.db != nil {
		var data []byte
		var mimeType string
		if err := h.db.QueryRowContext(r.Context(),
			`SELECT data, mime_type FROM sticker_cache WHERE url_hash=$1`, hash,
		).Scan(&data, &mimeType); err == nil {
			w.Header().Set("Content-Type", mimeType)
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(data)
			return
		}
	}

	// Check media cache (voice notes, images, video cached on webhook arrival).
	if h.db != nil {
		var data []byte
		var mimeType string
		if err := h.db.QueryRowContext(r.Context(),
			`SELECT data, mime_type FROM media_cache WHERE url_hash=$1`, hash,
		).Scan(&data, &mimeType); err == nil {
			w.Header().Set("Content-Type", mimeType)
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(data)
			return
		}
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, rawURL, nil)
	if err != nil {
		log.Printf("[media-proxy] error creating request for %s: %v", rawURL, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "fetch media"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+h.zernioAPIKey)

	if rangeHdr := r.Header.Get("Range"); rangeHdr != "" {
		req.Header.Set("Range", rangeHdr)
	}

	response, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[media-proxy] error fetching %s from Zernio: %v", rawURL, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "fetch media"})
		return
	}
	defer response.Body.Close()

	if response.StatusCode == http.StatusNotFound {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		log.Printf("[media-proxy] Zernio 404 for %s: %s", rawURL, string(body))
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media not found"})
		return
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		log.Printf("[media-proxy] Zernio non-2xx for %s (status=%d): %s", rawURL, response.StatusCode, string(body))
		if isExpiredMediaError(response.StatusCode, body) {
			writeJSON(w, http.StatusGone, map[string]string{
				"error": "Media has expired and was not cached. Only new messages will be cached going forward.",
			})
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "fetch media"})
		return
	}

	ct := response.Header.Get("Content-Type")
	if ct == "" {
		ct = contentTypeFromURL(rawURL)
	}
	if ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if cl := response.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}
	if cr := response.Header.Get("Content-Range"); cr != "" {
		w.Header().Set("Content-Range", cr)
	}
	if ar := response.Header.Get("Accept-Ranges"); ar != "" {
		w.Header().Set("Accept-Ranges", ar)
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.WriteHeader(response.StatusCode)
	if _, err := io.Copy(w, response.Body); err != nil {
		return
	}
}

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
// It checks media_cache first using the canonical Zernio URL as the cache key,
// which is the same URL stored by chat_service.cacheMedia on webhook arrival.
func (h *MediaHandler) Get(w http.ResponseWriter, r *http.Request) {
	mediaID := chi.URLParam(r, "mediaId")

	// Compute cache key: sha256 of the canonical URL without accountId,
	// matching the key chat_service.cacheMedia uses.
	canonicalURL := "https://zernio.com/api/v1/whatsapp/media/" + url.PathEscape(mediaID)
	hh := sha256.Sum256([]byte(canonicalURL))
	hash := hex.EncodeToString(hh[:])

	// Check media cache before hitting Zernio.
	if h.db != nil {
		var data []byte
		var mimeType string
		if err := h.db.QueryRowContext(r.Context(),
			`SELECT data, mime_type FROM media_cache WHERE url_hash=$1`, hash,
		).Scan(&data, &mimeType); err == nil {
			w.Header().Set("Content-Type", mimeType)
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(data)
			return
		}
	}

	accountID := r.URL.Query().Get("accountId")
	// Try connected first.
	if accountID == "" && h.db != nil {
		_ = h.db.QueryRowContext(r.Context(),
			`SELECT account_id FROM whatsapp_connections WHERE status='connected' AND COALESCE(account_id, '') <> '' ORDER BY id DESC LIMIT 1`,
		).Scan(&accountID)
	}
	// Fallback: any row with an account_id regardless of status.
	if accountID == "" && h.db != nil {
		_ = h.db.QueryRowContext(r.Context(),
			`SELECT account_id FROM whatsapp_connections WHERE COALESCE(account_id, '') <> '' ORDER BY id DESC LIMIT 1`,
		).Scan(&accountID)
	}

	targetURL := canonicalURL
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
		log.Printf("[media] Zernio returned non-2xx for media %s (accountID=%q, status=%d): %s", mediaID, accountID, response.StatusCode, string(body))
		if isExpiredMediaError(response.StatusCode, body) {
			writeJSON(w, http.StatusGone, map[string]string{
				"error": "Media has expired and was not cached. Only new messages will be cached going forward.",
			})
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "fetch media"})
		return
	}

	contentType := response.Header.Get("Content-Type")
	if contentType == "" {
		contentType = contentTypeFromURL(canonicalURL)
	}
	if contentType != "" {
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

// isExpiredMediaError returns true when Zernio's response indicates that Meta's
// CDN has deleted the media (typically HTTP 400 with a body message about the
// media no longer being available).
func isExpiredMediaError(statusCode int, body []byte) bool {
	if statusCode != http.StatusBadRequest {
		return false
	}
	lower := strings.ToLower(string(body))
	return strings.Contains(lower, "no longer available") ||
		strings.Contains(lower, "media expired") ||
		strings.Contains(lower, "media not available")
}

// contentTypeFromURL infers a MIME type from a URL's file extension.
// Returns an empty string when the extension is unknown or absent.
func contentTypeFromURL(rawURL string) string {
	ext := strings.ToLower(path.Ext(rawURL))
	switch ext {
	case ".ogg", ".opus":
		return "audio/ogg"
	case ".webm":
		return "audio/webm"
	case ".mp3":
		return "audio/mpeg"
	case ".mp4":
		return "video/mp4"
	case ".aac":
		return "audio/aac"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".pdf":
		return "application/pdf"
	}
	return ""
}
