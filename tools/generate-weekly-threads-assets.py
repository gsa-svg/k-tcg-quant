#!/usr/bin/env python3
"""Generate weekly Threads assets for OP Box Index.

The script creates two 1080x1350 PNG cards plus post copy from the current
One Piece price dataset. It stores a weekly card-price snapshot so the next run
can calculate real week-over-week movers.
"""

from __future__ import annotations

import argparse
import json
import math
import textwrap
import urllib.request
from datetime import date
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "onepiece-packs.json"
SNAPSHOT_PATH = ROOT / "data" / "social-card-price-snapshots.json"
OUT_ROOT = ROOT / "social" / "weekly"

W, H = 1080, 1350
BG = "#070a10"
PANEL = "#101722"
PANEL_2 = "#0d131d"
LINE = "#263244"
TEXT = "#f2f6ff"
MUTED = "#9ca9bf"
CYAN = "#19e6c1"
GREEN = "#32e59b"
RED = "#ff6b7d"
YELLOW = "#ffe58a"


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        p = Path(candidate)
        if p.exists():
            return ImageFont.truetype(str(p), size=size)
    return ImageFont.load_default()


FONT_26 = load_font(26)
FONT_30 = load_font(30)
FONT_34 = load_font(34, True)
FONT_42 = load_font(42, True)
FONT_54 = load_font(54, True)
FONT_72 = load_font(72, True)


def money_krw(value: float | int | None) -> str:
    if value is None or not math.isfinite(float(value)):
        return "-"
    return "KRW " + f"{int(round(float(value))):,}"


def pct_text(value: float | None) -> str:
    if value is None or not math.isfinite(value):
        return "baseline"
    sign = "+" if value >= 0 else ""
    return f"{sign}{value:.1f}%"


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        test = f"{current} {word}".strip()
        if draw.textbbox((0, 0), test, font=font)[2] <= width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_text_box(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font: ImageFont.ImageFont, fill: str, width: int, line_gap: int = 8) -> int:
    x, y = xy
    for line in wrap_text(draw, text, font, width):
        draw.text((x, y), line, fill=fill, font=font)
        y += font.size + line_gap if hasattr(font, "size") else 28
    return y


def ellipsize(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, width: int) -> str:
    if draw.textbbox((0, 0), text, font=font)[2] <= width:
        return text
    suffix = "..."
    trimmed = text
    while trimmed and draw.textbbox((0, 0), trimmed + suffix, font=font)[2] > width:
        trimmed = trimmed[:-1].rstrip()
    return (trimmed + suffix) if trimmed else suffix


def draw_limited_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    font: ImageFont.ImageFont,
    fill: str,
    width: int,
    max_lines: int = 2,
    line_gap: int = 4,
) -> int:
    x, y = xy
    lines = wrap_text(draw, text, font, width)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = ellipsize(draw, lines[-1], font, width)
    for line in lines:
        draw.text((x, y), line, fill=fill, font=font)
        y += font.size + line_gap if hasattr(font, "size") else 28
    return y


def rounded_rect(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: str, outline: str | None = None, radius: int = 28, width: int = 2) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def card_price_krw(card: dict[str, Any], fx: dict[str, Any]) -> int | None:
    if isinstance(card.get("nmJpy"), (int, float)) and card["nmJpy"] > 0:
        return round(card["nmJpy"] * float(fx.get("jpyKrw") or 9.1))
    if isinstance(card.get("priceUsd"), (int, float)) and card["priceUsd"] > 0:
        return round(card["priceUsd"] * float(fx.get("usdKrw") or 1388.2))
    return None


def collect_cards(data: dict[str, Any]) -> list[dict[str, Any]]:
    fx = data.get("fx") or {}
    cards: list[dict[str, Any]] = []
    codes = list(data.get("jp", {}).get("list") or []) + list(data.get("extra", {}).get("list") or [])
    for code in codes:
        set_data = (data.get("sets") or {}).get(code) or {}
        for card in set_data.get("cards") or []:
            if not card.get("nmJpy"):
                continue
            price = card_price_krw(card, fx)
            if not price:
                continue
            key = f"{code}:{card.get('number') or card.get('name')}"
            cards.append(
                {
                    "key": key,
                    "setCode": code,
                    "setName": set_data.get("nameEn") or code,
                    "rank": card.get("rank"),
                    "name": card.get("name") or "Unknown card",
                    "number": card.get("number") or "",
                    "rarity": card.get("rarity") or "",
                    "img": card.get("img") or "",
                    "priceKrw": price,
                    "priceSource": "Japanese NM" if card.get("nmJpy") else "Reference price",
                }
            )
    return cards


def load_snapshots() -> dict[str, Any]:
    if SNAPSHOT_PATH.exists():
        return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    return {"snapshots": []}


def write_snapshot(cards: list[dict[str, Any]], today: str) -> None:
    data = load_snapshots()
    snapshots = [s for s in data.get("snapshots", []) if s.get("date") != today]
    snapshots.append(
        {
            "date": today,
            "cards": {c["key"]: {"priceKrw": c["priceKrw"], "name": c["name"], "setCode": c["setCode"], "number": c["number"]} for c in cards},
        }
    )
    snapshots = sorted(snapshots, key=lambda s: s.get("date", ""))[-32:]
    SNAPSHOT_PATH.write_text(json.dumps({"snapshots": snapshots}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def previous_snapshot(today: str) -> dict[str, Any] | None:
    snapshots = [s for s in load_snapshots().get("snapshots", []) if s.get("date") and s.get("date") < today]
    if not snapshots:
        return None
    return sorted(snapshots, key=lambda s: s.get("date", ""))[-1]


def calculate_report(cards: list[dict[str, Any]], today: str) -> dict[str, Any]:
    prev = previous_snapshot(today)
    enriched: list[dict[str, Any]] = []
    if prev:
        prev_cards = prev.get("cards") or {}
        for card in cards:
            old = (prev_cards.get(card["key"]) or {}).get("priceKrw")
            if not old or old <= 0:
                continue
            change = card["priceKrw"] - old
            pct = change / old * 100
            enriched.append({**card, "prevPriceKrw": old, "changeKrw": change, "changePct": pct})
    if enriched:
        ordered_desc = sorted(enriched, key=lambda c: (c["changePct"], c["priceKrw"]), reverse=True)
        ordered_asc = sorted(enriched, key=lambda c: (c["changePct"], -c["priceKrw"]))
        gainers = [c for c in ordered_desc if c["changePct"] > 0][:3] or ordered_desc[:3]
        fallers = [c for c in ordered_asc if c["changePct"] < 0][:3] or ordered_asc[:3]
        mode = "weekly"
    else:
        ranked = sorted(cards, key=lambda c: c["priceKrw"], reverse=True)
        gainers = ranked[:3]
        fallers = ranked[3:6]
        mode = "baseline"
    return {
        "date": today,
        "previousDate": prev.get("date") if prev else None,
        "mode": mode,
        "gainers": gainers,
        "fallers": fallers,
        "sampleSize": len(cards),
    }


def fetch_image(url: str, size: tuple[int, int]) -> Image.Image | None:
    if not url:
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "OPBoxIndexBot/1.0"})
        with urllib.request.urlopen(req, timeout=10) as res:
            img = Image.open(BytesIO(res.read())).convert("RGBA")
        img.thumbnail(size, Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", size, (0, 0, 0, 0))
        x = (size[0] - img.width) // 2
        y = (size[1] - img.height) // 2
        canvas.alpha_composite(img, (x, y))
        return canvas
    except Exception:
        return None


def draw_logo(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    rounded_rect(draw, (x, y, x + 86, y + 86), "#101827", LINE, 20)
    draw.text((x + 18, y + 17), "OP", fill=CYAN, font=FONT_34)
    draw.line((x + 18, y + 64, x + 34, y + 50, x + 52, y + 57, x + 68, y + 34), fill=YELLOW, width=5)


def draw_header(draw: ImageDraw.ImageDraw, title: str, subtitle: str, date_text: str) -> None:
    draw_logo(draw, 64, 56)
    draw.text((168, 58), "OP BOX INDEX", fill=CYAN, font=FONT_30)
    draw.text((168, 94), subtitle, fill=MUTED, font=FONT_26)
    draw.text((64, 168), title, fill=TEXT, font=FONT_54)
    draw.text((64, 232), date_text, fill=MUTED, font=FONT_26)


def draw_mover_row(base: Image.Image, draw: ImageDraw.ImageDraw, item: dict[str, Any], idx: int, y: int, positive: bool, row_h: int = 218) -> None:
    x = 64
    rounded_rect(draw, (x, y, W - 64, y + row_h), PANEL, LINE, 26)
    img = fetch_image(item.get("img") or "", (126, 174))
    if img:
        base.alpha_composite(img, (x + 22, y + 22))
    else:
        rounded_rect(draw, (x + 22, y + 28, x + 148, y + 188), "#172033", LINE, 16)
        draw.text((x + 48, y + 92), "CARD", fill=MUTED, font=FONT_26)

    color = GREEN if positive else RED
    badge = f"#{idx}"
    rounded_rect(draw, (x + 172, y + 28, x + 232, y + 70), color, None, 18)
    draw.text((x + 188, y + 35), badge, fill=BG, font=FONT_26)

    name = item["name"]
    draw_limited_text(draw, (x + 252, y + 26), name, FONT_34, TEXT, 440, 2, 4)
    meta = f"{item['setCode']} / {item.get('number') or ''} / {item.get('priceSource') or 'Price'}"
    draw.text((x + 252, y + 132), meta, fill=MUTED, font=FONT_26)
    draw.text((W - 330, y + 42), money_krw(item["priceKrw"]), fill=TEXT, font=FONT_30)
    pct = item.get("changePct")
    draw.text((W - 330, y + 90), pct_text(pct), fill=color if pct is not None else YELLOW, font=FONT_34)
    if item.get("changeKrw") is not None:
        draw.text((W - 330, y + 142), money_krw(item["changeKrw"]), fill=color, font=FONT_26)


def create_card_one(report: dict[str, Any], out_path: Path) -> None:
    img = Image.new("RGBA", (W, H), BG)
    draw = ImageDraw.Draw(img)
    draw_header(draw, "Weekly Card Movers", "Japanese NM card price references", report["date"])
    title = "Top 3 Gainers" if report["mode"] == "weekly" else "Current Top 3 Cards"
    draw.text((64, 310), title, fill=GREEN, font=FONT_42)
    for idx, item in enumerate(report["gainers"], 1):
        draw_mover_row(img, draw, item, idx, 380 + (idx - 1) * 246, True)
    note = "Weekly percentage movers start after the next Monday update." if report["mode"] == "baseline" else "Based on matched Japanese NM references."
    draw_text_box(draw, (64, 1158), note, FONT_30, MUTED, 900, 8)
    draw.text((64, 1280), "Data: OP Box Index / Yuyu-tei references / Not financial advice", fill=MUTED, font=FONT_26)
    img.convert("RGB").save(out_path, quality=94)


def create_card_two(report: dict[str, Any], out_path: Path) -> None:
    img = Image.new("RGBA", (W, H), BG)
    draw = ImageDraw.Draw(img)
    if report["mode"] == "weekly":
        draw_header(draw, "Top 3 Pullbacks", "Japanese NM card price references", report["date"])
        draw.text((64, 310), "Weekly Pullbacks", fill=RED, font=FONT_42)
        for idx, item in enumerate(report["fallers"], 1):
            draw_mover_row(img, draw, item, idx, 380 + (idx - 1) * 246, False)
        note = f"Compared with previous snapshot: {report.get('previousDate')}"
        draw_text_box(draw, (64, 1158), note, FONT_30, MUTED, 900, 8)
    else:
        draw_header(draw, "Market Note", "One Piece Card Game weekly snapshot", report["date"])
        rounded_rect(draw, (64, 326, W - 64, 790), PANEL, LINE, 32)
        y = draw_text_box(draw, (106, 376), "This is the first social snapshot.", FONT_54, TEXT, 820, 12)
        y = draw_text_box(draw, (106, y + 18), "Weekly movers start after the next Monday update.", FONT_34, MUTED, 820, 8)
        bullets = [
            "Cards are ranked from matched Japanese NM references.",
            "Bad or uncertain matches are hidden instead of shown as prices.",
        ]
        y += 48
        for bullet in bullets:
            draw.ellipse((106, y + 10, 122, y + 26), fill=CYAN)
            y = draw_text_box(draw, (142, y), bullet, FONT_30, TEXT, 780, 8) + 18
        rounded_rect(draw, (64, 845, W - 64, 1148), PANEL_2, LINE, 32)
        draw.text((106, 892), "Next expansion", fill=YELLOW, font=FONT_42)
        draw_text_box(draw, (106, 956), "After TCGplayer approval, OP Box Index will compare Japanese and English booster box markets.", FONT_34, TEXT, 820, 10)
        draw.text((106, 1088), "opboxindex.com", fill=CYAN, font=FONT_42)
    draw.text((64, 1280), "#OnePieceCardGame #OnePieceTCG #PSA10 #BoosterBox", fill=MUTED, font=FONT_26)
    img.convert("RGB").save(out_path, quality=94)


def post_text(report: dict[str, Any]) -> str:
    if report["mode"] == "weekly":
        gainers = ", ".join(f"{c['setCode']} {c['name']} {pct_text(c['changePct'])}" for c in report["gainers"])
        fallers = ", ".join(f"{c['setCode']} {c['name']} {pct_text(c['changePct'])}" for c in report["fallers"])
        return textwrap.dedent(
            f"""\
            Weekly One Piece card movers.

            Japanese NM references:
            Top gainers: {gainers}
            Top pullbacks: {fallers}

            Data: OP Box Index
            Full set view: https://opboxindex.com

            Not financial advice.
            #OnePieceCardGame #OnePieceTCG #PSA10 #BoosterBox
            """
        ).strip()
    top = ", ".join(f"{c['setCode']} {c['name']} ({money_krw(c['priceKrw'])})" for c in report["gainers"])
    return textwrap.dedent(
        f"""\
        First OP Box Index weekly card snapshot.

        Current top Japanese NM references:
        {top}

        Weekly movers start after the next Monday data update.
        Full set view: https://opboxindex.com

        Not financial advice.
        #OnePieceCardGame #OnePieceTCG #PSA10 #BoosterBox
        """
    ).strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--no-snapshot", action="store_true", help="Do not update the snapshot history file.")
    args = parser.parse_args()

    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    cards = collect_cards(data)
    report = calculate_report(cards, args.date)

    out_dir = OUT_ROOT / args.date
    out_dir.mkdir(parents=True, exist_ok=True)
    create_card_one(report, out_dir / "threads-card-1.png")
    create_card_two(report, out_dir / "threads-card-2.png")
    (out_dir / "post-en.txt").write_text(post_text(report) + "\n", encoding="utf-8")
    (out_dir / "data.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if not args.no_snapshot:
        write_snapshot(cards, args.date)

    print(
        json.dumps(
            {
                "date": args.date,
                "mode": report["mode"],
                "cards": len(cards),
                "output": str(out_dir),
                "files": ["threads-card-1.png", "threads-card-2.png", "post-en.txt", "data.json"],
                "snapshotUpdated": not args.no_snapshot,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
