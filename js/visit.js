// Handles visitor registration while retaining the existing Firestore schema.
import { notify } from "./notification.js";
import { waitForAuth } from "./auth.js";
import { db } from "./firebase.js";
import { getFirestoreErrorMessage, logFirestoreError } from "./firestore-errors.js";
import { createAgeSelect, createVisitPayload, getKoreanNameError, isValidKoreanName } from "./utils.js";
import { collection, addDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

let visits = [];
let visitors = [{ name: "", age: "", gender: "남성" }];
let activities = [];
const changeListeners = [];
const checkinForm = document.getElementById("checkin-form");
const visitorsList = document.getElementById("checkin-visitors-list");
const addVisitorBtn = document.getElementById("add-checkin-visitor-btn");
const removeVisitorBtn = document.getElementById("remove-checkin-visitor-btn");
const visitorCountEl = document.getElementById("checkin-visitor-count");
const activitiesGrid = document.getElementById("activities-grid");
let initialized = false;
let checkInPending = false;
let activitySettingsPromise = null;

function renderActivityCards(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 12) return;

  const validItems = items.filter((item) => item?.id && String(item.name || "").trim());
  if (validItems.length !== items.length) return;

  activities = activities.filter((activity) =>
    validItems.some((item) => item.name === activity)
  );
  activitiesGrid.innerHTML = "";

  validItems.forEach((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "activity-card";
    card.setAttribute("aria-pressed", "false");
    card.dataset.activityId = item.id;
    card.dataset.activity = item.name;

    const icon = document.createElement("div");
    icon.className = "activity-icon activity-emoji";
    icon.textContent = item.emoji || "✨";
    const label = document.createElement("span");
    label.className = "activity-label";
    label.textContent = item.name;
    card.append(icon, label);
    activitiesGrid.appendChild(card);
  });
}

export function getVisits() { return visits; }
export function onVisitsChange(callback) { changeListeners.push(callback); }
function notifyChange() { changeListeners.forEach((callback) => callback(visits)); }

function renderVisitors() {
  visitorsList.innerHTML = "";
  visitors.forEach((visitor, index) => {
    const row = document.createElement("div");
    row.className = "checkin-visitor-row";
    row.innerHTML = '<div class="field"><label class="field-label">이름 <span class="required">*</span></label><input type="text" class="input input-lg" placeholder="이름을 입력하세요"></div><div class="field"><label class="field-label">나이 <span class="required">*</span></label></div><div class="field"><label class="field-label">성별 <span class="required">*</span></label><div class="toggle-group"><button type="button" class="toggle-btn">남성</button><button type="button" class="toggle-btn">여성</button></div></div>';
    const nameInput = row.querySelector("input");
    nameInput.value = visitor.name;
    nameInput.addEventListener("input", (event) => { visitors[index].name = event.target.value; });
    nameInput.addEventListener("blur", () => { const error = getKoreanNameError(visitors[index].name); if (error) notify(error); });
    const ageSelect = createAgeSelect(visitor.age);
    ageSelect.addEventListener("change", (event) => { visitors[index].age = event.target.value; });
    row.querySelectorAll(".field")[1].appendChild(ageSelect);
    row.querySelectorAll(".toggle-btn").forEach((button) => {
      const gender = button.textContent;
      button.classList.toggle("active", visitor.gender === gender);
      button.onclick = () => { visitors[index].gender = gender; renderVisitors(); };
    });
    if (visitors.length > 1) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "member-remove-btn checkin-remove-btn";
      remove.textContent = "−";
      remove.setAttribute("aria-label", `${index + 1}번째 방문자 삭제`);
      remove.title = "방문자 삭제";
      remove.onclick = () => { visitors.splice(index, 1); renderVisitors(); };
      row.appendChild(remove);
    }
    visitorsList.appendChild(row);
  });
  addVisitorBtn.disabled = visitors.length >= 10;
  removeVisitorBtn.disabled = visitors.length <= 1;
  visitorCountEl.textContent = `${visitors.length}명`;
}

function resetFormUI() {
  visitors = [{ name: "", age: "", gender: "남성" }]; activities = [];
  renderVisitors();
  activitiesGrid.querySelectorAll(".activity-card").forEach((card) => {
    card.classList.remove("active");
    card.setAttribute("aria-pressed", "false");
  });
}

async function handleCheckIn(event) {
  event.preventDefault();
  if (checkInPending) return;
  const invalid = visitors.find((visitor) => !isValidKoreanName(visitor.name));
  if (invalid) { notify(getKoreanNameError(invalid.name)); return; }
  if (visitors.some((visitor) => !visitor.age)) { notify("나이를 선택해주세요."); return; }
  if (!activities.length) { notify("활동을 하나 이상 선택해주세요!"); return; }
  const submitButton = checkinForm.querySelector('[type="submit"]');
  checkInPending = true;
  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  try {
    if (!(await waitForAuth())) {
      notify("인증 준비에 실패했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    const now = new Date();
    await Promise.all(visitors.map((visitor) => addDoc(
      collection(db, "visits"),
      createVisitPayload(visitor, activities, now),
    )));
    resetFormUI(); notify("입장이 완료되었습니다!");
  } catch (error) {
    logFirestoreError("check-in write", error);
    notify(getFirestoreErrorMessage(error, "방문 등록"));
  } finally {
    checkInPending = false;
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
  }
}

function wireForm() {
  checkinForm.addEventListener("submit", handleCheckIn);
  activitiesGrid.querySelectorAll(".activity-card").forEach((card) => card.setAttribute("aria-pressed", "false"));
  addVisitorBtn.addEventListener("click", () => { if (visitors.length < 10) { visitors.push({ name: "", age: "", gender: "남성" }); renderVisitors(); } });
  removeVisitorBtn.addEventListener("click", () => { if (visitors.length > 1) { visitors.pop(); renderVisitors(); } });
  activitiesGrid.addEventListener("click", (event) => {
    const card = event.target.closest(".activity-card");
    if (!card || !activitiesGrid.contains(card)) return;
    const activity = card.dataset.activity;
    activities = activities.includes(activity) ? activities.filter((item) => item !== activity) : [...activities, activity];
    card.classList.toggle("active", activities.includes(activity));
    card.setAttribute("aria-pressed", String(activities.includes(activity)));
  });
}

async function loadActivitySettings() {
  if (activitySettingsPromise) return activitySettingsPromise;
  activitySettingsPromise = (async () => {
    if (!(await waitForAuth())) return;
    try {
      const snapshot = await getDoc(doc(db, "siteSettings", "activities"));
      if (snapshot.exists()) renderActivityCards(snapshot.data().items);
    } catch (error) {
      // Optional settings use the unchanged built-in cards when unavailable.
      logFirestoreError("activity settings read", error);
    }
  })();
  return activitySettingsPromise;
}

export function initVisit() {
  if (initialized) return;
  initialized = true;
  wireForm();
  renderVisitors();
  // This is the only check-in screen read: one optional settings document.
  void loadActivitySettings();
}
