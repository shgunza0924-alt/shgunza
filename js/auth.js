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
let initialAuthSettled = false;
let signingInPromise = null;
let authInitializationPromise = null;

const readyCallbacks = [];

function publishAuthenticatedUser(user) {
  const changedUser = !authReady || !currentUser || currentUser.uid !== user.uid;
  currentUser = user;
  authReady = true;
  if (changedUser) readyCallbacks.forEach((callback) => callback(user));
}

function ensureAnonymousUser() {
  if (authReady && currentUser) return Promise.resolve(currentUser);
  if (signingInPromise) return signingInPromise;

  signingInPromise = (async () => {
    try {
      const credential = await signInAnonymously(auth);
      publishAuthenticatedUser(credential.user);
      return credential.user;
    } catch (error) {
      console.error("Anonymous authentication failed:", error);
      return null;
    } finally {
      signingInPromise = null;
    }
  })();
  return signingInPromise;
}

export function initFirebaseAuth() {
  if (authStarted) return authInitializationPromise;
  authStarted = true;

  authInitializationPromise = (async () => {
    // Explicitly keep the anonymous session on refresh. This is the Firebase
    // default in browsers, but setting it removes environment-dependent resets.
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (error) {
      console.warn("Could not set local authentication persistence:", error);
    }

    return new Promise((resolve) => {
      let resolved = false;
      const settleInitialState = (user) => {
        if (resolved) return;
        resolved = true;
        initialAuthSettled = true;
        resolve(user);
      };

      onAuthStateChanged(auth, async (user) => {
        if (user) {
          publishAuthenticatedUser(user);
          settleInitialState(user);
          return;
        }

        // Clear the previous identity immediately. Reads and writes that arrive
        // during a sign-out transition must wait for the replacement session.
        currentUser = null;
        authReady = false;
        const anonymousUser = await ensureAnonymousUser();
        settleInitialState(anonymousUser);
      }, (error) => {
        currentUser = null;
        authReady = false;
        console.error("Authentication state listener failed:", error);
        settleInitialState(null);
      });
    });
  })();

  return authInitializationPromise;
}

export function onAuthReady(callback) {
  readyCallbacks.push(callback);

  if (authReady && currentUser) {
    callback(currentUser);
  }
}

export function getCurrentUser() {
  return currentUser;
}

// Read and write handlers use this rather than assuming Firebase restored a
// session. A failed initial anonymous sign-in resolves the current operation,
// while the next user action can start a fresh attempt on the same page.
export async function waitForAuth() {
  if (authReady && currentUser) return currentUser;

  const wasWaitingForInitialState = !initialAuthSettled;
  const initialUser = await initFirebaseAuth();
  if (authReady && currentUser) return currentUser;
  if (wasWaitingForInitialState) return initialUser || null;

  return ensureAnonymousUser();
}
