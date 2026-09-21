package service_test

import (
	"context"
	"database/sql"
	"os"
	"testing"

	_ "github.com/lib/pq"
	"github.com/whatsy/backend/internal/service"
)

// These tests require a live Postgres connection via TEST_DATABASE_URL.
// They are skipped when that env var is absent so CI without a DB still passes.
func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping integration test")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	if err := db.Ping(); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestTagCRUD(t *testing.T) {
	db := openTestDB(t)
	svc := service.NewTagService(db)
	ctx := context.Background()

	// Create
	tag, err := svc.CreateTag(ctx, "Test Label "+t.Name(), "#ff0000")
	if err != nil {
		t.Fatalf("create tag: %v", err)
	}
	if tag.ID == "" {
		t.Fatal("expected non-empty ID")
	}

	// Get
	got, err := svc.GetTag(ctx, tag.ID)
	if err != nil {
		t.Fatalf("get tag: %v", err)
	}
	if got == nil || got.Name != tag.Name {
		t.Fatalf("expected tag %q, got %v", tag.Name, got)
	}

	// List
	tags, err := svc.ListTags(ctx)
	if err != nil {
		t.Fatalf("list tags: %v", err)
	}
	found := false
	for _, tg := range tags {
		if tg.ID == tag.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("created tag not found in list")
	}

	// Update
	updated, err := svc.UpdateTag(ctx, tag.ID, "Updated "+tag.Name, "#00ff00")
	if err != nil {
		t.Fatalf("update tag: %v", err)
	}
	if updated.Color != "#00ff00" {
		t.Fatalf("expected updated color, got %q", updated.Color)
	}

	// Delete
	if err := svc.DeleteTag(ctx, tag.ID); err != nil {
		t.Fatalf("delete tag: %v", err)
	}
	gone, err := svc.GetTag(ctx, tag.ID)
	if err != nil {
		t.Fatalf("get after delete: %v", err)
	}
	if gone != nil {
		t.Fatal("tag still exists after delete")
	}
}

func TestConversationTagAssignment(t *testing.T) {
	db := openTestDB(t)
	svc := service.NewTagService(db)
	ctx := context.Background()

	// We need a real conversation row; create a temporary student + conversation.
	var studentID, convID string
	err := db.QueryRowContext(ctx, `
		INSERT INTO students (name, phone) VALUES ('test-label-student', '+0000000001')
		RETURNING id`).Scan(&studentID)
	if err != nil {
		t.Fatalf("create test student: %v", err)
	}
	t.Cleanup(func() {
		db.ExecContext(ctx, "DELETE FROM students WHERE id = $1", studentID) //nolint:errcheck
	})

	err = db.QueryRowContext(ctx, `
		INSERT INTO conversations (student_id, platform) VALUES ($1, 'whatsapp')
		RETURNING id`, studentID).Scan(&convID)
	if err != nil {
		t.Fatalf("create test conversation: %v", err)
	}
	t.Cleanup(func() {
		db.ExecContext(ctx, "DELETE FROM conversations WHERE id = $1", convID) //nolint:errcheck
	})

	tag, err := svc.CreateTag(ctx, "conv-label-"+t.Name(), "#123456")
	if err != nil {
		t.Fatalf("create tag: %v", err)
	}
	t.Cleanup(func() { svc.DeleteTag(ctx, tag.ID) }) //nolint:errcheck

	// Assign
	if err := svc.AddTagToConversation(ctx, convID, tag.ID); err != nil {
		t.Fatalf("add tag to conversation: %v", err)
	}

	// List
	convTags, err := svc.ListTagsForConversation(ctx, convID)
	if err != nil {
		t.Fatalf("list conv tags: %v", err)
	}
	if len(convTags) != 1 || convTags[0].ID != tag.ID {
		t.Fatalf("expected 1 tag, got %v", convTags)
	}

	// Remove
	if err := svc.RemoveTagFromConversation(ctx, convID, tag.ID); err != nil {
		t.Fatalf("remove tag from conversation: %v", err)
	}
	convTags, err = svc.ListTagsForConversation(ctx, convID)
	if err != nil {
		t.Fatalf("list conv tags after remove: %v", err)
	}
	if len(convTags) != 0 {
		t.Fatalf("expected 0 tags after remove, got %v", convTags)
	}
}

func TestStudentTagAssignment(t *testing.T) {
	db := openTestDB(t)
	svc := service.NewTagService(db)
	ctx := context.Background()

	var studentID string
	err := db.QueryRowContext(ctx, `
		INSERT INTO students (name, phone) VALUES ('test-label-stu2', '+0000000002')
		RETURNING id`).Scan(&studentID)
	if err != nil {
		t.Fatalf("create test student: %v", err)
	}
	t.Cleanup(func() {
		db.ExecContext(ctx, "DELETE FROM students WHERE id = $1", studentID) //nolint:errcheck
	})

	tag, err := svc.CreateTag(ctx, "stu-label-"+t.Name(), "#654321")
	if err != nil {
		t.Fatalf("create tag: %v", err)
	}
	t.Cleanup(func() { svc.DeleteTag(ctx, tag.ID) }) //nolint:errcheck

	if err := svc.AddTagToStudent(ctx, studentID, tag.ID); err != nil {
		t.Fatalf("add tag to student: %v", err)
	}

	stuTags, err := svc.ListTagsForStudent(ctx, studentID)
	if err != nil {
		t.Fatalf("list student tags: %v", err)
	}
	if len(stuTags) != 1 || stuTags[0].ID != tag.ID {
		t.Fatalf("expected 1 tag, got %v", stuTags)
	}

	// Verify denorm TEXT[] column is also updated.
	var arr []string
	row := db.QueryRowContext(ctx, "SELECT tags FROM students WHERE id = $1", studentID)
	if scanErr := row.Scan((*[]string)(&arr)); scanErr == nil {
		found := false
		for _, n := range arr {
			if n == tag.Name {
				found = true
			}
		}
		if !found {
			t.Errorf("expected tag name %q in students.tags TEXT[], got %v", tag.Name, arr)
		}
	}

	if err := svc.RemoveTagFromStudent(ctx, studentID, tag.ID); err != nil {
		t.Fatalf("remove tag from student: %v", err)
	}
	stuTags, err = svc.ListTagsForStudent(ctx, studentID)
	if err != nil {
		t.Fatalf("list student tags after remove: %v", err)
	}
	if len(stuTags) != 0 {
		t.Fatalf("expected 0 tags after remove, got %v", stuTags)
	}
}
