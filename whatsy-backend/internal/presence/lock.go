package presence

import (
	"context"
	"fmt"
	"time"

	"github.com/whatsy/backend/internal/domain"
)

const lockTTL = 5 * time.Second

// AcquireLock tries to take an exclusive typing lock for studentID.
// Returns the TTL in milliseconds, or an error if another agent holds a live lock.
func (m *Manager) AcquireLock(studentID string, agent domain.ViewerInfo) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if existing, ok := m.locks[studentID]; ok {
		if time.Now().Before(existing.ExpiresAt) && existing.LockedBy.AgentID != agent.AgentID {
			return 0, fmt.Errorf("lock held by agent %s", existing.LockedBy.AgentID)
		}
		if existing.cancel != nil {
			existing.cancel()
		}
		delete(m.locks, studentID)
	}

	ctx, cancel := context.WithCancel(context.Background())
	lock := &TypingLock{
		LockedBy:  agent,
		ExpiresAt: time.Now().Add(lockTTL),
		cancel:    cancel,
	}
	m.locks[studentID] = lock

	go m.watchLockExpiry(ctx, studentID, agent.AgentID)

	return lockTTL.Milliseconds(), nil
}

// RenewLock extends the typing lock TTL if agentID currently holds it.
func (m *Manager) RenewLock(studentID, agentID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	lock, ok := m.locks[studentID]
	if !ok || lock.LockedBy.AgentID != agentID {
		return false
	}
	if time.Now().After(lock.ExpiresAt) {
		return false
	}

	if lock.cancel != nil {
		lock.cancel()
	}

	ctx, cancel := context.WithCancel(context.Background())
	lock.ExpiresAt = time.Now().Add(lockTTL)
	lock.cancel = cancel

	go m.watchLockExpiry(ctx, studentID, agentID)

	return true
}

// ReleaseLock releases the typing lock if agentID currently holds it.
func (m *Manager) ReleaseLock(studentID, agentID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	lock, ok := m.locks[studentID]
	if !ok {
		return nil
	}
	if lock.LockedBy.AgentID != agentID {
		return fmt.Errorf("lock held by different agent")
	}

	if lock.cancel != nil {
		lock.cancel()
	}
	delete(m.locks, studentID)
	return nil
}

// GetLock returns the current typing lock for studentID, or nil if none.
func (m *Manager) GetLock(studentID string) *TypingLock {
	m.mu.RLock()
	defer m.mu.RUnlock()

	lock, ok := m.locks[studentID]
	if !ok {
		return nil
	}
	if time.Now().After(lock.ExpiresAt) {
		return nil
	}

	cp := *lock
	cp.cancel = nil
	return &cp
}

func (m *Manager) watchLockExpiry(ctx context.Context, studentID, agentID string) {
	timer := time.NewTimer(lockTTL)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return
	case <-timer.C:
		m.mu.Lock()
		lock, ok := m.locks[studentID]
		if ok && lock.LockedBy.AgentID == agentID && !time.Now().Before(lock.ExpiresAt) {
			delete(m.locks, studentID)
		}
		m.mu.Unlock()
	}
}
