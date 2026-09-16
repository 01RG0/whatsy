package presence

import (
	"context"
	"sync"
	"time"
)

// ViewerInfo describes an agent currently viewing a student conversation.
type ViewerInfo struct {
	AgentID string
	Name    string
	Avatar  string
}

// TypingLock represents an exclusive typing lock on a student conversation.
type TypingLock struct {
	LockedBy  ViewerInfo
	ExpiresAt time.Time
	cancel    context.CancelFunc
	onExpire  func(string)
}

// Manager tracks presence viewers and typing locks per student conversation.
type Manager struct {
	mu    sync.RWMutex
	rooms map[string]map[string]ViewerInfo
	locks map[string]*TypingLock
}

// NewManager creates an empty presence manager.
func NewManager() *Manager {
	return &Manager{
		rooms: make(map[string]map[string]ViewerInfo),
		locks: make(map[string]*TypingLock),
	}
}

// AddViewer registers a viewer in a student room and returns the updated viewer list.
func (m *Manager) AddViewer(studentID string, viewer ViewerInfo) []ViewerInfo {
	m.mu.Lock()
	defer m.mu.Unlock()

	room, ok := m.rooms[studentID]
	if !ok {
		room = make(map[string]ViewerInfo)
		m.rooms[studentID] = room
	}
	room[viewer.AgentID] = viewer

	return viewersFromRoom(room)
}

// RemoveViewer removes a viewer from a student room and returns the updated viewer list.
func (m *Manager) RemoveViewer(studentID, agentID string) []ViewerInfo {
	m.mu.Lock()
	defer m.mu.Unlock()

	room, ok := m.rooms[studentID]
	if !ok {
		return nil
	}

	delete(room, agentID)
	if len(room) == 0 {
		delete(m.rooms, studentID)
		return nil
	}

	return viewersFromRoom(room)
}

// GetViewers returns a snapshot of viewers currently in a student room.
func (m *Manager) GetViewers(studentID string) []ViewerInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	room, ok := m.rooms[studentID]
	if !ok {
		return nil
	}

	return viewersFromRoom(room)
}

func viewersFromRoom(room map[string]ViewerInfo) []ViewerInfo {
	viewers := make([]ViewerInfo, 0, len(room))
	for _, v := range room {
		viewers = append(viewers, v)
	}
	return viewers
}
