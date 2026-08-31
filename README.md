# 象棋小棋聖 V2.9.2

## 功能
- 東萍公開棋譜網址單盤匯入 / 搜尋頁解析
- 自動繁簡轉換與 GBK 編碼支援
- 東萍大師棋譜同步（預設最多 20 頁、100 盤）
- DhtmlXQ / WXF 完整擷取與棋規合法性校驗
- 自動去重
- 棋手自動加入棋手庫
- 自動開局分類
- 完整 rawExport、DhtmlXQ binit/movelist、detailUrl 保存
- exactMoves 可播放時直接進原棋盤
- /api/health 顯示 V2.9.2

## Windows
雙擊 `start.bat`。瀏覽器會自動開啟 http://localhost:3000/。

## Render
建議直接以 Docker 部署；`render.yaml` 已包含 health check 與 `/app/data` persistent disk。GitHub push 後 Render 自動部署。

## 東萍使用方式
在「東萍大師棋譜匯入」貼上公開棋譜詳細頁或公開搜尋頁網址，按「測試連線」後按「單盤匯入」。

## V2.9.2 定向同步規則與修復
- 不提供全站/全庫同步。
- 預設大師：王天一、許銀川、呂欽、胡榮華、柳大華、曹岩磊、趙國榮、趙鑫鑫、陶漢明、葛振衣、謝靖、趙奕帆、劉安生、吳貴臨、李思誼、孟繁睿、馮家俊、賴理、楊官璘、蔣川、汪洋、鄭惟桐、洪智、徐天紅、孫勇征。
- 可輸入其他棋手姓名，按「同步此棋手」；只處理該棋手。
- 東萍同步入口統一使用 `http://www.dpxq.com/hldcg/search/`。
- **每次棋手同步預設最多 20 頁、100 盤**，可用 `DPXQ_MAX_PAGES`、`DPXQ_MAX_GAMES` 環境變數調整。
- 修復繁體中文棋手查詢簡體資料庫查無棋譜的問題。
- 修復東萍搜尋分頁與 `javascript:view(...)` 連結解析。
- 修復 DhtmlXQ 標準開局空 `binit` 與象/兵河界合法性判斷。

