package handler

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/lib/pq"
)

// StudentHandler exposes CRUD endpoints for students.
type StudentHandler struct {
	db *sql.DB
}

// NewStudentHandler creates a StudentHandler backed by the given database.
func NewStudentHandler(db *sql.DB) *StudentHandler {
	return &StudentHandler{db: db}
}

type studentResponse struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Phone          string            `json:"phone"`
	Grade          string            `json:"grade"`
	EnrolledCourse string            `json:"enrolledCourse"`
	PaymentStatus  string            `json:"paymentStatus"`
	Tags           []string          `json:"tags"`
	CustomFields   map[string]string `json:"customFields"`
	CreatedAt      string            `json:"createdAt"`
	UpdatedAt      string            `json:"updatedAt"`
}

type createStudentRequest struct {
	Name           string `json:"name"`
	Phone          string `json:"phone"`
	Grade          string `json:"grade"`
	EnrolledCourse string `json:"enrolledCourse"`
	PaymentStatus  string `json:"paymentStatus"`
}

type updateStudentRequest struct {
	Grade          string            `json:"grade"`
	EnrolledCourse string            `json:"enrolledCourse"`
	PaymentStatus  string            `json:"paymentStatus"`
	CustomFields   map[string]string `json:"customFields"`
}

// List handles GET /v1/students.
func (h *StudentHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := TenantIDFromContext(r.Context())
	if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "workspace missing"}); return }
	grade := r.URL.Query().Get("grade")
	course := r.URL.Query().Get("course")
	paymentStatus := r.URL.Query().Get("payment_status")
	search := r.URL.Query().Get("search")
	limit := queryLimit(r, 50)
	offset := queryOffset(r, 0)

	// Build count query with the same WHERE filters (no LIMIT/OFFSET).
	countQuery := `SELECT COUNT(*) FROM students WHERE tenant_id = $1::uuid`
	countArgs := []any{tenantID}
	if grade != "" {
		countArgs = append(countArgs, grade)
		countQuery += " AND grade = $" + strconv.Itoa(len(countArgs))
	}
	if course != "" {
		countArgs = append(countArgs, course)
		countQuery += " AND enrolled_course = $" + strconv.Itoa(len(countArgs))
	}
	if paymentStatus != "" {
		countArgs = append(countArgs, paymentStatus)
		countQuery += " AND payment_status = $" + strconv.Itoa(len(countArgs))
	}
	if search != "" {
		countArgs = append(countArgs, "%"+search+"%")
		countQuery += " AND (name ILIKE $" + strconv.Itoa(len(countArgs)) + " OR phone ILIKE $" + strconv.Itoa(len(countArgs)) + ")"
	}
	var total int
	_ = h.db.QueryRowContext(r.Context(), countQuery, countArgs...).Scan(&total)

	query := `SELECT id, name, phone, grade, enrolled_course, payment_status, tags, custom_fields, created_at, updated_at FROM students WHERE tenant_id = $1::uuid`
	args := []any{tenantID}

	if grade != "" {
		args = append(args, grade)
		query += " AND grade = $" + strconv.Itoa(len(args))
	}
	if course != "" {
		args = append(args, course)
		query += " AND enrolled_course = $" + strconv.Itoa(len(args))
	}
	if paymentStatus != "" {
		args = append(args, paymentStatus)
		query += " AND payment_status = $" + strconv.Itoa(len(args))
	}
	if search != "" {
		args = append(args, "%"+search+"%")
		query += " AND (name ILIKE $" + strconv.Itoa(len(args)) + " OR phone ILIKE $" + strconv.Itoa(len(args)) + ")"
	}

	query += " ORDER BY created_at DESC LIMIT $" + strconv.Itoa(len(args)+1) + " OFFSET $" + strconv.Itoa(len(args)+2)
	args = append(args, limit, offset)

	rows, err := h.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list students"})
		return
	}
	defer rows.Close()

	students := make([]studentResponse, 0)
	for rows.Next() {
		s, err := scanStudent(rows)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "scan student"})
			return
		}
		students = append(students, s)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list students"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"students": students, "total": total})
}

// Create handles POST /v1/students.
func (h *StudentHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := TenantIDFromContext(r.Context())
	if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "workspace missing"}); return }
	defer r.Body.Close()

	var req createStudentRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if req.Phone == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "phone is required"})
		return
	}

	var s studentResponse
	var cfRaw []byte
	err := h.db.QueryRow(
		`INSERT INTO students (name, phone, grade, enrolled_course, payment_status, tenant_id)
		 VALUES ($1, $2, $3, $4, $5, $6::uuid)
		 RETURNING id, name, phone, grade, enrolled_course, payment_status, tags, custom_fields, created_at, updated_at`,
		req.Name, req.Phone, req.Grade, req.EnrolledCourse, req.PaymentStatus, tenantID,
	).Scan(&s.ID, &s.Name, &s.Phone, &s.Grade, &s.EnrolledCourse, &s.PaymentStatus,
		pq.Array(&s.Tags), &cfRaw, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "phone already registered"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "create student"})
		return
	}
	if len(cfRaw) > 0 {
		_ = json.Unmarshal(cfRaw, &s.CustomFields)
	}
	if s.CustomFields == nil {
		s.CustomFields = map[string]string{}
	}
	writeJSON(w, http.StatusCreated, s)
}

// GetByID handles GET /v1/students/{id}.
func (h *StudentHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tenantID, ok := TenantIDFromContext(r.Context())
	if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "workspace missing"}); return }
	var s studentResponse
	var cfRaw []byte
	err := h.db.QueryRow(
		`SELECT id, name, phone, grade, enrolled_course, payment_status, tags, custom_fields, created_at, updated_at FROM students WHERE id = $1 AND tenant_id = $2::uuid`,
		id, tenantID,
	).Scan(&s.ID, &s.Name, &s.Phone, &s.Grade, &s.EnrolledCourse, &s.PaymentStatus,
		pq.Array(&s.Tags), &cfRaw, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "student not found"})
		return
	}
	if len(cfRaw) > 0 {
		_ = json.Unmarshal(cfRaw, &s.CustomFields)
	}
	if s.CustomFields == nil {
		s.CustomFields = map[string]string{}
	}
	writeJSON(w, http.StatusOK, s)
}

// Update handles PATCH /v1/students/{id}.
func (h *StudentHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := TenantIDFromContext(r.Context())
	if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "workspace missing"}); return }
	defer r.Body.Close()

	var req updateStudentRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	id := chi.URLParam(r, "id")
	query := `UPDATE students SET updated_at = NOW()`
	args := []any{}

	if req.Grade != "" {
		args = append(args, req.Grade)
		query += ", grade = $" + strconv.Itoa(len(args))
	}
	if req.EnrolledCourse != "" {
		args = append(args, req.EnrolledCourse)
		query += ", enrolled_course = $" + strconv.Itoa(len(args))
	}
	if req.PaymentStatus != "" {
		args = append(args, req.PaymentStatus)
		query += ", payment_status = $" + strconv.Itoa(len(args))
	}
	if req.CustomFields != nil {
		args = append(args, req.CustomFields)
		query += ", custom_fields = $" + strconv.Itoa(len(args))
	}

	query += " WHERE id = $" + strconv.Itoa(len(args)+1) + " AND tenant_id = $" + strconv.Itoa(len(args)+2) + "::uuid RETURNING id, name, phone, grade, enrolled_course, payment_status, tags, custom_fields, created_at, updated_at"
	args = append(args, id, tenantID)

	var s studentResponse
	var cfRaw []byte
	err := h.db.QueryRow(query, args...).Scan(&s.ID, &s.Name, &s.Phone, &s.Grade, &s.EnrolledCourse, &s.PaymentStatus,
		pq.Array(&s.Tags), &cfRaw, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "student not found"})
		return
	}
	if len(cfRaw) > 0 {
		_ = json.Unmarshal(cfRaw, &s.CustomFields)
	}
	if s.CustomFields == nil {
		s.CustomFields = map[string]string{}
	}
	writeJSON(w, http.StatusOK, s)
}

// Delete handles DELETE /v1/students/{id}.
func (h *StudentHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tenantID, ok := TenantIDFromContext(r.Context())
	if !ok { writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "workspace missing"}); return }
	res, err := h.db.ExecContext(r.Context(), `DELETE FROM students WHERE id = $1 AND tenant_id = $2::uuid`, id, tenantID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "delete student"})
		return
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "student not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func scanStudent(rows *sql.Rows) (studentResponse, error) {
	var s studentResponse
	var cfRaw []byte
	err := rows.Scan(&s.ID, &s.Name, &s.Phone, &s.Grade, &s.EnrolledCourse, &s.PaymentStatus,
		pq.Array(&s.Tags), &cfRaw, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return studentResponse{}, err
	}
	if len(cfRaw) > 0 {
		_ = json.Unmarshal(cfRaw, &s.CustomFields)
	}
	if s.CustomFields == nil {
		s.CustomFields = map[string]string{}
	}
	return s, nil
}
