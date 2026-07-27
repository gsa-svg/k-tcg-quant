#!/usr/bin/env node
// 판별 주간 증감을 세트 데이터에 주입 — 2026-07-27.
// 원장(psa-edition-weekly.json)의 마지막 두 점 차이를 psaFull/psaFullEn 에 얹는다.
// 화면은 이 값만 읽으므로 원장이 늘어도 방문자 페이로드는 세트당 몇 바이트만 늘어난다.
// 점이 두 개 미만인 판은 값을 만들지 않는다(추정 금지 → 화면에서 "-").
// Run: node tools/inject-psa-wow.js
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const dataPath = path.join(ROOT, "data", "onepiece-packs.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const led = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "psa-edition-weekly.json"), "utf8"));

const weeks = (led.weeks || []).slice(-2);
if (weeks.length < 2) { console.log(JSON.stringify({ status: "skip", reason: "주간 비교에 두 점 필요", weeks: led.weeks?.length || 0 })); process.exit(0); }
const [from, to] = weeks;

let jp = 0, en = 0;
for (const [code, set] of Object.entries(data.sets)) {
  const s = led.sets[code];
  if (!s) continue;
  const delta = (ed) => {
    const arr = s[ed] || [];
    const a = arr.find((p) => p.d === from), b = arr.find((p) => p.d === to);
    if (!a || !b || b.g < a.g) return null;   // 누적 역행은 값을 만들지 않는다
    return { wowAdd: b.g - a.g, wowPct: Math.round(((b.g - a.g) / a.g) * 1000) / 10 };
  };
  const dj = delta("jp"), de = delta("en");
  for (const [target, d, hit] of [[set.psaFull, dj, "jp"], [set.psaFullEn, de, "en"]]) {
    if (!target) continue;
    if (d) { target.wowAdd = d.wowAdd; target.wowPct = d.wowPct; if (hit === "jp") jp += 1; else en += 1; }
    else { delete target.wowAdd; delete target.wowPct; }
  }
  set.psaWow = { from, to };
}
fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
console.log(JSON.stringify({ status: "ok", from, to, jpSets: jp, enSets: en }));
