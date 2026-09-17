package eventlog

import (
	"fmt"
	"log"
	"time"
)

// --- Webhook lifecycle ---

func Webhook(eventType, conversationID string) {
	log.Printf("[event] webhook_received type=%s conv=%s ts=%d", eventType, conversationID, time.Now().UnixMilli())
}

func WebhookError(eventType string, err error) {
	log.Printf("[event] webhook_error type=%s error=%q ts=%d", eventType, err.Error(), time.Now().UnixMilli())
}

// --- Message delivery trace (the refresh-bug pipeline) ---
// Each step logs [trace] with the message ID so you can grep a single
// message's journey: webhook → save → broadcast → hub → client write.
//
//   railway logs -s whatsy-backend | grep "trace.*MSG_ID"
//
// If a message shows step 1-3 but not step 4-5, the bug is in the
// WebSocket hub delivery. If it shows 1-2 but not 3, BroadcastToAll
// was never called. And so on.

func TraceStep1WebhookHit(msgZernioID, convZernioID string) {
	log.Printf("[trace] step=1_webhook_hit zernio_msg=%s zernio_conv=%s ts=%d",
		msgZernioID, convZernioID, time.Now().UnixMilli())
}

func TraceStep2MessageSaved(direction, msgID, convID string) {
	log.Printf("[trace] step=2_msg_saved dir=%s msg=%s conv=%s ts=%d",
		direction, msgID, convID, time.Now().UnixMilli())
}

func TraceStep3BroadcastQueued(eventName, msgID, convID string) {
	log.Printf("[trace] step=3_broadcast_queued event=%s msg=%s conv=%s ts=%d",
		eventName, msgID, convID, time.Now().UnixMilli())
}

func TraceStep4HubDelivered(clientCount, droppedCount int) {
	log.Printf("[trace] step=4_hub_delivered clients=%d dropped=%d ts=%d",
		clientCount, droppedCount, time.Now().UnixMilli())
}

func TraceStep5ClientWrite(agentID string, dataLen int, err error) {
	if err != nil {
		log.Printf("[trace] step=5_client_write_FAIL agent=%s bytes=%d error=%q ts=%d",
			agentID, dataLen, err.Error(), time.Now().UnixMilli())
	}
}

// --- General events ---

func MessageSaved(direction, messageID, conversationID string) {
	log.Printf("[event] message_saved dir=%s msg=%s conv=%s ts=%d", direction, messageID, conversationID, time.Now().UnixMilli())
}

func WSBroadcast(eventName, conversationID string, clientCount int) {
	log.Printf("[event] ws_broadcast event=%s conv=%s clients=%d ts=%d", eventName, conversationID, clientCount, time.Now().UnixMilli())
}

func WSConnect(agentID string) {
	log.Printf("[event] ws_connect agent=%s ts=%d", agentID, time.Now().UnixMilli())
}

func WSDisconnect(agentID string) {
	log.Printf("[event] ws_disconnect agent=%s ts=%d", agentID, time.Now().UnixMilli())
}

func WSClientCount(count int) {
	log.Printf("[event] ws_client_count clients=%d ts=%d", count, time.Now().UnixMilli())
}

func ZernioSend(messageID, conversationID string, durationMs int64, err error) {
	if err != nil {
		log.Printf("[event] zernio_send_fail msg=%s conv=%s dur=%dms error=%q ts=%d", messageID, conversationID, durationMs, err.Error(), time.Now().UnixMilli())
	} else {
		log.Printf("[event] zernio_send_ok msg=%s conv=%s dur=%dms ts=%d", messageID, conversationID, durationMs, time.Now().UnixMilli())
	}
}

func RedisPub(channel string, err error) {
	if err != nil {
		log.Printf("[event] redis_pub_fail channel=%s error=%q ts=%d", channel, err.Error(), time.Now().UnixMilli())
	}
}

func Info(tag string, format string, args ...interface{}) {
	log.Printf("[event] %s %s ts=%d", tag, fmt.Sprintf(format, args...), time.Now().UnixMilli())
}
