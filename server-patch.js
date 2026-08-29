const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const serverPath = path.join(ROOT, 'server.js');
const repoPath = path.join(ROOT, 'public', 'repository.html');
const gamePath = path.join(ROOT, 'public', 'game.html');

function decodeRepeated(s){
  let x = String(s || '');
  for(let i=0;i<4;i++){
    try{
      const y = decodeURIComponent(x);
      if(y === x) break;
      x = y;
    }catch{ break; }
  }
  return x;
}

function patchServer(){
  let s = fs.readFileSync(serverPath, 'utf8');
  if(!s.includes('V2.8.1_DPXQ_LOOSE_PARSER')){
    const replacement = String.raw`// V2.8.1_DPXQ_LOOSE_PARSER
function parseDpxqBlocks(html){
  // 東萍詳細頁常把 DhtmlXQ 放在 iframe 的 name/src 中，
  // 不一定有完整的 [DhtmlXQ] ... [/DhtmlXQ] 外框。
  const src = decodeRepeated(decodeHtml(String(html || '')));
  const blocks = [];

  const outer = /\[DhtmlXQ\]([\s\S]*?)\[\/DhtmlXQ\]/gi;
  let m;
  while((m = outer.exec(src))){
    const b = m[0];
    const get = n => extractTag(b,n);
    const title = get('title');
    const red = get('redname') || get('red');
    const black = get('blackname') || get('black');
    const date = get('date');
    if(title || red || black || get('movelist')){
      blocks.push({
        title, red, black,
        redTeam:get('redteam'), blackTeam:get('blackteam'),
        result:get('result'),
        year:(date.match(/(19|20)\d{2}/)||[])[0]||null,
        opening:get('open'),
        event:get('event')||get('class'),
        round:get('round'),
        place:get('place'),
        date,
        binit:get('binit'),
        movelist:get('movelist'),
        firstnum:get('firstnum'),
        length:get('length'),
        fen:get('fen'),
        gametype:get('gametype'),
        sourceText:b
      });
    }
  }

  // 兼容：
  // name="NoFile_[DhtmlXQiFrame][DhtmlXQ_binit]...[/DhtmlXQ_binit][DhtmlXQ_movelist]..."
  // iframe src / FlashVars 中 URL-encoded 的 [DhtmlXQ_*]。
  const loose = n => {
    const rx = new RegExp('\\[DhtmlXQ_'+n+'\\]([\\s\\S]*?)\\[\\/DhtmlXQ_'+n+'\\]', 'i');
    const mm = src.match(rx);
    return mm ? decodeRepeated(decodeHtml(mm[1].trim())) : '';
  };

  const lm = loose('movelist');
  const bi = loose('binit');
  if(lm || bi){
    const get = n => loose(n);
    const date = get('date');
    blocks.push({
      title:get('title'),
      red:get('redname')||get('red'),
      black:get('blackname')||get('black'),
      redTeam:get('redteam'),
      blackTeam:get('blackteam'),
      result:get('result'),
      year:(date.match(/(19|20)\d{2}/)||[])[0]||null,
      opening:get('open'),
      event:get('event')||get('class'),
      round:get('round'),
      place:get('place'),
      date,
      binit:bi,
      movelist:lm,
      firstnum:get('firstnum'),
      length:get('length'),
      fen:get('fen'),
      gametype:get('gametype'),
      sourceText:src
    });
  }

  return blocks;
}
`;
    const re = /function parseDpxqBlocks\(html\)\{[\s\S]*?\n\}\nfunction standardInitPieces/;
    if(!re.test(s)) throw new Error('找不到 parseDpxqBlocks，請確認 server.js 是目前 V2.8 版本');
    s = s.replace(re, replacement + 'function standardInitPieces');
    s = s.replace("const APP_VERSION='2.8.0';", "const APP_VERSION='2.8.1';");
    s = s.replace("const DISPLAY_VERSION='V2.8';", "const DISPLAY_VERSION='V2.8.1';");
    fs.writeFileSync(serverPath, s, 'utf8');
  }
}

function patchRepository(){
  let s = fs.readFileSync(repoPath, 'utf8');
  s = s.replace(
    'href="/?gameId=${g.id}">▶ 原棋盤播放',
    'href="/game.html?id=${g.id}&play=1">▶ 原棋盤播放'
  );
  fs.writeFileSync(repoPath, s, 'utf8');
}

function writeGameBridge(){
  const html = `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>棋譜詳情｜象棋小棋聖 V2.8.1</title>
<style>
body{margin:0;background:#f7f2e8;color:#24180f;font-family:system-ui,"Noto Sans TC",sans-serif}
header{background:#7f1717;color:#fff;padding:14px 18px}.back{color:#fff;text-decoration:none;margin-right:14px}
main{max-width:1000px;margin:auto;padding:16px}.card{background:#fff;border:1px solid #e7dac8;border-radius:16px;padding:16px;margin-bottom:12px}
.meta{color:#76675b;font-size:.84rem;line-height:1.8}.moves{font-size:.9rem;line-height:2;background:#faf7f1;padding:12px;border-radius:12px;margin-top:12px}
.move{display:inline-block;margin-right:8px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.actions a,.actions button{display:inline-block;padding:9px 12px;border:0;border-radius:9px;background:#8b1a1a;color:#fff;text-decoration:none;font-size:.82rem;cursor:pointer}
.actions .alt{background:#eee6db;color:#5c4637}
#player{display:none;position:fixed;inset:0;background:#f7f2e8;z-index:20}
#top{height:48px;display:flex;align-items:center;gap:8px;background:#7f1717;color:#fff;padding:0 10px;box-sizing:border-box}
#top button{background:#fff;color:#6f1515;border:0;border-radius:8px;padding:7px 11px;font-weight:700;cursor:pointer}
#status{font-size:.82rem}iframe{width:100%;height:calc(100% - 48px);border:0;display:block}
</style>
</head>
<body>
<header><a class="back" href="/repository.html">← 棋譜倉庫</a><b>♟ 棋譜詳情</b></header>
<main id="app"><div class="card">載入中…</div></main>
<div id="player"><div id="top"><button onclick="closeBoard()">← 返回棋譜</button><span id="status">準備載入原棋盤…</span></div><iframe id="board" title="原棋盤"></iframe></div>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=new URLSearchParams(location.search).get('id');
const auto=new URLSearchParams(location.search).get('play')==='1';
let G=null;
function tokensOf(g){
  if(Array.isArray(g.tokens)&&g.tokens.length)return g.tokens.map(x=>typeof x==='string'?x:(x?.notation||'')).filter(Boolean);
  if(Array.isArray(g.moves))return g.moves.map(x=>typeof x==='string'?x:(x?.notation||'')).filter(Boolean);
  return [];
}
function render(g){
  const mv=tokensOf(g);
  $('app').innerHTML='<section class="card"><h1>'+esc(g.red)+'　<span style="font-size:.75em;color:#8b1a1a">'+esc(g.result||'未知')+'</span>　'+esc(g.black)+'</h1><div class="meta">'+esc(g.event||'')+'<br>年份：'+(g.year||'—')+'　開局：'+esc(g.opening||'未分類')+'<br>來源：'+esc(g.source||'')+'<br>格式：'+esc(g.format||'')+'　驗證：'+esc(g.validation||'')+'</div><div class="actions"><button onclick="openBoard()">▶ 原棋盤播放</button>'+(g.detailUrl?'<a class="alt" href="'+esc(g.detailUrl)+'" target="_blank">🌐 公開棋譜頁</a>':'')+(g.sourceUrl?'<a class="alt" href="'+esc(g.sourceUrl)+'" target="_blank">東萍來源</a>':'')+'</div></section><section class="card"><h2>完整棋譜記譜（'+mv.length+' 手）</h2>'+(mv.length?'<div class="moves">'+mv.map((m,i)=>'<span class="move"><b>'+(i%2===0?(Math.floor(i/2)+1)+'.':'')+'</b>'+esc(m)+'</span>').join('')+'</div>':'<p>目前沒有抓到完整 DhtmlXQ/WXF 著法。請回棋譜倉庫重新同步。</p>')+'</section>';
}
async function load(){
  if(!id){$('app').innerHTML='<div class="card">缺少棋譜 ID</div>';return}
  try{
    const r=await fetch('/api/games/'+encodeURIComponent(id),{cache:'no-store'});
    if(!r.ok)throw new Error('找不到棋譜');
    G=await r.json();render(G);
    if(auto&&tokensOf(G).length)openBoard();
  }catch(e){$('app').innerHTML='<div class="card">載入失敗：'+esc(e.message)+'</div>'}
}
function closeBoard(){$('player').style.display='none';$('board').src='about:blank'}
function openBoard(){
  if(!G)return;
  const ts=tokensOf(G);
  $('player').style.display='block';
  if(!ts.length){$('status').textContent='❌ 此棋譜尚無完整著法，請先在棋譜倉庫重新同步';return}
  $('status').textContent='正在載入原棋盤…';
  const f=$('board');let tries=0;
  f.onload=()=>{
    const go=()=>{
      tries++;
      try{
        const w=f.contentWindow;
        if(typeof w.addImportedGame!=='function'||typeof w.loadLine!=='function'){
          if(tries<25)return setTimeout(go,300);
          throw new Error('原棋盤初始化失敗')
        }
        const cat='☁ 東萍棋庫 #'+G.id;
        const exact=Array.isArray(G.exactMoves)&&G.exactMoves.length===ts.length
          ?G.exactMoves.map((m,i)=>({from:m.from,to:m.to,notation:ts[i]})):null;
        const rr=w.addImportedGame(
          '先手',cat,(G.red||'紅方')+' 對 '+(G.black||'黑方'),
          ts.slice(),false,
          {master:true,red:G.red||'',black:G.black||'',year:G.year||'',event:G.event||'',result:G.result||''},
          exact
        );
        if(!rr||!rr.ok)throw new Error(rr?.err||'棋譜解析失敗');
        w.loadLine('先手',cat,0);
        $('status').textContent='✔ 已送入原棋盤，可使用原本播放控制';
      }catch(e){
        if(tries<25)return setTimeout(go,300);
        $('status').textContent='❌ '+e.message;
      }
    };
    go();
  };
  f.src='/?embedded=1&gameId='+encodeURIComponent(G.id);
}
load();
</script>
</body>
</html>`;
  fs.writeFileSync(gamePath, html, 'utf8');
}

try{
  patchServer();
  patchRepository();
  writeGameBridge();
  console.log('[V2.8.1] 東萍 parser + 原棋盤播放 + 公開棋譜頁已整合');
}catch(e){
  console.error('[V2.8.1] patch failed:', e.stack || e.message);
  process.exit(1);
}
