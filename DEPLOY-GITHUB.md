# GitHub 上傳

1. 在 GitHub 建立空白 repository，例如 `xiangqi-web-suite`。
2. 把本資料夾完整保留，不要只上傳 `public`。
3. 雙擊 `GitHub上傳懶人包.bat`。
4. 貼上 repository URL。
5. `git push` 完成後，GitHub 會看到 `server.js`、`public`、`data` 等檔案。

## 注意

GitHub Pages 只能提供前端靜態頁面，不能直接執行 Express/Socket.IO 後端。要讓「棋譜倉庫 API、歷史同步、線上對弈」在線上運作，後端要部署到 Render、Railway、Fly.io、VPS 或其他 Node.js 主機，再把前端 API URL 改成後端網址。
