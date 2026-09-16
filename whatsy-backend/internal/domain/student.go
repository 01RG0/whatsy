package domain

import "time"

type Student struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Phone          string            `json:"phone"`
	Grade          string            `json:"grade"`
	EnrolledCourse string            `json:"enrolledCourse"`
	PaymentStatus  string            `json:"paymentStatus"`
	Tags           []string          `json:"tags"`
	CustomFields   map[string]string `json:"customFields"`
	CreatedAt      time.Time         `json:"createdAt"`
	UpdatedAt      time.Time         `json:"updatedAt"`
}
