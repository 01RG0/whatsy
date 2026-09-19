# CLAUDE PROJECT INSTRUCTIONS & QUICK REFERENCE

Welcome to the **Whatsy** repository — the comprehensive Zernio API, WhatsApp UI & Shared Inbox development environment.

## Key Navigation Pointers
- **Agent Onboarding**: [`AGENT_ONBOARDING.md`](file:///D:/pRoG/whatsy/AGENT_ONBOARDING.md) — first 5 minutes for any AI agent session: what this project is, how to run it, where things live, conventions, gotchas.
- **Master API Reference**: [`CLAUDE_ZERNIO_API_MASTER.md`](file:///D:/pRoG/whatsy/CLAUDE_ZERNIO_API_MASTER.md) (727 API operations, endpoints, parameters, schemas, and cURL / Python / Node.js code snippets).
- **Master File Map & Sitemap**: [`FILE_MAP.md`](file:///D:/pRoG/whatsy/FILE_MAP.md) (Every file and directory mapped with links).
- **Documentation Suite**: [`docs/`](file:///D:/pRoG/whatsy/docs/) (893 individual Markdown documentation files).
- **WhatsApp UI Components**: [`resources/whatsapp-ui-components/`](file:///D:/pRoG/whatsy/resources/whatsapp-ui-components/) (Production React 19 + Tailwind components).
- **WhatsApp Open-Source Repos & Architectures**:
  - UI & Shared Inbox: [`resources/WHATSAPP_UI_INBOX_REPOS_AND_CODE.md`](file:///D:/pRoG/whatsy/resources/WHATSAPP_UI_INBOX_REPOS_AND_CODE.md)
  - Bot Engines, Flow Builders & CRMs: [`resources/WHATSAPP_FUNCTIONS_AND_BOTS_REPOS.md`](file:///D:/pRoG/whatsy/resources/WHATSAPP_FUNCTIONS_AND_BOTS_REPOS.md)
- **Claude MCP Server & Skills**: [`resources/claude-skills-and-mcp/`](file:///D:/pRoG/whatsy/resources/claude-skills-and-mcp/)

## Sub-Agent CLI Tool Paths (this machine)

When invoking CLI agents directly (not through dispatch.py), use these absolute paths:

| CLI | Binary | How to invoke |
|---|---|---|
| **agy** (Antigravity/Gemini) | `D:\pRoG\Archives\coder\agy.exe` | `agy -p "prompt"` or `agy --print --mode=accept-edits "prompt"` |
| **Cursor** | via `C:\Users\ahmed\AppData\Roaming\Cursor\` (not in PATH) | `cursor --headless "prompt"` — verify with `cursor --help` first |
| **freebuff** | in PATH | `freebuff "prompt"` |
| **kilo** | in PATH | `kilo run --auto "prompt"` |
| **codex** | in PATH | `codex exec --sandbox workspace-write "prompt"` |
| **jules** | in PATH | `jules run --dir <path> "prompt"` |

**dispatch.py note:** Always run from `D:\pRoG\whatsy\` so it loads the local `.env` first. If a CLI shows as "not installed" inside dispatch.py but works in the terminal, the subprocess lost PATH — invoke it directly via Bash instead.

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
