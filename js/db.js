// PEGA AQUÍ LA URL QUE COPIASTE DE GOOGLE APPS SCRIPT
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwE3nIjwHuVxOktZYJjm81jcZZRjYDIxKzWD-A6qjbX-sou9unvZ7FGjafFnf8T_rGYWw/exec";

async function storeSet(key, value) {
  try {
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'set', key: key, value: value })
    });
    const result = await response.json();
    return result.success;
  } catch (e) {
    console.error("Error guardando:", e);
    return false;
  }
}

async function storeGet(key) {
  try {
    const t = new Date().getTime();
    const response = await fetch(`${SCRIPT_URL}?action=get&key=${encodeURIComponent(key)}&t=${t}`);
    const result = await response.json();
    return result;
  } catch (e) {
    console.error("Error leyendo:", e);
    return null;
  }
}

async function storeListKeys(prefix) {
  try {
    const t = new Date().getTime();
    const response = await fetch(`${SCRIPT_URL}?action=list&prefix=${encodeURIComponent(prefix)}&t=${t}`);
    const result = await response.json();
    return result;
  } catch (e) {
    console.error("Error listando:", e);
    return [];
  }
}

async function storeDelete(key) {
  try {
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', key: key })
    });
    const result = await response.json();
    return result.success;
  } catch (e) {
    console.error("Error borrando:", e);
    return false;
  }
}
