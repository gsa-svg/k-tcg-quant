// CGC pop 주간 수집용 브라우저 수집기 — Base Expansion(부스터박스) 페이지 한 장만 파싱해 박스별 총 그레이딩수 집계.
// TAG와 달리 단일 페이지·페이지네이션 없음이라 간단하다. 개별 카드/등급분포는 담지 않는다(박스 총량만).
//
// 대상 URL: https://www.cgccards.com/population-report/tcg/one-piece/84/base-expansion/1982/
// 절차(브라우저): 위 URL 로 navigate → 아래 collectorScript() 실행 → { grader:'cgc', collectedAt, boxes } JSON 반환 → 파일 저장 → cgc-pop-ingest.js
//
// 제목 형식(실측 2026-07-22): "{SetName} ({CODE}) - {English|Japanese}\t{count}". CODE 에서 OP/EB/PRB+2자리를 딴다.
// ST(스타터덱) 등 부스터박스가 아닌 코드는 자동 제외.
const BASE_URL = "https://www.cgccards.com/population-report/tcg/one-piece/84/base-expansion/1982/";

function collectorScript() {
  return `(async()=>{
await new Promise(z=>setTimeout(z,3500));
const bt=document.body.innerText;
const re=/([A-Za-z0-9\\u2019'.\\-\\/ ]+?)\\s*\\(([A-Z0-9\\-]+)\\)\\s*-\\s*(English|Japanese)\\s*[\\t ]*([\\d,]+)/g;
const norm=c=>{const o=c.match(/OP-?(\\d{2})/i);if(o)return 'OP-'+o[1];const e=c.match(/EB-?(\\d{2})/i);if(e)return 'EB-'+e[1];const p=c.match(/PRB-?(\\d{2})/i);if(p)return 'PRB-'+p[1];return null;};
const agg={};let m,rows=0;
while((m=re.exec(bt))){const code=norm(m[2]);if(!code)continue;rows++;const ed=m[3]==='Japanese'?'jp':'en';agg[code]=agg[code]||{};agg[code][ed]=(agg[code][ed]||0)+ (+m[4].replace(/,/g,''));}
const boxes={};for(const[c,v] of Object.entries(agg))boxes[c]={jp:v.jp||null,en:v.en||null};
return JSON.stringify({grader:'cgc',collectedAt:new Date().toISOString().slice(0,10),boxes,_rows:rows,_boxes:Object.keys(boxes).length});})()`;
}

module.exports = { BASE_URL, collectorScript };
if (require.main === module) {
  if (process.argv.includes("--collector")) console.log(collectorScript());
  else console.log("URL: " + BASE_URL + "\nusage: node tools/cgc-pop.js --collector");
}
