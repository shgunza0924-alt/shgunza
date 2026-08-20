# Admin Tool

Self-rendering Firebase administrator dashboard. It is intentionally isolated
from the public site: the public application only supplies a root element, the
entry button, and an `AdminTool.init()` configuration object.

## Firestore adapter

This version supports Firestore documents with the following configurable
shapes:

- `visits`: `{ name, age, gender, activities, timestamp, createdAt }`
- `reservations`: `{ facility, timeSlot, dateKey, members, createdAt }`
- `visitTrash`: `{ originalId, record, deletedAt }` (visit records only)

The dashboard does not read Firestore until the configured administrator has
authenticated and opened a data view. It provides:

- email/password administrator authentication
- 25-row, `createdAt`-ordered visit and reservation pages backed by Firestore
  document cursors, query caching, and explicit refresh
- server-side date and exact-value filters plus aggregate count queries
- one-shot, tab-scoped settings reads; visit deletion includes a recovery bin
- tab-specific visit/reservation CSV preview and import; visit records also
  support deduplication, recovery, and round-trip backup
- current-page detailed statistics and aggregate matching-record counts
- combined CSV export

CSV export, backup, and import deduplication intentionally scan matching data
only after an administrator requests those maintenance actions. Those scans are
cursor-paged in batches rather than fetched during dashboard initialization.

Queries that combine an exact search with newest-first ordering require the
indexes declared in the repository's `firestore.indexes.json`.

## Installation

Load the stylesheet and script, add an empty root, then initialize the tool.
All project-specific values belong in this call—not in the framework files.

```html
<link rel="stylesheet" href="admin-tool/admin.css">
<button id="admin-toggle-btn">Admin</button>
<div id="admin-root"></div>
<script src="admin-tool/visit-import.js"></script>
<script src="admin-tool/admin.js"></script>
<script>
  AdminTool.init({
    firebase: { /* Firebase Web configuration */ },
    auth: { adminEmail: "admin@example.com" },
    branding: { title: "Example administrator" },
    collections: { visits: "visits", reservations: "reservations", trash: "visitTrash" },
    labels: { youthcutActivity: "Photo booth", arFacility: "AR sports" },
    entryButtonId: "admin-toggle-btn",
    exportFileName: "example-admin-export"
  });
</script>
```

The visit importer reads only rows whose `구분` value is `방문등록`; the
reservation importer reads only `시설예약` rows. Each preview reports and
excludes the other record type. Reservation rows are restored as
`{ facility, timeSlot, dateKey, members, createdAt }`, and an existing matching
reservation or occupied slot is never overwritten.

`firebase` and `auth.adminEmail` are required. The tool uses a named Firebase
app (`admin-tool`), so it can coexist with a public site that already uses the
default Firebase app.

The password modal is always created hidden. It opens only from the configured
`entryButtonId`; a previously authenticated administrator can open the dashboard
from that same button without entering the password again.
