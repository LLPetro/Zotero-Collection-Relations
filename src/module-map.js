/* Runtime order: domain rules, settings/storage/providers, Zotero adapters, services, app. */
var ZLGRuntimeModules = Object.freeze([
  "ui/messages.js",
  "ui/i18n.js",
  "src/domain/relation-core.js",
  "src/domain/identity-core.js",
  "src/domain/discovery-core.js",
  "src/config/settings.js",
  "src/infrastructure/relation-store.js",
  "src/infrastructure/openalex-provider.js",
  "src/infrastructure/session-store.js",
  "src/integrations/zotero-adapter.js",
  "src/integrations/preferences.js",
  "src/services/discovery-service.js",
  "src/app/literature-graph.js",
]);
if (typeof module !== "undefined" && module.exports) module.exports = ZLGRuntimeModules;
