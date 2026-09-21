package handler

import (
	"encoding/json"
	"io"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/whatsy/backend/internal/service"
)

// LabelHandler exposes CRUD endpoints for labels (tags) and their assignment
// to conversations and students.
type LabelHandler struct {
	tags *service.TagService
}

func NewLabelHandler(tags *service.TagService) *LabelHandler {
	return &LabelHandler{tags: tags}
}

// tagJSON is the JSON wire format for a label.
type tagJSON struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	CreatedAt string `json:"createdAt"`
}

func tagToJSON(t service.Tag) tagJSON {
	return tagJSON{
		ID:        t.ID,
		Name:      t.Name,
		Color:     t.Color,
		CreatedAt: t.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

// List handles GET /v1/labels — returns all labels.
func (h *LabelHandler) List(w http.ResponseWriter, r *http.Request) {
	tags, err := h.tags.ListTags(r.Context())
	if err != nil {
		log.Printf("[error] list labels: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list labels"})
		return
	}
	out := make([]tagJSON, len(tags))
	for i, t := range tags {
		out[i] = tagToJSON(t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"labels": out})
}

// Create handles POST /v1/labels — creates a new label (admin only).
func (h *LabelHandler) Create(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var body struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if body.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}
	if body.Color == "" {
		body.Color = "#6b7280" // neutral gray default
	}

	tag, err := h.tags.CreateTag(r.Context(), body.Name, body.Color)
	if err != nil {
		log.Printf("[error] create label: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "create label"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"label": tagToJSON(*tag)})
}

// Update handles PATCH /v1/labels/{id} — updates name/color (admin only).
func (h *LabelHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	defer r.Body.Close()
	var body struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if body.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}

	tag, err := h.tags.UpdateTag(r.Context(), id, body.Name, body.Color)
	if err != nil {
		log.Printf("[error] update label %s: %v", id, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "update label"})
		return
	}
	if tag == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "label not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"label": tagToJSON(*tag)})
}

// Delete handles DELETE /v1/labels/{id} (admin only).
func (h *LabelHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.tags.DeleteTag(r.Context(), id); err != nil {
		log.Printf("[error] delete label %s: %v", id, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "delete label"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ListConversationLabels handles GET /v1/inbox/conversations/{id}/labels.
func (h *LabelHandler) ListConversationLabels(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "id")
	tags, err := h.tags.ListTagsForConversation(r.Context(), convID)
	if err != nil {
		log.Printf("[error] list conv labels %s: %v", convID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list labels"})
		return
	}
	out := make([]tagJSON, len(tags))
	for i, t := range tags {
		out[i] = tagToJSON(t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"labels": out})
}

// AddConversationLabel handles POST /v1/inbox/conversations/{id}/labels.
func (h *LabelHandler) AddConversationLabel(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "id")
	defer r.Body.Close()
	var body struct {
		LabelID string `json:"labelId"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if body.LabelID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "labelId is required"})
		return
	}

	if err := h.tags.AddTagToConversation(r.Context(), convID, body.LabelID); err != nil {
		log.Printf("[error] add label to conv %s: %v", convID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "add label"})
		return
	}

	tags, err := h.tags.ListTagsForConversation(r.Context(), convID)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	out := make([]tagJSON, len(tags))
	for i, t := range tags {
		out[i] = tagToJSON(t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"labels": out})
}

// RemoveConversationLabel handles DELETE /v1/inbox/conversations/{id}/labels/{labelId}.
func (h *LabelHandler) RemoveConversationLabel(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "id")
	labelID := chi.URLParam(r, "labelId")

	if err := h.tags.RemoveTagFromConversation(r.Context(), convID, labelID); err != nil {
		log.Printf("[error] remove label from conv %s: %v", convID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "remove label"})
		return
	}

	tags, err := h.tags.ListTagsForConversation(r.Context(), convID)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	out := make([]tagJSON, len(tags))
	for i, t := range tags {
		out[i] = tagToJSON(t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"labels": out})
}

// ListStudentLabels handles GET /v1/students/{id}/labels.
func (h *LabelHandler) ListStudentLabels(w http.ResponseWriter, r *http.Request) {
	studentID := chi.URLParam(r, "id")
	tags, err := h.tags.ListTagsForStudent(r.Context(), studentID)
	if err != nil {
		log.Printf("[error] list student labels %s: %v", studentID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list labels"})
		return
	}
	out := make([]tagJSON, len(tags))
	for i, t := range tags {
		out[i] = tagToJSON(t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"labels": out})
}

// AddStudentLabel handles POST /v1/students/{id}/labels.
func (h *LabelHandler) AddStudentLabel(w http.ResponseWriter, r *http.Request) {
	studentID := chi.URLParam(r, "id")
	defer r.Body.Close()
	var body struct {
		LabelID string `json:"labelId"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if body.LabelID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "labelId is required"})
		return
	}

	if err := h.tags.AddTagToStudent(r.Context(), studentID, body.LabelID); err != nil {
		log.Printf("[error] add label to student %s: %v", studentID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "add label"})
		return
	}

	tags, err := h.tags.ListTagsForStudent(r.Context(), studentID)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	out := make([]tagJSON, len(tags))
	for i, t := range tags {
		out[i] = tagToJSON(t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"labels": out})
}

// RemoveStudentLabel handles DELETE /v1/students/{id}/labels/{labelId}.
func (h *LabelHandler) RemoveStudentLabel(w http.ResponseWriter, r *http.Request) {
	studentID := chi.URLParam(r, "id")
	labelID := chi.URLParam(r, "labelId")

	if err := h.tags.RemoveTagFromStudent(r.Context(), studentID, labelID); err != nil {
		log.Printf("[error] remove label from student %s: %v", studentID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "remove label"})
		return
	}

	tags, err := h.tags.ListTagsForStudent(r.Context(), studentID)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	out := make([]tagJSON, len(tags))
	for i, t := range tags {
		out[i] = tagToJSON(t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"labels": out})
}
