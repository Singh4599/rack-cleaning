import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, getDocs, addDoc, updateDoc, deleteDoc, doc,
  query, where, orderBy, writeBatch, serverTimestamp, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyCA3ge4JODmBVnPNU_UMX58X1iGIH62D-I",
  authDomain: "rack-af013.firebaseapp.com",
  projectId: "rack-af013",
  storageBucket: "rack-af013.firebasestorage.app",
  messagingSenderId: "780843931281",
  appId: "1:780843931281:web:98bae08c646521af329130"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const COL = 'rackCleaningRecords';

export async function fetchAllRecords() {
  const q = query(collection(db, COL), orderBy('date', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveRecord(data) {
  const ref = await addDoc(collection(db, COL), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateRecord(id, data) {
  await updateDoc(doc(db, COL, id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteRecord(id) {
  await deleteDoc(doc(db, COL, id));
}

export async function batchSaveRecords(records) {
  // Firestore batch limit = 500 ops
  const CHUNK = 400;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    chunk.forEach(r => {
      const ref = doc(collection(db, COL));
      batch.set(ref, { ...r, createdAt: serverTimestamp() });
    });
    await batch.commit();
  }
}

export function subscribeRecords(callback) {
  const q = query(collection(db, COL), orderBy('date', 'desc'));
  return onSnapshot(q, snap => {
    const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(records);
  });
}

