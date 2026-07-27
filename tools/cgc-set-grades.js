#!/usr/bin/env node
// CGC 세트별 등급분포 수집용 브라우저 헬퍼 — 2026-07-27.
//
// 왜 필요한가: 기존 cgc-pop.js 는 목록 페이지에서 세트 총량만 읽는다. 그런데 CGC 는
// Pristine 10 과 Gem Mint 10 을 구분하는데(PSA 10 하나로 뭉친 것과 다르다) 그 값은
// 세트 상세 페이지의 두 번째 표에만 있다. 상세를 열어 등급 열을 전부 합산한다.
//
// 정확도 장치: 목록 페이지가 알려준 세트 총량과, 상세에서 합산한 Total 이 일치해야만 채택한다.
// 상세가 페이지네이션돼 일부만 읽혔으면 합계가 작아지므로 이 대조에서 걸린다(추정 금지).
//
// 사용:
//   node tools/cgc-set-grades.js --setup   → 출력을 CGC 목록 페이지 탭에서 실행 ('cgc-grades-ready')
//   그 뒤 페이지에서: await window.__cgcGrades(8) 을 remaining 이 0 이 될 때까지 반복
//   결과: window.__cgcGradeResult() → tools/cgc-set-grades-ingest.js 로 적재
const SETUP = `(()=>{
window.__cgcG = window.__cgcG || {};      // code|ed -> {total, grades, listTotal}
window.__cgcGDone = window.__cgcGDone || {};
window.__cgcGList = () => {
  const norm = (t) => {
    const m = t.match(/\\((OP|EB|PRB)[-\\s]?(\\d{2})/i);
    if (!m) return null;
    return (m[1].toUpperCase() + "-" + m[2]);
  };
  return [...document.querySelectorAll("table a")]
    .map((a) => {
      const t = (a.textContent || "").replace(/\\s+/g, " ").trim();
      const row = a.closest("tr");
      const cells = row ? [...row.cells].map((c) => (c.textContent || "").replace(/\\s+/g, " ").trim()) : [];
      const tot = cells.map((c) => parseInt(c.replace(/,/g, ""), 10)).filter((v) => Number.isFinite(v) && v > 0).pop();
      return { t, h: a.getAttribute("href") || "", code: norm(t), ed: /Japanese/i.test(t) ? "jp" : /English/i.test(t) ? "en" : null, listTotal: tot ?? null };
    })
    .filter((x) => x.code && x.ed);
};
window.__cgcGrades = async (MAX = 8) => {
  const home = location.pathname;
  const list = window.__cgcGList();
  let visited = 0, ok = 0, mismatch = [];
  for (const it of list) {
    const key = it.code + "|" + it.ed;
    if (window.__cgcGDone[key]) continue;
    if (visited >= MAX) break;
    history.pushState({}, "", it.h); window.dispatchEvent(new PopStateEvent("popstate"));
    let ts = [];
    for (let i = 0; i < 30; i++) {
      await new Promise((z) => setTimeout(z, 450));
      ts = [...document.querySelectorAll("table")].filter((t) => t.rows.length > 3);
      if (ts.length >= 2) break;
    }
    window.__cgcGDone[key] = true; visited++;
    if (ts.length >= 2) {
      const g = ts[1];
      const gh = [...g.rows[0].cells].map((c) => (c.textContent || "").replace(/\\s+/g, " ").trim());
      const sums = {};
      for (let i = 1; i < g.rows.length; i++) {
        const cells = [...g.rows[i].cells];
        for (let k = 0; k < gh.length && k < cells.length; k++) {
          const v = parseInt((cells[k].textContent || "").replace(/,/g, ""), 10);
          if (Number.isFinite(v) && v > 0) sums[gh[k]] = (sums[gh[k]] || 0) + v;
        }
      }
      const total = sums.Total || 0; delete sums.Total;
      if (it.listTotal != null && total !== it.listTotal) mismatch.push(key + " " + total + "!=" + it.listTotal);
      else if (total > 0) { window.__cgcG[key] = { total, grades: sums }; ok++; }
    }
    history.pushState({}, "", home); window.dispatchEvent(new PopStateEvent("popstate"));
    for (let i = 0; i < 20; i++) { await new Promise((z) => setTimeout(z, 400)); if (document.querySelectorAll("table a").length > 5) break; }
  }
  const remaining = window.__cgcGList().filter((x) => !window.__cgcGDone[x.code + "|" + x.ed]).length;
  return JSON.stringify({ visited, ok, remaining, kept: Object.keys(window.__cgcG).length, mismatch });
};
window.__cgcGradeResult = () => JSON.stringify({ grader: "cgc", collectedAt: new Date().toISOString().slice(0, 10), sets: window.__cgcG });
return "cgc-grades-ready";})()`;

if (process.argv.includes("--setup")) process.stdout.write(SETUP);
module.exports = { SETUP };
