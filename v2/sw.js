/**
 * Service Worker — Finanzas V2.0  (PWA instalable, offline-first)
 * Rutas RELATIVAS: funciona igual servido en raíz (/) o en subcarpeta (/v2/).
 * Todo es local: ningún dato financiero sale del dispositivo.
 */
const CACHE_NAME = 'finanzas-v2-v4';

// Relativas al scope del SW (la carpeta donde vive sw.js).
const ASSETS = [
  './',
  'index.html', 'premium.html', 'migrate.html',
  'premium.css', 'manifest.json', 'icon.svg',
  'vendor/inter.css', 'vendor/inter-variable.woff2',
  'vendor/lucide.min.js', 'vendor/chart.umd.min.js', 'vendor/xlsx.full.min.js',
  'src/app/main.js', 'src/app/premium.js',
  'src/data/repository.js', 'src/data/excel.js', 'src/data/migrate.js',
  'src/core/engine.js', 'src/core/debt.js', 'src/core/tax.js', 'src/core/business.js',
];

// Install: precarga resiliente (un asset faltante no aborta la instalación).
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(ASSETS.map((a) => cache.add(new Request(a, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

// Activate: limpia caches viejas.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Fetch: navegaciones -> network-first; estáticos -> cache-first con refresco.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // todo es local

  const isNav = request.mode === 'navigate' || request.destination === 'document';
  event.respondWith(isNav ? networkFirst(request) : cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) || (await cache.match('index.html')) ||
      new Response('Sin conexión y sin copia en caché.', { status: 503 });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request).then((res) => { if (res.ok) cache.put(request, res); }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return new Response('Recurso no disponible offline.', { status: 503 });
  }
}

// Permite a la app forzar actualización del SW.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data?.type === 'CACHE_CLEAR') caches.keys().then((ns) => ns.forEach((n) => caches.delete(n)));
});

// Recordatorios (pago TDC, metas) — disponible para uso futuro.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: 'icon.svg', badge: 'icon.svg', data: data.url || '.',
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return clients.openWindow(event.notification.data || '.');
  }));
});
