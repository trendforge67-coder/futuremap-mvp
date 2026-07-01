// Future Map -- interactive node/edge graph view (Phase 2 + Phase 3 polish).
//
// Self-contained module: fetches /api/graph once, lays the whole graph out
// with a small force simulation, then renders it on a <canvas> with
// pan/zoom/expand/collapse, animated transitions, path highlighting, and a
// rich detail panel. Exposed as window.FutureMapGraph.init() and called
// lazily from app.js the first time the "Future Map" tab is opened.
//
// No external libraries -- from-scratch force layout + 2D canvas renderer,
// consistent with the project's zero-dependency philosophy.

(function () {
  const COLORS = {
    start: "#1E1B4B",
    subject: "#6366F1",
    course: "#F2A93B",
    university: "#3B6EA5",
    industry: "#5B5F76",
    career: "#C2185B",
    specialisation: "#7C3AED",
    "qualification-stage": "#2F8F77",
  };
  const QUAL_SUBTYPE_COLORS = {
    qualification: "#2F8F77",
    apprenticeship: "#C2790F",
    certification: "#B8860B",
    "life-stage": "#8E7CC3",
    "career-stage": "#9C2B26",
  };
  const ICONS = {
    start: "\u{1F680}",
    subject: "\u{1F4DA}",
    course: "\u{1F393}",
    university: "\u{1F3DB}",
    industry: "\u{1F4C8}",
    career: "\u{1F4BC}",
    specialisation: "⭐",
  };
  const QUAL_SUBTYPE_ICONS = {
    qualification: "\u{1F4DC}",
    apprenticeship: "\u{1F6E0}",
    certification: "\u{1F3C5}",
    "life-stage": "\u{1F9ED}",
    "career-stage": "\u{1FA9C}",
  };

  // Relations that represent the "natural next step" forward through a
  // student's journey -- rendered bold/opaque. Everything else (alternatives,
  // lateral links, industry groupings) is rendered lighter, so expanding a
  // node visually emphasises where it leads rather than treating every
  // connection as equally important.
  const PRIMARY_RELATIONS = new Set([
    "choose", "studied-at", "progresses-to", "can-study",
    "leads-to", "specialises-into", "entered-via", "required-for",
  ]);

  function colorFor(node) {
    if (node.type === "qualification-stage") return QUAL_SUBTYPE_COLORS[node.nodeType] || COLORS["qualification-stage"];
    return COLORS[node.type] || "#999999";
  }

  function iconFor(node) {
    if (node.type === "qualification-stage") return QUAL_SUBTYPE_ICONS[node.nodeType] || "\u{1F4CC}";
    return ICONS[node.type] || "●";
  }

  function baseRadiusFor(node) {
    if (node.type === "start") return 20;
    if (node.type === "career" || node.type === "course") return 13;
    if (node.type === "university") return 12;
    if (node.type === "specialisation") return 8;
    return 11;
  }

  function typeLabel(node) {
    if (node.type === "qualification-stage") return (node.nodeType || "qualification").replace(/-/g, " ");
    return node.type.replace(/-/g, " ");
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  function roundedRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function FutureMapGraph(canvas, panelEl, legendEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.panelEl = panelEl;
    this.legendEl = legendEl;
    this.nodes = [];
    this.edges = [];
    this.byId = new Map();
    this.adj = new Map(); // id -> Set of neighbour ids (undirected, for visibility)
    this.fwdAdj = new Map(); // id -> Set of neighbour ids (directed from -> to, for pathfinding)
    this.expanded = new Set();
    this.rootId = null;
    this.scale = 0.9;
    this.offsetX = 0;
    this.offsetY = 0;
    this.dragging = false;
    this.dragMoved = false;
    this.lastX = 0;
    this.lastY = 0;
    this.hoverId = null;
    this.selectedId = null;
    // this.highlights: array of { nodeIds: Set, edgeKeys: Set, color, label }.
    // Supports highlighting one path (detail panel button) or several at once
    // with distinct colours (AI Future Planner "compare these futures" view).
    this.highlights = [];
    this.dashFlow = 0;
    this._raf = null;

    this._bindEvents();
    this._bindPanel();
  }

  FutureMapGraph.prototype._bindPanel = function () {
    this.panelEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "highlight") this.highlightPath(btn.dataset.nodeId);
      if (action === "clear-highlight") this.clearHighlight();
      if (action === "focus-node") this._focusOn(btn.dataset.nodeId, true);
    });
  };

  FutureMapGraph.prototype._bindEvents = function () {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.dragMoved = false;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener("pointermove", (e) => {
      if (!this.dragging) {
        this._updateHover(e);
        return;
      }
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.dragMoved = true;
      this.offsetX += dx;
      this.offsetY += dy;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener("pointerup", (e) => {
      if (this.dragging && !this.dragMoved) this._handleClick(e);
      this.dragging = false;
    });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const worldXBefore = (mx - this.offsetX) / this.scale;
      const worldYBefore = (my - this.offsetY) / this.scale;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this.scale = Math.max(0.15, Math.min(3.5, this.scale * factor));
      this.offsetX = mx - worldXBefore * this.scale;
      this.offsetY = my - worldYBefore * this.scale;
    }, { passive: false });

    window.addEventListener("resize", () => this._resizeCanvas());
  };

  FutureMapGraph.prototype._resizeCanvas = function () {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.max(320, rect.width);
    this.canvas.height = Math.max(360, window.innerHeight * 0.62);
  };

  FutureMapGraph.prototype._toWorld = function (clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return { x: (x - this.offsetX) / this.scale, y: (y - this.offsetY) / this.scale };
  };

  FutureMapGraph.prototype._nodeAt = function (worldX, worldY) {
    let best = null;
    let bestDist = Infinity;
    this._visibleNodes().forEach((n) => {
      const d = Math.hypot(n.x - worldX, n.y - worldY);
      const r = baseRadiusFor(n) + 8;
      if (d <= r && d < bestDist) {
        best = n;
        bestDist = d;
      }
    });
    return best;
  };

  FutureMapGraph.prototype._updateHover = function (e) {
    const w = this._toWorld(e.clientX, e.clientY);
    const n = this._nodeAt(w.x, w.y);
    const newHover = n ? n.id : null;
    if (newHover !== this.hoverId) {
      this.hoverId = newHover;
      this.canvas.style.cursor = newHover ? "pointer" : "grab";
    }
  };

  FutureMapGraph.prototype._handleClick = function (e) {
    const w = this._toWorld(e.clientX, e.clientY);
    const n = this._nodeAt(w.x, w.y);
    if (!n) return;
    if (this.expanded.has(n.id)) this.expanded.delete(n.id);
    else this.expanded.add(n.id);
    this.selectedId = n.id;
    this._showDetail(n);
  };

  FutureMapGraph.prototype._focusOn = function (nodeId, select) {
    const n = this.byId.get(nodeId);
    if (!n) return;
    this.offsetX = this.canvas.width / 2 - n.x * this.scale;
    this.offsetY = this.canvas.height / 2 - n.y * this.scale;
    if (select) {
      this.selectedId = nodeId;
      this._showDetail(n);
    }
  };

  // ---- Rich detail panel -------------------------------------------------
  FutureMapGraph.prototype._showDetail = function (n) {
    const icon = iconFor(n);
    const color = colorFor(n);

    const fields = [];
    if (n.description) fields.push(`<p>${n.description}</p>`);

    const facts = [];
    if (n.outlook) facts.push(["Outlook", n.outlook]);
    if (n.earningsRange) facts.push(["Indicative earnings", n.earningsRange]);
    if (n.avgSalaryGraduate) facts.push(["Avg graduate salary", `&pound;${n.avgSalaryGraduate.toLocaleString()}`]);
    if (n.demand) facts.push(["Demand", n.demand]);
    if (n.difficulty) facts.push(["Difficulty", n.difficulty]);
    if (n.durationYears) facts.push(["Duration", `${n.durationYears} years`]);
    if (n.typicalAge) facts.push(["Typical age", n.typicalAge]);
    if (n.overallRanking) facts.push(["Ranking", `#${n.overallRanking}`]);
    const factsHtml = facts.length
      ? `<div class="panel-facts">${facts.map(([k, v]) => `<div class="panel-fact"><span class="panel-fact-key">${k}</span><span class="panel-fact-val">${v}</span></div>`).join("")}</div>`
      : "";

    const skillTags = (n.relatedSkills || n.skillsGained || []).map((s) => `<span class="tag">${s}</span>`).join("");
    const skillsHtml = skillTags ? `<p class="panel-section-label">Skills</p><p>${skillTags}</p>` : "";

    const modulesHtml = n.typicalModules && n.typicalModules.length
      ? `<p class="panel-section-label">Typical modules</p><p>${n.typicalModules.map((m) => `<span class="tag">${m}</span>`).join("")}</p>`
      : "";

    const neighbourEntries = [...(this.adj.get(n.id) || [])]
      .map((id) => this.byId.get(id))
      .filter(Boolean);
    const related = neighbourEntries
      .slice(0, 14)
      .map((nb) => `<span class="tag panel-related-tag" data-action="focus-node" data-node-id="${nb.id}" style="border-color:${colorFor(nb)}33">${iconFor(nb)} ${nb.label}</span>`)
      .join("");

    const isLeaf = n.type === "career" || n.type === "specialisation" || n.type === "university";
    const onThisHighlight = this.highlights.length === 1 && this.highlights[0].nodeIds.has(n.id) && this.selectedId === n.id;
    const highlightBtn = onThisHighlight
      ? `<button class="panel-action-btn secondary" data-action="clear-highlight">Clear highlighted path</button>`
      : `<button class="panel-action-btn" data-action="highlight" data-node-id="${n.id}">Highlight path from Start</button>`;

    this.panelEl.innerHTML = `
      <div class="graph-panel-header" style="border-left-color:${color}">
        <div class="panel-icon" style="background:${color}1a; color:${color}">${icon}</div>
        <div>
          <span class="muted panel-type">${typeLabel(n)}</span>
          <h3>${n.label}</h3>
        </div>
      </div>
      ${fields.join("") || (isLeaf ? "" : '<p class="muted">No further detail recorded for this node yet.</p>')}
      ${factsHtml}
      ${skillsHtml}
      ${modulesHtml}
      <p class="panel-section-label" style="margin-top:14px;">Related</p>
      <p class="panel-related">${related || '<span class="muted">Nothing yet -- try expanding a neighbouring node.</span>'}</p>
      <div class="panel-actions">
        ${highlightBtn}
      </div>
      <p class="muted panel-hint">Click this node again on the map to ${this.expanded.has(n.id) ? "collapse" : "expand"} its connections.</p>
    `;
  };

  // ---- Visibility / expansion --------------------------------------------
  FutureMapGraph.prototype._visibleNodeIds = function () {
    const visible = new Set([this.rootId, ...this.expanded]);
    this.expanded.forEach((id) => (this.adj.get(id) || new Set()).forEach((nb) => visible.add(nb)));
    (this.adj.get(this.rootId) || new Set()).forEach((nb) => visible.add(nb));
    return visible;
  };

  FutureMapGraph.prototype._visibleNodes = function () {
    const visible = this._visibleNodeIds();
    return this.nodes.filter((n) => visible.has(n.id));
  };

  FutureMapGraph.prototype._visibleEdges = function () {
    const visibleIds = this._visibleNodeIds();
    return this.edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to));
  };

  // ---- Path highlighting ---------------------------------------------------
  FutureMapGraph.prototype._shortestPath = function (fromId, toId) {
    if (fromId === toId) return [fromId];
    const visited = new Set([fromId]);
    const parent = new Map();
    let frontier = [fromId];
    while (frontier.length) {
      const next = [];
      for (const cur of frontier) {
        const neighbours = this.adj.get(cur) || new Set();
        for (const nb of neighbours) {
          if (visited.has(nb)) continue;
          visited.add(nb);
          parent.set(nb, cur);
          if (nb === toId) {
            const path = [toId];
            let p = cur;
            while (p !== undefined) {
              path.unshift(p);
              p = parent.get(p);
            }
            return path;
          }
          next.push(nb);
        }
      }
      frontier = next;
    }
    return null;
  };

  FutureMapGraph.prototype.highlightPath = function (nodeId) {
    const path = this._shortestPath(this.rootId, nodeId);
    if (!path) return;
    this.setHighlights([{ nodeIds: path, color: "#F2A93B" }], { fit: false });
    const n = this.byId.get(nodeId);
    if (n) this._showDetail(n);
  };

  // ---- Generic multi-path highlighting -----------------------------------
  // `paths` is an array of { nodeIds: string[], color: string, label?: string }.
  // Used both by the single "Highlight path from Start" panel button (one path)
  // and the AI Future Planner ("show me all three futures at once", several
  // paths in different colours). Every node across all paths is auto-expanded
  // so the whole route is visible without the user having to click through it.
  FutureMapGraph.prototype.setHighlights = function (paths, opts = {}) {
    this.highlights = paths.map((p) => {
      const nodeIds = new Set(p.nodeIds);
      const edgeKeys = new Set();
      const arr = p.nodeIds;
      for (let i = 0; i < arr.length - 1; i++) {
        edgeKeys.add(`${arr[i]}|${arr[i + 1]}`);
        edgeKeys.add(`${arr[i + 1]}|${arr[i]}`);
      }
      arr.forEach((id) => this.expanded.add(id));
      return { nodeIds, edgeKeys, color: p.color || "#F2A93B", label: p.label };
    });
    if (opts.fit !== false) {
      const allIds = new Set();
      paths.forEach((p) => p.nodeIds.forEach((id) => allIds.add(id)));
      this._fitToNodes([...allIds]);
    }
  };

  FutureMapGraph.prototype.clearHighlights = function () {
    this.highlights = [];
    if (this.selectedId) {
      const n = this.byId.get(this.selectedId);
      if (n) this._showDetail(n);
    }
  };
  // backwards-compatible alias
  FutureMapGraph.prototype.clearHighlight = FutureMapGraph.prototype.clearHighlights;

  FutureMapGraph.prototype._fitToNodes = function (nodeIds) {
    const pts = nodeIds.map((id) => this.byId.get(id)).filter(Boolean);
    if (!pts.length) return;
    const minX = Math.min(...pts.map((n) => n.x));
    const maxX = Math.max(...pts.map((n) => n.x));
    const minY = Math.min(...pts.map((n) => n.y));
    const maxY = Math.max(...pts.map((n) => n.y));
    const w = Math.max(60, maxX - minX);
    const h = Math.max(60, maxY - minY);
    const pad = 1.35;
    const scale = Math.max(0.18, Math.min(2.2, Math.min(this.canvas.width / (w * pad), this.canvas.height / (h * pad))));
    this.scale = scale;
    this.offsetX = this.canvas.width / 2 - ((minX + maxX) / 2) * scale;
    this.offsetY = this.canvas.height / 2 - ((minY + maxY) / 2) * scale;
  };

  // ---- force layout, run once on load over the FULL graph so expand/collapse
  // never needs to re-layout -- it only toggles target visibility/alpha of
  // precomputed positions.
  FutureMapGraph.prototype._layout = function () {
    const n = this.nodes.length;
    const area = Math.max(900, n * 110);
    const k = Math.sqrt(area / Math.max(1, n));

    this.nodes.forEach((node, i) => {
      const angle = (i / n) * Math.PI * 2;
      const r = 80 + (i % 7) * 40;
      node.x = Math.cos(angle) * r;
      node.y = Math.sin(angle) * r;
      node.vx = 0;
      node.vy = 0;
    });

    const iterations = 220;
    for (let iter = 0; iter < iterations; iter++) {
      const temp = k * 2 * (1 - iter / iterations);

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = this.nodes[i];
          const b = this.nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dist = Math.hypot(dx, dy) || 0.01;
          const force = (k * k) / dist;
          dx = (dx / dist) * force;
          dy = (dy / dist) * force;
          a.vx += dx;
          a.vy += dy;
          b.vx -= dx;
          b.vy -= dy;
        }
      }

      this.edges.forEach((e) => {
        const a = this.byId.get(e.from);
        const b = this.byId.get(e.to);
        if (!a || !b) return;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const force = (dist * dist) / k;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.vx -= dx;
        a.vy -= dy;
        b.vx += dx;
        b.vy += dy;
      });

      this.nodes.forEach((node) => {
        node.vx += -node.x * 0.01;
        node.vy += -node.y * 0.01;
        const disp = Math.hypot(node.vx, node.vy) || 0.01;
        const capped = Math.min(disp, temp || 1);
        node.x += (node.vx / disp) * capped;
        node.y += (node.vy / disp) * capped;
        node.vx = 0;
        node.vy = 0;
      });
    }

    // Precompute a small deterministic curve offset per edge (sign + magnitude)
    // so edges bend gently instead of looking like a technical wiring diagram,
    // without the curvature jittering frame to frame.
    this.edgeCurve = new Map();
    this.edges.forEach((e) => {
      const key = `${e.from}|${e.to}`;
      const h = hashStr(key);
      const sign = h % 2 === 0 ? 1 : -1;
      const mag = 8 + (Math.abs(h) % 14);
      this.edgeCurve.set(key, sign * mag);
    });
  };

  // ---- Animation loop: smoothly lerps each node's alpha/scale toward its
  // target (1 if currently visible, 0 if hidden) every frame, so expand /
  // collapse / hover feel like soft transitions instead of instant pops.
  FutureMapGraph.prototype._tick = function () {
    const visibleIds = this._visibleNodeIds();
    let stillAnimating = false;

    this.nodes.forEach((node) => {
      if (node.alpha === undefined) node.alpha = visibleIds.has(node.id) ? 1 : 0;
      if (node.scale === undefined) node.scale = 1;
      const targetAlpha = visibleIds.has(node.id) ? 1 : 0;
      const hovered = node.id === this.hoverId;
      const targetScale = hovered ? 1.18 : 1;

      if (Math.abs(node.alpha - targetAlpha) > 0.003) {
        node.alpha = lerp(node.alpha, targetAlpha, 0.16);
        stillAnimating = true;
      } else {
        node.alpha = targetAlpha;
      }
      if (Math.abs(node.scale - targetScale) > 0.003) {
        node.scale = lerp(node.scale, targetScale, 0.22);
        stillAnimating = true;
      } else {
        node.scale = targetScale;
      }
    });

    if (this.highlights.length) {
      this.dashFlow = (this.dashFlow + 0.6) % 24;
      stillAnimating = true;
    }

    this.render();
    this._raf = requestAnimationFrame(() => this._tick());
  };

  FutureMapGraph.prototype.render = function () {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    const renderEdges = this.edges.filter((e) => {
      const a = this.byId.get(e.from);
      const b = this.byId.get(e.to);
      return a && b && (a.alpha > 0.02 || b.alpha > 0.02);
    });

    const anyHighlight = this.highlights.length > 0;
    renderEdges.forEach((e) => {
      const a = this.byId.get(e.from);
      const b = this.byId.get(e.to);
      const edgeAlpha = Math.min(a.alpha, b.alpha);
      if (edgeAlpha <= 0.02) return;
      const key = `${e.from}|${e.to}`;
      const isPrimary = PRIMARY_RELATIONS.has(e.relation);
      const matchingHighlight = anyHighlight ? this.highlights.find((h) => h.edgeKeys.has(key)) : null;
      const dimmedByHighlight = anyHighlight && !matchingHighlight;

      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const curve = this.edgeCurve.get(key) || 0;
      const cx = mx - (dy / len) * curve;
      const cy = my + (dx / len) * curve;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(cx, cy, b.x, b.y);

      if (matchingHighlight) {
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -this.dashFlow;
        ctx.strokeStyle = hexToRgba(matchingHighlight.color, 0.95 * edgeAlpha);
        ctx.lineWidth = 2.6 / this.scale;
      } else {
        ctx.setLineDash([]);
        const baseOpacity = isPrimary ? 0.32 : 0.14;
        const opacity = (dimmedByHighlight ? baseOpacity * 0.25 : baseOpacity) * edgeAlpha;
        ctx.strokeStyle = `rgba(91,95,118,${opacity})`;
        ctx.lineWidth = (isPrimary ? 1.4 : 1) / this.scale;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });

    const renderNodes = this.nodes.filter((n) => n.alpha > 0.02);
    renderNodes.forEach((node) => {
      const baseR = baseRadiusFor(node);
      const r = baseR * (node.scale || 1);
      const matchingHighlight = anyHighlight ? this.highlights.find((h) => h.nodeIds.has(node.id)) : null;
      const isHighlighted = !!matchingHighlight;
      const dimmedByHighlight = anyHighlight && !isHighlighted;
      const alpha = node.alpha * (dimmedByHighlight ? 0.22 : 1);
      const color = colorFor(node);

      ctx.save();
      ctx.globalAlpha = alpha;

      // soft shadow for a lifted, "premium" feel
      ctx.shadowColor = "rgba(30,27,75,0.25)";
      ctx.shadowBlur = (node.id === this.hoverId || isHighlighted ? 14 : 7) / this.scale;
      ctx.shadowOffsetY = 2 / this.scale;

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      if (isHighlighted || node.id === this.rootId || node.id === this.selectedId) {
        ctx.lineWidth = 2.8 / this.scale;
        ctx.strokeStyle = isHighlighted ? matchingHighlight.color : "#FFFFFF";
        ctx.stroke();
      }

      // icon glyph
      ctx.font = `${r * 1.05}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(iconFor(node), node.x, node.y + 0.5);

      const showLabel = this.scale > 0.4 || node.id === this.hoverId || this.expanded.has(node.id) || isHighlighted;
      if (showLabel) {
        ctx.font = `600 ${12 / this.scale}px -apple-system, BlinkMacSystemFont, "Segoe UI", Calibri, sans-serif`;
        const textW = ctx.measureText(node.label).width;
        const padX = 6 / this.scale;
        const labelY = node.y + r + 14 / this.scale;
        ctx.fillStyle = "rgba(255,255,255,0.86)";
        roundedRect(ctx, node.x - textW / 2 - padX, labelY - 9 / this.scale, textW + padX * 2, 16 / this.scale, 6 / this.scale);
        ctx.fill();
        ctx.fillStyle = "#1E1B2E";
        ctx.textBaseline = "middle";
        ctx.fillText(node.label, node.x, labelY);
      }

      // Faint indicator dot for nodes with un-expanded neighbours hidden off-screen.
      const visibleIds = this._visibleNodeIds();
      const hasHiddenChildren = [...(this.adj.get(node.id) || [])].some((nb) => !visibleIds.has(nb));
      if (hasHiddenChildren && this.scale > 0.3 && !dimmedByHighlight) {
        ctx.beginPath();
        ctx.arc(node.x + r * 0.72, node.y - r * 0.72, 3.4 / this.scale, 0, Math.PI * 2);
        ctx.fillStyle = "#F2A93B";
        ctx.fill();
        ctx.lineWidth = 1.2 / this.scale;
        ctx.strokeStyle = "white";
        ctx.stroke();
      }

      ctx.restore();
    });

    ctx.restore();
  };

  FutureMapGraph.prototype.resetView = function () {
    this.offsetX = this.canvas.width / 2;
    this.offsetY = this.canvas.height / 2;
    this.scale = 0.9;
  };

  FutureMapGraph.prototype.load = async function () {
    const res = await fetch("/api/graph");
    const data = await res.json();
    this.nodes = data.nodes;
    this.edges = data.edges;
    this.rootId = data.rootId;
    this.byId = new Map(this.nodes.map((n) => [n.id, n]));

    this.adj = new Map();
    this.fwdAdj = new Map();
    this.nodes.forEach((n) => {
      this.adj.set(n.id, new Set());
      this.fwdAdj.set(n.id, new Set());
    });
    this.edges.forEach((e) => {
      if (this.adj.has(e.from)) this.adj.get(e.from).add(e.to);
      if (this.adj.has(e.to)) this.adj.get(e.to).add(e.from);
      if (this.fwdAdj.has(e.from)) this.fwdAdj.get(e.from).add(e.to);
    });

    this._layout();
    this._resizeCanvas();
    this.resetView();

    const rootNode = this.byId.get(this.rootId);
    if (rootNode) {
      this.selectedId = this.rootId;
      this._showDetail(rootNode);
    }

    this._renderLegend();

    if (this._raf) cancelAnimationFrame(this._raf);
    this._tick();
  };

  FutureMapGraph.prototype._renderLegend = function () {
    const items = [
      ["Start", COLORS.start, ICONS.start],
      ["Subject", COLORS.subject, ICONS.subject],
      ["Qualification", QUAL_SUBTYPE_COLORS.qualification, QUAL_SUBTYPE_ICONS.qualification],
      ["Apprenticeship", QUAL_SUBTYPE_COLORS.apprenticeship, QUAL_SUBTYPE_ICONS.apprenticeship],
      ["Certification", QUAL_SUBTYPE_COLORS.certification, QUAL_SUBTYPE_ICONS.certification],
      ["Life stage", QUAL_SUBTYPE_COLORS["life-stage"], QUAL_SUBTYPE_ICONS["life-stage"]],
      ["Course", COLORS.course, ICONS.course],
      ["University", COLORS.university, ICONS.university],
      ["Industry", COLORS.industry, ICONS.industry],
      ["Career", COLORS.career, ICONS.career],
      ["Career stage", QUAL_SUBTYPE_COLORS["career-stage"], QUAL_SUBTYPE_ICONS["career-stage"]],
      ["Specialisation", COLORS.specialisation, ICONS.specialisation],
    ];
    this.legendEl.innerHTML = items
      .map(([label, color, icon]) => `<span class="legend-item"><span class="legend-dot" style="background:${color}1a;color:${color}">${icon}</span>${label}</span>`)
      .join("");
  };

  window.FutureMapGraph = {
    instance: null,
    init(canvasId, panelId, legendId) {
      if (this.instance) {
        this.instance._resizeCanvas();
        return Promise.resolve();
      }
      const canvas = document.getElementById(canvasId);
      const panel = document.getElementById(panelId);
      const legend = document.getElementById(legendId);
      this.instance = new FutureMapGraph(canvas, panel, legend);
      return this.instance.load();
    },
    resetView() {
      if (this.instance) this.instance.resetView();
    },
    clearHighlight() {
      if (this.instance) this.instance.clearHighlights();
    },
    clearHighlights() {
      if (this.instance) this.instance.clearHighlights();
    },
    // paths: [{ nodeIds: string[], color: string, label?: string }]
    // Used by the AI Future Planner to draw one or more generated futures.
    showPaths(paths) {
      if (this.instance) this.instance.setHighlights(paths);
    },
    // Returns the node id for a raw id within a given graph type, e.g.
    // nodeId("career", "ai-engineer") -> "career:ai-engineer". Lets the
    // planner build paths without duplicating the server's nid() logic.
    nodeId(type, rawId) {
      return `${type}:${rawId}`;
    },
    isReady() {
      return !!(this.instance && this.instance.nodes.length);
    },
  };
})();
