// Service Worker：只讓「加到主畫面」可以安裝、外殼在網路不穩時開得起來。
//
// 快取什麼、不快取什麼：
// - /assets/*：檔名帶內容雜湊（Vite），內容變了檔名就變，快取優先、永遠不會拿到舊的。
// - 頁面（/、/dashboard…）：網路優先，斷線時才拿上一次的 index.html，所以改版後一連上就是新版。
// - /api、/auth、/login 一律不碰：資料有登入與名稱遮罩，存進快取可能在別人的手機上看到不該看的東西；
//   登入流程也不能被攔。
const CACHE = "mayhem-shell-v3"
const PAGES = new Set(["", "dashboard", "matches", "champions", "augments", "lineups", "players", "crew",
  "time", "tilt", "losses", "explore", "recap", "calc", "tracked", "settings", "logs",
  "score", "changelog"])
const STATIC = new Set(["/manifest.webmanifest", "/app-icon.svg", "/favicon.svg", "/icons.svg",
  "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"])

self.addEventListener("install", () => self.skipWaiting())

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith("/assets/") || STATIC.has(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      }),
    )
    return
  }

  if (req.mode === "navigate" && PAGES.has(url.pathname.replace(/^\/+|\/+$/g, ""))) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // 只存真正的前端（200）；未登入時伺服器回的是 401 登入頁，不能存成外殼
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put("/", copy))
          }
          return res
        })
        .catch(async () => (await caches.match("/")) ?? Response.error()),
    )
  }
})
