import { askPrompt, askConfirm, askAlert } from '../dimod-ui';
import {
    newGroup,
    THIS_SPRITE,
    renameGroupRefs,
    normalizeAnim,
    serializeAnim,
    DOC_VERSION,
    normalizeGroup,
    newAnim,
    allKeyframeTimes,
    defaultEaseFor,
    TD,
    SLOT,
    NUM_SLOTS,
    ALL_TRACKS,
    isDiscrete,
    sameSec,
    makeKFID,
    uniqueName,
    deepClone,
    clamp,
    intToRGB,
    bytesToBase64,
    downloadBlob,
    base64ToBytes,
    dataURLToBytes,
    pickFiles,
    bindingForSprite,
    bindingsFor,
    bumpBindingEpoch,
    findGroupSprite,
    PoseSet,
    CompiledAnim,
    setOverridesEnabled,
    Sampler,
    easeFnFor,
    applyEase,
    EASE_FAMS,
    vectorBounds
} from './core.js';
export {isDiscrete} from './core.js';
import { apply, getAnimationCollab } from './index.js';
import { GpuPipeline, newDrawCmd, buildDrawCmd, Surface, renderPose, FULL_VS, UNPREMULT_FS } from './render.js';
import { poseBounds } from './runtime.js';
export {applyEase, cubicBezier, easeFnFor, splitEase} from './core.js';
import {PRESETS, emitterFrom, particleEventText, ParticleSystem, parseParticleEvent, EXTENSION_ID} from '../dimod-particles.js';
class AudioTrack {
  static async fromAsset(asset) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ctx.decodeAudioData(asset.data.buffer.slice(asset.data.byteOffset, asset.data.byteOffset + asset.data.byteLength));
    return new AudioTrack(ctx, buf);
  }
  constructor(ctx, buffer) {
    this.ctx = ctx;
    this.buffer = buffer;
    this.src = null;
    this.playing = false;
    this.rate = 1;
    this._peaks = null;
  }
  play(t, rate = 1) {
    this.stop();
    if (this.ctx.state === "suspended") this.ctx.resume();
    if (t >= this.buffer.duration) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = rate;
    src.connect(this.ctx.destination);
    src.start(0, Math.max(0, t));
    this.src = src;
    this.rate = rate;
    this.startCtx = this.ctx.currentTime;
    this.startT = t;
    this.playing = true;
    src.onended = () => {
      if (this.src === src) this.playing = false;
    };
  }
  time() { return this.startT + (this.ctx.currentTime - this.startCtx) * this.rate; }
  setRate(r) {
    if (this.playing) this.play(this.time(), r);
    this.rate = r;
  }
  stop() {
    if (this.src) {
      try { this.src.stop(); } catch {}
      this.src = null;
    }
    this.playing = false;
  }
  peaks(tl, w) {
    const key = `${w}|${tl.st.view.tlZoom}|${tl.st.view.tlPan}`;
    if (this._peaks && this._peaks.key === key) return this._peaks.data;
    const ch = this.buffer.getChannelData(0);
    const sr = this.buffer.sampleRate;
    const out = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const a = Math.floor(tl.x2t(x) * sr), b = Math.floor(tl.x2t(x + 1) * sr);
      if (b < 0 || a >= ch.length) continue;
      let m = 0;
      const step = Math.max(1, Math.floor((b - a) / 64));
      for (let i = Math.max(0, a); i < Math.min(ch.length, b); i += step) {
        const v = Math.abs(ch[i]);
        if (v > m) m = v;
      }
      out[x] = m;
    }
    this._peaks = { key, data: out };
    return out;
  }
  dispose() {
    this.stop();
    try { this.ctx.close(); } catch {}
  }
}
let host = null;
const setAnimationDialogHost = fn => {
    host = fn;
    return () => {
        if (host === fn) host = null;
    };
};
const openAnimationDialog = (kind, props = {}) => new Promise(resolve => {
    if (host) host(kind, props, resolve);
    else resolve(null);
});
const openProgressDialog = title => {
    const handle = {
        fraction: 0,
        text: 'Rendering…',
        cancelled: false,
        listeners: new Set(),
        set (fraction, text) {
            handle.fraction = fraction;
            if (text) handle.text = text;
            handle.listeners.forEach(fn => fn());
        },
        close () {
            if (handle.resolve) handle.resolve(null);
        }
    };
    openAnimationDialog('progress', {title, handle});
    return handle;
};
const P = {
  play: '<path d="M6 4.5v11l9-5.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="5" y="4.5" width="3.5" height="11" rx="1" fill="currentColor" stroke="none"/><rect x="11.5" y="4.5" width="3.5" height="11" rx="1" fill="currentColor" stroke="none"/>',
  stop: '<rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
  first: '<path d="M5 4.5v11"/><path d="M15 4.5v11l-8-5.5z" fill="currentColor"/>',
  last: '<path d="M15 4.5v11"/><path d="M5 4.5v11l8-5.5z" fill="currentColor"/>',
  prev: '<path d="M12.5 5l-5 5 5 5"/>',
  next: '<path d="M7.5 5l5 5-5 5"/>',
  prevKey: '<path d="M11 5l-5 5 5 5"/><path d="M15.5 10l-2 -2-2 2 2 2z" fill="currentColor"/>',
  nextKey: '<path d="M9 5l5 5-5 5"/><path d="M4.5 10l2-2 2 2-2 2z" fill="currentColor"/>',
  record: '<circle cx="10" cy="10" r="5" fill="currentColor" stroke="none"/>',
  loop: '<path d="M4 9a5 5 0 0 1 8.6-3.5L15 8"/><path d="M15 4v4h-4"/><path d="M16 11a5 5 0 0 1-8.6 3.5L5 12"/><path d="M5 16v-4h4"/>',
  magnet: '<path d="M5 3.5v6a5 5 0 0 0 10 0v-6"/><path d="M5 7h3M12 7h3"/><path d="M8 3.5v6a2 2 0 0 0 4 0v-6"/>',
  undo: '<path d="M7.5 5L3.5 9l4 4"/><path d="M4 9h7.5a4.5 4.5 0 0 1 0 9H9"/>',
  redo: '<path d="M12.5 5l4 4-4 4"/><path d="M16 9H8.5a4.5 4.5 0 0 0 0 9H11"/>',
  copy: '<rect x="7" y="7" width="9" height="9" rx="2"/><path d="M4 13V5.5A1.5 1.5 0 0 1 5.5 4H13"/>',
  paste: '<rect x="4.5" y="4" width="11" height="13" rx="2"/><path d="M7.5 4V3h5v1"/><path d="M7.5 9h5M7.5 12h3"/>',
  trash: '<path d="M4 6h12"/><path d="M8 6V4h4v2"/><path d="M5.5 6l.8 10a1.5 1.5 0 0 0 1.5 1.4h4.4a1.5 1.5 0 0 0 1.5-1.4l.8-10"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  minus: '<path d="M4 10h12"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
  check: '<path d="M4.5 10.5l3.5 3.5 7.5-8"/>',
  eye: '<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.5"/>',
  eyeOff: '<path d="M3 3l14 14"/><path d="M7.5 5.2A7.8 7.8 0 0 1 10 4.5c5 0 8 5.5 8 5.5a14 14 0 0 1-2.4 3M12.5 14.9A7.6 7.6 0 0 1 10 15.5c-5 0-8-5.5-8-5.5a14 14 0 0 1 2.6-3.2"/>',
  lock: '<rect x="5" y="9" width="10" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
  save: '<path d="M4 4.5A.5.5 0 0 1 4.5 4H13l3 3v8.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5z"/><path d="M7 4v4h5V4"/><rect x="6.5" y="11" width="7" height="5"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h4l2 2h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  import: '<path d="M10 3v10"/><path d="M6 9l4 4 4-4"/><path d="M4 14v2h12v-2"/>',
  export: '<path d="M10 13V3"/><path d="M6 7l4-4 4 4"/><path d="M4 14v2h12v-2"/>',
  image: '<rect x="3" y="4" width="14" height="12" rx="2"/><circle cx="7.5" cy="8.5" r="1.5"/><path d="M3.5 14.5l4-4 3 3 2-2 4 4"/>',
  film: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M6 4v12M14 4v12M3 8h3M3 12h3M14 8h3M14 12h3"/>',
  grid: '<rect x="3.5" y="3.5" width="5" height="5" rx="1"/><rect x="11.5" y="3.5" width="5" height="5" rx="1"/><rect x="3.5" y="11.5" width="5" height="5" rx="1"/><rect x="11.5" y="11.5" width="5" height="5" rx="1"/>',
  bake: '<rect x="3.5" y="5.5" width="9" height="11" rx="1.5"/><path d="M7 3.5h8.5a1 1 0 0 1 1 1V14"/><path d="M6 13l2-3 2 2 1-1.5"/>',
  gear: '<circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  sprite: '<circle cx="10" cy="7" r="3"/><path d="M4.5 17c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5"/>',
  layers: '<path d="M10 3l7 4-7 4-7-4z"/><path d="M3 11l7 4 7-4"/>',
  onion: '<circle cx="7.5" cy="10" r="4.5" opacity=".45"/><circle cx="12.5" cy="10" r="4.5"/>',
  path: '<circle cx="4.5" cy="15" r="1.5" fill="currentColor"/><circle cx="15.5" cy="5" r="1.5" fill="currentColor"/><path d="M5.5 14C8 13 7 8 10 7.5S13 7 14.5 6" stroke-dasharray="2 2"/>',
  zoomIn: '<circle cx="8.5" cy="8.5" r="5"/><path d="M12.2 12.2L16.5 16.5M6.5 8.5h4M8.5 6.5v4"/>',
  zoomOut: '<circle cx="8.5" cy="8.5" r="5"/><path d="M12.2 12.2L16.5 16.5M6.5 8.5h4"/>',
  fit: '<path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4"/>',
  target: '<circle cx="10" cy="10" r="6"/><path d="M10 2v4M10 14v4M2 10h4M14 10h4"/>',
  cursor: '<path d="M5 3.5l10 6-4.5 1.2L8.5 15z" fill="currentColor"/>',
  addKey: '<path d="M8.5 5l3.5 3.5-3.5 3.5L5 8.5z" fill="currentColor"/><path d="M14 11v6M11 14h6"/>',
  marquee: '<rect x="3.5" y="3.5" width="13" height="13" rx="1.5" stroke-dasharray="2.5 2.5"/>',
  key: '<path d="M10 3.5l6.5 6.5-6.5 6.5L3.5 10z" fill="currentColor" stroke="none"/>',
  keyOutline: '<path d="M10 3.5l6.5 6.5-6.5 6.5L3.5 10z"/>',
  dice: '<rect x="4" y="4" width="12" height="12" rx="2.5"/><circle cx="7.5" cy="7.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="12.5" r="1.1" fill="currentColor" stroke="none"/>',
  expr: '<path d="M8 4.5c-2 0-2 1.5-2 3v5c0 1.5 0 3-2 3M3.5 9.5h4"/><path d="M11 7l5 6M16 7l-5 6"/>',
  wand: '<path d="M4 16l8.5-8.5"/><path d="M13 3v2M16.5 6.5h-2M15.5 3.5l-1.3 1.3M11 5.5l2 2"/>',
  link: '<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.8.8"/><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.8-.8"/>',
  unlink: '<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2"/><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2"/><path d="M3 3l14 14"/>',
  graph: '<path d="M3 16.5h14M3.5 3v13.5"/><path d="M4 14c3 0 3.5-9 7-9s3 4 5.5 4"/>',
  dope: '<path d="M3 6h14M3 10h14M3 14h14" opacity=".35"/><path d="M6 6l1.2-1.2L8.4 6 7.2 7.2zM12 10l1.2-1.2 1.2 1.2-1.2 1.2zM9 14l1.2-1.2 1.2 1.2-1.2 1.2z" fill="currentColor"/>',
  music: '<path d="M8 15V5l8-1.5v10"/><circle cx="6" cy="15" r="2" fill="currentColor"/><circle cx="14" cy="13.5" r="2" fill="currentColor"/>',
  infinity: '<path d="M10 10c-1.5-2-3-3-4.5-3a3 3 0 0 0 0 6c1.5 0 3-1 4.5-3s3-3 4.5-3a3 3 0 0 1 0 6c-1.5 0-3-1-4.5-3z"/>',
  bolt: '<path d="M11 2.5L4.5 11H10l-1 6.5 6.5-8.5H10z" fill="currentColor" stroke-width="1.2"/>',
  star: '<path d="M10 3l2.1 4.3 4.7.7-3.4 3.3.8 4.7L10 13.8 5.8 16l.8-4.7L3.2 8l4.7-.7z"/>',
  data: '<ellipse cx="10" cy="5.5" rx="6" ry="2.5"/><path d="M4 5.5v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5"/>',
  flag: '<path d="M5 17V3.5M5 4h9l-2 3 2 3H5"/>',
  mute: '<path d="M4 8h3l4-3.5v11L7 12H4z"/><path d="M14 8l4 4M18 8l-4 4"/>',
  sound: '<path d="M4 8h3l4-3.5v11L7 12H4z"/><path d="M14 7.5a3.5 3.5 0 0 1 0 5M15.5 5a6.5 6.5 0 0 1 0 10"/>',
  chevronDown: '<path d="M5 7.5l5 5 5-5"/>',
  chevronRight: '<path d="M7.5 5l5 5-5 5"/>',
  dots: '<circle cx="5" cy="10" r="1.3" fill="currentColor"/><circle cx="10" cy="10" r="1.3" fill="currentColor"/><circle cx="15" cy="10" r="1.3" fill="currentColor"/>',
  pivot: '<circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v4M10 13.5v4M2.5 10h4M13.5 10h4"/>',
  rotate: '<path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9"/><path d="M15 3v3.5h-3.5"/>',
  scale: '<rect x="3.5" y="9.5" width="7" height="7" rx="1"/><path d="M9 3.5h7.5V11M16.5 3.5L10.5 9.5"/>',
  skew: '<path d="M6.5 4.5h10l-3 11h-10z"/>',
  move: '<path d="M10 2.5v15M2.5 10h15"/><path d="M7.5 5L10 2.5 12.5 5M7.5 15l2.5 2.5 2.5-2.5M5 7.5L2.5 10 5 12.5M15 7.5l2.5 2.5-2.5 2.5"/>',
  mirror: '<path d="M10 3v14" stroke-dasharray="2 2"/><path d="M7.5 5.5L3.5 14h4zM12.5 5.5l4 8.5h-4z"/>',
  mirrorV: '<g transform="rotate(90 10 10)"><path d="M10 3v14" stroke-dasharray="2 2"/><path d="M7.5 5.5L3.5 14h4zM12.5 5.5l4 8.5h-4z"/></g>',
  reverse: '<path d="M4 7h11l-3-3M16 13H5l3 3"/>',
  sparkle: '<path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z"/>',
  search: '<circle cx="8.5" cy="8.5" r="5"/><path d="M12.2 12.2L16.5 16.5"/>',
  help: '<circle cx="10" cy="10" r="7.5"/><path d="M8 8a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.3v.4"/><circle cx="10" cy="14" r=".8" fill="currentColor"/>',
  checker: '<rect x="3.5" y="3.5" width="13" height="13" rx="1.5"/><path d="M3.5 10h13M10 3.5v13"/><path d="M3.5 3.5h6.5v6.5H3.5zM10 10h6.5v6.5H10z" fill="currentColor" opacity=".35" stroke="none"/>',
  sun: '<circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  moon: '<g transform="scale(0.8333)"><path fill="currentColor" stroke="none" d="M9 2c-1.05 0-2.05.16-3 .46 4.06 1.27 7 5.06 7 9.54 0 4.48-2.94 8.27-7 9.54.95.3 1.95.46 3 .46 5.52 0 10-4.48 10-10S14.52 2 9 2z"/></g>',
  ks5: '<path d="M3 13c2-5 4.5-7.5 7-7.5S15 8 17 13"/><path d="M6 6L4.5 3.5M14 6l1.5-2.5"/><path d="M10 11.5l1.8 1.8-1.8 1.8-1.8-1.8z" fill="currentColor"/><circle cx="3" cy="13" r="1.4" fill="currentColor"/><circle cx="17" cy="13" r="1.4" fill="currentColor"/>',
};
const NORM = {"play":[1.182,9.8,10],"pause":[1.182,10,10],"stop":[1.25,10,10],"first":[1.25,10,10],"last":[1.25,10,10],"prev":[1.25,10,10],"next":[1.25,10,10],"prevKey":[1.25,10.75,10],"nextKey":[1.25,9.25,10],"record":[1.25,10,10],"loop":[1.192,10,10],"magnet":[1.25,10,9],"undo":[1.1,9.75,11.5],"redo":[1.1,10.25,11.5],"copy":[1.192,10,10],"paste":[1.021,10,10],"trash":[1.067,10,10.7],"plus":[1.192,10,10],"minus":[1.192,10,10],"close":[1.25,10,10],"check":[1.25,10,10],"eye":[0.894,10,10],"eyeOff":[0.894,10,10],"lock":[1.059,10,10.25],"save":[1.192,10,10],"folder":[1.021,10,10.5],"import":[1.1,10,9.5],"export":[1.1,10,9.5],"image":[1.021,10,10],"film":[1.021,10,10],"grid":[1.1,10,10],"bake":[1.1,10,10],"gear":[0.953,10,10],"sprite":[1.1,10,10.5],"layers":[1.021,10,9],"onion":[1.021,10,10],"path":[1.021,10,10],"zoomIn":[1.1,10,10],"zoomOut":[1.1,10,10],"fit":[1.192,10,10],"target":[0.894,10,10],"cursor":[1.13,10,9.25],"addKey":[1.083,11,11],"marquee":[1.1,10,10],"key":[1,10,10],"keyOutline":[1.1,10,10],"dice":[1.192,10,10],"expr":[1.144,9.75,10],"wand":[1.1,10.25,9.5],"link":[1.212,10,10],"unlink":[1.021,10,10],"graph":[1.021,10,9.75],"dope":[1.021,10,10],"music":[1.059,10,10.25],"infinity":[0.953,10,10],"bolt":[0.867,10,10],"star":[1.051,10,9.5],"data":[1.021,10,10],"flag":[1.059,9.5,10.25],"mute":[1.021,11,10],"sound":[1.036,10.9,10],"chevronDown":[1.25,10,10],"chevronRight":[1.25,10,10],"dots":[1.032,10,10],"pivot":[0.953,10,10],"rotate":[1.144,10,9.25],"scale":[1.1,10,10],"skew":[1.1,10,10],"move":[0.953,10,10],"mirror":[1.021,10,10],"mirrorV":[1.021,10,10],"reverse":[1.192,10,10],"sparkle":[1.083,10,9],"search":[1.1,10,10],"help":[0.953,10,10],"checker":[1.1,10,10],"sun":[0.953,10,10],"moon":[0.85,10.4,10],"ks5":[0.851,10,9.3]};
function icon(name, cls = "") {
  const body = P[name] || P.dots;
  const n = NORM[name];
  const inner = !n || (n[0] === 1 && n[1] === 10 && n[2] === 10) ? body
    : `<g transform="translate(10 10) scale(${n[0]}) translate(${-n[1]} ${-n[2]})" stroke-width="${+(1.7 / n[0]).toFixed(3)}">${body}</g>`;
  return `<svg class="${cls}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
function iconEl(name, cls = "") {
  const t = document.createElement("template");
  t.innerHTML = icon(name, cls);
  return t.content.firstChild;
}
const ICON_NAMES = Object.keys(P);
const CSS = `
.ks5 {
  --k-accent: var(--dimod-motion-primary, hsla(247, 74%, 63%, 1));
  --k-accent-2: var(--dimod-motion-tertiary, hsla(247, 61%, 56%, 1));
  --k-on-accent: var(--dimod-on-accent, #fff);
  --k-accent-t: var(--dimod-motion-transparent, hsla(247, 74%, 63%, 0.35));
  --k-accent-lt: var(--dimod-motion-light-transparent, hsla(247, 61%, 56%, 0.15));
  --k-accent-10: var(--dimod-accent-10, hsla(247, 74%, 63%, 0.1));
  --k-accent-20: var(--dimod-accent-20, hsla(247, 74%, 63%, 0.2));
  /* dimod: the accent as text, darkened (or, dark theme, lightened) until it reads: css/colors.css */
  --k-accent-text: oklch(from var(--k-accent) min(l, 0.5) c h);
  --k-bar: var(--k-accent);
  --k-bg: var(--ui-primary, hsla(247, 100%, 95%, 1));
  --k-panel: #fff;
  --k-panel-2: var(--ui-secondary, hsla(247, 75%, 95%, 1));
  --k-panel-3: var(--ui-tertiary, hsla(247, 50%, 90%, 1));
  --k-border: var(--ui-black-transparent, hsla(0, 0%, 0%, 0.15));
  --k-form-border: var(--paint-form-border, #E9EEF2);
  --k-text: var(--text-primary, hsla(225, 15%, 40%, 1));
  --k-text-2: hsla(225, 15%, 40%, 0.75);
  --k-overlay: var(--ui-modal-overlay, hsla(247, 74%, 72%, 0.9));
  --k-danger: #e5484d;
  --k-good: #0fbd8c;
  --k-warn: #ff8c1a;
  --k-key: #ffab19;
  --k-font: var(--dimod-font-ui, "Helvetica Neue", Helvetica, Arial, sans-serif);
  --k-mono: ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace;
  --k-radius: 0.5rem;
  --k-radius-sm: 0.25rem;
  --k-shadow: 0 8px 8px 0 hsla(0, 0%, 0%, 0.15);
  --k-canvas-bg: #fff;
  --k-grid: hsla(225, 15%, 40%, 0.08);
  --k-grid-2: hsla(225, 15%, 40%, 0.16);
  font-family: var(--k-font);
  color: var(--k-text);
  font-size: 0.75rem;
  -webkit-font-smoothing: antialiased;
}
[theme="dark"] .ks5 {
  --k-accent-text: oklch(from var(--k-accent) max(l, 0.72) c h);
  --k-bar: var(--dimod-motion-tertiary, #5a4bd4);
  --k-bg: var(--ui-secondary, rgb(30, 30, 30));
  --k-panel: var(--ui-primary, rgb(17, 17, 17));
  --k-panel-2: var(--ui-secondary, rgb(30, 30, 30));
  --k-panel-3: var(--ui-tertiary, rgb(46, 46, 46));
  --k-form-border: rgba(255, 255, 255, 0.15);
  --k-text-2: rgba(238, 238, 238, 0.65);
  --k-canvas-bg: #111;
  --k-grid: rgba(255, 255, 255, 0.05);
  --k-grid-2: rgba(255, 255, 255, 0.1);
  color-scheme: dark;
}
.ks5 *, .ks5 *::before, .ks5 *::after { box-sizing: border-box; }
.ks5 button { font-family: inherit; }

/* ---------- root layout ---------- */
#ks5-root {
  position: fixed; inset: 0; z-index: 510;
  display: flex; flex-direction: column;
  background: var(--k-bg);
  user-select: none;
  overflow: hidden;
}
#ks5-root.k5-hidden { display: none; }

/* ---------- menu bar (studio top bar) ---------- */
.k5-menubar {
  height: 3rem; flex-shrink: 0;
  display: flex; align-items: center; gap: 0.25rem;
  padding: 0 0.5rem;
  background: var(--k-bar);
  color: #fff;
  font-size: 0.75rem; font-weight: bold;
}
.k5-logo { display: flex; align-items: center; gap: 0.4rem; padding: 0 0.5rem 0 0.25rem; font-size: 0.95rem; font-weight: 800; letter-spacing: 0.02em; }
.k5-logo svg { width: 1.6rem; height: 1.6rem; }
.k5-menu-item {
  height: 100%; display: flex; align-items: center; padding: 0 0.75rem;
  cursor: pointer; border: none; background: none; color: inherit; font: inherit;
}
.k5-menu-item:hover, .k5-menu-item.k5-open { background: hsla(0, 0%, 0%, 0.15); }
.k5-title-input {
  height: 2rem; min-width: 10rem; max-width: 18rem; padding: 0 0.75rem; margin: 0 0.5rem;
  border-radius: var(--k-radius-sm); border: 1px dashed hsla(0, 100%, 100%, 0.35);
  background: hsla(0, 100%, 100%, 0.25); color: #fff; font: inherit; font-weight: bold; outline: none;
}
.k5-title-input::placeholder { color: hsla(0, 100%, 100%, 0.75); }
.k5-title-input:hover { border-color: hsla(0, 100%, 100%, 0.75); }
.k5-title-input:focus { border: 1px solid #fff; background: hsla(0, 100%, 100%, 0.25); }
.k5-menubar .k5-spacer { flex: 1; }
.k5-bar-btn {
  height: 2rem; display: inline-flex; align-items: center; gap: 0.35rem; padding: 0 0.85rem;
  border-radius: var(--k-radius-sm); border: 1px solid hsla(0, 100%, 100%, 0.35);
  background: hsla(0, 100%, 100%, 0.15); color: #fff; font: inherit; font-weight: bold; cursor: pointer;
}
.k5-bar-btn:hover { background: hsla(0, 100%, 100%, 0.28); }
.k5-bar-btn.k5-primary { background: #fff; color: var(--k-accent-text); border-color: #fff; }
.k5-bar-btn.k5-primary:hover { filter: brightness(0.96); }
.k5-bar-btn svg { width: 1rem; height: 1rem; }
.k5-dirty-dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--k-key); display: none; }
.k5-dirty .k5-dirty-dot { display: inline-block; }

/* dimod: every menu and dropdown looks like the costume editor's right-click menu (dimod-canvas-menu.css) */
.k5-menu {
  position: fixed; z-index: 100000; min-width: 12.5rem; max-height: 80vh; overflow: auto;
  padding: 0.25rem; display: flex; flex-direction: column; user-select: none;
  background: #fff; color: var(--k-text);
  border: 1px solid var(--k-border); border-radius: 0.375rem;
  box-shadow: 0 0.375rem 1rem hsla(0, 0%, 0%, 0.18);
  font-family: var(--k-font); font-size: 0.75rem; text-align: left;
}
[theme="dark"] .k5-menu { background: rgb(30, 30, 30); box-shadow: 0 0.375rem 1rem hsla(0, 0%, 0%, 0.5); }
.k5-menu-row {
  display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.5rem; border-radius: 0.25rem;
  white-space: nowrap; cursor: pointer;
}
.k5-menu-row:hover, .k5-menu-row.k5-active { background: var(--k-accent); color: var(--k-on-accent); }
.k5-menu-row.k5-danger:hover { background: var(--k-danger); }
.k5-menu-row.k5-disabled { opacity: 0.4; pointer-events: none; }
.k5-menu-row svg { width: 0.875rem; height: 0.875rem; flex-shrink: 0; }
.k5-menu-row .k5-kbd { margin-left: auto; padding-left: 1rem; opacity: 0.55; font-size: 0.6875rem; }
.k5-menu-row:hover .k5-kbd, .k5-menu-row.k5-active .k5-kbd { opacity: 0.8; }
.k5-menu-row .k5-check { width: 1rem; display: inline-flex; justify-content: center; }
.k5-menu-sep { height: 1px; margin: 0.25rem; background: var(--k-border); }
[theme="dark"] .k5-menu-sep { background: var(--ui-tertiary, rgb(46, 46, 46)); }
.k5-menu-label { padding: 0.3rem 0.5rem 0.15rem; font-size: 0.625rem; font-weight: bold; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.6; }

/* ---------- toolbar (paint editor mode-tools look) ---------- */
.k5-toolbar {
  flex-shrink: 0; display: flex; align-items: center; flex-wrap: wrap; row-gap: 0.5rem;
  padding: 0.5rem 0.75rem; margin: 0.5rem 0.5rem 0;
  background: var(--k-panel); border: 1px solid var(--k-border); border-radius: var(--k-radius);
}
.k5-tgroup { display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0; }
.k5-tgroup + .k5-tgroup { margin-left: 0.6rem; padding-left: 0.6rem; border-left: 1px dashed var(--k-border); }
.k5-tlabel { font-weight: bold; font-size: 0.7rem; opacity: 0.9; white-space: nowrap; }

/* ---------- buttons ---------- */
.k5-btn {
  height: 2rem; min-width: 2rem; display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;
  padding: 0 0.6rem; border-radius: var(--k-radius-sm); border: 1px solid var(--k-border);
  background: var(--k-panel); color: var(--k-text); font: inherit; font-weight: bold; font-size: 0.75rem;
  cursor: pointer; white-space: nowrap; transition: background-color 0.1s, border-color 0.1s;
}
.k5-btn:hover { border-color: var(--k-accent); }
.k5-btn:active { background: var(--k-accent-t); }
.k5-btn.k5-on { background: var(--k-accent); border-color: var(--k-accent); color: var(--k-on-accent); }
.k5-btn.k5-on svg { color: var(--k-on-accent); }
.k5-btn.k5-primary { background: var(--k-accent); border-color: var(--k-accent); color: var(--k-on-accent); }
.k5-btn.k5-primary:hover { background: var(--k-accent-2); }
.k5-btn.k5-primary svg { color: var(--k-on-accent); }
.k5-btn.k5-rec svg { color: var(--k-danger); }
.k5-btn.k5-rec.k5-on svg { color: var(--k-on-accent); }
.k5-btn.k5-danger { color: var(--k-danger); }
.k5-btn.k5-danger:hover { border-color: var(--k-danger); }
.k5-btn.k5-rec.k5-on { background: var(--k-danger); border-color: var(--k-danger); }
.k5-btn.k5-icon { padding: 0; width: 2rem; }
.k5-btn.k5-sm { height: 1.5rem; min-width: 1.5rem; font-size: 0.7rem; padding: 0 0.45rem; }
.k5-btn.k5-sm.k5-icon { width: 1.5rem; padding: 0; }
.k5-btn svg { width: 1rem; height: 1rem; color: var(--k-accent); flex-shrink: 0; }
.k5-btn.k5-plain { border-color: transparent; background: transparent; }
.k5-btn.k5-plain:hover { background: var(--k-accent-10); border-color: transparent; }
.k5-btn[disabled] { opacity: 0.5; pointer-events: none; }
.k5-seg { display: inline-flex; }
.k5-seg > .k5-btn { border-radius: 0; margin-left: -1px; }
.k5-seg > .k5-btn:first-child { border-radius: var(--k-radius-sm) 0 0 var(--k-radius-sm); margin-left: 0; }
.k5-seg > .k5-btn:last-child { border-radius: 0 var(--k-radius-sm) var(--k-radius-sm) 0; }
.k5-seg > .k5-btn.k5-on { position: relative; z-index: 1; }

/* labeled icon button (paint editor: icon over small label) */
.k5-lbtn {
  display: inline-flex; flex-direction: column; align-items: center; gap: 0.15rem;
  padding: 0.25rem 0.4rem; border: none; background: none; border-radius: var(--k-radius-sm);
  color: var(--k-text); font: inherit; font-size: 0.65rem; cursor: pointer; min-width: 2.75rem;
}
.k5-lbtn svg { width: 1.25rem; height: 1.25rem; color: var(--k-accent); }
.k5-lbtn:hover { background: var(--k-accent-10); }
.k5-lbtn:active { background: var(--k-accent-t); }
.k5-lbtn.k5-on { background: var(--k-accent); color: var(--k-on-accent); }
.k5-lbtn.k5-on svg { color: var(--k-on-accent); }

/* ---------- form controls (paint editor input.css) ---------- */
.k5-input, .k5-select {
  height: 2rem; padding: 0 0.75rem; min-width: 0;
  font-family: var(--k-font); font-size: 0.75rem; font-weight: bold; color: var(--k-text);
  border: 1px solid var(--k-form-border); border-radius: 2rem; background: var(--k-panel);
  outline: none; transition: border-color 0.25s ease-out, box-shadow 0.25s ease-out;
}
[theme="dark"] .ks5 .k5-input, [theme="dark"] .ks5 .k5-select { background: rgb(30, 30, 30); }
.k5-input:focus, .k5-select:focus { border-color: var(--k-accent); box-shadow: 0 0 0 0.25rem var(--k-accent-t); }
.k5-input.k5-sm, .k5-select.k5-sm { height: 1.5rem; padding: 0 0.5rem; font-size: 0.7rem; }
.k5-input.k5-num { text-align: center; }
.k5-input.k5-err { border-color: var(--k-danger); }
.k5-select { appearance: none; padding-right: 1.6rem; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 0.85rem) 50%, calc(100% - 0.55rem) 50%; background-size: 0.3rem 0.3rem; background-repeat: no-repeat; }
.k5-textarea {
  width: 100%; min-height: 4.5rem; resize: vertical; padding: 0.5rem 0.75rem;
  font-family: var(--k-mono); font-size: 0.72rem; color: var(--k-text); line-height: 1.45;
  border: 1px solid var(--k-form-border); border-radius: var(--k-radius); background: var(--k-panel); outline: none;
}
.k5-textarea:focus { border-color: var(--k-accent); box-shadow: 0 0 0 0.25rem var(--k-accent-t); }

/* scrubbable number field */
.k5-scrub {
  display: inline-flex; align-items: center; height: 1.6rem; min-width: 0;
  border: 1px solid var(--k-form-border); border-radius: 2rem; background: var(--k-panel);
  overflow: hidden; transition: border-color 0.2s, box-shadow 0.2s;
}
[theme="dark"] .ks5 .k5-scrub { background: rgb(30, 30, 30); }
.k5-scrub:focus-within { border-color: var(--k-accent); box-shadow: 0 0 0 0.2rem var(--k-accent-t); }
.k5-scrub-label { padding: 0 0.1rem 0 0.55rem; font-weight: bold; font-size: 0.68rem; cursor: ew-resize; white-space: nowrap; }
.k5-scrub input {
  flex: 1; min-width: 0; width: 100%; height: 100%; border: none; outline: none; background: transparent;
  font: inherit; font-weight: bold; font-size: 0.72rem; color: var(--k-text); text-align: right; padding: 0 0.55rem 0 0.2rem;
  cursor: ew-resize;
}
.k5-scrub input:focus { cursor: text; text-align: left; }
.k5-scrub-unit { padding-right: 0.5rem; opacity: 0.9; font-size: 0.65rem; }
.k5-scrub.k5-keyed { border-color: var(--k-key); background: hsla(38, 100%, 55%, 0.12); }
.k5-scrub.k5-animated { border-color: hsla(38, 100%, 55%, 0.55); }
.k5-scrub.k5-expr { border-color: var(--k-accent); background: var(--k-accent-10); }

/* switch */
.k5-switch { position: relative; width: 2rem; height: 1.1rem; flex-shrink: 0; cursor: pointer; }
.k5-switch input { position: absolute; opacity: 0; pointer-events: none; }
.k5-switch span { position: absolute; inset: 0; border-radius: 1rem; background: var(--k-panel-3); transition: background 0.15s; }
.k5-switch span::after { content: ""; position: absolute; top: 2px; left: 2px; width: calc(1.1rem - 4px); height: calc(1.1rem - 4px); border-radius: 50%; background: #fff; box-shadow: 0 1px 2px hsla(0,0%,0%,0.3); transition: transform 0.15s; }
.k5-switch input:checked + span { background: var(--k-accent); }
.k5-switch input:checked + span::after { transform: translateX(0.9rem); }

.k5-range { accent-color: var(--k-accent); width: 6rem; }

.k5-swatch { width: 1.6rem; height: 1.6rem; border-radius: 50%; border: 1px solid var(--k-border); cursor: pointer; flex-shrink: 0; position: relative; overflow: hidden; }
.k5-swatch input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

/* keyframe diamond toggle */
.k5-kd {
  width: 1.1rem; height: 1.1rem; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; cursor: pointer; padding: 0; color: var(--k-text-2);
}
.k5-kd svg { width: 0.8rem; height: 0.8rem; }
.k5-kd:hover { color: var(--k-key); }
.k5-kd.k5-on { color: var(--k-key); }
.k5-kd.k5-part { color: hsla(38, 100%, 55%, 0.6); }

/* ---------- main layout ---------- */
.k5-main { flex: 1; min-height: 0; display: flex; gap: 0.5rem; padding: 0.5rem; }
.k5-center { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.k5-pane {
  background: var(--k-panel); border: 1px solid var(--k-border); border-radius: var(--k-radius);
  display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden;
}
.k5-pane-head {
  height: 2.5rem; flex-shrink: 0; display: flex; align-items: center; gap: 0.4rem; padding: 0 0.5rem 0 0.75rem;
  border-bottom: 1px solid var(--k-border); font-weight: bold; font-size: 0.8rem;
}
.k5-pane-head .k5-spacer { flex: 1; }
.k5-pane-body { flex: 1; min-height: 0; overflow: auto; }
.k5-splitter { flex-shrink: 0; position: relative; z-index: 5; }
.k5-splitter.k5-v { width: 0.5rem; margin: 0 -0.5rem; cursor: col-resize; }
.k5-splitter.k5-h { height: 0.5rem; margin: -0.5rem 0; cursor: row-resize; }
.k5-splitter::after { content: ""; position: absolute; border-radius: 2px; background: transparent; transition: background 0.15s; }
.k5-splitter.k5-v::after { top: 30%; bottom: 30%; left: calc(50% - 2px); width: 4px; }
.k5-splitter.k5-h::after { left: 30%; right: 30%; top: calc(50% - 2px); height: 4px; }
.k5-splitter:hover::after, .k5-splitter.k5-drag::after { background: var(--k-accent); }
.k5-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.k5-scroll::-webkit-scrollbar-thumb { background: var(--k-border); border-radius: 8px; }
.k5-scroll::-webkit-scrollbar-track { background: transparent; }

/* ---------- outliner ---------- */
.k5-outliner { width: 230px; }
.k5-tree-row {
  display: flex; align-items: center; gap: 0.4rem; height: 2.5rem; padding: 0 0.4rem 0 0.5rem; margin: 0.15rem 0.35rem;
  border-radius: var(--k-radius); border: 2px solid transparent; cursor: pointer; position: relative;
}
.k5-tree-row:hover { background: var(--k-accent-10); }
.k5-tree-row.k5-sel { border-color: var(--k-accent); background: var(--k-accent-10); }
.k5-tree-row.k5-drop-in { box-shadow: inset 0 0 0 2px var(--k-accent); background: var(--k-accent-20); }
.k5-tree-row.k5-drop-above::before, .k5-tree-row.k5-drop-below::after { content: ""; position: absolute; left: 0.3rem; right: 0.3rem; height: 3px; border-radius: 3px; background: var(--k-accent); }
.k5-tree-row.k5-drop-above::before { top: -4px; }
.k5-tree-row.k5-drop-below::after { bottom: -4px; }
.k5-tree-row.k5-hidden-part { opacity: 0.5; }
.k5-thumb { width: 2rem; height: 2rem; flex-shrink: 0; border-radius: var(--k-radius-sm); background: var(--k-panel-2) center/contain no-repeat; border: 1px solid var(--k-border); }
.k5-tree-name { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.15; }
.k5-tree-name b { font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.k5-tree-name small { font-size: 0.65rem; opacity: 0.9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.k5-tree-acts { display: flex; gap: 0.1rem; opacity: 0; }
.k5-tree-row:hover .k5-tree-acts, .k5-tree-row.k5-sel .k5-tree-acts { opacity: 1; }
.k5-tree-caret { width: 0.9rem; flex-shrink: 0; display: inline-flex; justify-content: center; opacity: 0.8; }
.k5-tree-caret svg { width: 0.7rem; height: 0.7rem; }
.k5-empty { padding: 1.25rem 1rem; text-align: center; opacity: 0.9; line-height: 1.5; }
.k5-empty b { display: block; font-size: 0.85rem; opacity: 1; margin-bottom: 0.25rem; }

/* ---------- viewport ---------- */
.k5-viewport { flex: 1; min-height: 0; position: relative; }
.k5-view-area { flex: 1; min-height: 0; position: relative; overflow: hidden; outline: none; }
.k5-view-area canvas { position: absolute; left: 0; top: 0; display: block; }
/* dimod: the costume editor's checkerboard (scratch-paint layer.js): #D9E3F2 on white, #222 on #111 */
.k5-checker { --k-tile: #D9E3F2; background-color: #fff; background-image:
  linear-gradient(45deg, var(--k-tile) 25%, transparent 25%), linear-gradient(-45deg, var(--k-tile) 25%, transparent 25%),
  linear-gradient(45deg, transparent 75%, var(--k-tile) 75%), linear-gradient(-45deg, transparent 75%, var(--k-tile) 75%);
  background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0; }
[theme="dark"] .k5-checker { --k-tile: #222; background-color: #111; }
.k5-checker.k5-force-light, [theme="dark"] .k5-checker.k5-force-light { --k-tile: #D9E3F2; background-color: #fff; }
.k5-checker.k5-force-dark, [theme="dark"] .k5-checker.k5-force-dark { --k-tile: #222; background-color: #111; }
.k5-float {
  position: absolute; display: flex; align-items: center; gap: 0.25rem; padding: 0.25rem;
  background: var(--k-panel); border: 1px solid var(--k-border); border-radius: var(--k-radius); box-shadow: 0 2px 6px hsla(0,0%,0%,0.08);
}
.k5-float.k5-bl { left: 0.5rem; bottom: 0.5rem; }
.k5-float.k5-br { right: 0.5rem; bottom: 0.5rem; }
.k5-float.k5-tl { left: 0.5rem; top: 0.5rem; }
.k5-float.k5-tr { right: 0.5rem; top: 0.5rem; }
.k5-rec-badge { position: absolute; left: 50%; top: 0.6rem; transform: translateX(-50%); padding: 0.2rem 0.7rem; border-radius: 1rem; background: var(--k-danger); color: #fff; font-weight: bold; font-size: 0.7rem; display: none; }
.k5-recording .k5-rec-badge { display: block; }
.k5-drop-hint { position: absolute; inset: 0.5rem; border: 3px dashed var(--k-accent); border-radius: var(--k-radius); background: var(--k-accent-10); display: none; align-items: center; justify-content: center; font-weight: bold; font-size: 1rem; color: var(--k-accent-text); pointer-events: none; }
.k5-dragging-file .k5-drop-hint { display: flex; }

/* ---------- inspector ---------- */
.k5-inspector { width: 290px; }
.k5-sec { border-bottom: 1px solid var(--k-border); }
.k5-sec-head { display: flex; align-items: center; gap: 0.4rem; padding: 0.6rem 0.75rem; font-weight: bold; font-size: 0.75rem; cursor: pointer; }
.k5-sec-head:hover { color: var(--k-accent-text); }
.k5-sec-head svg.k5-caret { width: 0.7rem; height: 0.7rem; transition: transform 0.15s; }
.k5-sec.k5-closed svg.k5-caret { transform: rotate(-90deg); }
.k5-sec.k5-closed .k5-sec-body { display: none; }
.k5-sec-head .k5-badge { margin-left: auto; }
.k5-sec-body { padding: 0 0.75rem 0.75rem; display: flex; flex-direction: column; gap: 0.4rem; }
.k5-row { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
.k5-row > .k5-grow { flex: 1; min-width: 0; }
.k5-row-label { width: 5.2rem; flex-shrink: 0; font-weight: bold; font-size: 0.7rem; opacity: 0.9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 0.3rem; }
.k5-row-label i { width: 0.45rem; height: 0.45rem; border-radius: 50%; flex-shrink: 0; }
.k5-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem 0.4rem; }
.k5-grid2 .k5-cell { display: flex; align-items: center; gap: 0.2rem; min-width: 0; }
.k5-grid2 .k5-cell .k5-scrub { flex: 1; }
.k5-badge { display: inline-flex; align-items: center; height: 1.1rem; padding: 0 0.4rem; border-radius: 1rem; font-size: 0.6rem; font-weight: bold; background: var(--k-accent-10); color: var(--k-accent-text); }
.k5-hint { font-size: 0.68rem; opacity: 0.9; line-height: 1.45; }
.k5-costumes { display: grid; grid-template-columns: repeat(auto-fill, minmax(3.6rem, 1fr)); gap: 0.35rem; }
.k5-costume {
  position: relative; aspect-ratio: 1; border-radius: var(--k-radius); border: 2px solid var(--k-border); background: var(--k-panel-2) center/70% no-repeat;
  cursor: pointer; overflow: hidden;
}
.k5-costume:hover { border-color: var(--k-accent); }
.k5-costume.k5-sel { border-color: var(--k-accent); background-color: var(--k-accent-10); }
.k5-costume span { position: absolute; left: 0; right: 0; bottom: 0; padding: 0.1rem 0.2rem; font-size: 0.58rem; font-weight: bold; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: var(--k-panel); }
.k5-costume.k5-sel span { background: var(--k-accent); color: var(--k-on-accent); }
.k5-costume em { position: absolute; left: 0.2rem; top: 0.1rem; font-size: 0.55rem; font-style: normal; font-weight: bold; opacity: 0.9; }
.k5-ease-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.25rem; }
.k5-ease-cell { height: 2.4rem; border-radius: var(--k-radius-sm); border: 1px solid var(--k-border); background: var(--k-panel); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 0.55rem; font-weight: bold; gap: 0.1rem; padding: 0.15rem; }
.k5-ease-cell canvas { width: 100%; height: 1.4rem; }
.k5-ease-cell:hover { border-color: var(--k-accent); }
.k5-ease-cell.k5-on { border-color: var(--k-accent); background: var(--k-accent-10); color: var(--k-accent-text); }

/* ---------- timeline ---------- */
.k5-timeline { height: 300px; flex-shrink: 0; }
.k5-tl-body { flex: 1; min-height: 0; display: flex; }
.k5-tl-labels { width: 220px; flex-shrink: 0; border-right: 1px solid var(--k-border); overflow: hidden; position: relative; display: flex; flex-direction: column; }
.k5-tl-labels-head { flex-shrink: 0; border-bottom: 1px solid var(--k-border); display: flex; align-items: center; gap: 0.25rem; padding: 0 0.35rem; }
.k5-tl-labels-list { flex: 1; min-height: 0; overflow: hidden; position: relative; }
.k5-tl-row { position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 0.3rem; padding: 0 0.35rem; font-size: 0.7rem; white-space: nowrap; cursor: pointer; }
.k5-tl-row:hover { background: var(--k-accent-10); }
.k5-tl-row.k5-sel { background: var(--k-accent-20); }
.k5-tl-row.k5-group { font-weight: bold; font-size: 0.72rem; }
.k5-tl-row .k5-dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; flex-shrink: 0; }
.k5-tl-row .k5-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.k5-tl-row .k5-mini { opacity: 0; }
.k5-tl-row:hover .k5-mini, .k5-tl-row .k5-mini.k5-on { opacity: 1; }
.k5-tl-row.k5-muted .k5-name { text-decoration: line-through; opacity: 0.5; }
.k5-tl-canvas-wrap { flex: 1; min-width: 0; position: relative; outline: none; }
.k5-tl-canvas-wrap canvas { position: absolute; left: 0; top: 0; }
.k5-mini-btn { width: 1.25rem; height: 1.25rem; border: none; background: none; border-radius: var(--k-radius-sm); padding: 0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; color: var(--k-text); flex-shrink: 0; }
.k5-mini-btn:hover { background: var(--k-accent-10); color: var(--k-accent); }
.k5-mini-btn svg { width: 0.85rem; height: 0.85rem; }
.k5-mini-btn.k5-on { color: var(--k-accent); }
.k5-mini-btn.k5-hidden-count { width: auto; gap: 0.1rem; padding: 0 0.2rem; font-size: 0.65rem; font-weight: 600; color: var(--k-text-2); }
.k5-mini-btn.k5-hidden-count:hover { color: var(--k-accent); }

/* ---------- modal (studio modal.css) ---------- */
.k5-modal-bg { position: fixed; inset: 0; z-index: 100001; background: var(--k-overlay); display: flex; align-items: flex-start; justify-content: center; overflow: auto; font-family: var(--k-font); }
.k5-modal {
  margin: 8vh auto; width: min(560px, 94vw); max-height: 84vh; display: flex; flex-direction: column;
  border: 4px solid hsla(0, 100%, 100%, 0.25); border-radius: var(--k-radius); overflow: hidden;
  background: var(--k-panel); color: var(--k-text); box-shadow: 0 16px 48px hsla(0,0%,0%,0.25);
}
.k5-modal.k5-wide { width: min(980px, 96vw); }
.k5-modal.k5-full { width: 96vw; height: 90vh; max-height: 90vh; margin: 5vh auto; }
.k5-modal-head { height: 3.125rem; flex-shrink: 0; display: flex; align-items: center; justify-content: center; position: relative; background: var(--k-accent); color: var(--k-on-accent); font-size: 1rem; letter-spacing: 0.4px; }
[theme="dark"] .k5-modal-head { background: var(--dimod-motion-tertiary, #5a4bd4); }
.k5-modal-close { position: absolute; right: 0.75rem; top: 50%; transform: translateY(-50%); width: 2rem; height: 2rem; border-radius: 50%; border: none; background: hsla(0,0%,0%,0.15); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.k5-modal-close:hover { background: hsla(0,0%,0%,0.25); }
.k5-modal-close svg { width: 0.9rem; height: 0.9rem; }
.k5-modal-body { flex: 1; min-height: 0; overflow: auto; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
.k5-modal-foot { flex-shrink: 0; display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.75rem 1.25rem; border-top: 1px solid var(--k-border); background: var(--k-panel-2); }
.k5-modal-foot .k5-btn { height: 2.25rem; padding: 0 1.1rem; border-radius: var(--k-radius); }
.k5-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr)); gap: 0.6rem; }
.k5-tile {
  display: flex; flex-direction: column; align-items: center; gap: 0.35rem; padding: 0.5rem; border-radius: var(--k-radius);
  border: 2px solid var(--k-border); background: var(--k-panel); cursor: pointer; text-align: center; font-weight: bold; font-size: 0.72rem;
}
.k5-tile:hover { border-color: var(--k-accent); box-shadow: 0 0 0 4px var(--k-accent-t); }
.k5-tile.k5-sel { border-color: var(--k-accent); background: var(--k-accent-10); }
.k5-tile .k5-tile-img { width: 100%; aspect-ratio: 1; border-radius: var(--k-radius-sm); background: var(--k-panel-2) center/70% no-repeat; }
.k5-tile small { font-weight: normal; opacity: 0.9; }
.k5-field { display: flex; flex-direction: column; gap: 0.3rem; }
.k5-field > label { font-weight: bold; }
.k5-list { display: flex; flex-direction: column; gap: 0.35rem; }
.k5-list-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; border-radius: var(--k-radius); border: 1px solid var(--k-border); cursor: pointer; }
.k5-list-item:hover { border-color: var(--k-accent); background: var(--k-accent-10); }
.k5-progress { height: 0.6rem; border-radius: 1rem; background: var(--k-panel-3); overflow: hidden; }
.k5-progress > div { height: 100%; width: 0; background: var(--k-accent); transition: width 0.1s; }

/* ---------- tooltip / toast ---------- */
.k5-tip {
  position: fixed; z-index: 100005; pointer-events: none; padding: 0.35rem 0.6rem; border-radius: var(--k-radius-sm);
  background: hsla(225, 15%, 22%, 0.95); color: #fff; font-family: var(--k-font); font-size: 0.7rem; font-weight: bold; max-width: 280px; line-height: 1.35;
  box-shadow: 0 4px 12px hsla(0,0%,0%,0.2); opacity: 0; transition: opacity 0.08s;
}
.k5-tip.k5-show { opacity: 1; }
.k5-tip kbd { font-family: inherit; opacity: 0.9; margin-left: 0.35rem; }
.k5-toasts { position: fixed; z-index: 100006; left: 50%; bottom: 1.5rem; transform: translateX(-50%); display: flex; flex-direction: column; gap: 0.4rem; align-items: center; pointer-events: none; }
.k5-toast { padding: 0.55rem 1rem; border-radius: 2rem; background: var(--k-accent); color: var(--k-on-accent); font-family: var(--k-font); font-weight: bold; font-size: 0.75rem; box-shadow: var(--k-shadow); animation: k5-toast-in 0.18s ease-out; }
.k5-toast.k5-bad { background: var(--k-danger); }
@keyframes k5-toast-in { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }

/* code editor */
.k5-code-wrap { position: relative; flex: 1; min-height: 12rem; border: 1px solid var(--k-form-border); border-radius: var(--k-radius); overflow: hidden; }
.k5-code-wrap .ace_editor { position: absolute !important; inset: 0; font-family: var(--k-mono) !important; }
.k5-code-wrap textarea.k5-textarea { position: absolute; inset: 0; height: 100%; border: none; border-radius: 0; resize: none; }
.k5-snippets { display: flex; flex-direction: column; gap: 0.2rem; overflow: auto; }
.k5-snippet { text-align: left; padding: 0.35rem 0.5rem; border-radius: var(--k-radius-sm); border: 1px solid transparent; background: none; color: var(--k-text); font: inherit; font-weight: bold; cursor: pointer; }
.k5-snippet:hover { border-color: var(--k-accent); background: var(--k-accent-10); }
.k5-snippet-group { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.9; padding: 0.5rem 0.5rem 0.1rem; font-weight: bold; }
`;
function injectCSS() {
  if (document.getElementById("ks5-style")) return;
  const s = document.createElement("style");
  s.id = "ks5-style";
  s.textContent = CSS + CSS_DOCK + CSS_PAINT + CSS_TAB;
  document.head.appendChild(s);
}
const CSS_DOCK = `
#ks5-root.k5-docked { position: fixed; z-index: 480; background: var(--k-bg); }
.k5-tabstrip { height: 2.75rem; flex-shrink: 0; display: flex; align-items: flex-end; gap: 0.5rem; padding-right: 0.5rem; font-weight: 500; }
.k5-tab {
  height: 90%; display: flex; align-items: center; gap: 0.35rem; padding: 0.125rem 1.25rem 0;
  border-radius: 1rem 1rem 0 0; border: 1px solid var(--k-border); border-bottom: none;
  background: var(--k-panel); color: var(--k-accent-text); font-size: 0.75rem; white-space: nowrap;
}
[theme="dark"] .k5-tab { background: var(--k-panel-2); }
.k5-tab svg { width: 1.2rem; height: 1.2rem; }
.k5-tabstrip .k5-spacer { flex: 1; }
.k5-tabstrip .k5-btn { margin-bottom: 0.35rem; height: 1.9rem; }
.k5-dock-body { flex: 1; min-height: 0; display: flex; background: var(--k-panel); border: 1px solid var(--k-border); border-radius: 0 var(--k-radius) 0 0; overflow: hidden; }
[theme="dark"] .k5-dock-body { background: var(--k-panel-2); }

/* parts column = costume list */
.k5-parts { width: 150px; min-width: 150px; flex-shrink: 0; position: relative; display: flex; flex-direction: column; background: var(--k-panel-3); }
.k5-parts-list { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 0.5rem 0 5.5rem; }
.k5-ptile {
  position: relative; width: 5rem; margin: 0.75rem auto; display: flex; flex-direction: column; cursor: pointer;
  border: 2px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-panel); text-align: center; font-size: 0.8rem;
}
[theme="dark"] .k5-ptile { background: var(--k-panel); }
.k5-ptile:hover { border-color: var(--k-accent); }
.k5-ptile.k5-sel { border-color: var(--k-accent); box-shadow: 0 0 0 4px var(--k-accent-t); }
.k5-ptile.k5-child { width: 4.3rem; }
.k5-ptile.k5-hidden-part .k5-ptile-img { opacity: 0.35; }
.k5-ptile-img { height: 3.6rem; background: center / contain no-repeat; margin: 0.35rem 0.4rem 0; }
.k5-ptile-num { position: absolute; top: 0.15rem; left: 0.3rem; font-size: 0.625rem; font-weight: bold; }
.k5-ptile-info { padding: 0.25rem; border-radius: 0 0 0.3rem 0.3rem; font-size: 0.625rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.k5-ptile-info small { display: block; font-size: 0.5rem; opacity: 0.9; overflow: hidden; text-overflow: ellipsis; }
.k5-ptile.k5-sel .k5-ptile-info { background: var(--k-accent); color: var(--k-on-accent); }
.k5-ptile-del { position: absolute; top: -0.65rem; right: -0.65rem; width: 1.5rem; height: 1.5rem; border-radius: 50%; border: none; background: var(--k-accent); color: var(--k-on-accent); display: none; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 0 0 3px var(--k-accent-t); }
.k5-ptile-del svg { width: 0.75rem; height: 0.75rem; }
.k5-ptile.k5-sel .k5-ptile-del { display: flex; }
.k5-ptile-eye { position: absolute; top: 0.1rem; right: 0.15rem; width: 1.1rem; height: 1.1rem; border: none; background: none; padding: 0; color: var(--k-text-2); cursor: pointer; display: none; }
.k5-ptile:hover .k5-ptile-eye, .k5-ptile.k5-hidden-part .k5-ptile-eye { display: block; }
.k5-ptile-eye svg { width: 100%; height: 100%; }
.k5-ptile.k5-drop-in { box-shadow: 0 0 0 4px var(--k-accent); }
.k5-ptile.k5-drop-above::before, .k5-ptile.k5-drop-below::after { content: ""; position: absolute; left: -0.3rem; right: -0.3rem; height: 3px; border-radius: 3px; background: var(--k-accent); }
.k5-ptile.k5-drop-above::before { top: -0.5rem; }
.k5-ptile.k5-drop-below::after { bottom: -0.5rem; }
.k5-add-wrap { position: absolute; left: 0; right: 0; bottom: 0; padding: 0.75rem 0; display: flex; flex-direction: column-reverse; align-items: center; gap: 0.5rem; pointer-events: none;
  background: linear-gradient(transparent, var(--k-panel-3) 45%); }
.k5-fab { pointer-events: auto; width: 3rem; height: 3rem; border-radius: 50%; border: none; background: var(--k-accent); color: var(--k-on-accent); cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 4px var(--k-accent-t); transition: transform 0.15s; }
.k5-fab svg { width: 1.4rem; height: 1.4rem; }
.k5-fab.k5-small { width: 2.4rem; height: 2.4rem; display: none; }
.k5-fab.k5-small svg { width: 1.1rem; height: 1.1rem; }
.k5-add-wrap:hover .k5-fab.k5-small { display: flex; }
.k5-add-wrap:hover .k5-fab.k5-main { background: var(--k-accent-2); }

/* editor column = paint editor-container */
.k5-ed { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 0.75rem; position: relative; }
.k5-rows { flex-shrink: 0; border-bottom: 1px dashed var(--k-border); padding-bottom: 0.5rem; }
.k5-prow { display: flex; align-items: center; flex-wrap: wrap; row-gap: 0.5rem; min-width: 0; }
.k5-prow + .k5-prow { margin-top: 0.5rem; }
.k5-prow > * { flex-shrink: 0; }
.k5-pgroup { display: flex; align-items: center; gap: 0.3rem; }
.k5-pgroup.k5-dash { border-right: 1px dashed var(--k-border); padding-right: 0.5rem; margin-right: 0.5rem; }
.k5-pgroup.k5-dash:last-child { border-right: none; }
.k5-plabel { font-size: 0.75rem; font-weight: bold; margin-right: 0.25rem; }
.k5-name-input { width: 9rem; }
.k5-prow .k5-scrub { height: 2rem; }
.k5-prow .k5-scrub input { font-size: 0.75rem; }
.k5-qcell { display: flex; align-items: center; gap: 0.1rem; }
.k5-qcell .k5-scrub { width: 4.3rem; }
.k5-qcell .k5-scrub-unit { display: none; }
.k5-qcell .k5-kd { width: 0.9rem; }
.k5-work { flex: 1; min-height: 0; display: flex; gap: 0.5rem; padding-top: 0.75rem; }
.k5-tools { flex-shrink: 0; display: grid; grid-template-columns: repeat(2, 2.5rem); grid-auto-rows: auto; gap: 0.25rem; align-content: start; }
.k5-tool { height: 2.5rem; border: none; border-radius: 0.25rem; background: none; color: var(--k-accent); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.k5-tool svg { width: 1.5rem; height: 1.5rem; }
[theme="dark"] .k5-tool { color: var(--k-text); }
.k5-tool:hover { background: var(--k-accent-10); }
.k5-tool.k5-on { background: var(--k-accent); color: var(--k-on-accent); }
.k5-tools hr { grid-column: span 2; border: none; border-top: 1px dashed var(--k-border); margin: 0.25rem 0; height: 0; }
.k5-canvas-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.k5-canvas-col .k5-viewport { flex: 1; min-height: 120px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-panel); }
.k5-bottombar { flex-shrink: 0; display: flex; align-items: center; gap: 0.4rem; flex-wrap: nowrap; min-width: 0; }
.k5-bottombar .k5-spacer { flex: 1; }
.k5-boxgroup { display: inline-flex; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); overflow: hidden; }
.k5-boxgroup > .k5-btn { border: none; border-radius: 0; height: 2rem; }
.k5-boxgroup > .k5-btn + .k5-btn { border-left: 1px solid var(--k-border); }
.k5-ed .k5-timeline { height: 190px; margin-top: 0.5rem; border-radius: var(--k-radius); }
.k5-ed .k5-tl-labels { width: 130px; }
.k5-ed .k5-pane-head { height: 2.25rem; }
.k5-drawer { position: absolute; top: 0.5rem; right: 0.5rem; bottom: 0.5rem; width: 280px; z-index: 20; box-shadow: 0 8px 24px hsla(0,0%,0%,0.18); display: none; }
.k5-drawer.k5-open { display: flex; }
.k5-drawer .k5-inspector { width: 100% !important; flex: 1; }
`;
const CSS_PAINT = `
#ks5-root.k5-overlay { position: fixed; z-index: 120; display: flex; flex-direction: row; background: var(--k-panel); overflow: hidden; }
[theme="dark"] #ks5-root.k5-overlay { background: var(--ui-secondary, rgb(30,30,30)); }
.k5p-detail { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
.k5p-editor { width: 100%; height: 100%; display: flex; flex-direction: column; padding: 0.75rem; min-width: 0; color: var(--paint-text-primary, #575e75); font-family: var(--dimod-font-ui, "Helvetica Neue", Helvetica, Arial, sans-serif); }
.k5p-top { border-bottom: 1px dashed var(--paint-ui-pane-border, #D9D9D9); padding-bottom: 0.5rem; min-width: 0; flex-shrink: 0; }
.k5p-row { display: flex; flex-direction: row; align-items: center; flex-wrap: wrap; row-gap: 0.5rem; align-content: center; min-width: 0; }
.k5p-row > * { flex-shrink: 0; }
.k5p-row + .k5p-row { margin-top: 0.5rem; }
.k5p-dashed { border-right: 1px dashed var(--paint-ui-pane-border, #D9D9D9); padding-right: 0.5rem; }
.k5p-dashed:last-child { border-right: none; padding-right: 0; }
.k5p-group { display: inline-flex; flex-direction: row; align-items: center; }
.k5p-group + .k5p-group { margin-left: 0.5rem; }
.k5p-labeled-height { height: 2.85rem; }
.k5p-label { display: flex; flex-direction: row; align-items: center; }
.k5p-input-label { font-size: 0.625rem; font-weight: bold; user-select: none; cursor: default; margin-right: 0.5rem; }
.k5p-input-label.k5p-scrubby { cursor: ew-resize; }
.k5p-input {
  height: 2rem; padding: 0 0.75rem; font-family: var(--dimod-font-ui, "Helvetica Neue", Helvetica, Arial, sans-serif); font-size: 0.75rem; font-weight: bold;
  color: var(--paint-text-primary, #575e75); border: 1px solid var(--paint-form-border, #E9EEF2); border-radius: 2rem; outline: none; cursor: text;
  transition: 0.25s ease-out; box-shadow: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; background: #fff;
}
[theme="dark"] .k5p-input { background: rgb(30, 30, 30); border-color: rgba(255, 255, 255, 0.15); }
.k5p-input:focus { border-color: var(--paint-motion-primary, hsla(247, 74%, 63%, 1)); box-shadow: 0 0 0 0.25rem var(--paint-motion-transparent, hsla(247, 74%, 63%, 0.35)); }
[theme="dark"] .k5p-input:hover, [theme="dark"] .k5p-input:focus { border-color: #333; }
.k5p-input.k5p-small { width: 3rem; text-align: center; padding: 0 0.25rem; }
.k5p-input.k5p-small-range { width: 4rem; text-align: center; padding: 0 0.25rem; }
.k5p-input.k5p-name { width: 8rem; }
.k5p-input.k5p-keyed { border-color: #ffab19; }
.k5p-input.k5p-animated { border-color: hsla(38, 100%, 55%, 0.55); }
.k5p-input.k5p-expr { border-color: var(--paint-motion-primary, #6c5ce7); }
.k5p-btn { background: none; cursor: pointer; user-select: none; }
.k5p-btn:active { background-color: var(--paint-motion-transparent, hsla(247, 74%, 63%, 0.35)); }
.k5p-btn.k5p-disabled { cursor: auto; opacity: 0.5; }
.k5p-btn.k5p-disabled:active { background: none; }
.k5p-bgroup { display: inline-flex; flex-direction: row; }
.k5p-bgbtn { display: inline-block; border: 1px solid var(--paint-ui-pane-border, #D9D9D9); border-left: none; border-radius: 0; padding: 0.35rem; line-height: 0; }
.k5p-bgbtn:first-of-type { border-left: 1px solid var(--paint-ui-pane-border, #D9D9D9); border-top-left-radius: 0.25rem; border-bottom-left-radius: 0.25rem; }
.k5p-bgbtn:last-of-type { border-top-right-radius: 0.25rem; border-bottom-right-radius: 0.25rem; }
.k5p-bgbtn svg { width: 1.25rem; height: 1.25rem; vertical-align: middle; color: var(--paint-motion-primary, #6c5ce7); }
[theme="dark"] .k5p-bgbtn svg { filter: brightness(1.7); }
.k5p-bgbtn.k5p-on { background: var(--paint-motion-transparent, hsla(247, 74%, 63%, 0.35)); }
.k5p-edit { background: none; border: none; display: inline-block; padding: 0.25rem 0.325rem; outline: none; border-radius: 0.25rem; min-width: 3rem; font-size: 0.85rem; text-align: center; color: inherit; }
.k5p-edit svg { width: 1.5rem; height: 1.5rem; vertical-align: middle; color: var(--paint-motion-primary, #6c5ce7); }
[theme="dark"] .k5p-edit svg { filter: brightness(1.7); }
.k5p-edit-title { display: block; margin-top: 0.125rem; font-size: 0.625rem; }
.k5p-edit.k5p-dirty .k5p-edit-title { font-weight: bold; color: var(--paint-motion-primary, #6c5ce7); }
.k5p-top-align { display: flex; flex-direction: row; flex: 1 1 auto; min-height: 0; padding-top: 1.25rem; min-width: 0; }
.k5p-tool-column { display: flex; flex-direction: column; flex-shrink: 0; min-height: 0; overflow-y: auto; }
.k5p-mode-selector { display: flex; max-width: 7.5rem; flex-direction: row; flex-wrap: wrap; align-items: flex-start; align-content: flex-start; justify-content: space-between; }
.k5p-tool { display: inline-block; margin: 0.25rem; border: none; border-radius: 0.25rem; outline: none; background: none; padding: 0.25rem; font-size: 0.85rem; transition: 0.2s; line-height: 0; }
.k5p-tool svg { width: 2rem; height: 2rem; vertical-align: middle; color: var(--paint-motion-primary, #6c5ce7); }
[theme="dark"] .k5p-tool svg { filter: brightness(1.7); }
.k5p-tool.k5p-selected { background-color: var(--paint-motion-primary, #6c5ce7); }
.k5p-tool.k5p-selected svg { filter: brightness(0) invert(1); }
.k5p-tool-sep { width: 100%; border-top: 1px dashed var(--paint-ui-pane-border, #D9D9D9); margin: 0.35rem 0; }
.k5p-controls { width: 100%; display: flex; flex-flow: column; flex-grow: 1; margin: 0 0.5rem; min-width: 0; min-height: 0; }
.k5p-canvas { width: 100%; flex-grow: 1; min-height: 120px; border: 1px solid #e8edf1; border-radius: 0.25rem; position: relative; overflow: hidden; display: flex; }
[theme="dark"] .k5p-canvas { border-color: var(--paint-form-border, rgba(255,255,255,0.15)); }
.k5p-canvas .k5-viewport { flex: 1; border: none; border-radius: 0; background: none; }
.k5p-canvas .k5-checker { --k-tile: var(--paint-motion-light-transparent, hsla(247, 61%, 56%, 0.15)); background-color: #fff; background-image: linear-gradient(45deg, var(--k-tile) 25%, transparent 25%), linear-gradient(-45deg, var(--k-tile) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--k-tile) 75%), linear-gradient(-45deg, transparent 75%, var(--k-tile) 75%); background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0; }
[theme="dark"] .k5p-canvas .k5-checker { --k-tile: #1e1e1e; background-color: #111; }
.k5p-canvas .k5-checker.k5-force-light { --k-tile: #D9E3F2; background-color: #fff; }
.k5p-canvas .k5-checker.k5-force-dark { --k-tile: #222; background-color: #111; }
.k5p-canvas-controls { display: flex; height: 36px; margin-top: 0.25rem; justify-content: space-between; align-items: center; gap: 0.5rem; flex-shrink: 0; }
.k5p-bitmap-button { display: flex; align-items: center; border-radius: 5px; background-color: var(--paint-motion-primary, #6c5ce7); padding: 0.5rem; line-height: 1.5rem; font-size: 0.75rem; font-weight: bold; color: white; justify-content: center; border: none; }
.k5p-bitmap-button svg { width: 1.2rem; height: 1.2rem; margin-right: 0.5rem; color: #fff; }
.k5p-time { display: flex; align-items: center; gap: 0.5rem; font-size: 0.7rem; font-weight: bold; white-space: nowrap; min-width: 0; }
.k5p-zoom { display: flex; flex-direction: row; gap: 0.5rem; }
.k5-kd.k5p-kd { margin-left: 0.15rem; }
.k5p-timeline { flex-shrink: 0; margin-top: 0.5rem; }
.k5p-timeline .k5-timeline { height: 210px; border-radius: 0.25rem; border-color: #e8edf1; }
[theme="dark"] .k5p-timeline .k5-timeline { border-color: var(--paint-form-border, rgba(255,255,255,0.15)); }
.k5p-timeline .k5-tl-labels { width: 130px; }
.k5p-timeline .k5-pane-head { height: 2.25rem; }
/* parts list uses the GUI's own asset-panel / selector / sprite-selector-item classes */
.k5-parts-gui { flex-shrink: 0; }
.k5-parts-gui [draggable="true"] { user-select: none; }
.k5-parts-gui .k5-drop-in { box-shadow: 0 0 0 4px var(--dimod-motion-primary, #6c5ce7) !important; }
.k5-parts-gui .k5-drop-above::before, .k5-parts-gui .k5-drop-below::after { content: ""; position: absolute; left: -0.3rem; right: -0.3rem; height: 3px; border-radius: 3px; background: var(--dimod-motion-primary, #6c5ce7); }
.k5-parts-gui .k5-drop-above::before { top: -0.45rem; }
.k5-parts-gui .k5-drop-below::after { bottom: -0.45rem; }
.k5-parts-gui .k5-child-tile { transform: scale(0.88); transform-origin: 50% 0; margin-bottom: -0.25rem !important; }
.k5-parts-gui .k5-hidden-part img { opacity: 0.35; }
.k5-tile-svg-icon { width: 100%; height: 100%; }
`;
const CSS_TAB = `
.ks5 .k5-viewport, .ks5 .k5-timeline {
  flex: 1; height: auto; border: none; border-radius: 0; background: transparent;
}
.ks5 .k5-view-area { border-radius: 0; }
`;
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "html") el.innerHTML = v;
      else if (k === "text") el.textContent = v;
      else if (k === "tip") el.dataset.tip = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const clearEl = (el) => {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
};
function btn(opts) {
  const cls = ["k5-btn"];
  if (opts.kind) for (const k of opts.kind.split(" ")) cls.push("k5-" + k);
  if (opts.sm) cls.push("k5-sm");
  if (opts.icon && !opts.label) cls.push("k5-icon");
  if (opts.on) cls.push("k5-on");
  if (opts.cls) cls.push(opts.cls);
  const b = h("button", { class: cls.join(" "), type: "button" });
  if (opts.icon) b.appendChild(iconEl(opts.icon));
  if (opts.label) b.appendChild(h("span", null, opts.label));
  if (opts.tip) b.dataset.tip = opts.tip + (opts.kbd ? `|${opts.kbd}` : "");
  if (opts.onClick) b.addEventListener("click", (e) => opts.onClick(e, b));
  if (opts.disabled) b.disabled = true;
  b.setOn = (v) => b.classList.toggle("k5-on", !!v);
  return b;
}
function lbtn(opts) {
  const b = h("button", { class: "k5-lbtn" + (opts.on ? " k5-on" : ""), type: "button" });
  b.appendChild(iconEl(opts.icon));
  b.appendChild(h("span", null, opts.label));
  if (opts.tip) b.dataset.tip = opts.tip + (opts.kbd ? `|${opts.kbd}` : "");
  if (opts.onClick) b.addEventListener("click", (e) => opts.onClick(e, b));
  b.setOn = (v) => b.classList.toggle("k5-on", !!v);
  return b;
}
function seg(buttons) { return h("div", { class: "k5-seg" }, buttons); }
function miniBtn(name, tip, onClick, on = false) {
  const b = h("button", { class: "k5-mini-btn" + (on ? " k5-on" : ""), type: "button", html: icon(name) });
  if (tip) b.dataset.tip = tip;
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(e, b); });
  b.addEventListener("mousedown", (e) => e.stopPropagation());
  return b;
}
function textInput(value, { placeholder = "", sm = false, cls = "", onChange, onInput } = {}) {
  const i = h("input", { class: `k5-input ${sm ? "k5-sm" : ""} ${cls}`, type: "text", value: value ?? "", placeholder, spellcheck: "false" });
  if (onInput) i.addEventListener("input", () => onInput(i.value));
  if (onChange) i.addEventListener("change", () => onChange(i.value));
  i.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") i.blur();
    if (e.key === "Escape") { i.value = value ?? ""; i.blur(); }
  });
  return i;
}
function select(options, value, onChange, { sm = true, cls = "" } = {}) {
  const s = h("select", { class: `k5-select ${sm ? "k5-sm" : ""} ${cls}` });
  for (const o of options) {
    const opt = typeof o === "object" ? o : { value: o, label: o };
    const el = h("option", { value: opt.value }, opt.label ?? opt.value);
    if (String(opt.value) === String(value)) el.selected = true;
    s.appendChild(el);
  }
  s.addEventListener("change", () => onChange && onChange(s.value));
  s.addEventListener("keydown", (e) => e.stopPropagation());
  return s;
}
function toggle(checked, onChange, tip) {
  const input = h("input", { type: "checkbox" });
  input.checked = !!checked;
  const el = h("label", { class: "k5-switch", tip }, input, h("span"));
  input.addEventListener("change", () => onChange(input.checked));
  el.set = (v) => (input.checked = !!v);
  return el;
}
function colorSwatch(intColor, onChange, onCommit) {
  const hex = "#" + (Math.max(0, Math.min(0xffffff, Math.round(intColor))) >>> 0).toString(16).padStart(6, "0");
  const input = h("input", { type: "color", value: hex });
  const el = h("label", { class: "k5-swatch", style: { background: hex } }, input);
  input.addEventListener("input", () => { el.style.background = input.value; onChange(parseInt(input.value.slice(1), 16)); });
  input.addEventListener("change", () => onCommit && onCommit(parseInt(input.value.slice(1), 16)));
  el.set = (v) => {
    const hx = "#" + (Math.max(0, Math.min(0xffffff, Math.round(v))) >>> 0).toString(16).padStart(6, "0");
    input.value = hx;
    el.style.background = hx;
  };
  return el;
}
function scrub({ label = "", value = 0, unit = "", step = 1, min = -Infinity, max = Infinity, precision = 2, tip, onChange, onReset }) {
  const input = h("input", { type: "text", spellcheck: "false" });
  const lab = label ? h("span", { class: "k5-scrub-label" }, label) : null;
  const un = unit ? h("span", { class: "k5-scrub-unit" }, unit) : null;
  const el = h("div", { class: "k5-scrub", tip }, lab, input, un);
  let cur = +value || 0;
  const fmt = (v) => {
    if (!Number.isFinite(v)) return "0";
    const r = Math.round(v * 10 ** precision) / 10 ** precision;
    return String(r);
  };
  const set = (v) => {
    cur = v;
    if (document.activeElement !== input) input.value = fmt(v);
  };
  set(cur);
  const clampV = (v) => Math.min(max, Math.max(min, v));
  let drag = null;
  const onDown = (e) => {
    if (e.button !== 0) return;
    if (document.activeElement === input && e.target === input) return;
    e.preventDefault();
    drag = { x: e.clientX, v: cur, moved: false };
    const move = (ev) => {
      const dx = ev.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 3) return;
      if (!drag.moved) { drag.moved = true; onChange && onChange(cur, "start"); document.body.style.cursor = "ew-resize"; }
      const k = ev.shiftKey ? 0.1 : ev.ctrlKey || ev.metaKey ? 10 : 1;
      const v = clampV(drag.v + dx * step * k);
      set(v);
      onChange && onChange(v, "drag");
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      if (drag && drag.moved) onChange && onChange(cur, "end");
      else { input.focus(); input.select(); }
      drag = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  el.addEventListener("mousedown", onDown);
  input.addEventListener("focus", () => { input.value = fmt(cur); });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") input.blur();
    else if (e.key === "Escape") {
      input.value = fmt(cur);
      input.blur();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const k = e.shiftKey ? 10 : 1;
      const v = clampV(cur + (e.key === "ArrowUp" ? step : -step) * k * (step < 1 ? 10 : 1));
      set(v);
      input.value = fmt(v);
      onChange && onChange(v, "typed");
    }
  });
  input.addEventListener("change", () => {
    let v = evalNumber(input.value);
    if (v == null) { input.value = fmt(cur); return; }
    v = clampV(v);
    set(v);
    input.value = fmt(v);
    onChange && onChange(v, "typed");
  });
  el.addEventListener("dblclick", (e) => {
    if (e.target === lab && onReset) onReset();
  });
  el.set = set;
  el.get = () => cur;
  el.setState = (st) => {
    el.classList.toggle("k5-keyed", !!st.keyed);
    el.classList.toggle("k5-animated", !!st.animated && !st.keyed);
    el.classList.toggle("k5-expr", !!st.expr);
  };
  el.input = input;
  return el;
}
function evalNumber(s) {
  s = String(s).trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  if (!/^[\d\s+\-*/().%e]+$/i.test(s)) return null;
  try { const v = Function(`"use strict";return (${s})`)(); return Number.isFinite(v) ? v : null; } catch { return null; }
}
let _tip = null;
let _tipTarget = null;
let _tipTimer = 0;
function installTooltips() {
  if (_tip) return;
  _tip = h("div", { class: "k5-tip ks5" });
  document.body.appendChild(_tip);
  const hide = () => { clearTimeout(_tipTimer); _tip.classList.remove("k5-show"); _tipTarget = null; };
  document.addEventListener(
    "mouseover",
    (e) => {
      const t = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
      if (!t || !t.closest(".ks5")) return hide();
      if (t === _tipTarget) return;
      _tipTarget = t;
      clearTimeout(_tipTimer);
      _tipTimer = setTimeout(() => {
        if (_tipTarget !== t || !t.isConnected) return;
        const [text, kbd] = String(t.dataset.tip).split("|");
        _tip.innerHTML = "";
        _tip.append(text);
        if (kbd) _tip.append(h("kbd", null, kbd));
        const r = t.getBoundingClientRect();
        _tip.style.left = "0px";
        _tip.style.top = "0px";
        _tip.classList.add("k5-show");
        const tw = _tip.offsetWidth, th = _tip.offsetHeight;
        let x = r.left + r.width / 2 - tw / 2;
        let y = r.bottom + 6;
        if (y + th > innerHeight - 4) y = r.top - th - 6;
        x = Math.max(4, Math.min(innerWidth - tw - 4, x));
        _tip.style.left = x + "px";
        _tip.style.top = y + "px";
      }, 350);
    },
    true,
  );
  document.addEventListener("mousedown", hide, true);
  document.addEventListener("wheel", hide, { capture: true, passive: true });
}
let _toasts = null;
function toast(msg, bad = false, ms = 2200) {
  injectCSS();
  if (!_toasts || !_toasts.isConnected) { _toasts = h("div", { class: "k5-toasts ks5" }); document.body.appendChild(_toasts); }
  const t = h("div", { class: "k5-toast" + (bad ? " k5-bad" : "") }, msg);
  _toasts.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
let _openMenu = null;
function closeMenus() {
  if (_openMenu) {
    const m = _openMenu;
    _openMenu = null;
    m.remove();
    if (m._onClose) m._onClose();
  }
}
function showMenu(items, pos, { ctx = false, onClose, minWidth } = {}) {
  injectCSS();
  closeMenus();
  const m = h("div", { class: "k5-menu ks5" + (ctx ? " k5-ctx" : "") });
  if (minWidth) m.style.minWidth = minWidth + "px";
  for (const it of items) {
    if (!it) continue;
    if (it === "sep") { m.appendChild(h("div", { class: "k5-menu-sep" })); continue; }
    if (it.heading) { m.appendChild(h("div", { class: "k5-menu-label" }, it.heading)); continue; }
    const row = h("div", { class: "k5-menu-row" + (it.disabled ? " k5-disabled" : "") + (it.danger ? " k5-danger" : "") });
    if (it.checked !== undefined) row.appendChild(h("span", { class: "k5-check", html: it.checked ? icon("check") : "" }));
    row.appendChild(h("span", null, it.label));
    if (it.kbd) row.appendChild(h("span", { class: "k5-kbd" }, it.kbd));
    if (it.submenu) row.appendChild(h("span", { class: "k5-kbd", html: icon("chevronRight") }));
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      if (it.submenu) {
        const r = row.getBoundingClientRect();
        const sub = typeof it.submenu === "function" ? it.submenu() : it.submenu;
        showMenu(sub, { x: r.right, y: r.top }, { ctx: true });
        return;
      }
      closeMenus();
      it.action && it.action();
    });
    m.appendChild(row);
  }
  m._onClose = onClose;
  document.body.appendChild(m);
  let x, y;
  if (pos instanceof Element) { const r = pos.getBoundingClientRect(); x = r.left; y = r.bottom; } else { x = pos.x; y = pos.y; }
  const w = m.offsetWidth, hh = m.offsetHeight;
  if (x + w > innerWidth - 4) x = Math.max(4, innerWidth - w - 4);
  if (y + hh > innerHeight - 4) y = Math.max(4, innerHeight - hh - 4);
  m.style.left = x + "px";
  m.style.top = y + "px";
  _openMenu = m;
  setTimeout(() => {
    const off = (e) => {
      if (m.contains(e.target)) return;
      document.removeEventListener("mousedown", off, true);
      if (_openMenu === m) closeMenus();
    };
    document.addEventListener("mousedown", off, true);
  }, 0);
  return m;
}
function promptDialog(title, label, value = "", { okLabel = "OK" } = {}) {
  return askPrompt(label || title, { title, initial: value, ok: okLabel });
}
function confirmDialog(title, message, { okLabel = "OK", danger = false } = {}) {
  return askConfirm(message, { title, ok: okLabel, danger }).then((ok) => !!ok);
}
function alertDialog(title, message) { return askAlert(message, { title }); }
function chooseDialog(title, options, { hint = "" } = {}) {
  return openAnimationDialog("choose", {
    title,
    hint,
    options: options.map((o) => ({ value: o.value, label: o.label, sub: o.sub, img: o.img, selected: !!o.special })),
  });
}
function ensureTrack(g, key) { g.tracks[key] ||= { keyframes: [] }; return g.tracks[key]; }
function sortTrack(tr) { tr.keyframes.sort((a, b) => a.sec - b.sec); }
function keyAt(tr, sec) { return tr ? tr.keyframes.find((k) => sameSec(k.sec, sec)) : null; }
function setKey(g, key, sec, value, { ease, exact = false } = {}) {
  const tr = ensureTrack(g, key);
  const t = tr.keyframes.length === 0 && !exact ? 0 : sec;
  let kf = keyAt(tr, t);
  if (kf) {
    if (kf.rand && Number.isFinite(+value) && Number.isFinite(+kf.value)) {
      const d = +value - +kf.value;
      kf.rand = { min: kf.rand.min + d, max: kf.rand.max + d };
    }
    kf.value = value;
    if (ease) kf.ease = ease;
  } else { kf = { sec: t, value, ease: ease || defaultEaseFor(key), id: makeKFID() }; tr.keyframes.push(kf); sortTrack(tr); }
  return kf;
}
const canBeRandom = (inf) => !!inf && inf.kind === "track" && !!TD[inf.key] && TD[inf.key].kind === "num";
const RANDOM_SPREAD = { px: 30, "°": 30, "%": 20, s: 0.05 };
const round3 = (v) => Math.round(v * 1000) / 1000;
function setKeysRandom(infos, on) {
  for (const i of infos) {
    if (!canBeRandom(i)) continue;
    if (!on) { delete i.kf.rand; continue; }
    if (i.kf.rand) continue;
    const d = TD[i.key];
    const v = Number.isFinite(+i.kf.value) ? +i.kf.value : d.def || 0;
    const spread = RANDOM_SPREAD[d.unit] ?? 10;
    let min = v - spread;
    let max = v + spread;
    if (typeof d.min === "number") min = Math.max(d.min, min);
    if (typeof d.max === "number") max = Math.min(d.max, max);
    i.kf.rand = { min: round3(min), max: round3(max) };
  }
}
function setKeysRandomEnd(infos, end, v) {
  for (const i of infos) {
    if (!canBeRandom(i) || !i.kf.rand) continue;
    const r = { ...i.kf.rand, [end]: v };
    if (r.min > r.max) {
      if (end === "min") r.max = v;
      else r.min = v;
    }
    i.kf.rand = r;
    i.kf.value = round3((r.min + r.max) / 2);
  }
}
function removeKeyAt(g, key, sec) {
  const tr = g.tracks[key];
  if (!tr) return;
  tr.keyframes = tr.keyframes.filter((k) => !sameSec(k.sec, sec));
  if (!tr.keyframes.length) delete g.tracks[key];
}
function hasKeyAt(g, key, sec) { return !!keyAt(g.tracks[key], sec); }
function deleteKeys(doc, infos) {
  const byTrack = new Map();
  for (const inf of infos) {
    const tr = inf.kind === "event" ? doc.events : inf.track;
    if (!byTrack.has(tr)) byTrack.set(tr, new Set());
    byTrack.get(tr).add(inf.kf.id);
  }
  for (const [tr, ids] of byTrack) {
    if (tr === doc.events) { doc.events = doc.events.filter((e) => !ids.has(e.id)); } else { tr.keyframes = tr.keyframes.filter((k) => !ids.has(k.id)); }
  }
  for (const g of doc.groups) for (const [k, tr] of Object.entries(g.tracks)) if (!tr.keyframes.length && !tr.muted) delete g.tracks[k];
}
function moveKeys(doc, infos, dt, maxSec = Infinity) {
  if (!dt) return;
  let minT = Infinity, maxT = -Infinity;
  for (const inf of infos) { minT = Math.min(minT, inf.kf.sec); maxT = Math.max(maxT, inf.kf.sec); }
  dt = Math.max(dt, -minT);
  if (Number.isFinite(maxSec)) dt = Math.min(dt, maxSec - maxT);
  const moving = new Set(infos.map((i) => i.kf));
  for (const inf of infos) inf.kf.sec = round6(inf.kf.sec + dt);
  const tracks = new Set(infos.map((i) => (i.kind === "event" ? doc.events : i.track)));
  for (const tr of tracks) {
    const list = tr === doc.events ? doc.events : tr.keyframes;
    const out = list.filter((k) => moving.has(k) || !list.some((m) => m !== k && moving.has(m) && sameSec(m.sec, k.sec)));
    out.sort((a, b) => a.sec - b.sec);
    if (tr === doc.events) doc.events = out;
    else tr.keyframes = out;
  }
  return dt;
}
function scaleKeys(doc, items, anchor, factor) {
  for (const { info, orig } of items) info.kf.sec = Math.max(0, round6(anchor + (orig - anchor) * factor));
  resortAll(doc, items.map((i) => i.info));
}
function reverseKeys(doc, infos) {
  if (infos.length < 2) return;
  let lo = Infinity, hi = -Infinity;
  for (const i of infos) { lo = Math.min(lo, i.kf.sec); hi = Math.max(hi, i.kf.sec); }
  const byTrack = new Map();
  for (const i of infos) {
    const tr = i.kind === "event" ? doc.events : i.track;
    if (!byTrack.has(tr)) byTrack.set(tr, []);
    byTrack.get(tr).push(i.kf);
  }
  for (const [tr, kfs] of byTrack) {
    kfs.sort((a, b) => a.sec - b.sec);
    const eases = kfs.map((k) => [k.ease, k.bez]);
    for (let j = 0; j < kfs.length; j++) {
      kfs[j].sec = round6(lo + hi - kfs[j].sec);
      if (tr !== doc.events) {
        const src = eases[j + 1] || eases[0];
        kfs[j].ease = src[0];
        if (src[1]) kfs[j].bez = [1 - src[1][2], 1 - src[1][3], 1 - src[1][0], 1 - src[1][1]];
        else delete kfs[j].bez;
      }
    }
  }
  resortAll(doc, infos);
}
function resortAll(doc, infos) {
  const tracks = new Set(infos.map((i) => (i.kind === "event" ? doc.events : i.track)));
  for (const tr of tracks) {
    if (tr === doc.events) doc.events.sort((a, b) => a.sec - b.sec);
    else sortTrack(tr);
  }
}
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const DRAW_TOOLS = ["pen", "line", "rect", "ellipse", "eraser"];
function drawTarget(st) {
  const g = st.primary !== null ? st.doc.groups.find((x) => x.name === st.primary) : null;
  if (g && Array.isArray(g.vectors)) return g;
  return null;
}
function blankVector(st, n) { return { name: String(n), w: st.doc.width, h: st.doc.height, items: [] }; }
function commitDrawing(ed, pv) {
  const st = ed.st;
  let g = drawTarget(st);
  let ci = 0, ox = 0, oy = 0;
  if (g) {
    const gi = st.groupIndex(g.name);
    const pose = st.currentPose();
    ci = Math.max(0, pose.costume[gi]);
    ox = pose.world[gi * 5] || 0;
    oy = -(pose.world[gi * 5 + 1] || 0);
  }
  if (pv.tool === "eraser") {
    if (!g) return;
    const rad = Math.max(4, pv.width) / 2 + 3;
    const hits = (it) => {
      const b = vectorBounds({ items: [it], w: 1, h: 1 });
      return pv.pts.some(([X, Y]) => X - ox >= b.x - rad && X - ox <= b.x + b.w + rad && Y - oy >= b.y - rad && Y - oy <= b.y + b.h + rad);
    };
    st.mutate("Erase", () => {
      const v = g.vectors[Math.min(ci, g.vectors.length - 1)];
      v.items = v.items.filter((it) => !hits(it));
    });
    return;
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  const pts = pv.pts.map(([X, Y]) => [r1(X - ox), r1(Y - oy)]);
  const item = { t: pv.tool, s: pv.color, f: pv.tool === "pen" || pv.tool === "line" ? "" : pv.fill, w: pv.width, d: "", p: [] };
  if (pv.tool === "pen") item.d = "M" + pts.map((p) => p.join(" ")).join("L");
  else item.p = [...pts[0], ...pts[1]];
  st.mutate("Draw", (doc) => {
    if (!g) { g = addGroup(doc, { name: "Drawing", costume: { name: "1", index: 0 } }); g.vectors = [blankVector(st, 1)]; }
    const v = g.vectors[Math.min(ci, g.vectors.length - 1)];
    v.items.push(item);
  });
  if (st.primary !== g.name) st.selectGroup(g.name);
}
function newDrawingFrame(ed, copy) {
  const st = ed.st;
  const g = drawTarget(st);
  if (!g) return;
  const gi = st.groupIndex(g.name);
  const cur = g.vectors[Math.max(0, st.currentPose().costume[gi])];
  st.mutate(copy ? "Duplicate drawing frame" : "New drawing frame", () => {
    const v = copy && cur ? JSON.parse(JSON.stringify(cur)) : blankVector(st, 0);
    v.name = String(g.vectors.length + 1);
    g.vectors.push(v);
    setKey(g, "costume", st.sec, { name: v.name, index: g.vectors.length - 1 }, { ease: "Step" });
  });
}
function addGroup(doc, { name, spriteName = THIS_SPRITE, targetId = "", costume = null } = {}) {
  const g = newGroup(uniqueName(name || "Part", doc.groups.map((x) => x.name)), spriteName, targetId);
  if (costume) g.tracks.costume = { keyframes: [{ sec: 0, value: costume, ease: "Step", id: makeKFID() }] };
  doc.groups.push(g);
  return g;
}
function duplicateGroup(doc, g) {
  const c = deepClone(g);
  c.name = uniqueName(g.name + " copy", doc.groups.map((x) => x.name));
  for (const tr of Object.values(c.tracks)) for (const kf of tr.keyframes) kf.id = makeKFID();
  const i = doc.groups.indexOf(g);
  doc.groups.splice(i + 1, 0, c);
  return c;
}
function deleteGroup(doc, g) {
  const i = doc.groups.indexOf(g);
  if (i < 0) return;
  doc.groups.splice(i, 1);
  for (const o of doc.groups) {
    for (const key of ["relativeTo", "maskSource"]) {
      const tr = o.tracks[key];
      if (!tr) continue;
      for (const kf of tr.keyframes) if (kf.value === g.name) kf.value = "";
      if (tr.keyframes.every((k) => !k.value)) delete o.tracks[key];
    }
  }
}
function renameGroup(doc, g, name) {
  name = String(name || "").trim() || g.name;
  if (name === g.name) return g.name;
  name = uniqueName(name, doc.groups.filter((x) => x !== g).map((x) => x.name));
  renameGroupRefs(doc, g.name, name);
  g.name = name;
  return name;
}
function moveGroup(doc, g, toIndex) {
  const i = doc.groups.indexOf(g);
  if (i < 0) return;
  doc.groups.splice(i, 1);
  doc.groups.splice(Math.max(0, Math.min(doc.groups.length, toIndex)), 0, g);
}
function staticParent(g) {
  const tr = g.tracks.relativeTo;
  if (!tr || !tr.keyframes.length) return "";
  return String(tr.keyframes[0].value || "");
}
function isAncestor(doc, maybeAncestor, g) {
  const seen = new Set();
  let cur = g;
  while (cur && !seen.has(cur.name)) {
    seen.add(cur.name);
    const p = staticParent(cur);
    if (!p) return false;
    if (p === maybeAncestor.name) return true;
    cur = doc.groups.find((x) => x.name === p);
  }
  return false;
}
function setParent(doc, child, parent, pose, gi, pi) {
  const tr = child.tracks;
  const simple = ["x", "y", "rotation", "scaleX", "scaleY"].every((k) => !tr[k] || tr[k].keyframes.length <= 1);
  const world = pose ? { x: pose.world[gi * 5], y: pose.world[gi * 5 + 1], r: pose.world[gi * 5 + 2], sx: pose.world[gi * 5 + 3], sy: pose.world[gi * 5 + 4] } : null;
  if (!parent) {
    delete tr.relativeTo;
    delete tr.followPos;
    delete tr.followRot;
    delete tr.followScale;
    if (simple && world) {
      setKey(child, "x", 0, round6(world.x));
      setKey(child, "y", 0, round6(world.y));
      setKey(child, "rotation", 0, round6(world.r));
      setKey(child, "scaleX", 0, round6(world.sx));
      setKey(child, "scaleY", 0, round6(world.sy));
    }
    return;
  }
  tr.relativeTo = { keyframes: [{ sec: 0, value: parent.name, ease: "Step", id: makeKFID() }] };
  tr.followPos = { keyframes: [{ sec: 0, value: 1, ease: "Step", id: makeKFID() }] };
  tr.followRot = { keyframes: [{ sec: 0, value: 1, ease: "Step", id: makeKFID() }] };
  tr.followScale = { keyframes: [{ sec: 0, value: 1, ease: "Step", id: makeKFID() }] };
  if (simple && world && pose && pi >= 0) {
    const px = pose.world[pi * 5], py = pose.world[pi * 5 + 1], pr = pose.world[pi * 5 + 2];
    const psx = (pose.world[pi * 5 + 3] || 1e-5) / 100, psy = (pose.world[pi * 5 + 4] || 1e-5) / 100;
    const a = (pr * Math.PI) / 180;
    const dx = world.x - px, dy = world.y - py;
    const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / psx;
    const ly = (dx * Math.sin(a) + dy * Math.cos(a)) / psy;
    setKey(child, "x", 0, round6(lx));
    setKey(child, "y", 0, round6(ly));
    setKey(child, "rotation", 0, round6(world.r - pr));
    setKey(child, "scaleX", 0, round6(world.sx / psx));
    setKey(child, "scaleY", 0, round6(world.sy / psy));
  }
}
function worldToLocal(pose, gi, key, worldValue) {
  const p = pose.parent[gi];
  if (p < 0) return worldValue;
  const base = gi * 5;
  const num = pose.num;
  const NS = num.length / pose.n;
  const fp = num[gi * NS + slotOf("followPos")], fr = num[gi * NS + slotOf("followRot")], fs = num[gi * NS + slotOf("followScale")];
  const px = pose.world[p * 5], py = pose.world[p * 5 + 1], pr = pose.world[p * 5 + 2];
  const psx = (pose.world[p * 5 + 3] || 1e-5) / 100, psy = (pose.world[p * 5 + 4] || 1e-5) / 100;
  void base;
  if ((key === "x" || key === "y") && fp) {
    const [wx, wy] = worldValue;
    const a = (pr * Math.PI) / 180;
    const dx = wx - px, dy = wy - py;
    return [(dx * Math.cos(a) - dy * Math.sin(a)) / psx, (dx * Math.sin(a) + dy * Math.cos(a)) / psy];
  }
  if (key === "rotation" && fr) return worldValue - pr;
  if (key === "scaleX" && fs) return worldValue / psx;
  if (key === "scaleY" && fs) return worldValue / psy;
  return worldValue;
}
const slotOf = (k) => SLOT[k];
function copyKeys(infos) {
  if (!infos.length) return null;
  const t0 = Math.min(...infos.map((i) => i.kf.sec));
  return {
    t0,
    items: infos.map((i) => ({
      kind: i.kind,
      group: i.group ? i.group.name : null,
      key: i.key || null,
      data: i.data ? i.data.name : null,
      kf: { ...deepClone(i.kf), sec: i.kf.sec - t0 },
    })),
  };
}
function pasteKeys(doc, clip, at, targetGroup) {
  if (!clip) return [];
  const groupsInClip = new Set(clip.items.filter((i) => i.kind === "track").map((i) => i.group));
  const retarget = targetGroup && groupsInClip.size === 1 ? targetGroup : null;
  const ids = [];
  for (const it of clip.items) {
    const kf = { ...deepClone(it.kf), sec: round6(at + it.kf.sec), id: makeKFID() };
    if (it.kind === "event") {
      doc.events = doc.events.filter((e) => !sameSec(e.sec, kf.sec));
      doc.events.push(kf);
      doc.events.sort((a, b) => a.sec - b.sec);
    } else if (it.kind === "data") {
      const dt = doc.dataTracks.find((d) => d.name === it.data);
      if (!dt) continue;
      dt.keyframes = dt.keyframes.filter((k) => !sameSec(k.sec, kf.sec));
      dt.keyframes.push(kf);
      dt.keyframes.sort((a, b) => a.sec - b.sec);
    } else {
      const g = retarget || doc.groups.find((x) => x.name === it.group);
      if (!g || !TD[it.key]) continue;
      const tr = ensureTrack(g, it.key);
      tr.keyframes = tr.keyframes.filter((k) => !sameSec(k.sec, kf.sec));
      tr.keyframes.push(kf);
      sortTrack(tr);
    }
    ids.push(kf.id);
  }
  return ids;
}
let current = null;
const setEditorVM = vm => { current = vm; };
const getEditorVM = () => current;
const spriteTargets = (ed) => ed.ext.runtime.targets.filter((t) => t.isOriginal && !t.isStage && t.sprite);
const _blobUrls = new WeakMap();
function costumeUrl(c) {
  try {
    const a = c && c.asset;
    if (!a) return "";
    let u = _blobUrls.get(a);
    if (!u) _blobUrls.set(a, (u = URL.createObjectURL(new Blob([a.data], { type: a.assetType.contentType }))));
    return u;
  } catch { return ""; }
}
function spriteThumb(t) {
  try { return costumeUrl(t.getCostumes()[t.currentCostume]); } catch { return ""; }
}
async function pickSpriteThenCostume(ed, { title = "Add part", allowAll = true } = {}) {
  const st = ed.st;
  const sources = [];
  if (st.target) sources.push({ spriteName: THIS_SPRITE, targetId: "", target: st.target, label: "This sprite", sub: st.target.sprite.name, selected: true });
  for (const t of spriteTargets(ed)) {
    const n = t.sprite.costumes.length;
    sources.push({ spriteName: t.sprite.name, targetId: t.id, target: t, label: t.sprite.name, sub: `${n} costume${n === 1 ? "" : "s"}` });
  }
  const sprites = sources.map((src) => ({
    label: src.label,
    sub: src.sub,
    selected: !!src.selected,
    img: spriteThumb(src.target),
    costumes: src.target.sprite.costumes.map((c) => ({ name: c.name, img: costumeUrl(c) })),
  }));
  const pick = await openAnimationDialog("addPart", { sprites, title, allowAll });
  if (!pick) return null;
  const src = sources[pick.sprite];
  if (!src) return null;
  const out = { spriteName: src.spriteName, targetId: src.targetId, target: src.target };
  if (pick.all) return { ...out, all: true };
  const c = src.target.sprite.costumes[pick.costume];
  return c ? { ...out, costume: { name: c.name, index: pick.costume } } : null;
}
async function addPartDialog(ed) {
  const st = ed.st;
  const pick = await pickSpriteThenCostume(ed);
  if (!pick) return;
  const sprite = pick.target.sprite;
  st.mutate(pick.all ? "Add parts" : "Add part", (doc) => {
    const added = [];
    const list = pick.all ? sprite.costumes.map((c, i) => ({ name: c.name, index: i })) : [pick.costume];
    for (const cos of list) {
      const g = addGroup(doc, { name: cos.name, spriteName: pick.spriteName, targetId: pick.targetId, costume: cos });
      added.push(g.name);
    }
    st.selGroups = new Set(added);
    st.primary = added[added.length - 1];
  });
  st.invalidateBindings();
  st.emit("sel");
}
async function changeSpriteDialog(ed, g) {
  const st = ed.st;
  const opts = [];
  if (st.target) opts.push({ value: "__this__", label: "This sprite", sub: st.target.sprite.name, img: spriteThumb(st.target), special: g.spriteName === THIS_SPRITE });
  for (const t of spriteTargets(ed)) opts.push({ value: t.id, label: t.sprite.name, sub: `${t.sprite.costumes.length} costumes`, img: spriteThumb(t), special: g.targetId === t.id && g.spriteName !== THIS_SPRITE });
  const id = await chooseDialog(`Costumes for "${g.name}"`, opts, { hint: "Costume keys are matched by costume name, so sprites with the same costume names swap cleanly." });
  if (!id) return;
  st.mutate("Change costume source", () => {
    if (id === "__this__") { g.spriteName = THIS_SPRITE; g.targetId = ""; } else { const t = ed.ext.runtime.getTargetById(id); g.spriteName = t.sprite.name; g.targetId = t.id; }
  });
  st.invalidateBindings();
}
async function addImagesAsParts(ed, files, ax = 0, ay = 0) {
  const st = ed.st;
  const vm = getEditorVM();
  let target = st.target;
  if (!target) {
    const opts = spriteTargets(ed).map((t) => ({ value: t.id, label: t.sprite.name, img: spriteThumb(t) }));
    const id = await chooseDialog("Add images to which sprite?", opts);
    if (!id) return;
    target = ed.ext.runtime.getTargetById(id);
  }
  const storage = vm.runtime.storage;
  const prev = target.currentCostume;
  const taken = new Set(target.sprite.costumes.map((c) => c.name));
  const made = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const isSvg = /svg/.test(f.type) || /\.svg$/i.test(f.name);
    let fmt = isSvg ? "svg" : /jpe?g/.test(f.type) || /\.jpe?g$/i.test(f.name) ? "jpg" : "png";
    let data = bytes;
    let rc = [0, 0];
    let res = isSvg ? 1 : 2;
    if (!isSvg && fmt !== "png" && fmt !== "jpg") fmt = "png";
    if (!isSvg && !/png|jpe?g/.test(f.type)) {
      const bmp = await createImageBitmap(new Blob([bytes], { type: f.type }));
      const cv = document.createElement("canvas");
      cv.width = bmp.width;
      cv.height = bmp.height;
      cv.getContext("2d").drawImage(bmp, 0, 0);
      data = new Uint8Array(await (await new Promise((r) => cv.toBlob(r, "image/png"))).arrayBuffer());
      fmt = "png";
    }
    if (isSvg) {
      const m = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(new TextDecoder().decode(bytes));
      const w = /<svg[^>]*\swidth="([\d.]+)/.exec(new TextDecoder().decode(bytes));
      const hh = /<svg[^>]*\sheight="([\d.]+)/.exec(new TextDecoder().decode(bytes));
      const W = +(w && w[1]) || (m ? +m[1] : 100), H = +(hh && hh[1]) || (m ? +m[2] : 100);
      rc = [W / 2, H / 2];
    } else {
      const bmp = await createImageBitmap(new Blob([data], { type: fmt === "jpg" ? "image/jpeg" : "image/png" }));
      rc = [bmp.width / 2, bmp.height / 2];
    }
    const asset = storage.createAsset(isSvg ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap, isSvg ? storage.DataFormat.SVG : fmt === "jpg" ? storage.DataFormat.JPG : storage.DataFormat.PNG, data, null, true);
    const name = uniqueName(f.name.replace(/\.[^.]+$/, "") || "image", taken);
    taken.add(name);
    const costume = { name, dataFormat: fmt, asset, assetId: asset.assetId, md5: `${asset.assetId}.${fmt}`, rotationCenterX: rc[0], rotationCenterY: rc[1], bitmapResolution: res, skinId: null };
    await vm.addCostume(costume.md5, costume, target.id);
    made.push(name);
  }
  try { target.setCostume(prev); } catch {}
  st.invalidateBindings();
  const binding = bindingForSprite(target.sprite);
  const useThis = target === st.target;
  st.mutate(made.length > 1 ? "Add image parts" : "Add image part", (doc) => {
    const names = [];
    made.forEach((cn, i) => {
      const g = addGroup(doc, { name: cn, spriteName: useThis ? THIS_SPRITE : target.sprite.name, targetId: useThis ? "" : target.id, costume: { name: cn, index: binding.byName.get(cn) ?? 0 } });
      setKey(g, "x", 0, Math.round(ax + i * 20));
      setKey(g, "y", 0, Math.round(ay - i * 20));
      names.push(g.name);
    });
    st.selGroups = new Set(names);
    st.primary = names[names.length - 1];
  });
  toast(`Added ${made.length} image${made.length === 1 ? "" : "s"} to "${target.sprite.name}"`);
}
function pickSoundDialog(ed) {
  const sounds = [];
  const current = ed.st.target?.sprite?.name;
  for (const t of ed.ext.runtime.targets.filter((x) => x.isOriginal && x.sprite)) {
    for (const snd of t.sprite.sounds) {
      sounds.push({
        sprite: t.sprite.name,
        sound: snd.name,
        where: t.isStage ? "Stage" : t.sprite.name,
        duration: snd.rate ? snd.sampleCount / snd.rate : 0,
        url: () => {
          try { return snd.asset.encodeDataURI(); } catch { return ""; }
        },
        isThisSprite: !t.isStage && t.sprite.name === current,
      });
    }
  }
  return openAnimationDialog("sound", { sounds }).then((p) =>
    p ? { sprite: p.sprite, sound: p.sound } : null
  );
}
function settingsDialog(ed, { prefs, savePrefs, resetPrefs }) {
  const fields = [
    { key: "confirmDelete", type: "switch", label: "Confirm before deleting keys", hint: "Ask before deleting more than one keyframe." },
    { key: "kfSnap", type: "switch", label: "Snap to keyframes", hint: "The playhead and dragged keys snap to other keys." },
    { key: "previewQuality", type: "select", label: "Preview quality", hint: "Resolution of the preview while editing.", options: [{ value: "auto", label: "Auto" }, { value: "low", label: "Low (fastest)" }, { value: "high", label: "High (sharp)" }] },
    { key: "rotFollow", type: "switch", label: "Rotation handle follows the mouse", hint: "Move just outside any edge of a part and the handle slides there, so you can turn it from any side." },
    { key: "rotReach", type: "number", label: "Rotation grab distance", hint: "How far outside the part the handle follows the mouse. Larger is easier to grab.", min: 12, max: 80, step: 1, precision: 0, unit: "px" },
    { key: "rotStart", type: "number", label: "Rotation handle start distance", hint: "How far outside an edge the mouse must be before the handle starts moving toward it.", min: 0, max: 40, step: 1, precision: 0, unit: "px" },
    { key: "scrollSpeed", type: "number", label: "Timeline scroll speed", min: 0.1, max: 5, step: 0.05 },
    { key: "zoomSpeed", type: "number", label: "Timeline zoom speed", min: 0.1, max: 5, step: 0.05 },
  ];
  return openAnimationDialog("settings", {
    title: "Animation settings",
    extra: [
      { label: "Project settings", onClick: () => window.dimodOpenProjectSettings && window.dimodOpenProjectSettings() },
      { label: "Onion skin", onClick: () => ed.onionDialog() },
      { label: "Shortcuts", onClick: () => ed.shortcutsDialog() },
    ],
    fields,
    values: () => prefs,
    onChange: (key, value) => {
      prefs[key] = value;
      if (key === "kfSnap") ed.st.view.snapToKeys = value;
      savePrefs();
      ed.invalidate("all");
    },
    onReset: () => {
      resetPrefs();
      ed.st.view.snapToKeys = prefs.kfSnap;
      toast("Preferences reset");
      ed.invalidate("all");
    },
  });
}
function viewPref(key, def) {
  try { const v = JSON.parse(localStorage.getItem("dimod:anim-" + key)); return typeof v === typeof def ? v : def; } catch (e) { return def; }
}
function onionDialog(ed) {
  const v = ed.st.view;
  const fields = [
    { key: "onion", type: "switch", label: "Show onion skin" },
    { key: "onionPrev", type: "number", label: "Previous frames", min: 0, max: 8, step: 1, precision: 0 },
    { key: "onionNext", type: "number", label: "Next frames", min: 0, max: 8, step: 1, precision: 0 },
    { key: "onionOpacity", type: "number", label: "Opacity", min: 5, max: 100, step: 1, precision: 0, unit: "%" },
    { key: "onionStep", type: "number", label: "Opacity step", min: 0, max: 50, step: 1, precision: 0, unit: "%" },
    { key: "onionMode", type: "select", label: "Mode", options: [{ value: "merge", label: "Merge images" }, { value: "tint", label: "Color tint" }] },
    { key: "onionLayer", type: "select", label: "Layering", options: [{ value: "front", label: "Front" }, { value: "behind", label: "Behind" }] },
    { key: "onionBefore", type: "color", label: "Previous tint" },
    { key: "onionAfter", type: "color", label: "Next tint" },
  ];
  return openAnimationDialog("settings", {
    title: "Onion skin",
    fields,
    values: () => ({ ...v, onionOpacity: Math.round(v.onionOpacity * 100), onionStep: Math.round(v.onionStep * 100) }),
    onChange: (key, value) => {
      if (key === "onionOpacity" || key === "onionStep") v[key] = value / 100;
      else if (key === "onionPrev" || key === "onionNext") v[key] = Math.round(value);
      else v[key] = value;
      ed.invalidate("view");
      ed.st.emit("ui");
    },
  });
}
function shortcutsDialog() {
  const list = [
    ["Space", "Play / pause"],
    ["← / →", "Previous / next frame"],
    ["Shift+← / Shift+→, Home / End", "Start / end"],
    ["J / K", "Previous / next keyframe"],
    ["I", "Key the selected part's transform"],
    ["L", "Toggle loop"],
    ["O", "Toggle onion skin"],
    ["E", "Toggle expressions (editor only)"],
    ["F / Shift+F", "Fit preview / fit timeline"],
    ["1 / 2", "Dope sheet / graph editor"],
    ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo (your own edits... collaborators' stay)"],
    ["Ctrl+C / X / V", "Copy / cut / paste keys (paste at playhead)"],
    ["Ctrl+D", "Duplicate keys (or the selected part)"],
    ["Ctrl+A", "Select all keys"],
    ["Delete", "Delete keys (or parts)"],
    ["Esc", "Deselect"],
    ["Preview: drag", "Move · corner = scale · Shift = free scale / 15° snap / axis lock · Alt+corner = scale from pivot · Ctrl+edge = skew · Alt+center dot = move pivot"],
    ["Preview: wheel / middle-drag", "Zoom / pan"],
    ["Timeline: drag keys", "Move (Alt = duplicate) · drag empty = box select · double-click = add key"],
    ["Timeline: selection bracket", "Drag its ends (in the ruler) to scale keys in time"],
    ["Graph: handles", "Drag to shape the curve (converts the segment to a Bezier ease)"],
  ];
  return openAnimationDialog("shortcuts", { list });
}
const dialogs = {
  __proto__: null,
  addImagesAsParts,
  addPartDialog,
  changeSpriteDialog,
  onionDialog,
  pickSoundDialog,
  settingsDialog,
  shortcutsDialog
};
const KEY$1 = "ks5_prefs_v1";
const DEFAULTS = {
  loop: true,
  kfSnap: false,
  confirmDelete: false,
  dragMovesSelection: true,
  scrollSpeed: 1,
  zoomSpeed: 1,
  autoKey: true,
  outlinerWidth: 230,
  inspectorWidth: 290,
  timelineHeight: 300,
  labelsWidth: 220,
  previewQuality: "auto",
  rotFollow: true,
  rotReach: 30,
  rotStart: 5,
};
const prefs = { ...DEFAULTS };
try {
  const old = JSON.parse(localStorage.getItem("ks4_prefs_v1") || "{}");
  if (typeof old.loopEnabled === "boolean") prefs.loop = old.loopEnabled;
  if (typeof old.kfSnapEnabled === "boolean") prefs.kfSnap = old.kfSnapEnabled;
  if (typeof old.confirmDelete === "boolean") prefs.confirmDelete = old.confirmDelete;
  if (typeof old.scrollSpeed === "number") prefs.scrollSpeed = old.scrollSpeed;
  if (typeof old.zoomSpeed === "number") prefs.zoomSpeed = old.zoomSpeed;
} catch {}
try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY$1) || "{}")); } catch {}
function savePrefs() {
  try { localStorage.setItem(KEY$1, JSON.stringify(prefs)); } catch {}
}
function resetPrefs() { Object.assign(prefs, DEFAULTS); savePrefs(); }
const HISTORY_MAX = 150;
const REMOTE_LOG_MAX = 5000;
class EditorState {
  constructor(ext, doc, target, sprite = null) {
    this.ext = ext;
    this.runtime = ext.runtime;
    this.target = target || null;
    this.sprite = sprite || (target && target.sprite) || null;
    this.doc = normalizeAnim(deepClone(doc));
    this.savedSnapshot = serializeAnim(this.doc);
    this.docVersion = 1;
    this._compiled = null;
    this._compiledVersion = 0;
    this.pose = new PoseSet(0);
    this._poseKey = "";
    this.data = {};
    this.sec = 0;
    this.playing = false;
    this.loop = prefs.loop;
    this.rate = prefs.playbackRate > 0 ? prefs.playbackRate : 1;
    this.recording = false;
    this.overrides = true;
    this.selGroups = new Set();
    this.primary = null;
    this.selKeys = new Set();
    this.selTrack = null;
    this.view = {
      tlMode: "dope",
      tlZoom: 1,
      tlPan: 0,
      tlScroll: 0,
      pvZoom: 1,
      pvPanX: 0,
      pvPanY: 0,
      pvFit: true,
      grid: false,
      snap: true,
      gridSize: 16,
      drawColor: "#000000",
      drawFill: false,
      drawFillColor: "#6c5ce7",
      drawWidth: 4,
      objSnap: viewPref("objSnap", false),
      snapEdges: viewPref("snapEdges", true),
      snapCenters: viewPref("snapCenters", true),
      snapStage: viewPref("snapStage", true),
      snapDist: viewPref("snapDist", 8),
      snapColor: viewPref("snapColor", "#ff00aa"),
      onion: false,
      onionPrev: 1,
      onionNext: 0,
      onionOpacity: 0.25,
      onionStep: 0.1,
      onionMode: "merge",
      onionLayer: "front",
      onionBefore: 0xff5555,
      onionAfter: 0x5599ff,
      motionPath: true,
      checker: 0,
      snapToKeys: prefs.kfSnap,
      tool: "select",
      showBounds: true,
      noExprs: false,
    };
    this.undoStack = [];
    this.redoStack = [];
    this.remoteSeq = 0;
    this.remoteLog = [];
    this._pendingSnapshot = null;
    this.listeners = new Map();
    this.index = new Map();
    this.reindex();
  }
  on(ch, fn) {
    if (!this.listeners.has(ch)) this.listeners.set(ch, new Set());
    this.listeners.get(ch).add(fn);
    return () => this.listeners.get(ch).delete(fn);
  }
  emit(ch, arg) {
    const set = this.listeners.get(ch);
    if (set) for (const fn of set) fn(arg);
  }
  get compiled() {
    const noExpr = !!this.view.noExprs;
    if (!this._compiled || this._compiledVersion !== this.docVersion || this._compiledNoExpr !== noExpr) {
      this._compiled = new CompiledAnim(this.doc, noExpr ? { noExpr } : null);
      this._compiledVersion = this.docVersion;
      this._compiledNoExpr = noExpr;
    }
    return this._compiled;
  }
  get dirty() { return serializeAnim(this.doc) !== this.savedSnapshot; }
  group(name) { return this.doc.groups.find((g) => g.name === name) || null; }
  groupIndex(name) { return this.doc.groups.findIndex((g) => g.name === name); }
  get primaryGroup() { return this.primary ? this.group(this.primary) : null; }
  touch(what = "doc") {
    this.docVersion++;
    this._poseKey = "";
    this.reindex();
    this.emit("doc", what);
  }
  mutate(label, fn, what = "doc") {
    this.beginChange(label);
    try { fn(this.doc); } finally { this.endChange(what); }
  }
  beginChange(label) {
    if (this._pendingSnapshot) return;
    this._pendingSnapshot = { label, snap: serializeAnim(this.doc), sel: this.selectionSnapshot(), seq: this.remoteSeq };
  }
  endChange(what = "doc") {
    const p = this._pendingSnapshot;
    this._pendingSnapshot = null;
    if (p) {
      const now = serializeAnim(this.doc);
      if (now !== p.snap) {
        this.undoStack.push(p);
        if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
        this.redoStack.length = 0;
      }
    }
    this.touch(what);
  }
  live(fn, what = "doc") { fn(this.doc); this.touch(what); }
  undo() {
    const p = this.undoStack.pop();
    if (!p) return false;
    this.redoStack.push({ label: p.label, snap: serializeAnim(this.doc), sel: this.selectionSnapshot(), seq: this.remoteSeq });
    this.restore(p);
    return p.label;
  }
  redo() {
    const p = this.redoStack.pop();
    if (!p) return false;
    this.undoStack.push({ label: p.label, snap: serializeAnim(this.doc), sel: this.selectionSnapshot(), seq: this.remoteSeq });
    this.restore(p);
    return p.label;
  }
  restore(p) {
    const id = this.doc.id;
    const doc = JSON.parse(p.snap);
    const first = this.remoteLog.length ? this.remoteLog[0].seq : this.remoteSeq + 1;
    for (let i = Math.max(0, (p.seq || 0) + 1 - first); i < this.remoteLog.length; i++) apply(doc, this.remoteLog[i].ops);
    this.doc = normalizeAnim(doc);
    this.doc.id = id;
    if (p.sel) this.restoreSelection(p.sel);
    this.touch("history");
    this.emit("sel");
  }
  selectionSnapshot() {
    return { groups: [...this.selGroups], primary: this.primary, keys: [...this.selKeys], track: this.selTrack };
  }
  restoreSelection(s) {
    this.selGroups = new Set(s.groups.filter((n) => this.group(n)));
    this.primary = s.primary && this.group(s.primary) ? s.primary : null;
    this.selKeys = new Set(s.keys);
    this.selTrack = s.track && this.group(s.track.group) ? s.track : null;
  }
  applyRemote(ops) {
    if (!apply(this.doc, ops)) return false;
    this.remoteSeq++;
    this.remoteLog.push({ seq: this.remoteSeq, ops });
    if (this.remoteLog.length > REMOTE_LOG_MAX) this.remoteLog.splice(0, this.remoteLog.length - REMOTE_LOG_MAX);
    this.touch("remote");
    this.emit("sel");
    return true;
  }
  replaceRemote(doc) {
    const id = this.doc.id;
    this.doc = normalizeAnim(JSON.parse(JSON.stringify(doc)));
    this.doc.id = id;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.remoteLog.length = 0;
    this.touch("remote");
    this.emit("sel");
  }
  markSaved() { this.savedSnapshot = serializeAnim(this.doc); this.emit("saved"); }
  reindex() {
    const idx = this.index;
    idx.clear();
    for (const g of this.doc.groups) {
      for (const [key, tr] of Object.entries(g.tracks)) for (const kf of tr.keyframes) idx.set(kf.id, { kind: "track", group: g, key, kf, track: tr });
    }
    for (const ev of this.doc.events) idx.set(ev.id, { kind: "event", kf: ev });
    for (const dt of this.doc.dataTracks) for (const kf of dt.keyframes) idx.set(kf.id, { kind: "data", data: dt, kf, track: dt });
    for (const id of [...this.selKeys]) if (!idx.has(id)) this.selKeys.delete(id);
    if (this.primary && !this.group(this.primary)) this.primary = null;
    for (const n of [...this.selGroups]) if (!this.group(n)) this.selGroups.delete(n);
  }
  selectGroup(name, additive = false) {
    if (!additive) this.selGroups.clear();
    if (name) {
      if (additive && this.selGroups.has(name)) {
        this.selGroups.delete(name);
        if (this.primary === name) this.primary = [...this.selGroups][0] || null;
      } else { this.selGroups.add(name); this.primary = name; }
    } else this.primary = null;
    if (!additive) this.selTrack = null;
    this.emit("sel");
  }
  selectKeys(ids, additive = false) {
    if (!additive) this.selKeys.clear();
    for (const id of ids) this.selKeys.add(id);
    this.emit("sel");
  }
  toggleKey(id) {
    if (this.selKeys.has(id)) this.selKeys.delete(id);
    else this.selKeys.add(id);
    this.emit("sel");
  }
  clearKeys() {
    if (!this.selKeys.size) return;
    this.selKeys.clear();
    this.emit("sel");
  }
  selectedKeyInfos() {
    const out = [];
    for (const id of this.selKeys) {
      const i = this.index.get(id);
      if (i) out.push(i);
    }
    return out;
  }
  get maxSec() { return this.doc.infinite ? Infinity : this.doc.duration; }
  setTime(sec, { snap = false } = {}) {
    if (!Number.isFinite(sec)) sec = 0;
    if (snap) sec = this.snap(sec);
    sec = this.doc.infinite ? Math.max(0, sec) : clamp(sec, 0, this.doc.duration);
    if (sec === this.sec) return;
    this.sec = sec;
    this.emit("time");
  }
  frameStep() {
    const d = this.doc;
    if (d.musicMode) return 60 / d.bpm / (d.snapDiv || 1);
    return 1 / d.fps;
  }
  snap(sec) {
    const d = this.doc;
    if (d.musicMode) { const step = 60 / d.bpm / (d.snapDiv || 1); return Math.round(Math.round(sec / step) * step * 1e6) / 1e6; }
    const sf = d.snapFrames || 1;
    const step = sf / d.fps;
    const out = Math.round(sec / step) * step;
    return Math.round(out * 1e6) / 1e6;
  }
  bindings() { return bindingsFor(this.runtime, this.compiled, this.target, this.sprite); }
  dataAt(sec) {
    const c = this.compiled;
    const base = this.ext.store.stateFor(this.doc.id).data;
    return c.hasDataTracks ? c.fillData(sec, base, (this._data ||= {})) : base;
  }
  poseAt(sec, out = null) {
    setOverridesEnabled(this.overrides);
    const c = this.compiled;
    return c.evaluate(sec, out || new PoseSet(0), this.dataAt(sec), Date.now() / 1000, this.bindings(), null);
  }
  currentPose() {
    const key = this.docVersion + "|" + this.sec + "|" + this.overrides + "|" + !!this.view.noExprs;
    if (key !== this._poseKey || this.compiled.dynamic) { this.poseAt(this.sec, this.pose); this._poseKey = key; }
    return this.pose;
  }
  valueAt(groupName, key, sec = this.sec) {
    const gi = this.groupIndex(groupName);
    if (gi < 0) return 0;
    const pose = sec === this.sec ? this.currentPose() : this.poseAt(sec);
    if (key in SLOT) return pose.get(gi, key);
    return null;
  }
  spriteForGroup(g) {
    if (g.spriteName === THIS_SPRITE) return this.sprite;
    return this.bindings()[this.groupIndex(g.name)]?.sprite || null;
  }
  invalidateBindings() { bumpBindingEpoch(); this._poseKey = ""; }
}
class OffscreenView {
  constructor(renderer) {
    this.renderer = renderer;
    this.pipe = GpuPipeline.for(renderer);
    this.surface = this.pipe ? new Surface(this.pipe) : null;
    this.pixels = null;
    this.image = null;
  }
  get ok() { return !!this.pipe; }
  render(W, H, scale, passes, opts = {}) {
    if (!this.pipe) return null;
    this.surface.ensure(W, H, scale);
    let first = true;
    for (const p of passes) {
      renderPose(this.pipe, this.surface, p.compiled, p.pose, {
        renderer: this.renderer,
        bindings: p.bindings,
        aa: opts.aa !== false,
        alpha: p.alpha ?? 1,
        clear: first,
        fps: opts.fps,
        poseAt: p.poseAt || null,
        texScale: opts.texScale || 1,
        cx: opts.cx || 0,
        cy: opts.cy || 0,
        tint: p.tint || null,
      });
      first = false;
    }
    if (first) { this.pipe.begin(); this.pipe.clear(this.surface.target); }
    return this.surface;
  }
  readImageData() {
    const pipe = this.pipe;
    const src = this.surface.target;
    const gl = pipe.gl;
    const w = src.w, h = src.h;
    pipe.begin();
    const tmp = pipe.temp(w, h);
    const p = pipe.program("unpremult", FULL_VS, UNPREMULT_FS);
    pipe.bind(tmp);
    pipe.use(p);
    pipe.bindTex(0, src.tex, false);
    pipe.twgl.setUniforms(p, { u_src: src.tex });
    gl.disable(gl.BLEND);
    pipe.drawQuad();
    gl.enable(gl.BLEND);
    if (!this.pixels || this.pixels.length !== w * h * 4) {
      this.pixels = new Uint8Array(w * h * 4);
      this.image = new ImageData(w, h);
    }
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    pipe.release(tmp);
    this.renderer._doExitDrawRegion();
    this.image.data.set(this.pixels);
    return this.image;
  }
  toCanvas(canvas) {
    const img = this.readImageData();
    canvas ||= document.createElement("canvas");
    if (canvas.width !== img.width || canvas.height !== img.height) { canvas.width = img.width; canvas.height = img.height; }
    canvas.getContext("2d").putImageData(img, 0, 0);
    return canvas;
  }
  dispose() {
    if (this.surface) this.surface.dispose();
  }
}
const HANDLE = 5;
const ROT_DIST = 26;
const quadSig = q => (q[0][0] + (2 * q[0][1])) + (3 * q[1][0]) + (4 * q[1][1]);
const ink = (ctx, w = 2) => { const s = ctx.strokeStyle, l = ctx.lineWidth; ctx.strokeStyle = "#000"; ctx.lineWidth = l + w; ctx.stroke(); ctx.strokeStyle = s; ctx.lineWidth = l; };
const ROT_GLYPH = new Path2D('M19.28,1.09C19.28.28,19,0,18.2,0c-1.67,0-3.34,0-5,0-.34,0-.88.24-1,.47a1.4,1.4,0,0,0,.36,1.08,15.27,15.27,0,0,0,1.46,1.36A6.4,6.4,0,0,1,6.52,4,5.85,5.85,0,0,1,5.24,3,15.27,15.27,0,0,0,6.7,1.61,1.4,1.4,0,0,0,7.06.54C7,.3,6.44.07,6.1.06c-1.67,0-3.34,0-5,0C.28,0,0,.31,0,1.12c0,1.67,0,3.34,0,5a1.23,1.23,0,0,0,.49,1,1.22,1.22,0,0,0,1-.31A14.38,14.38,0,0,0,2.84,5.26l.73.62a9.45,9.45,0,0,0,7.34,2,9.45,9.45,0,0,0,4.82-2.05l.73-.62a14.38,14.38,0,0,0,1.29,1.51,1.22,1.22,0,0,0,1,.31,1.23,1.23,0,0,0,.49-1C19.31,4.43,19.29,2.76,19.28,1.09Z');
class Viewport {
  constructor(ed) {
    this.ed = ed;
    this.st = ed.st;
    this.view = new OffscreenView(ed.ext.runtime.renderer);
    this.glCanvas = h("canvas");
    this.overlay = h("canvas");
    this.area = h("div", { class: "k5-view-area k5-checker", tabindex: "0" }, this.glCanvas, this.overlay, h("div", { class: "k5-rec-badge" }, "● REC"), h("div", { class: "k5-drop-hint" }, "Drop images or animation files"));
    const st = this.st;
    this.el = h("div", { class: "k5-pane k5-viewport" }, this.area);
    this.drag = null;
    this.hover = null;
    this.cmds = [];
    this.pickCtx = null;
    this.onionPoses = [];
    this._sizeKey = "";
    this.bindEvents();
    const syncBg = () => { this.applyBg(); this.st.emit("ui"); };
    this.applyBg();
    window.addEventListener("dimod-canvas-theme", syncBg);
    window.addEventListener("dimod-editor-theme", syncBg);
    new ResizeObserver(() => {
      if (st.view.pvFit) this.fit(true);
      this.ed.invalidate("view");
    }).observe(this.area);
  }
  toggle(k) { this.st.view[k] = !this.st.view[k]; this.ed.invalidate("view"); this.st.emit("ui"); }
  applyBg() {
    let pref = "default";
    try { pref = localStorage.getItem("dimod:canvas-theme") || "default"; } catch (e) {}
    const themeDark = document.body.getAttribute("theme") === "dark";
    const wantDark = pref === "dark" || pref === "light" ? pref === "dark" : themeDark;
    this.st.view.checker = wantDark === themeDark ? 0 : 1;
    this.area.classList.toggle("k5-force-dark", this.st.view.checker === 1 && wantDark);
    this.area.classList.toggle("k5-force-light", this.st.view.checker === 1 && !wantDark);
  }
  cycleBg() {
    const themeDark = document.body.getAttribute("theme") === "dark";
    const wantDark = this.st.view.checker === 0 ? !themeDark : themeDark;
    try {
      localStorage.setItem("dimod:canvas-theme", wantDark === themeDark ? "default" : wantDark ? "dark" : "light");
    } catch (e) {}
    window.dispatchEvent(new Event("dimod-canvas-theme"));
  }
  get areaW() { return this.area.clientWidth || 1; }
  get areaH() { return this.area.clientHeight || 1; }
  fit(silent) {
    const st = this.st;
    const v = st.view;
    let b = null;
    try { b = poseBounds(this.ed.ext.runtime.renderer, st.compiled, st.currentPose(), st.bindings()); } catch {}
    if (!b) b = { minX: -240, minY: -180, maxX: 240, maxY: 180 };
    const w = Math.max(40, b.maxX - b.minX), hh = Math.max(40, b.maxY - b.minY);
    const z = Math.min((this.areaW - 64) / w, (this.areaH - 64) / hh, 2);
    v.pvZoom = Math.max(0.05, Math.min(8, z || 1));
    v.pvPanX = -((b.minX + b.maxX) / 2) * v.pvZoom;
    v.pvPanY = ((b.minY + b.maxY) / 2) * v.pvZoom;
    v.pvFit = true;
    if (!silent) this.ed.invalidate("view");
  }
  zoomBy(k, cx = this.areaW / 2, cy = this.areaH / 2) {
    const v = this.st.view;
    const nz = Math.max(0.05, Math.min(16, v.pvZoom * k));
    const f = nz / v.pvZoom;
    const ox = cx - this.areaW / 2, oy = cy - this.areaH / 2;
    v.pvPanX = ox - (ox - v.pvPanX) * f;
    v.pvPanY = oy - (oy - v.pvPanY) * f;
    v.pvZoom = nz;
    v.pvFit = false;
    this.ed.invalidate("view");
  }
  toScreen(X, Y) {
    const d = this.st.doc, v = this.st.view;
    return [this.areaW / 2 + v.pvPanX + (X - d.width / 2) * v.pvZoom, this.areaH / 2 + v.pvPanY + (Y - d.height / 2) * v.pvZoom];
  }
  fromScreen(sx, sy) {
    const d = this.st.doc, v = this.st.view;
    return [(sx - this.areaW / 2 - v.pvPanX) / v.pvZoom + d.width / 2, (sy - this.areaH / 2 - v.pvPanY) / v.pvZoom + d.height / 2];
  }
  animToScreen(x, y) { const d = this.st.doc; return this.toScreen(d.width / 2 + x, d.height / 2 - y); }
  screenToAnim(sx, sy) {
    const d = this.st.doc;
    const [X, Y] = this.fromScreen(sx, sy);
    return [X - d.width / 2, d.height / 2 - Y];
  }
  pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    const q = this.ed.prefs.previewQuality;
    if (q === "low") return 0.75;
    if (q === "high") return Math.min(2, dpr);
    return this.st.playing ? Math.min(1, dpr) : Math.min(1.5, dpr);
  }
  draw() {
    const st = this.st;
    const w = this.areaW, hh = this.areaH;
    const pr = this.pixelRatio();
    const pw = Math.max(1, Math.round(w * pr)), ph = Math.max(1, Math.round(hh * pr));
    const opr = window.devicePixelRatio || 1;
    for (const c of [this.glCanvas, this.overlay]) {
      const cw = c === this.overlay ? Math.max(1, Math.round(w * opr)) : pw, ch = c === this.overlay ? Math.max(1, Math.round(hh * opr)) : ph;
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      c.style.width = w + "px";
      c.style.height = hh + "px";
    }
    const pose = st.currentPose();
    const compiled = st.compiled;
    const bindings = st.bindings();
    if (this.view.ok) {
      const v = st.view;
      const z = v.pvZoom;
      const Wl = w / z, Hl = hh / z;
      const passes = [];
      const ghosts = [];
      if (v.onion) this.onionPasses(ghosts, compiled, bindings);
      if (v.onionLayer !== "front") passes.push(...ghosts);
      passes.push({
        compiled,
        pose,
        bindings,
        poseAt: compiled.anyMotionBlur ? (t, i) => st.poseAt(t, (this.onionPoses["mb" + i] ||= new PoseSet(0))) : null,
      });
      if (v.onionLayer === "front") passes.push(...ghosts);
      this.view.render(Wl, Hl, (z * pr * pw) / (w * pr), passes, { cx: -v.pvPanX / z, cy: v.pvPanY / z, fps: st.doc.fps });
      const img = this.view.readImageData();
      const ctx = this.glCanvas.getContext("2d");
      if (img.width === pw && img.height === ph) ctx.putImageData(img, 0, 0);
      else {
        ctx.clearRect(0, 0, pw, ph);
        const tmp = (this._tmp ||= document.createElement("canvas"));
        tmp.width = img.width;
        tmp.height = img.height;
        tmp.getContext("2d").putImageData(img, 0, 0);
        ctx.drawImage(tmp, 0, 0, pw, ph);
      }
    }
    this.buildCmds(pose, compiled, bindings);
    this.drawOverlay(pr);
    this.el.classList.toggle("k5-recording", !!(st.recording && st.playing));
  }
  onionPasses(passes, compiled, bindings) {
    const st = this.st;
    const v = st.view;
    const step = st.frameStep() * Math.max(1, Math.round(1 / (st.frameStep() * st.doc.fps) || 1));
    const lift = (c) => {
      const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      if (l >= 0.35) return c;
      const t = (0.35 - l) / (1 - l);
      return c.map((x) => x + (1 - x) * t);
    };
    const tint = v.onionMode === "tint";
    const before = tint ? lift(intToRGB(v.onionBefore)) : undefined, after = tint ? lift(intToRGB(v.onionAfter)) : undefined;
    const alphaAt = (k) => Math.max(0, v.onionOpacity - v.onionStep * (k - 1));
    for (let k = Math.max(v.onionPrev, v.onionNext); k >= 1; k--) {
      const a = alphaAt(k);
      if (a <= 0) continue;
      const tb = st.sec - k * step * 2;
      const ta = st.sec + k * step * 2;
      if (k <= v.onionPrev && tb >= 0) passes.push({ compiled, pose: st.poseAt(tb, (this.onionPoses["b" + k] ||= new PoseSet(0))), bindings, alpha: a, tint: before });
      if (k <= v.onionNext && ta <= st.maxSec) passes.push({ compiled, pose: st.poseAt(ta, (this.onionPoses["a" + k] ||= new PoseSet(0))), bindings, alpha: a, tint: after });
    }
  }
  buildCmds(pose, compiled, bindings) {
    const d = this.st.doc;
    const ctx = { renderer: this.ed.ext.runtime.renderer, W: d.width, H: d.height, texScale: 1 };
    this.pickCtx = ctx;
    const n = compiled.groups.length;
    while (this.cmds.length < n) this.cmds.push(newDrawCmd());
    this.valid = new Array(n);
    for (let gi = 0; gi < n; gi++) this.valid[gi] = compiled.isVisible(pose, gi) && !!buildDrawCmd(ctx, compiled, pose, gi, bindings[gi], this.cmds[gi]);
  }
  partQuad(gi) {
    const c = this.cmds[gi];
    const [A, B, C, D, E, F] = c.canvas;
    const px = c.pad / c.boxPx[0], py = c.pad / c.boxPx[1];
    const pt = (gx, gy) => this.toScreen(A * gx + C * gy + E, B * gx + D * gy + F);
    return [pt(px, py), pt(1 - px, py), pt(1 - px, 1 - py), pt(px, 1 - py)];
  }
  handles(gi) {
    const q = this.partQuad(gi);
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const hs = [q[0], q[1], q[2], q[3], mid(q[0], q[1]), mid(q[2], q[3]), mid(q[3], q[0]), mid(q[1], q[2])];
    const top = hs[4], bot = hs[5];
    let ux = top[0] - bot[0], uy = top[1] - bot[1];
    const len = Math.hypot(ux, uy) || 1;
    ux /= len;
    uy /= len;
    let rot = [top[0] + ux * ROT_DIST, top[1] + uy * ROT_DIST];
    let edge = top;
    const f = this.rotAt && this.rotAt.gi === gi && Math.abs(this.rotAt.sig - quadSig(q)) < 0.5 ? this.rotAt : null;
    if (f) { edge = f.edge; rot = [f.edge[0] + f.nx * f.dist, f.edge[1] + f.ny * f.dist]; }
    const c = this.cmds[gi];
    const origin = this.toScreen(c.mat[4], c.mat[5]);
    return { quad: q, hs, rot, origin, top: edge, nx: f ? f.nx : ux, ny: f ? f.ny : uy };
  }
  followRot(gi, x, y) {
    const q = this.partQuad(gi);
    let best = null;
    let sign = 0, inside = true;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const cr = ex * (y - a[1]) - ey * (x - a[0]);
      if (cr !== 0) {
        if (!sign) sign = Math.sign(cr);
        else if (Math.sign(cr) !== sign) inside = false;
      }
      const l2 = ex * ex + ey * ey || 1;
      const u = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l2));
      const px = a[0] + ex * u, py = a[1] + ey * u;
      const d = Math.hypot(x - px, y - py);
      if (!best || d < best.d) best = { d, px, py };
    }
    let next = null;
    const prefs = this.ed.prefs;
    if (prefs.rotFollow && !inside && best.d >= Math.max(1, prefs.rotStart) && best.d <= prefs.rotReach) {
      const cx = (q[0][0] + q[2][0]) / 2, cy = (q[0][1] + q[2][1]) / 2;
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const anchors = [...q, mid(q[0], q[1]), mid(q[1], q[2]), mid(q[2], q[3]), mid(q[3], q[0])];
      let pick = null;
      for (const a of anchors) {
        const d = Math.hypot(a[0] - best.px, a[1] - best.py);
        if (d < 30 && (!pick || d < pick.d)) pick = { a, d };
      }
      if (pick) {
        const len = Math.hypot(pick.a[0] - cx, pick.a[1] - cy) || 1;
        next = { gi, sig: quadSig(q), edge: pick.a, nx: (pick.a[0] - cx) / len, ny: (pick.a[1] - cy) / len, dist: 22 };
      } else next = { gi, sig: quadSig(q), edge: [best.px, best.py], nx: (x - best.px) / best.d, ny: (y - best.py) / best.d, dist: Math.min(30, Math.max(14, best.d)) };
    }
    const prev = this.rotAt;
    const same = (!prev && !next) || (prev && next && Math.hypot(prev.edge[0] - next.edge[0], prev.edge[1] - next.edge[1]) < 1 && Math.abs(prev.nx - next.nx) < 0.02 && Math.abs(prev.ny - next.ny) < 0.02);
    if (next || prev) {
      if (!next || !same) this.rotAt = next;
      if (!same) this.ed.invalidate("overlay");
    }
  }
  drawOverlay() {
    const pr = window.devicePixelRatio || 1;
    const st = this.st;
    const ctx = this.overlay.getContext("2d");
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, this.areaW, this.areaH);
    const d = st.doc;
    const accent = this.ed.accent();
    const text = this.ed.cssVar("--k-text") || "#575e75";
    if (st.view.grid) this.drawGrid(ctx, accent);
    if (st.view.showBounds) {
      ctx.save();
      const [ox, oy] = this.animToScreen(0, 0);
      ctx.strokeStyle = text;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(ox - 8, oy);
      ctx.lineTo(ox + 8, oy);
      ctx.moveTo(ox, oy - 8);
      ctx.lineTo(ox, oy + 8);
      ctx.stroke();
      ctx.restore();
    }
    if (this.ed.particles) this.ed.particles.draw(ctx, this);
    if (st.view.motionPath) for (const name of st.selGroups) this.drawMotionPath(ctx, name, accent);
    const compiled = st.compiled;
    for (const name of st.selGroups) {
      const gi = compiled.byName.get(name);
      if (gi === undefined || !this.valid[gi] || name === st.primary) continue;
      const q = this.partQuad(gi);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ink(ctx);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.hover !== null && this.hover !== undefined && !this.drag) {
      const gi = this.hover;
      if (this.valid[gi] && compiled.groups[gi].name !== st.primary) {
        const q = this.partQuad(gi);
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.beginPath();
        q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        ink(ctx);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    const pg = st.primary !== null ? compiled.byName.get(st.primary) : undefined;
    if (pg !== undefined && this.valid[pg]) {
      const H = this.handles(pg);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      H.quad.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ink(ctx);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(H.top[0], H.top[1]);
      ctx.lineTo(H.rot[0], H.rot[1]);
      ink(ctx);
      ctx.stroke();
      ctx.save();
      ctx.translate(H.rot[0], H.rot[1]);
      ctx.rotate(Math.atan2(H.ny, H.nx) - Math.PI / 2);
      ctx.translate(-9.65, -4);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.stroke(ROT_GLYPH);
      ctx.fillStyle = accent;
      ctx.fill(ROT_GLYPH);
      ctx.restore();
      for (let i = 0; i < 8; i++) {
        const [hx, hy] = H.hs[i];
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      const [px, py] = H.origin;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(px, py, 6.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px - 9, py);
      ctx.lineTo(px - 5, py);
      ctx.moveTo(px + 5, py);
      ctx.lineTo(px + 9, py);
      ctx.moveTo(px, py - 9);
      ctx.lineTo(px, py - 5);
      ctx.moveTo(px, py + 5);
      ctx.lineTo(px, py + 9);
      ink(ctx);
      ctx.stroke();
      if (this.drag) {
        const [bx, by] = [(H.quad[0][0] + H.quad[2][0]) / 2, (H.quad[0][1] + H.quad[2][1]) / 2];
        const snapped = this.drag.type === "pivot" && this.drag.snapped;
        const REALISTIC = "#ffcc00";
        ctx.strokeStyle = REALISTIC;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bx, by - 8);
        ctx.lineTo(bx + 8, by);
        ctx.lineTo(bx, by + 8);
        ctx.lineTo(bx - 8, by);
        ctx.closePath();
        if (snapped) { ctx.fillStyle = REALISTIC; ctx.fill(); }
        ink(ctx);
        ctx.stroke();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px - 14, py);
        ctx.lineTo(px + 14, py);
        ctx.moveTo(px, py - 14);
        ctx.lineTo(px, py + 14);
        ink(ctx);
        ctx.stroke();
      }
    }
    this.drawRemoteSelections(ctx);
    this.drawDrawPreview(ctx);
    const gd = this.drag && this.drag.guides;
    if (gd) {
      ctx.save();
      ctx.strokeStyle = this.st.view.snapColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      if (gd.x != null) { ctx.moveTo(gd.x + 0.5, 0); ctx.lineTo(gd.x + 0.5, this.areaH); }
      if (gd.y != null) { ctx.moveTo(0, gd.y + 0.5); ctx.lineTo(this.areaW, gd.y + 0.5); }
      ctx.stroke();
      ctx.restore();
    }
    if (this.drag && this.drag.info) {
      ctx.font = "bold 11px " + this.ed.font();
      const t = this.drag.info;
      const w = ctx.measureText(t).width + 10;
      const [mx, my] = this.drag.last;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(mx + 11, my + 17, w, 19, 4) : ctx.rect(mx + 11, my + 17, w, 19);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(t, mx + 16, my + 30);
    }
  }
  drawGrid(ctx, accent) {
    const v = this.st.view;
    const w = this.areaW, h = this.areaH, z = v.pvZoom;
    const [x0, y1] = this.screenToAnim(0, 0);
    const [x1, y0] = this.screenToAnim(w, h);
    const line = document.body.getAttribute("theme") === "dark" ? "rgba(255, 255, 255, " : "rgba(40, 40, 80, ";
    ctx.save();
    ctx.lineWidth = 1;
    const lines = (size, alpha) => {
      if (size * z < 4) return;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / size) * size; x <= x1; x += size) {
        const sx = Math.round(this.animToScreen(x, 0)[0]) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
      }
      for (let y = Math.ceil(y0 / size) * size; y <= y1; y += size) {
        const sy = Math.round(this.animToScreen(0, y)[1]) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
      }
      ctx.strokeStyle = line + alpha + ")";
      ctx.stroke();
    };
    lines(v.gridSize, 0.16);
    lines(v.gridSize * 4, 0.28);
    const [ax, ay] = this.animToScreen(0, 0);
    ctx.beginPath();
    ctx.moveTo(Math.round(ax) + 0.5, 0);
    ctx.lineTo(Math.round(ax) + 0.5, h);
    ctx.moveTo(0, Math.round(ay) + 0.5);
    ctx.lineTo(w, Math.round(ay) + 0.5);
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.restore();
  }
  snapParts(gi, q0, s, nx, ny, z, ev) {
    const v = this.st.view;
    this.drag.guides = null;
    if (!v.objSnap || ev.altKey) return [nx, ny];
    const box = q => {
      const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      return { x: [x0, (x0 + x1) / 2, x1], y: [y0, (y0 + y1) / 2, y1] };
    };
    const tx = [], ty = [];
    if (v.snapStage) { const [cx, cy] = this.toScreen(this.st.doc.width / 2, this.st.doc.height / 2); tx.push(cx); ty.push(cy); }
    if (v.snapEdges || v.snapCenters) {
      for (let i = 0; i < (this.valid || []).length; i++) {
        if (i === gi || !this.valid[i]) continue;
        const b = box(this.partQuad(i));
        for (let k = 0; k < 3; k++) {
          if (k === 1 ? !v.snapCenters : !v.snapEdges) continue;
          tx.push(b.x[k]);
          ty.push(b.y[k]);
        }
      }
    }
    const b = box(q0), ox = (nx - s.wx) * z, oy = -(ny - s.wy) * z;
    const best = (from, to, off) => {
      let hit = null;
      for (const f of from) for (const t of to) {
        const d = t - (f + off);
        if (Math.abs(d) <= v.snapDist && (!hit || Math.abs(d) < Math.abs(hit.d))) hit = { d, t };
      }
      return hit;
    };
    const hx = best(b.x, tx, ox), hy = best(b.y, ty, oy);
    if (hx) nx += hx.d / z;
    if (hy) ny -= hy.d / z;
    if (hx || hy) this.drag.guides = { x: hx && hx.t, y: hy && hy.t };
    return [nx, ny];
  }
  startDraw(e, x0, y0) {
    const st = this.st;
    const v = st.view;
    const tool = v.tool;
    const pts = [this.fromScreen(x0, y0)];
    this.drawPreview = { tool, pts, color: v.drawColor, fill: v.drawFill ? v.drawFillColor : "", width: v.drawWidth };
    const move = (ev) => {
      const r = this.area.getBoundingClientRect();
      const p = this.fromScreen(ev.clientX - r.left, ev.clientY - r.top);
      if (tool === "pen" || tool === "eraser") {
        const last = pts[pts.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) * v.pvZoom >= 1.5) pts.push(p);
      } else pts[1] = p;
      this.ed.invalidate("view");
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      const pv = this.drawPreview;
      this.drawPreview = null;
      if (pv && (tool === "eraser" || pts.length > 1)) commitDrawing(this.ed, pv);
      this.ed.invalidate("view");
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }
  drawDrawPreview(ctx) {
    const pv = this.drawPreview;
    if (!pv || pv.tool === "eraser" || pv.pts.length < 2 && pv.tool !== "pen") return;
    const z = this.st.view.pvZoom;
    const P = pv.pts.map(([X, Y]) => this.toScreen(X, Y));
    ctx.save();
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, pv.width * z);
    ctx.strokeStyle = pv.color;
    ctx.fillStyle = pv.fill || "transparent";
    ctx.beginPath();
    if (pv.tool === "pen" || pv.tool === "line") P.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    else if (pv.tool === "rect") ctx.rect(P[0][0], P[0][1], P[1][0] - P[0][0], P[1][1] - P[0][1]);
    else ctx.ellipse((P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2, Math.abs(P[1][0] - P[0][0]) / 2, Math.abs(P[1][1] - P[0][1]) / 2, 0, 0, Math.PI * 2);
    if (pv.fill && pv.tool !== "pen" && pv.tool !== "line") ctx.fill();
    if (pv.width > 0) ctx.stroke();
    ctx.restore();
  }
  snapPoint(nx, ny, ev) {
    const v = this.st.view;
    if (!v.grid || !v.snap || ev.altKey) return [nx, ny];
    return [Math.round(nx / v.gridSize) * v.gridSize, Math.round(ny / v.gridSize) * v.gridSize];
  }
  drawRemoteSelections(ctx) {
    const people = this.ed.remotePeople ? this.ed.remotePeople() : [];
    if (!people.length || !this.valid) return;
    ctx.save();
    ctx.font = "bold 10px " + this.ed.font();
    ctx.textBaseline = "middle";
    ctx.lineWidth = 2;
    for (const p of people) {
      for (const name of p.sel) {
        const gi = this.st.groupIndex(name);
        if (gi < 0 || !this.valid[gi]) continue;
        const q = this.partQuad(gi);
        ctx.strokeStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(q[0][0], q[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1]);
        ctx.closePath();
        ctx.stroke();
        const top = q.reduce((a, b) => (b[1] < a[1] ? b : a));
        const tw = ctx.measureText(p.name).width + 8;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(top[0] - tw / 2, top[1] - 18, tw, 14, 7) : ctx.rect(top[0] - tw / 2, top[1] - 18, tw, 14);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(p.name, top[0] - tw / 2 + 4, top[1] - 11);
      }
    }
    ctx.restore();
  }
  drawMotionPath(ctx, name, accent) {
    const st = this.st;
    const gi = st.compiled.byName.get(name);
    if (gi === undefined) return;
    const g = st.doc.groups[gi];
    const hasMotion = ["x", "y"].some((k) => g.tracks[k] && g.tracks[k].keyframes.length > 1) || g.exprs.x || g.exprs.y || g.tracks.relativeTo;
    if (!hasMotion) return;
    const end = st.doc.infinite ? Math.max(st.sec + 4, 4) : st.doc.duration;
    const key = st.docVersion + "|" + name + "|" + end;
    let path = (this._paths ||= new Map()).get(key);
    if (!path) {
      const steps = Math.min(600, Math.max(24, Math.round(end * st.doc.fps)));
      const tmp = new PoseSet(0);
      path = [];
      for (let i = 0; i <= steps; i++) {
        const t = (end * i) / steps;
        const p = st.poseAt(t, tmp);
        path.push([p.world[gi * 5], p.world[gi * 5 + 1], t]);
      }
      const keys = [];
      const times = new Set([...(g.tracks.x ? g.tracks.x.keyframes.map((k) => k.sec) : []), ...(g.tracks.y ? g.tracks.y.keyframes.map((k) => k.sec) : [])]);
      for (const t of times) { const p = st.poseAt(t, tmp); keys.push([p.world[gi * 5], p.world[gi * 5 + 1], t]); }
      path.keys = keys;
      if (this._paths.size > 16) this._paths.clear();
      this._paths.set(key, path);
    }
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    path.forEach(([x, y], i) => { const [sx, sy] = this.animToScreen(x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = accent;
    const every = Math.max(1, Math.round(path.length / 60));
    path.forEach(([x, y], i) => {
      if (i % every) return;
      const [sx, sy] = this.animToScreen(x, y);
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
    });
    for (const [x, y, t] of path.keys) {
      const [sx, sy] = this.animToScreen(x, y);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = Math.abs(t - st.sec) < 1e-4 ? "#ffab19" : "#fff";
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.fillRect(-4, -4, 8, 8);
      ctx.strokeRect(-4, -4, 8, 8);
      ctx.restore();
    }
    ctx.restore();
    this._pathKeys = { name, gi, keys: path.keys };
  }
  pick(sx, sy) {
    const st = this.st;
    const pose = st.currentPose();
    const order = pose.order;
    const [X, Y] = this.fromScreen(sx, sy);
    for (let oi = order.length - 1; oi >= 0; oi--) {
      const gi = order[oi];
      if (!this.valid || !this.valid[gi]) continue;
      if (this.hitPart(gi, X, Y, true)) return gi;
    }
    return null;
  }
  hitPart(gi, X, Y, precise) {
    const c = this.cmds[gi];
    const [A, B, C, D, E, F] = c.canvas;
    const det = A * D - B * C;
    if (Math.abs(det) < 1e-12) return false;
    const gx = (D * (X - E) - C * (Y - F)) / det;
    const gy = (A * (Y - F) - B * (X - E)) / det;
    const u = gx * c.padUV[0] - c.padUV[2];
    const v = gy * c.padUV[1] - c.padUV[3];
    if (u < 0 || v < 0 || u > 1 || v > 1) return false;
    if (!precise) return true;
    try { c.skin.updateSilhouette && c.skin.updateSilhouette([100, 100]); return !!c.skin.isTouchingLinear([u, v]); } catch { return true; }
  }
  hitHandle(gi, sx, sy, alt = false) {
    const H = this.handles(gi);
    if (Math.hypot(sx - H.rot[0], sy - H.rot[1]) <= 14) return { type: "rot" };
    if (alt && Math.hypot(sx - H.origin[0], sy - H.origin[1]) <= 8) return { type: "pivot" };
    for (let i = 0; i < 8; i++) if (Math.abs(sx - H.hs[i][0]) <= HANDLE + 3 && Math.abs(sy - H.hs[i][1]) <= HANDLE + 3) return { type: "scale", idx: i };
    const [X, Y] = this.fromScreen(sx, sy);
    if (this.hitPart(gi, X, Y, false)) return { type: "move" };
    return null;
  }
  hitPathKey(sx, sy) {
    const pk = this._pathKeys;
    if (!pk || !this.st.view.motionPath || !this.st.selGroups.has(pk.name)) return null;
    for (const [x, y, t] of pk.keys) {
      const [px, py] = this.animToScreen(x, y);
      if (Math.hypot(sx - px, sy - py) <= 7) return { name: pk.name, gi: pk.gi, t };
    }
    return null;
  }
  bindEvents() {
    const area = this.area;
    const pos = (e) => { const r = area.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    area.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [x, y] = pos(e);
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        const k = Math.pow(1.0015, -e.deltaY * (e.ctrlKey ? 3 : 1));
        this.zoomBy(k, x, y);
      } else { this.st.view.pvPanX -= e.deltaX; this.st.view.pvFit = false; this.ed.invalidate("view"); }
    }, { passive: false });
    area.addEventListener("mousedown", (e) => this.onDown(e, pos(e)));
    area.addEventListener("mousemove", (e) => {
      if (this.drag) return;
      const [x, y] = pos(e);
      this.updateCursor(x, y, e);
    });
    area.addEventListener("mouseleave", () => { this.hover = null; this.ed.invalidate("overlay"); });
    area.addEventListener("dblclick", (e) => {
      const [x, y] = pos(e);
      if (this.pick(x, y) === null) this.fit();
    });
    area.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const [x, y] = pos(e);
      const gi = this.pick(x, y);
      if (gi !== null) {
        const name = this.st.compiled.groups[gi].name;
        if (!this.st.selGroups.has(name)) this.st.selectGroup(name);
        this.ed.partMenu(name, { x: e.clientX, y: e.clientY });
      } else
        showMenu(
          [
            { label: "Add part…", icon: "plus", action: () => this.ed.addPartDialog() },
            { label: "Fit view", icon: "fit", kbd: "F", action: () => this.fit() },
            { label: "Reset zoom (100%)", icon: "zoomIn", action: () => ((this.st.view.pvZoom = 1), (this.st.view.pvPanX = this.st.view.pvPanY = 0), (this.st.view.pvFit = false), this.ed.invalidate("view")) },
          ],
          { x: e.clientX, y: e.clientY },
          { ctx: true },
        );
    });
    area.addEventListener("dragover", (e) => {
      if (!e.dataTransfer) return;
      const types = [...e.dataTransfer.types];
      if (types.includes("Files") || types.includes("application/x-ks5-costume")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        this.el.classList.toggle("k5-dragging-file", types.includes("Files"));
      }
    });
    area.addEventListener("dragleave", () => this.el.classList.remove("k5-dragging-file"));
    area.addEventListener("drop", (e) => {
      this.el.classList.remove("k5-dragging-file");
      e.preventDefault();
      const [x, y] = pos(e);
      const ks5 = e.dataTransfer.getData("application/x-ks5-costume");
      if (ks5) {
        const info = JSON.parse(ks5);
        const gi = this.pick(x, y);
        const [ax, ay] = this.screenToAnim(x, y);
        this.ed.dropCostume(info, gi === null ? null : this.st.compiled.groups[gi].name, ax, ay);
        return;
      }
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        const [ax, ay] = this.screenToAnim(x, y);
        this.ed.dropFiles([...e.dataTransfer.files], ax, ay);
      }
    });
  }
  updateCursor(x, y, e) {
    const st = this.st;
    const pg = st.primary !== null ? st.compiled.byName.get(st.primary) : undefined;
    let cursor = "default";
    if (this.spaceHeld || st.view.tool === "hand") cursor = "grab";
    else if (st.view.tool === "pivot" || DRAW_TOOLS.includes(st.view.tool)) cursor = "crosshair";
    else if (pg !== undefined && this.valid && this.valid[pg]) {
      if (!this.drag) this.followRot(pg, x, y);
      const hh = this.hitHandle(pg, x, y, e.altKey);
      if (hh) {
        if (hh.type === "rot") cursor = "grab";
        else if (hh.type === "move") cursor = "move";
        else if (hh.type === "pivot") cursor = "crosshair";
        else {
          const H = this.handles(pg);
          const [hx, hy] = H.hs[hh.idx];
          const [ox, oy] = H.origin;
          if (e.ctrlKey && hh.idx >= 4) cursor = hh.idx < 6 ? "ew-resize" : "ns-resize";
          else {
            const a = ((Math.atan2(hy - oy, hx - ox) * 180) / Math.PI + 360) % 180;
            cursor = a < 22.5 || a >= 157.5 ? "ew-resize" : a < 67.5 ? "nwse-resize" : a < 112.5 ? "ns-resize" : "nesw-resize";
          }
        }
      }
    }
    if (cursor === "default" && this.hitPathKey(x, y)) cursor = "pointer";
    const gi = cursor === "default" ? this.pick(x, y) : null;
    if (gi !== this.hover) { this.hover = gi; this.ed.invalidate("overlay"); }
    if (cursor === "default" && gi !== null) cursor = "pointer";
    this.area.style.cursor = cursor;
  }
  onDown(e, [x, y]) {
    const st = this.st;
    this.area.focus({ preventScroll: true });
    if (e.button === 1 || (e.button === 0 && ((e.altKey && !st.primary) || this.spaceHeld || st.view.tool === "hand"))) {
      e.preventDefault();
      this.startPan(e, x, y);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    if (DRAW_TOOLS.includes(st.view.tool)) { this.startDraw(e, x, y); return; }
    const pg = st.primary !== null ? st.compiled.byName.get(st.primary) : undefined;
    if (st.view.tool === "pivot" && pg !== undefined && this.valid && this.valid[pg]) {
      this.startGizmo(e, { type: "pivot" }, pg, x, y);
      return;
    }
    if (pg !== undefined && this.valid && this.valid[pg]) {
      const hh = this.hitHandle(pg, x, y, e.altKey);
      if (hh && !(hh.type === "move" && e.shiftKey)) { this.startGizmo(e, hh, pg, x, y); return; }
    }
    const pk = this.hitPathKey(x, y);
    if (pk) { this.startPathKey(e, pk, x, y); return; }
    const gi = this.pick(x, y);
    if (gi === null) {
      if (!e.shiftKey) st.selectGroup(null);
      this.startPan(e, x, y, true);
      return;
    }
    const name = st.compiled.groups[gi].name;
    st.selectGroup(name, e.shiftKey || e.ctrlKey || e.metaKey);
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) this.startGizmo(e, { type: "move" }, gi, x, y);
  }
  startPan(e, x, y, fromEmpty = false) {
    const v = this.st.view;
    const sx = v.pvPanX, sy = v.pvPanY;
    let moved = false;
    this.area.style.cursor = "grabbing";
    const move = (ev) => {
      const dx = ev.clientX - e.clientX, dy = ev.clientY - e.clientY;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      v.pvPanX = sx + dx;
      v.pvPanY = sy + dy;
      v.pvFit = false;
      this.ed.invalidate("view");
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      this.area.style.cursor = "";
      void fromEmpty;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  gizmoStart(gi) {
    const st = this.st;
    const pose = st.currentPose();
    const c = this.cmds[gi];
    const num = pose.num;
    const b = gi * NUM_SLOTS;
    return {
      gi,
      name: st.compiled.groups[gi].name,
      wx: pose.world[gi * 5],
      wy: pose.world[gi * 5 + 1],
      wr: pose.world[gi * 5 + 2],
      wsx: pose.world[gi * 5 + 3],
      wsy: pose.world[gi * 5 + 4],
      skx: num[b + SLOT.skewX],
      sky: num[b + SLOT.skewY],
      pivX: num[b + SLOT.pivotX],
      pivY: num[b + SLOT.pivotY],
      cmd: { ...c, canvas: c.canvas.slice(), mat: c.mat.slice(), padUV: c.padUV.slice(), boxPx: c.boxPx.slice() },
      pose: poseCopy(pose),
      had: Object.fromEntries(["x", "y", "rotation", "scaleX", "scaleY", "skewX", "skewY", "pivotX", "pivotY"].map((k) => [k, hasTrack(st.doc.groups[gi], k)])),
    };
  }
  keyTime() { const st = this.st; return st.playing ? st.sec : st.snap(st.sec); }
  writeWorld(s, vals) {
    const st = this.st;
    const g = st.group(s.name);
    if (!g) return;
    const t = this.keyTime();
    const put = (k, v) => setKey(g, k, s.had[k] || s.recording ? t : 0, round3(v), { exact: true });
    if (vals.x !== undefined || vals.y !== undefined) {
      const [lx, ly] = worldToLocal(s.pose, s.gi, "x", [vals.x ?? s.wx, vals.y ?? s.wy]);
      put("x", lx);
      put("y", ly);
    }
    if (vals.r !== undefined) put("rotation", worldToLocal(s.pose, s.gi, "rotation", vals.r));
    if (vals.sx !== undefined) put("scaleX", worldToLocal(s.pose, s.gi, "scaleX", vals.sx));
    if (vals.sy !== undefined) put("scaleY", worldToLocal(s.pose, s.gi, "scaleY", vals.sy));
    if (vals.skx !== undefined) put("skewX", vals.skx);
    if (vals.sky !== undefined) put("skewY", vals.sky);
    if (vals.pivX !== undefined) put("pivotX", vals.pivX);
    if (vals.pivY !== undefined) put("pivotY", vals.pivY);
  }
  startGizmo(e, hh, gi, x0, y0) {
    const st = this.st;
    const s = this.gizmoStart(gi);
    const z = st.view.pvZoom;
    const rad = (s.wr * Math.PI) / 180;
    const cs = Math.cos(rad), sn = Math.sin(rad);
    const tx = Math.tan((s.skx * Math.PI) / 180), ty = Math.tan((s.sky * Math.PI) / 180);
    const R = [cs - sn * ty, sn + cs * ty, cs * tx - sn, sn * tx + cs];
    const Rdet = R[0] * R[3] - R[1] * R[2] || 1e-9;
    const toLocal = (dx, dy) => [(R[3] * dx - R[2] * dy) / Rdet, (R[0] * dy - R[1] * dx) / Rdet];
    const c = s.cmd;
    const lx0 = -c.rcx - c.pivX, ly0 = -c.rcy - c.pivY;
    const lx1 = lx0 + c.sw, ly1 = ly0 + c.sh;
    const HL = [[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1], [(lx0 + lx1) / 2, ly0], [(lx0 + lx1) / 2, ly1], [lx0, (ly0 + ly1) / 2], [lx1, (ly0 + ly1) / 2]];
    const OPP = [2, 3, 0, 1, 5, 4, 7, 6];
    const sx0 = (s.wsx || 1e-5) / 100, sy0 = (s.wsy || 1e-5) / 100;
    const centerLocal = [(lx0 + lx1) / 2, (ly0 + ly1) / 2];
    const quadStart = this.partQuad(gi);
    const centerScreen = [(quadStart[0][0] + quadStart[2][0]) / 2, (quadStart[0][1] + quadStart[2][1]) / 2];
    const [pivotSx0, pivotSy0] = this.toScreen(c.mat[4], c.mat[5]);
    let moved = false;
    this.drag = { type: hh.type, last: [x0, y0], info: "" };
    const recording = st.playing && st.recording;
    s.recording = recording;
    const move = (ev) => {
      const r = this.area.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (!moved && Math.hypot(x - x0, y - y0) < 3) return;
      if (!moved) {
        moved = true;
        if (!recording) st.beginChange(hh.type === "move" ? "Move part" : hh.type === "rot" ? "Rotate part" : hh.type === "pivot" ? "Move pivot" : "Scale part");
        else st.beginChange("Record motion");
      }
      this.drag.last = [x, y];
      const dxA = (x - x0) / z, dyA = (y - y0) / z;
      st.live(() => {
        if (hh.type === "move") {
          let nx = s.wx + dxA, ny = s.wy - dyA;
          if (ev.shiftKey) {
            if (Math.abs(dxA) > Math.abs(dyA)) ny = s.wy;
            else nx = s.wx;
          }
          [nx, ny] = this.snapPoint(nx, ny, ev);
          [nx, ny] = this.snapParts(gi, quadStart, s, nx, ny, z, ev);
          this.writeWorld(s, { x: nx, y: ny });
          this.drag.info = `${round1(nx)}, ${round1(ny)}`;
        } else if (hh.type === "rot") {
          const [ox, oy] = this.toScreen(c.mat[4], c.mat[5]);
          const a0 = Math.atan2(y0 - oy, x0 - ox), a1 = Math.atan2(y - oy, x - ox);
          let r = s.wr + ((a1 - a0) * 180) / Math.PI;
          if (ev.shiftKey) r = Math.round(r / 15) * 15;
          this.writeWorld(s, { r });
          this.drag.info = `${round1(r)}°`;
        } else if (hh.type === "pivot") {
          const [du, dv] = toLocal(dxA, dyA);
          let dpx = du / sx0, dpy = dv / sy0;
          let compdxA = dxA, compdyA = dyA;
          const snapped = Math.hypot(pivotSx0 + (x - x0) - centerScreen[0], pivotSy0 + (y - y0) - centerScreen[1]) < 10;
          if (snapped) {
            [dpx, dpy] = centerLocal;
            const su = dpx * sx0, sv = dpy * sy0;
            compdxA = R[0] * su + R[2] * sv;
            compdyA = R[1] * su + R[3] * sv;
          }
          this.writeWorld(s, { pivX: s.pivX + dpx, pivY: s.pivY + dpy, x: s.wx + compdxA, y: s.wy - compdyA });
          this.drag.snapped = snapped;
          this.drag.info = snapped ? "pivot: center" : `pivot ${round1(s.pivX + dpx)}, ${round1(s.pivY + dpy)}`;
        } else if (hh.type === "scale") {
          const i = hh.idx;
          const [hx, hy] = HL[i];
          const skew = (ev.ctrlKey || ev.metaKey) && i >= 4;
          if (skew) {
            const [du, dv] = toLocal(dxA, dyA);
            const [qx, qy] = ev.altKey ? [0, 0] : HL[OPP[i]];
            const horizontal = i < 6;
            const span = horizontal ? (hy - qy) * sy0 : (hx - qx) * sx0;
            const lever = Math.abs(span) > 1e-6 ? span : (horizontal ? sy0 : sx0) * (hy || hx || 1);
            const ntx = horizontal ? tx + du / lever : tx;
            const nty = horizontal ? ty : ty + dv / lever;
            const M = (ax, ay) => [cs - sn * ay, sn + cs * ay, cs * ax - sn, sn * ax + cs];
            const M1 = M(ntx, nty);
            const au = qx * sx0, av = qy * sy0;
            const odx = (R[0] - M1[0]) * au + (R[2] - M1[2]) * av;
            const ody = (R[1] - M1[1]) * au + (R[3] - M1[3]) * av;
            const deg = (Math.atan(horizontal ? ntx : nty) * 180) / Math.PI;
            this.writeWorld(s, { [horizontal ? "skx" : "sky"]: deg, x: s.wx + odx, y: s.wy - ody });
            this.drag.info = `skew ${horizontal ? "x" : "y"} ${round1(deg)}°`;
            return;
          }
          const aroundOrigin = ev.altKey;
          const [qx, qy] = aroundOrigin ? [0, 0] : HL[OPP[i]];
          const [mu, mv] = toLocal((x - x0) / z + (hx * sx0 * R[0] + hy * sy0 * R[2]), (y - y0) / z + (hx * sx0 * R[1] + hy * sy0 * R[3]));
          const au = qx * sx0, av = qy * sy0;
          let nsx = sx0, nsy = sy0;
          const corner = i < 4;
          const hasX = Math.abs(hx - qx) > 1e-6, hasY = Math.abs(hy - qy) > 1e-6;
          if (corner && !ev.shiftKey) {
            const vx = (hx - qx) * sx0, vy = (hy - qy) * sy0;
            const k = ((mu - au) * vx + (mv - av) * vy) / (vx * vx + vy * vy || 1e-9);
            nsx = sx0 * k;
            nsy = sy0 * k;
          } else {
            if (hasX) nsx = (mu - au) / (hx - qx);
            if (hasY) nsy = (mv - av) / (hy - qy);
          }
          if (Math.abs(nsx) < 1e-4) nsx = 1e-4 * Math.sign(nsx || 1);
          if (Math.abs(nsy) < 1e-4) nsy = 1e-4 * Math.sign(nsy || 1);
          const du = (sx0 - nsx) * qx, dv = (sy0 - nsy) * qy;
          const odx = R[0] * du + R[2] * dv, ody = R[1] * du + R[3] * dv;
          this.writeWorld(s, { sx: nsx * 100, sy: nsy * 100, x: s.wx + odx, y: s.wy - ody });
          this.drag.info = `${round1(nsx * 100)}% × ${round1(nsy * 100)}%`;
        }
      });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (moved) st.endChange();
      this.drag = null;
      this.ed.invalidate("view");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  startPathKey(e, pk, x0, y0) {
    const st = this.st;
    const g = st.group(pk.name);
    const pose0 = poseCopy(st.poseAt(pk.t));
    const wx = pose0.world[pk.gi * 5], wy = pose0.world[pk.gi * 5 + 1];
    const z = st.view.pvZoom;
    let moved = false;
    this.drag = { type: "path", last: [x0, y0], info: "" };
    const move = (ev) => {
      const r = this.area.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (!moved && Math.hypot(x - x0, y - y0) < 3) return;
      if (!moved) { moved = true; st.beginChange("Edit motion path"); }
      this.drag.last = [x, y];
      const nx = wx + (x - x0) / z, ny = wy - (y - y0) / z;
      st.live(() => {
        const [lx, ly] = worldToLocal(pose0, pk.gi, "x", [nx, ny]);
        setKey(g, "x", pk.t, round3(lx), { exact: true });
        setKey(g, "y", pk.t, round3(ly), { exact: true });
      });
      this.drag.info = `${round1(nx)}, ${round1(ny)} @ ${pk.t.toFixed(2)}s`;
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (moved) st.endChange();
      else st.setTime(pk.t);
      this.drag = null;
      this.ed.invalidate("view");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  dispose() { this.view.dispose(); }
}
function poseCopy(p) {
  const c = new PoseSet(p.n);
  c.num.set(p.num);
  c.world.set(p.world);
  c.parent.set(p.parent);
  c.costume.set(p.costume);
  return c;
}
const hasTrack = (g, k) => !!(g.tracks[k] && g.tracks[k].keyframes.length);
const round1 = (v) => Math.round(v * 10) / 10;
const canHaveExpr = (inf) => !!inf && inf.kind === "track" && !!TD[inf.key] && !TD[inf.key].str;
function exprKeyIds(st, ids) { return [...ids].filter((id) => canHaveExpr(st.index.get(id))); }
function setKeysExpr(st, ids, text, blocks) {
  const n = ids.length;
  let label = text ? "Set expression" : "Clear expression";
  if (n > 1) label += ` (${n} keys)`;
  st.mutate(label, () => {
    for (const id of ids) {
      const inf = st.index.get(id);
      if (!canHaveExpr(inf)) continue;
      if (text) inf.kf.expr = text;
      else delete inf.kf.expr;
      if (text && blocks) inf.kf.exprBlocks = blocks;
      else delete inf.kf.exprBlocks;
    }
  });
}
function openExprEditor(ed, ids) {
  const st = ed.st;
  const keyIds = exprKeyIds(st, ids);
  if (!keyIds.length) { toast("Select keyframes of a part to give them an expression", true); return Promise.resolve(null); }
  const apply = (text, blocks) => setKeysExpr(st, keyIds, text, blocks);
  return openAnimationDialog("expression", { ed, keyIds, apply });
}
function openPropertyExpr(ed, g, key, sec) {
  const st = ed.st;
  let id = null;
  const existing = keyAt(g.tracks[key], sec);
  if (existing) id = existing.id;
  else {
    const gi = st.groupIndex(g.name);
    const pose = st.currentPose();
    const value = key === "costume" ? pose.costume[gi] : pose.get(gi, key);
    st.mutate("Add keyframe", () => { id = setKey(g, key, sec, value, { exact: true }).id; });
  }
  st.selectKeys([id]);
  return openExprEditor(ed, [id]);
}
function setTrackExpr(st, groupName, key, text, blocks) {
  st.mutate(text ? "Set default expression" : "Clear default expression", () => {
    const g = st.group(groupName);
    const tr = g && g.tracks[key];
    if (!tr || !TD[key] || TD[key].str) return;
    if (text) tr.expr = text;
    else delete tr.expr;
    if (text && blocks) tr.exprBlocks = blocks;
    else delete tr.exprBlocks;
  });
}
function openTrackExpr(ed, g, key, sec) {
  const st = ed.st;
  if (!TD[key] || TD[key].str) return Promise.resolve(null);
  const tr = g.tracks[key];
  if (!tr || !tr.keyframes.length) {
    const gi = st.groupIndex(g.name);
    const pose = st.currentPose();
    const value = key === "costume" ? pose.costume[gi] : pose.get(gi, key);
    st.mutate("Add keyframe", () => { setKey(g, key, sec ?? st.snap(st.sec), value, { exact: true }); });
  }
  const apply = (text, blocks) => setTrackExpr(st, g.name, key, text, blocks);
  return openAnimationDialog("expression", { ed, keyIds: [], track: { group: g.name, key }, apply });
}
const RULER = 28;
const PAD_Y = 18;
const EASE_TO_BEZ = {
  Linear_In: [1 / 3, 1 / 3, 2 / 3, 2 / 3],
  Linear_Out: [1 / 3, 1 / 3, 2 / 3, 2 / 3],
  Linear_InOut: [1 / 3, 1 / 3, 2 / 3, 2 / 3],
  Sine_In: [0.12, 0, 0.39, 0],
  Sine_Out: [0.61, 1, 0.88, 1],
  Sine_InOut: [0.37, 0, 0.63, 1],
  Quad_In: [0.11, 0, 0.5, 0],
  Quad_Out: [0.5, 1, 0.89, 1],
  Quad_InOut: [0.45, 0, 0.55, 1],
  Cubic_In: [0.32, 0, 0.67, 0],
  Cubic_Out: [0.33, 1, 0.68, 1],
  Cubic_InOut: [0.65, 0, 0.35, 1],
  Quart_In: [0.5, 0, 0.75, 0],
  Quart_Out: [0.25, 1, 0.5, 1],
  Quart_InOut: [0.76, 0, 0.24, 1],
  Quint_In: [0.64, 0, 0.78, 0],
  Quint_Out: [0.22, 1, 0.36, 1],
  Quint_InOut: [0.83, 0, 0.17, 1],
  Expo_In: [0.7, 0, 0.84, 0],
  Expo_Out: [0.16, 1, 0.3, 1],
  Expo_InOut: [0.87, 0, 0.13, 1],
  Circ_In: [0.55, 0, 1, 0.45],
  Circ_Out: [0, 0.55, 0.45, 1],
  Circ_InOut: [0.85, 0, 0.15, 1],
  Back_In: [0.36, 0, 0.66, -0.56],
  Back_Out: [0.34, 1.56, 0.64, 1],
  Back_InOut: [0.68, -0.6, 0.32, 1.6],
};
class GraphView {
  constructor(tl) {
    this.tl = tl;
    this.st = tl.st;
    this.vMin = -100;
    this.vMax = 100;
    this.hidden = new Set();
    this.drag = null;
    this._fitKey = "";
  }
  curves() {
    const st = this.st;
    const out = [];
    const want = (g, key, picked = false) => {
      const d = TD[key];
      if (!d || d.kind !== "num") return;
      const tr = g.tracks[key];
      if (!tr || !tr.keyframes.length) return;
      if (tr.tlHidden && !picked) return;
      out.push({ group: g, key, track: tr, color: d.color, id: g.name + "/" + key });
    };
    if (st.selTrack) {
      const g = st.group(st.selTrack.group);
      if (g) want(g, st.selTrack.key, true);
    }
    if (!out.length)
      for (const name of st.selGroups) {
        const g = st.group(name);
        if (g) for (const key of Object.keys(g.tracks)) want(g, key);
      }
    if (!out.length && st.doc.groups.length === 1) for (const key of Object.keys(st.doc.groups[0].tracks)) want(st.doc.groups[0], key);
    return out;
  }
  visibleCurves() { return this.curves().filter((c) => !this.hidden.has(c.id)); }
  fitValues() {
    const cs = this.visibleCurves();
    let lo = Infinity, hi = -Infinity;
    for (const c of cs) {
      const s = new Sampler(c.track, c.key);
      for (const k of c.track.keyframes) { lo = Math.min(lo, +k.value); hi = Math.max(hi, +k.value); }
      const t0 = c.track.keyframes[0].sec, t1 = c.track.keyframes[c.track.keyframes.length - 1].sec;
      for (let i = 0; i <= 64; i++) {
        const v = s.sampleNum(t0 + ((t1 - t0) * i) / 64);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (!Number.isFinite(lo)) { lo = -100; hi = 100; }
    if (hi - lo < 1e-6) { lo -= 10; hi += 10; }
    const pad = (hi - lo) * 0.12;
    this.vMin = lo - pad;
    this.vMax = hi + pad;
    this.tl.ed.invalidate("timeline");
  }
  v2y(v) {
    const H = this.tl.height;
    return RULER + PAD_Y + (1 - (v - this.vMin) / (this.vMax - this.vMin)) * (H - RULER - PAD_Y * 2);
  }
  y2v(y) {
    const H = this.tl.height;
    return this.vMin + (1 - (y - RULER - PAD_Y) / (H - RULER - PAD_Y * 2)) * (this.vMax - this.vMin);
  }
  renderLabels(list) {
    clearEl(list);
    const cs = this.curves();
    if (!cs.length) {
      list.appendChild(h("div", { class: "k5-empty" }, h("b", null, "No curves"), "Select a part or a track with keyframes to see its curves."));
      return;
    }
    let y = 0;
    for (const c of cs) {
      const hidden = this.hidden.has(c.id);
      const row = h(
        "div",
        { class: "k5-tl-row" + (hidden ? " k5-muted" : ""), style: { top: y + "px", height: "22px" } },
        h("span", { class: "k5-dot", style: { background: c.color } }),
        h("span", { class: "k5-name" }, `${c.group.name} · ${TD[c.key].label}`),
      );
      const eye = iconEl(hidden ? "eyeOff" : "eye");
      eye.style.cssText = "width:0.85rem;height:0.85rem;opacity:.7;flex-shrink:0";
      row.appendChild(eye);
      row.addEventListener("click", () => {
        if (hidden) this.hidden.delete(c.id);
        else this.hidden.add(c.id);
        this.tl.ed.invalidate("timeline");
      });
      list.appendChild(row);
      y += 22;
    }
  }
  draw(ctx, w, hh) {
    const tl = this.tl;
    const c = tl.colors;
    const st = this.st;
    const cs = this.visibleCurves();
    const key = cs.map((x) => x.id).join(",");
    if (key !== this._fitKey) { this._fitKey = key; this.fitValues(); }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER, w, hh - RULER);
    ctx.clip();
    tl.drawGrid(ctx, w, hh, RULER);
    const range = this.vMax - this.vMin;
    const raw = range / Math.max(2, (hh - RULER) / 40);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
    ctx.font = "bold 9px " + tl.ed.font();
    ctx.textBaseline = "bottom";
    for (let v = Math.ceil(this.vMin / step) * step; v <= this.vMax; v += step) {
      const y = Math.round(this.v2y(v)) + 0.5;
      ctx.fillStyle = Math.abs(v) < step / 1000 ? c.grid2 : c.grid;
      ctx.fillRect(0, y, w, 1);
      ctx.fillStyle = c.text2;
      ctx.fillText(fmtV(v, step), 4, y - 1);
    }
    if (!st.doc.infinite) {
      const x = tl.t2x(st.doc.duration);
      if (x < w) { ctx.fillStyle = c.outside; ctx.fillRect(x, RULER, w - x, hh - RULER); }
    }
    const t0 = tl.x2t(0), t1 = tl.x2t(w);
    for (const cv of cs) {
      const kfs = cv.track.keyframes;
      const s = new Sampler(cv.track, cv.key);
      ctx.strokeStyle = cv.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const xa = Math.max(0, tl.t2x(Math.max(t0, 0)));
      for (let x = xa; x <= w; x += 2) {
        const v = s.sampleNum(tl.x2t(x));
        const y = this.v2y(v);
        x === xa ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (let i = 0; i < kfs.length; i++) {
        const k = kfs[i];
        if (k.sec < t0 - 1 || k.sec > t1 + 1) continue;
        const x = tl.t2x(k.sec), y = this.v2y(+k.value);
        const sel = st.selKeys.has(k.id);
        if (sel) this.drawHandles(ctx, kfs, i, cv.color);
        ctx.fillStyle = sel ? c.key : "#fff";
        ctx.strokeStyle = sel ? c.keyDark : cv.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, sel ? 5 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (this.drag && this.drag.type === "marquee" && this.drag.moved) {
      const m = this.drag;
      ctx.fillStyle = c.accent10;
      ctx.strokeStyle = c.accent;
      ctx.setLineDash([4, 3]);
      const x0 = Math.min(m.x0, m.x1), y0 = Math.min(m.y0, m.y1);
      ctx.fillRect(x0, y0, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      ctx.setLineDash([]);
    }
    if (!cs.length) {
      ctx.fillStyle = c.text2;
      ctx.font = "bold 12px " + tl.ed.font();
      ctx.textBaseline = "middle";
      ctx.fillText("Select a part or track to edit its curves", 16, RULER + (hh - RULER) / 2);
    }
    ctx.restore();
  }
  handlePoints(kfs, i) {
    const tl = this.tl;
    const out = {};
    const seg = (a, b) => {
      const A = kfs[a], B = kfs[b];
      if (!A || !B || B.ease === "Step") return null;
      const bez = B.ease === "Bezier" && B.bez ? B.bez : EASE_TO_BEZ[B.ease] || [0.42, 0, 0.58, 1];
      const t0 = A.sec, t1 = B.sec, v0 = +A.value, v1 = +B.value;
      const dv = v1 - v0;
      const P = (x, y) => [tl.t2x(t0 + (t1 - t0) * x), this.v2y(v0 + (Math.abs(dv) < 1e-9 ? 0 : dv) * y)];
      return { a, b, bez, t0, t1, v0, v1, dv, p1: P(bez[0], bez[1]), p2: P(bez[2], bez[3]), approx: B.ease !== "Bezier" };
    };
    out.inSeg = i > 0 ? seg(i - 1, i) : null;
    out.outSeg = i < kfs.length - 1 ? seg(i, i + 1) : null;
    return out;
  }
  drawHandles(ctx, kfs, i, color) {
    const tl = this.tl;
    const hp = this.handlePoints(kfs, i);
    const kx = tl.t2x(kfs[i].sec), ky = this.v2y(+kfs[i].value);
    ctx.save();
    for (const [s, p] of [[hp.inSeg, hp.inSeg && hp.inSeg.p2], [hp.outSeg, hp.outSeg && hp.outSeg.p1]]) {
      if (!s) continue;
      ctx.strokeStyle = color;
      ctx.globalAlpha = s.approx ? 0.5 : 1;
      ctx.lineWidth = 1;
      ctx.setLineDash(s.approx ? [3, 3] : []);
      ctx.beginPath();
      ctx.moveTo(kx, ky);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.rect(p[0] - 3.5, p[1] - 3.5, 7, 7);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
  hit(x, y) {
    const st = this.st;
    const tl = this.tl;
    for (const cv of this.visibleCurves()) {
      const kfs = cv.track.keyframes;
      for (let i = 0; i < kfs.length; i++) {
        if (!st.selKeys.has(kfs[i].id)) continue;
        const hp = this.handlePoints(kfs, i);
        if (hp.inSeg && Math.hypot(x - hp.inSeg.p2[0], y - hp.inSeg.p2[1]) < 7) return { type: "handle", cv, seg: hp.inSeg, which: 2 };
        if (hp.outSeg && Math.hypot(x - hp.outSeg.p1[0], y - hp.outSeg.p1[1]) < 7) return { type: "handle", cv, seg: hp.outSeg, which: 1 };
      }
    }
    for (const cv of this.visibleCurves()) {
      for (const k of cv.track.keyframes) {
        if (Math.hypot(x - tl.t2x(k.sec), y - this.v2y(+k.value)) < 7) return { type: "key", cv, kf: k };
      }
    }
    return null;
  }
  cursorAt(x, y) { const hit = this.hit(x, y); return hit ? (hit.type === "handle" ? "crosshair" : "move") : "default"; }
  wantsWheel() { return false; }
  wheel(e, x, y) {
    const v = this.y2v(y);
    const k = Math.pow(1.0018, e.deltaY);
    this.vMin = v - (v - this.vMin) * k;
    this.vMax = v + (this.vMax - v) * k;
    this.tl.ed.invalidate("timeline");
  }
  mousedown(e, x, y) {
    const st = this.st;
    const tl = this.tl;
    if (e.button === 1) return this.startPan(e);
    if (e.button !== 0) return;
    const hit = this.hit(x, y);
    const rect = tl.wrap.getBoundingClientRect();
    if (hit && hit.type === "handle") {
      const s = hit.seg;
      const B = hit.cv.track.keyframes[s.b];
      st.beginChange("Edit curve");
      const move = (ev) => {
        const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
        const tx = clamp((tl.x2t(mx) - s.t0) / (s.t1 - s.t0 || 1e-9), 0, 1);
        const vy = Math.abs(s.dv) < 1e-9 ? (hit.which === 1 ? s.bez[1] : s.bez[3]) : (this.y2v(my) - s.v0) / s.dv;
        st.live(() => {
          const bez = (B.ease === "Bezier" && B.bez ? B.bez : s.bez).slice();
          if (hit.which === 1) { bez[0] = round3(tx); bez[1] = round3(vy); } else { bez[2] = round3(tx); bez[3] = round3(vy); }
          B.ease = "Bezier";
          B.bez = bez;
        });
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        st.endChange();
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }
    if (hit && hit.type === "key") {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (additive) { st.toggleKey(hit.kf.id); return; }
      if (!st.selKeys.has(hit.kf.id)) st.selectKeys([hit.kf.id]);
      const infos = st.selectedKeyInfos().filter((i) => i.kind === "track" && TD[i.key].kind === "num");
      const orig = infos.map((i) => ({ i, sec: i.kf.sec, v: +i.kf.value }));
      const x0 = x, y0 = y;
      let moved = false;
      let applied = 0;
      const move = (ev) => {
        const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
        if (!moved && Math.hypot(mx - x0, my - y0) < 3) return;
        if (!moved) { moved = true; st.beginChange("Move keys"); }
        let dxT = (mx - x0) / tl.pps;
        let dv = this.y2v(my) - this.y2v(y0);
        if (ev.shiftKey) {
          if (Math.abs(mx - x0) > Math.abs(my - y0)) dv = 0;
          else dxT = 0;
        }
        const target = tl.snapTime(hit.kf.sec - applied + dxT) - (hit.kf.sec - applied);
        st.live(() => {
          for (const o of orig) o.i.kf.value = round3(o.v + dv);
          const d = target - applied;
          if (Math.abs(d) > 1e-9) applied += moveKeys(st.doc, infos, d, st.doc.infinite ? Infinity : st.doc.duration);
        });
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        if (moved) st.endChange();
        else st.setTime(hit.kf.sec);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }
    this.drag = { type: "marquee", x0: x, y0: y, x1: x, y1: y, moved: false, base: e.shiftKey ? new Set(st.selKeys) : new Set() };
    const move = (ev) => {
      const d = this.drag;
      d.x1 = ev.clientX - rect.left;
      d.y1 = ev.clientY - rect.top;
      if (!d.moved && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 4) return;
      d.moved = true;
      const ids = [];
      const xa = Math.min(d.x0, d.x1), xb = Math.max(d.x0, d.x1), ya = Math.min(d.y0, d.y1), yb = Math.max(d.y0, d.y1);
      for (const cv of this.visibleCurves())
        for (const k of cv.track.keyframes) {
          const kx = tl.t2x(k.sec), ky = this.v2y(+k.value);
          if (kx >= xa && kx <= xb && ky >= ya && ky <= yb) ids.push(k.id);
        }
      st.selKeys = new Set([...d.base, ...ids]);
      st.emit("sel");
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved) {
        if (!e.shiftKey) st.clearKeys();
        st.setTime(tl.snapTime(tl.x2t(d.x0)));
      }
      tl.ed.invalidate("timeline");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  startPan(e) {
    const tl = this.tl;
    const st = this.st;
    const p0 = st.view.tlPan, a = this.vMin, b = this.vMax;
    const H = tl.height - RULER - PAD_Y * 2;
    const move = (ev) => {
      st.view.tlPan = p0 - (ev.clientX - e.clientX) / tl.pps;
      const dv = ((ev.clientY - e.clientY) / H) * (b - a);
      this.vMin = a + dv;
      this.vMax = b + dv;
      tl.clampPan();
      tl.ed.invalidate("timeline");
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  dblclick(e, x, y) {
    const tl = this.tl;
    const st = this.st;
    const t = tl.snapTime(tl.x2t(x));
    let best = null, bd = 30;
    for (const cv of this.visibleCurves()) {
      const s = new Sampler(cv.track, cv.key);
      const d = Math.abs(this.v2y(s.sampleNum(t)) - y);
      if (d < bd) { bd = d; best = { cv, v: s.sampleNum(t) }; }
    }
    if (!best) return;
    st.mutate("Add keyframe", () => {
      const tr = best.cv.track;
      tr.keyframes = tr.keyframes.filter((k) => Math.abs(k.sec - t) > 1e-4);
      const kf = { sec: t, value: round3(best.v), ease: "Linear_Out", id: "kf_" + Math.random().toString(36).slice(2, 10) };
      tr.keyframes.push(kf);
      tr.keyframes.sort((a, b) => a.sec - b.sec);
      st.selKeys = new Set([kf.id]);
    });
  }
  contextmenu(e, x, y) {
    const hit = this.hit(x, y);
    if (hit && hit.type === "key") {
      if (!this.st.selKeys.has(hit.kf.id)) this.st.selectKeys([hit.kf.id]);
      this.tl.keyMenu({ x: e.clientX, y: e.clientY });
    } else this.tl.emptyMenu({ type: "none" }, this.tl.snapTime(this.tl.x2t(x)), { x: e.clientX, y: e.clientY });
  }
}
function fmtV(v, step) { const dec = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step))); return v.toFixed(dec); }
const ROW_G = 28;
const hiddenTracksOf = (g) => ALL_TRACKS.filter((k) => g.tracks[k] && g.tracks[k].tlHidden);
const ROW_T = 22;
const LEFT_PAD = 12;
class Timeline {
  constructor(ed) {
    this.ed = ed;
    this.st = ed.st;
    const st = this.st;
    this.canvas = h("canvas");
    this.head = h("canvas");
    this.wrap = h("div", { class: "k5-tl-canvas-wrap", tabindex: "0" }, this.canvas, this.head);
    this.labelList = h("div", { class: "k5-tl-labels-list" });
    this.labels = h("div", { class: "k5-tl-labels" }, h("div", { class: "k5-tl-labels-head", style: { height: RULER + "px" } }, this.labelsHeader()), this.labelList);
    this.el = h("div", { class: "k5-pane k5-timeline" }, h("div", { class: "k5-tl-body" }, this.labels, this.wrap));
    this.graph = new GraphView(this);
    this.rows = [];
    this.drag = null;
    this.bindEvents();
    new ResizeObserver(() => this.ed.invalidate("timeline")).observe(this.wrap);
  }
  labelsHeader() {
    return [
      miniBtn("plus", "Add part", () => this.ed.addPartDialog()),
      miniBtn("data", "Add data track (data.name in expressions)", () => this.ed.cmd("addDataTrack")),
      miniBtn("flag", "Add event marker at the playhead", () => this.ed.cmd("addEvent")),
      h("span", { style: { flex: 1 } }),
      miniBtn("chevronDown", "Collapse / expand all parts", () => {
        const any = this.st.doc.groups.some((g) => !g.tlCollapsed);
        this.st.mutate("Collapse tracks", (d) => d.groups.forEach((g) => (any ? (g.tlCollapsed = true) : delete g.tlCollapsed)), "ui");
      }),
    ];
  }
  setMode(m) {
    this.st.view.tlMode = m;
    if (m === "graph") this.graph.fitValues();
    this.ed.invalidate("timeline");
    this.st.emit("ui");
  }
  get pps() { return 100 * this.st.view.tlZoom; }
  t2x(t) { return LEFT_PAD + (t - this.st.view.tlPan) * this.pps; }
  x2t(x) { return (x - LEFT_PAD) / this.pps + this.st.view.tlPan; }
  get width() { return this.wrap.clientWidth || 1; }
  get height() { return this.wrap.clientHeight || 1; }
  visibleEnd() { return this.x2t(this.width); }
  fit() {
    const d = this.st.doc;
    const end = d.infinite ? Math.max(4, ...this.allTimes(), this.st.sec + 1) : d.duration;
    this.st.view.tlZoom = clamp((this.width - LEFT_PAD - 24) / (end * 100), 0.02, 50);
    this.st.view.tlPan = 0;
    if (this.st.view.tlMode === "graph") this.graph.fitValues();
    this.ed.invalidate("timeline");
  }
  allTimes() {
    const out = [];
    for (const g of this.st.doc.groups) for (const tr of Object.values(g.tracks)) for (const k of tr.keyframes) out.push(k.sec);
    for (const e of this.st.doc.events) out.push(e.sec);
    return out;
  }
  zoomAt(k, x) {
    const t = this.x2t(x);
    const v = this.st.view;
    v.tlZoom = clamp(v.tlZoom * k, 0.02, 80);
    v.tlPan = t - (x - LEFT_PAD) / this.pps;
    this.clampPan();
    this.ed.invalidate("timeline");
  }
  clampPan() {
    const v = this.st.view;
    const d = this.st.doc;
    const span = (this.width - LEFT_PAD) / this.pps;
    const max = d.infinite ? Infinity : Math.max(0, d.duration - span * 0.5);
    v.tlPan = clamp(v.tlPan, -span * 0.25, max);
  }
  buildRows() {
    const st = this.st;
    const rows = [];
    let y = 0;
    for (const g of st.doc.groups) {
      rows.push({ type: "group", group: g, y, h: ROW_G });
      y += ROW_G;
      if (g.tlCollapsed) continue;
      for (const key of ALL_TRACKS) {
        const tr = g.tracks[key];
        const ex = g.exprs[key];
        if (tr && tr.tlHidden) continue;
        if ((tr && (tr.keyframes.length || tr.muted)) || ex) {
          rows.push({ type: "track", group: g, key, track: tr || null, expr: ex || "", y, h: ROW_T });
          y += ROW_T;
        }
      }
    }
    rows.push({ type: "events", y, h: ROW_T + 2 });
    y += ROW_T + 2;
    for (const dt of st.doc.dataTracks) { rows.push({ type: "data", data: dt, y, h: ROW_T }); y += ROW_T; }
    this.rows = rows;
    this.contentH = y;
    return rows;
  }
  rowAt(y) {
    const yy = y - RULER + this.st.view.tlScroll;
    for (const r of this.rows) if (yy >= r.y && yy < r.y + r.h) return r;
    return null;
  }
  clampScroll() {
    const v = this.st.view;
    const max = Math.max(0, this.contentH - (this.height - RULER) + 8);
    v.tlScroll = clamp(v.tlScroll, 0, max);
  }
  renderLabels() {
    const st = this.st;
    clearEl(this.labelList);
    const scroll = st.view.tlScroll;
    const H = this.height - RULER;
    if (st.view.tlMode === "graph") return this.graph.renderLabels(this.labelList);
    for (const r of this.rows) {
      const top = r.y - scroll;
      if (top + r.h < 0 || top > H) continue;
      const row = h("div", { class: "k5-tl-row", style: { top: top + "px", height: r.h + "px" } });
      if (r.type === "group") {
        const g = r.group;
        row.classList.add("k5-group");
        if (st.selGroups.has(g.name)) row.classList.add("k5-sel");
        const caret = h("span", { class: "k5-tree-caret", html: "" });
        caret.appendChild(iconEl(g.tlCollapsed ? "chevronRight" : "chevronDown"));
        caret.addEventListener("click", (e) => {
          e.stopPropagation();
          st.mutate(g.tlCollapsed ? "Expand" : "Collapse", () => (g.tlCollapsed ? delete g.tlCollapsed : (g.tlCollapsed = true)), "ui");
        });
        row.append(
          caret,
          h("span", { class: "k5-dot", style: { background: g.color || "var(--k-accent)" } }),
          h("span", { class: "k5-name" }, g.name),
          miniBtn("plus", "Add a property track", (e) => this.addTrackMenu(g, e)),
        );
        const hiddenKeys = hiddenTracksOf(g);
        if (hiddenKeys.length) {
          const n = hiddenKeys.length;
          const b = miniBtn("layers", `${n} hidden track${n === 1 ? "" : "s"}: click to show`, (e) => this.hiddenTracksMenu(g, e));
          b.classList.add("k5-hidden-count");
          b.appendChild(h("span", null, String(n)));
          row.append(b);
        }
        row.append(
          miniBtn(g.visible ? "eye" : "eyeOff", g.visible ? "Hide part" : "Show part", () => st.mutate("Toggle visibility", () => (g.visible = !g.visible)), !g.visible),
        );
        row.addEventListener("click", (e) => st.selectGroup(g.name, e.shiftKey || e.ctrlKey || e.metaKey));
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          if (!st.selGroups.has(g.name)) st.selectGroup(g.name);
          this.ed.partMenu(g.name, { x: e.clientX, y: e.clientY });
        });
      } else if (r.type === "track") {
        const d = TD[r.key];
        const muted = r.track && r.track.muted;
        if (muted) row.classList.add("k5-muted");
        if (st.selTrack && st.selTrack.group === r.group.name && st.selTrack.key === r.key) row.classList.add("k5-sel");
        row.style.paddingLeft = "1.6rem";
        row.append(
          h("span", { class: "k5-dot", style: { background: d.color } }),
          h("span", { class: "k5-name" }, (r.expr && !(r.track && r.track.keyframes.length) ? "ƒ " : "") + d.label),
        );
        if (r.expr) {
          row.append(miniBtn("expr", "Part-wide expression: " + r.expr + ". Right-click the track to remove it", () => {
            st.selectKeys((r.track ? r.track.keyframes : []).map((k) => k.id));
          }, true));
        }
        if (r.track && r.track.expr) {
          row.append(miniBtn("expr", "Default expression: " + r.track.expr + ". Click to edit", () => this.ed.openTrackExpr(r.group, r.key), true));
        }
        row.append(
          miniBtn(muted ? "mute" : "sound", muted ? "Unmute track" : "Mute track", () => st.mutate(muted ? "Unmute" : "Mute", () => {
            const tr = ensureTrack(r.group, r.key);
            if (tr.muted) delete tr.muted;
            else tr.muted = true;
          }), muted),
        );
        if (r.track) row.append(miniBtn("eyeOff", "Hide from the timeline (it still plays)", () => this.setTrackHidden(r.group, r.key, true)));
        row.addEventListener("click", () => { st.selTrack = { group: r.group.name, key: r.key }; st.selectGroup(r.group.name); });
        row.addEventListener("dblclick", () => { st.selTrack = { group: r.group.name, key: r.key }; this.setMode("graph"); });
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.trackMenu(r.group, r.key, { x: e.clientX, y: e.clientY });
        });
      } else if (r.type === "events") {
        row.append(iconEl("flag"), h("span", { class: "k5-name", style: { fontWeight: "bold" } }, "Events"), miniBtn("plus", "Add event at playhead", () => this.ed.cmd("addEvent")));
        row.firstChild.style.cssText = "width:0.85rem;height:0.85rem;color:var(--k-accent);flex-shrink:0";
      } else if (r.type === "data") {
        const dt = r.data;
        row.append(
          h("span", { class: "k5-dot", style: { background: dt.color || "#44ddbb" } }),
          h("span", { class: "k5-name" }, "data." + dt.name),
          miniBtn(dt.disc ? "dope" : "graph", dt.disc ? "Stepped values (click for smooth)" : "Smooth values (click for stepped)", () => st.mutate("Toggle data interpolation", () => (dt.disc = !dt.disc))),
          miniBtn("trash", "Delete data track", () => st.mutate("Delete data track", (doc) => (doc.dataTracks = doc.dataTracks.filter((x) => x !== dt)))),
        );
      }
      this.labelList.appendChild(row);
    }
  }
  addTrackMenu(g, e) {
    const st = this.st;
    const items = [];
    const sections = [
      ["Transform", ["x", "y", "rotation", "scaleX", "scaleY", "skewX", "skewY", "flipX", "flipY", "alpha", "pivotX", "pivotY"]],
      ["Look", ["costume", "visible", "zIndex", "tint", "fxColor", "fxBrightness", "fxGhost", "fxPixelate", "fxMosaic", "fxWhirl", "fxFisheye", "blendMode"]],
      ["Style", ["glowSize", "glowColor", "outlineWidth", "outlineColor", "shadowX", "shadowY", "shadowBlur", "shadowAlpha", "motionBlur"]],
    ];
    for (const [head, keys] of sections) {
      items.push({ heading: head });
      for (const k of keys) {
        if (g.tracks[k] && g.tracks[k].tlHidden) {
          items.push({ label: TD[k].label + " (hidden)", icon: "eye", action: () => this.setTrackHidden(g, k, false) });
          continue;
        }
        if (g.tracks[k] && g.tracks[k].keyframes.length) continue;
        items.push({
          label: TD[k].label,
          action: () => st.mutate("Add " + TD[k].label + " track", () => {
            const v = k === "costume" ? costumeRefAt(st, g) : st.valueAt(g.name, k);
            setKey(g, k, st.snap(st.sec), v ?? TD[k].def, { exact: true });
            g.tlCollapsed && delete g.tlCollapsed;
          }),
        });
      }
    }
    showMenu(items, { x: e.clientX, y: e.clientY }, { ctx: true });
  }
  trackMenu(g, key, pos) {
    const st = this.st;
    const tr = g.tracks[key];
    showMenu(
      [
        { label: "Select all keys", icon: "marquee", action: () => st.selectKeys((tr ? tr.keyframes : []).map((k) => k.id)) },
        { label: "Show in graph", icon: "graph", action: () => ((st.selTrack = { group: g.name, key }), this.setMode("graph")) },
        TD[key].str ? null : { label: "Expression for the key here…", icon: "expr", action: () => this.ed.openPropertyExpr(g, key, st.snap(st.sec)) },
        TD[key].str ? null : { label: tr && tr.expr ? "Edit default expression…" : "Default expression for every key…", icon: "expr", action: () => this.ed.openTrackExpr(g, key) },
        tr && tr.expr ? { label: "Remove default expression", icon: "close", action: () => setTrackExpr(st, g.name, key, "", null) } : null,
        g.exprs[key] ? { label: "Remove part-wide expression", icon: "close", action: () => st.mutate("Remove expression", () => delete g.exprs[key]) } : null,
        "sep",
        tr ? { label: "Hide from timeline", icon: "eyeOff", action: () => this.setTrackHidden(g, key, true) } : null,
        { label: tr && tr.muted ? "Unmute" : "Mute", icon: tr && tr.muted ? "sound" : "mute", action: () => st.mutate("Mute", () => (ensureTrack(g, key).muted = !(tr && tr.muted))) },
        { label: "Export track…", icon: "export", disabled: !tr, action: () => this.ed.exportTrack(g, key) },
        "sep",
        {
          label: "Delete track",
          danger: true,
          icon: "trash",
          action: () => st.mutate("Delete track", () => { delete g.tracks[key]; delete g.exprs[key]; }),
        },
      ],
      pos,
      { ctx: true },
    );
  }
  setTrackHidden(g, key, hidden) {
    const st = this.st;
    const tr = g.tracks[key];
    if (!tr || !!tr.tlHidden === hidden) return;
    st.mutate(hidden ? "Hide track" : "Show track", () => {
      if (hidden) tr.tlHidden = true;
      else delete tr.tlHidden;
    }, "ui");
    if (hidden && st.selTrack && st.selTrack.group === g.name && st.selTrack.key === key) st.selTrack = null;
    if (hidden) toast(`${TD[key].label} hidden. The layers button on ${g.name} brings it back`);
  }
  hiddenTracksMenu(g, e) {
    const st = this.st;
    const keys = hiddenTracksOf(g);
    const items = [{ heading: "Hidden tracks" }];
    for (const key of keys) {
      const tr = g.tracks[key];
      items.push({
        label: TD[key].label + (tr.expr ? "  ƒ" : "") + (tr.muted ? "  (muted)" : ""),
        icon: "eye",
        action: () => this.setTrackHidden(g, key, false),
      });
    }
    items.push("sep", {
      label: "Show all",
      icon: "eye",
      action: () => st.mutate("Show tracks", () => {
        for (const key of keys) delete g.tracks[key].tlHidden;
        g.tlCollapsed && delete g.tlCollapsed;
      }, "ui"),
    });
    showMenu(items, { x: e.clientX, y: e.clientY }, { ctx: true });
  }
  draw() {
    const st = this.st;
    this.buildRows();
    this.clampScroll();
    const pr = window.devicePixelRatio || 1;
    const w = this.width, hh = this.height;
    for (const c of [this.canvas, this.head]) {
      const pw = Math.round(w * pr), ph = Math.round(hh * pr);
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
      c.style.width = w + "px";
      c.style.height = hh + "px";
    }
    const ctx = this.canvas.getContext("2d");
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    this.colors = this.ed.colors();
    if (st.view.tlMode === "graph") this.graph.draw(ctx, w, hh);
    else this.drawDope(ctx, w, hh);
    this.drawRuler(ctx, w);
    this.renderLabels();
    this.drawHead();
  }
  gridStep() {
    const minPx = 64;
    const steps = [1 / 60, 1 / 30, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    for (const s of steps) if (s * this.pps >= minPx) return s;
    return 600;
  }
  drawGrid(ctx, w, hh, top) {
    const c = this.colors;
    const d = this.st.doc;
    const t0 = Math.max(0, this.x2t(0)), t1 = this.x2t(w);
    if (d.musicMode) {
      const beat = 60 / d.bpm;
      const bar = beat * d.beatsPerBar;
      const div = d.snapDiv || 1;
      const sub = beat / div;
      if (div > 1 && sub * this.pps > 8) {
        ctx.fillStyle = c.grid;
        ctx.globalAlpha = 0.5;
        for (let i = Math.floor(t0 / sub); i * sub <= t1; i++) {
          if (i % div) ctx.fillRect(Math.round(this.t2x(i * sub)), top, 1, hh - top);
        }
        ctx.globalAlpha = 1;
      }
      for (let b = Math.floor(t0 / beat); b * beat <= t1; b++) {
        const x = Math.round(this.t2x(b * beat)) + 0.5;
        ctx.fillStyle = b % d.beatsPerBar === 0 ? c.grid2 : c.grid;
        if (beat * this.pps > 6 || b % d.beatsPerBar === 0) ctx.fillRect(x, top, 1, hh - top);
      }
      void bar;
      return;
    }
    const step = this.gridStep();
    const sub = step / (step >= 1 ? 4 : 5);
    const fpx = this.pps / d.fps;
    if (fpx > 7) {
      const f0 = Math.floor(t0 * d.fps), f1 = Math.ceil(t1 * d.fps);
      for (let f = f0; f <= f1; f++) {
        const x = Math.round(this.t2x(f / d.fps) - fpx / 2);
        if (f % 5 === 0) { ctx.fillStyle = c.grid; ctx.fillRect(x, top, Math.ceil(fpx), hh - top); }
        ctx.fillStyle = c.grid2;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(x, top, 1, hh - top);
        ctx.globalAlpha = 1;
      }
    } else if (sub * this.pps > 10) {
      ctx.fillStyle = c.grid;
      for (let t = Math.floor(t0 / sub) * sub; t <= t1; t += sub) ctx.fillRect(Math.round(this.t2x(t)), top, 1, hh - top);
    }
    ctx.fillStyle = c.grid2;
    for (let t = Math.floor(t0 / step) * step; t <= t1 + step; t += step) ctx.fillRect(Math.round(this.t2x(t)), top, 1, hh - top);
  }
  drawRuler(ctx, w) {
    const c = this.colors;
    const st = this.st;
    const d = st.doc;
    ctx.fillStyle = c.panel;
    ctx.fillRect(0, 0, w, RULER);
    const wave = this.ed.audio && this.ed.audio.peaks(this, w);
    if (wave) {
      ctx.fillStyle = c.accentT;
      for (let x = 0; x < w; x++) {
        const a = wave[x] * (RULER - 6);
        if (a > 0.5) ctx.fillRect(x, RULER / 2 - a / 2, 1, a);
      }
    }
    ctx.fillStyle = c.border;
    ctx.fillRect(0, RULER - 1, w, 1);
    ctx.font = "bold 10px " + this.ed.font();
    ctx.textBaseline = "middle";
    const t0 = Math.max(0, this.x2t(0)), t1 = this.x2t(w);
    if (d.musicMode) {
      const beat = 60 / d.bpm;
      const div = d.snapDiv || 1;
      const sub = beat / div;
      if (div > 1 && sub * this.pps > 6) {
        ctx.fillStyle = c.text2;
        for (let i = Math.floor(t0 / sub); i * sub <= t1; i++) {
          if (i % div) ctx.fillRect(Math.round(this.t2x(i * sub)) + 0.5, RULER - 3, 1, 3);
        }
      }
      for (let b = Math.floor(t0 / beat); b * beat <= t1; b++) {
        const x = Math.round(this.t2x(b * beat)) + 0.5;
        const isBar = b % d.beatsPerBar === 0;
        ctx.fillStyle = c.text2;
        ctx.fillRect(x, isBar ? RULER - 12 : RULER - 6, 1, isBar ? 12 : 6);
        if (isBar || beat * this.pps > 36) {
          ctx.fillStyle = isBar ? c.text : c.text2;
          ctx.fillText(isBar ? `${b / d.beatsPerBar + 1}` : `.${(b % d.beatsPerBar) + 1}`, x + 3, 10);
        }
      }
    } else {
      const step = this.gridStep();
      const sub = step / (step >= 1 ? 4 : 5);
      ctx.fillStyle = c.text2;
      if (sub * this.pps > 8) for (let t = Math.floor(t0 / sub) * sub; t <= t1; t += sub) ctx.fillRect(Math.round(this.t2x(t)) + 0.5, RULER - 5, 1, 5);
      for (let t = Math.floor(t0 / step) * step; t <= t1 + step; t += step) {
        const x = Math.round(this.t2x(t)) + 0.5;
        if (t < -1e-9) continue;
        ctx.fillStyle = c.text2;
        ctx.fillRect(x, RULER - 11, 1, 11);
        ctx.fillStyle = c.text;
        ctx.fillText(fmtRuler(t, step, d.fps, this.ed.timeFormat), x + 3, 10);
      }
    }
    if (!d.infinite) {
      const x = this.t2x(d.duration);
      if (x < w) {
        ctx.fillStyle = c.accentLt;
        ctx.fillRect(x, 0, w - x, RULER);
        ctx.fillStyle = c.accent;
        ctx.fillRect(Math.round(x), 0, 2, RULER);
      }
    }
    const sel = this.selectionSpan();
    if (sel && sel.count > 1 && sel.t1 > sel.t0) {
      const x0 = this.t2x(sel.t0), x1 = this.t2x(sel.t1);
      ctx.fillStyle = c.accentT;
      ctx.fillRect(x0, RULER - 8, x1 - x0, 6);
      ctx.fillStyle = c.accent;
      ctx.fillRect(x0 - 3, RULER - 11, 6, 10);
      ctx.fillRect(x1 - 3, RULER - 11, 6, 10);
    }
  }
  selectionSpan() {
    const infos = this.st.selectedKeyInfos();
    if (!infos.length) return null;
    let t0 = Infinity, t1 = -Infinity;
    for (const i of infos) { t0 = Math.min(t0, i.kf.sec); t1 = Math.max(t1, i.kf.sec); }
    return { t0, t1, count: infos.length, infos };
  }
  drawDope(ctx, w, hh) {
    const st = this.st;
    const c = this.colors;
    const scroll = st.view.tlScroll;
    const d = st.doc;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER, w, hh - RULER);
    ctx.clip();
    for (const r of this.rows) {
      const y = RULER + r.y - scroll;
      if (y + r.h < RULER || y > hh) continue;
      if (r.type === "group") {
        ctx.fillStyle = st.selGroups.has(r.group.name) ? c.accentLt : c.panel2;
        ctx.fillRect(0, y, w, r.h);
      } else if (r.type === "track" && st.selTrack && st.selTrack.group === r.group.name && st.selTrack.key === r.key) {
        ctx.fillStyle = c.accent10;
        ctx.fillRect(0, y, w, r.h);
      } else if (r.type === "events") { ctx.fillStyle = c.panel2; ctx.fillRect(0, y, w, r.h); }
      ctx.fillStyle = c.border;
      ctx.fillRect(0, y + r.h - 1, w, 1);
    }
    this.drawGrid(ctx, w, hh, RULER);
    if (!d.infinite) {
      const x = this.t2x(d.duration);
      if (x < w) { ctx.fillStyle = c.outside; ctx.fillRect(x, RULER, w - x, hh - RULER); }
    }
    const t0 = this.x2t(-10), t1 = this.x2t(w + 10);
    for (const r of this.rows) {
      const y = RULER + r.y - scroll;
      if (y + r.h < RULER || y > hh) continue;
      const cy = y + r.h / 2;
      if (r.type === "group") this.drawGroupSummary(ctx, r.group, y, r.h, t0, t1);
      else if (r.type === "track") this.drawTrackRow(ctx, r, y, t0, t1, w);
      else if (r.type === "events") {
        for (const ev of d.events) {
          if (ev.sec < t0 || ev.sec > t1) continue;
          const x = Math.round(this.t2x(ev.sec));
          const sel = st.selKeys.has(ev.id);
          ctx.fillStyle = sel ? c.key : c.accent;
          ctx.fillRect(x - 1, y + 3, 2, r.h - 6);
          ctx.beginPath();
          ctx.moveTo(x + 1, y + 3);
          ctx.lineTo(x + 9, y + 6.5);
          ctx.lineTo(x + 1, y + 10);
          ctx.fill();
          ctx.font = "bold 10px " + this.ed.font();
          ctx.textBaseline = "middle";
          ctx.fillStyle = sel ? c.key : c.text;
          ctx.fillText(ev.value, x + 11, cy + 2);
        }
      } else if (r.type === "data") {
        const dt = r.data;
        this.drawKeys(ctx, dt.keyframes, cy, t0, t1, dt.color || "#44ddbb", !!dt.disc, false);
      }
    }
    if (this.drag && this.drag.type === "marquee" && this.drag.moved) {
      const m = this.drag;
      const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
      ctx.fillStyle = c.accent10;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = c.accent;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
  drawGroupSummary(ctx, g, y, hgt, t0, t1) {
    const c = this.colors;
    const st = this.st;
    const times = new Map();
    for (const tr of Object.values(g.tracks))
      for (const k of tr.keyframes) {
        if (k.sec < t0 || k.sec > t1) continue;
        const key = Math.round(k.sec * 1e4);
        const cur = times.get(key);
        const sel = st.selKeys.has(k.id);
        if (!cur) times.set(key, { t: k.sec, sel, n: 1 });
        else { cur.sel ||= sel; cur.n++; }
      }
    const cy = y + hgt / 2;
    for (const { t, sel } of times.values()) {
      const x = this.t2x(t);
      keyDot(ctx, x, cy, this.keyR(), sel ? c.key : g.tlCollapsed ? c.accent : c.text2, sel ? c.keyDark : null);
    }
  }
  drawTrackRow(ctx, r, y, t0, t1, w) {
    const c = this.colors;
    const d = TD[r.key];
    const tr = r.track;
    const cy = y + r.h / 2;
    const muted = tr && tr.muted;
    const color = muted ? c.text2 : d.color;
    if (r.expr) {
      ctx.fillStyle = c.accent10;
      ctx.fillRect(0, y + 2, w, r.h - 4);
      if (!(tr && tr.keyframes.length)) {
        ctx.font = "italic bold 10px " + this.ed.font();
        ctx.fillStyle = c.accent;
        ctx.textBaseline = "middle";
        ctx.fillText("ƒ(t) " + r.expr.slice(0, 80), Math.max(4, this.t2x(0) + 4), cy);
      }
    }
    if (!tr || !tr.keyframes.length) return;
    const kfs = tr.keyframes;
    const disc = isDiscrete(r.key) && r.key !== "costume";
    const lbl = isDiscrete(r.key);
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i], b = kfs[i + 1];
      if (b.sec < t0 || a.sec > t1) continue;
      const xa = this.t2x(a.sec), xb = this.t2x(b.sec);
      const same = JSON.stringify(a.value) === JSON.stringify(b.value);
      if (disc || b.ease === "Step" || same) {
        ctx.fillStyle = hexA(color, disc || !same ? 0.14 : 0.08);
        ctx.fillRect(xa, y + 2, xb - xa, r.h - 4);
        this.holdEnd(ctx, xb, y, r.h, color);
        if (lbl) this.drawValueLabel(ctx, r.key, a.value, xa + 6, cy, xb - xa - 10);
        continue;
      }
      ctx.fillStyle = hexA(color, 0.2);
      ctx.fillRect(xa, y + 2, xb - xa, r.h - 4);
      const kr = this.keyR();
      if (xb - xa > kr * 2 + 10) {
        ctx.strokeStyle = hexA(color, 0.95);
        ctx.fillStyle = hexA(color, 0.95);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(xa + kr + 2, cy + 0.5);
        ctx.lineTo(xb - kr - 2, cy + 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(xb - kr - 2, cy + 0.5);
        ctx.lineTo(xb - kr - 7, cy - 2.5);
        ctx.lineTo(xb - kr - 7, cy + 3.5);
        ctx.fill();
      }
      if (xb - xa > 8) {
        const fn = b.ease === "Bezier" ? easeFnFor(b) : (x) => applyEase(b.ease, x);
        const rising = typeof a.value === "number" && typeof b.value === "number" ? b.value >= a.value : true;
        ctx.strokeStyle = hexA(color, 0.3);
        ctx.lineWidth = 1;
        ctx.beginPath();
        const n = Math.min(64, Math.ceil(xb - xa));
        for (let j = 0; j <= n; j++) {
          const u = j / n;
          const v = fn(u);
          const px = xa + (xb - xa) * u;
          const py = rising ? y + r.h - 4 - v * (r.h - 8) : y + 4 + v * (r.h - 8);
          j ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
    }
    if (disc && kfs.length) {
      const last = kfs[kfs.length - 1];
      const xa = this.t2x(last.sec);
      const xe = this.st.doc.infinite ? w : this.t2x(this.st.doc.duration);
      if (xe > xa) {
        ctx.fillStyle = hexA(color, 0.08);
        ctx.fillRect(xa, y + 4, xe - xa, r.h - 8);
        this.drawValueLabel(ctx, r.key, last.value, xa + 6, cy, xe - xa - 10);
      }
    }
    this.drawKeys(ctx, kfs, cy, t0, t1, color, disc, true, !!tr.expr);
  }
  keyR() { const fpx = this.pps / this.st.doc.fps; return Math.max(3, Math.min(5, fpx / 2 - 1)); }
  holdEnd(ctx, xb, y, h, color) {
    const fpx = this.pps / this.st.doc.fps;
    if (fpx < 7) return;
    const x = Math.round(xb - fpx * 1.5 + 2) + 0.5;
    const w = Math.max(3, Math.round(fpx - 4));
    ctx.fillStyle = this.colors.panel;
    ctx.fillRect(x, y + h / 2 - 4, w, 8);
    ctx.strokeStyle = hexA(color, 0.9);
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y + h / 2 - 4, w, 8);
  }
  drawValueLabel(ctx, key, value, x, cy, maxW) {
    if (maxW < 16) return;
    let text;
    if (key === "costume") text = value && typeof value === "object" ? value.name ?? "blank" : String(value);
    else if (TD[key].bool) text = value ? "on" : "off";
    else text = String(value === "" ? "none" : value);
    ctx.font = "bold 9px " + this.ed.font();
    ctx.textBaseline = "middle";
    ctx.fillStyle = this.colors.text2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, cy - 8, maxW, 16);
    ctx.clip();
    ctx.fillText(text, x, cy + 1);
    ctx.restore();
  }
  drawKeys(ctx, kfs, cy, t0, t1, color, square, exprMark, trackExpr = false) {
    const c = this.colors;
    const st = this.st;
    for (const k of kfs) {
      if (k.sec < t0 || k.sec > t1) continue;
      const x = this.t2x(k.sec);
      const sel = st.selKeys.has(k.id);
      if (square) {
        ctx.fillStyle = sel ? c.key : color;
        ctx.fillRect(Math.round(x) - 3, cy - 6, 6, 12);
        if (sel) { ctx.strokeStyle = c.keyDark; ctx.strokeRect(Math.round(x) - 3.5, cy - 6.5, 7, 13); }
      } else keyDot(ctx, x, cy, this.keyR() + (sel ? 1 : 0), sel ? c.key : c.text, sel ? c.keyDark : hexA(color, 0.9));
      if (exprMark && k.expr) {
        ctx.fillStyle = c.accent;
        ctx.beginPath();
        ctx.arc(x, cy - 8, 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (exprMark && trackExpr) {
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, cy - 8, 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (k.rand) {
        ctx.fillStyle = sel ? c.keyDark || c.key : color;
        ctx.fillRect(Math.round(x) - 4, cy + 7, 8, 1.5);
        ctx.fillRect(Math.round(x) - 0.75, cy + 5, 1.5, 4);
      }
    }
  }
  drawHead() {
    const st = this.st;
    const c = this.colors || this.ed.colors();
    const pr = window.devicePixelRatio || 1;
    const ctx = this.head.getContext("2d");
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    const w = this.width, hh = this.height;
    ctx.clearRect(0, 0, w, hh);
    this.drawRemoteHeads(ctx, w, hh);
    const x = Math.round(this.t2x(st.sec)) + 0.5;
    if (x < -2 || x > w + 2) return;
    ctx.fillStyle = c.accent;
    ctx.fillRect(x - 0.5, RULER - 2, 2, hh - RULER + 2);
    const label = fmtHead(st.sec, st.doc, this.ed.timeFormat);
    ctx.font = "bold 10px " + this.ed.font();
    const tw = ctx.measureText(label).width + 10;
    const bx = clamp(x - tw / 2, 0, w - tw);
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bx, 2, tw, 16, 8) : ctx.rect(bx, 2, tw, 16);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 4, 17);
    ctx.lineTo(x + 4, 17);
    ctx.lineTo(x + 0.5, RULER - 2);
    ctx.fill();
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--dimod-on-accent").trim() || "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, bx + 5, 10.5);
  }
  drawRemoteHeads(ctx, w, hh) {
    const people = this.ed.remotePeople ? this.ed.remotePeople() : [];
    if (!people.length) return;
    const d = this.st.doc;
    ctx.font = "bold 9px " + this.ed.font();
    ctx.textBaseline = "middle";
    for (const p of people) {
      let sec = p.sec;
      if (!d.infinite && d.duration > 0) sec = p.playing ? ((sec % d.duration) + d.duration) % d.duration : Math.min(sec, d.duration);
      const x = Math.round(this.t2x(sec)) + 0.5;
      if (x < -2 || x > w + 2) continue;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x - 0.5, RULER, 1.5, hh - RULER);
      ctx.globalAlpha = 1;
      const tw = ctx.measureText(p.name).width + 8;
      const bx = clamp(x + 3, 0, w - tw);
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, RULER + 2, tw, 13, 6) : ctx.rect(bx, RULER + 2, tw, 13);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(p.name, bx + 4, RULER + 9);
    }
  }
  keysNear(r, x) {
    const out = [];
    const t = (k) => Math.abs(this.t2x(k.sec) - x) <= 6;
    if (r.type === "track" && r.track) for (const k of r.track.keyframes) t(k) && out.push(k.id);
    else if (r.type === "events") for (const e of this.st.doc.events) Math.abs(this.t2x(e.sec) - x) <= 8 && out.push(e.id);
    else if (r.type === "data") for (const k of r.data.keyframes) t(k) && out.push(k.id);
    else if (r.type === "group") for (const tr of Object.values(r.group.tracks)) for (const k of tr.keyframes) t(k) && out.push(k.id);
    return out;
  }
  keysInRect(x0, y0, x1, y1) {
    const ta = this.x2t(Math.min(x0, x1)), tb = this.x2t(Math.max(x0, x1));
    const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
    const out = [];
    const scroll = this.st.view.tlScroll;
    for (const r of this.rows) {
      const ry = RULER + r.y - scroll + r.h / 2;
      if (ry < ya || ry > yb) continue;
      const add = (k) => k.sec >= ta && k.sec <= tb && out.push(k.id);
      if (r.type === "track" && r.track) r.track.keyframes.forEach(add);
      else if (r.type === "events") this.st.doc.events.forEach(add);
      else if (r.type === "data") r.data.keyframes.forEach(add);
      else if (r.type === "group" && r.group.tlCollapsed) for (const tr of Object.values(r.group.tracks)) tr.keyframes.forEach(add);
    }
    return out;
  }
  snapTime(t, exclude) {
    const st = this.st;
    let s = st.snap(t);
    if (st.view.snapToKeys) {
      let best = null, bd = 8 / this.pps;
      for (const tt of this.allTimes()) {
        if (exclude && exclude.has(tt)) continue;
        const dd = Math.abs(tt - t);
        if (dd < bd) { bd = dd; best = tt; }
      }
      if (best !== null) s = best;
      if (Math.abs(st.sec - t) < bd) s = st.sec;
    }
    return s;
  }
  bindEvents() {
    const wrap = this.wrap;
    const st = this.st;
    const pos = (e) => { const r = wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    wrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [x, y] = pos(e);
      if (st.view.tlMode === "graph" && (e.altKey || (!e.ctrlKey && !e.shiftKey && y > RULER && this.graph.wantsWheel(e)))) {
        this.graph.wheel(e, x, y);
        return;
      }
      if (e.ctrlKey || e.metaKey || (!e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY) && y < RULER)) {
        this.zoomAt(Math.pow(1.0018, -e.deltaY * prefs.zoomSpeed * (e.ctrlKey ? 2 : 1)), x);
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        st.view.tlPan += (e.shiftKey ? e.deltaY : e.deltaX) / this.pps;
        this.clampPan();
        this.ed.invalidate("timeline");
      } else { st.view.tlScroll += e.deltaY * prefs.scrollSpeed; this.clampScroll(); this.ed.invalidate("timeline"); }
    }, { passive: false });
    this.labelList.addEventListener("wheel", (e) => {
      e.preventDefault();
      st.view.tlScroll += e.deltaY * prefs.scrollSpeed;
      this.clampScroll();
      this.ed.invalidate("timeline");
    }, { passive: false });
    wrap.addEventListener("mousedown", (e) => {
      wrap.focus({ preventScroll: true });
      const [x, y] = pos(e);
      if (e.button === 1 || (e.button === 0 && e.altKey && y >= RULER && st.view.tlMode === "dope")) {
        e.preventDefault();
        this.startPan(e);
        return;
      }
      if (y < RULER) {
        if (e.button !== 0) return;
        const sel = this.selectionSpan();
        if (sel && sel.count > 1 && sel.t1 > sel.t0 && y > RULER - 13) {
          const x0 = this.t2x(sel.t0), x1 = this.t2x(sel.t1);
          if (Math.abs(x - x0) <= 5) return this.startScale(e, sel, sel.t1, x);
          if (Math.abs(x - x1) <= 5) return this.startScale(e, sel, sel.t0, x);
        }
        this.startScrub(e, x);
        return;
      }
      if (st.view.tlMode === "graph") return this.graph.mousedown(e, x, y);
      this.dopeDown(e, x, y);
    });
    wrap.addEventListener("dblclick", (e) => {
      const [x, y] = pos(e);
      if (y < RULER || st.view.tlMode === "graph") return st.view.tlMode === "graph" ? this.graph.dblclick(e, x, y) : null;
      const r = this.rowAt(y);
      if (!r) return;
      this.addKeyOnRow(r, this.snapTime(this.x2t(x)));
    });
    wrap.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const [x, y] = pos(e);
      if (st.view.tlMode === "graph") return this.graph.contextmenu(e, x, y);
      const r = this.rowAt(y);
      if (!r) return;
      const near = this.keysNear(r, x);
      if (near.length) {
        if (!near.some((id) => st.selKeys.has(id))) st.selectKeys(near);
        this.keyMenu({ x: e.clientX, y: e.clientY });
      } else this.emptyMenu(r, this.snapTime(this.x2t(x)), { x: e.clientX, y: e.clientY });
    });
    wrap.addEventListener("mousemove", (e) => {
      if (this.drag) return;
      const [x, y] = pos(e);
      let cur = "default";
      if (y < RULER) {
        cur = "col-resize";
        const sel = this.selectionSpan();
        if (sel && sel.count > 1 && y > RULER - 13 && (Math.abs(x - this.t2x(sel.t0)) <= 5 || Math.abs(x - this.t2x(sel.t1)) <= 5)) cur = "ew-resize";
      } else if (st.view.tlMode === "graph") cur = this.graph.cursorAt(x, y);
      else {
        const r = this.rowAt(y);
        if (r && this.keysNear(r, x).length) cur = "pointer";
      }
      wrap.style.cursor = cur;
    });
  }
  startPan(e) {
    const st = this.st;
    const p0 = st.view.tlPan, s0 = st.view.tlScroll;
    const move = (ev) => {
      st.view.tlPan = p0 - (ev.clientX - e.clientX) / this.pps;
      st.view.tlScroll = s0 - (ev.clientY - e.clientY);
      this.clampPan();
      this.clampScroll();
      this.ed.invalidate("timeline");
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  startScrub(e, x) {
    const st = this.st;
    if (st.playing) this.ed.pause();
    const set = (px) => st.setTime(this.snapTime(this.x2t(px)));
    set(x);
    const rect = this.wrap.getBoundingClientRect();
    let auto = 0;
    let lastX = x;
    const tick = () => {
      if (!this.drag) return;
      const w = this.width;
      if (lastX < 20) st.view.tlPan -= (20 - lastX) * 0.02 / this.st.view.tlZoom;
      else if (lastX > w - 20) st.view.tlPan += (lastX - (w - 20)) * 0.02 / this.st.view.tlZoom;
      else return (auto = requestAnimationFrame(tick));
      this.clampPan();
      set(lastX);
      this.ed.invalidate("timeline");
      auto = requestAnimationFrame(tick);
    };
    this.drag = { type: "scrub" };
    auto = requestAnimationFrame(tick);
    const move = (ev) => { lastX = ev.clientX - rect.left; set(lastX); };
    const up = () => {
      cancelAnimationFrame(auto);
      this.drag = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  dopeDown(e, x, y) {
    const st = this.st;
    const r = this.rowAt(y);
    if (e.button !== 0) return;
    const near = r ? this.keysNear(r, x) : [];
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (r && r.type !== "events" && r.type !== "data" && r.group) {
      if (r.type === "track") st.selTrack = { group: r.group.name, key: r.key };
      if (!st.selGroups.has(r.group.name) || !additive) {
        if (!st.selGroups.has(r.group.name)) st.selectGroup(r.group.name, additive);
      }
    }
    if (near.length) {
      if (additive) {
        const allSel = near.every((id) => st.selKeys.has(id));
        for (const id of near) allSel ? st.selKeys.delete(id) : st.selKeys.add(id);
        st.emit("sel");
        return;
      }
      if (!near.some((id) => st.selKeys.has(id))) st.selectKeys(near);
      this.startMoveKeys(e, x, e.altKey);
      return;
    }
    this.drag = { type: "marquee", x0: x, y0: y, x1: x, y1: y, moved: false, base: additive ? new Set(st.selKeys) : new Set() };
    const rect = this.wrap.getBoundingClientRect();
    const move = (ev) => {
      const d = this.drag;
      d.x1 = ev.clientX - rect.left;
      d.y1 = Math.max(RULER, ev.clientY - rect.top);
      if (!d.moved && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 4) return;
      d.moved = true;
      const ids = this.keysInRect(d.x0, d.y0, d.x1, d.y1);
      st.selKeys = new Set([...d.base, ...ids]);
      st.emit("sel");
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved) {
        if (!additive) st.clearKeys();
        st.setTime(this.snapTime(this.x2t(d.x0)));
      }
      this.ed.invalidate("timeline");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  startMoveKeys(e, x0, duplicate) {
    const st = this.st;
    let infos = st.selectedKeyInfos();
    if (!infos.length) return;
    const orig = new Map(infos.map((i) => [i.kf, i.kf.sec]));
    const excluded = new Set(infos.map((i) => i.kf.sec));
    let moved = false;
    let applied = 0;
    this.drag = { type: "move" };
    const rect = this.wrap.getBoundingClientRect();
    const anchor = infos.reduce((a, i) => (Math.abs(this.t2x(i.kf.sec) - x0) < Math.abs(this.t2x(a.kf.sec) - x0) ? i : a), infos[0]);
    const anchorT = anchor.kf.sec;
    const move = (ev) => {
      const x = ev.clientX - rect.left;
      if (!moved && Math.abs(x - x0) < 3) return;
      if (!moved) {
        moved = true;
        st.beginChange(duplicate ? "Duplicate keys" : "Move keys");
        if (duplicate) {
          const clip = copyKeys(infos);
          const t0 = Math.min(...infos.map((i) => i.kf.sec));
          pasteKeys(st.doc, clip, t0, null);
          st.reindex();
          infos = st.selectedKeyInfos();
        }
      }
      const target = this.snapTime(anchorT + (x - x0) / this.pps, excluded);
      const want = target - anchorT;
      const dt = want - applied;
      if (Math.abs(dt) < 1e-9) return;
      st.live(() => { const real = moveKeys(st.doc, infos, dt, st.doc.infinite ? Infinity : st.doc.duration); applied += real; });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      this.drag = null;
      if (moved) st.endChange();
      else {
        const i = infos[0];
        st.selectKeys(infos.map((x) => x.kf.id));
        if (!e.shiftKey) st.setTime(i.kf.sec);
      }
      void orig;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  startScale(e, sel, anchor, x0) {
    const st = this.st;
    const items = sel.infos.map((info) => ({ info, orig: info.kf.sec }));
    const span0 = sel.t1 - sel.t0;
    const grabT = anchor === sel.t0 ? sel.t1 : sel.t0;
    const rect = this.wrap.getBoundingClientRect();
    st.beginChange("Scale keys");
    this.drag = { type: "scale" };
    const move = (ev) => {
      const x = ev.clientX - rect.left;
      const t = this.snapTime(grabT + (x - x0) / this.pps);
      let factor = (t - anchor) / (grabT - anchor);
      if (!Number.isFinite(factor)) return;
      if (Math.abs(factor * span0) < 1e-3) factor = 1e-3 / span0;
      st.live(() => scaleKeys(st.doc, items, anchor, factor));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      this.drag = null;
      st.endChange();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  addKeyOnRow(r, t) {
    const st = this.st;
    if (r.type === "events") {
      st.mutate("Add event", (d) => {
        const ev = { sec: t, value: "event", id: makeKFID() };
        d.events.push(ev);
        d.events.sort((a, b) => a.sec - b.sec);
        st.selKeys = new Set([ev.id]);
      });
      this.ed.renameEvent([...st.selKeys][0]);
      return;
    }
    if (r.type === "data") {
      const dt = r.data;
      const s = new Sampler({ keyframes: dt.keyframes }, dt.disc ? "zIndex" : "x");
      const v = dt.keyframes.length ? (dt.disc ? s.sampleAny(t) : s.sampleNum(t)) : 0;
      st.mutate("Add data key", () => {
        dt.keyframes = dt.keyframes.filter((k) => !sameSec(k.sec, t));
        const kf = { sec: t, value: v, ease: dt.disc ? "Step" : "Linear_Out", id: makeKFID() };
        dt.keyframes.push(kf);
        sortTrack(dt);
        st.selKeys = new Set([kf.id]);
      });
      return;
    }
    const g = r.group;
    const keys = r.type === "track" ? [r.key] : Object.keys(g.tracks).filter((k) => g.tracks[k].keyframes.length);
    if (!keys.length) return this.addTrackMenu(g, { clientX: 0, clientY: 0 });
    st.mutate("Add keyframe", () => {
      const ids = [];
      for (const k of keys) {
        const v = k === "costume" ? costumeRefAt(st, g, t) : valueForKey(st, g, k, t);
        ids.push(setKey(g, k, t, v, { exact: true }).id);
      }
      st.selKeys = new Set(ids);
    });
  }
  keyMenu(pos) {
    const st = this.st;
    const infos = st.selectedKeyInfos();
    const trackInfos = infos.filter((i) => i.kind !== "event");
    const exprInfos = infos.filter(canHaveExpr);
    const randInfos = infos.filter(canBeRandom);
    const easeItems = () => [
      { label: "Linear", action: () => this.ed.setEase("Linear_Out") },
      { label: "Step (hold)", action: () => this.ed.setEase("Step") },
      "sep",
      ...EASE_FAMS.filter((f) => f !== "Linear").map((f) => ({
        label: f,
        submenu: () => ["In", "Out", "InOut"].map((dir) => ({ label: `${f} ${dir === "InOut" ? "In-Out" : dir}`, action: () => this.ed.setEase(`${f}_${dir}`) })),
      })),
      "sep",
      { label: "Custom curve (Bezier)", action: () => this.ed.setEase("Bezier") },
    ];
    const single = infos.length === 1 ? infos[0] : null;
    showMenu(
      [
        { heading: `${infos.length} key${infos.length === 1 ? "" : "s"}` },
        { label: "Easing", icon: "graph", submenu: easeItems, disabled: !trackInfos.length },
        exprInfos.length ? { label: exprInfos.some((i) => i.kf.expr) ? "Edit expression…" : "Add expression…", icon: "expr", action: () => this.ed.openExpr(exprInfos.map((i) => i.kf.id)) } : null,
        exprInfos.some((i) => i.kf.expr) ? { label: "Clear expression", icon: "close", action: () => setKeysExpr(st, exprInfos.map((i) => i.kf.id), "", null) } : null,
        randInfos.length ? { label: randInfos.every((i) => i.kf.rand) ? "Fixed value" : "Random value", icon: "dice", action: () => {
          const on = !randInfos.every((i) => i.kf.rand);
          st.mutate(on ? "Random value" : "Fixed value", () => setKeysRandom(randInfos, on));
        } } : null,
        single && single.kind === "event" ? { label: "Rename event…", icon: "flag", action: () => this.ed.renameEvent(single.kf.id) } : null,
        "sep",
        { label: "Copy", icon: "copy", kbd: "Ctrl+C", action: () => this.ed.cmd("copy") },
        { label: "Paste at playhead", icon: "paste", kbd: "Ctrl+V", action: () => this.ed.cmd("paste") },
        { label: "Duplicate at playhead", icon: "copy", kbd: "Ctrl+D", action: () => this.ed.cmd("duplicateKeys") },
        { label: "Reverse", icon: "reverse", disabled: infos.length < 2, action: () => this.ed.cmd("reverseKeys") },
        trackInfos.length && st.doc.groups.length > 1 ? { label: "Move to part", icon: "chevronRight", submenu: () => this.partTargets(trackInfos, true) } : null,
        trackInfos.length && st.doc.groups.length > 1 ? { label: "Copy to part", icon: "copy", submenu: () => this.partTargets(trackInfos, false) } : null,
        { label: "Save as preset…", icon: "star", disabled: !trackInfos.length, action: () => this.ed.savePreset() },
        "sep",
        { label: "Delete", icon: "trash", kbd: "Del", danger: true, action: () => this.ed.cmd("deleteKeys") },
      ],
      pos,
      { ctx: true },
    );
  }
  partTargets(infos, move) {
    const st = this.st;
    const src = new Set(infos.map((i) => i.group.name));
    return st.doc.groups
      .filter((g) => !(src.size === 1 && src.has(g.name)))
      .map((g) => ({
        label: g.name,
        action: () => st.mutate(move ? "Move keys to part" : "Copy keys to part", (doc) => {
          const clip = copyKeys(infos);
          if (move) deleteKeys(doc, infos);
          for (const it of clip.items) it.group = g.name;
          const t0 = Math.min(...infos.map((i) => i.kf.sec));
          st.selKeys = new Set(pasteKeys(doc, clip, t0, g));
        }),
      }));
  }
  emptyMenu(r, t, pos) {
    const st = this.st;
    const items = [];
    if (r.type === "events") items.push({ label: "Add event here", icon: "flag", action: () => this.addKeyOnRow(r, t) });
    else if (r.type === "data") items.push({ label: "Add key here", icon: "addKey", action: () => this.addKeyOnRow(r, t) });
    else if (r.group) {
      items.push({ label: r.type === "track" ? "Add key here" : "Key all tracks here", icon: "addKey", action: () => this.addKeyOnRow(r, t) });
      items.push({ label: "Add property track", icon: "plus", action: () => this.addTrackMenu(r.group, { clientX: pos.x, clientY: pos.y }) });
    }
    items.push({ label: "Paste here", icon: "paste", disabled: !this.ed.clipboard, action: () => this.ed.paste(t) });
    items.push("sep", { label: "Set playhead here", icon: "target", action: () => st.setTime(t) });
    showMenu(items, pos, { ctx: true });
  }
}
function valueForKey(st, g, key, t) {
  const d = TD[key];
  if (d.str) {
    const tr = g.tracks[key];
    if (!tr || !tr.keyframes.length) return d.def;
    const s = new Sampler(tr, key);
    return s.sampleAny(t);
  }
  const tr = g.tracks[key];
  if (tr && tr.keyframes.length) { const s = new Sampler(tr, key); return d.kind === "disc" ? s.sampleAny(t) : s.sampleNum(t); }
  return st.valueAt(g.name, key, t) ?? d.def;
}
function costumeRefAt(st, g, t = st.sec) {
  const gi = st.groupIndex(g.name);
  const pose = t === st.sec ? st.currentPose() : st.poseAt(t);
  const idx = pose.costume[gi];
  const b = st.bindings()[gi];
  if (!b || idx < 0) return { name: null, index: -9 };
  return { name: b.names[idx], index: idx };
}
function keyDot(ctx, x, y, r, fill, stroke) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); }
}
function diamond(ctx, x, y, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
function hexA(hex, a) {
  if (hex.startsWith("#") && hex.length === 7) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return hex;
}
function fmtRuler(t, step, fps, fmt) {
  if (fmt === "frames") return String(Math.round(t * fps));
  if (step < 1) return t.toFixed(step < 0.1 || Math.abs(step * 10 - Math.round(step * 10)) > 1e-9 ? 2 : 1) + "s";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m ? `${m}:${String(Math.round(s)).padStart(2, "0")}` : Math.round(t) + "s";
}
function fmtHead(t, doc, fmt) {
  if (doc.musicMode) {
    const beat = 60 / doc.bpm;
    const b = t / beat;
    return `${Math.floor(b / doc.beatsPerBar) + 1}.${Math.floor(b % doc.beatsPerBar) + 1}.${String(Math.floor((b % 1) * 100)).padStart(2, "0")}`;
  }
  if (fmt === "frames") return "f " + Math.round(t * doc.fps);
  return t.toFixed(2) + "s";
}
const vm = () => getEditorVM();
const ACCEPT = ".ks5anim,.ks5group,.ks4anim,.ks4group,.ks4track,.json,application/json";
async function readJSONFile(file) {
  const text = await file.text();
  try { return JSON.parse(text); } catch (e) { throw new Error(`"${file.name}" isn't a valid animation file (${e.message}).`); }
}
const safeName = (s) => String(s || "animation").replace(/[^\w\- ]+/g, "_").trim() || "animation";
function costumeToAsset(c) {
  const data = c.asset && c.asset.data;
  if (!data) return null;
  return {
    name: c.name,
    dataFormat: c.dataFormat || (c.asset.dataFormat ?? "png"),
    rotationCenterX: c.rotationCenterX ?? 0,
    rotationCenterY: c.rotationCenterY ?? 0,
    bitmapResolution: c.bitmapResolution || 1,
    assetId: c.assetId || c.asset.assetId || "",
    data: bytesToBase64(data instanceof Uint8Array ? data : new Uint8Array(data)),
  };
}
function collectAssets(doc, groups, target) {
  const runtime = vm().runtime;
  const assets = [];
  const indexById = new Map();
  const groupAssets = {};
  for (const g of groups) {
    const sprite = g.spriteName === THIS_SPRITE ? target && target.sprite : findGroupSprite(runtime, g);
    if (!sprite) continue;
    const list = [];
    for (const c of sprite.costumes) {
      const key = (c.assetId || "") + "|" + c.name;
      let i = indexById.get(key);
      if (i === undefined) {
        const a = costumeToAsset(c);
        if (!a) continue;
        i = assets.length;
        assets.push(a);
        indexById.set(key, i);
      }
      list.push(i);
    }
    groupAssets[g.name] = list;
  }
  return { assets, groupAssets };
}
function animFileObject(doc, target) {
  const { assets, groupAssets } = collectAssets(doc, doc.groups, target);
  return { type: "ks5-anim", v: DOC_VERSION, anim: JSON.parse(JSON.stringify(doc)), assets, groupAssets };
}
function exportAnimFile(doc, target) {
  downloadBlob(JSON.stringify(animFileObject(doc, target)), safeName(doc.name || doc.id) + ".ks5anim", "application/json");
}
async function animFromFileObject(obj, target) {
  const parsed = parseAnimationFile(obj);
  if (parsed.kind !== "anim") throw new Error("That isn't a whole animation.");
  const res = await materializeGroups(parsed, target, { ask: false });
  return normalizeAnim({ ...parsed.anim, groups: res.groups });
}
function exportGroupsFile(doc, groupNames, target) {
  const groups = doc.groups.filter((g) => groupNames.includes(g.name));
  if (!groups.length) return;
  const { assets, groupAssets } = collectAssets(doc, groups, target);
  const out = { type: "ks5-group", v: DOC_VERSION, groups: JSON.parse(JSON.stringify(groups)), assets, groupAssets };
  const name = groups.length === 1 ? groups[0].name : `${groups.length} parts`;
  downloadBlob(JSON.stringify(out), safeName(name) + ".ks5group", "application/json");
}
function exportTrackFile(group, key) {
  const tr = group.tracks[key];
  if (!tr) return;
  const out = { type: "ks4-track", groupName: group.name, trackType: key, track: JSON.parse(JSON.stringify(tr)) };
  downloadBlob(JSON.stringify(out, null, 2), safeName(group.name) + "__" + key + ".ks4track.json", "application/json");
}
function parseAnimationFile(obj, fileName = "") {
  const images = new Map();
  const fromAssets = (assets, groupAssets) => {
    for (const [gname, idxs] of Object.entries(groupAssets || {})) {
      const list = [];
      for (const i of idxs) {
        const a = assets[i];
        if (!a || !a.data) continue;
        list.push({
          name: a.name,
          bytes: base64ToBytes(a.data),
          dataFormat: a.dataFormat,
          rotationCenterX: a.rotationCenterX,
          rotationCenterY: a.rotationCenterY,
          bitmapResolution: a.bitmapResolution || 1,
          assetId: a.assetId || "",
        });
      }
      images.set(gname, list);
    }
  };
  if (obj && obj.type === "ks5-anim" && obj.anim) {
    fromAssets(obj.assets || [], obj.groupAssets);
    return { kind: "anim", anim: obj.anim, groups: obj.anim.groups || [], images };
  }
  if (obj && obj.type === "ks5-group" && Array.isArray(obj.groups)) {
    fromAssets(obj.assets || [], obj.groupAssets);
    return { kind: "groups", groups: obj.groups, images };
  }
  if (obj && obj.type === "ks4-group" && obj.group) {
    const g = obj.group;
    const list = [];
    const costumes = Array.isArray(g.costumes) ? g.costumes : [];
    costumes.forEach((url, i) => {
      if (typeof url !== "string" || !url.startsWith("data:")) return;
      const { mime, bytes } = dataURLToBytes(url);
      const fmt = mime.includes("svg") ? "svg" : mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
      const rc = (g.rotCenters && g.rotCenters[i]) || { x: 0, y: 0 };
      list.push({
        name: (g.costumeNames && g.costumeNames[i]) || `costume${i + 1}`,
        bytes: fmt === "svg" ? stripInjectedUid(bytes) : bytes,
        dataFormat: fmt,
        rotationCenterX: rc.x || 0,
        rotationCenterY: rc.y || 0,
        bitmapResolution: fmt === "svg" ? 1 : 2,
      });
    });
    images.set(g.name || "Object", list);
    return { kind: "groups", groups: [g], images };
  }
  if (obj && obj.type === "ks4-track" && obj.track && obj.trackType) { return { kind: "track", track: obj, images }; }
  if (obj && (obj._ks4export || (Array.isArray(obj.groups) && obj.id))) {
    return { kind: "anim", anim: obj, groups: obj.groups || [], images };
  }
  throw new Error(`"${fileName || "This file"}" isn't a KS4/KS5 animation, part or track file.`);
}
function stripInjectedUid(bytes) {
  try {
    const s = new TextDecoder().decode(bytes);
    const out = s.replace(/<circle cx="0\.5" cy="0\.5" r="0\.001" fill="rgb\(\d+,\d+,\d+\)" fill-opacity="0\.000001"\/>/g, "");
    return out === s ? bytes : new TextEncoder().encode(out);
  } catch { return bytes; }
}
async function md5Of(bytes) {
  const storage = vm().runtime.storage;
  const asset = storage.createAsset(storage.AssetType.ImageBitmap, storage.DataFormat.PNG, bytes, null, true);
  return asset.assetId;
}
async function addCostumesToTarget(target, list) {
  const storage = vm().runtime.storage;
  const binding = bindingForSprite(target.sprite);
  const renamed = new Map();
  const prevCostume = target.currentCostume;
  let added = 0;
  const existingByAsset = new Map();
  target.sprite.costumes.forEach((c) => existingByAsset.set(c.assetId, c.name));
  const taken = new Set(target.sprite.costumes.map((c) => c.name));
  for (const img of list) {
    const isSvg = img.dataFormat === "svg";
    const asset = storage.createAsset(
      isSvg ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap,
      isSvg ? storage.DataFormat.SVG : img.dataFormat === "jpg" ? storage.DataFormat.JPG : storage.DataFormat.PNG,
      img.bytes,
      null,
      true,
    );
    const same = existingByAsset.get(asset.assetId);
    if (same !== undefined) {
      if (same !== img.name) renamed.set(img.name, same);
      continue;
    }
    let name = img.name;
    if (taken.has(name)) { name = uniqueName(name, taken); renamed.set(img.name, name); }
    taken.add(name);
    const costume = {
      name,
      dataFormat: isSvg ? "svg" : img.dataFormat === "jpg" ? "jpg" : "png",
      asset,
      assetId: asset.assetId,
      md5: `${asset.assetId}.${isSvg ? "svg" : img.dataFormat === "jpg" ? "jpg" : "png"}`,
      rotationCenterX: img.rotationCenterX,
      rotationCenterY: img.rotationCenterY,
      bitmapResolution: isSvg ? 1 : img.bitmapResolution || 2,
      skinId: null,
    };
    await vm().addCostume(costume.md5, costume, target.id);
    existingByAsset.set(asset.assetId, name);
    added++;
  }
  if (added) {
    try { target.setCostume(prevCostume); } catch {}
  }
  void binding;
  return { added, renamed };
}
function patchCostumeNames(g, renamed) {
  if (!renamed.size) return;
  g.costumeNames = (g.costumeNames || []).map((n) => renamed.get(n) || n);
  const tr = g.tracks && g.tracks.costume;
  if (tr)
    for (const kf of tr.keyframes || []) {
      const v = kf.value;
      if (v && typeof v === "object" && renamed.has(v.name)) kf.value = { ...v, name: renamed.get(v.name) };
      else if (typeof v === "string" && renamed.has(v)) kf.value = renamed.get(v);
    }
}
async function materializeGroups(parsed, target, { ask = true } = {}) {
  const runtime = vm().runtime;
  const warnings = [];
  const groups = parsed.groups.map((g) => JSON.parse(JSON.stringify(g)));
  let dest = null;
  const needsDest = groups.filter((g) => {
    const imgs = parsed.images.get(g.name);
    if (!imgs || !imgs.length) return false;
    const sp = g.spriteName && g.spriteName !== THIS_SPRITE ? findGroupSprite(runtime, { spriteName: g.spriteName }) : g.spriteName === THIS_SPRITE && target ? target.sprite : null;
    if (sp) {
      const b = bindingForSprite(sp);
      const all = imgs.every((im) => b.byName.has(im.name) && (!im.assetId || b.assetIds[b.byName.get(im.name)] === im.assetId));
      if (all) return false;
    }
    return true;
  });
  if (needsDest.length) {
    const sprites = runtime.targets.filter((t) => t.isOriginal && !t.isStage);
    if (!sprites.length) throw new Error("This project has no sprites to put the imported costumes in.");
    let chosen = target && !target.isStage ? target : null;
    if (ask) {
      const opts = sprites.map((t) => {
        const c = t.getCostumes()[t.currentCostume];
        let img = "";
        try { img = c && c.asset ? c.asset.encodeDataURI() : ""; } catch {}
        return { value: t.id, label: t.sprite.name, sub: t === target ? "this sprite" : `${t.sprite.costumes.length} costumes`, img, special: t === target };
      });
      const names = needsDest.map((g) => `"${g.name}"`).join(", ");
      const id = await chooseDialog("Add imported costumes to…", opts, {
        hint: `${names} ${needsDest.length === 1 ? "brings" : "bring"} costume images with ${needsDest.length === 1 ? "it" : "them"}. Pick the sprite they should be added to. Identical costumes already there are reused.`,
      });
      if (!id) return null;
      chosen = runtime.getTargetById(id);
    }
    dest = chosen;
  }
  for (const g of groups) {
    const imgs = parsed.images.get(g.name);
    if (dest && imgs && imgs.length && needsDest.includes(g)) {
      const { renamed } = await addCostumesToTarget(dest, imgs);
      patchCostumeNames(g, renamed);
      if (g.spriteName === THIS_SPRITE && dest === target) {
      } else { g.spriteName = dest.sprite.name; g.targetId = dest.id; }
    } else if (g.spriteName && g.spriteName !== THIS_SPRITE) {
      const sp = findGroupSprite(runtime, { spriteName: g.spriteName, targetId: g.targetId });
      if (!sp) warnings.push(`Sprite "${g.spriteName}" isn't in this project, so "${g.name}" will be blank until you pick a sprite for it.`);
      else {
        const t = runtime.targets.find((x) => x.isOriginal && x.sprite === sp);
        if (t) g.targetId = t.id;
      }
    }
    delete g.costumes;
    delete g.rotCenters;
  }
  return { groups, warnings };
}
function mergeGroups(doc, groups) {
  const taken = new Set(doc.groups.map((g) => g.name));
  const rename = new Map();
  const added = [];
  for (const g of groups) {
    const ng = normalizeGroup(g);
    const name = uniqueName(ng.name, taken);
    taken.add(name);
    if (name !== ng.name) rename.set(ng.name, name);
    ng.name = name;
    for (const tr of Object.values(ng.tracks)) for (const kf of tr.keyframes) kf.id = makeKFID();
    added.push(ng);
  }
  for (const g of added) {
    for (const key of ["relativeTo", "maskSource"]) {
      const tr = g.tracks[key];
      if (tr) for (const kf of tr.keyframes) if (rename.has(kf.value)) kf.value = rename.get(kf.value);
    }
  }
  doc.groups.push(...added);
  return added;
}
async function pickAndParse(accept = ACCEPT) {
  const [file] = await pickFiles(accept);
  if (!file) return null;
  const obj = await readJSONFile(file);
  return parseAnimationFile(obj, file.name);
}
async function importAnimFile(target) {
  try {
    const parsed = await pickAndParse();
    if (!parsed) return null;
    return await animFromParsed(parsed, target);
  } catch (e) { await alertDialog("Couldn't import", e.message || String(e)); return null; }
}
async function animFromParsed(parsed, target) {
  if (parsed.kind === "track") throw new Error("That's a single track. Open an animation and import it into a part instead.");
  const res = await materializeGroups(parsed, target);
  if (!res) return null;
  let doc;
  if (parsed.kind === "anim") { doc = normalizeAnim({ ...parsed.anim, groups: res.groups }); } else {
    doc = newAnim();
    mergeGroups(doc, res.groups);
    doc.duration = Math.max(2, ...doc.groups.flatMap((g) => Object.values(g.tracks).flatMap((t) => t.keyframes.map((k) => k.sec))));
  }
  if (res.warnings.length) await alertDialog("Imported with warnings", res.warnings.map((w) => "• " + w).join("\n"));
  return doc;
}
async function importGroupAsNewAnim(target) { return importAnimFile(target); }
async function importGroupsInto(doc, target) {
  try {
    const parsed = await pickAndParse();
    if (!parsed) return null;
    return await mergeParsedInto(doc, parsed, target);
  } catch (e) { await alertDialog("Couldn't import", e.message || String(e)); return null; }
}
async function mergeParsedInto(doc, parsed, target) {
  if (parsed.kind === "track") throw new Error("That's a single track. Right-click a part in the editor to import a track into it.");
  const res = await materializeGroups(parsed, target);
  if (!res) return null;
  const copy = normalizeAnim(JSON.parse(JSON.stringify(doc)));
  const added = mergeGroups(copy, res.groups);
  if (res.warnings.length) await alertDialog("Imported with warnings", res.warnings.map((w) => "• " + w).join("\n"));
  toast(`Imported ${added.length} part${added.length === 1 ? "" : "s"}`);
  return copy;
}
function trackFromParsed(parsed) {
  const t = parsed.track;
  if (!TD[t.trackType]) throw new Error(`Unknown track type "${t.trackType}".`);
  const kfs = (t.track.keyframes || []).map((k) => ({ ...k, id: makeKFID() }));
  const track = { keyframes: kfs, ...(t.track.muted ? { muted: true } : {}) };
  if (typeof t.track.expr === "string" && t.track.expr.trim()) track.expr = t.track.expr;
  return { key: t.trackType, track };
}
const io = {
  importAnimFile: () => importAnimFile(currentTarget()),
  importGroupAsNewAnim: (t) => importGroupAsNewAnim(t || currentTarget()),
  importGroupsInto: (doc, t) => importGroupsInto(doc, t || currentTarget()),
  exportAnimFile: (doc) => exportAnimFile(doc, currentTarget()),
  prompt: (title, label, value) => promptDialog(title, label, value),
};
function currentTarget() {
  try { const t = vm().editingTarget; return t && !t.isStage ? t : null; } catch { return null; }
}
const files = {
  __proto__: null,
  ACCEPT,
  animFromParsed,
  exportAnimFile,
  exportGroupsFile,
  exportTrackFile,
  importAnimFile,
  importGroupAsNewAnim,
  importGroupsInto,
  io,
  materializeGroups,
  md5Of,
  mergeGroups,
  mergeParsedInto,
  parseAnimationFile,
  pickAndParse,
  readJSONFile,
  trackFromParsed
};
const KEY = "ks5_presets_v1";
const k = (t, v, ease = "Sine_InOut") => [t, v, ease];
const BUILTIN = [
  { name: "Pop in", tracks: { scaleX: [k(0, 0, "Linear_Out"), k(0.18, 115, "Back_Out"), k(0.3, 100, "Quad_Out")], scaleY: [k(0, 0, "Linear_Out"), k(0.18, 115, "Back_Out"), k(0.3, 100, "Quad_Out")], alpha: [k(0, 0, "Linear_Out"), k(0.12, 100, "Quad_Out")] } },
  { name: "Pop out", tracks: { scaleX: [k(0, 100), k(0.1, 112, "Quad_Out"), k(0.28, 0, "Back_In")], scaleY: [k(0, 100), k(0.1, 112, "Quad_Out"), k(0.28, 0, "Back_In")], alpha: [k(0, 100), k(0.28, 0, "Quad_In")] } },
  { name: "Fade in", tracks: { alpha: [k(0, 0, "Linear_Out"), k(0.4, 100, "Quad_Out")] } },
  { name: "Fade out", tracks: { alpha: [k(0, 100), k(0.4, 0, "Quad_In")] } },
  { name: "Bounce", additive: true, tracks: { y: [k(0, 0), k(0.2, 40, "Quad_Out"), k(0.4, 0, "Quad_In"), k(0.5, 12, "Quad_Out"), k(0.6, 0, "Quad_In")], scaleY: [k(0, 0), k(0.05, -12, "Quad_Out"), k(0.2, 6, "Quad_Out"), k(0.4, -10, "Quad_In"), k(0.5, 0, "Quad_Out")] } },
  { name: "Shake", additive: true, tracks: { x: [k(0, 0), k(0.05, -8, "Linear_Out"), k(0.1, 8, "Linear_Out"), k(0.15, -6, "Linear_Out"), k(0.2, 6, "Linear_Out"), k(0.25, -3, "Linear_Out"), k(0.3, 0, "Linear_Out")] } },
  { name: "Wobble", additive: true, tracks: { rotation: [k(0, 0), k(0.1, -12), k(0.25, 10), k(0.4, -6), k(0.55, 3), k(0.7, 0)] } },
  { name: "Spin 360°", additive: true, tracks: { rotation: [k(0, 0, "Linear_Out"), k(0.6, 360, "Cubic_InOut")] } },
  { name: "Pulse", additive: true, tracks: { scaleX: [k(0, 0), k(0.15, 12, "Sine_Out"), k(0.4, 0, "Sine_InOut")], scaleY: [k(0, 0), k(0.15, 12, "Sine_Out"), k(0.4, 0, "Sine_InOut")] } },
  { name: "Slide in from left", additive: true, tracks: { x: [k(0, -300, "Linear_Out"), k(0.45, 0, "Expo_Out")], alpha: [k(0, -100, "Linear_Out"), k(0.2, 0, "Quad_Out")] } },
  { name: "Slide out right", additive: true, tracks: { x: [k(0, 0), k(0.45, 300, "Expo_In")] } },
  { name: "Squash & stretch jump", additive: true, tracks: { y: [k(0, 0), k(0.1, 0), k(0.35, 60, "Quad_Out"), k(0.6, 0, "Quad_In")], scaleX: [k(0, 0), k(0.1, 15, "Quad_Out"), k(0.2, -10, "Quad_Out"), k(0.55, 0), k(0.62, 15, "Quad_Out"), k(0.75, 0, "Back_Out")], scaleY: [k(0, 0), k(0.1, -15, "Quad_Out"), k(0.2, 12, "Quad_Out"), k(0.55, 0), k(0.62, -15, "Quad_Out"), k(0.75, 0, "Back_Out")] } },
  { name: "Flash", tracks: { fxBrightness: [k(0, 0, "Linear_Out"), k(0.05, 80, "Linear_Out"), k(0.25, 0, "Quad_Out")] } },
  { name: "Glow pulse", tracks: { glowSize: [k(0, 0), k(0.3, 14), k(0.6, 0)], glowStrength: [k(0, 120, "Step")] } },
];
function loadUserPresets() {
  try { const arr = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(arr) ? arr : []; } catch { return []; }
}
function saveUserPresets(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}
function applyPreset(ed, preset) {
  const st = ed.st;
  const names = [...st.selGroups];
  if (!names.length) return toast("Select a part to apply the preset to", true);
  const t0 = st.snap(st.sec);
  st.mutate(`Preset: ${preset.name}`, () => {
    const ids = [];
    for (const n of names) {
      const g = st.group(n);
      const gi = st.groupIndex(n);
      const pose = st.poseAt(t0);
      for (const [key, keys] of Object.entries(preset.tracks)) {
        if (!TD[key]) continue;
        const base = preset.additive && TD[key].kind === "num" ? pose.get(gi, key) : 0;
        const tr = ensureTrack(g, key);
        for (const [dt, v, ease] of keys) {
          const sec = Math.round((t0 + dt) * 1e6) / 1e6;
          tr.keyframes = tr.keyframes.filter((x) => !sameSec(x.sec, sec));
          const kf = { sec, value: typeof v === "number" ? Math.round((base + v) * 1000) / 1000 : v, ease: ease || "Linear_Out", id: makeKFID() };
          tr.keyframes.push(kf);
          ids.push(kf.id);
        }
        sortTrack(tr);
      }
    }
    st.selKeys = new Set(ids);
    const end = Math.max(...Object.values(preset.tracks).flat().map((x) => x[0]));
    if (!st.doc.infinite && t0 + end > st.doc.duration) st.doc.duration = Math.round((t0 + end) * 1000) / 1000;
  });
}
function presetsMenu(ed, anchor) {
  const user = loadUserPresets();
  const items = [{ heading: "Built-in" }, ...BUILTIN.map((p) => ({ label: p.name, icon: "star", action: () => applyPreset(ed, p) }))];
  if (user.length) {
    items.push("sep", { heading: "Yours" });
    for (const p of user)
      items.push({
        label: p.name,
        icon: "star",
        submenu: () => [
          { label: "Apply", action: () => applyPreset(ed, p) },
          { label: "Delete", icon: "trash", danger: true, action: () => saveUserPresets(loadUserPresets().filter((x) => x.name !== p.name)) },
        ],
      });
  }
  items.push("sep", { label: "Save selected keys as preset…", icon: "plus", disabled: !ed.st.selKeys.size, action: () => savePresetDialog(ed) });
  showMenu(items, anchor instanceof Element ? anchor : anchor, { minWidth: 220 });
}
async function savePresetDialog(ed) {
  const st = ed.st;
  const infos = st.selectedKeyInfos().filter((i) => i.kind === "track");
  if (!infos.length) return toast("Select some keyframes first", true);
  const t0 = Math.min(...infos.map((i) => i.kf.sec));
  const answer = await openAnimationDialog("form", {
    title: "Save motion preset",
    okLabel: "Save",
    initial: { name: "My preset", additive: true },
    fields: [
      { key: "name", type: "text", label: "Name" },
      { key: "additive", type: "switch", label: "Relative values", hint: "Apply as offsets from the part's current values (best for movement)." },
    ],
    info: () => `${infos.length} keys on ${new Set(infos.map((i) => i.key)).size} tracks.`,
  });
  if (!answer) return;
  const additive = !!answer.additive;
  const tracks = {};
  const firstVal = {};
  for (const i of infos.slice().sort((a, b) => a.kf.sec - b.kf.sec)) if (!(i.key in firstVal)) firstVal[i.key] = i.kf.value;
  for (const i of infos) {
    const numeric = TD[i.key].kind === "num";
    const v = additive && numeric ? +i.kf.value - +firstVal[i.key] : i.kf.value;
    (tracks[i.key] ||= []).push([Math.round((i.kf.sec - t0) * 1e4) / 1e4, v, i.kf.ease]);
  }
  for (const arr of Object.values(tracks)) arr.sort((a, b) => a[0] - b[0]);
  const p = { name: String(answer.name || "").trim() || "Preset", additive, tracks };
  const list = loadUserPresets().filter((x) => x.name !== p.name);
  list.push(p);
  saveUserPresets(list);
  toast(`Saved preset "${p.name}"`);
}
class GifEncoder {
  constructor(width, height, { loop = 0 } = {}) {
    this.w = width;
    this.h = height;
    this.out = new ByteWriter();
    this.out.str("GIF89a");
    this.out.u16(width);
    this.out.u16(height);
    this.out.u8(0x70);
    this.out.u8(0);
    this.out.u8(0);
    this.out.bytes([0x21, 0xff, 0x0b]);
    this.out.str("NETSCAPE2.0");
    this.out.bytes([0x03, 0x01]);
    this.out.u16(loop);
    this.out.u8(0);
  }
  addFrame(rgba, delay, { matte = null } = {}) {
    const { palette, indices, transparent } = quantize(rgba, this.w, this.h, matte);
    const o = this.out;
    o.bytes([0x21, 0xf9, 0x04]);
    o.u8((2 << 2) | (transparent >= 0 ? 1 : 0));
    o.u16(Math.max(2, Math.round(delay * 100)));
    o.u8(transparent >= 0 ? transparent : 0);
    o.u8(0);
    o.u8(0x2c);
    o.u16(0);
    o.u16(0);
    o.u16(this.w);
    o.u16(this.h);
    o.u8(0x87);
    for (let i = 0; i < 256; i++) {
      const c = palette[i] || [0, 0, 0];
      o.u8(c[0]);
      o.u8(c[1]);
      o.u8(c[2]);
    }
    lzw(o, indices, 8);
  }
  finish() { this.out.u8(0x3b); return new Blob([this.out.result()], { type: "image/gif" }); }
}
class ByteWriter {
  constructor() { this.buf = new Uint8Array(1 << 16); this.n = 0; }
  ensure(k) {
    if (this.n + k <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.n + k) cap *= 2;
    const b = new Uint8Array(cap);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
  }
  u8(v) { this.ensure(1); this.buf[this.n++] = v & 255; }
  u16(v) { this.u8(v); this.u8(v >> 8); }
  bytes(a) {
    for (const v of a) this.u8(v);
  }
  str(s) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }
  result() { return this.buf.subarray(0, this.n); }
}
function quantize(rgba, w, h, matte) {
  const n = w * h;
  const opaque = [];
  let anyTransparent = false;
  const px = new Uint8Array(n * 3);
  const alphaMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3];
    if (matte) {
      const k = a / 255;
      r = Math.round(r * k + matte[0] * (1 - k));
      g = Math.round(g * k + matte[1] * (1 - k));
      b = Math.round(b * k + matte[2] * (1 - k));
    } else if (a < 128) { anyTransparent = true; alphaMask[i] = 1; continue; }
    px[i * 3] = r;
    px[i * 3 + 1] = g;
    px[i * 3 + 2] = b;
    opaque.push(i);
  }
  const maxColors = anyTransparent ? 255 : 256;
  const step = Math.max(1, Math.floor(opaque.length / 40000));
  const sample = [];
  for (let j = 0; j < opaque.length; j += step) { const i = opaque[j]; sample.push([px[i * 3], px[i * 3 + 1], px[i * 3 + 2]]); }
  const palette = medianCut(sample, maxColors);
  const transparent = anyTransparent ? palette.length : -1;
  if (anyTransparent) palette.push([0, 0, 0]);
  const indices = new Uint8Array(n);
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    if (alphaMask[i]) { indices[i] = transparent; continue; }
    const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx === undefined) {
      let best = 0, bd = Infinity;
      for (let p = 0; p < palette.length; p++) {
        if (p === transparent) continue;
        const c = palette[p];
        const d = (c[0] - r) ** 2 * 2 + (c[1] - g) ** 2 * 4 + (c[2] - b) ** 2 * 3;
        if (d < bd) { bd = d; best = p; }
      }
      idx = best;
      cache.set(key, idx);
    }
    indices[i] = idx;
  }
  return { palette, indices, transparent };
}
function medianCut(colors, max) {
  if (!colors.length) return [[0, 0, 0]];
  let boxes = [colors];
  while (boxes.length < max) {
    let bi = -1, bestRange = -1, bestCh = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.length < 2) continue;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const c of b) {
          if (c[ch] < lo) lo = c[ch];
          if (c[ch] > hi) hi = c[ch];
        }
        if (hi - lo > bestRange) { bestRange = hi - lo; bi = i; bestCh = ch; }
      }
    }
    if (bi < 0 || bestRange <= 0) break;
    const b = boxes[bi];
    b.sort((x, y) => x[bestCh] - y[bestCh]);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bb = 0;
    for (const c of b) { r += c[0]; g += c[1]; bb += c[2]; }
    return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bb / b.length)];
  });
}
function lzw(out, indices, minCodeSize) {
  out.u8(minCodeSize);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map();
  let cur = 0, curBits = 0;
  const block = [];
  const flushByte = (b) => {
    block.push(b);
    if (block.length === 255) { out.u8(255); out.bytes(block); block.length = 0; }
  };
  const emit = (code) => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) { flushByte(cur & 255); cur >>>= 8; curBits -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const key = (prefix << 8) | c;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    }
    prefix = c;
  }
  emit(prefix);
  emit(eoi);
  if (curBits > 0) flushByte(cur & 255);
  if (block.length) { out.u8(block.length); out.bytes(block); }
  out.u8(0);
}
let _view = null;
function renderThumbnail(ext, record, target, size = 48, sec = 0) {
  const renderer = ext.runtime.renderer;
  if (!renderer) return "";
  _view ||= new OffscreenView(renderer);
  if (!_view.ok) return "";
  const compiled = record.compiled;
  const bindings = bindingsFor(ext.runtime, compiled, target || null, record.ownerSprite || null);
  const pose = compiled.evaluate(sec, new PoseSet(0), record.state.data, Date.now() / 1000, bindings, null);
  const b = poseBounds(renderer, compiled, pose, bindings);
  if (!b) return "";
  const W = b.maxX - b.minX + 4, H = b.maxY - b.minY + 4;
  const scale = (size * 2) / Math.max(W, H);
  _view.render(W, H, scale, [{ compiled, pose, bindings }], { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 });
  const src = _view.toCanvas();
  const out = document.createElement("canvas");
  out.width = out.height = size * 2;
  const ctx = out.getContext("2d");
  const box = contentBox(src);
  if (!box) return "";
  const k = Math.min(out.width / box.w, out.height / box.h) * 0.92;
  const dw = box.w * k, dh = box.h * k;
  ctx.drawImage(src, box.x, box.y, box.w, box.h, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh);
  return out.toDataURL("image/png");
}
function contentBox(canvas) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  if (!w || !h) return null;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
const TIMESCALE = 60000;
const u8 = (n) => new Uint8Array([n & 255]);
const u16 = (n) => new Uint8Array([(n >>> 8) & 255, n & 255]);
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const fourcc = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const zeros = (n) => new Uint8Array(n);
function concat(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const box = (type, ...parts) => { const body = concat(parts); return concat([u32(body.length + 8), fourcc(type), body]); };
const full = (version, flags) => concat([u8(version), u8(flags >>> 16), u16(flags & 0xffff)]);
const MATRIX = concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);
function pstring(s, size) {
  const out = zeros(size);
  const bytes = [...s].slice(0, size - 1).map((c) => c.charCodeAt(0) & 127);
  out[0] = bytes.length;
  out.set(bytes, 1);
  return out;
}
class MovWriter {
  constructor(width, height, fps) {
    this.width = width;
    this.height = height;
    this.delta = Math.max(1, Math.round(TIMESCALE / Math.max(1, fps)));
    this.frames = [];
  }
  addFrame(png) { this.frames.push(png); }
  finish() {
    const n = this.frames.length;
    const duration = n * this.delta;
    const ftyp = box("ftyp", fourcc("qt  "), u32(0x20050300), fourcc("qt  "));
    let dataSize = 0;
    for (const f of this.frames) dataSize += f.length;
    const mdatHeader = concat([u32(dataSize + 8), fourcc("mdat")]);
    const offsets = [];
    let at = ftyp.length + mdatHeader.length;
    for (const f of this.frames) { offsets.push(at); at += f.length; }
    const w = this.width, h = this.height;
    const mvhd = box("mvhd", full(0, 0), u32(0), u32(0), u32(TIMESCALE), u32(duration),
      u32(0x00010000), u16(0x0100), zeros(10), MATRIX,
      u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(2));
    const tkhd = box("tkhd", full(0, 0x0f), u32(0), u32(0), u32(1), u32(0), u32(duration),
      zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(w * 65536), u32(h * 65536));
    const mdhd = box("mdhd", full(0, 0), u32(0), u32(0), u32(TIMESCALE), u32(duration), u16(0), u16(0));
    const hdlr = box("hdlr", full(0, 0), fourcc("mhlr"), fourcc("vide"), u32(0), u32(0), u32(0), pstring("VideoHandler", 13));
    const vmhd = box("vmhd", full(0, 1), u16(0x0100), u16(0x8000), u16(0x8000), u16(0x8000));
    const dhlr = box("hdlr", full(0, 0), fourcc("dhlr"), fourcc("alis"), u32(0), u32(0), u32(0), pstring("DataHandler", 12));
    const dinf = box("dinf", box("dref", full(0, 0), u32(1), box("alis", full(0, 1))));
    const sample = box("png ",
      zeros(6), u16(1),
      u16(0), u16(0), fourcc("dimo"),
      u32(0), u32(512),
      u16(w), u16(h),
      u32(0x00480000), u32(0x00480000),
      u32(0), u16(1),
      pstring("PNG", 32),
      u16(32), u16(0xffff));
    const stsd = box("stsd", full(0, 0), u32(1), sample);
    const stts = box("stts", full(0, 0), u32(1), u32(n), u32(this.delta));
    const stsc = box("stsc", full(0, 0), u32(1), u32(1), u32(1), u32(1));
    const stsz = box("stsz", full(0, 0), u32(0), u32(n), ...this.frames.map((f) => u32(f.length)));
    const stco = box("stco", full(0, 0), u32(n), ...offsets.map((o) => u32(o)));
    const stbl = box("stbl", stsd, stts, stsc, stsz, stco);
    const minf = box("minf", vmhd, dhlr, dinf, stbl);
    const mdia = box("mdia", mdhd, hdlr, minf);
    const trak = box("trak", tkhd, mdia);
    const moov = box("moov", mvhd, trak);
    return new Blob([ftyp, mdatHeader, ...this.frames, moov], { type: "video/quicktime" });
  }
}
const safe = (s) => String(s || "animation").replace(/[^\w\- ]+/g, "_").trim() || "animation";
const BOX_PAD = 4;
function exportBox(ed, o) {
  const st = ed.st;
  const renderer = ed.ext.runtime.renderer;
  const pose = new PoseSet(0);
  const bindings = st.bindings();
  let box = null;
  for (const t of frameTimes(o)) {
    const b = poseBounds(renderer, st.compiled, st.poseAt(t, pose), bindings);
    if (!b) continue;
    box = box
      ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) }
      : b;
  }
  if (!box) return null;
  return { minX: Math.floor(box.minX - BOX_PAD), minY: Math.floor(box.minY - BOX_PAD), maxX: Math.ceil(box.maxX + BOX_PAD), maxY: Math.ceil(box.maxY + BOX_PAD) };
}
function frameRenderer(ed, scale, box) {
  const st = ed.st;
  const view = new OffscreenView(ed.ext.runtime.renderer);
  if (!view.ok) throw new Error("The GPU renderer isn't available.");
  const pose = new PoseSet(0);
  const mb = [];
  const d = st.doc;
  const W = box.maxX - box.minX, H = box.maxY - box.minY;
  const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
  return {
    view,
    render(t) {
      const compiled = st.compiled;
      const bindings = st.bindings();
      st.poseAt(t, pose);
      view.render(W, H, scale, [{ compiled, pose, bindings, poseAt: compiled.anyMotionBlur ? (tt, i) => st.poseAt(tt, (mb[i] ||= new PoseSet(0))) : null }], { fps: d.fps, cx, cy });
      return view.readImageData();
    },
    dispose: () => view.dispose(),
  };
}
function composite(img, bg) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  if (bg != null) {
    const [r, g, b] = intToRGB(bg);
    ctx.fillStyle = `rgb(${r * 255},${g * 255},${b * 255})`;
    ctx.fillRect(0, 0, c.width, c.height);
    const tmp = document.createElement("canvas");
    tmp.width = img.width;
    tmp.height = img.height;
    tmp.getContext("2d").putImageData(img, 0, 0);
    ctx.drawImage(tmp, 0, 0);
  } else ctx.putImageData(img, 0, 0);
  return c;
}
function exportOptions(ed, title, { gif = false, video = false, mov = false, sheet = false, bake = false } = {}) {
  const d = ed.st.doc;
  const maxFps = gif ? 50 : 60;
  const initial = {
    scale: bake ? 2 : 1,
    fps: Math.min(maxFps, d.fps),
    start: 0,
    end: d.infinite ? 4 : d.duration,
    bg: 0xffffff,
    transparent: gif || mov,
    prefix: safe(d.name || "frame"),
  };
  const fields = [
    { key: "scale", type: "select", label: "Scale", numeric: true, options: [0.25, 0.5, 1, 1.5, 2, 3, 4].map((v) => ({ value: v, label: v + "×" })) },
    { key: "fps", type: "number", label: "Frame rate", min: 1, max: maxFps, step: 0.2, precision: 0, unit: "fps", round: true },
    { key: "start", type: "number", label: "From", min: 0, step: 0.02, unit: "s" },
    { key: "end", type: "number", label: "To", min: 0, step: 0.02, unit: "s" },
  ];
  if (gif || video || mov) fields.push({ key: "bg", type: "color", label: "Background", hint: gif ? "GIF transparency is 1-bit, so edges look best on a solid colour." : "", show: (o) => !o.transparent });
  if (gif || mov) fields.push({ key: "transparent", type: "switch", label: "Transparent background" });
  if (bake) fields.push({ key: "prefix", type: "text", label: "Costume name prefix" });
  let boxFor = "", box = null;
  const info = (o) => {
    const frames = Math.max(1, Math.round((o.end - o.start) * o.fps) + 1);
    const key = `${o.start}|${o.end}|${o.fps}`;
    if (key !== boxFor) { boxFor = key; box = exportBox(ed, o); }
    if (!box) return `${frames} frame${frames === 1 ? "" : "s"}, nothing visible`;
    const w = Math.round((box.maxX - box.minX) * o.scale), h = Math.round((box.maxY - box.minY) * o.scale);
    return `${frames} frame${frames === 1 ? "" : "s"}, ${w}×${h} px (the size of the parts)`;
  };
  return openAnimationDialog("form", { title, fields, initial, info, okLabel: bake ? "Bake" : "Export" }).then((o) => {
    if (!o) return null;
    const see = (gif || mov) && o.transparent ? null : gif || video || mov ? o.bg : null;
    return { ...o, bg: see, box: exportBox(ed, o) };
  });
}
function progressModal(title) { return openProgressDialog(title); }
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
function frameTimes(o) {
  const n = Math.max(1, Math.round((o.end - o.start) * o.fps) + 1);
  return Array.from({ length: n }, (_, i) => Math.min(o.end, o.start + i / o.fps));
}
async function renderAll(ed, o, onFrame, prog) {
  if (!o.box) { prog.close(); toast("Nothing to export: every frame is empty", true); return false; }
  const fr = frameRenderer(ed, o.scale, o.box);
  const times = frameTimes(o);
  try {
    for (let i = 0; i < times.length; i++) {
      if (prog.cancelled) return false;
      const img = fr.render(times[i]);
      await onFrame(img, i, times.length, times[i]);
      prog.set((i + 1) / times.length, `Frame ${i + 1} / ${times.length}`);
      if (i % 4 === 3) await nextFrame();
    }
  } finally { fr.dispose(); }
  return true;
}
function unionBox(boxes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    if (!b) continue;
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
async function exportPNG(ed) {
  const st = ed.st;
  const box = exportBox(ed, { start: st.sec, end: st.sec, fps: 1 });
  if (!box) return toast("Nothing to export: nothing is visible here", true);
  const fr = frameRenderer(ed, 2, box);
  const img = fr.render(st.sec);
  fr.dispose();
  const c = composite(img, null);
  c.toBlob((b) => downloadBlob(b, `${safe(st.doc.name)}_${st.sec.toFixed(2)}s.png`, "image/png"), "image/png");
}
async function exportGIF(ed) {
  const o = await exportOptions(ed, "Export animated GIF", { gif: true });
  if (!o) return;
  const prog = progressModal("Rendering GIF");
  let enc = null;
  const matte = o.transparent ? null : intToRGB(o.bg ?? 0xffffff).map((v) => Math.round(v * 255));
  const ok = await renderAll(
    ed,
    o,
    async (img) => { enc ||= new GifEncoder(img.width, img.height); enc.addFrame(img.data, 1 / o.fps, { matte }); },
    prog,
  );
  prog.close();
  if (!ok || !enc) return;
  downloadBlob(enc.finish(), safe(ed.st.doc.name) + ".gif", "image/gif");
  toast("GIF exported");
}
async function exportWebM(ed) {
  if (typeof MediaRecorder === "undefined") return alertDialog("Not supported", "This browser can't record video.");
  const o = await exportOptions(ed, "Export video (WebM)", { video: true });
  if (!o) return;
  const d = ed.st.doc;
  if (!o.box) return toast("Nothing to export: every frame is empty", true);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round((o.box.maxX - o.box.minX) * o.scale));
  canvas.height = Math.max(2, Math.round((o.box.maxY - o.box.minY) * o.scale));
  const ctx = canvas.getContext("2d");
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start();
  const prog = progressModal("Recording video");
  const t0 = performance.now();
  const ok = await renderAll(
    ed,
    o,
    async (img, i) => {
      const c = composite(img, o.bg ?? 0xffffff);
      ctx.drawImage(c, 0, 0);
      if (track.requestFrame) track.requestFrame();
      const due = t0 + ((i + 1) * 1000) / o.fps;
      const wait = due - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    },
    prog,
  );
  rec.stop();
  await done;
  prog.close();
  if (!ok) return;
  downloadBlob(new Blob(chunks, { type: "video/webm" }), safe(d.name) + ".webm", "video/webm");
  toast("Video exported");
}
async function exportMOV(ed) {
  const o = await exportOptions(ed, "Export video (MOV)", { mov: true });
  if (!o) return;
  const prog = progressModal("Rendering MOV");
  let mov = null;
  const ok = await renderAll(
    ed,
    o,
    async (img) => {
      mov ||= new MovWriter(img.width, img.height, o.fps);
      const c = composite(img, o.bg);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      mov.addFrame(new Uint8Array(await blob.arrayBuffer()));
    },
    prog,
  );
  prog.close();
  if (!ok || !mov) return;
  downloadBlob(mov.finish(), safe(ed.st.doc.name) + ".mov", "video/quicktime");
  toast(o.bg == null ? "Transparent MOV exported" : "MOV exported");
}
async function exportSpriteSheet(ed) {
  const o = await exportOptions(ed, "Export sprite sheet", { sheet: true });
  if (!o) return;
  const prog = progressModal("Rendering sprite sheet");
  const frames = [];
  const ok = await renderAll(ed, o, async (img) => frames.push(composite(img, null)), prog);
  prog.close();
  if (!ok || !frames.length) return;
  const box = unionBox(frames.map((f) => contentBox(f)));
  if (!box) return toast("Nothing to export: every frame is empty", true);
  const cols = Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / cols);
  const sheet = document.createElement("canvas");
  sheet.width = cols * box.w;
  sheet.height = rows * box.h;
  const ctx = sheet.getContext("2d");
  const meta = { frames: [], size: { w: box.w, h: box.h }, fps: o.fps, cols, rows };
  frames.forEach((f, i) => {
    const x = (i % cols) * box.w, y = Math.floor(i / cols) * box.h;
    ctx.drawImage(f, box.x, box.y, box.w, box.h, x, y, box.w, box.h);
    meta.frames.push({ x, y, w: box.w, h: box.h });
  });
  sheet.toBlob((b) => downloadBlob(b, safe(ed.st.doc.name) + "_sheet.png", "image/png"), "image/png");
  downloadBlob(JSON.stringify(meta, null, 1), safe(ed.st.doc.name) + "_sheet.json", "application/json");
  toast(`Sprite sheet: ${frames.length} frames, ${cols}×${rows}`);
}
async function bakeToCostumes(ed) {
  const st = ed.st;
  const vm = getEditorVM();
  const targets = ed.ext.runtime.targets.filter((t) => t.isOriginal && !t.isStage);
  const opts = targets.map((t) => {
    let img = "";
    try { img = t.getCostumes()[t.currentCostume].asset.encodeDataURI(); } catch {}
    return { value: t.id, label: t.sprite.name, sub: t === st.target ? "this sprite" : "", img, special: t === st.target };
  });
  const id = await chooseDialog("Bake into which sprite?", opts, { hint: "Every frame becomes a costume, aligned so the animation's center is each costume's rotation center. Play it with “next costume”." });
  if (!id) return;
  const target = ed.ext.runtime.getTargetById(id);
  const o = await exportOptions(ed, "Bake into costumes", { bake: true });
  if (!o) return;
  const prog = progressModal("Baking frames");
  const frames = [];
  const ok = await renderAll(ed, o, async (img) => frames.push(composite(img, null)), prog);
  if (!ok || !frames.length) return prog.close();
  const full = { x: 0, y: 0, w: frames[0].width, h: frames[0].height };
  const box = unionBox(frames.map((f) => contentBox(f))) || full;
  const storage = vm.runtime.storage;
  const taken = new Set(target.sprite.costumes.map((c) => c.name));
  const prev = target.currentCostume;
  const d = st.doc;
  const ox = ((d.canvasOffsetX || 0) - o.box.minX) * o.scale, oy = (o.box.maxY - (d.canvasOffsetY || 0)) * o.scale;
  for (let i = 0; i < frames.length; i++) {
    if (prog.cancelled) break;
    const c = document.createElement("canvas");
    c.width = box.w;
    c.height = box.h;
    c.getContext("2d").drawImage(frames[i], box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const asset = storage.createAsset(storage.AssetType.ImageBitmap, storage.DataFormat.PNG, bytes, null, true);
    const name = uniqueName(`${o.prefix}_${String(i + 1).padStart(3, "0")}`, taken);
    taken.add(name);
    await vm.addCostume(`${asset.assetId}.png`, {
      name,
      dataFormat: "png",
      asset,
      assetId: asset.assetId,
      md5: `${asset.assetId}.png`,
      rotationCenterX: ox - box.x,
      rotationCenterY: oy - box.y,
      bitmapResolution: o.scale,
      skinId: null,
    }, target.id);
    prog.set((i + 1) / frames.length, `Adding costume ${i + 1} / ${frames.length}`);
  }
  try { target.setCostume(prev); } catch {}
  prog.close();
  st.invalidateBindings();
  toast(`Baked ${frames.length} costumes into "${target.sprite.name}"`);
}
const particlesLoaded = () => { const vm = getEditorVM(); return !!(vm && vm.extensionManager.isExtensionLoaded(EXTENSION_ID)); };
const projectEmitters = () => {
    const vm = getEditorVM();
    const names = new Set();
    const ext = vm && vm.runtime.ext_basicParticles;
    if (ext) ext.emitters.forEach((em, name) => names.add(name));
    if (vm) {
        for (const t of vm.runtime.targets) {
            if (!t.isOriginal) continue;
            const blocks = t.blocks._blocks;
            for (const id in blocks) {
                const b = blocks[id];
                if (b.opcode !== `${EXTENSION_ID}_create` || !b.inputs.NAME) continue;
                const shadow = blocks[b.inputs.NAME.shadow];
                const field = shadow && shadow.fields && shadow.fields.TEXT;
                if (field && field.value) names.add(String(field.value));
            }
        }
    }
    return [...names].sort();
};
const emitterNamed = name => {
    const vm = getEditorVM();
    const ext = vm && vm.runtime.ext_basicParticles;
    const em = ext && ext.emitters.get(name);
    if (em) return em;
    return PRESETS[name] ? emitterFrom(name) : null;
};
const addParticleEvent = (ed, name) => {
    const st = ed.st;
    const t = st.snap(st.sec);
    const value = particleEventText(name, st.primary);
    st.mutate('Add particles', doc => {
        doc.events = doc.events.filter(e => !sameSec(e.sec, t));
        const ev = {sec: t, value, id: makeKFID()};
        doc.events.push(ev);
        doc.events.sort((a, b) => a.sec - b.sec);
        st.selKeys = new Set([ev.id]);
    });
};
const particleMenu = ed => {
    if (!particlesLoaded()) return [];
    return [{
        label: ed.st.primary ? `Particles at playhead (on ${ed.st.primary})` : 'Particles at playhead',
        icon: 'flag',
        submenu: () => {
            const mine = projectEmitters();
            const presets = Object.keys(PRESETS).filter(n => !mine.includes(n));
            const item = name => ({label: name, action: () => addParticleEvent(ed, name)});
            return mine.length ? [...mine.map(item), 'sep', ...presets.map(item)] : presets.map(item);
        }
    }];
};
class ParticlePreview {
    constructor (ed) {
        this.ed = ed;
        this.system = new ParticleSystem();
        this.raf = 0;
        this.last = 0;
    }
    passed (prev, cur) {
        if (!particlesLoaded()) return;
        const compiled = this.ed.st.compiled;
        if (!compiled || !compiled.events || !compiled.events.length) return;
        const fire = value => this.burst(value);
        if (cur < prev) { compiled.eventsBetween(prev, Infinity, fire); compiled.eventsBetween(-1, cur, fire); } else { compiled.eventsBetween(prev, cur, fire); }
    }
    burst (value) {
        const ev = parseParticleEvent(value);
        const em = ev && emitterNamed(ev.name);
        if (!em) return;
        let x = 0, y = 0;
        const vp = this.ed.viewport;
        const gi = ev.part ? this.ed.st.compiled.byName.get(ev.part) : undefined;
        if (gi !== undefined && vp.valid && vp.valid[gi]) {
            const d = this.ed.st.doc;
            const c = vp.cmds[gi];
            x = c.mat[4] - (d.width / 2);
            y = (d.height / 2) - c.mat[5];
        }
        this.system.spawn(em, x, y, ev.count === null ? em.burst : ev.count);
        this.run();
    }
    run () {
        if (this.raf) return;
        this.last = performance.now();
        const tick = now => {
            this.system.step(Math.min(0.1, (now - this.last) / 1000));
            this.last = now;
            this.ed.invalidate('overlay');
            this.raf = this.system.list.length ? requestAnimationFrame(tick) : 0;
        };
        this.raf = requestAnimationFrame(tick);
    }
    draw (ctx, viewport) {
        if (!this.system.list.length) return;
        this.system.draw(ctx, (x, y) => viewport.animToScreen(x, y), this.ed.st.view.pvZoom);
    }
    dispose () { cancelAnimationFrame(this.raf); this.raf = 0; this.system.clear(); }
}
const COMMIT_MS = 250;
class Editor {
  constructor(ext, doc, opts) {
    injectCSS();
    this.ext = ext;
    this.opts = opts;
    this.prefs = prefs;
    this.timeFormat = "seconds";
    const st = (this.st = new EditorState(ext, doc, opts.target, opts.sprite));
    this.clipboard = null;
    this.root = opts.root;
    this.viewport = new Viewport(this);
    this.timeline = new Timeline(this);
    this.audio = null;
    if (st.doc.audioSpriteName && st.doc.audioSoundName) this.loadAudio(st.doc.audioSpriteName, st.doc.audioSoundName, true);
    this.dirty = new Set(["all"]);
    this.raf = 0;
    this.commitTimer = 0;
    this.collab = getAnimationCollab();
    this.unregisterCollab = this.collab ? this.collab.registerEditor(this) : null;
    this.offCollab = this.collab ? this.collab.subscribe(() => this.invalidate("remote")) : null;
    st.on("doc", (what) => {
      this.invalidate("all");
      if (what !== "ui") this.scheduleCommit();
      if (this.collab && what !== "remote" && what !== "ui") this.collab.localEdit(this);
    });
    st.on("time", () => {
      this.invalidate("time");
      if (this.collab) this.collab.localPresence(this);
    });
    st.on("sel", () => {
      this.invalidate("all");
      if (this.collab) this.collab.localPresence(this);
    });
    this.onKey = (e) => this.handleKey(e);
    document.addEventListener("keydown", this.onKey, true);
    this.onKeyUp = (e) => {
      if (e.code === "Space") this.viewport.spaceHeld = false;
    };
    document.addEventListener("keyup", this.onKeyUp, true);
    if (st.doc.groups.length) st.selectGroup(st.doc.groups[st.doc.groups.length - 1].name);
  }
  attached() { requestAnimationFrame(() => { this.viewport.fit(true); this.timeline.fit(); this.invalidate("all"); }); }
  get visible() { return !!(this.root && this.root.isConnected && this.root.offsetParent !== null); }
  remotePeople() { return this.collab ? this.collab.peopleIn(this.st.target, this.st.doc.id) : []; }
  scheduleCommit() { clearTimeout(this.commitTimer); this.commitTimer = setTimeout(() => this.save(), COMMIT_MS); }
  moreMenu(anchor) {
    const st = this.st;
    const v = st.view;
    showMenu(
      [
        { label: "All properties…", icon: "gear", action: () => this.toggleDrawer(true) },
        { label: "Graph editor", checked: v.tlMode === "graph", kbd: "2", action: () => this.timeline.setMode(v.tlMode === "graph" ? "dope" : "graph") },
        "sep",
        { label: "Add event at playhead…", icon: "flag", action: () => this.cmd("addEvent") },
        { label: "Add data track…", icon: "data", action: () => this.cmd("addDataTrack") },
        { label: "Music / sound…", icon: "music", action: () => (st.selectGroup(null), this.toggleDrawer(true)) },
        { label: "Trim length to last key", icon: "fit", action: () => st.mutate("Trim length", (d) => (d.duration = Math.max(0.05, ...allKeyframeTimes(d)))) },
        "sep",
        { label: "Playback speed", icon: "play", submenu: () => this.rateMenu() },
        { label: "Onion skin settings…", icon: "onion", action: () => this.onionDialog() },
        { label: "Show time as frames", checked: this.timeFormat === "frames", action: () => ((this.timeFormat = this.timeFormat === "frames" ? "seconds" : "frames"), this.invalidate("all")) },
        { label: "Preferences…", icon: "gear", action: () => this.settingsDialog() },
        { label: "Keyboard shortcuts", icon: "help", action: () => this.shortcutsDialog() },
      ],
      anchor,
    );
  }
  importItems() {
    return [
      { label: "Part file (.ks4group, .ks5group…)", icon: "import", action: () => this.importParts() },
      { label: "Images as parts…", icon: "image", action: () => import('./core.js').then(({ pickFiles }) => pickFiles("image/*", true).then((fs) => fs.length && addImagesAsParts(this, fs, 0, 0))) },
      { label: "Replace with animation file…", icon: "folder", action: () => this.replaceFromFile() },
    ];
  }
  renamePartPrompt(g) { promptDialog("Rename part", "Name", g.name).then((v) => v != null && this.renamePart(g, v)); }
  cssVar(name) { return getComputedStyle(this.root).getPropertyValue(name).trim(); }
  accent() { return this._colors ? this._colors.accent : this.cssVar("--k-accent") || "#6c5ce7"; }
  font() { return this.cssVar("--k-font") || "Helvetica, Arial, sans-serif"; }
  colors() {
    if (this._colorsFrame === this._frame && this._colors) return this._colors;
    if (!this._probe) { this._probe = document.createElement("div"); this._probe.style.display = "none"; }
    const probe = this._probe;
    if (!probe.isConnected) this.root.appendChild(probe);
    const get = (v) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
    const dark = document.body.getAttribute("theme") === "dark";
    this._colors = {
      accent: get("--k-accent"),
      accentT: get("--k-accent-t"),
      accentLt: get("--k-accent-lt"),
      accent10: get("--k-accent-10"),
      panel: get("--k-panel"),
      panel2: get("--k-panel-2"),
      border: get("--k-border"),
      text: get("--k-text"),
      text2: get("--k-text-2"),
      grid: dark ? "rgba(255,255,255,0.035)" : "rgba(87,94,117,0.05)",
      grid2: dark ? "rgba(255,255,255,0.08)" : "rgba(87,94,117,0.12)",
      outside: dark ? "rgba(0,0,0,0.35)" : "rgba(87,94,117,0.08)",
      key: "#ffab19",
      keyDark: "#b36b00",
    };
    this._colorsFrame = this._frame;
    return this._colors;
  }
  invalidate(what) {
    this.dirty.add(what);
    if (!this.raf) this.raf = requestAnimationFrame(() => this.flush());
  }
  flush() {
    this.raf = 0;
    this._frame = (this._frame || 0) + 1;
    const d = this.dirty;
    this.dirty = new Set();
    const all = d.has("all");
    try {
      if (all || d.has("timeline")) this.timeline.draw();
      else if (d.has("time") || d.has("remote") || d.has("remoteHead")) this.timeline.drawHead();
      if (all || d.has("view") || d.has("time")) this.viewport.draw();
      else if (d.has("overlay") || d.has("remote")) this.viewport.drawOverlay(this.viewport.pixelRatio());
    } catch (e) { console.error("[animation] editor draw failed", e); }
    if (all || d.has("time") || d.has("chrome") || d.has("view") || d.has("remote")) this.st.emit("ui");
    if (this.st.compiled.dynamic && !this.st.playing) this.invalidate("view");
    if (this.remotePeople().some((p) => p.playing)) this.invalidate("remoteHead");
  }
  togglePlay() { this.st.playing ? this.pause() : this.play(); }
  play() {
    const st = this.st;
    if (st.playing) return;
    if (!st.doc.infinite && st.sec >= st.doc.duration - 1e-6) st.setTime(0);
    st.playing = true;
    let last = performance.now();
    if (this.audio) this.audio.play(st.sec, st.rate);
    if (!this.particles) this.particles = new ParticlePreview(this);
    const tick = (now) => {
      if (!st.playing) return;
      const prevSec = st.sec;
      const dt = Math.min(0.1, (now - last) / 1000) * st.rate;
      last = now;
      let t = this.audio && this.audio.playing ? this.audio.time() : st.sec + dt;
      if (!st.doc.infinite && t >= st.doc.duration) {
        if (st.loop) {
          t = t % st.doc.duration;
          if (this.audio) this.audio.play(t, st.rate);
        } else { st.setTime(st.doc.duration); this.pause(); return; }
      }
      st.setTime(t);
      this.particles.passed(prevSec, t);
      this.playRaf = requestAnimationFrame(tick);
    };
    this.playRaf = requestAnimationFrame(tick);
    this.invalidate("chrome");
  }
  pause() {
    const st = this.st;
    st.playing = false;
    cancelAnimationFrame(this.playRaf);
    if (this.audio) this.audio.stop();
    this.invalidate("all");
  }
  setRate(r) {
    const st = this.st;
    st.rate = Math.round(Math.min(16, Math.max(0.05, r)) * 1000) / 1000;
    prefs.playbackRate = st.rate;
    savePrefs();
    if (this.audio) this.audio.setRate(st.rate);
    this.invalidate("chrome");
  }
  rateMenu() {
    const st = this.st;
    const rates = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4];
    const custom = !rates.includes(st.rate);
    return [
      ...rates.map((r) => ({ label: r + "×", checked: st.rate === r, action: () => this.setRate(r) })),
      "sep",
      {
        label: custom ? `Custom (${st.rate}×)…` : "Custom…",
        checked: custom,
        action: () => promptDialog("Playback speed", "Speed: 1 is normal, 0.5 is half, 2 is double", String(st.rate)).then((v) => {
          const n = parseFloat(v);
          if (n > 0) this.setRate(n);
        }),
      },
    ];
  }
  handleKey(e) {
    if (!this.visible) return;
    if (document.querySelector(".k5-modal-bg") || document.querySelector('[class*="ReactModal__Overlay"]')) return;
    const t = e.target;
    if (t && t !== document.body && t !== document.documentElement && !this.root.contains(t)) return;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && k.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      this.save();
      return;
    }
    if (typing) return;
    const st = this.st;
    let handled = true;
    if (mod && !e.shiftKey && k.toLowerCase() === "z") this.cmd("undo");
    else if (mod && ((e.shiftKey && k.toLowerCase() === "z") || k.toLowerCase() === "y")) this.cmd("redo");
    else if (mod && k.toLowerCase() === "c") this.cmd("copy");
    else if (mod && k.toLowerCase() === "x") this.cmd("cut");
    else if (mod && k.toLowerCase() === "v") this.cmd("paste");
    else if (mod && k.toLowerCase() === "d") this.cmd(st.selKeys.size ? "duplicateKeys" : "duplicatePart");
    else if (mod && k.toLowerCase() === "a") this.cmd("selectAllKeys");
    else if (k === " ") {
      this.viewport.spaceHeld = !this.viewport.area.matches(":hover") ? false : this.viewport.spaceHeld;
      this.togglePlay();
    } else if (k === "ArrowLeft") this.cmd(e.shiftKey ? "toStart" : "prevFrame");
    else if (k === "ArrowRight") this.cmd(e.shiftKey ? "toEnd" : "nextFrame");
    else if (k === "Home") st.setTime(0);
    else if (k === "End") this.cmd("toEnd");
    else if (k.toLowerCase() === "j") this.cmd("prevKey");
    else if (k.toLowerCase() === "k") this.cmd("nextKey");
    else if (k.toLowerCase() === "i") this.cmd("keyTransform");
    else if (k.toLowerCase() === "l") this.cmd("toggleLoop");
    else if (k.toLowerCase() === "o") this.viewport.toggle("onion");
    else if (k.toLowerCase() === "e" && !e.shiftKey) this.cmd("toggleExprs");
    else if (k.toLowerCase() === "f" && e.shiftKey) this.timeline.fit();
    else if (k.toLowerCase() === "f") this.viewport.fit();
    else if (k === "1") this.timeline.setMode("dope");
    else if (k === "2") this.timeline.setMode("graph");
    else if (k === "Delete" || k === "Backspace") this.cmd(st.selKeys.size ? "deleteKeys" : "deletePart");
    else if (k === "Escape") {
      if (document.querySelector(".k5-menu")) closeMenus();
      else if (st.selKeys.size) st.clearKeys();
      else if (st.selGroups.size) st.selectGroup(null);
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }
  cmd(name) {
    const st = this.st;
    const g = st.primaryGroup;
    switch (name) {
      case "undo": {
        const l = st.undo();
        if (l) toast("Undo: " + l);
        break;
      }
      case "redo": {
        const l = st.redo();
        if (l) toast("Redo: " + l);
        break;
      }
      case "prevFrame":
        st.setTime(st.snap(st.sec - st.frameStep()));
        break;
      case "nextFrame":
        st.setTime(st.snap(st.sec + st.frameStep()));
        break;
      case "toStart":
        st.setTime(0);
        break;
      case "toEnd":
        st.setTime(st.doc.infinite ? Math.max(st.sec, ...allKeyframeTimes(st.doc)) : st.doc.duration);
        break;
      case "prevKey": {
        const ts = allKeyframeTimes(st.doc).filter((t) => t < st.sec - 1e-4);
        if (ts.length) st.setTime(ts[ts.length - 1]);
        break;
      }
      case "nextKey": {
        const t = allKeyframeTimes(st.doc).find((t) => t > st.sec + 1e-4);
        if (t !== undefined) st.setTime(t);
        break;
      }
      case "toggleExprs":
        st.view.noExprs = !st.view.noExprs;
        toast(st.view.noExprs ? "Expressions off (just in the editor)" : "Expressions on");
        this.invalidate("all");
        st.emit("ui");
        break;
      case "toggleLoop":
        st.loop = !st.loop;
        prefs.loop = st.loop;
        savePrefs();
        this.invalidate("chrome");
        break;
      case "keyTransform": {
        const names = st.selGroups.size ? [...st.selGroups] : [];
        if (!names.length) return toast("Select a part first");
        const t = st.snap(st.sec);
        st.mutate("Key transform", () => {
          const ids = [];
          for (const n of names) {
            const gg = st.group(n);
            const gi = st.groupIndex(n);
            const pose = st.currentPose();
            for (const k of ["x", "y", "rotation", "scaleX", "scaleY"]) ids.push(setKey(gg, k, t, round3(pose.get(gi, k)), { exact: true }).id);
          }
          st.selKeys = new Set(ids);
        });
        break;
      }
      case "copy": {
        const infos = st.selectedKeyInfos();
        if (infos.length) {
          this.clipboard = copyKeys(infos);
          toast(`Copied ${infos.length} key${infos.length === 1 ? "" : "s"}`);
        }
        break;
      }
      case "cut": {
        const infos = st.selectedKeyInfos();
        if (!infos.length) break;
        this.clipboard = copyKeys(infos);
        st.mutate("Cut keys", (doc) => deleteKeys(doc, infos));
        break;
      }
      case "paste":
        this.paste(st.snap(st.sec));
        break;
      case "duplicateKeys": {
        const infos = st.selectedKeyInfos();
        if (!infos.length) break;
        const clip = copyKeys(infos);
        st.mutate("Duplicate keys", (doc) => (st.selKeys = new Set(pasteKeys(doc, clip, st.snap(st.sec), null))));
        break;
      }
      case "deleteKeys": {
        const infos = st.selectedKeyInfos();
        if (!infos.length) break;
        const run = () => st.mutate(`Delete ${infos.length} key${infos.length === 1 ? "" : "s"}`, (doc) => deleteKeys(doc, infos));
        if (prefs.confirmDelete && infos.length > 1) confirmDialog("Delete keyframes", `Delete ${infos.length} keyframes?`, { okLabel: "Delete", danger: true }).then((ok) => ok && run());
        else run();
        break;
      }
      case "reverseKeys": {
        const infos = st.selectedKeyInfos();
        if (infos.length < 2) return toast("Select two or more keyframes to reverse");
        st.mutate("Reverse keys", (doc) => reverseKeys(doc, infos));
        break;
      }
      case "selectAllKeys": {
        const ids = [];
        const groups = st.selGroups.size ? [...st.selGroups].map((n) => st.group(n)) : st.doc.groups;
        for (const gg of groups) for (const tr of Object.values(gg.tracks)) for (const k of tr.keyframes) ids.push(k.id);
        if (!st.selGroups.size) for (const ev of st.doc.events) ids.push(ev.id);
        st.selectKeys(ids);
        break;
      }
      case "duplicatePart": {
        if (!g) break;
        st.mutate("Duplicate part", (doc) => {
          const c = duplicateGroup(doc, g);
          st.selGroups = new Set([c.name]);
          st.primary = c.name;
        });
        break;
      }
      case "deletePart": {
        const names = [...st.selGroups];
        if (!names.length) break;
        confirmDialog("Delete part" + (names.length > 1 ? "s" : ""), `Delete ${names.map((n) => `"${n}"`).join(", ")} and all ${names.length > 1 ? "their" : "its"} keyframes?`, { okLabel: "Delete", danger: true }).then((ok) => {
          if (!ok) return;
          st.mutate("Delete part", (doc) => {
            for (const n of names) {
              const gg = doc.groups.find((x) => x.name === n);
              if (gg) deleteGroup(doc, gg);
            }
          });
          st.selectGroup(null);
        });
        break;
      }
      case "addDataTrack":
        promptDialog("New data track", "Name (use it in expressions as data.name)", "myVar").then((v) => {
          if (!v) return;
          const name = v.trim().replace(/[^\w]/g, "_");
          if (!name) return;
          if (st.doc.dataTracks.some((d) => d.name === name)) return toast(`data.${name} already exists`, true);
          const colors = ["#44ddbb", "#ffab19", "#ff6680", "#4c97ff", "#9966ff", "#59c059", "#ff8c1a"];
          st.mutate("Add data track", (doc) => doc.dataTracks.push({ name, color: colors[doc.dataTracks.length % colors.length], disc: false, keyframes: [{ sec: 0, value: 0, ease: "Linear_Out", id: makeKFID() }] }));
        });
        break;
      case "addEvent": {
        const t = st.snap(st.sec);
        promptDialog("New event", "Message (broadcast when playback passes this point)", "event").then((v) => {
          if (v == null) return;
          st.mutate("Add event", (doc) => {
            doc.events = doc.events.filter((e) => !sameSec(e.sec, t));
            const ev = { sec: t, value: v.trim() || "event", id: makeKFID() };
            doc.events.push(ev);
            doc.events.sort((a, b) => a.sec - b.sec);
            st.selKeys = new Set([ev.id]);
          });
        });
        break;
      }
      case "importParts":
        this.importParts();
        break;
      default:
        console.warn("[KS5] unknown command", name);
    }
  }
  paste(t) {
    const st = this.st;
    if (!this.clipboard) return toast("Nothing copied yet");
    st.mutate("Paste keys", (doc) => { st.selKeys = new Set(pasteKeys(doc, this.clipboard, t, st.primaryGroup)); });
  }
  setEase(ease) {
    const st = this.st;
    const infos = st.selectedKeyInfos().filter((i) => i.kind !== "event");
    if (!infos.length) return;
    st.mutate("Set easing", () => {
      for (const i of infos) {
        if (i.kind === "track" && TD[i.key].kind === "disc" && ease !== "Step") continue;
        if (ease === "Bezier" && i.kf.ease !== "Bezier") i.kf.bez = i.kf.bez || [0.42, 0, 0.58, 1];
        i.kf.ease = ease;
        if (ease !== "Bezier") delete i.kf.bez;
      }
    });
  }
  setParent(childName, parentName) {
    const st = this.st;
    const child = st.group(childName);
    const parent = parentName ? st.group(parentName) : null;
    if (!child) return;
    const pose = st.currentPose();
    st.mutate(parent ? `Parent to ${parent.name}` : "Unparent", (doc) => setParent(doc, child, parent, pose, st.groupIndex(childName), parent ? st.groupIndex(parentName) : -1));
    toast(parent ? `"${childName}" now follows "${parentName}"` : `"${childName}" unparented`);
  }
  reorderPart(name, targetName, above) {
    const st = this.st;
    st.mutate("Reorder parts", (doc) => {
      const g = doc.groups.find((x) => x.name === name);
      const t = doc.groups.find((x) => x.name === targetName);
      if (!g || !t) return;
      doc.groups.splice(doc.groups.indexOf(g), 1);
      const ti = doc.groups.indexOf(t);
      doc.groups.splice(above ? ti : ti + 1, 0, g);
    });
  }
  renamePart(g, name) {
    const st = this.st;
    let newName = g.name;
    st.mutate("Rename part", (doc) => (newName = renameGroup(doc, g, name)));
    st.selGroups = new Set([...st.selGroups].map((n) => (n === g.name ? newName : n)));
    if (st.primary === g.name || !st.group(st.primary)) st.primary = newName;
    st.emit("sel");
  }
  renameEvent(id) {
    const st = this.st;
    const inf = st.index.get(id);
    if (!inf || inf.kind !== "event") return;
    promptDialog("Rename event", "Message", inf.kf.value).then((v) => v != null && st.mutate("Rename event", () => (inf.kf.value = v.trim() || "event")));
  }
  openExpr(ids = [...this.st.selKeys]) { return openExprEditor(this, ids); }
  openPropertyExpr(g, key, sec) { return openPropertyExpr(this, g, key, sec); }
  openTrackExpr(g, key, sec) { return openTrackExpr(this, g, key, sec); }
  addPartDialog() { addPartDialog(this); }
  changeSpriteDialog(g) { changeSpriteDialog(this, g); }
  async importParts() {
    const st = this.st;
    try {
      const parsed = await pickAndParse();
      if (!parsed) return;
      await this.applyParsed(parsed);
    } catch (e) { alertDialog("Couldn't import", e.message || String(e)); }
  }
  async applyParsed(parsed) {
    const st = this.st;
    if (parsed.kind === "track") {
      const g = st.primaryGroup;
      if (!g) return toast("Select the part to import the track into", true);
      const { key, track } = trackFromParsed(parsed);
      if (g.tracks[key] && !(await confirmDialog("Replace track?", `"${g.name}" already has a ${TD[key].label} track. Replace it?`, { okLabel: "Replace" }))) return;
      st.mutate("Import track", () => (g.tracks[key] = track));
      return;
    }
    const merged = await mergeParsedInto(st.doc, parsed, st.target);
    if (!merged) return;
    const before = new Set(st.doc.groups.map((g) => g.name));
    st.mutate("Import parts", (doc) => {
      doc.groups = merged.groups;
      if (parsed.kind === "anim" && merged.dataTracks) {
        for (const dt of merged.dataTracks) if (!doc.dataTracks.some((d) => d.name === dt.name)) doc.dataTracks.push(dt);
      }
    });
    st.invalidateBindings();
    const added = st.doc.groups.filter((g) => !before.has(g.name)).map((g) => g.name);
    if (added.length) { st.selGroups = new Set(added); st.primary = added[added.length - 1]; st.emit("sel"); }
  }
  async dropFiles(files, ax, ay) {
    const images = files.filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|svg|gif|webp)$/i.test(f.name));
    const others = files.filter((f) => !images.includes(f));
    for (const f of others) {
      try { const obj = await readJSONFile(f); await this.applyParsed(parseAnimationFile(obj, f.name)); } catch (e) { alertDialog("Couldn't import", e.message || String(e)); }
    }
    if (images.length) await addImagesAsParts(this, images, ax, ay);
  }
  dropCostume(info, onGroupName, ax, ay) {
    const st = this.st;
    const t = st.snap(st.sec);
    if (onGroupName && onGroupName === info.group) {
      const g = st.group(onGroupName);
      st.mutate("Set costume", () => setKey(g, "costume", t, { name: info.costume, index: info.index }, { ease: "Step" }));
      return;
    }
    const src = st.group(info.group);
    st.mutate("Add part", (doc) => {
      const g = addGroup(doc, { name: info.costume, spriteName: src ? src.spriteName : THIS_SPRITE, targetId: src ? src.targetId : "", costume: { name: info.costume, index: info.index } });
      setKey(g, "x", 0, round3(ax));
      setKey(g, "y", 0, round3(ay));
      st.selGroups = new Set([g.name]);
      st.primary = g.name;
    });
  }
  exportTrack(g, key) { exportTrackFile(g, key); }
  savePreset() { savePresetDialog(this); }
  presetsMenu(anchor) { presetsMenu(this, anchor); }
  flipParts(axis, names = [...this.st.selGroups]) {
    const st = this.st;
    const key = axis === "v" ? "scaleY" : "scaleX";
    const groups = names.map((n) => st.group(n)).filter(Boolean);
    if (!groups.length) return toast("Select a part first");
    const t = st.playing ? st.sec : st.snap(st.sec);
    const pose = st.currentPose();
    st.mutate(axis === "v" ? "Flip vertically" : "Flip horizontally", () => {
      for (const g of groups) setKey(g, key, t, -pose.get(st.groupIndex(g.name), key));
    });
  }
  quickFxMenu(anchor) {
    const g = this.st.primaryGroup;
    if (!g) return toast("Select a part first");
    showMenu([{ heading: "Quick style for " + g.name }, ...this.quickFxItems(g)], anchor);
  }
  quickFxItems(g) {
    const st = this.st;
    const t = st.snap(st.sec);
    const set = (label, pairs) => () => st.mutate(label, () => pairs.forEach(([k, v]) => setKey(g, k, t, v)));
    return [
        { label: "Soft glow", icon: "sparkle", action: set("Glow", [["glowSize", 10], ["glowStrength", 90], ["glowColor", 0xfff3b0]]) },
        { label: "Neon glow", icon: "sparkle", action: set("Neon", [["glowSize", 16], ["glowStrength", 160], ["glowColor", 0x6c5ce7]]) },
        { label: "Outline", icon: "sparkle", action: set("Outline", [["outlineWidth", 3], ["outlineColor", 0x000000]]) },
        { label: "Drop shadow", icon: "sparkle", action: set("Shadow", [["shadowX", 6], ["shadowY", -6], ["shadowBlur", 8], ["shadowAlpha", 45]]) },
        { label: "Motion blur", icon: "sparkle", action: set("Motion blur", [["motionBlur", 60]]) },
        { label: "Afterimage trail", icon: "sparkle", action: set("Afterimage", [["afterimageIntensity", 60], ["afterimageFade", 75], ["afterimageInterval", 0.04]]) },
        "sep",
        {
          label: "Remove styles",
          icon: "close",
          action: () => st.mutate("Remove styles", () => {
            for (const k of ["glowSize", "glowStrength", "glowColor", "outlineWidth", "outlineColor", "shadowX", "shadowY", "shadowBlur", "shadowAlpha", "shadowColor", "motionBlur", "afterimageIntensity", "afterimageFade", "afterimageInterval"]) delete g.tracks[k];
          }),
        },
    ];
  }
  fileMenu() {
    return [
      { label: "Import parts from file…", icon: "import", action: () => this.importParts() },
      { label: "Import image files as parts…", icon: "image", action: () => import('./core.js').then(({ pickFiles }) => pickFiles("image/*", true).then((fs) => fs.length && addImagesAsParts(this, fs, 0, 0))) },
      { label: "Replace with animation file…", icon: "folder", action: () => this.replaceFromFile() },
      "sep",
      { label: "Export animation (.ks5anim)…", icon: "export", action: () => exportAnimFile(this.st.doc, this.st.target) },
      { label: "Export selected parts (.ks5group)…", icon: "export", disabled: !this.st.selGroups.size, action: () => exportGroupsFile(this.st.doc, [...this.st.selGroups], this.st.target) },
    ];
  }
  editMenu() {
    const st = this.st;
    const nk = st.selKeys.size;
    return [
      { label: st.undoStack.length ? "Undo " + st.undoStack[st.undoStack.length - 1].label : "Undo", icon: "undo", kbd: "Ctrl+Z", disabled: !st.undoStack.length, action: () => this.cmd("undo") },
      { label: st.redoStack.length ? "Redo " + st.redoStack[st.redoStack.length - 1].label : "Redo", icon: "redo", kbd: "Ctrl+Shift+Z", disabled: !st.redoStack.length, action: () => this.cmd("redo") },
      "sep",
      { label: "Cut keys", icon: "copy", kbd: "Ctrl+X", disabled: !nk, action: () => this.cmd("cut") },
      { label: "Copy keys", icon: "copy", kbd: "Ctrl+C", disabled: !nk, action: () => this.cmd("copy") },
      { label: "Paste keys at playhead", icon: "paste", kbd: "Ctrl+V", disabled: !this.clipboard, action: () => this.cmd("paste") },
      { label: "Duplicate keys at playhead", icon: "copy", kbd: "Ctrl+D", disabled: !nk, action: () => this.cmd("duplicateKeys") },
      { label: "Delete keys", icon: "trash", kbd: "Del", disabled: !nk, action: () => this.cmd("deleteKeys") },
      { label: "Reverse keys", icon: "reverse", disabled: nk < 2, action: () => this.cmd("reverseKeys") },
      "sep",
      { label: "Select all keys", icon: "marquee", kbd: "Ctrl+A", action: () => this.cmd("selectAllKeys") },
      { label: "Deselect keys", icon: "close", disabled: !nk, action: () => st.clearKeys() },
    ];
  }
  viewMenu() {
    const v = this.st.view;
    return [
      { label: "Fit preview", kbd: "F", icon: "fit", action: () => this.viewport.fit() },
      { label: "Fit timeline", kbd: "Shift+F", icon: "fit", action: () => this.timeline.fit() },
      "sep",
      { label: "Dope sheet", kbd: "1", checked: v.tlMode === "dope", action: () => this.timeline.setMode("dope") },
      { label: "Graph editor", kbd: "2", checked: v.tlMode === "graph", action: () => this.timeline.setMode("graph") },
      "sep",
      { label: "Onion skin", kbd: "O", checked: v.onion, action: () => this.viewport.toggle("onion") },
      { label: "Expressions", kbd: "E", checked: !v.noExprs, action: () => this.cmd("toggleExprs") },
      { label: "Motion paths", checked: v.motionPath, action: () => this.viewport.toggle("motionPath") },
      { label: "Origin", checked: v.showBounds, action: () => this.viewport.toggle("showBounds") },
      "sep",
      { label: "Time in seconds", checked: this.timeFormat === "seconds", action: () => ((this.timeFormat = "seconds"), this.invalidate("all")) },
      { label: "Time in frames", checked: this.timeFormat === "frames", action: () => ((this.timeFormat = "frames"), this.invalidate("all")) },
    ];
  }
  animMenu() {
    const st = this.st;
    return [
      { label: st.playing ? "Pause" : "Play", icon: st.playing ? "pause" : "play", kbd: "Space", action: () => this.togglePlay() },
      { label: "Loop", checked: st.loop, kbd: "L", action: () => this.cmd("toggleLoop") },
      { label: `Playback speed (${st.rate}×)`, icon: "play", submenu: () => this.rateMenu() },
      "sep",
      { label: "Add part…", icon: "plus", action: () => this.addPartDialog() },
      { label: "Add event at playhead…", icon: "flag", action: () => this.cmd("addEvent") },
      ...particleMenu(this),
      { label: "Add data track…", icon: "data", action: () => this.cmd("addDataTrack") },
      "sep",
      { label: "Key transform", icon: "addKey", kbd: "I", action: () => this.cmd("keyTransform") },
      { label: "Trim length to last key", icon: "fit", action: () => st.mutate("Trim length", (d) => (d.duration = Math.max(0.05, ...allKeyframeTimes(d)))) },
      { label: "Length, FPS and size…", action: () => st.selectGroup(null) },
    ];
  }
  exportMenu() {
    return [
      { label: "PNG of this frame", icon: "image", action: () => exportPNG(this) },
      { label: "Animated GIF…", icon: "film", action: () => exportGIF(this) },
      { label: "Video (WebM)…", icon: "film", action: () => exportWebM(this) },
      { label: "Transparent video (MOV)…", icon: "film", action: () => exportMOV(this) },
      { label: "Sprite sheet…", icon: "grid", action: () => exportSpriteSheet(this) },
      "sep",
      { label: "Bake into costumes…", icon: "bake", action: () => bakeToCostumes(this) },
      "sep",
      { label: "Animation file (.ks5anim)…", icon: "export", action: () => exportAnimFile(this.st.doc, this.st.target) },
    ];
  }
  helpMenu() {
    return [
      { label: "Keyboard shortcuts", icon: "help", action: () => this.shortcutsDialog() },
      { label: "Expression for selected keys", icon: "expr", action: () => this.openExpr() },
      "sep",
      { label: "About animations", icon: "help", action: () => alertDialog("Animations", "Keyframe animation, built into Dimod Studio.\n\nRendered on the GPU by the stage's own renderer, so what you see here is exactly what your project shows.") },
    ];
  }
  partMenu(name, pos) {
    const st = this.st;
    const g = st.group(name);
    if (!g) return;
    const others = st.doc.groups.filter((o) => o !== g);
    showMenu(
      [
        { heading: g.name },
        { label: "Rename…", icon: "gear", action: () => promptDialog("Rename part", "Name", g.name).then((v) => v != null && this.renamePart(g, v)) },
        { label: "Duplicate", icon: "copy", kbd: "Ctrl+D", action: () => ((st.primary = name), this.cmd("duplicatePart")) },
        { label: g.visible ? "Hide" : "Show", icon: g.visible ? "eyeOff" : "eye", action: () => st.mutate("Toggle visibility", () => (g.visible = !g.visible)) },
        { label: "Costume source…", icon: "sprite", action: () => this.changeSpriteDialog(g) },
        { label: "Quick style", icon: "sparkle", submenu: () => this.quickFxItems(g) },
        { label: "Flip horizontally", icon: "mirror", action: () => this.flipParts("h", [name]) },
        { label: "Flip vertically", icon: "mirrorV", action: () => this.flipParts("v", [name]) },
        others.length ? { label: "Parent to", icon: "link", submenu: () => others.map((o) => ({ label: o.name, action: () => this.setParent(name, o.name) })) } : null,
        g.tracks.relativeTo ? { label: "Unparent", icon: "unlink", action: () => this.setParent(name, null) } : null,
        "sep",
        { label: "Bring forward", icon: "layers", action: () => st.mutate("Reorder", (d) => moveGroup(d, g, d.groups.indexOf(g) + 1)) },
        { label: "Send backward", icon: "layers", action: () => st.mutate("Reorder", (d) => moveGroup(d, g, d.groups.indexOf(g) - 1)) },
        "sep",
        { label: "Export part (.ks5group)…", icon: "export", action: () => exportGroupsFile(st.doc, st.selGroups.has(name) ? [...st.selGroups] : [name], st.target) },
        { label: "Import track into part…", icon: "import", action: () => ((st.primary = name), this.importParts()) },
        "sep",
        { label: "Delete", icon: "trash", kbd: "Del", danger: true, action: () => ((st.selGroups = new Set([name])), this.cmd("deletePart")) },
      ],
      pos,
      { ctx: true },
    );
  }
  async replaceFromFile() {
    const st = this.st;
    try {
      const parsed = await pickAndParse();
      if (!parsed) return;
      if (parsed.kind !== "anim") return this.applyParsed(parsed);
      const { animFromParsed } = await Promise.resolve().then(function () { return files; });
      const doc = await animFromParsed(parsed, st.target);
      if (!doc) return;
      const id = st.doc.id;
      st.mutate("Replace animation", () => { const n = normalizeAnim(doc); n.id = id; Object.assign(st.doc, n); });
      st.invalidateBindings();
      this.viewport.fit(true);
      this.timeline.fit();
    } catch (e) { alertDialog("Couldn't import", e.message || String(e)); }
  }
  async pickAudio() {
    const { pickSoundDialog } = await Promise.resolve().then(function () { return dialogs; });
    const pick = await pickSoundDialog(this);
    if (!pick) return;
    this.st.mutate("Set sound", (d) => { d.audioSpriteName = pick.sprite; d.audioSoundName = pick.sound; });
    this.loadAudio(pick.sprite, pick.sound);
  }
  clearAudio() {
    this.st.mutate("Remove sound", (d) => { d.audioSpriteName = null; d.audioSoundName = null; });
    if (this.audio) this.audio.dispose();
    this.audio = null;
    this.invalidate("timeline");
  }
  async loadAudio(spriteName, soundName, silent) {
    try {
      const t = this.ext.runtime.targets.find((x) => x.isOriginal && x.sprite && x.sprite.name === spriteName);
      const s = t && t.sprite.sounds.find((x) => x.name === soundName);
      if (!s || !s.asset) throw new Error(`Sound "${soundName}" not found in "${spriteName}".`);
      if (this.audio) this.audio.dispose();
      this.audio = await AudioTrack.fromAsset(s.asset);
      this.invalidate("timeline");
    } catch (e) {
      if (!silent) toast(e.message, true);
    }
  }
  settingsDialog() {
    Promise.resolve().then(function () { return dialogs; }).then(({ settingsDialog }) => settingsDialog(this, { prefs, savePrefs, resetPrefs }));
  }
  onionDialog() { Promise.resolve().then(function () { return dialogs; }).then(({ onionDialog }) => onionDialog(this)); }
  shortcutsDialog() {
    Promise.resolve().then(function () { return dialogs; }).then(({ shortcutsDialog }) => shortcutsDialog(this));
  }
  costumeThumb(costume) {
    this._thumbs ||= new Map();
    const key = costume.assetId || costume.name;
    if (this._thumbs.has(key)) return this._thumbs.get(key);
    let url = "";
    try {
      const a = costume.asset;
      if (a) url = URL.createObjectURL(new Blob([a.data], { type: a.assetType.contentType }));
    } catch { url = ""; }
    const p = Promise.resolve(url);
    p.url = url;
    this._thumbs.set(key, p);
    return p;
  }
  costumeThumbForGroup(g) {
    const st = this.st;
    const gi = st.groupIndex(g.name);
    const b = st.bindings()[gi];
    if (!b) return "";
    const idx = st.currentPose().costume[gi];
    const c = b.costumes[idx >= 0 ? idx : 0];
    if (!c) return "";
    const p = this.costumeThumb(c);
    if (p.url === undefined) p.then(() => this.invalidate("all"));
    return p.url || "";
  }
  save() {
    clearTimeout(this.commitTimer);
    const st = this.st;
    const bindings = st.bindings();
    st.doc.groups.forEach((g, i) => {
      const b = bindings[i];
      if (b) { g.costumeNames = b.names.slice(); g.costumeIds = b.assetIds.slice(); }
    });
    const doc = normalizeAnim(JSON.parse(serializeAnim(st.doc)));
    if (this.opts.onCommit) this.opts.onCommit(doc);
    st.markSaved();
  }
  destroy() {
    if (this.st.dirty) this.save();
    if (this.unregisterCollab) this.unregisterCollab();
    if (this.offCollab) this.offCollab();
    clearTimeout(this.commitTimer);
    this.pause();
    cancelAnimationFrame(this.raf);
    document.removeEventListener("keydown", this.onKey, true);
    document.removeEventListener("keyup", this.onKeyUp, true);
    if (this.audio) this.audio.dispose();
    this.viewport.dispose();
    closeMenus();
  }
}
const SNIPPETS = [
  ["Wobble", "Jitter", "jitter(t, value, 3, 8, 0.8)"],
  ["Wobble", "Shake", "jitter(time, value, 16, 32, 0.1)"],
  ["Wobble", "Smooth drift", "value + noise(t * 0.8) * 30"],
  ["Wobble", "Layered drift", "value + sin(t * 1.3) * 20 + sin(t * 2.7) * 8 + sin(t * 5.1) * 3"],
  ["Waves", "Sine wave", "value + sin(t * TAU) * 20"],
  ["Waves", "Bounce", "value + abs(sin(t * PI * 2)) * 40"],
  ["Waves", "Square pulse", "value + (sin(t * TAU) > 0 ? 25 : -25)"],
  ["Waves", "Sawtooth", "value + mod(t, 1) * 100"],
  ["Motion", "Orbit X", "value + cos(t * TAU) * 80"],
  ["Motion", "Orbit Y", "value + sin(t * TAU) * 80"],
  ["Motion", "Float", "value + sin(t * PI) * 12"],
  ["Motion", "Breathe (scale)", "value * (1 + sin(t * TAU * 0.5) * 0.04)"],
  ["Motion", "Spin", "value + t * 360"],
  ["Rhythm", "Heartbeat", "value + (mod(t, 1) < 0.1 ? 20 : 0)"],
  ["Rhythm", "Step every quarter second", "value + floor(t * 4) * 25"],
  ["Live", "Follow the clock", "value + sin(time * TAU) * 20"],
  ["Live", "Blink randomly", "jitter(time, 1, 0.5, 0) > 0.9 ? 0 : value"],
  ["Data", "Add a data value", "value + (data.myVar || 0)"],
  ["Data", "Map data 0 to 1", "lerp(-45, 45, clamp(data.amount || 0, 0, 1))"],
  ["Costume", "Cycle costumes", "floor(t * 12) % 4"],
  ["Costume", "Costume by name", '"costume1"'],
];
export { ACCEPT, animFileObject, animFromFileObject, DRAW_TOOLS, drawTarget, newDrawingFrame, AudioTrack, BUILTIN, CSS, CSS_DOCK, CSS_PAINT, CSS_TAB, Editor, EditorState, GifEncoder, GraphView, ICON_NAMES, MovWriter, OffscreenView, ParticlePreview, RULER, SNIPPETS, Timeline, Viewport, addGroup, addImagesAsParts, addPartDialog, alertDialog, animFromParsed, applyPreset, bakeToCostumes, btn, canBeRandom, canHaveExpr, changeSpriteDialog, chooseDialog, clearEl, closeMenus, colorSwatch, confirmDialog, contentBox, copyKeys, costumeRefAt, deleteGroup, deleteKeys, duplicateGroup, ensureTrack, evalNumber, exportAnimFile, exportGIF, exportGroupsFile, exportMOV, exportPNG, exportSpriteSheet, exportTrackFile, exportWebM, exprKeyIds, fmtHead, getEditorVM, EASE_TO_BEZ as graphEASE_TO_BEZ, h, hasKeyAt, hexA, icon as iconsIcon, iconEl as iconsIconEl, importAnimFile, importGroupAsNewAnim, importGroupsInto, injectCSS, installTooltips, io, isAncestor, keyAt, lbtn, loadUserPresets, materializeGroups, md5Of, mergeGroups, mergeParsedInto, miniBtn, moveGroup, moveKeys, onionDialog, openAnimationDialog, openExprEditor, openProgressDialog, openPropertyExpr, openTrackExpr, parseAnimationFile, particleMenu, pasteKeys, pickAndParse, pickSoundDialog, prefs, presetsMenu, promptDialog as presetsPromptDialog, readJSONFile, removeKeyAt, renameGroup, renderThumbnail, resetPrefs, reverseKeys, savePrefs, savePresetDialog, scaleKeys, scrub, seg, select, setAnimationDialogHost, setEditorVM, setKey, setKeysExpr, setKeysRandom, setKeysRandomEnd, setParent, setTrackExpr, settingsDialog, shortcutsDialog, showMenu, sortTrack, staticParent, textInput, EASE_TO_BEZ as timelineEASE_TO_BEZ, promptDialog as timelinePromptDialog, toast as timelineToast, toggle, trackFromParsed, icon as uiIcon, iconEl as uiIconEl, promptDialog as uiPromptDialog, toast as uiToast, valueForKey, iconEl as viewportIconEl, toast as viewportToast, worldToLocal };
