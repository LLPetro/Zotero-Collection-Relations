"""Test interface languages using fictional metadata and local callbacks only."""
from pathlib import Path
import ast
import json
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/previews-0.8.7'
OUT.mkdir(exist_ok=True)
module=ast.parse((ROOT/'scripts/collection_navigation_ui_probe.py').read_text())
BASE=next(ast.literal_eval(statement.value) for statement in module.body if isinstance(statement,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='MOCK' for target in statement.targets))
MOCK=BASE.replace('window.navigationListeners=new Set();','window.testLanguage="auto";window.testHostLocale="en-US";window.navigationListeners=new Set();')
MOCK=MOCK.replace('getSettings:()=>({','hostLocale:window.testHostLocale,getSettings:()=>({language:window.testLanguage,')
MOCK+='''
const originalFixtureArgs=window.fixtureArgs;
fixtureScopes.get(1).nodes[0].title='设置';
window.fixtureArgs=id=>({
 ...originalFixtureArgs(id),
 getLocalDetail:async()=>({title:'设置',authors:[{name:'中文作者'}],abstract:'未知',publicationTitle:'中文期刊',collections:[{name:'文献集关系',path:'文献集关系'}],attachments:[{key:'1:EXAMPLE_ATTACHMENT',title:'未命名文献',isPDF:false}],notes:[{key:'1:EXAMPLE_NOTE',title:'文献集',preview:'已保存。'}]})
});
window.arguments=[fixtureArgs(1)];
window.changeLanguage=language=>{
 window.testLanguage=language;
 for(const listener of navigationListeners)listener({language,nodeSizeMode:'citations',autoRefreshCitations:false},['language']);
};
'''

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    for theme,width in [('light',1440),('dark',1440),('light',760)]:
        page=browser.new_page(viewport=dict(width=width,height=900),color_scheme=theme,reduced_motion='reduce')
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        def route(request):
            if not request.request.url.startswith('http://language.test/'):
                request.abort();return
            name=request.request.url.split('/')[-1].split('?')[0]
            content=(ROOT/'ui'/name).read_text()
            if name=='graph.xhtml':
                core=(ROOT/'src/domain/discovery-core.js').read_text()
                content=content.replace('<script src="view-state.js','<script>'+core+';'+MOCK+'</script><script src="view-state.js')
            request.fulfill(body=content,content_type='text/html; charset=utf-8' if name.endswith('xhtml') else 'text/css' if name.endswith('css') else 'application/javascript')
        page.route('**/*',route)
        page.goto('http://language.test/graph.xhtml')
        expect(page.locator('#workspace-collection')).to_have_text('Collection relations')
        expect(page.locator('#open-settings')).to_have_text('Settings')
        expect(page.locator('#run-discovery')).to_have_text('Search (1)')
        expect(page.locator('html')).to_have_attribute('lang','en-US')
        expect(page.locator('.zlg-result-row')).to_have_count(2)
        original_title=page.locator('.zlg-result-title').first.inner_text()
        page.locator('#filter-query').fill(original_title)
        expect(page.locator('.zlg-result-row')).to_have_count(1)
        page.locator('.zlg-result-title').click()
        expect(page.locator('#graph-detail h2')).to_have_text(original_title)
        expect(page.locator('.zlg-note-card strong')).to_have_text('文献集')
        expect(page.locator('.zlg-note-card span')).to_have_text('已保存。')
        expect(page.locator('.zlg-local-row')).to_contain_text('未命名文献')
        expect(page.locator('#graph-detail')).to_contain_text('未知')
        # Even metadata identical to a UI message must remain in its original language.
        notes=page.locator('#graph-detail details').filter(has=page.locator('h3',has_text='Zotero notes'))
        notes.locator('summary').click()
        expect(notes).to_have_attribute('open','')
        page.wait_for_timeout(700)
        before=page.evaluate('JSON.stringify(fixtureScopes.get(1).session)')
        queue=page.locator('[data-remove-seed]').get_attribute('data-remove-seed')
        page.evaluate('changeLanguage("zh-CN")')
        expect(page.locator('#workspace-collection')).to_have_text('文献集关系')
        expect(page.locator('#open-settings')).to_have_text('设置')
        expect(page.locator('#filter-query')).to_have_value(original_title)
        expect(page.locator('#graph-detail h2')).to_have_text(original_title)
        expect(page.locator('#run-discovery')).to_have_text('开始查找（1 篇）')
        expect(page.locator('.zlg-note-card strong')).to_have_text('文献集')
        expect(page.locator('.zlg-note-card span')).to_have_text('已保存。')
        expect(page.locator('#graph-detail details').filter(has=page.locator('h3',has_text='Zotero 笔记'))).to_have_attribute('open','')
        page.evaluate('changeLanguage("en-US")')
        expect(page.locator('#workspace-collection')).to_have_text('Collection relations')
        expect(page.locator('#graph-detail h2')).to_have_text(original_title)
        expect(page.locator('.zlg-note-card strong')).to_have_text('文献集')
        expect(page.locator('.zlg-note-card span')).to_have_text('已保存。')
        assert page.evaluate('JSON.stringify(fixtureScopes.get(1).session)')==before
        assert page.locator('[data-remove-seed]').get_attribute('data-remove-seed')==queue
        assert page.evaluate('scopeCalls')==[]
        assert page.evaluate('navigationListeners.size')==1
        # Scope picker translates controls but preserves actual collection names.
        page.locator('#switch-collection').click()
        expect(page.locator('#collection-dialog-title')).to_have_text('Switch collection')
        expect(page.locator('#collection-apply')).to_have_text('Open collection')
        expect(page.locator('#collection-query')).to_have_attribute('placeholder','Search collection name or path')
        expect(page.locator('#zlg-collection-1 .zlg-collection-name')).to_have_text('示例文献集 1')
        page.evaluate('changeLanguage("zh-CN")')
        expect(page.locator('#collection-dialog-title')).to_have_text('切换文献集')
        expect(page.locator('#collection-apply')).to_have_text('打开文献集')
        page.get_by_role('button',name='取消',exact=True).click()
        page.evaluate('changeLanguage("auto")')
        expect(page.locator('#workspace-collection')).to_have_text('Collection relations')
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        page.screenshot(path=str(OUT/f'language-english-{theme}-{width}.png'))
        assert not errors,errors
        print(json.dumps(dict(theme=theme,width=width,autoEnglish=True,switchBackAndForth=True,metadataAndQueuePreserved=True,notesAndAbstractUntranslated=True,filterAndSelectionPreserved=True,noNewRequests=True)),flush=True)
        page.close()
    browser.close()
