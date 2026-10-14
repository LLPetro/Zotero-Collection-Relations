"""Exercise the real workbench with local callbacks. No Zotero or external provider access."""
from pathlib import Path
import json
import subprocess
from copy import deepcopy
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/previews-0.8.7'
OUT.mkdir(exist_ok=True)
demo_script = """const fs=require('node:fs'),vm=require('node:vm');const scope=vm.createContext({});vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),scope);scope.ZLGI18n=require(process.argv[2]);scope.ZLGT=scope.ZLGI18n.t;scope.LiteratureGraph.getSettings=()=>({read:()=>true});scope.LiteratureGraph.graphData().then(data=>process.stdout.write(JSON.stringify(data)));"""
DEMO_DATA = json.loads(subprocess.check_output(['node', '-e', demo_script, str(ROOT/'src/app/literature-graph.js'), str(ROOT/'ui/i18n.js')], text=True))
TITLES = ['研究问题与基础方法（示例论文）', '方法改进与对比分析（示例论文）', '试验设计与测量方法（示例论文）', '近期进展与研究展望（示例论文）']
NODES = [dict(workKey=f'demo:{i}', title=title, year=2020+i,
 authors=[dict(name=f'示例作者 {i+1}')],
 localKeys=[f'1:DEMO000{i}'], type='article', citationCount=None,
 shortTitle=title) for i,title in enumerate(TITLES)]
# UI fixture only: the fourth node intentionally has no edges to test retention.
EDGES = [dict(edgeKey=f'demo:{a}:{b}', sourceWorkKey=f'demo:{a}', targetWorkKey=f'demo:{b}', type='cites') for a,b in [(1,0),(2,1),(2,0)]]
DATA = dict(title='示例文献集 · 界面测试', nodes=NODES, edges=EDGES, readOnly=True,
 session=dict(rootSeedWorkKeys=[n['workKey'] for n in NODES], activeSeedWorkKeys=[], hops=[],
 graphSnapshot=dict(works=NODES, edges=EDGES)))
MOCK = '''
window.calls = []; window.failSave = false; window.failSearch = false; window.saveDelay = 0; window.searchDelay = 0;
window.openCalls = []; window.pdfCalls = []; window.copyCalls = []; window.failOpen = false; window.failPDF = false;
window.countRefreshCalls = 0;
window.state = structuredClone(window.arguments[0].data);
window.arguments[0].refreshCitationCounts = async () => { window.countRefreshCalls++; return {works:[],refreshedCount:0}; };
window.arguments[0].focusGraph = (data,options) => ZLGDiscoveryCore.focusGraph(data,options);
window.arguments[0].openExternal = async url => { if(window.failOpen) throw new Error('模拟来源打开失败'); window.openCalls.push(url); };
window.arguments[0].openPDF = async node => { if(window.failPDF) throw new Error('模拟 PDF 打开失败'); window.pdfCalls.push(node.workKey); };
window.arguments[0].copyDOI = async doi => { window.copyCalls.push(doi); };
window.arguments[0].updateCandidateState = async (key, candidateState) => {
 if(window.failSave) throw new Error('模拟保存失败');
 window.state.session = ZLGDiscoveryCore.setCandidateState(window.state.session,key,candidateState);
 window.state.nodes = window.state.nodes.map(node => ({...node,candidateState:window.state.session.candidateStates[node.workKey] || 'unreviewed'}));
 window.state.session.graphSnapshot.works = window.state.nodes;
 return structuredClone(window.state);
};
window.arguments[0].activateHop = async hopId => {
 if(window.failHistory) throw new Error('模拟历史保存失败');
 window.state.session.activeHopId = hopId;
 return {session:structuredClone(window.state.session)};
};
window.arguments[0].updateActiveSeeds = async keys => {
 await new Promise(resolve => setTimeout(resolve, window.saveDelay));
 if (window.failSave) throw new Error('模拟保存失败');
 window.state.session.activeSeedWorkKeys = [...keys];
 return structuredClone(window.state);
};
window.arguments[0].discover = async request => {
 window.calls.push({mode:request.mode, keys:[...request.seedWorkKeys], limit:request.limit});
 if(window.searchDelay) await new Promise((resolve,reject) => {
  const abort = () => { clearTimeout(timer); reject(new DOMException('cancelled','AbortError')); };
  const timer = setTimeout(() => { request.signal.removeEventListener('abort',abort); resolve(); },window.searchDelay);
  if(request.signal.aborted) abort();
  else request.signal.addEventListener('abort',abort,{once:true});
 });
 if (window.failSearch) throw new Error('模拟查找失败');
 const candidate = {workKey:'outside',title:'External candidate — interface test fixture',year:2023,authors:[],localKeys:[],type:'article', identifiers:{doi:'10.1234/ui-fixture'},provider:'openalex',externalId:'W99999'};
 window.state.nodes = [...window.arguments[0].data.nodes,candidate].map(node => ({...node,candidateState:window.state.session.candidateStates?.[node.workKey] || 'unreviewed'}));
 const edge = {edgeKey:request.seedWorkKeys[0]+':'+request.mode+':outside',sourceWorkKey:request.seedWorkKeys[0],targetWorkKey:'outside',type:'similar'};
 window.state.edges = [...new Map([...window.state.edges,edge].map(value => [value.edgeKey,value])).values()];
 const hop = {hopId:'hop-'+window.calls.length,parentHopId:window.state.session.activeHopId,mode:request.mode,seedWorkKeys:[...request.seedWorkKeys],resultWorkKeys:['outside'],resultTotal:1,resultLimit:request.limit,resultEntries:[],edgeEntries:[edge]};
 window.state.session.hops.push(hop); window.state.session.activeHopId=hop.hopId;
 window.state.session.graphSnapshot={works:window.state.nodes,edges:window.state.edges};
 window.state.lastResult={mode:request.mode,workKeys:['outside'],total:1};
 return structuredClone(window.state);
};
'''

def check(page, width, height, theme):
    page.goto('http://zlg.test/graph.xhtml')
    expect(page.locator('.zlg-result-row')).to_have_count(4)
    expect(page.locator('#search-queue')).to_be_hidden()
    assert page.evaluate('calls.length') == 0
    expect(page.locator('.zlg-node')).to_have_count(4)
    expect(page.locator('.zlg-edge-group')).to_have_count(3)
    expect(page.locator('#workspace-collection')).to_have_attribute('aria-pressed','true')
    page.wait_for_timeout(700)
    # Recover the current graph after zooming, without changing its documents or request state.
    before = page.locator('.zlg-viewport').get_attribute('transform')
    page.locator('#graph-canvas svg').dispatch_event('wheel',dict(deltaY=-400,ctrlKey=False,clientX=500,clientY=250))
    assert page.locator('.zlg-viewport').get_attribute('transform') != before
    page.get_by_role('button',name='显示全图',exact=True).click()
    expect(page.locator('.zlg-viewport')).to_have_attribute('transform',before)
    assert page.evaluate('calls.length') == 0
    assert page.locator('#graph-canvas').bounding_box()['height'] > height * .55
    page.screenshot(path=str(OUT / f'collection-{theme}-{width}.png'))
    # Viewing and queue selection are distinct; inspector never replaces the queue.
    page.locator('.zlg-result-title').first.click()
    expect(page.locator('#search-queue')).to_be_hidden()
    expect(page.locator('#graph-detail')).to_be_visible()
    expect(page.locator('#discovery-seed-list li')).to_have_count(0)
    page.locator('#graph-detail [data-node-action="seed"]').click()
    expect(page.locator('#search-queue')).to_be_visible()
    expect(page.locator('#discovery-seed-list li')).to_have_count(1)
    expect(page.locator('.zlg-result-row[data-work-key="demo:0"] input')).to_be_checked()
    expect(page.locator('#graph-detail [data-node-action="seed"]')).to_have_text('移出队列')
    expect(page.locator('.zlg-detail-close')).to_be_visible()
    section = page.locator('details.zlg-detail-block').first
    initially_open = section.evaluate('(el) => el.open')
    section.locator('summary').click()
    assert section.evaluate('(el) => el.open') != initially_open
    section.locator('summary').click()
    assert section.evaluate('(el) => el.open') == initially_open
    close = page.locator('.zlg-detail-close').bounding_box()
    assert page.evaluate('p => document.elementFromPoint(p.x,p.y)?.closest(".zlg-detail-close") !== null',
                         dict(x=close['x']+close['width']/2,y=close['y']+close['height']/2))
    page.screenshot(path=str(OUT / f'inspector-{theme}-{width}.png'))
    # The queue remains beside the canvas, so detail controls stay reachable.
    page.locator('.zlg-detail-close').click()
    page.locator('.zlg-result-row[data-work-key="demo:1"] input').check()
    expect(page.locator('#discovery-seed-list li')).to_have_count(2)
    page.locator('[data-discover="references"]').click()
    page.locator('[data-discover="similar"]').click()
    assert page.evaluate('calls.length') == 0
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / f'queue-{theme}-{width}.png'))
    page.locator('#run-discovery').click()
    expect(page.locator('#workspace-discovery')).to_have_attribute('aria-pressed','true')
    expect(page.locator('.zlg-result-row')).to_have_count(1)
    assert page.evaluate('calls[0].keys') == ['demo:0','demo:1']
    # Menus stay next to the triggering button and remain inside every tested viewport.
    page.locator('.zlg-result-title').click()
    more = page.get_by_role('button',name='更多操作',exact=True)
    more.click()
    menu = page.get_by_role('menu',name='更多操作')
    expect(menu).to_be_visible()
    anchor, bounds = more.bounding_box(), menu.bounding_box()
    assert bounds['x'] >= 8 and bounds['x']+bounds['width'] <= width-8
    assert bounds['y'] >= 8 and bounds['y']+bounds['height'] <= height-8
    assert abs(bounds['x']-anchor['x']) <= 12
    page.screenshot(path=str(OUT / f'actions-{theme}-{width}.png'))
    page.keyboard.press('Escape')
    expect(menu).to_be_hidden()
    expect(more).to_be_focused()
    expect(page.locator('#search-queue')).to_be_visible()
    # Original collection membership survives external discovery, including an isolated item.
    page.locator('#workspace-collection').click()
    expect(page.locator('.zlg-result-row')).to_have_count(4)
    expect(page.locator('.zlg-node')).to_have_count(4)
    expect(page.locator('.zlg-edge-group')).to_have_count(3)
    assert page.locator('.zlg-result-row[data-work-key="outside"]').count() == 0
    expect(page.locator('#discovery-seed-list li')).to_have_count(2)
    # Per-item removal and failed clear rollback; these actions must never search.
    page.locator('[data-remove-seed="demo:0"]').click()
    expect(page.locator('#discovery-seed-list li')).to_have_count(1)
    expect(page.locator('.zlg-result-row[data-work-key="demo:0"] input')).not_to_be_checked()
    expect(page.locator('#clear-discovery-selection')).to_be_enabled()
    assert page.evaluate('state.session.activeSeedWorkKeys.length') == 1
    page.evaluate('failSave=true')
    page.locator('#clear-discovery-selection').click()
    expect(page.locator('#graph-status')).to_contain_text('已恢复原队列')
    expect(page.locator('#discovery-seed-list li')).to_have_count(1)
    page.evaluate('failSave=false;saveDelay=250')
    page.locator('#clear-discovery-selection').click()
    expect(page.locator('#run-discovery')).to_be_disabled()
    expect(page.locator('#discovery-seed-list li')).to_have_count(0)
    page.wait_for_timeout(300)
    assert page.evaluate('calls.length') == 1
    page.locator('#workspace-discovery').click()
    page.locator('#history-home').click()
    expect(page.locator('#discovery-seed-list li')).to_have_count(2)
    expect(page.locator('#clear-discovery-selection')).to_be_enabled()
    assert page.evaluate('calls.length') == 1
    page.evaluate('failSearch=true')
    page.locator('[data-discover="citations"]').click()
    page.locator('#run-discovery').click()
    expect(page.locator('#graph-status')).to_contain_text('发现失败')
    expect(page.locator('#discovery-seed-list li')).to_have_count(2)
    expect(page.locator('.zlg-result-row')).to_have_count(1)
    page.locator('#workspace-collection').click()
    page.locator('#close-search-queue').click()
    page.locator('#filter-query').fill('no matching title')
    expect(page.locator('.zlg-result-row')).to_have_count(0)
    page.locator('#filter-query').fill('')
    expect(page.locator('.zlg-result-row')).to_have_count(4)
    page.locator('[data-mode="timeline"]').click()
    expect(page.locator('[data-mode="timeline"]')).to_have_attribute('aria-pressed','true')
    page.locator('[data-mode="galaxy"]').click()
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    print(json.dumps(dict(width=width,height=height,theme=theme,status='passed')), flush=True)

def host_theme_regressions(page):
    # A real second document represents a host whose theme differs from the OS.
    page.evaluate('''async () => {
      const frame=document.createElement('iframe');
      frame.hidden=true;
      frame.srcdoc='<html><body></body></html>';
      document.body.append(frame);
      await new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
      const host=frame.contentWindow;
      host.document.documentElement.style.setProperty('--color-background','#1e1e1e');
      host.document.documentElement.style.setProperty('--color-sidepane','#303030');
      window.hostStyleFixture={frame,host,disconnect:ZLGHostAppearance.connect(window,host)};
    }''')
    expect(page.locator('html')).to_have_attribute('data-theme','dark')
    assert page.locator('.zlg-results').evaluate('(el)=>getComputedStyle(el).backgroundColor') == 'rgb(30, 30, 30)'
    assert page.locator('html').evaluate('(el)=>getComputedStyle(el).colorScheme') == 'dark'
    page.evaluate("hostStyleFixture.host.document.documentElement.style.setProperty('--color-background','#fff');hostStyleFixture.host.document.documentElement.style.setProperty('--color-sidepane','#f2f2f2')")
    expect(page.locator('html')).to_have_attribute('data-theme','light')
    assert page.locator('.zlg-results').evaluate('(el)=>getComputedStyle(el).backgroundColor') == 'rgb(255, 255, 255)'
    assert page.locator('html').evaluate('(el)=>getComputedStyle(el).colorScheme') == 'light'
    page.evaluate('''() => {
      hostStyleFixture.disconnect();hostStyleFixture.frame.remove();
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.removeAttribute('style');
    }''')
    print(json.dumps(dict(host_theme_regressions='passed')),flush=True)

def workflow_regressions(page):
    page.goto('http://zlg.test/graph.xhtml?flow')
    expect(page.locator('.zlg-result-row')).to_have_count(4)
    # No invisible default retraction filter; duplicate-only does not include unknown values.
    page.locator('#catalog-filters').evaluate('(el) => el.open=true')
    page.locator('#filter-retracted').uncheck()
    expect(page.locator('.zlg-result-row')).to_have_count(3)
    page.locator('#catalog-filters').evaluate('(el) => el.open=false')
    expect(page.locator('#active-filters')).to_be_visible()
    page.locator('#active-filters button').click()
    expect(page.locator('.zlg-result-row')).to_have_count(4)
    page.locator('#catalog-filters').evaluate('(el) => el.open=true')
    page.locator('#filter-duplicate').check()
    expect(page.locator('.zlg-result-row')).to_have_count(1)
    page.locator('#filter-duplicate').uncheck()
    page.locator('#catalog-filters').evaluate('(el) => el.open=false')
    # Collection search and detail survive a round trip. The same tab click is a no-op.
    page.locator('#filter-query').fill('基础方法')
    expect(page.locator('.zlg-result-row')).to_have_count(1)
    page.locator('.zlg-result-title').click()
    page.locator('#workspace-collection').click()
    expect(page.locator('#filter-query')).to_have_value('基础方法')
    expect(page.locator('.zlg-result-row')).to_have_count(1)
    page.locator('.zlg-seed-toggle').check()
    page.locator('#run-discovery').click()
    expect(page.locator('#workspace-discovery')).to_have_attribute('aria-pressed','true')
    expect(page.locator('#filter-query')).to_have_value('')
    expect(page.locator('.zlg-result-row')).to_have_count(1)
    expect(page.locator('#result-request-note')).to_be_hidden()
    page.locator('#workspace-collection').click()
    expect(page.locator('#filter-query')).to_have_value('基础方法')
    expect(page.locator('#graph-detail h2')).to_contain_text('基础方法')
    # The reversible reading action stays in the same place and rolls back a failed save.
    page.get_by_role('button',name='加入稍后阅读',exact=True).click()
    remove_reading = page.get_by_role('button',name='移出稍后阅读',exact=True)
    expect(remove_reading).to_be_enabled()
    assert page.get_by_role('button',name='更多操作',exact=True).count() == 0
    page.evaluate('failSave=true')
    remove_reading.click()
    expect(page.locator('#graph-status')).to_contain_text('操作失败')
    expect(remove_reading).to_be_enabled()
    page.evaluate('failSave=false')
    remove_reading.click()
    expect(page.get_by_role('button',name='加入稍后阅读',exact=True)).to_be_enabled()
    # Native reading callbacks are invoked only on explicit action and can be retried.
    page.evaluate('failPDF=true')
    page.get_by_role('button',name='阅读 PDF',exact=True).click()
    expect(page.locator('#graph-detail')).to_contain_text('PDF 打开失败')
    page.evaluate('failPDF=false')
    page.locator('#graph-detail button',has_text='PDF 打开失败').click()
    expect(page.get_by_role('button',name='阅读 PDF',exact=True)).to_be_visible()
    assert page.evaluate('pdfCalls') == ['demo:0']
    # Draft B must not become the origin of A's displayed results.
    page.locator('#clear-filters').click()
    page.locator('[data-remove-seed="demo:0"]').click()
    page.locator('.zlg-result-row[data-work-key="demo:1"] input').check()
    page.locator('#workspace-discovery').click()
    expect(page.locator('#result-request-note')).to_be_visible()
    assert page.locator('.zlg-node.is-seed').evaluate_all('(els) => els.map(e => e.dataset.workKey)') == ['demo:0']
    assert page.locator('.zlg-node[data-work-key="demo:1"]').count() == 0
    assert page.evaluate('calls.length') == 1
    # Queue entries themselves open the requested paper detail.
    page.locator('.zlg-queue-paper').click()
    expect(page.locator('#graph-detail h2')).to_contain_text('方法改进')
    expect(page.locator('#graph-detail [data-node-action="seed"]')).to_have_text('移出队列')
    page.locator('#run-discovery').click()
    expect(page.locator('#result-request-note')).to_be_hidden()
    assert page.locator('.zlg-node.is-seed').evaluate_all('(els) => els.map(e => e.dataset.workKey)') == ['demo:1']
    # Another draft C survives both history directions; only the submitted origin changes.
    page.locator('#workspace-collection').click()
    page.locator('[data-remove-seed="demo:1"]').click()
    page.locator('.zlg-result-row[data-work-key="demo:2"] input').check()
    page.locator('#workspace-discovery').click()
    page.locator('#history-back').click()
    expect(page.locator('[data-remove-seed="demo:2"]')).to_be_visible()
    expect(page.locator('.zlg-node.is-seed')).to_have_attribute('data-work-key','demo:0')
    assert page.evaluate('state.session.activeSeedWorkKeys') == ['demo:2']
    page.locator('#history-forward').click()
    expect(page.locator('.zlg-node.is-seed')).to_have_attribute('data-work-key','demo:1')
    assert page.evaluate('calls.length') == 2
    # A failed undo keeps the cleared queue and the undo record until retry succeeds.
    page.locator('#clear-discovery-selection').click()
    expect(page.locator('#discovery-seed-list li')).to_have_count(0)
    expect(page.locator('#undo-queue-selection')).to_be_enabled()
    page.evaluate('failSave=true')
    page.locator('#undo-queue-selection').click()
    expect(page.locator('#graph-status')).to_contain_text('保存失败')
    expect(page.locator('#discovery-seed-list li')).to_have_count(0)
    page.evaluate('failSave=false')
    page.locator('#undo-queue-selection').click()
    expect(page.locator('[data-remove-seed="demo:2"]')).to_be_visible()
    # External source links and DOI copying use explicit callbacks, with failure recovery.
    page.locator('.zlg-result-title').click()
    page.evaluate('failOpen=true')
    page.locator('#graph-detail a',has_text='DOI 来源').click()
    expect(page.locator('#graph-detail a',has_text='来源打开失败')).to_be_visible()
    page.evaluate('failOpen=false')
    page.locator('#graph-detail a',has_text='来源打开失败').click()
    expect(page.locator('#graph-detail a',has_text='DOI 来源')).to_be_visible()
    page.get_by_role('button',name='复制 DOI',exact=True).click()
    expect(page.get_by_role('button',name='DOI 已复制到系统剪贴板',exact=True)).to_be_visible()
    assert page.evaluate('openCalls') == ['https://doi.org/10.1234/ui-fixture']
    assert page.evaluate('copyCalls') == ['10.1234/ui-fixture']
    # Force refresh has one job: a failed search must not be hidden by a separate citation-count request.
    counts = page.evaluate('countRefreshCalls')
    page.evaluate('failSearch=true')
    page.locator('#refresh-discovery').click()
    expect(page.locator('#graph-status')).to_contain_text('发现失败')
    expect(page.locator('#run-discovery')).to_be_enabled()
    assert page.evaluate('countRefreshCalls') == counts
    page.evaluate('failSearch=false')
    # Cancelling a slow request leaves the current result and hop intact, and starts no other request.
    hop = page.evaluate('state.session.activeHopId')
    page.evaluate('searchDelay=5000')
    page.locator('#run-discovery').click()
    expect(page.locator('#cancel-discovery')).to_be_visible()
    page.locator('#cancel-discovery').click()
    expect(page.locator('#graph-status')).to_contain_text('已取消')
    expect(page.locator('#run-discovery')).to_be_enabled()
    assert page.evaluate('state.session.activeHopId') == hop
    page.wait_for_timeout(300)
    assert page.evaluate('calls.length') == 4
    expect(page.locator('.zlg-result-row')).to_have_count(1)
    page.keyboard.press('Escape')
    expect(page.locator('#search-queue')).to_be_hidden()
    print(json.dumps(dict(workflow_regressions='passed')),flush=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    for theme,width,height in [('light',1440,900),('dark',1440,900),('light',1024,700),('light',900,650),('light',760,650)]:
        page = browser.new_page(viewport=dict(width=width,height=height),color_scheme=theme,reduced_motion='reduce')
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        def route(request):
            name=request.request.url.split('/')[-1].split('?')[0]
            content=(ROOT/'ui'/name).read_text()
            if name=='graph.xhtml':
                standalone = '?demo' in request.request.url
                fixture=deepcopy(DEMO_DATA if standalone else DATA)
                if '?flow' in request.request.url:
                    fixture['nodes'][3].update(title='Synthetic retraction flag — UI test',isRetracted=True)
                    fixture['nodes'][0].update(duplicateCount=2,hasPDF=True)
                core=(ROOT/'src/domain/discovery-core.js').read_text()
                content=content.replace('<script src="view-state.js', '<script>'+core+';window.arguments='+json.dumps([dict(data=fixture)],ensure_ascii=False)+';'+('window.arguments[0].getSettings=()=>({autoRefreshCitations:false});window.arguments[0].selectItem=()=>{throw new Error(\"Fictional paper must not select a Zotero item\")};' if standalone else MOCK)+'</script><script src="view-state.js')
            request.fulfill(body=content,content_type='text/html' if name.endswith('xhtml') else 'text/css' if name.endswith('css') else 'application/javascript')
        page.route('http://zlg.test/**',route)
        try:
            check(page,width,height,theme)
            if theme=='light' and width==1440:
                host_theme_regressions(page)
                workflow_regressions(page)
                page.goto('http://zlg.test/graph.xhtml?demo')
                expect(page.locator('.zlg-result-row')).to_have_count(4)
                expect(page.locator('.zlg-node')).to_have_count(4)
                expect(page.locator('.zlg-edge-group')).to_have_count(4)
                expect(page.locator('#graph-title')).to_contain_text('虚构')
                page.locator('.zlg-result-title').first.click()
                expect(page.locator('#graph-detail')).to_be_visible()
                print(json.dumps(dict(standalone_fictional_demo='passed')),flush=True)
        except Exception:
            page.screenshot(path='/tmp/zlg-ui-failure.png')
            print(json.dumps(dict(width=width,theme=theme,failure=page.locator('body').inner_text()),ensure_ascii=False),flush=True)
            raise
        assert not errors,errors
        page.close()
    browser.close()
