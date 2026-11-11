// ===== AXON P&L Forecast — motor de cálculo (réplica del Excel) =====
export type Tok = 'DEV_GRUPO' | 'DEV_MARCA' | 'DEV_EUPH' | 'MANT_GRUPO';
export type MCell = number | 'prev' | Tok;
export type GCell = number | { t: 'C' | 'prev'; k: number } | { t: 'hc' };
export interface Client { name: string; dev1: number[]; mant1: number[]; dev2: MCell[]; mant2: MCell[] }
export interface Line { name: string; base: number; y: GCell[] }
export interface Role { name: string; sal: number; hc: number[]; y: GCell[] }
export interface Params {
  comision: number; isr: number; ptu: number; inflacion: number; iaPersona: number; repoEmpresa: number;
  hostEmpresa: number; platBase: number; platPersona: number; devGrupo: number; devMarca: number; devEuph: number;
  exhibiciones: number; mantAgencia: number; agenciasGrupo: number; otrosGastosY2: number; empresasY1: number;
}
export interface Credito { monto: number; tasa: number; plazo: number }
export interface Val {
  bono: number; spread: number; betaU: number; dPeso: number; prima: number; pais: number; tamano: number; startup: number;
  da: number; capex: number; ct: number; g: number; caja: number; escenario: number;
  volBase: number[]; volMeta: number[]; precioBase: number[]; precioMeta: number[]; meta: number;
}
export interface Model {
  months1: string[]; months2: string[]; clients: Client[];
  y1: Record<string, number[]>; opex: Line[]; admin: Role[]; mkt: Line[];
  params: Params; credito: Credito; val: Val;
}

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

export function tokValue(t: Tok, p: Params): number {
  switch (t) {
    case 'DEV_GRUPO': return p.devGrupo / p.exhibiciones;
    case 'DEV_MARCA': return p.devMarca / p.exhibiciones;
    case 'DEV_EUPH': return p.devEuph / p.exhibiciones;
    case 'MANT_GRUPO': return p.mantAgencia * p.agenciasGrupo;
  }
}

export function resolveRow(cells: MCell[], prior: number, p: Params): number[] {
  const out: number[] = [];
  cells.forEach((c, i) => {
    if (c === 'prev') out.push(i === 0 ? prior : out[i - 1]);
    else if (typeof c === 'number') out.push(c);
    else out.push(tokValue(c, p));
  });
  return out;
}

export function resolveG(cells: GCell[], base: number, hc?: number[], sal?: number): number[] {
  const out: number[] = [];
  cells.forEach((c, i) => {
    if (typeof c === 'number') out.push(c);
    else if (c.t === 'C') out.push(base * c.k);
    else if (c.t === 'prev') out.push((i === 0 ? base : out[i - 1]) * c.k);
    else out.push((hc ? hc[i] : 0) * (sal || 0));
  });
  return out;
}

export interface Credit { rows: { n: number; interes: number; capital: number; pago: number; saldo: number }[]; years: { pago: number; interes: number; capital: number }[] }
export function credit(c: Credito): Credit {
  const n = Math.round(c.plazo * 12), r = c.tasa / 12, cap = n > 0 ? c.monto / n : 0;
  let saldo = c.monto; const rows: Credit['rows'] = [];
  for (let i = 1; i <= n; i++) {
    const interes = saldo * r; saldo -= cap;
    rows.push({ n: i, interes, capital: cap, pago: interes + cap, saldo: Math.abs(saldo) < 1e-6 ? 0 : saldo });
  }
  const years: Credit['years'] = [];
  for (let y = 0; y < Math.ceil(n / 12); y++) {
    const s = rows.slice(y * 12, y * 12 + 12);
    years.push({ pago: sum(s.map(x => x.pago)), interes: sum(s.map(x => x.interes)), capital: sum(s.map(x => x.capital)) });
  }
  return { rows, years };
}

export const PL_KEYS = ['dev', 'mant', 'otros', 'venta', 'ia', 'repos', 'host', 'plat', 'comis', 'costos', 'ub', 'go', 'ga', 'mkt', 'capex', 'otrosg', 'da', 'gasto', 'uo', 'cif', 'uai', 'isr', 'un', 'empresas'] as const;
export type PLKey = typeof PL_KEYS[number];
export type Series = Record<PLKey, number[]>;

function finish(s: Partial<Series>, n: number) {
  const z = (k: PLKey) => (s[k] as number[]) || Array(n).fill(0);
  const S = s as Series;
  S.venta = z('dev').map((v, i) => v + z('mant')[i] + z('otros')[i]);
  S.costos = z('ia').map((v, i) => v + z('repos')[i] + z('host')[i] + z('plat')[i] + z('comis')[i]);
  S.ub = S.venta.map((v, i) => v - S.costos[i]);
  S.gasto = z('go').map((v, i) => v + z('ga')[i] + z('mkt')[i] + z('capex')[i] + z('otrosg')[i] + z('da')[i]);
  S.uo = S.ub.map((v, i) => v - S.gasto[i]);
  S.uai = S.uo.map((v, i) => v - z('cif')[i]);
  return S;
}

export interface Result {
  gastos: { opex: number[][]; opexTot: number[]; admin: number[][]; adminTot: number[]; hcTot: number[]; mkt: number[][]; mktTot: number[] };
  m1: Series; m2: Series; annual: Series; acum1: number[]; acum2: number[]; acumY: number[];
  cred: Credit; clientsY2: { dev: number[]; mant: number[] }[];
  scen: { vol: number[]; precio: number[]; factor: number[]; label: string };
  v: {
    rf: number; betaL: number; ke0: number; ke: number; kdAt: number; de: number; wacc: number; primaMkt: number;
    ventas: number[]; ebitda: number[]; daA: number[]; ebit: number[]; isrA: number[]; nopat: number[]; capexA: number[]; ctA: number[]; fcff: number[];
    periodo: number[]; factor: number[]; pv: number[]; fcffT: number; tv: number; tvFactor: number; pvTv: number; sumPv: number;
    ev: number; deuda: number; caja: number; equity: number; pctTv: number; evVentas: number; evEbitda: number; cumple: boolean;
    sensA: { rows: number[]; cols: number[]; m: number[][] }; sensB: { rows: number[]; cols: number[]; m: number[][] };
  };
}

export function compute(M: Model): Result {
  const P = M.params, V = M.val;
  // ---------- Gastos ----------
  const opex = M.opex.map(l => resolveG(l.y, l.base));
  const opexTot = [0, 1, 2, 3, 4].map(i => sum(opex.map(r => r[i])));
  const admin = M.admin.map(r => resolveG(r.y, r.sal, r.hc, r.sal));
  const adminTot = [0, 1, 2, 3, 4].map(i => sum(admin.map(r => r[i])));
  const hcTot = [0, 1, 2, 3, 4].map(i => sum(M.admin.map(r => r.hc[i])));
  const mkt = M.mkt.map(l => resolveG(l.y, l.base));
  const mktTot = [0, 1, 2, 3, 4].map(i => sum(mkt.map(r => r[i])));

  // ---------- Escenario ----------
  const meta = V.escenario === 2;
  const vol = meta ? V.volMeta : V.volBase, precio = meta ? V.precioMeta : V.precioBase;
  const factor: number[] = [];
  vol.forEach((g, i) => factor.push((i === 0 ? 1 : factor[i - 1]) * (1 + g) / (1 + V.volBase[i])));
  const label = meta ? `Meta (valuación +$${Math.round(V.meta / 1e6)}M)` : 'Base (plan original)';

  const cred = credit(M.credito);

  // ---------- Año 1 (histórico/presupuesto, 14 meses) ----------
  const n1 = M.months1.length;
  const m1: Partial<Series> = {
    dev: Array(n1).fill(0).map((_, i) => sum(M.clients.map(c => c.dev1[i]))),
    mant: Array(n1).fill(0).map((_, i) => sum(M.clients.map(c => c.mant1[i]))),
    otros: M.y1.otros, ia: M.y1.ia, repos: M.y1.repos, host: M.y1.host, plat: M.y1.plat, comis: M.y1.comis,
    go: M.y1.go, ga: M.y1.ga, mkt: M.y1.mkt, capex: M.y1.capex, otrosg: M.y1.otrosg, da: M.y1.da, cif: M.y1.cif, isr: M.y1.isr,
    empresas: Array(n1).fill(0),
  };
  const S1 = finish(m1, n1);
  S1.un = S1.uai.map((v, i) => v - S1.isr[i]);

  // ---------- Año 2 (mensual) ----------
  const clientsY2 = M.clients.map(c => ({
    dev: resolveRow(c.dev2, c.dev1[n1 - 1], P),
    mant: resolveRow(c.mant2, c.mant1[n1 - 1], P),
  }));
  const r12 = Array(12).fill(0).map((_, i) => i);
  const m2: Partial<Series> = {};
  m2.dev = r12.map(i => sum(clientsY2.map(c => c.dev[i])));
  m2.mant = r12.map(i => sum(clientsY2.map(c => c.mant[i])));
  m2.otros = r12.map(() => 0);
  m2.empresas = r12.map(i => clientsY2.filter(c => c.mant[i] > 0).length);
  m2.ia = r12.map(() => P.iaPersona * hcTot[1]);
  m2.repos = m2.empresas.map(e => P.repoEmpresa * e);
  m2.host = m2.empresas.map(e => P.hostEmpresa * e);
  m2.plat = r12.map(() => P.platBase + P.platPersona * hcTot[1]);
  m2.comis = m2.dev.map(d => d * P.comision);
  m2.go = r12.map(() => opexTot[1]);
  m2.ga = r12.map(() => adminTot[1]);
  m2.mkt = r12.map(i => (i < 6 ? mktTot[1] / 2 : mktTot[1]));
  m2.capex = r12.map(() => 0);
  m2.otrosg = r12.map(() => P.otrosGastosY2);
  m2.da = r12.map(() => 0);
  m2.cif = r12.map(i => (cred.rows[i] ? cred.rows[i].interes : 0));
  const S2 = finish(m2, 12);
  S2.isr = S2.uai.map(v => (v < 0 ? 0 : v * (P.isr + P.ptu)));
  S2.un = S2.uai.map((v, i) => v - S2.isr[i]);

  // ---------- Anual (5 años) ----------
  const A: Partial<Series> = {};
  const inf = P.inflacion;
  PL_KEYS.forEach(k => { (A as any)[k] = [sum(S1[k]), sum(S2[k]), 0, 0, 0]; });
  A.empresas![0] = P.empresasY1; A.empresas![1] = S2.empresas[11];
  for (let y = 2; y < 5; y++) {
    const j = y - 2, e = y - 1; // j: índice escenario; e: exponente inflación
    A.dev![y] = A.dev![y - 1] * (1 + vol[j]) * (1 + precio[j]);
    A.mant![y] = A.mant![y - 1] * (1 + vol[j]);
    A.otros![y] = A.otros![y - 1] * (1 + vol[j]);
    A.empresas![y] = Math.round(A.empresas![y - 1] * (1 + vol[j]));
    const fi = Math.pow(1 + inf, e);
    A.ia![y] = P.iaPersona * fi * hcTot[y] * factor[j] * 12;
    A.repos![y] = P.repoEmpresa * fi * A.empresas![y] * 12;
    A.host![y] = P.hostEmpresa * fi * A.empresas![y] * 12;
    A.plat![y] = (P.platBase + P.platPersona * hcTot[y] * factor[j]) * fi * 12;
    A.comis![y] = A.dev![y] * P.comision;
    A.go![y] = opexTot[y] * 12 * fi;
    A.ga![y] = adminTot[y] * 12 * fi;
    A.mkt![y] = mktTot[y] * 12 * fi;
    A.capex![y] = 0; A.da![y] = 0;
    A.otrosg![y] = A.otrosg![y - 1] * (1 + inf);
    A.cif![y] = cred.years[y - 1] ? cred.years[y - 1].interes : 0;
  }
  const SA = finish(A, 5);
  SA.isr = SA.uai.map((v, i) => (i < 2 ? (A.isr as number[])[i] : v < 0 ? 0 : v * (P.isr + P.ptu)));
  SA.un = SA.uai.map((v, i) => v - SA.isr[i]);

  const acum1: number[] = []; S1.un.forEach((v, i) => acum1.push((i ? acum1[i - 1] : 0) + v));
  const acum2: number[] = []; S2.un.forEach((v, i) => acum2.push((i ? acum2[i - 1] : acum1[n1 - 1]) + v));
  const acumY = [acum1[n1 - 1], acum2[11]];
  for (let y = 2; y < 5; y++) acumY.push(acumY[y - 1] + SA.un[y]);

  // ---------- Valuación ----------
  const rf = V.bono - V.spread, de = V.dPeso / (1 - V.dPeso), betaL = V.betaU * (1 + (1 - P.isr) * de);
  const primaMkt = V.prima + V.pais, ke0 = rf + betaL * primaMkt, ke = ke0 + V.tamano + V.startup;
  const kdAt = M.credito.tasa * (1 - P.isr);
  const waccOf = (keX: number) => keX * (1 - V.dPeso) + kdAt * V.dPeso;
  const wacc = waccOf(ke);
  const ventas = SA.venta.slice(), ebitda = SA.uo.map((v, i) => v + SA.da[i]);
  const idx = [1, 2, 3, 4];
  const daA = idx.map(i => -ventas[i] * V.da), ebit = idx.map((i, k) => ebitda[i] + daA[k]);
  const isrA = ebit.map(x => -Math.max(0, x) * P.isr), nopat = ebit.map((x, k) => x + isrA[k]);
  const capexA = idx.map(i => -ventas[i] * V.capex), ctA = idx.map(i => -(ventas[i] - ventas[i - 1]) * V.ct);
  const fcff = idx.map((_, k) => nopat[k] - daA[k] + capexA[k] + ctA[k]);
  const periodo = [0.5, 1.5, 2.5, 3.5];
  const deuda = M.credito.monto, caja = V.caja;
  const eqAt = (w: number, g: number) => {
    const pv = fcff.reduce((s, f, k) => s + f / Math.pow(1 + w, periodo[k]), 0);
    return pv + (fcff[3] * (1 + g) / (w - g)) / Math.pow(1 + w, periodo[3] + 0.5) - deuda + caja;
  };
  const fac = periodo.map(t => 1 / Math.pow(1 + wacc, t)), pv = fcff.map((f, k) => f * fac[k]);
  const fcffT = fcff[3] * (1 + V.g), tv = fcffT / (wacc - V.g), tvFactor = 1 / Math.pow(1 + wacc, periodo[3] + 0.5);
  const pvTv = tv * tvFactor, sumPv = sum(pv), ev = sumPv + pvTv, equity = ev - deuda + caja;
  const gCols = [-0.01, -0.005, 0, 0.005, 0.01].map(d => V.g + d);
  const wRows = [-0.02, -0.01, 0, 0.01, 0.02].map(d => wacc + d);
  const pRows = [-0.04, -0.02, 0, 0.02, 0.04].map(d => V.startup + d);
  return {
    gastos: { opex, opexTot, admin, adminTot, hcTot, mkt, mktTot },
    m1: S1, m2: S2, annual: SA, acum1, acum2, acumY, cred, clientsY2,
    scen: { vol, precio, factor, label },
    v: {
      rf, betaL, ke0, ke, kdAt, de, wacc, primaMkt, ventas, ebitda, daA, ebit, isrA, nopat, capexA, ctA, fcff, periodo, factor: fac, pv,
      fcffT, tv, tvFactor, pvTv, sumPv, ev, deuda, caja, equity, pctTv: pvTv / ev, evVentas: ev / ventas[1], evEbitda: tv / ebitda[4],
      cumple: equity >= V.meta,
      sensA: { rows: wRows, cols: gCols, m: wRows.map(w => gCols.map(g => eqAt(w, g))) },
      sensB: { rows: pRows, cols: gCols, m: pRows.map(p => gCols.map(g => eqAt(waccOf(ke0 + V.tamano + p), g))) },
    },
  };
}
