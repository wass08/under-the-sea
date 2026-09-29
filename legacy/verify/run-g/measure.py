from PIL import Image
import numpy as np,json

def image_lum(path):
 a=np.asarray(Image.open(path).convert('RGB'))/255
 a=np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)
 return a[:,:,0]*.2126+a[:,:,1]*.7152+a[:,:,2]*.0722
before=image_lum('verify/run-g/before/pass-front.png');after=image_lum('verify/pass-front.png')
f=json.load(open('verify/run-g/facets.json'))['facets'];edges={};pairs=[]
for a in f:
 if a['facing']<=0 or not(.65<a['center'][1]<2.0) or a['center'][2]<.25:continue
 x,y=map(round,a['pixel']);a['before']=float(before[y-2:y+3,x-2:x+3].mean());a['after']=float(after[y-2:y+3,x-2:x+3].mean())
 verts=[tuple(round(v,5) for v in p) for p in a['vertices']]
 for k in range(3):
  edge=tuple(sorted([verts[k],verts[(k+1)%3]]))
  if edge in edges:
   b=edges[edge]
   if a['biome']==b['biome'] and max(a['light'],b['light'])>.2 and min(a['light'],b['light'])<.15 and np.linalg.norm(np.array(a['pixel'])-b['pixel'])>4:
    pairs.append([abs(a['light']-b['light']),a,b])
  edges[edge]=a
pairs.sort(reverse=True,key=lambda x:x[0])
for _,a,b in pairs[:15]: print(a['id'],b['id'],'sun',round(a['light'],2),round(b['light'],2),'pixels',np.round(a['pixel']).tolist(),np.round(b['pixel']).tolist(),'before',a['before'],b['before'],'after',a['after'],b['after'])
json.dump(pairs,open('verify/run-g/pairs.json','w'),indent=2)
