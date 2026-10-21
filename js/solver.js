/* =====================================================================
   Motor de análisis matricial + modal (Eigen) + espectral
   Unidades consistentes: kN, m, s  (masa en kN·s²/m = t)
   ===================================================================== */
(function (root) {
  'use strict';
  const GRAV = 9.80665;

  // ------------------------------------------------------------------
  // Álgebra lineal densa
  // ------------------------------------------------------------------
  function zeros(n, m) { const A = new Array(n); for (let i = 0; i < n; i++) A[i] = new Array(m).fill(0); return A; }
  function eye(n) { const A = zeros(n, n); for (let i = 0; i < n; i++) A[i][i] = 1; return A; }
  function transpose(A) { const n = A.length, m = n ? A[0].length : 0, B = zeros(m, n); for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) B[j][i] = A[i][j]; return B; }
  function mul(A, B) {
    const n = A.length, k = B.length, m = k ? B[0].length : 0, C = zeros(n, m);
    for (let i = 0; i < n; i++) { const Ai = A[i], Ci = C[i]; for (let p = 0; p < k; p++) { const a = Ai[p]; if (a === 0) continue; const Bp = B[p]; for (let j = 0; j < m; j++) Ci[j] += a * Bp[j]; } }
    return C;
  }
  function mulVec(A, x) { return A.map(r => { let s = 0; for (let j = 0; j < r.length; j++) s += r[j] * x[j]; return s; }); }
  function triple(At, K, A) { return mul(mul(At, K), A); }
  function blockDiag(R, times) {
    const r = R.length, M = zeros(r * times, r * times);
    for (let t = 0; t < times; t++) for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) M[t * r + i][t * r + j] = R[i][j];
    return M;
  }

  /** Gauss con pivoteo parcial. B: vector o matriz (filas). */
  function solve(A, B) {
    const n = A.length;
    const isVec = !Array.isArray(B[0]);
    if (n === 0) return isVec ? [] : [];
    const k = isVec ? 1 : B[0].length;
    const M = A.map(r => r.slice());
    const X = isVec ? B.map(v => [v]) : B.map(r => r.slice());
    let maxd = 0; for (let i = 0; i < n; i++) maxd = Math.max(maxd, Math.abs(A[i][i]));
    const tol = 1e-10 * (maxd || 1);
    const perm = [...Array(n).keys()];
    for (let c = 0; c < n; c++) {
      let p = c, mv = Math.abs(M[c][c]);
      for (let r = c + 1; r < n; r++) { const v = Math.abs(M[r][c]); if (v > mv) { mv = v; p = r; } }
      if (mv < tol) { const e = new Error('Matriz singular (estructura inestable o mecanismo)'); e.dof = c; throw e; }
      if (p !== c) { [M[p], M[c]] = [M[c], M[p]]; [X[p], X[c]] = [X[c], X[p]]; [perm[p], perm[c]] = [perm[c], perm[p]]; }
      const Mc = M[c], Xc = X[c], piv = Mc[c];
      for (let r = c + 1; r < n; r++) {
        const Mr = M[r], f = Mr[c] / piv; if (f === 0) continue;
        for (let j = c; j < n; j++) Mr[j] -= f * Mc[j];
        const Xr = X[r]; for (let j = 0; j < k; j++) Xr[j] -= f * Xc[j];
      }
    }
    for (let c = n - 1; c >= 0; c--) {
      const Mc = M[c], Xc = X[c];
      for (let j = 0; j < k; j++) { let s = Xc[j]; for (let q = c + 1; q < n; q++) s -= Mc[q] * X[q][j]; Xc[j] = s / Mc[c]; }
    }
    return isVec ? X.map(r => r[0]) : X;
  }
  function inverse(A) { return solve(A, eye(A.length)); }

  function cholesky(A) {
    const n = A.length, L = zeros(n, n);
    for (let j = 0; j < n; j++) {
      let s = A[j][j]; for (let k = 0; k < j; k++) s -= L[j][k] * L[j][k];
      if (s <= 0) throw new Error('Matriz de masa no definida positiva');
      L[j][j] = Math.sqrt(s);
      for (let i = j + 1; i < n; i++) { let t = A[i][j]; for (let k = 0; k < j; k++) t -= L[i][k] * L[j][k]; L[i][j] = t / L[j][j]; }
    }
    return L;
  }
  function forwardSub(L, B) { // L X = B  (B matriz)
    const n = L.length, m = B[0].length, X = zeros(n, m);
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { let s = B[i][j]; for (let k = 0; k < i; k++) s -= L[i][k] * X[k][j]; X[i][j] = s / L[i][i]; }
    return X;
  }
  function backSubT(L, B) { // L^T X = B
    const n = L.length, m = B[0].length, X = zeros(n, m);
    for (let j = 0; j < m; j++) for (let i = n - 1; i >= 0; i--) { let s = B[i][j]; for (let k = i + 1; k < n; k++) s -= L[k][i] * X[k][j]; X[i][j] = s / L[i][i]; }
    return X;
  }

  /** Eigen simétrico: Householder (tred2) + QL implícito (tql2). Devuelve valores ascendentes y vectores en columnas. */
  function eigSym(Ain) {
    const n = Ain.length;
    const V = Ain.map(r => r.slice()), d = new Array(n).fill(0), e = new Array(n).fill(0);
    if (n === 0) return { values: [], vectors: [] };
    if (n === 1) return { values: [V[0][0]], vectors: [[1]] };
    // tred2
    for (let j = 0; j < n; j++) d[j] = V[n - 1][j];
    for (let i = n - 1; i > 0; i--) {
      let scale = 0, h = 0;
      for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
      if (scale === 0) {
        e[i] = d[i - 1];
        for (let j = 0; j < i; j++) { d[j] = V[i - 1][j]; V[i][j] = 0; V[j][i] = 0; }
      } else {
        for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
        let f = d[i - 1], g = Math.sqrt(h); if (f > 0) g = -g;
        e[i] = scale * g; h -= f * g; d[i - 1] = f - g;
        for (let j = 0; j < i; j++) e[j] = 0;
        for (let j = 0; j < i; j++) {
          f = d[j]; V[j][i] = f; g = e[j] + V[j][j] * f;
          for (let k = j + 1; k <= i - 1; k++) { g += V[k][j] * d[k]; e[k] += V[k][j] * f; }
          e[j] = g;
        }
        f = 0;
        for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
        const hh = f / (h + h);
        for (let j = 0; j < i; j++) e[j] -= hh * d[j];
        for (let j = 0; j < i; j++) {
          f = d[j]; g = e[j];
          for (let k = j; k <= i - 1; k++) V[k][j] -= (f * e[k] + g * d[k]);
          d[j] = V[i - 1][j]; V[i][j] = 0;
        }
      }
      d[i] = h;
    }
    for (let i = 0; i < n - 1; i++) {
      V[n - 1][i] = V[i][i]; V[i][i] = 1;
      const h = d[i + 1];
      if (h !== 0) {
        for (let k = 0; k <= i; k++) d[k] = V[k][i + 1] / h;
        for (let j = 0; j <= i; j++) {
          let g = 0; for (let k = 0; k <= i; k++) g += V[k][i + 1] * V[k][j];
          for (let k = 0; k <= i; k++) V[k][j] -= g * d[k];
        }
      }
      for (let k = 0; k <= i; k++) V[k][i + 1] = 0;
    }
    for (let j = 0; j < n; j++) { d[j] = V[n - 1][j]; V[n - 1][j] = 0; }
    V[n - 1][n - 1] = 1; e[0] = 0;
    // tql2
    for (let i = 1; i < n; i++) e[i - 1] = e[i];
    e[n - 1] = 0;
    let f = 0, tst1 = 0; const eps = Math.pow(2, -52);
    for (let l = 0; l < n; l++) {
      tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
      let m = l; while (m < n) { if (Math.abs(e[m]) <= eps * tst1) break; m++; }
      if (m > l) {
        let iter = 0;
        do {
          if (++iter > 300) throw new Error('Eigen: no converge');
          let g = d[l], p = (d[l + 1] - g) / (2 * e[l]), r = Math.hypot(p, 1); if (p < 0) r = -r;
          d[l] = e[l] / (p + r); d[l + 1] = e[l] * (p + r);
          const dl1 = d[l + 1]; let h = g - d[l];
          for (let i = l + 2; i < n; i++) d[i] -= h;
          f += h;
          p = d[m]; let c = 1, c2 = c, c3 = c; const el1 = e[l + 1]; let s = 0, s2 = 0;
          for (let i = m - 1; i >= l; i--) {
            c3 = c2; c2 = c; s2 = s;
            g = c * e[i]; h = c * p; r = Math.hypot(p, e[i]);
            e[i + 1] = s * r; s = e[i] / r; c = p / r;
            p = c * d[i] - s * g; d[i + 1] = h + s * (c * g + s * d[i]);
            for (let k = 0; k < n; k++) { h = V[k][i + 1]; V[k][i + 1] = s * V[k][i] + c * h; V[k][i] = c * V[k][i] - s * h; }
          }
          p = -s * s2 * c3 * el1 * e[l] / dl1; e[l] = s * p; d[l] = c * p;
        } while (Math.abs(e[l]) > eps * tst1);
      }
      d[l] += f; e[l] = 0;
    }
    const idx = [...Array(n).keys()].sort((a, b) => d[a] - d[b]);
    return { values: idx.map(i => d[i]), vectors: V.map(row => idx.map(i => row[i])) };
  }

  // ------------------------------------------------------------------
  // Secciones y elementos
  // ------------------------------------------------------------------
  function sectionProps(sec, mat) {
    let A, Iy, Iz, J, Asy, Asz;
    if (sec.shape === 'rect') {
      const b = +sec.b, h = +sec.h; // h // eje local 2 (y), b // eje local 3 (z)
      A = b * h; Iz = b * h ** 3 / 12; Iy = h * b ** 3 / 12;
      const a = Math.max(b, h), c = Math.min(b, h);
      J = a * c ** 3 * (1 / 3 - 0.21 * (c / a) * (1 - c ** 4 / (12 * a ** 4)));
      Asy = Asz = 5 / 6 * A;
    } else if (sec.shape === 'circ') {
      const D = +sec.D; A = Math.PI * D * D / 4; Iy = Iz = Math.PI * D ** 4 / 64; J = 2 * Iy; Asy = Asz = 0.9 * A;
    } else if (sec.shape === 'I') {
      const d = +sec.h, bf = +sec.b, tf = +sec.tf, tw = +sec.tw, hw = d - 2 * tf;
      A = 2 * bf * tf + hw * tw;
      Iz = (bf * d ** 3 - (bf - tw) * hw ** 3) / 12;
      Iy = 2 * tf * bf ** 3 / 12 + hw * tw ** 3 / 12;
      J = (2 * bf * tf ** 3 + (d - tf) * tw ** 3) / 3;
      Asy = d * tw; Asz = 5 / 3 * bf * tf;
    } else if (sec.shape === 'tube') { // rectangular hueco
      const h = +sec.h, b = +sec.b, t = +sec.t;
      A = b * h - (b - 2 * t) * (h - 2 * t);
      Iz = (b * h ** 3 - (b - 2 * t) * (h - 2 * t) ** 3) / 12;
      Iy = (h * b ** 3 - (h - 2 * t) * (b - 2 * t) ** 3) / 12;
      const Am = (b - t) * (h - t); J = 4 * Am * Am * t / (2 * ((b - t) + (h - t)));
      Asy = 2 * h * t; Asz = 2 * b * t;
    } else if (sec.shape === 'ring') { // circular hueca
      const D = +sec.D, t = +sec.t, Di = D - 2 * t;
      A = Math.PI / 4 * (D * D - Di * Di); Iy = Iz = Math.PI / 64 * (D ** 4 - Di ** 4); J = 2 * Iy; Asy = Asz = A / 2;
    } else if (sec.shape === 'T') { // viga T de concreto (aleta arriba)
      const bw = +sec.bw, h = +sec.h, bf = +sec.bf, hf = +sec.hf, hw = h - hf;
      const A1 = bf * hf, A2 = bw * hw; A = A1 + A2;
      const yc = (A1 * hf / 2 + A2 * (hf + hw / 2)) / A;
      Iz = bf * hf ** 3 / 12 + A1 * (yc - hf / 2) ** 2 + bw * hw ** 3 / 12 + A2 * (hf + hw / 2 - yc) ** 2;
      Iy = hf * bf ** 3 / 12 + hw * bw ** 3 / 12;
      J = rectJ(bf, hf) + rectJ(bw, hw);
      Asy = 5 / 6 * bw * h; Asz = 5 / 6 * A;
    } else if (sec.shape === 'aisc') { // perfil de la base de datos AISC (propiedades guardadas en sec.p)
      const p = sec.p || {};
      A = +p.A; Iz = +p.Iz; Iy = +p.Iy; J = +p.J || 0; Asy = +p.Asy || 0; Asz = +p.Asz || 0;
      if (!(A > 0)) throw new Error(`Sección ${sec.name}: perfil AISC sin propiedades`);
    } else { // general
      A = +sec.A; Iy = +sec.Iy; Iz = +sec.Iz; J = +sec.J; Asy = +sec.Asy || 0; Asz = +sec.Asz || 0;
    }
    const md = Object.assign({ A: 1, Iy: 1, Iz: 1, J: 1, As: 1, M: 1, W: 1 }, sec.mod || {});
    const E = +mat.E, nu = +mat.nu, G = mat.G ? +mat.G : E / (2 * (1 + nu));
    return {
      E, G, gamma: +mat.gamma || 0,
      Ag: A, A: A * md.A, Iy: Iy * md.Iy, Iz: Iz * md.Iz, J: J * md.J,
      Asy: Asy * md.As, Asz: Asz * md.As, mM: md.M, mW: md.W,
      Iy0: Iy, Iz0: Iz, J0: J, Asy0: Asy, Asz0: Asz
    };
  }

  function rectJ(b, h) { const a = Math.max(b, h), c = Math.min(b, h); return a > 0 ? a * c ** 3 * (1 / 3 - 0.21 * (c / a) * (1 - c ** 4 / (12 * a ** 4))) : 0; }

  /** Dimensiones exteriores (h // eje 2, b // eje 3) para dibujo, extrusión y brazos rígidos automáticos. */
  function secDims(s) {
    switch (s.shape) {
      case 'circ': case 'ring': return { h: +s.D, b: +s.D };
      case 'T': return { h: +s.h, b: +s.bf };
      case 'aisc': { const p = s.p || {}; const b = p.b || (p.fam === '2L' ? 2 * (p.leg || p.h) + 0.01 : p.h); return { h: +p.h || 0.2, b: +b || 0.2 }; }
      case 'gen': return +s.h > 0 ? { h: +s.h, b: +s.b || +s.h } : { h: s.A > 0 ? Math.sqrt(12 * s.Iz / s.A) : 0.3, b: s.A > 0 ? Math.sqrt(12 * s.Iy / s.A) : 0.3 };
      default: return { h: +s.h, b: +s.b };
    }
  }

  /** Desplazamiento del centroide respecto a la línea de nudos según el punto cardinal (1–11, convención CSI).
   *  1 inf-izq, 2 inf-centro, 3 inf-der, 4 medio-izq, 5 medio-centro, 6 medio-der, 7 sup-izq, 8 sup-centro, 9 sup-der, 10 centroide.
   *  "Izquierda" = lado −3 local. Para d2 > 0 el centroide queda hacia +2. */
  function insertionOffset(el, sec, defCp) {
    const cp = +el.cardinal || defCp || 10;
    let d2 = 0, d3 = 0;
    if (cp >= 1 && cp <= 9) {
      const { h, b } = secDims(sec);
      const row = Math.floor((cp - 1) / 3), col = (cp - 1) % 3; // row 0 = inferior, 2 = superior; col 0 = izq
      d2 = row === 0 ? h / 2 : row === 2 ? -h / 2 : 0;
      d3 = col === 0 ? b / 2 : col === 2 ? -b / 2 : 0;
    }
    d2 += +el.insD2 || 0; d3 += +el.insD3 || 0;
    return { d2, d3 };
  }

  function phiShear(E, I, G, As, L, shear) { return (shear && As > 0 && G > 0) ? 12 * E * I / (G * As * L * L) : 0; }

  function k2D(p, L, shear) {
    const phi = phiShear(p.E, p.Iz, p.G, p.Asy, L, shear);
    const a = p.E * p.A / L, b = p.E * p.Iz / (L ** 3 * (1 + phi));
    const k = [
      [a, 0, 0, -a, 0, 0],
      [0, 12 * b, 6 * L * b, 0, -12 * b, 6 * L * b],
      [0, 6 * L * b, (4 + phi) * L * L * b, 0, -6 * L * b, (2 - phi) * L * L * b],
      [-a, 0, 0, a, 0, 0],
      [0, -12 * b, -6 * L * b, 0, 12 * b, -6 * L * b],
      [0, 6 * L * b, (2 - phi) * L * L * b, 0, -6 * L * b, (4 + phi) * L * L * b]];
    return { k, phiY: phi, phiZ: 0 };
  }

  function k3D(p, L, shear) {
    const py = phiShear(p.E, p.Iz, p.G, p.Asy, L, shear); // flexión plano xy (alrededor de z)
    const pz = phiShear(p.E, p.Iy, p.G, p.Asz, L, shear); // flexión plano xz (alrededor de y)
    const k = zeros(12, 12);
    const set = (i, j, v) => { k[i][j] = v; k[j][i] = v; };
    const ea = p.E * p.A / L, gj = p.G * p.J / L;
    const az = p.E * p.Iz / (L ** 3 * (1 + py)), ay = p.E * p.Iy / (L ** 3 * (1 + pz));
    set(0, 0, ea); set(0, 6, -ea); set(6, 6, ea);
    set(3, 3, gj); set(3, 9, -gj); set(9, 9, gj);
    set(1, 1, 12 * az); set(1, 5, 6 * L * az); set(1, 7, -12 * az); set(1, 11, 6 * L * az);
    set(5, 5, (4 + py) * L * L * az); set(5, 7, -6 * L * az); set(5, 11, (2 - py) * L * L * az);
    set(7, 7, 12 * az); set(7, 11, -6 * L * az); set(11, 11, (4 + py) * L * L * az);
    set(2, 2, 12 * ay); set(2, 4, -6 * L * ay); set(2, 8, -12 * ay); set(2, 10, -6 * L * ay);
    set(4, 4, (4 + pz) * L * L * ay); set(4, 8, 6 * L * ay); set(4, 10, (2 - pz) * L * L * ay);
    set(8, 8, 12 * ay); set(8, 10, 6 * L * ay); set(10, 10, (4 + pz) * L * L * ay);
    return { k, phiY: py, phiZ: pz };
  }

  /** Ejes locales 3D (convención tipo SAP2000): 1 a lo largo del elemento; 2 en el plano vertical (o // X global si es vertical). */
  function localAxes3D(dx, dy, dz, L, betaDeg) {
    const ex = [dx / L, dy / L, dz / L];
    let ey;
    if (Math.abs(ex[2]) > 1 - 1e-6) ey = [1, 0, 0];
    else { const d = ex[2]; ey = [-d * ex[0], -d * ex[1], 1 - d * ex[2]]; const n = Math.hypot(...ey); ey = ey.map(v => v / n); }
    let ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
    const b = (betaDeg || 0) * Math.PI / 180;
    if (b) {
      const c = Math.cos(b), s = Math.sin(b);
      const ey2 = ey.map((v, i) => c * v + s * ez[i]), ez2 = ey.map((v, i) => -s * v + c * ez[i]);
      ey = ey2; ez = ez2;
    }
    return [ex, ey, ez];
  }

  /** Fuerzas de empotramiento (FEF) por flexión en un plano, exactas Timoshenko, vía flexibilidad del voladizo. */
  //  w: carga uniforme en todo el tramo (número) o lista de tramos [{x1, x2, w}] (carga uniforme parcial).
  function bendFEF(EI, GAs, L, w, pts) {
    const ig = (GAs > 0 && isFinite(GAs)) ? 1 / GAs : 0;
    let v0 = 0, t0 = 0, Ptot = 0, Mload = 0;
    const segs = Array.isArray(w) ? w : (w ? [{ x1: 0, x2: L, w }] : []);
    const F = x => L * x ** 3 - x ** 4 / 4;
    for (const sg of segs) {
      const q = sg.w, x1 = sg.x1, x2 = sg.x2; if (!q || x2 <= x1) continue;
      v0 += q * (F(x2) - F(x1)) / (6 * EI) + q * (x2 * x2 - x1 * x1) / 2 * ig;
      t0 += q * (x2 ** 3 - x1 ** 3) / (6 * EI);
      Ptot += q * (x2 - x1); Mload += q * (x2 * x2 - x1 * x1) / 2;
    }
    for (const q of pts) {
      if (!q.P) continue; const x = q.x;
      v0 += q.P * x * x * (3 * L - x) / (6 * EI) + q.P * x * ig; t0 += q.P * x * x / (2 * EI); Ptot += q.P; Mload += q.P * x;
    }
    const f11 = L ** 3 / (3 * EI) + L * ig, f12 = L * L / (2 * EI), f22 = L / EI, det = f11 * f22 - f12 * f12;
    const V2 = -(f22 * v0 - f12 * t0) / det, M2 = -(-f12 * v0 + f11 * t0) / det;
    return [-(Ptot + V2), -M2 - V2 * L - Mload, V2, M2];
  }

  /** Condensación estática de GDL liberados (articulaciones). */
  function makeCondenser(k, rel) {
    const n = k.length;
    if (!rel.length) return { k, cond: f => f.slice(), rel };
    const keep = [...Array(n).keys()].filter(i => !rel.includes(i));
    const krr = rel.map(i => rel.map(j => k[i][j]));
    let krrInv;
    try { krrInv = inverse(krr); } catch (e) { throw new Error('Liberaciones inestables en el elemento (p. ej. axial o torsión liberada en ambos extremos)'); }
    const kc = zeros(n, n);
    for (const i of keep) for (const j of keep) {
      let s = k[i][j];
      for (let a = 0; a < rel.length; a++) { const kia = k[i][rel[a]]; if (!kia) continue; for (let b = 0; b < rel.length; b++) s -= kia * krrInv[a][b] * k[rel[b]][j]; }
      kc[i][j] = s;
    }
    const cond = f => {
      const y = rel.map((_, a) => { let s = 0; for (let b = 0; b < rel.length; b++) s += krrInv[a][b] * f[rel[b]]; return s; });
      const out = new Array(n).fill(0);
      for (const i of keep) { let s = f[i]; for (let a = 0; a < rel.length; a++) s -= k[i][rel[a]] * y[a]; out[i] = s; }
      return out;
    };
    return { k: kc, cond, rel };
  }

  // ------------------------------------------------------------------
  // Análisis estático
  // ------------------------------------------------------------------
  function analyze(model) {
    const is2D = model.mode === '2D';
    const dpn = is2D ? 3 : 6;
    const cmap = is2D ? [0, 2, 4] : [0, 1, 2, 3, 4, 5];
    const relMap = is2D ? [0, 1, 5] : [0, 1, 2, 3, 4, 5]; // índice local -> (P,V2,V3,T,M2,M3)
    const dofNames = is2D ? ['UX', 'UZ', 'θ'] : ['UX', 'UY', 'UZ', 'RX', 'RY', 'RZ'];
    const set = Object.assign({ shear: true, rigidFactor: 1, autoOffsets: true, beamClearMass: true }, model.settings || {});
    const nodes = model.nodes, nn = nodes.length, n = nn * dpn;
    if (!nn) throw new Error('El modelo no tiene nodos');
    if (!model.elements.length) throw new Error('El modelo no tiene elementos');
    const nodeIdx = new Map(nodes.map((nd, i) => [nd.id, i]));
    const matBy = new Map(model.materials.map(m => [m.name, m]));
    const secBy = new Map(model.sections.map(s => [s.name, s]));
    const warnings = [];
    const dofLabels = [];
    for (const nd of nodes) for (let d = 0; d < dpn; d++) dofLabels.push(`N${nd.id}-${dofNames[d]}`);

    // ---- geometría previa: ejes locales, dimensiones y punto de inserción (para brazos automáticos)
    const pre = model.elements.map(el => {
      const ni = nodeIdx.get(el.i), nj = nodeIdx.get(el.j);
      if (ni === undefined || nj === undefined) throw new Error(`Elemento ${el.id}: nodo inexistente`);
      const A = nodes[ni], B = nodes[nj];
      const dx = B.x - A.x, dy = is2D ? 0 : B.y - A.y, dz = B.z - A.z;
      const L = Math.hypot(dx, dy, dz);
      if (L < 1e-9) throw new Error(`Elemento ${el.id}: longitud cero`);
      const sec = secBy.get(el.sec); if (!sec) throw new Error(`Elemento ${el.id}: sección "${el.sec}" no existe`);
      let R, ax3;
      if (is2D) { const c = dx / L, s = dz / L; R = [[c, s, 0], [-s, c, 0], [0, 0, 1]]; ax3 = [[c, 0, s], [-s, 0, c], [0, -1, 0]]; }
      else { R = localAxes3D(dx, dy, dz, L, el.beta); ax3 = R; }
      // punto de inserción por defecto (como ETABS): vigas horizontales colgadas del nudo (8 = superior centro), demás en el centroide
      const horiz = Math.abs(ax3[0][2]) < 1e-6;
      const dims = secDims(sec), ins = insertionOffset(el, sec, horiz ? 8 : 10);
      return { el, ni, nj, L, sec, R, ax3, dims, ins, isCol: Math.abs(ax3[0][2]) > 0.7 };
    });
    const atNode = new Map();
    pre.forEach((q, k) => { for (const n of [q.ni, q.nj]) { if (!atNode.has(n)) atNode.set(n, []); atNode.get(n).push(k); } });
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    /** Brazo físico automático (como ETABS «automático desde la conectividad»): distancia desde el nudo hasta
     *  donde el eje del elemento sale de la sección de los elementos que llegan al mismo nudo. */
    const autoOffset = (k, end) => {
      const q = pre[k], ex = q.ax3[0], s = end === 0 ? ex : ex.map(v => -v), n = end === 0 ? q.ni : q.nj;
      let t = 0;
      for (const o of atNode.get(n)) {
        if (o === k) continue;
        const Q = pre[o];
        if (Math.abs(dot(ex, Q.ax3[0])) > 0.95) continue; // colineal
        if (Q.sec.shape === 'gen' && !(+Q.sec.h > 0)) continue; // sección general sin dimensiones: no aporta brazo
        const comps = [[dot(s, Q.ax3[1]), Q.ins.d2, Q.dims.h / 2], [is2D ? 0 : dot(s, Q.ax3[2]), Q.ins.d3, Q.dims.b / 2]];
        let tk = Infinity;
        for (const [sk, dk, hk] of comps) if (Math.abs(sk) > 1e-9) tk = Math.min(tk, ((sk > 0 ? dk + hk : dk - hk)) / sk);
        if (isFinite(tk)) t = Math.max(t, tk);
      }
      return Math.max(0, t);
    };

    // ---- elementos
    const els = model.elements.map((el, k) => {
      const q = pre[k], ni = q.ni, nj = q.nj, L = q.L, sec = q.sec, R = q.R;
      const mat = matBy.get(sec.mat); if (!mat) throw new Error(`Sección ${sec.name}: material "${sec.mat}" no existe`);
      const p = sectionProps(sec, mat);
      const rf = +set.rigidFactor;
      // brazos físicos: el valor manual (> 0) manda; si no, automático desde la conectividad
      let aPhys = +el.offI > 0 ? +el.offI : (set.autoOffsets ? autoOffset(k, 0) : 0);
      let bPhys = +el.offJ > 0 ? +el.offJ : (set.autoOffsets ? autoOffset(k, 1) : 0);
      if (aPhys + bPhys >= L) {
        if (+el.offI > 0 || +el.offJ > 0) throw new Error(`Elemento ${el.id}: brazos de extremo mayores que la longitud`);
        const f = 0.8 * L / (aPhys + bPhys); aPhys *= f; bPhys *= f;
        warnings.push(`Elemento ${el.id}: brazos automáticos limitados al 80 % de la longitud`);
      }
      const a = aPhys * rf, b = bPhys * rf, Lf = L - a - b;
      // longitud para masa y peso propio: las vigas no repiten el concreto del nudo (luz libre), las columnas sí lo llevan
      const clearMass = set.beamClearMass && !q.isCol;
      const Lmass = clearMass ? L - aPhys - bPhys : L;
      const lam = blockDiag(R, is2D ? 2 : 4);
      const kk = is2D ? k2D(p, Lf, set.shear) : k3D(p, Lf, set.shear);
      // Zona rígida: rigidiza flexión y cortante; la deformación axial y la torsión se calculan con la
      // longitud completa nudo a nudo (formulación CSI: ETABS / SAP2000).
      if (Lf < L && set.rigidAxial !== true) {
        const ea = p.E * p.A / L, gj = p.G * p.J / L, K = kk.k;
        const ax = is2D ? [0, 3] : [0, 6];
        K[ax[0]][ax[0]] = K[ax[1]][ax[1]] = ea; K[ax[0]][ax[1]] = K[ax[1]][ax[0]] = -ea;
        if (!is2D) { K[3][3] = K[9][9] = gj; K[3][9] = K[9][3] = -gj; }
      }
      const rel = [];
      const ri = (el.rel && el.rel.i) || [], rj = (el.rel && el.rel.j) || [];
      for (let d = 0; d < dpn; d++) { if (ri[relMap[d]]) rel.push(d); if (rj[relMap[d]]) rel.push(dpn + d); }
      const C = makeCondenser(kk.k, rel);
      const m2 = 2 * dpn;
      let H = null;
      if (a || b) {
        H = eye(m2);
        if (is2D) { H[1][2] = a; H[4][5] = -b; }
        else { H[1][5] = a; H[2][4] = -a; H[7][11] = -b; H[8][10] = b; }
      }
      // Punto de inserción (cardinal): el eje centroidal está desplazado (d2, d3) de la línea de nudos.
      // u_c = u_nudo + θ × r  con r = d2·e2 + d3·e3  (unión rígida, igual que ETABS/SAP2000 con transformación de rigidez)
      const ins = q.ins;
      if (el.insTransform && (ins.d2 || ins.d3)) {
        const O = eye(m2);
        for (let end = 0; end < 2; end++) {
          const o = end * dpn;
          if (is2D) O[o][o + 2] = -ins.d2;
          else { O[o][o + 4] = ins.d3; O[o][o + 5] = -ins.d2; O[o + 1][o + 3] = -ins.d3; O[o + 2][o + 3] = ins.d2; }
        }
        H = H ? mul(H, O) : O;
      }
      const kl = H ? triple(transpose(H), C.k, H) : C.k;
      const lamT = transpose(lam);
      const kg = triple(lamT, kl, lam);
      const dofs = [];
      for (let d = 0; d < dpn; d++) dofs.push(ni * dpn + d);
      for (let d = 0; d < dpn; d++) dofs.push(nj * dpn + d);
      return { id: el.id, src: el, ni, nj, L, Lf, a, b, aPhys, bPhys, Lmass, clearMass, isCol: q.isCol, ins, sec: sec.name, p, R, lam, lamT, kf: kk.k, phiY: kk.phiY, phiZ: kk.phiZ, rel, krel: rel.length ? C.k : null, cond: C.cond, H, kl, kg, dofs };
    });

    if (model.__geomOnly) return { els, warnings }; // solo geometría (brazos, longitudes) para la interfaz

    // ---- ensamblaje K global
    const K = zeros(n, n);
    for (const e of els) for (let p = 0; p < e.dofs.length; p++) { const Kp = K[e.dofs[p]], kp = e.kg[p]; for (let q = 0; q < e.dofs.length; q++) Kp[e.dofs[q]] += kp[q]; }

    // ---- restricciones
    const restrained = new Array(n).fill(false);
    nodes.forEach((nd, k) => { const r = nd.restr || []; for (let d = 0; d < dpn; d++) if (r[cmap[d]]) restrained[k * dpn + d] = true; });

    // ---- masas nodales (fuente de masa)
    const ms = Object.assign({ selfWeight: true, patterns: [], vertical: false }, model.massSource || {});
    const nodeMass = nodes.map(nd => +nd.mass || 0);
    if (ms.selfWeight) for (const e of els) { const m = e.p.gamma * e.p.Ag * e.Lmass * e.p.mM / GRAV; nodeMass[e.ni] += m / 2; nodeMass[e.nj] += m / 2; }
    for (const mp of ms.patterns || []) {
      const fac = +mp.factor || 0; if (!fac) continue;
      for (const nl of model.nodalLoads || []) if (nl.pat === mp.pat) { const k = nodeIdx.get(nl.node); if (k !== undefined) nodeMass[k] += fac * Math.max(0, -(+nl.F[2] || 0)) / GRAV; }
      for (const ld of model.elemLoads || []) if (ld.pat === mp.pat) {
        const e = els.find(x => x.id === ld.elem); if (!e) continue;
        const g = loadGlobalVec(e, ld, is2D); const down = Math.max(0, -g[2]);
        if (ld.type === 'point') { const r = clamp01(+ld.a); nodeMass[e.ni] += fac * down * (1 - r) / GRAV; nodeMass[e.nj] += fac * down * r / GRAV; }
        else { nodeMass[e.ni] += fac * down * e.L / 2 / GRAV; nodeMass[e.nj] += fac * down * e.L / 2 / GRAV; }
      }
    }

    // ---- diafragmas -> matriz de transformación T (u = T q)
    const rdofs = []; // GDL independientes
    const Trows = Array.from({ length: n }, () => []);
    const diaphs = new Map();
    nodes.forEach((nd, k) => { if (nd.diaph) { if (!diaphs.has(nd.diaph)) diaphs.set(nd.diaph, []); diaphs.get(nd.diaph).push(k); } });
    const slaveComps = is2D ? [0] : [0, 1, 5];
    const masters = [];
    for (const [name, list] of diaphs) {
      let mt = 0, sx = 0, sy = 0, sz = 0;
      list.forEach(k => { mt += nodeMass[k]; sx += nodeMass[k] * nodes[k].x; sy += nodeMass[k] * nodes[k].y; });
      let xc, yc;
      if (mt > 0) { xc = sx / mt; yc = sy / mt; } else { xc = list.reduce((s, k) => s + nodes[k].x, 0) / list.length; yc = list.reduce((s, k) => s + nodes[k].y, 0) / list.length; }
      list.forEach(k => sz += nodes[k].z); const zc = sz / list.length;
      const mInfo = { name, nodes: list, xc, yc: is2D ? 0 : yc, zc, idx: {} };
      for (const c of slaveComps) {
        mInfo.idx[c] = rdofs.length;
        rdofs.push({ label: `${name}-${dofNames[c]}`, master: name, comp: c, x: xc, y: mInfo.yc, z: zc, node: null });
      }
      masters.push(mInfo);
    }
    const dofStatus = new Array(n).fill('libre');
    nodes.forEach((nd, k) => {
      const mI = nd.diaph ? masters.find(m => m.name === nd.diaph) : null;
      for (let d = 0; d < dpn; d++) {
        const g = k * dpn + d;
        if (restrained[g]) { dofStatus[g] = 'restringido'; continue; }
        if (mI && slaveComps.includes(d)) {
          dofStatus[g] = 'esclavo de ' + mI.name;
          if (is2D) Trows[g].push([mI.idx[0], 1]);
          else if (d === 0) { Trows[g].push([mI.idx[0], 1]); const v = -(nd.y - mI.yc); if (Math.abs(v) > 1e-12) Trows[g].push([mI.idx[5], v]); }
          else if (d === 1) { Trows[g].push([mI.idx[1], 1]); const v = (nd.x - mI.xc); if (Math.abs(v) > 1e-12) Trows[g].push([mI.idx[5], v]); }
          else Trows[g].push([mI.idx[5], 1]);
          continue;
        }
        Trows[g].push([rdofs.length, 1]);
        rdofs.push({ label: dofLabels[g], node: k, comp: d, full: g, x: nd.x, y: nd.y, z: nd.z, master: null });
      }
    });
    const m = rdofs.length;
    if (m === 0) throw new Error('Todos los grados de libertad están restringidos');

    // Kr = T^T K T (aprovechando la dispersión de T)
    const KT = zeros(n, m);
    for (let i = 0; i < n; i++) { const Ki = K[i], KTi = KT[i]; for (let k = 0; k < n; k++) { const v = Ki[k]; if (!v) continue; for (const [q, t] of Trows[k]) KTi[q] += v * t; } }
    const Kr = zeros(m, m);
    for (let i = 0; i < n; i++) for (const [p, t] of Trows[i]) { const Krp = Kr[p], KTi = KT[i]; for (let q = 0; q < m; q++) Krp[q] += t * KTi[q]; }
    const expand = q => { const u = new Array(n).fill(0); for (let i = 0; i < n; i++) { let s = 0; for (const [p, t] of Trows[i]) s += t * q[p]; u[i] = s; } return u; };
    const reduceVec = F => { const r = new Array(m).fill(0); for (let i = 0; i < n; i++) for (const [p, t] of Trows[i]) r[p] += t * F[i]; return r; };

    // ---- cargas por patrón
    const patterns = (model.patterns || []).map(pt => {
      const Fn = new Array(n).fill(0), Fe = new Array(n).fill(0);
      for (const nl of model.nodalLoads || []) if (nl.pat === pt.name) { const k = nodeIdx.get(nl.node); if (k === undefined) continue; for (let d = 0; d < dpn; d++) Fn[k * dpn + d] += +nl.F[cmap[d]] || 0; }
      const elLoads = els.map(e => {
        const list = (model.elemLoads || []).filter(l => l.pat === pt.name && l.elem === e.id);
        if (+pt.selfWeight) list.push({ type: 'dist', dir: 'GZ', w: -(+pt.selfWeight) * e.p.gamma * e.p.Ag * e.p.mW, sw: true });
        const lv = elementLoadVectors(e, list, is2D, dpn, set.shear);
        const fe = mulVec(e.lamT, lv.Peq);
        for (let p = 0; p < fe.length; p++) Fe[e.dofs[p]] += fe[p];
        return lv;
      });
      const F = Fn.map((v, i) => v + Fe[i]);
      return { name: pt.name, Fn, Fe, F, elLoads };
    });
    let Q = [];
    if (patterns.length) {
      const RHS = zeros(m, patterns.length);
      patterns.forEach((pt, c) => { pt.Fr = reduceVec(pt.F); pt.Fr.forEach((v, i) => RHS[i][c] = v); });
      try { Q = solve(Kr, RHS); }
      catch (err) { throw new Error(`${err.message}. Revise apoyos/liberaciones (GDL problemático cerca de: ${rdofs[err.dof] ? rdofs[err.dof].label : '?'})`); }
    }
    patterns.forEach((pt, c) => {
      pt.q = Q.map(r => r[c]);
      pt.u = expand(pt.q);
      const Ku = mulVec(K, pt.u);
      pt.R = Ku.map((v, i) => restrained[i] ? v - pt.F[i] : 0);
      pt.ef = els.map((e, k) => elementForces(e, pt.u, pt.elLoads[k].fef));
    });

    return {
      is2D, dpn, cmap, dofNames, n, m, nodes, model, els, K, dofLabels, restrained, dofStatus,
      Trows, rdofs, masters, Kr, expand, reduceVec, patterns, nodeMass, warnings, settings: set, nodeIdx
    };
  }

  function clamp01(v) { return Math.min(1, Math.max(0, isFinite(v) ? v : 0.5)); }

  /** Vector global (3 comps X,Y,Z) de una carga de elemento (por unidad de longitud o puntual). */
  function loadGlobalVec(e, ld, is2D) {
    const val = ld.type === 'point' ? +ld.P : +ld.w;
    const dir = ld.dir || 'GZ';
    if (dir[0] === 'G') { const v = [0, 0, 0]; v['XYZ'.indexOf(dir[1])] = val; return v; }
    const li = 'XYZ'.indexOf(dir[1]); // L1/L2/L3 -> LX/LY/LZ
    const R = e.R;
    if (is2D) { const l = [0, 0]; l[li] = val; return [R[0][0] * l[0] + R[1][0] * l[1], 0, R[0][1] * l[0] + R[1][1] * l[1]]; }
    return [R[li][0] * val, R[li][1] * val, R[li][2] * val];
  }
  function loadLocalVec(e, ld, is2D) {
    const g = loadGlobalVec(e, ld, is2D), R = e.R;
    if (is2D) { const gx = g[0], gz = g[2]; return [R[0][0] * gx + R[0][1] * gz, R[1][0] * gx + R[1][1] * gz, 0]; }
    return [0, 1, 2].map(i => R[i][0] * g[0] + R[i][1] * g[1] + R[i][2] * g[2]);
  }

  /** FEF locales (tramo flexible, ya condensadas) y carga nodal equivalente local Peq = Pd - H^T fef. */
  function elementLoadVectors(e, list, is2D, dpn, shear) {
    const Lf = e.Lf, a = e.a, b = e.b, L = e.L, m2 = 2 * dpn;
    const segs = []; const pts = []; // segs: cargas uniformes por tramos [{x1, x2, w:[3]}] en coordenadas del tramo flexible
    const Pd = new Array(m2).fill(0);
    const addDirect = (end, F, s) => { // carga en zona rígida transferida al nodo (local)
      const o = end * dpn;
      if (is2D) { Pd[o] += F[0]; Pd[o + 1] += F[1]; Pd[o + 2] += s * F[1]; }
      else { Pd[o] += F[0]; Pd[o + 1] += F[1]; Pd[o + 2] += F[2]; Pd[o + 4] += -s * F[2]; Pd[o + 5] += s * F[1]; }
    };
    for (const ld of list) {
      const lv = loadLocalVec(e, ld, is2D);
      if (ld.type === 'point') {
        const x = clamp01(+ld.a) * L;
        if (x < a) addDirect(0, lv, x);
        else if (x > L - b) addDirect(1, lv, -(L - x));
        else pts.push({ x: x - a, P: lv });
      } else if (ld.sw && e.clearMass) {
        // peso propio de vigas: solo sobre la luz libre entre caras (el nudo ya lo aporta la columna)
        const x1 = Math.max(0, e.aPhys - a), x2 = Math.min(Lf, L - e.bPhys - a);
        if (x2 > x1) segs.push({ x1, x2, w: lv });
      } else {
        segs.push({ x1: 0, x2: Lf, w: lv });
        if (a) addDirect(0, lv.map(v => v * a), a / 2);
        if (b) addDirect(1, lv.map(v => v * b), -b / 2);
      }
    }
    const p = e.p;
    let ax1 = -pts.reduce((s, q) => s + q.P[0] * (Lf - q.x) / Lf, 0), ax2 = -pts.reduce((s, q) => s + q.P[0] * q.x / Lf, 0);
    for (const sg of segs) {
      const q = sg.w[0], d1 = sg.x2 - sg.x1, d2 = (sg.x2 * sg.x2 - sg.x1 * sg.x1) / 2;
      ax1 -= q * (Lf * d1 - d2) / Lf; ax2 -= q * d2 / Lf;
    }
    const comp = c => segs.map(sg => ({ x1: sg.x1, x2: sg.x2, w: sg.w[c] }));
    const by = bendFEF(p.E * p.Iz, shear ? p.G * p.Asy : Infinity, Lf, comp(1), pts.map(q => ({ x: q.x, P: q.P[1] })));
    let fef;
    if (is2D) fef = [ax1, by[0], by[1], ax2, by[2], by[3]];
    else {
      const bz = bendFEF(p.E * p.Iy, shear ? p.G * p.Asz : Infinity, Lf, comp(2), pts.map(q => ({ x: q.x, P: q.P[2] })));
      fef = [ax1, by[0], bz[0], 0, -bz[1], by[1], ax2, by[2], bz[2], 0, -bz[3], by[3]];
    }
    const fef0 = fef.slice();
    fef = e.cond(fef);
    const HtF = e.H ? mulVec(transpose(e.H), fef) : fef;
    const Peq = Pd.map((v, i) => v - HtF[i]);
    return { fef0, fef, Pd, Peq, segs, pts };
  }

  /** Fuerzas en extremos del tramo flexible (caras), sistema local, actuando sobre el elemento. */
  function elementForces(e, u, fef) {
    const ue = e.dofs.map(d => u[d]);
    const dl = mulVec(e.lam, ue);
    const df = e.H ? mulVec(e.H, dl) : dl;
    const kk = e.krel || e.kf;
    const f = mulVec(kk, df);
    if (fef) for (let i = 0; i < f.length; i++) f[i] += fef[i];
    return { ue, dl, df, f };
  }

  /** Esfuerzos internos a lo largo del tramo flexible (x desde la cara i). */
  function internalForces(res, e, f, lv, nSt) {
    const is2D = res.is2D, dpn = res.dpn, Lf = e.Lf; nSt = nSt || 21;
    const segs = (lv && lv.segs) || [], pts = lv ? lv.pts : [];
    const out = [];
    for (let s = 0; s < nSt; s++) {
      const x = Lf * s / (nSt - 1);
      let Fx = f[0], Fy = f[1], Fz = is2D ? 0 : f[2];
      let Mz = is2D ? f[2] : f[5], My = is2D ? 0 : f[4], Tx = is2D ? 0 : f[3];
      // izquierda del corte
      let N = -Fx, V2 = Fy, V3 = Fz;
      let M3 = -Mz + Fy * x;
      let M2 = -My - Fz * x;
      for (const sg of segs) {
        const c = Math.min(Math.max(x - sg.x1, 0), sg.x2 - sg.x1); if (c <= 0) continue;
        const d = x - (sg.x1 + c / 2), w = sg.w;
        N -= w[0] * c; V2 += w[1] * c; V3 += w[2] * c; M3 += w[1] * c * d; M2 -= w[2] * c * d;
      }
      for (const q of pts) if (q.x < x - 1e-12) {
        N -= q.P[0]; V2 += q.P[1]; V3 += q.P[2];
        M3 += q.P[1] * (x - q.x); M2 -= q.P[2] * (x - q.x);
      }
      out.push({ x, N, V2, V3, T: -Tx, M2, M3 });
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Análisis modal (Eigen) con condensación estática (Guyan exacta para masas concentradas)
  // ------------------------------------------------------------------
  function modal(res, opts) {
    opts = Object.assign({ nModes: 12 }, opts || {});
    const { n, m, dpn, is2D, nodeMass, Trows, rdofs, masters, Kr } = res;
    const vertical = !!(res.model.massSource && res.model.massSource.vertical);
    const Mfull = new Array(n).fill(0);
    const massComps = is2D ? (vertical ? [0, 1] : [0]) : (vertical ? [0, 1, 2] : [0, 1]);
    res.nodes.forEach((nd, k) => { for (const c of massComps) Mfull[k * dpn + c] += nodeMass[k]; if (nd.massR && !is2D) Mfull[k * dpn + 5] += +nd.massR; });
    // Mr = T^T M T
    const Mr = zeros(m, m);
    for (let i = 0; i < n; i++) { if (!Mfull[i]) continue; const r = Trows[i]; for (const [p, tp] of r) for (const [q, tq] of r) Mr[p][q] += tp * Mfull[i] * tq; }
    let maxM = 0; for (let i = 0; i < m; i++) maxM = Math.max(maxM, Mr[i][i]);
    if (maxM <= 0) throw new Error('No hay masa en el modelo (revise la fuente de masa / peso específico)');
    const aSet = [], bSet = [];
    for (let i = 0; i < m; i++) (Mr[i][i] > 1e-9 * maxM ? aSet : bSet).push(i);
    const sub = (A, r, c) => r.map(i => c.map(j => A[i][j]));
    const Kaa = sub(Kr, aSet, aSet), Kab = sub(Kr, aSet, bSet), Kba = sub(Kr, bSet, aSet), Kbb = sub(Kr, bSet, bSet);
    let Kc = Kaa, KbbInvKba = null;
    if (bSet.length) {
      KbbInvKba = solve(Kbb, Kba);
      const corr = mul(Kab, KbbInvKba);
      Kc = Kaa.map((r, i) => r.map((v, j) => v - corr[i][j]));
    }
    // simetrizar por redondeo
    for (let i = 0; i < Kc.length; i++) for (let j = i + 1; j < Kc.length; j++) { const v = (Kc[i][j] + Kc[j][i]) / 2; Kc[i][j] = Kc[j][i] = v; }
    const Maa = sub(Mr, aSet, aSet);
    const Lc = cholesky(Maa);
    const Y1 = forwardSub(Lc, Kc);
    const Asym = transpose(forwardSub(Lc, transpose(Y1)));
    for (let i = 0; i < Asym.length; i++) for (let j = i + 1; j < Asym.length; j++) { const v = (Asym[i][j] + Asym[j][i]) / 2; Asym[i][j] = Asym[j][i] = v; }
    const eg = eigSym(Asym);
    const PhiA = backSubT(Lc, eg.vectors); // normalizados a masa: Φ^T M Φ = I
    const na = aSet.length, nm = Math.min(+opts.nModes || na, na);
    const modes = [];
    const dirs = is2D ? ['X'] : ['X', 'Y'];
    if (vertical) dirs.push('Z');
    const dirComp = { X: 0, Y: 1, Z: is2D ? 1 : 2 };
    const rvec = {};
    for (const d of dirs) rvec[d] = rdofs.map(r => (r.comp === dirComp[d] ? 1 : 0));
    const Mtot = {}; for (const d of dirs) { const Mr_r = mulVec(Mr, rvec[d]); Mtot[d] = rvec[d].reduce((s, v, i) => s + v * Mr_r[i], 0); }
    const cum = {}; dirs.forEach(d => cum[d] = 0);
    for (let k = 0; k < nm; k++) {
      const lam = Math.max(eg.values[k], 0), w = Math.sqrt(lam);
      const phiA = PhiA.map(r => r[k]);
      const phi = new Array(m).fill(0);
      aSet.forEach((g, i) => phi[g] = phiA[i]);
      if (bSet.length) { const pb = mulVec(KbbInvKba, phiA); bSet.forEach((g, i) => phi[g] = -pb[i]); }
      const Mphi = mulVec(Mr, phi);
      const gam = {}, mef = {}, ratio = {};
      for (const d of dirs) {
        gam[d] = rvec[d].reduce((s, v, i) => s + v * Mphi[i], 0);
        mef[d] = gam[d] * gam[d]; ratio[d] = Mtot[d] > 0 ? mef[d] / Mtot[d] : 0; cum[d] += ratio[d];
      }
      // participación rotacional (diafragmas)
      modes.push({ n: k + 1, lambda: lam, omega: w, f: w / (2 * Math.PI), T: w > 0 ? 2 * Math.PI / w : Infinity, phiA, phi, uFull: res.expand(phi), gamma: gam, mef, ratio, cum: Object.assign({}, cum) });
    }
    return { aSet, bSet, Mfull, Mr, Kaa, Kab, Kbb, Kc, Maa, KbbInvKba, modes, dirs, dirComp, rvec, Mtot, values: eg.values };
  }

  // ------------------------------------------------------------------
  // Espectro de diseño (NSR-10 A.2.6) o definido por el usuario
  // ------------------------------------------------------------------
  function nsrParams(sp) {
    const Aa = +sp.Aa, Av = +sp.Av, Fa = +sp.Fa, Fv = +sp.Fv;
    return { T0: 0.1 * Av * Fv / (Aa * Fa), TC: 0.48 * Av * Fv / (Aa * Fa), TL: 2.4 * Fv };
  }
  function spectrumSa(T, sp, lowBranch) {
    if (sp.type === 'user') {
      const tb = (sp.table || []).filter(r => isFinite(r[0]) && isFinite(r[1])).sort((a, b) => a[0] - b[0]);
      if (!tb.length) return 0;
      if (T <= tb[0][0]) return tb[0][1];
      for (let i = 1; i < tb.length; i++) if (T <= tb[i][0]) { const [t0, s0] = tb[i - 1], [t1, s1] = tb[i]; return s0 + (s1 - s0) * (T - t0) / (t1 - t0); }
      return tb[tb.length - 1][1];
    }
    const Aa = +sp.Aa, Av = +sp.Av, Fa = +sp.Fa, Fv = +sp.Fv, I = +sp.I;
    const { T0, TC, TL } = nsrParams(sp);
    if (!isFinite(T)) return 0;
    if (lowBranch && T < T0) return 2.5 * Aa * Fa * I * (0.4 + 0.6 * T / T0);
    if (T <= TC) return 2.5 * Aa * Fa * I;
    if (T <= TL) return 1.2 * Av * Fv * I / T;
    return 1.2 * Av * Fv * TL * I / (T * T);
  }

  function cqcRho(wi, wj, xi) {
    if (wi <= 0 || wj <= 0) return wi === wj ? 1 : 0;
    const r = wj / wi;
    return 8 * xi * xi * (1 + r) * Math.pow(r, 1.5) / ((1 - r * r) ** 2 + 4 * xi * xi * r * (1 + r) ** 2);
  }

  function spectral(res, md, sp) {
    sp = Object.assign({ type: 'NSR10', Aa: 0.15, Av: 0.2, Fa: 1.2, Fv: 1.6, I: 1, R: 1, xi: 0.05, comb: 'CQC', lowBranch: false, minShearPct: 0, applyScale: false }, sp || {});
    const modes = md.modes, nm = modes.length, xi = +sp.xi;
    const rho = zeros(nm, nm);
    for (let i = 0; i < nm; i++) for (let j = 0; j < nm; j++) rho[i][j] = sp.comb === 'SRSS' ? (i === j ? 1 : 0) : cqcRho(modes[i].omega, modes[j].omega, xi);
    const combine = vals => { let s = 0; for (let i = 0; i < nm; i++) { if (!vals[i]) continue; for (let j = 0; j < nm; j++) s += rho[i][j] * vals[i] * vals[j]; } return Math.sqrt(Math.max(s, 0)); };
    const out = { rho, dirs: {}, sp };
    const R = +sp.R || 1;
    const { is2D, dpn, nodes } = res;
    // niveles y parejas para derivas
    const tolZ = 1e-6;
    const zLevels = [...new Set(nodes.map(nd => +nd.z.toFixed(6)))].sort((a, b) => a - b);
    const below = nodes.map(nd => {
      let best = -1, bz = -Infinity;
      nodes.forEach((o, k) => { if (Math.abs(o.x - nd.x) < 1e-6 && Math.abs((o.y || 0) - (nd.y || 0)) < 1e-6 && o.z < nd.z - tolZ && o.z > bz) { bz = o.z; best = k; } });
      return best;
    });
    for (const d of md.dirs.filter(x => x !== 'Z')) {
      const comp = md.dirComp[d];
      const fundamental = modes.reduce((b, mo) => (mo.mef[d] > (b ? b.mef[d] : -1) ? mo : b), null);
      const perMode = modes.map(mo => {
        const lowB = sp.lowBranch && mo !== fundamental;
        const Sa = spectrumSa(mo.T, sp, lowB);
        const A = Sa * GRAV, Sd = mo.omega > 0 ? A / (mo.omega * mo.omega) : 0;
        const fac = mo.gamma[d] * Sd;
        const u = mo.uFull.map(v => v * fac);
        const q = mo.phi.map(v => v * fac);
        const finert = mulVec(md.Mr, mo.phi).map(v => v * mo.gamma[d] * A);
        const Vb = mo.gamma[d] * mo.gamma[d] * A;
        return { Sa, A, Sd, fac, u, q, finert, Vb };
      });
      const Vb = combine(perMode.map(p => p.Vb));
      const Tf = fundamental ? fundamental.T : 0;
      const SaF = spectrumSa(Tf, sp, false);
      const Vs = SaF * GRAV * md.Mtot[d];
      const pct = +sp.minShearPct || 0;
      let scale = 1;
      if (pct > 0 && Vb > 0 && Vb < pct / 100 * Vs) scale = pct / 100 * Vs / Vb;
      const fScale = (sp.applyScale ? scale : 1) / R;
      // desplazamientos nodales combinados (elásticos)
      const U = res.dofLabels.map((_, i) => combine(perMode.map(p => p.u[i])));
      // reacciones
      const Ku = perMode.map(p => mulVec(res.K, p.u));
      const Rn = res.dofLabels.map((_, i) => res.restrained[i] ? combine(Ku.map(k => k[i])) * fScale : 0);
      // fuerzas en elementos
      const EFm = res.els.map(e => perMode.map(p => elementForces(e, p.u, null).f));
      const EF = EFm.map(fm => fm[0].map((_, c) => combine(fm.map(f => f[c])) * fScale));
      // cortante por piso
      const stories = zLevels.map(z => {
        const vals = perMode.map(p => p.finert.reduce((s, f, i) => s + (res.rdofs[i].comp === comp && res.rdofs[i].z >= z - tolZ ? f : 0), 0));
        return { z, V: combine(vals) * fScale, perMode: vals };
      }).filter(s => s.z > zLevels[0] + tolZ || zLevels.length === 1);
      // derivas
      const drifts = [];
      nodes.forEach((nd, k) => {
        const bk = below[k]; if (bk < 0) return;
        const h = nd.z - nodes[bk].z;
        const comps = is2D ? [0] : [0, 1];
        const dv = comps.map(c => combine(perMode.map(p => p.u[k * dpn + c] - p.u[bk * dpn + c])));
        const tot = Math.hypot(...dv);
        drifts.push({ node: nd.id, below: nodes[bk].id, z: nd.z, h, dx: dv[0], dy: is2D ? 0 : dv[1], total: tot, ratio: tot / h });
      });
      out.dirs[d] = { dir: d, perMode, Vb, Vs, Tf, SaF, scale, fScale, U, R: Rn, EF, EFm, stories, drifts, fundamental: fundamental ? fundamental.n : null };
    }
    out.combine = combine;
    return out;
  }

  // ------------------------------------------------------------------
  // Casos de resultados: patrones, sismo espectral, combinaciones y envolventes
  //   Cada caso entrega máximos y mínimos (iguales si no hay sismo ni envolvente).
  // ------------------------------------------------------------------
  const IF_COMPS = ['N', 'V2', 'V3', 'T', 'M2', 'M3'];

  function specStations(res, spc, D, k, nSt) {
    const e = res.els[k];
    const per = D.EFm[k].map(f => internalForces(res, e, f, null, nSt));
    return per[0].map((st, i) => { const o = { x: st.x }; for (const c of IF_COMPS) o[c] = spc.combine(per.map(p => p[i][c])) * D.fScale; return o; });
  }

  function linearCase(res, spc, name, kind, terms, eterms) {
    // terms: [{pat (índice), f}], eterms: [{dir, f}]
    const n = res.n, ne = res.els.length;
    const u = new Array(n).fill(0), R = new Array(n).fill(0);
    const f = res.els.map(e => new Array(2 * res.dpn).fill(0));
    const lv = res.els.map(() => ({ segs: [], pts: [] }));
    for (const t of terms) {
      const p = res.patterns[t.pat]; if (!p || !t.f) continue;
      for (let i = 0; i < n; i++) { u[i] += t.f * p.u[i]; R[i] += t.f * p.R[i]; }
      for (let k = 0; k < ne; k++) {
        const pf = p.ef[k].f; for (let c = 0; c < pf.length; c++) f[k][c] += t.f * pf[c];
        const L = p.elLoads[k]; for (const sg of L.segs) lv[k].segs.push({ x1: sg.x1, x2: sg.x2, w: sg.w.map(v => v * t.f) });
        for (const q of L.pts) lv[k].pts.push({ x: q.x, P: q.P.map(v => v * t.f) });
      }
    }
    const E = (eterms || []).filter(t => t.f && spc && spc.dirs[t.dir]).map(t => ({ D: spc.dirs[t.dir], f: Math.abs(t.f) }));
    return { name, kind, env: E.length > 0, terms, eterms: eterms || [], u, R, f, lv, E };
  }

  function caseNodal(res, c, key) { // key: 'u' | 'R'
    if (c.kind === 'envelope') {
      const parts = c.members.map(m => caseNodal(res, m, key));
      return { max: parts[0].max.map((_, i) => Math.max(...parts.map(p => p.max[i]))), min: parts[0].min.map((_, i) => Math.min(...parts.map(p => p.min[i]))) };
    }
    const base = c[key], ex = new Array(base.length).fill(0);
    for (const t of c.E) { const src = key === 'u' ? t.D.U : t.D.R; for (let i = 0; i < ex.length; i++) ex[i] += t.f * src[i]; }
    return { max: base.map((v, i) => v + ex[i]), min: base.map((v, i) => v - ex[i]) };
  }

  function caseEnd(res, c, k) {
    if (c.kind === 'envelope') {
      const parts = c.members.map(m => caseEnd(res, m, k));
      return { max: parts[0].max.map((_, i) => Math.max(...parts.map(p => p.max[i]))), min: parts[0].min.map((_, i) => Math.min(...parts.map(p => p.min[i]))) };
    }
    const base = c.f[k], ex = new Array(base.length).fill(0);
    for (const t of c.E) for (let i = 0; i < ex.length; i++) ex[i] += t.f * t.D.EF[k][i];
    return { max: base.map((v, i) => v + ex[i]), min: base.map((v, i) => v - ex[i]) };
  }

  function caseStations(res, spc, c, k, nSt) {
    nSt = nSt || 21;
    if (c.kind === 'envelope') {
      const parts = c.members.map(m => caseStations(res, spc, m, k, nSt));
      return parts[0].map((s, i) => {
        const o = { x: s.x, max: {}, min: {} };
        for (const cp of IF_COMPS) { o.max[cp] = Math.max(...parts.map(p => p[i].max[cp])); o.min[cp] = Math.min(...parts.map(p => p[i].min[cp])); }
        return o;
      });
    }
    const S = internalForces(res, res.els[k], c.f[k], c.lv[k], nSt);
    const Es = c.E.map(t => ({ f: t.f, st: specStations(res, spc, t.D, k, nSt) }));
    return S.map((s, i) => {
      const o = { x: s.x, max: {}, min: {} };
      for (const cp of IF_COMPS) { let ex = 0; for (const t of Es) ex += t.f * t.st[i][cp]; o.max[cp] = s[cp] + ex; o.min[cp] = s[cp] - ex; }
      return o;
    });
  }

  /** Construye la lista de casos: patrones, sismo espectral por dirección y combinaciones definidas por el usuario. */
  function buildCases(res, spc, combos) {
    const cases = res.patterns.map((p, i) => linearCase(res, spc, p.name, 'pattern', [{ pat: i, f: 1 }], []));
    if (spc) for (const d of Object.keys(spc.dirs)) cases.push(linearCase(res, spc, 'Sismo ' + d + ' (espectral)', 'spectral', [], [{ dir: d, f: 1 }]));
    const errors = [];
    const ordered = (combos || []).filter(c => c.kind !== 'envelope').concat((combos || []).filter(c => c.kind === 'envelope'));
    for (const cb of ordered) {
      if (cb.kind === 'envelope') {
        const members = (cb.members || []).map(nm => cases.find(c => c.name === nm)).filter(Boolean);
        if (!members.length) { errors.push(`Envolvente "${cb.name}" sin combinaciones válidas`); continue; }
        cases.push({ name: cb.name, kind: 'envelope', env: true, members });
      } else {
        const terms = [], eterms = [];
        for (const t of cb.terms || []) {
          if (!+t.f) continue;
          if (t.dir) { if (spc && spc.dirs[t.dir]) eterms.push({ dir: t.dir, f: +t.f }); else errors.push(`"${cb.name}": no hay resultado espectral en ${t.dir}`); }
          else { const i = res.patterns.findIndex(p => p.name === t.pat); if (i >= 0) terms.push({ pat: i, f: +t.f }); }
        }
        cases.push(linearCase(res, spc, cb.name, 'combo', terms, eterms));
      }
    }
    return { cases, errors };
  }

  const api = { GRAV, zeros, eye, transpose, mul, mulVec, solve, inverse, cholesky, eigSym, sectionProps, secDims, localAxes3D, bendFEF, analyze, modal, spectrumSa, nsrParams, spectral, cqcRho, internalForces, elementForces, loadGlobalVec, buildCases, caseNodal, caseEnd, caseStations, specStations };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Solver = api;
})(typeof window !== 'undefined' ? window : globalThis);
