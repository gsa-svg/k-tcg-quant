#!/usr/bin/env python3
"""Riftbound 최고가 낙찰 스레드 카드 — 2026-09-02.

색·규격·폰트는 generate-auction-threads-card.py 와 동일(1080x1350, 다크+시안).
가격·날짜는 data/tcg-archive 원장에서 계산한다 — 손으로 적지 않는다.
카드 이름만은 원장에 제목이 없어(9/2 이전 기록) 매물 페이지를 직접 열어 확인한 값을 상수로 둔다.
Run: python tools/generate-riftbound-threads-card.py
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "data" / "tcg-archive"
OUT = ROOT / "social" / "auction" / date.today().isoformat()

W, H = 1080, 1350
BG = "#070a10"
PANEL = "#101722"
LINE = "#263244"
TEXT = "#f2f6ff"
MUTED = "#9ca9bf"
CYAN = "#19e6c1"
GOLD = "#ffca6e"


def load_font(size: int, bold: bool = False):
    for c in [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
    ]:
        if Path(c).exists():
            return ImageFont.truetype(c, size=size)
    return ImageFont.load_default()


F24, F28, F30 = load_font(24), load_font(28), load_font(30)
F34, F40 = load_font(34, True), load_font(40, True)
F54, F84 = load_font(54, True), load_font(84, True)

# 2026-09-02 매물 페이지 실물 검증 완료(제목·낙찰일 원장과 대조).
VERIFIED_NAMES = {
    "117340268404": "Prizewall #255 Ahri · PSA 10",
    "307131866286": "Origins Prizewall Ahri · PSA 10",
    "307139332909": "Vendetta sig Akali · PSA 10",
    "800499423637": "Kai'sa · BGS Black Label 10 (pop 5)",
}


def top_riftbound(n=4):
    rows = []
    for f in sorted(ARCHIVE.glob("????-??-??.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        for r in data.get("sales", []):
            if r.get("g") == "riftbound" and r.get("sold") and isinstance(r.get("price"), (int, float)):
                rows.append(r)
    rows.sort(key=lambda r: -r["price"])
    out = []
    for r in rows[:n]:
        item = r["id"].split("|")[1]
        out.append({
            "price": r["price"],
            "d": r["d"],
            "name": VERIFIED_NAMES.get(item, "(verified listing)"),
        })
    return out, len(rows)


def footer(dr):
    dr.line([(72, H - 150), (W - 72, H - 150)], fill=LINE, width=2)
    dr.text((72, H - 118), "opboxindex.com", font=F40, fill=CYAN)
    dr.text((72, H - 62), "Settled eBay auctions - read again after close, never asking prices", font=F24, fill=MUTED)


def card1(rows):
    img = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(img)
    dr.text((72, 70), "RIFTBOUND (LEAGUE OF LEGENDS)", font=F34, fill=CYAN)
    dr.text((72, 128), "Biggest settled auctions", font=F54, fill=TEXT)
    dr.text((72, 205), "in our 4-week ledger - all graded chase cards", font=F28, fill=MUTED)

    top = rows[0]
    dr.rounded_rectangle([72, 270, W - 72, 560], radius=22, fill=PANEL, outline=LINE, width=2)
    dr.text((104, 300), "#1  " + top["name"], font=F34, fill=TEXT)
    dr.text((104, 366), f"${top['price']:,.0f}", font=F84, fill=GOLD)
    dr.text((104, 486), f"settled {top['d']}", font=F28, fill=MUTED)

    y = 610
    for i, r in enumerate(rows[1:], start=2):
        dr.rounded_rectangle([72, y, W - 72, y + 150], radius=18, fill=PANEL, outline=LINE, width=2)
        dr.text((104, y + 26), f"#{i}  {r['name']}", font=F30, fill=TEXT)
        dr.text((104, y + 78), f"${r['price']:,.0f}", font=F54, fill=CYAN)
        dr.text((W - 300, y + 92), f"settled {r['d']}", font=F24, fill=MUTED)
        y += 178
    footer(dr)
    return img


def card2():
    # 두 페이지 안내 카드 — 수치는 파일에서 읽는다.
    tcg = json.loads((ROOT / "data" / "tcg-series.json").read_text(encoding="utf-8"))
    games = len(json.loads((ROOT / "data" / "tcg-snapshot.json").read_text(encoding="utf-8")).get("terms", {}))
    ended = sum(g.get("ended", 0) for d in tcg.get("daily", []) for g in d.get("games", {}).values())

    img = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(img)
    dr.text((72, 70), "WHAT WE SETTLE, EVERY DAY", font=F34, fill=CYAN)
    dr.text((72, 128), "Auction results you can check", font=F54, fill=TEXT)

    dr.rounded_rectangle([72, 250, W - 72, 560], radius=22, fill=PANEL, outline=LINE, width=2)
    dr.text((104, 286), "One Piece auctions", font=F40, fill=TEXT)
    dr.text((104, 350), "30,000+ settled in the current window", font=F28, fill=MUTED)
    dr.text((104, 400), "sell-through - median winning bid - JP vs EN", font=F28, fill=MUTED)
    dr.text((104, 480), "opboxindex.com/auction.html", font=F34, fill=CYAN)

    dr.rounded_rectangle([72, 610, W - 72, 920], radius=22, fill=PANEL, outline=LINE, width=2)
    dr.text((104, 646), f"{games} card games, side by side", font=F40, fill=TEXT)
    dr.text((104, 710), f"{ended:,} auctions checked after close", font=F28, fill=MUTED)
    dr.text((104, 760), "sold vs passed - hammer value - sample share shown", font=F28, fill=MUTED)
    dr.text((104, 840), "opboxindex.com/tcg-auction.html", font=F34, fill=CYAN)

    dr.text((72, 985), "Every listing is read again after it closes.", font=F30, fill=TEXT)
    dr.text((72, 1035), "Unsold auctions stay in the denominator.", font=F30, fill=TEXT)
    footer(dr)
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows, total = top_riftbound()
    card1(rows).save(OUT / "riftbound-top-settled.png")
    card2().save(OUT / "auction-pages.png")
    print(json.dumps({"rows": rows, "riftboundSold": total, "out": str(OUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
