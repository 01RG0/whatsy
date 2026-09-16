package service

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Tag is a label that can be applied to students and conversations.
type Tag struct {
	ID        string
	Name      string
	Color     string
	CreatedAt time.Time
}

// TagService provides PostgreSQL-backed tag operations.
type TagService struct {
	db *sql.DB
}

func NewTagService(db *sql.DB) *TagService {
	return &TagService{db: db}
}

// ListTags returns all tags ordered alphabetically by name.
func (s *TagService) ListTags(ctx context.Context) ([]Tag, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, color, created_at
		FROM tags
		ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list tags: %w", err)
	}
	defer rows.Close()

	tags := make([]Tag, 0)
	for rows.Next() {
		var tag Tag
		if err := rows.Scan(&tag.ID, &tag.Name, &tag.Color, &tag.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan tag: %w", err)
		}
		tags = append(tags, tag)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tags: %w", err)
	}

	return tags, nil
}

// CreateTag creates and returns a tag.
func (s *TagService) CreateTag(ctx context.Context, name string, color string) (*Tag, error) {
	tag := &Tag{}
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO tags (id, name, color)
		VALUES (gen_random_uuid(), $1, $2)
		RETURNING id, name, color, created_at`, name, color).
		Scan(&tag.ID, &tag.Name, &tag.Color, &tag.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("create tag: %w", err)
	}

	return tag, nil
}

// AddTagToStudent adds tag to a student's tags if it is not already present.
func (s *TagService) AddTagToStudent(ctx context.Context, studentID string, tag string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE students
		SET tags = array_append(tags, $2)
		WHERE id = $1 AND NOT ($2 = ANY(tags))`, studentID, tag)
	if err != nil {
		return fmt.Errorf("add tag to student: %w", err)
	}
	return nil
}

// RemoveTagFromStudent removes tag from a student's tags.
func (s *TagService) RemoveTagFromStudent(ctx context.Context, studentID string, tag string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE students
		SET tags = array_remove(tags, $2)
		WHERE id = $1`, studentID, tag)
	if err != nil {
		return fmt.Errorf("remove tag from student: %w", err)
	}
	return nil
}

// AddTagToConversation adds tag to a conversation's tags if it is not already present.
func (s *TagService) AddTagToConversation(ctx context.Context, convID string, tag string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE conversations
		SET tags = array_append(tags, $2)
		WHERE id = $1 AND NOT ($2 = ANY(tags))`, convID, tag)
	if err != nil {
		return fmt.Errorf("add tag to conversation: %w", err)
	}
	return nil
}

// RemoveTagFromConversation removes tag from a conversation's tags.
func (s *TagService) RemoveTagFromConversation(ctx context.Context, convID string, tag string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE conversations
		SET tags = array_remove(tags, $2)
		WHERE id = $1`, convID, tag)
	if err != nil {
		return fmt.Errorf("remove tag from conversation: %w", err)
	}
	return nil
}
