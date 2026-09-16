package handler

import (
	"io"
	"mime/multipart"
	"net/http"
)

const maxUploadSize = 16 << 20

// UploadHandler proxies WhatsApp media uploads to Zernio.
type UploadHandler struct {
	zernioAPIKey string
}

// NewUploadHandler creates an upload proxy using the supplied Zernio API key.
func NewUploadHandler(zernioAPIKey string) *UploadHandler {
	return &UploadHandler{zernioAPIKey: zernioAPIKey}
}

// Upload accepts a multipart file field and forwards it to Zernio.
func (h *UploadHandler) Upload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid multipart form"})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file is required"})
		return
	}
	defer file.Close()

	pipeReader, pipeWriter := io.Pipe()
	formWriter := multipart.NewWriter(pipeWriter)
	go func() {
		part, err := formWriter.CreateFormFile("file", header.Filename)
		if err == nil {
			_, err = io.Copy(part, file)
		}
		if closeErr := formWriter.Close(); err == nil {
			err = closeErr
		}
		_ = pipeWriter.CloseWithError(err)
	}()

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, "https://zernio.com/api/v1/whatsapp/media", pipeReader)
	if err != nil {
		pipeReader.Close()
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upload media"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+h.zernioAPIKey)
	req.Header.Set("Content-Type", formWriter.FormDataContentType())

	response, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upload media"})
		return
	}
	defer response.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(response.StatusCode)
	if _, err := io.Copy(w, response.Body); err != nil {
		return
	}
}
