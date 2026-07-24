// CGC 카드별 등급분포 수집 — 우리 top10 카드가 "어떤 등급을 몇 장 받았는지"를 주간으로 쌓는다.
//
// CGC 세트 페이지는 Angular 렌더(원시 HTML 은 템플릿, API 는 외부호출 차단)라 **렌더된 DOM** 을 파싱해야 한다.
// 구조(2026-07-24 실측): 표 2개가 1:1 정렬 — 표1(카드번호/이름·변형/Total), 표2(Total, Perfect 10, Pristine 10,
// Gem Mint 10, Mint+ 9.5, 9, 8.5 … 24열). 페이지당 50행, 세트당 1~2페이지(?page=N, pagesize 파라미터는 무시됨).
//
// 절차(브라우저 javascript_tool):
//   1) --setup 출력 IIFE 를 cgccards.com 탭에서 실행 → 'cgc-ready'  (window.__cgcParse/__cgcStore 심음)
//   2) 각 세트 URL(?page=1, ?page=2)로 navigate 후 `await window.__cgcParse("OP-13")` 실행(표 렌더 대기 포함)
//   3) 전 세트 끝나면 `window.__cgcResult()` → 우리 추적카드만 필터된 작은 JSON 반환 → 파일 저장 → cgc-card-pop-ingest.js
//
// JP 세트 → CGC group id (2026-07-24 실측, base-expansion 리스트에서 수집):
const CGC_SETS = [
  ["OP-01", "romance-dawn-op01/31818"],
  ["OP-02", "paramount-war-op02/31821"],
  ["OP-03", "pillars-of-strength-op03/31827"],
  ["OP-04", "kingdoms-of-intrigue-op04/31828"],
  ["OP-05", "awakening-of-the-new-era-op05/31830"],
  ["OP-06", "wings-of-the-captain-op06/31843"],
  ["OP-07", "500-years-in-the-future-op07/31846"],
  ["OP-08", "two-legends-op08/31884"],
  ["OP-09", "emperors-in-the-new-world-op09/26073"],
  ["OP-10", "royal-blood-op10/31915"],
  ["OP-11", "a-fist-of-divine-speed-op11/31938"],
  ["OP-12", "legacy-of-the-master-op12/33478"],
  ["OP-13", "carrying-on-his-will-op13/33976"],
  ["OP-14", "the-azure-seas-seven-op14/34594"],
  ["OP-15", "adventure-on-kamis-island-op15/35193"],
  ["OP-16", "the-time-of-battle-op16/35886"],
  ["EB-01", "memorial-collection-eb01/31853"],
  ["EB-02", "anime-25th-collection-eb-02/33143"],
  ["EB-03", "heroines-edition-eb-03/34335"],
  ["EB-04", "egghead-crisis-eb-04/35092"],
  ["PRB-01", "premium-booster-the-best-prb-01/31890"],
  ["PRB-02", "premium-booster-the-best-vol.2-prb-02/33630"],
];
const BASE = "https://www.cgccards.com/population-report/tcg/one-piece/84/base-expansion/1982/";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

// 우리 추적카드 번호 목록(top10 전 세트) — 브라우저에서 이 번호만 남겨 페이로드를 줄인다.
function trackedNumbers() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
  const nums = new Set();
  for (const s of Object.values(data.sets)) for (const c of s.cards || []) {
    const n = (c.number || "").replace(/^#/, "").toUpperCase();
    if (n) nums.add(n);
  }
  return [...nums];
}

function setupScript() {
  const nums = trackedNumbers();
  return `(()=>{
window.__cgcNums=new Set(${JSON.stringify(nums)});
window.__cgcStore={};
window.__cgcParse=async(setCode)=>{
 for(let i=0;i<30;i++){await new Promise(z=>setTimeout(z,500));if([...document.querySelectorAll('table')].filter(t=>t.rows.length>3).length>=2)break;}
 const ts=[...document.querySelectorAll('table')].filter(t=>t.rows.length>3);
 if(ts.length<2)return JSON.stringify({err:'tables not ready',setCode});
 const info=ts[0],grade=ts[1];
 const gh=[...grade.rows[0].cells].map(c=>c.textContent.replace(/\\s+/g,' ').trim());
 const arr=window.__cgcStore[setCode]=window.__cgcStore[setCode]||[];
 let kept=0,total=0;
 for(let i=1;i<info.rows.length;i++){
  const numCell=(info.rows[i].cells[0]?.textContent||'').replace(/\\s+/g,' ').trim();
  const num=(numCell.split(' ')[0]||'').toUpperCase();
  const name=(info.rows[i].cells[1]?.textContent||'').replace(/\\s+/g,' ').trim();
  total++;
  if(!window.__cgcNums.has(num))continue;
  const g={};const cells=[...(grade.rows[i]?.cells||[])];
  for(let k=0;k<gh.length&&k<cells.length;k++){const v=parseInt((cells[k].textContent||'').replace(/,/g,''),10);if(Number.isFinite(v)&&v>0)g[gh[k]]=v;}
  arr.push({num,label:name.slice(0,80),grades:g});kept++;
 }
 return JSON.stringify({setCode,page:location.search,rows:total,kept});
};
window.__cgcResult=()=>JSON.stringify({source:'cgccards.com pop report (Japanese base expansion)',collectedAt:new Date().toISOString().slice(0,10),sets:window.__cgcStore});
return 'cgc-ready';})()`;
}

// ⚠️ CGC 는 URL 이동마다 풀 리로드라 window 상태가 죽는다 → 누적은 sessionStorage(같은 origin 유지됨)에.
// --snippet <SET>: 그 페이지를 파싱해 sessionStorage('cgcPop')에 누적하는 자립 IIFE 출력. navigate 후 실행(await).
// --result: sessionStorage 누적본을 덤프 JSON 문자열로 출력하는 IIFE.
function pageSnippet(setCode) {
  const nums = trackedNumbers();
  return `await (async()=>{
const NUMS=new Set(${JSON.stringify(nums)});
for(let i=0;i<30;i++){await new Promise(z=>setTimeout(z,500));if([...document.querySelectorAll('table')].filter(t=>t.rows.length>3).length>=2)break;}
const ts=[...document.querySelectorAll('table')].filter(t=>t.rows.length>3);
if(ts.length<2)return JSON.stringify({err:'tables not ready'});
const info=ts[0],grade=ts[1];
const gh=[...grade.rows[0].cells].map(c=>c.textContent.replace(/\\s+/g,' ').trim());
const store=JSON.parse(sessionStorage.getItem('cgcPop')||'{}');
const arr=store[${JSON.stringify(setCode)}]=store[${JSON.stringify(setCode)}]||[];
const seen=new Set(arr.map(r=>r.num+'|'+r.label));
let kept=0;
for(let i=1;i<info.rows.length;i++){
 const num=((info.rows[i].cells[0]?.textContent||'').replace(/\\s+/g,' ').trim().split(' ')[0]||'').toUpperCase();
 if(!NUMS.has(num))continue;
 const label=(info.rows[i].cells[1]?.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80);
 if(seen.has(num+'|'+label))continue;
 const g={};const cells=[...(grade.rows[i]?.cells||[])];
 for(let k=0;k<gh.length&&k<cells.length;k++){const v=parseInt((cells[k].textContent||'').replace(/,/g,''),10);if(Number.isFinite(v)&&v>0)g[gh[k]]=v;}
 arr.push({num,label,grades:g});kept++;
}
sessionStorage.setItem('cgcPop',JSON.stringify(store));
return JSON.stringify({set:${JSON.stringify(setCode)},kept,storeSets:Object.keys(store).length});
})()`;
}
const resultSnippet = `(()=>{const s=JSON.parse(sessionStorage.getItem('cgcPop')||'{}');return JSON.stringify({source:'cgccards.com pop report (Japanese base expansion)',collectedAt:new Date().toISOString().slice(0,10),sets:s});})()`;

module.exports = { CGC_SETS, BASE, setupScript, trackedNumbers, pageSnippet, resultSnippet };
if (require.main === module) {
  if (process.argv.includes("--setup")) console.log(setupScript());
  else if (process.argv.includes("--snippet")) console.log(pageSnippet(process.argv[process.argv.indexOf("--snippet") + 1] || "OP-01"));
  else if (process.argv.includes("--result")) console.log(resultSnippet);
  else if (process.argv.includes("--urls")) { for (const [c, p] of CGC_SETS) console.log(`${c}\t${BASE}${p}/?page=1\t${BASE}${p}/?page=2`); }
  else console.log("usage: node tools/cgc-card-pop.js --setup | --snippet <SET> | --result | --urls");
}
