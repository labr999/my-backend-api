const express=require('express');
const http=require('http');
const path=require('path');
const fs=require('fs');
const {execFile}=require('child_process');
const iconv=require('iconv-lite');
const {Server}=require('socket.io');
const {chromium}=require('playwright');

const APP_VERSION='2.9.1';
const DISPLAY_VERSION='V2.9.1';

// 只同步指定大師或使用者搜尋的棋手；絕不做全站/全庫同步。
const DPXQ_BASE='http://www.dpxq.com/hldcg/search/';
const MASTER_PLAYERS=[
  ['王天一','特級大師'],['許銀川','特級大師'],['呂欽','特級大師'],['胡榮華','特級大師'],['柳大華','特級大師'],
  ['曹岩磊','特級大師'],['趙國榮','特級大師'],['趙鑫鑫','特級大師'],['陶漢明','特級大師'],['葛振衣','棋手'],
  ['趙奕帆','棋手'],['劉安生','棋手'],['吳貴臨','棋手'],['李思誼','棋手'],['孟繁睿','棋手'],
  ['馮家俊','棋手'],['賴理','棋手'],['楊官璘','特級大師']
].map(([name,title],i)=>({id:i+1,name,title}));
const MAX_PLAYER_PAGES=Math.max(1,Number(process.env.DPXQ_MAX_PAGES||5));
const MAX_PLAYER_GAMES=Math.max(1,Number(process.env.DPXQ_MAX_GAMES||100));
const ROOT=__dirname;
const DATA_DIR=process.env.DATA_DIR||path.join(ROOT,'data');
const DB_FILE=process.env.DATA_FILE||path.join(DATA_DIR,'xiangqi-db.json');
const PORT=Number(process.env.PORT||3000);
fs.mkdirSync(DATA_DIR,{recursive:true});
function readJson(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return d;}}
function save(){const t=DB_FILE+'.tmp';fs.writeFileSync(t,JSON.stringify(db,null,2),'utf8');fs.renameSync(t,DB_FILE);}
let db=readJson(DB_FILE,{players:[],games:[],nextGameId:1});
if(!Array.isArray(db.players))db.players=[];if(!Array.isArray(db.games))db.games=[];db.nextGameId=Number(db.nextGameId)||1;
for(const mp of MASTER_PLAYERS){if(!db.players.some(p=>p.name===mp.name))db.players.push({...mp});}
save();

const app=express();const server=http.createServer(app);const io=new Server(server);
app.use(express.json({limit:'20mb'}));app.use(express.static(path.join(ROOT,'public')));

function ensurePlayer(name,title=''){name=String(name||'').trim();if(!name||name==='未知紅方'||name==='未知黑方')return;if(!db.players.some(p=>p.name===name))db.players.push({id:db.players.length+1,name,title});}
function norm(g){return {id:g.id||db.nextGameId++,red:g.red||'未知紅方',black:g.black||'未知黑方',result:g.result||'未知',event:g.event||'',year:g.year?Number(g.year):null,date:g.date||'',round:g.round||'',place:g.place||'',opening:g.opening||classifyOpening(g.tokens||[]),tokens:Array.isArray(g.tokens)?g.tokens:[],moves:Array.isArray(g.moves)?g.moves:[],exactMoves:Array.isArray(g.exactMoves)?g.exactMoves:[],source:g.source||'user',sourceUrl:g.sourceUrl||'',detailUrl:g.detailUrl||'',format:g.format||'',fen:g.fen||'',dpxqBinit:g.dpxqBinit||'',dpxqMovelist:g.dpxqMovelist||'',rawExport:g.rawExport||'',validation:g.validation||'',created_at:g.created_at||new Date().toISOString()};}
function addGame(g){const rec=norm(g);const key=(rec.detailUrl||'')+'|'+rec.red+'|'+rec.black+'|'+rec.date+'|'+rec.event+'|'+rec.tokens.join(' ');const old=db.games.find(x=>((x.detailUrl||'')+'|'+x.red+'|'+x.black+'|'+x.date+'|'+x.event+'|'+(x.tokens||[]).join(' '))===key);if(old){Object.assign(old,rec,{id:old.id});return {game:old,duplicate:true};}db.games.push(rec);ensurePlayer(rec.red);ensurePlayer(rec.black);save();return {game:rec,duplicate:false};}
function classifyOpening(t){const s=(t||[]).slice(0,10).join(' ');if(/炮二平五|砲二平五/.test(s))return '中炮';if(/馬二進三.*馬8進7|马二进三.*马8进7/.test(s))return '中炮屏風馬';if(/相三進五|相七進五|象3进5|象7进5/.test(s))return '飛相局';if(/兵三進一|兵7进1/.test(s))return '仙人指路';if(/炮二平四|砲二平四/.test(s))return '仕角炮';if(/馬二進三|马二进三/.test(s))return '馬蹄局/起馬';return s?'其他開局':'未分類';}

const RNUM=['','一','二','三','四','五','六','七','八','九'];
const TYPE={R:'車',N:'馬',B:'相',A:'仕',K:'帥',C:'砲',P:'兵',r:'車',n:'馬',b:'象',a:'士',k:'將',c:'砲',p:'卒'};
function inB(c,r){return c>=0&&c<9&&r>=0&&r<10;}
function palace(side,c,r){return c>=3&&c<=5&&(side==='r'?r>=7&&r<=9:r<=2);}
function river(side,r){return side==='r'?r<=4:r>=5;}
function cat(t){return {車:'R',车:'R',馬:'N',马:'N',相:'B',象:'B',仕:'A',士:'A',帥:'K',帅:'K',將:'K',将:'K',砲:'C',炮:'C',兵:'P',卒:'P'}[t]||null;}
function decodeBinit(v){const s=String(v||'').replace(/[^0-9]/g,'');const base=['R','N','B','A','K','A','B','N','R','C','C','P','P','P','P','P'];const pieces=[];if(s.length<64)return pieces;for(let i=0;i<32;i++){const c=Number(s.slice(i*2,i*2+1)),r=Number(s.slice(i*2+1,i*2+2));if(inB(c,r))pieces.push({side:i<16?'r':'b',type:TYPE[i<16?base[i]:base[i-16].toLowerCase()],col:c,row:r,alive:true});}return pieces;}
function board(pieces){const b=Array.from({length:10},()=>Array(9).fill(null));for(const p of pieces)if(p.alive&&inB(p.col,p.row))b[p.row][p.col]=p;return b;}
function legal(b,side){const out=[];const push=(fc,fr,tc,tr)=>{if(!inB(tc,tr)||b[tr][tc]?.side===side)return;out.push({fc,fr,tc,tr});};for(let r=0;r<10;r++)for(let c=0;c<9;c++){const p=b[r][c];if(!p||p.side!==side)continue;const k=cat(p.type);if(k==='R'){for(const[dC,dR]of[[1,0],[-1,0],[0,1],[0,-1]]){let x=c+dC,y=r+dR;while(inB(x,y)){push(c,r,x,y);if(b[y][x])break;x+=dC;y+=dR;}}}else if(k==='C'){for(const[dC,dR]of[[1,0],[-1,0],[0,1],[0,-1]]){let x=c+dC,y=r+dR,screen=false;while(inB(x,y)){if(!screen){if(!b[y][x])push(c,r,x,y);else screen=true;}else if(b[y][x]){push(c,r,x,y);break;}x+=dC;y+=dR;}}}else if(k==='N'){for(const[dC,dR,lC,lR]of[[1,2,0,1],[-1,2,0,1],[1,-2,0,-1],[-1,-2,0,-1],[2,1,1,0],[2,-1,1,0],[-2,1,-1,0],[-2,-1,-1,0]])if(inB(c+dC,r+dR)&&!b[r+lR][c+lC])push(c,r,c+dC,r+dR);}else if(k==='B'){for(const[dC,dR]of[[2,2],[2,-2],[-2,2],[-2,-2]]){const x=c+dC,y=r+dR;if(inB(x,y)&&river(side,y)&&!b[r+dR/2][c+dC/2])push(c,r,x,y);}}else if(k==='A'){for(const[dC,dR]of[[1,1],[1,-1],[-1,1],[-1,-1]]){const x=c+dC,y=r+dR;if(inB(x,y)&&palace(side,x,y))push(c,r,x,y);}}else if(k==='K'){for(const[dC,dR]of[[1,0],[-1,0],[0,1],[0,-1]]){const x=c+dC,y=r+dR;if(inB(x,y)&&palace(side,x,y))push(c,r,x,y);}let y=r+(side==='r'?-1:1);while(inB(c,y)){if(b[y][c]){if(b[y][c].side!==side&&cat(b[y][c].type)==='K')push(c,r,c,y);break;}y+=side==='r'?-1:1;}}else if(k==='P'){const d=side==='r'?-1:1;if(inB(c,r+d))push(c,r,c,r+d);if(river(side,r)){if(inB(c-1,r))push(c,r,c-1,r);if(inB(c+1,r))push(c,r,c+1,r);}}}return out;}
function decodeMoves(binit,movelist){const pieces=decodeBinit(binit);const s=String(movelist||'').replace(/[^0-9]/g,'');const exact=[],tokens=[];let side='r',valid=true,reason='';for(let i=0;i+3<s.length;i+=4){const fc=+s[i],fr=+s[i+1],tc=+s[i+2],tr=+s[i+3];const p=pieces.find(x=>x.alive&&x.col===fc&&x.row===fr);if(!p||p.side!==side){valid=false;reason='DhtmlXQ 起始位置與著法無法對應';break;}const ok=legal(board(pieces),side).some(m=>m.fc===fc&&m.fr===fr&&m.tc===tc&&m.tr===tr);if(!ok){valid=false;reason='DhtmlXQ 著法無法通過基本棋規';break;}const cap=pieces.find(x=>x.alive&&x.col===tc&&x.row===tr&&x!==p);tokens.push(`${p.type}${fc},${fr}-${tc},${tr}`);exact.push({from:[fc,fr],to:[tc,tr]});if(cap)cap.alive=false;p.col=tc;p.row=tr;side=side==='r'?'b':'r';}return {exactMoves:exact,tokens,valid,reason,plies:exact.length};}

function htmlDecode(s){return String(s||'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');}
function strip(s){return htmlDecode(String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());}
function tag(text,name){const re=new RegExp('\\[DhtmlXQ_'+name+'\\]([\\s\\S]*?)(?:\\[\\/DhtmlXQ_'+name+'\\]|(?=\\[DhtmlXQ_|$))','i');const m=String(text||'').match(re);return m?htmlDecode(m[1].trim()):'';}
function parseDhtml(html){const text=String(html||'');const blocks=[];const wrapped=text.match(/\[DhtmlXQ\][\s\S]*?\[\/DhtmlXQ\]/gi)||[text];for(const b of wrapped){const get=n=>tag(b,n);const movelist=get('movelist');const binit=get('binit');const red=get('redname')||get('red');const black=get('blackname')||get('black');if(!(movelist||binit||red||black))continue;const d=get('date');const dm=d.match(/(19|20)\d{2}/);const dec=movelist&&binit?decodeMoves(binit,movelist):{exactMoves:[],tokens:[],valid:false,reason:'缺少 binit 或 movelist',plies:0};blocks.push({red,black,result:get('result'),event:get('event')||get('class'),year:dm?+dm[0]:null,date:d,round:get('round'),place:get('place'),opening:get('open'),binit,movelist,fen:get('fen'),dec});}return blocks;}
function parseWxf(text){const clean=strip(text);const m=clean.match(/(?:前|中|後)?[車车馬马炮砲相象仕士帥帅將将兵卒][一二三四五六七八九1-9](?:平|進|退)[一二三四五六七八九1-9]/g)||[];return [...new Set(m)];}
function extractExport(html){const blocks=parseDhtml(html);const wxf=parseWxf(html);return {blocks,wxf};}

function normalizeDpxqUrl(url){let u=String(url||'').trim();if(/^https:\/\/((www\.)?dpxq\.com)/i.test(u))u='http://'+u.replace(/^https:\/\//i,'');if(!/^http:\/\/((www\.)?dpxq\.com)\//i.test(u))throw new Error('只允許 http://www.dpxq.com/ 公開網址');return u;}
async function fetchWithBrowser(url){url=normalizeDpxqUrl(url);const browser=await chromium.launch({headless:true});try{const page=await browser.newPage({locale:'zh-TW'});page.setDefaultTimeout(10000);await page.goto(url,{waitUntil:'domcontentloaded',timeout:10000});await page.waitForTimeout(500);let downloads=[];page.on('download',d=>downloads.push(d));const exportLoc=page.getByText(/棋譜自動導出|棋谱自动导出|棋譜導出|棋谱导出|導出|导出/).first();if(await exportLoc.count()){try{await exportLoc.click({timeout:3000});await page.waitForTimeout(700);}catch{}}const content=await page.content();let exportText='';if(downloads.length){try{exportText=await downloads[0].createReadStream().then(async rs=>{const chunks=[];for await(const c of rs)chunks.push(c);return Buffer.concat(chunks).toString('utf8');});}catch{}}return {content,exportText,finalUrl:page.url(),title:await page.title()};}finally{await browser.close();}}

let syncJob=null;function emitProgress(p){if(syncJob)syncJob={...syncJob,...p};io.emit('dpxq:progress',syncJob);}
async function importOne(url){const r=await fetchWithBrowser(url);const src=r.exportText||r.content;const {blocks,wxf}=extractExport(src);if(blocks.length){const results=[];for(const b of blocks){const d=b.dec;const g={red:b.red,black:b.black,result:b.result,event:b.event,year:b.year,date:b.date,round:b.round,place:b.place,opening:b.opening||classifyOpening(d.tokens),tokens:d.tokens,exactMoves:d.exactMoves,moves:d.exactMoves,source:'dpxq-playwright',sourceUrl:'http://www.dpxq.com/',detailUrl:r.finalUrl,format:'DhtmlXQ',fen:b.fen,dpxqBinit:b.binit,dpxqMovelist:b.movelist,rawExport:src,validation:d.valid?`OK ${d.plies} plies`:d.reason};results.push(addGame(g));}return {results,blocks:blocks.length,wxf};}
if(wxf.length){const g={red:'未知紅方',black:'未知黑方',tokens:wxf,opening:classifyOpening(wxf),moves:[],exactMoves:[],source:'dpxq-playwright',detailUrl:r.finalUrl,format:'WXF',rawExport:src,validation:'僅取得 WXF 文字，尚未轉成座標'};return {results:[addGame(g)],blocks:0,wxf};}throw new Error('已開啟東萍頁面，但沒有找到 DhtmlXQ / WXF 導出資料');}

app.get('/api/health',(q,s)=>s.json({ok:true,service:'xiangqi-web-suite',version:APP_VERSION,displayVersion:DISPLAY_VERSION,storage:'json',playwright:true,time:new Date().toISOString()}));
app.get('/api/stats',(q,s)=>s.json({players:db.players.length,games:db.games.length,playableGames:db.games.filter(g=>g.exactMoves?.length||g.moves?.length).length}));
app.get('/api/players',(q,s)=>{const term=String(q.query.q||'').trim().toLowerCase();const items=db.players.filter(p=>!term||p.name.toLowerCase().includes(term)).map(p=>({...p,games:db.games.filter(g=>g.red===p.name||g.black===p.name).length})).sort((a,b)=>b.games-a.games);s.json({items,total:items.length});});
app.get('/api/players/:name',(q,s)=>{const name=decodeURIComponent(q.params.name);const p=db.players.find(x=>x.name===name);if(!p)return s.status(404).json({error:'找不到棋手'});const games=db.games.filter(g=>g.red===name||g.black===name).sort((a,b)=>(b.year||0)-(a.year||0)||b.id-a.id);let wins=0,losses=0,draws=0;for(const g of games){if(/和/.test(g.result||''))draws++;else if(/^紅|^红/.test(g.result||''))g.red===name?wins++:losses++;else if(/^黑/.test(g.result||''))g.black===name?wins++:losses++;}s.json({player:{...p,games:games.length},games,stats:{games:games.length,wins,losses,draws,winRate:(wins+losses+draws)?Number((wins/(wins+losses+draws)*100).toFixed(1)):0}});});
app.get('/api/games',(q,s)=>{const {q:term='',player='',opening='',year='',playable=''}=q.query;let a=db.games.filter(g=>(!term||[g.red,g.black,g.event,g.opening,g.tokens.join(' ')].some(x=>String(x||'').includes(term)))&&(!player||g.red===player||g.black===player)&&(!opening||g.opening===opening)&&(!year||String(g.year||'')===String(year))&&(!playable||((g.exactMoves?.length||g.moves?.length)>0)));s.json({items:a.sort((x,y)=>y.id-x.id).slice(0,1000),total:a.length});});
app.get('/api/games/:id',(q,s)=>{const g=db.games.find(x=>String(x.id)===String(q.params.id));if(!g)return s.status(404).json({error:'找不到棋譜'});s.json(g);});
app.post('/api/games',(q,s)=>{const r=addGame(q.body||{});s.status(r.duplicate?200:201).json({ok:true,duplicate:r.duplicate,game:r.game});});
app.get('/api/dpxq/source',(q,s)=>s.json({name:'東萍象棋網',url:DPXQ_BASE,policy:'只同步預設大師或使用者搜尋的棋手；不做全站同步。單頁 10 秒 timeout、最多 3 次重試。'}));
app.get('/api/dpxq/masters',(q,s)=>s.json({items:MASTER_PLAYERS,baseUrl:DPXQ_BASE,maxPages:MAX_PLAYER_PAGES,maxGames:MAX_PLAYER_GAMES}));
app.get('/api/dpxq/progress',(q,s)=>s.json(syncJob||{running:false}));
app.post('/api/dpxq/test',async(q,s)=>{try{const r=await fetchWithBrowser(q.body?.url||DPXQ_BASE);s.json({ok:true,title:r.title,url:normalizeDpxqUrl(r.finalUrl)});}catch(e){s.status(502).json({ok:false,error:e.message});}});

function absoluteDpxq(href,base){try{const u=new URL(href,base);if(!/^(www\.)?dpxq\.com$/i.test(u.hostname))return null;u.protocol='http:';return u.href;}catch{return null;}}
function looksLikeGameUrl(u){return /(?:chess|play|show|hldcg\/.*(?:\d|chess)|dhtml)/i.test(u)||/\.asp(?:\?|$)/i.test(u);}
async function discoverPlayerPages(player){
  const browser=await chromium.launch({headless:true});
  const found=[]; const seen=new Set(); const pages=[DPXQ_BASE];
  try{
    for(let pageNo=0;pageNo<MAX_PLAYER_PAGES && pages.length && found.length<MAX_PLAYER_GAMES;pageNo++){
      const url=pages.shift(); if(seen.has(url))continue; seen.add(url);
      const page=await browser.newPage({locale:'zh-TW'}); page.setDefaultTimeout(10000);
      try{
        await page.goto(url,{waitUntil:'domcontentloaded',timeout:10000}); await page.waitForTimeout(400);
        // 優先使用頁面內真正的搜尋表單：找出文字輸入框，將棋手名填入最可能的欄位，按查詢/搜尋。
        const inputs=page.locator('input[type="text"],input:not([type])');
        const count=await inputs.count();
        let submitted=false;
        for(let i=0;i<count;i++){
          const el=inputs.nth(i); const ph=((await el.getAttribute('placeholder'))||'')+' '+((await el.getAttribute('name'))||'')+' '+((await el.getAttribute('id'))||'');
          if(/棋手|姓名|红方|紅方|黑方|player|name/i.test(ph)||count<=3){
            try{await el.fill(player);submitted=true;break;}catch{}
          }
        }
        if(submitted){
          const btn=page.getByRole('button',{name:/搜索|搜尋|查询|查詢|确定|確定/i}).first();
          if(await btn.count()){try{await btn.click({timeout:3000});await page.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>{});}catch{}}
          else {await inputs.nth(0).press('Enter').catch(()=>{}); await page.waitForTimeout(600);}
        }
        const links=await page.locator('a[href]').evaluateAll(as=>as.map(a=>({href:a.href,text:(a.textContent||'').trim()})));
        for(const x of links){const u=absoluteDpxq(x.href,page.url());if(!u)continue; if(looksLikeGameUrl(u) && (x.text.includes(player)||x.text.length>2)){if(!found.includes(u))found.push(u);}}
        // 找下一頁，只在搜尋結果頁內往後走。
        for(const x of links){const u=absoluteDpxq(x.href,page.url());if(!u)continue;if(/下一|下页|下頁|next|>/.test(x.text)||/page|pageno|pageindex/i.test(u)){if(!seen.has(u)&&!pages.includes(u))pages.push(u);}}
      }finally{await page.close().catch(()=>{});}
    }
    return found.slice(0,MAX_PLAYER_GAMES);
  }finally{await browser.close().catch(()=>{});}
}
async function syncPlayer(player){
  player=String(player||'').trim(); if(!player)throw new Error('請提供棋手姓名');
  const urls=await discoverPlayerPages(player); if(!urls.length)throw new Error(`東萍搜尋頁沒有找到「${player}」的可用棋譜連結`);
  let added=0,duplicates=0,errors=0,processed=0; const results=[];
  for(const u of urls){
    if(processed>=MAX_PLAYER_GAMES)break;
    try{const r=await importOne(u);for(const x of r.results||[]){processed++;if(x.duplicate)duplicates++;else added++;results.push(x);if(processed>=MAX_PLAYER_GAMES)break;}}
    catch(e){errors++;results.push({ok:false,url:u,error:e.message});}
  }
  ensurePlayer(player); save();
  return {player,pagesChecked:Math.min(MAX_PLAYER_PAGES,urls.length),discovered:urls.length,processed,added,duplicates,errors,results};
}
app.post('/api/dpxq/sync-player',async(q,s)=>{
  if(syncJob?.running)return s.status(409).json({error:'已有同步工作執行中'});
  const player=String(q.body?.player||'').trim(); if(!player)return s.status(400).json({error:'請提供棋手姓名'});
  syncJob={running:true,mode:'player',player,processed:0,added:0,duplicates:0,errors:0,pages:0,message:`準備同步 ${player}（最多 ${MAX_PLAYER_PAGES} 頁／${MAX_PLAYER_GAMES} 盤）`};emitProgress({});
  try{const r=await syncPlayer(player);Object.assign(syncJob,r,{running:false,message:`${player} 完成：新增 ${r.added}、重複 ${r.duplicates}、錯誤 ${r.errors}`});emitProgress({});s.json({ok:true,stats:syncJob,results:r.results});}
  catch(e){syncJob.running=false;syncJob.errors=(syncJob.errors||0)+1;syncJob.message=e.message;emitProgress({});s.status(502).json({ok:false,stats:syncJob,error:e.message});}
});

app.post('/api/dpxq/import',async(q,s)=>{if(syncJob?.running)return s.status(409).json({error:'已有同步工作執行中'});const url=normalizeDpxqUrl(q.body?.url);if(!url)return s.status(400).json({error:'請提供東萍網址'});syncJob={running:true,url,processed:0,added:0,duplicates:0,errors:0,message:'啟動 Playwright…'};emitProgress({});try{let last;for(let i=1;i<=3;i++){try{syncJob.message=`第 ${i}/3 次：開啟東萍並執行導出`;emitProgress({});last=await importOne(url);break;}catch(e){syncJob.errors++;syncJob.message=e.message;if(i<3)await new Promise(r=>setTimeout(r,i*1000));else throw e;}}const rr=last.results||[];syncJob.processed=rr.length;syncJob.added=rr.filter(x=>!x.duplicate).length;syncJob.duplicates=rr.filter(x=>x.duplicate).length;syncJob.running=false;syncJob.message=`完成：新增 ${syncJob.added}、重複 ${syncJob.duplicates}、錯誤 ${syncJob.errors}`;emitProgress({});s.json({ok:true,stats:syncJob,results:rr});}catch(e){syncJob.running=false;syncJob.message=e.message;emitProgress({});s.status(502).json({ok:false,stats:syncJob,error:e.message});}});

app.get('/api/opening/classify',(q,s)=>s.json({opening:classifyOpening(String(q.query.moves||'').split(/\s+/))}));

// Express 5：不能使用 app.get('*')，改用最後一層 middleware 作為 SPA fallback。
app.use((req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));
server.listen(PORT,'0.0.0.0',()=>console.log(`xiangqi-web-suite ${DISPLAY_VERSION} listening on ${PORT}`));
