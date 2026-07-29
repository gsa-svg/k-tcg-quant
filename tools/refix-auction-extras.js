// 이미 아카이브에 들어간 기록의 부가 필드를 현재 규칙으로 다시 계산한다.
// 왜 필요: 2026-07-29 첫 적재분 6건이 (a) 판별 불일치를 aspects 쪽으로 단정하고
// (b) CGC 수식어(Pristine/Gem Mint)를 뭉갠 상태로 들어갔다. 규칙만 고치면 과거 기록은 그대로 틀려 있다.
//
// 관측값(가격·입찰수·낙찰여부·종료시각)은 절대 건드리지 않는다. 제목에서 다시 뽑을 수 있는
// 파생 필드만 재계산한다. 제목이 없는 옛 기록은 손대지 않는다(재계산 근거가 없으므로).
// Run: node tools/refix-auction-extras.js [--write]
const fs = require("fs");
const { listDays, dayPath, readDay } = require("./auction-archive");
const { extraFields } = require("./auction-fields");

const WRITE = process.argv.includes("--write");
const DERIVED = ["grade", "gradeSrc", "ed", "edSrc", "edConflict", "aspectCardId", "cardIdConflict"];

let changed = 0, scanned = 0;
const samples = [];

for (const d of listDays()) {
  const sales = readDay(d);
  let touched = false;
  for (const s of sales) {
    if (!s.title) continue;                    // 제목 없는 옛 기록은 재계산 근거가 없다
    scanned++;
    // aspects 는 다시 조회할 수 없다(경매는 사라진다). 제목에서 나오는 것만 다시 계산한다.
    const fresh = extraFields({ title: s.title, localizedAspects: [] });
    const before = {}, after = {};
    for (const k of DERIVED) {
      if (k in s) before[k] = s[k];
      if (k in fresh) after[k] = fresh[k];
    }
    // 제목만으로 판이 안 나오는데 기존 값이 aspects 에서 온 것이면 그대로 둔다(정보 손실 방지).
    if (!("ed" in fresh) && s.edSrc && s.edSrc !== "title") { delete before.ed; delete before.edSrc; }
    if (!("aspectCardId" in fresh) && s.aspectCardId) { delete before.aspectCardId; }
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (samples.length < 6) samples.push({ id: s.id, title: s.title.slice(0, 60), before, after });
    for (const k of DERIVED) { if (k in before) delete s[k]; }
    Object.assign(s, after);
    changed++; touched = true;
  }
  if (touched && WRITE) {
    const j = JSON.parse(fs.readFileSync(dayPath(d), "utf8"));
    j.sales = sales;
    fs.writeFileSync(dayPath(d), JSON.stringify(j) + "\n", "utf8");
  }
}

console.log(JSON.stringify({ mode: WRITE ? "write" : "dry-run", scanned, changed, samples }, null, 1));
