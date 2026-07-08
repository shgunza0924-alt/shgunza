// js/visit.js
// Handles the 방문 등록 (check-in) form.
// Works in local preview mode when Firebase is unavailable.

import { notify } from "./notification.js";

let visits = [];
const changeListeners = [];

let firebaseBundle = null;
let firestoreApi = null;
let currentUser = { uid: "local-preview-user" };

// form state (mirrors the original formData useState)
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

async function loadFirebaseSupport() {
  if (firebaseBundle || firestoreApi) {
    return;
  }

  try {
    const [firebaseModule, authModule, firestoreModule] = await Promise.all([
      import("./firebase.js"),
      import("./auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
    ]);

    firebaseBundle = firebaseModule;
    firestoreApi = firestoreModule;

    const user = authModule.getCurrentUser?.();
    if (user) {
      currentUser = user;
    }

    if (authModule.onAuthReady) {
      authModule.onAuthReady((nextUser) => {
        if (nextUser) {
          currentUser = nextUser;
        }
      });
    }
  } catch (error) {
    console.warn("visit.js running without Firebase:", error);
  }
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

function addLocalVisit(newVisit) {
  visits = [{ id: `local-visit-${Date.now()}`, ...newVisit }, ...visits];
  notifyChange();
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

  if (
    firebaseBundle &&
    firestoreApi &&
    currentUser &&
    firebaseBundle.db &&
    firebaseBundle.appId
  ) {
    try {
      const visitsRef = firestoreApi.collection(
        firebaseBundle.db,
        "artifacts",
        firebaseBundle.appId,
        "public",
        "data",
        "visits"
      );
      await firestoreApi.addDoc(visitsRef, newVisit);
      resetFormUI();
      notify("입장이 완료되었습니다!");
      return;
    } catch (error) {
      console.error("Check-in error:", error);
    }
  }

  addLocalVisit(newVisit);
  resetFormUI();
  notify("입장이 완료되었습니다!");
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
  if (!firebaseBundle || !firestoreApi) {
    return;
  }

  const visitsRef = firestoreApi.collection(
    firebaseBundle.db,
    "artifacts",
    firebaseBundle.appId,
    "public",
    "data",
    "visits"
  );

  firestoreApi.onSnapshot(
    visitsRef,
    (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      visits = data;
      notifyChange();
    },
    (error) => console.error("Error fetching visits:", error)
  );
}

export async function initVisit() {
  wireForm();
  await loadFirebaseSupport();
  subscribeToVisits();
}
