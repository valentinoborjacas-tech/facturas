/* Service worker: permite abrir la app sin internet.
   Estrategia "stale-while-revalidate": responde al instante con lo guardado
   y en segundo plano descarga la versión nueva (se ve en la siguiente apertura).
   Si cambias la lista de archivos, sube el número de CACHE. */
const CACHE = 'bodega-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './sb.js',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req, { ignoreSearch: true }).then(cached => {
        const red = fetch(req)
          .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
          .catch(() => cached || (req.mode === 'navigate' ? cache.match('./index.html') : undefined));
        return cached || red;
      })
    )
  );
});
