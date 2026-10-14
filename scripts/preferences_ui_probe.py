"""Settings UI with the real configuration service and synthetic local storage only."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/previews-0.8.7'
OUT.mkdir(exist_ok=True)
MOCK='''
const defaults=new Map(Object.values(ZLGSettings.SCHEMA).map(spec=>[spec.name,spec.defaultValue]));
window.userValues=new Map();window.failNextWrite=false;window.launched=[];
window.settings=new ZLGSettings.SettingsService({
 get:name=>userValues.has(name)?userValues.get(name):defaults.get(name),
 set:(name,value)=>{if(failNextWrite){failNextWrite=false;throw new Error('synthetic disk failure');}userValues.set(name,value);},
 clear:name=>userValues.delete(name),hasUserValue:name=>userValues.has(name)
});
window.Zotero={LiteratureGraphPreferences:{hostLocale:"zh-CN",snapshot:()=>settings.snapshot(),update:patch=>settings.update(patch),subscribe:listener=>settings.subscribe(listener)},launchURL:url=>launched.push(url)};
'''
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    for theme,width in [('light',900),('dark',900),('light',600)]:
        page=browser.new_page(viewport=dict(width=width,height=1000),color_scheme=theme)
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        def route(request):
            fragment=(ROOT/'ui/preferences.xhtml').read_text().replace('html:','')
            css=(ROOT/'ui/preferences.css').read_text()
            service=(ROOT/'src/config/settings.js').read_text()
            controller=(ROOT/'ui/preferences.js').read_text()
            html='<html lang="zh-CN"><head><meta charset="utf-8"><style>:root {color-scheme:light dark;--color-background:light-dark(#fff,#1e1e1e);--color-sidepane:light-dark(#f2f2f2,#303030);--color-panedivider:light-dark(#dadada,#404040);--color-button:light-dark(#fff,#404040);--fill-primary:light-dark(#222,#e5e5e5);--fill-secondary:light-dark(#666,#aaa);--color-accent:#4072e5;}body{margin:0;padding:24px;background:var(--color-background);color:var(--fill-primary);font:13px system-ui;}</style><style>'+css+'</style></head><body>'+fragment+'<script>'+(ROOT/'ui/messages.js').read_text()+(ROOT/'ui/i18n.js').read_text()+service+MOCK+controller+';ZLGPreferences.init(document.getElementById("zlg-settings-root"));</script></body></html>'
            request.fulfill(body=html,content_type='text/html')
        page.route('http://zlg.settings.test/**',route)
        page.goto('http://zlg.settings.test/')
        key=page.locator('#zlg-settings-api-key')
        save=page.locator('#zlg-settings-save')
        expect(page.locator('#zlg-settings-key-status')).to_contain_text('匿名访问')
        expect(key).to_have_value('')
        expect(save).to_be_disabled()
        key.fill('synthetic-settings-test-key')
        page.locator('#zlg-settings-result-limit').select_option('40')
        page.locator('#zlg-settings-node-size').select_option('uniform')
        page.locator('#zlg-settings-auto-refresh').uncheck()
        save.click()
        expect(page.locator('#zlg-settings-key-status')).to_contain_text('已保存 Key')
        expect(key).to_have_value('')
        assert page.evaluate('settings.snapshot().resultLimit')==40
        assert not page.evaluate('settings.snapshot().autoRefreshCitations')
        assert 'synthetic-settings-test-key' not in page.evaluate('JSON.stringify(settings.snapshot())')
        # Reopening the same native pane must not refill the saved credential.
        page.evaluate('const root=document.getElementById("zlg-settings-root");root.dispatchEvent(new Event("unload"));ZLGPreferences.init(root)')
        expect(key).to_have_value('')
        expect(page.locator('#zlg-settings-result-limit')).to_have_value('40')
        key.fill('invalid key with spaces')
        save.click()
        expect(page.locator('#zlg-settings-feedback')).to_have_attribute('data-error','true')
        assert page.evaluate('settings.read("apiKey")')=='synthetic-settings-test-key'
        key.fill('')
        page.locator('#zlg-settings-result-limit').select_option('10')
        page.evaluate('failNextWrite=true')
        save.click()
        expect(page.locator('#zlg-settings-feedback')).to_contain_text('原设置已恢复')
        assert page.evaluate('settings.snapshot().resultLimit')==40
        save.click()
        assert page.evaluate('settings.snapshot().resultLimit')==10
        # Ordinary settings saves keep the credential until explicit removal.
        assert page.evaluate('settings.snapshot().apiKeyConfigured')
        page.locator('#zlg-settings-clear-key').click()
        expect(page.locator('#zlg-settings-key-status')).to_contain_text('匿名访问')
        expect(key).to_have_value('')
        assert not page.evaluate('settings.snapshot().apiKeyConfigured')
        page.locator('#zlg-settings-reset').click()
        save.click()
        assert page.evaluate('settings.snapshot().resultLimit')==20
        page.get_by_role('link',name='获取免费 Key').click()
        assert page.evaluate('launched')==['https://openalex.org/settings/api']
        # Language saves keep existing credentials and other preferences.
        page.evaluate('settings.update({apiKey:"synthetic-language-test-key"})')
        page.locator('#zlg-settings-language').select_option('en-US')
        save.click()
        expect(page.locator('#zlg-settings-save')).to_have_text('Save settings')
        expect(page.locator('#zlg-settings-key-status')).to_contain_text('Key saved')
        expect(page.locator('#zlg-settings-language')).to_have_value('en-US')
        expect(key).to_have_value('')
        assert page.evaluate('settings.read("apiKey")')=='synthetic-language-test-key'
        assert page.evaluate('settings.read("resultLimit")')==20
        page.screenshot(path=str(OUT/f'settings-english-{theme}-{width}.png'),full_page=True)
        page.locator('#zlg-settings-language').select_option('zh-CN')
        save.click()
        expect(page.locator('#zlg-settings-save')).to_have_text('保存设置')
        assert page.evaluate('settings.read("apiKey")')=='synthetic-language-test-key'
        page.locator('#zlg-settings-language').select_option('auto')
        save.click()
        expect(page.locator('#zlg-settings-save')).to_have_text('保存设置')
        page.locator('#zlg-settings-clear-key').click()
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        assert not errors,errors
        page.screenshot(path=str(OUT/f'settings-{theme}-{width}.png'),full_page=True)
        page.evaluate('document.getElementById("zlg-settings-root").dispatchEvent(new Event("unload"))')
        assert page.evaluate('settings.listeners.size')==0
        print(json.dumps(dict(settings_ui='passed',theme=theme,width=width)),flush=True)
        page.close()
    browser.close()
