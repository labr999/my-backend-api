const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { execFile } = require('child_process');
const iconv = require('iconv-lite');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = process.env.DATA_FILE || path.join(DATA_DIR, 'xiangqi-db.json');
const PORT = Number(process.env.PORT || 3000);
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) { const tmp=file+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(data,null,2),'utf8'); fs.renameSync(tmp,file); }
function contains(v,q){return String(v??'').toLowerCase().includes(String(q??'').trim().toLowerCase());}
function normGame(g,id){return {id,red:g.red||'未知紅方',black:g.black||'未知黑方',event:g.event||'',year:g.year?Number(g.year):null,result:g.result||'未知',opening:g.opening||'',moves:Array.isArray(g.moves)?g.moves:[],tokens:Array.isArray(g.tokens)?g.tokens:null,exactMoves:Array.isArray(g.exactMoves)?g.exactMoves:null,source:g.source||'user',sourceUrl:g.sourceUrl||'',detailUrl:g.detailUrl||'',notes:g.notes||'',format:g.format||'',fen:g.fen||'',dpxqBinit:g.dpxqBinit||'',dpxqMovelist:g.dpxqMovelist||'',validation:g.validation||'',created_at:g.created_at||new Date().toISOString()};}

// ---- GitHub 資料持久化：把 xiangqi-db.json 同步存回 GitHub repo，解決 Render 免費方案重啟後資料消失的問題 ----
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || ''; // 格式："labr999/my-backend-api"
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_DATA_PATH = process.env.GITHUB_DATA_PATH || 'data/xiangqi-db.json';
const GITHUB_ENABLED = !!(GITHUB_TOKEN && GITHUB_REPO);
let githubSha = null;
let lastGithubPush = null, lastGithubError = null, githubPushPending = false, githubPushTimer = null;
function githubHeaders(){return {Authorization:`Bearer ${GITHUB_TOKEN}`,'User-Agent':'xiangqi-web-suite','Content-Type':'application/json',Accept:'application/vnd.github+json'};}
async function githubFetchDb(){
  if(!GITHUB_ENABLED) return null;
  try{
    const r=await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_DATA_PATH)}?ref=${GITHUB_BRANCH}`,{headers:githubHeaders()});
    if(!r.ok){ console.log('[GitHub] 目前 repo 裡還沒有資料檔（第一次同步屬正常），狀態：',r.status); return null; }
    const data=await r.json();
    githubSha=data.sha;
    const content=Buffer.from(data.content,'base64').toString('utf8');
    return JSON.parse(content);
  }catch(e){ console.error('[GitHub] 讀取資料失敗：',e.message); return null; }
}
function scheduleGithubPush(){
  if(!GITHUB_ENABLED) return;
  githubPushPending=true;
  clearTimeout(githubPushTimer);
  githubPushTimer=setTimeout(githubPushDb,8000); // 等 8 秒沒有新變動才真正推送，避免同步中頻繁提交
}
async function githubPushDb(){
  if(!GITHUB_ENABLED || !githubPushPending) return;
  githubPushPending=false;
  try{
    const content=Buffer.from(JSON.stringify(db,null,2),'utf8').toString('base64');
    const body={message:`自動同步棋譜資料 ${new Date().toISOString()}`,content,branch:GITHUB_BRANCH,...(githubSha?{sha:githubSha}:{})};
    const r=await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_DATA_PATH)}`,{method:'PUT',headers:githubHeaders(),body:JSON.stringify(body)});
    const data=await r.json();
    if(!r.ok){
      lastGithubError=data.message||String(r.status);
      console.error('[GitHub] 推送失敗：',lastGithubError);
      if(r.status===409){ githubSha=null; const fresh=await githubFetchDb(); if(fresh){ scheduleGithubPush(); } }
      return;
    }
    githubSha=data.content.sha; lastGithubPush=new Date().toISOString(); lastGithubError=null;
    console.log('[GitHub] 已將最新棋譜資料同步回', GITHUB_REPO);
  }catch(e){ lastGithubError=e.message; console.error('[GitHub] 推送發生錯誤：',e.message); }
}

const seed=readJson(path.join(DATA_DIR,'seed.json'),{players:[],games:[]});
let db={players:[],games:[],nextGameId:1};
async function initDb(){
  const remote=await githubFetchDb();
  const local=readJson(DB_FILE,null);
  if(remote && Array.isArray(remote.players) && Array.isArray(remote.games)){
    db=remote; console.log('[GitHub] 已從 repo 載入最新棋譜資料，共',db.games.length,'盤。');
  } else if(local && Array.isArray(local.players) && Array.isArray(local.games)){
    db=local;
  }
  db.nextGameId=db.nextGameId||Math.max(0,...db.games.map(g=>Number(g.id)||0))+1;
  for(const p of seed.players||[]){
    if(!db.players.some(x=>x.name===p.name)) db.players.push({id:db.players.length+1,name:p.name,title:p.title||''});
  }
  for(const g of seed.games||[]){
    const key=(g.red||'')+'|'+(g.black||'')+'|'+(g.event||'')+'|'+(g.year||'');
    const exists=db.games.some(x=>(x.red||'')+'|'+(x.black||'')+'|'+(x.event||'')+'|'+(x.year||'')===key);
    if(!exists) db.games.push(normGame(g,db.nextGameId++));
  }
  writeJson(DB_FILE,db);
}
function saveDb(){writeJson(DB_FILE,db);scheduleGithubPush();}
function playerGames(name){return db.games.filter(g=>g.red===name||g.black===name);}
function gameOutcomeFor(name,g){
  const r=String(g.result||'').trim();
  if(/和/.test(r)) return 'draw';
  if(/^紅|^红/.test(r)) return g.red===name?'win':(g.black===name?'loss':'other');
  if(/^黑/.test(r)) return g.black===name?'win':(g.red===name?'loss':'other');
  return 'unknown';
}
function playerStats(name){
  const gs=playerGames(name);
  const stats={games:gs.length,wins:0,losses:0,draws:0,unknown:0,winRate:0,opponents:[],openings:[],events:[],years:[]};
  const om=new Map(), opm=new Map(), evm=new Map(), ym=new Map();
  for(const g of gs){
    const outcome=gameOutcomeFor(name,g);
    if(outcome==='win')stats.wins++; else if(outcome==='loss')stats.losses++; else if(outcome==='draw')stats.draws++; else stats.unknown++;
    const opp=g.red===name?g.black:g.red;
    const add=(map,key,extra={})=>{if(!key)return;const x=map.get(key)||{name:key,games:0,wins:0,losses:0,draws:0};x.games++;if(outcome==='win')x.wins++;if(outcome==='loss')x.losses++;if(outcome==='draw')x.draws++;map.set(key,x)};
    add(opm,opp); add(om,g.opening||'未分類'); add(evm,g.event||'未標註'); add(ym,g.year?String(g.year):'年份未知');
  }
  const decided=stats.wins+stats.losses+stats.draws;
  stats.winRate=decided?Number((stats.wins/decided*100).toFixed(1)):0;
  stats.opponents=[...opm.values()].sort((a,b)=>b.games-a.games||b.wins-a.wins).slice(0,30);
  stats.openings=[...om.values()].sort((a,b)=>b.games-a.games).slice(0,30);
  stats.events=[...evm.values()].sort((a,b)=>b.games-a.games).slice(0,30);
  stats.years=[...ym.entries()].map(([year,x])=>({year,...x})).sort((a,b)=>String(b.year).localeCompare(String(a.year)));
  return stats;
}
function ensurePlayer(name){if(name && !db.players.some(p=>p.name===name)) db.players.push({id:db.players.length+1,name,title:''});}

const app=express(); const server=http.createServer(app); const io=new Server(server);
app.use(express.json({limit:'12mb'}));
app.use('/api/import-history', (req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');if(req.method==='OPTIONS')return res.sendStatus(204);next();});
app.use(express.static(path.join(ROOT,'public')));

const APP_VERSION='2.8.0';
const DISPLAY_VERSION='V2.8';
app.get('/api/health',(req,res)=>res.json({ok:true,service:'xiangqi-web-suite',version:APP_VERSION,displayVersion:DISPLAY_VERSION,storage:'json',github:{enabled:GITHUB_ENABLED,repo:GITHUB_REPO||null,lastPush:lastGithubPush,lastError:lastGithubError,pending:githubPushPending},time:new Date().toISOString()}));
app.get('/api/stats',(req,res)=>res.json({players:db.players.length,games:db.games.length,playableGames:db.games.filter(g=>g.moves?.length).length,onlineRooms:rooms.size}));
app.get('/api/players',(req,res)=>{
  const q=req.query.q||'', limit=Math.min(Number(req.query.limit||200),500);
  const items=db.players.filter(p=>!q||contains(p.name,q)).map(p=>{const gs=playerGames(p.name);return {...p,games:gs.length,wins:gs.filter(g=>(g.red===p.name&&/^紅勝|^红胜|^紅先勝|^红先胜/.test(g.result||''))||(g.black===p.name&&/^黑勝|^黑胜/.test(g.result||''))).length}}).sort((a,b)=>b.games-a.games||a.name.localeCompare(b.name)).slice(0,limit);
  res.json({items,total:items.length,query:q});
});
app.get('/api/players/:name',(req,res)=>{const name=decodeURIComponent(req.params.name);const p=db.players.find(x=>x.name===name);if(!p)return res.status(404).json({error:'找不到棋手'});const all=playerGames(name).sort((a,b)=>(b.year||0)-(a.year||0)||b.id-a.id);res.json({player:{...p,games:all.length},stats:playerStats(name),games:all.slice(0,500)});});
app.get('/api/games',(req,res)=>{
  const {q='',player='',event='',opening='',year='',result='',playable=''}=req.query;
  let rows=db.games.filter(g=>{
    if(q && ![g.red,g.black,g.event,g.opening,g.notes,g.source].some(v=>contains(v,q)))return false;
    if(player && !contains(g.red,player)&&!contains(g.black,player))return false;
    if(event && !contains(g.event,event))return false;
    if(opening && !contains(g.opening,opening))return false;
    if(year && String(g.year||'')!==String(year))return false;
    if(result && String(g.result||'')!==String(result))return false;
    if(playable==='1' && !(g.moves&&g.moves.length))return false;
    return true;
  }).sort((a,b)=>(b.year||0)-(a.year||0)||b.id-a.id);
  const total=rows.length; rows=rows.slice(0,Math.min(Number(req.query.limit||200),1000));
  res.json({items:rows,total});
});
app.get('/api/games/:id',(req,res)=>{const g=db.games.find(x=>String(x.id)===String(req.params.id));if(!g)return res.status(404).json({error:'找不到棋譜'});res.json(g);});

app.post('/api/games',(req,res)=>{const g=normGame(req.body||{},db.nextGameId++);db.games.push(g);ensurePlayer(g.red);ensurePlayer(g.black);saveDb();res.status(201).json(g);});

app.post('/api/import-history',(req,res)=>{
  const incoming=Array.isArray(req.body?.games)?req.body.games:[]; if(!incoming.length)return res.status(400).json({error:'沒有收到棋譜'});
  let added=0,updated=0;
  for(const old of incoming){
    const red=old.meta?.red||old.red||'未知紅方', black=old.meta?.black||old.black||'未知黑方';
    const name=old.name||`${red} 對 ${black}`;
    const moves=Array.isArray(old.exactMoves)&&old.exactMoves.length?old.exactMoves:Array.isArray(old.moves)?old.moves:[];
    const tokens=Array.isArray(old.tokens)?old.tokens:[];
    const existing=db.games.find(g=>g.source==='legacy-index'&&g.legacyKey===`${name}|${red}|${black}`);
    const rec=normGame({red,black,event:old.meta?.event||old.event||'',year:old.meta?.year||old.year||null,result:old.meta?.result||old.result||'未知',opening:old.cat||old.opening||'',moves,tokens,exactMoves:Array.isArray(old.exactMoves)?old.exactMoves:null,source:'legacy-index',sourceUrl:'',notes:`由舊版 index.html 歷史救援：${name}`,legacyKey:`${name}|${red}|${black}`},existing?.id||db.nextGameId++);
    if(existing){Object.assign(existing,rec);updated++;}else{db.games.push(rec);added++;}
    ensurePlayer(red);ensurePlayer(black);
  }
  saveDb();res.json({ok:true,added,updated,total:incoming.length,stats:{players:db.players.length,games:db.games.length}});
});

app.get('/api/dpxq/source',(req,res)=>res.json({name:'東萍象棋網',url:'http://www.dpxq.com/',mode:'source-index',message:'本站提供公開棋譜索引與來源連結；不鏡像整站資料。'}));

// ---------- 東萍公開索引同步 V2.8 ----------
let dpxqLastFetch = 0;
let syncJob = null;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const DPXQ_HOST_RE = /^https?:\/\/(www\.)?dpxq\.com\//i;
function isDpxqUrl(url){ return DPXQ_HOST_RE.test(url); }
function decodeHtml(s){return String(s||'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');}
function stripHtml(s){return decodeHtml(String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());}

async function fetchText(url){
  if(!isDpxqUrl(url)) throw new Error('只允許 dpxq.com 網址');
  
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh-TW,zh;q=0.9,en;q=0.8',
        'Referer': 'http://www.dpxq.com/'
      },
      signal: AbortSignal.timeout(15000)
    });
    const buf = Buffer.from(await res.arrayBuffer());
    let text = iconv.decode(buf, 'gb18030');
    if (text.includes('\uFFFD')) {
      const utf8 = buf.toString('utf8');
      if (!utf8.includes('\uFFFD')) text = utf8;
    }
    dpxqLastFetch = Date.now();
    return text;
  } catch (fetchErr) {
    return new Promise((resolve,reject)=>{
      const args=['-L','--max-time','15','--connect-timeout','8','-A','Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0','-H','Accept-Language: zh-TW,zh;q=0.9,zh-CN;q=0.8','-H','Referer: http://www.dpxq.com/',url];
      execFile(process.platform==='win32'?'curl.exe':'curl',args,{encoding:null,maxBuffer:20*1024*1024},(err,stdout,stderr)=>{
        if(err) return reject(new Error(err.message || '連線失敗'));
        const buf = Buffer.isBuffer(stdout)?stdout:Buffer.from(stdout||'');
        let text = iconv.decode(buf, 'gb18030');
        if (text.includes('\uFFFD')) {
          const utf8 = buf.toString('utf8');
          if (!utf8.includes('\uFFFD')) text = utf8;
        }
        dpxqLastFetch = Date.now();
        resolve(text);
      });
    });
  }
}

function extractTag(text,name){const m=String(text||'').match(new RegExp('\\[DhtmlXQ_'+name+'\\]([\\s\\S]*?)\\[\\/DhtmlXQ_'+name+'\\]','i'));return m?decodeHtml(m[1].trim()):'';}
function parseDpxqBlocks(html){
  const blocks=[]; const re=/\[DhtmlXQ\]([\s\S]*?)\[\/DhtmlXQ\]/gi; let m;
  while((m=re.exec(html))){
    const b=m[0]; const get=n=>extractTag(b,n);
    const title=get('title'), red=get('redname')||get('red'), black=get('blackname')||get('black');
    if(title||red||black||get('movelist')) blocks.push({title,red,black,redTeam:get('redteam'),blackTeam:get('blackteam'),result:get('result'),year:(get('date').match(/(19|20)\d{2}/)||[])[0]||null,opening:get('open'),event:get('event')||get('class'),round:get('round'),place:get('place'),date:get('date'),binit:get('binit'),movelist:get('movelist'),firstnum:get('firstnum'),length:get('length'),fen:get('fen'),gametype:get('gametype'),sourceText:b});
  }
  return blocks;
}
function standardInitPieces(){
  const back=['車','馬','相','仕','帥','仕','相','馬','車'];
  const backB=['車','馬','象','士','將','士','象','馬','車'];
  const pieces=[];
  back.forEach((t,i)=>pieces.push({side:'r',type:t,col:i,row:9,alive:true}));
  pieces.push({side:'r',type:'砲',col:1,row:7,alive:true},{side:'r',type:'砲',col:7,row:7,alive:true});
  [0,2,4,6,8].forEach(c=>pieces.push({side:'r',type:'兵',col:c,row:6,alive:true}));
  backB.forEach((t,i)=>pieces.push({side:'b',type:t,col:i,row:0,alive:true}));
  pieces.push({side:'b',type:'砲',col:1,row:2,alive:true},{side:'b',type:'砲',col:7,row:2,alive:true});
  [0,2,4,6,8].forEach(c=>pieces.push({side:'b',type:'卒',col:c,row:3,alive:true}));
  return pieces;
}
function decodeDpxqPosition(binit){
  const s=String(binit||'').replace(/[^0-9]/g,'');
  if(s.length<4) return standardInitPieces();
  const pieces=[]; const map=['R','N','B','A','K','A','B','N','R','C','C','P','P','P','P','P'];
  const types={R:'車',N:'馬',B:'相',A:'仕',K:'帥',C:'砲',P:'兵',r:'車',n:'馬',b:'象',a:'士',k:'將',c:'砲',p:'卒'};
  const p=map.join('')+map.join('').toLowerCase();
  for(let i=0;i<Math.min(32,Math.floor(s.length/2));i++){
    const col=Number(s[i*2]),row=Number(s[i*2+1]); const ch=p[i]; if(col>8||row>9||!ch)continue;
    pieces.push({side:ch===ch.toUpperCase()?'r':'b',type:types[ch],col,row,alive:true});
  }
  return pieces;
}
function pieceCat(ch){return {'車':'R','车':'R','馬':'H','马':'H','炮':'C','砲':'C','相':'E','象':'E','仕':'A','士':'A','帥':'K','帅':'K','將':'K','将':'K','兵':'P','卒':'P'}[ch]||null;}
function boardFromPieces(pieces){const b=Array.from({length:10},()=>Array(9).fill(null));for(const p of pieces)if(p.alive)b[p.row][p.col]=p;return b;}
function inB(c,r){return c>=0&&c<9&&r>=0&&r<10;}
function palace(side,c,r){return c>=3&&c<=5&&(side==='r'?r>=7&&r<=9:r>=0&&r<=2);}
function half(side,r){return side==='r'?r>=5:r<=4;}
function legalMovesServer(b,side){const out=[];const push=(fc,fr,tc,tr)=>{if(!inB(tc,tr))return;if(b[tr][tc]&&b[tr][tc].side===side)return;out.push({fc,fr,tc,tr});};
  for(let r=0;r<10;r++)for(let c=0;c<9;c++){const p=b[r][c];if(!p||p.side!==side)continue;const cat=pieceCat(p.type);
    if(cat==='R'){for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){let tc=c+dc,tr=r+dr;while(inB(tc,tr)){push(c,r,tc,tr);if(b[tr][tc])break;tc+=dc;tr+=dr;}}}
    else if(cat==='C'){for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){let tc=c+dc,tr=r+dr,j=false;while(inB(tc,tr)){if(!j){if(!b[tr][tc])push(c,r,tc,tr);else j=true;}else if(b[tr][tc]){if(b[tr][tc].side!==side)push(c,r,tc,tr);break;}tc+=dc;tr+=dr;}}}
    else if(cat==='H'){for(const [dc,dr,lc,lr] of [[1,2,0,1],[-1,2,0,1],[1,-2,0,-1],[-1,-2,0,-1],[2,1,1,0],[2,-1,1,0],[-2,1,-1,0],[-2,-1,-1,0]]){if(inB(c+dc,r+dr)&&!b[r+lr][c+lc])push(c,r,c+dc,r+dr);}}
    else if(cat==='E'){for(const [dc,dr] of [[2,2],[2,-2],[-2,2],[-2,-2]]){const tc=c+dc,tr=r+dr;if(inB(tc,tr)&&half(side,tr)&&!b[r+dr/2][c+dc/2])push(c,r,tc,tr);}}
    else if(cat==='A'){for(const [dc,dr] of [[1,1],[1,-1],[-1,1],[-1,-1]]){const tc=c+dc,tr=r+dr;if(inB(tc,tr)&&palace(side,tc,tr))push(c,r,tc,tr);}}
    else if(cat==='K'){for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]){const tc=c+dc,tr=r+dr;if(inB(tc,tr)&&palace(side,tc,tr))push(c,r,tc,tr);}const dr=side==='r'?-1:1;let tr=r+dr;while(inB(c,tr)){if(b[tr][c]){if(b[tr][c].side!==side&&pieceCat(b[tr][c].type)==='K')push(c,r,c,tr);break;}tr+=dr;}}
    else if(cat==='P'){const fw=side==='r'?-1:1;if(inB(c,r+fw))push(c,r,c,r+fw);if(!half(side,r)){if(inB(c-1,r))push(c,r,c-1,r);if(inB(c+1,r))push(c,r,c+1,r);}}
  }return out;}
const redNums=['','一','二','三','四','五','六','七','八','九'];
function colNameServer(side,col){const n=side==='r'?9-col:col+1;return side==='r'?redNums[n]:String(n);}
function stepNameServer(side,n){return side==='r'?redNums[n]:String(n);}
function notationServer(pieces,piece,from,to){const side=piece.side,cat=pieceCat(piece.type),straight=['R','C','P','K'].includes(cat);const mates=pieces.filter(p=>p.alive&&p!==piece&&p.side===side&&pieceCat(p.type)===cat&&p.col===from[0]);let prefix='';if(mates.length&&['R','C','P','H'].includes(cat)){const front=side==='r'?from[1]<Math.min(...mates.map(x=>x.row)):from[1]>Math.max(...mates.map(x=>x.row));prefix=front?'前':'後';}let body;if(straight){if(to[1]===from[1])body='平'+colNameServer(side,to[0]);else{const adv=side==='r'?to[1]<from[1]:to[1]>from[1];body=(adv?'進':'退')+stepNameServer(side,Math.abs(to[1]-from[1]));}}else{const adv=side==='r'?to[1]<from[1]:to[1]>from[1];body=(adv?'進':'退')+colNameServer(side,to[0]);}return prefix+piece.type+colNameServer(side,from[0])+body;}
function extractWxfTokens(text){
  const raw=stripHtml(text).replace(/\b\d{1,3}[.、]\s*/g,' ');
  const re=/(?:前|中|後)?[車马馬炮砲相象仕士帅帥将將兵卒][一二三四五六七八九1-9](?:平|進|退)[一二三四五六七八九1-9]/g;
  return raw.match(re)||[];
}
function decodeDpxqMoves(block){
  const pieces=decodeDpxqPosition(block.binit); const exact=[]; const tokens=[]; const s=String(block.movelist||'').replace(/[^0-9]/g,''); let side='r'; let valid=true, badAt=-1, reason='';
  for(let i=0;i+3<s.length;i+=4){const fc=Number(s[i]),fr=Number(s[i+1]),tc=Number(s[i+2]),tr=Number(s[i+3]);if(!inB(fc,fr)||!inB(tc,tr)){valid=false;badAt=i/4+1;reason='座標超出棋盤';break;}const p=pieces.find(x=>x.alive&&x.col===fc&&x.row===fr);if(!p){valid=false;badAt=i/4+1;reason='起點無棋子';break;}if(p.side!==side){valid=false;badAt=i/4+1;reason='輪到'+(side==='r'?'紅':'黑')+'方但資料走子方不符';break;}const legal=legalMovesServer(boardFromPieces(pieces),side).some(m=>m.fc===fc&&m.fr===fr&&m.tc===tc&&m.tr===tr);if(!legal){valid=false;badAt=i/4+1;reason='走法不符合基本棋規';break;}const cap=pieces.find(x=>x.alive&&x.col===tc&&x.row===tr&&x!==p);tokens.push(notationServer(pieces,p,{0:fc,1:fr},{0:tc,1:tr}));exact.push({from:[fc,fr],to:[tc,tr]});if(cap)cap.alive=false;p.col=tc;p.row=tr;side=side==='r'?'b':'r';}
  return {tokens,exactMoves:exact,valid,badAt,reason,totalEncoded:Math.floor(s.length/4)};
}
function parseDpxqIndex(html,baseUrl){
  const out=[]; const seen=new Set(); const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while((m=re.exec(html))){
    const href=decodeHtml(m[1]),text=stripHtml(m[2]);
    if(!href||!text)continue;
    let detailUrl='';
    try{detailUrl=new URL(href,baseUrl).href;}catch{continue;}
    if(!/dpxq\.com\/hldcg\/(?:search\/view_m?_?\d+\.html|dhtmlxq\/view|view\.asp)/i.test(detailUrl))continue;
    if(seen.has(detailUrl))continue;
    seen.add(detailUrl);
    const mm=text.match(/(.+?)\s+(胜|勝|負|负|和|和棋)\s+(.+)/);
    let red='',black='',result='未知';
    if(mm){red=mm[1].trim();result=mm[2];black=mm[3].trim();}
    const ym=text.match(/\b(19|20)\d{2}\b/);
    out.push({title:text,red,black,result,year:ym?Number(ym[0]):null,detailUrl,source:'dpxq-index',sourceUrl:baseUrl,opening:'',moves:[],tokens:null,exactMoves:null,notes:'由東萍公開索引同步。'});
    if(out.length>=100)break;
  }
  return out;
}
function parsePagination(html,baseUrl){const urls=[];const seen=new Set();const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;while((m=re.exec(html))){const href=decodeHtml(m[1]),text=stripHtml(m[2]);if(!href)continue;try{const u=new URL(href,baseUrl).href;if(!isDpxqUrl(u))continue;if(/(下一頁|下页|下一页|next|末頁|末页|last|^>|»)/i.test(text)&&!seen.has(u)){seen.add(u);urls.push(u)}}catch{}}return urls;}
function parseDiscoveryLinks(html,baseUrl){const urls=[];const seen=new Set();const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;while((m=re.exec(html))){const href=decodeHtml(m[1]);try{const u=new URL(href,baseUrl).href;if(!isDpxqUrl(u)||seen.has(u)||u===baseUrl)continue;if(/\/hldcg\/(?:search\/list|tour_|share\/)/i.test(u)){seen.add(u);urls.push(u)}}catch{}}return urls.slice(0,60);}

async function fetchDetail(detailUrl){
  const html = await fetchText(detailUrl);
  const blocks = parseDpxqBlocks(html);
  const b = blocks.find(x=>x.movelist||x.red||x.black) || blocks[0];
  if(!b){
    const wxf = extractWxfTokens(html);
    return {
      html,
      b: {},
      dec: {tokens:wxf,exactMoves:[],valid:!!wxf.length,badAt:-1,reason:wxf.length?'WXF文字棋譜':'未找到棋譜資料',totalEncoded:wxf.length},
      format: wxf.length?'WXF':'unknown'
    };
  }
  const dec = b.movelist ? decodeDpxqMoves(b) : {tokens:extractWxfTokens(html),exactMoves:[],valid:false,badAt:-1,reason:'沒有 DhtmlXQ movelist，使用 WXF 文字解析',totalEncoded:0};
  return {html, b, dec, format: b.movelist?'DhtmlXQ':(dec.tokens.length?'WXF':'unknown')};
}
async function fetchDetailWithRetry(url,tries=2){
  for(let i=0;i<tries;i++){
    try{
      const d=await fetchDetail(url);
      if(d && (d.b?.red || d.b?.black || (d.dec?.tokens||[]).length)) return d;
      if(i<tries-1) await sleep(2000);
    }catch(e){ if(i===tries-1) throw e; await sleep(2000); }
  }
  return await fetchDetail(url);
}

function upsertGameFromDetail(indexItem,detail){const b=detail?.b||{};const dec=detail?.dec||{};const red=b.red||indexItem.red||'';const black=b.black||indexItem.black||'';const result=b.result||indexItem.result||'未知';const event=b.event||indexItem.event||indexItem.title||'';const year=Number((b.date||'').match(/(19|20)\d{2}/)?.[0]||indexItem.year||0)||null;const opening=b.open||indexItem.opening||'';const key=indexItem.detailUrl;const existing=db.games.find(g=>g.source==='dpxq-index'&&g.detailUrl===key);const rec=normGame({red,black,event,year,result,opening,moves:dec.tokens||[],tokens:dec.tokens||[],exactMoves:dec.exactMoves||[],source:'dpxq-index',sourceUrl:indexItem.sourceUrl,detailUrl:indexItem.detailUrl,format:detail?.format||'DhtmlXQ',fen:b.fen||'',dpxqBinit:b.binit||'',dpxqMovelist:b.movelist||'',validation:dec.valid?'ok':(dec.reason||'unknown'),notes:`東萍完整棋譜同步。${dec.valid?'合法走法驗證通過。':('驗證：'+(dec.reason||'未完成'))}`},existing?.id||db.nextGameId++);if(existing)Object.assign(existing,rec);else db.games.push(rec);ensurePlayer(red);ensurePlayer(black);return {added:!existing,updated:!!existing,playable:!!(rec.exactMoves&&rec.exactMoves.length)};}
function importIndexItems(items){let added=0,updated=0;for(const x of items){const existing=db.games.find(g=>g.source==='dpxq-index'&&g.detailUrl===x.detailUrl);const rec=normGame({...x,event:x.title},existing?.id||db.nextGameId++);if(existing){Object.assign(existing,rec);updated++;}else{db.games.push(rec);added++;}ensurePlayer(x.red);ensurePlayer(x.black);}saveDb();return {added,updated};}
function setSyncError(message){if(syncJob){syncJob.status='error';syncJob.error=message;syncJob.finishedAt=new Date().toISOString();}}

async function runSync(job){
  try{
    const queue=[job.url],visited=new Set(),detailSeen=new Set();let page=0;
    while(queue.length&&page<job.maxPages&&!job.cancelled){
      const url=queue.shift();if(visited.has(url))continue;visited.add(url);page++;job.page=page;job.currentUrl=url;job.status='running';
      const html = await fetchText(url);
      const items=parseDpxqIndex(html,url);let filtered=job.player?items.filter(x=>contains(x.red,job.player)||contains(x.black,job.player)||contains(x.title,job.player)):items;
      if(items.length){job.found+=filtered.length;job.detailFound+=filtered.length;}
      const details=filtered.filter(x=>{if(detailSeen.has(x.detailUrl))return false;detailSeen.add(x.detailUrl);return true;});
      const batchSize=2;for(let i=0;i<details.length&&!job.cancelled;i+=batchSize){const batch=details.slice(i,i+batchSize);await Promise.all(batch.map(async x=>{try{const d=await fetchDetailWithRetry(x.detailUrl);if(!d){job.errors++;return;}const r=upsertGameFromDetail(x,d);if(r.added)job.added++;else job.updated++;if(r.playable)job.playable++;else job.indexOnly++;job.detailParsed++;if(d.dec&&!d.dec.valid)job.validationErrors++;}catch(e){job.errors++;job.lastError=String(e.message||e);}}));job.detailDone+=batch.length;job.detailTotal=details.length;job.progress=Math.min(99,Math.round(((page-1)+Math.min(1,job.detailDone/Math.max(1,details.length)))/job.maxPages*100));}
      saveDb();const next=parsePagination(html,url);const discovered=parseDiscoveryLinks(html,url);for(const n of [...next,...discovered])if(!visited.has(n)&&!queue.includes(n)&&queue.length<job.maxPages*2)queue.push(n);job.discovered=visited.size+queue.length;job.pagesDone=page;job.players=db.players.length;job.games=db.games.length;job.lastBatch=filtered.slice(0,20);job.progress=Math.min(99,Math.round(page/job.maxPages*100));
      if(queue.length&&!job.cancelled)await sleep(2500);
    }
    job.progress=100;job.status=job.cancelled?'cancelled':'done';job.finishedAt=new Date().toISOString();job.pagesTotal=page;job.players=db.players.length;job.games=db.games.length;saveDb();
  }catch(e){setSyncError(e.message);}
}

app.get('/api/dpxq/test',async(req,res)=>{
  const url=String(req.query.url||'http://www.dpxq.com/').trim();
  if(!isDpxqUrl(url))return res.status(400).json({ok:false,error:'只允許 dpxq.com 網址'});
  const t0=Date.now();
  try{
    const html = await fetchText(url);
    const games=parseDpxqIndex(html,url);
    const blocks=parseDpxqBlocks(html);
    return res.json({
      ok:true,
      url,
      ms:Date.now()-t0,
      bytes:Buffer.byteLength(html,'utf8'),
      indexGames:games.length,
      dhtmlxqBlocks:blocks.length,
      message:games.length?'已解析到棋譜索引':(blocks.length?'已解析到 DhtmlXQ 棋譜':'頁面連線正常，但這一頁是分類／目錄頁，將由自動同步器繼續尋找棋譜列表。')
    });
  }catch(e){
    return res.status(502).json({ok:false,url,error:e.message});
  }
});

app.get('/api/dpxq/source',(req,res)=>res.json({name:'東萍象棋網',url:'http://www.dpxq.com/',mode:'public-index-detail-sync',message:'同步公開索引與公開棋譜詳細頁；保留來源 URL。'}));
app.get('/api/dpxq/sync/status',(req,res)=>{if(!syncJob)return res.json({status:'idle',progress:0});const j={...syncJob};delete j.cancelled;res.json(j)});
app.post('/api/dpxq/sync/cancel',(req,res)=>{if(!syncJob||!['running','queued'].includes(syncJob.status))return res.json({ok:true,status:syncJob?.status||'idle'});syncJob.cancelled=true;syncJob.status='cancelled';res.json({ok:true});});
app.post('/api/dpxq/sync/start',(req,res)=>{if(syncJob&&['queued','running'].includes(syncJob.status))return res.status(409).json({error:'已有同步工作正在執行',jobId:syncJob.id});const url=String(req.body?.url||'').trim(),player=String(req.body?.player||'').trim(),maxPages=Math.max(1,Math.min(Number(req.body?.maxPages||20),100));if(!isDpxqUrl(url))return res.status(400).json({error:'請提供 dpxq.com 網址'});syncJob={id:Date.now().toString(36).toUpperCase(),status:'queued',url,player,maxPages,page:0,pagesDone:0,pagesTotal:0,progress:0,found:0,added:0,updated:0,players:db.players.length,games:db.games.length,playable:0,indexOnly:0,detailFound:0,detailDone:0,detailTotal:0,detailParsed:0,errors:0,validationErrors:0,lastError:'',currentUrl:'',discovered:1,lastBatch:[],startedAt:new Date().toISOString(),finishedAt:null,error:null,cancelled:false};runSync(syncJob);res.json({ok:true,jobId:syncJob.id,version:APP_VERSION});});
app.post('/api/dpxq/import',async(req,res)=>{const url=String(req.body?.url||'').trim();if(!isDpxqUrl(url))return res.status(400).json({error:'請提供 dpxq.com 網址'});try{const html=await fetchText(url);const items=parseDpxqIndex(html,url);const r=importIndexItems(items);res.json({ok:true,url,found:items.length,...r,players:db.players.length,games:db.games.length,items:items.slice(0,20)});}catch(e){res.status(502).json({error:'東萍索引抓取失敗：'+e.message});}});

const rooms=new Map();
function roomCode(){let c;do{c=Math.random().toString(36).slice(2,8).toUpperCase();}while(rooms.has(c));return c;}
io.on('connection',socket=>{
 socket.on('createRoom',({name}={})=>{const room=roomCode();rooms.set(room,{red:{id:socket.id,name:name||'紅方'},black:null,moves:[],status:'waiting'});socket.join(room);socket.data.room=room;socket.data.side='red';socket.emit('roomCreated',{room,side:'red'});});
 socket.on('joinRoom',({room,name}={})=>{const id=String(room||'').trim().toUpperCase(),g=rooms.get(id);if(!g)return socket.emit('gameError','房間不存在或已關閉');if(g.black)return socket.emit('gameError','房間已滿');g.black={id:socket.id,name:name||'黑方'};g.status='playing';socket.join(id);socket.data.room=id;socket.data.side='black';io.to(id).emit('gameStart',{room:id,red:g.red.name,black:g.black.name,moves:g.moves});});
 socket.on('move',({room,move}={})=>{const g=rooms.get(room);if(!g||g.status!=='playing')return;const side=socket.data.side,expected=g.moves.length%2===0?'red':'black';if(side!==expected)return socket.emit('gameError','尚未輪到你');g.moves.push(move);io.to(room).emit('move',{move,index:g.moves.length-1,side});});
 socket.on('resign',({room}={})=>{const g=rooms.get(room);if(!g)return;g.status='ended';io.to(room).emit('gameEnd',{reason:'resign',winner:socket.data.side==='red'?'black':'red'});});
 socket.on('disconnect',()=>{const room=socket.data.room,g=rooms.get(room);if(g)io.to(room).emit('gameError','對手已離線');});
});

app.use((req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));
initDb().then(()=>{
  server.listen(PORT,()=>console.log(`\nXiangqi Web Suite ${DISPLAY_VERSION} running at http://localhost:${PORT}\nData: ${DB_FILE}\nGitHub 自動同步：${GITHUB_ENABLED?('已啟用（'+GITHUB_REPO+'）'):'未啟用（缺少 GITHUB_TOKEN 或 GITHUB_REPO 環境變數）'}\n`));
});