# 象棋小棋聖 V2.9.1

## 功能
- 東萍公開棋譜網址單盤匯入
- Playwright/Chromium 自動開頁
- 嘗試點擊「棋譜自動導出／棋譜導出／導出」
- 10 秒頁面 timeout；同步失敗最多重試 3 次
- DhtmlXQ / WXF 擷取
- 自動去重
- 棋手自動加入棋手庫
- 自動開局分類
- 完整 rawExport、DhtmlXQ binit/movelist、detailUrl 保存
- exactMoves 可播放時直接進原棋盤
- /api/health 顯示 V2.9
- Render Docker + Playwright

## Windows
雙擊 `start.bat`。瀏覽器會自動開啟 http://localhost:3000/。

## Render
建議直接以 Docker 部署；`render.yaml` 已包含 health check 與 `/app/data` persistent disk。GitHub push 後 Render 自動部署。

## 東萍使用方式
在「東萍大師棋譜匯入」貼上公開棋譜詳細頁或公開搜尋頁網址，按「測試連線」後按「匯入」。

注意：若東萍該頁的導出功能需要特定瀏覽器互動、驗證碼或登入，Playwright 會回報無法取得導出資料；此時不會假造棋譜。


## V2.9.1 定向同步規則
- 不提供全站/全庫同步。
- 預設大師：王天一、許銀川、呂欽、胡榮華、柳大華、曹岩磊、趙國榮、趙鑫鑫、陶漢明、葛振衣、趙奕帆、劉安生、吳貴臨、李思誼、孟繁睿、馮家俊、賴理、楊官璘。
- 可輸入其他棋手姓名，按「同步此棋手」；只處理該棋手。
- 東萍同步入口統一使用 `http://www.dpxq.com/hldcg/search/`。
- 每次棋手同步預設最多 5 頁、100 盤，可用 `DPXQ_MAX_PAGES`、`DPXQ_MAX_GAMES` 調整。
- 單盤詳細網址仍可用「單盤匯入」。

## V2.9.1 Render 修正
- 修正 Express 5 的 `app.get('*')` 啟動錯誤，改為 SPA fallback middleware。
- 建議 Render 使用 Docker runtime，因為本專案需要 Playwright/Chromium。
- health 版本為 V2.9.1。
