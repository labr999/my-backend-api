const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const https = require('https');
const httpReq = require('http');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = process.env.DATA_FILE || path.join(DATA_DIR, 'xiangqi-db.json');
const PORT = Number(process.env.PORT || 3000);
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) { const tmp=file+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(data,null,2),'utf8'); fs.renameSync(tmp,file); }
function contains(v,q){return String(v??'').toLowerCase().includes(String(q??'').trim().toLowerCase());}
function normGame(g,id){return {id,red:g.red||'未知紅方',black:g.black||'未知黑方',event:g.event||'',year:g.year?Number(g.year):null,result:g.result||'未知',opening:g.opening||'',moves:Array.isArray(g.moves)?g.moves:[],tokens:Array.isArray(g.tokens)?g.tokens:null,exactMoves:Array.isArray(g.exactMoves)?g.exactMoves:null,source:g.source||'user',sourceUrl:g.sourceUrl||'',detailUrl:g.detailUrl||'',notes:g.notes||'',created_at:g.created_at||new Date().toISOString()};}

const seed=readJson(path.join(DATA_DIR,'seed.json'),{players:[],games:[]});
let db=readJson(DB_FILE,null);
if(!db || !Array.isArray(db.players) || !Array.isArray(db.games)){
  db={players:[],games:[],nextGameId:1};
}
// Always merge the bundled demo/master data. This also repairs an older empty DB.
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
function saveDb(){writeJson(DB_FILE,db);}
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
// Needed only for the optional old file:// history migration page (Origin is usually null).
app.use('/api/import-history', (req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');if(req.method==='OPTIONS')return res.sendStatus(204);next();});
app.use(express.static(path.join(ROOT,'public')));

const APP_VERSION='2.7.1';
app.get('/api/health',(req,res)=>res.json({ok:true,service:'xiangqi-web-suite',version:APP_VERSION,displayVersion:'V2.7.1',storage:'json',time:new Date().toISOString()}));
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

// Import the user's old index.html IndexedDB/localStorage history.
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

app.get('/api/dpxq/source',(req,res)=>res.json({name:'東萍象棋網',url:'https://www.dpxq.com/',mode:'source-index',message:'本站提供公開棋譜索引與來源連結；不鏡像整站資料。'}));

// ---------- 東萍公開索引同步（只匯入公開索引的 metadata + 原站連結；不鏡像整站） ----------
let dpxqLastFetch = 0;
let syncJob = null;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
function fetchText(url){
  return new Promise((resolve,reject)=>{
    const u=new URL(url); if(!/^https?:$/.test(u.protocol)) return reject(new Error('只允許 http/https URL'));
    const mod=u.protocol==='https:'?https:httpReq;
    const req=mod.get(url,{headers:{'User-Agent':'XiangqiWebSuite/2.7 (public-index-import)'}} ,res=>{
      if(res.statusCode>=300 && res.statusCode<400 && res.headers.location){res.resume();return fetchText(new URL(res.headers.location,url).href).then(resolve,reject)}
      if(res.statusCode!==200){res.resume();return reject(new Error('HTTP '+res.statusCode));}
      const chunks=[];res.setEncoding('utf8');res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(chunks.join('')));
    });
    req.setTimeout(20000,()=>req.destroy(new Error('抓取逾時')));req.on('error',reject);
  });
}
function stripHtml(s){return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/\s+/g,' ').trim();}
function parseDpxqIndex(html,baseUrl){
  const out=[]; const seen=new Set(); const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while((m=re.exec(html))){const href=m[1],text=stripHtml(m[2]); if(!text||text.length<4||text.length>220)continue; if(!/(胜|負|负|和)/.test(text))continue; if(!/(hldcg|qipu|dhtmlxq|game)/i.test(href))continue; let detailUrl;try{detailUrl=new URL(href,baseUrl).href}catch{continue} if(seen.has(detailUrl))continue;seen.add(detailUrl);
    const mm=text.match(/(.+?)\s+(胜|負|负|和)\s+(.+)/);let red='',black='',result='未知'; if(mm){red=mm[1].trim();result=mm[2].replace('負','負').replace('负','負');black=mm[3].trim();}
    let year=null;const ym=text.match(/\b(19|20)\d{2}\b/);if(ym)year=Number(ym[0]);
    out.push({title:text,red,black,result,year,detailUrl,source:'dpxq-index',sourceUrl:baseUrl,opening:'',moves:[],tokens:null,exactMoves:null,notes:'由東萍公開索引同步；完整著法仍以原站頁面為準。'}); if(out.length>=100)break;
  } return out;
}
function parsePagination(html,baseUrl){
  const urls=[];const seen=new Set();const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(html))){const href=m[1],text=stripHtml(m[2]); if(!href||!text)continue; if(!/(下一頁|下页|下一页|next|>|»|末頁|末页|last)/i.test(text))continue; try{const u=new URL(href,baseUrl).href;if(/^https?:\/\/(www\.)?dpxq\.com\//i.test(u)&&!seen.has(u)){seen.add(u);urls.push(u)}}catch{}}
  return urls;
}
function importIndexItems(items){
  let added=0,updated=0; for(const x of items){const key=x.detailUrl || (x.title+'|'+x.sourceUrl);const existing=db.games.find(g=>g.source==='dpxq-index'&&(g.detailUrl===key||(g.red===x.red&&g.black===x.black&&g.event===x.title&&g.sourceUrl===x.sourceUrl)));const rec=normGame({...x,event:x.title,sourceUrl:x.sourceUrl,detailUrl:x.detailUrl},existing?.id||db.nextGameId++);if(existing){Object.assign(existing,rec);updated++;}else{db.games.push(rec);added++;}ensurePlayer(x.red);ensurePlayer(x.black);} saveDb();return {added,updated};}
function setSyncError(message){if(syncJob)syncJob.status='error',syncJob.error=message,syncJob.finishedAt=new Date().toISOString();}
async function runSync(job){
  try{
    const queue=[job.url];const visited=new Set();let page=0;
    while(queue.length && page<job.maxPages && !job.cancelled){
      const url=queue.shift(); if(visited.has(url))continue;visited.add(url);page++;job.page=page;job.currentUrl=url;job.status='running';
      const html=await fetchText(url); const items=parseDpxqIndex(html,url); let filtered=items;
      if(job.player) filtered=items.filter(x=>contains(x.red,job.player)||contains(x.black,job.player));
      const r=importIndexItems(filtered); job.found+=filtered.length;job.added+=r.added;job.updated+=r.updated;job.pagesDone=page;job.lastBatch=filtered.slice(0,20);job.players=db.players.length;job.games=db.games.length;
      const next=parsePagination(html,url); for(const n of next){if(!visited.has(n)&&!queue.includes(n)&&queue.length<job.maxPages)queue.push(n)}
      job.discovered=visited.size+queue.length; job.progress=Math.min(99,Math.round(page/job.maxPages*100));
      if(queue.length&&!job.cancelled)await sleep(2200);
    }
    job.progress=100;job.status=job.cancelled?'cancelled':'done';job.finishedAt=new Date().toISOString();job.pagesTotal=page;
  }catch(e){setSyncError(e.message);}
}
app.get('/api/dpxq/status',(req,res)=>res.json({lastFetch:dpxqLastFetch?new Date(dpxqLastFetch).toISOString():null,limitPerPage:100,maxPagesDefault:20,delayMs:2200,policy:'只匯入公開索引 metadata 與來源連結，不鏡像東萍整站棋譜內容。'}));
app.get('/api/dpxq/sync/status',(req,res)=>{if(!syncJob)return res.json({status:'idle',progress:0});const j={...syncJob};delete j.cancelled;res.json(j)});
app.post('/api/dpxq/sync/cancel',(req,res)=>{if(!syncJob||!['running','queued'].includes(syncJob.status))return res.json({ok:true,status:syncJob?.status||'idle'});syncJob.cancelled=true;syncJob.status='cancelled';res.json({ok:true});});
app.post('/api/dpxq/sync/start',(req,res)=>{
  if(syncJob&&['queued','running'].includes(syncJob.status))return res.status(409).json({error:'已有同步工作正在執行',jobId:syncJob.id});
  const url=String(req.body?.url||'').trim(); const player=String(req.body?.player||'').trim(); const maxPages=Math.max(1,Math.min(Number(req.body?.maxPages||20),100));
  if(!url)return res.status(400).json({error:'請提供東萍索引 URL'}); if(!/^https?:\/\/(www\.)?dpxq\.com\//i.test(url))return res.status(400).json({error:'目前只允許 dpxq.com 網址'});
  syncJob={id:Date.now().toString(36).toUpperCase(),status:'queued',url,player,maxPages,page:0,pagesDone:0,pagesTotal:0,progress:0,found:0,added:0,updated:0,players:db.players.length,games:db.games.length,currentUrl:'',discovered:1,lastBatch:[],startedAt:new Date().toISOString(),finishedAt:null,error:null,cancelled:false};
  runSync(syncJob);res.json({ok:true,jobId:syncJob.id});
});
app.post('/api/dpxq/import',async(req,res)=>{
  const url=String(req.body?.url||'').trim(); if(!url)return res.status(400).json({error:'請提供東萍索引 URL'}); if(!/^https?:\/\/(www\.)?dpxq\.com\//i.test(url))return res.status(400).json({error:'目前只允許 dpxq.com 網址'});
  if(syncJob&&['queued','running'].includes(syncJob.status))return res.status(409).json({error:'已有同步工作正在執行，請查看進度'});
  try{dpxqLastFetch=Date.now();const html=await fetchText(url);const items=parseDpxqIndex(html,url);const r=importIndexItems(items);res.json({ok:true,url,found:items.length,...r,players:db.players.length,games:db.games.length,items:items.slice(0,20)});}catch(e){res.status(502).json({error:'東萍索引抓取失敗：'+e.message});}
});


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
server.listen(PORT,()=>console.log(`\nXiangqi Web Suite V2.2 running at http://localhost:${PORT}\nData: ${DB_FILE}\n`));
