// SwimFuel · almacenamiento, estado, diario y navegación
'use strict';

// Claves de almacenamiento (se mantienen las de la versión anterior para conservar tus datos)
const STORAGE_KEY_DB = 'swimfuel_custom_food_db_v2';
const STORAGE_KEY_HISTORY = 'swimfuel_daily_history_v2';
const STORAGE_KEY_PROFILE = 'swimfuel_user_profile_v2';
const STORAGE_KEY_MEAL_SLOTS = 'swimfuel_custom_meal_slots_v2';
const STORAGE_KEY_GEMINI_KEY = 'swimfuel_gemini_api_key';
const STORAGE_KEY_DRAFT = 'swimfuel_current_day_draft_v2'; // solo para migrar versiones anteriores
const STORAGE_KEY_LAST_BACKUP = 'swimfuel_last_backup';
const STORAGE_KEY_BACKUP_NAG = 'swimfuel_backup_nag';
const STORAGE_KEY_SCHEMA = 'swimfuel_schema';
const STORAGE_KEY_DISHES = 'swimfuel_dishes_v1';

// Versión de los datos. Regla para no perder nada: los cambios solo AÑADEN campos; un día antiguo se queda
// tal cual hasta que lo editas, y al leerlo se rellenan los campos que le falten.
const SCHEMA_VERSION = 4;

const PROFILE_FIELDS = ['sex', 'age', 'height', 'specialty', 'goal', 'activity', 'pb50', 'pb100', 'pb200', 'pb400', 'bodyFat'];

const COLOR = { ok: '#10b981', warn: '#f59e0b', error: '#f43f5e', info: '#0072ff' };

const INITIAL_STARTER_DB = [
    { id: 'f_oats', name: 'Copos de avena', kcal: 375, c: 60, p: 13, f: 7, defaultG: 80 },
    { id: 'f_rice', name: 'Arroz blanco / basmati (en crudo)', kcal: 360, c: 79, p: 7, f: 0.8, defaultG: 100 },
    { id: 'f_pasta', name: 'Pasta de trigo (en crudo)', kcal: 355, c: 72, p: 12.5, f: 1.5, defaultG: 110 },
    { id: 'f_chicken', name: 'Pechuga de pollo (en crudo)', kcal: 115, c: 0, p: 23, f: 2, defaultG: 200 },
    { id: 'f_salmon', name: 'Salmón fresco (en crudo)', kcal: 208, c: 0, p: 20, f: 13, defaultG: 160 },
    { id: 'f_eggs', name: 'Huevo entero (1 L ~ 60g)', kcal: 143, c: 0.7, p: 12.6, f: 9.5, defaultG: 120 },
    { id: 'f_whey', name: 'Proteína Whey Isolate (polvo)', kcal: 375, c: 4, p: 82, f: 2, defaultG: 35 },
    { id: 'f_banana', name: 'Plátano (sin piel)', kcal: 89, c: 22.8, p: 1.1, f: 0.3, defaultG: 120 },
    { id: 'f_milk', name: 'Leche semidesnatada', kcal: 47, c: 4.8, p: 3.3, f: 1.6, defaultG: 250 },
    { id: 'f_oil', name: 'Aceite de Oliva Virgen Extra (AOVE)', kcal: 884, c: 0, p: 0, f: 100, defaultG: 15 }
];

const DEFAULT_MEAL_SLOTS = [
    { id: 'm1', title: 'Desayuno / Pre-entreno', hint: 'Carga energética matinal' },
    { id: 'm2', title: 'Post-entreno agua', hint: 'Reposición rápida tras la piscina' },
    { id: 'm3', title: 'Comida', hint: 'Recuperación de glucógeno y proteína' },
    { id: 'm4', title: 'Merienda / Pre-gimnasio', hint: 'Energía para la sesión de fuerza' },
    { id: 'm5', title: 'Cena', hint: 'Recuperación nocturna' }
];

// ==========================================================
// UTILIDADES
// ==========================================================
const $ = id => document.getElementById(id);

// Iconos de línea propios (24×24, trazo con el color del texto)
const ICONS = {
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8.5 3v4M15.5 3v4"/>',
    apple: '<path d="M12 7.5c-1.6-1.7-4.8-1.7-6.3.5-2 2.9-.6 8 1.6 10.5 1.4 1.6 2.9 2 4.7 1.1 1.8.9 3.3.5 4.7-1.1 2.2-2.5 3.6-7.6 1.6-10.5-1.5-2.2-4.7-2.2-6.3-.5z"/><path d="M12 7.5c0-2 1-3.6 3-4.5"/>',
    chart: '<path d="M5 20v-6M12 20V5M19 20v-10"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
    chevronRight: '<path d="M9 6l6 6-6 6"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    bowl: '<path d="M4 11h16a8 8 0 0 1-16 0zM9 7c0-1.5 1-1.5 1-3M14 7c0-1.5 1-1.5 1-3"/>',
    camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
    swim: '<circle cx="16.5" cy="6.5" r="2"/><path d="M6 12.5l4.5-3.5 3.5 2.5M3 16c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1M3 20c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1"/>',
    gym: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
    other: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
    drop: '<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z"/>',
    moon: '<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
    download: '<path d="M12 4v11M7 10.5l5 4.5 5-4.5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 13.5l5-4.5 5 4.5M5 4h14"/>'
};

function icon(name, extraClass = '') {
    return `<svg class="ico ${extraClass}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// Menú de acciones que sube desde abajo: [{ label, icon, danger, run }]
function openActionSheet(title, actions) {
    $('actionTitle').textContent = title;
    const list = $('actionList');
    list.innerHTML = '';
    actions.forEach(a => {
        const b = document.createElement('button');
        b.className = `list-row action-row${a.danger ? ' danger' : ''}`;
        b.innerHTML = `${a.icon ? icon(a.icon) : ''}<span>${escapeHtml(a.label)}</span>`;
        b.addEventListener('click', () => {
            closeModal('actionSheet');
            a.run();
        });
        list.appendChild(b);
    });
    openModal('actionSheet');
}

// localStorage seguro: si el navegador lo bloquea la app funciona en memoria; si se llena, avisa.
const store = (() => {
    const memory = {};
    let available = true;
    try { window.localStorage.getItem('__sf_test'); } catch (e) { available = false; }
    return {
        available,
        getItem(k) {
            if (!available) return memory[k] ?? null;
            try { return window.localStorage.getItem(k); } catch (e) { return memory[k] ?? null; }
        },
        setItem(k, v) {
            memory[k] = String(v);
            if (!available) return;
            try { window.localStorage.setItem(k, v); }
            catch (e) { showToast('No se pudo guardar (almacenamiento lleno). Descarga una copia de seguridad.', COLOR.error); }
        },
        removeItem(k) {
            delete memory[k];
            if (!available) return;
            try { window.localStorage.removeItem(k); } catch (e) {}
        }
    };
})();

function readJSON(key, fallback) {
    try { return JSON.parse(store.getItem(key) ?? 'null') ?? fallback; } catch (e) { return fallback; }
}

function downloadBlob(content, mime, filename) {
    const url = URL.createObjectURL(new Blob(Array.isArray(content) ? content : [content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let toastTimer = null;
// action (opcional): { label, run, sticky } añade un botón al aviso; sticky lo deja fijo hasta que se pulse
function showToast(msg, color = COLOR.ok, action = null) {
    const t = $('toastMsg');
    const hide = () => { t.style.display = 'none'; };
    t.textContent = msg;
    if (action) {
        const b = document.createElement('button');
        b.className = 'toast-action';
        b.textContent = action.label;
        b.addEventListener('click', () => { hide(); action.run(); });
        t.appendChild(b);
    }
    t.style.setProperty('--toast-dot', color);
    t.style.display = 'flex';
    clearTimeout(toastTimer);
    toastTimer = action && action.sticky ? null : setTimeout(hide, action ? 8000 : 3000);
}

// ==========================================================
// ESTADO
// ==========================================================
const cloneSlots = slots => slots.map(s => ({ ...s }));

let foodDB = [];
let historyLogs = [];                              // el diario: un registro por fecha
let templateSlots = cloneSlots(DEFAULT_MEAL_SLOTS); // comidas que tiene un día nuevo
let mealSlots = cloneSlots(templateSlots);         // comidas del día abierto
let mealsState = {};
let currentDate = todayLocalISO();                 // día abierto en "Hoy"
let sessions = [];                                 // entrenos del día abierto
let energy = null;                                 // desglose del gasto del día abierto
let saveTimer = null;
let targets = { kcal: 0, c: 0, p: 0, f: 0, weight: 80 };
let editingFoodId = null;   // alimento abierto en el modal para editar
let pendingMealAdd = null;  // { slotId, grams } si el modal se abrió desde una comida con un alimento nuevo
let kcalTouched = false;    // el usuario escribió las kcal a mano: no recalcular
let aiImageBase64 = null;
let appReady = false;
let dishes = [];                                     // platos guardados (recetas)
let sleepState = null;                               // sueño de la noche del día abierto (o null)

// ==========================================================
// CARGA Y GUARDADO
// ==========================================================
function loadAll() {
    const db = readJSON(STORAGE_KEY_DB, null);
    if (Array.isArray(db)) {
        foodDB = db.map(sanitizeFood).filter(Boolean);
    } else {
        foodDB = INITIAL_STARTER_DB.map(f => ({ ...f }));
        saveFoodDB();
    }

    dishes = sanitizeDishes(readJSON(STORAGE_KEY_DISHES, []));

    const hist = readJSON(STORAGE_KEY_HISTORY, []);
    historyLogs = cleanHistory(hist);
    sortHistory();

    const prof = readJSON(STORAGE_KEY_PROFILE, null);
    if (prof && typeof prof === 'object') {
        PROFILE_FIELDS.forEach(k => { if (prof[k] !== undefined && prof[k] !== '') $(k).value = prof[k]; });
    }

    const slots = sanitizeMealSlots(readJSON(STORAGE_KEY_MEAL_SLOTS, null));
    if (slots.length) templateSlots = slots;
    mealSlots = cloneSlots(templateSlots);

    loadGeminiApiKey();
    updateBadges();
}

function saveFoodDB() {
    store.setItem(STORAGE_KEY_DB, JSON.stringify(foodDB));
    updateBadges();
    refreshFoodDatalist();
}

function saveDishes() {
    store.setItem(STORAGE_KEY_DISHES, JSON.stringify(dishes));
}

function saveHistory() {
    store.setItem(STORAGE_KEY_HISTORY, JSON.stringify(historyLogs));
    updateBadges();
}

// Las comidas que añades, renombras o quitas pasan a ser la plantilla de los días nuevos
function saveSlots() {
    templateSlots = cloneSlots(mealSlots);
    store.setItem(STORAGE_KEY_MEAL_SLOTS, JSON.stringify(templateSlots));
}

function saveProfile() {
    const p = readJSON(STORAGE_KEY_PROFILE, {}) || {};
    PROFILE_FIELDS.forEach(k => { p[k] = $(k).value; });
    // Peso y entrenos "habituales" solo cambian al editar hoy o días futuros, no al revisar días pasados
    if (currentDate >= todayLocalISO()) {
        p.dayType = $('dayType').value;
        p.sessions = sessions.map(s => ({ ...s }));
        if (num($('weight').value) >= 30) p.weight = $('weight').value;
        delete p.swimMin;
        delete p.gymMin;
    }
    store.setItem(STORAGE_KEY_PROFILE, JSON.stringify(p));
}

// ---------- Peso del día: si no te pesas, se usa el último peso apuntado ----------
function lastWeighedBefore(date) {
    const rec = historyLogs.find(h => h.date < date && h.weighed !== false && num(h.weight) >= 30);
    return rec ? num(rec.weight) : 0;
}

function fallbackWeight() {
    const prof = readJSON(STORAGE_KEY_PROFILE, {}) || {};
    return lastWeighedBefore(currentDate) || num(prof.weight) || 80;
}

function isWeighed() {
    return num($('weight').value) >= 30;
}

function currentWeight() {
    return isWeighed() ? num($('weight').value) : fallbackWeight();
}

function getCalibration() {
    const c = num((readJSON(STORAGE_KEY_PROFILE, {}) || {}).calibration, 1);
    return c >= 0.7 && c <= 1.35 ? c : 1;
}

function sortHistory() {
    historyLogs.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function currentMeals() {
    return Object.fromEntries(mealSlots.map(s => [s.id, mealsState[s.id] || []]));
}

// ==========================================================
// DIARIO: cada día se guarda solo, sin botón de "guardar"
// ==========================================================
// Un día se guarda si tiene comidas, notas, peso o un entreno con series/metros
function dayHasContent() {
    return mealSlots.some(s => (mealsState[s.id] || []).length > 0)
        || $('logNotes').value.trim() !== ''
        || isWeighed()
        || Boolean(sleepState)
        || sessions.some(s => s.sets.trim() || num(s.meters) > 0);
}

function buildRecord(date) {
    const totals = getCurrentTotals();
    const mealsTextSummary = mealSlots
        .filter(s => (mealsState[s.id] || []).length)
        .map(s => `${s.title}: ${mealsState[s.id].map(i => `${i.name} (${i.grams}g)`).join(', ')}`)
        .join(' | ');
    const sumOf = (type, field) => sessions.filter(s => s.type === type).reduce((a, s) => a + num(s[field]), 0);
    return {
        date,
        weight: targets.weight,
        weighed: isWeighed(),
        dayType: $('dayType').value,
        sessions: sessions.map(s => ({ ...s })),
        swimMin: sumOf('swim', 'minutes'),
        swimMeters: sumOf('swim', 'meters'),
        gymMin: sumOf('gym', 'minutes'),
        otherMin: sumOf('other', 'minutes'),
        trainingKcal: Math.round(energy.training),
        maintRaw: Math.round(energy.base + energy.training), // estimación sin ajuste, para calibrar
        calibration: energy.calibration,
        goal: $('goal').value,
        kcalReal: totals.kcal, kcalTarget: targets.kcal,
        // kcal que vienen de estimaciones (≈): los días con muchas pesan menos al calcular tu gasto real
        estKcal: Math.round(mealSlots.reduce((a, s) => a + (mealsState[s.id] || []).filter(i => i.est).reduce((b, i) => b + itemMacros(i).k, 0), 0)),
        cReal: totals.c, cTarget: targets.c,
        pReal: totals.p, pTarget: targets.p,
        fReal: totals.f, fTarget: targets.f,
        notes: $('logNotes').value.trim(),
        sleep: sleepState ? { ...sleepState } : null,
        mealsTextSummary,
        mealsSnapshot: JSON.parse(JSON.stringify(currentMeals())),
        mealSlotsSnapshot: cloneSlots(mealSlots)
    };
}

// Escribe el día abierto en el diario (o lo quita si se ha quedado vacío)
function persistDay() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!appReady) return;
    const idx = historyLogs.findIndex(h => h.date === currentDate);
    if (dayHasContent()) {
        // Se conservan los campos que esta versión no conozca (por ejemplo, de una copia más nueva)
        const rec = { ...(idx >= 0 ? historyLogs[idx] : {}), ...buildRecord(currentDate) };
        if (idx >= 0) historyLogs[idx] = rec;
        else { historyLogs.push(rec); sortHistory(); }
    } else if (idx >= 0) {
        historyLogs.splice(idx, 1);
    } else {
        updateSaveIndicator();
        return;
    }
    saveHistory();
    updateSaveIndicator();
}

// Se espera un poco para no escribir en cada tecla; al salir de la app se guarda al momento
function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistDay, 400);
    $('saveIndicator').textContent = 'Guardando…';
}

function flushSave() {
    if (saveTimer) persistDay();
}

function onDayChanged() {
    updateSummaryUI();
    scheduleSave();
}

function updateSaveIndicator() {
    $('storageBanner').hidden = store.available;
    $('saveIndicator').innerHTML = historyLogs.some(h => h.date === currentDate)
        ? `${icon('check')}Guardado`
        : '';
}

function relativeDayName(date) {
    const today = todayLocalISO();
    if (date === today) return 'Hoy';
    if (date === addDays(today, -1)) return 'Ayer';
    if (date === addDays(today, 1)) return 'Mañana';
    return formatDateES(date);
}

// Título "Hoy / Ayer / Mañana" o el día de la semana; debajo, la fecha completa
function updateDateNav() {
    const [y, m, d] = currentDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const rel = relativeDayName(currentDate);
    const weekday = dt.toLocaleDateString('es-ES', { weekday: 'long' });
    const sameYear = y === new Date().getFullYear();
    const date = dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
    const isRelative = ['Hoy', 'Ayer', 'Mañana'].includes(rel);
    $('dateLabel').textContent = isRelative ? rel : weekday.charAt(0).toUpperCase() + weekday.slice(1);
    $('dateSub').textContent = isRelative ? `${weekday}, ${date}` : date;
    $('btnToday').hidden = currentDate === todayLocalISO();
}

// Abre un día del diario: si existe se carga tal cual; si no, empieza vacío con tus valores habituales
function openDate(date) {
    if (!DATE_RE.test(String(date))) return;
    flushSave();
    currentDate = date;
    $('logDate').value = date;

    const rec = historyLogs.find(h => h.date === date);
    const prof = readJSON(STORAGE_KEY_PROFILE, {}) || {};

    if (rec) {
        $('weight').value = rec.weighed !== false && num(rec.weight) >= 30 ? num(rec.weight) : '';
        $('dayType').value = normalizeDayType(rec.dayType);
        sessions = Array.isArray(rec.sessions)
            ? sanitizeSessions(rec.sessions)
            : legacySessions(rec.dayType, rec.swimMin, rec.gymMin);
        $('logNotes').value = rec.notes || '';
        sleepState = sanitizeSleep(rec.sleep);
        const slots = sanitizeMealSlots(rec.mealSlotsSnapshot);
        mealSlots = slots.length ? slots : cloneSlots(templateSlots);
        mealsState = sanitizeMeals(rec.mealsSnapshot);
    } else {
        // Entrenos y tipo de jornada habituales; el peso vacío hasta que te peses
        $('dayType').value = 'Normal';
        $('weight').value = '';
        sessions = templateSessions(prof);
        $('logNotes').value = '';
        sleepState = null;
        mealSlots = cloneSlots(templateSlots);
        mealsState = {};
    }
    $('weight').placeholder = `${fallbackWeight().toFixed(1)}`;

    renderMeals();
    renderSessions();
    updateSleepRow();
    recalculateTargets();
    updateDateNav();
    updateSaveIndicator();
}

// Las versiones anteriores guardaban el "día en curso" aparte: se pasa al diario una sola vez
function migrateOldDraft() {
    const draft = readJSON(STORAGE_KEY_DRAFT, null);
    if (!draft || typeof draft !== 'object') return;
    store.removeItem(STORAGE_KEY_DRAFT);
    if (!DATE_RE.test(String(draft.date)) || historyLogs.some(h => h.date === draft.date)) return;
    const meals = sanitizeMeals(draft.mealsState);
    const hasFood = Object.values(meals).some(list => list.length);
    if (!hasFood && !String(draft.notes || '').trim()) return;

    currentDate = draft.date;
    $('logDate').value = draft.date;
    $('dayType').value = normalizeDayType(draft.dayType);
    sessions = legacySessions(draft.dayType, draft.swimMin, draft.gymMin);
    $('weight').value = '';
    $('logNotes').value = draft.notes || '';
    mealSlots = cloneSlots(templateSlots);
    mealsState = meals;
    recalculateTargets();
    persistDay();
}

function updateBadges() {
    // El diseño minimalista no muestra contadores en las pestañas; se mantiene por compatibilidad
}

// ==========================================================
// NAVEGACIÓN Y MODALES
// ==========================================================
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab_${tab}`));
    if (tab !== 'today') $('stickySummary').classList.remove('show');
    window.scrollTo(0, 0);
    if (tab === 'foods') { renderFoodTable(); renderDishList(); }
    if (tab === 'history') renderHistory();
    if (tab === 'sleep') renderSleepTab();
}

function openModal(id) {
    $(id).classList.add('active');
    document.body.classList.add('modal-open');
}

function closeModal(id) {
    $(id).classList.remove('active');
    if (id === 'modalFood') {
        pendingMealAdd = null;
        editingFoodId = null;
    }
    if (!document.querySelector('.modal-overlay.active')) document.body.classList.remove('modal-open');
}
