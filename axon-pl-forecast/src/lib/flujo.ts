// ===== Necesidad de capital: P&L (devengado) vs. flujo de efectivo =====
// Mes a mes, de nov-2025 a dic-2030, en tres vistas:
//   1) P&L: el resultado contable tal cual.
//   2) + Capital de trabajo: cobros con días de cartera (DSO) y pagos a terceros con días de proveedores (DPO).
//   3) + Ciclo comercial: los clientes NUEVOS cobran según los hitos del ciclo, contados desde la firma de contrato
//      (el mes en que la cartera los registra). Los clientes existentes no pasan por el ciclo.
import type { Model, Result, PLKey } from './engine';

export const MESES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const N_MESES = 62; // nov-2025 … dic-2030
const N_CARTERA = 26;      // meses con cartera cliente por cliente: nov-2025 … dic-2027
const N_Y1 = 14;
export const mesCorto = (t: number) => `${MESES3[(10 + t) % 12]}-${25 + Math.floor((10 + t) / 12)}`;
const DIAS_MES = 30.5;

export interface Hitos {
  diaFirma: number; diaPago1: number; diaFiniquito: number; total: number; mesMant: number;
  /** Meses desde la firma: primer pago, finiquito y primer mes de mantenimiento facturado */
  L1: number; L2: number; Lmant: number; Ldso: number; Ldpo: number;
  /** Patrón típico de la cartera para un cliente nuevo: mes del 2.º pago de desarrollo y del 1.er mantenimiento (desde su 1.er registro) */
  pDev2: number; pMant: number;
}
export interface ClienteFlujo {
  i: number; name: string; nuevo: boolean; auto: boolean;
  mesPL: number; mesCaja: number; dev: number; mant: number;
  finPL: number; finCaja: number; mantPL: number; mantCaja: number; // −1 si no aplica // dev y mant: total registrado en la cartera nov-25…dic-27
}
export interface Vista { entradas: number[]; salidas: number[]; neto: number[]; acum: number[]; necesidad: number; mesPico: number; mesRecupera: number }
export interface Flujo {
  h: Hitos; clientes: ClienteFlujo[];
  pl: Vista; plb: Vista; wc: Vista; ciclo: Vista;
  det: { ingresoPL: number[]; cobranza: number[]; egresoPL: number[]; pagos: number[]; cobroDev: number[]; cobroMant: number[]; nomina: number[]; terceros: number[]; comisiones: number[]; impuestosIntereses: number[]; capitalCredito: number[]; capex: number[] };
  operacionMensual: number; mesesOperacion: number; credito: number;
}

const zeros = () => Array(N_MESES).fill(0) as number[];
const shift = (s: number[], lag: number, share = 1) => { const o = zeros(); s.forEach((v, t) => { if (t + lag < N_MESES && t + lag >= 0) o[t + lag] += v * share; }); return o; };
const add = (...xs: number[][]) => xs[0].map((_, t) => xs.reduce((a, s) => a + s[t], 0));
const sub = (a: number[], b: number[]) => a.map((v, t) => v - b[t]);
const cobro = (s: number[], credito: number, Ldso: number) => add(shift(s, 0, 1 - credito), shift(s, Ldso, credito));
const median = (a: number[], d: number) => { if (!a.length) return d; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const firstIdx = (a: number[]) => a.findIndex(v => Math.abs(v) > 1.5);
/** Nunca se cobra antes de registrar: si el cobro acumulado rebasa lo devengado, el excedente pasa al mes siguiente */
function noAntesDe(cash: number[], dev: number[]) {
  const o = zeros(); let cc = 0, cd = 0, carry = 0;
  for (let t = 0; t < N_MESES; t++) { cd += dev[t]; const want = cash[t] + carry; const ok = Math.max(0, Math.min(want, cd - cc)); o[t] = ok; cc += ok; carry = want - ok; }
  return o;
}

/** Serie mensual del P&L: meses reales de 2025–2027 y años 2028–2030 repartidos en 12 meses iguales */
function serie(R: Result, k: PLKey): number[] {
  const out: number[] = [];
  for (let t = 0; t < N_MESES; t++) {
    if (t < N_Y1) out.push(R.m1[k][t] ?? 0);
    else if (t < N_CARTERA) out.push(R.m2[k][t - N_Y1] ?? 0);
    else out.push((R.annual[k][2 + Math.floor((t - N_CARTERA) / 12)] ?? 0) / 12);
  }
  return out;
}

function vista(entradas: number[], salidas: number[]): Vista {
  const neto = sub(entradas, salidas);
  const acum: number[] = []; neto.forEach((v, t) => acum.push((t ? acum[t - 1] : 0) + v));
  let mesPico = 0; acum.forEach((v, t) => { if (v < acum[mesPico]) mesPico = t; });
  const necesidad = Math.max(0, -acum[mesPico]);
  const mesRecupera = necesidad ? acum.findIndex((v, t) => t > mesPico && v >= 0) : -1;
  return { entradas, salidas, neto, acum, necesidad, mesPico, mesRecupera };
}

/** Un cliente es nuevo si no tiene ingresos en 2026 y sí en 2027 (se puede forzar con client.nuevo) */
export function clienteNuevoAuto(dev: number[], mant: number[]) {
  const y1 = dev.slice(0, N_Y1).some(v => v > 1.5) || mant.slice(0, N_Y1).some(v => v > 1.5); // ignora marcadores de $1
  const y2 = dev.slice(N_Y1, N_CARTERA).some(v => v > 1.5) || mant.slice(N_Y1, N_CARTERA).some(v => v > 1.5);
  return !y1 && y2;
}

/** Ciclo comercial efectivo: las etapas de PAGO duran los días de cartera (DSO) del capital de trabajo */
export function cicloConDso<T extends { etapa: string; dias: number }>(ciclo: T[], dso: number): T[] {
  return ciclo.map(e => (/^PAGO/i.test(e.etapa.trim()) ? { ...e, dias: Math.max(0, Math.round(dso)) } : e));
}

export function computeFlujo(M: Model, R: Result): Flujo {
  // ---------- Hitos del ciclo comercial, contados desde la firma ----------
  const et = cicloConDso(M.ciclo ?? [], M.val.wc?.dso ?? 30);
  const acc: number[] = []; et.reduce((s, e, i) => (acc[i] = s + e.dias), 0);
  const total = acc[acc.length - 1] ?? 0;
  const pagos = et.map((e, i) => (/^PAGO/i.test(e.etapa.trim()) ? i : -1)).filter(i => i >= 0);
  const diaPago1 = pagos.length ? acc[pagos[0]] : total;
  const diaFiniquito = pagos.length ? acc[pagos[pagos.length - 1]] : total;
  const iFirma = et.findIndex(e => /CIERRE|FIRMA/i.test(e.etapa));
  const diaFirma = iFirma >= 0 ? acc[iFirma] : 0;
  const W = M.val.wc ?? { dso: 30, credito: 1, dio: 0, dpo: 30, base: 360 };
  const mes = (d: number) => Math.max(0, Math.round(d / DIAS_MES));
  const mesMant = Math.floor(total / DIAS_MES) + 1;                    // mes del ciclo (desde el primer contacto) en que arranca el mantenimiento
  const L1 = mes(diaPago1 - diaFirma), L2 = mes(diaFiniquito - diaFirma);
  const Lmant = Math.max(L2 + 1, mesMant - mes(diaFirma));             // siempre después del finiquito
  const Ldso = mes(W.dso), Ldpo = mes(W.dpo), credito = W.credito;

  // Factor de la cartera existente después de dic-27 (igual que el motor anual): el contrato es anual, así que
  // la mensualidad es fija dentro de cada año; al renovar (cada enero desde 2028) se aplican churn e inflación
  const P = M.params;
  const churn = Math.min(0.99, Math.max(0, P.churn ?? 0));
  // Las mensualidades llevan churn e inflación (igual que el motor), pero no incrementos de precio
  const infP = P.aplicarInflacion === true ? P.inflacion : 0;
  const contFactor = (t: number) => { const y = 1 + Math.floor((t - N_CARTERA) / 12); return Math.pow(1 - churn, y) * Math.pow(1 + infP, y); };

  // ---------- Cartera cliente por cliente (nov-25 … dic-27), con el incremento de precios aplicado ----------
  const baseDev2 = Array(12).fill(0).map((_, k) => R.clientsY2.reduce((s, c) => s + c.dev[k], 0));
  const baseMant2 = Array(12).fill(0).map((_, k) => R.clientsY2.reduce((s, c) => s + c.mant[k], 0));
  const fDev = baseDev2.map((b, k) => (b ? R.m2.dev[k] / b : 1)), fMant = baseMant2.map((b, k) => (b ? R.m2.mant[k] / b : 1));
  const cart = M.clients.map((c, i) => {
    const dev = zeros(), mant = zeros();
    for (let t = 0; t < N_CARTERA; t++) {
      dev[t] = t < N_Y1 ? c.dev1[t] ?? 0 : R.clientsY2[i].dev[t - N_Y1] * fDev[t - N_Y1];
      mant[t] = t < N_Y1 ? c.mant1[t] ?? 0 : R.clientsY2[i].mant[t - N_Y1] * fMant[t - N_Y1];
    }
    // Después de dic-27 cada cliente sigue pagando su mantenimiento de dic-27; cada año, al renovar, con churn e inflación;
    // el resto del crecimiento son clientes nuevos
    for (let t = N_CARTERA; t < N_MESES; t++) mant[t] = mant[N_CARTERA - 1] * contFactor(t);
    const auto = clienteNuevoAuto(dev, mant);
    return { i, c, dev, mant, auto, nuevo: c.nuevo ?? auto };
  });

  // Patrón típico de un cliente nuevo en la cartera (para proyectar 2028–2030)
  const nuevos = cart.filter(x => x.nuevo);
  const pDev2 = median(nuevos.map(x => { const d = x.dev.map((v, t) => (v > 0.5 ? t : -1)).filter(t => t >= 0); return d.length > 1 ? d[1] - d[0] : 0; }), 1);
  const pMant = median(nuevos.map(x => { const s = firstIdx(add(x.dev, x.mant)), m = firstIdx(x.mant); return s >= 0 && m >= 0 ? m - s : 2; }), 2);

  // ---------- Cobranza ----------
  let cobDevW = zeros(), cobMantW = zeros();         // vista 2: todos con días de cartera
  let cobDevC = zeros(), cobMantC = zeros();         // vista 3: nuevos con ciclo comercial
  const devY1 = cart.reduce((s, x) => s + x.dev.slice(0, N_Y1).reduce((a, b) => a + b, 0), 0);
  const comY1 = R.m1.comis.reduce((a, b) => a + b, 0);
  const tasaDev = (t: number) => (t < N_Y1 ? (devY1 ? comY1 / devY1 : 0) : M.params.comision);
  const comCobro = { w: zeros(), c: zeros() };
  const clientes: ClienteFlujo[] = [];
  cart.forEach(x => {
    const totDev = x.dev.slice(0, N_CARTERA).reduce((a, b) => a + b, 0), totMant = x.mant.slice(0, N_CARTERA).reduce((a, b) => a + b, 0);
    if (Math.abs(totDev) + Math.abs(totMant) < 2) return; // filas vacías o marcadores de $1
    cobDevW = add(cobDevW, cobro(x.dev, credito, Ldso));
    cobMantW = add(cobMantW, cobro(x.mant, credito, Ldso));
    const comDev = x.dev.map((v, t) => v * tasaDev(t));
    comCobro.w = add(comCobro.w, cobro(comDev, credito, Ldso));
    const s = firstIdx(add(x.dev, x.mant));
    if (x.nuevo) {
      // Firma = primer mes en la cartera. Desarrollo: 50% al primer pago y 50% al finiquito. Mantenimiento: desde el cierre del ciclo.
      const d0 = zeros(); if (s + L1 < N_MESES) d0[s + L1] += totDev * 0.5; if (s + L2 < N_MESES) d0[s + L2] += totDev * 0.5;
      const d = noAntesDe(d0, x.dev);
      const m0 = firstIdx(x.mant);
      // Sin desarrollo (solo mantenimiento) no hay maquetas ni entrega: espera solo al primer pago
      const lag = m0 >= 0 ? Math.max(0, s + (totDev > 0.5 ? Lmant : Math.max(0, L1 - Ldso)) - m0) : 0;
      cobDevC = add(cobDevC, d);
      comCobro.c = add(comCobro.c, d.map(v => v * M.params.comision));
      cobMantC = add(cobMantC, cobro(shift(x.mant, lag), credito, Ldso));
      const devMeses = x.dev.map((v, t) => (v > 0.5 ? t : -1)).filter(t => t >= 0);
      clientes.push({ i: x.i, name: x.c.name, nuevo: true, auto: x.auto, mesPL: s, mesCaja: totDev > 0.5 ? s + L1 : m0 + lag + Ldso, dev: totDev, mant: totMant,
        finPL: devMeses.length > 1 ? devMeses[devMeses.length - 1] : -1, finCaja: totDev > 0.5 ? s + L2 : -1, mantPL: m0, mantCaja: m0 >= 0 ? m0 + lag + Ldso : -1 });
    } else {
      cobDevC = add(cobDevC, cobro(x.dev, credito, Ldso));
      comCobro.c = add(comCobro.c, cobro(comDev, credito, Ldso));
      cobMantC = add(cobMantC, cobro(x.mant, credito, Ldso));
      const devMeses = x.dev.map((v, t) => (v > 0.5 ? t : -1)).filter(t => t >= 0), m0 = firstIdx(x.mant);
      clientes.push({ i: x.i, name: x.c.name, nuevo: false, auto: x.auto, mesPL: s, mesCaja: s + Ldso, dev: totDev, mant: totMant,
        finPL: devMeses.length > 1 ? devMeses[devMeses.length - 1] : -1, finCaja: devMeses.length > 1 ? devMeses[devMeses.length - 1] + Ldso : -1, mantPL: m0, mantCaja: m0 >= 0 ? m0 + Ldso : -1 });
    }
  });

  // 2028–2030: el desarrollo son proyectos nuevos; el mantenimiento por encima de la base de dic-27 son clientes nuevos
  const devPL = serie(R, 'dev'), mantPL = serie(R, 'mant'), otros = serie(R, 'otros');
  const devAgg = devPL.map((v, t) => (t >= N_CARTERA ? v : 0));
  const mantCont = cart.reduce((s, x) => add(s, x.mant), zeros());
  const mantRes = mantPL.map((v, t) => (t >= N_CARTERA ? Math.max(0, v - mantCont[t]) : 0));
  // Si el P&L proyecta menos mantenimiento que la cartera continuada, la diferencia se descuenta de la cobranza existente
  const ajusteCont = mantPL.map((v, t) => (t >= N_CARTERA ? Math.min(0, v - mantCont[t]) : 0));
  cobMantW = add(cobMantW, cobro(ajusteCont, credito, Ldso));
  cobMantC = add(cobMantC, cobro(ajusteCont, credito, Ldso));
  cobDevW = add(cobDevW, cobro(devAgg, credito, Ldso));
  cobMantW = add(cobMantW, cobro(mantRes, credito, Ldso));
  const devAggC = add(shift(devAgg, L1, 0.5), shift(devAgg, Math.max(L1, L2 - pDev2), 0.5));
  cobDevC = add(cobDevC, devAggC);
  comCobro.w = add(comCobro.w, cobro(devAgg, credito, Ldso).map(v => v * M.params.comision));
  comCobro.c = add(comCobro.c, devAggC.map(v => v * M.params.comision));
  cobMantC = add(cobMantC, cobro(shift(mantRes, Math.max(0, Lmant - pMant)), credito, Ldso));

  // ---------- Egresos ----------
  const S = (k: PLKey) => serie(R, k);
  const comisPL = S('comis');
  // La PTU se devenga en el P&L pero se paga en mayo del año siguiente
  const ptuDev = zeros(), ptuPago = zeros();
  (R.ptu ?? []).forEach((v, y) => {
    if (!v || y === 0) return;
    for (let t = 0; t < N_MESES; t++) if ((y === 1 && t >= N_Y1 && t < N_CARTERA) || (y > 1 && t >= N_CARTERA + (y - 2) * 12 && t < N_CARTERA + (y - 1) * 12)) ptuDev[t] += v / 12;
    const mayo = N_CARTERA + (y - 1) * 12 + 4; if (mayo < N_MESES) ptuPago[mayo] += v;
  });
  const nomina = add(sub(add(S('personal'), S('ga')), ptuDev), ptuPago);
  const terceros = add(sub(sub(S('costos'), S('personal')), comisPL), S('go'), S('mkt'), S('otrosg'), S('capex'));
  const impInt = add(S('isr'), S('cif'));
  const venta = add(devPL, mantPL, otros);
  // La comisión se paga cuando el cliente paga el desarrollo
  // (tasa del mes en que se devenga: 2026 usa la tasa efectiva capturada, 2027+ la tasa de Supuestos)
  const comW = comCobro.w, comC = comCobro.c;

  // Crédito bancario: ya dispuesto (no entra dinero); con prórroga, el capital se paga cada mes desde ene-27
  const capCred = pagoCapitalCredito(R);
  // CAPEX: sale de caja en el mes de compra; la D&A es contable (no es salida de efectivo)
  const capex = R.capexPlan?.cash ?? zeros();
  const egresoPL = add(S('costos'), S('gasto'), S('da'), impInt);
  const pl = vista(venta, egresoPL);
  const plb = vista(venta, add(sub(egresoPL, S('da')), capCred, capex));
  const cobOtros = cobro(otros, credito, Ldso);
  const wc = vista(add(cobDevW, cobMantW, cobOtros), add(nomina, shift(terceros, Ldpo), comW, impInt, capCred, capex));
  const tercerosP = shift(terceros, Ldpo);
  const pagosC = add(nomina, tercerosP, comC, impInt);
  const cobranza = add(cobDevC, cobMantC, cobOtros);
  const ciclo = vista(cobranza, add(pagosC, capCred, capex));

  const operacionMensual = pagosC.slice(N_Y1, N_CARTERA).reduce((a, b) => a + b, 0) / 12;
  return {
    h: { diaFirma, diaPago1, diaFiniquito, total, mesMant, L1, L2, Lmant, Ldso, Ldpo, pDev2, pMant },
    clientes, pl, plb, wc, ciclo,
    det: { ingresoPL: venta, cobranza, egresoPL, pagos: pagosC, cobroDev: cobDevC, cobroMant: cobMantC, nomina, terceros: tercerosP, comisiones: comC, impuestosIntereses: impInt, capitalCredito: capCred, capex },
    operacionMensual, mesesOperacion: operacionMensual ? ciclo.necesidad / operacionMensual : 0,
    credito: M.credito.monto,
  };
}

// ===== Plan de disposiciones trimestrales del capital nuevo =====
export const REDONDEO = 50000; // las disposiciones se redondean hacia arriba a múltiplos de $50k
export const esInicioTrimestre = (t: number) => (10 + t) % 12 % 3 === 0;
export const trimestre = (t: number) => `T${Math.floor(((10 + t) % 12) / 3) + 1}-${25 + Math.floor((10 + t) / 12)}`;
/** Meses en que puede arrancar el plan (inicio de cada trimestre) */
export const INICIOS = Array.from({ length: N_MESES }, (_, t) => t).filter(esInicioTrimestre);

export interface Disposicion { t: number; trimestre: string; monto: number; acumulado: number; flujoOperativo: number; banco: number; cajaCierre: number; cajaMinima: number }
export interface Plan {
  inicio: number; primera: number; colchon: number; colchonMeses: number;
  cobertura: number;             // reserva adicional que entra con la primera disposición y se conserva en caja
  banco: number[];               // pago de capital del crédito (−), mes a mes
  caja: number[];                // caja mes a mes con el plan (desde el inicio)
  disp: Disposicion[];           // un renglón por periodo desde el inicio
  cortes: number[];              // meses en que inicia cada periodo trimestral (desde la primera disposición)
  total: number; n: number; mayor: number; ultima: string;
  deficitPrevio: number;         // caja consumida antes del inicio del plan (ya fondeada)
  puente: number;                // caja negativa máxima entre el inicio y la primera disposición (a cubrir con la primera)
}

/** Crédito bancario: ya dispuesto, NO entra dinero. Por la prórroga, el capital se paga cada mes a partir de ene-27 */
export function pagoCapitalCredito(R: Result): number[] {
  const b = zeros(); const t0 = N_Y1; // ene-27
  R.cred.rows.forEach((r, k) => { if (t0 + k < N_MESES) b[t0 + k] += r.capital; });
  return b;
}

export function planDisposiciones(F: Flujo, inicio = N_Y1, colchonMeses = 1, primera = inicio, cobertura = 0): Plan {
  // El flujo de caja real ya descuenta el pago de capital del crédito; no hay desembolso nuevo
  const banco = F.det.capitalCredito.map(v => -v);
  const neto = F.ciclo.neto;
  const colchon = colchonMeses * F.operacionMensual;
  primera = Math.max(inicio, Math.min(N_MESES - 1, primera));
  let acc0 = 0, min0 = 0; for (let t = 0; t < inicio; t++) { acc0 += neto[t]; min0 = Math.min(min0, acc0); }
  const deficitPrevio = Math.max(0, -min0); // punto más bajo de la caja antes de iniciar el plan
  const caja = zeros(); const disp: Disposicion[] = [];
  let c = 0, acumulado = 0, minPre = 0;
  // Entre el inicio del plan y la primera disposición la caja corre sin capital nuevo (se acumula el hueco)
  if (primera > inicio) {
    let op = 0, bq = 0, minCon = Infinity;
    for (let k = inicio; k < primera; k++) { c += neto[k]; caja[k] = c; minCon = Math.min(minCon, c); op += neto[k] - banco[k]; bq += banco[k]; }
    minPre = minCon;
    disp.push({ t: inicio, trimestre: `${mesCorto(inicio)} a ${mesCorto(primera - 1)}`, monto: 0, acumulado: 0, flujoOperativo: op, banco: bq, cajaCierre: c, cajaMinima: minCon });
  }
  // Desde la primera disposición: una cada 3 meses, lo justo para que ningún mes del periodo quede por debajo del colchón
  const cortes: number[] = [];
  for (let t = primera; t < N_MESES; t += 3) {
    cortes.push(t);
    const fin = Math.min(N_MESES, t + 3);
    let x = c, minSin = Infinity; for (let k = t; k < fin; k++) { x += neto[k]; minSin = Math.min(minSin, x); }
    // La cobertura se suma una sola vez (primera disposición) y se mantiene como reserva: no reduce las siguientes
    const falta = Math.max(0, colchon + cobertura - minSin);
    const monto = falta > 0.5 ? Math.ceil(falta / REDONDEO) * REDONDEO : 0;
    acumulado += monto; c += monto;
    let minCon = Infinity, op = 0, bq = 0;
    for (let k = t; k < fin; k++) { c += neto[k]; caja[k] = c; minCon = Math.min(minCon, c); op += neto[k] - banco[k]; bq += banco[k]; }
    disp.push({ t, trimestre: trimestre(t), monto, acumulado, flujoOperativo: op, banco: bq, cajaCierre: c, cajaMinima: minCon });
  }
  const con = disp.filter(d => d.monto > 0.5);
  return { inicio, primera, colchon, colchonMeses, cobertura, banco, caja, disp, cortes, total: acumulado, n: con.length, mayor: Math.max(0, ...con.map(d => d.monto)), ultima: con.length ? con[con.length - 1].trimestre : '—', deficitPrevio, puente: Math.max(0, -minPre) };
}
