#!/usr/bin/env node
"use strict";
// 반다이 상품 페이지 확인 — 발매 전 세트(data/upcoming-set-pages.json)의 일본판·영문판 상품 페이지와 일본판 카드리스트 목록을 매일 읽는다. 2026-10-19 신설.
//
// 왜: 발매일 질문(e06 e07 k05 k06)에서 이긴 페이지는 "Updated 18 October · We checked both product pages on 18 October" 였고,
//     우리는 "facts checked October 14" 에 멈춰 있었다(사실이 안 바뀌면 확인일도 안 바뀌었다). 확인한 날을 실제로 확인한 날로 적는다.
// 규칙
//  · 확인 = 그날 받은 상품 페이지 글자에 데이터 파일의 발매일과 팩 정가 문자열이 그대로 있다(일본판 "2026年11月21日"·"240円",
//    영문판 "November 20, 2026"·"$4.99"). 두 판 모두 맞을 때만 lastOkOn = 그날. 하나라도 못 받거나 다르면 lastOkOn 은 그대로(거짓 표기 없음)
//    — 다르면 mismatch 에 무엇이 달랐는지 남긴다(사실 파일을 사람이 고칠 일).
//  · 카드리스트 = 일본판 /cardlist/ 상품 선택 상자에 【코드】 가 있는가(공개 여부). 목록을 받은 날 = cardList.checkedOn.
//  · log 에 매 시도(날짜·코드·판별 HTTP 상태·결과)를 남긴다 — 가드 BD1 이 화면의 확인일이 로그의 성공 날짜인지 대조한다. 최근 120줄만.
//  · 네트워크 수집기라 빌드 밖(워크플로가 build 앞에서 돈다). 실패해도 exit 0 — 직전 파일이 그대로 배포된다.
// Run: node tools/check-bandai-product-pages.js [--date YYYY-MM-DD]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "bandai-product-check.json");
const UA = "Mozilla/5.0 (compatible; OPBoxIndex/1.0; +https://opboxindex.com/)";
const GAP_MS = 2000, TIMEOUT_MS = 45000, LOG_MAX = 120;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const argAt = process.argv.indexOf("--date");
const DAY = argAt > 0 && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[argAt + 1] || "") ? process.argv[argAt + 1] : new Date().toISOString().slice(0, 10);

const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; } };
const text = (html) => String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const jpDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${y}年${m}月${d}日`; };
const enDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 상품 페이지 주소 = 데이터 파일 sourceHtml 의 반다이 링크(손으로 만든 주소를 쓰지 않는다)
function productUrls(page) {
  const hrefs = [...String(page.sourceHtml || "").matchAll(/href="(https:\/\/(?:www|en)\.onepiece-cardgame\.com\/products\/[^"]+)"/g)].map((m) => m[1]);
  return { jp: hrefs.find((h) => h.startsWith("https://www.")) || null, en: hrefs.find((h) => h.startsWith("https://en.")) || null };
}
// 기대 정가 = 데이터 파일 facts 의 "Japanese MSRP"(¥240 …) · "English MSRP"(USD $4.99 …)
function expectedPrice(page, ed) {
  const row = (page.facts || []).find(([k]) => k === (ed === "jp" ? "Japanese MSRP" : "English MSRP"));
  if (!row) return null;
  const m = ed === "jp" ? String(row[1]).match(/¥\s?([\d,]+)/) : String(row[1]).match(/\$\s?(\d+\.\d{2})/);
  return m ? (ed === "jp" ? `${m[1].replace(/,/g, "")}円` : `$${m[1]}`) : null;
}
async function get(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: r.status, body: r.ok ? await r.text() : "" };
  } catch (e) { return { status: 0, body: "", error: e.message }; }
}

async function main() {
  const pages = (readJson(path.join(ROOT, "data", "upcoming-set-pages.json"), { pages: [] }).pages || []).filter((p) => p.code);
  const prev = readJson(OUT, { sets: {}, log: [] });
  const out = { note: "Written only by tools/check-bandai-product-pages.js. lastOkOn = last day both Bandai product pages (JP, EN) were fetched and still showed the release date and pack MSRP in data/upcoming-set-pages.json; cardList.checkedOn = last day the Japanese /cardlist/ product selector was fetched. log = every attempt.", updated: DAY, sets: {}, log: Array.isArray(prev.log) ? prev.log.slice() : [] };
  const list = await get("https://www.onepiece-cardgame.com/cardlist/");
  await sleep(GAP_MS);
  for (const page of pages) {
    const was = (prev.sets || {})[page.code] || {};
    const urls = productUrls(page);
    const rec = { lastOkOn: was.lastOkOn || null, lastTriedOn: DAY, ok: false, jp: null, en: null, mismatch: [], cardList: was.cardList || null };
    for (const ed of ["jp", "en"]) {
      const url = urls[ed], rel = ed === "jp" ? page.releaseJp : page.releaseEn;
      if (!url || !rel) { rec[ed] = { url, status: null }; rec.mismatch.push(`${ed}: no url/date`); continue; }
      const r = await get(url);
      await sleep(GAP_MS);
      const t = text(r.body);
      const wantDate = ed === "jp" ? jpDate(rel) : enDate(rel), wantPrice = expectedPrice(page, ed);
      const releaseFound = !!r.body && t.includes(wantDate), priceFound = !!r.body && !!wantPrice && t.includes(wantPrice);
      rec[ed] = { url, status: r.status, release: rel, releaseText: wantDate, releaseFound, price: wantPrice, priceFound };
      if (!r.body) rec.mismatch.push(`${ed}: HTTP ${r.status}${r.error ? " " + r.error : ""}`);
      else { if (!releaseFound) rec.mismatch.push(`${ed}: "${wantDate}" not on page`); if (!priceFound) rec.mismatch.push(`${ed}: "${wantPrice}" not on page`); }
    }
    rec.ok = !!(rec.jp && rec.jp.releaseFound && rec.jp.priceFound && rec.en && rec.en.releaseFound && rec.en.priceFound);
    if (rec.ok) rec.lastOkOn = DAY;
    if (list.body) {
      const listed = new RegExp(`【${page.code}】`).test(list.body);
      rec.cardList = { listed, checkedOn: DAY };
    }
    out.sets[page.code] = rec;
    out.log.push({ d: DAY, code: page.code, ok: rec.ok, jp: rec.jp && rec.jp.status, en: rec.en && rec.en.status, list: list.status, mismatch: rec.mismatch.length ? rec.mismatch : undefined });
  }
  out.log = out.log.slice(-LOG_MAX);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
  console.log(JSON.stringify({ day: DAY, sets: Object.fromEntries(Object.entries(out.sets).map(([k, v]) => [k, { ok: v.ok, lastOkOn: v.lastOkOn, cardList: v.cardList, mismatch: v.mismatch }])), list: list.status }));
}
main().catch((e) => { console.error("check-bandai-product-pages failed:", e.message); process.exit(0); });
