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

// === RESPALDO EN GOOGLE SHEETS ===
// Esta función SOLO debe llamarse DESPUÉS de confirmar que el dato ya quedó
// guardado (o borrado) correctamente en Firestore. Se ejecuta "en segundo
// plano" (no se espera su resultado) para no hacer esperar al estudiante o
// al docente; si falla, solo queda registrado en la consola, pero el dato
// real ya está a salvo en Firestore de todas formas.
function respaldarEnSheets(body) {
  fetch(SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify(body)
  }).catch(e => console.error("Error en respaldo Sheets:", e));
}

// === FUNCIONES DE ESCRITURA (BASE DE DATOS PRIMERO, LUEGO HOJA) ===
async function storeSet(key, value) {
  try {
    // 1. PRIMERO guardamos en Firestore, la base de datos real de la app.
    //    Si esta línea falla (por ejemplo, por reglas de seguridad o sin
    //    internet), el "catch" de abajo se activa y NUNCA llegamos a
    //    intentar mandar nada a la hoja de cálculo.
    await coll.doc(key).set({ data: value });
  } catch (e) {
    console.error("Error en Firebase:", e);
    return false;
  }

  // 2. SOLO si el paso anterior tuvo éxito, mandamos una copia a Sheets.
  respaldarEnSheets({ action: 'set', key: key, value: value });

  return true;
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
    // 1. PRIMERO borramos de Firestore.
    await coll.doc(key).delete();
  } catch (e) {
    console.error("Error borrando:", e);
    return false;
  }

  // 2. SOLO si el paso anterior tuvo éxito, replicamos el borrado en Sheets.
  respaldarEnSheets({ action: 'delete', key: key });

  return true;
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

    // Respaldo: SOLO después de que Firestore ya borró todo con éxito,
    // replicamos cada borrado en Sheets (mejor esfuerzo).
    docs.forEach(doc => {
      respaldarEnSheets({ action: 'delete', key: doc.id });
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
