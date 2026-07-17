import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics, isSupported } from 'firebase/analytics';

// Firebase configuration - Hardcoded for immediate deployment
const firebaseConfig = {
  apiKey: "AIzaSyD973O8vExYyGv-P5H96CyepNUaLAECXHQ",
  authDomain: "vfmc-6d447.firebaseapp.com",
  projectId: "vfmc-6d447",
  storageBucket: "vfmc-6d447.firebasestorage.app",
  messagingSenderId: "631390233813",
  appId: "1:631390233813:web:fa057dca3a40f6e2ceee5c",
  measurementId: "G-CQDJB77QEZ"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

// Initialize Analytics (only in browser)
let analytics = null;
if (typeof window !== 'undefined') {
  isSupported().then(supported => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  });
}

export { app, auth, db, analytics };
export default { app, auth, db, analytics };
