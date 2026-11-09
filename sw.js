const SHELL_CACHE = 'rabia-v4-shell';
const LIB_CACHE = 'rabia-libs-v1';
const SHELL = ['./', 'index.html', 'manifest.json', 'logo.png', 'icon-192.png', 'icon-512.png', 'firebase-config.js', 'legal.html'];
const LIBS = [
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Reem+Kufi:wght@600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('rabia-') && k !== SHELL_CACHE && k !== LIB_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function cacheModule(cache, url, seen) {
  if (seen.has(url)) return; seen.add(url);
  try {
    const r = await fetch(url); if (!r.ok) return;
    await cache.put(url, r.clone());
    const t = await r.text(), re = /(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/g, subs = []; let m;
    while ((m = re.exec(t))) subs.push(new URL(m[1], url).href);
    await Promise.all(subs.map(u => cacheModule(cache, u, seen)));
  } catch (e) {}
}
async function cacheCssFonts(cache, cssUrl) {
  try {
    const r = await fetch(cssUrl); if (!r.ok) return;
    await cache.put(cssUrl, r.clone());
    const t = await r.text(), re = /url\(\s*["']?([^"')]+\.woff2[^"')]*)["']?\s*\)/g, urls = []; let m;
    while ((m = re.exec(t))) urls.push(new URL(m[1], cssUrl).href);
    await Promise.all(urls.map(u => cache.match(u).then(h => h || fetch(u).then(x => x.ok && cache.put(u, x)).catch(() => {}))));
  } catch (e) {}
}
async function prefetchLibs() {
  const cache = await caches.open(LIB_CACHE), seen = new Set();
  await Promise.all(LIBS.map(u => /\.css|css2\?/.test(u) ? cacheCssFonts(cache, u) : /firebasejs/.test(u) ? cacheModule(cache, u, seen) : cache.match(u).then(h => h || fetch(u).then(x => x.ok && cache.put(u, x))).catch(() => {})));
  const ks = await cache.keys();
  return LIBS.every(u => ks.some(k => k.url === u));
}
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'PREFETCH') {
    e.waitUntil(prefetchLibs().then(ok => self.clients.matchAll().then(cs => cs.forEach(c => c.postMessage({ type: ok ? 'OFFLINE_READY' : 'OFFLINE_PARTIAL' })))));
  }
});

async function netFirst(req, ms) {
  const cache = await caches.open(SHELL_CACHE), pu = new URL(req.url), key = (pu.pathname === '/' || pu.pathname.endsWith('/index.html')) ? 'index.html' : req;
  const back = async () => (await cache.match(key, { ignoreSearch: true })) || (await cache.match('index.html')) || (await cache.match('./'));
  try {
    const res = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('slow')), ms))]);
    if (res && res.ok) { cache.put(key, res.clone()); return res; }
    return (await back()) || res;
  } catch (e) { return (await back()) || Response.error(); }
}
async function swr(req, name) {
  const cache = await caches.open(name), hit = await cache.match(req);
  const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || Response.error();
}
async function cacheFirst(req, name) {
  const cache = await caches.open(name), hit = await cache.match(req);
  if (hit) return hit;
  try { const r = await fetch(req); if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone()); return r; } catch (e) { return Response.error(); }
}
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    if (u.pathname.startsWith('/api/')) return;
    if (r.mode === 'navigate' || u.pathname === '/' || u.pathname.endsWith('/index.html')) { e.respondWith(netFirst(r, 3000)); return; }
    e.respondWith(swr(r, SHELL_CACHE)); return;
  }
  if (u.hostname === 'fonts.googleapis.com') { e.respondWith(swr(r, LIB_CACHE)); return; }
  if (u.hostname === 'fonts.gstatic.com' || u.hostname === 'cdnjs.cloudflare.com' || (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/'))) e.respondWith(cacheFirst(r, LIB_CACHE));
});
