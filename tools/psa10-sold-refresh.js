#!/usr/bin/env node
// PSA10 sold(실거래) 재수집용 계획 출력 — card.psa10Ebay(6/29 고정)를 브라우저로 새로 뽑기 위한 헬퍼.
// sold는 eBay가 API/서버를 막아 "실제 브라우저(claude-in-chrome)"로만 수집됨. 이 스크립트는 각 카드의
// (1) eBay 판매완료 검색 URL 과 (2) 붙여넣을 변형-인식 추출기(검증됨: 레드망가↔망가 분리 확인)를 출력한다.
//
// 절차: node tools/psa10-sold-refresh.js [--json] [--top N] [--set OP-13]
//   → 각 카드 url로 navigate + extractor 실행(browser_batch, 3~4장씩) → 결과 {number:{median,low,high,n}} 수집
//   → tools/psa10-sold-write.js 로 box/card 데이터에 기록(아래 참고) 또는 수동 반영.
// ⚠️ 정확도: 변형(레드망가/망가/SP/parallel) 매칭이 사고지점. 추출기의 variantOK 로직 절대 완화 금지.
//   sold값이 기존값과 대역 다르거나 표본 n<3 이면 채택 금지(불확실하면 6/29 값 유지).
const fs = require("fs");
const path = require("path");
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "onepiece-packs.json"), "utf8"));
const R = data.fx.usdKrw || 1548.63;
const compact = (s) => String(s || "").replace(/[^a-z0-9]/gi, "").toUpperCase();

const args = process.argv.slice(2);
const topN = args.includes("--top") ? Number(args[args.indexOf("--top") + 1]) : 0;
const onlySet = args.includes("--set") ? args[args.indexOf("--set") + 1] : null;

let cards = [];
for (const [code, s] of Object.entries(data.sets)) {
  if (onlySet && code !== onlySet) continue;
  for (const c of (s.cards || [])) {
    if (!c.psa10Ebay?.soldBased) continue;
    const usd = c.psa10Ebay.currency === "USD" ? c.psa10Ebay.middle : (c.psa10Ebay.middle / R);
    cards.push({ code, number: c.number, name: c.name, rarity: c.rarity, oldUsd: Math.round(usd), oldN: c.psa10Ebay.sampleSize, oldDate: c.psa10Ebay.updated });
  }
}
cards.sort((a, b) => b.oldUsd - a.oldUsd); // 가치 높은 순(랭킹 우선)
if (topN) cards = cards.slice(0, topN);

// 변형-인식 추출기 생성 (per card, NUM/NAMERAR 임베드). variantOK 는 update-ebay-psa10-active-links.js 의 hasVariantSignal 이식.
function makeExtractor(card) {
  const num = compact(card.number);
  const namerar = `${card.name || ""} ${card.rarity || ""}`.toLowerCase();
  return `(()=>{const R=${R};const NUM=${JSON.stringify(num)};const NAMERAR=${JSON.stringify(namerar)};const premium=/manga|comic|super\\s*parall|super\\s*alt/;const cp=s=>String(s||'').replace(/[^a-z0-9]/gi,'').toUpperCase();function vOK(t){t=t.toLowerCase();const n=NAMERAR;if(/signature|stamped|stamp/.test(n))return /signature|signed|stamped|stamp/.test(t);if(/\\bred\\b/.test(n))return /\\bred\\b/.test(t)&&premium.test(t);if(/manga|comic|\\bsuper\\b/.test(n))return premium.test(t);if(/\\bsp\\b|speci[a4]l/.test(n))return (/\\bsp\\b|speci[a4]l/.test(t))&&!premium.test(t);if(/parallel|alternate/.test(n))return (/parallel|alternate|alt\\s*art|paralle/.test(t))&&!premium.test(t)&&!(/\\bsp\\b|speci[a4]l|red\\s*text/.test(t));return true;}const C=[...document.querySelectorAll('.s-card,li.s-item')],v=[];for(const c of C){let t=(c.querySelector('.su-styled-text.primary')?.textContent||'').replace(/New Listing/ig,'').trim();if(!t)continue;if(!/psa\\s*10|gem\\s*mint\\s*10/i.test(t))continue;if(/psa\\s*[1-9]\\b(?!0)|bgs|cgc|ars|raw|ungraded/i.test(t))continue;if(/english|\\beng\\b|korean|chinese/i.test(t))continue;if(!cp(t).includes(NUM))continue;if(!vOK(t))continue;const p=(c.querySelector('.s-card__price,.s-item__price')?.textContent||'').replace(/,/g,'').match(/([\\d.]+)/);if(!p)continue;const k=parseFloat(p[1]);if(!(k>8000))continue;v.push(k/R);}const st=a=>{if(a.length<3)return null;const s=[...a].sort((x,y)=>x-y);const Q=pp=>s[Math.min(s.length-1,Math.max(0,Math.round(pp*(s.length-1))))];const m=s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;return{median:Math.round(m),low:Math.round(Q(0.25)),high:Math.round(Q(0.75)),n:s.length};};return ${JSON.stringify(card.number)}+' '+JSON.stringify(st(v));})()`;
}

const first = (card) => (card.name || "").split(/\s+/).slice(0, 2).join(" ");
const rows = cards.map((c) => ({
  code: c.code, number: c.number, name: c.name, oldUsd: c.oldUsd, oldN: c.oldN,
  url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`One Piece ${c.number} ${first(c)} PSA 10 Japanese`).replace(/%20/g, "+")}&LH_Sold=1&LH_Complete=1&_ipg=240`,
  extractor: makeExtractor(c),
}));

if (args.includes("--json")) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  console.log(`# PSA10 sold 재수집 계획 — ${rows.length}장 (가치 높은 순). 데이터 기준: ${data.updated}. 현재 sold 전부 ${cards[0]?.oldDate} 고정.`);
  console.log(`# 각 카드: url 로 navigate + extractor 실행(browser_batch 3~4장). 결과를 psa10Ebay.{middle,low,high,sampleSize,updated}에 반영(KRW기준이면 middle=median*fx).`);
  console.log(`# ⚠️ n<3 또는 기존값과 대역 크게 다르면 채택 금지. variantOK 완화 금지.\n`);
  for (const r of rows) console.log(`${r.number}\t(old $${r.oldUsd}/n${r.oldN})\t${r.url}`);
}
