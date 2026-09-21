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

// GetTag returns the tag with the given ID.
func (s *TagService) GetTag(ctx context.Context, id string) (*Tag, error) {
	var tag Tag
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, color, created_at FROM tags WHERE id = $1`, id).
		Scan(&tag.ID, &tag.Name, &tag.Color, &tag.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get tag: %w", err)
	}
	return &tag, nil
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

// UpdateTag updates the name and/or color of an existing tag.
func (s *TagService) UpdateTag(ctx context.Context, id, name, color string) (*Tag, error) {
	var tag Tag
	err := s.db.QueryRowContext(ctx, `
		UPDATE tags SET name = $2, color = $3
		WHERE id = $1
		RETURNING id, name, color, created_at`, id, name, color).
		Scan(&tag.ID, &tag.Name, &tag.Color, &tag.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("update tag: %w", err)
	}
	return &tag, nil
}

// DeleteTag deletes a tag. Junction rows are removed by ON DELETE CASCADE.
func (s *TagService) DeleteTag(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM tags WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete tag: %w", err)
	}
	return nil
}

// AddTagToConversation assigns a tag to a conversation via the junction table.
func (s *TagService) AddTagToConversation(ctx context.Context, convID string, tagID string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO conversation_tags (conversation_id, tag_id)
		VALUES ($1::uuid, $2::uuid)
		ON CONFLICT DO NOTHING`, convID, tagID)
	if err != nil {
		return fmt.Errorf("add tag to conversation: %w", err)
	}
	return nil
}

// RemoveTagFromConversation removes a tag assignment from a conversation.
func (s *TagService) RemoveTagFromConversation(ctx context.Context, convID string, tagID string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM conversation_tags
		WHERE conversation_id = $1::uuid AND tag_id = $2::uuid`, convID, tagID)
	if err != nil {
		return fmt.Errorf("remove tag from conversation: %w", err)
	}
	return nil
}

// ListTagsForConversation returns all tags assigned to a conversation.
func (s *TagService) ListTagsForConversation(ctx context.Context, convID string) ([]Tag, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT t.id, t.name, t.color, t.created_at
		FROM tags t
		JOIN conversation_tags ct ON ct.tag_id = t.id
		WHERE ct.conversation_id = $1::uuid
		ORDER BY t.name`, convID)
	if err != nil {
		return nil, fmt.Errorf("list tags for conversation: %w", err)
	}
	defer rows.Close()
	return scanTags(rows)
}

// AddTagToStudent assigns a tag to a student via the junction table and keeps
// the denormalized students.tags TEXT[] column in sync so existing queries work.
func (s *TagService) AddTagToStudent(ctx context.Context, studentID string, tagID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO student_tags (student_id, tag_id)
		VALUES ($1::uuid, $2::uuid)
		ON CONFLICT DO NOTHING`, studentID, tagID); err != nil {
		return fmt.Errorf("add tag to student (junction): %w", err)
	}

	// Keep the denormalized TEXT[] in sync so the existing student list endpoint works.
	if _, err := tx.ExecContext(ctx, `
		UPDATE students
		SET tags = (
			SELECT array_agg(t.name ORDER BY t.name)
			FROM student_tags st
			JOIN tags t ON t.id = st.tag_id
			WHERE st.student_id = $1::uuid
		)
		WHERE id = $1::uuid`, studentID); err != nil {
		return fmt.Errorf("sync student tags array: %w", err)
	}

	return tx.Commit()
}

// RemoveTagFromStudent removes a tag assignment from a student.
func (s *TagService) RemoveTagFromStudent(ctx context.Context, studentID string, tagID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM student_tags
		WHERE student_id = $1::uuid AND tag_id = $2::uuid`, studentID, tagID); err != nil {
		return fmt.Errorf("remove tag from student (junction): %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE students
		SET tags = COALESCE((
			SELECT array_agg(t.name ORDER BY t.name)
			FROM student_tags st
			JOIN tags t ON t.id = st.tag_id
			WHERE st.student_id = $1::uuid
		), ARRAY[]::text[])
		WHERE id = $1::uuid`, studentID); err != nil {
		return fmt.Errorf("sync student tags array: %w", err)
	}

	return tx.Commit()
}

// ListTagsForStudent returns all tags assigned to a student.
func (s *TagService) ListTagsForStudent(ctx context.Context, studentID string) ([]Tag, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT t.id, t.name, t.color, t.created_at
		FROM tags t
		JOIN student_tags st ON st.tag_id = t.id
		WHERE st.student_id = $1::uuid
		ORDER BY t.name`, studentID)
	if err != nil {
		return nil, fmt.Errorf("list tags for student: %w", err)
	}
	defer rows.Close()
	return scanTags(rows)
}

func scanTags(rows *sql.Rows) ([]Tag, error) {
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
