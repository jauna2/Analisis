/* =====================================================================
   Unidades de trabajo (como ETABS): el modelo se guarda SIEMPRE en kN, m, s
   (masa en t = kN·s²/m, esfuerzos en kN/m²). Las unidades elegidas solo
   cambian lo que se muestra y cómo se interpreta lo que se escribe.
   ===================================================================== */
(function (root) {
  'use strict';
  // factores: cuántas unidades internas (kN, m, kN/m²) hay en 1 unidad de visualización
  const F = { N: 1e-3, kN: 1, kgf: 0.00980665, tf: 9.80665, lbf: 0.0044482216152605, kip: 4.4482216152605 };
  const L = { mm: 1e-3, cm: 1e-2, m: 1, in: 0.0254, ft: 0.3048 };
  const S = { kPa: 1, MPa: 1e3, GPa: 1e6, 'kgf/cm²': 98.0665, 'tf/m²': 9.80665, psi: 6.894757293168, ksi: 6894.757293168 };
  const LABEL_F = { lbf: 'lb' };

  const PRESETS = [
    { id: 'kN-m', name: 'kN, m (SI)', u: { F: 'kN', L: 'm', S: 'MPa', D: 'mm' } },
    { id: 'N-mm', name: 'N, mm (SI)', u: { F: 'N', L: 'mm', S: 'MPa', D: 'mm' } },
    { id: 'kN-mm', name: 'kN, mm', u: { F: 'kN', L: 'mm', S: 'MPa', D: 'mm' } },
    { id: 'kgf-cm', name: 'kgf, cm (MKS)', u: { F: 'kgf', L: 'cm', S: 'kgf/cm²', D: 'cm' } },
    { id: 'kgf-m', name: 'kgf, m', u: { F: 'kgf', L: 'm', S: 'kgf/cm²', D: 'mm' } },
    { id: 'tf-m', name: 'tf, m', u: { F: 'tf', L: 'm', S: 'kgf/cm²', D: 'mm' } },
    { id: 'kip-in', name: 'kip, in (inglés)', u: { F: 'kip', L: 'in', S: 'ksi', D: 'in' } },
    { id: 'kip-ft', name: 'kip, ft (inglés)', u: { F: 'kip', L: 'ft', S: 'ksi', D: 'in' } },
    { id: 'lb-in', name: 'lb, in (inglés)', u: { F: 'lbf', L: 'in', S: 'psi', D: 'in' } },
    { id: 'lb-ft', name: 'lb, ft (inglés)', u: { F: 'lbf', L: 'ft', S: 'psi', D: 'in' } }
  ];

  const U = {
    F, L, S, PRESETS,
    cur: { F: 'kN', L: 'm', S: 'MPa', D: 'mm' },
    set(u) {
      const c = Object.assign({}, this.cur, u || {});
      if (!(c.F in F)) c.F = 'kN'; if (!(c.L in L)) c.L = 'm'; if (!(c.S in S)) c.S = 'MPa'; if (!(c.D in L)) c.D = 'mm';
      this.cur = c; return c;
    },
    presetId() { const c = this.cur; const p = PRESETS.find(p => p.u.F === c.F && p.u.L === c.L && p.u.S === c.S && p.u.D === c.D); return p ? p.id : 'custom'; },
    /** Factor interno por unidad de visualización para cada dimensión. */
    fac(dim) {
      const f = F[this.cur.F], l = L[this.cur.L];
      switch (dim) {
        case 'L': return l;               // longitud, coordenadas
        case 'D': return L[this.cur.D];   // desplazamientos
        case 'F': return f;               // fuerza
        case 'M': return f * l;           // momento
        case 'FL': return f / l;          // carga distribuida (fuerza/longitud)
        case 'G': return f / (l * l * l); // peso específico
        case 'S': return S[this.cur.S];   // esfuerzo, módulos
        case 'A': return l * l;
        case 'L3': return l * l * l;
        case 'I': return l ** 4;
        case 'm': return f / l;           // masa = F·s²/L
        case 'mr': return f * l;          // inercia de masa = F·s²·L
        case 'sm': return Math.sqrt(f / l); // raíz de masa (factor de participación)
        default: return 1;
      }
    },
    /** interno -> visualización */
    v(x, dim) { return +x / this.fac(dim); },
    /** visualización -> interno */
    s(x, dim) { return +x * this.fac(dim); },
    massLabel() {
      const f = this.cur.F, l = this.cur.L, k = F[f] / L[l];
      if (Math.abs(k - 1) < 1e-12) return 't';
      if (Math.abs(k - 1e-3) < 1e-15) return 'kg';
      if (f === 'lbf' && l === 'ft') return 'slug';
      return `${LABEL_F[f] || f}·s²/${l}`;
    },
    u(dim) {
      const f = LABEL_F[this.cur.F] || this.cur.F, l = this.cur.L;
      switch (dim) {
        case 'L': return l; case 'D': return this.cur.D; case 'F': return f;
        case 'M': return `${f}·${l}`; case 'FL': return `${f}/${l}`; case 'G': return `${f}/${l}³`;
        case 'S': return this.cur.S; case 'A': return `${l}²`; case 'L3': return `${l}³`; case 'I': return `${l}⁴`;
        case 'm': return this.massLabel(); case 'mr': return `${this.massLabel()}·${l}²`; case 'sm': return `√${this.massLabel()}`;
        default: return '';
      }
    },
    /** texto para un campo de entrada (sin ruido de coma flotante) */
    i(x, dim) { const v = this.v(x, dim); return isFinite(v) ? String(+v.toPrecision(10)) : ''; },
    /** texto formateado para tablas */
    f(x, dim, d = 4) {
      const v = this.v(x, dim); if (!isFinite(v)) return '—';
      const a = Math.abs(v); if (a === 0) return '0';
      if (a < 1e-3 || a >= 1e7) return v.toExponential(Math.max(0, d - 1));
      return v.toFixed(d);
    },
    /** lista de coordenadas guardada (interna) -> texto en unidades actuales */
    listOut(arr) { return arr.map(x => this.i(x, 'L')).join(', '); },
    tag() { return `${LABEL_F[this.cur.F] || this.cur.F}, ${this.cur.L}`; }
  };
  root.Units = U;
  if (typeof module !== 'undefined' && module.exports) module.exports = U;
})(typeof window !== 'undefined' ? window : globalThis);
