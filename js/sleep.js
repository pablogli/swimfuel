// SwimFuel · sueño: registro de cada noche, pestaña con tendencias y avisos
'use strict';

let sleepDurAuto = true;   // el tiempo dormido sale de las horas hasta que lo escribes a mano
let sleepChartPick = null; // noche elegida al tocar la gráfica

// ---------- Objetivo de horas ----------
function getSleepGoal() {
    const g = num((readJSON(STORAGE_KEY_PROFILE, {}) || {}).sleepGoalMin);
    return g >= 360 && g <= 660 ? g : defaultSleepGoal($('age').value);
}

function setSleepGoal(min) {
    const prof = readJSON(STORAGE_KEY_PROFILE, {}) || {};
    prof.sleepGoalMin = min;
    store.setItem(STORAGE_KEY_PROFILE, JSON.stringify(prof));
    renderSleepTab();
}

function chooseSleepGoal() {
    const current = getSleepGoal();
    const options = [];
    for (let m = 420; m <= 600; m += 30) {
        options.push({ label: fmtDuration(m) + (m === current ? '  ✓' : ''), run: () => setSleepGoal(m) });
    }
    openActionSheet('Objetivo de sueño por noche', options);
}

// ---------- Fila "Sueño" de la pantalla Hoy ----------
function sleepShortText(s) {
    if (!s) return '';
    const parts = [];
    if (s.min) parts.push(fmtDuration(s.min));
    if (s.quality !== null) parts.push(`nota ${s.quality}`);
    if (!s.min && s.nap) parts.push(`siesta ${s.nap} min`);
    return parts.join(' · ');
}

function updateSleepRow() {
    const el = $('sleepRowValue');
    el.textContent = sleepShortText(sleepState) || 'Apuntar';
    el.style.color = sleepState ? '' : 'var(--accent)';
}

// ---------- Hoja para apuntar la noche ----------
function openSleepModal() {
    const s = sleepState || {};
    const [y, m, d] = currentDate.split('-').map(Number);
    const cur = new Date(y, m - 1, d), prev = new Date(y, m - 1, d - 1);
    const wd = dt => dt.toLocaleDateString('es-ES', { weekday: 'long' });
    $('sleepNightLabel').textContent =
        `Noche del ${wd(prev)} al ${wd(cur)} ${cur.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}`;

    const setPair = (idH, idM, min) => {
        $(idH).value = min ? Math.floor(min / 60) : '';
        $(idM).value = min ? min % 60 : '';
    };
    $('sleepBed').value = s.bed || '';
    $('sleepWake').value = s.wake || '';
    setPair('sleepH', 'sleepM', s.min);
    $('sleepQuality').value = s.quality ?? '';
    $('sleepNap').value = s.nap || '';
    setPair('sleepDeepH', 'sleepDeepM', s.deep);
    setPair('sleepRemH', 'sleepRemM', s.rem);
    $('sleepHr').value = s.hr || '';
    $('sleepMore').open = Boolean(s.deep || s.rem || s.hr);
    sleepDurAuto = !s.min || s.min === sleepSpanMin(s.bed, s.wake);
    $('btnDeleteSleep').hidden = !sleepState;
    paintSleepSpan();
    openModal('modalSleep');
}

function pairMinutes(idH, idM) {
    return Math.round(num($(idH).value) * 60 + num($(idM).value));
}

// Con la hora de dormirte y la de despertarte se rellena solo el tiempo dormido (hasta que lo cambies a mano)
function paintSleepSpan() {
    const span = sleepSpanMin($('sleepBed').value, $('sleepWake').value);
    if (span && sleepDurAuto) {
        $('sleepH').value = Math.floor(span / 60);
        $('sleepM').value = span % 60;
    }
    const min = pairMinutes('sleepH', 'sleepM');
    $('sleepSpanHint').textContent = span && min && min !== span
        ? `Entre dormirte y despertarte hay ${fmtDuration(span)}; apuntas ${fmtDuration(min)} dormido.`
        : 'Copia los datos de tu reloj. Con las dos horas basta: el tiempo dormido se calcula solo y puedes corregirlo.';
}

function saveSleepFromModal() {
    const q = $('sleepQuality').value.trim();
    const s = sanitizeSleep({
        bed: $('sleepBed').value,
        wake: $('sleepWake').value,
        min: pairMinutes('sleepH', 'sleepM'),
        quality: q === '' ? null : q,
        nap: $('sleepNap').value,
        deep: pairMinutes('sleepDeepH', 'sleepDeepM'),
        rem: pairMinutes('sleepRemH', 'sleepRemM'),
        hr: $('sleepHr').value
    });
    if (!s) {
        showToast('Apunta al menos el tiempo dormido o la nota', COLOR.error);
        return;
    }
    if (s.min && s.deep + s.rem > s.min) {
        showToast('El sueño profundo y el REM suman más que el total', COLOR.error);
        return;
    }
    sleepState = s;
    closeModal('modalSleep');
    afterSleepChange('Sueño guardado');
}

function deleteSleep() {
    sleepState = null;
    closeModal('modalSleep');
    afterSleepChange('Sueño borrado');
}

function afterSleepChange(msg) {
    updateSleepRow();
    persistDay();
    if ($('tab_sleep').classList.contains('active')) renderSleepTab();
    showToast(msg);
}

// Desde la pestaña Sueño siempre se apunta la noche de hoy
function editLastNight() {
    if (currentDate !== todayLocalISO()) openDate(todayLocalISO());
    openSleepModal();
}

// ---------- Pestaña Sueño ----------
function renderSleepTab() {
    flushSave();
    const today = todayLocalISO();
    const goal = getSleepGoal();
    const sum = sleepSummary(historyLogs, today, goal);
    $('btnSleepGoal').textContent = `Objetivo ${fmtDuration(goal)}`;

    renderSleepLast(sum);
    renderSleepStats(sum);
    renderSleepChart(today, goal);
    renderRecovery(sum, today);

    const todayRec = historyLogs.find(h => h.date === today);
    const prof = readJSON(STORAGE_KEY_PROFILE, {}) || {};
    const advice = sleepAdvice(sum, {
        weight: lastWeighedBefore(addDays(today, 1)) || num(prof.weight),
        dayType: todayRec ? todayRec.dayType : prof.dayType
    });
    const tag = { warn: 'Aviso', info: 'Consejo', ok: 'Bien' };
    $('sleepAdviceSection').hidden = !advice.length;
    $('sleepAdvice').innerHTML = advice.map(a => `
        <div class="advice">
            <span class="status-pill status-${a.tone === 'warn' ? 'warn' : a.tone === 'ok' ? 'ok' : 'info'}">${tag[a.tone]}</span>
            <div class="advice-title">${escapeHtml(a.title)}</div>
            <div class="advice-text">${escapeHtml(a.text)}</div>
        </div>`).join('');

    const patterns = sleepPatterns(historyLogs, today, goal);
    $('sleepPatternsSection').hidden = !patterns.length;
    $('sleepPatterns').innerHTML = patterns.map(p => `
        <div class="advice">
            <div class="advice-title" style="margin-top:0;">${escapeHtml(p.title)}</div>
            <div class="advice-text">${escapeHtml(p.text)}</div>
        </div>`).join('');
}

function renderSleepLast(sum) {
    const s = sum.last;
    const el = $('sleepLastCard');
    if (!s) {
        el.innerHTML = `
            <div class="kpi-label">Anoche</div>
            <p class="small muted" style="margin:6px 0 12px;">Todavía no has apuntado cómo has dormido. Se tarda 10 segundos con los datos del reloj.</p>
            <button class="btn-primary btn-sm" id="btnSleepEdit">Apuntar el sueño de anoche</button>`;
    } else {
        const details = [];
        if (s.quality !== null) details.push(`nota ${s.quality}`);
        if (s.bed && s.wake) details.push(`${s.bed} → ${s.wake}`);
        if (s.nap) details.push(`siesta ${s.nap} min`);
        if (s.deep) details.push(`profundo ${fmtDuration(s.deep)}`);
        if (s.rem) details.push(`REM ${fmtDuration(s.rem)}`);
        if (s.hr) details.push(`${s.hr} ppm`);
        const pct = clamp(s.total / sum.goalMin, 0, 1) * 100;
        const diff = s.total - sum.goalMin;
        el.innerHTML = `
            <div class="row" style="justify-content:space-between; flex-wrap:nowrap;">
                <div>
                    <div class="kpi-label">Anoche</div>
                    <div class="sleep-big">${s.min ? fmtDuration(s.min) : '—'}</div>
                </div>
                <button class="btn-secondary btn-sm" id="btnSleepEdit">Editar</button>
            </div>
            <div class="small muted" style="margin-top:2px;">${escapeHtml(details.join(' · '))}</div>
            ${s.min ? `<div class="macro-bar" style="margin-top:12px;"><i style="width:${pct}%; background:var(--accent);"></i></div>
            <div class="macro-sub">${Math.abs(diff) < 10 ? 'justo en tu objetivo' : `${fmtDuration(Math.abs(diff))} ${diff < 0 ? 'por debajo' : 'por encima'} de tu objetivo`}${s.nap ? ', siesta incluida' : ''}</div>` : ''}`;
    }
    $('btnSleepEdit').addEventListener('click', editLastNight);
}

function renderSleepStats(sum) {
    const wk = sum.week, prev = sum.prevWeek;
    const el = $('sleepStats');
    if (!sum.month.nights && sum.month.avgQuality === null) {
        el.innerHTML = '';
        return;
    }
    let trend = `${wk.nights} noche${wk.nights === 1 ? '' : 's'} apuntada${wk.nights === 1 ? '' : 's'}`;
    if (wk.nights >= 3 && prev.nights >= 3) {
        const d = Math.round(wk.avgMin - prev.avgMin);
        trend = Math.abs(d) < 10 ? 'igual que la semana anterior' : `${d > 0 ? '+' : '−'}${Math.abs(d)} min que la semana anterior`;
    }
    const reg = sum.regularity;
    const regLabel = reg === null ? 'apunta las horas 4 noches' : reg <= 30 ? 'muy regulares' : reg <= 60 ? 'bastante regulares' : 'irregulares';
    const q = v => (v === null ? '—' : Math.round(v));

    el.innerHTML =
        statHtml('Media 7 días', wk.nights ? fmtDuration(wk.avgMin) : '—', trend) +
        statHtml('Nota media', q(wk.avgQuality), `28 días: ${q(sum.month.avgQuality)}`) +
        statHtml('Deuda de sueño', wk.nights ? (wk.debtMin >= 15 ? fmtDuration(wk.debtMin) : 'Sin deuda') : '—', 'últimos 7 días, con siestas') +
        statHtml('Horarios', reg === null ? '—' : `±${reg} min`, regLabel);
}

// Dos gráficas con el mismo eje de días: horas dormidas (barras) y nota (línea). Tocar un día muestra sus datos.
function renderSleepChart(today, goal) {
    const days = Array.from({ length: 28 }, (_, i) => addDays(today, i - 27));
    const byDate = Object.fromEntries(sleepNights(historyLogs, days[0], today).map(n => [n.date, n]));
    const logged = days.filter(d => byDate[d]);
    $('sleepChartCard').hidden = logged.length < 2;
    if (logged.length < 2) return;

    const W = 340, padL = 30, padR = 6, top = 10, hA = 104, gap = 30, hB = 44, padB = 20;
    const H = top + hA + gap + hB + padB;
    const step = (W - padL - padR) / days.length;
    const bw = step - 3;
    const maxMin = Math.ceil(Math.max(600, goal + 30, ...logged.map(d => byDate[d].total)) / 120) * 120;
    const yA = m => top + hA - (m / maxMin) * hA;
    const baseB = top + hA + gap + hB;
    const yB = q => baseB - (q / 100) * hB;
    const xOf = i => padL + i * step + 1.5;
    const label = (x, y, text, anchor = 'end') =>
        `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="10" style="fill:var(--text-3)">${text}</text>`;
    const grid = y => `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" style="stroke:var(--line)" stroke-width="1"/>`;
    // Barra con la punta redondeada y la base recta, apoyada en el eje
    const bar = (x, y, w, h, style) => {
        const r = Math.min(3, w / 2, h);
        return `<path d="M${x} ${y + h}V${y + r}a${r} ${r} 0 0 1 ${r} ${-r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${y + h}z" style="${style}"/>`;
    };

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Horas dormidas y nota de sueño de los últimos 28 días">`;
    for (let m = 0; m <= maxMin; m += 240) svg += grid(yA(m)) + label(padL - 6, yA(m) + 3.5, m ? `${m / 60} h` : '0');
    [0, 50, 100].forEach(q => { svg += grid(yB(q)) + label(padL - 6, yB(q) + 3.5, q); });
    svg += label(padL, top + hA + gap - 8, 'Nota', 'start');
    svg += `<line x1="${padL}" x2="${W - padR}" y1="${yA(goal)}" y2="${yA(goal)}" style="stroke:var(--text-2)" stroke-width="1.5" stroke-dasharray="4 4"/>`;

    let line = '', dots = '', pen = false;
    days.forEach((d, i) => {
        const n = byDate[d];
        const x = xOf(i);
        if (n && n.min) {
            svg += bar(x, yA(n.min), bw, top + hA - yA(n.min), 'fill:var(--accent)');
            if (n.nap) {
                const hNap = (n.nap / maxMin) * hA;
                svg += `<rect x="${x}" y="${yA(n.min) - 2 - hNap}" width="${bw}" height="${hNap}" rx="2" style="fill:var(--accent); opacity:0.45"/>`;
            }
        }
        if (n && n.quality !== null) {
            const cx = x + bw / 2, cy = yB(n.quality);
            line += `${pen ? 'L' : 'M'}${cx} ${cy}`;
            dots += `<circle cx="${cx}" cy="${cy}" r="2.5" style="fill:var(--text); stroke:var(--surface)" stroke-width="1.5"/>`;
            pen = true;
        } else {
            pen = false; // sin nota ese día: la línea se corta en vez de inventar el tramo
        }
        if (i % 7 === 6 || i === 0) svg += label(x + bw / 2, H - 5, formatDateES(d, true), 'middle');
    });
    svg += `<path d="${line}" fill="none" style="stroke:var(--text-2)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
    // Zonas táctiles: toda la columna del día, más ancha que la barra
    days.forEach((d, i) => {
        if (!byDate[d]) return;
        svg += `<rect class="sleep-hit" data-date="${d}" x="${padL + i * step}" y="${top}" width="${step}" height="${H - top - padB}" fill="transparent"><title>${escapeHtml(sleepReadoutText(byDate[d]))}</title></rect>`;
    });
    svg += '</svg>';

    $('sleepChart').innerHTML = svg + `
        <div class="legend">
            <span><i style="background:var(--accent)"></i>noche</span>
            <span><i style="background:var(--accent); opacity:0.45"></i>siesta</span>
            <span><i style="background:var(--text-2); width:12px; height:2px; border-radius:2px; vertical-align:3px;"></i>objetivo ${fmtDuration(goal)}</span>
        </div>`;

    const pick = date => {
        const n = byDate[date];
        if (!n) return;
        sleepChartPick = date;
        $('sleepReadout').textContent = sleepReadoutText(n);
        $('sleepChart').querySelectorAll('.sleep-hit').forEach(r => r.setAttribute('fill', r.dataset.date === date ? 'var(--accent-soft)' : 'transparent'));
    };
    $('sleepChart').querySelectorAll('.sleep-hit').forEach(r => r.addEventListener('click', () => pick(r.dataset.date)));
    pick(byDate[sleepChartPick] ? sleepChartPick : logged[logged.length - 1]);
}

function sleepReadoutText(n) {
    const parts = [formatDateES(n.date)];
    if (n.min) parts.push(fmtDuration(n.min));
    if (n.quality !== null) parts.push(`nota ${n.quality}`);
    if (n.nap) parts.push(`siesta ${n.nap} min`);
    if (n.hr) parts.push(`${n.hr} ppm`);
    return parts.join(' · ');
}

function initSleepUI() {
    $('sleepRow').addEventListener('click', openSleepModal);
    $('btnSaveSleep').addEventListener('click', saveSleepFromModal);
    $('btnDeleteSleep').addEventListener('click', deleteSleep);
    $('btnSleepGoal').addEventListener('click', chooseSleepGoal);
    ['sleepBed', 'sleepWake'].forEach(id => $(id).addEventListener('input', paintSleepSpan));
    ['sleepH', 'sleepM'].forEach(id => $(id).addEventListener('input', () => {
        sleepDurAuto = $('sleepH').value === '' && $('sleepM').value === '';
        paintSleepSpan();
    }));
    document.querySelectorAll('[data-nap]').forEach(b => b.addEventListener('click', () => { $('sleepNap').value = b.dataset.nap; }));
}

// Recuperación: sueño, carga y energía disponible, cada una con su dato (el gasto de los entrenos se
// recalcula con el modelo actual para que las semanas sean comparables)
function renderRecovery(sum, today) {
    const days = historyLogs.filter(h => h.date >= addDays(today, -35) && h.date < today).map(h => {
        const list = Array.isArray(h.sessions) ? sanitizeSessions(h.sessions) : legacySessions(h.dayType, h.swimMin, h.gymMin);
        const w = num(h.weight) >= 30 ? num(h.weight) : currentWeight();
        return { date: h.date, kcalReal: h.kcalReal, kcalTarget: h.kcalTarget, training: computeEnergy(w, list).training };
    });
    const prof = readJSON(STORAGE_KEY_PROFILE, {}) || {};
    const signals = recoverySignals({
        sleep: sum, days, today,
        weight: lastWeighedBefore(addDays(today, 1)) || num(prof.weight),
        bodyFat: $('bodyFat').value, sex: $('sex').value
    });
    const word = { ok: 'bien', info: 'atento', warn: 'aviso', none: '' };
    $('recoveryList').innerHTML = signals.map(s => `
        <div class="advice">
            <div class="row" style="justify-content:space-between; flex-wrap:nowrap;">
                <span class="advice-title" style="margin:0;">${escapeHtml(s.title)}</span>
                <span class="status-pill status-${s.tone === 'warn' ? 'warn' : s.tone}">${escapeHtml(s.value)}${word[s.tone] ? ` · ${word[s.tone]}` : ''}</span>
            </div>
            <div class="advice-text" style="margin-top:6px;">${escapeHtml(s.text)}</div>
        </div>`).join('');
}
