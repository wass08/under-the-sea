from pathlib import Path
from PIL import Image, ImageChops

def compare(label, before, after, crop=None):
    a, b = [Image.open(p).convert('RGB') for p in (before, after)]
    assert a.size == b.size
    d = ImageChops.difference(a,b)
    if crop: d = d.crop(crop)
    px=list(d.getdata())
    return f'{label}: changed={sum(any(p) for p in px)}/{len(px)}, MAE={sum(sum(p) for p in px)/(len(px)*3):.9f}, max={max(max(p) for p in px)}'

root=Path('verify/sine-caustics')
lines=[]
for level in (2,3):
    for baseline in ('before','baseline-run'):
        lines.append(compare(f'L{level} full PNG ({baseline})',root/baseline/f'caustics-L{level}.png',root/'after'/f'caustics-L{level}.png'))
    lines.append(compare(f'L{level} frozen canvas incl. FPS',root/'before'/f'frozen-L{level}.png',root/f'frozen-L{level}.png'))
    # Exclude header/FPS and footer overlays, retaining the entire rendered sand/water.
    lines.append(compare(f'L{level} frozen scene, canvas crop (0,120,1280,950)',root/'before'/f'frozen-L{level}.png',root/f'frozen-L{level}.png',(0,120,1280,950)))
lines.append(compare('L1 motion, same scene crop',root/'L1-frozen.png',root/'L1-moved.png',(0,120,1280,950)))
output='\n'.join(lines)+'\n'
(root/'pixel-diff.txt').write_text(output)
print(output,end='')
