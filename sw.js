// Service worker de SwimFuel: guarda la app en el móvil para que abra al instante y funcione sin conexión.
// Tus datos NO pasan por aquí (están en el almacenamiento del navegador); esto solo guarda los archivos de la app.
// Al publicar cambios, sube el número de versión: el móvil descarga la versión nueva ENTERA (nunca mezcla
// archivos de dos versiones) y la app avisa para recargar.
const CACHE = 'swimfuel-v6';

// La página principal se guarda como "./" (no "./index.html"): algunos alojamientos, como Cloudflare,
// redirigen /index.html a / y una respuesta redirigida no puede usarse para abrir la app.
// Si añades un archivo a la app, añádelo también aquí.
const ASSETS = [
    './',
    './manifest.webmanifest',
    './css/app.css',
    './js/engine.js',
    './js/core.js',
    './js/today.js',
    './js/foods.js',
    './js/history.js',
    './js/main.js',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png',
    './apple-touch-icon.png'
];

self.addEventListener('install', event => {
    // cache: 'reload' se salta la caché del navegador: todos los archivos salen del servidor en el mismo momento
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    const url = new URL(req.url);
    // Solo archivos propios (la IA de Google va directa a internet)
    if (req.method !== 'GET' || url.origin !== self.location.origin) return;

    // La app se sirve siempre de la versión guardada; lo que no sea de la app (p. ej. tests/) va a la red
    const scope = new URL('./', self.location).pathname;
    const isApp = req.mode === 'navigate' && (url.pathname === scope || url.pathname === scope + 'index.html');
    event.respondWith(
        caches.open(CACHE).then(async cache => {
            const cached = await cache.match(isApp ? './' : req, { ignoreSearch: true });
            if (cached) return cached;
            try {
                return await fetch(req);
            } catch (err) {
                if (req.mode === 'navigate') return (await cache.match('./')) || Response.error();
                throw err;
            }
        })
    );
});
