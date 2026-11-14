// SwimFuel · añadir comida: buscador con recientes, cantidades (gramos, cocinado, unidades), estimación
// con IA, kcal a mano y platos guardados.
'use strict';

let addSlotId = null;   // comida a la que se está añadiendo
let addView = 'Search';
let addPick = null;     // alimento elegido: { kind, name, per100, units, est }
let addUsage = {};
let estItems = [];      // ingredientes que ha estimado la IA
let estNote = '';
let estImage = null;
let dishDraft = null;   // plato abierto en el editor

const fmtQty = n => String(round1(n)).replace('.', ',');
const per100Text = p => `C ${fmtQty(p.c)} · P ${fmtQty(p.p)} · G ${fmtQty(p.f)}`;

// ---------- Todo lo que se puede buscar: tus platos, tus alimentos y los genéricos ----------
function foodEntry(f) {
    const units = [{ label: 'g', grams: 1 }];
    const cook = f.cook || guessCookFactor(f.name, f.kcal);
    // Pesado ya cocinado: se convierte a su peso en crudo, que es como está guardado el alimento
    if (cook) units.push({ label: 'g ya cocinado', grams: 1 / cook, cooked: true, cook });
    if (f.unitG) units.push({ label: `${f.unitName || 'unidad'} (${fmtQty(f.unitG)} g)`, grams: f.unitG });
    return { kind: 'food', name: f.name, per100: { kcal: f.kcal, c: f.c, p: f.p, f: f.f }, units, defaultG: f.defaultG };
}

function addEntries(withDishes = true) {
    const out = [];
    if (withDishes) {
        dishes.forEach(d => {
            const t = dishTotals(d);
            if (!(t.grams > 0)) return;
            out.push({
                kind: 'dish', name: d.name, per100: t.per100, dish: d, dishGrams: t.grams,
                units: [{ label: `ración (${Math.round(t.portionG)} g)`, grams: t.portionG }, { label: 'g servidos', grams: 1 }]
            });
        });
    }
    foodDB.forEach(f => out.push(foodEntry(f)));
    GENERIC_FOODS.forEach(g => out.push({
        kind: 'generic', name: g.name, est: true, per100: { kcal: g.kcal, c: g.c, p: g.p, f: g.f },
        units: [...g.units.map(([label, grams]) => ({ label: `${label} (${grams} g)`, grams })), { label: 'g', grams: 1 }]
    }));
    return out;
}

// Algo que comiste hace poco y ya no está en tus alimentos: se recupera con los valores de aquel día
function recentEntry(item) {
    return {
        kind: 'recent', name: item.name, est: Boolean(item.est), defaultG: num(item.grams) || 100,
        per100: { kcal: num(item.kcal100), c: num(item.c100), p: num(item.p100), f: num(item.f100) },
        units: [{ label: 'g', grams: 1 }]
    };
}

// ---------- Hoja de añadir ----------
function showAddView(view) {
    addView = view;
    ['Search', 'Qty', 'Estimate', 'Quick'].forEach(v => { $(`addView${v}`).hidden = v !== view; });
    $('addBack').hidden = view === 'Search';
    $('addFooter').hidden = view === 'Search';
    $('addConfirm').textContent = view === 'Estimate' ? 'Añadir todo a la comida' : 'Añadir';
    $('addConfirm').disabled = view === 'Estimate' && !estItems.length;
}

function openAddSheet(slotId, food = null) {
    const slot = mealSlots.find(s => s.id === slotId);
    if (!slot) return;
    addSlotId = slotId;
    $('addTitle').textContent = slot.title;
    flushSave();
    addUsage = usageFromHistory(historyLogs);
    $('addSearch').value = '';
    renderAddResults();
    showAddView('Search');
    openModal('modalAdd');
    if (food) pickEntry(foodEntry(food));
}

function renderAddResults() {
    const q = $('addSearch').value.trim();
    const box = $('addResults');
    let list;
    if (!q) {
        const byName = Object.fromEntries(addEntries().map(e => [normText(e.name), e]));
        list = Object.entries(addUsage)
            .sort((a, b) => b[1].date.localeCompare(a[1].date) || b[1].count - a[1].count)
            .slice(0, 15)
            .map(([key, u]) => ({ ...(byName[key] || recentEntry(u.item)), lastGrams: num(u.item.grams) }));
        $('addListTitle').textContent = list.length ? 'Recientes' : 'Busca un alimento, o estima el plato si no puedes pesarlo';
    } else {
        list = searchFoods(q, addEntries(), addUsage);
        $('addListTitle').textContent = list.length ? 'Resultados' : 'No está en tus alimentos';
    }

    box.innerHTML = '';
    list.forEach(e => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'list-row';
        const tag = e.kind === 'dish' ? 'plato · ' : e.kind === 'generic' ? '≈ genérico · ' : '';
        b.innerHTML = `
            <span class="fi-main">
                <span class="fi-name">${escapeHtml(e.name)}</span>
                <span class="fi-macros">${tag}${per100Text(e.per100)}${e.lastGrams ? ` · última vez ${fmtQty(e.lastGrams)} g` : ''}</span>
            </span>
            <span class="s-kcal">${Math.round(e.per100.kcal)} <small>kcal</small></span>`;
        b.addEventListener('click', () => pickEntry(e));
        box.appendChild(b);
    });
    if (q && !findFoodByName(q)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'list-row action-row';
        b.style.color = 'var(--accent)';
        b.innerHTML = `${icon('plus')}<span>Crear «${escapeHtml(q)}» con su etiqueta</span>`;
        b.addEventListener('click', () => {
            const slotId = addSlotId;
            closeModal('modalAdd');
            pendingMealAdd = { slotId, grams: 100 };
            openFoodModal({ name: q });
        });
        box.appendChild(b);
    }
    box.hidden = !box.children.length;
}

// ---------- Cantidad ----------
function pickEntry(e) {
    addPick = e;
    $('qtyName').textContent = (e.est ? '≈ ' : '') + e.name;
    $('qtyPer100').textContent = `Por 100 g: ${Math.round(e.per100.kcal)} kcal · ${per100Text(e.per100)}`;
    $('qtyUnit').innerHTML = e.units.map((u, k) => `<option value="${k}">${escapeHtml(u.label)}</option>`).join('');
    const gIdx = e.units.findIndex(u => u.grams === 1);
    const measured = e.kind === 'dish' || e.kind === 'generic';
    // Lo más rápido: la misma cantidad que la última vez. Si no, tu ración habitual o una medida casera
    let unitIdx = measured ? 0 : gIdx;
    let amount = measured ? 1 : (e.defaultG || 100);
    if (e.lastGrams && gIdx >= 0) {
        unitIdx = gIdx;
        amount = e.lastGrams;
    }
    $('qtyUnit').value = String(unitIdx);
    $('qtyUnit').dataset.prev = String(unitIdx);
    $('qtyAmount').value = amount;
    $('qtySplitRow').hidden = !(e.dish && e.dish.ingredients.length > 1);
    $('qtySplit').checked = false;
    paintQty();
    showAddView('Qty');
    setTimeout(() => $('qtyAmount').select(), 60);
}

function qtyState() {
    const unit = addPick.units[Number($('qtyUnit').value)] || addPick.units[0];
    const amount = Math.max(0, num($('qtyAmount').value));
    return { unit, amount, grams: round1(amount * unit.grams) };
}

function onQtyUnitChange() {
    const sel = $('qtyUnit');
    const prev = addPick.units[Number(sel.dataset.prev)] || addPick.units[0];
    const next = addPick.units[Number(sel.value)];
    const isMeasure = u => u.grams > 2;   // una unidad o medida casera (no gramos)
    if (isMeasure(next)) $('qtyAmount').value = 1;
    else if (isMeasure(prev)) $('qtyAmount').value = Math.round(prev.grams * Math.max(1, num($('qtyAmount').value)));
    sel.dataset.prev = sel.value;
    paintQty();
}

function paintQty() {
    if (!addPick) return;
    const { unit, amount, grams } = qtyState();
    const r = grams / 100, p = addPick.per100;
    $('qtyPreview').innerHTML = `<strong>${fmtInt(p.kcal * r)} kcal</strong> · C ${Math.round(p.c * r)} · P ${Math.round(p.p * r)} · G ${Math.round(p.f * r)}`;
    let note = '';
    if (unit.cooked) note = `${fmtQty(amount)} g ya cocinado son unos ${fmtQty(grams)} g en crudo (al cocinarse pesa ×${fmtQty(unit.cook)}). Si tu forma de cocinarlo es distinta, cambia el factor en el alimento.`;
    else if (unit.grams !== 1) note = `${fmtQty(amount)} × ${unit.label} = ${fmtQty(grams)} g`;
    else if (addPick.units.some(u => u.cooked)) note = 'En gramos se entiende pesado en crudo. Si lo pesas ya cocinado, elige "g ya cocinado".';
    if (addPick.kind === 'generic') note += (note ? ' ' : '') + 'Valores medios de un plato ya cocinado: es una estimación.';
    $('qtyNote').textContent = note;
}

function confirmAdd() {
    if (addView === 'Qty') {
        const { unit, amount, grams } = qtyState();
        if (!(grams > 0)) {
            showToast('La cantidad debe ser mayor que 0', COLOR.error);
            return;
        }
        const note = unit.cooked ? `${fmtQty(amount)} g cocinado`
            : unit.grams !== 1 ? `${fmtQty(amount)} ${unit.label.replace(/\s*\(.*\)$/, '')}` : '';
        if (addPick.dish && $('qtySplit').checked) {
            // Plato desglosado: cada ingrediente entra en su proporción y se puede retocar o quitar
            const k = grams / addPick.dishGrams;
            addPick.dish.ingredients.filter(i => i.grams > 0).forEach(i => addItemToMeal(addSlotId,
                { name: i.name, kcal: i.kcal100, c: i.c100, p: i.p100, f: i.f100 }, round1(i.grams * k), { est: i.est, note: addPick.name }));
        } else {
            addItemToMeal(addSlotId, { name: addPick.name, ...addPick.per100 }, grams, { est: Boolean(addPick.est), note });
        }
        const key = normText(addPick.name);
        const item = (mealsState[addSlotId] || []).slice(-1)[0];
        addUsage[key] = { count: ((addUsage[key] || {}).count || 0) + 1, date: currentDate, item };
        showToast(`${addPick.name} añadido`);
        // Se queda abierto para seguir añadiendo a la misma comida
        $('addSearch').value = '';
        renderAddResults();
        showAddView('Search');
    } else if (addView === 'Estimate') {
        if (!estItems.length) return;
        estItems.filter(i => i.grams > 0).forEach(i => addItemToMeal(addSlotId,
            { name: i.name, kcal: i.kcal100, c: i.c100, p: i.p100, f: i.f100 }, Math.round(i.grams), { est: true, note: 'estimado' }));
        showToast('Plato estimado añadido');
        closeModal('modalAdd');
    } else if (addView === 'Quick') {
        const c = Math.max(0, num($('quickC').value)), p = Math.max(0, num($('quickP').value)), f = Math.max(0, num($('quickF').value));
        const kcal = Math.max(0, num($('quickKcal').value)) || calcKcal(c, p, f);
        if (!(kcal > 0)) {
            showToast('Escribe las kcal o los macros', COLOR.error);
            return;
        }
        addItemToMeal(addSlotId, { name: $('quickName').value.trim() || 'Estimación a mano', kcal, c, p, f }, 100, { est: true, note: 'a mano' });
        showToast('Añadido');
        closeModal('modalAdd');
    }
}

// ---------- Estimar un plato con IA (foto, descripción o las dos) ----------
function openEstimateView() {
    estItems = [];
    estNote = '';
    estImage = null;
    $('estText').value = '';
    $('estPhoto').value = '';
    $('estPhotoName').textContent = '';
    $('estResults').innerHTML = '';
    $('estKeyBox').hidden = Boolean(store.getItem(STORAGE_KEY_GEMINI_KEY));
    showAddView('Estimate');
}

async function runEstimate() {
    const text = $('estText').value.trim();
    if (!text && !estImage) {
        showToast('Describe el plato o hazle una foto', COLOR.error);
        return;
    }
    if (!store.getItem(STORAGE_KEY_GEMINI_KEY)) {
        const key = $('estKey').value.trim();
        if (!key) {
            $('estKeyBox').hidden = false;
            showToast('Pega tu clave gratuita de Gemini para estimar con IA', COLOR.error);
            return;
        }
        store.setItem(STORAGE_KEY_GEMINI_KEY, key);
        $('estKeyBox').hidden = true;
    }
    if (navigator.onLine === false) {
        showToast('Sin conexión: busca el plato en la lista (los genéricos tienen medidas caseras)', COLOR.warn);
        return;
    }

    const prompt = `Eres dietista deportivo. Estima lo que hay en un plato para un diario de nutrición.
Descripción del usuario: "${text || 'solo hay foto'}"${estImage ? ' (se adjunta una foto del plato).' : '.'}
Responde SOLO con JSON con esta forma:
{"items":[{"name":"","grams":0,"kcal100":0,"c100":0,"p100":0,"f100":0}],"confidence":"alta|media|baja","note":""}
- Separa el plato en sus ingredientes principales (máximo 6). "grams" es el peso de cada uno TAL COMO ESTÁ EN EL PLATO, ya cocinado.
- kcal100, c100 (hidratos), p100 (proteína) y f100 (grasa) son por 100 g de ese ingrediente ya cocinado.
- Cuenta el aceite o la salsa de cocinar como ingrediente aparte si es relevante.
- Si no se indica la cantidad, supón la ración normal de un deportista adulto.
- "name" corto y en español. "note": una frase con lo que has supuesto.`;

    $('estRun').disabled = true;
    $('estLoading').hidden = false;
    try {
        const data = await geminiJSON(prompt, estImage, t => { $('estLoadingText').textContent = t; });
        estItems = (Array.isArray(data.items) ? data.items : []).map(sanitizeItem).filter(i => i && i.grams > 0 && i.kcal100 > 0).slice(0, 8);
        if (!estItems.length) throw new Error('la IA no ha reconocido el plato');
        estNote = [data.confidence ? `Confianza ${String(data.confidence).slice(0, 10)}` : '', String(data.note || '').slice(0, 200)].filter(Boolean).join('. ');
        renderEstimate();
    } catch (err) {
        showToast('No se pudo estimar: ' + err.message, COLOR.error);
    } finally {
        $('estRun').disabled = false;
        $('estLoading').hidden = true;
        $('addConfirm').disabled = !estItems.length;
    }
}

function estimateTotal() {
    return estItems.reduce((a, i) => a + i.kcal100 * i.grams / 100, 0);
}

function renderEstimate() {
    const box = $('estResults');
    box.innerHTML = `
        <div class="section-title">Lo que ha estimado (corrige los gramos si lo ves distinto)</div>
        <div class="list">${estItems.map((i, k) => `
            <div class="list-row">
                <span class="fi-main"><span class="fi-name">${escapeHtml(i.name)}</span><span class="fi-macros">${Math.round(i.kcal100)} kcal por 100 g</span></span>
                <span class="fi-grams"><input type="number" class="gram-input" data-est="${k}" value="${Math.round(i.grams)}" min="0" step="5" inputmode="decimal" aria-label="Gramos de ${escapeHtml(i.name)}">g</span>
            </div>`).join('')}
        </div>
        <div class="chips" style="margin:10px 0 0;">
            <button type="button" class="chip" data-scale="0.75">Ración más pequeña</button>
            <button type="button" class="chip" data-scale="1.25">Ración más grande</button>
        </div>
        <p class="footnote"><strong id="estTotal"></strong>. ${escapeHtml(estNote)} Una estimación así puede fallar un 20–30 %: úsala cuando no puedas pesar.</p>`;
    const paintTotal = () => { $('estTotal').textContent = `≈ ${fmtInt(estimateTotal())} kcal`; };
    paintTotal();
    box.querySelectorAll('[data-est]').forEach(inp => inp.addEventListener('input', () => {
        estItems[Number(inp.dataset.est)].grams = Math.max(0, num(inp.value));
        paintTotal();
    }));
    box.querySelectorAll('[data-scale]').forEach(b => b.addEventListener('click', () => {
        estItems.forEach(i => { i.grams = Math.round(i.grams * Number(b.dataset.scale)); });
        renderEstimate();
    }));
}

// ---------- Platos ----------
function renderDishList() {
    const box = $('dishList');
    if (!dishes.length) {
        box.innerHTML = '<div class="empty-note">Guarda aquí lo que se cocina a menudo en casa (por ejemplo, carne picada con tomate) y apúntalo luego por ración. También puedes guardar una comida como plato desde su menú ⋯.</div>';
        return;
    }
    box.innerHTML = '';
    [...dishes].sort((a, b) => a.name.localeCompare(b.name, 'es')).forEach(d => {
        const t = dishTotals(d);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'list-row';
        b.innerHTML = `
            <span class="fi-main">
                <span class="fi-name">${escapeHtml(d.name)}</span>
                <span class="fi-macros">${d.ingredients.length} ingrediente${d.ingredients.length === 1 ? '' : 's'} · ración de ${Math.round(t.portionG)} g · ${fmtInt(t.kcal / d.portions)} kcal</span>
            </span>
            <span class="s-kcal">${Math.round(t.per100.kcal)} <small>kcal</small></span>`;
        b.addEventListener('click', () => openDishModal(d.id));
        box.appendChild(b);
    });
}

function openDishModal(id = null) {
    const d = dishes.find(x => x.id === id);
    dishDraft = d ? JSON.parse(JSON.stringify(d)) : { id: null, name: '', ingredients: [], cookedG: 0, portions: 1 };
    $('dishModalTitle').textContent = d ? 'Editar plato' : 'Nuevo plato';
    $('dishName').value = dishDraft.name;
    $('dishCookedG').value = dishDraft.cookedG || '';
    $('dishPortions').value = dishDraft.portions;
    $('dishSearch').value = '';
    $('dishSearchResults').innerHTML = '';
    $('dishSearchResults').hidden = true;
    $('btnDeleteDish').hidden = !d;
    renderDishIngredients();
    openModal('modalDish');
}

function paintDishSummary() {
    dishDraft.cookedG = Math.max(0, num($('dishCookedG').value));
    dishDraft.portions = clamp(num($('dishPortions').value, 1) || 1, 0.25, 50);
    const t = dishTotals(dishDraft);
    $('dishSummary').innerHTML = t.grams > 0
        ? `Todo el plato: <strong>${fmtInt(t.kcal)} kcal</strong> en ${fmtInt(t.grams)} g. Cada ración (${Math.round(t.portionG)} g): <strong>${fmtInt(t.kcal / dishDraft.portions)} kcal</strong> · C ${Math.round(t.c / dishDraft.portions)} · P ${Math.round(t.p / dishDraft.portions)} · G ${Math.round(t.f / dishDraft.portions)}.` +
            (dishDraft.cookedG ? '' : ' Si pesas la olla al acabar, pon el peso cocinado: los guisos pierden agua y el arroz y la pasta la ganan.')
        : 'Añade los ingredientes en crudo, tal como van a la olla.';
}

function renderDishIngredients() {
    const box = $('dishIngredients');
    box.hidden = !dishDraft.ingredients.length;
    box.innerHTML = '';
    dishDraft.ingredients.forEach((i, k) => {
        const row = document.createElement('div');
        row.className = 'food-item';
        row.style.borderTop = k ? '' : '0';
        row.innerHTML = `
            <div class="fi-main"><span class="fi-name">${escapeHtml(i.name)}</span><span class="fi-macros">${Math.round(i.kcal100)} kcal por 100 g</span></div>
            <span class="fi-grams"><input type="number" class="gram-input" value="${escapeHtml(i.grams)}" min="0" step="5" inputmode="decimal" aria-label="Gramos de ${escapeHtml(i.name)}">g</span>
            <button class="icon-btn" aria-label="Quitar ${escapeHtml(i.name)}">${icon('close')}</button>`;
        row.querySelector('input').addEventListener('input', e => {
            i.grams = Math.max(0, num(e.target.value));
            paintDishSummary();
        });
        row.querySelector('button').addEventListener('click', () => {
            dishDraft.ingredients.splice(k, 1);
            renderDishIngredients();
        });
        box.appendChild(row);
    });
    paintDishSummary();
}

function renderDishSearch() {
    const q = $('dishSearch').value.trim();
    const box = $('dishSearchResults');
    const list = q ? searchFoods(q, addEntries(false), addUsage, 6) : [];
    box.hidden = !list.length;
    box.innerHTML = '';
    list.forEach(e => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'list-row';
        b.innerHTML = `<span class="fi-main"><span class="fi-name">${escapeHtml(e.name)}</span><span class="fi-macros">${e.kind === 'generic' ? '≈ genérico · ' : ''}${per100Text(e.per100)}</span></span><span class="s-kcal">${Math.round(e.per100.kcal)} <small>kcal</small></span>`;
        b.addEventListener('click', () => {
            const firstMeasure = e.units.find(u => u.grams > 2);
            dishDraft.ingredients.push(sanitizeItem({
                name: e.name, grams: e.defaultG || (firstMeasure ? firstMeasure.grams : 100),
                kcal100: e.per100.kcal, c100: e.per100.c, p100: e.per100.p, f100: e.per100.f
            }));
            $('dishSearch').value = '';
            renderDishSearch();
            renderDishIngredients();
        });
        box.appendChild(b);
    });
}

function saveDishFromModal() {
    const name = $('dishName').value.trim();
    if (!name) {
        showToast('Ponle nombre al plato', COLOR.error);
        $('dishName').focus();
        return;
    }
    if (!dishDraft.ingredients.some(i => i.grams > 0)) {
        showToast('Añade al menos un ingrediente', COLOR.error);
        return;
    }
    paintDishSummary();
    const clean = sanitizeDish({ ...dishDraft, name, id: dishDraft.id || newId('d_') });
    const idx = dishes.findIndex(d => d.id === clean.id);
    if (idx >= 0) dishes[idx] = clean;
    else dishes.push(clean);
    saveDishes();
    renderDishList();
    closeModal('modalDish');
    showToast(`Plato "${name}" guardado: búscalo por su nombre al añadir comida`);
}

function deleteDish() {
    if (!dishDraft || !dishDraft.id || !confirm(`¿Borrar el plato "${dishDraft.name}"?\n(Los días ya guardados no cambian)`)) return;
    dishes = dishes.filter(d => d.id !== dishDraft.id);
    saveDishes();
    renderDishList();
    closeModal('modalDish');
    showToast('Plato borrado', COLOR.warn);
}

// Desde el menú ⋯ de una comida: lo que hay apuntado pasa a ser un plato reutilizable
function saveMealAsDish(slotId) {
    const slot = mealSlots.find(s => s.id === slotId);
    const items = mealsState[slotId] || [];
    if (!slot || !items.length) {
        showToast('Esta comida está vacía', COLOR.error);
        return;
    }
    const name = prompt('Nombre del plato:', slot.title);
    if (!name || !name.trim()) return;
    dishes.push(sanitizeDish({ name: name.trim(), ingredients: items, cookedG: 0, portions: 1 }));
    saveDishes();
    showToast(`Plato "${name.trim()}" guardado: búscalo por su nombre al añadir comida`);
}

function initAddFoodUI() {
    $('addSearch').addEventListener('input', renderAddResults);
    $('addBack').addEventListener('click', () => showAddView('Search'));
    $('addConfirm').addEventListener('click', confirmAdd);
    $('btnAddEstimate').addEventListener('click', openEstimateView);
    $('btnAddQuick').addEventListener('click', () => {
        ['quickName', 'quickKcal', 'quickC', 'quickP', 'quickF'].forEach(id => { $(id).value = ''; });
        showAddView('Quick');
    });
    $('qtyAmount').addEventListener('input', paintQty);
    $('qtyUnit').addEventListener('change', onQtyUnitChange);
    $('qtyAmount').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAdd(); });
    $('estRun').addEventListener('click', runEstimate);
    $('estPhoto').addEventListener('change', async e => {
        const file = e.target.files[0];
        estImage = file ? await imageFileToBase64(file, 1200).catch(() => null) : null;
        $('estPhotoName').textContent = estImage ? 'Foto lista' : '';
    });
    $('dishSearch').addEventListener('input', renderDishSearch);
    ['dishCookedG', 'dishPortions'].forEach(id => $(id).addEventListener('input', paintDishSummary));
    $('btnSaveDish').addEventListener('click', saveDishFromModal);
    $('btnDeleteDish').addEventListener('click', deleteDish);
}
