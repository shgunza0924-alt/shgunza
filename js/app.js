// js/app.js
// Application entry point. UI should keep working even when Firebase is absent.

import { initUI } from "./ui.js";

function logModuleError(name, error) {
  console.error(`${name} module failed to load:`, error);
}

document.addEventListener("DOMContentLoaded", async () => {
  initUI();

  const [
    visitModule,
    reservationModule,
    authModule,
  ] = await Promise.allSettled([
    import("./visit.js"),
    import("./reservation.js"),
    import("./auth.js"),
  ]);

  if (visitModule.status === "fulfilled") {
    visitModule.value.initVisit();
  } else {
    logModuleError("visit", visitModule.reason);
  }

  if (reservationModule.status === "fulfilled") {
    reservationModule.value.initReservation();
  } else {
    logModuleError("reservation", reservationModule.reason);
  }

  if (authModule.status === "fulfilled") {
    authModule.value.initFirebaseAuth();
  } else {
    logModuleError("auth", authModule.reason);
  }
});
