// ui.js

import { getFixedDateDisplay } from "./utils.js";
import { showPasswordModal, hidePasswordModal } from "./modal.js";
import { notify } from "./notification.js";

import {
    loginAdmin,
    logoutAdmin,
    isAdminAuthenticated
} from "./auth.js";

const tabCheckinBtn = document.getElementById("tab-checkin-btn");
const tabReservationsBtn = document.getElementById("tab-reservations-btn");
const adminToggleBtn = document.getElementById("admin-toggle-btn");
const adminLogoutBtn = document.getElementById("admin-logout-btn");

const tabCheckinPanel = document.getElementById("tab-checkin");
const tabReservationsPanel = document.getElementById("tab-reservations");
const tabAdminPanel = document.getElementById("tab-admin");

const passwordInput = document.getElementById("password-input");
const passwordConfirmBtn = document.getElementById("password-confirm-btn");
const passwordCancelBtn = document.getElementById("password-cancel-btn");

const resViewNewBtn = document.getElementById("res-view-new-btn");
const resViewMyBookingsBtn = document.getElementById("res-view-mybookings-btn");

const resViewNewPanel = document.getElementById("res-view-new");
const resViewMyBookingsPanel = document.getElementById("res-view-mybookings");

const dateDisplay = document.getElementById("date-display");

const panels = {
    checkin: tabCheckinPanel,
    reservations: tabReservationsPanel,
    admin: tabAdminPanel
};

const navButtons = {
    checkin: tabCheckinBtn,
    reservations: tabReservationsBtn
};

let onAdminEnter = null;

export function setOnAdminEnter(callback) {
    onAdminEnter = callback;
}

export function switchTab(tab) {

    Object.keys(panels).forEach(key => {
        panels[key].classList.toggle("hidden", key !== tab);
    });

    Object.keys(navButtons).forEach(key => {
        navButtons[key].classList.toggle("active", key === tab);
    });

    adminToggleBtn.classList.toggle("active", tab === "admin");

    if (tab === "admin" && onAdminEnter) {
        onAdminEnter();
    }
}

export function switchResView(view) {

    resViewNewPanel.classList.toggle(
        "hidden",
        view !== "new"
    );

    resViewMyBookingsPanel.classList.toggle(
        "hidden",
        view !== "my-bookings"
    );

    resViewNewBtn.classList.toggle(
        "active",
        view === "new"
    );

    resViewMyBookingsBtn.classList.toggle(
        "active",
        view === "my-bookings"
    );
}

async function adminLogin() {

    const password = passwordInput.value.trim();

    if (!password) {

        notify("비밀번호를 입력해주세요.");

        return;
    }

    passwordConfirmBtn.disabled = true;

    const result = await loginAdmin(password);

    passwordConfirmBtn.disabled = false;

    if (!result.success) {

        notify("관리자 로그인 실패");

        return;
    }

    hidePasswordModal();

    passwordInput.value = "";

    switchTab("admin");
}

async function adminLogout() {

    await logoutAdmin();

    switchTab("checkin");

    notify("로그아웃되었습니다.");
}

export function initUI() {

    dateDisplay.textContent =
        getFixedDateDisplay(new Date());

    tabCheckinBtn.onclick = () => {

        switchTab("checkin");

    };

    tabReservationsBtn.onclick = () => {

        switchTab("reservations");

        switchResView("new");

    };

    adminToggleBtn.onclick = () => {

        if (isAdminAuthenticated()) {

            switchTab("admin");

            return;
        }

        showPasswordModal();
    };

    adminLogoutBtn.onclick = adminLogout;

    passwordConfirmBtn.onclick = adminLogin;

    passwordCancelBtn.onclick = hidePasswordModal;

    passwordInput.addEventListener("keydown", e => {

        if (e.key === "Enter") {

            adminLogin();

        }

    });

    resViewNewBtn.onclick = () => switchResView("new");

    resViewMyBookingsBtn.onclick = () =>
        switchResView("my-bookings");

    switchTab("checkin");

    switchResView("new");
}
