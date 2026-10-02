package service

import (
	"testing"

	"github.com/whatsy/backend/internal/domain"
	"github.com/whatsy/backend/internal/zernio"
)

func TestOutboundContentType(t *testing.T) {
	tests := []struct {
		name     string
		payload  zernio.SendMessagePayload
		expected domain.ContentType
	}{
		{
			name: "contacts payload returns ContentTypeContacts",
			payload: zernio.SendMessagePayload{
				Contacts: []zernio.ContactCard{
					{
						Name: struct {
							FormattedName string `json:"formatted_name"`
						}{FormattedName: "Alice Smith"},
					},
				},
			},
			expected: domain.ContentTypeContacts,
		},
		{
			name: "voice note payload returns ContentTypeVoiceNote",
			payload: zernio.SendMessagePayload{
				VoiceNote: true,
			},
			expected: domain.ContentTypeVoiceNote,
		},
		{
			name: "interactive buttons payload returns ContentTypeInteractive",
			payload: zernio.SendMessagePayload{
				Buttons: []zernio.Button{{Title: "Click"}},
			},
			expected: domain.ContentTypeInteractive,
		},
		{
			name: "attachment image payload returns ContentTypeImage",
			payload: zernio.SendMessagePayload{
				AttachmentType: "image",
			},
			expected: domain.ContentTypeImage,
		},
		{
			name: "regular message returns ContentTypeText",
			payload: zernio.SendMessagePayload{
				Message: "Hello",
			},
			expected: domain.ContentTypeText,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := outboundContentType(tc.payload)
			if got != tc.expected {
				t.Errorf("expected %q, got %q", tc.expected, got)
			}
		})
	}
}
