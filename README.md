# Whatsy - Zernio API & WhatsApp UI / Inbox Knowledge Base

A comprehensive, organized knowledge base and developer kit for the **Zernio API** (Social Media API across 16+ platforms) and **WhatsApp Web / Shared Inbox UI**. Specially structured for **Claude**, LLMs, and modern developers.

---

## Directory Overview

```
D:\pRoG\whatsy\
├── docs/                                  # 893 clean Markdown files extracted from Zernio docs
│   ├── overview/                          # Quickstart, Auth, Multi-tenancy, Billing, Limits, Webhooks
│   ├── platforms/                         # 16+ Platforms: X/Twitter, WhatsApp, Instagram, TikTok, etc.
│   ├── api-reference/                     # 742 REST endpoint docs: posts, accounts, inbox, media, etc.
│   ├── integrations/                      # n8n, Make, Zapier, OpenClaw, Chat SDK, migrations
│   └── sdks/                              # Node.js, Python, Go, Ruby, Java, PHP, .NET, Rust
│
├── resources/
│   ├── WHATSAPP_UI_INBOX_REPOS_AND_CODE.md # Curated GitHub repos, architecture blueprint & API mapping
│   └── whatsapp-ui-components/            # Production-ready React/TypeScript/Tailwind components
│       ├── types.ts                       # Complete TypeScript data contracts mapping Zernio API models
│       ├── Sidebar.tsx                    # Search, filter pills, conversation list, unread counters
│       ├── ChatWindow.tsx                 # Header with status/actions, message stream, date separators
│       ├── MessageBubble.tsx              # Text, images, audio/voice notes, templates, delivery ticks
│       ├── ChatInput.tsx                  # Attachment menu, voice recording, emojis, reply preview
│       └── WhatsAppInboxApp.tsx           # Full demo application wiring sidebar and chat window
│
├── CLAUDE_ZERNIO_API_MASTER.md            # 2.46MB master reference cataloging 727 API operations
├── openapi.yaml                           # Official Zernio OpenAPI 3.x specification
├── llms.txt                               # Official documentation page index
├── llms-full.txt                          # Raw uncompressed documentation dump
├── organize_docs.py                       # Automated documentation extraction & cleanup pipeline
└── generate_api_master.py                 # Automated OpenAPI-to-Markdown master reference generator
```

---

## Key Highlights

### 1. Zernio API Master Reference (`CLAUDE_ZERNIO_API_MASTER.md`)
- **727 API Operations** across 487 endpoints.
- Ready-to-use code snippets for each endpoint in **cURL**, **Python SDK**, and **Node.js SDK**.
- Complete path parameters, query parameters, request bodies, and response schemas.
- Cleanly divided into:
  1. Authentication & API Keys
  2. Profiles & Multi-tenant Management
  3. Accounts & Platform Connections
  4. Posts (Publishing, Scheduling, Threads, Polls)
  5. Media & Presigned Uploads
  6. Inbox & Direct Messaging
  7. Webhooks & Signatures
  8. Analytics & Metrics
  9. Voice & Calling
  10. WhatsApp Management (Templates, Broadcasts, Flows)
  11. Billing & Usage

### 2. WhatsApp UI & Inbox Blueprint (`resources/WHATSAPP_UI_INBOX_REPOS_AND_CODE.md`)
- Curated top open-source GitHub repositories:
  - **WhatsApp Web UI Clones**: `SoorajSNBlaze333/whatsapp-react-clone`, `Ctmax-ui/whatsapp-web-clone`, `IslemMedjahdi/whatsapp-v2-clone`
  - **Shared Team Inbox / Omnichannel**: `chatwoot/chatwoot`, `EvolutionAPI/evolution-api`, `devlikeapro/waha`, `WhiskeySockets/Baileys`, `typebot.io`
  - **Modern Chat UI Components**: `assistant-ui/assistant-ui`, `shadcn-chat`
- Complete architectural blueprint for connecting React/Next.js to Zernio API:
  - Fetching conversations: `GET /v1/inbox/conversations`
  - Sending messages & templates: `POST /v1/inbox/conversations/{id}/messages`
  - Marking as read: `POST /v1/inbox/conversations/{id}/read`
  - Real-time synchronization via webhooks (`inbox.message.received`, `inbox.message.status_updated`)
  - Zustand state store implementation.

### 3. Production React/Tailwind Components (`resources/whatsapp-ui-components/`)
- Drop-in ready for Next.js (App Router or Pages Router) or Vite + React.
- Native WhatsApp dark/light theme styling with Tailwind CSS.
- Inbound and outbound message bubble styling, voice note UI, interactive button templates, and delivery checkmarks (single gray, double gray, double blue, error).
