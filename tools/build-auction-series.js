#!/usr/bin/env node
// 경매 시계열 집계 — 2026-08-06.
//
// data/auction-archive/<날짜>.json(하루 1파일, 한 번 쓰고 다시 안 고침)을 전부 읽어
// data/auction-series.json 에 **일봉·주봉·월봉**을 굽는다. 화면(일/주/월 토글)은 이 파일만 읽으면 된다.
//
// 왜 원장에서 매번 다시 굽나: 아카이브가 append-only 라 언제든 전 기간 재생성이 된다.
// 나중에 기준이 바뀌어도(분류를 쪼개거나 통화를 바꾸거나) 이 스크립트만 고쳐 다시 구우면 되고,
// 과거 값을 손으로 고칠 일이 없다.
//
// ⚠️ **불완전한 구간은 표시로 남긴다**(partial). 수집이 빠진 날(7/25·26)이나 부분 수집(7/27·8/6)을
//    그냥 그리면 "그날 경매가 급감"이라는 없는 사실이 생긴다. 지우지도 않고 섞지도 않는다 —
//    표시만 해두고 그릴지 말지는 화면이 정한다.
//
// 분류(4종, 서로 겹치지 않음):
//   box   … 밀봉 박스·카톤        graded … 등급 카드(제목에서 읽은 등급이 있는 것)
//   pack  … 낱팩                  raw    … 그 외 카드(무등급)
//   ※ grade 는 2026-07-22 부터 기록된다. 그 이전 날짜는 graded 를 집계하지 않고 gradeTracked:false 로 남긴다.
// Run: node tools/build-auction-series.js
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARCHIVE = path.join(ROOT, "data", "auction-archive");
const OUT = path.join(ROOT, "data", "auction-series.json");

// 등급 파싱이 들어간 날. 그 전 파일에는 grade 필드 자체가 없어서 0 이 아니라 "모름"이다.
const GRADE_SINCE = "2026-07-22";
// 하루 종료 건수가 이보다 적으면 수집이 덜 돈 날로 본다(정상일은 500건 이상, 부분 수집일은 91·271건이었다).
const PARTIAL_BELOW = 400;

const CATS = ["box", "graded", "raw", "pack"];
const empty = () => ({ ended: 0, sold: 0, unsold: 0, amount: 0, byCat: Object.fromEntries(CATS.map((c) => [c, { ended: 0, sold: 0, amount: 0 }])) });

const category = (s) => {
  if (s.kind === "box" || s.kind === "carton") return "box";
  if (s.kind === "pack") return "pack";
  return s.grade ? "graded" : "raw";
};

const isoWeekStart = (day) => {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); // 월요일 시작
  return t.toISOString().slice(0, 10);
};

function addSale(bucket, s) {
  const cat = category(s);
  bucket.ended += 1;
  bucket.byCat[cat].ended += 1;
  if (!s.sold) { bucket.unsold += 1; return; }
  bucket.sold += 1;
  bucket.byCat[cat].sold += 1;
  // 낙찰액은 개당가가 아니라 실제 결제 규모(가격×수량)로 본다. 통화가 USD 가 아니면 금액에서 뺀다
  // (환산해서 섞으면 어느 시점 환율인지 알 수 없는 값이 된다 — 빈 값이 틀린 값보다 낫다).
  if (s.currency === "USD" && s.price > 0) {
    const v = s.price * (s.qty || 1);
    bucket.amount += v;
    bucket.byCat[cat].amount += v;
  }
}

function finish(bucket, meta) {
  const round = (n) => Math.round(n * 100) / 100;
  bucket.amount = round(bucket.amount);
  for (const c of CATS) bucket.byCat[c].amount = round(bucket.byCat[c].amount);
  bucket.sellThrough = bucket.ended ? round((bucket.sold / bucket.ended) * 100) : null;
  return { ...meta, ...bucket };
}

function main() {
  if (!fs.existsSync(ARCHIVE)) throw new Error("auction-archive 폴더가 없다");
  const files = fs.readdirSync(ARCHIVE).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error("아카이브가 비어 있다");

  const daily = [];
  for (const f of files) {
    const day = f.slice(0, 10);
    const sales = JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), "utf8")).sales || [];
    const b = empty();
    for (const s of sales) addSale(b, s);
    daily.push(finish(b, {
      d: day,
      partial: b.ended < PARTIAL_BELOW,          // 수집이 덜 돈 날 — 화면에서 뺄지 흐리게 할지는 화면이 정한다
      gradeTracked: day >= GRADE_SINCE,          // false 면 graded/raw 구분이 없는 날이다
    }));
  }

  // 빠진 날짜를 찾아 둔다. 그래프에서 선을 이으면 없는 날이 채워진 것처럼 보인다.
  const gaps = [];
  for (let i = 1; i < daily.length; i += 1) {
    const prev = new Date(`${daily[i - 1].d}T00:00:00Z`);
    const cur = new Date(`${daily[i].d}T00:00:00Z`);
    for (let t = prev.getTime() + 86400000; t < cur.getTime(); t += 86400000) {
      gaps.push(new Date(t).toISOString().slice(0, 10));
    }
  }

  const roll = (keyOf) => {
    const map = new Map();
    for (const day of daily) {
      const k = keyOf(day.d);
      if (!map.has(k)) map.set(k, { bucket: empty(), days: 0, partialDays: 0, gradeDays: 0 });
      const g = map.get(k);
      g.days += 1;
      if (day.partial) g.partialDays += 1;
      if (day.gradeTracked) g.gradeDays += 1;
      g.bucket.ended += day.ended; g.bucket.sold += day.sold; g.bucket.unsold += day.unsold; g.bucket.amount += day.amount;
      for (const c of CATS) {
        g.bucket.byCat[c].ended += day.byCat[c].ended;
        g.bucket.byCat[c].sold += day.byCat[c].sold;
        g.bucket.byCat[c].amount += day.byCat[c].amount;
      }
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, g]) => finish(g.bucket, { d: k, days: g.days, partialDays: g.partialDays, gradeTracked: g.gradeDays === g.days }));
  };

  const out = {
    basis: "completed eBay auctions for One Piece Card Game items",
    note: "Daily, weekly and monthly rollups built from data/auction-archive (one append-only file per day). A day is flagged partial when fewer auctions were captured than a normal day, and missing days are listed in gaps — neither is silently smoothed over. Item grade is only parsed from listing titles since 2026-07-22, so earlier days carry gradeTracked:false and their graded/raw split is unknown, not zero. Amounts are winning bid x quantity in USD only; non-USD sales are counted but left out of amounts rather than converted at an unknown rate.",
    builtFrom: { first: daily[0].d, last: daily[daily.length - 1].d, files: files.length },
    gradeSince: GRADE_SINCE,
    gaps,
    daily,
    weekly: roll(isoWeekStart),
    monthly: roll((d) => `${d.slice(0, 7)}-01`),
  };

  fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`, "utf8");
  console.log(JSON.stringify({
    status: "ok",
    days: daily.length, weeks: out.weekly.length, months: out.monthly.length,
    partialDays: daily.filter((d) => d.partial).length, gaps: gaps.length,
    ended: daily.reduce((a, d) => a + d.ended, 0),
    amount: Math.round(daily.reduce((a, d) => a + d.amount, 0)),
  }));
}

if (require.main === module) main();
module.exports = { category, isoWeekStart };
