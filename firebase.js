// firebase.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB782bETDkgEcCIuAiTmWMr_OlTwVK9gXk",
  authDomain: "shgunza.firebaseapp.com",
  projectId: "shgunza",
  storageBucket: "shgunza.firebasestorage.app",
  messagingSenderId: "293638725184",
  appId: "1:293638725184:web:f4fa4e4b7d7459166209a5",
  measurementId: "G-BHN2203H16",
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const db = getFirestore(app);

// Enable offline persistence so data continues to be available during brief network interruptions.
enableIndexedDbPersistence(db).catch((err) => {
  console.warn("Firestore offline persistence could not be enabled:", err.code);
});

export default app;