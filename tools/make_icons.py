#!/usr/bin/env python3
"""PWAアイコン(icon-192/512, maskable-512)をPillowで生成する。"""
import os

from PIL import Image, ImageDraw

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(ROOT, "icons")
GREEN = (47, 111, 79, 255)
GREEN_DARK = (31, 77, 54, 255)
WHITE = (255, 255, 255, 255)


def draw_document(draw, cx, cy, scale):
    w, h = 120 * scale, 150 * scale
    x0, y0 = cx - w / 2, cy - h / 2
    fold = 30 * scale
    draw.polygon([
        (x0, y0), (x0 + w - fold, y0), (x0 + w, y0 + fold),
        (x0 + w, y0 + h), (x0, y0 + h),
    ], fill=WHITE)
    draw.polygon([(x0 + w - fold, y0), (x0 + w, y0 + fold), (x0 + w - fold, y0 + fold)], fill=(224, 230, 226, 255))
    line_y = y0 + h * 0.42
    for i in range(3):
        draw.rounded_rectangle(
            [x0 + 16 * scale, line_y + i * 22 * scale, x0 + w - 16 * scale, line_y + i * 22 * scale + 10 * scale],
            radius=5 * scale, fill=(150, 170, 158, 255),
        )


def make(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if maskable:
        draw.rectangle([0, 0, size, size], fill=GREEN)
        draw_document(draw, size / 2, size / 2, scale=size / 512 * 0.72)
    else:
        pad = size * 0.06
        draw.rounded_rectangle([pad, pad, size - pad, size - pad], radius=size * 0.22, fill=GREEN)
        draw_document(draw, size / 2, size / 2, scale=size / 512)
    return img


os.makedirs(OUT, exist_ok=True)
make(192).save(os.path.join(OUT, "icon-192.png"))
make(512).save(os.path.join(OUT, "icon-512.png"))
make(512, maskable=True).save(os.path.join(OUT, "maskable-512.png"))
print("icons written to", OUT)
