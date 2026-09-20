# -*- coding: utf-8 -*-
"""《Schat》图标：深色圆角底 + 渐变红心 + Schat 字样。"""
from PIL import Image, ImageDraw, ImageFont

def heart_mask(w, h):
    rows = []
    for py in range(h):
        y = 1.1 - 2.25 * py / (h - 1)
        xs = []
        for px in range(w):
            x = 2.4 * (px / (w - 1)) - 1.2
            v = (x * x + y * y - 1) ** 3 - x * x * (y ** 3)
            xs.append(v <= 0)
        rows.append(xs)
    return rows

def lerp(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))

def make_icon(size, out_path, radius_ratio=0.22):
    S = 1024
    img = Image.new("RGB", (S, S), (18, 16, 20))
    d = ImageDraw.Draw(img)
    top, bot = (36, 30, 38), (12, 10, 14)
    for y in range(S):
        d.line([(0, y), (S, y)], fill=lerp(top, bot, y / S))
    # 红色光晕
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for i in range(6):
        a = 16 - i * 3
        r = int(S * (0.50 - i * 0.06))
        box = (S // 2 - r, S // 2 - r - int(S*0.10), S // 2 + r, S // 2 + r - int(S*0.10))
        gd.ellipse(box, fill=(196, 40, 66, a))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
    # 心形（占上方约 70%）
    HS = 720
    hm = heart_mask(HS, HS)
    heart = Image.new("RGBA", (HS, HS), (0, 0, 0, 0))
    hp = heart.load()
    c_top, c_bot = (255, 92, 112), (150, 22, 45)
    for py, row in enumerate(hm):
        for px_i, inside in enumerate(row):
            if inside:
                hp[px_i, py] = lerp(c_top, c_bot, py / HS) + (255,)
    # 高光
    hi = Image.new("RGBA", (HS, HS), (0, 0, 0, 0))
    ImageDraw.Draw(hi).ellipse((int(HS*0.30), int(HS*0.20), int(HS*0.52), int(HS*0.42)), fill=(255, 200, 210, 95))
    heart = Image.alpha_composite(heart, hi)
    img.paste(heart, ((S - HS) // 2, 40), heart)
    # Schat 字样
    font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 150)
    d = ImageDraw.Draw(img)
    tw = d.textlength("Schat", font=font)
    tx = (S - tw) / 2
    ty = int(S * 0.795)
    d.text((tx + 4, ty + 5), "Schat", font=font, fill=(30, 20, 24))       # 阴影
    d.text((tx, ty), "Schat", font=font, fill=(239, 227, 206))            # 暖白
    # 圆角裁切 + 细金边
    radius = int(S * radius_ratio)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S, S], radius=radius, fill=255)
    img.putalpha(mask)
    edge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle([3, 3, S - 4, S - 4], radius=radius - 2, outline=(212, 175, 105, 70), width=4)
    img = Image.alpha_composite(img, edge)
    img = img.resize((size, size), Image.LANCZOS)
    bg = Image.new("RGB", (size, size), (18, 16, 20))
    bg.paste(img, (0, 0), img)
    bg.save(out_path, "PNG")
    print("saved", out_path)

for s in (512, 192, 180):
    make_icon(s, f"icons/icon-{s}.png")
make_icon(180, "icons/apple-touch-icon.png")
