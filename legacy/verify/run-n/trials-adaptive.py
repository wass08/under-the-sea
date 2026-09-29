import subprocess,os,json,concurrent.futures
cases=[(spread,drag) for spread in [.3,.6,.85,.95] for drag in [.1,1,2,3]]
def run(case):
 spread,drag=case; name=f'-f{spread}-l{drag}'; env=dict(os.environ,PROFILE_TRIAL=json.dumps(dict(flat=spread,lowDrag=drag)),TRIAL_NAME=name)
 with open('verify/run-n/trial'+name+'.txt','w') as f: subprocess.run(['node','verify/run-n/probe.mjs','after'],env=env,stdout=f,stderr=f)
 rs=json.load(open('verify/run-n/after'+name+'-physics.json'))
 passes=[r['window3to4']['maxDisplacement']<.002 and r['window3to4']['maxRotation']<.01 and r['awake5']==0 for r in rs]
 print(name,sum(passes),passes,flush=True)
 return dict(spread=spread,drag=drag,passes=passes,results=[dict(name=r['name'],rest=r['window3to4'],awake5=r['awake5']) for r in rs])
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: results=list(pool.map(run,cases))
json.dump(results,open('verify/run-n/trials-adaptive.json','w'),indent=2)
