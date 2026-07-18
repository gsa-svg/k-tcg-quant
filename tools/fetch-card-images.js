// 카드 이미지 셀프호스팅 — 외부 CDN 핫링크 → /img/cards/{slug}.jpg 로 내려받아 저장.
// 목적: (1) 구글 이미지검색 유입을 우리 도메인이 받음 (2) 외부 CDN이 끊겨도 페이지 안 깨짐.
// ⚠️ 변형(패러렐/망가/알터) 정확도 유지를 위해 "이미 변형 매칭된 기존 img URL"만 그대로 받는다.
//    카드번호로 공식 URL을 추측하면 기본 카드 그림이 와서 가격과 그림이 어긋남 — 금지.
// Run: node tools/fetch-card-images.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "img", "cards");
const TOP_N = 24;

const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);

// generate-card-pages.js 와 동일한 후보 선정 로직(같은 24장을 받아야 함)
const seen = new Map();
for (const [code, s] of Object.entries(d.sets || {})) {
  for (const c of s.cards || []) {
    if (c.nmJpy == null || !c.number) continue;
    const key = c.number + "|" + norm(c.name);
    const isHome = c.number.replace("-", "").toUpperCase().startsWith(code.replace("-", "").toUpperCase());
    const prev = seen.get(key);
    if (!prev || (isHome && !prev.isHome)) seen.set(key, { code, card: c, isHome });
  }
}
const cands = [...seen.values()].sort((a, b) => b.card.nmJpy - a.card.nmJpy).slice(0, TOP_N);

fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const map = {};
  let fetched = 0, skipped = 0, failed = 0;
  for (const { card: c } of cands) {
    const slug = slugify(c.number + "-" + c.name);
    if (!c.img) { skipped++; continue; }
    const ext = (c.img.match(/\.(jpg|jpeg|png|webp)(\?|$)/i) || [])[1] || "jpg";
    const file = `${slug}.${ext.toLowerCase()}`;
    const dest = path.join(OUT, file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 2000) { map[slug] = `img/cards/${file}`; skipped++; continue; }
    try {
      const r = await fetch(c.img, { headers: { "User-Agent": "Mozilla/5.0 (compatible; OPBoxIndex/1.0; +https://opboxindex.com/)" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000) throw new Error("too small " + buf.length);
      fs.writeFileSync(dest, buf);
      map[slug] = `img/cards/${file}`;
      fetched++;
    } catch (e) {
      failed++;
      console.error(`FAIL ${slug}: ${e.message}`);
    }
  }
  // 생성기가 참조할 로컬 경로 맵(없으면 원본 URL로 폴백)
  fs.writeFileSync(path.join(ROOT, "img", "cards", "map.json"), JSON.stringify(map, null, 1) + "\n", "utf8");
  console.log(JSON.stringify({ fetched, skipped, failed, mapped: Object.keys(map).length }));
})();
