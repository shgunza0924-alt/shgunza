// js/auth.js
// Firebase authentication (anonymous / custom token) + admin password gate.

import {
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "./firebase.js";

const ADMIN_PASSWORD = "1234";

let currentUser = null;
let isAuth = false; // admin authenticated flag
const readyCallbacks = [];

// ===== Firebase sign-in (anonymous or custom token) =====
export async function initFirebaseAuth() {
  try {
    if (typeof __initial_auth_token !== "undefined" && __initial_auth_token) {
      await signInWithCustomToken(auth, __initial_auth_token);
    } else {
      await signInAnonymously(auth);
    }
  } catch (error) {
    console.error("Auth error:", error);
  }

  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    readyCallbacks.forEach((cb) => cb(user));
  });
}

// Subscribe to be notified once (and whenever) the auth user changes,
// mirroring the original useEffect(() => { ... }, [user]) dependency.
export function onAuthReady(callback) {
  readyCallbacks.push(callback);
  if (currentUser) callback(currentUser);
}

export function getCurrentUser() {
  return currentUser;
}

// ===== Admin session =====
export function isAdminAuthenticated() {
  return isAuth;
}

export function checkAdminPassword(passwordInput) {
  if (passwordInput === ADMIN_PASSWORD) {
    isAuth = true;
    return true;
  }
  return false;
}

export function logoutAdmin() {
  isAuth = false;
}