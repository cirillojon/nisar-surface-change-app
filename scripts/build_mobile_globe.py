"""Bake the mobile globe's palette and cloud density from the shipped maps.

Run with NumPy and Pillow. The desktop textures are also the source assets.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image


FRONTEND = Path(__file__).resolve().parents[1] / "frontend"
EARTH = FRONTEND / "public" / "earth"
SOURCE = EARTH / "world-v2"
OUTPUT = EARTH / "mobile"
SIZE = 2048


def read_rgb(filename):
    with Image.open(SOURCE / filename) as image:
        return np.asarray(image.convert("RGB"), dtype=np.float32) / 255


def linear(rgb):
    return np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)


def encode_rgb(rgb):
    rgb = np.clip(rgb, 0, 1)
    srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - 0.055)
    return np.rint(srgb * 255).astype(np.uint8)


def mip(image, step):
    height, width, channels = image.shape
    return image.reshape(height // step, step, width // step, step, channels).mean(axis=(1, 3))


def sample(image, u, v):
    """Bilinear map lookup with repeat at the dateline and clamp at the poles."""
    height, width, _ = image.shape
    x = u * width - 0.5
    y = np.clip(v * height - 0.5, 0, height - 1)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    x_blend = (x - x0)[None, :, None]
    y_blend = (y - y0)[:, None, None]
    x1 = (x0 + 1) % width
    x0 %= width
    y1 = np.minimum(y0 + 1, height - 1)
    top = image[y0[:, None], x0] * (1 - x_blend) + image[y0[:, None], x1] * x_blend
    bottom = image[y1[:, None], x0] * (1 - x_blend) + image[y1[:, None], x1] * x_blend
    return top * (1 - y_blend) + bottom * y_blend


def centers(count, total, offset=0):
    return (offset + np.arange(count, dtype=np.float32) + 0.5) / total


def write_color(filename, fine, ocean, water, palette, broad):
    # Match the original compact shader's color blend in linear light.
    grade = np.clip((palette + 0.008) / (broad + 0.008), 0.28, 2.8)
    snow = np.clip((fine.min(axis=2, keepdims=True) - 0.45) / 0.25, 0, 1)
    snow = snow * snow * (3 - 2 * snow)
    land = fine * ((1 - snow) * grade + snow * np.array([0.96, 0.99, 1.04], dtype=np.float32))
    rgb = land * (1 - water) + ocean * water
    Image.fromarray(encode_rgb(rgb)).save(OUTPUT / filename, quality=94, method=6)


def main():
    OUTPUT.mkdir(exist_ok=True)
    albedo = linear(read_rgb(f"albedo-{SIZE}.webp"))
    detail = linear(read_rgb(f"detail-{SIZE}.webp"))
    water = read_rgb(f"water-{SIZE}.webp")[:, :, :1]
    palette = mip(albedo, 16)
    detail_mip4 = mip(detail, 16)
    detail_mip5 = mip(detail, 32)

    def bake(filename, fine, ocean, mask, u, v):
        broad = 0.5 * (sample(detail_mip4, u, v) + sample(detail_mip5, u, v))
        write_color(filename, fine, ocean, mask, sample(palette, u, v), broad)

    height = SIZE // 2
    bake(f"surface-{SIZE}.webp", detail, albedo, water, centers(SIZE, SIZE), centers(height, height))

    crops = json.loads((FRONTEND / "src/platform/earth/regional-crops.json").read_text(encoding="utf-8"))
    for region, (left, top, width, height) in crops["regions"].items():
        filename = f"{region}-detail.webp"
        fine = linear(read_rgb(filename))
        if fine.shape[:2] != (height, width):
            raise ValueError(f"{filename} has dimensions that differ from its crop bounds")
        u = centers(width, crops["sourceWidth"], left)
        v = centers(height, crops["sourceHeight"], top)
        bake(filename, fine, sample(albedo, u, v), sample(water, u, v), u, v)

    cloud_field = read_rgb(f"clouds-{SIZE}.webp")[:, :, 0]
    cloud_detail = read_rgb(f"cloud-detail-{SIZE}.webp")[:, :, 0]
    density = np.rint((0.35 * cloud_field + 0.65 * cloud_detail) * 255).astype(np.uint8)
    Image.fromarray(density).save(OUTPUT / f"clouds-{SIZE}.webp", quality=94, method=6)


if __name__ == "__main__":
    main()
