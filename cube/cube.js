// Cube 設定。只放「關掉開發模式之後要自己補回來」的東西，連線設定仍在 .env。
//
// 為什麼關開發模式：開發模式不驗證身分，4000 埠又開在所有網卡上，
// 同一個區網或 ZeroTier 網路的人不用登入就能查整個資料庫，Playground 還能改寫模型檔。
// 關掉之後每個請求都要帶用 CUBEJS_API_SECRET 簽的 JWT（由 cube_process.auth_header() 產生），
// Playground 與 SQL API（15432 埠）也一起關閉。
//
// 開發模式會監看 model/ 自動重新編譯，正式模式不會。這裡用 schemaVersion 補回來：
// Cube 每個請求都會問一次版本，版本變了就重新編譯——改 yml 之後不必重啟。
const fs = require("fs")
const path = require("path")
const sqlite3 = require("sqlite3")
const SqliteDriver = require("@cubejs-backend/sqlite-driver")

const MODEL_DIR = path.join(__dirname, "model")
// 每個請求都掃一次目錄太浪費；兩秒內沿用上一次的結果，改完模型最多慢兩秒生效
const CHECK_EVERY_MS = 2000

let checkedAt = 0
let version = ""

function latestChange(dir) {
  let latest = 0
  let count = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const [sub, n] = latestChange(full)
      latest = Math.max(latest, sub)
      count += n
    } else {
      latest = Math.max(latest, fs.statSync(full).mtimeMs)
      count += 1
    }
  }
  return [latest, count]
}

// 內建的 SQLite driver 整個 Cube 只開一條連線，佇列並行度卻是 2：兩個查詢擠同一條連線、
// 互相拖到兩個都跑完才一起回來，一頁同時送出的查詢因此「一起卡住」。
// SQLite 是 WAL 模式，多條唯讀連線可以真的同時讀，查詢跑在 libuv 的執行緒池上（預設 4 條）。
const POOL_SIZE = Number(process.env.MAYHEM_SQLITE_POOL || 4)

class PooledSqliteDriver extends SqliteDriver {
  constructor(config = {}) {
    super(config)
    this.pool = Array.from({ length: POOL_SIZE }, () =>
      new sqlite3.Database(this.config.database, sqlite3.OPEN_READONLY))
    this.busy = this.pool.map(() => 0)
  }

  // 交給手上查詢最少的那條連線
  query(query, values) {
    let i = 0
    for (let k = 1; k < this.pool.length; k++) if (this.busy[k] < this.busy[i]) i = k
    this.busy[i]++
    return new Promise((resolve, reject) =>
      this.pool[i].all(query, values || [], (err, rows) => {
        this.busy[i]--
        if (err) reject(err)
        else resolve(rows)
      }))
  }

  async release() {
    await Promise.all(this.pool.map((db) => new Promise((done) => db.close(() => done()))))
    await super.release()
  }
}

module.exports = {
  driverFactory: () => new PooledSqliteDriver(),
  orchestratorOptions: {
    queryCacheOptions: { queueOptions: { concurrency: POOL_SIZE } },
  },
  schemaVersion: () => {
    const now = Date.now()
    if (now - checkedAt > CHECK_EVERY_MS) {
      checkedAt = now
      // 檔案數也算進去：刪掉一個檔不會讓任何剩下的檔案 mtime 變大
      const [latest, count] = latestChange(MODEL_DIR)
      version = `${latest}:${count}`
    }
    return version
  },
}

// 主執行緒卡頓偵測：每 100ms 檢查一次，延遲超過 250ms 就寫一行進 cube.log。
// Cube 的查詢編譯、結果處理全都在這一條執行緒上，它一卡，所有請求一起卡，
// 瀏覽器那邊看起來就是「一頁的請求全部同時轉 2～3 秒」。2026-09 就是靠這個抓到
// 服務被排程工作跑成「低於正常」優先權、被瀏覽器搶走 CPU（見 app.py 的 _normal_priority）。
// 查法：grep "EVENT LOOP BLOCKED" cube/cube.log
{
  let last = Date.now()
  setInterval(() => {
    const now = Date.now()
    const lag = now - last - 100
    if (lag > 250) console.log(JSON.stringify({ message: "EVENT LOOP BLOCKED", lag, at: new Date(now).toISOString() }))
    last = now
  }, 100).unref()
}
