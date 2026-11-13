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
const CALIB = { windowDays: 28, minFoodDays: 12, minWeighIns: 4, minSpanDays: 12, kcalPerKg: 7700 };

function analyzeCalibration() {
    const today = todayLocalISO();
    const from = addDays(today, -CALIB.windowDays);
    // Hoy no cuenta: el día aún no ha terminado
    const win = historyLogs.filter(h => h.date >= from && h.date < today);
    const fed = win.filter(h => num(h.kcalReal) > 0);
    const weighs = win
        .filter(h => h.weighed === true && num(h.weight) >= 30)
        .sort((a, b) => a.date.localeCompare(b.date));
    const dayIdx = d => Math.round((new Date(`${d}T12:00`) - new Date(`${from}T12:00`)) / 86400000);
    const span = weighs.length > 1 ? dayIdx(weighs[weighs.length - 1].date) - dayIdx(weighs[0].date) : 0;
    const res = { fedDays: fed.length, weighIns: weighs.length, span, ready: false };
    if (fed.length < CALIB.minFoodDays || weighs.length < CALIB.minWeighIns || span < CALIB.minSpanDays) return res;

    // Tendencia del peso (kg/día) con mínimos cuadrados: un pesaje raro pesa poco
    const xs = weighs.map(h => dayIdx(h.date));
    const ys = weighs.map(h => num(h.weight));
    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const mx = mean(xs), my = mean(ys);
    const slope = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);

    const avgIntake = mean(fed.map(h => num(h.kcalReal)));
    // Si comes X y no cambias de peso, gastas X. Si bajas, gastas más de lo que comes (7.700 kcal ≈ 1 kg)
    const realTDEE = avgIntake - slope * CALIB.kcalPerKg;
    const goalAdjOf = g => (g === 'surplus' ? 300 : g === 'cut' ? -300 : 0);
    const estRaw = mean(fed.map(h => num(h.maintRaw) || (num(h.kcalTarget) - goalAdjOf(h.goal)) / (num(h.calibration) || 1)));
    if (!(estRaw > 0)) return res;
    const ratio = realTDEE / estRaw;
    return { ...res, ready: true, slopeWeek: slope * 7, avgIntake, realTDEE, estRaw, ratio, suggested: clamp(ratio, 0.75, 1.3) };
}

function renderCalibrationCard() {
    const el = $('calibrationCard');
    const a = analyzeCalibration();
    const cur = getCalibration();
    const bar = v => `<div class="calib-progress"><div style="width:${Math.round(clamp(v, 0, 1) * 100)}%"></div></div>`;

    if (!a.ready) {
        el.innerHTML = `
            <p class="small" style="margin-bottom:10px;">Las fórmulas son una estimación (±15–20%). Para saber lo que gastas <strong>tú</strong>, la app compara lo que comes con cómo cambia tu peso. Necesita, en las últimas 4 semanas:</p>
            <div class="small">Días con <strong>todas</strong> tus comidas apuntadas: ${a.fedDays} / ${CALIB.minFoodDays}</div>
            ${bar(a.fedDays / CALIB.minFoodDays)}
            <div class="small">Pesajes (escribe tu peso en Hoy): ${a.weighIns} / ${CALIB.minWeighIns}, repartidos en ${CALIB.minSpanDays} días o más</div>
            ${bar(Math.min(a.weighIns / CALIB.minWeighIns, a.span / CALIB.minSpanDays))}
            <p class="muted small">Pésate por la mañana, en ayunas y después de ir al baño. Apunta todo lo que comas: si se te olvida algo, parecerá que gastas menos de lo real.</p>
            ${cur !== 1 ? `<p class="small">Ajuste aplicado ahora: ×${cur.toFixed(2)} <button class="link-btn" data-calib="reset">Quitar</button></p>` : ''}`;
    } else {
        const diffPct = Math.round((a.ratio - 1) * 100);
        const fits = Math.abs(diffPct) <= 3;
        const sign = v => (v > 0 ? '+' : '');
        el.innerHTML = `
            <div class="stats-grid">
                ${statHtml('Comes de media', `${fmtInt(a.avgIntake)} kcal`, `${a.fedDays} días apuntados`)}
                ${statHtml('Tu peso', `${sign(a.slopeWeek)}${a.slopeWeek.toFixed(2)} kg/sem`, `${a.weighIns} pesajes`)}
                ${statHtml('Gasto real', `${fmtInt(a.realTDEE)} kcal`, 'según tus datos')}
                ${statHtml('La app calculaba', `${fmtInt(a.estRaw)} kcal`, `${sign(diffPct)}${diffPct}% de diferencia`)}
            </div>
            <p class="small" style="margin-bottom:10px;">${fits
                ? 'El cálculo de la app ya encaja con tus datos.'
                : `Tu gasto real es un ${Math.abs(diffPct)}% ${diffPct > 0 ? 'mayor' : 'menor'} que el calculado. Aplica el ajuste para que todos tus objetivos lo tengan en cuenta.`}
                ${a.ratio !== a.suggested ? ' (La diferencia es muy grande: revisa que apuntas todo lo que comes. Se limita el ajuste por seguridad.)' : ''}</p>
            <div class="row">
                ${!fits && Math.abs(a.suggested - cur) > 0.005 ? `<button class="btn-green btn-sm" data-calib="apply">Aplicar ajuste ×${a.suggested.toFixed(2)}</button>` : ''}
                ${cur !== 1 ? `<button class="btn-secondary btn-sm" data-calib="reset">Quitar ajuste (ahora ×${cur.toFixed(2)})</button>` : ''}
            </div>
            <p class="muted small" style="margin-top:8px;">Revísalo cada pocas semanas: si cambias de etapa de entrenamiento, tu gasto cambia.</p>`;
    }

    el.querySelector('[data-calib="apply"]')?.addEventListener('click', () => setCalibration(a.suggested));
    el.querySelector('[data-calib="reset"]')?.addEventListener('click', () => setCalibration(1));
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
        mealSlots: templateSlots
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
