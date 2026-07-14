# Admin Tool

Self-rendering Firebase administrator dashboard. It is intentionally isolated
from the public site: the public application only supplies a root element, the
entry button, and an `AdminTool.init()` configuration object.

## Firestore adapter

This version supports Firestore documents with the following configurable
shapes:

- `visits`: `{ name, age, gender, activities, timestamp, createdAt }`
- `reservations`: `{ facility, timeSlot, dateKey, members, createdAt }`

The dashboard subscribes to both collections in real time and provides:

- email/password administrator authentication
- live visit and reservation lists with record deletion
- total visits, total reservations, configured activity count, and configured
  facility count
- combined CSV export

## Installation

Load the stylesheet and script, add an empty root, then initialize the tool.
All project-specific values belong in this call—not in the framework files.

```html
<link rel="stylesheet" href="admin-tool/admin.css">
<button id="admin-toggle-btn">Admin</button>
<div id="admin-root"></div>
<script src="admin-tool/admin.js"></script>
<script>
  AdminTool.init({
    firebase: { /* Firebase Web configuration */ },
    auth: { adminEmail: "admin@example.com" },
    branding: { title: "Example administrator" },
    collections: { visits: "visits", reservations: "reservations" },
    labels: { youthcutActivity: "Photo booth", arFacility: "AR sports" },
    entryButtonId: "admin-toggle-btn",
    exportFileName: "example-admin-export"
  });
</script>
```

`firebase` and `auth.adminEmail` are required. The tool uses a named Firebase
app (`admin-tool`), so it can coexist with a public site that already uses the
default Firebase app.

The password modal is always created hidden. It opens only from the configured
`entryButtonId`; a previously authenticated administrator can open the dashboard
from that same button without entering the password again.
