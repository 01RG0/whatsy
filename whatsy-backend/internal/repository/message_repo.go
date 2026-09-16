package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/whatsy/backend/internal/domain"
)

// MessageRepo provides PostgreSQL access to messages.
type MessageRepo struct {
	db *sql.DB
}

func NewMessageRepo(db *sql.DB) *MessageRepo {
	return &MessageRepo{db: db}
}

const messageColumns = `id, conversation_id, direction, content_type, content, status,
	COALESCE(zernio_message_id, ''), timestamp`

func (r *MessageRepo) Create(ctx context.Context, msg *domain.Message) error {
	if msg == nil {
		return fmt.Errorf("create message: message is nil")
	}

	const query = `INSERT INTO messages
		(conversation_id, direction, content_type, content, status, zernio_message_id, timestamp)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), COALESCE($7, NOW()))
		RETURNING id, timestamp`
	var createdAt any
	if !msg.CreatedAt.IsZero() {
		createdAt = msg.CreatedAt
	}
	err := r.db.QueryRowContext(ctx, query,
		msg.ConversationID, msg.Direction, msg.Type, msg.Content, msg.Status,
		msg.ZernioMessageID, createdAt,
	).Scan(&msg.ID, &msg.CreatedAt)
	if err != nil {
		return fmt.Errorf("create message: %w", err)
	}
	return nil
}

// ListByConversation returns newest messages first. beforeID is an exclusive
// cursor: only messages older than that message's timestamp are returned.
func (r *MessageRepo) ListByConversation(ctx context.Context, conversationID string, limit int, beforeID string) ([]domain.Message, error) {
	if limit <= 0 {
		limit = 50
	}

	where := []string{"conversation_id = $1"}
	args := []any{conversationID}
	if beforeID != "" {
		args = append(args, beforeID)
		where = append(where, fmt.Sprintf("timestamp < (SELECT timestamp FROM messages WHERE id = $%d)", len(args)))
	}
	args = append(args, limit)
	query := "SELECT " + messageColumns + " FROM messages WHERE " + strings.Join(where, " AND ") + fmt.Sprintf(" ORDER BY timestamp DESC, id DESC LIMIT $%d", len(args))

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list messages: %w", err)
	}
	defer rows.Close()

	messages := make([]domain.Message, 0)
	for rows.Next() {
		message, err := scanMessage(rows)
		if err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate messages: %w", err)
	}
	return messages, nil
}

func (r *MessageRepo) UpdateStatus(ctx context.Context, messageID string, status domain.DeliveryStatus) error {
	_, err := r.db.ExecContext(ctx, "UPDATE messages SET status = $2 WHERE id = $1", messageID, status)
	if err != nil {
		return fmt.Errorf("update message status: %w", err)
	}
	return nil
}

func (r *MessageRepo) GetByZernioID(ctx context.Context, zernioMsgID string) (*domain.Message, error) {
	query := "SELECT " + messageColumns + " FROM messages WHERE zernio_message_id = $1"
	message, err := scanMessage(r.db.QueryRowContext(ctx, query, zernioMsgID))
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get message by zernio ID: %w", err)
	}
	return &message, nil
}

type messageScanner interface {
	Scan(dest ...any) error
}

func scanMessage(row messageScanner) (domain.Message, error) {
	var message domain.Message
	err := row.Scan(
		&message.ID, &message.ConversationID, &message.Direction, &message.Type,
		&message.Content, &message.Status, &message.ZernioMessageID, &message.CreatedAt,
	)
	return message, err
}
