const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const iconv = require('iconv-lite');
const { Server } = require('socket.io');
const { chromium } = require('playwright');

const APP_VERSION = '2.9.6';
const DISPLAY_VERSION = 'V2.9.6';

// 繁簡轉換對照表（涵蓋象棋大師、棋手名、棋規術語與常見字）
const T2S_MAP = {
  '許': '许', '銀': '银', '川': '川', '呂': '吕', '欽': '钦', '胡': '胡', '榮': '荣', '華': '华',
  '柳': '柳', '大': '大', '曹': '曹', '岩': '岩', '磊': '磊', '趙': '赵', '國': '国', '鑫': '鑫',
  '陶': '陶', '漢': '汉', '明': '明', '葛': '葛', '振': '振', '衣': '衣', '謝': '谢', '靖': '靖',
  '奕': '奕', '帆': '帆', '劉': '刘', '安': '安', '生': '生', '吳': '吴', '貴': '贵', '臨': '临',
  '李': '李', '思': '思', '誼': '谊', '孟': '孟', '繁': '繁', '睿': '睿', '馮': '冯', '家': '家',
  '俊': '俊', '賴': '赖', '理': '理', '楊': '杨', '官': '官', '璘': '璘', '王': '王', '天': '天',
  '一': '一', '蔣': '蒋', '汪': '汪', '洋': '洋', '鄭': '郑', '惟': '惟', '桐': '桐', '洪': '洪',
  '智': '智', '徐': '徐', '紅': '红', '孫': '孙', '勇': '勇', '征': '征', '廣': '广', '東': '东',
  '黑': '黑', '龍': '龙', '江': '江', '浙': '浙', '湖': '湖', '北': '北', '南': '南', '上': '上',
  '海': '海', '蘇': '苏', '雲': '云', '吉': '吉', '林': '林', '遼': '辽', '寧': '宁', '香': '香',
  '港': '港', '澳': '澳', '門': '门', '臺': '台', '灣': '湾', '師': '师', '特': '特', '級': '级',
  '棋': '棋', '勝': '胜', '負': '负', '和': '和', '車': '车', '馬': '马', '砲': '炮', '將': '将',
  '帥': '帅', '象': '象', '相': '相', '士': '士', '仕': '仕', '卒': '卒', '兵': '兵', '開': '开',
  '局': '局', '進': '进', '退': '退', '平': '平', '張': '张', '陳': '陈', '黃': '黄', '單': '单',
  '盤': '盘', '錄': '录', '範': '范', '陸': '陆', '葉': '叶', '賈': '贾', '閻': '阎'
};

function toSimp(str) {
  if (!str) return '';
  return str.split('').map(c => T2S_MAP[c] || c).join('');
}

function gbkEncodeUrl(str) {
  if (!str) return '';
  const buf = iconv.encode(str, 'gbk');
  return Array.from(buf).map(b => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

const DPXQ_BASE = 'http://www.dpxq.com/hldcg/search/';
const MASTER_PLAYERS = [
  ['王天一', '特級大師'], ['許銀川', '特級大師'], ['呂欽', '特級大師'], ['胡榮華', '特級大師'], ['柳大華', '特級大師'],
  ['曹岩磊', '特級大師'], ['趙國榮', '特級大師'], ['趙鑫鑫', '特級大師'], ['陶漢明', '特級大師'], ['葛振衣', '特級大師'],
  ['謝靖', '特級大師'], ['趙奕帆', '大師'], ['劉安生', '大師'], ['吳貴臨', '特級大師'], ['李思誼', '大師'],
  ['孟繁睿', '大師'], ['馮家俊', '大師'], ['賴理', '大師'], ['楊官璘', '特級大師'], ['蔣川', '特級大師'],
  ['汪洋', '特級大師'], ['鄭惟桐', '特級大師'], ['洪智', '特級大師'], ['徐天紅', '特級大師'], ['孫勇征', '特級大師']
].map(([name, title], i) => ({ id: i + 1, name, title }));

// 預設最多 20 頁、100 盤
const MAX_PLAYER_PAGES = Math.max(1, Number(process.env.DPXQ_MAX_PAGES || 20));
const MAX_PLAYER_GAMES = Math.max(1, Number(process.env.DPXQ_MAX_GAMES || 100));
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = process.env.DATA_FILE || path.join(DATA_DIR, 'xiangqi-db.json');
const PORT = Number(process.env.PORT || 3000);

fs.mkdirSync(DATA_DIR, { recursive: true });
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function save() { const t = DB_FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(db, null, 2), 'utf8'); fs.renameSync(t, DB_FILE); }

let db = readJson(DB_FILE, { players: [], games: [], nextGameId: 1 });
if (!Array.isArray(db.players)) db.players = [];
if (!Array.isArray(db.games)) db.games = [];
db.nextGameId = Number(db.nextGameId) || 1;
for (const mp of MASTER_PLAYERS) {
  if (!db.players.some(p => p.name === mp.name)) db.players.push({ ...mp });
}
save();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(ROOT, 'public')));

function ensurePlayer(name, title = '') {
  name = String(name || '').trim();
  if (!name || name === '未知紅方' || name === '未知黑方') return;
  if (!db.players.some(p => p.name === name)) {
    db.players.push({ id: db.players.length + 1, name, title });
  }
}

function norm(g) {
  return {
    id: g.id || db.nextGameId++,
    red: g.red || '未知紅方',
    black: g.black || '未知黑方',
    result: g.result || '未知',
    event: g.event || '',
    year: g.year ? Number(g.year) : null,
    date: g.date || '',
    round: g.round || '',
    place: g.place || '',
    opening: g.opening || classifyOpening(g.tokens || []),
    tokens: Array.isArray(g.tokens) ? g.tokens : [],
    moves: Array.isArray(g.moves) ? g.moves : [],
    exactMoves: Array.isArray(g.exactMoves) ? g.exactMoves : [],
    source: g.source || 'user',
    sourceUrl: g.sourceUrl || '',
    detailUrl: g.detailUrl || '',
    format: g.format || '',
    fen: g.fen || '',
    dpxqBinit: g.dpxqBinit || '',
    dpxqMovelist: g.dpxqMovelist || '',
    rawExport: g.rawExport || '',
    validation: g.validation || '',
    created_at: g.created_at || new Date().toISOString()
  };
}

function addGame(g) {
  const rec = norm(g);
  const key = (rec.detailUrl || '') + '|' + rec.red + '|' + rec.black + '|' + rec.date + '|' + rec.event + '|' + rec.tokens.join(' ');
  const old = db.games.find(x => ((x.detailUrl || '') + '|' + x.red + '|' + x.black + '|' + x.date + '|' + x.event + '|' + (x.tokens || []).join(' ')) === key);
  if (old) {
    Object.assign(old, rec, { id: old.id });
    return { game: old, duplicate: true };
  }
  db.games.push(rec);
  ensurePlayer(rec.red);
  ensurePlayer(rec.black);
  save();
  return { game: rec, duplicate: false };
}



const TYPE = { R: '車', N: '馬', B: '相', A: '仕', K: '帥', C: '砲', P: '兵', r: '車', n: '馬', b: '象', a: '士', k: '將', c: '砲', p: '卒' };
const DEFAULT_BINIT = '0919293949596979891777062646668600102030405060708012720323436383';

function inB(c, r) { return c >= 0 && c < 9 && r >= 0 && r < 10; }
function palace(side, c, r) { return c >= 3 && c <= 5 && (side === 'r' ? r >= 7 && r <= 9 : r <= 2); }
function ownSide(side, r) { return side === 'r' ? r >= 5 : r <= 4; }
function crossedRiver(side, r) { return side === 'r' ? r <= 4 : r >= 5; }
function cat(t) { return { 車: 'R', 车: 'R', 馬: 'N', 马: 'N', 相: 'B', 象: 'B', 仕: 'A', 士: 'A', 帥: 'K',帅: 'K', 將: 'K', 将: 'K', 砲: 'C', 炮: 'C', 兵: 'P', 卒: 'P' }[t] || null; }

function decodeBinit(v) {
  const s = String(v || DEFAULT_BINIT).replace(/[^0-9]/g, '');
  const base = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R', 'C', 'C', 'P', 'P', 'P', 'P', 'P'];
  const pieces = [];
  if (s.length < 64) return decodeBinit(DEFAULT_BINIT);
  for (let i = 0; i < 32; i++) {
    const c = Number(s.slice(i * 2, i * 2 + 1)), r = Number(s.slice(i * 2 + 1, i * 2 + 2));
    if (inB(c, r)) pieces.push({ side: i < 16 ? 'r' : 'b', type: TYPE[i < 16 ? base[i] : base[i - 16].toLowerCase()], col: c, row: r, alive: true });
  }
  return pieces;
}

function board(pieces) {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const p of pieces) if (p.alive && inB(p.col, p.row)) b[p.row][p.col] = p;
  return b;
}

function legal(b, side) {
  const out = [];
  const push = (fc, fr, tc, tr) => {
    if (!inB(tc, tr) || b[tr][tc]?.side === side) return;
    out.push({ fc, fr, tc, tr });
  };
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (!p || p.side !== side) continue;
      const k = cat(p.type);
      if (k === 'R') {
        for (const [dC, dR] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let x = c + dC, y = r + dR;
          while (inB(x, y)) {
            push(c, r, x, y);
            if (b[y][x]) break;
            x += dC; y += dR;
          }
        }
      } else if (k === 'C') {
        for (const [dC, dR] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let x = c + dC, y = r + dR, screen = false;
          while (inB(x, y)) {
            if (!screen) {
              if (!b[y][x]) push(c, r, x, y);
              else screen = true;
            } else if (b[y][x]) {
              push(c, r, x, y);
              break;
            }
            x += dC; y += dR;
          }
        }
      } else if (k === 'N') {
        for (const [dC, dR, lC, lR] of [[1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1], [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0]]) {
          if (inB(c + dC, r + dR) && !b[r + lR][c + lC]) push(c, r, c + dC, r + dR);
        }
      } else if (k === 'B') {
        for (const [dC, dR] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
          const x = c + dC, y = r + dR;
          if (inB(x, y) && ownSide(side, y) && !b[r + dR / 2][c + dC / 2]) push(c, r, x, y);
        }
      } else if (k === 'A') {
        for (const [dC, dR] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const x = c + dC, y = r + dR;
          if (inB(x, y) && palace(side, x, y)) push(c, r, x, y);
        }
      } else if (k === 'K') {
        for (const [dC, dR] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = c + dC, y = r + dR;
          if (inB(x, y) && palace(side, x, y)) push(c, r, x, y);
        }
        let y = r + (side === 'r' ? -1 : 1);
        while (inB(c, y)) {
          if (b[y][c]) {
            if (b[y][c].side !== side && cat(b[y][c].type) === 'K') push(c, r, c, y);
            break;
          }
          y += side === 'r' ? -1 : 1;
        }
      } else if (k === 'P') {
        const d = side === 'r' ? -1 : 1;
        if (inB(c, r + d)) push(c, r, c, r + d);
        if (crossedRiver(side, r)) {
          if (inB(c - 1, r)) push(c, r, c - 1, r);
          if (inB(c + 1, r)) push(c, r, c + 1, r);
        }
      }
    }
  }
  return out;
}

const redNumServer = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function colNameServer(side, col) { const n = side === 'r' ? 9 - col : col + 1; return side === 'r' ? redNumServer[n] : String(n); }
function stepNameServer(side, k) { return side === 'r' ? redNumServer[k] : String(k); }

function genNotationServer(pieces, piece, from, to) {
  const side = piece.side, k = cat(piece.type);
  const straight = (k === 'R' || k === 'C' || k === 'P' || k === 'K');
  const sameColMates = pieces.filter(p => p.alive && p !== piece && p.side === side && cat(p.type) === k && p.col === from[0]);
  let prefix = '';
  if (sameColMates.length > 0 && (k === 'R' || k === 'C' || k === 'P' || k === 'N')) {
    const isFront = side === 'r'
      ? from[1] < Math.min(...sameColMates.map(o => o.row))
      : from[1] > Math.max(...sameColMates.map(o => o.row));
    prefix = isFront ? '前' : '後';
  }
  let body;
  if (straight) {
    if (to[1] === from[1]) body = '平' + colNameServer(side, to[0]);
    else {
      const adv = side === 'r' ? to[1] < from[1] : to[1] > from[1];
      body = (adv ? '進' : '退') + stepNameServer(side, Math.abs(to[1] - from[1]));
    }
  } else {
    const adv = side === 'r' ? to[1] < from[1] : to[1] > from[1];
    body = (adv ? '進' : '退') + colNameServer(side, to[0]);
  }
  return prefix ? prefix + piece.type + body : piece.type + colNameServer(side, from[0]) + body;
}

function decodeMoves(binit, movelist) {
  binit = binit || DEFAULT_BINIT;
  const pieces = decodeBinit(binit);
  const s = String(movelist || '').replace(/[^0-9]/g, '');
  const exact = [], tokens = [];
  let side = 'r', valid = true, reason = '';
  for (let i = 0; i + 3 < s.length; i += 4) {
    const fc = +s[i], fr = +s[i + 1], tc = +s[i + 2], tr = +s[i + 3];
    const p = pieces.find(x => x.alive && x.col === fc && x.row === fr);
    if (!p || p.side !== side) {
      valid = false;
      reason = `DhtmlXQ 起始位置與著法無法對應 (手數 ${i / 4 + 1})`;
      break;
    }
    const ok = legal(board(pieces), side).some(m => m.fc === fc && m.fr === fr && m.tc === tc && m.tr === tr);
    if (!ok) {
      valid = false;
      reason = `DhtmlXQ 著法無法通過基本棋規 (手數 ${i / 4 + 1}：${p.type} ${fc},${fr}->${tc},${tr})`;
      break;
    }
    const nota = genNotationServer(pieces, p, [fc, fr], [tc, tr]);
    const cap = pieces.find(x => x.alive && x.col === tc && x.row === tr && x !== p);
    tokens.push(nota);
    exact.push({ from: [fc, fr], to: [tc, tr], notation: nota });
    if (cap) cap.alive = false;
    p.col = tc; p.row = tr;
    side = side === 'r' ? 'b' : 'r';
  }
  return { exactMoves: exact, tokens, valid, reason, plies: exact.length };
}

// 自動將既有非中文座標格式（如 砲7,7-4,7）全面轉換為標準中文記譜（如 炮二平五）
function migrateDbToChinese() {
  let migrated = 0;
  for (const g of db.games) {
    const hasCoordTokens = Array.isArray(g.tokens) && g.tokens.some(t => /^\w?\d,\d-\d,\d$/.test(String(t)));
    const notChinese = !g.tokens || !g.tokens.length || !g.tokens.some(t => /[平進进退]/.test(String(t)));
    if (hasCoordTokens || notChinese) {
      let newTokens = [];
      let newExact = [];
      if (g.dpxqBinit && g.dpxqMovelist) {
        const dec = decodeMoves(g.dpxqBinit, g.dpxqMovelist);
        if (dec.valid && dec.tokens.length) {
          newTokens = dec.tokens;
          newExact = dec.exactMoves;
        }
      }
      if (!newTokens.length && Array.isArray(g.exactMoves) && g.exactMoves.length) {
        const pieces = decodeBinit(g.dpxqBinit || DEFAULT_BINIT);
        const exact = [];
        for (const mv of g.exactMoves) {
          const fc = mv.from ? mv.from[0] : mv.fc;
          const fr = mv.from ? mv.from[1] : mv.fr;
          const tc = mv.to ? mv.to[0] : mv.tc;
          const tr = mv.to ? mv.to[1] : mv.tr;
          const mover = pieces.find(p => p.alive && p.col === fc && p.row === fr);
          if (!mover) break;
          const nota = genNotationServer(pieces, mover, [fc, fr], [tc, tr]);
          newTokens.push(nota);
          exact.push({ from: [fc, fr], to: [tc, tr], notation: nota });
          const cap = pieces.find(p => p.alive && p.col === tc && p.row === tr && p !== mover);
          if (cap) cap.alive = false;
          mover.col = tc; mover.row = tr;
        }
        if (newTokens.length >= 2) {
          newExact = exact;
        }
      }
      if (newTokens.length >= 2) {
        g.tokens = newTokens;
        g.moves = newTokens;
        if (newExact.length) {
          g.exactMoves = newExact;
        }
        migrated++;
      }
    }
  }
  // 全面校正：確保所有棋譜的 moves 皆為標準中文記譜字串陣列（非帶座標對象）
  for (const g of db.games) {
    if (Array.isArray(g.tokens) && g.tokens.length) {
      const isMovesObj = Array.isArray(g.moves) && g.moves.length && typeof g.moves[0] === 'object';
      if (isMovesObj || !Array.isArray(g.moves) || !g.moves.length) {
        g.moves = g.tokens.map(t => typeof t === 'string' ? t : (t.notation || String(t)));
        migrated++;
      }
    }
  }
  if (migrated > 0) {
    console.log(`[DB] 已成功將 ${migrated} 盤棋譜的著法全面轉為標準中文記譜！`);
    save();
  }
}
try { migrateDbToChinese(); } catch(e) { console.error('migrateDbToChinese error:', e); }

function classifyOpening(tokens) {
  if (!Array.isArray(tokens) || !tokens.length) return '自選開局';
  const early15 = tokens.slice(0, 15).map(x => String(x || ''));
  const first = early15[0] || '';
  const isCenter = first.includes('7,7-4,7') || first.includes('1,7-4,7') || /^[砲炮][二八28]平[五5]/.test(first);

  if (isCenter) {
    const blk = early15.filter((_, i) => i % 2 === 1);
    const red = early15.filter((_, i) => i % 2 === 0);
    if (blk.some(m => m.includes('1,2-4,2') || /^[砲炮][88八]平[5五]/.test(m))) return '中砲對順手砲';
    if (blk.some(m => m.includes('7,2-4,2') || /^[砲炮][22二]平[5五]/.test(m))) return '中炮對列手砲';
    if (blk.some(m => m.includes('7,2-7,6') || m.includes('1,2-1,6') || /^[砲炮][28二八]進[4四]/.test(m))) return '左砲封車';
    if (blk.some(m => m.includes('7,2-8,2') || m.includes('1,2-0,2') || /^[砲炮][28二八]平[19一九]/.test(m))) return '中砲對三步虎';
    if (blk.some(m => m.includes('7,2-5,2') || m.includes('1,2-3,2') || /^[砲炮][28二八]平[46四六]/.test(m))) return '中砲對反宮馬';
    if (blk.some(m => m.includes('7,0-8,2') || m.includes('1,0-0,2') || /^馬[28二八]進[19一九]/.test(m))) return '中砲對單提馬';
    if (blk.some(m => m.includes('7,2-7,4') || m.includes('1,2-1,4') || /^[砲炮][28二八]進[2二]/.test(m))) return '中砲對巡河砲';
    if (blk.some(m => m.includes('6,0-4,2') || m.includes('2,0-4,2') || /^[相象][37三七]進[5五]/.test(m))) return '中砲對飛象局';
    if (blk.some(m => m.includes('7,0-6,2') || m.includes('1,0-2,2') || /^馬[28二八]進[37三七]/.test(m))) return '中砲對屏風馬';
    if (red.some(m => m.includes('1,7-2,7') || m.includes('7,7-6,7') || /^[砲炮][二八28]平[三七37]/.test(m))) return '中砲五七炮進三兵';
    return '中砲對屏風馬';
  }

  if (first.includes('6,6-6,5') || first.includes('2,6-2,5') || /^兵[三七37]進[1一]/.test(first)) {
    const second = early15[1] || '';
    if (second.includes('7,2-6,2') || second.includes('1,2-2,2') || /^[砲炮][28二八]平[37三七]/.test(second)) return '先手仙人指路對卒底炮';
    return '仙人指路（先手起手式）';
  }
  if (first.includes('6,9-4,7') || first.includes('2,9-4,7') || /^[相象][三七37]進[5五]/.test(first)) {
    const second = early15[1] || '';
    if (second.includes('1,2-4,2') || second.includes('7,2-4,2') || /^[砲炮][28二八]平[5五]/.test(second)) return '中砲對飛象局';
    return '飛相局';
  }
  if (first.includes('7,9-6,7') || first.includes('1,9-2,7') || /^馬[二八28]進[三七37]/.test(first)) return '起馬局';
  if (first.includes('7,7-5,7') || first.includes('1,7-3,7') || /^[砲炮][二八28]平[四六46]/.test(first)) return '先手反宮馬（士角砲開局）';
  if (first.includes('7,7-3,7') || first.includes('1,7-5,7') || /^[砲炮][二八28]平[六四64]/.test(first)) return '過宮砲';
  return '自選開局';
}

function htmlDecode(s) {
  return String(s || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function strip(s) {
  return htmlDecode(String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function tag(text, name) {
  const re = new RegExp('\\[DhtmlXQ_' + name + '\\]([\\s\\S]*?)(?:\\[\\/DhtmlXQ_' + name + '\\]|(?=\\[DhtmlXQ_|$))', 'i');
  const m = String(text || '').match(re);
  return m ? htmlDecode(m[1].trim()) : '';
}

function parseDhtml(html) {
  const text = String(html || '');
  const blocks = [];
  const wrapped = text.match(/\[DhtmlXQ\][\s\S]*?\[\/DhtmlXQ\]/gi) || [text];

  let scriptMovelist = '';
  const moveMatch = text.match(/\[DhtmlXQ_movelist\]([0-9]+)\[\/DhtmlXQ_movelist\]/i) || text.match(/DhtmlXQ_movelist\s*=\s*['"](?:\[DhtmlXQ_movelist\])?([0-9]+)/i);
  if (moveMatch) {
    scriptMovelist = moveMatch[1];
  }

  for (const b of wrapped) {
    const get = n => tag(b, n);
    const movelist = get('movelist') || scriptMovelist;
    const binit = get('binit') || DEFAULT_BINIT;
    const red = get('redname') || get('red');
    const black = get('blackname') || get('black');
    if (!(movelist || binit || red || black)) continue;
    const d = get('date');
    const dm = d.match(/(19|20)\d{2}/);
    const dec = movelist ? decodeMoves(binit, movelist) : { exactMoves: [], tokens: [], valid: false, reason: '缺少 movelist', plies: 0 };
    blocks.push({
      red: red || '未知紅方',
      black: black || '未知黑方',
      result: get('result') || '未知',
      event: get('event') || get('class') || '',
      year: dm ? +dm[0] : null,
      date: d || '',
      round: get('round') || '',
      place: get('place') || '',
      opening: get('open') || '',
      binit,
      movelist,
      fen: get('fen') || '',
      dec
    });
  }
  return blocks;
}

function parseWxf(text) {
  const clean = strip(text);
  const m = clean.match(/(?:前|中|後)?[車车馬马炮砲相象仕士帥帅將将兵卒][一二三四五六七八九1-9](?:平|進|退)[一二三四五六七八九1-9]/g) || [];
  return [...new Set(m)];
}

function extractExport(html) {
  const blocks = parseDhtml(html);
  const wxf = parseWxf(html);
  return { blocks, wxf };
}

function normalizeDpxqUrl(url) {
  let u = String(url || '').trim();
  if (/^https:\/\/((www\.)?dpxq\.com)/i.test(u)) u = 'http://' + u.replace(/^https:\/\//i, '');
  if (!/^http:\/\/((www\.)?dpxq\.com)\//i.test(u)) throw new Error('只允許 http://www.dpxq.com/ 公開網址');
  return u;
}

const DPXQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'http://www.dpxq.com/hldcg/search/search.htm',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

async function fetchDpxqHtml(url) {
  const res = await fetch(url, { headers: DPXQ_HEADERS });
  if (!res.ok) throw new Error(`東萍伺服器回應錯誤 HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return iconv.decode(Buffer.from(buf), 'gbk');
}

async function fetchWithBrowser(url) {
  url = normalizeDpxqUrl(url);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    const page = await browser.newPage({ locale: 'zh-TW' });
    page.setDefaultTimeout(10000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(500);
    let downloads = [];
    page.on('download', d => downloads.push(d));
    const exportLoc = page.getByText(/棋譜自動導出|棋谱自动导出|棋譜導出|棋谱导出|導出|导出/).first();
    if (await exportLoc.count()) {
      try {
        await exportLoc.click({ timeout: 3000 });
        await page.waitForTimeout(700);
      } catch { }
    }
    const content = await page.content();
    let exportText = '';
    if (downloads.length) {
      try {
        exportText = await downloads[0].createReadStream().then(async rs => {
          const chunks = [];
          for await (const c of rs) chunks.push(c);
          return Buffer.concat(chunks).toString('utf8');
        });
      } catch { }
    }
    return { content, exportText, finalUrl: page.url(), title: await page.title() };
  } finally {
    await browser.close();
  }
}

let syncJob = null;
function emitProgress(p) {
  if (syncJob) syncJob = { ...syncJob, ...p };
  io.emit('dpxq:progress', syncJob);
}

async function importOne(url) {
  url = normalizeDpxqUrl(url);
  let html = '';
  try {
    html = await fetchDpxqHtml(url);
  } catch {
    const r = await fetchWithBrowser(url);
    html = r.exportText || r.content;
  }

  const { blocks, wxf } = extractExport(html);
  if (blocks.length) {
    const results = [];
    for (const b of blocks) {
      const d = b.dec;
      const g = {
        red: b.red,
        black: b.black,
        result: b.result,
        event: b.event,
        year: b.year,
        date: b.date,
        round: b.round,
        place: b.place,
        opening: b.opening || classifyOpening(d.tokens),
        tokens: d.tokens,
        exactMoves: d.exactMoves,
        moves: d.tokens,
        source: 'dpxq-sync',
        sourceUrl: 'http://www.dpxq.com/',
        detailUrl: url,
        format: 'DhtmlXQ',
        fen: b.fen,
        dpxqBinit: b.binit,
        dpxqMovelist: b.movelist,
        rawExport: html,
        validation: d.valid ? `OK ${d.plies} plies` : d.reason
      };
      results.push(addGame(g));
    }
    return { results, blocks: blocks.length, wxf };
  }

  // 若此頁面為搜尋結果列表，擷取其中棋譜網址並載入第一盤
  const idMatches = [...html.matchAll(/javascript:view\(['"]?(owner=\w+&id=\d+)/gi)];
  if (idMatches.length) {
    const firstGameUrl = `http://www.dpxq.com/hldcg/search/view.asp?${idMatches[0][1]}`;
    return importOne(firstGameUrl);
  }

  if (wxf.length) {
    const g = {
      red: '未知紅方',
      black: '未知黑方',
      tokens: wxf,
      opening: classifyOpening(wxf),
      moves: [],
      exactMoves: [],
      source: 'dpxq-sync',
      detailUrl: url,
      format: 'WXF',
      rawExport: html,
      validation: '僅取得 WXF 文字，尚未轉成座標'
    };
    return { results: [addGame(g)], blocks: 0, wxf };
  }

  throw new Error('已開啟東萍頁面，但沒有找到 DhtmlXQ / WXF 棋譜資料');
}

app.get('/api/health', (q, s) => s.json({ ok: true, service: 'xiangqi-web-suite', version: APP_VERSION, displayVersion: DISPLAY_VERSION, storage: 'json', maxPages: MAX_PLAYER_PAGES, maxGames: MAX_PLAYER_GAMES, time: new Date().toISOString() }));
app.get('/api/stats', (q, s) => s.json({ players: db.players.length, games: db.games.length, playableGames: db.games.filter(g => g.exactMoves?.length || g.moves?.length).length }));

app.get('/api/players', (q, s) => {
  const term = String(q.query.q || '').trim().toLowerCase();
  const items = db.players.filter(p => !term || p.name.toLowerCase().includes(term) || toSimp(p.name).toLowerCase().includes(toSimp(term))).map(p => ({
    ...p,
    games: db.games.filter(g => g.red === p.name || g.black === p.name || toSimp(g.red) === toSimp(p.name) || toSimp(g.black) === toSimp(p.name)).length
  })).sort((a, b) => b.games - a.games);
  s.json({ items, total: items.length });
});

function sanitizeGame(g) {
  if (!g) return g;
  const toks = Array.isArray(g.tokens) ? g.tokens : [];
  const rawMoves = Array.isArray(g.moves) ? g.moves : [];
  const cleanMoves = (toks.length ? toks : rawMoves).map(m => typeof m === 'string' ? m : (m && m.notation ? m.notation : '')).filter(Boolean);
  return {
    ...g,
    tokens: toks.length ? toks : cleanMoves,
    moves: cleanMoves
  };
}

app.get('/api/players/:name', (q, s) => {
  const name = decodeURIComponent(q.params.name);
  const p = db.players.find(x => x.name === name || toSimp(x.name) === toSimp(name));
  if (!p) return s.status(404).json({ error: '找不到棋手' });
  const games = db.games.filter(g => g.red === p.name || g.black === p.name || toSimp(g.red) === toSimp(p.name) || toSimp(g.black) === toSimp(p.name)).sort((a, b) => (b.year || 0) - (a.year || 0) || b.id - a.id);
  let wins = 0, losses = 0, draws = 0;
  for (const g of games) {
    const isRed = g.red === p.name || toSimp(g.red) === toSimp(p.name);
    if (/和/.test(g.result || '')) draws++;
    else if (/^紅|^红/.test(g.result || '')) isRed ? wins++ : losses++;
    else if (/^黑/.test(g.result || '')) !isRed ? wins++ : losses++;
  }
  s.json({ player: { ...p, games: games.length }, games: games.map(sanitizeGame), stats: { games: games.length, wins, losses, draws, winRate: (wins + losses + draws) ? Number((wins / (wins + losses + draws) * 100).toFixed(1)) : 0 } });
});

app.get('/api/games', (q, s) => {
  try {
    const { q: term = '', player = '', opening = '', year = '', playable = '' } = q.query;
    const termStr = String(term || '').trim();
    const playerStr = String(player || '').trim();
    const openingStr = String(opening || '').trim();
    const yearStr = String(year || '').trim();

    let a = (db.games || []).filter(g => {
      if (!g) return false;
      if (termStr) {
        const toksStr = Array.isArray(g.tokens) ? g.tokens.join(' ') : '';
        const fields = [g.red, g.black, g.event, g.opening, toksStr];
        const hit = fields.some(x => {
          const str = String(x || '');
          return str.includes(termStr) || toSimp(str).includes(toSimp(termStr));
        });
        if (!hit) return false;
      }
      if (playerStr) {
        const r = String(g.red || '');
        const b = String(g.black || '');
        const hit = (r === playerStr || b === playerStr || toSimp(r) === toSimp(playerStr) || toSimp(b) === toSimp(playerStr));
        if (!hit) return false;
      }
      if (openingStr && String(g.opening || '') !== openingStr) return false;
      if (yearStr && String(g.year || '') !== yearStr) return false;
      if (playable && (!((g.exactMoves?.length || g.moves?.length) > 0))) return false;
      return true;
    });
    s.json({ items: a.sort((x, y) => (y.id || 0) - (x.id || 0)).slice(0, 1000).map(sanitizeGame), total: a.length });
  } catch(err) {
    console.error('API /api/games error:', err);
    s.status(500).json({ error: '獲取棋譜失敗：' + err.message, items: [], total: 0 });
  }
});

app.get('/api/games/:id', (q, s) => {
  try {
    const g = db.games.find(x => String(x.id) === String(q.params.id));
    if (!g) return s.status(404).json({ error: '找不到棋譜' });
    s.json(sanitizeGame(g));
  } catch(err) {
    s.status(500).json({ error: err.message });
  }
});

app.post('/api/games', (q, s) => {
  const r = addGame(q.body || {});
  s.status(r.duplicate ? 200 : 201).json({ ok: true, duplicate: r.duplicate, game: sanitizeGame(r.game) });
});

app.patch('/api/games/:id', (q, s) => {
  const g = db.games.find(x => String(x.id) === String(q.params.id));
  if (!g) return s.status(404).json({ error: '找不到棋譜' });
  if (q.body.opening !== undefined) g.opening = String(q.body.opening || '').trim();
  if (q.body.red !== undefined) g.red = String(q.body.red || '').trim();
  if (q.body.black !== undefined) g.black = String(q.body.black || '').trim();
  if (q.body.result !== undefined) g.result = String(q.body.result || '').trim();
  if (q.body.event !== undefined) g.event = String(q.body.event || '').trim();
  save();
  s.json({ ok: true, game: g });
});

app.get('/api/dpxq/source', (q, s) => s.json({ name: '東萍象棋網', url: DPXQ_BASE, policy: `只同步預設大師或使用者搜尋的棋手；不做全站同步。預設最多 ${MAX_PLAYER_PAGES} 頁、${MAX_PLAYER_GAMES} 盤。` }));
app.get('/api/dpxq/masters', (q, s) => s.json({ items: MASTER_PLAYERS, baseUrl: DPXQ_BASE, maxPages: MAX_PLAYER_PAGES, maxGames: MAX_PLAYER_GAMES }));
app.get('/api/dpxq/progress', (q, s) => s.json(syncJob || { running: false }));

async function handleDpxqTest(q, s) {
  const t0 = Date.now();
  try {
    const rawUrl = q.body?.url || q.query?.url || DPXQ_BASE;
    const url = normalizeDpxqUrl(rawUrl);
    const html = await fetchDpxqHtml(url);
    const ms = Date.now() - t0;
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? htmlDecode(titleMatch[1].trim()) : '東萍象棋網';
    const indexGames = (html.match(/view\(['"]?owner=/gi) || []).length;
    const dhtmlxqBlocks = (html.match(/\[DhtmlXQ_movelist\]/gi) || []).length;
    s.json({
      ok: true,
      title,
      url,
      ms,
      indexGames,
      dhtmlxqBlocks,
      message: `連線成功 (${ms}ms)，取得頁面標題：${title}`
    });
  } catch (e) {
    s.status(502).json({ ok: false, error: e.message });
  }
}
app.get('/api/dpxq/test', handleDpxqTest);
app.post('/api/dpxq/test', handleDpxqTest);

async function discoverPlayerPages(player, maxPages = MAX_PLAYER_PAGES, maxGames = MAX_PLAYER_GAMES) {
  const simpPlayer = toSimp(player);
  const foundUrls = [];
  const seen = new Set();
  const owners = ['大师对局', ''];

  for (const owner of owners) {
    for (const side of ['red', 'black']) {
      for (let page = 1; page <= maxPages; page++) {
        if (foundUrls.length >= maxGames) break;
        const redVal = side === 'red' ? simpPlayer : '';
        const blackVal = side === 'black' ? simpPlayer : '';
        const qs = `site=www.dpxq.com&owner=${gbkEncodeUrl(owner)}&e=&p=&red=${gbkEncodeUrl(redVal)}&black=${gbkEncodeUrl(blackVal)}&result=&title=&date=&class=&event=&open=&order=&page=${page}`;
        const searchUrl = `http://www.dpxq.com/hldcg/search/search.asp?${qs}`;

        try {
          const html = await fetchDpxqHtml(searchUrl);
          const idMatches = [...html.matchAll(/javascript:view\(['"]?(owner=\w+&id=\d+)/gi)];
          if (!idMatches.length) break;

          let newCount = 0;
          for (const m of idMatches) {
            const u = `http://www.dpxq.com/hldcg/search/view.asp?${m[1]}`;
            if (!seen.has(u)) {
              seen.add(u);
              foundUrls.push(u);
              newCount++;
              if (foundUrls.length >= maxGames) break;
            }
          }
          if (newCount === 0) break;
        } catch {
          break;
        }
      }
      if (foundUrls.length >= maxGames) break;
    }
    if (foundUrls.length > 0) break;
  }

  return foundUrls.slice(0, maxGames);
}

async function syncPlayer(player) {
  player = String(player || '').trim();
  if (!player) throw new Error('請提供棋手姓名');

  emitProgress({ message: `正在搜尋 ${player} 的棋譜（最多 ${MAX_PLAYER_PAGES} 頁／${MAX_PLAYER_GAMES} 盤）…` });
  const urls = await discoverPlayerPages(player, MAX_PLAYER_PAGES, MAX_PLAYER_GAMES);
  if (!urls.length) throw new Error(`東萍搜尋頁沒有找到「${player}」的可用棋譜連結`);

  let added = 0, duplicates = 0, errors = 0, processed = 0;
  const results = [];

  for (let i = 0; i < urls.length; i++) {
    if (processed >= MAX_PLAYER_GAMES) break;
    const u = urls[i];
    emitProgress({
      processed,
      total: urls.length,
      added,
      duplicates,
      errors,
      message: `同步 ${player} 中：第 ${i + 1}/${urls.length} 盤 (${added} 新增, ${duplicates} 重複)`
    });

    try {
      const r = await importOne(u);
      for (const x of r.results || []) {
        processed++;
        if (x.duplicate) duplicates++;
        else added++;
        results.push(x);
        if (processed >= MAX_PLAYER_GAMES) break;
      }
    } catch (e) {
      errors++;
      results.push({ ok: false, url: u, error: e.message });
    }
  }

  ensurePlayer(player);
  save();
  return { player, pagesChecked: MAX_PLAYER_PAGES, discovered: urls.length, processed, added, duplicates, errors, results };
}

app.post('/api/dpxq/sync/start', async (q, s) => {
  if (syncJob?.running) return s.status(409).json({ error: '已有同步工作執行中' });
  const player = String(q.body?.player || '').trim();
  const maxPages = Math.min(100, Math.max(1, Number(q.body?.maxPages || MAX_PLAYER_PAGES)));
  const url = normalizeDpxqUrl(q.body?.url || DPXQ_BASE);

  syncJob = {
    status: 'running',
    running: true,
    progress: 10,
    mode: player ? 'player' : 'url',
    player,
    url,
    maxPages,
    pagesDone: 0,
    found: 0,
    detailDone: 0,
    detailTotal: 0,
    processed: 0,
    added: 0,
    updated: 0,
    duplicates: 0,
    playable: 0,
    errors: 0,
    message: player ? `準備同步「${player}」棋譜（最多 ${maxPages} 頁）…` : '準備自動分頁同步…'
  };
  emitProgress({});
  s.json({ ok: true, stats: syncJob });

  (async () => {
    try {
      if (player) {
        const r = await syncPlayer(player);
        Object.assign(syncJob, {
          status: 'done',
          running: false,
          progress: 100,
          added: r.added,
          updated: r.duplicates,
          duplicates: r.duplicates,
          playable: r.added,
          errors: r.errors,
          processed: r.processed,
          found: r.discovered,
          detailDone: r.processed,
          detailTotal: r.discovered,
          message: `${player} 同步完成：新增 ${r.added}、重複/更新 ${r.duplicates}、失敗 ${r.errors}`
        });
      } else {
        const r = await importOne(url);
        const rr = r.results || [];
        const added = rr.filter(x => !x.duplicate).length;
        const dups = rr.filter(x => x.duplicate).length;
        Object.assign(syncJob, {
          status: 'done',
          running: false,
          progress: 100,
          added,
          updated: dups,
          duplicates: dups,
          playable: added,
          errors: 0,
          processed: rr.length,
          found: rr.length,
          detailDone: rr.length,
          detailTotal: rr.length,
          message: `同步完成：新增 ${added}、重複/更新 ${dups}`
        });
      }
      emitProgress({});
    } catch (e) {
      Object.assign(syncJob, {
        status: 'error',
        running: false,
        error: e.message,
        message: e.message
      });
      emitProgress({});
    }
  })();
});

app.get('/api/dpxq/sync/status', (q, s) => {
  if (!syncJob) return s.json({ status: 'idle', progress: 0, message: '尚未開始同步' });
  const pct = syncJob.running
    ? (syncJob.detailTotal ? Math.min(95, Math.round((syncJob.detailDone / syncJob.detailTotal) * 100)) : (syncJob.progress || 10))
    : (syncJob.status === 'done' ? 100 : 0);
  s.json({
    status: syncJob.status || (syncJob.running ? 'running' : 'idle'),
    progress: pct,
    pagesDone: syncJob.pagesDone || 0,
    maxPages: syncJob.maxPages || MAX_PLAYER_PAGES,
    found: syncJob.found || syncJob.processed || 0,
    detailDone: syncJob.detailDone || syncJob.processed || 0,
    detailTotal: syncJob.detailTotal || syncJob.processed || 0,
    added: syncJob.added || 0,
    updated: syncJob.updated || syncJob.duplicates || 0,
    playable: syncJob.playable || syncJob.added || 0,
    errors: syncJob.errors || 0,
    player: syncJob.player || '',
    currentUrl: syncJob.url || '',
    message: syncJob.message || '',
    error: syncJob.error || ''
  });
});

app.post('/api/dpxq/sync/cancel', (q, s) => {
  if (syncJob) {
    syncJob.running = false;
    syncJob.status = 'cancelled';
    syncJob.message = '使用者已手動停止同步';
    emitProgress({});
  }
  s.json({ ok: true });
});

app.post('/api/dpxq/sync-player', async (q, s) => {
  if (syncJob?.running) return s.status(409).json({ error: '已有同步工作執行中' });
  const player = String(q.body?.player || '').trim();
  if (!player) return s.status(400).json({ error: '請提供棋手姓名' });

  syncJob = {
    running: true,
    mode: 'player',
    player,
    processed: 0,
    added: 0,
    duplicates: 0,
    errors: 0,
    pages: 0,
    message: `準備同步 ${player}（最多 ${MAX_PLAYER_PAGES} 頁／${MAX_PLAYER_GAMES} 盤）`
  };
  emitProgress({});

  try {
    const r = await syncPlayer(player);
    Object.assign(syncJob, r, {
      running: false,
      message: `${player} 完成：新增 ${r.added}、重複 ${r.duplicates}、失敗 ${r.errors}`
    });
    emitProgress({});
    s.json({ ok: true, stats: syncJob, results: r.results });
  } catch (e) {
    syncJob.running = false;
    syncJob.errors = (syncJob.errors || 0) + 1;
    syncJob.message = e.message;
    emitProgress({});
    s.status(502).json({ ok: false, stats: syncJob, error: e.message });
  }
});

app.post('/api/dpxq/import', async (q, s) => {
  if (syncJob?.running) return s.status(409).json({ error: '已有同步工作執行中' });
  const url = normalizeDpxqUrl(q.body?.url);
  if (!url) return s.status(400).json({ error: '請提供東萍網址' });

  syncJob = { running: true, url, processed: 0, added: 0, duplicates: 0, errors: 0, message: '開啟東萍中…' };
  emitProgress({});

  try {
    let last;
    for (let i = 1; i <= 3; i++) {
      try {
        syncJob.message = `第 ${i}/3 次：開啟東萍並解析棋譜`;
        emitProgress({});
        last = await importOne(url);
        break;
      } catch (e) {
        syncJob.errors++;
        syncJob.message = e.message;
        if (i < 3) await new Promise(r => setTimeout(r, i * 1000));
        else throw e;
      }
    }
    const rr = last.results || [];
    syncJob.processed = rr.length;
    syncJob.added = rr.filter(x => !x.duplicate).length;
    syncJob.duplicates = rr.filter(x => x.duplicate).length;
    syncJob.running = false;
    syncJob.message = `完成：新增 ${syncJob.added}、重複 ${syncJob.duplicates}、錯誤 ${syncJob.errors}`;
    emitProgress({});
    s.json({ ok: true, stats: syncJob, results: rr });
  } catch (e) {
    syncJob.running = false;
    syncJob.message = e.message;
    emitProgress({});
    s.status(502).json({ ok: false, stats: syncJob, error: e.message });
  }
});

app.get('/api/opening/classify', (q, s) => s.json({ opening: classifyOpening(String(q.query.moves || '').split(/\s+/)) }));

// Express 5：SPA fallback
app.use((req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

server.listen(PORT, '0.0.0.0', () => console.log(`xiangqi-web-suite ${DISPLAY_VERSION} listening on ${PORT}`));

