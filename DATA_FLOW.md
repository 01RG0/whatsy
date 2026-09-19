# Whatsy — Data Flow

End-to-end data flow for the Whatsy WhatsApp Shared Inbox. Covers all major paths: inbound messages, outbound replies, auth, media, sync, and presence.

---

## 1. Inbound Message (Critical Path)

A WhatsApp user sends a message → agents see it in real time.

```mermaid
sequenceDiagram
    participant WA as WhatsApp User
    participant Z as Zernio API
    participant WH as Whatsy Backend<br/>/api/webhooks/zernio
    participant DB as PostgreSQL
    participant AR as Auto-Reply Service
    participant HUB as WebSocket Hub
    participant REDIS as Redis (optional)
    participant B1 as Browser (Agent 1)
    participant B2 as Browser (Agent 2)

    WA->>Z: sends WhatsApp message
    Z->>WH: POST /api/webhooks/zernio<br/>{event: inbox.message.received, ...}
    WH->>WH: Verify HMAC signature<br/>(ZERNIO_WEBHOOK_SECRET)
    WH->>DB: UPSERT conversation<br/>(by zernio_conversation_id)
    WH->>DB: INSERT message<br/>(direction=inbound, status=delivered)
    WH->>AR: AutoReplyService.Match(message.text)
    alt rule matches
        AR->>Z: POST /v1/inbox/conversations/{id}/messages
        Z->>WA: auto-reply sent
        AR->>DB: INSERT auto-reply message (direction=outbound)
    end
    WH->>HUB: hub.Broadcast(new_message event)
    alt Redis configured
        HUB->>REDIS: publish event
        REDIS->>HUB: fan-out to other instances
    end
    HUB->>B1: WebSocket: new_message
    HUB->>B2: WebSocket: new_message
    B1->>B1: useWebSocket → useInboxStore.addMessage()<br/>unread count +1, conversation bubbles to top
    B2->>B2: same
```

### Code path
1. `POST /api/webhooks/zernio` → `internal/handler/handler.go:HandleWebhook()`
2. → `internal/zernio/webhook.go:Verify()` (HMAC check)
3. → `internal/service/chat_service.go:HandleInbound()`
4. → `internal/repository/conversation_repo.go:Upsert()`
5. → `internal/repository/message_repo.go:Insert()`
6. → `internal/service/auto_reply.go:Match()`
7. → `internal/websocket/hub.go:Broadcast()`
8. → `whatsy-frontend/src/store/useWebSocket.ts` (event handler)
9. → `whatsy-frontend/src/store/useInboxStore.ts` (state update)

---

## 2. Agent Sends a Reply (Outbound Path)

```mermaid
sequenceDiagram
    participant B as Browser (Agent)
    participant API as Whatsy Backend
    participant DB as PostgreSQL
    participant Z as Zernio API
    participant WA as WhatsApp User
    participant HUB as WebSocket Hub

    B->>API: POST /v1/inbox/conversations/{id}/messages<br/>{type: "text", text: "Hello!"}
    API->>API: JWTMiddleware → RequireNotViewer
    API->>DB: INSERT message<br/>(status=pending, sent_by_agent=true, direction=outbound)
    API->>Z: POST /v1/inbox/conversations/{zernio_id}/messages
    Z->>WA: delivers WhatsApp message
    Z-->>API: 200 {messageId: "wamid..."}
    API->>DB: UPDATE message SET status=sent, zernio_message_id=wamid
    API->>HUB: hub.Broadcast(new_message event)
    HUB->>B: WebSocket: new_message (confirms delivery to UI)
    Note over B: Message tick updates: → ✓ → ✓✓ → ✓✓(blue)<br/>via subsequent status_updated webhook events
```

### Code path
1. `POST /v1/inbox/conversations/{id}/messages` → `handler.go:SendMessage()`
2. → `internal/service/chat_service.go:SendMessage()`
3. → `internal/repository/message_repo.go:Insert()` (status=pending)
4. → `internal/zernio/client.go:SendMessage()`
5. On success → `message_repo.Update()` (status=sent)
6. → `websocket/hub.go:Broadcast()`

### Stuck message recovery
On server startup, `chatService.RetryStuckMessages()` finds any messages in `pending` state older than 60s and retries the Zernio API call. This handles messages stuck by a killed deploy.

---

## 3. Agent Login

```mermaid
sequenceDiagram
    participant B as Browser
    participant API as Whatsy Backend
    participant DB as PostgreSQL

    B->>API: POST /v1/auth/login {email, password}
    API->>DB: SELECT agent WHERE email=...
    API->>API: bcrypt.Compare(password, hash)
    API-->>B: {token: "eyJ..."} (JWT, 30-day expiry)
    B->>B: localStorage.setItem('whatsy_jwt', token)
    Note over B: All subsequent requests:<br/>Authorization: Bearer <token>
```

**Session invalidation:** The `agents` table has a `session_version` column. When an agent logs in from a new device, their `session_version` increments. The JWT middleware checks the version on every request — an old token with a stale version returns `{"error": "session_invalidated"}`, triggering the frontend's `whatsy:session_invalidated` event and redirecting to `/login`.

---

## 4. Load Inbox (Conversations List)

```mermaid
sequenceDiagram
    participant B as Browser
    participant API as Whatsy Backend
    participant DB as PostgreSQL

    B->>API: GET /v1/inbox/conversations<br/>?page=1&assigned=me&unread=true
    API->>API: JWTMiddleware (decode JWT, attach agent to context)
    API->>DB: SELECT conversations + last message + unread count<br/>(filtered by query params)
    API-->>B: [{id, contactName, lastMessage, unreadCount, ...}]
    B->>B: useInboxStore.setConversations()<br/>Sidebar renders conversation list
```

---

## 5. Real-Time Presence (Typing Indicators)

```mermaid
sequenceDiagram
    participant B1 as Browser (Agent 1, typing)
    participant WS as WebSocket Hub
    participant PM as Presence Manager
    participant B2 as Browser (Agent 2, watching)

    B1->>WS: WS message: {type: "typing", conversationId: "..."}
    WS->>PM: presence.Manager.SetTyping(agentId, convId)
    PM->>WS: broadcast typing event to conv room
    WS->>B2: {type: "typing", agentName: "Sara", conversationId: "..."}
    B2->>B2: ChatWindow shows "Sara is typing..."
    Note over B1,PM: Typing state auto-expires after 5s of no updates
```

---

## 6. Media Flow

### Outbound (agent sends image/file)
```
Browser → POST /v1/whatsapp/upload (multipart)
→ uploadHandler proxies to Zernio media upload API
→ Zernio returns mediaId
→ Browser sends message with {type: "image", mediaId: "..."}
→ Standard outbound message flow (section 2)
```

### Inbound (agent views image received from contact)
```
Browser needs to display image from Zernio CDN
→ GET /v1/whatsapp/media/{mediaId}   (avoids CORS, keeps ZERNIO_API_KEY server-side)
→ mediaHandler proxies request to Zernio with API key
→ streams bytes back to browser
```

---

## 7. Background Sync

Runs at startup and every 10 minutes. Heals missed webhook events and `+unknown-` phone entries.

```
syncHandler.SyncSince(ctx, since)
→ GET https://zernio.com/api/v1/inbox/conversations?platform=whatsapp&updatedSince=<timestamp>
→ For each conversation: UPSERT in DB (conversation + contact phone/name)
→ Log: "N conversations upserted"
```

Startup sync covers the last 30 days. Incremental syncs use `lastSync` timestamp.

---

## 8. Message Delivery Status Updates

```
Zernio fires: POST /api/webhooks/zernio {event: inbox.message.status_updated}
→ handler.HandleWebhook()
→ message_repo.UpdateStatus(zernio_message_id, status)
→ hub.Broadcast(message_status event)
→ Browser: MessageBubble updates tick (✓ sent → ✓✓ delivered → ✓✓ blue = read)
```

---

## Database Relationships

```mermaid
erDiagram
    agents {
        uuid id PK
        text email
        text role
        int session_version
    }
    conversations {
        uuid id PK
        text zernio_conversation_id
        text contact_phone
        uuid assigned_agent_id FK
        bool is_read
        bool is_marked_unread
        timestamptz last_message_at
    }
    messages {
        uuid id PK
        uuid conversation_id FK
        text zernio_message_id
        text direction
        text type
        text content
        text status
        bool sent_by_agent
        timestamptz created_at
    }
    students {
        uuid id PK
        text phone
        text name
        text email
    }
    auto_reply_rules {
        uuid id PK
        text trigger_keyword
        text response_text
        text match_type
        bool is_active
    }
    whatsapp_connections {
        uuid id PK
        text account_id
        text status
    }

    agents ||--o{ conversations : "assigned to"
    conversations ||--o{ messages : "contains"
```

---

## Environment Variables & Secrets

| Variable | Used in | Purpose |
|---|---|---|
| `DATABASE_URL` | All DB operations | Supabase PostgreSQL connection |
| `JWT_SECRET` | `pkg/utils/jwt.go` | Sign + verify agent session tokens |
| `ZERNIO_API_KEY` | `internal/zernio/client.go` | All outbound Zernio API calls |
| `ZERNIO_WEBHOOK_SECRET` | `internal/zernio/webhook.go` | HMAC-SHA256 webhook signature verification |
| `REDIS_URL` | `internal/redispub/pubsub.go` | Multi-instance WebSocket fan-out (optional) |
| `PORT` | `cmd/server/main.go` | HTTP server port (default 8080) |
| `FRONTEND_URL` / `FRONTEND_URL_2` | `cmd/server/main.go` | Additional CORS origins |

**Secret storage:** All secrets are in `whatsy-backend/.env` (gitignored). In production, set as Railway environment variables. Never commit secrets — `.env.example` has documented placeholders only.

---

## WebSocket Event Types

Defined in `internal/websocket/events.go`:

| Event type | Direction | Payload | Triggers |
|---|---|---|---|
| `new_message` | server → browser | message object | New inbound or outbound message |
| `message_status` | server → browser | `{messageId, status}` | Delivery status update |
| `typing` | server → browser | `{agentName, conversationId}` | Agent typing indicator |
| `presence` | server → browser | `{agentId, status}` | Agent online/offline |
| `conversation_assigned` | server → browser | `{conversationId, agentId}` | Conversation reassigned |
| `conversation_read` | server → browser | `{conversationId}` | Marked as read |
