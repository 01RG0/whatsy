package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
	"github.com/whatsy/backend/internal/config"
	"github.com/whatsy/backend/internal/handler"
	"github.com/whatsy/backend/internal/presence"
	"github.com/whatsy/backend/internal/redispub"
	"github.com/whatsy/backend/internal/repository"
	"github.com/whatsy/backend/internal/service"
	"github.com/whatsy/backend/internal/websocket"
	"github.com/whatsy/backend/internal/zernio"
)

func main() {
	log.SetOutput(os.Stdout)
	if err := godotenv.Load(); err != nil {
		log.Printf(".env not loaded: %v", err)
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	db, err := sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		log.Fatalf("ping database: %v", err)
	}
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			_ = db.PingContext(context.Background())
		}
	}()

	r := chi.NewRouter()
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	allowedOrigins := map[string]bool{
		"http://localhost:5173":                                  true,
		"http://localhost:3000":                                  true,
		"https://whatsy-frontend-production-4584.up.railway.app": true,
	}
	for _, env := range []string{"FRONTEND_URL", "FRONTEND_URL_2"} {
		if v := os.Getenv(env); v != "" {
			allowedOrigins[v] = true
		}
	}
	r.Use(cors.Handler(cors.Options{
		AllowOriginFunc: func(r *http.Request, origin string) bool {
			return allowedOrigins[origin]
		},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "Cache-Control", "Idempotency-Key"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, 52<<20) // 52 MB
			next.ServeHTTP(w, r)
		})
	})

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	r.Get("/privacy", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(privacyHTML))
	})
	r.Get("/terms", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(termsHTML))
	})

	presenceMgr := presence.NewManager()
	hub := websocket.NewHub(presenceMgr)
	go hub.Run()

	if relay := redispub.NewRelay(cfg.RedisURL, hub); relay != nil {
		hub.SetRedis(relay)
		go relay.Subscribe(context.Background())
	}

	zernioClient := zernio.NewClient(cfg.ZernioAPIKey)

	// Re-enable any Zernio webhooks that were auto-disabled during downtime.
	go func() {
		if err := zernioClient.EnsureWebhookActive(context.Background()); err != nil {
			log.Printf("[startup] webhook check: %v", err)
		}
	}()

	convRepo := repository.NewConversationRepo(db)
	msgRepo := repository.NewMessageRepo(db)
	chatService := service.NewChatService(db, convRepo, msgRepo, zernioClient, hub)
	chatService.SetAutoReplier(service.NewAutoReplyService(db))

	// Retry any outbound messages left stuck in "pending" from a killed deploy.
	go chatService.RetryStuckMessages(context.Background())
	h := handler.New(db, convRepo, msgRepo, chatService, hub, presenceMgr, &cfg)
	tagService := service.NewTagService(db)
	labelHandler := handler.NewLabelHandler(tagService)
	cannedResponseHandler := handler.NewCannedResponseHandler(db)
	agentHandler := handler.NewAgentHandler(db, cfg.JWTSecret, hub)
	mediaHandler := handler.NewMediaHandler(cfg.ZernioAPIKey, db)
	uploadHandler := handler.NewUploadHandler(cfg.ZernioAPIKey)
	authHandler := handler.NewAuthHandler(db, cfg.JWTSecret)
	studentHandler := handler.NewStudentHandler(db)
	autoReplyHandler := handler.NewAutoReplyHandler(db)
	settingsHandler := handler.NewSettingsHandler(db)
	flowHandler := handler.NewFlowHandler(db, zernioClient)
	templateHandler := handler.NewTemplateHandler(cfg.ZernioAPIKey, db)
	broadcastHandler := handler.NewBroadcastHandler(cfg.ZernioAPIKey, db)
	waConnHandler := handler.NewWhatsAppConnectionHandler(db, cfg.ZernioAPIKey)
	syncHandler := handler.NewSyncHandler(db, cfg.ZernioAPIKey)
	analyticsHandler := handler.NewAnalyticsHandler(db)

	// Background incremental sync every 10 minutes — heals +unknown- contacts and
	// keeps conversation list current even when webhooks are missed.
	go func() {
		// Run once at startup to heal any existing +unknown- records immediately.
		if n, err := syncHandler.SyncSince(context.Background(), time.Now().Add(-30*24*time.Hour)); err != nil {
			log.Printf("[sync] startup sync error: %v", err)
		} else {
			log.Printf("[sync] startup sync: %d conversations upserted", n)
		}
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		lastSync := time.Now()
		for range ticker.C {
			since := lastSync
			lastSync = time.Now()
			if n, err := syncHandler.SyncSince(context.Background(), since); err != nil {
				log.Printf("[sync] background sync error: %v", err)
			} else if n > 0 {
				log.Printf("[sync] background sync: %d conversations updated", n)
			}
		}
	}()

	authLimiter := handler.NewRateLimiter(10) // 10 req/min per IP on auth endpoints

	r.Post("/api/webhooks/zernio", h.HandleWebhook)

	r.With(authLimiter.Middleware).Post("/v1/auth/register", authHandler.Register)
	r.With(authLimiter.Middleware).Post("/v1/auth/login", authHandler.Login)

	r.Group(func(r chi.Router) {
		r.Use(handler.JWTMiddleware(cfg.JWTSecret, db))
		r.Get("/v1/whatsapp/media/{mediaId}", mediaHandler.Get)
		r.Get("/v1/whatsapp/media-proxy", mediaHandler.GetProxy)
		r.With(handler.RequireNotViewer).Post("/v1/whatsapp/upload", uploadHandler.Upload)
		r.Get("/v1/agents", agentHandler.List)
		r.Get("/v1/agents/me", agentHandler.Me)
		r.Patch("/v1/agents/me", agentHandler.UpdateMe)
		r.Patch("/v1/agents/me/password", agentHandler.ChangePassword)
		r.Post("/v1/auth/change-password", agentHandler.ChangePassword)
		r.Get("/v1/agents/stats", agentHandler.TeamStats)
		r.With(handler.RequireAdmin).Post("/v1/agents/invite", agentHandler.InviteAgent)
		r.Get("/v1/agents/{id}", agentHandler.Get)
		r.With(handler.RequireAdmin).Patch("/v1/agents/{id}", agentHandler.UpdateAgent)
		r.With(handler.RequireAdmin).Delete("/v1/agents/{id}", agentHandler.DeleteAgent)
		r.Get("/v1/inbox/conversations", h.ListConversations)
		r.Get("/v1/inbox/search", h.SearchMessages)
		r.Get("/v1/inbox/conversations/{id}/messages", h.GetMessages)
		r.With(handler.RequireNotViewer).Post("/v1/inbox/conversations/{id}/messages", h.SendMessage)
		r.With(handler.RequireNotViewer).Post("/v1/inbox/conversations/{id}/read", h.MarkRead)
		r.With(handler.RequireNotViewer).Post("/v1/inbox/conversations/{id}/unread", h.MarkUnread)
		r.With(handler.RequireNotViewer).Post("/v1/inbox/conversations/{id}/assign", h.AssignConversation)
		r.Get("/v1/canned-responses", cannedResponseHandler.List)
		r.Get("/v1/canned-responses/search", cannedResponseHandler.Search)
		r.With(handler.RequireNotViewer).Post("/v1/canned-responses", cannedResponseHandler.Create)
		r.Get("/v1/students", studentHandler.List)
		r.With(handler.RequireNotViewer).Post("/v1/students", studentHandler.Create)
		r.Get("/v1/students/{id}", studentHandler.GetByID)
		r.With(handler.RequireNotViewer).Patch("/v1/students/{id}", studentHandler.Update)
		r.With(handler.RequireNotViewer).Delete("/v1/students/{id}", studentHandler.Delete)
		r.Get("/v1/auto-reply-rules", autoReplyHandler.List)
		r.With(handler.RequireAdmin).Post("/v1/auto-reply-rules", autoReplyHandler.Create)
		r.With(handler.RequireAdmin).Patch("/v1/auto-reply-rules/{id}", autoReplyHandler.Update)
		r.With(handler.RequireAdmin).Delete("/v1/auto-reply-rules/{id}", autoReplyHandler.Delete)

		// Workspace settings & feature flags
		r.Get("/v1/settings", settingsHandler.GetSettings)
		r.With(handler.RequireAdmin).Put("/v1/settings", settingsHandler.UpdateSettings)
		r.Get("/v1/whatsapp/flows", flowHandler.List)
		r.With(handler.RequireAdmin).Post("/v1/whatsapp/flows", flowHandler.Create)
		r.With(handler.RequireAdmin).Put("/v1/whatsapp/flows/{id}/json", flowHandler.UploadJSON)
		r.Get("/v1/whatsapp/flows/{id}/preview", flowHandler.Preview)
		r.With(handler.RequireAdmin).Post("/v1/whatsapp/flows/{id}/publish", flowHandler.Publish)
		r.Get("/ws", h.ServeWebSocket)
		r.Get("/v1/whatsapp/templates", templateHandler.ListTemplates)
		r.With(handler.RequireAdmin).Post("/v1/whatsapp/templates", templateHandler.CreateTemplate)
		r.With(handler.RequireAdmin).Post("/v1/whatsapp/broadcasts", broadcastHandler.SendBroadcast)
		r.Get("/v1/whatsapp/connection/status", waConnHandler.Status)
		r.Get("/v1/whatsapp/connection/qr", waConnHandler.QRCode)
		r.With(handler.RequireAdmin).Post("/v1/whatsapp/connection/connect", waConnHandler.Connect)
		r.With(handler.RequireAdmin).Post("/v1/whatsapp/connection/disconnect", waConnHandler.Disconnect)
		r.With(handler.RequireAdmin).Post("/v1/whatsapp/connection/webhook", waConnHandler.SetWebhook)
		r.With(handler.RequireAdmin).Post("/v1/whatsapp/connection/test", waConnHandler.SendTest)
		r.Get("/v1/sync/stream", syncHandler.Sync)
		r.Post("/v1/sync", syncHandler.SyncJSON)

		// Labels
		r.Get("/v1/labels", labelHandler.List)
		r.Post("/v1/labels", labelHandler.Create)
		r.With(handler.RequireAdmin).Patch("/v1/labels/{id}", labelHandler.Update)
		r.With(handler.RequireAdmin).Delete("/v1/labels/{id}", labelHandler.Delete)
		r.Get("/v1/inbox/conversations/{id}/labels", labelHandler.ListConversationLabels)
		r.With(handler.RequireNotViewer).Post("/v1/inbox/conversations/{id}/labels", labelHandler.AddConversationLabel)
		r.With(handler.RequireNotViewer).Delete("/v1/inbox/conversations/{id}/labels/{labelId}", labelHandler.RemoveConversationLabel)
		r.Get("/v1/students/{id}/labels", labelHandler.ListStudentLabels)
		r.With(handler.RequireNotViewer).Post("/v1/students/{id}/labels", labelHandler.AddStudentLabel)
		r.With(handler.RequireNotViewer).Delete("/v1/students/{id}/labels/{labelId}", labelHandler.RemoveStudentLabel)

		// Analytics
		r.With(handler.RequireAdmin).Get("/v1/analytics/overview", analyticsHandler.Overview)
		r.With(handler.RequireAdmin).Get("/v1/analytics/agents", analyticsHandler.AgentStats)
	})

	// Serve React SPA from ./public if it exists (production Docker image).
	if _, err := os.Stat("public"); err == nil {
		publicFS := os.DirFS("public")
		fileServer := http.FileServer(http.FS(publicFS))
		r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
			path := strings.TrimPrefix(req.URL.Path, "/")
			if _, err := fs.Stat(publicFS, path); err != nil {
				// Not a real file — serve index.html for SPA routing.
				http.ServeFileFS(w, req, publicFS, "index.html")
				return
			}
			fileServer.ServeHTTP(w, req)
		})
	}

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("server listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	// Run migrations after the HTTP server is already listening so Railway's
	// healthcheck at /health can pass even when migrations take a while.
	if err := runMigrations(db); err != nil {
		log.Printf("[WARN] migrations failed: %v — server running with potentially incomplete schema", err)
	}

	<-quit
	log.Println("shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("forced shutdown: %v", err)
	}
	log.Println("server exited")
}

func runMigrations(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)`)
	if err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := os.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" {
			continue
		}
		version := entry.Name()
		var applied bool
		row := db.QueryRow("SELECT true FROM schema_migrations WHERE version=$1", version)
		if scanErr := row.Scan(&applied); scanErr == nil && applied {
			continue
		}
		data, readErr := os.ReadFile(filepath.Join("migrations", version))
		if readErr != nil {
			return fmt.Errorf("read %s: %w", version, readErr)
		}
		if _, execErr := db.Exec(string(data)); execErr != nil {
			// If tables already exist (from supabase db push), record and continue
			if isAlreadyExistsErr(execErr) {
				log.Printf("migration already applied (skipping): %s", version)
				_, _ = db.Exec("INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING", version)
				continue
			}
			return fmt.Errorf("apply %s: %w", version, execErr)
		}
		if _, insErr := db.Exec("INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING", version); insErr != nil {
			return fmt.Errorf("record %s: %w", version, insErr)
		}
		log.Printf("migration applied: %s", version)
	}
	return nil
}

func isAlreadyExistsErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "already exists") || strings.Contains(msg, "42P07")
}

const privacyHTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy Policy — Whatsy</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:60px auto;padding:0 24px;line-height:1.7;color:#1a1a1a}h1{font-size:2rem;margin-bottom:4px}h2{margin-top:2rem;font-size:1.2rem}p,li{color:#333}a{color:#00a884}.updated{color:#888;font-size:.9rem;margin-bottom:2rem}</style>
</head>
<body>
<h1>Privacy Policy</h1>
<p class="updated">Last updated: September 17, 2026</p>

<p>Whatsy ("we", "our", or "us") operates a WhatsApp Business messaging platform. This Privacy Policy explains how we collect, use, and protect your information.</p>

<h2>1. Information We Collect</h2>
<ul>
<li><strong>Account information:</strong> Name, email address, and password when you register.</li>
<li><strong>WhatsApp Business data:</strong> Phone numbers, conversation content, and message metadata processed on your behalf through the WhatsApp Business Platform.</li>
<li><strong>Usage data:</strong> Log data, IP addresses, and browser information for security and analytics.</li>
</ul>

<h2>2. How We Use Your Information</h2>
<ul>
<li>To operate and provide the Whatsy platform.</li>
<li>To facilitate WhatsApp Business messaging on your behalf.</li>
<li>To improve our services and ensure security.</li>
<li>To comply with legal obligations.</li>
</ul>

<h2>3. WhatsApp Business Platform</h2>
<p>Whatsy integrates with the WhatsApp Business Platform (Meta Platforms, Inc.). By using our service, you agree to Meta's <a href="https://www.whatsapp.com/legal/business-policy/" target="_blank">WhatsApp Business Policy</a>. We do not sell WhatsApp message data to third parties.</p>

<h2>4. Data Retention</h2>
<p>Conversation data is retained for up to 6 months unless you request deletion earlier. Account data is retained until you close your account.</p>

<h2>5. Data Security</h2>
<p>We use industry-standard encryption (TLS in transit, AES-256 at rest) to protect your data. Access is restricted to authorized personnel only.</p>

<h2>6. Your Rights</h2>
<p>You have the right to access, correct, or delete your personal data at any time. Contact us at <a href="mailto:privacy@whatsy.io">privacy@whatsy.io</a>.</p>

<h2>7. Third-Party Services</h2>
<p>We use Supabase (database hosting) and Railway (cloud infrastructure). Each operates under their own privacy policies.</p>

<h2>8. Changes</h2>
<p>We may update this policy periodically. Continued use of the service after changes constitutes acceptance.</p>

<h2>9. Contact</h2>
<p>Email: <a href="mailto:privacy@whatsy.io">privacy@whatsy.io</a></p>
</body></html>`

const termsHTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Terms of Service — Whatsy</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:60px auto;padding:0 24px;line-height:1.7;color:#1a1a1a}h1{font-size:2rem;margin-bottom:4px}h2{margin-top:2rem;font-size:1.2rem}p,li{color:#333}a{color:#00a884}.updated{color:#888;font-size:.9rem;margin-bottom:2rem}</style>
</head>
<body>
<h1>Terms of Service</h1>
<p class="updated">Last updated: September 17, 2026</p>

<p>By using Whatsy, you agree to these Terms of Service. Please read them carefully.</p>

<h2>1. Use of Service</h2>
<p>Whatsy provides a WhatsApp Business messaging platform. You may use it only for lawful business communication purposes and in compliance with WhatsApp's Business Policy.</p>

<h2>2. Account Responsibility</h2>
<p>You are responsible for maintaining the security of your account credentials and for all activity under your account.</p>

<h2>3. Prohibited Use</h2>
<p>You must not use Whatsy to send spam, harass users, violate WhatsApp policies, or engage in any unlawful activity.</p>

<h2>4. WhatsApp Compliance</h2>
<p>All messaging must comply with <a href="https://www.whatsapp.com/legal/business-policy/" target="_blank">WhatsApp Business Policy</a> and applicable laws.</p>

<h2>5. Limitation of Liability</h2>
<p>Whatsy is provided "as is". We are not liable for indirect, incidental, or consequential damages arising from your use of the service.</p>

<h2>6. Termination</h2>
<p>We reserve the right to suspend or terminate accounts that violate these terms.</p>

<h2>7. Contact</h2>
<p>Email: <a href="mailto:hello@whatsy.io">hello@whatsy.io</a></p>
</body></html>`
