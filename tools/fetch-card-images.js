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

// 후보: 상위 24장 + 공개된 카드 전부(card-map.json) — 생성기와 같은 집합
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
// 후보 = 공개된 카드 전부(cards/card-map.json) — 2026-09-07. 카드 페이지가 상위 24장에서 실판매 표본 있는 카드
// 전부(108장)로 늘면서, 상위 24장만 보던 이 도구가 새 카드의 외부 CDN 그림을 놓쳐 가드 I1 이 걸렸다.
// 받는 것은 "우리 도메인 그림(c.image)이 없어 외부 CDN(c.img)으로 떨어질 카드"뿐이다. 나머지는 c.image 를 그대로 쓴다.
let publishedKeys = {};
try { publishedKeys = JSON.parse(fs.readFileSync(path.join(ROOT, "cards", "card-map.json"), "utf8")); } catch { publishedKeys = {}; }
const byRank = [...seen.values()].sort((a, b) => b.card.nmJpy - a.card.nmJpy);
const cands = byRank.filter((x, i) => i < TOP_N || publishedKeys[x.card.number + "|" + norm(x.card.name)]);
const hasOwnImage = (c) => typeof c.image === "string" && (!/^https?:/.test(c.image) || c.image.startsWith("https://opboxindex.com/"));

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
    if (hasOwnImage(c)) { skipped++; continue; }   // 우리 도메인 그림이 있으면 생성기가 그걸 쓴다 — 받을 필요 없음
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
