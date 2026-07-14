// js/modal.js
// Generic show/hide helpers for the public reservation edit modal.

const editBookingModalEl = document.getElementById("edit-booking-modal");

export function showEditBookingModal() {
  editBookingModalEl.classList.remove("hidden");
}

export function hideEditBookingModal() {
  editBookingModalEl.classList.add("hidden");
}
