#!/usr/bin/env python3
"""First Threads post asset for OP Box Index.

One-off launch card: the most expensive JAPANESE (JP) sealed One Piece booster
boxes, July 2026. Values are FIXED (verified by the owner) — this script never
computes or invents prices, and shows NO month-over-month change (no June data).

Brand tone follows og-image.png: black background, mint accent, OP logo.
Output: social/first-post/{threads-card-1.png, post-en.txt, data.json}
"""

from __future__ import annotations

import json
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "social" / "first-post"

W, H = 1080, 1350
BG = "#070a10"
PANEL = "#101722"
LINE = "#263244"
TEXT = "#f2f6ff"
MUTED = "#9ca9bf"
CYAN = "#19e6c1"  # mint accent
INK = "#04120f"  # dark ink on mint badges

# FIXED, owner-verified data. Japanese sealed booster boxes, July 2026 (USD).
# DO NOT edit values here without owner confirmation. No change/% shown by design.
ITEMS = [
    {"rank": 1, "code": "OP-01", "name": "Romance Dawn", "price": "$350",
     "img": "https://tcgplayer-cdn.tcgplayer.com/product/450086_400w.jpg"},
    {"rank": 2, "code": "OP-06", "name": "Wings of the Captain", "price": "$200",
     "img": "https://tcgplayer-cdn.tcgplayer.com/product/515080_400w.jpg"},
    {"rank": 3, "code": "PRB-01", "name": "Premium Booster", "price": "$185",
     "img": "https://tcgplayer-cdn.tcgplayer.com/product/545399_400w.jpg"},
]

POST_TEXT = (
    "Most expensive Japanese One Piece booster boxes right now \U0001f3f4‍☠️ (July 2026)\n"
    "1. OP-01 Romance Dawn — $350\n"
    "2. OP-06 Wings of the Captain — $200\n"
    "3. PRB-01 Premium Booster — $185\n"
    "The very first set still tops the chart. (Japanese sealed boxes)\n"
    "Live prices → opboxindex.com"
)

FOOTER = "Japanese sealed · July 2026 · Live market data"


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


F26 = load_font(26)
F28 = load_font(28)
F30 = load_font(30, True)
F34 = load_font(34, True)
F44 = load_font(44, True)
F58 = load_font(58, True)
F64 = load_font(64, True)


def rrect(draw, box, fill, outline=None, radius=26, width=2):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def right_text(draw, xy_right, text, font, fill):
    x_right, y = xy_right
    w = draw.textbbox((0, 0), text, font=font)[2]
    draw.text((x_right - w, y), text, fill=fill, font=font)


def fetch_image(url, size):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "OPBoxIndexBot/1.0"})
        with urllib.request.urlopen(req, timeout=15) as res:
            img = Image.open(BytesIO(res.read())).convert("RGBA")
        img.thumbnail(size, Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", size, (0, 0, 0, 0))
        canvas.alpha_composite(img, ((size[0] - img.width) // 2, (size[1] - img.height) // 2))
        return canvas
    except Exception as exc:  # noqa: BLE001
        print("image fetch failed:", url, exc)
        return None


def draw_logo(draw, x, y):
    rrect(draw, (x, y, x + 86, y + 86), "#101827", LINE, 20)
    draw.text((x + 18, y + 17), "OP", fill=CYAN, font=F34)
    draw.line((x + 18, y + 64, x + 34, y + 50, x + 52, y + 57, x + 68, y + 34), fill=CYAN, width=5)


def build_card(out_path: Path) -> None:
    img = Image.new("RGBA", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Header
    draw_logo(draw, 64, 56)
    draw.text((168, 58), "OP BOX INDEX", fill=CYAN, font=F30)
    draw.text((168, 96), "Japanese (JP) sealed booster boxes", fill=MUTED, font=F26)

    # JP SEALED pill (top-right) — makes Japanese scope explicit
    pill = "JP SEALED"
    pw = draw.textbbox((0, 0), pill, font=F26)[2] + 40
    rrect(draw, (W - 64 - pw, 60, W - 64, 108), CYAN, None, 24)
    draw.text((W - 64 - pw + 20, 68), pill, fill=INK, font=F26)

    # Title
    draw.text((64, 180), "Most expensive", fill=TEXT, font=F58)
    draw.text((64, 250), "Japanese sealed boxes", fill=CYAN, font=F58)
    draw.text((64, 326), "July 2026", fill=MUTED, font=F30)

    # Rows
    row_h = 230
    top0 = 392
    gap = 46
    for i, it in enumerate(ITEMS):
        y = top0 + i * (row_h + gap)
        rrect(draw, (64, y, W - 64, y + row_h), PANEL, LINE, 26)

        # box image
        pic = fetch_image(it["img"], (150, 190))
        if pic:
            img.alpha_composite(pic, (92, y + 20))
        else:
            rrect(draw, (92, y + 20, 242, y + 210), "#172033", LINE, 16)

        # rank badge
        rrect(draw, (270, y + 28, 330, y + 72), CYAN, None, 18)
        draw.text((288, y + 34), f"#{it['rank']}", fill=INK, font=F26)

        # set code + name
        draw.text((344, y + 30), it["code"], fill=CYAN, font=F30)
        draw.text((344, y + 78), it["name"], fill=TEXT, font=F44)
        draw.text((344, y + 150), "Japanese sealed booster box", fill=MUTED, font=F26)

        # price
        right_text(draw, (W - 100, y + 78), it["price"], F64, TEXT)

    # Footer
    draw.line((64, 1244, W - 64, 1244), fill=LINE, width=2)
    draw.text((64, 1272), FOOTER, fill=MUTED, font=F28)
    right_text(draw, (W - 64, 1272), "opboxindex.com", F28, CYAN)

    img.convert("RGB").save(out_path, quality=95)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    build_card(OUT_DIR / "threads-card-1.png")
    (OUT_DIR / "post-en.txt").write_text(POST_TEXT + "\n", encoding="utf-8")
    (OUT_DIR / "data.json").write_text(
        json.dumps(
            {
                "scope": "Japanese (JP) sealed booster boxes",
                "period": "July 2026",
                "currency": "USD",
                "note": "Fixed owner-verified values. No month-over-month change (no June data).",
                "items": ITEMS,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print("written:", OUT_DIR)


if __name__ == "__main__":
    main()
