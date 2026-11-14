import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig, SUPER_ADMINS, APPCHECK_SITE_KEY } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);

// App Check: só liga se houver chave em firebase-config.js. Se falhar, o app segue
// funcionando (só ficará sem o selo, o que importa quando o bloqueio estiver ativo).
if (APPCHECK_SITE_KEY){
  try{
    if (["localhost", "127.0.0.1"].includes(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    const { initializeAppCheck, ReCaptchaV3Provider } =
      await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-check.js");
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
  }catch(e){
    console.warn("App Check não iniciou:", e);
  }
}

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
