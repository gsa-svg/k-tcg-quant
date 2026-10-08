// 이미지 파생본 조회 — 2026-10-08. generate-image-variants.js 가 만든 data/image-variants.json 을 읽어
// 생성기가 화면 크기에 맞는 파일을 고른다. 파생본이 없으면 원본을 그대로 돌려준다(화면이 깨지지 않는다).
//   variant("../img/jp/OP05-119.webp", "hero") → { src: "../img/jp/hero/OP05-119.webp", w: 400, h: 558 } | null
// 경로 꼴(../, 루트절대 /, https://opboxindex.com/, 상대)을 그대로 유지한다. kind: "hero"(세트 264 · 카드 400) | "thumb"(96).
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
let MANIFEST = null;
function manifest() {
  if (MANIFEST) return MANIFEST;
  try { MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "image-variants.json"), "utf8")); } catch { MANIFEST = {}; }
  return MANIFEST;
}
const PREFIX_RE = /^(https:\/\/opboxindex\.com\/|\.\.\/|\/)?/;
function variant(src, kind) {
  if (!src || typeof src !== "string" || /^(data:|https?:\/\/(?!opboxindex\.com\/))/.test(src)) return null;
  const prefix = (src.match(PREFIX_RE) || [""])[0];
  const rel = src.slice(prefix.length).replace(/\?.*$/, "");
  const dir = path.posix.dirname(rel), base = path.posix.basename(rel);
  const outBase = dir === "img/cards" ? base.replace(/\.[^.]+$/, ".webp") : base;
  const key = `${dir}/${kind}/${outBase}`;
  const dims = manifest()[key];
  if (!dims) return null;
  return { src: `${prefix}${key}`, w: dims[0], h: dims[1] };
}
module.exports = { variant };
