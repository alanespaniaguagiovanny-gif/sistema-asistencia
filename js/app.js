const PIN = "0000";
let currentStudent = null;

function todayStr(){
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function nowTime(){
  const d = new Date();
  return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
}

// ---------------------------------------------------------
// NOTA: Las funciones storeGet, storeSet, storeListKeys y 
// storeDelete ahora viven en js/db.js (conectado a Google Sheets)
// ---------------------------------------------------------

function getPosition(){
  return new Promise((resolve, reject)=>{
    if(!navigator.geolocation) return reject(new Error('Este navegador no soporta ubicación.'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, timeout: 12000, maximumAge: 0
    });
  });
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
    status.textContent = 'No pudimos obtener tu ubicación.';
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

  const alumnos = (await storeGet('alumnos:'+materia)) || [];
  const found = alumnos.find(a=>a.ciis === ciis);

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
  const alumnos = (await storeGet('alumnos:'+materia)) || [];
  alumnos.push({ciis, nombre, registrado: todayStr()});
  await storeSet('alumnos:'+materia, alumnos);
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
  if(ubicacion){
    msg.innerHTML = '<div class="msg warn">Verificando tu ubicación…</div>';
    let pos;
    try{
      pos = await getPosition();
    }catch(e){
      msg.innerHTML = '<div class="msg err">Necesitamos acceso a tu ubicación.</div>';
      return;
    }
    const dist = distanciaMetros(pos.coords.latitude, pos.coords.longitude, ubicacion.lat, ubicacion.lng);
    if(dist > ubicacion.radio){
      msg.innerHTML = '<div class="msg err">Estás a unos '+Math.round(dist)+' m. Acércate.</div>';
      return;
    }
  }

  const key = 'asistencia:'+materia+':'+todayStr();
  const lista = (await storeGet(key)) || [];
  const already = lista.find(a=>a.ciis===ciis);
  if(already){
    msg.innerHTML = '<div class="msg warn">Ya marcaste asistencia hoy a las '+already.hora+'.</div>';
    return;
  }
  lista.push({ciis, nombre, hora: nowTime()});
  await storeSet(key, lista);
  msg.innerHTML = '<div class="msg ok">Asistencia registrada a las '+nowTime()+'.</div>';
}

function checkPin(){
  const val = document.getElementById('pinInput').value;
  const msg = document.getElementById('pinMsg');
  if(val === PIN){
    document.getElementById('pinCard').classList.add('hidden');
    document.getElementById('adminPanel').classList.remove('hidden');
    loadMateriasIntoAdminSelect();
  }else{
    msg.innerHTML = '<div class="msg err">PIN incorrecto.</div>';
  }
}

function formatFechaCorta(f){
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const [y,m,d] = f.split('-');
  return parseInt(d,10)+' '+meses[parseInt(m,10)-1];
}

async function loadAdminData(){
  const materia = document.getElementById('adminMatSelect').value;
  const fechaSel = document.getElementById('adminDate').value || todayStr();
  if(!materia) return;

  const alumnos = (await storeGet('alumnos:'+materia)) || [];
  const asistKeys = await storeListKeys('asistencia:'+materia+':');
  const fechas = asistKeys.map(k=>k.split(':').pop()).sort();

  const asistPorFecha = {};
  for(const f of fechas) asistPorFecha[f] = (await storeGet('asistencia:'+materia+':'+f)) || [];

  const asistenciaSeleccionada = asistPorFecha[fechaSel] || (await storeGet('asistencia:'+materia+':'+fechaSel)) || [];
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
      const found = asistPorFecha[f].find(x=>x.ciis===a.ciis);
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
  const alumnos = (await storeGet('alumnos:'+materia)) || [];
  const asistKeys = await storeListKeys('asistencia:'+materia+':');
  const fechas = asistKeys.map(k=>k.split(':').pop()).sort();
  const asistPorFecha = {};
  for(const f of fechas) asistPorFecha[f] = (await storeGet('asistencia:'+materia+':'+f)) || [];

  const header = ['Nombre completo','SIS', ...fechas.map(formatFechaCorta)];
  const rows = alumnos.map(a=>{
    const row = [a.nombre, a.ciis];
    fechas.forEach(f=>{
      const found = asistPorFecha[f].find(x=>x.ciis===a.ciis);
      row.push(found ? ('Sí '+found.hora) : 'No');
    });
    return row;
  });

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, materia.substring(0,28));
  XLSX.writeFile(wb, 'asistencia_'+materia.replace(/\s+/g,'_')+'.xlsx');
}

loadMateriasIntoSelect();
document.getElementById('adminDate') && (document.getElementById('adminDate').value = todayStr());
