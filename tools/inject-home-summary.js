// 홈 정적 시세 요약 주입 — index.html / packs.html 의 마커 구간을 매일 갱신.
// 왜: 홈의 시세표는 packs.js가 JS로 렌더링해서, JS를 실행하지 않는 AI 크롤러·검색봇은 홈에서 가격을 하나도 못 읽었음
//     (홈은 현재 유일하게 색인된 페이지라 손실이 큼). 같은 데이터를 정적 HTML로도 굽는다.
// ⚠️ head/canonical/hreflang 은 절대 건드리지 않는다(2026-07 홈 노출 0 사고).
// Run: node tools/inject-home-summary.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const START = "<!-- HOME_SUMMARY:START -->";
const END = "<!-- HOME_SUMMARY:END -->";

const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const mi = d.marketIndex;
const fx = d.fx || {};
const DATA_DATE = d.updated || "";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));

function orderKey(code) {
  const m = code.match(/^([A-Z]+)-?(\d+)/);
  const fam = { OP: 0, EB: 1, PRB: 2 }[m ? m[1] : "OP"] ?? 9;
  return fam * 1000 + (m ? parseInt(m[2], 10) : 0);
}
const rows = [...mi.board].sort((a, b) => orderKey(a.code) - orderKey(b.code));

const tr = rows.map((b) => {
  const s = d.sets[b.code] || {};
  const chg = b.changePct;
  return `<tr><td><a href="sets/${b.code.toLowerCase()}.html">${esc(b.code)}</a></td><td>${esc(s.nameEn || "")}</td><td class="num">${usd(b.nowUsd)}</td><td class="num ${chg >= 0 ? "up" : "down"}">${chg != null ? (chg >= 0 ? "+" : "") + chg + "%" : "—"}</td><td class="num">${b.vsMsrp ? "×" + b.vsMsrp : "—"}</td></tr>`;
}).join("\n");

const idx = mi.index;
const block = `${START}
        <section class="homeSummary" aria-label="Current Japanese booster box prices">
          <h2>Japanese booster box prices — all ${rows.length} sets (${esc(DATA_DATE)})</h2>
          <p>The OPBOX Index, an equal-weight index of ${mi.constituents.length} Japanese booster boxes (Jan 7, 2026 = 100), stands at <strong>${idx.value.toFixed(1)}</strong>, ${idx.sinceBasePct >= 0 ? "up" : "down"} <strong>${Math.abs(idx.sinceBasePct)}%</strong> since January. Weekly PSA grading volume is <strong>${mi.meter.latestWeek.v.toLocaleString("en-US")}</strong> cards (week of ${esc(mi.meter.latestWeek.d)}). Prices below are sealed Japanese booster boxes in USD; "change" is measured from each set's tracking start date, not its release date.</p>
          <div style="overflow-x:auto">
          <table class="homeSummaryTable">
            <thead><tr><th>Set</th><th>Name</th><th>Box price</th><th>Change</th><th>vs MSRP</th></tr></thead>
            <tbody>
${tr}
            </tbody>
          </table>
          </div>
          <p class="note">Updated ${esc(DATA_DATE)} · FX ₩${fx.usdKrw}/$ · <a href="free-data.html">Download the full dataset (CSV)</a> · <a href="market.html">Market index</a> · <a href="ko/">한국어 시세</a></p>
        </section>
        ${END}`;

let touched = 0;
for (const f of ["index.html", "packs.html"]) {
  const fp = path.join(ROOT, f);
  if (!fs.existsSync(fp)) continue;
  let h = fs.readFileSync(fp, "utf8");
  if (h.includes(START) && h.includes(END)) {
    h = h.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  } else {
    // 최초 삽입: 상세 영역 뒤(본문 안)에 붙인다. head 는 건드리지 않음.
    const anchor = `<div id="detail"></div>`;
    if (!h.includes(anchor)) { console.error(`SKIP ${f}: anchor not found`); continue; }
    h = h.replace(anchor, `${anchor}\n        ${block}`);
  }
  fs.writeFileSync(fp, h, "utf8");
  touched++;
}
console.log(JSON.stringify({ touched, sets: rows.length, index: idx.value }));
