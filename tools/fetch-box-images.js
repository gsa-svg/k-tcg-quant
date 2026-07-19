// 박스 이미지 공식화 — 반다이 일본 공식(onepiece-cardgame.com) 제품 이미지를 /card-img/box/{CODE}.webp 로 교체.
// 기존 이미지는 중고 마켓플레이스 촬영본이라 화질/신뢰도가 떨어짐. 우리 시세는 "일본판"이므로 반드시 JP 공식(영문판 아님).
// Run: node tools/fetch-box-images.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "card-img", "box");
const BASE = "https://www.onepiece-cardgame.com/renewal/images/products/boosters";

const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const codes = Object.keys(d.sets || {});
const officialSlug = (code) => code.toLowerCase().replace("-", ""); // OP-16 -> op16

fs.mkdirSync(OUT, { recursive: true });

(async () => {
  let fetched = 0, failed = 0, skipped = 0;
  const done = [];
  for (const code of codes) {
    const url = `${BASE}/${officialSlug(code)}/img_item01.webp`;
    const dest = path.join(OUT, `${code}.webp`);
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; OPBoxIndex/1.0; +https://opboxindex.com/)" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 3000) throw new Error("too small " + buf.length);
      // 기존 파일과 동일하면 스킵(야간 재실행 시 불필요한 커밋 방지)
      if (fs.existsSync(dest) && fs.readFileSync(dest).equals(buf)) { skipped++; done.push(code); continue; }
      fs.writeFileSync(dest, buf);
      fetched++; done.push(code);
      // 출처를 데이터에 기록(정확도/추적)
      if (d.sets[code]) d.sets[code].boxSource = "Bandai official (Japanese product image)";
    } catch (e) {
      failed++;
      console.error(`FAIL ${code}: ${e.message}`);
    }
  }
  if (fetched) fs.writeFileSync(path.join(ROOT, "data", "onepiece-packs.json"), JSON.stringify(d, null, 1) + "\n", "utf8");
  console.log(JSON.stringify({ fetched, skipped, failed, total: codes.length }));
})();
