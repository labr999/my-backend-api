# 象棋小棋聖 my-backend-api

回覆與註解一律用繁體中文（台灣）。

## 架構
- Node.js + Express 5，單一後端檔 `server.js`（版本字串在第 10 行 `DISPLAY_VERSION`）。
- 前端是靜態檔 `public/`（index.html、game.html、play.html、repository.html、opening-book.html、ipad-scan.html 等），由 Express 直接提供，沒有打包工具。
- iPad 影片辨識：`public/xqrecog.js`（ONNX 前處理）、`public/xqgame.js`（規則與追蹤）。改這兩個檔要同步升 `ipad-scan.html` 裡的 `?v=` 版本。
- 東萍棋譜抓取用 Playwright（Chromium）。
- 部署：Dockerfile（mcr.microsoft.com/playwright 映像），PORT 10000，健康檢查 `/api/health`。

## 資料
- 正式資料在 Neon Postgres，表 `xq_store` 存整份 DB JSON（環境變數 `DATABASE_URL`）。
- 沒設 `DATABASE_URL` 時用本機 JSON，可用來測試。
- **不要修改、刪除或提交 `data/xiangqi-db.json`。**
- 沒有我同意不要改資料結構；「我的清單」（/api/playlists）與本機 video_scan.py 上傳介面要保持相容。

## 機密
- 環境變數：DATABASE_URL、DPXQ_USER、DPXQ_PASS、LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN、LINE_INBOX_KEY、YOUTUBE_API_KEY、CHANNEL_ID。
- 絕不把任何金鑰、密碼、連線字串寫進程式或提交到 git。

## 測試與工作方式
- 本機啟動：`npm install` → `node server.js`，打開 http://localhost:10000。
- 改完先在本機跑過、確認 `/api/health` 正常，再說明改了什麼。
- 每次改版把 `DISPLAY_VERSION` 小版號 +1。
- 一次只改一件事，改動範圍越小越好；不要重排或重寫整個 server.js。
- 沒有我明確說「推」不要 git push（push main 會自動部署正式站）。
