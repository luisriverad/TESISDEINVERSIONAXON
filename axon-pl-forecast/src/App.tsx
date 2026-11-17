import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { compute, fijarMant, type Model, type Result, type MCell, type GCell, type Series, type PLKey } from './lib/engine';
import DATA from './data/model.json';
import LOGO from './assets/axon-logo.png';
import MARK from './assets/axon-mark.png';
import AMERICAS from './data/americas.json';
import { computeFlujo, cicloConDso, planDisposiciones, mesCorto, REDONDEO, N_MESES, type Flujo, type Vista, type Plan } from './lib/flujo';
import { geoArea, geoAzimuthalEqualArea, geoPath } from 'd3-geo';

// ===================== Marca AXON =====================
const C = {
  bg: '#F4F3EE', surface: '#FFFFFF', ink: '#101113', ink2: '#3A3D42', muted: '#6B6E76', faint: '#9A9DA4',
  line: '#E4E2DA', line2: '#EEEDE7', yellow: '#F8C908', yellowSoft: '#FEF6D2', yellowLine: '#EBD27A',
  tint: '#FCFBF7', tint2: '#F8F7F2', gold: '#C99700', graphite: '#3A3D42', neg: '#B42318', pos: '#1E7A46', posSoft: '#E6F2EA', negSoft: '#FBEAE8',
};
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
const STORE = 'axon-pl-forecast-v1';
const DEFAULT: Model = DATA as unknown as Model;
// Huella de los datos de inicio publicados (model.json). Si cambian (nuevo deploy), lo guardado en el navegador
// con la versión anterior se descarta para que todos vean las cifras publicadas.
const BASE = (() => { const t = JSON.stringify(DATA); let h = 5381; for (let i = 0; i < t.length; i++) h = (h * 33 + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); })();
const STORE_BASE = STORE + ':base';
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// ===================== Formatos =====================
const nf0 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
const nf4 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 4 });
const money = (v: number) => (Math.abs(v) < 0.5 ? '—' : v < 0 ? `(${nf0.format(-v)})` : nf0.format(v));
const short = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}K`;
  return `${s}$${Math.round(a)}`;
};
const sum5 = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pct = (v: number, d = 1) => (isFinite(v) ? `${(v * 100).toFixed(d)}%` : '—');
const ratio = (a: number, b: number) => (b === 0 ? NaN : a / b);
// Flujos anuales al cierre de cada año (t = 1..n)
const npv = (r: number, f: number[]) => f.reduce((s, x, i) => s + x / Math.pow(1 + r, i + 1), 0);
const irr = (f: number[]) => {
  let lo = -0.99, hi = 10;
  if (npv(lo, f) * npv(hi, f) > 0) return NaN;
  for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (npv(lo, f) * npv(m, f) <= 0) hi = m; else lo = m; }
  return (lo + hi) / 2;
};
// Años hasta que el acumulado cruza a positivo (interpolación lineal dentro del año)
const payback = (acum: number[]) => {
  const i = acum.findIndex(v => v >= 0);
  if (i < 0) return NaN;
  if (i === 0) return 1;
  return i + -acum[i - 1] / (acum[i] - acum[i - 1]);
};

// ===================== Primitivos UI =====================
function NumInput({ value, onChange, kind = 'money', width = 96, step, quiet, small }: { value: number; onChange: (v: number) => void; kind?: 'money' | 'pct' | 'num'; width?: number; step?: number; quiet?: boolean; small?: boolean }) {
  const [focus, setFocus] = useState(false);
  const [txt, setTxt] = useState('');
  const shown = kind === 'pct' ? +(value * 100).toFixed(4) : value;
  const q = !!quiet && value === 0 && !focus;
  const disp = q ? '—' : kind === 'pct' ? `${(value * 100).toFixed(2).replace(/\.?0+$/, '')}%` : kind === 'num' ? nf4.format(value) : value === 0 ? '0' : nf0.format(value);
  return (
    <input
      value={focus ? txt : disp}
      onFocus={e => { setFocus(true); setTxt(String(shown)); setTimeout(() => e.target.select(), 0); }}
      onBlur={() => {
        setFocus(false);
        const n = parseFloat(txt.replace(/[,$%\s]/g, ''));
        if (isFinite(n)) onChange(kind === 'pct' ? n / 100 : n);
      }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTxt(String(shown)); (e.target as HTMLInputElement).blur(); } }}
      onChange={e => setTxt(e.target.value)}
      inputMode="decimal"
      step={step}
      aria-label="Supuesto editable"
      onClick={e => e.stopPropagation()}
      style={{ width, textAlign: 'right', font: `400 ${small ? 11 : 13}px ${FONT}`, fontVariantNumeric: 'tabular-nums', color: q ? C.faint : C.ink, background: q ? 'transparent' : C.yellowSoft, border: `1px solid ${q ? C.line2 : C.yellowLine}`, borderRadius: small ? 5 : 6, padding: small ? '1px 5px' : '4px 7px', outline: 'none' }}
    />
  );
}

function Card({ title, sub, right, children, pad = true, eyebrow }: { title?: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; pad?: boolean; eyebrow?: string }) {
  const mt = title?.match(/^(\d+) · (.+)$/);
  const eb = eyebrow, tt = mt ? mt[2] : title;
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 0, overflow: 'hidden' }}>
      {title && (
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, padding: '22px 24px 14px', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            {eb && <div style={{ font: `650 10px ${FONT}`, color: C.gold, textTransform: 'uppercase', letterSpacing: '.16em', marginBottom: 8 }}>{eb}</div>}
            <h3 style={{ margin: 0, font: `250 20px/1.2 ${FONT}`, color: C.ink, letterSpacing: '-0.02em' }}>{tt}</h3>
            {sub && <p style={{ margin: '5px 0 0', font: `300 12px/1.45 ${FONT}`, color: C.faint, maxWidth: 760 }}>{sub}</p>}
          </div>
          {right}
        </header>
      )}
      <div style={{ padding: pad ? (title ? '4px 24px 22px' : '22px 24px') : title ? '4px 0 0' : 0 }}>{children}</div>
    </section>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, warm }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; warm?: boolean }) {
  return (
    <div role="tablist" style={{ display: 'inline-flex', background: warm ? C.yellowSoft : C.line2, borderRadius: 99, padding: 3, gap: 2 }}>
      {options.map(o => (
        <button key={String(o.v)} role="tab" aria-selected={o.v === value} onClick={() => onChange(o.v)}
          style={{ border: 0, cursor: 'pointer', padding: '6px 14px', borderRadius: 99, font: `${o.v === value ? 600 : 300} 12.5px ${FONT}`, background: o.v === value ? C.surface : 'transparent', color: o.v === value ? C.ink : warm ? '#8A6A00' : C.muted, boxShadow: o.v === value ? '0 1px 2px rgba(16,17,19,.12)' : 'none' }}>
          {o.l}
        </button>
      ))}
    </div>
  );
}


const th: React.CSSProperties = { font: `600 10px ${FONT}`, color: C.ink, textTransform: 'uppercase', letterSpacing: '.14em', padding: '14px 12px 12px', textAlign: 'right', whiteSpace: 'nowrap', background: C.surface, borderBottom: `1px solid ${C.ink}`, position: 'sticky', top: 0 };
const tdBase: React.CSSProperties = { font: `300 13px ${FONT}`, color: C.ink2, padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${C.line2}` };
const thFine: React.CSSProperties = { font: `600 10px ${FONT}`, color: C.ink, textTransform: 'uppercase', letterSpacing: '.14em', padding: '14px 12px 12px', textAlign: 'right', whiteSpace: 'nowrap', background: C.surface, borderBottom: `1px solid ${C.ink}`, position: 'sticky', top: 0 };
const tdFine: React.CSSProperties = { font: `300 13px ${FONT}`, color: C.ink2, padding: '11px 12px 4px', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const tdC: React.CSSProperties = { ...tdBase, fontSize: 12, padding: '7px 10px' };
const thC: React.CSSProperties = { ...th, padding: '10px 10px 9px' };
// Ancho de un campo de nombre para que quepa el texto más largo de la tabla
const nameW = (names: string[], min = 16) => `calc(${Math.max(min, ...names.map(n => n.length)) * 1.12}ch + 22px)`;
const isPctRow = (r: { t?: string }) => r.t === 'pct' || r.t === 'growth';
const stickyL: React.CSSProperties = { position: 'sticky', left: 0, background: C.surface, textAlign: 'left', zIndex: 1 };

// Contenedor con scroll horizontal: flechas y degradado cuando hay más columnas
function ScrollX({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  const upd = () => { const el = ref.current; if (!el) return; setEdge({ l: el.scrollLeft > 2, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 }); };
  useEffect(() => {
    upd(); const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(upd); ro.observe(el); if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  const go = (d: number) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.6, behavior: 'smooth' });
  const arrowBtn = (side: 'l' | 'r') => (
    <button onClick={() => go(side === 'l' ? -1 : 1)} disabled={side === 'l' ? !edge.l : !edge.r} aria-label={side === 'l' ? 'Ver columnas anteriores' : 'Ver más columnas'}
      style={{ width: 26, height: 26, borderRadius: 99, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0, opacity: (side === 'l' ? edge.l : edge.r) ? 1 : 0.3 }}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d={side === 'l' ? 'M7.5 2.5 4 6l3.5 3.5' : 'M4.5 2.5 8 6 4.5 9.5'} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
  return (
    <div>
      {(edge.l || edge.r) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, padding: '0 20px 8px', font: `300 11px ${FONT}`, color: C.faint }}>
          <span style={{ marginRight: 4 }}>Desliza para ver más columnas</span>
          {arrowBtn('l')}{arrowBtn('r')}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <div ref={ref} onScroll={upd} style={{ overflowX: 'auto' }}>{children}</div>
        {edge.r && <div aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 56, pointerEvents: 'none', zIndex: 3, background: `linear-gradient(to left, ${C.surface}, rgba(255,255,255,0))` }} />}
      </div>
    </div>
  );
}

function Num({ v, bold, pctv }: { v: number; bold?: boolean; pctv?: boolean }) {
  const neg = v < -0.5;
  return <span style={{ color: neg ? C.neg : undefined, fontWeight: bold ? 650 : undefined }}>{pctv ? pct(v) : money(v)}</span>;
}

// ===================== Gráficas (SVG) =====================
type Tip = { x: number; y: number; lines: string[] } | null;
function TipBox({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null); const [left, setLeft] = useState<number | null>(null);
  // Mantiene el tooltip dentro del contenedor (no se corta en los extremos)
  useLayoutEffect(() => {
    const el = ref.current; if (!el || !tip) return;
    const cw = (el.parentElement as HTMLElement).clientWidth, tw = el.offsetWidth, pad = 4;
    setLeft(Math.max(pad, Math.min(tip.x - tw / 2, cw - tw - pad)));
  }, [tip?.x, tip?.lines.join('|')]);
  if (!tip) return null;
  return (
    <div ref={ref} style={{ position: 'absolute', left: left ?? tip.x, top: tip.y, transform: 'translateY(-100%)', visibility: left == null ? 'hidden' : 'visible', pointerEvents: 'none', background: C.ink, color: '#fff', borderRadius: 8, padding: '7px 10px', font: `500 12px ${FONT}`, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.18)', zIndex: 5 }}>
      {tip.lines.map((l, i) => <div key={i} style={{ fontWeight: i === 0 ? 650 : 450, opacity: i === 0 ? 1 : 0.9 }}>{l}</div>)}
    </div>
  );
}
function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null); const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(e => setW(Math.max(280, e[0].contentRect.width)));
    ro.observe(ref.current); return () => ro.disconnect();
  }, []);
  return [ref, w];
}
function niceTicks(min: number, max: number, n = 5) {
  const span = max - min || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => span / s <= n) || mag * 10;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(6));
  return out;
}
function Legend({ items, fine = true }: { items: { c: string; l: string; dash?: boolean }[]; fine?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: fine ? 20 : 16, flexWrap: 'wrap', marginBottom: fine ? 4 : 8 }}>
      {items.map(i => (
        <span key={i.l} style={{ display: 'inline-flex', alignItems: 'center', gap: fine ? 8 : 6, font: `${fine ? 300 : 500} ${fine ? 11.5 : 12}px ${FONT}`, color: fine ? C.muted : C.ink2, letterSpacing: fine ? '.01em' : undefined }}>
          <span style={{ width: fine ? (i.dash ? 14 : 8) : 12, height: i.dash ? 0 : fine ? 8 : 10, borderRadius: fine ? 99 : 3, background: i.dash ? 'none' : i.c, borderTop: i.dash ? `${fine ? 1.5 : 2}px dashed ${i.c}` : 'none' }} />{i.l}
        </span>
      ))}
    </div>
  );
}

type BarSeries = { name: string; color: string; values: number[]; fmt?: (v: number, i: number) => string };
function BarChart({ labels, series, height = 260, showLabels, fine = true }: { labels: string[]; series: BarSeries[]; height?: number; showLabels?: boolean; fine?: boolean }) {
  const [ref, w] = useWidth(); const [tip, setTip] = useState<Tip>(null); const [hi, setHi] = useState<number | null>(null);
  const m = { l: 52, r: 8, t: showLabels ? 26 : 16, b: 30 }, iw = w - m.l - m.r, ih = height - m.t - m.b;
  const fmtOf = (s: BarSeries, i: number) => (s.fmt ? s.fmt(s.values[i], i) : short(s.values[i]));
  const all = series.flatMap(s => s.values), mn = Math.min(0, ...all), mx = Math.max(0, ...all), span = mx - mn || 1;
  // Dominio ajustado a los datos (con aire para las etiquetas) en vez de redondear al siguiente tick
  const y0 = showLabels ? (mn < 0 ? mn - span * 0.09 : 0) : niceTicks(mn, mx)[0];
  const y1 = showLabels ? mx + span * 0.02 : niceTicks(mn, mx).slice(-1)[0];
  const ticks = niceTicks(y0, y1, 4).filter(t => t >= y0 - 1e-6 && t <= y1 + 1e-6);
  const Y = (v: number) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const gap = fine ? 14 : 6, band = iw / labels.length, bw = Math.min(fine ? 22 : 30, (band * (fine ? 0.5 : 0.62) - gap * (series.length - 1)) / series.length), gw = bw * series.length + gap * (series.length - 1);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={w} height={height} role="img" aria-label={series.map(s => s.name).join(' y ')}>
        {ticks.map(t => (
          <g key={t}>
            {t !== 0 && <line x1={m.l} x2={w - m.r} y1={Y(t)} y2={Y(t)} stroke={C.line2} strokeDasharray="2 4" />}
            <text x={m.l - 10} y={Y(t) + 3.5} textAnchor="end" style={{ font: `${fine ? 300 : 450} 10.5px ${FONT}`, fill: C.faint, fontVariantNumeric: 'tabular-nums' }}>{short(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => {
          const gx = m.l + band * i + (band - gw) / 2, dim = hi != null && hi !== i;
          return (
            <g key={l} style={{ opacity: dim ? 0.35 : 1, transition: 'opacity .15s' }}
              onMouseLeave={() => { setTip(null); setHi(null); }}
              onMouseMove={() => { setHi(i); setTip({ x: m.l + band * i + band / 2, y: m.t - 6, lines: [l, ...series.map(s => `${s.name}: ${short(s.values[i])}${s.fmt ? ` · ${fmtOf(s, i)}` : ''}`)] }); }}>
              <rect x={m.l + band * i} y={0} width={band} height={height} fill="transparent" />
              {series.map((s, k) => {
                const v = s.values[i], top = Y(Math.max(v, 0)), bot = Y(Math.min(v, 0)), h = Math.max(1.5, bot - top), x = gx + k * (bw + gap), r = Math.min(fine ? 2 : 3, bw / 2, h / 2);
                const d = v >= 0
                  ? `M${x},${bot} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${bot} Z`
                  : `M${x},${top} V${bot - r} Q${x},${bot} ${x + r},${bot} H${x + bw - r} Q${x + bw},${bot} ${x + bw},${bot - r} V${top} Z`;
                const lc = v < 0 ? C.neg : k === 0 ? C.ink : '#8A6A00';
                return (
                  <g key={s.name}>
                    <path d={d} fill={s.color} />
                    {showLabels && <text x={x + bw / 2} y={v >= 0 ? top - 7 : bot + 14} textAnchor="middle" style={{ font: `${fine ? (k === 0 ? 600 : 300) : k === 0 ? 600 : 500} ${fine ? 11 : 10.5}px ${FONT}`, fill: lc, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>{fmtOf(s, i)}</text>}
                  </g>
                );
              })}
              <text x={m.l + band * i + band / 2} y={height - 9} textAnchor="middle" style={{ font: `${fine ? (hi === i ? 600 : 300) : 500} 11px ${FONT}`, fill: hi === i ? C.ink : C.muted, letterSpacing: fine ? '.08em' : '.02em' }}>{l}</text>
            </g>
          );
        })}
        <line x1={m.l} x2={w - m.r} y1={Y(0)} y2={Y(0)} stroke={C.faint} strokeWidth={1} />
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

function LineChart({ points, height = 260, refLine, color = C.ink, fine = true }: { points: { x: number; y: number; label: string; dashed?: boolean }[]; height?: number; refLine?: number; color?: string; fine?: boolean }) {
  const [ref, w] = useWidth(); const [hi, setHi] = useState<number | null>(null);
  const m = { l: 60, r: 28, t: fine ? 28 : 16, b: 28 }, iw = w - m.l - m.r, ih = height - m.t - m.b;
  const ys = points.map(p => p.y), ticks = niceTicks(Math.min(0, ...ys), Math.max(0, ...ys));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1], x0 = points[0].x, x1 = points[points.length - 1].x;
  const X = (x: number) => m.l + ((x - x0) / (x1 - x0 || 1)) * iw, Y = (v: number) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const solid = points.filter(p => !p.dashed), dashIdx = points.findIndex(p => p.dashed);
  const dashed = dashIdx > 0 ? points.slice(dashIdx - 1) : [];
  const path = (ps: typeof points) => ps.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)},${Y(p.y)}`).join(' ');
  const onMove = (e: React.MouseEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect(), mx = e.clientX - r.left;
    let best = 0; points.forEach((p, i) => { if (Math.abs(X(p.x) - mx) < Math.abs(X(points[best].x) - mx)) best = i; }); setHi(best);
  };
  const p = hi != null ? points[hi] : null;
  // Etiquetas de datos (modo fino): punto más bajo, último mes real y cierres anuales
  const minI = ys.indexOf(Math.min(...ys)), lastM = dashIdx > 0 ? dashIdx - 1 : points.length - 1;
  const tagIdx = fine ? points.map((_, i) => i).filter(i => i === minI || i === lastM || points[i].dashed) : [];
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHi(null)} role="img" aria-label="Resultado acumulado">
        {ticks.map(t => (
          <g key={t}><line x1={m.l} x2={w - m.r} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? (fine ? C.line : C.faint) : C.line2} strokeDasharray={fine && t !== 0 ? '2 4' : undefined} />
            <text x={m.l - 10} y={Y(t) + 3.5} textAnchor="end" style={{ font: `${fine ? 300 : 450} ${fine ? 10.5 : 11}px ${FONT}`, fill: fine ? C.faint : C.muted, fontVariantNumeric: 'tabular-nums' }}>{short(t)}</text></g>
        ))}
        {fine && (
          <>
            <defs><linearGradient id="lcFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.yellow} stopOpacity={0.18} /><stop offset="1" stopColor={C.yellow} stopOpacity={0} /></linearGradient></defs>
            <path d={`${path(points)} L${X(x1)},${Y(0)} L${X(x0)},${Y(0)} Z`} fill="url(#lcFade)" />
          </>
        )}
        {refLine != null && <line x1={m.l} x2={w - m.r} y1={Y(refLine)} y2={Y(refLine)} stroke={fine ? C.yellowLine : C.gold} strokeDasharray="4 4" />}
        <path d={path(solid)} fill="none" stroke={color} strokeWidth={fine ? 1.25 : 2} strokeLinejoin="round" />
        {dashed.length > 0 && <path d={path(dashed)} fill="none" stroke={color} strokeWidth={fine ? 1.25 : 2} strokeDasharray={fine ? '3 4' : '5 4'} />}
        {dashed.slice(1).map(q => <circle key={q.x} cx={X(q.x)} cy={Y(q.y)} r={fine ? 3 : 4} fill={C.surface} stroke={color} strokeWidth={fine ? 1.25 : 2} />)}
        {tagIdx.map(i => {
          const q = points[i], neg = q.y < 0, last = i === points.length - 1, low = i === minI;
          // Negativos: la etiqueta va arriba de la línea de $0 con una guía fina al punto
          const cx = X(q.x), cy = Y(q.y), ty = neg ? Y(0) - 9 : cy - 9;
          return (
            <g key={'t' + i} style={{ opacity: hi != null && hi !== i ? 0.35 : 1, transition: 'opacity .15s' }}>
              {neg && <line x1={cx} x2={cx} y1={cy - 4} y2={Y(0) - 4} stroke={C.neg} strokeOpacity={0.45} strokeWidth={0.75} strokeDasharray="1.5 2" />}
              {!q.dashed && <circle cx={cx} cy={cy} r={2.25} fill={neg ? C.neg : color} />}
              <text x={last ? cx + 4 : cx} y={ty} textAnchor={last ? 'end' : 'middle'}
                style={{ font: `${q.dashed || low ? 600 : 400} 10.5px ${FONT}`, fill: neg ? C.neg : C.ink, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em', paintOrder: 'stroke', stroke: C.surface, strokeWidth: 3, strokeLinejoin: 'round' }}>{low && <tspan style={{ fontWeight: 300, fill: C.faint }}>Mín. </tspan>}{short(q.y)}</text>
            </g>
          );
        })}
        {points.filter((q, i) => i % 6 === 0 || q.dashed).map(q => (
          <text key={'l' + q.x} x={X(q.x)} y={height - 8} textAnchor="middle" style={{ font: `${fine ? 300 : 450} ${fine ? 10.5 : 11}px ${FONT}`, fill: fine ? C.faint : C.muted, letterSpacing: fine ? '.06em' : undefined }}>{q.label}</text>
        ))}
        {p && <g><line x1={X(p.x)} x2={X(p.x)} y1={m.t} y2={m.t + ih} stroke={fine ? C.line : C.faint} /><circle cx={X(p.x)} cy={Y(p.y)} r={fine ? 4 : 5} fill={C.yellow} stroke={C.ink} strokeWidth={fine ? 1 : 1.5} /></g>}
      </svg>
      {p && <TipBox tip={{ x: X(p.x), y: Y(p.y) - 10, lines: [p.label, short(p.y)] }} />}
    </div>
  );
}

// ===================== Módulo: Resumen =====================
const YEARS = ['Año 1 · 2026', 'Año 2 · 2027', 'Año 3 · 2028', 'Año 4 · 2029', 'Año 5 · 2030'];
const YEARS_S = ['2026', '2027', '2028', '2029', '2030'];

function Resumen({ R, M }: { R: Result; M: Model }) {
  const A = R.annual;
  // Clientes que se habrían mantenido sin churn, menos los activos: pérdida acumulada por churn
  const sinChurn = useMemo(() => ((M.params.churn ?? 0) > 0 ? compute({ ...M, params: { ...M.params, churn: 0 } }).annual.empresas : A.empresas), [M, A]);
  const perdidos = sinChurn.map((v, i) => v - A.empresas[i]);
  const minAcum = Math.min(...R.acum1, ...R.acum2, ...R.acumY);
  const months = [...M.months1.map(m => (/\d/.test(m) ? m : `${m} 26`)), ...M.months2.map(m => `${m} 27`)];
  const series = [...R.acum1, ...R.acum2];
  const be = series.findIndex(v => v >= 0);
  const beYear = R.acumY.findIndex(v => v >= 0);
  const beLabel = be >= 0 ? months[be] : beYear >= 0 ? `Año ${beYear + 1} (${YEARS_S[beYear]})` : 'Fuera del horizonte';
  const ventasTot = A.venta.reduce((s, x) => s + x, 0);
  const cagr15 = Math.pow(A.venta[4] / A.venta[0], 1 / 4) - 1;
  const tir = irr(A.un), vpn = npv(R.v.wacc, A.un), pb = payback(R.acumY);
  const pts: { x: number; y: number; label: string; dashed?: boolean }[] = series.map((y, i) => ({ x: i, y, label: months[i] }));
  [2, 3, 4].forEach((y, k) => pts.push({ x: 25 + 12 * (k + 1), y: R.acumY[y], label: `DIC ${YEARS_S[y].slice(2)}`, dashed: true }));
  const kpis = resumenKpis(M, R);
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <FineKpis items={kpis} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
        <Card eyebrow="Crecimiento" title="Ventas y utilidad neta por año">
          <Legend fine items={[{ c: C.graphite, l: 'Ventas totales' }, { c: C.gold, l: 'Utilidad neta (% de ventas)' }]} />
          <BarChart fine labels={YEARS_S} showLabels series={[{ name: 'Ventas', color: C.graphite, values: A.venta }, { name: 'Utilidad neta', color: C.gold, values: A.un, fmt: (v, i) => pct(ratio(v, A.venta[i])) }]} />
        </Card>
        <Card eyebrow="Liquidez" title="Resultado acumulado" sub="Curva J · mensual nov-25 a dic-27, cierres anuales 2028–2030">
          <Legend fine items={[{ c: C.ink, l: 'Resultado acumulado' }, { c: C.ink, l: 'Cierre anual', dash: true }]} />
          <LineChart fine points={pts} refLine={0} />
        </Card>
      </div>
      <Card eyebrow="Estado de resultados" title="Estado de resultados resumido" sub={M.params.aplicarInflacion ? 'MXN nominales' : 'MXN sin inflación'} pad={false}>
        <PLTable fine cols={YEARS} data={A} acum={R.acumY} rows={(M.params.churn ?? 0) > 0 ? SUMMARY_ROWS.flatMap(r => r.k === 'empresas' ? [r, { l: 'Clientes perdidos por churn (acumulado)', vals: perdidos }] : [r]) : SUMMARY_ROWS} />
      </Card>
    </div>
  );
}

// ---------- Piezas de diseño fino (Resumen) ----------
type FineKpiDef = { label: string; sub?: string; value: string; unit?: string; note?: string; tone?: 'pos' | 'neg'; hl?: string };
function FineKpis({ items }: { items: FineKpiDef[] }) {
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', overflow: 'hidden' }}>
      {items.map((k, i) => (
        <div key={k.label} style={{ padding: '22px 22px 20px', borderLeft: i ? `1px solid ${C.line2}` : 'none', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 132, background: k.hl ? C.ink : undefined }}>
          {k.hl && <span style={{ alignSelf: 'flex-start', font: `700 9.5px ${FONT}`, letterSpacing: '.16em', textTransform: 'uppercase', color: C.ink, background: C.yellow, padding: '4px 8px' }}>{k.hl}</span>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minHeight: 28 }}>
            <span style={{ font: `650 10px ${FONT}`, color: k.hl ? '#fff' : C.ink, textTransform: 'uppercase', letterSpacing: '.16em' }}>{k.label}</span>
            {k.sub && <span style={{ font: `300 10px ${FONT}`, color: k.hl ? 'rgba(255,255,255,.55)' : C.faint, textTransform: 'uppercase', letterSpacing: '.12em' }}>{k.sub}</span>}
          </div>
          <div style={{ font: `${k.hl ? 600 : 200} 36px/1 ${FONT}`, color: k.hl ? C.yellow : C.ink, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {k.value}{k.unit && <span style={{ font: `300 14px ${FONT}`, color: C.muted, letterSpacing: 0, marginLeft: 6 }}>{k.unit}</span>}
          </div>
          {k.note && (
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'flex-start', gap: 7, font: `300 11.5px/1.4 ${FONT}`, color: k.hl ? 'rgba(255,255,255,.75)' : C.muted }}>
              <span style={{ width: 5, height: 5, borderRadius: 99, marginTop: 5, flex: 'none', background: k.tone === 'pos' ? C.pos : k.tone === 'neg' ? C.neg : C.yellow }} />
              <span>{k.note}</span>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

// ===================== Módulo: P&L =====================
type RowDef = { k?: PLKey; l: string; t?: 'total' | 'pct' | 'sec' | 'acum' | 'growth'; num?: PLKey; den?: PLKey; vals?: number[] };
const PL_ROWS: RowDef[] = [
  { l: 'Ingresos', t: 'sec' },
  { k: 'dev', l: 'Desarrollo inicial' }, { k: 'mant', l: 'Mantenimiento mensual' }, { k: 'otros', l: 'Otros ingresos' },
  { k: 'venta', l: 'Total venta', t: 'total' },
  { l: 'Costos directos', t: 'sec' },
  { k: 'ia', l: 'Consumo IA' }, { k: 'repos', l: 'Repositorios' }, { k: 'host', l: 'Hostings' }, { k: 'plat', l: 'Plataformas (TC)' }, { k: 'comis', l: 'Comisiones' }, { k: 'personal', l: 'Personal directo' },
  { k: 'costos', l: 'Total costos', t: 'total' },
  { k: 'ub', l: 'Utilidad bruta', t: 'total' }, { l: 'Margen bruto', t: 'pct', num: 'ub', den: 'venta' },
  { l: 'Gastos', t: 'sec' },
  { k: 'go', l: 'Gasto operativo' }, { k: 'ga', l: 'Gasto administrativo' }, { k: 'mkt', l: 'Gasto de marketing y ventas' }, { k: 'capex', l: 'Gasto inicial no capitalizable (2026)' }, { k: 'otrosg', l: 'Otros gastos' },
  { k: 'gasto', l: 'Total gasto', t: 'total' }, { l: '% gasto / venta', t: 'pct', num: 'gasto', den: 'venta' },
  { k: 'ebitda', l: 'EBITDA', t: 'total' }, { l: 'Margen EBITDA', t: 'pct', num: 'ebitda', den: 'venta' },
  { k: 'da', l: 'D&A (depreciación y amortización)' },
  { k: 'uo', l: 'Utilidad de operación (EBIT)', t: 'total' }, { l: 'Margen de operación', t: 'pct', num: 'uo', den: 'venta' },
  { k: 'cif', l: 'CIF (intereses)' }, { k: 'uai', l: 'Utilidad antes de impuestos', t: 'total' }, { k: 'isr', l: 'Impuestos (ISR)' },
  { k: 'un', l: 'Utilidad neta', t: 'total' }, { l: 'Margen neto', t: 'pct', num: 'un', den: 'venta' },
  { l: 'Resultado acumulado', t: 'acum' },
];
const SUMMARY_ROWS: RowDef[] = [
  { k: 'venta', l: 'Total venta', t: 'total' }, { k: 'venta', l: 'Crecimiento de ventas', t: 'growth' },
  { k: 'empresas', l: 'Clientes activos al cierre (neto de churn)' },
  { k: 'costos', l: 'Total costos' }, { l: '% costo / venta', t: 'pct', num: 'costos', den: 'venta' },
  { k: 'ub', l: 'Utilidad bruta', t: 'total' }, { l: 'Margen bruto', t: 'pct', num: 'ub', den: 'venta' },
  { k: 'gasto', l: 'Total gasto' }, { l: '% gasto / venta', t: 'pct', num: 'gasto', den: 'venta' },
  { k: 'ebitda', l: 'EBITDA', t: 'total' }, { l: 'Margen EBITDA', t: 'pct', num: 'ebitda', den: 'venta' },
  { k: 'uo', l: 'Utilidad de operación (EBIT)', t: 'total' }, { l: 'Margen de operación', t: 'pct', num: 'uo', den: 'venta' },
  { k: 'un', l: 'Utilidad neta', t: 'total' }, { l: 'Margen neto', t: 'pct', num: 'un', den: 'venta' },
  { l: 'Resultado acumulado', t: 'acum' },
];

function PLTable({ cols, data, rows, acum, total, fine, compact }: { cols: string[]; data: Series; rows: RowDef[]; acum: number[]; total?: boolean; fine?: boolean; compact?: boolean }) {
  fine = fine ?? true;
  const cp = !!compact, fs = cp ? 12 : 13, fsP = cp ? 10.5 : 11.5, px = cp ? 10 : 12;
  const tdF: React.CSSProperties = { ...tdFine, fontSize: fs, padding: cp ? `7px ${px}px 1px` : tdFine.padding };
  const thF: React.CSSProperties = cp ? { ...thFine, padding: `10px ${px}px 9px` } : thFine;
  const n = cols.length;
  const tot = (k: PLKey) => data[k].reduce((s, x) => s + x, 0);
  return (
    <ScrollX>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
        <thead><tr>
          <th style={{ ...(fine ? thF : th), ...stickyL, background: fine ? C.surface : C.surface, zIndex: 2, minWidth: 220 }}>Concepto</th>
          {cols.map((c, i) => <th key={c} style={fine ? { ...thF, paddingRight: i === n - 1 && !total ? 24 : px } : th}>{c}</th>)}
          {total && <th style={{ ...(fine ? thF : th), paddingRight: 24 }}>Total</th>}
        </tr></thead>
        <tbody>
          {rows.map((r, ri) => {
            if (r.t === 'sec') return <tr key={r.l}><td colSpan={n + 2} style={{ ...tdBase, ...stickyL, font: `650 10px ${FONT}`, color: C.gold, textTransform: 'uppercase', letterSpacing: '.16em', paddingTop: cp ? 14 : 22, paddingBottom: cp ? 6 : 8, paddingLeft: 20, background: C.surface, borderBottom: `1px solid ${C.line2}` }}>{r.l}</td></tr>;
            const nextPct = !!rows[ri + 1] && isPctRow(rows[ri + 1]);
            const bold = r.t === 'total' || r.t === 'acum';
            const bg = r.k === 'empresas' || r.l.startsWith('Clientes') ? '#FFF9E3' : r.t === 'total' && !fine ? C.tint : C.surface;
            const td: React.CSSProperties = !fine ? tdBase : isPctRow(r) ? { ...tdF, padding: cp ? `0 ${px}px 7px` : '0 12px 11px', borderBottom: `1px solid ${C.line2}` } : r.t === 'acum' ? { ...tdF, padding: cp ? `10px ${px}px` : '14px 12px', borderTop: `1px solid ${C.ink}` } : nextPct ? tdF : { ...tdF, padding: cp ? `7px ${px}px` : '10px 12px', borderBottom: `1px solid ${C.line2}` };
            const isPct = r.t === 'pct' || r.t === 'growth';
            const vals = r.vals ? r.vals : r.t === 'growth' ? data[r.k!].map((v, i) => (i ? ratio(v, data[r.k!][i - 1]) - 1 : NaN)) : isPct ? data[r.num!].map((v, i) => ratio(v, data[r.den!][i])) : r.t === 'acum' ? acum : data[r.k!];
            const tv = r.vals ? r.vals.reduce((a, b) => a + b, 0) : r.t === 'growth' ? NaN : isPct ? ratio(tot(r.num!), tot(r.den!)) : r.t === 'acum' ? acum[n - 1] : tot(r.k!);
            return (
              <tr key={r.l}>
                <td style={{ ...td, ...stickyL, background: bg, color: isPct ? (fine ? C.faint : C.muted) : C.ink, fontWeight: bold ? (fine ? 600 : 650) : fine ? 300 : 450, fontStyle: isPct ? 'italic' : 'normal', paddingLeft: fine ? (isPct ? 36 : r.t ? 20 : 36) : r.t ? 10 : 18, fontSize: fine ? (isPct ? fsP : fs) : undefined }}>{r.l}</td>
                {vals.map((v, i) => <td key={i} style={{ ...td, background: bg, color: isPct ? (fine ? C.faint : C.muted) : undefined, fontSize: fine ? (isPct ? fsP : fs) : undefined, fontStyle: fine && isPct ? 'italic' : undefined, ...(fine ? { paddingRight: i === n - 1 && !total ? 24 : px } : {}) }}>{isPct ? (isFinite(v) ? <Num v={v} pctv /> : '—') : <Num v={v} bold={bold} />}</td>)}
                {total && <td style={{ ...(fine ? td : tdBase), background: C.tint2, paddingRight: 24, fontSize: fine ? (isPct ? fsP : fs) : undefined, fontStyle: fine && isPct ? 'italic' : undefined, color: isPct ? C.faint : undefined }}>{isPct ? (isFinite(tv) ? <Num v={tv} pctv /> : '—') : <Num v={tv} bold />}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollX>
  );
}

function CellM({ cell, value, onSet }: { cell: MCell; value: number; onSet: (c: MCell) => void }) {
  if (typeof cell === 'number') return <NumInput quiet value={cell} onChange={v => onSet(v)} width={84} />;
  const linked = cell !== 'prev';
  return (
    <button title={linked ? 'Vinculado a un supuesto de ingresos (Supuestos). Se recalcula. Clic para fijar un monto.' : 'Arrastra el valor del mes anterior. Clic para fijar un monto.'}
      onClick={() => onSet(value)}
      style={{ width: 84, textAlign: 'right', border: `1px dashed ${linked ? C.yellowLine : 'transparent'}`, background: 'transparent', borderRadius: 6, padding: '4px 7px', cursor: 'pointer', font: `300 12.5px ${FONT}`, fontVariantNumeric: 'tabular-nums', color: value ? C.ink2 : C.faint }}>
      {linked && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: C.gold, marginRight: 6, verticalAlign: 'middle' }} />}
      {value ? nf0.format(value) : '—'}
    </button>
  );
}

function Cartera({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const [onlyActive, setOnlyActive] = useState(true);
  const list = M.clients.map((c, i) => ({ c, i, y2: R.clientsY2[i] })).filter(({ c, y2 }) =>
    !onlyActive || [...c.dev1, ...c.mant1, ...y2.dev, ...y2.mant].some(v => v !== 0) || c.name);
  const s = (a: number[]) => a.reduce((x, y) => x + y, 0);
  return (
    <Card title="Cartera de clientes · Año 2 (2027)" sub="Cobranza mensual por cliente: desarrollo inicial y mantenimiento. Las celdas amarillas se editan; las punteadas con punto dorado están vinculadas a supuestos."
      right={<label style={{ font: `500 12.5px ${FONT}`, color: C.ink2, display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} />Ocultar renglones vacíos</label>} pad={false}>
      <ScrollX>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead><tr>
            <th style={{ ...thC, ...stickyL, background: C.surface, zIndex: 2, minWidth: 230 }}>Cliente</th>
            <th style={{ ...thC, textAlign: 'left' }}>Concepto</th>
            <th style={thC}>Año 1</th>
            {M.months2.map(m => <th key={m} style={thC}>{m} 27</th>)}
            <th style={{ ...thC, color: C.ink }}>Año 2</th>
          </tr></thead>
          <tbody>
            {list.map(({ c, i, y2 }) => (['dev', 'mant'] as const).map((kind, j) => (
              <tr key={`${i}-${kind}`}>
                {j === 0 && (
                  <td rowSpan={2} style={{ ...tdC, ...stickyL, borderBottom: `1px solid ${C.line}`, verticalAlign: 'top', paddingTop: 10 }}>
                    <input value={c.name} placeholder="Cliente nuevo" onChange={e => set(m => { m.clients[i].name = e.target.value; })}
                      style={{ border: 0, outline: 'none', font: `600 13px ${FONT}`, color: C.ink, width: 210, background: 'transparent' }} />
                  </td>
                )}
                <td style={{ ...tdC, textAlign: 'left', color: C.muted, borderBottom: j ? `1px solid ${C.line}` : tdC.borderBottom }}>{kind === 'dev' ? 'Desarrollo' : 'Mantenimiento'}</td>
                <td style={{ ...tdC, color: C.muted, borderBottom: j ? `1px solid ${C.line}` : tdC.borderBottom }}>{money(s(kind === 'dev' ? c.dev1 : c.mant1))}</td>
                {(kind === 'dev' ? c.dev2 : c.mant2).map((cell, k) => (
                  <td key={k} style={{ ...tdC, padding: '4px 4px', borderBottom: j ? `1px solid ${C.line}` : tdC.borderBottom }}>
                    {/* Mantenimiento: solo se captura la primera mensualidad; después queda fija (contrato anual) */}
                    {kind === 'mant' && y2.mant.slice(0, k).some(v => v > 0)
                      ? <div title="Mensualidad fija: se captura solo en el primer mes del contrato" style={{ width: 84, textAlign: 'right', padding: '4px 7px', font: `300 12.5px ${FONT}`, fontVariantNumeric: 'tabular-nums', color: y2.mant[k] ? C.ink2 : C.faint }}>{y2.mant[k] ? money(y2.mant[k]) : '—'}</div>
                      : <CellM cell={cell} value={y2[kind][k]} onSet={v => set(m => { const c2 = m.clients[i]; if (kind === 'dev') c2.dev2[k] = v; else { c2.mant2[k] = v; c2.mant2 = fijarMant(c2.mant2, c2.mant1[c2.mant1.length - 1] ?? 0); } })} />}
                  </td>
                ))}
                <td style={{ ...tdC, fontWeight: 650, color: C.ink, background: C.tint2, borderBottom: j ? `1px solid ${C.line}` : tdC.borderBottom }}>{money(s(y2[kind]))}</td>
              </tr>
            )))}
            <tr>
              <td style={{ ...tdC, ...stickyL, fontWeight: 650, color: C.ink, background: C.tint }}>Total</td>
              <td style={{ ...tdC, background: C.tint }} />
              <td style={{ ...tdC, background: C.tint, fontWeight: 650 }}>{money(s(R.m1.dev) + s(R.m1.mant))}</td>
              {M.months2.map((_, k) => <td key={k} style={{ ...tdC, background: C.tint, fontWeight: 650 }}>{money(R.m2.dev[k] + R.m2.mant[k])}</td>)}
              <td style={{ ...tdC, background: C.tint2, fontWeight: 700, color: C.ink }}>{money(s(R.m2.dev) + s(R.m2.mant))}</td>
            </tr>
          </tbody>
        </table>
      </ScrollX>
    </Card>
  );
}

// En la vista anual se agrega el número de clientes (neto de churn) debajo de las ventas
const PL_ROWS_ANUAL: RowDef[] = PL_ROWS.flatMap(r => (r.k === 'venta' && r.t === 'total' ? [r, { k: 'empresas' as PLKey, l: 'Clientes activos al cierre (neto de churn)' }] : [r]));

function PL({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const [view, setView] = useState<'anual' | 'y1' | 'y2' | 'cartera'>('anual');
  const m1 = M.months1.map(m => (/\d/.test(m) ? m : `${m} 26`)), m2 = M.months2.map(m => `${m} 27`);
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Segmented value={view} onChange={setView} options={[{ v: 'anual', l: 'Anual · 5 años' }]} />
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Segmented warm value={view} onChange={setView} options={[{ v: 'y1', l: 'Año 1 · mensual' }, { v: 'y2', l: 'Año 2 · mensual' }]} />
          <button onClick={() => setView(view === 'cartera' ? 'y2' : 'cartera')} aria-pressed={view === 'cartera'}
            style={{ ...btn, background: view === 'cartera' ? C.ink : C.surface, color: view === 'cartera' ? '#fff' : C.ink, borderColor: view === 'cartera' ? C.ink : C.line }}>
            {view === 'cartera' ? '← Volver al P&L' : 'Cartera de clientes'}
          </button>
        </span>
      </div>
      {view === 'cartera' ? <Cartera M={M} R={R} set={set} /> : (
        <Card pad={false}
          title={view === 'anual' ? 'Estado de resultados proyectado' : view === 'y1' ? 'Año 1 · nov-25 a dic-26 (14 meses)' : 'Año 2 · 2027'}
          sub={view === 'anual' ? undefined : view === 'y1' ? 'Presupuesto/ejercido capturado en el modelo' : 'Calculado desde la cartera de clientes y la estructura de gastos'}>
          {view === 'anual' && <PLTable compact cols={YEARS} data={R.annual} acum={R.acumY} rows={M.params.amortizarPerdidas ? [...PL_ROWS_ANUAL, { l: 'Pérdidas fiscales', t: 'sec' }, { l: 'Pérdida aplicada contra la utilidad', vals: R.fiscal.aplicada }, { l: 'Saldo por amortizar al cierre', vals: R.fiscal.saldo }] : PL_ROWS_ANUAL} />}
          {view === 'y1' && <PLTable compact cols={m1} data={R.m1} rows={PL_ROWS} acum={R.acum1} total />}
          {view === 'y2' && <PLTable compact cols={m2} data={R.m2} rows={PL_ROWS} acum={R.acum2} total />}
        </Card>
      )}
    </div>
  );
}

// ===================== Módulo: Gastos =====================
function GCellView({ cell, value, onSet, base }: { cell: GCell; value: number; onSet: (c: GCell) => void; base: string }) {
  if (typeof cell === 'number') return <NumInput quiet value={cell} onChange={v => onSet(v)} width={92} />;
  const hint = cell.t === 'hc' ? 'Plantilla × sueldo + carga' : cell.t === 'C' ? (cell.k === 1 ? `= ${base}` : `${base} ×${cell.k}`) : 'Crecimiento vs. año anterior';
  if (cell.t === 'prev') {
    // Crecimiento editable: ×k se muestra como +(k − 1)%
    return (
      <div style={{ lineHeight: 1.15, display: 'grid', justifyItems: 'end', gap: 3 }}>
        <div title="Clic para fijar un monto" onClick={() => onSet(value)} style={{ cursor: 'pointer', color: value ? C.ink2 : C.faint }}>{money(value)}</div>
        <div title={hint} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, font: `300 10.5px ${FONT}`, color: C.faint }}>
          vs. año ant.
          <NumInput small kind="pct" width={52} value={cell.k - 1} onChange={v => onSet({ t: 'prev', k: +(1 + v).toFixed(6) })} />
        </div>
      </div>
    );
  }
  return (
    <div title={`${hint}. Clic para fijar un monto.`} onClick={() => onSet(value)} style={{ cursor: 'pointer', lineHeight: 1.15 }}>
      <div style={{ color: value ? C.ink2 : C.faint }}>{money(value)}</div>
      <div style={{ font: `300 10.5px ${FONT}`, color: C.faint }}>{hint}</div>
    </div>
  );
}

function LineTable({ title, sub, lines, vals, tot, onBase, onCell, onName, sem }: { title: string; sub: string; lines: { name: string; base: number; y: GCell[] }[]; vals: number[][]; tot: number[]; onBase: (i: number, v: number) => void; onCell: (i: number, k: number, c: GCell) => void; onName: (i: number, v: string) => void;
  /** Captura de 2027 por semestre (S1 ene–jun, S2 jul–dic) */ sem?: { vals: number[][]; tot: number[]; onSet: (i: number, h: 0 | 1, v: number) => void } }) {
  return (
    <Card title={title} sub={sub} pad={false}>
      <ScrollX>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
          <thead><tr><th style={{ ...th, ...stickyL, background: C.surface }}>Concepto</th><th style={th}>Base mensual</th>{sem && <><th style={th} title="Monto mensual de enero a junio 2027">2027 S1 ene–jun</th><th style={th} title="Monto mensual de julio a diciembre 2027">2027 S2 jul–dic</th></>}{YEARS_S.map(y => <th key={y} style={th}>{sem && y === '2027' ? '2027 base' : y}</th>)}</tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={{ ...tdBase, ...stickyL }}><input value={l.name} onChange={e => onName(i, e.target.value)} placeholder="Concepto nuevo" aria-label="Nombre del concepto (editable)" style={{ border: `1px solid ${C.yellowLine}`, borderRadius: 6, padding: '4px 8px', outline: 'none', font: `400 13px ${FONT}`, color: C.ink, background: C.yellowSoft, width: nameW(lines.map(x => x.name)) }} /></td>
                <td style={tdBase}><NumInput value={l.base} onChange={v => onBase(i, v)} width={92} /></td>
                {sem && ([0, 1] as const).map(h => <td key={'s' + h} style={tdBase}><NumInput value={sem.vals[i][h]} onChange={v => sem.onSet(i, h, v)} width={92} /></td>)}
                {l.y.map((c, k) => <td key={k} style={tdBase}><GCellView cell={c} value={vals[i][k]} base="base" onSet={nc => onCell(i, k, nc)} /></td>)}
              </tr>
            ))}
            <tr><td style={{ ...tdBase, ...stickyL, fontWeight: 650, color: C.ink, background: C.tint }}>Total mensual</td><td style={{ ...tdBase, background: C.tint }} />
              {sem && sem.tot.map((v, h) => <td key={'st' + h} style={{ ...tdBase, fontWeight: 650, color: C.ink, background: C.tint }}>{money(v)}</td>)}
              {tot.map((v, k) => <td key={k} style={{ ...tdBase, fontWeight: 650, color: C.ink, background: C.tint }}>{money(v)}</td>)}</tr>
          </tbody>
        </table>
      </ScrollX>
    </Card>
  );
}

const PARAM_DEFS: { k: Exclude<keyof Model['params'], 'aplicarInflacion' | 'aplicarPTU' | 'amortizarPerdidas'>; l: string; kind: 'money' | 'pct' | 'num'; g: string }[] = [
  { k: 'comision', l: 'Comisiones B2B (% del desarrollo)', kind: 'pct', g: 'Tasas' },
  { k: 'isr', l: 'Tasa de impuestos (ISR)', kind: 'pct', g: 'Tasas' },
  { k: 'inflacion', l: 'Inflación anual', kind: 'pct', g: 'Tasas' },
  { k: 'iaPersona', l: 'Consumo IA por persona (mensual)', kind: 'money', g: 'Costos' },
  { k: 'repoEmpresa', l: 'Repositorio por empresa (mensual)', kind: 'money', g: 'Costos' },
  { k: 'hostEmpresa', l: 'Hosting por empresa (mensual)', kind: 'money', g: 'Costos' },
  { k: 'platBase', l: 'Plataformas – base mensual', kind: 'money', g: 'Costos' },
  { k: 'platPersona', l: 'Plataformas – costo por persona (mensual)', kind: 'money', g: 'Costos' },
  { k: 'otrosGastosY2', l: 'Otros gastos mensuales 2027', kind: 'money', g: 'Costos' },
  { k: 'devGrupo', l: 'Desarrollo inicial – Empresa mediana', kind: 'money', g: 'Ingresos' },
  { k: 'devMarca', l: 'Desarrollo inicial – Empresa transnacional', kind: 'money', g: 'Ingresos' },
  { k: 'exhibiciones', l: 'Pagos Desarrollo Inicial', kind: 'num', g: 'Ingresos' },
  { k: 'mantMediana', l: 'Mantenimiento mensual – Empresa mediana', kind: 'money', g: 'Ingresos' },
  { k: 'mantTrans', l: 'Mantenimiento mensual – Empresa transnacional', kind: 'money', g: 'Ingresos' },
  { k: 'mantAgencia', l: 'Mantenimiento grupo empresarial – costo por Unidad de Negocio', kind: 'money', g: 'Ingresos' },
  { k: 'agenciasGrupo', l: 'Mantenimiento grupo empresarial – Unidades de Negocio por grupo', kind: 'num', g: 'Ingresos' },
];

const hcAdm = (M: Model, k: number, directo = false) => M.admin.reduce((s, r) => s + (!!r.directo === directo ? r.hc[k] : 0), 0);

// Tabla de plantilla: puestos administrativos (gasto) o personal directo (costo)
function PlantillaTable({ M, R, set, directo, title, sub, eyebrow }: { M: Model; R: Result; set: (f: (m: Model) => void) => void; directo: boolean; title: string; sub: string; eyebrow?: string }) {
  const G = R.gastos;
  const rows = M.admin.filter(r => !!r.directo === directo);
  const hcTot = [0, 1, 2, 3, 4].map(k => rows.reduce((s, r) => s + r.hc[k], 0));
  const costTot = directo ? G.dirTot : G.adminTot;
  return (
    <Card title={title} sub={sub} eyebrow={eyebrow} pad={false}>
      <ScrollX>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
          <thead>
            <tr><th style={{ ...th, ...stickyL, background: C.surface }} /><th style={th} /><th colSpan={2} style={{ ...th, textAlign: 'center', color: C.ink }}>Sueldo 2027</th><th colSpan={5} style={{ ...th, textAlign: 'center', color: C.ink }}>Plantilla (personas)</th><th colSpan={5} style={{ ...th, textAlign: 'center', color: C.ink }}>Costo mensual</th></tr>
            <tr><th style={{ ...th, ...stickyL, background: C.surface }}>Puesto</th><th style={th}>Sueldo mensual</th><th style={th} title="Enero a junio 2027">S1 ene–jun</th><th style={th} title="Julio a diciembre 2027">S2 jul–dic</th>{YEARS_S.map(y => <th key={'h' + y} style={th}>{y}</th>)}{YEARS_S.map(y => <th key={'c' + y} style={th}>{y}</th>)}</tr>
          </thead>
          <tbody>
            {M.admin.map((r, i) => !!r.directo !== directo ? null : (
              <tr key={i}>
                <td style={{ ...tdBase, ...stickyL }}><input value={r.name} onChange={e => set(m => { m.admin[i].name = e.target.value; })} style={{ border: 0, outline: 'none', font: `400 13px ${FONT}`, color: C.ink, background: 'transparent', width: nameW(M.admin.map(x => x.name), 14) }} /></td>
                <td style={tdBase}><NumInput value={r.sal} onChange={v => set(m => { m.admin[i].sal = v; })} width={88} /></td>
                {(['salS1', 'salS2'] as const).map(k => (
                  <td key={k} style={tdBase}><NumInput value={r[k] ?? r.sal} onChange={v => set(m => { m.admin[i][k] = v; })} width={88} /></td>
                ))}
                {r.hc.map((h, k) => <td key={'h' + k} style={tdBase}><NumInput kind="num" value={h} onChange={v => set(m => { m.admin[i].hc[k] = v; })} width={46} /></td>)}
                {r.y.map((c, k) => <td key={'c' + k} style={tdBase}>{k === 0
                  ? <div title="Referencia; el P&L 2026 usa el presupuesto capturado" style={{ color: C.faint }}>{money(G.admin[i][0])}</div>
                  : k === 1 && typeof c !== 'number' && c.t === 'hc' && G.admin27[i][0] !== G.admin27[i][1]
                    ? <div title="Costo mensual por semestre (S1 ene–jun / S2 jul–dic)"><div style={{ color: C.ink }}>{money(G.admin27[i][0])} <span style={{ color: C.faint }}>/</span> {money(G.admin27[i][1])}</div><div style={{ font: `300 10.5px ${FONT}`, color: C.faint }}>S1 / S2 + carga</div></div>
                    : <GCellView cell={c} value={G.admin[i][k]} base="sueldo" onSet={nc => set(m => { m.admin[i].y[k] = nc; })} />}</td>)}
              </tr>
            ))}
            <tr>
              <td style={{ ...tdBase, ...stickyL, fontWeight: 650, color: C.ink, background: C.tint }}>Total</td><td style={{ ...tdBase, background: C.tint }} /><td style={{ ...tdBase, background: C.tint }} /><td style={{ ...tdBase, background: C.tint }} />
              {hcTot.map((v, k) => <td key={'th' + k} style={{ ...tdBase, fontWeight: 650, color: C.ink, background: C.tint }}>{v}</td>)}
              {costTot.map((v, k) => { const h = directo ? G.dir27Tot : G.admin27Tot; return <td key={'tc' + k} style={{ ...tdBase, fontWeight: 650, color: C.ink, background: C.tint }}>{k === 1 && Math.abs(h[0] - h[1]) > 0.5 ? <>{money(h[0])} <span style={{ color: C.faint, fontWeight: 300 }}>/</span> {money(h[1])}</> : money(v)}</td>; })}
            </tr>
          </tbody>
        </table>
      </ScrollX>
    </Card>
  );
}

function Gastos({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const G = R.gastos;
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <FineKpis items={[
        { label: 'Gasto mensual', sub: '2027', value: short(G.opexTot[1] + G.adminTot[1] + G.mktTot[1]), note: 'Operativo + administrativo + marketing' },
        { label: 'Gasto mensual', sub: '2030', value: short(G.opexTot[4] + G.adminTot[4] + G.mktTot[4]), note: 'Monto base con carga social; sin inflación ni incremento de sueldos' },
        { label: 'Plantilla administrativa', sub: '2027 → 2030', value: `${hcAdm(M, 1)} → ${hcAdm(M, 4)}`, unit: 'personas' },
        { label: 'Nómina administrativa', sub: 'Mensual 2030', value: short(G.adminTot[4]), note: `${pct(ratio(G.adminTot[4] * 12, R.annual.venta[4]))} de la venta anual` },
      ]} />

      <LineTable title="Gasto operativo mensual" sub="Montos mensuales por año; el P&L los anualiza y, si está activo el factor de inflación, la aplica a partir de 2028." lines={M.opex} vals={G.opex} tot={G.opexTot}
        onBase={(i, v) => set(m => { m.opex[i].base = v; })} onCell={(i, k, c) => set(m => { m.opex[i].y[k] = c; })} onName={(i, v) => set(m => { m.opex[i].name = v; })} />

      <PlantillaTable M={M} R={R} set={set} directo={false} title="Gasto administrativo · plantilla"
        sub="Personas por año y costo mensual. De 2027 a 2030 el costo es plantilla × sueldo mensual (+ carga social); en 2027 el sueldo se captura por semestre (S1 ene–jun, S2 jul–dic) y mueve el P&L mensual y la caja. 2026 es referencia, el P&L usa el presupuesto capturado." />

      <LineTable title="Gasto de marketing y ventas" sub="En 2027 el monto mensual se captura por semestre (S1 ene–jun, S2 jul–dic) y mueve el P&L mensual y la caja; por omisión S1 = 50% y S2 = 100% del monto 2027. De 2028 en adelante crece sobre la base 2027." lines={M.mkt} vals={G.mkt} tot={G.mktTot}
        sem={{ vals: G.mkt27, tot: G.mkt27Tot, onSet: (i, h, v) => set(m => { m.mkt[i][h ? 's2' : 's1'] = v; }) }}
        onBase={(i, v) => set(m => { m.mkt[i].base = v; })} onCell={(i, k, c) => set(m => { m.mkt[i].y[k] = c; })} onName={(i, v) => set(m => { m.mkt[i].name = v; })} />
    </div>
  );
}

// ===================== Módulo: P&L vs. Flujo =====================
const FL = { pl: C.faint, wc: '#8A8D94', ciclo: C.gold, gap: 'rgba(201,151,0,.10)' };

function CashChart({ F }: { F: Flujo }) {
  const W = 1080, H = 380, pl = 64, pr = 24, pt = 40, pb = 44;
  const [hov, setHov] = useState<number | null>(null);
  const series = [F.pl.acum, F.wc.acum, F.ciclo.acum];
  const lo = Math.min(0, ...series.flat()), hi = Math.max(0, ...series.flat());
  const step = niceStep((hi - lo) / 5);
  const yMin = Math.floor(lo / step) * step, yMax = Math.ceil(hi / step) * step;
  const X = (t: number) => pl + (t / (N_MESES - 1)) * (W - pl - pr);
  const Y = (v: number) => pt + (1 - (v - yMin) / (yMax - yMin)) * (H - pt - pb);
  const path = (a: number[]) => a.map((v, t) => `${t ? 'L' : 'M'}${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const gap = `${path(F.pl.acum)}${[...F.ciclo.acum].reverse().map((v, i) => `L${X(N_MESES - 1 - i).toFixed(1)},${Y(v).toFixed(1)}`).join('')}Z`;
  const ticks: number[] = []; for (let v = yMin; v <= yMax + 1; v += step) ticks.push(v);
  const marker = (v: Vista, color: string, label: string, dy: number) => {
    if (!v.necesidad) return null;
    const x = X(v.mesPico), y = Y(v.acum[v.mesPico]);
    return (
      <g>
        <circle cx={x} cy={y} r={3.5} fill={C.surface} stroke={color} strokeWidth={1.5} />
        <line x1={x} y1={y + 5} x2={x} y2={y + dy - 12} stroke={color} strokeWidth={.6} strokeDasharray="2 2" />
        <text x={x} y={y + dy} textAnchor="middle" style={{ font: `600 11px ${FONT}`, fill: color === C.faint ? C.ink2 : color, paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>{label} −{short(v.necesidad)}</text>
        <text x={x} y={y + dy + 13} textAnchor="middle" style={{ font: `300 10px ${FONT}`, fill: C.faint, paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>{mesCorto(v.mesPico)}</text>
      </g>
    );
  };
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseMove={e => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * W; const t = Math.round((x - pl) / (W - pl - pr) * (N_MESES - 1)); setHov(t >= 0 && t < N_MESES ? t : null); }}
        onMouseLeave={() => setHov(null)}>
        {ticks.map(v => <g key={v}><line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} stroke={v === 0 ? C.ink : C.line2} strokeWidth={v === 0 ? .8 : 1} strokeDasharray={v === 0 ? undefined : '3 4'} /><text x={pl - 8} y={Y(v) + 3.5} textAnchor="end" style={{ font: `300 10.5px ${FONT}`, fill: C.faint }}>{v === 0 ? '$0' : (v < 0 ? '−' : '') + short(Math.abs(v))}</text></g>)}
        {[2, 14, 26, 38, 50].map((t, i) => <g key={t}><line x1={X(t)} x2={X(t)} y1={pt - 6} y2={H - pb} stroke={C.line2} /><text x={X(t) + 5} y={pt - 12} style={{ font: `600 10px ${FONT}`, letterSpacing: '.1em', fill: C.muted }}>{2026 + i}</text></g>)}
        <path d={gap} fill={FL.gap} />
        <path d={path(F.pl.acum)} fill="none" stroke={C.ink2} strokeWidth={1.2} />
        <path d={path(F.wc.acum)} fill="none" stroke={FL.wc} strokeWidth={1.1} strokeDasharray="5 4" />
        <path d={path(F.ciclo.acum)} fill="none" stroke={FL.ciclo} strokeWidth={2.2} strokeLinejoin="round" />
        {marker(F.pl, C.ink2, 'P&L', -16)}
        {marker(F.ciclo, C.gold, 'Con ciclo comercial', 26)}
        {hov !== null && (
          <g pointerEvents="none">
            <line x1={X(hov)} x2={X(hov)} y1={pt - 6} y2={H - pb} stroke={C.ink} strokeWidth={.6} />
            {series.map((a, i) => <circle key={i} cx={X(hov)} cy={Y(a[hov])} r={3} fill={[C.ink2, FL.wc, FL.ciclo][i]} />)}
          </g>
        )}
      </svg>
      {hov !== null && (
        <div style={{ position: 'absolute', top: 8, left: `${Math.min(78, Math.max(2, X(hov) / W * 100 + 1.5))}%`, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 0, padding: '10px 12px', boxShadow: '0 8px 24px rgba(16,17,19,.1)', pointerEvents: 'none', minWidth: 210 }}>
          <div style={{ font: `650 10px ${FONT}`, letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 6 }}>{mesCorto(hov)}</div>
          {[['Acumulado P&L', F.pl.acum[hov], C.ink2], ['+ Crédito, CAPEX y cap. de trabajo', F.wc.acum[hov], FL.wc], ['+ Ciclo comercial', F.ciclo.acum[hov], FL.ciclo]].map(([l, v, c]) => (
            <div key={l as string} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, font: `300 12px ${FONT}`, padding: '2px 0' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 2, background: c as string }} />{l as string}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: (v as number) < 0 ? C.neg : C.ink }}>{(v as number) < 0 ? '−' : ''}{short(Math.abs(v as number))}</span>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${C.line2}`, marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', font: `600 12px ${FONT}` }}>
            <span>Caja que falta vs. P&L</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{short(Math.max(0, F.pl.acum[hov] - F.ciclo.acum[hov]))}</span>
          </div>
        </div>
      )}
    </div>
  );
}
function niceStep(raw: number) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1)))); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }

function Waterfall({ F }: { F: Flujo }) {
  const a = F.pl.necesidad, k = Math.max(0, F.plb.necesidad - F.pl.necesidad), b = Math.max(0, F.wc.necesidad - F.plb.necesidad), c = Math.max(0, F.ciclo.necesidad - F.wc.necesidad), tot = F.ciclo.necesidad;
  const bars = [
    { l: 'Pérdidas del P&L', s: 'Curva J contable', v: a, from: 0, col: C.ink2 },
    { l: '+ Crédito y CAPEX', s: 'Pago de capital del crédito y compra de equipos y oficinas (la D&A no es salida de caja)', v: k, from: a, col: '#B9BCC2' },
    { l: '+ Capital de trabajo', s: 'Cartera y proveedores', v: b, from: a + k, col: FL.wc },
    { l: '+ Ciclo comercial', s: 'Hitos de pago y arranque del mantenimiento', v: c, from: a + k + b, col: C.yellow },
    { l: 'Necesidad máxima de caja', s: `${F.mesesOperacion.toFixed(1)} meses de operación`, v: tot, from: 0, col: C.ink, total: true },
  ];
  const max = Math.max(tot, a + k + b + c, 1);
  // Cascada vertical: cada barra arranca donde terminó la anterior; la última es el total
  const W = 560, H = 270, pt = 30, pb = 62, pl = 8, pr = 8, n = bars.length;
  const slot = (W - pl - pr) / n, bw = slot * 0.56;
  const Y = (v: number) => pt + (1 - v / max) * (H - pt - pb);
  const words = (t: string) => { const w = t.replace(/^\+ /, '').split(' '); const h = Math.ceil(w.length / 2); return w.length > 1 ? [w.slice(0, h).join(' '), w.slice(h).join(' ')] : w; };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Cascada de la necesidad de caja">
      <line x1={pl} x2={W - pr} y1={Y(0)} y2={Y(0)} stroke={C.line} />
      {bars.map((r, i) => {
        const x = pl + i * slot + (slot - bw) / 2;
        const y0 = Y(r.from + r.v), y1 = Y(r.from);
        const nx = pl + (i + 1) * slot + (slot - bw) / 2;
        return (
          <g key={r.l}>
            <title>{`${r.l}: ${r.s}`}</title>
            <rect x={x} y={y0} width={bw} height={Math.max(1, y1 - y0)} fill={r.col} style={{ transition: 'all .3s' }} />
            {i < n - 1 && <line x1={x + bw} x2={nx} y1={y0} y2={y0} stroke={C.faint} strokeDasharray="3 3" />}
            <text x={x + bw / 2} y={y0 - 8} textAnchor="middle" style={{ font: `${r.total ? 650 : 400} ${r.total ? 15 : 13}px ${FONT}`, fill: C.ink, fontVariantNumeric: 'tabular-nums' }}>{i && !r.total ? '+' : ''}{short(r.v)}</text>
            {words(r.l).map((w, k) => <text key={k} x={x + bw / 2} y={H - pb + 18 + k * 14} textAnchor="middle" style={{ font: `${r.total ? 650 : 400} 11.5px ${FONT}`, fill: C.ink }}>{w}</text>)}
            {r.total && <text x={x + bw / 2} y={H - pb + 50} textAnchor="middle" style={{ font: `300 10.5px ${FONT}`, fill: C.faint }}>{r.s}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function ClienteTipo({ F }: { F: Flujo }) {
  const h = F.h;
  const pre = Math.round(h.diaFirma / 30.5);
  const meses = Array.from({ length: pre + Math.max(h.Lmant + h.Ldso, 4) + 3 }, (_, i) => i - pre);
  const cell = (m: number, kind: 'pl' | 'real') => {
    if (kind === 'pl') {
      if (m === 0 || m === h.pDev2) return { c: C.ink2, t: '50%' };
      if (m >= h.pMant) return { c: '#C9CBD0', t: '' };
      return null;
    }
    if (m < 0) return { c: 'repeating-linear-gradient(135deg, #E4E2DA 0 3px, #F4F3EE 3px 6px)', t: '' };
    if (m === h.L1 && m === h.L2) return { c: C.gold, t: '100%' };
    if (m === h.L1) return { c: C.gold, t: '50%' };
    if (m === h.L2) return { c: C.gold, t: '50%' };
    if (m >= h.Lmant + h.Ldso) return { c: '#F2D77A', t: '' };
    return { c: 'repeating-linear-gradient(135deg, #F3D9D6 0 3px, #FBEAE8 3px 6px)', t: '' };
  };
  const row = (l: string, s: string, kind: 'pl' | 'real') => (
    <div style={{ display: 'grid', gridTemplateColumns: `150px repeat(${meses.length}, 1fr)`, gap: 3, alignItems: 'center' }}>
      <span><span style={{ display: 'block', font: `600 11.5px ${FONT}`, color: C.ink }}>{l}</span><span style={{ display: 'block', font: `300 10px ${FONT}`, color: C.faint }}>{s}</span></span>
      {meses.map(m => { const c = cell(m, kind); return <span key={m} style={{ height: 70, borderRadius: 4, background: c ? c.c : C.tint2, display: 'grid', placeItems: 'center', font: `600 11px ${FONT}`, color: '#fff' }}>{c?.t}</span>; })}
    </div>
  );
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: `150px repeat(${meses.length}, 1fr)`, gap: 3, font: `300 9.5px ${FONT}`, color: C.faint, textAlign: 'center' }}>
        <span />{meses.map(m => <span key={m} style={{ fontWeight: m === 0 ? 650 : 300, color: m === 0 ? C.ink : C.faint }}>{m === 0 ? 'Mes 0' : m}</span>)}
      </div>
      {row('Lo que dice el P&L', 'La cartera registra el ingreso desde el mes 0', 'pl')}
      {row('Lo que pasa en caja', 'Preventa, ciclo y cobranza', 'real')}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 6, font: `300 10.5px ${FONT}`, color: C.muted }}>
        {[[C.ink2, 'Desarrollo en el P&L'], [C.gold, 'Cobro de desarrollo'], ['#F2D77A', 'Cobro de mantenimiento'], ['repeating-linear-gradient(135deg, #E4E2DA 0 3px, #F4F3EE 3px 6px)', 'Preventa (costo ya incluido en el P&L)'], ['repeating-linear-gradient(135deg, #F3D9D6 0 3px, #FBEAE8 3px 6px)', 'Registrado en el P&L, aún sin cobrar']].map(([c, l]) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 9, borderRadius: 2, background: c }} />{l}</span>
        ))}
      </div>
    </div>
  );
}

function PlanChart({ P, F }: { P: Plan; F: Flujo }) {
  const W = 1080, H = 300, pl = 64, pr = 24, pt = 30, pb = 40;
  // Periodo del plan: hasta un año después de la última disposición
  const ultimaT = Math.max(P.inicio, ...P.disp.filter(d => d.monto > 0.5).map(d => d.t));
  const fin = Math.min(N_MESES, ultimaT + 6);
  const meses = Array.from({ length: fin - P.inicio }, (_, i) => P.inicio + i);
  const dispV = P.disp.filter(d => d.t < fin);
  const vals = [...meses.map(t => P.caja[t]), ...dispV.map(d => d.monto), P.colchon, 0];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const step = niceStep((hi - lo) / 5);
  const yMin = Math.floor(lo / step) * step, yMax = Math.ceil(hi / step) * step;
  const n = meses.length;
  const X = (t: number) => pl + ((t - P.inicio + 0.5) / n) * (W - pl - pr);
  const Y = (v: number) => pt + (1 - (v - yMin) / (yMax - yMin)) * (H - pt - pb);
  const bw = Math.min(26, ((W - pl - pr) / n) * 2.2);
  const ticks: number[] = []; for (let v = yMin; v <= yMax + 1; v += step) ticks.push(v);
  const line = meses.map((t, i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(P.caja[t]).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {ticks.map(v => <g key={v}><line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} stroke={v === 0 ? C.ink : C.line2} strokeWidth={v === 0 ? .8 : 1} strokeDasharray={v === 0 ? undefined : '3 4'} /><text x={pl - 8} y={Y(v) + 3.5} textAnchor="end" style={{ font: `300 10.5px ${FONT}`, fill: C.faint }}>{v === 0 ? '$0' : (v < 0 ? '−' : '') + short(Math.abs(v))}</text></g>)}
      {P.colchon > 0 && <g><line x1={pl} x2={W - pr} y1={Y(P.colchon)} y2={Y(P.colchon)} stroke={C.neg} strokeWidth={.8} strokeDasharray="5 4" /><text x={W - pr} y={Y(P.colchon) + 13} textAnchor="end" style={{ font: `400 10px ${FONT}`, fill: C.neg }}>Colchón {short(P.colchon)}</text></g>}
      {dispV.map(d => (
        <g key={d.t}>
          <text x={X(d.t + 1)} y={H - pb + 16} textAnchor="middle" style={{ font: `${d.monto > 0.5 ? 600 : 300} 9.5px ${FONT}`, fill: d.monto > 0.5 ? C.ink : C.faint }}>{d.trimestre}</text>
          {d.monto > 0.5 && <>
            <rect x={X(d.t) - bw / 2} y={Y(d.monto)} width={bw} height={Math.max(1, Y(0) - Y(d.monto))} rx={3} fill={C.yellow} />
            <text x={X(d.t)} y={Y(d.monto) - 6} textAnchor="middle" style={{ font: `600 10.5px ${FONT}`, fill: '#8A6A00' }}>{short(d.monto)}</text>
          </>}
        </g>
      ))}
      <path d={line} fill="none" stroke={C.ink} strokeWidth={1.4} strokeLinejoin="round" />
      {meses.filter(t => P.cortes.includes(t) && t !== P.inicio).map(t => <line key={t} x1={X(t) - (W - pl - pr) / n / 2} x2={X(t) - (W - pl - pr) / n / 2} y1={pt} y2={H - pb} stroke={C.line2} />)}
    </svg>
  );
}

const COBERTURA_DEF = 1000000; // reserva adicional de cobertura en el capital nuevo
const PRIMERA_DEF = 20; // jul-27 (inicio del 3er trimestre)
const planDe = (M: Model, F: Flujo) => planDisposiciones(F, 14, M.plan?.colchonMeses ?? 1, M.plan?.primera ?? PRIMERA_DEF, M.plan?.cobertura ?? COBERTURA_DEF);
function PlanDisposiciones({ M, R, F, set }: { M: Model; R: Result; F: Flujo; set: (f: (m: Model) => void) => void }) {
  const P = useMemo(() => planDe(M, F), [M, F]);
  const upd = (k: 'primera' | 'colchonMeses' | 'cobertura', v: number) => set(m => { m.plan = { ...(m.plan ?? { inicio: 14, colchonMeses: 1, primera: PRIMERA_DEF }), inicio: 14, [k]: v }; });
  const con = P.disp.filter(d => d.monto > 0.5);
  const lab = { font: `650 10px ${FONT}`, textTransform: 'uppercase' as const, letterSpacing: '.16em', color: C.ink };
  return (
    <Card eyebrow="Disposiciones trimestrales" title="Plan de disposiciones del capital nuevo" sub={`El capital no se entrega en una sola exhibición: se dispone cada 3 meses, a partir de la primera disposición, lo justo para que la caja nunca baje del colchón. El crédito bancario ya se dispuso (no es dinero nuevo): solo resta caja con su pago de capital mensual desde ene-27. Montos redondeados a múltiplos de ${short(REDONDEO)}.`}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'center', marginBottom: 18 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={lab}>Primera disposición</span>
          <select value={P.primera} onChange={e => upd('primera', +e.target.value)}
            style={{ border: `1px solid ${C.yellowLine}`, background: C.yellowSoft, borderRadius: 99, padding: '5px 12px', font: `500 12.5px ${FONT}`, color: C.ink, cursor: 'pointer' }}>
            {Array.from({ length: 24 }, (_, i) => 14 + i).map(t => <option key={t} value={t}>{mesCorto(t)}</option>)}
          </select>
        </label>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={lab}>Colchón de caja</span>
          <Segmented value={P.colchonMeses} onChange={v => upd('colchonMeses', v)} options={[0, 1, 2, 3].map(v => ({ v, l: v ? `${v} ${v === 1 ? 'mes' : 'meses'}` : 'Sin colchón' }))} />
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10 }} title="Reserva adicional que entra con la primera disposición y se conserva en caja; no afecta la valuación">
          <span style={lab}>Cobertura adicional</span>
          <NumInput value={P.cobertura} onChange={v => upd('cobertura', Math.max(0, v))} width={110} />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', borderTop: `1px solid ${C.line2}`, borderBottom: `1px solid ${C.line2}`, marginBottom: 18 }}>
        {[
          ['Capital nuevo total', short(P.total), `${P.n} disposiciones trimestrales`],
          ['Mayor disposición', short(P.mayor), con.find(d => d.monto === P.mayor)?.trimestre ?? '—'],
          ['Primera / última', con.length ? `${con[0].trimestre} → ${P.ultima}` : '—', 'Después ya no se requiere capital'],
          P.primera > P.inicio
            ? ['Puente hasta la primera', short(P.puente), `Caja negativa ${mesCorto(P.inicio)} a ${mesCorto(P.primera - 1)}; la cubre la disposición de ${mesCorto(P.primera)}`]
            : ['Déficit previo', short(P.deficitPrevio), `Caja consumida antes de ${mesCorto(P.inicio)} (ya fondeada)`],
        ].map(([l, v, n], k) => (
          <div key={l} style={{ padding: '14px 18px 12px', paddingLeft: k ? 18 : 0, borderLeft: k ? `1px solid ${C.line2}` : undefined }}>
            <div style={lab}>{l}</div>
            <div style={{ font: `200 30px/1.1 ${FONT}`, letterSpacing: '-0.03em', marginTop: 6, whiteSpace: 'nowrap' }}>{v}</div>
            <div style={{ font: `300 11px ${FONT}`, color: C.muted, marginTop: 4 }}>{n}</div>
          </div>
        ))}
      </div>

      <Legend items={[{ c: C.yellow, l: 'Disposición (cada 3 meses)' }, { c: C.ink, l: 'Caja mes a mes con el plan' }, ...(P.colchon ? [{ c: C.neg, l: 'Colchón mínimo', dash: true }] : [])]} />
      <div style={{ marginTop: 8 }}><PlanChart P={P} F={F} /></div>

      <div style={{ marginTop: 16, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', font: `300 12.5px ${FONT}`, fontVariantNumeric: 'tabular-nums' }}>
          <thead><tr>{['Trimestre', 'Disposición', 'Capital acumulado', 'Flujo operativo', 'Pago de capital crédito', 'Caja mínima', 'Caja al cierre'].map((h, i) => (
            <th key={h} style={{ textAlign: i ? 'right' : 'left', padding: '7px 10px', borderBottom: `1px solid ${C.ink}`, font: `650 10px ${FONT}`, letterSpacing: '.14em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>))}</tr></thead>
          <tbody>
            {P.disp.filter(d => d.t <= Math.max(...con.map(x => x.t), P.inicio) + 6).map(d => {
              const on = d.monto > 0.5;
              const td = (v: React.ReactNode, extra?: React.CSSProperties) => <td style={{ padding: '7px 10px', textAlign: 'right', borderBottom: `1px solid ${C.line2}`, ...extra }}>{v}</td>;
              const mx = (v: number) => (Math.abs(v) < 0.5 ? '—' : v < 0 ? `(${money(-v)})` : money(v));
              return (
                <tr key={d.t} style={{ background: on ? C.yellowSoft : undefined }}>
                  <td style={{ padding: '7px 10px', borderBottom: `1px solid ${C.line2}`, fontWeight: on ? 600 : 300 }}>{d.trimestre}{d.t >= P.primera && <span style={{ color: C.faint, fontWeight: 300, marginLeft: 6 }}>{mesCorto(d.t)}</span>}</td>
                  {td(on ? money(d.monto) : '—', { fontWeight: on ? 600 : 300 })}
                  {td(money(d.acumulado), { color: C.muted })}
                  {td(mx(d.flujoOperativo), { color: d.flujoOperativo < 0 ? C.neg : C.ink })}
                  {td(mx(d.banco), { color: d.banco < 0 ? C.neg : C.ink })}
                  {td(mx(d.cajaMinima))}
                  {td(mx(d.cajaCierre), { fontWeight: 600 })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ font: `300 11px ${FONT}`, color: C.faint, marginTop: 10 }}>Supuestos: la caja al inicio de {mesCorto(P.inicio)} es cero y el déficit anterior (punto más bajo: {short(P.deficitPrevio)}) ya está fondeado.{P.primera > P.inicio ? ` El capital nuevo entra hasta ${mesCorto(P.primera)}: de ${mesCorto(P.inicio)} a ${mesCorto(P.primera - 1)} la operación consume ${short(P.puente)} sin capital nuevo (puente con socios o proveedores) y la primera disposición lo repone.` : ''} Conciliación: necesidad máxima {short(F.ciclo.necesidad)} ≈ déficit previo + capital del plan − colchón − redondeo a {short(REDONDEO)}. Horizonte a dic-30: no incluye cobranza posterior, la PTU 2030 (pagadera en may-31) ni el capital del crédito que vence en 2031.</div>
    </Card>
  );
}

// Composición del ingreso (desarrollo inicial vs. mantenimiento) contra la necesidad de capital
function MezclaIngreso({ M, R, F, PL }: { M: Model; R: Result; F: Flujo; PL: Plan }) {
  const A = R.annual, P = M.params;
  const [sel, setSel] = useState<number>(-1); // -1 = 2026–2030
  const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
  const dev = sel < 0 ? sum(A.dev) : A.dev[sel], mant = sel < 0 ? sum(A.mant) : A.mant[sel];
  const base = dev + mant || 1;
  const anios = [{ l: '2026', a: 0, b: 14 }, { l: '2027', a: 14, b: 26 }, { l: '2028', a: 26, b: 38 }, { l: '2029', a: 38, b: 50 }, { l: '2030', a: 50, b: 62 }];
  const sl = (x: number[], a: number, b: number) => sum(x.slice(a, b));
  const dispMes = Array.from({ length: N_MESES }, () => 0); PL.disp.forEach(d => { if (d.monto > 0.5) dispMes[d.t] += d.monto; });
  const rows = anios.map(y => {
    const cDev = sl(F.det.cobroDev, y.a, y.b), cMant = sl(F.det.cobroMant, y.a, y.b);
    const egr = sl(F.det.pagos, y.a, y.b) + sl(F.det.capitalCredito, y.a, y.b) + sl(F.det.capex, y.a, y.b);
    return { ...y, cDev, cMant, egr, brecha: cDev + cMant - egr, cap: sl(dispMes, y.a, y.b), cob: egr ? cMant / egr : 0 };
  });
  const maxCob = rows.slice(1).reduce((m, r) => (r.cob > m.cob ? r : m), rows[1]);
  const card = (dark: boolean, title: string, v: number, items: [string, string][]) => (
    <div style={{ background: dark ? C.ink : C.tint2, color: dark ? '#fff' : C.ink, padding: '24px 26px', border: `1px solid ${dark ? C.ink : C.line}` }}>
      <div style={{ font: `500 11px ui-monospace, SFMono-Regular, Menlo, monospace`, letterSpacing: '.08em', textTransform: 'uppercase', color: dark ? C.yellow : C.gold }}>{title}</div>
      <div style={{ font: `200 64px/1.05 ${FONT}`, letterSpacing: '-0.04em', margin: '8px 0 14px' }}>{pct(v)}</div>
      {/* Barra delgada: se mueve con el % del periodo elegido */}
      <div style={{ height: 4, background: dark ? 'rgba(255,255,255,.14)' : C.line, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(0, Math.min(1, v)) * 100}%`, background: dark ? C.yellow : C.gold, transition: 'width .6s cubic-bezier(.2,.8,.2,1)' }} />
      </div>
      <div style={{ font: `500 9.5px ui-monospace, SFMono-Regular, Menlo, monospace`, letterSpacing: '.08em', textTransform: 'uppercase', color: dark ? C.yellow : C.gold, paddingBottom: 8, borderBottom: `1px solid ${dark ? 'rgba(255,255,255,.12)' : C.line}` }}>Supuestos</div>
      {items.map(([l, x]) => (
        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '10px 0', borderBottom: `1px solid ${dark ? 'rgba(255,255,255,.08)' : C.line}` }}>
          <span style={{ font: `300 13px ${FONT}`, color: dark ? 'rgba(255,255,255,.8)' : C.ink2 }}>{l}</span>
          <span style={{ font: `200 22px ${FONT}`, fontVariantNumeric: 'tabular-nums' }}>{x}</span>
        </div>
      ))}
    </div>
  );
  const nPagos = Math.max(1, Math.round(P.exhibiciones || 1));
  const td = (v: React.ReactNode, extra?: React.CSSProperties) => <td style={{ padding: '9px 12px', textAlign: 'right', borderBottom: `1px solid ${C.line2}`, ...extra }}>{v}</td>;
  const mx = (v: number) => (Math.abs(v) < 0.5 ? '—' : v < 0 ? `(${money(-v)})` : money(v));
  return (
    <Card eyebrow="Composición del ingreso" title="De dónde viene el dinero vs. cuánto capital se necesita"
      right={<Segmented value={sel} onChange={setSel} options={[{ v: -1, l: '2026–2030' }, ...YEARS_S.map((y, i) => ({ v: i, l: y }))]} />}>
      <div className="axon-two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {card(false, 'Desarrollo inicial', dev / base, [['Empresa Mediana', '$' + money(P.devGrupo)], ['Empresa Transnacional', '$' + money(P.devMarca)], ['Pagos', `${nPagos} de ${Math.round(100 / nPagos)}%`]])}
        {card(true, 'Mantenimiento recurrente', mant / base, [['Mensual Empresa Mediana', '$' + money(P.mantMediana ?? 0)], ['Mensual Empresa Transnacional', '$' + money(P.mantTrans ?? 0)]])}
      </div>
      <div style={{ font: `300 11px ${FONT}`, color: C.faint, marginTop: 8 }}>% sobre ingreso por desarrollo + mantenimiento del P&L ({sel < 0 ? '2026–2030' : YEARS_S[sel]}).</div>

      <div style={{ marginTop: 22, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', font: `300 12.5px ${FONT}`, fontVariantNumeric: 'tabular-nums' }}>
          <thead><tr>{['Caja por año', ...rows.map(r => r.l)].map((h, i) => (
            <th key={h} style={{ textAlign: i ? 'right' : 'left', padding: '7px 12px', borderBottom: `1px solid ${C.ink}`, font: `650 10px ${FONT}`, letterSpacing: '.14em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>))}</tr></thead>
          <tbody>
            <tr><td style={{ padding: '9px 12px', borderBottom: `1px solid ${C.line2}` }}>Cobranza desarrollo inicial</td>{rows.map(r => td(mx(r.cDev)))}</tr>
            <tr><td style={{ padding: '9px 12px', borderBottom: `1px solid ${C.line2}` }}>Cobranza mantenimiento recurrente</td>{rows.map(r => td(mx(r.cMant)))}</tr>
            <tr><td style={{ padding: '9px 12px', borderBottom: `1px solid ${C.line2}` }}>Egresos totales (nómina, terceros, impuestos, crédito y CAPEX)</td>{rows.map(r => td(mx(-r.egr), { color: C.neg }))}</tr>
            <tr><td style={{ padding: '9px 12px', borderBottom: `1px solid ${C.line2}`, fontWeight: 600 }}>Brecha de caja del año</td>{rows.map(r => td(mx(r.brecha), { fontWeight: 600, color: r.brecha < 0 ? C.neg : C.ink }))}</tr>
            <tr style={{ background: C.yellowSoft }}><td style={{ padding: '9px 12px', borderBottom: `1px solid ${C.line2}`, fontWeight: 600 }}>Capital nuevo dispuesto (plan)</td>{rows.map(r => td(r.cap > 0.5 ? money(r.cap) : '—', { fontWeight: 600 }))}</tr>
            <tr><td style={{ padding: '9px 12px', borderBottom: `1px solid ${C.line2}`, color: C.muted, fontStyle: 'italic' }}>El mantenimiento cubre de los egresos</td>{rows.map(r => td(pct(r.cob, 0), { color: C.muted, fontStyle: 'italic' }))}</tr>
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line2}`, display: 'grid', gap: 6, font: `300 12px/1.5 ${FONT}`, color: C.ink2 }}>
        <div>• El ingreso recurrente cubre como máximo <strong style={{ fontWeight: 600 }}>{pct(maxCob.cob, 0)}</strong> de los egresos ({maxCob.l}): la operación depende de vender y cobrar nuevos desarrollos.</div>
        <div>• El desarrollo inicial es <strong style={{ fontWeight: 600 }}>{pct(sum(A.dev) / (sum(A.dev) + sum(A.mant) || 1))}</strong> del ingreso 2026–2030, pero se cobra en {nPagos} {nPagos === 1 ? 'pago' : 'pagos'} con el retraso del ciclo comercial: esa espera es la que financia el capital nuevo de <strong style={{ fontWeight: 600, color: C.neg }}>{short(PL.total)}</strong>.</div>
      </div>
    </Card>
  );
}

function FlujoTab({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const mvs = (x: number) => `+${x} ${x === 1 ? 'mes' : 'meses'} vs. P&L`;
  const F = useMemo(() => computeFlujo(M, R), [M, R]);
  const PL = useMemo(() => planDe(M, F), [M, F]);
  const [vistaT, setVistaT] = useState<'anual' | 'mensual'>('anual');
  const h = F.h;
  const anios = [{ l: '2026', s: 'nov-25 a dic-26', a: 0, b: 14 }, { l: '2027', a: 14, b: 26 }, { l: '2028', a: 26, b: 38 }, { l: '2029', a: 38, b: 50 }, { l: '2030', a: 50, b: 62 }];
  const sumR = (s: number[], a: number, b: number) => s.slice(a, b).reduce((x, y) => x + y, 0);
  const rows: { l: string; s: number[]; kind?: 'acum' | 'tot' | 'gap'; neg?: boolean }[] = [
    { l: 'Ingreso según P&L', s: F.det.ingresoPL },
    { l: 'Cobranza real', s: F.det.cobranza, kind: 'tot' },
    { l: '   Desarrollo cobrado', s: F.det.cobroDev },
    { l: '   Mantenimiento cobrado', s: F.det.cobroMant },
    { l: 'Ingreso aún no cobrado', s: F.det.ingresoPL.map((v, t) => v - F.det.cobranza[t]), kind: 'gap' },
    { l: 'Egresos según P&L', s: F.det.egresoPL, neg: true },
    { l: 'Pagos reales', s: F.det.pagos.map((v, t) => v + F.det.capitalCredito[t] + F.det.capex[t]), kind: 'tot', neg: true },
    { l: '   Nómina (con carga social)', s: F.det.nomina, neg: true },
    { l: '   Proveedores y gastos de terceros', s: F.det.terceros, neg: true },
    { l: '   Comisiones', s: F.det.comisiones, neg: true },
    { l: '   Impuestos e intereses', s: F.det.impuestosIntereses, neg: true },
    { l: '   CAPEX (equipos y oficinas)', s: F.det.capex, neg: true },
    { l: '   Pago de capital del crédito', s: F.det.capitalCredito, neg: true },
    { l: 'Resultado del P&L', s: F.pl.neto, kind: 'tot' },
    { l: 'Flujo de efectivo real', s: F.ciclo.neto, kind: 'tot' },
    { l: 'Acumulado P&L', s: F.pl.acum, kind: 'acum' },
    { l: 'Caja acumulada real', s: F.ciclo.acum, kind: 'acum' },
  ];
  const cols = vistaT === 'anual' ? anios.map(y => ({ l: y.l, s: y.s, a: y.a, b: y.b })) : Array.from({ length: N_MESES }, (_, t) => ({ l: mesCorto(t), s: undefined as string | undefined, a: t, b: t + 1 }));
  const val = (r: typeof rows[number], a: number, b: number) => (r.kind === 'acum' ? r.s[b - 1] : sumR(r.s, a, b));
  const fmtv = (v: number, neg?: boolean) => { const x = neg ? -v : v; return Math.abs(x) < 0.5 ? '—' : x < 0 ? `(${money(-x)})` : money(x); };
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <FineKpis items={[
        { label: 'Según P&L', sub: 'Curva J contable', value: short(F.pl.necesidad), note: `Pico en ${mesCorto(F.pl.mesPico)}` },
        { label: '+ Crédito, CAPEX y capital de trabajo', sub: `Pago de capital · CAPEX · cobro ${M.val.wc?.dso ?? 30} d · pago ${M.val.wc?.dpo ?? 30} d`, value: short(F.wc.necesidad), note: `+${short(F.plb.necesidad - F.pl.necesidad)} crédito y CAPEX, +${short(Math.max(0, F.wc.necesidad - F.plb.necesidad))} días de cartera y proveedores` },
        { label: '+ Ciclo comercial', sub: 'Necesidad máxima de caja', value: short(F.ciclo.necesidad), note: `Pico en ${mesCorto(F.ciclo.mesPico)} · ${F.ciclo.mesRecupera >= 0 ? `caja positiva desde ${mesCorto(F.ciclo.mesRecupera)}` : 'aún negativa a dic-30'}`, tone: 'neg' },
        { label: 'Equivale a', sub: 'Egreso mensual promedio 2027', value: F.mesesOperacion.toFixed(1), unit: 'meses', note: `${short(F.operacionMensual)} al mes de egreso operativo (sin capital del crédito ni CAPEX)` },
        { label: 'Capital nuevo total', sub: `Plan de disposiciones desde ${mesCorto(PL.primera)}`, value: short(PL.total), hl: 'Necesidad de nuevo capital', note: `${PL.n} disposiciones trimestrales · incluye colchón de ${short(PL.colchon)}${PL.cobertura ? ` y cobertura de ${short(PL.cobertura)}` : ''}` },
        { label: 'Participación del inversionista', sub: 'Post-money', value: pct(ratio(PL.total, R.v.equity + PL.total), 1), hl: 'Para quien mete el capital', note: `${short(PL.total)} sobre post-money de ${short(R.v.equity + PL.total)} (pre-money ${short(R.v.equity)} de Valuación)` },
      ]} />

      <Card title="¿Por qué pedimos capital de trabajo adicional?">
        <Legend items={[{ c: C.ink2, l: 'Acumulado según P&L' }, { c: FL.wc, l: '+ Crédito, CAPEX y capital de trabajo (CxC / CxP)', dash: true }, { c: FL.ciclo, l: '+ Ciclo comercial = caja real' }, { c: 'rgba(201,151,0,.35)', l: 'Caja que falta vs. P&L' }]} />
        <div style={{ marginTop: 10 }}><CashChart F={F} /></div>
      </Card>

      <PlanDisposiciones M={M} R={R} F={F} set={set} />

      <MezclaIngreso M={M} R={R} F={F} PL={PL} />

      <div className="axon-two" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.25fr)', gap: 18, alignItems: 'stretch' }}>
        <Card eyebrow="De dónde sale la cifra" title="Composición de la necesidad de caja">
          <Waterfall F={F} />
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.line2}`, display: 'grid', gap: 6, font: `300 12px/1.5 ${FONT}`, color: C.ink2 }}>
            <div>• El P&L solo explica <strong style={{ fontWeight: 600 }}>{pct(ratio(F.pl.necesidad, F.ciclo.necesidad), 0)}</strong> de la caja que realmente se necesita.</div>
            <div>• Crédito bancario de <strong style={{ fontWeight: 600 }}>{short(F.credito)}</strong> ya dispuesto: no aporta dinero nuevo y, con la prórroga, su pago de capital resta <strong style={{ fontWeight: 600 }}>{short(F.det.capitalCredito.reduce((a, b) => a + b, 0))}</strong> de caja entre 2027 y 2030.</div>
            <div>• Capital nuevo en disposiciones trimestrales: <strong style={{ fontWeight: 600, color: C.neg }}>{short(planDe(M, F).total)}</strong> desde {mesCorto(M.plan?.primera ?? PRIMERA_DEF)} (ver plan).</div>
          </div>
        </Card>
        <Card eyebrow="Un cliente nuevo" title="P&L vs. caja para un mismo cliente" sub={`Mes 0 = firma de contrato, cuando la cartera registra al cliente. Con el ciclo comercial de Supuestos: primer pago en el mes ${h.L1}, finiquito en el mes ${h.L2} y mantenimiento cobrado desde el mes ${h.Lmant + h.Ldso}.`}>
          <ClienteTipo F={F} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 16, borderTop: `1px solid ${C.line2}` }}>
            {[['Primer pago', `día ${h.diaPago1}`, mvs(h.L1)], ['Finiquito', `día ${h.diaFiniquito}`, mvs(Math.max(0, h.L2 - h.pDev2))], ['Mantenimiento', `mes ${h.mesMant} del ciclo`, mvs(Math.max(0, h.Lmant + h.Ldso - h.pMant))]].map(([l, v, n], i) => (
              <div key={l} style={{ padding: '12px 0 0', paddingLeft: i ? 14 : 0, borderLeft: i ? `1px solid ${C.line2}` : undefined }}>
                <div style={{ font: `650 9.5px ${FONT}`, letterSpacing: '.14em', textTransform: 'uppercase' }}>{l}</div>
                <div style={{ font: `250 20px ${FONT}`, marginTop: 4 }}>{v}</div>
                <div style={{ font: `300 11px ${FONT}`, color: C.neg }}>{n}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card eyebrow="Cartera de clientes" title="Quién pasa por el ciclo comercial" sub={`${F.clientes.filter(c => c.nuevo).length} clientes nuevos con ciclo comercial y ${F.clientes.filter(c => !c.nuevo).length} existentes. Toca la etiqueta para reclasificar un cliente.`} pad={false}>
        <ScrollX>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
            <thead><tr>
              <th style={{ ...thC, ...stickyL, background: C.surface, textAlign: 'left' }}>Cliente</th>
              <th style={{ ...thC, textAlign: 'left' }}>Tipo</th>
              <th style={thC}>Registro en P&L</th>
              <th style={thC}>Primer cobro</th>
              <th style={thC}>Último pago de desarrollo<span style={{ display: 'block', fontWeight: 300, letterSpacing: 0, textTransform: 'none', color: C.faint }}>P&L → caja</span></th>
              <th style={thC}>Mantenimiento desde<span style={{ display: 'block', fontWeight: 300, letterSpacing: 0, textTransform: 'none', color: C.faint }}>P&L → caja</span></th>
              <th style={thC}>Desarrollo 25–27</th>
              <th style={thC}>Mantenimiento 25–27</th>
            </tr></thead>
            <tbody>{[...F.clientes].sort((a, b) => Number(b.nuevo) - Number(a.nuevo) || a.mesPL - b.mesPL).map(c => (
              <tr key={c.i}>
                <td style={{ ...tdC, ...stickyL, textAlign: 'left', fontWeight: 400, color: C.ink }}>{c.name}</td>
                <td style={{ ...tdC, textAlign: 'left' }}>
                  <button onClick={() => set(m => { m.clients[c.i].nuevo = !c.nuevo; })} title={c.nuevo === c.auto ? 'Clasificación automática' : 'Clasificación manual'}
                    style={{ border: `1px solid ${c.nuevo ? C.yellowLine : C.line}`, background: c.nuevo ? C.yellowSoft : C.surface, color: c.nuevo ? '#8A6A00' : C.muted, borderRadius: 99, padding: '2px 10px', cursor: 'pointer', font: `${c.nuevo ? 600 : 400} 11px ${FONT}`, whiteSpace: 'nowrap' }}>
                    {c.nuevo ? 'Nuevo · con ciclo' : 'Existente'}{c.nuevo !== c.auto ? ' ·  manual' : ''}
                  </button>
                </td>
                <td style={tdC}>{mesCorto(c.mesPL)}</td>
                <td style={{ ...tdC, fontWeight: 600 }}>{mesCorto(c.mesCaja)}</td>
                {[[c.finPL, c.finCaja], [c.mantPL, c.mantCaja]].map(([a, b], k) => (
                  <td key={k} style={{ ...tdC, whiteSpace: 'nowrap' }}>{a < 0 || b < 0 ? <span style={{ color: C.faint }}>—</span> : <>
                    <span style={{ color: C.muted }}>{mesCorto(a)}</span> → <span style={{ fontWeight: 600 }}>{mesCorto(b)}</span>
                    <span style={{ marginLeft: 6, font: `400 10.5px ${FONT}`, color: b - a > 1 ? C.neg : C.faint }}>+{b - a}</span></>}</td>
                ))}
                <td style={tdC}>{money(c.dev)}</td>
                <td style={tdC}>{money(c.mant)}</td>
              </tr>
            ))}</tbody>
          </table>
        </ScrollX>
      </Card>

      <Card eyebrow="Detalle" title="P&L vs. flujo de efectivo" sub={`${M.params.aplicarInflacion ? 'MXN nominales' : 'MXN sin inflación'}. 2028–2030 se reparten en 12 meses iguales. Los negativos van entre paréntesis.`} pad={false}
        right={<Segmented value={vistaT} onChange={setVistaT} options={[{ v: 'anual', l: 'Anual' }, { v: 'mensual', l: 'Mensual · 62 meses' }]} />}>
        <ScrollX>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
            <thead><tr>
              <th style={{ ...thC, ...stickyL, background: C.surface, textAlign: 'left' }}>Concepto</th>
              {cols.map(c => <th key={c.l} style={{ ...thC, whiteSpace: 'nowrap' }}>{c.l}{c.s && <span style={{ display: 'block', fontWeight: 300, letterSpacing: 0, textTransform: 'none', color: C.faint }}>{c.s}</span>}</th>)}
            </tr></thead>
            <tbody>{rows.map(r => {
              const strong = r.kind === 'tot' || r.kind === 'acum';
              const bg = r.l === 'Caja acumulada real' ? C.yellowSoft : r.kind === 'acum' ? C.tint : undefined;
              return (
                <tr key={r.l}>
                  <td style={{ ...tdC, ...stickyL, textAlign: 'left', whiteSpace: 'pre', fontWeight: strong ? 600 : 300, color: r.kind === 'gap' ? C.neg : C.ink, fontStyle: r.kind === 'gap' ? 'italic' : undefined, background: bg ?? C.surface, borderTop: r.l === 'Resultado del P&L' || r.l === 'Acumulado P&L' ? `1px solid ${C.ink}` : undefined }}>{r.l}</td>
                  {cols.map(c => { const v = val(r, c.a, c.b); const shown = r.neg ? -v : v; return (
                    <td key={c.l} style={{ ...tdC, fontWeight: strong ? 600 : 300, color: shown < -0.5 ? C.neg : r.kind === 'gap' ? C.neg : C.ink, fontStyle: r.kind === 'gap' ? 'italic' : undefined, background: bg, borderTop: r.l === 'Resultado del P&L' || r.l === 'Acumulado P&L' ? `1px solid ${C.ink}` : undefined }}>{fmtv(v, r.neg)}</td>
                  ); })}
                </tr>
              );
            })}</tbody>
          </table>
        </ScrollX>
      </Card>

      <Card eyebrow="Metodología" title="Cómo se calcula">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10 }}>
          {[
            ['Base', 'P&L mensual del modelo: meses de nov-25 a dic-27 y años 2028–2030 repartidos en 12 meses iguales. Incluye carga social, incrementos e inflación de Supuestos.'],
            ['Clientes', `Cliente por cliente desde la Cartera de Clientes. Existentes (con ingresos en 2026): cobran como en el P&L más ${M.val.wc?.dso ?? 30} días de cartera. Nuevos (primer ingreso en 2027): pasan por el ciclo comercial desde su firma, que es el mes en que la cartera los registra.`],
            ['Desarrollo de clientes nuevos', `Se cobra 50% en la firma + ${h.L1} meses (PAGO 50%, día ${h.diaPago1} del ciclo) y 50% en la firma + ${h.L2} meses (PAGO FINIQUITO, día ${h.diaFiniquito}). Las comisiones se pagan cuando el cliente paga.`],
            ['Mantenimiento de clientes nuevos', `Se factura desde la firma + ${h.Lmant} meses (mes ${h.mesMant} del ciclo) y se cobra ${h.Ldso} mes después. Si el cliente no tiene desarrollo, se cobra desde el mes del primer pago (firma + ${h.L1}).`],
            ['2028–2030', `Todo el desarrollo son proyectos nuevos con ciclo comercial. Cada cliente sigue pagando su mantenimiento de dic-27; el mantenimiento adicional son clientes nuevos y se factura ${Math.max(0, h.Lmant - h.pMant)} meses después que en el P&L, más ${h.Ldso} mes de cobranza. Los meses se redondean al más cercano (30.5 días).`],
            ['Egresos', `Nómina (sueldo + carga social), impuestos e intereses se pagan en el mes. El crédito bancario ya se dispuso: no entra dinero, y su capital se paga cada mes desde ene-27 por la prórroga. El CAPEX sale de caja en el mes de compra; la D&A no es salida de efectivo. La PTU se paga en mayo del año siguiente. El ISR se paga en el mes en que se devenga. Proveedores y gastos de terceros (costos directos sin nómina, gasto operativo, marketing, otros) se pagan a ${M.val.wc?.dpo ?? 30} días.`],
            ['Necesidad de caja', 'El punto más bajo de la caja acumulada: es el capital que hay que tener disponible para operar sin quedarse sin efectivo. Se compara contra el egreso mensual promedio de 2027.'],
          ].map(([t, d]) => (
            <div key={t} style={{ padding: '12px 14px', borderRadius: 0, background: C.tint, border: `1px solid ${C.line2}` }}>
              <div style={{ font: `600 9.5px ${FONT}`, letterSpacing: '.14em', textTransform: 'uppercase', color: C.gold }}>{t}</div>
              <div style={{ font: `300 12px/1.55 ${FONT}`, color: C.ink2, marginTop: 5 }}>{d}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ===================== Módulo: Costos =====================
const COST_ROWS: RowDef[] = [
  { k: 'venta', l: 'Total venta', t: 'total' },
  { l: 'Costos directos', t: 'sec' },
  { k: 'ia', l: 'Consumo IA' }, { k: 'repos', l: 'Repositorios' }, { k: 'host', l: 'Hostings' }, { k: 'plat', l: 'Plataformas (TC)' }, { k: 'comis', l: 'Comisiones' }, { k: 'personal', l: 'Personal directo' },
  { k: 'costos', l: 'Total costos', t: 'total' }, { l: '% costo / venta', t: 'pct', num: 'costos', den: 'venta' },
  { k: 'ub', l: 'Utilidad bruta', t: 'total' }, { l: 'Margen bruto', t: 'pct', num: 'ub', den: 'venta' },
];
function Costos({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const A = R.annual;
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <FineKpis items={[
        { label: 'Costos directos', sub: 'Años 1–5', value: short(sum5(A.costos)), note: `${pct(ratio(sum5(A.costos), sum5(A.venta)))} de la venta` },
        { label: 'Personal directo', sub: '2030', value: short(A.personal[4]), note: `${pct(ratio(A.personal[4], A.costos[4]))} del costo directo` },
        { label: 'Equipo directo', sub: '2027 → 2030', value: `${hcAdm(M, 1, true)} → ${hcAdm(M, 4, true)}`, unit: 'personas' },
        { label: 'Margen bruto', sub: '2030', value: pct(ratio(A.ub[4], A.venta[4])), note: `Utilidad bruta ${short(A.ub[4])}` },
      ]} />
      <Card eyebrow="P&L" title="Costos directos por año" sub={M.params.aplicarInflacion ? 'MXN nominales' : 'MXN sin inflación'} pad={false}>
        <ScrollX><PLTable fine compact cols={YEARS} data={A} rows={COST_ROWS} acum={R.acumY} /></ScrollX>
      </Card>
      <PlantillaTable M={M} R={R} set={set} directo eyebrow="Costo directo" title="Personal directo · plantilla"
        sub="Equipo que implementa y opera las soluciones con cada cliente. Su nómina es costo directo: plantilla × sueldo mensual (+ carga social), con inflación desde 2028 si está activa." />
    </div>
  );
}

// ===================== Módulo: Supuestos =====================
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const mesLabel = (i: number) => `${MESES[i % 12]} ${2027 + Math.floor(i / 12)}`;

function Slider({ value, min, max, step, onChange, label }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string }) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <input type="range" className="axon-range" aria-label={label} min={min} max={max} step={step} value={value}
      onChange={e => onChange(+e.target.value)}
      style={{ background: `linear-gradient(90deg, ${C.yellow} ${p}%, ${C.line} ${p}%)` }} />
  );
}

type IncCfg = { incK: 'precioInc' | 'sueldoInc'; desdeK: 'precioDesde' | 'sueldoDesde'; eyebrow: string; title: string; sub: string; max: number };
const INC_PRECIO: IncCfg = { incK: 'precioInc', desdeK: 'precioDesde', eyebrow: 'Precios', title: 'Incremento de precios', sub: 'Aumento sobre el precio del desarrollo inicial a partir del mes que elijas; las mensualidades de mantenimiento no llevan este incremento (solo inflación). Se suma al aumento anual de precio de la tabla Crecimiento 2028–2030.', max: 30 };
const INC_SUELDO: IncCfg = { incK: 'sueldoInc', desdeK: 'sueldoDesde', eyebrow: 'Sueldos', title: 'Incremento de sueldos', sub: 'Aumento sobre la nómina de todos los puestos (administrativos y personal directo, con su carga social) a partir del mes que elijas. Se refleja en el P&L.', max: 30 };

// Crecimiento 2028–2030 (volumen y precio del desarrollo inicial): se captura en Supuestos y alimenta Valuación
function CrecimientoCard({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const row = (k: 'volMeta' | 'precioMeta') => M.val[k].map((x, i) => <td key={i} style={tdBase}><NumInput kind="pct" width={70} value={x} onChange={nv => set(m => { m.val[k][i] = nv; })} /></td>);
  return (
    <Card eyebrow="Crecimiento" title="Crecimiento 2028–2030" sub="Crecimiento de volumen de clientes y aumento de precio del desarrollo inicial (adicional a la inflación). Alimenta el P&L y la Valuación." pad={false}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
        <thead><tr><th style={{ ...th, textAlign: 'left' }}>Supuesto</th>{['2028', '2029', '2030'].map(y => <th key={y} style={th}>{y}</th>)}</tr></thead>
        <tbody>
          <tr><td style={{ ...tdBase, textAlign: 'left' }}>Crecimiento de volumen</td>{row('volMeta')}</tr>
          <tr><td style={{ ...tdBase, textAlign: 'left' }}>Aumento de precio del desarrollo inicial<span style={{ display: 'block', font: `300 10.5px ${FONT}`, color: C.faint }}>No aplica a las mensualidades</span></td>{row('precioMeta')}</tr>
          <tr><td style={{ ...tdBase, textAlign: 'left', fontWeight: 650, color: C.ink, background: C.tint }}>Ventas proyectadas</td>{[2, 3, 4].map(i => <td key={i} style={{ ...tdBase, fontWeight: 650, color: C.ink, background: C.tint }}>{short(R.annual.venta[i])}</td>)}</tr>
        </tbody>
      </table>
    </Card>
  );
}

function IncrementoCard({ M, R, set, cfg }: { M: Model; R: Result; set: (f: (m: Model) => void) => void; cfg: IncCfg }) {
  const inc = M.params[cfg.incK] ?? 0, desde = M.params[cfg.desdeK] ?? 0;
  const R0 = useMemo(() => compute({ ...M, params: { ...M.params, [cfg.incK]: 0 } }), [M, cfg.incK]);
  const dVentas = sum5(R.annual.venta) - sum5(R0.annual.venta);
  const dUn = sum5(R.annual.un) - sum5(R0.annual.un);
  const dVal = R.v.equity - R0.v.equity;
  const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + short(Math.abs(v));
  const big = { font: `200 40px/1 ${FONT}`, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums' as const, color: C.ink };
  const lab = { font: `650 10px ${FONT}`, textTransform: 'uppercase' as const, letterSpacing: '.16em', color: C.ink };
  return (
    <Card eyebrow={cfg.eyebrow} title={cfg.title} sub={cfg.sub}>
      <div className="axon-two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 36 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={lab}>Incremento</span>
            <span style={big}>{inc > 0 ? '+' : ''}{(inc * 100).toFixed(0)}<span style={{ font: `300 18px ${FONT}`, color: C.muted, marginLeft: 2 }}>%</span></span>
          </div>
          <div style={{ marginTop: 16 }}><Slider label={cfg.title} value={Math.round(inc * 100)} min={0} max={cfg.max} step={1} onChange={v => set(m => { m.params[cfg.incK] = v / 100; })} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', font: `300 10px ${FONT}`, color: C.faint, marginTop: 6 }}>{[0, 1, 2, 3, 4, 5, 6].map(k => Math.round(cfg.max * k / 6)).map(t => <span key={t}>{t}%</span>)}</div>
        </div>
        <div style={{ opacity: inc ? 1 : .45, transition: 'opacity .2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <span style={lab}>A partir de</span>
            <span style={{ ...big, fontSize: 30, whiteSpace: 'nowrap' }}>{mesLabel(desde)}</span>
          </div>
          <div style={{ marginTop: 22 }}><Slider label={`Mes de inicio · ${cfg.title}`} value={desde} min={0} max={47} step={1} onChange={v => set(m => { m.params[cfg.desdeK] = v; })} /></div>
          <div style={{ position: 'relative', height: 14, font: `300 10px ${FONT}`, color: C.faint, marginTop: 6 }}>
            {[2027, 2028, 2029, 2030].map((y, k) => <span key={y} style={{ position: 'absolute', left: `${(k * 12 / 47) * 100}%`, transform: k ? 'translateX(-50%)' : undefined }}>{y}</span>)}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 26, borderTop: `1px solid ${C.line2}` }}>
        {[
          cfg.incK === 'sueldoInc'
            ? { l: 'Nómina', s: 'Años 1–5', v: sum5(R.annual.ga) + sum5(R.annual.personal) - sum5(R0.annual.ga) - sum5(R0.annual.personal), costo: true }
            : { l: 'Ventas', s: 'Años 1–5', v: dVentas },
          { l: 'Utilidad neta', s: 'Años 1–5', v: dUn },
          { l: 'Valuación', s: 'Valor del capital', v: dVal },
        ].map((k, i) => (
          <div key={k.l} style={{ padding: '16px 0 0', paddingLeft: i ? 18 : 0, borderLeft: i ? `1px solid ${C.line2}` : undefined }}>
            <div style={lab}>{k.l} <span style={{ fontWeight: 300, color: C.faint, letterSpacing: '.12em' }}>· {k.s}</span></div>
            <div style={{ font: `250 24px ${FONT}`, marginTop: 6, color: Math.abs(k.v) < 1 ? C.faint : ('costo' in k && k.costo ? -k.v : k.v) > 0 ? C.pos : C.neg, fontVariantNumeric: 'tabular-nums' }}>{inc ? sign(k.v) : '—'}</div>
            <div style={{ font: `300 11px ${FONT}`, color: C.faint }}>vs. sin incremento</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ChurnCard({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const ch = M.params.churn ?? 0;
  const R0 = useMemo(() => compute({ ...M, params: { ...M.params, churn: 0 } }), [M]);
  const dMant = sum5(R.annual.mant) - sum5(R0.annual.mant);
  const dUn = sum5(R.annual.un) - sum5(R0.annual.un);
  const dVal = R.v.equity - R0.v.equity;
  const lab = { font: `650 10px ${FONT}`, textTransform: 'uppercase' as const, letterSpacing: '.16em', color: C.ink };
  const sign = (v: number) => (Math.abs(v) < 1 ? '—' : (v > 0 ? '+' : '−') + short(Math.abs(v)));
  return (
    <Card eyebrow="Retención" title="Pérdida de clientes (churn rate)" sub="% de clientes que no renuevan su contrato anual de mantenimiento. La mensualidad es fija durante el año; la pérdida se aplica en cada renovación, desde 2028. Solo afecta los ingresos por mantenimiento; el desarrollo no cambia.">
      <div className="axon-two" style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 36, alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={lab}>Churn anual</span>
            <span style={{ font: `200 40px/1 ${FONT}`, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums' }}>{(ch * 100).toFixed(0)}<span style={{ font: `300 18px ${FONT}`, color: C.muted, marginLeft: 2 }}>%</span></span>
          </div>
          <div style={{ marginTop: 16 }}><Slider label="Churn anual" value={Math.round(ch * 100)} min={0} max={30} step={1} onChange={v => set(m => { m.params.churn = v / 100; })} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', font: `300 10px ${FONT}`, color: C.faint, marginTop: 6 }}>{[0, 5, 10, 15, 20, 25, 30].map(t => <span key={t}>{t}%</span>)}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, background: C.tint, border: `1px solid ${C.line2}`, borderRadius: 0 }}>
          {[['Renovación', ch ? `${((1 - ch) * 100).toFixed(0)}%` : '100%', 'de los contratos cada año'], ['Vida promedio', ch ? `${(1 / ch).toFixed(1)} años` : '∞', 'de un cliente (1 ÷ churn)']].map(([l, v, n], i) => (
            <div key={l} style={{ padding: '14px 16px', borderLeft: i ? `1px solid ${C.line2}` : undefined }}>
              <div style={lab}>{l}</div>
              <div style={{ font: `250 22px ${FONT}`, marginTop: 6 }}>{v}</div>
              <div style={{ font: `300 11px ${FONT}`, color: C.faint }}>{n}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 22, borderTop: `1px solid ${C.line2}` }}>
        {[['Mantenimiento', 'Años 1–5', dMant], ['Utilidad neta', 'Años 1–5', dUn], ['Valuación', 'Valor del capital', dVal]].map(([l, sb, v], i) => (
          <div key={l as string} style={{ padding: '16px 0 0', paddingLeft: i ? 18 : 0, borderLeft: i ? `1px solid ${C.line2}` : undefined }}>
            <div style={lab}>{l as string} <span style={{ fontWeight: 300, color: C.faint, letterSpacing: '.12em' }}>· {sb as string}</span></div>
            <div style={{ font: `250 24px ${FONT}`, marginTop: 6, color: Math.abs(v as number) < 1 ? C.faint : (v as number) < 0 ? C.neg : C.pos, fontVariantNumeric: 'tabular-nums' }}>{sign(v as number)}</div>
            <div style={{ font: `300 11px ${FONT}`, color: C.faint }}>vs. sin churn</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const CARGA_OPC = [0.28, 0.29, 0.30, 0.31, 0.32, 0.33, 0.34, 0.35];
function CargaCard({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const carga = M.params.cargaSocial ?? 0;
  const idx = Math.min(CARGA_OPC.length - 1, Math.max(0, Math.round(carga * 100) - 28));
  const R0 = useMemo(() => compute({ ...M, params: { ...M.params, cargaSocial: 0 } }), [M]);
  const nom = (X: Result) => X.gastos.adminTot[4] + X.gastos.dirTot[4];
  const [sel, setSel] = useState(() => Math.max(0, M.admin.findIndex(r => r.directo)));
  const pz = M.admin[sel] ?? M.admin[0];
  const ej = pz?.sal ?? 0;
  const mx = (v: number) => (Math.abs(v) < 0.5 ? '—' : '$' + money(v));
  const lab = { font: `650 10px ${FONT}`, textTransform: 'uppercase' as const, letterSpacing: '.16em', color: C.ink };
  const row = (l: string, v: string, strong?: boolean) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: strong ? `1px solid ${C.ink}` : undefined, marginTop: strong ? 4 : 0 }}>
      <span style={{ font: `${strong ? 600 : 300} 12.5px ${FONT}`, color: strong ? C.ink : C.ink2 }}>{l}</span>
      <span style={{ font: `${strong ? 600 : 300} 12.5px ${FONT}`, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
  return (
    <Card eyebrow="Nómina" title="Carga social patronal" sub="Se suma al sueldo de todos los puestos (administrativos y personal directo) de 2027 en adelante: IMSS, INFONAVIT, SAR, ISN, aguinaldo y prima vacacional.">
      <div className="axon-two" style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 36, alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={lab}>Carga presupuestada</span>
            <span style={{ font: `200 40px/1 ${FONT}`, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums' }}>{(carga * 100).toFixed(0)}<span style={{ font: `300 18px ${FONT}`, color: C.muted, marginLeft: 2 }}>%</span></span>
          </div>
          <div style={{ marginTop: 16 }}><Slider label="Carga social patronal" value={idx} min={0} max={CARGA_OPC.length - 1} step={1} onChange={v => set(m => { m.params.cargaSocial = CARGA_OPC[v]; })} /></div>
          <div style={{ position: 'relative', height: 26, marginTop: 6 }}>
            {CARGA_OPC.map((o, k) => {
              const on = k === idx;
              return (
                <button key={o} onClick={() => set(m => { m.params.cargaSocial = o; })}
                  style={{ position: 'absolute', left: `${(k / (CARGA_OPC.length - 1)) * 100}%`, transform: k === 0 ? 'none' : k === CARGA_OPC.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)', border: 0, background: 'transparent', padding: '2px 0', cursor: 'pointer', font: `${on ? 600 : 300} 11px ${FONT}`, color: on ? C.ink : C.faint, whiteSpace: 'nowrap' }}>
                  {`${Math.round(o * 100)}%`}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', marginTop: 18, borderTop: `1px solid ${C.line2}` }}>
            <div style={{ paddingTop: 14 }}>
              <div style={lab}>Nómina mensual <span style={{ fontWeight: 300, color: C.faint }}>· 2030</span></div>
              <div style={{ font: `250 24px ${FONT}`, marginTop: 6 }}>{short(nom(R))}</div>
              <div style={{ font: `300 11px ${FONT}`, color: C.faint }}>{carga ? `${short(nom(R0))} sin carga` : 'Solo sueldos'}</div>
            </div>
            <div style={{ paddingTop: 14, paddingLeft: 18, borderLeft: `1px solid ${C.line2}` }}>
              <div style={lab}>Valuación</div>
              <div style={{ font: `250 24px ${FONT}`, marginTop: 6, color: carga ? C.neg : C.faint }}>{carga ? '−' + short(Math.abs(R.v.equity - R0.v.equity)) : '—'}</div>
              <div style={{ font: `300 11px ${FONT}`, color: C.faint }}>vs. sin carga social</div>
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 12px', marginTop: 18, borderRadius: 0, background: C.surface, border: `1px solid ${C.line}`, transition: 'all .15s' }}>
            <input type="checkbox" checked={!!M.params.aplicarPTU} onChange={e => set(m => { m.params.aplicarPTU = e.target.checked; m.params.ptu = 0; })}
              style={{ width: 16, height: 16, margin: '1px 0 0', accentColor: C.ink, cursor: 'pointer', flex: 'none' }} />
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', font: `650 10.5px ${FONT}`, letterSpacing: '.14em', textTransform: 'uppercase', color: C.ink }}>Aplicar PTU (10%)</span>
              <span style={{ display: 'block', font: `300 11.5px/1.45 ${FONT}`, color: C.muted, marginTop: 3 }}>10% de la utilidad antes de impuestos, con tope de 3 meses de sueldo. Se suma a la nómina, es deducible de ISR y se paga en mayo del año siguiente.</span>
              {M.params.aplicarPTU && (
                <span style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginTop: 10 }}>
                  {R.ptu.map((v, i) => (
                    <span key={i}><span style={{ display: 'block', font: `600 9.5px ${FONT}`, letterSpacing: '.1em', color: C.faint }}>{YEARS_S[i]}</span><span style={{ display: 'block', font: `400 12px ${FONT}`, color: v ? C.ink : C.faint, fontVariantNumeric: 'tabular-nums' }}>{v ? short(v) : '—'}</span></span>
                  ))}
                </span>
              )}
            </span>
          </label>
        </div>
        <div style={{ background: C.tint, border: `1px solid ${C.line2}`, borderRadius: 0, padding: '14px 16px' }}>
          <div style={{ ...lab, marginBottom: 8 }}>Ejemplo por puesto</div>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <select value={sel} onChange={e => setSel(+e.target.value)} aria-label="Puesto"
              style={{ width: '100%', appearance: 'none', WebkitAppearance: 'none', border: `1px solid ${C.yellowLine}`, background: C.yellowSoft, borderRadius: 8, padding: '8px 34px 8px 10px', font: `500 12.5px ${FONT}`, color: C.ink, cursor: 'pointer' }}>
              {[true, false].map(dir => (
                <optgroup key={String(dir)} label={dir ? 'Costos · personal directo' : 'Gastos · administrativos'}>
                  {M.admin.map((r, i) => !!r.directo !== dir ? null : <option key={i} value={i}>{r.name} — ${money(r.sal)}</option>)}
                </optgroup>
              ))}
            </select>
            <span style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 28, display: 'grid', placeItems: 'center', borderLeft: `1px solid ${C.yellowLine}`, pointerEvents: 'none', color: C.ink2, fontSize: 10 }}>▼</span>
          </div>
          <div style={{ font: `300 11px ${FONT}`, color: C.faint, marginBottom: 4 }}>{pz?.directo ? 'Costo directo' : 'Gasto administrativo'}</div>
          {row('Sueldo bruto mensual', mx(ej))}
          {row(`Carga adicional (${(carga * 100).toFixed(0)}%)`, mx(ej * carga))}
          {row('Costo total mensual', mx(ej * (1 + carga)), true)}
          {row('Costo total anual', mx(ej * (1 + carga) * 12))}
        </div>
      </div>
    </Card>
  );
}

const CICLO_DEF = [{"etapa": "ANÁLISIS DE MANAGEMENT Y PROCESOS / NDA", "dias": 30}, {"etapa": "PRIMERA MAQUETA", "dias": 30}, {"etapa": "AJUSTES A LA ARQUITECTURA (MAQUETAS)", "dias": 30}, {"etapa": "CIERRE, FIRMA DE CONTRATO Y ALTA COMO PROVEEDOR", "dias": 30}, {"etapa": "COMIENZO DESARROLLO Y FACTURACIÓN 50%", "dias": 15}, {"etapa": "PAGO 50%", "dias": 30}, {"etapa": "ENTREGA FINAL / GO-LIVE Y FACTURACIÓN 50%", "dias": 60}, {"etapa": "PAGO FINIQUITO 50%", "dias": 30}];
const esPago = (n: string) => /^PAGO/i.test(n.trim());
const mesMantenimiento = (total: number) => Math.floor(total / 30.5) + 1;
function CicloCard({ M, set }: { M: Model; set: (f: (m: Model) => void) => void }) {
  const et = cicloConDso(M.ciclo ?? CICLO_DEF, M.val.wc?.dso ?? 30);
  const total = et.reduce((s, e) => s + e.dias, 0);
  const iPago = et.findIndex(e => esPago(e.etapa));
  const diaPago = iPago >= 0 ? et.slice(0, iPago + 1).reduce((s, e) => s + e.dias, 0) : total;
  const mesMant = mesMantenimiento(total);
  const tono = (k: number) => lerpHex('#FDF3C8', '#C99700', et.length > 1 ? k / (et.length - 1) : 0);
  const upd = (i: number, f: (e: { etapa: string; dias: number }) => void) => set(m => { m.ciclo = (m.ciclo ?? CICLO_DEF).map(x => ({ ...x })); f(m.ciclo[i]); });
  const lab = { font: `650 10px ${FONT}`, textTransform: 'uppercase' as const, letterSpacing: '.16em', color: C.ink };
  const big = { font: `200 46px/1 ${FONT}`, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' as const, marginTop: 6 };
  const tick = Math.max(30, Math.ceil(total / 10 / 30) * 30);
  const fixedRow = (color: string, nombre: string, tramo: string, valor: React.ReactNode, strong?: boolean) => (
    <div style={{ display: 'grid', gridTemplateColumns: '14px minmax(0, 1fr) 120px 84px', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: `1px solid ${C.line2}`, background: strong ? C.tint : undefined }}>
      <span style={{ width: 10, height: 10, borderRadius: 99, background: color, border: `1px solid ${C.ink}` }} />
      <span style={{ font: `600 12.5px ${FONT}`, color: C.ink, letterSpacing: '.02em' }}>{nombre}</span>
      <span style={{ font: `300 11.5px ${FONT}`, color: C.faint, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{tramo}</span>
      <span style={{ justifySelf: 'end', paddingRight: 10, font: `600 13px ${FONT}`, color: C.ink, whiteSpace: 'nowrap' }}>{valor}</span>
    </div>
  );
  let acc = 0;
  return (
    <Card eyebrow="Ciclo comercial" title="Días que pasan del primer contacto al primer pago" sub="Vender IA avanzada a la dirección de empresas medianas y grandes pasa por análisis, maquetas, ajustes de arquitectura y un alta formal como proveedor. Este ciclo explica por qué el ingreso llega meses después de la inversión comercial.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 0, marginBottom: 22, borderTop: `1px solid ${C.line2}`, borderBottom: `1px solid ${C.line2}` }}>
        {[
          ['Primer pago', diaPago, `≈ ${(diaPago / 30.5).toFixed(1)} meses del primer contacto`],
          ['Ciclo completo', total, 'Hasta el pago del finiquito'],
          ['Mantenimiento', null, `Arranca en el mes ${mesMant} (${total} días ÷ 30.5)`],
        ].map(([l, v, n], k) => (
          <div key={l as string} style={{ padding: '16px 18px 14px', paddingLeft: k ? 18 : 0, borderLeft: k ? `1px solid ${C.line2}` : undefined }}>
            <div style={lab}>{l as string}</div>
            <div style={big}>{v === null ? <>Mes {mesMant}</> : <>{v as number}<span style={{ font: `300 15px ${FONT}`, color: C.muted, marginLeft: 6 }}>días</span></>}</div>
            <div style={{ font: `300 11.5px ${FONT}`, color: C.muted, marginTop: 6 }}>{n as string}</div>
          </div>
        ))}
      </div>

      {/* línea de tiempo */}
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', height: 30, borderRadius: 9, overflow: 'hidden', border: `1px solid ${C.line}` }}>
          {et.map((e, k) => (
            <div key={k} title={`${e.etapa}: ${e.dias} días`} style={{ width: `${total ? (e.dias / total) * 100 : 0}%`, background: tono(k), borderRight: k < et.length - 1 ? '1px solid #fff' : undefined, display: 'grid', placeItems: 'center', font: `${esPago(e.etapa) ? 650 : 400} 10.5px ${FONT}`, color: k >= et.length * 0.6 ? '#fff' : C.ink2, overflow: 'hidden', whiteSpace: 'nowrap', transition: 'width .25s' }}>
              {total && e.dias / total > 0.045 ? (esPago(e.etapa) ? `$ ${e.dias}` : e.dias) : ''}
            </div>
          ))}
        </div>
        {total > 0 && <span title="Primer pago" style={{ position: 'absolute', top: -6, bottom: -6, left: `${(diaPago / total) * 100}%`, borderLeft: `1.5px solid ${C.ink}` }} />}
      </div>
      <div style={{ position: 'relative', height: 16, marginTop: 6, font: `300 10px ${FONT}`, color: C.faint }}>
        {Array.from({ length: Math.floor(total / tick) + 1 }, (_, i) => i * tick).map(d => (
          <span key={d} style={{ position: 'absolute', left: `${(d / total) * 100}%`, transform: d ? 'translateX(-50%)' : undefined }}>{d ? `${d}d` : 'Día 0'}</span>
        ))}
      </div>

      <div style={{ marginTop: 18, borderTop: `1px solid ${C.ink}` }}>
        {fixedRow(C.surface, 'PRIMER CONTACTO', 'día 0', 'Día 0')}
        {et.map((e, k) => {
          const ini = acc; acc += e.dias;
          const pago = esPago(e.etapa);
          return (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '14px minmax(0, 1fr) 120px 84px', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: `1px solid ${C.line2}` }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: tono(k), border: `1px solid ${C.line}` }} />
              <input value={e.etapa} onChange={ev => upd(k, x => { x.etapa = ev.target.value; })} style={{ border: 0, outline: 'none', background: 'transparent', font: `${pago ? 600 : 300} 12.5px ${FONT}`, color: pago ? C.gold : C.ink, letterSpacing: '.02em', minWidth: 0 }} />
              <span style={{ font: `300 11.5px ${FONT}`, color: C.faint, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>día {ini} → <span style={{ color: C.ink2 }}>{acc}</span></span>
              <span style={{ justifySelf: 'end' }}>{pago
                ? <span title="Se alimenta de los días de cartera (DSO) en Capital de trabajo" style={{ display: 'inline-block', width: 64, textAlign: 'right', padding: '4px 7px', font: `400 13px ${FONT}`, fontVariantNumeric: 'tabular-nums', color: C.ink }}>{e.dias}<span style={{ display: 'block', font: `300 9.5px ${FONT}`, color: C.faint }}>= DSO</span></span>
                : <NumInput kind="num" value={e.dias} width={64} onChange={v => upd(k, x => { x.dias = Math.max(0, Math.round(v)); })} />}</span>
            </div>
          );
        })}
        {fixedRow(C.ink, 'COMIENZA ADMINISTRACIÓN Y MANTENIMIENTO', `${total} días ÷ 30.5`, `Mes ${mesMant}`, true)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 18 }}>
        {[
          ['Lo que implica', `Un cliente que se contacta hoy hace su primer pago en el día ${diaPago} (~${Math.round(diaPago / 30.5)} ${Math.round(diaPago / 30.5) === 1 ? 'mes' : 'meses'}). El equipo comercial debe generar oportunidades con ${Math.ceil(diaPago / 30.5 / 3)} ${Math.ceil(diaPago / 30.5 / 3) === 1 ? 'trimestre' : 'trimestres'} de anticipación.`],
          ['Para la caja', `Durante ${diaPago} días se paga nómina, maquetas, marketing y preventa sin ingreso de ese cliente: es parte de la curva J y de la necesidad de capital.`],
          ['Para el inversionista', `El ciclo es largo, pero desde el mes ${mesMant} el cliente paga administración y mantenimiento de forma recurrente, un ingreso difícil de reemplazar.`],
        ].map(([t, d]) => (
          <div key={t} style={{ padding: '12px 14px', borderRadius: 0, background: C.tint, border: `1px solid ${C.line2}` }}>
            <div style={{ font: `600 9.5px ${FONT}`, letterSpacing: '.14em', textTransform: 'uppercase', color: C.gold }}>{t}</div>
            <div style={{ font: `300 12px/1.5 ${FONT}`, color: C.ink2, marginTop: 5 }}>{d}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const CAPEX_DEF = { equipos: { cantidad: 0, precio: 25000, mes: 14, anios: 3, porPersona: true as boolean | undefined }, oficinas: { monto: 500000, mes: 20, anios: 5 } };
function MesSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select value={value} onChange={e => onChange(+e.target.value)}
      style={{ border: `1px solid ${C.yellowLine}`, background: C.yellowSoft, borderRadius: 8, padding: '5px 8px', font: `400 12.5px ${FONT}`, color: C.ink, cursor: 'pointer' }}>
      {Array.from({ length: 62 }, (_, t) => t).filter(t => t >= 2).map(t => <option key={t} value={t}>{mesCorto(t)}</option>)}
    </select>
  );
}
function CapexCard({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const cx = M.capex ?? CAPEX_DEF;
  const upd = (f: (c: typeof CAPEX_DEF) => void) => set(m => { const c = JSON.parse(JSON.stringify(m.capex ?? CAPEX_DEF)); f(c); m.capex = c; });
  const eqTot = cx.equipos.porPersona ? R.capexPlan.equiposNuevos.reduce((a, b) => a + b, 0) * cx.equipos.precio : cx.equipos.cantidad * cx.equipos.precio;
  const P = R.capexPlan;
  const lab = { font: `650 10px ${FONT}`, textTransform: 'uppercase' as const, letterSpacing: '.16em', color: C.ink };
  const small = { font: `300 10.5px ${FONT}`, color: C.faint, marginBottom: 4 };
  const fld = (l: string, el: React.ReactNode) => <div><div style={small}>{l}</div>{el}</div>;
  const rubro = (titulo: string, nota: string, total: number, campos: React.ReactNode, anios: number, setAnios: (v: number) => void, tipo: string) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 0, border: `1px solid ${C.line2}`, borderRadius: 0, overflow: 'hidden' }} className="axon-two">
      <div style={{ padding: '14px 16px' }}>
        <div style={lab}>{titulo}</div>
        <div style={{ font: `300 11px ${FONT}`, color: C.faint, margin: '3px 0 12px' }}>{nota}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
          {campos}
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}><div style={small}>Inversión</div><div style={{ font: `250 22px ${FONT}`, fontVariantNumeric: 'tabular-nums' }}>${money(total)}</div></div>
        </div>
      </div>
      <div style={{ padding: '14px 16px', background: C.tint, borderLeft: `1px solid ${C.line2}` }}>
        <div style={lab}>{tipo}</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginTop: 15 }}>
          {fld('Años', <NumInput kind="num" value={anios} width={64} onChange={v => setAnios(Math.max(0.5, v))} />)}
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={small}>Por mes · por año</div>
            <div style={{ font: `400 13px ${FONT}`, fontVariantNumeric: 'tabular-nums' }}>${money(total / Math.max(1, anios * 12))} · <strong style={{ fontWeight: 600 }}>${money(total / Math.max(0.5, anios))}</strong></div>
          </div>
        </div>
      </div>
    </div>
  );
  return (
    <Card eyebrow="Inversión" title="CAPEX" sub="No es gasto del P&L: sale de caja en el mes de compra y se reconoce como D&A en línea recta durante los años que indiques. La D&A baja la utilidad de operación y el ISR, pero no el EBITDA.">
      <div style={{ display: 'grid', gap: 12 }}>
        {rubro('Equipos de cómputo', 'Un equipo por cada persona que se integra a la plantilla, comprado en enero de su año', eqTot, <>
          {fld('Precio por equipo', <NumInput value={cx.equipos.precio} width={96} onChange={v => upd(c => { c.equipos.precio = Math.max(0, v); c.equipos.porPersona = true; })} />)}
          {fld('Personas que se integran', <span style={{ display: 'flex', gap: 10, font: `400 12.5px ${FONT}`, fontVariantNumeric: 'tabular-nums', paddingBottom: 6 }}>
            {[1, 2, 3, 4].map(y => <span key={y}><span style={{ color: C.faint, marginRight: 4 }}>{YEARS_S[y]}</span><strong style={{ fontWeight: 600 }}>{R.capexPlan.equiposNuevos[y]}</strong></span>)}
          </span>)}
        </>, cx.equipos.anios, v => upd(c => { c.equipos.anios = v; }), 'Depreciación')}
        {rubro('Adaptación de nuevas oficinas', 'Obra, mobiliario e instalaciones', cx.oficinas.monto, <>
          {fld('Monto', <NumInput value={cx.oficinas.monto} width={110} onChange={v => upd(c => { c.oficinas.monto = Math.max(0, v); })} />)}
          {fld('Mes / año', <MesSelect value={cx.oficinas.mes} onChange={v => upd(c => { c.oficinas.mes = v; })} />)}
        </>, cx.oficinas.anios, v => upd(c => { c.oficinas.anios = v; }), 'Amortización')}
      </div>
      <div style={{ marginTop: 16, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', font: `300 12.5px ${FONT}`, fontVariantNumeric: 'tabular-nums' }}>
          <thead><tr>{['', ...YEARS_S].map(y => <th key={y} style={{ textAlign: y ? 'right' : 'left', padding: '6px 10px', borderBottom: `1px solid ${C.ink}`, font: `650 10px ${FONT}`, letterSpacing: '.14em', color: C.ink }}>{y}</th>)}</tr></thead>
          <tbody>
            {[['Inversión CAPEX (salida de caja)', P.inversionAnual, false], ['D&A en el P&L', P.daAnual, false], ['Valor en libros al cierre', P.inversionAnual.map((_, i) => P.inversionAnual.slice(0, i + 1).reduce((a, b) => a + b, 0) - P.daAnual.slice(0, i + 1).reduce((a, b) => a + b, 0)), true]].map(([l, a, b]) => (
              <tr key={l as string}>
                <td style={{ padding: '7px 10px', borderBottom: `1px solid ${C.line2}`, fontWeight: b ? 600 : 300 }}>{l as string}</td>
                {(a as number[]).map((v, i) => <td key={i} style={{ padding: '7px 10px', textAlign: 'right', borderBottom: `1px solid ${C.line2}`, fontWeight: b ? 600 : 300 }}>{money(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const WC_DEF = { dso: 30, credito: 1, dio: 0, dpo: 30, base: 360 };
function CapitalTrabajoCard({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const w = M.val.wc ?? WC_DEF;
  const upd = (k: keyof typeof WC_DEF, v: number) => set(m => { m.val.wc = { ...(m.val.wc ?? WC_DEF), [k]: v }; });
  const ccc = w.dso + w.dio - w.dpo;
  const W = R.v.wc;
  const field = (l: string, sub: string, k: keyof typeof WC_DEF, kind: 'num' | 'pct' = 'num') => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: `1px solid ${C.line2}` }}>
      <span><span style={{ display: 'block', font: `300 13px ${FONT}`, color: C.ink2 }}>{l}</span><span style={{ display: 'block', font: `300 10.5px ${FONT}`, color: C.faint, marginTop: 1 }}>{sub}</span></span>
      <NumInput kind={kind} value={w[k]} width={80} onChange={v => upd(k, v)} />
    </div>
  );
  return (
    <Card eyebrow="Flujo de efectivo" title="Capital de trabajo operativo" sub="Define cuánta caja consume la operación al crecer. Alimenta el flujo libre de caja en Valuación.">
      <div className="axon-two" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 36px' }}>
        <div>
          {field('Días de cartera (DSO)', 'Cuánto tardan en pagarte', 'dso')}
          {field('Clientes con crédito', '% de la venta que se cobra a plazo', 'credito', 'pct')}
          {field('Días base del año', 'Convención para convertir a días', 'base')}
        </div>
        <div>
          {field('Días de inventario (DIO)', 'Sobre costos directos sin nómina', 'dio')}
          {field('Días de proveedores (DPO)', 'Cuánto tardas en pagar costos y gastos de terceros', 'dpo')}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 0 0' }}>
            <span style={{ font: `650 10px ${FONT}`, letterSpacing: '.16em', textTransform: 'uppercase', color: C.ink }}>Ciclo de conversión</span>
            <span style={{ font: `200 34px/1 ${FONT}`, letterSpacing: '-0.03em', color: ccc < 0 ? C.pos : C.ink }}>{ccc}<span style={{ font: `300 13px ${FONT}`, color: C.muted, marginLeft: 6 }}>días</span></span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16, padding: '11px 14px', borderRadius: 0, background: C.tint, border: `1px solid ${C.line2}`, font: `300 12px/1.5 ${FONT}`, color: C.muted }}>
        <span style={{ width: 5, height: 5, borderRadius: 99, background: C.yellow, flex: 'none', marginTop: 7 }} />
        <span>Lo que tardas en volver a tener el dinero: cobras a <strong style={{ fontWeight: 600, color: C.ink2 }}>{w.dso} días</strong> ({pct(w.credito, 0)} de la venta a crédito), cargas <strong style={{ fontWeight: 600, color: C.ink2 }}>{w.dio}</strong> de inventario y pagas a <strong style={{ fontWeight: 600, color: C.ink2 }}>{w.dpo}</strong>.</span>
      </div>
      <div style={{ marginTop: 18, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', font: `300 12.5px ${FONT}`, fontVariantNumeric: 'tabular-nums' }}>
          <thead><tr>{['', ...YEARS_S].map(y => <th key={y} style={{ textAlign: y ? 'right' : 'left', padding: '6px 10px', borderBottom: `1px solid ${C.ink}`, font: `650 10px ${FONT}`, letterSpacing: '.14em', color: C.ink }}>{y}</th>)}</tr></thead>
          <tbody>
            {[['Cuentas por cobrar', W.cxc, false], ['(+) Inventario', W.inv, false], ['(−) Proveedores', W.cxp.map(v => -v), false], ['Capital de trabajo neto', W.ctn, true]].map(([l, a, b]) => (
              <tr key={l as string}>
                <td style={{ padding: '7px 10px', borderBottom: `1px solid ${C.line2}`, fontWeight: b ? 600 : 300, color: C.ink }}>{l as string}</td>
                {(a as number[]).map((v, i) => <td key={i} style={{ padding: '7px 10px', textAlign: 'right', borderBottom: `1px solid ${C.line2}`, fontWeight: b ? 600 : 300, color: v < 0 ? C.neg : C.ink }}>{money(v)}</td>)}
              </tr>
            ))}
            <tr>
              <td style={{ padding: '7px 10px', color: C.muted, fontStyle: 'italic' }}>Inversión del año (flujo libre)</td>
              <td style={{ padding: '7px 10px', textAlign: 'right', color: C.faint }}>—</td>
              {R.v.ctA.map((v, i) => <td key={i} style={{ padding: '7px 10px', textAlign: 'right', color: v < 0 ? C.neg : C.muted, fontStyle: 'italic' }}>{money(v)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Supuestos({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const groups = ['Costos', 'Tasas'];
  const ingresos = PARAM_DEFS.filter(p => p.g === 'Ingresos');
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {groups.map(gname => (
          <Card key={gname} title={gname === 'Costos' ? 'Supuestos de costos y gastos' : 'Tasas generales'}>
            <div style={{ display: 'grid', gap: 8 }}>
              {gname === 'Tasas' && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 12px', margin: '0 0 6px', borderRadius: 0, background: C.surface, border: `1px solid ${C.line}`, transition: 'all .15s' }}>
                  <input type="checkbox" checked={!!M.params.aplicarInflacion} onChange={e => set(m => { m.params.aplicarInflacion = e.target.checked; })}
                    style={{ width: 16, height: 16, margin: '1px 0 0', accentColor: C.ink, cursor: 'pointer', flex: 'none' }} />
                  <span>
                    <span style={{ display: 'block', font: `650 10.5px ${FONT}`, letterSpacing: '.14em', textTransform: 'uppercase', color: C.ink }}>Aplicar factor de inflación</span>
                    <span style={{ display: 'block', font: `300 11.5px/1.45 ${FONT}`, color: C.muted, marginTop: 3 }}>
                      {M.params.aplicarInflacion ? `El precio del desarrollo inicial, los costos y los gastos crecen ${pct(M.params.inflacion)} anual desde 2028. Las mensualidades también suben con la inflación.` : 'Sin inflación: precios, costos y gastos en términos reales.'}
                    </span>
                  </span>
                </label>
              )}
              {PARAM_DEFS.filter(p => p.g === gname).map(p => (
                <div key={p.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <span style={{ font: `300 13px ${FONT}`, color: C.ink2 }}>{p.l}</span>
                  <NumInput kind={p.kind} value={M.params[p.k] ?? 0} width={p.kind === 'money' ? 104 : 72} onChange={v => set(m => { m.params[p.k] = v; })} />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <Card eyebrow="Ingresos" title="Supuestos de ingresos">
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ingresos.length}, minmax(0, 1fr))`, borderTop: `1px solid ${C.line2}` }} className="axon-ing">
          {ingresos.map((p, i) => (
            <div key={p.k} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12, padding: '14px 14px 2px', paddingLeft: i ? 14 : 0, borderLeft: i ? `1px solid ${C.line2}` : undefined }}>
              <span style={{ font: `300 12px/1.35 ${FONT}`, color: C.ink2 }}>{p.l}</span>
              <NumInput kind={p.kind} value={M.params[p.k] ?? 0} width={p.kind === 'money' ? 104 : 64} onChange={v => set(m => { m.params[p.k] = v; })} />
            </div>
          ))}
        </div>
      </Card>
      <CrecimientoCard M={M} R={R} set={set} />
      <IncrementoCard M={M} R={R} set={set} cfg={INC_PRECIO} />
      <ChurnCard M={M} R={R} set={set} />
      <CargaCard M={M} R={R} set={set} />
      <IncrementoCard M={M} R={R} set={set} cfg={INC_SUELDO} />
      <CapexCard M={M} R={R} set={set} />
      <CapitalTrabajoCard M={M} R={R} set={set} />
      <CicloCard M={M} set={set} />
    </div>
  );
}

// ===================== Módulo: Crédito =====================
function Credito({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const [showAll, setShowAll] = useState(false);
  const cr = R.cred, tot = cr.years.reduce((s, y) => s + y.interes, 0);
  const rows = showAll ? cr.rows : cr.rows.slice(0, 12);
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) 1fr', gap: 16, alignItems: 'start' }} className="axon-two">
        <Card title="Condiciones del crédito" sub="Crédito ya dispuesto (no es dinero nuevo). Con la prórroga, los pagos arrancan en enero 2027. Amortización a saldos insolutos, capital constante.">
          <div style={{ display: 'grid', gap: 10 }}>
            {[{ l: 'Monto', k: 'monto' as const, kind: 'money' as const }, { l: 'Tasa anual total', k: 'tasa' as const, kind: 'pct' as const }, { l: 'Plazo (años)', k: 'plazo' as const, kind: 'num' as const }].map(f => (
              <div key={f.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ font: `300 13px ${FONT}`, color: C.ink2 }}>{f.l}</span>
                <NumInput kind={f.kind} value={M.credito[f.k]} onChange={v => set(m => { m.credito[f.k] = Math.max(0, v); })} width={112} />
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${C.line2}`, marginTop: 6, paddingTop: 10, display: 'grid', gap: 7 }}>
              {[['Tasa mensual', pct(M.credito.tasa / 12, 2)], ['Plazo mensual', `${cr.rows.length} meses`], ['Capital mensual', `$${money(cr.rows[0]?.capital || 0)}`], ['Primer pago', `$${money(cr.rows[0]?.pago || 0)}`], ['Intereses totales', `$${money(tot)}`]].map(([a, b]) => (
                <div key={a} style={{ display: 'flex', justifyContent: 'space-between', font: `300 13px ${FONT}`, color: C.muted }}><span>{a}</span><span style={{ color: C.ink, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{b}</span></div>
              ))}
            </div>
          </div>
        </Card>
        <Card title="Pago anual: capital e intereses" sub="Los intereses van al P&L como CIF y el capital resta caja en Necesidad de capital, ambos desde enero 2027">
          <Legend items={[{ c: C.graphite, l: 'Capital' }, { c: C.gold, l: 'Intereses' }]} />
          <BarChart labels={cr.years.map((_, i) => `${2027 + i}`)} series={[{ name: 'Capital', color: C.graphite, values: cr.years.map(y => y.capital) }, { name: 'Intereses', color: C.gold, values: cr.years.map(y => y.interes) }]} height={240} />
        </Card>
      </div>
      <Card title="Tabla de amortización" sub={showAll ? `${cr.rows.length} periodos` : 'Primeros 12 periodos'} right={<button onClick={() => setShowAll(!showAll)} style={btn}>{showAll ? 'Ver primeros 12' : 'Ver tabla completa'}</button>} pad={false}>
        <div style={{ overflowX: 'auto', maxHeight: showAll ? 520 : undefined, overflowY: showAll ? 'auto' : undefined }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
            <thead><tr>{['Periodo', 'Interés', 'Capital', 'Pago mensual', 'Saldo pendiente'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.n} style={{ background: r.n % 12 === 0 ? C.tint : undefined }}>
                <td style={tdBase}>{r.n} <span style={{ color: C.faint }}>· {mesCorto(13 + r.n)}</span></td><td style={tdBase}>{money(r.interes)}</td><td style={tdBase}>{money(r.capital)}</td><td style={{ ...tdBase, fontWeight: 600, color: C.ink }}>{money(r.pago)}</td><td style={tdBase}>{money(r.saldo)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </Card>
      <Card title="Resumen anual" pad={false}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
          <thead><tr>{['Año', 'Pago total', 'Intereses', 'Capital'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{cr.years.map((y, i) => <tr key={i}><td style={tdBase}>{2027 + i}</td><td style={{ ...tdBase, fontWeight: 600, color: C.ink }}>{money(y.pago)}</td><td style={tdBase}>{money(y.interes)}</td><td style={tdBase}>{money(y.capital)}</td></tr>)}</tbody>
        </table>
      </Card>
    </div>
  );
}

// ===================== Módulo: Valuación =====================
const btn: React.CSSProperties = { border: `1px solid ${C.line}`, background: C.surface, borderRadius: 99, padding: '6px 14px', font: `400 12.5px ${FONT}`, color: C.ink, cursor: 'pointer', whiteSpace: 'nowrap' };

function KV({ l, children, strong, note }: { l: string; children: React.ReactNode; strong?: boolean; note?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: strong ? '10px 0 12px' : '6px 0', borderTop: strong ? `1px solid ${C.ink}` : undefined, marginBottom: strong ? 6 : 0 }}>
      <span style={{ font: `${strong ? 600 : 300} 13px ${FONT}`, color: strong ? C.ink : C.ink2 }}>{l}{note && <span style={{ display: 'block', font: `300 11px ${FONT}`, fontStyle: 'italic', color: C.faint }}>{note}</span>}</span>
      <span style={{ font: `${strong ? 600 : 300} ${strong ? 15 : 13}px ${FONT}`, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>{children}</span>
    </div>
  );
}

function SensTable({ title, rowLabel, rows, cols, m, base, meta, fmtRow }: { title: string; rowLabel: string; rows: number[]; cols: number[]; m: number[][]; base: number; meta: number; fmtRow: (v: number) => string }) {
  return (
    <Card title={title} sub="Valor del capital (MXN). Recuadro: escenario base" pad={false}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
        <thead><tr><th style={{ ...th, textAlign: 'left' }}>{rowLabel} \ g</th>{cols.map(c => <th key={c} style={th}>{pct(c)}</th>)}</tr></thead>
        <tbody>{m.map((r, i) => (
          <tr key={i}>
            <td style={{ ...tdBase, textAlign: 'left', fontWeight: 600, color: C.ink }}>{fmtRow(rows[i])}</td>
            {r.map((v, j) => {
              const isBase = i === base && j === 2;
              return <td key={j} style={{ ...tdBase, background: isBase ? C.yellowSoft : C.surface, fontWeight: isBase ? 650 : 300, color: C.ink, outline: isBase ? `1px solid ${C.ink}` : undefined, outlineOffset: -2 }}>{short(v)}</td>;
            })}
          </tr>))}</tbody>
      </table>
    </Card>
  );
}

// KPIs del resumen (se muestran en Resumen y arriba de Valuación)
function resumenKpis(M: Model, R: Result): FineKpiDef[] {
  const A = R.annual;
  const minAcum = Math.min(...R.acum1, ...R.acum2, ...R.acumY);
  const months = [...M.months1.map(m => (/\d/.test(m) ? m : `${m} 26`)), ...M.months2.map(m => `${m} 27`)];
  const series = [...R.acum1, ...R.acum2];
  const be = series.findIndex(v => v >= 0);
  const beYear = R.acumY.findIndex(v => v >= 0);
  const beLabel = be >= 0 ? months[be] : beYear >= 0 ? `Año ${beYear + 1} (${YEARS_S[beYear]})` : 'Fuera del horizonte';
  const ventasTot = A.venta.reduce((s, x) => s + x, 0);
  const cagr15 = Math.pow(A.venta[4] / A.venta[0], 1 / 4) - 1;
  const tir = irr(A.un), vpn = npv(R.v.wacc, A.un), pb = payback(R.acumY);
  return [
    { label: 'Ventas totales', sub: 'Año 1 – Año 5', value: short(ventasTot), note: `${short(A.venta[0])} → ${short(A.venta[4])}` },
    { label: 'TCAC', sub: 'Año 1 – Año 5', value: pct(cagr15), note: `Ventas ${YEARS_S[0]}–${YEARS_S[4]} (2026 = 14 meses)`, tone: 'pos' },
    { label: 'TIR', value: pct(tir), note: `vs. WACC ${pct(R.v.wacc)} · sobre utilidad neta`, tone: tir >= R.v.wacc ? 'pos' : 'neg' },
    { label: 'VPN', value: short(vpn), note: 'Utilidad neta años 1–5 al WACC', tone: vpn >= 0 ? 'pos' : 'neg' },
    { label: 'Payback', value: isFinite(pb) ? pb.toFixed(1) : '—', unit: isFinite(pb) ? 'años' : undefined, note: `Pérdida acumulada máx. (P&L) ${short(minAcum)} · equilibrio ${beLabel}` },
    { label: 'Valuación', sub: 'DFC', value: short(R.v.equity), note: 'Valor del capital' },
  ];
}

function Valuacion({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const V = M.val, v = R.v;
  const inp = (k: keyof Model['val'], kind: 'pct' | 'num' | 'money' = 'pct', w = 80) => <NumInput kind={kind} width={w} value={V[k] as number} onChange={x => set(m => { (m.val as any)[k] = x; })} />;
  const scenRow = (k: 'volMeta' | 'precioMeta') => V[k].map((x, i) => <td key={i} style={tdBase}><NumInput kind="pct" width={70} value={x} onChange={nv => set(m => { m.val[k][i] = nv; })} /></td>);
  const fy = ['2027', '2028', '2029', '2030'];
  const frow = (l: string, arr: number[], bold?: boolean) => (
    <tr><td style={{ ...tdBase, ...stickyL, fontWeight: bold ? 650 : 450, color: bold ? C.ink : C.ink2, background: bold ? C.tint : C.surface }}>{l}</td>{arr.map((x, i) => <td key={i} style={{ ...tdBase, background: bold ? C.tint : undefined }}><Num v={x} bold={bold} /></td>)}</tr>
  );
  const bridge = [{ l: 'VP flujos 2027–2030', v: v.sumPv }, { l: 'VP valor terminal', v: v.pvTv }, { l: 'Valor de la empresa (EV)', v: v.ev, t: true }, { l: 'Deuda bancaria', v: -v.deuda }, { l: 'Caja', v: v.caja }, { l: 'Valor del capital', v: v.equity, t: true }];
  const maxB = Math.max(...bridge.map(b => Math.abs(b.v)));
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <FineKpis items={resumenKpis(M, R)} />
      <FineKpis items={[
        { label: 'Valor del capital', sub: 'Pre-money · 1-ene-2027', value: short(v.equity), hl: 'Valor de AXON' },
        { label: 'Valor de la empresa', sub: 'EV', value: short(v.ev), note: `EV / Ventas 2027: ${v.evVentas.toFixed(2)}x` },
        { label: 'WACC', value: pct(v.wacc, 2), note: `Ke ${pct(v.ke, 2)} · Kd neto ${pct(v.kdAt, 2)}` },
        { label: 'Peso del valor terminal', value: pct(v.pctTv), note: isFinite(v.evEbitda) && v.ebitda[4] > 0 ? `EV / EBITDA 2030: ${v.evEbitda.toFixed(2)}x · VT / EBITDA 2030: ${v.tvEbitda.toFixed(2)}x` : 'EBITDA 2030 ≤ 0' },
      ]} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, alignItems: 'start' }}>
        <Card title="Tasa de descuento (WACC)" sub="CAPM en pesos con primas por tamaño y etapa">
          <KV l="Bono M 10 años (México)">{inp('bono')}</KV>
          <KV l="(−) Spread de default soberano">{inp('spread')}</KV>
          <KV l="Tasa libre de riesgo en pesos" strong>{pct(v.rf, 2)}</KV>
          <KV l="Beta desapalancada – Software">{inp('betaU', 'num', 70)}</KV>
          <KV l="Deuda / (Deuda + Capital) objetivo">{inp('dPeso')}</KV>
          <KV l="Beta reapalancada" note="Hamada: βu × (1 + (1 − t) × D/E)">{v.betaL.toFixed(3)}</KV>
          <KV l="Prima de riesgo de mercado madura">{inp('prima')}</KV>
          <KV l="Prima de riesgo país México">{inp('pais')}</KV>
          <KV l="Costo del capital CAPM" strong>{pct(v.ke0, 2)}</KV>
          <KV l="(+) Prima por tamaño (micro-cap)">{inp('tamano')}</KV>
          <KV l="(+) Prima startup / riesgo específico">{inp('startup')}</KV>
          <KV l="Costo del capital (Ke)" strong>{pct(v.ke, 2)}</KV>
          <KV l="Costo de la deuda después de impuestos" note={`Tasa del crédito ${pct(M.credito.tasa)} × (1 − ISR)`}>{pct(v.kdAt, 2)}</KV>
          <KV l="WACC" strong>{pct(v.wacc, 2)}</KV>
        </Card>

        <div style={{ display: 'grid', gap: 20 }}>
          <Card title="Flujo libre y valor terminal">
            <KV l="D&A adicional (% de ventas)" note="La D&A del CAPEX de Supuestos ya está incluida">{inp('da')}</KV>
            <KV l="CAPEX adicional (% de ventas)" note="El CAPEX de Supuestos ya está incluido">{inp('capex')}</KV>
            {M.val.wc ? <KV l="Capital de trabajo operativo" note="Por días de cartera, inventario y proveedores · se edita en Supuestos">{M.val.wc.dso + M.val.wc.dio - M.val.wc.dpo} días</KV>
              : <KV l="Capital de trabajo (% del aumento en ventas)">{inp('ct')}</KV>}
            <KV l="Crecimiento a perpetuidad (g)">{inp('g')}</KV>
            <KV l="Caja al 31-dic-2026">{inp('caja', 'money', 110)}</KV>
            <KV l="Deuda bancaria al 31-dic-2026" note="Vinculada al módulo Crédito bancario">${money(v.deuda)}</KV>
          </Card>
        </div>
      </div>

      <Card title="Flujo libre de caja y descuento" sub="Descuento a mitad de año; valor terminal descontado 4.0 años" pad={false}>
        <ScrollX>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
            <thead><tr><th style={{ ...th, ...stickyL, background: C.surface, minWidth: 240 }}>Concepto</th>{fy.map(y => <th key={y} style={th}>{y}</th>)}</tr></thead>
            <tbody>
              {frow('Ventas totales', v.ventas.slice(1))}
              {frow('EBITDA', v.ebitda.slice(1))}
              {frow('(−) D&A', v.daA)}
              {frow('EBIT', v.ebit, true)}
              {frow('(−) ISR sobre EBIT', v.isrA)}
              {frow('NOPAT', v.nopat, true)}
              {frow('(−) CAPEX', v.capexA)}
              {frow('(−) Inversión en capital de trabajo', v.ctA)}
              {frow('Flujo libre de caja (FCFF)', v.fcff, true)}
              <tr><td style={{ ...tdBase, ...stickyL, color: C.muted }}>Factor de descuento</td>{v.factor.map((x, i) => <td key={i} style={{ ...tdBase, color: C.muted }}>{x.toFixed(4)}</td>)}</tr>
              {frow('Valor presente del FCFF', v.pv, true)}
            </tbody>
          </table>
        </ScrollX>
      </Card>

      <Card title="Del valor de la empresa al valor del capital" sub={`Valuación pre-money al 1-ene-2027: caja inicial en cero, deuda bancaria vigente y sin incluir el capital nuevo. Valor terminal al cierre de 2030: ${short(v.tv)} (flujo terminal ${short(v.fcffT)} ÷ (WACC − g)).`}>
        <div style={{ display: 'grid', gap: 8 }}>
          {bridge.map(b => (
            <div key={b.l} style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 230px) 1fr 90px', alignItems: 'center', gap: 12 }}>
              <span style={{ font: `${b.t ? 600 : 300} 13px ${FONT}`, color: b.t ? C.ink : C.ink2 }}>{b.l}</span>
              <div style={{ height: 6, background: C.line2, borderRadius: 99 }}>
                <div style={{ width: `${(Math.abs(b.v) / maxB) * 100}%`, height: '100%', borderRadius: 99, background: b.t ? C.ink : b.v < 0 ? C.neg : C.gold }} />
              </div>
              <span style={{ font: `${b.t ? 600 : 300} ${b.t ? 15 : 13}px ${FONT}`, color: b.v < 0 ? C.neg : C.ink, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{short(b.v)}</span>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
        <SensTable title="Sensibilidad A · WACC vs g" rowLabel="WACC" rows={v.sensA.rows} cols={v.sensA.cols} m={v.sensA.m} base={2} meta={V.meta} fmtRow={x => pct(x, 2)} />
        <SensTable title="Sensibilidad B · prima startup vs g" rowLabel="Prima" rows={v.sensB.rows} cols={v.sensB.cols} m={v.sensB.m} base={2} meta={V.meta} fmtRow={x => pct(x, 1)} />
      </div>
    </div>
  );
}

// ===================== Módulo: Mercado =====================
type Market = { id: string; name: string; note?: string; geo: string[]; lo: number; hi: number; src: string; srcShort: string; lab?: [number, number] };
const MARKETS: Market[] = [
  { id: 'mx', name: 'México', geo: ['Mexico'], lo: 35000, hi: 49000, src: 'Censos Económicos 2024 del INEGI.', srcShort: 'INEGI, Censos Económicos 2024', lab: [-100, 28] },
  { id: 'us', name: 'Estados Unidos', note: 'Solo empresas latinas / hispanas', geo: ['United States of America'], lo: 15000, hi: 22000, src: 'Encuesta Anual de Negocios (Annual Business Survey – ABS) del U.S. Census Bureau.', srcShort: 'U.S. Census Bureau, ABS', lab: [-125, -40] },
  { id: 'pe', name: 'Perú', geo: ['Peru'], lo: 15000, hi: 16500, src: 'Estructura Empresarial del INEI y estadísticas del Ministerio de la Producción (PRODUCE).', srcShort: 'INEI y PRODUCE', lab: [-58, 6] },
  { id: 'co', name: 'Colombia', geo: ['Colombia'], lo: 13000, hi: 16000, src: 'Registro Único Empresarial y Social (RUES) de Confecámaras bajo los rangos del Decreto 957.', srcShort: 'RUES, Confecámaras (Decreto 957)', lab: [62, -48] },
  { id: 'cl', name: 'Chile', geo: ['Chile'], lo: 13000, hi: 15500, src: 'Estadísticas de Empresas por Tamaño del Servicio de Impuestos Internos (SII) y el Ministerio de Economía.', srcShort: 'SII y Ministerio de Economía', lab: [-48, 0] },
  { id: 'ar', name: 'Argentina', geo: ['Argentina'], lo: 12000, hi: 15000, src: 'Observatorio de Empleo y Dinámica Empresarial (OEDE) del Ministerio de Capital Humano / Secretaría de Trabajo y parámetros de la SEPyME.', srcShort: 'OEDE y SEPyME', lab: [92, 22] },
  { id: 'ca', name: 'Centroamérica', note: 'Bloque regional', geo: ['Guatemala', 'Belize', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama'], lo: 7500, hi: 11000, src: 'Sistema de Información Regional de la MIPYME (SIRMIPYME) de CENPROMYPE / SICA y directorios estadísticos nacionales.', srcShort: 'SIRMIPYME, CENPROMYPE / SICA', lab: [-70, 22] },
  { id: 'ec', name: 'Ecuador', geo: ['Ecuador'], lo: 5370, hi: 5370, src: 'Registro Estadístico de Empresas (REEM) del INEC y la Superintendencia de Compañías, Valores y Seguros (SCVS).', srcShort: 'INEC (REEM) y SCVS', lab: [-62, -4] },
];
const geoToMarket = new Map(MARKETS.flatMap(m => m.geo.map(g => [g, m] as const)));
const mid = (m: Market) => (m.lo + m.hi) / 2;
const kfmt = (n: number) => `${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}k`;
const rangeK = (m: Market) => m.lo === m.hi ? `~${kfmt(m.lo)}` : `${+(m.lo / 1000).toFixed(m.lo % 1000 ? 1 : 0)}–${kfmt(m.hi)}`;
const rangeFull = (m: Market) => m.lo === m.hi ? `~${int(m.lo)}` : `${int(m.lo)} – ${int(m.hi)}`;
const int = (n: number) => Math.round(n).toLocaleString('en-US');
function lerpHex(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function MarketMap({ sel, onSel }: { sel: string; onSel: (id: string) => void }) {
  const W = 620, H = 700;
  const [hov, setHov] = useState<string | null>(null);
  const { paths, labels } = useMemo(() => {
    const feats = (AMERICAS as unknown as GeoJSON.FeatureCollection<GeoJSON.Geometry, { name: string }>).features;
    // Al simplificar, algunos anillos quedan con orientación invertida (cubrirían todo el globo): se corrigen
    const fixPoly = (rings: GeoJSON.Position[][]) => geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI ? rings.map(r => [...r].reverse()) : rings;
    feats.forEach(f => {
      const g = f.geometry;
      if (g.type === 'Polygon') g.coordinates = fixPoly(g.coordinates);
      else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map(fixPoly);
    });
    const fit = { type: 'FeatureCollection', features: feats.filter(f => !['Canada', 'Falkland Is.'].includes(f.properties.name)) } as GeoJSON.FeatureCollection;
    const proj = geoAzimuthalEqualArea().rotate([82, -8]).fitExtent([[16, 6], [W - 16, H - 6]], fit);
    const gp = geoPath(proj);
    const paths = feats.map(f => ({ name: f.properties.name, d: gp(f) ?? '', m: geoToMarket.get(f.properties.name) }));
    const labels = MARKETS.map(m => {
      const fs = feats.filter(f => m.geo.includes(f.properties.name));
      const target = m.id === 'us' ? proj([-97, 38]) : m.id === 'ca' ? proj([-86, 13.8]) : m.id === 'cl' ? proj([-71, -31]) : gp.centroid({ type: 'FeatureCollection', features: fs } as GeoJSON.FeatureCollection);
      const [x, y] = target ?? [0, 0];
      const [dx, dy] = m.lab ?? [0, 0];
      return { m, x, y, lx: x + dx, ly: y + dy, right: dx > 0 };
    });
    return { paths, labels };
  }, []);
  const maxMid = Math.max(...MARKETS.map(mid));
  const fill = (m?: Market) => m ? lerpHex('#FBF0C6', '#E6B92C', Math.pow(mid(m) / maxMid, 0.9)) : '#EFEDE7';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Mapa de mercado: EUA y Latinoamérica">
      <defs>
        <pattern id="mk-dots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill={C.line} /></pattern>
      </defs>
      <rect width={W} height={H} fill="url(#mk-dots)" opacity={.35} />
      {paths.map((p, i) => {
        const on = p.m && (p.m.id === sel || p.m.id === hov);
        return (
          <path key={i} d={p.d} fill={fill(p.m)} stroke="#fff" strokeWidth={.5} strokeLinejoin="round"
            style={{ cursor: p.m ? 'pointer' : 'default', transition: 'opacity .15s, filter .15s', opacity: hov && p.m && p.m.id !== hov && p.m.id !== sel ? .55 : 1, filter: on ? 'brightness(.96)' : undefined }}
            onMouseEnter={() => p.m && setHov(p.m.id)} onMouseLeave={() => setHov(null)} onClick={() => p.m && onSel(p.m.id)}>
            {p.m && <title>{p.m.name}: {rangeFull(p.m)} empresas</title>}
          </path>
        );
      })}
      {/* contorno del seleccionado, encima de todo */}
      {paths.filter(p => p.m?.id === sel).map((p, i) => <path key={'s' + i} d={p.d} fill="none" stroke={C.ink} strokeWidth={.75} strokeLinejoin="round" pointerEvents="none" />)}
      {labels.map(({ m, x, y, lx, ly, right }) => {
        const on = m.id === sel;
        return (
          <g key={m.id} style={{ cursor: 'pointer' }} onClick={() => onSel(m.id)} onMouseEnter={() => setHov(m.id)} onMouseLeave={() => setHov(null)}>
            <line x1={x} y1={y} x2={right ? lx - 4 : lx + 4} y2={ly - 4} stroke={C.faint} strokeWidth={.5} /><circle cx={x} cy={y} r={1.4} fill={C.ink2} />
            <text x={lx} y={ly - 8} textAnchor={right ? 'start' : 'end'} style={{ font: `${on ? 600 : 400} 8px ${FONT}`, letterSpacing: '.16em', textTransform: 'uppercase', fill: on ? C.ink : C.muted}}>{m.id === 'us' ? 'EUA' : m.name}</text>
            <text x={lx} y={ly + 7} textAnchor={right ? 'start' : 'end'} style={{ font: `${on ? 400 : 200} 13px ${FONT}`, letterSpacing: '-0.01em', fill: C.ink, fontVariantNumeric: 'tabular-nums'}}>{rangeK(m)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Mercado() {
  const [sel, setSel] = useState('mx');
  const m = MARKETS.find(x => x.id === sel)!;
  const ranked = [...MARKETS].sort((a, b) => mid(b) - mid(a));
  const totLo = MARKETS.reduce((s, x) => s + x.lo, 0), totHi = MARKETS.reduce((s, x) => s + x.hi, 0), totMid = (totLo + totHi) / 2;
  const scaleMax = 50000;
  const share = mid(m) / totMid;
  const rank = ranked.findIndex(x => x.id === sel) + 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <FineKpis items={[
        { label: 'Empresas objetivo', sub: 'Ventas > US$5M', value: `${kfmt(totLo)}–${kfmt(totHi)}`, note: 'Suma de los 8 mercados identificados' },
        { label: 'México', sub: 'Mercado principal', value: rangeK(MARKETS[0]), note: `~${pct(mid(MARKETS[0]) / totMid, 0)} del total` },
        { label: 'EUA hispano', sub: 'Empresas latinas', value: rangeK(MARKETS[1]), note: `~${pct(mid(MARKETS[1]) / totMid, 0)} del total` },
        { label: 'Sudamérica', sub: 'Perú, Colombia, Chile, Arg., Ecuador', value: `${kfmt(MARKETS.filter(x => ['pe', 'co', 'cl', 'ar', 'ec'].includes(x.id)).reduce((s, x) => s + x.lo, 0))}–${kfmt(MARKETS.filter(x => ['pe', 'co', 'cl', 'ar', 'ec'].includes(x.id)).reduce((s, x) => s + x.hi, 0))}`, note: 'Cinco países' },
      ]} />
      <div className="axon-two" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
        <Card eyebrow="Mercado potencial" title="Empresas con ventas mayores a US$5M" sub="EUA y Latinoamérica · toca un país para ver su detalle" pad={false}>
          <div style={{ padding: '0 18px 6px' }}><MarketMap sel={sel} onSel={setSel} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 24px 18px', font: `300 10.5px ${FONT}`, color: C.faint }}>
            <span>Menos</span>
            <span style={{ width: 120, height: 6, borderRadius: 99, background: `linear-gradient(90deg, #FBF0C6, #E6B92C)` }} />
            <span>Más empresas</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 12 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: '#EFEDE7' }} />Sin estimación</span>
          </div>
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Card eyebrow={`#${rank} de ${MARKETS.length} mercados`} title={m.name} sub={m.note}>
            <div style={{ font: `200 40px/1 ${FONT}`, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums' }}>{rangeFull(m)}</div>
            <div style={{ font: `300 12.5px ${FONT}`, color: C.muted, marginTop: 8 }}>empresas con ventas anuales mayores a US$5M</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', marginTop: 20, borderTop: `1px solid ${C.line2}` }}>
              <div style={{ padding: '14px 0 0' }}>
                <div style={{ font: `650 10px ${FONT}`, textTransform: 'uppercase', letterSpacing: '.16em' }}>Participación</div>
                <div style={{ font: `250 24px ${FONT}`, marginTop: 6 }}>~{pct(share, 0)}</div>
                <div style={{ font: `300 11px ${FONT}`, color: C.faint }}>del mercado identificado</div>
              </div>
              <div style={{ padding: '14px 0 0 18px', borderLeft: `1px solid ${C.line2}` }}>
                <div style={{ font: `650 10px ${FONT}`, textTransform: 'uppercase', letterSpacing: '.16em' }}>Punto medio</div>
                <div style={{ font: `250 24px ${FONT}`, marginTop: 6 }}>{int(mid(m))}</div>
                <div style={{ font: `300 11px ${FONT}`, color: C.faint }}>empresas</div>
              </div>
            </div>
            <div style={{ marginTop: 18, font: `300 10px/1.45 ${FONT}`, color: C.faint }}>Fuente: {m.src}</div>
          </Card>
          <Card eyebrow="Comparativo" title="Empresas por mercado" sub="Número estimado de empresas con ventas > US$5M">
            <div style={{ position: 'relative' }}>
              {/* líneas guía cada 10k */}
              <div style={{ position: 'absolute', inset: '0 64px 0 112px', pointerEvents: 'none' }}>
                {[0, 10, 20, 30, 40, 50].map(t => <span key={t} style={{ position: 'absolute', top: 0, bottom: 0, left: `${t * 2}%`, borderLeft: `1px ${t ? 'dashed' : 'solid'} ${t ? C.line2 : C.line}` }} />)}
              </div>
              {ranked.map(x => {
                const on = x.id === sel;
                return (
                  <button key={x.id} onClick={() => setSel(x.id)}
                    style={{ all: 'unset', boxSizing: 'border-box', width: '100%', cursor: 'pointer', position: 'relative', display: 'grid', gridTemplateColumns: '112px 1fr 64px', alignItems: 'center', padding: '8px 0' }}>
                    <span style={{ font: `${on ? 600 : 300} 12px ${FONT}`, color: on ? C.ink : C.ink2, whiteSpace: 'nowrap', paddingRight: 12 }}>{x.id === 'us' ? 'EUA (hispanas)' : x.name}</span>
                    <span style={{ position: 'relative', height: 9, display: 'flex' }}>
                      <span style={{ width: `${x.lo / scaleMax * 100}%`, background: on ? C.ink : C.yellow, borderRadius: '2px 0 0 2px', transition: 'background .15s' }} />
                      <span style={{ width: `${(x.hi - x.lo) / scaleMax * 100}%`, background: on ? 'repeating-linear-gradient(135deg, #3A3D42 0 2px, #6B6E76 2px 4px)' : `repeating-linear-gradient(135deg, ${C.yellow} 0 2px, #FBE59A 2px 4px)`, borderRadius: '0 2px 2px 0' }} />
                    </span>
                    <span style={{ font: `${on ? 500 : 300} 12px ${FONT}`, color: on ? C.ink : C.muted, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rangeK(x)}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '112px 1fr 64px', marginTop: 4, font: `300 9.5px ${FONT}`, color: C.faint, fontVariantNumeric: 'tabular-nums' }}>
              <span /><span style={{ position: 'relative', height: 12 }}>{[0, 10, 20, 30, 40, 50].map(t => <span key={t} style={{ position: 'absolute', left: `${t * 2}%`, transform: t ? 'translateX(-50%)' : undefined }}>{t ? `${t}k` : '0'}</span>)}</span><span />
            </div>
            <div style={{ display: 'flex', gap: 18, marginTop: 16, font: `300 10.5px ${FONT}`, color: C.muted }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 8, borderRadius: 2, background: C.yellow }} />Mínimo estimado</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 8, borderRadius: 2, background: `repeating-linear-gradient(135deg, ${C.yellow} 0 2px, #FBE59A 2px 4px)` }} />Hasta el máximo</span>
            </div>
          </Card>
        </div>
      </div>
      <div style={{ font: `300 9.5px/1.6 ${FONT}`, color: C.faint, padding: '0 4px' }}>
        <span style={{ fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', marginRight: 6 }}>Fuentes</span>
        {MARKETS.map((x, i) => <span key={x.id}>{i ? ' · ' : ''}{x.id === 'us' ? 'EUA' : x.name}: {x.srcShort}</span>)}.
        {' '}Cifras aproximadas; EUA considera solo empresas de propietarios latinos / hispanos.
      </div>
    </div>
  );
}

// ===================== Asesor IA =====================
type ChatMsg = { role: 'user' | 'assistant'; text: string };
const AI_SUGGEST = [
  { k: 'Valuación', q: '¿Qué supuestos mueven más la valuación?' },
  { k: 'Capital', q: '¿Por qué se necesita el capital nuevo y cómo se usa?' },
  { k: 'Mercado', q: 'Después de México, ¿qué mercado conviene atacar primero?' },
  { k: 'Riesgos', q: 'Resume los principales riesgos del plan a 5 años.' },
];
function AIButton({ onClick }: { onClick: () => void }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 10, border: `1px solid ${C.ink}`, background: h ? '#000' : C.ink, color: '#fff', borderRadius: 16, padding: '9px 20px', cursor: 'pointer', textAlign: 'left', font: `600 10.5px ${FONT}`, letterSpacing: '.14em', textTransform: 'uppercase', boxShadow: h ? '0 6px 20px rgba(16,17,19,.18)' : '0 1px 2px rgba(16,17,19,.12)', transition: 'all .2s' }}>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, lineHeight: 1.2 }}>
        <span>Dejemos que la <span style={{ color: C.yellow }}>IA avanzada</span> nos ayude a decidir</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: `400 9px ${FONT}`, letterSpacing: '.18em', color: 'rgba(255,255,255,.62)' }}>
          Da clic aquí <span style={{ color: C.yellow, transform: h ? 'translateX(3px)' : 'none', transition: 'transform .2s' }}>→</span>
        </span>
      </span>
    </button>
  );
}
// Resumen de las cifras vivas del modelo que recibe la IA
function aiContext(M: Model, R: Result): string {
  const r = (v: number) => Math.round(v), r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const arr = (a: number[]) => a.map(r);
  const A = R.annual, V = R.v;
  const pl = Object.fromEntries((['venta', 'dev', 'mant', 'otros', 'personal', 'costos', 'ub', 'go', 'ga', 'mkt', 'capex', 'otrosg', 'gasto', 'ebitda', 'da', 'uo', 'cif', 'uai', 'isr', 'un', 'empresas'] as const).map(k => [k, arr(A[k])]));
  return JSON.stringify({
    moneda: M.params.aplicarInflacion ? 'MXN nominales' : 'MXN constantes (sin inflación)', anios: YEARS_S,
    nota_anio1: 'Año 1 (2026) incluye meses de presupuesto nov-2025 a dic-2026',
    pl_anual: { ...pl, resultado_acumulado: arr(R.acumY) },
    glosario_pl: { personal: 'nómina del personal directo (costo directo)', dev: 'ingreso por desarrollo inicial', mant: 'ingreso por mantenimiento', otros: 'otros ingresos', ub: 'utilidad bruta', go: 'gasto de operación', ga: 'gasto de administración', mkt: 'marketing', ebitda: 'EBITDA (utilidad bruta − gastos, antes de D&A)', uo: 'utilidad de operación (EBIT = EBITDA − D&A)', gasto: 'total gasto antes de D&A', capex: 'gasto inicial 2026 no capitalizable', otrosg: 'otros gastos', cif: 'intereses del crédito bancario', isr: 'ISR (después de amortizar pérdidas fiscales, si aplica)', da: 'depreciación y amortización', uai: 'utilidad antes de impuestos', un: 'utilidad neta', empresas: 'número de empresas cliente' },
    supuestos: (({ ptu, devEuph, ...p }) => p)(M.params),
    inflacion: M.params.aplicarInflacion ? `aplicada (${M.params.inflacion}) al precio del desarrollo inicial, a las mensualidades de mantenimiento, costos y gastos desde 2028; los incrementos de precio solo aplican al desarrollo inicial` : 'no aplicada: cifras en términos reales',
    incremento_sueldos: { porcentaje: M.params.sueldoInc ?? 0, a_partir_de: mesLabel(M.params.sueldoDesde ?? 0), aplica_a: 'nómina de todos los puestos (con carga social)' },
    capex: { supuestos: M.capex, inversion_anual: arr(R.capexPlan.inversionAnual), da_anual: arr(R.capexPlan.daAnual), nota: 'capitalizable: sale de caja al comprarse y entra al P&L como D&A en línea recta; meses como índice desde nov-25' },
    churn: { anual: M.params.churn ?? 0, aplica_a: 'solo ingresos por mantenimiento, desde 2027 (2026 es real)' },
    perdidas_fiscales: { amortizacion_activa: !!M.params.amortizarPerdidas, aplicada_por_anio: arr(R.fiscal.aplicada), saldo_por_amortizar: arr(R.fiscal.saldo) },
    ptu: { aplicada: !!M.params.aplicarPTU, por_anio: arr(R.ptu), regla: '10% de la utilidad antes de impuestos, tope 3 meses de sueldo; se suma a la nómina y se paga en mayo del año siguiente' },
    carga_social: { porcentaje: M.params.cargaSocial ?? 0, aplica_a: 'nómina de todos los puestos de 2027 en adelante (2026 es monto fijo capturado)' },
    incremento_precios: { porcentaje: M.params.precioInc ?? 0, a_partir_de: mesLabel(M.params.precioDesde ?? 0), aplica_a: 'solo al precio del desarrollo inicial (las mensualidades solo suben con la inflación), adicional al aumento de precio 2028–2030 de Valuación' },
    clientes: M.clients.map(c => c.name),
    gastos_mensuales_por_anio: { nota: 'montos mensuales base por año (sin inflación ni incremento de sueldos)', opex_mensual: arr(R.gastos.opexTot), nomina_admin_mensual: arr(R.gastos.adminTot), personal_directo_mensual: arr(R.gastos.dirTot), plantilla_total: R.gastos.hcTot, marketing_mensual: arr(R.gastos.mktTot), puestos: M.admin.map((a, i) => ({ puesto: a.name, tipo: a.directo ? 'costo directo (personal directo)' : 'gasto administrativo', sueldo_mensual: a.sal, plantilla: a.hc, costo_mensual: arr(R.gastos.admin[i]) })) },
    credito: { ...M.credito, estatus: 'ya dispuesto (no es dinero nuevo); prórroga de pago: capital e intereses desde enero 2027', pagos_anuales: R.cred.years.map(y => ({ pago: r(y.pago), interes: r(y.interes), capital: r(y.capital) })) },
    escenario_crecimiento: { crecimiento_volumen: R.scen.vol.map(r4), aumento_precio: R.scen.precio.map(r4) },
    valuacion: {
      fecha_y_tipo: 'pre-money al 1-ene-2027: caja inicial en cero, deuda bancaria vigente, sin incluir el capital nuevo',
      supuestos: (({ volBase, precioBase, escenario, ct, ...v }) => v)(M.val), wacc: r4(V.wacc), ke: r4(V.ke), kd_despues_impuestos: r4(V.kdAt), beta_apalancada: r4(V.betaL), d_e: r4(V.de),
      ventas: arr(V.ventas), ebitda: arr(V.ebitda), nopat: arr(V.nopat), capex: arr(V.capexA), capital_trabajo: arr(V.ctA), capital_trabajo_supuestos: M.val.wc, capital_trabajo_neto: arr(V.wc.ctn), flujo_libre: arr(V.fcff), valor_presente_flujos: arr(V.pv),
      valor_terminal: r(V.tv), vp_valor_terminal: r(V.pvTv), peso_valor_terminal: r4(V.pctTv), valor_empresa_EV: r(V.ev), deuda: r(V.deuda), caja: r(V.caja), valor_capital: r(V.equity),
      ev_ventas_2027: r4(V.evVentas), ev_ebitda_2030: r4(V.evEbitda), valor_terminal_ebitda_2030: r4(V.tvEbitda),
      sensibilidad_wacc_vs_g: { wacc: V.sensA.rows, g: V.sensA.cols, valor_capital: V.sensA.m.map(arr) },
      sensibilidad_prima_startup_vs_g: { prima: V.sensB.rows, g: V.sensB.cols, valor_capital: V.sensB.m.map(arr) },
    },
    ciclo_comercial: (() => { const et = cicloConDso(M.ciclo ?? [], M.val.wc?.dso ?? 30); const total = et.reduce((s, e) => s + e.dias, 0); let acc = 0;
      return { descripcion: 'días del primer contacto (día 0) a cada hito; la administración y mantenimiento arranca el mes siguiente al total (días ÷ 30.5)', hitos: [{ etapa: 'PRIMER CONTACTO', dia: 0 }, ...et.map(e => ({ etapa: e.etapa, dias_etapa: e.dias, dia_acumulado: (acc += e.dias) }))], total_dias: total, mantenimiento_desde_mes: Math.floor(total / 30.5) + 1 }; })(),
    necesidad_de_capital: (() => { const F = computeFlujo(M, R); return {
      registro_cartera: 'firma de contrato', meses_desde_firma: { primer_pago: F.h.L1, finiquito: F.h.L2, mantenimiento_cobrado: F.h.Lmant + F.h.Ldso },
      clientes_nuevos_con_ciclo: F.clientes.filter(c => c.nuevo).map(c => c.name), clientes_existentes: F.clientes.filter(c => !c.nuevo).map(c => c.name),
      necesidad_caja_segun_PL: Math.round(F.pl.necesidad), pico_PL: mesCorto(F.pl.mesPico),
      necesidad_con_capital_trabajo: Math.round(F.wc.necesidad),
      necesidad_con_ciclo_comercial: Math.round(F.ciclo.necesidad), pico_ciclo: mesCorto(F.ciclo.mesPico), caja_positiva_desde: F.ciclo.mesRecupera >= 0 ? mesCorto(F.ciclo.mesRecupera) : 'después de dic-30',
      plan_disposiciones_trimestrales: (() => { const P = planDe(M, F); return { inicio_plan: mesCorto(P.inicio), primera_disposicion: mesCorto(P.primera), puente_antes_de_primera: Math.round(P.puente), colchon_meses: P.colchonMeses, capital_total: P.total, deficit_previo_ya_fondeado: Math.round(P.deficitPrevio), disposiciones: P.disp.filter(d => d.monto > 0.5).map(d => ({ trimestre: d.trimestre, monto: d.monto })) }; })(),
      egreso_mensual_promedio_2027: Math.round(F.operacionMensual), meses_de_operacion: +F.mesesOperacion.toFixed(1), credito_bancario: { monto: F.credito, estatus: 'ya dispuesto, no es dinero nuevo; prórroga: pagos de capital e intereses desde ene-27', pago_capital_2027_2030: Math.round(F.det.capitalCredito.reduce((a, b) => a + b, 0)) },
      caja_acumulada_por_anio: [13, 25, 37, 49, 61].map(t => Math.round(F.ciclo.acum[t])), acumulado_PL_por_anio: [13, 25, 37, 49, 61].map(t => Math.round(F.pl.acum[t])),
    }; })(),
    mercado: { definicion: 'Empresas con ventas anuales mayores a US$5M', mercados: MARKETS.map(m => ({ mercado: m.name, nota: m.note, minimo: m.lo, maximo: m.hi, fuente: m.src })) },
  });
}

// Markdown mínimo para las respuestas: títulos, listas, tablas, negritas
function inlineMd(t: string): React.ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') && p.endsWith('**') ? <strong key={i} style={{ fontWeight: 600, color: C.ink }}>{p.slice(2, -2)}</strong> : p);
}
function Md({ text }: { text: string }) {
  const lines = text.split('\n'); const out: React.ReactNode[] = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())); i++; }
      out.push(<div key={i} style={{ overflowX: 'auto', margin: '6px 0' }}><table style={{ borderCollapse: 'collapse', font: `300 12px ${FONT}`, width: '100%' }}><tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => { const T = j === 0 ? 'th' : 'td'; return <T key={k} style={{ textAlign: k ? 'right' : 'left', padding: '5px 8px', borderBottom: `1px solid ${j === 0 ? C.line : C.line2}`, fontWeight: j === 0 ? 600 : 300, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{inlineMd(c)}</T>; })}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*([-*•]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l); const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*•]|\d+\.)\s+/, '')); i++; }
      const L = ordered ? 'ol' : 'ul';
      out.push(<L key={i} style={{ margin: '4px 0 8px', paddingLeft: 18 }}>{items.map((it, j) => <li key={j} style={{ margin: '3px 0' }}>{inlineMd(it)}</li>)}</L>);
      continue;
    }
    const h = l.match(/^#{1,4}\s+(.*)/);
    if (h) out.push(<div key={i} style={{ font: `600 12.5px ${FONT}`, color: C.ink, margin: '12px 0 4px' }}>{inlineMd(h[1])}</div>);
    else if (/^\s*---+\s*$/.test(l)) out.push(<hr key={i} style={{ border: 0, borderTop: `1px solid ${C.line2}`, margin: '10px 0' }} />);
    else if (l.trim()) out.push(<p key={i} style={{ margin: '0 0 8px' }}>{inlineMd(l)}</p>);
    i++;
  }
  return <>{out}</>;
}

function AIChat({ open, onClose, context }: { open: boolean; onClose: () => void; context: string }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, [open, onClose]);
  const send = async (text: string) => {
    const t = text.trim(); if (!t || busy) return;
    const history: ChatMsg[] = [...msgs, { role: 'user', text: t }];
    setMsgs([...history, { role: 'assistant', text: '' }]); setDraft(''); setBusy(true); setStatus('Analizando con IA Avanzada… puede tardar unos momentos');
    const put = (f: (prev: string) => string) => setMsgs(m => { const n = [...m]; const last = n[n.length - 1]; n[n.length - 1] = { ...last, text: f(last.text) }; return n; });
    let got = false; // ya llegó texto de la respuesta
    try {
      // Si la conexión falla antes de llegar respuesta (servidor reiniciando, red), se reintenta solo
      const body = JSON.stringify({ context, messages: history.filter(m => m.text).map(m => ({ role: m.role, content: m.text })) });
      let res: Response | undefined;
      for (let intento = 0; ; intento++) {
        try { res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); break; }
        catch (e) { if (intento >= 2) throw e; setStatus('Reconectando con la IA…'); await new Promise(r => setTimeout(r, 2500)); }
      }
      if (!res || !res.ok || !res.body) throw new Error(res?.status === 404 ? 'no se encontró /api/chat' : `error ${res?.status}${res?.status === 504 ? ': se agotó el tiempo' : ''}`);
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const ln of lines) {
          if (!ln.trim()) continue;
          const ev = JSON.parse(ln) as { t: 'text' | 'status' | 'error' | 'done'; v?: string };
          if (ev.t === 'text') { got = true; setStatus(''); put(p => p + ev.v); }
          else if (ev.t === 'status') setStatus(ev.v ?? '');
          else if (ev.t === 'error') put(p => (p ? p + '\n\n' : '') + '⚠️ ' + ev.v);
        }
      }
    } catch (e) {
      put(p => (p ? p + '\n\n' : '') + (got
        ? '⚠️ Se cortó la conexión a media respuesta. Vuelve a enviar la pregunta.'
        : `⚠️ No se pudo conectar con el servidor de la IA (${(e as Error).message}). Revisa tu conexión o que la app esté corriendo y vuelve a enviar la pregunta.`));
    }
    setBusy(false); setStatus('');
  };
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,17,19,.18)', backdropFilter: 'blur(2px)', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity .25s', zIndex: 40 }} />
      <aside aria-hidden={!open} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 100vw)', background: C.surface, borderLeft: `1px solid ${C.line}`, boxShadow: '-24px 0 60px rgba(16,17,19,.12)', transform: open ? 'none' : 'translateX(104%)', transition: 'transform .32s cubic-bezier(.2,.8,.2,1)', zIndex: 41, display: 'flex', flexDirection: 'column' }}>
        {/* encabezado */}
        <header style={{ padding: '20px 22px 16px', borderBottom: `1px solid ${C.line2}`, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ width: 38, height: 38, borderRadius: 12, background: C.yellow, display: 'grid', placeItems: 'center', flex: 'none', overflow: 'hidden' }}><img src={MARK} alt="AXON" style={{ width: 30, height: 30, mixBlendMode: 'multiply' }} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: `650 10px ${FONT}`, color: C.gold, textTransform: 'uppercase', letterSpacing: '.16em' }}>Asesor IA</div>
            <div style={{ font: `250 19px/1.25 ${FONT}`, color: C.ink, marginTop: 3 }}>Axon Intelligence</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: `300 11px ${FONT}`, color: C.faint, marginTop: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: C.line }} />Conoce el modelo, el mercado y la valuación
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{ border: 0, background: 'transparent', cursor: 'pointer', width: 30, height: 30, borderRadius: 99, color: C.muted, font: `200 22px/1 ${FONT}` }}>×</button>
        </header>

        {/* conversación */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 22px 8px' }}>
          {msgs.length === 0 ? (
            <div>
              <div style={{ font: `200 30px/1.15 ${FONT}`, letterSpacing: '-0.03em', color: C.ink }}>¿Qué dudas tienes?</div>
              <div style={{ font: `300 13px/1.55 ${FONT}`, color: C.muted, marginTop: 10, maxWidth: 360 }}>Pregunta sobre el P&L, los supuestos, la valuación, el mercado o las perspectivas del negocio. Las respuestas se basan en las cifras actuales del modelo.</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14, padding: '10px 12px', borderRadius: 0, background: C.tint, border: `1px solid ${C.line2}`, font: `300 11.5px/1.5 ${FONT}`, color: C.muted, maxWidth: 380 }}>
                <span style={{ width: 5, height: 5, borderRadius: 99, background: C.yellow, flex: 'none', marginTop: 6 }} />
                <span>Las respuestas pueden tardar unos momentos: se utiliza <strong style={{ fontWeight: 600, color: C.ink2 }}>IA Avanzada</strong> que reúne varias plataformas y modelos de IA para analizar a fondo cada pregunta.</span>
              </div>
              <div style={{ font: `650 10px ${FONT}`, color: C.ink, textTransform: 'uppercase', letterSpacing: '.16em', margin: '28px 0 10px' }}>Sugerencias</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {AI_SUGGEST.map(s => (
                  <button key={s.q} onClick={() => send(s.q)}
                    style={{ textAlign: 'left', border: `1px solid ${C.line}`, background: C.tint, borderRadius: 0, padding: '12px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.yellowLine; e.currentTarget.style.background = C.yellowSoft; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.line; e.currentTarget.style.background = C.tint; }}>
                    <span style={{ font: `600 9.5px ${FONT}`, color: C.gold, textTransform: 'uppercase', letterSpacing: '.14em' }}>{s.k}</span>
                    <span style={{ font: `300 13px/1.4 ${FONT}`, color: C.ink }}>{s.q}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {msgs.filter(m => m.role === 'user' || m.text).map((m, i) => m.role === 'user' ? (
                <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '84%', background: C.ink, color: '#fff', borderRadius: '16px 16px 4px 16px', padding: '10px 14px', font: `300 13px/1.5 ${FONT}` }}>{m.text}</div>
              ) : (
                <div key={i} style={{ display: 'flex', gap: 10, maxWidth: '94%' }}>
                  <span style={{ width: 24, height: 24, borderRadius: 8, background: C.yellowSoft, display: 'grid', placeItems: 'center', flex: 'none', marginTop: 1 }}><img src={MARK} alt="" style={{ width: 18, height: 18, mixBlendMode: 'multiply' }} /></span>
                  <div style={{ font: `300 13px/1.6 ${FONT}`, color: C.ink2, minWidth: 0 }}>{m.text ? <Md text={m.text} /> : null}</div>
                </div>
              ))}
              {busy && (status || !msgs[msgs.length - 1]?.text) && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ width: 24, height: 24, borderRadius: 8, background: C.yellowSoft, display: 'grid', placeItems: 'center' }}><img src={MARK} alt="" style={{ width: 18, height: 18, mixBlendMode: 'multiply' }} /></span>
                  <span style={{ display: 'flex', gap: 4 }}>{[0, 1, 2].map(k => <span key={k} style={{ width: 5, height: 5, borderRadius: 99, background: C.gold, animation: `axonDot 1s ${k * .15}s infinite ease-in-out` }} />)}</span>
                  {status && <span style={{ font: `300 11.5px ${FONT}`, color: C.faint, fontStyle: 'italic' }}>{status}</span>}
                </div>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* entrada */}
        <div style={{ padding: '12px 18px 16px', borderTop: `1px solid ${C.line2}` }}>
          {msgs.length > 0 && <button onClick={() => setMsgs([])} style={{ border: 0, background: 'transparent', padding: '0 4px 8px', cursor: 'pointer', font: `300 11px ${FONT}`, color: C.faint, textDecoration: 'underline', textDecorationColor: C.line, textUnderlineOffset: 3 }}>Nueva conversación</button>}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, border: `1px solid ${C.line}`, borderRadius: 0, padding: '8px 8px 8px 14px', background: C.surface }}>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1} placeholder="Escribe tu pregunta…"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }}
              style={{ flex: 1, border: 0, outline: 'none', resize: 'none', font: `300 13.5px/1.5 ${FONT}`, color: C.ink, background: 'transparent', padding: '5px 0', maxHeight: 120 }} />
            <button onClick={() => send(draft)} disabled={!draft.trim() || busy} aria-label="Enviar"
              style={{ width: 34, height: 34, borderRadius: 11, border: 0, cursor: draft.trim() ? 'pointer' : 'default', background: draft.trim() ? C.yellow : C.tint2, color: draft.trim() ? C.ink : C.faint, display: 'grid', placeItems: 'center', transition: 'background .15s', flex: 'none' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
          </div>
          <div style={{ font: `300 9.5px ${FONT}`, color: C.faint, marginTop: 8, textAlign: 'center' }}>La IA puede equivocarse. Verifica las cifras antes de tomar decisiones.</div>
        </div>
      </aside>
    </>
  );
}

// ===================== Plataforma =====================
const MODULES = [
  { id: 'resumen', l: 'Resumen' }, { id: 'pl', l: 'P&L' }, { id: 'costos', l: 'Costos' }, { id: 'gastos', l: 'Gastos' }, { id: 'credito', l: 'Crédito bancario' }, { id: 'valuacion', l: 'Valuación' }, { id: 'flujo', l: 'Necesidad de capital' }, { id: 'supuestos', l: 'Supuestos' }, { id: 'mercado', l: 'Mercado' },
] as const;
type ModId = typeof MODULES[number]['id'];

// Puestos sin sueldo con montos fijos en 2027–2030: toma el sueldo de esos montos y los pasa a plantilla × sueldo (2026 queda fijo)
function wireAdmin(m: Model): boolean {
  let changed = false;
  // Solo existe el escenario Meta
  if (m.val.escenario !== 2) { m.val.escenario = 2; changed = true; }
  // Mantenimiento con contrato anual: la mensualidad queda fija después del primer mes
  m.clients.forEach(c => { const f = fijarMant(c.mant2, c.mant1[c.mant1.length - 1] ?? 0); if (JSON.stringify(f) !== JSON.stringify(c.mant2)) { c.mant2 = f; changed = true; } });
  // Primera disposición del capital nuevo: julio 2027 (inicio del T3)
  if (!m.migr?.primeraJul) { m.plan = { inicio: 14, colchonMeses: m.plan?.colchonMeses ?? 1, primera: 20 }; m.migr = { ...(m.migr ?? {}), primeraJul: true }; changed = true; }
  if (m.capex && !m.capex.equipos.porPersona && !m.migr?.equiposPersona) { m.capex.equipos = { ...m.capex.equipos, cantidad: 0, precio: 25000, porPersona: true }; m.migr = { ...(m.migr ?? {}), equiposPersona: true }; changed = true; }
  if (m.capex === undefined) { m.capex = { equipos: { cantidad: 0, precio: 25000, mes: 14, anios: 3, porPersona: true }, oficinas: { monto: 500000, mes: 20, anios: 5 } }; changed = true; }
  if (m.ciclo === undefined || m.ciclo[0]?.etapa === 'Primer contacto y calificación') { m.ciclo = [{"etapa": "ANÁLISIS DE MANAGEMENT Y PROCESOS / NDA", "dias": 30}, {"etapa": "PRIMERA MAQUETA", "dias": 30}, {"etapa": "AJUSTES A LA ARQUITECTURA (MAQUETAS)", "dias": 30}, {"etapa": "CIERRE, FIRMA DE CONTRATO Y ALTA COMO PROVEEDOR", "dias": 30}, {"etapa": "COMIENZO DESARROLLO Y FACTURACIÓN 50%", "dias": 15}, {"etapa": "PAGO 50%", "dias": 30}, {"etapa": "ENTREGA FINAL / GO-LIVE Y FACTURACIÓN 50%", "dias": 60}, {"etapa": "PAGO FINIQUITO 50%", "dias": 30}]; changed = true; }
  if (m.val.wc === undefined) { m.val.wc = { dso: 30, credito: 1, dio: 0, dpo: 30, base: 360 }; changed = true; }
  if (m.params.amortizarPerdidas === undefined) { m.params.amortizarPerdidas = true; changed = true; }
  if (m.params.aplicarPTU === undefined) { m.params.aplicarPTU = true; m.params.ptu = 0; changed = true; }
  if (m.params.aplicarInflacion === undefined) { m.params.aplicarInflacion = true; changed = true; }
  if (m.params.cargaSocial === undefined) { m.params.cargaSocial = 0.30; changed = true; }
  else if (m.params.cargaSocial < 0.28 || m.params.cargaSocial > 0.35) { m.params.cargaSocial = Math.min(0.35, Math.max(0.28, m.params.cargaSocial)); changed = true; }
  // Nombres de cliente: Marca automotriz → Empresa transnacional; Empresa N → Empresa mediana N; Grupo automotriz → Grupo empresarial
  m.clients.forEach(c => {
    const n = c.name.replace(/^MARCA AUTOMOTRIZ (\d+)$/, 'EMPRESA TRANSNACIONAL $1').replace(/^EMPRESA (\d+)$/, 'EMPRESA MEDIANA $1').replace(/^GRUPO AUTOMOTRIZ (\d+)$/, 'GRUPO EMPRESARIAL $1');
    if (n !== c.name) { c.name = n; changed = true; }
  });
  // Euphoria cobra el desarrollo inicial como cualquier Empresa mediana
  if (m.params.mantMediana === undefined || m.params.mantTrans === undefined) {
    const primero = (re: RegExp) => { for (const c of m.clients) if (re.test(c.name)) { const v = c.mant2.find(x => typeof x === 'number' && x > 0); if (typeof v === 'number') return v; } return undefined; };
    m.params.mantMediana ??= primero(/^EMPRESA MEDIANA/) ?? 15000;
    m.params.mantTrans ??= primero(/^EMPRESA TRANSNACIONAL/) ?? 23000;
    m.clients.forEach(c => {
      const tok = /^EMPRESA MEDIANA/.test(c.name) ? 'MANT_MEDIANA' : /^EMPRESA TRANSNACIONAL/.test(c.name) ? 'MANT_TRANS' : null;
      if (tok) c.mant2 = c.mant2.map(x => (typeof x === 'number' && x > 0 ? tok : x));
    });
    changed = true;
  }
  m.clients.forEach(c => { c.dev2 = c.dev2.map(x => { if (x === 'DEV_EUPH') { changed = true; return 'DEV_GRUPO'; } return x; }); });
  // Personal de implementación: su nómina es costo directo
  m.admin.forEach(r => { if (r.directo === undefined && /^(MANAGEMENT ADVISOR|ENTERPRISE ARCHITECT|AI ENGINEER)$/i.test(r.name.trim())) { r.directo = true; changed = true; } });
  // Migración de una sola vez: no vuelve a tocar montos que el usuario capture después
  if (m.migr?.salHc) return changed;
  m.migr = { ...(m.migr ?? {}), salHc: true }; changed = true;
  m.admin.forEach(r => {
    if (r.sal) return;
    const k0 = r.y.findIndex((c, k) => k > 0 && typeof c === 'number' && r.hc[k] > 0 && c > 0);
    if (k0 < 0) return;
    r.sal = (r.y[k0] as number) / r.hc[k0];
    r.y.forEach((c, k) => { if (k > 0 && typeof c === 'number') r.y[k] = { t: 'hc' }; });
    changed = true;
  });
  return changed;
}

export default function AxonPLForecast() {
  const [M, setM] = useState<Model>(() => {
    try {
      const s = localStorage.getItem(STORE);
      if (s && localStorage.getItem(STORE_BASE) !== BASE) { localStorage.removeItem(STORE); localStorage.removeItem(STORE_BASE); }
      else if (s) {
        const m: Model = JSON.parse(s);
        // Renombra los conceptos genéricos guardados ("Concepto N" → "OTRO")
        m.opex.forEach(l => { if (/^Concepto \d+$/.test(l.name)) l.name = 'OTRO'; });
        let k = 1; m.mkt.forEach(l => { if (/^Concepto \d+$/.test(l.name)) l.name = `OTRO ${k++}`; });
        wireAdmin(m);
        return m;
      }
    } catch { /* sin almacenamiento */ }
    return clone(DEFAULT);
  });
  // También al recargar el código en caliente (el estado se conserva)
  useEffect(() => { setM(prev => { const n = clone(prev); return wireAdmin(n) ? n : prev; }); }, []);
  const [mod, setMod] = useState<ModId>(() => {
    const h = (typeof location !== 'undefined' ? location.hash.slice(1) : '') as ModId;
    return MODULES.some(m => m.id === h) ? h : 'resumen';
  });
  // Los cambios se guardan solo al pulsar "Guardar"
  const [saved, setSaved] = useState(() => JSON.stringify(M));
  const unsaved = useMemo(() => JSON.stringify(M) !== saved, [M, saved]);
  const [justSaved, setJustSaved] = useState(false);
  const save = () => {
    const s = JSON.stringify(M);
    try { localStorage.setItem(STORE, s); localStorage.setItem(STORE_BASE, BASE); } catch { /* sin almacenamiento */ }
    // En local también queda como versión de inicio (src/data/model.json) para el commit
    if (import.meta.env.DEV) fetch('/api/guardar-modelo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: s }).catch(() => { /* */ });
    setSaved(s); setJustSaved(true); setTimeout(() => setJustSaved(false), 1800);
  };
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  useEffect(() => {
    const on = () => { const h = location.hash.slice(1) as ModId; if (MODULES.some(m => m.id === h)) setMod(h); };
    window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (id: ModId) => { setMod(id); try { history.replaceState(null, '', `#${id}`); } catch { /* */ } window.scrollTo({ top: 0 }); };
  const R = useMemo(() => compute(M), [M]);
  const set = (f: (m: Model) => void) => setM(prev => { const n = clone(prev); f(n); return n; });
  const dirty = useMemo(() => JSON.stringify(M) !== JSON.stringify(DEFAULT), [M]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const aiCtx = useMemo(() => aiContext(M, R), [M, R]);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, font: `400 14px ${FONT}`, color: C.ink, display: 'flex', flexDirection: 'column' }}>
      <style>{`
        * { box-sizing: border-box; } body { margin: 0; background: ${C.bg}; }
        section table tr > *:last-child { padding-right: 24px !important; }
        input:focus { border-color: ${C.ink} !important; box-shadow: 0 0 0 3px ${C.yellowSoft}; }
        button:focus-visible { outline: 2px solid ${C.ink}; outline-offset: 2px; }
        .axon-range { -webkit-appearance: none; appearance: none; width: 100%; height: 3px; border-radius: 99px; outline: none; cursor: pointer; margin: 0; }
        .axon-range::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 99px; background: ${C.surface}; border: 1.5px solid ${C.ink}; box-shadow: 0 1px 4px rgba(16,17,19,.18); transition: transform .15s; }
        .axon-range::-webkit-slider-thumb:hover { transform: scale(1.12); }
        .axon-range::-moz-range-thumb { width: 16px; height: 16px; border-radius: 99px; background: ${C.surface}; border: 1.5px solid ${C.ink}; }
        .axon-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px ${C.yellowSoft}; }
        @keyframes axonDot { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
        @media (max-width: 1000px) { .axon-ing { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; } }
        @media (max-width: 760px) { .axon-two { grid-template-columns: 1fr !important; } .axon-hide-sm { display: none !important; } }
      `}</style>
      <header style={{ background: C.surface, borderBottom: `1px solid ${C.line}`, position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '14px 28px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <img src={LOGO} alt="axon · Advanced AI Applied to Enterprise" style={{ height: 34, display: 'block' }} />
            <div className="axon-hide-sm" style={{ width: 1, height: 30, background: C.line }} />
            <div className="axon-hide-sm">
              <div style={{ font: `650 15px ${FONT}`, letterSpacing: '-0.01em' }}>P&L Forecast</div>
              <div style={{ font: `450 12px ${FONT}`, color: C.muted }}>Presupuesto 2026–2030 · MXN</div>
            </div>
            <span style={{ font: `650 10.5px ${FONT}`, letterSpacing: '.1em', padding: '4px 9px', borderRadius: 999, border: `1px solid ${C.ink}`, color: C.ink }}>CONFIDENCIAL</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <button onClick={save} title="Guardar la versión actual en este navegador"
              style={{ ...btn, minWidth: 112, background: C.ink, color: '#fff', borderColor: C.ink }}>
              {justSaved ? 'Guardado ✓' : unsaved ? 'Guardar •' : 'Guardar'}
            </button>
            {unsaved && <button style={{ border: 0, background: 'transparent', padding: '2px 2px', cursor: 'pointer', font: `300 11.5px ${FONT}`, color: C.faint, textDecoration: 'underline', textDecorationColor: C.line, textUnderlineOffset: 3 }}
              onClick={() => { const m: Model = JSON.parse(saved); setM(m); }}>Volver a lo último guardado</button>}
            {dirty && (confirmReset
              ? <span style={{ display: 'flex', gap: 6 }}><button style={{ ...btn, background: C.ink, color: '#fff', borderColor: C.ink }} onClick={() => { setM(clone(DEFAULT)); setConfirmReset(false); }}>Confirmar</button><button style={btn} onClick={() => setConfirmReset(false)}>Cancelar</button></span>
              : <button style={{ border: 0, background: 'transparent', padding: '4px 2px', cursor: 'pointer', font: `300 11.5px ${FONT}`, color: C.faint, textDecoration: 'underline', textDecorationColor: C.line, textUnderlineOffset: 3 }} onClick={() => setConfirmReset(true)}>Restablecer supuestos</button>)}
            </div>
            <AIButton onClick={() => setAiOpen(true)} />
          </div>
        </div>
        <nav style={{ maxWidth: 1440, margin: '0 auto', padding: '0 20px', display: 'flex', gap: 4, overflowX: 'auto', marginTop: 10 }}>
          {MODULES.map(m => (
            m.id === 'flujo' || m.id === 'valuacion' ? (
              <button key={m.id} onClick={() => go(m.id)} aria-current={mod === m.id ? 'page' : undefined}
                style={{ border: 0, background: C.ink, cursor: 'pointer', padding: '7px 14px', margin: '3px 0 5px 8px', borderRadius: 8, font: `700 13.5px ${FONT}`, color: C.yellow, whiteSpace: 'nowrap', alignSelf: 'center', boxShadow: mod === m.id ? `0 0 0 2px ${C.yellow}` : undefined }}>
                {m.l}
              </button>
            ) : (
            <button key={m.id} onClick={() => go(m.id)} aria-current={mod === m.id ? 'page' : undefined}
              style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: '10px 10px 12px', font: `${mod === m.id ? 600 : 300} 13.5px ${FONT}`, color: mod === m.id ? C.ink : C.muted, borderBottom: `2px solid ${mod === m.id ? C.yellow : 'transparent'}`, whiteSpace: 'nowrap' }}>
              {m.l}
            </button>
            )
          ))}
        </nav>
      </header>

      <main style={{ maxWidth: 1440, width: '100%', margin: '0 auto', padding: '22px 28px 32px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, font: `200 34px ${FONT}`, letterSpacing: '-0.035em' }}>{MODULES.find(m => m.id === mod)!.l}</h1>
        </div>
        {mod === 'resumen' && <Resumen R={R} M={M} />}
        {mod === 'supuestos' && <Supuestos M={M} R={R} set={set} />}
        {mod === 'pl' && <PL M={M} R={R} set={set} />}
        {mod === 'flujo' && <FlujoTab M={M} R={R} set={set} />}
        {mod === 'costos' && <Costos M={M} R={R} set={set} />}
        {mod === 'gastos' && <Gastos M={M} R={R} set={set} />}
        {mod === 'credito' && <Credito M={M} R={R} set={set} />}
        {mod === 'valuacion' && <Valuacion M={M} R={R} set={set} />}
        {mod === 'mercado' && <Mercado />}
      </main>

      <AIChat open={aiOpen} onClose={() => setAiOpen(false)} context={aiCtx} />

      <footer style={{ borderTop: `1px solid ${C.line}`, background: C.surface }}>
        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '14px 28px', display: 'flex', justifyContent: 'center', font: `500 12px ${FONT}`, color: C.muted, letterSpacing: '.04em' }}>
          Powered by AXON B2B
        </div>
      </footer>
    </div>
  );
}
