package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/lib/pq"
	"github.com/whatsy/backend/internal/domain"
)

// ConversationRepo provides PostgreSQL access to conversations.
type ConversationRepo struct {
	db *sql.DB
}

func NewConversationRepo(db *sql.DB) *ConversationRepo {
	return &ConversationRepo{db: db}
}

const conversationColumns = `
	c.id, c.platform, s.id, s.name, s.phone,
	c.last_message, COALESCE(c.last_message_at, c.updated_at),
	COALESCE(last_msg.id::text, ''), COALESCE(last_msg.content_type, 'text'),
	COALESCE(last_msg.direction, ''), COALESCE(last_msg.status, 'sent'),
	c.unread_count, COALESCE(tags.names, ARRAY[]::text[]),
	COALESCE(a.id::text, ''), COALESCE(a.name, ''), COALESCE(a.avatar, ''),
	c.updated_at`

const conversationJoins = `
	FROM conversations c
	JOIN students s ON s.id = c.student_id
	LEFT JOIN agents a ON a.id = c.assigned_agent_id
	LEFT JOIN LATERAL (
		SELECT id, content_type, direction, status
		FROM messages
		WHERE conversation_id = c.id
		ORDER BY timestamp DESC, id DESC
		LIMIT 1
	) last_msg ON TRUE
	LEFT JOIN LATERAL (
		SELECT array_agg(t.name ORDER BY t.name) AS names
		FROM conversation_tags ct
		JOIN tags t ON t.id = ct.tag_id
		WHERE ct.conversation_id = c.id
	) tags ON TRUE`

// List returns conversations for the requested view. The current schema has no
// account column; accountID is therefore used by the assigned_to_me filter.
func (r *ConversationRepo) List(ctx context.Context, accountID, filter, search string, limit int) ([]domain.Conversation, error) {
	if limit <= 0 {
		limit = 50
	}

	where := make([]string, 0, 3)
	args := make([]any, 0, 3)
	addArg := func(value any) string {
		args = append(args, value)
		return fmt.Sprintf("$%d", len(args))
	}

	switch filter {
	case "", "all":
	case "unread":
		where = append(where, "c.unread_count > 0")
	case "groups":
		// Group conversations are not represented in the current database schema.
		where = append(where, "FALSE")
	case "assigned_to_me":
		where = append(where, "c.assigned_agent_id = "+addArg(accountID)+"::uuid")
	default:
		return nil, fmt.Errorf("unsupported conversation filter %q", filter)
	}

	if search = strings.TrimSpace(search); search != "" {
		placeholder := addArg("%" + search + "%")
		where = append(where, "(s.phone ILIKE "+placeholder+" OR s.name ILIKE "+placeholder+")")
	}

	query := "SELECT " + conversationColumns + " " + conversationJoins
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC LIMIT " + addArg(limit)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}
	defer rows.Close()

	conversations := make([]domain.Conversation, 0)
	for rows.Next() {
		conversation, err := scanConversation(rows, accountID)
		if err != nil {
			return nil, fmt.Errorf("scan conversation: %w", err)
		}
		conversations = append(conversations, conversation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate conversations: %w", err)
	}
	return conversations, nil
}

func (r *ConversationRepo) GetByID(ctx context.Context, id string) (*domain.Conversation, error) {
	query := "SELECT " + conversationColumns + " " + conversationJoins + " WHERE c.id = $1"
	conversation, err := scanConversation(r.db.QueryRowContext(ctx, query, id), "")
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get conversation %q: %w", id, err)
	}
	return &conversation, nil
}

func (r *ConversationRepo) IncrementUnread(ctx context.Context, conversationID string) error {
	_, err := r.db.ExecContext(ctx, "UPDATE conversations SET unread_count = unread_count + 1, updated_at = NOW() WHERE id = $1", conversationID)
	if err != nil {
		return fmt.Errorf("increment unread count: %w", err)
	}
	return nil
}

func (r *ConversationRepo) ResetUnread(ctx context.Context, conversationID string) error {
	_, err := r.db.ExecContext(ctx, "UPDATE conversations SET unread_count = 0, updated_at = NOW() WHERE id = $1", conversationID)
	if err != nil {
		return fmt.Errorf("reset unread count: %w", err)
	}
	return nil
}

// AssignAgent assigns a conversation to an agent and reports whether it existed.
func (r *ConversationRepo) AssignAgent(ctx context.Context, conversationID, agentID string) (bool, error) {
	result, err := r.db.ExecContext(ctx, "UPDATE conversations SET assigned_agent_id = $1, updated_at = NOW() WHERE id = $2", agentID, conversationID)
	if err != nil {
		return false, fmt.Errorf("assign conversation: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("assignment rows affected: %w", err)
	}
	return updated > 0, nil
}

// UpdateLastMessage updates the denormalized conversation preview. Message type
// belongs to the messages table in the current schema, so msgType is accepted
// for API consistency but does not have a conversation column to persist to.
func (r *ConversationRepo) UpdateLastMessage(ctx context.Context, conversationID, content, msgType string) error {
	_ = msgType
	_, err := r.db.ExecContext(ctx, "UPDATE conversations SET last_message = $2, last_message_at = NOW(), updated_at = NOW() WHERE id = $1", conversationID, content)
	if err != nil {
		return fmt.Errorf("update last message: %w", err)
	}
	return nil
}

type conversationScanner interface {
	Scan(dest ...any) error
}

func scanConversation(row conversationScanner, accountID string) (domain.Conversation, error) {
	var conversation domain.Conversation
	var tags pq.StringArray
	var agentID, agentName, agentAvatar string

	err := row.Scan(
		&conversation.ID, &conversation.Platform,
		&conversation.Participant.ID, &conversation.Participant.DisplayName, &conversation.Participant.PhoneNumber,
		&conversation.LastMessage.Content, &conversation.LastMessage.CreatedAt,
		&conversation.LastMessage.ID, &conversation.LastMessage.Type, &conversation.LastMessage.Direction, &conversation.LastMessage.Status,
		&conversation.UnreadCount, &tags,
		&agentID, &agentName, &agentAvatar,
		&conversation.UpdatedAt,
	)
	if err != nil {
		return domain.Conversation{}, err
	}

	conversation.AccountID = accountID
	conversation.Tags = []string(tags)
	if agentID != "" {
		conversation.AssignedAgent = &domain.AssignedAgent{ID: agentID, Name: agentName, AvatarURL: agentAvatar}
	}
	return conversation, nil
}
