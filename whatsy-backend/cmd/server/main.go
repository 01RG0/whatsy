package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
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

	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		log.Fatalf("ping database: %v", err)
	}

	r := chi.NewRouter()
	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	presenceMgr := presence.NewManager()
	hub := websocket.NewHub()
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

	r.Post("/api/webhooks/zernio", h.HandleWebhook)
	r.Post("/v1/auth/register", authHandler.Register)
	r.Post("/v1/auth/login", authHandler.Login)
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

	log.Printf("server listening on :%s", cfg.Port)
	log.Fatal(http.ListenAndServe(":"+cfg.Port, r))
}
