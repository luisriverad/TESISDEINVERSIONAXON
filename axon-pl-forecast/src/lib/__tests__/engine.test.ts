import { describe, it, expect } from 'vitest';
import { compute, type Model } from '../engine';
// Base congelada del Excel original (el modelo de la app puede evolucionar)
import data from './model.excel.json';
import exp from './expected.json';

// Valida el motor contra los valores calculados por el Excel original (AXON - PL Forecast - v1.xlsx)
const R = compute(data as unknown as Model);
const E = exp as any;
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);

const ROWS: Record<string, keyof typeof R.annual> = {
  55: 'dev', 57: 'mant', 63: 'venta', 65: 'ia', 67: 'repos', 69: 'host', 71: 'plat', 73: 'comis', 75: 'costos',
  77: 'ub', 79: 'go', 81: 'ga', 83: 'mkt', 87: 'otrosg', 91: 'gasto', 94: 'uo', 98: 'cif', 100: 'uai', 102: 'isr', 104: 'un',
};
const M2 = ['R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC'];
const ANN = ['Q', 'AD', 'AE', 'AF', 'AG'];

describe('P&L', () => {
  for (const [row, k] of Object.entries(ROWS)) {
    it(`fila ${row} (${k})`, () => {
      M2.forEach((c, i) => E.pl[row][c] != null && close(R.m2[k][i], E.pl[row][c]));
      ANN.forEach((c, i) => E.pl[row][c] != null && close(R.annual[k][i], E.pl[row][c]));
    });
  }
  it('resultado acumulado', () => {
    M2.forEach((c, i) => close(R.acum2[i], E.pl[106][c]));
    ['AE', 'AF', 'AG'].forEach((c, i) => close(R.acumY[i + 2], E.pl[106][c]));
  });
});

describe('Valuación', () => {
  it('WACC, EV y valor del capital', () => {
    close(R.v.wacc, E.val.C25); close(R.v.ev, E.val.C65); close(R.v.equity, E.val.C68);
  });
  it('sensibilidades', () => {
    E.val.sensA.forEach((r: number[], i: number) => r.forEach((x, j) => close(R.v.sensA.m[i][j], x)));
    E.val.sensB.forEach((r: number[], i: number) => r.forEach((x, j) => close(R.v.sensB.m[i][j], x)));
  });
});

describe('Gastos', () => {
  it('totales mensuales por año', () => {
    ['I', 'J', 'K', 'L', 'M'].forEach((c, i) => {
      close(R.gastos.opexTot[i], E.g[c + '15']); close(R.gastos.adminTot[i], E.g[c + '32']); close(R.gastos.mktTot[i], E.g[c + '45']);
    });
  });
});
