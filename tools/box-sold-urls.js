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

module.exports = { rows, EXTRACTOR };

if (require.main === module) {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ rows, extractor: EXTRACTOR }, null, 1));
  } else {
    console.log(`# 박스 sold 수집 계획 (${rows.length} 세트) — 데이터 기준일: ${data.updated}`);
    console.log(`# 절차: 각 URL로 navigate → EXTRACTOR 실행 → 덤프 파일로 모아 box-sold-ingest.js 에 넣는다.`);
    for (const r of rows) console.log(`${r.code}\tEN ${r.enUrl}\n\tJP ${r.jpUrl}`);
    console.log(`\n# 수집기:\n${EXTRACTOR}`);
  }
}
