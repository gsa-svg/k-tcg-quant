#!/usr/bin/env node
"use strict";
// 390px 표 측정 — 2026-10-14 QA 신설. 저장소를 로컬 http 로 띄우고 실제 브라우저(로컬 Chrome + puppeteer-core)에서 잰다.
//
// 왜: 공용 모바일 규칙(.bodyPage table → 가로 스크롤 + 오른쪽 28px 흐림)이 넘치지 않는 표에도 걸려 마지막 열 숫자가
//     잘린 것처럼 보였고(box-prices 최저가 표 '12'의 2, eb-05 사실 표 '$132'), box-prices 전체 표는 '4-wk change' 열이
//     화면 밖으로 밀렸다. 정적 검사로는 폭을 알 수 없어 렌더해서 잰다.
// 규칙(페이지마다)
//  · 문서 가로 넘침 0 (scrollWidth ≤ clientWidth)
//  · 폭 안에 들어오는 표(scrollWidth ≤ clientWidth)에 mask-image 금지 — 흐림은 실제로 넘치는 표에만
//  · 지정한 "한 화면 표"(.tblFit)는 넘치지 않아야 한다
// Chrome 이 없는 환경(클라우드 워크플로)에서는 건너뛴다({"status":"skip"}) — 로컬 검증 단계에서 돌린다.
// Run: node tools/audit-mobile-tables.js [page ...]   (AMT_VERBOSE=1 → 표마다 폭·흐림 출력)
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = 4473;
const CHROME = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && fs.existsSync(p));
const DEFAULT_PAGES = [
  "/", "/box-prices.html", "/sets/index.html", "/sets/op-17.html", "/sets/op-01-english.html", "/sets/op-18.html", "/sets/eb-05.html",
  "/sets/op-17-card-list.html", "/ko/op-17-card-list.html", "/ko/", "/ja/release-dates.html",
  "/articles/one-piece-set-list-release-dates.html", "/articles/how-many-packs-one-piece-booster-box.html",
];
// 인자는 저장소 상대 경로(sets/op-17.html) — 앞의 / 는 붙여 준다(Git Bash 는 /로 시작하는 인자를 윈도우 경로로 바꾼다).
const pages = process.argv.slice(2).length ? process.argv.slice(2).map((a) => "/" + a.replace(/^\/+/, "")) : DEFAULT_PAGES;

let puppeteer = null;
try { puppeteer = require(path.join(ROOT, "node_modules", "puppeteer-core")); } catch {}
if (!CHROME || !puppeteer) {
  console.log(JSON.stringify({ audit: "MOBILE_TABLES", status: "skip", reason: !CHROME ? "Chrome not found" : "puppeteer-core not installed" }));
  process.exit(0);
}

const SERVER = `const fs=require("fs"),path=require("path"),http=require("http");const R=${JSON.stringify(ROOT)};const M={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".json":"application/json",".webp":"image/webp",".png":"image/png",".svg":"image/svg+xml",".woff2":"font/woff2"};
http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split("?")[0]);let p=path.join(R,u.endsWith("/")?u+"index.html":u);if(!p.startsWith(R)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){s.writeHead(404);s.end();return}s.writeHead(200,{"Content-Type":M[path.extname(p)]||"application/octet-stream"});fs.createReadStream(p).pipe(s)}).listen(${PORT},"127.0.0.1");`;

(async () => {
  const srv = spawn(process.execPath, ["-e", SERVER], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "amt-")), args: ["--no-sandbox"] });
  const problems = [], report = [];
  try {
    for (const pg of pages) {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 });
      await page.setRequestInterception(true);
      page.on("request", (r) => (r.url().startsWith(`http://127.0.0.1:${PORT}`) ? r.continue() : r.abort()));
      await page.goto(`http://127.0.0.1:${PORT}${pg}`, { waitUntil: "load", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 600));
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const tables = [...document.querySelectorAll("table")].filter((t) => t.offsetParent !== null).map((t) => {
          const cs = getComputedStyle(t);
          const mask = cs.maskImage && cs.maskImage !== "none" ? cs.maskImage : cs.webkitMaskImage && cs.webkitMaskImage !== "none" ? cs.webkitMaskImage : "none";
          // 표를 감싼 가로 스크롤 상자(overflow-x:auto)도 본다 — display:table 인 표는 자기 폭은 맞아도 상자 안에서 넘칠 수 있다.
          let wrap = t.parentElement, wrapOver = 0;
          for (let i = 0; wrap && i < 3; i++, wrap = wrap.parentElement) { const o = getComputedStyle(wrap).overflowX; if ((o === "auto" || o === "scroll") && wrap.scrollWidth > wrap.clientWidth + 1) { wrapOver = wrap.scrollWidth - wrap.clientWidth; break; } }
          return { cls: t.className || t.getAttribute("aria-label") || "(table)", sw: t.scrollWidth, cw: t.clientWidth, masked: mask !== "none", fit: t.classList.contains("tblFit"), wrapOver };
        });
        return { sw: de.scrollWidth, cw: de.clientWidth, tables };
      });
      if (m.sw > m.cw) problems.push(`${pg}: page overflows ${m.sw}px > ${m.cw}px`);
      for (const t of m.tables) {
        if (t.sw <= t.cw + 1 && t.masked) problems.push(`${pg}: table "${t.cls}" fits (${t.sw}≤${t.cw}) but is masked`);
        if (t.fit && t.sw > t.cw + 1) problems.push(`${pg}: .tblFit table "${t.cls}" overflows (${t.sw}>${t.cw})`);
        if (t.fit && t.wrapOver) problems.push(`${pg}: .tblFit table "${t.cls}" overflows its scroll box by ${t.wrapOver}px — a column is hidden off-screen`);
      }
      report.push({ page: pg, sw: m.sw, tables: process.env.AMT_VERBOSE ? m.tables : m.tables.length });
      await page.close();
    }
  } finally { await browser.close(); srv.kill(); }
  const out = { audit: "MOBILE_TABLES", status: problems.length ? "fail" : "ok", width: 390, pages: report.length, problems, ...(process.env.AMT_VERBOSE ? { report } : {}) };
  console.log(JSON.stringify(out, null, 1));
  if (problems.length) process.exit(1);
})().catch((e) => { console.log(JSON.stringify({ audit: "MOBILE_TABLES", status: "error", error: e.message })); process.exit(1); });
