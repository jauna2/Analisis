/* =====================================================================
   Vista gráfica: proyección 3D / planta / elevación, grids, dibujo,
   selección y superposición de resultados.
   ===================================================================== */
(function (root) {
  'use strict';
  const PALETTE = ['#60a5fa', '#f59e0b', '#34d399', '#f472b6', '#a78bfa', '#fb7185', '#22d3ee', '#facc15', '#4ade80', '#c084fc'];
  const TOL = 1e-6;

  const View = {
    cv: null, ctx: null, W: 0, H: 0, dpr: 1,
    mode: '3D', level: { z: 0, y: 0, x: 0 },
    cam: { yaw: -0.65, pitch: 0.42, scale: 30, ox: 0, oy: 0, ctr: { x: 0, y: 0, z: 0 } },
    tool: 'select', drawStart: null, hover: null, mouse: null,
    sel: { nodes: new Set(), elems: new Set() },
    drag: null, show: { nodeId: true, elId: true, axes: false, loads: true, grid: true, off: true, extr: false },
    visPat: null,
    result: { type: 'none', pat: 0, comp: 'M3', mode: 0, scale: 1, anim: true, dir: 'X' },
    animT: 0, animOn: false,
    hooks: {},

    init(cv) {
      this.cv = cv; this.ctx = cv.getContext('2d');
      const ro = new ResizeObserver(() => this.resize()); ro.observe(cv.parentElement);
      cv.addEventListener('mousedown', e => this.onDown(e));
      window.addEventListener('mousemove', e => this.onMove(e));
      window.addEventListener('mouseup', e => this.onUp(e));
      cv.addEventListener('wheel', e => this.onWheel(e), { passive: false });
      cv.addEventListener('contextmenu', e => e.preventDefault());
      cv.addEventListener('dblclick', () => { if (this.tool === 'draw') this.drawStart = null; this.render(); });
      this.resize();
    },
    resize() {
      const r = this.cv.parentElement.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      this.W = r.width; this.H = r.height;
      this.cv.width = Math.max(1, r.width * this.dpr); this.cv.height = Math.max(1, r.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.render();
    },
    get model() { return App.model; },
    is2D() { return this.model.mode === '2D'; },

    // ---------------- proyección
    P(X, Y, Z) {
      const c = this.cam, t = c.ctr; let x, up;
      const dx = X - t.x, dy = Y - t.y, dz = Z - t.z;
      switch (this.mode) {
        case 'XY': x = dx; up = dy; break;
        case 'XZ': x = dx; up = dz; break;
        case 'YZ': x = dy; up = dz; break;
        default: {
          const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
          const x1 = dx * cy - dy * sy, y1 = dx * sy + dy * cy;
          x = x1; up = dz * cp + y1 * sp;
        }
      }
      return [this.W / 2 + c.ox + x * c.scale, this.H / 2 + c.oy - up * c.scale];
    },
    Pn(nd) { return this.P(nd.x, nd.y || 0, nd.z); },
    screenToPlane(sx, sy) {
      const c = this.cam, t = c.ctr;
      const a = (sx - this.W / 2 - c.ox) / c.scale, b = -(sy - this.H / 2 - c.oy) / c.scale;
      switch (this.mode) {
        case 'XY': return { x: t.x + a, y: t.y + b, z: this.level.z };
        case 'XZ': return { x: t.x + a, y: this.level.y, z: t.z + b };
        case 'YZ': return { x: this.level.x, y: t.y + a, z: t.z + b };
      }
      return null;
    },
    planeKey() { return this.mode === 'XY' ? 'z' : this.mode === 'XZ' ? 'y' : this.mode === 'YZ' ? 'x' : null; },
    inPlane(p) { const k = this.planeKey(); if (!k) return true; return Math.abs((p[k] || 0) - this.level[k]) < 1e-4; },
    elemInPlane(e) { const a = App.nodeById(e.i), b = App.nodeById(e.j); return a && b && this.inPlane(a) && this.inPlane(b); },

    // ---------------- grids
    gridData() {
      const g = this.model.grids;
      const xs = App.gridArr('x'), ys = this.is2D() ? [0] : App.gridArr('y'), zs = App.gridArr('z');
      const rad = (!this.is2D() && g.radial && g.radial.on) ? { cx: +g.radial.cx || 0, cy: +g.radial.cy || 0, r: App.parseList(g.radial.r), th: App.parseList(g.radial.th) } : null;
      return { xs, ys, zs, rad };
    },
    gridPoints() {
      const { xs, ys, zs, rad } = this.gridData(), pts = [];
      const zsV = this.mode === 'XY' ? [this.level.z] : zs;
      if (this.mode === '3D' || this.mode === 'XY') {
        for (const z of zsV) {
          for (const x of xs) for (const y of ys) pts.push({ x, y, z });
          if (rad) { pts.push({ x: rad.cx, y: rad.cy, z }); for (const r of rad.r) for (const t of rad.th) pts.push({ x: rad.cx + r * Math.cos(t * Math.PI / 180), y: rad.cy + r * Math.sin(t * Math.PI / 180), z }); }
        }
      } else if (this.mode === 'XZ') { for (const x of xs) for (const z of zs) pts.push({ x, y: this.level.y, z }); }
      else if (this.mode === 'YZ') { for (const y of ys) for (const z of zs) pts.push({ x: this.level.x, y, z }); }
      return pts;
    },
    levels() {
      const { xs, ys, zs } = this.gridData();
      const extra = k => this.model.nodes.map(n => n[k] || 0);
      const uniq = a => [...new Set(a.map(v => +(+v).toFixed(6)))].sort((p, q) => p - q);
      if (this.mode === 'XY') return uniq(zs.concat(extra('z')));
      if (this.mode === 'XZ') return uniq(ys.concat(extra('y')));
      if (this.mode === 'YZ') return uniq(xs.concat(extra('x')));
      return [];
    },

    fit() {
      const pts = this.model.nodes.map(n => ({ x: n.x, y: n.y || 0, z: n.z })).concat(this.gridPoints());
      if (!pts.length) pts.push({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
      const mn = { x: Infinity, y: Infinity, z: Infinity }, mx = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (const p of pts) for (const k of ['x', 'y', 'z']) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
      this.cam.ctr = { x: (mn.x + mx.x) / 2, y: (mn.y + mx.y) / 2, z: (mn.z + mx.z) / 2 };
      this.cam.ox = 0; this.cam.oy = 0;
      let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      const s0 = this.cam.scale; this.cam.scale = 1;
      for (const p of pts) { const [x, y] = this.P(p.x, p.y, p.z); minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
      const w = Math.max(maxx - minx, 1e-3), h = Math.max(maxy - miny, 1e-3);
      this.cam.scale = Math.max(2, Math.min((this.W - 120) / w, (this.H - 120) / h)) || s0;
      this.render();
    },

    // ---------------- interacción
    evPos(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; },
    onDown(e) {
      const [x, y] = this.evPos(e);
      this.drag = { b: e.button, x0: x, y0: y, x, y, moved: false, shift: e.shiftKey, ctrl: e.ctrlKey };
      e.preventDefault();
    },
    onMove(e) {
      if (!this.cv) return;
      const [x, y] = this.evPos(e);
      this.mouse = [x, y];
      const d = this.drag;
      if (d) {
        const dx = x - d.x, dy = y - d.y;
        if (Math.abs(x - d.x0) + Math.abs(y - d.y0) > 4) d.moved = true;
        if (d.b === 1 || (d.b === 2 && (d.shift || this.mode !== '3D'))) { this.cam.ox += dx; this.cam.oy += dy; }
        else if (d.b === 2) { this.cam.yaw += dx * 0.008; this.cam.pitch = Math.max(-1.55, Math.min(1.55, this.cam.pitch + dy * 0.008)); }
        d.x = x; d.y = y;
        this.render();
        return;
      }
      if (e.target !== this.cv) return;
      this.hover = this.findSnap(x, y);
      const sp = this.hover && this.hover.p;
      const st = document.getElementById('stR');
      if (st) {
        const uL = root.Units.u('L');
        if (sp) st.textContent = `X=${fu(sp.x, 'L')}  Y=${fu(sp.y, 'L')}  Z=${fu(sp.z, 'L')} ${uL}${this.hover.kind === 'node' ? '  (nodo ' + this.hover.id + ')' : this.hover.kind === 'grid' ? '  (grid)' : ''}`;
        else { const p = this.screenToPlane(x, y); st.textContent = p ? `X=${fu(p.x, 'L')}  Y=${fu(p.y, 'L')}  Z=${fu(p.z, 'L')} ${uL}` : ''; }
      }
      this.render();
    },
    onUp(e) {
      const d = this.drag; this.drag = null;
      if (!d) return;
      const [x, y] = this.evPos(e);
      if (d.b === 2 && !d.moved) { this.drawStart = null; this.render(); return; }
      if (d.b !== 0) return;
      if (this.tool === 'select') {
        if (d.moved) this.boxSelect(d.x0, d.y0, x, y, d.shift || d.ctrl);
        else this.clickSelect(x, y, d.shift || d.ctrl);
      } else if (!d.moved) {
        const s = this.findSnap(x, y);
        if (!s) { App.status('Haz clic sobre una intersección del grid o un nodo'); return; }
        if (this.tool === 'node') App.addNodeAt(s.p);
        else if (this.tool === 'draw') {
          if (!this.drawStart) this.drawStart = s.p;
          else { if (App.addElementBetween(this.drawStart, s.p)) this.drawStart = s.p; }
        }
      }
      this.render();
    },
    onWheel(e) {
      e.preventDefault();
      const [x, y] = this.evPos(e);
      const f = Math.exp(-e.deltaY * 0.0015);
      const c = this.cam;
      const ax = x - this.W / 2 - c.ox, ay = y - this.H / 2 - c.oy;
      c.ox -= ax * (f - 1); c.oy -= ay * (f - 1); c.scale *= f;
      this.render();
    },
    findSnap(x, y) {
      let best = null, bd = 16;
      for (const nd of this.model.nodes) {
        if (!this.inPlane(nd)) continue;
        const [px, py] = this.Pn(nd); const dd = Math.hypot(px - x, py - y);
        if (dd < bd) { bd = dd; best = { kind: 'node', id: nd.id, p: { x: nd.x, y: nd.y || 0, z: nd.z } }; }
      }
      if (!best || bd > 5) for (const p of this.gridPoints()) {
        const [px, py] = this.P(p.x, p.y, p.z); const dd = Math.hypot(px - x, py - y);
        if (dd < bd - 1) { bd = dd; best = { kind: 'grid', p: { x: rnd(p.x), y: rnd(p.y), z: rnd(p.z) } }; }
      }
      if (!best && this.mode !== '3D' && App.snapStep() > 0 && (this.tool === 'draw' || this.tool === 'node')) {
        const p = this.screenToPlane(x, y); const st = App.snapStep();
        if (st > 0) for (const k of ['x', 'y', 'z']) if (k !== this.planeKey()) p[k] = Math.round(p[k] / st) * st;
        best = { kind: 'free', p: { x: rnd(p.x), y: rnd(p.y), z: rnd(p.z) } };
      }
      return best;
    },
    pick(x, y) {
      let best = null, bd = 9;
      for (const nd of this.model.nodes) { if (!this.inPlane(nd)) continue; const [px, py] = this.Pn(nd); const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = { t: 'n', id: nd.id }; } }
      if (best) return best;
      bd = 7;
      for (const el of this.model.elements) {
        if (!this.elemInPlane(el)) continue;
        const a = this.Pn(App.nodeById(el.i)), b = this.Pn(App.nodeById(el.j));
        const d = segDist(x, y, a, b); if (d < bd) { bd = d; best = { t: 'e', id: el.id }; }
      }
      return best;
    },
    clickSelect(x, y, add) {
      const p = this.pick(x, y);
      if (!add) { this.sel.nodes.clear(); this.sel.elems.clear(); }
      if (p) { const s = p.t === 'n' ? this.sel.nodes : this.sel.elems; if (s.has(p.id)) s.delete(p.id); else s.add(p.id); }
      App.onSelection();
    },
    boxSelect(x0, y0, x1, y1, add) {
      const crossing = x1 < x0;
      const [a, b] = [Math.min(x0, x1), Math.max(x0, x1)], [c, d] = [Math.min(y0, y1), Math.max(y0, y1)];
      const inside = ([px, py]) => px >= a && px <= b && py >= c && py <= d;
      if (!add) { this.sel.nodes.clear(); this.sel.elems.clear(); }
      for (const nd of this.model.nodes) if (this.inPlane(nd) && inside(this.Pn(nd))) this.sel.nodes.add(nd.id);
      for (const el of this.model.elements) {
        if (!this.elemInPlane(el)) continue;
        const p = this.Pn(App.nodeById(el.i)), q = this.Pn(App.nodeById(el.j));
        if (crossing ? (inside(p) || inside(q) || segRect(p, q, a, b, c, d)) : (inside(p) && inside(q))) this.sel.elems.add(el.id);
      }
      App.onSelection();
    },

    // ---------------- dibujo
    render() {
      if (!this.ctx) return;
      const g = this.ctx, W = this.W, H = this.H;
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#161a22'; g.fillRect(0, 0, W, H);
      if (this.show.grid) this.drawGrids(g);
      this.drawAxesGizmo(g);
      const res = App.res;
      const rt = this.result.type;
      const showDef = res && (rt === 'deformed' || rt === 'mode' || rt === 'specdisp');
      this.drawElements(g, showDef ? 0.35 : 1);
      if (res && rt === 'deformed') this.drawDeformed(g, res, this.caseDisp(res), 1);
      if (res && rt === 'mode' && App.modal) {
        const mo = App.modal.modes[this.result.mode];
        if (mo) this.drawDeformed(g, res, mo.uFull, this.result.anim ? Math.sin(this.animT) : 1, true);
      }
      if (res && rt === 'diagram') this.drawDiagrams(g, res);
      if (res && rt === 'reactions') this.drawReactions(g, res);
      this.drawSupports(g);
      if (this.show.loads && !(res && rt !== 'none')) this.drawLoads(g);
      this.drawNodes(g);
      // banda elástica
      if (this.tool === 'draw' && this.drawStart && this.hover) {
        const a = this.P(this.drawStart.x, this.drawStart.y, this.drawStart.z), b = this.P(this.hover.p.x, this.hover.p.y, this.hover.p.z);
        g.strokeStyle = '#fde047'; g.setLineDash([6, 4]); g.lineWidth = 1.5; line(g, a, b); g.setLineDash([]);
        const L = Math.hypot(this.hover.p.x - this.drawStart.x, this.hover.p.y - this.drawStart.y, this.hover.p.z - this.drawStart.z);
        g.fillStyle = '#fde047'; g.font = '12px Segoe UI'; g.fillText('L = ' + fu(L, 'L', true),(a[0] + b[0]) / 2 + 8, (a[1] + b[1]) / 2 - 8);
      }
      if (this.hover && (this.tool === 'draw' || this.tool === 'node')) {
        const [x, y] = this.P(this.hover.p.x, this.hover.p.y, this.hover.p.z);
        g.strokeStyle = this.hover.kind === 'node' ? '#22c55e' : this.hover.kind === 'grid' ? '#fde047' : '#94a3b8';
        g.lineWidth = 2; g.strokeRect(x - 6, y - 6, 12, 12);
      }
      if (this.drag && this.drag.b === 0 && this.drag.moved && this.tool === 'select') {
        const d = this.drag, crossing = d.x < d.x0;
        g.strokeStyle = crossing ? '#22c55e' : '#60a5fa'; g.fillStyle = crossing ? 'rgba(34,197,94,.08)' : 'rgba(96,165,250,.08)';
        if (crossing) g.setLineDash([5, 4]);
        g.fillRect(d.x0, d.y0, d.x - d.x0, d.y - d.y0); g.strokeRect(d.x0, d.y0, d.x - d.x0, d.y - d.y0); g.setLineDash([]);
      }
      // título de vista
      g.fillStyle = '#94a3b8'; g.font = '12px Segoe UI';
      const ttl = this.mode === '3D' ? 'Vista 3D (clic derecho + arrastrar: orbitar · Shift/rueda: desplazar/zoom)' :
        this.mode === 'XY' ? `Planta XY  @ Z = ${fu(this.level.z, 'L', true)}` : this.mode === 'XZ' ? `Elevación XZ  @ Y = ${fu(this.level.y, 'L', true)}` : `Elevación YZ  @ X = ${fu(this.level.x, 'L', true)}`;
      g.fillText(ttl, 10, H - 30);
    },
    drawGrids(g) {
      const { xs, ys, zs, rad } = this.gridData();
      g.lineWidth = 1;
      const lab = (txt, p) => { g.beginPath(); g.arc(p[0], p[1], 9, 0, 7); g.fillStyle = '#1f2937'; g.fill(); g.strokeStyle = '#64748b'; g.stroke(); g.fillStyle = '#cbd5e1'; g.font = '10px Segoe UI'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, p[0], p[1]); g.textAlign = 'left'; g.textBaseline = 'alphabetic'; };
      const ext = 1.5;
      const x0 = Math.min(...xs) - ext, x1 = Math.max(...xs) + ext, y0 = Math.min(...ys) - ext, y1 = Math.max(...ys) + ext, z0 = Math.min(...zs), z1 = Math.max(...zs);
      const L = i => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');
      g.strokeStyle = '#2f3746';
      if (this.mode === 'XY' || this.mode === '3D') {
        const zl = this.mode === 'XY' ? [this.level.z] : zs;
        zl.forEach((z, k) => {
          const strong = this.mode === 'XY' || k === 0;
          g.strokeStyle = strong ? '#334155' : '#252c38';
          xs.forEach((x, i) => { const a = this.P(x, y0, z), b = this.P(x, y1, z); line(g, a, b); if (strong && !this.is2D()) lab(L(i), a); });
          if (!this.is2D()) ys.forEach((y, i) => { const a = this.P(x0, y, z), b = this.P(x1, y, z); line(g, a, b); if (strong) lab(String(i + 1), a); });
          if (rad) {
            const t0 = Math.min(...rad.th), t1 = Math.max(...rad.th), rmax = Math.max(...rad.r, 0);
            g.strokeStyle = strong ? '#3b4a5f' : '#26303d';
            for (const r of rad.r) { g.beginPath(); for (let s = 0; s <= 48; s++) { const t = (t0 + (t1 - t0) * s / 48) * Math.PI / 180; const p = this.P(rad.cx + r * Math.cos(t), rad.cy + r * Math.sin(t), z); s ? g.lineTo(...p) : g.moveTo(...p); } g.stroke(); }
            rad.th.forEach((t, i) => { const tr = t * Math.PI / 180; const a = this.P(rad.cx, rad.cy, z), b = this.P(rad.cx + (rmax + ext) * Math.cos(tr), rad.cy + (rmax + ext) * Math.sin(tr), z); line(g, a, b); if (strong) lab('θ' + (i + 1), b); });
          }
        });
        if (this.mode === '3D') { g.strokeStyle = '#252c38'; for (const x of xs) for (const y of ys) line(g, this.P(x, y, z0), this.P(x, y, z1)); }
      }
      if (this.mode === 'XZ' || this.mode === 'YZ') {
        const hs = this.mode === 'XZ' ? xs : ys, a0 = this.mode === 'XZ' ? x0 : y0, a1 = this.mode === 'XZ' ? x1 : y1;
        const PP = (h, z) => this.mode === 'XZ' ? this.P(h, this.level.y, z) : this.P(this.level.x, h, z);
        g.strokeStyle = '#334155';
        hs.forEach((h, i) => { const a = PP(h, z0 - ext), b = PP(h, z1 + ext); line(g, a, b); lab(this.mode === 'XZ' ? L(i) : String(i + 1), b); });
        zs.forEach(z => { const a = PP(a0, z), b = PP(a1, z); line(g, a, b); g.fillStyle = '#64748b'; g.font = '10px Segoe UI'; g.fillText('Z=' + fu(z, 'L'), a[0] - 44, a[1] + 3); });
      }
    },
    drawAxesGizmo(g) {
      if (this.mode !== '3D') return;
      const o = [50, this.H - 70], c = this.cam;
      const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
      const pr = (X, Y, Z) => { const x1 = X * cy - Y * sy, y1 = X * sy + Y * cy; return [o[0] + 28 * x1, o[1] - 28 * (Z * cp + y1 * sp)]; };
      [['X', [1, 0, 0], '#ef4444'], ['Y', [0, 1, 0], '#22c55e'], ['Z', [0, 0, 1], '#3b82f6']].forEach(([t, v, col]) => {
        const p = pr(...v); g.strokeStyle = col; g.lineWidth = 2; line(g, o, p); g.fillStyle = col; g.font = 'bold 11px Segoe UI'; g.fillText(t, p[0] + 3, p[1] + 3);
      });
    },
    secColor(name) { const i = this.model.sections.findIndex(s => s.name === name); return PALETTE[(i < 0 ? 0 : i) % PALETTE.length]; },
    drawElements(g, alpha) {
      const res = App.res;
      g.globalAlpha = alpha;
      for (const el of this.model.elements) {
        const A = App.nodeById(el.i), B = App.nodeById(el.j); if (!A || !B) continue;
        const inP = this.elemInPlane(el);
        const a = this.Pn(A), b = this.Pn(B);
        const selected = this.sel.elems.has(el.id);
        g.strokeStyle = selected ? '#fde047' : (inP ? this.secColor(el.sec) : '#3a4456');
        let lw = selected ? 3 : 2;
        if (this.show.extr && inP) { const s = this.model.sections.find(x => x.name === el.sec); if (s) lw = Math.max(2, (Solver.secDims(s).h || 0.3) * this.cam.scale); g.globalAlpha = alpha * 0.55; }
        g.lineWidth = lw; line(g, a, b); g.globalAlpha = alpha;
        if (this.show.off && inP && ((+el.offI) || (+el.offJ))) {
          const L = Math.hypot(B.x - A.x, (B.y || 0) - (A.y || 0), B.z - A.z);
          const at = t => this.P(A.x + (B.x - A.x) * t, (A.y || 0) + ((B.y || 0) - (A.y || 0)) * t, A.z + (B.z - A.z) * t);
          g.strokeStyle = '#e5e7eb'; g.lineWidth = 5;
          if (+el.offI) line(g, a, at(Math.min(1, el.offI / L)));
          if (+el.offJ) line(g, at(Math.max(0, 1 - el.offJ / L)), b);
        }
        // liberaciones
        if (inP && el.rel) {
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
          const mark = (r, p, s) => { if (r && (r[4] || r[5] || r[3])) { g.beginPath(); g.arc(p[0] + ux * 9 * s, p[1] + uy * 9 * s, 3.5, 0, 7); g.fillStyle = '#161a22'; g.fill(); g.strokeStyle = '#f8fafc'; g.lineWidth = 1.3; g.stroke(); } };
          mark(el.rel.i, a, 1); mark(el.rel.j, b, -1);
        }
        if (this.show.elId && inP) { g.fillStyle = '#93c5fd'; g.font = '11px Segoe UI'; g.fillText('E' + el.id, (a[0] + b[0]) / 2 + 4, (a[1] + b[1]) / 2 - 4); }
        if (this.show.axes && inP) this.drawLocalAxes(g, el, A, B);
      }
      g.globalAlpha = 1;
    },
    drawLocalAxes(g, el, A, B) {
      const dx = B.x - A.x, dy = (B.y || 0) - (A.y || 0), dz = B.z - A.z, L = Math.hypot(dx, dy, dz);
      let R;
      if (this.is2D()) { const c = dx / L, s = dz / L; R = [[c, 0, s], [-s, 0, c]]; }
      else R = Solver.localAxes3D(dx, dy, dz, L, el.beta);
      const m = { x: (A.x + B.x) / 2, y: ((A.y || 0) + (B.y || 0)) / 2, z: (A.z + B.z) / 2 };
      const o = this.P(m.x, m.y, m.z), len = 0.12 * Math.min(L, 4);
      ['#ef4444', '#22c55e', '#3b82f6'].forEach((col, i) => {
        if (!R[i]) return;
        const p = this.P(m.x + R[i][0] * len * 3, m.y + R[i][1] * len * 3, m.z + R[i][2] * len * 3);
        g.strokeStyle = col; g.lineWidth = 2; line(g, o, p); g.fillStyle = col; g.font = '10px Segoe UI'; g.fillText(String(i + 1), p[0] + 2, p[1]);
      });
    },
    drawNodes(g) {
      for (const nd of this.model.nodes) {
        const inP = this.inPlane(nd);
        const [x, y] = this.Pn(nd);
        const s = this.sel.nodes.has(nd.id);
        g.fillStyle = s ? '#fde047' : inP ? '#e2e8f0' : '#475569';
        g.fillRect(x - (s ? 4 : 2.5), y - (s ? 4 : 2.5), s ? 8 : 5, s ? 8 : 5);
        if (nd.diaph && inP) { g.strokeStyle = '#a78bfa'; g.lineWidth = 1; g.strokeRect(x - 5, y - 5, 10, 10); }
        if (this.show.nodeId && inP) { g.fillStyle = '#cbd5e1'; g.font = '10px Segoe UI'; g.fillText(nd.id, x + 5, y - 5); }
      }
      // centros de masa de diafragmas
      if (App.res && App.res.masters) for (const m of App.res.masters) {
        if (!this.inPlane({ x: m.xc, y: m.yc, z: m.zc })) continue;
        const [x, y] = this.P(m.xc, m.yc, m.zc);
        g.strokeStyle = '#a78bfa'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 6, 0, 7); g.stroke(); line(g, [x - 8, y], [x + 8, y]); line(g, [x, y - 8], [x, y + 8]);
        g.fillStyle = '#c4b5fd'; g.font = '10px Segoe UI'; g.fillText(m.name + ' (CM)', x + 8, y + 12);
      }
    },
    drawSupports(g) {
      const is2D = this.is2D();
      for (const nd of this.model.nodes) {
        const r = nd.restr || []; const idx = is2D ? [0, 2, 4] : [0, 1, 2, 3, 4, 5];
        const cnt = idx.filter(i => r[i]).length; if (!cnt || !this.inPlane(nd)) continue;
        const [x, y] = this.Pn(nd);
        const trans = is2D ? (r[0] && r[2]) : (r[0] && r[1] && r[2]);
        const rot = is2D ? r[4] : (r[3] && r[4] && r[5]);
        g.strokeStyle = '#4ade80'; g.fillStyle = 'rgba(74,222,128,.25)'; g.lineWidth = 1.5;
        if (trans && rot) { g.fillRect(x - 9, y + 3, 18, 7); g.strokeRect(x - 9, y + 3, 18, 7); for (let i = -9; i <= 9; i += 4) line(g, [x + i, y + 10], [x + i - 3, y + 14]); }
        else if (trans) { g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x - 8, y + 13); g.lineTo(x + 8, y + 13); g.closePath(); g.fill(); g.stroke(); }
        else { g.beginPath(); g.arc(x, y + 8, 5, 0, 7); g.fill(); g.stroke(); line(g, [x - 8, y + 14], [x + 8, y + 14]); }
      }
    },
    drawArrow(g, from, to, col) {
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.6; line(g, from, to);
      const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
      g.beginPath(); g.moveTo(...to); g.lineTo(to[0] - 8 * Math.cos(a - 0.4), to[1] - 8 * Math.sin(a - 0.4)); g.lineTo(to[0] - 8 * Math.cos(a + 0.4), to[1] - 8 * Math.sin(a + 0.4)); g.closePath(); g.fill();
    },
    drawLoads(g) {
      const pat = this.visPat; if (!pat) return;
      const is2D = this.is2D();
      const L = 40 / this.cam.scale;
      for (const nl of this.model.nodalLoads) {
        if (nl.pat !== pat) continue;
        const nd = App.nodeById(nl.node); if (!nd || !this.inPlane(nd)) continue;
        const F = nl.F, dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        const lbl = [];
        for (let c = 0; c < 3; c++) {
          const v = +F[c]; if (!v || (is2D && c === 1)) continue;
          const d = dirs[c].map(t => t * Math.sign(v) * L);
          const to = this.Pn(nd), from = this.P(nd.x - d[0], (nd.y || 0) - d[1], nd.z - d[2]);
          this.drawArrow(g, from, to, '#f87171'); lbl.push(['FX', 'FY', 'FZ'][c] + '=' + fu(v, 'F', true));
        }
        for (let c = 3; c < 6; c++) { const v = +F[c]; if (v && !(is2D && c !== 4)) lbl.push((is2D ? 'M' : ['MX', 'MY', 'MZ'][c - 3]) + '=' + fu(v, 'M', true)); }
        if (lbl.length) { const [x, y] = this.Pn(nd); g.fillStyle = '#fca5a5'; g.font = '10px Segoe UI'; g.fillText(lbl.join(' '), x + 8, y + 14); }
      }
      for (const ld of this.model.elemLoads) {
        if (ld.pat !== pat) continue;
        const el = this.model.elements.find(e => e.id === ld.elem); if (!el || !this.elemInPlane(el)) continue;
        const A = App.nodeById(el.i), B = App.nodeById(el.j);
        const Lm = Math.hypot(B.x - A.x, (B.y || 0) - (A.y || 0), B.z - A.z);
        const fake = { R: is2D ? (() => { const c = (B.x - A.x) / Lm, s = (B.z - A.z) / Lm; return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; })() : Solver.localAxes3D(B.x - A.x, (B.y || 0) - (A.y || 0), B.z - A.z, Lm, el.beta) };
        const gv = Solver.loadGlobalVec(fake, ld, is2D); const nrm = Math.hypot(...gv) || 1; const u = gv.map(v => v / nrm * L * 0.7);
        const at = t => ({ x: A.x + (B.x - A.x) * t, y: (A.y || 0) + ((B.y || 0) - (A.y || 0)) * t, z: A.z + (B.z - A.z) * t });
        const ts = ld.type === 'point' ? [+ld.a] : [0, 0.25, 0.5, 0.75, 1];
        const col = ld.type === 'point' ? '#fb923c' : '#38bdf8';
        let top = [];
        for (const t of ts) { const p = at(t); const to = this.P(p.x, p.y, p.z), from = this.P(p.x - u[0], p.y - u[1], p.z - u[2]); this.drawArrow(g, from, to, col); top.push(from); }
        if (top.length > 1) { g.strokeStyle = col; g.beginPath(); top.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.stroke(); }
        g.fillStyle = col; g.font = '10px Segoe UI';
        g.fillText((ld.type === 'point' ? 'P=' + fu(ld.P, 'F', true) : 'w=' + fu(ld.w, 'FL', true)) + ' ' + ld.dir, top[Math.floor(top.length / 2)][0] + 4, top[Math.floor(top.length / 2)][1] - 4);
      }
    },

    // ---------------- resultados
    deformedPts(res, e, u, sc, nSeg) {
      nSeg = nSeg || 12;
      const A = res.nodes[e.ni], B = res.nodes[e.nj];
      const dl = Solver.mulVec(e.lam, e.dofs.map(d => u[d]));
      const L = e.L, pts = [], R = e.R, is2D = res.is2D, dp = res.dpn;
      for (let s = 0; s <= nSeg; s++) {
        const t = s / nSeg, N1 = 1 - 3 * t * t + 2 * t ** 3, N2 = t - 2 * t * t + t ** 3, N3 = 3 * t * t - 2 * t ** 3, N4 = -t * t + t ** 3;
        const ux = (1 - t) * dl[0] + t * dl[dp];
        let X = A.x + (B.x - A.x) * t, Y = (A.y || 0) + ((B.y || 0) - (A.y || 0)) * t, Z = A.z + (B.z - A.z) * t;
        if (is2D) {
          const v = N1 * dl[1] + N2 * L * dl[2] + N3 * dl[4] + N4 * L * dl[5];
          X += sc * (R[0][0] * ux + R[1][0] * v); Z += sc * (R[0][1] * ux + R[1][1] * v);
        } else {
          const v = N1 * dl[1] + N2 * L * dl[5] + N3 * dl[7] + N4 * L * dl[11];
          const w = N1 * dl[2] - N2 * L * dl[4] + N3 * dl[8] - N4 * L * dl[10];
          X += sc * (R[0][0] * ux + R[1][0] * v + R[2][0] * w); Y += sc * (R[0][1] * ux + R[1][1] * v + R[2][1] * w); Z += sc * (R[0][2] * ux + R[1][2] * v + R[2][2] * w);
        }
        pts.push(this.P(X, Y, Z));
      }
      return pts;
    },
    autoDispScale(res, u) {
      let mx = 0; for (let k = 0; k < res.nodes.length; k++) for (let c = 0; c < (res.is2D ? 2 : 3); c++) mx = Math.max(mx, Math.abs(u[k * res.dpn + c]));
      const pts = res.nodes; let span = 0;
      for (const a of pts) for (const k of ['x', 'y', 'z']) span = Math.max(span, Math.abs(a[k] || 0));
      const sz = Math.max(1, ...['x', 'y', 'z'].map(k => Math.max(...pts.map(p => p[k] || 0)) - Math.min(...pts.map(p => p[k] || 0))));
      return mx > 0 ? 0.08 * sz / mx : 1;
    },
    drawDeformed(g, res, u, phase, isMode) {
      if (!u) return;
      const sc = this.autoDispScale(res, u) * this.result.scale * phase;
      g.strokeStyle = isMode ? '#f472b6' : '#fbbf24'; g.lineWidth = 2;
      for (const e of res.els) {
        if (!this.elemInPlane(e.src)) continue;
        const pts = this.deformedPts(res, e, u, sc);
        g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.stroke();
      }
      // valores en nodos
      if (!isMode) {
        g.fillStyle = '#fde68a'; g.font = '10px Segoe UI';
        let best = null, bv = -1;
        res.nodes.forEach((nd, k) => { const v = Math.hypot(...[0, 1, 2].slice(0, res.is2D ? 2 : 3).map(c => u[k * res.dpn + c])); if (v > bv) { bv = v; best = nd; } });
        if (best) { const [x, y] = this.Pn(best); g.fillText('máx |u| = ' + fu(bv, 'D', true) + ' (N' + best.id + ')', x + 8, y + 22); }
      } else if (App.modal) {
        const mo = App.modal.modes[this.result.mode];
        g.fillStyle = '#f9a8d4'; g.font = '13px Segoe UI';
        g.fillText(`Modo ${mo.n}:  T = ${mo.T.toFixed(4)} s   f = ${mo.f.toFixed(3)} Hz`, 10, 64);
      }
    },
    curCase() { return App.cases ? App.cases[this.result.pat] : null; },
    caseDisp(res) {
      const c = this.curCase(); if (!c) return null;
      if (c.kind !== 'envelope' && !c.E.length) return c.u;
      return Solver.caseNodal(res, c, 'u').max;
    },
    drawDiagrams(g, res) {
      const cs = this.curCase(); if (!cs) return;
      const comp = this.result.comp, env = cs.env;
      const all = res.els.map((e, k) => (this.elemInPlane(e.src) ? Solver.caseStations(res, App.spec, cs, k, 21) : null));
      let mx = 0; all.forEach(st => st && st.forEach(s => mx = Math.max(mx, Math.abs(s.max[comp]), Math.abs(s.min[comp]))));
      if (mx < 1e-12) { g.fillStyle = '#cbd5e1'; g.fillText('Diagrama nulo para esta componente', 10, 64); return; }
      const s = 45 / this.cam.scale / mx * this.result.scale;
      const sign = comp === 'M3' ? -1 : 1;
      const useZ = comp === 'M2' || comp === 'V3';
      g.font = '10px Segoe UI';
      res.els.forEach((e, k) => {
        const st = all[k]; if (!st) return;
        const A = res.nodes[e.ni];
        const toG = v => res.is2D ? [v[0], 0, v[1]] : v;
        const exg = toG(e.R[0]), offg = toG(useZ ? e.R[2] : e.R[1]);
        const base = x => [A.x + exg[0] * (e.a + x), (A.y || 0) + exg[1] * (e.a + x), A.z + exg[2] * (e.a + x)];
        const b0 = this.P(...base(0)), b1 = this.P(...base(e.Lf));
        const curves = env ? [['max', 'rgba(248,113,113,.22)', '#f87171'], ['min', 'rgba(96,165,250,.22)', '#60a5fa']] : [['max', 'rgba(96,165,250,.28)', '#60a5fa']];
        for (const [key, fill, line] of curves) {
          const poly = st.map(p => { const b = base(p.x), v = sign * p[key][comp] * s; return this.P(b[0] + offg[0] * v, b[1] + offg[1] * v, b[2] + offg[2] * v); });
          g.beginPath(); g.moveTo(...b0); poly.forEach(p => g.lineTo(...p)); g.lineTo(...b1); g.closePath();
          g.fillStyle = fill; g.fill(); g.strokeStyle = line; g.lineWidth = 1.2; g.stroke();
          let im = 0; st.forEach((p, i) => { if (Math.abs(p[key][comp]) > Math.abs(st[im][key][comp])) im = i; });
          g.fillStyle = env ? line : '#e2e8f0';
          for (const i of new Set([0, st.length - 1, im])) { const v = st[i][key][comp]; if (Math.abs(v) < 1e-9 * mx) continue; g.fillText(fu(v, DIAG_DIM[comp]), poly[i][0] + 3, poly[i][1] - 3); }
        }
      });
      g.fillStyle = '#93c5fd'; g.font = '13px Segoe UI';
      g.fillText(`Diagrama ${comp}  —  "${cs.name}"  (máx |valor| = ${fu(mx, DIAG_DIM[comp], true)})${env ? '   rojo = máximo, azul = mínimo' : ''}`, 10, 64);
    },
    drawReactions(g, res) {
      const cs = this.curCase(); if (!cs) return;
      const Rc = Solver.caseNodal(res, cs, 'R');
      g.font = '11px Segoe UI'; g.fillStyle = '#86efac';
      res.nodes.forEach((nd, k) => {
        const vals = []; for (let d = 0; d < res.dpn; d++) { const gi = k * res.dpn + d; if (res.restrained[gi]) { const dm = d < (res.is2D ? 2 : 3) ? 'F' : 'M'; vals.push(res.dofNames[d].replace('U', 'F').replace('R', 'M').replace('θ', 'M') + '=' + (cs.env ? `[${fu(Rc.min[gi], dm)}, ${fu(Rc.max[gi], dm)}] ${root.Units.u(dm)}` : fu(Rc.max[gi], dm, true))); } }
        if (!vals.length || !this.inPlane(nd)) return;
        const [x, y] = this.Pn(nd);
        vals.forEach((t, i) => g.fillText(t, x + 10, y + 26 + i * 12));
      });
    },
    startAnim() {
      if (this.animOn) return; this.animOn = true;
      const tick = () => {
        if (!(this.result.type === 'mode' && this.result.anim)) { this.animOn = false; this.render(); return; }
        this.animT += 0.08; this.render(); requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  };

  function line(g, a, b) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
  function segDist(x, y, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    let t = L2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
  }
  function segRect(p, q, a, b, c, d) {
    for (let s = 0; s <= 20; s++) { const x = p[0] + (q[0] - p[0]) * s / 20, y = p[1] + (q[1] - p[1]) * s / 20; if (x >= a && x <= b && y >= c && y <= d) return true; }
    return false;
  }
  function rnd(v) { return Math.round(v * 1e6) / 1e6; }
  function fmt(v) { v = +v; if (!isFinite(v)) return '∞'; const a = Math.abs(v); if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(3); return (Math.round(v * 1000) / 1000).toString(); }
  /** valor interno -> texto en las unidades de trabajo, con etiqueta opcional */
  function fu(v, dim, withUnit) { const U = root.Units; return fmt(U.v(v, dim)) + (withUnit ? ' ' + U.u(dim) : ''); }
  const DIAG_DIM = { N: 'F', V2: 'F', V3: 'F', T: 'M', M2: 'M', M3: 'M' };
  root.View = View; root.fmt = fmt;
})(window);
