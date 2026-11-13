// SwimFuel · diario: resumen, calibración, exportar y copias
'use strict';

// ==========================================================
// HISTÓRICO
// ==========================================================
function goToDay(date) {
    openDate(date);
    switchTab('today');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Usa las comidas de un día guardado como plantilla para hoy (útil si comes parecido cada día)
function copyDayToToday(date) {
    const rec = historyLogs.find(h => h.date === date);
    if (!rec) return;
    goToDay(todayLocalISO());
    if (mealSlots.some(s => (mealsState[s.id] || []).length) &&
        !confirm(`Hoy ya tiene comidas. ¿Reemplazarlas por las del ${formatDateES(date)}?`)) return;
    const slots = sanitizeMealSlots(rec.mealSlotsSnapshot);
    if (slots.length) mealSlots = slots;
    mealsState = sanitizeMeals(rec.mealsSnapshot);
    renderMeals();
    onDayChanged();
    showToast(`Comidas del ${formatDateES(date)} copiadas a hoy`, COLOR.info);
}

function deleteDayFromHistory(date) {
    if (!confirm(`¿Borrar el ${formatDateES(date)} de tu diario?`)) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    historyLogs = historyLogs.filter(h => h.date !== date);
    saveHistory();
    if (date === currentDate) openDate(currentDate);
    renderHistory();
    showToast('Día borrado', COLOR.warn);
}

function clearAllHistory() {
    if (!confirm('¿Borrar TODO tu diario?\n\nConsejo: descarga antes una copia de seguridad.')) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    historyLogs = [];
    saveHistory();
    openDate(currentDate);
    renderHistory();
    showToast('Diario borrado', COLOR.error);
}

function renderHistory() {
    renderHistoryStats();
    renderHistoryChart();
    renderCalibrationCard();
    renderHistoryTable();
}

const statHtml = (label, value, sub = '') =>
    `<div class="stat"><div class="kpi-label">${label}</div><div class="stat-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;

// ==========================================================
// CALIBRACIÓN: tu gasto real a partir de lo que comes y de cómo cambia tu peso
// ==========================================================
function currentAnalysis() {
    return expenditureAnalysis(historyLogs, todayLocalISO(), estimateRecordRaw);
}

function calibAutoOn() {
    return (readJSON(STORAGE_KEY_PROFILE, {}) || {}).calibAuto !== false;
}

function setCalibAuto(on) {
    const prof = readJSON(STORAGE_KEY_PROFILE, {}) || {};
    prof.calibAuto = on;
    if (on) delete prof.calibDate;
    store.setItem(STORAGE_KEY_PROFILE, JSON.stringify(prof));
    if (on) autoCalibrate();
    recalculateTargets();
    scheduleSave();
    renderCalibrationCard();
    showToast(on ? 'Ajuste automático activado' : 'Ajuste automático en pausa');
}

// Una vez al día, el ajuste se acerca un poco al gasto real medido (salvo que lo tengas en pausa)
function autoCalibrate() {
    if (!calibAutoOn()) return;
    const prof = readJSON(STORAGE_KEY_PROFILE, {}) || {};
    const today = todayLocalISO();
    if (prof.calibDate === today) return;
    const a = currentAnalysis();
    // Una diferencia fuera de los límites casi siempre son comidas sin apuntar: no se aplica sola
    if (!a.ready || Math.abs(a.ratio - a.suggested) > 0.006) return;
    const days = DATE_RE.test(String(prof.calibDate))
        ? Math.round((new Date(`${today}T12:00`) - new Date(`${prof.calibDate}T12:00`)) / 86400000)
        : 3;
    prof.calibration = nextCalibration(getCalibration(), a.suggested, days);
    prof.calibDate = today;
    store.setItem(STORAGE_KEY_PROFILE, JSON.stringify(prof));
}

function renderCalibrationCard() {
    const el = $('calibrationCard');
    const a = currentAnalysis();
    const cur = getCalibration();
    const auto = calibAutoOn();
    const bar = v => `<div class="calib-progress"><div style="width:${Math.round(clamp(v, 0, 1) * 100)}%"></div></div>`;
    const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '');
    let html;

    if (!a.ready) {
        html = `
            <p class="small" style="margin-bottom:10px;">Las fórmulas son una estimación. Para saber lo que gastas <strong>tú</strong>, la app compara lo que comes con la tendencia de tu peso. Necesita, en las últimas 4 semanas:</p>
            <div class="small">Días con <strong>todas</strong> tus comidas apuntadas: ${a.fedDays} / ${CALIB.minFoodDays}</div>
            ${bar(a.fedDays / CALIB.minFoodDays)}
            <div class="small">Pesajes: ${a.weighIns} / ${CALIB.minWeighIns}, repartidos en ${CALIB.minSpanDays} días o más</div>
            ${bar(Math.min(a.weighIns / CALIB.minWeighIns, a.span / CALIB.minSpanDays))}
            <p class="muted small">Pésate por la mañana, en ayunas y después de ir al baño. Apunta todo lo que comas: si se te olvida algo, parecerá que gastas menos de lo real.</p>`;
    } else {
        const diffPct = Math.round((a.ratio - 1) * 100);
        const outOfRange = Math.abs(a.ratio - a.suggested) > 0.006;
        const pending = !outOfRange && Math.abs(a.suggested - cur) >= 0.01;
        html = `
            <div class="stats-grid">
                ${statHtml('Comes de media', `${fmtInt(a.avgIntake)} kcal`, `${a.fedDays} días completos`)}
                ${statHtml('Tendencia del peso', `${sign(a.slopeWeek)}${Math.abs(a.slopeWeek).toFixed(2).replace('.', ',')} kg`, `por semana · ${a.weighIns} pesajes`)}
                ${statHtml('Gasto real', `${fmtInt(a.realTDEE)} kcal`, `±${fmtInt(Math.round(a.marginKcal / 10) * 10)} por lo que baila el peso`)}
                ${statHtml('La app calculaba', `${fmtInt(a.estRaw)} kcal`, `${sign(diffPct)}${Math.abs(diffPct)} % de diferencia`)}
            </div>
            <p class="small" style="margin-bottom:10px;">${Math.abs(diffPct) <= 3
                ? 'El cálculo de la app ya encaja con tus datos.'
                : `Tu gasto real es un ${Math.abs(diffPct)} % ${diffPct > 0 ? 'mayor' : 'menor'} que el calculado.`}
                ${outOfRange ? ' Es una diferencia demasiado grande para ser real: casi seguro faltan comidas por apuntar. Hasta que cuadre, el ajuste no cambia solo.' : ''}
                ${auto
                    ? `Ajuste automático: ahora ×${cur.toFixed(2)}${pending ? `, y cada día se acerca un poco a ×${a.suggested.toFixed(2)}` : ''}.`
                    : `Ajuste automático en pausa (ahora ×${cur.toFixed(2)}).`}</p>`;
    }
    if (a.partial) {
        html += `<p class="muted small">${a.partial} día${a.partial === 1 ? '' : 's'} con menos del ${Math.round(CALIB.completeFrac * 100)} % del objetivo apuntado no cuenta${a.partial === 1 ? '' : 'n'}: parece${a.partial === 1 ? '' : 'n'} a medias.</p>`;
    }
    html += `
        <div class="chart-wrap" id="weightChart" style="margin-top:12px;"></div>
        <div class="chart-readout" id="weightReadout" aria-live="polite"></div>
        <div class="row" style="margin-top:10px;">
            <button class="btn-secondary btn-sm" data-calib="auto">${auto ? 'Pausar el ajuste automático' : 'Reanudar el ajuste automático'}</button>
            ${cur !== 1 ? `<button class="btn-secondary btn-sm" data-calib="reset">Quitar ajuste (×${cur.toFixed(2)})</button>` : ''}
        </div>`;
    el.innerHTML = html;

    el.querySelector('[data-calib="auto"]').addEventListener('click', () => setCalibAuto(!auto));
    el.querySelector('[data-calib="reset"]')?.addEventListener('click', () => {
        const prof = readJSON(STORAGE_KEY_PROFILE, {}) || {};
        prof.calibAuto = false;   // si no, mañana volvería a ajustarse solo
        store.setItem(STORAGE_KEY_PROFILE, JSON.stringify(prof));
        setCalibration(1);
    });
    renderWeightChart(a);
}

// Pesajes de las últimas 4 semanas (puntos) y la tendencia que usa el cálculo (línea). Tocar un punto muestra el dato.
function renderWeightChart(a) {
    const el = $('weightChart');
    const pts = a.weighs;
    if (pts.length < 2) {
        el.innerHTML = '';
        $('weightReadout').textContent = '';
        return;
    }
    const W = 340, H = 150, padL = 36, padR = 10, padT = 10, padB = 22;
    const ws = pts.map(p => p.w);
    const margin = Math.max(0.3, (Math.max(...ws) - Math.min(...ws)) * 0.15);
    const lo = Math.min(...ws) - margin, hi = Math.max(...ws) + margin;
    const x = d => padL + (d / CALIB.windowDays) * (W - padL - padR);
    const y = w => padT + (hi - w) / (hi - lo) * (H - padT - padB);
    const kg = w => w.toFixed(1).replace('.', ',');

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tu peso de las últimas 4 semanas y su tendencia">`;
    [lo + margin * 0.5, (lo + hi) / 2, hi - margin * 0.5].forEach(w => {
        svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(w)}" y2="${y(w)}" style="stroke:var(--line)" stroke-width="1"/>`;
        svg += `<text x="${padL - 6}" y="${y(w) + 3.5}" text-anchor="end" font-size="10" style="fill:var(--text-3)">${kg(w)}</text>`;
    });
    [0, 14, 28].forEach(d => {
        svg += `<text x="${x(d)}" y="${H - 6}" text-anchor="${d === 0 ? 'start' : d === 28 ? 'end' : 'middle'}" font-size="10" style="fill:var(--text-3)">${formatDateES(addDays(a.from, d), true)}</text>`;
    });
    if (a.trend) {
        const t = d => a.trend.intercept + a.trend.slope * d;
        const d0 = pts[0].x, d1 = pts[pts.length - 1].x;
        svg += `<line x1="${x(d0)}" y1="${y(t(d0))}" x2="${x(d1)}" y2="${y(t(d1))}" style="stroke:var(--accent)" stroke-width="2" stroke-linecap="round"/>`;
    }
    pts.forEach((p, i) => {
        svg += `<circle cx="${x(p.x)}" cy="${y(p.w)}" r="3.5" style="fill:var(--text); stroke:var(--surface)" stroke-width="1.5"/>`;
        svg += `<circle class="sleep-hit" data-i="${i}" cx="${x(p.x)}" cy="${y(p.w)}" r="12" fill="transparent"><title>${formatDateES(p.date)}: ${kg(p.w)} kg</title></circle>`;
    });
    svg += '</svg>';
    el.innerHTML = svg + `
        <div class="legend">
            <span><i style="background:var(--text)"></i>pesajes</span>
            <span><i style="background:var(--accent); width:12px; height:2px; border-radius:2px; vertical-align:3px;"></i>tendencia (la que usa el cálculo)</span>
        </div>`;

    const readout = $('weightReadout');
    const last = pts[pts.length - 1];
    readout.textContent = a.trend
        ? `Tendencia: de ${kg(a.trend.intercept + a.trend.slope * pts[0].x)} a ${kg(a.trend.intercept + a.trend.slope * last.x)} kg. Último pesaje: ${kg(last.w)} kg.`
        : `Último pesaje: ${kg(last.w)} kg. Con 4 pesajes se dibuja la tendencia.`;
    el.querySelectorAll('.sleep-hit').forEach(c => c.addEventListener('click', () => {
        const p = pts[Number(c.dataset.i)];
        readout.textContent = `${formatDateES(p.date)}: ${kg(p.w)} kg` +
            (a.trend ? ` · tendencia ${kg(a.trend.intercept + a.trend.slope * p.x)} kg` : '');
    }));
}

function setCalibration(value) {
    const prof = readJSON(STORAGE_KEY_PROFILE, {}) || {};
    prof.calibration = Math.round(value * 100) / 100;
    store.setItem(STORAGE_KEY_PROFILE, JSON.stringify(prof));
    recalculateTargets();
    scheduleSave();
    renderCalibrationCard();
    showToast(value === 1 ? 'Ajuste quitado' : `Ajuste ×${prof.calibration.toFixed(2)} aplicado a tus objetivos`);
}

function updateCalibrationInfo() {
    const cur = getCalibration();
    $('calibrationInfo').innerHTML = cur !== 1
        ? `Ajuste por tus datos: <strong>×${cur.toFixed(2)}</strong> <button class="link-btn" id="btnResetCalibProfile">Quitar</button>`
        : '<span class="muted">Sin ajuste por tus datos todavía: se calcula en Diario → Tu gasto real.</span>';
    $('btnResetCalibProfile')?.addEventListener('click', () => setCalibration(1));
}

function renderHistoryStats() {
    const n = historyLogs.length;
    const el = $('historyStats');
    if (!n) {
        el.innerHTML = `<p class="muted small" style="grid-column:1/-1;">Todavía no hay días en tu diario. Añade comidas en "Hoy" y aparecerán aquí solas.</p>`;
        return;
    }
    // Las medias solo cuentan días con comida registrada (un día con solo notas no es un 0%)
    // Hoy no cuenta en las medias: el día aún no ha terminado
    const logged = historyLogs.filter(h => num(h.kcalReal) > 0 && h.date < todayLocalISO());
    const pcts = logged.filter(h => num(h.kcalTarget) > 0).map(h => num(h.kcalReal) / num(h.kcalTarget) * 100);
    const avgPct = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;
    const inRange = pcts.filter(p => p >= 90 && p <= 110).length;
    const protKg = logged.length ? logged.reduce((a, h) => a + num(h.pReal) / (num(h.weight) || 1), 0) / logged.length : 0;
    const chrono = [...historyLogs].reverse();
    const weighed = chrono.filter(h => h.weighed !== false && num(h.weight) >= 30);
    const w0 = weighed.length ? num(weighed[0].weight) : 0;
    const w1 = weighed.length ? num(weighed[weighed.length - 1].weight) : 0;
    const dw = round1(w1 - w0);
    const swimM = historyLogs.filter(h => h.date >= addDays(todayLocalISO(), -6)).reduce((a, h) => a + num(h.swimMeters), 0);

    el.innerHTML =
        statHtml('Días registrados', n, `desde el ${formatDateES(chrono[0].date)}`) +
        statHtml('Energía media', `<span class="status-pill status-${statusOf(avgPct)}" style="font-size:1rem;">${avgPct}%</span>`, 'del objetivo de kcal') +
        statHtml('Días en objetivo', `${inRange} / ${pcts.length}`, 'entre 90% y 110% de las kcal') +
        statHtml('Proteína media', `${protKg.toFixed(1)} g/kg`, 'objetivo habitual 1,9–2,3') +
        statHtml('Metros esta semana', `${fmtInt(swimM)} m`, 'últimos 7 días') +
        statHtml('Peso actual', w1 ? `${w1.toFixed(1)} kg` : '—', weighed.length > 1 ? `${dw > 0 ? '+' : ''}${dw.toFixed(1)} kg desde el inicio` : 'apunta tu peso en "Hoy"');
}

// Gráfica SVG sin librerías: kcal consumidas (barras) frente al objetivo (marca) en los últimos 30 días
function renderHistoryChart() {
    const el = $('historyChart');
    const days = historyLogs.filter(h => num(h.kcalReal) > 0 && h.date < todayLocalISO()).slice(0, 30).reverse();
    el.parentElement.hidden = !historyLogs.length;
    if (days.length < 2) {
        el.innerHTML = '<p class="small muted" style="padding:4px 4px 2px;">Con 2 días completos verás aquí cómo cumples tu objetivo.</p>';
        return;
    }

    const W = Math.max(340, days.length * 24), H = 190;
    const padL = 36, padR = 8, padT = 10, padB = 24;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxVal = Math.max(...days.map(d => Math.max(num(d.kcalReal), num(d.kcalTarget)))) * 1.08 || 1;
    const tickStep = Math.max(1000, Math.ceil(maxVal / 3 / 1000) * 1000);
    const y = v => padT + plotH - (v / maxVal) * plotH;
    const step = plotW / days.length;
    const bw = Math.min(14, step * 0.55);
    const fill = { ok: 'var(--accent)', warn: 'var(--warn)', low: 'var(--danger)' };
    const labelEvery = Math.ceil(days.length / 8);

    // Con muchos días la gráfica se desplaza de lado en vez de apretar las barras
    let svg = `<svg viewBox="0 0 ${W} ${H}" style="min-width:${days.length > 14 ? days.length * 18 : 0}px" role="img" aria-label="Kcal consumidas frente al objetivo en los últimos ${days.length} días">`;
    for (let v = 0; v <= maxVal; v += tickStep) {
        svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)" stroke-width="1"/>`;
        svg += `<text x="${padL - 8}" y="${y(v) + 3.5}" text-anchor="end" font-size="10" style="fill:var(--text-3)">${v ? `${v / 1000}k` : 0}</text>`;
    }
    days.forEach((d, i) => {
        const real = num(d.kcalReal), target = num(d.kcalTarget);
        const pct = target > 0 ? Math.round(real / target * 100) : 0;
        const x = padL + i * step + (step - bw) / 2;
        svg += `<g><title>${formatDateES(d.date)}: ${real} / ${target} kcal (${pct}%)</title>`;
        svg += `<rect x="${x}" y="${y(real)}" width="${bw}" height="${Math.max(0, padT + plotH - y(real))}" rx="${bw / 2}" style="fill:${fill[statusOf(pct)]}"/>`;
        svg += `<line x1="${x - 3}" x2="${x + bw + 3}" y1="${y(target)}" y2="${y(target)}" style="stroke:var(--text-2)" stroke-width="2" stroke-linecap="round"/></g>`;
        if (i % labelEvery === 0) {
            svg += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="10" style="fill:var(--text-3)">${formatDateES(d.date, true)}</text>`;
        }
    });
    svg += '</svg>';

    el.innerHTML = svg + `
        <div class="legend">
            <span><i style="background:var(--accent)"></i>en objetivo (±10%)</span>
            <span><i style="background:var(--warn)"></i>cerca</span>
            <span><i style="background:var(--danger)"></i>lejos</span>
            <span><i style="background:var(--text-2); width:12px; height:2px; border-radius:2px; vertical-align:3px;"></i>objetivo</span>
        </div>`;
}

// Lista de días del diario: tocar abre el día; "⋯" para copiar o borrar
function renderHistoryTable() {
    const box = $('dayList');
    if (!historyLogs.length) {
        box.innerHTML = '<div class="empty-note">Tu diario está vacío. Lo que apuntes en Hoy aparecerá aquí.</div>';
        return;
    }
    const today = todayLocalISO();
    const barColor = { ok: 'var(--accent)', warn: 'var(--warn)', low: 'var(--danger)' };
    box.innerHTML = '';

    historyLogs.forEach(h => {
        const kR = num(h.kcalReal), kT = num(h.kcalTarget);
        const pct = kT > 0 ? Math.round(kR / kT * 100) : 0;
        const [y, m, d] = h.date.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        const short = dt.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
        const rel = relativeDayName(h.date);
        const title = ['Hoy', 'Ayer', 'Mañana'].includes(rel)
            ? `${rel} · ${dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`
            : short.charAt(0).toUpperCase() + short.slice(1);
        const sub = [sessionsSummary(h), h.weighed !== false && num(h.weight) >= 30 ? `${num(h.weight).toFixed(1)} kg` : '', sleepLabel(h.sleep)]
            .filter(Boolean).join(' · ');

        const row = document.createElement('div');
        row.className = 'day-row';
        row.title = h.mealsTextSummary || '';
        row.innerHTML = `
            <button class="day-main" type="button">
                <span class="day-info">
                    <span class="day-title" style="display:block;">${escapeHtml(title)}</span>
                    <span class="day-sub" style="display:block;">${sub}</span>
                </span>
                <span class="day-kcal">${kR
                    ? `<strong>${fmtInt(kR)}</strong><small>de ${fmtInt(kT)} kcal</small><span class="day-bar"><i style="width:${Math.min(100, pct)}%; background:${barColor[statusOf(pct)]};"></i></span>`
                    : '<small>sin comidas</small>'}</span>
            </button>
            <button class="icon-btn" data-act="more" aria-label="Opciones del día">${icon('more')}</button>`;

        row.querySelector('.day-main').addEventListener('click', () => goToDay(h.date));
        row.querySelector('[data-act="more"]').addEventListener('click', () => openActionSheet(title, [
            { label: 'Abrir día', icon: 'open', run: () => goToDay(h.date) },
            ...(h.date !== today ? [{ label: 'Copiar sus comidas a hoy', icon: 'copy', run: () => copyDayToToday(h.date) }] : []),
            { label: 'Borrar día', icon: 'trash', danger: true, run: () => deleteDayFromHistory(h.date) }
        ]));
        box.appendChild(row);
    });
}

// ---------- Exportar / copias de seguridad ----------
// CSV con ";" y coma decimal: se abre directamente en Excel en español y en Google Sheets
function exportHistoryToCSV() {
    if (!historyLogs.length) {
        showToast('Guarda al menos un día antes de exportar', COLOR.error);
        return;
    }
    const dec = v => String(round1(num(v))).replace('.', ',');
    // Texto entre comillas; si empieza por =, +, - o @ se protege para que Excel no lo trate como fórmula
    const txt = v => {
        let s = String(v ?? '');
        if (/^[=+\-@]/.test(s)) s = "'" + s;
        return `"${s.replace(/"/g, '""')}"`;
    };
    const headers = ['Fecha', 'Peso (kg)', 'Pesado', 'Jornada', 'Agua (min)', 'Agua (m)', 'Gym (min)', 'Otros (min)',
        'Gasto entrenos (kcal)', 'Kcal', 'Kcal objetivo', '% kcal',
        'Carbs (g)', 'Carbs objetivo (g)', 'Carbs (g/kg)',
        'Proteína (g)', 'Proteína objetivo (g)', 'Proteína (g/kg)',
        'Grasas (g)', 'Grasas objetivo (g)', 'Grasas (g/kg)',
        'Sueño (h)', 'Nota sueño', 'Siesta (min)', 'Me dormí', 'Me desperté', 'Pulso en reposo',
        'Comidas', 'Notas'];
    const rows = historyLogs.map(h => {
        const w = num(h.weight) || 1;
        const pct = num(h.kcalTarget) > 0 ? Math.round(num(h.kcalReal) / num(h.kcalTarget) * 100) : 0;
        const sl = sanitizeSleep(h.sleep) || {};
        return [
            h.date, dec(h.weight), h.weighed === false ? 'no' : 'sí', txt(h.dayType),
            num(h.swimMin), num(h.swimMeters), num(h.gymMin), num(h.otherMin), num(h.trainingKcal),
            num(h.kcalReal), num(h.kcalTarget), pct,
            num(h.cReal), num(h.cTarget), dec(num(h.cReal) / w),
            num(h.pReal), num(h.pTarget), dec(num(h.pReal) / w),
            num(h.fReal), num(h.fTarget), dec(num(h.fReal) / w),
            sl.min ? dec(sl.min / 60) : '', sl.quality ?? '', sl.nap || '', sl.bed || '', sl.wake || '', sl.hr || '',
            txt(h.mealsTextSummary), txt(h.notes)
        ].join(';');
    });
    downloadBlob(['\uFEFF' + headers.join(';') + '\r\n' + rows.join('\r\n')], 'text/csv;charset=utf-8',
        `SwimFuel_Historico_${todayLocalISO()}.csv`);
    showToast('Histórico exportado (ábrelo con Excel o Google Sheets)');
}

function exportFullBackup() {
    const backup = {
        app: 'SwimFuel',
        version: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        foodDB,
        historyLogs,
        profile: readJSON(STORAGE_KEY_PROFILE, null),
        mealSlots: templateSlots,
        dishes
    };
    downloadBlob(JSON.stringify(backup, null, 2), 'application/json', `SwimFuel_Copia_${todayLocalISO()}.json`);
    store.setItem(STORAGE_KEY_LAST_BACKUP, String(Date.now()));
    updateBackupStatus();
    showToast('Copia descargada: guárdala en Drive, iCloud o envíatela');
}

// Tus datos solo viven en el móvil: se recuerda hacer copia cada 2 semanas
function updateBackupStatus() {
    const last = num(store.getItem(STORAGE_KEY_LAST_BACKUP), 0);
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    const needs = historyLogs.length >= 3 && (days === null || days >= 14);
    const el = $('backupStatus');
    el.textContent = days === null
        ? 'Todavía no has hecho ninguna copia de seguridad.'
        : `Última copia: ${days === 0 ? 'hoy' : `hace ${days} día${days === 1 ? '' : 's'}`}.`;
    el.style.color = needs ? '#fbbf24' : '';
    return needs;
}

function importFullBackup(event) {
    const input = event.target;
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            const foods = Array.isArray(data.foodDB) ? data.foodDB.map(sanitizeFood).filter(Boolean) : null;
            const hist = Array.isArray(data.historyLogs) ? cleanHistory(data.historyLogs) : null;
            if (!foods && !hist) throw new Error('formato no reconocido');

            if (!confirm(`Restaurar esta copia reemplazará tus datos actuales:\n` +
                `• ${foods ? foods.length : 0} alimentos (ahora tienes ${foodDB.length})\n` +
                `• ${hist ? hist.length : 0} días (ahora tienes ${historyLogs.length})\n\n¿Continuar?`)) return;

            clearTimeout(saveTimer); // que no se cuele un guardado pendiente del día abierto
            saveTimer = null;
            if (foods) foodDB = foods;
            if (hist) { historyLogs = hist; sortHistory(); }
            if (data.profile && typeof data.profile === 'object') {
                const prof = mergeProfile(readJSON(STORAGE_KEY_PROFILE, {}), data.profile);
                store.setItem(STORAGE_KEY_PROFILE, JSON.stringify(prof));
                PROFILE_FIELDS.forEach(k => { if (prof[k]) $(k).value = prof[k]; });
            }
            if (Array.isArray(data.dishes)) { dishes = sanitizeDishes(data.dishes); saveDishes(); }
            const slots = sanitizeMealSlots(data.mealSlots);
            if (slots.length) { mealSlots = slots; saveSlots(); }

            saveFoodDB();
            saveHistory();
            openDate(currentDate);
            renderFoodTable();
            renderHistory();
            showToast('Copia restaurada correctamente');
        } catch (err) {
            showToast('El archivo no es una copia válida de SwimFuel', COLOR.error);
        } finally {
            input.value = '';
        }
    };
    reader.readAsText(file);
}
