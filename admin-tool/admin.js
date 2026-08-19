/*
 * AdminTool
 * A reusable, self-rendering Firebase administrator dashboard.
 * Project data is supplied exclusively through AdminTool.init().
 */
(function () {
  var MAX_ACTIVITIES = 12;
  var defaultActivities = [{ id: "rest", name: "휴식", emoji: "☕" }, { id: "boardgame", name: "보드게임", emoji: "🎲" }, { id: "youthcut", name: "유스네컷", emoji: "📸", aliases: ["인생네컷"] }, { id: "reading", name: "독서", emoji: "📚" }, { id: "beads", name: "컬러비즈", emoji: "🟣" }];
  var today = new Date();
  var state = { config: null, app: null, auth: null, db: null, api: null, visits: [], visitsStatus: { loading: true, error: "" }, visitTrash: [], reservations: [], reservationsStatus: { loading: true, error: "" }, activities: defaultActivities.map(function (item) { return Object.assign({}, item); }), bookingSettings: null, ready: false, authReady: null, isAdmin: false, view: "visits", filter: "all", filterYear: today.getFullYear(), filterMonth: today.getMonth() + 1, rangeStart: "", rangeEnd: "", page: 1, pageSize: 100, pendingVisitImport: null, pendingReservationImport: null, importInProgress: false };
  var loginReturnFocus = null;
  var csvReturnFocus = null;

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
    return isSettingsView && state.view === view && content && active && content.contains(active) && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(active.tagName);
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
        '<header class="at-ref-header"><div class="at-ref-brand">' + (logoUrl ? '<img src="' + esc(logoUrl) + '" alt="' + esc(state.config.branding.title || "") + '">' : '<strong>' + esc(state.config.branding.title || "Admin Tool") + '</strong>') + '</div><div class="at-ref-actions"><span id="at-ref-date"></span><button type="button" id="at-fs-export" title="통합 CSV 다운로드" aria-label="통합 CSV 다운로드">⇩</button><button type="button" id="at-fs-logout" title="나가기" aria-label="관리자 로그아웃">↪</button></div></header>' +
        '<nav class="at-ref-tabs at-ref-tabs-four" role="tablist" aria-label="관리자 메뉴"><button type="button" id="at-tab-visits" role="tab" aria-selected="true" aria-controls="at-ref-content" tabindex="0" data-at-view="visits" class="is-active">방문 등록 내역</button><button type="button" id="at-tab-reservations" role="tab" aria-selected="false" aria-controls="at-ref-content" tabindex="-1" data-at-view="reservations">시설 예약 현황</button><button type="button" id="at-tab-activities" role="tab" aria-selected="false" aria-controls="at-ref-content" tabindex="-1" data-at-view="activities">활동 카드 관리</button><button type="button" id="at-tab-booking-settings" role="tab" aria-selected="false" aria-controls="at-ref-content" tabindex="-1" data-at-view="booking-settings">운영·안내 설정</button></nav>' +
        '<main id="at-ref-content" class="at-ref-content" role="tabpanel" aria-labelledby="at-tab-visits" tabindex="-1"></main>' +
      '</section>' +
      '<div id="at-csv-modal" class="at-csv-modal" hidden aria-hidden="true"><section class="at-csv-dialog" role="dialog" aria-modal="true" aria-labelledby="at-csv-title" tabindex="-1"><header><h2 id="at-csv-title">방문 기록</h2><button type="button" id="at-csv-close" aria-label="CSV 대화상자 닫기">×</button></header><div id="at-csv-content"></div></section></div>' +
      '<div id="at-fs-toast" class="at-fs-toast" role="status" aria-live="polite" aria-atomic="true" hidden></div>';

    document.getElementById("at-fs-cancel").onclick = closeModal;
    document.getElementById("at-fs-login-form").onsubmit = login;
    document.getElementById("at-fs-logout").onclick = logout;
    document.getElementById("at-fs-export").onclick = function () { exportCsv(); };
    document.getElementById("at-csv-close").onclick = closeCsvModal;
    document.getElementById("at-csv-modal").onclick = function (event) { if (event.target === event.currentTarget) closeCsvModal(); };
    root.querySelectorAll("[data-at-view]").forEach(function (button) {
      button.onclick = function () {
        state.view = button.dataset.atView;
        state.page = 1;
        root.querySelectorAll("[data-at-view]").forEach(function (item) {
          var selected = item === button;
          item.classList.toggle("is-active", selected);
          item.setAttribute("aria-selected", String(selected));
          item.tabIndex = selected ? 0 : -1;
        });
        document.getElementById("at-ref-content").setAttribute("aria-labelledby", button.id);
        render();
      };
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
  function openDashboard() { closeModal(false); document.getElementById("at-fs-dashboard").hidden = false; render(); var tab = document.querySelector('[data-at-view="' + state.view + '"]'); if (tab) tab.focus(); }
  function closeDashboard() { document.getElementById("at-fs-dashboard").hidden = true; }

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
    content.innerHTML = '<section class="at-activity-settings"><h2>방문 등록 활동 카드 관리</h2><p>사진 서비스 가입 없이 이모지로 카드를 꾸밀 수 있습니다. 카드는 1~' + MAX_ACTIVITIES + '개까지 추가·삭제할 수 있으며, 저장하면 방문 등록 화면에 바로 반영됩니다.</p><div class="at-activity-setting-list">' + rows + '</div><div class="at-activity-actions"><button type="button" id="at-add-activity" class="at-activity-add"' + (state.activities.length >= MAX_ACTIVITIES ? ' disabled' : '') + '>+ 활동 카드 추가</button><button type="button" id="at-save-activities" class="at-activity-save">활동 카드 저장</button></div></section>';
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
      notify("활동 카드가 저장되었습니다.", "success");
    } catch (error) {
      console.error("[AdminTool] activity settings save failed", error);
      notify("활동 카드를 저장하지 못했습니다.", "error");
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
    content.innerHTML = '<section class="at-booking-settings"><h2>시설 운영시간 및 이용 안내</h2><p>저장한 내용은 시설 예약 화면에 바로 반영됩니다.</p><div class="at-schedule-grid"><fieldset><legend>평일 운영시간</legend><label>시작<input id="at-weekday-start" type="time" value="' + esc(schedule.weekday.start) + '"></label><label>종료<input id="at-weekday-end" type="time" value="' + esc(schedule.weekday.end) + '"></label></fieldset><fieldset><legend>주말 운영시간</legend><label>시작<input id="at-weekend-start" type="time" value="' + esc(schedule.weekend.start) + '"></label><label>종료<input id="at-weekend-end" type="time" value="' + esc(schedule.weekend.end) + '"></label></fieldset><fieldset><legend>점심시간</legend><label class="at-switch-label"><input id="at-lunch-enabled" type="checkbox"' + (schedule.lunch.enabled ? ' checked' : '') + '> 점심시간 제외</label><label>시작<input id="at-lunch-start" type="time" value="' + esc(schedule.lunch.start) + '"></label><label>종료<input id="at-lunch-end" type="time" value="' + esc(schedule.lunch.end) + '"></label></fieldset></div><div class="at-notice-settings"><h3>시설별 이용 전 안내</h3>' + noticeRows + '</div><button type="button" id="at-save-booking-settings" class="at-booking-save">운영·안내 설정 저장</button></section>';
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
      notify("운영시간과 시설 안내가 저장되었습니다.", "success");
    } catch (error) {
      console.error("[AdminTool] booking settings save failed", error);
      notify("운영·안내 설정을 저장하지 못했습니다.", "error");
    } finally {
      setButtonPending(button, false);
    }
  }

  function currentPeriodLabel() {
    if (state.filter === "month") return state.filterYear + "년 " + state.filterMonth + "월";
    if (state.filter === "custom") return state.rangeStart + " ~ " + state.rangeEnd;
    return "전체 기간";
  }

  function overviewCards(source, records, isAr) {
    var peopleCount = records.reduce(function (sum, row) { return sum + (isAr ? (row.members || []).length : 1); }, 0);
    var currentDateKey = localDateKey(new Date());
    var todayCount = source.filter(function (row) { return recordDateKey(row) === currentDateKey; }).length;
    var categories = new Set();
    records.forEach(function (row) {
      if (isAr) { if (row.facility) categories.add(row.facility); }
      else (row.activities || []).forEach(function (activity) { categories.add(currentActivityName(activity)); });
    });
    return '<section class="at-overview-grid" aria-label="' + (isAr ? '시설 예약' : '방문 등록') + ' 요약">' +
      '<article class="at-overview-card"><span class="at-overview-label">선택 기간 건수</span><strong class="at-overview-value">' + records.length.toLocaleString() + '건</strong><span class="at-overview-note">' + esc(currentPeriodLabel()) + '</span></article>' +
      '<article class="at-overview-card"><span class="at-overview-label">이용 인원</span><strong class="at-overview-value">' + peopleCount.toLocaleString() + '명</strong><span class="at-overview-note">선택 기간 합계</span></article>' +
      '<article class="at-overview-card"><span class="at-overview-label">오늘 건수</span><strong class="at-overview-value">' + todayCount.toLocaleString() + '건</strong><span class="at-overview-note">' + esc(currentDateKey) + '</span></article>' +
      '<article class="at-overview-card"><span class="at-overview-label">분류수</span><strong class="at-overview-value">' + categories.size.toLocaleString() + '개</strong><span class="at-overview-note">' + (isAr ? '시설 종류' : '활동 종류') + '</span></article>' +
    '</section>';
  }

  function dataStateCard(status, isAr) {
    var noun = isAr ? "시설 예약" : "방문 등록";
    if (status.loading) return '<section class="at-data-state-card is-loading" role="status" aria-live="polite" aria-busy="true"><strong>' + noun + ' 내역을 불러오는 중입니다.</strong><p>잠시만 기다려주세요.</p></section>';
    return '<section class="at-data-state-card is-error" role="alert"><strong>' + noun + ' 내역을 불러오지 못했습니다.</strong><p>' + esc(status.error || "페이지를 새로고침한 뒤 다시 시도해주세요.") + '</p></section>';
  }

  function render() {
    var content = document.getElementById("at-ref-content"); if (!content) return;
    if (state.view === "activities") { renderActivitySettings(); return; }
    if (state.view === "booking-settings") { renderBookingSettings(); return; }
    var isAr = state.view === "reservations", source = isAr ? state.reservations : state.visits, records = source.filter(inRange), purposes = isAr ? facilityList(state.reservations) : purposeList(state.visits), title = isAr ? "시설 이용 통계 (예약 기반)" : "이용 목적 및 연령별 통계";
    document.getElementById("at-ref-date").textContent = new Date().toLocaleDateString("ko-KR").replace(/\. /g, ".").replace(/\.$/, "");
    var status = isAr ? state.reservationsStatus : state.visitsStatus;
    if (status.loading || status.error) { content.innerHTML = dataStateCard(status, isAr); return; }
    var years = Array.from(new Set([today.getFullYear()].concat((isAr ? state.reservations : state.visits).map(function (row) { return Number(recordDateKey(row).slice(0, 4)); }).filter(Boolean)))).sort(function (a, b) { return b - a; });
    var monthControls = state.filter === "month" ? '<div class="at-ref-month-range"><select id="at-ref-year" aria-label="조회 연도">' + years.map(function (year) { return '<option value="' + year + '"' + (year === state.filterYear ? ' selected' : '') + '>' + year + '년</option>'; }).join("") + '</select><select id="at-ref-month" aria-label="조회 월">' + Array.from({ length: 12 }, function (_, index) { var month = index + 1; return '<option value="' + month + '"' + (month === state.filterMonth ? ' selected' : '') + '>' + month + '월</option>'; }).join("") + '</select><button type="button" id="at-ref-apply-month">조회</button></div>' : '';
    var customControls = state.filter === "custom" ? '<div class="at-ref-date-range"><input id="at-ref-start-date" type="date" aria-label="시작일" value="' + esc(state.rangeStart) + '"><span aria-hidden="true">~</span><input id="at-ref-end-date" type="date" aria-label="종료일" value="' + esc(state.rangeEnd) + '"><button type="button" id="at-ref-apply-range">조회</button></div>' : '';
    var recordActions = isAr
      ? '<input id="at-reservation-csv-input" type="file" accept=".csv,text/csv" aria-label="시설예약 CSV 파일 선택" hidden><button type="button" class="at-reservation-import-btn" id="at-reservation-import" aria-controls="at-reservation-csv-input">＋ 예약 CSV 불러오기</button>'
      : '<input id="at-visit-csv-input" type="file" accept=".csv,text/csv" aria-label="방문 기록 CSV 파일 선택" hidden><button type="button" class="at-visit-import-btn" id="at-visit-import" aria-controls="at-visit-csv-input">＋ CSV 불러오기</button><button type="button" class="at-visit-backup-btn" id="at-visit-backup">⇩ 백업 CSV</button><button type="button" class="at-visit-trash-btn" id="at-visit-trash" aria-haspopup="dialog">♻ 복구함 <span>' + state.visitTrash.length + '</span></button>';
    content.innerHTML = overviewCards(source, records, isAr) + '<section class="at-ref-filter" aria-labelledby="at-filter-label"><strong id="at-filter-label">⌕&nbsp; 통계 기간 필터</strong><div role="group" aria-labelledby="at-filter-label"><button type="button" data-filter="all" aria-pressed="' + (state.filter === 'all') + '" class="' + (state.filter === 'all' ? 'is-current' : '') + '">전체</button><button type="button" data-filter="month" aria-pressed="' + (state.filter === 'month') + '" class="' + (state.filter === 'month' ? 'is-current' : '') + '">월별</button><button type="button" data-filter="custom" aria-pressed="' + (state.filter === 'custom') + '" class="' + (state.filter === 'custom' ? 'is-current' : '') + '">지정 기간</button>' + monthControls + customControls + '</div></section><section class="at-ref-section"><h2>' + (isAr ? '✓' : '▥') + ' ' + title + '</h2>' + statsTable(source, purposes, isAr, isAr) + '<div class="at-log-header"><h2 class="at-log-title">상세 ' + (isAr ? '시설 예약' : '방문') + ' 내역</h2><div class="at-log-actions">' + recordActions + '<button type="button" class="at-excel-btn ' + (isAr ? 'at-indigo-btn' : '') + '" id="at-ref-export" aria-label="현재 ' + (isAr ? '시설 예약' : '방문 등록') + ' 보고서 CSV 다운로드">⇩ 보고서 CSV</button><span class="at-count-badge ' + (isAr ? 'at-indigo-badge' : 'at-blue-badge') + '">' + records.length + '건</span></div></div><div class="at-log-table-wrap"><table class="at-log-table"><thead class="at-log-thead">' + (isAr ? '<tr><th>예약날짜</th><th>예약시간</th><th>시설</th><th>대표자</th><th>총 인원</th><th>이용자 명단</th><th>관리</th></tr>' : '<tr><th>날짜</th><th>시간</th><th>이름</th><th>성별</th><th>나이</th><th>목적</th><th>관리</th></tr>') + '</thead><tbody id="at-fs-body"></tbody></table></div><div id="at-visit-pager"></div></section>';
    content.querySelectorAll('[data-filter]').forEach(function (button) { button.onclick = function () { var selectedFilter = button.dataset.filter; state.filter = selectedFilter; state.page = 1; if (state.filter === "custom" && !state.rangeStart) { state.rangeStart = localDateKey(new Date()); state.rangeEnd = state.rangeStart; } render(); var nextButton = content.querySelector('[data-filter="' + selectedFilter + '"]'); if (nextButton) nextButton.focus(); }; });
    var applyMonth = document.getElementById("at-ref-apply-month");
    if (applyMonth) applyMonth.onclick = function () { state.filterYear = Number(document.getElementById("at-ref-year").value); state.filterMonth = Number(document.getElementById("at-ref-month").value); state.page = 1; render(); var nextApply = document.getElementById("at-ref-apply-month"); if (nextApply) nextApply.focus(); };
    var applyRange = document.getElementById("at-ref-apply-range");
    if (applyRange) applyRange.onclick = function () { var start = document.getElementById("at-ref-start-date").value, end = document.getElementById("at-ref-end-date").value; if (!start || !end || start > end) { notify("시작일과 종료일을 올바르게 선택해주세요.", "error"); return; } state.rangeStart = start; state.rangeEnd = end; state.page = 1; render(); var nextApply = document.getElementById("at-ref-apply-range"); if (nextApply) nextApply.focus(); };
    if (isAr) {
      document.getElementById("at-reservation-import").onclick = function () { document.getElementById("at-reservation-csv-input").click(); };
      document.getElementById("at-reservation-csv-input").onchange = selectReservationCsv;
    } else {
      document.getElementById("at-visit-import").onclick = function () { document.getElementById("at-visit-csv-input").click(); };
      document.getElementById("at-visit-csv-input").onchange = selectVisitCsv;
      document.getElementById("at-visit-backup").onclick = backupVisitCsv;
      document.getElementById("at-visit-trash").onclick = showVisitTrash;
    }
    document.getElementById("at-ref-export").onclick = function () { exportCsv(isAr ? "reservations" : "visits"); }; renderTable(state.view);
  }

  function renderTable(view) {
    var body = document.getElementById("at-fs-body");
    if (!body) return;
    var rows = (view === "visits" ? state.visits : state.reservations).filter(inRange);
    if (!rows.length) { body.innerHTML = '<tr><td colspan="7" class="at-fs-empty">등록된 내역이 없습니다.</td></tr>'; return; }
    var totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
    var visibleRows = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    body.innerHTML = visibleRows.map(function (row) {
      if (view === "visits") return "<tr class=\"at-log-row\"><td class=\"at-date-cell\">" + esc(row.dateKey || dateOnlyText(row.createdAt)) + "</td><td class=\"at-time-cell\">" + esc(visitTimeText(row)) + "</td><td class=\"at-name-cell\">" + esc(row.name) + "</td><td>" + esc(row.gender) + "</td><td>" + esc(row.age) + "</td><td><div class=\"at-purpose-wrap\">" + (row.activities || []).map(function (item) { return '<span class="at-purpose-badge">' + esc(currentActivityName(item)) + '</span>'; }).join("") + "</div></td><td><button type=\"button\" class=\"at-delete-btn at-fs-delete\" data-collection=\"visits\" data-id=\"" + esc(row.id) + "\" aria-label=\"" + esc((row.name || "이름 없음") + " 방문 기록 삭제") + "\">삭제</button></td></tr>";
      var members = row.members || [];
      return "<tr class=\"at-log-row at-ar-row\"><td class=\"at-date-cell\">" + esc(row.dateKey || dateOnlyText(row.createdAt)) + "</td><td class=\"at-time-cell at-indigo-text\">" + esc(row.timeSlot) + "</td><td class=\"at-name-cell\">" + esc(row.facility || "시설 미지정") + "</td><td class=\"at-name-cell\">" + esc(members[0] && members[0].name) + "</td><td>" + members.length + "명</td><td class=\"at-detail-cell\">" + members.map(function (member) { return '<span class="at-user-chip">' + esc(member.name) + '<span class="at-user-meta">(' + esc(member.gender) + ', ' + esc(member.age) + ')</span></span>'; }).join("") + "</td><td><button type=\"button\" class=\"at-delete-btn at-fs-delete\" data-collection=\"reservations\" data-id=\"" + esc(row.id) + "\" aria-label=\"" + esc((row.facility || "시설") + " 예약 기록 삭제") + "\">삭제</button></td></tr>";
    }).join("");
    body.querySelectorAll(".at-fs-delete").forEach(function (button) { button.onclick = removeRecord; });
    var pager = document.getElementById("at-visit-pager");
    if (pager && totalPages > 1) {
      pager.className = "at-visit-pager";
      pager.setAttribute("role", "navigation");
      pager.setAttribute("aria-label", (view === "visits" ? "방문 기록" : "시설 예약") + " 페이지");
      pager.innerHTML = '<button type="button" aria-label="이전 페이지" data-page-action="previous" data-page="' + (state.page - 1) + '"' + (state.page === 1 ? ' disabled' : '') + '>이전</button><span aria-live="polite">' + state.page + ' / ' + totalPages + ' 페이지</span><button type="button" aria-label="다음 페이지" data-page-action="next" data-page="' + (state.page + 1) + '"' + (state.page === totalPages ? ' disabled' : '') + '>다음</button>';
      pager.querySelectorAll("[data-page]").forEach(function (button) { button.onclick = function () { var action = button.dataset.pageAction; state.page = Number(button.dataset.page); renderTable(view); var focusTarget = pager.querySelector('[data-page-action="' + action + '"]:not([disabled])') || pager.querySelector("button:not([disabled])"); if (focusTarget) focusTarget.focus(); }; });
    }
  }

  async function removeRecord(event) {
    var button = event.currentTarget;
    if (button.disabled) return;
    if (!window.confirm(button.dataset.collection === "visits" ? "이 방문 기록을 복구함으로 이동하시겠습니까?" : "이 기록을 삭제하시겠습니까?")) return;
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
        notify("방문 기록을 복구함으로 이동했습니다.", "success");
      } else {
        await state.api.deleteDoc(state.api.doc(state.db, state.config.collections.reservations, button.dataset.id));
        notify("삭제되었습니다.", "success");
      }
    }
    catch (error) { console.error("[AdminTool] delete failed", error); notify("삭제하지 못했습니다.", "error"); }
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
    var code = String(error && error.code || "").replace(/^firestore\//, "");
    if (code === "permission-denied") return "Firebase 보안 규칙이 " + label + " 쓰기를 거부했습니다. 관리자 계정의 생성 권한을 확인해야 합니다. (permission-denied)";
    if (code === "unauthenticated") return "관리자 로그인 세션이 만료되었습니다. 관리자 화면에서 다시 로그인한 뒤 시도해주세요. (unauthenticated)";
    if (code === "resource-exhausted") return "Firebase 일일 쓰기 한도 또는 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요. (resource-exhausted)";
    if (code === "unavailable") return "Firebase 서버 또는 네트워크에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요. (unavailable)";
    return (error && error.message ? error.message : "알 수 없는 오류") + (code ? " (" + code + ")" : "");
  }

  function planReservationAdditions(records) {
    var tools = window.VisitImportTools;
    var existingCounts = new Map(), existingSlots = new Map(), existingById = new Map();
    state.reservations.forEach(function (record) {
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

  async function selectVisitCsv(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      var parsed = window.VisitImportTools.parseVisitFile(await file.text());
      var fingerprints = new Set(state.visits.map(window.VisitImportTools.fingerprint));
      var ids = new Set(state.visits.map(function (item) { return item.id; }));
      var uniqueInFile = new Set(), additions = [], duplicates = 0;
      parsed.records.forEach(function (record) {
        var key = window.VisitImportTools.fingerprint(record);
        if (fingerprints.has(key) || uniqueInFile.has(key) || (record.id && ids.has(record.id))) duplicates++;
        else { uniqueInFile.add(key); additions.push(record); }
      });
      state.pendingVisitImport = { fileName: file.name, parsed: parsed, additions: additions, duplicates: duplicates };
      openCsvModal("방문 기록 CSV 불러오기", '<p class="at-csv-file">' + esc(file.name) + '</p><div class="at-csv-summary"><div><strong>' + parsed.sourceRows.toLocaleString() + '</strong><span>CSV 전체 행</span></div><div><strong>' + parsed.visitRows.toLocaleString() + '</strong><span>방문 활동 행</span></div><div><strong>' + parsed.records.length.toLocaleString() + '</strong><span>복원 방문 건</span></div><div class="is-new"><strong>' + additions.length.toLocaleString() + '</strong><span>새로 추가</span></div><div><strong>' + duplicates.toLocaleString() + '</strong><span>중복 제외</span></div><div><strong>' + parsed.invalidRows.toLocaleString() + '</strong><span>오류 행</span></div></div><div class="at-csv-protection"><strong>시설예약 보호</strong><p>시설예약 ' + parsed.ignoredReservationRows.toLocaleString() + '행은 가져오기 대상에서 제외됩니다. 군자의 시설예약 화면과 데이터에는 아무것도 저장하거나 덮어쓰지 않습니다.</p></div><p class="at-csv-note">여러 활동 행은 이름·나이·성별·등록 시각을 기준으로 한 번의 방문으로 묶었습니다. 기존 기록 및 파일 내부 중복은 자동 제외됩니다.</p><div id="at-csv-progress" class="at-csv-progress" aria-live="polite"></div><div class="at-csv-actions"><button type="button" id="at-csv-cancel">취소</button><button type="button" id="at-csv-confirm" class="is-primary"' + (additions.length ? '' : ' disabled') + '>방문 ' + additions.length.toLocaleString() + '건 가져오기</button></div>');
      document.getElementById("at-csv-cancel").onclick = closeCsvModal;
      document.getElementById("at-csv-confirm").onclick = importPendingVisits;
    } catch (error) {
      console.error("[AdminTool] CSV parse failed", error);
      notify(error.message || "CSV 파일을 읽지 못했습니다.", "error");
    }
  }

  async function selectReservationCsv(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
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
      var importPlan = planReservationAdditions(parsed.records);
      var additions = importPlan.additions, duplicates = importPlan.duplicates, conflicts = importPlan.conflicts;
      state.pendingReservationImport = { fileName: file.name, parsed: parsed, additions: additions, duplicates: duplicates, conflicts: conflicts, sourceSlotVariants: sourceSlotVariants, legacyNameRows: legacyNameRows, unclassifiedAgeRows: unclassifiedAgeRows };
      openCsvModal("시설예약 현황 CSV 불러오기", '<p class="at-csv-file">' + esc(file.name) + '</p><div class="at-csv-summary"><div><strong>' + parsed.sourceRows.toLocaleString() + '</strong><span>CSV 전체 행</span></div><div><strong>' + parsed.reservationRows.toLocaleString() + '</strong><span>예약 이용자 행</span></div><div><strong>' + parsed.records.length.toLocaleString() + '</strong><span>복원 예약 후보</span></div><div class="is-new"><strong>' + additions.length.toLocaleString() + '</strong><span>새로 추가</span></div><div><strong>' + duplicates.toLocaleString() + '</strong><span>기존 예약 일치</span></div><div><strong>' + conflicts.toLocaleString() + '</strong><span>기존 슬롯 충돌</span></div><div><strong>' + sourceSlotVariants.toLocaleString() + '</strong><span>원본 동일 슬롯 추가</span></div><div><strong>' + parsed.ignoredVisitRows.toLocaleString() + '</strong><span>방문 행 제외</span></div><div><strong>' + (parsed.repairedRows || 0).toLocaleString() + '</strong><span>쉼표 행 복구</span></div><div><strong>' + parsed.invalidRows.toLocaleString() + '</strong><span>오류 행</span></div></div><div class="at-csv-protection at-csv-protection-indigo"><strong>방문 기록 보호</strong><p>방문등록 ' + parsed.ignoredVisitRows.toLocaleString() + '행은 가져오기 대상에서 제외됩니다. 기존 방문 기록에는 아무것도 저장하거나 덮어쓰지 않습니다.</p></div><p class="at-csv-note">날짜·시간·시설이 연속으로 같은 행을 한 예약의 이용자 명단으로 묶습니다. CSV에 반복된 예약과 이용자 행은 원본 실적 보존을 위해 유지하며, 현재 데이터와 완전히 같은 예약 또는 기존 슬롯과 충돌하는 예약만 제외합니다. 원본 안에서 같은 슬롯에 이용자 구성이 다른 추가 예약 ' + sourceSlotVariants.toLocaleString() + '건도 별도 실적으로 보존됩니다.</p><p class="at-csv-note">현재 입력 규칙과 다른 이름 ' + legacyNameRows.toLocaleString() + '명, 나이 미분류 ' + unclassifiedAgeRows.toLocaleString() + '명, 10명 초과 예약 ' + (parsed.overCapacityReservations || 0).toLocaleString() + '건이 포함됩니다. 원본 값은 유지되며 미분류 나이도 통계의 미분류 열에 포함됩니다.</p><div id="at-csv-progress" class="at-csv-progress" aria-live="polite"></div><div class="at-csv-actions"><button type="button" id="at-csv-cancel">취소</button><button type="button" id="at-csv-confirm" class="is-primary is-reservation"' + (additions.length ? '' : ' disabled') + '>예약 ' + additions.length.toLocaleString() + '건 가져오기</button></div>');
      document.getElementById("at-csv-cancel").onclick = closeCsvModal;
      document.getElementById("at-csv-confirm").onclick = importPendingReservations;
    } catch (error) {
      console.error("[AdminTool] reservation CSV parse failed", error);
      notify(error.message || "시설예약 CSV 파일을 읽지 못했습니다.", "error");
    }
  }

  async function importPendingVisits() {
    var pending = state.pendingVisitImport;
    if (!pending || !pending.additions.length) return;
    var button = document.getElementById("at-csv-confirm"), progress = document.getElementById("at-csv-progress"), completed = 0;
    if (!state.auth.currentUser || normalizedEmail(state.auth.currentUser.email) !== normalizedEmail(state.config.auth.adminEmail)) {
      progress.textContent = "관리자 로그인 세션이 확인되지 않습니다. 닫은 뒤 다시 로그인해주세요.";
      return;
    }
    if (button.disabled) return;
    setCsvImportPending(button, true);
    progress.textContent = "Firebase 쓰기 권한을 확인하고 있습니다…";
    try {
      for (var offset = 0; offset < pending.additions.length; offset += 10) {
        var chunk = pending.additions.slice(offset, offset + 10);
        await commitVisitChunk(chunk);
        completed = Math.min(offset + chunk.length, pending.additions.length);
        progress.textContent = completed.toLocaleString() + " / " + pending.additions.length.toLocaleString() + "건 저장 중";
      }
      closeCsvModal(true);
      notify("방문 기록 " + completed.toLocaleString() + "건을 복원했습니다.", "success");
    } catch (error) {
      console.error("[AdminTool] visit import failed", error);
      pending.additions = pending.additions.slice(completed);
      progress.textContent = completed.toLocaleString() + "건 저장 후 중단되었습니다. " + firebaseErrorText(error, "방문 기록") + " 남은 " + pending.additions.length.toLocaleString() + "건만 다시 시도할 수 있습니다.";
      button.textContent = "남은 방문 " + pending.additions.length.toLocaleString() + "건 다시 시도";
      setCsvImportPending(button, false);
      if (!pending.additions.length) button.disabled = true;
      notify("방문 기록 복원이 중단되었습니다.", "error");
    }
  }

  async function importPendingReservations() {
    var pending = state.pendingReservationImport;
    if (!pending) return;
    var button = document.getElementById("at-csv-confirm"), progress = document.getElementById("at-csv-progress"), completed = 0;
    if (!state.auth.currentUser || normalizedEmail(state.auth.currentUser.email) !== normalizedEmail(state.config.auth.adminEmail)) {
      progress.textContent = "관리자 로그인 세션이 확인되지 않습니다. 닫은 뒤 다시 로그인해주세요.";
      return;
    }
    if (button.disabled) return;
    var latestPlan = planReservationAdditions(pending.parsed.records);
    pending.additions = latestPlan.additions;
    pending.duplicates = latestPlan.duplicates;
    pending.conflicts = latestPlan.conflicts;
    if (!pending.additions.length) {
      progress.textContent = "최신 시설예약 현황을 다시 확인한 결과 새로 추가할 예약이 없습니다.";
      button.textContent = "추가할 예약 없음";
      button.disabled = true;
      return;
    }
    button.textContent = "예약 " + pending.additions.length.toLocaleString() + "건 가져오기";
    setCsvImportPending(button, true);
    progress.textContent = "Firebase 쓰기 권한을 확인하고 있습니다…";
    try {
      for (var offset = 0; offset < pending.additions.length; offset += 200) {
        var chunk = pending.additions.slice(offset, offset + 200);
        await commitReservationChunk(chunk);
        completed = Math.min(offset + chunk.length, pending.additions.length);
        progress.textContent = completed.toLocaleString() + " / " + pending.additions.length.toLocaleString() + "건 저장 중";
      }
      closeCsvModal(true);
      notify("시설예약 " + completed.toLocaleString() + "건을 불러왔습니다.", "success");
    } catch (error) {
      console.error("[AdminTool] reservation import failed", error);
      pending.additions = pending.additions.slice(completed);
      progress.textContent = completed.toLocaleString() + "건 저장 후 중단되었습니다. " + firebaseErrorText(error, "시설예약") + " 남은 " + pending.additions.length.toLocaleString() + "건만 다시 시도할 수 있습니다.";
      button.textContent = "남은 예약 " + pending.additions.length.toLocaleString() + "건 다시 시도";
      setCsvImportPending(button, false);
      if (!pending.additions.length) button.disabled = true;
      notify("시설예약 불러오기가 중단되었습니다.", "error");
    }
  }

  async function commitVisitChunk(records) {
    var batch = state.api.writeBatch(state.db);
    records.forEach(function (source) {
      var record = Object.assign({}, source), suppliedId = record.id; delete record.id;
      var ref = suppliedId ? state.api.doc(state.db, state.config.collections.visits, suppliedId) : state.api.doc(state.api.collection(state.db, state.config.collections.visits));
      batch.set(ref, record);
    });
    await batch.commit();
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

  function backupVisitCsv() {
    var records = state.visits.filter(inRange);
    if (!records.length) { notify("백업할 방문 기록이 없습니다."); return; }
    var text = window.VisitImportTools.createBackupCsv(records);
    downloadText(text, "군자청소년문화센터_방문기록_백업_" + localDateKey(new Date()) + ".csv");
  }

  function showVisitTrash() {
    var rows = state.visitTrash.slice(0, 100).map(function (item) {
      var record = item.record || {};
      return '<li><div><strong>' + esc(record.name || "이름 없음") + '</strong><span>' + esc(dateText(record.createdAt)) + ' · ' + esc((record.activities || []).join(", ")) + '</span><small>삭제: ' + esc(dateText(item.deletedAt)) + '</small></div><div><button type="button" data-trash-restore="' + esc(item.id) + '" aria-label="' + esc((record.name || "이름 없음") + " 방문 기록 복구") + '">복구</button><button type="button" class="is-danger" data-trash-delete="' + esc(item.id) + '" aria-label="' + esc((record.name || "이름 없음") + " 방문 기록 영구 삭제") + '">영구 삭제</button></div></li>';
    }).join("");
    openCsvModal("방문 기록 복구함", '<p class="at-csv-note">방문 기록만 보관됩니다. 시설예약은 이 복구함의 대상이 아닙니다.</p><ul class="at-trash-list">' + (rows || '<li class="is-empty">복구할 방문 기록이 없습니다.</li>') + '</ul>' + (state.visitTrash.length > 100 ? '<p class="at-csv-note">최근 100건만 표시합니다.</p>' : ''));
    document.querySelectorAll("[data-trash-restore]").forEach(function (button) { button.onclick = function () { restoreVisit(button.dataset.trashRestore, button); }; });
    document.querySelectorAll("[data-trash-delete]").forEach(function (button) { button.onclick = function () { permanentlyDeleteVisit(button.dataset.trashDelete, button); }; });
  }

  async function restoreVisit(id, button) {
    var item = state.visitTrash.find(function (row) { return row.id === id; });
    if (!item || button.disabled) return;
    setButtonPending(button, true);
    try {
      var batch = state.api.writeBatch(state.db);
      batch.set(state.api.doc(state.db, state.config.collections.visits, item.originalId || id), item.record || {});
      batch.delete(state.api.doc(state.db, state.config.collections.trash, id));
      await batch.commit(); closeCsvModal(); notify("방문 기록을 복구했습니다.", "success");
    } catch (error) { console.error("[AdminTool] visit restore failed", error); notify("방문 기록을 복구하지 못했습니다.", "error"); }
    finally { setButtonPending(button, false); }
  }

  async function permanentlyDeleteVisit(id, button) {
    if (button.disabled) return;
    if (!window.confirm("이 방문 기록을 영구 삭제하시겠습니까? 복구할 수 없습니다.")) return;
    setButtonPending(button, true);
    try { await state.api.deleteDoc(state.api.doc(state.db, state.config.collections.trash, id)); closeCsvModal(); notify("방문 기록을 영구 삭제했습니다.", "success"); }
    catch (error) { console.error("[AdminTool] permanent delete failed", error); notify("영구 삭제하지 못했습니다.", "error"); }
    finally { setButtonPending(button, false); }
  }

  function csvCell(value) { var text = String(value == null ? "" : value); return /[\",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }
  function exportPeriodSuffix() {
    if (state.filter === "month") return state.filterYear + "-" + String(state.filterMonth).padStart(2, "0");
    if (state.filter === "custom") return state.rangeStart + "_to_" + state.rangeEnd;
    return "all";
  }
  function exportCsv(type) {
    var lines = [["구분", "일시/시간", "시설/활동", "이름", "나이", "성별"]];
    if (!type || type === "visits") state.visits.filter(inRange).forEach(function (visit) { (visit.activities || []).forEach(function (activity) { lines.push(["방문등록", visit.timestamp || dateText(visit.createdAt), activity, visit.name, visit.age, visit.gender]); }); });
    if (!type || type === "reservations") state.reservations.filter(inRange).forEach(function (reservation) { (reservation.members || []).forEach(function (member) { lines.push(["시설예약", (reservation.dateKey || dateText(reservation.createdAt)) + " " + (reservation.timeSlot || ""), reservation.facility, member.name, member.age, member.gender]); }); });
    if (lines.length === 1) { notify("다운로드할 데이터가 없습니다."); return; }
    var blob = new Blob(["\uFEFF" + lines.map(function (line) { return line.map(csvCell).join(","); }).join("\n")], { type: "text/csv;charset=utf-8" });
    var objectUrl = URL.createObjectURL(blob);
    var link = document.createElement("a"); link.href = objectUrl; link.download = (state.config.exportFileName || "admin-export") + "-" + exportPeriodSuffix() + ".csv"; link.click();
    setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 0);
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
      authApi.onAuthStateChanged(state.auth, function (user) {
        state.isAdmin = !!user && normalizedEmail(user.email) === normalizedEmail(state.config.auth.adminEmail);
        resolve();
      });
    });
    var entry = document.getElementById(state.config.entryButtonId || "admin-toggle-btn");
    if (entry) entry.addEventListener("click", async function (event) {
      event.preventDefault();
      await state.authReady;
      if (state.isAdmin) openDashboard(); else openModal();
    });
    firestoreApi.onSnapshot(firestoreApi.collection(state.db, state.config.collections.visits), function (snapshot) {
      state.visits = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); }).sort(function (a, b) { return dateValue(b.createdAt) - dateValue(a.createdAt); });
      state.visitsStatus = { loading: false, error: "" };
      safeRender("visits");
    }, function (error) {
      console.error("[AdminTool] visits subscription failed", error);
      state.visitsStatus = { loading: false, error: "페이지를 새로고침한 뒤 다시 시도해주세요." };
      safeRender("visits");
    });
    firestoreApi.onSnapshot(firestoreApi.collection(state.db, state.config.collections.trash), function (snapshot) {
      state.visitTrash = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); }).sort(function (a, b) { return dateValue(b.deletedAt) - dateValue(a.deletedAt); });
      safeRender("visits");
    }, function (error) { console.error("[AdminTool] visit trash subscription failed", error); });
    firestoreApi.onSnapshot(firestoreApi.collection(state.db, state.config.collections.reservations), function (snapshot) {
      state.reservations = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); }).sort(function (a, b) { return dateValue(b.createdAt) - dateValue(a.createdAt); });
      state.reservationsStatus = { loading: false, error: "" };
      safeRender("reservations");
    }, function (error) {
      console.error("[AdminTool] reservations subscription failed", error);
      state.reservationsStatus = { loading: false, error: "페이지를 새로고침한 뒤 다시 시도해주세요." };
      safeRender("reservations");
    });
    firestoreApi.onSnapshot(firestoreApi.doc(state.db, state.config.collections.settings, "activities"), function (snapshot) {
      var items = snapshot.exists() && snapshot.data().items;
      if (Array.isArray(items) && items.length > 0 && items.length <= MAX_ACTIVITIES) state.activities = items;
      safeRender("activities");
    }, function (error) { console.warn("[AdminTool] activity settings subscription failed", error); });
    firestoreApi.onSnapshot(firestoreApi.doc(state.db, state.config.collections.settings, "bookingSettings"), function (snapshot) {
      state.bookingSettings = normalizedBookingSettings(snapshot.exists() ? snapshot.data() : {});
      safeRender("booking-settings");
    }, function (error) {
      console.warn("[AdminTool] booking settings subscription failed", error);
      state.bookingSettings = normalizedBookingSettings();
      safeRender("booking-settings");
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
        if (root) root.innerHTML = '<div class="at-fs-init-error">관리자 도구를 초기화하지 못했습니다. Firebase 설정을 확인하세요.</div>';
      });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
  }};
}());
