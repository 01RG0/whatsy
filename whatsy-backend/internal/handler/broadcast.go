package handler

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	TemplateName    string     `json:"templateName"`
	TemplateParams  []string   `json:"templateParams"`
	RecipientPhones []string   `json:"recipientPhones"`
	ScheduledAt     *time.Time `json:"scheduledAt,omitempty"`
}

type broadcastResult struct {
	BroadcastID    string `json:"broadcastId"`
	Status         string `json:"status"`
	RecipientCount int    `json:"recipientCount"`
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
	if len(req.RecipientPhones) > 10000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "max 10000 recipients per broadcast"})
		return
	}

	// Get accountId from connected WhatsApp account
	var accountID, profileID string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT COALESCE(account_id, '') FROM whatsapp_connections WHERE status='connected' ORDER BY id DESC LIMIT 1`,
	).Scan(&accountID); err != nil || accountID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "no connected WhatsApp account; connect a number first"})
		return
	}

	// Get profileId from Zernio
	profileID, err := h.fetchProfileID(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not fetch profile: " + err.Error()})
		return
	}

	// Build template components from params
	var components []map[string]any
	if len(req.TemplateParams) > 0 {
		params := make([]map[string]any, 0, len(req.TemplateParams))
		for _, p := range req.TemplateParams {
			params = append(params, map[string]any{"type": "text", "text": p})
		}
		components = append(components, map[string]any{
			"type":       "body",
			"parameters": params,
		})
	}

	// Step 1: Create broadcast draft
	draftBody, _ := json.Marshal(map[string]any{
		"profileId": profileID,
		"accountId": accountID,
		"platform":  "whatsapp",
		"name":      fmt.Sprintf("Broadcast - %s - %s", req.TemplateName, time.Now().Format("2006-01-02 15:04")),
		"template": map[string]any{
			"name":       req.TemplateName,
			"language":   "en",
			"components": components,
		},
	})
	draftResp, err := h.zernioPost(r.Context(), "/broadcasts", draftBody)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "zernio unreachable"})
		return
	}
	defer draftResp.Body.Close()
	var draftResult struct {
		Broadcast struct {
			ID string `json:"id"`
		} `json:"broadcast"`
	}
	draftBytes, _ := io.ReadAll(draftResp.Body)
	if draftResp.StatusCode >= 400 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(draftResp.StatusCode)
		w.Write(draftBytes)
		return
	}
	if err := json.Unmarshal(draftBytes, &draftResult); err != nil || draftResult.Broadcast.ID == "" {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "unexpected broadcast create response"})
		return
	}
	broadcastID := draftResult.Broadcast.ID

	// Step 2: Add recipients
	recipBody, _ := json.Marshal(map[string]any{"phones": req.RecipientPhones})
	recipResp, err := h.zernioPost(r.Context(), "/broadcasts/"+broadcastID+"/recipients", recipBody)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to add recipients"})
		return
	}
	io.Copy(io.Discard, recipResp.Body)
	recipResp.Body.Close()

	// Step 3: Send or schedule
	var actionPath string
	var actionBody []byte
	if req.ScheduledAt != nil {
		actionPath = "/broadcasts/" + broadcastID + "/schedule"
		actionBody, _ = json.Marshal(map[string]any{
			"scheduledAt": req.ScheduledAt.UTC().Format(time.RFC3339),
		})
	} else {
		actionPath = "/broadcasts/" + broadcastID + "/send"
		actionBody = []byte("{}")
	}
	sendResp, err := h.zernioPost(r.Context(), actionPath, actionBody)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to send broadcast"})
		return
	}
	defer sendResp.Body.Close()
	if sendResp.StatusCode >= 400 {
		sendBytes, _ := io.ReadAll(sendResp.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(sendResp.StatusCode)
		w.Write(sendBytes)
		return
	}

	status := "sending"
	if req.ScheduledAt != nil {
		status = "scheduled"
	}

	// Log broadcast (best-effort)
	agentID := ""
	if claims, ok := ClaimsFromContext(r.Context()); ok && claims != nil {
		agentID = claims.AgentID
	}
	h.logBroadcast(r.Context(), req.TemplateName, len(req.RecipientPhones), agentID)

	writeJSON(w, http.StatusOK, broadcastResult{
		BroadcastID:    broadcastID,
		Status:         status,
		RecipientCount: len(req.RecipientPhones),
	})
}

func (h *BroadcastHandler) fetchProfileID(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.baseURL+"/profiles", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+h.apiKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var result struct {
		Profiles []struct {
			ID string `json:"_id"` // Profile schema uses _id
		} `json:"profiles"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode profiles: %w", err)
	}
	if len(result.Profiles) == 0 {
		return "", fmt.Errorf("no profiles found")
	}
	return result.Profiles[0].ID, nil
}

func (h *BroadcastHandler) zernioPost(ctx context.Context, path string, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+h.apiKey)
	req.Header.Set("Content-Type", "application/json")
	return http.DefaultClient.Do(req)
}

func (h *BroadcastHandler) logBroadcast(ctx context.Context, templateName string, total int, agentID string) {
	var createdBy interface{}
	if agentID != "" {
		createdBy = agentID
	}
	_, _ = h.db.ExecContext(ctx,
		`INSERT INTO broadcasts (id, template_name, recipient_count, success_count, failed_count, created_by)
		 VALUES (gen_random_uuid(), $1, $2, 0, 0, $3)`,
		templateName, total, createdBy,
	)
}
