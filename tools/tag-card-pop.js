// TAG 카드별 등급분포 수집 — 우리 top10 카드의 TAG 등급(1~10, 10P)을 주간 append-only 로 쌓는다.
//
// TAG 포털은 SPA(pushState 이동 시 window 유지) + 표가 렌더 DOM. 구조(실측 2026-07-24):
//   연도 페이지(/pop-report/One Piece/{year})의 세트행 링크 → 세트 페이지(카드별 행: Card#, Name, VA,1..10,10P,Total)
//   변형은 "세트 이름"에 붙는다: "... Japanese Alternate Art", "... Japanese Manga Alternate Art", "... Japanese SP" 등.
//
// 절차(브라우저 javascript_tool):
//   1) /pop-report/One Piece/2022 등 아무 연도 페이지에서 --setup IIFE 실행 → 'tagcard-ready'
//   2) 각 연도에서: await window.__tagCardYear('2025')  — 그 연도의 우리 박스 관련 일본판 세트들을 내부 이동으로
//      순회하며 추적카드 행을 window.__tagCards 에 누적(한 호출에 최대 MAXV 세트, 반환값으로 남은 수 확인,
//      남았으면 같은 호출을 다시 — 이어서 돈다).
//   3) window.__tagCardResult() → 작은 JSON 반환 → 파일 저장 → node tools/tag-card-pop-ingest.js <파일>
const fs = require("fs");
const path = require("path");
const { ALIASES } = require("./tag-classify");
const ROOT = path.join(__dirname, "..");

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
  const aliasSrc = "[" + ALIASES.map(([c, re]) => `["${c}",${re.toString()}]`).join(",") + "]";
  return `(()=>{
window.__tagNums=new Set(${JSON.stringify(trackedNumbers())});
window.__tagAliases=${aliasSrc};
window.__tagCards=window.__tagCards||[];
window.__tagVisited=window.__tagVisited||{};
window.__tagMatchBox=(name)=>{const n=String(name).replace(/^one piece\\s+/i,"").replace(/[\\u2019']/g,"'").trim();for(const[c,re] of window.__tagAliases)if(re.test(n))return c;return null;};
window.__tagNavParse=async(href)=>{
 history.pushState({},"",href);window.dispatchEvent(new PopStateEvent("popstate"));
 let rows=[];for(let i=0;i<24;i++){await new Promise(z=>setTimeout(z,400));const trs=[...document.querySelectorAll("table tr")];if(trs.length>2&&/Card #/i.test((trs[1]||trs[0]).textContent||"")){rows=trs;break;}}
 if(!rows.length)return {err:"no table"};
 let header=null;const out=[];
 for(const tr of rows){const c=[...tr.querySelectorAll("td,th")].map(x=>(x.textContent||"").replace(/\\s+/g," ").trim());
  if(c[0]==="Card #"){header=c;continue;}
  if(!header||!c[0])continue;
  const num=(c[0].split(" ")[0]||"").toUpperCase();
  if(!window.__tagNums.has(num))continue;
  const g={};for(let k=2;k<header.length&&k<c.length;k++){const v=parseInt((c[k]||"0").replace(/,/g,""),10);if(Number.isFinite(v)&&v>0)g[header[k]]=v;}
  out.push({num,grades:g});
 }
 return {rows:out};
};
window.__tagCardYear=async(year,MAXV=8)=>{
 // 연도 페이지로 이동 후 우리 박스 관련 일본판 세트 링크 수집
 history.pushState({},"","/pop-report/One Piece/"+year);window.dispatchEvent(new PopStateEvent("popstate"));
 for(let i=0;i<24;i++){await new Promise(z=>setTimeout(z,400));if([...document.querySelectorAll("table a")].length>3)break;}
 const links=[...document.querySelectorAll("table a")].map(a=>({t:(a.textContent||"").replace(/\\s+/g," ").trim(),h:a.getAttribute("href")||""}))
  .filter(x=>/Japanese/.test(x.t)&&window.__tagMatchBox(x.t));
 let visited=0,keptTotal=0;
 for(const l of links){
  const key=year+"|"+l.t;
  if(window.__tagVisited[key])continue;
  if(visited>=MAXV)break;
  const box=window.__tagMatchBox(l.t);
  const r=await window.__tagNavParse(l.h);
  window.__tagVisited[key]=true;visited++;
  if(r.rows)for(const row of r.rows){window.__tagCards.push({box,tagSet:l.t.slice(0,80),num:row.num,grades:row.grades});keptTotal+=1;}
  // 연도 페이지로 복귀
  history.pushState({},"","/pop-report/One Piece/"+year);window.dispatchEvent(new PopStateEvent("popstate"));
  for(let i=0;i<16;i++){await new Promise(z=>setTimeout(z,350));if([...document.querySelectorAll("table a")].length>3)break;}
 }
 const remaining=links.filter(l=>!window.__tagVisited[year+"|"+l.t]).length;
 return JSON.stringify({year,visited,kept:keptTotal,remaining,cardsTotal:window.__tagCards.length});
};
window.__tagCardResult=()=>JSON.stringify({source:"my.taggrading.com pop report",collectedAt:new Date().toISOString().slice(0,10),cards:window.__tagCards});
return 'tagcard-ready';})()`;
}

module.exports = { setupScript, trackedNumbers };
if (require.main === module) {
  if (process.argv.includes("--setup")) console.log(setupScript());
  else console.log("usage: node tools/tag-card-pop.js --setup");
}
