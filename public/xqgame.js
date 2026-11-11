/* 象棋規則、中文棋譜與影片追蹤器（瀏覽器／Node 共用）
 * 座標同 xq_core.py：b[r][c]，r=0 黑方底線、r=9 紅方底線；大寫紅、小寫黑。
 */
(function (root) {
  const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
  const RED = { K: '帥', A: '仕', B: '相', N: '馬', R: '車', C: '炮', P: '兵' };
  const BLK = { k: '將', a: '士', b: '象', n: '馬', r: '車', c: '炮', p: '卒' };
  const CN = '零一二三四五六七八九';
  const LIMIT = { K: 1, A: 2, B: 2, N: 2, R: 2, C: 2, P: 5 };
  const isUp = p => p && p === p.toUpperCase();

  function fromFen(fen) {
    const [pl, t] = fen.split(' ');
    const b = pl.split('/').map(row => { const l = []; for (const ch of row) { if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) l.push(null); else l.push(ch); } return l; });
    return { b, turn: t === 'b' ? 'b' : 'w' };
  }
  function toFen(pos) {
    return pos.b.map(row => { let s = '', e = 0; for (const p of row) { if (!p) e++; else { if (e) { s += e; e = 0; } s += p; } } return s + (e ? e : ''); }).join('/') + ' ' + pos.turn + ' - - 0 1';
  }
  const copy = pos => ({ b: pos.b.map(r => r.slice()), turn: pos.turn });
  function make(pos, mv) {
    const q = copy(pos), [[r1, c1], [r2, c2]] = mv;
    q.b[r2][c2] = q.b[r1][c1]; q.b[r1][c1] = null; q.turn = pos.turn === 'w' ? 'b' : 'w'; return q;
  }
  function pseudo(pos, side) {
    const b = pos.b, mine = p => p && (side === 'w' ? isUp(p) : !isUp(p)), res = [];
    for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
      const p = b[r][c]; if (!mine(p)) continue;
      const t = p.toUpperCase(), tg = [];
      if (t === 'R' || t === 'C') {
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let rr = r + dr, cc = c + dc, j = false;
          while (rr >= 0 && rr < 10 && cc >= 0 && cc < 9) {
            const q = b[rr][cc];
            if (t === 'R') { if (!q) tg.push([rr, cc]); else { if (!mine(q)) tg.push([rr, cc]); break; } }
            else if (!j) { if (!q) tg.push([rr, cc]); else j = true; }
            else if (q) { if (!mine(q)) tg.push([rr, cc]); break; }
            rr += dr; cc += dc;
          }
        }
      } else if (t === 'N') {
        for (const [dr, dc, lr, lc] of [[2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0], [1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1]]) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < 10 && cc >= 0 && cc < 9 && !b[r + lr][c + lc]) tg.push([rr, cc]);
        }
      } else if (t === 'B') {
        for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr > 9 || cc < 0 || cc > 8) continue;
          if (side === 'w' ? rr < 5 : rr > 4) continue;
          if (!b[r + dr / 2][c + dc / 2]) tg.push([rr, cc]);
        }
      } else if (t === 'A' || t === 'K') {
        const ds = t === 'A' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dr, dc] of ds) { const rr = r + dr, cc = c + dc; if (cc >= 3 && cc <= 5 && (side === 'w' ? rr >= 7 && rr <= 9 : rr >= 0 && rr <= 2)) tg.push([rr, cc]); }
      } else if (t === 'P') {
        const rr = r + (side === 'w' ? -1 : 1); if (rr >= 0 && rr < 10) tg.push([rr, c]);
        if (side === 'w' ? r <= 4 : r >= 5) for (const cc of [c - 1, c + 1]) if (cc >= 0 && cc < 9) tg.push([r, cc]);
      }
      for (const [rr, cc] of tg) if (!mine(b[rr][cc])) res.push([[r, c], [rr, cc]]);
    }
    return res;
  }
  function findKing(pos, side) { const k = side === 'w' ? 'K' : 'k'; for (let r = 0; r < 10; r++) for (let c = 3; c < 6; c++) if (pos.b[r][c] === k) return [r, c]; return null; }
  function inCheck(pos, side) {
    const kp = findKing(pos, side); if (!kp) return true;
    const other = side === 'w' ? 'b' : 'w', ok = findKing(pos, other);
    if (ok && ok[1] === kp[1]) { const lo = Math.min(ok[0], kp[0]), hi = Math.max(ok[0], kp[0]); let clear = true; for (let r = lo + 1; r < hi; r++) if (pos.b[r][kp[1]]) { clear = false; break; } if (clear) return true; }
    return pseudo(pos, other).some(m => m[1][0] === kp[0] && m[1][1] === kp[1]);
  }
  function legal(pos, side) { side = side || pos.turn; const p2 = { b: pos.b, turn: side }; return pseudo(p2, side).filter(m => !inCheck(make(p2, m), side)); }
  function moveCn(pos, mv) {
    const [[r1, c1], [r2, c2]] = mv, p = pos.b[r1][c1], red = isUp(p), name = red ? RED[p] : BLK[p];
    const fnum = c => red ? 9 - c : c + 1, num = n => red ? CN[n] : String(n);
    const same = []; for (let r = 0; r < 10; r++) if (pos.b[r][c1] === p) same.push(r);
    let prefix = null;
    if (same.length >= 2) {
      const order = red ? same : same.slice().reverse(), i = order.indexOf(r1);
      prefix = order.length === 2 ? (i === 0 ? '前' : '後') : order.length === 3 ? '前中後'[i] : (red ? CN[i + 1] : String(i + 1));
    }
    const head = prefix ? prefix + name : name + num(fnum(c1));
    let act, n;
    if (r1 === r2) { act = '平'; n = fnum(c2); }
    else { act = ((red ? r2 < r1 : r2 > r1) ? '進' : '退'); n = 'NBA'.includes(p.toUpperCase()) ? fnum(c2) : Math.abs(r2 - r1); }
    return head + act + num(n);
  }
  function isMate(pos) { return legal(pos).length === 0; }
  function sane(pos) {
    const cnt = {};
    for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
      const p = pos.b[r][c]; if (!p) continue;
      if (!squareOk(p, r, c)) return false;
      cnt[p] = (cnt[p] || 0) + 1; if (cnt[p] > LIMIT[p.toUpperCase()]) return false;
    }
    return cnt.K === 1 && cnt.k === 1;
  }
  function squareOk(p, r, c) {
    const t = p.toUpperCase(), red = isUp(p);
    if (t === 'K' || t === 'A') { if (c < 3 || c > 5) return false; if (red ? r < 7 : r > 2) return false; if (t === 'A' && (r + c) % 2 !== (red ? 0 : 1) ) return false; }
    if (t === 'B') { const ok = red ? [[9, 2], [9, 6], [7, 0], [7, 4], [7, 8], [5, 2], [5, 6]] : [[0, 2], [0, 6], [2, 0], [2, 4], [2, 8], [4, 2], [4, 6]]; if (!ok.some(([a, b]) => a === r && b === c)) return false; }
    if (t === 'P') { if (red ? r > 6 : r < 3) return false; if ((red ? r >= 5 : r <= 4) && c % 2 === 1) return false; }
    return true;
  }
  function rowsToPos(rows, turn) {
    const b = rows.map(s => Array.from(s).map(ch => (ch === '.' || ch === 'x') ? null : ch));
    return { b, turn: turn || 'w' };
  }
  function mismatch(rows, pos) {
    let d = 0;
    for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) { const o = rows[r][c]; if (o === 'x') continue; const p = pos.b[r][c] || '.'; if (o !== p) d++; }
    return d;
  }
  const hiddenCount = rows => rows.reduce((n, s) => n + (s.match(/x/g) || []).length, 0);
  function sameObs(a, b) { if (!a || !b) return false; for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) { const x = a[r][c], y = b[r][c]; if (x !== 'x' && y !== 'x' && x !== y) return false; } return true; }

  /* 追蹤器：每個取樣畫面餵一次 rows（模型 10 列字串）。
   * 一盤＝一個 segment：{startFen, moves:[{mv,cn,t}], branch}。
   *  - 畫面穩定（連續 2 次相同）才判斷。
   *  - 一步合法著法能解釋 → 記下；漏看一次（兩步）也能補。
   *  - 回到上一步局面 → 視為退回示範（悔棋）。
   *  - 回到開局 → 新的一盤；擺出其他合理局面（穩定 3 次）→ 分支（擺局）。
   */
  class Tracker {
    constructor() { this.segs = []; this.cur = null; this.prev = null; this.stable = 0; this.takebacks = 0; this.start = fromFen(START_FEN); this.pending = null; }
    _newSeg(pos, t, setup) {
      if (this.cur && this.cur.moves.length === 0 && this.cur.setup === setup) { this.cur.startPos = copy(pos); this.cur.pos = copy(pos); this.cur.hist = [copy(pos)]; this.cur.t0 = t; return; }
      const seg = { startPos: copy(pos), pos: copy(pos), hist: [copy(pos)], moves: [], t0: t, setup, turnKnown: !setup };
      this.segs.push(seg); this.cur = seg;
    }
    _apply(mv, t, side) {
      const s = this.cur; if (!s.turnKnown) { s.pos.turn = side; s.startPos.turn = side; s.hist[0].turn = side; s.turnKnown = true; }
      const cn = moveCn(s.pos, mv); s.pos = make(s.pos, mv); s.hist.push(copy(s.pos)); s.moves.push({ mv, cn, t });
    }
    feed(rows, t) {
      if (hiddenCount(rows) > 12) return null;
      if (sameObs(rows, this.prev)) this.stable++; else this.stable = 1;
      this.prev = rows;
      if (this.stable < 2) return null;
      const s = this.cur;
      if (!s) {
        if (mismatch(rows, this.start) <= 2) { this._newSeg(this.start, t, false); return 'start'; }
        if (this.stable >= 3 && hiddenCount(rows) === 0) { const p = rowsToPos(rows); if (sane(p)) { this._newSeg(p, t, true); return 'setup'; } }
        return null;
      }
      const d0 = mismatch(rows, s.pos);
      if (d0 === 0) return null;
      // 退回上一步
      if (s.moves.length && mismatch(rows, s.hist[s.hist.length - 2]) === 0) {
        s.hist.pop(); s.moves.pop(); s.pos = copy(s.hist[s.hist.length - 1]); this.takebacks++; return 'takeback';
      }
      const sides = s.turnKnown ? [s.pos.turn] : ['w', 'b'];
      let best = null;
      for (const side of sides) for (const mv of legal(s.pos, side)) {
        const q = make({ b: s.pos.b, turn: side }, mv), d = mismatch(rows, q);
        if (!best || d < best.d) best = { d, mv, side, n: 1 }; else if (d === best.d) best.n++;
      }
      if (best && best.d === 0) { this._apply(best.mv, t, best.side); return 'move'; }
      // 同一方連走（老師示範、或之前漏看造成先後手錯位）：另一方一步就能完全對上
      if (s.turnKnown) {
        const other = s.pos.turn === 'w' ? 'b' : 'w';
        for (const mv of legal(s.pos, other)) if (mismatch(rows, make({ b: s.pos.b, turn: other }, mv)) === 0) {
          s.pos.turn = other; this._apply(mv, t, other); this.resync = (this.resync || 0) + 1; return 'move-resync';
        }
      }
      // 漏看：最多連續 3 步（每步的起點或落點必須是畫面與目前局面不同的格子）
      const diffCells = (q) => { const st = new Set(); for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) { const o = rows[r][c]; if (o !== 'x' && o !== (q.b[r][c] || '.')) st.add(r * 9 + c); } return st; };
      const dfs = (q, side, depth, path) => {
        const df = diffCells(q); if (df.size === 0) return path;
        if (depth === 0) return null;
        for (const mv of legal(q, side)) {
          if (!df.has(mv[0][0] * 9 + mv[0][1]) && !df.has(mv[1][0] * 9 + mv[1][1])) continue;
          const r = dfs(make({ b: q.b, turn: side }, mv), side === 'w' ? 'b' : 'w', depth - 1, path.concat([[mv, side]]));
          if (r) return r;
        }
        return null;
      };
      for (let depth = 2; depth <= 3; depth++) for (const side of sides) {
        const path = dfs(s.pos, side, depth, []);
        if (path && path.length >= 2) { for (const [mv, sd] of path) this._apply(mv, t, sd); return 'move' + path.length; }
      }
      // 容許一格誤讀（唯一最佳、且局面差異夠大）
      if (best && best.d === 1 && best.n === 1 && d0 >= 3) { this._apply(best.mv, t, best.side); return 'move'; }
      // 新的一盤或擺局
      if (mismatch(rows, this.start) <= 2) { if (s.moves.length) { this._newSeg(this.start, t, false); return 'newgame'; } return null; }
      if (this.stable >= 3 && hiddenCount(rows) === 0 && d0 >= 4) { const p = rowsToPos(rows); if (sane(p)) { this._newSeg(p, t, true); return 'setup'; } }
      return null;
    }
    games(minMoves) {
      minMoves = minMoves || 4;
      return this.segs.filter(g => g.moves.length >= minMoves).map(g => {
        const mate = isMate(g.pos);
        let win = null, reason = '未知（影片版沒有引擎判定）';
        if (mate) { win = g.pos.turn === 'w' ? 'b' : 'w'; reason = '將死／困斃'; }
        return { setup: g.setup, startFen: toFen(g.startPos), fen: toFen(g.pos), moves: g.moves.map(m => m.cn), times: g.moves.map(m => Math.round(m.t * 10) / 10), exact: g.moves.map(m => ({ from: [m.mv[0][1], m.mv[0][0]], to: [m.mv[1][1], m.mv[1][0]], notation: m.cn })), win, reason, t0: g.t0 };
      });
    }
  }
  const api = { START_FEN, fromFen, toFen, make, legal, moveCn, inCheck, sane, rowsToPos, mismatch, Tracker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.XQGame = api;
})(typeof self !== 'undefined' ? self : this);
