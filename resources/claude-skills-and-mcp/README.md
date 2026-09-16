# Claude Skills, MCP Server & Setup Guide for Zernio & WhatsApp

This directory contains a complete toolkit for integrating **Claude (Claude Desktop, Claude Code, and Claude Projects)** with **Zernio** and the **WhatsApp Business Platform**.

---

## 📁 Directory Structure

- `claude_desktop_config.json`: Ready-to-use configuration for Claude Desktop or Claude Code.
- `zernio-mcp-server.ts`: Lightweight, standalone Model Context Protocol (MCP) server written in TypeScript using `@modelcontextprotocol/sdk`.
- `claude-skills/`:
  - `whatsapp-flow-designer.md`: Custom skill prompt for creating compliant WhatsApp Flows (v3.0+ schema, screens, components, routing).
  - `template-compliance-validator.md`: Pre-submission validation skill ensuring WhatsApp message templates meet Meta's strict category and syntax guidelines.
  - `webhook-handler-recipe.md`: Step-by-step engineering recipe for verifying HMAC signatures, processing incoming messages, delivery receipts, and Flow payloads.

---

## ⚡ 1. Setting Up the MCP Server

The MCP server connects Claude directly to your Zernio workspace, enabling Claude to execute actions via standard function calling.

### Available Tools:
1. `send_whatsapp_message`: Send direct text or media (image/document/audio) messages to customers.
2. `send_whatsapp_template`: Send Meta-approved notification templates with dynamic parameters.
3. `list_inbox_conversations`: Fetch active inbox threads across WhatsApp and connected channels.
4. `get_post_analytics`: Inspect performance metrics, reach, and interaction statistics.
5. `create_social_post`: Cross-post or schedule updates across social channels and WhatsApp broadcast/channels.

### Prerequisites:
- Node.js 18+ installed.
- Valid Zernio API Key.

---

## 💻 2. Configuring Claude Desktop

1. Open your Claude Desktop configuration file:
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
     (`C:\Users\<YourUsername>\AppData\Roaming\Claude\claude_desktop_config.json`)
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

2. Merge the configuration from `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "zernio": {
         "command": "npx",
         "args": [
           "-y",
           "tsx",
           "D:\\pRoG\\whatsy\\resources\\claude-skills-and-mcp\\zernio-mcp-server.ts"
         ],
         "env": {
           "ZERNIO_API_KEY": "YOUR_ACTUAL_ZERNIO_API_KEY",
           "ZERNIO_BASE_URL": "https://api.zernio.com/v1"
         }
       }
     }
   }
   ```
   *(Note: Ensure backslashes are escaped `\\` on Windows paths).*

3. Restart Claude Desktop. You will see the **hammer icon 🔨** in the bottom right corner showing the available Zernio tools.

---

## 💻 3. Using with Claude Code (CLI)

If you are using Anthropic's `claude` CLI:
```bash
claude mcp add zernio -- npx -y tsx D:\pRoG\whatsy\resources\claude-skills-and-mcp\zernio-mcp-server.ts
```
Set your environment variable:
```bash
# Windows PowerShell
$env:ZERNIO_API_KEY="your_api_key_here"

# Windows Command Prompt
set ZERNIO_API_KEY=your_api_key_here
```

---

## 🧠 4. Using Claude Skills in Claude Projects or System Prompts

You can import the skills in `claude-skills/` into your Claude Projects (Custom Instructions) or paste them into active chats:

| Skill | Use Case |
| :--- | :--- |
| **`whatsapp-flow-designer.md`** | Ask Claude: *"Design a multi-screen appointment booking WhatsApp Flow for a dental clinic with doctor selection and date picker."* |
| **`template-compliance-validator.md`** | Ask Claude: *"Review this shipping update template before I submit it to Meta: 'Hey {{1}}, your order {{2}} is on the way. Use code 10OFF for your next order.' "* (Claude will catch the promotional leak and fix the category). |
| **`webhook-handler-recipe.md`** | Ask Claude: *"Write an Express route that verifies Zernio HMAC-SHA256 signatures and handles flow.completed responses."* |

---

## 🔒 Security Best Practices
- Never commit your live `ZERNIO_API_KEY` into Git repositories.
- Always use the signature verification recipe provided in `webhook-handler-recipe.md` for production endpoints.
- Ensure recipient phone numbers are in full international E.164 format (e.g., `+14155552671`).
