package handler

import (
	"net"
	"net/http"
	"sync"
	"time"
)

type ipBucket struct {
	tokens   float64
	lastSeen time.Time
}

// RateLimiter is a per-IP token-bucket rate limiter.
type RateLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*ipBucket
	rate     float64 // tokens per second
	capacity float64
}

// NewRateLimiter creates a limiter allowing `perMin` requests per minute per IP.
func NewRateLimiter(perMin int) *RateLimiter {
	rl := &RateLimiter{
		buckets:  make(map[string]*ipBucket),
		rate:     float64(perMin) / 60.0,
		capacity: float64(perMin),
	}
	go rl.cleanup()
	return rl
}

func (rl *RateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, ok := rl.buckets[ip]
	if !ok {
		rl.buckets[ip] = &ipBucket{tokens: rl.capacity - 1, lastSeen: now}
		return true
	}

	elapsed := now.Sub(b.lastSeen).Seconds()
	b.tokens += elapsed * rl.rate
	if b.tokens > rl.capacity {
		b.tokens = rl.capacity
	}
	b.lastSeen = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	for range ticker.C {
		rl.mu.Lock()
		cutoff := time.Now().Add(-10 * time.Minute)
		for ip, b := range rl.buckets {
			if b.lastSeen.Before(cutoff) {
				delete(rl.buckets, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// Middleware returns an http.Handler middleware that rate-limits by IP.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			ip = r.RemoteAddr
		}
		if !rl.allow(ip) {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limit exceeded"})
			return
		}
		next.ServeHTTP(w, r)
	})
}
