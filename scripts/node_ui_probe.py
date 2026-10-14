"""Check node readability and wheel bindings against the real UI using fictional data."""
from pathlib import Path
from copy import deepcopy
import json
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/previews-0.8.7'
OUT.mkdir(exist_ok=True)
TITLES = [
    'Time-dependent deformation of porous materials under sustained loading',
    '不同约束条件下材料长期变形与局部破坏的对比研究',
    'Linking microstructure to long-term mechanical response',
    'Rate effects in the deformation of granular media',
]
NODES = [dict(workKey=f'fictional:{i}', title=TITLES[i % 4], year=2015+i,
              authors=[dict(name=f'Example Author {chr(65+i)}')],
              localKeys=[f'1:EXAMPLE{i}'] if i % 3 else [], type='article') for i in range(10)]
EDGES = [dict(edgeKey=f'fictional-edge:{i}', sourceWorkKey=f'fictional:{i}',
              targetWorkKey=f'fictional:{i//2}', type='cites') for i in range(1,10)]
DATA = dict(title='节点可读性测试 · 示例文献', nodes=NODES, edges=EDGES, readOnly=True,
            session=dict(rootSeedWorkKeys=[n['workKey'] for n in NODES], activeSeedWorkKeys=[], hops=[],
                         graphSnapshot=dict(works=NODES, edges=EDGES)))
MOCK = """
window.arguments[0].nodeSizeMode='uniform';
window.arguments[0].getSettings=()=>({apiKeyConfigured:false,autoRefreshCitations:false});
window.arguments[0].focusGraph=(data,options)=>ZLGDiscoveryCore.focusGraph(data,options);
window.arguments[0].updateActiveSeeds=async()=>{throw new Error('Node display tests cannot write session data');};
window.arguments[0].discover=async()=>{throw new Error('Node display tests cannot call a remote provider');};
"""

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for width,height,theme in [(1440,900,'light'),(1440,900,'dark'),(760,650,'light')]:
        page=browser.new_page(viewport=dict(width=width,height=height), color_scheme=theme,reduced_motion='reduce')
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        def route(request):
            if not request.request.url.startswith('http://node-ui.test/'):
                request.abort()
                return
            name=request.request.url.split('/')[-1].split('?')[0]
            content=(ROOT/'ui'/name).read_text()
            if name=='graph.xhtml':
                core=(ROOT/'src/domain/discovery-core.js').read_text()
                injection='<script>'+core+';window.arguments='+json.dumps([dict(data=deepcopy(DATA))],ensure_ascii=False)+';'+MOCK+'</script>'
                content=content.replace('<script src="view-state.js', injection+'<script src="view-state.js')
            elif name=='graph-renderer.js':
                content+='\nconst ProbeBase=ZLGGraphRenderer.Renderer;ZLGGraphRenderer.Renderer=class extends ProbeBase{constructor(args){super(args);window.nodeProbeRenderer=this;}};'
            request.fulfill(body=content,content_type='text/html; charset=utf-8' if name.endswith('xhtml') else 'text/css; charset=utf-8' if name.endswith('css') else 'application/javascript; charset=utf-8')
        page.route('**/*',route)
        page.goto('http://node-ui.test/graph.xhtml')
        page.wait_for_function("['stable','semantic-degraded'].includes(document.getElementById('graph-canvas').dataset.simulationState)")
        page.locator('#fit-graph').click()
        assert page.locator('.zlg-node-year').count()==0
        visible=page.locator('.zlg-node-caption:visible').count()
        assert visible>=4, f'{width}: only {visible} captions'
        assert page.locator('.zlg-node-label tspan').count()>10
        font=page.locator('.zlg-node-label').first.evaluate('el=>getComputedStyle(el).fontSize')
        assert font=='13px'
        page.screenshot(path=str(OUT/f'nodes-{theme}-{width}.png'))
        page.locator('.zlg-node[data-work-key="fictional:1"]').hover(force=True)
        expect(page.locator('.zlg-node-preview')).to_be_visible()
        expect(page.locator('.zlg-node-preview strong')).to_have_text(TITLES[1])
        assert page.evaluate('nodeProbeRenderer.lens.strength')==0, 'Hover must not rearrange the network'
        page.screenshot(path=str(OUT/f'node-preview-{theme}-{width}.png'))
        page.mouse.move(5,5)
        expect(page.locator('.zlg-node-preview')).to_be_hidden()
        caption=page.locator('.zlg-node-caption:visible').first
        caption.hover(force=True)
        expect(page.locator('.zlg-node-preview')).to_be_visible()
        page.mouse.move(5,5)
        expect(page.locator('.zlg-node-preview')).to_be_hidden()
        # Deliberate overlap verifies that the two wheel gestures remain distinct.
        coordinates=page.evaluate("""() => {
            const r=nodeProbeRenderer; r.clearSelection();r.clearLens(true);
            r.positions.set('fictional:0',{x:300,y:200,vx:0,vy:0});
            r.positions.set('fictional:1',{x:300,y:200,vx:0,vy:0});
            r.updatePositions();
            const rect=r.svg.getBoundingClientRect();
            return {clientX:rect.left+300*r.viewport.k+r.viewport.x,clientY:rect.top+200*r.viewport.k+r.viewport.y};
        }""")
        before=page.evaluate('nodeProbeRenderer.viewport.k')
        page.locator('#graph-canvas svg').dispatch_event('wheel',dict(**coordinates,deltaY=-120,ctrlKey=False))
        after=page.evaluate('nodeProbeRenderer.viewport.k')
        assert after>before
        assert page.evaluate('nodeProbeRenderer.selection') is None
        coordinates=page.evaluate("""() => {const r=nodeProbeRenderer,rect=r.svg.getBoundingClientRect();return {clientX:rect.left+300*r.viewport.k+r.viewport.x,clientY:rect.top+200*r.viewport.k+r.viewport.y};}""")
        page.locator('#graph-canvas svg').dispatch_event('wheel',dict(**coordinates,deltaY=120,ctrlKey=True))
        assert page.evaluate('nodeProbeRenderer.viewport.k')==after
        assert page.evaluate('nodeProbeRenderer.selection?.kind')=='node'
        assert page.evaluate('nodeProbeRenderer.selection.value.workKey') in ['fictional:0','fictional:1']
        # Zooming out can reduce density, but selected captions stay readable.
        page.evaluate("""() => { const r=nodeProbeRenderer,p=r.positions.get(r.selection.value.workKey),d=r.dimensions();r.viewport={k:.35,x:d.width/2-p.x*.35,y:d.height/2-p.y*.35};r.applyViewport(); }""")
        assert page.locator('.zlg-node-caption.is-selected:visible .zlg-node-label tspan').count()==2
        expect(page.locator('.zlg-node-caption.is-selected:visible .zlg-node-label')).to_have_css('font-size',font)
        assert not errors,errors
        print(json.dumps(dict(width=width,theme=theme,visibleCaptions=visible,fixedFont=font,hover='passed',wheel='passed')),flush=True)
        page.close()
    browser.close()
