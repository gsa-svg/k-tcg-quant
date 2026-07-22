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

// ── 홈은 현재 사실상 유일하게 색인된 페이지 → 검색어 표면적을 최대한 넓힌다.
// 답변은 전부 검증된 데이터에서 파생(추정 금지). 값이 없으면 그 항목을 만들지 않는다.
const byMsrp = [...rows].filter((b) => b.vsMsrp).sort((a, b) => b.vsMsrp - a.vsMsrp);
const byPrice = [...rows].filter((b) => b.nowUsd != null).sort((a, b) => b.nowUsd - a.nowUsd);
const cheapest = byPrice[byPrice.length - 1];
const priciest = byPrice[0];
const nameOf = (c) => (d.sets[c] || {}).nameEn || c;

const faqs = [
  {
    q: "How much is a One Piece booster box?",
    a: `Sealed Japanese One Piece booster boxes currently range from about ${usd(cheapest.nowUsd)} (${cheapest.code} ${nameOf(cheapest.code)}) to ${usd(priciest.nowUsd)} (${priciest.code} ${nameOf(priciest.code)}), as of ${DATA_DATE}. Prices come from real completed sales and verified active listings, updated daily. The table above lists all ${rows.length} sets.`,
  },
  {
    q: "Which One Piece booster box is the most valuable?",
    a: `${priciest.code} ${nameOf(priciest.code)} is the most expensive sealed Japanese box we track at about ${usd(priciest.nowUsd)}${byMsrp.length ? `. Measured against original Japanese retail price, ${byMsrp[0].code} trades at roughly ${byMsrp[0].vsMsrp}x its launch MSRP` : ""}.`,
  },
  {
    q: "Are One Piece booster boxes going up or down in price?",
    a: `The OPBOX Index — an equal-weight index of ${mi.constituents.length} Japanese booster boxes based to 100 on January 7, 2026 — is at ${idx.value.toFixed(1)}, ${idx.sinceBasePct >= 0 ? "up" : "down"} ${Math.abs(idx.sinceBasePct)}% since January and ${idx.weekChangePct >= 0 ? "up" : "down"} ${Math.abs(idx.weekChangePct)}% over the past week. Individual sets move differently; see the change column above.`,
  },
  {
    q: "Is a One Piece booster box worth buying sealed?",
    a: `It depends on the set. Sets trading at a high multiple of their original retail price have already priced in scarcity, while recently released sets are closer to MSRP. We publish each set's current price, its change since we began tracking it, and its multiple versus the original Japanese MSRP so you can judge rather than guess. Reprints matter too — a distributor reprint adds supply and has historically pressured prices.`,
  },
  {
    q: "Where can I check One Piece card and booster box prices for free?",
    a: `This site is free and updated daily. You can browse per-set guides, the top PSA 10 card ranking, and the market index, or download the full per-set dataset as a CSV under a CC BY 4.0 licence at /free-data.html.`,
  },
];
const faqLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});
const dsLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "Dataset",
  name: "One Piece booster box prices (Japanese sets)",
  description: `Daily prices for ${rows.length} Japanese One Piece Card Game booster boxes with change since tracking start, original MSRP multiple, reprint records and PSA population.`,
  url: "https://opboxindex.com/free-data.html",
  license: "https://creativecommons.org/licenses/by/4.0/",
  isAccessibleForFree: true, dateModified: DATA_DATE,
  creator: { "@type": "Organization", name: "OP Box Index", url: "https://opboxindex.com/" },
  distribution: [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: "https://opboxindex.com/opbox-set-prices.csv" }],
});
const faqHtml = faqs.map((f) => `<details class="homeFaq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n          ");

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
        <section class="homeFaqWrap" aria-label="Frequently asked questions about One Piece booster box prices">
          <details class="homeCollapse">
          <summary><h2>One Piece booster box prices — common questions</h2></summary>
          ${faqHtml}
          </details>
        </section>
        <script type="application/ld+json">${faqLd}</script>
        <script type="application/ld+json">${dsLd}</script>
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
