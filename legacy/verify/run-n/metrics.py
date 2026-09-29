from PIL import Image
from pathlib import Path
import json, math, hashlib
im=Image.open('verify/pass-default.png').convert('RGB')
regions={'floor':(1250,1400,2350,1530),'background':(1800,220,2450,460)}
result={'image':'verify/pass-default.png','size':im.size,'regions':{}}
for name,box in regions.items():
 pixels=list(im.crop(box).getdata()); rgb=[sum(p[c] for p in pixels)/len(pixels) for c in range(3)]
 result['regions'][name]={'rectangle':box,'meanRGB':rgb,'meanHex':'#'+''.join(f'{round(v):02x}' for v in rgb)}
lines=Path('verify/run-n/runtime.txt').read_text().splitlines()
for key in ['Spill','Settling 3–4 seconds (all rendered poses)','Native sleep at five seconds','Settling 8–10 seconds','Idle performance','Shattered performance','Run N pristine launch']:
 line=next(l for l in lines if l.startswith(key+': ')); value=json.loads(line[len(key)+2:]);result[key]=value['spillFlow'] if key=='Spill' else value
result['lamp']={'head':[-2.65,6.1,-2.3],'target':[0,1.25,0],'direction':[-.44268231206203107,.8101921560380568,-.38421483688402697],'elevationDegrees':math.degrees(math.asin(.8101921560380568))}
Path('verify/run-n/metrics.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
