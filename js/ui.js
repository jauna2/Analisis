/* =====================================================================
   Interfaz: modelo, diálogos, asignaciones, tablas, resultados
   ===================================================================== */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 0) => { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : d; };
  const fN = (v, d = 4) => { v = +v; if (!isFinite(v)) return '—'; const a = Math.abs(v); if (a === 0) return '0'; if (a < 1e-3 || a >= 1e7) return v.toExponential(Math.max(0, d - 1)); return v.toFixed(d); };
  // Unidades de trabajo: el modelo se guarda en kN, m; U convierte lo que se muestra (v/f/i) y lo que se escribe (s)
  const U = window.Units;
  const uIn = (x, dim) => U.i(x, dim);               // valor interno -> texto de un campo
  const uRead = (txt, dim, d = 0) => U.s(num(txt, d), dim); // texto escrito -> valor interno
  const uF = (x, dim, d) => U.f(x, dim, d);          // valor interno -> texto de tabla
  const uL = dim => U.u(dim);                         // etiqueta de unidad
  const nodeDim = (is2D, c) => (c < (is2D ? 2 : 3) ? 'F' : 'M');       // fuerza o momento por componente nodal
  const loadDim = c => (c < 3 ? 'F' : 'M');                            // índice del vector F[6] de cargas nodales
  const localDims = is2D => (is2D ? ['F', 'F', 'M'] : ['F', 'F', 'F', 'M', 'M', 'M']);

  function defaultModel(mode) {
    return {
      version: 1, mode,
      grids: { x: '0, 2@5', y: '0, 2@5', z: '0, 3@3', radial: { on: false, cx: 0, cy: 0, r: '4, 8', th: '0, 30, 60, 90' } },
      materials: [
        { name: "Concreto f'c=28", type: 'concrete', fc: 28, autoE: true, E: 24870062, nu: 0.2, gamma: 24 },
        { name: 'ASTM A572 Gr.50', type: 'steel', Fy: 345, Fu: 450, E: 200000000, nu: 0.3, gamma: 77 }],
      sections: [
        { name: 'COL 40x40', mat: "Concreto f'c=28", shape: 'rect', b: 0.4, h: 0.4, mod: {} },
        { name: 'VIG 30x45', mat: "Concreto f'c=28", shape: 'rect', b: 0.3, h: 0.45, mod: {} },
        (App.aiscSection && App.aiscSection('W14X22', 'ASTM A572 Gr.50')) || { name: 'W14X22', mat: 'ASTM A572 Gr.50', shape: 'I', h: 0.349, b: 0.127, tf: 0.0085, tw: 0.0058, mod: {} }],
      nodes: [], elements: [],
      patterns: [{ name: 'Muerta', type: 'D', selfWeight: 1 }, { name: 'Viva', type: 'L', selfWeight: 0 }],
      combos: [],
      nodalLoads: [], elemLoads: [],
      settings: { shear: true, rigidFactor: 1, snap: 0 },
      massSource: { selfWeight: true, patterns: [{ pat: 'Muerta', factor: 1 }, { pat: 'Viva', factor: 0.25 }], vertical: false },
      spectrum: { type: 'NSR10', Aa: 0.15, Av: 0.20, Fa: 1.20, Fv: 1.60, I: 1.0, R: 1.0, xi: 0.05, comb: 'CQC', lowBranch: false, minShearPct: 80, applyScale: false, table: [[0, 0.375], [0.5, 0.375], [1, 0.19], [3, 0.06]] },
      modalOpts: { nModes: 12 }, driftLimit: 1.0
    };
  }

  const App = window.App = {
    model: null, res: null, modal: null, spec: null, err: null,
    undoS: [], redoS: [],
    nodeById(id) { return this._nmap ? this._nmap.get(id) : this.model.nodes.find(n => n.id === id); },
    reindex() { this._nmap = new Map(this.model.nodes.map(n => [n.id, n])); },
    parseList(txt) {
      const out = []; let last = null;
      for (const tok of String(txt).split(/[,;\s]+/).filter(Boolean)) {
        const m = tok.match(/^(\d+)\s*@\s*([-+]?\d*\.?\d+)$/);
        if (m) { const n = +m[1], s = +m[2]; for (let i = 0; i < n; i++) { last = (last === null ? 0 : last) + s; out.push(+last.toFixed(6)); } }
        else { const v = num(tok, NaN); if (isFinite(v)) { out.push(v); last = v; } }
      }
      return [...new Set(out)].sort((a, b) => a - b);
    },
    gridArr(k) { const a = this.parseList(this.model.grids[k]); return a.length ? a : [0]; },
    snapStep() { return num(this.model.settings.snap, 0); },
    status(t, cls) { const s = $('stL'); s.textContent = t; s.className = cls || ''; },
    pushUndo() { this.undoS.push(JSON.stringify(this.model)); if (this.undoS.length > 80) this.undoS.shift(); this.redoS = []; },
    changed(keepResults) {
      this.reindex();
      if (!keepResults) { this.res = null; this.modal = null; this.spec = null; View.result.type = 'none'; renderResultsPanel(); renderResultControls(); }
      try { localStorage.setItem('porticoMatricial', JSON.stringify(this.model)); } catch (e) { /* almacenamiento no disponible */ }
      renderData(); renderAssign(); fillSelects(); View.render();
    },
    undo() { if (!this.undoS.length) return; this.redoS.push(JSON.stringify(this.model)); this.model = JSON.parse(this.undoS.pop()); this.changed(); },
    redo() { if (!this.redoS.length) return; this.undoS.push(JSON.stringify(this.model)); this.model = JSON.parse(this.redoS.pop()); this.changed(); },
    nextId(arr) { return arr.reduce((m, o) => Math.max(m, o.id), 0) + 1; },
    findNodeAt(p) { return this.model.nodes.find(n => Math.abs(n.x - p.x) < 1e-4 && Math.abs((n.y || 0) - (p.y || 0)) < 1e-4 && Math.abs(n.z - p.z) < 1e-4); },
    getOrCreateNode(p) {
      let nd = this.findNodeAt(p);
      if (!nd) { nd = { id: this.nextId(this.model.nodes), x: +p.x, y: this.model.mode === '2D' ? 0 : +p.y, z: +p.z, restr: [0, 0, 0, 0, 0, 0], mass: 0, diaph: '' }; this.model.nodes.push(nd); this._nmap && this._nmap.set(nd.id, nd); }
      return nd;
    },
    addNodeAt(p) { if (this.findNodeAt(p)) { this.status('Ya existe un nodo en ese punto'); return; } this.pushUndo(); const nd = this.getOrCreateNode(p); this.status('Nodo ' + nd.id + ' creado'); this.changed(); },
    addElementBetween(p, q, sec) {
      if (Math.hypot(p.x - q.x, (p.y || 0) - (q.y || 0), p.z - q.z) < 1e-6) return false;
      this.pushUndo();
      const a = this.getOrCreateNode(p), b = this.getOrCreateNode(q);
      if (this.model.elements.some(e => (e.i === a.id && e.j === b.id) || (e.i === b.id && e.j === a.id))) { this.status('Ese elemento ya existe'); this.changed(); return true; }
      const el = { id: this.nextId(this.model.elements), i: a.id, j: b.id, sec: sec || $('drawSec').value || this.model.sections[0].name, beta: 0, offI: 0, offJ: 0, rel: null };
      this.model.elements.push(el);
      this.status(`Elemento E${el.id} creado (N${a.id} → N${b.id})`);
      this.changed();
      return true;
    },
    onSelection() { renderAssign(); renderData(); View.render(); }
  };

  // ------------------------------------------------------------------
  // Diálogo genérico
  // ------------------------------------------------------------------
  function dialog(title, body, buttons, onOpen) {
    $('dlgHead').textContent = title;
    $('dlgBody').innerHTML = body;
    const foot = $('dlgFoot'); foot.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button'); el.textContent = b.text; if (b.primary) el.className = 'primary';
      el.onclick = () => { if (b.click && b.click() === false) return; closeDialog(); };
      foot.appendChild(el);
    }
    $('overlay').classList.add('show');
    if (onOpen) onOpen($('dlgBody'));
  }
  function closeDialog() { $('overlay').classList.remove('show'); }
  const Q = sel => $('dlgBody').querySelector(sel);
  const QA = sel => [...$('dlgBody').querySelectorAll(sel)];

  // ------------------------------------------------------------------
  // Nuevo modelo / plantillas
  // ------------------------------------------------------------------
  function dlgNew() {
    dialog('Nuevo modelo', `
      <fieldset><legend>Tipo de modelo</legend>
        <label><input type="radio" name="nm" value="2D" checked> Pórtico plano 2D (plano XZ: 3 GDL por nodo UX, UZ, θ)</label><br>
        <label><input type="radio" name="nm" value="3D"> Pórtico espacial 3D (6 GDL por nodo)</label>
      </fieldset>
      <fieldset><legend>Plantilla</legend>
        <label><input type="radio" name="tp" value="blank"> Solo grids (dibujar a mano)</label><br>
        <label><input type="radio" name="tp" value="frame" checked> Pórtico regular (genera grids, columnas y vigas)</label>
        <div class="grid2" style="margin-top:8px">
          <label>Luces en X (${uL('L')})</label><input id="nX" value="2@${uIn(5, 'L')}">
          <label>Luces en Y (3D) (${uL('L')})</label><input id="nY" value="2@${uIn(5, 'L')}">
          <label>Alturas de piso (${uL('L')})</label><input id="nZ" value="3@${uIn(3, 'L')}">
          <label>Sección columnas</label><select id="nSC">${App.model.sections.map(s => `<option>${esc(s.name)}</option>`).join('')}</select>
          <label>Sección vigas</label><select id="nSB">${App.model.sections.map((s, i) => `<option ${i === 1 ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
          <label>Apoyos en la base</label><select id="nSup"><option value="fix">Empotrados</option><option value="pin">Articulados</option></select>
          <label>Diafragma rígido por piso</label><input type="checkbox" id="nDia" checked>
          <label>Carga muerta en vigas (${uL('FL')})</label><input id="nWD" value="${+U.v(20, 'FL').toPrecision(4)}">
          <label>Carga viva en vigas (${uL('FL')})</label><input id="nWL" value="${+U.v(8, 'FL').toPrecision(4)}">
        </div>
        <p class="note">Cada valor es una luz (espacio entre ejes) en ${uL('L')}: "5, 6" o "3@5" (= tres luces iguales). Puedes mezclar: "4, 2@5.5".</p>
      </fieldset>`, [
      { text: 'Cancelar' },
      {
        text: 'Crear', primary: true, click: () => {
          const mode = Q('input[name=nm]:checked').value, tp = Q('input[name=tp]:checked').value;
          const keep = { materials: App.model.materials, sections: App.model.sections };
          App.pushUndo();
          App.model = defaultModel(mode);
          Object.assign(App.model, JSON.parse(JSON.stringify(keep)));
          App.model.units = Object.assign({}, U.cur);
          if (tp === 'frame') genFrame(Q('#nX').value, Q('#nY').value, Q('#nZ').value, Q('#nSC').value, Q('#nSB').value, Q('#nSup').value, Q('#nDia').checked, uRead(Q('#nWD').value, 'FL'), uRead(Q('#nWL').value, 'FL'), U.fac('L'));
          App.reindex();
          setViewMode(mode === '2D' ? 'XZ' : '3D');
          App.changed(); View.fit();
        }
      }]);
  }
  function spacingsToCoords(txt) {
    // cada token es una luz: "5, 2@4" -> 0, 5, 9, 13
    const out = [0]; let c = 0;
    for (const tok of String(txt).split(/[,;\s]+/).filter(Boolean)) {
      const m = tok.match(/^(\d+)\s*@\s*(\d*\.?\d+)$/);
      if (m) for (let i = 0; i < +m[1]; i++) { c += +m[2]; out.push(+c.toFixed(6)); }
      else { const v = num(tok, NaN); if (v > 0) { c += v; out.push(+c.toFixed(6)); } }
    }
    return out;
  }
  // xs, ys, zs: luces escritas en la unidad de longitud actual (lf = m por unidad); wD, wL ya internos (kN/m)
  function genFrame(xs, ys, zs, sc, sb, sup, dia, wD, wL, lf = 1) {
    const m = App.model, is2D = m.mode === '2D';
    const toM = a => a.map(v => +(v * lf).toFixed(9));
    const X = toM(spacingsToCoords(xs)), Y = is2D ? [0] : toM(spacingsToCoords(ys)), Z = toM(spacingsToCoords(zs));
    m.grids.x = X.join(', '); m.grids.y = Y.join(', '); m.grids.z = Z.join(', ');
    App.reindex();
    const nodeAt = (x, y, z) => App.getOrCreateNode({ x, y, z });
    for (let k = 0; k < Z.length; k++) for (const y of Y) for (const x of X) {
      const nd = nodeAt(x, y, Z[k]);
      if (k === 0) nd.restr = sup === 'fix' ? [1, 1, 1, 1, 1, 1] : [1, 1, 1, 0, 0, 0];
      else if (dia) nd.diaph = 'D' + k;
    }
    const addE = (a, b, sec) => m.elements.push({ id: App.nextId(m.elements), i: a.id, j: b.id, sec, beta: 0, offI: 0, offJ: 0, rel: null });
    for (let k = 1; k < Z.length; k++) {
      for (const y of Y) for (const x of X) addE(nodeAt(x, y, Z[k - 1]), nodeAt(x, y, Z[k]), sc);
      for (const y of Y) for (let i = 1; i < X.length; i++) { addE(nodeAt(X[i - 1], y, Z[k]), nodeAt(X[i], y, Z[k]), sb); }
      if (!is2D) for (const x of X) for (let j = 1; j < Y.length; j++) addE(nodeAt(x, Y[j - 1], Z[k]), nodeAt(x, Y[j], Z[k]), sb);
    }
    for (const e of m.elements) {
      const a = App.nodeById(e.i), b = App.nodeById(e.j);
      if (Math.abs(a.z - b.z) < 1e-6) {
        if (wD) m.elemLoads.push({ elem: e.id, pat: 'Muerta', type: 'dist', dir: 'GZ', w: -wD });
        if (wL) m.elemLoads.push({ elem: e.id, pat: 'Viva', type: 'dist', dir: 'GZ', w: -wL });
      }
    }
  }

  // ------------------------------------------------------------------
  // Grids
  // ------------------------------------------------------------------
  function dlgGrids() {
    const g = App.model.grids, is2D = App.model.mode === '2D', r = g.radial;
    // las listas se guardan en m; se muestran y se leen en la unidad de longitud actual
    const show = txt => esc(U.listOut(App.parseList(txt)));
    const store = txt => App.parseList(txt).map(v => +U.s(v, 'L').toFixed(9)).join(', ');
    dialog('Sistema de grids', `
      <fieldset><legend>Grid ortogonal (coordenadas en ${uL('L')})</legend>
        <div class="grid2">
          <label>Ejes X</label><input id="gX" value="${show(g.x)}" style="width:420px">
          ${is2D ? '' : `<label>Ejes Y</label><input id="gY" value="${show(g.y)}" style="width:420px">`}
          <label>Niveles Z</label><input id="gZ" value="${show(g.z)}" style="width:420px">
        </div>
        <p class="note">Ej.: <code>0, 4, 9.5</code> (coordenadas) o <code>0, 3@5, 21</code> → 0, 5, 10, 15, 21 (n@s suma n espacios de s desde el valor anterior; un número suelto es una coordenada).</p>
      </fieldset>
      ${is2D ? '<p class="note">El grid radial está disponible en modelos 3D.</p>' : `
      <fieldset><legend>Grid radial / cilíndrico</legend>
        <label><input type="checkbox" id="gRon" ${r.on ? 'checked' : ''}> Activar</label>
        <div class="grid2" style="margin-top:6px">
          <label>Centro X, Y (${uL('L')})</label><span><input id="gRcx" type="number" step="any" value="${uIn(r.cx, 'L')}"> <input id="gRcy" type="number" step="any" value="${uIn(r.cy, 'L')}"></span>
          <label>Radios (${uL('L')})</label><input id="gRr" value="${show(r.r)}" style="width:360px">
          <label>Ángulos (°)</label><input id="gRt" value="${esc(r.th)}" style="width:360px">
        </div>
        <p class="note">Ángulos medidos desde +X, antihorario. Usa los mismos niveles Z. Ej. ángulos: <code>0, 6@15</code> → 0…90°.</p>
      </fieldset>`}`, [
      { text: 'Cancelar' },
      {
        text: 'Aceptar', primary: true, click: () => {
          App.pushUndo();
          g.x = store(Q('#gX').value); g.z = store(Q('#gZ').value); if (!is2D) g.y = store(Q('#gY').value);
          if (!is2D) { r.on = Q('#gRon').checked; r.cx = uRead(Q('#gRcx').value, 'L'); r.cy = uRead(Q('#gRcy').value, 'L'); r.r = store(Q('#gRr').value); r.th = Q('#gRt').value; }
          App.changed(true); fillLevels(); View.fit();
        }
      }]);
  }

  const MAT_TYPES = { concrete: 'Concreto', steel: 'Acero', other: 'Otro' };
  const STEEL_PRESETS = [
    ['ASTM A36', 250, 400], ['ASTM A572 Gr.50', 345, 450], ['ASTM A992', 345, 450],
    ['ASTM A500 Gr.C (HSS rect.)', 345, 427], ['ASTM A500 Gr.C (HSS circ.)', 317, 427], ['ASTM A53 Gr.B (tubería)', 240, 415]];
  function concreteE(fc) { return Math.round(4700 * Math.sqrt(fc) * 1000); }
  function normalizeModel(m) {
    if (!Array.isArray(m.combos)) m.combos = [];
    for (const p of m.patterns) if (!p.type) p.type = guessPatType(p);
    for (const mt of m.materials) {
      if (!mt.type) mt.type = +mt.E >= 1e8 ? 'steel' : 'concrete';
      if (mt.type === 'concrete' && !mt.fc) { mt.fc = Math.round((mt.E / 4700000) ** 2 * 10) / 10; mt.autoE = false; }
      if (mt.type === 'steel') { if (!mt.Fy) mt.Fy = 345; if (!mt.Fu) mt.Fu = 450; }
    }
    return m;
  }
  App.normalizeModel = normalizeModel;

  // ------------------------------------------------------------------
  // Materiales (por tipo)
  // ------------------------------------------------------------------
  function dlgMaterials() {
    let work = JSON.parse(JSON.stringify(App.model.materials));
    let cur = 0;
    const newMat = type => {
      if (type === 'concrete') return { name: `Concreto f'c=28`, type, fc: 28, autoE: true, E: concreteE(28), nu: 0.2, gamma: 24 };
      if (type === 'steel') return { name: 'ASTM A572 Gr.50', type, Fy: 345, Fu: 450, E: 200000000, nu: 0.3, gamma: 77 };
      return { name: 'Material', type: 'other', E: 2e7, nu: 0.2, gamma: 20 };
    };
    const uniq = n => { let s = n, k = 2; while (work.some(m => m.name === s)) s = `${n} (${k++})`; return s; };
    const redraw = () => {
      const m = work[cur];
      const G = m ? m.E / (2 * (1 + m.nu)) : 0;
      $('dlgBody').innerHTML = `<div style="display:grid;grid-template-columns:230px 1fr;gap:14px;min-width:640px">
        <div><div class="tblwrap" style="max-height:340px"><table class="t" style="width:100%">${work.map((x, i) => `<tr class="${i === cur ? 'sel' : ''}"><td class="l" data-pick="${i}" style="cursor:pointer">${esc(x.name)}</td><td class="l"><span class="pill">${MAT_TYPES[x.type] || x.type}</span></td></tr>`).join('')}</table></div>
          <div class="btns" style="margin-top:6px"><button id="mAddC">+ Concreto</button><button id="mAddS">+ Acero</button><button id="mAddO">+ Otro</button></div>
          <div class="btns" style="margin-top:4px"><button id="mDup" class="small">Duplicar</button><button id="mDel" class="small">Eliminar</button></div></div>
        <div>${!m ? '<p class="note">Sin materiales</p>' : `
          <div class="tabs">${Object.entries(MAT_TYPES).map(([k, t]) => `<button class="small ${m.type === k ? 'on' : ''}" data-type="${k}">${t}</button>`).join('')}</div>
          <div class="grid2">
            <label>Nombre</label><input id="mName" value="${esc(m.name)}" style="width:240px">
            ${m.type === 'concrete' ? `
              <label>f'c (${uL('S')})</label><input data-k="fc" value="${uIn(m.fc * 1000, 'S')}">
              <label>E automático</label><label><input type="checkbox" id="mAutoE" ${m.autoE !== false ? 'checked' : ''}> E = 4700·√f'c (NSR-10 C.8.5.1)</label>` : ''}
            ${m.type === 'steel' ? `
              <label>Norma / grado</label><select id="mPreset"><option value="">— elegir para llenar —</option>${STEEL_PRESETS.map((p, i) => `<option value="${i}">${p[0]} (Fy ${uF(p[1] * 1000, 'S', 1)}, Fu ${uF(p[2] * 1000, 'S', 1)} ${uL('S')})</option>`).join('')}</select>
              <label>Fy (${uL('S')})</label><input data-k="Fy" value="${uIn(m.Fy * 1000, 'S')}">
              <label>Fu (${uL('S')})</label><input data-k="Fu" value="${uIn(m.Fu * 1000, 'S')}">` : ''}
            <label>E (${uL('S')})</label><input data-k="E" value="${uIn(m.E, 'S')}" ${m.type === 'concrete' && m.autoE !== false ? 'disabled' : ''}>
            <label>ν (Poisson)</label><input data-k="nu" value="${m.nu}">
            <label>G (${uL('S')})</label><span>${uF(G, 'S', 1)}  <span class="note">= E / 2(1+ν)</span></span>
            <label>γ peso específico (${uL('G')})</label><input data-k="gamma" value="${uIn(m.gamma, 'G')}">
            <label>Masa por volumen</label><span>${fN(U.v(m.gamma / Solver.GRAV, 'm') * U.fac('L') ** 3, 4)} ${uL('m')}/${uL('L')}³</span>
          </div>
          <p class="note">${m.type === 'concrete' ? `Valores típicos: ν = 0.20, γ = ${uF(24, 'G', 3)} ${uL('G')} (concreto reforzado).` : m.type === 'steel' ? `Valores típicos: E = ${uF(2e8, 'S', 0)} ${uL('S')}, ν = 0.30, γ = ${uF(77, 'G', 3)} ${uL('G')}. Fy y Fu se guardan con el material para el diseño.` : 'Material genérico: define E, ν y γ.'}</p>`}
        </div></div>`;
      QA('[data-pick]').forEach(td => td.onclick = () => { cur = +td.dataset.pick; redraw(); });
      Q('#mAddC').onclick = () => { const n = newMat('concrete'); n.name = uniq(n.name); work.push(n); cur = work.length - 1; redraw(); };
      Q('#mAddS').onclick = () => { const n = newMat('steel'); n.name = uniq(n.name); work.push(n); cur = work.length - 1; redraw(); };
      Q('#mAddO').onclick = () => { const n = newMat('other'); n.name = uniq(n.name); work.push(n); cur = work.length - 1; redraw(); };
      Q('#mDup').onclick = () => { if (!m) return; const c = JSON.parse(JSON.stringify(m)); c.name = uniq(m.name + ' copia'); delete c._old; work.push(c); cur = work.length - 1; redraw(); };
      Q('#mDel').onclick = () => { if (!m) return; if (App.model.sections.some(s => s.mat === (m._old || m.name))) { alert('El material está asignado a secciones'); return; } work.splice(cur, 1); cur = 0; redraw(); };
      if (!m) return;
      QA('[data-type]').forEach(b => b.onclick = () => { const keep = { name: m.name, _old: m._old }; const n = newMat(b.dataset.type); Object.keys(m).forEach(k => delete m[k]); Object.assign(m, n, keep); redraw(); });
      Q('#mName').onchange = e => { m._old = m._old || m.name; m.name = e.target.value.trim() || m.name; redraw(); };
      QA('input[data-k]').forEach(inp => inp.onchange = () => {
        // internos: E en kN/m², f'c/Fy/Fu en MPa, γ en kN/m³
        const k = inp.dataset.k, v = num(inp.value);
        if (k === 'E') m.E = U.s(v, 'S');
        else if (k === 'fc' || k === 'Fy' || k === 'Fu') m[k] = +(U.s(v, 'S') / 1000).toPrecision(10);
        else if (k === 'gamma') m.gamma = U.s(v, 'G');
        else m[k] = v;
        if (m.type === 'concrete' && m.autoE !== false) m.E = concreteE(m.fc);
        redraw();
      });
      const ae = Q('#mAutoE'); if (ae) ae.onchange = () => { m.autoE = ae.checked; if (m.autoE) m.E = concreteE(m.fc); redraw(); };
      const pr = Q('#mPreset'); if (pr) pr.onchange = () => { const p = STEEL_PRESETS[+pr.value]; if (!p) return; m._old = m._old || m.name; m.name = uniq(p[0]); m.Fy = p[1]; m.Fu = p[2]; redraw(); };
    };
    dialog('Materiales', '', [{ text: 'Cancelar' }, {
      text: 'Aceptar', primary: true, click: () => {
        if (new Set(work.map(m => m.name)).size !== work.length) { alert('Nombres de material repetidos'); return false; }
        if (!work.length) { alert('Debe existir al menos un material'); return false; }
        App.pushUndo();
        for (const m of work) if (m._old && m._old !== m.name) App.model.sections.forEach(s => { if (s.mat === m._old) s.mat = m.name; });
        work.forEach(m => delete m._old);
        const names = new Set(work.map(m => m.name));
        App.model.sections.forEach(s => { if (!names.has(s.mat)) s.mat = work[0].name; });
        App.model.materials = work; App.changed();
      }
    }]);
    redraw();
  }

  // ------------------------------------------------------------------
  // Secciones (concreto paramétrico / acero desde base AISC)
  // ------------------------------------------------------------------
  const SHAPES = { rect: 'Rectangular', circ: 'Circular maciza', T: 'Viga T', ring: 'Circular hueca', aisc: 'Perfil AISC (base de datos)', I: 'Perfil I armado (placas)', tube: 'Tubo rectangular', gen: 'General (propiedades)' };
  const SHAPES_BY_TYPE = { concrete: ['rect', 'circ', 'T', 'ring', 'gen'], steel: ['aisc', 'I', 'tube', 'ring', 'gen'], other: Object.keys(SHAPES) };
  const SHAPE_FIELDS = {
    rect: [['b', 'b — base (// eje 3)'], ['h', 'h — altura (// eje 2)']],
    circ: [['D', 'D — diámetro']],
    ring: [['D', 'D — diámetro exterior'], ['t', 't — espesor']],
    T: [['bw', 'bw — ancho del alma'], ['h', 'h — altura total'], ['bf', 'bf — ancho de aleta'], ['hf', 'hf — espesor de aleta']],
    I: [['h', 'd — peralte'], ['b', 'bf — ancho de aleta'], ['tf', 'tf — espesor de aleta'], ['tw', 'tw — espesor de alma']],
    tube: [['h', 'h (// eje 2)'], ['b', 'b (// eje 3)'], ['t', 't — espesor']],
    gen: [['A', 'A'], ['Iz', 'I33 = Iz, eje fuerte'], ['Iy', 'I22 = Iy'], ['J', 'J torsión'], ['Asy', 'As2 (0 = sin cortante)'], ['Asz', 'As3']]
  };
  const FIELD_DIM = { A: 'A', Iz: 'I', Iy: 'I', J: 'I', Asy: 'A', Asz: 'A' }; // el resto de campos son longitudes
  const SHAPE_DEFAULTS = { rect: { b: 0.3, h: 0.5 }, circ: { D: 0.5 }, ring: { D: 0.5, t: 0.1 }, T: { bw: 0.3, h: 0.5, bf: 1.2, hf: 0.1 }, I: { h: 0.4, b: 0.2, tf: 0.015, tw: 0.008 }, tube: { h: 0.2, b: 0.2, t: 0.008 }, gen: { A: 0.1, Iz: 0.002, Iy: 0.001, J: 0.002, Asy: 0.083, Asz: 0.083 }, aisc: {} };
  const FAMS = [['W', 'W — alas anchas'], ['M', 'M'], ['S', 'S — American Standard'], ['HP', 'HP — pilotes'], ['C', 'C — canal'], ['MC', 'MC — canal misceláneo'], ['WT', 'WT — tee de W'], ['MT', 'MT'], ['ST', 'ST'], ['L', 'L — ángulo'], ['2L', '2L — ángulo doble'], ['HSS', 'HSS rectangular / cuadrado'], ['HSSR', 'HSS circular'], ['PIPE', 'PIPE — tubería']];
  let aiscCache = null;
  function aiscList() {
    if (!aiscCache) { const K = window.AISC_KEYS || []; aiscCache = (window.AISC_DATA || []).map(r => Object.fromEntries(K.map((k, i) => [k, r[i]]))); }
    return aiscCache;
  }
  App.aiscSection = (name, mat, secName) => {
    const p = aiscList().find(x => x.name === name || x.nameSI === name);
    return p ? { name: secName || p.name, mat, shape: 'aisc', aisc: p.name, p: Object.assign({}, p), mod: {} } : null;
  };

  function drawSection(cv, s) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H); g.fillStyle = '#fbfcfe'; g.fillRect(0, 0, W, H);
    let d; try { d = Solver.secDims(s); } catch (e) { return; }
    const hh = d.h > 0 ? d.h : 0.3, bb = d.b > 0 ? d.b : hh;
    const sc = 0.72 * Math.min(W / bb, H / hh), cx = W / 2, cy = H / 2;
    g.fillStyle = '#93b4f5'; g.strokeStyle = '#1e3a8a'; g.lineWidth = 1.2;
    const R = (z, y, w, h) => { g.beginPath(); g.rect(cx + (z - w / 2) * sc, cy - (y + h / 2) * sc, w * sc, h * sc); g.fill(); g.stroke(); };
    const ring = (D, t) => {
      const ro = D / 2 * sc, ri = Math.max(0, D / 2 - t) * sc, TAU = 2 * Math.PI;
      g.beginPath(); g.moveTo(cx + ro, cy); g.arc(cx, cy, ro, 0, TAU);
      if (t && ri > 0) { g.moveTo(cx + ri, cy); g.arc(cx, cy, ri, 0, TAU); }
      g.fill('evenodd');
      g.beginPath(); g.arc(cx, cy, ro, 0, TAU); g.stroke();
      if (t && ri > 0) { g.beginPath(); g.arc(cx, cy, ri, 0, TAU); g.stroke(); }
    };
    const box = (h, b, t) => { g.beginPath(); g.rect(cx - b / 2 * sc, cy - h / 2 * sc, b * sc, h * sc); g.rect(cx - (b / 2 - t) * sc, cy - (h / 2 - t) * sc, (b - 2 * t) * sc, (h - 2 * t) * sc); g.fill('evenodd'); g.stroke(); };
    const I = (h, b, tf, tw) => { R(0, (h - tf) / 2, b, tf); R(0, -(h - tf) / 2, b, tf); R(0, 0, tw, h - 2 * tf); };
    const shape = s.shape, p = s.p || {};
    if (shape === 'rect') R(0, 0, +s.b, +s.h);
    else if (shape === 'circ') ring(+s.D, 0);
    else if (shape === 'ring') ring(+s.D, +s.t);
    else if (shape === 'T') { R(0, s.h / 2 - s.hf / 2, +s.bf, +s.hf); R(0, -s.hf / 2, +s.bw, s.h - s.hf); }
    else if (shape === 'I') I(+s.h, +s.b, +s.tf, +s.tw);
    else if (shape === 'tube') box(+s.h, +s.b, +s.t);
    else if (shape === 'aisc') {
      const f = p.fam, h = +p.h, b = +p.b, tf = +p.tf, tw = +p.tw, t = +p.t;
      if (['W', 'M', 'S', 'HP'].includes(f)) I(h, b, tf, tw);
      else if (f === 'C' || f === 'MC') { R(-b / 2 + tw / 2, 0, tw, h); R(0, (h - tf) / 2, b, tf); R(0, -(h - tf) / 2, b, tf); }
      else if (['WT', 'MT', 'ST'].includes(f)) { R(0, h / 2 - tf / 2, b, tf); R(0, -tf / 2, tw, h - tf); }
      else if (f === 'HSS') box(h, b, t);
      else if (f === 'HSSR' || f === 'PIPE') ring(h, t);
      else if (f === 'L') { R(-b / 2 + t / 2, 0, t, h); R(0, -h / 2 + t / 2, b, t); }
      else if (f === '2L') { const L = +p.leg || h, gap = 0.01; [-1, 1].forEach(sg => { R(sg * (gap / 2 + t / 2), 0, t, h); R(sg * (gap / 2 + L / 2), -h / 2 + t / 2, L, t); }); }
    } else { g.fillStyle = '#667085'; g.font = '12px Segoe UI'; g.fillText('Sección general', 10, 20); }
    // ejes locales
    g.strokeStyle = '#16a34a'; g.fillStyle = '#16a34a'; g.lineWidth = 1; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(cx, H - 6); g.lineTo(cx, 6); g.stroke(); g.beginPath(); g.moveTo(6, cy); g.lineTo(W - 6, cy); g.stroke(); g.setLineDash([]);
    g.font = 'bold 11px Segoe UI'; g.fillText('2', cx + 4, 14); g.fillText('3', W - 14, cy - 4);
    g.fillStyle = '#475467'; g.font = '11px Segoe UI'; g.fillText(`${+U.v(hh, 'L').toPrecision(4)} × ${+U.v(bb, 'L').toPrecision(4)} ${U.u('L')}`, 6, H - 6);
  }

  function dlgSections() {
    let work = JSON.parse(JSON.stringify(App.model.sections));
    let cur = 0, fam = 'W', query = '', useSI = false;
    const matOf = s => App.model.materials.find(m => m.name === s.mat) || App.model.materials[0];
    const uniq = n => { let s = n, k = 2; while (work.some(x => x.name === s)) s = `${n} (${k++})`; return s; };
    const setShape = (s, sh) => { for (const k of ['b', 'h', 'D', 't', 'bw', 'bf', 'hf', 'tf', 'tw', 'A', 'Iz', 'Iy', 'J', 'Asy', 'Asz', 'aisc', 'p']) delete s[k]; s.shape = sh; Object.assign(s, JSON.parse(JSON.stringify(SHAPE_DEFAULTS[sh]))); };
    const fillList = () => {
      const sel = Q('#aList'); if (!sel) return;
      const q = query.trim().toUpperCase().replace(/\s+/g, '');
      const s = work[cur];
      const items = aiscList().filter(p => p.fam === fam && (!q || p.name.toUpperCase().replace(/\s+/g, '').includes(q) || String(p.nameSI).toUpperCase().includes(q)));
      sel.innerHTML = items.map(p => `<option value="${esc(p.name)}" ${s && s.aisc === p.name ? 'selected' : ''}>${esc(useSI ? p.nameSI : p.name)}   ·   ${esc(useSI ? p.name : p.nameSI)}   ·   ${p.kgm} kg/m</option>`).join('');
      Q('#aCount').textContent = items.length + ' perfiles';
    };
    const redraw = () => {
      const s = work[cur];
      const mat = s ? matOf(s) : null, mtype = mat ? mat.type || 'other' : 'other';
      let props = null, perr = '';
      if (s && mat) { try { props = Solver.sectionProps(s, mat); } catch (e) { perr = e.message; } }
      const md = s ? Object.assign({ A: 1, Iy: 1, Iz: 1, J: 1, As: 1, M: 1, W: 1 }, s.mod || {}) : {};
      const shapes = SHAPES_BY_TYPE[mtype] || SHAPES_BY_TYPE.other;
      $('dlgBody').innerHTML = `<div style="display:grid;grid-template-columns:210px 1fr 230px;gap:12px;min-width:860px">
        <div><div class="tblwrap" style="max-height:420px"><table class="t" style="width:100%">${work.map((x, i) => `<tr class="${i === cur ? 'sel' : ''}"><td class="l" data-pick="${i}" style="cursor:pointer">${esc(x.name)}</td></tr>`).join('')}</table></div>
          <div class="btns" style="margin-top:6px"><button id="sAddC">+ Concreto</button><button id="sAddS">+ Acero</button></div>
          <div class="btns" style="margin-top:4px"><button id="sDup" class="small">Duplicar</button><button id="sDel" class="small">Eliminar</button></div></div>
        <div>${!s ? '<p class="note">Sin secciones</p>' : `
          <div class="grid2">
            <label>Nombre</label><input id="sName" value="${esc(s.name)}" style="width:220px">
            <label>Material</label><select id="sMat">${App.model.materials.map(m => `<option value="${esc(m.name)}" ${m.name === s.mat ? 'selected' : ''}>${esc(m.name)} (${MAT_TYPES[m.type] || ''})</option>`).join('')}</select>
            <label>Tipo de sección</label><select id="sShape">${shapes.map(k => `<option value="${k}" ${k === s.shape ? 'selected' : ''}>${SHAPES[k]}</option>`).join('')}${shapes.includes(s.shape) ? '' : `<option value="${s.shape}" selected>${SHAPES[s.shape]} (no típica para ${MAT_TYPES[mtype]})</option>`}</select>
            ${s.shape === 'aisc' ? '' : SHAPE_FIELDS[s.shape].map(([k, t]) => { const dm = FIELD_DIM[k] || 'L'; return `<label>${t} (${uL(dm)})</label><input data-f="${k}" value="${s[k] == null ? '' : uIn(s[k], dm)}">`; }).join('')}
          </div>
          ${s.shape === 'aisc' ? `
            <fieldset style="margin-top:8px"><legend>Base de datos AISC v16.0 ${s.aisc ? '— seleccionado: <b>' + esc(s.aisc) + '</b> (' + esc(s.p.nameSI) + ')' : ''}</legend>
              <div class="row"><select id="aFam">${FAMS.map(([k, t]) => `<option value="${k}" ${k === fam ? 'selected' : ''}>${t}</option>`).join('')}</select>
                <input id="aQ" placeholder="Buscar: W14X22, W360, HSS8X8…" value="${esc(query)}" style="width:190px">
                <label><input type="checkbox" id="aSI" ${useSI ? 'checked' : ''}> Nombres métricos</label> <span class="note" id="aCount"></span></div>
              <select id="aList" size="11" style="width:100%;font-family:Consolas,monospace;font-size:12px"></select>
              <p class="note">Eje 2 = peralte (Ix AISC → I33), eje 3 = ancho (Iy AISC → I22). Para girar el perfil usa el ángulo β del elemento. Ángulos L/2L: ejes geométricos.</p>
            </fieldset>` : ''}
          <fieldset style="margin-top:8px"><legend>Modificadores de propiedades (agrietamiento NSR-10: vigas 0.35·I, columnas 0.70·I)</legend>
            <div class="row">${[['A', 'A'], ['Iz', 'I33'], ['Iy', 'I22'], ['J', 'J'], ['As', 'As'], ['M', 'Masa'], ['W', 'Peso']].map(([k, t]) => `<label>${t}</label><input data-m="${k}" value="${md[k]}" style="width:48px">`).join('')}</div>
            <div class="btns"><button class="small" data-pm="beam">Viga concreto (0.35)</button><button class="small" data-pm="col">Columna concreto (0.70)</button><button class="small" data-pm="none">Sin modificar (1.0)</button></div>
          </fieldset>
          ${props ? `<table class="t" style="margin-top:6px"><tr><th>A (${uL('A')})</th><th>I33 (${uL('I')})</th><th>I22 (${uL('I')})</th><th>J (${uL('I')})</th><th>As2 (${uL('A')})</th><th>As3 (${uL('A')})</th><th>Peso (${uL('FL')})</th></tr>
            <tr><td>${uF(props.A, 'A', 4)}</td><td>${uF(props.Iz, 'I', 4)}</td><td>${uF(props.Iy, 'I', 4)}</td><td>${uF(props.J, 'I', 4)}</td><td>${uF(props.Asy, 'A', 4)}</td><td>${uF(props.Asz, 'A', 4)}</td><td>${uF(props.gamma * props.Ag * props.mW, 'FL', 4)}</td></tr></table>
            <p class="note">Propiedades efectivas (incluyen modificadores). E = ${uF(props.E, 'S', 1)} ${uL('S')}, G = ${uF(props.G, 'S', 1)} ${uL('S')}${mat.type === 'steel' ? `, Fy = ${uF(mat.Fy * 1000, 'S', 2)} ${uL('S')}, Fu = ${uF(mat.Fu * 1000, 'S', 2)} ${uL('S')}` : mat.type === 'concrete' ? `, f'c = ${uF(mat.fc * 1000, 'S', 2)} ${uL('S')}` : ''}.</p>` : `<p class="err">${esc(perr)}</p>`}
        `}</div>
        <div>${s ? '<canvas id="sCv" width="230" height="230" style="border:1px solid var(--line);border-radius:6px"></canvas>' : ''}
          ${s && s.shape === 'aisc' && s.p && s.p.A ? `<table class="t" style="margin-top:6px;width:100%">${[['d / h', s.p.h, 'L'], ['bf / b', s.p.b, 'L'], ['tw', s.p.tw, 'L'], ['tf', s.p.tf, 'L'], ['t (diseño)', s.p.t, 'L'], ['Zx', s.p.Zx, 'L3'], ['Sx', s.p.Sx, 'L3'], ['Zy', s.p.Zy, 'L3'], ['rx', s.p.rx, 'L'], ['ry', s.p.ry, 'L'], ['Peso', s.p.kgm != null ? s.p.kgm * Solver.GRAV / 1000 : null, 'FL']].filter(r => r[1] != null).map(([t, v, dm]) => `<tr><td class="l">${t}</td><td>${uF(v, dm, 4)} ${uL(dm)}</td></tr>`).join('')}</table>` : ''}</div></div>`;
      if (s) drawSection(Q('#sCv'), s);
      QA('[data-pick]').forEach(td => td.onclick = () => { cur = +td.dataset.pick; const x = work[cur]; if (x.shape === 'aisc' && x.p) fam = x.p.fam; redraw(); });
      const addOf = type => { const m = App.model.materials.find(x => x.type === type); if (!m) { alert(`Primero crea un material de tipo ${MAT_TYPES[type]} en "Materiales".`); return; }
        const s2 = { name: '', mat: m.name, mod: {} }; setShape(s2, type === 'steel' ? 'aisc' : 'rect'); s2.name = uniq(type === 'steel' ? 'PERFIL' : 'SECCIÓN ' + (work.length + 1)); work.push(s2); cur = work.length - 1; redraw(); };
      Q('#sAddC').onclick = () => addOf('concrete'); Q('#sAddS').onclick = () => addOf('steel');
      Q('#sDup').onclick = () => { if (!s) return; const c = JSON.parse(JSON.stringify(s)); delete c._old; c.name = uniq(s.name + ' copia'); work.push(c); cur = work.length - 1; redraw(); };
      Q('#sDel').onclick = () => { if (!s) return; if (App.model.elements.some(e => e.sec === (s._old || s.name))) { alert('La sección está asignada a elementos'); return; } work.splice(cur, 1); cur = 0; redraw(); };
      if (!s) return;
      Q('#sName').onchange = e => { s._old = s._old || s.name; s.name = e.target.value.trim() || s.name; redraw(); };
      Q('#sMat').onchange = e => { s.mat = e.target.value; const t = matOf(s).type || 'other'; if (!(SHAPES_BY_TYPE[t] || []).includes(s.shape)) setShape(s, SHAPES_BY_TYPE[t][0]); redraw(); };
      Q('#sShape').onchange = e => { setShape(s, e.target.value); redraw(); };
      QA('[data-f]').forEach(i => i.onchange = () => { s[i.dataset.f] = uRead(i.value, FIELD_DIM[i.dataset.f] || 'L'); redraw(); });
      QA('[data-m]').forEach(i => i.onchange = () => { s.mod = s.mod || {}; s.mod[i.dataset.m] = num(i.value, 1); redraw(); });
      QA('[data-pm]').forEach(b => b.onclick = () => { const f = { beam: 0.35, col: 0.7, none: 1 }[b.dataset.pm]; s.mod = Object.assign(s.mod || {}, { Iz: f, Iy: f }); redraw(); });
      if (s.shape === 'aisc') {
        fillList();
        Q('#aFam').onchange = e => { fam = e.target.value; fillList(); };
        Q('#aQ').oninput = e => { query = e.target.value; fillList(); };
        Q('#aSI').onchange = e => { useSI = e.target.checked; fillList(); };
        Q('#aList').onchange = e => {
          const p = aiscList().find(x => x.name === e.target.value); if (!p) return;
          const autoName = !s.aisc || s.name === s.aisc || s.name === (s.p && s.p.nameSI) || /^PERFIL/.test(s.name);
          s.aisc = p.name; s.p = Object.assign({}, p);
          if (autoName) { s._old = s._old || s.name; s.name = uniq(useSI ? p.nameSI : p.name); }
          const keepScroll = Q('#aList').scrollTop; redraw(); const l = Q('#aList'); if (l) l.scrollTop = keepScroll;
        };
      }
    };
    dialog('Secciones', '', [{ text: 'Cancelar' }, {
      text: 'Aceptar', primary: true, click: () => {
        if (new Set(work.map(s => s.name)).size !== work.length) { alert('Nombres de sección repetidos'); return false; }
        const bad = work.find(s => s.shape === 'aisc' && !s.aisc); if (bad) { alert(`La sección "${bad.name}" no tiene un perfil AISC elegido`); return false; }
        App.pushUndo();
        for (const s of work) if (s._old && s._old !== s.name) App.model.elements.forEach(e => { if (e.sec === s._old) e.sec = s.name; });
        work.forEach(s => delete s._old);
        App.model.sections = work; App.changed();
      }
    }]);
    redraw();
  }

  // ------------------------------------------------------------------
  // Patrones de carga
  // ------------------------------------------------------------------
  const PAT_TYPES = [['D', 'Muerta (D)'], ['L', 'Viva (L)'], ['Lr', 'Viva de cubierta (Lr)'], ['G', 'Granizo (G)'], ['W', 'Viento (W)'], ['H', 'Empuje de suelo (H)'], ['O', 'Otra']];
  function guessPatType(p) {
    if (p.type) return p.type;
    const n = p.name.toLowerCase();
    if (/cubierta|techo|\blr\b/.test(n)) return 'Lr';
    if (/viva|\bl\b|live/.test(n)) return 'L';
    if (/muerta|\bd\b|dead|propio|sobreimpuesta|acabado/.test(n)) return 'D';
    if (/viento|\bw\b|wind/.test(n)) return 'W';
    if (/granizo/.test(n)) return 'G';
    if (/empuje|suelo/.test(n)) return 'H';
    return 'O';
  }
  function dlgPatterns() {
    let work = JSON.parse(JSON.stringify(App.model.patterns));
    work.forEach(p => p.type = guessPatType(p));
    const redraw = () => {
      $('dlgBody').innerHTML = `<table class="t"><tr><th class="l">Patrón</th><th class="l">Tipo</th><th>Multiplicador peso propio</th><th></th></tr>
        ${work.map((p, i) => `<tr><td><input data-i="${i}" data-k="name" value="${esc(p.name)}" style="width:150px"></td>
          <td><select data-i="${i}" data-k="type">${PAT_TYPES.map(([k, t]) => `<option value="${k}" ${k === p.type ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
          <td><input data-i="${i}" data-k="selfWeight" value="${p.selfWeight}"></td><td><button class="small" data-del="${i}">✕</button></td></tr>`).join('')}</table>
        <div class="row" style="margin-top:6px"><button id="pAdd">+ Patrón</button></div>
        <p class="note">Cada patrón se resuelve por separado con la misma matriz de rigidez. Multiplicador 1 = incluye el peso propio de los elementos (γ·A).<br>
        El <b>tipo</b> se usa para generar automáticamente las combinaciones de la NSR-10 (B.2.4) en el botón "Combinaciones".</p>`;
      QA('[data-k]').forEach(inp => inp.onchange = () => {
        const p = work[+inp.dataset.i], k = inp.dataset.k;
        if (k === 'name') { p._old = p._old || p.name; p.name = inp.value; } else if (k === 'type') p.type = inp.value; else p.selfWeight = num(inp.value);
      });
      QA('[data-del]').forEach(b => b.onclick = () => { work.splice(+b.dataset.del, 1); redraw(); });
      Q('#pAdd').onclick = () => { work.push({ name: 'Patrón ' + (work.length + 1), type: 'O', selfWeight: 0 }); redraw(); };
    };
    dialog('Patrones de carga', '', [{ text: 'Cancelar' }, {
      text: 'Aceptar', primary: true, click: () => {
        if (new Set(work.map(p => p.name)).size !== work.length) { alert('Nombres de patrón repetidos'); return false; }
        App.pushUndo();
        const m = App.model;
        for (const p of work) if (p._old) {
          const o = p._old;
          m.nodalLoads.forEach(l => { if (l.pat === o) l.pat = p.name; }); m.elemLoads.forEach(l => { if (l.pat === o) l.pat = p.name; }); m.massSource.patterns.forEach(l => { if (l.pat === o) l.pat = p.name; });
          (m.combos || []).forEach(c => { (c.terms || []).forEach(t => { if (t.pat === o) t.pat = p.name; }); c.members = (c.members || []).map(x => x === o ? p.name : x); });
          delete p._old;
        }
        const names = new Set(work.map(p => p.name));
        m.nodalLoads = m.nodalLoads.filter(l => names.has(l.pat)); m.elemLoads = m.elemLoads.filter(l => names.has(l.pat));
        (m.combos || []).forEach(c => { c.terms = (c.terms || []).filter(t => t.dir || names.has(t.pat)); });
        m.patterns = work; App.changed();
      }
    }]);
    redraw();
  }

  // ------------------------------------------------------------------
  // Combinaciones de carga
  // ------------------------------------------------------------------
  function comboText(c) {
    if (c.kind === 'envelope') return 'Envolvente de: ' + (c.members || []).join(', ');
    const parts = (c.terms || []).filter(t => +t.f).map(t => `${+(+t.f).toFixed(3)}·${t.dir ? '(±Sismo ' + t.dir + ')' : t.pat}`);
    return parts.join(' + ') || '(vacía)';
  }
  function generateNSR() {
    const m = App.model, pats = m.patterns;
    const by = t => pats.filter(p => guessPatType(p) === t).map(p => p.name);
    const D = by('D'), L = by('L'), Lr = by('Lr'), G = by('G'), W = by('W'), H = by('H');
    const E = m.mode === '2D' ? [[['X', 1]]] : [[['X', 1], ['Y', 0.3]], [['X', 0.3], ['Y', 1]]];
    const roof = [Lr.length ? ['Lr', Lr] : null, G.length ? ['G', G] : null].filter(Boolean);
    const out = [], seen = new Set();
    const add = (id, parts, eTerms) => {
      const terms = [];
      for (const [names, f] of parts) for (const n of names) if (f) terms.push({ pat: n, f });
      for (const [d, f] of eTerms || []) terms.push({ dir: d, f });
      if (!terms.length) return;
      const key = terms.map(t => (t.pat || 'E' + t.dir) + t.f).sort().join('|'); if (seen.has(key)) return; seen.add(key);
      const c = { name: '', kind: 'linear', terms }; c.name = `${id}: ${comboText(c).replace(/·/g, ' ').replace(/\(±Sismo (\w)\)/g, 'E$1')}`;
      out.push(c);
    };
    if (!D.length) { alert('Asigna el tipo "Muerta (D)" a al menos un patrón (botón Patrones de carga).'); return null; }
    add('U1', [[D, 1.4]]);
    if (roof.length) roof.forEach(([, R]) => add('U2', [[D, 1.2], [L, 1.6], [R, 0.5], [H, 1.6]])); else add('U2', [[D, 1.2], [L, 1.6], [H, 1.6]]);
    roof.forEach(([, R]) => { add('U3', [[D, 1.2], [R, 1.6], [L, 1.0]]); if (W.length) add('U3', [[D, 1.2], [R, 1.6], [W, 0.5]]); });
    if (W.length) { if (roof.length) roof.forEach(([, R]) => add('U4', [[D, 1.2], [W, 1.0], [L, 1.0], [R, 0.5]])); else add('U4', [[D, 1.2], [W, 1.0], [L, 1.0]]); }
    E.forEach(e => add('U5', [[D, 1.2], [L, 1.0]], e));
    if (W.length) add('U6', [[D, 0.9], [W, 1.0], [H, 1.6]]);
    E.forEach(e => add('U7', [[D, 0.9], [H, 1.6]], e));
    const env = { name: 'ENVOLVENTE NSR-10', kind: 'envelope', members: out.map(c => c.name) };
    const serv = [];
    if (L.length) serv.push({ name: 'S1: D + L (servicio)', kind: 'linear', terms: D.map(n => ({ pat: n, f: 1 })).concat(L.map(n => ({ pat: n, f: 1 }))) });
    return out.concat([env], serv);
  }
  function dlgCombos() {
    let work = JSON.parse(JSON.stringify(App.model.combos || []));
    let cur = 0;
    const is2D = App.model.mode === '2D', dirs = is2D ? ['X'] : ['X', 'Y'];
    const uniq = n => { let s = n, k = 2; while (work.some(x => x.name === s)) s = `${n} (${k++})`; return s; };
    const redraw = () => {
      const c = work[cur];
      const pats = App.model.patterns;
      const candidates = pats.map(p => p.name).concat(dirs.map(d => 'Sismo ' + d + ' (espectral)')).concat(work.filter(x => x !== c).map(x => x.name));
      $('dlgBody').innerHTML = `<div style="display:grid;grid-template-columns:270px 1fr;gap:14px;min-width:820px">
        <div><div class="tblwrap" style="max-height:400px"><table class="t" style="width:100%">${work.map((x, i) => `<tr class="${i === cur ? 'sel' : ''}"><td class="l" data-pick="${i}" style="cursor:pointer">${esc(x.name)}</td><td class="l"><span class="pill">${x.kind === 'envelope' ? 'Envolv.' : 'Lineal'}</span></td></tr>`).join('') || '<tr><td class="l note">Sin combinaciones</td></tr>'}</table></div>
          <div class="btns" style="margin-top:6px"><button id="cAdd">+ Lineal</button><button id="cEnv">+ Envolvente</button></div>
          <div class="btns" style="margin-top:4px"><button id="cDup" class="small">Duplicar</button><button id="cDel" class="small">Eliminar</button><button id="cClr" class="small">Borrar todas</button></div>
          <div class="btns" style="margin-top:8px"><button id="cNSR" class="primary">Generar NSR-10 (B.2.4)</button></div>
          <p class="note">El generador usa el <b>tipo</b> de cada patrón (D, L, Lr, G, W, H) y el sismo espectral (E = Fs/R) con la regla 100 % + 30 % en 3D (NSR-10 A.3.6.3).</p></div>
        <div>${!c ? '<p class="note">Crea una combinación o usa el generador.</p>' : `
          <div class="grid2"><label>Nombre</label><input id="cName" value="${esc(c.name)}" style="width:320px">
            <label>Tipo</label><span>${c.kind === 'envelope' ? 'Envolvente (máximos y mínimos de varios casos)' : 'Lineal (suma de patrones × factor)'}</span></div>
          ${c.kind === 'envelope' ? `
            <fieldset style="margin-top:8px"><legend>Casos incluidos</legend>
              <div class="tblwrap" style="max-height:300px">${candidates.map(nm => `<label style="display:block"><input type="checkbox" data-mem="${esc(nm)}" ${(c.members || []).includes(nm) ? 'checked' : ''}> ${esc(nm)}</label>`).join('')}</div>
            </fieldset>` : `
            <fieldset style="margin-top:8px"><legend>Factores</legend>
              <table class="t"><tr><th class="l">Patrón / caso</th><th class="l">Tipo</th><th>Factor</th></tr>
              ${pats.map(p => { const t = (c.terms || []).find(x => x.pat === p.name); return `<tr><td class="l">${esc(p.name)}</td><td class="l">${guessPatType(p)}</td><td><input data-pat="${esc(p.name)}" value="${t ? t.f : 0}"></td></tr>`; }).join('')}
              ${dirs.map(d => { const t = (c.terms || []).find(x => x.dir === d); return `<tr><td class="l">Sismo ${d} (espectral, ±)</td><td class="l">E</td><td><input data-dir="${d}" value="${t ? t.f : 0}"></td></tr>`; }).join('')}
              </table>
              <p class="note">El sismo espectral entra con signo ± (resultado = estático ± |factor|·E), por eso las combinaciones con sismo dan máximo y mínimo. E ya está dividido por R y, si lo activaste, escalado al cortante mínimo.</p>
            </fieldset>`}
          <p><b>Expresión:</b> ${esc(comboText(c))}</p>`}
        </div></div>`;
      QA('[data-pick]').forEach(td => td.onclick = () => { cur = +td.dataset.pick; redraw(); });
      Q('#cAdd').onclick = () => { work.push({ name: uniq('COMB' + (work.length + 1)), kind: 'linear', terms: App.model.patterns.map(p => ({ pat: p.name, f: 1 })) }); cur = work.length - 1; redraw(); };
      Q('#cEnv').onclick = () => { work.push({ name: uniq('ENV' + (work.length + 1)), kind: 'envelope', members: work.filter(x => x.kind !== 'envelope').map(x => x.name) }); cur = work.length - 1; redraw(); };
      Q('#cDup').onclick = () => { if (!c) return; const d = JSON.parse(JSON.stringify(c)); d.name = uniq(c.name + ' copia'); work.push(d); cur = work.length - 1; redraw(); };
      Q('#cDel').onclick = () => { if (!c) return; work.splice(cur, 1); work.forEach(x => { if (x.members) x.members = x.members.filter(n => n !== c.name); }); cur = Math.max(0, cur - 1); redraw(); };
      Q('#cClr').onclick = () => { if (work.length && confirm('¿Borrar todas las combinaciones?')) { work = []; cur = 0; redraw(); } };
      Q('#cNSR').onclick = () => {
        const g = generateNSR(); if (!g) return;
        if (work.length && !confirm('Se reemplazarán las combinaciones actuales por las de la NSR-10. ¿Continuar?')) return;
        work = g; cur = 0; redraw();
      };
      if (!c) return;
      Q('#cName').onchange = e => { const old = c.name, nw = e.target.value.trim() || old; c.name = uniq(nw === old ? old : nw); if (c.name !== old) work.forEach(x => { if (x.members) x.members = x.members.map(n => n === old ? c.name : n); }); redraw(); };
      QA('[data-pat],[data-dir]').forEach(i => i.onchange = () => {
        c.terms = QA('[data-pat]').map(x => ({ pat: x.dataset.pat, f: num(x.value) })).concat(QA('[data-dir]').map(x => ({ dir: x.dataset.dir, f: num(x.value) }))).filter(t => t.f);
        redraw();
      });
      QA('[data-mem]').forEach(i => i.onchange = () => { c.members = QA('[data-mem]').filter(x => x.checked).map(x => x.dataset.mem); redraw(); });
    };
    dialog('Combinaciones de carga', '', [{ text: 'Cancelar' }, {
      text: 'Aceptar', primary: true, click: () => {
        if (new Set(work.map(c => c.name)).size !== work.length) { alert('Nombres de combinación repetidos'); return false; }
        App.pushUndo(); App.model.combos = work; App.changed();
      }
    }]);
    redraw();
  }

  // ------------------------------------------------------------------
  // Fuente de masa
  // ------------------------------------------------------------------
  function dlgMass() {
    const ms = App.model.massSource;
    dialog('Fuente de masa (análisis modal)', `
      <label><input type="checkbox" id="msSW" ${ms.selfWeight ? 'checked' : ''}> Incluir masa propia de los elementos (γ·A·L / g, concentrada en los nodos)</label>
      <fieldset style="margin-top:8px"><legend>Masa a partir de cargas (cargas gravitacionales / g)</legend>
        <table class="t"><tr><th class="l">Patrón</th><th>Factor</th></tr>
        ${App.model.patterns.map(p => { const f = (ms.patterns.find(x => x.pat === p.name) || {}).factor || 0; return `<tr><td class="l">${esc(p.name)}</td><td><input data-p="${esc(p.name)}" value="${f}"></td></tr>`; }).join('')}</table>
        <p class="note">Solo toma las cargas aplicadas (nodales y de elemento) hacia abajo; el peso propio del patrón NO se cuenta aquí para no duplicarlo. Ej.: Muerta 1.0, Viva 0.25.</p>
      </fieldset>
      <label><input type="checkbox" id="msV" ${ms.vertical ? 'checked' : ''}> Incluir masa en dirección vertical (Z)</label>
      <p class="note">También puedes asignar masa adicional por nodo desde el panel "Asignar". Unidades de masa actuales: ${uL('m')} (fuerza·s²/longitud).</p>`, [
      { text: 'Cancelar' },
      {
        text: 'Aceptar', primary: true, click: () => {
          App.pushUndo();
          ms.selfWeight = Q('#msSW').checked; ms.vertical = Q('#msV').checked;
          ms.patterns = QA('[data-p]').map(i => ({ pat: i.dataset.p, factor: num(i.value) })).filter(x => x.factor);
          App.changed();
        }
      }]);
  }

  // ------------------------------------------------------------------
  // Espectro y opciones modales
  // ------------------------------------------------------------------
  function dlgSpectrum() {
    const sp = App.model.spectrum, mo = App.model.modalOpts;
    dialog('Análisis modal y espectral', `
      <div style="display:grid;grid-template-columns:1fr 340px;gap:14px">
      <div>
        <fieldset><legend>Análisis modal (vectores Eigen)</legend>
          <div class="grid2"><label>Número de modos</label><input id="spN" type="number" value="${mo.nModes}"></div>
          <p class="note">Si pides más modos que GDL con masa, se calculan todos.</p>
        </fieldset>
        <fieldset><legend>Espectro de diseño</legend>
          <label><input type="radio" name="spT" value="NSR10" ${sp.type !== 'user' ? 'checked' : ''}> NSR-10 (A.2.6)</label>
          <label><input type="radio" name="spT" value="user" ${sp.type === 'user' ? 'checked' : ''}> Definido por el usuario</label>
          <div class="grid2" style="margin-top:6px">
            <label>Aa</label><input id="spAa" value="${sp.Aa}"> <label>Av</label><input id="spAv" value="${sp.Av}">
            <label>Fa</label><input id="spFa" value="${sp.Fa}"> <label>Fv</label><input id="spFv" value="${sp.Fv}">
            <label>Coef. importancia I</label><input id="spI" value="${sp.I}">
          </div>
          <label><input type="checkbox" id="spLow" ${sp.lowBranch ? 'checked' : ''}> Rama ascendente para T &lt; T0 en modos distintos al fundamental (Ec. A.2.6-7)</label>
          <div style="margin-top:6px"><label>Tabla usuario (T [s]  Sa [g], una pareja por línea)</label>
          <textarea id="spTab" rows="5">${(sp.table || []).map(r => r.join('  ')).join('\n')}</textarea></div>
        </fieldset>
        <fieldset><legend>Combinación y diseño</legend>
          <div class="grid2">
            <label>Combinación modal</label><select id="spC"><option ${sp.comb === 'CQC' ? 'selected' : ''}>CQC</option><option ${sp.comb === 'SRSS' ? 'selected' : ''}>SRSS</option></select>
            <label>Amortiguamiento ξ</label><input id="spXi" value="${sp.xi}">
            <label>R (= φa·φp·φr·R0) para fuerzas</label><input id="spR" value="${sp.R}">
            <label>Cortante mínimo (% de FHE)</label><input id="spMin" value="${sp.minShearPct}">
            <label>Escalar fuerzas al mínimo</label><input type="checkbox" id="spApp" ${sp.applyScale ? 'checked' : ''}>
            <label>Deriva límite (% h)</label><input id="spDr" value="${App.model.driftLimit}">
          </div>
          <p class="note">Desplazamientos y derivas se reportan elásticos (sin dividir por R), como exige NSR-10 A.6. Fuerzas en elementos, reacciones y cortantes se dividen por R. FHE: Vs = Sa(T₁)·g·M con el periodo del modo dominante.</p>
        </fieldset>
      </div>
      <div><canvas id="spCv" width="340" height="240" style="border:1px solid var(--line);border-radius:6px"></canvas>
      <div id="spInfo" class="note"></div></div></div>`, [
      { text: 'Cancelar' },
      { text: 'Aceptar', primary: true, click: () => { App.pushUndo(); read(App.model.spectrum); App.model.modalOpts.nModes = Math.max(1, Math.round(num(Q('#spN').value, 12))); App.model.driftLimit = num(Q('#spDr').value, 1); App.changed(); } }],
      () => { QA('input,select,textarea').forEach(i => i.addEventListener('input', plot)); plot(); });
    function read(o) {
      o.type = Q('input[name=spT]:checked').value;
      for (const [k, id] of [['Aa', 'spAa'], ['Av', 'spAv'], ['Fa', 'spFa'], ['Fv', 'spFv'], ['I', 'spI'], ['xi', 'spXi'], ['R', 'spR'], ['minShearPct', 'spMin']]) o[k] = num(Q('#' + id).value);
      o.lowBranch = Q('#spLow').checked; o.applyScale = Q('#spApp').checked; o.comb = Q('#spC').value;
      o.table = Q('#spTab').value.split('\n').map(l => l.trim().split(/[\s,;]+/).map(Number)).filter(r => r.length >= 2 && r.every(isFinite));
      return o;
    }
    function plot() {
      const o = read({}); const cv = Q('#spCv'); const g = cv.getContext('2d');
      g.clearRect(0, 0, 340, 240); g.fillStyle = '#fff'; g.fillRect(0, 0, 340, 240);
      const Tm = 4, pts = []; let mx = 0;
      for (let i = 0; i <= 200; i++) { const T = Tm * i / 200, s = Solver.spectrumSa(T, o, o.lowBranch); pts.push([T, s]); mx = Math.max(mx, s); }
      mx = mx || 1;
      const X = t => 36 + t / Tm * 290, Y = s => 210 - s / mx * 190;
      g.strokeStyle = '#d6dbe3'; g.font = '10px Segoe UI'; g.fillStyle = '#667085';
      for (let t = 0; t <= Tm; t++) { g.beginPath(); g.moveTo(X(t), 20); g.lineTo(X(t), 210); g.stroke(); g.fillText(t + ' s', X(t) - 6, 224); }
      for (let k = 0; k <= 4; k++) { const s = mx * k / 4; g.beginPath(); g.moveTo(36, Y(s)); g.lineTo(326, Y(s)); g.stroke(); g.fillText(s.toFixed(2), 4, Y(s) + 3); }
      g.strokeStyle = '#2563eb'; g.lineWidth = 2; g.beginPath(); pts.forEach(([t, s], i) => i ? g.lineTo(X(t), Y(s)) : g.moveTo(X(t), Y(s))); g.stroke();
      g.fillStyle = '#1d2430'; g.fillText('Sa (g)', 4, 12);
      if (App.modal) { g.fillStyle = '#dc2626'; App.modal.modes.forEach(m => { if (m.T <= Tm) { g.beginPath(); g.arc(X(m.T), Y(Solver.spectrumSa(m.T, o, false)), 3, 0, 7); g.fill(); } }); }
      if (o.type !== 'user') { const p = Solver.nsrParams(o); Q('#spInfo').innerHTML = `T0 = ${p.T0.toFixed(3)} s · TC = ${p.TC.toFixed(3)} s · TL = ${p.TL.toFixed(2)} s<br>Meseta Sa = 2.5·Aa·Fa·I = ${(2.5 * o.Aa * o.Fa * o.I).toFixed(3)} g`; }
      else Q('#spInfo').textContent = 'Espectro definido por el usuario (interpolación lineal).';
    }
  }

  // ------------------------------------------------------------------
  // Opciones de análisis
  // ------------------------------------------------------------------
  function dlgOptions() {
    const s = App.model.settings;
    dialog('Opciones de análisis', `
      <label><input type="checkbox" id="oSh" ${s.shear !== false ? 'checked' : ''}> Incluir deformación por cortante (viga de Timoshenko, φ = 12EI / (G·As·L²))</label>
      <fieldset style="margin-top:8px"><legend>Nudos (compatibilidad con ETABS / SAP2000)</legend>
        <label><input type="checkbox" id="oAO" ${s.autoOffsets !== false ? 'checked' : ''}> Brazos de extremo automáticos desde la conectividad (dimensiones de los elementos que llegan al nudo)</label><br>
        <label><input type="checkbox" id="oCM" ${s.beamClearMass !== false ? 'checked' : ''}> Peso propio y masa de vigas solo en la luz libre entre caras (el concreto del nudo lo aporta la columna)</label>
        <p class="note">Con ambas opciones activas y factor de zona rígida 0 el programa reproduce la configuración por defecto de ETABS. Un brazo manual (&gt; 0) asignado a un elemento reemplaza al automático.
        Las vigas horizontales se insertan por defecto colgadas del nudo (punto 8, superior centro), como en ETABS: la columna queda rígida en la altura de la viga por debajo del piso.</p>
        <div class="row"><button class="small" id="oClrOff">Volver todos los brazos a automático</button> <span class="note" id="oClrMsg"></span></div>
      </fieldset>
      <div class="grid2" style="margin-top:8px">
        <label>Factor de zona rígida (0–1)</label><input id="oRf" value="${s.rigidFactor}">
        <label>Dibujo libre fuera del grid: paso de malla (${uL('L')}). 0 = desactivado (solo grid y nodos)</label><input id="oSn" value="${uIn(s.snap || 0, 'L')}">
      </div>
      <p class="note"><b>Formulación incluida:</b> deformación axial, flexión en dos planos, torsión (3D), deformación por cortante, brazos rígidos en los extremos (longitud flexible L − a − b, transformación de excentricidad), liberaciones de extremo por condensación estática, modificadores de propiedades (agrietamiento), diafragmas rígidos por restricción maestro-esclavo (UX, UY, RZ en el centro de masa; en 2D UX igual por nivel), condensación estática de GDL sin masa para el análisis modal, y cargas exactas de empotramiento con cortante.</p>`, [
      { text: 'Cancelar' },
      { text: 'Aceptar', primary: true, click: () => { App.pushUndo(); s.shear = Q('#oSh').checked; s.autoOffsets = Q('#oAO').checked; s.beamClearMass = Q('#oCM').checked; s.rigidFactor = Math.min(1, Math.max(0, num(Q('#oRf').value, 1))); s.snap = uRead(Q('#oSn').value, 'L'); App.changed(); } }],
      () => {
        const nMan = App.model.elements.filter(e => +e.offI > 0 || +e.offJ > 0).length;
        Q('#oClrMsg').textContent = nMan ? `${nMan} elemento(s) con brazos manuales` : 'Todos los brazos son automáticos';
        Q('#oClrOff').onclick = () => {
          App.pushUndo(); App.model.elements.forEach(e => { e.offI = 0; e.offJ = 0; });
          Q('#oClrMsg').textContent = 'Listo: todos los brazos son automáticos'; App.changed();
        };
      });
  }

  function dlgHelp() {
    dialog('Ayuda rápida', `<div class="note" style="max-width:720px;color:var(--text);line-height:1.55">
      <b>Flujo de trabajo</b>
      <ol>
        <li><b>Nuevo</b>: elige 2D o 3D y, si quieres, genera un pórtico regular con su grid.</li>
        <li><b>Grids</b>: define ejes X, Y y niveles Z (y grid radial en 3D).</li>
        <li><b>Dibujar elemento</b> (<kbd>D</kbd>): clic en intersecciones del grid o en nodos. Se encadena; <kbd>Esc</kbd>/clic derecho termina. También puedes crear nodos y elementos por coordenadas en el panel derecho.</li>
        <li><b>Seleccionar</b> (<kbd>S</kbd>): clic o ventana (izq→der: dentro; der→izq: cruce). <kbd>Shift</kbd> agrega. Luego asigna apoyos, cargas, secciones, brazos rígidos, liberaciones, diafragmas o masas.</li>
        <li><b>Analizar</b> y revisa resultados en la vista (deformada, diagramas, modos animados) y en las tablas de abajo.</li>
        <li><b>Excel matricial</b>: k local, λ, λᵀ, k global de cada elemento, K ensamblada, particiones, T, K reducida, cargas, desplazamientos, reacciones y fuerzas. <b>Excel modal</b>: masas, condensación, K condensada, modos, participación, espectro, combinación CQC/SRSS, cortantes y derivas.</li>
      </ol>
      <b>Vista</b>: rueda = zoom; clic derecho + arrastrar = orbitar (3D) o desplazar (2D); Shift + clic derecho o botón central = desplazar. <kbd>Supr</kbd> borra la selección; <kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Y</kbd> deshacer/rehacer.<br><br>
      <b>Unidades</b>: el selector <b>Unidades</b> de la barra superior (kN-m, N-mm, kgf-cm, tf-m, kip-in, kip-ft, lb-in, lb-ft o personalizado) cambia lo que se muestra y cómo se leen los valores que escribes. El modelo se guarda siempre igual, así que puedes escribir en tf y ver los resultados en kip o en kN sin errores de conversión.<br><br>
      <b>Convenciones</b>: Ejes locales: 1 a lo largo del elemento (i→j); en 3D el eje 2 está en el plano vertical (para columnas, // X global) y el eje 3 = 1×2, rotables con β. En 2D el giro θ y el momento son positivos antihorarios vistos en el plano XZ. Las fuerzas de elemento se dan en los extremos del tramo flexible (caras de nudo), en ejes locales, actuando sobre el elemento: f = k·u + f₀.
    </div>`, [{ text: 'Cerrar', primary: true }]);
  }

  // ------------------------------------------------------------------
  // Panel de asignación
  // ------------------------------------------------------------------
  function patOptions(sel) { return App.model.patterns.map(p => `<option ${p.name === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join(''); }
  function renderAssign() {
    const box = $('assignBody'), S = View.sel, is2D = App.model.mode === '2D';
    const nN = S.nodes.size, nE = S.elems.size;
    if (!nN && !nE) { box.innerHTML = '<span class="note">Selecciona nodos o elementos en la vista (clic, o arrastrar una ventana).</span><div class="row" style="margin-top:6px"><button id="aAutoD" class="small">Diafragmas automáticos por nivel</button></div>'; $('aAutoD').onclick = autoDiaphragms; return; }
    const dofs = is2D ? [[0, 'UX'], [2, 'UZ'], [4, 'θ']] : [[0, 'UX'], [1, 'UY'], [2, 'UZ'], [3, 'RX'], [4, 'RY'], [5, 'RZ']];
    const firstN = nN ? App.nodeById([...S.nodes][0]) : null;
    const firstE = nE ? App.model.elements.find(e => e.id === [...S.elems][0]) : null;
    let h = `<div class="note">${nN} nodo(s), ${nE} elemento(s) seleccionados <button class="small" id="aClr">Limpiar</button></div>`;
    if (nN) {
      const fc = is2D ? [[0, 'FX'], [2, 'FZ'], [4, 'M (antihor.)']] : [[0, 'FX'], [1, 'FY'], [2, 'FZ'], [3, 'MX'], [4, 'MY'], [5, 'MZ']];
      h += `<fieldset><legend>Nodos · Restricciones</legend>
        <div class="row">${dofs.map(([i, t]) => `<label><input type="checkbox" data-r="${i}" ${firstN && firstN.restr[i] ? 'checked' : ''}>${t}</label>`).join(' ')}</div>
        <div class="btns"><button class="small" data-pre="fix">Empotrado</button><button class="small" data-pre="pin">Articulado</button><button class="small" data-pre="rol">Rodillo</button><button class="small" data-pre="free">Libre</button><button class="small primary" id="aRes">Aplicar</button></div></fieldset>
        <fieldset><legend>Nodos · Carga puntual</legend>
        <div class="row"><select id="aNP">${patOptions(View.visPat)}</select></div>
        <div class="grid2">${fc.map(([i, t]) => `<label>${t} (${uL(loadDim(i))})</label><input data-nf="${i}" value="0">`).join('')}</div>
        <div class="btns" style="margin-top:4px"><button class="small primary" id="aNLadd">Agregar</button><button class="small" id="aNLrep">Reemplazar</button><button class="small" id="aNLdel">Borrar del patrón</button></div></fieldset>
        <fieldset><legend>Nodos · Masa y diafragma</legend>
        <div class="row"><label>Masa adicional (${uL('m')})</label><input id="aMass" value="${uIn(firstN ? firstN.mass || 0 : 0, 'm')}" style="width:60px"><button class="small" id="aMassB">Aplicar</button></div>
        ${is2D ? '' : `<div class="row"><label>Inercia rot. Z (${uL('mr')})</label><input id="aMR" value="${uIn(firstN ? firstN.massR || 0 : 0, 'mr')}" style="width:60px"><button class="small" id="aMRB">Aplicar</button></div>`}
        <div class="row"><label>Diafragma</label><input id="aDia" value="${firstN ? esc(firstN.diaph || '') : ''}" style="width:60px"><button class="small" id="aDiaB">Asignar</button><button class="small" id="aDiaX">Quitar</button></div>
        <div class="row"><button class="small" id="aAutoD">Diafragmas automáticos por nivel</button></div></fieldset>
        <div class="row"><button class="small" id="aDelN" style="color:var(--danger)">Eliminar nodos</button></div>`;
    }
    if (nE) {
      const rl = is2D ? [[0, 'P'], [1, 'V'], [5, 'M']] : [[0, 'P'], [1, 'V2'], [2, 'V3'], [3, 'T'], [4, 'M2'], [5, 'M3']];
      const dirs = is2D ? [['GZ', 'Global Z (gravedad −)'], ['GX', 'Global X'], ['LX', 'Local 1'], ['LY', 'Local 2']] : [['GZ', 'Global Z (gravedad −)'], ['GX', 'Global X'], ['GY', 'Global Y'], ['LX', 'Local 1'], ['LY', 'Local 2'], ['LZ', 'Local 3']];
      const rI = (firstE && firstE.rel && firstE.rel.i) || [], rJ = (firstE && firstE.rel && firstE.rel.j) || [];
      h += `<fieldset><legend>Elementos · Sección y orientación</legend>
        <div class="row"><select id="aSec">${App.model.sections.map(s => `<option ${firstE && s.name === firstE.sec ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><button class="small" id="aSecB">Aplicar</button></div>
        ${is2D ? '' : `<div class="row"><label>Ángulo β (°)</label><input id="aBeta" value="${firstE ? firstE.beta || 0 : 0}" style="width:60px"><button class="small" id="aBetaB">Aplicar</button></div>`}</fieldset>
        <fieldset><legend>Elementos · Brazos rígidos (${uL('L')})</legend>
        <div class="row"><label>Extremo i</label><input id="aOI" value="${uIn(firstE ? firstE.offI || 0 : 0, 'L')}" style="width:55px"><label>j</label><input id="aOJ" value="${uIn(firstE ? firstE.offJ || 0 : 0, 'L')}" style="width:55px"><button class="small" id="aOffB">Aplicar</button></div>
        <div class="row"><button class="small" id="aOffAuto">Fijar valores según el nudo</button></div>
        <div class="note">0 = automático desde la conectividad (si está activo en Opciones de análisis).</div></fieldset>
        <fieldset><legend>Elementos · Punto de inserción</legend>
        <div class="row"><select id="aCard">${[[0, 'Por defecto (vigas 8, columnas 10)'], [10, '10 Centroide'], [8, '8 Superior centro (vigas ETABS)'], [2, '2 Inferior centro'], [5, '5 Centro'], [1, '1 Inferior izq.'], [3, '3 Inferior der.'], [4, '4 Medio izq.'], [6, '6 Medio der.'], [7, '7 Superior izq.'], [9, '9 Superior der.']].map(([k, t]) => `<option value="${k}" ${firstE && (+firstE.cardinal || 0) === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="row"><label><input type="checkbox" id="aCardT" ${firstE && firstE.insTransform ? 'checked' : ''}> Transformar rigidez por la excentricidad</label><button class="small" id="aCardB">Aplicar</button></div>
        <div class="note">Sin transformar (por defecto en ETABS) solo cambia los brazos automáticos de las columnas.</div></fieldset>
        <fieldset><legend>Elementos · Liberaciones</legend>
        <div class="row"><b>i:</b>${rl.map(([k, t]) => `<label><input type="checkbox" data-ri="${k}" ${rI[k] ? 'checked' : ''}>${t}</label>`).join('')}</div>
        <div class="row"><b>j:</b>${rl.map(([k, t]) => `<label><input type="checkbox" data-rj="${k}" ${rJ[k] ? 'checked' : ''}>${t}</label>`).join('')}</div>
        <div class="btns"><button class="small" id="aRelB">Aplicar</button><button class="small" id="aRelX">Quitar</button></div></fieldset>
        <fieldset><legend>Elementos · Cargas</legend>
        <div class="row"><select id="aEP">${patOptions(View.visPat)}</select><select id="aET"><option value="dist">Distribuida (${uL('FL')})</option><option value="point">Puntual (${uL('F')})</option></select></div>
        <div class="row"><select id="aED">${dirs.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
        <div class="row"><label>Valor</label><input id="aEV" value="${+U.v(-10, 'FL').toPrecision(4)}" style="width:60px"><label>pos. a/L</label><input id="aEA" value="0.5" style="width:45px"></div>
        <div class="btns"><button class="small primary" id="aELadd">Agregar</button><button class="small" id="aELrep">Reemplazar</button><button class="small" id="aELdel">Borrar del patrón</button></div></fieldset>
        <fieldset><legend>Elementos · Edición</legend>
        <div class="row"><label>Dividir en</label><input id="aDivN" value="2" style="width:40px"><button class="small" id="aDivB">Dividir</button></div>
        <div class="row"><button class="small" id="aDelE" style="color:var(--danger)">Eliminar elementos</button></div></fieldset>`;
    }
    box.innerHTML = h;
    const on = (id, f) => { const el = $(id); if (el) el.onclick = f; };
    const selN = () => [...S.nodes].map(id => App.nodeById(id)).filter(Boolean);
    const selE = () => App.model.elements.filter(e => S.elems.has(e.id));
    on('aClr', () => { S.nodes.clear(); S.elems.clear(); App.onSelection(); });
    on('aAutoD', autoDiaphragms);
    box.querySelectorAll('[data-pre]').forEach(b => b.onclick = () => {
      const pre = { fix: [1, 1, 1, 1, 1, 1], pin: [1, 1, 1, 0, 0, 0], rol: is2D ? [0, 0, 1, 0, 0, 0] : [0, 0, 1, 0, 0, 0], free: [0, 0, 0, 0, 0, 0] }[b.dataset.pre];
      box.querySelectorAll('[data-r]').forEach(c => c.checked = !!pre[+c.dataset.r]);
    });
    on('aRes', () => { App.pushUndo(); const r = [0, 0, 0, 0, 0, 0]; box.querySelectorAll('[data-r]').forEach(c => r[+c.dataset.r] = c.checked ? 1 : 0); selN().forEach(n => n.restr = r.slice()); App.changed(); });
    const readNF = () => { const F = [0, 0, 0, 0, 0, 0]; box.querySelectorAll('[data-nf]').forEach(i => F[+i.dataset.nf] = uRead(i.value, loadDim(+i.dataset.nf))); return F; };
    on('aNLadd', () => { App.pushUndo(); const F = readNF(), pat = $('aNP').value; selN().forEach(n => App.model.nodalLoads.push({ node: n.id, pat, F: F.slice() })); View.visPat = pat; App.changed(); });
    on('aNLrep', () => { App.pushUndo(); const F = readNF(), pat = $('aNP').value, ids = new Set(selN().map(n => n.id)); App.model.nodalLoads = App.model.nodalLoads.filter(l => !(l.pat === pat && ids.has(l.node))); ids.forEach(id => App.model.nodalLoads.push({ node: id, pat, F: F.slice() })); View.visPat = pat; App.changed(); });
    on('aNLdel', () => { App.pushUndo(); const pat = $('aNP').value, ids = new Set(selN().map(n => n.id)); App.model.nodalLoads = App.model.nodalLoads.filter(l => !(l.pat === pat && ids.has(l.node))); App.changed(); });
    on('aMassB', () => { App.pushUndo(); const m = uRead($('aMass').value, 'm'); selN().forEach(n => n.mass = m); App.changed(); });
    on('aMRB', () => { App.pushUndo(); const m = uRead($('aMR').value, 'mr'); selN().forEach(n => n.massR = m); App.changed(); });
    on('aDiaB', () => { App.pushUndo(); const d = $('aDia').value.trim(); selN().forEach(n => n.diaph = d); App.changed(); });
    on('aDiaX', () => { App.pushUndo(); selN().forEach(n => n.diaph = ''); App.changed(); });
    on('aDelN', () => {
      App.pushUndo(); const ids = S.nodes; const m = App.model;
      const delE = new Set(m.elements.filter(e => ids.has(e.i) || ids.has(e.j)).map(e => e.id));
      m.elements = m.elements.filter(e => !delE.has(e.id)); m.nodes = m.nodes.filter(n => !ids.has(n.id));
      m.nodalLoads = m.nodalLoads.filter(l => !ids.has(l.node)); m.elemLoads = m.elemLoads.filter(l => !delE.has(l.elem));
      S.nodes.clear(); S.elems.clear(); App.changed();
    });
    on('aSecB', () => { App.pushUndo(); const s = $('aSec').value; selE().forEach(e => e.sec = s); App.changed(); });
    on('aBetaB', () => { App.pushUndo(); const b = num($('aBeta').value); selE().forEach(e => e.beta = b); App.changed(); });
    on('aOffB', () => { App.pushUndo(); const a = uRead($('aOI').value, 'L'), b = uRead($('aOJ').value, 'L'); selE().forEach(e => { e.offI = a; e.offJ = b; }); App.changed(); });
    on('aOffAuto', () => { App.pushUndo(); autoOffsets(selE()); App.changed(); });
    on('aCardB', () => { App.pushUndo(); const c = +$('aCard').value, t = $('aCardT').checked; selE().forEach(e => { e.cardinal = c; e.insTransform = t; }); App.changed(); });
    on('aRelB', () => {
      App.pushUndo(); const ri = [0, 0, 0, 0, 0, 0], rj = [0, 0, 0, 0, 0, 0];
      box.querySelectorAll('[data-ri]').forEach(c => ri[+c.dataset.ri] = c.checked ? 1 : 0);
      box.querySelectorAll('[data-rj]').forEach(c => rj[+c.dataset.rj] = c.checked ? 1 : 0);
      if ((ri[0] && rj[0]) || (ri[3] && rj[3])) { alert('No se puede liberar la fuerza axial o la torsión en ambos extremos (mecanismo).'); return; }
      selE().forEach(e => e.rel = (ri.some(Boolean) || rj.some(Boolean)) ? { i: ri.slice(), j: rj.slice() } : null); App.changed();
    });
    on('aRelX', () => { App.pushUndo(); selE().forEach(e => e.rel = null); App.changed(); });
    const readEL = () => { const type = $('aET').value; return { pat: $('aEP').value, type, dir: $('aED').value, v: uRead($('aEV').value, type === 'point' ? 'F' : 'FL'), a: Math.min(1, Math.max(0, num($('aEA').value, 0.5))) }; };
    const mkEL = (id, r) => r.type === 'point' ? { elem: id, pat: r.pat, type: 'point', dir: r.dir, P: r.v, a: r.a } : { elem: id, pat: r.pat, type: 'dist', dir: r.dir, w: r.v };
    on('aELadd', () => { App.pushUndo(); const r = readEL(); selE().forEach(e => App.model.elemLoads.push(mkEL(e.id, r))); View.visPat = r.pat; App.changed(); });
    on('aELrep', () => { App.pushUndo(); const r = readEL(), ids = new Set(selE().map(e => e.id)); App.model.elemLoads = App.model.elemLoads.filter(l => !(l.pat === r.pat && ids.has(l.elem))); ids.forEach(id => App.model.elemLoads.push(mkEL(id, r))); View.visPat = r.pat; App.changed(); });
    on('aELdel', () => { App.pushUndo(); const pat = $('aEP').value, ids = new Set(selE().map(e => e.id)); App.model.elemLoads = App.model.elemLoads.filter(l => !(l.pat === pat && ids.has(l.elem))); App.changed(); });
    on('aDivB', () => { const k = Math.round(num($('aDivN').value, 2)); if (k < 2) return; App.pushUndo(); selE().forEach(e => divideElement(e, k)); S.elems.clear(); App.changed(); });
    on('aDelE', () => { App.pushUndo(); const ids = S.elems, m = App.model; m.elements = m.elements.filter(e => !ids.has(e.id)); m.elemLoads = m.elemLoads.filter(l => !ids.has(l.elem)); S.elems.clear(); App.changed(); });
  }

  function autoDiaphragms() {
    App.pushUndo();
    const m = App.model, zmin = Math.min(...m.nodes.map(n => n.z));
    const zs = [...new Set(m.nodes.filter(n => n.z > zmin + 1e-6).map(n => +n.z.toFixed(6)))].sort((a, b) => a - b);
    m.nodes.forEach(n => {
      const k = zs.indexOf(+n.z.toFixed(6));
      const sup = (n.restr || []).some(Boolean);
      n.diaph = (k >= 0 && !sup) ? 'D' + (k + 1) : '';
    });
    App.status(`Diafragmas asignados a ${zs.length} nivel(es)`);
    App.changed();
  }

  function localR(e) {
    const A = App.nodeById(e.i), B = App.nodeById(e.j);
    const dx = B.x - A.x, dy = (B.y || 0) - (A.y || 0), dz = B.z - A.z, L = Math.hypot(dx, dy, dz);
    if (App.model.mode === '2D') { const c = dx / L, s = dz / L; return [[c, 0, s], [-s, 0, c], [0, 1, 0]]; }
    return Solver.localAxes3D(dx, dy, dz, L, e.beta);
  }
  /** Fija como valores manuales los brazos que el motor calcula desde la conectividad (incluye el punto de inserción). */
  function autoOffsets(list) {
    const m = JSON.parse(JSON.stringify(App.model));
    const ids = new Set(list.map(e => e.id));
    m.elements.forEach(e => { if (ids.has(e.id)) { e.offI = 0; e.offJ = 0; } });
    m.settings = Object.assign({}, m.settings, { autoOffsets: true });
    m.__geomOnly = true;
    let g; try { g = Solver.analyze(m); } catch (err) { alert('No se pudieron calcular los brazos: ' + err.message); return; }
    const by = new Map(g.els.map(e => [e.id, e]));
    list.forEach(e => { const r = by.get(e.id); if (r) { e.offI = +r.aPhys.toFixed(4); e.offJ = +r.bPhys.toFixed(4); } });
  }

  function divideElement(e, k) {
    const m = App.model, A = App.nodeById(e.i), B = App.nodeById(e.j);
    const ids = [A];
    for (let s = 1; s < k; s++) { const t = s / k; ids.push(App.getOrCreateNode({ x: A.x + (B.x - A.x) * t, y: (A.y || 0) + ((B.y || 0) - (A.y || 0)) * t, z: A.z + (B.z - A.z) * t })); }
    ids.push(B);
    const loads = m.elemLoads.filter(l => l.elem === e.id);
    m.elements = m.elements.filter(x => x !== e);
    m.elemLoads = m.elemLoads.filter(l => l.elem !== e.id);
    for (let s = 0; s < k; s++) {
      const ne = { id: App.nextId(m.elements), i: ids[s].id, j: ids[s + 1].id, sec: e.sec, beta: e.beta, offI: s === 0 ? e.offI : 0, offJ: s === k - 1 ? e.offJ : 0, rel: null };
      if (e.rel) ne.rel = { i: s === 0 ? e.rel.i.slice() : [0, 0, 0, 0, 0, 0], j: s === k - 1 ? e.rel.j.slice() : [0, 0, 0, 0, 0, 0] };
      m.elements.push(ne);
      for (const l of loads) {
        if (l.type === 'dist') m.elemLoads.push(Object.assign({}, l, { elem: ne.id }));
        else { const t0 = s / k, t1 = (s + 1) / k; if (l.a >= t0 && (l.a < t1 || (s === k - 1 && l.a <= t1))) m.elemLoads.push(Object.assign({}, l, { elem: ne.id, a: (l.a - t0) * k })); }
      }
    }
  }

  // ------------------------------------------------------------------
  // Panel de datos (derecha)
  // ------------------------------------------------------------------
  let dataTab = 'nodes';
  function renderData() {
    const box = $('dataBody'), m = App.model, is2D = m.mode === '2D', S = View.sel;
    const rs = n => { const r = n.restr || []; const idx = is2D ? [0, 2, 4] : [0, 1, 2, 3, 4, 5]; const c = idx.filter(i => r[i]).length; return c === 0 ? '' : c === idx.length ? 'Emp.' : (is2D ? (r[0] && r[2] && !r[4]) : (r[0] && r[1] && r[2] && !r[3] && !r[4] && !r[5])) ? 'Art.' : 'Parc.'; };
    if (dataTab === 'nodes') {
      box.innerHTML = `<div class="row"><b>Nuevo nodo (${uL('L')})</b> X <input id="dNx" type="number" step="any" value="0" style="width:56px">${is2D ? '' : ` Y <input id="dNy" type="number" step="any" value="0" style="width:56px">`} Z <input id="dNz" type="number" step="any" value="0" style="width:56px"><button class="small primary" id="dNadd">+</button></div>
        <div class="tblwrap" style="max-height:calc(100vh - 220px)"><table class="t"><tr><th>ID</th><th>X (${uL('L')})</th>${is2D ? '' : `<th>Y (${uL('L')})</th>`}<th>Z (${uL('L')})</th><th>Apoyo</th><th>Masa (${uL('m')})</th><th>Diaf.</th></tr>
        ${m.nodes.map(n => `<tr class="${S.nodes.has(n.id) ? 'sel' : ''}"><td data-sn="${n.id}" style="cursor:pointer">${n.id}</td>
          <td><input data-n="${n.id}" data-k="x" value="${uIn(n.x, 'L')}"></td>${is2D ? '' : `<td><input data-n="${n.id}" data-k="y" value="${uIn(n.y || 0, 'L')}"></td>`}<td><input data-n="${n.id}" data-k="z" value="${uIn(n.z, 'L')}"></td>
          <td class="l">${rs(n)}</td><td>${n.mass ? uF(n.mass, 'm', 3) : ''}</td><td>${esc(n.diaph || '')}</td></tr>`).join('')}</table></div>`;
      $('dNadd').onclick = () => App.addNodeAt({ x: uRead($('dNx').value, 'L'), y: is2D ? 0 : uRead($('dNy').value, 'L'), z: uRead($('dNz').value, 'L') });
      box.querySelectorAll('input[data-n]').forEach(i => i.onchange = () => { App.pushUndo(); const n = App.nodeById(+i.dataset.n); n[i.dataset.k] = uRead(i.value, 'L'); App.changed(); });
    } else if (dataTab === 'elems') {
      box.innerHTML = `<div class="row"><b>Por nodos</b> i <input id="dEi" style="width:42px"> j <input id="dEj" style="width:42px"><button class="small primary" id="dEadd">+</button></div>
        <div class="row"><b>Por coordenadas (${uL('L')})</b></div>
        <div class="row">P1 <input id="dC1" placeholder="${is2D ? 'x, z' : 'x, y, z'}" style="width:90px"> P2 <input id="dC2" placeholder="${is2D ? 'x, z' : 'x, y, z'}" style="width:90px"><button class="small primary" id="dEaddC">+</button></div>
        <div class="tblwrap" style="max-height:calc(100vh - 260px)"><table class="t"><tr><th>ID</th><th>i</th><th>j</th><th class="l">Sección</th><th>L (${uL('L')})</th><th>a / b (${uL('L')})</th></tr>
        ${m.elements.map(e => { const A = App.nodeById(e.i), B = App.nodeById(e.j); const L = A && B ? Math.hypot(B.x - A.x, (B.y || 0) - (A.y || 0), B.z - A.z) : 0; return `<tr class="${S.elems.has(e.id) ? 'sel' : ''}"><td data-se="${e.id}" style="cursor:pointer">E${e.id}</td>
          <td><input data-e="${e.id}" data-k="i" value="${e.i}" style="width:38px"></td><td><input data-e="${e.id}" data-k="j" value="${e.j}" style="width:38px"></td>
          <td><select data-e="${e.id}" data-k="sec">${m.sections.map(s => `<option ${s.name === e.sec ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></td>
          <td>${uF(L, 'L', 3)}</td><td>${+e.offI ? uF(+e.offI, 'L', 3) : 'auto'} / ${+e.offJ ? uF(+e.offJ, 'L', 3) : 'auto'}</td></tr>`; }).join('')}</table></div>`;
      $('dEadd').onclick = () => {
        const a = App.nodeById(Math.round(num($('dEi').value, -1))), b = App.nodeById(Math.round(num($('dEj').value, -1)));
        if (!a || !b) { alert('Nodos inexistentes'); return; }
        App.addElementBetween(a, b);
      };
      $('dEaddC').onclick = () => {
        const p = s => { const v = s.split(/[,;\s]+/).filter(Boolean).map(t => U.s(Number(t), 'L')); return is2D ? { x: v[0], y: 0, z: v[1] } : { x: v[0], y: v[1], z: v[2] }; };
        const a = p($('dC1').value), b = p($('dC2').value);
        if (![a.x, a.y, a.z, b.x, b.y, b.z].every(isFinite)) { alert('Coordenadas inválidas'); return; }
        App.addElementBetween(a, b);
      };
      box.querySelectorAll('[data-e]').forEach(i => i.onchange = () => {
        const e = App.model.elements.find(x => x.id === +i.dataset.e); App.pushUndo();
        if (i.dataset.k === 'sec') e.sec = i.value; else { const v = Math.round(num(i.value)); if (!App.nodeById(v)) { alert('Nodo inexistente'); App.undoS.pop(); renderData(); return; } e[i.dataset.k] = v; }
        App.changed();
      });
    } else {
      const pat = View.visPat;
      const nl = m.nodalLoads.map((l, k) => [l, k]).filter(([l]) => l.pat === pat);
      const el = m.elemLoads.map((l, k) => [l, k]).filter(([l]) => l.pat === pat);
      const fc = is2D ? [0, 2, 4] : [0, 1, 2, 3, 4, 5];
      box.innerHTML = `<div class="row"><label>Patrón</label><select id="dLP">${patOptions(pat)}</select></div>
        <b>Cargas nodales</b>
        <div class="tblwrap" style="max-height:30vh"><table class="t"><tr><th>Nodo</th>${fc.map((c, i) => `<th>${(is2D ? ['FX', 'FZ', 'M'] : ['FX', 'FY', 'FZ', 'MX', 'MY', 'MZ'])[i]} (${uL(loadDim(c))})</th>`).join('')}<th></th></tr>
        ${nl.map(([l, k]) => `<tr><td>${l.node}</td>${fc.map(c => `<td>${uF(l.F[c], loadDim(c), 3)}</td>`).join('')}<td><button class="small" data-dn="${k}">✕</button></td></tr>`).join('')}</table></div>
        <b>Cargas en elementos</b>
        <div class="tblwrap" style="max-height:30vh"><table class="t"><tr><th>Elem</th><th>Tipo</th><th>Dir</th><th>Valor</th><th>a/L</th><th></th></tr>
        ${el.map(([l, k]) => `<tr><td>E${l.elem}</td><td class="l">${l.type === 'point' ? 'Puntual' : 'Distrib.'}</td><td>${l.dir}</td><td>${l.type === 'point' ? uF(l.P, 'F', 3) + ' ' + uL('F') : uF(l.w, 'FL', 3) + ' ' + uL('FL')}</td><td>${l.type === 'point' ? l.a : ''}</td><td><button class="small" data-de="${k}">✕</button></td></tr>`).join('')}</table></div>
        <p class="note">Peso propio: ${(() => { const p = m.patterns.find(x => x.name === pat); return p && +p.selfWeight ? '×' + p.selfWeight + ' (se agrega al analizar)' : 'no incluido'; })()}</p>`;
      $('dLP').onchange = e => { View.visPat = e.target.value; $('visPat').value = View.visPat; renderData(); View.render(); };
      box.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => { App.pushUndo(); m.nodalLoads.splice(+b.dataset.dn, 1); App.changed(); });
      box.querySelectorAll('[data-de]').forEach(b => b.onclick = () => { App.pushUndo(); m.elemLoads.splice(+b.dataset.de, 1); App.changed(); });
    }
    box.querySelectorAll('[data-sn]').forEach(td => td.onclick = ev => { if (!ev.shiftKey) { S.nodes.clear(); S.elems.clear(); } S.nodes.add(+td.dataset.sn); App.onSelection(); });
    box.querySelectorAll('[data-se]').forEach(td => td.onclick = ev => { if (!ev.shiftKey) { S.nodes.clear(); S.elems.clear(); } S.elems.add(+td.dataset.se); App.onSelection(); });
  }

  // ------------------------------------------------------------------
  // Análisis
  // ------------------------------------------------------------------
  function runAnalysis() {
    App.err = null; App.res = null; App.modal = null; App.spec = null;
    const t0 = performance.now();
    try {
      App.res = Solver.analyze(App.model);
    } catch (e) { App.err = e.message; App.status('Error: ' + e.message, 'err'); alert('Error en el análisis:\n' + e.message); renderResultsPanel(); renderResultControls(); return; }
    let modalErr = null;
    try {
      App.modal = Solver.modal(App.res, App.model.modalOpts);
      App.spec = Solver.spectral(App.res, App.modal, App.model.spectrum);
    } catch (e) { modalErr = e.message; }
    App.modalErr = modalErr;
    const bc = Solver.buildCases(App.res, App.spec, App.model.combos || []);
    App.cases = bc.cases; App.caseErrors = bc.errors;
    const dt = performance.now() - t0;
    App.status(`Análisis completo en ${dt.toFixed(0)} ms · ${App.res.n} GDL totales, ${App.res.m} independientes` + (modalErr ? ` · Modal: ${modalErr}` : ` · ${App.modal.modes.length} modos`) + ` · ${App.cases.length} casos` + (bc.errors.length ? ' · ' + bc.errors[0] : ''), modalErr || bc.errors.length ? 'warn' : 'okc');
    resPat = Math.min(resPat, App.cases.length - 1);
    if (App.cases.length) { View.result.type = 'deformed'; View.result.pat = Math.min(View.result.pat, App.cases.length - 1); }
    else if (App.modal) { View.result.type = 'mode'; View.result.mode = 0; }
    $('bottom').classList.remove('collapsed'); $('botToggle').textContent = '▼ Resultados';
    resTab = 'sum';
    renderResultsPanel(); renderResultControls(); renderAssign(); View.render();
    if (View.result.type === 'mode') View.startAnim();
    setTimeout(() => View.fit(), 60);
  }

  function renderResultControls() {
    const box = $('resBody'), res = App.res;
    if (!res) { box.innerHTML = App.err ? `<span class="err">${esc(App.err)}</span>` : 'Ejecuta el análisis para ver resultados.'; return; }
    const r = View.result, is2D = res.is2D;
    const comps = is2D ? [['M3', 'Momento M'], ['V2', 'Cortante V'], ['N', 'Axial N']] : [['M3', 'Momento M3'], ['M2', 'Momento M2'], ['V2', 'Cortante V2'], ['V3', 'Cortante V3'], ['N', 'Axial N'], ['T', 'Torsión T']];
    box.innerHTML = `<div class="grid2">
      <label>Mostrar</label><select id="rT">
        <option value="none">Ninguno</option><option value="deformed">Deformada</option><option value="diagram">Diagramas</option><option value="reactions">Reacciones</option>
        ${App.modal ? '<option value="mode">Forma modal</option>' : ''}</select>
      <label>Caso</label><select id="rP" style="max-width:170px">${caseOptions()}</select>
      <label>Componente</label><select id="rC">${comps.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select>
      ${App.modal ? `<label>Modo</label><select id="rM">${App.modal.modes.map((m, i) => `<option value="${i}">${m.n}: T=${m.T.toFixed(3)} s</option>`).join('')}</select>` : ''}
      <label>Escala</label><input type="range" id="rS" min="0.1" max="5" step="0.1" value="${r.scale}">
      <label>Animar modo</label><input type="checkbox" id="rA" ${r.anim ? 'checked' : ''}>
      </div>`;
    $('rT').value = r.type; $('rP').value = r.pat; $('rC').value = r.comp; if ($('rM')) $('rM').value = r.mode;
    const upd = () => { r.type = $('rT').value; r.pat = +$('rP').value; r.comp = $('rC').value; if ($('rM')) r.mode = +$('rM').value; r.scale = +$('rS').value; r.anim = $('rA').checked; View.render(); if (r.type === 'mode') View.startAnim(); };
    box.querySelectorAll('select,input').forEach(i => i.oninput = upd);
  }

  // ------------------------------------------------------------------
  // Panel inferior de resultados
  // ------------------------------------------------------------------
  let resTab = 'sum', resPat = 0, resDir = 'X';
  const KIND_TAG = { pattern: 'Patrón', spectral: 'Sismo', combo: 'Comb.', envelope: 'Envolv.' };
  function caseOptions(sel) {
    const groups = [['pattern', 'Patrones'], ['spectral', 'Sismo espectral (±, diseño)'], ['combo', 'Combinaciones'], ['envelope', 'Envolventes']];
    return groups.map(([k, t]) => { const it = (App.cases || []).map((c, i) => [c, i]).filter(([c]) => c.kind === k); return it.length ? `<optgroup label="${t}">${it.map(([c, i]) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>` : ''; }).join('');
  }
  function renderResultsPanel() {
    const tabs = $('resTabs'), body = $('botBody'), res = App.res;
    if (!res) { tabs.innerHTML = ''; body.innerHTML = App.err ? `<p class="err">${esc(App.err)}</p>` : '<p class="note">Sin resultados.</p>'; $('botExtra').innerHTML = ''; return; }
    const list = [['sum', 'Resumen'], ['disp', 'Desplazamientos'], ['reac', 'Reacciones'], ['ef', 'Fuerzas en elementos']];
    if (App.modal) list.push(['modal', 'Modal'], ['spec', 'Espectral']);
    tabs.innerHTML = list.map(([k, t]) => `<button class="small ${k === resTab ? 'on' : ''}" data-rt="${k}">${t}</button>`).join('');
    tabs.querySelectorAll('[data-rt]').forEach(b => b.onclick = () => { resTab = b.dataset.rt; renderResultsPanel(); });
    const ex = $('botExtra');
    if (['disp', 'reac', 'ef'].includes(resTab)) { ex.innerHTML = `Caso <select id="rpSel">${caseOptions(resPat)}</select>`; $('rpSel').onchange = e => { resPat = +e.target.value; renderResultsPanel(); }; }
    else if (resTab === 'comb') ex.innerHTML = '';
    else if (resTab === 'spec' && App.spec) { const ds = Object.keys(App.spec.dirs); if (!ds.includes(resDir)) resDir = ds[0]; ex.innerHTML = `Dirección <select id="rdSel">${ds.map(d => `<option ${d === resDir ? 'selected' : ''}>${d}</option>`).join('')}</select>`; $('rdSel').onchange = e => { resDir = e.target.value; renderResultsPanel(); }; }
    else ex.innerHTML = '';
    const pat = res.patterns[resPat];
    const is2D = res.is2D, dn = res.dofNames, dpn = res.dpn;
    let h = '';
    if (resTab === 'sum') {
      const free = res.restrained.filter(r => !r).length;
      h += `<p>Modelo ${is2D ? '2D' : '3D'} · ${res.nodes.length} nodos · ${res.els.length} elementos · GDL totales: <b>${res.n}</b> · restringidos: ${res.n - free} · libres: ${free} · independientes tras diafragmas: <b>${res.m}</b>${res.masters.length ? ' · diafragmas: ' + res.masters.map(m => m.name).join(', ') : ''}</p>
        <p>Deformación por cortante: <b>${res.settings.shear ? 'sí' : 'no'}</b> · Factor zona rígida: ${res.settings.rigidFactor}</p>`;
      if (pat || res.patterns.length) {
        const uf = `(${uL('F')})`;
        h += '<table class="t"><tr><th class="l">Patrón</th>' + (is2D ? `<th>ΣFX cargas ${uf}</th><th>ΣFZ cargas ${uf}</th><th>ΣRX ${uf}</th><th>ΣRZ ${uf}</th>` : `<th>ΣFX ${uf}</th><th>ΣFY ${uf}</th><th>ΣFZ cargas ${uf}</th><th>ΣRX ${uf}</th><th>ΣRY ${uf}</th><th>ΣRZ ${uf}</th>`) + '</tr>';
        for (const p of res.patterns) {
          const comps = is2D ? [0, 1] : [0, 1, 2]; const sF = comps.map(c => 0), sR = comps.map(c => 0);
          res.nodes.forEach((nd, k) => comps.forEach((c, i) => { sF[i] += p.F[k * dpn + c]; sR[i] += p.R[k * dpn + c]; }));
          h += `<tr><td class="l">${esc(p.name)}</td>${sF.map(v => `<td>${uF(v, 'F', 3)}</td>`).join('')}${sR.map(v => `<td>${uF(v, 'F', 3)}</td>`).join('')}</tr>`;
        }
        h += '</table><p class="note">Verificación de equilibrio: la suma de reacciones debe ser igual y opuesta a la suma de cargas (incluye cargas equivalentes de elementos).</p>';
      }
      const nCombos = (App.cases || []).filter(c => c.kind === 'combo' || c.kind === 'envelope').length;
      h += `<p>Casos de resultados: ${(App.cases || []).length} (${res.patterns.length} patrones, ${nCombos} combinaciones/envolventes). ${nCombos ? '' : 'Define combinaciones con el botón <b>Combinaciones</b> o genera las de la NSR-10.'}</p>`;
      for (const er of App.caseErrors || []) h += `<p class="warn">${esc(er)}</p>`;
      if (App.modalErr) h += `<p class="warn">Análisis modal no realizado: ${esc(App.modalErr)}</p>`;
      else if (App.modal) { const md = App.modal; h += `<p>Modal: ${md.aSet.length} GDL con masa (condensación estática de ${md.bSet.length} GDL sin masa) · ${md.modes.length} modos · T₁ = ${md.modes[0].T.toFixed(4)} s · masa total ${md.dirs.map(d => d + ': ' + uF(md.Mtot[d], 'm', 3) + ' ' + uL('m')).join(', ')}</p>`; }
      h += `<p class="note">Unidades: fuerza ${uL('F')}, longitud ${uL('L')}, desplazamiento ${uL('D')}, esfuerzo ${uL('S')}, masa ${uL('m')}. Cámbialas con el selector <b>Unidades</b> de la barra superior; los resultados se convierten sin volver a analizar.</p>`;
    } else if (['disp', 'reac', 'ef'].includes(resTab) && App.cases && App.cases[resPat]) {
      const cs = App.cases[resPat], env = cs.env;
      h += `<p class="note"><b>${esc(cs.name)}</b> <span class="pill">${KIND_TAG[cs.kind]}</span> ${cs.kind === 'combo' || cs.kind === 'envelope' ? esc(comboText(App.model.combos.find(x => x.name === cs.name) || {})) : ''}${env ? ' — se muestran máximo y mínimo.' : ''}</p>`;
      const two = (mx, mn, d, dim) => env ? `<td>${uF(mx, dim, d)}</td><td>${uF(mn, dim, d)}</td>` : `<td>${uF(mx, dim, d)}</td>`;
      const head = t => env ? `<th>${t} máx</th><th>${t} mín</th>` : `<th>${t}</th>`;
      if (resTab === 'disp') {
        const Ud = Solver.caseNodal(res, cs, 'u');
        const dDim = c => (c < (is2D ? 2 : 3) ? 'D' : null); // giros en rad, sin conversión
        h += `<table class="t"><tr><th>Nodo</th>${dn.map((d, c) => head(d + ` (${dDim(c) ? uL('D') : 'rad'})`)).join('')}</tr>
          ${res.nodes.map((nd, k) => `<tr><td>${nd.id}</td>${dn.map((d, c) => { const i = k * dpn + c; return two(Ud.max[i], Ud.min[i], dDim(c) ? 4 : 6, dDim(c)); }).join('')}</tr>`).join('')}</table>
          ${env ? '<p class="note">Con sismo, los desplazamientos son elásticos (sin dividir por R), como exige NSR-10 A.6.</p>' : ''}`;
      } else if (resTab === 'reac') {
        const R = Solver.caseNodal(res, cs, 'R');
        const fn = is2D ? ['FX', 'FZ', 'M'] : ['FX', 'FY', 'FZ', 'MX', 'MY', 'MZ'];
        h += `<table class="t"><tr><th>Nodo</th>${fn.map((t, c) => head(`${t} (${uL(nodeDim(is2D, c))})`)).join('')}</tr>
          ${res.nodes.map((nd, k) => { if (![...Array(dpn).keys()].some(c => res.restrained[k * dpn + c])) return ''; return `<tr><td>${nd.id}</td>${fn.map((_, c) => { const i = k * dpn + c; return res.restrained[i] ? two(R.max[i], R.min[i], 3, nodeDim(is2D, c)) : (env ? '<td></td><td></td>' : '<td></td>'); }).join('')}</tr>`; }).join('')}</table>`;
      } else {
        const lab = is2D ? ['P', 'V', 'M'] : ['P', 'V2', 'V3', 'T', 'M2', 'M3'], ld = localDims(is2D);
        h += `<p class="note">Fuerzas en los extremos del tramo flexible (caras), ejes locales, actuando sobre el elemento: f = k·u + f₀. Además, extremos de los diagramas internos a lo largo del elemento (M positivo = tracción en la cara −2 local).</p>
          <table class="t"><tr><th>Elem</th><th>Ext.</th>${lab.map((t, c) => head(`${t} (${uL(ld[c])})`)).join('')}<th>M3 máx (${uL('M')})</th><th>M3 mín (${uL('M')})</th><th>|V2| máx (${uL('F')})</th></tr>
          ${res.els.map((e, k) => {
            const f = Solver.caseEnd(res, cs, k), st = Solver.caseStations(res, App.spec, cs, k, 41);
            const Mx = Math.max(...st.map(s => s.max.M3)), Mn = Math.min(...st.map(s => s.min.M3)), Vx = Math.max(...st.map(s => Math.max(Math.abs(s.max.V2), Math.abs(s.min.V2))));
            return [0, 1].map(j => `<tr><td>${j ? '' : 'E' + e.id}</td><td>${j ? 'j' : 'i'}</td>${lab.map((_, c) => two(f.max[j * dpn + c], f.min[j * dpn + c], 3, ld[c])).join('')}${j ? '<td></td><td></td><td></td>' : `<td>${uF(Mx, 'M', 3)}</td><td>${uF(Mn, 'M', 3)}</td><td>${uF(Vx, 'F', 3)}</td>`}</tr>`).join('');
          }).join('')}</table>`;
      }
    } else if (resTab === 'modal' && App.modal) {
      const md = App.modal, ds = md.dirs;
      h += `<table class="t"><tr><th>Modo</th><th>T (s)</th><th>f (Hz)</th><th>ω (rad/s)</th>${ds.map(d => `<th>Γ${d} (${uL('sm')})</th>`).join('')}${ds.map(d => `<th>M${d} %</th>`).join('')}${ds.map(d => `<th>ΣM${d} %</th>`).join('')}</tr>
        ${md.modes.map(m => `<tr><td>${m.n}</td><td>${m.T.toFixed(4)}</td><td>${m.f.toFixed(4)}</td><td>${m.omega.toFixed(4)}</td>${ds.map(d => `<td>${uF(m.gamma[d], 'sm', 4)}</td>`).join('')}${ds.map(d => `<td>${(m.ratio[d] * 100).toFixed(2)}</td>`).join('')}${ds.map(d => `<td class="${m.cum[d] >= 0.9 ? 'okc' : ''}">${(m.cum[d] * 100).toFixed(2)}</td>`).join('')}</tr>`).join('')}</table>
        <p class="note">Φ normalizados respecto a la masa (ΦᵀMΦ = I). NSR-10 A.5.4.2: incluir modos hasta alcanzar al menos 90 % de la masa participante en cada dirección (verde).</p>`;
    } else if (resTab === 'spec' && App.spec) {
      const S = App.spec.dirs[resDir], md = App.modal, sp = App.spec.sp, lim = +App.model.driftLimit;
      if (!S) h = '<p class="note">Sin datos para esta dirección.</p>';
      else {
        h += `<p>Dirección <b>${resDir}</b> · combinación <b>${sp.comb}</b> (ξ = ${sp.xi}) · R = ${sp.R} · Modo dominante: ${S.fundamental} (T = ${S.Tf.toFixed(4)} s, Sa = ${S.SaF.toFixed(4)} g)</p>
          <p>Cortante basal modal combinado <b>Vt = ${uF(S.Vb, 'F', 3)} ${uL('F')}</b> (elástico) · FHE Vs = Sa·g·M = ${uF(S.Vs, 'F', 3)} ${uL('F')} · Vt/Vs = ${(S.Vb / S.Vs * 100).toFixed(1)} %${sp.minShearPct ? ` · factor para ${sp.minShearPct} %: <b>${S.scale.toFixed(3)}</b> ${sp.applyScale ? '(aplicado)' : '(no aplicado)'}` : ''} · cortante de diseño = ${uF(S.Vb * S.fScale, 'F', 3)} ${uL('F')}</p>
          <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
          <div><b>Por modo</b><table class="t"><tr><th>Modo</th><th>T</th><th>Sa (g)</th><th>Sd (${uL('D')})</th><th>Γ (${uL('sm')})</th><th>Vb (${uL('F')})</th></tr>
            ${md.modes.map((m, i) => { const p = S.perMode[i]; return `<tr><td>${m.n}</td><td>${m.T.toFixed(4)}</td><td>${p.Sa.toFixed(4)}</td><td>${uF(p.Sd, 'D', 3)}</td><td>${uF(m.gamma[resDir], 'sm', 4)}</td><td>${uF(p.Vb, 'F', 3)}</td></tr>`; }).join('')}</table></div>
          <div><b>Cortante por piso (diseño)</b><table class="t"><tr><th>Z (${uL('L')})</th><th>V (${uL('F')})</th></tr>${S.stories.map(s => `<tr><td>${uF(s.z, 'L', 3)}</td><td>${uF(s.V, 'F', 3)}</td></tr>`).join('')}</table></div>
          <div><b>Derivas (elásticas)</b><table class="t"><tr><th>Nodo</th><th>Abajo</th><th>Z (${uL('L')})</th><th>h (${uL('L')})</th><th>Δx (${uL('D')})</th>${is2D ? '' : `<th>Δy (${uL('D')})</th>`}<th>Δ total (${uL('D')})</th><th>Δ/h %</th></tr>
            ${S.drifts.map(d => `<tr><td>${d.node}</td><td>${d.below}</td><td>${uF(d.z, 'L', 2)}</td><td>${uF(d.h, 'L', 2)}</td><td>${uF(d.dx, 'D', 3)}</td>${is2D ? '' : `<td>${uF(d.dy, 'D', 3)}</td>`}<td>${uF(d.total, 'D', 3)}</td><td class="${d.ratio * 100 > lim ? 'err' : 'okc'}">${(d.ratio * 100).toFixed(3)}</td></tr>`).join('')}</table>
            <p class="note">Límite: ${lim} % h (NSR-10 A.6.4). Rojo = no cumple.</p></div>
          </div>`;
      }
    }
    body.innerHTML = h;
  }

  // ------------------------------------------------------------------
  // Selects y vista
  // ------------------------------------------------------------------
  function fillSelects() {
    const m = App.model;
    const ds = $('drawSec'), cur = ds.value;
    ds.innerHTML = m.sections.map(s => `<option>${esc(s.name)}</option>`).join('');
    if (m.sections.some(s => s.name === cur)) ds.value = cur;
    if (!m.patterns.some(p => p.name === View.visPat)) View.visPat = m.patterns[0] ? m.patterns[0].name : null;
    $('visPat').innerHTML = patOptions(View.visPat);
    fillLevels();
  }
  function fillLevels() {
    const box = $('lvlBox');
    if (View.mode === '3D' || App.model.mode === '2D') { box.style.display = 'none'; return; }
    box.style.display = '';
    const lv = View.levels(), k = View.planeKey();
    if (!lv.some(v => Math.abs(v - View.level[k]) < 1e-6)) View.level[k] = lv[lv.length - 1] ?? 0;
    $('lvlSel').innerHTML = lv.map(v => `<option value="${v}" ${Math.abs(v - View.level[k]) < 1e-6 ? 'selected' : ''}>${k.toUpperCase()} = ${v}</option>`).join('');
  }
  function setViewMode(v) {
    if (App.model.mode === '2D' && v !== 'XZ') v = 'XZ';
    View.mode = v;
    if (App.model.mode === '2D') View.level.y = 0;
    document.querySelectorAll('#viewbar [data-v]').forEach(b => { b.classList.toggle('on', b.dataset.v === v); b.style.display = (App.model.mode === '2D' && b.dataset.v !== 'XZ') ? 'none' : ''; });
    fillLevels(); View.fit();
  }
  function setTool(t) {
    View.tool = t; View.drawStart = null;
    $('tSel').classList.toggle('on', t === 'select'); $('tDraw').classList.toggle('on', t === 'draw'); $('tNode').classList.toggle('on', t === 'node');
    View.cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
    App.status(t === 'draw' ? 'Dibujar: clic en el punto inicial y luego en el final' : t === 'node' ? 'Clic para crear un nodo' : 'Seleccionar');
    View.render();
  }

  // ------------------------------------------------------------------
  // Archivo
  // ------------------------------------------------------------------
  function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function saveModel() { download('modelo_portico.json', new Blob([JSON.stringify(App.model, null, 1)], { type: 'application/json' })); }
  function loadModel(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const m = JSON.parse(rd.result); if (!m.nodes || !m.elements) throw new Error('Archivo no válido');
        App.pushUndo(); App.model = normalizeModel(Object.assign(defaultModel(m.mode || '3D'), m)); App.reindex();
        if (m.units) U.set(m.units); App.model.units = Object.assign({}, U.cur); fillUnitSel();
        View.sel.nodes.clear(); View.sel.elems.clear();
        setViewMode(App.model.mode === '2D' ? 'XZ' : '3D'); App.changed(); View.fit();
      } catch (e) { alert('No se pudo abrir: ' + e.message); }
    };
    rd.readAsText(file);
  }
  App.download = download;

  // ------------------------------------------------------------------
  // Unidades de trabajo
  // ------------------------------------------------------------------
  function fillUnitSel() {
    const sel = $('unitSel'); if (!sel) return;
    const id = U.presetId();
    sel.innerHTML = U.PRESETS.map(p => `<option value="${p.id}" ${p.id === id ? 'selected' : ''}>${esc(p.name)}</option>`).join('') +
      `<option value="custom" ${id === 'custom' ? 'selected' : ''}>${id === 'custom' ? esc(`Personalizado: ${U.tag()}, ${U.cur.S}, desp. ${U.cur.D}`) : 'Personalizado…'}</option>`;
  }
  App.setUnits = u => {
    U.set(u); App.model.units = Object.assign({}, U.cur);
    try { localStorage.setItem('porticoMatricial', JSON.stringify(App.model)); } catch (e) { /* almacenamiento no disponible */ }
    fillUnitSel(); renderData(); renderAssign(); renderResultsPanel(); View.render();
    App.status(`Unidades: fuerza ${U.u('F')} · longitud ${U.u('L')} · esfuerzo ${U.u('S')} · desplazamiento ${U.u('D')} · masa ${U.u('m')}. El modelo no cambió; solo cómo se muestra.`);
  };
  function dlgUnits() {
    const c = U.cur, opt = (o, v) => Object.keys(o).map(k => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(k === 'lbf' ? 'lb' : k)}</option>`).join('');
    dialog('Unidades de trabajo', `
      <div class="grid2">
        <label>Fuerza</label><select id="uF">${opt(U.F, c.F)}</select>
        <label>Longitud (coordenadas, secciones)</label><select id="uL">${opt(U.L, c.L)}</select>
        <label>Esfuerzo (E, f'c, Fy, Fu)</label><select id="uS">${opt(U.S, c.S)}</select>
        <label>Desplazamientos y derivas</label><select id="uD">${opt(U.L, c.D)}</select>
      </div>
      <p class="note">Las unidades derivadas se arman solas: momento = fuerza·longitud, carga distribuida = fuerza/longitud, peso específico = fuerza/longitud³, masa = fuerza·s²/longitud (t con kN y m, kip·s²/in, slug con lb y ft).<br>
      Cambiar las unidades <b>no modifica el modelo</b>: un valor escrito en tf y luego visto en kip o en kN es el mismo valor convertido.</p>`, [
      { text: 'Cancelar', click: () => fillUnitSel() },
      { text: 'Aplicar', primary: true, click: () => App.setUnits({ F: Q('#uF').value, L: Q('#uL').value, S: Q('#uS').value, D: Q('#uD').value }) }]);
  }

  // ------------------------------------------------------------------
  // Inicio
  // ------------------------------------------------------------------
  function init() {
    let saved = null; try { saved = JSON.parse(localStorage.getItem('porticoMatricial')); } catch (e) { saved = null; }
    if (saved && saved.nodes) App.model = normalizeModel(Object.assign(defaultModel(saved.mode || '2D'), saved));
    else { App.model = defaultModel('2D'); genFrame('2@5', '', '3@3', 'COL 40x40', 'VIG 30x45', 'fix', true, 20, 8); }
    U.set(App.model.units); App.model.units = Object.assign({}, U.cur);
    fillUnitSel();
    $('unitSel').onchange = e => { const v = e.target.value; if (v === 'custom') dlgUnits(); else App.setUnits(U.PRESETS.find(p => p.id === v).u); };
    App.reindex();
    View.init($('cv'));
    View.visPat = App.model.patterns[0] && App.model.patterns[0].name;
    fillSelects();
    setViewMode(App.model.mode === '2D' ? 'XZ' : '3D');
    renderData(); renderAssign();
    $('bNew').onclick = dlgNew; $('bGrids').onclick = dlgGrids; $('bMat').onclick = dlgMaterials; $('bSec').onclick = dlgSections;
    $('bPat').onclick = dlgPatterns; $('bCombo').onclick = dlgCombos; $('bMass').onclick = dlgMass; $('bSpec').onclick = dlgSpectrum; $('bOpt').onclick = dlgOptions; $('bHelp').onclick = dlgHelp;
    $('bRun').onclick = runAnalysis;
    $('bSave').onclick = saveModel; $('bOpen').onclick = () => $('fileIn').click(); $('fileIn').onchange = e => { if (e.target.files[0]) loadModel(e.target.files[0]); e.target.value = ''; };
    $('bUndo').onclick = () => App.undo(); $('bRedo').onclick = () => App.redo();
    $('bXlsM').onclick = () => { if (!App.res) runAnalysis(); if (App.res) Export.matricial(App); };
    $('bXlsD').onclick = () => { if (!App.res) runAnalysis(); if (!App.modal) { alert('No hay resultados modales: ' + (App.modalErr || 'ejecuta el análisis')); return; } Export.modal(App); };
    $('tSel').onclick = () => setTool('select'); $('tDraw').onclick = () => setTool('draw'); $('tNode').onclick = () => setTool('node');
    document.querySelectorAll('#viewbar [data-v]').forEach(b => b.onclick = () => setViewMode(b.dataset.v));
    $('bFit').onclick = () => View.fit();
    $('lvlSel').onchange = e => { View.level[View.planeKey()] = +e.target.value; View.render(); };
    const step = d => { const lv = View.levels(), k = View.planeKey(); let i = lv.findIndex(v => Math.abs(v - View.level[k]) < 1e-6); i = Math.max(0, Math.min(lv.length - 1, i + d)); View.level[k] = lv[i]; fillLevels(); View.render(); };
    $('lvlPrev').onclick = () => step(-1); $('lvlNext').onclick = () => step(1);
    [['shNodeId', 'nodeId'], ['shElId', 'elId'], ['shAxes', 'axes'], ['shLoads', 'loads'], ['shGrid', 'grid'], ['shOff', 'off'], ['shExtr', 'extr']].forEach(([id, k]) => { $(id).checked = View.show[k]; $(id).onchange = e => { View.show[k] = e.target.checked; View.render(); }; });
    $('visPat').onchange = e => { View.visPat = e.target.value; renderData(); View.render(); };
    document.querySelectorAll('#dataTabs [data-t]').forEach(b => b.onclick = () => { dataTab = b.dataset.t; document.querySelectorAll('#dataTabs [data-t]').forEach(x => x.classList.toggle('on', x === b)); renderData(); });
    $('botToggle').onclick = () => { const c = $('bottom').classList.toggle('collapsed'); $('botToggle').textContent = (c ? '▲' : '▼') + ' Resultados'; };
    window.addEventListener('keydown', e => {
      if (e.target.matches('input,textarea,select')) return;
      if ($('overlay').classList.contains('show')) { if (e.key === 'Escape') closeDialog(); return; }
      if (e.key === 'Escape') { if (View.drawStart) { View.drawStart = null; View.render(); } else if (View.tool !== 'select') setTool('select'); else { View.sel.nodes.clear(); View.sel.elems.clear(); App.onSelection(); } }
      else if (e.key === 'Delete') {
        if (!View.sel.nodes.size && !View.sel.elems.size) return;
        App.pushUndo(); const m = App.model, nIds = View.sel.nodes;
        const eIds = new Set([...View.sel.elems, ...m.elements.filter(x => nIds.has(x.i) || nIds.has(x.j)).map(x => x.id)]);
        m.elements = m.elements.filter(x => !eIds.has(x.id)); m.nodes = m.nodes.filter(n => !nIds.has(n.id));
        m.elemLoads = m.elemLoads.filter(l => !eIds.has(l.elem)); m.nodalLoads = m.nodalLoads.filter(l => !nIds.has(l.node));
        View.sel.nodes.clear(); View.sel.elems.clear(); App.changed();
      }
      else if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); App.undo(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); App.redo(); }
      else if (!e.ctrlKey && e.key.toLowerCase() === 's') setTool('select');
      else if (!e.ctrlKey && e.key.toLowerCase() === 'd') setTool('draw');
      else if (!e.ctrlKey && e.key.toLowerCase() === 'n') setTool('node');
      else if (e.key === 'F5') { e.preventDefault(); runAnalysis(); }
    });
    renderResultsPanel();
    App.status('Listo. Usa "Nuevo" para empezar un modelo 2D o 3D, o modifica el ejemplo cargado.');
  }
  window.addEventListener('DOMContentLoaded', init);
})();
