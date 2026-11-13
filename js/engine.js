// SwimFuel · motor de cálculo: funciones puras, sin pantalla ni almacenamiento (se prueban en tests/)
'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[\w-]+$/;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function num(v, fallback = 0) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
}

function round1(n) { return Math.round(n * 10) / 10; }

function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function calcKcal(c, p, f) { return Math.round(c * 4 + p * 4 + f * 9); }

// Fecha local (toISOString usa UTC y de madrugada daba el día anterior)
function dateToISO(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayLocalISO() { return dateToISO(new Date()); }

function addDays(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    return dateToISO(new Date(y, m - 1, d + days));
}

function formatDateES(iso, short = false) {
    if (!DATE_RE.test(String(iso))) return escapeHtml(iso);
    const [y, m, d] = iso.split('-');
    if (short) return `${d}/${m}`;
    const wd = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][new Date(+y, +m - 1, +d).getDay()];
    return `${wd} ${d}/${m}/${y}`;
}

function statusOf(pct) {
    if (pct < 75 || pct > 125) return 'low';
    if (pct < 90 || pct > 110) return 'warn';
    return 'ok';
}

// ==========================================================
// GASTO DE LOS ENTRENOS (sin reloj: metros, estilo e intensidad)
// ==========================================================
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmtInt = n => Math.round(n).toLocaleString('es-ES');

const SESSION_TYPES = {
    swim: { label: 'Agua' },
    gym: { label: 'Gimnasio' },
    other: { label: 'Otro deporte' }
};

// Coste por metro frente al crol a igual esfuerzo (braza y mariposa son mucho menos eficientes)
const STROKES = {
    crawl: { label: 'Crol', factor: 1.0 },
    back: { label: 'Espalda', factor: 1.15 },
    im: { label: 'Estilos', factor: 1.25 },
    kick: { label: 'Piernas / técnica', factor: 1.3 },
    fly: { label: 'Mariposa', factor: 1.4 },
    breast: { label: 'Braza', factor: 1.45 }
};

// MET a intensidad 6/10 (Compendium of Physical Activities); en fuerza cuentan los descansos entre series
const GYM_TYPES = {
    strength: { label: 'Fuerza / hipertrofia', met: 5.0 },
    power: { label: 'Potencia / pliometría', met: 6.0 },
    circuit: { label: 'Circuito / HIIT', met: 8.0 },
    dryland: { label: 'Seco: gomas y core', met: 4.5 },
    mobility: { label: 'Movilidad / estiramientos', met: 2.5 }
};

// kcal EXTRA por metro y kg nadando crol a esfuerzo moderado (≈ 0,18 kcal/m para 80 kg)
const SWIM_KCAL_PER_M_KG = 0.0022;

// Para días guardados antes de las sesiones, que solo tenían el tipo de jornada
const RPE_BY_DAYTYPE = {
    'Agua + Gimnasio': 6, 'Doble Sesión Agua': 7, 'Sesión Única Intensa': 8,
    'Competición': 8, 'Tapering': 4, 'Descanso': 3
};

function rpeLabel(rpe) {
    if (rpe <= 2) return 'muy suave';
    if (rpe <= 4) return 'suave';
    if (rpe <= 6) return 'moderado';
    if (rpe <= 8) return 'duro';
    return rpe === 9 ? 'muy duro' : 'máximo';
}

// kcal por minuto POR ENCIMA del reposo (el reposo ya está en el gasto base)
function netKcalPerMin(met, weight) {
    return Math.max(0, met - 1) * 3.5 * weight / 200;
}

// Gasto extra de una sesión → { kcal, how } (how explica cómo se ha calculado)
function sessionKcal(s, weight) {
    const rpe = clamp(Math.round(num(s.rpe, 6)), 1, 10);
    const minutes = Math.max(0, num(s.minutes));

    if (s.type === 'swim') {
        const meters = Math.max(0, num(s.meters));
        const stroke = STROKES[s.stroke] || STROKES.crawl;
        if (meters > 0) {
            // Ir más rápido cuesta más por cada metro (la resistencia del agua crece con la velocidad)
            const intensity = 1 + 0.06 * (rpe - 6);
            const swimming = meters * SWIM_KCAL_PER_M_KG * weight * stroke.factor * intensity;
            // El resto de la sesión (descansos, explicaciones, técnica parado) cuenta como actividad ligera
            const metersPerMin = (55 + 4 * rpe) / Math.sqrt(stroke.factor); // ritmo aproximado de nadador entrenado
            const restMin = Math.max(0, minutes - meters / metersPerMin);
            const resting = netKcalPerMin(2.5, weight) * restMin;
            return {
                kcal: swimming + resting,
                how: `por metros (${fmtInt(meters)} m, ${stroke.label.toLowerCase()}, intensidad ${rpe})` +
                    (restMin >= 5 ? ` + ~${Math.round(restMin)} min de descansos` : '')
            };
        }
        // Sin metros: por tiempo, con un MET que ya incluye los descansos de un entreno normal
        const met = 3.5 + 0.7 * rpe;
        return {
            kcal: netKcalPerMin(met, weight) * minutes,
            how: minutes ? `por minutos (MET ${met.toFixed(1)}). Pon los metros para afinar.` : 'añade los metros o los minutos'
        };
    }

    if (s.type === 'gym') {
        const type = GYM_TYPES[s.gymType] || GYM_TYPES.strength;
        const met = type.met * (1 + 0.07 * (rpe - 6));
        return { kcal: netKcalPerMin(met, weight) * minutes, how: `según el tipo (${type.label}, MET ${met.toFixed(1)})` };
    }

    const met = 2 + rpe; // otro deporte: de MET 3 (muy suave) a 12 (máximo)
    return { kcal: netKcalPerMin(met, weight) * minutes, how: `por minutos e intensidad (MET ${met.toFixed(1)})` };
}

// Suma los metros de unas series escritas como en la pizarra:
// "400 + 8x100 c/1:30 + 3x(4x50 + 100) + 200 suave" → 2.000 m
function parseSetsMeters(text) {
    let t = String(text || '').toLowerCase().replace(/[×*]/g, 'x');
    t = t.replace(/(\d{1,2})\.(\d{3})\b/g, '$1$2');                       // 1.500 → 1500
    t = t.replace(/\d+\s*[:'’´]\s*\d*\s*["”'’´]*/g, ' ');                   // tiempos: 1:30, 1'30''
    t = t.replace(/\d+[.,]\d+/g, ' ');                                     // tiempos con punto: c/1.30
    t = t.replace(/\d+\s*(?:segundos|seg|s|minutos|mins|min)\b/g, ' ');    // descansos: 20s, 2 min
    t = t.replace(/\b(?:rpe|zona|z|fc|ppm)\s*\d+/g, ' ');                  // rpe 7, z2, fc 160
    t = t.replace(/(\d|\))\s*x\s*(?=[\d(])/g, '$1 * ');                    // 8x100 → 8 * 100
    t = t.replace(/[^\d*()]+/g, ' ');                                      // palabras, +, comas… separan

    const tokens = t.match(/\d+|\*|\(|\)/g) || [];
    let i = 0;
    const isNum = tok => /^\d+$/.test(tok || '');
    // Una distancia suelta debe ser múltiplo de 25 (así "8 series" o "fc 160" no suman)
    const dist = n => (n >= 25 && n <= 20000 && n % 25 === 0 ? n : 0);

    function term() {
        const tok = tokens[i];
        if (tok === '(') {
            i++;
            const v = seq();
            if (tokens[i] === ')') i++;
            return v;
        }
        if (!isNum(tok)) return 0;
        const n = parseInt(tok, 10);
        i++;
        if (tokens[i] !== '*') return dist(n);
        i++;
        // Par simple: "8x100" o al revés "100x8"
        if (isNum(tokens[i]) && tokens[i + 1] !== '*') {
            const m = parseInt(tokens[i], 10);
            i++;
            if (dist(m)) return n * m;
            return dist(n) && m <= 100 ? n * m : 0;
        }
        return n <= 100 ? n * term() : 0; // "3x(…)" o "2x4x50"
    }

    function seq() {
        let total = 0;
        while (i < tokens.length && tokens[i] !== ')') {
            const before = i;
            total += term();
            if (i === before) i++;
        }
        return total;
    }

    let total = 0;
    while (i < tokens.length) {
        total += seq();
        i++; // salta un ")" sin pareja
    }
    return Math.round(total);
}

function sanitizeSession(s) {
    if (!s || !SESSION_TYPES[s.type]) return null;
    return {
        id: ID_RE.test(String(s.id)) ? String(s.id) : newId('s_'),
        type: s.type,
        minutes: clamp(num(s.minutes), 0, 600),
        rpe: clamp(Math.round(num(s.rpe, 6)), 1, 10),
        meters: s.type === 'swim' ? clamp(num(s.meters), 0, 30000) : 0,
        stroke: STROKES[s.stroke] ? s.stroke : 'crawl',
        sets: String(s.sets || '').slice(0, 300),
        metersFromSets: Boolean(s.metersFromSets),
        gymType: GYM_TYPES[s.gymType] ? s.gymType : 'strength',
        label: String(s.label || '').slice(0, 40)
    };
}

function sanitizeSessions(list) {
    return Array.isArray(list) ? list.map(sanitizeSession).filter(Boolean).slice(0, 10) : [];
}

// Días y perfiles de versiones anteriores: solo tenían minutos de agua y de gimnasio
function legacySessions(dayType, swimMin, gymMin) {
    const out = [];
    if (num(swimMin) > 0) out.push(sanitizeSession({ type: 'swim', minutes: swimMin, rpe: RPE_BY_DAYTYPE[dayType] ?? 6 }));
    if (num(gymMin) > 0) out.push(sanitizeSession({ type: 'gym', minutes: gymMin, rpe: 6 }));
    return out;
}

// Entrenos con los que empieza un día nuevo: los últimos que usaste (sin las series ni los metros)
function templateSessions(prof) {
    const list = Array.isArray(prof.sessions)
        ? sanitizeSessions(prof.sessions)
        : legacySessions(prof.dayType || 'Agua + Gimnasio', prof.swimMin ?? 105, prof.gymMin ?? 60);
    return list.map(s => ({ ...s, id: newId('s_'), meters: 0, sets: '', metersFromSets: false }));
}

function sessionsSummary(h) {
    const list = Array.isArray(h.sessions) ? h.sessions : legacySessions(h.dayType, h.swimMin, h.gymMin);
    return list.map(s => {
        if (s.type === 'swim') return num(s.meters) ? `${fmtInt(s.meters)} m` : `${num(s.minutes)}′ agua`;
        if (s.type === 'gym') return `${num(s.minutes)}′ gym`;
        return `${num(s.minutes)}′ ${escapeHtml(s.label || 'otro')}`;
    }).join(' · ') || 'sin entreno';
}

// ---------- Limpieza de datos (localStorage, backups, histórico) ----------
function sanitizeFood(f) {
    if (!f || typeof f !== 'object' || !String(f.name ?? '').trim()) return null;
    return {
        id: ID_RE.test(String(f.id)) ? String(f.id) : newId('cust_'),
        name: String(f.name).trim().slice(0, 120),
        kcal: Math.max(0, num(f.kcal)),
        c: Math.max(0, num(f.c)),
        p: Math.max(0, num(f.p)),
        f: Math.max(0, num(f.f)),
        defaultG: Math.max(1, num(f.defaultG, 100))
    };
}

function sanitizeMealSlots(slots) {
    if (!Array.isArray(slots)) return [];
    return slots
        .filter(s => s && ID_RE.test(String(s.id)))
        .map(s => ({
            id: String(s.id),
            // La versión anterior guardaba "3. Comida": el número ahora se pinta solo
            title: String(s.title || 'Comida').replace(/^\s*\d+\.\s*/, '').slice(0, 60),
            hint: String(s.hint || '').slice(0, 100)
        }));
}

function sanitizeItem(i) {
    if (!i || !i.name) return null;
    return {
        uid: newId('i_'),
        name: String(i.name),
        grams: Math.max(0, num(i.grams)),
        kcal100: Math.max(0, num(i.kcal100)),
        c100: Math.max(0, num(i.c100)),
        p100: Math.max(0, num(i.p100)),
        f100: Math.max(0, num(i.f100))
    };
}

function sanitizeMeals(obj) {
    const out = {};
    if (obj && typeof obj === 'object') {
        Object.keys(obj).forEach(k => {
            if (ID_RE.test(k) && Array.isArray(obj[k])) out[k] = obj[k].map(sanitizeItem).filter(Boolean);
        });
    }
    return out;
}

// Perfil que llega en una copia de seguridad: se aceptan valores sueltos (texto, número, sí/no) y los entrenos habituales
function mergeProfile(current, incoming) {
    const prof = { ...(current || {}) };
    if (!incoming || typeof incoming !== 'object') return prof;
    Object.keys(incoming).forEach(k => {
        const v = incoming[k];
        if (!/^\w{1,40}$/.test(k) || v === '' || v === null) return;
        if (k === 'sessions') {
            if (Array.isArray(v)) prof.sessions = sanitizeSessions(v);
        } else if (k === 'calibration') {
            if (num(v) >= 0.7 && num(v) <= 1.35) prof.calibration = num(v);
        } else if (typeof v === 'string') {
            prof[k] = v.slice(0, 200);
        } else if (typeof v === 'number' || typeof v === 'boolean') {
            prof[k] = v;
        }
    });
    return prof;
}

// Días de una copia de seguridad: fecha válida y un solo registro por fecha
function cleanHistory(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).filter(h => {
        if (!h || typeof h !== 'object' || !DATE_RE.test(String(h.date)) || seen.has(h.date)) return false;
        seen.add(h.date);
        return true;
    });
}
