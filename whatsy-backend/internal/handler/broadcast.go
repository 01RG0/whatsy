package handler

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

type BroadcastHandler struct {
	apiKey  string
	baseURL string
	db      *sql.DB
}

func NewBroadcastHandler(apiKey string, db *sql.DB) *BroadcastHandler {
	return &BroadcastHandler{
		apiKey:  apiKey,
		baseURL: "https://zernio.com/api/v1",
		db:      db,
	}
}

type broadcastRequest struct {
	TemplateName   string     `json:"templateName"`
	TemplateParams []string   `json:"templateParams"`
	RecipientPhones []string  `json:"recipientPhones"`
	ScheduledAt    *time.Time `json:"scheduledAt,omitempty"`
}

type broadcastResult struct {
	Success int      `json:"success"`
	Failed  int      `json:"failed"`
	Errors  []string `json:"errors"`
}

func (h *BroadcastHandler) SendBroadcast(w http.ResponseWriter, r *http.Request) {
	var req broadcastRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if req.TemplateName == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "templateName is required"})
		return
	}
	if len(req.RecipientPhones) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "recipientPhones is required"})
		return
	}
	if len(req.RecipientPhones) > 1000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "max 1000 recipients per request"})
		return
	}

	sem := make(chan struct{}, 10)
	var mu sync.Mutex
	result := broadcastResult{Errors: []string{}}

	var wg sync.WaitGroup
	for _, phone := range req.RecipientPhones {
		wg.Add(1)
		go func(phone string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			err := h.sendTemplateMessage(r.Context(), phone, req.TemplateName, req.TemplateParams)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				result.Failed++
				result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", phone, err))
			} else {
				result.Success++
			}
		}(phone)
	}
	wg.Wait()

	// log broadcast (best-effort, non-blocking)
	agentID := ""
	if claims, ok := ClaimsFromContext(r.Context()); ok && claims != nil {
		agentID = claims.AgentID
	}
	h.logBroadcast(r.Context(), req.TemplateName, len(req.RecipientPhones), result.Success, result.Failed, agentID)

	writeJSON(w, http.StatusOK, result)
}

func (h *BroadcastHandler) sendTemplateMessage(ctx context.Context, phone, templateName string, params []string) error {
	payload := map[string]interface{}{
		"to":           phone,
		"type":         "template",
		"templateName": templateName,
		"templateParams": params,
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.baseURL+"/whatsapp/messages", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+h.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode >= 400 {
		return fmt.Errorf("zernio returned %d", resp.StatusCode)
	}
	return nil
}

func (h *BroadcastHandler) logBroadcast(ctx context.Context, templateName string, total, success, failed int, agentID string) {
	var createdBy interface{}
	if agentID != "" {
		createdBy = agentID
	}
	_, _ = h.db.ExecContext(ctx,
		`INSERT INTO broadcasts (id, template_name, recipient_count, success_count, failed_count, created_by)
		 VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
		templateName, total, success, failed, createdBy,
	)
}
