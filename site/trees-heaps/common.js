// Shared helpers for the trees-heaps deck: logger, an animated SVG tree view and tree layouts.
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }

  // Animated tree drawing. update(items) where item = {id, x, y (grid units), label, cls, parent (id), note, edgeCls}.
  // Nodes keep their identity by id, so moves (rotations, swaps) slide smoothly.
  function treeView(host, opt = {}) {
    const o = { dx: 40, dy: 54, r: 17, pad: 22, maxH: 0, font: 14, ...opt };
    const svg = svgEl('svg', { class: 'tv', role: 'img' });
    const gE = svgEl('g', { class: 'tv-edges' });
    const gN = svgEl('g', { class: 'tv-nodes' });
    svg.append(gE, gN);
    host.append(svg);
    const nodes = new Map();
    let edges = [], raf = 0, onClick = null;
    let vb = null;

    function place(n, x, y) {
      n.x = x; n.y = y;
      n.g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
    }
    function drawEdges() {
      for (const [l, a, b] of edges) {
        l.setAttribute('x1', a.x); l.setAttribute('y1', a.y);
        l.setAttribute('x2', b.x); l.setAttribute('y2', b.y);
      }
    }
    function setVB(v) {
      svg.setAttribute('viewBox', `0 0 ${v.w.toFixed(1)} ${v.h.toFixed(1)}`);
      let w = v.w;
      if (o.maxH && v.h > o.maxH) w = v.w * o.maxH / v.h;
      svg.style.width = w.toFixed(1) + 'px';
    }

    function update(items, { instant = false } = {}) {
      const ids = new Set(items.map(i => i.id));
      for (const [id, n] of nodes) if (!ids.has(id)) { n.g.remove(); nodes.delete(id); }
      let maxX = 0, maxY = 0, hasNote = false;
      for (const it of items) {
        const tx = o.pad + it.x * o.dx, ty = o.pad + it.y * o.dy;
        maxX = Math.max(maxX, tx); maxY = Math.max(maxY, ty);
        if (it.note) hasNote = true;
        let n = nodes.get(it.id);
        if (!n) {
          const g = svgEl('g');
          const c = svgEl('circle', { r: o.r });
          const t = svgEl('text', { 'text-anchor': 'middle', dy: '0.35em', 'font-size': o.font });
          const nt = svgEl('text', { class: 'tv-note', 'text-anchor': 'middle', y: o.r + 12 });
          g.append(c, t, nt);
          g.addEventListener('click', () => onClick && onClick(n.id));
          n = { id: it.id, g, t, nt };
          gN.append(g);
          nodes.set(it.id, n);
          place(n, tx, ty);
          n.fresh = true;
        }
        n.tx = tx; n.ty = ty;
        n.g.setAttribute('class', 'tv-node ' + (it.cls || '') + (onClick ? ' click' : ''));
        n.t.textContent = it.label;
        n.t.setAttribute('font-size', String(it.label).length > 3 ? o.font - 3 : o.font);
        n.nt.textContent = it.note || '';
        n.item = it;
      }
      gE.replaceChildren();
      edges = items.filter(i => i.parent != null && nodes.has(i.parent)).map(i => {
        const l = svgEl('line', { class: 'tv-edge ' + (i.edgeCls || '') });
        gE.append(l);
        return [l, nodes.get(i.parent), nodes.get(i.id)];
      });
      const target = { w: Math.max(maxX + o.pad, o.pad * 2), h: maxY + o.pad + (hasNote ? 14 : 0) };
      if (!items.length) target.h = o.pad * 2;
      cancelAnimationFrame(raf);
      const list = [...nodes.values()];
      const from = list.map(n => [n.x, n.y]);
      const vb0 = vb || target;
      if (instant || !vb) {
        list.forEach(n => place(n, n.tx, n.ty));
        vb = target; setVB(vb); drawEdges();
        return;
      }
      const t0 = performance.now(), dur = 380;
      const step = t => {
        let k = Math.min(1, (t - t0) / dur);
        k = 1 - Math.pow(1 - k, 3);
        list.forEach((n, i) => place(n, from[i][0] + (n.tx - from[i][0]) * k, from[i][1] + (n.ty - from[i][1]) * k));
        vb = { w: vb0.w + (target.w - vb0.w) * k, h: vb0.h + (target.h - vb0.h) * k };
        setVB(vb);
        drawEdges();
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
    return { svg, update, set onClick(f) { onClick = f; } };
  }

  // Binary tree layout: x = in-order index, y = depth.
  function layoutBinary(root, map) {
    const out = [];
    let i = 0;
    const walk = (n, d, parent) => {
      if (!n) return;
      walk(n.left, d + 1, n);
      out.push({ node: n, parentNode: parent, x: i++, y: d });
      walk(n.right, d + 1, n);
    };
    walk(root, 0, null);
    return out.map(e => ({ ...map(e.node), parent: e.parentNode ? map(e.parentNode).id : null, x: e.x, y: e.y, node: e.node }));
  }

  // General tree layout: leaves get consecutive columns, a parent sits over the middle of its children.
  function layoutTree(root, kids, map) {
    const out = [];
    let col = 0;
    const walk = (n, d, parent) => {
      const ch = kids(n);
      const e = { ...map(n), parent: parent ? map(parent).id : null, y: d, node: n };
      out.push(e);
      if (!ch.length) { e.x = col++; return e.x; }
      const xs = ch.map(c => walk(c, d + 1, n));
      e.x = (xs[0] + xs[xs.length - 1]) / 2;
      return e.x;
    };
    walk(root, 0, null);
    return out;
  }

  const height = n => (n ? 1 + Math.max(height(n.left), height(n.right)) : 0);
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

  // Timer for step-through demos; paused by stop().
  function player(stepFn, ms = 700) {
    let id = 0;
    return {
      get on() { return !!id; },
      play() { if (!id) id = setInterval(() => { if (stepFn() === false) this.pause(); }, ms); },
      pause() { clearInterval(id); id = 0; },
    };
  }

  window.TH = { svgEl, logger, treeView, layoutBinary, layoutTree, height, rnd, player };
})();
