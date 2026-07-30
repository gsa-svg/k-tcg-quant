#!/usr/bin/env node
// top10 카드의 일본판 이미지를 반다이 공식 "상품별 카드리스트"로 확정한다.
//
// 왜 이게 필요한가 (2026-07-30):
//  우리 사이트는 일본판 시세 기준이고 packs.js 도 일본 이미지(c.image)를 우선 표시한다.
//  그런데 top10 이미지 출처가 일본판(반다이)과 영문판(TCGplayer)으로 섞여 있었다.
//  과거에 일본 이미지로 맞추려는 시도가 있었지만 "어느 _pN 이 어느 상품 것인가"를 추측해서 틀렸다
//  (PRB-01 나미에 OP-01 의 망가 아트를 붙임 등). 소유자가 실물/이베이로 발견했다.
//
// 추측을 없애는 방법:
//  반다이 공식 카드리스트는 상품(series)별로 그 상품에 실제 수록된 이미지만 싣는다.
//  그 상품 목록에서 우리 카드번호에 해당하는 이미지가 **정확히 하나**일 때만 채택한다.
//  변형 카드(패러렐/망가/SP/수배서…)는 기본판(접미어 없음)을 후보에서 뺀다.
//  후보가 둘 이상이면 건드리지 않는다 — 그게 예전에 틀린 지점이다. 사람 눈이 필요하다.
//
// 사용:
//   node tools/official-jp-images.js --fetch          공식 목록 받아 data/official-card-images.json 갱신
//   node tools/official-jp-images.js                  확정 가능한 것만 리포트(변경 없음)
//   node tools/official-jp-images.js --write          확정된 것 반영 + webp 생성
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MAP = path.join(ROOT, "data", "official-card-images.json");
const IMG_DIR = path.join(ROOT, "img", "jp");
const DATA = path.join(ROOT, "data", "onepiece-packs.json");
const CARD_BASE = "https://www.onepiece-cardgame.com/images/cardlist/card/";

// 공식 카드리스트 series id. 상품 하나가 곧 series 하나다.
const SERIES = {
  "OP-01": 550101, "OP-02": 550102, "OP-03": 550103, "OP-04": 550104,
  "OP-05": 550105, "OP-06": 550106, "OP-07": 550107, "OP-08": 550108,
  "OP-09": 550109, "OP-10": 550110, "OP-11": 550111, "OP-12": 550112,
  "OP-13": 550113, "OP-14": 550114, "OP-15": 550115, "OP-16": 550116,
  "EB-01": 550201, "EB-02": 550202, "EB-03": 550203, "EB-04": 550204,
  "PRB-01": 550301, "PRB-02": 550302,
};

// 이름/등급에 이런 말이 있으면 기본판이 아니다 → 기본판을 후보에서 뺀다.
const VARIANT = /parallel|alt(ernate)?\s*art|manga|comic|\bsp\b|wanted|topper|signature|stamped|\bred\b|gold|silver|super|don/i;

async function fetchLists() {
  const out = {};
  for (const [code, id] of Object.entries(SERIES)) {
    const r = await fetch(`https://www.onepiece-cardgame.com/cardlist/?series=${id}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!r.ok) { console.error(`${code}: HTTP ${r.status} — 건너뜀(기존 값 유지)`); continue; }
    const html = await r.text();
    const imgs = [...new Set([...html.matchAll(/cardlist\/card\/([A-Z]+\d{2}-\d{3}(?:_p\d+)?)\.png/g)].map((m) => m[1]))];
    if (imgs.length < 20) { console.error(`${code}: 이미지 ${imgs.length}개뿐 — 수집 실패로 보고 건너뜀`); continue; }
    out[code] = imgs.sort();
  }
  if (!Object.keys(out).length) throw new Error("한 상품도 못 받음 — 아무것도 쓰지 않는다");
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(MAP, "utf8")).sets || {}; } catch {}
  fs.writeFileSync(MAP, JSON.stringify({
    note: "Official Bandai card-list image filenames per product (series). Used to decide which _pN artwork belongs to which set, instead of inferring it. A card is only assigned when its number resolves to exactly one image in that product's list.",
    source: "https://www.onepiece-cardgame.com/cardlist/?series=<id>",
    series: SERIES,
    updated: new Date().toISOString().slice(0, 10),
    sets: { ...prev, ...out },
  }, null, 1) + "\n", "utf8");
  return out;
}

// 그 상품에서 이 카드의 이미지를 하나로 확정할 수 있으면 접미어를 돌려준다. 아니면 null + 이유.
function resolve(list, num, name, rarity) {
  let hits = list.filter((x) => x === num || x.startsWith(num + "_p"));
  if (!hits.length) return { suffix: null, why: "그 상품 목록에 카드번호 없음" };
  if (VARIANT.test(name || "") || VARIANT.test(rarity || "")) hits = hits.filter((x) => x !== num);
  if (hits.length === 1) return { suffix: hits[0].slice(num.length), why: null };
  if (!hits.length) return { suffix: null, why: "변형 후보 없음(기본판만 수록)" };
  return { suffix: null, why: `후보 ${hits.length}개 — 눈으로 확인 필요 (${hits.join(", ")})` };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--fetch")) { await fetchLists(); console.log("공식 목록 갱신 완료"); }

  const map = JSON.parse(fs.readFileSync(MAP, "utf8"));
  const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
  const codes = [...(data.jp?.list || []), ...(data.extra?.list || [])];
  const write = argv.includes("--write");

  const fixes = [], ok = [], unresolved = [];
  for (const code of codes) {
    const list = map.sets[code];
    if (!list) continue;
    for (const c of data.sets[code].cards || []) {
      const num = String(c.number || "").replace(/^#/, "").toUpperCase();
      if (!/^[A-Z]+\d{2}-\d{3}$/.test(num)) { unresolved.push({ code, name: c.name, why: `카드번호 비표준("${c.number || ""}")` }); continue; }
      const { suffix, why } = resolve(list, num, c.name, c.rarity);
      if (suffix == null) { unresolved.push({ code, name: c.name, num, why }); continue; }
      const cur = c._imgSuffix != null ? c._imgSuffix : null;
      const want = suffix || "base";
      if (cur === want && /opboxindex/.test(c.image || "")) { ok.push(`${code} ${c.name}`); continue; }
      fixes.push({ code, card: c, num, suffix, from: cur == null ? "(일본이미지 없음)" : cur, to: want });
    }
  }

  console.log(JSON.stringify({
    mode: write ? "write" : "dry-run",
    확정됨: ok.length + fixes.length, 이미맞음: ok.length, 고칠것: fixes.length, 확정불가: unresolved.length,
  }, null, 1));
  fixes.forEach((f) => console.log(`  FIX ${f.code} ${f.card.name}: ${f.from} → ${f.to}`));

  if (!write) {
    console.log("\n[확정 불가 — 사람 확인 필요]");
    unresolved.forEach((u) => console.log(`  ${u.code} ${u.name}: ${u.why}`));
    return;
  }

  const sharp = require("sharp");
  fs.mkdirSync(IMG_DIR, { recursive: true });
  let made = 0;
  for (const f of fixes) {
    const file = `${f.num}${f.suffix}`;
    const webp = path.join(IMG_DIR, `${file}.webp`);
    if (!fs.existsSync(webp)) {
      const r = await fetch(`${CARD_BASE}${file}.png`, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!r.ok) { console.error(`  건너뜀 ${file}: PNG HTTP ${r.status}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      await sharp(buf).resize({ width: 480 }).webp({ quality: 80 }).toFile(webp);
      made++;
    }
    f.card.image = `https://opboxindex.com/img/jp/${file}.webp`;
    f.card._imgSuffix = f.suffix;
    f.card.imageJpSrc = `${CARD_BASE}${file}.png`;
    f.card._imgSource = "official-cardlist";   // 추측이 아니라 공식 목록에서 왔다는 표시
  }
  fs.writeFileSync(DATA, JSON.stringify(data, null, 1) + "\n", "utf8");
  console.log(`\n반영 완료 — 카드 ${fixes.length}장, 새 webp ${made}개`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
