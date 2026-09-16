package handler

import (
	"bytes"
	"io"
	"net/http"
	"sync"
	"time"
)

type templateCacheEntry struct {
	data    []byte
	expires time.Time
}

// TemplateHandler proxies WhatsApp template requests to Zernio with 5-min cache.
type TemplateHandler struct {
	apiKey  string
	baseURL string
	cache   sync.Map
}

func NewTemplateHandler(apiKey string) *TemplateHandler {
	return &TemplateHandler{
		apiKey:  apiKey,
		baseURL: "https://zernio.com/api/v1",
	}
}

func (h *TemplateHandler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	if v, ok := h.cache.Load("templates"); ok {
		entry := v.(templateCacheEntry)
		if time.Now().Before(entry.expires) {
			w.Header().Set("Content-Type", "application/json")
			w.Write(entry.data)
			return
		}
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, h.baseURL+"/whatsapp/templates", nil)
	if err != nil {
		http.Error(w, `{"error":"failed to build request"}`, http.StatusInternalServerError)
		return
	}
	req.Header.Set("Authorization", "Bearer "+h.apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		http.Error(w, `{"error":"upstream request failed"}`, http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, `{"error":"failed to read upstream response"}`, http.StatusBadGateway)
		return
	}

	if resp.StatusCode == http.StatusOK {
		h.cache.Store("templates", templateCacheEntry{
			data:    body,
			expires: time.Now().Add(5 * time.Minute),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(body)
}

func (h *TemplateHandler) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, h.baseURL+"/whatsapp/templates", bytes.NewReader(body))
	if err != nil {
		http.Error(w, `{"error":"failed to build request"}`, http.StatusInternalServerError)
		return
	}
	req.Header.Set("Authorization", "Bearer "+h.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		http.Error(w, `{"error":"upstream request failed"}`, http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	h.cache.Delete("templates")

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}
