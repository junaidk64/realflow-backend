# WhatsApp Frontend Integration Guide

Complete guide for integrating Meta WhatsApp Cloud API into the RealFlow Next.js frontend.
Follow this guide to extend the existing UI without redesigning it.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Folder Structure](#2-folder-structure)
3. [Dependencies](#3-dependencies)
4. [API Integration Layer](#4-api-integration-layer)
5. [Socket.IO Real-Time Layer](#5-socketio-real-time-layer)
6. [State Management](#6-state-management)
7. [Lead Details Page — Unified Timeline](#7-lead-details-page--unified-timeline)
8. [WhatsApp Inbox Module](#8-whatsapp-inbox-module)
9. [WhatsApp Settings (Connection Setup)](#9-whatsapp-settings-connection-setup)
10. [Workflow Catalogue Updates](#10-workflow-catalogue-updates)
11. [Component Reference](#11-component-reference)
12. [Event Handling Reference](#12-event-handling-reference)
13. [Performance Best Practices](#13-performance-best-practices)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Frontend                          │
│                                                                   │
│  /leads/[id]             /communications/whatsapp                │
│  ┌─────────────┐         ┌─────────────────────────────────┐    │
│  │ Lead Detail  │         │       WhatsApp Inbox             │    │
│  │  ─ Email     │         │  ConversationList │ ChatWindow   │    │
│  │  ─ WhatsApp  │         │  (left panel)     │ (right panel)│    │
│  │  ─ Timeline  │         └─────────────────────────────────┘    │
│  └─────────────┘                                                  │
│        │                          │                               │
│        └──────────┬───────────────┘                               │
│                   ▼                                               │
│           useMessagesStore (Zustand)                              │
│           useWhatsAppStore                                        │
│                   │                                               │
│         ┌─────────┴──────────┐                                   │
│         ▼                    ▼                                    │
│    REST API Client      Socket.IO Client                          │
│    (axios/fetch)        (socket.io-client)                        │
└─────────────────────────────────────────────────────────────────┘
                    │                    │
                    ▼                    ▼
              Backend REST          Socket.IO Server
              /api/whatsapp         ws://api/socket.io
```

### Unified Communication Principle

Both email and WhatsApp messages are stored as `EmailLog` documents with a `channel` field.
The frontend uses this same field to render both in one timeline — no separate data model needed.

---

## 2. Folder Structure

Add these paths to your existing Next.js project:

```
src/
├── app/
│   ├── communications/
│   │   └── whatsapp/
│   │       └── page.tsx                    ← WhatsApp Inbox page
│   └── leads/
│       └── [id]/
│           └── page.tsx                    ← Extend existing (add WhatsApp tab)
├── components/
│   ├── whatsapp/
│   │   ├── WhatsAppInbox.tsx               ← Inbox container
│   │   ├── ConversationList.tsx            ← Left panel: list of conversations
│   │   ├── ConversationItem.tsx            ← Single row in conversation list
│   │   ├── ChatWindow.tsx                  ← Right panel: message thread
│   │   ├── MessageBubble.tsx               ← Individual message bubble
│   │   ├── MessageInput.tsx                ← Text input + send button
│   │   ├── MessageStatusIcon.tsx           ← Sent/delivered/read tick icons
│   │   └── WhatsAppConnectionBanner.tsx    ← "Connect WhatsApp" prompt
│   └── leads/
│       ├── CommunicationTimeline.tsx       ← Extend: unified email+WA timeline
│       └── TimelineItem.tsx                ← Extend: render both channel types
├── hooks/
│   ├── useSocket.ts                        ← Socket.IO connection hook
│   ├── useWhatsAppMessages.ts              ← Real-time message subscription
│   └── useWhatsAppInbox.ts                 ← Conversation list + polling
├── lib/
│   ├── api/
│   │   ├── whatsapp.ts                     ← REST API calls
│   │   └── leads.ts                        ← Extend: add getLeadMessages()
│   └── socket.ts                           ← Socket.IO singleton
├── store/
│   └── whatsappStore.ts                    ← Zustand store
└── types/
    └── whatsapp.ts                         ← TypeScript types
```

---

## 3. Dependencies

Install these packages:

```bash
npm install socket.io-client
# Already installed (likely): axios, zustand
```

---

## 4. API Integration Layer

### `src/lib/api/whatsapp.ts`

```typescript
import axios from 'axios'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  withCredentials: true,
})

// ── Connection Management ─────────────────────────────────────────────────────

export interface WhatsAppConnectPayload {
  phoneNumberId: string
  wabaId: string
  displayPhoneNumber: string
  accessToken: string
  verifyToken: string
  appSecret: string
}

export const connectWhatsApp = (payload: WhatsAppConnectPayload) =>
  api.post('/api/whatsapp/connect', payload)

export const disconnectWhatsApp = () =>
  api.delete('/api/whatsapp/disconnect')

export const getWhatsAppStatus = () =>
  api.get<{ data: { connected: boolean; connection: WhatsAppConnection | null } }>(
    '/api/whatsapp/status'
  )

// ── Messaging ─────────────────────────────────────────────────────────────────

export interface SendTextPayload {
  to: string
  type: 'text'
  text: string
  leadId?: string
}

export interface SendTemplatePayload {
  to: string
  type: 'template'
  templateName: string
  languageCode?: string
  components?: unknown[]
  leadId?: string
}

export interface SendMediaPayload {
  to: string
  type: 'media'
  mediaType: 'image' | 'video' | 'audio' | 'document'
  mediaId: string
  caption?: string
  leadId?: string
}

export type SendMessagePayload = SendTextPayload | SendTemplatePayload | SendMediaPayload

export const sendWhatsAppMessage = (payload: SendMessagePayload) =>
  api.post<{ data: { messageId: string } }>('/api/whatsapp/send', payload)

// ── Inbox ─────────────────────────────────────────────────────────────────────

export const getWhatsAppConversations = (params?: {
  page?: number
  limit?: number
  search?: string
}) =>
  api.get<{ data: { conversations: Conversation[]; pagination: Pagination } }>(
    '/api/whatsapp/conversations',
    { params }
  )

export const getLeadMessages = (
  leadId: string,
  params?: { channel?: 'email' | 'whatsapp'; page?: number; limit?: number }
) =>
  api.get<{ data: { messages: MessageLog[]; pagination: Pagination } }>(
    `/api/whatsapp/conversations/${leadId}/messages`,
    { params }
  )
```

### `src/types/whatsapp.ts`

```typescript
export interface WhatsAppConnection {
  _id: string
  phoneNumberId: string
  wabaId: string
  displayPhoneNumber: string
  isActive: boolean
  messageCount: number
  lastMessageAt: string | null
}

export type MessageChannel = 'email' | 'whatsapp'
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'template'
export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed'

export interface MessageLog {
  _id: string
  leadId: string
  channel: MessageChannel
  type: 'incoming' | 'outgoing'
  from: string
  to: string
  subject: string          // email only
  body: string
  htmlBody: string         // email only
  gmailMessageId: string   // email only
  whatsappMessageId: string
  whatsappPhone: string
  messageType: MessageType | null
  mediaUrl: string | null
  deliveryStatus: DeliveryStatus | null
  status: string
  sentAt: string
  createdAt: string
}

export interface Conversation {
  lead: {
    _id: string
    customerName: string
    customerPhone: string
    customerEmail: string
    status: string
    source: string
  }
  lastMessage: MessageLog | null
  unreadCount: number
}

export interface Pagination {
  page: number
  limit: number
  total: number
  pages: number
}

// ── Socket event payloads ─────────────────────────────────────────────────────

export interface WaMessageNewEvent {
  leadId: string
  emailLogId: string
  channel: 'whatsapp'
  type: 'incoming' | 'outgoing'
  from: string
  body: string
  messageType: MessageType
  timestamp: string
  senderName?: string
  deliveryStatus?: DeliveryStatus
}

export interface WaMessageStatusEvent {
  messageId: string
  leadId: string | null
  status: DeliveryStatus
  timestamp: string
}
```

---

## 5. Socket.IO Real-Time Layer

### `src/lib/socket.ts` — Singleton

```typescript
import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

export const getSocket = (): Socket => {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_API_URL!, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      autoConnect: false,
    })
  }
  return socket
}

export const connectSocket = (userId: string, organizationId?: string) => {
  const s = getSocket()
  if (!s.connected) s.connect()
  s.emit('join', { userId, organizationId })
  return s
}

export const disconnectSocket = () => {
  socket?.disconnect()
  socket = null
}
```

### `src/hooks/useSocket.ts`

```typescript
'use client'
import { useEffect, useRef } from 'react'
import { Socket } from 'socket.io-client'
import { connectSocket, getSocket } from '@/lib/socket'
import { useAuthStore } from '@/store/authStore' // your existing auth store

export const useSocket = () => {
  const { user } = useAuthStore()
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (!user?.id) return

    socketRef.current = connectSocket(user.id, user.organizationId)

    return () => {
      // Don't disconnect on unmount — socket is a singleton shared across pages
    }
  }, [user?.id, user?.organizationId])

  return socketRef.current ?? getSocket()
}
```

### `src/hooks/useWhatsAppMessages.ts`

```typescript
'use client'
import { useEffect, useCallback } from 'react'
import { useSocket } from './useSocket'
import { useWhatsAppStore } from '@/store/whatsappStore'
import { WaMessageNewEvent, WaMessageStatusEvent } from '@/types/whatsapp'

/**
 * Subscribes to real-time WhatsApp events and updates the store.
 * Mount this once at the layout level so it persists across navigation.
 */
export const useWhatsAppMessages = () => {
  const socket = useSocket()
  const { addMessage, updateMessageStatus, incrementUnread } = useWhatsAppStore()

  const onNewMessage = useCallback(
    (event: WaMessageNewEvent) => {
      addMessage(event.leadId, {
        _id: event.emailLogId,
        leadId: event.leadId,
        channel: 'whatsapp',
        type: event.type,
        from: event.from,
        to: '',
        subject: '',
        body: event.body,
        htmlBody: '',
        gmailMessageId: '',
        whatsappMessageId: '',
        whatsappPhone: event.from,
        messageType: event.messageType,
        mediaUrl: null,
        deliveryStatus: event.deliveryStatus ?? null,
        status: 'delivered',
        sentAt: event.timestamp,
        createdAt: event.timestamp,
      })

      if (event.type === 'incoming') {
        incrementUnread(event.leadId)
      }
    },
    [addMessage, incrementUnread],
  )

  const onStatusUpdate = useCallback(
    (event: WaMessageStatusEvent) => {
      if (event.leadId) {
        updateMessageStatus(event.leadId, event.messageId, event.status)
      }
    },
    [updateMessageStatus],
  )

  useEffect(() => {
    socket.on('whatsapp:message:new', onNewMessage)
    socket.on('whatsapp:message:status', onStatusUpdate)

    return () => {
      socket.off('whatsapp:message:new', onNewMessage)
      socket.off('whatsapp:message:status', onStatusUpdate)
    }
  }, [socket, onNewMessage, onStatusUpdate])
}
```

---

## 6. State Management

### `src/store/whatsappStore.ts`

```typescript
import { create } from 'zustand'
import { MessageLog, Conversation, DeliveryStatus } from '@/types/whatsapp'

interface WhatsAppState {
  // Conversation list
  conversations: Conversation[]
  conversationsLoading: boolean
  setConversations: (convs: Conversation[]) => void
  updateConversationLastMessage: (leadId: string, msg: MessageLog) => void

  // Per-lead message threads (keyed by leadId)
  threads: Record<string, MessageLog[]>
  threadsLoading: Record<string, boolean>
  setThread: (leadId: string, messages: MessageLog[]) => void
  addMessage: (leadId: string, msg: MessageLog) => void
  updateMessageStatus: (leadId: string, waMessageId: string, status: DeliveryStatus) => void

  // Unread counts
  unreadCounts: Record<string, number>
  incrementUnread: (leadId: string) => void
  clearUnread: (leadId: string) => void
  get totalUnread(): number

  // Active conversation
  activeLeadId: string | null
  setActiveLeadId: (id: string | null) => void
}

export const useWhatsAppStore = create<WhatsAppState>((set, get) => ({
  conversations: [],
  conversationsLoading: false,
  setConversations: (conversations) => set({ conversations }),
  updateConversationLastMessage: (leadId, msg) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.lead._id === leadId ? { ...c, lastMessage: msg } : c,
      ),
    })),

  threads: {},
  threadsLoading: {},
  setThread: (leadId, messages) =>
    set((s) => ({
      threads: { ...s.threads, [leadId]: messages },
      threadsLoading: { ...s.threadsLoading, [leadId]: false },
    })),
  addMessage: (leadId, msg) => {
    set((s) => ({
      threads: {
        ...s.threads,
        [leadId]: [...(s.threads[leadId] ?? []), msg],
      },
    }))
    get().updateConversationLastMessage(leadId, msg)
  },
  updateMessageStatus: (leadId, waMessageId, status) =>
    set((s) => ({
      threads: {
        ...s.threads,
        [leadId]: (s.threads[leadId] ?? []).map((m) =>
          m.whatsappMessageId === waMessageId ? { ...m, deliveryStatus: status } : m,
        ),
      },
    })),

  unreadCounts: {},
  incrementUnread: (leadId) =>
    set((s) => ({
      unreadCounts: { ...s.unreadCounts, [leadId]: (s.unreadCounts[leadId] ?? 0) + 1 },
    })),
  clearUnread: (leadId) =>
    set((s) => ({
      unreadCounts: { ...s.unreadCounts, [leadId]: 0 },
    })),
  get totalUnread() {
    return Object.values(get().unreadCounts).reduce((a, b) => a + b, 0)
  },

  activeLeadId: null,
  setActiveLeadId: (id) => set({ activeLeadId: id }),
}))
```

---

## 7. Lead Details Page — Unified Timeline

### Where to modify

Find your existing `src/app/leads/[id]/page.tsx` (or equivalent). Extend the communication section — **do not redesign the page**.

### Extending `CommunicationTimeline.tsx`

The existing component likely renders only email logs. Extend it to:
1. Accept a `channel` prop (or `'all'` for unified view)
2. Use the updated `getLeadMessages` API that returns both email and WhatsApp messages
3. Sort all messages by `sentAt` chronologically

```tsx
// src/components/leads/CommunicationTimeline.tsx
'use client'

import { useEffect, useState } from 'react'
import { getLeadMessages } from '@/lib/api/whatsapp'
import { MessageLog } from '@/types/whatsapp'
import { TimelineItem } from './TimelineItem'
import { useWhatsAppStore } from '@/store/whatsappStore'

interface Props {
  leadId: string
  // 'all' shows email + whatsapp interleaved chronologically
  channel?: 'all' | 'email' | 'whatsapp'
}

export const CommunicationTimeline = ({ leadId, channel = 'all' }: Props) => {
  const [messages, setMessages] = useState<MessageLog[]>([])
  const [loading, setLoading] = useState(true)
  const { threads, addMessage } = useWhatsAppStore()

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const params = channel !== 'all' ? { channel } : {}
        const res = await getLeadMessages(leadId, params)
        setMessages(res.data.data.messages)
        // Seed the WhatsApp store thread for real-time updates
        const waMsgs = res.data.data.messages.filter((m) => m.channel === 'whatsapp')
        if (waMsgs.length > 0) {
          useWhatsAppStore.getState().setThread(leadId, waMsgs)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [leadId, channel])

  // Merge real-time WhatsApp messages from store into email messages from API
  const waThread = threads[leadId] ?? []
  const allMessages = channel === 'email'
    ? messages
    : channel === 'whatsapp'
    ? waThread
    : [...messages.filter((m) => m.channel === 'email'), ...waThread]
        .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())

  if (loading) return <div className="animate-pulse">Loading communications...</div>

  return (
    <div className="flex flex-col gap-3">
      {allMessages.map((msg) => (
        <TimelineItem key={msg._id} message={msg} />
      ))}
      {allMessages.length === 0 && (
        <p className="text-sm text-muted-foreground">No messages yet.</p>
      )}
    </div>
  )
}
```

### Extending `TimelineItem.tsx`

```tsx
// src/components/leads/TimelineItem.tsx
import { MessageLog } from '@/types/whatsapp'
import { MessageStatusIcon } from '@/components/whatsapp/MessageStatusIcon'
import { formatDistanceToNow } from 'date-fns'
import { Mail, MessageCircle } from 'lucide-react'

interface Props {
  message: MessageLog
}

export const TimelineItem = ({ message }: Props) => {
  const isIncoming = message.type === 'incoming'
  const isWhatsApp = message.channel === 'whatsapp'

  return (
    <div className={`flex ${isIncoming ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[70%] rounded-lg px-4 py-2 shadow-sm ${
          isIncoming
            ? 'bg-white border border-gray-200'
            : 'bg-blue-600 text-white'
        }`}
      >
        {/* Channel badge */}
        <div className="flex items-center gap-1 mb-1">
          {isWhatsApp ? (
            <MessageCircle className="w-3 h-3 text-green-500" />
          ) : (
            <Mail className="w-3 h-3 text-blue-400" />
          )}
          <span className="text-xs opacity-60">
            {isWhatsApp ? 'WhatsApp' : 'Email'}
          </span>
        </div>

        {/* Subject (email only) */}
        {message.subject && (
          <p className="font-medium text-sm mb-1">{message.subject}</p>
        )}

        {/* Body */}
        <p className="text-sm whitespace-pre-wrap">{message.body}</p>

        {/* Footer */}
        <div className="flex items-center justify-between mt-1 gap-2">
          <span className="text-xs opacity-50">
            {formatDistanceToNow(new Date(message.sentAt), { addSuffix: true })}
          </span>
          {isWhatsApp && !isIncoming && message.deliveryStatus && (
            <MessageStatusIcon status={message.deliveryStatus} />
          )}
        </div>
      </div>
    </div>
  )
}
```

### Adding a channel tab to Lead Detail page

Find the communications section in your Lead Detail page and add channel filter tabs:

```tsx
// Inside your Lead Detail page component
const [channel, setChannel] = useState<'all' | 'email' | 'whatsapp'>('all')

// Add this tab bar above CommunicationTimeline:
<div className="flex gap-2 border-b mb-4">
  {(['all', 'email', 'whatsapp'] as const).map((ch) => (
    <button
      key={ch}
      onClick={() => setChannel(ch)}
      className={`px-3 py-1.5 text-sm capitalize border-b-2 transition-colors ${
        channel === ch
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {ch === 'all' ? 'All' : ch === 'email' ? '✉️ Email' : '💬 WhatsApp'}
    </button>
  ))}
</div>

<CommunicationTimeline leadId={lead._id} channel={channel} />
```

---

## 8. WhatsApp Inbox Module

### Page: `src/app/communications/whatsapp/page.tsx`

```tsx
'use client'
import { WhatsAppInbox } from '@/components/whatsapp/WhatsAppInbox'
import { useWhatsAppMessages } from '@/hooks/useWhatsAppMessages'

export default function WhatsAppPage() {
  // Subscribe to real-time events for the entire inbox
  useWhatsAppMessages()

  return (
    <div className="h-screen flex flex-col">
      <h1 className="text-xl font-semibold px-4 py-3 border-b">WhatsApp Inbox</h1>
      <WhatsAppInbox />
    </div>
  )
}
```

### `WhatsAppInbox.tsx` — Two-panel layout

```tsx
// src/components/whatsapp/WhatsAppInbox.tsx
'use client'

import { useEffect } from 'react'
import { useWhatsAppStore } from '@/store/whatsappStore'
import { getWhatsAppConversations } from '@/lib/api/whatsapp'
import { ConversationList } from './ConversationList'
import { ChatWindow } from './ChatWindow'

export const WhatsAppInbox = () => {
  const {
    conversations, setConversations, activeLeadId, setActiveLeadId,
  } = useWhatsAppStore()

  useEffect(() => {
    getWhatsAppConversations({ limit: 50 }).then((res) => {
      setConversations(res.data.data.conversations)
    })
  }, [setConversations])

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: conversation list */}
      <div className="w-80 border-r flex-shrink-0 overflow-y-auto">
        <ConversationList
          conversations={conversations}
          activeLeadId={activeLeadId}
          onSelect={setActiveLeadId}
        />
      </div>

      {/* Right: chat window */}
      <div className="flex-1 flex flex-col">
        {activeLeadId ? (
          <ChatWindow leadId={activeLeadId} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Select a conversation
          </div>
        )}
      </div>
    </div>
  )
}
```

### `ConversationList.tsx`

```tsx
// src/components/whatsapp/ConversationList.tsx
'use client'

import { useState, useCallback } from 'react'
import { Conversation } from '@/types/whatsapp'
import { ConversationItem } from './ConversationItem'
import { useWhatsAppStore } from '@/store/whatsappStore'
import { getWhatsAppConversations } from '@/lib/api/whatsapp'
import { Search } from 'lucide-react'
import { useDebouncedCallback } from 'use-debounce'

interface Props {
  conversations: Conversation[]
  activeLeadId: string | null
  onSelect: (leadId: string) => void
}

export const ConversationList = ({ conversations, activeLeadId, onSelect }: Props) => {
  const [search, setSearch] = useState('')
  const { setConversations, unreadCounts } = useWhatsAppStore()

  const doSearch = useDebouncedCallback(async (q: string) => {
    const res = await getWhatsAppConversations({ search: q, limit: 50 })
    setConversations(res.data.data.conversations)
  }, 300)

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value)
      doSearch(e.target.value)
    },
    [doSearch],
  )

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="p-3 border-b">
        <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={handleSearch}
            placeholder="Search by name or phone..."
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {conversations.map((conv) => (
          <ConversationItem
            key={conv.lead._id}
            conversation={conv}
            isActive={activeLeadId === conv.lead._id}
            unreadCount={unreadCounts[conv.lead._id] ?? 0}
            onClick={() => onSelect(conv.lead._id)}
          />
        ))}
        {conversations.length === 0 && (
          <p className="text-center text-sm text-gray-400 mt-8">No conversations yet</p>
        )}
      </div>
    </div>
  )
}
```

### `ConversationItem.tsx`

```tsx
// src/components/whatsapp/ConversationItem.tsx
import { Conversation } from '@/types/whatsapp'
import { formatDistanceToNow } from 'date-fns'

interface Props {
  conversation: Conversation
  isActive: boolean
  unreadCount: number
  onClick: () => void
}

export const ConversationItem = ({ conversation, isActive, unreadCount, onClick }: Props) => {
  const { lead, lastMessage } = conversation

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3 border-b hover:bg-gray-50 transition-colors text-left ${
        isActive ? 'bg-blue-50 border-l-2 border-l-blue-600' : ''
      }`}
    >
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
        <span className="text-green-700 font-semibold text-sm">
          {(lead.customerName || lead.customerPhone)[0].toUpperCase()}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start">
          <p className="font-medium text-sm truncate">{lead.customerName || lead.customerPhone}</p>
          {lastMessage && (
            <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
              {formatDistanceToNow(new Date(lastMessage.sentAt), { addSuffix: false })}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 truncate mt-0.5">
          {lastMessage?.body ?? lead.customerPhone}
        </p>
      </div>

      {/* Unread badge */}
      {unreadCount > 0 && (
        <span className="ml-1 min-w-[18px] h-[18px] bg-green-500 text-white text-xs font-bold rounded-full flex items-center justify-center flex-shrink-0">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}
```

### `ChatWindow.tsx`

```tsx
// src/components/whatsapp/ChatWindow.tsx
'use client'

import { useEffect, useRef, useCallback } from 'react'
import { getLeadMessages } from '@/lib/api/whatsapp'
import { useWhatsAppStore } from '@/store/whatsappStore'
import { MessageBubble } from './MessageBubble'
import { MessageInput } from './MessageInput'

interface Props {
  leadId: string
}

export const ChatWindow = ({ leadId }: Props) => {
  const { threads, threadsLoading, setThread, clearUnread } = useWhatsAppStore()
  const messages = threads[leadId] ?? []
  const loading = threadsLoading[leadId] ?? false
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const load = async () => {
      useWhatsAppStore.setState((s) => ({
        threadsLoading: { ...s.threadsLoading, [leadId]: true },
      }))
      const res = await getLeadMessages(leadId, { channel: 'whatsapp', limit: 100 })
      setThread(leadId, res.data.data.messages)
      clearUnread(leadId)
    }
    load()
  }, [leadId, setThread, clearUnread])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2">
        {messages.map((msg) => (
          <MessageBubble key={msg._id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <MessageInput leadId={leadId} />
    </div>
  )
}
```

### `MessageBubble.tsx`

```tsx
// src/components/whatsapp/MessageBubble.tsx
import { MessageLog } from '@/types/whatsapp'
import { MessageStatusIcon } from './MessageStatusIcon'
import { format } from 'date-fns'

interface Props {
  message: MessageLog
}

export const MessageBubble = ({ message }: Props) => {
  const isOutgoing = message.type === 'outgoing'

  return (
    <div className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[65%] rounded-2xl px-3 py-2 shadow-sm ${
          isOutgoing
            ? 'bg-[#dcf8c6] rounded-tr-sm'   /* WhatsApp green */
            : 'bg-white rounded-tl-sm border border-gray-100'
        }`}
      >
        {/* Media placeholder */}
        {message.messageType && message.messageType !== 'text' && message.messageType !== 'template' && (
          <div className="mb-1 text-xs bg-gray-100 rounded px-2 py-1 text-gray-500">
            [{message.messageType}]
          </div>
        )}

        {/* Body text */}
        <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>

        {/* Time + status */}
        <div className="flex items-center justify-end gap-1 mt-0.5">
          <span className="text-[10px] text-gray-400">
            {format(new Date(message.sentAt), 'HH:mm')}
          </span>
          {isOutgoing && message.deliveryStatus && (
            <MessageStatusIcon status={message.deliveryStatus} size={12} />
          )}
        </div>
      </div>
    </div>
  )
}
```

### `MessageStatusIcon.tsx`

```tsx
// src/components/whatsapp/MessageStatusIcon.tsx
import { Check, CheckCheck, Clock, X } from 'lucide-react'
import { DeliveryStatus } from '@/types/whatsapp'

interface Props {
  status: DeliveryStatus
  size?: number
}

// Mirrors WhatsApp Web status icons exactly
export const MessageStatusIcon = ({ status, size = 14 }: Props) => {
  switch (status) {
    case 'sent':
      return <Check size={size} className="text-gray-400" />
    case 'delivered':
      return <CheckCheck size={size} className="text-gray-400" />
    case 'read':
      return <CheckCheck size={size} className="text-blue-500" />
    case 'failed':
      return <X size={size} className="text-red-500" />
    default:
      return <Clock size={size} className="text-gray-300" />
  }
}
```

### `MessageInput.tsx`

```tsx
// src/components/whatsapp/MessageInput.tsx
'use client'

import { useState, useCallback, KeyboardEvent } from 'react'
import { sendWhatsAppMessage } from '@/lib/api/whatsapp'
import { useWhatsAppStore } from '@/store/whatsappStore'
import { Send } from 'lucide-react'

interface Props {
  leadId: string
}

export const MessageInput = ({ leadId }: Props) => {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const { conversations } = useWhatsAppStore()

  const lead = conversations.find((c) => c.lead._id === leadId)?.lead

  const send = useCallback(async () => {
    if (!text.trim() || !lead?.customerPhone || sending) return

    setSending(true)
    try {
      await sendWhatsAppMessage({
        to: lead.customerPhone.replace(/\D/g, ''),
        type: 'text',
        text: text.trim(),
        leadId,
      })
      setText('')
    } catch (err) {
      console.error('Failed to send:', err)
    } finally {
      setSending(false)
    }
  }, [text, lead, leadId, sending])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        send()
      }
    },
    [send],
  )

  return (
    <div className="border-t px-4 py-3 flex items-end gap-3 bg-gray-50">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Type a message..."
        rows={1}
        className="flex-1 resize-none rounded-full border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-green-400 bg-white max-h-32"
        style={{ overflowY: text.split('\n').length > 3 ? 'auto' : 'hidden' }}
      />
      <button
        onClick={send}
        disabled={!text.trim() || sending}
        className="w-10 h-10 rounded-full bg-green-500 hover:bg-green-600 disabled:opacity-40 flex items-center justify-center flex-shrink-0 transition-colors"
      >
        <Send className="w-4 h-4 text-white" />
      </button>
    </div>
  )
}
```

---

## 9. WhatsApp Settings (Connection Setup)

Add a WhatsApp section to your existing Settings page. Do not create a new settings page.

```tsx
// Add inside your existing settings page, after the Gmail/SMTP sections

'use client'
import { useState, useEffect } from 'react'
import { connectWhatsApp, disconnectWhatsApp, getWhatsAppStatus } from '@/lib/api/whatsapp'
import { WhatsAppConnection } from '@/types/whatsapp'

export const WhatsAppSettings = () => {
  const [connection, setConnection] = useState<WhatsAppConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    phoneNumberId: '',
    wabaId: '',
    displayPhoneNumber: '',
    accessToken: '',
    verifyToken: '',
    appSecret: '',
  })

  useEffect(() => {
    getWhatsAppStatus()
      .then((r) => setConnection(r.data.data.connection))
      .finally(() => setLoading(false))
  }, [])

  const handleConnect = async () => {
    await connectWhatsApp(form)
    const r = await getWhatsAppStatus()
    setConnection(r.data.data.connection)
  }

  const handleDisconnect = async () => {
    await disconnectWhatsApp()
    setConnection(null)
  }

  if (loading) return <div className="animate-pulse h-32 bg-gray-100 rounded-lg" />

  if (connection?.isActive) {
    return (
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <div>
              <p className="font-medium text-sm">WhatsApp Connected</p>
              <p className="text-xs text-gray-500">{connection.displayPhoneNumber}</p>
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            className="text-sm text-red-500 hover:underline"
          >
            Disconnect
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <h3 className="font-semibold text-sm">Connect WhatsApp Business</h3>
      <p className="text-xs text-gray-500">
        You need a Meta WhatsApp Business account. Get your credentials from the
        Meta Developer Dashboard → WhatsApp → API Setup.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {[
          { key: 'phoneNumberId', label: 'Phone Number ID' },
          { key: 'wabaId', label: 'WABA ID' },
          { key: 'displayPhoneNumber', label: 'Display Phone Number' },
          { key: 'accessToken', label: 'Access Token (Permanent)' },
          { key: 'verifyToken', label: 'Webhook Verify Token' },
          { key: 'appSecret', label: 'App Secret' },
        ].map(({ key, label }) => (
          <div key={key}>
            <label className="text-xs font-medium text-gray-600">{label}</label>
            <input
              type={key.includes('Token') || key.includes('Secret') ? 'password' : 'text'}
              value={form[key as keyof typeof form]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="w-full border rounded px-3 py-1.5 text-sm mt-1 outline-none focus:ring-2 focus:ring-green-400"
            />
          </div>
        ))}
      </div>
      <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-xs">
        <strong>Webhook URL to register in Meta Dashboard:</strong>
        <code className="block mt-1 bg-yellow-100 px-2 py-1 rounded">
          {process.env.NEXT_PUBLIC_API_URL}/api/webhooks/whatsapp
        </code>
        <p className="mt-1">Set the "Verify Token" to the same value you enter above.</p>
        <p className="mt-1">Subscribe to: <strong>messages</strong> field.</p>
      </div>
      <button
        onClick={handleConnect}
        className="w-full bg-green-600 text-white py-2 rounded-lg text-sm hover:bg-green-700 transition-colors"
      >
        Connect WhatsApp
      </button>
    </div>
  )
}
```

---

## 10. Workflow Catalogue Updates

The backend now includes two new WhatsApp workflow types. Your existing workflow catalogue UI will pick them up automatically if it renders from the API response. No frontend code change needed.

If you hardcode workflow types in the frontend, add:

```typescript
// In your workflow types or constants file
const WHATSAPP_WORKFLOW_TYPES = ['whatsapp_auto_reply', 'whatsapp_lead_trigger']

// For rendering icons/labels:
const WORKFLOW_ICONS: Record<string, string> = {
  // ... existing entries
  whatsapp_auto_reply: '💬',
  whatsapp_lead_trigger: '📲',
}
```

The `whatsapp_auto_reply` workflow has a `whatsappReplyText` config field. Extend your workflow editor to show a text area input for this field when `type === 'whatsapp_auto_reply'`.

---

## 11. Component Reference

| Component | File | Purpose |
|-----------|------|---------|
| `WhatsAppInbox` | `components/whatsapp/WhatsAppInbox.tsx` | Two-panel inbox container |
| `ConversationList` | `components/whatsapp/ConversationList.tsx` | Left panel with search |
| `ConversationItem` | `components/whatsapp/ConversationItem.tsx` | Single conversation row |
| `ChatWindow` | `components/whatsapp/ChatWindow.tsx` | Message thread for active lead |
| `MessageBubble` | `components/whatsapp/MessageBubble.tsx` | Individual message bubble |
| `MessageInput` | `components/whatsapp/MessageInput.tsx` | Text input + send button |
| `MessageStatusIcon` | `components/whatsapp/MessageStatusIcon.tsx` | Delivery tick icons |
| `WhatsAppSettings` | In settings page | Connection setup form |
| `CommunicationTimeline` | `components/leads/CommunicationTimeline.tsx` | Extended unified timeline |
| `TimelineItem` | `components/leads/TimelineItem.tsx` | Extended for both channels |

---

## 12. Event Handling Reference

### Socket.IO events emitted by the backend

| Event | Payload | When |
|-------|---------|------|
| `whatsapp:message:new` | `WaMessageNewEvent` | New incoming or outgoing WhatsApp message |
| `whatsapp:message:status` | `WaMessageStatusEvent` | Delivery status changed (sent→delivered→read) |
| `lead:new` | Lead object | New lead created (email or WhatsApp) |
| `notification:new` | Notification object | New in-app notification |

### Frontend → Backend (socket.emit)

| Event | Payload | Purpose |
|-------|---------|---------|
| `join` | `{ userId, organizationId }` | Join user/org rooms for targeted delivery |

### Send message flow

```
User types + hits Enter
  → MessageInput.send()
  → POST /api/whatsapp/send
  → Backend: Meta API → EmailLog created → socket emit
  → whatsappProcessingWorker skips (no incoming msg)
  → Store.addMessage() via socket event
  → ChatWindow re-renders
```

### Incoming message flow

```
Customer sends WA message
  → Meta → POST /api/webhooks/whatsapp
  → Backend validates HMAC
  → whatsappProcessingQueue.add()
  → Worker: find/create lead, create EmailLog
  → socket.emit('whatsapp:message:new')
  → Store.addMessage() in browser
  → ConversationList unread badge increments
  → ChatWindow auto-scrolls if open
```

---

## 13. Performance Best Practices

### Prevent unnecessary re-renders

```typescript
// Use Zustand selectors to subscribe to specific slices
const messages = useWhatsAppStore((s) => s.threads[leadId] ?? [])
// NOT: const { threads } = useWhatsAppStore() — this re-renders on any store update
```

### Virtualise long conversation lists

For inboxes with 100+ conversations, use `@tanstack/react-virtual`:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'

const rowVirtualizer = useVirtualizer({
  count: conversations.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 72,
})
```

### Message pagination

The API supports `page` and `limit`. Load last 100 messages initially, then load more on scroll-to-top:

```typescript
const [page, setPage] = useState(1)
// On scroll to top: setPage(p => p + 1) → fetch older messages → prepend to store
```

### Socket reconnection

Socket.IO handles reconnection automatically. Show a subtle banner when disconnected:

```tsx
const [connected, setConnected] = useState(true)
socket.on('connect', () => setConnected(true))
socket.on('disconnect', () => setConnected(false))

{!connected && (
  <div className="bg-yellow-100 text-yellow-800 text-xs text-center py-1">
    Reconnecting…
  </div>
)}
```

### Optimistic UI for sent messages

Add the message to the store immediately before the API call resolves, then update the `_id` and `whatsappMessageId` when the response arrives. This makes the UI feel instant.

```typescript
const tempId = `temp-${Date.now()}`
addMessage(leadId, { _id: tempId, ...tempMsg })  // optimistic

const res = await sendWhatsAppMessage(payload)

// Replace temp message with real one
updateMessageById(leadId, tempId, { _id: res.data.data.emailLogId })
```

---

## Environment Variables (Frontend)

```env
NEXT_PUBLIC_API_URL=https://api.yourapp.com
# Socket.IO connects to the same URL — no separate WS host needed
```

---

*End of FRONTEND_WHATSAPP_INTEGRATION.md*
