#!/usr/bin/env bash
set -euo pipefail

plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

while IFS= read -r file; do
  node --check "$file"
done < <(rg --files --hidden -g '*.js' "$plugin_root/src" "$plugin_root/ui" "$plugin_root/tests" "$plugin_root/scripts"; printf '%s\n' "$plugin_root/bootstrap.js" "$plugin_root/prefs.js")

node "$plugin_root/tests/core.test.js"
node "$plugin_root/tests/settings.test.js"
node --test "$plugin_root/tests/i18n.test.js"
node "$plugin_root/tests/module-structure.test.js"
node --test "$plugin_root/tests/demo.test.js"
node "$plugin_root/tests/collection-navigation.test.js"
node "$plugin_root/tests/collection-tree.test.js"
node "$plugin_root/tests/discovery.test.js"
node "$plugin_root/tests/session.test.js"
node "$plugin_root/tests/service.test.js"
node "$plugin_root/tests/performance.test.js"
node "$plugin_root/tests/renderer.test.js"
node "$plugin_root/tests/reduced-motion.test.js"
node "$plugin_root/tests/spatial-regression.test.js"
node "$plugin_root/tests/view-state.test.js"
node --test "$plugin_root/tests/workflow-state.test.js" "$plugin_root/tests/reading-actions.test.js" "$plugin_root/tests/local-reading.test.js"
python3 "$plugin_root/tests/test_publication.py"
python3 -m json.tool "$plugin_root/manifest.json" >/dev/null
rg -q 'const WRITES_COMPILED = false;' "$plugin_root/src/infrastructure/relation-store.js"
rg -q 'zlg-item-pane-sidenav-en' "$plugin_root/src/app/literature-graph.js"
rg -q '^zlg-item-pane-sidenav =$' "$plugin_root/locale/en-US/literature-graph.ftl"
rg -q '^zlg-item-pane-sidenav =$' "$plugin_root/locale/zh-CN/literature-graph.ftl"
rg -q 'context-(fill|stroke)' "$plugin_root/icons/20/relation.svg"
test "$(rg -o 'data-zlg-combobox=' "$plugin_root/ui/graph.xhtml" | wc -l)" -eq 3
rg -q 'setAttribute\("role", "combobox"\)' "$plugin_root/ui/graph-window.js"
rg -q 'setAttribute\("role", "listbox"\)' "$plugin_root/ui/graph-window.js"
rg -q 'role="list" aria-label="文献结果"' "$plugin_root/ui/graph.xhtml"
rg -q 'row.setAttribute\("role", "listitem"\)' "$plugin_root/ui/graph-window.js"
rg -q 'role: "button"' "$plugin_root/ui/graph-renderer.js"
rg -q 'nearestDirectionalKey' "$plugin_root/ui/graph-renderer.js"
rg -q 'orderedHitKeys\(this.nodeElements, displayPositions' "$plugin_root/ui/graph-renderer.js"
rg -Fq 'viewportGroup.append(guidesGroup, nodesGroup, edgesGroup)' "$plugin_root/ui/graph-renderer.js"
rg -Fq 'value.visible.setAttribute("marker-end", value.markerEnd)' "$plugin_root/ui/graph-renderer.js"
rg -Fq '.zlg-edges-overlay { pointer-events: none; }' "$plugin_root/ui/graph.css"
rg -Fq 'edgeAtPoint(clientX, clientY' "$plugin_root/ui/graph-renderer.js"
if rg -q 'zlg-edge-hit' "$plugin_root/ui/graph-renderer.js"; then
  echo "Per-edge transparent SVG hit paths must not return; use canvas geometry hit testing" >&2
  exit 1
fi
rg -q 'this.detailRequests = new Map\(\)' "$plugin_root/ui/graph-renderer.js"
rg -q '结果上限：' "$plugin_root/ui/graph-window.js"
rg -q 'data-library-source="in"' "$plugin_root/ui/graph.xhtml"
rg -q 'id="filter-has-pdf"' "$plugin_root/ui/graph.xhtml"
rg -q 'id="active-filters"' "$plugin_root/ui/graph.xhtml"
rg -q 'ZLGViewState.modeCacheKey' "$plugin_root/ui/graph-window.js"
rg -q 'ZLGViewState.createMutationQueue' "$plugin_root/ui/graph-window.js"
rg -Fq 'enqueueSessionMutation(() => args.refreshCitationCounts' "$plugin_root/ui/graph-window.js"
rg -q 'hopSync.rollbackHop' "$plugin_root/ui/graph-window.js"
rg -Fq 'const preserveSimulation = Boolean(this.frame || this.reducedTimer)' "$plugin_root/ui/graph-renderer.js"
rg -q 'this.mutationQueue = Promise.resolve' "$plugin_root/src/infrastructure/session-store.js"
if rg -q 'modeCacheKey\([^)]*\).*filterSignature' "$plugin_root/ui/graph-window.js"; then
  echo "Discovery cache keys must not include UI-local filters" >&2
  exit 1
fi
rg -q 'queryTimer = window.setTimeout' "$plugin_root/ui/graph-window.js"
rg -q 'yearRangeState\(\).invalid' "$plugin_root/ui/graph-window.js"
rg -q 'id="node-size-mode"' "$plugin_root/ui/graph.xhtml"
rg -Fq 'data: visibleData(),' "$plugin_root/ui/graph-window.js"
rg -q 'citationScaleStats' "$plugin_root/ui/graph-renderer.js"
rg -q 'refreshCitationCounts' "$plugin_root/src/services/discovery-service.js"
rg -q 'OpenAlex 被引：' "$plugin_root/ui/graph-renderer.js"
rg -q 'className = "zlg-semantic-warning"' "$plugin_root/ui/graph-renderer.js"
rg -q 'semanticWarningText' "$plugin_root/tests/renderer.test.js"
rg -q 'id="session-state-dialog"' "$plugin_root/ui/graph.xhtml"
rg -q 'restoreAdjustedEntries' "$plugin_root/ui/graph-window.js"
rg -q 'nodeActionSpecs' "$plugin_root/ui/graph-renderer.js"
rg -q 'activeSeedWorkKeys' "$plugin_root/src/domain/discovery-core.js"
rg -q '\.zlg-native-select \{ display: none !important; \}' "$plugin_root/ui/graph.css"
if rg -q 'currentColor' "$plugin_root/icons"; then
  echo "Zotero background-image icons must use context-fill/context-stroke, not currentColor" >&2
  exit 1
fi
if [[ -f "$plugin_root/dist/BASELINES.sha256" ]]; then
  (cd "$plugin_root/dist" && sha256sum -c BASELINES.sha256)
fi
xpi_path="$(python3 "$plugin_root/scripts/build_xpi.py" | tail -n 1)"
python3 -m zipfile -t "$xpi_path"
