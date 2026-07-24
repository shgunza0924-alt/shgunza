/*
 * AdminTool
 * A reusable, self-rendering Firebase administrator dashboard.
 * Project data is supplied exclusively through AdminTool.init().
 */
(function () {
  var MAX_ACTIVITIES = 12;
  var defaultActivities = [{ id: "rest", name: "휴식", emoji: "☕" }, { id: "boardgame", name: "보드게임", emoji: "🎲" }, { id: "youthcut", name: "유스네컷", emoji: "📸" }, { id: "reading", name: "독서", emoji: "📚" }, { id: "beads", name: "컬러비즈", emoji: "🟣" }];
  var state = { config: null, app: null, auth: null, db: null, api: null, visits: [], reservations: [], activities: defaultActivities.map(function (item) { return Object.assign({}, item); }), ready: false, authReady: null, isAdmin: false, view: "visits", filter: "all", rangeStart: "", rangeEnd: "" };

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

  function notify(message, type) {
    var toast = document.getElementById("at-fs-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = "at-fs-toast " + (type || "");
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
      '<div id="at-fs-modal" class="at-fs-modal" hidden aria-hidden="true"><form id="at-fs-login-form" class="at-fs-login">' +
        '<h2>관리자 인증</h2><p>관리자 비밀번호를 입력하세요.</p>' +
        '<input id="at-fs-password" type="password" autocomplete="current-password" required autofocus>' +
        '<div class="at-fs-actions"><button type="button" id="at-fs-cancel">취소</button><button type="submit">로그인</button></div>' +
      '</form></div>' +
      '<section id="at-fs-dashboard" class="at-fs-dashboard at-ref-dashboard" hidden>' +
        '<header class="at-ref-header"><div class="at-ref-brand">' + (logoUrl ? '<img src="' + esc(logoUrl) + '" alt="' + esc(state.config.branding.title || "") + '">' : '<strong>' + esc(state.config.branding.title || "Admin Tool") + '</strong>') + '</div><div class="at-ref-actions"><span id="at-ref-date"></span><button id="at-fs-export" title="통합 CSV 다운로드">⇩</button><button id="at-fs-logout" title="나가기">↪</button></div></header>' +
        '<nav class="at-ref-tabs at-ref-tabs-three"><button data-at-view="visits" class="is-active">방문 등록 내역</button><button data-at-view="reservations">시설 예약 현황</button><button data-at-view="activities">활동 카드 관리</button></nav>' +
        '<main id="at-ref-content" class="at-ref-content"></main>' +
      '</section><div id="at-fs-toast" class="at-fs-toast" hidden></div>';

    document.getElementById("at-fs-cancel").onclick = closeModal;
    document.getElementById("at-fs-login-form").onsubmit = login;
    document.getElementById("at-fs-logout").onclick = logout;
    document.getElementById("at-fs-export").onclick = exportCsv;
    root.querySelectorAll("[data-at-view]").forEach(function (button) {
      button.onclick = function () {
        state.view = button.dataset.atView;
        root.querySelectorAll("[data-at-view]").forEach(function (item) { item.classList.toggle("is-active", item === button); });
        render();
      };
    });
  }

  function openModal() {
    var modal = document.getElementById("at-fs-modal");
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.getElementById("at-fs-password").focus();
  }

  function closeModal() {
    var modal = document.getElementById("at-fs-modal");
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.getElementById("at-fs-password").value = "";
  }
  function openDashboard() { closeModal(); document.getElementById("at-fs-dashboard").hidden = false; render(); }
  function closeDashboard() { document.getElementById("at-fs-dashboard").hidden = true; }

  async function login(event) {
    event.preventDefault();
    var password = document.getElementById("at-fs-password").value;
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
    }
  }

  async function logout() { await state.api.signOut(state.auth); state.isAdmin = false; closeDashboard(); }

  function groups() { return state.config.ageGroups || [{ label: "초등(9~13)", min: 9, max: 13 }, { label: "중등(14~16)", min: 14, max: 16 }, { label: "고등(17~19)", min: 17, max: 19 }, { label: "청년(20~24)", min: 20, max: 24 }, { label: "청년(25~39)", min: 25, max: 39 }, { label: "유아(~8)", min: 0, max: 8 }, { label: "성인(40~)", min: 40, max: Infinity }]; }
  function localDateKey(date) { return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0"); }
  function recordDateKey(item) { if (item.dateKey) return String(item.dateKey); var value = item.createdAt, date = value && typeof value.toDate === "function" ? value.toDate() : new Date(value); return isNaN(date) ? "" : localDateKey(date); }
  function inRange(item) {
    if (state.filter === "all") return true;
    var key = recordDateKey(item);
    if (!key) return false;
    if (state.filter === "month") return key.slice(0, 7) === localDateKey(new Date()).slice(0, 7);
    return state.filter !== "custom" || (key >= state.rangeStart && key <= state.rangeEnd);
  }
  function currentActivityName(name) {
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
    var gs = groups(), totals = {};
    purposes.forEach(function (p) { totals[p] = gs.map(function () { return [0, 0]; }); });
    records.filter(inRange).forEach(function (row) { var people = memberMode ? (row.members || []) : [row]; var ps = memberMode ? [row.facility || "시설 미지정"] : (row.activities || []).map(currentActivityName); people.forEach(function (person) { var age = Number(person.age), gi = gs.findIndex(function (g) { return age >= g.min && age <= g.max; }); ps.forEach(function (p) { if (gi >= 0 && totals[p]) totals[p][gi][person.gender === "여성" ? 1 : 0]++; }); }); });
    var colTotal = function (cells, predicate) { return cells.reduce(function (sum, pair, i) { return sum + (predicate ? (predicate(gs[i]) ? pair[0] + pair[1] : 0) : pair[0] + pair[1]); }, 0); };
    var head = '<thead><tr><th rowspan="2">' + (memberMode ? "이용 목적" : "이용 목적") + '</th>' + gs.map(function (g) { return '<th colspan="2">' + esc(g.label) + '</th>'; }).join("") + '<th rowspan="2" class="' + (ar ? 'at-ar-sum-col' : 'at-sum-col') + '">청소년 합계</th><th rowspan="2" class="' + (ar ? 'at-ar-sum-col' : 'at-sum-col') + '">청년 합계</th><th rowspan="2" class="at-total-sum-col">전체 합계</th></tr><tr class="at-gender-header">' + gs.map(function () { return '<th class="at-male">남</th><th class="at-female">여</th>'; }).join("") + '</tr></thead>';
    var body = purposes.map(function (p) { var cells = totals[p]; return '<tr class="at-category-row"><td>' + esc(p) + '</td>' + cells.map(function (pair) { return '<td>' + pair[0] + '</td><td>' + pair[1] + '</td>'; }).join("") + '<td class="' + (ar ? 'at-ar-sum-col' : 'at-sum-col') + '">' + colTotal(cells, function (g) { return g.max <= 19; }) + '</td><td class="' + (ar ? 'at-ar-sum-col' : 'at-sum-col') + '">' + colTotal(cells, function (g) { return g.min >= 20 && g.max <= 39; }) + '</td><td class="at-total-sum-col">' + colTotal(cells) + '</td></tr>'; }).join("");
    return '<div class="at-stats-container ' + (ar ? 'at-ar-border' : '') + '"><div class="at-stats-wrapper"><table class="at-stats-table">' + head + '<tbody>' + body + '</tbody></table></div></div>';
  }
  function renderActivitySettings() {
    var content = document.getElementById("at-ref-content");
    if (!content) return;
    var rows = state.activities.map(function (activity, index) {
      return '<div class="at-activity-setting-row"><strong>' + (index + 1) + '</strong><label>활동명<input data-activity-name="' + esc(activity.id) + '" value="' + esc(activity.name) + '" maxlength="20"></label><label>이모지<input data-activity-emoji="' + esc(activity.id) + '" value="' + esc(activity.emoji) + '" maxlength="8"></label><button type="button" class="at-activity-delete" data-delete-activity="' + esc(activity.id) + '">삭제</button></div>';
    }).join("");
    content.innerHTML = '<section class="at-activity-settings"><h2>방문 등록 활동 카드 관리</h2><p>사진 서비스 가입 없이 이모지로 카드를 꾸밀 수 있습니다. 카드는 1~' + MAX_ACTIVITIES + '개까지 추가·삭제할 수 있으며, 저장하면 방문 등록 화면에 바로 반영됩니다.</p><div class="at-activity-setting-list">' + rows + '</div><div class="at-activity-actions"><button type="button" id="at-add-activity" class="at-activity-add"' + (state.activities.length >= MAX_ACTIVITIES ? ' disabled' : '') + '>+ 활동 카드 추가</button><button id="at-save-activities" class="at-activity-save">활동 카드 저장</button></div></section>';
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
    try {
      await state.api.setDoc(state.api.doc(state.db, state.config.collections.settings, "activities"), { items: items, updatedAt: new Date().toISOString() });
      state.activities = items;
      notify("활동 카드가 저장되었습니다.", "success");
    } catch (error) {
      console.error("[AdminTool] activity settings save failed", error);
      notify("활동 카드를 저장하지 못했습니다.", "error");
    }
  }
  function render() {
    var content = document.getElementById("at-ref-content"); if (!content) return;
    if (state.view === "activities") { renderActivitySettings(); return; }
    var isAr = state.view === "reservations", records = (isAr ? state.reservations : state.visits).filter(inRange), purposes = isAr ? facilityList(state.reservations) : purposeList(state.visits), title = isAr ? "시설 이용 통계 (예약 기반)" : "이용 목적 및 연령별 통계";
    document.getElementById("at-ref-date").textContent = new Date().toLocaleDateString("ko-KR").replace(/\. /g, ".").replace(/\.$/, "");
    var customControls = state.filter === "custom" ? '<div class="at-ref-date-range"><input id="at-ref-start-date" type="date" aria-label="시작일" value="' + esc(state.rangeStart) + '"><span>~</span><input id="at-ref-end-date" type="date" aria-label="종료일" value="' + esc(state.rangeEnd) + '"><button id="at-ref-apply-range">조회</button></div>' : '';
    content.innerHTML = '<section class="at-ref-filter"><strong>⌕&nbsp; 통계 기간 필터</strong><div><button data-filter="all" class="' + (state.filter === 'all' ? 'is-current' : '') + '">전체</button><button data-filter="month" class="' + (state.filter === 'month' ? 'is-current' : '') + '">월별 ' + new Date().getFullYear() + '년 ' + (new Date().getMonth() + 1) + '월</button><button data-filter="custom" class="' + (state.filter === 'custom' ? 'is-current' : '') + '">지정 기간</button>' + customControls + '</div></section><section class="at-ref-section"><h2>' + (isAr ? '✓' : '▥') + ' ' + title + '</h2>' + statsTable(isAr ? state.reservations : state.visits, purposes, isAr, isAr) + '<div class="at-log-header"><h2 class="at-log-title">상세 ' + (isAr ? '시설 예약' : '방문') + ' 내역</h2><div class="at-log-actions"><button class="at-excel-btn ' + (isAr ? 'at-indigo-btn' : '') + '" id="at-ref-export">⇩ 엑셀 다운로드</button><span class="at-count-badge ' + (isAr ? 'at-indigo-badge' : 'at-blue-badge') + '">' + records.length + '건</span></div></div><div class="at-log-table-wrap"><table class="at-log-table"><thead class="at-log-thead">' + (isAr ? '<tr><th>예약날짜</th><th>예약시간</th><th>시설</th><th>대표자</th><th>총 인원</th><th>이용자 명단</th><th>관리</th></tr>' : '<tr><th>날짜</th><th>시간</th><th>이름</th><th>성별</th><th>나이</th><th>목적</th><th>관리</th></tr>') + '</thead><tbody id="at-fs-body"></tbody></table></div></section>';
    content.querySelectorAll('[data-filter]').forEach(function (button) { button.onclick = function () { state.filter = button.dataset.filter; if (state.filter === "custom" && !state.rangeStart) { state.rangeStart = localDateKey(new Date()); state.rangeEnd = state.rangeStart; } render(); }; });
    var applyRange = document.getElementById("at-ref-apply-range");
    if (applyRange) applyRange.onclick = function () { var start = document.getElementById("at-ref-start-date").value, end = document.getElementById("at-ref-end-date").value; if (!start || !end || start > end) { notify("시작일과 종료일을 올바르게 선택해주세요.", "error"); return; } state.rangeStart = start; state.rangeEnd = end; render(); };
    document.getElementById("at-ref-export").onclick = function () { exportCsv(isAr ? "reservations" : "visits"); }; renderTable(state.view);
  }

  function renderTable(view) {
    var body = document.getElementById("at-fs-body");
    if (!body) return;
    var rows = (view === "visits" ? state.visits : state.reservations).filter(inRange);
    if (!rows.length) { body.innerHTML = '<tr><td colspan="7" class="at-fs-empty">등록된 내역이 없습니다.</td></tr>'; return; }
    body.innerHTML = rows.map(function (row) {
      if (view === "visits") return "<tr class=\"at-log-row\"><td class=\"at-date-cell\">" + esc(dateText(row.createdAt).split(" ")[0]) + "</td><td class=\"at-time-cell\">" + esc(row.timestamp || dateText(row.createdAt)) + "</td><td class=\"at-name-cell\">" + esc(row.name) + "</td><td>" + esc(row.gender) + "</td><td>" + esc(row.age) + "</td><td><div class=\"at-purpose-wrap\">" + (row.activities || []).map(function (item) { return '<span class="at-purpose-badge">' + esc(item) + '</span>'; }).join("") + "</div></td><td><button class=\"at-delete-btn at-fs-delete\" data-collection=\"visits\" data-id=\"" + esc(row.id) + "\">삭제</button></td></tr>";
      var members = row.members || [];
      return "<tr class=\"at-log-row at-ar-row\"><td class=\"at-date-cell\">" + esc(row.dateKey || dateText(row.createdAt)) + "</td><td class=\"at-time-cell at-indigo-text\">" + esc(row.timeSlot) + "</td><td class=\"at-name-cell\">" + esc(row.facility || "시설 미지정") + "</td><td class=\"at-name-cell\">" + esc(members[0] && members[0].name) + "</td><td>" + members.length + "명</td><td class=\"at-detail-cell\">" + members.map(function (member) { return '<span class="at-user-chip">' + esc(member.name) + '<span class="at-user-meta">(' + esc(member.gender) + ', ' + esc(member.age) + ')</span></span>'; }).join("") + "</td><td><button class=\"at-delete-btn at-fs-delete\" data-collection=\"reservations\" data-id=\"" + esc(row.id) + "\">삭제</button></td></tr>";
    }).join("");
    body.querySelectorAll(".at-fs-delete").forEach(function (button) { button.onclick = removeRecord; });
  }

  async function removeRecord(event) {
    var button = event.currentTarget;
    if (!window.confirm("이 기록을 삭제하시겠습니까?")) return;
    try { await state.api.deleteDoc(state.api.doc(state.db, state.config.collections[button.dataset.collection], button.dataset.id)); notify("삭제되었습니다.", "success"); }
    catch (error) { console.error("[AdminTool] delete failed", error); notify("삭제하지 못했습니다.", "error"); }
  }

  function csvCell(value) { var text = String(value == null ? "" : value); return /[\",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }
  function exportPeriodSuffix() {
    if (state.filter === "month") return localDateKey(new Date()).slice(0, 7);
    if (state.filter === "custom") return state.rangeStart + "_to_" + state.rangeEnd;
    return "all";
  }
  function exportCsv(type) {
    var lines = [["구분", "일시/시간", "시설/활동", "이름", "나이", "성별"]];
    if (!type || type === "visits") state.visits.filter(inRange).forEach(function (visit) { (visit.activities || []).forEach(function (activity) { lines.push(["방문등록", visit.timestamp || dateText(visit.createdAt), activity, visit.name, visit.age, visit.gender]); }); });
    if (!type || type === "reservations") state.reservations.filter(inRange).forEach(function (reservation) { (reservation.members || []).forEach(function (member) { lines.push(["시설예약", (reservation.dateKey || dateText(reservation.createdAt)) + " " + (reservation.timeSlot || ""), reservation.facility, member.name, member.age, member.gender]); }); });
    if (lines.length === 1) { notify("다운로드할 데이터가 없습니다."); return; }
    var blob = new Blob(["\uFEFF" + lines.map(function (line) { return line.map(csvCell).join(","); }).join("\n")], { type: "text/csv;charset=utf-8" });
    var link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = (state.config.exportFileName || "admin-export") + "-" + exportPeriodSuffix() + ".csv"; link.click(); URL.revokeObjectURL(link.href);
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
    firestoreApi.onSnapshot(firestoreApi.collection(state.db, state.config.collections.visits), function (snapshot) { state.visits = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); }).sort(function (a, b) { return dateValue(b.createdAt) - dateValue(a.createdAt); }); render(); }, function (error) { console.error("[AdminTool] visits subscription failed", error); });
    firestoreApi.onSnapshot(firestoreApi.collection(state.db, state.config.collections.reservations), function (snapshot) { state.reservations = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); }).sort(function (a, b) { return dateValue(b.createdAt) - dateValue(a.createdAt); }); render(); }, function (error) { console.error("[AdminTool] reservations subscription failed", error); });
    firestoreApi.onSnapshot(firestoreApi.doc(state.db, state.config.collections.settings, "activities"), function (snapshot) { var items = snapshot.exists() && snapshot.data().items; if (Array.isArray(items) && items.length > 0 && items.length <= MAX_ACTIVITIES) state.activities = items; render(); }, function (error) { console.warn("[AdminTool] activity settings subscription failed", error); });
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
