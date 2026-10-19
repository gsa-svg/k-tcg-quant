#!/usr/bin/env node
"use strict";
// tools/indexnow-submit.js plan() 검사 — 2026-10-19. 네트워크 없음(전송하지 않고 목록만 만든다).
//  · 월요일(UTC)엔 AI 인용 데이터 페이지 전체(WEEKLY_FIXED 중 사이트맵에 있는 것 + 세트 페이지)가 들어간다 — 가격만 바뀌어 lastmod 가 안 오르는 페이지.
//  · 발매 전 세트 페이지는 주간 묶음이 아니라 발매 창(가장 이른 발매일 −31일 ~ +5일)에서만 매일 들어간다.
//  · 최근 묶음은 lastmod ≥ 날짜−2일(cron 이 빠진 날 보충). 미래 lastmod 는 넣지 않는다.
// Run: node tools/test-indexnow-plan.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { plan, WEEKLY_FIXED } = require("./indexnow-submit");

const ROOT = path.join(__dirname, "..");
const sm = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
const inSitemap = (p) => sm.includes(`<loc>https://opboxindex.com${p}</loc>`);
const up = JSON.parse(fs.readFileSync(path.join(ROOT, "data/upcoming-set-pages.json"), "utf8")).pages || [];
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// 2026-10-19 은 월요일
const mon = plan("2026-10-19", { weekly: false, urls: null });
assert.equal(mon.monday, true);
for (const p of WEEKLY_FIXED.filter(inSitemap)) assert.ok(mon.urls.includes(`https://opboxindex.com${p}`), `월요일 묶음에 ${p} 가 없다`);
assert.ok(mon.urls.includes("https://opboxindex.com/sets/op-01.html") && mon.urls.includes("https://opboxindex.com/sets/op-01-english.html"), "월요일 묶음에 세트·영문판 페이지가 없다");

// 화요일 — 주간 묶음 없음
const tue = plan("2026-10-20", { weekly: false, urls: null });
assert.equal(tue.weekly, 0, "월요일이 아닌데 주간 묶음이 들어갔다");

// 발매 창 — 각 예정 세트의 창 첫날·마지막날은 들어가고, 창 밖 날은 그 세트 페이지가 (발매 창 이유로) 들어가지 않는다
for (const p of up) {
  const first = [p.releaseEn, p.releaseJp].filter(Boolean).sort()[0];
  const loc = `https://opboxindex.com/sets/${p.slug}.html`;
  if (!first || !inSitemap(`/sets/${p.slug}.html`)) continue;
  for (const d of [addDays(first, -31), addDays(first, 5)]) assert.ok(plan(d, { weekly: false, urls: null }).urls.includes(loc), `${d} 에 ${p.slug} 발매 창 페이지가 없다`);
  const out = plan(addDays(first, 6), { weekly: false, urls: null });
  assert.ok(!out.windows.find((w) => w.slug === p.slug).open, `${p.slug} 창이 +6일에도 열려 있다`);
}

// 최근 묶음 — 미래 lastmod 는 없다
const any = plan("2026-10-19", { weekly: false, urls: null });
assert.ok(any.recentSince === "2026-10-17");

// 수동 — 사이트맵에 있는 경로만
const man = plan("2026-10-20", { weekly: false, urls: "/box-prices.html,/no-such-page.html" });
assert.equal(man.manual, 1);
console.log(JSON.stringify({ test: "indexnow-plan", ok: true, monday: mon.send, tuesday: tue.send }));
