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
