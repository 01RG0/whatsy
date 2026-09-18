package repository

import (
	"context"
	"database/sql"
	"encoding/json"
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

const messageColumns = `m.id, m.conversation_id, m.direction, m.content_type, m.content, m.status,
	COALESCE(m.zernio_message_id, ''), m.attachments, m.timestamp,
	COALESCE(m.sent_by_agent_id::text, ''), COALESCE(a.name, ''), COALESCE(a.avatar, '')`

func (r *MessageRepo) Create(ctx context.Context, msg *domain.Message) error {
	if msg == nil {
		return fmt.Errorf("create message: message is nil")
	}

	attachments := "[]"
	if len(msg.Attachments) > 0 {
		if b, err := json.Marshal(msg.Attachments); err == nil {
			attachments = string(b)
		}
	}

	const query = `INSERT INTO messages
		(conversation_id, direction, content_type, content, status, zernio_message_id, attachments, timestamp, sent_by_agent_id)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7::jsonb, COALESCE($8, NOW()), NULLIF($9, '')::uuid)
		RETURNING id, timestamp`
	var createdAt any
	if !msg.CreatedAt.IsZero() {
		createdAt = msg.CreatedAt
	}
	err := r.db.QueryRowContext(ctx, query,
		msg.ConversationID, msg.Direction, msg.Type, msg.Content, msg.Status,
		msg.ZernioMessageID, attachments, createdAt, msg.SentByAgentID,
	).Scan(&msg.ID, &msg.CreatedAt)
	if err != nil {
		return fmt.Errorf("create message: %w", err)
	}
	return nil
}

const messageFrom = ` FROM messages m LEFT JOIN agents a ON a.id = m.sent_by_agent_id `

// ListByConversation returns newest messages first. beforeID is an exclusive
// cursor: only messages older than that message's timestamp are returned.
func (r *MessageRepo) ListByConversation(ctx context.Context, conversationID string, limit int, beforeID string) ([]domain.Message, error) {
	if limit <= 0 {
		limit = 50
	}

	where := []string{"m.conversation_id = $1"}
	args := []any{conversationID}
	if beforeID != "" {
		args = append(args, beforeID)
		where = append(where, fmt.Sprintf("m.timestamp < (SELECT timestamp FROM messages WHERE id = $%d)", len(args)))
	}
	args = append(args, limit)
	query := "SELECT " + messageColumns + messageFrom + "WHERE " + strings.Join(where, " AND ") + fmt.Sprintf(" ORDER BY m.timestamp DESC, m.id DESC LIMIT $%d", len(args))

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

// UpdateZernioIDAndStatus sets the Zernio message ID (wamid) and delivery status
// after an async send completes. Used by the fire-and-forget send path.
func (r *MessageRepo) UpdateZernioIDAndStatus(ctx context.Context, messageID, zernioMsgID string, status domain.DeliveryStatus) error {
	_, err := r.db.ExecContext(ctx,
		"UPDATE messages SET status = $2, zernio_message_id = NULLIF($3, '') WHERE id = $1",
		messageID, status, zernioMsgID,
	)
	if err != nil {
		return fmt.Errorf("update message zernio id and status: %w", err)
	}
	return nil
}

// UpdateStatusByZernioID updates the status of the message carrying the given
// platform message id (WhatsApp wamid), which is the key status webhooks use.
func (r *MessageRepo) UpdateStatusByZernioID(ctx context.Context, zernioMsgID string, status domain.DeliveryStatus) error {
	result, err := r.db.ExecContext(ctx, "UPDATE messages SET status = $2 WHERE zernio_message_id = $1", zernioMsgID, status)
	if err != nil {
		return fmt.Errorf("update message status by zernio ID: %w", err)
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return fmt.Errorf("no message with zernio_message_id %q", zernioMsgID)
	}
	return nil
}

func (r *MessageRepo) DeleteByZernioID(ctx context.Context, zernioMsgID string) error {
	_, err := r.db.ExecContext(ctx, "DELETE FROM messages WHERE zernio_message_id = $1", zernioMsgID)
	if err != nil {
		return fmt.Errorf("delete message by zernio ID: %w", err)
	}
	return nil
}

func (r *MessageRepo) GetByZernioID(ctx context.Context, zernioMsgID string) (*domain.Message, error) {
	query := "SELECT " + messageColumns + messageFrom + "WHERE m.zernio_message_id = $1"
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
	var attachments []byte
	err := row.Scan(
		&message.ID, &message.ConversationID, &message.Direction, &message.Type,
		&message.Content, &message.Status, &message.ZernioMessageID, &attachments, &message.CreatedAt,
		&message.SentByAgentID, &message.SenderName, &message.SenderAvatar,
	)
	if err != nil {
		return message, err
	}
	message.Attachments = []domain.Attachment{}
	if len(attachments) > 0 {
		_ = json.Unmarshal(attachments, &message.Attachments)
	}
	return message, nil
}
