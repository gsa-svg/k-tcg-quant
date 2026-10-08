#!/usr/bin/env node
// 홈 첫 화면 정적 선렌더 — 2026-10-08. 라이트하우스 실사이트(모바일) 홈 70점의 원인: 시세판·딜 카드·세트 격자가
// JSON(186KB)→packs.js(45KB)→렌더 뒤에야 생겨 LCP 가 5.8초였다. 같은 packs.js 를 헤드리스 크롬에서 돌려 그 결과
// HTML 을 index.html / packs.html 의 마커 구간에 미리 박아 둔다. 방문자는 HTML 만으로 첫 화면을 보고, JS 는
// 뒤에 같은 내용을 다시 그린다(같은 코드·같은 데이터라 화면이 바뀌지 않는다). 템플릿을 두 벌 두지 않는 이유다.
//
// 절차: 저장소를 로컬 http 로 띄움 → puppeteer-core(크롬)로 /?hl=en 을 열어 렌더 완료를 기다림 → 컨테이너 innerHTML 추출 →
//       마커(<!--PRERENDER:id-->…<!--/PRERENDER:id-->) 사이를 교체. 크롬이 없으면 건너뛴다(exit 0) — 지난 선렌더가 남고 JS 가 갱신한다.
// 규칙: head·canonical·hreflang 은 건드리지 않는다. 외부 요청은 막는다(이미지 핫링크 X, 중계기 X). 첫 2장 딜 사진은 eager.
// Run: node tools/prerender-home.js [--check]
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const ROOT = path.join(__dirname, "..");
const PAGES = ["index.html", "packs.html"];
const IDS = ["quickSet", "marketStatus", "tickerBoard", "todayDeals", "packList"];
const checkOnly = process.argv.includes("--check");

function chromePath() {
  const cands = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return cands.find((p) => p && fs.existsSync(p)) || null;
}
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain" };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split("?")[0]);
      let p = path.join(ROOT, u.endsWith("/") ? u + "index.html" : u);
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}
const marker = (id) => [`<!--PRERENDER:${id}-->`, `<!--/PRERENDER:${id}-->`];
function replaceBetween(html, id, inner) {
  const [a, b] = marker(id);
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0 || j < i) return null;
  return html.slice(0, i + a.length) + inner + html.slice(j);
}

(async () => {
  const exe = chromePath();
  if (!exe) { console.log(JSON.stringify({ status: "skip", why: "크롬 없음 — 지난 선렌더 유지" })); return; }
  let puppeteer;
  try { puppeteer = require("puppeteer-core"); } catch { console.log(JSON.stringify({ status: "skip", why: "puppeteer-core 없음" })); return; }
  const { srv, base } = await serve();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "opbox-prerender-"));
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir, args: ["--no-sandbox", "--disable-gpu", "--window-size=1366,900"] });
  const out = { status: "ok", pages: {} };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.setRequestInterception(true);
    page.on("request", (r) => (r.url().startsWith(base) || r.url().startsWith("data:") ? r.continue() : r.abort()));
    await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} });
    await page.goto(`${base}/?hl=en`, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => document.querySelector("#todayDeals .dealCard") && document.querySelector("#packList .packChip") && document.querySelector("#tickerBoard .tbChip") && !document.querySelector("#quickSet select[disabled]"), { timeout: 30000 });
    const parts = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => { const el = document.getElementById(id); return [id, el ? el.innerHTML : null]; })), IDS);
    for (const id of IDS) if (parts[id] == null) throw new Error(`${id} 를 못 찾음`);
    // 딜 사진은 eBay CDN(외부 핫링크 — 가드 I1 금지, 헤드리스에선 차단돼 hidden 으로 남는다). 정적 화면엔 우리 박스 사진
    // (card-img/box/hero/<코드>.webp, 9KB)을 넣는다 — JS 가 뜨면 같은 자리에 실제 매물 사진을 다시 그린다(크기 같아 밀림 없음).
    // 앞 2장은 즉시·우선, 나머지는 지연 — packs.js 와 같은 규칙.
    let dealIdx = 0;
    parts.todayDeals = parts.todayDeals.replace(/<span class="dealPhoto"><img\b([^>]*)>(<span class="dealLbl">([A-Z]+-\d{2})[^<]*<\/span>)/g, (m, attrs, lbl, code) => {
      const local = `card-img/box/hero/${code}.webp`;
      if (!fs.existsSync(path.join(ROOT, local))) return m;
      const i = dealIdx++;
      const a = attrs.replace(/\s(src|loading|fetchpriority|hidden|onerror)(="[^"]*")?/g, "");
      return `<span class="dealPhoto"><img${a} src="${local}" ${i < 2 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'}>${lbl}`;
    });
    const leftover = (parts.todayDeals.match(/<img[^>]*src="https?:/g) || []).length;
    if (leftover) throw new Error(`todayDeals 에 외부 이미지 ${leftover}개가 남았다 — 가드 I1`);
    for (const f of PAGES) {
      const p = path.join(ROOT, f);
      if (!fs.existsSync(p)) continue;
      let html = fs.readFileSync(p, "utf8");
      const done = [];
      for (const id of IDS) {
        const next = replaceBetween(html, id, parts[id]);
        if (next == null) continue;         // 이 페이지엔 그 구간이 없다
        if (next !== html) { html = next; done.push(id); }
      }
      if (done.length && !checkOnly) fs.writeFileSync(p, html, "utf8");
      out.pages[f] = { updated: done, bytes: html.length };
    }
  } finally {
    await browser.close();
    srv.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
  console.log(JSON.stringify(out));
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
