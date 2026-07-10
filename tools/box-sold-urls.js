#!/usr/bin/env node
// 박스 sold(실거래) 재수집용 URL·추출기 출력 — 브라우저 배치로 빠르게 재수집하기 위한 헬퍼.
// sold는 eBay가 서버/API를 막아 "실제 브라우저(사용자 IP)"로만 수집 가능. 이 스크립트는 수집 자체는 못 하고,
// 재수집을 5분 배치로 만들 수 있게 (1) 전 세트 EN/JP eBay 판매완료 검색 URL과 (2) 붙여넣을 추출기 JS를 뽑아준다.
// 절차: node tools/box-sold-urls.js  →  각 URL로 navigate + 추출기 실행(browser_batch) → 결과를 boxMarket.[en|jp].ebaySold에 기록.
// Run: node tools/box-sold-urls.js [--json]
const fs = require("fs");
const path = require("path");
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "onepiece-packs.json"), "utf8"));
const ORDER = [...data.jp.list, ...data.extra.list].filter((c) => data.sets[c]);
const q = (s) => encodeURIComponent(s).replace(/%20/g, "+");
const base = "https://www.ebay.com/sch/i.html?_nkw=";
const tail = "&LH_Sold=1&LH_Complete=1&_ipg=240";

const rows = ORDER.map((code) => {
  const name = data.sets[code].nameEn || "";
  const prb = code.startsWith("PRB");
  const enKw = prb ? `One Piece ${code} Premium Booster box` : `One Piece ${code} booster box`;
  const jpKw = prb ? `One Piece ${code} Premium Booster box Japanese` : `One Piece ${code} booster box Japanese sealed`;
  return { code, name, enUrl: base + q(enKw) + tail, jpUrl: base + q(jpKw) + tail };
});

// 추출기(붙여넣기용). {CODE} 를 세트코드로 치환해서 각 페이지에서 실행.
const EXTRACTOR = `(()=>{const CODE=/{CODE_RE}/i;const R=${data.fx.usdKrw||1548.63},C=[...document.querySelectorAll('.s-card,li.s-item')],jp=[],en=[];const bx=/booster box/i,bad=/\\bpack\\b|packs|\\blot\\b|\\bcase\\b|display|sleeve|bundle|choose|\\bx\\s?\\d|blister|tin|topper|deck|\\bcards?\\b/i;for(const c of C){let t=(c.querySelector('.su-styled-text.primary')?.textContent||'').replace(/New Listing/ig,'').trim();if(!t||!bx.test(t)||bad.test(t)||!CODE.test(t))continue;const p=(c.querySelector('.s-card__price,.s-item__price')?.textContent||'').replace(/,/g,'').match(/([\\d.]+)/);if(!p)continue;const k=parseFloat(p[1]);if(!(k>90000))continue;const u=k/R;if(/chinese|simplified/i.test(t))continue;if(/english|\\beng\\b/i.test(t))en.push(u);else if(/japanese|japan/i.test(t))jp.push(u);}const st=a=>{if(a.length<3)return null;const s=[...a].sort((x,y)=>x-y);const Q=pp=>s[Math.min(s.length-1,Math.max(0,Math.round(pp*(s.length-1))))];const m=s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;return{median:Math.round(m),low:Math.round(Q(0.25)),high:Math.round(Q(0.75)),n:s.length};};return JSON.stringify({en:st(en),jp:st(jp)});})()`;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ rows, extractor: EXTRACTOR }, null, 1));
} else {
  console.log(`# 박스 sold 재수집 계획 (${rows.length} 세트) — 데이터 기준일: ${data.updated}`);
  console.log(`# 절차: 각 세트 EN은 enUrl(영문 검색), JP는 jpUrl(일본어 검색)로 navigate 후 추출기 실행. 결과를 boxMarket.[en|jp].ebaySold에 기록.`);
  console.log(`# EN/JP 통합 판정: sold값이 우리 active(호가)의 0.5~1.5배면 정상. 표본 n>=3. sold는 as-of 날짜 필수.\n`);
  for (const r of rows) console.log(`${r.code}\tEN ${r.enUrl}\n\tJP ${r.jpUrl}`);
  console.log(`\n# 추출기(각 페이지에서 실행, {CODE_RE}=세트코드 정규식 예: OP[-\\\\s]?13):\n${EXTRACTOR}`);
}
