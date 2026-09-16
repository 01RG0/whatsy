# Skill: Zernio & WhatsApp Webhook Handler Recipe

You are an expert Backend Engineer specializing in Webhook integrations, event-driven architectures, and WhatsApp Business API event processing. Use this guide to design, debug, test, and securely handle real-time webhook events delivered by Zernio.

---

## 1. Webhook Lifecycle & Security

### Signature Verification (HMAC SHA-256)
All webhooks emitted by Zernio should be verified to prevent spoofing and replay attacks.
- Header: `X-Zernio-Signature` (or `X-Hub-Signature-256`)
- Formula: `HMAC_SHA256(raw_request_body, webhook_signing_secret)`

```typescript
import crypto from "crypto";

export function verifyZernioSignature(
  rawBody: Buffer | string,
  signatureHeader: string,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  
  const hash = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
    
  const expectedSignature = `sha256=${hash}`;
  return crypto.timingSafeEqual(
    Buffer.from(signatureHeader),
    Buffer.from(expectedSignature)
  );
}
```

> **Crucial**: Always verify against the raw unparsed request body (before `JSON.parse` or body-parser middleware re-serializes whitespace).

---

## 2. Fast ACK / Idempotency Rule

1. **Respond with HTTP 200 OK Immediately**:
   - Webhook dispatchers retry failed deliveries (typically after 5-10s timeout).
   - If processing takes longer than 1-2 seconds (e.g. LLM generation, CRM syncing), push the event into an in-memory queue, BullMQ, Redis, or Kafka, and return HTTP 200 immediately.
2. **Idempotency**:
   - Store incoming `message_id` or `event_id` in a short-lived cache (Redis with 24h TTL).
   - If an event with the same ID is received again, return `200 OK` and ignore duplicate execution.

---

## 3. Core Zernio Webhook Event Schemas

### A. Incoming User Message (`message.received`)
Triggered when a customer messages the WhatsApp number:
```json
{
  "event": "message.received",
  "event_id": "evt_98371239128",
  "timestamp": 1792160000,
  "data": {
    "message_id": "wamid.HBgLM...",
    "channel": "whatsapp",
    "sender": {
      "phone": "+14155552671",
      "name": "Alex Smith"
    },
    "message_type": "text",
    "content": {
      "text": "Hello, I want to track my order!"
    }
  }
}
```

### B. Message Delivery Status (`message.status_updated`)
Tracks outbound message delivery receipts:
```json
{
  "event": "message.status_updated",
  "event_id": "evt_98371239129",
  "timestamp": 1792160005,
  "data": {
    "message_id": "wamid.HBgLM...",
    "recipient": "+14155552671",
    "status": "delivered",
    "timestamp": 1792160005
  }
}
```
*Possible statuses*: `sent`, `delivered`, `read`, `failed` (includes `error_code` and `reason`).

### C. WhatsApp Flow Response (`flow.completed`)
Triggered when a user completes a native WhatsApp Flow:
```json
{
  "event": "flow.completed",
  "event_id": "evt_98371239130",
  "data": {
    "flow_id": "flow_123456",
    "flow_token": "UNIQUE_SESSION_TOKEN_12345",
    "sender": {
      "phone": "+14155552671"
    },
    "response_payload": {
      "service": "Account Support",
      "preferred_date": "2026-10-01",
      "notes": "Urgent request"
    }
  }
}
```

---

## 4. Complete Node.js / Express Webhook Handler

```typescript
import express, { Request, Response } from "express";
import { verifyZernioSignature } from "./verify";

const app = express();

// Use raw body parser to preserve raw bytes for HMAC verification
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.post("/api/webhooks/zernio", async (req: Request & { rawBody?: Buffer }, res: Response) => {
  const signature = req.headers["x-zernio-signature"] as string;
  const secret = process.env.ZERNIO_WEBHOOK_SECRET || "";

  // 1. Verify Signature
  if (secret && !verifyZernioSignature(req.rawBody || "", signature, secret)) {
    console.warn("Unauthorized webhook attempt - invalid HMAC signature.");
    return res.status(401).json({ error: "Invalid signature" });
  }

  // 2. Immediate 200 ACK
  res.status(200).json({ received: true });

  // 3. Asynchronous processing
  const event = req.body;
  try {
    switch (event.event) {
      case "message.received":
        await handleIncomingMessage(event.data);
        break;
      case "message.status_updated":
        await handleDeliveryStatus(event.data);
        break;
      case "flow.completed":
        await handleFlowCompletion(event.data);
        break;
      default:
        console.log(`Unhandled event type: ${event.event}`);
    }
  } catch (err) {
    console.error("Error processing webhook in background:", err);
  }
});

async function handleIncomingMessage(data: any) {
  console.log(`Received message from ${data.sender.phone}: ${data.content?.text}`);
  // Pass to AI Agent or Router logic
}

async function handleDeliveryStatus(data: any) {
  console.log(`Message ${data.message_id} status updated to: ${data.status}`);
}

async function handleFlowCompletion(data: any) {
  console.log(`User ${data.sender.phone} finished Flow:`, data.response_payload);
}
```

---

## 5. Troubleshooting Checklist

- [ ] **HTTP 401 Signature Mismatch**: Ensure your server didn't parse JSON before computing HMAC. Keep raw Buffer.
- [ ] **Repeated Events (Loops)**: Ensure your server sends HTTP 200 within 5 seconds; otherwise Zernio will retry the webhook.
- [ ] **Local Testing**: Use `cloudflared tunnel` or `ngrok` (`ngrok http 3000`) and set the public URL in Zernio Webhooks settings.
- [ ] **Media Messages**: When `message_type` is `image`, `audio`, or `document`, inspect `content.media_url` and download within the expiry window.
