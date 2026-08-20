/*
 * AdminTool
 * A reusable, self-rendering Firebase administrator dashboard.
 * Project data is supplied exclusively through AdminTool.init().
 */
(function () {
  var MAX_ACTIVITIES = 12;
  var PAGE_SIZE = 25;
  var PAGE_QUERY_LIMIT = PAGE_SIZE + 1;
  var MAINTENANCE_PAGE_SIZE = 250;
  var MAX_QUERY_CACHE_ENTRIES = 20;
  var MAX_CACHED_PAGES = 12;
  var defaultActivities = [{ id: "rest", name: "휴식", emoji: "☕" }, { id: "boardgame", name: "보드게임", emoji: "🎲" }, { id: "youthcut", name: "유스네컷", emoji: "📸", aliases: ["인생네컷"] }, { id: "reading", name: "독서", emoji: "📚" }, { id: "beads", name: "컬러비즈", emoji: "🟣" }];
  var today = new Date();
  var state = {
    config: null,
    app: null,
    auth: null,
    db: null,
    api: null,
    visits: [],
    visitTrash: [],
    reservations: [],
    lists: { visits: createListState(), reservations: createListState() },
    recordSearch: { visits: "", reservations: "" },
    activities: defaultActivities.map(function (item) { return Object.assign({}, item); }),
    bookingSettings: null,
    settingsLoaded: { activities: false, bookingSettings: false },
    settingsLoading: { activities: null, bookingSettings: null },
    settingsError: { activities: "", bookingSettings: "" },
    trashStatus: { loading: false, error: "" },
    ready: false,
    authReady: null,
    isAdmin: false,
    adminSessionVersion: 0,
    view: "visits",
    filter: "all",
    filterYear: today.getFullYear(),
    filterMonth: today.getMonth() + 1,
    rangeStart: "",
    rangeEnd: "",
    pendingVisitImport: null,
    pendingReservationImport: null,
    importInProgress: false,
    maintenanceInFlight: new Map()
  };
  var loginReturnFocus = null;
  var csvReturnFocus = null;

  function createListState() {
    return {
      rows: [],
      loading: false,
      error: "",
      pageIndex: 0,
      signature: "",
      caches: new Map(),
      inFlight: new Map(),
      requestVersion: 0,
      countRequestVersion: 0,
      totalCount: null,
      countLoading: false,
      countError: ""
    };
  }

  function defaultBookingSettings() {
    var notices = {};
    (state.config && state.config.facilities || []).forEach(function (facility) {
      var label = facility === "노래방1" ? "노래방 1실" : facility === "노래방2" ? "노래방 2실" : facility;
      notices[facility] = { enabled: true, message: label + (facility.indexOf("노래방") === 0 ? "은" : "는") + " 1회 20분, 최대 10명까지 이용할 수 있습니다." };
    });
    return { schedule: { weekday: { start: "09:00", end: "19:00" }, weekend: { start: "09:00", end: "19:00" }, lunch: { enabled: true, start: "12:00", end: "13:00" } }, notices: notices };
  }

  function normalizedBookingSettings(value) {
    var defaults = defaultBookingSettings(), source = value || {}, schedule = source.schedule || {}, notices = source.notices || {};
    Object.keys(defaults.notices).forEach(function (facility) { defaults.notices[facility] = Object.assign({}, defaults.notices[facility], notices[facility] || {}); });
    defaults.schedule.weekday = Object.assign({}, defaults.schedule.weekday, schedule.weekday || {});
    defaults.schedule.weekend = Object.assign({}, defaults.schedule.weekend, schedule.weekend || {});
    defaults.schedule.lunch = Object.assign({}, defaults.schedule.lunch, schedule.lunch || {});
    return defaults;
  }

  function normalizedEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function esc(value) {
    var node = document.createElement("span");
    node.textContent = value == null ? "" : String(value);
    return node.innerHTML;
  }

  function dateValue(value) {
    if (!value) return 0;
    if (typeof value.toDate === "function") return value.toDate().getTime();
    return new Date(value).getTime() || 0;
  }

  function dateText(value) {
    if (!value) return "-";
    var date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
    return isNaN(date) ? String(value) : date.toLocaleString("ko-KR");
  }

  function dateOnlyText(value) {
    if (!value) return "-";
    var date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
    return isNaN(date) ? String(value) : date.toLocaleDateString("ko-KR");
  }

  function visitTimeText(row) {
    var timestamp = String(row.timestamp || "");
    var match = timestamp.match(/(오전|오후)\s*\d{1,2}:\d{2}(?::\d{2})?$/);
    if (match) return match[0];
    var date = row.createdAt && typeof row.createdAt.toDate === "function" ? row.createdAt.toDate() : new Date(row.createdAt);
    return isNaN(date) ? timestamp || "-" : date.toLocaleTimeString("ko-KR");
  }

  function firestoreErrorCode(error) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "network-error";
    return String(error && error.code || "").replace(/^firestore\//, "").replace(/^auth\//, "");
  }

  function logFirestoreError(context, error) {
    console.error("[AdminTool] " + context + " failed", {
      code: firestoreErrorCode(error) || "unknown",
      message: error && error.message || String(error || "Unknown error")
    }, error);
  }

  function firestoreErrorMessage(error, noun) {
    var label = noun || "데이터";
    var code = firestoreErrorCode(error);
    if (code === "resource-exhausted") return "현재 " + label + " 조회 요청이 많아 잠시 제한되었습니다. 잠시 후 새로고침해주세요.";
    if (code === "permission-denied") return label + " 접근 권한이 없습니다. 관리자 계정 권한을 확인해주세요.";
    if (code === "unauthenticated") return "관리자 로그인 상태가 만료되었습니다. 다시 로그인해주세요.";
    if (code === "unavailable") return label + " 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해주세요.";
    if (code === "network-error" || code === "network-request-failed") return "네트워크 연결을 확인한 뒤 " + label + " 조회를 다시 시도해주세요.";
    if (code === "failed-precondition") return label + " 조회에 필요한 Firestore 인덱스가 준비되지 않았습니다. 관리자에게 문의해주세요.";
    return label + "을(를) 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
  }

  function hasAdminSession() {
    return !!state.auth && !!state.auth.currentUser && normalizedEmail(state.auth.currentUser.email) === normalizedEmail(state.config.auth.adminEmail);
  }

  function requireAdminSession() {
    if (state.isAdmin && hasAdminSession()) return true;
    state.isAdmin = false;
    closeDashboard();
    notify("관리자 로그인 상태가 만료되었습니다. 다시 로그인해주세요.", "error");
    return false;
  }

  function setButtonPending(button, pending) {
    if (!button) return;
    button.disabled = !!pending;
    if (pending) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
  }

  function setCsvImportPending(button, pending) {
    state.importInProgress = !!pending;
    setButtonPending(button, pending);
    [document.getElementById("at-csv-close"), document.getElementById("at-csv-cancel")].forEach(function (control) {
      if (control) control.disabled = !!pending;
    });
    var modal = document.getElementById("at-csv-modal");
    if (modal) {
      if (pending) modal.setAttribute("aria-busy", "true");
      else modal.removeAttribute("aria-busy");
      var dialog = modal.querySelector('[role="dialog"]');
      if (pending && dialog) dialog.focus();
      else if (!pending && button) button.focus();
    }
  }

  function editorHasFocus(view) {
    var content = document.getElementById("at-ref-content");
    var active = document.activeElement;
    var isSettingsView = view === "activities" || view === "booking-settings";
    if (state.view !== view || !content || !active || !content.contains(active)) return false;
    if (isSettingsView) return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(active.tagName);
    return /^(INPUT|SELECT)$/.test(active.tagName) && !!active.closest("#at-query-form");
  }

  function safeRender(views) {
    var dashboard = document.getElementById("at-fs-dashboard");
    if (!state.isAdmin || !dashboard || dashboard.hidden) return;
    var allowed = Array.isArray(views) ? views : [views];
    if (views && allowed.indexOf(state.view) === -1) return;
    if (editorHasFocus(state.view)) return;
    render();
  }

  function notify(message, type) {
    var toast = document.getElementById("at-fs-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = "at-fs-toast " + (type || "");
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
    toast.hidden = false;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(function () { toast.hidden = true; }, 2800);
  }

  function renderShell() {
    var root = document.getElementById("admin-root");
    if (!root) throw new Error("AdminTool requires #admin-root.");
    var publicLogo = document.querySelector("header img");
    var logoUrl = state.config.branding.logoUrl || (publicLogo && publicLogo.src) || "";
    root.innerHTML =
'<div id="at-fs-modal" class="at-fs-modal" role="dialog" aria-modal="true" aria-labelledby="at-fs-login-title" aria-describedby="at-fs-login-description" hidden aria-hidden="true"><form id="at-fs-login-form" class="at-fs-login">' +
  '<h2 id="at-fs-login-title">관리자 인증</h2><p id="at-fs-login-description">관리자 비밀번호를 입력하세요.</p>' +
  '<input id="at-fs-password" type="password" autocomplete="current-password" aria-label="관리자 비밀번호" required autofocus>' +
  '<div class="at-fs-actions"><button type="button" id="at-fs-cancel">취소</button><button type="submit">로그인</button></div>' +
'</form></div>' +

'<section id="at-fs-dashboard" class="at-fs-dashboard at-ref-dashboard" hidden>' +

  '<header class="at-ref-header at-admin-topbar">' +
    '<div class="at-ref-brand">' +

      (logoUrl
        ? '<img src="' + esc(logoUrl) + '" alt="' + esc(state.config.branding.title || "") + '">'
        : ''
      ) +

      '<div class="at-admin-brand-copy">' +
        '<strong>' + esc(state.config.branding.title || "관리자") + '</strong>' +
      '</div>' +

    '</div>' +

    '<div class="at-ref-actions">' +
      '<span id="at-ref-date"></span>' +
      '<button type="button" id="at-fs-logout" title="관리자 화면에서 나가기" aria-label="관리자 로그아웃 후 사용자 화면으로 나가기">↪ 관리자 나가기</button>' +
    '</div>' +
  '</header>' +

  '<div class="at-admin-workspace">' +

    '<nav class="at-ref-tabs at-ref-tabs-four at-admin-sidebar" role="tablist" aria-label="관리자 메뉴">' +

      '<button type="button" id="at-tab-visits" role="tab" aria-selected="true" aria-controls="at-ref-content" tabindex="0" data-at-view="visits" class="is-active">' +
        '<span aria-hidden="true">▥</span>' +
        '<span>방문 등록 내역</span>' +
      '</button>' +

      '<button type="button" id="at-tab-reservations" role="tab" aria-selected="false" aria-controls="at-ref-content" tabindex="-1" data-at-view="reservations">' +
        '<span aria-hidden="true">✓</span>' +
        '<span>시설 예약 현황</span>' +
      '</button>' +

      '<button type="button" id="at-tab-activities" role="tab" aria-selected="false" aria-controls="at-ref-content" tabindex="-1" data-at-view="activities">' +
        '<span aria-hidden="true">✦</span>' +
        '<span>활동 카드 관리</span>' +
      '</button>' +

      '<button type="button" id="at-tab-booking-settings" role="tab" aria-selected="false" aria-controls="at-ref-content" tabindex="-1" data-at-view="booking-settings">' +
        '<span aria-hidden="true">⚙</span>' +
        '<span>운영·안내 설정</span>' +
      '</button>' +

    '</nav>' +

    '<main id="at-ref-content" class="at-ref-content at-admin-content" role="tabpanel" aria-labelledby="at-tab-visits" tabindex="-1"></main>' +

  '</div>' +

'</section>' +

'<div id="at-csv-modal" class="at-csv-modal" hidden aria-hidden="true">' +
  '<section class="at-csv-dialog" role="dialog" aria-modal="true" aria-labelledby="at-csv-title" tabindex="-1">' +
    '<header>' +
      '<h2 id="at-csv-title">방문 기록</h2>' +
      '<button type="button" id="at-csv-close" aria-label="CSV 대화상자 닫기">×</button>' +
    '</header>' +
    '<div id="at-csv-content"></div>' +
  '</section>' +
'</div>' +

'<div id="at-fs-toast" class="at-fs-toast" role="status" aria-live="polite" aria-atomic="true" hidden></div>';

    document.getElementById("at-fs-cancel").onclick = closeModal;
    document.getElementById("at-fs-login-form").onsubmit = login;
    document.getElementById("at-fs-logout").onclick = logout;
    document.getElementById("at-csv-close").onclick = closeCsvModal;
    document.getElementById("at-csv-modal").onclick = function (event) { if (event.target === event.currentTarget) closeCsvModal(); };
    root.querySelectorAll("[data-at-view]").forEach(function (button) {
      button.onclick = function () { selectAdminView(button.dataset.atView, button); };
      button.onkeydown = function (event) {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(event.key) === -1) return;
        var tabs = Array.from(root.querySelectorAll("[data-at-view]"));
        var index = tabs.indexOf(button);
        if (event.key === "Home") index = 0;
        else if (event.key === "End") index = tabs.length - 1;
        else index = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        tabs[index].click();
        tabs[index].focus();
      };
    });
    document.addEventListener("keydown", handleModalKeydown);
  }

  function handleModalKeydown(event) {
    var csvModal = document.getElementById("at-csv-modal");
    var loginModal = document.getElementById("at-fs-modal");
    var modal = csvModal && !csvModal.hidden ? csvModal : loginModal && !loginModal.hidden ? loginModal : null;
    if (!modal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (modal === csvModal) closeCsvModal(); else closeModal();
      return;
    }
    if (event.key !== "Tab") return;
    var focusable = Array.from(modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
    if (!focusable.length) {
      event.preventDefault();
      var dialog = modal.querySelector('[role="dialog"]');
      if (dialog) dialog.focus();
      return;
    }
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || focusable.indexOf(document.activeElement) === -1)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || focusable.indexOf(document.activeElement) === -1)) { event.preventDefault(); first.focus(); }
  }

  function openModal() {
    var modal = document.getElementById("at-fs-modal");
    loginReturnFocus = document.activeElement;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.getElementById("at-fs-password").focus();
  }

  function closeModal(restoreFocus) {
    var modal = document.getElementById("at-fs-modal");
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.getElementById("at-fs-password").value = "";
    if (restoreFocus !== false && loginReturnFocus && document.contains(loginReturnFocus)) loginReturnFocus.focus();
    loginReturnFocus = null;
  }
  function openCsvModal(title, html) {
    var modal = document.getElementById("at-csv-modal");
    csvReturnFocus = document.activeElement;
    document.getElementById("at-csv-title").textContent = title;
    document.getElementById("at-csv-content").innerHTML = html;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    modal.querySelector(".at-csv-dialog").focus();
  }
  function closeCsvModal(force) {
    var modal = document.getElementById("at-csv-modal");
    if (!modal) return;
    if (state.importInProgress && force !== true) {
      notify("가져오기가 끝날 때까지 기다려주세요.");
      return;
    }
    state.importInProgress = false;
    modal.removeAttribute("aria-busy");
    [document.getElementById("at-csv-close"), document.getElementById("at-csv-cancel")].forEach(function (control) {
      if (control) control.disabled = false;
    });
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    state.pendingVisitImport = null;
    state.pendingReservationImport = null;
    var focusTarget = csvReturnFocus && document.contains(csvReturnFocus) ? csvReturnFocus : document.querySelector('[data-at-view="' + state.view + '"]');
    if (focusTarget) focusTarget.focus();
    csvReturnFocus = null;
  }
  function openDashboard() {
    if (!requireAdminSession()) return;
    closeModal(false);
    document.getElementById("at-fs-dashboard").hidden = false;
    var tab = document.querySelector('[data-at-view="' + state.view + '"]');
    selectAdminView(state.view, tab, { focus: true });
  }

  function closeDashboard() {
    var dashboard = document.getElementById("at-fs-dashboard");
    if (dashboard) dashboard.hidden = true;
  }

  function clearPrivateState() {
    state.adminSessionVersion++;
    ["visits", "reservations"].forEach(function (type) {
      var list = state.lists[type];
      list.rows = [];
      list.loading = false;
      list.error = "";
      list.pageIndex = 0;
      list.signature = "";
      list.caches.clear();
      list.inFlight.clear();
      list.requestVersion++;
      list.countRequestVersion++;
      list.totalCount = null;
      list.countLoading = false;
      list.countError = "";
      state[type] = [];
    });
    state.visitTrash = [];
    state.settingsLoaded.activities = false;
    state.settingsLoaded.bookingSettings = false;
    state.settingsLoading.activities = null;
    state.settingsLoading.bookingSettings = null;
    state.settingsError.activities = "";
    state.settingsError.bookingSettings = "";
    state.pendingVisitImport = null;
    state.pendingReservationImport = null;
    state.maintenanceInFlight.clear();
    state.importInProgress = false;

    // Authentication changes must also remove personal data from hidden DOM,
    // not merely hide the dashboard or clear the in-memory arrays.
    var content = document.getElementById("at-ref-content");
    var csvContent = document.getElementById("at-csv-content");
    var csvModal = document.getElementById("at-csv-modal");
    var password = document.getElementById("at-fs-password");
    if (content) content.replaceChildren();
    if (csvContent) csvContent.replaceChildren();
    if (csvModal) {
      csvModal.hidden = true;
      csvModal.setAttribute("aria-hidden", "true");
      csvModal.removeAttribute("aria-busy");
    }
    if (password) password.value = "";
    csvReturnFocus = null;
  }

  async function login(event) {
    event.preventDefault();
    var submitButton = event.currentTarget.querySelector('[type="submit"]');
    if (submitButton.disabled) return;
    var password = document.getElementById("at-fs-password").value;
    setButtonPending(submitButton, true);
    try {
      var result = await state.api.signInWithEmailAndPassword(state.auth, state.config.auth.adminEmail, password);
      if (normalizedEmail(result.user.email) !== normalizedEmail(state.config.auth.adminEmail)) {
        await state.api.signOut(state.auth);
        throw new Error("auth/not-admin");
      }
      state.isAdmin = true;
      openDashboard();
    } catch (error) {
      console.error("[AdminTool] login failed", error);
      var message = error && (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password")
        ? "비밀번호가 올바르지 않습니다."
        : error && error.code === "auth/not-admin"
          ? "관리자 권한이 없는 계정입니다."
          : "관리자 로그인에 실패했습니다. Firebase 인증 설정을 확인하세요.";
      notify(message, "error");
    } finally {
      setButtonPending(submitButton, false);
    }
  }

  async function logout(event) {
    var button = event && event.currentTarget;
    if (button && button.disabled) return;
    setButtonPending(button, true);
    try {
      await state.api.signOut(state.auth);
      state.isAdmin = false;
      clearPrivateState();
      closeDashboard();
    } catch (error) {
      console.error("[AdminTool] logout failed", error);
      notify("로그아웃하지 못했습니다.", "error");
    } finally {
      setButtonPending(button, false);
    }
  }

  function groups() { return state.config.ageGroups || [{ label: "초등(9~13)", min: 9, max: 13 }, { label: "중등(14~16)", min: 14, max: 16 }, { label: "고등(17~19)", min: 17, max: 19 }, { label: "청년(20~24)", min: 20, max: 24 }, { label: "청년(25~39)", min: 25, max: 39 }, { label: "유아(~8)", min: 0, max: 8 }, { label: "성인(40~)", min: 40, max: Infinity }]; }
  function localDateKey(date) { return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0"); }
  function recordDateKey(item) { if (item.dateKey) return String(item.dateKey); var value = item.createdAt, date = value && typeof value.toDate === "function" ? value.toDate() : new Date(value); return isNaN(date) ? "" : localDateKey(date); }
  function inRange(item) {
    if (state.filter === "all") return true;
    var key = recordDateKey(item);
    if (!key) return false;
    if (state.filter === "month") return key.slice(0, 7) === state.filterYear + "-" + String(state.filterMonth).padStart(2, "0");
    return state.filter !== "custom" || (key >= state.rangeStart && key <= state.rangeEnd);
  }

  function localBoundaryIso(year, monthIndex, day) {
    return new Date(year, monthIndex, day, 0, 0, 0, 0).toISOString();
  }

  function dateRangeForCurrentFilter() {
    if (state.filter === "month") {
      return {
        start: localBoundaryIso(state.filterYear, state.filterMonth - 1, 1),
        end: localBoundaryIso(state.filterYear, state.filterMonth, 1)
      };
    }
    if (state.filter === "custom" && state.rangeStart && state.rangeEnd) {
      var startParts = state.rangeStart.split("-").map(Number);
      var endParts = state.rangeEnd.split("-").map(Number);
      return {
        start: localBoundaryIso(startParts[0], startParts[1] - 1, startParts[2]),
        end: localBoundaryIso(endParts[0], endParts[1] - 1, endParts[2] + 1)
      };
    }
    return null;
  }

  function collectionNameFor(type) {
    return type === "visits" ? state.config.collections.visits : state.config.collections.reservations;
  }

  function listNoun(type) {
    return type === "visits" ? "방문 등록 내역" : "시설 예약 현황";
  }

  function querySignature(type) {
    var range = dateRangeForCurrentFilter();
    return JSON.stringify({
      collection: collectionNameFor(type),
      filter: state.filter,
      range: range,
      search: state.recordSearch[type] || "",
      order: "createdAt:desc",
      size: PAGE_SIZE
    });
  }

  function firestoreWhereConstraints(type) {
    var constraints = [];
    var range = dateRangeForCurrentFilter();
    var search = String(state.recordSearch[type] || "").trim();
    if (range) {
      constraints.push(state.api.where("createdAt", ">=", range.start));
      constraints.push(state.api.where("createdAt", "<", range.end));
    }
    if (type === "visits" && search) constraints.push(state.api.where("name", "==", search));
    if (type === "reservations" && search) constraints.push(state.api.where("facility", "==", search));
    return constraints;
  }

  function buildListQuery(type, cursor, pageLimit) {
    var source = state.api.collection(state.db, collectionNameFor(type));
    var constraints = firestoreWhereConstraints(type);
    constraints.push(state.api.orderBy("createdAt", "desc"));
    if (cursor) constraints.push(state.api.startAfter(cursor));
    constraints.push(state.api.limit(pageLimit || PAGE_QUERY_LIMIT));
    return state.api.query.apply(null, [source].concat(constraints));
  }

  function buildCountQuery(type) {
    var source = state.api.collection(state.db, collectionNameFor(type));
    var constraints = firestoreWhereConstraints(type);
    // Match the list's ordering so compound count queries reuse the declared
    // name/facility + createdAt DESC indexes and exclude the same legacy rows.
    constraints.push(state.api.orderBy("createdAt", "desc"));
    return state.api.query.apply(null, [source].concat(constraints));
  }

  function cacheForSignature(type, signature) {
    var list = state.lists[type];
    if (!list.caches.has(signature)) {
      if (list.caches.size >= MAX_QUERY_CACHE_ENTRIES) {
        var oldestSignature = list.caches.keys().next().value;
        list.caches.delete(oldestSignature);
      }
      list.caches.set(signature, { pages: new Map(), cursors: [null], countLoaded: false, count: null });
    }
    return list.caches.get(signature);
  }

  function applyCachedPage(type, signature, pageIndex, page) {
    var list = state.lists[type];
    list.signature = signature;
    list.pageIndex = pageIndex;
    list.rows = page.items.slice();
    list.error = "";
    state[type] = list.rows;
  }

  function activateListSignature(type, signature) {
    var list = state.lists[type];
    if (list.signature === signature) return;
    list.rows = [];
    state[type] = [];
    list.totalCount = null;
    list.countError = "";
    list.error = "";
    list.pageIndex = 0;
    list.requestVersion++;
    list.countRequestVersion++;
    // Requests already on the wire cannot be cancelled, but they must not be
    // reused if the operator leaves a filter and quickly returns to it.
    list.inFlight.clear();
    list.signature = signature;
  }

  async function loadListPage(type, options) {
    options = options || {};
    if (!requireAdminSession()) return false;
    var list = state.lists[type];
    var signature = querySignature(type);
    var pageIndex = options.pageIndex == null ? list.pageIndex : Math.max(0, Number(options.pageIndex));
    activateListSignature(type, signature);
    var signatureCache = cacheForSignature(type, signature);
    var cached = signatureCache.pages.get(pageIndex);
    if (cached && !options.force) {
      applyCachedPage(type, signature, pageIndex, cached);
      safeRender(type);
      return true;
    }
    var cursor = pageIndex === 0 ? null : signatureCache.cursors[pageIndex];
    if (pageIndex > 0 && !cursor) return false;
    var requestKey = signature + "::page:" + pageIndex;
    if (list.inFlight.has(requestKey)) return list.inFlight.get(requestKey);
    var version = ++list.requestVersion;
    list.loading = true;
    list.error = "";
    list.signature = signature;
    list.pageIndex = pageIndex;
    safeRender(type);
    var request = (async function () {
      try {
        var snapshot = await state.api.getDocs(buildListQuery(type, cursor, PAGE_QUERY_LIMIT));
        if (version !== list.requestVersion || !state.isAdmin || signature !== querySignature(type)) return false;
        var visibleDocs = snapshot.docs.slice(0, PAGE_SIZE);
        var page = {
          items: visibleDocs.map(function (item) { return Object.assign({ id: item.id }, item.data()); }),
          hasNext: snapshot.docs.length > PAGE_SIZE,
          firstSnapshot: visibleDocs[0] || null,
          lastSnapshot: visibleDocs[visibleDocs.length - 1] || null
        };
        signatureCache.pages.set(pageIndex, page);
        if (signatureCache.pages.size > MAX_CACHED_PAGES) {
          var oldestPageIndex = signatureCache.pages.keys().next().value;
          if (oldestPageIndex !== pageIndex) signatureCache.pages.delete(oldestPageIndex);
        }
        if (page.hasNext && page.lastSnapshot) signatureCache.cursors[pageIndex + 1] = page.lastSnapshot;
        else signatureCache.cursors.length = pageIndex + 1;
        applyCachedPage(type, signature, pageIndex, page);
        return true;
      } catch (error) {
        logFirestoreError(listNoun(type) + " query", error);
        if (version === list.requestVersion) {
          list.rows = [];
          state[type] = [];
          list.error = firestoreErrorMessage(error, listNoun(type));
        }
        return false;
      } finally {
        if (list.inFlight.get(requestKey) === request) list.inFlight.delete(requestKey);
        if (version === list.requestVersion) {
          list.loading = false;
          safeRender(type);
        }
      }
    })();
    list.inFlight.set(requestKey, request);
    return request;
  }

  async function loadAggregateCount(type, options) {
    options = options || {};
    if (!requireAdminSession()) return false;
    var list = state.lists[type];
    var signature = querySignature(type);
    activateListSignature(type, signature);
    var signatureCache = cacheForSignature(type, signature);
    if (signatureCache.countLoaded && !options.force) {
      list.totalCount = signatureCache.count;
      safeRender(type);
      return true;
    }
    list.totalCount = null;
    var requestKey = signature + "::count";
    if (list.inFlight.has(requestKey)) return list.inFlight.get(requestKey);
    var version = ++list.countRequestVersion;
    list.countLoading = true;
    list.countError = "";
    safeRender(type);
    var request = (async function () {
      try {
        var snapshot = await state.api.getCountFromServer(buildCountQuery(type));
        if (version !== list.countRequestVersion || !state.isAdmin || signature !== querySignature(type)) return false;
        signatureCache.count = snapshot.data().count;
        signatureCache.countLoaded = true;
        list.totalCount = signatureCache.count;
        return true;
      } catch (error) {
        logFirestoreError(listNoun(type) + " aggregate", error);
        if (version === list.countRequestVersion) {
          list.totalCount = null;
          list.countError = firestoreErrorMessage(error, listNoun(type) + " 건수");
        }
        return false;
      } finally {
        if (list.inFlight.get(requestKey) === request) list.inFlight.delete(requestKey);
        if (version === list.countRequestVersion) {
          list.countLoading = false;
          safeRender(type);
        }
      }
    })();
    list.inFlight.set(requestKey, request);
    return request;
  }

  function loadListView(type, options) {
    return Promise.all([loadListPage(type, options), loadAggregateCount(type, options)]);
  }

  async function loadSettingsView(view, force) {
    if (!requireAdminSession()) return false;
    var sessionVersion = state.adminSessionVersion;
    var key = view === "activities" ? "activities" : "bookingSettings";
    if (state.settingsLoaded[key] && !force) { render(); return true; }
    if (state.settingsLoading[key]) return state.settingsLoading[key];
    state.settingsError[key] = "";
    render();
    var request = Promise.resolve().then(async function () {
      try {
        var snapshot = await state.api.getDoc(state.api.doc(state.db, state.config.collections.settings, key));
        if (!state.isAdmin || !hasAdminSession() || sessionVersion !== state.adminSessionVersion) return false;
        if (key === "activities") {
          var items = snapshot.exists() && snapshot.data().items;
          if (Array.isArray(items) && items.length > 0 && items.length <= MAX_ACTIVITIES) state.activities = items;
        } else {
          state.bookingSettings = normalizedBookingSettings(snapshot.exists() ? snapshot.data() : {});
        }
        state.settingsLoaded[key] = true;
        return true;
      } catch (error) {
        logFirestoreError(key + " setting query", error);
        state.settingsError[key] = firestoreErrorMessage(error, key === "activities" ? "활동 카드 설정" : "운영·안내 설정");
        return false;
      } finally {
        if (state.settingsLoading[key] === request) state.settingsLoading[key] = null;
        if (state.view === view) render();
      }
    });
    state.settingsLoading[key] = request;
    return request;
  }

  function updateSelectedAdminTab(view, focus) {
    var root = document.getElementById("admin-root");
    if (!root) return;
    root.querySelectorAll("[data-at-view]").forEach(function (item) {
      var selected = item.dataset.atView === view;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
      if (selected) document.getElementById("at-ref-content").setAttribute("aria-labelledby", item.id);
      if (selected && focus) item.focus();
    });
  }

  function selectAdminView(view, button, options) {
    if (!requireAdminSession()) return;
    state.view = view;
    updateSelectedAdminTab(view, options && options.focus);
    if (view === "visits" || view === "reservations") {
      state.lists[view].pageIndex = 0;
      loadListView(view, { pageIndex: 0 });
    } else {
      render();
      loadSettingsView(view, false);
    }
  }

  function invalidateListCache(type) {
    var list = state.lists[type];
    var signature = querySignature(type);
    list.caches.clear();
    var replacement = { pages: new Map(), cursors: [null], countLoaded: false, count: null };
    list.caches.set(signature, replacement);
    list.pageIndex = 0;
    list.requestVersion++;
    list.countRequestVersion++;
    list.inFlight.clear();
    list.totalCount = null;
    list.error = "";
  }

  async function refreshCurrentList(type) {
    if (state.view !== type || !state.isAdmin) return;
    invalidateListCache(type);
    await loadListView(type, { pageIndex: 0, force: true });
  }
  function currentActivityName(name) {
    if (name === "인생네컷") name = "유스네컷";
    var activity = state.activities.find(function (item) { return item.name === name || (item.aliases || []).includes(name); });
    return activity ? activity.name : name;
  }
  function purposeList(records) {
    var configured = state.config.visitPurposes || [];
    if (configured.length) return configured;
    var currentNames = state.activities.map(function (item) { return item.name; });
    var recordedNames = records.reduce(function (all, row) { return all.concat((row.activities || []).map(currentActivityName)); }, []);
    return Array.from(new Set(currentNames.concat(recordedNames)));
  }
  function facilityList(records) {
    var configured = state.config.facilities || [];
    var recorded = records.map(function (row) { return row.facility; }).filter(Boolean);
    return Array.from(new Set(configured.concat(recorded)));
  }
  function statsTable(records, purposes, memberMode, ar) {
    var gs = groups().map(function (group) { return Object.assign({}, group); }), totals = {};
    gs.push({ label: "미분류", unclassified: true });
    purposes.forEach(function (p) { totals[p] = gs.map(function () { return [0, 0]; }); });
    records.filter(inRange).forEach(function (row) { var people = memberMode ? (row.members || []) : [row]; var ps = memberMode ? [row.facility || "시설 미지정"] : (row.activities || []).map(currentActivityName); people.forEach(function (person) { var age = Number(person.age), gi = gs.findIndex(function (g) { return !g.unclassified && age >= g.min && age <= g.max; }); if (gi < 0) gi = gs.length - 1; ps.forEach(function (p) { if (totals[p]) totals[p][gi][person.gender === "여성" ? 1 : 0]++; }); }); });
    var colTotal = function (cells, predicate) { return cells.reduce(function (sum, pair, i) { return sum + (predicate ? (predicate(gs[i]) ? pair[0] + pair[1] : 0) : pair[0] + pair[1]); }, 0); };
    var head = '<thead><tr><th rowspan="2">' + (memberMode ? "이용 목적" : "이용 목적") + '</th>' + gs.map(function (g) { return '<th colspan="2">' + esc(g.label) + '</th>'; }).join("") + '<th rowspan="2" class="' + (ar ? 'at-ar-sum-col' : 'at-sum-col') + '">청소년 합계</th><th rowspan="2" class="' + (ar ? 'at-ar-sum-col' : 'at-sum-col') + '">청년 합계</th><th rowspan="2" class="at-total-sum-col">전체 합계</th></tr><tr class="at-gender-header">' + gs.map(function () { return '<th class="at-male">남</th><th class="at-female">여</th>'; }).join("") + '</tr></thead>';
    var body = purposes.map(function (p) { var cells = totals[p]; return '<tr class="at-category-row"><td>' + esc(p) + '</td>' + cells.map(function (pair) { return '<td>' + pair[0] + '</td><td>' + pair[1] + '</td>'; }).join("") + '<td class="' + (ar ? 'at-ar-sum-col' : 'at-sum-col') + '">' + colTotal(cells, function (g) { return g.max <= 19; }) + '</td><td class="' + (ar ? 'at-ar-sum-col' : 'at-sum-col') + '">' + colTotal(cells, function (g) { return g.min >= 20 && g.max <= 39; }) + '</td><td class="at-total-sum-col">' + colTotal(cells) + '</td></tr>'; }).join("");
    var grand = gs.map(function (_, gi) { return purposes.reduce(function (pair, p) { pair[0] += totals[p][gi][0]; pair[1] += totals[p][gi][1]; return pair; }, [0, 0]); });
    var foot = '<tfoot><tr><th>전체 합계</th>' + grand.map(function (pair) { return '<th>' + pair[0] + '</th><th>' + pair[1] + '</th>'; }).join("") + '<th>' + colTotal(grand, function (g) { return g.max <= 19; }) + '</th><th>' + colTotal(grand, function (g) { return g.min >= 20 && g.max <= 39; }) + '</th><th>' + colTotal(grand) + '</th></tr></tfoot>';
    return '<div class="at-stats-container ' + (ar ? 'at-ar-border' : '') + '"><div class="at-stats-wrapper"><table class="at-stats-table">' + head + '<tbody>' + body + '</tbody>' + foot + '</table></div></div>';
  }
  function renderActivitySettings() {
    var content = document.getElementById("at-ref-content");
    if (!content) return;
    var rows = state.activities.map(function (activity, index) {
      return '<div class="at-activity-setting-row"><strong>' + (index + 1) + '</strong><label>활동명<input data-activity-name="' + esc(activity.id) + '" value="' + esc(activity.name) + '" maxlength="20"></label><label>이모지<input data-activity-emoji="' + esc(activity.id) + '" value="' + esc(activity.emoji) + '" maxlength="8"></label><button type="button" class="at-activity-delete" data-delete-activity="' + esc(activity.id) + '" aria-label="' + esc(activity.name) + ' 활동 카드 삭제">삭제</button></div>';
    }).join("");
    content.innerHTML = '<section class="at-activity-settings"><h2>방문 등록 활동 카드 관리</h2><p>사진 서비스 가입 없이 이모지로 카드를 꾸밀 수 있습니다. 카드는 1~' + MAX_ACTIVITIES + '개까지 추가·삭제할 수 있으며, 저장 후 방문 등록 화면을 새로고침하면 반영됩니다.</p><div class="at-activity-setting-list">' + rows + '</div><div class="at-activity-actions"><button type="button" id="at-add-activity" class="at-activity-add"' + (state.activities.length >= MAX_ACTIVITIES ? ' disabled' : '') + '>+ 활동 카드 추가</button><button type="button" id="at-save-activities" class="at-activity-save">활동 카드 저장</button></div></section>';
    document.getElementById("at-save-activities").onclick = saveActivitySettings;
    document.getElementById("at-add-activity").onclick = addActivity;
    content.querySelectorAll("[data-delete-activity]").forEach(function (button) { button.onclick = function () { removeActivity(button.dataset.deleteActivity); }; });
  }
  function readActivityInputs() {
    return state.activities.map(function (activity) {
      var nameInput = document.querySelector('[data-activity-name="' + activity.id + '"]');
      var emojiInput = document.querySelector('[data-activity-emoji="' + activity.id + '"]');
      return { id: activity.id, name: nameInput ? nameInput.value.trim() : activity.name, emoji: emojiInput ? emojiInput.value.trim() : activity.emoji, aliases: activity.aliases || [] };
    });
  }
  function addActivity() {
    state.activities = readActivityInputs();
    if (state.activities.length >= MAX_ACTIVITIES) { notify("활동 카드는 최대 " + MAX_ACTIVITIES + "개까지 추가할 수 있습니다.", "error"); return; }
    var number = state.activities.length + 1;
    var name = "새 활동 " + number;
    while (state.activities.some(function (item) { return item.name === name; })) { number++; name = "새 활동 " + number; }
    state.activities.push({ id: "activity-" + Date.now() + "-" + number, name: name, emoji: "✨", aliases: [] });
    renderActivitySettings();
  }
  function removeActivity(id) {
    state.activities = readActivityInputs();
    if (state.activities.length <= 1) { notify("활동 카드는 최소 1개가 필요합니다.", "error"); return; }
    state.activities = state.activities.filter(function (activity) { return activity.id !== id; });
    renderActivitySettings();
  }
  async function saveActivitySettings() {
    var items = readActivityInputs().map(function (item) {
      var previous = state.activities.find(function (activity) { return activity.id === item.id; });
      var aliases = new Set(item.aliases || []);
      if (previous && previous.name !== item.name) aliases.add(previous.name);
      aliases.delete(item.name);
      item.aliases = Array.from(aliases);
      return item;
    });
    if (items.some(function (item) { return !item.name; })) { notify("활동명을 모두 입력해주세요.", "error"); return; }
    if (new Set(items.map(function (item) { return item.name; })).size !== items.length) { notify("활동명은 서로 다르게 입력해주세요.", "error"); return; }
    var button = document.getElementById("at-save-activities");
    if (button.disabled) return;
    setButtonPending(button, true);
    try {
      await state.api.setDoc(state.api.doc(state.db, state.config.collections.settings, "activities"), { items: items, updatedAt: new Date().toISOString() });
      state.activities = items;
      state.settingsLoaded.activities = true;
      state.settingsError.activities = "";
      notify("활동 카드가 저장되었습니다.", "success");
    } catch (error) {
      logFirestoreError("activity settings save", error);
      notify(firestoreErrorMessage(error, "활동 카드 저장"), "error");
    } finally {
      setButtonPending(button, false);
    }
  }

  function renderBookingSettings() {
    var content = document.getElementById("at-ref-content");
    if (!content) return;
    var settings = state.bookingSettings || normalizedBookingSettings();
    var schedule = settings.schedule;
    var noticeRows = state.config.facilities.map(function (facility) {
      var notice = settings.notices[facility] || { enabled: false, message: "" };
      var label = facility === "노래방1" ? "노래방 1실" : facility === "노래방2" ? "노래방 2실" : facility;
      return '<div class="at-booking-notice-row"><div><strong>' + esc(label) + '</strong><label class="at-switch-label"><input type="checkbox" data-notice-enabled="' + esc(facility) + '"' + (notice.enabled ? ' checked' : '') + '> 안내 사용</label></div><textarea data-notice-message="' + esc(facility) + '" maxlength="300" placeholder="이용 전 안내 문구를 입력하세요.">' + esc(notice.message) + '</textarea></div>';
    }).join("");
    content.innerHTML = '<section class="at-booking-settings"><h2>시설 운영시간 및 이용 안내</h2><p>저장 후 시설 예약 화면을 새로고침하면 반영됩니다.</p><div class="at-schedule-grid"><fieldset><legend>평일 운영시간</legend><label>시작<input id="at-weekday-start" type="time" value="' + esc(schedule.weekday.start) + '"></label><label>종료<input id="at-weekday-end" type="time" value="' + esc(schedule.weekday.end) + '"></label></fieldset><fieldset><legend>주말 운영시간</legend><label>시작<input id="at-weekend-start" type="time" value="' + esc(schedule.weekend.start) + '"></label><label>종료<input id="at-weekend-end" type="time" value="' + esc(schedule.weekend.end) + '"></label></fieldset><fieldset><legend>점심시간</legend><label class="at-switch-label"><input id="at-lunch-enabled" type="checkbox"' + (schedule.lunch.enabled ? ' checked' : '') + '> 점심시간 제외</label><label>시작<input id="at-lunch-start" type="time" value="' + esc(schedule.lunch.start) + '"></label><label>종료<input id="at-lunch-end" type="time" value="' + esc(schedule.lunch.end) + '"></label></fieldset></div><div class="at-notice-settings"><h3>시설별 이용 전 안내</h3>' + noticeRows + '</div><button type="button" id="at-save-booking-settings" class="at-booking-save">운영·안내 설정 저장</button></section>';
    document.getElementById("at-save-booking-settings").onclick = saveBookingSettings;
  }

  async function saveBookingSettings() {
    var weekday = { start: document.getElementById("at-weekday-start").value, end: document.getElementById("at-weekday-end").value };
    var weekend = { start: document.getElementById("at-weekend-start").value, end: document.getElementById("at-weekend-end").value };
    var lunch = { enabled: document.getElementById("at-lunch-enabled").checked, start: document.getElementById("at-lunch-start").value, end: document.getElementById("at-lunch-end").value };
    if (!weekday.start || !weekday.end || weekday.start >= weekday.end || !weekend.start || !weekend.end || weekend.start >= weekend.end) { notify("운영 시작·종료 시간을 올바르게 입력해주세요.", "error"); return; }
    if (lunch.enabled && (!lunch.start || !lunch.end || lunch.start >= lunch.end)) { notify("점심시간을 올바르게 입력해주세요.", "error"); return; }
    var notices = {};
    state.config.facilities.forEach(function (facility) {
      var enabled = document.querySelector('[data-notice-enabled="' + facility + '"]').checked;
      var message = document.querySelector('[data-notice-message="' + facility + '"]').value.trim();
      notices[facility] = { enabled: enabled, message: message };
    });
    if (Object.keys(notices).some(function (facility) { return notices[facility].enabled && !notices[facility].message; })) { notify("사용 중인 시설 안내 문구를 입력해주세요.", "error"); return; }
    var settings = { schedule: { weekday: weekday, weekend: weekend, lunch: lunch }, notices: notices, updatedAt: new Date().toISOString() };
    var button = document.getElementById("at-save-booking-settings");
    if (button.disabled) return;
    setButtonPending(button, true);
    try {
      await state.api.setDoc(state.api.doc(state.db, state.config.collections.settings, "bookingSettings"), settings);
      state.bookingSettings = settings;
      state.settingsLoaded.bookingSettings = true;
      state.settingsError.bookingSettings = "";
      notify("운영시간과 시설 안내가 저장되었습니다.", "success");
    } catch (error) {
      logFirestoreError("booking settings save", error);
      notify(firestoreErrorMessage(error, "운영·안내 설정 저장"), "error");
    } finally {
      setButtonPending(button, false);
    }
  }

  function currentPeriodLabel() {
    if (state.filter === "month") return state.filterYear + "년 " + state.filterMonth + "월";
    if (state.filter === "custom") return state.rangeStart + " ~ " + state.rangeEnd;
    return "전체 기간";
  }

  function overviewCards(records, isAr, list) {
    var peopleCount = records.reduce(function (sum, row) { return sum + (isAr ? (row.members || []).length : 1); }, 0);
    var categories = new Set();
    records.forEach(function (row) {
      if (isAr) { if (row.facility) categories.add(row.facility); }
      else (row.activities || []).forEach(function (activity) { categories.add(currentActivityName(activity)); });
    });
    var total = list.totalCount == null ? (list.countLoading ? "…" : "—") : list.totalCount.toLocaleString();
    return '<section class="at-overview-grid" aria-label="' + (isAr ? '시설 예약' : '방문 등록') + ' 요약">' +
      '<article class="at-overview-card"><span class="at-overview-label">조건 일치 전체 건수</span><strong class="at-overview-value">' + total + (list.totalCount == null ? '' : '건') + '</strong><span class="at-overview-note">서버 집계 · ' + esc(currentPeriodLabel()) + '</span></article>' +
      '<article class="at-overview-card"><span class="at-overview-label">현재 페이지</span><strong class="at-overview-value">' + records.length.toLocaleString() + '건</strong><span class="at-overview-note">페이지당 최대 ' + PAGE_SIZE + '건</span></article>' +
      '<article class="at-overview-card"><span class="at-overview-label">현재 페이지 이용 인원</span><strong class="at-overview-value">' + peopleCount.toLocaleString() + '명</strong><span class="at-overview-note">목록에 표시된 데이터</span></article>' +
      '<article class="at-overview-card"><span class="at-overview-label">현재 페이지 분류수</span><strong class="at-overview-value">' + categories.size.toLocaleString() + '개</strong><span class="at-overview-note">' + (isAr ? '시설 종류' : '활동 종류') + '</span></article>' +
    '</section>';
  }

  function dataStateCard(options) {
    var loading = options.loading;
    if (loading) return '<section class="at-data-state-card is-loading" role="status" aria-live="polite" aria-busy="true"><strong>' + esc(options.title) + '</strong><p>' + esc(options.message || "잠시만 기다려주세요.") + '</p></section>';
    return '<section class="at-data-state-card is-error" role="alert"><strong>' + esc(options.title) + '</strong><p>' + esc(options.message || "잠시 후 다시 시도해주세요.") + '</p><button type="button" class="at-state-retry" id="at-state-retry">다시 조회</button></section>';
  }

  function settingsState(view) {
    var key = view === "activities" ? "activities" : "bookingSettings";
    var noun = view === "activities" ? "활동 카드 설정" : "운영·안내 설정";
    if (state.settingsError[key]) return dataStateCard({ title: noun + "을 불러오지 못했습니다.", message: state.settingsError[key] });
    return dataStateCard({ loading: true, title: noun + "을 불러오는 중입니다.", message: "이 탭에 필요한 설정 문서 1개만 조회합니다." });
  }

  function yearOptions() {
    var currentYear = new Date().getFullYear();
    return Array.from({ length: 11 }, function (_, index) { return currentYear - index; });
  }

  function filterMarkup(type) {
    var years = yearOptions();
    var monthControls = state.filter === "month" ? '<div class="at-ref-month-range"><select id="at-ref-year" aria-label="조회 연도">' + years.map(function (year) { return '<option value="' + year + '"' + (year === state.filterYear ? ' selected' : '') + '>' + year + '년</option>'; }).join("") + '</select><select id="at-ref-month" aria-label="조회 월">' + Array.from({ length: 12 }, function (_, index) { var month = index + 1; return '<option value="' + month + '"' + (month === state.filterMonth ? ' selected' : '') + '>' + month + '월</option>'; }).join("") + '</select></div>' : '';
    var customControls = state.filter === "custom" ? '<div class="at-ref-date-range"><input id="at-ref-start-date" type="date" aria-label="시작일" value="' + esc(state.rangeStart) + '"><span aria-hidden="true">~</span><input id="at-ref-end-date" type="date" aria-label="종료일" value="' + esc(state.rangeEnd) + '"></div>' : '';
    var searchControl = type === "visits"
      ? '<label class="at-record-search"><span>방문자 정확한 이름</span><input id="at-record-search" type="search" autocomplete="off" value="' + esc(state.recordSearch.visits) + '" placeholder="예: 홍길동"></label>'
      : '<label class="at-record-search"><span>시설</span><select id="at-record-search"><option value="">전체 시설</option>' + facilityList([]).map(function (facility) { return '<option value="' + esc(facility) + '"' + (state.recordSearch.reservations === facility ? ' selected' : '') + '>' + esc(facility === "노래방1" ? "노래방 1실" : facility === "노래방2" ? "노래방 2실" : facility) + '</option>'; }).join("") + '</select></label>';
    return '<section class="at-ref-filter" aria-labelledby="at-filter-label"><div class="at-filter-copy"><strong id="at-filter-label">검색 및 기간 필터</strong><span>조건은 Firestore 서버 쿼리에 적용됩니다.</span></div><form id="at-query-form"><div class="at-filter-modes" role="group" aria-labelledby="at-filter-label"><button type="button" data-filter="all" aria-pressed="' + (state.filter === 'all') + '" class="' + (state.filter === 'all' ? 'is-current' : '') + '">전체</button><button type="button" data-filter="month" aria-pressed="' + (state.filter === 'month') + '" class="' + (state.filter === 'month' ? 'is-current' : '') + '">월별</button><button type="button" data-filter="custom" aria-pressed="' + (state.filter === 'custom') + '" class="' + (state.filter === 'custom' ? 'is-current' : '') + '">지정 기간</button></div>' + monthControls + customControls + searchControl + '<div class="at-query-actions"><button type="button" id="at-query-clear">초기화</button><button type="submit" class="is-primary">조회</button></div></form></section>';
  }

  function render() {
    var content = document.getElementById("at-ref-content"); if (!content) return;
    var date = document.getElementById("at-ref-date");
    if (date) date.textContent = new Date().toLocaleDateString("ko-KR").replace(/\. /g, ".").replace(/\.$/, "");
    if (state.view === "activities") {
      if (!state.settingsLoaded.activities) { content.innerHTML = settingsState("activities"); bindStateRetry(function () { loadSettingsView("activities", true); }); return; }
      renderActivitySettings(); return;
    }
    if (state.view === "booking-settings") {
      if (!state.settingsLoaded.bookingSettings) { content.innerHTML = settingsState("booking-settings"); bindStateRetry(function () { loadSettingsView("booking-settings", true); }); return; }
      renderBookingSettings(); return;
    }
    var type = state.view;
    var isAr = type === "reservations";
    var list = state.lists[type];
    if (list.loading && !list.rows.length) { content.innerHTML = dataStateCard({ loading: true, title: listNoun(type) + "을 불러오는 중입니다.", message: "최대 " + PAGE_SIZE + "건만 안전하게 조회합니다." }); return; }
    if (list.error) { content.innerHTML = dataStateCard({ title: listNoun(type) + "을 불러오지 못했습니다.", message: list.error }); bindStateRetry(function () { loadListView(type, { pageIndex: list.pageIndex, force: true }); }); return; }
    var records = list.rows;
    var purposes = isAr ? facilityList(records) : purposeList(records);
    var title = isAr ? "현재 페이지 시설 이용 통계" : "현재 페이지 이용 목적 및 연령 통계";
    var recordActions = isAr
      ? '<input id="at-reservation-csv-input" type="file" accept=".csv,text/csv" aria-label="시설예약 CSV 파일 선택" hidden><button type="button" class="at-reservation-import-btn" id="at-reservation-import" aria-controls="at-reservation-csv-input">＋ 예약 CSV 불러오기</button>'
      : '<input id="at-visit-csv-input" type="file" accept=".csv,text/csv" aria-label="방문 기록 CSV 파일 선택" hidden><button type="button" class="at-visit-import-btn" id="at-visit-import" aria-controls="at-visit-csv-input">＋ CSV 불러오기</button><button type="button" class="at-visit-backup-btn" id="at-visit-backup">⇩ 백업 CSV</button><button type="button" class="at-visit-trash-btn" id="at-visit-trash" aria-haspopup="dialog">♻ 휴지통</button>';
    content.innerHTML = '<div class="at-page-heading"><div><span class="at-page-eyebrow">ADMIN DATA</span><h1>' + (isAr ? '시설 예약 현황' : '방문 등록 내역') + '</h1><p>필요한 페이지와 집계만 서버에서 조회합니다.</p></div><button type="button" id="at-refresh-list" class="at-refresh-btn"' + (list.loading ? ' disabled aria-busy="true"' : '') + '>↻ 새로고침</button></div>' + overviewCards(records, isAr, list) + (list.countError ? '<p class="at-inline-warning" role="status">' + esc(list.countError) + '</p>' : '') + filterMarkup(type) + '<section class="at-ref-section"><div class="at-section-heading"><div><span>현재 페이지 기준</span><h2>' + (isAr ? '✓' : '▥') + ' ' + title + '</h2></div></div>' + statsTable(records, purposes, isAr, isAr) + '<div class="at-log-header"><div><h2 class="at-log-title">상세 ' + (isAr ? '시설 예약' : '방문') + ' 내역</h2><p>최신순 · 페이지당 ' + PAGE_SIZE + '건</p></div><div class="at-log-actions">' + recordActions + '<button type="button" class="at-excel-btn ' + (isAr ? 'at-indigo-btn' : '') + '" id="at-ref-export" aria-label="현재 조건의 ' + (isAr ? '시설 예약' : '방문 등록') + ' 보고서 CSV 다운로드">⇩ 보고서 CSV</button><span class="at-count-badge ' + (isAr ? 'at-indigo-badge' : 'at-blue-badge') + '">' + records.length + '건</span></div></div><div class="at-log-table-wrap"><table class="at-log-table"><thead class="at-log-thead">' + (isAr ? '<tr><th>예약날짜</th><th>예약시간</th><th>시설</th><th>대표자</th><th>총 인원</th><th>이용자 명단</th><th>관리</th></tr>' : '<tr><th>날짜</th><th>시간</th><th>이름</th><th>성별</th><th>나이</th><th>목적</th><th>관리</th></tr>') + '</thead><tbody id="at-fs-body"></tbody></table></div><div id="at-visit-pager"></div></section>';
    bindListControls(type);
    renderTable(type);
  }

  function bindStateRetry(callback) {
    var button = document.getElementById("at-state-retry");
    if (button) button.onclick = callback;
  }

  function applyListQueryFromControls(type) {
    var search = document.getElementById("at-record-search");
    if (state.filter === "month") {
      state.filterYear = Number(document.getElementById("at-ref-year").value);
      state.filterMonth = Number(document.getElementById("at-ref-month").value);
    }
    if (state.filter === "custom") {
      var start = document.getElementById("at-ref-start-date").value;
      var end = document.getElementById("at-ref-end-date").value;
      if (!start || !end || start > end) { notify("시작일과 종료일을 올바르게 선택해주세요.", "error"); return; }
      state.rangeStart = start;
      state.rangeEnd = end;
    }
    state.recordSearch[type] = search ? search.value.trim() : "";
    state.lists[type].pageIndex = 0;
    loadListView(type, { pageIndex: 0 });
  }

  function bindListControls(type) {
    var isAr = type === "reservations";
    var queryForm = document.getElementById("at-query-form");
    queryForm.addEventListener("focusout", function () {
      var draft = {};
      queryForm.querySelectorAll("input[id], select[id]").forEach(function (control) { draft[control.id] = control.value; });
      setTimeout(function () {
        if (state.view !== type || queryForm.contains(document.activeElement)) return;
        // A deferred Firestore response may have been held while the operator
        // typed. Render it after focus leaves, then restore the unsubmitted draft.
        render();
        Object.keys(draft).forEach(function (id) {
          var control = document.getElementById(id);
          if (control) control.value = draft[id];
        });
      }, 0);
    });
    document.querySelectorAll("#at-query-form [data-filter]").forEach(function (button) {
      button.onclick = function () {
        var currentSearch = document.getElementById("at-record-search");
        if (currentSearch) state.recordSearch[type] = currentSearch.value.trim();
        var currentYear = document.getElementById("at-ref-year");
        var currentMonth = document.getElementById("at-ref-month");
        if (currentYear) state.filterYear = Number(currentYear.value);
        if (currentMonth) state.filterMonth = Number(currentMonth.value);
        var currentStart = document.getElementById("at-ref-start-date");
        var currentEnd = document.getElementById("at-ref-end-date");
        if (currentStart && currentStart.value) state.rangeStart = currentStart.value;
        if (currentEnd && currentEnd.value) state.rangeEnd = currentEnd.value;
        state.filter = button.dataset.filter;
        if (state.filter === "custom" && !state.rangeStart) { state.rangeStart = localDateKey(new Date()); state.rangeEnd = state.rangeStart; }
        render();
        applyListQueryFromControls(type);
      };
    });
    queryForm.onsubmit = function (event) { event.preventDefault(); applyListQueryFromControls(type); };
    document.getElementById("at-query-clear").onclick = function () {
      state.filter = "all";
      state.recordSearch[type] = "";
      state.lists[type].pageIndex = 0;
      loadListView(type, { pageIndex: 0 });
    };
    document.getElementById("at-refresh-list").onclick = function () { invalidateListCache(type); loadListView(type, { pageIndex: 0, force: true }); };
    if (isAr) {
      document.getElementById("at-reservation-import").onclick = function () { document.getElementById("at-reservation-csv-input").click(); };
      document.getElementById("at-reservation-csv-input").onchange = selectReservationCsv;
    } else {
      document.getElementById("at-visit-import").onclick = function () { document.getElementById("at-visit-csv-input").click(); };
      document.getElementById("at-visit-csv-input").onchange = selectVisitCsv;
      document.getElementById("at-visit-backup").onclick = function (event) { backupVisitCsv(event.currentTarget); };
      document.getElementById("at-visit-trash").onclick = showVisitTrash;
    }
    document.getElementById("at-ref-export").onclick = function (event) { exportCsv(type, event.currentTarget); };
  }

  function renderTable(view) {
    var body = document.getElementById("at-fs-body");
    if (!body) return;
    var list = state.lists[view];
    var rows = list.rows;
    if (!rows.length) { body.innerHTML = '<tr><td colspan="7" class="at-fs-empty"><strong>조건에 맞는 내역이 없습니다.</strong><span>검색어나 기간을 바꿔 다시 조회해보세요.</span></td></tr>'; renderPager(view); return; }
    body.innerHTML = rows.map(function (row) {
      if (view === "visits") return "<tr class=\"at-log-row\"><td class=\"at-date-cell\">" + esc(row.dateKey || dateOnlyText(row.createdAt)) + "</td><td class=\"at-time-cell\">" + esc(visitTimeText(row)) + "</td><td class=\"at-name-cell\">" + esc(row.name) + "</td><td>" + esc(row.gender) + "</td><td>" + esc(row.age) + "</td><td><div class=\"at-purpose-wrap\">" + (row.activities || []).map(function (item) { return '<span class="at-purpose-badge">' + esc(currentActivityName(item)) + '</span>'; }).join("") + "</div></td><td><button type=\"button\" class=\"at-delete-btn at-fs-delete\" data-collection=\"visits\" data-id=\"" + esc(row.id) + "\" aria-label=\"" + esc((row.name || "이름 없음") + " 방문 기록 삭제") + "\">삭제</button></td></tr>";
      var members = row.members || [];
      return "<tr class=\"at-log-row at-ar-row\"><td class=\"at-date-cell\">" + esc(row.dateKey || dateOnlyText(row.createdAt)) + "</td><td class=\"at-time-cell at-indigo-text\">" + esc(row.timeSlot) + "</td><td class=\"at-name-cell\">" + esc(row.facility || "시설 미지정") + "</td><td class=\"at-name-cell\">" + esc(members[0] && members[0].name) + "</td><td>" + members.length + "명</td><td class=\"at-detail-cell\">" + members.map(function (member) { return '<span class="at-user-chip">' + esc(member.name) + '<span class="at-user-meta">(' + esc(member.gender) + ', ' + esc(member.age) + ')</span></span>'; }).join("") + "</td><td><button type=\"button\" class=\"at-delete-btn at-fs-delete\" data-collection=\"reservations\" data-id=\"" + esc(row.id) + "\" aria-label=\"" + esc((row.facility || "시설") + " 예약 기록 삭제") + "\">삭제</button></td></tr>";
    }).join("");
    body.querySelectorAll(".at-fs-delete").forEach(function (button) { button.onclick = removeRecord; });
    renderPager(view);
  }

  function renderPager(view) {
    var pager = document.getElementById("at-visit-pager");
    if (!pager) return;
    var list = state.lists[view];
    var signatureCache = list.caches.get(list.signature);
    var page = signatureCache && signatureCache.pages.get(list.pageIndex);
    var hasNext = !!page && page.hasNext;
    var totalPages = list.totalCount == null ? null : Math.max(1, Math.ceil(list.totalCount / PAGE_SIZE));
    pager.className = "at-visit-pager";
    pager.setAttribute("role", "navigation");
    pager.setAttribute("aria-label", (view === "visits" ? "방문 기록" : "시설 예약") + " 페이지");
    pager.innerHTML = '<button type="button" aria-label="이전 페이지" data-page-action="previous"' + (list.pageIndex === 0 || list.loading ? ' disabled' : '') + '>← 이전</button><span aria-live="polite"><strong>' + (list.pageIndex + 1) + '</strong>' + (totalPages ? ' / ' + totalPages : '') + ' 페이지</span><button type="button" aria-label="다음 페이지" data-page-action="next"' + (!hasNext || list.loading ? ' disabled' : '') + '>다음 →</button>';
    pager.querySelector('[data-page-action="previous"]').onclick = function () { loadListPage(view, { pageIndex: list.pageIndex - 1 }); };
    pager.querySelector('[data-page-action="next"]').onclick = function () { loadListPage(view, { pageIndex: list.pageIndex + 1 }); };
  }

  async function removeRecord(event) {
    var button = event.currentTarget;
    if (button.disabled || !requireAdminSession()) return;
    var type = button.dataset.collection === "visits" ? "visits" : "reservations";
    if (!window.confirm(button.dataset.collection === "visits" ? "이 방문 기록을 휴지통으로 이동하시겠습니까?" : "이 기록을 삭제하시겠습니까?")) return;
    setButtonPending(button, true);
    try {
      if (button.dataset.collection === "visits") {
        var visit = state.visits.find(function (item) { return item.id === button.dataset.id; });
        if (!visit) throw new Error("visit/not-found");
        var batch = state.api.writeBatch(state.db), trashRef = state.api.doc(state.db, state.config.collections.trash, visit.id), visitRef = state.api.doc(state.db, state.config.collections.visits, visit.id);
        var record = Object.assign({}, visit); delete record.id;
        batch.set(trashRef, { originalId: visit.id, record: record, deletedAt: new Date().toISOString() });
        batch.delete(visitRef);
        await batch.commit();
        notify("방문 기록을 휴지통으로 이동했습니다.", "success");
      } else {
        await state.api.deleteDoc(state.api.doc(state.db, state.config.collections.reservations, button.dataset.id));
        notify("삭제되었습니다.", "success");
      }
      await refreshCurrentList(type);
    }
    catch (error) { logFirestoreError(type + " delete", error); notify(firestoreErrorMessage(error, "기록 삭제"), "error"); }
    finally { setButtonPending(button, false); }
  }

  function downloadText(text, filename) {
    var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    var objectUrl = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = objectUrl; link.download = filename; link.click();
    setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 0);
  }

  function firebaseErrorText(error, recordLabel) {
    var label = recordLabel || "데이터";
    var code = firestoreErrorCode(error);
    if (code === "permission-denied") return "관리자 권한으로 " + label + "을(를) 저장할 수 없습니다. 권한을 확인해주세요.";
    if (code === "unauthenticated") return "관리자 로그인 상태가 만료되었습니다. 다시 로그인해주세요.";
    if (code === "resource-exhausted") return "현재 저장 요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해주세요.";
    if (code === "unavailable") return "저장 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해주세요.";
    if (code === "network-error" || code === "network-request-failed") return "네트워크 연결을 확인한 뒤 다시 시도해주세요.";
    return label + " 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
  }

  function captureMaintenanceQuery(type, useActiveFilters) {
    var constraints = useActiveFilters ? firestoreWhereConstraints(type).slice() : [];
    return {
      // Import preflight and an unfiltered export are the same server scan and
      // should share one in-flight promise instead of doubling document reads.
      signature: constraints.length ? querySignature(type) : "all",
      constraints: constraints
    };
  }

  async function fetchAllForMaintenance(type, useActiveFilters, capturedQuery) {
    if (!requireAdminSession()) throw Object.assign(new Error("Admin session expired"), { code: "unauthenticated" });
    var sessionVersion = state.adminSessionVersion;
    var queryContext = capturedQuery || captureMaintenanceQuery(type, useActiveFilters);
    var key = type + "::maintenance::" + queryContext.signature + "::session:" + sessionVersion;
    if (state.maintenanceInFlight.has(key)) return state.maintenanceInFlight.get(key);
    var request = (async function () {
      var records = [];
      var cursor = null;
      var baseConstraints = queryContext.constraints.slice();
      while (true) {
        if (!hasAdminSession()) throw Object.assign(new Error("Admin session expired"), { code: "unauthenticated" });
        var source = state.api.collection(state.db, collectionNameFor(type));
        var constraints = baseConstraints.slice();
        constraints.push(state.api.orderBy("createdAt", "desc"));
        if (cursor) constraints.push(state.api.startAfter(cursor));
        constraints.push(state.api.limit(MAINTENANCE_PAGE_SIZE));
        var snapshot = await state.api.getDocs(state.api.query.apply(null, [source].concat(constraints)));
        if (sessionVersion !== state.adminSessionVersion || !state.isAdmin || !hasAdminSession()) {
          throw Object.assign(new Error("Admin session expired"), { code: "unauthenticated" });
        }
        snapshot.docs.forEach(function (item) { records.push(Object.assign({ id: item.id }, item.data())); });
        if (snapshot.docs.length < MAINTENANCE_PAGE_SIZE) break;
        cursor = snapshot.docs[snapshot.docs.length - 1];
      }
      return records;
    })();
    state.maintenanceInFlight.set(key, request);
    try { return await request; }
    finally { if (state.maintenanceInFlight.get(key) === request) state.maintenanceInFlight.delete(key); }
  }

  function planReservationAdditions(records, existingRecords) {
    var tools = window.VisitImportTools;
    var existingCounts = new Map(), existingSlots = new Map(), existingById = new Map();
    (existingRecords || state.reservations).forEach(function (record) {
      var fingerprint = tools.reservationFingerprint(record);
      var slot = tools.reservationSlotKey(record);
      existingCounts.set(fingerprint, (existingCounts.get(fingerprint) || 0) + 1);
      if (record.id) existingById.set(String(record.id), fingerprint);
      if (!existingSlots.has(slot)) existingSlots.set(slot, new Set());
      existingSlots.get(slot).add(fingerprint);
    });
    var sourceOccurrences = new Map(), sourceFingerprintsBySlot = new Map();
    var plans = records.map(function (record) {
      var fingerprint = tools.reservationFingerprint(record);
      var slot = tools.reservationSlotKey(record);
      var occurrence = sourceOccurrences.get(fingerprint) || 0;
      sourceOccurrences.set(fingerprint, occurrence + 1);
      record.importId = tools.reservationImportId(record, occurrence);
      if (!sourceFingerprintsBySlot.has(slot)) sourceFingerprintsBySlot.set(slot, new Set());
      sourceFingerprintsBySlot.get(slot).add(fingerprint);
      return { record: record, fingerprint: fingerprint, slot: slot, matched: false };
    });
    var additions = [], duplicates = 0, conflicts = 0;
    plans.forEach(function (plan) {
      if (existingById.get(plan.record.importId) !== plan.fingerprint) return;
      plan.matched = true;
      duplicates++;
      existingCounts.set(plan.fingerprint, Math.max(0, (existingCounts.get(plan.fingerprint) || 0) - 1));
    });
    plans.forEach(function (plan) {
      if (plan.matched) return;
      if (existingById.has(plan.record.importId)) { conflicts++; return; }
      var remaining = existingCounts.get(plan.fingerprint) || 0;
      if (remaining > 0) {
        existingCounts.set(plan.fingerprint, remaining - 1);
        duplicates++;
        return;
      }
      if (existingSlots.has(plan.slot) && Array.from(existingSlots.get(plan.slot)).some(function (fingerprint) { return !sourceFingerprintsBySlot.get(plan.slot).has(fingerprint); })) { conflicts++; return; }
      additions.push(plan.record);
    });
    return { additions: additions, duplicates: duplicates, conflicts: conflicts };
  }

  function planVisitAdditions(records, existingRecords) {
    var tools = window.VisitImportTools;
    var existingFingerprints = new Set((existingRecords || []).map(tools.fingerprint));
    var existingIds = new Set((existingRecords || []).map(function (item) { return item.id; }).filter(Boolean));
    var fileFingerprints = new Set(), fileIds = new Set(), additions = [], duplicates = 0;
    records.forEach(function (record) {
      var fingerprint = tools.fingerprint(record);
      var suppliedId = String(record.id || "");
      if (existingFingerprints.has(fingerprint) || fileFingerprints.has(fingerprint) || suppliedId && (existingIds.has(suppliedId) || fileIds.has(suppliedId))) {
        duplicates++;
        return;
      }
      fileFingerprints.add(fingerprint);
      if (suppliedId) fileIds.add(suppliedId);
      additions.push(record);
    });
    return { additions: additions, duplicates: duplicates };
  }

  async function selectVisitCsv(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file || !requireAdminSession()) return;
    var trigger = document.getElementById("at-visit-import");
    setButtonPending(trigger, true);
    try {
      var parsed = window.VisitImportTools.parseVisitFile(await file.text());
      notify("기존 방문 기록과 중복 여부를 확인하고 있습니다.");
      var existingVisits = await fetchAllForMaintenance("visits", false);
      var importPlan = planVisitAdditions(parsed.records, existingVisits);
      var additions = importPlan.additions, duplicates = importPlan.duplicates;
      state.pendingVisitImport = { fileName: file.name, parsed: parsed, additions: additions, duplicates: duplicates };
      openCsvModal("방문 기록 CSV 불러오기", '<p class="at-csv-file">' + esc(file.name) + '</p><div class="at-csv-summary"><div><strong>' + parsed.sourceRows.toLocaleString() + '</strong><span>CSV 전체 행</span></div><div><strong>' + parsed.visitRows.toLocaleString() + '</strong><span>방문 활동 행</span></div><div><strong>' + parsed.records.length.toLocaleString() + '</strong><span>복원 방문 건</span></div><div class="is-new"><strong>' + additions.length.toLocaleString() + '</strong><span>새로 추가</span></div><div><strong>' + duplicates.toLocaleString() + '</strong><span>중복 제외</span></div><div><strong>' + parsed.invalidRows.toLocaleString() + '</strong><span>오류 행</span></div></div><div class="at-csv-protection"><strong>시설예약 보호</strong><p>시설예약 ' + parsed.ignoredReservationRows.toLocaleString() + '행은 가져오기 대상에서 제외됩니다. 군자의 시설예약 화면과 데이터에는 아무것도 저장하거나 덮어쓰지 않습니다.</p></div><p class="at-csv-note">여러 활동 행은 이름·나이·성별·등록 시각을 기준으로 한 번의 방문으로 묶었습니다. 기존 기록 및 파일 내부 중복은 자동 제외됩니다.</p><div id="at-csv-progress" class="at-csv-progress" aria-live="polite"></div><div class="at-csv-actions"><button type="button" id="at-csv-cancel">취소</button><button type="button" id="at-csv-confirm" class="is-primary"' + (additions.length ? '' : ' disabled') + '>방문 ' + additions.length.toLocaleString() + '건 가져오기</button></div>');
      document.getElementById("at-csv-cancel").onclick = closeCsvModal;
      document.getElementById("at-csv-confirm").onclick = importPendingVisits;
    } catch (error) {
      logFirestoreError("visit CSV preparation", error);
      notify(error && error.code ? firestoreErrorMessage(error, "방문 기록 중복 확인") : error.message || "CSV 파일을 읽지 못했습니다.", "error");
    } finally { setButtonPending(trigger, false); }
  }

  async function selectReservationCsv(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file || !requireAdminSession()) return;
    var trigger = document.getElementById("at-reservation-import");
    setButtonPending(trigger, true);
    try {
      var tools = window.VisitImportTools;
      if (!tools || ["parseReservationFile", "reservationFingerprint", "reservationSlotKey", "reservationImportId"].some(function (name) { return typeof tools[name] !== "function"; })) throw new Error("시설예약 CSV 변환 도구를 불러오지 못했습니다. 페이지를 새로고침해주세요.");
      var parsed = tools.parseReservationFile(await file.text());
      var legacyNameRows = 0, unclassifiedAgeRows = 0;
      parsed.records.forEach(function (record) {
        (record.members || []).forEach(function (member) {
          if (!/^[가-힣]{2,}$/.test(String(member.name || "").trim())) legacyNameRows++;
          var age = Number(member.age);
          if (!Number.isFinite(age) || age < 0) unclassifiedAgeRows++;
        });
      });
      var sourceSlotVariants = 0, sourceSlots = new Map();
      parsed.records.forEach(function (record) {
        var fingerprint = tools.reservationFingerprint(record);
        var slot = tools.reservationSlotKey(record);
        if (!sourceSlots.has(slot)) sourceSlots.set(slot, new Set());
        if (!sourceSlots.get(slot).has(fingerprint)) {
          if (sourceSlots.get(slot).size > 0) sourceSlotVariants++;
          sourceSlots.get(slot).add(fingerprint);
        }
      });
      notify("기존 시설예약과 중복·슬롯 충돌 여부를 확인하고 있습니다.");
      var existingReservations = await fetchAllForMaintenance("reservations", false);
      var importPlan = planReservationAdditions(parsed.records, existingReservations);
      var additions = importPlan.additions, duplicates = importPlan.duplicates, conflicts = importPlan.conflicts;
      state.pendingReservationImport = { fileName: file.name, parsed: parsed, additions: additions, duplicates: duplicates, conflicts: conflicts, sourceSlotVariants: sourceSlotVariants, legacyNameRows: legacyNameRows, unclassifiedAgeRows: unclassifiedAgeRows };
      openCsvModal("시설예약 현황 CSV 불러오기", '<p class="at-csv-file">' + esc(file.name) + '</p><div class="at-csv-summary"><div><strong>' + parsed.sourceRows.toLocaleString() + '</strong><span>CSV 전체 행</span></div><div><strong>' + parsed.reservationRows.toLocaleString() + '</strong><span>예약 이용자 행</span></div><div><strong>' + parsed.records.length.toLocaleString() + '</strong><span>복원 예약 후보</span></div><div class="is-new"><strong>' + additions.length.toLocaleString() + '</strong><span>새로 추가</span></div><div><strong>' + duplicates.toLocaleString() + '</strong><span>기존 예약 일치</span></div><div><strong>' + conflicts.toLocaleString() + '</strong><span>기존 슬롯 충돌</span></div><div><strong>' + sourceSlotVariants.toLocaleString() + '</strong><span>원본 동일 슬롯 추가</span></div><div><strong>' + parsed.ignoredVisitRows.toLocaleString() + '</strong><span>방문 행 제외</span></div><div><strong>' + (parsed.repairedRows || 0).toLocaleString() + '</strong><span>쉼표 행 복구</span></div><div><strong>' + parsed.invalidRows.toLocaleString() + '</strong><span>오류 행</span></div></div><div class="at-csv-protection at-csv-protection-indigo"><strong>방문 기록 보호</strong><p>방문등록 ' + parsed.ignoredVisitRows.toLocaleString() + '행은 가져오기 대상에서 제외됩니다. 기존 방문 기록에는 아무것도 저장하거나 덮어쓰지 않습니다.</p></div><p class="at-csv-note">날짜·시간·시설이 연속으로 같은 행을 한 예약의 이용자 명단으로 묶습니다. CSV에 반복된 예약과 이용자 행은 원본 실적 보존을 위해 유지하며, 현재 데이터와 완전히 같은 예약 또는 기존 슬롯과 충돌하는 예약만 제외합니다. 원본 안에서 같은 슬롯에 이용자 구성이 다른 추가 예약 ' + sourceSlotVariants.toLocaleString() + '건도 별도 실적으로 보존됩니다.</p><p class="at-csv-note">현재 입력 규칙과 다른 이름 ' + legacyNameRows.toLocaleString() + '명, 나이 미분류 ' + unclassifiedAgeRows.toLocaleString() + '명, 10명 초과 예약 ' + (parsed.overCapacityReservations || 0).toLocaleString() + '건이 포함됩니다. 원본 값은 유지되며 미분류 나이도 통계의 미분류 열에 포함됩니다.</p><div id="at-csv-progress" class="at-csv-progress" aria-live="polite"></div><div class="at-csv-actions"><button type="button" id="at-csv-cancel">취소</button><button type="button" id="at-csv-confirm" class="is-primary is-reservation"' + (additions.length ? '' : ' disabled') + '>예약 ' + additions.length.toLocaleString() + '건 가져오기</button></div>');
      document.getElementById("at-csv-cancel").onclick = closeCsvModal;
      document.getElementById("at-csv-confirm").onclick = importPendingReservations;
    } catch (error) {
      logFirestoreError("reservation CSV preparation", error);
      notify(error && error.code ? firestoreErrorMessage(error, "시설예약 중복 확인") : error.message || "시설예약 CSV 파일을 읽지 못했습니다.", "error");
    } finally { setButtonPending(trigger, false); }
  }

  async function importPendingVisits() {
    var pending = state.pendingVisitImport;
    if (!pending || !pending.additions.length) return;
    var button = document.getElementById("at-csv-confirm"), progress = document.getElementById("at-csv-progress"), completed = 0;
    if (!hasAdminSession()) {
      progress.textContent = "관리자 로그인 세션이 확인되지 않습니다. 닫은 뒤 다시 로그인해주세요.";
      return;
    }
    if (button.disabled) return;
    setCsvImportPending(button, true);
    progress.textContent = "최신 방문 기록과 중복 여부를 다시 확인하고 있습니다…";
    try {
      var latestExisting = await fetchAllForMaintenance("visits", false);
      var latestPlan = planVisitAdditions(pending.parsed.records, latestExisting);
      pending.additions = latestPlan.additions;
      pending.duplicates = latestPlan.duplicates;
    } catch (error) {
      logFirestoreError("visit import preflight", error);
      progress.textContent = firestoreErrorMessage(error, "방문 기록 중복 확인");
      setCsvImportPending(button, false);
      return;
    }
    if (!pending.additions.length) {
      progress.textContent = "최신 방문 기록을 다시 확인한 결과 새로 추가할 기록이 없습니다.";
      button.textContent = "추가할 방문 기록 없음";
      setCsvImportPending(button, false);
      button.disabled = true;
      return;
    }
    button.textContent = "방문 " + pending.additions.length.toLocaleString() + "건 가져오기";
    progress.textContent = "Firebase 쓰기 권한을 확인하고 있습니다…";
    var saved = 0;
    try {
      for (var offset = 0; offset < pending.additions.length; offset += 10) {
        var chunk = pending.additions.slice(offset, offset + 10);
        saved += await commitVisitChunk(chunk);
        completed = Math.min(offset + chunk.length, pending.additions.length);
        progress.textContent = completed.toLocaleString() + " / " + pending.additions.length.toLocaleString() + "건 확인 · " + saved.toLocaleString() + "건 저장";
      }
      closeCsvModal(true);
      await refreshCurrentList("visits");
      notify("방문 기록 " + saved.toLocaleString() + "건을 복원했습니다.", "success");
    } catch (error) {
      logFirestoreError("visit import", error);
      pending.additions = pending.additions.slice(completed);
      progress.textContent = saved.toLocaleString() + "건 저장 후 중단되었습니다. " + firebaseErrorText(error, "방문 기록") + " 남은 " + pending.additions.length.toLocaleString() + "건만 다시 시도할 수 있습니다.";
      button.textContent = "남은 방문 " + pending.additions.length.toLocaleString() + "건 다시 시도";
      setCsvImportPending(button, false);
      if (!pending.additions.length) button.disabled = true;
      if (completed) await refreshCurrentList("visits");
      notify("방문 기록 복원이 중단되었습니다.", "error");
    }
  }

  async function importPendingReservations() {
    var pending = state.pendingReservationImport;
    if (!pending) return;
    var button = document.getElementById("at-csv-confirm"), progress = document.getElementById("at-csv-progress"), completed = 0;
    if (!hasAdminSession()) {
      progress.textContent = "관리자 로그인 세션이 확인되지 않습니다. 닫은 뒤 다시 로그인해주세요.";
      return;
    }
    if (button.disabled) return;
    setCsvImportPending(button, true);
    progress.textContent = "최신 시설예약과 중복 여부를 다시 확인하고 있습니다…";
    var latestExisting;
    try {
      latestExisting = await fetchAllForMaintenance("reservations", false);
    } catch (error) {
      logFirestoreError("reservation import preflight", error);
      progress.textContent = firestoreErrorMessage(error, "시설예약 중복 확인");
      setCsvImportPending(button, false);
      return;
    }
    var latestPlan = planReservationAdditions(pending.parsed.records, latestExisting);
    pending.additions = latestPlan.additions;
    pending.duplicates = latestPlan.duplicates;
    pending.conflicts = latestPlan.conflicts;
    if (!pending.additions.length) {
      progress.textContent = "최신 시설예약 현황을 다시 확인한 결과 새로 추가할 예약이 없습니다.";
      button.textContent = "추가할 예약 없음";
      setCsvImportPending(button, false);
      button.disabled = true;
      return;
    }
    button.textContent = "예약 " + pending.additions.length.toLocaleString() + "건 가져오기";
    progress.textContent = "Firebase 쓰기 권한을 확인하고 있습니다…";
    try {
      for (var offset = 0; offset < pending.additions.length; offset += 200) {
        var chunk = pending.additions.slice(offset, offset + 200);
        await commitReservationChunk(chunk);
        completed = Math.min(offset + chunk.length, pending.additions.length);
        progress.textContent = completed.toLocaleString() + " / " + pending.additions.length.toLocaleString() + "건 저장 중";
      }
      closeCsvModal(true);
      await refreshCurrentList("reservations");
      notify("시설예약 " + completed.toLocaleString() + "건을 불러왔습니다.", "success");
    } catch (error) {
      logFirestoreError("reservation import", error);
      pending.additions = pending.additions.slice(completed);
      progress.textContent = completed.toLocaleString() + "건 저장 후 중단되었습니다. " + firebaseErrorText(error, "시설예약") + " 남은 " + pending.additions.length.toLocaleString() + "건만 다시 시도할 수 있습니다.";
      button.textContent = "남은 예약 " + pending.additions.length.toLocaleString() + "건 다시 시도";
      setCsvImportPending(button, false);
      if (!pending.additions.length) button.disabled = true;
      if (completed) await refreshCurrentList("reservations");
      notify("시설예약 불러오기가 중단되었습니다.", "error");
    }
  }

  async function commitVisitChunk(records) {
    var plans = records.map(function (source) {
      var record = Object.assign({}, source), suppliedId = record.id; delete record.id;
      return {
        record: record,
        suppliedId: suppliedId,
        ref: suppliedId ? state.api.doc(state.db, state.config.collections.visits, suppliedId) : state.api.doc(state.api.collection(state.db, state.config.collections.visits))
      };
    });
    return state.api.runTransaction(state.db, async function (transaction) {
      // Backups carry document IDs. Read every such target before any write so
      // a concurrent import or restore can never be overwritten by batch.set.
      var suppliedPlans = plans.filter(function (plan) { return !!plan.suppliedId; });
      var snapshots = await Promise.all(suppliedPlans.map(function (plan) { return transaction.get(plan.ref); }));
      var occupiedIds = new Set();
      snapshots.forEach(function (snapshot, index) { if (snapshot.exists()) occupiedIds.add(String(suppliedPlans[index].suppliedId)); });
      var saved = 0;
      plans.forEach(function (plan) {
        if (plan.suppliedId && occupiedIds.has(String(plan.suppliedId))) return;
        transaction.set(plan.ref, plan.record);
        saved++;
      });
      return saved;
    });
  }

  async function commitReservationChunk(records) {
    var batch = state.api.writeBatch(state.db);
    records.forEach(function (record) {
      var ref = state.api.doc(state.db, state.config.collections.reservations, record.importId);
      batch.set(ref, {
        facility: record.facility,
        timeSlot: record.timeSlot,
        dateKey: record.dateKey,
        members: (record.members || []).map(function (member) { return { name: member.name, age: member.age, gender: member.gender }; }),
        createdAt: record.createdAt
      });
    });
    await batch.commit();
  }

  async function backupVisitCsv(button) {
    if (!requireAdminSession() || button && button.disabled) return;
    var capturedQuery = captureMaintenanceQuery("visits", true);
    setButtonPending(button, true);
    try {
      var records = await fetchAllForMaintenance("visits", true, capturedQuery);
      if (!records.length) { notify("백업할 방문 기록이 없습니다."); return; }
      var text = window.VisitImportTools.createBackupCsv(records);
      downloadText(text, "군자청소년문화센터_방문기록_백업_" + localDateKey(new Date()) + ".csv");
    } catch (error) {
      logFirestoreError("visit backup", error);
      notify(firestoreErrorMessage(error, "방문 기록 백업"), "error");
    } finally { setButtonPending(button, false); }
  }

  function renderVisitTrashContent() {
    var content = document.getElementById("at-csv-content");
    if (!content) return;
    var rows = state.visitTrash.slice(0, 100).map(function (item) {
      var record = item.record || {};
      return '<li><div><strong>' + esc(record.name || "이름 없음") + '</strong><span>' + esc(dateText(record.createdAt)) + ' · ' + esc((record.activities || []).join(", ")) + '</span><small>삭제: ' + esc(dateText(item.deletedAt)) + '</small></div><div><button type="button" data-trash-restore="' + esc(item.id) + '" aria-label="' + esc((record.name || "이름 없음") + " 방문 기록 복구") + '">복구</button><button type="button" class="is-danger" data-trash-delete="' + esc(item.id) + '" aria-label="' + esc((record.name || "이름 없음") + " 방문 기록 영구 삭제") + '">영구 삭제</button></div></li>';
    }).join("");
    content.innerHTML = '<p class="at-csv-note">방문 기록만 보관됩니다. 최근 100건만 서버에서 조회합니다.</p><ul class="at-trash-list">' + (rows || '<li class="is-empty">복구할 방문 기록이 없습니다.</li>') + '</ul>';
    document.querySelectorAll("[data-trash-restore]").forEach(function (button) { button.onclick = function () { restoreVisit(button.dataset.trashRestore, button); }; });
    document.querySelectorAll("[data-trash-delete]").forEach(function (button) { button.onclick = function () { permanentlyDeleteVisit(button.dataset.trashDelete, button); }; });
  }

  async function showVisitTrash() {
    if (!requireAdminSession()) return;
    var sessionVersion = state.adminSessionVersion;
    openCsvModal("방문 기록 휴지통", '<div class="at-modal-loading" role="status" aria-busy="true">휴지통을 불러오는 중입니다.</div>');
    state.trashStatus = { loading: true, error: "" };
    try {
      var snapshot = await state.api.getDocs(state.api.query(
        state.api.collection(state.db, state.config.collections.trash),
        state.api.orderBy("deletedAt", "desc"),
        state.api.limit(100)
      ));
      if (!state.isAdmin || !hasAdminSession() || sessionVersion !== state.adminSessionVersion) return;
      state.visitTrash = snapshot.docs.map(function (item) { return Object.assign({ id: item.id }, item.data()); });
      state.trashStatus = { loading: false, error: "" };
      renderVisitTrashContent();
    } catch (error) {
      logFirestoreError("visit trash query", error);
      state.trashStatus = { loading: false, error: firestoreErrorMessage(error, "방문 기록 휴지통") };
      var content = document.getElementById("at-csv-content");
      if (content) {
        content.innerHTML = '<div class="at-modal-error" role="alert"><strong>휴지통을 불러오지 못했습니다.</strong><p>' + esc(state.trashStatus.error) + '</p><button type="button" id="at-trash-retry">다시 조회</button></div>';
        document.getElementById("at-trash-retry").onclick = showVisitTrash;
      }
    }
  }

  async function restoreVisit(id, button) {
    var item = state.visitTrash.find(function (row) { return row.id === id; });
    if (!item || button.disabled || !requireAdminSession()) return;
    setButtonPending(button, true);
    try {
      var batch = state.api.writeBatch(state.db);
      batch.set(state.api.doc(state.db, state.config.collections.visits, item.originalId || id), item.record || {});
      batch.delete(state.api.doc(state.db, state.config.collections.trash, id));
      await batch.commit(); closeCsvModal(); await refreshCurrentList("visits"); notify("방문 기록을 복구했습니다.", "success");
    } catch (error) { logFirestoreError("visit restore", error); notify(firestoreErrorMessage(error, "방문 기록 복구"), "error"); }
    finally { setButtonPending(button, false); }
  }

  async function permanentlyDeleteVisit(id, button) {
    if (button.disabled || !requireAdminSession()) return;
    if (!window.confirm("이 방문 기록을 영구 삭제하시겠습니까? 복구할 수 없습니다.")) return;
    setButtonPending(button, true);
    try { await state.api.deleteDoc(state.api.doc(state.db, state.config.collections.trash, id)); closeCsvModal(); notify("방문 기록을 영구 삭제했습니다.", "success"); }
    catch (error) { logFirestoreError("visit permanent delete", error); notify(firestoreErrorMessage(error, "방문 기록 영구 삭제"), "error"); }
    finally { setButtonPending(button, false); }
  }

  function csvCell(value) { var text = String(value == null ? "" : value); return /[\",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }
  function exportPeriodSuffix() {
    if (state.filter === "month") return state.filterYear + "-" + String(state.filterMonth).padStart(2, "0");
    if (state.filter === "custom") return state.rangeStart + "_to_" + state.rangeEnd;
    return "all";
  }
  async function exportCsv(type, button) {
    if (!requireAdminSession() || button && button.disabled) return;
    var periodSuffix = exportPeriodSuffix();
    var visitQuery = !type || type === "visits" ? captureMaintenanceQuery("visits", true) : null;
    var reservationQuery = !type || type === "reservations" ? captureMaintenanceQuery("reservations", true) : null;
    setButtonPending(button, true);
    try {
      var visitRecords = visitQuery ? await fetchAllForMaintenance("visits", true, visitQuery) : [];
      var reservationRecords = reservationQuery ? await fetchAllForMaintenance("reservations", true, reservationQuery) : [];
      var lines = [["구분", "일시/시간", "시설/활동", "이름", "나이", "성별"]];
      visitRecords.forEach(function (visit) { (visit.activities || []).forEach(function (activity) { lines.push(["방문등록", visit.timestamp || dateText(visit.createdAt), activity, visit.name, visit.age, visit.gender]); }); });
      reservationRecords.forEach(function (reservation) { (reservation.members || []).forEach(function (member) { lines.push(["시설예약", (reservation.dateKey || dateText(reservation.createdAt)) + " " + (reservation.timeSlot || ""), reservation.facility, member.name, member.age, member.gender]); }); });
      if (lines.length === 1) { notify("다운로드할 데이터가 없습니다."); return; }
      var blob = new Blob(["\uFEFF" + lines.map(function (line) { return line.map(csvCell).join(","); }).join("\n")], { type: "text/csv;charset=utf-8" });
      var objectUrl = URL.createObjectURL(blob);
      var link = document.createElement("a"); link.href = objectUrl; link.download = (state.config.exportFileName || "admin-export") + "-" + periodSuffix + ".csv"; link.click();
      setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 0);
    } catch (error) {
      logFirestoreError("CSV export", error);
      notify(firestoreErrorMessage(error, "CSV 보고서"), "error");
    } finally { setButtonPending(button, false); }
  }

  async function connect() {
    var base = "https://www.gstatic.com/firebasejs/12.15.0/";
    var modules = await Promise.all([import(base + "firebase-app.js"), import(base + "firebase-auth.js"), import(base + "firebase-firestore.js")]);
    var appApi = modules[0], authApi = modules[1], firestoreApi = modules[2];
    state.api = Object.assign({}, authApi, firestoreApi);
    state.app = appApi.initializeApp(state.config.firebase, "admin-tool");
    state.auth = authApi.getAuth(state.app); state.db = firestoreApi.getFirestore(state.app);
    renderShell();
    state.authReady = new Promise(function (resolve) {
      var initialStateResolved = false;
      authApi.onAuthStateChanged(state.auth, function (user) {
        var wasAdmin = state.isAdmin;
        state.isAdmin = !!user && normalizedEmail(user.email) === normalizedEmail(state.config.auth.adminEmail);
        if (wasAdmin && !state.isAdmin) { clearPrivateState(); closeDashboard(); }
        if (!initialStateResolved) { initialStateResolved = true; resolve(); }
      });
    });
    var entry = document.getElementById(state.config.entryButtonId || "admin-toggle-btn");
    if (entry) entry.addEventListener("click", async function (event) {
      event.preventDefault();
      await state.authReady;
      if (state.isAdmin) openDashboard(); else openModal();
    });
  }

  window.AdminTool = { init: function (config) {
    if (state.ready) throw new Error("AdminTool.init() may only be called once.");
    if (!config || !config.firebase || !config.auth || !config.auth.adminEmail) throw new Error("AdminTool requires firebase configuration and auth.adminEmail.");
    state.ready = true;
    state.config = Object.assign({ branding: {}, collections: {}, labels: {}, facilities: [], entryButtonId: "admin-toggle-btn" }, config);
    state.config.branding = Object.assign({}, state.config.branding || {});
    state.config.collections = Object.assign({}, state.config.collections || {});
    state.config.labels = Object.assign({}, state.config.labels || {});
    state.config.facilities = Array.isArray(state.config.facilities) ? state.config.facilities : [];
    state.config.collections.visits = state.config.collections.visits || "visits";
    state.config.collections.reservations = state.config.collections.reservations || "reservations";
    state.config.collections.trash = state.config.collections.trash || "visitTrash";
    state.config.collections.settings = state.config.collections.settings || "siteSettings";
    state.config.labels.youthcutActivity = state.config.labels.youthcutActivity || "Youth Cut";
    state.config.labels.arFacility = state.config.labels.arFacility || "AR Sports";
    function start() {
      connect().catch(function (error) {
        console.error("[AdminTool] initialization failed", error);
        var root = document.getElementById("admin-root");
        if (root) root.replaceChildren();
        // Keep an optional administrator dependency failure out of both public
        // screens. Explain it only when an operator deliberately opens admin.
        var entry = document.getElementById(state.config.entryButtonId || "admin-toggle-btn");
        if (entry) entry.addEventListener("click", function (event) {
          event.preventDefault();
          window.alert("관리자 도구를 초기화하지 못했습니다. Firebase 설정과 네트워크 연결을 확인하세요.");
        });
      });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
  }};
}());
