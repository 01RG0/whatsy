package handler

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	"github.com/lib/pq"
	"github.com/go-chi/chi/v5"
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
	grade := r.URL.Query().Get("grade")
	course := r.URL.Query().Get("course")
	paymentStatus := r.URL.Query().Get("payment_status")
	search := r.URL.Query().Get("search")
	limit := queryLimit(r, 50)
	offset := queryOffset(r, 0)

	query := `SELECT id, name, phone, grade, enrolled_course, payment_status, tags, custom_fields, created_at, updated_at FROM students WHERE 1=1`
	args := []any{}

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
	writeJSON(w, http.StatusOK, students)
}

// Create handles POST /v1/students.
func (h *StudentHandler) Create(w http.ResponseWriter, r *http.Request) {
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
	err := h.db.QueryRow(
		`INSERT INTO students (name, phone, grade, enrolled_course, payment_status)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, name, phone, grade, enrolled_course, payment_status, tags, custom_fields, created_at, updated_at`,
		req.Name, req.Phone, req.Grade, req.EnrolledCourse, req.PaymentStatus,
	).Scan(&s.ID, &s.Name, &s.Phone, &s.Grade, &s.EnrolledCourse, &s.PaymentStatus, &s.Tags, &s.CustomFields, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "phone already registered"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "create student"})
		return
	}
	writeJSON(w, http.StatusCreated, s)
}

// GetByID handles GET /v1/students/{id}.
func (h *StudentHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var s studentResponse
	err := h.db.QueryRow(
		`SELECT id, name, phone, grade, enrolled_course, payment_status, tags, custom_fields, created_at, updated_at FROM students WHERE id = $1`,
		id,
	).Scan(&s.ID, &s.Name, &s.Phone, &s.Grade, &s.EnrolledCourse, &s.PaymentStatus, &s.Tags, &s.CustomFields, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "student not found"})
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// Update handles PATCH /v1/students/{id}.
func (h *StudentHandler) Update(w http.ResponseWriter, r *http.Request) {
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

	query += " WHERE id = $" + strconv.Itoa(len(args)+1) + " RETURNING id, name, phone, grade, enrolled_course, payment_status, tags, custom_fields, created_at, updated_at"
	args = append(args, id)

	var s studentResponse
	err := h.db.QueryRow(query, args...).Scan(&s.ID, &s.Name, &s.Phone, &s.Grade, &s.EnrolledCourse, &s.PaymentStatus, &s.Tags, &s.CustomFields, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "student not found"})
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// Delete handles DELETE /v1/students/{id}.
func (h *StudentHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.db.ExecContext(r.Context(), `DELETE FROM students WHERE id = $1`, id)
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
	var createdAt, updatedAt string
	err := rows.Scan(&s.ID, &s.Name, &s.Phone, &s.Grade, &s.EnrolledCourse, &s.PaymentStatus, &s.Tags, &s.CustomFields, &createdAt, &updatedAt)
	if err != nil {
		return studentResponse{}, err
	}
	s.CreatedAt = createdAt
	s.UpdatedAt = updatedAt
	return s, nil
}