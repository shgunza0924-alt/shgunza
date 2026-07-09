// js/reservation.js
// Handles 시설 예약 (facility reservation): new reservation form,
// live reservations, and my-bookings preview.
//수정확인
import { notify } from "./notification.js";
import {
  getDateKey,
  generateTimeSlots,
  getAmSlots,
  getPmSlots,
  isResFormValid,
} from "./utils.js";
import { showEditBookingModal, hideEditBookingModal } from "./modal.js";
import { switchResView } from "./ui.js";
import { db } from "./firebase.js";
import { 
  collection, 
  addDoc, 
  doc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const today = new Date();
const timeSlots = generateTimeSlots();
const amSlots = getAmSlots(timeSlots);
const pmSlots = getPmSlots(timeSlots);

let reservations = [];
const changeListeners = [];

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
const reservationSubmitBtn = document.getElementById("reservation-submit-btn");

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

// ===================================================================
// Rendering: time slots
// ===================================================================
function isSlotBooked(slot) {
  return reservations.some(
    (r) =>
      r.facility === resData.facility &&
      r.timeSlot === slot &&
      (r.dateKey || getDateKey(new Date(r.createdAt || Date.now()))) ===
        getDateKey(today)
  );
}

function renderSlotGroup(container, slots) {
  container.innerHTML = "";
  slots.forEach((slot) => {
    const booked = isSlotBooked(slot);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "time-slot-btn";
    btn.textContent = slot;
    if (booked) {
      btn.classList.add("booked");
      btn.disabled = true;
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
      resData.facility = btn.dataset.facility;
      facilitySelectEl.querySelectorAll(".facility-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      renderTimeSlots();
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
    nameField.appendChild(nameInput);

    const ageField = document.createElement("div");
    ageField.className = "member-field field-age";
    ageField.innerHTML = `<label class="member-field-label">나이</label>`;
    const ageInput = document.createElement("input");
    ageInput.type = "number";
    ageInput.placeholder = "나이";
    ageInput.value = member.age;
    ageInput.addEventListener("input", (e) => {
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
  if (!isResFormValid(resData, resMembers)) return;

  const now = new Date();
  const dateKey = getDateKey(now);
  const newRes = {
    ...resData,
    members: resMembers,
    dateKey,
    createdAt: now.toISOString(),
  };

  try {
    await addDoc(collection(db, "reservations"), newRes);
    resData = { ...resData, timeSlot: "" };
    resMembers = [{ name: "", age: "", gender: "남성" }];
    renderTimeSlots();
    renderMembersList();
    renderSubmitButtonState();
    notify("예약이 완료되었습니다!");
    switchResView("new");
  } catch (error) {
    console.error("Reservation error:", error);
    notify("예약 처리 중 오류가 발생했습니다.");
  }
}

// ===================================================================
// My bookings: search
// ===================================================================
function findMyBookings() {
  searchQuery.name = searchNameInput.value;
  searchQuery.age = searchAgeInput.value;

  if (!searchQuery.name || !searchQuery.age) {
    notify("이름과 나이를 입력해주세요.");
    return;
  }
  
  myBookings = reservations.filter((r) =>
    (r.members || []).some(
      (m) => m.name === searchQuery.name && m.age === searchQuery.age
    )
  );
  
  renderMyBookings();
  
  if (myBookings.length === 0) notify("조회된 예약이 없습니다.");
}

function renderMyBookings() {
  myBookingsResultsEl.innerHTML = "";
  myBookings.forEach((booking) => {
    const card = document.createElement("div");
    card.className = "booking-card";

    const top = document.createElement("div");
    top.className = "booking-card-top";
    top.innerHTML = `
      <span class="booking-facility-tag">${booking.facility}</span>
      <span class="booking-time">${booking.timeSlot}</span>
    `;

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

    const ageInput = document.createElement("input");
    ageInput.className = "field-age";
    ageInput.type = "number";
    ageInput.value = m.age;
    ageInput.placeholder = "나이";
    ageInput.addEventListener("input", (e) => {
      editingBooking.members[i].age = e.target.value;
    });

    fields.appendChild(nameInput);
    fields.appendChild(ageInput);

    const genderGroup = document.createElement("div");
    genderGroup.className = "edit-member-gender";
    ["남성", "여성"].forEach((g) => {
      const gBtn = document.createElement("button");
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
  if (
    !editingBooking.members.every(
      (m) => m.name.trim() !== "" && String(m.age).trim() !== ""
    )
  ) {
    notify("모든 이용자의 정보를 입력해주세요.");
    return;
  }

  try {
    const docRef = doc(db, "reservations", editingBooking.id);
    await updateDoc(docRef, { members: editingBooking.members });
    
    editingBooking = null;
    hideEditBookingModal();
    notify("수정되었습니다.");
  } catch (error) {
    console.error("Update error:", error);
    notify("예약 수정 중 오류가 발생했습니다.");
  }
}

async function handleCancelBooking(id) {
  if (!window.confirm("예약을 취소하시겠습니까?")) return;

  try {
    const docRef = doc(db, "reservations", id);
    await deleteDoc(docRef);
    notify("취소되었습니다.");
  } catch (error) {
    console.error("Cancel error:", error);
    notify("예약 취소 중 오류가 발생했습니다.");
  }
}

// ===================================================================
// Firestore live subscription
// ===================================================================
function subscribeToReservations() {
  const resRef = collection(db, "reservations");

  onSnapshot(resRef, (snapshot) => {
    const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    reservations = data;
    
    renderTimeSlots();
    
    // Maintain My Bookings UI Sync: If search is active, re-filter the fresh dataset.
    if (searchQuery.name && searchQuery.age) {
      myBookings = reservations.filter((r) =>
        (r.members || []).some(
          (m) => m.name === searchQuery.name && m.age === searchQuery.age
        )
      );
      renderMyBookings();
    }
    
    notifyChange();
  }, (error) => {
    console.error("Error fetching reservations:", error);
  });
}

// ===================================================================
// Init
// ===================================================================
export function initReservation() {
  wireFacilitySelect();
  renderTimeSlots();
  renderMembersList();
  renderSubmitButtonState();

  addMemberBtn.addEventListener("click", () => {
    if (resMembers.length < 4) {
      resMembers.push({ name: "", age: "", gender: "남성" });
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

  subscribeToReservations();
}