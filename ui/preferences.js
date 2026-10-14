if (typeof module !== "undefined" && module.exports) { var ZLGI18n = require("./i18n.js"); var ZLGT = ZLGI18n.t; }
/* global Zotero */
var ZLGPreferences = (() => {
  "use strict";
  const instances=new WeakMap();

  function init(root) {
    if (instances.has(root)) return;
    const doc=root.ownerDocument;
    const api=Zotero.LiteratureGraphPreferences;
    const get=id=>doc.getElementById(`zlg-settings-${id}`);
    const controls={language:get("language"),key:get("api-key"),show:get("show-key"),clear:get("clear-key"),limit:get("result-limit"),size:get("node-size"),refresh:get("auto-refresh"),demo:get("demo"),save:get("save"),reset:get("reset"),feedback:get("feedback")};
    const dirty=new Set();
    const cleanups=[];
    const on=(element,type,listener)=>{element.addEventListener(type,listener);cleanups.push(()=>element.removeEventListener(type,listener));};
    const feedback=(text,error=false)=>{controls.feedback.textContent=text;controls.feedback.dataset.error=String(error);};
    const clearDraftKey=()=>{controls.key.value="";controls.key.type="password";controls.show.textContent=ZLGT("显示");controls.show.setAttribute("aria-pressed","false");};
    const sync=state=>{
      ZLGI18n.configure({language:state.language || "auto",hostLocale:api.hostLocale || doc.documentElement.lang || "en-US"});
      ZLGI18n.localizeDOM(doc);
      for(const section of doc.querySelectorAll(".zlg-settings-section,.zlg-settings-actions"))section.lang=ZLGI18n.locale();
      if(!dirty.has("language"))controls.language.value=state.language || "auto";
      controls.show.textContent=ZLGT(controls.key.type === "password" ? "显示" : "隐藏");
      if(controls.feedback.textContent)controls.feedback.textContent=ZLGT(controls.feedback.textContent);
      get("key-status").textContent=state.apiKeyConfigured?ZLGT("已保存 Key · 未验证"):ZLGT("匿名访问 · 未配置 Key");
      controls.key.placeholder=state.apiKeyConfigured?ZLGT("留空保留当前 Key"):ZLGT("输入你的 API Key");
      controls.clear.disabled=!state.apiKeyConfigured;
      if(!dirty.has("resultLimit"))controls.limit.value=String(state.resultLimit);
      if(!dirty.has("nodeSizeMode"))controls.size.value=state.nodeSizeMode;
      if(!dirty.has("autoRefreshCitations"))controls.refresh.checked=state.autoRefreshCitations;
      if(!dirty.has("demoMode"))controls.demo.checked=state.demoMode;
      get("persistence").textContent=state.sessionPersistence?ZLGT("队列和历史保存在本机，不修改文献。"):ZLGT("临时探索：关闭后不保存。");
    };
    if(!api){feedback(ZLGT("设置未加载，请重新启用插件。"),true);return;}
    sync(api.snapshot());
    for(const [name,element] of [["language",controls.language],["apiKey",controls.key],["resultLimit",controls.limit],["nodeSizeMode",controls.size],["autoRefreshCitations",controls.refresh],["demoMode",controls.demo]]){
      on(element,element===controls.key?"input":"change",()=>{dirty.add(name);controls.save.disabled=false;feedback(ZLGT("尚未保存。"));});
    }
    on(controls.show,"click",()=>{
      const visible=controls.key.type==="password";
      controls.key.type=visible?"text":"password";
      controls.show.textContent=visible?ZLGT("隐藏"):ZLGT("显示");
      controls.show.setAttribute("aria-pressed",String(visible));
    });
    on(controls.save,"click",()=>{
      const patch={language:controls.language.value,resultLimit:Number(controls.limit.value),nodeSizeMode:controls.size.value,autoRefreshCitations:controls.refresh.checked,demoMode:controls.demo.checked};
      if(controls.key.value.trim())patch.apiKey=controls.key.value.trim();
      try{
        const state=api.update(patch);
        clearDraftKey();
        dirty.clear();controls.save.disabled=true;sync(state);
        feedback(ZLGT("已保存。"));
      }catch(error){
        feedback(error.message === "Invalid settings update" ? ZLGT("输入无效，请检查 Key 和选项。") : error.rollbackIncomplete ? ZLGT("保存失败，未完全恢复。请重新打开设置核对。") : ZLGT("保存失败，原设置已恢复。请重试。"),true);
      }
    });
    on(controls.clear,"click",()=>{
      try{
        sync(api.update({apiKey:""}));clearDraftKey();dirty.delete("apiKey");controls.save.disabled=dirty.size===0;
        feedback(ZLGT("已清除 Key，改用匿名访问。"));
      }catch(error){feedback(error.rollbackIncomplete?ZLGT("清除失败，请重新打开设置核对。"):ZLGT("清除失败，原 Key 已保留。"),true);}
    });
    on(controls.reset,"click",()=>{
      controls.language.value="auto";controls.limit.value="20";controls.size.value="citations";controls.refresh.checked=true;controls.demo.checked=true;
      for(const name of ["language","resultLimit","nodeSizeMode","autoRefreshCitations","demoMode"])dirty.add(name);
      controls.save.disabled=false;feedback(ZLGT("已重置选项，点击保存生效。"));
    });
    for(const link of doc.querySelectorAll(".zlg-settings-link"))on(link,"click",event=>{event.preventDefault();Zotero.launchURL(link.href);});
    cleanups.push(api.subscribe(state=>sync(state)));
    const dispose=()=>{controls.key.value="";for(const cleanup of cleanups)cleanup();instances.delete(root);};
    root.addEventListener("unload",dispose,{once:true});
    instances.set(root,{dispose});
  }
  return {init};
})();
