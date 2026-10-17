const TD = {
  x: { label: "X", unit: "px", def: 0, kind: "num", color: "#e05555" },
  y: { label: "Y", unit: "px", def: 0, kind: "num", color: "#44cc77" },
  rotation: { label: "Rotation", unit: "°", def: 0, kind: "num", color: "#4488ff" },
  scaleX: { label: "Scale X", unit: "%", def: 100, kind: "num", color: "#ffaa22" },
  scaleY: { label: "Scale Y", unit: "%", def: 100, kind: "num", color: "#dd55cc" },
  alpha: { label: "Alpha", unit: "%", def: 100, kind: "num", color: "#22ccdd", min: 0, max: 100 },
  costume: { label: "Costume", unit: "", def: null, kind: "costume", color: "#aa55ff" },
  zIndex: { label: "Z-Order", unit: "", def: 0, kind: "disc", color: "#ff7755" },
  followPos: { label: "Follow Pos", unit: "", def: 1, kind: "disc", bool: true, color: "#60d0a0" },
  followRot: { label: "Follow Rot", unit: "", def: 0, kind: "disc", bool: true, color: "#60b0d0" },
  followScale: { label: "Follow Scale", unit: "", def: 0, kind: "disc", bool: true, color: "#a0b060" },
  relativeTo: { label: "Parent", unit: "", def: "", kind: "disc", str: true, color: "#44ddaa" },
  visible: { label: "Visible", unit: "", def: 1, kind: "disc", bool: true, color: "#dddd33" },
  skewX: { label: "Skew X", unit: "°", def: 0, kind: "num", color: "#ff88aa" },
  skewY: { label: "Skew Y", unit: "°", def: 0, kind: "num", color: "#aaffcc" },
  flipX: { label: "Flip X", unit: "°", def: 0, kind: "num", color: "#ff7799" },
  flipY: { label: "Flip Y", unit: "°", def: 0, kind: "num", color: "#77ffbb" },
  pivotX: { label: "Pivot X", unit: "px", def: 0, kind: "num", color: "#ff9966" },
  pivotY: { label: "Pivot Y", unit: "px", def: 0, kind: "num", color: "#66ccff" },
  fxColor: { label: "Color", unit: "", def: 0, kind: "num", color: "#ff6666", fx: true },
  fxBrightness: { label: "Brightness", unit: "", def: 0, kind: "num", color: "#ffee44", fx: true },
  fxGhost: { label: "Ghost", unit: "%", def: 0, kind: "num", color: "#aaddff", fx: true, min: 0, max: 100 },
  fxPixelate: { label: "Pixelate", unit: "", def: 0, kind: "num", color: "#cc88ff", fx: true, min: 0 },
  fxMosaic: { label: "Mosaic", unit: "", def: 0, kind: "num", color: "#88ffcc", fx: true },
  fxWhirl: { label: "Whirl", unit: "°", def: 0, kind: "num", color: "#ff9944", fx: true },
  fxFisheye: { label: "Fisheye", unit: "", def: 0, kind: "num", color: "#44ffcc", fx: true },
  fxCustom: { label: "CSS Filter", unit: "", def: "", kind: "disc", str: true, color: "#ff88dd", fx: true },
  tint: { label: "Tint", unit: "", def: 0xffffff, kind: "color", color: "#ff77bb", fx: true },
  blendMode: { label: "Blend Mode", unit: "", def: "source-over", kind: "disc", str: true, color: "#ffaa66", fx: true },
  fxChromaticX: { label: "Chromatic X", unit: "px", def: 0, kind: "num", color: "#ff4488", fx: true },
  fxChromaticY: { label: "Chromatic Y", unit: "px", def: 0, kind: "num", color: "#44aaff", fx: true },
  padding: { label: "Padding", unit: "px", def: 0, kind: "num", color: "#99bbff", min: 0 },
  maskSource: { label: "Mask Source", unit: "", def: "", kind: "disc", str: true, color: "#ff55cc" },
  maskInvert: { label: "Mask Invert", unit: "", def: 0, kind: "disc", bool: true, color: "#ff88ee" },
  afterimageIntensity: { label: "Afterimage", unit: "%", def: 0, kind: "num", color: "#ffcc44", min: 0, max: 100 },
  afterimageFade: { label: "Afterimage Fade", unit: "%", def: 80, kind: "num", color: "#ffaa22", min: 0, max: 100 },
  afterimageInterval: { label: "Afterimage Gap", unit: "s", def: 0.05, kind: "num", color: "#ff8800", min: 0.01 },
  clipTop: { label: "Clip Top", unit: "%", def: 0, kind: "num", color: "#88ddff", min: 0, max: 100 },
  clipBottom: { label: "Clip Bottom", unit: "%", def: 0, kind: "num", color: "#55bbff", min: 0, max: 100 },
  clipLeft: { label: "Clip Left", unit: "%", def: 0, kind: "num", color: "#33aaee", min: 0, max: 100 },
  clipRight: { label: "Clip Right", unit: "%", def: 0, kind: "num", color: "#2299cc", min: 0, max: 100 },
  glowSize: { label: "Glow Size", unit: "px", def: 0, kind: "num", color: "#ffe066", fx: true, min: 0 },
  glowStrength: { label: "Glow Strength", unit: "%", def: 100, kind: "num", color: "#ffd033", fx: true, min: 0 },
  glowColor: { label: "Glow Color", unit: "", def: 0xffffcc, kind: "color", color: "#fff099", fx: true },
  outlineWidth: { label: "Outline", unit: "px", def: 0, kind: "num", color: "#b0b0ff", fx: true, min: 0 },
  outlineColor: { label: "Outline Color", unit: "", def: 0x000000, kind: "color", color: "#8080ff", fx: true },
  shadowX: { label: "Shadow X", unit: "px", def: 0, kind: "num", color: "#909090", fx: true },
  shadowY: { label: "Shadow Y", unit: "px", def: 0, kind: "num", color: "#a0a0a0", fx: true },
  shadowBlur: { label: "Shadow Blur", unit: "px", def: 0, kind: "num", color: "#b0b0b0", fx: true, min: 0 },
  shadowAlpha: { label: "Shadow Alpha", unit: "%", def: 0, kind: "num", color: "#707070", fx: true, min: 0, max: 100 },
  shadowColor: { label: "Shadow Color", unit: "", def: 0x000000, kind: "color", color: "#606060", fx: true },
  motionBlur: { label: "Motion Blur", unit: "%", def: 0, kind: "num", color: "#77ddff", fx: true, min: 0, max: 100 },
};
const ALL_TRACKS = Object.keys(TD);
const TRANSFORM_TRACKS = ["x", "y", "rotation", "scaleX", "scaleY", "skewX", "skewY", "flipX", "flipY", "alpha", "pivotX", "pivotY"];
const PARENT_TRACKS = ["relativeTo", "followPos", "followRot", "followScale"];
const FX_TRACKS = ["fxColor", "fxBrightness", "fxGhost", "fxPixelate", "fxMosaic", "fxWhirl", "fxFisheye", "tint", "fxChromaticX", "fxChromaticY", "blendMode", "fxCustom"];
const STYLE_TRACKS = ["glowSize", "glowStrength", "glowColor", "outlineWidth", "outlineColor", "shadowX", "shadowY", "shadowBlur", "shadowAlpha", "shadowColor", "motionBlur"];
const NICHE_TRACKS = ["padding", "afterimageIntensity", "afterimageFade", "afterimageInterval", "clipTop", "clipBottom", "clipLeft", "clipRight"];
const MASK_TRACKS = ["maskSource", "maskInvert"];
const EXPR_TRACKS = ["costume", ...TRANSFORM_TRACKS, "fxColor", "fxBrightness", "fxGhost", "fxPixelate", "fxMosaic", "fxWhirl", "fxFisheye", "fxChromaticX", "fxChromaticY", "glowSize", "outlineWidth"];
const BLEND_MODES = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "lighter",
  "destination-over",
  "destination-in",
  "destination-out",
  "destination-atop",
  "source-atop",
  "source-in",
  "source-out",
  "xor",
  "copy",
];
const isDiscrete = (key) => { const d = TD[key]; return !!d && (d.kind === "disc" || d.kind === "costume"); };
const defaultEaseFor = (key) => (isDiscrete(key) ? "Step" : "Linear_Out");
const NUM_PROPS = ALL_TRACKS.filter((k) => {
  const d = TD[k];
  return d.kind === "num" || d.kind === "color" || (d.kind === "disc" && !d.str);
});
const SLOT = Object.fromEntries(NUM_PROPS.map((k, i) => [k, i]));
const NUM_SLOTS = NUM_PROPS.length;
const STR_PROPS = ALL_TRACKS.filter((k) => TD[k].str);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;
const EPS_SEC = 1e-4;
const sameSec = (a, b) => Math.abs(a - b) < EPS_SEC;
let _idCounter = 0;
const rand36 = () => Math.random().toString(36).slice(2, 9);
const makeAnimId = () => "ks4_" + rand36();
const makeKFID = () => "kf_" + rand36() + (++_idCounter).toString(36);
function uniqueName(name, taken) {
  const set = taken instanceof Set ? taken : new Set(taken);
  if (!set.has(name)) return name;
  const base = name.replace(/ \(\d+\)$/, "");
  let n = 1;
  while (set.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
const deepClone = typeof structuredClone === "function" ? (v) => structuredClone(v) : (v) => JSON.parse(JSON.stringify(v));
function hexToInt(hex) { const n = parseInt(String(hex).replace("#", ""), 16); return Number.isFinite(n) ? n : 0xffffff; }
const intToHex = (n) => "#" + (Math.max(0, Math.min(0xffffff, Math.round(n))) >>> 0).toString(16).padStart(6, "0");
const intToRGB = (n) => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
const _colorCache = new Map();
let _colorCtx = null;
function parseCssColor(str) {
  if (typeof str === "number") return [...intToRGB(str), 1];
  str = String(str || "").trim();
  if (!str) return [0, 0, 0, 1];
  const hit = _colorCache.get(str);
  if (hit) return hit;
  let out = [0, 0, 0, 1];
  const m = /^#([0-9a-f]{3,8})$/i.exec(str);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    out = [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  } else if (typeof document !== "undefined") {
    _colorCtx ||= document.createElement("canvas").getContext("2d");
    _colorCtx.fillStyle = "#000";
    _colorCtx.fillStyle = str;
    const v = _colorCtx.fillStyle;
    const mm = /^#([0-9a-f]{6})$/i.exec(v);
    if (mm) out = [parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255, 1];
    else {
      const rgba = /rgba?\(([^)]+)\)/.exec(v);
      if (rgba) { const p = rgba[1].split(",").map((s) => parseFloat(s)); out = [p[0] / 255, p[1] / 255, p[2] / 255, p[3] ?? 1]; }
    }
  }
  if (_colorCache.size > 256) _colorCache.clear();
  _colorCache.set(str, out);
  return out;
}
function downloadBlob(data, filename, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function pickFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    input.onchange = () => { resolve([...(input.files || [])]); input.remove(); };
    document.body.appendChild(input);
    input.click();
  });
}
function bytesToBase64(bytes) {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function dataURLToBytes(url) {
  const comma = url.indexOf(",");
  const meta = url.slice(5, comma);
  const body = url.slice(comma + 1);
  const mime = meta.split(";")[0] || "application/octet-stream";
  const bytes = /;base64/i.test(meta) ? base64ToBytes(body) : new TextEncoder().encode(decodeURIComponent(body));
  return { mime, bytes };
}
function formatTime(sec, fps) {
  if (!Number.isFinite(sec)) return "∞";
  if (fps) { const f = Math.round(sec * fps); return `${(sec).toFixed(2)}s · f${f}`; }
  return sec.toFixed(2) + "s";
}
const THIS_SPRITE = "__this__";
const DOC_VERSION = 5;
function newAnim(opts = {}) {
  return normalizeAnim({
    id: makeAnimId(),
    name: opts.name || "",
    duration: 2,
    fps: 30,
    width: 480,
    height: 360,
    events: [],
    dataTracks: [],
    groups: [],
  });
}
function newGroup(name, spriteName, targetId = "") {
  return {
    name,
    spriteName: spriteName || THIS_SPRITE,
    targetId: targetId || "",
    costumeNames: [],
    costumeIds: [],
    visible: true,
    exprs: {},
    tracks: {},
  };
}
const num = (v, d) => (Number.isFinite(+v) ? +v : d);
function normalizeKeyframes(list, key) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const kf of list) {
    if (!kf || typeof kf !== "object") continue;
    const sec = num(kf.sec, NaN);
    if (!Number.isFinite(sec)) continue;
    const k = { sec, value: kf.value, ease: kf.ease || defaultEaseFor(key), id: kf.id || makeKFID() };
    if (kf.expr && String(kf.expr).trim()) k.expr = String(kf.expr);
    if (k.expr && typeof kf.exprBlocks === "string") k.exprBlocks = kf.exprBlocks;
    if (Array.isArray(kf.bez) && kf.bez.length === 4) k.bez = kf.bez.map((v) => +v || 0);
    const r = kf.rand;
    if (r && typeof r === "object" && Number.isFinite(+r.min) && Number.isFinite(+r.max) && (!TD[key] || TD[key].kind === "num")) {
      k.rand = { min: Math.min(+r.min, +r.max), max: Math.max(+r.min, +r.max) };
    }
    out.push(k);
  }
  out.sort((a, b) => a.sec - b.sec);
  return out;
}
const VEC_SHAPES = ["path", "line", "rect", "ellipse"];
function normalizeVector(v, i) {
  const items = Array.isArray(v && v.items) ? v.items : [];
  return {
    name: String((v && v.name) || i + 1),
    w: Math.max(1, +(v && v.w) || 480),
    h: Math.max(1, +(v && v.h) || 360),
    items: items.filter((it) => it && VEC_SHAPES.includes(it.t)).map((it) => ({
      t: it.t,
      d: String(it.d || ""),
      p: Array.isArray(it.p) ? it.p.map((n) => +n || 0) : [],
      s: String(it.s || "#000000"),
      f: it.f ? String(it.f) : "",
      w: Math.max(0, +it.w || 0),
    })),
  };
}
const escAttr = (v) => String(v).replace(/[^#\w.(),% -]/g, "");
function vectorSVG(v) {
  const body = v.items.map((it) => {
    const style = `fill="${it.f ? escAttr(it.f) : "none"}" stroke="${it.w > 0 ? escAttr(it.s) : "none"}" stroke-width="${it.w}" stroke-linecap="round" stroke-linejoin="round"`;
    const p = it.p;
    if (it.t === "line") return `<line x1="${p[0]}" y1="${p[1]}" x2="${p[2]}" y2="${p[3]}" ${style}/>`;
    if (it.t === "rect") return `<rect x="${Math.min(p[0], p[2])}" y="${Math.min(p[1], p[3])}" width="${Math.abs(p[2] - p[0])}" height="${Math.abs(p[3] - p[1])}" ${style}/>`;
    if (it.t === "ellipse") return `<ellipse cx="${(p[0] + p[2]) / 2}" cy="${(p[1] + p[3]) / 2}" rx="${Math.abs(p[2] - p[0]) / 2}" ry="${Math.abs(p[3] - p[1]) / 2}" ${style}/>`;
    return `<path d="${escAttr(it.d).replace(/[^MLQCZmlqcz0-9.,\s-]/g, "")}" ${style}/>`;
  }).join("");
  const b = vectorBounds(v);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}">${body}</svg>`;
}
function vectorBounds(v) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of v.items) {
    const nums = it.t === "path" ? (String(it.d).match(/-?\d*\.?\d+/g) || []).map(Number) : it.p;
    const pad = it.w / 2 + 1;
    for (let i = 0; i + 1 < nums.length; i += 2) {
      x0 = Math.min(x0, nums[i] - pad);
      y0 = Math.min(y0, nums[i + 1] - pad);
      x1 = Math.max(x1, nums[i] + pad);
      y1 = Math.max(y1, nums[i + 1] + pad);
    }
  }
  if (!(x1 > x0)) return { x: v.w / 2 - 1, y: v.h / 2 - 1, w: 2, h: 2 };
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  return { x: x0, y: y0, w: Math.max(1, Math.ceil(x1 - x0)), h: Math.max(1, Math.ceil(y1 - y0)) };
}
const _vecSkins = new Map();
function vectorSkin(renderer, v) {
  const svg = vectorSVG(v);
  let e = _vecSkins.get(svg);
  if (e && e.renderer === renderer) return e.id;
  if (!renderer || !renderer.createSVGSkin) return -1;
  const b = vectorBounds(v);
  const id = renderer.createSVGSkin(svg, [v.w / 2 - b.x, v.h / 2 - b.y]);
  _vecSkins.set(svg, { renderer, id });
  if (_vecSkins.size > 400) {
    const [k, old] = _vecSkins.entries().next().value;
    _vecSkins.delete(k);
    try { old.renderer.destroySkin(old.id); } catch (err) {}
  }
  return id;
}
function vectorBinding(runtime, g) {
  const renderer = runtime && runtime.renderer;
  const costumes = g.vectors.map((v) => ({ name: v.name, skinId: vectorSkin(renderer, v), dataFormat: "svg", bitmapResolution: 1, assetId: "" }));
  const b = { epoch, sprite: { name: g.name, costumes }, costumes, count: costumes.length, byName: new Map(), byLowerName: new Map(), byAsset: new Map(), names: [], assetIds: [], drawn: true };
  costumes.forEach((c, i) => {
    b.names.push(c.name);
    if (!b.byName.has(c.name)) b.byName.set(c.name, i);
    if (!b.byLowerName.has(c.name.toLowerCase())) b.byLowerName.set(c.name.toLowerCase(), i);
    b.assetIds.push("");
  });
  return b;
}
function normalizeGroup(g, taken) {
  const out = {
    name: String(g.name || "Object"),
    spriteName: g.spriteName || THIS_SPRITE,
    targetId: g.targetId || "",
    costumeNames: Array.isArray(g.costumeNames) ? g.costumeNames.map(String) : [],
    costumeIds: Array.isArray(g.costumeIds) ? g.costumeIds.map((v) => (v ? String(v) : "")) : [],
    visible: g.visible !== false,
    exprs: {},
    tracks: {},
  };
  if (taken) { out.name = uniqueName(out.name, taken); taken.add(out.name); }
  if (g.pivot && (g.pivot.x || g.pivot.y)) out.pivot = { x: +g.pivot.x || 0, y: +g.pivot.y || 0 };
  if (g.tlCollapsed) out.tlCollapsed = true;
  if (g.color) out.color = String(g.color);
  if (Array.isArray(g.vectors)) out.vectors = g.vectors.map(normalizeVector);
  if (g.nineSlice && typeof g.nineSlice === "object") {
    const n = g.nineSlice;
    out.nineSlice = { l: +n.l || 0, r: +n.r || 0, t: +n.t || 0, b: +n.b || 0 };
  }
  if (g.exprs && typeof g.exprs === "object") {
    for (const [k, v] of Object.entries(g.exprs)) if (typeof v === "string" && v.trim()) out.exprs[k] = v;
  }
  if (g.exprBlocks && typeof g.exprBlocks === "object") {
    const blocks = {};
    for (const [k, v] of Object.entries(g.exprBlocks)) if (typeof v === "string" && out.exprs[k]) blocks[k] = v;
    if (Object.keys(blocks).length) out.exprBlocks = blocks;
  }
  if (g.maskSource && !(g.tracks && g.tracks.maskSource)) {
    out.tracks.maskSource = { keyframes: [{ sec: 0, value: g.maskSource, ease: "Step", id: makeKFID() }] };
  }
  if (g.tracks && typeof g.tracks === "object") {
    for (const [key, tr] of Object.entries(g.tracks)) {
      if (!TD[key] || !tr) continue;
      const keyframes = normalizeKeyframes(tr.keyframes, key);
      if (!keyframes.length && !tr.muted) continue;
      out.tracks[key] = { keyframes };
      if (tr.muted) out.tracks[key].muted = true;
      if (tr.tlHidden) out.tracks[key].tlHidden = true;
      if (typeof tr.expr === "string" && tr.expr.trim() && !TD[key].str) {
        out.tracks[key].expr = tr.expr;
        if (typeof tr.exprBlocks === "string") out.tracks[key].exprBlocks = tr.exprBlocks;
      }
    }
  }
  migrateGroupExprs(out);
  return out;
}
function migrateGroupExprs(g) {
  for (const [key, src] of Object.entries(g.exprs)) {
    if (!TD[key] || TD[key].str) continue;
    let tr = g.tracks[key];
    if (tr && (tr.muted || tr.keyframes.some((k) => k.expr))) continue;
    if (!tr || !tr.keyframes.length) {
      const value = key === "costume" ? 0 : TD[key].def;
      tr = g.tracks[key] = { keyframes: [{ sec: 0, value, ease: defaultEaseFor(key), id: `kx_${g.name}_${key}` }] };
    }
    const blocks = g.exprBlocks && g.exprBlocks[key];
    for (const k of tr.keyframes) {
      k.expr = src;
      if (blocks) k.exprBlocks = blocks;
    }
    delete g.exprs[key];
    if (blocks) delete g.exprBlocks[key];
  }
  if (g.exprBlocks && !Object.keys(g.exprBlocks).length) delete g.exprBlocks;
}
function normalizeAnim(a) {
  a = a && typeof a === "object" ? a : {};
  const doc = {
    v: DOC_VERSION,
    id: typeof a.id === "string" && a.id ? a.id : makeAnimId(),
    name: typeof a.name === "string" ? a.name : "",
    duration: Math.max(0.01, num(a.duration, 2)),
    infinite: !!a.infinite,
    fps: Math.max(1, Math.min(240, num(a.fps, 30))),
    width: Math.max(1, Math.min(4096, Math.round(num(a.width, 480)))),
    height: Math.max(1, Math.min(4096, Math.round(num(a.height, 360)))),
    musicMode: !!a.musicMode,
    bpm: Math.max(1, num(a.bpm, 120)),
    beatsPerBar: Math.max(1, Math.round(num(a.beatsPerBar, 4))),
    snapDiv: num(a.snapDiv, 1),
    snapFrames: num(a.snapFrames, 1),
    audioSpriteName: a.audioSpriteName || null,
    audioSoundName: a.audioSoundName || null,
    events: [],
    dataTracks: [],
    groups: [],
  };
  if (a.canvasOffsetX) doc.canvasOffsetX = +a.canvasOffsetX || 0;
  if (a.canvasOffsetY) doc.canvasOffsetY = +a.canvasOffsetY || 0;
  if (Array.isArray(a.events)) {
    for (const ev of a.events) {
      if (!ev || !Number.isFinite(+ev.sec)) continue;
      doc.events.push({ sec: +ev.sec, value: String(ev.value ?? "event"), id: ev.id || makeKFID() });
    }
    doc.events.sort((x, y) => x.sec - y.sec);
  }
  if (Array.isArray(a.dataTracks)) {
    const names = new Set();
    for (const dt of a.dataTracks) {
      if (!dt || !dt.name || names.has(dt.name)) continue;
      names.add(dt.name);
      doc.dataTracks.push({
        name: String(dt.name),
        color: dt.color || "#44ddbb",
        disc: !!dt.disc,
        keyframes: normalizeKeyframes(dt.keyframes, dt.disc ? "zIndex" : "x"),
      });
    }
  }
  const taken = new Set();
  if (Array.isArray(a.groups)) for (const g of a.groups) if (g && typeof g === "object") doc.groups.push(normalizeGroup(g, taken));
  return doc;
}
function serializeAnim(doc) {
  return JSON.stringify(doc, (key, value) => {
    if (key.startsWith("_")) return undefined;
    if (key === "costumes" || key === "rotCenters") return undefined;
    return value;
  });
}
function parseAnim(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  if (s[0] !== "{") return null;
  try {
    const obj = JSON.parse(s);
    if (!obj || typeof obj !== "object" || !obj.id) return null;
    return obj;
  } catch { return null; }
}
function displayName(doc) {
  if (!doc) return "animation";
  if (doc.name) return doc.name;
  return "anim " + String(doc.id).replace(/^ks[45]_/, "");
}
function allKeyframeTimes(doc) {
  const set = new Set();
  for (const g of doc.groups) for (const tr of Object.values(g.tracks || {})) for (const kf of tr.keyframes) set.add(kf.sec);
  for (const ev of doc.events) set.add(ev.sec);
  for (const dt of doc.dataTracks) for (const kf of dt.keyframes) set.add(kf.sec);
  return [...set].sort((a, b) => a - b);
}
function lastKeyframeTime(doc) {
  let m = 0;
  for (const t of allKeyframeTimes(doc)) if (t > m) m = t;
  return m;
}
function trackKeys(group) {
  return ALL_TRACKS.filter((k) => group.tracks && group.tracks[k] && group.tracks[k].keyframes.length);
}
function renameGroupRefs(doc, oldName, newName) {
  for (const g of doc.groups) {
    for (const key of ["relativeTo", "maskSource"]) {
      const tr = g.tracks[key];
      if (!tr) continue;
      for (const kf of tr.keyframes) if (kf.value === oldName) kf.value = newName;
    }
  }
}
let epoch = 1;
function bumpBindingEpoch() { epoch++; }
const bindingEpoch = () => epoch;
const _bySprite = new WeakMap();
function bindingForSprite(sprite) {
  if (!sprite) return null;
  let b = _bySprite.get(sprite);
  const costumes = sprite.costumes || sprite.costumes_ || [];
  if (b && b.epoch === epoch && b.costumes === costumes && b.count === costumes.length) return b;
  b = {
    epoch,
    sprite,
    costumes,
    count: costumes.length,
    byName: new Map(),
    byLowerName: new Map(),
    byAsset: new Map(),
    names: [],
    assetIds: [],
  };
  costumes.forEach((c, i) => {
    b.names.push(c.name);
    if (!b.byName.has(c.name)) b.byName.set(c.name, i);
    const low = String(c.name).toLowerCase();
    if (!b.byLowerName.has(low)) b.byLowerName.set(low, i);
    const aid = c.assetId || (c.asset && c.asset.assetId) || "";
    b.assetIds.push(aid);
    if (aid && !b.byAsset.has(aid)) b.byAsset.set(aid, i);
  });
  _bySprite.set(sprite, b);
  return b;
}
function findGroupSprite(runtime, g) {
  if (!runtime) return null;
  if (g.targetId) {
    const t = runtime.getTargetById ? runtime.getTargetById(g.targetId) : runtime.targets.find((x) => x.id === g.targetId);
    if (t && t.sprite && !t.isStage) return t.sprite;
  }
  if (g.spriteName && g.spriteName !== THIS_SPRITE) {
    const t = runtime.targets.find((x) => x.isOriginal && !x.isStage && x.sprite && x.sprite.name === g.spriteName);
    if (t) { g.targetId = t.id; return t.sprite; }
    const low = g.spriteName.toLowerCase();
    const t2 = runtime.targets.find((x) => x.isOriginal && !x.isStage && x.sprite && x.sprite.name.toLowerCase() === low);
    if (t2) return t2.sprite;
  }
  return null;
}
function bindingsFor(runtime, compiled, target, ownerSprite = null) {
  const cacheKey = "_ks5Bind";
  const holder = target || compiled;
  let c = holder[cacheKey];
  const sprite = ownerSprite || (target && target.sprite);
  if (c && c.compiled === compiled && c.epoch === epoch && c.sprite === sprite) return c.list;
  const list = compiled.groups.map((cg) => {
    const g = cg.src;
    if (Array.isArray(g.vectors)) return vectorBinding(runtime, g);
    const sp = g.spriteName === THIS_SPRITE ? sprite : findGroupSprite(runtime, g);
    return bindingForSprite(sp);
  });
  holder[cacheKey] = { compiled, epoch, sprite, list };
  return list;
}
function refreshGroupCostumeInfo(g, binding) {
  if (!binding) return false;
  const same = g.costumeNames.length === binding.names.length && g.costumeNames.every((n, i) => n === binding.names[i]);
  if (same && g.costumeIds && g.costumeIds.length === binding.assetIds.length) return false;
  const tr = g.tracks && g.tracks.costume;
  if (tr && g.costumeIds && g.costumeIds.length) {
    for (const kf of tr.keyframes) {
      const v = kf.value;
      const name = v && typeof v === "object" ? v.name : typeof v === "string" && isNaN(v) ? v : null;
      if (name == null || binding.byName.has(name)) continue;
      const oi = g.costumeNames.indexOf(name);
      const aid = oi >= 0 ? g.costumeIds[oi] : "";
      const ni = aid ? binding.byAsset.get(aid) : undefined;
      if (ni !== undefined) kf.value = { name: binding.names[ni], index: ni };
    }
  }
  g.costumeNames = binding.names.slice();
  g.costumeIds = binding.assetIds.slice();
  return true;
}
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;
const c5 = (2 * Math.PI) / 4.5;
function bounceOut(x) {
  if (x < 1 / 2.75) return 7.5625 * x * x;
  if (x < 2 / 2.75) return 7.5625 * (x -= 1.5 / 2.75) * x + 0.75;
  if (x < 2.5 / 2.75) return 7.5625 * (x -= 2.25 / 2.75) * x + 0.9375;
  return 7.5625 * (x -= 2.625 / 2.75) * x + 0.984375;
}
const lin = (x) => x;
const EASE = {
  Linear_In: lin,
  Linear_Out: lin,
  Linear_InOut: lin,
  Sine_In: (x) => 1 - Math.cos((x * Math.PI) / 2),
  Sine_Out: (x) => Math.sin((x * Math.PI) / 2),
  Sine_InOut: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  Quad_In: (x) => x * x,
  Quad_Out: (x) => 1 - (1 - x) * (1 - x),
  Quad_InOut: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  Cubic_In: (x) => x * x * x,
  Cubic_Out: (x) => 1 - (1 - x) ** 3,
  Cubic_InOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  Quart_In: (x) => x ** 4,
  Quart_Out: (x) => 1 - (1 - x) ** 4,
  Quart_InOut: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
  Quint_In: (x) => x ** 5,
  Quint_Out: (x) => 1 - (1 - x) ** 5,
  Quint_InOut: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
  Expo_In: (x) => (x === 0 ? 0 : 2 ** (10 * x - 10)),
  Expo_Out: (x) => (x === 1 ? 1 : 1 - 2 ** (-10 * x)),
  Expo_InOut: (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
  Circ_In: (x) => 1 - Math.sqrt(1 - x * x),
  Circ_Out: (x) => Math.sqrt(1 - (x - 1) ** 2),
  Circ_InOut: (x) => (x < 0.5 ? (1 - Math.sqrt(1 - 4 * x * x)) / 2 : (Math.sqrt(1 - (-2 * x + 2) ** 2) + 1) / 2),
  Back_In: (x) => c3 * x ** 3 - c1 * x ** 2,
  Back_Out: (x) => 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2,
  Back_InOut: (x) => (x < 0.5 ? ((2 * x) ** 2 * ((c2 + 1) * 2 * x - c2)) / 2 : ((2 * x - 2) ** 2 * ((c2 + 1) * (2 * x - 2) + c2) + 2) / 2),
  Elastic_In: (x) => (x === 0 ? 0 : x === 1 ? 1 : -(2 ** (10 * x - 10)) * Math.sin((x * 10 - 10.75) * c4)),
  Elastic_Out: (x) => (x === 0 ? 0 : x === 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1),
  Elastic_InOut: (x) =>
    x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? -(2 ** (20 * x - 10) * Math.sin((20 * x - 11.125) * c5)) / 2 : (2 ** (-20 * x + 10) * Math.sin((20 * x - 11.125) * c5)) / 2 + 1,
  Bounce_In: (x) => 1 - bounceOut(1 - x),
  Bounce_Out: bounceOut,
  Bounce_InOut: (x) => (x < 0.5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2),
  Step: () => 0,
};
const EASE_FAMS = ["Linear", "Sine", "Quad", "Cubic", "Quart", "Quint", "Expo", "Circ", "Back", "Elastic", "Bounce"];
const EASE_DIRS = ["In", "Out", "InOut"];
const _bezCache = new Map();
function cubicBezier(x1, y1, x2, y2) {
  const key = x1 + "," + y1 + "," + x2 + "," + y2;
  const hit = _bezCache.get(key);
  if (hit) return hit;
  x1 = Math.min(1, Math.max(0, x1));
  x2 = Math.min(1, Math.max(0, x2));
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 24; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (x > v) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  const fn = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)));
  if (_bezCache.size > 512) _bezCache.clear();
  _bezCache.set(key, fn);
  return fn;
}
const DEFAULT_BEZ = [0.42, 0, 0.58, 1];
function easeFnFor(kf) {
  const name = (kf && kf.ease) || "Linear_Out";
  if (name === "Bezier") {
    const b = Array.isArray(kf.bez) && kf.bez.length === 4 ? kf.bez : DEFAULT_BEZ;
    return cubicBezier(b[0], b[1], b[2], b[3]);
  }
  return EASE[name] || lin;
}
function applyEase(name, x, kf) {
  if (name === "Step") return 0;
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  if (name === "Bezier") return easeFnFor(kf)(x);
  return (EASE[name] || lin)(x);
}
function splitEase(name) {
  if (!name || name === "Step" || name === "Bezier") return [name || "Linear", "Out"];
  const [fam, dir] = name.split("_");
  return [fam || "Linear", dir || "Out"];
}
const HELPERS = {
  PI: Math.PI,
  TAU: Math.PI * 2,
  E: Math.E,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  sign: Math.sign,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  exp: Math.exp,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  hypot: Math.hypot,
  random: Math.random,
  mod: (a, b) => ((a % b) + b) % b,
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  lerp: (a, b, k) => a + (b - a) * k,
  smoothstep: (e0, e1, x) => { const k = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return k * k * (3 - 2 * k); },
  jitter: (...a) => (a.length >= 5 ? (+a[1] || 0) + jitter(a[0], a[2], a[3], a[4]) : jitter(...a)),
  noise,
};
const HELPER_NAMES = Object.keys(HELPERS);
const HELPER_VALUES = HELPER_NAMES.map((k) => HELPERS[k]);
function hash1(n) { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return v - Math.floor(v); }
function jitter(t, amp = 1, freq = 1, smooth = 0.5) {
  const period = freq > 0 ? 1 / freq : 1;
  const w = t / period;
  const i = Math.floor(w);
  const f = w - i;
  const a = hash1(i) * 2 - 1;
  const b = hash1(i + 1) * 2 - 1;
  const k = smooth <= 0 ? 0 : smooth >= 1 ? f * f * (3 - 2 * f) : f < 1 - smooth ? 0 : (f - (1 - smooth)) / smooth;
  return (a + (b - a) * k) * amp;
}
function noise(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(i + seed * 57.13) * 2 - 1;
  const b = hash1(i + 1 + seed * 57.13) * 2 - 1;
  return a + (b - a) * u;
}
const _cache = new Map();
const MAX_CACHE = 2048;
const VARS = new Set(['t', 'sec', 'value', 'data', 'time']);
const HELPER_SET = new Set(HELPER_NAMES);
const DYNAMIC_NAMES = new Set(['time', 'random']);
const BINARY = {
    '||': 1, '&&': 2,
    '==': 3, '!=': 3, '===': 3, '!==': 3,
    '<': 4, '>': 4, '<=': 4, '>=': 4,
    '+': 5, '-': 5,
    '*': 6, '/': 6, '%': 6,
    '**': 8
};
const PUNCT = ['===', '!==', '**', '==', '!=', '<=', '>=', '&&', '||',
    '+', '-', '*', '/', '%', '<', '>', '!', '?', ':', '(', ')', '[', ']', ',', '.'];
class ExprError extends Error {}
const tokenize = src => {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) { i++; continue; }
        const numMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
        if (numMatch) { out.push({type: 'num', value: Number(numMatch[0])}); i += numMatch[0].length; continue; }
        const idMatch = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
        if (idMatch) { out.push({type: 'id', value: idMatch[0]}); i += idMatch[0].length; continue; }
        if (c === '"' || c === "'") {
            let j = i + 1;
            let str = '';
            while (j < src.length && src[j] !== c) {
                if (src[j] === '\\' && j + 1 < src.length) {
                    const n = src[j + 1];
                    str += n === 'n' ? '\n' : n === 't' ? '\t' : n;
                    j += 2;
                } else str += src[j++];
            }
            if (j >= src.length) throw new ExprError('Unclosed string');
            out.push({type: 'str', value: str});
            i = j + 1;
            continue;
        }
        const p = PUNCT.find(op => src.startsWith(op, i));
        if (!p) throw new ExprError(`Unexpected "${c}"`);
        out.push({type: 'op', value: p});
        i += p.length;
    }
    return out;
};
const parse = src => {
    const toks = tokenize(src);
    let pos = 0;
    const peek = () => toks[pos];
    const isOp = v => peek() && peek().type === 'op' && peek().value === v;
    const expect = v => {
        if (!isOp(v)) throw new ExprError(`Expected "${v}"`);
        pos++;
    };
    const primary = () => {
        const tk = toks[pos++];
        if (!tk) throw new ExprError('Unexpected end');
        if (tk.type === 'num') return {k: 'num', v: tk.value};
        if (tk.type === 'str') return {k: 'str', v: tk.value};
        if (tk.type === 'op') {
            if (tk.value === '(') { const e = expr(0); expect(')'); return e; }
            if (tk.value === '-' || tk.value === '+' || tk.value === '!') { return {k: 'un', op: tk.value, a: expr(7)}; }
            throw new ExprError(`Unexpected "${tk.value}"`);
        }
        let name = tk.value;
        if (name === 'Math' && isOp('.')) {
            pos++;
            const key = toks[pos++];
            if (!key || key.type !== 'id' || !HELPER_SET.has(key.value)) throw new ExprError('Unknown Math name');
            name = key.value;
        }
        if (name === 'true' || name === 'false') return {k: 'num', v: name === 'true' ? 1 : 0};
        if (name === 'data') {
            if (isOp('.')) {
                pos++;
                const key = toks[pos++];
                if (!key || key.type !== 'id') throw new ExprError('Expected a name after "data."');
                return {k: 'data', key: key.value};
            }
            if (isOp('[')) {
                pos++;
                const key = expr(0);
                expect(']');
                return {k: 'dataIdx', key};
            }
            return {k: 'var', name};
        }
        if (isOp('(')) {
            if (!HELPER_SET.has(name) || typeof HELPERS[name] !== 'function') {
                throw new ExprError(`Unknown function "${name}"`);
            }
            pos++;
            const args = [];
            if (!isOp(')')) {
                do args.push(expr(0));
                while (isOp(',') && ++pos);
            }
            expect(')');
            return {k: 'call', name, args};
        }
        if (VARS.has(name)) return {k: 'var', name};
        if (HELPER_SET.has(name) && typeof HELPERS[name] !== 'function') return {k: 'const', name};
        throw new ExprError(`Unknown name "${name}"`);
    };
    const expr = minPrec => {
        let left = primary();
        for (;;) {
            const tk = peek();
            if (!tk || tk.type !== 'op') break;
            if (tk.value === '?' && minPrec <= 0) {
                pos++;
                const a = expr(0);
                expect(':');
                const b = expr(0);
                left = {k: 'cond', c: left, a, b};
                continue;
            }
            const prec = BINARY[tk.value];
            if (!prec || prec < minPrec) break;
            pos++;
            const right = expr(tk.value === '**' ? prec : prec + 1);
            left = {k: 'bin', op: tk.value, a: left, b: right};
        }
        return left;
    };
    const tree = expr(0);
    if (pos < toks.length) throw new ExprError(`Unexpected "${toks[pos].value}"`);
    return tree;
};
const gen = (n, flags) => {
    switch (n.k) {
    case 'num': return `(${n.v})`;
    case 'str': return JSON.stringify(n.v);
    case 'var':
        if (DYNAMIC_NAMES.has(n.name)) flags.dynamic = true;
        if (n.name === 'data') flags.usesData = true;
        return n.name;
    case 'const': return `H.${n.name}`;
    case 'data':
        flags.usesData = true;
        return `D(data, ${JSON.stringify(n.key)})`;
    case 'dataIdx':
        flags.usesData = true;
        return `D(data, ${gen(n.key, flags)})`;
    case 'call':
        if (DYNAMIC_NAMES.has(n.name)) flags.dynamic = true;
        return `H.${n.name}(${n.args.map(a => gen(a, flags)).join(', ')})`;
    case 'un': return `(${n.op}${gen(n.a, flags)})`;
    case 'bin': return `(${gen(n.a, flags)} ${n.op} ${gen(n.b, flags)})`;
    case 'cond': return `(${gen(n.c, flags)} ? ${gen(n.a, flags)} : ${gen(n.b, flags)})`;
    }
    throw new ExprError('Bad expression');
};
const readData = (data, key) => {
    key = String(key);
    return data && Object.prototype.hasOwnProperty.call(data, key) ? data[key] : 0;
};
const build = src => {
    const flags = {dynamic: false, usesData: false};
    const body = gen(parse(src), flags);
    const factory = new Function('H', 'D',
        `"use strict"; return function ks5expr(t, value, data, time) { const sec = t; ` +
        `try { return ${body}; } catch (e) { return null; } };`);
    const fn = factory(HELPERS, readData);
    fn.dynamic = flags.dynamic;
    fn.usesData = flags.usesData;
    fn.src = src;
    return fn;
};
function exprBody(src) {
    return String(src === null || typeof src === 'undefined' ? '' : src).trim()
        .replace(/^return\b\s*/, '')
        .replace(/;\s*$/, '')
        .trim();
}
function parseExpr(src) {
    try { return parse(exprBody(src)); } catch (e) { throw new Error(e.message); }
}
function compileExpr(src) {
    if (src === null || typeof src === 'undefined') return null;
    src = exprBody(src);
    if (!src) return null;
    let fn = _cache.get(src);
    if (typeof fn !== 'undefined') return fn;
    try { fn = build(src); } catch (e) { fn = null; }
    if (_cache.size >= MAX_CACHE) _cache.delete(_cache.keys().next().value);
    _cache.set(src, fn);
    return fn;
}
function checkExpr(src) {
    src = exprBody(src);
    if (!src) return '';
    try { build(src); } catch (e) { return e.message; }
    const fn = compileExpr(src);
    if (!fn) return 'Invalid expression';
    const out = fn(0, 0, {}, Date.now() / 1000);
    if (out === null) return 'Expression threw an error at t = 0';
    return '';
}
const EXPR_HELP = [
  ["value", "what the keyframes say right now"],
  ["t", "seconds into the animation"],
  ["time", "clock seconds, keeps it moving while paused"],
  ["data.name", "a data track, or data set by blocks"],
  ["jitter(t, value, amount, speed, smooth)", "value plus a random wobble"],
  ["noise(x, seed)", "smooth drift between -1 and 1"],
  ["sin cos tan abs floor round sqrt min max", "and the rest of Math"],
  ["mod clamp lerp smoothstep", ""],
];
const EXPR_COMPLETIONS = [
  ...["t", "sec", "value", "time", "data"].map((n) => ({ name: n, meta: "variable" })),
  ...HELPER_NAMES.map((n) => ({ name: n, meta: typeof HELPERS[n] === "function" ? "function" : "constant" })),
];
const STEP = null;
class Sampler {
  constructor(track, key, rolls = null, noExpr = false) {
    const def = TD[key];
    const kfs = track.keyframes;
    const n = kfs.length;
    this.key = key;
    this.kind = def.kind;
    this.n = n;
    this.muted = !!track.muted;
    this.secs = new Float64Array(n);
    const numeric = def.kind === "num" || def.kind === "color" || (def.kind === "disc" && !def.str);
    this.vals = numeric ? new Float64Array(n) : new Array(n);
    this.eases = new Array(n);
    this.kfExprs = null;
    this.rand = null;
    this.cursor = 0;
    const trackExpr = track.expr && !def.str && !noExpr ? compileExpr(track.expr) : null;
    for (let i = 0; i < n; i++) {
      const kf = kfs[i];
      this.secs[i] = kf.sec;
      if (numeric) {
        let v = kf.value;
        if (typeof v === "boolean") v = v ? 1 : 0;
        v = +v;
        this.vals[i] = Number.isFinite(v) ? v : def.def ?? 0;
      } else { this.vals[i] = kf.value; }
      const e = kf.ease || "Linear_Out";
      this.eases[i] = e === "Step" ? STEP : e === "Bezier" ? easeFnFor(kf) : EASE[e] || EASE.Linear_Out;
      if (rolls && kf.rand && def.kind === "num") {
        if (!this.rand) {
          this.rand = new Int32Array(n).fill(-1);
          this.randMin = new Float64Array(n);
          this.randMax = new Float64Array(n);
        }
        this.rand[i] = rolls.count++;
        this.randMin[i] = kf.rand.min;
        this.randMax[i] = kf.rand.max;
      }
      if (!noExpr && (kf.expr || trackExpr)) {
        const fn = kf.expr ? compileExpr(kf.expr) : trackExpr;
        if (fn) { this.kfExprs ||= new Array(n).fill(null); this.kfExprs[i] = fn; }
      }
    }
    this.discrete = def.kind === "disc" || def.kind === "costume";
  }
  find(t) {
    const secs = this.secs;
    const n = this.n;
    let i = this.cursor;
    if (i >= n) i = n - 1;
    if (secs[i] <= t) {
      if (i + 1 >= n || t < secs[i + 1]) return (this.cursor = i);
      if (i + 2 >= n || t < secs[i + 2]) return (this.cursor = i + 1);
    }
    if (t < secs[0]) { this.cursor = 0; return -1; }
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (secs[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return (this.cursor = lo);
  }
  activeIndex(t) { const i = this.find(t); return i < 0 ? 0 : i; }
  roll(t, out) {
    const rand = this.rand;
    const secs = this.secs;
    const n = this.n;
    const prev = out.t;
    for (let i = 0; i < n; i++) {
      const slot = rand[i];
      if (slot < 0) continue;
      const lo = i > 0 ? secs[i - 1] : -Infinity;
      const hi = i < n - 1 ? secs[i + 1] : Infinity;
      const inside = t >= lo && t < hi;
      const again = n === 1 && t < prev;
      if (inside && (!out.rollIn[slot] || again)) out.rollAt[slot] = Math.random();
      out.rollIn[slot] = inside ? 1 : 0;
    }
  }
  valAt(i, rolled) {
    if (rolled && this.rand && this.rand[i] >= 0) {
      const a = this.randMin[i];
      return a + (this.randMax[i] - a) * rolled[this.rand[i]];
    }
    return this.vals[i];
  }
  sampleNum(t, rolled = null) {
    const n = this.n;
    const i = this.find(t);
    if (i < 0) return this.valAt(0, rolled);
    if (i >= n - 1 || this.discrete) return this.valAt(i, rolled);
    const ease = this.eases[i + 1];
    if (ease === STEP) return this.valAt(i, rolled);
    const a = this.valAt(i, rolled);
    const b = this.valAt(i + 1, rolled);
    const span = this.secs[i + 1] - this.secs[i];
    const k = span > 0 ? ease((t - this.secs[i]) / span) : 1;
    if (this.kind === "color") return lerpColor(a, b, k);
    return a + (b - a) * k;
  }
  sampleAny(t) { const i = this.find(t); return this.vals[i < 0 ? 0 : i]; }
}
function lerpColor(a, b, k) {
  a = Math.max(0, Math.min(0xffffff, Math.round(a)));
  b = Math.max(0, Math.min(0xffffff, Math.round(b)));
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * k) << 16) | (Math.round(ag + (bg - ag) * k) << 8) | Math.round(ab + (bb - ab) * k);
}
const DEFAULTS = new Float64Array(NUM_SLOTS);
NUM_PROPS.forEach((k, i) => { const d = TD[k].def; DEFAULTS[i] = typeof d === "number" ? d : 0; });
const S_X = SLOT.x, S_Y = SLOT.y, S_ROT = SLOT.rotation, S_SX = SLOT.scaleX, S_SY = SLOT.scaleY;
const S_FP = SLOT.followPos, S_FR = SLOT.followRot, S_FS = SLOT.followScale;
const S_VIS = SLOT.visible;
class CompiledGroup {
  constructor(doc, g, index, rolls, noExpr = false) {
    this.src = g;
    this.name = g.name;
    this.index = index;
    this.visible = g.visible !== false;
    this.pivotX = (g.pivot && g.pivot.x) || 0;
    this.pivotY = (g.pivot && g.pivot.y) || 0;
    this.nineSlice = g.nineSlice || null;
    this.samplers = new Array(NUM_SLOTS).fill(null);
    this.exprs = new Array(NUM_SLOTS).fill(null);
    this.str = {};
    this.active = [];
    this.dynamic = false;
    this.usesData = false;
    const tracks = g.tracks || {};
    for (let s = 0; s < NUM_SLOTS; s++) {
      const key = NUM_PROPS[s];
      const tr = tracks[key];
      if (tr && tr.keyframes.length && !tr.muted) this.samplers[s] = new Sampler(tr, key, rolls, noExpr);
      const ex = g.exprs && g.exprs[key] && !noExpr ? compileExpr(g.exprs[key]) : null;
      if (ex) this.exprs[s] = ex;
      if (this.samplers[s] || ex) this.active.push(s);
      this.noteExpr(ex);
      if (this.samplers[s] && this.samplers[s].kfExprs) for (const fx of this.samplers[s].kfExprs) this.noteExpr(fx);
    }
    for (const key of STR_PROPS) {
      const tr = tracks[key];
      this.str[key] = tr && tr.keyframes.length && !tr.muted ? new Sampler(tr, key) : null;
    }
    const ct = tracks.costume;
    this.costume = ct && ct.keyframes.length && !ct.muted ? new Sampler(ct, "costume", null, noExpr) : null;
    if (this.costume && this.costume.kfExprs) for (const fx of this.costume.kfExprs) this.noteExpr(fx);
    this.costumeExpr = g.exprs && g.exprs.costume && !noExpr ? compileExpr(g.exprs.costume) : null;
    this.noteExpr(this.costumeExpr);
    this.activeSlots = Int32Array.from(this.active);
  }
  noteExpr(fn) {
    if (!fn) return;
    if (fn.dynamic) this.dynamic = true;
    if (fn.usesData) this.usesData = true;
  }
}
class PoseSet {
  constructor(n) { this.resize(n); }
  resize(n) {
    this.n = n;
    this.num = new Float64Array(n * NUM_SLOTS);
    this.world = new Float64Array(n * 5);
    this.worldState = new Uint8Array(n);
    this.costume = new Int32Array(n);
    this.blend = new Array(n).fill("source-over");
    this.filter = new Array(n).fill("");
    this.parent = new Int32Array(n).fill(-1);
    this.mask = new Int32Array(n).fill(-1);
    this.order = new Int32Array(n);
    this.t = NaN;
    this.rollsFor = "";
  }
  prepareRolls(c) {
    if (this.rollsFor === c.rollsId) return;
    this.rollsFor = c.rollsId;
    this.rollAt = new Float64Array(c.rolls.count);
    this.rollIn = new Uint8Array(c.rolls.count);
  }
  get(gi, key) { return this.num[gi * NUM_SLOTS + SLOT[key]]; }
}
class CompiledAnim {
  constructor(doc, opt = null) {
    this.doc = doc;
    this.noExpr = !!(opt && opt.noExpr);
    this.id = doc.id;
    this.duration = doc.duration;
    this.infinite = !!doc.infinite;
    this.width = doc.width;
    this.height = doc.height;
    this.rolls = { count: 0 };
    this.groups = doc.groups.map((g, i) => new CompiledGroup(doc, g, i, this.rolls, this.noExpr));
    this.hasRandom = this.rolls.count > 0;
    this.rollsId = this.hasRandom ? `${doc.id}|${this.rolls.count}` : "";
    this.byName = new Map(this.groups.map((g, i) => [g.name, i]));
    this.dynamic = this.groups.some((g) => g.dynamic);
    this.usesData = this.groups.some((g) => g.usesData);
    this.dataTracks = (doc.dataTracks || [])
      .filter((dt) => dt.name && dt.keyframes && dt.keyframes.length)
      .map((dt) => ({ name: dt.name, sampler: new Sampler({ keyframes: dt.keyframes }, dt.disc ? "zIndex" : "x") }));
    this.events = (doc.events || []).map((e) => ({ sec: e.sec, value: e.value }));
    this.anyMotionBlur = this.groups.some((g) => g.samplers[SLOT.motionBlur]);
    this.anyAfterimage = this.groups.some((g) => g.samplers[SLOT.afterimageIntensity]);
    this.hasDataTracks = this.dataTracks.length > 0;
  }
  fillData(t, base, data) {
    for (const k in data) delete data[k];
    if (base) for (const k in base) data[k] = base[k];
    for (const dt of this.dataTracks) data[dt.name] = dt.sampler.discrete ? dt.sampler.sampleAny(t) : dt.sampler.sampleNum(t);
    return data;
  }
  evaluate(t, out, data, time, bindings, overrides) {
    const groups = this.groups;
    const n = groups.length;
    if (out.n !== n) out.resize(n);
    const num = out.num;
    if (this.hasRandom) out.prepareRolls(this);
    for (let gi = 0; gi < n; gi++) {
      const g = groups[gi];
      const base = gi * NUM_SLOTS;
      num.set(DEFAULTS, base);
      const act = g.activeSlots;
      for (let j = 0; j < act.length; j++) {
        const s = act[j];
        const sm = g.samplers[s];
        let v = DEFAULTS[s];
        if (sm) {
          if (sm.rand) { sm.roll(t, out); v = sm.sampleNum(t, out.rollAt); } else v = sm.sampleNum(t);
          if (sm.kfExprs && evaluateOverridesEnabled) {
            const fx = sm.kfExprs[sm.activeIndex(t)];
            if (fx) {
              const r = fx(t, v, data, time);
              if (r !== null && r !== undefined && r !== "") {
                const rv = +r;
                if (Number.isFinite(rv)) v = rv;
              }
            }
          }
        }
        const ex = g.exprs[s];
        if (ex) {
          const r = ex(t, v, data, time);
          if (r !== null && r !== undefined && r !== "") {
            const rv = typeof r === "boolean" ? (r ? 1 : 0) : +r;
            if (Number.isFinite(rv)) v = rv;
          }
        }
        num[base + s] = v;
      }
      const ov = overrides && overrides[gi];
      if (ov) for (const [s, v] of ov) if (typeof s === "number") num[base + s] = v;
      out.blend[gi] = (ov && ov.get("blendMode")) || (g.str.blendMode ? String(g.str.blendMode.sampleAny(t) || "source-over") : "source-over");
      out.filter[gi] = (ov && ov.get("fxCustom")) ?? (g.str.fxCustom ? String(g.str.fxCustom.sampleAny(t) || "") : "");
      const pn = g.str.relativeTo ? g.str.relativeTo.sampleAny(t) : "";
      const pi = pn ? this.byName.get(String(pn)) : undefined;
      out.parent[gi] = pi === undefined || pi === gi ? -1 : pi;
      const mn = g.str.maskSource ? g.str.maskSource.sampleAny(t) : "";
      const mi = mn ? this.byName.get(String(mn)) : undefined;
      out.mask[gi] = mi === undefined || mi === gi ? -1 : mi;
      out.costume[gi] = this.resolveCostume(g, t, data, time, bindings ? bindings[gi] : null, ov);
    }
    out.worldState.fill(0);
    for (let gi = 0; gi < n; gi++) resolveWorld(out, gi);
    const order = out.order;
    for (let i = 0; i < n; i++) order[i] = i;
    let sorted = true;
    for (let i = 1; i < n; i++) if (num[order[i] * NUM_SLOTS + SLOT.zIndex] !== num[order[i - 1] * NUM_SLOTS + SLOT.zIndex]) sorted = false;
    if (!sorted) {
      const arr = Array.from(order);
      arr.sort((a, b) => num[b * NUM_SLOTS + SLOT.zIndex] - num[a * NUM_SLOTS + SLOT.zIndex] || a - b);
      for (let i = 0; i < n; i++) order[i] = arr[i];
    }
    out.t = t;
    return out;
  }
  isVisible(out, gi) { return this.groups[gi].visible && out.num[gi * NUM_SLOTS + S_VIS] !== 0; }
  resolveCostume(g, t, data, time, binding, ov) {
    if (ov && ov.has("costume")) return resolveCostumeRef(binding, ov.get("costume"), g.src);
    if (g.costumeExpr) {
      const r = g.costumeExpr(t, this.rawCostumeIndex(g, t, binding), data, time);
      if (r !== null && r !== undefined) return resolveCostumeRef(binding, r, g.src);
    }
    const sm = g.costume;
    if (!sm) return binding ? 0 : -9;
    const n = sm.n;
    const i = sm.find(t);
    const fxAt = (k, idx) => {
      if (!sm.kfExprs || !evaluateOverridesEnabled) return idx;
      const fx = sm.kfExprs[k];
      if (!fx) return idx;
      const r = fx(t, idx, data, time);
      return r !== null && r !== undefined ? resolveCostumeRef(binding, r, g.src) : idx;
    };
    if (i < 0) return fxAt(0, resolveCostumeRef(binding, sm.vals[0], g.src));
    if (i >= n - 1) return fxAt(n - 1, resolveCostumeRef(binding, sm.vals[n - 1], g.src));
    const a = resolveCostumeRef(binding, sm.vals[i], g.src);
    const ease = sm.eases[i + 1];
    if (ease === STEP || a < 0) return fxAt(i, a);
    const b = resolveCostumeRef(binding, sm.vals[i + 1], g.src);
    if (b < 0) return fxAt(i, a);
    const span = sm.secs[i + 1] - sm.secs[i];
    const k = span > 0 ? ease((t - sm.secs[i]) / span) : 1;
    return fxAt(i, Math.round(a + (b - a) * k));
  }
  rawCostumeIndex(g, t, binding) {
    const sm = g.costume;
    if (!sm) return 0;
    return resolveCostumeRef(binding, sm.sampleAny(t), g.src);
  }
  eventsBetween(prev, cur, cb) {
    for (const ev of this.events) if (ev.sec > prev && ev.sec <= cur) cb(ev.value, ev.sec);
  }
}
let evaluateOverridesEnabled = true;
function setOverridesEnabled(v) { evaluateOverridesEnabled = !!v; }
function resolveWorld(out, gi) {
  const st = out.worldState[gi];
  if (st === 2) return;
  const num = out.num;
  const base = gi * NUM_SLOTS;
  const w = gi * 5;
  const lx = num[base + S_X], ly = num[base + S_Y], lr = num[base + S_ROT], lsx = num[base + S_SX], lsy = num[base + S_SY];
  const p = out.parent[gi];
  if (p < 0 || st === 1 || out.worldState[p] === 1) {
    out.world[w] = lx;
    out.world[w + 1] = ly;
    out.world[w + 2] = lr;
    out.world[w + 3] = lsx;
    out.world[w + 4] = lsy;
    out.worldState[gi] = 2;
    return;
  }
  out.worldState[gi] = 1;
  resolveWorld(out, p);
  const pw = p * 5;
  const px = out.world[pw], py = out.world[pw + 1], pr = out.world[pw + 2];
  const psx = (out.world[pw + 3] || 1e-5) / 100;
  const psy = (out.world[pw + 4] || 1e-5) / 100;
  let x = lx, y = ly, r = lr, sx = lsx, sy = lsy;
  if (num[base + S_FP]) {
    const a = (-pr * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const rx = lx * psx, ry = ly * psy;
    x = px + (rx * c - ry * s);
    y = py + (rx * s + ry * c);
  }
  if (num[base + S_FR]) r = pr + lr;
  if (num[base + S_FS]) { sx = lsx * psx; sy = lsy * psy; }
  out.world[w] = x;
  out.world[w + 1] = y;
  out.world[w + 2] = r;
  out.world[w + 3] = sx;
  out.world[w + 4] = sy;
  out.worldState[gi] = 2;
}
function resolveCostumeRef(binding, ref, srcGroup) {
  if (!binding) return -9;
  const count = binding.count;
  if (ref && typeof ref === "object") {
    if (ref.name == null) return -9;
    const i = binding.byName.get(ref.name);
    if (i !== undefined) return i;
    return renamedLookup(binding, ref.name, srcGroup);
  }
  if (typeof ref === "string" && ref !== "" && isNaN(ref)) {
    let i = binding.byName.get(ref);
    if (i !== undefined) return i;
    i = binding.byLowerName.get(ref.toLowerCase());
    if (i !== undefined) return i;
    return renamedLookup(binding, ref, srcGroup);
  }
  if (ref === -9) return -9;
  const idx = Math.round(parseFloat(ref) || 0);
  return idx < 0 || idx >= count ? -9 : idx;
}
function renamedLookup(binding, name, g) {
  if (!g || !g.costumeIds || !g.costumeNames) return -9;
  const oi = g.costumeNames.indexOf(name);
  if (oi < 0) return -9;
  const asset = g.costumeIds[oi];
  if (!asset) return -9;
  const i = binding.byAsset.get(asset);
  return i === undefined ? -9 : i;
}
const MAX_RAW = 512;
let serials = 0;
class AnimRecord {
  constructor(store, raw, doc) {
    this.store = store;
    this.raw = raw;
    this.doc = doc;
    this.id = doc.id;
    this.serial = ++serials;
    this.ownerSprite = null;
    this.libraryName = "";
    this._compiled = null;
    this._ovCache = null;
    this.value = new AnimValue(this);
  }
  get compiled() { return (this._compiled ||= new CompiledAnim(this.doc)); }
  get state() { return this.store.stateFor(this.id); }
  overridesArray() {
    const st = this.state;
    if (!st.overrides.size) return null;
    const c = this._ovCache;
    if (c && c.version === st.overridesVersion) return c.list;
    const list = this.compiled.groups.map((g) => st.overrides.get(g.name) || null);
    this._ovCache = { version: st.overridesVersion, list };
    return list;
  }
  invalidate() { this._compiled = null; this._ovCache = null; }
}
class AnimValue {
  constructor(record) { this.record = record; }
  toString() { return this.record.raw; }
  toJSON() { return this.record.raw; }
  get isKS5Anim() { return true; }
  toReporterContent() {
    return AnimValue.renderBubble ? AnimValue.renderBubble(this.record) : document.createTextNode(this.record.libraryName || this.record.doc.name || this.record.id);
  }
  toMonitorContent() { return this.toReporterContent(); }
}
AnimValue.renderBubble = null;
class AnimStore {
  constructor() { this.byRaw = new Map(); this.byId = new Map(); this.states = new Map(); }
  stateFor(id) {
    let st = this.states.get(id);
    if (!st) {
      st = {
        data: Object.create(null),
        dataVersion: 0,
        overrides: new Map(),
        overridesVersion: 0,
        playMode: "clamp",
        aa: undefined,
        detail: undefined,
        lastEvent: "",
      };
      this.states.set(id, st);
    }
    return st;
  }
  resolve(arg) {
    if (arg == null) return null;
    if (arg instanceof AnimValue) return arg.record;
    if (typeof arg === "object" && arg.record instanceof AnimRecord) return arg.record;
    if (typeof arg !== "string") arg = String(arg);
    return this.fromRaw(arg);
  }
  fromRaw(raw) {
    const hit = this.byRaw.get(raw);
    if (hit !== undefined) return hit;
    const obj = parseAnim(raw);
    let rec = null;
    if (obj) { const doc = normalizeAnim(obj); rec = new AnimRecord(this, raw, doc); this.byId.set(doc.id, rec); }
    if (this.byRaw.size >= MAX_RAW) this.byRaw.delete(this.byRaw.keys().next().value);
    this.byRaw.set(raw, rec);
    return rec;
  }
  fromDoc(doc) {
    const raw = serializeAnim(doc);
    const hit = this.byRaw.get(raw);
    if (hit) return hit;
    const rec = new AnimRecord(this, raw, normalizeAnim(JSON.parse(raw)));
    this.byRaw.set(raw, rec);
    this.byId.set(rec.id, rec);
    return rec;
  }
  latest(id) { return this.byId.get(id) || null; }
  clear() { this.byRaw.clear(); this.byId.clear(); this.states.clear(); }
  setOverride(id, groupName, key, value) {
    const st = this.stateFor(id);
    let m = st.overrides.get(groupName);
    if (!m) st.overrides.set(groupName, (m = new Map()));
    const slot = key in SLOT ? SLOT[key] : key;
    m.set(slot, value);
    st.overridesVersion++;
  }
  clearOverride(id, groupName, key) {
    const st = this.stateFor(id);
    const m = st.overrides.get(groupName);
    if (!m) return;
    if (key == null) st.overrides.delete(groupName);
    else {
      m.delete(key in SLOT ? SLOT[key] : key);
      if (!m.size) st.overrides.delete(groupName);
    }
    st.overridesVersion++;
  }
  setData(id, key, value) { const st = this.stateFor(id); st.data[key] = value; st.dataVersion++; }
}
export { ALL_TRACKS, AnimRecord, AnimStore, AnimValue, BLEND_MODES, CompiledAnim, DEFAULT_BEZ, DEG, DOC_VERSION, EASE, EASE_DIRS, EASE_FAMS, EPS_SEC, EXPR_COMPLETIONS, EXPR_HELP, EXPR_TRACKS, FX_TRACKS, MASK_TRACKS, NICHE_TRACKS, NUM_PROPS, NUM_SLOTS, PARENT_TRACKS, PoseSet, SLOT, STR_PROPS, STYLE_TRACKS, Sampler, TD, THIS_SPRITE, TRANSFORM_TRACKS, allKeyframeTimes, applyEase, base64ToBytes, bindingEpoch, bindingForSprite, bindingsFor, bumpBindingEpoch, bytesToBase64, checkExpr, clamp, compileExpr, cubicBezier, dataURLToBytes, deepClone, defaultEaseFor, displayName, downloadBlob, easeFnFor, evaluateOverridesEnabled, exprBody, findGroupSprite, formatTime, hexToInt, intToHex, intToRGB, isDiscrete, jitter, lastKeyframeTime, lerp, makeAnimId, makeKFID, newAnim, newGroup, noise, normalizeAnim, normalizeGroup, normalizeVector, vectorBounds, vectorSVG, parseAnim, parseCssColor, parseExpr, pickFiles, refreshGroupCostumeInfo, renameGroupRefs, resolveCostumeRef, sameSec, serializeAnim, setOverridesEnabled, splitEase, trackKeys, uniqueName };
