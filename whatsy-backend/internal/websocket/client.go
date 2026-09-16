package websocket

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/whatsy/backend/internal/domain"
	"nhooyr.io/websocket"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = 30 * time.Second

	// Maximum message size allowed from peer.
	maxMessageSize = 32 * 1024 // 32KB
)

// Client represents an active WebSocket client connection.
type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte

	agentID     string
	agentName   string
	agentAvatar string

	subMu sync.RWMutex
	// subscriptions keeps track of studentIDs subscribed by this client
	subscriptions map[string]bool
}

// NewClient creates a new Client instance.
func NewClient(hub *Hub, conn *websocket.Conn, agentID, agentName, agentAvatar string) *Client {
	return &Client{
		hub:           hub,
		conn:          conn,
		send:          make(chan []byte, 256),
		agentID:       agentID,
		agentName:     agentName,
		agentAvatar:   agentAvatar,
		subscriptions: make(map[string]bool),
	}
}

// ViewerInfo returns domain.ViewerInfo for this client.
func (c *Client) ViewerInfo() domain.ViewerInfo {
	return domain.ViewerInfo{
		AgentID: c.agentID,
		Name:    c.agentName,
		Avatar:  c.agentAvatar,
	}
}

func (c *Client) addSubscription(studentID string) {
	c.subMu.Lock()
	defer c.subMu.Unlock()
	c.subscriptions[studentID] = true
}

func (c *Client) removeSubscription(studentID string) {
	c.subMu.Lock()
	defer c.subMu.Unlock()
	delete(c.subscriptions, studentID)
}

// ReadPump pumps messages from the websocket connection to the hub.
func (c *Client) ReadPump(ctx context.Context) {
	defer func() {
		c.hub.Unregister(c)
		_ = c.conn.Close(websocket.StatusNormalClosure, "")
	}()

	c.conn.SetReadLimit(maxMessageSize)

	for {
		_, reader, err := c.conn.Reader(ctx)
		if err != nil {
			if websocket.CloseStatus(err) != websocket.StatusNormalClosure &&
				websocket.CloseStatus(err) != websocket.StatusGoingAway {
				log.Printf("websocket client %s read error: %v", c.agentID, err)
			}
			break
		}

		var action ClientAction
		if err := json.NewDecoder(reader).Decode(&action); err != nil {
			log.Printf("websocket client %s json decode error: %v", c.agentID, err)
			continue
		}

		switch action.Action {
		case ActionSubscribeStudent:
			c.hub.Subscribe(c, action.StudentID)

		case ActionUnsubscribeStudent:
			c.hub.Unsubscribe(c, action.StudentID)

		case ActionTypingStart:
			c.hub.HandleTypingStart(c, action.StudentID)

		case ActionTypingStop:
			c.hub.HandleTypingStop(c, action.StudentID)

		default:
			log.Printf("websocket client %s unknown action: %s", c.agentID, action.Action)
		}
	}
}

// WritePump pumps messages from the send channel to the websocket connection with ping keepalive.
func (c *Client) WritePump(ctx context.Context) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close(websocket.StatusNormalClosure, "")
	}()

	for {
		select {
		case <-ctx.Done():
			return

		case message, ok := <-c.send:
			if !ok {
				// The hub closed the channel.
				_ = c.conn.Close(websocket.StatusNormalClosure, "hub closed channel")
				return
			}

			writeCtx, writeCancel := context.WithTimeout(ctx, writeWait)
			err := c.conn.Write(writeCtx, websocket.MessageText, message)
			writeCancel()
			if err != nil {
				log.Printf("websocket client %s write error: %v", c.agentID, err)
				return
			}

		case <-ticker.C:
			pingCtx, pingCancel := context.WithTimeout(ctx, writeWait)
			err := c.conn.Ping(pingCtx)
			pingCancel()
			if err != nil {
				log.Printf("websocket client %s ping error: %v", c.agentID, err)
				return
			}
		}
	}
}
