// TAG pop 주간 수집용 브라우저 헬퍼 셋업 — my.taggrading.com 은 클라이언트 렌더+다운로드 차단이라
// (1) 연도 페이지를 pushState 로 돌며 표를 파싱해 window.__tagAll 에 누적하고,
// (2) 박스별로 집계해 ~1.5KB JSON 만 반환한다(대용량 raw exfil 불가 우회).
//
// 절차(브라우저 javascript_tool, 각 <45초):
//   node tools/tag-pop.js --setup 출력을 my.taggrading.com/pop-report/One Piece 탭에서 실행 → 'tag-ready'
//   await window.__tagYear('2022')  … '2023' '2024' '2025' '2026'   (각 연도. 페이지가 여러 장이면 안에서 다 넘긴다)
//   window.__tagAgg()  →  { grader,collectedAt,boxes } JSON 문자열(작음) 반환 → 파일로 저장 → tag-pop-ingest.js
//
// ⚠️ 페이지네이션은 **연도마다 언제든 늘어난다**(한 페이지 200행). 2026-08-03 기준 2024=199행,
//    2025=232행(2페이지). 예전 코드는 2025 만 2페이지로 보고 `__tagPage2()` 를 손으로 부르게 했는데,
//    2024 가 199행까지 차 있어 다음 주에 200 을 넘기면 아무 신호 없이 뒷부분을 잃을 참이었다.
//    그래서 `__tagYear` 가 스스로 마지막 페이지까지 넘기고, 페이저의 "of N" 과 실제로 읽은 행 수를
//    대조해 `complete` 로 보고한다. complete:false 면 그 연도는 반쪽이니 적재하지 말 것.
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
// 페이저 문구 "1-200 of 232" 에서 총 행수를 읽는다. 못 읽으면 null(= 대조 불가).
window.__tagPagerTotal=()=>{const t=[...document.querySelectorAll('[class*=TablePagination],[class*=pagination]')].map(e=>e.textContent||'').join(' ');
 const m=t.match(/of\\s+([\\d,]+)/);return m?Number(m[1].replace(/,/g,'')):null;};
window.__tagNextPage=async()=>{const el=[...document.querySelectorAll('button,[role=button]')].find(e=>/chevron_right/.test(e.textContent||'')&&!e.disabled);
 if(!el)return false;el.click();await new Promise(z=>setTimeout(z,3200));return true;};
// 한 연도를 **마지막 페이지까지** 읽는다. 이름으로 중복 제거하고, 페이저 총계와 대조해 complete 를 붙인다.
window.__tagYear=async(y)=>{const b=document.querySelector('table tr:nth-child(3) td')?.textContent||'';
 history.pushState({},'', '/pop-report/One Piece/'+y);window.dispatchEvent(new PopStateEvent('popstate'));
 for(let i=0;i<18;i++){await new Promise(z=>setTimeout(z,400));const n=document.querySelector('table tr:nth-child(3) td')?.textContent||'';if(n&&n!==b)break;}
 await new Promise(z=>setTimeout(z,1500));
 const rows=[];const seen=new Set();let pages=0;
 for(let p=0;p<12;p++){pages++;
  for(const s of window.__tagParse()){if(seen.has(s.name))continue;seen.add(s.name);rows.push(s);}
  if(!(await window.__tagNextPage()))break;}
 window.__tagAll[y]=rows;
 const expected=window.__tagPagerTotal();
 // 표 파싱은 페이저 안내문 한 줄을 행으로 집기도 한다(total 0) — 대조는 그 여유를 두고 본다.
 const complete=expected==null?null:rows.length>=expected;
 return JSON.stringify({year:y,rows:rows.length,pages,expected,complete,graded:rows.reduce((a,x)=>a+x.total,0)});};
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
