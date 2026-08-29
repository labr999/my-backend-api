const express = require('express');
const axios = require('axios');
const iconv = require('iconv-lite');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS & JSON Parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

/**
 * DPXQ Game Sync API Endpoint
 * Resolves CORS and GBK Encoding issues.
 * ALWAYS returns JSON to prevent 'Unexpected token <' errors in frontend.
 */
app.get('/api/fetch-dpxq', async (req, res) => {
    try {
        const targetUrl = req.query.url;
        if (!targetUrl) {
            return res.status(400).json({ success: false, error: '請提供東萍棋譜網址 (Parameter "url" missing)' });
        }

        // Fetch target webpage as raw buffer for GBK decoding
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            timeout: 12000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'http://www.dpxq.com/'
            }
        });

        // Decode GBK/GB2312 buffer to UTF-8 String
        const htmlText = iconv.decode(Buffer.from(response.data), 'gbk');

        // Extract DhtmlXQ variables using regex
        const moveListMatch = htmlText.match(/DhtmlXQ_movelist\s*=\s*['"]([^'"]+)['"]/i);
        const titleMatch = htmlText.match(/DhtmlXQ_title\s*=\s*['"]([^'"]+)['"]/i);
        const initBoardMatch = htmlText.match(/DhtmlXQ_b\s*=\s*['"]([^'"]+)['"]/i);
        const redPlayerMatch = htmlText.match(/DhtmlXQ_red\s*=\s*['"]([^'"]+)['"]/i);
        const blackPlayerMatch = htmlText.match(/DhtmlXQ_black\s*=\s*['"]([^'"]+)['"]/i);

        if (!moveListMatch) {
            return res.status(422).json({ 
                success: false, 
                error: '解析失敗：未能在該東萍頁面找到棋步數據 (DhtmlXQ_movelist)' 
            });
        }

        return res.json({
            success: true,
            title: titleMatch ? titleMatch[1].trim() : '未命名棋譜',
            red: redPlayerMatch ? redPlayerMatch[1].trim() : '紅方',
            black: blackPlayerMatch ? blackPlayerMatch[1].trim() : '黑方',
            initBoard: initBoardMatch ? initBoardMatch[1].trim() : '',
            moves: moveListMatch[1].trim()
        });

    } catch (err) {
        console.error('[DPXQ Fetch Error]:', err.message);
        return res.status(500).json({ 
            success: false, 
            error: '後端代理抓取失敗：' + err.message 
        });
    }
});

/**
 * Fallback route for unhandled API requests
 * Returns JSON error instead of HTML 404 page
 */
app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, error: `找不到 API 端點: ${req.originalUrl}` });
});

// Default route fallback to repository or game
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'repository.html'));
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
