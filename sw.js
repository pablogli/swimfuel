// Service worker de SwimFuel: guarda la app en el móvil para que abra al instante y funcione sin conexión.
// Tus datos NO pasan por aquí (están en el almacenamiento del navegador); esto solo guarda los archivos de la app.
// Al publicar cambios, sube el número de versión para que los móviles descarguen la versión nueva.
const CACHE = 'swimfuel-v4';

// La página principal se guarda como "./" (no "./index.html"): algunos alojamientos, como Cloudflare,
// redirigen /index.html a / y una respuesta redirigida no puede usarse para abrir la app.
const ASSETS = [
    './',
    './manifest.webmanifest',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png',
    './apple-touch-icon.png'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const req = event.request;
    const url = new URL(req.url);
    // Solo archivos propios (la IA de Google va directa a internet)
    if (req.method !== 'GET' || url.origin !== self.location.origin) return;

    // Abre al instante desde la caché y actualiza en segundo plano para la próxima vez
    const isPage = req.mode === 'navigate';
    const key = isPage ? './' : req;
    event.respondWith(
        caches.open(CACHE).then(async cache => {
            const cached = await cache.match(key);
            const network = fetch(isPage ? './' : req)
                .then(res => {
                    if (res.ok && !res.redirected) cache.put(key, res.clone());
                    return res;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
