// 1. CONFIGURACIÓN DE FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyALHf5yw1VpMuzsTNchj1IAc8vl7qkySNE",
  authDomain: "sistema-de-asistencia-6db6f.firebaseapp.com",
  projectId: "sistema-de-asistencia-6db6f",
  storageBucket: "sistema-de-asistencia-6db6f.firebasestorage.app",
  messagingSenderId: "286169329680",
  appId: "1:286169329680:web:9bfd183e3277febe109a95"
};

// Inicializamos Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const coll = db.collection('asistencia_db');

// 2. URL DE GOOGLE APPS SCRIPT (Respaldo en Excel)
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwE3nIjwHuVxOktZYJjm81jcZZRjYDIxKzWD-A6qjbX-sou9unvZ7FGjafFnf8T_rGYWw/exec";

// === FUNCIONES DE ESCRITURA (DOBLE ENVÍO) ===
async function storeSet(key, value) {
  try {
    // 1. Guardado ultra rápido en Firebase (Milisegundos)
    await coll.doc(key).set({ data: value });

    // 2. Envío silencioso a Google Sheets (No hace esperar a la página web)
    fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'set', key: key, value: value })
    }).catch(e => console.error("Error en respaldo Sheets:", e));

    return true;
  } catch (e) {
    console.error("Error en Firebase:", e);
    return false;
  }
}

async function storeGet(key) {
  try {
    const doc = await coll.doc(key).get();
    if (doc.exists) {
      return doc.data().data;
    }
    return null;
  } catch (e) {
    console.error("Error leyendo de Firebase:", e);
    return null;
  }
}

async function storeListKeys(prefix) {
  try {
    // Firebase requiere este rango para buscar por prefijo
    const snapshot = await coll
      .where(firebase.firestore.FieldPath.documentId(), '>=', prefix)
      .where(firebase.firestore.FieldPath.documentId(), '<=', prefix + '\uf8ff')
      .get();
    
    let keys = [];
    snapshot.forEach(doc => keys.push(doc.id));
    return keys;
  } catch (e) {
    console.error("Error listando llaves:", e);
    return [];
  }
}

async function storeDelete(key) {
  try {
    // 1. Borrado instantáneo en Firebase
    await coll.doc(key).delete();

    // 2. Borrado silencioso en Google Sheets
    fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', key: key })
    }).catch(e => console.error("Error borrando en Sheets:", e));

    return true;
  } catch (e) {
    console.error("Error borrando:", e);
    return false;
  }
}

// === FUNCIÓN DE SEGURIDAD (MANTENIDA EN GOOGLE SHEETS) ===
async function verifyAdminPin(pinToTest) {
  try {
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'verifyPin', value: pinToTest })
    });
    const result = await response.json();
    return result.success; 
  } catch (e) {
    console.error("Error validando PIN:", e);
    return false;
  }
}
