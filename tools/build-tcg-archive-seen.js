#!/usr/bin/env node
// TCG 원장 표본일(seen) 보정 파일 — 2026-10-14. data/tcg-archive-seen.json 을 git 이력에서 다시 굽는다(결정적·재실행 가능).
//
// 왜: 감시 표본은 스냅샷 순간 "종료 임박 순"으로 고른다. 그래서 그 표본을 고른 날(seen)이 원장 날짜(종료일)와 다르다 —
// 작은 게임은 표본이 하루 넘게 걸쳐 다음 날 원장으로 넘어간다. 원장 행에 seen 이 적히기 시작한 건 2026-10-14 부터라
// 그 전 행을 보는 쪽(generate-tcg-auction-page 의 다른 시각 표본일 제외, build-tcg-series 의 표본일 회수)은 종료일로 대신했고,
// 10/14 감사에서 다른 시각 표본 6,234행이 비교값에 섞이고 표준 표본 1,874행이 빠진 것이 드러났다.
// 원장(data/tcg-archive)은 append-only 라 고치지 않는다. 대신 감시 목록(data/tcg-watch.json)의 git 이력 — 모든 항목에
// seen 이 있다 — 에서 id 마다 처음 나타난 seen 을 복원해, **원장 날짜와 다른 행만** 이 파일에 담는다.
//
// 담는 것
//   seen:     { 표본일: [id, ...] } — 원장 행에 seen 이 없고, 복원한 표본일이 원장 날짜(종료일)와 다른 표본(base) 행만.
//             여기 없는 표본 행의 표본일은 원장 날짜다.
//   promoted: { 표본일: [id, ...] } — 그날 스냅샷 표본 안에 들었는데 이미 여유분(extra)으로 감시 중이라 여유분으로 남은 행
//             (2026-10-14 QA). 스냅샷은 감시 목록에 이미 있는 id 를 건너뛰었다 — 그래서 표본의 앞부분(가장 먼저 끝나는 쪽)이
//             여유분으로 빠졌다(10/12 unionarena 79건, digimon 58건). 2026-10-15 부터는 스냅샷이 감시 목록에서 직접 표본으로
//             바꾼다(collect-tcg-snapshot). 원장 행은 extra:true 그대로 두고, 읽는 쪽이 이 목록으로 표본에 넣는다.
//             판정: 스냅샷 직전 커밋 상태의 같은 게임 여유분 중 종료가 (스냅샷 시각, 그날 새로 넣은 표본의 마지막 종료] 안인 것.
//             표본은 종료 임박 순으로 끊김 없이 고르므로 이 구간 안의 매물은 표본에 들었다. 마지막 새 표본보다 뒤에 끝나는
//             여유분은 표본 끝에 들었는지 알 수 없어 넣지 않는다(하한).
//   sampled:  { 표본일: { 게임: 그날 표본 수 } } — 표본일 기준 회수율(audit-series-gaps)의 분모. = 그날 표본으로 감시에 새로 넣은 수
//             + promoted + 원장에만 있는 그날 표본 행(아래). 스냅샷 점에 games[].watched 가 적힌 날(2026-10-15~)은 그쪽을 쓰고 뺀다.
// 같은 실행 안에서 감시에 들어갔다가 바로 정산된 표본(종료 직전에 뽑힌 몇 건)은 커밋된 감시 상태에 없다 — 그 행은 원장 날짜를
// 표본일로 두고, 분모(sampled)에도 더한다(2026-10-14 QA: 분자에만 들어가 회수율이 부풀었다 — 9/13 pokemon 120/116).
//
// Run: node tools/build-tcg-archive-seen.js [--check]   (--check: 쓰지 않고 지금 파일과 같은지만 본다)
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_REL = "data/tcg-archive-seen.json";
const WATCH_REL = "data/tcg-watch.json";
const ARCHIVE = path.join(ROOT, "data", "tcg-archive");
const SNAP = path.join(ROOT, "data", "tcg-snapshot.json");
const CHUNK = 40;   // cat-file 한 번에 읽을 blob 수 — 감시 파일 하나가 수백 KB 라 한꺼번에 받으면 메모리가 크다

/**
 * data/tcg-archive-seen.json → { seenOf: Map(id → 표본일), promotedOf: Map(id → 표본일), sampled }.
 * 파일이 없으면 던진다 — 2026-10-14 QA: 조용히 빈 값을 돌려주면 다른 시각 표본 6,507행이 오류 없이 다시 섞인다
 * (card-series-store 와 같은 처리). 이 파일은 data/ 에 커밋돼 있어야 한다.
 */
function readSeenFix(root = ROOT) {
  const file = path.join(root, OUT_REL);
  if (!fs.existsSync(file)) throw new Error(`${OUT_REL} 이 없다 — node tools/build-tcg-archive-seen.js 로 굽고 커밋할 것`);
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const seenOf = new Map();
  for (const [day, ids] of Object.entries(j.seen || {})) for (const id of ids) seenOf.set(id, day);
  const promotedOf = new Map();
  for (const [day, ids] of Object.entries(j.promoted || {})) for (const id of ids) promotedOf.set(id, day);
  return { seenOf, promotedOf, sampled: j.sampled || {} };
}

/**
 * 원장 행 하나의 표본 판정 — 읽는 쪽(build-tcg-series·generate-tcg-auction-page)이 같은 규칙을 쓴다.
 * → { base: 표본이면 true(여유분이면 false), seen: 표본일 }
 *   표본일 = 승격 목록 → 행의 seen(표본 행만 — 여유분 행의 seen 은 여유분을 넣은 날) → 보정 seen → 원장 날짜.
 */
function sampleOf(row, ledgerDay, fix) {
  const promoted = fix.promotedOf.get(row.id);
  if (promoted) return { base: true, seen: promoted };
  if (row.extra) return { base: false, seen: typeof row.seen === "string" ? row.seen : ledgerDay };
  return { base: true, seen: typeof row.seen === "string" ? row.seen : fix.seenOf.get(row.id) || ledgerDay };
}

/** git 이력의 감시 목록 상태를 차례로 읽어 id 마다 처음 나타난 { g, seen, extra } 와 표본 승격(promoted) 후보를 모은다. */
function watchHistory(atOf, recorded) {
  const raw = execFileSync("git", ["log", "--reverse", "--format=C %H", "--raw", "--no-abbrev", "--", WATCH_REL], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const blobs = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith(":")) continue;
    const blob = line.split(/\s+/)[3];
    if (blob && !/^0+$/.test(blob)) blobs.push(blob);
  }
  const first = new Map();
  const promoted = new Map();   // id → { d, g }
  let prevExtras = [];          // 직전 상태의 여유분 { id, g, end(ms) }
  for (let i = 0; i < blobs.length; i += CHUNK) {
    const r = spawnSync("git", ["cat-file", "--batch"], { cwd: ROOT, input: blobs.slice(i, i + CHUNK).join("\n") + "\n", maxBuffer: 2 * 1024 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`git cat-file 실패: ${String(r.stderr || "").slice(0, 200)}`);
    const buf = r.stdout;
    let pos = 0;
    while (pos < buf.length) {
      const nl = buf.indexOf(10, pos);
      if (nl < 0) break;
      const size = Number(buf.slice(pos, nl).toString().split(" ")[2]);
      const body = buf.slice(nl + 1, nl + 1 + size).toString("utf8");
      pos = nl + 1 + size + 1;
      let j;
      try { j = JSON.parse(body); } catch { continue; }   // 깨진 중간 상태는 건너뛴다(다른 커밋에 같은 항목이 있다)
      const pending = (j.pending || []).filter((p) => p && p.id);

      // 이 상태에서 처음 나타난 표본(base) — 스냅샷이 그날 새로 넣은 것. 표본일·게임별 마지막 종료 시각.
      const freshEnd = new Map();   // `${d}|${g}` → max end(ms)
      for (const p of pending) {
        if (first.has(p.id) || p.extra || typeof p.seen !== "string") continue;
        const t = Date.parse(p.end);
        if (!Number.isFinite(t)) continue;
        const k = `${p.seen}|${p.g}`;
        if (!(freshEnd.get(k) >= t)) freshEnd.set(k, t);
      }
      // 직전 상태의 같은 게임 여유분 중 (스냅샷 시각, 마지막 새 표본 종료] 에 끝나는 것 → 그날 표본에 들었다.
      for (const [k, maxEnd] of freshEnd) {
        const [d, g] = k.split("|");
        const at = atOf.get(d);
        if (!Number.isFinite(at) || recorded.has(d)) continue;
        for (const x of prevExtras) {
          if (x.g !== g || promoted.has(x.id)) continue;
          if (x.end > at && x.end <= maxEnd) promoted.set(x.id, { d, g });
        }
      }

      for (const p of pending) {
        const seenNow = typeof p.seen === "string" ? p.seen : null;
        const had = first.get(p.id);
        // seen 이 없던 시절(2026-08-14 전) 항목은 나중 상태에 seen 이 붙어 있으면 그것을 쓴다.
        if (!had) first.set(p.id, { g: p.g, seen: seenNow, extra: !!p.extra });
        else if (!had.seen && seenNow) had.seen = seenNow;
      }
      prevExtras = pending.filter((p) => p.extra).map((p) => ({ id: p.id, g: p.g, end: Date.parse(p.end) })).filter((x) => Number.isFinite(x.end));
    }
  }
  return { first, promoted, blobs: blobs.length };
}

function build() {
  const snap = fs.existsSync(SNAP) ? JSON.parse(fs.readFileSync(SNAP, "utf8")) : { points: [] };
  const atOf = new Map((snap.points || []).filter((p) => p && p.d && p.at).map((p) => [p.d, Date.parse(p.at)]));
  // 스냅샷 점이 watched 를 직접 적은 날(2026-10-15~) — 그날은 스냅샷이 감시 목록에서 직접 승격하고 분모도 적는다.
  const recorded = new Set((snap.points || []).filter((p) => (p.games || []).some((g) => Number.isFinite(g?.watched))).map((p) => p.d));
  const { first, promoted, blobs } = watchHistory(atOf, recorded);

  // 표본일별 분모 ① 감시에 새로 넣은 표본 ② 승격 — 스냅샷 점이 watched 를 직접 적은 날은 뺀다.
  const sampled = {};
  const bump = (d, g) => { const day = (sampled[d] = sampled[d] || {}); day[g] = (day[g] || 0) + 1; };
  for (const x of first.values()) {
    if (x.extra || !x.seen || recorded.has(x.seen)) continue;
    bump(x.seen, x.g);
  }
  for (const { d, g } of promoted.values()) bump(d, g);
  const historyDays = new Set(Object.keys(sampled));

  // 원장 날짜와 표본일이 다른 표본 행 · 원장에만 있는 표본 행(분모 ③)
  const seen = {};
  let rows = 0, noSeen = 0, restored = 0, ledgerOnly = 0;
  for (const f of fs.readdirSync(ARCHIVE).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()) {
    const d = f.slice(0, 10);
    for (const r of JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), "utf8")).sales || []) {
      if (!r || !r.id || r.extra) continue;
      rows += 1;
      if (!first.has(r.id)) {
        // 커밋된 감시 상태에 한 번도 없던 표본 행 — 같은 실행에서 넣고 바로 읽은 것. 표본일 = 행의 seen, 없으면 원장 날짜.
        // 분자(정산된 표본)에 들어가므로 분모에도 더한다.
        const sd = typeof r.seen === "string" ? r.seen : d;
        if (historyDays.has(sd) && !recorded.has(sd)) { bump(sd, r.g); ledgerOnly += 1; }
        continue;
      }
      if (typeof r.seen === "string") continue;
      noSeen += 1;
      const s = first.get(r.id).seen;
      if (!s) continue;
      restored += 1;
      // 표본일은 종료일보다 늦을 수 없다(진행 중인 매물만 고른다). 어긋난 복원(이력상 3건)은 믿지 않고 원장 날짜로 둔다.
      if (s === d || s > d) continue;
      (seen[s] = seen[s] || []).push(r.id);
    }
  }
  const promotedByDay = {};
  for (const [id, { d }] of promoted) (promotedByDay[d] = promotedByDay[d] || []).push(id);
  const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  for (const k of Object.keys(seen)) seen[k].sort();
  for (const k of Object.keys(promotedByDay)) promotedByDay[k].sort();
  for (const k of Object.keys(sampled)) sampled[k] = sortKeys(sampled[k]);

  const out = {
    note: "Sample day (seen) for settled rows in data/tcg-archive written before ledger rows carried their own seen (2026-10-14). Each day's settled sample is the auctions ending soonest when that day's snapshot was taken, so some of them close -- and land in the ledger -- one or more days later. The ledger is keyed by end date and never rewritten, so this side file restores, from the git history of data/tcg-watch.json (every watch entry there has seen), the day each sample listing was picked, listed only where that day differs from the ledger date; any other sample row's sample day is its ledger date. promoted lists rows the ledger marks extra (leftover-quota reads) that were inside that day's sample: they were already on the watch list when the snapshot picked them, so they stayed extra -- the earliest-ending part of the sample. A row is listed when its game matches and it closed after the snapshot time and no later than the last listing that day's sample newly put on the watch list; extras closing after that are not listed, so this is a lower bound. From 2026-10-15 the snapshot switches such listings to the sample itself. sampled is how many listings were in each day's sample, per game -- newly watched, promoted, and sample rows read back in the same run that picked them -- the denominator for how many of a day's sample were read back; later days carry it in tcg-snapshot games[].watched. Rebuild with node tools/build-tcg-archive-seen.js. Terms of use: https://opboxindex.com/free-data.html#terms",
    seen: sortKeys(seen),
    promoted: sortKeys(promotedByDay),
    sampled: sortKeys(sampled),
  };
  return { out, stats: { blobs, watchIds: first.size, baseRows: rows, baseRowsWithoutSeen: noSeen, restored, listed: Object.values(seen).reduce((a, l) => a + l.length, 0), promoted: promoted.size, ledgerOnly, sampledDays: Object.keys(sampled).length } };
}

function main() {
  const { out, stats } = build();
  const text = `${JSON.stringify(out)}\n`;
  const file = path.join(ROOT, OUT_REL);
  if (process.argv.includes("--check")) {
    const same = fs.existsSync(file) && fs.readFileSync(file, "utf8") === text;
    console.log(JSON.stringify({ check: same ? "SAME" : "DIFFERENT", ...stats }));
    if (!same) process.exitCode = 1;
    return;
  }
  fs.writeFileSync(file, text, "utf8");
  console.log(JSON.stringify({ status: "ok", file: OUT_REL, bytes: Buffer.byteLength(text), ...stats }));
}

if (require.main === module) main();

module.exports = { readSeenFix, sampleOf };
