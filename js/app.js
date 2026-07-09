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
    adminModule,
    csvModule,
    authModule,
  ] = await Promise.allSettled([
    import("./visit.js"),
    import("./reservation.js"),
    import("./admin.js"),
    import("./csv.js"),
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

  if (adminModule.status === "fulfilled") {
    adminModule.value.initAdmin();
  } else {
    logModuleError("admin", adminModule.reason);
  }

  if (csvModule.status === "fulfilled") {
    csvModule.value.initCSV();
  } else {
    logModuleError("csv", csvModule.reason);
  }

  if (authModule.status === "fulfilled") {
    authModule.value.initFirebaseAuth();
  } else {
    logModuleError("auth", authModule.reason);
  }
});