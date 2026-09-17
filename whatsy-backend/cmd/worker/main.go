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
	"strings"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
)

func main() {
	_ = godotenv.Load()

	// Prefer DIRECT_DATABASE_URL (bypasses PgBouncer, avoids prepared-statement
	// cache collisions that occur in transaction-mode pooling).
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

	w := &worker{db: db, zernioKey: zernioKey, zernioBase: "https://zernio.com/api/v1"}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	interval := 5 * time.Minute
	log.Printf("sync worker started — interval %s", interval)

	log.Println("startup: running full sync...")
	if n, err := w.sync(context.Background(), time.Time{}); err != nil {
		log.Printf("startup sync error: %v", err)
	} else {
		log.Printf("startup sync done: %d conversations", n)
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
			n, err := w.sync(ctx, since)
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
	db         *sql.DB
	zernioKey  string
	zernioBase string
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
	Type           string          `json:"type"`           // text, image, audio, video, document, etc.
	Direction      string          `json:"direction"`      // incoming | outgoing
	DeliveryStatus string          `json:"deliveryStatus"` // pending, sent, delivered, read, failed
	SentAt         time.Time       `json:"sentAt"`
	CreatedAt      time.Time       `json:"createdAt"`
	Attachments    json.RawMessage `json:"attachments"` // store raw to preserve all fields
}

func (w *worker) sync(ctx context.Context, since time.Time) (int, error) {
	cutoff := time.Now().AddDate(0, -6, 0)
	if !since.IsZero() {
		cutoff = since
	}

	cursor := ""
	total := 0

	for {
		apiURL := w.zernioBase + "/inbox/conversations?platform=whatsapp&limit=50"
		if cursor != "" {
			apiURL += "&cursor=" + cursor
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
		if err != nil {
			return total, err
		}
		req.Header.Set("Authorization", "Bearer "+w.zernioKey)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return total, fmt.Errorf("zernio fetch: %w", err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode >= 400 {
			return total, fmt.Errorf("zernio %d: %s", resp.StatusCode, string(body))
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
			if err := w.syncMessages(ctx, conv.ID, conv.AccountID, dbConvID); err != nil {
				log.Printf("sync messages %s: %v", conv.ID, err)
			}
			total++
		}

		if reachedEnd || !page.Pagination.HasMore || page.Pagination.NextCursor == "" {
			break
		}
		cursor = page.Pagination.NextCursor
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
		        unread_count    = EXCLUDED.unread_count,
		        updated_at      = NOW()
		 RETURNING id`,
		studentID, conv.LastMessage, lastMsgAt, conv.UnreadCount, conv.ID,
	).Scan(&dbConvID)
	return dbConvID, err
}

// syncMessages fetches all messages for a conversation from Zernio (paginated)
// and upserts them into the messages table.
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

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+w.zernioKey)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return fmt.Errorf("fetch messages: %w", err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode >= 400 {
			return fmt.Errorf("zernio messages %d: %s", resp.StatusCode, string(body))
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

	// Preserve all attachment fields as raw JSON from Zernio.
	attachmentsJSON := "[]"
	if len(msg.Attachments) > 0 && string(msg.Attachments) != "null" {
		attachmentsJSON = string(msg.Attachments)
	}

	// Derive content type: use Zernio's type field, fall back to text.
	contentType := msg.Type
	if contentType == "" {
		// If attachments present, try to infer from first attachment type.
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

	_, err := w.db.ExecContext(ctx,
		`INSERT INTO messages
		    (conversation_id, direction, content_type, content, status, zernio_message_id, attachments, timestamp)
		 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
		 ON CONFLICT (zernio_message_id) DO NOTHING`,
		dbConvID, direction, contentType, msg.Message, status,
		msg.ID, attachmentsJSON, ts,
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
