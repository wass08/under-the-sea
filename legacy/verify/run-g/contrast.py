"""Fixed 5x5 samples at adjacent rock-face centroids, in the 2880x1620 PNG.
Faces 1916 (lit) and 2096 (sun-facing dot < 0) share an edge. Both are biome 2.
Their centroid camera rays were checked against the complete triangle mesh.
"""
from PIL import Image
import json

def luminance(path, x, y):
    image = Image.open(path).convert('RGB')
    values = []
    for py in range(y - 2, y + 3):
        for px in range(x - 2, x + 3):
            rgb = [c / 255 for c in image.getpixel((px, py))]
            linear = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb]
            values.append(sum(c * w for c, w in zip(linear, [.2126, .7152, .0722])))
    return sum(values) / len(values)

result = {'method': 'Mean linear sRGB relative luminance (Rec.709 weights), 5x5 pixels', 'lit': {'face': 1916, 'pixel': [1924, 979]}, 'dark': {'face': 2096, 'pixel': [1937, 991]}}
for label, path in [('before', 'verify/run-g/before/pass-front.png'), ('after', 'verify/pass-front.png')]:
    lit = luminance(path, 1924, 979)
    dark = luminance(path, 1937, 991)
    result[label] = {'lit': lit, 'dark': dark, 'ratio': lit / dark}
result['ablation_before'] = {}
for mode in ['all', 'no-shafts', 'no-volume', 'no-surface', 'no-glass', 'opaque']:
    path = f'verify/run-g/before/{mode}.png'
    lit, dark = luminance(path, 1924, 979), luminance(path, 1937, 991)
    result['ablation_before'][mode] = {'lit': lit, 'dark': dark, 'ratio': lit / dark}
print(json.dumps(result, indent=2))
open('verify/run-g/contrast.json', 'w').write(json.dumps(result, indent=2))
assert result['after']['ratio'] >= 1.6
