package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
)

const defaultTenantID = "00000000-0000-0000-0000-000000000001"

func main() {
	_ = godotenv.Load()

	dbURL := firstNonEmpty(os.Getenv("DIRECT_DATABASE_URL"), os.Getenv("DATABASE_URL"))
	zernioKey := os.Getenv("ZERNIO_API_KEY")
	if dbURL == "" || zernioKey == "" {
		log.Fatal("DATABASE_URL and ZERNIO_API_KEY are required")
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		log.Fatalf("ping db: %v", err)
	}

	// Token bucket: 1 token every 3s = 20 req/min, burst of 2.
	// Leaves ~40 req/min headroom for the backend (sends, reads, webhooks).
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

	w := &worker{db: db, zernioKey: zernioKey, zernioBase: "https://zernio.com/api/v1", rateLimiter: rl}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	interval := 5 * time.Minute
	log.Printf("sync worker started — interval %s", interval)

	// Startup lock: skip full sync if completed less than 2 hours ago.
	startCursor := ""
	skipFull := false
	if lastStr, err := w.getSetting(defaultTenantID, "last_full_sync_at"); err == nil && lastStr != "" {
		if last, err := time.Parse(time.RFC3339, lastStr); err == nil {
			age := time.Since(last)
			if age < 2*time.Hour {
				log.Printf("startup: skipping full sync, last ran %.0f minutes ago", age.Minutes())
				skipFull = true
			}
		}
	}
	if !skipFull {
		// Resume from saved cursor if a previous full sync was interrupted.
		if c, err := w.getSetting(defaultTenantID, "worker_sync_cursor"); err == nil {
			startCursor = c
		}
		if startCursor != "" {
			log.Printf("startup: resuming full sync from saved cursor")
		} else {
			log.Println("startup: running full sync...")
		}
		if n, err := w.sync(context.Background(), time.Time{}, startCursor); err != nil {
			log.Printf("startup sync error: %v", err)
		} else {
			log.Printf("startup sync done: %d conversations", n)
			// Clear cursor and record completion time.
			_ = w.deleteSetting(defaultTenantID, "worker_sync_cursor")
			_ = w.setSetting(defaultTenantID, "last_full_sync_at", time.Now().UTC().Format(time.RFC3339))
		}
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-quit:
			log.Println("worker shutting down")
			return
		case <-ticker.C:
			since := time.Now().Add(-(interval + time.Minute))
			ctx, cancel := context.WithTimeout(context.Background(), interval-30*time.Second)
			n, err := w.sync(ctx, since, "")
			cancel()
			if err != nil {
				log.Printf("sync error: %v", err)
			} else if n > 0 {
				log.Printf("synced %d conversations", n)
			}
		}
	}
}

type worker struct {
	db          *sql.DB
	zernioKey   string
	zernioBase  string
	rateLimiter chan struct{} // token-bucket: 20 req/min to Zernio
}

type zernioConv struct {
	ID                  string `json:"id"`
	AccountID           string `json:"accountId"`
	ParticipantID       string `json:"participantId"`
	ParticipantName     string `json:"participantName"`
	ParticipantUsername string `json:"participantUsername"`
	ParticipantPicture  string `json:"participantPicture"`
	LastMessage         string `json:"lastMessage"`
	UpdatedTime         string `json:"updatedTime"`
	UnreadCount         int    `json:"unreadCount"`
}

// zernioMessage mirrors the Zernio list-messages response item.
type zernioMessage struct {
	ID             string          `json:"id"`
	ConversationID string          `json:"conversationId"`
	Message        string          `json:"message"`
	Type           string          `json:"type"`
	Direction      string          `json:"direction"`
	DeliveryStatus string          `json:"deliveryStatus"`
	SentAt         time.Time       `json:"sentAt"`
	CreatedAt      time.Time       `json:"createdAt"`
	Attachments    json.RawMessage `json:"attachments"`
	Contacts       []struct {
		Name struct {
			FormattedName string `json:"formatted_name"`
		} `json:"name"`
		Phones []struct {
			Phone string `json:"phone"`
		} `json:"phones"`
	} `json:"contacts"`
}

// acquireToken blocks until a rate-limit token is available or ctx is done.
func (w *worker) acquireToken(ctx context.Context) error {
	select {
	case <-w.rateLimiter:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// doGet performs a rate-limited GET with retry on 429 and network errors.
func (w *worker) doGet(ctx context.Context, apiURL string) ([]byte, error) {
	const max429 = 5
	const maxNet = 3
	retries429 := 0
	retriesNet := 0

	for {
		if err := w.acquireToken(ctx); err != nil {
			return nil, err
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+w.zernioKey)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			retriesNet++
			if retriesNet > maxNet {
				return nil, fmt.Errorf("network error after %d retries: %w", maxNet, err)
			}
			log.Printf("[worker] network error (retry %d/%d): %v", retriesNet, maxNet, err)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(3 * time.Second):
			}
			continue
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode == 429 {
			retries429++
			if retries429 > max429 {
				return nil, fmt.Errorf("rate limited after %d retries", max429)
			}
			delay := 5 * time.Second
			if ra := resp.Header.Get("Retry-After"); ra != "" {
				if secs, err := strconv.Atoi(ra); err == nil && secs > 0 {
					delay = time.Duration(secs) * time.Second
				}
			} else {
				// Parse retryAfterSeconds from JSON body.
				var errBody struct {
					Details struct {
						RetryAfterSeconds int `json:"retryAfterSeconds"`
					} `json:"details"`
				}
				if json.Unmarshal(body, &errBody) == nil && errBody.Details.RetryAfterSeconds > 0 {
					delay = time.Duration(errBody.Details.RetryAfterSeconds) * time.Second
				}
			}
			log.Printf("[worker] rate limited, waiting %s (retry %d/%d)", delay, retries429, max429)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delay):
			}
			continue
		}

		if resp.StatusCode >= 500 {
			return nil, fmt.Errorf("server error %d", resp.StatusCode)
		}

		if resp.StatusCode >= 400 {
			return nil, fmt.Errorf("zernio %d", resp.StatusCode)
		}

		return body, nil
	}
}

// sync fetches conversations updated since `since` (zero = all 6 months).
// startCursor resumes a previous interrupted full sync.
func (w *worker) sync(ctx context.Context, since time.Time, startCursor string) (int, error) {
	cutoff := time.Now().AddDate(0, -6, 0)
	if !since.IsZero() {
		cutoff = since
	}
	isFullSync := since.IsZero()

	cursor := startCursor
	total := 0

	for {
		apiURL := w.zernioBase + "/inbox/conversations?platform=whatsapp&limit=50"
		if cursor != "" {
			apiURL += "&cursor=" + cursor
		}

		body, err := w.doGet(ctx, apiURL)
		if err != nil {
			return total, fmt.Errorf("fetch conversations: %w", err)
		}

		var page struct {
			Data       []zernioConv `json:"data"`
			Pagination struct {
				HasMore    bool   `json:"hasMore"`
				NextCursor string `json:"nextCursor"`
			} `json:"pagination"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return total, fmt.Errorf("decode: %w", err)
		}

		reachedEnd := false
		for _, conv := range page.Data {
			if conv.UpdatedTime != "" {
				t, err := time.Parse(time.RFC3339, conv.UpdatedTime)
				if err == nil && t.Before(cutoff) {
					reachedEnd = true
					break
				}
			}
			dbConvID, err := w.upsertConversation(ctx, conv)
			if err != nil {
				log.Printf("upsert conv %s: %v", conv.ID, err)
				continue
			}
			// Only sync messages for conversations active in the last 48h.
			// Older conversations have their metadata updated via upsertConversation;
			// full message history is fetched on-demand when an agent opens the chat.
			if conv.UpdatedTime != "" {
				if t, err := time.Parse(time.RFC3339, conv.UpdatedTime); err == nil && time.Since(t) < 48*time.Hour {
					if err := w.syncMessages(ctx, conv.ID, conv.AccountID, dbConvID); err != nil {
						log.Printf("sync messages %s: %v", conv.ID, err)
					}
				}
			}
			total++
		}

		if reachedEnd || !page.Pagination.HasMore || page.Pagination.NextCursor == "" {
			break
		}
		cursor = page.Pagination.NextCursor

		// Persist cursor after each page so restarts can resume.
		if isFullSync {
			_ = w.setSetting(defaultTenantID, "worker_sync_cursor", cursor)
		}
	}
	return total, nil
}

func (w *worker) upsertConversation(ctx context.Context, conv zernioConv) (string, error) {
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

	var studentID string
	err := w.db.QueryRowContext(ctx,
		`INSERT INTO students (name, phone, avatar_url, created_at, updated_at)
		 VALUES ($1, $2, $3, NOW(), NOW())
		 ON CONFLICT (phone) DO UPDATE
		   SET name = EXCLUDED.name,
		       avatar_url = CASE WHEN EXCLUDED.avatar_url IS NOT NULL AND EXCLUDED.avatar_url != '' THEN EXCLUDED.avatar_url ELSE students.avatar_url END,
		       updated_at = NOW()
		 RETURNING id`,
		name, phone,
		sql.NullString{String: conv.ParticipantPicture, Valid: conv.ParticipantPicture != ""},
	).Scan(&studentID)
	if err != nil {
		return "", fmt.Errorf("upsert student: %w", err)
	}

	var lastMsgAt interface{}
	if conv.UpdatedTime != "" {
		if t, err := time.Parse(time.RFC3339, conv.UpdatedTime); err == nil {
			lastMsgAt = t
		}
	}

	var dbConvID string
	err = w.db.QueryRowContext(ctx,
		`INSERT INTO conversations
		    (student_id, platform, last_message, last_message_at, unread_count, zernio_conversation_id, created_at, updated_at)
		 VALUES ($1, 'whatsapp', $2, $3, $4, $5, NOW(), NOW())
		 ON CONFLICT (zernio_conversation_id) DO UPDATE
		    SET last_message    = EXCLUDED.last_message,
		        last_message_at = EXCLUDED.last_message_at,
		        updated_at      = NOW()
		 RETURNING id`,
		studentID, conv.LastMessage, lastMsgAt, conv.UnreadCount, conv.ID,
	).Scan(&dbConvID)
	return dbConvID, err
}

// syncMessages fetches all messages for a conversation using the shared rate limiter.
func (w *worker) syncMessages(ctx context.Context, zernioConvID, accountID, dbConvID string) error {
	if accountID == "" {
		return nil
	}

	cursor := ""
	for {
		apiURL := w.zernioBase + "/inbox/conversations/" + url.PathEscape(zernioConvID) +
			"/messages?accountId=" + url.QueryEscape(accountID) + "&limit=100&sortOrder=asc"
		if cursor != "" {
			apiURL += "&cursor=" + url.QueryEscape(cursor)
		}

		body, err := w.doGet(ctx, apiURL)
		if err != nil {
			return fmt.Errorf("fetch messages: %w", err)
		}

		var page struct {
			Messages   []zernioMessage `json:"messages"`
			Pagination struct {
				HasMore    bool   `json:"hasMore"`
				NextCursor string `json:"nextCursor"`
			} `json:"pagination"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return fmt.Errorf("decode messages: %w", err)
		}

		for _, msg := range page.Messages {
			if err := w.upsertMessage(ctx, dbConvID, msg); err != nil {
				log.Printf("upsert message %s: %v", msg.ID, err)
			}
		}

		if !page.Pagination.HasMore || page.Pagination.NextCursor == "" {
			break
		}
		cursor = page.Pagination.NextCursor
	}
	return nil
}

func (w *worker) upsertMessage(ctx context.Context, dbConvID string, msg zernioMessage) error {
	direction := "inbound"
	if msg.Direction == "outgoing" {
		direction = "outbound"
	}

	status := msg.DeliveryStatus
	if status == "" {
		status = "sent"
	}

	ts := msg.SentAt
	if ts.IsZero() {
		ts = msg.CreatedAt
	}
	if ts.IsZero() {
		ts = time.Now().UTC()
	}

	attachmentsJSON := "[]"
	if len(msg.Attachments) > 0 && string(msg.Attachments) != "null" {
		attachmentsJSON = string(msg.Attachments)
	}

	contentType := msg.Type
	if contentType == "" {
		var attachList []struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(msg.Attachments, &attachList) == nil && len(attachList) > 0 && attachList[0].Type != "" {
			contentType = attachList[0].Type
		}
	}
	if contentType == "" {
		contentType = "text"
	}

	content := msg.Message
	contactPhone := ""
	if contentType == "contacts" && len(msg.Contacts) > 0 {
		c := msg.Contacts[0]
		if content == "" && c.Name.FormattedName != "" {
			content = c.Name.FormattedName
		}
		if len(c.Phones) > 0 {
			contactPhone = c.Phones[0].Phone
		}
	}

	var msgID string
	err := w.db.QueryRowContext(ctx,
		`INSERT INTO messages
		    (conversation_id, direction, content_type, content, status, zernio_message_id, attachments, timestamp, contact_phone)
		 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
		 ON CONFLICT (zernio_message_id) DO NOTHING
		 RETURNING id`,
		dbConvID, direction, contentType, content, status,
		msg.ID, attachmentsJSON, ts, contactPhone,
	).Scan(&msgID)
	if err == sql.ErrNoRows {
		return nil
	}
	return err
}

// --- workspace_settings helpers ---

func (w *worker) getSetting(tenantID, key string) (string, error) {
	var value string
	err := w.db.QueryRow(
		`SELECT value FROM workspace_settings WHERE tenant_id = $1 AND key = $2`,
		tenantID, key,
	).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

func (w *worker) setSetting(tenantID, key, value string) error {
	_, err := w.db.Exec(
		`INSERT INTO workspace_settings (tenant_id, key, value)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
		tenantID, key, value,
	)
	return err
}

func (w *worker) deleteSetting(tenantID, key string) error {
	_, err := w.db.Exec(
		`DELETE FROM workspace_settings WHERE tenant_id = $1 AND key = $2`,
		tenantID, key,
	)
	return err
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
