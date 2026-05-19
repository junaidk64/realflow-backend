# User Management — Full Backend Spec

This section covers the multi-user / team management feature added to the frontend. The frontend pages are at `/users`; they are visible only to users with `role: 'root'` or `role: 'admin'`.

---

## New Schemas

### Organization

```js
// models/Organization.js
{
  _id: ObjectId,
  name: String,           // business name, copied from Settings.businessName
  ownerId: ObjectId,      // ref: User — the root user
  createdAt: Date,
  updatedAt: Date,
}
```

### User (extended)

Add these fields to the existing User schema:

```js
// Add to existing User schema:
role:           { type: String, enum: ['root','admin','manager','member'], default: 'member' },
permissions:    [{ type: String }],    // empty = use role defaults
organizationId: { type: ObjectId, ref: 'Organization' },
invitedBy:      { type: ObjectId, ref: 'User', default: null },
```

**Migration note:** Existing users (Google OAuth) should get `role: 'root'` and have a new Organization document created for them. Run this once:

```js
// One-time migration script
const users = await User.find({ organizationId: null });
for (const user of users) {
  const org = await Organization.create({ name: 'My Business', ownerId: user._id });
  await User.findByIdAndUpdate(user._id, { organizationId: org._id, role: 'root' });
}
```

### Invitation

```js
// models/Invitation.js
{
  _id: ObjectId,
  email:          { type: String, required: true },
  role:           { type: String, enum: ['admin','manager','member'], required: true },
  permissions:    [{ type: String }],   // optional override; empty = use role defaults
  organizationId: { type: ObjectId, ref: 'Organization', required: true },
  invitedBy:      { type: ObjectId, ref: 'User', required: true },
  token:          { type: String, unique: true },   // UUID v4
  status:         { type: String, enum: ['pending','accepted','expired','revoked'], default: 'pending' },
  expiresAt:      { type: Date },    // now + 7 days
  createdAt:      Date,
  updatedAt:      Date,
}
```

**Indexes:**
- `{ token: 1 }` — unique
- `{ email: 1, organizationId: 1 }`
- `{ expiresAt: 1, expireAfterSeconds: 0 }` — TTL (optional, or handle via cron)

---

## RBAC — Role Hierarchy & Default Permissions

### Role Hierarchy

| Role | Level | Who |
|------|-------|-----|
| `root` | 4 | Business owner — first Google sign-in. Cannot be deleted or have role changed. |
| `admin` | 3 | Can manage team members, all features except org-wide settings. |
| `manager` | 2 | Can work leads, workflows, templates. Cannot manage users. |
| `member` | 1 | View-only access to leads, templates, logs. |

### Default Permissions per Role

| Permission | root | admin | manager | member |
|-----------|:----:|:-----:|:-------:|:------:|
| `users:view` | ✅ | ✅ | | |
| `users:invite` | ✅ | ✅ | | |
| `users:edit` | ✅ | ✅ | | |
| `users:delete` | ✅ | ✅ | | |
| `leads:view` | ✅ | ✅ | ✅ | ✅ |
| `leads:create` | ✅ | ✅ | ✅ | |
| `leads:edit` | ✅ | ✅ | ✅ | |
| `leads:delete` | ✅ | ✅ | | |
| `workflows:view` | ✅ | ✅ | ✅ | |
| `workflows:manage` | ✅ | ✅ | | |
| `templates:view` | ✅ | ✅ | ✅ | ✅ |
| `templates:manage` | ✅ | ✅ | | |
| `settings:view` | ✅ | ✅ | ✅ | |
| `settings:manage` | ✅ | | | |
| `logs:view` | ✅ | ✅ | ✅ | ✅ |

### Backend Middleware

```js
// middleware/requirePermission.js
const ROLE_DEFAULT_PERMISSIONS = {
  root:    ['users:view','users:invite','users:edit','users:delete','leads:view','leads:create','leads:edit','leads:delete','workflows:view','workflows:manage','templates:view','templates:manage','settings:view','settings:manage','logs:view'],
  admin:   ['users:view','users:invite','users:edit','users:delete','leads:view','leads:create','leads:edit','leads:delete','workflows:view','workflows:manage','templates:view','templates:manage','settings:view','logs:view'],
  manager: ['leads:view','leads:create','leads:edit','workflows:view','templates:view','settings:view','logs:view'],
  member:  ['leads:view','templates:view','logs:view'],
};

function requirePermission(permission) {
  return (req, res, next) => {
    const user = req.user;
    const effective = user.permissions?.length
      ? user.permissions
      : (ROLE_DEFAULT_PERMISSIONS[user.role] || []);
    if (!effective.includes(permission)) {
      return res.status(403).json({ success: false, message: 'Forbidden', code: 'FORBIDDEN' });
    }
    next();
  };
}

// Usage:
router.get('/leads', requirePermission('leads:view'), leadsController.list);
router.delete('/leads/:id', requirePermission('leads:delete'), leadsController.delete);
```

**Important:** Add `organizationId` to all data queries to enforce tenant isolation:

```js
// Every data query must scope to the user's org:
const leads = await Lead.find({ organizationId: req.user.organizationId, ...filters });
```

---

## New API Endpoints

### `GET /api/users`

Returns all team members in the caller's organization.

**Auth:** admin+
**Response:**
```json
{
  "success": true,
  "data": {
    "members": [
      {
        "_id": "...",
        "name": "Jane Doe",
        "email": "jane@company.com",
        "avatar": "https://...",
        "role": "manager",
        "permissions": [],
        "isActive": true,
        "lastLogin": "2026-05-18T10:00:00Z",
        "invitedBy": "...",
        "createdAt": "2026-04-01T00:00:00Z",
        "updatedAt": "2026-05-18T10:00:00Z"
      }
    ]
  }
}
```

---

### `POST /api/users/invite`

Sends an invitation email to a new team member.

**Auth:** admin+
**Body:**
```json
{
  "email": "newmember@company.com",
  "role": "manager",
  "permissions": []
}
```

**Backend actions:**
1. Check no existing user/invitation with that email in org.
2. Create `Invitation` document with `token: uuidv4()`, `expiresAt: now + 7 days`.
3. Send email:
   - **Subject:** `You've been invited to join {businessName} on LeadFlow Pro`
   - **Body:** Include link `{FRONTEND_URL}/accept-invite?token={token}`
4. Return invitation.

**Error cases:**
- `409` if email already a member of the org.
- `409` if a pending invitation already exists for that email.

---

### `PATCH /api/users/:id`

Update a team member's role, permissions, or active status.

**Auth:** admin+
**Body (all optional):**
```json
{
  "role": "admin",
  "permissions": ["leads:view", "leads:edit"],
  "isActive": false
}
```

**Constraints:**
- Cannot change role of `root` user.
- Actor cannot set target role >= actor's own role (e.g. a `manager` cannot set someone to `admin`).
- `permissions: []` means reset to role defaults (the frontend sends `undefined` to skip permissions update, or the array to override).

---

### `DELETE /api/users/:id`

Remove a team member from the organization.

**Auth:** admin+
**Constraints:** Cannot remove `root` user. Cannot remove self.
**Action:** Hard-delete user record OR set `isActive: false` + `organizationId: null`. Hard-delete is cleaner; soft-delete keeps login history.

---

### `GET /api/users/invitations`

List all invitations for the caller's organization.

**Auth:** admin+
**Response:**
```json
{
  "success": true,
  "data": {
    "invitations": [
      {
        "_id": "...",
        "email": "pending@company.com",
        "role": "member",
        "permissions": [],
        "status": "pending",
        "invitedBy": "...",
        "expiresAt": "2026-05-26T00:00:00Z",
        "createdAt": "2026-05-19T00:00:00Z",
        "updatedAt": "2026-05-19T00:00:00Z"
      }
    ]
  }
}
```

---

### `DELETE /api/users/invitations/:id`

Revoke a pending invitation.

**Auth:** admin+
**Action:** Set `invitation.status = 'revoked'` (do not hard-delete so we have a record).

---

### `POST /api/users/accept-invite`

Accept an invitation (called from the `/accept-invite?token=...` page on the frontend).

**Auth:** None (public endpoint)
**Body:**
```json
{
  "token": "<UUID from email>",
  "name": "New User Name",
  "password": "optional-if-setting-password"
}
```

**Backend actions:**
1. Find invitation by token; verify `status === 'pending'` and `expiresAt > now`.
2. Check if a user with that email already exists:
   - **Exists:** Link to organization (`user.organizationId = invitation.organizationId`), update role/permissions.
   - **Doesn't exist:** Create new User with `name`, hashed `password` (if provided), `role`, `permissions`, `organizationId`, `invitedBy`.
3. Set `invitation.status = 'accepted'`.
4. Issue JWT access + refresh tokens and return them.

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "...",
    "refreshToken": "...",
    "user": { "_id": "...", "name": "...", "email": "...", "role": "manager", ... }
  }
}
```

---

## Invitation Flow Diagram

```
Admin                   Backend                      Invitee Email
  │                        │                            │
  ├─ POST /users/invite ──►│                            │
  │                        ├─ Create Invitation doc     │
  │                        ├─ Send email ──────────────►│
  │◄─ 200 (invitation) ────│                            │
  │                        │                            │
  │                        │           ◄── Click link ──┤
  │                        │◄── POST /users/accept-invite { token }
  │                        ├─ Verify token valid        │
  │                        ├─ Create/link User          │
  │                        ├─ invitation.status = 'accepted'
  │                        ├─ Issue JWT ───────────────►│ (frontend stores tokens, redirect to /dashboard)
```

---

## `GET /auth/profile` — Update Response

The frontend reads `role`, `permissions`, and `organizationId` from the profile response. Ensure `GET /api/auth/profile` returns:

```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "...",
      "name": "...",
      "email": "...",
      "avatar": "...",
      "role": "root",
      "permissions": [],
      "organizationId": "...",
      "isActive": true,
      "lastLogin": "...",
      "createdAt": "...",
      "updatedAt": "..."
    }
  }
}
```

---

## User Management Checklist

- [ ] Add `role`, `permissions`, `organizationId`, `invitedBy` fields to User schema
- [ ] Create Organization schema and model
- [ ] Create Invitation schema and model
- [ ] Run one-time migration: assign `role: 'root'` and create Org for existing users
- [ ] `GET /api/users` — list org members
- [ ] `POST /api/users/invite` — create invitation + send email
- [ ] `PATCH /api/users/:id` — update role/permissions/isActive
- [ ] `DELETE /api/users/:id` — remove member
- [ ] `GET /api/users/invitations` — list invitations
- [ ] `DELETE /api/users/invitations/:id` — revoke invitation
- [ ] `POST /api/users/accept-invite` — accept token, issue JWT
- [ ] `requirePermission` middleware applied to all routes
- [ ] All data queries scoped by `organizationId`
- [ ] `GET /auth/profile` returns `role`, `permissions`, `organizationId`
- [ ] Frontend `/accept-invite` page built (not yet in this guide — add route `src/app/accept-invite/page.tsx`)
