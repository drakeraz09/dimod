import paper from '@turbowarp/paper';
import log from '../log/log';
const options = {
    preset: 'ROUND',
    bitPreset: 'ROUND',
    pressure: false,
    taper: 0,
    gradientDither: false,
    fillTolerance: 0,
    effectSize: 2,
    sprayDensity: 30,
    lineProfile: 'UNIFORM',
    lineStyle: null,
    lassoSmoothing: 2
};
const getBrushOptions = () => options;
const setCurrentBrushOption = function (key, value) {
    if (key in options) options[key] = value;
};
const KEY$1 = 'dimod.paint.brushes.v1';
const MAX_SIDE = 256;
const MAX_SVG = 200 * 1024;
const PREFIX = 'CUSTOM:';
const isTexture = preset => typeof preset === 'string' && preset.indexOf('T:') === 0 && preset in LINE_TEXTURES;
const isCustomPreset = preset => typeof preset === 'string' && (preset.indexOf(PREFIX) === 0 || isTexture(preset));
const presetFor = brush => (brush.builtin ? brush.id : `${PREFIX}${brush.id}`);
let brushes = null;
const listeners = new Set();
const load = () => {
    if (brushes) return brushes;
    try {
        const raw = JSON.parse(window.localStorage.getItem(KEY$1) || '[]');
        brushes = Array.isArray(raw) ? raw.filter(b => b && b.id && b.mask) : [];
    } catch (e) { brushes = []; }
    return brushes;
};
const save = () => { window.localStorage.setItem(KEY$1, JSON.stringify(brushes)); listeners.forEach(fn => fn(brushes)); };
const getCustomBrushes = () => load();
const textureBrushes = new Map();
const textureBrush = ref => {
    let brush = textureBrushes.get(ref);
    if (brush) return brush;
    const src = brushSource(ref);
    if (!src) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    context.translate(48, 48);
    context.scale(80, 80);
    context.fill(new Path2D(src.tip.getPathData(null, 3)));
    brush = {id: ref, name: LINE_TEXTURES[ref].name, mask: canvas.toDataURL('image/png'), svg: null,
        spacing: src.spacing, scatter: src.scatter, orient: src.orient, builtin: true};
    textureBrushes.set(ref, brush);
    return brush;
};
const getTextureBrushes = () => Object.keys(LINE_TEXTURES).map(textureBrush).filter(Boolean);
const customBrushFor = preset => {
    if (isTexture(preset)) return textureBrush(preset);
    if (!isCustomPreset(preset)) return null;
    const id = preset.slice(PREFIX.length);
    return load().find(b => b.id === id) || null;
};
const subscribeCustomBrushes = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const loadImage = src => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That image could not be read'));
    image.src = src;
});
const readAs = (file, how) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('That file could not be read'));
    if (how === 'text') reader.readAsText(file);
    else reader.readAsDataURL(file);
});
const maskFromImage = image => {
    const w0 = image.naturalWidth || image.width || MAX_SIDE;
    const h0 = image.naturalHeight || image.height || MAX_SIDE;
    const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, w, h);
    const data = context.getImageData(0, 0, w, h);
    const px = data.data;
    let transparent = false;
    for (let i = 3; i < px.length; i += 4) {
        if (px[i] < 250) { transparent = true; break; }
    }
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let i = 0; i < px.length; i += 4) {
        const lum = (0.299 * px[i]) + (0.587 * px[i + 1]) + (0.114 * px[i + 2]);
        const alpha = transparent ? px[i + 3] : Math.round(255 - lum);
        px[i] = 0;
        px[i + 1] = 0;
        px[i + 2] = 0;
        px[i + 3] = alpha;
        if (alpha > 8) {
            const p = i / 4;
            const x = p % w;
            const y = (p - x) / w;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    if (maxX < 0) throw new Error('That image has nothing in it to paint with');
    context.putImageData(data, 0, 0);
    const out = document.createElement('canvas');
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(canvas, -minX, -minY);
    return out.toDataURL('image/png');
};
const addCustomBrushFromFile = async file => {
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
    let svg = null;
    let src;
    if (isSvg) {
        if (file.size > MAX_SVG) throw new Error('That SVG is too big for a brush (200 KB at most)');
        svg = await readAs(file, 'text');
        src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } else { src = await readAs(file, 'url'); }
    const mask = maskFromImage(await loadImage(src));
    const brush = {
        id: Math.random().toString(36)
            .slice(2, 10),
        name: (file.name || 'Brush').replace(/\.[^.]+$/, '').slice(0, 40) || 'Brush',
        mask,
        svg,
        spacing: 25,
        scatter: 0
    };
    load().push(brush);
    try { save(); } catch (e) { brushes.pop(); throw new Error('There is no room left to keep another brush in this browser'); }
    return brush;
};
const updateCustomBrush = (id, patch) => {
    const brush = load().find(b => b.id === id);
    if (!brush) return;
    Object.assign(brush, patch);
    save();
};
const removeCustomBrush = id => {
    brushes = load().filter(b => b.id !== id);
    maskImages.delete(id);
    vectorTips.delete(id);
    save();
};
const maskImages = new Map();
const getMaskImage = brush => {
    let image = maskImages.get(brush.id);
    if (!image) { image = new Image(); image.src = brush.mask; maskImages.set(brush.id, image); }
    return image.complete && image.naturalWidth ? image : null;
};
const makeCustomMark = (brush, size, color) => {
    const image = getMaskImage(brush);
    if (!image) return null;
    const scale = size / Math.max(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
};
const vectorTips = new Map();
const traceMask = image => {
    const side = 64;
    const scale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight));
    const w = Math.max(1, Math.round(image.naturalWidth * scale));
    const h = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, w, h);
    const px = context.getImageData(0, 0, w, h).data;
    const rects = [];
    for (let y = 0; y < h; y++) {
        let start = -1;
        for (let x = 0; x <= w; x++) {
            const ink = x < w && px[(((y * w) + x) * 4) + 3] > 127;
            if (ink && start < 0) start = x;
            if (!ink && start >= 0) {
                rects.push(new paper.Path.Rectangle({point: [start, y], size: [x - start, 1], insert: false}));
                start = -1;
            }
        }
    }
    if (!rects.length) return null;
    const all = new paper.CompoundPath({children: rects, insert: false});
    const merged = all.unite(new paper.Path({insert: false}), {insert: false});
    if (merged.simplify) merged.simplify(0.6);
    else if (merged.children) merged.children.forEach(child => child.simplify && child.simplify(0.6));
    return merged;
};
const fromSvg = svg => {
    const item = paper.project.importSVG(svg, {insert: false, expandShapes: true});
    const paths = [];
    const collect = node => {
        if (node instanceof paper.Path || node instanceof paper.CompoundPath) {
            if (node.fillColor || !node.strokeColor) paths.push(node.clone({insert: false}));
            return;
        }
        (node.children || []).forEach(collect);
    };
    collect(item);
    if (!paths.length) return null;
    return new paper.CompoundPath({
        children: paths.flatMap(p => (p instanceof paper.CompoundPath ? p.removeChildren() : [p])),
        insert: false
    });
};
const getVectorTip = brush => {
    if (brush.builtin) return brushSource(brush.id).tip;
    let tip = vectorTips.get(brush.id);
    if (tip) return tip;
    try { tip = brush.svg ? fromSvg(brush.svg) : null; } catch (e) { tip = null; }
    if (!tip) {
        const image = getMaskImage(brush);
        if (!image) return null;
        tip = traceMask(image);
    }
    if (!tip) return null;
    const bounds = tip.bounds;
    tip.translate(bounds.center.multiply(-1));
    tip.scale(1 / Math.max(bounds.width, bounds.height, 1e-6), new paper.Point(0, 0));
    vectorTips.set(brush.id, tip);
    return tip;
};
const preloadCustomBrushes = () => load().forEach(getMaskImage);
let currentMode = null;
let pendingLabel = null;
const setHistoryMode = function (mode) { currentMode = mode; };
const setHistoryLabel = function (command) {
    pendingLabel = command;
    setTimeout(() => {
        if (pendingLabel === command) pendingLabel = null;
    }, 0);
};
const takeHistoryLabel = function () {
    const label = pendingLabel ?
        {kind: 'command', value: pendingLabel} :
        {kind: 'mode', value: currentMode};
    pendingLabel = null;
    return label;
};
const labelled = (command, fn) => (...args) => { setHistoryLabel(command); return fn(...args); };
const ID_LENGTH = 8;
const ID_PREFIX = 'd-';
const generateDid = function () {
    let did = '';
    for (let i = 0; i < ID_LENGTH; i++) { did += Math.floor(Math.random() * 36).toString(36); }
    return did;
};
const getDid = function (item) { return (item && item.data && item.data.did) || null; };
const setDid = function (item, did) {
    if (!item.data) item.data = {};
    item.data.did = did;
};
const didToAttribute = function (did) { return ID_PREFIX + did; };
const attributeToDid = function (attribute) {
    if (typeof attribute !== 'string' || attribute.indexOf(ID_PREFIX) !== 0) return null;
    const did = attribute.substring(ID_PREFIX.length);
    return did.length ? did : null;
};
const LineProfiles = {
    UNIFORM: 'UNIFORM',
    TAPER_BOTH: 'TAPER_BOTH',
    TAPER_START: 'TAPER_START',
    TAPER_END: 'TAPER_END',
    SWELL: 'SWELL',
    PINCH: 'PINCH'
};
const ease = t => Math.sqrt(Math.max(0, Math.min(1, t)));
const profileWidth = (profile, t) => {
    switch (profile) {
    case LineProfiles.TAPER_BOTH: return Math.min(ease(t / 0.35), ease((1 - t) / 0.35));
    case LineProfiles.TAPER_START: return ease(t / 0.6);
    case LineProfiles.TAPER_END: return ease((1 - t) / 0.6);
    case LineProfiles.SWELL: return 0.25 + (0.75 * Math.sin(Math.PI * t));
    case LineProfiles.PINCH: return 1 - (0.75 * Math.sin(Math.PI * t));
    default: return 1;
    }
};
const MIN_WIDTH = 0.05;
const outlinePath = (path, profile, halfWidth) => {
    const length = path.length;
    if (!(length > 0)) return [];
    const count = Math.max(8, Math.min(600, Math.ceil(length / 2)));
    const left = [];
    const right = [];
    const last = path.closed ? count - 1 : count;
    for (let i = 0; i <= last; i++) {
        const offset = Math.min(length, length * i / count);
        const point = path.getPointAt(offset);
        const normal = path.getNormalAt(offset);
        if (!point || !normal) continue;
        const r = Math.max(MIN_WIDTH, halfWidth * profileWidth(profile, i / count));
        left.push(point.add(normal.multiply(r)));
        right.push(point.subtract(normal.multiply(r)));
    }
    if (left.length < 2) return [];
    if (path.closed) {
        return [
            new paper.Path({segments: left, closed: true, insert: false}),
            new paper.Path({segments: right.reverse(), closed: true, insert: false})
        ];
    }
    const cap = (center, from, r) => {
        const out = [];
        const start = from.subtract(center).angle;
        for (let k = 1; k < 8; k++) out.push(center.add(new paper.Point({angle: start - (180 * k / 8), length: r})));
        return out;
    };
    const rEnd = Math.max(MIN_WIDTH, halfWidth * profileWidth(profile, 1));
    const rStart = Math.max(MIN_WIDTH, halfWidth * profileWidth(profile, 0));
    const segments = left
        .concat(cap(path.getPointAt(length), left[left.length - 1], rEnd))
        .concat(right.slice().reverse())
        .concat(cap(path.getPointAt(0), right[0], rStart));
    return [new paper.Path({segments, closed: true, insert: false})];
};
const isOutlined = item => (item instanceof paper.Path || item instanceof paper.CompoundPath) &&
    Boolean(item.strokeColor) && item.strokeWidth > 0;
const getLineProfile = item => {
    const profile = item && item.data && item.data.dimodProfile;
    return profile && profile !== LineProfiles.UNIFORM ? profile : null;
};
const profileShape = (item, profile) => {
    if (!isOutlined(item)) return null;
    const paths = item instanceof paper.CompoundPath ? item.children : [item];
    const half = item.strokeWidth / 2;
    const pieces = [];
    paths.forEach(path => pieces.push(...outlinePath(path, profile, half)));
    if (!pieces.length) return null;
    return new paper.CompoundPath({children: pieces, fillRule: 'nonzero', insert: false});
};
const setLineProfile = (item, profile) => {
    if (!item) return;
    if (!item.data) item.data = {};
    if (!profile || profile === LineProfiles.UNIFORM) delete item.data.dimodProfile;
    else item.data.dimodProfile = profile;
    delete item.__dimodSkin;
    if (paper.view) paper.view.draw();
};
const LINE_STYLES = {
    SOLID: {dash: 0, gap: 0, cap: 'butt'},
    DASHED: {dash: 3, gap: 2, cap: 'butt'},
    LONG_DASH: {dash: 6, gap: 2.5, cap: 'butt'},
    DOTTED: {dash: 0, gap: 2, cap: 'round'},
    DASH_DOT: {dash: 4, gap: 2, cap: 'round'},
    DASH_DOT_DOT: {dash: 4, gap: 2, cap: 'round'}
};
const lineStyleOf = ls => {
    const num = (v, d) => (isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
    if (ls && ls.type === 'BRUSH') {
        const src = brushSource(ls.brush);
        return {type: 'BRUSH', brush: String(ls.brush || ''), spacing: Math.max(1, num(ls.spacing, src ? src.spacing : 25)),
            scatter: num(ls.scatter, src ? src.scatter : 0), seed: Math.round(num(ls.seed, 0)) || 1,
            dash: 0, gap: 0, cap: 'round', offset: 0,
            pressure: Array.isArray(ls.pressure) && ls.pressure.length > 1 ?
                ls.pressure.slice(0, 64).map(v => Math.round(Math.max(0, Math.min(1.5, Number(v) || 0)) * 100) / 100) : null};
    }
    const type = ls && ls.type in LINE_STYLES ? ls.type : 'SOLID';
    const base = LINE_STYLES[type];
    return {type, dash: num(ls && ls.dash, base.dash), gap: num(ls && ls.gap, base.gap),
        cap: ls && ['butt', 'round', 'square'].includes(ls.cap) ? ls.cap : base.cap, offset: num(ls && ls.offset, 0)};
};
const lineDash = (ls, width) => {
    ls = lineStyleOf(ls);
    const w = Math.max(width || 1, 0.5);
    const dot = 0.001;
    const g = Math.max(ls.gap * w, ls.cap === 'butt' ? 0.5 : w + 0.5);
    switch (ls.type) {
    case 'DASHED':
    case 'LONG_DASH': return [Math.max(ls.dash * w, 0.5), ls.gap * w || 0.5];
    case 'DOTTED': return [Math.max(ls.dash * w, dot), g];
    case 'DASH_DOT': return [Math.max(ls.dash * w, 0.5), g, dot, g];
    case 'DASH_DOT_DOT': return [Math.max(ls.dash * w, 0.5), g, dot, g, dot, g];
    default: return [];
    }
};
const isStrokable = item => item && (item instanceof paper.Path || item instanceof paper.CompoundPath) &&
    Boolean(item.strokeColor) && item.strokeWidth > 0;
const setLineStyle = (item, ls) => {
    if (!item) return;
    ls = lineStyleOf(ls);
    if (!item.data) item.data = {};
    if (ls.type === 'SOLID') {
        if (!item.data.dimodLine) return;
        delete item.data.dimodLine;
        item.dashArray = [];
        item.dashOffset = 0;
        item.strokeCap = 'butt';
        return;
    }
    item.data.dimodLine = ls;
    delete item.__dimodSkin;
    item._changed(8);
    item.dashArray = lineDash(ls, item.strokeWidth);
    item.dashOffset = ls.offset * Math.max(item.strokeWidth, 0.5);
    item.strokeCap = ls.cap;
};
const applyLineStyle = (item, ls) => {
    if (isStrokable(item) && ls && ls.type && ls.type !== 'SOLID') setLineStyle(item, ls);
    return item;
};
const readLineStyle = item => {
    if (!item) return null;
    if (item.data && item.data.dimodLine) return lineStyleOf(item.data.dimodLine);
    const d = item.dashArray;
    if (!d || !d.length || !(item.strokeWidth > 0)) return null;
    const w = item.strokeWidth;
    const type = d.length >= 6 ? 'DASH_DOT_DOT' : d.length >= 4 ? 'DASH_DOT' : d[0] < 0.01 ? 'DOTTED' : 'DASHED';
    return lineStyleOf({type, dash: d[0] / w, gap: d[1] / w, cap: item.strokeCap});
};
const applyLineProfile = (item, profile) => {
    if (item && profile && profile !== LineProfiles.UNIFORM) setLineProfile(item, profile);
    return item;
};
const solidCss = color => {
    if (color.type === 'gradient') { const stop = color.gradient.stops[0]; return stop ? stop.color.toCSS(true) : 'black'; }
    return color.toCSS(true);
};
const mulberry = seed => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};
const blobTip = (rand, n, radius, jitter) => {
    const path = new paper.Path({closed: true, insert: false});
    for (let i = 0; i < n; i++) {
        path.add(new paper.Point({angle: (i / n) * 360, length: radius * (1 - jitter + (rand() * jitter * 2))}));
    }
    return path;
};
const dots = (count, rMin, rMax, spread) => rand => {
    const out = [];
    for (let i = 0; i < count; i++) {
        const r = rMin + (rand() * (rMax - rMin));
        const at = new paper.Point({angle: rand() * 360, length: spread * Math.sqrt(rand())});
        out.push(new paper.Path.Circle({center: at, radius: r, insert: false, data: {circle: true}}));
    }
    return out;
};
const LINE_TEXTURES = {
    'T:chalk': {name: 'Chalk', spacing: 28, scatter: 35, build: dots(12, 0.04, 0.1, 0.42)},
    'T:pencil': {name: 'Pencil grain', spacing: 24, scatter: 12, build: dots(14, 0.03, 0.06, 0.45)},
    'T:stipple': {name: 'Stipple', spacing: 40, scatter: 70, build: dots(4, 0.05, 0.12, 0.35)},
    'T:charcoal': {name: 'Charcoal', spacing: 22, scatter: 20, build: rand => [
        blobTip(rand, 8, 0.5, 0.35), blobTip(rand, 6, 0.28, 0.4).translate(new paper.Point(0.2, -0.14))]},
    'T:drybrush': {name: 'Dry brush', spacing: 55, scatter: 0, orient: true, build: rand => {
        const out = [];
        for (let i = 0; i < 9; i++) {
            const len = 0.75 + (rand() * 0.55);
            out.push(new paper.Path.Rectangle({point: [-0.5, -0.5 + (i * 0.115)], size: [len, 0.05 + (rand() * 0.04)],
                insert: false}));
        }
        return out;
    }},
    'T:leaf': {name: 'Leaves', spacing: 100, scatter: 8, orient: true, build: () => [
        new paper.Path.Ellipse({center: [0, 0], size: [0.9, 0.38], insert: false})]},
    'T:stars': {name: 'Stars', spacing: 120, scatter: 0, build: () => [
        new paper.Path.Star({center: [0, 0], points: 5, radius1: 0.5, radius2: 0.21, insert: false})]}
};
const textureTips = new Map();
const brushSource = ref => {
    if (typeof ref !== 'string') return null;
    const texture = LINE_TEXTURES[ref];
    if (texture) {
        let tip = textureTips.get(ref);
        if (!tip) {
            tip = new paper.CompoundPath({children: texture.build(mulberry(7)), insert: false});
            const bounds = tip.bounds;
            tip.translate(bounds.center.multiply(-1));
            tip.scale(1 / Math.max(bounds.width, bounds.height, 1e-6), new paper.Point(0, 0));
            textureTips.set(ref, tip);
        }
        return {tip, spacing: texture.spacing, scatter: texture.scatter, orient: Boolean(texture.orient)};
    }
    const custom = customBrushFor(ref);
    if (!custom) return null;
    const tip = getVectorTip(custom);
    return tip ? {tip, spacing: custom.spacing || 25, scatter: custom.scatter || 0, orient: false} : null;
};
const getLineTextures = () => Object.keys(LINE_TEXTURES).map(ref => ({ref, name: LINE_TEXTURES[ref].name}));
const tipIcon = ref => {
    const src = brushSource(ref);
    if (!src) return null;
    return `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.6 -0.6 1.2 1.2"><path fill="#575e75" ` +
        `d="${src.tip.getPathData(null, 3)}"/></svg>`)}`;
};
const pressureAt = (samples, t) => {
    if (!samples) return 1;
    const f = Math.max(0, Math.min(1, t)) * (samples.length - 1);
    const i = Math.min(samples.length - 2, Math.floor(f));
    return samples[i] + ((samples[i + 1] - samples[i]) * (f - i));
};
const MAX_STAMPS = 1500;
const brushOf = item => {
    const ls = item && item.data && item.data.dimodLine;
    return ls && ls.type === 'BRUSH' && ls.brush ? ls : null;
};
const brushStamps = (item, ls) => {
    const src = brushSource(ls.brush);
    if (!src || !isOutlined(item)) return null;
    const paths = item instanceof paper.CompoundPath ? item.children : [item];
    const width = item.strokeWidth;
    const profile = getLineProfile(item);
    const total = paths.reduce((sum, path) => sum + (path.length || 0), 0);
    if (!(total > 0)) return null;
    const step = Math.max(0.5, width * Math.max(1, ls.spacing) / 100, total / MAX_STAMPS);
    const rand = mulberry(ls.seed || 1);
    const stamps = [];
    paths.forEach(path => {
        const length = path.length;
        if (!(length > 0)) return;
        for (let at = 0; at <= length + 1e-6; at += step) {
            const along = Math.min(at, length);
            const s = width * (profile ? profileWidth(profile, along / length) : 1) *
                pressureAt(ls.pressure, along / length);
            if (s < 0.3) continue;
            const point = path.getPointAt(along);
            if (!point) continue;
            let x = point.x;
            let y = point.y;
            if (ls.scatter > 0) {
                const r = s * (ls.scatter / 100) * Math.sqrt(rand());
                const t = rand() * 2 * Math.PI;
                x += r * Math.cos(t);
                y += r * Math.sin(t);
            }
            const tangent = src.orient ? path.getTangentAt(along) : null;
            stamps.push({x, y, s, a: tangent ? tangent.angle : 0});
        }
    });
    return stamps.length ? {src, stamps, width} : null;
};
const stampPath2D = built => {
    const tip = new Path2D(built.src.tip.getPathData(null, 3));
    const all = new Path2D();
    for (const {x, y, s, a} of built.stamps) {
        const r = a * Math.PI / 180;
        all.addPath(tip, new DOMMatrix([s * Math.cos(r), s * Math.sin(r), -s * Math.sin(r), s * Math.cos(r), x, y]));
    }
    return all;
};
const num1 = v => String(Math.round(v * 10) / 10);
const brushSkinSvg = (doc, item, ls, built, color) => {
    const skin = doc.createElementNS(SVG_NS, 'g');
    const id = `dimod-tip-${ls.seed || 1}`;
    const defs = doc.createElementNS(SVG_NS, 'clipPath');
    const tip = built.src.tip.exportSVG({precision: 3});
    tip.setAttribute('id', id);
    tip.removeAttribute('fill');
    defs.appendChild(tip);
    skin.appendChild(defs);
    for (const {x, y, s, a} of built.stamps) {
        const r = a * Math.PI / 180;
        const use = doc.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', `#${id}`);
        use.setAttribute('transform', `matrix(${[s * Math.cos(r), s * Math.sin(r), -s * Math.sin(r), s * Math.cos(r), x, y]
            .map(v => Math.round(v * 100) / 100).join(' ')})`);
        skin.appendChild(use);
    }
    return skin;
};
const bakeBrush = item => {
    const ls = brushOf(item);
    const built = ls ? brushStamps(item, ls) : null;
    if (!built) return null;
    const kids = built.src.tip.children || [built.src.tip];
    const out = [];
    for (const {x, y, s, a} of built.stamps) {
        const m = new paper.Matrix().translate(x, y).rotate(a, 0, 0).scale(s, s);
        for (const kid of kids) {
            if (!kid.segments || !kid.segments.length) continue;
            const clone = new paper.Path({segments: kid.segments.map(seg => seg.clone()), closed: true, insert: false});
            clone.transform(m);
            out.push(clone);
        }
    }
    const parent = out.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const boxes = out.map(path => path.bounds);
    const cell = Math.max(1, built.width);
    const grid = new Map();
    boxes.forEach((box, i) => {
        for (let gx = Math.floor(box.left / cell); gx <= Math.floor(box.right / cell); gx++) {
            for (let gy = Math.floor(box.top / cell); gy <= Math.floor(box.bottom / cell); gy++) {
                const key = `${gx},${gy}`;
                const list = grid.get(key) || [];
                list.forEach(j => {
                    if (boxes[i].intersects(boxes[j]) && find(i) !== find(j)) parent[find(i)] = find(j);
                });
                list.push(i);
                grid.set(key, list);
            }
        }
    });
    const groups = new Map();
    out.forEach((path, i) => { const root = find(i); groups.set(root, (groups.get(root) || []).concat(path)); });
    const merged = [];
    groups.forEach(list => {
        const fold = (from, to) => {
            if (to - from === 1) return list[from];
            const mid = (from + to) >> 1;
            return fold(from, mid).unite(fold(mid, to), {insert: false});
        };
        merged.push(fold(0, list.length));
    });
    const compound = new paper.CompoundPath({children: merged.reduce((all, shape) =>
        all.concat(shape instanceof paper.CompoundPath ? shape.children.slice() : [shape]), []), insert: false});
    compound.fillRule = 'nonzero';
    compound.fillColor = item.strokeColor ? item.strokeColor.clone() : new paper.Color(0, 0, 0);
    compound.strokeColor = null;
    return compound;
};
const padBrushBounds = Klass => {
    const original = Klass.prototype._getBounds;
    Klass.prototype._getBounds = function (matrix, options) {
        const result = original.call(this, matrix, options);
        const ls = options && options.stroke ? brushOf(this) : null;
        if (!ls || !(this.strokeWidth > 0)) return result;
        const grow = rect => rect.expand(2 * this.strokeWidth * (0.35 + (ls.scatter / 100)) *
            (matrix ? Math.sqrt(Math.abs((matrix.a * matrix.d) - (matrix.b * matrix.c))) : 1));
        return result.rect ? Object.assign({}, result, {rect: grow(result.rect)}) : grow(result);
    };
};
padBrushBounds(paper.Path);
padBrushBounds(paper.CompoundPath);
const hasLineSkin = item => Boolean(getLineProfile(item) || brushOf(item));
const skinFor = item => {
    const profile = getLineProfile(item);
    const brush = brushOf(item);
    const key = [profile, JSON.stringify(brush), item.strokeWidth, solidCss(item.strokeColor),
        item.fillColor ? solidCss(item.fillColor) : '', item.getPathData()].join('|');
    const cached = item.__dimodSkin;
    if (cached && cached.key === key) return cached;
    let outline = null;
    let path2d = null;
    if (brush) {
        const built = brushStamps(item, brush);
        if (!built) return null;
        path2d = stampPath2D(built);
    } else {
        outline = profileShape(item, profile);
        if (!outline) return null;
        outline.fillColor = item.strokeColor.clone();
    }
    let fill = null;
    if (item.fillColor) { fill = item.clone({insert: false, deep: true}); fill.strokeColor = null; }
    const skin = {key, outline, path2d, color: solidCss(item.strokeColor), fill};
    Object.defineProperty(item, '__dimodSkin', {value: skin, writable: true, configurable: true});
    return skin;
};
const drawProfiled = Klass => {
    const original = Klass.prototype._draw;
    Klass.prototype._draw = function (ctx, param, viewMatrix, strokeMatrix) {
        if (param.clip || param.dontFinish || !hasLineSkin(this) || !isOutlined(this)) {
            return original.call(this, ctx, param, viewMatrix, strokeMatrix);
        }
        const skin = skinFor(this);
        if (!skin) return original.call(this, ctx, param, viewMatrix, strokeMatrix);
        if (skin.fill) skin.fill._draw(ctx, param, viewMatrix, strokeMatrix);
        if (skin.path2d) {
            if (strokeMatrix) { ctx.save(); strokeMatrix.applyToContext(ctx); }
            ctx.fillStyle = skin.color;
            ctx.fill(skin.path2d);
            if (strokeMatrix) ctx.restore();
        } else { skin.outline._draw(ctx, param, viewMatrix, strokeMatrix); }
    };
};
drawProfiled(paper.Path);
drawProfiled(paper.CompoundPath);
const SVG_NS = 'http://www.w3.org/2000/svg';
const profileOnExport = (item, node) => {
    if (node.setAttribute && item.blendMode && item.blendMode !== 'normal') {
        node.setAttribute('data-dimod-blend', item.blendMode);
        node.setAttribute('style', `${node.getAttribute('style') || ''};mix-blend-mode:${item.blendMode}`.replace(/^;/, ''));
    }
    if (item.data && item.data.dimodSymbol && node.setAttribute) node.setAttribute('data-dimod-symbol', JSON.stringify(item.data.dimodSymbol));
    const profile = getLineProfile(item);
    const brush = brushOf(item);
    if ((!profile && !brush) || !node.ownerDocument) return node;
    const built = brush ? brushStamps(item, brush) : null;
    const shape = brush ? null : profileShape(item, profile);
    if (!built && !shape) return node;
    const doc = node.ownerDocument;
    const group = doc.createElementNS(SVG_NS, 'g');
    if (profile) group.setAttribute('data-dimod-profile', profile);
    if (brush) group.setAttribute('data-dimod-brush', JSON.stringify(brush));
    node.setAttribute('stroke', 'none');
    const skin = built ? brushSkinSvg(doc, item, brush, built, solidCss(item.strokeColor)) :
        doc.createElementNS(SVG_NS, 'path');
    if (shape) skin.setAttribute('d', shape.getPathData(null, 3));
    if (node.getAttribute('transform')) skin.setAttribute('transform', node.getAttribute('transform'));
    skin.setAttribute('fill', solidCss(item.strokeColor));
    if (item.strokeColor.alpha < 1) {
        skin.setAttribute('fill-opacity', String(item.strokeColor.alpha));
        skin.setAttribute('stroke-opacity', String(item.strokeColor.alpha));
    }
    skin.setAttribute('stroke', 'none');
    skin.setAttribute('data-dimod-profile-skin', '1');
    group.appendChild(node);
    group.appendChild(skin);
    return group;
};
const profileOnImport = (node, item) => {
    if (!node.getAttribute || !item) return item;
    const blend = node.getAttribute('data-dimod-blend');
    if (blend) item.blendMode = blend;
    const symbol = node.getAttribute('data-dimod-symbol');
    if (symbol) {
        try { item.data = Object.assign({}, item.data, {dimodSymbol: JSON.parse(symbol)}); } catch (e) {
        }
        return item;
    }
    if (node.getAttribute('data-dimod-profile-skin')) {
        if (!item.data) item.data = {};
        item.data.dimodSkin = true;
        return item;
    }
    const profile = node.getAttribute('data-dimod-profile');
    const brushAttr = node.getAttribute('data-dimod-brush');
    if ((!profile && !brushAttr) || !(item instanceof paper.Group)) return item;
    item.children.filter(child => child.data && child.data.dimodSkin).forEach(child => child.remove());
    const spine = item.children.find(child => child instanceof paper.Path || child instanceof paper.CompoundPath);
    if (!spine) return item;
    const stroke = node.getAttribute('stroke');
    if (stroke && stroke !== 'none') {
        const color = new paper.Color(stroke);
        const alpha = parseFloat(node.getAttribute('stroke-opacity'));
        if (alpha >= 0 && alpha < 1) color.alpha = alpha;
        spine.strokeColor = color;
    }
    const width = parseFloat(node.getAttribute('stroke-width'));
    if (width > 0) spine.strokeWidth = width;
    const cap = node.getAttribute('stroke-linecap');
    if (cap) spine.strokeCap = cap;
    const join = node.getAttribute('stroke-linejoin');
    if (join) spine.strokeJoin = join;
    const opacity = parseFloat(node.getAttribute('opacity'));
    if (opacity >= 0 && opacity < 1) spine.opacity = opacity;
    spine.remove();
    if (!spine.data) spine.data = {};
    if (profile) spine.data.dimodProfile = profile;
    if (brushAttr) {
        try { spine.data.dimodLine = lineStyleOf(JSON.parse(brushAttr)); } catch (e) {
        }
    }
    return spine;
};
const MAX_IMAGES = 48;
let lines = [];
let enabled = true;
let radial = {n: 1, x: 0, y: 0};
let cache = null;
const setCurrentMirrorRadial = function (next) {
    radial = {
        n: Math.max(1, Math.min(36, Math.round(Number(next && next.n) || 1))),
        x: Number(next && next.x) || 0,
        y: Number(next && next.y) || 0
    };
    cache = null;
};
const getMirrorRadial = () => radial;
const setCurrentMirrorLines = function (next) {
    lines = Array.isArray(next) ? next.filter(line => line &&
        isFinite(line.x) && isFinite(line.y) && isFinite(line.angle)) : [];
    cache = null;
};
const setCurrentMirrorEnabled = function (value) { enabled = Boolean(value); cache = null; };
const getMirrorLines = () => lines;
const isMirrorActive = () => enabled && (lines.length > 0 || radial.n > 1);
const reflection = function (line) {
    const p = new paper.Point(line.x, line.y);
    return new paper.Matrix()
        .translate(p)
        .rotate(line.angle)
        .scale(1, -1)
        .rotate(-line.angle)
        .translate(p.negate());
};
const keyOf = m => `${[m.a, m.b, m.c, m.d].map(v => Math.round(v * 1000)).join(',')
}|${Math.round(m.tx * 10)},${Math.round(m.ty * 10)}`;
const getMirrorMatrices = function () {
    if (!isMirrorActive()) return [];
    if (cache) return cache;
    const generators = lines.map(reflection);
    if (radial.n > 1) generators.push(new paper.Matrix().rotate(360 / radial.n, new paper.Point(radial.x, radial.y)));
    const identity = new paper.Matrix();
    const seen = new Set([keyOf(identity)]);
    const found = [];
    const queue = [identity];
    while (queue.length && found.length < MAX_IMAGES - 1) {
        const current = queue.shift();
        for (const generator of generators) {
            const next = generator.clone().append(current);
            const key = keyOf(next);
            if (seen.has(key)) continue;
            seen.add(key);
            found.push(next);
            queue.push(next);
            if (found.length >= MAX_IMAGES - 1) break;
        }
    }
    cache = found;
    return found;
};
const mirrorItem = function (item) {
    return getMirrorMatrices().map(matrix => {
        const copy = item.clone({insert: false});
        copy.transform(matrix);
        copy.insertAbove(item);
        return copy;
    });
};
const mirrorPoint = function (x, y) {
    return getMirrorMatrices().map(m => ({x: (m.a * x) + (m.c * y) + m.tx, y: (m.b * x) + (m.d * y) + m.ty}));
};
const kaleidoscope = function (n, center) {
    const result = [];
    for (let i = 0; i < n; i++) { result.push({x: center.x, y: center.y, angle: 90 + (180 * i / n)}); }
    return result;
};
const getPressure = function (event) {
    if (!event || typeof event.pressure !== 'number') return null;
    if (event.pointerType !== 'pen' && event.pointerType !== 'touch') return null;
    if (event.pressure === 0 && event.buttons === 0) return null;
    return event.pressure;
};
const KEY = 'dimod.paint.settings.v1';
const loadSettings = function () {
    try {
        const raw = window.localStorage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) { return {}; }
};
let pending = null;
let timer = null;
const saveSettings = function (partial) {
    pending = {...(pending || loadSettings()), ...partial};
    if (timer) return;
    timer = setTimeout(() => {
        timer = null;
        const toWrite = pending;
        pending = null;
        try { window.localStorage.setItem(KEY, JSON.stringify(toWrite)); } catch (e) {
        }
    }, 300);
};
const hasFlag = function (flag) { const flags = loadSettings().flags; return Boolean(flags && flags[flag]); };
const setFlag = function (flag) {
    const flags = {...(loadSettings().flags || {}), ...(pending && pending.flags), [flag]: true};
    saveSettings({flags});
};
const OPTION_DEFAULTS = {mergeNodeCursor: true, twoColumns: false, hoverFlyouts: true, foldTools: true, rotFollow: true, rotReach: 30, rotStart: 5, localGizmo: false};
const _optionListeners = new Set();
let _options = null;
const getPaintOptions = function () {
    if (!_options) _options = {...OPTION_DEFAULTS, ...(loadSettings().options || {})};
    return _options;
};
const setPaintOption = function (key, value) {
    _options = {...getPaintOptions(), [key]: value};
    saveSettings({options: _options});
    _optionListeners.forEach(listener => listener());
};
const subscribePaintOptions = function (listener) {
    _optionListeners.add(listener);
    return () => _optionListeners.delete(listener);
};
const handlers = new Map();
const registerCommands = function (table) {
    Object.keys(table).forEach(name => handlers.set(name, table[name]));
    return () => {
        Object.keys(table).forEach(name => {
            if (handlers.get(name) === table[name]) handlers.delete(name);
        });
    };
};
const runCommand = function (name, ...args) {
    const handler = handlers.get(name);
    if (!handler) return null;
    return labelled(name, handler)(...args);
};
const hasCommand = name => handlers.has(name);
const MARKER = 'dimod-paint/1';
const VERSION = 1;
const createDoc = function () { return {v: VERSION, axes: [], links: [], swatches: {}, symbols: {}}; };
const _isEmptyObject = function (object) {
    for (const key in object) {
        if (Object.prototype.hasOwnProperty.call(object, key)) return false;
    }
    return true;
};
const isEmptyDoc = function (doc) {
    return !doc ||
        (_isEmptyObject(doc.swatches) &&
        _isEmptyObject(doc.symbols) &&
        doc.axes.length === 0 &&
        doc.links.length === 0);
};
const _normalizeDoc = function (raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.v > VERSION) { log.warn(`dimod: metadata version ${raw.v} is newer than ${VERSION}; ignoring it.`); return null; }
    const doc = createDoc();
    const objectKeys = ['swatches', 'symbols'];
    for (const key of objectKeys) {
        if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) { doc[key] = raw[key]; }
    }
    for (const key of ['axes', 'links']) {
        if (Array.isArray(raw[key])) doc[key] = raw[key];
    }
    return doc;
};
const serializeDoc = function (doc) { return `${MARKER} ${JSON.stringify(doc)}`; };
const deserializeDoc = function (text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (trimmed.indexOf(MARKER) !== 0) return null;
    try { return _normalizeDoc(JSON.parse(trimmed.substring(MARKER.length))); } catch (error) { log.warn('dimod: could not parse metadata blob; ignoring it.', error); return null; }
};
const readDoc = function (svgDom) {
    if (!svgDom || !svgDom.getElementsByTagName) return null;
    const candidates = svgDom.getElementsByTagName('metadata');
    for (let i = 0; i < candidates.length; i++) {
        const doc = deserializeDoc(candidates[i].textContent);
        if (doc) return doc;
    }
    return null;
};
const writeDoc = function (svgRoot, doc) {
    const existing = svgRoot.getElementsByTagName('metadata');
    for (let i = existing.length - 1; i >= 0; i--) {
        if (deserializeDoc(existing[i].textContent)) existing[i].parentNode.removeChild(existing[i]);
    }
    if (isEmptyDoc(doc)) return;
    const element = svgRoot.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'metadata');
    element.textContent = serializeDoc(doc);
    svgRoot.appendChild(element);
};
const pruneDoc = function (doc, presentDids) {
    doc.links = doc.links.filter(link =>
        Array.isArray(link.members) &&
        link.members.length > 0 &&
        link.members.every(member => presentDids.has(member.did)));
    return doc;
};
export {bakeBrush, getTextureBrushes, getLineTextures, tipIcon, brushSource, ID_LENGTH, ID_PREFIX, LINE_STYLES, LineProfiles, applyLineStyle, lineDash, lineStyleOf, readLineStyle, setLineStyle, MARKER, MAX_IMAGES, VERSION, addCustomBrushFromFile, applyLineProfile, attributeToDid, createDoc, customBrushFor, deserializeDoc, didToAttribute, generateDid, getBrushOptions, getCustomBrushes, getDid, getLineProfile, getMirrorLines, getMirrorMatrices, getMirrorRadial, getPaintOptions, getPressure, getVectorTip, hasCommand, hasFlag, isCustomPreset, isEmptyDoc, isMirrorActive, kaleidoscope, labelled, loadSettings, makeCustomMark, mirrorItem, mirrorPoint, preloadCustomBrushes, presetFor, profileOnExport, profileOnImport, profileWidth, pruneDoc, readDoc, reflection, registerCommands, removeCustomBrush, runCommand, saveSettings, serializeDoc, setCurrentBrushOption, setCurrentMirrorEnabled, setCurrentMirrorLines, setCurrentMirrorRadial, setDid, setFlag, setHistoryLabel, setHistoryMode, setLineProfile, setPaintOption, subscribeCustomBrushes, subscribePaintOptions, takeHistoryLabel, updateCustomBrush, writeDoc};
