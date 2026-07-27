// 일본판 이미지 시각 대조용 자료 준비 — 해시 매칭이 소스간(TCGplayer↔반다이) 프레임 차이로 불안정해
// (2026-07-27 OP-01 오매칭 사고), 사람이/에이전트가 눈으로 보고 고르도록 로컬에 자료를 깐다.
//  - 기준(ref): 우리 원래 영문 이미지(imageEn, 맞는 그림) → tmp-visual/ref/<SET>__<i>__<num>.jpg
//  - 후보(cand): 반다이 JP 각 접미사 원본 → tmp-visual/cand/<num><suffix>.png (번호별 1회)
//  - manifest.json: 카드별 ref/후보 경로 + 현재 선택 접미사
// Run: node tools/visual-match-manifest.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "tmp-visual");
const JP = "https://www.onepiece-cardgame.com/images/cardlist/card/";
const SUFS = ["", "_p1", "_p2", "_p3", "_p4", "_p5", "_p6", "_p7"];

async function get(url) {
  try { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } }); return r.ok ? Buffer.from(await r.arrayBuffer()) : null; } catch { return null; }
}

(async () => {
  fs.mkdirSync(path.join(OUT, "ref"), { recursive: true });
  fs.mkdirSync(path.join(OUT, "cand"), { recursive: true });
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
  const manifest = [];
  const candCache = new Map();
  const jobs = [];
  for (const [code, s] of Object.entries(data.sets)) {
    (s.cards || []).forEach((c, i) => {
      if (!c.imageEn) return;   // 일본판 전환 안 된 카드는 대상 아님
      const num = (c.number || "").replace(/^#/, "").toUpperCase();
      if (!num) return;
      jobs.push({ code, i, num, c });
    });
  }
  let done = 0;
  const workers = Array.from({ length: 8 }, async () => {
    while (jobs.length) {
      const j = jobs.shift();
      const refFile = `ref/${j.code}__${j.i}__${j.num.replace(/[^A-Z0-9-]/g, "")}.jpg`;
      const refAbs = path.join(OUT, refFile);
      if (!fs.existsSync(refAbs)) {
        const b = await get(j.c.imageEn);
        if (b) fs.writeFileSync(refAbs, b);
      }
      let cands = candCache.get(j.num);
      if (!cands) {
        cands = [];
        for (const suf of SUFS) {
          const f = `cand/${j.num}${suf}.png`;
          const abs = path.join(OUT, f);
          if (fs.existsSync(abs)) { cands.push({ suf: suf || "base", file: f }); continue; }
          const b = await get(`${JP}${j.num}${suf}.png`);
          if (!b) { if (suf === "") continue; else break; }   // 접미사 연속 — 없으면 이후도 없음
          fs.writeFileSync(abs, b);
          cands.push({ suf: suf || "base", file: f });
        }
        candCache.set(j.num, cands);
      }
      const curSuf = (j.c.image || "").match(/(_p\d)\.webp/) ? j.c.image.match(/(_p\d)\.webp/)[1] : ((j.c.image || "").includes(".webp") ? "base" : null);
      manifest.push({ set: j.code, idx: j.i, num: j.num, name: (j.c.name || "").slice(0, 50), ref: fs.existsSync(refAbs) ? refFile : null, current: curSuf, candidates: cands });
      done++;
    }
  });
  await Promise.all(workers);
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
  const candFiles = fs.readdirSync(path.join(OUT, "cand")).length;
  console.log(JSON.stringify({ cards: manifest.length, refOk: manifest.filter(m => m.ref).length, candFiles }));
})();
