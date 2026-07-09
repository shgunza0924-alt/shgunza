// js/modal.js
// Generic show/hide helpers for the password modal and edit-booking modal.

const passwordModalEl = document.getElementById("password-modal");
const passwordInputEl = document.getElementById("password-input");
const editBookingModalEl = document.getElementById("edit-booking-modal");

export function showPasswordModal() {
  passwordInputEl.value = "";
  passwordModalEl.classList.remove("hidden");
  passwordInputEl.focus();
}

export function hidePasswordModal() {
  passwordModalEl.classList.add("hidden");
  passwordInputEl.value = "";
}

export function showEditBookingModal() {
  editBookingModalEl.classList.remove("hidden");
}

export function hideEditBookingModal() {
  editBookingModalEl.classList.add("hidden");
}