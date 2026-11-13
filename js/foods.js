// SwimFuel · alimentos y lectura de etiquetas con IA
'use strict';

// ==========================================================
// ALIMENTOS (modal único: crear, editar y leer foto con IA)
// ==========================================================
function validateFoodMacros(c, p, f) {
    if (c < 0 || p < 0 || f < 0) return 'Los valores no pueden ser negativos';
    if (c + p + f > 100.5) return `Carbs + Prot + Grasas suman ${(c + p + f).toFixed(1)} g en 100 g. Revisa los valores.`;
    return null;
}

function openFoodModal(prefill = null, editId = null) {
    const v = prefill || {};
    editingFoodId = editId;
    kcalTouched = Boolean(editId || v.kcal);
    $('foodModalTitle').innerText = editId ? 'Editar alimento' : 'Nuevo alimento';
    $('btnSaveFood').innerText = pendingMealAdd ? 'Guardar y añadir' : 'Guardar';
    $('btnDeleteFood').hidden = !editId;
    $('mFoodName').value = v.name || '';
    $('mFoodC').value = v.c ?? 0;
    $('mFoodP').value = v.p ?? 0;
    $('mFoodF').value = v.f ?? 0;
    $('mFoodKcal').value = v.kcal ?? 0;
    $('mFoodDefaultG').value = v.defaultG ?? 100;
    $('aiBox').open = false;
    clearAiImage();
    loadGeminiApiKey();
    openModal('modalFood');
    setTimeout(() => (v.name ? $('mFoodC') : $('mFoodName')).focus(), 50);
}

function autoCalcFoodKcal() {
    if (kcalTouched) return;
    $('mFoodKcal').value = calcKcal(num($('mFoodC').value), num($('mFoodP').value), num($('mFoodF').value));
}

function saveFoodFromModal() {
    const name = $('mFoodName').value.trim();
    const c = Math.max(0, num($('mFoodC').value));
    const p = Math.max(0, num($('mFoodP').value));
    const f = Math.max(0, num($('mFoodF').value));
    const kcal = Math.max(0, num($('mFoodKcal').value)) || calcKcal(c, p, f);
    const defaultG = Math.max(1, num($('mFoodDefaultG').value, 100));

    if (!name) {
        showToast('Escribe el nombre del alimento', COLOR.error);
        $('mFoodName').focus();
        return;
    }
    const err = validateFoodMacros(c, p, f);
    if (err) { showToast(err, COLOR.error); return; }

    const sameName = foodDB.find(x => x.name.toLowerCase() === name.toLowerCase());
    let food;
    if (editingFoodId) {
        if (sameName && sameName.id !== editingFoodId) {
            showToast('Ya tienes otro alimento con ese nombre', COLOR.error);
            return;
        }
        food = foodDB.find(x => x.id === editingFoodId);
        Object.assign(food, { name, kcal, c, p, f, defaultG });
        showToast(`"${name}" actualizado`);
    } else if (sameName) {
        food = Object.assign(sameName, { name, kcal, c, p, f, defaultG });
        showToast(`"${name}" ya existía: se han actualizado sus valores`);
    } else {
        food = { id: newId('cust_'), name, kcal, c, p, f, defaultG };
        foodDB.push(food);
        showToast(`"${name}" añadido a tus alimentos`);
    }

    saveFoodDB();
    renderFoodTable();

    const pending = pendingMealAdd;
    closeModal('modalFood');
    if (pending && mealsState[pending.slotId]) {
        addItemToMeal(pending.slotId, food, pending.grams);
        const meal = $(`meal_${pending.slotId}`);
        if (meal) {
            meal.querySelector('.meal-search').value = '';
            meal.querySelector('.meal-grams').value = 100;
        }
    }
}

function renderFoodTable() {
    const box = $('foodList');
    const q = $('dbSearch').value.trim().toLowerCase();
    const list = foodDB
        .filter(f => f.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    if (!list.length) {
        box.innerHTML = `<div class="empty-note">${q
            ? `Nada coincide con "${escapeHtml(q)}".`
            : 'Aún no tienes alimentos. Pulsa + para crear el primero.'}</div>`;
        return;
    }

    box.innerHTML = '';
    list.forEach(f => {
        const b = document.createElement('button');
        b.className = 'list-row';
        b.type = 'button';
        b.innerHTML = `
            <span class="fi-main">
                <span class="fi-name">${escapeHtml(f.name)}</span>
                <span class="fi-macros">C ${escapeHtml(f.c)} · P ${escapeHtml(f.p)} · G ${escapeHtml(f.f)} · ración ${escapeHtml(f.defaultG)} g</span>
            </span>
            <span class="s-kcal">${escapeHtml(f.kcal)} <small>kcal</small></span>`;
        b.addEventListener('click', () => openFoodModal(f, f.id));
        box.appendChild(b);
    });
}

function deleteFood(id) {
    const food = foodDB.find(f => f.id === id);
    if (!food || !confirm(`¿Borrar "${food.name}"?\n(Los días ya guardados no cambian)`)) return;
    foodDB = foodDB.filter(f => f.id !== id);
    saveFoodDB();
    renderFoodTable();
    closeModal('modalFood');
    showToast('Alimento borrado', COLOR.warn);
}

function loadDefaultStarterDB() {
    let added = 0;
    INITIAL_STARTER_DB.forEach(item => {
        if (!findFoodByName(item.name) && !foodDB.some(f => f.id === item.id)) {
            foodDB.push({ ...item });
            added++;
        }
    });
    saveFoodDB();
    renderFoodTable();
    showToast(added ? `${added} alimentos básicos añadidos` : 'Ya tenías todos los básicos', added ? COLOR.ok : COLOR.info);
}

function wipeFoodDatabase() {
    if (!confirm('¿Borrar TODOS tus alimentos?\n\nConsejo: descarga antes una copia de seguridad.')) return;
    foodDB = [];
    saveFoodDB();
    renderFoodTable();
    showToast('Alimentos borrados', COLOR.error);
}

// ---------- Foto + IA (Google Gemini) ----------
function clearAiImage() {
    aiImageBase64 = null;
    $('aiImageFile').value = '';
    $('dropZoneEmpty').style.display = 'block';
    $('dropZonePreview').style.display = 'none';
    $('aiPreviewImg').removeAttribute('src');
}

function processImageFile(file) {
    if (!file || !file.type.startsWith('image/')) {
        showToast('Elige un archivo de imagen', COLOR.error);
        return;
    }
    const reader = new FileReader();
    reader.onload = e => {
        const img = new Image();
        img.onload = () => {
            // Se reduce a 1400 px como máximo para que la subida sea rápida
            const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
            aiImageBase64 = dataUrl.split(',')[1];
            $('aiPreviewImg').src = dataUrl;
            $('dropZoneEmpty').style.display = 'none';
            $('dropZonePreview').style.display = 'block';
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function loadGeminiApiKey() {
    const key = store.getItem(STORAGE_KEY_GEMINI_KEY) || '';
    $('geminiApiKeyInput').value = key;
    $('apiKeyStatusBadge').innerText = key ? 'Guardada' : 'Sin configurar';
    $('apiKeyStatusBadge').className = `status-pill ${key ? 'status-ok' : 'status-warn'}`;
}

function saveGeminiApiKey() {
    const key = $('geminiApiKeyInput').value.trim();
    if (key) store.setItem(STORAGE_KEY_GEMINI_KEY, key);
    else store.removeItem(STORAGE_KEY_GEMINI_KEY);
    loadGeminiApiKey();
}

function toggleApiKeyVisibility() {
    const input = $('geminiApiKeyInput');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('btnToggleKeyVis').innerText = show ? 'Ocultar' : 'Ver';
}

async function analyzeFoodPhoto() {
    if (!aiImageBase64) {
        showToast('Primero haz o sube una foto de la tabla nutricional', COLOR.error);
        return;
    }
    const apiKey = $('geminiApiKeyInput').value.trim();
    if (!apiKey) {
        showToast('Pega tu clave de Gemini para usar la IA', COLOR.error);
        $('geminiApiKeyInput').focus();
        return;
    }
    saveGeminiApiKey();

    const name = $('mFoodName').value.trim();
    const btn = $('btnAnalyzeAi');
    btn.disabled = true;
    $('aiLoading').style.display = 'block';

    const prompt = `Analiza la imagen de la tabla de información nutricional${name ? ` del alimento "${name}"` : ''}.
Extrae los valores por cada 100 g (o 100 ml):
- c: hidratos de carbono (g)
- p: proteínas (g)
- f: grasas totales (g)
- kcal: energía en kilocalorías
- defaultG: tamaño de la ración indicada en el envase en gramos (100 si no aparece)
Responde solo con JSON: {"c": 0, "p": 0, "f": 0, "kcal": 0, "defaultG": 100}`;

    try {
        // 'gemini-flash-latest' apunta siempre al Flash vigente; los otros son alternativas
        const models = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
        let raw = null;
        let lastError = null;

        for (const model of models) {
            $('aiLoadingText').innerText = `Leyendo la etiqueta con ${model}…`;
            try {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: aiImageBase64 } }] }],
                        generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' }
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    const parts = data?.candidates?.[0]?.content?.parts || [];
                    raw = parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
                    if (raw) break;
                    lastError = 'La IA devolvió una respuesta vacía';
                } else {
                    const err = await res.json().catch(() => ({}));
                    lastError = err?.error?.message || `HTTP ${res.status}`;
                    if (res.status === 401 || res.status === 403 || /api key/i.test(lastError)) break; // clave mala: no insistir
                }
            } catch (e) {
                lastError = e.message;
            }
        }

        if (!raw) throw new Error(lastError || 'Sin respuesta de la IA');
        const match = raw.replace(/```json|```/gi, '').match(/\{[\s\S]*?\}/);
        if (!match) throw new Error('No se encontró una tabla nutricional clara. Prueba con una foto más cercana y con buena luz.');

        const data = JSON.parse(match[0]);
        const toNum = v => Math.max(0, parseFloat(String(v ?? '').replace(',', '.')) || 0);
        const c = toNum(data.c), p = toNum(data.p), f = toNum(data.f);
        $('mFoodC').value = c;
        $('mFoodP').value = p;
        $('mFoodF').value = f;
        $('mFoodKcal').value = toNum(data.kcal) || calcKcal(c, p, f);
        $('mFoodDefaultG').value = Math.max(1, toNum(data.defaultG) || 100);
        kcalTouched = true;
        $('aiBox').open = false;
        showToast('Valores leídos: revísalos y pulsa Guardar', COLOR.info);
        $('mFoodC').focus();
    } catch (err) {
        showToast('Error de la IA: ' + err.message, COLOR.error);
    } finally {
        btn.disabled = false;
        $('aiLoading').style.display = 'none';
    }
}
