import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 圖示載入完才淡入（樣式在 index.css 的 img[loading="lazy"]）。load 事件不會冒泡，用捕獲階段全站聽一次，
// 不必每個 <img> 各接一個 onLoad。載入失敗也標記，免得壞掉的圖示永遠是透明的佔位。
const markLoaded = (e: Event) => {
  if (e.target instanceof HTMLImageElement) e.target.dataset.loaded = "1"
}
document.addEventListener("load", markLoaded, true)
document.addEventListener("error", markLoaded, true)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
