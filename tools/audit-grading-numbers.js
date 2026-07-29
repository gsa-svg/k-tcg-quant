// 등급 표시 숫자 전수 검사 — 화면에 나가는 등급 숫자가 원본과 어긋나는지 본다.
//
// 왜: 등급 데이터는 이 사이트에서 가장 "우리만 가진" 부분이고, 소유자가 틀리면 안 된다고 못박았다.
// 여기서 보는 것은 계산 정합성이다(원본 수집이 맞았는지는 수집 도구가 따로 검증한다).
//
// 검사 항목
//   G1 젬률 = PSA10 ÷ 총량 (반올림 오차 0.1%p 이내)
//   G2 주간 증감(wowAdd/wowPct)이 판별 원장의 마지막 두 점과 일치
//   G3 CGC 최상위 등급 합(Pristine 10 + Gem Mint 10 + Perfect 10)이 총량을 넘지 않음
//   G4 TAG 10 + 10P 가 총량을 넘지 않음
//   G5 등급 수가 총량보다 큰 항목이 없음
//   G6 판별 총량이 서로 같은 값으로 복사돼 있지 않음(일판·영판 혼입 흔적)
//   G7 화면에 나가는 등급사 증감(add/from/to)이 그 판의 실제 마지막 두 관측과 일치
//      — 2026-07-29 실사고: from/to 를 판별 공용으로 두는 바람에 영문판 날짜가 일본판 라벨을
//        덮어써, 5일치 증가(+86)가 하루치 증가처럼 표기됐다.
// Run: node tools/audit-grading-numbers.js
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const rd = (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", p), "utf8")); } catch { return null; } };
const pk = rd("onepiece-packs.json");
const led = rd("psa-edition-weekly.json");
const cgc = rd("cgc-grading-history.json");
const tag = rd("tag-grading-history.json");

const errors = [];
const warn = [];
const codes = [...(pk.jp?.list || []), ...(pk.extra?.list || [])];

for (const code of codes) {
  const s = pk.sets[code] || {};

  // ── G1. 젬률 = PSA10 ÷ 총량
  for (const [ed, f] of [["jp", s.psaFull], ["en", s.psaFullEn]]) {
    if (!f || !f.total) continue;
    const g = f.gem10 ?? f.gems;
    if (g == null) { warn.push(`${code}.${ed}: PSA10 수가 없다(젬률만 있음)`); continue; }
    if (g > f.total) errors.push(`G5 ${code}.${ed}: PSA10(${g}) > 총량(${f.total})`);
    const calc = Math.round((g / f.total) * 1000) / 10;
    if (f.gemRate != null && Math.abs(calc - f.gemRate) > 0.1) {
      errors.push(`G1 ${code}.${ed}: 젬률 표시 ${f.gemRate}% ≠ 계산 ${calc}% (${g}/${f.total})`);
    }
  }

  // ── G6. 일판·영판이 같은 숫자면 한쪽을 잘못 복사했을 가능성이 크다
  if (s.psaFull && s.psaFullEn && s.psaFull.total === s.psaFullEn.total) {
    errors.push(`G6 ${code}: 일판·영판 PSA 총량이 동일(${s.psaFull.total}) — 복사 의심`);
  }

  // ── G2. 주간 증감이 원장과 일치하는가
  const wk = (led.weeks || []).slice(-2);
  const rec = (led.sets || {})[code] || {};
  for (const [ed, f] of [["jp", s.psaFull], ["en", s.psaFullEn]]) {
    if (!f || f.wowAdd == null) continue;
    const arr = rec[ed] || [];
    const a = arr.find((p) => p.d === wk[0]), b = arr.find((p) => p.d === wk[1]);
    if (!a || !b) { errors.push(`G2 ${code}.${ed}: wowAdd(${f.wowAdd}) 가 있는데 원장에 두 점이 없다`); continue; }
    const add = b.g - a.g;
    if (add !== f.wowAdd) errors.push(`G2 ${code}.${ed}: 주간 증감 표시 ${f.wowAdd} ≠ 원장 ${add} (${wk[0]}→${wk[1]})`);
    const pct = Math.round((add / a.g) * 1000) / 10;
    if (f.wowPct != null && Math.abs(pct - f.wowPct) > 0.15) {
      errors.push(`G2 ${code}.${ed}: 주간 증감률 표시 ${f.wowPct}% ≠ 계산 ${pct}%`);
    }
    // 누적은 줄어들 수 없다 — 줄면 수집이 다른 세트를 읽은 것이다(과거 실사고).
    if (add < 0) errors.push(`G2 ${code}.${ed}: 누적 등급 수가 감소(${a.g}→${b.g}) — 수집 오염 의심`);
    // 원장 최신값과 화면 총량이 크게 다르면 둘 중 하나가 낡았다.
    if (Math.abs(b.g - f.total) > Math.max(50, f.total * 0.02)) {
      warn.push(`${code}.${ed}: 화면 총량 ${f.total} vs 원장 최신 ${b.g} (${wk[1]}) 차이 큼`);
    }
  }

  // ── G3/G4. 등급사별 최상위 등급 합이 총량을 넘지 않아야 한다
  for (const [name, src, keys] of [["CGC", cgc, ["Pristine 10", "Gem Mint 10", "Perfect 10"]], ["TAG", tag, null]]) {
    for (const ed of ["jp", "en"]) {
      const arr = src && src.sets && src.sets[code] && src.sets[code][ed];
      if (!Array.isArray(arr) || !arr.length) continue;
      const last = arr[arr.length - 1];
      if (!last.total) continue;
      if (keys) {
        const g = last.grades || {};
        const top = keys.reduce((t, k) => t + (g[k] || 0), 0);
        if (top > last.total) errors.push(`G3 ${code}.${ed}: CGC 최상위 합(${top}) > 총량(${last.total})`);
        const all = Object.values(g).reduce((t, v) => t + (v || 0), 0);
        if (all > last.total) errors.push(`G3 ${code}.${ed}: CGC 등급 합(${all}) > 총량(${last.total})`);
      } else {
        const t10 = (last.g10 || 0) + (last.g10p || 0);
        if (t10 > last.total) errors.push(`G4 ${code}.${ed}: TAG 10+10P(${t10}) > 총량(${last.total})`);
        if (last.gem != null && last.g10 != null && last.g10 > last.gem) {
          warn.push(`${code}.${ed}: TAG 10(${last.g10}) > gem(${last.gem}) — 정의 확인 필요`);
        }
      }
      // 누적 역행. 등급사 공개 집계는 재등급·정정으로 한두 장 줄어들 수 있다 —
      // 그건 관측 사실이라 경고로 남기고 화면에는 증감을 띄우지 않는다(주입기가 음수를 안 만든다).
      // 크게 줄면 얘기가 다르다. 다른 세트를 읽어온 것이고(과거 실사고) 그건 반드시 막아야 한다.
      for (let i = 1; i < arr.length; i++) {
        const a = arr[i - 1], b = arr[i];
        if (a.total == null || b.total == null || b.total >= a.total) continue;
        const drop = a.total - b.total;
        const msg = `${name} ${code}.${ed}: 누적 총량 감소 (${a.d} ${a.total} → ${b.d} ${b.total})`;
        if (drop > 5 && drop > a.total * 0.005) errors.push(`${msg} — 다른 세트 오독 의심`);
        else warn.push(`${msg} — 재등급/정정으로 보임, 증감 미표시`);
        break;
      }
    }
  }
}

// ── G7. 화면용 등급사 블록(set.graders)이 원본 시계열과 맞는가
for (const code of codes) {
  const g = (pk.sets[code] || {}).graders;
  if (!g) continue;
  for (const [key, src] of [["cgc", cgc], ["tag", tag]]) {
    const blk = g[key];
    if (!blk) continue;
    if (blk.from || blk.to) errors.push(`G7 ${code}.${key}: 증감 구간이 판별 공용으로 저장됨 — 판마다 따로 두어야 한다`);
    for (const ed of ["jp", "en"]) {
      const e = blk[ed];
      if (!e) continue;
      const arr = ((src.sets || {})[code] || {})[ed];
      if (!Array.isArray(arr) || !arr.length) { errors.push(`G7 ${code}.${key}.${ed}: 화면 값이 있는데 원본 시계열이 없다`); continue; }
      const last = arr[arr.length - 1], prev = arr.length > 1 ? arr[arr.length - 2] : null;
      if (e.total !== last.total) errors.push(`G7 ${code}.${key}.${ed}: 총량 표시 ${e.total} ≠ 최신 관측 ${last.total} (${last.d})`);
      if (e.add == null) continue;
      if (!prev) { errors.push(`G7 ${code}.${key}.${ed}: 증감이 있는데 이전 관측이 없다`); continue; }
      if (e.add !== last.total - prev.total) errors.push(`G7 ${code}.${key}.${ed}: 증감 ${e.add} ≠ ${last.total - prev.total}`);
      if (e.from !== prev.d || e.to !== last.d) {
        errors.push(`G7 ${code}.${key}.${ed}: 증감 구간 표시 ${e.from}→${e.to} ≠ 실제 ${prev.d}→${last.d}`);
      }
    }
  }
}

const out = { audit: errors.length ? "GRADING_FAIL" : "GRADING_OK", sets: codes.length, errors, warnings: warn };
console.log(JSON.stringify(out, null, 1));
if (errors.length) process.exit(1);
