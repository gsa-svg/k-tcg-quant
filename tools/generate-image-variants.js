#!/usr/bin/env node
// 화면 크기에 맞는 이미지 파생본 — 2026-10-08. 라이트하우스 모바일 실측(홈 70·세트 83·카드 78)의 LCP 가 전부 이미지였다.
//   · 세트 페이지 머리 박스 사진: 670×670 webp(50KB)를 132px 칸에 그렸다 → card-img/box/hero/<CODE>.webp 264px(≈8KB)
//   · 카드 페이지 머리 카드 사진: img/jp 480×670 webp(평균 101KB)·img/cards jpg(≈200KB)를 200px 칸에 → */hero/ 400px
//   · 목록 썸네일(ko/cards 241장·psa10-ranking 100장·cards/ 115장): 같은 100KB 원본을 30~46px 칸에 그렸다 → img/jp/thumb/ 96px(≈3KB)
// 원본은 절대 바꾸지 않는다(파생본만 만든다). 결과가 같으면 다시 쓰지 않는다(커밋 잡음 방지). sharp 가 없으면(클라우드 워크플로 일부)
// 조용히 건너뛴다 — 파생본은 저장소에 커밋돼 있고, 생성기는 파일이 있을 때만 파생본을 쓴다.
// Run: node tools/generate-image-variants.js [--force]
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
let sharp = null;
try { sharp = require("sharp"); } catch { console.log(JSON.stringify({ status: "skip", why: "sharp 없음 — 기존 파생본 그대로" })); process.exit(0); }
const force = process.argv.includes("--force");

const JOBS = [
  { src: "card-img/box", match: /^(OP|EB|PRB)-\d{2}\.webp$/, out: "card-img/box/hero", width: 264, quality: 78 },
  // 박스 썸네일(220px)은 generate-box-thumbnails.js 가 같은 설정으로 만든다 — 여기선 목록(manifest)에만 올리고, 있으면 다시 만들지 않는다.
  { src: "card-img/box", match: /^(OP|EB|PRB)-\d{2}\.webp$/, out: "card-img/box/thumb", width: 220, quality: 75 },
  { src: "img/jp", match: /\.webp$/i, out: "img/jp/hero", width: 400, quality: 70 },
  { src: "img/jp", match: /\.webp$/i, out: "img/jp/thumb", width: 96, quality: 70 },
  { src: "img/cards", match: /\.(jpe?g|png|webp)$/i, out: "img/cards/hero", width: 400, quality: 70, ext: ".webp" },
  { src: "img/cards", match: /\.(jpe?g|png|webp)$/i, out: "img/cards/thumb", width: 96, quality: 70, ext: ".webp" },
];
// 파생본 목록(경로 → [너비, 높이]). 생성기들은 sharp 없이 이 목록만 보고 파생본 유무·크기를 안다(tools/image-variants.js).
const MANIFEST = path.join(ROOT, "data", "image-variants.json");

(async () => {
  const summary = {};
  const manifest = {};
  for (const job of JOBS) {
    const srcDir = path.join(ROOT, job.src);
    if (!fs.existsSync(srcDir)) continue;
    const outDir = path.join(ROOT, job.out);
    fs.mkdirSync(outDir, { recursive: true });
    let made = 0, kept = 0, bytes = 0;
    for (const f of fs.readdirSync(srcDir).filter((n) => job.match.test(n) && fs.statSync(path.join(srcDir, n)).isFile())) {
      const outName = job.ext ? f.replace(/\.[^.]+$/, job.ext) : f;
      const out = path.join(outDir, outName);
      let buf;
      if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(path.join(srcDir, f)).mtimeMs) { kept += 1; buf = fs.readFileSync(out); }
      else {
        buf = await sharp(path.join(srcDir, f)).resize({ width: job.width, withoutEnlargement: true }).webp({ quality: job.quality }).toBuffer();
        if (fs.existsSync(out) && fs.readFileSync(out).equals(buf)) kept += 1;
        else { fs.writeFileSync(out, buf); made += 1; }
      }
      bytes += buf.length;
      const meta = await sharp(buf).metadata();
      manifest[`${job.out}/${outName}`] = [meta.width, meta.height];
    }
    summary[job.out] = { made, kept, kb: Math.round(bytes / 1024) };
  }
  const sorted = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));
  const text = `${JSON.stringify(sorted)}\n`;
  if (!fs.existsSync(MANIFEST) || fs.readFileSync(MANIFEST, "utf8") !== text) fs.writeFileSync(MANIFEST, text);
  console.log(JSON.stringify({ status: "ok", variants: Object.keys(sorted).length, ...summary }));
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
