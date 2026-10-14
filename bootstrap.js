var ZLGMessages;
var ZLGI18n;
var ZLGT;
var ZLGCore;
var ZLGRelationStore;
var ZLGIdentity;
var ZLGDiscoveryCore;
var ZLGOpenAlexProvider;
var ZLGSessionStore;
var ZLGZoteroAdapter;
var ZLGDiscoveryService;
var ZLGSettings;
var ZLGPreferencesIntegration;
var ZLGRuntimeModules;
var LiteratureGraph;
var chromeHandle;

function log(message) {
  Zotero.debug("[Zotero Collection Relations] " + message);
}

function install() {
  log("Installed");
}

async function startup({ id, version, rootURI }) {
  log("Starting " + version);
  const addonManagerStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Ci.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = addonManagerStartup.registerChrome(manifestURI, [
    ["content", "zotero-literature-graph", "ui/"],
  ]);

  try {
    Services.scriptloader.loadSubScript(rootURI + "src/module-map.js");
    for (const modulePath of ZLGRuntimeModules) {
      Services.scriptloader.loadSubScript(rootURI + modulePath);
    }
    await LiteratureGraph.init({ id, version, rootURI });
    LiteratureGraph.addToAllWindows();
  } catch (error) {
    shutdown();
    throw error;
  }
}

function onMainWindowLoad({ window }) {
  if (LiteratureGraph?.initialized) LiteratureGraph.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  LiteratureGraph?.removeFromWindow(window);
}

function shutdown() {
  log("Shutting down");
  LiteratureGraph?.shutdown();
  chromeHandle?.destruct();
  chromeHandle = undefined;
  LiteratureGraph = undefined;
  ZLGPreferencesIntegration = undefined;
  ZLGSettings = undefined;
  ZLGRuntimeModules = undefined;
  ZLGDiscoveryService = undefined;
  ZLGZoteroAdapter = undefined;
  ZLGSessionStore = undefined;
  ZLGOpenAlexProvider = undefined;
  ZLGDiscoveryCore = undefined;
  ZLGIdentity = undefined;
  ZLGRelationStore = undefined;
  ZLGCore = undefined;
  ZLGMessages = undefined;
  ZLGI18n = undefined;
  ZLGT = undefined;
}

function uninstall() {
  log("Uninstalled");
}
