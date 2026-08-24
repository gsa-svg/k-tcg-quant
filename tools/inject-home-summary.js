// 홈 정적 시세 요약 주입 — index.html / packs.html 의 마커 구간을 매일 갱신.
// 왜: 홈의 시세표는 packs.js가 JS로 렌더링해서, JS를 실행하지 않는 AI 크롤러·검색봇은 홈에서 가격을 하나도 못 읽었음
//     (홈은 현재 유일하게 색인된 페이지라 손실이 큼). 같은 데이터를 정적 HTML로도 굽는다.
// 표는 <details> 로 접어 둔다 — 이 표의 독자는 사람이 아니라 봇이고, 위쪽 JS 시세판과 같은 상품을
// 두 번 보여주면 화면만 길어진다. display:none 으로 숨기지 않는 이유는 그게 클로킹이기 때문이고,
// <details> 안의 내용은 구글이 정상 색인한다.
// ⚠️ head/canonical/hreflang 은 절대 건드리지 않는다(2026-07 홈 노출 0 사고).
// Run: node tools/inject-home-summary.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const START = "<!-- HOME_SUMMARY:START -->";
const END = "<!-- HOME_SUMMARY:END -->";

const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
// marketIndex 는 세트별 시세판(board) 공급원으로만 쓴다 — 지수 숫자·개봉미터 표시는
// 2026-07-29 소유자 지시로 전부 삭제됨(값이 실제와 안 맞았음).
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
  return `<tr><td><a href="sets/${b.code.toLowerCase()}.html">${esc(b.code)}</a></td><td>${esc(s.nameEn || "")}</td><td class="num">${usd(b.nowUsd)}</td><td class="num ${chg == null ? "" : chg >= 0 ? "up" : "down"}">${chg != null ? (chg >= 0 ? "+" : "") + chg + "%" : "—"}</td></tr>`;
}).join("\n");


// ── 홈은 현재 사실상 유일하게 색인된 페이지 → 검색어 표면적을 최대한 넓힌다.
// 답변은 전부 검증된 데이터에서 파생(추정 금지). 값이 없으면 그 항목을 만들지 않는다.
const byPrice = [...rows].filter((b) => b.nowUsd != null).sort((a, b) => b.nowUsd - a.nowUsd);
const cheapest = byPrice[byPrice.length - 1];
const priciest = byPrice[0];
const nameOf = (c) => (d.sets[c] || {}).nameEn || c;

// 상승/하락은 세트별로만 말한다 — 시장 전체를 숫자 하나로 요약하던 지수는 삭제됨(2026-07-29).
const withChg = rows.filter((b) => b.changePct != null);
const byChg = [...withChg].sort((a, b) => b.changePct - a.changePct);
const nUp = withChg.filter((b) => b.changePct > 0).length;
const nDn = withChg.filter((b) => b.changePct < 0).length;
const topUp = byChg[0];
const topDn = byChg[byChg.length - 1];

const faqs = [
  {
    q: "How much is a One Piece booster box?",
    a: `Sealed Japanese One Piece booster boxes currently range from about ${usd(cheapest.nowUsd)} (${cheapest.code} ${nameOf(cheapest.code)}) to ${usd(priciest.nowUsd)} (${priciest.code} ${nameOf(priciest.code)}), as of ${DATA_DATE}. Each price is the median of completed eBay sales we collect ourselves, updated daily. The table above lists all ${rows.length} sets.`,
  },
  {
    q: "Which One Piece booster box is the most valuable?",
    a: `${priciest.code} ${nameOf(priciest.code)} is the most expensive sealed Japanese box we track at about ${usd(priciest.nowUsd)}, ahead of ${byPrice[1].code} ${nameOf(byPrice[1].code)} at ${usd(byPrice[1].nowUsd)}.`,
  },
  {
    q: "Are One Piece booster boxes going up or down in price?",
    a: `They move set by set, not as one block. Of the ${withChg.length} Japanese sets where we have a tracked start price, ${nUp} are up and ${nDn} are down since tracking began${topUp ? `; the largest gain is ${topUp.code} at ${topUp.changePct >= 0 ? "+" : ""}${topUp.changePct}%` : ""}${topDn && topDn.changePct < 0 ? ` and the largest fall is ${topDn.code} at ${topDn.changePct}%` : ""}. See the change column above for each set.`,
  },
  {
    q: "Is a One Piece booster box worth buying sealed?",
    a: `It depends on the set. Older sets have had years for sealed supply to thin out, while recently released sets are still being opened. We publish each set's current price and its change since we began tracking it, alongside how many copies of its cards have been graded, so you can judge rather than guess. Reprints matter too — a distributor reprint adds supply and has historically pressured prices.`,
  },
  {
    q: "Where can I check One Piece card and booster box prices for free?",
    a: `This site is free and updated daily. You can browse per-set guides, the top PSA 10 card ranking, and PSA / CGC / TAG grading population by set and edition, or download citable JSON and CSV datasets under a CC BY 4.0 licence at /free-data.html.`,
  },
];
const faqLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});
const dsLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "Dataset",
  name: "One Piece TCG box markets and Top 7 card data",
  description: `Citable data for ${rows.length} tracked One Piece Card Game products: Japanese and English completed-sale and active-ask box markets, Top 7 exact card variants, and field-level observation dates and sample sizes.`,
  url: "https://opboxindex.com/free-data.html",
  license: "https://creativecommons.org/licenses/by/4.0/",
  isAccessibleForFree: true, dateModified: DATA_DATE,
  creator: { "@type": "Organization", name: "OP Box Index", url: "https://opboxindex.com/" },
  distribution: [
    { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "https://opboxindex.com/opbox-ai-data.json" },
    { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: "https://opboxindex.com/opbox-set-prices.csv" },
  ],
});
const faqHtml = faqs.map((f) => `<details class="homeFaq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n          ");

const block = `${START}
        <section class="homeSummary" aria-label="Current Japanese booster box prices">
          <details class="homeCollapse">
          <summary><h2>Japanese booster box prices — all ${rows.length} sets (${esc(DATA_DATE)})</h2></summary>
          <p>Prices below are sealed Japanese booster boxes in USD, each the median of completed eBay sales we collect ourselves. "Change" compares the latest weekly sold median with four weeks earlier. Of the ${withChg.length} sets with four weeks of history, <strong>${nUp}</strong> are up and <strong>${nDn}</strong> are down. Grading population for each set — PSA, CGC and TAG, Japanese and English kept separate — is on the <a href="psa-grading.html">grading population page</a>.</p>
          <div style="overflow-x:auto">
          <table class="homeSummaryTable">
            <thead><tr><th>Set</th><th>Name</th><th>Box price</th><th>Change</th></tr></thead>
            <tbody>
${tr}
            </tbody>
          </table>
          </div>
          <p class="note">Updated ${esc(DATA_DATE)} · FX ₩${fx.usdKrw}/$ · <a href="free-data.html">Download citable data (JSON/CSV)</a> · <a href="psa-grading.html">Grading population</a> · <a href="auction.html">Auction results</a> · <a href="ko/">한국어 시세</a></p>
          </details>
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
console.log(JSON.stringify({ touched, sets: rows.length }));
