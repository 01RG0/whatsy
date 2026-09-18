package domain

import "time"

type Participant struct {
	ID          string    `json:"id"`
	DisplayName string    `json:"displayName"`
	PhoneNumber string    `json:"phoneNumber"`
	AvatarURL   string    `json:"avatarUrl"`
	IsOnline    bool      `json:"isOnline"`
	LastSeen    time.Time `json:"lastSeen"`
}

type AssignedAgent struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
}

type LastMessagePreview struct {
	ID         string    `json:"id"`
	Content    string    `json:"content"`
	Type       string    `json:"type"`
	Direction  string    `json:"direction"`
	SenderName string    `json:"senderName,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	Status     string    `json:"status"`
}

type Conversation struct {
	ID            string             `json:"id"`
	AccountID     string             `json:"accountId"`
	Platform      string             `json:"platform"`
	Participant   Participant        `json:"participant"`
	LastMessage   LastMessagePreview `json:"lastMessage"`
	UnreadCount   int                `json:"unreadCount"`
	IsPinned      bool               `json:"isPinned"`
	IsMuted       bool               `json:"isMuted"`
	IsGroup       bool               `json:"isGroup"`
	Tags          []string           `json:"tags"`
	AssignedAgent *AssignedAgent     `json:"assignedAgent"`
	UpdatedAt     time.Time          `json:"updatedAt"`
}
