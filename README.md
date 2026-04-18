# 台股題材選股雷達

## 功能
- 開啟時自動從 Google Apps Script 抓取台股行情、除權息資訊、AI選股分析
- 點「更新資料」重新抓取最新資料
- 搜尋股號/股名、主題篩選、AI選股推薦
- 個股 Modal 顯示：AI評分、管理層評價、三大法人買賣超、配息穩定性

## 本機開發

```bash
npm install
npm run dev
```

## 部署到 Vercel

1. 把這個資料夾推到 GitHub
2. 去 https://vercel.com 用 GitHub 帳號登入
3. Import 這個 repo
4. Framework Preset 選 **Vite**
5. 點 Deploy

## 資料來源

Apps Script Web App：每日由 Google Sheets 自動更新
- 台股行情（撿股讚）
- 除權息資訊
- AI 選股分析（本地規則評分）
