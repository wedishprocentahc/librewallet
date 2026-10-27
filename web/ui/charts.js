import { h, svg } from "./dom.js";
import { money, number, pct } from "./format.js";

export const PALETTE = ["#2e7d5b", "#b8731c", "#3b6fb6", "#a4458b", "#c0504d", "#5aa6a6", "#8a8a3a", "#6b5b95", "#d98f3a", "#4d7c9e"];
const NS_W = 760;

function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

const compact = (v) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v);

/**
 * Time-series line chart with hover tooltip.
 * rows: [{ dayKey, ...numbers }]  series: [{ key, label, color, dashed?, area? }]
 */
export function lineChart({ rows, series, currency, height = 300, markers = [] }) {
  const wrap = h("div", { class: "chart" });
  if (rows.length === 0) return wrap;
  const pad = { l: 56, r: 12, t: 10, b: 24 };
  const W = NS_W, H = height;
  const xs = rows.map((r) => new Date(r.dayKey + "T00:00:00").getTime());
  const x0 = xs[0], x1 = xs[xs.length - 1] || x0 + 1;
  const vals = rows.flatMap((r) => series.map((s) => r[s.key]).filter((v) => typeof v === "number" && Number.isFinite(v)));
  let yMin = Math.min(0, ...vals), yMax = Math.max(...vals, 1);
  if (yMax === yMin) yMax = yMin + 1;
  const ticks = niceTicks(yMin, yMax);
  yMax = Math.max(yMax, ticks[ticks.length - 1]);
  const X = (t) => pad.l + ((t - x0) / Math.max(1, x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);

  const el = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", role: "img", preserveAspectRatio: "none" });
  for (const tk of ticks) {
    el.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: Y(tk), y2: Y(tk), class: "grid" }), svg("text", { x: pad.l - 6, y: Y(tk) + 4, class: "axis", "text-anchor": "end" }, compact(tk)));
  }
  const nTicks = Math.min(6, rows.length);
  for (let i = 0; i < nTicks; i++) {
    const idx = Math.round((i / Math.max(1, nTicks - 1)) * (rows.length - 1));
    el.append(svg("text", { x: X(xs[idx]), y: H - 6, class: "axis", "text-anchor": i === 0 ? "start" : i === nTicks - 1 ? "end" : "middle" }, rows[idx].dayKey));
  }
  for (const s of series) {
    let d = "", started = false;
    rows.forEach((r, i) => {
      const v = r[s.key];
      if (typeof v !== "number" || !Number.isFinite(v)) { started = false; return; }
      d += `${started ? "L" : "M"}${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`;
      started = true;
    });
    if (s.area && d) el.append(svg("path", { d: `${d}L${X(x1).toFixed(1)},${Y(0)}L${X(x0).toFixed(1)},${Y(0)}Z`, fill: s.color, opacity: 0.1 }));
    el.append(svg("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-dasharray": s.dashed ? "5 4" : null, "vector-effect": "non-scaling-stroke" }));
  }
  const byDay = new Map();
  for (const m of markers) byDay.set(m.dayKey, [...(byDay.get(m.dayKey) ?? []), m]);
  const markerColor = { buy: "#2e7d5b", sell: "#c0504d", deposit: "#3b6fb6", withdrawal: "#b8731c", dividend: "#a4458b" };
  rows.forEach((r, i) => {
    const ms = byDay.get(r.dayKey);
    if (ms) el.append(svg("circle", { cx: X(xs[i]), cy: H - pad.b - 5, r: 3, fill: markerColor[ms[0].type] ?? "#888", opacity: 0.85 }, svg("title", {}, ms.map((m) => `${m.type} ${m.symbol ?? ""}`).join(", "))));
  });
  const cursor = svg("line", { y1: pad.t, y2: H - pad.b, class: "cursor", style: "display:none" });
  el.append(cursor);
  const tip = h("div", { class: "tooltip", style: { display: "none" } });
  wrap.append(el, tip);

  const show = (ev) => {
    const box = el.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    const t = x0 + ((px - pad.l) / (W - pad.l - pad.r)) * (x1 - x0);
    let lo = 0, hi = xs.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] < t) lo = mid + 1; else hi = mid; }
    const i = lo > 0 && Math.abs(xs[lo - 1] - t) < Math.abs(xs[lo] - t) ? lo - 1 : lo;
    const r = rows[i];
    cursor.setAttribute("x1", X(xs[i])); cursor.setAttribute("x2", X(xs[i])); cursor.style.display = "";
    tip.replaceChildren(h("strong", {}, r.dayKey), ...series.filter((s) => typeof r[s.key] === "number").map((s) => h("div", {}, h("span", { class: "dot", style: { background: s.color } }), `${s.label}: ${money(r[s.key], currency)}`)));
    tip.style.display = "";
    const left = Math.min(box.width - 180, Math.max(0, (X(xs[i]) / W) * box.width + 12));
    tip.style.left = `${left}px`;
  };
  el.addEventListener("mousemove", show);
  el.addEventListener("mouseleave", () => { cursor.style.display = "none"; tip.style.display = "none"; });
  return wrap;
}

/** Donut with hover highlight; slices: [{label, value, color}] */
export function donut({ slices, currency, centerLabel }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const wrap = h("div", { class: "donut" });
  if (!(total > 0)) return wrap;
  const R = 70, r = 44, C = 80;
  const el = svg("svg", { viewBox: "0 0 160 160", class: "donut-svg" });
  const center = svg("text", { x: C, y: C - 2, "text-anchor": "middle", class: "donut-total" }, "");
  const sub = svg("text", { x: C, y: C + 14, "text-anchor": "middle", class: "axis" }, centerLabel ?? "");
  const setCenter = (s) => { center.textContent = s ? pct((s.value / total) * 100) : compact(total); sub.textContent = s ? s.label : (centerLabel ?? ""); };
  setCenter(null);
  let a = -Math.PI / 2;
  const legend = h("ul", { class: "legend" });
  slices.forEach((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const full = slices.length === 1;
    const a2 = a + (full ? Math.PI * 2 - 0.0001 : sweep);
    const p = (ang, rad) => `${C + rad * Math.cos(ang)},${C + rad * Math.sin(ang)}`;
    const big = a2 - a > Math.PI ? 1 : 0;
    const path = svg("path", { d: `M${p(a, R)}A${R},${R} 0 ${big} 1 ${p(a2, R)}L${p(a2, r)}A${r},${r} 0 ${big} 0 ${p(a, r)}Z`, fill: s.color, class: "slice" });
    path.addEventListener("mouseenter", () => setCenter(s));
    path.addEventListener("mouseleave", () => setCenter(null));
    el.append(path);
    legend.append(h("li", {}, h("span", { class: "dot", style: { background: s.color } }), h("span", { class: "grow" }, s.label), h("span", {}, currency ? money(s.value, currency) : number(s.value, 2)), h("span", { class: "muted" }, pct((s.value / total) * 100))));
    a += sweep;
  });
  el.append(center, sub);
  wrap.append(el, legend);
  return wrap;
}

/** Horizontal bars for signed values; items: [{label, value}] */
export function bars({ items, currency }) {
  const wrap = h("div", { class: "bars" });
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  for (const it of items) {
    wrap.append(h("div", { class: "bar-row" },
      h("span", { class: "bar-label", title: it.label }, it.label),
      h("span", { class: "bar-track" }, h("span", { class: `bar-fill ${it.value >= 0 ? "pos" : "neg"}`, style: { width: `${(Math.abs(it.value) / max) * 100}%` } })),
      h("span", { class: `bar-value ${it.value >= 0 ? "pos" : "neg"}` }, money(it.value, currency))));
  }
  return wrap;
}
