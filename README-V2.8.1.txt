# V2.8.1 東萍真正同步＋原棋盤播放整合修正版

這次不是只改前端。

目前問題的根因是：東萍詳細頁常把 `[DhtmlXQ_binit]` / `[DhtmlXQ_movelist]`
放在 iframe 的 `name="NoFile_[DhtmlXQiFrame]..."` 或 URL-encoded 內容裡，
原 V2.8 parser 只尋找完整 `[DhtmlXQ]...[/DhtmlXQ]`，所以同步結果會出現：

- 索引找到 100
- 詳細頁處理 20
- 可播放 0
- moves = []

V2.8.1 會在 Render / 本機啟動前自動 patch server.js：

1. 寬鬆解析 DhtmlXQ 欄位
2. 支援 iframe / URL encoded DhtmlXQ
3. 取得 binit + movelist
4. 產生中文棋譜 moves
5. 產生 exactMoves
6. repository 的「原棋盤播放」改走 game.html 播放橋
7. game.html 同時顯示：
   - 完整棋譜文字
   - ▶ 原棋盤播放
   - 🌐 公開棋譜頁
   - 東萍來源
8. 版本顯示升到 V2.8.1

## 上傳 GitHub

覆蓋：
- package.json

新增：
- server-patch.js

不需要刪除 server.js。

## Render

Render 不需要改 Build Command。

Start Command 使用 package.json：
`npm start`

部署後先確認：
`/api/health`

應看到：
`version: 2.8.1`
`displayVersion: V2.8.1`

## 最重要：重新同步

舊資料庫裡目前 126 筆左右的 dpxq-index 棋譜已經建立，但其中很多 moves 是空的。
修 parser 後必須重新按一次：

「開始自動同步」

同一 detailUrl 會被更新，不會因為同一筆而重複新增。

成功後應看到：
「可播放」數量開始增加。

## 測試

1. repository.html
2. 搜尋 王天一
3. 找一筆有「▶ 原棋盤播放」
4. 點擊
5. game.html 會顯示完整記譜
6. 再進入原棋盤
7. 使用原本的上一手／下一手／自動播放

如果某一筆東萍頁本身沒有 movelist，該筆仍會保留「公開棋譜頁」連結，不會假造棋譜。
