// 시각 판정(tmp-visual/results/*.json) → onepiece-packs.json 반영 + webp 재생성
// 2026-07-27 OP-01 오매칭 사고 후속: EN반다이↔JP반다이 접미사 순번이 달라 해시 매칭이 틀렸음.
// 판정 규칙:
//  - verdict가 접미사이고 match=="exact" → 그 JP 접미사 채택: cand PNG에서 webp 재생성(내용 보증),
//    card.image=img/jp/..., card.imageJpSrc=JP원본 URL, card._imgSuffix 갱신
//  - verdict=="revert" 또는 match!="exact" → 영문 복귀: card.image=card.imageEn, imageJpSrc/_imgSuffix 제거
//    (틀린 일판보다 맞는 영문이 낫다)
// 판정 원장은 data/jp-image-verdicts.json에 박제 → 가드가 재역행을 막는다.
// Run: node tools/apply-visual-verdicts.js
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const ROOT = path.join(__dirname, "..");
const RES_DIR = path.join(ROOT, "tmp-visual", "results");
const CAND_DIR = path.join(ROOT, "tmp-visual", "cand");
const IMG_DIR = path.join(ROOT, "img", "jp");
const JP = "https://www.onepiece-cardgame.com/images/cardlist/card/";

(async () => {
  const dataPath = path.join(ROOT, "data", "onepiece-packs.json");
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const verdicts = {};
  for (const f of fs.readdirSync(RES_DIR).filter(x => x.endsWith(".json"))) {
    const set = f.replace(/\.json$/, "").replace(/^RE-/, "");   // RE-*.json = 재검증분(top10 순서 변경 후)
    for (const v of JSON.parse(fs.readFileSync(path.join(RES_DIR, f), "utf8"))) verdicts[`${set}|${v.idx}|${v.num}`] = v;
  }
  let adopted = 0, reverted = 0, missing = 0, failed = 0;
  const usedWebp = new Set();
  const ledger = [];
  for (const [code, s] of Object.entries(data.sets)) {
    for (let i = 0; i < (s.cards || []).length; i++) {
      const c = s.cards[i];
      if (!c.imageEn) continue;
      const num = (c.number || "").replace(/^#/, "").toUpperCase();
      const v = verdicts[`${code}|${i}|${num}`];
      if (!v) { missing++; continue; }
      const exact = v.match === "exact" && v.verdict !== "revert";
      if (exact) {
        const suf = v.verdict === "base" ? "" : v.verdict;
        const cand = path.join(CAND_DIR, `${num}${suf}.png`);
        if (!fs.existsSync(cand)) { failed++; console.log("cand missing:", num + suf); continue; }
        const webpName = `${num}${suf}.webp`;
        try {
          await sharp(cand).resize({ width: 480 }).webp({ quality: 80 }).toFile(path.join(IMG_DIR, webpName));
        } catch (e) { failed++; console.log("sharp fail:", webpName, e.message); continue; }
        c.image = `img/jp/${webpName}`;
        c.imageJpSrc = `${JP}${num}${suf}.png`;
        c._imgSuffix = v.verdict;
        usedWebp.add(webpName);
        adopted++;
        ledger.push({ set: code, idx: i, num, verdict: v.verdict, note: v.note || "" });
      } else {
        c.image = c.imageEn;
        delete c.imageJpSrc;
        delete c._imgSuffix;
        reverted++;
        ledger.push({ set: code, idx: i, num, verdict: "revert", note: v.note || "" });
      }
    }
  }
  if (missing > 0 || failed > 0) {
    console.log(JSON.stringify({ error: "incomplete", missing, failed }));
    process.exit(1);   // 판정 누락/실패 시 아무것도 쓰지 않는다
  }
  // 미사용 webp 제거 (고아 파일이 남아 잘못 참조되는 것 방지)
  let purged = 0;
  for (const f of fs.readdirSync(IMG_DIR).filter(x => x.endsWith(".webp"))) {
    if (!usedWebp.has(f)) { fs.unlinkSync(path.join(IMG_DIR, f)); purged++; }
  }
  fs.writeFileSync(dataPath, `${JSON.stringify(data)}\n`, "utf8");
  ledger.sort((a, b) => a.set.localeCompare(b.set) || a.idx - b.idx);
  fs.writeFileSync(path.join(ROOT, "data", "jp-image-verdicts.json"),
    JSON.stringify({ verifiedAt: "2026-07-27", method: "visual per-card review vs imageEn", verdicts: ledger }, null, 1));
  console.log(JSON.stringify({ adopted, reverted, purged, total: adopted + reverted }));
})();
