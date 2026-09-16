package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
)

// maxUploadSize matches Zernio's documented 25MB limit for /v1/media/upload-direct.
const maxUploadSize = 25 << 20

// UploadHandler proxies WhatsApp media uploads to Zernio's
// POST /v1/media/upload-direct endpoint, which returns a publicly accessible
// URL usable as attachmentUrl on the send-message endpoint.
type UploadHandler struct {
	zernioAPIKey string
	zernioBase   string
}

// NewUploadHandler creates an upload proxy using the supplied Zernio API key.
func NewUploadHandler(zernioAPIKey string) *UploadHandler {
	return &UploadHandler{
		zernioAPIKey: zernioAPIKey,
		zernioBase:   "https://zernio.com/api/v1",
	}
}

// Upload accepts a multipart form with a "file" field and forwards it to
// Zernio as the documented "attachment" field of POST /v1/media/upload-direct.
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

	if header.Size > maxUploadSize {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file exceeds 25MB limit"})
		return
	}

	pipeReader, pipeWriter := io.Pipe()
	formWriter := multipart.NewWriter(pipeWriter)
	go func() {
		// Zernio expects the multipart field name "attachment" (documented);
		// forward the client's filename and content type.
		partHeader := make(textproto.MIMEHeader)
		partHeader.Set("Content-Disposition",
			fmt.Sprintf(`form-data; name="attachment"; filename=%q`, header.Filename))
		if ct := header.Header.Get("Content-Type"); ct != "" {
			partHeader.Set("Content-Type", ct)
		}
		part, err := formWriter.CreatePart(partHeader)
		if err == nil {
			_, err = io.Copy(part, file)
		}
		if closeErr := formWriter.Close(); err == nil {
			err = closeErr
		}
		_ = pipeWriter.CloseWithError(err)
	}()

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, h.zernioBase+"/media/upload-direct", pipeReader)
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

	respBody, _ := io.ReadAll(io.LimitReader(response.Body, maxUploadSize))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// Surface Zernio's error message when available.
		var errResp struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(respBody, &errResp)
		msg := errResp.Error
		if msg == "" {
			msg = "upload media failed"
		}
		writeJSON(w, response.StatusCode, map[string]string{"error": msg})
		return
	}

	// Documented response: {url, filename, contentType, size}. Return as-is.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(respBody)
}
