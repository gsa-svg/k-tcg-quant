// 2026-07-27 시각 전수검증(170장, 카드별 영문원본↔일본판 후보 눈대조)에서 잡힌 오배정만 고친다.
// 전체 재배정은 하지 않는다 — 나머지 165장은 현재 배정이 맞다고 확인됐다.
//
// TR(Treasure Rare)은 영문판 전용 등급이라 같은 번호의 일본판에 대응 아트가 아예 없다.
// 번호만 같은 다른 변형을 갖다 붙이면 완전히 다른 그림이 뜬다 → 영문 원본으로 되돌린다.
// (틀린 일본판보다 맞는 영문판이 낫다.)
// Run: node tools/fix-misassigned-jp-images.js
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const ROOT = path.join(__dirname, "..");
const JP = "https://www.onepiece-cardgame.com/images/cardlist/card/";

// set|idx|number → "en"(영문 복귀) 또는 접미사
const FIXES = [
  { set: "OP-06", idx: 2, num: "ST01-007", to: "en", why: "TR 팝아트 원화, 일본판에 대응 아트 없음(현재 수채 스케치)" },
  { set: "OP-07", idx: 2, num: "ST10-010", to: "en", why: "TR 모노 스케치, 현재 챔피언십2023 프로모로 오배정" },
  { set: "OP-08", idx: 1, num: "OP07-109", to: "en", why: "TR 전신 SSG 점프, 현재 주먹 클로즈업(패럴렐)로 오배정" },
  { set: "OP-15", idx: 5, num: "OP13-037", to: "en", why: "TR 쌍칼 정면, 일본판 후보 어느 것도 불일치" },
  { set: "OP-08", idx: 7, num: "ST03-004", to: "_p2", why: "SP 보라·금 문양 배경인데 _p1(파랑 프레임 일반)로 오배정" },
];

(async () => {
  const dataPath = path.join(ROOT, "data", "onepiece-packs.json");
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const done = [];
  for (const f of FIXES) {
    const c = ((data.sets[f.set] || {}).cards || [])[f.idx];
    if (!c || c.number !== f.num) throw new Error(`대상 불일치: ${f.set}[${f.idx}] 가 ${f.num} 아님 (top10 순서가 또 바뀜 — 재검증 필요)`);
    if (!c.imageEn) throw new Error(`${f.num}: imageEn 없음 — 되돌릴 원본이 없다`);
    const before = c.image;
    if (f.to === "en") {
      c.image = c.imageEn;
      delete c.imageJpSrc;
      delete c._imgSuffix;
    } else {
      const src = `${JP}${f.num}${f.to}.png`;
      const r = await fetch(src, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!r.ok) throw new Error(`${src} 내려받기 실패 ${r.status}`);
      const webp = `${f.num}${f.to}.webp`;
      await sharp(Buffer.from(await r.arrayBuffer())).resize({ width: 480 }).webp({ quality: 80 })
        .toFile(path.join(ROOT, "img", "jp", webp));
      c.image = `https://opboxindex.com/img/jp/${webp}`;   // 나머지 카드와 같은 절대 URL 형식 (cards/·ko/ 하위 페이지에서도 깨지지 않게)
      c.imageJpSrc = src;
      c._imgSuffix = f.to;
    }
    done.push({ ...f, before: (before || "").split("/").pop(), after: (c.image || "").split("/").pop() });
  }
  fs.writeFileSync(dataPath, `${JSON.stringify(data)}\n`, "utf8");
  fs.writeFileSync(path.join(ROOT, "data", "jp-image-verdicts.json"),
    JSON.stringify({
      verifiedAt: "2026-07-27",
      method: "카드 170장 전수 시각대조(영문 원본 vs 반다이 일본판 후보 전부). 아래는 그중 틀려서 고친 것.",
      note: "TR(Treasure Rare)은 영문 전용 등급 — 같은 번호의 일본판 변형을 붙이면 다른 그림이 된다.",
      fixed: done,
    }, null, 1) + "\n", "utf8");
  console.log(JSON.stringify(done, null, 1));
})();
