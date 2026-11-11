import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { compute, type Model, type Result, type MCell, type GCell, type Series, type PLKey } from './lib/engine';
import DATA from './data/model.json';
import LOGO from './assets/axon-logo.png';

// ===================== Marca AXON =====================
const C = {
  bg: '#F4F3EE', surface: '#FFFFFF', ink: '#101113', ink2: '#3A3D42', muted: '#6B6E76', faint: '#9A9DA4',
  line: '#E4E2DA', line2: '#EEEDE7', yellow: '#F8C908', yellowSoft: '#FEF6D2', yellowLine: '#EBD27A',
  tint: '#FCFBF7', tint2: '#F8F7F2', gold: '#C99700', graphite: '#3A3D42', neg: '#B42318', pos: '#1E7A46', posSoft: '#E6F2EA', negSoft: '#FBEAE8',
};
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
const STORE = 'axon-pl-forecast-v1';
const DEFAULT: Model = DATA as unknown as Model;
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
  const eb = eyebrow ?? (mt ? `Paso 0${mt[1]}` : undefined), tt = mt ? mt[2] : title;
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, overflow: 'hidden' }}>
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
  const m = { l: 60, r: 28, t: 16, b: 28 }, iw = w - m.l - m.r, ih = height - m.t - m.b;
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
  const kpis: FineKpiDef[] = [
    { label: 'Ventas totales', sub: 'Año 1 - Año 5', value: short(ventasTot), note: `${short(A.venta[0])} → ${short(A.venta[4])}` },
    { label: 'TCAC', sub: 'Año 1 - Año 5', value: pct(cagr15), note: `Ventas ${YEARS_S[0]}–${YEARS_S[4]}`, tone: 'pos' },
    { label: 'TIR', value: pct(tir), note: `vs. WACC ${pct(R.v.wacc)}`, tone: tir >= R.v.wacc ? 'pos' : 'neg' },
    { label: 'VPN', value: short(vpn), note: 'Utilidad neta años 1–5 al WACC', tone: vpn >= 0 ? 'pos' : 'neg' },
    { label: 'Payback', value: isFinite(pb) ? pb.toFixed(1) : '—', unit: isFinite(pb) ? 'años' : undefined, note: `Inversión máx. ${short(minAcum)} · equilibrio ${beLabel}` },
    { label: 'Valuación', sub: 'DFC', value: short(R.v.equity), note: 'Valor del capital' },
  ];
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <FineKpis items={kpis} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
        <Card eyebrow="01 · Crecimiento" title="Ventas y utilidad neta por año" sub="Escenario Meta">
          <Legend fine items={[{ c: C.graphite, l: 'Ventas totales' }, { c: C.gold, l: 'Utilidad neta (% de ventas)' }]} />
          <BarChart fine labels={YEARS_S} showLabels series={[{ name: 'Ventas', color: C.graphite, values: A.venta }, { name: 'Utilidad neta', color: C.gold, values: A.un, fmt: (v, i) => pct(ratio(v, A.venta[i])) }]} />
        </Card>
        <Card eyebrow="02 · Liquidez" title="Resultado acumulado" sub="Curva J · mensual nov-25 a dic-27, cierres anuales 2028–2030">
          <Legend fine items={[{ c: C.ink, l: 'Resultado acumulado' }, { c: C.ink, l: 'Cierre anual', dash: true }]} />
          <LineChart fine points={pts} refLine={0} />
        </Card>
      </div>
      <Card eyebrow="03 · Estado de resultados" title="Estado de resultados resumido" sub="MXN nominales" pad={false}>
        <PLTable fine cols={YEARS} data={A} rows={SUMMARY_ROWS} acum={R.acumY} />
      </Card>
    </div>
  );
}

// ---------- Piezas de diseño fino (Resumen) ----------
type FineKpiDef = { label: string; sub?: string; value: string; unit?: string; note?: string; tone?: 'pos' | 'neg' };
function FineKpis({ items }: { items: FineKpiDef[] }) {
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', overflow: 'hidden' }}>
      {items.map((k, i) => (
        <div key={k.label} style={{ padding: '22px 22px 20px', borderLeft: i ? `1px solid ${C.line2}` : 'none', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 132 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minHeight: 28 }}>
            <span style={{ font: `650 10px ${FONT}`, color: C.ink, textTransform: 'uppercase', letterSpacing: '.16em' }}>{k.label}</span>
            {k.sub && <span style={{ font: `300 10px ${FONT}`, color: C.faint, textTransform: 'uppercase', letterSpacing: '.12em' }}>{k.sub}</span>}
          </div>
          <div style={{ font: `200 36px/1 ${FONT}`, color: C.ink, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {k.value}{k.unit && <span style={{ font: `300 14px ${FONT}`, color: C.muted, letterSpacing: 0, marginLeft: 6 }}>{k.unit}</span>}
          </div>
          {k.note && (
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'flex-start', gap: 7, font: `300 11.5px/1.4 ${FONT}`, color: C.muted }}>
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
type RowDef = { k?: PLKey; l: string; t?: 'total' | 'pct' | 'sec' | 'acum' | 'growth'; num?: PLKey; den?: PLKey };
const PL_ROWS: RowDef[] = [
  { l: 'Ingresos', t: 'sec' },
  { k: 'dev', l: 'Desarrollo inicial' }, { k: 'mant', l: 'Mantenimiento mensual' }, { k: 'otros', l: 'Otros ingresos' },
  { k: 'venta', l: 'Total venta', t: 'total' },
  { l: 'Costos directos', t: 'sec' },
  { k: 'ia', l: 'Consumo IA' }, { k: 'repos', l: 'Repositorios' }, { k: 'host', l: 'Hostings' }, { k: 'plat', l: 'Plataformas (TC)' }, { k: 'comis', l: 'Comisiones' },
  { k: 'costos', l: 'Total costos', t: 'total' },
  { k: 'ub', l: 'Utilidad bruta', t: 'total' }, { l: 'Margen bruto', t: 'pct', num: 'ub', den: 'venta' },
  { l: 'Gastos', t: 'sec' },
  { k: 'go', l: 'Gasto operativo' }, { k: 'ga', l: 'Gasto administrativo' }, { k: 'mkt', l: 'Gasto de marketing y ventas' }, { k: 'capex', l: 'CAPEX / gasto inicial' }, { k: 'otrosg', l: 'Otros gastos' }, { k: 'da', l: 'D&A' },
  { k: 'gasto', l: 'Total gasto', t: 'total' }, { l: '% gasto / venta', t: 'pct', num: 'gasto', den: 'venta' },
  { k: 'uo', l: 'Utilidad de operación', t: 'total' }, { l: 'Margen de operación', t: 'pct', num: 'uo', den: 'venta' },
  { k: 'cif', l: 'CIF (intereses)' }, { k: 'uai', l: 'Utilidad antes de impuestos', t: 'total' }, { k: 'isr', l: 'Impuestos' },
  { k: 'un', l: 'Utilidad neta', t: 'total' }, { l: 'Margen neto', t: 'pct', num: 'un', den: 'venta' },
  { l: 'Resultado acumulado', t: 'acum' },
];
const SUMMARY_ROWS: RowDef[] = [
  { k: 'venta', l: 'Total venta', t: 'total' }, { k: 'venta', l: 'Crecimiento de ventas', t: 'growth' },
  { k: 'costos', l: 'Total costos' }, { l: '% costo / venta', t: 'pct', num: 'costos', den: 'venta' },
  { k: 'ub', l: 'Utilidad bruta', t: 'total' }, { l: 'Margen bruto', t: 'pct', num: 'ub', den: 'venta' },
  { k: 'gasto', l: 'Total gasto' }, { l: '% gasto / venta', t: 'pct', num: 'gasto', den: 'venta' },
  { k: 'uo', l: 'Utilidad de operación (EBITDA)', t: 'total' }, { l: 'Margen de operación', t: 'pct', num: 'uo', den: 'venta' },
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
            const bg = r.t === 'total' && !fine ? C.tint : C.surface;
            const td: React.CSSProperties = !fine ? tdBase : isPctRow(r) ? { ...tdF, padding: cp ? `0 ${px}px 7px` : '0 12px 11px', borderBottom: `1px solid ${C.line2}` } : r.t === 'acum' ? { ...tdF, padding: cp ? `10px ${px}px` : '14px 12px', borderTop: `1px solid ${C.ink}` } : nextPct ? tdF : { ...tdF, padding: cp ? `7px ${px}px` : '10px 12px', borderBottom: `1px solid ${C.line2}` };
            const isPct = r.t === 'pct' || r.t === 'growth';
            const vals = r.t === 'growth' ? data[r.k!].map((v, i) => (i ? ratio(v, data[r.k!][i - 1]) - 1 : NaN)) : isPct ? data[r.num!].map((v, i) => ratio(v, data[r.den!][i])) : r.t === 'acum' ? acum : data[r.k!];
            const tv = r.t === 'growth' ? NaN : isPct ? ratio(tot(r.num!), tot(r.den!)) : r.t === 'acum' ? acum[n - 1] : tot(r.k!);
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
    <button title={linked ? 'Vinculado a un supuesto de Gastos (se recalcula). Clic para fijar un monto.' : 'Arrastra el valor del mes anterior. Clic para fijar un monto.'}
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
                    <CellM cell={cell} value={y2[kind][k]} onSet={v => set(m => { (kind === 'dev' ? m.clients[i].dev2 : m.clients[i].mant2)[k] = v; })} />
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

function PL({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const [view, setView] = useState<'anual' | 'y1' | 'y2' | 'cartera'>('anual');
  const m1 = M.months1.map(m => (/\d/.test(m) ? m : `${m} 26`)), m2 = M.months2.map(m => `${m} 27`);
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Segmented value={view} onChange={setView} options={[{ v: 'anual', l: 'Anual · 5 años' }]} />
          <Segmented warm value={view} onChange={setView} options={[{ v: 'y1', l: 'Año 1 · mensual' }, { v: 'y2', l: 'Año 2 · mensual' }]} />
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ font: `300 12.5px ${FONT}`, color: C.muted }}>MXN nominales · negativos en rojo entre paréntesis</span>
          <button onClick={() => setView(view === 'cartera' ? 'y2' : 'cartera')} aria-pressed={view === 'cartera'}
            style={{ ...btn, background: view === 'cartera' ? C.ink : C.surface, color: view === 'cartera' ? '#fff' : C.ink, borderColor: view === 'cartera' ? C.ink : C.line }}>
            {view === 'cartera' ? '← Volver al P&L' : 'Cartera de clientes'}
          </button>
        </span>
      </div>
      {view === 'cartera' ? <Cartera M={M} R={R} set={set} /> : (
        <Card pad={false}
          title={view === 'anual' ? 'Estado de resultados proyectado' : view === 'y1' ? 'Año 1 · nov-25 a dic-26 (14 meses)' : 'Año 2 · 2027'}
          sub={view === 'anual' ? 'Años 3–5 proyectados con el escenario Meta' : view === 'y1' ? 'Presupuesto/ejercido capturado en el modelo' : 'Calculado desde la cartera de clientes y la estructura de gastos'}>
          {view === 'anual' && <PLTable compact cols={YEARS} data={R.annual} rows={PL_ROWS} acum={R.acumY} />}
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
  const hint = cell.t === 'hc' ? 'Plantilla × sueldo' : cell.t === 'C' ? (cell.k === 1 ? `= ${base}` : `${base} ×${cell.k}`) : 'Crecimiento vs. año anterior';
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

function LineTable({ title, sub, lines, vals, tot, onBase, onCell, onName }: { title: string; sub: string; lines: { name: string; base: number; y: GCell[] }[]; vals: number[][]; tot: number[]; onBase: (i: number, v: number) => void; onCell: (i: number, k: number, c: GCell) => void; onName: (i: number, v: string) => void }) {
  return (
    <Card title={title} sub={sub} pad={false}>
      <ScrollX>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
          <thead><tr><th style={{ ...th, ...stickyL, background: C.surface }}>Concepto</th><th style={th}>Base mensual</th>{YEARS_S.map(y => <th key={y} style={th}>{y}</th>)}</tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={{ ...tdBase, ...stickyL }}><input value={l.name} onChange={e => onName(i, e.target.value)} placeholder="Concepto nuevo" aria-label="Nombre del concepto (editable)" style={{ border: `1px solid ${C.yellowLine}`, borderRadius: 6, padding: '4px 8px', outline: 'none', font: `400 13px ${FONT}`, color: C.ink, background: C.yellowSoft, width: nameW(lines.map(x => x.name)) }} /></td>
                <td style={tdBase}><NumInput value={l.base} onChange={v => onBase(i, v)} width={92} /></td>
                {l.y.map((c, k) => <td key={k} style={tdBase}><GCellView cell={c} value={vals[i][k]} base="base" onSet={nc => onCell(i, k, nc)} /></td>)}
              </tr>
            ))}
            <tr><td style={{ ...tdBase, ...stickyL, fontWeight: 650, color: C.ink, background: C.tint }}>Total mensual</td><td style={{ ...tdBase, background: C.tint }} />
              {tot.map((v, k) => <td key={k} style={{ ...tdBase, fontWeight: 650, color: C.ink, background: C.tint }}>{money(v)}</td>)}</tr>
          </tbody>
        </table>
      </ScrollX>
    </Card>
  );
}

const PARAM_DEFS: { k: keyof Model['params']; l: string; kind: 'money' | 'pct' | 'num'; g: string }[] = [
  { k: 'comision', l: 'Comisiones B2B (% del desarrollo)', kind: 'pct', g: 'Tasas' },
  { k: 'isr', l: 'Tasa de impuestos (ISR)', kind: 'pct', g: 'Tasas' },
  { k: 'ptu', l: 'PTU', kind: 'pct', g: 'Tasas' },
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
  { k: 'mantAgencia', l: 'Mantenimiento grupo empresarial – costo por Unidad de Negocio', kind: 'money', g: 'Ingresos' },
  { k: 'agenciasGrupo', l: 'Mantenimiento grupo empresarial – Unidades de Negocio por grupo', kind: 'num', g: 'Ingresos' },
  { k: 'empresasY1', l: 'Empresas activas al cierre de 2026', kind: 'num', g: 'Ingresos' },
];

function Gastos({ M, R, set }: { M: Model; R: Result; set: (f: (m: Model) => void) => void }) {
  const G = R.gastos;
  const groups = ['Ingresos', 'Costos', 'Tasas'];
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <FineKpis items={[
        { label: 'Gasto mensual', sub: '2027', value: short(G.opexTot[1] + G.adminTot[1] + G.mktTot[1]), note: 'Operativo + administrativo + marketing' },
        { label: 'Gasto mensual', sub: '2030', value: short(G.opexTot[4] + G.adminTot[4] + G.mktTot[4]), note: 'Antes de inflación' },
        { label: 'Plantilla', sub: '2027 → 2030', value: `${G.hcTot[1]} → ${G.hcTot[4]}`, unit: 'personas' },
        { label: 'Nómina mensual', sub: '2030', value: short(G.adminTot[4]), note: `${pct(ratio(G.adminTot[4] * 12, R.annual.venta[4]))} de la venta anual` },
      ]} />

      <LineTable title="Gasto operativo mensual" sub="Montos mensuales por año; el P&L los anualiza y aplica inflación a partir de 2028." lines={M.opex} vals={G.opex} tot={G.opexTot}
        onBase={(i, v) => set(m => { m.opex[i].base = v; })} onCell={(i, k, c) => set(m => { m.opex[i].y[k] = c; })} onName={(i, v) => set(m => { m.opex[i].name = v; })} />

      <Card title="Gasto administrativo · plantilla" sub="Personas por año y costo mensual. De 2027 a 2030 el costo es plantilla × sueldo mensual; 2026 queda capturado como monto fijo." pad={false}>
        <ScrollX>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
            <thead>
              <tr><th style={{ ...th, ...stickyL, background: C.surface }} /><th style={th} /><th colSpan={5} style={{ ...th, textAlign: 'center', color: C.ink }}>Plantilla (personas)</th><th colSpan={5} style={{ ...th, textAlign: 'center', color: C.ink }}>Costo mensual</th></tr>
              <tr><th style={{ ...th, ...stickyL, background: C.surface }}>Puesto</th><th style={th}>Sueldo mensual</th>{YEARS_S.map(y => <th key={'h' + y} style={th}>{y}</th>)}{YEARS_S.map(y => <th key={'c' + y} style={th}>{y}</th>)}</tr>
            </thead>
            <tbody>
              {M.admin.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...tdBase, ...stickyL }}><input value={r.name} onChange={e => set(m => { m.admin[i].name = e.target.value; })} style={{ border: 0, outline: 'none', font: `400 13px ${FONT}`, color: C.ink, background: 'transparent', width: nameW(M.admin.map(x => x.name), 14) }} /></td>
                  <td style={tdBase}><NumInput value={r.sal} onChange={v => set(m => { m.admin[i].sal = v; })} width={88} /></td>
                  {r.hc.map((h, k) => <td key={'h' + k} style={tdBase}><NumInput kind="num" value={h} onChange={v => set(m => { m.admin[i].hc[k] = v; })} width={46} /></td>)}
                  {r.y.map((c, k) => <td key={'c' + k} style={tdBase}>{k === 0
                    ? <div title="Monto fijo de 2026" style={{ color: C.faint }}>{money(G.admin[i][0])}</div>
                    : <GCellView cell={c} value={G.admin[i][k]} base="sueldo" onSet={nc => set(m => { m.admin[i].y[k] = nc; })} />}</td>)}
                </tr>
              ))}
              <tr>
                <td style={{ ...tdBase, ...stickyL, fontWeight: 650, color: C.ink, background: C.tint }}>Total</td><td style={{ ...tdBase, background: C.tint }} />
                {G.hcTot.map((v, k) => <td key={'th' + k} style={{ ...tdBase, fontWeight: 650, color: C.ink, background: C.tint }}>{v}</td>)}
                {G.adminTot.map((v, k) => <td key={'tc' + k} style={{ ...tdBase, fontWeight: 650, color: C.ink, background: C.tint }}>{money(v)}</td>)}
              </tr>
            </tbody>
          </table>
        </ScrollX>
      </Card>

      <LineTable title="Gasto de marketing y ventas" sub="2027 arranca al 50% en el primer semestre y al 100% en el segundo." lines={M.mkt} vals={G.mkt} tot={G.mktTot}
        onBase={(i, v) => set(m => { m.mkt[i].base = v; })} onCell={(i, k, c) => set(m => { m.mkt[i].y[k] = c; })} onName={(i, v) => set(m => { m.mkt[i].name = v; })} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {groups.map(gname => (
          <Card key={gname} title={gname === 'Ingresos' ? 'Supuestos de ingresos' : gname === 'Costos' ? 'Supuestos de costos' : 'Tasas generales'}>
            <div style={{ display: 'grid', gap: 8 }}>
              {PARAM_DEFS.filter(p => p.g === gname).map(p => (
                <div key={p.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <span style={{ font: `300 13px ${FONT}`, color: C.ink2 }}>{p.l}</span>
                  <NumInput kind={p.kind} value={M.params[p.k]} width={p.kind === 'money' ? 104 : 72} onChange={v => set(m => { m.params[p.k] = v; })} />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
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
        <Card title="Condiciones del crédito" sub="Amortización a saldos insolutos, capital constante">
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
        <Card title="Pago anual: capital e intereses" sub="El P&L registra los intereses como CIF a partir de enero 2027">
          <Legend items={[{ c: C.graphite, l: 'Capital' }, { c: C.gold, l: 'Intereses' }]} />
          <BarChart labels={cr.years.map((_, i) => `Año ${i + 1}`)} series={[{ name: 'Capital', color: C.graphite, values: cr.years.map(y => y.capital) }, { name: 'Intereses', color: C.gold, values: cr.years.map(y => y.interes) }]} height={240} />
        </Card>
      </div>
      <Card title="Tabla de amortización" sub={showAll ? `${cr.rows.length} periodos` : 'Primeros 12 periodos'} right={<button onClick={() => setShowAll(!showAll)} style={btn}>{showAll ? 'Ver primeros 12' : 'Ver tabla completa'}</button>} pad={false}>
        <div style={{ overflowX: 'auto', maxHeight: showAll ? 520 : undefined, overflowY: showAll ? 'auto' : undefined }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
            <thead><tr>{['Periodo', 'Interés', 'Capital', 'Pago mensual', 'Saldo pendiente'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.n} style={{ background: r.n % 12 === 0 ? C.tint : undefined }}>
                <td style={tdBase}>{r.n}</td><td style={tdBase}>{money(r.interes)}</td><td style={tdBase}>{money(r.capital)}</td><td style={{ ...tdBase, fontWeight: 600, color: C.ink }}>{money(r.pago)}</td><td style={tdBase}>{money(r.saldo)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </Card>
      <Card title="Resumen anual" pad={false}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
          <thead><tr>{['Año', 'Pago total', 'Intereses', 'Capital'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{cr.years.map((y, i) => <tr key={i}><td style={tdBase}>Año {i + 1}</td><td style={{ ...tdBase, fontWeight: 600, color: C.ink }}>{money(y.pago)}</td><td style={tdBase}>{money(y.interes)}</td><td style={tdBase}>{money(y.capital)}</td></tr>)}</tbody>
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
    <Card title={title} sub={`Valor del capital (MXN). Sombreado: alcanza la meta de ${short(meta)}`} pad={false}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
        <thead><tr><th style={{ ...th, textAlign: 'left' }}>{rowLabel} \ g</th>{cols.map(c => <th key={c} style={th}>{pct(c)}</th>)}</tr></thead>
        <tbody>{m.map((r, i) => (
          <tr key={i}>
            <td style={{ ...tdBase, textAlign: 'left', fontWeight: 600, color: C.ink }}>{fmtRow(rows[i])}</td>
            {r.map((v, j) => {
              const isBase = i === base && j === 2, ok = v >= meta;
              return <td key={j} style={{ ...tdBase, background: ok ? C.yellowSoft : C.surface, fontWeight: isBase ? 650 : 300, color: C.ink, outline: isBase ? `1px solid ${C.ink}` : undefined, outlineOffset: -2 }}>{short(v)}</td>;
            })}
          </tr>))}</tbody>
      </table>
    </Card>
  );
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
      <FineKpis items={[
        { label: 'Valor del capital', value: short(v.equity), note: `${v.cumple ? 'Cumple' : 'No cumple'} meta de ${short(V.meta)}`, tone: v.cumple ? 'pos' : 'neg' },
        { label: 'Valor de la empresa', sub: 'EV', value: short(v.ev), note: `EV / Ventas 2027: ${v.evVentas.toFixed(2)}x` },
        { label: 'WACC', value: pct(v.wacc, 2), note: `Ke ${pct(v.ke, 2)} · Kd neto ${pct(v.kdAt, 2)}` },
        { label: 'Peso del valor terminal', value: pct(v.pctTv), note: `EV / EBITDA 2030 implícito: ${v.evEbitda.toFixed(2)}x` },
      ]} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, alignItems: 'start' }}>
        <Card title="1 · Tasa de descuento (WACC)" sub="CAPM en pesos con primas por tamaño y etapa">
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
          <Card title="Escenario Meta · años 3–5" sub="Crecimiento de volumen de clientes y precio de desarrollo en 2028–2030" pad={false}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
              <thead><tr><th style={{ ...th, textAlign: 'left' }}>Supuesto</th>{['2028', '2029', '2030'].map(y => <th key={y} style={th}>{y}</th>)}</tr></thead>
              <tbody>
                <tr><td style={{ ...tdBase, textAlign: 'left' }}>Crecimiento de volumen</td>{scenRow('volMeta')}</tr>
                <tr><td style={{ ...tdBase, textAlign: 'left' }}>Aumento de precio</td>{scenRow('precioMeta')}</tr>
                <tr><td style={{ ...tdBase, textAlign: 'left', fontWeight: 650, color: C.ink, background: C.tint }}>Ventas proyectadas</td>{[2, 3, 4].map(i => <td key={i} style={{ ...tdBase, fontWeight: 650, color: C.ink, background: C.tint }}>{short(R.annual.venta[i])}</td>)}</tr>
              </tbody>
            </table>
            <div style={{ padding: '12px 20px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ font: `300 13px ${FONT}`, color: C.ink2 }}>Meta de valor del capital</span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{inp('meta', 'money', 120)}
                <span style={{ font: `650 12px ${FONT}`, padding: '4px 10px', borderRadius: 999, background: v.cumple ? C.posSoft : C.negSoft, color: v.cumple ? C.pos : C.neg }}>{v.cumple ? '✓ Cumple' : '✕ No cumple'}</span></span>
            </div>
          </Card>
          <Card title="2 · Flujo libre y valor terminal">
            <KV l="D&A (% de ventas)">{inp('da')}</KV>
            <KV l="CAPEX (% de ventas)">{inp('capex')}</KV>
            <KV l="Capital de trabajo (% del aumento en ventas)">{inp('ct')}</KV>
            <KV l="Crecimiento a perpetuidad (g)">{inp('g')}</KV>
            <KV l="Caja al 31-dic-2026">{inp('caja', 'money', 110)}</KV>
            <KV l="Deuda bancaria al 31-dic-2026" note="Vinculada al módulo Crédito bancario">${money(v.deuda)}</KV>
          </Card>
        </div>
      </div>

      <Card title="3 · Flujo libre de caja y descuento" sub="Descuento a mitad de año; valor terminal descontado 4.0 años" pad={false}>
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

      <Card title="4 · Del valor de la empresa al valor del capital" sub={`Valor terminal al cierre de 2030: ${short(v.tv)} (flujo terminal ${short(v.fcffT)} ÷ (WACC − g))`}>
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

// ===================== Plataforma =====================
const MODULES = [
  { id: 'resumen', l: 'Resumen' }, { id: 'pl', l: 'P&L' }, { id: 'gastos', l: 'Gastos' }, { id: 'credito', l: 'Crédito bancario' }, { id: 'valuacion', l: 'Valuación' },
] as const;
type ModId = typeof MODULES[number]['id'];

// Puestos sin sueldo con montos fijos en 2027–2030: toma el sueldo de esos montos y los pasa a plantilla × sueldo (2026 queda fijo)
function wireAdmin(m: Model): boolean {
  let changed = false;
  // Solo existe el escenario Meta
  if (m.val.escenario !== 2) { m.val.escenario = 2; changed = true; }
  // Nombres de cliente: Marca automotriz → Empresa transnacional; Empresa N → Empresa mediana N; Grupo automotriz → Grupo empresarial
  m.clients.forEach(c => {
    const n = c.name.replace(/^MARCA AUTOMOTRIZ (\d+)$/, 'EMPRESA TRANSNACIONAL $1').replace(/^EMPRESA (\d+)$/, 'EMPRESA MEDIANA $1').replace(/^GRUPO AUTOMOTRIZ (\d+)$/, 'GRUPO EMPRESARIAL $1');
    if (n !== c.name) { c.name = n; changed = true; }
  });
  // Euphoria cobra el desarrollo inicial como cualquier Empresa mediana
  m.clients.forEach(c => { c.dev2 = c.dev2.map(x => { if (x === 'DEV_EUPH') { changed = true; return 'DEV_GRUPO'; } return x; }); });
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
      if (s) {
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
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(M)); } catch { /* sin almacenamiento */ } }, [M]);
  useEffect(() => {
    const on = () => { const h = location.hash.slice(1) as ModId; if (MODULES.some(m => m.id === h)) setMod(h); };
    window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (id: ModId) => { setMod(id); try { history.replaceState(null, '', `#${id}`); } catch { /* */ } window.scrollTo({ top: 0 }); };
  const R = useMemo(() => compute(M), [M]);
  const set = (f: (m: Model) => void) => setM(prev => { const n = clone(prev); f(n); return n; });
  const dirty = useMemo(() => JSON.stringify(M) !== JSON.stringify(DEFAULT), [M]);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, font: `400 14px ${FONT}`, color: C.ink, display: 'flex', flexDirection: 'column' }}>
      <style>{`
        * { box-sizing: border-box; } body { margin: 0; background: ${C.bg}; }
        section table tr > *:last-child { padding-right: 24px !important; }
        input:focus { border-color: ${C.ink} !important; box-shadow: 0 0 0 3px ${C.yellowSoft}; }
        button:focus-visible { outline: 2px solid ${C.ink}; outline-offset: 2px; }
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {dirty && (confirmReset
              ? <span style={{ display: 'flex', gap: 6 }}><button style={{ ...btn, background: C.ink, color: '#fff', borderColor: C.ink }} onClick={() => { setM(clone(DEFAULT)); setConfirmReset(false); }}>Confirmar</button><button style={btn} onClick={() => setConfirmReset(false)}>Cancelar</button></span>
              : <button style={{ border: 0, background: 'transparent', padding: '4px 2px', cursor: 'pointer', font: `300 11.5px ${FONT}`, color: C.faint, textDecoration: 'underline', textDecorationColor: C.line, textUnderlineOffset: 3 }} onClick={() => setConfirmReset(true)}>Restablecer supuestos</button>)}
          </div>
        </div>
        <nav style={{ maxWidth: 1440, margin: '0 auto', padding: '0 20px', display: 'flex', gap: 4, overflowX: 'auto', marginTop: 10 }}>
          {MODULES.map(m => (
            <button key={m.id} onClick={() => go(m.id)} aria-current={mod === m.id ? 'page' : undefined}
              style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: '10px 10px 12px', font: `${mod === m.id ? 600 : 300} 13.5px ${FONT}`, color: mod === m.id ? C.ink : C.muted, borderBottom: `2px solid ${mod === m.id ? C.yellow : 'transparent'}`, whiteSpace: 'nowrap' }}>
              {m.l}
            </button>
          ))}
        </nav>
      </header>

      <main style={{ maxWidth: 1440, width: '100%', margin: '0 auto', padding: '22px 28px 32px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, font: `200 34px ${FONT}`, letterSpacing: '-0.035em' }}>{MODULES.find(m => m.id === mod)!.l}</h1>
        </div>
        {mod === 'resumen' && <Resumen R={R} M={M} />}
        {mod === 'pl' && <PL M={M} R={R} set={set} />}
        {mod === 'gastos' && <Gastos M={M} R={R} set={set} />}
        {mod === 'credito' && <Credito M={M} R={R} set={set} />}
        {mod === 'valuacion' && <Valuacion M={M} R={R} set={set} />}
      </main>

      <footer style={{ borderTop: `1px solid ${C.line}`, background: C.surface }}>
        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '14px 28px', display: 'flex', justifyContent: 'center', font: `500 12px ${FONT}`, color: C.muted, letterSpacing: '.04em' }}>
          Powered by AXON B2B
        </div>
      </footer>
    </div>
  );
}
