let currentStudent = null;

// Estado de sesión del docente (se llena en el listener de auth, al final del archivo)
let docenteEmail = null;
let docenteNombre = null;
let materiasDocenteCache = []; // [{id, nombre}, ...] de la materia del docente logueado
let materiasGlobalCache = [];  // [{id, nombre}, ...] todas las materias, para el lado estudiante

// Genera un identificador único para una materia nueva. Como ahora puede
// haber varios docentes usando nombres parecidos ("Cálculo I" de dos
// personas distintas), cada materia se identifica internamente con este
// código único (no con su nombre), para que nunca se mezclen los datos.
function generarMateriaId(){
  return 'mat_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

function nombreDeMateria(id){
  const m = materiasDocenteCache.find(x => x.id === id);
  return m ? m.nombre : id;
}

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
// storeListKeys, storeDelete, storeDeleteByPrefix,
// escucharCambiosPorPrefijo, registrarMateriaEnHoja,
// vincularHojaExistente, eliminarMateriaEnHoja,
// iniciarSesionGoogle y cerrarSesionGoogle viven en js/db.js
//
// ESQUEMA DE LLAVES:
//   docentes_autorizados                    -> lista de correos que pueden administrar (se crea manualmente en Firebase)
//   materias:{correoDocente}                -> [{id, nombre}, ...] materias de ESE docente
//   materias_global                         -> [{id, nombre}, ...] TODAS las materias (para que el estudiante elija)
//   estudiante:{ciis}                       -> {nombre}  (directorio global, un alumno puede estar en varias materias)
//   alumno:{materiaId}:{ciis}               -> {nombre, registrado}
//   asistencia:{materiaId}:{fecha}:{ciis}   -> {nombre, hora}
//   ubicacion:{materiaId}                   -> {lat, lng, radio, precision}
//
// OJO: "materiaId" es un código interno (ej: "mat_abc123"), NO el nombre
// que escribió el docente. Esto evita que dos docentes con una materia del
// mismo nombre ("Cálculo I") mezclen sus datos por accidente. Para mostrar
// el nombre real en pantalla, se usa nombreDeMateria(id) o el texto de las
// opciones del <select> correspondiente.
// ---------------------------------------------------------

// Pide la ubicación al navegador, pero en vez de conformarse con la
// primera lectura (que suele ser la menos precisa), intenta hasta 2 veces
// y se queda con la más precisa. Si una lectura ya es bastante buena
// (menos de 20 m de margen de error), no hace falta seguir intentando.
function getPosition(intentosMax){
  if(intentosMax === undefined) intentosMax = 2;
  return new Promise((resolve, reject)=>{
    if(!navigator.geolocation) return reject(new Error('Este navegador no soporta ubicación.'));

    let mejorLectura = null;
    let intentosHechos = 0;

    function intentar(){
      navigator.geolocation.getCurrentPosition(
        pos => {
          intentosHechos++;
          if(!mejorLectura || pos.coords.accuracy < mejorLectura.coords.accuracy){
            mejorLectura = pos;
          }
          const suficientementePreciso = pos.coords.accuracy && pos.coords.accuracy <= 20;
          if(suficientementePreciso || intentosHechos >= intentosMax){
            resolve(mejorLectura);
          }else{
            intentar();
          }
        },
        err => {
          if(mejorLectura) resolve(mejorLectura); // ya teníamos al menos una lectura utilizable
          else reject(err);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    }
    intentar();
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
    return 'Tardamos demasiado en obtener tu ubicación. Sal a un espacio abierto e intenta de nuevo.';
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

// Un solo botón que activa o desactiva la verificación de ubicación,
// según si ya estaba configurada o no para la materia seleccionada.
async function toggleUbicacion(){
  const materia = document.getElementById('adminMatSelect').value;
  const status = document.getElementById('locStatus');
  const btn = document.getElementById('btnToggleUbicacion');
  if(!materia){ alert('Selecciona una materia primero.'); return; }

  const yaConfigurada = await storeGet('ubicacion:'+materia);

  if(yaConfigurada){
    // --- Desactivar ---
    const confirmar = confirm('¿Quitar la verificación de ubicación de esta materia?\nLos estudiantes podrán marcar asistencia desde cualquier lugar hasta que la vuelvas a activar.');
    if(!confirmar) return;
    await storeDelete('ubicacion:'+materia);
    await loadLocationStatus(materia);
    return;
  }

  // --- Activar (usando la ubicación actual del docente) ---
  const radio = parseInt(document.getElementById('locRadio').value, 10) || 60;
  const originalText = btn.textContent;
  btn.disabled = true;
  status.textContent = 'Obteniendo tu ubicación...';
  try{
    const pos = await getPosition();
    const precision = pos.coords.accuracy ? Math.round(pos.coords.accuracy) : 0;
    const data = {lat: pos.coords.latitude, lng: pos.coords.longitude, radio, precision};
    await storeSet('ubicacion:'+materia, data);
    await loadLocationStatus(materia);
  }catch(e){
    status.textContent = mensajeErrorUbicacion(e);
  }finally{
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function loadLocationStatus(materia){
  const status = document.getElementById('locStatus');
  const btn = document.getElementById('btnToggleUbicacion');
  const ubic = await storeGet('ubicacion:'+materia);
  if(ubic){
    const precisionTxt = ubic.precision ? (', precisión GPS al activar: ~'+ubic.precision+' m') : '';
    status.textContent = 'Activada ✓ (radio: '+ubic.radio+' m'+precisionTxt+').';
    document.getElementById('locRadio').value = ubic.radio;
    btn.textContent = 'Desactivar ubicación';
  }else{
    status.textContent = 'Desactivada.';
    btn.textContent = 'Activar ubicación';
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
    await loadLocationStatus(materia);
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

async function loadMateriasIntoSelect(){
  const materias = (await storeGet('materias_global')) || [];
  materiasGlobalCache = materias;
  const sel = document.getElementById('matSelect');
  sel.innerHTML = '';
  document.getElementById('noMateriasMsg').classList.toggle('hidden', materias.length>0);
  materias.forEach(m=>{
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.docenteNombre ? (m.nombre+' — '+m.docenteNombre) : m.nombre;
    sel.appendChild(opt);
  });
}

async function getMateriasDocente(){
  if(!docenteEmail) return [];
  return (await storeGet('materias:'+docenteEmail)) || [];
}

async function loadMateriasIntoAdminSelect(){
  const materias = await getMateriasDocente();
  materiasDocenteCache = materias;
  const sel = document.getElementById('adminMatSelect');
  sel.innerHTML = '';
  materias.forEach(m=>{
    const opt = document.createElement('option');
    opt.value = m.id; opt.textContent = m.nombre;
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
    t.textContent = m.nombre;
    box.appendChild(t);
  });
}

async function addMateria(){
  const input = document.getElementById('newMateria');
  const name = input.value.trim();
  if(!name) return;
  if(!docenteEmail){ alert('Inicia sesión primero.'); return; }
  try{
    const misMaterias = await getMateriasDocente();
    if(misMaterias.some(m => m.nombre === name)){ input.value=''; return; }

    const id = generarMateriaId();
    misMaterias.push({id, nombre: name});
    await storeSet('materias:'+docenteEmail, misMaterias, false);

    const materiasGlobales = (await storeGet('materias_global')) || [];
    materiasGlobales.push({id, nombre: name, docenteNombre: docenteNombre});
    await storeSet('materias_global', materiasGlobales, false);

    // Crea la pestaña correspondiente en Google Sheets
    registrarMateriaEnHoja(id, name, docenteEmail);

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
  const sel = document.getElementById('matSelect');
  const materia = sel.value;
  const materiaNombre = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '';
  const ciis = document.getElementById('ciisInput').value.trim();
  const msg = document.getElementById('identifyMsg');
  msg.innerHTML = '';
  if(!materia){ msg.innerHTML = '<div class="msg warn">Selecciona una materia.</div>'; return; }
  if(!ciis){ msg.innerHTML = '<div class="msg warn">Ingresa tu código SIS.</div>'; return; }
  if(ciis.includes(':')){ msg.innerHTML = '<div class="msg warn">El código SIS no puede contener el símbolo ":".</div>'; return; }

  const found = await storeGet('alumno:'+materia+':'+ciis);

  if(found){
    currentStudent = {materia, materiaNombre, ciis, nombre: found.nombre};
    showMarkStep();
    return;
  }

  // No está inscrito todavía en ESTA materia. Como el código SIS es único
  // por estudiante, revisamos el directorio global (estudiante:{ciis}) por
  // si ya lo conocemos de otra materia — así no le pedimos el nombre de nuevo.
  const conocido = await storeGet('estudiante:'+ciis);
  if(conocido && conocido.nombre){
    await storeSet('alumno:'+materia+':'+ciis, {nombre: conocido.nombre, registrado: todayStr()});
    currentStudent = {materia, materiaNombre, ciis, nombre: conocido.nombre};
    showMarkStep();
    return;
  }

  currentStudent = {materia, materiaNombre, ciis, nombre: null};
  document.getElementById('stepIdentify').classList.add('hidden');
  document.getElementById('stepRegister').classList.remove('hidden');
}

async function registerStudent(){
  const nombre = document.getElementById('nombreInput').value.trim();
  if(!nombre) return;
  const {materia, ciis} = currentStudent;
  await storeSet('alumno:'+materia+':'+ciis, {nombre, registrado: todayStr()});
  // Guardamos también en el directorio global por SIS, para que si este
  // mismo alumno aparece en OTRA materia más adelante, ya no tenga que
  // volver a escribir su nombre.
  await storeSet('estudiante:'+ciis, {nombre}, false);
  currentStudent.nombre = nombre;
  document.getElementById('stepRegister').classList.add('hidden');
  showMarkStep();
  markAttendance();
}

function showMarkStep(){
  document.getElementById('stepIdentify').classList.add('hidden');
  document.getElementById('stepMark').classList.remove('hidden');
  document.getElementById('welcomeName').textContent = currentStudent.nombre;
  document.getElementById('welcomeMateria').textContent = currentStudent.materiaNombre || currentStudent.materia;
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
  const precision = pos.coords.accuracy ? Math.round(pos.coords.accuracy) : 0;

  // El radio que puso el docente es la distancia "ideal", pero el GPS
  // nunca es exacto. Sumamos el margen de error de la lectura del docente
  // (guardado al activar la ubicación) y el margen de error de la lectura
  // actual del alumno, cada uno con un tope de 60 m para que no se vuelva
  // demasiado permisivo si el GPS de alguien está muy mal.
  const margenDocente = Math.min(ubicacion.precision || 0, 60);
  const margenAlumno = Math.min(precision, 60);
  const distanciaPermitida = ubicacion.radio + margenDocente + margenAlumno;

  if(dist > distanciaPermitida){
    let aviso = '';
    if(precision > 30){
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

function iniciarSesionDocente(){
  const msg = document.getElementById('loginMsg');
  msg.innerHTML = '';
  iniciarSesionGoogle().catch(e=>{
    console.error(e);
    msg.innerHTML = '<div class="msg err">No se pudo iniciar sesión: '+e.message+'</div>';
  });
}

function cerrarSesionDocente(){
  cerrarSesionGoogle();
}

// Cada vez que cambia el estado de sesión (inicia o cierra sesión),
// Firebase avisa aquí automáticamente.
auth.onAuthStateChanged(async user => {
  const loginCard = document.getElementById('loginCard');
  const adminPanel = document.getElementById('adminPanel');
  const docenteInfo = document.getElementById('docenteInfo');
  const msg = document.getElementById('loginMsg');

  if(user){
    // Verificamos que este correo esté en la lista de docentes autorizados
    // (esa lista se crea/edita manualmente en Firebase Console, ver instrucciones).
    const autorizados = await storeGet('docentes_autorizados');
    const estaAutorizado = autorizados && autorizados.includes(user.email);

    if(!estaAutorizado){
      msg.innerHTML = '<div class="msg err">La cuenta '+user.email+' no está autorizada para administrar este sistema. Pide al administrador que agregue tu correo.</div>';
      await cerrarSesionGoogle();
      return;
    }

    docenteEmail = user.email;
    docenteNombre = user.displayName || user.email.split('@')[0];
    docenteInfo.textContent = 'Sesión iniciada como: '+user.email;
    loginCard.classList.add('hidden');
    adminPanel.classList.remove('hidden');
    await loadMateriasIntoAdminSelect();
  }else{
    docenteEmail = null;
    loginCard.classList.remove('hidden');
    adminPanel.classList.add('hidden');
  }
});

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

    const tdNombre = document.createElement('td');
    tdNombre.className = 'name-col';
    tdNombre.appendChild(document.createTextNode(a.nombre));
    const btnEditar = document.createElement('span');
    btnEditar.textContent = ' ✏️';
    btnEditar.title = 'Corregir nombre';
    btnEditar.style.cursor = 'pointer';
    btnEditar.onclick = () => editarNombreAlumno(materia, a.ciis, a.nombre);
    tdNombre.appendChild(btnEditar);
    tr.appendChild(tdNombre);

    const tdCiis = document.createElement('td');
    tdCiis.textContent = a.ciis;
    tr.appendChild(tdCiis);

    fechas.forEach(f=>{
      const td = document.createElement('td');
      const found = asistPorFecha[f][a.ciis];
      if(found) td.innerHTML = '<span class="badge si">Sí</span><span class="hora-mini">'+found.hora+'</span>';
      else td.innerHTML = '<span class="badge no">No</span>';
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

// Permite al docente corregir el nombre de un alumno (por ejemplo, si se
// equivocó al escribirlo al registrarse). Corrige el nombre en esta materia
// Y en el directorio global por SIS, para que futuras materias también
// usen el nombre ya corregido. OJO: si el alumno ya estaba inscrito en
// OTRAS materias antes de esta corrección, esas otras materias no se
// actualizan automáticamente (para eso, corrígelo también ahí).
async function editarNombreAlumno(materia, ciis, nombreActual){
  const nuevoNombre = prompt('Corregir nombre completo:', nombreActual);
  if(nuevoNombre === null) return; // el docente canceló
  const limpio = nuevoNombre.trim();
  if(!limpio || limpio === nombreActual) return;

  const registro = await storeGet('alumno:'+materia+':'+ciis);
  await storeSet('alumno:'+materia+':'+ciis, {nombre: limpio, registrado: (registro && registro.registrado) || todayStr()});
  await storeSet('estudiante:'+ciis, {nombre: limpio}, false);
  await loadAdminData();
}

async function exportExcel(){
  const materia = document.getElementById('adminMatSelect').value;
  if(!materia) return;
  const nombreMateria = nombreDeMateria(materia);

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
  XLSX.utils.book_append_sheet(wb, ws, nombreMateria.substring(0,28));
  XLSX.writeFile(wb, 'asistencia_'+nombreMateria.replace(/\s+/g,'_')+'.xlsx');
}

async function deleteMateria(){
  const materia = document.getElementById('adminMatSelect').value;
  if(!materia) return;
  const nombreMateria = nombreDeMateria(materia);

  const confirmacion = confirm(`¿Estás completamente seguro de eliminar la materia "${nombreMateria}"?\nEsto borrará a todos sus estudiantes registrados y toda su asistencia guardada. Esta acción NO se puede deshacer.`);

  if(confirmacion){
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = "Borrando...";
    btn.disabled = true;

    try {
      // Ahora sí se borran de verdad todos los datos asociados a la materia
      // en Firestore. Le pasamos "false" para que NO mande un aviso de
      // borrado a Sheets por cada alumno/registro (sería lento e inútil,
      // ya que vamos a borrar la pestaña entera de un solo golpe abajo).
      await storeDeleteByPrefix('alumno:'+materia+':', false);
      await storeDeleteByPrefix('asistencia:'+materia+':', false);
      await storeDelete('ubicacion:'+materia);
      eliminarMateriaEnHoja(materia);

      let misMaterias = await getMateriasDocente();
      misMaterias = misMaterias.filter(m => m.id !== materia);
      await storeSet('materias:'+docenteEmail, misMaterias, false);

      let materiasGlobales = (await storeGet('materias_global')) || [];
      materiasGlobales = materiasGlobales.filter(m => m.id !== materia);
      await storeSet('materias_global', materiasGlobales, false);

      alert(`La materia "${nombreMateria}" ha sido eliminada con éxito.`);
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
// MIGRACIÓN ÚNICA: pasa tus materias actuales (guardadas antes de tener
// cuentas de docente, todas juntas en una lista compartida "materias")
// a TU cuenta de Google, generándoles un identificador único interno y
// vinculando cada una con su pestaña YA EXISTENTE en Google Sheets (no
// crea pestañas nuevas, solo las "conecta" con el nuevo sistema).
//
// Es SEGURO hacer clic en el botón de migración más de una vez: si ya no
// queda nada en el formato viejo, simplemente avisa que no hay nada que
// migrar y no toca nada.
//
// Debes haber iniciado sesión antes de usar este botón (las materias
// migradas quedan asignadas a la cuenta con la que iniciaste sesión).
// ================================================================
async function migrarDatosAntiguos(){
  const btn = event.target;
  const originalText = btn.textContent;

  if(!docenteEmail){
    alert('Inicia sesión primero. Las materias migradas quedarán asignadas a tu cuenta.');
    return;
  }

  btn.textContent = "Migrando...";
  btn.disabled = true;

  try{
    const materiasViejas = (await storeGet('materias')) || [];
    if(materiasViejas.length === 0){
      alert('No se encontró ninguna materia en el formato antiguo. Si ya migraste antes, todo está en orden y no hace falta hacer nada más.');
      return;
    }

    const misMaterias = await getMateriasDocente();
    const materiasGlobales = (await storeGet('materias_global')) || [];

    for(const nombreViejo of materiasViejas){
      const id = generarMateriaId();

      // Copiar alumnos de esta materia
      const alumnosDocs = await storeGetByPrefix('alumno:'+nombreViejo+':');
      for(const d of alumnosDocs){
        const ciis = d.key.split(':')[2];
        await storeSet('alumno:'+id+':'+ciis, d.data, false);
      }

      // Por si quedó algo del formato MUY antiguo (antes de la primera
      // migración que hicimos), que guardaba una lista completa en
      // "alumnos:{materia}" (con "s") en vez de un documento por alumno.
      const alumnosMuyViejo = await storeGet('alumnos:'+nombreViejo);
      if(alumnosMuyViejo && alumnosMuyViejo.length){
        for(const a of alumnosMuyViejo){
          await storeSet('alumno:'+id+':'+a.ciis, {nombre: a.nombre, registrado: a.registrado}, false);
        }
        await storeDelete('alumnos:'+nombreViejo);
      }

      // Copiar toda la asistencia de esta materia
      const asistDocs = await storeGetByPrefix('asistencia:'+nombreViejo+':');
      for(const d of asistDocs){
        const partes = d.key.split(':');
        const fecha = partes[2];
        const ciis = partes[3];
        await storeSet('asistencia:'+id+':'+fecha+':'+ciis, d.data, false);
      }

      // Copiar la ubicación configurada (si tenía)
      const ubic = await storeGet('ubicacion:'+nombreViejo);
      if(ubic) await storeSet('ubicacion:'+id, ubic, false);

      // Vincular con la pestaña que YA EXISTE en tu Google Sheet (mismo
      // nombre de siempre) — no crea una pestaña nueva ni duplicada.
      vincularHojaExistente(id, nombreViejo);

      misMaterias.push({id, nombre: nombreViejo});
      materiasGlobales.push({id, nombre: nombreViejo, docenteNombre: docenteNombre});

      // Borrar los datos viejos (ya están copiados al nuevo formato)
      await storeDeleteByPrefix('alumno:'+nombreViejo+':', false);
      await storeDeleteByPrefix('asistencia:'+nombreViejo+':', false);
      if(ubic) await storeDelete('ubicacion:'+nombreViejo);
    }

    await storeSet('materias:'+docenteEmail, misMaterias, false);
    await storeSet('materias_global', materiasGlobales, false);
    await storeDelete('materias'); // ya no se usa la lista vieja compartida

    alert('Migración completa. Se pasaron '+materiasViejas.length+' materia(s) a tu cuenta ('+docenteEmail+').');
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
