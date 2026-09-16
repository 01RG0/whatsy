package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
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
	"github.com/whatsy/backend/internal/repository"
	"github.com/whatsy/backend/internal/service"
	"github.com/whatsy/backend/internal/websocket"
	"github.com/whatsy/backend/internal/zernio"
)

func main() {
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
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		log.Fatalf("ping database: %v", err)
	}

	if err := runMigrations(db); err != nil {
		log.Fatalf("migrations: %v", err)
	}

	r := chi.NewRouter()
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:5173", "http://localhost:3000"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
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

	presenceMgr := presence.NewManager()
	hub := websocket.NewHub(presenceMgr)
	go hub.Run()

	convRepo := repository.NewConversationRepo(db)
	msgRepo := repository.NewMessageRepo(db)
	chatService := service.NewChatService(db, convRepo, msgRepo, zernio.NewClient(cfg.ZernioAPIKey), hub)
	h := handler.New(db, convRepo, msgRepo, chatService, hub, presenceMgr, &cfg)
	cannedResponseHandler := handler.NewCannedResponseHandler(db)
	agentHandler := handler.NewAgentHandler(db)
	mediaHandler := handler.NewMediaHandler(cfg.ZernioAPIKey)
	uploadHandler := handler.NewUploadHandler(cfg.ZernioAPIKey)
	authHandler := handler.NewAuthHandler(db, cfg.JWTSecret)
	studentHandler := handler.NewStudentHandler(db)
	autoReplyHandler := handler.NewAutoReplyHandler(db)
	templateHandler := handler.NewTemplateHandler(cfg.ZernioAPIKey)
	broadcastHandler := handler.NewBroadcastHandler(cfg.ZernioAPIKey, db)

	authLimiter := handler.NewRateLimiter(10) // 10 req/min per IP on auth endpoints

	r.Post("/api/webhooks/zernio", h.HandleWebhook)

	r.With(authLimiter.Middleware).Post("/v1/auth/register", authHandler.Register)
	r.With(authLimiter.Middleware).Post("/v1/auth/login", authHandler.Login)

	r.Group(func(r chi.Router) {
		r.Use(handler.JWTMiddleware(cfg.JWTSecret))
		r.Get("/v1/whatsapp/media/{mediaId}", mediaHandler.Get)
		r.Post("/v1/whatsapp/upload", uploadHandler.Upload)
		r.Get("/v1/agents", agentHandler.List)
		r.Get("/v1/agents/me", agentHandler.Me)
		r.Patch("/v1/agents/me", agentHandler.UpdateMe)
		r.Get("/v1/agents/{id}", agentHandler.Get)
		r.Get("/v1/inbox/conversations", h.ListConversations)
		r.Get("/v1/inbox/search", h.SearchMessages)
		r.Get("/v1/inbox/conversations/{id}/messages", h.GetMessages)
		r.Post("/v1/inbox/conversations/{id}/messages", h.SendMessage)
		r.Post("/v1/inbox/conversations/{id}/read", h.MarkRead)
		r.Post("/v1/inbox/conversations/{id}/assign", h.AssignConversation)
		r.Get("/v1/canned-responses", cannedResponseHandler.List)
		r.Get("/v1/canned-responses/search", cannedResponseHandler.Search)
		r.Post("/v1/canned-responses", cannedResponseHandler.Create)
		r.Get("/v1/students", studentHandler.List)
		r.Post("/v1/students", studentHandler.Create)
		r.Get("/v1/students/{id}", studentHandler.GetByID)
		r.Patch("/v1/students/{id}", studentHandler.Update)
		r.Delete("/v1/students/{id}", studentHandler.Delete)
		r.Get("/v1/auto-reply-rules", autoReplyHandler.List)
		r.Post("/v1/auto-reply-rules", autoReplyHandler.Create)
		r.Patch("/v1/auto-reply-rules/{id}", autoReplyHandler.Update)
		r.Delete("/v1/auto-reply-rules/{id}", autoReplyHandler.Delete)
		r.Get("/ws", h.ServeWebSocket)
		r.Get("/v1/whatsapp/templates", templateHandler.ListTemplates)
		r.Post("/v1/whatsapp/templates", templateHandler.CreateTemplate)
		r.Post("/v1/whatsapp/broadcasts", broadcastHandler.SendBroadcast)
	})

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
			return fmt.Errorf("apply %s: %w", version, execErr)
		}
		if _, insErr := db.Exec("INSERT INTO schema_migrations(version) VALUES($1)", version); insErr != nil {
			return fmt.Errorf("record %s: %w", version, insErr)
		}
		log.Printf("migration applied: %s", version)
	}
	return nil
}
