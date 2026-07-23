// auth.js

import {
  browserLocalPersistence,
  signInAnonymously,
  onAuthStateChanged,
  setPersistence,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import { auth } from "./firebase.js";

let currentUser = null;
let authReady = false;
let authStarted = false;
let signingIn = false;

const readyCallbacks = [];
let resolveAuthReady;
const authReadyPromise = new Promise((resolve) => {
  resolveAuthReady = resolve;
});

export async function initFirebaseAuth() {
  if (authStarted) return authReadyPromise;
  authStarted = true;

  // Explicitly keep the anonymous session on refresh. This is the Firebase
  // default in browsers, but setting it removes environment-dependent resets.
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (error) {
    console.warn("Could not set local authentication persistence:", error);
  }

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      authReady = true;
      readyCallbacks.forEach((cb) => cb(user));
      resolveAuthReady(user);
    } else {
      // Auto-authenticate public users once so database writes wait for a user.
      if (signingIn) return;
      signingIn = true;
      try {
        await signInAnonymously(auth);
      } catch (error) {
        console.error("Anonymous authentication failed:", error);
        // Do not leave form submissions waiting forever when Firebase is unavailable.
        resolveAuthReady(null);
      } finally {
        signingIn = false;
      }
    }
  });

  return authReadyPromise;
}

export function onAuthReady(callback) {
  readyCallbacks.push(callback);

  if (authReady) {
    callback(currentUser);
  }
}

export function getCurrentUser() {
  return currentUser;
}

// Write handlers use this rather than assuming Firebase has restored a session.
export function waitForAuth() {
  return authReady ? Promise.resolve(currentUser) : authReadyPromise;
}
