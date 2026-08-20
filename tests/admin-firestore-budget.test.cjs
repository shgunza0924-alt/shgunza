const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");

const root = resolve(__dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.ok(startIndex >= 0, `Missing section: ${start}`);
  assert.ok(endIndex > startIndex, `Missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

function assertAdminGateBeforeRequest(source, requestPattern) {
  const gateIndex = source.indexOf("requireAdminSession()");
  const requestIndex = source.search(requestPattern);
  assert.ok(gateIndex >= 0, "admin gate is required");
  assert.ok(requestIndex >= 0, "Firestore request is required");
  assert.ok(gateIndex < requestIndex, "admin gate must run before Firestore request");
}

test("administrator collections are never subscribed in realtime", () => {
  const source = read("admin-tool/admin.js");
  assert.doesNotMatch(source, /onSnapshot\s*\(/);
  assert.doesNotMatch(source, /state\.(?:page|pageSize|visitsStatus|reservationsStatus)\b/);
});

test("administrator list uses a bounded cursor query and cached pages", () => {
  const source = read("admin-tool/admin.js");
  const pageSize = Number(source.match(/var PAGE_SIZE = (\d+);/)?.[1]);
  assert.ok(pageSize >= 20 && pageSize <= 50);
  assert.match(source, /var PAGE_QUERY_LIMIT = PAGE_SIZE \+ 1/);

  const queryBuilder = section(source, "function buildListQuery", "function buildCountQuery");
  assert.match(queryBuilder, /orderBy\("createdAt", "desc"\)/);
  assert.match(queryBuilder, /startAfter\(cursor\)/);
  assert.match(queryBuilder, /limit\(pageLimit \|\| PAGE_QUERY_LIMIT\)/);

  const loader = section(source, "async function loadListPage", "async function loadAggregateCount");
  assertAdminGateBeforeRequest(loader, /state\.api\.getDocs\(/);
  assert.match(loader, /list\.inFlight\.has\(requestKey\)/);
  assert.match(loader, /signatureCache\.pages\.get\(pageIndex\)/);
  assert.match(loader, /snapshot\.docs\.slice\(0, PAGE_SIZE\)/);
  assert.match(loader, /version !== list\.requestVersion/);
  assert.match(loader, /list\.inFlight\.get\(requestKey\) === request/);
  const activation = section(source, "function activateListSignature", "async function loadListPage");
  assert.match(activation, /list\.requestVersion\+\+/);
  assert.match(activation, /list\.countRequestVersion\+\+/);
  assert.match(activation, /list\.inFlight\.clear\(\)/);
  assert.match(activation, /list\.signature = signature/);
});

test("administrator filters and counts execute on the server", () => {
  const source = read("admin-tool/admin.js");
  const constraints = section(source, "function firestoreWhereConstraints", "function buildListQuery");
  assert.match(constraints, /where\("createdAt", ">=", range\.start\)/);
  assert.match(constraints, /where\("createdAt", "<", range\.end\)/);
  assert.match(constraints, /where\("name", "==", search\)/);
  assert.match(constraints, /where\("facility", "==", search\)/);

  const aggregate = section(source, "async function loadAggregateCount", "function loadListView");
  assertAdminGateBeforeRequest(aggregate, /state\.api\.getCountFromServer\(/);
  assert.doesNotMatch(aggregate, /getDocs\s*\(/);
  assert.match(section(source, "function buildCountQuery", "function cacheForSignature"), /orderBy\("createdAt", "desc"\)/);
  assert.match(aggregate, /safeRender\(type\)/);
});

test("administrator initialization performs no Firestore document reads", () => {
  const source = read("admin-tool/admin.js");
  const connect = section(source, "async function connect", "window.AdminTool");
  assert.match(connect, /onAuthStateChanged/);
  assert.doesNotMatch(connect, /(?:getDoc|getDocs|getCountFromServer|onSnapshot)\s*\(/);
  assert.doesNotMatch(connect, /firestoreApi\.collection\s*\(/);
  assert.match(connect, /await state\.authReady/);
});

test("administrator initialization errors stay invisible until admin entry", () => {
  const source = read("admin-tool/admin.js");
  const startup = section(source, "function start()", "if (document.readyState");
  assert.match(startup, /root\.replaceChildren\(\)/);
  assert.match(startup, /entry\.addEventListener\("click"/);
  assert.match(startup, /window\.alert/);
  assert.doesNotMatch(startup, /at-fs-init-error/);
});

test("settings and trash reads are lazy, authenticated, and bounded", () => {
  const source = read("admin-tool/admin.js");
  const settings = section(source, "async function loadSettingsView", "function updateSelectedAdminTab");
  assertAdminGateBeforeRequest(settings, /state\.api\.getDoc\(/);
  assert.match(settings, /state\.settingsLoading\[key\]/);
  assert.match(settings, /state\.settingsLoading\[key\] === request/);
  assert.doesNotMatch(settings, /state\.view !== view/);

  const trash = section(source, "async function showVisitTrash", "async function restoreVisit");
  assertAdminGateBeforeRequest(trash, /state\.api\.getDocs\(/);
  assert.match(trash, /orderBy\("deletedAt", "desc"\)/);
  assert.match(trash, /limit\(100\)/);
});

test("admin refresh resets cursors and sign-out scrubs personal data from the DOM", () => {
  const source = read("admin-tool/admin.js");
  const invalidation = section(source, "function invalidateListCache", "async function refreshCurrentList");
  assert.match(invalidation, /cursors: \[null\]/);
  assert.match(invalidation, /list\.pageIndex = 0/);
  const refresh = section(source, "async function refreshCurrentList", "function currentActivityName");
  assert.match(refresh, /pageIndex: 0/);

  const clearing = section(source, "function clearPrivateState", "async function login");
  assert.match(clearing, /content\.replaceChildren\(\)/);
  assert.match(clearing, /csvContent\.replaceChildren\(\)/);
  assert.match(clearing, /csvModal\.hidden = true/);
});

test("admin preserves filter drafts during asynchronous renders and rechecks visit imports", () => {
  const source = read("admin-tool/admin.js");
  const focusGuard = section(source, "function editorHasFocus", "function safeRender");
  assert.match(focusGuard, /closest\("#at-query-form"\)/);
  const controls = section(source, "function bindListControls", "function renderTable");
  assert.match(controls, /addEventListener\("focusout"/);
  assert.match(controls, /restore the unsubmitted draft/);

  const visitImport = section(source, "async function importPendingVisits", "async function importPendingReservations");
  assert.match(visitImport, /fetchAllForMaintenance\("visits", false\)/);
  assert.match(visitImport, /planVisitAdditions\(pending\.parsed\.records, latestExisting\)/);
  const commit = section(source, "async function commitVisitChunk", "async function commitReservationChunk");
  assert.match(commit, /runTransaction/);
  assert.match(commit, /transaction\.get\(plan\.ref\)/);
});

test("long-running maintenance exports use an immutable filter snapshot", () => {
  const source = read("admin-tool/admin.js");
  const fetcher = section(source, "function captureMaintenanceQuery", "function planReservationAdditions");
  assert.match(fetcher, /firestoreWhereConstraints\(type\)\.slice\(\)/);
  assert.match(fetcher, /signature: constraints\.length \? querySignature\(type\) : "all"/);
  assert.match(fetcher, /capturedQuery \|\| captureMaintenanceQuery/);
  assert.match(fetcher, /queryContext\.constraints\.slice\(\)/);
  assert.match(fetcher, /sessionVersion !== state\.adminSessionVersion/);
  assert.match(fetcher, /state\.maintenanceInFlight\.get\(key\) === request/);
  const exporter = section(source, "async function exportCsv", "async function connect");
  assert.match(exporter, /var periodSuffix = exportPeriodSuffix\(\)/);
  assert.match(exporter, /captureMaintenanceQuery\("visits", true\)/);
  assert.match(exporter, /captureMaintenanceQuery\("reservations", true\)/);
  assert.match(exporter, /"-" \+ periodSuffix \+ "\.csv"/);
});

test("administrator read failures distinguish quota, permission, auth, service, and network errors", () => {
  const source = read("admin-tool/admin.js");
  const mapper = section(source, "function firestoreErrorMessage", "function hasAdminSession");
  for (const code of [
    "resource-exhausted",
    "permission-denied",
    "unauthenticated",
    "unavailable",
    "network-error",
  ]) {
    assert.match(mapper, new RegExp(code));
  }
  assert.match(mapper, /잠시 제한/);
});

test("new administrator layout styles cannot leak into public screens", () => {
  const css = read("admin-tool/admin.css");
  const marker = "/* Auth-gated, paged administrator workspace. All rules stay inside admin-root. */";
  const markerIndex = css.indexOf(marker);
  assert.ok(markerIndex >= 0, "administrator isolation marker is required");
  const overrides = css.slice(markerIndex + marker.length).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(overrides.length > 0);

  const inspectRules = (source) => {
    let cursor = 0;
    while (cursor < source.length) {
      const open = source.indexOf("{", cursor);
      if (open < 0) return;
      const prelude = source.slice(cursor, open).trim();
      let depth = 1;
      let close = open + 1;
      while (close < source.length && depth) {
        if (source[close] === "{") depth++;
        if (source[close] === "}") depth--;
        close++;
      }
      assert.equal(depth, 0, `Unclosed CSS rule: ${prelude}`);
      const body = source.slice(open + 1, close - 1);
      if (/^@(media|supports|layer|container)\b/.test(prelude)) {
        inspectRules(body);
      } else if (/^@keyframes\b/.test(prelude)) {
        assert.match(prelude, /^@keyframes\s+at-/);
      } else {
        for (const selector of prelude.split(",")) {
          assert.ok(selector.trim().startsWith("#admin-root"), `Unscoped administrator selector: ${selector.trim()}`);
        }
      }
      cursor = close;
    }
  };
  inspectRules(overrides);
});

test("declared Firestore indexes cover administrator search and public booking lookup", () => {
  const config = JSON.parse(read("firestore.indexes.json"));
  const signatures = config.indexes.map((index) => ({
    collection: index.collectionGroup,
    scope: index.queryScope,
    fields: index.fields.map((field) => `${field.fieldPath}:${field.order || field.arrayConfig}`),
  }));
  assert.deepEqual(signatures, [
    { collection: "visits", scope: "COLLECTION", fields: ["name:ASCENDING", "createdAt:DESCENDING"] },
    { collection: "reservations", scope: "COLLECTION", fields: ["facility:ASCENDING", "createdAt:DESCENDING"] },
    { collection: "reservations", scope: "COLLECTION", fields: ["members:CONTAINS", "createdAt:DESCENDING"] },
  ]);
  assert.equal(JSON.parse(read("firebase.json")).firestore.indexes, "firestore.indexes.json");
});

function loadAdminInternals() {
  const original = read("admin-tool/admin.js");
  const marker = "  window.AdminTool = { init:";
  const instrumented = original.replace(
    marker,
    "  window.__AdminToolTest = { state: state, buildListQuery: buildListQuery, buildCountQuery: buildCountQuery, loadListPage: loadListPage, loadSettingsView: loadSettingsView, querySignature: querySignature, fetchAllForMaintenance: fetchAllForMaintenance, clearPrivateState: clearPrivateState };\n" + marker,
  );
  assert.notEqual(instrumented, original, "admin test instrumentation marker must exist");
  const context = {
    window: {},
    document: { getElementById() { return null; } },
    navigator: { onLine: true },
    console: { error() {}, warn() {}, log() {} },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(instrumented, context, { filename: "admin-tool/admin.js" });
  return context.window.__AdminToolTest;
}

test("constructed administrator queries carry the real server constraints", () => {
  const tool = loadAdminInternals();
  const calls = [];
  const constraint = (kind) => (...args) => ({ kind, args });
  tool.state.config = {
    auth: { adminEmail: "admin@example.com" },
    collections: { visits: "visits", reservations: "reservations" },
  };
  tool.state.db = { id: "db" };
  tool.state.filter = "month";
  tool.state.filterYear = 2026;
  tool.state.filterMonth = 8;
  tool.state.recordSearch.visits = "홍길동";
  tool.state.api = {
    collection: (...args) => ({ kind: "collection", args }),
    where: constraint("where"),
    orderBy: constraint("orderBy"),
    startAfter: constraint("startAfter"),
    limit: constraint("limit"),
    query: (source, ...constraints) => {
      const value = { source, constraints };
      calls.push(value);
      return value;
    },
  };

  const cursor = { id: "last-visible" };
  const listQuery = tool.buildListQuery("visits", cursor);
  const monthStart = new Date(2026, 7, 1, 0, 0, 0, 0).toISOString();
  const monthEnd = new Date(2026, 8, 1, 0, 0, 0, 0).toISOString();
  assert.deepEqual(
    listQuery.constraints.map((item) => [item.kind, ...item.args]),
    [
      ["where", "createdAt", ">=", monthStart],
      ["where", "createdAt", "<", monthEnd],
      ["where", "name", "==", "홍길동"],
      ["orderBy", "createdAt", "desc"],
      ["startAfter", cursor],
      ["limit", 26],
    ],
  );
  const countQuery = tool.buildCountQuery("visits");
  assert.deepEqual(countQuery.constraints.map((item) => item.kind), ["where", "where", "where", "orderBy"]);
  assert.equal(calls.length, 2);
});

test("A-B-A filter races start a fresh request and only apply the newest response", async () => {
  const tool = loadAdminInternals();
  const pending = [];
  const constraint = (kind) => (...args) => ({ kind, args });
  tool.state.config = {
    auth: { adminEmail: "admin@example.com" },
    collections: { visits: "visits", reservations: "reservations" },
  };
  tool.state.auth = { currentUser: { email: "admin@example.com" } };
  tool.state.isAdmin = true;
  tool.state.db = { id: "db" };
  tool.state.filter = "all";
  tool.state.api = {
    collection: (...args) => ({ kind: "collection", args }),
    where: constraint("where"),
    orderBy: constraint("orderBy"),
    startAfter: constraint("startAfter"),
    limit: constraint("limit"),
    query: (source, ...constraints) => ({ source, constraints }),
    getDocs(query) {
      return new Promise((resolve) => pending.push({ query, resolve }));
    },
  };
  const doc = (id) => ({ id, data: () => ({ name: id, createdAt: "2026-08-20T00:00:00.000Z" }) });

  tool.state.recordSearch.visits = "A";
  const firstA = tool.loadListPage("visits", { pageIndex: 0, force: true });
  tool.state.recordSearch.visits = "B";
  const requestB = tool.loadListPage("visits", { pageIndex: 0, force: true });
  tool.state.recordSearch.visits = "A";
  const newestA = tool.loadListPage("visits", { pageIndex: 0, force: true });
  assert.equal(pending.length, 3, "returning to A must not reuse A's stale in-flight request");

  pending[0].resolve({ docs: [doc("old-A")] });
  pending[1].resolve({ docs: [doc("B")] });
  pending[2].resolve({ docs: [doc("new-A")] });
  await Promise.all([firstA, requestB, newestA]);
  assert.deepEqual(Array.from(tool.state.lists.visits.rows, (row) => row.name), ["new-A"]);

  await tool.loadListPage("visits", { pageIndex: 0 });
  assert.equal(pending.length, 3, "the completed newest page should come from cache");
});

test("maintenance reads cannot publish private data after logout or erase a new session request", async () => {
  const tool = loadAdminInternals();
  const pending = [];
  const constraint = (kind) => (...args) => ({ kind, args });
  tool.state.config = {
    auth: { adminEmail: "admin@example.com" },
    collections: { visits: "visits", reservations: "reservations" },
  };
  tool.state.auth = { currentUser: { email: "admin@example.com" } };
  tool.state.isAdmin = true;
  tool.state.db = { id: "db" };
  tool.state.api = {
    collection: (...args) => ({ kind: "collection", args }),
    orderBy: constraint("orderBy"),
    startAfter: constraint("startAfter"),
    limit: constraint("limit"),
    query: (source, ...constraints) => ({ source, constraints }),
    getDocs(query) { return new Promise((resolve) => pending.push({ query, resolve })); },
  };

  const oldRequest = tool.fetchAllForMaintenance("visits", false);
  const sharedUnfilteredRequest = tool.fetchAllForMaintenance("visits", true);
  assert.equal(pending.length, 1, "unfiltered import and export scans should share one request");
  tool.state.isAdmin = false;
  tool.state.auth.currentUser = null;
  tool.clearPrivateState();

  tool.state.auth.currentUser = { email: "admin@example.com" };
  tool.state.isAdmin = true;
  const newRequest = tool.fetchAllForMaintenance("visits", false);
  assert.equal(pending.length, 2);
  pending[0].resolve({ docs: [{ id: "private-old", data: () => ({ name: "old" }) }] });
  const expiredResults = await Promise.allSettled([oldRequest, sharedUnfilteredRequest]);
  assert.ok(expiredResults.every((result) => result.status === "rejected" && result.reason.code === "unauthenticated"));
  assert.equal(tool.state.maintenanceInFlight.size, 1, "an old finally block must not clear the new session request");
  pending[1].resolve({ docs: [] });
  assert.deepEqual(Array.from(await newRequest), []);
  assert.equal(tool.state.maintenanceInFlight.size, 0);
});

test("an old settings response cannot clear a new session's in-flight request", async () => {
  const tool = loadAdminInternals();
  const pending = [];
  tool.state.config = {
    auth: { adminEmail: "admin@example.com" },
    collections: { settings: "siteSettings", visits: "visits", reservations: "reservations" },
    facilities: [],
  };
  tool.state.auth = { currentUser: { email: "admin@example.com" } };
  tool.state.isAdmin = true;
  tool.state.view = "activities";
  tool.state.db = { id: "db" };
  tool.state.api = {
    doc: (...args) => ({ args }),
    getDoc(reference) { return new Promise((resolve) => pending.push({ reference, resolve })); },
  };

  const oldRequest = tool.loadSettingsView("activities", false);
  await Promise.resolve();
  assert.equal(pending.length, 1);
  tool.state.isAdmin = false;
  tool.state.auth.currentUser = null;
  tool.clearPrivateState();

  tool.state.auth.currentUser = { email: "admin@example.com" };
  tool.state.isAdmin = true;
  const newRequest = tool.loadSettingsView("activities", false);
  await Promise.resolve();
  assert.equal(pending.length, 2);
  const activePromise = tool.state.settingsLoading.activities;
  pending[0].resolve({ exists: () => true, data: () => ({ items: [{ id: "old", name: "Old", emoji: "x" }] }) });
  assert.equal(await oldRequest, false);
  assert.equal(tool.state.settingsLoading.activities, activePromise);
  pending[1].resolve({ exists: () => true, data: () => ({ items: [{ id: "new", name: "New", emoji: "n" }] }) });
  assert.equal(await newRequest, true);
  assert.equal(tool.state.settingsLoading.activities, null);
  assert.equal(tool.state.activities[0].id, "new");
});
