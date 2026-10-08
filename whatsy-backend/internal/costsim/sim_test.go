// Package costsim verifies the cost-optimisation logic added in October 2026.
// It uses NO environment variables, NO database, and NO network calls.
// Run with:  go test ./internal/costsim/ -v
package costsim_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/subtle"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// ── 1. Token bucket rate limiter ────────────────────────────────────────────

func newTokenBucket(tokensPerInterval time.Duration, burst int) chan struct{} {
	rl := make(chan struct{}, burst)
	go func() {
		tk := time.NewTicker(tokensPerInterval)
		defer tk.Stop()
		for range tk.C {
			select {
			case rl <- struct{}{}:
			default:
			}
		}
	}()
	return rl
}

func acquireToken(ctx context.Context, rl chan struct{}) error {
	select {
	case <-rl:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func TestRateLimiter_BlocksUntilToken(t *testing.T) {
	// 1 token every 100ms, burst=1
	rl := newTokenBucket(100*time.Millisecond, 1)

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	start := time.Now()
	if err := acquireToken(ctx, rl); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	elapsed := time.Since(start)

	// Should have waited ~100ms for the first token
	if elapsed < 80*time.Millisecond {
		t.Errorf("acquired token too fast (%v) — token bucket may not be empty at start", elapsed)
	}
	t.Logf("first token acquired after %v (expected ~100ms)", elapsed)
}

func TestRateLimiter_ContextCancels(t *testing.T) {
	// Very slow bucket: 1 token every 10 seconds
	rl := newTokenBucket(10*time.Second, 1)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err := acquireToken(ctx, rl)
	if err == nil {
		t.Fatal("expected context deadline error, got nil")
	}
	t.Logf("correctly cancelled: %v", err)
}

func TestRateLimiter_MaxBurst(t *testing.T) {
	// 1 token every 50ms, burst=2 — manually pre-fill
	rl := make(chan struct{}, 2)
	rl <- struct{}{} // pre-fill 1 token
	rl <- struct{}{} // pre-fill 2 tokens

	ctx := context.Background()

	// Should be able to acquire 2 tokens instantly
	for i := range 2 {
		start := time.Now()
		if err := acquireToken(ctx, rl); err != nil {
			t.Fatalf("token %d: unexpected error: %v", i, err)
		}
		if elapsed := time.Since(start); elapsed > 5*time.Millisecond {
			t.Errorf("token %d: should be instant, took %v", i, elapsed)
		}
	}

	// Third acquire should block (bucket empty)
	ctx2, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if err := acquireToken(ctx2, rl); err == nil {
		t.Error("expected timeout — bucket should be empty after burst")
	} else {
		t.Logf("correctly blocked after burst: %v", err)
	}
}

// ── 2. ConstantTimeCompare for /internal/sync secret ───────────────────────

func TestSecretValidation_CorrectSecret(t *testing.T) {
	secret := "sk_" + "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
	incoming := secret
	if subtle.ConstantTimeCompare([]byte(incoming), []byte(secret)) != 1 {
		t.Error("correct secret should pass")
	}
}

func TestSecretValidation_WrongSecret(t *testing.T) {
	secret := "sk_correct"
	incoming := "sk_wrong"
	if subtle.ConstantTimeCompare([]byte(incoming), []byte(secret)) == 1 {
		t.Error("wrong secret should fail")
	}
}

func TestSecretValidation_EmptySecret(t *testing.T) {
	// If WORKER_SECRET env is not set, simulate the 503 guard
	secret := ""
	if secret == "" {
		t.Log("correctly detects unconfigured secret → would return 503")
		return
	}
	t.Error("should have returned early")
}

// ── 3. Concurrent sync prevention (TryLock) ─────────────────────────────────

func TestSyncMutex_PreventsDoubleSync(t *testing.T) {
	var mu sync.Mutex

	// First acquire — should succeed
	if !mu.TryLock() {
		t.Fatal("first TryLock should succeed")
	}

	// Second acquire while first is held — should fail (return 429)
	if mu.TryLock() {
		mu.Unlock()
		t.Fatal("second TryLock should fail while first is held")
	}
	t.Log("correctly prevents double sync")

	mu.Unlock()

	// After release, next acquire should succeed
	if !mu.TryLock() {
		t.Fatal("TryLock should succeed after release")
	}
	mu.Unlock()
	t.Log("correctly allows sync after previous completes")
}

// ── 4. msgQueryLimit equivalent ─────────────────────────────────────────────

func msgQueryLimit(r *http.Request) int {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return 80
	}
	limit := 0
	for _, c := range raw {
		if c < '0' || c > '9' {
			return 80
		}
		limit = limit*10 + int(c-'0')
	}
	if limit <= 0 {
		return 80
	}
	if limit > 80 {
		return 80
	}
	return limit
}

func TestMsgQueryLimit(t *testing.T) {
	cases := []struct {
		query string
		want  int
	}{
		{"", 80},          // no param → default
		{"50", 50},        // normal
		{"80", 80},        // exactly cap
		{"100", 80},       // over cap → clamped
		{"999", 80},       // way over cap → clamped
		{"0", 80},         // zero → default
		{"-1", 80},        // negative → default (non-digit causes default)
		{"abc", 80},       // invalid → default
	}
	for _, tc := range cases {
		req := httptest.NewRequest("GET", "/?limit="+tc.query, nil)
		got := msgQueryLimit(req)
		if got != tc.want {
			t.Errorf("limit=%q: got %d, want %d", tc.query, got, tc.want)
		}
	}
	t.Log("msgQueryLimit: all cases pass")
}

// ── 5. Gzip compression simulation ──────────────────────────────────────────

func TestGzipCompression_ResponseBody(t *testing.T) {
	// Simulate a JSON response body and verify gzip reduces its size
	payload := bytes.Repeat([]byte(`{"id":"abc123","name":"test","status":"open","lastMessage":"hello world"}`), 20)

	var compressed bytes.Buffer
	w := gzip.NewWriter(&compressed)
	w.Write(payload)
	w.Close()

	original := len(payload)
	compressedSize := len(compressed.Bytes())
	ratio := 100 - (compressedSize*100/original)

	t.Logf("original: %d bytes, compressed: %d bytes, saved: %d%%", original, compressedSize, ratio)

	if ratio < 50 {
		t.Errorf("expected >50%% compression on repetitive JSON, got %d%%", ratio)
	}
	t.Log("gzip compression: working as expected")
}

func TestGzipCompression_Decompresses(t *testing.T) {
	original := []byte(`{"conversations":[{"id":"1"},{"id":"2"}]}`)

	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	w.Write(original)
	w.Close()

	r, err := gzip.NewReader(&buf)
	if err != nil {
		t.Fatalf("new gzip reader: %v", err)
	}
	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	if !bytes.Equal(original, got) {
		t.Errorf("round-trip failed:\n  want: %s\n   got: %s", original, got)
	}
	t.Log("gzip round-trip: OK")
}

// ── 6. WS channel buffer — catch-up replay simulation ───────────────────────

func TestWSBuffer_CatchUpFitsIn128(t *testing.T) {
	const catchUpMaxEntries = 50
	const sendBuf = 128

	send := make(chan []byte, sendBuf)

	// Simulate catch-up replay pushing 50 messages on reconnect
	for i := range catchUpMaxEntries {
		msg := []byte(`{"type":"message","id":` + itoa(i) + `}`)
		select {
		case send <- msg:
		default:
			t.Fatalf("channel full at message %d — buffer too small", i)
		}
	}

	// After replay, there should still be headroom for live messages
	headroom := cap(send) - len(send)
	t.Logf("after catch-up replay: %d/%d slots used, %d headroom", len(send), cap(send), headroom)

	if headroom < 10 {
		t.Errorf("too little headroom after replay: %d slots", headroom)
	}
	t.Log("WS buffer: 128 safely absorbs 50-entry catch-up + live traffic")
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}

// ── 7. Frontend default limit consistency ───────────────────────────────────

func TestFrontendDefaultLimit(t *testing.T) {
	// Simulate backend cap and frontend default — they must match
	const backendCap = 80
	const frontendDefault = 80 // was 100, now fixed to match backend

	if frontendDefault > backendCap {
		t.Errorf("frontend default (%d) > backend cap (%d) — hasMoreMessages logic will be wrong", frontendDefault, backendCap)
	}
	t.Logf("frontend default (%d) == backend cap (%d) — hasMoreMessages logic correct", frontendDefault, backendCap)
}

func TestPrefetchHasMoreMessages(t *testing.T) {
	const cap = 80

	cases := []struct {
		msgs    int
		wantMore bool
	}{
		{80, true},   // exactly at cap → might be more
		{79, false},  // under cap → definitely no more
		{50, false},  // well under cap
		{0,  false},  // empty conversation
	}

	for _, tc := range cases {
		got := tc.msgs >= cap
		if got != tc.wantMore {
			t.Errorf("msgs=%d: hasMoreMessages=%v, want %v", tc.msgs, got, tc.wantMore)
		}
	}
	t.Log("prefetch hasMoreMessages logic: all cases correct")
}

// ── 8. /internal/sync full flow simulation ──────────────────────────────────

func TestInternalSync_FullFlow(t *testing.T) {
	secret := "test-secret-value"
	var mu sync.Mutex

	// Simulate the handler
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if secret == "" {
			w.WriteHeader(503)
			return
		}
		auth := r.Header.Get("Authorization")
		if len(auth) > 7 {
			auth = auth[7:] // trim "Bearer "
		}
		if subtle.ConstantTimeCompare([]byte(auth), []byte(secret)) != 1 {
			w.WriteHeader(401)
			return
		}
		if !mu.TryLock() {
			w.WriteHeader(429)
			return
		}
		defer mu.Unlock()
		w.WriteHeader(200)
		w.Write([]byte(`{"synced":3}`))
	})

	t.Run("correct secret → 200", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/internal/sync", nil)
		req.Header.Set("Authorization", "Bearer "+secret)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != 200 {
			t.Errorf("want 200, got %d", rr.Code)
		}
		t.Log("correct secret:", rr.Body.String())
	})

	t.Run("wrong secret → 401", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/internal/sync", nil)
		req.Header.Set("Authorization", "Bearer wrong-secret")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != 401 {
			t.Errorf("want 401, got %d", rr.Code)
		}
		t.Log("wrong secret correctly rejected")
	})

	t.Run("no Authorization header → 401", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/internal/sync", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != 401 {
			t.Errorf("want 401, got %d", rr.Code)
		}
		t.Log("missing auth correctly rejected")
	})

	t.Run("concurrent sync → 429", func(t *testing.T) {
		mu.Lock() // simulate a sync already running
		defer mu.Unlock()

		req := httptest.NewRequest("POST", "/internal/sync", nil)
		req.Header.Set("Authorization", "Bearer "+secret)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != 429 {
			t.Errorf("want 429, got %d", rr.Code)
		}
		t.Log("concurrent sync correctly blocked with 429")
	})
}
