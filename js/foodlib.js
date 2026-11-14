// SwimFuel · comida: alimentos genéricos ya cocinados con medidas caseras, buscador, crudo↔cocinado y platos.
// Funciones puras (se prueban en tests/).
'use strict';

// Valores medios por 100 g TAL COMO SE COME (cocinado). Sirven para estimar cuando no puedes pesar en crudo:
// son aproximados (la receta y el aceite cambian mucho), por eso lo que añadas de aquí se marca con "≈".
// [nombre, kcal, hidratos, proteína, grasa, [[medida casera, gramos], …]]
const GENERIC_FOODS = [
    ['Arroz blanco cocido', 130, 28, 2.7, 0.3, [['plato', 250], ['cucharón', 150], ['guarnición', 120]]],
    ['Arroz con tomate', 135, 25, 2.8, 2.5, [['plato', 300], ['cucharón', 160]]],
    ['Arroz con pollo o paella', 160, 22, 8, 4.5, [['plato', 350], ['cucharón', 180]]],
    ['Pasta cocida sola', 155, 31, 5.5, 0.9, [['plato', 280], ['guarnición', 150]]],
    ['Pasta con tomate', 140, 24, 4.5, 3, [['plato', 320], ['cucharón', 170]]],
    ['Pasta boloñesa', 160, 19, 8, 5.5, [['plato', 350], ['cucharón', 180]]],
    ['Lentejas guisadas', 110, 13, 7, 3, [['plato hondo', 350], ['cucharón', 180]]],
    ['Garbanzos guisados', 130, 15, 7, 4, [['plato hondo', 350], ['cucharón', 180]]],
    ['Patata cocida', 86, 20, 1.7, 0.1, [['patata mediana', 150]]],
    ['Patatas fritas', 290, 38, 3.5, 14, [['ración', 150], ['guarnición', 80]]],
    ['Puré de patata', 100, 15, 2, 3.5, [['cucharón', 200]]],
    ['Pan blanco', 265, 52, 9, 1.5, [['rebanada', 30], ['trozo de barra', 60], ['bocadillo', 120]]],
    ['Pechuga de pollo a la plancha', 165, 0, 31, 3.6, [['filete', 120], ['palma de la mano', 100]]],
    ['Muslo de pollo asado sin hueso', 190, 0, 25, 10, [['muslo', 110]]],
    ['Filete de ternera a la plancha', 200, 0, 28, 9.5, [['filete', 130]]],
    ['Lomo de cerdo a la plancha', 190, 0, 28, 8, [['filete', 60]]],
    ['Carne picada cocinada', 250, 0, 26, 16, [['ración', 120], ['cucharón', 100]]],
    ['Carne picada con tomate', 170, 5, 15, 10, [['ración', 220], ['cucharón', 150]]],
    ['Hamburguesa, solo la carne', 250, 0, 20, 19, [['unidad', 100]]],
    ['Hamburguesa completa con pan', 250, 24, 13, 11, [['unidad', 220]]],
    ['Salmón a la plancha', 205, 0, 22, 13, [['lomo', 150]]],
    ['Pescado blanco a la plancha', 100, 0, 21, 1.8, [['filete', 150]]],
    ['Atún en lata al natural', 110, 0, 25, 1, [['lata escurrida', 56]]],
    ['Tortilla de patata', 175, 11, 6.5, 12, [['pincho', 150], ['ración grande', 220]]],
    ['Tortilla francesa', 190, 0.7, 12.5, 15, [['de 2 huevos', 110]]],
    ['Huevo frito', 196, 0.8, 13.6, 15, [['unidad', 50]]],
    ['Huevo cocido', 155, 1.1, 12.6, 10.6, [['unidad', 55]]],
    ['Ensalada mixta aliñada', 60, 4, 1.5, 4.5, [['plato', 200], ['guarnición', 100]]],
    ['Verduras cocinadas con aceite', 65, 6, 2, 3.5, [['plato', 200], ['guarnición', 100]]],
    ['Crema de verduras', 50, 6, 1.2, 2.2, [['plato hondo', 300]]],
    ['Pizza', 265, 33, 11, 10, [['porción', 110], ['pizza entera', 400]]],
    ['Bocadillo de lomo o jamón', 250, 30, 13, 8, [['unidad', 200]]],
    ['Yogur natural', 62, 4.7, 3.5, 3.3, [['unidad', 125]]],
    ['Fruta, pieza mediana', 55, 13, 0.7, 0.2, [['pieza', 150]]],
    ['Queso curado', 400, 1, 25, 33, [['loncha', 20], ['cuña', 40]]],
    ['Jamón serrano', 240, 0, 31, 13, [['loncha', 15]]],
    ['Frutos secos', 600, 12, 20, 52, [['puñado', 30]]],
    ['Aceite de oliva', 884, 0, 0, 100, [['cucharada', 12], ['chorro', 8]]],
    ['Zumo de fruta', 45, 10.5, 0.5, 0.1, [['vaso', 200]]],
    ['Bebida isotónica', 26, 6.4, 0, 0, [['botella', 500], ['vaso', 250]]]
].map(([name, kcal, c, p, f, units]) => ({ name, kcal, c, p, f, units }));

function normText(s) {
    return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Cuántas veces y cuándo has usado cada alimento: { nombre normalizado: { count, date, item } }
function usageFromHistory(history) {
    const usage = {};
    history.forEach(h => Object.values(h.mealsSnapshot || {}).forEach(list => (Array.isArray(list) ? list : []).forEach(i => {
        if (!i || !i.name) return;
        const key = normText(i.name);
        const u = usage[key] || (usage[key] = { count: 0, date: '', item: null });
        u.count++;
        if (String(h.date) >= u.date) {
            u.date = String(h.date);
            u.item = i;
        }
    })));
    return usage;
}

// Busca sin tildes ni mayúsculas; todas las palabras deben aparecer. Primero lo que empieza igual y lo que más usas.
function searchFoods(query, entries, usage = {}, limit = 30) {
    const words = normText(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return entries
        .map(e => {
            const n = normText(e.name);
            if (!words.every(w => n.includes(w))) return null;
            const u = usage[n];
            return {
                e,
                score: (n.startsWith(words[0]) ? 100 : 0) + (u ? 50 + Math.min(40, u.count) : 0) - (e.kind === 'generic' ? 20 : 0) - n.length / 100
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(x => x.e);
}

// Cuánto pesa un alimento ya cocinado por cada gramo en crudo (rendimientos habituales de cocina).
// 0 = no se sabe o ya está cocinado. El alimento puede guardar su propio factor, que manda sobre esto.
function guessCookFactor(name, kcal) {
    const n = normText(name);
    if (/cocid|cocinad|plancha|asad|frit|guisad|hervid|lata|bote|conserva|fiambre|loncha|jamon|embutid/.test(n)) return 0;
    const dry = num(kcal) >= 250;   // los cereales y legumbres secos pasan de 300 kcal por 100 g
    if (dry && /arroz/.test(n)) return 2.6;
    if (dry && /pasta|macarron|espagueti|fideo|tallarin|espiral/.test(n)) return 2.3;
    if (dry && /quinoa/.test(n)) return 2.7;
    if (dry && /cuscus/.test(n)) return 2.5;
    if (dry && /lenteja|garbanzo|alubia|judia/.test(n)) return 2.5;
    if (/pollo|pavo|ternera|cerdo|lomo|carne|picada|hamburguesa|solomillo|filete/.test(n)) return 0.75;
    if (/salmon|merluza|pescado|bacalao|dorada|lubina/.test(n)) return 0.8;
    if (/patata|boniato/.test(n) && num(kcal) < 150) return 0.9;
    return 0;
}

// ---------- Platos: una receta guardada que luego se apunta por ración o por gramos servidos ----------
function sanitizeDish(d) {
    if (!d || typeof d !== 'object' || !String(d.name ?? '').trim()) return null;
    return {
        id: ID_RE.test(String(d.id)) ? String(d.id) : newId('d_'),
        name: String(d.name).trim().slice(0, 60),
        ingredients: (Array.isArray(d.ingredients) ? d.ingredients : []).map(sanitizeItem).filter(Boolean).slice(0, 30),
        cookedG: clamp(num(d.cookedG), 0, 50000),          // peso de todo el plato ya cocinado (0 = no se sabe)
        portions: clamp(num(d.portions, 1) || 1, 0.25, 50)
    };
}

function sanitizeDishes(list) {
    return (Array.isArray(list) ? list : []).map(sanitizeDish).filter(Boolean).slice(0, 300);
}

// Totales del plato, valores por 100 g servidos y peso de una ración
function dishTotals(d) {
    const t = { kcal: 0, c: 0, p: 0, f: 0, rawG: 0 };
    d.ingredients.forEach(i => {
        const r = num(i.grams) / 100;
        t.kcal += num(i.kcal100) * r;
        t.c += num(i.c100) * r;
        t.p += num(i.p100) * r;
        t.f += num(i.f100) * r;
        t.rawG += num(i.grams);
    });
    // Sin el peso cocinado se usa la suma de los ingredientes (vale para platos que no ganan ni pierden agua)
    const grams = d.cookedG > 0 ? d.cookedG : t.rawG;
    const k = grams > 0 ? 100 / grams : 0;
    return {
        ...t, grams,
        portionG: grams / d.portions,
        per100: { kcal: round1(t.kcal * k), c: round1(t.c * k), p: round1(t.p * k), f: round1(t.f * k) }
    };
}

// Lo que más repites en una comida concreta (desayuno, cena…) en los últimos 60 días: al menos 2 veces.
// Devuelve [{ count, date, item }] con el alimento tal como lo apuntaste la última vez.
function slotFavorites(history, slotId, openDate, limit = 4) {
    const from = addDays(openDate, -60);
    const stats = {};
    history.forEach(h => {
        if (h.date === openDate || h.date < from) return;
        const list = (h.mealsSnapshot || {})[slotId];
        (Array.isArray(list) ? list : []).forEach(i => {
            if (!i || !i.name) return;
            const key = normText(i.name);
            const s = stats[key] || (stats[key] = { count: 0, date: '', item: null });
            s.count++;
            if (String(h.date) >= s.date) {
                s.date = String(h.date);
                s.item = i;
            }
        });
    });
    return Object.values(stats)
        .filter(s => s.count >= 2)
        .sort((a, b) => b.count - a.count || b.date.localeCompare(a.date))
        .slice(0, limit);
}
