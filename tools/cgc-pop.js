// CGC pop 주간 수집용 브라우저 수집기 — Base Expansion(부스터박스) 목록을 파싱해 박스별 총 그레이딩수 집계.
// 개별 카드/등급분포는 담지 않는다(박스 총량만).
//
// ⚠️ 목록은 **페이지네이션된다**(2026-08-03 확인, 그날 2페이지). 세트가 늘면 페이지도 늘어난다.
//    2026-07-22·07-27 수집이 1페이지만 읽어 **일본판 7세트(OP-01·06·08·10·14·16·PRB-02)가 통째로 빠진 채**
//    적재됐다(커버리지 36 vs 실제 43). 빠진 줄도 몰랐다 — 없는 세트와 안 읽은 세트가 구분이 안 됐기 때문이다.
//    그래서 이제 수집기는 **자기가 몇 페이지째이고 다음 페이지가 있는지(hasNext)** 를 같이 보고하고,
//    ingest 는 마지막 페이지가 hasNext=true 면 **적재를 거부**한다. 페이지가 늘어도 조용히 새지 않는다.
//
// 대상 URL: https://www.cgccards.com/population-report/tcg/one-piece/84/base-expansion/1982/
//   페이지 2 이상은 `?page=N` 으로 직접 연다.
//
// 절차(브라우저):
//   1) pageUrl(1) 로 navigate → collectorScript() 실행 → 결과 JSON 을 파일로 저장
//   2) 결과의 hasNext 가 true 면 pageUrl(2) 로 navigate → 같은 스크립트 → 또 저장 … hasNext=false 까지 반복
//   3) node tools/cgc-pop-ingest.js <page1.json> <page2.json> …   (여러 파일을 합쳐서 적재)
//
// 제목 형식(실측 2026-07-22): "{SetName} ({CODE}) - {English|Japanese}\t{count}". CODE 에서 OP/EB/PRB+2자리를 딴다.
// ST(스타터덱) 등 부스터박스가 아닌 코드는 자동 제외.
const BASE_URL = "https://www.cgccards.com/population-report/tcg/one-piece/84/base-expansion/1982/";

const pageUrl = (n) => (n > 1 ? `${BASE_URL}?page=${n}` : BASE_URL);

function collectorScript(page = 1) {
  return `(async()=>{
await new Promise(z=>setTimeout(z,3500));
const bt=document.body.innerText;
const re=/([A-Za-z0-9\\u2019'.\\-\\/ ]+?)\\s*\\(([A-Z0-9\\-]+)\\)\\s*-\\s*(English|Japanese)\\s*[\\t ]*([\\d,]+)/g;
const norm=c=>{const o=c.match(/OP-?(\\d{2})/i);if(o)return 'OP-'+o[1];const e=c.match(/EB-?(\\d{2})/i);if(e)return 'EB-'+e[1];const p=c.match(/PRB-?(\\d{2})/i);if(p)return 'PRB-'+p[1];return null;};
const agg={};let m,rows=0,allRows=0;
while((m=re.exec(bt))){allRows++;const code=norm(m[2]);if(!code)continue;rows++;const ed=m[3]==='Japanese'?'jp':'en';agg[code]=agg[code]||{};agg[code][ed]=(agg[code][ed]||0)+ (+m[4].replace(/,/g,''));}
const boxes={};for(const[c,v] of Object.entries(agg))boxes[c]={jp:v.jp||null,en:v.en||null};
// 다음 페이지 유무. 페이저는 a.ccg-pager-{first,prev,next,last} 이고, last 의 href 가 마지막 페이지 번호를
// 그대로 알려준다(실측 2026-08-03) — 그게 가장 확실하니 우선 쓴다. 없으면 next 의 disabled 여부로 본다.
// 둘 다 못 읽었는데 행이 있으면 hasNext=true 로 둔다: 조용히 누락하느니 한 번 더 열어보는 게 낫다.
const pageNo=${Number(page) || 1};
const hrefPage=el=>{const h=el&&el.getAttribute('href')||'';const m=h.match(/[?&]page=(\\d+)/);return m?Number(m[1]):null;};
const lastPage=hrefPage(document.querySelector('a.ccg-pager-last'));
const nextEl=document.querySelector('a.ccg-pager-next');
const nextDisabled=nextEl?/\\bdisabled\\b/i.test(nextEl.className||''):null;
const hasNext=allRows===0?false:(lastPage!=null?pageNo<lastPage:(nextEl?!nextDisabled:true));
return JSON.stringify({grader:'cgc',collectedAt:new Date().toISOString().slice(0,10),page:pageNo,hasNext,lastPage,boxes,_rows:rows,_allRows:allRows,_boxes:Object.keys(boxes).length});})()`;
}

module.exports = { BASE_URL, pageUrl, collectorScript };
if (require.main === module) {
  if (process.argv.includes("--collector")) console.log(collectorScript(Number(process.argv[process.argv.indexOf("--collector") + 1]) || 1));
  else console.log(`URL(1): ${pageUrl(1)}\nURL(2): ${pageUrl(2)}\nusage: node tools/cgc-pop.js --collector [page]\n페이지는 hasNext=false 가 나올 때까지 반복해서 읽고, 모든 페이지 파일을 cgc-pop-ingest.js 에 함께 넘긴다.`);
}
