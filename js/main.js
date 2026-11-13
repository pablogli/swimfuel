// SwimFuel · arranque
'use strict';

// ==========================================================
// ARRANQUE
// ==========================================================
function init() {
    // Pinta los iconos de la interfaz (elementos con data-icon)
    document.querySelectorAll('[data-icon]').forEach(el => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));

    loadAll();
    refreshFoodDatalist();
    appReady = true;
    migrateOldDraft();
    openDate(todayLocalISO());
    renderFoodTable();
    renderHistory();

    // Pestañas
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

    // Datos del día y perfil → recalcular objetivos y guardar el día
    ['weight', 'dayType', 'sex', 'age', 'height', 'specialty', 'goal', 'activity'].forEach(id => {
        const evt = $(id).tagName === 'SELECT' ? 'change' : 'input';
        $(id).addEventListener(evt, () => { recalculateTargets(); scheduleSave(); });
    });
    $('logNotes').addEventListener('input', scheduleSave);
    $('btnAddSession').addEventListener('click', chooseSessionType);
    initSleepUI();
    $('btnDeleteFood').addEventListener('click', () => { if (editingFoodId) deleteFood(editingFoodId); });
    // Tocar el título del día abre el calendario
    $('logDate').addEventListener('click', e => { try { e.target.showPicker(); } catch (err) {} });

    // Navegar por los días del diario
    $('logDate').addEventListener('change', () => {
        if (DATE_RE.test($('logDate').value)) openDate($('logDate').value);
        else $('logDate').value = currentDate;
    });
    $('btnPrevDay').addEventListener('click', () => openDate(addDays(currentDate, -1)));
    $('btnNextDay').addEventListener('click', () => openDate(addDays(currentDate, 1)));
    $('btnToday').addEventListener('click', () => openDate(todayLocalISO()));

    // Al salir de la app se guarda al momento; si se vuelve otro día, se abre el día nuevo
    let todayWhenHidden = todayLocalISO();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushSave();
            todayWhenHidden = todayLocalISO();
        } else if (todayLocalISO() !== todayWhenHidden && currentDate === todayWhenHidden) {
            openDate(todayLocalISO());
        }
    });
    window.addEventListener('pagehide', flushSave);

    // Barra de "lo que queda" al bajar por las comidas
    const hero = $('hero');
    window.addEventListener('scroll', () => {
        const onToday = $('tab_today').classList.contains('active');
        $('stickySummary').classList.toggle('show', onToday && hero.getBoundingClientRect().bottom < 0);
    }, { passive: true });

    // Modal de alimento
    ['mFoodC', 'mFoodP', 'mFoodF'].forEach(id => $(id).addEventListener('input', autoCalcFoodKcal));
    $('mFoodKcal').addEventListener('input', () => { kcalTouched = $('mFoodKcal').value !== ''; });
    $('modalFood').addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'password') saveFoodFromModal();
    });
    $('newMealTitle').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAddMeal(); });
    $('geminiApiKeyInput').addEventListener('change', saveGeminiApiKey);

    // Foto: clic, arrastrar y pegar
    const dz = $('aiDropZone');
    dz.addEventListener('click', () => $('aiImageFile').click());
    $('aiImageFile').addEventListener('change', e => processImageFile(e.target.files[0]));
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('dragover');
        processImageFile(e.dataTransfer.files[0]);
    });
    window.addEventListener('paste', e => {
        if (!$('modalFood').classList.contains('active')) return;
        const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
        if (item) {
            $('aiBox').open = true;
            processImageFile(item.getAsFile());
        }
    });

    // Búsqueda y copia de seguridad
    $('dbSearch').addEventListener('input', renderFoodTable);
    $('importJsonInput').addEventListener('change', importFullBackup);

    // Cerrar modales con clic fuera o Escape
    document.querySelectorAll('.modal-overlay').forEach(m =>
        m.addEventListener('mousedown', e => { if (e.target === m) closeModal(m.id); }));
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        const open = [...document.querySelectorAll('.modal-overlay.active')].pop();
        if (open) closeModal(open.id);
    });

    // Recordatorio de copia de seguridad (como mucho una vez al día)
    if (updateBackupStatus() && store.getItem(STORAGE_KEY_BACKUP_NAG) !== todayLocalISO()) {
        store.setItem(STORAGE_KEY_BACKUP_NAG, todayLocalISO());
        setTimeout(() => showToast('Hace tiempo que no haces copia de seguridad (Diario → Datos)', COLOR.warn), 1500);
    }

    // La primera vez que se abre una versión con datos nuevos se propone guardar una copia
    if (num(store.getItem(STORAGE_KEY_SCHEMA), 0) < SCHEMA_VERSION) {
        const done = () => {
            store.setItem(STORAGE_KEY_SCHEMA, String(SCHEMA_VERSION));
            $('upgradeBanner').hidden = true;
        };
        if (historyLogs.length) {
            $('upgradeBanner').hidden = false;
            $('btnUpgradeBackup').addEventListener('click', () => { exportFullBackup(); done(); });
            $('btnUpgradeDismiss').addEventListener('click', done);
        } else {
            done();
        }
    }

    // App instalable y que funciona sin conexión (publicada en https; en localhost solo con ?sw para probarla)
    const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
    const swAllowed = location.protocol === 'https:' || (isLocal && location.search.includes('sw'));
    if ('serviceWorker' in navigator && swAllowed) {
        const hadVersion = Boolean(navigator.serviceWorker.controller);
        navigator.serviceWorker.register('sw.js').then(reg => {
            // Al volver a la app se mira si hay versión nueva (como mucho una vez por hora)
            let lastCheck = Date.now();
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && Date.now() - lastCheck > 3600000) {
                    lastCheck = Date.now();
                    reg.update().catch(() => {});
                }
            });
        }).catch(() => {});
        // La versión nueva se descarga entera en segundo plano; cuando está lista se ofrece recargar
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (hadVersion) {
                showToast('Hay una versión nueva de SwimFuel', COLOR.info, { label: 'Recargar', sticky: true, run: () => location.reload() });
            }
        });
    }
    // Pide al navegador que no borre los datos de la app por falta de espacio
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

document.addEventListener('DOMContentLoaded', init);
