import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAC3cBJaR5Ibk2SrY20Ke3VmklizQuShIA",
  authDomain: "sodi-8b6d2.firebaseapp.com",
  projectId: "sodi-8b6d2",
  storageBucket: "sodi-8b6d2.firebasestorage.app",
  messagingSenderId: "859321907547",
  appId: "1:859321907547:web:35738fda6af030a756427e",
  measurementId: "G-73RB5746TH"
};
const app = initializeApp(firebaseConfig);

// Exportaciones maestras
export const db = getFirestore(app);
export const auth = getAuth(app);