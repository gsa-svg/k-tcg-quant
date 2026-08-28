// UI 스모크 — 화면폭별 레이아웃 회귀 검사. 2026-08-28 신설.
//
// 왜 만드나: 차트 2열 개편에서 "가운데 정렬 페이지 + 넓은 화면" 조합만 영문판 패널이
// 화면 밖으로 잘렸는데, 좁은 폭 몇 개만 손으로 확인하고 배포해 소유자가 세 번을
// 직접 찾아냈다. 사람이 화면 조합을 다 훑는 건 불가능하다 — 기계가 훑는다.
//
// 검사 항목 (페이지 × 폭 전 조합):
//   1) 가로 오버플로 없음 (scrollWidth <= clientWidth + 1)
//   2) 모든 차트 패널(.opbcPane)이 뷰포트 안에 온전히 들어옴
//   3) JS 콘솔 에러 0건
//   4) 홈은 상세 패널이 실제로 렌더됨(#detail 비어있지 않음)
//
// 실행: 로컬 정적 서버(포트 4321)를 켠 뒤  node tools/ui-smoke.mjs
//       (서버가 없으면 스스로 python http.server 를 띄웠다 끈다)
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const PAGES = [
  "/",                       // 홈(가운데 정렬 — 잘림 사고가 났던 레이아웃)
  "/?set=OP-08&hl=en",       // 홈 상세(JS 렌더 차트)
  "/sets/op-05.html",        // 세트(좌측 정렬 + 일별 탭 있음)
  "/sets/op-01.html",        // 세트(일별 탭 없어야 함)
  "/sets/op-17.html",        // 신규 세트(카드 없음 분기)
  "/ko/",                    // 한국어 허브
  "/compare.html",
  "/changelog.html",
];
const WIDTHS = [375, 768, 1024, 1240, 1440, 1972, 2560];

const ping = () => new Promise((res) => {
  http.get(BASE + "/robots.txt", (r) => { r.resume(); res(r.statusCode === 200); }).on("error", () => res(false));
});

let serverProc = null;
if (!(await ping())) {
  serverProc = spawn("python", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", ROOT], { stdio: "ignore" });
  for (let i = 0; i < 20 && !(await ping()); i++) await new Promise((r) => setTimeout(r, 250));
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
const problems = [];
let checked = 0;

try {
  const page = await browser.newPage();
  // 광고 스크립트는 로컬 CSP 밑에서 자체 폴백이 SyntaxError 를 내며 오탐을 만든다
  // (실서버 pageerror 0건 확인, 2026-08-28). 검사 대상은 우리 코드다 — 광고는 끊는다.
  await page.setRequestInterception(true);
  page.on("request", (r) => (/googlesyndication|adtrafficquality|doubleclick|googletagmanager|google-analytics/.test(r.url()) ? r.abort() : r.continue()));
  const consoleErrs = [];
  page.on("pageerror", (e) => consoleErrs.push(String(e).slice(0, 160)));

  for (const p of PAGES) {
    for (const w of WIDTHS) {
      consoleErrs.length = 0;
      await page.setViewport({ width: w, height: 900 });
      await page.goto(BASE + p + (p.includes("?") ? "&" : "?") + "smoke=" + w, { waitUntil: "networkidle2", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 700));
      const res = await page.evaluate(() => {
        const doc = document.documentElement;
        const out = { scrollW: doc.scrollWidth, clientW: doc.clientWidth, clipped: [], detailEmpty: false };
        // 스크롤 컨테이너(overflow-x:auto) 안에 있는 요소는 화면 밖으로 나가는 게 정상이다
        // (티커 칩·내비 링크) — 잘림 판정에서 뺀다.
        const inScroller = (el) => {
          for (let a = el.parentElement; a; a = a.parentElement) {
            const o = getComputedStyle(a).overflowX;
            if (o === "auto" || o === "scroll") return true;
          }
          return false;
        };
        document.querySelectorAll(".opbcGridWrap:not([hidden]) .opbcPane").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) && !inScroller(el)) {
            out.clipped.push(((el.querySelector(".opbcLabel") || {}).textContent || "pane") + "@" + Math.round(r.left) + "~" + Math.round(r.right) + "/vw" + innerWidth);
          }
        });
        const detail = document.querySelector("#detail");
        if (detail && location.search.includes("set=") && detail.innerHTML.trim().length < 50) out.detailEmpty = true;
        return out;
      });
      checked++;
      const tag = `${p} @${w}`;
      if (res.scrollW > res.clientW + 1) problems.push(`${tag}: 가로 오버플로 (scroll ${res.scrollW} > client ${res.clientW})`);
      for (const c of res.clipped) problems.push(`${tag}: 패널 잘림 ${c}`);
      if (res.detailEmpty) problems.push(`${tag}: 상세 패널이 렌더되지 않음`);
      for (const e of consoleErrs) problems.push(`${tag}: JS 에러 — ${e}`);
    }
  }
} finally {
  await browser.close();
  if (serverProc) serverProc.kill();
}

const out = { smoke: problems.length ? "FAIL" : "OK", combos: checked, problems };
console.log(JSON.stringify(out, null, 1));
if (problems.length) process.exit(1);
