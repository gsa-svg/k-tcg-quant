#!/usr/bin/env node
// 색인 대상인데 내용이 얇은 페이지를 찾는다 — 2026-09-01 신설.
//
// ── 왜
// 애드센스가 두 번 "가치가 별로 없는 콘텐츠"로 거절했다. 우리 대응은 7/24 에
// "얇아 보이는 45페이지를 통째로 noindex" 였는데, 그건 사이트를 작아 보이게만 만들고
// 검색 노출을 90% 날렸다(색인 38페이지 / 실제 122페이지).
//
// 이번에는 숨기는 대신 **채웠다**. 그리고 무엇이 아직 얇은지 사람 눈이 아니라 이 감사가 본다.
//
// ── 얇음을 어떻게 재나
// 글자 수만 보면 데이터 표가 많은 페이지를 잘못 잡는다. 2026-09-01 실측:
//   ko/auction.html  1,559자인데 표 셀 110개 — 한국어권에 없는 낙찰 데이터가 꽉 차 있다
//   ko/op-17.html    1,335자에 표 셀 12개 — 발매 10일차라 정말 비어 있다
// 그래서 글자 수와 데이터 셀을 같이 본다. 둘 다 적을 때만 얇다고 판정한다.
//
// ⚠️ 여기서 자동으로 noindex 를 걸지 않는다. 노출 상태 변경은 소유자 판단이고,
//    7/24 에 그 판단을 자동화했다가 5주를 잃었다. 이 감사는 목록만 낸다.
//
// Run: node tools/audit-thin-pages.js [--json]
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const MIN_TEXT = 1600;    // 이 아래면서
const MIN_CELLS = 24;     // 데이터 셀도 이 아래면 얇다고 본다

const DIRS = ["", "sets", "cards", "ko", "articles"];

function textLen(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

const thin = [], indexable = [];
for (const d of DIRS) {
  const dir = path.join(ROOT, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".html") || f.startsWith("_")) continue;
    // 검색엔진 소유권 확인 파일은 콘텐츠가 아니다(구글·네이버가 요구하는 빈 파일).
    if (/^(google|naver|BingSiteAuth)/i.test(f)) continue;
    const rel = d ? `${d}/${f}` : f;
    const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (/<meta name="robots" content="noindex/.test(html)) continue;   // 이미 색인 대상이 아님
    const len = textLen(html);
    const cells = (html.match(/<td[ >]/g) || []).length;
    indexable.push(rel);
    if (len < MIN_TEXT && cells < MIN_CELLS) thin.push({ page: rel, chars: len, cells });
  }
}
thin.sort((a, b) => a.chars - b.chars);

const report = {
  audit: thin.length ? "REVIEW" : "OK",
  rule: `본문 ${MIN_TEXT}자 미만 **그리고** 데이터 셀 ${MIN_CELLS}개 미만`,
  indexablePages: indexable.length,
  thin: thin.length,
  pages: thin,
  note: thin.length
    ? "이 페이지들은 색인 대상인데 내용이 얇다. 데이터가 쌓이면 자연히 해소된다(신작 세트 등). 애드센스 심사 전이라면 채우거나 잠시 빼는 것을 고려할 것 — 판단은 소유자 몫이다."
    : "색인 대상 페이지 중 얇은 것이 없다.",
};
console.log(JSON.stringify(report, null, 1));
