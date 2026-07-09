// auth.js

import {
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import { auth } from "./firebase.js";

/*
 * 관리자 이메일
 * UI는 변경하지 않고
 * 비밀번호만 입력받는다.
 */
const ADMIN_EMAIL = "shgunza0924@gmail.com";

let currentUser = null;
let authReady = false;
let isAdmin = false;

const readyCallbacks = [];
const authCallbacks = [];

export function initFirebaseAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      authReady = true;
      
      // Identify the admin strictly by email to prevent anonymous users from gaining admin UI access
      isAdmin = user.email === ADMIN_EMAIL;

      readyCallbacks.forEach((cb) => cb(user));
      authCallbacks.forEach((cb) => cb(user));
    } else {
      isAdmin = false;
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

export function onAdminStateChanged(callback) {
  authCallbacks.push(callback);

  if (authReady) {
    callback(currentUser);
  }
}

export function getCurrentUser() {
  return currentUser;
}

export function isAdminAuthenticated() {
  return isAdmin;
}

export async function loginAdmin(password) {
  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      ADMIN_EMAIL,
      password
    );

    currentUser = credential.user;
    isAdmin = true;

    return {
      success: true,
      user: credential.user,
    };
  } catch (error) {
    console.error(error);

    return {
      success: false,
      code: error.code,
      message: error.message,
    };
  }
}

export async function logoutAdmin() {
  try {
    await signOut(auth);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}