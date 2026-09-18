/**
 * TypeScript definitions mapping Zernio API Inbox & WhatsApp objects to UI state.
 * Compatible with Zernio API v1.5.0 (/v1/inbox/conversations, /v1/inbox/messages, /v1/whatsapp/*)
 */

export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export type MessageDirection = 'inbound' | 'outbound';

export type MessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'voice_note'
  | 'video'
  | 'document'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'template'
  | 'system'
  | 'sticker';

export interface Attachment {
  id?: string;
  url: string;
  type: 'image' | 'audio' | 'video' | 'document';
  name?: string;
  sizeBytes?: number;
  mimeType?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
}

export interface InteractiveButton {
  id: string;
  title: string;
  type?: 'reply' | 'url' | 'call';
  url?: string;
  phoneNumber?: string;
}

export interface InteractiveTemplate {
  header?: {
    type: 'text' | 'image' | 'video' | 'document';
    text?: string;
    mediaUrl?: string;
  };
  body: string;
  footer?: string;
  buttons?: InteractiveButton[];
  listSections?: Array<{
    title: string;
    rows: Array<{
      id: string;
      title: string;
      description?: string;
    }>;
  }>;
}

export interface ZernioMessage {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  senderId?: string;
  senderName?: string;
  senderAvatar?: string;
  type: MessageType;
  content: string;
  createdAt: string; // ISO 8601 timestamp
  status: DeliveryStatus;
  attachments?: Attachment[];
  interactive?: InteractiveTemplate;
  replyTo?: {
    id: string;
    senderName: string;
    content: string;
  };
  reactions?: Array<{
    emoji: string;
    senderId: string;
    senderName?: string;
  }>;
}

export interface ZernioParticipant {
  id: string;
  username?: string;
  displayName: string;
  phoneNumber?: string;
  avatarUrl?: string;
  isOnline?: boolean;
  lastSeen?: string;
}

export interface ZernioConversation {
  id: string;
  accountId: string;
  platform: 'whatsapp' | 'instagram' | 'telegram' | 'facebook' | 'sms';
  participant: ZernioParticipant;
  lastMessage?: {
    id: string;
    content: string;
    type: MessageType;
    direction: MessageDirection;
    senderName?: string;
    createdAt: string;
    status: DeliveryStatus;
  };
  unreadCount: number;
  isPinned?: boolean;
  isMuted?: boolean;
  isGroup?: boolean;
  groupMetadata?: {
    groupId: string;
    groupSubject: string;
    participantCount: number;
    admins?: string[];
  };
  tags?: string[];
  assignedAgent?: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  updatedAt: string;
}

export interface SendMessagePayload {
  accountId: string;
  conversationId?: string;
  participantId?: string;
  message: string;
  category?: 'utility' | 'marketing' | 'authentication';
  attachmentUrl?: string;
  attachmentType?: 'image' | 'audio' | 'video' | 'document';
  attachmentName?: string;
  voiceNote?: boolean;
  replyTo?: string;
  buttons?: InteractiveButton[];
}

export type ConversationFilter = 'all' | 'unread' | 'groups' | 'assigned_to_me' | 'unanswered';
