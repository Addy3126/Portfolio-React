# Packs a scanned model's maps for the scene (called by simplify-scans.mjs):
#   python3 -I tools/pack-scan-maps.py diff.jpg arm.jpg|- nor_gl.jpg <out prefix>
# Writes <prefix>_c.webp (albedo: colour kept but 40% desaturated and normalised to mean
# 0.5, so the material tint sets the overall tone while the rock's own warm/cool variation
# shows), <prefix>_orm.webp (R = AO, G = roughness) and <prefix>_n.webp.
import sys
import numpy as np
from PIL import Image

diff, arm, nor, prefix = sys.argv[1:5]
rgb = np.asarray(Image.open(diff).convert('RGB')).astype(np.float32) / 255
lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
rgb = lum[..., None] + (rgb - lum[..., None]) * 0.6
m, sd = lum.mean(), lum.std()
rgb = 0.5 + (rgb - m) * (0.25 / (sd + 1e-3))  # mean 0.5, contrast normalised
rgb = np.clip(rgb, 0, 1)
Image.fromarray((rgb * 255).astype(np.uint8)).save(f'{prefix}_c.webp', quality=82, method=6)
if arm != '-':
    a = np.asarray(Image.open(arm).convert('RGB'))
    orm = np.stack([a[..., 0], a[..., 1], np.zeros_like(a[..., 0])], -1)
else:
    orm = np.zeros(rgb.shape, np.uint8); orm[..., 0] = 255; orm[..., 1] = 200
Image.fromarray(orm).save(f'{prefix}_orm.webp', quality=82, method=6)
Image.open(nor).convert('RGB').save(f'{prefix}_n.webp', quality=88, method=6)
