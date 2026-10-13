// 한국어 라벨 사전 — 영문 auction.html(토글용 data-ko)과 ko/auction.html·ko/cards.html 이 같은 사전을 쓴다. 2026-10-13 분리.
//
// ── 왜 따로 두나
// generate-ko-topic-pages.js 는 require 하는 순간 페이지를 굽는다(최상위 실행). 그 안의 사전을 영문 생성기가
// 가져다 쓰려면 ko 페이지까지 같이 구워지므로, 사전만 떼어 둔다. 두 곳이 다른 사전을 들고 있으면 같은 카드가
// 영문판 토글과 ko/ 페이지에서 다른 한글 이름으로 나온다.
//
// ── 규칙
//   · 캐릭터명만 매핑한다(Parallel·Manga 같은 변형 접미사는 영문 원문 그대로).
//   · 확신이 없는 이름은 넣지 않는다 — 빈 값이 틀린 값보다 낫다(koCharOf 가 null 을 돌려주면 화면은 영문만 쓴다).
//   · 표기 흔들림(공백·점·따옴표)은 flat() 으로 지우고 앞부분 일치로 찾는다. 긴 키부터 봐야
//     "Monkey D. Garp" 가 "Monkey D." 에 먹히지 않는다.
const KO_CHAR = {
  "Monkey D. Luffy": "몽키 D. 루피", "Roronoa Zoro": "롤로노아 조로", "Nami": "나미", "Sanji": "상디",
  "Shanks": "샹크스", "Portgas D. Ace": "포트거스 D. 에이스", "Sabo": "사보", "Boa Hancock": "보아 행콕",
  "Trafalgar Law": "트라팔가 로", "Nico Robin": "니코 로빈", "Tony Tony.Chopper": "토니토니 쵸파", "Chopper": "쵸파",
  "Yamato": "야마토", "Uta": "우타", "Gol D. Roger": "골 D. 로저", "Marshall D. Teach": "마샬 D. 티치",
  "Charlotte Katakuri": "샬롯 카타쿠리", "Dracule Mihawk": "쥬라큘 미호크", "Silvers Rayleigh": "실버즈 레일리",
  "Jewelry Bonney": "쥬얼리 보니", "Buggy": "버기", "Brook": "브룩", "Kuzan": "쿠잔", "Sakazuki": "사카즈키",
  "Borsalino": "볼사리노", "Perona": "페로나", "Tashigi": "타시기", "Rebecca": "레베카", "Enel": "에넬",
  "Smoker": "스모커", "Koala": "코알라", "Laboon": "라분", "Hannyabal": "한냐발", "Shirahoshi": "시라호시",
  "Charlotte Pudding": "샬롯 푸딩", "Sogeking": "저격왕", "Vinsmoke Reiju": "빈스모크 레이쥬",
  "Gecko Moria": "겟코 모리아", "Stussy": "스투시", "Edward.Newgate": "에드워드 뉴게이트",
  "Monkey D. Garp": "몽키 D. 가프", "Koby": "코비", "Zoro-Juurou": "조로주로", "Luffy-Tarou": "루피타로",
  "O-Nami": "오나미", "Kaido": "카이도", 'Eustass"Captain"Kid': "유스타스 캡틴 키드", "Vegapunk": "베가펑크",
  // 2026-10-13 OP-17·가격판 상위에 올라온 카드(QA: 같은 표 안에서 한글 이름이 있다 없다 해 줄 수가 달라 보였다).
  "Rocks D. Xebec": "록스 D. 지벡", "Loki": "로키", "Charlotte Linlin": "샬롯 링링", "Ms All Sunday": "미스 올 선데이",
  "Benn Beckman": "벤 베크만", "Gloriosa": "글로리오사", "Usopp": "우솝", "Jinbe": "징베", "Franky": "프랑키",
  "Nefeltari Vivi": "네펠타리 비비", "Marco": "마르코", "Kouzuki Oden": "코즈키 오뎅", "Shiki": "시키",
  "Crocodile": "크로커다일", "Donquixote Doflamingo": "돈키호테 도플라밍고", "Rob Lucci": "롭 루치",
  "Jaguar D. Saul": "하구와르 D. 사울", "Charlotte Perospero": "샬롯 페로스페로", "Charlotte Smoothie": "샬롯 스무디",
  "Capone Gang Bege": "카포네 갱 베지", "Basil Hawkins": "바질 호킨스", "Scratchmen Apoo": "스크래치맨 아푸",
  "Kurozumi Orochi": "쿠로즈미 오로치", "Kurozumi Kanjuro": "쿠로즈미 칸주로", "Queen": "퀸", "King": "킹",
  "Ace Newgate": "에이스 뉴게이트",
};
const flat = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const KO_CHAR_KEYS = Object.entries(KO_CHAR).map(([k, v]) => [flat(k), v]).sort((a, b) => b[0].length - a[0].length);
const koCharOf = (name) => { const n = flat(name); const hit = KO_CHAR_KEYS.find(([k]) => n.startsWith(k)); return hit ? hit[1] : null; };

// 변형(tier, auction-card-stats 의 ourTier 키) → [영문 라벨, 한국어 라벨]. 영문판·한국어판 가격판이 같은 표를 쓴다.
const TIER_LABEL = {
  base: ["Base", "일반"], alt: ["Alt art", "패러렐"], super: ["Super alt", "슈퍼 패러렐"], red: ["Red manga", "망가 아트"],
  sp: ["SP", "SP"], gold: ["Gold", "골드"], silver: ["Silver", "실버"], signature: ["Signature", "사인"],
  boxtopper: ["Box topper", "박스 토퍼"], wanted: ["Wanted", "수배서"], tr: ["Treasure rare", "트레저 레어"],
};
const tierEn = (t) => (TIER_LABEL[t] || [t, t])[0];
const tierKo = (t) => (TIER_LABEL[t] || [t, t])[1];

module.exports = { KO_CHAR, koCharOf, TIER_LABEL, tierEn, tierKo };
