// js/reservation.js
// Handles 시설 예약 (facility reservation): new reservation form,
// live reservations, and my-bookings preview.
import { notify } from "./notification.js";
import { waitForAuth } from "./auth.js";
import {
  getDateKey,
  generateTimeSlots,
  getAmSlots,
  getPmSlots,
  isResFormValid,
  createAgeSelect,
  createReservationPayload,
  getKoreanNameError,
  isValidKoreanName,
} from "./utils.js";
import { showEditBookingModal, hideEditBookingModal } from "./modal.js";
import { switchResView } from "./ui.js";
import { db } from "./firebase.js";
import { getFirestoreErrorMessage, logFirestoreError } from "./firestore-errors.js";
import { 
  collection, 
  addDoc, 
  doc, 
  updateDoc, 
  deleteDoc, 
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  startAfter,
  limit,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const DEFAULT_BOOKING_SETTINGS = {
  schedule: {
    weekday: { start: "09:00", end: "19:00" },
    weekend: { start: "09:00", end: "19:00" },
    lunch: { enabled: true, start: "12:00", end: "13:00" },
  },
  notices: {
    "AR 스포츠": { enabled: true, message: "AR 스포츠는 1회 20분, 최대 10명까지 이용할 수 있습니다." },
    "노래방1": { enabled: true, message: "노래방 1실은 1회 20분, 최대 10명까지 이용할 수 있습니다." },
    "노래방2": { enabled: true, message: "노래방 2실은 1회 20분, 최대 10명까지 이용할 수 있습니다." },
  },
};

let bookingSettings = JSON.parse(JSON.stringify(DEFAULT_BOOKING_SETTINGS));
let bookingSettingsLoaded = false;
let pendingFacilityNotice = null;
let timeSlots = [];
let amSlots = [];
let pmSlots = [];

let reservations = [];
const changeListeners = [];
const RESERVATIONS_CACHE_MS = 60 * 1000;
const MAX_TODAY_RESERVATIONS = 100;
const MAX_MY_BOOKINGS = 50;
let reservationsLoadedDateKey = "";
let reservationsLoadedAt = 0;
let reservationsLoadPromise = null;
let bookingSettingsPromise = null;
let initialized = false;
let reservationMutationPending = false;
const pendingReservationDeletes = new Set();

// local form state
let resData = { facility: "AR 스포츠", timeSlot: "" };
let resMembers = [{ name: "", age: "", gender: "남성" }];

// my-bookings state
let searchQuery = { name: "", age: "" };
let myBookings = [];
let editingBooking = null;

// DOM refs
const facilitySelectEl = document.getElementById("facility-select");
const amSlotsEl = document.getElementById("am-slots");
const pmSlotsEl = document.getElementById("pm-slots");
const resMembersListEl = document.getElementById("res-members-list");
const addMemberBtn = document.getElementById("add-member-btn");
const removeMemberBtn = document.getElementById("remove-member-btn");
const memberCountEl = document.getElementById("reservation-member-count");
const reservationSubmitBtn = document.getElementById("reservation-submit-btn");
const bookingHoursTextEl = document.getElementById("booking-hours-text");
const reservationsTabBtn = document.getElementById("tab-reservations-btn");

const facilityNoticeModalEl = document.getElementById("facility-notice-modal");
const facilityNoticeTitleEl = document.getElementById("facility-notice-title");
const facilityNoticeMessageEl = document.getElementById("facility-notice-message");
const facilityNoticeConfirmBtn = document.getElementById("facility-notice-confirm-btn");

const searchNameInput = document.getElementById("search-name");
const searchAgeInput = document.getElementById("search-age");
const findBookingsBtn = document.getElementById("find-bookings-btn");
const backToNewBtn = document.getElementById("back-to-new-btn");
const myBookingsResultsEl = document.getElementById("my-bookings-results");

const editBookingMembersEl = document.getElementById("edit-booking-members");
const editModalCloseBtn = document.getElementById("edit-modal-close-btn");
const editBookingSaveBtn = document.getElementById("edit-booking-save-btn");

export function getReservations() {
  return reservations;
}

export function onReservationsChange(callback) {
  changeListeners.push(callback);
}

function notifyChange() {
  changeListeners.forEach((cb) => cb(reservations));
}

function setPending(button, pending) {
  if (!button) return;
  button.disabled = !!pending;
  if (pending) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}

function normalizeBookingSettings(value = {}) {
  const schedule = value.schedule || {};
  const notices = value.notices || {};
  return {
    schedule: {
      weekday: { ...DEFAULT_BOOKING_SETTINGS.schedule.weekday, ...(schedule.weekday || {}) },
      weekend: { ...DEFAULT_BOOKING_SETTINGS.schedule.weekend, ...(schedule.weekend || {}) },
      lunch: { ...DEFAULT_BOOKING_SETTINGS.schedule.lunch, ...(schedule.lunch || {}) },
    },
    notices: Object.fromEntries(
      Object.entries(DEFAULT_BOOKING_SETTINGS.notices).map(([facility, defaults]) => [
        facility,
        { ...defaults, ...(notices[facility] || {}) },
      ])
    ),
  };
}

function getTodaySchedule() {
  const day = new Date().getDay();
  return day === 0 || day === 6
    ? { label: "주말", ...bookingSettings.schedule.weekend }
    : { label: "평일", ...bookingSettings.schedule.weekday };
}

function rebuildTimeSlots() {
  const today = getTodaySchedule();
  const lunch = bookingSettings.schedule.lunch;
  timeSlots = generateTimeSlots({
    start: today.start,
    end: today.end,
    lunchEnabled: lunch.enabled,
    lunchStart: lunch.start,
    lunchEnd: lunch.end,
  });
  amSlots = getAmSlots(timeSlots);
  pmSlots = getPmSlots(timeSlots);
  if (resData.timeSlot && !timeSlots.includes(resData.timeSlot)) resData.timeSlot = "";
  bookingHoursTextEl.textContent = `${today.label} ${today.start}~${today.end}${lunch.enabled ? ` · 점심시간 ${lunch.start}~${lunch.end}` : ""}`;
  renderTimeSlots();
  renderSubmitButtonState();
}

function showFacilityNotice(facility) {
  if (!bookingSettingsLoaded) {
    pendingFacilityNotice = facility;
    return;
  }
  const notice = bookingSettings.notices[facility];
  if (!notice?.enabled || !String(notice.message || "").trim()) return;
  const label = facility === "노래방1" ? "노래방 1실" : facility === "노래방2" ? "노래방 2실" : facility;
  facilityNoticeTitleEl.textContent = `${label} 이용 전 안내`;
  facilityNoticeMessageEl.textContent = notice.message;
  facilityNoticeModalEl.classList.remove("hidden");
  facilityNoticeConfirmBtn.focus();
}

function hideFacilityNotice() {
  facilityNoticeModalEl.classList.add("hidden");
}

// ===================================================================
// Rendering: time slots
// ===================================================================
function isSlotBooked(slot) {
  return reservations.some(
    (r) =>
      r.facility === resData.facility &&
      r.timeSlot === slot &&
      getReservationDateKey(r) === getDateKey(new Date())
  );
}

function getReservationDateKey(reservation) {
  if (reservation.dateKey) return reservation.dateKey;
  const createdAt = reservation.createdAt;
  const date = typeof createdAt?.toDate === "function"
    ? createdAt.toDate()
    : new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "" : getDateKey(date);
}

function renderSlotGroup(container, slots) {
  container.innerHTML = "";
  slots.forEach((slot) => {
    const booked = isSlotBooked(slot);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "time-slot-btn";
    const [start, end] = slot.split("~");
    btn.setAttribute("aria-label", `${start}부터 ${end}까지${booked ? ", 예약됨" : ""}`);
    btn.innerHTML = `<span class="time-slot-start">${start}</span><span class="time-slot-end">~ ${end}</span>`;
    if (booked) {
      btn.classList.add("booked");
      btn.disabled = true;
      const status = document.createElement("span");
      status.className = "time-slot-status";
      status.textContent = "예약됨";
      btn.appendChild(status);
    } else {
      if (resData.timeSlot === slot) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        resData.timeSlot = slot;
        renderTimeSlots();
        renderSubmitButtonState();
      });
    }
    container.appendChild(btn);
  });
}

function renderTimeSlots() {
  renderSlotGroup(amSlotsEl, amSlots);
  renderSlotGroup(pmSlotsEl, pmSlots);
}

// ===================================================================
// Rendering: facility selector
// ===================================================================
function wireFacilitySelect() {
  facilitySelectEl.querySelectorAll(".facility-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const facilityChanged = resData.facility !== btn.dataset.facility;
      resData.facility = btn.dataset.facility;
      // A selected time belongs to the previous facility and must not carry over.
      if (facilityChanged) resData.timeSlot = "";
      facilitySelectEl.querySelectorAll(".facility-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      renderTimeSlots();
      showFacilityNotice(resData.facility);
    });
  });
}

// ===================================================================
// Rendering: members list (new reservation form)
// ===================================================================
function renderMembersList() {
  resMembersListEl.innerHTML = "";
  resMembers.forEach((member, i) => {
    const row = document.createElement("div");
    row.className = "member-row";

    const nameField = document.createElement("div");
    nameField.className = "member-field field-name";
    nameField.innerHTML = `<label class="member-field-label">이름</label>`;
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "이름";
    nameInput.value = member.name;
    nameInput.addEventListener("input", (e) => {
      resMembers[i].name = e.target.value;
      renderSubmitButtonState();
    });
    nameInput.addEventListener("blur", () => {
      const error = getKoreanNameError(resMembers[i].name);
      if (error) notify(error);
    });
    nameField.appendChild(nameInput);

    const ageField = document.createElement("div");
    ageField.className = "member-field field-age";
    ageField.innerHTML = `<label class="member-field-label">나이</label>`;
    const ageInput = createAgeSelect(member.age);
    ageInput.addEventListener("change", (e) => {
      resMembers[i].age = e.target.value;
      renderSubmitButtonState();
    });
    ageField.appendChild(ageInput);

    const genderField = document.createElement("div");
    genderField.className = "member-field field-gender";
    genderField.innerHTML = `<label class="member-field-label">성별</label>`;
    const genderGroup = document.createElement("div");
    genderGroup.className = "member-gender-group";
    ["남성", "여성"].forEach((g) => {
      const gBtn = document.createElement("button");
      gBtn.type = "button";
      gBtn.textContent = g;
      if (member.gender === g) gBtn.classList.add("active");
      gBtn.addEventListener("click", () => {
        resMembers[i].gender = g;
        renderMembersList();
      });
      genderGroup.appendChild(gBtn);
    });
    genderField.appendChild(genderGroup);

    row.appendChild(nameField);
    row.appendChild(ageField);
    row.appendChild(genderField);

    if (resMembers.length > 1) {
      const removeWrap = document.createElement("div");
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "member-remove-btn";
      removeBtn.innerHTML =
        '<svg class="icon icon-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
      removeBtn.addEventListener("click", () => {
        resMembers = resMembers.filter((_, idx) => idx !== i);
        renderMembersList();
        renderSubmitButtonState();
      });
      removeWrap.appendChild(removeBtn);
      row.appendChild(removeWrap);
    }

    resMembersListEl.appendChild(row);
  });
  addMemberBtn.disabled = resMembers.length >= 10;
  removeMemberBtn.disabled = resMembers.length <= 1;
  memberCountEl.textContent = `${resMembers.length}명`;
}

function renderSubmitButtonState() {
  const valid = isResFormValid(resData, resMembers);
  reservationSubmitBtn.disabled = !valid;
  reservationSubmitBtn.textContent = valid
    ? "예약 확정하기"
    : "인원수대로 정보를 빠짐없이 입력해주세요";
}

// ===================================================================
// New reservation submit
// ===================================================================
async function handleReservation() {
  if (reservationMutationPending) return;
  if (!isResFormValid(resData, resMembers)) {
    const invalid = resMembers.find((member) => !isValidKoreanName(member.name));
    notify(invalid ? getKoreanNameError(invalid.name) : "시간과 이용자 정보를 모두 입력해주세요.");
    return;
  }

  reservationMutationPending = true;
  setPending(reservationSubmitBtn, true);
  try {
    if (!(await waitForAuth())) {
      notify("인증 준비에 실패했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    // Revalidate the small, date-scoped availability set immediately before
    // writing so a stale page never relies on an all-collection listener.
    if (!(await loadTodayReservations({ force: true, reportError: true }))) return;
    if (isSlotBooked(resData.timeSlot)) {
      resData = { ...resData, timeSlot: "" };
      renderTimeSlots();
      notify("방금 다른 예약이 등록되었습니다. 시간을 다시 선택해주세요.");
      return;
    }

    const now = new Date();
    const newRes = createReservationPayload(resData, resMembers, now);
    const reference = await addDoc(collection(db, "reservations"), newRes);
    reservations = [{ id: reference.id, ...newRes }, ...reservations];
    reservationsLoadedAt = Date.now();
    notifyChange();
    resData = { ...resData, timeSlot: "" };
    resMembers = [{ name: "", age: "", gender: "남성" }];
    renderTimeSlots();
    renderMembersList();
    renderSubmitButtonState();
    notify("예약이 완료되었습니다!");
    switchResView("new");
  } catch (error) {
    logFirestoreError("reservation write", error);
    notify(getFirestoreErrorMessage(error, "예약 처리"));
  } finally {
    reservationMutationPending = false;
    renderSubmitButtonState();
  }
}

// ===================================================================
// My bookings: search
// ===================================================================
async function findMyBookings() {
  if (findBookingsBtn.disabled) return;
  searchQuery.name = searchNameInput.value;
  searchQuery.age = searchAgeInput.value;

  if (!isValidKoreanName(searchQuery.name)) {
    notify(getKoreanNameError(searchQuery.name));
    return;
  }
  if (!searchQuery.age) {
    notify("이름과 나이를 입력해주세요.");
    return;
  }

  setPending(findBookingsBtn, true);
  try {
    if (!(await waitForAuth())) {
      notify("인증 준비에 실패했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    // Firestore can match the existing member-object schema exactly. Querying
    // both allowed gender values keeps the saved shape unchanged and avoids a
    // full reservations collection read.
    const memberKeys = ["남성", "여성"].map((gender) => ({
      name: searchQuery.name,
      age: searchQuery.age,
      gender,
    }));
    // This is an explicit, exact-match user search. Walk only that indexed
    // result set in bounded pages so older matching bookings remain editable.
    const matchingDocs = [];
    let cursor = null;
    do {
      const constraints = [
        where("members", "array-contains-any", memberKeys),
        orderBy("createdAt", "desc"),
      ];
      if (cursor) constraints.push(startAfter(cursor));
      constraints.push(limit(MAX_MY_BOOKINGS));
      const snapshot = await getDocs(query(
        collection(db, "reservations"),
        ...constraints,
      ));
      matchingDocs.push(...snapshot.docs);
      cursor = snapshot.docs.length === MAX_MY_BOOKINGS
        ? snapshot.docs[snapshot.docs.length - 1]
        : null;
    } while (cursor);
    myBookings = matchingDocs.map((item) => ({ id: item.id, ...item.data() }));
    renderMyBookings();
    if (myBookings.length === 0) notify("조회된 예약이 없습니다.");
  } catch (error) {
    myBookings = [];
    renderMyBookings();
    logFirestoreError("my bookings read", error);
    notify(getFirestoreErrorMessage(error, "예약 조회"));
  } finally {
    setPending(findBookingsBtn, false);
  }
}

function renderMyBookings() {
  myBookingsResultsEl.innerHTML = "";
  if (myBookings.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.setAttribute("role", "status");
    empty.textContent = searchQuery.name
      ? "조회된 예약이 없습니다."
      : "이름과 나이를 입력해 예약 내역을 조회해주세요.";
    myBookingsResultsEl.appendChild(empty);
    return;
  }

  myBookings.forEach((booking) => {
    const card = document.createElement("div");
    card.className = "booking-card";

    const top = document.createElement("div");
    top.className = "booking-card-top";
    const facility = document.createElement("span");
    facility.className = "booking-facility-tag";
    facility.textContent = booking.facility || "시설 정보 없음";
    const time = document.createElement("span");
    time.className = "booking-time";
    time.textContent = booking.timeSlot || "시간 정보 없음";
    top.append(facility, time);

    const membersWrap = document.createElement("div");
    membersWrap.className = "booking-members";
    (booking.members || []).forEach((m) => {
      const chip = document.createElement("span");
      chip.className = "booking-member-chip";
      chip.textContent = `${m.name}(${m.age}세)`;
      membersWrap.appendChild(chip);
    });

    const actions = document.createElement("div");
    actions.className = "booking-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "booking-action-btn booking-action-edit";
    editBtn.innerHTML =
      '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> 수정';
    editBtn.addEventListener("click", () => startEditBooking(booking));

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "booking-action-btn booking-action-cancel";
    cancelBtn.innerHTML =
      '<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> 취소';
    cancelBtn.addEventListener("click", () => handleCancelBooking(booking.id));

    actions.appendChild(editBtn);
    actions.appendChild(cancelBtn);

    card.appendChild(top);
    card.appendChild(membersWrap);
    card.appendChild(actions);

    myBookingsResultsEl.appendChild(card);
  });
}

// ===================================================================
// My bookings: edit
// ===================================================================
function startEditBooking(booking) {
  editingBooking = JSON.parse(JSON.stringify(booking));
  renderEditBookingModal();
  showEditBookingModal();
}

function renderEditBookingModal() {
  if (!editingBooking?.members) return;
  editBookingMembersEl.innerHTML = "";
  editingBooking.members.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "edit-member-row";

    const fields = document.createElement("div");
    fields.className = "edit-member-fields";

    const nameInput = document.createElement("input");
    nameInput.className = "field-name";
    nameInput.value = m.name;
    nameInput.placeholder = "이름";
    nameInput.addEventListener("input", (e) => {
      editingBooking.members[i].name = e.target.value;
    });
    nameInput.addEventListener("blur", () => {
      const error = getKoreanNameError(editingBooking.members[i].name);
      if (error) notify(error);
    });

    const ageInput = createAgeSelect(m.age, "field-age");
    ageInput.addEventListener("change", (e) => {
      editingBooking.members[i].age = e.target.value;
    });

    fields.appendChild(nameInput);
    fields.appendChild(ageInput);

    const genderGroup = document.createElement("div");
    genderGroup.className = "edit-member-gender";
    ["남성", "여성"].forEach((g) => {
      const gBtn = document.createElement("button");
      gBtn.type = "button";
      gBtn.textContent = g;
      if (m.gender === g) gBtn.classList.add("active");
      gBtn.addEventListener("click", () => {
        editingBooking.members[i].gender = g;
        renderEditBookingModal();
      });
      genderGroup.appendChild(gBtn);
    });

    row.appendChild(fields);
    row.appendChild(genderGroup);
    editBookingMembersEl.appendChild(row);
  });
}

async function handleUpdateBooking() {
  if (!editingBooking) return;
  if (
    !editingBooking.members.every(
      (m) => isValidKoreanName(m.name) && String(m.age).trim() !== ""
    )
  ) {
    const invalid = editingBooking.members.find((m) => !isValidKoreanName(m.name));
    notify(invalid ? getKoreanNameError(invalid.name) : "모든 이용자의 정보를 입력해주세요.");
    return;
  }

  if (editBookingSaveBtn.disabled) return;
  setPending(editBookingSaveBtn, true);
  try {
    if (!(await waitForAuth())) {
      notify("인증 준비에 실패했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    const docRef = doc(db, "reservations", editingBooking.id);
    await updateDoc(docRef, { members: editingBooking.members });
    reservations = reservations.map((item) => item.id === editingBooking.id
      ? { ...item, members: editingBooking.members.map((member) => ({ ...member })) }
      : item);
    myBookings = myBookings.map((item) => item.id === editingBooking.id
      ? { ...item, members: editingBooking.members.map((member) => ({ ...member })) }
      : item);
    notifyChange();
    editingBooking = null;
    hideEditBookingModal();
    renderMyBookings();
    notify("수정되었습니다.");
  } catch (error) {
    logFirestoreError("reservation update", error);
    notify(getFirestoreErrorMessage(error, "예약 수정"));
  } finally {
    setPending(editBookingSaveBtn, false);
  }
}

async function handleCancelBooking(id) {
  if (pendingReservationDeletes.has(id)) return;
  if (!window.confirm("예약을 취소하시겠습니까?")) return;

  pendingReservationDeletes.add(id);
  try {
    if (!(await waitForAuth())) {
      notify("인증 준비에 실패했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    const docRef = doc(db, "reservations", id);
    await deleteDoc(docRef);
    reservations = reservations.filter((item) => item.id !== id);
    myBookings = myBookings.filter((item) => item.id !== id);
    renderTimeSlots();
    renderMyBookings();
    notifyChange();
    notify("취소되었습니다.");
  } catch (error) {
    logFirestoreError("reservation delete", error);
    notify(getFirestoreErrorMessage(error, "예약 취소"));
  } finally {
    pendingReservationDeletes.delete(id);
  }
}

// ===================================================================
// Firestore reads: authenticated, bounded, one-shot, and de-duplicated
// ===================================================================
async function loadTodayReservations({ force = false, reportError = false } = {}) {
  const dateKey = getDateKey(new Date());
  const cacheFresh = reservationsLoadedDateKey === dateKey
    && Date.now() - reservationsLoadedAt < RESERVATIONS_CACHE_MS;
  if (!force && cacheFresh) return true;
  const activeRequest = reservationsLoadPromise;
  if (activeRequest) {
    if (!force) return activeRequest;
    await activeRequest;
    // Another forced caller may already have started the required fresh read.
    if (reservationsLoadPromise && reservationsLoadPromise !== activeRequest) {
      return reservationsLoadPromise;
    }
    if (reservationsLoadPromise === activeRequest) reservationsLoadPromise = null;
  }

  const request = (async () => {
    if (!(await waitForAuth())) {
      if (reportError) notify("인증 준비에 실패했습니다. 잠시 후 다시 시도해주세요.");
      return false;
    }
    try {
      const snapshot = await getDocs(query(
        collection(db, "reservations"),
        where("dateKey", "==", dateKey),
        limit(MAX_TODAY_RESERVATIONS),
      ));
      reservations = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      reservationsLoadedDateKey = dateKey;
      reservationsLoadedAt = Date.now();
      renderTimeSlots();
      notifyChange();
      return true;
    } catch (error) {
      logFirestoreError("today reservations read", error);
      if (reportError) notify(getFirestoreErrorMessage(error, "예약 현황 조회"));
      return false;
    }
  })();
  reservationsLoadPromise = request;

  try {
    return await request;
  } finally {
    if (reservationsLoadPromise === request) reservationsLoadPromise = null;
  }
}

async function loadBookingSettings() {
  if (bookingSettingsPromise) return bookingSettingsPromise;
  bookingSettingsPromise = (async () => {
    if (!(await waitForAuth())) return false;
    try {
      const snapshot = await getDoc(doc(db, "siteSettings", "bookingSettings"));
      bookingSettings = normalizeBookingSettings(snapshot.exists() ? snapshot.data() : {});
      return true;
    } catch (error) {
      // Defaults keep the unchanged booking screen usable if optional settings fail.
      logFirestoreError("booking settings read", error);
      return false;
    } finally {
      bookingSettingsLoaded = true;
      rebuildTimeSlots();
      if (pendingFacilityNotice) {
        const facility = pendingFacilityNotice;
        pendingFacilityNotice = null;
        const reservationPanel = document.getElementById("tab-reservations");
        if (reservationPanel && !reservationPanel.classList.contains("hidden")) showFacilityNotice(facility);
      }
    }
  })();
  return bookingSettingsPromise;
}

async function prepareReservationScreen() {
  await Promise.all([
    loadBookingSettings(),
    loadTodayReservations({ reportError: true }),
  ]);
}

// ===================================================================
// Init
// ===================================================================
export function initReservation() {
  if (initialized) return;
  initialized = true;
  wireFacilitySelect();
  rebuildTimeSlots();
  renderMembersList();
  renderSubmitButtonState();
  renderMyBookings();

  addMemberBtn.addEventListener("click", () => {
    if (resMembers.length < 10) {
      resMembers.push({ name: "", age: "", gender: "남성" });
      renderMembersList();
      renderSubmitButtonState();
    }
  });
  removeMemberBtn.addEventListener("click", () => {
    if (resMembers.length > 1) {
      resMembers.pop();
      renderMembersList();
      renderSubmitButtonState();
    }
  });

  reservationSubmitBtn.addEventListener("click", handleReservation);

  findBookingsBtn.addEventListener("click", findMyBookings);
  backToNewBtn.addEventListener("click", () => switchResView("new"));

  editModalCloseBtn.addEventListener("click", () => {
    editingBooking = null;
    hideEditBookingModal();
  });
  
  editBookingSaveBtn.addEventListener("click", handleUpdateBooking);
  facilityNoticeConfirmBtn.addEventListener("click", hideFacilityNotice);
  facilityNoticeModalEl.addEventListener("click", (event) => {
    if (event.target === facilityNoticeModalEl) hideFacilityNotice();
  });
  reservationsTabBtn.addEventListener("click", () => {
    window.setTimeout(() => showFacilityNotice(resData.facility), 0);
    void prepareReservationScreen();
  });
}
