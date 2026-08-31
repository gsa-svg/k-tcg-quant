#!/usr/bin/env node
// PSA10 sold(실거래) 수집 결과를 packs.json 에 반영한다 — 2026-08-31 신설.
//
// 왜 스크립트로 두나: 종전에는 psa10-sold-refresh.js 가 계획만 뽑고 반영은 "수동 또는 psa10-sold-write.js"
// 라고만 적혀 있었는데 그 파일이 없었다. 그래서 6/29 수집 뒤 아무도 반영을 못 했고 값이 두 달 멈췄다.
// 채택 기준을 사람 머릿속이 아니라 여기에 두면, 누가 언제 돌려도 같은 판단이 나온다.
//
// 입력: [{code, num, nr, old, oldN, now, low, high, n}] — 브라우저 추출기 결과
//   (URL·추출기는 psa10-sold-refresh.js 가 만든다. 그쪽 영문판 배제 필터와 짝을 이룬다)
//
// 채택 기준 — "틀린 값보다 빈 값이 낫다"
//   1) n >= 3        표본 3건 미만은 중앙값이 한 건에 흔들린다. 기존 값을 유지한다.
//   2) 0.5 <= 새값/옛값 <= 2   대역을 벗어나면 값이 아니라 **매칭이 바뀐 것**을 먼저 의심한다.
//      실제로 2026-08-31 에 x2.26 이 뜬 카드는 영문판("Alternate Art EN")이 섞인 것이었다.
//      벗어난 건은 반영하지 않고 목록으로 보고한다 — 사람이 리스팅 제목을 보고 판단할 몫이다.
//   3) 옛값이 없으면(첫 수집) n >= 3 만 보고 채택한다.
//
// Run: node tools/psa10-sold-write.js <결과.json> [--apply] [--force-review]
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const dataPath = path.join(ROOT, "data", "onepiece-packs.json");

const MIN_N = 3;
const BAND_LO = 0.5;
const BAND_HI = 2;

const [resultPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");
const forceReview = process.argv.includes("--force-review");
if (!resultPath) throw new Error("사용법: node tools/psa10-sold-write.js <결과.json> [--apply]");

const rows = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const today = new Date().toISOString().slice(0, 10);

// (세트코드, 카드번호, 변형이름) 로 카드를 찾는다. 같은 번호가 여러 세트·여러 변형에 있으므로
// 번호만으로 찾으면 남의 카드에 값을 쓴다(2026-08-31 실측: EB02-061 이 EB-02 manga 와 PRB-02 SP 로 둘).
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
function findCard(code, num, nr) {
  const set = data.sets?.[code];
  if (!set) return null;
  const cands = (set.cards || []).filter((c) => c.number === num);
  if (cands.length === 1) return cands[0];
  if (!cands.length) return null;
  // 여러 변형이 같은 번호를 쓰면 이름+레어도로 좁힌다. 정확히 하나로 좁혀질 때만 채택한다.
  const exact = cands.filter((c) => norm(`${c.name} ${c.rarity}`) === norm(nr));
  return exact.length === 1 ? exact[0] : null;
}

const applied = [], review = [], skipped = [], notFound = [];

for (const r of rows) {
  if (r.now == null || !(r.n >= MIN_N)) { skipped.push({ ...r, why: `표본 ${r.n || 0}건` }); continue; }
  const card = findCard(r.code, r.num, r.nr);
  if (!card) { notFound.push({ code: r.code, num: r.num, nr: r.nr }); continue; }

  const oldUsd = r.old || null;
  const ratio = oldUsd ? r.now / oldUsd : null;
  const outOfBand = ratio != null && (ratio < BAND_LO || ratio > BAND_HI);
  if (outOfBand && !forceReview) { review.push({ ...r, ratio: +ratio.toFixed(2) }); continue; }

  if (apply) {
    card.psa10Ebay = {
      source: "eBay Sold completed search (variant-filtered)",
      query: null,
      updated: today,
      marketplaceId: "EBAY_US",
      currency: "USD",
      low: r.low,
      middle: r.now,
      high: r.high,
      sampleSize: r.n,
      soldBased: true,
    };
  }
  applied.push({ code: r.code, num: r.num, old: oldUsd, now: r.now, n: r.n, ratio: ratio ? +ratio.toFixed(2) : null });
}

if (apply) {
  data.updated = today;
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
}

console.log(JSON.stringify({
  apply,
  반영: applied.length,
  검증필요: review.length,
  표본부족: skipped.length,
  카드못찾음: notFound.length,
  reviewList: review.map((x) => `${x.code} ${x.num} $${x.old}→$${x.now} (x${x.ratio}) n${x.n}`),
  notFoundList: notFound.map((x) => `${x.code} ${x.num} ${x.nr}`),
}, null, 1));
if (!apply) console.log("드라이런 — 반영하려면 --apply");
