'use strict';

function recompute() {
  const f = state.filters;
  state.rawRecords = [...state.presencialRecords, ...state.noPresencialRecords, ...state.vacacionesRecords];
  const allDayRows = buildOperatorDayRows(state.presencialRecords, state.noPresencialRecords, state.vacacionesRecords, f.minGap);

  // Separación por pestaña de Rol (Operadores vs Supervisores)
  const isSupTab = state.role === 'SUPERVISORES';
  const roleAllRows = allDayRows.filter(dr => isSupTab ? dr.isSup : !dr.isSup);

  // Fechas disponibles (del rol activo)
  const dateMap = new Map();
  for (const dr of roleAllRows) {
    if (!dr.fecha) continue;
    if (!dateMap.has(dr.fecha)) dateMap.set(dr.fecha, { fecha: dr.fecha, sort: dr.fechaSort, ops: 0, gaps: 0, hasPres: false, npCount: 0, vacCount: 0 });
    const d = dateMap.get(dr.fecha);
    d.ops++;
    d.gaps += dr.alertCount;
    if (dr.hasPresencial) d.hasPres = true;
    if (dr.hasNoPresencial) d.npCount++;
    if (dr.hasVacacion) d.vacCount++;
  }
  const allDates = [...dateMap.values()].sort((a, b) => b.sort - a.sort);
  if (f.fecha === 'LATEST' || (f.fecha !== 'ALL' && !dateMap.has(f.fecha))) {
    const latestPres = allDates.find(d => d.hasPres);
    f.fecha = latestPres ? latestPres.fecha : (allDates.length ? allDates[0].fecha : 'ALL');
  }

  // Conteo en las pestañas principales Operadores vs Supervisores (en la fecha activa)
  const opsInDate = new Set(), supInDate = new Set();
  for (const dr of allDayRows) {
    if (f.fecha !== 'ALL' && dr.fecha !== f.fecha) continue;
    if (dr.isSup) supInDate.add(dr.opKey);
    else opsInDate.add(dr.opKey);
  }
  const roleCounts = { ops: opsInDate.size, sup: supInDate.size };

  // Filas por fecha + búsqueda dentro del rol activo
  const q = normalizeKey(f.search);
  const dateRows = roleAllRows.filter(dr => {
    if (f.fecha !== 'ALL' && dr.fecha !== f.fecha) return false;
    if (q && !dr.searchHay.includes(q)) return false;
    return true;
  });

  // Conteo por grupos activos (4 turnos para Operadores, Diurno/Nocturno para Supervisores)
  const activeGroupList = isSupTab ? SUP_GROUPS : GROUPS;
  if (!activeGroupList.some(g => g.id === f.group)) f.group = 'ALL';
  const groupStats = {};
  for (const g of activeGroupList) groupStats[g.id] = { ops: new Set(), rows: 0, gapOps: new Set(), gapMin: 0, npOps: new Set(), npMin: 0, vacOps: new Set() };
  for (const dr of dateRows) {
    for (const id of ['ALL', dr.groupId]) {
      if (!groupStats[id]) continue;
      groupStats[id].ops.add(dr.opKey);
      groupStats[id].rows++;
      if (dr.alertCount > 0) {
        groupStats[id].gapOps.add(dr.opKey);
        groupStats[id].gapMin += dr.alertMin;
      }
      if (dr.hasNoPresencial) {
        groupStats[id].npOps.add(dr.opKey);
        groupStats[id].npMin += dr.npTotalMin;
      }
      if (dr.hasVacacion) {
        groupStats[id].vacOps.add(dr.opKey);
      }
    }
  }

  // Filtrar por grupo principal seleccionado
  const groupRows = f.group === 'ALL' ? dateRows : dateRows.filter(dr => dr.groupId === f.group);

  // Conteo por estado (para la leyenda clicable)
  const stateCounts = new Map();
  for (const dr of groupRows) {
    for (const st of dr.presentStates) stateCounts.set(st, (stateCounts.get(st) || 0) + 1);
  }

  // Ranking de críticos por ausencia sin registro / desconexión / salida anticipada / tardanza
  const critMap = new Map();
  for (const dr of groupRows) {
    if (dr.alertCount === 0) continue;
    if (!critMap.has(dr.opKey)) {
      critMap.set(dr.opKey, {
        opKey: dr.opKey, usuario: dr.usuario, fullName: dr.fullName,
        groupId: dr.groupId, schedLabel: dr.sched.label,
        gapMin: 0, gapCount: 0, earlyCount: 0, lateCount: 0, holeCount: 0, unregCount: 0,
        days: new Set(), sampleRowKey: dr.rowKey, lastTag: ''
      });
    }
    const c = critMap.get(dr.opKey);
    c.gapMin += dr.alertMin;
    c.gapCount += dr.alertCount;
    if (dr.isUnregisteredDay) { c.unregCount++; c.lastTag = 'Día sin registro'; }
    else if (dr.earlyExit) { c.earlyCount++; c.lastTag = `Salió ${dr.earlyExit.startTime} (fin ${dr.earlyExit.endTime})`; }
    else if (dr.lateEntry) { c.lateCount++; c.lastTag = `Entró ${dr.lateEntry.endTime} (ini ${dr.lateEntry.startTime})`; }
    c.days.add(dr.fecha);
  }
  const criticalOps = [...critMap.values()].sort((a, b) => (b.unregCount - a.unregCount) || (b.gapMin - a.gapMin) || (b.gapCount - a.gapCount));

  // Aplicar filtro de "solo desconexiones/alertas" y estados seleccionados en leyenda
  const filteredDayRows = groupRows.filter(dr => {
    if (f.onlyGaps && dr.alertCount === 0) return false;
    if (f.selectedStates.size > 0) {
      let ok = false;
      for (const st of f.selectedStates) { if (dr.presentStates.has(st)) { ok = true; break; } }
      if (!ok) return false;
    }
    return true;
  });

  // Registros crudos filtrados para Vista CSV (unificados con filtro por origen)
  const filteredRecords = [];
  for (const dr of filteredDayRows) {
    for (const r of dr.records) {
      if (f.rawOrigin === 'PRESENCIAL' && (r.isNoPresencial || r.isVacacion)) continue;
      if (f.rawOrigin === 'NO_PRESENCIAL' && !r.isNoPresencial) continue;
      if (f.rawOrigin === 'VACACIONES' && !r.isVacacion) continue;
      r._groupId = dr.groupId;
      if (f.selectedStates.size > 0 && !f.selectedStates.has('SIN_REGISTRO') && !f.selectedStates.has('DESCONEXION') && !f.selectedStates.has('SALIDA_ANTICIPADA') && !f.selectedStates.has('INGRESO_TARDIO')) {
        const match = f.selectedStates.has(r.stateKey) || (f.selectedStates.has('SIN_CERRAR') && r.isOpen);
        if (!match) continue;
      }
      filteredRecords.push(r);
    }
  }
  filteredRecords.sort((a, b) => (b.startMs || 0) - (a.startMs || 0));

  // Agrupado por operador para Vista 2
  const opMap = new Map();
  for (const dr of filteredDayRows) {
    if (!opMap.has(dr.opKey)) {
      opMap.set(dr.opKey, {
        opKey: dr.opKey, usuario: dr.usuario, matricula: dr.matricula, fullName: dr.fullName,
        groupId: dr.groupId, schedLabel: dr.sched.label, days: [],
        prodMin: 0, nonProdMin: 0, npJustMin: 0, npNoJustMin: 0, npTotalMin: 0,
        vacDays: 0, vacMin: 0,
        gapMin: 0, gapCount: 0, openCount: 0
      });
    }
    const op = opMap.get(dr.opKey);
    op.days.push(dr);
    op.prodMin += dr.prodMin;
    op.nonProdMin += dr.nonProdMin;
    op.npJustMin += dr.npJustMin;
    op.npNoJustMin += dr.npNoJustMin;
    op.npTotalMin += dr.npTotalMin;
    if (dr.hasVacacion) { op.vacDays++; op.vacMin += dr.vacMin; }
    op.gapMin += dr.alertMin;
    op.gapCount += dr.alertCount;
    op.openCount += dr.openCount;
  }
  for (const op of opMap.values()) op.days.sort((a, b) => b.fechaSort - a.fechaSort);

  // Escala horaria automática inteligente según el turno seleccionado
  let activeRange = [0, 1080];
  if (f.scale === '0-12') activeRange = [0, 720];
  else if (f.scale === '6-16') activeRange = [360, 960];
  else if (f.scale === '0-18') activeRange = [0, 1080];
  else if (f.scale === '0-24') activeRange = [0, 1440];
  else {
    const maxM = filteredDayRows.reduce((mx, d) => Math.max(mx, d.maxVisMin), 0);
    if ((f.group === 'NOCTURNO_ATEMP' || f.group === 'NOCHE_GOAT' || f.group === 'SUP_NOCTURNO') && maxM <= 740) activeRange = [0, 720];
    else if ((f.group === 'DIURNO_ATEMP' || f.group === 'DIA_GOAT' || f.group === 'SUP_DIURNO') && maxM <= 1020) activeRange = [360, 1020];
    else if (maxM <= 1080) activeRange = [0, 1080];
    else activeRange = [0, 1440];
  }

  state.computed = {
    allDates, allDayRows, roleCounts, groupRows, filteredDayRows, filteredRecords,
    operators: [...opMap.values()], criticalOps, groupStats, stateCounts, activeRange
  };

  renderAll();
}

function renderAll() {
  renderHeader();
  renderRoleTabs();
  renderGroups();
  renderAlertPanel();
  renderDays();
  renderLegend();
  updateClearBtn();
  renderDailyView();
  renderOpView();
  renderRawView();
}

function renderHeader() {
  const pCnt = state.presencialRecords.length;
  const npCnt = state.noPresencialRecords.length;
  const vacCnt = state.vacacionesRecords.length;
  const pLbl = state.meta.pSource || 'Sin cargar';
  const npLbl = state.meta.npSource || 'Sin cargar';
  const vacLbl = state.meta.vacSource || 'Sin cargar';
  $('source-pills').innerHTML = `
    <span class="src-pill ${pCnt ? 'loaded-p' : 'empty-src'}" data-open-upload="1" title="Clic para cargar o actualizar Excel de Horas Presenciales">
      <span class="src-dot"></span>Presenciales: ${escapeHtml(pLbl)}${pCnt ? ` (${pCnt.toLocaleString('es-PE')})` : ''}
    </span>
    <span class="src-pill ${npCnt ? 'loaded-np' : 'empty-src'}" data-open-upload="1" title="Clic para cargar o actualizar Excel de Horas No Presenciales">
      <span class="src-dot"></span>No Presenciales: ${escapeHtml(npLbl)}${npCnt ? ` (${npCnt.toLocaleString('es-PE')})` : ''}
    </span>
    <span class="src-pill ${vacCnt ? 'loaded-vac' : 'empty-src'}" data-open-upload="1" title="Clic para cargar o actualizar Excel de Vacaciones">
      <span class="src-dot"></span>Vacaciones: ${escapeHtml(vacLbl)}${vacCnt ? ` (${vacCnt.toLocaleString('es-PE')})` : ''}
    </span>`;
  const allOps = new Set(state.computed.allDayRows.filter(d => !d.isSup).map(d => d.opKey)).size;
  const allSups = new Set(state.computed.allDayRows.filter(d => d.isSup).map(d => d.opKey)).size;
  $('source-meta').textContent = state.rawRecords.length ? `· ${allOps} operadores · ${allSups} supervisores · ${state.computed.allDates.length} días` : '';
}

function renderRoleTabs() {
  const isSup = state.role === 'SUPERVISORES';
  const rc = state.computed.roleCounts || { ops: 0, sup: 0 };
  $('role-count-ops').textContent = rc.ops;
  $('role-count-sup').textContent = rc.sup;
  document.querySelectorAll('#role-tabs .role-tab').forEach(b => b.classList.toggle('active', b.dataset.role === state.role));
  $('btn-view-person').textContent = isSup ? '🛡️ Por Supervisor' : '👤 Por Operador';
  $('f-search').placeholder = isSup ? 'Buscar supervisor, usuario, motivo u observación...' : 'Buscar operador, usuario, motivo u observación...';
}

function renderGroups() {
  const { groupStats } = state.computed;
  const isSup = state.role === 'SUPERVISORES';
  const list = isSup ? SUP_GROUPS : GROUPS;
  const unit = isSup ? ['supervisor', 'supervisores'] : ['operador', 'operadores'];
  const cur = state.filters.group;
  const grid = $('groups-grid');
  grid.classList.toggle('sup-grid', isSup);
  grid.innerHTML = list.map(g => {
    const st = groupStats[g.id] || { ops: new Set(), gapOps: new Set(), gapMin: 0, npOps: new Set(), npMin: 0, vacOps: new Set() };
    const isAct = cur === g.id;
    const pills = [];
    if (st.gapOps.size > 0) pills.push(`<span class="group-alert-dot" title="Alertas sin registro (Ausencias, Tardanzas, Salidas)">⚠️ ${st.gapOps.size} · ${fmtHM(st.gapMin)}</span>`);
    if (st.npOps.size > 0) pills.push(`<span class="group-np-dot" title="Registros No Presenciales (Justificadas / Faltas)">📋 ${st.npOps.size} · ${fmtHM(st.npMin)}</span>`);
    if (st.vacOps && st.vacOps.size > 0) pills.push(`<span class="group-vac-dot" title="En vacaciones registradas">🏖️ ${st.vacOps.size}</span>`);
    return `
      <button class="group-tab ${isAct ? 'active' : ''}" data-group="${g.id}"
        style="--g-color:${g.color};--g-soft:${g.soft};--g-text:${g.text};">
        <div class="group-tab-top">
          <span class="group-name"><span>${g.icon}</span><span>${g.label}</span></span>
          <span class="group-count">${st.ops.size}</span>
        </div>
        <div class="group-sub">
          <span>${st.ops.size === 1 ? '1 ' + unit[0] : st.ops.size + ' ' + unit[1]}</span>
          <span style="display:inline-flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
            ${pills.length ? pills.join('') : '<span>Sin alertas</span>'}
          </span>
        </div>
      </button>`;
  }).join('');
}

function renderAlertPanel() {
  const { criticalOps, groupRows } = state.computed;
  const wrap = $('alert-panel-wrap');
  const totalGapMin = criticalOps.reduce((s, c) => s + c.gapMin, 0);
  const totalGaps = criticalOps.reduce((s, c) => s + c.gapCount, 0);
  const openCount = groupRows.reduce((s, r) => s + r.openCount, 0);
  const unregRows = groupRows.filter(r => r.isUnregisteredDay);
  const npJustRows = groupRows.filter(r => r.npJustMin > 0);
  const npNoJustRows = groupRows.filter(r => r.npNoJustMin > 0);
  const vacRows = groupRows.filter(r => r.hasVacacion);
  const npJustMin = npJustRows.reduce((s, r) => s + r.npJustMin, 0);
  const npNoJustMin = npNoJustRows.reduce((s, r) => s + r.npNoJustMin, 0);
  const npSummaryPills = `
    ${vacRows.length ? `<span class="alert-kpi-pill vac-pill" data-quick-state="VACACIONES" title="En vacaciones registradas (no es alerta) · Clic para filtrar">🏖️ ${vacRows.length} Vacaciones</span>` : ''}
    ${npJustRows.length ? `<span class="alert-kpi-pill np-just-pill" data-quick-state="NP_JUSTIFICADA" title="Registrado en No Presenciales (no es alerta) · Clic para filtrar">✓ ${npJustRows.length} Justif. · ${fmtHM(npJustMin)}</span>` : ''}
    ${npNoJustRows.length ? `<span class="alert-kpi-pill np-nojust-pill" data-quick-state="NP_NO_JUSTIFICADA" title="Falta registrada en No Presenciales (documentada) · Clic para filtrar">✕ ${npNoJustRows.length} No Justif. · ${fmtHM(npNoJustMin)}</span>` : ''}`;

  const groupLabel = state.role === 'SUPERVISORES' && state.filters.group === 'ALL'
    ? 'Supervisores'
    : (GROUP_MAP[state.filters.group]?.label || 'Todos');
  const personSingular = state.role === 'SUPERVISORES' ? 'supervisor' : 'operador';
  const personPlural = state.role === 'SUPERVISORES' ? 'supervisores' : 'operadores';
  const dayLabel = state.filters.fecha === 'ALL' ? 'Todos los días' : formatDayShort(state.filters.fecha);

  if (!criticalOps.length && openCount === 0) {
    wrap.innerHTML = `
      <div class="alert-panel ok-panel">
        <div class="alert-head">
          <div class="alert-title">
            <span>✅ Todo registrado (sin ausencias, tardanzas ni salidas anticipadas sin registro) en ${escapeHtml(groupLabel)} (${escapeHtml(dayLabel)})</span>
            ${npSummaryPills}
          </div>
        </div>
      </div>`;
    return;
  }

  const top = criticalOps.slice(0, 8);
  const cardsHtml = top.map((c, i) => {
    const g = GROUP_MAP[c.groupId] || GROUP_MAP.ALL;
    return `
      <div class="crit-card" data-crit-op="${escapeHtml(c.usuario || c.fullName)}" data-crit-row="${escapeHtml(c.sampleRowKey)}" title="Clic para revisar">
        <span class="crit-rank">${i + 1}</span>
        <div>
          <div class="crit-name">${escapeHtml(c.fullName)}</div>
          <div class="crit-meta">${g.icon} ${g.label} · ${escapeHtml(c.schedLabel)}${c.days.size > 1 ? ` · ${c.days.size}d` : ''}</div>
        </div>
        <div>
          <div class="crit-time">${fmtHM(c.gapMin)}</div>
          <div class="crit-sub">${escapeHtml(c.lastTag || `${c.gapCount} alerta(s)`)}</div>
        </div>
      </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="alert-panel">
      <div class="alert-head">
        <div class="alert-title">
          <span>🚨 Alerta: Sin Registro (Ausencias, Tardanzas y Salidas) · ${escapeHtml(groupLabel)} (${escapeHtml(dayLabel)})</span>
          ${criticalOps.length ? `<span class="alert-kpi-pill">${criticalOps.length} ${criticalOps.length === 1 ? personSingular : personPlural} · ${totalGaps} alerta${totalGaps === 1 ? '' : 's'} · ${fmtHM(totalGapMin)} sin registro</span>` : ''}
          ${unregRows.length ? `<span class="alert-kpi-pill" data-quick-state="SIN_REGISTRO" style="cursor:pointer;background:#fee2e2;color:#991b1b;border-color:#f87171;" title="Clic para filtrar solo ausencias sin registro">⚠️ ${unregRows.length} sin registro (día completo)</span>` : ''}
          ${openCount > 0 ? `<span class="alert-kpi-pill open-pill">⚠️ ${openCount} sin cerrar</span>` : ''}
          ${npSummaryPills}
        </div>
        <div style="display:flex;gap:6px;">
          ${criticalOps.length ? `<button class="btn btn-xs ${state.filters.onlyGaps ? 'btn-primary' : ''}" id="btn-only-gaps">${state.filters.onlyGaps ? '✓ Mostrando solo alertas' : 'Filtrar solo con alertas'}</button>` : ''}
        </div>
      </div>
      ${top.length ? `<div class="crit-list">${cardsHtml}</div>` : ''}
    </div>`;
}

function renderDays() {
  const { allDates } = state.computed;
  const cur = state.filters.fecha;
  const pills = [
    `<button class="day-pill ${cur === 'ALL' ? 'active' : ''}" data-day="ALL">Todos los días</button>`,
    ...allDates.map(d => {
      const onlyNp = !d.hasPres && d.npCount > 0;
      const onlyVac = !d.hasPres && d.npCount === 0 && d.vacCount > 0;
      const tip = onlyVac
        ? `${d.fecha} · Solo Vacaciones (${d.vacCount} reg.) — sin archivo presencial de este día`
        : (onlyNp
          ? `${d.fecha} · Solo No Presenciales (${d.npCount} reg.${d.vacCount ? ` · ${d.vacCount} Vac.` : ''}) — sin archivo presencial de este día`
          : `${d.fecha} · ${d.ops} registros${d.npCount ? ` · ${d.npCount} No Pres.` : ''}${d.vacCount ? ` · ${d.vacCount} Vac.` : ''}`);
      const dot = d.gaps > 0
        ? '<span class="day-dot"></span>'
        : (d.npCount > 0 ? '<span class="day-dot-np"></span>' : (d.vacCount > 0 ? '<span class="day-dot-vac"></span>' : ''));
      return `
        <button class="day-pill ${cur === d.fecha ? 'active' : ''} ${onlyNp ? 'only-np' : (onlyVac ? 'only-vac' : '')}" data-day="${escapeHtml(d.fecha)}" title="${escapeHtml(tip)}">
          ${dot}
          <span>${escapeHtml(formatDayShort(d.fecha))}</span>
          ${onlyNp ? '<span style="font-size:9.5px;opacity:0.85;">NP</span>' : (onlyVac ? '<span style="font-size:9.5px;opacity:0.85;">Vac</span>' : '')}
        </button>`;
    })
  ];
  $('day-strip').innerHTML = pills.join('');
}

function renderLegend() {
  const { stateCounts } = state.computed;
  const sel = state.filters.selectedStates;
  const keys = new Set(['PRODUCTIVO']);
  for (const r of state.rawRecords) keys.add(r.stateKey);
  if (state.noPresencialRecords.length) {
    if (stateCounts.has('NP_JUSTIFICADA') || state.noPresencialRecords.some(r => r.isJustificada)) keys.add('NP_JUSTIFICADA');
    if (stateCounts.has('NP_NO_JUSTIFICADA') || state.noPresencialRecords.some(r => !r.isJustificada)) keys.add('NP_NO_JUSTIFICADA');
  }
  if (state.vacacionesRecords.length || stateCounts.has('VACACIONES')) keys.add('VACACIONES');
  if (stateCounts.has('SIN_REGISTRO')) keys.add('SIN_REGISTRO');
  if (stateCounts.has('DESCONEXION')) keys.add('DESCONEXION');
  if (stateCounts.has('SALIDA_ANTICIPADA')) keys.add('SALIDA_ANTICIPADA');
  if (stateCounts.has('INGRESO_TARDIO')) keys.add('INGRESO_TARDIO');
  if (stateCounts.has('SIN_CERRAR')) keys.add('SIN_CERRAR');

  const ordered = [...keys].map(getStateStyle).sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label));
  const chips = ordered.map(st => {
    const cnt = stateCounts.get(st.key) || 0;
    const isSel = sel.has(st.key);
    const isDim = sel.size > 0 && !isSel;
    const dotCls = st.striped ? 'striped' : (st.stripedOrange ? 'striped-orange' : (st.stripedIndigo ? 'striped-indigo' : (st.stripedCrimson ? 'striped-crimson' : (st.stripedAlert ? 'striped-alert' : (st.stripedTeal ? 'striped-teal' : '')))));
    return `
      <button class="st-pill ${isSel ? 'selected' : ''} ${isDim ? 'dimmed' : ''}" data-state="${escapeHtml(st.key)}"
        style="--st-color:${st.color};--st-soft:${st.soft};--st-border:${st.border};--st-text:${st.text};">
        <span class="st-dot ${dotCls}"></span>
        <span>${escapeHtml(st.label)}</span>
        <span style="opacity:0.75;">(${cnt})</span>
      </button>`;
  }).join('');

  $('legend-row').innerHTML = `<span class="legend-lbl">Estados:</span>${chips}`;
}

function updateClearBtn() {
  const f = state.filters;
  const hasAny = f.search || f.onlyGaps || f.selectedStates.size > 0 || f.group !== 'ALL' || f.minGap !== 1 || f.scale !== 'AUTO' || f.rawOrigin !== 'ALL';
  $('btn-clear').style.display = hasAny ? 'inline-flex' : 'none';
}

function buildRuler(range) {
  const [minM, maxM] = range;
  const spanH = Math.round((maxM - minM) / 60);
  const stepH = spanH <= 12 ? 1 : (spanH <= 18 ? 2 : 3);
  const out = [];
  for (let h = Math.floor(minM / 60); h <= Math.ceil(maxM / 60); h += stepH) out.push(`<span>${String(h).padStart(2, '0')}h</span>`);
  return out.join('');
}

function buildTimeline(dr, range) {
  const [minM, maxM] = range;
  const span = Math.max(60, maxM - minM);
  const sel = state.filters.selectedStates;
  const stepM = (span / 60) <= 12 ? 60 : 120;
  let grid = '';
  for (let m = minM + stepM; m < maxM; m += stepM) {
    grid += `<div class="tl-grid" style="left:${(((m - minM) / span) * 100).toFixed(2)}%;"></div>`;
  }
  const segs = dr.timelineItems.map((it, idx) => {
    if (it.onTimeline === false) return '';
    if (it.eMin <= minM || it.sMin >= maxM) return '';
    const cs = Math.max(minM, it.sMin), ce = Math.min(maxM, it.eMin);
    const left = ((cs - minM) / span) * 100;
    const width = Math.max(0.55, ((ce - cs) / span) * 100);
    const st = getStateStyle(it.stateKey);
    const isGap = it.kind === 'gap';
    const isMissing = it.kind === 'early_exit' || it.kind === 'late_entry';
    const isUnreg = it.kind === 'unreg_absence';
    const isNp = it.kind === 'np_record';
    const isVac = it.kind === 'vac_record';
    const npCls = isNp ? (it.isJustificada ? 'is-np-just' : 'is-np-nojust') : '';
    const match = sel.size === 0 || sel.has(it.stateKey) || (sel.has('SIN_CERRAR') && it.isOpen);
    const segLabel = isUnreg ? '⚠️ Sin registro' : (isVac ? `🏖️ ${it.shortLabel}` : (isNp ? `${it.isJustificada ? '✓' : '✕'} ${it.shortLabel}` : st.short));
    const showLbl = width >= (isNp || isUnreg || isVac ? 9 : 12) && !isGap && it.stateKey !== 'PRODUCTIVO' && it.stateKey !== 'NO_PAGABLE';
    const z = (isGap || isMissing || isUnreg) ? 5 : (isNp || isVac ? 4 : (it.stateKey === 'PRODUCTIVO' ? 2 : (it.stateKey === 'NO_PAGABLE' ? 1 : 3)));
    return `<div class="tl-seg ${isGap ? 'is-gap' : ''} ${isMissing ? 'is-missing' : ''} ${isUnreg ? 'is-unreg' : ''} ${isVac ? 'is-vac' : ''} ${npCls} ${it.isOpen ? 'is-open' : ''} ${!match ? 'is-dim' : ''}"
      style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;background:${st.color};z-index:${z};"
      data-tip-row="${escapeHtml(dr.rowKey)}" data-tip-idx="${idx}">
      ${showLbl ? `<span class="tl-seg-lbl">${escapeHtml(segLabel)}</span>` : ''}
    </div>`;
  }).join('');
  return `<div class="tl-track">${grid}${segs}</div>`;
}

function buildStateBadges(dr) {
  if (dr.isUnregisteredDay) {
    const st = KNOWN_STATES.SIN_REGISTRO;
    return `<div class="badges-wrap"><span class="st-badge" style="--st-color:${st.color};--st-soft:${st.soft};--st-border:${st.border};--st-text:${st.text};">⚠️ Sin registro (día)</span></div>`;
  }
  const list = [];
  for (const x of dr.nonProdList) {
    const st = getStateStyle(x.stateKey);
    list.push(`<span class="st-badge" style="--st-color:${st.color};--st-soft:${st.soft};--st-border:${st.border};--st-text:${st.text};"><span class="st-badge-dot"></span>${escapeHtml(st.short)} · ${fmtHM(x.minutes)}</span>`);
  }
  for (const np of dr.npList) {
    const st = getStateStyle(np.stateKey);
    const ico = np.isJustificada ? '✓' : '✕';
    const recTag = np.recuperarSi ? ' <span class="np-tag-recup" title="Recuperar horas: SI">↺</span>' : '';
    list.push(`<span class="st-badge" title="${escapeHtml(np.isJustificada ? 'Justificada' : 'No Justificada')}: ${escapeHtml(np.motivo)}${np.recuperarSi ? ' · Recuperar H.: SI' : ''}" style="--st-color:${st.color};--st-soft:${st.soft};--st-border:${st.border};--st-text:${st.text};">${ico} ${escapeHtml(np.shortLabel)} · ${fmtHM(np.minutes)}${recTag}</span>`);
  }
  for (const vc of (dr.vacList || [])) {
    const st = KNOWN_STATES.VACACIONES;
    list.push(`<span class="st-badge" title="Vacaciones (${escapeHtml(vc.vacEstado)}): ${escapeHtml(vc.vacTipo)}" style="--st-color:${st.color};--st-soft:${st.soft};--st-border:${st.border};--st-text:${st.text};">🏖️ ${escapeHtml(vc.shortLabel)} · ${fmtHM(vc.minutes)}</span>`);
  }
  if (dr.openCount > 0) {
    const st = KNOWN_STATES.SIN_CERRAR;
    list.push(`<span class="st-badge" style="--st-color:${st.color};--st-soft:${st.soft};--st-border:${st.border};--st-text:${st.text};"><span class="st-badge-dot"></span>Sin cerrar</span>`);
  }
  if (!list.length) return `<span class="ok-minimal">Presencial</span>`;
  return `<div class="badges-wrap">${list.join('')}</div>`;
}

function buildGapsCell(dr) {
  const pills = [];
  if (dr.unregAbsence) {
    pills.push(`<span class="gap-pill unreg-pill" title="No tiene registro en Horas Presenciales ni en Horas No Presenciales">🚨 Sin registro ${dr.unregAbsence.startTime}–${dr.unregAbsence.endTime} · ${fmtHM(dr.unregAbsence.durationMin)}</span>`);
  }
  if (dr.lateEntry) {
    pills.push(`<span class="gap-pill late-pill" title="Ingreso tardío respecto a su horario habitual ${escapeHtml(dr.sched.label)}">⏰ Tardío ${dr.lateEntry.startTime}–${dr.lateEntry.endTime} · ${fmtHM(dr.lateEntry.durationMin)}</span>`);
  }
  if (dr.earlyExit) {
    pills.push(`<span class="gap-pill early-pill" title="Se desconectó antes de su hora de salida habitual ${escapeHtml(dr.sched.label)} sin registro posterior">🚪 Salió ${dr.earlyExit.startTime} (fin ${dr.earlyExit.endTime}) · ${fmtHM(dr.earlyExit.durationMin)}</span>`);
  }
  if (!pills.length) {
    if (dr.onlyVacacion) {
      return `<span class="np-covered-pill is-vac" title="Vacaciones registradas (${escapeHtml(dr.vacRecords?.[0]?.vacEstado || 'Aceptado')})">🏖️ Vacaciones</span>`;
    }
    if (dr.hasPresencial && dr.hasVacacion) {
      return `<span class="np-covered-pill is-vac" title="Tiene conexión presencial y registro de vacaciones en esta fecha">🏖️ Vac. + Pres.</span>`;
    }
    if (dr.hasPresencial && dr.hasNoPresencial) {
      const isJust = dr.npJustMin >= dr.npNoJustMin;
      return `<span class="np-covered-pill ${isJust ? '' : 'is-nojust'}" title="Tramo no presencial registrado y conciliado en la línea de tiempo">${isJust ? '✓ Cubierto (Justif.)' : '📋 Reg. No Pres.'}</span>`;
    }
    if (dr.onlyNoPresencial) {
      const isJust = dr.npJustMin > 0 && dr.npNoJustMin === 0;
      const label = isJust ? '✓ Ausencia Justif.' : (dr.npJustMin > 0 ? '📋 Mixta (NP)' : '✕ Falta Registrada');
      return `<span class="np-covered-pill ${isJust ? '' : 'is-nojust'}">${label}</span>`;
    }
    return `<span class="muted-dash">—</span>`;
  }
  return `<div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start;">${pills.join('')}</div>`;
}

function buildDetailRow(dr, colspan) {
  const rows = dr.timelineItems.map(it => {
    const st = getStateStyle(it.stateKey);
    const isAlert = it.kind === 'gap' || it.kind === 'early_exit' || it.kind === 'late_entry' || it.kind === 'unreg_absence';
    const isNp = it.kind === 'np_record';
    const isVac = it.kind === 'vac_record';
    const trCls = isAlert ? 'ev-gap' : (isVac ? 'ev-vac' : (isNp ? (it.isJustificada ? 'ev-np-just' : 'ev-np-nojust') : ''));
    const stateLabel = isVac ? `🏖️ ${it.vacTipo}` : (isNp ? `${it.isJustificada ? '✓' : '✕'} ${it.motivo}` : st.label);
    const statusCell = it.kind === 'unreg_absence'
      ? '<strong style="color:#991b1b;">SIN REGISTRO</strong>'
      : (it.kind === 'gap'
        ? '<strong style="color:#9f1239;">HUECO</strong>'
        : (it.kind === 'early_exit'
          ? '<strong style="color:#9a3412;">SIN REGISTRO</strong>'
          : (it.kind === 'late_entry'
            ? '<strong style="color:#92400e;">TARDÍO</strong>'
            : (isVac
              ? `<span class="np-tag-inline np-tag-vac">Vacaciones · ${escapeHtml(it.vacEstado)}</span>`
              : (isNp
                ? `<span class="np-tag-inline ${it.isJustificada ? 'np-tag-just' : 'np-tag-nojust'}">${escapeHtml(it.tipo)}</span>` +
                  (it.recuperarH ? ` <span class="np-tag-recup" style="${it.recuperarH === 'SI' ? '' : 'background:#f1f5f9;color:#64748b;border-color:#e2e8f0;'}">Recup: ${escapeHtml(it.recuperarH)}</span>` : '')
                : (it.isOpen ? '<span class="pill-open">Sin cerrar</span>' : '<span style="color:#065f46;font-weight:600;">SI</span>'))))));
    return `
      <tr class="${trCls}">
        <td class="ev-bar mono" style="--st-color:${st.color};white-space:nowrap;font-weight:700;">
          ${escapeHtml(it.startTime)} → ${escapeHtml(it.endTime)}${it.endNextDay ? ' <small style="color:#db2777;">(+1d)</small>' : ''}
        </td>
        <td class="mono" style="white-space:nowrap;font-weight:700;">${fmtHM(it.durationMin)}</td>
        <td><span class="st-badge" style="--st-color:${st.color};--st-soft:${st.soft};--st-border:${st.border};--st-text:${st.text};"><span class="st-badge-dot"></span>${escapeHtml(stateLabel)}</span></td>
        <td>${statusCell}</td>
        <td class="obs-txt">${escapeHtml(it.obs || '—')}</td>
      </tr>`;
  }).join('');
  return `
    <tr class="detail-row">
      <td colspan="${colspan}">
        <div class="detail-box">
          <div class="detail-top">
            <span class="detail-title">${escapeHtml(dr.fullName)} · ${escapeHtml(dr.fecha)} · Horario habitual: ${escapeHtml(dr.sched.label)}${dr.npTotalMin > 0 ? ` · No Presencial: ${fmtHM(dr.npTotalMin)}` : ''}</span>
            <button class="btn btn-xs" data-focus-op="${escapeHtml(dr.usuario || dr.fullName)}">👤 Ver todos sus días</button>
          </div>
          <table class="detail-tbl">
            <thead><tr><th>Inicio → Fin</th><th>Duración</th><th>Estado / Motivo</th><th>Cerrado / Tipo NP</th><th>Observaciones</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </td>
    </tr>`;
}

function renderDailyView() {
  const { filteredDayRows, activeRange } = state.computed;
  const { col, dir } = state.sort;
  const mult = dir === 'asc' ? 1 : -1;
  const showDate = state.filters.fecha === 'ALL';

  const sorted = filteredDayRows.slice().sort((a, b) => {
    if (col === 'nombre') return a.fullName.localeCompare(b.fullName) * mult || (b.fechaSort - a.fechaSort);
    if (col === 'startMin') return (a.startMinSort - b.startMinSort) * mult;
    if (col === 'nonProdMin') return ((a.nonProdMin + a.npTotalMin) - (b.nonProdMin + b.npTotalMin)) * mult || a.fullName.localeCompare(b.fullName);
    if (col === 'gapMin') return (a.alertMin - b.alertMin) * mult || (a.npTotalMin - b.npTotalMin) * mult || (a.nonProdMin - b.nonProdMin) * mult || a.fullName.localeCompare(b.fullName);
    if (col === 'prodMin') return (a.prodMin - b.prodMin) * mult;
    return 0;
  });

  const totalProd = sorted.reduce((s, d) => s + d.prodMin, 0);
  const totalNonProd = sorted.reduce((s, d) => s + d.nonProdMin, 0);
  const totalNpJust = sorted.reduce((s, d) => s + d.npJustMin, 0);
  const totalNpNoJust = sorted.reduce((s, d) => s + d.npNoJustMin, 0);
  const totalVacDays = sorted.filter(d => d.hasVacacion).length;
  $('board-summary').innerHTML = `
    <span><strong>${sorted.length}</strong> jornada${sorted.length === 1 ? '' : 's'}</span>
    <span>·</span>
    <span>Presencial: <strong style="color:#065f46;">${fmtHM(totalProd)}</strong></span>
    <span>·</span>
    <span>Otros estados: <strong>${fmtHM(totalNonProd)}</strong></span>
    ${totalVacDays > 0 ? `<span>·</span><span>Vacaciones: <strong style="color:#0f766e;">${totalVacDays}d</strong></span>` : ''}
    ${totalNpJust > 0 ? `<span>·</span><span>Justificadas: <strong style="color:#3730a3;">${fmtHM(totalNpJust)}</strong></span>` : ''}
    ${totalNpNoJust > 0 ? `<span>·</span><span>No Justificadas: <strong style="color:#9f1239;">${fmtHM(totalNpNoJust)}</strong></span>` : ''}`;

  $('main-ruler').innerHTML = buildRuler(activeRange);
  document.querySelectorAll('#tbl-daily thead th.sortable').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.sort === col) th.classList.add(dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
  });

  const tbody = $('tbody-daily');
  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty">Sin operadores que coincidan con este filtro.</div></td></tr>`;
    return;
  }

  const html = [];
  for (const dr of sorted) {
    const exp = state.expandedKeys.has(dr.rowKey);
    const grp = GROUP_MAP[dr.groupId] || GROUP_MAP.ALL;
    const endHtml = dr.endTime
      ? `${escapeHtml(dr.endTime)}${dr.endNextDay ? '<span style="color:#db2777;font-size:10px;">+1d</span>' : ''}`
      : `<span class="pill-open">Abierta</span>`;
    const absentBadge = dr.isUnregisteredDay
      ? `<span class="np-tag-inline np-tag-unreg">⚠️ Sin registro</span>`
      : (dr.onlyVacacion
        ? `<span class="np-tag-inline np-tag-vac">🏖️ Vacaciones</span>`
        : (dr.onlyNoPresencial
          ? `<span class="np-tag-inline ${dr.npJustMin > 0 && dr.npNoJustMin === 0 ? 'np-tag-just' : 'np-tag-nojust'}">${dr.isPresencialDate ? 'Ausente' : 'Solo NP'}</span>`
          : ''));
    const timeSubLines = [`<div class="time-sub">Horario ${escapeHtml(formatSchedRange(dr.sched))}</div>`];
    if (dr.npTimeRange) timeSubLines.push(`<div class="time-sub" style="color:#4338ca;font-weight:700;">NP ${escapeHtml(dr.npTimeRange)}</div>`);
    if (dr.onlyVacacion) timeSubLines.push(`<div class="time-sub" style="color:#0f766e;font-weight:700;">Vacaciones (${escapeHtml(dr.vacRecords?.[0]?.vacEstado || 'Aceptado')})</div>`);
    if (dr.onlyNoPresencial) timeSubLines.push(`<div class="time-sub" style="color:${dr.npJustMin > 0 && dr.npNoJustMin === 0 ? '#4338ca' : '#9f1239'};">${dr.isPresencialDate ? 'Sin conexión en sede' : 'Solo registro NP'}</div>`);
    if (dr.isUnregisteredDay) timeSubLines.push(`<div class="time-sub" style="color:#991b1b;font-weight:700;">Sin presencial ni NP</div>`);

    const rowCls = dr.alertCount > 0 ? 'has-gap' : (dr.onlyVacacion ? 'is-vac-row' : (dr.onlyNoPresencial ? 'is-absent-row' : ''));

    html.push(`
      <tr class="day-row ${exp ? 'expanded' : ''} ${rowCls}" data-row-key="${escapeHtml(dr.rowKey)}">
        <td>
          <div class="op-cell">
            <span class="caret">▶</span>
            <div>
              <div class="op-name">${escapeHtml(dr.fullName)} ${absentBadge}</div>
              <div class="op-meta">
                ${showDate ? `<span class="date-tag mono">${escapeHtml(dr.fecha)}</span>` : ''}
                <span class="g-badge ${grp.badgeCls}">${grp.icon} ${grp.label}</span>
                <span class="sched-tag" title="Jornada laboral habitual de este operador">⏱ ${escapeHtml(dr.sched.label)}</span>
                <span class="mono">${escapeHtml(dr.usuario)}</span>
              </div>
            </div>
          </div>
        </td>
        <td class="time-cell">
          <div class="time-main" style="${dr.onlyNoPresencial || dr.onlyVacacion || dr.isUnregisteredDay ? 'color:#475569;' : ''}">${escapeHtml(dr.startTime)} → ${endHtml}</div>
          ${timeSubLines.join('')}
        </td>
        <td>${buildTimeline(dr, activeRange)}</td>
        <td>${buildStateBadges(dr)}</td>
        <td>${buildGapsCell(dr)}</td>
        <td class="hrs-cell">
          <div class="hrs-main" style="${dr.prodMin === 0 ? 'color:#94a3b8;' : ''}">${fmtHM(dr.prodMin)}</div>
          ${dr.nonProdMin > 0 ? `<div class="hrs-sub">+${fmtHM(dr.nonProdMin)} est.</div>` : ''}
          ${dr.vacMin > 0 ? `<div class="hrs-sub" style="color:#0f766e;font-weight:700;">${fmtHM(dr.vacMin)} Vac.</div>` : ''}
          ${dr.npTotalMin > 0 ? `<div class="hrs-sub" style="color:${dr.npNoJustMin > 0 ? '#9f1239' : '#3730a3'};font-weight:700;">${fmtHM(dr.npTotalMin)} NP</div>` : ''}
        </td>
      </tr>`);
    if (exp) html.push(buildDetailRow(dr, 6));
  }
  tbody.innerHTML = html.join('');
}

function renderOpView() {
  const { operators, activeRange } = state.computed;
  const sm = state.filters.opSort;
  const list = operators.slice().sort((a, b) => {
    if (sm === 'nombre') return a.fullName.localeCompare(b.fullName);
    if (sm === 'np') return (b.npTotalMin - a.npTotalMin) || (b.gapMin - a.gapMin) || a.fullName.localeCompare(b.fullName);
    if (sm === 'nonProd') return ((b.nonProdMin + b.npTotalMin) - (a.nonProdMin + a.npTotalMin)) || a.fullName.localeCompare(b.fullName);
    return (b.gapMin - a.gapMin) || (b.openCount - a.openCount) || (b.npTotalMin - a.npTotalMin) || a.fullName.localeCompare(b.fullName);
  });

  const unitP = state.role === 'SUPERVISORES' ? ['supervisor', 'supervisores'] : ['operador', 'operadores'];
  $('op-summary').innerHTML = `<span><strong>${list.length}</strong> ${list.length === 1 ? unitP[0] : unitP[1]}</span>`;
  const box = $('op-cards');
  if (!list.length) { box.innerHTML = `<div class="empty">Sin operadores para mostrar.</div>`; return; }
  const ruler = buildRuler(activeRange);

  box.innerHTML = list.map(op => {
    const grp = GROUP_MAP[op.groupId] || GROUP_MAP.ALL;
    const rows = op.days.map(dr => {
      const exp = state.expandedKeys.has('op_' + dr.rowKey);
      const endHtml = dr.endTime ? escapeHtml(dr.endTime) : `<span class="pill-open">Abierta</span>`;
      const rowCls = dr.alertCount > 0 ? 'has-gap' : (dr.onlyVacacion ? 'is-vac-row' : (dr.onlyNoPresencial ? 'is-absent-row' : ''));
      return `
        <tr class="day-row ${exp ? 'expanded' : ''} ${rowCls}" data-op-row-key="${escapeHtml(dr.rowKey)}">
          <td style="white-space:nowrap;width:125px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="caret">▶</span>
              <span class="mono" style="font-weight:700;font-size:12px;">${escapeHtml(formatDayShort(dr.fecha))}</span>
            </div>
          </td>
          <td class="time-cell">
            <div class="time-main" style="${dr.onlyNoPresencial || dr.onlyVacacion || dr.isUnregisteredDay ? 'color:#475569;' : ''}">${escapeHtml(dr.startTime)} → ${endHtml}</div>
            <div class="time-sub">Horario ${escapeHtml(formatSchedRange(dr.sched))}</div>
            ${dr.npTimeRange ? `<div class="time-sub" style="color:#4338ca;font-weight:700;">NP ${escapeHtml(dr.npTimeRange)}</div>` : ''}
            ${dr.onlyVacacion ? `<div class="time-sub" style="color:#0f766e;font-weight:700;">Vacaciones (${escapeHtml(dr.vacRecords?.[0]?.vacEstado || 'Aceptado')})</div>` : ''}
            ${dr.isUnregisteredDay ? `<div class="time-sub" style="color:#991b1b;font-weight:700;">Sin presencial ni NP</div>` : ''}
          </td>
          <td>${buildTimeline(dr, activeRange)}</td>
          <td>${buildStateBadges(dr)}</td>
          <td>${buildGapsCell(dr)}</td>
          <td class="hrs-cell">
            <div class="hrs-main" style="${dr.prodMin === 0 ? 'color:#94a3b8;' : ''}">${fmtHM(dr.prodMin)}</div>
            ${dr.vacMin > 0 ? `<div class="hrs-sub" style="color:#0f766e;font-weight:700;">${fmtHM(dr.vacMin)} Vac.</div>` : ''}
            ${dr.npTotalMin > 0 ? `<div class="hrs-sub" style="color:${dr.npNoJustMin > 0 ? '#9f1239' : '#3730a3'};font-weight:700;">${fmtHM(dr.npTotalMin)} NP</div>` : ''}
          </td>
        </tr>${exp ? buildDetailRow(dr, 6) : ''}`;
    }).join('');

    return `
      <div class="op-card">
        <div class="op-card-head">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong style="font-size:13.5px;">${escapeHtml(op.fullName)}</strong>
            <span class="g-badge ${grp.badgeCls}">${grp.icon} ${grp.label}</span>
            <span class="sched-tag">⏱ ${escapeHtml(op.schedLabel)}</span>
            <span class="mono" style="font-size:11px;color:var(--text-muted);">${escapeHtml(op.usuario)} · ${op.days.length}d</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;">
            <span style="color:#065f46;font-weight:700;">Presencial: ${fmtHM(op.prodMin)}</span>
            ${op.vacDays > 0 ? `<span class="np-tag-inline np-tag-vac">🏖️ Vac: ${op.vacDays}d</span>` : ''}
            ${op.npJustMin > 0 ? `<span class="np-tag-inline np-tag-just">✓ Justif: ${fmtHM(op.npJustMin)}</span>` : ''}
            ${op.npNoJustMin > 0 ? `<span class="np-tag-inline np-tag-nojust">✕ No Just: ${fmtHM(op.npNoJustMin)}</span>` : ''}
            ${op.gapCount > 0 ? `<span class="gap-pill">⚠️ ${op.gapCount} · ${fmtHM(op.gapMin)}</span>` : ''}
          </div>
        </div>
        <div class="table-scroll">
          <table class="sched" style="min-width:900px;">
            <thead><tr><th>Día</th><th>Inicio → Fin</th><th class="th-tl"><div class="ruler" style="margin:0;">${ruler}</div></th><th>Estados</th><th>Alertas / Sin Registro</th><th style="text-align:right;">Presencial</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}

function renderRawView() {
  const rows = state.computed.filteredRecords;
  const f = state.filters;
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / f.rawPageSize));
  if (f.rawPage > pages) f.rawPage = pages;
  const start = (f.rawPage - 1) * f.rawPageSize;
  const slice = rows.slice(start, start + f.rawPageSize);

  document.querySelectorAll('#raw-origin-tabs .raw-origin-btn').forEach(b => b.classList.toggle('active', b.dataset.origin === f.rawOrigin));
  $('raw-summary').innerHTML = `<span><strong>${total.toLocaleString('es-PE')}</strong> registros</span>`;
  $('raw-page-info').textContent = total ? `${start + 1}–${Math.min(start + f.rawPageSize, total)} de ${total.toLocaleString('es-PE')} (Pág. ${f.rawPage}/${pages})` : '0 registros';
  $('btn-raw-prev').disabled = f.rawPage <= 1;
  $('btn-raw-next').disabled = f.rawPage >= pages;

  $('tbody-raw').innerHTML = slice.length ? slice.map(r => {
    const st = getStateStyle(r.stateKey);
    const grp = GROUP_MAP[r._groupId] || GROUP_MAP.ALL;
    const originBadge = r.isVacacion
      ? `<span class="np-tag-inline np-tag-vac">Vacaciones</span>`
      : (r.isNoPresencial
        ? `<span class="np-tag-inline ${r.isJustificada ? 'np-tag-just' : 'np-tag-nojust'}">No Presencial</span>`
        : `<span class="np-tag-inline" style="background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;">Presencial</span>`);
    const stLabel = r.isVacacion ? `🏖️ ${r.vacTipo}` : (r.isNoPresencial ? `${r.isJustificada ? '✓' : '✕'} ${r.motivo}` : st.label);
    const closedOrRecup = r.isVacacion
      ? `<span class="np-tag-inline np-tag-vac">${escapeHtml(r.vacEstado || 'Aceptado')}</span>`
      : (r.isNoPresencial
        ? `<span class="np-tag-recup" style="${r.recuperarH === 'SI' ? '' : 'background:#f1f5f9;color:#64748b;border-color:#e2e8f0;'}">Recup: ${escapeHtml(r.recuperarH || '—')}</span>`
        : (r.isOpen ? '<span class="pill-open">NO</span>' : 'SI'));
    return `
      <tr>
        <td class="mono" style="white-space:nowrap;font-weight:600;">${escapeHtml(r.fecha)}</td>
        <td>${originBadge}</td>
        <td><strong>${escapeHtml(r.fullName)}</strong> <span class="mono" style="color:var(--text-muted);font-size:11px;">(${escapeHtml(r.usuario)})</span></td>
        <td><span class="g-badge ${grp.badgeCls}">${grp.icon} ${grp.label}</span></td>
        <td><span class="st-badge" style="--st-color:${st.color};--st-soft:${st.soft};--st-border:${st.border};--st-text:${st.text};"><span class="st-badge-dot"></span>${escapeHtml(stLabel)}</span></td>
        <td class="mono">${escapeHtml(r.startTimeStr)}</td>
        <td class="mono">${escapeHtml(r.endTimeStr || (r.isOpen ? 'Abierta' : '—'))}</td>
        <td class="mono" style="text-align:right;font-weight:700;">${fmtHM(r.durationMin)}</td>
        <td>${closedOrRecup}</td>
        <td class="obs-txt">${escapeHtml(r.obs || '—')}</td>
      </tr>`;
  }).join('') : `<tr><td colspan="10"><div class="empty">Sin registros.</div></td></tr>`;
}

// TOOLTIP
const tipEl = $('tip');
function posTip(e) {
  const r = tipEl.getBoundingClientRect();
  let x = e.clientX + 12, y = e.clientY + 12;
  if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 12;
  if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 12;
  tipEl.style.left = Math.max(8, x) + 'px';
  tipEl.style.top = Math.max(8, y) + 'px';
}
function showTip(seg, e) {
  const dr = state.computed.filteredDayRows.find(d => d.rowKey === seg.dataset.tipRow);
  const it = dr && dr.timelineItems[parseInt(seg.dataset.tipIdx, 10)];
  if (!it) return;
  const st = getStateStyle(it.stateKey);
  const title = it.kind === 'vac_record'
    ? `Vacaciones · ${it.vacTipo}`
    : (it.kind === 'np_record' ? `${it.tipo} · ${it.motivo}` : st.label);
  const obsFull = String(it.obs || '').trim();
  const obsShort = obsFull.length > 360 ? obsFull.slice(0, 355) + '… (clic en la fila para leer completo)' : obsFull;
  tipEl.innerHTML = `
    <div class="tip-h"><span style="width:9px;height:9px;border-radius:2px;background:${st.color};display:inline-block;flex-shrink:0;"></span>${escapeHtml(title)}</div>
    <div class="tip-r"><span>Operador</span><strong>${escapeHtml(dr.fullName)}</strong></div>
    <div class="tip-r"><span>Horario</span><strong>${escapeHtml(it.startTime)} → ${escapeHtml(it.endTime)} (${fmtHM(it.durationMin)})</strong></div>
    ${it.kind === 'record' ? `<div class="tip-r"><span>Cerrado</span><strong>${it.isOpen ? 'NO (Abierta)' : 'SI'}</strong></div>` : ''}
    ${it.kind === 'np_record' ? `<div class="tip-r"><span>Recuperar H.</span><strong>${escapeHtml(it.recuperarH || '—')}</strong></div>` : ''}
    ${it.kind === 'vac_record' ? `<div class="tip-r"><span>Estado</span><strong>${escapeHtml(it.vacEstado || 'Aceptado')}</strong></div>` : ''}
    ${obsShort ? `<div class="tip-o">${escapeHtml(obsShort)}</div>` : ''}`;
  tipEl.classList.add('show');
  posTip(e);
}
