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

// === NUEVO: leer TODOS los documentos cuyo identificador empieza con "prefix" ===
// Esto evita tener que hacer una lectura por cada alumno/registro (más rápido
// y consume menos "lecturas" de la cuota gratuita de Firestore).
// Devuelve un arreglo de objetos: { key: "alumno:Materia:12345", data: {...} }
async function storeGetByPrefix(prefix) {
  try {
    const snapshot = await coll
      .where(firebase.firestore.FieldPath.documentId(), '>=', prefix)
      .where(firebase.firestore.FieldPath.documentId(), '<=', prefix + '\uf8ff')
      .get();

    const result = [];
    snapshot.forEach(doc => result.push({ key: doc.id, data: doc.data().data }));
    return result;
  } catch (e) {
    console.error("Error leyendo por prefijo:", e);
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

// === NUEVO: borrar TODOS los documentos cuyo identificador empieza con "prefix" ===
// Se usa, por ejemplo, para eliminar de verdad todos los alumnos y toda la
// asistencia de una materia cuando el docente la elimina.
async function storeDeleteByPrefix(prefix) {
  try {
    const snapshot = await coll
      .where(firebase.firestore.FieldPath.documentId(), '>=', prefix)
      .where(firebase.firestore.FieldPath.documentId(), '<=', prefix + '\uf8ff')
      .get();

    const docs = snapshot.docs;

    // Firestore solo permite borrar hasta 400-500 documentos por "lote",
    // así que si hay más, los dividimos en grupos.
    const chunkSize = 400;
    for (let i = 0; i < docs.length; i += chunkSize) {
      const batch = db.batch();
      docs.slice(i, i + chunkSize).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }

    // Respaldo: intentamos borrar también en Sheets (mejor esfuerzo)
    docs.forEach(doc => {
      fetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', key: doc.id })
      }).catch(e => console.error("Error en respaldo Sheets:", e));
    });

    return true;
  } catch (e) {
    console.error("Error borrando por prefijo:", e);
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
