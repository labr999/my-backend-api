/* 象棋整盤辨識（瀏覽器／Node 共用）
 * 模型與前處理移植自 yolo12138/Chinese_Chess_Recognition（MIT，作者 TheOne1006）
 * 與 labr999/chess xiangqi-video-scan/board_model.py 相同流程。
 */
(function (root) {
  const LABELS = '.xKABNRCPkabnrcp';
  const MEAN = [123.675, 116.28, 103.53], STD = [58.395, 57.12, 57.375];
  const POSE_IN = [256, 256], CLS_IN = [280, 315], WARP = [450, 500], CROP = [400, 450];

  // cv2.getAffineTransform：三點對三點
  function affineFrom3(src, dst) {
    // 解 [x y 1] * M^T = dst
    const A = [], bx = [], by = [];
    for (let i = 0; i < 3; i++) { A.push([src[i][0], src[i][1], 1]); bx.push(dst[i][0]); by.push(dst[i][1]); }
    const r0 = solve(A.map(r => r.slice()), bx.slice()), r1 = solve(A.map(r => r.slice()), by.slice());
    return [r0, r1];
  }
  function solve(A, b) { // 高斯消去
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      for (let k = i + 1; k < n; k++) { const f = A[k][i] / A[i][i]; for (let j = i; j < n; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
    return x;
  }
  function affine(center, scale, out, inv) {
    const [w, h] = out; let [sw, sh] = scale;
    if (sw > sh * w / h) sh = sw * h / w; else sw = sh * w / h;
    const third = (a, b) => { const d = [a[0] - b[0], a[1] - b[1]]; return [b[0] - d[1], b[1] + d[0]]; };
    const s0 = [center[0], center[1]], s1 = [center[0] - 0.5 * sw, center[1]];
    const d0 = [w * 0.5, h * 0.5], d1 = [w * 0.5 - 0.5 * w, h * 0.5];
    const src = [s0, s1, third(s0, s1)], dst = [d0, d1, third(d0, d1)];
    return inv ? affineFrom3(dst, src) : affineFrom3(src, dst);
  }
  // 四點透視：回傳把 (x,y) 映到 (X,Y) 的 3x3（cv2.getPerspectiveTransform）
  function perspective(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [X, Y] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
    }
    const h = solve(A, b);
    return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  }
  function sample(img, x, y, out, o) { // 雙線性；超出邊界補 0
    const W = img.width, H = img.height, d = img.data;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const xx = x0 + dx, yy = y0 + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        v += d[(yy * W + xx) * 4 + c] * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      }
      out[o + c] = v;
    }
  }
  function toTensor(ow, oh, mapFn, img) {
    const n = ow * oh, t = new Float32Array(3 * n), px = [0, 0, 0];
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
      const p = mapFn(x, y); sample(img, p[0], p[1], px, 0);
      const i = y * ow + x;
      for (let c = 0; c < 3; c++) t[c * n + i] = (px[c] - MEAN[c]) / STD[c];
    }
    return t;
  }

  class BoardModel {
    constructor(ort, poseSess, clsSess) { this.ort = ort; this.pose = poseSess; this.cls = clsSess; }
    async keypoints(img) {
      const w = img.width, h = img.height;
      const center = [h / 2, w / 2], scale = [h * 1.25, w * 1.25]; // 與原專案相同（寬高對調）
      const inv = affine(center, scale, POSE_IN, true);
      const t = toTensor(POSE_IN[0], POSE_IN[1], (x, y) => [inv[0][0] * x + inv[0][1] * y + inv[0][2], inv[1][0] * x + inv[1][1] * y + inv[1][2]], img);
      const feeds = {}; feeds[this.pose.inputNames[0]] = new this.ort.Tensor('float32', t, [1, 3, POSE_IN[1], POSE_IN[0]]);
      const out = await this.pose.run(feeds);
      const [sx, sy] = this.pose.outputNames.map(k => out[k]);
      const K = sx.dims[1], Lx = sx.dims[2], Ly = sy.dims[2];
      const kp = [], sc = [];
      for (let k = 0; k < K; k++) {
        let bx = 0, mx = -Infinity, by = 0, my = -Infinity;
        for (let i = 0; i < Lx; i++) { const v = sx.data[k * Lx + i]; if (v > mx) { mx = v; bx = i; } }
        for (let i = 0; i < Ly; i++) { const v = sy.data[k * Ly + i]; if (v > my) { my = v; by = i; } }
        const X = bx / 2, Y = by / 2;
        kp.push([inv[0][0] * X + inv[0][1] * Y + inv[0][2], inv[1][0] * X + inv[1][1] * Y + inv[1][2]]);
        sc.push(mx * my);
      }
      return { kp, sc };
    }
    async classify(img, kp) {
      const pad = 50, [W, H] = WARP;
      const dst = [[pad, pad], [W - pad, pad], [pad, H - pad], [W - pad, H - pad]];
      const M = perspective(dst, kp.slice(0, 4)); // 拉正後座標 → 原圖
      const [cw, ch] = CROP, x0 = Math.floor(W / 2 - cw / 2), y0 = Math.floor(H / 2 - ch / 2);
      const [ow, oh] = CLS_IN, rx = cw / ow, ry = ch / oh;
      const t = toTensor(ow, oh, (u, v) => {
        const X = x0 + (u + 0.5) * rx - 0.5, Y = y0 + (v + 0.5) * ry - 0.5;
        const z = M[2][0] * X + M[2][1] * Y + M[2][2];
        return [(M[0][0] * X + M[0][1] * Y + M[0][2]) / z, (M[1][0] * X + M[1][1] * Y + M[1][2]) / z];
      }, img);
      const feeds = {}; feeds[this.cls.inputNames[0]] = new this.ort.Tensor('float32', t, [1, 3, oh, ow]);
      const out = (await this.cls.run(feeds))[this.cls.outputNames[0]];
      const C = out.dims[2], rows = [], conf = [];
      for (let r = 0; r < 10; r++) {
        let s = '';
        for (let c = 0; c < 9; c++) {
          const base = (r * 9 + c) * C; let bi = 0, bv = -Infinity;
          for (let k = 0; k < C; k++) if (out.data[base + k] > bv) { bv = out.data[base + k]; bi = k; }
          s += LABELS[bi]; conf.push(bv);
        }
        rows.push(s);
      }
      return { rows, conf };
    }
    // 兩段式：先找大概位置，再裁切棋盤附近重找一次（直式 Reels、棋盤偏小時更準）
    async keypointsRefined(img) {
      const k1 = await this.keypoints(img);
      const xs = k1.kp.map(p => p[0]), ys = k1.kp.map(p => p[1]);
      let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const mw = (x1 - x0) * 0.2, mh = (y1 - y0) * 0.2;
      x0 = Math.max(0, Math.floor(x0 - mw)); y0 = Math.max(0, Math.floor(y0 - mh));
      x1 = Math.min(img.width, Math.ceil(x1 + mw)); y1 = Math.min(img.height, Math.ceil(y1 + mh));
      const cw = x1 - x0, ch = y1 - y0;
      if (cw < 60 || ch < 60 || (cw > img.width * 0.85 && ch > img.height * 0.85)) return k1;
      const sub = { width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) };
      for (let y = 0; y < ch; y++) sub.data.set(img.data.subarray(((y + y0) * img.width + x0) * 4, ((y + y0) * img.width + x0 + cw) * 4), y * cw * 4);
      const k2 = await this.keypoints(sub);
      const s1 = Math.min(...k1.sc), s2 = Math.min(...k2.sc);
      if (s2 < s1 * 0.9) return k1;
      return { kp: k2.kp.map(p => [p[0] + x0, p[1] + y0]), sc: k2.sc, refined: true };
    }
    async read(img, kpCache) {
      const k = kpCache || await this.keypoints(img);
      const r = await this.classify(img, k.kp);
      return { rows: r.rows, conf: r.conf, kp: k.kp, ksc: k.sc };
    }
  }
  const api = { BoardModel, LABELS, affine, perspective };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.XQRecog = api;
})(typeof self !== 'undefined' ? self : this);
