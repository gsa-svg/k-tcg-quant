# -*- coding: utf-8 -*-
"""기존 app.js의 marketData를 읽어 data/products.json + data/fx.json 으로 분리한다.
새 스키마: sourcePrices(원본통화 1개) + tier(primary/reference) + 언어명 정리.
가격의 원화 환산은 런타임(app.js)에서 fx.json 기준으로 계산한다.
"""
import json, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(ROOT, "app.js"), encoding="utf-8") as f:
    src = f.read()

# 1) marketData 배열 리터럴만 추출
start = src.index("const marketData = ") + len("const marketData = ")
end = src.index("\n];", start) + 2  # 닫는 "]" 까지
arr_text = src[start:end]

# 2) JS 객체 리터럴 -> JSON 변환
#    키({ 또는 , 뒤의 식별자:)에 따옴표를 붙이고, 후행 콤마 제거
arr_text = re.sub(r'([{\[,]\s*)([A-Za-z_]\w*)\s*:', r'\1"\2":', arr_text)
arr_text = re.sub(r',(\s*[}\]])', r'\1', arr_text)
items = json.loads(arr_text)
print("parsed items:", len(items))

# 3) fx
fx = {"date": "2026-06-21", "jpyKrw": 9.45, "usdKrw": 1388.2}

# 4) 변환
def transform(items):
    out = []
    for i, it in enumerate(items):
        lang_raw = it["language"]
        if lang_raw == "일본판":
            language, tier, source = "일본어판", "primary", {"jpy": it["price"]}
        elif lang_raw == "한국어판":
            language, tier, source = "한국어판", "primary", {"krw": it["price"]}
        else:  # 해외판 -> 해외 참고
            language, tier, source = "해외 참고", "reference", {"usd": it["price"]}
        p = {
            "id": "prod-%03d" % (i + 1),
            "title": it["title"],
            "productType": it["subtitle"],
            "category": it["category"],
            "era": it["era"],
            "language": language,
            "tier": tier,
            "sourcePrices": source,
            "momentum": it["momentum"],
            "momentumWindow": "12w",
            "liquidity": it["liquidity"],
            "sealRisk": it["sealRisk"],
            "quantScore": it["quantScore"],
            "confidence": it["confidence"],
            "msrpMultiple": it["msrpMultiple"],
            "updated": it["updated"],
            "signal": it["signal"],
            "thumbA": it["thumbA"],
            "thumbB": it["thumbB"],
            "imageUrl": None,
        }
        for k in ("setup", "setupLevel", "stanceType", "stanceLabel"):
            if k in it:
                p[k] = it[k]
        if tier == "reference":
            p["referenceMarket"] = "eBay · TCGplayer 등 해외 USD 시세 참고"
        out.append(p)
    return out

products = transform(items)
prim = sum(1 for p in products if p["tier"] == "primary")
ref = sum(1 for p in products if p["tier"] == "reference")
print("primary:", prim, "reference:", ref)

os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
payload = {
    "_note": "샘플 데이터 / MVP 검증용 — 실제 시세 아님",
    "updated": fx["date"],
    "products": products,
}
with open(os.path.join(ROOT, "data", "products.json"), "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)
with open(os.path.join(ROOT, "data", "fx.json"), "w", encoding="utf-8") as f:
    json.dump(fx, f, ensure_ascii=False, indent=2)
print("written data/products.json, data/fx.json")
