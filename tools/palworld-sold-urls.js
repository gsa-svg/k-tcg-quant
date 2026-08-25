#!/usr/bin/env node
// 팰월드 TCG 박스 sold(실거래) 수집용 URL·수집기 — 2026-08-17 신설.
//
// 왜 지금부터 모으나: BP-01 "Dawn of Palpagos" 는 2026-07-30 발매다. 신규 IP 1탄이
// 발매 직후 어떻게 움직이는지는 원피스 원장으로는 알 수 없다(우리 원장이 2026-06 부터라
// 발매 2주차 세트의 궤적 실측이 0). 시계열은 소급이 안 되므로, 용도가 확정되기 전에 쌓는다.
//
// 원피스 수집기(box-sold-urls.js)와 같은 규칙을 그대로 따른다. 그 규칙들은 실측으로 얻은 것이라
// 여기서 다시 발명하지 않는다:
//   · 즉시구매(LH_BIN=1)만 — 경매는 입찰이 안 붙으면 시세보다 훨씬 낮게 끝나 섞으면 잡음이 된다.
//   · ⛔ 카테고리(_sacat) 금지 — 언어 패싯(Language)을 통째로 무력화한다.
//   · 가격대 분할 — eBay 는 한 검색에 240~265건까지만 주고 _pgn=2 는 무시된다.
//   · _udlo/_udhi 는 **화면 표시 통화** 기준이다. 이 수집은 표시통화 KRW 브라우저에서 돌린다.
//
// 팰월드만의 사정:
//   · 중국어판이 검색에 섞인다(간체 표기 박스). 판정 단계에서 배제한다.
//   · 1박스 = 12팩(원피스는 24, PRB 는 20). 다박스 표기를 개당가로 나눌 때 이 값을 쓴다.
//   · "1st Edition" 표기가 매물에 존재한다 — 초판/재판 구분이 생길 수 있어 제목을 보존한다.
//
// 절차(브라우저 javascript_tool):
//   1) node tools/palworld-sold-urls.js --setup 출력을 eBay 탭에서 실행 → 'ready:N pages'
//   2) await window.__pwRunBatch(0,15) … 끝까지
//   3) window.__pwDownload('palworld-sold-YYYY-MM-DD.json')
//   그 뒤 node tools/palworld-sold-ingest.js <파일>
const SETS = [
  // code, eBay 검색 키워드, 팩/박스, 발매일(일본판 기준)
  { code: "BP-01", kw: "Palworld Dawn of Palpagos booster box", packsPerBox: 12, release: "2026-07-30" },
];

// 원화 기준 가격대. 팰월드는 원피스보다 싸서(현재 박스 $75~165) 구간을 아래로 당겼다.
// 구간이 비어도 손해가 없고, 한 구간에 몰리면 240 상한에 걸려 조용히 잘린다.
const BANDS = [[0, 60000], [60000, 120000], [120000, 200000], [200000, 400000], [400000, 0]];

function setupScript() {
  return `(()=>{const SETS=${JSON.stringify(SETS)};const BANDS=${JSON.stringify(BANDS)};
const q=s=>encodeURIComponent(s).replace(/%20/g,'+');
const mk=(kw,lang,lo,hi)=>'https://www.ebay.com/sch/i.html?_nkw='+q(kw)+'&LH_Sold=1&LH_Complete=1&_ipg=240&_sop=13&LH_BIN=1&Language='+lang+(lo?'&_udlo='+lo:'')+(hi?'&_udhi='+hi:'');
const P=[];for(const s of SETS){for(const [lo,hi] of BANDS){P.push({code:s.code,query:'jp',fmt:'bin',band:lo,url:mk(s.kw,'Japanese',lo,hi)});P.push({code:s.code,query:'en',fmt:'bin',band:lo,url:mk(s.kw,'English',lo,hi)});}}
window.__pwPAGES=P;window.__pwDump={collectedAt:new Date().toISOString().slice(0,10),game:'palworld',langFacet:true,fmtSplit:true,pages:[]};
window.__pwGrab=async u=>{let h;try{h=await fetch(u,{credentials:'include'}).then(r=>r.text());}catch(e){return{robot:false,items:[]};}
 if(/Pardon our interruption|Checking your browser|captcha/i.test(h.slice(0,4000)))return{robot:true,items:[]};
 const doc=new DOMParser().parseFromString(h,'text/html');const cards=doc.querySelectorAll('.s-card,li.s-item');const rawN=cards.length;const out=[];
 for(const c of cards){const a=c.querySelector('a[href*="/itm/"]');const m=a&&(a.getAttribute('href')||'').match(/\\/itm\\/(\\d+)/);if(!m||m[1]==='123456')continue;
  const t=((c.querySelector('.su-styled-text.primary')||c.querySelector('.s-item__title'))?.textContent||'').replace(/New Listing/ig,'').trim();
  if(!/booster box/i.test(t))continue;
  const d=((c.querySelector('.s-card__caption,.s-item__caption'))?.textContent||'').trim();
  const pT=((c.querySelector('.s-card__price,.s-item__price'))?.textContent||'').trim();
  const p=pT.replace(/,/g,'').match(/([\\d.]+)/);if(!t||!d||!p)continue;
  out.push({id:m[1],t:t.slice(0,140),d:d.slice(0,32),k:parseFloat(p[1]),cur:/KRW|\\u20a9/.test(pT)?'KRW':/\\$/.test(pT)?'USD':'OTHER'});}
 return{robot:false,items:out,rawN};};
window.__pwRunBatch=async(s,n)=>{const e=Math.min(s+n,window.__pwPAGES.length);let rob=0;
 for(let i=s;i<e;i++){const pg=window.__pwPAGES[i];const r=await window.__pwGrab(pg.url);if(r.robot)rob++;
  window.__pwDump.pages.push({code:pg.code,query:pg.query,fmt:pg.fmt,band:pg.band,items:r.items,rawN:r.rawN});
  await new Promise(z=>setTimeout(z,550));}
 return JSON.stringify({done:window.__pwDump.pages.length,of:window.__pwPAGES.length,robots:rob,items:window.__pwDump.pages.reduce((a,p)=>a+p.items.length,0)});};
window.__pwDownload=fn=>{const seen=new Set(),uniq=[];for(const p of window.__pwDump.pages){const k=p.code+'/'+p.query+'/'+p.fmt+'/'+p.band;if(seen.has(k))continue;seen.add(k);uniq.push(p);}
 const full=JSON.stringify({collectedAt:window.__pwDump.collectedAt,game:'palworld',langFacet:true,fmtSplit:true,pages:uniq});
 const b=new Blob([full],{type:'application/json'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=fn;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);
 return JSON.stringify({saved:fn,bytes:full.length,pages:uniq.length,items:uniq.reduce((x,p)=>x+p.items.length,0)});};
return 'ready:'+window.__pwPAGES.length+' pages';})()`;
}

module.exports = { SETS, BANDS, setupScript };

if (require.main === module) {
  if (process.argv.includes("--setup")) console.log(setupScript());
  else {
    console.log("# 팰월드 박스 sold 수집 (" + SETS.length + " 세트 × " + BANDS.length + " 가격대 × 2 언어 = " + SETS.length * BANDS.length * 2 + " 페이지)");
    for (const s of SETS) console.log(s.code + "\t" + s.kw + "\t" + s.packsPerBox + "팩/박스\t발매 " + s.release);
    console.log("\n사용법: node tools/palworld-sold-urls.js --setup");
  }
}
