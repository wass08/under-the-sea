"""Recompute rendered colour/physics/flow evidence after verify/runtime.mjs."""
from PIL import Image
from pathlib import Path
import json
im = Image.open('verify/pass-default.png').convert('RGB')
result = {}
for name, box in {'floor': (1250,1400,2350,1530), 'background': (1800,220,2450,460)}.items():
    pixels = list(im.crop(box).getdata())
    rgb = [sum(p[c] for p in pixels) / len(pixels) for c in range(3)]
    result[name] = {'rectangle': box, 'meanRGB': rgb, 'meanHex': '#' + ''.join(f'{round(v):02x}' for v in rgb)}
keys = ['Underwater contrast and saturation', 'Run O pristine launch', 'Settling 3–4 seconds (all rendered poses)', 'Native sleep at five seconds', 'Settling 8–10 seconds', 'Idle performance', 'Shattered performance', 'Spill']
for line in Path('verify/run-o/runtime.txt').read_text().splitlines():
    if ': ' not in line:
        continue
    key, value = line.split(': ', 1)
    if key in keys:
        parsed = json.loads(value)
        result[key] = parsed['spillFlow'] if key == 'Spill' else parsed
Path('verify/run-o/metrics.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
