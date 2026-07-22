// TAG pop 주간 수집용 브라우저 헬퍼 셋업 — my.taggrading.com 은 클라이언트 렌더+다운로드 차단이라
// (1) 연도 페이지를 pushState 로 돌며 표를 파싱해 window.__tagAll 에 누적하고,
// (2) 박스별로 집계해 ~1.5KB JSON 만 반환한다(대용량 raw exfil 불가 우회).
//
// 절차(브라우저 javascript_tool, 각 <45초):
//   node tools/tag-pop.js --setup 출력을 my.taggrading.com/pop-report/One Piece 탭에서 실행 → 'tag-ready'
//   await window.__tagYear('2005')  … '2022' '2023' '2024' '2026'   (각각 그 연도 표를 담음)
//   await window.__tagYear('2025')  →  await window.__tagPage2()      (2025 는 200행 초과라 2페이지)
//   window.__tagAgg()  →  { grader,collectedAt,boxes } JSON 문자열(작음) 반환 → 파일로 저장 → tag-pop-ingest.js
// 검증: __tagYear 는 그 연도 총계를 함께 반환하니, taggrading 랜딩의 연도별 Total graded 와 대조할 것.
//
// ⚠️ 매핑(EB=Extra Booster, PRB=Premium Booster The Best[/Vol.2], 비-박스 제외)은 tools/tag-classify.js 와
//    동일하게 유지한다(가드 Q3 가 노드쪽을 검증). 규칙 바꾸면 양쪽 다 고칠 것.
const fs = require("fs");
const path = require("path");
const { ALIASES } = require("./tag-classify");

function setupScript() {
  // ALIASES(정규식)를 브라우저로 넘기려고 소스 문자열로 직렬화
  const aliasSrc = "[" + ALIASES.map(([c, re]) => `["${c}",${re.toString()}]`).join(",") + "]";
  return `(()=>{
window.__tagAll={};
window.__tagParse=()=>{const trs=[...document.querySelectorAll('table tr')];let h=null;const out=[];
 for(const tr of trs){const c=[...tr.querySelectorAll('td,th')].map(x=>(x.textContent||'').replace(/\\s+/g,' ').trim());
  if(c[0]==='Grade'){h=c;continue;} if(!h||!c[0]||/^[\\d,]+$/.test(c[0]))continue;
  const g={};for(let i=1;i<h.length;i++)g[h[i]]=Number((c[i]||'0').replace(/,/g,''))||0;
  out.push({name:c[0],total:g['Total']||0,g10:g['10']||0,g10p:g['10P']||0});} return out;};
window.__tagYear=async(y)=>{const b=document.querySelector('table tr:nth-child(3) td')?.textContent||'';
 history.pushState({},'', '/pop-report/One Piece/'+y);window.dispatchEvent(new PopStateEvent('popstate'));
 for(let i=0;i<18;i++){await new Promise(z=>setTimeout(z,400));const n=document.querySelector('table tr:nth-child(3) td')?.textContent||'';if(n&&n!==b)break;}
 await new Promise(z=>setTimeout(z,1500));const r=window.__tagParse();window.__tagAll[y]=r;
 return JSON.stringify({year:y,rows:r.length,graded:r.reduce((a,x)=>a+x.total,0)});};
window.__tagPage2=async()=>{const el=[...document.querySelectorAll('button,[role=button]')].find(e=>/chevron_right/.test(e.textContent||'')&&!e.disabled);
 if(!el)return JSON.stringify({err:'no next'});el.click();await new Promise(z=>setTimeout(z,3200));
 const p2=window.__tagParse();const have=new Set((window.__tagAll['2025']||[]).map(s=>s.name));let add=0;
 for(const s of p2)if(!have.has(s.name)){window.__tagAll['2025'].push(s);have.add(s.name);add++;}
 return JSON.stringify({added:add,y2025:window.__tagAll['2025'].length,graded:window.__tagAll['2025'].reduce((a,x)=>a+x.total,0)});};
window.__tagAgg=()=>{const AL=${aliasSrc};
 const match=name=>{const n=String(name).replace(/^one piece\\s+/i,'').replace(/[\\u2019']/g,"'").trim();for(const[c,re] of AL)if(re.test(n))return{code:c,ed:/japanese/i.test(name)?'jp':'en'};return null;};
 const rows=Object.values(window.__tagAll).flat();const res={};
 for(const r of rows){const m=match(r.name);if(!m)continue;res[m.code]=res[m.code]||{jp:{total:0,gem:0},en:{total:0,gem:0}};res[m.code][m.ed].total+=r.total;res[m.code][m.ed].gem+=r.g10+r.g10p;}
 const boxes={};for(const[c,v] of Object.entries(res))boxes[c]={jp:v.jp.total?v.jp:null,en:v.en.total?v.en:null};
 return JSON.stringify({grader:'tag',collectedAt:new Date().toISOString().slice(0,10),boxes});};
return 'tag-ready';})()`;
}

module.exports = { setupScript };
if (require.main === module) {
  if (process.argv.includes("--setup")) console.log(setupScript());
  else console.log("usage: node tools/tag-pop.js --setup");
}
