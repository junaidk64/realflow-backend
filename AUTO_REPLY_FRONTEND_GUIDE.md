# Auto Reply Workflow — Frontend Integration Guide

This document describes every API contract, UI state requirement, validation rule, and error case
the frontend team needs to implement the AI ↔ Template toggle for the **Auto Reply Workflow**.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [API Endpoints](#api-endpoints)
3. [Settings UI State Requirements](#settings-ui-state-requirements)
4. [Validation Rules & UI Constraints](#validation-rules--ui-constraints)
5. [Error Handling & Edge Cases](#error-handling--edge-cases)
6. [React Integration Example](#react-integration-example)

---

## Architecture Overview

The Auto Reply Workflow (`type: "webhook_auto_reply"`) supports two mutually exclusive reply modes,
controlled by a single boolean flag in `workflow.config`:

| Flag | Mode | What happens |
|---|---|---|
| `config.useAiReply = true` | **AI Mode** | Claude generates a personalised subject + body from live lead data on every trigger |
| `config.useAiReply = false` (default) | **Template Mode** | The template at `config.templateId` is rendered with lead variables and dispatched |

Switching between modes is a single `PATCH` call — no workflow reinstall, no new records.

---

## API Endpoints

### 1. GET `/api/workflows` — List installed workflows

Returns all installed workflows for the authenticated organisation.

**Response shape (relevant fields)**

```json
{
  "success": true,
  "data": {
    "workflows": [
      {
        "_id": "6a1ae49bc3b62a51321ed1e0",
        "type": "webhook_auto_reply",
        "name": "Auto Reply Workflow",
        "isActive": false,
        "needsEmailTemplate": true,
        "config": {
          "templateId": null,
          "templateName": null,
          "subject": null,
          "fallbackToGlobal": true,
          "useAiReply": false
        }
      }
    ]
  }
}
```

---

### 2. POST `/api/workflows/install-template/auto-reply` — Install the workflow

One-time install per organisation. Returns `409` if already installed.

**Request:** no body required

**Success response `201`**

```json
{
  "success": true,
  "data": {
    "workflow": {
      "_id": "...",
      "type": "webhook_auto_reply",
      "isActive": false,
      "needsEmailTemplate": true,
      "config": {
        "templateId": null,
        "useAiReply": false
      }
    }
  }
}
```

---

### 3. PATCH `/api/workflows/:id` — Update config (mode switch + subject)

Use this to change `useAiReply`, `templateId`, `subject`, or `isActive` in a single call.

**Request body (all fields optional)**

```json
{
  "config": {
    "useAiReply": true
  }
}
```

```json
{
  "config": {
    "useAiReply": false,
    "templateId": "6a0f161b8a2e7798f59302d7",
    "subject": "Thanks for getting in touch!"
  }
}
```

**Activate + set mode in one call**

```json
{
  "isActive": true,
  "config": {
    "useAiReply": true
  }
}
```

**Success response `200`**

```json
{
  "success": true,
  "data": {
    "workflow": { "...updated document..." }
  }
}
```

**Error `400` — tried to activate Template mode without a template**

```json
{
  "success": false,
  "message": "Please select an email template or enable AI Reply before activating this workflow."
}
```

---

### 4. PATCH `/api/workflows/:id/template` — Convenience: assign template

Shortcut that writes `config.templateId` (and optional `config.subject`) without needing to build
the full config object. Does **not** change `useAiReply`.

**Request body**

```json
{
  "templateId": "6a0f161b8a2e7798f59302d7",
  "subject": "Thanks for reaching out!"
}
```

**Success response `200`**

```json
{
  "success": true,
  "data": { "workflow": { "..." } }
}
```

---

### 5. POST `/api/workflows/:id/toggle` — Enable / disable

Flips `isActive`. Returns `400` if toggling on without a valid reply mode configured.

**Request:** no body

**Error `400`** (Template mode, no template set)

```json
{
  "success": false,
  "message": "Please select an email template or enable AI Reply before activating this workflow."
}
```

---

## Settings UI State Requirements

The Auto Reply settings panel has **two mutually exclusive states**.
The toggle switch at the top switches between them.

### State A — AI Reply mode (`config.useAiReply = true`)

```
┌─────────────────────────────────────────────┐
│  Reply Mode                                 │
│  ○ Template  ●  AI (Claude)                 │
├─────────────────────────────────────────────┤
│  ✦ AI will automatically write a            │
│    personalised subject and body for every  │
│    new lead using the lead's own details.   │
│                                             │
│  No template required.                      │
├─────────────────────────────────────────────┤
│  Custom Subject (optional)                  │
│  [ AI will generate a subject — leave blank]│
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │  [Activate Workflow]                 │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

- The template picker **must be hidden** when `useAiReply = true`.
- The **Activate** button is always enabled once AI mode is selected.
- Optionally surface an estimated token cost notice ("~400 tokens per lead").

### State B — Template mode (`config.useAiReply = false`)

```
┌─────────────────────────────────────────────┐
│  Reply Mode                                 │
│  ●  Template  ○  AI (Claude)                │
├─────────────────────────────────────────────┤
│  Email Template *required                   │
│  ┌──────────────────────────────────────┐   │
│  │  [Select template ▾]                 │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  Subject (optional override)                │
│  ┌──────────────────────────────────────┐   │
│  │  Thanks for reaching out!            │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │  [Activate Workflow]  (disabled)     │   │
│  └──────────────────────────────────────┘   │
│  ⚠ Select a template to activate           │
└─────────────────────────────────────────────┘
```

- **Activate** button is **disabled** until a template is selected.
- When a template is selected, enable the button.

### Mode toggle behaviour

| Action | API call |
|---|---|
| Switch to AI mode | `PATCH /api/workflows/:id` `{ config: { useAiReply: true } }` |
| Switch to Template mode | `PATCH /api/workflows/:id` `{ config: { useAiReply: false } }` |

Do not call the API on every keystroke — debounce or call only on explicit Save/Activate.

---

## Validation Rules & UI Constraints

| Rule | Where enforced | Detail |
|---|---|---|
| Template required in Template mode | Server + client | `config.templateId` must be non-null when `useAiReply = false` and `isActive = true` |
| AI mode bypasses template requirement | Server | When `useAiReply = true`, `templateId` may be null |
| Modes are mutually exclusive | Client | Switching to AI clears the template picker selection visually (does not erase DB value) |
| Subject is optional in both modes | Client + server | When blank and in AI mode, Claude generates the subject |
| Singleton workflow | Server | Only one `webhook_auto_reply` per organisation — show existing record, not install button |
| `isActive` persists across mode switches | Server | Changing `config.useAiReply` alone does not deactivate the workflow |

---

## Error Handling & Edge Cases

| Scenario | Server response | Recommended UI behaviour |
|---|---|---|
| Activate Template mode with no template | `400` `"Please select an email template or enable AI Reply..."` | Show inline error under template picker |
| `ANTHROPIC_API_KEY` missing / expired | Auto-reply worker logs error; `Lead.autoReplySent` stays `false` | Surface in lead detail: "Auto-reply failed — contact support" |
| Claude API timeout / 5xx | Worker falls back to standard generated HTML and sends it | No user action needed; fallback email is sent |
| Claude returns malformed JSON | Worker uses raw text as body with a default subject | Silent fallback — no user action needed |
| Template deleted after assignment | `sendAutoReply` falls back to generated HTML | Consider showing a "Template missing" warning badge on the workflow card |
| Lead has no email address | Auto-reply silently skipped (`Lead.autoReplySent` stays `false`) | No UI action needed |
| Workflow not installed | `GET /api/workflows` returns no `webhook_auto_reply` record | Show "Install Workflow" CTA |
| Already installed (409 on re-install) | `409` with existing workflow in response body | Redirect to existing workflow settings |

---

## React Integration Example

```tsx
import React, { useEffect, useState } from 'react'

interface WorkflowConfig {
  templateId: string | null
  templateName: string | null
  subject: string | null
  useAiReply: boolean
}

interface Workflow {
  _id: string
  type: string
  isActive: boolean
  needsEmailTemplate: boolean
  config: WorkflowConfig
}

interface Template {
  _id: string
  name: string
}

const API = '/api'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...init,
  })
  const json = await res.json()
  if (!json.success) throw new Error(json.message ?? 'Request failed')
  return json.data as T
}

export function AutoReplySettings() {
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Local draft mirrors the config so the user can edit before saving
  const [useAiReply, setUseAiReply] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [subject, setSubject] = useState('')

  // ── Load workflow + templates on mount ──────────────────────────────────────
  useEffect(() => {
    Promise.all([
      apiFetch<{ workflows: Workflow[] }>('/workflows'),
      apiFetch<{ templates: Template[] }>('/templates'),
    ]).then(([wfData, tplData]) => {
      const wf = wfData.workflows.find((w) => w.type === 'webhook_auto_reply') ?? null
      setWorkflow(wf)
      setTemplates(tplData.templates)
      if (wf) {
        setUseAiReply(wf.config.useAiReply)
        setSelectedTemplateId(wf.config.templateId)
        setSubject(wf.config.subject ?? '')
      }
    })
  }, [])

  // ── Install workflow if not present ─────────────────────────────────────────
  const handleInstall = async () => {
    try {
      setSaving(true)
      setError(null)
      const { workflow: wf } = await apiFetch<{ workflow: Workflow }>(
        '/workflows/install-template/auto-reply',
        { method: 'POST' },
      )
      setWorkflow(wf)
      setUseAiReply(wf.config.useAiReply)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ── Save config changes ──────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!workflow) return
    if (!useAiReply && !selectedTemplateId) {
      setError('Select a template or switch to AI mode.')
      return
    }
    try {
      setSaving(true)
      setError(null)
      const { workflow: updated } = await apiFetch<{ workflow: Workflow }>(
        `/workflows/${workflow._id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            config: {
              useAiReply,
              templateId: useAiReply ? null : selectedTemplateId,
              subject: subject || null,
            },
          }),
        },
      )
      setWorkflow(updated)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ── Toggle active state ──────────────────────────────────────────────────────
  const handleToggle = async () => {
    if (!workflow) return
    try {
      setSaving(true)
      setError(null)
      const { workflow: updated } = await apiFetch<{ workflow: Workflow }>(
        `/workflows/${workflow._id}/toggle`,
        { method: 'POST' },
      )
      setWorkflow(updated)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // ── Derived state ────────────────────────────────────────────────────────────
  const canActivate = useAiReply || !!selectedTemplateId
  const isDirty =
    workflow &&
    (useAiReply !== workflow.config.useAiReply ||
      selectedTemplateId !== workflow.config.templateId ||
      (subject || null) !== workflow.config.subject)

  // ── Render ───────────────────────────────────────────────────────────────────
  if (!workflow) {
    return (
      <div>
        <p>Auto Reply is not installed yet.</p>
        <button onClick={handleInstall} disabled={saving}>
          {saving ? 'Installing…' : 'Install Auto Reply'}
        </button>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </div>
    )
  }

  return (
    <div>
      <h2>Auto Reply Workflow</h2>

      {/* Active status badge */}
      <p>
        Status:{' '}
        <strong style={{ color: workflow.isActive ? 'green' : 'grey' }}>
          {workflow.isActive ? 'Active' : 'Inactive'}
        </strong>
      </p>

      {/* Mode toggle */}
      <fieldset>
        <legend>Reply Mode</legend>
        <label>
          <input
            type="radio"
            checked={!useAiReply}
            onChange={() => setUseAiReply(false)}
          />
          {' Template'}
        </label>
        <label style={{ marginLeft: 16 }}>
          <input
            type="radio"
            checked={useAiReply}
            onChange={() => setUseAiReply(true)}
          />
          {' AI (Claude)'}
        </label>
      </fieldset>

      {/* Template picker — only shown in Template mode */}
      {!useAiReply && (
        <div>
          <label>
            Email Template <span style={{ color: 'red' }}>*</span>
            <select
              value={selectedTemplateId ?? ''}
              onChange={(e) => setSelectedTemplateId(e.target.value || null)}
            >
              <option value="">— Select a template —</option>
              {templates.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* AI mode description */}
      {useAiReply && (
        <p style={{ color: '#6b7280', fontSize: 14 }}>
          Claude will generate a personalised subject and body for every new lead
          using their enquiry details. No template required.
        </p>
      )}

      {/* Optional subject override */}
      <div>
        <label>
          Subject{useAiReply ? ' (optional — AI will generate if blank)' : ' (optional override)'}
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={useAiReply ? 'Leave blank for AI-generated subject' : 'e.g. Thanks for your enquiry!'}
          />
        </label>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {/* Save button */}
      {isDirty && (
        <button onClick={handleSave} disabled={saving || (!useAiReply && !selectedTemplateId)}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      )}

      {/* Activate / Deactivate */}
      <button
        onClick={handleToggle}
        disabled={saving || (!workflow.isActive && !canActivate)}
        style={{ marginLeft: 8 }}
      >
        {workflow.isActive ? 'Deactivate' : 'Activate'}
      </button>

      {!canActivate && !workflow.isActive && (
        <p style={{ color: '#b45309', fontSize: 13 }}>
          Select a template or switch to AI mode to activate.
        </p>
      )}
    </div>
  )
}
```

---

*Generated 2026-06-08 — RealFlow Backend v1.x*
