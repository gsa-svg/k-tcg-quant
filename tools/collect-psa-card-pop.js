#!/usr/bin/env node
// 카드별 PSA 인구 수집 — 2026-08-10 정식화(지난 월요일엔 임시 스크립트로 돌렸다).
//
// GemRate 의 item-details-advanced 페이지에 세트의 카드별 RowData 가 통째로 실려 온다.
// URL 은 추측하지 않는다 — 검증된 gemrate-psa-history(일본판)·gemrate-psa-en-totals(영문판)의
// set-population-trend URL 에서 **경로만** item-details-advanced 로 바꾼다
// (세트명 규칙을 추측하다 OP-06·OP-02 에서 다른 세트가 적재될 뻔한 전례가 있다).
//
// 하네스는 collect-gemrate-psa-history.js 와 동일한 CDP 패턴: 빈 URL 이면 직전 세트의
// RowData 를 그대로 읽는 사고(2026-07-27)가 있어, URL 검증 실패는 예외로 끊는다.
//
// Run: node tools/collect-psa-card-pop.js --probe   (첫 세트의 원시 RowData 키만 출력 — 필드명 확인용)
//      node tools/collect-psa-card-pop.js <출력덤프.json>   → 이어서 psa-card-pop-ingest.js <덤프>
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.join(__dirname, "..");

function chromeExecutable() {
  const candidates = process.platform === "win32"
    ? [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      ]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find(fs.existsSync) || null;
}

async function waitForJson(url, attempts = 75) {
  for (let i = 0; i < attempts; i += 1) {
    try { return await (await fetch(url)).json(); } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error(`Chrome DevTools endpoint unavailable: ${url}`);
}

// 두 원장에서 (세트코드, 판, URL) 목록을 만든다. URL 형식이 어긋나면 그 자리에서 끊는다.
function sources() {
  const out = [];
  const jp = JSON.parse(fs.readFileSync(path.join(root, "data", "gemrate-psa-history.json"), "utf8"));
  for (const [code, set] of Object.entries(jp.sets || {})) {
    if (set.url) out.push({ code, ed: "jp", url: set.url });
  }
  const en = JSON.parse(fs.readFileSync(path.join(root, "data", "gemrate-psa-en-totals.json"), "utf8"));
  for (const [code, set] of Object.entries(en.sets || {})) {
    // 영문판 원장은 아직 GemRate 에 없는 세트를 null 로 둔다(OP-14·15) — 건너뛴다
    if (set && set.url) out.push({ code, ed: "en", url: set.url });
  }
  for (const s of out) {
    if (!/^https:\/\/www\.gemrate\.com\/set-population-trend\?/.test(s.url)) {
      throw new Error(`${s.code}|${s.ed}: 원장 URL 형식이 다름 — 아무것도 쓰지 않음`);
    }
    s.url = s.url.replace("/set-population-trend?", "/item-details-advanced?");
  }
  return out;
}

async function main() {
  const probe = process.argv.includes("--probe");
  const outPath = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
  if (!probe && !outPath) throw new Error("사용법: --probe 또는 <출력덤프.json>");

  const list = sources();
  console.log(`세트 ${list.length}개 (jp ${list.filter((s) => s.ed === "jp").length} · en ${list.filter((s) => s.ed === "en").length})`);

  const executable = chromeExecutable();
  if (!executable) throw new Error("Chrome 이 필요하다");
  const port = 9341;
  const profile = path.join(process.env.TEMP || root, `opbox-psacard-${process.pid}`);
  const chrome = spawn(executable, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore" });

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let seq = 0;
    const pending = new Map();
    socket.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++seq; pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
    await send("Page.enable");

    const dump = { grader: "psa", collectedAt: new Date().toISOString().slice(0, 10), sets: {} };
    for (const s of (probe ? list.slice(0, 1) : list)) {
      await send("Page.navigate", { url: s.url });
      let rows = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((r) => setTimeout(r, attempt === 0 ? 1500 : 300));
        const res = await send("Runtime.evaluate", {
          expression: "Array.isArray(globalThis.RowData) ? globalThis.RowData : null",
          returnByValue: true,
        });
        rows = res.result?.result?.value;
        if (Array.isArray(rows) && rows.length > 5) break;
      }
      if ((!Array.isArray(rows) || rows.length < 5) && probe) {
        // 진단: RowData 가 없으면 window 전역에서 "객체 배열(5행 이상)"을 전부 찾아 이름과 키를 보고한다
        const diag = await send("Runtime.evaluate", {
          expression: `(() => {
            const found = [];
            for (const k of Object.getOwnPropertyNames(window)) {
              try {
                const v = window[k];
                if (Array.isArray(v) && v.length >= 5 && typeof v[0] === "object" && v[0] && !Array.isArray(v[0])) {
                  found.push({ name: k, len: v.length, keys: Object.keys(v[0]).slice(0, 12) });
                }
              } catch {}
            }
            const tables = [...document.querySelectorAll("table")].map((t) => ({
              rows: t.rows.length,
              head: [...(t.rows[0]?.cells || [])].map((c) => c.textContent.trim()).slice(0, 10),
            }));
            return { title: document.title, found: found.slice(0, 10), tables: tables.slice(0, 3) };
          })()`,
          returnByValue: true,
        });
        console.log("진단:", JSON.stringify(diag.result?.result?.value, null, 1).slice(0, 1600));
        return;
      }
      if (!Array.isArray(rows) || rows.length < 5) throw new Error(`${s.code}|${s.ed}: RowData 없음 — 아무것도 쓰지 않음`);
      if (probe) {
        console.log("원시 키:", JSON.stringify(Object.keys(rows[0])));
        console.log("샘플 3행:", JSON.stringify(rows.slice(0, 3), null, 1).slice(0, 900));
        return;
      }
      // 필드명은 --probe 로 실측해 맞춘다(2026-08-10 확인). 모르는 구조면 빈 값이 아니라 예외.
      dump.sets[`${s.code}|${s.ed}`] = rows.map((r) => {
        const num = r.card_number ?? r.cardNumber ?? r.num;
        const total = r.total_graded ?? r.total ?? r.totalGraded;
        const g10 = r.gem_mint ?? r.g10 ?? r.gem10 ?? r.psa10;
        const g9 = r.mint_9 ?? r.g9 ?? r.psa9;
        const name = r.card_name ?? r.name ?? r.player;
        const par = r.parallel ?? r.variety ?? r.par ?? "";
        if (num == null || total == null) throw new Error(`${s.code}|${s.ed}: 알 수 없는 행 구조 ${JSON.stringify(Object.keys(r))}`);
        return { num: String(num), name: String(name ?? ""), par: String(par ?? ""), total: Number(total), g10: Number(g10 ?? 0), g9: Number(g9 ?? 0) };
      });
      console.log(`${s.code}|${s.ed}: ${dump.sets[`${s.code}|${s.ed}`].length}행`);
    }
    fs.writeFileSync(outPath, `${JSON.stringify(dump)}\n`, "utf8");
    console.log(JSON.stringify({ status: "ok", sets: Object.keys(dump.sets).length, out: outPath }));
  } finally {
    try { chrome.kill(); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
