# Packs a scanned model's maps for the scene (called by simplify-scans.mjs):
#   python3 -I tools/pack-scan-maps.py diff.jpg arm.jpg nor_gl.jpg <out prefix>
# Writes <prefix>_c.webp (grey albedo normalised to mean 0.5, so the scene's palette sets
# the colour), <prefix>_orm.webp (R = AO, G = roughness) and <prefix>_n.webp.
import sys
import numpy as np
from PIL import Image

diff, arm, nor, prefix = sys.argv[1:5]
lum = np.asarray(Image.open(diff).convert('L')).astype(np.float32)
lum = np.clip(0.5 + (lum - lum.mean()) / (lum.std() * 4 + 1e-3), 0, 1) * 255
a = np.asarray(Image.open(arm).convert('RGB'))
Image.fromarray(lum.astype(np.uint8)).save(f'{prefix}_c.webp', quality=82, method=6)
Image.fromarray(np.stack([a[..., 0], a[..., 1], np.zeros_like(a[..., 0])], -1)).save(f'{prefix}_orm.webp', quality=82, method=6)
Image.open(nor).convert('RGB').save(f'{prefix}_n.webp', quality=88, method=6)
