// SwimFuel · pantalla Hoy: objetivos, entrenos y comidas
'use strict';

// ==========================================================
// OBJETIVOS DEL DÍA
// ==========================================================
// Gasto del día: base (basal × actividad) + extra de cada entreno, × ajuste por tus datos, ± objetivo
function computeEnergy(weight) {
    const sex = $('sex').value;
    const age = num($('age').value, 20) || 20;
    const height = num($('height').value, 185) || 185;
    const activity = clamp(num($('activity').value, 1.4) || 1.4, 1.2, 1.9);
    const goal = $('goal').value;

    const bmr = restingEnergy({ sex, age, height, weight, bodyFat: $('bodyFat').value });
    const paces = swimPaces({ pb50: $('pb50').value, pb100: $('pb100').value, pb200: $('pb200').value, pb400: $('pb400').value });
    const perSession = sessions.map(s => ({ id: s.id, type: s.type, ...sessionKcal(s, { weight, sex, paces }) }));
    const trainMin = sessions.reduce((a, s, k) => {
        const d = perSession[k].detail;
        return a + (num(s.minutes) || (d ? d.swimMin + d.restMin : 0));
    }, 0);
    const base = baseEnergy(bmr, activity, trainMin);
    const training = perSession.reduce((a, s) => a + s.kcal, 0);
    const calibration = getCalibration();
    const maint = (base + training) * calibration;
    const goalAdj = goal === 'surplus' ? 300 : goal === 'cut' ? -300 : 0;
    const margin = dayMargin(base, perSession) * calibration;
    return { bmr, activity, base, perSession, training, calibration, maint, goalAdj, paces, margin, total: maint + goalAdj };
}

function recalculateTargets() {
    const weight = currentWeight();
    const specialty = $('specialty').value;
    const dayType = $('dayType').value;
    const goal = $('goal').value;

    energy = computeEnergy(weight);
    const totalKcal = energy.total;

    const protFactor = goal === 'cut' ? 2.3 : (specialty === 'distance' ? 1.9 : 2.1);
    const carbByDay = {
        'Agua + Gimnasio': 6.5,
        'Doble Sesión Agua': 8.5,
        'Sesión Única Intensa': 6.0,
        'Competición': 7.5,
        'Tapering': 5.0,
        'Descanso': 4.0
    };
    const carbFactor = (carbByDay[dayType] ?? 6.0) + (specialty === 'distance' ? 1.0 : 0);

    const p = weight * protFactor;
    let c = weight * carbFactor;
    // Grasas = energía restante, entre 1 g/kg y el 30% de las kcal; el exceso pasa a carbohidratos
    let f = (totalKcal - c * 4 - p * 4) / 9;
    const minF = weight * 1.0;
    const maxF = (totalKcal * 0.30) / 9;
    if (f > maxF) {
        c += ((f - maxF) * 9) / 4;
        f = maxF;
    }
    f = Math.max(minF, f);

    targets = {
        weight,
        c: Math.round(c),
        p: Math.round(p),
        f: Math.round(f),
        kcal: calcKcal(Math.round(c), Math.round(p), Math.round(f))
    };

    paintEnergy();
    renderRecommendations(weight, dayType, sessions.reduce((a, s) => a + num(s.minutes), 0));
    saveProfile();
    updateCalibrationInfo();
    updateSummaryUI();
}

// Muestra el gasto de cada entreno y de dónde sale el objetivo del día
function paintEnergy() {
    energy.perSession.forEach(ps => {
        const el = document.querySelector(`.session[data-sid="${ps.id}"]`);
        const s = sessions.find(x => x.id === ps.id);
        if (!el || !s) return;
        el.querySelector('.s-kcal').innerHTML = `${fmtInt(ps.kcal)} <small>kcal</small>`;
        el.querySelector('.s-title').textContent = sessionTitle(s);
        el.querySelector('.s-sub').textContent = sessionSubtitle(s);
        el.querySelector('.s-how').textContent = `Calculado ${ps.how}. Margen ±${ps.pct} %`;
        const linesBox = el.querySelector('[data-lines]');
        if (linesBox) linesBox.innerHTML = swimLinesHtml(ps.detail);
        const rpeBox = el.querySelector('[data-rpe-box]');
        if (rpeBox && s.type === 'swim') rpeBox.hidden = Boolean(ps.detail && ps.detail.hasZones);
    });

    const byType = { swim: 0, gym: 0, other: 0 };
    energy.perSession.forEach(ps => { byType[ps.type] += ps.kcal; });
    const parts = [`base ${fmtInt(energy.base)}`];
    if (byType.swim) parts.push(`agua ${fmtInt(byType.swim)}`);
    if (byType.gym) parts.push(`gimnasio ${fmtInt(byType.gym)}`);
    if (byType.other) parts.push(`otros ${fmtInt(byType.other)}`);

    let html = energy.calibration !== 1
        ? `Gasto estimado: (${parts.join(' + ')}) × ${energy.calibration.toFixed(2)} por tus datos`
        : `Gasto estimado: ${parts.join(' + ')}`;
    html += ` = <strong>${fmtInt(energy.maint)} kcal</strong> (±${fmtInt(Math.round(energy.margin / 10) * 10)})`;
    if (energy.goalAdj) html += `, ${energy.goalAdj > 0 ? '+' : '−'}${Math.abs(energy.goalAdj)} por tu objetivo`;
    html += '.';
    if (!isWeighed()) html += ` Con tu último peso (${fallbackWeight().toFixed(1)} kg).`;
    $('energyBreakdown').innerHTML = html;

    // Ritmos que la app deduce de tus marcas (Perfil)
    const p = energy.paces;
    $('pacesInfo').innerHTML = (p.known ? 'Tus ritmos de crol por 100 m: ' : 'Sin marcas se suponen estos ritmos por 100 m: ') +
        ZONE_KEYS.map(z => `${ZONES[z].short} <strong>${fmtPace(p.speeds[z])}</strong>`).join(' · ') +
        '. Con el 200 y el 400 salen más ajustados.';
}

// ---------- Entrenos: filas que se despliegan al tocarlas ----------
const SET_CHIPS = ['AEL', 'AEM', 'AEI', 'VO2', 'R200', 'R100', 'VEL', 'suave', 'pies', 'brazos', 'técnica', 'aletas', 'palas', 'espalda', 'braza', 'mariposa', 'estilos'];

// Lo que la app ha entendido de cada línea de las series, con su gasto
function swimLinesHtml(detail) {
    if (!detail) return '';
    const rows = Object.keys(detail.lines).map(Number).sort((a, b) => a - b).map(k => {
        const l = detail.lines[k];
        const parts = l.parts.length > 1
            ? ': ' + l.parts.map(p => `${fmtInt(p.meters)} ${p.label}`.trim()).join(' · ')
            : (l.parts[0].label ? ' ' + l.parts[0].label : '');
        return `<div class="set-line"><span>${fmtInt(l.meters)} m${escapeHtml(parts)}</span><span>${fmtInt(l.kcal)} kcal</span></div>`;
    });
    const name = k => (ZONES[k] ? ZONES[k].short : SWIM_MODES[k] ? SWIM_MODES[k].label : '');
    const order = [...ZONE_KEYS, 'kick', 'pull', 'drill'];
    const totals = order.filter(k => detail.byKey[k]).map(k => `${name(k)} ${fmtInt(detail.byKey[k])}`);
    if (rows.length && totals.length > 1) rows.push(`<div class="set-total">${escapeHtml(totals.join(' · '))} m</div>`);
    return rows.join('');
}

const openSessions = new Set();

function optionsHtml(map, selected) {
    return Object.entries(map)
        .map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${v.label}</option>`)
        .join('');
}

function sessionTitle(s) {
    return s.type === 'other' && s.label.trim() ? s.label.trim() : SESSION_TYPES[s.type].label;
}

function sessionSubtitle(s) {
    const parts = [];
    if (s.type === 'swim') {
        if (num(s.meters)) parts.push(`${fmtInt(s.meters)} m`);
        if (num(s.minutes)) parts.push(`${num(s.minutes)} min`);
        parts.push((STROKES[s.stroke] || STROKES.crawl).label.toLowerCase());
    } else {
        if (s.type === 'gym') parts.push((GYM_TYPES[s.gymType] || GYM_TYPES.strength).label);
        if (num(s.minutes)) parts.push(`${num(s.minutes)} min`);
    }
    if (s.type !== 'swim' || !parseSets(s.sets).hasZones) parts.push(`intensidad ${s.rpe}`);
    return parts.join(' · ');
}

function renderSessions() {
    const c = $('sessionsContainer');
    c.innerHTML = '';
    if (!sessions.length) {
        c.innerHTML = '<div class="empty-note">Día de descanso. Pulsa Añadir si has entrenado.</div>';
        return;
    }
    sessions.forEach(s => c.appendChild(buildSessionCard(s)));
}

function buildSessionCard(s) {
    const el = document.createElement('div');
    const isOpen = openSessions.has(s.id);
    el.className = `session${isOpen ? ' open' : ''}`;
    el.dataset.sid = s.id;
    const minutesField = `<div><label>Minutos</label><input type="number" data-f="minutes" value="${s.minutes || ''}" min="0" step="5" inputmode="numeric" placeholder="0"></div>`;

    let fields;
    if (s.type === 'swim') {
        fields = `
            <div class="span-all">
                <label>Series, una por línea</label>
                <textarea data-f="sets" rows="5" placeholder="300 crol&#10;8x100 c/1:30 AEM&#10;12x50 (1 AEL, 1 pies)&#10;6x50 R100 c/2:00&#10;200 suave" autocomplete="off" autocapitalize="off" spellcheck="false">${escapeHtml(s.sets)}</textarea>
                <div class="chips set-chips" data-chips></div>
                <div class="sets-lines" data-lines></div>
                <div class="sets-hint" data-hint></div>
            </div>
            <div><label>Metros</label><input type="number" data-f="meters" value="${s.meters || ''}" min="0" step="50" inputmode="numeric" placeholder="—"></div>
            ${minutesField}
            <div><label>Estilo base</label><select data-f="stroke">${optionsHtml(STROKES, s.stroke)}</select></div>`;
    } else if (s.type === 'gym') {
        fields = `
            <div class="span-2"><label>Tipo</label><select data-f="gymType">${optionsHtml(GYM_TYPES, s.gymType)}</select></div>
            ${minutesField}`;
    } else {
        fields = `
            <div class="span-2"><label>Actividad</label><input type="text" data-f="label" value="${escapeHtml(s.label)}" placeholder="Correr, bici, waterpolo…" maxlength="40"></div>
            ${minutesField}`;
    }

    el.innerHTML = `
        <button class="session-row" type="button" aria-expanded="${isOpen}">
            <span class="s-icon">${icon(s.type)}</span>
            <span class="s-main"><span class="s-title">${escapeHtml(sessionTitle(s))}</span><span class="s-sub">${escapeHtml(sessionSubtitle(s))}</span></span>
            <span class="s-kcal"></span>
            ${icon('chevronDown', 's-chev')}
        </button>
        <div class="session-body">
            <div class="s-grid">${fields}</div>
            <div class="rpe" data-rpe-box>
                <div class="rpe-top"><span>Intensidad</span><strong data-rpe-label></strong></div>
                <input type="range" data-f="rpe" min="1" max="10" step="1" value="${s.rpe}" aria-label="Intensidad del 1 al 10">
            </div>
            <div class="s-foot"><span class="s-how"></span><button class="text-btn" data-act="remove" style="color:var(--danger);">Quitar</button></div>
        </div>`;

    const row = el.querySelector('.session-row');
    row.addEventListener('click', () => {
        const open = !el.classList.contains('open');
        el.classList.toggle('open', open);
        row.setAttribute('aria-expanded', String(open));
        if (open) openSessions.add(s.id);
        else openSessions.delete(s.id);
    });

    const rpeText = el.querySelector('[data-rpe-label]');
    const paintRpe = () => { rpeText.textContent = `${s.rpe} · ${rpeLabel(s.rpe)}`; };
    paintRpe();

    const hint = el.querySelector('[data-hint]');
    const metersInput = el.querySelector('[data-f="meters"]');
    const paintHint = () => {
        if (!hint) return;
        const m = parseSetsMeters(s.sets);
        hint.textContent = m
            ? `${fmtInt(m)} m en total`
            : (s.sets.trim() ? 'No encuentro metros: escríbelos en "Metros".' : 'Escribe cada serie con su zona (AEL, AEM, AEI, VO2, R200, R100, VEL) y la app suma los metros y el gasto.');
        hint.style.color = m ? '' : 'var(--text-3)';
    };
    paintHint();

    el.querySelectorAll('[data-f]').forEach(input => {
        input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
            const f = input.dataset.f;
            if (f === 'sets') {
                s.sets = input.value.slice(0, 2000);
                const m = parseSetsMeters(s.sets);
                // Las series rellenan "Metros", salvo que hayas escrito tú los metros a mano
                if (m && (s.metersFromSets || !num(s.meters))) {
                    s.meters = m;
                    s.metersFromSets = true;
                    metersInput.value = m;
                } else if (!m && s.metersFromSets) {
                    s.meters = 0;
                    metersInput.value = '';
                }
                paintHint();
            } else if (f === 'meters') {
                s.meters = clamp(num(input.value), 0, 30000);
                s.metersFromSets = false;
            } else if (f === 'minutes') {
                s.minutes = clamp(num(input.value), 0, 600);
            } else if (f === 'rpe') {
                s.rpe = clamp(Math.round(num(input.value, 6)), 1, 10);
                paintRpe();
            } else {
                s[f] = input.value;
            }
            recalculateTargets();
            scheduleSave();
        });
    });

    // Botones que escriben la zona, el estilo o el material donde está el cursor (sin cerrar el teclado)
    const chipBox = el.querySelector('[data-chips]');
    if (chipBox) {
        const area = el.querySelector('[data-f="sets"]');
        SET_CHIPS.forEach(word => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip';
            b.textContent = word;
            b.addEventListener('pointerdown', e => e.preventDefault());
            b.addEventListener('click', () => {
                const pos = area.selectionStart ?? area.value.length;
                const before = area.value.slice(0, pos);
                const ins = (before && !/\s$/.test(before) ? ' ' : '') + word + ' ';
                area.value = before + ins + area.value.slice(area.selectionEnd ?? pos);
                area.focus();
                area.setSelectionRange(pos + ins.length, pos + ins.length);
                area.dispatchEvent(new Event('input'));
            });
            chipBox.appendChild(b);
        });
    }

    el.querySelector('[data-act="remove"]').addEventListener('click', () => {
        sessions = sessions.filter(x => x.id !== s.id);
        openSessions.delete(s.id);
        renderSessions();
        recalculateTargets();
        scheduleSave();
    });
    return el;
}

function chooseSessionType() {
    openActionSheet('Añadir entreno', [
        { label: 'Agua', icon: 'swim', run: () => addSession('swim') },
        { label: 'Gimnasio', icon: 'gym', run: () => addSession('gym') },
        { label: 'Otro deporte', icon: 'other', run: () => addSession('other') }
    ]);
}

function addSession(type) {
    const defaults = { swim: { minutes: 90, rpe: 6 }, gym: { minutes: 60, rpe: 6 }, other: { minutes: 45, rpe: 5 } };
    const s = sanitizeSession({ type, ...defaults[type] });
    sessions.push(s);
    openSessions.add(s.id);
    renderSessions();
    recalculateTargets();
    scheduleSave();
    setTimeout(() => {
        const card = document.querySelector(`.session[data-sid="${s.id}"]`);
        card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card?.querySelector('.session-body input')?.focus({ preventScroll: true });
    }, 80);
}

function renderRecommendations(weight, dayType, trainingMin) {
    const waterL = weight * 0.035 + (trainingMin / 60) * 0.6;
    $('recoSummary').innerText = `Bebe unos ${waterL.toFixed(1).replace('.', ',')} L hoy`;
    $('hydrationText').innerHTML = `En el agua también sudas: bebe 400–800 ml por hora de entrenamiento, con sales si la sesión pasa de 90 minutos.`;

    const hard = dayType === 'Competición' || dayType === 'Sesión Única Intensa';
    const supps = [
        { name: 'Creatina monohidrato', dose: '3–5 g/día', desc: 'Todos los días, a cualquier hora. Ayuda en salidas, virajes y fuerza.' },
        { name: 'Cafeína', dose: `${Math.round(weight * 3)}–${Math.round(weight * 6)} mg`, desc: '3–6 mg/kg, 45–60 min antes de competir o de una serie clave.', hl: hard },
        { name: 'Bicarbonato sódico', dose: `${(weight * 0.3).toFixed(0)} g`, desc: '0,3 g/kg, 90–120 min antes de 100/200 m, con comida rica en hidratos. Pruébalo antes: puede dar molestias.', hl: hard },
        { name: 'Beta-alanina', dose: '4–6 g/día', desc: 'Repartida en 3–4 tomas con las comidas durante semanas.' }
    ];
    $('suppList').innerHTML = supps.map(s => `
        <li class="supp-item${s.hl ? ' highlight' : ''}">
            <div class="supp-head"><span>${s.name}</span><span class="supp-dose">${s.dose}</span></div>
            <div class="supp-desc">${s.desc}</div>
        </li>`).join('');
}

function getCurrentTotals() {
    let k = 0, c = 0, p = 0, f = 0;
    mealSlots.forEach(s => (mealsState[s.id] || []).forEach(item => {
        const m = itemMacros(item);
        k += m.k; c += m.c; p += m.p; f += m.f;
    }));
    return { kcal: Math.round(k), c: Math.round(c), p: Math.round(p), f: Math.round(f) };
}

const RING_LENGTH = 2 * Math.PI * 52;

// Anillo de calorías (lo que queda) y barras de macros
function updateSummaryUI() {
    const tot = getCurrentTotals();
    const w = targets.weight || 1;
    const left = targets.kcal - tot.kcal;
    const ratio = tot.kcal / (targets.kcal || 1);

    $('ringValue').textContent = fmtInt(Math.abs(left));
    $('ringLabel').textContent = left >= 0 ? 'kcal restantes' : 'kcal de más';
    const ring = $('kcalRing');
    ring.style.strokeDashoffset = String(RING_LENGTH * (1 - Math.min(1, ratio)));
    ring.style.stroke = ratio > 1.1 ? 'var(--danger)' : '';
    $('kcalEaten').textContent = fmtInt(tot.kcal);
    $('kcalTarget').textContent = fmtInt(targets.kcal);

    [['c', 'carb'], ['p', 'prot'], ['f', 'fat']].forEach(([key, name]) => {
        const r = tot[key] / (targets[key] || 1);
        const d = targets[key] - tot[key];
        $(`${name}Status`).textContent = `${tot[key]} / ${targets[key]} g`;
        $(`${name}Bar`).style.width = `${Math.min(100, r * 100)}%`;
        $(`${name}Bar`).classList.toggle('over', r > 1.1);
        $(`${name}Sub`).textContent = `${d >= 0 ? `faltan ${d} g` : `${-d} g de más`} · ${(targets[key] / w).toFixed(1)} g/kg`;
    });

    updateStickySummary(tot);
}

// Barra fija arriba con lo que queda por comer (aparece al bajar hasta las comidas)
function updateStickySummary(tot) {
    const part = (label, real, target, unit) => {
        const d = target - real;
        return `<span><span class="muted">${label}</span><strong class="${d < 0 ? 'neg' : ''}">${d >= 0 ? fmtInt(d) : '+' + fmtInt(-d)}</strong>${unit}</span>`;
    };
    $('stickySummary').innerHTML =
        part('Quedan', tot.kcal, targets.kcal, ' kcal') +
        part('C', tot.c, targets.c, ' g') +
        part('P', tot.p, targets.p, ' g') +
        part('G', tot.f, targets.f, ' g');
}

// ==========================================================
// COMIDAS DEL DÍA
// ==========================================================
function itemMacros(item) {
    const r = num(item.grams) / 100;
    return { k: num(item.kcal100) * r, c: num(item.c100) * r, p: num(item.p100) * r, f: num(item.f100) * r };
}

function findFoodByName(name) {
    const q = String(name).trim().toLowerCase();
    return q ? foodDB.find(f => f.name.toLowerCase() === q) : undefined;
}

function refreshFoodDatalist() {
    $('foodDatalist').innerHTML = [...foodDB]
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        .map(f => `<option value="${escapeHtml(f.name)}">${escapeHtml(f.kcal)} kcal · C ${escapeHtml(f.c)} · P ${escapeHtml(f.p)} · G ${escapeHtml(f.f)} /100 g</option>`)
        .join('');
}

function renderMeals() {
    const container = $('mealsContainer');
    container.innerHTML = '';

    mealSlots.forEach(slot => {
        if (!Array.isArray(mealsState[slot.id])) mealsState[slot.id] = [];

        const el = document.createElement('div');
        el.className = 'meal';
        el.id = `meal_${slot.id}`;
        el.innerHTML = `
            <div class="meal-head">
                <div class="grow">
                    <div class="meal-title">${escapeHtml(slot.title)}</div>
                    ${slot.hint ? `<div class="meal-hint">${escapeHtml(slot.hint)}</div>` : ''}
                </div>
                <span class="meal-kcal" id="summary_${slot.id}"></span>
                <button class="icon-btn" data-act="menu" aria-label="Opciones de ${escapeHtml(slot.title)}">${icon('more')}</button>
            </div>
            <div id="items_${slot.id}"></div>
            <div class="meal-add">
                ${icon('search')}
                <input type="text" class="meal-search" list="foodDatalist" placeholder="Añadir alimento" aria-label="Alimento para ${escapeHtml(slot.title)}" autocomplete="off">
                <input type="number" class="meal-grams" value="100" min="1" step="5" inputmode="decimal" aria-label="Gramos">
                <button class="add-circle" data-act="add" aria-label="Añadir alimento">${icon('plus')}</button>
            </div>`;

        const search = el.querySelector('.meal-search');
        const grams = el.querySelector('.meal-grams');
        const submit = () => addFoodToMeal(slot.id, search, grams);

        // Al elegir un alimento de la lista se pone su ración habitual
        search.addEventListener('input', () => {
            const f = findFoodByName(search.value);
            if (f) grams.value = f.defaultG || 100;
        });
        [search, grams].forEach(inp => inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
        }));
        el.querySelector('[data-act="add"]').addEventListener('click', submit);
        el.querySelector('[data-act="menu"]').addEventListener('click', () => openActionSheet(slot.title, [
            { label: 'Cambiar nombre', icon: 'edit', run: () => renameMeal(slot.id) },
            { label: 'Eliminar comida', icon: 'trash', danger: true, run: () => removeMeal(slot.id) }
        ]));

        container.appendChild(el);
        renderMealItems(slot.id);
    });
}

function renderMealItems(slotId) {
    const box = $(`items_${slotId}`);
    if (!box) return;
    box.innerHTML = '';

    (mealsState[slotId] || []).forEach(item => {
        const row = document.createElement('div');
        row.className = 'food-item';
        row.innerHTML = `
            <div class="fi-main">
                <span class="fi-name">${escapeHtml(item.name)}</span>
                <span class="fi-macros" data-cell="m"></span>
            </div>
            <span class="fi-grams"><input type="number" class="gram-input" value="${escapeHtml(item.grams)}" step="5" min="0" inputmode="decimal" aria-label="Gramos de ${escapeHtml(item.name)}">g</span>
            <span class="fi-kcal" data-cell="k"></span>
            <button class="icon-btn" data-act="remove" aria-label="Quitar ${escapeHtml(item.name)}">${icon('close')}</button>`;

        const paint = () => {
            const m = itemMacros(item);
            row.querySelector('[data-cell="k"]').textContent = Math.round(m.k);
            row.querySelector('[data-cell="m"]').textContent = `C ${Math.round(m.c)} · P ${Math.round(m.p)} · G ${Math.round(m.f)}`;
        };
        paint();

        // Se actualiza en el sitio: el campo no pierde el foco mientras escribes
        row.querySelector('.gram-input').addEventListener('input', e => {
            item.grams = Math.max(0, num(e.target.value));
            paint();
            updateMealSummary(slotId);
            onDayChanged();
        });
        row.querySelector('[data-act="remove"]').addEventListener('click', () => {
            mealsState[slotId] = mealsState[slotId].filter(i => i.uid !== item.uid);
            renderMealItems(slotId);
            onDayChanged();
        });
        box.appendChild(row);
    });

    updateMealSummary(slotId);
}

function updateMealSummary(slotId) {
    const k = (mealsState[slotId] || []).reduce((a, item) => a + itemMacros(item).k, 0);
    const el = $(`summary_${slotId}`);
    if (el) el.innerHTML = k ? `${fmtInt(k)} <small>kcal</small>` : '';
}

function addFoodToMeal(slotId, searchEl, gramsEl) {
    const text = searchEl.value.trim();
    const grams = num(gramsEl.value);
    if (!text) {
        showToast('Escribe o elige un alimento', COLOR.error);
        searchEl.focus();
        return;
    }
    if (grams <= 0) {
        showToast('La cantidad debe ser mayor que 0 g', COLOR.error);
        gramsEl.focus();
        return;
    }

    let food = findFoodByName(text);
    if (!food) {
        const matches = foodDB.filter(f => f.name.toLowerCase().includes(text.toLowerCase()));
        if (matches.length === 1) food = matches[0];
    }

    if (!food) {
        // No existe: se abre el formulario con el nombre ya escrito y, al guardar, se añade a esta comida
        pendingMealAdd = { slotId, grams };
        openFoodModal({ name: text });
        showToast(`"${text}" no está en tus alimentos: rellena sus valores`, COLOR.info);
        return;
    }

    addItemToMeal(slotId, food, grams);
    searchEl.value = '';
    gramsEl.value = 100;
}

function addItemToMeal(slotId, food, grams) {
    if (!mealsState[slotId]) mealsState[slotId] = [];
    // Se copian los valores por 100 g para que el histórico no cambie si luego editas el alimento
    mealsState[slotId].push({
        uid: newId('i_'),
        name: food.name,
        grams,
        kcal100: food.kcal,
        c100: food.c,
        p100: food.p,
        f100: food.f
    });
    renderMealItems(slotId);
    onDayChanged();
}

function openAddMealModal() {
    $('newMealTitle').value = '';
    $('newMealHint').value = '';
    openModal('modalAddMeal');
    setTimeout(() => $('newMealTitle').focus(), 50);
}

function setMealPreset(title, hint) {
    $('newMealTitle').value = title;
    $('newMealHint').value = hint;
}

function confirmAddMeal() {
    const title = $('newMealTitle').value.trim();
    if (!title) {
        showToast('Escribe el nombre de la comida', COLOR.error);
        $('newMealTitle').focus();
        return;
    }
    const id = newId('m_');
    mealSlots.push({ id, title, hint: $('newMealHint').value.trim() });
    mealsState[id] = [];
    saveSlots();
    renderMeals();
    onDayChanged();
    closeModal('modalAddMeal');
    setTimeout(() => $(`meal_${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
}

function renameMeal(slotId) {
    const slot = mealSlots.find(s => s.id === slotId);
    if (!slot) return;
    const name = prompt('Nuevo nombre de la comida:', slot.title);
    if (name && name.trim()) {
        slot.title = name.trim().slice(0, 60);
        saveSlots();
        renderMeals();
        scheduleSave();
    }
}

function removeMeal(slotId) {
    const slot = mealSlots.find(s => s.id === slotId);
    if (!slot) return;
    const n = (mealsState[slotId] || []).length;
    const msg = n ? `¿Eliminar "${slot.title}" y sus ${n} alimento(s)?` : `¿Eliminar "${slot.title}"?`;
    if (!confirm(msg)) return;
    mealSlots = mealSlots.filter(s => s.id !== slotId);
    delete mealsState[slotId];
    saveSlots();
    renderMeals();
    onDayChanged();
}
