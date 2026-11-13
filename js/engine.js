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

// ==========================================================
// SUEÑO (cada noche se apunta en el día en que te levantas)
// ==========================================================
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function timeToMin(t) {
    return TIME_RE.test(String(t)) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null;
}

// Minutos entre dormirse y despertarse (cruza la medianoche)
function sleepSpanMin(bed, wake) {
    const b = timeToMin(bed), w = timeToMin(wake);
    return b === null || w === null ? 0 : (w - b + 1440) % 1440;
}

// min: minutos dormidos de noche · quality: nota 0–100 · nap: siesta · deep/rem: fases · hr: pulso en reposo
function sanitizeSleep(s) {
    if (!s || typeof s !== 'object') return null;
    const int = (v, lo, hi) => clamp(Math.round(num(v)), lo, hi);
    const out = {
        bed: TIME_RE.test(String(s.bed)) ? String(s.bed) : '',
        wake: TIME_RE.test(String(s.wake)) ? String(s.wake) : '',
        min: int(s.min, 0, 960),
        quality: s.quality === null || s.quality === undefined || s.quality === '' ? null : int(s.quality, 0, 100),
        nap: int(s.nap, 0, 300),
        deep: int(s.deep, 0, 600),
        rem: int(s.rem, 0, 600),
        hr: num(s.hr) >= 25 && num(s.hr) <= 130 ? Math.round(num(s.hr)) : 0
    };
    if (!out.min) out.min = Math.min(960, sleepSpanMin(out.bed, out.wake));
    return out.min || out.nap || out.quality !== null || out.hr ? out : null;
}

function fmtDuration(min) {
    const m = Math.max(0, Math.round(num(min)));
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

function sleepLabel(sleep) {
    const s = sanitizeSleep(sleep);
    return s && s.min ? `sueño ${fmtDuration(s.min)}` : '';
}

// Los deportistas necesitan dormir más que la media: 8 h 30 de partida (9 h en menores), ajustable
function defaultSleepGoal(age) {
    return num(age, 20) < 18 ? 540 : 510;
}

// Noches apuntadas entre dos fechas, de la más antigua a la más reciente. total = noche + siesta
function sleepNights(history, from, to) {
    return history
        .filter(h => h.date >= from && h.date <= to)
        .map(h => {
            const s = sanitizeSleep(h.sleep);
            return s ? { ...s, date: h.date, total: s.min + s.nap, rec: h } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.date.localeCompare(b.date));
}

function sleepSummary(history, today, goalMin) {
    const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const sd = a => {
        const m = mean(a);
        return Math.sqrt(mean(a.map(v => (v - m) ** 2)));
    };
    const block = (from, to) => {
        const nights = sleepNights(history, from, to);
        const timed = nights.filter(n => n.min > 0);
        return {
            nights: timed.length,
            avgMin: mean(timed.map(n => n.min)),
            avgTotal: mean(timed.map(n => n.total)),
            avgQuality: mean(nights.filter(n => n.quality !== null).map(n => n.quality)),
            // Lo que falta para tu objetivo, sumando las noches apuntadas (una noche larga compensa una corta)
            debtMin: Math.max(0, timed.reduce((a, n) => a + goalMin - n.total, 0))
        };
    };

    // Regularidad: cuánto varían tus horas de dormirte y despertarte en 14 días
    const timed = sleepNights(history, addDays(today, -13), today).filter(n => n.bed && n.wake);
    let regularity = null;
    if (timed.length >= 4) {
        const beds = timed.map(n => (timeToMin(n.bed) + 720) % 1440); // desde mediodía: 23:30 y 00:30 quedan juntas
        const wakes = timed.map(n => timeToMin(n.wake));
        regularity = Math.round((sd(beds) + sd(wakes)) / 2);
    }

    const hrs = sleepNights(history, addDays(today, -28), addDays(today, -1)).filter(n => n.hr).map(n => n.hr);
    return {
        goalMin,
        last: sleepNights(history, today, today)[0] || null,
        week: block(addDays(today, -6), today),
        prevWeek: block(addDays(today, -13), addDays(today, -7)),
        month: block(addDays(today, -27), today),
        regularity,
        hrBase: hrs.length >= 5 ? mean(hrs) : null
    };
}

// Avisos del día. El sueño NO cambia las calorías: dormir poco sube el apetito, no el gasto.
// Fuentes en la pestaña Sueño → "Qué dice la evidencia".
function sleepAdvice(sum, ctx = {}) {
    const out = [];
    const goal = sum.goalMin, last = sum.last, wk = sum.week;

    if (last && last.min > 0 && last.total < goal - 90) {
        out.push({
            tone: 'warn',
            title: `Noche corta: ${fmtDuration(last.total)}`,
            text: 'Dormir poco sube el apetito (sobre todo de dulce y grasa), pero no lo que gastas: mantén tu objetivo de calorías y reparte bien la proteína y los hidratos. Si puedes, una siesta de 20–30 min después de comer recupera parte del rendimiento.'
        });
    }
    if (wk.nights >= 3 && wk.debtMin >= 180) {
        out.push({
            tone: 'warn',
            title: `Deuda de sueño: ${fmtDuration(wk.debtMin)} en ${wk.nights} noches`,
            text: `Esta semana duermes ${fmtDuration(wk.avgTotal)} de media y tu objetivo es ${fmtDuration(goal)}. Acostarte 30–60 min antes durante unos días mejora la velocidad, el tiempo de reacción y el ánimo; dormir menos de 8 h de forma habitual se asocia a más lesiones y resfriados en deportistas.`
        });
    }
    if (last && last.hr && sum.hrBase && last.hr >= sum.hrBase + 6) {
        out.push({
            tone: 'warn',
            title: `Pulso en reposo alto: ${last.hr} ppm (+${Math.round(last.hr - sum.hrBase)})`,
            text: 'Varios latidos por encima de tu media suele indicar fatiga acumulada, poca recuperación o que estás incubando algo. Si se repite 2 o 3 días, coméntalo con tu entrenador y valora bajar la carga.'
        });
    }
    if (last && last.quality !== null && sum.month.avgQuality !== null && sum.month.nights >= 7 && last.quality <= sum.month.avgQuality - 12) {
        out.push({
            tone: 'info',
            title: `Nota baja: ${last.quality} (tu media es ${Math.round(sum.month.avgQuality)})`,
            text: 'Lo que más suele estropear la calidad: cafeína por la tarde (déjala unas 8–9 h antes de dormir), entreno muy intenso en la última hora, alcohol, pantallas con luz fuerte antes de acostarte y la habitación caliente.'
        });
    }
    if (sum.regularity !== null && sum.regularity > 60) {
        out.push({
            tone: 'info',
            title: `Horarios irregulares: ±${sum.regularity} min`,
            text: 'Dormirte y despertarte a horas parecidas, también el fin de semana, mejora la calidad del sueño aunque duermas las mismas horas.'
        });
    }
    if (ctx.dayType === 'Competición' || ctx.dayType === 'Tapering') {
        out.push({
            tone: 'info',
            title: 'Antes de competir',
            text: 'Es normal dormir peor la noche antes de competir y afecta poco a las pruebas cortas. Lo que cuenta es el sueño de la semana previa: alárgalo estos días.'
        });
    }
    if (!out.some(a => a.tone === 'warn') && wk.nights >= 4 && wk.avgTotal >= goal - 20) {
        out.push({ tone: 'ok', title: 'Vas bien de sueño', text: `Media de ${fmtDuration(wk.avgTotal)} esta semana. Mantén los horarios.` });
    }
    if (num(ctx.weight) > 0) {
        out.push({
            tone: 'info',
            title: 'Antes de dormir',
            text: 'Unos 30–40 g de proteína lenta (caseína, queso fresco batido, yogur griego) antes de acostarte mejoran la recuperación muscular durante la noche, sobre todo los días de gimnasio.'
        });
    }
    return out;
}

// Relaciones en TUS datos (últimos 90 días). Describen lo que ha pasado, no demuestran la causa.
function sleepPatterns(history, today, goalMin) {
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const byDate = Object.fromEntries(history.map(h => [h.date, h]));
    const nights = sleepNights(history, addDays(today, -90), addDays(today, -1)).filter(n => n.min > 0);
    const out = [];

    // Lo que comes el día después de dormir poco (frente a tu objetivo, para no mezclar días de más entreno)
    const fed = nights.filter(n => num(n.rec.kcalTarget) > 0 && num(n.rec.kcalReal) >= 0.5 * num(n.rec.kcalTarget));
    const over = n => num(n.rec.kcalReal) - num(n.rec.kcalTarget);
    const short = fed.filter(n => n.total < goalMin - 60), rest = fed.filter(n => n.total >= goalMin - 60);
    if (short.length >= 4 && rest.length >= 4) {
        const d = Math.round(mean(short.map(over)) - mean(rest.map(over)));
        if (Math.abs(d) >= 100) {
            out.push({
                title: `${d > 0 ? '+' : '−'}${Math.abs(d)} kcal tras dormir poco`,
                text: `Los días después de dormir menos de ${fmtDuration(goalMin - 60)} comes de media ${Math.abs(d)} kcal ${d > 0 ? 'más' : 'menos'} respecto a tu objetivo que el resto de días (${short.length} noches cortas).`
            });
        }
    }

    // Madrugones
    const withWake = nights.filter(n => n.wake);
    const early = withWake.filter(n => timeToMin(n.wake) < 390), late = withWake.filter(n => timeToMin(n.wake) >= 390);
    if (early.length >= 3 && late.length >= 3) {
        const a = mean(early.map(n => n.min)), b = mean(late.map(n => n.min));
        if (b - a >= 30) {
            out.push({
                title: `${fmtDuration(b - a)} menos cuando madrugas`,
                text: `Las noches que te levantas antes de las 6:30 duermes ${fmtDuration(a)} de media, frente a ${fmtDuration(b)} el resto (${early.length} madrugones). Esos días, acuéstate antes o recupera con siesta.`
            });
        }
    }

    // Cómo duermes tras los días de más carga
    const loaded = nights
        .map(n => ({ n, load: num((byDate[addDays(n.date, -1)] || {}).trainingKcal) }))
        .filter(x => x.load > 0 && x.n.quality !== null);
    if (loaded.length >= 9) {
        const sorted = loaded.map(x => x.load).sort((a, b) => a - b);
        const cut = sorted[Math.floor(sorted.length * 2 / 3)];
        const hard = loaded.filter(x => x.load >= cut), easy = loaded.filter(x => x.load < cut);
        if (hard.length >= 3 && easy.length >= 3) {
            const d = Math.round(mean(hard.map(x => x.n.quality)) - mean(easy.map(x => x.n.quality)));
            if (Math.abs(d) >= 5) {
                out.push({
                    title: `Nota ${d > 0 ? '+' : '−'}${Math.abs(d)} tras los días duros`,
                    text: `Después de tus días de más carga tu nota de sueño es ${Math.abs(d)} puntos ${d > 0 ? 'mejor' : 'peor'} que tras los días normales (${hard.length} noches).`
                });
            }
        }
    }
    return out;
}
