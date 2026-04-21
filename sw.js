// v11: Fase 1.1 — gate de signup por convite (auth gate com 3 campos + tela de Convites em Configurações).
// v10: Fase 1.4 — modal de onboarding de primeiro acesso (pede nome do lar).
// v9: Fase 1.5 — reset de senha (esqueci minha senha + nova senha após link do email).
// v8: Perfil dinâmico na sidebar — avatar e nome do lar derivados de perfil.casal.
// v7: Fase 0 — retry com backoff + fallback entre modelos Gemini + mensagens de erro classificadas.
// Bump força reinstalação do SW para que browsers existentes peguem os JS novos.
const CACHE_NAME = 'financascasa-v11';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/storage.js',
  './js/supabase.js',
  './js/pdf.js',
  './js/api.js',
  './js/fiscal.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// External CDN assets cached on first use
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
];

// Install: cache all local assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for HTML (get updates), cache-first for assets (performance)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache API or Supabase calls
  if (url.hostname === 'generativelanguage.googleapis.com') return;
  if (url.hostname.endsWith('.supabase.co')) return;

  // HTML: network-first (so updates are picked up)
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        // Cache CDN assets and local assets on first fetch
        if (res.ok && (url.origin === self.location.origin || CDN_ASSETS.some(a => event.request.url.startsWith(a)))) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
