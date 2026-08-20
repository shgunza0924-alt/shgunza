const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");

const root = resolve(__dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sliceBetween = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
};

test("public check-in and reservation markup and shared CSS stay unchanged", () => {
  const html = read("index.html");
  const checkinStart = html.indexOf("<!-- ---------- CHECK-IN TAB ---------- -->");
  const reservationStart = html.indexOf("<!-- ---------- RESERVATIONS TAB ---------- -->");
  const mainEnd = html.indexOf("</main>", reservationStart);

  assert.notEqual(checkinStart, -1);
  assert.notEqual(reservationStart, -1);
  assert.notEqual(mainEnd, -1);
  assert.equal(
    hash(html.slice(checkinStart, reservationStart)),
    "141743c05ba0b3ec8b2ef6bc9737f693ac09f0ec74a5b950abf03e3749b8d8de",
  );
  assert.equal(
    hash(html.slice(reservationStart, mainEnd)),
    "e75a3f9b303343574a45f8fbd681f7a975a868c4005c986b0b51bbbfe2f9780c",
  );
  assert.equal(
    hash(read("style.css")),
    "9fa857b4d247f3eb8795bfe6725936bb5ff23aa727034cc9f552d139155b1b13",
  );
});

test("public modals, header, navigation, and footer stay unchanged", () => {
  const html = read("index.html");
  const protectedSections = [
    ["<!-- ===================== EDIT BOOKING MODAL ===================== -->", "<!-- ===================== FACILITY NOTICE MODAL ===================== -->", "925830e79d0688e6d1a265e7d9cef3f6cf1bba0a4113ba95f454dd988af7418d"],
    ["<!-- ===================== FACILITY NOTICE MODAL ===================== -->", "<!-- ===================== HEADER ===================== -->", "1c0ff59f9b4372e4a603a6e313d94c1a87c071bd8954833cdddd02af2c6d1d19"],
    ["<!-- ===================== HEADER ===================== -->", "<!-- ===================== MAIN ===================== -->", "07d486f776d738a1849eed63f203c484699e8365ba90ddf5c9c2d69a511a1eaf"],
    ['<footer class="footer">', '<div id="admin-root">', "86f27c02f99e4e90d8bf863aa65bb801520fc50ca19b86d203b635db94003769"],
  ];

  for (const [start, end, expected] of protectedSections) {
    assert.equal(hash(sliceBetween(html, start, end)), expected);
  }
});

test("runtime-generated public form and result markup stays unchanged", () => {
  const visit = read("js/visit.js");
  const reservation = read("js/reservation.js");
  const protectedSections = [
    [visit, "function renderActivityCards", "export function getVisits", "97be6596e7d437ed32041440f1a3344ab5947397038a3122133a4dbeba3a9e3d"],
    [visit, "function renderVisitors", "function resetFormUI", "edcc73fd86b4fac73d05cec2c2c694d3ff34adc23734a93e76c7683e039fc7b7"],
    [reservation, "function renderSlotGroup", "function wireFacilitySelect", "eb9ce189bbaac844d3891f9874554827028df45f0f645249c7cfe0b135348fe3"],
    [reservation, "function renderMembersList", "function renderSubmitButtonState", "7a6542bbc4e66727cf78b7edd10b9720cf916db3c2af9cb8b7e751542a5a03e9"],
    [reservation, "function renderSubmitButtonState", "// ===================================================================\n// New reservation submit", "d96820779d02291eb83b91982ac1ed80cd472cebbccbc7acfc463381489666ec"],
    [reservation, "function renderMyBookings", "function startEditBooking", "61879fe2985d5f21b7f84473eefb6509a2a4fbc21a5b718154ab7e52bae00480"],
    [reservation, "function renderEditBookingModal", "async function handleUpdateBooking", "d0086a8fbc79a8c1e6514d867aee279f7178ca984a8317e2b501f1ce4d28fd73"],
  ];

  for (const [source, start, end, expected] of protectedSections) {
    assert.equal(hash(sliceBetween(source, start, end)), expected);
  }
});

test("authentication starts before public feature initialization", () => {
  const source = read("js/app.js");
  const authStart = source.indexOf("initFirebaseAuth()");
  assert.ok(authStart > -1);
  assert.ok(authStart < source.indexOf("initVisit()"));
  assert.ok(authStart < source.indexOf("initReservation()"));

  const visitRead = sliceBetween(read("js/visit.js"), "async function loadActivitySettings", "export function initVisit");
  const visitWaitIndex = visitRead.indexOf("await waitForAuth()");
  const visitRequestIndex = visitRead.indexOf("await getDoc(");
  assert.ok(visitWaitIndex >= 0);
  assert.ok(visitRequestIndex >= 0);
  assert.ok(visitWaitIndex < visitRequestIndex);

  const reservation = read("js/reservation.js");
  for (const [start, end] of [
    ["async function findMyBookings", "function renderMyBookings"],
    ["async function loadTodayReservations", "async function loadBookingSettings"],
    ["async function loadBookingSettings", "async function prepareReservationScreen"],
  ]) {
    const section = sliceBetween(reservation, start, end);
    const waitIndex = section.indexOf("await waitForAuth()");
    const requestIndex = section.search(/await getDocs\(|await getDoc\(/);
    assert.ok(waitIndex >= 0);
    assert.ok(requestIndex >= 0);
    assert.ok(waitIndex < requestIndex);
  }
});

test("public check-in never reads or subscribes to the visits collection", () => {
  const source = read("js/visit.js");
  assert.doesNotMatch(source, /onSnapshot\s*\(/);
  assert.doesNotMatch(source, /getDocs\s*\(/);
  assert.match(source, /getDoc\(doc\(db, "siteSettings", "activities"\)\)/);
  assert.match(source, /addDoc\(\s*collection\(db, "visits"\)/);
});

test("public reservation reads are bounded and never realtime", () => {
  const source = read("js/reservation.js");
  assert.doesNotMatch(source, /onSnapshot\s*\(/);
  assert.match(source, /where\("dateKey", "==", dateKey\)/);
  assert.match(source, /limit\(MAX_TODAY_RESERVATIONS\)/);
  assert.match(source, /where\("members", "array-contains-any", memberKeys\)/);
  assert.match(source, /limit\(MAX_MY_BOOKINGS\)/);
  const todayLimit = Number(source.match(/MAX_TODAY_RESERVATIONS = (\d+)/)?.[1]);
  const bookingLimit = Number(source.match(/MAX_MY_BOOKINGS = (\d+)/)?.[1]);
  assert.ok(todayLimit > 0 && todayLimit <= 100);
  assert.ok(bookingLimit >= 20 && bookingLimit <= 50);
  assert.match(source, /if \(!force\) return activeRequest/);
  assert.match(source, /reservationsLoadPromise !== activeRequest/);
  assert.match(source, /constraints\.push\(startAfter\(cursor\)\)/);
  assert.match(source, /while \(cursor\)/);
  assert.match(source, /if \(initialized\) return/);
});

test("authentication clears stale users and retries a failed anonymous session", () => {
  const source = read("js/auth.js");
  const listener = sliceBetween(source, "onAuthStateChanged(auth", "export function onAuthReady");
  const nullState = listener.indexOf("currentUser = null");
  const replacement = listener.indexOf("await ensureAnonymousUser()");
  assert.ok(nullState >= 0 && replacement > nullState);
  assert.match(source, /if \(signingInPromise\) return signingInPromise/);
  assert.match(source, /if \(wasWaitingForInitialState\) return initialUser \|\| null/);
  assert.match(source, /return ensureAnonymousUser\(\)/);
});

test("authentication state machine never returns the previous user during replacement", async () => {
  let source = read("js/auth.js")
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";\s*/g, "")
    .replace(/import\s*\{[^}]+\}\s*from\s*"[^"]+";\s*/g, "")
    .replace(/export\s+/g, "");
  source += "\nglobalThis.__authTest = { initFirebaseAuth, waitForAuth, getCurrentUser };";
  let listener;
  const signIns = [];
  const context = {
    auth: {},
    browserLocalPersistence: {},
    setPersistence: async () => {},
    onAuthStateChanged: (_auth, callback) => { listener = callback; },
    signInAnonymously: () => new Promise((resolve, reject) => signIns.push({ resolve, reject })),
    console: { error() {}, warn() {} },
  };
  vm.runInNewContext(source, context, { filename: "js/auth.js" });

  const initial = context.__authTest.initFirebaseAuth();
  await new Promise((resolve) => setImmediate(resolve));
  const initialCallback = listener(null);
  assert.equal(context.__authTest.getCurrentUser(), null);
  signIns[0].resolve({ user: { uid: "anonymous-1" } });
  await initialCallback;
  assert.equal((await initial).uid, "anonymous-1");

  const replacementCallback = listener(null);
  assert.equal(context.__authTest.getCurrentUser(), null);
  const replacementWait = context.__authTest.waitForAuth();
  let replacementSettled = false;
  replacementWait.then(() => { replacementSettled = true; });
  await Promise.resolve();
  assert.equal(replacementSettled, false);
  signIns[1].resolve({ user: { uid: "anonymous-2" } });
  await replacementCallback;
  assert.equal((await replacementWait).uid, "anonymous-2");

  const failedCallback = listener(null);
  signIns[2].reject(Object.assign(new Error("offline"), { code: "auth/network-request-failed" }));
  await failedCallback;
  const retry = context.__authTest.waitForAuth();
  await Promise.resolve();
  assert.equal(signIns.length, 4, "a later operation should retry after an initial failure");
  signIns[3].resolve({ user: { uid: "anonymous-3" } });
  assert.equal((await retry).uid, "anonymous-3");
});

test("quota and authentication errors have distinct user-safe messages", async () => {
  const source = read("js/firestore-errors.js");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const { getFirestoreErrorMessage } = await import(moduleUrl);
  const codes = [
    "resource-exhausted",
    "permission-denied",
    "unauthenticated",
    "unavailable",
    "network-error",
    "unknown",
  ];
  const messages = codes.map((code) => getFirestoreErrorMessage({ code }, "조회"));
  assert.equal(new Set(messages).size, messages.length);
  assert.match(messages[0], /일시적으로 제한/);
});

test("Firestore write payload field names and values stay compatible", async () => {
  const source = read("js/utils.js");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const { AGE_OPTIONS, createVisitPayload, createReservationPayload } = await import(moduleUrl);
  assert.deepEqual(AGE_OPTIONS, [
    { value: "9", label: "초등 (9~13세)" },
    { value: "14", label: "중등 (14~16세)" },
    { value: "17", label: "고등 (17~19세)" },
    { value: "20", label: "청년 (20~24세)" },
    { value: "25", label: "청년 (25~39세)" },
    { value: "40", label: "성인 (40세 이상)" },
    { value: "0", label: "유아 (8세 미만)" },
  ]);
  const now = new Date("2026-08-20T03:04:05.000Z");
  const visitor = { name: "홍길동", age: "14", gender: "남성" };
  const visit = createVisitPayload(visitor, ["독서"], now);
  assert.deepEqual(Object.keys(visit).sort(), [
    "activities", "age", "createdAt", "gender", "name", "timestamp",
  ]);
  assert.deepEqual(visit.activities, ["독서"]);
  assert.equal(visit.name, visitor.name);
  assert.equal(visit.age, visitor.age);
  assert.equal(visit.gender, visitor.gender);
  assert.equal(visit.createdAt, now.toISOString());

  const reservation = createReservationPayload(
    { facility: "AR 스포츠", timeSlot: "09:00~09:20" },
    [visitor],
    now,
  );
  assert.deepEqual(Object.keys(reservation).sort(), [
    "createdAt", "dateKey", "facility", "members", "timeSlot",
  ]);
  assert.deepEqual(reservation.members, [visitor]);
  assert.equal(reservation.facility, "AR 스포츠");
  assert.equal(reservation.timeSlot, "09:00~09:20");
  assert.match(reservation.dateKey, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(reservation.createdAt, now.toISOString());
});
