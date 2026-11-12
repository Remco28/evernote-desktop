#!/usr/bin/env python3
"""Clean a flat two-colour raster logo (green silhouette + white details, transparent background)
and trace it into a crisp SVG: assets/icon.svg.

Dev-only tooling. Needs: pip install numpy scipy pillow potracer
Usage: python3 scripts/vectorize-logo.py assets/source/logo.png [--green #RRGGBB]

Steps: threshold the (noisy) alpha -> drop specks -> split into green/white layers -> smooth ->
potrace each layer -> SVG with the white layer stacked on the green one, padded and squared."""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import potrace

src = sys.argv[1]
green_override = sys.argv[sys.argv.index("--green") + 1] if "--green" in sys.argv else None
out_svg = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "icon.svg")

rgba = np.array(Image.open(src).convert("RGBA")).astype(np.int32)
R, G, B, A = (rgba[..., i] for i in range(4))

# 1. Silhouette: anything reasonably opaque. The faint low-alpha haze around the edges is dropped here.
mask = A >= 128

# 2. Remove specks: keep components bigger than 0.05% of the largest one.
lab, n = ndi.label(mask)
areas = ndi.sum(mask, lab, range(1, n + 1))
keep = np.isin(lab, [i + 1 for i, a in enumerate(areas) if a >= max(200, 0.0005 * areas.max())])
mask = keep  # real gaps (between legs, inside the trunk curl) stay transparent: don't fill holes

# 3. Colours. Green = median of confidently-green pixels; white = the light details.
solid = mask & (A >= 240)
greenish = solid & (R < 90) & (G > 120)
green_rgb = np.median(rgba[greenish][:, :3], axis=0).astype(int)
green_hex = green_override or "#%02X%02X%02X" % tuple(green_rgb)
white = mask & (R > 150) & (G > 150) & (B > 150)

# 4. Smooth both layers (kills pixel jaggies from the raster) and re-threshold.
def smooth(m, sigma):
    return ndi.gaussian_filter(m.astype(np.float32), sigma) > 0.5

mask_s = smooth(mask, 1.6)
white_s = smooth(white, 1.6) & mask_s
# drop tiny white flecks
lab, n = ndi.label(white_s)
if n:
    ar = ndi.sum(white_s, lab, range(1, n + 1))
    white_s = np.isin(lab, [i + 1 for i, a in enumerate(ar) if a >= 150])

# 5. Crop to the silhouette and pad to a square canvas.
ys, xs = np.where(mask_s)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
side = max(y1 - y0, x1 - x0)
pad = int(side * 0.06)
S = side + 2 * pad
oy = pad + (side - (y1 - y0)) // 2 - y0
ox = pad + (side - (x1 - x0)) // 2 - x0

def trace(layer):
    canvas = np.zeros((S, S), dtype=bool)
    canvas[oy + y0: oy + y1, ox + x0: ox + x1] = layer[y0:y1, x0:x1]
    bm = potrace.Bitmap(~canvas)  # potracer traces the False pixels, so invert
    plist = bm.trace(turdsize=30, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
                     alphamax=1.1, opticurve=True, opttolerance=0.3)
    d = []
    for curve in plist:
        s = curve.start_point
        d.append(f"M{s.x:.1f},{s.y:.1f}")
        for seg in curve.segments:
            if seg.is_corner:
                d.append(f"L{seg.c.x:.1f},{seg.c.y:.1f}L{seg.end_point.x:.1f},{seg.end_point.y:.1f}")
            else:
                d.append(f"C{seg.c1.x:.1f},{seg.c1.y:.1f} {seg.c2.x:.1f},{seg.c2.y:.1f} {seg.end_point.x:.1f},{seg.end_point.y:.1f}")
        d.append("Z")
    return "".join(d)

svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">
  <path fill="{green_hex}" fill-rule="evenodd" d="{trace(mask_s)}"/>
  <path fill="#FFFFFF" fill-rule="evenodd" d="{trace(white_s)}"/>
</svg>
"""
open(out_svg, "w").write(svg)
print(f"wrote {os.path.normpath(out_svg)}  canvas={S}px  green={green_hex}  svg={len(svg)//1024}KB")
