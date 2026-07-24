// 일본판 카드 이미지 자체호스팅 — 반다이 핫링크 의존 제거 + webp 압축(성능 최적화).
//
// 왜: jp-card-images.js 가 card.image 를 반다이 원본 PNG(장당 ~240KB)로 바꿨는데,
//  (1) 외부 핫링크는 반다이가 막으면 한 번에 전부 깨지고 (2) PNG 는 표시크기(~300px) 대비 과체중.
//  → 원본을 받아 폭 480px webp(q80, ~20KB)로 압축해 /img/jp/ 에 저장하고 card.image 를 자기 경로로 교체.
//  원본 반다이 URL 은 imageJpSrc 에 보존(재압축·검증용). 실패한 건 기존 URL 유지(안전).
// Run: node tools/selfhost-jp-images.js
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const dataPath = path.join(ROOT, "data", "onepiece-packs.json");
const outDir = path.join(ROOT, "img", "jp");
fs.mkdirSync(outDir, { recursive: true });

async function fetchBuf(url) {
  try { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } }); return r.ok ? Buffer.from(await r.arrayBuffer()) : null; } catch { return null; }
}

(async () => {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  let converted = 0, kept = 0, failed = 0;
  for (const [code, s] of Object.entries(data.sets)) {
    for (const card of s.cards || []) {
      const img = card.image || "";
      if (!/onepiece-cardgame\.com\/images\/cardlist\/card\//.test(img)) { kept++; continue; }
      const name = img.split("/").pop().replace(/\.png.*$/i, "");   // 예: OP13-118_p3
      const rel = `img/jp/${name}.webp`;
      const abs = path.join(ROOT, "img", "jp", `${name}.webp`);
      if (!fs.existsSync(abs)) {
        const buf = await fetchBuf(img);
        if (!buf) { failed++; continue; }
        try {
          await sharp(buf).resize({ width: 480 }).webp({ quality: 80 }).toFile(abs);
        } catch (e) { failed++; continue; }
      }
      card.imageJpSrc = img;                                  // 반다이 원본 보존
      card.image = `https://opboxindex.com/${rel}`;           // 자체호스팅(I1 정책 준수)
      converted++;
    }
  }
  fs.writeFileSync(dataPath, JSON.stringify(data) + "\n", "utf8");
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".webp"));
  const totalKB = Math.round(files.reduce((a, f) => a + fs.statSync(path.join(outDir, f)).size, 0) / 1024);
  console.log(JSON.stringify({ converted, kept, failed, webpFiles: files.length, totalKB }));
  // 실패가 있으면 실패 종료(자동화에서 감지되게). 실패 카드는 원본 URL 유지라 재실행 안전.
  if (failed > 0) process.exitCode = 1;
})();
