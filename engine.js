'use strict';

const STORAGE_KEY_P = 'control_horas_v4_presencial';
const STORAGE_KEY_NP = 'control_horas_v4_nopresencial';
const META_KEY = 'control_horas_v4_meta';
const MAX_INTRA_SHIFT_GAP_MIN = 420; // hasta 7h dentro de la misma jornada

// Supervisores definidos (por Usuario ID exacto o nombre normalizado para futuros archivos)
const SUPERVISOR_IDS = new Set(['6095', '6092', '6195', '6097', '6156', '6474', '6160']);
function isSupervisorRecord(usuario, fullName) {
  if (usuario && SUPERVISOR_IDS.has(String(usuario).trim())) return true;
  const n = normalizeKey(fullName);
  if (!n) return false;
  return (
    (n.includes('victor') && n.includes('quispe')) ||
    (n.includes('paulo') && n.includes('de la cruz')) ||
    (n.includes('mario') && n.includes('nizama')) ||
    n.includes('jesus alberto') ||
    (n.includes('mario') && n.includes('benavides')) ||
    n.includes('jhover') ||
    n.includes('marializ')
  );
}

// Los 4 grupos principales de turno y campaña (Operadores) y subgrupos de Supervisores
const GROUPS = [
  { id: 'ALL', label: 'Todos los turnos', icon: '👥', color: '#0f4c81', soft: '#eff6ff', text: '#0f4c81', badgeCls: 'g-otros' },
  { id: 'DIURNO_ATEMP', label: 'Diurno ATEMP', icon: '☀️', color: '#d97706', soft: '#fffbeb', text: '#92400e', badgeCls: 'g-diurno-atemp' },
  { id: 'NOCTURNO_ATEMP', label: 'Nocturno ATEMP', icon: '🌙', color: '#4f46e5', soft: '#eef2ff', text: '#3730a3', badgeCls: 'g-nocturno-atemp' },
  { id: 'DIA_GOAT', label: 'Día GOAT', icon: '☀️', color: '#059669', soft: '#ecfdf5', text: '#065f46', badgeCls: 'g-dia-goat' },
  { id: 'NOCHE_GOAT', label: 'Noche GOAT', icon: '🌙', color: '#7c3aed', soft: '#f5f3ff', text: '#5b21b6', badgeCls: 'g-noche-goat' }
];
const SUP_GROUPS = [
  { id: 'ALL', label: 'Todos los Supervisores', icon: '🛡️', color: '#6d28d9', soft: '#f5f3ff', text: '#5b21b6', badgeCls: 'g-sup' },
  { id: 'SUP_DIURNO', label: 'Supervisores Diurno', icon: '☀️', color: '#d97706', soft: '#fffbeb', text: '#92400e', badgeCls: 'g-diurno-atemp' },
  { id: 'SUP_NOCTURNO', label: 'Supervisores Nocturno', icon: '🌙', color: '#4f46e5', soft: '#eef2ff', text: '#3730a3', badgeCls: 'g-nocturno-atemp' }
];
const GROUP_MAP = Object.fromEntries([...GROUPS, ...SUP_GROUPS].map(g => [g.id, g]));

// Paleta clara por cada estado del CSV
const KNOWN_STATES = {
  PRODUCTIVO: { key: 'PRODUCTIVO', label: 'Presencial', short: 'Presencial', color: '#10b981', soft: '#ecfdf5', border: '#a7f3d0', text: '#065f46', order: 1 },
  'Problemas equipo de trabajo': { key: 'Problemas equipo de trabajo', label: 'Problemas equipo', short: 'Prob. Equipo', color: '#ef4444', soft: '#fef2f2', border: '#fecaca', text: '#991b1b', order: 2 },
  'Formación': { key: 'Formación', label: 'Formación', short: 'Formación', color: '#2563eb', soft: '#eff6ff', border: '#bfdbfe', text: '#1e40af', order: 3 },
  'Feedback': { key: 'Feedback', label: 'Feedback', short: 'Feedback', color: '#f59e0b', soft: '#fffbeb', border: '#fde68a', text: '#92400e', order: 4 },
  'Reunión con Dr. RRHH': { key: 'Reunión con Dr. RRHH', label: 'Reunión RRHH', short: 'RRHH', color: '#9333ea', soft: '#faf5ff', border: '#e9d5ff', text: '#6b21a8', order: 5 },
  'Apoyo Encargado': { key: 'Apoyo Encargado', label: 'Apoyo Encargado', short: 'Apoyo', color: '#0891b2', soft: '#ecfeff', border: '#a5f3fc', text: '#155e75', order: 6 },
  NP_JUSTIFICADA: { key: 'NP_JUSTIFICADA', label: 'No Pres. Justificada', short: 'Justificada', color: '#4f46e5', soft: '#eef2ff', border: '#c7d2fe', text: '#3730a3', stripedIndigo: true, order: 70 },
  NP_NO_JUSTIFICADA: { key: 'NP_NO_JUSTIFICADA', label: 'No Pres. No Justificada', short: 'Falta / NJ', color: '#be123c', soft: '#ffe4e6', border: '#fda4af', text: '#881337', stripedCrimson: true, order: 71 },
  NO_PAGABLE: { key: 'NO_PAGABLE', label: 'No Pagable', short: 'No Pag.', color: '#94a3b8', soft: '#f8fafc', border: '#cbd5e1', text: '#475569', order: 90 },
  DESCONEXION: { key: 'DESCONEXION', label: 'Desconexión (Hueco)', short: 'Hueco', color: '#e11d48', soft: '#fff1f2', border: '#fda4af', text: '#9f1239', striped: true, order: 95 },
  SALIDA_ANTICIPADA: { key: 'SALIDA_ANTICIPADA', label: 'Salida anticipada', short: 'Salida ant.', color: '#ea580c', soft: '#ffedd5', border: '#fdba74', text: '#9a3412', stripedOrange: true, order: 96 },
  INGRESO_TARDIO: { key: 'INGRESO_TARDIO', label: 'Ingreso tardío', short: 'Tardío', color: '#d97706', soft: '#fef3c7', border: '#fcd34d', text: '#92400e', stripedOrange: true, order: 97 },
  SIN_CERRAR: { key: 'SIN_CERRAR', label: 'Sin cerrar', short: 'Sin cerrar', color: '#db2777', soft: '#fdf2f8', border: '#f9a8d4', text: '#9d174d', order: 99 }
};

const EXTRA_COLORS = [
  { color: '#6366f1', soft: '#eef2ff', border: '#c7d2fe', text: '#3730a3' },
  { color: '#ea580c', soft: '#fff7ed', border: '#fed7aa', text: '#9a3412' },
  { color: '#65a30d', soft: '#f7fee7', border: '#d9f99d', text: '#3f6212' },
  { color: '#0d9488', soft: '#f0fdfa', border: '#99f6e4', text: '#115e59' }
];
const dynamicStates = new Map();

function normalizeKey(str) {
  return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function getStateStyle(key) {
  if (KNOWN_STATES[key]) return KNOWN_STATES[key];
  const norm = normalizeKey(key);
  for (const st of Object.values(KNOWN_STATES)) {
    if (normalizeKey(st.key) === norm) return st;
  }
  if (!dynamicStates.has(key)) {
    const pal = EXTRA_COLORS[dynamicStates.size % EXTRA_COLORS.length];
    dynamicStates.set(key, { key, label: key, short: key.length > 14 ? key.slice(0, 13) + '…' : key, ...pal, order: 20 + dynamicStates.size });
  }
  return dynamicStates.get(key);
}

function shortMotivoNP(motivo, isJust) {
  const m = String(motivo || '').trim();
  const n = normalizeKey(m);
  if (!m) return isJust ? 'Justificada' : 'Falta / NJ';
  if (n === 'ausencia no justificada') return 'Falta / NJ';
  if (n.includes('consulta medica') && n.includes('especialista')) return 'Consulta Esp.';
  if (n.includes('consulta medica')) return 'Consulta Méd.';
  if (n.includes('baja medica')) return 'Baja Médica';
  if (n.includes('permiso acomp')) return 'Acomp. Fam.';
  if (n.includes('asuntos propios')) return 'Asuntos prop.';
  if (n.includes('enfermedad')) return isJust ? 'Enfermedad' : 'Enferm. NJ';
  return m.length > 16 ? m.slice(0, 15) + '…' : m;
}

const state = {
  presencialRecords: [],
  noPresencialRecords: [],
  rawRecords: [],
  meta: { pSource: '', npSource: '' },
  modalStaged: { p: null, np: null },
  role: 'OPERADORES', // 'OPERADORES' | 'SUPERVISORES'
  view: 'diario',
  filters: {
    group: 'ALL',
    fecha: 'LATEST',
    search: '',
    minGap: 1,
    onlyGaps: false,
    selectedStates: new Set(),
    scale: 'AUTO',
    opSort: 'gaps',
    rawOrigin: 'ALL',
    rawPage: 1,
    rawPageSize: 100
  },
  sort: { col: 'gapMin', dir: 'desc' },
  expandedKeys: new Set(),
  computed: {
    allDates: [],
    allDayRows: [],
    roleCounts: { ops: 0, sup: 0 },
    filteredDayRows: [],
    filteredRecords: [],
    operators: [],
    criticalOps: [],
    groupStats: {},
    stateCounts: new Map(),
    activeRange: [0, 1080]
  }
};

const $ = id => document.getElementById(id);

function showBanner(msg, type = 'info') {
  const el = $('status-banner');
  el.className = 'show ' + type;
  $('status-text').textContent = msg;
}
function hideBanner() { $('status-banner').className = ''; }

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtHM(mins) {
  const m = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(m / 60), r = m % 60;
  return h === 0 ? `${r}m` : `${h}h ${String(r).padStart(2, '0')}m`;
}

function fmtClock(mins) {
  const m = Math.max(0, Math.round(mins || 0));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function parseDateTime(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date && !isNaN(val.getTime())) return val;
  if (typeof val === 'number' && val > 25000 && val < 90000) {
    const d = new Date(Math.floor(val - 25569) * 86400 * 1000);
    const sec = Math.round((val - Math.floor(val)) * 86400);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60);
  }
  const s = String(val).trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    let day = parseInt(m[1], 10), mon = parseInt(m[2], 10), yr = parseInt(m[3], 10);
    if (yr < 100) yr += 2000;
    if (mon > 12 && day <= 12) { const t = day; day = mon; mon = t; }
    const dt = new Date(yr, mon - 1, day, m[4] ? parseInt(m[4], 10) : 0, m[5] ? parseInt(m[5], 10) : 0, m[6] ? parseInt(m[6], 10) : 0);
    return isNaN(dt.getTime()) ? null : dt;
  }
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const dt = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), m[4] ? parseInt(m[4], 10) : 0, m[5] ? parseInt(m[5], 10) : 0, m[6] ? parseInt(m[6], 10) : 0);
    return isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

function formatDateKey(dt) {
  if (!dt) return '';
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
}

function dateKeyToSort(dk) {
  const p = String(dk || '').split('/');
  return p.length === 3 ? parseInt(p[2], 10) * 10000 + parseInt(p[1], 10) * 100 + parseInt(p[0], 10) : 0;
}

function formatDayShort(dk) {
  const p = dk.split('/');
  if (p.length !== 3) return dk;
  const dt = new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10));
  return `${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][dt.getDay()]} ${p[0]}/${p[1]}`;
}

function formatTime(dt) {
  return dt ? `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}` : '';
}

function parseDurationMin(horasVal, startDt, endDt) {
  if (horasVal !== null && horasVal !== undefined && horasVal !== '') {
    if (typeof horasVal === 'number' && horasVal >= 0 && horasVal < 10) return Math.round(horasVal * 1440);
    const m = String(horasVal).trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + Math.round(parseInt(m[3] || '0', 10) / 60);
  }
  if (startDt && endDt && endDt.getTime() >= startDt.getTime()) return Math.round((endDt.getTime() - startDt.getTime()) / 60000);
  return 0;
}

function parseCSV(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const first = clean.split(/\r?\n/)[0] || '';
  const delim = ((first.match(/;/g) || []).length > (first.match(/,/g) || []).length) ? ';' : ',';
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQ) {
      if (ch === '"') { if (clean[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\r') { if (clean[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function detectDatasetKind(matrix) {
  if (!matrix || matrix.length < 2) return 'PRESENCIAL';
  let headerIdx = 0;
  for (let i = 0; i < Math.min(15, matrix.length); i++) {
    const nr = matrix[i].map(normalizeKey);
    if ((nr.includes('usuario') || nr.includes('matricula') || nr.includes('nombre')) &&
        (nr.includes('conexion') || nr.includes('inicio') || nr.includes('horas'))) {
      headerIdx = i;
      break;
    }
  }
  const headers = matrix[headerIdx].map(normalizeKey);
  const hasConexion = headers.includes('conexion') || headers.includes('desconexion') || headers.includes('motivo no productivo') || headers.includes('subtipo') || headers.includes('servicio');
  const hasNPCols = headers.includes('recuperar h') || headers.includes('recuperar') || (!hasConexion && headers.includes('inicio') && headers.includes('fin') && headers.includes('motivo'));
  if (hasNPCols && !hasConexion) return 'NO_PRESENCIAL';
  if (hasConexion && !hasNPCols) return 'PRESENCIAL';

  // Respaldo por valores de la columna Tipo
  const tipoIdx = headers.indexOf('tipo');
  if (tipoIdx !== -1) {
    let npHits = 0, pHits = 0;
    for (let i = headerIdx + 1; i < Math.min(matrix.length, headerIdx + 15); i++) {
      const v = normalizeKey(matrix[i]?.[tipoIdx]);
      if (v.includes('justificada')) npHits++;
      if (v.includes('jornada') || v.includes('pagable')) pHits++;
    }
    if (npHits > pHits) return 'NO_PRESENCIAL';
  }
  return 'PRESENCIAL';
}

function matrixToRecords(matrix) {
  if (!matrix || matrix.length < 2) return [];
  let headerIdx = 0;
  for (let i = 0; i < Math.min(15, matrix.length); i++) {
    const nr = matrix[i].map(normalizeKey);
    if (nr.includes('usuario') && (nr.includes('conexion') || nr.includes('horas'))) { headerIdx = i; break; }
  }
  const headers = matrix[headerIdx].map(normalizeKey);
  const colIdx = aliases => { for (const a of aliases) { const i = headers.indexOf(a); if (i !== -1) return i; } return -1; };
  const map = {
    usuario: colIdx(['usuario', 'id usuario', 'id']),
    matricula: colIdx(['matricula', 'codigo', 'legajo']),
    nombre: colIdx(['nombre', 'nombres']),
    apellidos: colIdx(['apellidos', 'apellido']),
    dni: colIdx(['dni', 'documento']),
    tipo: colIdx(['tipo']),
    subTipo: colIdx(['subtipo', 'sub tipo', 'turno']),
    servicio: colIdx(['servicio', 'campana']),
    motivo: colIdx(['motivo no productivo', 'motivo']),
    obs: colIdx(['observaciones', 'observacion', 'comentarios']),
    conexion: colIdx(['conexion', 'inicio', 'hora inicio']),
    desconexion: colIdx(['desconexion', 'fin', 'hora fin']),
    horas: colIdx(['horas', 'duracion']),
    cerrado: colIdx(['cerrado', 'estado']),
    usuarioEdit: colIdx(['usuario edit', 'editado por']),
    fechaEdit: colIdx(['fecha edit', 'fecha edicion'])
  };
  if (map.usuario === -1 && map.nombre === -1) return [];
  const gv = (r, i) => (i >= 0 && i < r.length && r[i] !== undefined && r[i] !== null) ? String(r[i]).trim() : '';

  const records = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || !row.length) continue;
    const usuario = gv(row, map.usuario);
    const nombre = gv(row, map.nombre).replace(/\s+/g, ' ');
    const apellidos = gv(row, map.apellidos).replace(/\s+/g, ' ');
    const conRaw = gv(row, map.conexion);
    if (!usuario && !nombre && !conRaw) continue;

    const desRaw = gv(row, map.desconexion);
    const hrsRaw = gv(row, map.horas);
    const startDt = parseDateTime(conRaw);
    const endDt = parseDateTime(desRaw);
    const durationMin = parseDurationMin(hrsRaw, startDt, endDt);
    const tipo = gv(row, map.tipo) || 'Sin Tipo';
    const subTipo = gv(row, map.subTipo) || '';
    const servicio = (gv(row, map.servicio) || '-').toUpperCase();
    const motivo = gv(row, map.motivo);
    const cerRaw = gv(row, map.cerrado).toUpperCase();
    const cerrado = cerRaw === 'NO' ? 'NO' : (cerRaw === 'SI' ? 'SI' : (desRaw ? 'SI' : 'NO'));
    const fecha = startDt ? formatDateKey(startDt) : (endDt ? formatDateKey(endDt) : '');
    const fullName = `${nombre} ${apellidos}`.trim() || `Usuario ${usuario}`;
    const opKey = usuario || gv(row, map.matricula).toLowerCase() || fullName;

    const rec = {
      sourceKind: 'PRESENCIAL',
      isNoPresencial: false,
      isJustificada: false,
      recuperarH: '',
      shortLabel: '',
      opKey, usuario, matricula: gv(row, map.matricula), nombre, apellidos, fullName, dni: gv(row, map.dni),
      tipo, subTipo, servicio, motivo, obs: gv(row, map.obs),
      conexionStr: startDt ? `${fecha} ${formatTime(startDt)}` : conRaw,
      desconexionStr: endDt ? `${formatDateKey(endDt)} ${formatTime(endDt)}` : desRaw,
      startTimeStr: formatTime(startDt),
      endTimeStr: formatTime(endDt),
      startMs: startDt ? startDt.getTime() : null,
      endMs: endDt ? endDt.getTime() : null,
      fecha, fechaSort: dateKeyToSort(fecha),
      horasStr: hrsRaw || (fmtClock(durationMin) + ':00'),
      durationMin, cerrado,
      usuarioEdit: gv(row, map.usuarioEdit),
      fechaEdit: gv(row, map.fechaEdit),
      isOpen: cerrado === 'NO' || !endDt,
      isProductive: tipo === 'H. Jornada' && !motivo,
      isNonProd: tipo === 'H. Jornada' && !!motivo
    };
    rec.stateKey = tipo === 'H. No Pagables' ? 'NO_PAGABLE' : (motivo || 'PRODUCTIVO');
    records.push(rec);
  }
  return records;
}

function matrixToNoPresencialRecords(matrix) {
  if (!matrix || matrix.length < 2) return [];
  let headerIdx = 0;
  for (let i = 0; i < Math.min(15, matrix.length); i++) {
    const nr = matrix[i].map(normalizeKey);
    if ((nr.includes('usuario') || nr.includes('matricula')) && (nr.includes('inicio') || nr.includes('motivo') || nr.includes('horas'))) {
      headerIdx = i;
      break;
    }
  }
  const headers = matrix[headerIdx].map(normalizeKey);
  const colIdx = aliases => { for (const a of aliases) { const i = headers.indexOf(a); if (i !== -1) return i; } return -1; };
  const map = {
    usuario: colIdx(['usuario', 'id usuario', 'id']),
    matricula: colIdx(['matricula', 'codigo', 'legajo']),
    nombre: colIdx(['nombre', 'nombres']),
    apellidos: colIdx(['apellidos', 'apellido']),
    dni: colIdx(['dni', 'documento']),
    tipo: colIdx(['tipo', 'clasificacion']),
    motivo: colIdx(['motivo', 'motivo ausencia', 'motivo no presencial']),
    inicio: colIdx(['inicio', 'fecha inicio', 'hora inicio', 'conexion']),
    fin: colIdx(['fin', 'fecha fin', 'hora fin', 'desconexion']),
    horas: colIdx(['horas', 'duracion']),
    recuperar: colIdx(['recuperar h', 'recuperar', 'recuperar horas']),
    obs: colIdx(['observaciones', 'observacion', 'comentarios', 'detalle'])
  };
  if (map.usuario === -1 && map.nombre === -1) return [];
  const gv = (r, i) => (i >= 0 && i < r.length && r[i] !== undefined && r[i] !== null) ? String(r[i]).trim() : '';

  const records = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || !row.length) continue;
    const usuario = gv(row, map.usuario);
    const nombre = gv(row, map.nombre).replace(/\s+/g, ' ');
    const apellidos = gv(row, map.apellidos).replace(/\s+/g, ' ');
    const iniRaw = gv(row, map.inicio);
    if (!usuario && !nombre && !iniRaw) continue;

    const finRaw = gv(row, map.fin);
    const hrsRaw = gv(row, map.horas);
    const startDt = parseDateTime(iniRaw);
    const endDt = parseDateTime(finRaw);
    const durationMin = parseDurationMin(hrsRaw, startDt, endDt);
    const tipo = gv(row, map.tipo) || 'No Justificadas';
    const motivo = gv(row, map.motivo) || 'Ausencia';
    const isJustificada = /^justificada/i.test(normalizeKey(tipo));
    const recuperarRaw = gv(row, map.recuperar).toUpperCase();
    const recuperarH = recuperarRaw === 'SI' ? 'SI' : (recuperarRaw === 'NO' ? 'NO' : recuperarRaw);
    const fecha = startDt ? formatDateKey(startDt) : (endDt ? formatDateKey(endDt) : '');
    const fullName = `${nombre} ${apellidos}`.trim() || `Usuario ${usuario}`;
    const opKey = usuario || gv(row, map.matricula).toLowerCase() || fullName;

    records.push({
      sourceKind: 'NO_PRESENCIAL',
      isNoPresencial: true,
      isJustificada,
      recuperarH,
      shortLabel: shortMotivoNP(motivo, isJustificada),
      opKey, usuario, matricula: gv(row, map.matricula), nombre, apellidos, fullName, dni: gv(row, map.dni),
      tipo, subTipo: '', servicio: '-', motivo, obs: gv(row, map.obs),
      conexionStr: startDt ? `${fecha} ${formatTime(startDt)}` : iniRaw,
      desconexionStr: endDt ? `${formatDateKey(endDt)} ${formatTime(endDt)}` : finRaw,
      startTimeStr: formatTime(startDt),
      endTimeStr: formatTime(endDt),
      startMs: startDt ? startDt.getTime() : null,
      endMs: endDt ? endDt.getTime() : null,
      fecha, fechaSort: dateKeyToSort(fecha),
      horasStr: hrsRaw || (fmtClock(durationMin) + ':00'),
      durationMin, cerrado: 'SI',
      usuarioEdit: '', fechaEdit: '',
      isOpen: false,
      isProductive: false,
      isNonProd: false,
      stateKey: isJustificada ? 'NP_JUSTIFICADA' : 'NP_NO_JUSTIFICADA'
    });
  }
  return records;
}

function parseAnyMatrix(matrix, forcedKind = null) {
  const kind = forcedKind || detectDatasetKind(matrix);
  const records = kind === 'NO_PRESENCIAL' ? matrixToNoPresencialRecords(matrix) : matrixToRecords(matrix);
  return { kind, records };
}

// Determina si un operador pertenece a GOAT o ATEMP según sus registros en el dataset
function computeOperatorCampaignMap(records) {
  const hasGoat = new Set();
  for (const r of records) {
    if (r.servicio === 'GOAT') hasGoat.add(r.opKey);
  }
  return hasGoat;
}

// Clasifica turno REAL (NOCTURNO vs DIURNO) basado en el horario real de la jornada:
// Todos los de 00:00–05:59 (ej. 01:00 a 11:00) son NOCTURNOS; los de 06:00+ (ej. 07:00 a 15:00) son DIURNOS.
// Ignora los 1-5 min de H. No Pagables post-turno (11:00->11:01) que el CSV etiqueta como H. Diurnas.
function classifyShiftTurno(normalRecs, dayStartMs) {
  const jornada = normalRecs.filter(r => r.tipo === 'H. Jornada' && r.startMs !== null);
  const pool = jornada.length ? jornada : normalRecs.filter(r => r.startMs !== null);
  if (!pool.length) return 'DIURNO';

  let earlyMin = 0; // minutos trabajados entre 00:00 y 06:00
  let longestRec = pool[0];
  let noctSubMin = 0, diurnSubMin = 0;

  for (const r of pool) {
    const dur = Math.max(1, r.durationMin);
    if (dur > Math.max(1, longestRec.durationMin)) longestRec = r;
    const sMin = Math.max(0, (r.startMs - dayStartMs) / 60000);
    const eMin = r.endMs !== null && r.endMs > r.startMs
      ? Math.min(1440, (r.endMs - dayStartMs) / 60000)
      : Math.min(1440, sMin + r.durationMin);
    // Solapamiento con la franja de madrugada 00:00 - 06:00 (0 a 360 min)
    if (sMin < 360) {
      earlyMin += Math.max(0, Math.min(360, eMin) - sMin);
    }
    if (/nocturna/i.test(r.subTipo)) noctSubMin += dur;
    else if (/diurna/i.test(r.subTipo)) diurnSubMin += dur;
  }

  const longestStartMin = (longestRec.startMs - dayStartMs) / 60000;

  // Regla clara:
  // 1) Si trabajó >= 30 min en madrugada (00:00-06:00) -> NOCTURNO (cubre todos los 1am-11am)
  if (earlyMin >= 30) return 'NOCTURNO';
  // 2) Si su bloque principal inicia antes de las 05:30 AM -> NOCTURNO
  if (longestStartMin < 330) return 'NOCTURNO';
  // 3) Si inicia a las 06:00 AM o después y no trabajó madrugada:
  //    salvo que su turno completo esté marcado H. Nocturnas y termine antes de las 11:30 (ej. ingreso tardío nocturno)
  const lastEndMin = Math.max(...pool.map(r => r.endMs ? (r.endMs - dayStartMs) / 60000 : ((r.startMs - dayStartMs) / 60000 + r.durationMin)));
  if (noctSubMin > diurnSubMin && lastEndMin <= 690) return 'NOCTURNO';

  return 'DIURNO';
}

function buildOperatorDayRows(presRecords, npRecords, minGap) {
  const allInput = [...(presRecords || []), ...(npRecords || [])];
  const goatOps = computeOperatorCampaignMap(presRecords || []);
  const presencialDates = new Set((presRecords || []).map(r => r.fecha).filter(Boolean));
  const groups = new Map();

  for (const r of allInput) {
    if (!r.fecha) continue;
    const key = `${r.opKey}__${r.fecha}`;
    if (!groups.has(key)) {
      groups.set(key, {
        rowKey: key, opKey: r.opKey, usuario: r.usuario, matricula: r.matricula,
        fullName: r.fullName, dni: r.dni, fecha: r.fecha, fechaSort: r.fechaSort,
        servicios: new Set(), presRecords: [], npRecords: [], records: []
      });
    }
    const g = groups.get(key);
    if (!g.usuario && r.usuario) g.usuario = r.usuario;
    if (!g.matricula && r.matricula) g.matricula = r.matricula;
    if (!g.dni && r.dni) g.dni = r.dni;
    if (r.isNoPresencial) g.npRecords.push(r);
    else g.presRecords.push(r);
    g.records.push(r);
    if (r.servicio && r.servicio !== '-') g.servicios.add(r.servicio);
  }

  // Pre-pasada: turno habitual por operador (a partir de sus jornadas presenciales o ausencias completas >=5h)
  const opTurnoVotes = new Map(); // opKey -> { NOCTURNO: n, DIURNO: n }
  for (const g of groups.values()) {
    const p = g.fecha.split('/');
    const dayStartMs = p.length === 3 ? new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10), 0, 0, 0).getTime() : 0;
    let voteTurno = null, weight = 1;
    if (g.presRecords.length) {
      const pRecs = g.presRecords.slice().sort((a, b) => ((a.startMs || 0) - (b.startMs || 0)));
      const jRecs = pRecs.filter(r => r.tipo === 'H. Jornada');
      const fp = (jRecs.length ? jRecs : pRecs).find(r => r.startMs !== null);
      const normP = pRecs.filter(r => {
        if (r.startMs === null) return true;
        const sMin = (r.startMs - dayStartMs) / 60000;
        return !(r.tipo === 'H. No Pagables' && sMin >= 1380 && fp && ((fp.startMs - dayStartMs) / 60000) < 720);
      });
      voteTurno = classifyShiftTurno(normP, dayStartMs);
      weight = 3; // peso fuerte a jornadas presenciales reales
    } else {
      const npMin = g.npRecords.reduce((s, r) => s + r.durationMin, 0);
      if (npMin >= 300) {
        voteTurno = classifyShiftTurno(g.npRecords, dayStartMs);
        weight = 1;
      }
    }
    if (voteTurno) {
      if (!opTurnoVotes.has(g.opKey)) opTurnoVotes.set(g.opKey, { NOCTURNO: 0, DIURNO: 0 });
      opTurnoVotes.get(g.opKey)[voteTurno] += weight;
    }
  }
  const opDefaultTurnoMap = new Map();
  for (const [opKey, v] of opTurnoVotes.entries()) {
    opDefaultTurnoMap.set(opKey, v.NOCTURNO > v.DIURNO ? 'NOCTURNO' : 'DIURNO');
  }

  // PASADA 1: Preprocesar cada operador-día e inferir su horario habitual (inicio, fin y horas laborales)
  const prepared = [];
  const schedBuckets = new Map(); // `${opKey}__${turnoReal}` -> [{ rs, re, dur }]
  const fallbackSchedBuckets = new Map(); // desde ausencias completas >=5h

  for (const g of groups.values()) {
    g.presRecords.sort((a, b) => ((a.startMs || 0) - (b.startMs || 0)) || ((a.endMs || 0) - (b.endMs || 0)));
    g.npRecords.sort((a, b) => ((a.startMs || 0) - (b.startMs || 0)) || ((a.endMs || 0) - (b.endMs || 0)));
    g.records.sort((a, b) => ((a.startMs || 0) - (b.startMs || 0)) || ((a.endMs || 0) - (b.endMs || 0)));

    const p = g.fecha.split('/');
    const dayStartMs = p.length === 3 ? new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10), 0, 0, 0).getTime() : 0;

    const hasPresencial = g.presRecords.length > 0;
    const hasNoPresencial = g.npRecords.length > 0;
    const onlyNoPresencial = !hasPresencial && hasNoPresencial;

    const jornadaRecs = g.presRecords.filter(r => r.tipo === 'H. Jornada');
    const primaryRecs = jornadaRecs.length ? jornadaRecs : (hasPresencial ? g.presRecords : g.npRecords);
    const firstPrimary = primaryRecs.find(r => r.startMs !== null);

    // Excluir pre-login nocturno de las 23:5x que corresponde al turno del día siguiente (solo presenciales)
    const normalRecs = g.presRecords.filter(r => {
      if (r.startMs === null) return true;
      const sMin = (r.startMs - dayStartMs) / 60000;
      if (r.tipo === 'H. No Pagables' && sMin >= 1380 && firstPrimary && ((firstPrimary.startMs - dayStartMs) / 60000) < 720) {
        return false;
      }
      return true;
    });

    let turnoReal = 'DIURNO';
    if (hasPresencial) {
      turnoReal = classifyShiftTurno(normalRecs, dayStartMs);
    } else {
      const totalNpMin = g.npRecords.reduce((s, r) => s + r.durationMin, 0);
      if (totalNpMin >= 300) {
        turnoReal = classifyShiftTurno(g.npRecords, dayStartMs);
      } else if (opDefaultTurnoMap.has(g.opKey)) {
        turnoReal = opDefaultTurnoMap.get(g.opKey);
      } else {
        const maxNpEnd = Math.max(...g.npRecords.map(r => r.endMs ? (r.endMs - dayStartMs) / 60000 : 9999));
        turnoReal = maxNpEnd <= 665 ? 'NOCTURNO' : classifyShiftTurno(g.npRecords, dayStartMs);
      }
    }

    const isSup = isSupervisorRecord(g.usuario, g.fullName);
    const isGoat = g.servicios.has('GOAT') || goatOps.has(g.opKey);
    const campana = isSup ? 'SUPERVISION' : (isGoat ? 'GOAT' : 'ATEMP');
    const groupId = isSup
      ? (turnoReal === 'NOCTURNO' ? 'SUP_NOCTURNO' : 'SUP_DIURNO')
      : (campana === 'GOAT'
        ? (turnoReal === 'NOCTURNO' ? 'NOCHE_GOAT' : 'DIA_GOAT')
        : (turnoReal === 'NOCTURNO' ? 'NOCTURNO_ATEMP' : 'DIURNO_ATEMP'));

    // Inicio/fin efectivos presenciales
    const shiftRecs = normalRecs.filter(r => {
      if (r.startMs === null) return false;
      const sMin = (r.startMs - dayStartMs) / 60000;
      if (turnoReal === 'DIURNO' && sMin < 300 && r.durationMin < 30) return false;
      return true;
    });
    const shiftJornada = shiftRecs.filter(r => r.tipo === 'H. Jornada');
    const effPool = shiftJornada.length ? shiftJornada : shiftRecs;

    let effStartMin = null, effEndMin = null;
    for (const r of effPool) {
      const sM = (r.startMs - dayStartMs) / 60000;
      const eM = (r.endMs !== null && r.endMs > r.startMs) ? (r.endMs - dayStartMs) / 60000 : (sM + r.durationMin);
      if (effStartMin === null || sM < effStartMin) effStartMin = sM;
      if (effEndMin === null || eM > effEndMin) effEndMin = eM;
    }
    let connStartMin = effStartMin, connEndMin = effEndMin;
    for (const r of shiftRecs) {
      const sM = (r.startMs - dayStartMs) / 60000;
      const eM = (r.endMs !== null && r.endMs > r.startMs) ? (r.endMs - dayStartMs) / 60000 : (sM + r.durationMin);
      if (connStartMin === null || sM < connStartMin) connStartMin = sM;
      if (connEndMin === null || eM > connEndMin) connEndMin = eM;
    }

    // Inicio/fin de bloques No Presenciales
    let npStartMin = null, npEndMin = null;
    for (const r of g.npRecords) {
      if (r.startMs === null) continue;
      const sM = (r.startMs - dayStartMs) / 60000;
      const eM = (r.endMs !== null && r.endMs > r.startMs) ? (r.endMs - dayStartMs) / 60000 : (sM + r.durationMin);
      if (npStartMin === null || sM < npStartMin) npStartMin = sM;
      if (npEndMin === null || eM > npEndMin) npEndMin = eM;
    }

    // Acumular muestras limpias para inferir el horario habitual
    if (hasPresencial && effStartMin !== null && effEndMin !== null && effEndMin <= 1080) {
      // Si hubo salida anticipada cubierta por NP, usar fin unificado para inferir bien su turno habitual
      const fullS = (npStartMin !== null && npStartMin < effStartMin) ? npStartMin : effStartMin;
      const fullE = (npEndMin !== null && npEndMin > effEndMin) ? npEndMin : effEndMin;
      const dur = fullE - fullS;
      if (dur >= 120 && dur <= 720) {
        const bKey = `${g.opKey}__${turnoReal}`;
        if (!schedBuckets.has(bKey)) schedBuckets.set(bKey, []);
        const rs = Math.round(fullS / 60) * 60;
        const re = Math.round(fullE / 60) * 60;
        if (re > rs) schedBuckets.get(bKey).push({ rs, re, dur });
      }
    } else if (onlyNoPresencial && npStartMin !== null && npEndMin !== null && npEndMin <= 1080) {
      const dur = npEndMin - npStartMin;
      if (dur >= 300 && dur <= 720) {
        const bKey = `${g.opKey}__${turnoReal}`;
        if (!fallbackSchedBuckets.has(bKey)) fallbackSchedBuckets.set(bKey, []);
        const rs = Math.round(npStartMin / 60) * 60;
        const re = Math.round(npEndMin / 60) * 60;
        if (re > rs) fallbackSchedBuckets.get(bKey).push({ rs, re, dur });
      }
    }

    prepared.push({
      g, dayStartMs, hasPresencial, hasNoPresencial, onlyNoPresencial,
      jornadaRecs, primaryRecs, firstPrimary, normalRecs, shiftRecs,
      turnoReal, isSup, campana, groupId,
      effStartMin, effEndMin, connStartMin, connEndMin, npStartMin, npEndMin
    });
  }

  function inferSchedMap(buckets) {
    const out = new Map();
    for (const [bKey, list] of buckets.entries()) {
      const turnoReal = bKey.split('__').pop();
      const sCounts = new Map(), eCounts = new Map();
      for (const it of list) {
        sCounts.set(it.rs, (sCounts.get(it.rs) || 0) + 1);
        eCounts.set(it.re, (eCounts.get(it.re) || 0) + 1);
      }
      let expStart = [...sCounts.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))[0][0];
      let expEnd = [...eCounts.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]))[0][0];
      if (turnoReal === 'NOCTURNO') {
        if (list.length <= 2 && expStart <= 120) expStart = 60;
        if (list.length <= 2 && expEnd < 660) expEnd = 660;
      }
      if (expEnd <= expStart) {
        expStart = turnoReal === 'NOCTURNO' ? 60 : 420;
        expEnd = turnoReal === 'NOCTURNO' ? 660 : 900;
      }
      const hrs = Math.round(((expEnd - expStart) / 60) * 10) / 10;
      const sH = String(Math.floor(expStart / 60)).padStart(2, '0');
      const eH = String(Math.floor(expEnd / 60)).padStart(2, '0');
      out.set(bKey, { startMin: expStart, endMin: expEnd, hours: hrs, label: `${hrs}h (${sH}–${eH}h)` });
    }
    return out;
  }

  const scheduleMap = inferSchedMap(schedBuckets);
  const fallbackSchedMap = inferSchedMap(fallbackSchedBuckets);

  // PASADA 2: Construir filas finales unificadas (Presencial + No Presencial + huecos restantes sin registro)
  const edgeThreshold = Math.max(minGap, 10);
  const dayRows = [];

  for (const item of prepared) {
    const {
      g, dayStartMs, hasPresencial, hasNoPresencial, onlyNoPresencial,
      jornadaRecs, primaryRecs, firstPrimary, normalRecs, shiftRecs,
      turnoReal, isSup, campana, groupId,
      connStartMin, connEndMin, npStartMin, npEndMin
    } = item;

    const bKey = `${g.opKey}__${turnoReal}`;
    const sched = scheduleMap.get(bKey) || fallbackSchedMap.get(bKey) || (turnoReal === 'NOCTURNO'
      ? { startMin: 60, endMin: 660, hours: 10, label: '10h (01–11h)' }
      : { startMin: 420, endMin: 900, hours: 8, label: '8h (07–15h)' });

    // Inicio y Fin reales mostrados
    let lastPrimaryEndMs = null;
    for (const r of primaryRecs) {
      if (r.endMs !== null && (lastPrimaryEndMs === null || r.endMs > lastPrimaryEndMs)) lastPrimaryEndMs = r.endMs;
    }
    const firstLog = normalRecs.find(r => r.startMs !== null) || g.presRecords.find(r => r.startMs !== null) || g.npRecords.find(r => r.startMs !== null);
    let lastLogEndMs = null;
    for (const r of (hasPresencial ? normalRecs : g.npRecords)) {
      if (r.endMs !== null && (lastLogEndMs === null || r.endMs > lastLogEndMs)) lastLogEndMs = r.endMs;
    }

    const startTime = firstPrimary ? formatTime(new Date(firstPrimary.startMs)) : (firstLog ? formatTime(new Date(firstLog.startMs)) : '—');
    const endTime = lastPrimaryEndMs ? formatTime(new Date(lastPrimaryEndMs)) : (lastLogEndMs ? formatTime(new Date(lastLogEndMs)) : '');
    const endNextDay = !!(lastPrimaryEndMs && formatDateKey(new Date(lastPrimaryEndMs)) !== g.fecha);
    const logStartTime = firstLog ? formatTime(new Date(firstLog.startMs)) : '';
    const logEndTime = lastLogEndMs ? formatTime(new Date(lastLogEndMs)) : '';
    const hasPrePost = hasPresencial && ((logStartTime && logStartTime !== startTime) || (logEndTime && endTime && logEndTime !== endTime));
    const npTimeRange = (hasPresencial && hasNoPresencial && npStartMin !== null && npEndMin !== null)
      ? `${fmtClock(npStartMin)}–${fmtClock(npEndMin)}`
      : '';

    // 1) Desconexiones intra-jornada (huecos reales NO cubiertos por Presencial ni por No Presencial)
    const gaps = [];
    if (hasPresencial) {
      const coveragePool = [...normalRecs, ...g.npRecords]
        .filter(r => r.startMs !== null)
        .sort((a, b) => (a.startMs - b.startMs) || ((a.endMs || 0) - (b.endMs || 0)));

      let maxEndMs = null, maxEndRec = null;
      for (const r of coveragePool) {
        if (maxEndMs !== null && r.startMs > maxEndMs) {
          const gapMin = Math.round((r.startMs - maxEndMs) / 60000);
          if (gapMin >= minGap && gapMin <= MAX_INTRA_SHIFT_GAP_MIN) {
            gaps.push({
              type: 'gap',
              startMs: maxEndMs, endMs: r.startMs,
              startTime: formatTime(new Date(maxEndMs)),
              endTime: formatTime(new Date(r.startMs)),
              durationMin: gapMin,
              prevState: maxEndRec.isNoPresencial ? maxEndRec.shortLabel : getStateStyle(maxEndRec.stateKey).short,
              nextState: r.isNoPresencial ? r.shortLabel : getStateStyle(r.stateKey).short
            });
          }
        }
        const effEnd = r.endMs !== null ? r.endMs : (r.durationMin > 0 ? r.startMs + r.durationMin * 60000 : r.startMs);
        if (maxEndMs === null || effEnd > maxEndMs) { maxEndMs = effEnd; maxEndRec = r; }
      }
    }

    // 2) Salida anticipada & 3) Ingreso tardío SIN registro (conciliado con No Presenciales)
    // Solo se evalúa en jornadas con registro presencial (evita falsos positivos en días solo-ausencia o sin archivo presencial)
    let earlyExit = null;
    let lateEntry = null;
    if (hasPresencial) {
      const coveredEndMin = (connEndMin !== null && npEndMin !== null) ? Math.max(connEndMin, npEndMin) : (connEndMin !== null ? connEndMin : npEndMin);
      const coveredStartMin = (connStartMin !== null && npStartMin !== null) ? Math.min(connStartMin, npStartMin) : (connStartMin !== null ? connStartMin : npStartMin);

      if (coveredEndMin !== null && coveredEndMin < sched.endMin) {
        const diffOut = Math.round(sched.endMin - coveredEndMin);
        if (diffOut >= edgeThreshold && diffOut <= 540) {
          const sMs = dayStartMs + Math.round(coveredEndMin) * 60000;
          const eMs = dayStartMs + sched.endMin * 60000;
          earlyExit = {
            type: 'early_exit',
            startMs: sMs, endMs: eMs,
            sMin: coveredEndMin, eMin: sched.endMin,
            startTime: fmtClock(coveredEndMin),
            endTime: fmtClock(sched.endMin),
            durationMin: diffOut
          };
        }
      }

      if (coveredStartMin !== null && coveredStartMin > sched.startMin) {
        const diffIn = Math.round(coveredStartMin - sched.startMin);
        if (diffIn >= edgeThreshold && diffIn <= 480) {
          const sMs = dayStartMs + sched.startMin * 60000;
          const eMs = dayStartMs + Math.round(coveredStartMin) * 60000;
          lateEntry = {
            type: 'late_entry',
            startMs: sMs, endMs: eMs,
            sMin: sched.startMin, eMin: coveredStartMin,
            startTime: fmtClock(sched.startMin),
            endTime: fmtClock(coveredStartMin),
            durationMin: diffIn
          };
        }
      }
    }

    // Métricas y bloques unificados de la línea de tiempo
    let prodMin = 0, nonProdMin = 0, noPagMin = 0, openCount = 0;
    let npJustMin = 0, npNoJustMin = 0, hasRecuperarSi = false;
    const nonProdMap = new Map();
    const npBadgeMap = new Map();
    const presentStates = new Set();
    const timelineItems = [];
    let maxVisMin = sched.endMin;

    for (const r of g.presRecords) {
      presentStates.add(r.stateKey);
      if (r.isProductive) prodMin += r.durationMin;
      else if (r.isNonProd) {
        nonProdMin += r.durationMin;
        if (!nonProdMap.has(r.stateKey)) nonProdMap.set(r.stateKey, { stateKey: r.stateKey, minutes: 0, count: 0 });
        const entry = nonProdMap.get(r.stateKey);
        entry.minutes += r.durationMin;
        entry.count++;
      } else if (r.tipo === 'H. No Pagables') noPagMin += r.durationMin;

      if (r.isOpen) { openCount++; presentStates.add('SIN_CERRAR'); }

      if (r.startMs !== null) {
        const sMin = Math.max(0, (r.startMs - dayStartMs) / 60000);
        const eMin = (r.endMs !== null && r.endMs > r.startMs)
          ? Math.min(1440, (r.endMs - dayStartMs) / 60000)
          : Math.min(1440, sMin + (r.durationMin > 0 ? r.durationMin : 3));
        if (eMin > maxVisMin && sMin < 1380) maxVisMin = eMin;

        timelineItems.push({
          kind: 'record', stateKey: r.stateKey,
          startMs: r.startMs, endMs: r.endMs, sMin, eMin,
          startTime: r.startTimeStr,
          endTime: r.endTimeStr || (r.isOpen ? 'ABIERTA' : r.startTimeStr),
          endNextDay: !!(r.endMs && formatDateKey(new Date(r.endMs)) !== g.fecha),
          durationMin: r.durationMin, servicio: r.servicio, tipo: r.tipo,
          isOpen: r.isOpen, obs: r.obs, usuarioEdit: r.usuarioEdit
        });
      }
    }

    for (const r of g.npRecords) {
      presentStates.add(r.stateKey);
      if (r.isJustificada) npJustMin += r.durationMin;
      else npNoJustMin += r.durationMin;
      if (r.recuperarH === 'SI') hasRecuperarSi = true;

      const bk = `${r.stateKey}__${r.motivo}`;
      if (!npBadgeMap.has(bk)) {
        npBadgeMap.set(bk, {
          stateKey: r.stateKey, isJustificada: r.isJustificada,
          motivo: r.motivo, shortLabel: r.shortLabel,
          minutes: 0, count: 0, recuperarSi: false
        });
      }
      const be = npBadgeMap.get(bk);
      be.minutes += r.durationMin;
      be.count++;
      if (r.recuperarH === 'SI') be.recuperarSi = true;

      if (r.startMs !== null) {
        const sMin = Math.max(0, (r.startMs - dayStartMs) / 60000);
        const eMin = (r.endMs !== null && r.endMs > r.startMs)
          ? Math.min(1440, (r.endMs - dayStartMs) / 60000)
          : Math.min(1440, sMin + (r.durationMin > 0 ? r.durationMin : 15));
        if (eMin > maxVisMin && sMin < 1380) maxVisMin = eMin;

        timelineItems.push({
          kind: 'np_record', stateKey: r.stateKey,
          isJustificada: r.isJustificada,
          tipo: r.tipo, motivo: r.motivo, shortLabel: r.shortLabel,
          recuperarH: r.recuperarH,
          startMs: r.startMs, endMs: r.endMs, sMin, eMin,
          startTime: r.startTimeStr,
          endTime: r.endTimeStr || r.startTimeStr,
          endNextDay: !!(r.endMs && formatDateKey(new Date(r.endMs)) !== g.fecha),
          durationMin: r.durationMin, isOpen: false, obs: r.obs
        });
      }
    }

    let gapMin = 0;
    for (const gp of gaps) {
      gapMin += gp.durationMin;
      presentStates.add('DESCONEXION');
      timelineItems.push({
        kind: 'gap', stateKey: 'DESCONEXION',
        startMs: gp.startMs, endMs: gp.endMs,
        sMin: Math.max(0, (gp.startMs - dayStartMs) / 60000),
        eMin: Math.min(1440, (gp.endMs - dayStartMs) / 60000),
        startTime: gp.startTime, endTime: gp.endTime, durationMin: gp.durationMin,
        prevState: gp.prevState, nextState: gp.nextState,
        obs: `Desconexión sin registro entre ${gp.prevState} (${gp.startTime}) y ${gp.nextState} (${gp.endTime})`
      });
    }

    if (earlyExit) {
      presentStates.add('SALIDA_ANTICIPADA');
      timelineItems.push({
        kind: 'early_exit', stateKey: 'SALIDA_ANTICIPADA',
        startMs: earlyExit.startMs, endMs: earlyExit.endMs,
        sMin: earlyExit.sMin, eMin: earlyExit.eMin,
        startTime: earlyExit.startTime, endTime: earlyExit.endTime,
        durationMin: earlyExit.durationMin,
        obs: `Desconexión anticipada sin registro ni justificación · Su horario habitual es ${sched.label}`
      });
    }

    if (lateEntry) {
      presentStates.add('INGRESO_TARDIO');
      timelineItems.push({
        kind: 'late_entry', stateKey: 'INGRESO_TARDIO',
        startMs: lateEntry.startMs, endMs: lateEntry.endMs,
        sMin: lateEntry.sMin, eMin: lateEntry.eMin,
        startTime: lateEntry.startTime, endTime: lateEntry.endTime,
        durationMin: lateEntry.durationMin,
        obs: `Ingreso tardío sin registro previo ni justificación · Su horario habitual es ${sched.label}`
      });
    }

    const npTotalMin = npJustMin + npNoJustMin;
    const alertMin = gapMin + (earlyExit ? earlyExit.durationMin : 0) + (lateEntry ? lateEntry.durationMin : 0);
    const alertCount = gaps.length + (earlyExit ? 1 : 0) + (lateEntry ? 1 : 0);

    timelineItems.sort((a, b) => (a.startMs - b.startMs) || (a.kind === 'record' ? -1 : 1));
    const startMinSort = firstPrimary && firstPrimary.startMs !== null ? (firstPrimary.startMs - dayStartMs) / 60000 : 9999;

    dayRows.push({
      rowKey: g.rowKey, opKey: g.opKey, usuario: g.usuario, matricula: g.matricula,
      fullName: g.fullName, dni: g.dni, fecha: g.fecha, fechaSort: g.fechaSort,
      turnoReal, isSup, campana, groupId,
      sched,
      hasPresencial, hasNoPresencial, onlyNoPresencial,
      isPresencialDate: presencialDates.has(g.fecha),
      startTime, endTime, endNextDay, logStartTime, logEndTime, hasPrePost, npTimeRange,
      onlyNoPagable: hasPresencial && jornadaRecs.length === 0,
      startMinSort, prodMin, nonProdMin, noPagMin,
      npJustMin, npNoJustMin, npTotalMin, hasRecuperarSi,
      npList: [...npBadgeMap.values()].sort((a, b) => b.minutes - a.minutes),
      gapMin, gapCount: gaps.length, gaps,
      earlyExit, lateEntry,
      alertMin, alertCount,
      openCount,
      nonProdList: [...nonProdMap.values()].sort((a, b) => b.minutes - a.minutes),
      presentStates, timelineItems, records: g.records, presRecords: g.presRecords, npRecords: g.npRecords, maxVisMin,
      searchHay: normalizeKey(
        `${g.usuario} ${g.matricula} ${g.fullName} ${g.dni} ${g.fecha} ${campana} ${turnoReal} ${sched.label} ` +
        (onlyNoPresencial ? 'ausente no presencial ' : '') +
        (hasNoPresencial ? 'no presencial ' : '') +
        (hasRecuperarSi ? 'recuperar ' : '') +
        g.records.map(r => `${r.tipo} ${r.motivo} ${r.recuperarH || ''} ${r.obs}`).join(' ')
      )
    });
  }
  return dayRows;
}
