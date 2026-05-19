# Backend Requirements — Notifications System

The frontend polls `GET /api/notifications` every 30 seconds and renders a live dropdown in the header.
The settings page saves notification preferences via the existing `PATCH /api/settings` call.
The backend needs to create notification records when events occur **and** respect the user's preferences.

---

## 1. Mongoose Model — `Notification`

```js
// models/Notification.js
const NotificationSchema = new mongoose.Schema(
  {
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type:    { type: String, enum: ['new_lead', 'auto_reply_sent', 'workflow_triggered', 'daily_summary'], required: true },
    title:   { type: String, required: true },
    message: { type: String, required: true },
    read:    { type: Boolean, default: false },
    leadId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  },
  { timestamps: true }
);
```

---

## 2. REST Endpoints

### `GET /api/notifications`
Returns the most recent notifications for the authenticated user.

**Query params:**
| Param   | Default | Description                    |
|---------|---------|--------------------------------|
| `limit` | `20`    | Max items to return            |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "userId": "...",
      "type": "new_lead",
      "title": "New Lead Detected",
      "message": "John Smith — Moving from London to Manchester",
      "read": false,
      "leadId": "...",
      "createdAt": "2026-05-18T10:30:00.000Z"
    }
  ]
}
```

Sorted by `createdAt` descending.

---

### `PATCH /api/notifications/:id/read`
Marks a single notification as read.

**Response:**
```json
{ "success": true }
```

---

### `PATCH /api/notifications/read-all`
Marks all unread notifications for the user as read.

**Response:**
```json
{ "success": true }
```

> **Note:** Register `read-all` route **before** `/:id` so Express doesn't treat `read-all` as an `id` param.

---

## 3. Where to Create Notifications

Call a shared helper `createNotification(userId, type, title, message, leadId?)` at these points:

### `new_lead`
- **Where:** In the lead processing service, after a lead is successfully extracted and saved.
- **Condition:** `settings.notifications.newLead === true`
- **Title:** `"New Lead Detected"`
- **Message:** `"{customerName} — {services.join(', ')} from {fromAddress}"`

### `auto_reply_sent`
- **Where:** After the auto-reply email is sent successfully.
- **Condition:** `settings.notifications.autoReplySent === true`
- **Title:** `"Auto Reply Sent"`
- **Message:** `"Reply sent to {customerName} ({customerEmail})"`

### `workflow_triggered`
- **Where:** After an n8n webhook call succeeds (outgoing).
- **Condition:** `settings.notifications.workflowTriggered === true`
- **Title:** `"Workflow Triggered"`
- **Message:** `"n8n workflow fired for {customerName}"`

### `daily_summary`
- **Where:** In the daily summary cron (already in `5-daily-summary.json` n8n workflow). Call `POST /api/notifications` internally (or call `createNotification` directly if the cron runs on the backend).
- **Condition:** `settings.notifications.dailySummary === true`
- **Title:** `"Daily Summary"`
- **Message:** `"{todayCount} new leads today · {autoReplySent} auto-replies sent"`

---

## 4. Helper Function Pattern

```js
// services/notificationService.js
async function createNotification(userId, type, title, message, leadId = null) {
  try {
    const settings = await Settings.findOne({ userId });
    const pref = settings?.notifications?.[typeToPref(type)];
    if (pref === false) return; // user disabled this type

    await Notification.create({ userId, type, title, message, leadId });
  } catch (err) {
    // non-critical — log and swallow
    console.error('[notifications] failed to create:', err.message);
  }
}

function typeToPref(type) {
  return {
    new_lead:           'newLead',
    auto_reply_sent:    'autoReplySent',
    workflow_triggered: 'workflowTriggered',
    daily_summary:      'dailySummary',
  }[type];
}
```

---

## 5. Cleanup (Optional)

Consider a TTL index to auto-delete old notifications after 30 days:

```js
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
```
