package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/whatsy/backend/internal/domain"
	"github.com/whatsy/backend/internal/zernio"
)

// AutoReplyRule mirrors a row of the auto_reply_rules table.
type AutoReplyRule struct {
	ID          string
	Trigger     string
	TriggerType string
	Response    string
	IsActive    bool
	Priority    int
}

// AutoReplyService evaluates database-driven auto-reply rules.
// The rules the UI manages (GET/POST/PATCH /v1/auto-reply-rules) are the same
// rows this service evaluates, so toggling a rule in the UI changes behavior.
type AutoReplyService struct {
	db *sql.DB
}

// NewAutoReplyService creates an AutoReplyService backed by db.
func NewAutoReplyService(db *sql.DB) *AutoReplyService {
	return &AutoReplyService{db: db}
}

// CheckAndReply evaluates active rules (ordered by priority) against an
// inbound message and sends the first matching rule's response. It reports
// whether a reply was sent.
func (s *AutoReplyService) CheckAndReply(ctx context.Context, message domain.Message, convID string, chatService *ChatService) (bool, error) {
	if chatService == nil {
		return false, fmt.Errorf("send auto-reply: chat service is nil")
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT trigger, trigger_type FROM auto_reply_rules
		 WHERE is_active = TRUE
		 ORDER BY priority ASC, created_at ASC
		 LIMIT 100`)
	if err != nil {
		return false, fmt.Errorf("load auto-reply rules: %w", err)
	}
	defer rows.Close()

	content := strings.ToLower(message.Content)
	for rows.Next() {
		var trigger, triggerType string
		if err := rows.Scan(&trigger, &triggerType); err != nil {
			return false, fmt.Errorf("scan auto-reply rule: %w", err)
		}

		matched := false
		switch triggerType {
		case "after_hours":
			matched = isAfterHours()
		case "exact":
			matched = strings.ToLower(strings.TrimSpace(message.Content)) == strings.ToLower(strings.TrimSpace(trigger))
		default: // "keyword" — trigger anywhere in the message (case-insensitive)
			matched = trigger != "" && strings.Contains(content, strings.ToLower(trigger))
		}
		if !matched {
			continue
		}

		var response string
		if err := s.db.QueryRowContext(ctx,
			`SELECT response FROM auto_reply_rules WHERE trigger = $1 AND is_active = TRUE LIMIT 1`,
			trigger,
		).Scan(&response); err != nil {
			continue
		}
		if response == "" {
			continue
		}

		if _, err := chatService.SendOutboundMessage(ctx, convID, zernio.SendMessagePayload{Message: response}); err != nil {
			return false, fmt.Errorf("send auto-reply: %w", err)
		}
		return true, nil
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("iterate auto-reply rules: %w", err)
	}
	return false, nil
}

// isAfterHours reports whether it is currently outside 9:00-17:00 local time.
func isAfterHours() bool {
	hour := time.Now().Hour()
	return hour < 9 || hour >= 17
}
