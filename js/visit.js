// Handles visitor registration while retaining the existing Firestore schema.
import { notify } from "./notification.js";
import { db } from "./firebase.js";
import { createAgeSelect, getKoreanNameError, isValidKoreanName } from "./utils.js";
import { collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

let visits = [];
let visitors = [{ name: "", age: "", gender: "남성" }];
let activities = [];
const changeListeners = [];
const checkinForm = document.getElementById("checkin-form");
const visitorsList = document.getElementById("checkin-visitors-list");
const addVisitorBtn = document.getElementById("add-checkin-visitor-btn");
const activitiesGrid = document.getElementById("activities-grid");

export function getVisits() { return visits; }
export function onVisitsChange(callback) { changeListeners.push(callback); }
function notifyChange() { changeListeners.forEach((callback) => callback(visits)); }

function renderVisitors() {
  visitorsList.innerHTML = "";
  visitors.forEach((visitor, index) => {
    const row = document.createElement("div");
    row.className = "checkin-visitor-row";
    row.innerHTML = '<div class="field"><label class="field-label">이름 <span class="required">*</span></label><input type="text" class="input input-lg" placeholder="성함을 입력하세요"></div><div class="field"><label class="field-label">나이 <span class="required">*</span></label></div><div class="field"><label class="field-label">성별 <span class="required">*</span></label><div class="toggle-group"><button type="button" class="toggle-btn">남성</button><button type="button" class="toggle-btn">여성</button></div></div>';
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
      remove.type = "button"; remove.className = "member-remove-btn"; remove.textContent = "−";
      remove.onclick = () => { visitors.splice(index, 1); renderVisitors(); };
      row.appendChild(remove);
    }
    visitorsList.appendChild(row);
  });
  addVisitorBtn.disabled = visitors.length >= 10;
  addVisitorBtn.textContent = visitors.length >= 10 ? "최대 10명" : "+ 방문자 추가";
}

function resetFormUI() {
  visitors = [{ name: "", age: "", gender: "남성" }]; activities = [];
  renderVisitors();
  activitiesGrid.querySelectorAll(".activity-card").forEach((card) => card.classList.remove("active"));
}

async function handleCheckIn(event) {
  event.preventDefault();
  const invalid = visitors.find((visitor) => !isValidKoreanName(visitor.name));
  if (invalid) { notify(getKoreanNameError(invalid.name)); return; }
  if (visitors.some((visitor) => !visitor.age)) { notify("나이를 선택해주세요."); return; }
  if (!activities.length) { notify("활동을 하나 이상 선택해주세요!"); return; }
  const now = new Date();
  const timestamp = `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()}. ${now.toLocaleTimeString()}`;
  try {
    await Promise.all(visitors.map((visitor) => addDoc(collection(db, "visits"), { ...visitor, activities: [...activities], timestamp, createdAt: now.toISOString() })));
    resetFormUI(); notify("입장이 완료되었습니다!");
  } catch (error) { console.error("Check-in error:", error); notify("방문 등록 중 오류가 발생했습니다."); }
}

function wireForm() {
  checkinForm.addEventListener("submit", handleCheckIn);
  addVisitorBtn.addEventListener("click", () => { if (visitors.length < 10) { visitors.push({ name: "", age: "", gender: "남성" }); renderVisitors(); } });
  activitiesGrid.querySelectorAll(".activity-card").forEach((card) => card.addEventListener("click", () => {
    const activity = card.dataset.activity;
    activities = activities.includes(activity) ? activities.filter((item) => item !== activity) : [...activities, activity];
    card.classList.toggle("active", activities.includes(activity));
  }));
}

function subscribeToVisits() { onSnapshot(collection(db, "visits"), (snapshot) => { visits = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); notifyChange(); }, (error) => console.error("Error fetching visits:", error)); }
export function initVisit() { wireForm(); renderVisitors(); subscribeToVisits(); }
