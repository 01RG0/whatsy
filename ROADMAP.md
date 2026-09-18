# Whatsy Roadmap — Features to Add Later

Based on a full audit of the Zernio API documentation (727 endpoints). These features are available via the API but not yet implemented in Whatsy.

## Priority 1 — Chat Enhancements

### Reply-to (Quote Replies)
Send `replyTo` field with the platform message ID (wamid) to quote a specific message. WhatsApp shows it as a quoted reply bubble. The API field is already supported on `POST /v1/inbox/conversations/{id}/messages`.

### Interactive Messages
- **Reply buttons** — up to 3 buttons (`buttons` field)
- **Quick replies** — up to 13 options (`quickReplies` field)
- **List messages** — scrollable sections with rows (`interactive.type: "list"`)
- **CTA URL button** — `interactive.type: "cta_url"`
- **Location request** — `interactive.type: "location_request_message"`

### Location Sharing
Send a pin via `location` field (latitude, longitude, name, address). Receive locations from contacts via `message.received` webhook.

### Contact Cards
Send vCard-style contact cards via the `contacts` array field on send message.

---

## Priority 2 — Engagement & Tracking

### Inbox Analytics Dashboard
7 API endpoints available:
- Volume over time
- Heatmap (day × hour)
- Source breakdown (human, workflow, broadcast, API, etc.)
- Response-time stats
- Top accounts
- Conversation analytics (list + detail)

Filterable by `profileId`, `platform`, `accountId`, `source`.

### WhatsApp Flows (Forms & Surveys)
14 API endpoints. Create interactive form-based experiences sent as messages:
- Categories: sign up, booking, lead gen, support, survey
- Two modes: `navigate` (Zernio-hosted) and `data_exchange` (self-hosted dynamic)
- Submissions arrive via `message.received` as `nfm_reply`

### Broadcast Scheduling
`POST /v1/broadcasts/{id}/schedule` with `scheduledAt` (ISO 8601). Currently only immediate send is implemented.

### Webhook Log Redelivery
`POST /v1/webhooks/logs/redeliver` — replay failed webhook events. Could build a "catch up missed messages" admin button.

---

## Priority 3 — Automation

### Workflow Automation Engine
16 node types available:
- `trigger` (inbound_message, api_call, whatsapp_event)
- `send_message`, `condition`, `delay`, `wait_for_reply`
- `a_b_split`, `set_variable`, `set_field`
- `add_tag`, `remove_tag`, `enroll_sequence`
- `webhook` (external API calls)
- `ai` (LLM integration)
- `handoff` (transfer to human agent)
- `start_call` (WhatsApp voice)

Data interpolation with `{{variable}}` syntax. Would replace/extend the current keyword-based auto-reply.

### Sequences (Drip Campaigns)
Time-based linear follow-up campaigns. Enroll contacts after conversations. Good for onboarding flows, follow-ups, reminders.

### Comment-to-DM Automation
Auto-DM users who comment specific keywords on posts. Includes keyword matching (contains/exact/regex), typo tolerance, delay settings, A/B variations, link tracking.

---

## Priority 4 — CRM & Contacts

### Contact Custom Fields
- `GET/POST/DELETE/PATCH /v1/custom-fields` — define custom field schemas
- `PUT/DELETE /v1/contacts/{id}/fields/{slug}` — set values per contact
- Could extend the students table with dynamic fields

### Contact Tags
Full tag management on contacts for segmentation and filtering.

### Contact Subscriptions
`isSubscribed` flag controls broadcast eligibility. Respect opt-outs.

---

## Priority 5 — Advanced WhatsApp

### WhatsApp Calling
- Enable/disable calling per number
- Initiate outbound voice calls
- List call history, get recordings
- Per-minute cost estimation
- Requires calling enabled on the WhatsApp number

### WhatsApp Groups
- Create, list, manage groups (non-coexistence numbers only)
- Manage participants, invite links, join requests
- 9 API endpoints

### Meta Business Agent (AI)
Full AI agent infrastructure:
- Knowledge base (FAQs, website crawling, file uploads)
- Custom skills and UI skills
- MCP-based external tool connectors
- Budget management, testing, evaluations

### Direct Send (No Template Required)
`category: "utility"` on send allows business-initiated messages outside the 24-hour window without a pre-approved template. WABA must be eligible.

---

## Technical Improvements

### Scoped API Keys
`zrk_` prefix keys restricted to specific profiles. Useful for multi-tenant isolation if Whatsy serves multiple businesses.

### Content-Hash Dedup
Zernio returns 409 for identical `(platform, accountId, content + media)` within 24 hours. Handle gracefully instead of erroring.

### Rate Limit Headers
Monitor `X-RateLimit-Remaining` and `X-RateLimit-Reset` on responses. Current limits: 600 req/min (3+ accounts), 60 req/min (free).

### WhatsApp Number Health
`GET /v1/whatsapp/number-info` — check quality rating (GREEN/YELLOW/RED), messaging tier, throughput, status. Could show in the admin panel.
