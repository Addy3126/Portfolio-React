# Pack Poly Haven 2K maps (diff, arm, nor_gl, disp JPGs) into two textures per set, at
# 2K, 1K and 512 (the scene picks one by quality tier):
#   python3 -I tools/pack-textures.py <raw dir> public/textures <set names...>
# Two textures per set:
#   <name>_s_<res>.webp : R = albedo luminance (normalised), G = roughness, B = AO
#   <name>_n_<res>.webp : R,G = normal xy (GL), B = height
import sys, os
from PIL import Image, ImageOps
import numpy as np
raw, out = sys.argv[1], sys.argv[2]
names = sys.argv[3:]
for n in names:
    d = Image.open(f'{raw}/{n}_diff_2k.jpg').convert('RGB')
    arm = Image.open(f'{raw}/{n}_arm_2k.jpg').convert('RGB')
    nor = Image.open(f'{raw}/{n}_nor_gl_2k.jpg').convert('RGB')
    disp = Image.open(f'{raw}/{n}_disp_2k.jpg').convert('L')
    lum = np.asarray(d.convert('L')).astype(np.float32)
    # Normalise luminance to mean 0.5 so tinting keeps the scene palette.
    lum = np.clip(0.5 + (lum - lum.mean()) / (lum.std() * 4 + 1e-3), 0, 1) * 255
    a = np.asarray(arm)
    s = np.stack([lum.astype(np.uint8), a[..., 1], a[..., 0]], -1)
    nn = np.asarray(nor)
    h = np.asarray(disp.resize(nor.size))
    nm = np.stack([nn[..., 0], nn[..., 1], h], -1)
    os.makedirs(out, exist_ok=True)
    for res, q in ((2048, 82), (1024, 80), (512, 80)):
        tag = {2048: '2k', 1024: '1k', 512: '512'}[res]
        Image.fromarray(s).resize((res, res), Image.LANCZOS).save(f'{out}/{n}_s_{tag}.webp', quality=q, method=6)
        Image.fromarray(nm).resize((res, res), Image.LANCZOS).save(f'{out}/{n}_n_{tag}.webp', quality=q + 6, method=6)
    print(n)

# Boulder models (tools/simplify-boulders.mjs) use three's standard maps instead:
#   public/models/<name>_c.webp (grey albedo, mean 0.5), <name>_orm.webp (R = AO,
#   G = roughness), <name>_n.webp (OpenGL normal map), all 1K.
