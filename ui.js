// js/ui.js
// Tab navigation (checkin / reservations / admin) and reservation sub-view
// (new / my-bookings) switching. UI stays available even without Firebase.

import { getFixedDateDisplay } from "./utils.js";
import { showPasswordModal, hidePasswordModal } from "./modal.js";
import { notify } from "./notification.js";

const tabCheckinBtn = document.getElementById("tab-checkin-btn");
const tabReservationsBtn = document.getElementById("tab-reservations-btn");
const adminToggleBtn = document.getElementById("admin-toggle-btn");
const adminLogoutBtn = document.getElementById("admin-logout-btn");

const tabCheckinPanel = document.getElementById("tab-checkin");
const tabReservationsPanel = document.getElementById("tab-reservations");
const tabAdminPanel = document.getElementById("tab-admin");

const passwordInputEl = document.getElementById("password-input");
const passwordConfirmBtn = document.getElementById("password-confirm-btn");
const passwordCancelBtn = document.getElementById("password-cancel-btn");

const resViewNewBtn = document.getElementById("res-view-new-btn");
const resViewMyBookingsBtn = document.getElementById(
  "res-view-mybookings-btn"
);
const resViewNewPanel = document.getElementById("res-view-new");
const resViewMyBookingsPanel = document.getElementById("res-view-mybookings");

const dateDisplayEl = document.getElementById("date-display");

const panelsByTab = {
  checkin: tabCheckinPanel,
  reservations: tabReservationsPanel,
  admin: tabAdminPanel,
};

const navButtonsByTab = {
  checkin: tabCheckinBtn,
  reservations: tabReservationsBtn,
};

let activeTab = "checkin";
let onAdminEnter = null; // callback set by admin.js to refresh stats on entry
let adminAuthenticated = false;

function isAdminAuthenticatedLocal() {
  return adminAuthenticated;
}

function checkAdminPasswordLocal(passwordInput) {
  if (passwordInput === "1234") {
    adminAuthenticated = true;
    return true;
  }
  return false;
}

function logoutAdminLocal() {
  adminAuthenticated = false;
}

export function setOnAdminEnter(callback) {
  onAdminEnter = callback;
}

export function switchTab(tabName) {
  activeTab = tabName;

  Object.entries(panelsByTab).forEach(([key, panel]) => {
    if (panel) {
      panel.classList.toggle("hidden", key !== tabName);
    }
  });

  Object.entries(navButtonsByTab).forEach(([key, btn]) => {
    if (btn) {
      btn.classList.toggle("active", key === tabName);
    }
  });

  if (adminToggleBtn) {
    adminToggleBtn.classList.toggle("active", tabName === "admin");
  }

  if (tabName === "admin" && typeof onAdminEnter === "function") {
    onAdminEnter();
  }
}

export function switchResView(view) {
  if (resViewNewPanel) {
    resViewNewPanel.classList.toggle("hidden", view !== "new");
  }
  if (resViewMyBookingsPanel) {
    resViewMyBookingsPanel.classList.toggle("hidden", view !== "my-bookings");
  }
  if (resViewNewBtn) {
    resViewNewBtn.classList.toggle("active", view === "new");
  }
  if (resViewMyBookingsBtn) {
    resViewMyBookingsBtn.classList.toggle("active", view === "my-bookings");
  }
}

function handleAdminAuth() {
  const value = passwordInputEl.value;
  if (checkAdminPasswordLocal(value)) {
    hidePasswordModal();
    switchTab("admin");
  } else {
    notify("비밀번호 오류");
  }
  passwordInputEl.value = "";
}

export function initUI() {
  // Header date display
  const today = new Date();
  if (dateDisplayEl) {
    dateDisplayEl.textContent = getFixedDateDisplay(today);
  }

  // Main nav tabs
  if (tabCheckinBtn) {
    tabCheckinBtn.addEventListener("click", () => switchTab("checkin"));
  }
  if (tabReservationsBtn) {
    tabReservationsBtn.addEventListener("click", () => {
      switchTab("reservations");
      switchResView("new");
    });
  }

  // Admin gate
  if (adminToggleBtn) {
    adminToggleBtn.addEventListener("click", () => {
      if (isAdminAuthenticatedLocal()) {
        switchTab("admin");
      } else {
        showPasswordModal();
      }
    });
  }

  if (adminLogoutBtn) {
    adminLogoutBtn.addEventListener("click", () => {
      logoutAdminLocal();
      switchTab("checkin");
    });
  }

  if (passwordConfirmBtn) {
    passwordConfirmBtn.addEventListener("click", handleAdminAuth);
  }
  if (passwordCancelBtn) {
    passwordCancelBtn.addEventListener("click", hidePasswordModal);
  }
  if (passwordInputEl) {
    passwordInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleAdminAuth();
    });
  }

  // Reservation sub-view switch
  if (resViewNewBtn) {
    resViewNewBtn.addEventListener("click", () => switchResView("new"));
  }
  if (resViewMyBookingsBtn) {
    resViewMyBookingsBtn.addEventListener("click", () =>
      switchResView("my-bookings")
    );
  }

  switchTab("checkin");
  switchResView("new");
}
