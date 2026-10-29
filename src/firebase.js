import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Web-Konfiguration ist oeffentlich; Zugriff schuetzen Auth und Firestore-Regeln.
const firebaseConfig = {
  apiKey: 'AIzaSyBEveMogSlW-T0xUowgX-P111Pjh2iuJ9s',
  authDomain: 'content-app-e4022.firebaseapp.com',
  projectId: 'content-app-e4022',
  storageBucket: 'content-app-e4022.firebasestorage.app',
  messagingSenderId: '372707937763',
  appId: '1:372707937763:web:2cb1ab35fac8fe33e124d6',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
