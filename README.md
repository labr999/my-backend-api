# 象棋小棋聖 V2.2

## 這版修正了什麼

1. **完整恢復原始 `index.html`**：不再用簡化版首頁取代原本的象棋開局譜，因此原本的開局分類、棋盤、記譜、匯入、IndexedDB 儲存與引擎功能都保留。
2. 新增 `repository.html`：名人／大師棋譜搜尋。
3. 新增 `players.html`：棋手搜尋。
4. 新增 `game.html`：棋譜詳情。
5. 新增 `play.html`：Socket.IO 線上房間對弈。
6. 新增 `history-migrate.html`：從舊版 `file://` 的 `xiangqiDB` / `localStorage` 救援歷史棋譜，再同步到 V2 後端。
7. 後端使用 JSON 持久化，不使用 `better-sqlite3`，降低 Windows 安裝失敗機率。
8. `start.bat` 使用 PowerShell `Start-Process` 開啟瀏覽器，避免部分 Windows 環境 `start "" URL` 無法自動開頁。

## 啟動

1. 安裝 Node.js 18 或以上。
2. 解壓縮本資料夾。
3. 雙擊 **`一鍵啟動.bat`**。
4. 預期自動開啟 `http://127.0.0.1:3000/`。

如果瀏覽器沒有自動開啟，手動輸入 `http://localhost:3000/` 即可；這不代表 Server 失敗，只代表 Windows 沒有啟動預設瀏覽器。

## 舊版歷史救援

如果原本的棋譜歷史是在舊 `index.html` 以 `file://` 開啟時建立：

1. 先啟動 V2。
2. 用舊版 `index.html` 所在的檔案位置開啟本包的 `public/history-migrate.html`，讓網址列顯示 `file:///...`。
3. 按「讀取舊歷史」。
4. 按「同步到 V2 後端」。
5. 回到 `http://localhost:3000/repository.html` 搜尋。
6. 回到首頁按「☁ 同步後端棋庫」，可把救援的歷史重新放回原本棋譜播放介面。

> 如果瀏覽器的 IndexedDB/localStorage 已被清除，網站程式無法從已刪除的瀏覽器資料恢復。

## 棋譜資料

本包預置少量公開名人棋譜與索引資料作為搜尋功能的可運作示範，包括王天一、鄭惟桐、許銀川、洪智、楊官璘、胡榮華等。部分棋譜為可播放完整著法，部分為公開索引項目；頁面會明確標示「尚未收錄完整著法」。

東萍象棋網是來源索引入口：<https://www.dpxq.com/>

## GitHub

把整個資料夾上傳到 GitHub 後，可使用 Render / Railway / 自己的 Node.js 主機部署後端；GitHub Pages 僅適合純前端，不能直接執行本包的 Socket.IO/Express 後端。
