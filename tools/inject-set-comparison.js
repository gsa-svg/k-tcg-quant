#!/usr/bin/env node
// 세트 비교표를 compare.html 과 articles/best-one-piece-booster-box.html 에 주입한다 — 2026-09-01 신설.
//
// ── 왜 만드나
// 두 페이지 모두 생성기가 없는 수동 HTML 이었다. 그래서 compare.html 의 표는
// "JP Jan / JP Jul" 열에 2026년 1월·7월 값이 박힌 채 멈춰 있었고,
// best-one-piece-booster-box.html 은 제목이 "best ... booster box" 인데 표가 0행이었다.
// 오늘 하루에만 같은 유형(수동이라 낡음)을 세 번 봤다 — PSA10 가격 두 달 정지,
// 유유테이 싱글, 이 표. 손으로 쓴 숫자는 반드시 낡는다.
//
// ── 왜 이 열들인가 (GSC 2026-09-01 미국 검색어)
//   "best one piece booster box to buy" · "one piece cards value list" · "op10 most expensive cards"
// 사는 사람이 실제로 비교하는 것: 지금 얼마인가, 최근 어느 쪽으로 움직였나,
// 영문판과 얼마나 차이 나나, 그 세트에서 제일 비싼 카드가 뭔가.
//
// ⚠️ 순위·점수를 만들지 않는다. 어느 박스가 "좋다"고 우리가 판정하지 않는다 —
//    신뢰할 수 없는 종합지수는 소유자 지시로 폐기했다. 사실만 나란히 놓고 판단은 읽는 사람 몫이다.
// ⚠️ 표본(n)을 같이 싣는다. 일본판은 하루 0.5건꼴로 팔리는 세트도 있어서,
//    n 없이 중앙값만 보이면 두께가 다른 값이 같은 무게로 읽힌다.
//
// Run: node tools/inject-set-comparison.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MARK_START = "<!-- SET-COMPARISON:START -->";
const MARK_END = "<!-- SET-COMPARISON:END -->";

// 행은 사실 파일(data/derived/site-facts.json compare.rows — tools/build-site-facts.js) — 2026-10-15.
//   현재가 칸은 box-sold-series 의 current(발매됐고 마지막 점이 asOf 로부터 28일 이내일 때만 값, 아니면 "—").
//   2026-09-30 발견: OP-02 일본판이 84일 전(7/8) 값을 표시 없이 현재가처럼 보여주고 있었다.
//   2026-10-14: 미발매 EB-05·OP-18 의 예약판매가 실거래 중앙값으로 들어가 EB-05 "−42%" 같은 숫자가 나왔다 → 예약판매는 시계열에서 빠졌고(preRelease),
//   미발매 세트 행은 남기되 값 칸은 전부 "—".
//   가장 비싼 카드 = market-data-normalizers.priciest(검증된 NM 최댓값, 동가 전부) — 세트 페이지 Key facts·한국어 문단과 같은 값. 모르면 칸을 비운다.
//   4-wk = boxChange28(current vs 28일 이상 앞선 마지막 점) — 세트 페이지·홈 board 와 같은 값(종전 "5점 전"은 OP-06 이 +7% / -6.5% 로 갈렸다).
const F = require("./build-site-facts").load();

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (v) => (v == null ? "—" : "$" + Math.round(v).toLocaleString("en-US"));

const buildRows = () => F.compare.rows;

function tableHtml(rows, updated) {
  const body = rows.map((r) => {
    const chgTxt = r.chg == null ? "—" : `${r.chg > 0 ? "+" : ""}${r.chg}%`;   // 세트 페이지 "4-week change" 와 같은 표기(소수 한 자리)
    const chgColor = r.chg == null ? "#7d8698" : r.chg >= 0 ? "#26d07c" : "#ff6b6b";
    return `            <tr>` +
      `<th scope="row" class="ctSet"><a href="/sets/${esc(r.code.toLowerCase())}.html"><b>${esc(r.code)}</b><span>${esc(r.name)}</span></a></th>` +
      `<td>${money(r.jp)}${r.jpN ? `<small style="color:#7d8698"> n${r.jpN}</small>` : ""}</td>` +
      `<td>${money(r.en)}${r.enN ? `<small style="color:#7d8698"> n${r.enN}</small>` : ""}</td>` +
      `<td style="color:${chgColor}">${chgTxt}</td>` +
      `<td>${r.ratio ? r.ratio.toFixed(1) + "x" : "—"}</td>` +
      `<td>${r.topNames ? `${money(r.topUsd)}${r.topDate && r.topDate !== updated ? ` (${esc(r.topDate)})` : ""} <small style="color:#7d8698">${r.topNames.map((n) => esc(n)).join(", ")}</small>` : "—"}</td>` +
      `<td>${r.gem == null ? "—" : r.gem + "%"}</td>` +
      `</tr>`;
  }).join("\n");

  return `${MARK_START}
        <div class="setComparisonScroll" role="region" tabindex="0" aria-label="Japanese and English booster box price comparison" style="overflow-x:auto;"><table class="ctTable" style="width:100%; border-collapse:collapse;">
          <thead><tr><th class="ctSet">Set</th><th>JP box</th><th>EN box</th><th>4-wk</th><th>EN/JP</th><th>Priciest card (raw)</th><th>PSA 10 rate</th></tr></thead>
          <tbody>
${body}
          </tbody>
        </table></div>
        <p style="color:#7d8698;font-size:12.5px;margin-top:10px;">Box prices are medians of completed eBay buy-it-now sales we collect ourselves; n is the sample behind each figure. 4-wk compares the latest median with the median 28 days earlier, as on each set page. Priciest card is the raw single at Japanese retail near-mint — not a graded price. PSA 10 rate is the share of that set's PSA submissions that came back 10. As of ${esc(updated)}.</p>
        ${MARK_END}`;
}

function inject(file, html) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return { file, status: "파일 없음" };
  let s = fs.readFileSync(p, "utf8");
  const i = s.indexOf(MARK_START);
  const j = s.indexOf(MARK_END);
  if (i < 0 || j < 0) return { file, status: "마커 없음 — 먼저 HTML 에 마커를 넣을 것" };
  s = s.slice(0, i) + html + s.slice(j + MARK_END.length);
  fs.writeFileSync(p, s, "utf8");
  return { file, status: "ok" };
}

const rows = buildRows();
if (rows.length < 10) throw new Error(`세트가 ${rows.length}개뿐 — 시계열 로딩 실패 의심`);
const html = tableHtml(rows, F.compare.asOf || "");
const out = ["compare.html", "articles/best-one-piece-booster-box.html"].map((f) => inject(f, html));


// 글의 수정일(JSON-LD dateModified·화면 Updated)을 표의 "As of" 날짜에 맞춘다.
// 2026-09-30 발견: 표는 매일 바뀌는데 수정일이 2026-08-10 에 멈춰 있었다(가드 U1).
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTH[m - 1]} ${d}, ${y}`; };
const asOf = F.compare.asOf || "";
// Key facts 표(compare.html H1 바로 아래) — 2026-10-16. 값은 사실 파일 home(최저·최고 일본판 박스, 4주 등락 집계)·compare.asOf 와 이 표의 행(EN 중앙값 범위) 그대로.
{
  const { KF_CSS_ANY, kfTableAny } = require("./set-page-shared");
  const H = F.home;
  const withJp = rows.filter((r) => r.jp != null).length, withEn = rows.filter((r) => r.en != null).length;
  const enRows = rows.filter((r) => r.en != null).sort((a, b) => a.en - b.en);
  const kf = kfTableAny([
    ["sets", "Sets compared", "비교 세트", `<b>${rows.length}</b> <small>${withJp} <span data-ko="일본판 중앙값">with a JP median</span> · ${withEn} <span data-ko="영문판 중앙값">with an EN median</span></small>`],
    H.cheapest && H.priciest ? ["jp", "JP box range", "일본판 박스 범위", `<b>${money(H.cheapest.usd)}–${money(H.priciest.usd)}</b> <small>${esc(H.cheapest.codes.join(", "))} · ${esc(H.priciest.code)}</small>`] : null,
    enRows.length ? ["en", "EN box range", "영문판 박스 범위", `<b>${money(enRows[0].en)}–${money(enRows.at(-1).en)}</b> <small>${esc(enRows[0].code)} · ${esc(enRows.at(-1).code)}</small>`] : null,
    ["change", "4-week change (JP)", "4주 등락 (일본판)", `<b>${H.nUp} <span data-ko="상승">up</span> · ${H.nDn} <span data-ko="하락">down</span></b> <small><span data-ko="28일 전 중앙값이 있는 세트">of ${H.withChg} sets with a median 28 days earlier</span></small>`],
    ["asof", "As of", "기준일", `<time datetime="${esc(asOf)}">${esc(asOf)}</time> <small><span data-ko="이베이 완료 거래 중앙값">eBay completed-sale medians</span></small>`],
  ], { label: "Set comparison key facts" });
  const p = path.join(ROOT, "compare.html");
  let s = fs.readFileSync(p, "utf8");
  const re = /<!-- COMPARE_KEY_FACTS:START -->[\s\S]*?<!-- COMPARE_KEY_FACTS:END -->/;
  if (!re.test(s)) throw new Error("compare.html: COMPARE_KEY_FACTS 마커가 없다");
  s = s.replace(re, () => `<!-- COMPARE_KEY_FACTS:START --><style>\n${KF_CSS_ANY}\n      </style>\n      ${kf}\n      <!-- COMPARE_KEY_FACTS:END -->`);
  fs.writeFileSync(p, s, "utf8");
}
if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  const p = path.join(ROOT, "articles/best-one-piece-booster-box.html");
  let s = fs.readFileSync(p, "utf8");
  const before = s;
  s = s.replace(/("dateModified": ")[^"]*(")/, (_m, a, b) => a + asOf + b);
  s = s.replace(/(Updated <time datetime=")[^"]*(">)[^<]*(<\/time>)/, (_m, a, b, c) => a + asOf + b + longDate(asOf) + c);
  if (s !== before) fs.writeFileSync(p, s, "utf8");
}
console.log(JSON.stringify({ sets: rows.length, asOf, targets: out }, null, 1));
