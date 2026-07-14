// auth.js

import {
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import { auth } from "./firebase.js";

let currentUser = null;
let authReady = false;

const readyCallbacks = [];

export function initFirebaseAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      authReady = true;
      
      readyCallbacks.forEach((cb) => cb(user));
    } else {
      // Auto-authenticate unknown public users silently so they have database write access
      try {
        await signInAnonymously(auth);
      } catch (error) {
        console.error("Anonymous authentication failed:", error);
      }
    }
  });
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
