"""Metadata inventory only; never delete, stage or upload inherited evidence."""
from pathlib import Path
import subprocess,json
root=Path(__file__).resolve().parents[1];out=root/'docs/nexus-p1-6-2/evidence';out.mkdir(parents=True,exist_ok=True)
def category(name):
    if name.startswith('public/'):return 'runtime-asset'
    if name.startswith('src/data/'):return 'map-dataset'
    if name.endswith('.pcm'):return 'test-audio-fixture'
    if name.startswith(('.review/','test-results/')):return 'local-debug-evidence'
    if name.startswith('docs/'):return 'review-evidence'
    return 'other-large-file'
tracked=[]
for record in subprocess.check_output(['git','ls-tree','-r','-l','-z','HEAD'],cwd=root).split(b'\0'):
    if not record:continue
    header,path=record.split(b'\t',1);parts=header.decode().split();size=int(parts[3]);name=path.decode()
    if size>=1000000 or name.lower().endswith(('.mp4','.webm','.zip','.pcm','.trace','.patch')):
        tracked.append({'path':name,'bytes':size,'gitBlob':parts[2],'category':category(name),'extension':Path(name).suffix,'alreadyInBaselineHistory':True})
local=[]
objects=subprocess.check_output(['git','rev-list','--objects','HEAD','--not','--remotes'],cwd=root,text=True).splitlines()
names={line.split(' ',1)[0]:line.split(' ',1)[1]if' 'in line else''for line in objects}
info=subprocess.run(['git','cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],cwd=root,input='\n'.join(names)+('\n' if names else ''),text=True,capture_output=True,check=True).stdout
unpublished=[]
for line in info.splitlines():
    sha,kind,size=line.split();name=names[sha]
    if kind=='blob'and(int(size)>=1000000 or Path(name).suffix.lower()in['.webm','.mp4','.zip','.pcm','.patch']):
        unpublished.append({'path':name,'bytes':int(size),'gitBlob':sha,'category':category(name)})
for directory in [root/'.review',root/'test-results']:
    if not directory.exists():continue
    for p in directory.rglob('*'):
        if p.is_file():
            size=p.stat().st_size
            if size>=1000000 or p.suffix.lower()in['.mp4','.webm','.zip','.pcm','.patch']:
                local.append({'path':str(p.relative_to(root)),'bytes':size,'category':category(str(p.relative_to(root))),'extension':p.suffix,'tracked':False})
(out/'large-evidence-inventory.json').write_text(json.dumps({'baseline':'5ac9cff6398839d776ee5f92ac4fc34da92c9b3b','scope':'This repository baseline history + this task worktree local evidence; other worktrees are not altered.',
    'thresholdBytes':1000000,'tracked':tracked,'local':local,'summary':{'trackedFiles':len(tracked),'trackedBytes':sum(x['bytes']for x in tracked),'localFiles':len(local),'localBytes':sum(x['bytes']for x in local)},
    'unpublishedReachableLargeBlobs':unpublished,'unpublishedReachableLargeBytes':sum(x['bytes']for x in unpublished),
    'trackedBytesByCategory':{c:sum(x['bytes']for x in tracked if x['category']==c)for c in sorted(set(x['category']for x in tracked))},
    'publicPushApproved':False},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'trackedFiles':len(tracked),'trackedBytes':sum(x['bytes']for x in tracked),'localFiles':len(local),'localBytes':sum(x['bytes']for x in local)}))
