// ===== AXON P&L Forecast — motor de cálculo (réplica del Excel) =====
export type Tok = 'DEV_GRUPO' | 'DEV_MARCA' | 'DEV_EUPH' | 'MANT_GRUPO' | 'MANT_MEDIANA' | 'MANT_TRANS';
export type MCell = number | 'prev' | Tok;
/** Mantenimiento 2027 con contrato anual: después de la primera mensualidad todos los meses arrastran ese valor ('prev') */
export function fijarMant(mant2: MCell[], carry: number): MCell[] {
  // El primer mes con mensualidad (capturada o arrastrada de 2026) es el único editable
  let started = false;
  return mant2.map((c, k) => {
    if (started) return 'prev';
    if (c !== 'prev' ? typeof c !== 'number' || c > 0 : k === 0 && carry > 0) started = true;
    return c;
  });
}
export type GCell = number | { t: 'C' | 'prev'; k: number } | { t: 'hc' };
export interface Client { name: string; dev1: number[]; mant1: number[]; dev2: MCell[]; mant2: MCell[]; /** Necesidad de capital: forzar cliente nuevo (aplica ciclo comercial) o existente */ nuevo?: boolean }
export interface Line { name: string; base: number; y: GCell[]; /** Monto mensual 2027 por semestre (ene–jun / jul–dic); por omisión 50% y 100% del monto 2027 */ s1?: number; s2?: number }
export interface Role { name: string; sal: number; hc: number[]; y: GCell[]; /** true: su nómina es costo directo (no gasto administrativo) */ directo?: boolean;
  /** Sueldo mensual 2027 por semestre (ene–jun / jul–dic); si no se captura, usa `sal` */ salS1?: number; salS2?: number }
export interface Params {
  comision: number; isr: number; ptu: number; inflacion: number; iaPersona: number; repoEmpresa: number;
  hostEmpresa: number; platBase: number; platPersona: number; devGrupo: number; devMarca: number; devEuph: number;
  exhibiciones: number; mantAgencia: number;
  /** Mantenimiento mensual de una empresa (no grupo) */
  mantMediana?: number; mantTrans?: number;
  agenciasGrupo: number; otrosGastosY2: number; empresasY1: number;
  /** Incremento de precios (fracción) sobre desarrollo y mantenimiento, y mes en que arranca (0 = ene-2027 … 47 = dic-2030) */
  precioInc?: number; precioDesde?: number;
  /** Carga social patronal sobre la nómina de 2027 en adelante (fracción del sueldo) */
  cargaSocial?: number;
  /** Incremento de sueldos (fracción) para todos los puestos y mes en que arranca (0 = ene-2027 … 47 = dic-2030) */
  sueldoInc?: number; sueldoDesde?: number;
  /** true: inflación en precios, costos y gastos; false: sin inflación; sin definir: solo costos y gastos, como el Excel (los modelos guardados se migran a true) */
  aplicarInflacion?: boolean;
  /** Churn: % anual de la base de mantenimiento que se pierde (desde 2027) */
  churn?: number;
  /** PTU: 10% de la utilidad antes de impuestos, tope de 3 meses de sueldo; se suma a la nómina y se paga en mayo del año siguiente */
  aplicarPTU?: boolean;
  /** Amortizar pérdidas fiscales de años anteriores contra la utilidad (sin definir: como el Excel, sin amortizar) */
  amortizarPerdidas?: boolean;
}
export interface Credito { monto: number; tasa: number; plazo: number }
export interface Val {
  bono: number; spread: number; betaU: number; dPeso: number; prima: number; pais: number; tamano: number; startup: number;
  da: number; capex: number; ct: number; g: number; caja: number; escenario: number;
  volBase: number[]; volMeta: number[]; precioBase: number[]; precioMeta: number[]; meta: number;
  /** Capital de trabajo operativo por días; sin definir usa ct (% del aumento en ventas) */
  wc?: WC;
  /** Valor terminal con convenciones de mercado: flujo normalizado (capital de trabajo a ritmo g, CAPEX de reposición = D&A) y descuento a mitad de año. Sin definir: como el Excel */
  tvAjustado?: boolean;
}
export interface WC { dso: number; credito: number; dio: number; dpo: number; base: number }
export interface Model {
  months1: string[]; months2: string[]; clients: Client[];
  y1: Record<string, number[]>; opex: Line[]; admin: Role[]; mkt: Line[];
  params: Params; credito: Credito; val: Val;
  /** Ciclo comercial: etapas del primer contacto al primer pago (días) */
  ciclo?: Etapa[];
  /** CAPEX: inversión capitalizable que se deprecia/amortiza en línea recta (mes: índice desde nov-25) */
  capex?: { equipos: { cantidad: number; precio: number; mes: number; anios: number; /** true: un equipo por cada persona que se integra, comprado en enero de su año */ porPersona?: boolean }; oficinas: { monto: number; mes: number; anios: number } };
  /** Migraciones de datos guardados que ya se aplicaron */
  migr?: Record<string, boolean>;
  /** Plan de disposiciones trimestrales del capital nuevo: mes de inicio (índice desde nov-25) y colchón de caja en meses */
  plan?: { inicio: number; colchonMeses: number; primera?: number; cobertura?: number };
}
export interface Etapa { etapa: string; dias: number }

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

export function tokValue(t: Tok, p: Params): number {
  switch (t) {
    case 'DEV_GRUPO': return p.devGrupo / p.exhibiciones;
    case 'DEV_MARCA': return p.devMarca / p.exhibiciones;
    case 'DEV_EUPH': return p.devEuph / p.exhibiciones;
    case 'MANT_GRUPO': return p.mantAgencia * p.agenciasGrupo;
    case 'MANT_MEDIANA': return p.mantMediana ?? 0;
    case 'MANT_TRANS': return p.mantTrans ?? 0;
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

export const PL_KEYS = ['dev', 'mant', 'otros', 'venta', 'ia', 'repos', 'host', 'plat', 'comis', 'personal', 'costos', 'ub', 'go', 'ga', 'mkt', 'capex', 'otrosg', 'gasto', 'ebitda', 'da', 'uo', 'cif', 'uai', 'isr', 'un', 'empresas'] as const;
export type PLKey = typeof PL_KEYS[number];
export type Series = Record<PLKey, number[]>;

function finish(s: Partial<Series>, n: number) {
  const z = (k: PLKey) => (s[k] as number[]) || Array(n).fill(0);
  const S = s as Series;
  S.venta = z('dev').map((v, i) => v + z('mant')[i] + z('otros')[i]);
  S.costos = z('ia').map((v, i) => v + z('repos')[i] + z('host')[i] + z('plat')[i] + z('comis')[i] + z('personal')[i]);
  S.ub = S.venta.map((v, i) => v - S.costos[i]);
  // Gasto antes de D&A → EBITDA → D&A → utilidad de operación (EBIT)
  S.gasto = z('go').map((v, i) => v + z('ga')[i] + z('mkt')[i] + z('capex')[i] + z('otrosg')[i]);
  S.ebitda = S.ub.map((v, i) => v - S.gasto[i]);
  S.uo = S.ebitda.map((v, i) => v - z('da')[i]);
  S.uai = S.uo.map((v, i) => v - z('cif')[i]);
  return S;
}

export interface Result {
  /** CAPEX mes a mes (nov-25 … dic-30): salida de caja y D&A; y por año */
  /** PTU devengada por año (2026–2030) */
  ptu: number[];
  /** Pérdidas fiscales: saldo por amortizar al cierre de cada año y pérdida aplicada en el año */
  fiscal: { saldo: number[]; aplicada: number[] };
  capexPlan: { cash: number[]; da: number[]; inversionAnual: number[]; daAnual: number[]; equiposNuevos: number[] };
  gastos: { opex: number[][]; opexTot: number[]; admin: number[][]; adminTot: number[]; dirTot: number[]; hcTot: number[]; mkt: number[][]; mktTot: number[];
    /** 2027 por semestre: costo mensual por puesto [S1, S2] y totales [S1, S2] */ admin27: number[][]; admin27Tot: number[]; dir27Tot: number[]; mkt27: number[][]; mkt27Tot: number[] };
  m1: Series; m2: Series; annual: Series; acum1: number[]; acum2: number[]; acumY: number[];
  cred: Credit; clientsY2: { dev: number[]; mant: number[] }[];
  scen: { vol: number[]; precio: number[]; factor: number[]; label: string };
  v: {
    rf: number; betaL: number; ke0: number; ke: number; kdAt: number; de: number; wacc: number; primaMkt: number;
    ventas: number[]; ebitda: number[]; daA: number[]; ebit: number[]; isrA: number[]; nopat: number[]; capexA: number[]; ctA: number[]; fcff: number[];
    periodo: number[]; factor: number[]; pv: number[]; fcffT: number; tv: number; tvFactor: number; pvTv: number; sumPv: number;
    wc: { cxc: number[]; inv: number[]; cxp: number[]; ctn: number[] };
    ev: number; deuda: number; caja: number; equity: number; pctTv: number; evVentas: number; evEbitda: number; tvEbitda: number; cumple: boolean;
    sensA: { rows: number[]; cols: number[]; m: number[][] }; sensB: { rows: number[]; cols: number[]; m: number[][] };
  };
}

export function compute(M: Model): Result {
  const P = M.params, V = M.val;
  // ---------- Gastos ----------
  const opex = M.opex.map(l => resolveG(l.y, l.base));
  const opexTot = [0, 1, 2, 3, 4].map(i => sum(opex.map(r => r[i])));
  const carga = P.cargaSocial ?? 0; // 2026 queda como monto fijo capturado
  const admin = M.admin.map(r => resolveG(r.y, r.sal, r.hc, r.sal).map((v, k) => (k ? v * (1 + carga) : v)));
  // Nómina administrativa (gasto) y nómina de personal directo (costo)
  const adminTot = [0, 1, 2, 3, 4].map(i => sum(admin.filter((_, j) => !M.admin[j].directo).map(r => r[i])));
  const dirTot = [0, 1, 2, 3, 4].map(i => sum(admin.filter((_, j) => M.admin[j].directo).map(r => r[i])));
  const hcTot = [0, 1, 2, 3, 4].map(i => sum(M.admin.map(r => r.hc[i])));
  // 2027 por semestre: cada puesto puede tener un sueldo distinto en ene–jun y jul–dic (mueve P&L mensual y caja)
  const admin27 = M.admin.map((r, j) => {
    const c = r.y[1];
    if (typeof c === 'number' || c.t !== 'hc') return [admin[j][1], admin[j][1]];
    return [r.salS1 ?? r.sal, r.salS2 ?? r.sal].map(sl => r.hc[1] * sl * (1 + carga));
  });
  const admin27Tot = [0, 1].map(h => sum(admin27.filter((_, j) => !M.admin[j].directo).map(x => x[h])));
  const dir27Tot = [0, 1].map(h => sum(admin27.filter((_, j) => M.admin[j].directo).map(x => x[h])));
  // Costo mensual 2027 = promedio de los dos semestres
  adminTot[1] = (admin27Tot[0] + admin27Tot[1]) / 2; dirTot[1] = (dir27Tot[0] + dir27Tot[1]) / 2;
  admin.forEach((row, j) => { row[1] = (admin27[j][0] + admin27[j][1]) / 2; });
  const mkt = M.mkt.map(l => resolveG(l.y, l.base));
  const mktTot = [0, 1, 2, 3, 4].map(i => sum(mkt.map(r => r[i])));
  // Marketing 2027 por semestre: cada concepto con su monto mensual de ene–jun y de jul–dic
  const mkt27 = M.mkt.map((l, j) => [l.s1 ?? mkt[j][1] / 2, l.s2 ?? mkt[j][1]]);
  const mkt27Tot = [0, 1].map(h => sum(mkt27.map(x => x[h])));

  // ---------- Escenario ----------
  const meta = V.escenario === 2;
  const vol = meta ? V.volMeta : V.volBase, precio = meta ? V.precioMeta : V.precioBase;
  const factor: number[] = [];
  vol.forEach((g, i) => factor.push((i === 0 ? 1 : factor[i - 1]) * (1 + g) / (1 + V.volBase[i])));
  const label = meta ? `Meta (valuación +$${Math.round(V.meta / 1e6)}M)` : 'Base (plan original)';

  const cred = credit(M.credito);

  // ---------- CAPEX y D&A (línea recta desde el mes de compra) ----------
  const NM = 62, cxCash = Array(NM).fill(0), cxDa = Array(NM).fill(0);
  if (M.capex) {
    const eq = M.capex.equipos;
    const items = [
      ...(eq.porPersona
        // Un equipo por cada persona nueva en la plantilla, comprado en enero del año en que se integra (2027–2030)
        ? [1, 2, 3, 4].map(y => ({ monto: Math.max(0, hcTot[y] - hcTot[y - 1]) * eq.precio, mes: 14 + (y - 1) * 12, anios: eq.anios }))
        : [{ monto: eq.cantidad * eq.precio, mes: eq.mes, anios: eq.anios }]),
      { monto: M.capex.oficinas.monto, mes: M.capex.oficinas.mes, anios: M.capex.oficinas.anios },
    ];
    items.forEach(it => {
      if (!(it.monto > 0) || it.mes < 0 || it.mes >= NM) return;
      cxCash[it.mes] += it.monto;
      const n = Math.max(1, Math.round(it.anios * 12));
      for (let k = 0; k < n && it.mes + k < NM; k++) cxDa[it.mes + k] += it.monto / n;
    });
  }
  const anualDe = (a: number[]) => [a.slice(0, 14), a.slice(14, 26), a.slice(26, 38), a.slice(38, 50), a.slice(50, 62)].map(sum);

  // ---------- Año 1 (histórico/presupuesto, 14 meses) ----------
  const n1 = M.months1.length;
  const m1: Partial<Series> = {
    dev: Array(n1).fill(0).map((_, i) => sum(M.clients.map(c => c.dev1[i]))),
    mant: Array(n1).fill(0).map((_, i) => sum(M.clients.map(c => c.mant1[i]))),
    otros: M.y1.otros, ia: M.y1.ia, repos: M.y1.repos, host: M.y1.host, plat: M.y1.plat, comis: M.y1.comis,
    go: M.y1.go, ga: M.y1.ga, mkt: M.y1.mkt, capex: M.y1.capex, otrosg: M.y1.otrosg, da: M.y1.da.map((v, i) => v + cxDa[i]), cif: M.y1.cif, isr: M.y1.isr,
    empresas: Array(n1).fill(0), personal: Array(n1).fill(0),
  };
  const S1 = finish(m1, n1);
  S1.un = S1.uai.map((v, i) => v - S1.isr[i]);

  // ---------- Año 2 (mensual) ----------
  // Churn: el contrato de mantenimiento es anual, así que la mensualidad de cada cliente se mantiene igual
  // todos los meses de 2027; la pérdida de clientes se aplica al renovar (cada año, desde 2028)
  const churn = Math.min(0.99, Math.max(0, P.churn ?? 0));
  const clientsY2 = M.clients.map(c => ({
    dev: resolveRow(c.dev2, c.dev1[n1 - 1], P),
    mant: resolveRow(c.mant2, c.mant1[n1 - 1], P),
    survDic: 1, // en 2027 no hay renovaciones: todos los clientes con mantenimiento siguen activos al cierre
  }));
  const r12 = Array(12).fill(0).map((_, i) => i);
  const m2: Partial<Series> = {};
  // Incremento de precios: multiplicador por mes de 2027 y proporción del año afectada en 2028–2030
  const pInc = P.precioInc ?? 0, pDesde = P.precioDesde ?? 0;
  const pMesY2 = (i: number) => 1 + (i >= pDesde ? pInc : 0);
  const pAnio = (y: number) => 1 + pInc * Math.min(12, Math.max(0, 12 * y - pDesde)) / 12; // y: 1 = 2027 … 4 = 2030
  const sInc = P.sueldoInc ?? 0, sDesde = P.sueldoDesde ?? 0;
  const sMesY2 = (i: number) => 1 + (i >= sDesde ? sInc : 0);
  const sAnio = (y: number) => 1 + sInc * Math.min(12, Math.max(0, 12 * y - sDesde)) / 12;
  const baseDev2 = r12.map(i => sum(clientsY2.map(c => c.dev[i])));
  const baseMant2 = r12.map(i => sum(clientsY2.map(c => c.mant[i])));
  m2.dev = baseDev2.map((v, i) => v * pMesY2(i));
  m2.mant = baseMant2.slice(); // las mensualidades no llevan incremento de precio
  m2.otros = r12.map(() => 0);
  m2.empresas = r12.map(i => clientsY2.filter(c => c.mant[i] > 0).length);
  m2.ia = r12.map(() => P.iaPersona * hcTot[1]);
  m2.repos = m2.empresas.map(e => P.repoEmpresa * e);
  m2.host = m2.empresas.map(e => P.hostEmpresa * e);
  m2.plat = r12.map(() => P.platBase + P.platPersona * hcTot[1]);
  m2.comis = m2.dev.map(d => d * P.comision);
  m2.personal = r12.map(i => dir27Tot[i < 6 ? 0 : 1] * sMesY2(i));
  m2.go = r12.map(() => opexTot[1]);
  m2.ga = r12.map(i => admin27Tot[i < 6 ? 0 : 1] * sMesY2(i));
  m2.mkt = r12.map(i => mkt27Tot[i < 6 ? 0 : 1]);
  m2.capex = r12.map(() => 0);
  m2.otrosg = r12.map(() => P.otrosGastosY2);
  m2.da = r12.map(i => cxDa[14 + i]);
  m2.cif = r12.map(i => (cred.rows[i] ? cred.rows[i].interes : 0));
  // PTU: 10% de la utilidad antes de impuestos (antes de PTU), con tope de 3 meses de sueldo; se reparte en la nómina
  const tasaImp = P.isr + (P.aplicarPTU ? 0 : P.ptu);
  const ptu = [0, 0, 0, 0, 0];
  const topePTU = (y: number) => 3 * (adminTot[y] + dirTot[y]) / (1 + carga);
  const partDir = (y: number) => (adminTot[y] + dirTot[y] ? dirTot[y] / (adminTot[y] + dirTot[y]) : 0);
  let S2 = finish(m2, 12);
  if (P.aplicarPTU) {
    ptu[1] = Math.min(0.1 * Math.max(0, sum(S2.uai)), topePTU(1) * sum(r12.map(sMesY2)) / 12);
    if (ptu[1] > 0) {
      m2.ga = m2.ga!.map(v => v + ptu[1] * (1 - partDir(1)) / 12);
      m2.personal = m2.personal!.map(v => v + ptu[1] * partDir(1) / 12);
      S2 = finish(m2, 12);
    }
  }
  S2.isr = S2.uai.map(v => (v < 0 ? 0 : v * tasaImp));
  S2.un = S2.uai.map((v, i) => v - S2.isr[i]);

  // ---------- Anual (5 años) ----------
  const A: Partial<Series> = {};
  // Inflación: a costos/gastos salvo que se desactive; a precios solo si se activa explícitamente
  const inf = P.aplicarInflacion === false ? 0 : P.inflacion;
  const infP = P.aplicarInflacion === true ? P.inflacion : 0;
  PL_KEYS.forEach(k => { (A as any)[k] = [sum(S1[k]), sum(S2[k]), 0, 0, 0]; });
  A.empresas![0] = P.empresasY1;
  // Clientes activos al cierre de 2027, netos de churn (suma de la probabilidad de permanencia de cada cliente)
  A.empresas![1] = Math.round(clientsY2.reduce((s, c) => s + (c.mant[11] > 0 ? c.survDic : 0), 0));
  // Ingresos sin el incremento de precios; el incremento se aplica encima según el año
  const bDev = [0, sum(baseDev2)], bMant = [0, sum(baseMant2)];
  for (let y = 2; y < 5; y++) {
    const j = y - 2, e = y - 1; // j: índice escenario; e: exponente inflación
    bDev[y] = bDev[y - 1] * (1 + vol[j]) * (1 + precio[j]);
    bMant[y] = bMant[y - 1] * (1 + vol[j]) * (1 - churn);
    const fp = Math.pow(1 + infP, e);
    A.dev![y] = bDev[y] * pAnio(y) * fp;
    A.mant![y] = bMant[y] * fp; // las mensualidades suben con la inflación, pero no con los incrementos de precio
    A.otros![y] = A.otros![y - 1] * (1 + vol[j]);
    A.empresas![y] = Math.round(A.empresas![y - 1] * (1 + vol[j]) * (1 - churn));
    const fi = Math.pow(1 + inf, e);
    A.ia![y] = P.iaPersona * fi * hcTot[y] * factor[j] * 12;
    A.repos![y] = P.repoEmpresa * fi * A.empresas![y] * 12;
    A.host![y] = P.hostEmpresa * fi * A.empresas![y] * 12;
    A.plat![y] = (P.platBase + P.platPersona * hcTot[y] * factor[j]) * fi * 12;
    A.comis![y] = A.dev![y] * P.comision;
    A.personal![y] = dirTot[y] * 12 * fi * sAnio(y);
    A.go![y] = opexTot[y] * 12 * fi;
    A.ga![y] = adminTot[y] * 12 * fi * sAnio(y);
    A.mkt![y] = mktTot[y] * 12 * fi;
    A.capex![y] = 0; A.da![y] = sum(cxDa.slice(26 + (y - 2) * 12, 38 + (y - 2) * 12));
    A.otrosg![y] = A.otrosg![y - 1] * (1 + inf);
    A.cif![y] = cred.years[y - 1] ? cred.years[y - 1].interes : 0;
  }
  let SA = finish(A, 5);
  if (P.aplicarPTU) {
    for (let y = 2; y < 5; y++) {
      ptu[y] = Math.min(0.1 * Math.max(0, SA.uai[y]), topePTU(y) * Math.pow(1 + inf, y - 1) * sAnio(y));
      A.ga![y] += ptu[y] * (1 - partDir(y));
      A.personal![y] += ptu[y] * partDir(y);
    }
    SA = finish(A, 5);
  }
  // ISR anual con amortización de pérdidas fiscales: las pérdidas se acumulan y se restan de la utilidad de los años siguientes
  const perdidas = [0, 0, 0, 0, 0], perdidaUsada = [0, 0, 0, 0, 0];
  let saldoPerd = 0;
  const amort = !!P.amortizarPerdidas;
  if (!amort) SA.isr = SA.uai.map((v, i) => (i < 2 ? (A.isr as number[])[i] : v < 0 ? 0 : v * tasaImp));
  else SA.isr = SA.uai.map((v, i) => {
    if (i === 0) { if (v < 0) saldoPerd += -v; perdidas[0] = saldoPerd; return (A.isr as number[])[0]; } // 2026: presupuesto capturado
    if (v <= 0) { saldoPerd += -v; perdidas[i] = saldoPerd; return 0; }
    const usa = Math.min(saldoPerd, v); saldoPerd -= usa; perdidaUsada[i] = usa; perdidas[i] = saldoPerd;
    return (v - usa) * tasaImp;
  });
  // 2027 mensual: el ISR del año se reparte entre los meses con utilidad
  if (amort) {
    const posM = S2.uai.map(v => Math.max(0, v)), totPos = sum(posM);
    S2.isr = posM.map(v => (totPos ? SA.isr[1] * v / totPos : 0));
    S2.un = S2.uai.map((v, i) => v - S2.isr[i]);
  }
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
  const ventas = SA.venta.slice(), ebitda = SA.ebitda.slice();
  const cxAnual = anualDe(cxCash);
  const idx = [1, 2, 3, 4];
  const daA = idx.map(i => -SA.da[i]), ebit = idx.map((i, k) => ebitda[i] + daA[k]);
  let nolV = P.amortizarPerdidas ? Math.max(0, -SA.uai[0]) : -Infinity;
  const isrA = ebit.map(x => { if (nolV === -Infinity) return -Math.max(0, x) * P.isr; if (x <= 0) { nolV += -x; return 0; } const u = Math.min(nolV, x); nolV -= u; return -(x - u) * P.isr; });
  const nopat = ebit.map((x, k) => x + isrA[k]);
  // Capital de trabajo operativo: cartera + inventario − proveedores (por días), o % del aumento en ventas
  const W = V.wc;
  const compras = SA.costos.map((c, i) => c - SA.personal[i]);
  const a12 = (i: number) => (i === 0 ? 12 / 14 : 1); // 2026 abarca 14 meses (nov-25 a dic-26): se anualiza
  const cxc = SA.venta.map((v, i) => (W ? v * a12(i) * W.credito * W.dso / W.base : 0));
  const inv = compras.map((c, i) => (W ? c * a12(i) * W.dio / W.base : 0));
  const cxp = compras.map((c, i) => (W ? (c + SA.go[i] + SA.mkt[i]) * a12(i) * W.dpo / W.base : 0));
  const ctn = cxc.map((v, i) => v + inv[i] - cxp[i]);
  const capexA = idx.map(i => -cxAnual[i]);
  const ctA = idx.map(i => (W ? -(ctn[i] - ctn[i - 1]) : -(ventas[i] - ventas[i - 1]) * V.ct));
  const fcff = idx.map((_, k) => nopat[k] - daA[k] + capexA[k] + ctA[k]);
  const periodo = [0.5, 1.5, 2.5, 3.5];
  const deuda = M.credito.monto, caja = V.caja;
  // Valor terminal. Ajustado: flujo del año terminal normalizado — NOPAT − inversión en capital de trabajo a ritmo g
  // (g × capital de trabajo 2030) − CAPEX de reposición igual a la D&A — y descontado a mitad de año, igual que los flujos.
  const adj = !!V.tvAjustado;
  const ctnFin = W ? ctn[4] : ventas[4] * V.ct;
  const baseT = (g: number) => (adj ? nopat[3] - g * ctnFin : fcff[3]);
  const tExp = adj ? periodo[3] : periodo[3] + 0.5;
  const eqAt = (w: number, g: number) => {
    const pv = fcff.reduce((s, f, k) => s + f / Math.pow(1 + w, periodo[k]), 0);
    return pv + (baseT(g) * (1 + g) / (w - g)) / Math.pow(1 + w, tExp) - deuda + caja;
  };
  const fac = periodo.map(t => 1 / Math.pow(1 + wacc, t)), pv = fcff.map((f, k) => f * fac[k]);
  const fcffT = baseT(V.g) * (1 + V.g), tv = fcffT / (wacc - V.g), tvFactor = 1 / Math.pow(1 + wacc, tExp);
  const pvTv = tv * tvFactor, sumPv = sum(pv), ev = sumPv + pvTv, equity = ev - deuda + caja;
  const gCols = [-0.01, -0.005, 0, 0.005, 0.01].map(d => V.g + d);
  const wRows = [-0.02, -0.01, 0, 0.01, 0.02].map(d => wacc + d);
  const pRows = [-0.04, -0.02, 0, 0.02, 0.04].map(d => V.startup + d);
  return {
    ptu, fiscal: { saldo: perdidas, aplicada: perdidaUsada },
    capexPlan: { cash: cxCash, da: cxDa, inversionAnual: cxAnual, daAnual: anualDe(cxDa), equiposNuevos: [0, 1, 2, 3, 4].map(y => (y && M.capex?.equipos.porPersona ? Math.max(0, hcTot[y] - hcTot[y - 1]) : 0)) },
    gastos: { opex, opexTot, admin, adminTot, dirTot, hcTot, mkt, mktTot, admin27, admin27Tot, dir27Tot, mkt27, mkt27Tot },
    m1: S1, m2: S2, annual: SA, acum1, acum2, acumY, cred, clientsY2,
    scen: { vol, precio, factor, label },
    v: {
      rf, betaL, ke0, ke, kdAt, de, wacc, primaMkt, ventas, ebitda, daA, ebit, isrA, nopat, capexA, ctA, fcff, periodo, factor: fac, pv,
      wc: { cxc, inv, cxp, ctn },
      fcffT, tv, tvFactor, pvTv, sumPv, ev, deuda, caja, equity, pctTv: pvTv / ev, evVentas: ev / ventas[1], evEbitda: ev / ebitda[4], tvEbitda: tv / ebitda[4],
      cumple: equity >= V.meta,
      sensA: { rows: wRows, cols: gCols, m: wRows.map(w => gCols.map(g => eqAt(w, g))) },
      sensB: { rows: pRows, cols: gCols, m: pRows.map(p => gCols.map(g => eqAt(waccOf(ke0 + V.tamano + p), g))) },
    },
  };
}
