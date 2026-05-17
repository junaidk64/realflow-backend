# Templates API — Backend Specification

Backend stack: **Node.js / Express + MongoDB (Mongoose)**

---

## MongoDB Schema

```js
// models/Template.js
const mongoose = require('mongoose');

const TemplateSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: [true, 'Template name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [300, 'Description cannot exceed 300 characters'],
      default: '',
    },

    htmlContent: {
      type: String,
      required: [true, 'HTML content is required'],
    },

    businessType: {
      type: String,
      enum: ['moving', 'real_estate', 'insurance', 'cleaning', 'legal', 'general'],
      required: true,
      index: true,
    },

    tags: {
      type: [String],
      default: [],
    },

    status: {
      type: String,
      enum: ['draft', 'pending', 'approved', 'rejected'],
      default: 'draft',
      index: true,
    },

    publishedAt: {
      type: Date,
      default: null,
    },

    rejectionReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true, // adds createdAt, updatedAt
  }
);

// Compound indexes for efficient queries
TemplateSchema.index({ userId: 1, status: 1 });
TemplateSchema.index({ userId: 1, businessType: 1 });
TemplateSchema.index({ status: 1, businessType: 1 }); // for public marketplace

module.exports = mongoose.model('Template', TemplateSchema);
```

---

## REST API Endpoints

Base URL: `/api/templates`

All endpoints require `Authorization: Bearer <accessToken>` header.

---

### 1. List User's Templates

```
GET /api/templates
```

Returns the authenticated user's own templates. Supports filtering and pagination.

**Query Parameters**

| Param          | Type   | Default  | Description                                    |
|----------------|--------|----------|------------------------------------------------|
| `status`       | string | —        | Filter by status: `draft\|pending\|approved\|rejected` |
| `businessType` | string | —        | Filter by: `moving\|real_estate\|insurance\|cleaning\|legal\|general` |
| `page`         | number | `1`      | Page number                                    |
| `limit`        | number | `20`     | Results per page (max 100)                     |

**Response 200**

```json
{
  "success": true,
  "data": {
    "templates": [
      {
        "_id": "65f1a2b3c4d5e6f7a8b9c0d1",
        "userId": "65f1a2b3c4d5e6f7a8b9c0aa",
        "name": "Welcome Email — Removals",
        "description": "Auto-reply for new moving enquiries",
        "htmlContent": "<!DOCTYPE html>...",
        "businessType": "moving",
        "tags": [],
        "status": "approved",
        "publishedAt": "2024-03-15T10:30:00.000Z",
        "rejectionReason": null,
        "createdAt": "2024-03-14T09:00:00.000Z",
        "updatedAt": "2024-03-15T10:30:00.000Z"
      }
    ],
    "total": 12,
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalPages": 1,
      "hasNext": false,
      "hasPrev": false
    }
  }
}
```

**Controller logic**

```js
const getTemplates = async (req, res) => {
  const { status, businessType, page = 1, limit = 20 } = req.query;

  const filter = { userId: req.user._id };
  if (status) filter.status = status;
  if (businessType) filter.businessType = businessType;

  const skip = (Number(page) - 1) * Number(limit);
  const [templates, total] = await Promise.all([
    Template.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(Number(limit)),
    Template.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      templates,
      total,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
        hasNext: skip + templates.length < total,
        hasPrev: page > 1,
      },
    },
  });
};
```

---

### 2. Get Single Template

```
GET /api/templates/:id
```

Returns one template. Users can only fetch their own templates.

**Response 200**

```json
{
  "success": true,
  "data": { "template": { ...templateObject } }
}
```

**Response 404**

```json
{ "success": false, "message": "Template not found" }
```

**Controller logic**

```js
const getTemplate = async (req, res) => {
  const template = await Template.findOne({ _id: req.params.id, userId: req.user._id });
  if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
  res.json({ success: true, data: { template } });
};
```

---

### 3. Create Template

```
POST /api/templates
```

Creates a new template with `status: "draft"`.

**Request Body**

```json
{
  "name": "Welcome Email — Removals",
  "description": "Auto-reply for new moving enquiries",
  "htmlContent": "<!DOCTYPE html><html>...</html>",
  "businessType": "moving",
  "tags": ["welcome", "auto-reply"]
}
```

| Field          | Required | Validation                          |
|----------------|----------|-------------------------------------|
| `name`         | Yes      | string, max 100 chars               |
| `description`  | No       | string, max 300 chars               |
| `htmlContent`  | Yes      | string, non-empty                   |
| `businessType` | Yes      | enum value                          |
| `tags`         | No       | array of strings                    |

**Response 201**

```json
{
  "success": true,
  "data": { "template": { ...templateObject } }
}
```

**Controller logic**

```js
const createTemplate = async (req, res) => {
  const { name, description, htmlContent, businessType, tags } = req.body;

  const template = await Template.create({
    userId: req.user._id,
    name,
    description,
    htmlContent,
    businessType,
    tags: tags || [],
    status: 'draft',
  });

  res.status(201).json({ success: true, data: { template } });
};
```

---

### 4. Update Template

```
PATCH /api/templates/:id
```

Updates a template. Only the owner can update. Only `draft` and `rejected` templates can be edited (cannot modify a `pending` or `approved` template — it must be re-submitted).

**Request Body** (all fields optional)

```json
{
  "name": "Updated Template Name",
  "description": "Updated description",
  "htmlContent": "<!DOCTYPE html>...",
  "businessType": "cleaning",
  "tags": ["new-tag"]
}
```

**Response 200**

```json
{
  "success": true,
  "data": { "template": { ...updatedTemplateObject } }
}
```

**Response 403**

```json
{ "success": false, "message": "Cannot edit a template that is pending review or approved" }
```

**Controller logic**

```js
const updateTemplate = async (req, res) => {
  const template = await Template.findOne({ _id: req.params.id, userId: req.user._id });
  if (!template) return res.status(404).json({ success: false, message: 'Template not found' });

  if (template.status === 'pending' || template.status === 'approved') {
    return res.status(403).json({ success: false, message: 'Cannot edit a template that is pending review or approved' });
  }

  const allowed = ['name', 'description', 'htmlContent', 'businessType', 'tags'];
  allowed.forEach(field => {
    if (req.body[field] !== undefined) template[field] = req.body[field];
  });

  // If rejected and re-edited, reset back to draft
  if (template.status === 'rejected') {
    template.status = 'draft';
    template.rejectionReason = null;
  }

  await template.save();
  res.json({ success: true, data: { template } });
};
```

---

### 5. Delete Template

```
DELETE /api/templates/:id
```

Permanently deletes a template. Only the owner can delete.

**Response 200**

```json
{ "success": true, "message": "Template deleted successfully" }
```

**Controller logic**

```js
const deleteTemplate = async (req, res) => {
  const template = await Template.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
  res.json({ success: true, message: 'Template deleted successfully' });
};
```

---

### 6. Submit Template for Review (Publish)

```
PATCH /api/templates/:id/publish
```

Submits a `draft` or `rejected` template for admin review. Status becomes `pending`.

**Response 200**

```json
{
  "success": true,
  "message": "Template submitted for review",
  "data": { "template": { ...templateObject, "status": "pending" } }
}
```

**Response 400**

```json
{ "success": false, "message": "Only draft or rejected templates can be submitted for review" }
```

**Controller logic**

```js
const publishTemplate = async (req, res) => {
  const template = await Template.findOne({ _id: req.params.id, userId: req.user._id });
  if (!template) return res.status(404).json({ success: false, message: 'Template not found' });

  if (!['draft', 'rejected'].includes(template.status)) {
    return res.status(400).json({
      success: false,
      message: 'Only draft or rejected templates can be submitted for review',
    });
  }

  template.status = 'pending';
  template.rejectionReason = null;
  await template.save();

  res.json({ success: true, message: 'Template submitted for review', data: { template } });
};
```

---

### 7. Get Approved Templates (Public Marketplace)

```
GET /api/templates/public
```

Returns only `approved` templates visible to all authenticated users. Used for a marketplace/gallery feature.

**Query Parameters**

| Param          | Type   | Default | Description                     |
|----------------|--------|---------|---------------------------------|
| `businessType` | string | —       | Filter by business type         |
| `page`         | number | `1`     | Page number                     |
| `limit`        | number | `20`    | Results per page                |

**Response 200**

```json
{
  "success": true,
  "data": {
    "templates": [ ...templateObjects ],
    "total": 45,
    "pagination": { ... }
  }
}
```

**Controller logic**

```js
const getPublicTemplates = async (req, res) => {
  const { businessType, page = 1, limit = 20 } = req.query;

  const filter = { status: 'approved' };
  if (businessType) filter.businessType = businessType;

  const skip = (Number(page) - 1) * Number(limit);
  const [templates, total] = await Promise.all([
    Template.find(filter)
      .select('-htmlContent') // exclude heavy field from list view
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Template.countDocuments(filter),
  ]);

  res.json({ success: true, data: { templates, total, pagination: { page, limit, totalPages: Math.ceil(total / limit) } } });
};
```

---

## Admin Endpoints

Base URL: `/api/admin/templates`

Requires `role: "admin"` on the authenticated user (middleware check).

---

### Admin: List All Pending Templates

```
GET /api/admin/templates?status=pending
```

Returns templates across all users, filtered by status for admin review.

---

### Admin: Approve Template

```
PATCH /api/admin/templates/:id/approve
```

**Response 200**

```json
{ "success": true, "message": "Template approved", "data": { "template": { ...templateObject } } }
```

**Controller logic**

```js
const approveTemplate = async (req, res) => {
  const template = await Template.findById(req.params.id);
  if (!template) return res.status(404).json({ success: false, message: 'Template not found' });

  template.status = 'approved';
  template.publishedAt = new Date();
  template.rejectionReason = null;
  await template.save();

  res.json({ success: true, message: 'Template approved', data: { template } });
};
```

---

### Admin: Reject Template

```
PATCH /api/admin/templates/:id/reject
```

**Request Body**

```json
{ "reason": "HTML contains external scripts which are not permitted." }
```

**Response 200**

```json
{ "success": true, "message": "Template rejected", "data": { "template": { ...templateObject } } }
```

**Controller logic**

```js
const rejectTemplate = async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ success: false, message: 'Rejection reason is required' });

  const template = await Template.findById(req.params.id);
  if (!template) return res.status(404).json({ success: false, message: 'Template not found' });

  template.status = 'rejected';
  template.rejectionReason = reason;
  await template.save();

  res.json({ success: true, message: 'Template rejected', data: { template } });
};
```

---

## Express Router Setup

```js
// routes/templates.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  publishTemplate,
  getPublicTemplates,
} = require('../controllers/templateController');
const {
  approveTemplate,
  rejectTemplate,
  adminListTemplates,
} = require('../controllers/adminTemplateController');

// Public marketplace (approved only)
router.get('/public', auth, getPublicTemplates);

// User CRUD
router.get('/',    auth, getTemplates);
router.post('/',   auth, createTemplate);
router.get('/:id', auth, getTemplate);
router.patch('/:id', auth, updateTemplate);
router.delete('/:id', auth, deleteTemplate);

// Submit for review
router.patch('/:id/publish', auth, publishTemplate);

// Admin
router.get('/admin/all',              auth, adminAuth, adminListTemplates);
router.patch('/admin/:id/approve',    auth, adminAuth, approveTemplate);
router.patch('/admin/:id/reject',     auth, adminAuth, rejectTemplate);

module.exports = router;
```

---

## Error Response Format

All errors follow this shape:

```json
{
  "success": false,
  "message": "Human-readable error message",
  "code": "OPTIONAL_ERROR_CODE",
  "errors": [
    { "field": "name", "message": "Name is required" }
  ]
}
```

| HTTP Status | Meaning                                    |
|-------------|--------------------------------------------|
| `400`       | Bad request / validation failure           |
| `401`       | Not authenticated                          |
| `403`       | Forbidden (not owner, or wrong role)       |
| `404`       | Template not found                         |
| `409`       | Conflict (e.g. duplicate name per user)    |
| `500`       | Internal server error                      |

---

## Status Transition Rules

```
draft ──► pending  (user submits for review)
pending ──► approved  (admin approves)
pending ──► rejected  (admin rejects)
rejected ──► draft  (user edits template → auto-reset)
rejected ──► pending  (user re-submits without editing)
```

Only `approved` templates appear in `/api/templates/public`.  
Users always see **all their own templates** regardless of status via `/api/templates`.
