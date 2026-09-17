// Package redispub provides Redis pub/sub for cross-instance WebSocket broadcast.
package redispub

import (
	"context"
	"encoding/json"
	"log"

	"github.com/redis/go-redis/v9"
)

const channel = "whatsy:ws"

// Relay bridges Redis pub/sub and the local WebSocket hub.
type Relay struct {
	rdb *redis.Client
	hub LocalHub
}

// LocalHub is the subset of the WebSocket hub that Relay needs.
type LocalHub interface {
	InjectBroadcast(data []byte)
}

// NewRelay creates a Relay. Returns nil if redisURL is empty.
func NewRelay(redisURL string, hub LocalHub) *Relay {
	if redisURL == "" {
		return nil
	}
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Printf("[redis] bad REDIS_URL: %v — relay disabled", err)
		return nil
	}
	rdb := redis.NewClient(opts)
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		log.Printf("[redis] ping failed: %v — relay disabled", err)
		return nil
	}
	log.Println("[redis] connected — cross-instance broadcast enabled")
	return &Relay{rdb: rdb, hub: hub}
}

// Publish sends a WebSocket event to all instances via Redis.
func (r *Relay) Publish(ctx context.Context, event interface{}) {
	if r == nil {
		return
	}
	data, err := json.Marshal(event)
	if err != nil {
		return
	}
	if err := r.rdb.Publish(ctx, channel, data).Err(); err != nil {
		log.Printf("[redis] publish error: %v", err)
	}
}

// Subscribe listens for events from other instances and injects them into
// the local hub. Run this in a goroutine.
func (r *Relay) Subscribe(ctx context.Context) {
	if r == nil {
		return
	}
	sub := r.rdb.Subscribe(ctx, channel)
	ch := sub.Channel()
	log.Println("[redis] subscribed — listening for cross-instance events")
	for msg := range ch {
		r.hub.InjectBroadcast([]byte(msg.Payload))
	}
}
