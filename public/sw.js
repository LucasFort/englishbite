// Service worker: deixa o EnglishBite instalável e abre rápido (e sem internet, com o que já foi baixado)
const VERSION = "eb-v1";
const SHELL = [
  "home.html",
  "lesson.html",
  "index.html",
  "login.html",
  "offline.html",
  "css/style.css",
  "js/api.js",
  "js/home.js",
  "js/lesson.js",
  "js/sounds.js",
  "js/theme.js",
  "js/pwa.js",
  "img/bee.svg",
  "data/lessons.json",
  "audio/index.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // a API (login, progresso...) sempre vai direto para o servidor
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  // áudios e imagens quase nunca mudam: usa o que já está salvo
  if (/\.(mp3|png|svg|jpg|webp)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && res.status === 200) caches.open(VERSION).then((c) => c.put(req, res.clone()));
            return res;
          })
      )
    );
    return;
  }

  // páginas, código e dados: tenta a internet primeiro (para pegar atualizações) e cai no salvo se estiver offline
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("offline.html") : Response.error()))
      )
  );
});
