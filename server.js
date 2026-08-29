const express = require('express');
const axios = require('axios');
const iconv = require('iconv-lite');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * DPXQ Game Sync API Endpoint
 */
app.get('/api/fetch-dpxq', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ success: false, error: '請提供東萍棋譜網址' });
    }

    try {
        // Automatically add http:// if missing
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'http://' + targetUrl;
        }

        console.log('[Fetching URL]:', targetUrl);

        // Fetch page content
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            timeout: 15000,
            validateStatus: status => status < 500, // Handle non-200 gracefully
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': 'http://www.dpxq.com/'
            }
        });

        if (response.status >= 400) {
            return res.status(response.status).json({ 
                success: false, 
                error: `東萍伺服器回應錯誤狀態碼 HTTP ${response.status}` 
            });
        }

        // Decode GBK
        const htmlText = iconv.decode(Buffer.from(response.data), 'gbk');

        // Regex patterns matching various DPXQ output formats (h5.asp, h5dpxq.asp, mobile, etc.)
        const moveListMatch = htmlText.match(/DhtmlXQ_movelist\s*=\s*['"]([^'"]*)['"]/i) ||
                              htmlText.match(/movelist\s*=\s*['"]([^'"]*)['"]/i) ||
                              htmlText.match(/DhtmlXQ_m\s*=\s*['"]([^'"]*)['"]/i);

        const titleMatch = htmlText.match(/DhtmlXQ_title\s*=\s*['"]([^'"]*)['"]/i) ||
                           htmlText.match(/<title>(.*?)<\/title>/i);

        const initBoardMatch = htmlText.match(/DhtmlXQ_b\s*=\s*['"]([^'"]*)['"]/i);
        const redPlayerMatch = htmlText.match(/DhtmlXQ_red\s*=\s*['"]([^'"]*)['"]/i);
        const blackPlayerMatch = htmlText.match(/DhtmlXQ_black\s*=\s*['"]([^'"]*)['"]/i);

        if (!moveListMatch || !moveListMatch[1]) {
            return res.status(422).json({ 
                success: false, 
                error: '解析失敗：該網址非單一棋譜頁面（可能為列表頁）或未找到著法數據 (movelist)' 
            });
        }

        return res.json({
            success: true,
            title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '未命名棋譜',
            red: redPlayerMatch ? redPlayerMatch[1].trim() : '紅方',
            black: blackPlayerMatch ? blackPlayerMatch[1].trim() : '黑方',
            initBoard: initBoardMatch ? initBoardMatch[1].trim() : '',
            moves: moveListMatch[1].trim()
        });

    } catch (err) {
        console.error('[DPXQ Fetch Exception]:', err.message);
        return res.status(200).json({ 
            success: false, 
            error: `抓取失敗 (${err.code || 'REQUEST_FAILED'}): ${err.message}` 
        });
    }
});

// Catch-all API Route handler
app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, error: `找不到 API 端點: ${req.originalUrl}` });
});

// Static SPA Fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'repository.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});