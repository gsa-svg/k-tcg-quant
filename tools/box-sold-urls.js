#!/usr/bin/env node
// 박스 sold(실거래) 수집용 URL·수집기 출력 — 브라우저 배치로 원장(ledger) 원료를 긁기 위한 헬퍼.
// sold는 eBay가 서버/API를 막아 "실제 브라우저(사용자 IP)"로만 수집 가능. 이 스크립트는 수집 자체는 못 하고,
// (1) 전 세트 EN/JP eBay 판매완료 검색 URL과 (2) 붙여넣을 수집기 JS를 뽑아준다.
//
// 수집기는 판정하지 않는다 — 페이지의 판매건 전부를 {id,제목,판매일,표시가,통화}로 그대로 반환한다.
// 박스여부·다수량 개당가·언어·세트 판정은 전부 노드(tools/box-sold-ingest.js + lot-quantity.js)에서 한다.
// 규칙을 한 곳에 두기 위함이고, 가드 Q1이 그 판정을 코퍼스로 검증한다.
//
// 절차: node tools/box-sold-urls.js --json → 각 URL로 navigate + EXTRACTOR 실행 → 결과를
//   {collectedAt, pages:[{code, query:"jp"|"en", items:[...]}]} 덤프 파일로 모아 →
//   node tools/box-sold-ingest.js <dump.json> → node tools/append-box-sold-series.js
// Run: node tools/box-sold-urls.js [--json]
const fs = require("fs");
const path = require("path");
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "onepiece-packs.json"), "utf8"));
const ORDER = [...data.jp.list, ...data.extra.list].filter((c) => data.sets[c]);
const q = (s) => encodeURIComponent(s).replace(/%20/g, "+");
const base = "https://www.ebay.com/sch/i.html?_nkw=";
// _sop=13 = 최근 종료순 정렬. 240건 상한에 걸릴 때 최신 판매가 잘리지 않게 한다.
const tail = "&LH_Sold=1&LH_Complete=1&_ipg=240&_sop=13";

const rows = ORDER.map((code) => {
  const name = data.sets[code].nameEn || "";
  const prb = code.startsWith("PRB");
  const enKw = prb ? `One Piece ${code} Premium Booster box` : `One Piece ${code} booster box`;
  const jpKw = prb ? `One Piece ${code} Premium Booster box Japanese` : `One Piece ${code} booster box Japanese sealed`;
  return { code, name, enUrl: base + q(enKw) + tail, jpUrl: base + q(jpKw) + tail };
});

// 수집기(붙여넣기용, 판정 없음): 실제 카드 전부 → [{id,t(제목),d("Sold ..."),k(표시가),cur(KRW|USD|OTHER)}]
// 광고 카드(id 123456)와 제목/날짜/가격이 빠진 카드만 거른다. 2026-07-22 실DOM(s-card + su-styled-text) 확인됨.
const EXTRACTOR = `(()=>{const out=[];for(const c of document.querySelectorAll('.s-card,li.s-item')){const a=c.querySelector('a[href*="/itm/"]');const m=a&&a.href.match(/\\/itm\\/(\\d+)/);if(!m||m[1]==='123456')continue;const t=((c.querySelector('.su-styled-text.primary')||c.querySelector('.s-item__title'))?.textContent||'').replace(/New Listing/ig,'').trim();const d=((c.querySelector('.s-card__caption,.s-item__caption'))?.textContent||'').trim();const pTxt=((c.querySelector('.s-card__price,.s-item__price'))?.textContent||'').trim();const p=pTxt.replace(/,/g,'').match(/([\\d.]+)/);if(!t||!d||!p)continue;out.push({id:m[1],t:t.slice(0,140),d,k:parseFloat(p[1]),cur:/KRW|\\u20a9/.test(pTxt)?'KRW':/\\$/.test(pTxt)?'USD':'OTHER'});}return JSON.stringify({n:out.length,items:out});})()`;

// 자립 브라우저 수집기(--collector): 페이지 이동 없이 in-page fetch(credentials:include)로
// 전 세트 EN/JP sold 페이지를 긁어 덤프 JSON을 통째로 반환한다. 사용자 실브라우저 탭 하나에서
// javascript_tool 한 번으로 실행 → 반환 문자열을 dump.json 으로 저장 → box-sold-ingest.js 에 투입.
// URL을 코드에 박아 넣어 브라우저가 세트목록을 몰라도 되게 한다. 로봇페이지는 robot:true로 표시하고 건너뛴다.
function collectorScript() {
  const pages = [];
  for (const r of rows) { pages.push({ code: r.code, query: "jp", url: r.jpUrl }); pages.push({ code: r.code, query: "en", url: r.enUrl }); }
  return `(async()=>{const PAGES=${JSON.stringify(pages)};const grab=async(u)=>{let html;try{html=await fetch(u,{credentials:'include'}).then(r=>r.text());}catch(e){return{robot:false,err:String(e),items:[]};}if(/Pardon our interruption|Checking your browser|captcha/i.test(html.slice(0,4000)))return{robot:true,items:[]};const doc=new DOMParser().parseFromString(html,'text/html');const out=[];for(const c of doc.querySelectorAll('.s-card,li.s-item')){const a=c.querySelector('a[href*="/itm/"]');const m=a&&(a.getAttribute('href')||'').match(/\\/itm\\/(\\d+)/);if(!m||m[1]==='123456')continue;const t=((c.querySelector('.su-styled-text.primary')||c.querySelector('.s-item__title'))?.textContent||'').replace(/New Listing/ig,'').trim();if(!/booster box/i.test(t))continue;const d=((c.querySelector('.s-card__caption,.s-item__caption'))?.textContent||'').trim();const pTxt=((c.querySelector('.s-card__price,.s-item__price'))?.textContent||'').trim();const p=pTxt.replace(/,/g,'').match(/([\\d.]+)/);if(!t||!d||!p)continue;out.push({id:m[1],t:t.slice(0,140),d:d.slice(0,32),k:parseFloat(p[1]),cur:/KRW|\\u20a9/.test(pTxt)?'KRW':/\\$/.test(pTxt)?'USD':'OTHER'});}return{robot:false,items:out};};const out={collectedAt:new Date().toISOString().slice(0,10),pages:[]};let robots=0;for(const pg of PAGES){const r=await grab(pg.url);if(r.robot)robots++;out.pages.push({code:pg.code,query:pg.query,items:r.items});await new Promise(z=>setTimeout(z,700));}out.robots=robots;out.totalItems=out.pages.reduce((a,p)=>a+p.items.length,0);return JSON.stringify(out);})()`;
}

// 배치 수집 셋업(--setup): 브라우저에 상태·헬퍼를 심는다. 42페이지를 한 번에 긁으면 CDP 45초
// 타임아웃에 걸리므로, 10페이지씩 나눠 window.__opDump 에 누적한 뒤 파일로 내려받는다.
// tool 반환값은 잘리므로(대용량 exfil 불가) 결과 전달은 반드시 Blob 다운로드로 한다.
// 사용법(브라우저 javascript_tool):
//   1) <setup 스크립트>            → 'ready'
//   2) await window.__runBatch(0,10)  … (10,10) (20,10) (30,12) 순차           → 진행 요약
//   3) window.__opDownload('opbox-box-sold-YYYY-MM-DD.json')                    → Downloads 에 저장
// 그 뒤 노드에서 그 파일을 box-sold-ingest.js 에 투입.
function setupScript() {
  const codes = [...data.jp.list, ...data.extra.list].filter((c) => data.sets[c]);
  return `(()=>{const CODES=${JSON.stringify(codes)};const q=s=>encodeURIComponent(s).replace(/%20/g,'+');const mk=kw=>'https://www.ebay.com/sch/i.html?_nkw='+q(kw)+'&LH_Sold=1&LH_Complete=1&_ipg=240&_sop=13';const P=[];for(const c of CODES){const prb=c.startsWith('PRB');P.push({code:c,query:'jp',url:mk(prb?'One Piece '+c+' Premium Booster box Japanese':'One Piece '+c+' booster box Japanese sealed')});P.push({code:c,query:'en',url:mk(prb?'One Piece '+c+' Premium Booster box':'One Piece '+c+' booster box')});}window.__PAGES=P;window.__opDump={collectedAt:new Date().toISOString().slice(0,10),pages:[]};window.__grab=async u=>{let h;try{h=await fetch(u,{credentials:'include'}).then(r=>r.text());}catch(e){return{robot:false,items:[]};}if(/Pardon our interruption|Checking your browser|captcha/i.test(h.slice(0,4000)))return{robot:true,items:[]};const doc=new DOMParser().parseFromString(h,'text/html');const out=[];for(const c of doc.querySelectorAll('.s-card,li.s-item')){const a=c.querySelector('a[href*="/itm/"]');const m=a&&(a.getAttribute('href')||'').match(/\\/itm\\/(\\d+)/);if(!m||m[1]==='123456')continue;const t=((c.querySelector('.su-styled-text.primary')||c.querySelector('.s-item__title'))?.textContent||'').replace(/New Listing/ig,'').trim();if(!/booster box/i.test(t))continue;const d=((c.querySelector('.s-card__caption,.s-item__caption'))?.textContent||'').trim();const pT=((c.querySelector('.s-card__price,.s-item__price'))?.textContent||'').trim();const p=pT.replace(/,/g,'').match(/([\\d.]+)/);if(!t||!d||!p)continue;out.push({id:m[1],t:t.slice(0,140),d:d.slice(0,32),k:parseFloat(p[1]),cur:/KRW|\\u20a9/.test(pT)?'KRW':/\\$/.test(pT)?'USD':'OTHER'});}return{robot:false,items:out};};window.__runBatch=async(s,n)=>{const e=Math.min(s+n,window.__PAGES.length);let rob=0;for(let i=s;i<e;i++){const pg=window.__PAGES[i];const r=await window.__grab(pg.url);if(r.robot)rob++;window.__opDump.pages.push({code:pg.code,query:pg.query,items:r.items});await new Promise(z=>setTimeout(z,550));}return JSON.stringify({done:window.__opDump.pages.length,of:window.__PAGES.length,robots:rob,items:window.__opDump.pages.reduce((a,p)=>a+p.items.length,0)});};window.__opDownload=fn=>{const seen=new Set(),uniq=[];for(const p of window.__opDump.pages){const k=p.code+'/'+p.query;if(seen.has(k))continue;seen.add(k);uniq.push(p);}const full=JSON.stringify({collectedAt:window.__opDump.collectedAt,pages:uniq});const b=new Blob([full],{type:'application/json'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=fn;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);return JSON.stringify({saved:fn,bytes:full.length,pages:uniq.length,items:uniq.reduce((x,p)=>x+p.items.length,0)});};return 'ready:'+window.__PAGES.length+' pages';})()`;
}

module.exports = { rows, EXTRACTOR, collectorScript, setupScript };

if (require.main === module) {
  if (process.argv.includes("--setup")) {
    console.log(setupScript());
  } else if (process.argv.includes("--collector")) {
    console.log(collectorScript());
  } else if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ rows, extractor: EXTRACTOR }, null, 1));
  } else {
    console.log(`# 박스 sold 수집 계획 (${rows.length} 세트) — 데이터 기준일: ${data.updated}`);
    console.log(`# 빠른 경로: node tools/box-sold-urls.js --collector 를 브라우저 javascript_tool 로 1회 실행 → 반환 JSON을 dump.json 으로 저장 → node tools/box-sold-ingest.js dump.json`);
    for (const r of rows) console.log(`${r.code}\tEN ${r.enUrl}\n\tJP ${r.jpUrl}`);
  }
}
