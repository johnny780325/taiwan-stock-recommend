import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Loading 畫面 HTML（注入到 #root 裡，讓 build 後也有深色 loading）
const LOADING_HTML = `<div style="min-height:100vh;background:#0a0a0f;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'PingFang TC',sans-serif;gap:16px"><style>@keyframes _sp{to{transform:rotate(360deg)}}</style><div style="width:40px;height:40px;border:3px solid rgba(0,210,150,0.2);border-top-color:#00d296;border-radius:50%;animation:_sp 0.7s linear infinite"></div><div style="font-size:14px;font-weight:700;color:#00d296;letter-spacing:2px">台股題材選股雷達</div><div style="font-size:11px;color:#444">載入中...</div></div>`

export default defineConfig({
  plugins: [
    react(),
    // 在 build 後把 loading 內容注入 #root，開發模式不影響
    {
      name: 'inject-loading',
      transformIndexHtml: {
        enforce: 'post',
        transform(html) {
          return html.replace(
            '<div id="root"></div>',
            `<div id="root">${LOADING_HTML}</div>`
          )
        }
      }
    }
  ],
  build: {
    outDir: 'dist',
  },
})
