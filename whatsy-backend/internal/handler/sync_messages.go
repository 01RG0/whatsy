package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// syncMsgStates holds live message-sync progress keyed by tenantID.
var (
	syncMsgMu     sync.RWMutex
	syncMsgStates = map[string]*MsgSyncState{}
)

// MsgSyncState captures point-in-time progress of a running (or recently completed)
// message history sync for one tenant.
type MsgSyncState struct {
	Phase     string    `json:"phase"`     // "running" | "done" | "error"
	Current   int       `json:"current"`   // conversations processed so far
	Total     int       `json:"total"`     // total conversations
	Inserted  int       `json:"inserted"`  // messages inserted total
	Message   string    `json:"message"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// zernioMessage is the shape returned by the Zernio messages API.
type zernioMessage struct {
	ID                string `json:"id"`
	PlatformMessageID string `json:"platformMessageId"`
	Direction         string `json:"direction"` // "incoming" | "outgoing"
	Type              string `json:"type"`      // "text" | "image" | "audio" | "video" | "document"
	Content           string `json:"content"`
	Timestamp         string `json:"timestamp"`
	AttachmentURL     string `json:"attachmentUrl"`
	AttachmentType    string `json:"attachmentType"`
	AttachmentName    string `json:"attachmentName"`
}

// SyncMessagesStream is the SSE handler for message history sync.
// It follows the exact same pattern as Sync (conversations).
func (h *SyncHandler) SyncMessagesStream(w http.ResponseWriter, r *http.Request) {
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

	progressCh := make(chan SyncProgress, 50)

	// Detach from HTTP request context — same as Sync handler.
	syncCtx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	go func() {
		defer cancel()
		defer close(progressCh)

		// Initialise in-memory state so the /status endpoint can report progress
		// even after the SSE stream has closed.
		syncMsgMu.Lock()
		syncMsgStates[tenantID] = &MsgSyncState{Phase: "running", UpdatedAt: time.Now()}
		syncMsgMu.Unlock()

		progressFn := func(p SyncProgress) {
			select {
			case progressCh <- p:
			default:
			}
		}

		totalMsgs, totalConvs, err := h.syncAllMessages(syncCtx, tenantID, key, progressFn)
		if err != nil {
			log.Printf("[sync-msgs] error: %v", err)
			syncMsgMu.Lock()
			syncMsgStates[tenantID] = &MsgSyncState{Phase: "error", Message: err.Error(), UpdatedAt: time.Now()}
			syncMsgMu.Unlock()
			select {
			case progressCh <- SyncProgress{Phase: "error", Message: err.Error()}:
			default:
			}
			return
		}
		doneMsg := fmt.Sprintf("Synced %d messages from %d conversations", totalMsgs, totalConvs)
		syncMsgMu.Lock()
		syncMsgStates[tenantID] = &MsgSyncState{
			Phase:     "done",
			Current:   totalConvs,
			Total:     totalConvs,
			Inserted:  totalMsgs,
			Message:   doneMsg,
			UpdatedAt: time.Now(),
		}
		syncMsgMu.Unlock()
		select {
		case progressCh <- SyncProgress{
			Phase:   "done",
			Synced:  totalMsgs,
			Total:   totalMsgs,
			Percent: 100,
			Message: doneMsg,
		}:
		default:
		}
	}()

	emit(SyncProgress{Phase: "counting", Message: "Loading conversations…"})

	// Proactively close the SSE stream after 25s to beat Railway's 30s proxy timeout.
	streamTimer := time.NewTimer(25 * time.Second)
	defer streamTimer.Stop()
	for {
		select {
		case p, ok := <-progressCh:
			if !ok {
				return
			}
			emit(p)
		case <-streamTimer.C:
			emit(SyncProgress{Phase: "background", Message: "Sync continues in background"})
			return
		case <-r.Context().Done():
			emit(SyncProgress{Phase: "background", Message: "Sync continues in background"})
			return
		}
	}
}

// syncAllMessages fetches every message from every conversation for the tenant
// and inserts any that are not already in the local DB.
// Returns (totalMessagesInserted, totalConversationsProcessed, error).
func (h *SyncHandler) syncAllMessages(ctx context.Context, tenantID, key string, emit func(SyncProgress)) (int, int, error) {
	// 1. Get accountId from whatsapp_connections.
	var accountID string
	err := h.db.QueryRowContext(ctx,
		`SELECT account_id FROM whatsapp_connections
		 WHERE status = 'connected' AND tenant_id = $1::uuid
		 ORDER BY id DESC LIMIT 1`,
		tenantID,
	).Scan(&accountID)
	if err != nil {
		// Non-fatal: continue without accountId — some API versions don't need it.
		log.Printf("[sync-msgs] no connected whatsapp_connections for tenant=%s: %v", tenantID, err)
		accountID = ""
	}

	// 2. Load all conversations with a Zernio ID.
	rows, err := h.db.QueryContext(ctx,
		`SELECT id, zernio_conversation_id FROM conversations
		 WHERE tenant_id = $1::uuid
		   AND zernio_conversation_id IS NOT NULL
		   AND zernio_conversation_id != ''
		 ORDER BY last_message_at DESC NULLS LAST`,
		tenantID,
	)
	if err != nil {
		return 0, 0, fmt.Errorf("load conversations: %w", err)
	}
	type convRow struct {
		id      string
		zernioID string
	}
	var convs []convRow
	for rows.Next() {
		var c convRow
		if err := rows.Scan(&c.id, &c.zernioID); err != nil {
			continue
		}
		convs = append(convs, c)
	}
	rows.Close()

	totalConvs := len(convs)
	log.Printf("[sync-msgs] starting message sync for tenant=%s: %d conversations", tenantID, totalConvs)

	totalInserted := 0

	for i, conv := range convs {
		convNum := i + 1

		pct := (i * 100) / totalConvs
		if pct > 99 {
			pct = 99
		}
		msg := fmt.Sprintf("Syncing conversation %d/%d…", convNum, totalConvs)

		// Update in-memory state (polled by /status endpoint).
		syncMsgMu.Lock()
		if s := syncMsgStates[tenantID]; s != nil {
			s.Current = i
			s.Total = totalConvs
			s.Inserted = totalInserted
			s.Message = msg
			s.UpdatedAt = time.Now()
		}
		syncMsgMu.Unlock()

		if emit != nil {
			emit(SyncProgress{
				Phase:   "syncing",
				Synced:  totalInserted,
				Total:   totalConvs,
				Percent: pct,
				Message: msg,
			})
		}

		inserted, err := h.syncConversationMessages(ctx, conv.id, conv.zernioID, accountID, key)
		if err != nil {
			log.Printf("[sync-msgs] conversation %s (zernio_id=%s): %v — skipping", conv.id, conv.zernioID, err)
			// Non-fatal: continue with next conversation.
			continue
		}
		log.Printf("[sync-msgs] conversation %d/%d (zernio_id=%s, msgs=%d inserted)", convNum, totalConvs, conv.zernioID, inserted)
		totalInserted += inserted

		// Keep state up-to-date with the latest inserted count.
		syncMsgMu.Lock()
		if s := syncMsgStates[tenantID]; s != nil {
			s.Inserted = totalInserted
		}
		syncMsgMu.Unlock()

		// Pace to stay within Zernio rate limits.
		select {
		case <-ctx.Done():
			return totalInserted, convNum, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}

	log.Printf("[sync-msgs] done — inserted %d messages across %d conversations (tenant=%s)", totalInserted, totalConvs, tenantID)
	return totalInserted, totalConvs, nil
}

// syncConversationMessages paginates through a single conversation's messages
// and inserts any not already in the DB. Returns number of messages inserted.
func (h *SyncHandler) syncConversationMessages(ctx context.Context, localConvID, zernioConvID, accountID, key string) (int, error) {
	cursor := ""
	inserted := 0

	for {
		url := h.zernioBase + "/inbox/conversations/" + zernioConvID + "/messages?limit=100"
		if accountID != "" {
			url += "&accountId=" + accountID
		}
		if cursor != "" {
			url += "&cursor=" + cursor
		}

		body, status, err := h.fetchPage(ctx, url, key)
		if err != nil {
			return inserted, fmt.Errorf("fetch messages: %w", err)
		}
		if status >= 400 {
			errMsg := extractJSONError(body)
			return inserted, fmt.Errorf("zernio messages %d: %s", status, errMsg)
		}

		var pageData struct {
			Data       []zernioMessage `json:"data"`
			Pagination struct {
				HasMore    bool   `json:"hasMore"`
				NextCursor string `json:"nextCursor"`
			} `json:"pagination"`
		}
		if err := json.Unmarshal(body, &pageData); err != nil {
			return inserted, fmt.Errorf("decode messages page: %w", err)
		}

		for _, msg := range pageData.Data {
			// Use platformMessageId if present, fall back to id.
			zernioMsgID := msg.PlatformMessageID
			if zernioMsgID == "" {
				zernioMsgID = msg.ID
			}
			if zernioMsgID == "" {
				continue
			}

			// Dedup check.
			var exists bool
			if err := h.db.QueryRowContext(ctx,
				`SELECT EXISTS(SELECT 1 FROM messages WHERE zernio_message_id = $1)`,
				zernioMsgID,
			).Scan(&exists); err != nil {
				continue
			}
			if exists {
				continue
			}

			direction := mapDirection(msg.Direction)
			contentType := mapContentType(msg.Type)
			status := "received"
			if direction == "outbound" {
				status = "sent"
			}

			ts := parseTimestamp(msg.Timestamp)

			attachmentsJSON := "[]"
			if msg.AttachmentURL != "" {
				att := []map[string]string{{
					"url":  msg.AttachmentURL,
					"type": msg.AttachmentType,
					"name": msg.AttachmentName,
				}}
				if b, err := json.Marshal(att); err == nil {
					attachmentsJSON = string(b)
				}
			}

			_, err := h.db.ExecContext(ctx,
				`INSERT INTO messages
				    (conversation_id, direction, content_type, content, status, zernio_message_id, attachments, timestamp)
				 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8)
				 ON CONFLICT DO NOTHING`,
				localConvID, direction, contentType, msg.Content, status, zernioMsgID, attachmentsJSON, ts,
			)
			if err != nil {
				log.Printf("[sync-msgs] insert msg %s: %v", zernioMsgID, err)
				continue
			}
			inserted++
		}

		if !pageData.Pagination.HasMore || pageData.Pagination.NextCursor == "" {
			break
		}
		cursor = pageData.Pagination.NextCursor

		// Pace between pages of the same conversation.
		select {
		case <-ctx.Done():
			return inserted, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}

	return inserted, nil
}

func mapDirection(d string) string {
	switch d {
	case "incoming":
		return "inbound"
	case "outgoing":
		return "outbound"
	default:
		return "inbound"
	}
}

func mapContentType(t string) string {
	switch t {
	case "text":
		return "text"
	case "image":
		return "image"
	case "audio":
		return "audio"
	case "video":
		return "video"
	case "document":
		return "file"
	default:
		return "text"
	}
}

// parseTimestamp parses an RFC3339 or Unix-milliseconds timestamp string.
// Falls back to time.Now() if unparseable.
func parseTimestamp(s string) time.Time {
	if s == "" {
		return time.Now()
	}
	// Try RFC3339 first.
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t
	}
	// Try Unix milliseconds (numeric string).
	var ms int64
	if _, err := fmt.Sscanf(s, "%d", &ms); err == nil && ms > 0 {
		return time.Unix(ms/1000, (ms%1000)*int64(time.Millisecond))
	}
	return time.Now()
}

// SyncMessagesStatus returns the current (or last completed) message-sync state
// for the requesting tenant.  The frontend polls this every 2 s after the SSE
// stream closes.
func (h *SyncHandler) SyncMessagesStatus(w http.ResponseWriter, r *http.Request) {
	tenantID := tenantIDFromRequest(r)
	syncMsgMu.RLock()
	state := syncMsgStates[tenantID]
	syncMsgMu.RUnlock()
	if state == nil {
		writeJSON(w, http.StatusOK, map[string]any{"phase": "idle"})
		return
	}
	writeJSON(w, http.StatusOK, state)
}
