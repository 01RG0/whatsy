package presence

import (
	"context"
	"time"
)

const lockTTL = 5 * time.Second

// AcquireLock tries to take an exclusive typing lock for studentID.
// If acquired, the lock expires after 5s unless renewed; onExpire is called with studentID on expiry.
// Returns false if another agent already holds a non-expired lock.
func (m *Manager) AcquireLock(studentID string, agent ViewerInfo, onExpire func(string)) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	if existing, ok := m.locks[studentID]; ok {
		if time.Now().Before(existing.ExpiresAt) && existing.LockedBy.AgentID != agent.AgentID {
			return false
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
		onExpire:  onExpire,
	}
	m.locks[studentID] = lock

	go m.watchLockExpiry(ctx, studentID, agent.AgentID, onExpire)

	return true
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

	go m.watchLockExpiry(ctx, studentID, agentID, lock.onExpire)

	return true
}

// ReleaseLock releases the typing lock if agentID currently holds it.
func (m *Manager) ReleaseLock(studentID, agentID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	lock, ok := m.locks[studentID]
	if !ok || lock.LockedBy.AgentID != agentID {
		return false
	}

	if lock.cancel != nil {
		lock.cancel()
	}
	delete(m.locks, studentID)
	return true
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

	// Return a copy without the cancel func so callers cannot cancel the timer.
	cp := *lock
	cp.cancel = nil
	return &cp
}

func (m *Manager) watchLockExpiry(ctx context.Context, studentID, agentID string, onExpire func(string)) {
	timer := time.NewTimer(lockTTL)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return
	case <-timer.C:
		m.mu.Lock()
		lock, ok := m.locks[studentID]
		expired := ok && lock.LockedBy.AgentID == agentID && !time.Now().Before(lock.ExpiresAt)
		if expired {
			delete(m.locks, studentID)
		}
		m.mu.Unlock()

		if expired && onExpire != nil {
			onExpire(studentID)
		}
	}
}
