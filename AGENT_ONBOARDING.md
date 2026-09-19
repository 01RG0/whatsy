# Whatsy — Agent Onboarding (First 5 Minutes)

**Read this first.** Written for any fresh AI agent session (Claude Code, agy, Codex, Cursor, etc.) with zero prior context. After reading, you should know what the project is, how to run it, where things live, and what not to break.

---

## What This Project Is

**Whatsy** is a production **WhatsApp Shared Inbox** — a multi-agent team inbox for WhatsApp Business. Support agents log in, see inbound WhatsApp conversations, reply, assign conversations, and configure auto-reply rules. Built on the **Zernio API** as the WhatsApp Business API provider.

This repo has **two layers**:

| Layer | What it is | Where |
|---|---|---|
| **Live App** | Go backend + React frontend (the thing being built and deployed) | `whatsy-backend/`, `whatsy-frontend/` |
| **Knowledge Base** | 893 Zernio API docs + master reference (for AI context loading) | `docs/`, `CLAUDE_ZERNIO_API_MASTER.md`, `resources/` |

**Most docs at the root describe layer 2. The live app is in `whatsy-backend/` and `whatsy-frontend/`.**

---

## Tech Stack

### Backend (`whatsy-backend/`)
- **Language:** Go 1.24
- **Router:** go-chi/chi v5
- **DB:** PostgreSQL via Supabase cloud (eu-central-1), driver: lib/pq
- **Auth:** JWT (golang-jwt/jwt v5), bcrypt passwords
- **Real-time:** WebSockets (nhooyr.io/websocket), optional Redis pub/sub for multi-instance
- **External API:** Zernio API (`https://zernio.com/api/v1`) for all WhatsApp operations
- **Migrations:** Custom Go runner — reads `migrations/*.sql` on startup, applies in alphabetical order
- **Entry point:** `whatsy-backend/cmd/server/main.go`

### Frontend (`whatsy-frontend/`)
- **React 19** + TypeScript + **Vite 6** + **Tailwind CSS 3**
- **State:** Zustand 5
- **Routing:** Custom SPA routing via History API — no router library
- **Entry point:** `whatsy-frontend/src/main.tsx`
- **Pages:** `/` (inbox), `/students`, `/settings` (auto-reply), `/connection`, `/team`, `/login`

### Infrastructure
- **Deployment:** Railway (backend + frontend as separate services)
- **Docker:** `docker-compose.yml` for local full-stack, individual Dockerfiles per service

---

## Environment Variables

### Backend (`whatsy-backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string (Supabase) |
| `JWT_SECRET` | ✅ | JWT signing secret (`openssl rand -hex 32`) |
| `ZERNIO_API_KEY` | ✅ | `sk_` + 64 hex chars from zernio.com dashboard |
| `ZERNIO_WEBHOOK_SECRET` | optional | HMAC secret for webhook signature verification |
| `REDIS_URL` | optional | Enables multi-instance WebSocket pub/sub |
| `PORT` | optional | Default: `8080` |
| `FRONTEND_URL` / `FRONTEND_URL_2` | optional | Additional CORS origins |

### Frontend (`whatsy-frontend/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE` | optional | Backend URL — defaults to same origin |

---

## How to Run

### Local Dev (two terminals)

```bash
# Terminal 1 — Backend
cd whatsy-backend
cp .env.example .env     # fill in DATABASE_URL, JWT_SECRET, ZERNIO_API_KEY
go run ./cmd/server
# Server at http://localhost:8080

# Terminal 2 — Frontend
cd whatsy-frontend
npm install
npm run dev
# Vite dev server at http://localhost:5173
```

### Docker (full stack)

```bash
docker-compose up --build
# Backend at :8080, Frontend at :80
```

### Build Checks

```bash
# TypeScript
cd whatsy-frontend && npm run typecheck

# Go
cd whatsy-backend && go build ./...
```

> No test suite exists yet. `typecheck` and `go build` are the current validation gates.

---

## Key Files

### Backend

| File | Purpose |
|---|---|
| `cmd/server/main.go` | Entry point — router, middleware, all route registration, startup goroutines |
| `cmd/worker/main.go` | Background worker entry |
| `internal/config/config.go` | All env vars parsed here |
| `internal/handler/handler.go` | Core inbox handler: conversations, messages, webhook, WebSocket |
| `internal/handler/middleware.go` | `JWTMiddleware`, `RequireAdmin`, `RequireNotViewer` |
| `internal/service/chat_service.go` | Core logic: send message, handle inbound webhook, retry stuck messages |
| `internal/repository/conversation_repo.go` | DB queries for conversations |
| `internal/repository/message_repo.go` | DB queries for messages |
| `internal/domain/` | Domain structs: Conversation, Message, Student (contacts), Presence |
| `internal/zernio/client.go` | Zernio API HTTP client wrapper |
| `internal/websocket/hub.go` | WebSocket broadcast hub |
| `internal/websocket/events.go` | WS event type definitions |
| `migrations/*.sql` | Schema migrations (12 files) — authoritative source |

### Frontend

| File | Purpose |
|---|---|
| `src/App.tsx` | SPA router, auth guard, session invalidation handler, WebSocket mount |
| `src/api/inbox.ts` | All fetch calls to backend REST API |
| `src/lib/auth.ts` | JWT decode, `isAdmin()`, `isViewer()` role helpers |
| `src/store/useInboxStore.ts` | Zustand: conversation list, active conversation, messages, filters |
| `src/store/useWebSocket.ts` | WS connection lifecycle, event dispatch to store |
| `src/i18n/translations.ts` | All UI strings (AR + EN) — add new strings here |
| `src/components/WhatsAppInboxApp.tsx` | Main inbox layout — Sidebar + ChatWindow wiring |
| `src/components/types.ts` | Shared TypeScript types (Conversation, Message, Agent, etc.) |

---

## Conventions

### Backend
- Standard Go project layout (`cmd/`, `internal/`, `pkg/`).
- Handlers take db/repo/service deps via constructor injection. No global state.
- Each handler file maps to a feature domain (agent, auth, auto_reply, broadcast, etc.).

### Frontend
- No file-based routing. Pages are plain components switched in `AppContent()` in `src/App.tsx`. Add new pages there.
- All UI strings go through `useT()` from `src/i18n/translations.ts`. Add keys to both `ar` and `en` objects.

### Agent Roles
Three roles, enforced at both layers:

| Role | Access |
|---|---|
| `admin` | Full access — invite agents, manage settings, connection |
| `agent` | Read/write conversations, cannot manage team |
| `viewer` | Read-only |

- Backend: `handler.RequireAdmin` and `handler.RequireNotViewer` middleware in `main.go`
- Frontend: `isAdmin()` / `isViewer()` in `src/lib/auth.ts`, `adminRoutes` guard in `App.tsx`

### Migrations
Add new `.sql` files to `whatsy-backend/migrations/` with timestamp prefix: `YYYYMMDDHHMMSS_description.sql`. The Go runner applies them in alphabetical order on startup. Also add to `whatsy-backend/supabase/migrations/` if Supabase CLI compatibility is needed.

---

## Known Gotchas

1. **Two migration directories** — `whatsy-backend/migrations/` (12 files, authoritative, run by Go) and `whatsy-backend/supabase/migrations/` (6 files, Supabase CLI format, partial subset). Always add new migrations to both if using Supabase CLI push.

2. **"student" = contact** — `internal/domain/student.go` and `/v1/students` endpoints refer to WhatsApp contacts/customers, not academic students. Naming artifact from early version.

3. **Redis is optional** — if `REDIS_URL` is unset, WebSocket events only fan out within a single server instance. Set it for multi-instance deploys on Railway.

4. **Zernio webhook auto-disable** — Zernio auto-disables webhooks during server downtime. On startup, `zernioClient.EnsureWebhookActive()` re-enables them. If webhook events stop arriving, check the Zernio dashboard webhook status.

5. **CORS** — allowed origins are hardcoded in `main.go` plus `FRONTEND_URL` / `FRONTEND_URL_2` env vars. Add new frontend origins to the env vars, not the code.

6. **Stuck messages** — on startup, `chatService.RetryStuckMessages()` re-sends any outbound messages left in `pending` state from a killed deploy.

7. **Background sync** — runs at startup and every 10 minutes, calling Zernio API to heal missed webhook events and `+unknown-` phone number entries.

---

## Common Task Entry Points

### Add a new backend endpoint
1. Add handler function in `internal/handler/<feature>.go`
2. Register route in `cmd/server/main.go`
3. Add migration in `migrations/` if schema changes needed

### Add a new frontend page
1. Create `src/pages/NewPage.tsx`
2. Add case in `AppContent()` in `src/App.tsx`
3. Add nav link in `src/components/NavBar.tsx`
4. Add i18n strings to `src/i18n/translations.ts`

### Send a WhatsApp message via Zernio
See `internal/service/chat_service.go` → `SendMessage()`  
API: `POST /v1/inbox/conversations/{id}/messages` on Zernio  
Reference: `CLAUDE_ZERNIO_API_MASTER.md` (search "Send Message")

### Understand WebSocket event flow
- Backend emits: `internal/websocket/hub.go` → `Broadcast()`
- Events defined: `internal/websocket/events.go`
- Frontend receives: `src/store/useWebSocket.ts`

### Work with Zernio API
Load `CLAUDE_ZERNIO_API_MASTER.md` for the 727-operation reference with cURL/Python/Node.js snippets.  
Base URL: `https://zernio.com/api/v1`  
Auth: `Authorization: Bearer <ZERNIO_API_KEY>`

---

## Further Reading

| Doc | What it covers |
|---|---|
| `PROJECT_MAP.md` | Full architecture diagram + folder map |
| `DATA_FLOW.md` | Mermaid diagrams + end-to-end data flow walkthrough |
| `ROADMAP.md` | Unimplemented features backlog |
| `CLAUDE_ZERNIO_API_MASTER.md` | 727-operation Zernio API reference |
| `whatsy-backend/.env.example` | All env vars with descriptions |
| `CLAUDE.md` | Claude Code-specific project instructions |
