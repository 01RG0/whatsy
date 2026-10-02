package zernio

import (
	"encoding/json"
	"testing"
)

func TestInboundMessagePayload_QuotedReplies(t *testing.T) {
	tests := []struct {
		name         string
		jsonPayload  string
		expectedID   string
		expectedBody string
	}{
		{
			name: "Metadata.QuotedMessage.PlatformMessageID",
			jsonPayload: `{
				"message": {"id": "msg-1", "direction": "incoming", "text": "hello"},
				"metadata": {
					"quotedMessage": {
						"platformMessageId": "wamid.HBgL123"
					}
				}
			}`,
			expectedID: "wamid.HBgL123",
		},
		{
			name: "Metadata.QuotedMessageID",
			jsonPayload: `{
				"message": {"id": "msg-1", "direction": "incoming", "text": "hello"},
				"metadata": {
					"quotedMessageId": "quoted-id-meta"
				}
			}`,
			expectedID: "quoted-id-meta",
		},
		{
			name: "Message.Metadata.QuotedMessage.PlatformMessageID",
			jsonPayload: `{
				"message": {
					"id": "msg-1",
					"direction": "incoming",
					"text": "hello",
					"metadata": {
						"quotedMessage": {
							"platformMessageId": "wamid.nested123"
						}
					}
				}
			}`,
			expectedID: "wamid.nested123",
		},
		{
			name: "Message.Metadata.QuotedMessageID",
			jsonPayload: `{
				"message": {
					"id": "msg-1",
					"direction": "incoming",
					"text": "hello",
					"metadata": {
						"quotedMessageId": "quoted-nested-id"
					}
				}
			}`,
			expectedID: "quoted-nested-id",
		},
		{
			name: "Top-level ReplyTo and QuotedMessageID",
			jsonPayload: `{
				"message": {"id": "msg-1", "direction": "incoming", "text": "hello"},
				"replyTo": "reply-to-top"
			}`,
			expectedID: "reply-to-top",
		},
		{
			name: "Top-level QuotedMessageID",
			jsonPayload: `{
				"message": {"id": "msg-1", "direction": "incoming", "text": "hello"},
				"quotedMessageId": "quoted-top-id"
			}`,
			expectedID: "quoted-top-id",
		},
		{
			name: "ContextInfo.StanzaID and QuotedMessage.Body",
			jsonPayload: `{
				"message": {
					"id": "msg-1",
					"direction": "incoming",
					"text": "hello",
					"contextInfo": {
						"stanzaId": "wamid.stanza456",
						"quotedMessage": {
							"body": "original message body"
						}
					}
				}
			}`,
			expectedID:   "wamid.stanza456",
			expectedBody: "original message body",
		},
		{
			name: "Context.ID",
			jsonPayload: `{
				"message": {
					"id": "msg-1",
					"direction": "incoming",
					"text": "hello",
					"context": {
						"id": "wamid.context789"
					}
				}
			}`,
			expectedID: "wamid.context789",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var p InboundMessagePayload
			if err := json.Unmarshal([]byte(tc.jsonPayload), &p); err != nil {
				t.Fatalf("unexpected unmarshal error: %v", err)
			}
			if tc.expectedID == "" {
				if p.ReplyTo != nil {
					t.Fatalf("expected nil ReplyTo, got %+v", p.ReplyTo)
				}
			} else {
				if p.ReplyTo == nil {
					t.Fatalf("expected ReplyTo, got nil")
				}
				if p.ReplyTo.ZernioMessageID != tc.expectedID {
					t.Errorf("expected ZernioMessageID %q, got %q", tc.expectedID, p.ReplyTo.ZernioMessageID)
				}
				if tc.expectedBody != "" && p.ReplyTo.Content != tc.expectedBody {
					t.Errorf("expected Content %q, got %q", tc.expectedBody, p.ReplyTo.Content)
				}
			}
		})
	}
}
