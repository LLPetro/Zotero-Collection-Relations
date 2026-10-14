"""Export a reviewed source allowlist for GitHub; never publish or mutate Zotero."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse
import hashlib
import json
import re
import shutil
from check_publication import review_source

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--repo',help='Actual GitHub owner/repository, once chosen')
parser.add_argument('--output',type=Path,help='Fresh staging directory; defaults to .local/github-source/collection-relations')
args=parser.parse_args()
if args.repo and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+',args.repo):
    parser.error('Use an actual GitHub owner/repository')
stage=args.output.resolve() if args.output else ROOT/'.local/github-source/collection-relations'
if stage.exists():
    parser.error('The staging directory already exists; preserve it or select a fresh working copy')
stage.mkdir(parents=True)
files=['README.md','README.zh-CN.md','CONTRIBUTING.md','manifest.json','bootstrap.js','prefs.js','package.json','.editorconfig','.nvmrc','.gitignore','docs/04_ARCHITECTURE.md','docs/PUBLISHING.md','scripts/build_xpi.py','scripts/validate.sh','scripts/workbench_ui_probe.py','scripts/preferences_ui_probe.py','scripts/node_ui_probe.py','scripts/collection_navigation_ui_probe.py','scripts/language_ui_probe.py','scripts/render_public_preview.py','scripts/prepare_github.py','scripts/check_publication.py']
if (ROOT/'LICENSE').exists():files.append('LICENSE')
for directory in ['src','ui','icons','locale','tests','docs/assets','.github']:
    path=ROOT/directory
    if path.exists():
        files.extend(str(p.relative_to(ROOT)) for p in path.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix not in ['.pyc','.pyo'])
for relative in sorted(set(files)):
    source=ROOT/relative
    assert source.is_file(),relative
    assert not source.is_symlink(),relative
    target=stage/relative
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(source,target)
if args.repo:
    manifest=json.loads((stage/'manifest.json').read_text())
    manifest['homepage_url']='https://github.com/'+args.repo
    manifest['applications']['zotero']['update_url']='https://raw.githubusercontent.com/'+args.repo+'/main/updates.json'
    (stage/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    feed={'addons':{manifest['applications']['zotero']['id']:{'updates':[]}}}
    (stage/'updates.json').write_text(json.dumps(feed,ensure_ascii=False,indent=2)+'\n')
for document in ['README.md','README.zh-CN.md']:
    readme=(stage/document).read_text()
    links=re.findall(r'!?\[[^\]]*\]\(([^\)]+)\)',readme)
    for link in links:
        if not link.startswith(('http://','https://','#')):
            assert (stage/link.split('#',1)[0]).exists(),'Broken README path: '+link
for p in stage.rglob('*'):
    if not p.is_file():continue
    relative=p.relative_to(stage)
    assert not p.suffix.lower()=='.pdf',relative
    assert not any(part.startswith(('native-','native_','live-','live_','previews')) for part in relative.parts),relative
    assert not relative.parts[0] in ['research','manuscript','archive','.local'],relative
    if p.suffix in ['.md','.js','.json','.py','.sh','.xhtml','.css','.yml']:
        text=p.read_text()
        personal_path=re.search('/mnt/'+'[a-z]/Users/'+r'[^/\s]+',text) or re.search(r'[A-Za-z]:\\+Users\\+[^\\\s]+',text)
        assert not personal_path,'Machine path in public source: '+str(relative)
review=review_source(stage)
assert review['passed'],'Publication review failed: '+json.dumps(review['findings'])
archivePath=ROOT/'.local/collection-relations-github-source.zip'
with ZipFile(archivePath,'w',ZIP_DEFLATED) as archive:
    for p in sorted(stage.rglob('*')):
        if p.is_file():archive.write(p,Path('collection-relations')/p.relative_to(stage))
report={'sourceDirectory':str(stage),'sourceArchive':str(archivePath),'files':sum(p.is_file() for p in stage.rglob('*')),'privacyChecksPassed':review['passed'],'sha256':hashlib.sha256(archivePath.read_bytes()).hexdigest(),'repositoryConfigured':bool(args.repo),'licensePresent':(stage/'LICENSE').exists(),'state':'draft until repository, license and online acceptance are confirmed'}
(ROOT/'.local/export-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
