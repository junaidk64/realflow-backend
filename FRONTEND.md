# RealFlow Frontend Implementation Guide

> Version: 2026-05-20 — covers email template system and workflow permissions.

---

## Table of Contents

1. [Overview of Changes](#1-overview-of-changes)
2. [API Reference](#2-api-reference)
3. [Email Templates — Org Copies](#3-email-templates--org-copies)
4. [Workflows — Permissions & Feature Toggles](#4-workflows--permissions--feature-toggles)
5. [Auto-Reply Workflow Integration](#5-auto-reply-workflow-integration)
6. [UI Component Specs](#6-ui-component-specs)
7. [Data Flow Diagrams](#7-data-flow-diagrams)
8. [State Management](#8-state-management)
9. [Error Handling](#9-error-handling)
10. [Migration Notes for Existing UIs](#10-migration-notes-for-existing-uis)

---

## 1. Overview of Changes

### What changed

| Area | Before | After |
|---|---|---|
| Email templates | User creates from scratch, goes through approval | System provides 3 defaults per business type; org clones + edits freely |
| Auto-reply | Controlled by `settings.autoReply` boolean | Controlled by **auto_reply workflow** (with template picker) |
| Spam filtering | Always on, no UI | Toggle via **spam_filtering workflow** |
| Notifications | Always on, no UI | Toggle via **notification workflow** |
| Daily digest | Controlled by `settings.notifications.dailySummary` | Also toggleable via **daily_digest workflow** |
| Workflow types | `lead_extraction`, `auto_reply`, `notification`, `custom` | + `spam_filtering`, `daily_digest` |

### New field on Workflow

```ts
needsEmailTemplate: boolean
// If true, the frontend MUST show a template picker.
// The workflow cannot be toggled ON without a templateId in config.
```

---

## 2. API Reference

All endpoints require `Authorization: Bearer <token>` header.

### 2.1 Org Email Templates

Base: `/api/org-templates`

| Method | Path | Description |
|---|---|---|
| `GET` | `/system` | List all system templates (read-only, filterable by `?businessType=moving`) |
| `GET` | `/` | List this org's editable copies (max 3) |
| `GET` | `/:id` | Get single org template |
| `POST` | `/` | Create a blank org template (from scratch) |
| `POST` | `/clone/:systemTemplateId` | Clone a system template into the org |
| `PATCH` | `/:id` | Update name / description / htmlContent / tags |
| `DELETE` | `/:id` | Delete an org template copy |
| `POST` | `/:id/reset` | Reset org copy back to the original system template HTML |

**GET /api/org-templates response:**
```json
{
  "success": true,
  "data": {
    "templates": [ /* array of ITemplate */ ],
    "remaining": 2,
    "limit": 3
  }
}
```

**PATCH /api/org-templates/:id — allowed fields only:**
```json
{
  "name": "My Custom Moving Reply",
  "description": "Our branded moving email",
  "htmlContent": "<html>...</html>",
  "tags": ["moving", "branded"]
}
```
> **DO NOT** send `businessType`, `isSystemTemplate`, or `organizationId` — these are ignored and cannot be changed.

### 2.2 Admin System Templates

Base: `/api/admin/templates/system` (admin role required)

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List all system templates |
| `POST` | `/` | Create a system template |
| `PATCH` | `/:id` | Update a system template |
| `DELETE` | `/:id` | Delete a system template |

### 2.3 Workflows

Base: `/api/workflows` (unchanged URLs, new fields)

**GET /api/workflows — response now includes:**
```json
{
  "type": "auto_reply",
  "needsEmailTemplate": true,
  "config": {
    "templateId": "abc123...",
    "templateName": "Moving — Standard",
    "subject": "Thank you for your enquiry"
  }
}
```

**GET /api/workflows/templates — returns full catalogue:**
```json
{
  "data": {
    "templates": [
      { "type": "lead_extraction", "name": "Lead Extraction", "needsEmailTemplate": false, "backendManaged": true },
      { "type": "auto_reply",      "name": "Auto Reply",       "needsEmailTemplate": true,  "backendManaged": true },
      { "type": "notification",    "name": "Notifications",    "needsEmailTemplate": false, "backendManaged": true },
      { "type": "spam_filtering",  "name": "Spam Filtering",   "needsEmailTemplate": false, "backendManaged": true },
      { "type": "daily_digest",    "name": "Daily Digest",     "needsEmailTemplate": false, "backendManaged": true },
      { "type": "custom",          "name": "Custom Webhook",   "needsEmailTemplate": false, "backendManaged": false }
    ]
  }
}
```

**PATCH /api/workflows/:id — to set a template:**
```json
{
  "config": {
    "templateId": "64abc...",
    "templateName": "Moving — Standard",
    "subject": "Thank you for your moving enquiry"
  }
}
```

**POST /api/workflows/:id/toggle — error when template not set:**
```json
{
  "success": false,
  "message": "Please select an email template before enabling this workflow."
}
```

---

## 3. Email Templates — Org Copies

### 3.1 Concept

```
System Templates (admin-created, read-only)
        ↓  clone
Org Template Copies (editable by business owner, max 3)
        ↓  selected in
Auto-Reply Workflow config.templateId
```

- System templates are shared across all orgs — they are **never** editable by business owners.
- Each org has up to **3 editable copies**. These copies live in the org's own namespace.
- Editing a copy never touches the system template.
- A copy can be **reset** back to the system original at any time.

### 3.2 Page: Email Templates (`/dashboard/templates`)

**Layout:**

```
┌─────────────────────────────────────────────────────┐
│  Email Templates                    [+ Add Template] │
│                                                      │
│  Your Templates (2 / 3 used)                         │
│  ┌──────────────────┐ ┌──────────────────┐           │
│  │ Moving — Standard│ │ Moving — Premium │           │
│  │ businessType:    │ │ businessType:    │           │
│  │  moving          │ │  moving          │           │
│  │ [Edit] [Reset]   │ │ [Edit] [Reset]   │           │
│  │ [Delete]         │ │ [Delete]         │           │
│  └──────────────────┘ └──────────────────┘           │
│                                                      │
│  Browse System Templates (read-only)                 │
│  Filter: [All] [Moving] [Real Estate] [Insurance]    │
│          [Cleaning] [Legal] [General]                │
│  ┌──────────────────┐ ┌──────────────────┐  ...      │
│  │ Moving — Standard│ │ Moving — Premium │           │
│  │ (system)         │ │ (system)         │           │
│  │ [Preview] [Clone]│ │ [Preview] [Clone]│           │
│  └──────────────────┘ └──────────────────┘           │
└─────────────────────────────────────────────────────┘
```

**Rules to enforce in UI:**
1. If `remaining === 0` → disable the `[+ Add Template]` and all `[Clone]` buttons; show badge "3/3 used".
2. `[Clone]` should be disabled for a system template that the org already has a copy of (compare `systemTemplateId`).
3. `[Reset]` only appears on templates that have a `systemTemplateId` (i.e., cloned from system). Show a confirmation dialog: "This will replace your current HTML with the original system template. Your customisations will be lost."
4. Do NOT allow changing `businessType` when editing — it is locked to the value inherited from the system template (or chosen at creation time).

### 3.3 Template Editor

Open in a modal or dedicated route `/dashboard/templates/:id/edit`.

**Fields:**
- **Name** — text input (max 100 chars)
- **Description** — textarea (max 300 chars)
- **HTML Content** — a rich HTML editor (CodeMirror, Monaco, or a WYSIWYG)
  - Show a "Preview" tab that renders the HTML with sample variables injected:
    ```
    customerName = "Jane Smith"
    businessName = your org's business name
    emailSignature = your org's email signature from Settings
    ```
- **Tags** — optional chip input

**Available template variables (show as a reference panel beside the editor):**

| Variable | Description |
|---|---|
| `{{customerName}}` | Lead's full name |
| `{{customerEmail}}` | Lead's email address |
| `{{customerPhone}}` | Lead's phone number |
| `{{businessName}}` | Your business name (from Settings) |
| `{{emailSignature}}` | Your email signature (from Settings) |
| `{{fromAddress}}` | Moving from (moving businesses) |
| `{{toAddress}}` | Moving to (moving businesses) |
| `{{movingDate}}` | Moving date (moving businesses) |
| `{{services}}` | Requested services (moving businesses) |
| `{{timestamp}}` | ISO timestamp of when the email was sent |

**Save flow:**
```
User edits → clicks Save → PATCH /api/org-templates/:id → show success toast
```

### 3.4 Fetching Logic (React Query / SWR example)

```ts
// Org's templates
const { data } = useQuery(['org-templates'], () =>
  fetch('/api/org-templates').then(r => r.json())
)

// System templates (for browsing)
const { data: systemTemplates } = useQuery(
  ['system-templates', selectedBusinessType],
  () => fetch(`/api/org-templates/system?businessType=${selectedBusinessType}`).then(r => r.json())
)
```

---

## 4. Workflows — Permissions & Feature Toggles

### 4.1 Concept

Every backend feature (auto-reply, spam filter, notifications, daily digest) is now represented as a **Workflow** record. Toggling the workflow on/off controls the feature.

**Default behaviour (no workflow record in DB):** feature runs as before (on).

**Explicit workflow record:**
- `isActive: true` → feature is on
- `isActive: false` → feature is off

### 4.2 Page: Workflows (`/dashboard/workflows`)

The page should display **all** workflow types, including the backend-managed ones. Show them as toggleable cards.

```
┌─────────────────────────────────────────────────────────┐
│  Workflows                              [+ Add Workflow] │
│                                                         │
│  Backend Automations                                     │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 🔍 Lead Extraction                 [●──] ON      │    │
│  │ Automatically extract leads from emails with AI  │    │
│  │ Type: backend-managed                            │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ↩ Auto Reply                       [●──] ON      │    │
│  │ Sends auto-reply using: Moving — Standard        │    │
│  │ [Change Template]                                │    │
│  │ Type: backend-managed · Requires template        │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 🔔 Notifications                   [──●] OFF     │    │
│  │ Push alerts for new leads                        │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 🛡 Spam Filtering                  [●──] ON      │    │
│  │ Filter junk before lead extraction               │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 📊 Daily Digest                    [●──] ON      │    │
│  │ Daily email summary at 7 AM                      │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Custom Integrations                                     │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ⚡ My CRM Sync             Triggers: 142   [●──]  │    │
│  │ Webhook: https://n8n.example.com/hook/abc        │    │
│  │ [Edit] [Delete]                                  │    │
│  └─────────────────────────────────────────────────┘    │
│  [+ Add Custom Webhook]                                  │
└─────────────────────────────────────────────────────────┘
```

### 4.3 On-boarding: Provisioning Default Workflows

When a new user/org first visits the Workflows page, the backend may return an **empty array** (no workflows created yet). In this case the UI should:

1. Call `GET /api/workflows/templates` to get the canonical list of all types.
2. Show each backend-managed type as a "virtual" card with `isActive: true` (default on).
3. When the user first toggles one, create it: `POST /api/workflows` with `{ type, name, isActive: false }`.

**Alternatively**, you can auto-provision all 5 backend workflows on first page load:

```ts
async function provisionDefaultWorkflows(existingWorkflows: Workflow[]) {
  const existingTypes = new Set(existingWorkflows.map(w => w.type))
  const backendTypes = [
    { type: 'lead_extraction', name: 'Lead Extraction' },
    { type: 'auto_reply',      name: 'Auto Reply',     needsEmailTemplate: true },
    { type: 'notification',    name: 'Notifications' },
    { type: 'spam_filtering',  name: 'Spam Filtering' },
    { type: 'daily_digest',    name: 'Daily Digest' },
  ]

  for (const wf of backendTypes) {
    if (!existingTypes.has(wf.type)) {
      await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...wf, isActive: true }),
      })
    }
  }
}
```

Call this once after the initial GET on the workflows page.

### 4.4 Toggle Behaviour Rules

| Workflow type | `needsEmailTemplate` | Toggle ON behaviour |
|---|---|---|
| `lead_extraction` | false | Toggle immediately |
| `auto_reply` | **true** | Open template picker first → then toggle |
| `notification` | false | Toggle immediately |
| `spam_filtering` | false | Toggle immediately |
| `daily_digest` | false | Toggle immediately |
| `custom` | false | Toggle immediately (also calls n8n activate) |

**Auto-reply toggle flow:**

```
User clicks toggle ON for auto_reply workflow
  ↓
Check: does workflow.config.templateId exist?
  YES → POST /api/workflows/:id/toggle
  NO  → Open "Select Template" modal
          ↓
        User picks from org templates
          ↓
        PATCH /api/workflows/:id { config: { templateId, templateName, subject } }
          ↓
        POST /api/workflows/:id/toggle
```

---

## 5. Auto-Reply Workflow Integration

### 5.1 Complete Auto-Reply Setup Flow

```
Settings Page                     Workflows Page           Templates Page
─────────────                     ──────────────           ──────────────
[set businessName]                 [enable auto_reply]      [clone/edit template]
[set emailSignature]                     ↓                        ↓
[set autoReplySubject]         [select template modal]    [customise HTML]
                                         ↓
                               config.templateId saved
                                         ↓
                               workflow toggled ON
                                         ↓
                  Backend: incoming email → lead extracted
                                         ↓
                  Backend: auto-reply sent using org template HTML
                           with {{customerName}}, {{businessName}}, etc. injected
```

### 5.2 Template Selector Modal

When `needsEmailTemplate: true` and the user clicks to enable:

```
┌────────────────────────────────────────────────┐
│  Select Auto-Reply Template                  ✕ │
│                                                │
│  Choose which email template to send to leads. │
│                                                │
│  ○  Moving — Standard                          │
│     "We've received your moving request..."    │
│     [Preview]                                  │
│                                                │
│  ○  Moving — Premium White Glove               │
│     "Your premium move starts here..."         │
│     [Preview]                                  │
│                                                │
│  Custom subject (optional):                    │
│  [Thank you for your moving enquiry!_____]     │
│                                                │
│  Can't find the right template?                │
│  [Go to Email Templates →]                     │
│                                                │
│            [Cancel]  [Save & Enable Workflow]  │
└────────────────────────────────────────────────┘
```

- Only show **org's own template copies** (from `GET /api/org-templates`), not system templates.
- If the org has 0 templates, show: "You don't have any email templates yet. [Create one →]" with a link to `/dashboard/templates`.
- Template preview should render the HTML in an iframe with sample data substituted.

---

## 6. UI Component Specs

### 6.1 WorkflowCard Component

```tsx
interface WorkflowCardProps {
  workflow: Workflow
  onToggle: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onChangeTemplate: (id: string) => void
}
```

**Render logic:**

```tsx
// Show the currently selected template name if auto_reply
{workflow.type === 'auto_reply' && workflow.config?.templateName && (
  <span>Using: <strong>{workflow.config.templateName}</strong></span>
)}

// Show template required badge
{workflow.needsEmailTemplate && !workflow.config?.templateId && (
  <Badge color="orange">Template required</Badge>
)}

// Disable toggle button if template required but not set
<Toggle
  checked={workflow.isActive}
  disabled={workflow.needsEmailTemplate && !workflow.config?.templateId}
  onChange={() => handleToggle(workflow)}
/>

// backendManaged workflows have no Edit/Delete buttons (or grey them out)
{!workflow.backendManaged && (
  <>
    <Button onClick={() => onEdit(workflow.id)}>Edit</Button>
    <Button onClick={() => onDelete(workflow.id)} variant="danger">Delete</Button>
  </>
)}
```

### 6.2 OrgTemplateCard Component

```tsx
interface OrgTemplateCardProps {
  template: Template
  onEdit: () => void
  onDelete: () => void
  onReset?: () => void  // only if template.systemTemplateId is set
}
```

**businessType badge colours:**

| businessType | Colour |
|---|---|
| moving | Blue |
| real_estate | Green |
| insurance | Purple |
| cleaning | Yellow |
| legal | Red |
| general | Gray |

### 6.3 SystemTemplateCard Component (browse panel)

```tsx
interface SystemTemplateCardProps {
  template: Template
  alreadyCloned: boolean   // org already has a copy of this one
  atLimit: boolean         // org is at 3/3 limit
  onPreview: () => void
  onClone: () => void
}

// Clone button states:
// alreadyCloned → disabled, label "Already added"
// atLimit → disabled, label "Limit reached (3/3)"
// else → enabled, label "Add to My Templates"
```

---

## 7. Data Flow Diagrams

### 7.1 Template Inheritance

```
Admin creates System Template
  isSystemTemplate: true
  organizationId: null
  htmlContent: "default HTML with {{vars}}"
        │
        ▼ org clicks [Clone]
Org Template Copy
  isSystemTemplate: false
  organizationId: "org123"
  systemTemplateId: "systemTemplate._id"   ← reference back
  htmlContent: "same as system (editable)"
        │
        ▼ org edits
Org Template Copy (modified)
  htmlContent: "customised HTML"
  systemTemplate: UNCHANGED ✓
```

### 7.2 Auto-Reply Email Pipeline

```
Incoming Gmail
    │
    ▼
Lead Extraction Worker (BullMQ)
    │
    ▼ look up org workflows
Is auto_reply workflow active?
    ├── YES, with templateId → autoReplyQueue.add({ templateId })
    ├── YES, no templateId → (blocked by backend, toggle would have failed)
    └── NO, but settings.autoReply = true → autoReplyQueue.add({ templateId: null })
    │
    ▼
Auto Reply Worker
    │
    ├── templateId set? → fetch org template → inject vars → send
    └── no templateId → generateAutoReplyHTML() → send
```

### 7.3 Workflow Feature Gate

```
Lead captured
    │
    ├── spam_filtering workflow exists?
    │     ├── YES, active → run spam filter
    │     ├── YES, inactive → SKIP spam filter
    │     └── NO (never created) → run spam filter (default on)
    │
    ├── notification workflow exists?
    │     ├── YES, active → createNotification()
    │     ├── YES, inactive → SKIP notification
    │     └── NO → createNotification() (default on)
    │
    └── auto_reply workflow active → queue auto-reply
        custom workflow active + webhookUrl → trigger n8n
```

---

## 8. State Management

### 8.1 React Query Keys

```ts
const QUERY_KEYS = {
  workflows: ['workflows'],
  workflowTemplates: ['workflows', 'templates'],
  orgTemplates: ['org-templates'],
  orgTemplate: (id: string) => ['org-templates', id],
  systemTemplates: (businessType?: string) => ['org-templates', 'system', businessType],
}
```

### 8.2 Optimistic Toggle

Implement optimistic updates for workflow toggles so the UI responds instantly:

```ts
const toggleMutation = useMutation(
  (workflowId: string) => fetch(`/api/workflows/${workflowId}/toggle`, { method: 'POST' }),
  {
    onMutate: async (workflowId) => {
      await queryClient.cancelQueries(QUERY_KEYS.workflows)
      const previous = queryClient.getQueryData(QUERY_KEYS.workflows)
      queryClient.setQueryData(QUERY_KEYS.workflows, (old: WorkflowList) => ({
        ...old,
        workflows: old.workflows.map(w =>
          w._id === workflowId ? { ...w, isActive: !w.isActive } : w
        ),
      }))
      return { previous }
    },
    onError: (_err, _id, context) => {
      queryClient.setQueryData(QUERY_KEYS.workflows, context?.previous)
    },
    onSettled: () => queryClient.invalidateQueries(QUERY_KEYS.workflows),
  }
)
```

---

## 9. Error Handling

### 9.1 Template limit error

```json
{ "success": false, "message": "You can only have 3 email templates. Delete one to add another." }
```
→ Show a toast with a link: "Manage templates →"

### 9.2 Clone duplicate error

```json
{ "success": false, "message": "You already have a copy of this template. Edit the existing one instead." }
```
→ Show inline error on the clone button; highlight the existing copy.

### 9.3 Toggle without template

```json
{ "success": false, "message": "Please select an email template before enabling this workflow." }
```
→ Open the template selector modal automatically.

### 9.4 System template not found (on reset)

```json
{ "success": false, "message": "Original system template no longer exists" }
```
→ Show: "The original system template was removed by the admin. You can continue using your current version or delete this template and add a new one."

---

## 10. Migration Notes for Existing UIs

### Settings page (`/dashboard/settings`)

- The `autoReply` toggle in Settings can remain as a fallback control but add a note: **"For template-based auto-replies, configure the Auto-Reply Workflow instead."**
- Do not remove the `settings.autoReply` field — it is the legacy fallback path.

### Old Template page (`/dashboard/templates`)

If you have an existing templates page for the public template marketplace (submit → pending → approved), keep it. It is a **separate flow** from org email templates:

| Page | Purpose |
|---|---|
| `/dashboard/templates` | Public marketplace — submit custom templates for admin approval, share with community |
| `/dashboard/email-templates` | **NEW** — org's private email copies for auto-reply |

Route the new org template management to a **separate** page/section to avoid confusion.

### Workflows page

- Remove any hard-coded list of workflow types. Always derive the list from `GET /api/workflows/templates`.
- Add `needsEmailTemplate` check to the toggle handler.
- Show `backendManaged` flag — backend-managed workflows should not have Edit/Delete buttons or an n8n config section.

---

## Quick-Start Checklist for Frontend Dev

- [ ] Add `GET /api/org-templates/system` call + browseable system template grid
- [ ] Add `GET /api/org-templates` call + editable org template cards (max 3 badge)
- [ ] Implement Clone, Edit, Reset, Delete for org templates
- [ ] Build HTML template editor with live preview and variable reference panel
- [ ] Update workflows page to fetch `/api/workflows/templates` for the type list
- [ ] Add `needsEmailTemplate` guard to toggle handler (open template picker if not set)
- [ ] Build template selector modal for auto_reply workflow
- [ ] Show `config.templateName` on auto_reply workflow card
- [ ] Provision default backend workflows if none exist yet
- [ ] Add `backendManaged` flag to hide Edit/Delete on backend-managed workflow cards
- [ ] Implement optimistic toggle updates
- [ ] Test: org edit does not change system template (verify via `GET /api/org-templates/system`)
- [ ] Test: toggle auto_reply without template → get 400 → modal opens
- [ ] Test: 4th clone attempt → 400 error → toast with limit message
