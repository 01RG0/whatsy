package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/whatsy/backend/internal/domain"
	"github.com/whatsy/backend/internal/zernio"
)

const (
	deadlineTrigger  = "/deadline"
	deadlineResponse = "Please check with your teacher for deadline info"
	zoomTrigger      = "/zoom"
	zoomResponse     = "Zoom link will be sent 30 minutes before class"
)

// AutoReplyRule describes a rule that can automatically respond to a message.
// Trigger may be a keyword or "after_hours".
type AutoReplyRule struct {
	ID       string
	Trigger  string
	Response string
	IsActive bool
	Priority int
}

// AutoReplyService evaluates auto-reply rules. Rules will be database-driven
// in a future implementation.
type AutoReplyService struct {
	db *sql.DB
}

// CheckAndReply sends a predefined reply when the message matches a temporary
// hard-coded rule. It reports whether a reply was sent.
func (s *AutoReplyService) CheckAndReply(ctx context.Context, message domain.Message, convID string, chatService *ChatService) (bool, error) {
	var response string
	switch {
	case strings.Contains(message.Content, deadlineTrigger):
		response = deadlineResponse
	case strings.Contains(message.Content, zoomTrigger):
		response = zoomResponse
	default:
		return false, nil
	}

	if chatService == nil {
		return false, fmt.Errorf("send auto-reply: chat service is nil")
	}
	if _, err := chatService.SendOutboundMessage(ctx, convID, zernio.SendMessagePayload{Message: response}); err != nil {
		return false, fmt.Errorf("send auto-reply: %w", err)
	}
	return true, nil
}
