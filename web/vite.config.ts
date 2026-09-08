import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  build: {
    // 產出直接交給 FastAPI 靜態託管，這樣執行期仍然只需要 uv run app.py
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // 開發時把 API 轉給後端，前端與 API 同源，不必處理 CORS
    proxy: {
      "/api": "http://127.0.0.1:5057",
    },
  },
})
