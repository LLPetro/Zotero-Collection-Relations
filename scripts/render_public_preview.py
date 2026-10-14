"""Render English/Chinese docs with fictional data; no Zotero or external requests."""
from pathlib import Path
import argparse
import json
from copy import deepcopy
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--language',choices=['all','en-US','zh-CN'],default='all')
args=parser.parse_args()
LANGUAGES=['en-US','zh-CN'] if args.language=='all' else [args.language]
TITLES={
 'zh-CN':['研究问题与基础方法','方法改进与对比分析','试验设计与测量方法','不同条件下的结果比较','理论模型与参数识别','数值模拟与敏感性分析','方法评价与应用案例','数据集与可重复研究','近期进展与研究展望','另一个研究主题'],
 'en-US':['Research questions and basic methods','Method improvements and comparison','Experimental design and measurement','Results under different conditions','Models and parameter identification','Numerical simulation and sensitivity','Method evaluation and applications','Datasets and reproducible research','Recent progress and research outlook','Another research topic'],
}
NAMES={
 'zh-CN':['研究主题','示例文献集','另一个研究主题','空的示例文献集'],
 'en-US':['Research topics','Example collection','Another research topic','Empty example collection'],
}
IMAGES=['collection-overview.png','collection-switch.png','selection-queue.png','paper-detail.png']
PAIRS=[(1,0),(2,0),(3,2),(4,1),(4,2),(5,4),(5,3),(6,5),(7,2),(7,3),(8,6),(8,7)]
MOCK='''
window.previewState=structuredClone(window.arguments[0].data);
window.arguments[0].nodeSizeMode='uniform';
window.arguments[0].defaultResultLimit=20;
window.arguments[0].getSettings=()=>({language:window.previewLanguage,apiKeyConfigured:false,autoRefreshCitations:false});
window.arguments[0].data.session.collectionScope={id:1,libraryID:1,key:'EXAMPLE1'};
previewState.session.collectionScope={id:1,libraryID:1,key:'EXAMPLE1'};
window.arguments[0].listCollections=async()=>[
 {id:100,name:previewNames[0],path:previewNames[0],parentID:null,depth:0,directItemCount:0,recursiveItemCount:11,descendantIDs:[1,2]},
 {id:1,name:previewNames[1],path:previewNames[0]+' / '+previewNames[1],parentID:100,depth:1,directItemCount:10,recursiveItemCount:10,descendantIDs:[]},
 {id:2,name:previewNames[2],path:previewNames[0]+' / '+previewNames[2],parentID:100,depth:1,directItemCount:1,recursiveItemCount:1,descendantIDs:[]},
 {id:3,name:previewNames[3],path:previewNames[3],parentID:null,depth:0,directItemCount:0,recursiveItemCount:0,descendantIDs:[]}
];
window.arguments[0].openCollection=async id=>{
 const next=structuredClone(previewState);
 next.title=previewNames[id];
 next.session.collectionScope={id,libraryID:1,key:'EXAMPLE'+id};
 next.session.rootSeedWorkKeys=id===1?next.nodes.map(node=>node.workKey):id===2?['example:9']:[];
 next.session.activeSeedWorkKeys=[];
 return {...ZLGGraphWorkbench.args,data:next};
};
window.arguments[0].openSettings=()=>{};
window.arguments[0].focusGraph=(data,options)=>ZLGDiscoveryCore.focusGraph(data,options);
window.arguments[0].updateActiveSeeds=async keys=>{previewState.session.activeSeedWorkKeys=[...keys];return structuredClone(previewState);};
window.arguments[0].discover=async()=>{throw new Error('Public preview does not connect to external providers');};
'''
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    for language in LANGUAGES:
        out=ROOT/'docs/assets'/('en' if language=='en-US' else '')
        out.mkdir(parents=True,exist_ok=True)
        nodes=[dict(workKey=f'example:{index}',title=title+(' (example paper)' if language=='en-US' else '（示例论文）'),shortTitle=title,year=2015+index,authors=[dict(name=('Example author ' if language=='en-US' else '示例作者 ')+chr(65+index))],localKeys=[f'1:EXAMPLE{index}'],type='article',citationCount=None) for index,title in enumerate(TITLES[language])]
        edges=[dict(edgeKey=f'example:{source}:{target}',sourceWorkKey=f'example:{source}',targetWorkKey=f'example:{target}',type='cites') for source,target in PAIRS]
        data=dict(title=NAMES[language][1],nodes=nodes,edges=edges,readOnly=True,session=dict(sessionId='public-example',rootSeedWorkKeys=[node['workKey'] for node in nodes],rootSeedLocalKeys=[],activeSeedWorkKeys=[],hops=[],graphSnapshot=dict(works=nodes,edges=edges)))
        page=browser.new_page(viewport=dict(width=1440,height=900),color_scheme='light',reduced_motion='reduce')
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        def route(request):
            if not request.request.url.startswith('http://collection-relations.test/'):
                request.abort();return
            name=request.request.url.split('/')[-1].split('?')[0]
            content=(ROOT/'ui'/name).read_text()
            if name=='graph.xhtml':
                core=(ROOT/'src/domain/discovery-core.js').read_text()
                context=json.dumps([dict(data=deepcopy(data),language=language,hostLocale=language)],ensure_ascii=False)
                fixture='window.previewLanguage='+json.dumps(language)+';window.previewNames='+json.dumps(NAMES[language],ensure_ascii=False)+';'
                content=content.replace('<script src="view-state.js','<script>'+core+';window.arguments='+context+';'+fixture+MOCK+'</script><script src="view-state.js')
            request.fulfill(body=content,content_type='text/html; charset=utf-8' if name.endswith('xhtml') else 'text/css; charset=utf-8' if name.endswith('css') else 'application/javascript; charset=utf-8')
        page.route('**/*',route)
        page.goto('http://collection-relations.test/graph.xhtml')
        expect(page.locator('.zlg-result-row')).to_have_count(len(nodes))
        expect(page.locator('html')).to_have_attribute('lang',language)
        page.wait_for_timeout(900)
        page.locator('#fit-graph').click()
        page.screenshot(path=str(out/IMAGES[0]))
        page.locator('#switch-collection').click()
        expect(page.locator('#collection-dialog')).to_be_visible()
        page.locator('#zlg-collection-2').click()
        page.screenshot(path=str(out/IMAGES[1]))
        page.get_by_role('button',name='Cancel' if language=='en-US' else '取消',exact=True).click()
        page.locator('.zlg-result-row input').nth(1).check()
        page.locator('.zlg-result-row input').nth(4).check()
        expect(page.locator('#discovery-seed-list li')).to_have_count(2)
        page.locator('#fit-graph').click()
        page.wait_for_timeout(150)
        page.screenshot(path=str(out/IMAGES[2]))
        page.locator('.zlg-result-title').nth(4).click()
        expect(page.locator('#graph-detail')).to_be_visible()
        page.wait_for_timeout(300)
        page.screenshot(path=str(out/IMAGES[3]))
        assert not errors,errors
        page.close()
        print(json.dumps(dict(language=language,synthetic=True,realLibraryAccess=False,externalRequests=0,images=[str(out/name) for name in IMAGES])),flush=True)
    browser.close()
