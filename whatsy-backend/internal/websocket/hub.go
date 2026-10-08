package websocket

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/whatsy/backend/internal/domain"
	"github.com/whatsy/backend/internal/eventlog"
)

const (
	// catchUpWindow is how far back we replay messages for a reconnecting client.
	catchUpWindow = 5 * time.Minute

	// catchUpMaxEntries is the maximum number of entries kept in the ring buffer.
	catchUpMaxEntries = 50
)

// catchUpEntry is one entry in the in-memory replay ring buffer.
type catchUpEntry struct {
	data     []byte
	ts       time.Time
	tenantID string
}

type roomMessage struct {
	studentID string
	data      []byte
}

// PresenceManager defines optional presence lock management if integrated.
type PresenceManager interface {
	AcquireLock(studentID string, agent domain.ViewerInfo) (expiresInMs int64, err error)
	ReleaseLock(studentID string, agentID string) error
}

// RedisPublisher publishes events to Redis for cross-instance relay.
type RedisPublisher interface {
	Publish(ctx context.Context, event interface{})
}

// Hub maintains the set of active clients, room subscriptions, and broadcasts messages.
type Hub struct {
	mu sync.RWMutex

	// Registered clients: client -> true
	clients map[*Client]bool

	// Student rooms: studentId -> set of clients
	rooms map[string]map[*Client]bool

	// Inbound register requests
	register chan *Client

	// Inbound unregister requests
	unregister chan *Client

	// Inbound broadcast messages to all connected clients
	broadcastAll chan []byte

	// Inbound broadcast messages to room subscribers
	broadcastRoom chan roomMessage

	// Optional presence manager
	presence PresenceManager

	// Optional Redis relay for multi-instance
	redis RedisPublisher

	// In-memory replay buffer: last catchUpMaxEntries messages broadcast to all
	// clients, used to catch up reconnecting clients without a DB round-trip.
	catchUpBuf []catchUpEntry
}

// NewHub creates a new Hub instance.
func NewHub(presence ...PresenceManager) *Hub {
	var pm PresenceManager
	if len(presence) > 0 {
		pm = presence[0]
	}

	return &Hub{
		clients:       make(map[*Client]bool),
		rooms:         make(map[string]map[*Client]bool),
		register:      make(chan *Client),
		unregister:    make(chan *Client),
		broadcastAll:  make(chan []byte, 64),
		broadcastRoom: make(chan roomMessage, 64),
		presence:      pm,
	}
}

// Register registers a new client to the hub.
func (h *Hub) Register(client *Client) {
	h.register <- client
}

// Unregister unregisters a client from the hub.
func (h *Hub) Unregister(client *Client) {
	h.unregister <- client
}

// Subscribe adds a client to a student's room.
func (h *Hub) Subscribe(client *Client, studentID string) {
	if studentID == "" || client == nil {
		return
	}

	h.mu.Lock()
	if _, ok := h.rooms[studentID]; !ok {
		h.rooms[studentID] = make(map[*Client]bool)
	}
	h.rooms[studentID][client] = true
	h.mu.Unlock()

	client.addSubscription(studentID)
	h.broadcastRoomViewers(studentID)
}

// Unsubscribe removes a client from a student's room.
func (h *Hub) Unsubscribe(client *Client, studentID string) {
	if studentID == "" || client == nil {
		return
	}

	h.mu.Lock()
	if roomClients, ok := h.rooms[studentID]; ok {
		delete(roomClients, client)
		if len(roomClients) == 0 {
			delete(h.rooms, studentID)
		}
	}
	h.mu.Unlock()

	client.removeSubscription(studentID)
	h.broadcastRoomViewers(studentID)
}

// BroadcastToRoom marshals the event to JSON and sends it to all clients in the student's room.
func (h *Hub) BroadcastToRoom(studentID string, event interface{}) {
	if studentID == "" {
		return
	}

	data, err := json.Marshal(event)
	if err != nil {
		log.Printf("websocket hub: error marshaling room event: %v", err)
		return
	}

	h.broadcastRoom <- roomMessage{
		studentID: studentID,
		data:      data,
	}
}

// appendToCatchUpBuf appends a broadcast entry to the ring buffer.
// Entries older than catchUpWindow are pruned first, then the slice is capped
// at catchUpMaxEntries. Must be called with h.mu held for writing.
func (h *Hub) appendToCatchUpBuf(data []byte, tenantID string) {
	now := time.Now()
	cutoff := now.Add(-catchUpWindow)

	// Drop expired entries from the front.
	start := 0
	for start < len(h.catchUpBuf) && h.catchUpBuf[start].ts.Before(cutoff) {
		start++
	}
	h.catchUpBuf = h.catchUpBuf[start:]

	h.catchUpBuf = append(h.catchUpBuf, catchUpEntry{data: data, ts: now, tenantID: tenantID})

	// Hard-cap at catchUpMaxEntries by dropping the oldest.
	if len(h.catchUpBuf) > catchUpMaxEntries {
		excess := len(h.catchUpBuf) - catchUpMaxEntries
		h.catchUpBuf = h.catchUpBuf[excess:]
	}
}

// recentCatchUpEntries returns a snapshot of entries newer than catchUpWindow.
// The returned slice is a copy so it is safe to iterate outside the lock.
func (h *Hub) recentCatchUpEntries() []catchUpEntry {
	h.mu.RLock()
	defer h.mu.RUnlock()

	cutoff := time.Now().Add(-catchUpWindow)
	var result []catchUpEntry
	for _, e := range h.catchUpBuf {
		if !e.ts.Before(cutoff) {
			result = append(result, e)
		}
	}
	return result
}

// SetRedis wires an optional Redis publisher for cross-instance broadcast.
func (h *Hub) SetRedis(r RedisPublisher) {
	h.redis = r
}

// BroadcastToAll marshals the event to JSON and sends it to all connected clients.
// If Redis is wired, also publishes so other instances relay the event.
// NEW_MESSAGE events are additionally stored in the catch-up ring buffer so
// reconnecting clients can replay messages they missed during a disconnect.
func (h *Hub) BroadcastToAll(event interface{}) {
	data, err := json.Marshal(event)
	if err != nil {
		log.Printf("websocket hub: error marshaling broadcast event: %v", err)
		return
	}

	// Extract tenant_id from the marshaled JSON for ring buffer tagging.
	var envelope struct {
		TenantID string `json:"tenant_id"`
	}
	_ = json.Unmarshal(data, &envelope)

	if ev, ok := event.(NewMessageEvent); ok {
		eventlog.TraceStep3BroadcastQueued("NEW_MESSAGE", ev.Message.ID, ev.StudentID)
		// Store in ring buffer so reconnecting clients can catch up.
		h.mu.Lock()
		h.appendToCatchUpBuf(data, envelope.TenantID)
		h.mu.Unlock()
	}

	h.broadcastAll <- data
	if h.redis != nil {
		go h.redis.Publish(context.Background(), event)
	}
}

// InjectBroadcast sends raw JSON to all local clients. Used by Redis
// subscriber to relay events from other instances without re-publishing.
func (h *Hub) InjectBroadcast(data []byte) {
	h.broadcastAll <- data
}

// HandleTypingStart handles when a client starts typing for a student conversation.
func (h *Hub) HandleTypingStart(client *Client, studentID string) {
	if studentID == "" || client == nil {
		return
	}

	viewer := client.ViewerInfo()
	var expiresInMs int64 = 10000 // default 10s typing lock

	if h.presence != nil {
		exp, err := h.presence.AcquireLock(studentID, viewer)
		if err != nil {
			log.Printf("websocket hub: typing lock acquire error: %v", err)
			return
		}
		expiresInMs = exp
	}

	h.BroadcastToAll(AgentTypingLockEvent{
		Event:       EventAgentTypingLock,
		StudentID:   studentID,
		LockedBy:    viewer,
		ExpiresInMs: expiresInMs,
		TenantID:    client.TenantID,
	})
}

// HandleTypingStop handles when a client stops typing for a student conversation.
func (h *Hub) HandleTypingStop(client *Client, studentID string) {
	if studentID == "" || client == nil {
		return
	}

	if h.presence != nil {
		_ = h.presence.ReleaseLock(studentID, client.agentID)
	}

	h.BroadcastToAll(TypingLockReleasedEvent{
		Event:     EventTypingLockReleased,
		StudentID: studentID,
		TenantID:  client.TenantID,
	})
}

// broadcastRoomViewers collects unique viewers in a room and broadcasts STUDENT_VIEWERS_CHANGED.
func (h *Hub) broadcastRoomViewers(studentID string) {
	h.mu.RLock()
	roomClients := h.rooms[studentID]
	viewersMap := make(map[string]domain.ViewerInfo)
	for c := range roomClients {
		if c.agentID != "" {
			viewersMap[c.agentID] = c.ViewerInfo()
		}
	}
	h.mu.RUnlock()

	viewers := make([]domain.ViewerInfo, 0, len(viewersMap))
	for _, v := range viewersMap {
		viewers = append(viewers, v)
	}

	h.BroadcastToRoom(studentID, StudentViewersChangedEvent{
		Event:     EventStudentViewersChanged,
		StudentID: studentID,
		Viewers:   viewers,
	})
}

// removeClientFromRooms removes the client from all rooms and updates viewer counts.
func (h *Hub) removeClientFromRooms(client *Client) {
	h.mu.Lock()
	var affectedStudents []string
	for studentID, roomClients := range h.rooms {
		if roomClients[client] {
			delete(roomClients, client)
			affectedStudents = append(affectedStudents, studentID)
			if len(roomClients) == 0 {
				delete(h.rooms, studentID)
			}
		}
	}
	h.mu.Unlock()

	for _, studentID := range affectedStudents {
		h.broadcastRoomViewers(studentID)
	}
}

// OnlineAgentIDs returns the set of agent IDs with active WebSocket connections.
func (h *Hub) OnlineAgentIDs() map[string]bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	online := make(map[string]bool, len(h.clients))
	for c := range h.clients {
		if c.agentID != "" {
			online[c.agentID] = true
		}
	}
	return online
}

// Run processes register, unregister, and broadcast channels.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			count := len(h.clients)
			h.mu.Unlock()
			eventlog.WSConnect(client.agentID)
			eventlog.WSClientCount(count)

			// Replay any NEW_MESSAGE events from the last 5 minutes so the
			// client catches up on messages it missed while disconnected.
			// Run in a goroutine so hub registration is never blocked.
			go func(c *Client) {
				entries := h.recentCatchUpEntries()
				replayed := 0
				for _, e := range entries {
					if e.tenantID != c.TenantID {
						continue
					}
					select {
					case c.send <- e.data:
						replayed++
					default:
						// Client send buffer full; skip remaining catch-up entries.
						log.Printf("websocket hub: catch-up buffer full for agent %s, skipping remaining entries", c.agentID)
						return
					}
				}
				if replayed > 0 {
					log.Printf("websocket hub: replayed %d catch-up message(s) to agent %s", replayed, c.agentID)
				}
			}(client)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			count := len(h.clients)
			h.mu.Unlock()
			eventlog.WSDisconnect(client.agentID)
			eventlog.WSClientCount(count)

			h.removeClientFromRooms(client)

		case msg := <-h.broadcastRoom:
			h.mu.RLock()
			roomClients, ok := h.rooms[msg.studentID]
			if ok {
				for client := range roomClients {
					select {
					case client.send <- msg.data:
					default:
						// Send buffer full, drop or close
						log.Printf("websocket hub: room send buffer full for agent %s, dropping message", client.agentID)
					}
				}
			}
			h.mu.RUnlock()

		case data := <-h.broadcastAll:
			var envelope struct {
				TenantID string `json:"tenant_id"`
			}
			if jerr := json.Unmarshal(data, &envelope); jerr != nil || envelope.TenantID == "" {
				log.Printf("websocket hub: broadcast event missing tenant_id, skipping delivery")
				eventlog.TraceStep4HubDelivered(0, 0)
				continue
			}
			h.mu.RLock()
			delivered := 0
			dropped := 0
			for client := range h.clients {
				if client.TenantID != envelope.TenantID {
					continue
				}
				select {
				case client.send <- data:
					delivered++
				default:
					dropped++
					log.Printf("websocket hub: broadcast send buffer full for agent %s, dropping message", client.agentID)
				}
			}
			h.mu.RUnlock()
			eventlog.TraceStep4HubDelivered(delivered, dropped)
		}
	}
}
