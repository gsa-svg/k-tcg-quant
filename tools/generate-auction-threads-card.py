#!/usr/bin/env python3
"""경매 낙찰률 스레드 카드 생성 — 2026-08-06.

data/auction-sold.json(완료된 eBay 경매 원장)에서 종류별 낙찰률을 계산해
1080x1350 카드 2장을 만든다. 색·규격·폰트는 generate-weekly-threads-assets.py 와 동일하게 맞춘다.

숫자는 전부 원장에서 계산한다 — 문구에 손으로 적어 넣지 않는다. 원장이 바뀌면 카드도 바뀐다.
표본이 작은 항목(박스)은 카드에 표본 수를 같이 찍어 과장으로 읽히지 않게 한다.
Run: python tools/generate-auction-threads-card.py
"""

from __future__ import annotations

import json
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "auction-sold.json"
OUT = ROOT / "social" / "auction" / date.today().isoformat()

W, H = 1080, 1350
BG = "#070a10"
PANEL = "#101722"
LINE = "#263244"
TEXT = "#f2f6ff"
MUTED = "#9ca9bf"
CYAN = "#19e6c1"
GREEN = "#32e59b"
RED = "#ff6b7d"


def load_font(size: int, bold: bool = False):
    for c in [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        if Path(c).exists():
            return ImageFont.truetype(c, size=size)
    return ImageFont.load_default()


F26, F30, F34 = load_font(26), load_font(30), load_font(34, True)
F42, F54, F72 = load_font(42, True), load_font(54, True), load_font(72, True)


def week_start(d: str) -> str:
    t = datetime.strptime(d, "%Y-%m-%d")
    return (t - timedelta(days=t.weekday())).strftime("%Y-%m-%d")


def stats(sales):
    """종류별 출품/낙찰/낙찰률/낙찰가 중앙값."""
    out = defaultdict(lambda: {"n": 0, "sold": 0, "p": []})
    for s in sales:
        b = out[s.get("kind") or "?"]
        b["n"] += 1
        if s.get("sold"):
            b["sold"] += 1
            if (s.get("unitPrice") or 0) > 0:
                b["p"].append(s["unitPrice"])
    for b in out.values():
        b["rate"] = b["sold"] / b["n"] * 100 if b["n"] else 0
        b["med"] = statistics.median(b["p"]) if b["p"] else None
    return out


def frame(draw):
    draw.rectangle([0, 0, W, H], fill=BG)
    draw.rectangle([0, 0, W, 8], fill=CYAN)
    draw.text((64, 60), "OP BOX INDEX", font=F30, fill=CYAN)


def footer(draw, note: str):
    draw.line([(64, H - 150), (W - 64, H - 150)], fill=LINE, width=2)
    draw.text((64, H - 128), note, font=F26, fill=MUTED)
    draw.text((64, H - 88), "opboxindex.com", font=F30, fill=CYAN)


def bar(draw, x, y, w, h, pct, color):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=8, fill="#182233")
    fill_w = max(10, int(w * pct / 100))
    draw.rounded_rectangle([x, y, x + fill_w, y + h], radius=8, fill=color)


def card1(st, period, total):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    frame(d)
    d.text((64, 110), f"COMPLETED EBAY AUCTIONS · {period}", font=F26, fill=MUTED)

    d.text((64, 190), "Sealed sells.", font=F72, fill=TEXT)
    d.text((64, 275), "Singles sit.", font=F72, fill=GREEN)

    rows = [("Sealed boxes", "box", GREEN), ("Packs", "pack", CYAN), ("Single cards", "card", RED)]
    y = 430
    for label, key, color in rows:
        b = st[key]
        d.text((64, y), label, font=F42, fill=TEXT)
        d.text((W - 64, y), f"{b['rate']:.1f}%", font=F54, fill=color, anchor="ra")
        bar(d, 64, y + 78, W - 128, 26, b["rate"], color)
        d.text((64, y + 118), f"{b['sold']:,} sold of {b['n']:,} listed", font=F26, fill=MUTED)
        y += 210

    box, card = st["box"], st["card"]
    mult = box["rate"] / card["rate"] if card["rate"] else 0
    d.rounded_rectangle([64, y - 10, W - 64, y + 110], radius=14, fill=PANEL, outline=LINE, width=2)
    d.text((96, y + 24), f"A sealed box is {mult:.1f}x more likely to sell", font=F34, fill=TEXT)
    d.text((96, y + 66), "than a single card.", font=F34, fill=TEXT)

    footer(d, f"{total:,} completed auctions · every listing checked after it ended")
    return img


def card2(weekly, st, period):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    frame(d)
    d.text((64, 110), f"WEEK BY WEEK · {period}", font=F26, fill=MUTED)
    d.text((64, 185), "It held every week.", font=F54, fill=TEXT)

    y = 300
    for wk, b in weekly:
        d.text((64, y), f"Week of {wk}", font=F30, fill=MUTED)
        for label, key, color, dx in (("Boxes", "box", GREEN, 0), ("Singles", "card", RED, 470)):
            s = b[key]
            d.text((64 + dx, y + 48), label, font=F30, fill=MUTED)
            d.text((64 + dx, y + 86), f"{s['rate']:.1f}%", font=F54, fill=color)
            d.text((64 + dx, y + 152), f"{s['sold']}/{s['n']}", font=F26, fill=MUTED)
        y += 250

    d.rounded_rectangle([64, y, W - 64, y + 150], radius=14, fill=PANEL, outline=LINE, width=2)
    d.text((96, y + 26), f"Only {st['box']['n']} box auctions in the window,", font=F30, fill=MUTED)
    d.text((96, y + 66), "so the weekly box numbers swing.", font=F30, fill=MUTED)
    d.text((96, y + 106), "The direction doesn't.", font=F30, fill=TEXT)

    footer(d, f"Median winning bid — box ${st['box']['med']:,.0f} · single ${st['card']['med']:,.0f}")
    return img


def main():
    src = json.loads(SRC.read_text(encoding="utf-8"))
    sales = src["sales"]
    days = sorted(s["d"] for s in sales)
    period = f"{days[0]} - {days[-1]}"
    st = stats(sales)

    by_week = defaultdict(list)
    for s in sales:
        by_week[week_start(s["d"])].append(s)
    weekly = [(w, stats(v)) for w, v in sorted(by_week.items())]
    # 박스 표본이 5건도 안 되는 주는 카드에 싣지 않는다(비율이 의미를 잃는다).
    weekly = [(w, b) for w, b in weekly if b["box"]["n"] >= 5][-3:]

    OUT.mkdir(parents=True, exist_ok=True)
    card1(st, period, len(sales)).save(OUT / "threads-card-1.png")
    card2(weekly, st, period).save(OUT / "threads-card-2.png")
    print(json.dumps({
        "out": str(OUT),
        "period": period,
        "total": len(sales),
        "box": {k: st["box"][k] for k in ("n", "sold", "rate", "med")},
        "card": {k: st["card"][k] for k in ("n", "sold", "rate", "med")},
        "weeks": [w for w, _ in weekly],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
