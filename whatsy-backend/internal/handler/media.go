package handler

import (
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// MediaHandler proxies WhatsApp media from Zernio to authenticated clients.
type MediaHandler struct {
	zernioAPIKey string
}

// NewMediaHandler creates a MediaHandler using the supplied Zernio API key.
func NewMediaHandler(zernioAPIKey string) *MediaHandler {
	return &MediaHandler{zernioAPIKey: zernioAPIKey}
}

// Get proxies GET /v1/whatsapp/media/{mediaId} from Zernio.
func (h *MediaHandler) Get(w http.ResponseWriter, r *http.Request) {
	mediaID := chi.URLParam(r, "mediaId")
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://zernio.com/api/v1/whatsapp/media/"+mediaID, nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "fetch media"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+h.zernioAPIKey)

	response, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "fetch media"})
		return
	}
	defer response.Body.Close()

	if response.StatusCode == http.StatusNotFound {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "media not found"})
		return
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "fetch media"})
		return
	}

	if contentType := response.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	if contentLength := response.Header.Get("Content-Length"); contentLength != "" {
		w.Header().Set("Content-Length", contentLength)
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.WriteHeader(response.StatusCode)
	if _, err := io.Copy(w, response.Body); err != nil {
		// The response has already begun, so a status code can no longer be sent.
		return
	}
}
