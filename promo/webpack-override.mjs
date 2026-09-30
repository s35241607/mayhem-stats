// 賽季回顧的合成放在 web/src/recap（網頁的 Player 和這裡的渲染共用同一份），
// 那些檔案從 web/node_modules 找 react 與 remotion；而這個專案自己也有一份。
// 兩份 React 同時存在，hooks 與 Remotion 的 context 會互相看不到（"Invalid hook call"、useVideoConfig 找不到），
// 所以一律指向這個專案的那一份。
import { fileURLToPath } from "node:url"

const here = (p) => fileURLToPath(new URL(`./node_modules/${p}`, import.meta.url))

/** @param {import("webpack").Configuration} config */
export const dedupeReact = (config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...config.resolve?.alias,
      react: here("react"),
      "react-dom": here("react-dom"),
      remotion: here("remotion"),
    },
  },
})
