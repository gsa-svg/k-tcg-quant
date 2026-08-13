#!/usr/bin/env node
// 박스 sold(실거래) 수집용 URL·수집기 출력 — 브라우저 배치로 원장(ledger) 원료를 긁기 위한 헬퍼.
// sold는 eBay가 서버/API를 막아 "실제 브라우저(사용자 IP)"로만 수집 가능.
// **즉시구매(LH_BIN=1)만 받는다.** 이 원장은 즉시구매 시세용이다 — 경매는 별도로 모은다.
// 경매 낙찰가는 입찰이 안 붙으면 시세보다 훨씬 낮게 끝나서, 섞으면 시세가 아니라 잡음이 된다.
// (2026-08-13 실측: OP-01 일본판 한 세트에만 경매 69건이 섞여 있었다.)
// 필터를 거는 편이 240건 상한에도 유리하다 — 전체 237 중 즉구는 226 이 따로 다 들어온다.
//
// **가격대로 쪼개서 받는다.** eBay 는 한 검색에 240~265건까지만 준다. `_pgn=2` 는 무시된다
// (2페이지가 1페이지와 231건 겹쳤다). 그래서 그 이상은 검색 자체를 나눠야 얻는다.
// 2026-08-13 실측 — 단일 검색 대비 5구간 분할:
//   OP-01 일본판 263 → 742건 (2.8배) · OP-12 일본판 255 → 807건 (3.2배) · OP-05 영문판 139 → 853건 (6.1배)
// 즉 그동안 실거래의 1/3~1/6 만 보고 있었다.
//
// **카테고리(_sacat=261068)를 반드시 건다.** 이게 밴드 분할보다 효과가 크다.
// 키워드만으로 검색하면 결과 대부분이 다른 세트·다른 상품이라, 240건 상한이 쓰레기로 채워진다.
// 2026-08-13 실측 — 같은 240건 안에 들어오는 '진짜 그 세트' 매물:
//   OP-01 일본판 30 → 209건 · OP-12 일본판 38 → 191건 · OP-05 영문판 125 → 221건
// 카테고리 없이 밴드만 나눴을 때 OP-01 일본판은 582건을 받아도 실제 OP-01 은 23건뿐이었다.
//
// ⚠️ _udlo/_udhi 는 **화면에 보이는 통화** 기준이다. 이 수집은 계정 표시통화가 KRW 인
//    브라우저에서 돌리므로 구간도 원화다. 표시통화가 바뀌면 구간이 통째로 어긋나
//    한 구간에만 몰린다(실제로 달러 구간으로 잡았더니 3개가 0건이었다).
// 판별(일본판/영문판)은 제목 키워드가 아니라 eBay 의 `&Language=Japanese|English` 패싯으로 나눈다 —
// 판매자가 신고한 값이라 추측이 아니다. 제목만 보던 때는 언어 미표기로 614건을 통째로 버렸다(2026-08-12 실측). 이 스크립트는 수집 자체는 못 하고,
// (1) 전 세트 EN/JP eBay 판매완료 검색 URL과 (2) 붙여넣을 수집기 JS를 뽑아준다.
//
// 수집기는 판정하지 않는다 — 페이지의 판매건 전부를 {id,제목,판매일,표시가,통화}로 그대로 반환한다.
// 박스여부·다수량 개당가·언어·세트 판정은 전부 노드(tools/box-sold-ingest.js + lot-quantity.js)에서 한다.
// 규칙을 한 곳에 두기 위함이고, 가드 Q1이 그 판정을 코퍼스로 검증한다.
//
// 절차: node tools/box-sold-urls.js --json → 각 URL로 navigate + EXTRACTOR 실행 → 결과를
//   {collectedAt, pages:[{code, query:"jp"|"en", items:[...]}]} 덤프 파일로 모아 →
//   node tools/box-sold-ingest.js <dump.json> → node tools/build-box-sold-series.js
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

// ⚠️ 검색 URL 은 한 번에 240건(_ipg=240)까지만 준다. `_sop=13`(최근 종료순)이라 잘리는 건 항상 **오래된 쪽**이고,
//    주 3회 수집하므로 실무상 손실은 없다. 다만 "잘렸다"는 사실은 알아야 하므로 페이지마다 필터 전 원시 카드 수(rawN)를
//    기록하고, 240 이상이면 __runBatch 가 capped 로 세어 보고한다. capped 가 늘면 수집 주기를 좁히거나 검색어를 쪼갤 것.
//
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
  return `(()=>{const CODES=${JSON.stringify(codes)};const q=s=>encodeURIComponent(s).replace(/%20/g,'+');const BANDS=[[0,80000],[80000,150000],[150000,300000],[300000,600000],[600000,0]];const SACAT='261068';const mk=(kw,lang,lo,hi)=>'https://www.ebay.com/sch/i.html?_nkw='+q(kw)+'&_sacat='+SACAT+'&LH_Sold=1&LH_Complete=1&_ipg=240&_sop=13&LH_BIN=1&Language='+lang+(lo?'&_udlo='+lo:'')+(hi?'&_udhi='+hi:'');const P=[];for(const c of CODES){const prb=c.startsWith('PRB');const kw=prb?'One Piece '+c+' Premium Booster box':'One Piece '+c+' booster box';for(const [lo,hi] of BANDS){P.push({code:c,query:'jp',fmt:'bin',band:lo,url:mk(kw,'Japanese',lo,hi)});P.push({code:c,query:'en',fmt:'bin',band:lo,url:mk(kw,'English',lo,hi)});}}window.__PAGES=P;window.__opDump={collectedAt:new Date().toISOString().slice(0,10),langFacet:true,fmtSplit:true,pages:[]};window.__grab=async u=>{let h;try{h=await fetch(u,{credentials:'include'}).then(r=>r.text());}catch(e){return{robot:false,items:[]};}if(/Pardon our interruption|Checking your browser|captcha/i.test(h.slice(0,4000)))return{robot:true,items:[]};const doc=new DOMParser().parseFromString(h,'text/html');const cards=doc.querySelectorAll('.s-card,li.s-item');const rawN=cards.length;const out=[];for(const c of cards){const a=c.querySelector('a[href*="/itm/"]');const m=a&&(a.getAttribute('href')||'').match(/\\/itm\\/(\\d+)/);if(!m||m[1]==='123456')continue;const t=((c.querySelector('.su-styled-text.primary')||c.querySelector('.s-item__title'))?.textContent||'').replace(/New Listing/ig,'').trim();if(!/booster box/i.test(t))continue;const d=((c.querySelector('.s-card__caption,.s-item__caption'))?.textContent||'').trim();const pT=((c.querySelector('.s-card__price,.s-item__price'))?.textContent||'').trim();const p=pT.replace(/,/g,'').match(/([\\d.]+)/);if(!t||!d||!p)continue;out.push({id:m[1],t:t.slice(0,140),d:d.slice(0,32),k:parseFloat(p[1]),cur:/KRW|\\u20a9/.test(pT)?'KRW':/\\$/.test(pT)?'USD':'OTHER'});}return{robot:false,items:out,rawN};};window.__runBatch=async(s,n)=>{const e=Math.min(s+n,window.__PAGES.length);let rob=0,cap=0;for(let i=s;i<e;i++){const pg=window.__PAGES[i];const r=await window.__grab(pg.url);if(r.robot)rob++;if(r.rawN>=240)cap++;window.__opDump.pages.push({code:pg.code,query:pg.query,fmt:pg.fmt,band:pg.band,items:r.items,rawN:r.rawN});await new Promise(z=>setTimeout(z,550));}return JSON.stringify({done:window.__opDump.pages.length,of:window.__PAGES.length,robots:rob,capped:cap,items:window.__opDump.pages.reduce((a,p)=>a+p.items.length,0)});};window.__opDownload=fn=>{const seen=new Set(),uniq=[];for(const p of window.__opDump.pages){const k=p.code+'/'+p.query+'/'+p.fmt+'/'+p.band;if(seen.has(k))continue;seen.add(k);uniq.push(p);}const full=JSON.stringify({collectedAt:window.__opDump.collectedAt,langFacet:true,fmtSplit:true,pages:uniq});const b=new Blob([full],{type:'application/json'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=fn;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);return JSON.stringify({saved:fn,bytes:full.length,pages:uniq.length,items:uniq.reduce((x,p)=>x+p.items.length,0)});};return 'ready:'+window.__PAGES.length+' pages';})()`;
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
    console.log(`# 표준 경로: --setup 배치(10페이지씩, CDP 45초 타임아웃 회피). --collector 단일샷은 세트가 늘어 타임아웃 위험 — 소규모 테스트 전용.`);
    for (const r of rows) console.log(`${r.code}\tEN ${r.enUrl}\n\tJP ${r.jpUrl}`);
  }
}
