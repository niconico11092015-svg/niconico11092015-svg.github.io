/* La Mueblería Conca — service worker
   Guarda la app y sus librerías en el teléfono para que abra sin señal.
   Los DATOS no pasan por acá: los maneja la app (localStorage + Firebase). */
const VERSION = 'mc-v1';
const APP = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];
const LIBS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js'
];
const FUENTES_CSS = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@300;400;500;600&display=swap';
const HOSTS_CACHEABLES = ['cdn.jsdelivr.net', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Cada recurso por separado: si uno falla, los demás igual se guardan.
    for (const u of APP) { try { await cache.add(u); } catch (_) {} }
    for (const u of LIBS) {
      try { await cache.put(u, await fetch(u, { mode: 'no-cors' })); } catch (_) {}
    }
    // Tipografías: se guarda el CSS y también los archivos de fuente que menciona.
    try {
      const css = await fetch(FUENTES_CSS, { mode: 'cors' });
      const texto = await css.clone().text();
      await cache.put(FUENTES_CSS, css);
      const urls = [...texto.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
      for (const u of urls) { try { await cache.put(u, await fetch(u, { mode: 'no-cors' })); } catch (_) {} }
    } catch (_) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) { if (k !== VERSION) await caches.delete(k); }
    await self.clients.claim();
  })());
});

// Página principal: primero la red (así siempre ves la última versión), pero si no hay señal o tarda
// más de 4 segundos, abre la copia guardada.
async function paginaConRed(req) {
  const cache = await caches.open(VERSION);
  const red = fetch(req.url, { cache: 'no-cache' }).then(r => {
    if (r && r.ok) cache.put('./', r.clone());
    return r;
  });
  const respaldo = new Promise(res => setTimeout(async () => res((await cache.match('./')) || null), 4000));
  const r = await Promise.race([red.catch(() => null), respaldo]);
  if (r) return r;
  const guardada = await cache.match('./');
  if (guardada) return guardada;
  return (await red.catch(() => null)) || new Response('Sin conexión y todavía no hay copia guardada de la app. Abrila una vez con internet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// Resto de archivos: los sirve desde la copia guardada y la actualiza por detrás.
async function guardadaYActualiza(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  const red = fetch(req).then(r => {
    if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
    return r;
  }).catch(() => null);
  return hit || (await red) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    e.respondWith(paginaConRed(req));
    return;
  }
  if (url.origin === self.location.origin || HOSTS_CACHEABLES.includes(url.hostname)) {
    e.respondWith(guardadaYActualiza(req));
  }
  // Todo lo demás (Firebase, etc.) pasa directo, sin tocar.
});
