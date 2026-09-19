# Whatsy Product Status & Roadmap

## Done

Features already implemented and running in the live application:

- **Shared Inbox**: WhatsApp conversations management with message threading.
- **Agent Assignment**: Assigning conversations to specific team members.
- **Unread Tracking**: Unread message badges and state management.
- **Canned Responses**: Pre-saved quick response templates for agents.
- **Auto-Reply Rules**: Keyword-based automated replies.
- **WhatsApp Connection Management**: QR code pairing and webhook lifecycle handling.
- **Template Listing**: Viewing available WhatsApp message templates.
- **Broadcast Send**: Immediate broadcast messaging to contacts.
- **Contact Management**: Dedicated students / contacts directory page.
- **Team Management**: Multi-user workspace with invite functionality.
- **Dark Mode**: Dark theme UI support.
- **Internationalization (i18n)**: Arabic (AR) and English (EN) localization with RTL support.
- **Real-Time WebSocket Updates**: Live incoming messages and status synchronization.
- **Typing Indicators**: Real-time typing status display.
- **Media Send / Receive**: Sending and receiving images, documents, and media attachments.
- **Voice Note Playback**: Audio playback for recorded WhatsApp voice notes.

---

## In Progress

*(No active tasks currently tracked)*

---

## Backlog

Remaining features and enhancements from the Zernio API audit, organized by priority:

### Priority 1 — Chat Enhancements

- **Reply-to (Quote Replies)**: Send `replyTo` field with the platform message ID (`wamid`) to quote a specific message. WhatsApp renders it as a quoted reply bubble. Supported on `POST /v1/inbox/conversations/{id}/messages`.
- **Interactive Messages**:
  - **Reply buttons**: Up to 3 buttons (`buttons` field).
  - **Quick replies**: Up to 13 options (`quickReplies` field).
  - **List messages**: Scrollable sections with rows (`interactive.type: "list"`).
  - **CTA URL button**: `interactive.type: "cta_url"`.
  - **Location request**: `interactive.type: "location_request_message"`.
- **Location Sharing**: Send pins via `location` field (latitude, longitude, name, address) and receive contact locations via `message.received` webhook.
- **Contact Cards**: Send vCard-style contact cards via the `contacts` array field on outgoing messages.

---

### Priority 2 — Engagement & Tracking

- **Inbox Analytics Dashboard**:
  - Volume over time.
  - Heatmap (day × hour).
  - Source breakdown (human, workflow, broadcast, API, etc.).
  - Response-time statistics.
  - Top accounts.
  - Conversation analytics (list + detail).
  - Filterable by `profileId`, `platform`, `accountId`, and `source`.
- **WhatsApp Flows (Forms & Surveys)**: Interactive form-based experiences sent as messages across categories (sign-up, booking, lead gen, support, survey). Supports `navigate` (Zernio-hosted) and `data_exchange` (dynamic) modes with `nfm_reply` webhook handling.
- **Broadcast Scheduling**: Schedule broadcasts ahead of time (`POST /v1/broadcasts/{id}/schedule` with `scheduledAt` ISO 8601 timestamp).
- **Webhook Log Redelivery**: Replay failed webhook events (`POST /v1/webhooks/logs/redeliver`) to catch up on missed messages.

---

### Priority 3 — Automation, CRM & Advanced WhatsApp

- **Workflow Automation Engine**: Visual 16-node automation pipeline (`trigger`, `send_message`, `condition`, `delay`, `wait_for_reply`, `a_b_split`, `set_variable`, `set_field`, `add_tag`, `remove_tag`, `enroll_sequence`, `webhook`, `ai`, `handoff`, `start_call`) with `{{variable}}` interpolation to replace or extend keyword rules.
- **Sequences (Drip Campaigns)**: Time-based linear follow-up campaigns to enroll contacts after conversations for onboarding and reminders.
- **Comment-to-DM Automation**: Auto-DM users commenting on posts with keyword matching, typo tolerance, delays, A/B variations, and link tracking.
- **Contact Custom Fields**: Dynamic custom field schemas (`/v1/custom-fields`) and per-contact field values (`/v1/contacts/{id}/fields/{slug}`).
- **Contact Tags & Subscriptions**: Full tagging for contact segmentation, plus `isSubscribed` broadcast opt-out management.
- **WhatsApp Calling**: Inbound/outbound voice call initiation, call history, recording access, and per-minute cost estimation.
- **WhatsApp Groups**: Group creation, participant management, invite links, and join requests.
- **Meta Business Agent (AI)**: Knowledge base FAQs/crawling, custom UI skills, MCP tool connectors, and automated evaluations.
- **Direct Send (Utility)**: Business-initiated messaging outside 24h window using `category: "utility"` without pre-approved template where eligible.
- **Technical Improvements**:
  - **Scoped API Keys**: `zrk_` profile-scoped keys for multi-tenant isolation.
  - **Content-Hash Dedup**: Graceful handling of HTTP 409 duplicates within 24 hours.
  - **Rate Limit Headers**: Active monitoring of `X-RateLimit-Remaining` and `X-RateLimit-Reset`.
  - **WhatsApp Number Health**: Health checks (`/v1/whatsapp/number-info`) reporting quality rating, tier, and throughput in admin view.
