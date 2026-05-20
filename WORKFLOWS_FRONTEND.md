# Workflows — Frontend Integration Guide

## Overview

The workflow system uses a **catalogue + install + enable** model:

```
Catalogue (static, always visible)
    │
    ▼
Install  →  Workflow record created (isActive: false)
    │
    ▼
Enable   →  isActive: true  →  Backend feature runs
```

**No install = feature never runs.** This applies to all five backend-managed workflow types.
There is no legacy fallback via `settings.autoReply` or similar flags — the workflow record is
the single source of truth.

---

## Workflow Types

| type              | Singleton | Needs template | What it gates                         |
|-------------------|-----------|----------------|---------------------------------------|
| `lead_extraction` | yes       | no             | AI email-to-lead pipeline             |
| `auto_reply`      | yes       | **yes**        | Automatic reply emails to new leads   |
| `notification`    | yes       | no             | In-app new-lead notifications         |
| `spam_filtering`  | yes       | no             | Pre-extraction spam filter            |
| `daily_digest`    | yes       | no             | Morning email summary at 7 AM        |
| `custom`          | **no**    | no             | External webhook / n8n trigger        |

Singleton types can only be installed once per organisation. Custom workflows can be installed
any number of times.

---

## API Reference

### Base URL
All routes are under `/api/workflows` and require a valid `Authorization: Bearer <token>` header.

---

### 1. Get Catalogue

```
GET /api/workflows/catalogue
```

Returns all five catalogue items merged with the organisation's installed state.

**Response**
```json
{
  "success": true,
  "data": {
    "catalogue": [
      {
        "type": "lead_extraction",
        "name": "Lead Extraction",
        "description": "...",
        "needsEmailTemplate": false,
        "backendManaged": true,
        "defaultConfig": {},
        "installed": true,
        "workflow": {
          "_id": "...",
          "isActive": true,
          "config": {},
          "createdAt": "..."
        }
      },
      {
        "type": "auto_reply",
        "name": "Auto Reply",
        "description": "...",
        "needsEmailTemplate": true,
        "backendManaged": true,
        "defaultConfig": { "templateId": null, "subject": null },
        "installed": false,
        "workflow": null
      }
    ]
  }
}
```

**UI notes**
- Show all 5 catalogue items always, even if not installed.
- `installed: false` → show "Install" button.
- `installed: true, workflow.isActive: false` → show "Enable" toggle (off).
- `installed: true, workflow.isActive: true` → show "Enabled" toggle (on).
- If `needsEmailTemplate: true` and `workflow.config.templateId` is null → disable the Enable
  toggle and show "Select a template first".

---

### 2. Install a Workflow

```
POST /api/workflows/install/:type
```

Creates the workflow record for this organisation. The workflow starts **inactive**.

**URL params**
| param | values                                                                 |
|-------|------------------------------------------------------------------------|
| type  | `lead_extraction` \| `auto_reply` \| `notification` \| `spam_filtering` \| `daily_digest` |

**Response 201**
```json
{
  "success": true,
  "data": {
    "workflow": {
      "_id": "...",
      "type": "auto_reply",
      "name": "Auto Reply",
      "isActive": false,
      "needsEmailTemplate": true,
      "config": { "templateId": null, "subject": null }
    }
  }
}
```

**Response 409** — already installed
```json
{
  "success": false,
  "message": "Auto Reply is already installed for this organisation.",
  "data": { "workflow": { ... } }
}
```

**After install**: invalidate `['workflows', 'catalogue']` query.

---

### 3. Toggle a Workflow (Enable / Disable)

```
POST /api/workflows/:id/toggle
```

Flips `isActive`. No body required.

**Response 200**
```json
{
  "success": true,
  "data": {
    "workflow": { "_id": "...", "isActive": true, ... },
    "isActive": true
  }
}
```

**Response 400** — template required
```json
{
  "success": false,
  "message": "Please select an email template before enabling this workflow."
}
```

**UI flow for auto_reply toggle (enable)**:
1. Check `workflow.config.templateId` locally first.
2. If null → open template selector modal instead of calling toggle.
3. After template assigned → call toggle.

---

### 4. Assign Template to Auto Reply

```
PATCH /api/workflows/:id/template
```

Assigns an email template to the `auto_reply` workflow.

**Body**
```json
{
  "templateId": "664abc123...",
  "subject": "Thanks for reaching out!"
}
```

`subject` is optional — if omitted, the existing subject is kept.

**Response 200**
```json
{
  "success": true,
  "data": {
    "workflow": { "_id": "...", "config": { "templateId": "664abc123...", "subject": "..." } }
  }
}
```

**After assigning**: update local cache, do not call toggle automatically — let the user enable
the workflow separately.

---

### 5. Update a Workflow (name, description, config, webhookUrl)

```
PATCH /api/workflows/:id
```

**Body** (all optional)
```json
{
  "name": "My Workflow",
  "description": "...",
  "webhookUrl": "https://...",
  "isActive": false,
  "config": { "templateId": "...", "subject": "..." }
}
```

Setting `isActive: true` via this endpoint also validates the template requirement.

---

### 6. Uninstall a Workflow

```
DELETE /api/workflows/:id
```

Removes the workflow record. For custom/n8n workflows, also deletes it from n8n.

**Response 200**
```json
{ "success": true, "message": "Workflow uninstalled" }
```

---

### 7. List Installed Workflows (alternative to catalogue)

```
GET /api/workflows
```

Returns only installed workflow records (no catalogue metadata). Use `GET /catalogue` for the
merged view; use this endpoint if you need just the raw records.

---

### 8. Create a Custom (Webhook / n8n) Workflow

```
POST /api/workflows
```

Only for `type: "custom"`. Attempting to create a backend-managed type here returns 400.

**Body**
```json
{
  "name": "My CRM Webhook",
  "description": "Sends lead data to Salesforce",
  "webhookUrl": "https://hooks.my-crm.com/...",
  "n8nWorkflowJson": { ... }
}
```

---

### 9. Get Workflow Executions (n8n only)

```
GET /api/workflows/:id/executions
```

Returns execution history from n8n. Always returns `{ executions: [] }` for backend-managed
types (they don't use n8n).

---

## State Machine

```
not installed
      │
      │  POST /install/:type
      ▼
installed, isActive: false
      │                    ▲
      │  POST /:id/toggle  │  POST /:id/toggle
      ▼                    │
installed, isActive: true ─┘
      │
      │  DELETE /:id
      ▼
not installed
```

---

## Recommended React Query Setup

```typescript
// Query keys
const QUERY_KEYS = {
  catalogue: ['workflows', 'catalogue'] as const,
  installed: ['workflows', 'installed'] as const,
}

// Fetch catalogue (primary hook — use this on the Workflows page)
export function useWorkflowCatalogue() {
  return useQuery({
    queryKey: QUERY_KEYS.catalogue,
    queryFn: () => api.get('/api/workflows/catalogue').then(r => r.data.data.catalogue),
  })
}

// Install
export function useInstallWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (type: string) =>
      api.post(`/api/workflows/install/${type}`).then(r => r.data.data.workflow),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.catalogue }),
  })
}

// Toggle with optimistic update
export function useToggleWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/api/workflows/${id}/toggle`).then(r => r.data.data),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: QUERY_KEYS.catalogue })
      const prev = qc.getQueryData(QUERY_KEYS.catalogue)
      qc.setQueryData(QUERY_KEYS.catalogue, (old: CatalogueItem[]) =>
        old?.map(item =>
          item.workflow?._id === id
            ? { ...item, workflow: { ...item.workflow, isActive: !item.workflow.isActive } }
            : item
        )
      )
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(QUERY_KEYS.catalogue, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.catalogue }),
  })
}

// Assign template
export function useAssignTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, templateId, subject }: { id: string; templateId: string; subject?: string }) =>
      api.patch(`/api/workflows/${id}/template`, { templateId, subject }).then(r => r.data.data.workflow),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.catalogue }),
  })
}

// Uninstall
export function useUninstallWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/workflows/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.catalogue }),
  })
}
```

---

## TypeScript Types

```typescript
export interface WorkflowConfig {
  templateId: string | null
  templateName: string | null
  subject: string | null
  fallbackToGlobal: boolean
  [key: string]: unknown
}

export interface WorkflowRecord {
  _id: string
  type: WorkflowType
  name: string
  description: string
  isActive: boolean
  needsEmailTemplate: boolean
  config: WorkflowConfig
  webhookUrl: string
  triggerCount: number
  lastTriggered: string | null
  createdAt: string
  updatedAt: string
}

export type WorkflowType =
  | 'lead_extraction'
  | 'auto_reply'
  | 'notification'
  | 'spam_filtering'
  | 'daily_digest'
  | 'custom'

export interface CatalogueItem {
  type: WorkflowType
  name: string
  description: string
  needsEmailTemplate: boolean
  backendManaged: boolean
  defaultConfig: Record<string, unknown>
  installed: boolean
  workflow: WorkflowRecord | null
}
```

---

## Workflows Page Component Structure

```
WorkflowsPage
├── CatalogueSection              ← backend-managed workflows (from /catalogue)
│   └── WorkflowCard (×5)
│       ├── icon + name + description
│       ├── [Install] button      ← if not installed
│       ├── Toggle                ← if installed (disabled when needsEmailTemplate + no templateId)
│       ├── [Select Template]     ← if auto_reply installed + no templateId
│       └── [Uninstall]           ← if installed
│
└── CustomSection                 ← custom/n8n workflows
    ├── WorkflowCard (×n)
    └── [Add Custom Workflow] button
```

---

## WorkflowCard Props

```typescript
interface WorkflowCardProps {
  item: CatalogueItem
  onInstall: (type: WorkflowType) => void
  onToggle: (id: string) => void
  onAssignTemplate: (id: string) => void
  onUninstall: (id: string) => void
  isLoading?: boolean
}
```

---

## Auto Reply — Complete UI Flow

```
User visits Workflows page
        │
        ├─ auto_reply NOT installed
        │       └── Show [Install] button
        │               │
        │               ▼
        │           POST /install/auto_reply
        │               │
        │               ▼
        │           Card updates: installed, inactive, NO template
        │
        ├─ auto_reply installed, templateId: null
        │       └── Toggle is DISABLED
        │           Show banner: "Select a template to enable auto-reply"
        │           Show [Select Template] button
        │               │
        │               ▼
        │           Open TemplateSelectorModal (from /api/org-templates)
        │               │
        │               ▼
        │           PATCH /api/workflows/:id/template { templateId }
        │               │
        │               ▼
        │           Toggle becomes ENABLED
        │
        └─ auto_reply installed, templateId set, isActive: false
                └── User clicks toggle
                        │
                        ▼
                    POST /api/workflows/:id/toggle
                        │
                        ▼
                    isActive: true → backend starts sending replies
```

---

## Onboarding — Auto-Provisioning Defaults

On first visit to the Workflows page, check if any catalogue items have `installed: false`.
If the org has zero installed workflows, offer a one-click "Set up recommended workflows"
button that installs and enables the recommended set.

```typescript
const RECOMMENDED_DEFAULTS: WorkflowType[] = [
  'lead_extraction',
  'notification',
  'spam_filtering',
]

async function provisionDefaults(catalogue: CatalogueItem[]) {
  const toInstall = catalogue
    .filter(item => !item.installed && RECOMMENDED_DEFAULTS.includes(item.type as WorkflowType))

  for (const item of toInstall) {
    const { workflow } = await installWorkflow(item.type)
    await toggleWorkflow(workflow._id)   // enable immediately
  }

  // auto_reply and daily_digest are NOT in the defaults list because:
  //   auto_reply requires a template to be selected first
  //   daily_digest should be an explicit opt-in
}
```

After provisioning, call `queryClient.invalidateQueries({ queryKey: ['workflows', 'catalogue'] })`.

---

## Error Handling

| Status | Scenario                         | UI action                                                    |
|--------|----------------------------------|--------------------------------------------------------------|
| 400    | Unknown workflow type            | Should not happen — only offer types from catalogue          |
| 400    | Template required before enable  | Show inline error, open template selector modal              |
| 409    | Already installed                | Use the existing workflow from `data.workflow` — update cache |
| 404    | Workflow not found               | Refresh catalogue (may have been uninstalled elsewhere)      |
| 401    | Token expired                    | Redirect to login                                            |

For toggle errors, roll back optimistic update and surface the backend message:
```typescript
onError: (err, _id, ctx) => {
  if (ctx?.prev) qc.setQueryData(QUERY_KEYS.catalogue, ctx.prev)
  const msg = (err as AxiosError<{ message: string }>).response?.data?.message
    ?? 'Failed to update workflow'
  toast.error(msg)
}
```

---

## Feature Gate Summary (Backend Behaviour)

| Workflow          | Not installed | Installed + inactive | Installed + active |
|-------------------|--------------|----------------------|--------------------|
| lead_extraction   | ❌ No leads   | ❌ No leads           | ✅ Leads created    |
| spam_filtering    | ❌ No filter  | ❌ No filter          | ✅ Spam blocked     |
| notification      | ❌ No notifs  | ❌ No notifs          | ✅ Notifs sent      |
| auto_reply        | ❌ No reply   | ❌ No reply           | ✅ Reply sent       |
| daily_digest      | ❌ No digest  | ❌ No digest          | ✅ Digest sent      |

> **Important**: `lead_extraction` must be installed and enabled before any other workflow
> has effect — leads are the input to every downstream workflow.

---

## Migration Note for Existing Orgs

Existing organisations that were relying on `settings.autoReply = true` before this release
**will not receive auto-replies** until they install and enable the Auto Reply workflow.

Show a one-time migration banner to orgs that have `settings.autoReply = true` but no
installed `auto_reply` workflow:

```typescript
const hasAutoReplyEnabled = settings?.autoReply === true
const autoReplyInstalled = catalogue.find(c => c.type === 'auto_reply')?.installed

if (hasAutoReplyEnabled && !autoReplyInstalled) {
  // Show migration banner:
  // "Your auto-reply setting has been migrated to Workflows.
  //  Install the Auto Reply workflow and select a template to continue."
}
```
