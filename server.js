const express = require('express');
const axios = require('axios');
const iconv = require('iconv-lite');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and Static files
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/**
 * DPXQ Fetch & Parse API Endpoint
 * Resolves CORS and GBK encoding issues when grabbing Chinese chess notation from dpxq.com
 */
app.get('/api/fetch-dpxq', async (req, res) => {
    try {
        const targetUrl = req.query.url;
        if (!targetUrl) {
            return res.status(400).json({ success: false, error: '請提供東萍棋譜網址 (Parameter "url" missing)' });
        }

        // Validate domain
        if (!targetUrl.includes('dpxq.com')) {
            return res.status(400).json({ success: false, error: '僅支援東萍大師棋庫 (dpxq.com) 網址' });
        }

        // Fetch web page as ArrayBuffer to properly handle GBK/GB2312 encoding
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'http://www.dpxq.com/'
            }
        });

        // Decode GBK buffer to String
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
                error: '解析失敗：未能在該東萍頁面找到棋步資料 (DhtmlXQ_movelist)' 
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
        console.error('[Error] DPXQ Fetch Failed:', err.message);
        return res.status(500).json({ 
            success: false, 
            error: '後端抓取失敗，請確認東萍網址是否正確或伺服器連線狀態',
            details: err.message 
        });
    }
});

// Fallback to game.html if accessed directly
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
