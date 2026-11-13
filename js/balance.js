// SwimFuel · gasto real (lo que comes frente a la tendencia de tu peso), macros según la carga y
// qué comer alrededor del entreno. Funciones puras (se prueban en tests/).
'use strict';

// ==========================================================
// TIPO DE DÍA Y MACROS
// ==========================================================
// Antes el tipo de jornada decidía los hidratos; ahora salen de lo que entrenas y el tipo solo marca
// los días especiales. Los valores antiguos ("Agua + Gimnasio", "Descanso"…) cuentan como normales.
function normalizeDayType(v) {
    return v === 'Competición' || v === 'Tapering' ? v : 'Normal';
}

// Hidratos por kg según la carga real del día (Burke 2011; Thomas, Erdman y Burke 2016):
// 4 g/kg en descanso, unos 6 con una hora de entreno, 8 con dos sesiones y hasta 10 en los días más duros.
function carbsPerKg(trainingKcal, weight, dayType) {
    let c = clamp(4 + 0.17 * num(trainingKcal) / weight, 4, 10);
    if (dayType === 'Competición') c = Math.max(c, 7);   // se gasta poco, pero el glucógeno tiene que estar lleno
    if (dayType === 'Tapering') c = Math.max(c, 6);
    return c;
}

// Proteína fija por kg, hidratos por carga y grasas con el resto (entre el 20 % y el 30 % de las kcal)
function macroTargets({ weight, totalKcal, trainingKcal, goal, specialty, dayType }) {
    const protFactor = goal === 'cut' ? 2.3 : (specialty === 'distance' ? 1.9 : 2.1);
    const p = weight * protFactor;
    let c = weight * carbsPerKg(trainingKcal, weight, dayType);
    const minF = Math.max(weight * 0.8, totalKcal * 0.20 / 9);
    const maxF = totalKcal * 0.30 / 9;
    let f = (totalKcal - c * 4 - p * 4) / 9;
    if (f > maxF) {
        c += (f - maxF) * 9 / 4;       // sobra energía: va a hidratos
        f = maxF;
    } else if (f < minF) {
        f = minF;                      // falta energía: se recortan hidratos, no las grasas mínimas
        c = Math.max(weight * 3, (totalKcal - p * 4 - f * 9) / 4);
    }
    const r = { c: Math.round(c), p: Math.round(p), f: Math.round(f) };
    return { ...r, kcal: calcKcal(r.c, r.p, r.f) };
}

// Qué comer alrededor de cada entreno. list: [{ label, time, minutes, kcal }]
function fuelPlan(list, weight, targets) {
    const r5 = v => Math.round(v / 5) * 5;
    const out = [];
    const meals = clamp(Math.round(targets.p / (weight * 0.4)), 3, 5);
    out.push({
        title: 'Proteína',
        text: `Repártela en ${meals} tomas de unos ${r5(targets.p / meals)} g (alrededor de 0,4 g/kg) a lo largo del día: se aprovecha mejor que en dos comidas grandes.`
    });
    if (!list.length) {
        out.push({
            title: 'Día de descanso',
            text: 'Hoy los hidratos bajan porque no hay entreno que reponer, pero la proteína se mantiene: es cuando el músculo se repara.'
        });
        return out;
    }

    const startOf = s => timeToMin(s.time);
    const sorted = [...list].sort((a, b) => (startOf(a) ?? 9999) - (startOf(b) ?? 9999));
    sorted.forEach((s, k) => {
        const start = startOf(s);
        const next = sorted[k + 1];
        const nextStart = next ? startOf(next) : null;
        const parts = [];
        if (start !== null && start < 450) {
            parts.push('Antes: si no te entra un desayuno completo, 30–60 g de hidratos fáciles (plátano, pan con miel, zumo) 20–40 min antes.');
        } else {
            parts.push(`Antes: ${r5(weight)}–${r5(weight * 2)} g de hidratos entre 1 y 3 h antes, con poca grasa y poca fibra.`);
        }
        if (num(s.minutes) >= 75 || num(s.kcal) >= 700) {
            parts.push('Durante: 30–60 g de hidratos por hora en la botella, además de agua.');
        }
        const gapH = start !== null && nextStart !== null ? (nextStart - start - num(s.minutes)) / 60 : null;
        if (next && (gapH === null || (gapH > 0 && gapH < 8))) {
            parts.push(`Después: ${r5(weight * 0.3)} g de proteína cuanto antes y ${r5(weight)}–${r5(weight * 1.2)} g de hidratos por hora hasta el siguiente entreno` +
                `${gapH !== null ? ` (quedan unas ${Math.max(1, Math.floor(gapH))} h)` : ''}: con menos de 8 h entre sesiones, reponer rápido marca la diferencia.`);
        } else {
            parts.push(`Después: comida completa en la primera hora o dos, con ${r5(weight * 0.3)}–${r5(weight * 0.4)} g de proteína e hidratos.`);
        }
        out.push({ title: s.time ? `${s.label} de las ${s.time}` : s.label, text: parts.join(' ') });
    });
    return out;
}

// ==========================================================
// GASTO REAL: lo que comes frente a la tendencia de tu peso
// ==========================================================
// minFoodDays: días con las comidas completas · completeFrac: un día con menos de esa parte del objetivo
// apuntada se considera a medias y no cuenta · min/max: límites del ajuste · stepPerDay: lo que cambia al día
const CALIB = {
    windowDays: 28, minFoodDays: 12, minWeighIns: 6, minSpanDays: 14, kcalPerKg: 7700,
    completeFrac: 0.55, min: 0.85, max: 1.25, stepPerDay: 0.01
};

function median(arr) {
    const a = [...arr].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Tendencia robusta (Theil–Sen): la mediana de las pendientes entre todos los pares de pesajes.
// Un día hinchado por la sal, los hidratos o la competición apenas la mueve.
function theilSen(xs, ys) {
    const slopes = [];
    for (let i = 0; i < xs.length; i++) {
        for (let j = i + 1; j < xs.length; j++) {
            if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
        }
    }
    const slope = slopes.length ? median(slopes) : 0;
    return { slope, intercept: median(ys.map((y, k) => y - slope * xs[k])) };
}

// estimate(record) → kcal que la app calcula para ese día SIN ajuste (base + entrenos)
function expenditureAnalysis(history, today, estimate) {
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const from = addDays(today, -CALIB.windowDays);
    const dayIdx = d => Math.round((new Date(`${d}T12:00`) - new Date(`${from}T12:00`)) / 86400000);
    // Hoy no cuenta: el día aún no ha terminado
    const win = history.filter(h => h.date >= from && h.date < today);
    const logged = win.filter(h => num(h.kcalReal) > 0);
    const fed = logged.filter(h => !(num(h.kcalTarget) > 0) || num(h.kcalReal) >= CALIB.completeFrac * num(h.kcalTarget));
    const weighs = win
        .filter(h => h.weighed === true && num(h.weight) >= 30)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(h => ({ date: h.date, x: dayIdx(h.date), w: num(h.weight) }));
    const span = weighs.length > 1 ? weighs[weighs.length - 1].x - weighs[0].x : 0;
    const xs = weighs.map(p => p.x), ys = weighs.map(p => p.w);
    const res = {
        from, weighs, span, ready: false,
        fedDays: fed.length, partial: logged.length - fed.length, weighIns: weighs.length,
        trend: weighs.length >= 4 ? theilSen(xs, ys) : null
    };
    if (fed.length < CALIB.minFoodDays || weighs.length < CALIB.minWeighIns || span < CALIB.minSpanDays) return res;

    const { slope, intercept } = res.trend;
    // Margen: cuánto bailan los pesajes alrededor de la tendencia (agua, sal, glucógeno)
    const scatter = Math.max(0.15, 1.4826 * median(weighs.map(p => Math.abs(p.w - (intercept + slope * p.x)))));
    const mx = mean(xs);
    const slopeSe = scatter / Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0));

    // Un día en el que más del 40 % de las kcal son estimaciones (≈) cuenta la mitad
    const wOf = h => (num(h.estKcal) > 0.4 * num(h.kcalReal) ? 0.5 : 1);
    const wSum = fed.reduce((a, h) => a + wOf(h), 0);
    const wMean = f => fed.reduce((a, h) => a + wOf(h) * f(h), 0) / wSum;
    const avgIntake = wMean(h => num(h.kcalReal));
    // Si comes X y tu peso no cambia, gastas X. Si bajas, gastas más de lo que comes (7.700 kcal ≈ 1 kg)
    const realTDEE = avgIntake - slope * CALIB.kcalPerKg;
    const estRaw = wMean(h => num(estimate(h)));
    if (!(estRaw > 0) || !(realTDEE > 0)) return res;
    const ratio = realTDEE / estRaw;
    return {
        ...res, ready: true, slopeWeek: slope * 7, avgIntake, realTDEE, estRaw, ratio,
        marginKcal: slopeSe * CALIB.kcalPerKg,
        suggested: Math.round(clamp(ratio, CALIB.min, CALIB.max) * 100) / 100
    };
}

// El ajuste se acerca al gasto real poco a poco: como mucho un 1 % por cada día que pasa
function nextCalibration(current, suggested, days = 1) {
    const step = CALIB.stepPerDay * clamp(Math.round(num(days, 1)), 1, 14);
    return Math.round(clamp(suggested, current - step, current + step) * 100) / 100;
}
