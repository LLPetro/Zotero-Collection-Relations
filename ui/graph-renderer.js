if (typeof module !== "undefined" && module.exports) { var ZLGI18n = require("./i18n.js"); var ZLGT = ZLGI18n.t; }
var ZLGGraphRenderer = (() => {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const HOVER_LENS_DELAY_MS = 80;
  const LAYOUT_ALGORITHM_VERSION = "zlg-layout-v9";
  const ZOOM_WHEEL_SENSITIVITY = 0.0022;
  const WHEEL_LINE_PIXELS = 40;
  const MAX_WHEEL_DELTA_PIXELS = 180;
  const NODE_SIZE_MODES = new Set(["citations", "degree", "uniform"]);
  const CITATION_RADIUS_MIN = 8;
  const CITATION_RADIUS_MAX = 17;
  const CAPTION_TITLE_SIZE = 13;
  const CAPTION_META_SIZE = 12;
  const CAPTION_WIDTH = 184;
  const COLORS = { seed: "var(--zlg-blue)", local: "var(--zlg-teal)", external: "var(--zlg-node-external)", pinned: "var(--zlg-purple)", retracted: "var(--zlg-danger)" };
  const EDGE_COLORS = {
    cites: "var(--zlg-node-external)", extends: "#4f7cff", modifies: "#7357d8", validates: "#1f9d75",
    contradicts: "#d85858", comparesWith: "#d58b31", usesData: "#16a3a3", usesModel: "#376fc8",
    reviews: "#8b6d4d", sameMethod: "#7b8794", similar: "var(--zlg-purple)",
  };
  const LABELS = {
    cites: ZLGT("引用"), extends: ZLGT("扩展自"), modifies: ZLGT("修正"), validates: ZLGT("验证"), contradicts: ZLGT("反驳/不支持"),
    comparesWith: ZLGT("对比"), usesData: ZLGT("使用数据"), usesModel: ZLGT("使用模型"), reviews: ZLGT("综述"), sameMethod: ZLGT("同方法"), similar: ZLGT("OpenAlex 相关推荐"),
  };

  function svgElement(doc, name, attributes = {}) {
    const node = doc.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }

  function keyOf(value) {
    if (typeof value === "string") return value;
    if (value?.workKey) return value.workKey;
    return `${value?.libraryID}:${value?.itemKey}`;
  }

  function edgeKeys(edge) {
    return {
      source: edge.sourceWorkKey || keyOf(edge.source),
      target: edge.targetWorkKey || keyOf(edge.target),
    };
  }

  function edgeKey(edge) {
    const keys = edgeKeys(edge);
    return edge.edgeKey || `${keys.source}:${edge.type}:${keys.target}`;
  }

  function edgeLineGeometry(source, target, sourceRadius = 8, targetRadius = 8) {
    if (!source || !target) return null;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const startX = source.x + dx / distance * (Number(sourceRadius) + 2);
    const startY = source.y + dy / distance * (Number(sourceRadius) + 2);
    const endX = target.x - dx / distance * (Number(targetRadius) + 7);
    const endY = target.y - dy / distance * (Number(targetRadius) + 7);
    return { startX, startY, endX, endY, path: `M ${startX} ${startY} L ${endX} ${endY}` };
  }

  function shortText(value, max = 34) {
    const text = String(value || "").trim();
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  function estimatedLabelWidth(value, fontSize = 10) {
    return [...String(value || "")].reduce((width, character) => (
      width + (character.codePointAt(0) > 0xff ? fontSize : fontSize * 0.56)
    ), 0);
  }

  function wrapNodeTitle(value, width = CAPTION_WIDTH - 16, measure = text => estimatedLabelWidth(text, CAPTION_TITLE_SIZE)) {
    const text = String(value || ZLGT("未命名文献")).replace(/\s+/g, " ").trim() || ZLGT("未命名文献");
    const characters = [...text];
    const lines = [];
    let cursor = 0;
    while (cursor < characters.length && lines.length < 2) {
      const start = cursor;
      while (cursor < characters.length && measure(characters.slice(start, cursor + 1).join("")) <= width) cursor++;
      if (cursor === start) cursor++;
      if (cursor < characters.length && lines.length === 0) {
        const lastSpace = characters.slice(start, cursor).lastIndexOf(" ");
        if (lastSpace > 0) cursor = start + lastSpace + 1;
        // Avoid an orphan closing bracket or a single-character second line in
        // Chinese titles while retaining word boundaries in Latin titles.
        if (lastSpace < 0 && /[\u3400-\u9fff]/.test(text)) {
          while (cursor > start + 1 && measure(characters.slice(cursor).join("")) < width * 0.35) cursor--;
        }
      }
      let line = characters.slice(start, cursor).join("").trim();
      if (lines.length === 1 && cursor < characters.length) {
        while (line && measure(line + "…") > width) line = [...line].slice(0, -1).join("").trimEnd();
        line += "…";
      }
      lines.push(line);
      while (characters[cursor] === " ") cursor++;
    }
    return lines;
  }

  function nodeAuthorYear(node = {}) {
    const author = node.authors?.[0];
    const name = String(author?.family || author?.familyName || author?.name || "").trim();
    const shortName = (name.includes(",") ? name.split(",")[0].trim() : name).replace(/\s+et\s+al\.?$/i, "");
    return [shortName, node.year].filter(Boolean).join(" · ");
  }

  function captionPlacement(point, radius, width, height, bounds, obstacles = [], occupied = [], force = false, preferred = null) {
    const gap = 9;
    const candidates = [
      { left: point.x - width / 2, top: point.y + radius + gap },
      { left: point.x + radius + gap, top: point.y - height / 2 },
      { left: point.x - radius - gap - width, top: point.y - height / 2 },
      { left: point.x - width / 2, top: point.y - radius - gap - height },
    ];
    if (preferred) candidates.unshift({ left: point.x + preferred.x, top: point.y + preferred.y, sticky: true });
    const intersects = (a, b) => a.right + 4 > b.left && a.left - 4 < b.right && a.bottom + 3 > b.top && a.top - 3 < b.bottom;
    for (const candidate of candidates) {
      const box = { ...candidate, right: candidate.left + width, bottom: candidate.top + height };
      if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom) continue;
      if (force && candidate.sticky) return box;
      if (obstacles.some(other => intersects(box, other)) || occupied.some(other => intersects(box, other))) continue;
      return box;
    }
    if (!force) return null;
    // Selected labels stay readable. Clamp the label, never move the graph just
    // to make room for an unselected caption.
    const candidate = candidates[0];
    const left = Math.max(bounds.left, Math.min(bounds.right - width, candidate.left));
    const top = Math.max(bounds.top, Math.min(bounds.bottom - height, candidate.top));
    return { left, top, right: left + width, bottom: top + height };
  }

  function hashUnit(value) {
    let hash = 2166136261;
    for (const character of String(value || "")) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
  }

  function clonePositionMap(positions = new Map(), zeroVelocity = false) {
    return new Map([...positions].map(([key, value]) => [key, {
      ...value,
      vx: zeroVelocity ? 0 : Number(value.vx) || 0,
      vy: zeroVelocity ? 0 : Number(value.vy) || 0,
    }]));
  }

  function semanticHeatFloor(data = {}) {
    return (data.nodes || []).length <= 60 ? 0.40 : 0.30;
  }

  function normalizedWheelDelta(deltaY, deltaMode = 0, viewportHeight = 800) {
    const raw = Number(deltaY) || 0;
    const pixels = deltaMode === 1
      ? raw * WHEEL_LINE_PIXELS
      : deltaMode === 2
        ? raw * Math.max(1, Number(viewportHeight) || 800)
        : raw;
    return Math.max(-MAX_WHEEL_DELTA_PIXELS, Math.min(MAX_WHEEL_DELTA_PIXELS, pixels));
  }

  function zoomFactorForWheel(deltaY, deltaMode = 0, viewportHeight = 800) {
    return Math.exp(-normalizedWheelDelta(deltaY, deltaMode, viewportHeight) * ZOOM_WHEEL_SENSITIVITY);
  }

  function dragThresholdExceeded(deltaX, deltaY, threshold = 4) {
    return Math.hypot(Number(deltaX) || 0, Number(deltaY) || 0) > Math.max(0, Number(threshold) || 0);
  }

  function selectionRevealDelta({ visibleLeft, visibleRight, haloLeft, haloRight, labelLeft = null, labelRight = null, labelCoverage = 0.75 } = {}) {
    const values = [visibleLeft, visibleRight, haloLeft, haloRight].map(Number);
    if (values.some(value => !Number.isFinite(value)) || values[1] <= values[0] || values[3] <= values[2]) return 0;
    const haloMinimum = values[0] - values[2];
    const haloMaximum = values[1] - values[3];
    let minimum = haloMinimum;
    let maximum = haloMaximum;
    const left = Number(labelLeft);
    const right = Number(labelRight);
    const fraction = Math.max(0, Math.min(1, Number(labelCoverage) || 0));
    if (Number.isFinite(left) && Number.isFinite(right) && right > left && fraction > 0) {
      const requiredWidth = (right - left) * fraction;
      minimum = Math.max(minimum, values[0] + requiredWidth - right);
      maximum = Math.min(maximum, values[1] - requiredWidth - left);
    }
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    if (minimum <= maximum) return clamp(0, minimum, maximum);
    return clamp(0, haloMinimum, haloMaximum);
  }

  function citationCountOf(value) {
    if (value === null || value === undefined || value === "") return null;
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? count : null;
  }

  function citationScaleStats(nodes = []) {
    const counts = nodes.map(node => citationCountOf(node.citationCount))
      .filter(count => count !== null)
      .sort((left, right) => left - right);
    const p95Index = counts.length ? Math.max(0, Math.ceil(counts.length * 0.95) - 1) : -1;
    return {
      knownCount: counts.length,
      unknownCount: Math.max(0, nodes.length - counts.length),
      min: counts.length ? counts[0] : null,
      max: counts.length ? counts.at(-1) : null,
      p95: p95Index >= 0 ? counts[p95Index] : null,
    };
  }

  function nodeRadius(node, degree = 0, mode = "citations", citationP95 = null) {
    if (mode === "uniform") return 10;
    if (mode === "degree") return 7 + Math.min(7, Math.sqrt(Math.max(0, Number(degree) || 0)) * 1.8);
    const citations = citationCountOf(node?.citationCount);
    if (citations === null) return CITATION_RADIUS_MIN;
    const ceiling = Math.max(1, Number(citationP95) || citations || 1);
    const ratio = Math.min(1, Math.log1p(citations) / Math.log1p(ceiling));
    return CITATION_RADIUS_MIN + (CITATION_RADIUS_MAX - CITATION_RADIUS_MIN) * ratio;
  }

  function nodeSizeModeLabel(mode) {
    return ({ citations: ZLGT("被引量"), degree: ZLGT("连接数"), uniform: ZLGT("统一") })[mode] || ZLGT("被引量");
  }

  function actionMenuPosition(anchor, menu, viewport, margin = 12, gap = 8) {
    const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
    const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
    const left = clamp(anchor.left, margin, maxLeft);
    const spaceBelow = viewport.height - anchor.bottom - gap - margin;
    const placement = menu.height <= spaceBelow ? "below" : "above";
    const preferredTop = placement === "below"
      ? anchor.bottom + gap
      : anchor.top - gap - menu.height;
    const maxTop = Math.max(margin, viewport.height - menu.height - margin);
    return { left, top: clamp(preferredTop, margin, maxTop), placement };
  }

  function collectionReadingAction(specs) {
    if (specs.length !== 1 || !["reading-list", "unreviewed"].includes(specs[0].action)) return null;
    return specs[0];
  }

  function nodeActionSpecs(node = {}, options = {}) {
    const candidateState = node.candidateState || "unreviewed";
    const hasNeighbors = options.hasNeighbors !== false;
    const queued = Boolean(node.isQueued);
    const protectedFromOrganizing = Boolean(node.isSeed || node.isQueued);
    const organizingProtectionTitle = node.isSeed
      ? ZLGT("结果起点不能隐藏或排除。")
      : node.isQueued
        ? ZLGT("请先移出队列，再隐藏或排除。")
        : ZLGT("可在视图调整中恢复");
    const pending = Boolean(node.isActionPending);
    return [
      {
        action: "seed",
        label: queued ? ZLGT("移出队列") : ZLGT("加入队列"),
        title: queued ? ZLGT("不再作为下次查找起点") : ZLGT("加入下次查找的起点"),
        group: "explore",
        disabled: pending,
      },
      {
        action: candidateState === "reading-list" ? "unreviewed" : "reading-list",
        label: candidateState === "reading-list" ? ZLGT("移出稍后阅读") : ZLGT("加入稍后阅读"),
        title: ZLGT("加入本地阅读清单"),
        group: "explore",
        disabled: pending,
      },
      {
        action: "collapse",
        label: node.isCollapsed ? ZLGT("展开相邻节点") : ZLGT("收起相邻节点"),
        title: node.isCollapsed
          ? ZLGT("恢复该节点周围临时收起的相邻论文")
          : hasNeighbors
            ? ZLGT("收起相邻文献，保留起点和固定显示项")
            : ZLGT("暂无可收起的相邻文献"),
        group: "view",
        // A collapsed node's neighbours are intentionally absent from the
        // focused renderer data. Expansion must remain available regardless.
        disabled: pending || (!node.isCollapsed && !hasNeighbors),
      },
      {
        action: node.isPinned ? "unpin" : "pin",
        label: node.isPinned ? ZLGT("取消保持显示") : ZLGT("保持显示"),
        title: node.isPinned ? ZLGT("恢复正常筛选") : ZLGT("优先显示，不固定位置"),
        group: "view",
        disabled: pending,
      },
      {
        action: candidateState === "excluded" ? "unreviewed" : "exclude",
        label: candidateState === "excluded" ? ZLGT("恢复候选") : ZLGT("标记不相关"),
        title: candidateState === "excluded"
          ? ZLGT("重新纳入候选结果")
          : organizingProtectionTitle,
        group: "organize",
        disabled: pending || (protectedFromOrganizing && candidateState !== "excluded"),
      },
      {
        action: "hide",
        label: ZLGT("隐藏"),
        title: protectedFromOrganizing
          ? organizingProtectionTitle
          : ZLGT("仅从当前图隐藏，可在视图调整中恢复"),
        group: "organize",
        disabled: pending || protectedFromOrganizing,
      },
    ];
  }

  function formatTimestamp(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return String(value);
    return parsed.toLocaleString(ZLGI18n.locale(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function orderedHitKeys(nodeElements, positions, point, zOrderKeys = []) {
    const order = new Map(zOrderKeys.map((key, index) => [key, index]));
    return [...nodeElements.entries()].filter(([key, value]) => {
      const position = positions.get(key);
      return position && Math.hypot(position.x - point.x, position.y - point.y) <= value.radius + 14;
    }).map(([key]) => key).sort((left, right) => (
      (order.get(right) ?? -1) - (order.get(left) ?? -1) || left.localeCompare(right)
    ));
  }

  function nearestDirectionalKey(positions, fromKey, direction) {
    const origin = positions.get(fromKey);
    const vector = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] })[direction];
    if (!origin || !vector) return null;
    let best = null;
    for (const [key, position] of positions) {
      if (key === fromKey) continue;
      const dx = position.x - origin.x;
      const dy = position.y - origin.y;
      const forward = dx * vector[0] + dy * vector[1];
      if (forward <= 0.5) continue;
      const sideways = Math.abs(dx * vector[1] - dy * vector[0]);
      const score = forward + sideways * 2.5;
      if (!best || score < best.score || (score === best.score && key.localeCompare(best.key) < 0)) {
        best = { key, score };
      }
    }
    return best?.key || null;
  }

  function forEachNearbyPair(points, range = 360, cellSize = 120, visit = () => {}) {
    const safeRange = Math.max(1, Number(range) || 360);
    const safeCellSize = Math.max(1, Number(cellSize) || 120);
    const cellRadius = Math.ceil(safeRange / safeCellSize);
    const rangeSquared = safeRange * safeRange;
    const grid = new Map();
    const cellOf = point => ({
      x: Math.floor(point.x / safeCellSize),
      y: Math.floor(point.y / safeCellSize),
    });
    for (let index = 0; index < points.length; index++) {
      const cell = cellOf(points[index]);
      const key = `${cell.x}:${cell.y}`;
      const bucket = grid.get(key) || [];
      bucket.push(index);
      grid.set(key, bucket);
    }
    let pairCount = 0;
    for (let leftIndex = 0; leftIndex < points.length; leftIndex++) {
      const left = points[leftIndex];
      const cell = cellOf(left);
      for (let offsetX = -cellRadius; offsetX <= cellRadius; offsetX++) {
        for (let offsetY = -cellRadius; offsetY <= cellRadius; offsetY++) {
          const bucket = grid.get(`${cell.x + offsetX}:${cell.y + offsetY}`) || [];
          for (const rightIndex of bucket) {
            if (rightIndex <= leftIndex) continue;
            const right = points[rightIndex];
            const dx = left.x - right.x;
            const dy = left.y - right.y;
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared > rangeSquared) continue;
            pairCount++;
            visit(leftIndex, rightIndex, distanceSquared);
          }
        }
      }
    }
    return pairCount;
  }

  function resolveCollisionPair(left, right, minimumDistance, alpha = 1, fallbackAngle = 0) {
    const leftFixed = Boolean(left?.fixed || left?.simulationFixed);
    const rightFixed = Boolean(right?.fixed || right?.simulationFixed);
    if (!left || !right || (leftFixed && rightFixed)) return 0;
    let dx = left.x - right.x;
    let dy = left.y - right.y;
    let distance = Math.hypot(dx, dy);
    if (distance < 0.001) {
      dx = Math.cos(fallbackAngle || 0);
      dy = Math.sin(fallbackAngle || 0);
      distance = 1;
    }
    const overlap = Math.max(0, Number(minimumDistance) - distance);
    if (!overlap) return 0;
    const normalizedAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
    const correction = overlap * Math.min(0.84, 0.34 + normalizedAlpha * 0.5);
    const unitX = dx / distance;
    const unitY = dy / distance;
    const leftShare = leftFixed ? 0 : rightFixed ? 1 : 0.5;
    const rightShare = rightFixed ? 0 : leftFixed ? 1 : 0.5;
    left.x += unitX * correction * leftShare;
    left.y += unitY * correction * leftShare;
    right.x -= unitX * correction * rightShare;
    right.y -= unitY * correction * rightShare;
    return overlap;
  }

  function diffusePoint(position, focus, options = {}) {
    if (!position) return { x: 0, y: 0 };
    const strength = Math.max(0, Math.min(1, Number(options.strength) || 0));
    const radius = Math.max(1, Number(options.radius) || 150);
    const push = Math.max(0, Number(options.push) || 72);
    if (options.anchored || !strength || !focus) return { x: position.x, y: position.y };
    let dx = position.x - focus.x;
    let dy = position.y - focus.y;
    let distance = Math.sqrt(dx * dx + dy * dy);
    if (distance >= radius) return { x: position.x, y: position.y };
    if (distance < 0.001) {
      const angle = Number(options.angle) || 0;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      distance = 1;
    }
    const falloff = 1 - distance / radius;
    const exponent = Math.max(0.5, Number(options.exponent) || 2);
    const displacement = push * strength * Math.pow(falloff, exponent);
    return {
      x: position.x + dx / distance * displacement,
      y: position.y + dy / distance * displacement,
    };
  }

  function adaptiveLensParameters(positions, focusKey, scale = 1, mode = "galaxy") {
    const focus = positions.get(focusKey);
    const safeScale = Math.max(0.22, Number(scale) || 1);
    if (!focus) return { radius: 150 / safeScale, push: 72 / safeScale, exponent: 2, targetCount: 0 };
    const distances = [...positions.entries()].filter(([key]) => key !== focusKey).map(([, position]) => (
      Math.hypot(position.x - focus.x, position.y - focus.y) * safeScale
    )).sort((left, right) => left - right);
    const desiredCount = mode === "timeline" ? 10 : 12;
    const targetCount = Math.min(desiredCount, distances.length);
    const targetDistance = targetCount ? distances[targetCount - 1] : 0;
    const minRadius = mode === "timeline" ? 210 : 180;
    const maxRadius = mode === "timeline" ? 330 : 260;
    const radiusScreen = Math.max(minRadius, Math.min(maxRadius, targetDistance + 34));
    const pushScreen = mode === "timeline" ? 110 : 96;
    return {
      radius: radiusScreen / safeScale,
      push: pushScreen / safeScale,
      radiusScreen,
      pushScreen,
      exponent: 1.4,
      targetCount,
    };
  }

  function nodeColor(node) {
    if (node.localKeys?.length) return COLORS.local;
    return COLORS.external;
  }

  function timelineLaneLayout(nodes, width, height) {
    const years = nodes.map(node => Number(node.year)).filter(Number.isFinite);
    const minYear = years.length ? Math.min(...years) : 1950;
    const maxYear = years.length ? Math.max(...years) : minYear + 1;
    const padX = 70;
    const padY = 58;
    const usableWidth = Math.max(240, width - padX * 2);
    const usableHeight = Math.max(220, height - padY * 2);
    const laneCount = Math.max(4, Math.min(16, Math.floor(usableHeight / 48)));
    const laneSpacing = usableHeight / Math.max(1, laneCount - 1);
    const laneLastX = Array(laneCount).fill(-Infinity);
    const minGapX = 46;
    const positions = new Map();
    const ordered = [...nodes].sort((left, right) => {
      const yearDelta = (Number(left.year) || minYear) - (Number(right.year) || minYear);
      if (yearDelta) return yearDelta;
      const citationDelta = (Number(right.citationCount) || 0) - (Number(left.citationCount) || 0);
      return citationDelta || keyOf(left).localeCompare(keyOf(right));
    });
    for (const node of ordered) {
      const year = Number(node.year) || minYear;
      const ratio = (year - minYear) / Math.max(1, maxYear - minYear);
      const x = padX + ratio * usableWidth;
      const preferred = Math.min(laneCount - 1, Math.floor(hashUnit(`${keyOf(node)}:timeline-lane`) * laneCount));
      const candidates = Array.from({ length: laneCount }, (_, lane) => lane).sort((left, right) => {
        const leftAvailable = laneLastX[left] <= x - minGapX;
        const rightAvailable = laneLastX[right] <= x - minGapX;
        if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1;
        const distanceDelta = Math.abs(left - preferred) - Math.abs(right - preferred);
        return distanceDelta || laneLastX[left] - laneLastX[right];
      });
      const lane = candidates[0];
      laneLastX[lane] = x;
      positions.set(keyOf(node), {
        x,
        y: padY + lane * laneSpacing,
        vx: 0,
        vy: 0,
        fixed: false,
      });
    }
    return positions;
  }

  function buildPhysicsTopology(nodes = [], edges = []) {
    const nodeKeys = [...new Set(nodes.map(keyOf))].sort();
    const nodeMap = new Map(nodes.map(node => [keyOf(node), node]));
    const nodeSet = new Set(nodeKeys);
    const adjacency = new Map(nodeKeys.map(key => [key, new Set()]));
    const pairMap = new Map();
    for (const edge of [...edges].sort((left, right) => edgeKey(left).localeCompare(edgeKey(right)))) {
      const keys = edgeKeys(edge);
      if (!nodeSet.has(keys.source) || !nodeSet.has(keys.target) || keys.source === keys.target) continue;
      const source = keys.source < keys.target ? keys.source : keys.target;
      const target = keys.source < keys.target ? keys.target : keys.source;
      const pairKey = `${source}\0${target}`;
      const link = pairMap.get(pairKey) || { pairKey, source, target, edges: [], types: new Set() };
      link.edges.push(edge);
      link.types.add(edge.type || "cites");
      pairMap.set(pairKey, link);
      adjacency.get(source).add(target);
      adjacency.get(target).add(source);
    }
    const links = [...pairMap.values()].map(link => {
      const types = [...link.types].sort();
      const primaryType = types.includes("cites") ? "cites" : types.find(type => type !== "similar") || "similar";
      return {
        ...link,
        types,
        primaryType,
        multiplicity: link.edges.filter(edge => (edge.type || "cites") === primaryType).length,
      };
    }).sort((left, right) => left.pairKey.localeCompare(right.pairKey));
    const components = [];
    const unseen = new Set(nodeKeys);
    while (unseen.size) {
      const start = [...unseen].sort()[0];
      const queue = [start];
      const keys = [];
      unseen.delete(start);
      while (queue.length) {
        const key = queue.shift();
        keys.push(key);
        for (const neighbor of [...(adjacency.get(key) || [])].sort()) {
          if (!unseen.delete(neighbor)) continue;
          queue.push(neighbor);
        }
      }
      keys.sort();
      components.push({ keys, signature: keys.join("|") });
    }
    components.sort((left, right) => right.keys.length - left.keys.length || left.signature.localeCompare(right.signature));
    const componentByKey = new Map();
    components.forEach((component, index) => component.keys.forEach(key => componentByKey.set(key, index)));
    const degrees = new Map(nodeKeys.map(key => [key, adjacency.get(key).size]));
    const seedKeys = new Set(nodeKeys.filter(key => nodeMap.get(key)?.isSeed));
    const seedNeighborCounts = new Map();
    const seedNeighborsByKey = new Map();
    const nonincidentSeedsByKey = new Map();
    const primarySeedByKey = new Map();
    const candidateSeedNeighbors = nodeKeys.filter(key => !seedKeys.has(key)).map(key => ({
      key,
      seeds: [...adjacency.get(key)].filter(candidate => seedKeys.has(candidate)).sort(),
    })).filter(value => value.seeds.length).sort((left, right) =>
      left.seeds.length - right.seeds.length || left.key.localeCompare(right.key));
    for (const candidate of candidateSeedNeighbors) {
      seedNeighborCounts.set(candidate.key, candidate.seeds.length);
      seedNeighborsByKey.set(candidate.key, candidate.seeds);
      const incident = new Set(candidate.seeds);
      nonincidentSeedsByKey.set(candidate.key, [...seedKeys].filter(key => !incident.has(key)));
      const pairFor = seed => pairMap.get(`${candidate.key < seed ? candidate.key : seed}\0${candidate.key < seed ? seed : candidate.key}`);
      const strength = seed => {
        const link = pairFor(seed);
        const semantic = link?.primaryType === "cites" ? 3 : link?.primaryType === "similar" ? 1 : 2;
        const verified = link?.edges?.some(edge => edge.status === "verified") ? 0.5 : 0;
        return semantic + verified + Math.min(0.5, 0.1 * Math.max(0, (link?.multiplicity || 1) - 1));
      };
      const providerRank = seed => Math.min(...(pairFor(seed)?.edges || []).map(edge => Number(edge.providerPosition) || Infinity), Infinity);
      const primary = [...candidate.seeds].sort((left, right) => {
          const strengthDelta = strength(right) - strength(left);
          if (strengthDelta) return strengthDelta;
          const providerDelta = providerRank(left) - providerRank(right);
          if (providerDelta) return providerDelta;
          const hashDelta = hashUnit(`${candidate.key}\0${left}:owner`) - hashUnit(`${candidate.key}\0${right}:owner`);
          return hashDelta || left.localeCompare(right);
        })[0];
      primarySeedByKey.set(candidate.key, primary);
    }
    return {
      nodeKeys,
      adjacency,
      links,
      components,
      componentByKey,
      degrees,
      seedKeys,
      seedNeighborCounts,
      seedNeighborsByKey,
      nonincidentSeedsByKey,
      primarySeedByKey,
      seedHomePositions: new Map(),
    };
  }

  function seedLayoutGeometry(seedCount) {
    const count = Math.max(0, Number(seedCount) || 0);
    if (count <= 1) return { dense: false, ringRadius: 0, groupSize: 1, groupCount: count, clusterOrbit: 0, maxLocalRadius: 0, extent: 0 };
    if (count <= 12) {
      const ringRadius = Math.max(44, count * 5.5);
      return { dense: false, ringRadius, groupSize: count, groupCount: 1, clusterOrbit: 0, maxLocalRadius: 0, extent: ringRadius };
    }
    const groupSize = Math.max(5, Math.ceil(Math.sqrt(count)));
    const groupCount = Math.ceil(count / groupSize);
    const clusterOrbit = Math.min(165, 82 + groupCount * 14);
    const maxLocalRadius = Math.max(34, Math.min(groupSize, count) * 8);
    return {
      dense: true,
      ringRadius: 0,
      groupSize,
      groupCount,
      clusterOrbit,
      maxLocalRadius,
      extent: clusterOrbit + maxLocalRadius,
    };
  }

  function componentRadius(component, nodeMap, topology) {
    const seedCount = component.keys.filter(key => nodeMap.get(key)?.isSeed).length;
    const seedGeometry = seedLayoutGeometry(seedCount);
    const ownerLoads = new Map();
    for (const key of component.keys) {
      const owner = topology?.primarySeedByKey.get(key);
      if (owner) ownerLoads.set(owner, (ownerLoads.get(owner) || 0) + 1);
    }
    const maximumOwnerLoad = Math.max(0, ...ownerLoads.values());
    const candidateReach = component.keys.length > seedCount
      ? 92 + Math.max(0, Math.floor((maximumOwnerLoad - 1) / 4)) * 28
      : 38;
    return Math.max(48, seedGeometry.extent + candidateReach, 30 + Math.sqrt(component.keys.length) * 38);
  }

  function orderSeedsByAffinity(seedKeys, topology) {
    const seeds = [...seedKeys].sort();
    if (seeds.length <= 2) return seeds;
    const affinity = (left, right) => {
      let score = topology.adjacency.get(left)?.has(right) ? 2 : 0;
      const leftNeighbors = topology.adjacency.get(left) || new Set();
      const rightNeighbors = topology.adjacency.get(right) || new Set();
      for (const key of leftNeighbors) {
        if (!rightNeighbors.has(key)) continue;
        const seedDegree = topology.seedNeighborCounts.get(key) || 1;
        score += 1 / Math.max(1, seedDegree - 1);
      }
      return score;
    };
    let bestPair = null;
    for (let leftIndex = 0; leftIndex < seeds.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < seeds.length; rightIndex++) {
        const pair = { left: seeds[leftIndex], right: seeds[rightIndex], score: affinity(seeds[leftIndex], seeds[rightIndex]) };
        if (!bestPair || pair.score > bestPair.score
          || (pair.score === bestPair.score && `${pair.left}\0${pair.right}` < `${bestPair.left}\0${bestPair.right}`)) bestPair = pair;
      }
    }
    const ordered = [bestPair.left, bestPair.right];
    const remaining = new Set(seeds.filter(key => !ordered.includes(key)));
    while (remaining.size) {
      let choice = null;
      for (const key of [...remaining].sort()) {
        for (let index = 0; index < ordered.length; index++) {
          const left = ordered[index];
          const right = ordered[(index + 1) % ordered.length];
          const gain = affinity(left, key) + affinity(key, right) - affinity(left, right);
          const candidate = { key, index: index + 1, gain };
          if (!choice || candidate.gain > choice.gain
            || (candidate.gain === choice.gain && candidate.key < choice.key)
            || (candidate.gain === choice.gain && candidate.key === choice.key && candidate.index < choice.index)) choice = candidate;
        }
      }
      ordered.splice(choice.index, 0, choice.key);
      remaining.delete(choice.key);
    }
    return ordered;
  }

  function packedComponentCenters(topology, nodeMap, width, height) {
    const cx = width / 2;
    const cy = height / 2;
    const centers = new Map();
    const placed = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const isolateCount = topology.components.filter(component => component.keys.length === 1).length;
    const isolateRows = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(isolateCount))));
    let isolateOrdinal = 0;
    for (const [index, component] of topology.components.entries()) {
      const radius = componentRadius(component, nodeMap, topology);
      if (!index) {
        centers.set(index, { x: cx, y: cy, radius });
        placed.push({ x: cx, y: cy, radius });
        continue;
      }
      if (component.keys.length === 1) {
        const row = isolateOrdinal % isolateRows;
        const column = Math.floor(isolateOrdinal / isolateRows);
        const verticalGap = radius * 2 + 54;
        const mainRadius = placed[0].radius;
        let candidate = {
          x: cx + mainRadius + radius + 150 + column * (radius * 2 + 76),
          y: cy + (row - (isolateRows - 1) / 2) * verticalGap,
          radius,
        };
        while (placed.some(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) < candidate.radius + other.radius + 48)) {
          candidate = { ...candidate, x: candidate.x + radius * 2 + 76 };
        }
        centers.set(index, candidate);
        placed.push(candidate);
        isolateOrdinal++;
        continue;
      }
      const baseAngle = hashUnit(`${component.signature}:component`) * Math.PI * 2;
      let candidate = null;
      for (let attempt = 0; attempt < 1200; attempt++) {
        const shell = Math.floor(attempt / 18) + 1;
        const distance = placed[0].radius + radius + 62 + shell * 42;
        const angle = baseAngle + attempt * goldenAngle;
        const proposed = { x: cx + Math.cos(angle) * distance, y: cy + Math.sin(angle) * distance, radius };
        if (placed.every(other => Math.hypot(proposed.x - other.x, proposed.y - other.y) >= proposed.radius + other.radius + 42)) {
          candidate = proposed;
          break;
        }
      }
      candidate ||= { x: cx + (index + 1) * (radius * 2 + 60), y: cy, radius };
      centers.set(index, candidate);
      placed.push(candidate);
    }
    return centers;
  }

  function topologyInitialPositions(nodes, edges, width, height, existing = new Map(), reset = false) {
    const topology = buildPhysicsTopology(nodes, edges);
    const nodeMap = new Map(nodes.map(node => [keyOf(node), node]));
    const positions = new Map();
    if (!reset) {
      for (const key of topology.nodeKeys) {
        const prior = existing.get(key);
        if (prior) positions.set(key, { ...prior });
      }
    }
    const centers = packedComponentCenters(topology, nodeMap, width, height);
    for (const [componentIndex, component] of topology.components.entries()) {
      const retained = component.keys.map(key => positions.get(key)).filter(Boolean);
      const packed = centers.get(componentIndex);
      const center = retained.length && !reset
        ? {
            ...packed,
            x: retained.reduce((sum, value) => sum + value.x, 0) / retained.length,
            y: retained.reduce((sum, value) => sum + value.y, 0) / retained.length,
          }
        : packed;
      centers.set(componentIndex, center);
      const seeds = orderSeedsByAffinity(component.keys.filter(key => nodeMap.get(key)?.isSeed), topology);
      const seedGeometry = seedLayoutGeometry(seeds.length);
      if (seedGeometry.dense) {
        const groups = Array.from({ length: seedGeometry.groupCount }, (_, index) =>
          seeds.slice(index * seedGeometry.groupSize, (index + 1) * seedGeometry.groupSize));
        for (const [groupIndex, group] of groups.entries()) {
          const clusterAngle = -Math.PI / 2 + groupIndex * Math.PI * 2 / groups.length;
          const clusterX = center.x + Math.cos(clusterAngle) * seedGeometry.clusterOrbit;
          const clusterY = center.y + Math.sin(clusterAngle) * seedGeometry.clusterOrbit;
          const localRadius = group.length > 1 ? Math.max(34, group.length * 8) : 0;
          for (const [localIndex, key] of group.entries()) {
            if (positions.has(key)) continue;
            const localAngle = clusterAngle + localIndex * Math.PI * 2 / group.length;
            positions.set(key, {
              x: clusterX + Math.cos(localAngle) * localRadius,
              y: clusterY + Math.sin(localAngle) * localRadius,
              vx: 0, vy: 0, fixed: false,
            });
          }
        }
      }
      else {
        for (const [index, key] of seeds.entries()) {
          if (positions.has(key)) continue;
          const angle = seeds.length === 1 ? 0 : -Math.PI / 2 + index * Math.PI * 2 / seeds.length;
          positions.set(key, {
            x: center.x + Math.cos(angle) * seedGeometry.ringRadius,
            y: center.y + Math.sin(angle) * seedGeometry.ringRadius,
            vx: 0, vy: 0, fixed: false,
          });
        }
      }
      const unplaced = component.keys.filter(key => !positions.has(key));
      const directSeedNeighbors = new Map(unplaced.map(key => [key, [
        ...(topology.adjacency.get(key) || []),
      ].filter(candidate => nodeMap.get(candidate)?.isSeed).sort()]));
      const seedSiblingGroups = new Map();
      for (const key of unplaced) {
        const seedNeighbors = directSeedNeighbors.get(key);
        if (!seedNeighbors.length) continue;
        const primarySeed = topology.primarySeedByKey.get(key) || seedNeighbors[0];
        const siblings = seedSiblingGroups.get(primarySeed) || [];
        siblings.push(key);
        seedSiblingGroups.set(primarySeed, siblings);
      }
      for (const [index, key] of [...unplaced].entries()) {
        const seedNeighbors = directSeedNeighbors.get(key);
        if (!seedNeighbors.length) continue;
        const primarySeed = topology.primarySeedByKey.get(key) || seedNeighbors[0];
        const anchorX = positions.get(primarySeed).x;
        const anchorY = positions.get(primarySeed).y;
        let angle = Math.atan2(anchorY - center.y, anchorX - center.x);
        let offset = 66;
        const siblings = seedSiblingGroups.get(primarySeed);
        const siblingIndex = siblings.indexOf(key);
        angle += (siblingIndex - (siblings.length - 1) / 2) * 0.28;
        offset += Math.floor(siblingIndex / 4) * 28;
        if (Math.hypot(anchorX - center.x, anchorY - center.y) < 4) {
          angle = hashUnit(`${key}:multi-seed`) * Math.PI * 2;
        }
        positions.set(key, {
          x: anchorX + Math.cos(angle) * offset,
          y: anchorY + Math.sin(angle) * offset,
          vx: 0, vy: 0, fixed: false,
        });
        unplaced.splice(unplaced.indexOf(key), 1);
      }
      let progress = true;
      while (unplaced.length && progress) {
        progress = false;
        for (let index = unplaced.length - 1; index >= 0; index--) {
          const key = unplaced[index];
          const neighbors = [...(topology.adjacency.get(key) || [])].filter(candidate => positions.has(candidate));
          if (!neighbors.length) continue;
          const anchorX = neighbors.reduce((sum, candidate) => sum + positions.get(candidate).x, 0) / neighbors.length;
          const anchorY = neighbors.reduce((sum, candidate) => sum + positions.get(candidate).y, 0) / neighbors.length;
          const angle = hashUnit(`${key}:neighbor-centroid`) * Math.PI * 2;
          const offset = 42 + (Math.floor(hashUnit(`${key}:sibling`) * 3) * 24);
          positions.set(key, {
            x: anchorX + Math.cos(angle) * offset,
            y: anchorY + Math.sin(angle) * offset,
            vx: 0, vy: 0, fixed: false,
          });
          unplaced.splice(index, 1);
          progress = true;
        }
      }
      for (const [index, key] of unplaced.sort().entries()) {
        const angle = hashUnit(`${key}:fallback`) * Math.PI * 2;
        const radius = 76 + 34 * Math.floor(index / 8);
        positions.set(key, {
          x: center.x + Math.cos(angle) * radius,
          y: center.y + Math.sin(angle) * radius,
          vx: 0, vy: 0, fixed: false,
        });
      }
    }
    topology.seedHomePositions = new Map([...topology.seedKeys]
      .filter(key => positions.has(key))
      .map(key => [key, { x: positions.get(key).x, y: positions.get(key).y }]));
    return { positions, topology, centers };
  }

  function enforceSeedProximity(positions, topology, margin = 8, maxStep = 8, alpha = 1, allowedKeys = null) {
    let distanceVisits = 0;
    for (const candidateKey of [...topology.primarySeedByKey.keys()].sort()) {
      const candidate = positions.get(candidateKey);
      if (!candidate || candidate.fixed || (allowedKeys && !allowedKeys.has(candidateKey))) continue;
      const incidentSeeds = topology.seedNeighborsByKey.get(candidateKey) || [];
      const nonincidentSeeds = topology.nonincidentSeedsByKey.get(candidateKey) || [];
      if (!incidentSeeds.length || !nonincidentSeeds.length) continue;
      const distanceTo = key => {
        const value = positions.get(key);
        if (!value) return Infinity;
        distanceVisits++;
        return Math.hypot(candidate.x - value.x, candidate.y - value.y);
      };
      let incidentKey = null;
      let incidentDistance = Infinity;
      for (const key of incidentSeeds) {
        const distance = distanceTo(key);
        if (distance < incidentDistance || (distance === incidentDistance && key < incidentKey)) {
          incidentKey = key;
          incidentDistance = distance;
        }
      }
      let nonincidentKey = null;
      let nonincidentDistance = Infinity;
      for (const key of nonincidentSeeds) {
        const distance = distanceTo(key);
        if (distance < nonincidentDistance || (distance === nonincidentDistance && key < nonincidentKey)) {
          nonincidentKey = key;
          nonincidentDistance = distance;
        }
      }
      if (!incidentKey || !nonincidentKey) continue;
      const incident = positions.get(incidentKey);
      const nonincident = positions.get(nonincidentKey);
      incidentDistance = Math.max(0.01, incidentDistance);
      nonincidentDistance = Math.max(0.01, nonincidentDistance);
      const violation = incidentDistance + margin - nonincidentDistance;
      if (violation <= 0) continue;
      let directionX = (incident.x - candidate.x) / incidentDistance + (candidate.x - nonincident.x) / nonincidentDistance;
      let directionY = (incident.y - candidate.y) / incidentDistance + (candidate.y - nonincident.y) / nonincidentDistance;
      let directionLength = Math.hypot(directionX, directionY);
      if (directionLength < 0.05) {
        directionX = (incident.x - candidate.x) / incidentDistance;
        directionY = (incident.y - candidate.y) / incidentDistance;
        directionLength = 1;
      }
      const heat = Math.max(0, Math.min(1, Number(alpha) || 0));
      const step = Math.min(maxStep * heat, Math.max(0.25 * heat, violation * 0.58 * heat));
      candidate.x += directionX / directionLength * step;
      candidate.y += directionY / directionLength * step;
      candidate.vx *= 0.45;
      candidate.vy *= 0.45;
    }
    return distanceVisits;
  }

  function seedProximityDiagnostics(positions = new Map(), topology = {}, tolerance = 0.5) {
    let hits = 0;
    let violations = 0;
    let worstRank = 0;
    let minimumMargin = Infinity;
    let total = 0;
    for (const [candidateKey, incidentSeeds] of topology?.seedNeighborsByKey || []) {
      const candidate = positions.get(candidateKey);
      if (!candidate || !incidentSeeds.length) continue;
      const incident = new Set(incidentSeeds);
      const ranked = [...(topology.seedKeys || [])].map(seedKey => {
        const seed = positions.get(seedKey);
        return {
          seedKey,
          incident: incident.has(seedKey),
          distance: seed ? Math.hypot(candidate.x - seed.x, candidate.y - seed.y) : Infinity,
        };
      }).sort((left, right) => left.distance - right.distance || left.seedKey.localeCompare(right.seedKey));
      const incidentRank = ranked.findIndex(value => value.incident) + 1;
      const nearestIncident = ranked.find(value => value.incident);
      const nearestNonincident = ranked.find(value => !value.incident);
      if (!incidentRank || !nearestIncident) continue;
      total++;
      hits += Number(incidentRank === 1);
      worstRank = Math.max(worstRank, incidentRank);
      if (nearestNonincident) {
        const margin = nearestNonincident.distance - nearestIncident.distance;
        minimumMargin = Math.min(minimumMargin, margin);
        violations += Number(margin < -Math.abs(Number(tolerance) || 0));
      }
    }
    return {
      total,
      hits,
      rate: total ? hits / total : 1,
      violations,
      worstRank,
      minimumMargin: Number.isFinite(minimumMargin) ? minimumMargin : null,
      exact: !total || (hits === total && violations === 0 && worstRank <= 1),
    };
  }

  function semanticLayoutSatisfied(report, nodeCount = 0) {
    if (!report?.total) return true;
    if (Number(nodeCount) <= 60) return Boolean(report.exact);
    return report.rate >= 0.90
      && report.violations / report.total <= 0.06
      && report.worstRank <= 4;
  }

  function semanticWarningText(report, nodeCount = 0) {
    if (semanticLayoutSatisfied(report, nodeCount)) return "";
    return Number(nodeCount) <= 60
      ? ZLGT("部分节点位置偏离，请以连线关系为准。")
      : ZLGT("密集图位置仅供参考，请以连线关系为准。");
  }

  function semanticWarningForRender(lastSemanticReport, mode = "galaxy") {
    return mode === "galaxy" ? ZLGT(lastSemanticReport?.warning || "") : "";
  }

  function repairSeedProximityViolations(positions = new Map(), topology = {}, radii = new Map(), options = {}) {
    const targetMargin = Math.max(0, Number(options.targetMargin) || 8);
    const repairTargetMargin = targetMargin + 0.01;
    const collisionGap = Math.max(0, Number(options.collisionGap) || 8);
    const maxPasses = Math.max(1, Math.min(16, Number(options.maxPasses) || 8));
    const requestedMaxDisplacement = Number(options.maxDisplacement);
    const maxDisplacement = Number.isFinite(requestedMaxDisplacement) && requestedMaxDisplacement > 0
      ? Math.min(120, requestedMaxDisplacement)
      : 120;
    const requestedFallbackEvaluations = Number(options.maxFallbackEvaluations);
    const maxFallbackEvaluations = Number.isFinite(requestedFallbackEvaluations) && requestedFallbackEvaluations > 0
      ? Math.min(14400, Math.floor(requestedFallbackEvaluations))
      : 14400;
    const candidateKeys = [...(topology?.seedNeighborsByKey?.keys?.() || [])].sort();
    const nodeKeys = [...(topology?.nodeKeys || positions.keys())].sort();
    const repaired = [];
    const unresolved = [];
    let projectionVisits = 0;
    let fallbackEvaluations = 0;
    let fallbackCandidateBudgetExhaustions = 0;
    const distance = (point, other) => Math.hypot(point.x - other.x, point.y - other.y);
    for (const candidateKey of candidateKeys) {
      const candidate = positions.get(candidateKey);
      const incidentKeys = topology.seedNeighborsByKey.get(candidateKey) || [];
      const nonincidentKeys = topology.nonincidentSeedsByKey.get(candidateKey) || [];
      if (!candidate || !incidentKeys.length || !nonincidentKeys.length) continue;
      const nearestIncidentDistance = Math.min(...incidentKeys.map(key => distance(candidate, positions.get(key))));
      const nearestNonincidentDistance = Math.min(...nonincidentKeys.map(key => distance(candidate, positions.get(key))));
      if (nearestIncidentDistance + 0.001 < nearestNonincidentDistance) continue;
      if (candidate.fixed) {
        unresolved.push(candidateKey);
        continue;
      }
      const primary = topology.primarySeedByKey.get(candidateKey);
      const anchorKeys = [primary, ...incidentKeys].filter((key, index, values) => key && values.indexOf(key) === index);
      const alternatives = [];
      const candidateRadius = Number(radii.get(candidateKey)) || 10;
      const evaluatePoint = point => {
        projectionVisits += incidentKeys.length + nonincidentKeys.length + nodeKeys.length;
        const incidentDistance = Math.min(...incidentKeys.map(key => distance(point, positions.get(key))));
        const nonincidentDistance = Math.min(...nonincidentKeys.map(key => distance(point, positions.get(key))));
        let minimumClearance = Infinity;
        for (const otherKey of nodeKeys) {
          if (otherKey === candidateKey) continue;
          const other = positions.get(otherKey);
          if (!other) continue;
          minimumClearance = Math.min(
            minimumClearance,
            distance(point, other) - candidateRadius - (Number(radii.get(otherKey)) || 10) - collisionGap,
          );
        }
        return {
          semanticMargin: nonincidentDistance - incidentDistance,
          minimumClearance,
        };
      };
      for (const anchorKey of anchorKeys) {
        const anchor = positions.get(anchorKey);
        if (!anchor) continue;
        const point = { x: candidate.x, y: candidate.y };
        let passes = 0;
        let pathLength = 0;
        for (; passes < maxPasses; passes++) {
          const violated = [];
          for (const nonincidentKey of [...nonincidentKeys].sort()) {
            const nonincident = positions.get(nonincidentKey);
            if (!nonincident) continue;
            projectionVisits++;
            const anchorDistance = Math.max(0.0001, distance(point, anchor));
            const nonincidentDistance = Math.max(0.0001, distance(point, nonincident));
            const currentMargin = nonincidentDistance - anchorDistance;
            if (currentMargin >= repairTargetMargin) continue;
            let gradientX = (point.x - nonincident.x) / nonincidentDistance - (point.x - anchor.x) / anchorDistance;
            let gradientY = (point.y - nonincident.y) / nonincidentDistance - (point.y - anchor.y) / anchorDistance;
            let gradientLength = Math.hypot(gradientX, gradientY);
            if (gradientLength < 0.0001) {
              gradientX = anchor.x - nonincident.x;
              gradientY = anchor.y - nonincident.y;
              gradientLength = Math.max(0.0001, Math.hypot(gradientX, gradientY));
            }
            violated.push({
              nonincident,
              deficit: repairTargetMargin - currentMargin,
              gradientX: gradientX / gradientLength,
              gradientY: gradientY / gradientLength,
            });
          }
          if (!violated.length) break;
          let directionX = violated.reduce((sum, value) => sum + value.gradientX * value.deficit, 0);
          let directionY = violated.reduce((sum, value) => sum + value.gradientY * value.deficit, 0);
          let directionLength = Math.hypot(directionX, directionY);
          if (directionLength < 0.0001) {
            directionX = violated.reduce((sum, value) => sum + (anchor.x - value.nonincident.x) * value.deficit, 0);
            directionY = violated.reduce((sum, value) => sum + (anchor.y - value.nonincident.y) * value.deficit, 0);
            directionLength = Math.max(0.0001, Math.hypot(directionX, directionY));
          }
          directionX /= directionLength;
          directionY /= directionLength;
          const remaining = maxDisplacement - pathLength;
          if (remaining <= 0.001) break;
          // The exact Euclidean margin follows a curved level set.  A direction that
          // is locally correct can miss the target farther along the same ray; do
          // not spend the whole displacement budget before recomputing its gradient.
          const remainingPasses = Math.max(1, maxPasses - passes);
          const trustLimit = Math.min(remaining, Math.max(4, remaining / remainingPasses));
          const valueAt = step => {
            const trial = { x: point.x + directionX * step, y: point.y + directionY * step };
            projectionVisits += nonincidentKeys.length;
            return Math.min(...nonincidentKeys.map(key => {
              const nonincident = positions.get(key);
              return nonincident ? distance(trial, nonincident) - distance(trial, anchor) : Infinity;
            }));
          };
          let high = Math.min(trustLimit, 1);
          while (high < trustLimit && valueAt(high) < repairTargetMargin) high = Math.min(trustLimit, high * 2);
          let step = high;
          if (valueAt(high) >= repairTargetMargin) {
            let low = 0;
            for (let iteration = 0; iteration < 18; iteration++) {
              const middle = (low + high) / 2;
              if (valueAt(middle) >= repairTargetMargin) high = middle;
              else low = middle;
            }
            step = high;
          }
          point.x += directionX * step;
          point.y += directionY * step;
          pathLength += step;
        }
        const { semanticMargin, minimumClearance } = evaluatePoint(point);
        if (semanticMargin + 0.001 < targetMargin || minimumClearance < -0.001) continue;
        alternatives.push({
          anchorKey,
          point,
          passes,
          pathLength,
          semanticMargin,
          minimumClearance,
          displacement: distance(point, candidate),
        });
      }
      alternatives.sort((left, right) => (
        left.displacement - right.displacement
        || right.minimumClearance - left.minimumClearance
        || left.anchorKey.localeCompare(right.anchorKey)
      ));
      let choice = alternatives[0];
      // The margin-only path can terminate inside a node's collision disk.  For
      // focused graphs, search the bounded displacement disk deterministically so
      // a nearby collision-aware route is not mislabeled as impossible.
      if (!choice) {
        const candidateFallbackBudget = Math.max(120, Math.floor(maxFallbackEvaluations / Math.max(1, candidateKeys.length)));
        let candidateFallbackEvaluations = 0;
        const nearChoices = [];
        const evaluateFallbackPoint = (radius, degrees) => {
          if (fallbackEvaluations >= maxFallbackEvaluations || candidateFallbackEvaluations >= candidateFallbackBudget) return null;
          fallbackEvaluations++;
          candidateFallbackEvaluations++;
          const normalizedDegrees = ((degrees % 360) + 360) % 360;
          const angle = normalizedDegrees * Math.PI / 180;
          const point = {
            x: candidate.x + Math.cos(angle) * radius,
            y: candidate.y + Math.sin(angle) * radius,
          };
          const assessment = evaluatePoint(point);
          return {
            anchorKey: primary || incidentKeys[0],
            point,
            passes: maxPasses,
            pathLength: radius,
            semanticMargin: assessment.semanticMargin,
            minimumClearance: assessment.minimumClearance,
            displacement: radius,
            collisionAwareFallback: true,
            angleDegrees: normalizedDegrees,
            score: Math.max(0, repairTargetMargin - assessment.semanticMargin)
              + 1.25 * Math.max(0, -assessment.minimumClearance),
          };
        };
        const radialValues = [];
        for (let radius = 8; radius < maxDisplacement; radius += 8) radialValues.push(radius);
        if (!radialValues.length || radialValues.at(-1) !== maxDisplacement) radialValues.push(maxDisplacement);
        for (const radius of radialValues) {
          const radialChoices = [];
          for (let degrees = 0; degrees < 360; degrees += 15) {
            const value = evaluateFallbackPoint(radius, degrees);
            if (!value) break;
            nearChoices.push(value);
            if (value.semanticMargin >= repairTargetMargin && value.minimumClearance >= 0) radialChoices.push(value);
          }
          radialChoices.sort((left, right) => (
            right.minimumClearance - left.minimumClearance
            || right.semanticMargin - left.semanticMargin
            || left.angleDegrees - right.angleDegrees
          ));
          choice = radialChoices[0];
          if (choice) {
            const fineChoices = [...radialChoices];
            for (const center of radialChoices.slice(0, 3)) {
              for (let fineRadius = Math.max(1, radius - 8); fineRadius <= radius; fineRadius++) {
                for (let offset = -15; offset <= 15; offset++) {
                  const value = evaluateFallbackPoint(fineRadius, center.angleDegrees + offset);
                  if (!value) break;
                  if (value.semanticMargin >= repairTargetMargin && value.minimumClearance >= 0) fineChoices.push(value);
                }
                if (fallbackEvaluations >= maxFallbackEvaluations || candidateFallbackEvaluations >= candidateFallbackBudget) break;
              }
              if (fallbackEvaluations >= maxFallbackEvaluations || candidateFallbackEvaluations >= candidateFallbackBudget) break;
            }
            fineChoices.sort((left, right) => (
              left.displacement - right.displacement
              || right.minimumClearance - left.minimumClearance
              || right.semanticMargin - left.semanticMargin
              || left.angleDegrees - right.angleDegrees
            ));
            choice = fineChoices[0];
            break;
          }
          if (fallbackEvaluations >= maxFallbackEvaluations || candidateFallbackEvaluations >= candidateFallbackBudget) break;
        }
        if (!choice && fallbackEvaluations < maxFallbackEvaluations && candidateFallbackEvaluations < candidateFallbackBudget) {
          nearChoices.sort((left, right) => (
            left.score - right.score
            || left.displacement - right.displacement
            || left.angleDegrees - right.angleDegrees
          ));
          const centers = nearChoices.slice(0, 4);
          for (const center of centers) {
            const fineChoices = [];
            for (let radius = Math.max(1, center.displacement - 8); radius <= Math.min(maxDisplacement, center.displacement + 8); radius += 2) {
              for (let offset = -15; offset <= 15; offset += 3) {
                const value = evaluateFallbackPoint(radius, center.angleDegrees + offset);
                if (!value) break;
                if (value.semanticMargin >= repairTargetMargin && value.minimumClearance >= 0) fineChoices.push(value);
              }
              if (fallbackEvaluations >= maxFallbackEvaluations || candidateFallbackEvaluations >= candidateFallbackBudget) break;
            }
            fineChoices.sort((left, right) => (
              left.displacement - right.displacement
              || right.minimumClearance - left.minimumClearance
              || right.semanticMargin - left.semanticMargin
              || left.angleDegrees - right.angleDegrees
            ));
            if (fineChoices[0]) {
              choice = fineChoices[0];
              break;
            }
            if (fallbackEvaluations >= maxFallbackEvaluations || candidateFallbackEvaluations >= candidateFallbackBudget) break;
          }
        }
        if (!choice && candidateFallbackEvaluations >= candidateFallbackBudget) fallbackCandidateBudgetExhaustions++;
      }
      if (!choice) {
        unresolved.push(candidateKey);
        continue;
      }
      candidate.x = choice.point.x;
      candidate.y = choice.point.y;
      candidate.vx = 0;
      candidate.vy = 0;
      repaired.push({ candidateKey, ...choice });
    }
    return {
      repaired,
      unresolved,
      repairedCandidates: repaired.length,
      projectionVisits,
      maxDisplacement,
      fallbackEvaluations,
      maxFallbackEvaluations,
      fallbackCandidateBudgetExhaustions,
      fallbackBudgetExhausted: fallbackEvaluations >= maxFallbackEvaluations || fallbackCandidateBudgetExhaustions > 0,
      diagnostics: seedProximityDiagnostics(positions, topology),
    };
  }

  class Renderer {
    constructor({ container, detail, counts, data, nodeSizeMode = "citations", onSelectItem, onNodeAction, onNodeSelect, onRequestNodeDetail, onSelectLocalChild, onClearFilters, onOpenExternal, onOpenPDF, onCopyDOI }) {
      this.container = container;
      this.container.dataset.layoutAlgorithmVersion = LAYOUT_ALGORITHM_VERSION;
      this.detail = detail;
      this.counts = counts;
      this.win = container.ownerDocument.defaultView;
      this.data = data || { nodes: [], edges: [] };
      this.onSelectItem = onSelectItem;
      this.onClearFilters = onClearFilters;
      this.onOpenExternal = onOpenExternal;
      this.onOpenPDF = onOpenPDF;
      this.onCopyDOI = onCopyDOI;
      this.onNodeAction = onNodeAction;
      this.onNodeSelect = onNodeSelect;
      this.onRequestNodeDetail = onRequestNodeDetail;
      this.onSelectLocalChild = onSelectLocalChild;
      this.mode = "galaxy";
      this.nodeSizeMode = NODE_SIZE_MODES.has(nodeSizeMode) ? nodeSizeMode : "citations";
      this.nodeSizeStats = citationScaleStats(this.data.nodes || []);
      this.selection = null;
      this.positions = new Map();
      this.positionArchive = new Map();
      this.nodeElements = new Map();
      this.edgeElements = new Map();
      this.neighbors = new Map();
      this.physicsTopology = buildPhysicsTopology(this.data.nodes || [], this.data.edges || []);
      this.componentCenters = new Map();
      this.incrementalLayoutActive = false;
      this.incrementalAnchors = new Map();
      this.incrementalMovableKeys = new Set();
      this.viewport = { x: 0, y: 0, k: 1 };
      this.dragState = null;
      this.panState = null;
      this.suppressClick = null;
      this.frame = null;
      this.reducedTimer = null;
      this.lensFrame = null;
      this.edgeMarkerFrame = null;
      this.alpha = 0;
      this.lens = { x: 0, y: 0, strength: 0, target: 0, focusKey: null };
      this.lastLensChangedKeys = new Set();
      this.hoverKey = null;
      this.hoverLensTimer = null;
      this.lockedLensKey = null;
      this.selectionFocusReturn = null;
      this.selectionViewportRestore = null;
      this.selectionRevealFrame = null;
      this.selectionRevealTimer = null;
      this.simulationFrames = 0;
      this.simulationSteps = 0;
      this.simulationPairVisits = 0;
      this.lastRenderMS = 0;
      this.lastSimulationMS = 0;
      this.fitAfterSimulation = false;
      this.signature = "";
      this.topologySignatureValue = "";
      this.positionTopologySignatureValue = "";
      this.seedHomeState = new Map();
      this.modePositionState = new Map();
      this.restoringModePositions = false;
      this.resumeModeSimulationAlpha = 0;
      this.pendingViewState = null;
      this.restoredViewState = null;
      this.transientUniverseTransition = false;
      this.pendingUniverseSimulationAlpha = 0;
      this.pendingGeometrySimulation = false;
      this.isolateTrayExpanded = false;
      this.hasRendered = false;
      this.renderQueued = false;
      this.cycleState = null;
      this.cycleTimer = null;
      this.detailCache = new Map();
      this.detailRequests = new Map();
      this.detailSectionStates = new Map();
      this.detailRequestToken = 0;
      this.lastSemanticReport = null;
      this.keyboardFocusKey = null;
      this.labelPriority = [];
      this.previewTimer = null;
      this.hoverPreview = null;
      this.captionMeasureContext = container.ownerDocument.createElement("canvas").getContext?.("2d");
      this.closeDetailMenu = null;
      this.motionPreference = this.win.matchMedia?.("(prefers-reduced-motion: reduce)") || null;
      this.reducedMotion = Boolean(this.motionPreference?.matches);
      this.onMotionPreference = event => { this.reducedMotion = Boolean(event.matches); };
      this.motionPreference?.addEventListener?.("change", this.onMotionPreference);
      const ResizeObserverImpl = this.win.ResizeObserver;
      if (ResizeObserverImpl) {
        this.resizeObserver = new ResizeObserverImpl(() => {
          this.queueRender();
          if (this.selection?.kind === "node") this.scheduleSelectionReveal(keyOf(this.selection.value));
        });
        this.resizeObserver.observe(container);
      }
      else {
        this.onResize = () => this.queueRender();
        this.win.addEventListener("resize", this.onResize);
      }
      this.render(true);
    }

    dataSignature(data = this.data) {
      const nodes = (data.nodes || []).map(node => JSON.stringify([
        keyOf(node), node.title || "", node.shortTitle || "", node.year || "",
        (node.authors || []).map(author => author.name || "").join(";"), node.venue || "",
        [...(node.localKeys || [])].sort(), Boolean(node.hasPDF), Number(node.duplicateCount) || 0,
        Boolean(node.isRetracted), Boolean(node.isSeed), Boolean(node.isQueued), Boolean(node.isPinned), Boolean(node.isCollapsed),
        node.candidateState || "", node.citationCount ?? "?", Boolean(node.isActionPending),
      ])).sort().join("|");
      const edges = (data.edges || []).map(edge => JSON.stringify([
        edgeKey(edge), edge.type || "",
      ])).sort().join("|");
      return `${ZLGI18n.locale()}:${this.mode}:${this.nodeSizeMode}::${nodes}::${edges}`;
    }

    topologySignature(data = this.data) {
      const nodes = (data.nodes || []).map(node => `${keyOf(node)}:${node.isSeed ? 1 : 0}`).sort().join("|");
      const edges = (data.edges || []).map(edge => `${edgeKey(edge)}:${edge.type || "cites"}`).sort().join("|");
      return `${LAYOUT_ALGORITHM_VERSION}::${data.layoutUniverseSignature || "focused"}::${nodes}::${edges}`;
    }

    positionTopologySignature(data = this.data) {
      const nodes = (data.nodes || []).map(keyOf).sort().join("|");
      const edges = (data.edges || []).map(edgeKey).sort().join("|");
      return `${nodes}::${edges}`;
    }

    geometrySignature(data = this.data) {
      if (this.nodeSizeMode === "uniform") return "uniform";
      if (this.nodeSizeMode === "degree") return `degree::${this.positionTopologySignature(data)}`;
      return `citations::${(data.nodes || []).map(node => `${keyOf(node)}:${citationCountOf(node.citationCount) ?? "?"}`).sort().join("|")}`;
    }

    queueRender() {
      if (this.renderQueued) return;
      this.renderQueued = true;
      this.win.requestAnimationFrame(() => {
        this.renderQueued = false;
        this.render(false, true);
      });
    }

    setMode(mode) {
      if (!["timeline", "galaxy"].includes(mode) || mode === this.mode) return;
      this.restoreSelectionViewport?.();
      const positionTopologySignature = this.topologySignature();
      const resumeAlpha = this.mode === "galaxy" && (this.frame || this.reducedTimer) && this.alpha > 0.018 ? this.alpha : 0;
      this.modePositionState.set(this.mode, {
        topologySignature: positionTopologySignature,
        positions: clonePositionMap(this.positions, resumeAlpha <= 0.018),
        viewport: { ...this.viewport },
        componentCenters: new Map([...this.componentCenters].map(([key, value]) => [key, { ...value }])),
        resumeAlpha,
      });
      this.mode = mode;
      const saved = this.modePositionState.get(mode);
      const canRestore = saved?.topologySignature === positionTopologySignature;
      this.positions = canRestore
        ? clonePositionMap(saved.positions, !(mode === "galaxy" && Number(saved.resumeAlpha) > 0.018))
        : new Map();
      this.viewport = canRestore ? { ...saved.viewport } : { x: 0, y: 0, k: 1 };
      if (canRestore && saved.componentCenters?.size) {
        this.componentCenters = new Map([...saved.componentCenters].map(([key, value]) => [key, { ...value }]));
      }
      this.restoringModePositions = Boolean(canRestore);
      this.resumeModeSimulationAlpha = canRestore && mode === "galaxy" ? Number(saved.resumeAlpha) || 0 : 0;
      this.alpha = 0;
      this.signature = "";
      this.render(!canRestore);
    }

    setNodeSizeMode(mode) {
      if (!NODE_SIZE_MODES.has(mode) || mode === this.nodeSizeMode) return;
      this.nodeSizeMode = mode;
      this.pendingGeometrySimulation = true;
      this.signature = "";
      this.render(false);
    }

    getNodeSizeStats() {
      return { ...this.nodeSizeStats, mode: this.nodeSizeMode };
    }

    captureViewState(options = {}) {
      if (!this.hasRendered || !this.positions.size) return null;
      const simulationState = this.container.dataset.simulationState || "idle";
      let positions = clonePositionMap(this.positions, true);
      let semanticReport = this.lastSemanticReport ? { ...this.lastSemanticReport } : null;
      let restorableState = ["stable", "semantic-degraded"].includes(simulationState)
        ? simulationState
        : null;
      if (!restorableState && options.allowRunning) {
        // Seed changes may happen before the opening simulation has finished.
        // Repair a detached snapshot so undo can restore a truthful, stable
        // semantic layout without freezing or visibly jumping the live graph.
        const radii = new Map(this.data.nodes.map(node => [
          keyOf(node),
          this.nodeElements.get(keyOf(node))?.radius || 10,
        ]));
        repairSeedProximityViolations(positions, this.physicsTopology, radii, {
          targetMargin: 8,
          collisionGap: 8,
          maxPasses: 8,
        });
        const report = seedProximityDiagnostics(positions, this.physicsTopology);
        const satisfied = semanticLayoutSatisfied(report, this.data.nodes.length);
        semanticReport = {
          ...report,
          satisfied,
          warning: semanticWarningText(report, this.data.nodes.length),
        };
        restorableState = satisfied ? "stable" : "semantic-degraded";
      }
      if (!restorableState) return null;
      return {
        topologySignature: this.topologySignature(),
        positionTopologySignature: this.positionTopologySignature(),
        geometrySignature: this.geometrySignature(),
        positions,
        viewport: { ...this.viewport },
        componentCenters: new Map([...this.componentCenters].map(([key, value]) => [key, { ...value }])),
        semanticReport,
        simulationState: restorableState,
        simulationFrames: this.simulationFrames,
        simulationSteps: this.simulationSteps,
        simulationPairVisits: this.simulationPairVisits,
        simulationMS: this.lastSimulationMS,
      };
    }

    restoreViewState(state) {
      this.pendingViewState = state || null;
    }

    setData(data) {
      const previousSelection = this.selection;
      const previousGeometrySignature = this.geometrySignature(this.data);
      const previousPositionSignature = this.positionTopologySignature(this.data);
      const previousUniverse = this.data?.layoutUniverseSignature || null;
      const nextUniverse = data?.layoutUniverseSignature || null;
      this.transientUniverseTransition = Boolean(
        previousUniverse && nextUniverse && previousUniverse === nextUniverse
        && this.positionTopologySignature(this.data) !== this.positionTopologySignature(data),
      );
      this.data = data || { nodes: [], edges: [] };
      this.pendingGeometrySimulation ||= previousPositionSignature === this.positionTopologySignature(this.data)
        && previousGeometrySignature !== this.geometrySignature(this.data);
      const pendingViewState = this.pendingViewState;
      this.pendingViewState = null;
      const canRestoreView = Boolean(
        pendingViewState
        && pendingViewState.topologySignature === this.topologySignature(this.data)
        && pendingViewState.positionTopologySignature === this.positionTopologySignature(this.data)
        && pendingViewState.geometrySignature === this.geometrySignature(this.data)
      );
      if (canRestoreView) {
        this.positions = clonePositionMap(pendingViewState.positions, true);
        for (const [key, value] of this.positions) this.positionArchive.set(key, { ...value });
        this.viewport = { ...pendingViewState.viewport };
        this.componentCenters = new Map([...pendingViewState.componentCenters].map(([key, value]) => [key, { ...value }]));
        this.restoringModePositions = true;
        this.resumeModeSimulationAlpha = 0;
        this.pendingUniverseSimulationAlpha = 0;
        this.pendingGeometrySimulation = false;
        this.restoredViewState = pendingViewState;
        this.alpha = 0;
      }
      else {
        this.restoredViewState = null;
      }
      let replacement = null;
      if (this.selection?.kind === "node") {
        replacement = this.data.nodes.find(node => keyOf(node) === keyOf(this.selection.value));
        this.selection = replacement ? { kind: "node", value: replacement } : null;
      }
      else if (this.selection?.kind === "edge") {
        replacement = this.data.edges.find(edge => edgeKey(edge) === edgeKey(this.selection.value));
        this.selection = replacement ? { kind: "edge", value: replacement } : null;
      }
      const needsRender = this.dataSignature() !== this.signature;
      if (needsRender) this.render(false);
      else {
        const nextNodes = new Map(this.data.nodes.map(node => [keyOf(node), node]));
        const nextEdges = new Map(this.data.edges.map(edge => [edgeKey(edge), edge]));
        for (const [key, value] of this.nodeElements) {
          if (nextNodes.has(key)) value.node = nextNodes.get(key);
        }
        for (const [key, value] of this.edgeElements) {
          if (nextEdges.has(key)) value.edge = nextEdges.get(key);
        }
        this.updateCounts();
        this.updateHighlight();
      }
      if (!needsRender && previousSelection) {
        if (replacement && previousSelection.kind === "node") this.showNodeDetail(replacement);
        else if (replacement && previousSelection.kind === "edge") this.showEdgeDetail(replacement);
        else {
          this.showPlaceholder();
          this.onNodeSelect?.(null);
        }
      }
      if (previousSelection?.kind === "node" && !replacement) this.restoreSelectionViewport();
    }

    selectNode(node, options = {}) {
      this.hideHoverPreview?.();
      if (!node) return;
      const nodeKey = keyOf(node);
      const previousNodeKey = this.selection?.kind === "node" ? keyOf(this.selection.value) : null;
      if (previousNodeKey && previousNodeKey !== nodeKey) this.restoreSelectionViewport();
      const element = this.nodeElements.get(nodeKey);
      const doc = this.detail?.ownerDocument;
      const activeElement = options.focusReturn || doc?.activeElement || null;
      if (options.focusReturn || (activeElement && activeElement !== doc?.body && !this.detail?.contains(activeElement))) {
        this.selectionFocusReturn = activeElement;
      }
      else if (!this.selectionFocusReturn?.isConnected) {
        this.selectionFocusReturn = element?.group || null;
      }
      const alreadySelected = this.selection?.kind === "node" && keyOf(this.selection.value) === nodeKey;
      this.selection = { kind: "node", value: node };
      this.keyboardFocusKey = nodeKey;
      this.lockedLensKey = options.lockLens === false ? null : nodeKey;
      if (!alreadySelected || options.refreshDetail) this.showNodeDetail(node);
      this.updateHighlight();
      const preserveKeyboardFocus = element?.group === this.detail?.ownerDocument?.activeElement;
      if (element?.group?.parentNode) element.group.parentNode.appendChild(element.group);
      if (preserveKeyboardFocus) element.group.focus();
      if (options.notify) this.onNodeSelect?.(node);
      if (this.lockedLensKey) this.setLensFocus(this.lockedLensKey);
      this.scheduleSelectionReveal(nodeKey);
    }

    selectEdge(edge) {
      if (!edge) return;
      this.restoreSelectionViewport?.();
      const doc = this.detail?.ownerDocument;
      const activeElement = doc?.activeElement;
      if (activeElement && activeElement !== doc?.body && !this.detail?.contains(activeElement)) {
        this.selectionFocusReturn = activeElement;
      }
      else if (!this.selectionFocusReturn?.isConnected) {
        const keys = edgeKeys(edge);
        this.selectionFocusReturn = this.nodeElements.get(keys.source)?.group
          || this.nodeElements.get(keys.target)?.group
          || null;
      }
      this.cancelHoverLens();
      this.lockedLensKey = null;
      this.clearLens();
      this.selection = { kind: "edge", value: edge };
      this.showEdgeDetail(edge);
      this.updateHighlight();
      this.onNodeSelect?.(null);
    }

    clearSelection() {
      this.restoreSelectionViewport();
      this.cancelHoverLens();
      this.lockedLensKey = null;
      this.selection = null;
      this.clearLens();
      this.showPlaceholder();
      this.updateHighlight();
      this.onNodeSelect?.(null);
    }

    destroy() {
      this.hideHoverPreview();
      if (this.frame) this.win.cancelAnimationFrame(this.frame);
      if (this.reducedTimer) this.win.clearTimeout(this.reducedTimer);
      if (this.lensFrame) this.win.cancelAnimationFrame(this.lensFrame);
      if (this.edgeMarkerFrame) this.win.cancelAnimationFrame(this.edgeMarkerFrame);
      this.cancelHoverLens();
      this.closeDetailMenu?.();
      this.closeDetailMenu = null;
      if (this.cycleTimer) this.win.clearTimeout(this.cycleTimer);
      if (this.selectionRevealFrame) this.win.cancelAnimationFrame(this.selectionRevealFrame);
      if (this.selectionRevealTimer) this.win.clearTimeout(this.selectionRevealTimer);
      this.resizeObserver?.disconnect();
      if (this.onResize) this.win.removeEventListener("resize", this.onResize);
      this.motionPreference?.removeEventListener?.("change", this.onMotionPreference);
      this.container.replaceChildren();
    }

    dimensions() {
      return {
        width: Math.max(1, this.container.clientWidth || 900),
        height: Math.max(1, this.container.clientHeight || 650),
      };
    }

    ensurePositions(width, height, reset = false, preserveComponentCenters = false) {
      for (const [key, value] of this.positions) this.positionArchive.set(key, { ...value });
      const available = new Map([...this.positionArchive, ...this.positions]);
      const layout = topologyInitialPositions(this.data.nodes, this.data.edges, width, height, available, reset);
      this.positions = layout.positions;
      for (const [key, value] of this.positions) this.positionArchive.set(key, { ...value });
      this.physicsTopology = layout.topology;
      const semanticSignature = this.topologySignature();
      const cachedSeedHomes = this.seedHomeState.get(semanticSignature);
      if (cachedSeedHomes?.size) {
        this.physicsTopology.seedHomePositions = new Map([...cachedSeedHomes].map(([key, value]) => [key, { ...value }]));
      }
      else {
        this.seedHomeState.set(semanticSignature, new Map([...this.physicsTopology.seedHomePositions].map(([key, value]) => [key, { ...value }])));
        while (this.seedHomeState.size > 24) this.seedHomeState.delete(this.seedHomeState.keys().next().value);
      }
      this.componentCenters = preserveComponentCenters && this.componentCenters.size
        ? new Map(this.componentCenters)
        : layout.centers;
    }

    assignTimeline(width, height) {
      this.positions = timelineLaneLayout(this.data.nodes, width, height);
    }

    buildNeighbors() {
      this.neighbors = this.physicsTopology?.adjacency || buildPhysicsTopology(this.data.nodes, this.data.edges).adjacency;
    }

    render(resetPositions = false, forceFit = false) {
      const renderStarted = this.win.performance?.now?.() ?? Date.now();
      const activeElement = this.container.ownerDocument.activeElement;
      const focusedWorkKey = activeElement?.dataset?.workKey || null;
      const currentMenu = this.detail?.querySelector(".zlg-detail-actions");
      const detailMenuWasOpen = Boolean(currentMenu && !currentMenu.hidden);
      const menuFocusAction = activeElement?.getAttribute?.("role") === "menuitem" ? activeElement.dataset.nodeAction || null : null;
      const menuFocusText = activeElement?.getAttribute?.("role") === "menuitem" ? activeElement.textContent : null;
      const topologySignature = this.topologySignature();
      const topologyChanged = topologySignature !== this.topologySignatureValue;
      if (topologyChanged && !this.restoredViewState) this.lastSemanticReport = null;
      const positionTopologySignature = this.positionTopologySignature();
      const semanticOnlyChanged = Boolean(this.positionTopologySignatureValue)
        && topologyChanged
        && positionTopologySignature === this.positionTopologySignatureValue;
      const restoringModePositions = this.restoringModePositions;
      const restoredViewState = this.restoredViewState;
      const transientUniverseTransition = this.transientUniverseTransition;
      const firstRender = !this.hasRendered;
      const newNodeCount = this.data.nodes.reduce((count, node) => count + Number(
        !this.positions.has(keyOf(node)) && !this.positionArchive.has(keyOf(node)),
      ), 0);
      const priorPositions = new Map([...this.positions].map(([key, value]) => [key, { x: value.x, y: value.y }]));
      const preserveSimulation = Boolean(this.frame || this.reducedTimer)
        && !topologyChanged
        && !resetPositions
        && this.mode === "galaxy";
      if ((this.frame || this.reducedTimer) && !preserveSimulation) {
        if (transientUniverseTransition && this.alpha > 0.018) {
          this.pendingUniverseSimulationAlpha = Math.max(this.pendingUniverseSimulationAlpha, this.alpha);
        }
        if (this.frame) this.win.cancelAnimationFrame(this.frame);
        if (this.reducedTimer) this.win.clearTimeout(this.reducedTimer);
        this.frame = null;
        this.reducedTimer = null;
        this.fitAfterSimulation = false;
        this.container.dataset.simulationState = "cancelled";
      }
      if (this.lensFrame) this.win.cancelAnimationFrame(this.lensFrame);
      this.lensFrame = null;
      if (this.edgeMarkerFrame) this.win.cancelAnimationFrame(this.edgeMarkerFrame);
      this.edgeMarkerFrame = null;
      this.cancelHoverLens();
      this.lens = { x: 0, y: 0, strength: 0, target: 0, focusKey: null };
      this.lastLensChangedKeys = new Set();
      this.hoverKey = null;
      this.hideHoverPreview();
      this.lockedLensKey = this.selection?.kind === "node" ? keyOf(this.selection.value) : null;
      const doc = this.container.ownerDocument;
      const { width, height } = this.dimensions();
      this.ensurePositions(
        width,
        height,
        (resetPositions || semanticOnlyChanged) && this.mode === "galaxy",
        ((!topologyChanged && !resetPositions) || restoringModePositions || transientUniverseTransition) && this.mode === "galaxy",
      );
      if (this.mode === "timeline" && !restoringModePositions) this.assignTimeline(width, height);
      this.buildNeighbors();
      this.nodeSizeStats = citationScaleStats(this.data.nodes);
      const isolateKeys = new Set(this.physicsTopology.components
        .filter(component => this.data?.workspace !== "collection" && component.keys.length === 1)
        .flatMap(component => component.keys));
      const renderedNodes = this.data.nodes.filter(node => !isolateKeys.has(keyOf(node)));
      this.nodeElements.clear();
      this.edgeElements.clear();

      const svg = svgElement(doc, "svg", {
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: "xMidYMid meet",
        role: "group",
        tabindex: renderedNodes.length ? "-1" : "0",
        "aria-describedby": "layout-semantics zlg-semantic-warning",
        "aria-label": renderedNodes.length
          ? ZLGT("可缩放、可拖拽的文献关系网络。使用方向键在文献节点间移动，Page Up 与 Page Down 切换重叠层，Enter 打开详情，Escape 清除选择。")
          : this.data.emptyReason === "filters"
            ? ZLGT("当前筛选没有匹配文献。按 Tab 键可前往重置筛选按钮。")
            : ZLGT("当前关系图没有可导航的文献节点。"),
      });
      svg.classList.add("zlg-network-svg");
      svg.classList.toggle("is-dense", this.data.edges.length > 80);
      svg.classList.toggle("has-many-seeds", renderedNodes.filter(node => node.isSeed).length > 8);
      const defs = svgElement(doc, "defs");
      for (const [type, color] of Object.entries(EDGE_COLORS)) {
        const marker = svgElement(doc, "marker", {
          id: `zlg-arrow-${type}`, markerWidth: 7, markerHeight: 7, refX: 8, refY: 3,
          orient: "auto", markerUnits: "strokeWidth",
        });
        marker.appendChild(svgElement(doc, "path", { d: "M0,0 L0,6 L7,3 z", fill: color }));
        defs.appendChild(marker);
      }
      svg.appendChild(defs);

      const viewportGroup = svgElement(doc, "g", { class: "zlg-viewport" });
      const guidesGroup = svgElement(doc, "g", { class: "zlg-guides" });
      const edgesGroup = svgElement(doc, "g", { class: "zlg-edges zlg-edges-overlay" });
      const nodesGroup = svgElement(doc, "g", { class: "zlg-nodes" });
      const captionsGroup = svgElement(doc, "g", { class: "zlg-node-captions" });
      viewportGroup.append(guidesGroup, nodesGroup, edgesGroup);
      svg.appendChild(viewportGroup);
      if (this.mode === "timeline") this.drawTimelineGuides(doc, guidesGroup, width, height);

      for (const edge of this.data.edges) {
        const keys = edgeKeys(edge);
        if (!this.positions.has(keys.source) || !this.positions.has(keys.target)) continue;
        const visible = svgElement(doc, "path", {
          class: `zlg-edge zlg-edge-group zlg-edge-${edge.type || "cites"}`,
          "data-source-key": keys.source,
          "data-target-key": keys.target,
          "data-edge-type": edge.type || "cites",
          stroke: EDGE_COLORS[edge.type] || EDGE_COLORS.cites,
        });
        const markerEnd = edge.type === "similar" ? "" : `url(#zlg-arrow-${edge.type in EDGE_COLORS ? edge.type : "cites"})`;
        edgesGroup.appendChild(visible);
        this.edgeElements.set(edgeKey(edge), { group: visible, visible, edge, markerEnd });
      }

      const degrees = new Map([...this.neighbors].map(([key, values]) => [key, values.size]));
      const seedCountForLabels = renderedNodes.filter(node => node.isSeed).length;
      const rankedLabelNodes = [...renderedNodes]
        .sort((left, right) => {
          const pinnedDelta = Number(Boolean(right.isPinned)) - Number(Boolean(left.isPinned));
          if (pinnedDelta) return pinnedDelta;
          if (seedCountForLabels <= 6) {
            const seedDelta = Number(Boolean(right.isSeed)) - Number(Boolean(left.isSeed));
            if (seedDelta) return seedDelta;
          }
          const degreeDelta = (degrees.get(keyOf(right)) || 0) - (degrees.get(keyOf(left)) || 0);
          if (degreeDelta) return degreeDelta;
          return (Number(right.citationCount) || 0) - (Number(left.citationCount) || 0);
        });
      this.labelPriority = rankedLabelNodes.map(keyOf);

      const visibleKeys = new Set(renderedNodes.map(keyOf));
      if (!this.keyboardFocusKey || !visibleKeys.has(this.keyboardFocusKey)) {
        const selectedKey = this.selection?.kind === "node" ? keyOf(this.selection.value) : null;
        const initialNode = renderedNodes.find(node => node.isSeed) || renderedNodes[0];
        this.keyboardFocusKey = selectedKey && visibleKeys.has(selectedKey)
          ? selectedKey
          : initialNode ? keyOf(initialNode) : null;
      }

      for (const node of renderedNodes) {
        const key = keyOf(node);
        const degree = degrees.get(key) || 0;
        const radius = nodeRadius(node, degree, this.nodeSizeMode, this.nodeSizeStats.p95);
        const citationCount = citationCountOf(node.citationCount);
        const citationKnown = citationCount !== null;
        const classes = ["zlg-node"];
        if (node.isSeed) classes.push("is-seed");
        if (node.localKeys?.length) classes.push("is-local");
        else classes.push("is-external");
        if (node.isPinned) classes.push("is-pinned");
        if (node.isContext) classes.push("is-context");
        const candidateState = node.candidateState || this.data.session?.candidateStates?.[node.workKey] || "unreviewed";
        if (candidateState === "reading-list") classes.push("has-reading-list");
        if (this.nodeSizeMode === "citations" && !citationKnown) classes.push("has-unknown-citations");
        const citationLabel = citationKnown ? ZLGT`${citationCount.toLocaleString(ZLGI18n.locale())} 次` : ZLGT("未知");
        const nodeStateLabel = [
          node.isPinned ? ZLGT("保持显示") : "",
          candidateState === "reading-list" ? ZLGT("稍后阅读") : "",
          node.isRetracted ? ZLGT("撤稿记录") : "",
        ].filter(Boolean).join("；");
        const nodeLabel = ZLGT`${node.title || key}；${node.authors?.[0]?.name || ZLGT("作者未知")}；${node.year || ZLGT("年份未知")}；${node.localKeys?.length ? ZLGT("Zotero 已有") : ZLGT("外部候选")}${node.isContext ? ZLGT("；当前作为筛选上下文保留") : ""}${nodeStateLabel ? `；${nodeStateLabel}` : ""}；OpenAlex 被引 ${citationLabel}；与 ${degree} 篇当前可见文献相连；节点大小按${nodeSizeModeLabel(this.nodeSizeMode)}`;
        const group = svgElement(doc, "g", {
          class: classes.join(" "),
          style: `--zlg-node-color: ${nodeColor(node)}`,
          "data-work-key": key,
          "data-radius": radius.toFixed(3),
          "data-citation-count": citationKnown ? citationCount : "unknown",
          "data-node-size-mode": this.nodeSizeMode,
          role: "button",
          tabindex: key === this.keyboardFocusKey ? "0" : "-1",
          "aria-label": nodeLabel,
        });
        const hitArea = svgElement(doc, "circle", { r: radius + 12, class: "zlg-node-hit" });
        const halo = svgElement(doc, "circle", { r: radius + 7, class: "zlg-node-halo", stroke: nodeColor(node) });
        const core = svgElement(doc, "circle", { r: radius, class: "zlg-node-core", fill: nodeColor(node) });
        const caption = svgElement(doc, "g", { class: "zlg-node-caption", "data-work-key": key, "aria-hidden": "true" });
        const captionLink = svgElement(doc, "line", { class: "zlg-caption-link", "aria-hidden": "true" });
        const labelPlate = svgElement(doc, "rect", {
          x: 0, y: 0, width: CAPTION_WIDTH, height: 58,
          rx: 3, ry: 3, class: "zlg-node-label-plate",
        });
        const label = svgElement(doc, "text", { x: 8, y: 17, class: "zlg-node-label" });
        const meta = svgElement(doc, "text", { x: 8, y: 50, class: "zlg-node-label-meta" });
        caption.append(labelPlate, label, meta);
        captionsGroup.append(captionLink, caption);
        group.append(hitArea, halo);
        if (node.isSeed || node.isQueued) {
          group.appendChild(svgElement(doc, "circle", { r: radius + 5, class: "zlg-node-seed-ring" }));
        }
        if (node.isRetracted) {
          group.appendChild(svgElement(doc, "circle", { r: radius + 2.5, class: "zlg-node-retracted-ring" }));
        }
        group.append(core);
        if (node.isPinned) {
          const pinX = -radius - 8;
          const pinY = -radius - 7;
          group.appendChild(svgElement(doc, "path", {
            d: `M ${pinX - 5} ${pinY - 3} H ${pinX + 5} L ${pinX + 2} ${pinY + 2} V ${pinY + 7} L ${pinX} ${pinY + 10} L ${pinX - 2} ${pinY + 7} V ${pinY + 2} Z`,
            class: "zlg-node-pin-marker",
          }));
        }
        if (candidateState === "reading-list") {
          const readingX = -radius - 8;
          const readingY = radius - 2;
          group.appendChild(svgElement(doc, "path", {
            d: `M ${readingX - 4} ${readingY - 6} H ${readingX + 4} V ${readingY + 6} L ${readingX} ${readingY + 2} L ${readingX - 4} ${readingY + 6} Z`,
            class: "zlg-node-reading-marker",
          }));
        }
        if (node.isRetracted) {
          const retractionMark = svgElement(doc, "text", { x: radius + 5, y: -radius + 2, class: "zlg-node-retracted-mark" });
          retractionMark.textContent = "!";
          group.appendChild(retractionMark);
        }
        if (Number(node.duplicateCount) > 1) {
          const warning = svgElement(doc, "text", { x: radius + 5, y: radius + 8, class: "zlg-node-warning" });
          warning.textContent = `×${node.duplicateCount}`;
          group.appendChild(warning);
        }
        group.addEventListener("pointerdown", event => {
          if (event.button !== 0) return;
          this.suppressStageClickUntil = Date.now() + 400;
          this.startNodeDrag(event, key);
        });
        group.addEventListener("click", event => {
          event.stopPropagation();
          if (this.suppressClick?.key === key && Date.now() < this.suppressClick.until) {
            this.suppressClick = null;
            return;
          }
          this.selectNode(this.nodeElements.get(key)?.node || node, { lockLens: true, notify: true });
        });
        group.addEventListener("pointerenter", () => {
          this.hoverKey = key;
          this.updateHighlight(key);
          this.queueHoverPreview(key);
        });
        group.addEventListener("pointerleave", () => {
          this.cancelHoverLens();
          this.hoverKey = null;
          this.hideHoverPreview();
          this.updateHighlight();
          if (!this.lockedLensKey) this.clearLens();
        });
        group.addEventListener("keydown", event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.selectNode(this.nodeElements.get(key)?.node || node, { notify: true });
          }
          else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            const nextKey = nearestDirectionalKey(this.displayPositions(), key, event.key);
            if (nextKey) this.focusNode(nextKey);
          }
          else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            const keys = [...this.nodeElements.keys()];
            this.focusNode(event.key === "Home" ? keys[0] : keys.at(-1));
          }
          else if (event.key === "PageDown" || event.key === "PageUp") {
            if (this.cycleStackAtKey(key, event.key === "PageDown" ? 1 : -1)) event.preventDefault();
          }
          else if (event.key === "Escape") {
            event.preventDefault();
            this.clearSelection();
          }
        });
        group.addEventListener("focus", () => {
          this.keyboardFocusKey = key;
          for (const [candidateKey, candidate] of this.nodeElements) {
            candidate.group.setAttribute("tabindex", candidateKey === key ? "0" : "-1");
          }
        });
        nodesGroup.appendChild(group);
        const measure = (text, size = CAPTION_TITLE_SIZE) => {
          if (!this.captionMeasureContext) return estimatedLabelWidth(text, size);
          this.captionMeasureContext.font = `${size === CAPTION_TITLE_SIZE ? 600 : 400} ${size}px system-ui, "Segoe UI", "Microsoft YaHei UI", sans-serif`;
          return this.captionMeasureContext.measureText(text).width;
        };
        const titleLines = wrapNodeTitle(node.title || node.shortTitle, CAPTION_WIDTH - 16, measure);
        let authorYear = nodeAuthorYear(node);
        while (authorYear && measure(authorYear, CAPTION_META_SIZE) > CAPTION_WIDTH - 16) {
          const author = authorYear.split(" · ")[0];
          if ([...author].length < 3) break;
          authorYear = [...author.replace(/…$/, "")].slice(0, -1).join("") + "…" + (node.year ? ` · ${node.year}` : "");
        }
        const overviewWidth = Math.min(CAPTION_WIDTH, Math.max(80, measure(authorYear, CAPTION_META_SIZE) + 16));
        const readingWidth = Math.min(CAPTION_WIDTH, Math.max(overviewWidth, ...titleLines.map(line => measure(line) + 16)));
        this.nodeElements.set(key, { group, node, radius, caption, captionLink, labelPlate, label, meta, titleLines, authorYear, overviewWidth, readingWidth });
        caption.addEventListener("pointerdown", event => event.stopPropagation());
        caption.addEventListener("click", event => {
          event.stopPropagation();
          this.selectNode(this.nodeElements.get(key)?.node || node, { lockLens: true, notify: true });
        });
        caption.addEventListener("pointerenter", () => {
          this.hoverKey = key;
          this.updateHighlight(key);
          this.queueHoverPreview(key);
        });
        caption.addEventListener("pointerleave", () => {
          this.hoverKey = null;
          this.hideHoverPreview();
          this.updateHighlight();
        });
      }
      svg.appendChild(captionsGroup);
      this.captionsGroup = captionsGroup;

      svg.addEventListener("wheel", event => this.onWheel(event), { passive: false });
      svg.addEventListener("pointerdown", event => this.startPan(event));
      svg.addEventListener("pointermove", event => this.onPointerMove(event));
      svg.addEventListener("pointerup", event => this.endPointer(event));
      svg.addEventListener("pointercancel", event => this.endPointer(event));
      svg.addEventListener("lostpointercapture", event => this.endPointer(event));
      svg.addEventListener("pointerleave", () => {
        this.cancelHoverLens();
        if (!this.dragState && !this.panState && !this.lockedLensKey) this.clearLens();
        this.hoverKey = null;
        this.hideHoverPreview();
        this.updateHighlight();
      });
      svg.addEventListener("click", event => {
        if (event.target !== svg && event.target !== viewportGroup) return;
        if (this.suppressStageClickUntil && Date.now() < this.suppressStageClickUntil) return;
        const edge = this.edgeAtPoint(event.clientX, event.clientY);
        if (edge) {
          this.selectEdge(edge);
          return;
        }
        this.clearSelection();
      });

      this.svg = svg;
      this.viewportGroup = viewportGroup;
      this.nodesGroup = nodesGroup;
      const stackBadge = doc.createElement("div");
      stackBadge.className = "zlg-stack-badge";
      stackBadge.hidden = true;
      this.stackBadge = stackBadge;
      const isolateTray = doc.createElement("button");
      isolateTray.type = "button";
      isolateTray.className = "zlg-isolate-tray";
      isolateTray.hidden = isolateKeys.size === 0;
      isolateTray.setAttribute("aria-pressed", this.isolateTrayExpanded ? "true" : "false");
      isolateTray.setAttribute("aria-controls", "zlg-isolate-drawer");
      isolateTray.textContent = this.isolateTrayExpanded
        ? ZLGT`收起列表 · ${isolateKeys.size}`
        : ZLGT`暂无连线 · ${isolateKeys.size}`;
      isolateTray.title = ZLGT("可能因筛选或数据缺失未显示关系，不代表无关联。");
      isolateTray.addEventListener("click", () => {
        this.isolateTrayExpanded = !this.isolateTrayExpanded;
        this.signature = "";
        this.render(false);
        this.win.requestAnimationFrame(() => this.isolateTray?.focus());
      });
      this.isolateTray = isolateTray;
      const isolateDrawer = doc.createElement("section");
      isolateDrawer.id = "zlg-isolate-drawer";
      isolateDrawer.className = "zlg-isolate-drawer";
      isolateDrawer.hidden = !this.isolateTrayExpanded || isolateKeys.size === 0;
      isolateDrawer.setAttribute("aria-label", ZLGT("暂无连线的文献"));
      const drawerHeading = doc.createElement("div");
      drawerHeading.className = "zlg-isolate-drawer-heading";
      const drawerTitle = doc.createElement("strong");
      drawerTitle.textContent = ZLGT`暂无连线 · ${isolateKeys.size}`;
      const drawerHelp = doc.createElement("span");
      drawerHelp.textContent = ZLGT("可能因筛选或数据缺失造成");
      drawerHeading.append(drawerTitle, drawerHelp);
      isolateDrawer.appendChild(drawerHeading);
      for (const node of this.data.nodes.filter(value => isolateKeys.has(keyOf(value)))) {
        const row = doc.createElement("button");
        row.type = "button";
        row.className = "zlg-isolate-row";
        const rowTitle = doc.createElement("strong");
        rowTitle.textContent = node.title || ZLGT("未命名文献");
        const rowMeta = doc.createElement("span");
        rowMeta.textContent = [node.year || ZLGT("年份未知"), node.localKeys?.length ? ZLGT("Zotero 已有") : ZLGT("外部候选")].join(" · ");
        row.append(rowTitle, rowMeta);
        row.addEventListener("click", () => {
          this.selection = { kind: "node", value: node };
          this.lockedLensKey = null;
          this.showNodeDetail(node);
          this.updateHighlight();
          this.onNodeSelect?.(node);
        });
        isolateDrawer.appendChild(row);
      }
      this.isolateDrawer = isolateDrawer;
      const emptyState = doc.createElement("div");
      emptyState.className = "zlg-canvas-empty";
      emptyState.hidden = renderedNodes.length > 0;
      emptyState.setAttribute("role", "status");
      emptyState.setAttribute("aria-live", "polite");
      emptyState.setAttribute("aria-atomic", "true");
      const emptyTitle = doc.createElement("strong");
      emptyTitle.textContent = this.data.emptyReason === "filters"
        ? ZLGT("当前筛选没有匹配文献")
        : this.data.nodes.length ? ZLGT("主图当前没有可见关系") : ZLGT("当前范围没有文献");
      const emptyHelp = doc.createElement("span");
      emptyHelp.textContent = this.data.emptyReason === "filters"
        ? ZLGT("重置筛选后查看全部。")
        : this.data.nodes.length
          ? ZLGT("可打开右上角列表查看暂无连线的条目。")
          : ZLGT("请重置筛选或选择其他文献集。");
      emptyState.append(emptyTitle, emptyHelp);
      if ((!this.data.nodes.length || this.data.emptyReason === "filters") && this.onClearFilters) {
        const clear = doc.createElement("button");
        clear.type = "button";
        clear.textContent = ZLGT("重置筛选");
        clear.addEventListener("click", () => this.onClearFilters());
        emptyState.appendChild(clear);
      }
      const semanticWarning = this.semanticWarning || doc.createElement("div");
      semanticWarning.id = "zlg-semantic-warning";
      semanticWarning.className = "zlg-semantic-warning";
      semanticWarning.setAttribute("role", "status");
      semanticWarning.setAttribute("aria-live", "polite");
      semanticWarning.setAttribute("aria-atomic", "true");
      semanticWarning.textContent = semanticWarningForRender(this.lastSemanticReport, this.mode);
      this.semanticWarning = semanticWarning;
      const hoverPreview = doc.createElement("div");
      hoverPreview.className = "zlg-node-preview";
      hoverPreview.hidden = true;
      hoverPreview.setAttribute("role", "tooltip");
      this.hoverPreview = hoverPreview;
      // Resolve every node transform and both edge paths while the new SVG is still
      // detached.  This keeps a dense mode switch to one visible DOM commit even
      // though the visual edge overlay and its lower hit layer are separate.
      this.applyViewport();
      this.updatePositions();
      this.container.replaceChildren(svg, stackBadge, isolateTray, isolateDrawer, emptyState, semanticWarning, hoverPreview);
      // A dense set of SVG markers can delay the first painted frame.  Commit the
      // complete line network first, then attach every directional arrow together
      // on the following frame.  No direction is omitted; this only stages paint.
      this.edgeMarkerFrame = this.win.requestAnimationFrame(() => {
        if (this.svg !== svg) {
          this.edgeMarkerFrame = null;
          return;
        }
        this.edgeMarkerFrame = this.win.requestAnimationFrame(() => {
          if (this.svg === svg) {
            for (const value of this.edgeElements.values()) {
              value.visible.setAttribute("marker-end", value.markerEnd);
            }
          }
          this.edgeMarkerFrame = null;
        });
      });
      this.lastRenderMS = (this.win.performance?.now?.() ?? Date.now()) - renderStarted;
      this.container.dataset.renderMs = this.lastRenderMS.toFixed(1);
      this.signature = this.dataSignature();
      this.topologySignatureValue = topologySignature;
      this.positionTopologySignatureValue = positionTopologySignature;
      this.hasRendered = true;
      if (restoredViewState) {
        this.lastSemanticReport = restoredViewState.semanticReport ? { ...restoredViewState.semanticReport } : null;
        this.simulationFrames = Number(restoredViewState.simulationFrames) || 0;
        this.simulationSteps = Number(restoredViewState.simulationSteps) || 0;
        this.simulationPairVisits = Number(restoredViewState.simulationPairVisits) || 0;
        this.lastSimulationMS = Number(restoredViewState.simulationMS) || 0;
        this.container.dataset.simulationState = restoredViewState.simulationState || "stable";
        this.container.dataset.simulationFrames = String(this.simulationFrames);
        this.container.dataset.simulationSteps = String(this.simulationSteps);
        this.container.dataset.pairVisits = String(this.simulationPairVisits);
        this.container.dataset.simulationMs = this.lastSimulationMS.toFixed(1);
        if (this.semanticWarning) this.semanticWarning.textContent = semanticWarningForRender(this.lastSemanticReport, this.mode);
        this.updateCounts();
      }
      this.updateCounts();
      if (!this.selection) this.showPlaceholder();
      else if (this.selection.kind === "node") this.showNodeDetail(this.selection.value);
      this.updateHighlight();
      if (this.selection?.kind === "node") this.scheduleSelectionReveal(keyOf(this.selection.value));
      if (detailMenuWasOpen && this.selection?.kind === "node") {
        this.win.requestAnimationFrame(() => {
          const more = this.detail?.querySelector(".zlg-command-more");
          const menu = this.detail?.querySelector(".zlg-detail-actions");
          if (!more || !menu || more.disabled) return;
          if (menu.hidden) more.click();
          const target = menuFocusAction
            ? menu.querySelector(`[data-node-action="${menuFocusAction}"]`)
            : menuFocusText
              ? [...menu.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === menuFocusText)
              : null;
          target?.focus();
        });
      }
      if (focusedWorkKey && this.nodeElements.has(focusedWorkKey)) this.focusNode(focusedWorkKey);
      if (topologyChanged && !restoringModePositions && !transientUniverseTransition && this.mode === "galaxy" && this.data.nodes.length) {
        const incremental = !firstRender && !resetPositions && newNodeCount > 0;
        const archivedWarmStart = !firstRender && !resetPositions && newNodeCount === 0 && priorPositions.size > 0;
        this.incrementalLayoutActive = incremental;
        this.incrementalAnchors = incremental ? priorPositions : new Map();
        const newKeys = new Set(this.data.nodes.map(keyOf).filter(key => !priorPositions.has(key)));
        this.incrementalMovableKeys = new Set(newKeys);
        if (incremental) {
          for (const key of newKeys) for (const neighbor of this.physicsTopology.adjacency.get(key) || []) this.incrementalMovableKeys.add(neighbor);
        }
        const incrementalAlpha = newNodeCount <= 2 ? 0.24 : newNodeCount <= 10 ? 0.30 : newNodeCount <= 20 ? 0.34 : 0.38;
        this.startSimulation(archivedWarmStart ? 0.24 : incremental ? incrementalAlpha : 0.82, firstRender || resetPositions);
      }
      if (firstRender || resetPositions || forceFit) this.win.requestAnimationFrame(() => this.fit());
      if (this.lockedLensKey) this.win.requestAnimationFrame(() => this.setLensFocus(this.lockedLensKey));
      if (restoringModePositions && this.mode === "galaxy" && this.resumeModeSimulationAlpha > 0.018) {
        this.startSimulation(this.resumeModeSimulationAlpha, false, true);
      }
      const fullUniverseRestored = this.data.layoutUniverseSignature
        && this.positionTopologySignature() === this.data.layoutUniverseSignature;
      if (fullUniverseRestored && this.mode === "galaxy" && this.pendingUniverseSimulationAlpha > 0.018) {
        this.startSimulation(this.pendingUniverseSimulationAlpha, false, true);
        this.pendingUniverseSimulationAlpha = 0;
      }
      if (this.pendingGeometrySimulation && this.mode === "galaxy" && this.data.nodes.length) {
        if (!topologyChanged) this.startSimulation(0.24, false);
        this.pendingGeometrySimulation = false;
      }
      this.resumeModeSimulationAlpha = 0;
      this.restoringModePositions = false;
      this.restoredViewState = null;
      this.transientUniverseTransition = false;
    }

    startSimulation(alpha = 0.7, fitAfter = false, continuation = false) {
      this.alpha = Math.max(this.alpha, alpha);
      this.fitAfterSimulation ||= Boolean(fitAfter);
      if (this.frame || this.reducedTimer) return;
      this.simulationFrames = 0;
      this.simulationSteps = 0;
      this.simulationPairVisits = 0;
      this.semanticRepairCount = 0;
      this.semanticRepairMaxPasses = 0;
      this.semanticRepairVisits = 0;
      this.lastSimulationMS = 0;
      const simulationStarted = this.win.performance?.now?.() ?? Date.now();
      delete this.container.dataset.simulationFrames;
      delete this.container.dataset.simulationSteps;
      delete this.container.dataset.pairVisits;
      delete this.container.dataset.simulationMs;
      this.container.dataset.simulationState = "running";
      if (this.semanticWarning) {
        this.semanticWarning.textContent = "";
      }
      if (!continuation && this.data.nodes.length && this.physicsTopology) Renderer.prototype.repairSemanticViolations.call(this);
      if (this.reducedMotion) {
        const runReducedBatch = () => {
          this.reducedTimer = null;
          for (let step = 0; step < 5 && this.alpha > 0.04 && this.simulationSteps < 40; step++) {
            this.simulationPairVisits += this.simulationStep();
            this.simulationSteps++;
            this.alpha *= 0.92;
          }
          if (this.alpha > 0.04 && this.simulationSteps < 40 && this.mode === "galaxy") {
            this.reducedTimer = this.win.setTimeout(runReducedBatch, 0);
            return;
          }
          this.alpha = 0;
          this.simulationPairVisits += this.settleLayoutConstraints(2);
          if (this.data.nodes.length && this.physicsTopology) Renderer.prototype.repairSemanticViolations.call(this);
          this.incrementalLayoutActive = false;
          this.incrementalAnchors = new Map();
          this.incrementalMovableKeys = new Set();
          this.simulationFrames = Math.max(1, Math.ceil(this.simulationSteps / 5));
          this.updatePositions();
          this.lastSimulationMS = (this.win.performance?.now?.() ?? Date.now()) - simulationStarted;
          this.container.dataset.simulationFrames = String(this.simulationFrames);
          this.container.dataset.simulationSteps = String(this.simulationSteps);
          this.container.dataset.pairVisits = String(this.simulationPairVisits);
          this.container.dataset.simulationMs = this.lastSimulationMS.toFixed(1);
          const semantic = Renderer.prototype.updateSemanticDiagnostics.call(this);
          this.container.dataset.simulationState = semantic.satisfied ? "stable" : "semantic-degraded";
          this.updateCounts();
          if (this.fitAfterSimulation) {
            this.fitAfterSimulation = false;
            this.fit();
          }
          if (this.selection?.kind === "node") this.scheduleSelectionReveal(keyOf(this.selection.value));
        };
        runReducedBatch();
        return;
      }
      const warmupSteps = this.data.nodes.length >= 120 || this.data.edges.length >= 400 ? 4 : 8;
      for (let step = 0; step < warmupSteps && this.alpha > 0.018; step++) {
        this.simulationPairVisits += this.simulationStep();
        this.simulationSteps++;
        this.alpha *= 0.925;
      }
      this.simulationPairVisits += this.relaxCollisions(4);
      this.updatePositions();
      this.container.dataset.warmupSteps = String(warmupSteps);
      const loop = () => {
        this.frame = null;
        const stepsPerFrame = this.data.nodes.length >= 120 || this.data.edges.length >= 400 ? 2 : 1;
        for (let step = 0; step < stepsPerFrame && this.alpha > 0.018; step++) {
          this.simulationPairVisits += this.simulationStep();
          this.simulationSteps++;
          this.alpha *= 0.925;
        }
        this.simulationFrames++;
        this.updatePositions();
        if (this.alpha > 0.018 && this.mode === "galaxy") this.frame = this.win.requestAnimationFrame(loop);
        else {
          this.simulationPairVisits += this.settleLayoutConstraints(2);
          if (this.data.nodes.length && this.physicsTopology) Renderer.prototype.repairSemanticViolations.call(this);
          this.incrementalLayoutActive = false;
          this.incrementalAnchors = new Map();
          this.incrementalMovableKeys = new Set();
          this.updatePositions();
          this.lastSimulationMS = (this.win.performance?.now?.() ?? Date.now()) - simulationStarted;
          this.container.dataset.simulationFrames = String(this.simulationFrames);
          this.container.dataset.simulationSteps = String(this.simulationSteps);
          this.container.dataset.pairVisits = String(this.simulationPairVisits);
          this.container.dataset.simulationMs = this.lastSimulationMS.toFixed(1);
          const semantic = Renderer.prototype.updateSemanticDiagnostics.call(this);
          this.container.dataset.simulationState = semantic.satisfied ? "stable" : "semantic-degraded";
          this.updateCounts();
          if (this.fitAfterSimulation) {
            this.fitAfterSimulation = false;
            this.fit();
          }
          if (this.selection?.kind === "node") this.scheduleSelectionReveal(keyOf(this.selection.value));
        }
      };
      this.frame = this.win.requestAnimationFrame(loop);
    }

    relaxCollisions(iterations = 6) {
      const positionedNodes = this.data.nodes.filter(node => this.positions.has(keyOf(node)))
        .sort((left, right) => keyOf(left).localeCompare(keyOf(right)));
      const positions = positionedNodes.map(node => this.positions.get(keyOf(node)));
      const distances = positionedNodes.map(node => (this.nodeElements.get(keyOf(node))?.radius || 10) + 8);
      for (const [index, position] of positions.entries()) {
        const key = keyOf(positionedNodes[index]);
        position.simulationFixed = this.incrementalLayoutActive
          && this.incrementalAnchors.has(key)
          && !this.incrementalMovableKeys.has(key);
      }
      let visits = 0;
      for (let iteration = 0; iteration < Math.max(0, iterations); iteration++) {
        visits += forEachNearbyPair(positions, 90, 45, (leftIndex, rightIndex) => {
          resolveCollisionPair(
            positions[leftIndex],
            positions[rightIndex],
            distances[leftIndex] + distances[rightIndex],
            0.72,
            hashUnit(`${keyOf(positionedNodes[leftIndex])}:${keyOf(positionedNodes[rightIndex])}:relax`) * Math.PI * 2,
          );
        });
      }
      for (const position of positions) delete position.simulationFixed;
      return visits;
    }

    updateSemanticDiagnostics() {
      const report = seedProximityDiagnostics(this.positions, this.physicsTopology);
      const satisfied = semanticLayoutSatisfied(report, this.data.nodes.length);
      const warning = semanticWarningText(report, this.data.nodes.length);
      this.container.dataset.semanticCandidates = String(report.total);
      this.container.dataset.semanticHitRate = report.rate.toFixed(4);
      this.container.dataset.semanticViolations = String(report.violations);
      this.container.dataset.semanticWorstRank = String(report.worstRank);
      this.container.dataset.semanticMinimumMargin = report.minimumMargin === null
        ? ""
        : report.minimumMargin.toFixed(3);
      this.container.dataset.semanticState = satisfied ? "stable" : "degraded";
      if (this.semanticWarning) {
        this.semanticWarning.textContent = warning;
      }
      const detail = { ...report, satisfied, warning };
      this.lastSemanticReport = detail;
      if (this.win?.CustomEvent && this.container?.dispatchEvent) {
        this.container.dispatchEvent(new this.win.CustomEvent("zlg-semantic-state", { detail }));
      }
      return detail;
    }

    repairSemanticViolations() {
      if (this.data.nodes.length > 60) return null;
      const radii = new Map(this.data.nodes.map(node => [
        keyOf(node),
        this.nodeElements.get(keyOf(node))?.radius || 10,
      ]));
      const result = repairSeedProximityViolations(this.positions, this.physicsTopology, radii, {
        targetMargin: 8,
        collisionGap: 8,
        maxPasses: 8,
      });
      this.semanticRepairCount += result.repairedCandidates;
      this.semanticRepairVisits += result.projectionVisits;
      this.semanticRepairMaxPasses = Math.max(
        this.semanticRepairMaxPasses,
        ...result.repaired.map(value => value.passes),
      );
      this.container.dataset.semanticRepairedCandidates = String(this.semanticRepairCount);
      this.container.dataset.semanticRepairMaxPasses = String(this.semanticRepairMaxPasses);
      this.container.dataset.semanticRepairVisits = String(this.semanticRepairVisits);
      this.container.dataset.semanticUnresolvedCandidates = String(result.unresolved.length);
      return result;
    }

    settleLayoutConstraints(iterations = 2) {
      // Semantic projection retains a low heat floor during animation, so this
      // short final alternation only reconciles the last collision pass. Keeping
      // it intentionally small avoids a visible late-frame jump.
      const allowedKeys = this.incrementalLayoutActive ? this.incrementalMovableKeys : null;
      let visits = 0;
      for (let iteration = 0; iteration < Math.max(0, iterations); iteration++) {
        visits += enforceSeedProximity(this.positions, this.physicsTopology, 8, 7, 0.25, allowedKeys);
        visits += this.relaxCollisions(1);
      }
      return visits;
    }

    simulationStep() {
      const positionedNodes = this.data.nodes.filter(node => this.positions.has(keyOf(node)))
        .sort((left, right) => keyOf(left).localeCompare(keyOf(right)));
      const positions = positionedNodes.map(node => this.positions.get(keyOf(node)));
      const alpha = this.alpha;
      const isIncrementallyLocked = key => this.incrementalLayoutActive
        && this.incrementalAnchors.has(key)
        && !this.incrementalMovableKeys.has(key);
      const pairCount = forEachNearbyPair(positions, 360, 120, (leftIndex, rightIndex, initialDistanceSquared) => {
        const left = positions[leftIndex];
        const right = positions[rightIndex];
        let dx = left.x - right.x;
        let dy = left.y - right.y;
        let distanceSquared = initialDistanceSquared;
        if (distanceSquared < 1) {
          const pairKey = `${keyOf(positionedNodes[leftIndex])}\0${keyOf(positionedNodes[rightIndex])}`;
          dx = 0.5 - hashUnit(`${pairKey}:x`);
          dy = 0.5 - hashUnit(`${pairKey}:y`);
          distanceSquared = Math.max(0.01, dx * dx + dy * dy);
        }
        const distance = Math.sqrt(distanceSquared);
        const force = Math.min(4.5, (2800 * alpha) / distanceSquared);
        const fx = dx / distance * force;
        const fy = dy / distance * force;
        if (!left.fixed && !isIncrementallyLocked(keyOf(positionedNodes[leftIndex]))) { left.vx += fx; left.vy += fy; }
        if (!right.fixed && !isIncrementallyLocked(keyOf(positionedNodes[rightIndex]))) { right.vx -= fx; right.vy -= fy; }
      });
      for (const link of this.physicsTopology.links) {
        const source = this.positions.get(link.source);
        const target = this.positions.get(link.target);
        if (!source || !target) continue;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const sourceRadius = this.nodeElements.get(link.source)?.radius || 10;
        const targetRadius = this.nodeElements.get(link.target)?.radius || 10;
        const primarySeedLink = this.physicsTopology.primarySeedByKey.get(link.source) === link.target
          || this.physicsTopology.primarySeedByKey.get(link.target) === link.source;
        const sourceSeedCandidate = this.physicsTopology.seedKeys.has(link.source)
          ? link.target
          : this.physicsTopology.seedKeys.has(link.target) ? link.source : null;
        const seedCandidateLink = sourceSeedCandidate && this.physicsTopology.seedNeighborCounts.has(sourceSeedCandidate);
        const semanticGap = primarySeedLink ? 44 : link.primaryType === "similar" ? 112 : link.primaryType === "cites" ? 86 : 98;
        const desired = sourceRadius + targetRadius + semanticGap;
        const minDegree = Math.max(1, Math.min(
          this.physicsTopology.degrees.get(link.source) || 1,
          this.physicsTopology.degrees.get(link.target) || 1,
        ));
        const degreeNormalization = Math.max(0.45, 1 / Math.sqrt(minDegree));
        const baseTypeWeight = link.primaryType === "similar" ? 0.42 : 1;
        const typeWeight = primarySeedLink
          ? 4
          : seedCandidateLink
            ? Math.max(0.08, 0.9 / this.physicsTopology.seedNeighborCounts.get(sourceSeedCandidate))
            : baseTypeWeight;
        const multiplicity = Math.min(1.5, 1 + 0.25 * Math.log1p(Math.max(0, link.multiplicity - 1)));
        const force = (distance - desired) * 0.0072 * typeWeight * degreeNormalization * multiplicity * alpha;
        const fx = dx / distance * force;
        const fy = dy / distance * force;
        if (!source.fixed && !isIncrementallyLocked(link.source)) { source.vx += fx; source.vy += fy; }
        if (!target.fixed && !isIncrementallyLocked(link.target)) { target.vx -= fx; target.vy -= fy; }
      }
      for (const node of positionedNodes) {
        const position = this.positions.get(keyOf(node));
        if (!position || position.fixed || isIncrementallyLocked(keyOf(node))) continue;
        const componentIndex = this.physicsTopology.componentByKey.get(keyOf(node));
        const component = this.physicsTopology.components[componentIndex];
        const center = this.componentCenters.get(componentIndex);
        const gravity = component?.keys.length === 1 ? 0.014 : 0.0018;
        position.vx += ((center?.x ?? position.x) - position.x) * gravity * alpha;
        position.vy += ((center?.y ?? position.y) - position.y) * gravity * alpha;
        const seedHome = this.physicsTopology.seedHomePositions.get(keyOf(node));
        if (seedHome) {
          const homeDX = seedHome.x - position.x;
          const homeDY = seedHome.y - position.y;
          const homeDistance = Math.hypot(homeDX, homeDY);
          const homeForce = Math.min(0.8, homeDistance * 0.006 * alpha);
          if (homeDistance > 0.01) {
            position.vx += homeDX / homeDistance * homeForce;
            position.vy += homeDY / homeDistance * homeForce;
          }
        }
        const anchor = this.incrementalAnchors?.get(keyOf(node));
        if (this.incrementalLayoutActive && anchor) {
          position.vx += (anchor.x - position.x) * 0.08 * alpha;
          position.vy += (anchor.y - position.y) * 0.08 * alpha;
        }
        position.vx *= 0.82;
        position.vy *= 0.82;
        position.x += position.vx;
        position.y += position.vy;
        if (this.incrementalLayoutActive && anchor) {
          const anchorDX = position.x - anchor.x;
          const anchorDY = position.y - anchor.y;
          const anchorDistance = Math.hypot(anchorDX, anchorDY);
          if (anchorDistance > 30) {
            position.x = anchor.x + anchorDX / anchorDistance * 30;
            position.y = anchor.y + anchorDY / anchorDistance * 30;
            position.vx *= 0.35;
            position.vy *= 0.35;
          }
        }
        if (!this.incrementalLayoutActive && center && component?.keys.length > 1) {
          const centerDX = position.x - center.x;
          const centerDY = position.y - center.y;
          const centerDistance = Math.hypot(centerDX, centerDY);
          const maximumDistance = Math.max(48, Number(center.radius) || 48);
          if (centerDistance > maximumDistance) {
            position.x = center.x + centerDX / centerDistance * maximumDistance;
            position.y = center.y + centerDY / centerDistance * maximumDistance;
            position.vx *= 0.35;
            position.vy *= 0.35;
          }
        }
      }
      let visits = pairCount + this.relaxCollisions(2);
      const projectionStep = this.incrementalLayoutActive ? 2.5 : 7;
      const projectionKeys = this.incrementalLayoutActive ? this.incrementalMovableKeys : null;
      visits += enforceSeedProximity(
        this.positions,
        this.physicsTopology,
        8,
        projectionStep,
        Math.max(semanticHeatFloor(this.data), alpha),
        projectionKeys,
      );
      visits += this.relaxCollisions(1);
      return visits;
    }

    updatePositions() {
      const displayPositions = this.displayPositions();
      const changedKeys = this.currentLensChangedKeys || new Set();
      const affectedKeys = new Set([...changedKeys, ...this.lastLensChangedKeys]);
      const selectiveLensUpdate = affectedKeys.size > 0 && !(this.mode === "galaxy" && this.alpha > 0.018);
      for (const [key, value] of this.nodeElements) {
        if (selectiveLensUpdate && !affectedKeys.has(key)) continue;
        const position = displayPositions.get(key);
        if (position) value.group.setAttribute("transform", `translate(${position.x} ${position.y})`);
      }
      for (const value of this.edgeElements.values()) {
        const keys = edgeKeys(value.edge);
        if (selectiveLensUpdate && !affectedKeys.has(keys.source) && !affectedKeys.has(keys.target)) continue;
        const source = displayPositions.get(keys.source);
        const target = displayPositions.get(keys.target);
        if (!source || !target) continue;
        const sourceRadius = this.nodeElements.get(keys.source)?.radius || 8;
        const targetRadius = this.nodeElements.get(keys.target)?.radius || 8;
        const geometry = edgeLineGeometry(source, target, sourceRadius, targetRadius);
        value.visible.setAttribute("d", geometry.path);
      }
      this.updateLabelCollisions(displayPositions);
      this.lastLensChangedKeys = changedKeys;
    }

    updateLabelCollisions(displayPositions) {
      const occupied = [];
      const { width: viewportWidth, height: viewportHeight } = this.dimensions();
      const viewportScale = Math.max(0.001, Number(this.viewport?.k) || 1);
      const viewportX = Number(this.viewport?.x) || 0;
      const viewportY = Number(this.viewport?.y) || 0;
      const bounds = { left: 6, top: 6, right: viewportWidth - 6, bottom: viewportHeight - 6 };
      const selectedKey = this.selection?.kind === "node" ? keyOf(this.selection.value) : null;
      const compact = viewportScale < 0.72;
      const budget = Math.max(3, Math.min(60, Math.floor(viewportWidth * viewportHeight / (compact ? 10500 : 15000))));
      const nodeObstacles = [...this.nodeElements].map(([key, value]) => {
        const position = displayPositions.get(key);
        const padding = value.radius * viewportScale + 4;
        return position ? {
          key,
          left: position.x * viewportScale + viewportX - padding,
          right: position.x * viewportScale + viewportX + padding,
          top: position.y * viewportScale + viewportY - padding,
          bottom: position.y * viewportScale + viewportY + padding,
        } : null;
      }).filter(Boolean);
      const priority = [...new Set([
        this.hoverKey, selectedKey,
        ...[...this.nodeElements].filter(([,value]) => value.node?.isQueued).map(([key]) => key),
        ...this.labelPriority,
      ].filter(Boolean))];
      let visibleCount = 0;
      for (const key of priority) {
        const value = this.nodeElements.get(key);
        const position = displayPositions.get(key);
        if (!value?.caption || !position) continue;
        const force = key === selectedKey || key === this.hoverKey;
        const level = compact && !force ? "overview" : "reading";
        const lines = level === "reading" ? value.titleLines : [];
        const width = level === "reading" ? value.readingWidth : value.overviewWidth;
        const height = lines.length * 17 + (value.authorYear ? 18 : 0) + 10;
        if (value.caption.dataset.level !== level) {
          value.label.replaceChildren(...lines.map((line, index) => {
            const span = svgElement(value.label.ownerDocument, "tspan", { x: 8, y: 17 + index * 17 });
            span.textContent = line;
            return span;
          }));
          value.meta.textContent = value.authorYear;
          value.meta.setAttribute("y", lines.length * 17 + 17);
          value.labelPlate.setAttribute("width", width);
          value.labelPlate.setAttribute("height", height);
          value.caption.dataset.level = level;
        }
        const point = { x: position.x * viewportScale + viewportX, y: position.y * viewportScale + viewportY };
        const onCanvas = point.x >= 0 && point.x <= viewportWidth && point.y >= 0 && point.y <= viewportHeight;
        const box = onCanvas && (force || visibleCount < budget) ? captionPlacement(
          point, value.radius * viewportScale, width, height, bounds,
          nodeObstacles.filter(other => other.key !== key), occupied, force,
          key === this.hoverKey && value.captionAnchor?.scale === viewportScale ? value.captionAnchor : null,
        ) : null;
        value.caption.style.display = box ? "" : "none";
        value.captionLink.style.display = box ? "" : "none";
        value.group.classList.toggle("has-label", Boolean(box));
        value.group.classList.toggle("is-label-collided", !box);
        if (!box) continue;
        value.captionAnchor = { x: box.left - point.x, y: box.top - point.y, scale: viewportScale };
        value.caption.setAttribute("transform", `translate(${box.left.toFixed(1)} ${box.top.toFixed(1)})`);
        const linkX = Math.max(box.left, Math.min(box.right, point.x));
        const linkY = Math.max(box.top, Math.min(box.bottom, point.y));
        const distance = Math.max(1, Math.hypot(linkX - point.x, linkY - point.y));
        const offset = value.radius * viewportScale + 2;
        value.captionLink.setAttribute("x1", point.x + (linkX - point.x) / distance * offset);
        value.captionLink.setAttribute("y1", point.y + (linkY - point.y) / distance * offset);
        value.captionLink.setAttribute("x2", linkX);
        value.captionLink.setAttribute("y2", linkY);
        occupied.push(box);
        visibleCount++;
      }
    }

    hideHoverPreview() {
      if (this.previewTimer) this.win.clearTimeout(this.previewTimer);
      this.previewTimer = null;
      if (this.hoverPreview) this.hoverPreview.hidden = true;
    }

    queueHoverPreview(key) {
      this.hideHoverPreview();
      if (this.dragState || this.panState) return;
      this.previewTimer = this.win.setTimeout(() => {
        this.previewTimer = null;
        if (this.hoverKey !== key || this.dragState || this.panState) return;
        const node = this.nodeElements.get(key)?.node;
        const preview = this.hoverPreview;
        if (!node || !preview || !this.svg) return;
        const doc = preview.ownerDocument;
        const title = doc.createElement("strong");
        title.textContent = node.title || ZLGT("未命名文献");
        const meta = doc.createElement("span");
        const authors = (node.authors || []).slice(0, 3).map(author => author.name).filter(Boolean).join(", ");
        meta.textContent = [authors + (node.authors?.length > 3 ? ZLGT(" 等") : ""), node.year].filter(Boolean).join(" · ");
        const state = doc.createElement("span");
        state.textContent = node.localKeys?.length ? ZLGT("Zotero 已有") : ZLGT("外部候选");
        preview.replaceChildren(title, meta, state);
        preview.hidden = false;
        const point = this.displayPositions().get(key);
        const { width, height } = this.dimensions();
        const rect = this.svg.getBoundingClientRect();
        const x = (point.x * this.viewport.k + this.viewport.x) * rect.width / width;
        const y = (point.y * this.viewport.k + this.viewport.y) * rect.height / height;
        preview.style.maxWidth = `${Math.max(100, Math.min(300, rect.width - 16))}px`;
        const box = preview.getBoundingClientRect();
        const preferredX = x + 24 + box.width <= rect.width - 8 ? x + 24 : x - box.width - 24;
        preview.style.left = `${Math.max(8, Math.min(rect.width - box.width - 8, preferredX))}px`;
        preview.style.top = `${Math.max(8, Math.min(rect.height - box.height - 8, y - box.height / 2))}px`;
      }, 250);
    }

    displayPositions() {
      this.currentLensChangedKeys = new Set();
      if (this.lens.strength < 0.001) return this.positions;
      const focus = this.lens.focusKey ? this.positions.get(this.lens.focusKey) : this.lens;
      if (!focus) return this.positions;
      const parameters = adaptiveLensParameters(this.positions, this.lens.focusKey, this.viewport.k, this.mode);
      const displayed = new Map();
      for (const [key, position] of this.positions) {
        const diffused = diffusePoint(position, focus, {
          strength: this.lens.strength,
          radius: parameters.radius,
          push: parameters.push,
          exponent: parameters.exponent,
          anchored: key === this.lens.focusKey,
          angle: hashUnit(`${key}:lens`) * Math.PI * 2,
        });
        displayed.set(key, diffused);
        if (Math.abs(diffused.x - position.x) > 0.001 || Math.abs(diffused.y - position.y) > 0.001) {
          this.currentLensChangedKeys.add(key);
        }
      }
      return displayed;
    }

    setLensFocus(focusKey) {
      if (!this.svg || !focusKey || this.dragState || this.panState) return;
      const point = this.positions.get(focusKey);
      if (!point) return;
      this.lens.x = point.x;
      this.lens.y = point.y;
      this.lens.focusKey = focusKey;
      this.lens.target = 1;
      this.svg.classList.add("has-lens");
      if (this.reducedMotion) {
        this.lens.strength = 1;
        this.updatePositions();
        return;
      }
      this.scheduleLens();
    }

    queueHoverLens(focusKey) {
      this.cancelHoverLens();
      if (!focusKey || this.lockedLensKey) return;
      this.hoverLensTimer = this.win.setTimeout(() => {
        this.hoverLensTimer = null;
        if (this.hoverKey === focusKey && !this.lockedLensKey) this.setLensFocus(focusKey);
      }, HOVER_LENS_DELAY_MS);
    }

    cancelHoverLens() {
      if (!this.hoverLensTimer) return;
      this.win.clearTimeout(this.hoverLensTimer);
      this.hoverLensTimer = null;
    }

    clearLens(immediate = false) {
      this.lens.target = 0;
      if (immediate || this.reducedMotion) {
        if (this.lensFrame) this.win.cancelAnimationFrame(this.lensFrame);
        this.lensFrame = null;
        this.lens.strength = 0;
        this.lens.focusKey = null;
        this.svg?.classList.remove("has-lens");
        this.updatePositions();
        return;
      }
      this.scheduleLens();
    }

    scheduleLens() {
      if (this.lensFrame) return;
      const tick = () => {
        this.lensFrame = null;
        const delta = this.lens.target - this.lens.strength;
        const response = this.data.nodes.length >= 120 || this.data.edges.length >= 400 ? 0.70 : 0.24;
        this.lens.strength = Math.abs(delta) < 0.015 ? this.lens.target : this.lens.strength + delta * response;
        if (Math.abs(this.lens.target - this.lens.strength) < 0.015) this.lens.strength = this.lens.target;
        if (!this.lens.strength && !this.lens.target) {
          this.lens.focusKey = null;
          this.svg?.classList.remove("has-lens");
        }
        this.updatePositions();
        if (this.lens.target !== this.lens.strength) {
          this.lensFrame = this.win.requestAnimationFrame(tick);
        }
      };
      this.lensFrame = this.win.requestAnimationFrame(tick);
    }

    startNodeDrag(event, key) {
      if (event.button !== 0) return;
      this.hideHoverPreview();
      event.stopPropagation();
      this.clearLens(true);
      const position = this.positions.get(key);
      if (!position) return;
      try { this.svg.setPointerCapture?.(event.pointerId); }
      catch {}
      this.dragState = {
        pointerId: event.pointerId,
        key,
        moved: false,
        clientX: event.clientX,
        clientY: event.clientY,
      };
    }

    startPan(event) {
      if (event.button !== 0 || this.dragState) return;
      this.hideHoverPreview();
      this.cancelHoverLens();
      this.clearLens(true);
      try { this.svg.setPointerCapture?.(event.pointerId); }
      catch {}
      this.panState = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: this.viewport.x, y: this.viewport.y, moved: false };
      this.svg.classList.add("is-panning");
    }

    onPointerMove(event) {
      if (this.dragState?.pointerId === event.pointerId) {
        if (!this.dragState.moved && !dragThresholdExceeded(
          event.clientX - this.dragState.clientX,
          event.clientY - this.dragState.clientY,
        )) return;
        const point = this.toWorld(event.clientX, event.clientY);
        const position = this.positions.get(this.dragState.key);
        if (position) {
          position.fixed = true;
          position.vx = 0;
          position.vy = 0;
          position.x = point.x;
          position.y = point.y;
          this.dragState.moved = true;
          this.updatePositions();
          this.startSimulation(0.28);
        }
        return;
      }
      if (this.panState?.pointerId === event.pointerId) {
        if (Math.hypot(event.clientX - this.panState.clientX, event.clientY - this.panState.clientY) > 3) this.panState.moved = true;
        this.viewport.x = this.panState.x + event.clientX - this.panState.clientX;
        this.viewport.y = this.panState.y + event.clientY - this.panState.clientY;
        this.applyViewport();
        return;
      }
    }

    endPointer(event) {
      let selectOnRelease = null;
      if (this.dragState?.pointerId === event.pointerId) {
        const dragKey = this.dragState.key;
        const position = this.positions.get(dragKey);
        if (position) position.fixed = false;
        if (this.dragState.moved) {
          this.suppressClick = { key: dragKey, until: Date.now() + 250 };
          this.startSimulation(0.18);
        }
        else if (event.type === "pointerup") {
          // Pointer capture moves the physical pointerup/click target to the SVG
          // in Zotero's Gecko window. Commit a stationary node press here rather
          // than relying on the later DOM click, which may never reach the node.
          this.suppressClick = { key: dragKey, until: Date.now() + 400 };
          this.suppressStageClickUntil = Date.now() + 400;
          selectOnRelease = this.nodeElements.get(dragKey)?.node
            || this.data.nodes.find(node => keyOf(node) === dragKey)
            || null;
        }
        this.dragState = null;
        if (this.lockedLensKey) this.setLensFocus(this.lockedLensKey);
      }
      if (this.panState?.pointerId === event.pointerId) {
        if (this.panState.moved) this.suppressStageClickUntil = Date.now() + 250;
        this.panState = null;
        this.svg.classList.remove("is-panning");
        if (this.lockedLensKey) this.setLensFocus(this.lockedLensKey);
      }
      try { this.svg.releasePointerCapture?.(event.pointerId); }
      catch {}
      if (selectOnRelease) this.selectNode(selectOnRelease, {
        lockLens: true,
        notify: true,
        focusReturn: this.nodeElements.get(keyOf(selectOnRelease))?.group || null,
      });
    }

    toWorld(clientX, clientY) {
      const rect = this.svg.getBoundingClientRect();
      const { width, height } = this.dimensions();
      const svgX = (clientX - rect.left) * width / Math.max(1, rect.width);
      const svgY = (clientY - rect.top) * height / Math.max(1, rect.height);
      return { x: (svgX - this.viewport.x) / this.viewport.k, y: (svgY - this.viewport.y) / this.viewport.k };
    }

    edgeAtPoint(clientX, clientY, thresholdPixels = 8) {
      if (!this.svg || !this.edgeElements.size) return null;
      const point = this.toWorld(clientX, clientY);
      const displayPositions = this.displayPositions();
      const threshold = Math.max(2, Number(thresholdPixels) || 8) / Math.max(0.001, this.viewport.k);
      const maximumDistanceSquared = threshold * threshold;
      let nearest = null;
      for (const [key, value] of this.edgeElements) {
        const keys = edgeKeys(value.edge);
        const source = displayPositions.get(keys.source);
        const target = displayPositions.get(keys.target);
        if (!source || !target) continue;
        const sourceRadius = this.nodeElements.get(keys.source)?.radius || 8;
        const targetRadius = this.nodeElements.get(keys.target)?.radius || 8;
        const geometry = edgeLineGeometry(source, target, sourceRadius, targetRadius);
        const dx = geometry.endX - geometry.startX;
        const dy = geometry.endY - geometry.startY;
        const lengthSquared = dx * dx + dy * dy;
        const ratio = lengthSquared > 0
          ? Math.max(0, Math.min(1, ((point.x - geometry.startX) * dx + (point.y - geometry.startY) * dy) / lengthSquared))
          : 0;
        const offsetX = point.x - (geometry.startX + ratio * dx);
        const offsetY = point.y - (geometry.startY + ratio * dy);
        const distanceSquared = offsetX * offsetX + offsetY * offsetY;
        if (distanceSquared > maximumDistanceSquared) continue;
        if (!nearest || distanceSquared < nearest.distanceSquared || (distanceSquared === nearest.distanceSquared && key < nearest.key)) {
          nearest = { key, distanceSquared, edge: value.edge };
        }
      }
      return nearest?.edge || null;
    }

    focusNode(key) {
      const target = this.nodeElements.get(key)?.group;
      if (!target) return;
      this.keyboardFocusKey = key;
      for (const [candidateKey, candidate] of this.nodeElements) {
        candidate.group.setAttribute("tabindex", candidateKey === key ? "0" : "-1");
      }
      target.focus();
    }

    nodesAtPoint(clientX, clientY) {
      const point = this.toWorld(clientX, clientY);
      const displayPositions = this.displayPositions();
      const zOrderKeys = [...(this.nodesGroup?.children || [])].map(element => element.dataset.workKey);
      return orderedHitKeys(this.nodeElements, displayPositions, point, zOrderKeys);
    }

    cycleStackAtKey(focusKey, direction) {
      const displayPositions = this.displayPositions();
      const focus = displayPositions.get(focusKey);
      if (!focus || !this.svg) return false;
      const zOrderKeys = [...(this.nodesGroup?.children || [])].map(element => element.dataset.workKey);
      const keys = orderedHitKeys(this.nodeElements, displayPositions, focus, zOrderKeys);
      if (keys.length < 2) return false;
      const current = Math.max(0, keys.indexOf(focusKey));
      const index = (current + direction + keys.length) % keys.length;
      const { width, height } = this.dimensions();
      const rect = this.svg.getBoundingClientRect();
      const clientX = rect.left + (focus.x * this.viewport.k + this.viewport.x) / width * rect.width;
      const clientY = rect.top + (focus.y * this.viewport.k + this.viewport.y) / height * rect.height;
      const state = { keys, index, clientX, clientY, expiresAt: Date.now() + 2200 };
      this.cycleState = state;
      const node = this.nodeElements.get(keys[index])?.node;
      if (node) {
        this.selectNode(node, { lockLens: true, notify: true });
        this.focusNode(keys[index]);
      }
      this.showStackBadge(state);
      return Boolean(node);
    }

    stackForWheel(clientX, clientY) {
      const current = this.cycleState;
      if (current && Date.now() < current.expiresAt && Math.hypot(clientX - current.clientX, clientY - current.clientY) < 36) {
        const keys = current.keys.filter(key => this.nodeElements.has(key));
        if (keys.length > 1) return { ...current, keys, clientX, clientY, expiresAt: Date.now() + 2200 };
      }
      const keys = this.nodesAtPoint(clientX, clientY);
      if (keys.length < 2) return null;
      const selectedKey = this.selection?.kind === "node" ? keyOf(this.selection.value) : null;
      return {
        keys,
        index: Math.max(-1, keys.indexOf(selectedKey)),
        clientX,
        clientY,
        expiresAt: Date.now() + 2200,
      };
    }

    showStackBadge(state) {
      if (!this.stackBadge) return;
      const rect = this.container.getBoundingClientRect();
      this.stackBadge.textContent = ZLGT`重叠层 ${state.index + 1}/${state.keys.length}`;
      this.stackBadge.style.left = `${Math.max(8, Math.min(rect.width - 100, state.clientX - rect.left + 14))}px`;
      this.stackBadge.style.top = `${Math.max(8, Math.min(rect.height - 32, state.clientY - rect.top + 14))}px`;
      this.stackBadge.hidden = false;
      if (this.cycleTimer) this.win.clearTimeout(this.cycleTimer);
      this.cycleTimer = this.win.setTimeout(() => {
        if (this.stackBadge) this.stackBadge.hidden = true;
      }, 1500);
    }

    zoomAtPoint(event) {
      const before = this.toWorld(event.clientX, event.clientY);
      const { width, height } = this.dimensions();
      const factor = zoomFactorForWheel(event.deltaY, event.deltaMode, height);
      const next = Math.max(0.22, Math.min(4.5, this.viewport.k * factor));
      const rect = this.svg.getBoundingClientRect();
      const svgX = (event.clientX - rect.left) * width / Math.max(1, rect.width);
      const svgY = (event.clientY - rect.top) * height / Math.max(1, rect.height);
      this.viewport.k = next;
      this.viewport.x = svgX - before.x * next;
      this.viewport.y = svgY - before.y * next;
      this.applyViewport();
      if (this.lens.strength > 0) this.updatePositions();
    }

    onWheel(event) {
      this.hideHoverPreview();
      event.preventDefault();
      event.stopPropagation();
      if (!event.ctrlKey) {
        this.cycleState = null;
        this.zoomAtPoint(event);
        return;
      }
      const state = this.stackForWheel(event.clientX, event.clientY);
      if (!state) return;
      const direction = event.deltaY >= 0 ? 1 : -1;
      state.index = (state.index + direction + state.keys.length) % state.keys.length;
      state.expiresAt = Date.now() + 2200;
      this.cycleState = state;
      const node = this.nodeElements.get(state.keys[state.index])?.node;
      if (node) this.selectNode(node, { lockLens: true, notify: true });
      this.suppressStageClickUntil = Date.now() + 400;
      this.showStackBadge(state);
    }

    applyViewport() {
      this.viewportGroup?.setAttribute("transform", `translate(${this.viewport.x} ${this.viewport.y}) scale(${this.viewport.k})`);
      if (this.nodeElements?.size) this.updateLabelCollisions(this.displayPositions());
    }

    scheduleSelectionReveal(workKey) {
      if (!workKey) return;
      if (this.selectionRevealFrame) this.win.cancelAnimationFrame(this.selectionRevealFrame);
      if (this.selectionRevealTimer) this.win.clearTimeout(this.selectionRevealTimer);
      this.selectionRevealFrame = this.win.requestAnimationFrame(() => {
        this.selectionRevealFrame = this.win.requestAnimationFrame(() => {
          this.selectionRevealFrame = null;
          this.ensureSelectionVisible(workKey);
        });
      });
      this.selectionRevealTimer = this.win.setTimeout(() => {
        this.selectionRevealTimer = null;
        this.ensureSelectionVisible(workKey);
      }, 240);
    }

    ensureSelectionVisible(workKey) {
      if (!this.detail || this.detail.classList.contains("is-empty")) return;
      if (this.selection?.kind !== "node" || keyOf(this.selection.value) !== workKey) return;
      const element = this.nodeElements.get(workKey);
      const halo = element?.group?.querySelector?.(".zlg-node-halo");
      if (!halo || !this.svg || !this.viewportGroup) return;
      const containerRect = this.container.getBoundingClientRect();
      const detailRect = this.detail.getBoundingClientRect();
      const overlaps = detailRect.left < containerRect.right - 1
        && detailRect.right > containerRect.left + 1
        && detailRect.top < containerRect.bottom - 1
        && detailRect.bottom > containerRect.top + 1;
      if (!overlaps) {
        if (this.selectionViewportRestore) this.restoreSelectionViewport();
        this.container.dataset.selectionReveal = "not-needed";
        return;
      }
      const haloRect = halo.getBoundingClientRect();
      const labelRect = element.labelPlate?.getBoundingClientRect?.();
      const visibleLeft = containerRect.left + 20;
      const visibleRight = Math.min(containerRect.right - 20, detailRect.left - 20);
      const visibleTop = containerRect.top + 20;
      const visibleBottom = containerRect.bottom - 20;
      if (visibleRight - visibleLeft < Math.max(1, haloRect.width) || visibleBottom - visibleTop < Math.max(1, haloRect.height)) {
        this.container.dataset.selectionReveal = "unavailable";
        return;
      }
      const labelAxisCoverage = Math.sqrt(0.75);
      const deltaX = selectionRevealDelta({
        visibleLeft,
        visibleRight,
        haloLeft: haloRect.left,
        haloRight: haloRect.right,
        labelLeft: labelRect?.width ? labelRect.left : null,
        labelRight: labelRect?.width ? labelRect.right : null,
        labelCoverage: labelAxisCoverage,
      });
      const deltaY = selectionRevealDelta({
        visibleLeft: visibleTop,
        visibleRight: visibleBottom,
        haloLeft: haloRect.top,
        haloRight: haloRect.bottom,
        labelLeft: labelRect?.height ? labelRect.top : null,
        labelRight: labelRect?.height ? labelRect.bottom : null,
        labelCoverage: labelAxisCoverage,
      });
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
        this.container.dataset.selectionReveal = "visible";
        return;
      }
      if (this.selectionViewportRestore?.workKey !== workKey) {
        this.restoreSelectionViewport();
        this.selectionViewportRestore = {
          workKey,
          before: { ...this.viewport },
          after: null,
        };
      }
      const { width, height } = this.dimensions();
      const svgRect = this.svg.getBoundingClientRect();
      this.viewport.x += deltaX * width / Math.max(1, svgRect.width);
      this.viewport.y += deltaY * height / Math.max(1, svgRect.height);
      this.applyViewport();
      this.selectionViewportRestore.after = { ...this.viewport };
      this.container.dataset.selectionReveal = "shifted";
      this.container.dataset.selectionRevealDelta = `${deltaX.toFixed(1)},${deltaY.toFixed(1)}`;
    }

    restoreSelectionViewport() {
      if (this.selectionRevealFrame) this.win.cancelAnimationFrame(this.selectionRevealFrame);
      if (this.selectionRevealTimer) this.win.clearTimeout(this.selectionRevealTimer);
      this.selectionRevealFrame = null;
      this.selectionRevealTimer = null;
      const restore = this.selectionViewportRestore;
      this.selectionViewportRestore = null;
      delete this.container.dataset.selectionReveal;
      delete this.container.dataset.selectionRevealDelta;
      if (!restore?.before) return;
      const after = restore.after;
      const viewportUnchanged = after
        && Math.abs(this.viewport.x - after.x) < 0.5
        && Math.abs(this.viewport.y - after.y) < 0.5
        && Math.abs(this.viewport.k - after.k) < 0.0001;
      if (!viewportUnchanged) return;
      this.viewport = { ...restore.before };
      this.applyViewport();
    }

    fit() {
      if (!this.positions.size || !this.viewportGroup) return;
      const selectedKey = this.selection?.kind === "node" ? keyOf(this.selection.value) : null;
      this.restoreSelectionViewport?.();
      const { width, height } = this.dimensions();
      const isolateKeys = new Set(this.physicsTopology.components
        .filter(component => this.data?.workspace !== "collection" && component.keys.length === 1)
        .flatMap(component => component.keys));
      const mainValues = [...this.positions].filter(([key]) => !isolateKeys.has(key)).map(([, value]) => value);
      const values = mainValues.length ? mainValues : [...this.positions.values()];
      if (!values.length) return;
      const minX = Math.min(...values.map(value => value.x));
      const maxX = Math.max(...values.map(value => value.x));
      const minY = Math.min(...values.map(value => value.y));
      const maxY = Math.max(...values.map(value => value.y));
      const graphWidth = Math.max(80, maxX - minX + 100);
      const graphHeight = Math.max(80, maxY - minY + 100);
      const scale = Math.max(0.22, Math.min(1.2, width / graphWidth, height / graphHeight));
      this.viewport.k = scale;
      this.viewport.x = width / 2 - (minX + maxX) / 2 * scale;
      this.viewport.y = height / 2 - (minY + maxY) / 2 * scale;
      this.applyViewport();
      if (this.lens.strength > 0) this.updatePositions();
      if (selectedKey) this.scheduleSelectionReveal?.(selectedKey);
    }

    updateCounts() {
      if (!this.counts) return;
      const visibleNodes = this.data.nodes?.length || 0;
      const visibleEdges = this.data.edges?.length || 0;
      const totalNodes = this.data.totalNodeCount ?? visibleNodes;
      const totalEdges = this.data.totalEdgeCount ?? visibleEdges;
      const isolateCount = this.data.workspace === "collection" ? 0 : this.physicsTopology.components.filter(component => component.keys.length === 1).length;
      const graphNodes = visibleNodes - isolateCount;
      this.counts.textContent = this.data.emptyReason === "filters"
        ? ZLGT`当前筛选无匹配 / 会话 ${totalNodes} 篇 · ${totalEdges} 条边`
        : totalNodes > visibleNodes || totalEdges > visibleEdges
        ? ZLGT`${visibleNodes} 可见 · ${visibleEdges} 条边 / 会话 ${totalNodes} 篇 · ${totalEdges} 条边`
        : ZLGT`${visibleNodes} 篇文献 · ${visibleEdges} 条关系`;
      const trayDetail = isolateCount
        ? ZLGT`主图 ${graphNodes} 篇 · 暂无连线 ${isolateCount} 篇${this.isolateTrayExpanded ? ZLGT("（列表已打开）") : ZLGT("（列表已关闭）")} · `
        : "";
      this.counts.title = ZLGT`${visibleNodes} 篇文献 · ${visibleEdges} 条关系${isolateCount ? ZLGT` · ${isolateCount} 篇暂无连线` : ""}`;
    }

    updateHighlight(hoverKey = null) {
      const selectedKey = this.selection?.kind === "node" ? keyOf(this.selection.value) : null;
      const focusKey = hoverKey || selectedKey;
      const relatedKeys = focusKey ? new Set([focusKey, ...(this.neighbors.get(focusKey) || [])]) : null;
      this.svg?.classList.toggle("has-focus", Boolean(focusKey));
      this.svg?.classList.toggle("has-hover-focus", Boolean(hoverKey));
      this.svg?.classList.toggle("has-locked-focus", Boolean(selectedKey && !hoverKey));
      for (const [key, value] of this.nodeElements) {
        value.group.classList.toggle("is-selected", key === selectedKey);
        value.group.classList.toggle("is-hovered", key === hoverKey);
        value.group.classList.toggle("is-related", Boolean(relatedKeys?.has(key) && key !== focusKey));
        value.group.classList.toggle("is-dimmed", Boolean(relatedKeys && !relatedKeys.has(key) && key !== selectedKey));
        value.group.setAttribute("aria-current", key === selectedKey ? "true" : "false");
        value.group.setAttribute("tabindex", key === this.keyboardFocusKey ? "0" : "-1");
        for (const name of ["is-selected", "is-hovered", "is-related", "is-dimmed"]) {
          value.caption?.classList.toggle(name, value.group.classList.contains(name));
        }
      }
      if (this.updateLabelCollisions && this.displayPositions) this.updateLabelCollisions(this.displayPositions());
      for (const key of [selectedKey, hoverKey]) {
        const caption = this.nodeElements.get(key)?.caption;
        if (caption?.parentNode && caption.parentNode.lastChild !== caption) caption.parentNode.appendChild(caption);
      }
      const selectedEdge = this.selection?.kind === "edge" ? edgeKey(this.selection.value) : null;
      for (const [key, value] of this.edgeElements) {
        const pair = edgeKeys(value.edge);
        const related = Boolean(focusKey) && (pair.source === focusKey || pair.target === focusKey);
        value.group.classList.toggle("is-selected", key === selectedEdge);
        value.group.classList.toggle("is-related", Boolean(focusKey && related));
        value.group.classList.toggle("is-dimmed", Boolean(focusKey && !related));
      }
    }

    drawTimelineGuides(doc, group, width, height) {
      const years = [...new Set(this.data.nodes.map(node => Number(node.year)).filter(Number.isFinite))].sort();
      const visibleYears = years.length > 14 ? years.filter((_, index) => index % Math.ceil(years.length / 12) === 0) : years;
      for (const yearValue of visibleYears) {
        const node = this.data.nodes.find(value => Number(value.year) === yearValue);
        const position = this.positions.get(keyOf(node));
        if (!position) continue;
        group.appendChild(svgElement(doc, "line", { x1: position.x, x2: position.x, y1: 28, y2: height - 38, class: "zlg-timeline-guide" }));
        const label = svgElement(doc, "text", { x: position.x, y: height - 18, class: "zlg-timeline-label" });
        label.textContent = yearValue;
        group.appendChild(label);
      }
      group.appendChild(svgElement(doc, "line", { x1: 52, x2: width - 42, y1: height - 38, y2: height - 38, class: "zlg-timeline-axis" }));
    }

    showPlaceholder() {
      if (!this.detail) return;
      this.closeDetailMenu?.();
      this.closeDetailMenu = null;
      this.detailRequestToken++;
      this.detail.classList.add("is-empty");
      const doc = this.detail.ownerDocument;
      const placeholder = doc.createElement("div");
      placeholder.className = "zlg-detail-placeholder";
      placeholder.textContent = ZLGT("点击节点查看详情");
      placeholder.style.whiteSpace = "pre-line";
      this.detail.replaceChildren(placeholder);
    }

    detailCloseButton() {
      const button = this.detail.ownerDocument.createElement("button");
      button.type = "button";
      button.className = "zlg-detail-close";
      button.textContent = "×";
      button.title = ZLGT("关闭详情");
      button.setAttribute("aria-label", ZLGT("关闭论文详情"));
      button.addEventListener("click", () => {
        const selectedKey = this.selection?.kind === "node"
          ? keyOf(this.selection.value)
          : this.keyboardFocusKey;
        const preferredTarget = this.selectionFocusReturn;
        this.clearSelection();
        this.win.requestAnimationFrame(() => {
          const target = preferredTarget?.isConnected
            ? preferredTarget
            : this.nodeElements.get(selectedKey)?.group;
          target?.focus?.();
          this.selectionFocusReturn = null;
        });
      });
      return button;
    }

    nodeCommandBar(node, related) {
      const doc = this.detail.ownerDocument;
      const bar = doc.createElement("div");
      bar.className = "zlg-detail-commandbar";
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", ZLGT("论文操作"));

      const sourceLinks = globalThis.ZLGPaperActions?.paperSourceLinks?.(node) || [];
      for (const source of sourceLinks) {
        const link = doc.createElement("a");
        link.className = "zlg-command-secondary";
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = source.label;
        link.title = source.url;
        if (this.onOpenExternal) {
          link.addEventListener("click", event => {
            event.preventDefault();
            const showFailure = error => {
              link.textContent = ZLGT("来源打开失败");
              const detail = error?.message ? `：${error.message}` : "";
              link.title = ZLGT`无法打开论文来源，请检查系统浏览器或重试${detail}`;
              link.setAttribute("aria-label", link.title);
            };
            try {
              Promise.resolve(this.onOpenExternal(source.url)).then(opened => {
                if (opened === false) showFailure();
                else {
                  link.textContent = source.label;
                  link.title = source.url;
                  link.removeAttribute("aria-label");
                }
              }).catch(showFailure);
            } catch (error) {
              showFailure(error);
            }
          });
        }
        bar.appendChild(link);
      }
      const doi = globalThis.ZLGPaperActions?.paperDOI?.(node) || "";
      if (doi && sourceLinks.some(source => source.kind === "doi")) {
        const copyDoi = doc.createElement("button");
        copyDoi.type = "button";
        copyDoi.className = "zlg-command-secondary";
        copyDoi.textContent = ZLGT("复制 DOI");
        copyDoi.addEventListener("click", async () => {
          try {
            let result;
            if (this.onCopyDOI) result = await this.onCopyDOI(doi);
            else {
              const writeText = doc.defaultView?.navigator?.clipboard?.writeText;
              if (!writeText) throw new Error("clipboard unavailable");
              result = await writeText.call(doc.defaultView.navigator.clipboard, doi);
            }
            if (result === false) throw new Error("copy rejected");
            copyDoi.textContent = ZLGT("DOI 已复制");
            copyDoi.title = ZLGT("DOI 已复制到系统剪贴板");
            copyDoi.setAttribute("aria-label", copyDoi.title);
          } catch (_) {
            copyDoi.textContent = ZLGT("复制失败（重试）");
            copyDoi.title = ZLGT("无法写入剪贴板，点击此按钮重试");
            copyDoi.setAttribute("aria-label", copyDoi.title);
          }
        });
        bar.appendChild(copyDoi);
      }
      if (this.onOpenPDF && node.hasPDF && node.localKeys?.length) {
        const readPDF = doc.createElement("button");
        readPDF.type = "button";
        readPDF.className = "zlg-command-primary";
        readPDF.textContent = ZLGT("阅读 PDF");
        readPDF.addEventListener("click", () => {
          const showFailure = error => {
            readPDF.textContent = ZLGT("PDF 打开失败（重试）");
            const detail = error?.message ? `：${error.message}` : "";
            readPDF.title = ZLGT`无法打开本地 PDF，点击此按钮重试${detail}`;
            readPDF.setAttribute("aria-label", readPDF.title);
          };
          try {
            Promise.resolve(this.onOpenPDF(node)).then(opened => {
              if (opened === false) showFailure();
              else {
                readPDF.textContent = ZLGT("阅读 PDF");
                readPDF.removeAttribute("title");
                readPDF.removeAttribute("aria-label");
              }
            }).catch(showFailure);
          } catch (error) {
            showFailure(error);
          }
        });
        bar.appendChild(readPDF);
      }

      if (this.onSelectItem && (node.localKeys?.length || (node.libraryID && node.itemKey))) {
        const localKey = node.localKeys?.[0] || null;
        const locate = doc.createElement("button");
        locate.type = "button";
        locate.className = "zlg-command-secondary";
        locate.textContent = node.localKeys?.length > 1 ? ZLGT`定位条目（1/${node.localKeys.length}）` : ZLGT("定位条目");
        locate.title = ZLGT("在 Zotero 中选中条目");
        locate.addEventListener("click", () => this.onSelectItem(node, localKey));
        bar.appendChild(locate);
      }

      if (!node.workKey || !this.onNodeAction) return bar;
      const protectedKeys = new Set(this.data.nodes.filter(value => value.isSeed || value.isPinned).map(keyOf));
      const nodeKey = keyOf(node);
      const collapsibleNeighborKeys = new Set(related.map(edge => {
        const keys = edgeKeys(edge);
        return keys.source === nodeKey ? keys.target : keys.source;
      }).filter(key => key !== nodeKey && !protectedKeys.has(key)));
      const specs = nodeActionSpecs(node, { hasNeighbors: collapsibleNeighborKeys.size > 0 }).filter(spec => this.data.workspace !== "collection" || spec.group === "explore");
      const seedSpec = specs.find(spec => spec.action === "seed");
      if (seedSpec) {
        const seed = doc.createElement("button");
        seed.type = "button";
        seed.className = "zlg-command-secondary";
        seed.dataset.nodeAction = seedSpec.action;
        seed.textContent = seedSpec.label;
        seed.title = seedSpec.title;
        seed.disabled = Boolean(seedSpec.disabled);
        seed.addEventListener("click", () => this.onNodeAction(node, seedSpec.action));
        bar.appendChild(seed);
      }

      const actionSpecs = specs.filter(spec => spec !== seedSpec);
      const directCollectionAction = this.data.workspace === "collection" ? collectionReadingAction(actionSpecs) : null;
      if (directCollectionAction) {
        const read = doc.createElement("button");
        read.type = "button";
        read.className = "zlg-command-secondary";
        read.dataset.nodeAction = directCollectionAction.action;
        read.textContent = directCollectionAction.label;
        read.title = directCollectionAction.title;
        read.disabled = Boolean(directCollectionAction.disabled);
        read.addEventListener("click", () => this.onNodeAction(node, directCollectionAction.action));
        bar.appendChild(read);
        return bar;
      }

      const menuWrap = doc.createElement("div");
      menuWrap.className = "zlg-action-menu-wrap";
      const more = doc.createElement("button");
      more.type = "button";
      more.className = "zlg-command-more";
      more.textContent = ZLGT("更多操作");
      more.setAttribute("aria-label", ZLGT("更多操作"));
      more.setAttribute("aria-haspopup", "menu");
      more.setAttribute("aria-expanded", "false");
      const menu = doc.createElement("div");
      menu.className = "zlg-detail-actions";
      menu.id = `zlg-node-actions-${String(nodeKey).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", ZLGT("更多操作"));
      menu.hidden = true;
      more.setAttribute("aria-controls", menu.id);
      const menuButtons = [];
      const enabledButtons = () => menuButtons.filter(button => !button.disabled);
      const handleOutsidePointer = event => {
        if (!menuWrap.contains(event.target)) setOpen(false);
      };
      const setOpen = (open, focusTarget = null) => {
        if (open && !enabledButtons().length) return;
        menu.hidden = !open;
        if (open) {
          const anchor = more.getBoundingClientRect();
          const bounds = menu.getBoundingClientRect();
          const view = doc.defaultView;
          const position = actionMenuPosition(anchor, bounds, {
            width: doc.documentElement.clientWidth || view.innerWidth,
            height: doc.documentElement.clientHeight || view.innerHeight,
          });
          menu.style.position = "fixed";
          menu.style.left = `${position.left}px`;
          menu.style.top = `${position.top}px`;
          menu.style.right = "auto";
          menu.style.bottom = "auto";
          menu.dataset.placement = position.placement;
        }
        else {
          menu.style.removeProperty("position");
          menu.style.removeProperty("left");
          menu.style.removeProperty("top");
          menu.style.removeProperty("right");
          menu.style.removeProperty("bottom");
          delete menu.dataset.placement;
        }
        more.setAttribute("aria-expanded", open ? "true" : "false");
        menuWrap.classList.toggle("is-open", open);
        if (open) doc.addEventListener("pointerdown", handleOutsidePointer, true);
        else doc.removeEventListener("pointerdown", handleOutsidePointer, true);
        if (open && focusTarget) {
          const enabled = enabledButtons();
          (focusTarget === "last" ? enabled.at(-1) : enabled[0])?.focus();
        }
      };
      this.closeDetailMenu = () => setOpen(false);
      for (const [index, localKey] of (this.onSelectItem ? (node.localKeys || []).slice(1) : []).entries()) {
        const duplicate = doc.createElement("button");
        duplicate.type = "button";
        duplicate.className = "zlg-detail-action is-local-duplicate";
        duplicate.textContent = ZLGT`定位 Zotero 副本 ${index + 2}`;
        duplicate.title = ZLGT`在 Zotero 主窗口中定位条目 ${localKey}`;
        duplicate.setAttribute("role", "menuitem");
        duplicate.tabIndex = -1;
        duplicate.addEventListener("click", () => {
          setOpen(false);
          this.onSelectItem(node, localKey);
        });
        menuButtons.push(duplicate);
        menu.appendChild(duplicate);
      }
      let previousGroup = null;
      let organizeDividerAdded = false;
      for (const spec of actionSpecs) {
        if (previousGroup !== spec.group) {
          const heading = doc.createElement("div");
          heading.className = "zlg-action-group-heading";
          heading.setAttribute("role", "presentation");
          heading.textContent = ({ explore: ZLGT("阅读清单"), view: ZLGT("图谱显示"), organize: ZLGT("候选整理") })[spec.group];
          menu.appendChild(heading);
          previousGroup = spec.group;
        }
        const button = doc.createElement("button");
        button.type = "button";
        button.className = `zlg-detail-action is-${spec.group}`;
        if (spec.group === "organize" && !organizeDividerAdded) {
          button.classList.add("starts-organize");
          organizeDividerAdded = true;
        }
        button.dataset.nodeAction = spec.action;
        button.textContent = spec.label;
        button.title = spec.title;
        button.setAttribute("role", "menuitem");
        button.tabIndex = -1;
        button.setAttribute("aria-label", `${spec.label}：${spec.title}`);
        button.disabled = Boolean(spec.disabled);
        button.addEventListener("click", () => {
          setOpen(false);
          this.onNodeAction(node, spec.action);
        });
        menuButtons.push(button);
        menu.appendChild(button);
      }
      more.disabled = !enabledButtons().length;
      more.title = more.disabled ? ZLGT("正在保存会话状态") : ZLGT("显示阅读、视图与候选管理操作");
      more.addEventListener("click", () => setOpen(menu.hidden, "first"));
      more.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true, event.key === "ArrowDown" ? "first" : "last");
        }
        else if (event.key === "Escape" && !menu.hidden) {
          event.preventDefault();
          setOpen(false);
        }
      });
      menu.addEventListener("keydown", event => {
        const enabled = enabledButtons();
        const current = enabled.indexOf(doc.activeElement);
        let next = null;
        if (event.key === "ArrowDown") next = (current + 1) % enabled.length;
        else if (event.key === "ArrowUp") next = (current - 1 + enabled.length) % enabled.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = enabled.length - 1;
        else if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          more.focus();
          return;
        }
        else if (event.key === "Tab") {
          setOpen(false);
          return;
        }
        if (next !== null) {
          event.preventDefault();
          enabled[next]?.focus();
        }
      });
      menuWrap.addEventListener("focusout", event => {
        if (!menuWrap.contains(event.relatedTarget)) setOpen(false);
      });
      menuWrap.append(more, menu);
      bar.appendChild(menuWrap);
      return bar;
    }

    detailBlock(titleText, bodyText = "") {
      const doc = this.detail.ownerDocument;
      const block = doc.createElement("details");
      block.className = "zlg-detail-block";
      const sectionKey = ZLGI18n.canonicalKey(titleText).replace(/（\{\d+\}）$/, "");
      block.open = this.detailSectionStates.get(sectionKey) ?? !["指标", "来源与排序", "Zotero 笔记", "文献集", "当前关系"].includes(sectionKey);
      block.addEventListener("toggle", () => {
        if (block.isConnected) this.detailSectionStates.set(sectionKey, block.open);
      });
      const summary = doc.createElement("summary");
      const heading = doc.createElement("h3");
      heading.textContent = titleText;
      summary.appendChild(heading);
      block.appendChild(summary);
      if (bodyText) {
        const text = doc.createElement("p");
        text.textContent = bodyText;
        block.appendChild(text);
      }
      return block;
    }

    renderLocalDetail(host, detail) {
      if (!detail) {
        host.replaceChildren(this.detailBlock(ZLGT("Zotero 详情"), ZLGT("本地条目暂时无法读取。")));
        return;
      }
      const doc = this.detail.ownerDocument;
      const bibliographic = this.detailBlock(ZLGT("书目信息"));
      const authorText = (detail.authors || []).map(author => author.name).join("；") || ZLGT("作者信息缺失");
      const sourceText = [detail.publicationTitle, detail.volume && `vol. ${detail.volume}`, detail.issue && `no. ${detail.issue}`, detail.pages && `pp. ${detail.pages}`].filter(Boolean).join(" · ");
      const bibliography = doc.createElement("p");
      bibliography.textContent = `${authorText}${sourceText ? `\n${sourceText}` : ""}`;
      bibliography.style.whiteSpace = "pre-line";
      bibliographic.appendChild(bibliography);
      host.replaceChildren(bibliographic);

      if (detail.abstract) host.appendChild(this.detailBlock(ZLGT("摘要"), detail.abstract));

      const collections = this.detailBlock(ZLGT`文献集（${detail.collections?.length || 0}）`);
      if (detail.collections?.length) {
        const list = doc.createElement("ul");
        list.className = "zlg-detail-list";
        for (const collection of detail.collections) {
          const row = doc.createElement("li");
          row.textContent = collection.path || collection.name;
          list.appendChild(row);
        }
        collections.appendChild(list);
      }
      else collections.append(ZLGT("该条目当前未加入文献集。"));
      host.appendChild(collections);

      const attachments = this.detailBlock(ZLGT`附件（${detail.attachments?.length || 0}）`);
      if (detail.attachments?.length) {
        for (const attachment of detail.attachments) {
          const button = doc.createElement("button");
          button.type = "button";
          button.className = "zlg-local-row";
          button.textContent = `${attachment.isPDF ? ZLGT("定位 PDF") : ZLGT("定位附件")} · ${attachment.title}`;
          button.addEventListener("click", () => this.onSelectLocalChild?.(attachment.key));
          attachments.appendChild(button);
        }
      }
      else attachments.append(ZLGT("没有本地附件。"));
      host.appendChild(attachments);

      const notes = this.detailBlock(ZLGT`Zotero 笔记（${detail.notes?.length || 0}）`);
      if (detail.notes?.length) {
        const help = doc.createElement("p");
        help.className = "zlg-detail-help";
        help.textContent = ZLGT("点击笔记，在 Zotero 中查看。");
        notes.appendChild(help);
        for (const note of detail.notes) {
          const button = doc.createElement("button");
          button.type = "button";
          button.className = "zlg-note-card";
          const title = doc.createElement("strong");
          title.textContent = note.title || ZLGT("未命名笔记");
          const preview = doc.createElement("span");
          const normalizedTitle = String(note.title || "").trim();
          const normalizedPreview = String(note.preview || "").trim();
          preview.textContent = normalizedPreview && normalizedPreview !== normalizedTitle
            ? normalizedPreview
            : normalizedPreview ? ZLGT("无额外预览") : ZLGT("空笔记");
          button.append(title, preview);
          button.addEventListener("click", () => this.onSelectLocalChild?.(note.key));
          notes.appendChild(button);
        }
      }
      else notes.append(ZLGT("暂无笔记。"));
      host.appendChild(notes);
    }

    showNodeDetail(node) {
      if (!this.detail) return;
      this.closeDetailMenu?.();
      this.closeDetailMenu = null;
      const token = ++this.detailRequestToken;
      this.detail.classList.remove("is-empty");
      const doc = this.detail.ownerDocument;
      const kicker = doc.createElement("div");
      kicker.className = "zlg-detail-kicker";
      const typeLabel = ({article:ZLGT("论文"),review:ZLGT("综述"),preprint:ZLGT("预印本"),book:ZLGT("图书"),"book-chapter":ZLGT("章节"),dissertation:ZLGT("学位论文"),dataset:ZLGT("数据集")})[node.type] || node.family || ZLGT("文献");
      kicker.textContent = `${node.year || "—"} · ${typeLabel}`;
      const title = doc.createElement("h2");
      title.textContent = node.title || ZLGT("未命名文献");
      const badges = doc.createElement("div");
      badges.className = "zlg-detail-badges";
      const meta = doc.createElement("div");
      meta.className = "zlg-detail-meta";
      const authors = (node.authors || []).map(author => author.name).filter(Boolean).join("；");
      const doi = node.identifiers?.doi || node.doi;
      meta.textContent = [authors || ZLGT("作者未知"),node.venue,doi ? `DOI ${doi}` : null].filter(Boolean).join("\n");
      meta.style.whiteSpace = "pre-line";
      const state = doc.createElement("span");
      state.className = "zlg-state-pill";
      state.textContent = node.localKeys?.length
        ? ZLGT`Zotero 已有${node.hasPDF ? ZLGT(" · 有 PDF") : ""}`
        : node.found === false ? ZLGT("条目未定位") : node.workKey ? ZLGT("外部候选") : ZLGT("Zotero 已定位");
      badges.appendChild(state);
      const stateBadges = [
        [node.isQueued, ZLGT("检索队列")],
        [node.candidateState === "reading-list", ZLGT("稍后阅读")],
        [node.candidateState === "excluded", ZLGT("已标记不相关")],
        [node.isPinned, ZLGT("保持显示")],
        [node.isContext, ZLGT("筛选上下文")],
        [node.isCollapsed, ZLGT("已收起相邻节点")],
      ];
      for (const [visible, label] of stateBadges) {
        if (!visible) continue;
        const badge = doc.createElement("span");
        badge.className = "zlg-state-pill is-session-state";
        badge.textContent = label;
        badges.appendChild(badge);
      }
      if (node.isRetracted) {
        const warning = doc.createElement("span");
        warning.className = "zlg-state-pill is-warning";
        warning.textContent = ZLGT("撤稿/撤回标记");
        badges.appendChild(warning);
      }
      const related = this.data.edges.filter(edge => {
        const keys = edgeKeys(edge);
        return keys.source === keyOf(node) || keys.target === keyOf(node);
      });
      if (!node.isSeed) {
        const seedKeys = new Set(this.data.nodes.filter(value => value.isSeed).map(keyOf));
        const connectedSeedKeys = new Set(related.flatMap(edge => {
          const keys = edgeKeys(edge);
          const otherKey = keys.source === keyOf(node) ? keys.target : keys.source;
          return seedKeys.has(otherKey) ? [otherKey] : [];
        }));
        if (connectedSeedKeys.size) {
          const badge = doc.createElement("span");
          badge.className = "zlg-state-pill is-seed-relation";
          badge.textContent = ZLGT`关联 ${connectedSeedKeys.size} 个检索起点`;
          badge.title = [...connectedSeedKeys].map(workKey => (
            this.data.nodes.find(value => keyOf(value) === workKey)?.title || workKey
          )).join("；");
          badges.appendChild(badge);
        }
      }
      const commandBar = this.nodeCommandBar(node, related);
      this.detail.replaceChildren(this.detailCloseButton(), kicker, title, badges, meta, commandBar);
      if (node.discovery?.explanation) {
        const reason = this.detailBlock(ZLGT("来源与排序"));
        const text = doc.createElement("p");
        const components = node.discovery.scoreComponents || {};
        const triggerTitles = (node.discovery.triggeredBy || []).map(workKey => (
          this.data.nodes.find(value => keyOf(value) === workKey)?.title || workKey
        ));
        const boundary = node.discovery.mode === "similar"
          ? ZLGT("相关推荐序号和排序分不是精确相似度。")
          : node.discovery.mode === "references"
            ? ZLGT("该排序用于组织候选，不代表参考文献的重要性。")
            : ZLGT("该排序用于组织候选，不代表论文影响力。");
        const summaryLines = [node.discovery.mode === "similar" ? ZLGT("OpenAlex 推荐。") : node.discovery.mode === "references" ? ZLGT("被所选文献引用。") : ZLGT("引用了所选文献。")];
        if (node.discovery.rankAtDiscovery) summaryLines.push(ZLGT`本次排序：${node.discovery.rankAtDiscovery}`);
        if (triggerTitles.length) summaryLines.push(ZLGT`触发起点：${triggerTitles.map(value => shortText(value, 42)).join("；")}`);
        summaryLines.push(boundary);
        const detailLines = [];
        if (Number.isFinite(Number(node.discovery.score))) {
          const defaultWeights = node.discovery.mode === "similar"
            ? { rankAffinity: 0.80, coverage: 0.15, impact: 0.05 }
            : node.discovery.mode === "references"
              ? { coverage: 0.70, impact: 0.30 }
              : node.discovery.mode === "citations"
                ? { coverage: 0.55, impact: 0.25, recency: 0.20 }
                : {};
          const weights = Object.keys(node.discovery.scoreWeights || {}).length
            ? node.discovery.scoreWeights
            : defaultWeights;
          const parts = [];
          if (weights.coverage) parts.push(ZLGT`起点覆盖 ${Math.round((Number(components.coverage) || 0) * 100)}% × ${Math.round(weights.coverage * 100)}%`);
          if (weights.rankAffinity) parts.push(ZLGT`返回顺序融合 ${Number(components.rankAffinity || 0).toFixed(3)} × ${Math.round(weights.rankAffinity * 100)}%`);
          if (weights.impact) parts.push(ZLGT`本次候选池原始被引分位 ${components.impactKnown === false ? ZLGT("未知") : `${Math.round((Number(components.impact) || 0) * 100)}%`} × ${Math.round(weights.impact * 100)}%`);
          if (weights.recency) parts.push(ZLGT`五年半衰期新近性 ${components.recencyKnown === false ? ZLGT("年份未知，记 0") : Number(components.recency || 0).toFixed(3)} × ${Math.round(weights.recency * 100)}%`);
          detailLines.push(ZLGT`候选排序分：${Number(node.discovery.score).toFixed(3)}${parts.length ? ` · ${parts.join(" · ")}` : ""}`);
          const positions = Object.entries(node.discovery.perSeedPositions || {}).map(([workKey, position]) => {
            const source = this.data.nodes.find(value => keyOf(value) === workKey);
            return `${shortText(source?.title || workKey, 34)} #${position}`;
          });
          if (positions.length && node.discovery.mode === "similar") detailLines.push(ZLGT`提供方返回序号：${positions.join("；")}（序号不是相似度）`);
          detailLines.push(ZLGT`成功起点：${node.discovery.successfulSeedCount || triggerTitles.length}/${node.discovery.requestedSeedCount || triggerTitles.length || 1}`);
          detailLines.push(ZLGT`算法：${node.discovery.scoreVersion || "—"} · 计算时间：${formatTimestamp(node.discovery.scoredAt)}`);
          detailLines.push(ZLGT("刷新被引量不会悄悄改序；只有重新发现才会重算。"));
        }
        text.textContent = summaryLines.join("\n");
        text.style.whiteSpace = "pre-line";
        reason.appendChild(text);
        if (detailLines.length) {
          const scoreDetails = doc.createElement("details");
          scoreDetails.className = "zlg-score-details";
          const scoreSummary = doc.createElement("summary");
          scoreSummary.textContent = ZLGT("排序详情");
          const scoreText = doc.createElement("p");
          scoreText.textContent = detailLines.join("\n");
          scoreText.style.whiteSpace = "pre-line";
          scoreDetails.append(scoreSummary, scoreText);
          reason.appendChild(scoreDetails);
        }
        this.detail.appendChild(reason);
      }
      if (this.data.graphTruncated) {
        const viewWarning = this.detailBlock(ZLGT("截取视图"), ZLGT("当前只显示部分图谱，关系可能不完整。"));
        viewWarning.classList.add("is-view-warning");
        this.detail.appendChild(viewWarning);
      }
      const metrics = this.detailBlock(ZLGT("指标"));
      const metricText = doc.createElement("p");
      metricText.className = "zlg-metric-text";
      const citationCount = citationCountOf(node.citationCount);
      const citationKnown = citationCount !== null;
      metricText.textContent = node.provider === "openalex" || String(node.workKey || "").startsWith("openalex:")
        ? ZLGT`OpenAlex 被引：${citationKnown ? citationCount.toLocaleString(ZLGI18n.locale()) : ZLGT("未知")}\n获取时间：${formatTimestamp(node.fetchedAt)}\n数据源更新时间：${formatTimestamp(node.providerUpdatedAt)}\n节点大小：${nodeSizeModeLabel(this.nodeSizeMode)}`
        : ZLGT`未匹配 OpenAlex，被引量未知。\n节点大小：${nodeSizeModeLabel(this.nodeSizeMode)}`;
      metricText.style.whiteSpace = "pre-line";
      metrics.appendChild(metricText);
      this.detail.appendChild(metrics);
      if (Number(node.duplicateCount) > 1) {
        const warning = doc.createElement("div");
        warning.className = "zlg-detail-block";
        const heading = doc.createElement("h3");
        heading.textContent = ZLGT("重复条目");
        const text = doc.createElement("p");
        text.textContent = ZLGT`发现 ${node.duplicateCount} 个相同 DOI 条目，未自动合并。`;
        warning.append(heading, text);
        this.detail.appendChild(warning);
      }
      const localHost = doc.createElement("div");
      localHost.className = "zlg-local-detail";
      if (node.localKeys?.length && this.onRequestNodeDetail) {
        const loading = this.detailBlock(ZLGT("Zotero 详情"), ZLGT("读取详情…"));
        localHost.replaceChildren(loading);
        const localKey = node.localKeys[0];
        const cached = this.detailCache.get(localKey);
        if (cached) this.renderLocalDetail(localHost, cached);
        else {
          let request = this.detailRequests.get(localKey);
          if (!request) {
            request = Promise.resolve(this.onRequestNodeDetail(node, localKey)).then(detail => {
              this.detailCache.set(localKey, detail);
              this.detailRequests.delete(localKey);
              return detail;
            }).catch(error => {
              this.detailRequests.delete(localKey);
              throw error;
            });
            this.detailRequests.set(localKey, request);
          }
          request.then(detail => {
          if (this.detailRequestToken === token && this.selection?.kind === "node" && keyOf(this.selection.value) === keyOf(node)) {
            this.renderLocalDetail(localHost, detail);
          }
          }).catch(error => {
            if (this.detailRequestToken === token) localHost.replaceChildren(this.detailBlock(ZLGT("Zotero 详情"), ZLGT`读取失败：${error.message || error}`));
          });
        }
        this.detail.appendChild(localHost);
      }

      const block = this.detailBlock(ZLGT`当前关系（${related.length}）`);
      const nodeKey = keyOf(node);
      const citationIncoming = related.filter(edge => edge.type === "cites" && edgeKeys(edge).target === nodeKey).length;
      const citationOutgoing = related.filter(edge => edge.type === "cites" && edgeKeys(edge).source === nodeKey).length;
      for (const [label, count] of [[ZLGT("引用了"), citationOutgoing], [ZLGT("被引用"), citationIncoming]]) {
        if (!count) continue;
        const pill = doc.createElement("span");
        pill.className = "zlg-type-pill";
        pill.textContent = `${label} ${count}`;
        block.appendChild(pill);
      }
      const relationCounts = new Map();
      for (const edge of related) relationCounts.set(edge.type || "cites", (relationCounts.get(edge.type || "cites") || 0) + 1);
      for (const [type, count] of relationCounts) {
        if (type === "cites") continue;
        const pill = doc.createElement("span");
        pill.className = "zlg-type-pill";
        pill.textContent = `${ZLGT(LABELS[type]) || type} ${count}`;
        block.appendChild(pill);
      }
      if (related.length) {
        const relationList = doc.createElement("div");
        relationList.className = "zlg-relation-list";
        relationList.setAttribute("role", "list");
        for (const [relationIndex, edge] of related.entries()) {
          const keys = edgeKeys(edge);
          const otherKey = keys.source === nodeKey ? keys.target : keys.source;
          const otherNode = this.nodeElements.get(otherKey)?.node || this.data.nodes.find(value => keyOf(value) === otherKey);
          const item = doc.createElement("div");
          item.setAttribute("role", "listitem");
          if (relationIndex >= 6) item.hidden = true;
          const button = doc.createElement("button");
          button.type = "button";
          button.className = "zlg-relation-row";
          const relationLabel = edge.type === "cites"
            ? keys.source === nodeKey ? ZLGT("引用了") : ZLGT("被其引用")
            : ZLGT(LABELS[edge.type]) || edge.type || ZLGT("关系");
          button.textContent = `${relationLabel} · ${shortText(otherNode?.title || otherKey, 52)}`;
          button.addEventListener("click", () => this.selectEdge(edge));
          item.appendChild(button);
          relationList.appendChild(item);
        }
        block.appendChild(relationList);
        if (related.length > 6) {
          const expand = doc.createElement("button");
          expand.type = "button";
          expand.className = "zlg-relation-expand";
          expand.textContent = ZLGT`展开全部 ${related.length} 条`;
          expand.addEventListener("click", () => {
            const items = [...relationList.children];
            const opening = items.some(item => item.hidden);
            items.forEach((item, index) => { item.hidden = !opening && index >= 6; });
            expand.textContent = opening ? ZLGT("收起列表") : ZLGT`展开全部 ${related.length} 条`;
          });
          block.appendChild(expand);
        }
      }
      this.detail.appendChild(block);
    }

    showEdgeDetail(edge) {
      if (!this.detail) return;
      this.closeDetailMenu?.();
      this.closeDetailMenu = null;
      this.detailRequestToken++;
      this.detail.classList.remove("is-empty");
      const doc = this.detail.ownerDocument;
      const kicker = doc.createElement("div");
      kicker.className = "zlg-detail-kicker";
      kicker.textContent = edge.evidence?.length ? ZLGT("关系证据") : ZLGT("关系来源");
      const title = doc.createElement("h2");
      title.textContent = ZLGT(LABELS[edge.type]) || edge.type;
      const status = doc.createElement("span");
      status.className = "zlg-state-pill";
      status.textContent = edge.status === "verified" ? ZLGT("已核验") : edge.provider || edge.status || ZLGT("外部发现边");
      const direction = doc.createElement("div");
      direction.className = "zlg-detail-meta";
      direction.textContent = edge.source && edge.target
        ? `${edge.source.year || "—"} ${shortText(edge.source.title, 32)}\n→ ${ZLGT(LABELS[edge.type]) || edge.type}\n${edge.target.year || "—"} ${shortText(edge.target.title, 32)}`
        : `${edge.sourceWorkKey}\n→ ${ZLGT(LABELS[edge.type]) || edge.type}\n${edge.targetWorkKey}`;
      direction.style.whiteSpace = "pre-line";
      this.detail.replaceChildren(this.detailCloseButton(), kicker, title, status, direction);
      const commentBlock = doc.createElement("div");
      commentBlock.className = "zlg-detail-block";
      const commentHeading = doc.createElement("h3");
      commentHeading.textContent = ZLGT("关系说明");
      const comment = doc.createElement("p");
      comment.textContent = edge.comment || (edge.type === "similar"
        ? ZLGT`OpenAlex 推荐${edge.providerPosition ? ZLGT`（第 ${edge.providerPosition} 位）` : ""}。非直接引用，距离不表示相似度。`
        : ZLGT("箭头：引用文献 → 被引用文献。来自数据源记录，未逐条核对全文。"));
      commentBlock.append(commentHeading, comment);
      this.detail.appendChild(commentBlock);
      const evidence = edge.evidence?.[0];
      if (evidence) {
        const evidenceBlock = doc.createElement("div");
        evidenceBlock.className = "zlg-detail-block";
        const evidenceHeading = doc.createElement("h3");
        evidenceHeading.textContent = ZLGT("PDF 证据");
        const text = doc.createElement("p");
        text.textContent = `${evidence.locator || ZLGT("位置未说明")}${evidence.page ? ` · p.${evidence.page}` : ""}${evidence.attachmentKey ? ZLGT` · 附件 ${evidence.attachmentKey}` : ""}`;
        evidenceBlock.append(evidenceHeading, text);
        this.detail.appendChild(evidenceBlock);
      }
    }
  }

  return {
    Renderer, LABELS, COLORS, EDGE_COLORS, HOVER_LENS_DELAY_MS, LAYOUT_ALGORITHM_VERSION, ZOOM_WHEEL_SENSITIVITY,
    NODE_SIZE_MODES, CITATION_RADIUS_MIN, CITATION_RADIUS_MAX,
    keyOf, edgeKeys, edgeKey, edgeLineGeometry, hashUnit, normalizedWheelDelta, zoomFactorForWheel, dragThresholdExceeded, selectionRevealDelta, estimatedLabelWidth,
    wrapNodeTitle, nodeAuthorYear, captionPlacement,
    citationCountOf, citationScaleStats, nodeRadius, nodeSizeModeLabel, nodeActionSpecs, actionMenuPosition, collectionReadingAction,
    orderedHitKeys, nearestDirectionalKey, forEachNearbyPair, diffusePoint, adaptiveLensParameters, timelineLaneLayout,
    resolveCollisionPair, buildPhysicsTopology, orderSeedsByAffinity, seedLayoutGeometry, packedComponentCenters, topologyInitialPositions, enforceSeedProximity,
    seedProximityDiagnostics, semanticLayoutSatisfied, semanticWarningText, semanticWarningForRender, repairSeedProximityViolations,
    clonePositionMap, semanticHeatFloor,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = ZLGGraphRenderer;
