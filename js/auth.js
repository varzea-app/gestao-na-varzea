import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig, SUPER_ADMINS } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const provider = new GoogleAuthProvider();

export function emailNormalizado(email){
  return String(email || "").trim().toLowerCase();
}

export function ehSuperAdmin(email){
  return SUPER_ADMINS.map(emailNormalizado).includes(emailNormalizado(email));
}

export function loginWithGoogle(){
  return signInWithPopup(auth, provider);
}

export function logout(){
  return signOut(auth);
}

export function watchAuth(callback){
  onAuthStateChanged(auth, callback);
}
