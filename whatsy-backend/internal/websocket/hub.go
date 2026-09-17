package websocket

import (
	"context"
	"encoding/json"
	"log"
	"sync"

	"github.com/whatsy/backend/internal/domain"
)

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
		broadcastAll:  make(chan []byte, 256),
		broadcastRoom: make(chan roomMessage, 256),
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

// SetRedis wires an optional Redis publisher for cross-instance broadcast.
func (h *Hub) SetRedis(r RedisPublisher) {
	h.redis = r
}

// BroadcastToAll marshals the event to JSON and sends it to all connected clients.
// If Redis is wired, also publishes so other instances relay the event.
func (h *Hub) BroadcastToAll(event interface{}) {
	data, err := json.Marshal(event)
	if err != nil {
		log.Printf("websocket hub: error marshaling broadcast event: %v", err)
		return
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

// Run processes register, unregister, and broadcast channels.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()

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
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- data:
				default:
					log.Printf("websocket hub: broadcast send buffer full for agent %s, dropping message", client.agentID)
				}
			}
			h.mu.RUnlock()
		}
	}
}
