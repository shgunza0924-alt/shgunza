// ui.js

import { getFixedDateDisplay } from "./utils.js";

const tabCheckinBtn = document.getElementById("tab-checkin-btn");
const tabReservationsBtn = document.getElementById("tab-reservations-btn");

const tabCheckinPanel = document.getElementById("tab-checkin");
const tabReservationsPanel = document.getElementById("tab-reservations");

const resViewNewBtn = document.getElementById("res-view-new-btn");
const resViewMyBookingsBtn = document.getElementById("res-view-mybookings-btn");

const resViewNewPanel = document.getElementById("res-view-new");
const resViewMyBookingsPanel = document.getElementById("res-view-mybookings");

const dateDisplay = document.getElementById("date-display");

const panels = {
    checkin: tabCheckinPanel,
    reservations: tabReservationsPanel
};

const navButtons = {
    checkin: tabCheckinBtn,
    reservations: tabReservationsBtn
};

export function switchTab(tab) {

    Object.keys(panels).forEach(key => {
        panels[key].classList.toggle("hidden", key !== tab);
    });

    Object.keys(navButtons).forEach(key => {
        navButtons[key].classList.toggle("active", key === tab);
    });

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

    resViewNewBtn.onclick = () => switchResView("new");

    resViewMyBookingsBtn.onclick = () =>
        switchResView("my-bookings");

    switchTab("checkin");

    switchResView("new");
}
