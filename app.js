'use strict';

// CARGA DUAL, PERSISTENCIA Y GUARDADO
function saveStorage(presRecs, npRecs, meta) {
  try {
    const compactP = (presRecs || []).map(r => [r.usuario, r.matricula, r.nombre, r.apellidos, r.dni, r.tipo, r.subTipo, r.servicio, '', r.motivo, r.obs, r.conexionStr, r.desconexionStr, r.horasStr, r.cerrado, r.usuarioEdit, r.fechaEdit]);
    const compactNP = (npRecs || []).map(r => [r.usuario, r.matricula, r.nombre, r.apellidos, r.dni, r.tipo, r.motivo, r.conexionStr, r.desconexionStr, r.horasStr, r.recuperarH, r.obs]);
    localStorage.setItem(STORAGE_KEY_P, JSON.stringify(compactP));
    localStorage.setItem(STORAGE_KEY_NP, JSON.stringify(compactNP));
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {}
}

function loadStorage() {
  try {
    const rawP = localStorage.getItem(STORAGE_KEY_P);
    const rawNP = localStorage.getItem(STORAGE_KEY_NP);
    if (!rawP && !rawNP) return null;
    const compactP = rawP ? JSON.parse(rawP) : [];
    const compactNP = rawNP ? JSON.parse(rawNP) : [];
    if ((!Array.isArray(compactP) || !compactP.length) && (!Array.isArray(compactNP) || !compactNP.length)) return null;
    const headerP = ['Usuario', 'Matrícula', 'Nombre', 'Apellidos', 'DNI', 'Tipo', 'SubTipo', 'Servicio', 'Tarea', 'Motivo no productivo', 'Observaciones', 'Conexión', 'Desconexión', 'Horas', 'Cerrado', 'Usuario Edit', 'Fecha Edit'];
    const headerNP = ['Usuario', 'Matrícula', 'Nombre', 'Apellidos', 'DNI', 'Tipo', 'Motivo', 'Inicio', 'Fin', 'Horas', 'Recuperar H.', 'Observaciones'];
    return {
      presencial: Array.isArray(compactP) && compactP.length ? matrixToRecords([headerP, ...compactP]) : [],
      noPresencial: Array.isArray(compactNP) && compactNP.length ? matrixToNoPresencialRecords([headerNP, ...compactNP]) : [],
      meta: JSON.parse(localStorage.getItem(META_KEY) || '{}')
    };
  } catch { return null; }
}

function applyDatasets(presRecs, npRecs, meta, persist = true) {
  state.presencialRecords = presRecs || [];
  state.noPresencialRecords = npRecs || [];
  state.meta = {
    pSource: meta?.pSource || '',
    npSource: meta?.npSource || ''
  };
  state.expandedKeys.clear();
  state.filters.fecha = 'LATEST';
  state.filters.selectedStates.clear();
  if (persist) saveStorage(state.presencialRecords, state.noPresencialRecords, state.meta);
  recompute();
}

async function loadBaseCSV(force = false) {
  if (!force) {
    const cached = loadStorage();
    if (cached && (cached.presencial.length || cached.noPresencial.length)) {
      applyDatasets(cached.presencial, cached.noPresencial, cached.meta, false);
      return;
    }
  }
  const bust = '?t=' + Date.now();
  let pres = [], np = [], pSrc = '', npSrc = '';
  await Promise.all([
    fetch('./datos_iniciales.csv' + bust).then(async res => {
      if (!res.ok) return;
      const parsed = matrixToRecords(parseCSV(await res.text()));
      if (parsed.length) { pres = parsed; pSrc = 'datos_iniciales.csv'; }
    }).catch(() => {}),
    fetch('./datos_no_presenciales.csv' + bust).then(async res => {
      if (!res.ok) return;
      const parsed = matrixToNoPresencialRecords(parseCSV(await res.text()));
      if (parsed.length) { np = parsed; npSrc = 'datos_no_presenciales.csv'; }
    }).catch(() => {})
  ]);

  if (pres.length || np.length) {
    localStorage.removeItem(STORAGE_KEY_P);
    localStorage.removeItem(STORAGE_KEY_NP);
    localStorage.removeItem(META_KEY);
    applyDatasets(pres, np, { pSource: pSrc, npSource: npSrc }, false);
    if (force) {
      showBanner(`Base restaurada: ${pres.length.toLocaleString('es-PE')} presenciales + ${np.length.toLocaleString('es-PE')} no presenciales.`, 'ok');
    }
  } else {
    showBanner('Haz clic en "Subir Excel (1 o 2)" o arrastra ambos archivos sobre la pantalla.', 'warn');
    recompute();
  }
}

async function readFileToMatrix(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv' || ext === 'txt') return parseCSV(await file.text());
  if (ext === 'xlsx' || ext === 'xls') {
    if (typeof XLSX === 'undefined') throw new Error('Sin conexión para leer Excel; usa .csv.');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  }
  throw new Error(`Formato no soportado (${ext})`);
}

function mergeUnique(existing, incoming, keyFn) {
  const seen = new Set(existing.map(keyFn));
  const out = existing.slice();
  let added = 0;
  for (const r of incoming) {
    const k = keyFn(r);
    if (!seen.has(k)) { seen.add(k); out.push(r); added++; }
  }
  return { list: out, added };
}

function summarizeRange(records) {
  const dates = [...new Set(records.map(r => r.fecha).filter(Boolean))].sort((a, b) => dateKeyToSort(a) - dateKeyToSort(b));
  if (!dates.length) return '';
  return dates.length === 1 ? dates[0] : `${dates[0]} al ${dates[dates.length - 1]}`;
}

function commitIncomingDatasets(incP, incNP, pNames, npNames, mode) {
  let finalP = state.presencialRecords;
  let finalNP = state.noPresencialRecords;
  let pSrc = state.meta.pSource;
  let npSrc = state.meta.npSource;
  const msgs = [];

  if (incP && incP.length) {
    if (mode === 'merge' && state.presencialRecords.length) {
      const res = mergeUnique(state.presencialRecords, incP, r => [r.usuario, r.conexionStr, r.desconexionStr, r.tipo, r.motivo, r.horasStr].join('|'));
      finalP = res.list;
      pSrc = pSrc ? `${pSrc} + ${pNames.join(', ')}` : pNames.join(', ');
      msgs.push(`Presenciales: +${res.added.toLocaleString('es-PE')} nuevos`);
    } else {
      finalP = incP;
      pSrc = pNames.join(', ');
      msgs.push(`Presenciales: ${finalP.length.toLocaleString('es-PE')} reg.`);
    }
  }
  if (incNP && incNP.length) {
    if (mode === 'merge' && state.noPresencialRecords.length) {
      const res = mergeUnique(state.noPresencialRecords, incNP, r => [r.usuario, r.conexionStr, r.desconexionStr, r.tipo, r.motivo, r.horasStr].join('|'));
      finalNP = res.list;
      npSrc = npSrc ? `${npSrc} + ${npNames.join(', ')}` : npNames.join(', ');
      msgs.push(`No Presenciales: +${res.added.toLocaleString('es-PE')} nuevos`);
    } else {
      finalNP = incNP;
      npSrc = npNames.join(', ');
      msgs.push(`No Presenciales: ${finalNP.length.toLocaleString('es-PE')} reg.`);
    }
  }
  applyDatasets(finalP, finalNP, { pSource: pSrc, npSource: npSrc }, true);
  showBanner(`Datos unificados correctamente · ${msgs.join(' · ')}.`, 'ok');
}

// Carga directa (drag & drop global sobre la ventana)
async function handleFiles(filesList) {
  const files = Array.from(filesList || []);
  if (!files.length) return;
  const mode = $('upload-mode').value;
  let incP = [], incNP = [], pNames = [], npNames = [];

  for (const f of files) {
    try {
      const matrix = await readFileToMatrix(f);
      const { kind, records } = parseAnyMatrix(matrix);
      if (!records.length) { showBanner(`Sin registros válidos en ${f.name}.`, 'warn'); continue; }
      if (kind === 'NO_PRESENCIAL') { incNP = incNP.concat(records); npNames.push(f.name); }
      else { incP = incP.concat(records); pNames.push(f.name); }
    } catch (err) {
      showBanner(`Error leyendo ${f.name}: ${err.message}`, 'err');
      return;
    }
  }
  if (!incP.length && !incNP.length) {
    showBanner('No se encontraron registros válidos en los archivos seleccionados.', 'err');
    return;
  }
  commitIncomingDatasets(incP, incNP, pNames, npNames, mode);
}

// MODAL DE CARGA SIMULTANEA
function showModalMsg(txt, type = 'info') {
  const el = $('modal-msg');
  if (!txt) { el.style.display = 'none'; return; }
  const pal = {
    info: 'background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;',
    ok: 'background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;',
    err: 'background:#fef2f2;color:#991b1b;border:1px solid #fecaca;'
  };
  el.style.cssText = `font-size:12px;font-weight:600;display:block;padding:8px 10px;border-radius:8px;${pal[type] || pal.info}`;
  el.textContent = txt;
}

function renderModalSlots() {
  const sp = state.modalStaged.p;
  const snp = state.modalStaged.np;
  const slotP = $('slot-presencial');
  const slotNP = $('slot-nopresencial');

  if (sp) {
    slotP.classList.add('has-file');
    $('slot-p-status').innerHTML = `<strong style="color:#065f46;">✓ ${escapeHtml(sp.names.join(', '))}</strong><span>${sp.records.length.toLocaleString('es-PE')} registros · ${escapeHtml(summarizeRange(sp.records))}</span>`;
    $('btn-clear-p').style.display = 'inline-flex';
  } else {
    slotP.classList.remove('has-file');
    $('slot-p-status').innerHTML = state.presencialRecords.length
      ? `<span style="color:#475569;">Actual: <strong>${escapeHtml(state.meta.pSource || 'Cargado')}</strong> (${state.presencialRecords.length.toLocaleString('es-PE')} reg.)</span><span style="font-size:10.5px;color:#64748b;">Se conservará si no eliges uno nuevo</span>`
      : `<span style="color:#94a3b8;">Ningún archivo nuevo seleccionado</span>`;
    $('btn-clear-p').style.display = 'none';
  }

  if (snp) {
    slotNP.classList.add('has-file');
    $('slot-np-status').innerHTML = `<strong style="color:#3730a3;">✓ ${escapeHtml(snp.names.join(', '))}</strong><span>${snp.records.length.toLocaleString('es-PE')} registros · ${escapeHtml(summarizeRange(snp.records))}</span>`;
    $('btn-clear-np').style.display = 'inline-flex';
  } else {
    slotNP.classList.remove('has-file');
    $('slot-np-status').innerHTML = state.noPresencialRecords.length
      ? `<span style="color:#475569;">Actual: <strong>${escapeHtml(state.meta.npSource || 'Cargado')}</strong> (${state.noPresencialRecords.length.toLocaleString('es-PE')} reg.)</span><span style="font-size:10.5px;color:#64748b;">Se conservará si no eliges uno nuevo</span>`
      : `<span style="color:#94a3b8;">Ningún archivo nuevo seleccionado</span>`;
    $('btn-clear-np').style.display = 'none';
  }

  $('btn-apply-modal').disabled = !(sp || snp);
}

function openUploadModal() {
  state.modalStaged = { p: null, np: null };
  $('modal-upload-mode').value = $('upload-mode').value;
  showModalMsg('');
  renderModalSlots();
  $('upload-modal').classList.add('show');
}

function closeUploadModal() {
  $('upload-modal').classList.remove('show');
  state.modalStaged = { p: null, np: null };
}

async function stageFilesInModal(filesList, forcedKind = null) {
  const files = Array.from(filesList || []);
  if (!files.length) return;
  showModalMsg('');
  let foundP = [], pNames = [], foundNP = [], npNames = [];
  for (const f of files) {
    try {
      const matrix = await readFileToMatrix(f);
      const { kind, records } = parseAnyMatrix(matrix, forcedKind);
      if (!records.length) {
        showModalMsg(`No se encontraron filas válidas en "${f.name}". Verifica que coincida con el tipo de archivo.`, 'err');
        return;
      }
      if (kind === 'NO_PRESENCIAL') { foundNP = foundNP.concat(records); npNames.push(f.name); }
      else { foundP = foundP.concat(records); pNames.push(f.name); }
    } catch (err) {
      showModalMsg(`Error leyendo "${f.name}": ${err.message}`, 'err');
      return;
    }
  }
  if (foundP.length) state.modalStaged.p = { records: foundP, names: pNames };
  if (foundNP.length) state.modalStaged.np = { records: foundNP, names: npNames };
  renderModalSlots();
  const ready = [];
  if (state.modalStaged.p) ready.push(`Presenciales (${state.modalStaged.p.records.length})`);
  if (state.modalStaged.np) ready.push(`No Presenciales (${state.modalStaged.np.records.length})`);
  if (ready.length) showModalMsg(`Listo para unificar: ${ready.join(' + ')}. Haz clic en "Unificar y Cargar".`, 'ok');
}

function exportCSV() {
  const rows = state.computed.filteredDayRows;
  if (!rows.length) { showBanner('No hay filas visibles para exportar.', 'warn'); return; }
  const esc = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = [
    'Fecha', 'Rol', 'Grupo', 'Horario Habitual', 'Usuario', 'Nombre', 'Inicio', 'Fin',
    'Presencial', 'Otros Estados', 'Detalle Estados',
    'No Pres. Justificadas', 'No Pres. No Justificadas', 'Recuperar H.', 'Detalle No Presencial',
    'Alertas Sin Registro', 'Tiempo Sin Registro', 'Detalle Desconexiones / Salida Ant. / Tardío', 'Sin Cerrar'
  ];
  const body = rows.map(d => {
    const det = [
      ...(d.unregAbsence ? [`Ausencia sin registro ${d.unregAbsence.startTime}-${d.unregAbsence.endTime} (${fmtHM(d.unregAbsence.durationMin)})`] : []),
      ...(d.lateEntry ? [`Ingreso tardío ${d.lateEntry.startTime}-${d.lateEntry.endTime} (${fmtHM(d.lateEntry.durationMin)})`] : []),
      ...d.gaps.map(g => `Hueco ${g.startTime}-${g.endTime} (${fmtHM(g.durationMin)})`),
      ...(d.earlyExit ? [`Salida ant. ${d.earlyExit.startTime}-${d.earlyExit.endTime} (${fmtHM(d.earlyExit.durationMin)})`] : [])
    ].join(' | ');
    const npDet = d.npRecords.map(r => `${r.tipo} - ${r.motivo} ${r.startTimeStr}-${r.endTimeStr} (${fmtHM(r.durationMin)})`).join(' | ');
    return [
      d.fecha, d.isSup ? 'Supervisor' : 'Operador', GROUP_MAP[d.groupId]?.label || d.groupId, d.sched.label, d.usuario, d.fullName,
      d.startTime, d.endTime || 'Abierta',
      fmtClock(d.prodMin), fmtClock(d.nonProdMin), d.nonProdList.map(x => `${x.stateKey}: ${fmtHM(x.minutes)}`).join(' | '),
      fmtClock(d.npJustMin), fmtClock(d.npNoJustMin), d.hasNoPresencial ? (d.hasRecuperarSi ? 'SI' : 'NO') : '', npDet,
      d.alertCount, fmtClock(d.alertMin), det, d.openCount
    ];
  });
  const csv = '\uFEFF' + [head.map(esc).join(','), ...body.map(r => r.map(esc).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = `${state.role.toLowerCase()}_${state.filters.group.toLowerCase()}_${state.filters.fecha === 'ALL' ? 'todos' : state.filters.fecha.replace(/\//g, '-')}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// EVENTOS
function bindEvents() {
  $('btn-close-banner').addEventListener('click', hideBanner);
  $('btn-upload').addEventListener('click', openUploadModal);
  $('btn-reset').addEventListener('click', () => loadBaseCSV(true));
  $('btn-export').addEventListener('click', exportCSV);
  $('file-input').addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });

  // Clic en pills de fuentes en el header abre el modal
  $('source-pills').addEventListener('click', e => {
    if (e.target.closest('[data-open-upload]')) openUploadModal();
  });

  // Eventos del modal dual
  $('btn-close-modal').addEventListener('click', closeUploadModal);
  $('btn-cancel-modal').addEventListener('click', closeUploadModal);
  $('upload-modal').addEventListener('click', e => { if (e.target === $('upload-modal')) closeUploadModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('upload-modal').classList.contains('show')) closeUploadModal(); });
  $('modal-upload-mode').addEventListener('change', e => { $('upload-mode').value = e.target.value; });
  $('upload-mode').addEventListener('change', e => { $('modal-upload-mode').value = e.target.value; });

  $('btn-pick-both').addEventListener('click', () => $('file-input-both').click());
  $('btn-pick-p').addEventListener('click', () => $('file-input-p').click());
  $('btn-pick-np').addEventListener('click', () => $('file-input-np').click());
  $('file-input-both').addEventListener('change', e => { stageFilesInModal(e.target.files, null); e.target.value = ''; });
  $('file-input-p').addEventListener('change', e => { stageFilesInModal(e.target.files, 'PRESENCIAL'); e.target.value = ''; });
  $('file-input-np').addEventListener('change', e => { stageFilesInModal(e.target.files, 'NO_PRESENCIAL'); e.target.value = ''; });
  $('btn-clear-p').addEventListener('click', () => { state.modalStaged.p = null; renderModalSlots(); });
  $('btn-clear-np').addEventListener('click', () => { state.modalStaged.np = null; renderModalSlots(); });
  $('btn-apply-modal').addEventListener('click', () => {
    const sp = state.modalStaged.p;
    const snp = state.modalStaged.np;
    if (!sp && !snp) return;
    const mode = $('modal-upload-mode').value;
    closeUploadModal();
    commitIncomingDatasets(sp?.records || [], snp?.records || [], sp?.names || [], snp?.names || [], mode);
  });

  // Drag & drop dentro de los slots del modal
  const bindZoneDrop = (el, forcedKind) => {
    el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', e => { e.preventDefault(); e.stopPropagation(); el.classList.remove('drag-over'); });
    el.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      el.classList.remove('drag-over');
      if (e.dataTransfer?.files?.length) stageFilesInModal(e.dataTransfer.files, forcedKind);
    });
  };
  bindZoneDrop($('dual-quick-zone'), null);
  bindZoneDrop($('slot-presencial'), 'PRESENCIAL');
  bindZoneDrop($('slot-nopresencial'), 'NO_PRESENCIAL');

  // Drag & drop global sobre la ventana (cuando el modal está cerrado)
  let dragC = 0;
  window.addEventListener('dragenter', e => {
    if ($('upload-modal').classList.contains('show')) return;
    e.preventDefault(); dragC++; $('drop-overlay').classList.add('show');
  });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('dragleave', e => {
    if ($('upload-modal').classList.contains('show')) return;
    e.preventDefault(); if (--dragC <= 0) { dragC = 0; $('drop-overlay').classList.remove('show'); }
  });
  window.addEventListener('drop', e => {
    if ($('upload-modal').classList.contains('show')) return;
    e.preventDefault(); dragC = 0; $('drop-overlay').classList.remove('show');
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  });

  // Pestañas Operadores vs Supervisores
  $('role-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.role-tab');
    if (!btn || btn.dataset.role === state.role) return;
    state.role = btn.dataset.role;
    state.filters.group = 'ALL';
    state.filters.onlyGaps = false;
    state.filters.selectedStates.clear();
    state.filters.rawPage = 1;
    recompute();
  });

  // Grupos principales
  $('groups-grid').addEventListener('click', e => {
    const btn = e.target.closest('.group-tab');
    if (!btn) return;
    state.filters.group = btn.dataset.group;
    state.filters.rawPage = 1;
    recompute();
  });

  // Panel de alertas críticas + pills rápidos NP
  $('alert-panel-wrap').addEventListener('click', e => {
    if (e.target.id === 'btn-only-gaps') {
      state.filters.onlyGaps = !state.filters.onlyGaps;
      state.filters.rawPage = 1;
      recompute();
      return;
    }
    const qSt = e.target.closest('[data-quick-state]');
    if (qSt) {
      const k = qSt.dataset.quickState;
      if (state.filters.selectedStates.has(k) && state.filters.selectedStates.size === 1) {
        state.filters.selectedStates.clear();
      } else {
        state.filters.selectedStates.clear();
        state.filters.selectedStates.add(k);
      }
      state.filters.rawPage = 1;
      recompute();
      return;
    }
    const card = e.target.closest('.crit-card');
    if (card) {
      state.filters.search = card.dataset.critOp;
      $('f-search').value = card.dataset.critOp;
      if (card.dataset.critRow) state.expandedKeys.add(card.dataset.critRow);
      recompute();
    }
  });

  // Días
  $('day-strip').addEventListener('click', e => {
    const p = e.target.closest('.day-pill');
    if (!p) return;
    state.filters.fecha = p.dataset.day;
    state.filters.rawPage = 1;
    recompute();
  });

  // Leyenda
  $('legend-row').addEventListener('click', e => {
    const p = e.target.closest('.st-pill');
    if (!p) return;
    const k = p.dataset.state;
    if (state.filters.selectedStates.has(k)) state.filters.selectedStates.delete(k);
    else state.filters.selectedStates.add(k);
    state.filters.rawPage = 1;
    recompute();
  });

  // Vistas
  document.querySelectorAll('.view-btn').forEach(b => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    document.querySelectorAll('.view-btn').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.view-panel').forEach(x => x.classList.remove('active'));
    $('view-' + state.view).classList.add('active');
  }));

  // Filtro origen en Vista CSV
  $('raw-origin-tabs').addEventListener('click', e => {
    const b = e.target.closest('.raw-origin-btn');
    if (!b) return;
    state.filters.rawOrigin = b.dataset.origin;
    state.filters.rawPage = 1;
    recompute();
  });

  // Filtros
  let t;
  $('f-search').addEventListener('input', e => {
    clearTimeout(t);
    t = setTimeout(() => { state.filters.search = e.target.value; state.filters.rawPage = 1; recompute(); }, 110);
  });
  $('f-mingap').addEventListener('change', e => { state.filters.minGap = parseInt(e.target.value, 10) || 1; recompute(); });
  $('f-scale').addEventListener('change', e => { state.filters.scale = e.target.value; recompute(); });
  $('f-op-sort').addEventListener('change', e => { state.filters.opSort = e.target.value; renderOpView(); });
  $('btn-collapse').addEventListener('click', () => { state.expandedKeys.clear(); renderDailyView(); renderOpView(); });

  $('btn-clear').addEventListener('click', () => {
    state.filters.group = 'ALL';
    state.filters.search = '';
    state.filters.minGap = 1;
    state.filters.onlyGaps = false;
    state.filters.selectedStates.clear();
    state.filters.scale = 'AUTO';
    state.filters.rawOrigin = 'ALL';
    state.filters.rawPage = 1;
    $('f-search').value = '';
    $('f-mingap').value = '1';
    $('f-scale').value = 'AUTO';
    recompute();
  });

  // Orden tabla diaria
  document.querySelectorAll('#tbl-daily thead th.sortable').forEach(th => th.addEventListener('click', () => {
    const c = th.dataset.sort;
    if (state.sort.col === c) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    else { state.sort.col = c; state.sort.dir = (c === 'nombre' || c === 'startMin') ? 'asc' : 'desc'; }
    renderDailyView();
  }));

  // Desplegar detalle / enfocar operador
  document.addEventListener('click', e => {
    const foc = e.target.closest('[data-focus-op]');
    if (foc) {
      e.stopPropagation();
      state.filters.search = foc.dataset.focusOp;
      state.filters.fecha = 'ALL';
      state.filters.group = 'ALL';
      $('f-search').value = foc.dataset.focusOp;
      state.view = 'operador';
      document.querySelectorAll('.view-btn').forEach(x => x.classList.toggle('active', x.dataset.view === 'operador'));
      document.querySelectorAll('.view-panel').forEach(x => x.classList.remove('active'));
      $('view-operador').classList.add('active');
      recompute();
      return;
    }
    const r = e.target.closest('tr.day-row');
    if (r) {
      if (r.dataset.rowKey) {
        const k = r.dataset.rowKey;
        state.expandedKeys.has(k) ? state.expandedKeys.delete(k) : state.expandedKeys.add(k);
        renderDailyView();
      } else if (r.dataset.opRowKey) {
        const k = 'op_' + r.dataset.opRowKey;
        state.expandedKeys.has(k) ? state.expandedKeys.delete(k) : state.expandedKeys.add(k);
        renderOpView();
      }
    }
  });

  // Paginación CSV
  $('raw-page-size').addEventListener('change', e => { state.filters.rawPageSize = parseInt(e.target.value, 10) || 100; state.filters.rawPage = 1; renderRawView(); });
  $('btn-raw-prev').addEventListener('click', () => { if (state.filters.rawPage > 1) { state.filters.rawPage--; renderRawView(); } });
  $('btn-raw-next').addEventListener('click', () => { state.filters.rawPage++; renderRawView(); });

  // Tooltip
  document.addEventListener('mouseover', e => { const s = e.target.closest('.tl-seg'); if (s) showTip(s, e); });
  document.addEventListener('mousemove', e => { if (tipEl.classList.contains('show')) { e.target.closest('.tl-seg') ? posTip(e) : tipEl.classList.remove('show'); } });
  document.addEventListener('mouseout', e => { if (e.target.closest('.tl-seg') && !e.relatedTarget?.closest('.tl-seg')) tipEl.classList.remove('show'); });
}

bindEvents();
loadBaseCSV(false);