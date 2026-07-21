#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "data", "gemrate-psa-history.json");
const dayMs = 864e5;

function chromeExecutable() {
  const candidates = process.platform === "win32"
    ? [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      ]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find(fs.existsSync) || null;
}

function dateMs(date) {
  return Date.parse(`${date}T00:00:00Z`);
}

function latestWednesday(rows) {
  return [...rows].reverse().find((row) => new Date(`${row.date}T00:00:00Z`).getUTCDay() === 3)?.date || null;
}

function correctionReason(code, date, grades, gems, priorValues) {
  if (!Number.isInteger(grades) || !Number.isInteger(gems) || grades < 0 || gems < 0 || gems > grades) {
    return `${code} ${date}: invalid cumulative delta from the public source`;
  }
  const sorted = priorValues.filter(Number.isFinite).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  if (grades > Math.max(10000, median * 10)) return `${code} ${date}: upstream cumulative reset/recovery produced an implausible weekly delta`;
  return null;
}

function appendVerifiedWeeks(source, rowsByCode) {
  const through = latestWednesday(Object.values(rowsByCode)[0] || []);
  if (!through || through <= source.weeklyThrough) return { changed: false, through: source.weeklyThrough, added: [] };

  const newDates = [];
  for (let time = dateMs(source.weeklyThrough) + 7 * dayMs; time <= dateMs(through); time += 7 * dayMs) {
    newDates.push(new Date(time).toISOString().slice(0, 10));
  }

  source.corrections ||= {};
  for (const date of newDates) {
    let covered = 0;
    for (const [code, set] of Object.entries(source.sets)) {
      const rows = rowsByCode[code] || [];
      const current = rows.find((row) => row.date === date);
      const previousDate = new Date(dateMs(date) - 7 * dayMs).toISOString().slice(0, 10);
      const previous = rows.find((row) => row.date === previousDate);
      if (!current || !previous) {
        (source.corrections[code] ||= []).push({ date, reason: "GemRate public source did not expose both Wednesday cumulative rows; omitted rather than estimated." });
        covered += 1;
        continue;
      }
      const grades = current.total_grades - previous.total_grades;
      const gems = current.total_gems - previous.total_gems;
      const reason = correctionReason(code, date, grades, gems, (set.weekly || []).map((point) => point.grades));
      if (reason) {
        (source.corrections[code] ||= []).push({ date, reason });
      } else {
        set.weekly.push({ d: date, grades, gems, totalGrades: current.total_grades, totalGems: current.total_gems });
      }
      covered += 1;
    }
    if (covered !== Object.keys(source.sets).length) throw new Error(`${date}: incomplete set coverage`);
    source.retainedWeeklyDates.push(date);
  }

  for (const [code, set] of Object.entries(source.sets)) {
    const latest = (rowsByCode[code] || []).at(-1);
    if (!latest) throw new Error(`${code}: latest cumulative row missing`);
    set.latest = {
      date: latest.date,
      totalGrades: latest.total_grades,
      totalGems: latest.total_gems,
      gemRate: Math.round((latest.total_gems / latest.total_grades) * 1000) / 10,
    };
  }
  source.weeklyThrough = newDates.at(-1);
  source.collectedAt = Object.values(source.sets).map((set) => set.latest.date).sort().at(0);
  return { changed: true, through: source.weeklyThrough, added: newDates };
}

async function waitForJson(url, attempts = 75) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { const response = await fetch(url); if (response.ok) return response.json(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Chrome DevTools endpoint unavailable: ${url}`);
}

async function collectRows(source) {
  const executable = chromeExecutable();
  if (!executable) throw new Error("Chrome/Chromium is required for the public GemRate collection step");
  const port = 9334;
  const profile = path.join(process.env.RUNNER_TEMP || process.env.TEMP || root, `opbox-gemrate-${process.pid}`);
  const chrome = spawn(executable, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    const pending = new Map();
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++sequence;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
    await send("Page.enable");

    const rowsByCode = {};
    for (const [code, set] of Object.entries(source.sets)) {
      await send("Page.navigate", { url: set.url });
      let rows = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1200 : 250));
        const response = await send("Runtime.evaluate", {
          expression: "Array.isArray(globalThis.RowData) ? globalThis.RowData : null",
          returnByValue: true,
        });
        rows = response.result?.result?.value;
        if (Array.isArray(rows) && rows.length > 10) break;
      }
      if (!Array.isArray(rows) || rows.length < 10) throw new Error(`${code}: GemRate RowData unavailable; no files changed`);
      rowsByCode[code] = rows;
      process.stdout.write(`Collected ${code}: ${rows.at(-1).date}\n`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    socket.close();
    return rowsByCode;
  } finally {
    chrome.kill();
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
  }
}

async function main() {
  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const rows = await collectRows(source);
  const result = appendVerifiedWeeks(source, rows);
  if (result.changed) fs.writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: result.changed ? "updated" : "current", ...result }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.stack); process.exitCode = 1; });

module.exports = { appendVerifiedWeeks, correctionReason, latestWednesday };
