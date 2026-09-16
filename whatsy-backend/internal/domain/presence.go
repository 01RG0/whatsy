package domain

import "time"

type ViewerInfo struct {
	AgentID string `json:"agentId"`
	Name    string `json:"name"`
	Avatar  string `json:"avatar"`
}

type TypingLock struct {
	LockedBy  ViewerInfo `json:"lockedBy"`
	ExpiresAt time.Time  `json:"expiresAt"`
}
