// SwimFuel · entrenos: lector de series (escritas como en la pizarra) y gasto por zonas.
// Funciones puras, sin pantalla ni almacenamiento (se prueban en tests/).
'use strict';

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

// ==========================================================
// ZONAS, ESTILOS Y MATERIAL
// ==========================================================
// css: velocidad frente a tu velocidad crítica (≈ ritmo de umbral) · rest: descanso habitual frente al
// tiempo nadando cuando no escribes la salida · epoc: gasto extra tras el esfuerzo (LaForgia 2006: 6–15 %)
const ZONES = {
    rec: { short: 'REC', label: 'Recuperación / suave', css: 0.80, rest: 0.08, epoc: 0.06 },
    ael: { short: 'AEL', label: 'Aeróbico ligero', css: 0.86, rest: 0.10, epoc: 0.06 },
    aem: { short: 'AEM', label: 'Aeróbico medio', css: 0.92, rest: 0.15, epoc: 0.06 },
    aei: { short: 'AEI', label: 'Aeróbico intenso / umbral', css: 0.98, rest: 0.20, epoc: 0.08 },
    vo2: { short: 'VO2', label: 'VO2 máx', css: 1.05, rest: 0.60, epoc: 0.10 },
    r200: { short: 'R200', label: 'Ritmo de 200', css: 1.13, rest: 1.2, epoc: 0.12 },
    r100: { short: 'R100', label: 'Ritmo de 100', css: 1.23, rest: 2.5, epoc: 0.12 },
    vel: { short: 'VEL', label: 'Velocidad / potencia', css: 1.33, rest: 5, epoc: 0.12 }
};
const ZONE_KEYS = Object.keys(ZONES);

// Coste energético neto por metro en kJ/m = a · 10^(b · v), con v en m/s. Ajustado a los valores medidos
// a 1,0 y 1,5 m/s en nadadores de élite (Capelli, Pendergast y Termin 1998): crol 0,70 y 1,23; espalda 0,84 y 1,47;
// mariposa 0,82 y 1,55; braza 1,24 y 1,87. speed: velocidad frente al crol en la misma zona.
const STROKE_COST = {
    crawl: { label: 'crol', a: 0.228, b: 0.488, speed: 1.00 },
    back: { label: 'espalda', a: 0.274, b: 0.486, speed: 0.90 },
    fly: { label: 'mariposa', a: 0.230, b: 0.553, speed: 0.90 },
    breast: { label: 'braza', a: 0.545, b: 0.357, speed: 0.78 }
};

// En la misma zona el esfuerzo (potencia metabólica) es parecido; al ir más lento, cada metro cuesta más.
const SWIM_MODES = {
    swim: { label: 'nado', power: 1.00, speed: 1.00 },
    kick: { label: 'pies', power: 0.85, speed: 0.62 },
    pull: { label: 'brazos', power: 0.88, speed: 0.95 },
    drill: { label: 'técnica', power: 0.85, speed: 0.78 }
};
// Aletas: a igual esfuerzo se va más rápido (pies +0,2 m/s; nado completo 10–15 % menos coste; Zamparo 2002, 2006)
const FINS_SPEED = { kick: 1.25, other: 1.07 };
const PADDLES_SPEED = 1.03;

// ==========================================================
// MARCAS Y RITMOS
// ==========================================================
// "50.7", "50,7", "1:52.7", "1:52:7", "1.52.7", "4:05" → segundos (0 si no es un tiempo)
function parseTime(text) {
    const raw = String(text ?? '').trim();
    const parts = raw.split(/[:.,'"\s]+/).filter(Boolean);
    if (!parts.length || parts.length > 3 || parts.some(p => !/^\d{1,3}$/.test(p))) return 0;
    const frac = p => Number(p) / 10 ** p.length;
    let sec;
    if (parts.length === 1) {
        sec = Number(parts[0]);
    } else if (parts.length === 3) {
        sec = Number(parts[0]) * 60 + Number(parts[1]) + frac(parts[2]);
    } else {
        const sep = (raw.match(/[:.,'"]/) || ['.'])[0];
        const asDecimal = Number(parts[0]) + frac(parts[1]);
        // "4.05" no puede ser 4 segundos: es 4 min 05
        sec = sep === ':' || sep === "'" || asDecimal < 15 ? Number(parts[0]) * 60 + Number(parts[1]) : asDecimal;
    }
    return sec >= 15 && sec <= 1800 ? sec : 0;
}

function fmtPace(speed) {
    const sec = Math.round(100 / speed);
    return sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec} s`;
}

// Velocidad de crol en cada zona (m/s) a partir de tus marcas. Sin marcas se supone un nadador entrenado.
function swimPaces(prof = {}) {
    const t = k => parseTime(prof[k]);
    const t50 = t('pb50'), t100 = t('pb100'), t200 = t('pb200'), t400 = t('pb400');
    // Velocidad crítica: con 200 y 400 se calcula directamente; si no, se estima de la marca más larga que haya
    let css = 0;
    if (t200 && t400 > t200 * 2) css = 200 / (t400 - t200);
    else if (t400) css = 0.955 * 400 / t400;
    else if (t200) css = 0.865 * 200 / t200;
    else if (t100) css = 0.78 * 100 / t100;
    else if (t50) css = 0.72 * 50 / t50;
    const known = css > 0;
    css = clamp(known ? css : 1.25, 0.7, 1.9);

    const speeds = {};
    ZONE_KEYS.forEach(z => { speeds[z] = css * ZONES[z].css; });
    // Los ritmos de prueba salen de la propia marca (algo más lento: en entreno se sale desde la pared)
    if (t200) speeds.r200 = 0.97 * 200 / t200;
    if (t100) speeds.r100 = 0.96 * 100 / t100;
    if (t50) speeds.vel = 0.97 * 50 / t50;
    for (let i = 1; i < ZONE_KEYS.length; i++) {
        speeds[ZONE_KEYS[i]] = Math.max(speeds[ZONE_KEYS[i]], speeds[ZONE_KEYS[i - 1]] * 1.02);
    }
    return { css, known, speeds };
}

// Coste de nadar un estilo completo cuando el crol iría a vCrawl → { kj: kJ por metro, v: velocidad real }
function strokeCostPerM(stroke, vCrawl) {
    const one = key => {
        const c = STROKE_COST[key];
        const v = vCrawl * c.speed;
        return { kj: c.a * 10 ** (c.b * v), v };
    };
    if (stroke === 'im') {
        const all = Object.keys(STROKE_COST).map(one);
        return {
            kj: all.reduce((a, x) => a + x.kj, 0) / all.length,
            v: all.length / all.reduce((a, x) => a + 1 / x.v, 0)
        };
    }
    return one(STROKE_COST[stroke] ? stroke : 'crawl');
}

// ==========================================================
// LECTOR DE SERIES
// ==========================================================
// "8x100 c/1:30 AEM", "12x50 (1 AEL, 1 pies, 1 AEM estilos)", "2x(3x200 AEL, 4x150 AEM, 200 rec)",
// "300 mariposa con aletas 25 nadar 25 técnica"…
const SET_WORDS = (() => {
    const map = {};
    const add = (attr, value, words) => words.split(' ').forEach(w => { map[w] = [attr, value]; });
    add('zone', 'rec', 'zrec rec recuperacion suave suaves suelto sueltos soltar facil relajado calma afloje regenerativo');
    add('zone', 'ael', 'zael ael ligero ligera');
    add('zone', 'aem', 'zaem aem medio media');
    add('zone', 'aei', 'zaei aei intenso intensa umbral');
    add('zone', 'vo2', 'zvo2 fuerte fuertes');
    add('zone', 'r200', 'zr200 tl lactico');
    add('zone', 'r100', 'zr100 pl');
    add('zone', 'vel', 'zr50 zvel vel velocidad sprint sprints potencia pot max maximo maxima tope explosivo');
    add('stroke', 'crawl', 'crol crawl libre libres');
    add('stroke', 'back', 'espalda esp');
    add('stroke', 'breast', 'braza');
    add('stroke', 'fly', 'mariposa mp');
    add('stroke', 'im', 'estilos');
    add('mode', 'kick', 'pies piernas patada tabla kick');
    add('mode', 'pull', 'brazos pull pullbuoy');
    add('mode', 'drill', 'tecnica tec ejercicio ejercicios drill drills');
    add('mode', 'swim', 'nadar nado completo normal');
    add('fins', true, 'aletas');
    add('paddles', true, 'palas');
    return map;
})();

function normalizeSetLine(line) {
    let t = String(line).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    t = t.replace(/[×*]/g, 'x').replace(/(\d{1,2})\.(\d{3})\b/g, '$1$2');           // 1.500 → 1500
    t = t.replace(/\b(?:rpe|fc|ppm)\s*\d+/g, ' ').replace(/\d+\s*%/g, ' ');

    // Zonas escritas con números o con varias palabras → una sola palabra
    t = t.replace(/\b(?:ritmo|paso)\s*(?:de\s*)?(?:prueba\s*)?(?:de\s*)?(50|100|200)\b/g, (m, d) => ` zr${d} `)
        .replace(/\br[pc]?(50|100|200)\b/g, (m, d) => ` zr${d} `)
        .replace(/\bm?vo2\s*(?:max)?\b/g, ' zvo2 ')
        .replace(/\bpotencia aerobica\b/g, ' zvo2 ')
        .replace(/\baerobic[oa] (ligero|medio|intenso)\b/g, (m, w) => ({ ligero: ' zael ', medio: ' zaem ', intenso: ' zaei ' }[w]))
        .replace(/\btolerancia(?: lactica| al lactato)?\b/g, ' zr200 ')
        .replace(/\bproduccion(?: de lactato| lactica)?\b/g, ' zr100 ')
        .replace(/\ba tope\b/g, ' zvel ')
        .replace(/\bvuelta a la calma\b/g, ' zrec ')
        .replace(/\ba([0-3])\b/g, (m, d) => [' zrec ', ' zael ', ' zaem ', ' zaei '][d])
        .replace(/\bz([1-5])\b/g, (m, d) => [' zrec ', ' zael ', ' zaem ', ' zaei ', ' zvo2 '][d - 1])
        .replace(/\ben([1-3])\b/g, (m, d) => [' zael ', ' zaem ', ' zaei '][d - 1])
        .replace(/\bsin (?:crol|libre|espalda|braza|mariposa)\b/g, ' ')
        .replace(/\b4 estilos\b/g, ' estilos ');

    // Descansos largos (desc 1:30) → qd<segundos>
    t = t.replace(/\b(?:desc(?:anso)?|rec)\s*:?\s*(\d{1,2})\s*[:'’´]\s*(\d{2})\s*(?:''|"|”)?/g, (m, a, b) => ` qd${Number(a) * 60 + Number(b)} `);
    // Salidas (c/1:30, cada 1'30, un 1:30 suelto, c/45) → qi<segundos>
    t = t.replace(/(?:c\/|cada|salidas?|sal|@)?\s*(\d{1,2})\s*[:'’´]\s*(\d{2})\s*(?:''|"|”)?/g, (m, a, b) => ` qi${Number(a) * 60 + Number(b)} `);
    t = t.replace(/(?:c\/|cada|@)\s*(\d{2,3})\s*(?:''|"|”|seg\w*|s\b)?/g, (m, a) => ` qi${Number(a)} `);
    // Descansos (desc 20, r20, 20", 15 seg, 1') → qd<segundos>
    const rest = (n, unit) => ` qd${Number(n) * (unit && unit !== "''" && /^('|min)/.test(unit) ? 60 : 1)} `;
    // ("rec 200" sin unidad es una distancia de recuperación, no un descanso de 200 s)
    t = t.replace(/\b(desc(?:anso)?|rec|r|d\/)\s*:?\s*(\d{1,3})(?!\d|\s*x)\s*(''|"|”|seg\w*|s\b|'|min\w*)?/g,
        (m, pre, n, unit) => (pre[0] === 'r' && !unit && Number(n) >= 100 ? m : rest(n, unit)));
    t = t.replace(/(\d{1,3})\s*(''|"|”|seg\w*\b|s\b)/g, (m, n, unit) => rest(n, unit));
    t = t.replace(/(\d{1,2})\s*('|min\w*\b)/g, (m, n, unit) => rest(n, unit));

    t = t.replace(/(\d|\))\s*x\s*(?=[\d(])/g, '$1 * ');                             // 8x100 → 8 * 100
    return t.replace(/(\d)([a-z])/g, '$1 $2');                                      // 200ael → 200 ael
}

// Devuelve { meters, hasZones, blocks, lineCount }. Cada bloque: { meters, reps, dist, line } y, solo si se
// escribieron, zone, stroke, mode, fins, paddles, interval (salida, s) y rest (descanso, s).
function parseSets(text) {
    const tokens = [], lineOf = [];
    const rawLines = String(text || '').split('\n');
    rawLines.forEach((line, li) => {
        (normalizeSetLine(line).match(/\d+|\*|\(|\)|[,+;\/]|[a-z][a-z0-9]*/g) || []).forEach(tok => {
            tokens.push(tok);
            lineOf.push(li);
        });
        tokens.push(';');
        lineOf.push(li);
    });

    let i = 0;
    const isNum = tok => /^\d+$/.test(tok || '');
    const isSep = tok => tok === ',' || tok === '+' || tok === ';' || tok === '/';
    // Una distancia suelta debe ser múltiplo de 25 (así "8 series" no suma); tras una "x" vale también 15 o 20
    const distOk = (n, inMult) => n <= 20000 && (inMult ? n >= 10 && n % 5 === 0 : n >= 25 && n % 25 === 0);
    const prod = arr => arr.reduce((a, b) => a * b, 1);

    function readAttr(tok, attrs) {
        let m;
        if ((m = /^qi(\d+)$/.exec(tok))) attrs.interval = Number(m[1]);
        else if ((m = /^qd(\d+)$/.exec(tok))) attrs.rest = Number(m[1]);
        else if (SET_WORDS[tok]) attrs[SET_WORDS[tok][0]] = SET_WORDS[tok][1];
    }

    function item() {
        const line = lineOf[i];
        const base = {};
        let mults = [], reps = 1, dist = 0;

        while (i < tokens.length && !dist) {
            const tok = tokens[i];
            if (isSep(tok) || tok === ')') break;
            if (tok === '(') {
                // "2x( … )": un grupo repetido. Lo que se escriba tras el paréntesis vale para todo el grupo
                i++;
                const inner = seq();
                if (tokens[i] === ')') i++;
                const tail = {};
                while (i < tokens.length && !isSep(tokens[i]) && tokens[i] !== ')' && tokens[i] !== '(' && !isNum(tokens[i])) readAttr(tokens[i++], tail);
                const k = Math.min(prod(mults), 200);
                return inner.map(b => ({ ...base, ...tail, ...b, meters: b.meters * k, reps: b.reps * k }));
            }
            if (tok === '*') { i++; continue; }
            if (!isNum(tok)) { readAttr(tok, base); i++; continue; }
            const n = Number(tok);
            if (tokens[i + 1] === '*') { mults.push(n); i += 2; continue; }
            i++;
            if (distOk(n, mults.length > 0)) {
                dist = n;
                reps = prod(mults);
            } else if (mults.length && distOk(mults[mults.length - 1], true) && n <= 100) {
                dist = mults.pop();                                                  // "100x8"
                reps = prod(mults) * n;
            } else {
                mults = [];
            }
        }
        if (!dist) return [];
        reps = Math.min(reps, 500);

        // Lo que sigue a la distancia: palabras de la serie y, si lo hay, cómo se reparte
        let parts = [];
        const inline = [];
        while (i < tokens.length) {
            const tok = tokens[i];
            if (isSep(tok) || tok === ')') break;
            if (tok === '(') {
                i++;
                let cur = null;
                while (i < tokens.length && tokens[i] !== ')') {
                    const t2 = tokens[i++];
                    if (isSep(t2)) { cur = null; continue; }
                    if (t2 === '(' || t2 === '*') continue;
                    if (isNum(t2)) {
                        if (!cur || cur.words) { cur = { w: Number(t2), attrs: {}, words: 0 }; parts.push(cur); }
                        continue;
                    }
                    if (!cur) { cur = { w: 1, attrs: {}, words: 0 }; parts.push(cur); }
                    readAttr(t2, cur.attrs);
                    cur.words++;
                }
                if (tokens[i] === ')') i++;
                continue;
            }
            if (isNum(tok)) {
                if (tokens[i + 1] === '*') break;                                    // empieza otra serie sin separador
                inline.push({ w: Number(tok), attrs: {}, words: 0 });
                i++;
                continue;
            }
            if (inline.length) {
                readAttr(tok, inline[inline.length - 1].attrs);
                inline[inline.length - 1].words++;
            } else {
                readAttr(tok, base);
            }
            i++;
        }
        // Números sueltos tras la distancia. "300 mariposa 25 nadar 25 técnica" es un reparto (25 + 25 cabe justo
        // en 300); "400 crol 200 espalda" son dos distancias a las que les falta el "+"
        const inlineParts = inline.filter(p => p.words > 0 && p.w > 0);
        const inlineSum = inlineParts.reduce((a, p) => a + p.w, 0);
        const extra = [];
        parts = parts.filter(p => p.w > 0);
        if (!parts.length && inlineParts.length >= 2 && dist % inlineSum === 0) {
            parts = inlineParts;
        } else if (!parts.length) {
            inlineParts.filter(p => distOk(p.w, false) && Object.keys(p.attrs).length)
                .forEach(p => extra.push({ ...p.attrs, meters: p.w, reps: 1, dist: p.w, line }));
        }

        const total = reps * dist;
        if (!parts.length) return [{ ...base, meters: total, reps, dist, line }, ...extra];
        const sumW = parts.reduce((a, p) => a + p.w, 0);
        return parts.map(p => ({ ...base, ...p.attrs, meters: total * p.w / sumW, reps: reps * p.w / sumW, dist, line }));
    }

    function seq() {
        const out = [];
        while (i < tokens.length && tokens[i] !== ')') {
            if (isSep(tokens[i])) { i++; continue; }
            const before = i;
            out.push(...item());
            if (i === before) i++;
        }
        return out;
    }

    const blocks = [];
    while (i < tokens.length) {
        blocks.push(...seq());
        i++; // salta un ")" sin pareja
    }
    return {
        meters: blocks.reduce((a, b) => a + b.meters, 0),
        hasZones: blocks.some(b => b.zone),
        blocks,
        lineCount: rawLines.length
    };
}

function parseSetsMeters(text) {
    return Math.round(parseSets(text).meters);
}

// ==========================================================
// GASTO DE CADA ENTRENO
// ==========================================================
// ctx: { weight, sex, paces }. Devuelve { kcal, how, pct, detail }: pct es el margen de error orientativo (±%).
function swimSessionEnergy(s, ctx) {
    const weight = ctx.weight;
    const paces = ctx.paces || swimPaces();
    const rpe = clamp(Math.round(num(s.rpe, 6)), 1, 10);
    const minutes = Math.max(0, num(s.minutes));
    const parsed = parseSets(s.sets);
    let meters = Math.max(0, num(s.meters));
    let blocks = parsed.blocks;
    let factor = 1;
    const fromText = blocks.length > 0;

    if (!fromText) {
        if (!meters) return null;
        blocks = [{ meters, reps: 1, dist: meters, line: -1 }];
    } else if (meters > 0 && !s.metersFromSets) {
        factor = meters / parsed.meters;      // has corregido los metros a mano: se respeta tu total
    } else {
        meters = parsed.meters;
    }

    const sessionKick = s.stroke === 'kick';   // entrenos antiguos con "Piernas / técnica" como estilo
    const baseStroke = s.stroke === 'im' || STROKE_COST[s.stroke] ? s.stroke : 'crawl';
    // Tamaño: el coste medido es de nadadores de unos 76 kg; las mujeres gastan menos a igual velocidad
    const size = (weight / 76) ** 0.67 * (ctx.sex === 'F' ? 0.8 : 1);
    const rpeSpeed = paces.css * (0.76 + 0.024 * rpe);   // sin zonas: velocidad media según tu intensidad

    let kj = 0, epoc = 0, swimSec = 0, restSec = 0;
    const byKey = {};
    const lines = {};
    blocks.forEach(b => {
        const zone = b.zone || (parsed.hasZones ? 'ael' : null);
        const stroke = b.stroke || baseStroke;
        const mode = b.mode || (sessionKick ? 'kick' : 'swim');
        const z = zone ? ZONES[zone] : { rest: 0.12, epoc: 0.06 };
        const full = strokeCostPerM(stroke, zone ? paces.speeds[zone] : rpeSpeed);
        let v = full.v * SWIM_MODES[mode].speed;
        if (b.fins) v *= mode === 'kick' ? FINS_SPEED.kick : FINS_SPEED.other;
        if (b.paddles) v *= PADDLES_SPEED;

        const m = b.meters * factor;
        const e = full.kj * full.v * SWIM_MODES[mode].power / v * m * size;      // kJ = potencia · tiempo
        const sec = m / v;
        let rest = sec * z.rest;
        if (b.interval) rest = b.reps * Math.max(0, b.interval - b.dist / v);
        else if (b.rest) rest = b.reps * b.rest;

        kj += e;
        epoc += e * z.epoc;
        swimSec += sec;
        restSec += rest;

        const key = mode !== 'swim' ? mode : (zone || 'rpe');
        byKey[key] = (byKey[key] || 0) + m;
        if (b.line >= 0) {
            const l = lines[b.line] || (lines[b.line] = { meters: 0, kcal: 0, parts: [] });
            l.meters += m;
            l.kcal += e * (1 + z.epoc) / 4.184;
            const label = [
                mode === 'swim' || b.zone ? (zone ? ZONES[zone].short : '') : '',
                mode !== 'swim' ? SWIM_MODES[mode].label : '',
                b.stroke ? (b.stroke === 'im' ? 'estilos' : STROKE_COST[b.stroke].label) : '',
                b.fins ? 'aletas' : '',
                b.paddles ? 'palas' : ''
            ].filter(Boolean).join(' ');
            l.parts.push({ meters: m, label });
        }
    });

    // Si pones los minutos de la sesión, el tiempo que no nadas es descanso; si no, se estima de las salidas
    const swimMin = swimSec / 60;
    const restMin = minutes > 0 ? Math.max(0, minutes - swimMin) : restSec / 60;
    const kcal = (kj + epoc) / 4.184 + netKcalPerMin(2.5, weight) * restMin;

    let how = parsed.hasZones ? 'por series y zonas' : fromText ? `por series e intensidad ${rpe}` : `por metros e intensidad ${rpe}`;
    how += ` (${fmtInt(meters)} m; ${Math.round(swimMin)} min nadando`;
    how += restMin >= 3 ? ` + ${Math.round(restMin)} de descansos)` : ')';
    if (!paces.known) how += '. Pon tus marcas en Perfil para afinar';
    return {
        kcal,
        how,
        pct: (parsed.hasZones ? 15 : 20) + (paces.known ? 0 : 5),
        detail: { hasZones: parsed.hasZones, meters, swimMin, restMin, byKey, lines }
    };
}

function sessionKcal(s, context) {
    const ctx = typeof context === 'number' ? { weight: context } : context;
    const weight = ctx.weight;
    const rpe = clamp(Math.round(num(s.rpe, 6)), 1, 10);
    const minutes = Math.max(0, num(s.minutes));

    if (s.type === 'swim') {
        const res = swimSessionEnergy(s, ctx);
        if (res) return res;
        // Sin metros ni series: por tiempo, con un MET que ya incluye los descansos de un entreno normal
        const met = 3.5 + 0.7 * rpe;
        return {
            kcal: netKcalPerMin(met, weight) * minutes,
            how: minutes ? `por minutos (MET ${met.toFixed(1)}). Escribe las series para afinar` : 'escribe las series o los minutos',
            pct: 30
        };
    }

    if (s.type === 'gym') {
        // MET a intensidad 6/10 (Compendium of Physical Activities), con los descansos entre series incluidos.
        // Fuerza, potencia y circuito dejan un gasto extra tras el entreno (+10 %)
        const type = GYM_TYPES[s.gymType] || GYM_TYPES.strength;
        const met = type.met * (1 + 0.07 * (rpe - 6));
        const epoc = ['strength', 'power', 'circuit'].includes(s.gymType) ? 1.10 : 1;
        return { kcal: netKcalPerMin(met, weight) * minutes * epoc, how: `según el tipo (${type.label}, MET ${met.toFixed(1)})`, pct: 25 };
    }

    const met = 2 + rpe; // otro deporte: de MET 3 (muy suave) a 12 (máximo)
    return { kcal: netKcalPerMin(met, weight) * minutes, how: `por minutos e intensidad (MET ${met.toFixed(1)})`, pct: 30 };
}

// ==========================================================
// GASTO BASE Y MARGEN DEL DÍA
// ==========================================================
// Metabolismo en reposo con las fórmulas para deportistas de ten Haaf y Weijs (2014), en kcal/día.
// Con el % de grasa se usa la masa magra, que es más precisa.
function restingEnergy({ sex, age, height, weight, bodyFat }) {
    const fat = num(bodyFat);
    if (fat >= 4 && fat <= 45) return 22.771 * weight * (1 - fat / 100) + 484.264;
    return 11.936 * weight + 587.728 * (height / 100) - 8.129 * age + 191.027 * (sex === 'M' ? 1 : 0) + 29.279;
}

// Margen de error del día en kcal: ±10 % del gasto base y el margen de cada entreno, combinados
function dayMargin(base, perSession) {
    const sq = perSession.reduce((a, s) => a + (s.kcal * (s.pct || 25) / 100) ** 2, (base * 0.10) ** 2);
    return Math.sqrt(sq);
}

// Gasto fuera de los entrenos: reposo × actividad. Mientras entrenas no haces tu actividad diaria,
// así que esas horas cuentan solo como reposo (lo demás ya lo suma el entreno).
function baseEnergy(bmr, activity, trainMin) {
    return bmr * activity - bmr * (activity - 1) * clamp(num(trainMin), 0, 600) / 1440;
}
