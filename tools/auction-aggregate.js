// 경매 원장 → 일별 집계. settle-auctions(수집 직후)와 reaggregate-auctions(재집계)가 함께 쓴다.
//
// ── 왜 모듈로 뺐나 (2026-09-01)
// 집계식이 settle-auctions.js 안에만 있어서, 분류 규칙을 고쳐도 과거분을 다시 집계하려면
// eBay 를 다시 불러야 했다(하루 5,000건 한도). 같은 식을 다른 파일에 복사하면 언젠가 어긋난다 —
// 이번 세션에만 같은 유형(같은 것이 여러 곳에 있어 어긋남)을 다섯 번 봤다. 그래서 한 곳에 둔다.
//
// ── 분류를 여기서 다시 매기는 이유
// 원장에 박힌 kind 는 **수집 당시** 규칙으로 매겨진 값이다. 규칙을 고치면 과거 기록도 새 규칙으로
// 봐야 한다. 원장은 원본(제목·가격·시각)이고 분류는 파생이므로, 읽을 때마다 제목에서 다시 만든다.
// 원장 파일 자체는 절대 고쳐 쓰지 않는다 — append-only 가 이 데이터의 신뢰 근거다.
const { categorize } = require("./auction-classify");

// 가격 집계는 "개당가" 기준. qty 필드가 있는 새 기록은 unitPrice(수량 모름이면 null→제외),
// qty 필드가 없는 과거 기록은 종전대로 price 를 쓴다(45일 롤링이라 자연 소멸).
const perUnit = (r) => ("qty" in r ? r.unitPrice : r.price);

function med(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Number(((a[m - 1] + a[m]) / 2).toFixed(2));
}

function agg(rows) {
  const soldRows = rows.filter((r) => r.sold === true && Number.isFinite(perUnit(r)));
  const decided = rows.filter((r) => r.sold !== null); // 팔림/유찰이 확정된 것만 낙찰률 분모
  return {
    n: rows.length,
    sold: rows.filter((r) => r.sold === true).length,
    sellThrough: decided.length ? Number(((decided.filter((r) => r.sold).length / decided.length) * 100).toFixed(1)) : null,
    medPrice: med(soldRows.map(perUnit)),
    maxPrice: soldRows.length ? Math.max(...soldRows.map(perUnit)) : null,
    medBids: med(soldRows.map((r) => r.bids)),
  };
}

// 원장 기록에 최신 분류 규칙을 다시 입힌다. 제목이 없는 기록은 그대로 둔다(되짚을 근거가 없다).
function reclassify(rows) {
  return rows.map((r) => (r && r.title ? { ...r, kind: categorize(r.title) } : r));
}

// window: 원장에서 읽은 기록 배열(여러 날). 반환: 날짜 오름차순 일별 집계.
function buildDaily(window) {
  const rowsAll = reclassify(window).slice().sort((a, b) => String(a.d).localeCompare(String(b.d)));
  const days = [...new Set(rowsAll.map((s) => s.d))];
  return days.map((d) => {
    const rows = rowsAll.filter((s) => s.d === d);
    const bySet = {};
    for (const s of new Set(rows.filter((r) => r.set).map((r) => r.set))) {
      const rs = rows.filter((r) => r.set === s);
      if (rs.length < 2) continue; // 표본 1건은 잡음
      bySet[s] = agg(rs);
    }
    return {
      d,
      ...agg(rows),
      byKind: Object.fromEntries(["box", "carton", "pack", "card"].map((k) => [k, agg(rows.filter((r) => r.kind === k))])),
      // 박스는 판(JP/EN)별 + 갯수(single/multi)별로도 집계. carton 은 위 byKind.carton 으로 분리됨 — box 에 안 섞임.
      boxByEd: Object.fromEntries(["jp", "en"].map((e) => [e, agg(rows.filter((r) => r.kind === "box" && r.ed === e))])),
      boxByQty: {
        single: agg(rows.filter((r) => r.kind === "box" && r.qty === 1)),
        multi: agg(rows.filter((r) => r.kind === "box" && Number.isFinite(r.qty) && r.qty > 1)),
      },
      // 등급 카드 축 — 2026-08-20 추가. 레코드에는 grade 가 붙어 있었는데(PSA 10 · CGC Pristine 10 …)
      // 일별 집계에 축이 없어서 "등급 카드가 무등급보다 얼마나 비싼가"를 낼 수 없었다.
      // 회사별로 10 의 이름이 다르다(PSA 10 / PSA Gem Mint 10 / CGC 10 / CGC Gem Mint 10 / CGC Pristine 10 …).
      // 여기서는 그걸 회사 단위로만 묶는다 — 등급 라벨끼리 합치면 서로 다른 기준을 한 칸에 뭉개게 된다.
      byGrade: (() => {
        const graded = rows.filter((r) => r.grade);
        const out = { raw: agg(rows.filter((r) => !r.grade)), graded: agg(graded) };
        for (const co of ["PSA", "CGC", "BGS", "TAG"]) {
          const rs = graded.filter((r) => String(r.grade).toUpperCase().startsWith(co));
          if (rs.length) out[co.toLowerCase()] = agg(rs);
        }
        return out;
      })(),
      bySet,
    };
  });
}

// 기간 전체를 유형별로 요약한다 — 페이지의 "유형별" 표·그래프가 쓴다.
//
// ⚠️ 일별 중앙값의 중앙값을 쓰면 안 된다. 2026-09-01 실측: 그렇게 낸 값이 팩 $5.58 · 박스 $399 였고,
//    같은 기간 실제 중앙값은 팩 $6.00 · 박스 $445 였다. 하루 몇 건뿐인 유형(박스는 하루 1~2건)은
//    "그날의 중앙값"이 사실상 한 건이라, 그것들을 다시 중앙값 내면 원래 분포와 상관없는 수가 나온다.
//    낙찰 건 전체를 한 줄로 세워 자르는 것만이 그 기간의 중앙값이다.
//
// days: 쓰려는 날짜 집합(부분수집일 제외 등 창 결정은 부르는 쪽 몫).
function summarizeKinds(window, days) {
  const use = days ? new Set(days) : null;
  const rows = reclassify(window).filter((r) => r && (!use || use.has(r.d)));
  const q = (arr, f) => {
    if (!arr.length) return null;
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.floor((a.length - 1) * f)];
  };
  const out = {};
  for (const k of ["box", "carton", "pack", "card"]) {
    const rs = rows.filter((r) => r.kind === k);
    const soldPrices = rs.filter((r) => r.sold === true && Number.isFinite(perUnit(r))).map(perUnit);
    const decided = rs.filter((r) => r.sold !== null);
    out[k] = {
      n: rs.length,
      sold: rs.filter((r) => r.sold === true).length,
      decided: decided.length,
      sellThrough: decided.length ? Number(((decided.filter((r) => r.sold).length / decided.length) * 100).toFixed(1)) : null,
      priceN: soldPrices.length,
      p25: q(soldPrices, 0.25),
      med: q(soldPrices, 0.5),
      p75: q(soldPrices, 0.75),
      // 판(JP/EN)별로도 나눈다 — 박스는 판마다 값이 4배 가까이 차이나서 섞으면 대표값이 무의미하다.
      byEd: Object.fromEntries(["jp", "en"].map((e) => {
        const g = rs.filter((r) => r.ed === e);
        const gp = g.filter((r) => r.sold === true && Number.isFinite(perUnit(r))).map(perUnit);
        const gd = g.filter((r) => r.sold !== null);
        return [e, {
          n: g.length,
          sold: g.filter((r) => r.sold === true).length,
          sellThrough: gd.length ? Number(((gd.filter((r) => r.sold).length / gd.length) * 100).toFixed(1)) : null,
          priceN: gp.length,
          med: q(gp, 0.5),
        }];
      })),
    };
  }
  return out;
}

module.exports = { buildDaily, agg, med, perUnit, reclassify, summarizeKinds };
