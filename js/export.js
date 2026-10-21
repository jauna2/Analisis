/* =====================================================================
   Exportación a Excel (SheetJS): análisis matricial y modal/espectral
   Todo se escribe en las unidades de trabajo elegidas (Units).
   ===================================================================== */
(function (root) {
  'use strict';
  const S = () => root.Solver;
  const Un = () => root.Units;

  function needXLSX() {
    if (typeof XLSX === 'undefined') { alert('No se pudo cargar la librería de Excel (SheetJS). Se necesita conexión a internet la primera vez que abres el programa.'); return false; }
    return true;
  }
  const safe = s => String(s).replace(/[\[\]\*\?\/\\:]/g, '_').slice(0, 31);

  /** Constructor de hoja por bloques (filas AOA). */
  class Sheet {
    constructor() { this.rows = []; this.merges = []; }
    row(...cells) { this.rows.push(cells); return this; }
    blank(n = 1) { for (let i = 0; i < n; i++) this.rows.push([]); return this; }
    title(t) { this.rows.push([t]); return this; }
    matrix(title, M, rowL, colL, note) {
      this.rows.push([title + `  [${M.length} × ${M.length ? M[0].length : 0}]`]);
      if (note) this.rows.push([note]);
      this.rows.push([''].concat(colL || (M[0] || []).map((_, j) => j + 1)));
      M.forEach((r, i) => this.rows.push([rowL ? rowL[i] : i + 1].concat(r.map(clean))));
      this.rows.push([]);
      return this;
    }
    vector(title, v, rowL, head) {
      this.rows.push([title]);
      this.rows.push(['', head || 'valor']);
      v.forEach((x, i) => this.rows.push([rowL ? rowL[i] : i + 1, clean(x)]));
      this.rows.push([]);
      return this;
    }
    table(head, data) { this.rows.push(head); data.forEach(r => this.rows.push(r.map(clean))); this.rows.push([]); return this; }
    toWS() {
      const ws = XLSX.utils.aoa_to_sheet(this.rows);
      let maxc = 0; this.rows.forEach(r => maxc = Math.max(maxc, r.length));
      ws['!cols'] = Array.from({ length: Math.min(maxc, 400) }, (_, i) => ({ wch: i === 0 ? 16 : 13 }));
      return ws;
    }
  }
  function clean(v) { if (typeof v === 'number') { if (!isFinite(v)) return String(v); return Math.abs(v) < 1e-14 * 1e-6 ? 0 : v; } return v; }
  function add(wb, name, sh) { let n = safe(name), k = 2; while (wb.SheetNames.includes(n)) n = safe(name).slice(0, 28) + '_' + (k++); XLSX.utils.book_append_sheet(wb, sh.toWS(), n); }

  function localLabels(is2D) {
    const b = is2D ? ['u', 'v', 'θ'] : ['u', 'v', 'w', 'θx', 'θy', 'θz'];
    return b.map(x => x + '1').concat(b.map(x => x + '2'));
  }

  /**
   * Conversión por grado de libertad. Un GDL es de traslación (desplazamiento en longitud, fuerza)
   * o de giro (rad, momento). Así cada término de K, M, T, H o Φ se convierte con la unidad de su fila y su columna.
   */
  function converter(res) {
    const U = Un(), fF = U.fac('F'), fL = U.fac('L'), fm = U.fac('m');
    const nt = res.is2D ? 2 : 3;
    const disp = t => (t ? fL : 1);           // traslación: longitud; giro: rad
    const force = t => (t ? fF : fF * fL);    // traslación: fuerza; giro: momento
    const types = {
      full: i => (i % res.dpn) < nt,
      red: p => res.rdofs[p].comp < nt,
      loc: i => (i % res.dpn) < nt
    };
    const pick = (tp, idx) => (idx ? i => tp(idx[i]) : tp);
    return {
      types,
      F: (v, tp) => v.map((x, i) => (x === '' ? '' : x / force(tp(i)))),
      D: (v, tp) => v.map((x, i) => x / disp(tp(i))),
      K: (M, tr, tc) => M.map((r, i) => r.map((x, j) => x * disp(tc(j)) / force(tr(i)))), // rigidez y masa
      T: (M, tr, tc) => M.map((r, i) => r.map((x, j) => x * disp(tc(j)) / disp(tr(i)))),   // transformaciones u_i = T_ij·u_j
      Phi: (M, tr) => M.map((r, i) => r.map(x => x * Math.sqrt(fm) / disp(tr(i)))),         // modos normalizados a la masa
      sub: (tp, idx) => pick(tp, idx)
    };
  }
  const unitsRow = () => {
    const U = Un();
    return ['Unidades', `fuerza ${U.u('F')} · longitud ${U.u('L')} · momento ${U.u('M')} · esfuerzo ${U.u('S')} · masa ${U.u('m')} · giros en rad`];
  };

  // ------------------------------------------------------------------
  function matricial(App) {
    if (!needXLSX()) return;
    const U = Un(), u = d => U.u(d), v = (x, d) => U.v(x, d);
    const res = App.res, m = App.model, is2D = res.is2D, dpn = res.dpn, wb = XLSX.utils.book_new();
    const C = converter(res), tF = C.types.full, tR = C.types.red, tLc = C.types.loc;
    const ll = localLabels(is2D);
    const ldim = i => (tLc(i) ? 'F' : 'M');
    // Info
    const info = new Sheet();
    info.title('ANÁLISIS MATRICIAL DE PÓRTICOS — ' + (is2D ? 'Pórtico plano 2D (plano XZ)' : 'Pórtico espacial 3D'));
    info.row('Fecha', new Date().toLocaleString());
    info.row(...unitsRow());
    info.row('Nota', 'En las matrices cada término queda en la unidad de su fila y su columna: K de traslación en ' + u('F') + '/' + u('L') + ', acoplamientos en ' + u('F') + ', giro-giro en ' + u('M') + '.');
    info.row('Nodos', res.nodes.length, 'Elementos', res.els.length);
    info.row('GDL por nodo', dpn, 'GDL totales', res.n, 'GDL independientes (tras restricciones/diafragmas)', res.m);
    info.row('Deformación por cortante (Timoshenko)', res.settings.shear ? 'Sí' : 'No', 'Factor de zona rígida', res.settings.rigidFactor);
    info.blank();
    info.title('Procedimiento');
    [
      '1. Para cada elemento: k\' = rigidez local del tramo flexible Lf = L − a − b, con φ = 12EI/(G·As·Lf²) (Timoshenko). Axial y torsión con la longitud completa.',
      '2. Si hay liberaciones: condensación estática k* = kcc − kcr·krr⁻¹·krc (GDL liberados quedan en cero).',
      '3. Si hay brazos rígidos: H relaciona extremos del tramo flexible con nodos (v = v_nodo ± a·θ). k_local = Hᵀ·k*·H.',
      '4. λ = matriz de transformación (cosenos directores, filas = ejes locales 1, 2, 3). k_global = λᵀ·k_local·λ.',
      '5. Ensamblaje: K = Σ k_global en los GDL del elemento (numeración: GDL = (índice de nodo)·' + dpn + ' + componente).',
      '6. Restricciones: u = T·q (T incluye diafragmas rígidos maestro-esclavo). K_red = Tᵀ·K·T, F_red = Tᵀ·F.',
      '7. Solución K_red·q = F_red; u = T·q; reacciones R = K·u − F; fuerzas de elemento f = k*·(H·λ·u_e) + f₀.',
      'Convención 2D: θ y momentos positivos antihorarios vistos en el plano XZ (X a la derecha, Z arriba).',
      'Convención 3D: eje local 1 = i→j; eje 2 en el plano vertical (para columnas // X global); eje 3 = 1×2; giro β alrededor del eje 1.'
    ].forEach(t => info.row(t));
    info.blank();
    info.title('Numeración de grados de libertad');
    info.table(['GDL global', 'Etiqueta', 'Nodo', 'Componente', 'Estado', 'Índice en q (independiente)'],
      res.dofLabels.map((l, i) => { const k = Math.floor(i / dpn); const qq = res.Trows[i].map(([p, t]) => (t === 1 ? '' : (t / (tF(i) && !tR(p) ? U.fac('L') : 1)).toFixed(4) + '·') + res.rdofs[p].label).join(' + '); return [i + 1, l, res.nodes[k].id, res.dofNames[i % dpn], res.dofStatus[i], qq]; }));
    if (res.masters.length) info.table(['Diafragma', `Xcm (${u('L')})`, `Ycm (${u('L')})`, `Z (${u('L')})`, 'Nodos'], res.masters.map(mm => [mm.name, v(mm.xc, 'L'), v(mm.yc, 'L'), v(mm.zc, 'L'), mm.nodes.map(k => res.nodes[k].id).join(', ')]));
    add(wb, 'Info y GDL', info);

    // Nodos
    const sn = new Sheet();
    sn.table(['Nodo', `X (${u('L')})`, `Y (${u('L')})`, `Z (${u('L')})`, ...res.dofNames.map(d => 'Restr ' + d), `Masa total (${u('m')})`, 'Diafragma'],
      res.nodes.map((nd, k) => [nd.id, v(nd.x, 'L'), v(nd.y || 0, 'L'), v(nd.z, 'L'), ...res.dofNames.map((_, c) => res.restrained[k * dpn + c] ? 1 : 0), v(res.nodeMass[k], 'm'), nd.diaph || '']));
    add(wb, 'Nodos', sn);

    // Elementos
    const se = new Sheet();
    const uL = `(${u('L')})`;
    se.table(['Elem', 'Ni', 'Nj', 'Sección', `L ${uL}`, `Brazo físico i ${uL}`, `Brazo físico j ${uL}`, `a rígido ${uL}`, `b rígido ${uL}`, `Lf flexible ${uL}`, `L para masa/peso ${uL}`, `E (${u('S')})`, `G (${u('S')})`, `A (${u('A')})`, `I33 (${u('I')})`, `I22 (${u('I')})`, `J (${u('I')})`, `As2 (${u('A')})`, `As3 (${u('A')})`, 'φ (plano 1-2)', 'φ (plano 1-3)', 'β', 'GDL liberados (local)', 'GDL globales'],
      res.els.map(e => [e.id, res.nodes[e.ni].id, res.nodes[e.nj].id, e.sec, v(e.L, 'L'), v(e.aPhys, 'L'), v(e.bPhys, 'L'), v(e.a, 'L'), v(e.b, 'L'), v(e.Lf, 'L'), v(e.Lmass, 'L'), v(e.p.E, 'S'), v(e.p.G, 'S'), v(e.p.A, 'A'), v(e.p.Iz, 'I'), v(e.p.Iy, 'I'), v(e.p.J, 'I'), v(e.p.Asy, 'A'), v(e.p.Asz, 'A'), e.phiY, e.phiZ, e.src.beta || 0, e.rel.map(i => ll[i]).join(' '), e.dofs.map(d => d + 1).join(' ')]));
    add(wb, 'Elementos', se);

    // Materiales y secciones
    const sms = new Sheet();
    const tName = { concrete: 'Concreto', steel: 'Acero', other: 'Otro' };
    const uS = `(${u('S')})`;
    sms.title('Materiales');
    sms.table(['Material', 'Tipo', `f'c ${uS}`, `Fy ${uS}`, `Fu ${uS}`, `E ${uS}`, 'ν', `G ${uS}`, `γ (${u('G')})`],
      m.materials.map(t => [t.name, tName[t.type] || '', t.type === 'concrete' ? v(t.fc * 1000, 'S') : '', t.type === 'steel' ? v(t.Fy * 1000, 'S') : '', t.type === 'steel' ? v(t.Fu * 1000, 'S') : '', v(t.E, 'S'), t.nu, v(t.E / (2 * (1 + t.nu)), 'S'), v(t.gamma, 'G')]));
    sms.title('Secciones (propiedades efectivas, con modificadores)');
    sms.table(['Sección', 'Material', 'Forma', 'Perfil AISC', 'Nombre SI', `A (${u('A')})`, `I33 (${u('I')})`, `I22 (${u('I')})`, `J (${u('I')})`, `As2 (${u('A')})`, `As3 (${u('A')})`, 'Mod. I33', 'Mod. I22', `Peso (${u('FL')})`],
      m.sections.map(s => {
        const mt = m.materials.find(x => x.name === s.mat); let p = {};
        try { p = S().sectionProps(s, mt); } catch (e) { p = {}; }
        const md = s.mod || {};
        return [s.name, s.mat, s.shape, s.aisc || '', s.p ? s.p.nameSI : '', v(p.A, 'A'), v(p.Iz, 'I'), v(p.Iy, 'I'), v(p.J, 'I'), v(p.Asy, 'A'), v(p.Asz, 'A'), md.Iz ?? 1, md.Iy ?? 1, v(p.gamma * p.Ag * (p.mW || 1), 'FL')];
      }));
    add(wb, 'Materiales y secciones', sms);

    // Matrices por elemento
    const writeEl = (sh, e) => {
      const gl = e.dofs.map(d => res.dofLabels[d]);
      sh.title(`ELEMENTO E${e.id}:  N${res.nodes[e.ni].id} → N${res.nodes[e.nj].id}   sección ${e.sec}   L = ${v(e.L, 'L').toFixed(4)} ${u('L')}   Lf = ${v(e.Lf, 'L').toFixed(4)} ${u('L')}`);
      sh.blank();
      sh.matrix("k' local (tramo flexible, Timoshenko)", C.K(e.kf, tLc, tLc), ll, ll);
      if (e.krel) sh.matrix('k* local condensada por liberaciones (' + e.rel.map(i => ll[i]).join(', ') + ')', C.K(e.krel, tLc, tLc), ll, ll);
      if (e.H) { sh.matrix('H (transformación de brazos rígidos)', C.T(e.H, tLc, tLc), ll, ll); sh.matrix('k local = Hᵀ·k*·H (referida a los nodos)', C.K(e.kl, tLc, tLc), ll, ll); }
      sh.matrix('λ (matriz de transformación local ← global, adimensional)', e.lam, ll, gl);
      sh.matrix('λᵀ', e.lamT, gl, ll);
      sh.matrix('k global = λᵀ · k local · λ', C.K(e.kg, tLc, tLc), gl, gl);
      sh.blank();
    };
    const all = new Sheet();
    res.els.forEach(e => writeEl(all, e));
    add(wb, 'Matrices elementos', all);
    if (res.els.length <= 60) res.els.forEach(e => { const sh = new Sheet(); writeEl(sh, e); add(wb, 'E' + e.id, sh); });

    // K global
    const sk = new Sheet();
    sk.matrix('K global ensamblada (todos los GDL)', C.K(res.K, tF, tF), res.dofLabels, res.dofLabels);
    add(wb, 'K global', sk);

    // Partición libres / restringidos
    const fr = [], rs = [];
    res.restrained.forEach((r, i) => (r ? rs : fr).push(i));
    const sub = (A, r, c) => C.K(r.map(i => c.map(j => A[i][j])), C.sub(tF, r), C.sub(tF, c));
    const L = i => res.dofLabels[i];
    const sp = new Sheet();
    sp.title('Partición de K: f = GDL no restringidos, s = GDL restringidos (apoyos)');
    sp.matrix('Kff', sub(res.K, fr, fr), fr.map(L), fr.map(L));
    if (rs.length) { sp.matrix('Kfs', sub(res.K, fr, rs), fr.map(L), rs.map(L)); sp.matrix('Ksf', sub(res.K, rs, fr), rs.map(L), fr.map(L)); sp.matrix('Kss', sub(res.K, rs, rs), rs.map(L), rs.map(L)); }
    add(wb, 'K particionada', sp);

    // T y K reducida
    const st = new Sheet();
    const qL = res.rdofs.map(r => r.label);
    const Tm = res.dofLabels.map((_, i) => { const row = new Array(res.m).fill(0); res.Trows[i].forEach(([p, t]) => row[p] = t); return row; });
    st.matrix('T (u = T·q): restricciones y diafragmas rígidos', C.T(Tm, tF, tR), res.dofLabels, qL);
    st.matrix('K reducida = Tᵀ · K · T', C.K(res.Kr, tR, tR), qL, qL);
    add(wb, 'T y K reducida', st);

    // Por patrón
    const vF = (x, tp) => C.F(x, tp), vD = (x, tp) => C.D(x, tp);
    res.patterns.forEach(pt => {
      const sc = new Sheet();
      sc.title('Patrón de carga: ' + pt.name);
      sc.row(...unitsRow());
      const Fn = vF(pt.Fn, tF), Fe = vF(pt.Fe, tF), Ft = vF(pt.F, tF), uu = vD(pt.u, tF), Rr = vF(pt.R, tF);
      sc.table(['GDL', 'F nodal directa', 'F equivalente (elementos)', 'F total', 'u', 'Reacción R = K·u − F'], res.dofLabels.map((l, i) => [l, Fn[i], Fe[i], Ft[i], uu[i], res.restrained[i] ? Rr[i] : '']));
      sc.vector('F reducida = Tᵀ·F', vF(pt.Fr, tR), qL);
      sc.vector('q (desplazamientos independientes)', vD(pt.q, tR), qL);
      sc.title('Fuerzas de empotramiento (local, tramo flexible) y fuerzas finales por elemento');
      res.els.forEach((e, k) => {
        const lv = pt.elLoads[k], ef = pt.ef[k];
        sc.row(`E${e.id}`);
        sc.row('', ...ll);
        sc.row('f₀ empotramiento', ...vF(lv.fef0, tLc).map(clean));
        if (e.rel.length) sc.row('f₀ condensada', ...vF(lv.fef, tLc).map(clean));
        if (e.H) sc.row('Carga directa en zonas rígidas', ...vF(lv.Pd, tLc).map(clean));
        sc.row('Carga nodal equivalente local', ...vF(lv.Peq, tLc).map(clean));
        sc.row('u_e global', ...vD(ef.ue, tLc).map(clean));
        sc.row('u_e local = λ·u_e', ...vD(ef.dl, tLc).map(clean));
        if (e.H) sc.row('u en caras = H·λ·u_e', ...vD(ef.df, tLc).map(clean));
        sc.row('f = k·u + f₀ (local)', ...vF(ef.f, tLc).map(clean));
        sc.blank();
      });
      add(wb, 'Patrón ' + pt.name, sc);
    });
    // Combinaciones de carga
    const combos = (App.cases || []).filter(c => c.kind === 'combo' || c.kind === 'envelope');
    if (combos.length) {
      const sd = new Sheet();
      sd.title('Combinaciones de carga');
      sd.row(...unitsRow());
      sd.row('Sismo espectral: entra con signo ± → resultado = estático ± |factor|·E. Envolvente = máximo y mínimo de los casos incluidos.');
      sd.row('Con sismo, desplazamientos elásticos (sin /R); fuerzas y reacciones de diseño (÷R y escala de cortante si se aplicó).');
      sd.blank();
      sd.table(['Combinación', 'Tipo', 'Definición'], (m.combos || []).map(c => [c.name, c.kind === 'envelope' ? 'Envolvente' : 'Lineal',
        c.kind === 'envelope' ? (c.members || []).join(' ; ') : (c.terms || []).map(t => `${t.f}·${t.dir ? '(±Sismo ' + t.dir + ')' : t.pat}`).join(' + ')]));
      add(wb, 'Combinaciones', sd);
      const llab = localLabels(is2D);
      const DDIM = { M3: 'M', M2: 'M', T: 'M', V2: 'F', V3: 'F', N: 'F' };
      combos.forEach(cs => {
        const sh = new Sheet(), Ud = S().caseNodal(res, cs, 'u'), R = S().caseNodal(res, cs, 'R');
        const uMx = vD(Ud.max, tF), uMn = vD(Ud.min, tF), rMx = vF(R.max, tF), rMn = vF(R.min, tF);
        sh.title('Resultados: ' + cs.name + (cs.env ? '  (máximo / mínimo)' : ''));
        sh.row(...unitsRow());
        sh.table(['GDL', 'u máx', 'u mín', 'Reacción máx', 'Reacción mín'], res.dofLabels.map((l, i) => [l, uMx[i], uMn[i], res.restrained[i] ? rMx[i] : '', res.restrained[i] ? rMn[i] : '']));
        sh.title('Fuerzas en extremos (local, caras de nudo)');
        sh.row('Elem', ...llab.map((t, i) => `${t} máx (${u(ldim(i))})`), ...llab.map((t, i) => `${t} mín (${u(ldim(i))})`));
        res.els.forEach((e, k) => { const f = S().caseEnd(res, cs, k); sh.row('E' + e.id, ...vF(f.max, tLc).map(clean), ...vF(f.min, tLc).map(clean)); });
        sh.blank();
        sh.title('Extremos de diagramas internos a lo largo del elemento');
        const cmp = is2D ? ['M3', 'V2', 'N'] : ['M3', 'V2', 'N', 'M2', 'V3', 'T'];
        sh.row('Elem', ...cmp.flatMap(c => [`${c} máx (${u(DDIM[c])})`, `${c} mín (${u(DDIM[c])})`]));
        res.els.forEach((e, k) => {
          const stt = S().caseStations(res, App.spec, cs, k, 41);
          const mx = c => Math.max(...stt.map(s => s.max[c])), mn = c => Math.min(...stt.map(s => s.min[c]));
          sh.row('E' + e.id, ...cmp.flatMap(c => [clean(v(mx(c), DDIM[c])), clean(v(mn(c), DDIM[c]))]));
        });
        add(wb, 'C ' + cs.name, sh);
      });
    }
    App.download('analisis_matricial.xlsx', new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }));
  }

  // ------------------------------------------------------------------
  function modal(App) {
    if (!needXLSX()) return;
    const U = Un(), u = d => U.u(d), v = (x, d) => U.v(x, d);
    const res = App.res, md = App.modal, spc = App.spec, is2D = res.is2D, wb = XLSX.utils.book_new();
    const C = converter(res), tF = C.types.full, tR = C.types.red, tLc = C.types.loc;
    const qL = res.rdofs.map(r => r.label), aL = md.aSet.map(i => qL[i]), bL = md.bSet.map(i => qL[i]);
    const tA = C.sub(tR, md.aSet), tB = C.sub(tR, md.bSet);
    // Masas
    const sm = new Sheet();
    sm.title('Masas concentradas por nodo');
    sm.row(...unitsRow());
    sm.table(['Nodo', `X (${u('L')})`, `Y (${u('L')})`, `Z (${u('L')})`, `Masa traslacional (${u('m')})`, 'Diafragma'], res.nodes.map((nd, k) => [nd.id, v(nd.x, 'L'), v(nd.y || 0, 'L'), v(nd.z, 'L'), v(res.nodeMass[k], 'm'), nd.diaph || '']));
    if (res.masters.length) sm.table(['Diafragma', `Xcm (${u('L')})`, `Ycm (${u('L')})`, `Z (${u('L')})`, `Masa (${u('m')})`, `Inercia rot. (${u('mr')})`], res.masters.map(mm => {
      const iU = mm.idx[0], iR = mm.idx[5]; return [mm.name, v(mm.xc, 'L'), v(mm.yc, 'L'), v(mm.zc, 'L'), v(md.Mr[iU][iU], 'm'), iR !== undefined ? v(md.Mr[iR][iR], 'mr') : ''];
    }));
    sm.vector('Diagonal de M (todos los GDL)', C.F(md.Mfull, tF).map((x, i) => x * (tF(i) ? U.fac('L') : 1)), res.dofLabels, `m (${u('m')}; giros ${u('mr')})`);
    sm.matrix('M reducida = Tᵀ·M·T', C.K(md.Mr, tR, tR), qL, qL);
    add(wb, 'Masas', sm);
    // Condensación
    const sc = new Sheet();
    sc.title('Condensación estática (Guyan): a = GDL con masa, b = GDL sin masa');
    sc.row(...unitsRow());
    sc.row('K_c = Kaa − Kab·Kbb⁻¹·Kba;   ub = −Kbb⁻¹·Kba·ua');
    sc.blank();
    sc.matrix('K reducida (independientes)', C.K(res.Kr, tR, tR), qL, qL);
    sc.matrix('Kaa', C.K(md.Kaa, tA, tA), aL, aL);
    if (bL.length) { sc.matrix('Kab', C.K(md.Kab, tA, tB), aL, bL); sc.matrix('Kbb', C.K(md.Kbb, tB, tB), bL, bL); sc.matrix('Kbb⁻¹·Kba', C.T(md.KbbInvKba, tB, tA), bL, aL); }
    sc.matrix('K condensada', C.K(md.Kc, tA, tA), aL, aL);
    sc.matrix('M (GDL con masa) Maa', C.K(md.Maa, tA, tA), aL, aL);
    add(wb, 'Condensación', sc);
    // Modos
    const so = new Sheet();
    so.title('Problema de valores propios [K_c − ω²·Maa]·Φ = 0  (Eigen: Householder + QL, Φᵀ·M·Φ = I)');
    so.row(...unitsRow());
    const ds = md.dirs;
    so.table(['Modo', 'ω² (rad²/s²)', 'ω (rad/s)', 'f (Hz)', 'T (s)', ...ds.map(d => `Γ${d} (${u('sm')})`), ...ds.map(d => `M ef ${d} (${u('m')})`), ...ds.map(d => '% M' + d), ...ds.map(d => 'Σ% M' + d)],
      md.modes.map(mo => [mo.n, mo.lambda, mo.omega, mo.f, mo.T, ...ds.map(d => v(mo.gamma[d], 'sm')), ...ds.map(d => v(mo.mef[d], 'm')), ...ds.map(d => mo.ratio[d] * 100), ...ds.map(d => mo.cum[d] * 100)]));
    so.table(['Dirección', `Masa total participante (${u('m')})`], ds.map(d => [d, v(md.Mtot[d], 'm')]));
    add(wb, 'Modos', so);
    // Formas modales
    const sf = new Sheet();
    const mh = md.modes.map(mo => 'Modo ' + mo.n);
    sf.row(...unitsRow());
    sf.row('Modos normalizados respecto a la masa: traslaciones en ' + u('L') + '/√' + u('m') + ', giros en rad/√' + u('m') + '.');
    sf.matrix('Φ en GDL con masa (normalizado a masa)', C.Phi(md.modes[0].phiA.map((_, i) => md.modes.map(mo => mo.phiA[i])), tA), aL, mh);
    sf.matrix('Φ en GDL independientes (incluye recuperación de GDL condensados)', C.Phi(qL.map((_, i) => md.modes.map(mo => mo.phi[i])), tR), qL, mh);
    sf.matrix('Φ en todos los GDL nodales (u = T·φ)', C.Phi(res.dofLabels.map((_, i) => md.modes.map(mo => mo.uFull[i])), tF), res.dofLabels, mh);
    add(wb, 'Formas modales', sf);
    // Espectro
    if (spc) {
      const sp = spc.sp, ss = new Sheet();
      ss.title('Espectro de diseño ' + (sp.type === 'user' ? '(usuario)' : 'NSR-10 A.2.6'));
      if (sp.type !== 'user') { const p = S().nsrParams(sp); ss.row('Aa', sp.Aa, 'Av', sp.Av, 'Fa', sp.Fa, 'Fv', sp.Fv, 'I', sp.I); ss.row('T0', p.T0, 'TC', p.TC, 'TL', p.TL); }
      ss.row('ξ', sp.xi, 'Combinación', sp.comb, 'R', sp.R);
      ss.blank();
      const tb = []; for (let i = 0; i <= 300; i++) { const T = i * 0.02; tb.push([T, S().spectrumSa(T, sp, false)]); }
      ss.table(['T (s)', 'Sa (g)'], tb);
      add(wb, 'Espectro', ss);
      const rhoS = new Sheet();
      rhoS.matrix('Coeficientes de correlación modal ρij (' + sp.comb + ')', spc.rho, mh, mh, sp.comb === 'CQC' ? 'ρij = 8ξ²(1+r)r^1.5 / [(1−r²)² + 4ξ²r(1+r)²],  r = ωj/ωi' : 'SRSS: ρ = δij');
      add(wb, 'Correlación modal', rhoS);
      const ll = localLabels(is2D);
      for (const d of Object.keys(spc.dirs)) {
        const D = spc.dirs[d], sh = new Sheet();
        sh.title(`Respuesta espectral — sismo en dirección ${d}`);
        sh.row(...unitsRow());
        sh.table(['Modo', 'T (s)', 'Sa (g)', `A = Sa·g (${u('L')}/s²)`, `Sd = A/ω² (${u('D')})`, `Γ (${u('sm')})`, `Γ·Sd (${u('D')}·${u('sm')})`, `Vb modal (${u('F')})`],
          md.modes.map((mo, i) => { const p = D.perMode[i]; return [mo.n, mo.T, p.Sa, v(p.A, 'L'), v(p.Sd, 'D'), v(mo.gamma[d], 'sm'), v(p.fac, 'D') / U.fac('sm'), v(p.Vb, 'F')]; }));
        sh.row('Vt combinado (elástico)', v(D.Vb, 'F'), u('F'));
        sh.row('Modo dominante', D.fundamental, 'T', D.Tf, 'Sa', D.SaF);
        sh.row('FHE  Vs = Sa·g·M', v(D.Vs, 'F'), u('F'));
        sh.row('Vt / Vs', D.Vb / D.Vs);
        sh.row('Factor de escala (mínimo ' + sp.minShearPct + ' %)', D.scale, sp.applyScale ? 'aplicado' : 'no aplicado');
        sh.row('Factor sobre fuerzas = escala / R', D.fScale);
        sh.blank();
        sh.title(`Desplazamientos modales u_n = Γn·φn·Sdn y combinados (elásticos; traslaciones en ${u('D')}, giros en rad)`);
        const dD = (x, i) => (tF(i) ? v(x, 'D') : x);
        sh.table(['GDL', ...mh, 'Combinado ' + sp.comb], res.dofLabels.map((l, i) => [l, ...D.perMode.map(p => dD(p.u[i], i)), dD(D.U[i], i)]));
        sh.title(`Fuerzas inerciales modales f_n = M·φn·Γn·An (GDL independientes; ${u('F')} y ${u('M')})`);
        const fin = D.perMode.map(p => C.F(p.finert, tR));
        sh.table(['GDL', ...mh], qL.map((l, i) => [l, ...fin.map(f => f[i])]));
        sh.title('Cortante por nivel (diseño = combinado × factor)');
        sh.table([`Z (${u('L')})`, ...mh.map(x => `${x} (${u('F')})`), `V combinado diseño (${u('F')})`], D.stories.map(s => [v(s.z, 'L'), ...s.perMode.map(x => v(x, 'F')), v(s.V, 'F')]));
        sh.title('Derivas (elásticas, combinadas modo a modo)');
        sh.table(['Nodo', 'Nodo inferior', `Z (${u('L')})`, `h (${u('L')})`, `Δx (${u('D')})`, `Δy (${u('D')})`, `Δ total (${u('D')})`, 'Δ/h (%)', 'Cumple ≤ ' + App.model.driftLimit + ' %'],
          D.drifts.map(x => [x.node, x.below, v(x.z, 'L'), v(x.h, 'L'), v(x.dx, 'D'), v(x.dy, 'D'), v(x.total, 'D'), x.ratio * 100, x.ratio * 100 <= App.model.driftLimit ? 'Sí' : 'NO']));
        sh.title('Reacciones combinadas (diseño)');
        const Rc = C.F(D.R, tF);
        sh.table(['GDL', 'R'], res.dofLabels.map((l, i) => [l, Rc[i]]).filter((_, i) => res.restrained[i]));
        sh.title('Fuerzas combinadas en extremos de elementos (local, diseño, valores absolutos)');
        sh.table(['Elem', ...ll.map((t, i) => `${t} (${u(tLc(i) ? 'F' : 'M')})`)], res.els.map((e, k) => ['E' + e.id, ...C.F(D.EF[k], tLc)]));
        add(wb, 'Espectral ' + d, sh);
      }
    }
    App.download('analisis_modal_espectral.xlsx', new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }));
  }

  root.Export = { matricial, modal, _converter: converter };
})(window);
