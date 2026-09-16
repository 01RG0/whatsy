package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
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

	dbURL := os.Getenv("DATABASE_URL")
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

	// Full 6-month sync on startup to catch any gaps
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
			since := time.Now().Add(-(interval + time.Minute)) // slight overlap to avoid gaps
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
	ParticipantID       string `json:"participantId"`
	ParticipantName     string `json:"participantName"`
	ParticipantUsername string `json:"participantUsername"`
	ParticipantPicture  string `json:"participantPicture"`
	LastMessage         string `json:"lastMessage"`
	UpdatedTime         string `json:"updatedTime"`
	UnreadCount         int    `json:"unreadCount"`
}

func (w *worker) sync(ctx context.Context, since time.Time) (int, error) {
	cutoff := time.Now().AddDate(0, -6, 0)
	if !since.IsZero() {
		cutoff = since
	}

	cursor := ""
	total := 0

	for {
		url := w.zernioBase + "/inbox/conversations?platform=whatsapp&limit=50"
		if cursor != "" {
			url += "&cursor=" + cursor
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
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
			if err := w.upsert(ctx, conv); err != nil {
				log.Printf("upsert %s: %v", conv.ID, err)
				continue
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

func (w *worker) upsert(ctx context.Context, conv zernioConv) error {
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
		return fmt.Errorf("upsert student: %w", err)
	}

	var lastMsgAt interface{}
	if conv.UpdatedTime != "" {
		if t, err := time.Parse(time.RFC3339, conv.UpdatedTime); err == nil {
			lastMsgAt = t
		}
	}

	_, err = w.db.ExecContext(ctx,
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
	return err
}
