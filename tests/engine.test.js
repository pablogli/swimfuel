// Tests del motor de cálculo (js/engine.js). Se ejecutan abriendo tests/tests.html.
'use strict';

// ---------- Utilidades ----------
test('num: admite texto y usa el valor por defecto si no es un número', () => {
    eq(num('12.5'), 12.5);
    eq(num('abc', 7), 7);
    eq(num(undefined), 0);
});

test('fechas: sumar días cruza meses y años', () => {
    eq(addDays('2026-01-31', 1), '2026-02-01');
    eq(addDays('2026-01-01', -1), '2025-12-31');
    eq(addDays('2024-02-28', 1), '2024-02-29');
});

test('escapeHtml: neutraliza etiquetas y comillas', () => {
    eq(escapeHtml('<b a="1">\'x\'</b>'), '&lt;b a=&quot;1&quot;&gt;&#39;x&#39;&lt;/b&gt;');
});

// ---------- Series escritas como en la pizarra ----------
test('series: suma metros con repeticiones y paréntesis', () => {
    eq(parseSetsMeters('400 + 8x100 c/1:30 + 3x(4x50 + 100) + 200 suave'), 2300);
    eq(parseSetsMeters('8x100'), 800);
    eq(parseSetsMeters('100x8'), 800);
    eq(parseSetsMeters('2x4x50'), 400);
});

test('series: ignora tiempos, descansos, zonas y pulsaciones', () => {
    eq(parseSetsMeters('10x100 c/1:30 desc 20s rpe 7 fc 160'), 1000);
    eq(parseSetsMeters("6x200 c/2'45''"), 1200);
    eq(parseSetsMeters('8 series de 100'), 100);
    eq(parseSetsMeters('1.500 crol'), 1500);
});

test('series: texto sin metros devuelve 0', () => {
    eq(parseSetsMeters(''), 0);
    eq(parseSetsMeters('técnica suave'), 0);
});

// ---------- Entrenos guardados ----------
test('entreno: se limpia y se acota', () => {
    const s = sanitizeSession({ id: 'x y', type: 'swim', minutes: 9999, rpe: 14, meters: 99999, stroke: 'nope', sets: 'a'.repeat(999) });
    eq(s.type, 'swim');
    eq(s.minutes, 600);
    eq(s.rpe, 10);
    eq(s.meters, 30000);
    eq(s.stroke, 'crawl');
    ok(s.sets.length <= 2000, 'las series se acotan');
    ok(/^[\w-]+$/.test(s.id), 'id válido');
    eq(sanitizeSession({ type: 'vuelo' }), null);
});

test('entreno: los días antiguos (solo minutos) se convierten en sesiones', () => {
    const list = legacySessions('Doble Sesión Agua', 120, 45);
    eq(list.length, 2);
    eq(list[0].type, 'swim');
    eq(list[0].minutes, 120);
    eq(list[0].rpe, 7);
    eq(list[1].type, 'gym');
    eq(legacySessions('Descanso', 0, 0).length, 0);
});

test('entreno: gasta más con más metros, más intensidad y estilos menos eficientes', () => {
    const base = { type: 'swim', minutes: 90, meters: 4000, rpe: 6, stroke: 'crawl' };
    const k = s => sessionKcal(sanitizeSession(s), 80).kcal;
    ok(k(base) > 300 && k(base) < 1500, `gasto razonable para 4.000 m: ${k(base)}`);
    ok(k({ ...base, meters: 6000 }) > k(base));
    ok(k({ ...base, rpe: 9 }) > k(base));
    ok(k({ ...base, stroke: 'breast' }) > k(base));
    ok(sessionKcal(sanitizeSession(base), 60).kcal < k(base), 'con menos peso se gasta menos');
});

// ---------- Datos guardados y copias ----------
test('alimentos y comidas: se descartan los inválidos', () => {
    eq(sanitizeFood({ name: '  ' }), null);
    const f = sanitizeFood({ id: 'f_1', name: ' Arroz ', kcal: '360', c: 79, p: -3, f: 'x' });
    eq([f.name, f.kcal, f.c, f.p, f.f, f.defaultG], ['Arroz', 360, 79, 0, 0, 100]);
    const meals = sanitizeMeals({ m1: [{ name: 'Arroz', grams: 100, kcal100: 360 }, null, { grams: 5 }], 'bad key': [] });
    eq(Object.keys(meals), ['m1']);
    eq(meals.m1.length, 1);
});

test('comidas: se quita el número de los nombres antiguos ("3. Comida")', () => {
    eq(sanitizeMealSlots([{ id: 'm3', title: '3. Comida', hint: '' }])[0].title, 'Comida');
});

test('copia: el perfil se mezcla sin perder lo que ya había', () => {
    const p = mergeProfile({ sex: 'M', age: '20' }, { age: 21, goal: 'cut', calibration: 9, sessions: [{ type: 'gym', minutes: 60 }], raro: { a: 1 }, 'clave mala': 1 });
    eq(p.sex, 'M');
    eq(p.age, 21);
    eq(p.goal, 'cut');
    eq(p.calibration, undefined);
    eq(p.sessions.length, 1);
    eq(p.raro, undefined);
    eq(mergeProfile(null, { calibration: '1.1' }).calibration, 1.1);
});

test('copia: los días se filtran por fecha válida y sin repetir', () => {
    const h = cleanHistory([{ date: '2026-01-02' }, { date: 'ayer' }, null, { date: '2026-01-02', x: 1 }, { date: '2026-01-03', sleep: { hours: 8 } }]);
    eq(h.length, 2);
    eq(h[1].sleep.hours, 8);
    eq(cleanHistory('nada'), []);
});

// ---------- Sueño ----------
test('sueño: el tiempo entre dormirse y despertarse cruza la medianoche', () => {
    eq(sleepSpanMin('23:30', '07:15'), 465);
    eq(sleepSpanMin('00:10', '08:00'), 470);
    eq(sleepSpanMin('', '08:00'), 0);
    eq(sleepSpanMin('25:00', '08:00'), 0);
});

test('sueño: se limpia el registro y una noche vacía no se guarda', () => {
    eq(sanitizeSleep(null), null);
    eq(sanitizeSleep({ bed: '', wake: '', min: 0 }), null);
    const s = sanitizeSleep({ bed: '23:30', wake: '07:15', quality: '82', nap: 20, hr: 300, deep: -5 });
    eq([s.min, s.quality, s.nap, s.hr, s.deep], [465, 82, 20, 0, 0]);
    eq(sanitizeSleep({ min: 450, quality: '' }).quality, null);
    eq(sanitizeSleep({ quality: 0 }).quality, 0);
    eq(fmtDuration(465), '7 h 45');
    eq(fmtDuration(480), '8 h 00');
});

test('sueño: medias, deuda y regularidad de la semana', () => {
    const today = '2026-03-10';
    const hist = [0, 1, 2, 3, 4, 5, 6].map(i => ({
        date: addDays(today, -i),
        sleep: { bed: '23:30', wake: '07:00', min: 450, quality: 80, nap: i === 0 ? 30 : 0 }
    }));
    const sum = sleepSummary(hist, today, 510);
    eq(sum.week.nights, 7);
    eq(sum.week.avgMin, 450);
    eq(sum.week.debtMin, 7 * 60 - 30);
    eq(sum.week.avgQuality, 80);
    eq(sum.regularity, 0);
    eq(sum.last.total, 480);
    eq(sum.prevWeek.nights, 0);
    eq(sleepSummary([], today, 510).last, null);
});

test('sueño: la deuda nunca es negativa y las noches largas compensan', () => {
    const today = '2026-03-10';
    const hist = [{ date: today, sleep: { min: 600 } }, { date: addDays(today, -1), sleep: { min: 480 } }];
    eq(sleepSummary(hist, today, 510).week.debtMin, 0);
});

test('sueño: avisos de noche corta, pulso alto y competición', () => {
    const today = '2026-03-10';
    const hist = [1, 2, 3, 4, 5, 6].map(i => ({ date: addDays(today, -i), sleep: { min: 500, quality: 85, hr: 48 } }));
    hist.push({ date: today, sleep: { min: 330, quality: 60, hr: 57 } });
    const titles = sleepAdvice(sleepSummary(hist, today, 510), { weight: 78, dayType: 'Competición' }).map(a => a.title);
    ok(titles.some(t => t.startsWith('Noche corta')), 'noche corta');
    ok(titles.some(t => t.startsWith('Pulso en reposo alto')), 'pulso');
    ok(titles.some(t => t.startsWith('Nota baja')), 'nota baja');
    ok(titles.includes('Antes de competir'), 'competición');
    ok(!titles.includes('Vas bien de sueño'), 'no felicita con avisos');
    const good = sleepAdvice(sleepSummary(hist.slice(0, 6), addDays(today, -1), 510), {}).map(a => a.title);
    eq(good, ['Vas bien de sueño']);
});

test('sueño: patrón de comer más tras dormir poco', () => {
    const today = '2026-03-30';
    const hist = [];
    for (let i = 1; i <= 12; i++) {
        const short = i % 2 === 0;
        hist.push({ date: addDays(today, -i), kcalTarget: 3500, kcalReal: short ? 3800 : 3450, sleep: { min: short ? 380 : 520, wake: '07:30' } });
    }
    const p = sleepPatterns(hist, today, 510);
    eq(p.length, 1);
    ok(p[0].title.startsWith('+350 kcal'), p[0].title);
    eq(sleepPatterns(hist.slice(0, 5), today, 510), []);
});

// ---------- Series por zonas (entreno real del usuario) ----------
const REAL_SESSION = `300 nadar crol
300 nadar estilos sin crol con aletas
300 mariposa con aletas 25 nadar 25 técnica
12x50(1 AEL, 1 pies, 1AEM estilos)
8x150 AEL
2x(3x200AEL,4X150 AEM, 200 recuperación)
400 Suaves`;

test('series: el entreno real suma 5.900 m y reconoce zonas, estilos y material', () => {
    const p = parseSets(REAL_SESSION);
    eq(Math.round(p.meters), 5900);
    ok(p.hasZones);
    const line = n => p.blocks.filter(b => b.line === n);
    eq(line(0).map(b => [b.meters, b.stroke, b.mode]), [[300, 'crawl', 'swim']]);
    eq(line(1).map(b => [b.meters, b.stroke, b.fins]), [[300, 'im', true]]);
    eq(line(2).map(b => [b.meters, b.stroke, b.mode, b.fins]), [[150, 'fly', 'swim', true], [150, 'fly', 'drill', true]]);
    eq(line(3).map(b => [b.meters, b.zone, b.mode, b.stroke]), [[200, 'ael', undefined, undefined], [200, undefined, 'kick', undefined], [200, 'aem', undefined, 'im']]);
    eq(line(4).map(b => [b.meters, b.zone, b.reps]), [[1200, 'ael', 8]]);
    eq(line(5).map(b => [b.meters, b.zone]), [[1200, 'ael'], [1200, 'aem'], [400, 'rec']]);
    eq(line(6).map(b => [b.meters, b.zone]), [[400, 'rec']]);
});

test('series: zonas escritas de varias formas', () => {
    const z = t => parseSets(t).blocks.map(b => b.zone);
    eq(z('8x50 R200'), ['r200']);
    eq(z('8x50 ritmo de 100'), ['r100']);
    eq(z('6x100 vo2 max'), ['vo2']);
    eq(z('4x25 potencia'), ['vel']);
    eq(z('10x100 A2'), ['aem']);
    eq(z('400 aeróbico intenso'), ['aei']);
    eq(z('6x200 umbral'), ['aei']);
    eq(z('200 rec'), ['rec']);
});

test('series: salidas y descansos', () => {
    eq(parseSets('8x100 c/1:30 AEM').blocks[0].interval, 90);
    eq(parseSets("6x200 c/2'45''").blocks[0].interval, 165);
    eq(parseSets('8x50 desc 20').blocks[0].rest, 20);
    eq(parseSets('4x50 r15').blocks[0].rest, 15);
    eq(parseSets('3x100 desc 1:30').blocks[0].rest, 90);
    eq(parseSetsMeters('10x15 vel'), 150);
});

test('series: distancias sin separador y repartos', () => {
    eq(parseSetsMeters('400 crol 200 espalda 100 braza'), 700);
    eq(parseSetsMeters('400 estilos 100 de cada'), 400);
    eq(parseSets('300 crol 25 fuerte 25 suave').blocks.map(b => [b.meters, b.zone]), [[150, 'vo2'], [150, 'rec']]);
    eq(parseSets('3x(100 AEM, 50 pies) aletas').blocks.map(b => [b.meters, b.fins]), [[300, true], [150, true]]);
});

// ---------- Marcas y ritmos ----------
test('marcas: se leen los tiempos en varios formatos', () => {
    eq(parseTime('50.7'), 50.7);
    eq(parseTime('50,7'), 50.7);
    eq(parseTime('1:52.7'), 112.7);
    eq(parseTime('1:52:7'), 112.7);
    eq(parseTime('1.52.7'), 112.7);
    eq(parseTime('4:05'), 245);
    eq(parseTime('4.05'), 245);
    eq(parseTime(''), 0);
    eq(parseTime('abc'), 0);
});

test('marcas: los ritmos suben de zona en zona y salen de tus tiempos', () => {
    const p = swimPaces({ pb50: '23.4', pb100: '50.7', pb200: '1:52.7' });
    ok(p.known);
    near(p.css, 1.535, 0.01, 'velocidad crítica');
    ZONE_KEYS.forEach((z, i) => { if (i) ok(p.speeds[z] > p.speeds[ZONE_KEYS[i - 1]], `${z} más rápido que la zona anterior`); });
    near(100 / p.speeds.ael, 75.7, 1.5, 'AEL por 100');
    near(100 / p.speeds.r100, 52.8, 0.3, 'R100 por 100');
    ok(!swimPaces({}).known);
    near(swimPaces({ pb200: '2:00', pb400: '4:15' }).css, 200 / 135, 0.001);
});

// ---------- Gasto ----------
test('gasto: el entreno real da un valor coherente con los estudios', () => {
    const paces = swimPaces({ pb50: '23.4', pb100: '50.7', pb200: '1:52.7' });
    const s = sanitizeSession({ type: 'swim', minutes: 105, sets: REAL_SESSION, meters: 5900, metersFromSets: true });
    const r = sessionKcal(s, { weight: 80, sex: 'M', paces });
    eq(r.detail.meters, 5900);
    ok(r.detail.hasZones);
    const perKm = r.kcal / 5.9;
    ok(perKm > 230 && perKm < 330, `kcal por km fuera de rango: ${Math.round(perKm)}`);
    eq(r.pct, 15);
    ok(r.detail.swimMin > 70 && r.detail.swimMin < 100, `minutos nadando: ${Math.round(r.detail.swimMin)}`);
    eq(Object.keys(r.detail.lines).length, 7);
});

test('gasto: cada zona cuesta más por metro que la anterior', () => {
    const ctx = { weight: 78, sex: 'M', paces: swimPaces({ pb100: '50.7', pb200: '1:52.7', pb50: '23.4' }) };
    const k = text => sessionKcal(sanitizeSession({ type: 'swim', sets: text, metersFromSets: true }), ctx).kcal;
    const zones = ['rec', 'AEL', 'AEM', 'AEI', 'VO2', 'R200', 'R100', 'VEL'].map(z => k(`1000 ${z}`));
    zones.forEach((v, i) => { if (i) ok(v > zones[i - 1], `zona ${i}: ${Math.round(v)} no supera ${Math.round(zones[i - 1])}`); });
    // A ritmo de 100, el metro cuesta entre 1,6 y 2,6 veces lo que en aeróbico ligero (sin contar descansos)
    const swimOnly = z => { const d = sessionKcal(sanitizeSession({ type: 'swim', sets: `1000 ${z} c/0:01`, metersFromSets: true }), ctx); return d.kcal; };
    const ratio = swimOnly('R100') / swimOnly('AEL');
    ok(ratio > 1.6 && ratio < 2.6, `R100/AEL = ${ratio.toFixed(2)}`);
});

test('gasto: estilos, pies, aletas y peso', () => {
    const ctx = { weight: 78, sex: 'M', paces: swimPaces({ pb200: '1:52.7' }) };
    const k = (text, c = ctx) => sessionKcal(sanitizeSession({ type: 'swim', sets: text, metersFromSets: true }), c).kcal;
    ok(k('1000 AEM braza') > k('1000 AEM mariposa'), 'braza > mariposa');
    ok(k('1000 AEM mariposa') > k('1000 AEM'), 'mariposa > crol');
    ok(k('1000 AEM espalda') > k('1000 AEM'), 'espalda > crol');
    ok(k('1000 AEM pies') > k('1000 AEM'), 'pies > nado');
    ok(k('1000 AEM pies aletas') < k('1000 AEM pies'), 'pies con aletas < pies');
    ok(k('1000 AEM aletas') < k('1000 AEM'), 'aletas < sin aletas');
    const finsCut = 1 - k('1000 AEM aletas c/0:01') / k('1000 AEM c/0:01');
    ok(finsCut > 0.04 && finsCut < 0.16, `aletas en nado completo: −${Math.round(finsCut * 100)} %`);
    ok(k('1000 AEM', { ...ctx, weight: 60 }) < k('1000 AEM'), 'menos peso, menos gasto');
    ok(k('1000 AEM', { ...ctx, sex: 'F' }) < k('1000 AEM'), 'mujer, menos gasto a igual velocidad');
});

test('gasto: si corriges los metros a mano se respeta tu total', () => {
    const ctx = { weight: 78, sex: 'M', paces: swimPaces({}) };
    const auto = sessionKcal(sanitizeSession({ type: 'swim', sets: '10x100 AEM c/0:01', meters: 1000, metersFromSets: true }), ctx);
    const manual = sessionKcal(sanitizeSession({ type: 'swim', sets: '10x100 AEM c/0:01', meters: 2000, metersFromSets: false }), ctx);
    near(manual.kcal / auto.kcal, 2, 0.01);
    eq(manual.detail.meters, 2000);
    eq(auto.pct, 20);
});

test('gasto base: fórmula para deportistas y con masa magra', () => {
    near(restingEnergy({ sex: 'M', age: 20, height: 186, weight: 80 }), 2106, 2);
    near(restingEnergy({ sex: 'F', age: 20, height: 170, weight: 60 }), 1583, 2);
    near(restingEnergy({ sex: 'M', age: 20, height: 186, weight: 80, bodyFat: 10 }), 22.771 * 72 + 484.264, 0.01);
    near(dayMargin(3000, [{ kcal: 1000, pct: 15 }, { kcal: 300, pct: 25 }]), Math.sqrt(300 ** 2 + 150 ** 2 + 75 ** 2), 0.01);
});

test('gasto base: las horas de entreno no cuentan dos veces', () => {
    eq(baseEnergy(2000, 1.4, 0), 2800);
    near(baseEnergy(2000, 1.4, 180), 2800 - 100, 0.01);
    eq(baseEnergy(2000, 1.0, 180), 2000);
});

// ---------- Gasto real y macros ----------
test('tendencia: un pesaje hinchado apenas la mueve', () => {
    const xs = [0, 2, 4, 6, 8, 10, 12, 14], ys = xs.map(x => 80 - 0.02 * x);
    ys[4] += 1.5;
    const t = theilSen(xs, ys);
    near(t.slope, -0.02, 0.004);
    near(t.intercept, 80, 0.05);
    eq(median([3, 1, 2]), 2);
    eq(median([4, 1, 2, 3]), 2.5);
});

test('gasto real: sale de lo que comes y de la tendencia del peso', () => {
    const today = '2026-03-30';
    const hist = [];
    for (let i = 1; i <= 28; i++) {
        const x = 28 - i;
        hist.push({ date: addDays(today, -i), kcalReal: 3500, kcalTarget: 3600, weighed: i % 2 === 0, weight: 80 - 0.02 * x + (i === 10 ? 1.5 : 0) });
    }
    hist[2].kcalReal = 1000;   // un día apuntado a medias
    const a = expenditureAnalysis(hist, today, () => 3400);
    ok(a.ready);
    eq(a.partial, 1);
    eq(a.fedDays, 27);
    near(a.slopeWeek, -0.14, 0.02);
    near(a.realTDEE, 3654, 20);
    eq(a.suggested, 1.07);
    ok(a.marginKcal > 0 && a.marginKcal < 400, `margen ${Math.round(a.marginKcal)}`);
    const few = expenditureAnalysis(hist.filter((h, k) => k < 8), today, () => 3400);
    ok(!few.ready);
    eq(expenditureAnalysis([], today, () => 3400).weighIns, 0);
});

test('gasto real: el ajuste se limita y avanza poco a poco', () => {
    const today = '2026-03-30';
    const hist = [];
    for (let i = 1; i <= 28; i++) hist.push({ date: addDays(today, -i), kcalReal: 2000, kcalTarget: 3000, weighed: true, weight: 80 });
    eq(expenditureAnalysis(hist, today, () => 4000).suggested, 0.85);
    eq(nextCalibration(1, 1.07, 1), 1.01);
    eq(nextCalibration(1, 1.07, 30), 1.07);
    eq(nextCalibration(1.1, 0.9, 2), 1.08);
    eq(nextCalibration(1.03, 1.03, 5), 1.03);
});

test('macros: hidratos según la carga y energía cuadrada', () => {
    near(carbsPerKg(0, 80, 'Normal'), 4, 0.001);
    near(carbsPerKg(1950, 80, 'Normal'), 8.14, 0.01);
    eq(carbsPerKg(9000, 80, 'Normal'), 10);
    eq(carbsPerKg(300, 80, 'Competición'), 7);
    eq(carbsPerKg(300, 80, 'Tapering'), 6);
    const hard = macroTargets({ weight: 80, totalKcal: 4900, trainingKcal: 1950, goal: 'maint', specialty: 'sprint', dayType: 'Normal' });
    eq(hard.p, 168);
    near(hard.kcal, 4900, 15);
    near(hard.f * 9 / 4900, 0.30, 0.005);
    ok(hard.c / 80 > 8.1);
    const rest = macroTargets({ weight: 80, totalKcal: 2900, trainingKcal: 0, goal: 'maint', specialty: 'sprint', dayType: 'Normal' });
    near(rest.kcal, 2900, 15);
    ok(rest.c < hard.c);
    const cut = macroTargets({ weight: 80, totalKcal: 2600, trainingKcal: 1500, goal: 'cut', specialty: 'sprint', dayType: 'Normal' });
    eq(cut.p, 184);
    ok(cut.f >= 64, 'grasa mínima');
    near(cut.kcal, 2600, 15);
    eq(normalizeDayType('Doble Sesión Agua'), 'Normal');
    eq(normalizeDayType('Competición'), 'Competición');
});

test('comer alrededor del entreno: doble sesión, madrugón y descanso', () => {
    const targets = { p: 168 };
    const plan = fuelPlan([
        { label: 'Gimnasio', time: '16:00', minutes: 60, kcal: 300 },
        { label: 'Agua', time: '07:00', minutes: 105, kcal: 1500 }
    ], 80, targets);
    eq(plan.map(p => p.title), ['Proteína', 'Agua de las 07:00', 'Gimnasio de las 16:00']);
    ok(plan[0].text.includes('5 tomas de unos 35 g'), plan[0].text);
    ok(plan[1].text.includes('desayuno completo') && plan[1].text.includes('Durante') && plan[1].text.includes('quedan unas 7 h'), plan[1].text);
    ok(plan[2].text.includes('80–160 g') && plan[2].text.includes('comida completa'), plan[2].text);
    eq(fuelPlan([], 80, targets).map(p => p.title), ['Proteína', 'Día de descanso']);
    ok(fuelPlan([{ label: 'Agua', minutes: 90, kcal: 900 }, { label: 'Agua', minutes: 90, kcal: 900 }], 80, targets)[1].text.includes('hasta el siguiente entreno'));
});
