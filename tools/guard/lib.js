"use strict";
// 가드 모듈 공용 — 2026-10-15 가드 분할(tools/guard/*.js). 파일은 한 번만 읽고(캐시) 모듈은 errors/warnings 에 밀어 넣는다.
// 값 대조(PUBLISH_TOUCHED 가 거짓이면 경고)는 sink(code) 로 — 수집·환율 워크플로가 페이지를 안 굽는 날 묵은 어긋남이 수집 커밋을 막지 않게([[opbox-never-miss-collection]]).
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const errors = [];
const warnings = [];
const FILES = new Map();
const JSONS = new Map();
const read = (p) => {
  let v = FILES.get(p);
  if (v === undefined) { v = fs.readFileSync(path.join(ROOT, p), "utf8"); FILES.set(p, v); }
  return v;
};
const exists = (p) => fs.existsSync(path.join(ROOT, p));
// JSON 은 한 번만 파싱한다(packs 750KB 를 15번 파싱하던 것이 종전 가드 시간의 절반이었다). fallback 이 있으면 실패해도 던지지 않는다.
const json = (p, fallback) => {
  if (JSONS.has(p)) return JSONS.get(p);
  let v;
  try { v = JSON.parse(read(p)); } catch (e) { if (fallback === undefined) throw e; v = fallback; }
  JSONS.set(p, v);
  return v;
};
const list = (dir, re) => { try { return fs.readdirSync(path.join(ROOT, dir)).filter((f) => re.test(f)).sort(); } catch { return []; } };
const PUBLIC_HTML = ["", "sets", "cards", "articles", "ko", "ja"].flatMap((d) => list(d, /\.html$/).map((f) => (d ? `${d}/${f}` : f)));   // ja/ = 일본어 발매일 표(2026-10-14 W8)

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
const unH = (s) => String(s ?? "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");   // 생성기 esc 와 같은 이스케이프
const strip = (h) => unH(String(h ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const ldOf = (h) => [...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
const ldFlat = (h) => ldOf(h).flatMap((j) => (j["@graph"] ? j["@graph"] : [j]));
// 보이는 글자만 — 스크립트·스타일·SVG·주석 제외. meta description 은 검색 결과에 보이므로 따로 더한다.
const shownText = (h) => h.replace(/<!--[\s\S]*?-->/g, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const descOf = (h) => unH((h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const shortDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`; };

// 이번 실행이 페이지·사이트맵·피드를 바꿨는가 — 바꾸지 않은 실행(수집·환율 워크플로)에서는 값 대조를 경고로만 남긴다.
const PUBLISH_TOUCHED = (() => {
  try {
    const r = spawnSync("git", ["status", "--porcelain", "--", "sitemap.xml", "feed.xml", "*.html"], { cwd: ROOT, encoding: "utf8" });
    return r.status !== 0 || !!String(r.stdout || "").trim();
  } catch { return true; }
})();
const sink = (code) => (msg) => (PUBLISH_TOUCHED ? errors : warnings).push(PUBLISH_TOUCHED ? `${code}: ${msg}` : `${code}(경고) ${msg}`);
const fail = (code) => (msg) => errors.push(`${code}: ${msg}`);
// 같은 코드의 오류가 많을 때 앞 n 건만 남기고 나머지는 건수로.
const capped = (code, n = 10, where = errors) => { let k = 0; const f = (msg) => { if (k++ < n) where.push(`${code}: ${msg}`); }; f.flush = () => { if (k > n) where.push(`${code}: 그 밖에 ${k - n}건 더`); }; return f; };

const packs = () => json("data/onepiece-packs.json");
const series = () => json("data/box-sold-series.json", { sets: {} });
const setFacts = () => json("data/set-facts.json", { sets: {} });
let FACTS = null;
const facts = () => (FACTS ||= require("../build-site-facts").load());
const useFacts = (f) => { FACTS = f; };   // 테스트용 — 변조한 사실을 가드에 준다(test-guard-structural.js)

module.exports = { ROOT, errors, warnings, read, exists, json, list, PUBLIC_HTML, ISO, money, unH, esc, strip, ldOf, ldFlat, shownText, descOf, longDate, shortDate, MONTHS, PUBLISH_TOUCHED, sink, fail, capped, packs, series, setFacts, facts, useFacts, spawnSync, fs, path };
