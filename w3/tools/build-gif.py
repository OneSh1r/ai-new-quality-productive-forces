#!/usr/bin/env python
"""Assemble the frames written by tools/tour.js into a captioned GIF.

    python tools/build-gif.py tour/frames.json tour/visual-pandas-tour.gif

An animated GIF was chosen over MP4 because it needs no ffmpeg and plays
inline in the app. Frames are downscaled, palettised and captioned with a
Chinese line plus an English line (the same words in both languages).
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

WIDTH = 1000
CN_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
CN_REG = r"C:\Windows\Fonts\msyh.ttc"
TOP = 42
BAND = 68


def load_fonts():
    try:
        zh = ImageFont.truetype(CN_BOLD, 21)
        en = ImageFont.truetype(CN_REG, 15)
        brand = ImageFont.truetype(CN_BOLD, 14)
        counter = ImageFont.truetype(CN_REG, 13)
    except OSError:  # only on machines without Microsoft YaHei
        zh = en = brand = counter = ImageFont.load_default()
    return zh, en, brand, counter


def caption(app_img, zh_text, en_text, index, total, fonts):
    """Put the screenshot between a header strip and a caption strip.

    Padding rather than overlaying keeps the app's own header (dataset name,
    theme switch) and its status bar visible.
    """
    zh_font, en_font, brand_font, counter_font = fonts
    w, app_h = app_img.size
    img = Image.new("RGB", (w, TOP + app_h + BAND), (15, 17, 26))
    img.paste(app_img, (0, TOP))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, TOP - 2, w, TOP], fill=(79, 70, 229, 255))
    draw.text((16, 11), "可视化 Pandas · Visual Pandas", font=brand_font, fill=(236, 238, 246, 255))
    label = "%02d / %02d" % (index, total)
    tw = draw.textlength(label, font=counter_font)
    draw.text((w - 16 - tw, 13), label, font=counter_font, fill=(150, 158, 180, 255))
    y = TOP + app_h
    draw.rectangle([0, y, w, y + 2], fill=(79, 70, 229, 255))
    draw.text((18, y + 10), zh_text, font=zh_font, fill=(255, 255, 255, 255))
    draw.text((18, y + 40), en_text, font=en_font, fill=(178, 186, 208, 255))
    return img


def main():
    manifest_path = sys.argv[1] if len(sys.argv) > 1 else "tour/frames.json"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "tour/visual-pandas-tour.gif"
    with open(manifest_path, "r", encoding="utf-8") as fh:
        manifest = json.load(fh)

    root = os.path.dirname(os.path.abspath(manifest_path))
    frames = manifest["frames"]
    fonts = load_fonts()
    total_stops = len(set([f["zh"] for f in frames]))

    images, durations = [], []
    seen = {}
    for rec in frames:
        key = (rec["zh"], rec["en"])
        if key not in seen:
            seen[key] = len(seen) + 1
        src = os.path.join(root, "frames", rec["file"])
        img = Image.open(src).convert("RGB")
        ratio = WIDTH / float(img.width)
        img = img.resize((WIDTH, max(1, int(round(img.height * ratio)))), Image.LANCZOS)
        img = caption(img, rec["zh"], rec["en"], seen[key], total_stops, fonts)
        images.append(img.convert("P", palette=Image.ADAPTIVE, colors=128))
        durations.append(max(60, int(rec["hold"])))

    images[0].save(
        out_path,
        save_all=True,
        append_images=images[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )
    size = os.path.getsize(out_path) / 1024.0 / 1024.0
    print("%d frames, %.1f s, %.1f MB -> %s" % (
        len(images), sum(durations) / 1000.0, size, out_path))


if __name__ == "__main__":
    main()
