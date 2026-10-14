"""Check Collection scope switching in one window with isolated fictional sessions."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/previews-0.8.7'
OUT.mkdir(exist_ok=True)
MOCK='''
window.navigationListeners=new Set();window.scopeFailure=false;window.scopeDelay=0;window.scopeCalls=[];
window.fixtureScopes=new Map([1,2,3].map(id=>{
 const nodes=id===3?[]:[0,1].map(i=>({workKey:`scope:${id}:${i}`,title:`示例文献集 ${id} 的论文 ${i+1}`,year:2020+i,authors:[{name:'示例作者'}],localKeys:[`1:EXAMPLE${id}${i}`],collectionIDs:[id],type:'article'}));
 const session={sessionId:`session-fixture-${id}`,name:`示例文献集 ${id}`,collectionScope:{id,libraryID:1,key:`COLL${id}`},rootSeedWorkKeys:nodes.map(n=>n.workKey),rootSeedLocalKeys:nodes.flatMap(n=>n.localKeys),activeSeedWorkKeys:id===1?[nodes[0].workKey]:[],hops:[],graphSnapshot:{works:nodes,edges:[]}};
 return [id,{title:session.name,nodes,edges:[],readOnly:true,session}];
}));
window.fixtureArgs=id=>({
 data:structuredClone(fixtureScopes.get(id)),
 getSettings:()=>({apiKeyConfigured:false,autoRefreshCitations:false}),
 subscribeSettings:callback=>{navigationListeners.add(callback);return()=>navigationListeners.delete(callback);},
 focusGraph:(data,options)=>ZLGDiscoveryCore.focusGraph(data,options),
 listCollections:async()=>[
 {id:100,name:'研究主题',path:'研究主题',depth:0,parentID:null,directItemCount:0,recursiveItemCount:4,descendantIDs:[1,2]},
 ...[1,2].map(id=>({id,name:`示例文献集 ${id}`,path:`研究主题 / 示例文献集 ${id}`,parentID:100,depth:1,directItemCount:2,recursiveItemCount:2,descendantIDs:[]})),
 {id:200,name:'其他主题',path:'其他主题',depth:0,parentID:null,directItemCount:0,recursiveItemCount:0,descendantIDs:[3]},
 {id:3,name:'示例文献集 3',path:'其他主题 / 示例文献集 3',parentID:200,depth:1,directItemCount:0,recursiveItemCount:0,descendantIDs:[]}
 ],
 updateActiveSeeds:async keys=>{fixtureScopes.get(id).session.activeSeedWorkKeys=[...keys];return structuredClone(fixtureScopes.get(id));},
 openCollection:async(target,{signal}={})=>{
  scopeCalls.push(target);
  if(scopeDelay)await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,scopeDelay);signal.addEventListener('abort',()=>{clearTimeout(timer);const error=new Error('cancelled');error.name='AbortError';reject(error);},{once:true});});
  if(signal?.aborted){const error=new Error('cancelled');error.name='AbortError';throw error;}
  if(scopeFailure)throw new Error('示例读取失败');
  return fixtureArgs(target);
 }
});window.arguments=[fixtureArgs(1)];
'''
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    for width,theme in [(1440,'light'),(1440,'dark'),(760,'light')]:
        page=browser.new_page(viewport={'width':width,'height':880},color_scheme=theme,reduced_motion='reduce')
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        def route(request):
            if not request.request.url.startswith('http://scope.test/'):
                request.abort();return
            name=request.request.url.split('/')[-1].split('?')[0]
            content=(ROOT/'ui'/name).read_text()
            if name=='graph.xhtml':
                core=(ROOT/'src/domain/discovery-core.js').read_text()
                content=content.replace('<script src="view-state.js','<script>'+core+';'+MOCK+'</script><script src="view-state.js')
            request.fulfill(body=content,content_type='text/html; charset=utf-8' if name.endswith('xhtml') else 'text/css' if name.endswith('css') else 'application/javascript')
        page.route('**/*',route);page.goto('http://scope.test/graph.xhtml')
        expect(page.locator('#switch-collection')).to_be_enabled()
        expect(page.locator('#switch-collection #graph-title')).to_have_text('示例文献集 1')
        assert page.locator('.zlg-switch-collection').count()==0
        expect(page.locator('#discovery-seed-list li')).to_have_count(1)
        def choose(target):
            page.locator('#switch-collection').click()
            expect(page.locator('#collection-dialog')).to_be_visible()
            expect(page.locator('#collection-clear')).to_be_hidden()
            expect(page.locator('#collection-recursive')).to_be_hidden()
            if target==3 and not page.locator('#zlg-collection-3').count():
                page.locator('#zlg-collection-200 .zlg-collection-disclosure').click()
            page.locator(f'#zlg-collection-{target}').click()
            page.locator('#collection-apply').click()
        choose(2)
        expect(page.locator('#graph-title')).to_have_text('示例文献集 2')
        expect(page.locator('.zlg-result-row')).to_have_count(2)
        expect(page.locator('.zlg-result-row[data-work-key^="scope:1:"]')).to_have_count(0)
        assert page.evaluate('navigationListeners.size')==1
        page.locator('.zlg-result-row input').first.check()
        choose(1)
        expect(page.locator('#graph-title')).to_have_text('示例文献集 1')
        expect(page.locator('#discovery-seed-list li')).to_have_count(1)
        choose(2)
        expect(page.locator('#graph-title')).to_have_text('示例文献集 2')
        expect(page.locator('#discovery-seed-list li')).to_have_count(1)
        assert page.evaluate('navigationListeners.size')==1
        page.screenshot(path=str(OUT/f'collection-switched-{theme}-{width}.png'))
        # Native-style folding, keyboard parent/child movement and search ancestry.
        page.locator('#switch-collection').click()
        expect(page.locator('#collection-list')).to_have_attribute('role','tree')
        expect(page.locator('#zlg-collection-100')).to_have_attribute('aria-expanded','true')
        page.locator('#zlg-collection-100 > .zlg-collection-line > .zlg-collection-disclosure').click()
        expect(page.locator('#zlg-collection-1')).to_have_count(0)
        page.locator('#zlg-collection-100 > .zlg-collection-line').click()
        page.locator('#collection-list').press('ArrowRight')
        expect(page.locator('#zlg-collection-100')).to_have_attribute('aria-expanded','true')
        page.locator('#collection-list').press('ArrowRight')
        expect(page.locator('#zlg-collection-1')).to_have_attribute('aria-selected','true')
        page.locator('#collection-list').press('ArrowLeft')
        expect(page.locator('#zlg-collection-100')).to_have_attribute('aria-selected','true')
        page.locator('#collection-query').fill('示例文献集 3')
        expect(page.locator('#zlg-collection-200')).to_have_count(1)
        expect(page.locator('#zlg-collection-3')).to_have_count(1)
        expect(page.locator('#zlg-collection-100')).to_have_count(0)
        page.locator('#collection-query').fill('')
        page.screenshot(path=str(OUT/f'collection-tree-{theme}-{width}.png'))
        page.get_by_role('button',name='取消',exact=True).click()
        page.evaluate('scopeFailure=true');choose(1)
        expect(page.locator('#collection-dialog-feedback')).to_contain_text('切换失败')
        expect(page.locator('#graph-title')).to_have_text('示例文献集 2')
        page.get_by_role('button',name='取消',exact=True).click()
        page.evaluate('scopeFailure=false;scopeDelay=5000');choose(1)
        expect(page.locator('#collection-dialog-feedback')).to_have_text('正在打开文献集…')
        page.get_by_role('button',name='取消',exact=True).click()
        page.wait_for_timeout(200)
        expect(page.locator('#graph-title')).to_have_text('示例文献集 2')
        expect(page.locator('#switch-collection')).to_be_enabled()
        page.evaluate('scopeDelay=0');choose(3)
        expect(page.locator('#graph-title')).to_have_text('示例文献集 3')
        expect(page.locator('.zlg-result-row')).to_have_count(0)
        expect(page.locator('#switch-collection')).to_be_enabled()
        assert page.evaluate('navigationListeners.size')==1
        assert not errors,errors
        assert len(page.context.pages)==1
        print(json.dumps({'width':width,'theme':theme,'switchBackQueue':'passed','failureAndCancel':'passed','emptyCollection':'passed','singleWindow':True}),flush=True)
        page.close()
    browser.close()
