// js/notification.js
// Handles the toast notification shown at the top of the screen.

let hideTimer = null;

const notificationEl = document.getElementById("notification");
const notificationTextEl = document.getElementById("notification-text");

export function notify(message) {
  notificationTextEl.textContent = message;
  notificationEl.classList.remove("hidden");

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    notificationEl.classList.add("hidden");
  }, 3000);
}