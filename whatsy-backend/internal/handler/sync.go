package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// SyncHandler pulls conversations from Zernio and seeds the local DB.
type SyncHandler struct {
	db         *sql.DB
	zernioKey  string
	zernioBase string
}

func NewSyncHandler(db *sql.DB, zernioKey string) *SyncHandler {
	return &SyncHandler{db: db, zernioKey: zernioKey, zernioBase: "https://zernio.com/api/v1"}
}

type zernioConversation struct {
	ID                   string `json:"id"`
	AccountID            string `json:"accountId"`
	ParticipantID        string `json:"participantId"`
	ParticipantName      string `json:"participantName"`
	ParticipantUsername  string `json:"participantUsername"`
	ParticipantPicture   string `json:"participantPicture"`
	LastMessage          string `json:"lastMessage"`
	UpdatedTime          string `json:"updatedTime"`
	UnreadCount          int    `json:"unreadCount"`
	Status               string `json:"status"`
}

// SyncProgress is emitted as SSE events during sync.
type SyncProgress struct {
	Phase     string `json:"phase"`      // "counting" | "syncing" | "done" | "error"
	Total     int    `json:"total"`      // estimated total conversations
	Synced    int    `json:"synced"`     // synced so far
	Percent   int    `json:"percent"`    // 0-100
	Message   string `json:"message"`
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

	since := parseSince(r.URL.Query().Get("since"))
	ctx := r.Context()
	emit(SyncProgress{Phase: "counting", Message: "Counting conversations in Zernio…"})

	count, err := h.syncConversations(ctx, since, emit)
	if err != nil {
		log.Printf("sync: %v", err)
		emit(SyncProgress{Phase: "error", Message: err.Error()})
		return
	}
	emit(SyncProgress{Phase: "done", Synced: count, Total: count, Percent: 100,
		Message: fmt.Sprintf("Synced %d conversations", count)})
}

// SyncJSON is a non-streaming version — used for background incremental syncs.
// Pass ?since=<RFC3339> to only fetch conversations updated after that time.
func (h *SyncHandler) SyncJSON(w http.ResponseWriter, r *http.Request) {
	since := parseSince(r.URL.Query().Get("since"))
	count, err := h.syncConversations(r.Context(), since, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"synced": count, "syncedAt": time.Now().UTC().Format(time.RFC3339)})
}

// SyncSince is called by the background worker — incremental sync since a given time.
func (h *SyncHandler) SyncSince(ctx context.Context, since time.Time) (int, error) {
	return h.syncConversations(ctx, since, nil)
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

func (h *SyncHandler) syncConversations(ctx context.Context, since time.Time, emit func(SyncProgress)) (int, error) {
	cursor := ""
	total := 0
	estimated := 0
	// cutoff: use 'since' for incremental, 6 months ago for full sync
	cutoff := time.Now().AddDate(0, -6, 0)
	if !since.IsZero() {
		cutoff = since
	}
	page := 0

	for {
		url := h.zernioBase + "/inbox/conversations?platform=whatsapp&limit=50"
		if cursor != "" {
			url += "&cursor=" + cursor
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return total, err
		}
		req.Header.Set("Authorization", "Bearer "+h.zernioKey)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return total, fmt.Errorf("zernio fetch: %w", err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode >= 400 {
			return total, fmt.Errorf("zernio error %d: %s", resp.StatusCode, string(body))
		}

		var pageData struct {
			Data []zernioConversation `json:"data"`
			Pagination struct {
				HasMore    bool   `json:"hasMore"`
				NextCursor string `json:"nextCursor"`
			} `json:"pagination"`
		}
		if err := json.Unmarshal(body, &pageData); err != nil {
			return total, fmt.Errorf("decode page: %w", err)
		}

		page++
		if page == 1 && pageData.Pagination.HasMore {
			estimated = 200 // rough estimate before we know total
		}
		if estimated == 0 {
			estimated = len(pageData.Data)
		}

		reachedEnd := false
		for _, conv := range pageData.Data {
			if conv.UpdatedTime != "" {
				t, err := time.Parse(time.RFC3339, conv.UpdatedTime)
				if err == nil && t.Before(cutoff) {
					reachedEnd = true
					break
				}
			}
			if err := h.upsertConversation(ctx, conv); err != nil {
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

		if reachedEnd || !pageData.Pagination.HasMore || pageData.Pagination.NextCursor == "" {
			break
		}
		cursor = pageData.Pagination.NextCursor
	}
	return total, nil
}

func (h *SyncHandler) upsertConversation(ctx context.Context, conv zernioConversation) error {
	phone := strings.ReplaceAll(conv.ParticipantUsername, " ", "")
	if phone == "" {
		phone = "+" + conv.ParticipantID
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
		`INSERT INTO students (name, phone, avatar_url, created_at, updated_at)
		 VALUES ($1, $2, $3, NOW(), NOW())
		 ON CONFLICT (phone) DO UPDATE
		   SET name = EXCLUDED.name,
		       avatar_url = CASE WHEN EXCLUDED.avatar_url IS NOT NULL AND EXCLUDED.avatar_url != '' THEN EXCLUDED.avatar_url ELSE students.avatar_url END,
		       updated_at = NOW()
		 RETURNING id`,
		name, phone, sql.NullString{String: avatarURL, Valid: avatarURL != ""},
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

	_, err = h.db.ExecContext(ctx,
		`INSERT INTO conversations
		    (student_id, platform, last_message, last_message_at, unread_count, zernio_conversation_id, created_at, updated_at)
		 VALUES ($1, 'whatsapp', $2, $3, $4, $5, NOW(), NOW())
		 ON CONFLICT (zernio_conversation_id) DO UPDATE
		    SET last_message    = EXCLUDED.last_message,
		        last_message_at = EXCLUDED.last_message_at,
		        unread_count    = EXCLUDED.unread_count,
		        updated_at      = NOW()`,
		studentID, conv.LastMessage, lastMsgAt, conv.UnreadCount, conv.ID,
	)
	if err != nil {
		return fmt.Errorf("upsert conversation: %w", err)
	}
	return nil
}
