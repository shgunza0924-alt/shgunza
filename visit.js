// js/visit.js
// Handles the 방문 등록 (check-in) form.

import { notify } from "./notification.js";
import { db } from "./firebase.js";
import { collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

let visits = [];
const changeListeners = [];

// form state
let formData = { name: "", age: "", gender: "남성", activities: [] };

const checkinForm = document.getElementById("checkin-form");
const nameInput = document.getElementById("checkin-name");
const ageInput = document.getElementById("checkin-age");
const genderGroup = document.getElementById("checkin-gender-group");
const activitiesGrid = document.getElementById("activities-grid");

export function getVisits() {
  return visits;
}

export function onVisitsChange(callback) {
  changeListeners.push(callback);
}

function notifyChange() {
  changeListeners.forEach((cb) => cb(visits));
}

function resetFormUI() {
  formData = { name: "", age: "", gender: "남성", activities: [] };
  nameInput.value = "";
  ageInput.value = "";

  genderGroup.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.gender === "남성");
  });

  activitiesGrid.querySelectorAll(".activity-card").forEach((card) => {
    card.classList.remove("active");
  });
}

async function handleCheckIn(e) {
  e.preventDefault();

  formData.name = nameInput.value;
  formData.age = ageInput.value;

  if (
    !formData.name.trim() ||
    !formData.age.trim() ||
    formData.activities.length === 0
  ) {
    notify("정보를 모두 입력해주세요!");
    return;
  }

  const today = new Date();
  const now = new Date();
  const newVisit = {
    ...formData,
    timestamp:
      `${today.getFullYear()}. ${today.getMonth() + 1}. ${today.getDate()}. ` +
      now.toLocaleTimeString(),
    createdAt: now.toISOString(),
  };

  try {
    await addDoc(collection(db, "visits"), newVisit);
    resetFormUI();
    notify("입장이 완료되었습니다!");
  } catch (error) {
    console.error("Check-in error:", error);
    notify("방문 등록 중 오류가 발생했습니다.");
  }
}

function wireForm() {
  checkinForm.addEventListener("submit", handleCheckIn);

  genderGroup.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      formData.gender = btn.dataset.gender;
      genderGroup.querySelectorAll(".toggle-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
    });
  });

  activitiesGrid.querySelectorAll(".activity-card").forEach((card) => {
    card.addEventListener("click", () => {
      const activity = card.dataset.activity;
      if (formData.activities.includes(activity)) {
        formData.activities = formData.activities.filter((a) => a !== activity);
        card.classList.remove("active");
      } else {
        formData.activities.push(activity);
        card.classList.add("active");
      }
    });
  });
}

function subscribeToVisits() {
  const visitsRef = collection(db, "visits");

  onSnapshot(visitsRef, (snapshot) => {
    const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    visits = data;
    notifyChange();
  }, (error) => {
    console.error("Error fetching visits:", error);
  });
}

export function initVisit() {
  wireForm();
  subscribeToVisits();
}