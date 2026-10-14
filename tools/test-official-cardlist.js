#!/usr/bin/env node
"use strict";
// 공식 카드리스트 파서 회귀 테스트 — 2026-10-14(W7). 네트워크 없이 공식 HTML 구조를 본뜬 조각으로 돌린다.
// 지키는 것: ① 사실 필드만 읽는다(효과 텍스트·이미지 주소가 결과에 섞이면 FAIL) ② 리더 첫 칸은 라이프 ③ 엔티티 복원
// ④ 상품 선택 상자에서 부스터(OP·EB·PRB, 영문판 OP14-EB04)만 고른다 ⑤ 필드가 빠진 카드는 문제로 잡는다.
// Run: node tools/test-official-cardlist.js
const assert = require("node:assert/strict");
const { parseSeries, parseCards, problemsOf, FIELDS } = require("./fetch-official-cardlist");

const card = ({ id, num, rar, type, name, costH = "コスト", cost, att = "打", power, counter, color, feature, trigger = "", text = "【登場時】カードを1枚引く。" }) => `
          <dl class="modalCol" id="${id}">
            <dt><button class="scrollBtn">ボタン</button>
              <div class="infoCol"><span>${num}</span> | <span>${rar}</span> | <span>${type}</span></div>
              <div class="cardName">${name}</div></dt>
            <dd><div class="frontCol"><img class="lazy" src="/images/cardlist/dummy.gif" data-src="../images/cardlist/card/${id}.png?260929" alt="${name}"></div>
              <div class="rightCol"><div class="backCol">
                <div class="col2"><div class="cost"><h3>${costH}</h3>${cost}</div>
                  ${att ? `<div class="attribute"><h3>属性</h3><img src="/images/cardlist/attribute/ico_type01.png" alt="${att}"></div>` : `<div class="attribute"><h3>属性</h3></div>`}</div>
                <div class="col2"><div class="power"><h3>パワー</h3>${power}</div><div class="counter"><h3>カウンター</h3>${counter}</div></div>
                <div class="col2"><div class="color"><h3>色</h3>${color}</div><div class="block"><h3>ブロック<br class="spInline">アイコン</h3>1</div></div>
                <div class="feature"><h3>特徴</h3>${feature}</div>
                <div class="text"><h3>テキスト</h3>${text}</div>${trigger}
              </div>
              <div class="getInfo"><h3>入手情報</h3>ブースターパック 世界最強の戦士【OP-17】<div class="getInfoBtnCol"><a href="./?series=550117" class="getInfoBtn">カードリスト</a></div></div>
            </div></dd>
          </dl>`;

const html = `<select name="series" class="searchSelectBox" id="series">
  <option value>指定なし</option>
  <option value="550302" >プレミアムブースター &lt;br class=&quot;spInline&quot;&gt;ONE PIECE CARD THE BEST vol.2【PRB-02】</option>
  <option value="550117" selected>ブースターパック 世界最強の戦士【OP-17】</option>
  <option value="569114" >BOOSTER PACK &lt;br class=&quot;spInline&quot;&gt;-THE AZURE SEA’S SEVEN- [OP14-EB04]</option>
  <option value="550031" >スタートデッキ 赤 モンキー・D・ルフィ【ST-31】</option>
  <option value="550901" >プロモーションカード</option>
</select>
${card({ id: "OP17-001", num: "OP17-001", rar: "L", type: "LEADER", name: "エドワード・ニューゲート", costH: "ライフ", cost: "5", att: "特", power: "5000", counter: "-", color: "赤", feature: "四皇/白ひげ海賊団" })}
${card({ id: "OP17-005_p2", num: "OP17-005", rar: "SR", type: "CHARACTER", name: "Edward.Newgate &amp; Marco&#039;s", cost: "10", power: "12000", counter: "-", color: "Red", feature: "The Four Emperors", trigger: '<div class="trigger"><h3>トリガー</h3>【トリガー】このカードを登場させる。</div>' })}
${card({ id: "OP17-017", num: "OP17-017", rar: "C", type: "EVENT", name: "グララララララ!!!", cost: "1", att: "", power: "-", counter: "-", color: "赤", feature: "四皇/白ひげ海賊団" })}`;

// ④ 상품 선택 상자
const series = parseSeries(html);
assert.deepEqual(series.map((s) => s.code), ["PRB-02", "OP-17", "OP14-EB04"], "부스터 상품만 골라야 한다(ST·프로모 제외)");
assert.equal(series[0].name, "プレミアムブースター ONE PIECE CARD THE BEST vol.2", "이스케이프된 <br> 을 걷어낸 이름");
assert.equal(series[2].series, "569114");

// ①②③ 카드
const cards = parseCards(html);
assert.equal(cards.length, 3);
const [leader, sr, ev] = cards;
assert.equal(leader.costKind, "life", "리더 첫 칸은 라이프");
assert.equal(leader.cost, "5");
assert.equal(leader.attribute, "特");
assert.equal(sr.costKind, "cost");
assert.equal(sr.name, "Edward.Newgate & Marco's", "HTML 엔티티 복원");
assert.equal(sr.trigger, true);
assert.equal(leader.trigger, false);
assert.equal(ev.attribute, null, "이벤트는 속성이 없다");
for (const c of cards) {
  const blob = JSON.stringify(c);
  assert.ok(!/登場時|トリガー|このカード|カードを1枚/.test(blob), `효과 텍스트가 결과에 섞였다: ${c.id}`);
  assert.ok(!/images\/cardlist|\.png/.test(blob), `이미지 주소가 결과에 섞였다: ${c.id}`);
  for (const k of Object.keys(c)) assert.ok(k === "id" || FIELDS.includes(k), `저장 목록 밖 필드 ${k}`);
}
assert.deepEqual(problemsOf(cards), []);

// ⑤ 필드 누락은 문제로 잡는다(그 상품은 이번 회차를 버리고 직전 값을 쓴다)
assert.ok(problemsOf([{ ...sr, color: null }]).length === 1, "색이 빠진 카드");
assert.ok(problemsOf([{ ...leader, attribute: null }]).length === 1, "리더·캐릭터는 속성이 있어야 한다");
assert.ok(problemsOf([]).length === 1, "0장 상품");

console.log(JSON.stringify({ test: "official-cardlist", ok: true, series: series.length, cards: cards.length }));
