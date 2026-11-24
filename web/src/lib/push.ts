/** 新對局的推送通知（Web Push）。伺服器端規則見 push.py，收通知的是 public/sw.js。
 *
 *  訂閱流程：向 /api/push/key 拿 VAPID 公鑰 → pushManager.subscribe → 把訂閱交給 /api/push/subscribe。
 *  關掉時兩邊都要撤：瀏覽器的訂閱 unsubscribe()，伺服器那筆也刪掉，免得伺服器繼續往失效的端點送。
 *  Service Worker 只在建置版註冊（main.tsx），開發模式（vite dev）下這裡一律回報不支援。 */

export type PushState =
  | "unsupported"   // 瀏覽器沒有 Push API，或還沒有 Service Worker
  | "needs-install" // iOS／iPadOS：要先「加入主畫面」從主畫面開，Safari 分頁裡不能訂閱
  | "denied"        // 使用者在瀏覽器設定裡封鎖了通知
  | "off"
  | "on"

/** iOS 與 iPadOS（新的 iPad 會把自己報成 Mac，用觸控點數分辨） */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

/** 是不是從主畫面圖示開的（已安裝的 PWA） */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true
}

/** 這個環境能不能用推送（不含 iOS 未安裝的情況，那個另外判斷） */
export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null
  // 沒註冊過（開發模式）時 ready 會永遠等下去，先確認有沒有
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? navigator.serviceWorker.ready : null
}

export async function pushState(): Promise<PushState> {
  if (isIOS() && !isStandalone()) return "needs-install"
  if (!pushSupported()) return "unsupported"
  if (Notification.permission === "denied") return "denied"
  const reg = await registration()
  if (!reg) return "unsupported"
  const sub = await reg.pushManager.getSubscription()
  return sub && Notification.permission === "granted" ? "on" : "off"
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = await res.json().then((d) => d?.error).catch(() => null)
    throw new Error(msg || `伺服器回應 ${res.status}`)
  }
}

/** 開啟通知。要在使用者點擊的處理函式裡呼叫（瀏覽器只在使用者操作時允許跳出權限詢問）。 */
export async function subscribe(): Promise<PushState> {
  if (!pushSupported()) throw new Error("這個瀏覽器不支援通知")
  const permission = await Notification.requestPermission()
  if (permission !== "granted") return permission === "denied" ? "denied" : "off"
  const reg = await registration()
  if (!reg) throw new Error("離線外殼還沒準備好，重新整理後再試")
  const res = await fetch("/api/push/key")
  if (!res.ok) throw new Error("通知服務暫時不可用")
  const { publicKey } = (await res.json()) as { publicKey: string }
  let sub = await reg.pushManager.getSubscription()
  // 既有的訂閱如果是別把金鑰簽的（伺服器換過金鑰），伺服器送不進去，要重訂
  const current = sub?.options.applicationServerKey
  if (sub && current && !sameBytes(new Uint8Array(current), keyBytes(publicKey))) {
    await sub.unsubscribe().catch(() => {})
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
  try {
    await post("/api/push/subscribe", sub.toJSON())
  } catch (e) {
    // 伺服器沒收下就別留著瀏覽器那邊的訂閱，不然開關會顯示「開」但永遠收不到
    await sub.unsubscribe().catch(() => {})
    throw e
  }
  return "on"
}

/** 關閉通知：伺服器那筆刪掉，瀏覽器的訂閱也撤掉。 */
export async function unsubscribe(): Promise<PushState> {
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {})
    await sub.unsubscribe().catch(() => {})
  }
  return "off"
}
