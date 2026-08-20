// js/app.js
// Application entry point. UI should keep working even when Firebase is absent.

import { initUI } from "./ui.js";

function logModuleError(name, error) {
  console.error(`${name} module failed to load:`, error);
}

document.addEventListener("DOMContentLoaded", async () => {
  initUI();

  // Start authentication before feature modules are allowed to issue any
  // Firestore reads. Feature modules still render their local form UI at once.
  const authModule = await import("./auth.js").catch((error) => {
    logModuleError("auth", error);
    return null;
  });
  if (authModule) {
    authModule.initFirebaseAuth().catch((error) => logModuleError("auth", error));
  }

  const [visitModule, reservationModule] = await Promise.allSettled([
    import("./visit.js"),
    import("./reservation.js"),
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

});
