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

const packs = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const series = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "box-sold-series.json"), "utf8"));
const fx = packs.fx || {};
const usdKrw = fx.usdKrw || 1374;
const jpyKrw = fx.jpyKrw || 8.7;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (v) => (v == null ? "—" : "$" + Math.round(v).toLocaleString("en-US"));

function buildRows() {
  const rows = [];
  for (const [code, eds] of Object.entries(series.sets || {})) {
    const jp = (eds.jp || []).filter((x) => Number.isFinite(x.median));
    const en = (eds.en || []).filter((x) => Number.isFinite(x.median));
    if (!jp.length) continue;
    const now = jp[jp.length - 1];
    const prev = jp[Math.max(0, jp.length - 5)];   // 약 4주 전 점
    const set = packs.sets?.[code] || {};

    // 그 세트에서 raw 가 가장 비싼 카드. 없으면 비운다 — 지어내지 않는다.
    let top = null;
    for (const c of set.cards || []) {
      if (c.nmJpy == null) continue;
      if (!top || c.nmJpy > top.nmJpy) top = c;
    }

    const chg = prev && prev.median ? (now.median / prev.median - 1) * 100 : null;
    rows.push({
      code,
      name: set.nameEn || "",
      jp: now.median,
      jpN: now.n,
      en: en.length ? en[en.length - 1].median : null,
      enN: en.length ? en[en.length - 1].n : null,
      chg,
      ratio: en.length && now.median ? en[en.length - 1].median / now.median : null,
      topName: top ? top.name : null,
      topUsd: top ? (top.nmJpy * jpyKrw) / usdKrw : null,
      gem: set.psaFull?.gemRate ?? null,
    });
  }
  rows.sort((a, b) => a.code.localeCompare(b.code));
  return rows;
}

function tableHtml(rows, updated) {
  const body = rows.map((r) => {
    const chgTxt = r.chg == null ? "—" : `${r.chg >= 0 ? "+" : ""}${r.chg.toFixed(0)}%`;
    const chgColor = r.chg == null ? "#7d8698" : r.chg >= 0 ? "#26d07c" : "#ff6b6b";
    return `            <tr>` +
      `<td class="ctSet"><b>${esc(r.code)}</b><span>${esc(r.name)}</span></td>` +
      `<td>${money(r.jp)}<small style="color:#7d8698"> n${r.jpN}</small></td>` +
      `<td>${money(r.en)}${r.enN ? `<small style="color:#7d8698"> n${r.enN}</small>` : ""}</td>` +
      `<td style="color:${chgColor}">${chgTxt}</td>` +
      `<td>${r.ratio ? r.ratio.toFixed(1) + "x" : "—"}</td>` +
      `<td>${r.topName ? `${money(r.topUsd)} <small style="color:#7d8698">${esc(r.topName.slice(0, 26))}</small>` : "—"}</td>` +
      `<td>${r.gem == null ? "—" : r.gem + "%"}</td>` +
      `</tr>`;
  }).join("\n");

  return `${MARK_START}
        <div style="overflow-x:auto;"><table class="ctTable" style="width:100%; border-collapse:collapse;">
          <thead><tr><th class="ctSet">Set</th><th>JP box</th><th>EN box</th><th>4-wk</th><th>EN/JP</th><th>Priciest card (raw)</th><th>PSA 10 rate</th></tr></thead>
          <tbody>
${body}
          </tbody>
        </table></div>
        <p style="color:#7d8698;font-size:12.5px;margin-top:10px;">Box prices are medians of completed eBay buy-it-now sales we collect ourselves; n is the sample behind each figure. 4-wk compares the latest point with roughly four weeks earlier. Priciest card is the raw near-mint single at Japanese retail — not a graded price. PSA 10 rate is the share of that set's PSA submissions that came back 10. As of ${esc(updated)}.</p>
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
const html = tableHtml(rows, series.updated || packs.updated || "");
const out = ["compare.html", "articles/best-one-piece-booster-box.html"].map((f) => inject(f, html));
console.log(JSON.stringify({ sets: rows.length, targets: out }, null, 1));
