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

module.exports = {
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
