# 아티클별 전용 OG 이미지(1200x630) 생성 — 다크 배경 + 헤드라인 수치 + 타이틀 + 브랜드
# Run: python tools/make_og_images.py  → og/*.png
from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "og")
os.makedirs(OUT, exist_ok=True)

F_BOLD = "C:/Windows/Fonts/segoeuib.ttf"
F_REG = "C:/Windows/Fonts/segoeui.ttf"

BG = (10, 12, 16)
TEAL = (80, 218, 217)
GOLD = (255, 219, 60)
WHITE = (238, 242, 255)
MUTED = (150, 158, 176)
LINE = (38, 44, 56)

SPECS = [
    ("og-jp-vs-en.png", "1.3x – 7.4x", TEAL,
     "The English premium over Japanese boxes,", "tracked weekly for 6 months — every set.",
     "JAPANESE vs ENGLISH BOX PRICES · JULY 2026"),
    ("og-psa-supply.png", "99,646", GOLD,
     "One Piece cards graded by PSA in 6 weeks.", "Weekly destruction data for all 21 sets.",
     "PSA GRADING vs SEALED SUPPLY · JULY 2026"),
    ("og-set-list.png", "OP-01 → OP-17", TEAL,
     "Every set with JP + EN release dates", "and current sealed box prices.",
     "SET LIST & RELEASE DATES · UPDATED JULY 2026"),
    ("og-packs-msrp.png", "24 packs", GOLD,
     "What's inside a One Piece booster box:", "packs, cards and official MSRPs explained.",
     "BOOSTER BOX BASICS"),
    ("og-sea-prices.png", "PH·SG·MY·ID·TH", TEAL,
     "Box prices in your currency, and the", "Asia English edition explained.",
     "SOUTHEAST ASIA PRICE GUIDE · JULY 2026"),
    ("og-compare.png", "21 boxes", GOLD,
     "Every Japanese One Piece booster box", "ranked side by side, updated daily.",
     "COMPARE ALL BOOSTER BOXES"),
]

def make(fname, stat, stat_color, line1, line2, eyebrow):
    img = Image.new("RGB", (1200, 630), BG)
    d = ImageDraw.Draw(img)
    # 상단 브랜드 바
    d.rectangle([0, 0, 1200, 6], fill=TEAL)
    f_eyebrow = ImageFont.truetype(F_BOLD, 30)
    f_stat = ImageFont.truetype(F_BOLD, 130)
    f_body = ImageFont.truetype(F_REG, 44)
    f_brand = ImageFont.truetype(F_BOLD, 36)
    f_small = ImageFont.truetype(F_REG, 26)
    d.text((80, 78), eyebrow, font=f_eyebrow, fill=MUTED)
    d.text((76, 150), stat, font=f_stat, fill=stat_color)
    d.text((80, 340), line1, font=f_body, fill=WHITE)
    d.text((80, 400), line2, font=f_body, fill=WHITE)
    d.line([80, 500, 1120, 500], fill=LINE, width=2)
    # 브랜드
    d.rounded_rectangle([80, 528, 148, 580], radius=12, fill=TEAL)
    d.text((96, 536), "OP", font=f_brand, fill=BG)
    d.text((166, 532), "OP Box Index", font=f_brand, fill=WHITE)
    d.text((166 + 240, 542), "opboxindex.com — data, not hype", font=f_small, fill=MUTED)
    img.save(os.path.join(OUT, fname), optimize=True)
    print("saved", fname)

for spec in SPECS:
    make(*spec)
print("done")
