# Backend Changes — n8n + Email Template Integration

Backend stack: **Node.js / Express + MongoDB (Mongoose)**

This document lists every change the backend needs to support the template-assignment feature implemented in the frontend.

---

## 1. Mongoose Schema Change — `Workflow`

Add a typed `config` sub-schema to store the assigned template and email subject.

```js
// models/Workflow.js  — replace the existing config field

const WorkflowConfigSchema = new mongoose.Schema(
  {
    templateId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Template', default: null },
    templateName:    { type: String, default: null },
    subject:         { type: String, default: null },
    fallbackToGlobal:{ type: Boolean, default: true },
  },
  { _id: false, strict: false }   // strict: false preserves any extra keys from custom workflows
);

// Inside WorkflowSchema replace:
//   config: { type: Object, default: {} }
// with:
config: { type: WorkflowConfigSchema, default: () => ({}) },
```

---

## 2. New Endpoint — `PATCH /api/workflows/:id`

Update workflow metadata (name, description, webhookUrl, config). Does **not** touch n8n — config updates are local only.

```
PATCH /api/workflows/:id
Authorization: Bearer <token>
```

**Request Body** (all fields optional)

```json
{
  "name": "Auto Reply v2",
  "description": "Updated description",
  "webhookUrl": "https://n8n.boldme.site/webhook/new-id",
  "config": {
    "templateId": "65f1a2b3c4d5e6f7a8b9c0d1",
    "templateName": "Welcome Email — Moving",
    "subject": "We got your enquiry",
    "fallbackToGlobal": true
  }
}
```

**Response 200**

```json
{
  "success": true,
  "data": { "workflow": { ...updatedWorkflowObject } }
}
```

**Controller logic**

```js
const updateWorkflow = async (req, res) => {
  const workflow = await Workflow.findOne({ _id: req.params.id, userId: req.user._id });
  if (!workflow) return res.status(404).json({ success: false, message: 'Workflow not found' });

  const allowed = ['name', 'description', 'webhookUrl', 'config'];
  allowed.forEach(field => {
    if (req.body[field] !== undefined) {
      // Deep-merge config so partial updates don't wipe other keys
      if (field === 'config') {
        workflow.config = { ...workflow.config.toObject?.() ?? workflow.config, ...req.body.config };
      } else {
        workflow[field] = req.body[field];
      }
    }
  });

  await workflow.save();
  res.json({ success: true, data: { workflow } });
};
```

**Router line to add**

```js
router.patch('/:id', auth, updateWorkflow);
```

---

## 3. New Endpoint — `POST /api/templates/:id/render`

Renders a template's `htmlContent` by substituting `{{variable}}` placeholders with the provided values. Only `approved` templates can be rendered.

```
POST /api/templates/:id/render
Authorization: Bearer <token>
```

**Request Body**

```json
{
  "variables": {
    "customerName": "John Smith",
    "fromAddress": "123 Main St, London",
    "toAddress": "456 Oak Ave, Manchester",
    "movingDate": "2026-06-15",
    "services": "Packing, Loading, Unloading",
    "businessName": "RealFlow Movers",
    "emailSignature": "Best regards,\nThe RealFlow Team"
  }
}
```

**Response 200**

```json
{
  "success": true,
  "data": {
    "html": "<!DOCTYPE html>...(rendered)...",
    "subject": "We received your moving enquiry"
  }
}
```

**Response 404 / 403**

```json
{ "success": false, "message": "Template not found or not approved" }
```

**Controller logic**

```js
const renderTemplate = async (req, res) => {
  const template = await Template.findOne({
    _id: req.params.id,
    status: 'approved',
  });

  if (!template) {
    return res.status(404).json({ success: false, message: 'Template not found or not approved' });
  }

  const variables = req.body.variables ?? {};
  const html = template.htmlContent.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => String(variables[key] ?? '')
  );

  res.json({ success: true, data: { html } });
};
```

**Router line to add** (add before `router.get('/:id', ...)` to avoid route conflict)

```js
router.post('/:id/render', auth, renderTemplate);
```

---

## 4. Email Send Logic — Resolve Template Before Calling n8n

When an `auto_reply` workflow is triggered (lead arrives), the backend must:

1. Find the active `auto_reply` workflow for the user
2. Resolve the template: `config.templateId` → fallback to `Settings.autoReplyTemplate`
3. Render the HTML with lead variables
4. POST the rendered payload to `workflow.webhookUrl`

```js
// services/emailService.js  (or wherever auto-reply is triggered)

async function buildAutoReplyPayload(lead, workflow, settings) {
  let html = '';
  let subject = workflow.config?.subject || settings.autoReplySubject || 'Thank you for your enquiry';

  if (workflow.config?.templateId) {
    // Resolve from Template collection
    const template = await Template.findOne({
      _id: workflow.config.templateId,
      status: 'approved',
    });

    if (template) {
      html = template.htmlContent.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const vars = {
          customerName: lead.customerName,
          fromAddress: lead.fromAddress,
          toAddress: lead.toAddress,
          movingDate: lead.movingDate,
          services: (lead.services || []).join(', '),
          businessName: settings.businessName,
          emailSignature: settings.emailSignature,
        };
        return String(vars[key] ?? '');
      });
    }
  }

  // Fallback to global Settings template
  if (!html && settings.autoReplyTemplate) {
    html = settings.autoReplyTemplate
      .replace(/\{\{customerName\}\}/g, lead.customerName || '')
      .replace(/\{\{fromAddress\}\}/g, lead.fromAddress || '')
      .replace(/\{\{toAddress\}\}/g, lead.toAddress || '')
      .replace(/\{\{movingDate\}\}/g, lead.movingDate || '')
      .replace(/\{\{businessName\}\}/g, settings.businessName || '')
      .replace(/\{\{emailSignature\}\}/g, settings.emailSignature || '');
  }

  return {
    html,
    subject,
    to: lead.customerEmail,
    from: settings.gmailAddress,   // or however you store the sender address
    leadId: lead._id.toString(),
  };
}
```

---

## 5. Template Variable Reference

All supported `{{variables}}` that templates can use:

| Variable | Source | Availability |
|----------|--------|-------------|
| `{{customerName}}` | `Lead.customerName` | auto_reply, notification |
| `{{customerEmail}}` | `Lead.customerEmail` | auto_reply |
| `{{fromAddress}}` | `Lead.fromAddress` | auto_reply |
| `{{toAddress}}` | `Lead.toAddress` | auto_reply |
| `{{movingDate}}` | `Lead.movingDate` | auto_reply |
| `{{services}}` | `Lead.services` (joined) | auto_reply |
| `{{businessName}}` | `Settings.businessName` | both |
| `{{emailSignature}}` | `Settings.emailSignature` | both |
| `{{eventType}}` | notification event name | notification |
| `{{leadCount}}` | count (daily summary) | notification |
| `{{timestamp}}` | ISO date string | both |

---

## 6. n8n Workflow Payload — What Backend Sends to Webhook

After rendering, the backend POSTs this JSON to `Workflow.webhookUrl`:

```json
{
  "html": "<!DOCTYPE html>...(fully rendered HTML)...",
  "subject": "We received your moving enquiry",
  "to": "customer@example.com",
  "from": "business@gmail.com",
  "leadId": "65f1a2b3c4d5e6f7a8b9c0aa",
  "workflowId": "65f1a2b3c4d5e6f7a8b9c0bb"
}
```

The n8n workflow only needs:
- **Webhook node** — receives the above payload
- **Send Email node** — uses `{{ $json.html }}`, `{{ $json.subject }}`, `{{ $json.to }}`
- **HTTP Request node** — POSTs result back to `Settings.n8nWebhookUrl` for status tracking

No template logic lives inside n8n.

---

## 7. n8n Callback — Status Update

When n8n finishes sending the email it should POST back to your backend:

```
POST /api/webhooks/n8n-callback
```

```json
{
  "leadId": "65f1a2b3c4d5e6f7a8b9c0aa",
  "status": "sent",
  "error": null
}
```

The backend then sets `Lead.autoReplySent = true` and `Lead.autoReplySentAt = new Date()`.

---

## 8. Summary of Changes

| Change | File | Type |
|--------|------|------|
| Add `WorkflowConfigSchema` to Workflow model | `models/Workflow.js` | Schema update |
| `PATCH /api/workflows/:id` | `controllers/workflowController.js` + `routes/workflows.js` | New endpoint |
| `POST /api/templates/:id/render` | `controllers/templateController.js` + `routes/templates.js` | New endpoint |
| Resolve `config.templateId` in auto-reply trigger | `services/emailService.js` (or equivalent) | Logic update |
| Fallback chain: `templateId` → `Settings.autoReplyTemplate` | Same service | Logic update |
