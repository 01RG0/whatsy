// Package supabase provides a thin client for Supabase Realtime broadcast.
package supabase

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// Broadcaster sends server-side broadcast messages to Supabase Realtime.
// Clients subscribed to the same channel receive them in <200ms.
type Broadcaster struct {
	url        string // e.g. https://xyz.supabase.co/realtime/v1/api/broadcast
	serviceKey string
	client     *http.Client
}

// NewBroadcaster creates a Broadcaster. Returns nil if projectURL or serviceKey
// is empty — callers must nil-check before use.
func NewBroadcaster(projectURL, serviceKey string) *Broadcaster {
	if projectURL == "" || serviceKey == "" {
		return nil
	}
	return &Broadcaster{
		url:        projectURL + "/realtime/v1/api/broadcast",
		serviceKey: serviceKey,
		client:     &http.Client{Timeout: 5 * time.Second},
	}
}

type broadcastEnvelope struct {
	Messages []broadcastMsg `json:"messages"`
}

type broadcastMsg struct {
	Topic   string      `json:"topic"`
	Event   string      `json:"event"`
	Payload interface{} `json:"payload"`
}

// Send fires a broadcast on the given topic/event with payload. Best-effort:
// errors are logged but never propagated to the caller.
func (b *Broadcaster) Send(ctx context.Context, topic, event string, payload interface{}) {
	if b == nil {
		return
	}
	body, err := json.Marshal(broadcastEnvelope{
		Messages: []broadcastMsg{{Topic: topic, Event: event, Payload: payload}},
	})
	if err != nil {
		log.Printf("[supabase broadcast] marshal: %v", err)
		return
	}
	req, err := http.NewRequestWithContext(ctx, "POST", b.url, bytes.NewReader(body))
	if err != nil {
		log.Printf("[supabase broadcast] build request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+b.serviceKey)
	req.Header.Set("apikey", b.serviceKey)

	resp, err := b.client.Do(req)
	if err != nil {
		log.Printf("[supabase broadcast] send: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		log.Printf("[supabase broadcast] unexpected status %d", resp.StatusCode)
		return
	}
	log.Printf("[supabase broadcast] sent %s/%s ok", topic, event)
}
