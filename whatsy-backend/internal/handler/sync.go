package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// SyncHandler pulls conversations from Zernio and seeds the local DB.
type SyncHandler struct {
	db          *sql.DB
	zernioKey   string
	zernioBase  string
	rateLimiter chan struct{} // token bucket: 1 token/3s = 20 req/min
}

func NewSyncHandler(db *sql.DB, zernioKey string) *SyncHandler {
	rl := make(chan struct{}, 2)
	go func() {
		tk := time.NewTicker(3 * time.Second)
		defer tk.Stop()
		for range tk.C {
			select {
			case rl <- struct{}{}:
			default:
			}
		}
	}()
	return &SyncHandler{db: db, zernioKey: zernioKey, zernioBase: "https://zernio.com/api/v1", rateLimiter: rl}
}

func (h *SyncHandler) acquireToken(ctx context.Context) error {
	select {
	case <-h.rateLimiter:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// getZernioKey returns the Zernio API key for the given tenant.
// It checks workspace_settings for a per-tenant override (key = 'zernio_api_key').
// The global environment key belongs only to the legacy default workspace; using
// it for another tenant would expose that workspace's WhatsApp account.
func (h *SyncHandler) getZernioKey(ctx context.Context, tenantID string) string {
	var value sql.NullString
	_ = h.db.QueryRowContext(ctx,
		`SELECT value FROM workspace_settings WHERE tenant_id = $1 AND key = 'zernio_api_key'`,
		tenantID,
	).Scan(&value)
	if value.Valid && value.String != "" {
		return value.String
	}
	if tenantID == defaultTenantID {
		return h.zernioKey
	}
	return ""
}

type zernioConversation struct {
	ID                  string `json:"id"`
	AccountID           string `json:"accountId"`
	Platform            string `json:"platform"` // "whatsapp" | "facebook" | etc.
	ParticipantID       string `json:"participantId"`
	ParticipantName     string `json:"participantName"`
	ParticipantUsername string `json:"participantUsername"`
	ParticipantPicture  string `json:"participantPicture"`
	LastMessage         string `json:"lastMessage"`
	UpdatedTime         string `json:"updatedTime"`
	UnreadCount         int    `json:"unreadCount"`
	Status              string `json:"status"`
}

// SyncProgress is emitted as SSE events during sync.
type SyncProgress struct {
	Phase   string `json:"phase"`   // "counting" | "syncing" | "done" | "error"
	Total   int    `json:"total"`   // estimated total conversations
	Synced  int    `json:"synced"`  // synced so far
	Percent int    `json:"percent"` // 0-100
	Message string `json:"message"`
}

// Sync streams SSE progress while pulling conversations (full or incremental).
// Pass ?since=<RFC3339> for incremental sync — only fetches conversations updated after that time.
func (h *SyncHandler) Sync(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	emit := func(p SyncProgress) {
		b, _ := json.Marshal(p)
		fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
	}

	tenantID := tenantIDFromRequest(r)
	key := h.getZernioKey(r.Context(), tenantID)

	since := parseSince(r.URL.Query().Get("since"))

	progressCh := make(chan SyncProgress, 50)

	// Run sync in background — detached from HTTP request context so that a
	// browser/proxy 30-second timeout does not kill a long full sync.
	syncCtx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	go func() {
		defer cancel()
		defer close(progressCh)

		progressFn := func(p SyncProgress) {
			select {
			case progressCh <- p:
			default: // channel full or client gone, skip
			}
		}

		count, err := h.syncConversations(syncCtx, tenantID, key, since, progressFn)
		if err != nil {
			log.Printf("sync: %v", err)
			select {
			case progressCh <- SyncProgress{Phase: "error", Message: err.Error()}:
			default:
			}
			return
		}
		select {
		case progressCh <- SyncProgress{Phase: "done", Synced: count, Total: count, Percent: 100,
			Message: fmt.Sprintf("Synced %d conversations", count)}:
		default:
		}
	}()

	emit(SyncProgress{Phase: "counting", Message: "Counting conversations in Zernio…"})

	// Proactively close the SSE stream after 25s — before Railway's 30s proxy
	// timeout kills the TCP connection, which would leave the browser with a
	// network error instead of a clean "background" event.
	streamTimer := time.NewTimer(25 * time.Second)
	defer streamTimer.Stop()
	for {
		select {
		case p, ok := <-progressCh:
			if !ok {
				return // goroutine done
			}
			emit(p)
		case <-streamTimer.C:
			// Proactively close before Railway's 30s proxy timeout.
			emit(SyncProgress{Phase: "background", Message: "Sync continues in background"})
			return
		case <-r.Context().Done():
			// Client disconnected — sync continues in background goroutine.
			emit(SyncProgress{Phase: "background", Message: "Sync continues in background"})
			return
		}
	}
}

// SyncJSON is a non-streaming version — used for background incremental syncs.
// Pass ?since=<RFC3339> to only fetch conversations updated after that time.
func (h *SyncHandler) SyncJSON(w http.ResponseWriter, r *http.Request) {
	tenantID := tenantIDFromRequest(r)
	key := h.getZernioKey(r.Context(), tenantID)

	since := parseSince(r.URL.Query().Get("since"))
	count, err := h.syncConversations(r.Context(), tenantID, key, since, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"synced": count, "syncedAt": time.Now().UTC().Format(time.RFC3339)})
}

// SyncSince is called by the background worker — incremental sync since a given time.
// Syncs whatsapp first, then facebook so existing facebook rows stored with the wrong
// platform get corrected via the ON CONFLICT platform update.
func (h *SyncHandler) SyncSince(ctx context.Context, since time.Time) (int, error) {
	total, err := h.syncPlatform(ctx, defaultTenantID, h.zernioKey, "whatsapp", since, nil)
	if err != nil {
		return total, err
	}
	// Correct any facebook conversations that were previously stored as whatsapp.
	// We ignore the count and errors here — facebook sync is best-effort.
	fbCount, fbErr := h.syncPlatform(ctx, defaultTenantID, h.zernioKey, "facebook", since, nil)
	if fbErr != nil {
		log.Printf("[sync] facebook correction pass error (non-fatal): %v", fbErr)
	} else {
		log.Printf("[sync] facebook correction pass: %d conversations", fbCount)
	}
	return total, nil
}

func parseSince(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}

// fetchPage fetches a single Zernio API page with retry on 429, 5xx, and network errors.
func (h *SyncHandler) fetchPage(ctx context.Context, url, key string) ([]byte, int, error) {
	if err := h.acquireToken(ctx); err != nil {
		return nil, 0, err
	}
	const max429 = 5
	const max5xx = 3
	const maxNet = 3
	retries429 := 0
	retries5xx := 0
	retriesNet := 0
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, 0, err
		}
		req.Header.Set("Authorization", "Bearer "+key)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			retriesNet++
			if retriesNet > maxNet {
				return nil, 0, fmt.Errorf("zernio fetch: %w", err)
			}
			log.Printf("[sync] network error, waiting 3s (retry %d/%d): %v", retriesNet, maxNet, err)
			select {
			case <-ctx.Done():
				return nil, 0, ctx.Err()
			case <-time.After(3 * time.Second):
			}
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode == 429 {
			retries429++
			if retries429 > max429 {
				return nil, resp.StatusCode, fmt.Errorf("zernio rate limit after %d retries: %s", max429, string(body))
			}
			delay := 5 * time.Second
			if ra := resp.Header.Get("Retry-After"); ra != "" {
				if secs, err := strconv.Atoi(ra); err == nil && secs > 0 {
					delay = time.Duration(secs) * time.Second
				}
			}
			log.Printf("[sync] rate limited, waiting %s (retry %d/%d)", delay, retries429, max429)
			select {
			case <-ctx.Done():
				return nil, 0, ctx.Err()
			case <-time.After(delay):
			}
			continue
		}
		if resp.StatusCode >= 500 {
			retries5xx++
			if retries5xx > max5xx {
				return nil, resp.StatusCode, fmt.Errorf("zernio server error %d after %d retries: %s", resp.StatusCode, max5xx, string(body))
			}
			log.Printf("[sync] server error %d, waiting 2s (retry %d/%d)", resp.StatusCode, retries5xx, max5xx)
			select {
			case <-ctx.Done():
				return nil, 0, ctx.Err()
			case <-time.After(2 * time.Second):
			}
			continue
		}
		return body, resp.StatusCode, nil
	}
}

func (h *SyncHandler) syncConversations(ctx context.Context, tenantID string, key string, since time.Time, emit func(SyncProgress)) (int, error) {
	return h.syncPlatform(ctx, tenantID, key, "whatsapp", since, emit)
}

func (h *SyncHandler) syncPlatform(ctx context.Context, tenantID string, key string, platform string, since time.Time, emit func(SyncProgress)) (int, error) {
	syncMode := "full"
	if !since.IsZero() {
		syncMode = "incremental since " + since.Format(time.RFC3339)
	}
	log.Printf("[sync] starting %s sync platform=%s tenant=%s", syncMode, platform, tenantID)

	cursor := ""
	total := 0
	estimated := 0
	cutoff := time.Now().AddDate(0, -6, 0)
	if !since.IsZero() {
		cutoff = since
	}
	page := 0

	for {
		url := h.zernioBase + "/inbox/conversations?platform=" + platform + "&limit=50"
		if cursor != "" {
			url += "&cursor=" + cursor
		}
		log.Printf("[sync] fetching page %d (tenant=%s, synced=%d so far)", page+1, tenantID, total)

		body, status, err := h.fetchPage(ctx, url, key)
		if err != nil {
			log.Printf("[sync] FAILED at page %d after syncing %d conversations (tenant=%s): %v", page+1, total, tenantID, err)
			return total, err
		}
		if status >= 400 {
			errMsg := extractJSONError(body)
			log.Printf("[sync] FAILED at page %d — Zernio returned HTTP %d (tenant=%s): body_len=%d msg=%s", page+1, status, tenantID, len(body), errMsg)
			return total, fmt.Errorf("zernio error %d: %s", status, errMsg)
		}

		var pageData struct {
			Data       []zernioConversation `json:"data"`
			Pagination struct {
				HasMore    bool   `json:"hasMore"`
				NextCursor string `json:"nextCursor"`
			} `json:"pagination"`
		}
		if err := json.Unmarshal(body, &pageData); err != nil {
			log.Printf("[sync] FAILED — could not decode page %d response (tenant=%s): %v | body_len=%d", page+1, tenantID, err, len(body))
			return total, fmt.Errorf("decode page: %w", err)
		}

		page++
		if page == 1 && pageData.Pagination.HasMore {
			estimated = 200 // rough estimate before we know total
		}
		if estimated == 0 {
			estimated = len(pageData.Data)
		}

		pageHitWindow := 0
		for _, conv := range pageData.Data {
			if conv.UpdatedTime != "" {
				t, err := time.Parse(time.RFC3339, conv.UpdatedTime)
				if err == nil && t.Before(cutoff) {
					continue
				}
			}
			pageHitWindow++
			if err := h.upsertConversation(ctx, tenantID, conv); err != nil {
				log.Printf("sync conv %s: %v", conv.ID, err)
				continue
			}
			total++
			if estimated > 0 && estimated < total+1 {
				estimated = total + 50
			}
			if emit != nil {
				pct := 0
				if estimated > 0 {
					pct = total * 100 / estimated
					if pct > 99 {
						pct = 99
					}
				}
				emit(SyncProgress{
					Phase:   "syncing",
					Synced:  total,
					Total:   estimated,
					Percent: pct,
					Message: fmt.Sprintf("Syncing conversation %d…", total),
				})
			}
		}
		reachedEnd := pageHitWindow == 0

		if reachedEnd || !pageData.Pagination.HasMore || pageData.Pagination.NextCursor == "" {
			break
		}
		cursor = pageData.Pagination.NextCursor
	}
	log.Printf("[sync] done — synced %d conversations across %d pages (tenant=%s, platform=%s, mode=%s)", total, page, tenantID, platform, syncMode)
	return total, nil
}

func (h *SyncHandler) upsertConversation(ctx context.Context, tenantID string, conv zernioConversation) error {
	phone := strings.ReplaceAll(conv.ParticipantUsername, " ", "")
	if phone == "" {
		// ParticipantID is an internal MongoDB ObjectID, not a phone — use conv.ID
		// so the fallback matches the autoCreateConversation pattern and can be healed.
		phone = "+unknown-" + conv.ID
	}
	if !strings.HasPrefix(phone, "+") {
		phone = "+" + phone
	}

	name := conv.ParticipantName
	if name == "" || name == conv.ParticipantID {
		name = phone
	}

	avatarURL := conv.ParticipantPicture

	var studentID string
	err := h.db.QueryRowContext(ctx,
		`INSERT INTO students (name, phone, avatar_url, tenant_id, created_at, updated_at)
		 VALUES ($1, $2, $3, $4::uuid, NOW(), NOW())
		 ON CONFLICT (phone) DO UPDATE
		   SET name = EXCLUDED.name,
		       avatar_url = CASE WHEN EXCLUDED.avatar_url IS NOT NULL AND EXCLUDED.avatar_url != '' THEN EXCLUDED.avatar_url ELSE students.avatar_url END,
		       updated_at = NOW()
		 RETURNING id`,
		name, phone, sql.NullString{String: avatarURL, Valid: avatarURL != ""}, tenantID,
	).Scan(&studentID)
	if err != nil {
		return fmt.Errorf("upsert student: %w", err)
	}

	var lastMsgAt interface{}
	if conv.UpdatedTime != "" {
		t, err := time.Parse(time.RFC3339, conv.UpdatedTime)
		if err == nil {
			lastMsgAt = t
		}
	}

	platform := conv.Platform
	if platform == "" {
		platform = "whatsapp" // default: we queried with ?platform=whatsapp
	}

	_, err = h.db.ExecContext(ctx,
		`INSERT INTO conversations
		    (student_id, platform, last_message, last_message_at, unread_count, zernio_conversation_id, tenant_id, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, NOW(), NOW())
		 ON CONFLICT (zernio_conversation_id) DO UPDATE
		    SET student_id      = EXCLUDED.student_id,
		        platform        = EXCLUDED.platform,
		        last_message    = EXCLUDED.last_message,
		        last_message_at = EXCLUDED.last_message_at,
		        unread_count    = EXCLUDED.unread_count,
		        tenant_id       = EXCLUDED.tenant_id,
		        updated_at      = NOW()`,
		studentID, platform, conv.LastMessage, lastMsgAt, conv.UnreadCount, conv.ID, tenantID,
	)
	if err != nil {
		return fmt.Errorf("upsert conversation: %w", err)
	}

	// Remove any +unknown- placeholder student that is now orphaned because the
	// conversation was re-linked to the real student by the upsert above.
	_, _ = h.db.ExecContext(ctx,
		`DELETE FROM students
		 WHERE phone LIKE '+unknown-%'
		   AND NOT EXISTS (
		       SELECT 1 FROM conversations WHERE student_id = students.id
		   )`,
	)

	return nil
}

// extractJSONError pulls only the "error" or "message" string from a JSON
// error body so we can log a safe, non-PII summary.
func extractJSONError(body []byte) string {
	var v struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &v); err == nil {
		if v.Error != "" {
			return v.Error
		}
		if v.Message != "" {
			return v.Message
		}
	}
	return fmt.Sprintf("(unparseable, len=%d)", len(body))
}
