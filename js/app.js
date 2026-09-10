let currentStudent = null;

// Estado de los "escuchas" en tiempo real del panel docente.
// Firestore nos avisa automáticamente cuando algo cambia, sin recargar.
let listenerMateriaActual = null;
let unsubAlumnosListener = null;
let unsubAsistenciaListener = null;

function todayStr(){
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function nowTime(){
  const d = new Date();
  return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
}

// ---------------------------------------------------------
// NOTA: Las funciones storeGet, storeSet, storeGetByPrefix,
// storeListKeys, storeDelete, storeDeleteByPrefix y
// verifyAdminPin viven en js/db.js
//
// ESQUEMA DE LLAVES (actualizado para evitar pérdida de datos):
//   materias                                -> lista de nombres de materias
//   alumno:{materia}:{ciis}                 -> {nombre, registrado}
//   asistencia:{materia}:{fecha}:{ciis}     -> {nombre, hora}
//   ubicacion:{materia}                     -> {lat, lng, radio}
//
// Antes, "alumnos" y "asistencia" de un día se guardaban como UNA sola
// lista compartida. Eso provocaba que, si dos alumnos marcaban asistencia
// casi al mismo tiempo, uno de los dos "desaparecía" (se sobreescribían).
// Ahora cada alumno tiene su propio documento, así nunca se pisan entre sí.
// ---------------------------------------------------------

function getPosition(){
  return new Promise((resolve, reject)=>{
    if(!navigator.geolocation) return reject(new Error('Este navegador no soporta ubicación.'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, timeout: 12000, maximumAge: 0
    });
  });
}

// Traduce los errores de geolocalización del navegador a un mensaje claro.
// Códigos estándar: 1 = permiso denegado, 2 = posición no disponible, 3 = tiempo agotado.
function mensajeErrorUbicacion(e){
  if(e && e.code === 1){
    return 'Bloqueaste el permiso de ubicación para este sitio. Actívalo desde el ícono de información/candado junto a la dirección del navegador (o en Ajustes del celular → Aplicaciones → tu navegador → Permisos → Ubicación) y vuelve a intentar.';
  }
  if(e && e.code === 2){
    return 'No se pudo determinar tu ubicación. Verifica que el GPS/ubicación esté activado en tu dispositivo.';
  }
  if(e && e.code === 3){
    return 'Tardamos demasiado en obtener tu ubicación. Sal a un espacio abierto (lejos de paredes gruesas o techos) e intenta de nuevo.';
  }
  return 'No pudimos obtener tu ubicación.';
}

function distanciaMetros(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function setClassroomLocation(){
  const materia = document.getElementById('adminMatSelect').value;
  const status = document.getElementById('locStatus');
  if(!materia){ alert('Selecciona una materia primero.'); return; }
  const radio = parseInt(document.getElementById('locRadio').value, 10) || 60;
  status.textContent = 'Obteniendo tu ubicación actual...';
  try{
    const pos = await getPosition();
    const data = {lat: pos.coords.latitude, lng: pos.coords.longitude, radio};
    await storeSet('ubicacion:'+materia, data);
    status.textContent = 'Configurada ✓ (radio: '+radio+' m).';
    document.getElementById('locRemoveLink').classList.remove('hidden');
  }catch(e){
    status.textContent = mensajeErrorUbicacion(e);
  }
}

async function removeClassroomLocation(){
  const materia = document.getElementById('adminMatSelect').value;
  if(!materia) return;
  await storeDelete('ubicacion:'+materia);
  document.getElementById('locStatus').textContent = 'No configurada.';
  document.getElementById('locRemoveLink').classList.add('hidden');
}

async function loadLocationStatus(materia){
  const status = document.getElementById('locStatus');
  const ubic = await storeGet('ubicacion:'+materia);
  if(ubic){
    status.textContent = 'Configurada ✓ (radio: '+ubic.radio+' m).';
    document.getElementById('locRadio').value = ubic.radio;
    document.getElementById('locRemoveLink').classList.remove('hidden');
  }else{
    status.textContent = 'No configurada.';
    document.getElementById('locRemoveLink').classList.add('hidden');
  }
}

async function updateRadius(){
  const materia = document.getElementById('adminMatSelect').value;
  if(!materia) return;

  let radio = parseInt(document.getElementById('locRadio').value, 10);

  if(radio < 15) {
    alert("El radio mínimo recomendado es de 15 metros. Los sensores GPS de los celulares tienen un margen de error natural; si pones menos, el sistema rechazará a los estudiantes aunque estén dentro del aula.");
    radio = 15;
    document.getElementById('locRadio').value = 15;
  }

  const ubicacion = await storeGet('ubicacion:'+materia);
  if(ubicacion){
    ubicacion.radio = radio;
    await storeSet('ubicacion:'+materia, ubicacion);
    document.getElementById('locStatus').textContent = `Configurada ✓ (radio: ${radio} m).`;
  }
}

function switchTab(tab){
  document.getElementById('tabEst').classList.toggle('active', tab==='estudiante');
  document.getElementById('tabDoc').classList.toggle('active', tab==='docente');
  document.getElementById('viewEstudiante').classList.toggle('hidden', tab!=='estudiante');
  document.getElementById('viewDocente').classList.toggle('hidden', tab!=='docente');
  if(tab==='estudiante') loadMateriasIntoSelect();
  if(tab==='docente') loadMateriasIntoAdminSelect();
}

async function getMaterias(){
  return (await storeGet('materias')) || [];
}

async function loadMateriasIntoSelect(){
  const materias = await getMaterias();
  const sel = document.getElementById('matSelect');
  sel.innerHTML = '';
  document.getElementById('noMateriasMsg').classList.toggle('hidden', materias.length>0);
  materias.forEach(m=>{
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    sel.appendChild(opt);
  });
}

async function loadMateriasIntoAdminSelect(){
  const materias = await getMaterias();
  const sel = document.getElementById('adminMatSelect');
  sel.innerHTML = '';
  materias.forEach(m=>{
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    sel.appendChild(opt);
  });
  renderMateriaTags(materias);
  if(!document.getElementById('adminDate').value) document.getElementById('adminDate').value = todayStr();
  if(materias.length>0) loadAdminData();
}

function renderMateriaTags(materias){
  const box = document.getElementById('materiaTags');
  box.innerHTML = materias.length ? '' : '<span class="sub">Aún no agregaste materias.</span>';
  materias.forEach(m=>{
    const t = document.createElement('span');
    t.className = 'tag';
    t.textContent = m;
    box.appendChild(t);
  });
}

async function addMateria(){
  const input = document.getElementById('newMateria');
  const name = input.value.trim();
  if(!name) return;
  // El símbolo ":" se usa internamente para separar materia/alumno/fecha,
  // así que no se permite en el nombre para no romper el sistema.
  if(name.includes(':')){
    alert('El nombre de la materia no puede contener el símbolo ":".');
    return;
  }
  try{
    const materias = await getMaterias();
    if(materias.includes(name)){ input.value=''; return; }
    materias.push(name);
    await storeSet('materias', materias);
    input.value = '';
    await loadMateriasIntoAdminSelect();
  }catch(e){
    alert('Error al guardar.');
  }
}

function backToIdentify(){
  document.getElementById('stepIdentify').classList.remove('hidden');
  document.getElementById('stepRegister').classList.add('hidden');
  document.getElementById('stepMark').classList.add('hidden');
  document.getElementById('identifyMsg').innerHTML = '';
  document.getElementById('ciisInput').value = '';
}

async function identifyStudent(){
  const materia = document.getElementById('matSelect').value;
  const ciis = document.getElementById('ciisInput').value.trim();
  const msg = document.getElementById('identifyMsg');
  msg.innerHTML = '';
  if(!materia){ msg.innerHTML = '<div class="msg warn">Selecciona una materia.</div>'; return; }
  if(!ciis){ msg.innerHTML = '<div class="msg warn">Ingresa tu código SIS.</div>'; return; }
  if(ciis.includes(':')){ msg.innerHTML = '<div class="msg warn">El código SIS no puede contener el símbolo ":".</div>'; return; }

  const found = await storeGet('alumno:'+materia+':'+ciis);

  if(found){
    currentStudent = {materia, ciis, nombre: found.nombre};
    showMarkStep();
  }else{
    currentStudent = {materia, ciis, nombre: null};
    document.getElementById('stepIdentify').classList.add('hidden');
    document.getElementById('stepRegister').classList.remove('hidden');
  }
}

async function registerStudent(){
  const nombre = document.getElementById('nombreInput').value.trim();
  if(!nombre) return;
  const {materia, ciis} = currentStudent;
  await storeSet('alumno:'+materia+':'+ciis, {nombre, registrado: todayStr()});
  currentStudent.nombre = nombre;
  document.getElementById('stepRegister').classList.add('hidden');
  showMarkStep();
  markAttendance();
}

function showMarkStep(){
  document.getElementById('stepIdentify').classList.add('hidden');
  document.getElementById('stepMark').classList.remove('hidden');
  document.getElementById('welcomeName').textContent = currentStudent.nombre;
  document.getElementById('welcomeMateria').textContent = currentStudent.materia;
  document.getElementById('markMsg').innerHTML = '';
}

async function markAttendance(){
  const {materia, ciis, nombre} = currentStudent;
  const msg = document.getElementById('markMsg');

  const ubicacion = await storeGet('ubicacion:'+materia);

  // Si el docente todavía no activó la ubicación del aula, NO se toma
  // asistencia todavía. El estudiante ya quedó registrado (su nombre está
  // guardado desde identifyStudent/registerStudent), pero la asistencia
  // en sí solo se puede marcar una vez que el docente active la ubicación.
  if(!ubicacion){
    msg.innerHTML = '<div class="msg warn">Tu nombre ya está registrado. El docente todavía no activó la verificación de ubicación para esta materia, así que la asistencia se podrá marcar recién cuando la active.</div>';
    return;
  }

  msg.innerHTML = '<div class="msg warn">Verificando tu ubicación…</div>';
  let pos;
  try{
    pos = await getPosition();
  }catch(e){
    msg.innerHTML = '<div class="msg err">'+mensajeErrorUbicacion(e)+' <span class="link" onclick="markAttendance()">Reintentar</span></div>';
    return;
  }

  const dist = distanciaMetros(pos.coords.latitude, pos.coords.longitude, ubicacion.lat, ubicacion.lng);
  const precision = pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null;

  if(dist > ubicacion.radio){
    let aviso = '';
    if(precision && precision > 30){
      aviso = ' Tu GPS tiene poca precisión ahora mismo (margen de error de unos '+precision+' m). Sal a un espacio abierto para mejorar la señal antes de reintentar.';
    }
    msg.innerHTML = '<div class="msg err">Estás a unos '+Math.round(dist)+' m del aula.'+aviso+' <span class="link" onclick="markAttendance()">Reintentar</span></div>';
    return;
  }

  // Cada alumno tiene su propio documento de asistencia para el día de hoy,
  // por lo que dos alumnos marcando al mismo tiempo NUNCA se pisan entre sí.
  const key = 'asistencia:'+materia+':'+todayStr()+':'+ciis;
  const already = await storeGet(key);
  if(already){
    msg.innerHTML = '<div class="msg warn">Ya marcaste asistencia hoy a las '+already.hora+'.</div>';
    return;
  }
  const hora = nowTime();
  const ok = await storeSet(key, {nombre, hora});
  if(ok){
    msg.innerHTML = '<div class="msg ok">Asistencia registrada a las '+hora+'.</div>';
  }else{
    msg.innerHTML = '<div class="msg err">No pudimos guardar tu asistencia. Puede ser tu conexión a internet, o que el docente todavía no terminó de configurar el sistema. Avísale al docente si esto sigue pasando.</div>';
  }
}

async function checkPin(){
  const val = document.getElementById('pinInput').value;
  const msg = document.getElementById('pinMsg');
  const btn = event.target;

  const originalText = btn.textContent;
  btn.textContent = "Verificando...";
  btn.disabled = true;

  const isValid = await verifyAdminPin(val);

  if(isValid){
    document.getElementById('pinCard').classList.add('hidden');
    document.getElementById('adminPanel').classList.remove('hidden');
    loadMateriasIntoAdminSelect();
  }else{
    msg.innerHTML = '<div class="msg err">PIN incorrecto.</div>';
  }

  btn.textContent = originalText;
  btn.disabled = false;
}

function formatFechaCorta(f){
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const [y,m,d] = f.split('-');
  return parseInt(d,10)+' '+meses[parseInt(m,10)-1];
}

// Conecta "escuchas" en tiempo real de Firestore para la materia actual.
// Mientras el docente tenga esta materia abierta, cualquier alumno nuevo o
// asistencia nueva refresca la tabla automáticamente, sin recargar la página.
function activarTiempoRealParaMateria(materia){
  if(!materia || materia === listenerMateriaActual) return; // ya conectado

  // Desconectamos los escuchas de la materia anterior (si había)
  if(unsubAlumnosListener) unsubAlumnosListener();
  if(unsubAsistenciaListener) unsubAsistenciaListener();

  listenerMateriaActual = materia;

  const refrescarSiSigueActiva = () => {
    if(document.getElementById('adminMatSelect').value === materia) loadAdminData();
  };

  unsubAlumnosListener = escucharCambiosPorPrefijo('alumno:'+materia+':', refrescarSiSigueActiva);
  unsubAsistenciaListener = escucharCambiosPorPrefijo('asistencia:'+materia+':', refrescarSiSigueActiva);
}

async function loadAdminData(){
  const materia = document.getElementById('adminMatSelect').value;
  const fechaSel = document.getElementById('adminDate').value || todayStr();
  if(!materia) return;

  activarTiempoRealParaMateria(materia);

  // Traemos todos los alumnos de la materia en una sola consulta
  const alumnosDocs = await storeGetByPrefix('alumno:'+materia+':');
  const alumnos = alumnosDocs.map(d=>({
    ciis: d.key.split(':')[2],
    nombre: d.data.nombre,
    registrado: d.data.registrado
  })).sort((a,b)=> a.nombre.localeCompare(b.nombre));

  // Traemos TODA la asistencia de la materia (todos los días) en una sola consulta
  // Llave: asistencia:{materia}:{fecha}:{ciis}
  const asistDocs = await storeGetByPrefix('asistencia:'+materia+':');
  const asistPorFecha = {}; // { "2026-09-09": { "12345": {nombre, hora} } }
  asistDocs.forEach(d=>{
    const parts = d.key.split(':');
    const fecha = parts[2];
    const ciis = parts[3];
    if(!asistPorFecha[fecha]) asistPorFecha[fecha] = {};
    asistPorFecha[fecha][ciis] = d.data;
  });
  const fechas = Object.keys(asistPorFecha).sort();

  const asistenciaSeleccionada = asistPorFecha[fechaSel] ? Object.keys(asistPorFecha[fechaSel]) : [];
  document.getElementById('sumTotal').textContent = alumnos.length;
  document.getElementById('sumAsist').textContent = asistenciaSeleccionada.length;

  await loadLocationStatus(materia);

  const thead = document.getElementById('adminThead');
  thead.innerHTML = '<th class="name-col">Nombre completo</th><th>SIS</th>'+
    fechas.map(f=>'<th>'+formatFechaCorta(f)+'</th>').join('');

  const tbody = document.getElementById('adminTbody');
  tbody.innerHTML = '';
  document.getElementById('adminEmptyMsg').classList.toggle('hidden', alumnos.length>0);

  alumnos.forEach(a=>{
    const tr = document.createElement('tr');
    let cells = '<td class="name-col">'+a.nombre+'</td><td>'+a.ciis+'</td>';
    fechas.forEach(f=>{
      const found = asistPorFecha[f][a.ciis];
      if(found) cells += '<td><span class="badge si">Sí</span><span class="hora-mini">'+found.hora+'</span></td>';
      else cells += '<td><span class="badge no">No</span></td>';
    });
    tr.innerHTML = cells;
    tbody.appendChild(tr);
  });
}

async function exportExcel(){
  const materia = document.getElementById('adminMatSelect').value;
  if(!materia) return;

  const alumnosDocs = await storeGetByPrefix('alumno:'+materia+':');
  const alumnos = alumnosDocs.map(d=>({
    ciis: d.key.split(':')[2],
    nombre: d.data.nombre
  })).sort((a,b)=> a.nombre.localeCompare(b.nombre));

  const asistDocs = await storeGetByPrefix('asistencia:'+materia+':');
  const asistPorFecha = {};
  asistDocs.forEach(d=>{
    const parts = d.key.split(':');
    const fecha = parts[2];
    const ciis = parts[3];
    if(!asistPorFecha[fecha]) asistPorFecha[fecha] = {};
    asistPorFecha[fecha][ciis] = d.data;
  });
  const fechas = Object.keys(asistPorFecha).sort();

  const header = ['Nombre completo','SIS', ...fechas.map(formatFechaCorta)];
  const rows = alumnos.map(a=>{
    const row = [a.nombre, a.ciis];
    fechas.forEach(f=>{
      const found = asistPorFecha[f][a.ciis];
      row.push(found ? ('Sí '+found.hora) : 'No');
    });
    return row;
  });

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, materia.substring(0,28));
  XLSX.writeFile(wb, 'asistencia_'+materia.replace(/\s+/g,'_')+'.xlsx');
}

async function deleteMateria(){
  const materia = document.getElementById('adminMatSelect').value;
  if(!materia) return;

  const confirmacion = confirm(`¿Estás completamente seguro de eliminar la materia "${materia}"?\nEsto borrará a todos sus estudiantes registrados y toda su asistencia guardada. Esta acción NO se puede deshacer.`);

  if(confirmacion){
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = "Borrando...";
    btn.disabled = true;

    try {
      // Ahora sí se borran de verdad todos los datos asociados a la materia
      await storeDeleteByPrefix('alumno:'+materia+':');
      await storeDeleteByPrefix('asistencia:'+materia+':');
      await storeDelete('ubicacion:'+materia);

      let materias = await getMaterias();
      materias = materias.filter(m => m !== materia);
      await storeSet('materias', materias);

      alert(`La materia "${materia}" ha sido eliminada con éxito.`);
      await loadMateriasIntoAdminSelect();
    } catch (e) {
      alert("Hubo un error al eliminar la materia.");
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }
}

// ================================================================
// MIGRACIÓN ÚNICA: convierte los datos guardados con el esquema
// VIEJO (una lista compartida por materia/día) al esquema NUEVO
// (un documento por alumno y por registro de asistencia).
//
// Es SEGURO hacer clic en el botón de migración más de una vez:
// si ya no queda nada en el formato viejo, simplemente no hace nada.
//
// Si tu sistema es nuevo y todavía no tiene alumnos guardados,
// puedes ignorar este botón sin problema.
// ================================================================
async function migrarDatosAntiguos(){
  const btn = event.target;
  const originalText = btn.textContent;
  btn.textContent = "Migrando...";
  btn.disabled = true;

  try{
    const materias = await getMaterias();
    let totalAlumnos = 0;
    let totalAsistencias = 0;

    for(const materia of materias){
      // --- Migrar lista vieja de alumnos: "alumnos:{materia}" ---
      const alumnosViejo = await storeGet('alumnos:'+materia);
      if(alumnosViejo && alumnosViejo.length){
        for(const a of alumnosViejo){
          await storeSet('alumno:'+materia+':'+a.ciis, {nombre: a.nombre, registrado: a.registrado});
          totalAlumnos++;
        }
        await storeDelete('alumnos:'+materia);
      }

      // --- Migrar listas viejas de asistencia: "asistencia:{materia}:{fecha}" ---
      const keysViejas = await storeListKeys('asistencia:'+materia+':');
      for(const key of keysViejas){
        const partes = key.split(':');
        // Si ya tiene 4 partes (materia:fecha:ciis) es del esquema NUEVO, se ignora.
        if(partes.length !== 3) continue;
        const fecha = partes[2];
        const listaVieja = await storeGet(key);
        if(listaVieja && listaVieja.length){
          for(const r of listaVieja){
            await storeSet('asistencia:'+materia+':'+fecha+':'+r.ciis, {nombre: r.nombre, hora: r.hora});
            totalAsistencias++;
          }
          await storeDelete(key);
        }
      }
    }

    alert('Migración completa.\nAlumnos migrados: '+totalAlumnos+'\nRegistros de asistencia migrados: '+totalAsistencias+'\n\nSi ambos números son 0, es porque no había nada del formato antiguo (o ya habías migrado antes).');
    await loadMateriasIntoAdminSelect();
  }catch(e){
    console.error(e);
    alert('Hubo un error durante la migración. Revisa la consola del navegador (F12) para más detalles.');
  }finally{
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

loadMateriasIntoSelect();
document.getElementById('adminDate') && (document.getElementById('adminDate').value = todayStr());
