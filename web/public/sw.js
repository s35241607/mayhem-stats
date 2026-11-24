// Service Worker：只讓「加到主畫面」可以安裝、外殼在網路不穩時開得起來。
//
// 快取什麼、不快取什麼：
// - /assets/*：檔名帶內容雜湊（Vite），內容變了檔名就變，快取優先、永遠不會拿到舊的。
// - 頁面（/、/dashboard…）：網路優先，斷線時才拿上一次的 index.html，所以改版後一連上就是新版。
// - /api、/auth、/login 一律不碰：資料有登入與名稱遮罩，存進快取可能在別人的手機上看到不該看的東西；
//   登入流程也不能被攔。
const CACHE = "mayhem-shell-v2"
const PAGES = new Set(["", "dashboard", "matches", "champions", "augments", "lineups", "players", "crew",
  "time", "tilt", "losses", "explore", "recap", "calc", "tracked", "settings", "logs",
  "feed", "pick", "profile", "score", "changelog"])
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

// ── 推送通知：採集到新對局時伺服器送來「你有 N 場新對局」（見 push.py）──────────
// 同一個 tag 的通知會互相取代；使用者還沒看、下一輪又採到時，把場數加總而不是只剩最新那輪。
const PUSH_TAG = "mayhem-new-matches"

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  event.waitUntil((async () => {
    const tag = data.tag || PUSH_TAG
    let count = Number(data.count) || 0
    let body = data.body || "戰報已更新"
    if (count > 0) {
      const shown = await self.registration.getNotifications({ tag })
      for (const n of shown) count += Number(n.data?.count) || 0
      if (shown.length) body = `你有 ${count} 場新對局，戰報已更新`
    }
    await self.registration.showNotification(data.title || "Mayhem 戰績", {
      body,
      tag,
      renotify: true,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/", count },
    })
  })())
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  // 只開本站的網址：推送內容來自伺服器，但多一層保險不讓通知把人帶去別的網域
  const target = new URL(event.notification.data?.url || "/", self.location.origin)
  const url = target.origin === self.location.origin ? target.href : self.location.origin + "/"
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    for (const win of wins) {
      if (new URL(win.url).origin !== self.location.origin) continue
      await win.focus()
      if (win.url !== url && "navigate" in win) await win.navigate(url).catch(() => {})
      return
    }
    await self.clients.openWindow(url)
  })())
})

// 瀏覽器輪換訂閱時（金鑰過期等）重新訂閱並告訴伺服器；失敗就等使用者下次開設定頁再開一次
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const key = event.oldSubscription?.options?.applicationServerKey
    if (!key) return
    const sub = event.newSubscription
      ?? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    })
  })().catch(() => {}))
})
