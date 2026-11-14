// SwimFuel · plan de gimnasio del preparador: qué toca cada día, con las series de la semana y los kilos
// según tus máximos. Primero las cuentas (se prueban en tests/) y después la pantalla.
'use strict';

const STORAGE_KEY_GYM_PLAN = 'swimfuel_gym_plan_v1';
let gymPlan = null;

// ---------- Cuentas ----------
// Plan: { name, maxes: [{ key, name, kg }], days: [{ weekday (0 domingo … 6 sábado), title, minutes, gymType,
// blocks: [{ title, role ('main' | 'sec' | ''), items: [{ text, max (key de un máximo o '') }] }] }],
// weeks: [{ n, from (lunes, AAAA-MM-DD), days: { '1': { main, sec, rest } } }] }
function sanitizeGymPlan(p) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.days)) return null;
    const str = (v, n) => String(v ?? '').trim().slice(0, n);
    const days = p.days.map(d => ({
        weekday: clamp(Math.round(num(d && d.weekday)), 0, 6),
        title: str(d && d.title, 50),
        minutes: clamp(num(d && d.minutes, 60) || 60, 10, 240),
        gymType: GYM_TYPES[d && d.gymType] ? d.gymType : 'strength',
        blocks: (Array.isArray(d && d.blocks) ? d.blocks : []).map(b => ({
            title: str(b && b.title, 60),
            role: ['main', 'sec'].includes(b && b.role) ? b.role : '',
            items: (Array.isArray(b && b.items) ? b.items : [])
                .map(i => ({ text: str(typeof i === 'string' ? i : i && i.text, 120), max: str(i && i.max, 12).replace(/\W/g, '') }))
                .filter(i => i.text).slice(0, 12)
        })).filter(b => b.items.length).slice(0, 8)
    })).filter(d => d.blocks.length).slice(0, 7);
    if (!days.length) return null;
    return {
        name: str(p.name, 60) || 'Plan de gimnasio',
        maxes: (Array.isArray(p.maxes) ? p.maxes : [])
            .map(m => ({ key: str(m && m.key, 12).replace(/\W/g, ''), name: str(m && m.name, 30), kg: clamp(num(m && m.kg), 0, 500) }))
            .filter(m => m.key && m.name).slice(0, 8),
        days,
        weeks: (Array.isArray(p.weeks) ? p.weeks : [])
            .filter(w => w && DATE_RE.test(String(w.from)))
            .map(w => ({
                n: Math.round(num(w.n)),
                from: w.from,
                days: Object.fromEntries(Object.entries(w.days || {}).filter(([k]) => /^[0-6]$/.test(k))
                    .map(([k, v]) => [k, { main: str(v && v.main, 50), sec: str(v && v.sec, 50), rest: str(v && v.rest, 50) }]))
            }))
            .sort((a, b) => a.from.localeCompare(b.from)).slice(0, 60)
    };
}

// Lo que toca un día concreto: { day (o null si ese día no hay gimnasio), week, rx: { main, sec, rest } }
function planForDate(plan, iso) {
    if (!plan || !DATE_RE.test(String(iso))) return { day: null, week: null, rx: null };
    const [y, m, d] = iso.split('-').map(Number);
    const weekday = new Date(y, m - 1, d).getDay();
    const week = plan.weeks.find(w => w.from <= iso && iso < addDays(w.from, 7)) || null;
    return {
        day: plan.days.find(x => x.weekday === weekday) || null,
        week,
        rx: week ? (week.days[String(weekday)] || null) : null
    };
}

// "4x5 (85%)" → { sets: 4, reps: '5', pct: 85 }. Sin porcentaje ("2x3 (3 RIR)", "Activación") → null
function parseRx(text) {
    const m = /(\d+)\s*x\s*([\d/\-]+)\s*\(\s*(\d{2,3})\s*%/i.exec(String(text || ''));
    return m ? { sets: Number(m[1]), reps: m[2], pct: Number(m[3]) } : null;
}

// Kilos de una serie, redondeados al medio kilo
function rxKg(maxKg, pct) {
    return Math.round(num(maxKg) * num(pct) / 100 * 2) / 2;
}

// Intensidad del entreno (1–10) a partir del porcentaje de la semana
function rpeFromRx(text) {
    const rx = parseRx(text);
    if (!rx) return 6;
    return rx.pct >= 90 ? 9 : rx.pct >= 80 ? 8 : rx.pct >= 70 ? 7 : rx.pct >= 60 ? 6 : 5;
}

// ---------- Pantalla ----------
function loadGymPlan() {
    gymPlan = sanitizeGymPlan(readJSON(STORAGE_KEY_GYM_PLAN, null));
}

function saveGymPlan() {
    if (gymPlan) store.setItem(STORAGE_KEY_GYM_PLAN, JSON.stringify(gymPlan));
    else store.removeItem(STORAGE_KEY_GYM_PLAN);
}

// Al añadir un entreno de gimnasio en un día del plan, se rellenan tipo, minutos e intensidad
function applyGymPlanDefaults(s) {
    const p = planForDate(gymPlan, currentDate);
    if (!p.day) return;
    s.minutes = p.day.minutes;
    s.gymType = p.day.gymType;
    s.rpe = rpeFromRx(p.rx && p.rx.main);
}

// Lo que toca hoy, dentro de la ficha del entreno de gimnasio
function gymPlanHtml(iso) {
    const p = planForDate(gymPlan, iso);
    if (!p.day) return '';
    const rx = p.rx || {};
    const pct = (parseRx(rx.main) || {}).pct;
    const maxOf = key => gymPlan.maxes.find(m => m.key === key && m.kg > 0);
    const kgText = n => String(n).replace('.', ',');
    const blocks = p.day.blocks.map(b => {
        const line = b.role === 'main' ? rx.main : b.role === 'sec' ? rx.sec : '';
        const items = b.items.map(i => {
            const max = b.role === 'main' && pct ? maxOf(i.max) : null;
            return `<li>${escapeHtml(i.text)}${max ? ` · <strong>${kgText(rxKg(max.kg, pct))} kg</strong>` : ''}</li>`;
        }).join('');
        return `<div class="gp-block"><div class="gp-title">${escapeHtml(b.title)}${line ? ` · <strong>${escapeHtml(line)}</strong>` : ''}</div><ul>${items}</ul></div>`;
    }).join('');
    return `
        <details class="gp" open>
            <summary>Plan de hoy${p.week ? ` · semana ${p.week.n}` : ''}: ${escapeHtml(p.day.title)}</summary>
            ${blocks}
            ${rx.rest ? `<div class="gp-rest">Descansos: ${escapeHtml(rx.rest)}</div>` : ''}
            ${p.week ? '' : '<div class="gp-rest">Esta fecha queda fuera de las semanas del plan: no hay series ni porcentajes.</div>'}
        </details>`;
}

// Perfil → Plan de gimnasio: cargarlo, cambiar tus máximos o quitarlo
function renderGymPlanBox() {
    const box = $('gymPlanBox');
    if (!gymPlan) {
        box.innerHTML = `
            <p class="footnote" style="margin:0 4px 10px;">Carga el plan de tu preparador y cada día de gimnasio verás lo que toca, con los kilos según tus máximos.</p>
            <button class="btn-secondary btn-sm" data-gp="load">Cargar plan (archivo, foto o PDF)</button>`;
    } else {
        const p = planForDate(gymPlan, todayLocalISO());
        box.innerHTML = `
            ${gymPlan.maxes.length ? `<div class="list">${gymPlan.maxes.map((m, k) => `
                <label class="list-row">
                    <span>Máximo: ${escapeHtml(m.name)}</span>
                    <span class="inline-field"><input type="number" class="inline-input" data-max="${k}" value="${m.kg || ''}" min="0" step="0.5" inputmode="decimal" placeholder="—"><span>kg</span></span>
                </label>`).join('')}</div>` : ''}
            <p class="footnote">${escapeHtml(gymPlan.name)}: ${gymPlan.days.length} día${gymPlan.days.length === 1 ? '' : 's'} por semana${p.week ? `, vas por la semana ${p.week.n} de ${gymPlan.weeks.length}` : ''}. Cambia aquí tus máximos cuando mejoren.</p>
            <div class="row" style="margin-top:8px;">
                <button class="btn-secondary btn-sm" data-gp="load">Cambiar plan</button>
                <button class="btn-danger btn-sm" data-gp="remove">Quitar plan</button>
            </div>`;
    }
    box.querySelector('[data-gp="load"]').addEventListener('click', () => $('gymPlanFile').click());
    box.querySelector('[data-gp="remove"]')?.addEventListener('click', () => {
        if (!confirm('¿Quitar el plan de gimnasio? Tus entrenos ya apuntados no cambian.')) return;
        gymPlan = null;
        saveGymPlan();
        renderGymPlanBox();
        renderSessions();
        recalculateTargets();
    });
    box.querySelectorAll('[data-max]').forEach(inp => inp.addEventListener('input', () => {
        gymPlan.maxes[Number(inp.dataset.max)].kg = clamp(num(inp.value), 0, 500);
        saveGymPlan();
        renderSessions();
        recalculateTargets();
    }));
}

function setGymPlan(plan) {
    const clean = sanitizeGymPlan(plan);
    if (!clean) throw new Error('no he encontrado los días de entreno en el plan');
    gymPlan = clean;
    saveGymPlan();
    renderGymPlanBox();
    renderSessions();
    recalculateTargets();
    showToast(`Plan cargado: ${clean.days.length} días por semana y ${clean.weeks.length} semanas`);
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('no se pudo leer el archivo'));
        reader.onload = e => resolve(String(e.target.result).split(',')[1]);
        reader.readAsDataURL(file);
    });
}

// Un archivo .json de plan se carga tal cual; fotos o un PDF los lee la IA
async function loadGymPlanFiles(event) {
    const files = [...event.target.files].slice(0, 4);
    event.target.value = '';
    if (!files.length) return;
    try {
        if (files[0].name.toLowerCase().endsWith('.json') || files[0].type === 'application/json') {
            const data = JSON.parse(await files[0].text());
            setGymPlan(data.gymPlan || data);
            return;
        }
        if (!ensureGeminiKey()) return;
        const who = (prompt('Si el plan tiene una tabla de máximos con varios nombres, escribe el tuyo tal como aparece (o déjalo vacío):') || '').trim().slice(0, 30);
        const media = await Promise.all(files.map(async f => (f.type === 'application/pdf'
            ? { mime: 'application/pdf', data: await fileToBase64(f) }
            : { mime: 'image/jpeg', data: await imageFileToBase64(f, 2000) })));
        showToast('Leyendo el plan… puede tardar medio minuto', COLOR.info);
        const prompt2 = `Lee este plan de gimnasio de un preparador físico y pásalo a JSON. Responde SOLO con JSON con esta forma:
{"name":"","maxes":[{"key":"sent","name":"Sentadilla","kg":0}],
 "days":[{"weekday":1,"title":"","minutes":60,"gymType":"strength","blocks":[{"title":"","role":"main","items":[{"text":"","max":"sent"}]}]}],
 "weeks":[{"n":1,"from":"AAAA-MM-DD","days":{"1":{"main":"3x10 (75%)","sec":"2x12 (60%)","rest":"2,5 min / 75 seg"}}}]}
- weekday: 0 domingo, 1 lunes, 2 martes, 3 miércoles, 4 jueves, 5 viernes, 6 sábado.
- gymType: "strength" (fuerza), "power" (potencia o velocidad), "circuit", "dryland" o "mobility". minutes: duración total aproximada de la sesión.
- blocks: los bloques de cada día en orden (pliometría, fuerza, secundarios, core…). role "main" para los ejercicios principales, "sec" para los secundarios y "" para el resto. Cada ejercicio va en items con su texto tal como está escrito (series, repeticiones y descansos incluidos).
- weeks: una entrada por semana de la tabla de periodización. "from" es el LUNES de esa semana (hoy es ${todayLocalISO()}; deduce el año de las fechas). En days, la clave es el weekday y main, sec y rest son las casillas de ejercicio principal, secundario y descanso copiadas tal cual.
- maxes: solo los máximos (100 %) de ${who ? `"${who}"` : 'la persona del plan'}, uno por ejercicio. En cada ejercicio principal pon en "max" la key del máximo que le corresponde, o "" si no tiene.
No inventes nada que no esté en el documento.`;
        setGymPlan(await geminiJSON(prompt2, media));
    } catch (err) {
        showToast('No se pudo cargar el plan: ' + err.message, COLOR.error);
    }
}

function initGymPlanUI() {
    $('gymPlanFile').addEventListener('change', loadGymPlanFiles);
    renderGymPlanBox();
}
