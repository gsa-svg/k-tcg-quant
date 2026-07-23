// top10 카드 이미지를 일본판(반다이 공식 JP)으로 교체 — 변형(파라렐/슈퍼/레드망가 등)을 그림매칭으로 정확히 배정.
//
// 방법(2026-07-23 검증): 반다이는 변형별 텍스트 라벨이 없어 그림으로만 구분됨. 그런데 EN↔JP 는 같은 접미사(_pN).
//  → 우리 현재 영문이미지 ↔ 반다이 영문변형(en.onepiece-cardgame.com/{code}{suffix}.png) 을 whole-card dHash 로 매칭해
//    접미사를 확정하고, 같은 접미사의 일본판(www.onepiece-cardgame.com/...) URL 로 바꾼다. 영문끼리라 매칭이 확실.
//  안전장치: 최저거리 < MAXD 이고 2등과 격차 ≥ MINGAP 일 때만 교체(확신 없으면 영문 유지 + 수동플래그).
//
// Run: node tools/jp-card-images.js [OP-13 ...]  (코드 생략 시 전 세트)
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const jpeg = require("jpeg-js");

const ROOT = path.join(__dirname, "..");
const dataPath = path.join(ROOT, "data", "onepiece-packs.json");
const EN = "https://en.onepiece-cardgame.com/images/cardlist/card/";
const JP = "https://www.onepiece-cardgame.com/images/cardlist/card/";
const SUFFIXES = ["", "_p1", "_p2", "_p3", "_p4", "_p5", "_p6"];
const MAXD = 95;     // 최저 해밍거리 상한
const MINGAP = 12;   // 1등-2등 격차 하한(확신)

async function fetchBuf(url) {
  try { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } }); return r.ok ? Buffer.from(await r.arrayBuffer()) : null; } catch { return null; }
}
function decode(buf, url) {
  if (/\.png(\?|$)/i.test(url) || buf[0] === 0x89) { const p = PNG.sync.read(buf); return { w: p.width, h: p.height, data: p.data }; }
  const j = jpeg.decode(buf, { useTArray: true }); return { w: j.width, h: j.height, data: j.data };
}
function hash(img, gw = 16, gh = 16) {
  const x0 = img.w * 0.05, x1 = img.w * 0.95, y0 = img.h * 0.05, y1 = img.h * 0.95, cols = gw + 1, g = [];
  for (let r = 0; r < gh; r++) for (let c = 0; c < cols; c++) {
    const px = Math.floor(x0 + (x1 - x0) * (c + 0.5) / cols), py = Math.floor(y0 + (y1 - y0) * (r + 0.5) / gh), i = (py * img.w + px) * 4;
    g.push((img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3);
  }
  let b = ""; for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) b += g[r * cols + c] > g[r * cols + c + 1] ? "1" : "0";
  return b;
}
const ham = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };

async function main() {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const only = process.argv.slice(2);
  const codes = (only.length ? only : [...data.jp.list, ...data.extra.list]).filter((c) => data.sets[c]?.cards?.length);
  let changed = 0; const flags = [];

  for (const code of codes) {
    for (const card of data.sets[code].cards) {
      const num = (card.number || "").replace(/^#/, "").toUpperCase();
      const cur = card.image || card.img || "";
      if (!num || !cur || /onepiece-cardgame\.com/.test(cur)) continue;   // 이미 일본판이면 스킵
      const refBuf = await fetchBuf(cur);
      if (!refBuf) { flags.push(`${num} 현재이미지 로드실패`); continue; }
      let refHash; try { refHash = hash(decode(refBuf, cur)); } catch { flags.push(`${num} 디코드실패`); continue; }
      // EN 반다이 후보 수집
      const cands = [];
      for (const s of SUFFIXES) {
        const b = await fetchBuf(EN + num + s + ".png");
        if (!b) continue;
        try { cands.push({ s, d: ham(refHash, hash(decode(b, ".png"))) }); } catch {}
      }
      if (!cands.length) { flags.push(`${num} 반다이EN 없음(일본전용?)`); continue; }
      cands.sort((a, b) => a.d - b.d);
      const best = cands[0], gap = cands[1] ? cands[1].d - best.d : 999;
      if (best.d > MAXD || (cands.length > 1 && gap < MINGAP)) { flags.push(`${num} 확신부족(d=${best.d} gap=${gap})`); continue; }
      const jpUrl = JP + num + best.s + ".png";
      const jb = await fetchBuf(jpUrl);
      if (!jb) { flags.push(`${num} 일본판 이미지 없음(${best.s})`); continue; }
      card.imageEn = cur;                 // 영문 원본 보존
      card.image = jpUrl;                 // 표시용을 일본판으로
      card._imgSuffix = best.s || "base";
      changed++;
    }
    process.stdout.write(`${code} done\n`);
  }

  data.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(dataPath, `${JSON.stringify(data)}\n`, "utf8");
  console.log(JSON.stringify({ changed, flagged: flags.length }));
  if (flags.length) console.log("수동플래그:\n  " + flags.join("\n  "));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
