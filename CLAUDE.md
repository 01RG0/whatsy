# CLAUDE PROJECT INSTRUCTIONS & QUICK REFERENCE

Welcome to the **Whatsy** repository — the comprehensive Zernio API, WhatsApp UI & Shared Inbox development environment.

## Key Navigation Pointers
- **Master API Reference**: [`CLAUDE_ZERNIO_API_MASTER.md`](file:///D:/pRoG/whatsy/CLAUDE_ZERNIO_API_MASTER.md) (727 API operations, endpoints, parameters, schemas, and cURL / Python / Node.js code snippets).
- **Master File Map & Sitemap**: [`FILE_MAP.md`](file:///D:/pRoG/whatsy/FILE_MAP.md) (Every file and directory mapped with links).
- **Documentation Suite**: [`docs/`](file:///D:/pRoG/whatsy/docs/) (893 individual Markdown documentation files).
- **WhatsApp UI Components**: [`resources/whatsapp-ui-components/`](file:///D:/pRoG/whatsy/resources/whatsapp-ui-components/) (Production React 19 + Tailwind components).
- **WhatsApp Open-Source Repos & Architectures**:
  - UI & Shared Inbox: [`resources/WHATSAPP_UI_INBOX_REPOS_AND_CODE.md`](file:///D:/pRoG/whatsy/resources/WHATSAPP_UI_INBOX_REPOS_AND_CODE.md)
  - Bot Engines, Flow Builders & CRMs: [`resources/WHATSAPP_FUNCTIONS_AND_BOTS_REPOS.md`](file:///D:/pRoG/whatsy/resources/WHATSAPP_FUNCTIONS_AND_BOTS_REPOS.md)
- **Claude MCP Server & Skills**: [`resources/claude-skills-and-mcp/`](file:///D:/pRoG/whatsy/resources/claude-skills-and-mcp/)

## Core API Conventions (Zernio API)
- **Base URL**: `https://zernio.com/api/v1`
- **Auth**: `Authorization: Bearer sk_...` (67 characters: `sk_` + 64 hex chars).
- **ID Fields**: 24-character hexadecimal MongoDB ObjectIDs in `_id`.
- **SDKs**:
  - Node.js: `@zernio/node` -> `import Zernio from '@zernio/node'; const zernio = new Zernio();`
  - Python: `zernio-sdk` -> `from zernio import Zernio; client = Zernio()`
- **Key WhatsApp Endpoints**:
  - List Conversations: `GET /v1/inbox/conversations?platform=whatsapp`
  - Send Text/Media Message: `POST /v1/inbox/conversations/{id}/messages`
  - Send Approved Template: `POST /v1/whatsapp/broadcasts` or `/v1/whatsapp/messages`
  - Mark Conversation as Read: `POST /v1/inbox/conversations/{id}/read`
  - Typing Indicator: `POST /v1/inbox/conversations/{id}/typing`
