"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const modules=require("../src/module-map.js");
const {SCHEMA}=require("../src/config/settings.js");
const defaults={};
vm.runInNewContext(fs.readFileSync(path.join(root,"prefs.js"),"utf8"),{pref:(name,value)=>{defaults[name]=value;}});
for(const spec of Object.values(SCHEMA))assert.equal(defaults[spec.name],spec.defaultValue,`Runtime schema and Zotero defaults differ: ${spec.name}`);
const scope=vm.createContext({Zotero:{},Services:{},URL,console});
for(const file of modules){
  const source=fs.readFileSync(path.join(root,file),"utf8");
  if(file.startsWith("src/domain/"))assert.doesNotMatch(source,/\b(?:Zotero|Services|IOUtils)\./,"Domain must be independent of Zotero and storage");
  vm.runInContext(source,scope,{filename:file});
}
for(const name of ["ZLGSettings","ZLGCore","ZLGDiscoveryCore","ZLGOpenAlexProvider","ZLGSessionStore","ZLGPreferencesIntegration","ZLGDiscoveryService","LiteratureGraph"])assert.ok(scope[name],`${name} missing from the actual runtime load order`);
assert.equal(new Set(modules).size,modules.length);
console.log("module structure tests passed");
