if (typeof module !== "undefined" && module.exports) { var ZLGI18n = require("../../ui/i18n.js"); var ZLGT = ZLGI18n.t; }
/* global Zotero */
var ZLGPreferencesIntegration = (() => {
  "use strict";
  const PANE_ID = "zlg-preferences";

  class PreferencesIntegration {
    constructor({pluginID,settings}) {
      this.pluginID=pluginID;
      this.settings=settings;
      this.paneID=null;
      this.publicAPI=null;
    }

    async register() {
      if (this.paneID) return this.paneID;
      this.publicAPI=Object.freeze({
        hostLocale: Zotero.locale || "en-US",
        snapshot:()=>this.settings.snapshot(),
        update:patch=>this.settings.update(patch),
        subscribe:listener=>this.settings.subscribe(listener),
        initializeUI:root=>{
          const host=root.ownerDocument.defaultView;
          const scope=host.Zotero_Preferences.getScope(PANE_ID);
          scope.ZLGPreferences.init(root);
        },
      });
      Zotero.LiteratureGraphPreferences=this.publicAPI;
      try {
        this.paneID=await Zotero.PreferencePanes.register({
          pluginID:this.pluginID,
          id:PANE_ID,
          label:"Zotero Collection Relations",
          src:"ui/preferences.xhtml",
          scripts:["ui/messages.js","ui/i18n.js","ui/preferences.js"],
          stylesheets:["ui/preferences.css"],
          image:"icons/20/relation.svg",
        });
        return this.paneID;
      } catch (error) {
        this.unregister();
        throw error;
      }
    }

    open() {
      if (!this.paneID) throw new Error(ZLGT("设置面板尚未加载"));
      return Zotero.Utilities.Internal.openPreferences(this.paneID);
    }

    unregister() {
      if (this.paneID) Zotero.PreferencePanes.unregister(this.paneID);
      if (Zotero.LiteratureGraphPreferences===this.publicAPI) delete Zotero.LiteratureGraphPreferences;
      this.paneID=null;
      this.publicAPI=null;
    }
  }
  return {PANE_ID,PreferencesIntegration};
})();
