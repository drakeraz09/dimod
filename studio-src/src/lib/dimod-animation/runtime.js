import {newDrawCmd, buildDrawCmd, GpuPipeline, renderPose, createKS5Skin, skinFrame} from './render.js';
import {
    SLOT,
    NUM_SLOTS,
    TD,
    NUM_PROPS,
    ALL_TRACKS,
    PoseSet,
    setOverridesEnabled,
    bindingsFor,
    bindingEpoch,
    bumpBindingEpoch,
    AnimStore,
    AnimRecord,
    AnimValue,
    serializeAnim,
    normalizeAnim,
    makeAnimId
} from './core.js';
import compatBlocks from 'scratch-vm/src/compiler/compat-blocks';
import Cast from 'scratch-vm/src/util/cast';
import sb3 from 'scratch-vm/src/serialization/sb3';
import Sprite from 'scratch-vm/src/sprites/sprite';
const S = SLOT;
const _cmd$1 = newDrawCmd();
const GRID = 32;
const poseBounds = (renderer, compiled, pose, bindings) => {
    const ctx = {renderer, W: 0, H: 0, texScale: 1, cx: 0, cy: 0};
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const num = pose.num;
    for (let gi = 0; gi < compiled.groups.length; gi++) {
        if (!compiled.isVisible(pose, gi)) continue;
        const d = buildDrawCmd(ctx, compiled, pose, gi, bindings ? bindings[gi] : null, _cmd$1);
        if (!d) continue;
        const b = gi * NUM_SLOTS;
        const local = (Math.max(0, num[b + S.glowSize] || 0) * 2) +
            Math.max(0, num[b + S.outlineWidth] || 0) +
            (Math.max(0, num[b + S.shadowBlur] || 0) * 2) +
            Math.abs(num[b + S.fxChromaticX] || 0) + Math.abs(num[b + S.fxChromaticY] || 0);
        let after = Math.abs(num[b + S.shadowX] || 0) + Math.abs(num[b + S.shadowY] || 0);
        if (d.filter) {
            after += (d.filter.blur || 0) * 2;
            for (const sh of d.filter.shadows) after += Math.abs(sh.x) + Math.abs(sh.y) + ((sh.blur || 0) * 2);
        }
        const [A, B, C, D, E, F] = d.canvas;
        const mx = local / d.boxPx[0];
        const my = local / d.boxPx[1];
        for (let k = 0; k < 4; k++) {
            const gx = (k & 1) ? 1 + mx : -mx;
            const gy = (k & 2) ? 1 + my : -my;
            const x = (A * gx) + (C * gy) + E;
            const y = -((B * gx) + (D * gy) + F);
            if (x - after < minX) minX = x - after;
            if (x + after > maxX) maxX = x + after;
            if (y - after < minY) minY = y - after;
            if (y + after > maxY) maxY = y + after;
        }
    }
    if (!(minX <= maxX && minY <= maxY)) return null;
    return {minX, minY, maxX, maxY};
};
const snapDown = v => Math.floor(v / GRID) * GRID;
const snapUp = v => Math.ceil(v / GRID) * GRID;
const nextBox = (need, current) => {
    if (!need) return current || {minX: -GRID, minY: -GRID, maxX: GRID, maxY: GRID};
    const snapped = {
        minX: snapDown(need.minX),
        minY: snapDown(need.minY),
        maxX: Math.max(snapUp(need.maxX), snapDown(need.minX) + GRID),
        maxY: Math.max(snapUp(need.maxY), snapDown(need.minY) + GRID)
    };
    if (!current) return snapped;
    const fits = need.minX >= current.minX && need.maxX <= current.maxX &&
        need.minY >= current.minY && need.maxY <= current.maxY;
    if (!fits) {
        return {
            minX: Math.min(snapped.minX, current.minX),
            minY: Math.min(snapped.minY, current.minY),
            maxX: Math.max(snapped.maxX, current.maxX),
            maxY: Math.max(snapped.maxY, current.maxY)
        };
    }
    const area = b => (b.maxX - b.minX) * (b.maxY - b.minY);
    return area(current) > area(snapped) * 2 ? snapped : current;
};
const _cmd = newDrawCmd();
function animToStage(target, entry, ax, ay) {
  const doc = entry.record.doc;
  const dx = ax - (doc.canvasOffsetX || 0);
  const dy = ay - (doc.canvasOffsetY || 0);
  const { direction, scale } = target._getRenderedDirectionAndScale ? target._getRenderedDirectionAndScale() : { direction: target.direction, scale: [target.size, target.size] };
  const sx = scale[0] / 100, sy = scale[1] / 100;
  const r = ((90 - direction) * Math.PI) / 180;
  const px = dx * sx, py = dy * sy;
  return [target.x + px * Math.cos(r) - py * Math.sin(r), target.y + px * Math.sin(r) + py * Math.cos(r)];
}
function stageToAnim(target, entry, x, y) {
  const doc = entry.record.doc;
  const { direction, scale } = target._getRenderedDirectionAndScale ? target._getRenderedDirectionAndScale() : { direction: target.direction, scale: [target.size, target.size] };
  const sx = scale[0] / 100 || 1e-5, sy = scale[1] / 100 || 1e-5;
  const r = ((90 - direction) * Math.PI) / 180;
  const dx = x - target.x, dy = y - target.y;
  const px = dx * Math.cos(-r) - dy * Math.sin(-r);
  const py = dx * Math.sin(-r) + dy * Math.cos(-r);
  return [px / sx + (doc.canvasOffsetX || 0), py / sy + (doc.canvasOffsetY || 0)];
}
function drawCmdFor(stage, entry, gi) {
  const rec = entry.record;
  const compiled = rec.compiled;
  const pose = stage.poseOf(entry);
  if (!pose || pose.n !== compiled.groups.length) return null;
  const bindings = entry.bindings;
  return buildDrawCmd({ renderer: stage.renderer, W: rec.doc.width, H: rec.doc.height, texScale: 1 }, compiled, pose, gi, bindings ? bindings[gi] : null, _cmd);
}
function partInfo(stage, target, groupName) {
  const entry = stage.entries.get(target.drawableID);
  if (!entry || !entry.record) return null;
  const compiled = entry.record.compiled;
  const gi = compiled.byName.get(groupName);
  if (gi === undefined) return null;
  const pose = stage.poseOf(entry);
  if (!pose || pose.n !== compiled.groups.length) return null;
  const w = gi * 5;
  const [x, y] = animToStage(target, entry, pose.world[w], pose.world[w + 1]);
  const dir = target._getRenderedDirectionAndScale ? target._getRenderedDirectionAndScale().direction : target.direction;
  const sc = target._getRenderedDirectionAndScale ? target._getRenderedDirectionAndScale().scale : [target.size, target.size];
  return {
    x, y, rotation: pose.world[w + 2] + (dir - 90), visible: compiled.isVisible(pose, gi),
    scaleX: (pose.world[w + 3] * sc[0]) / 100, scaleY: (pose.world[w + 4] * sc[1]) / 100,
  };
}
const _scratchPoses = new WeakMap();
const hex6 = (n) => "#" + (Math.max(0, Math.min(0xffffff, Math.round(n))) >>> 0).toString(16).padStart(6, "0");
function partProperty(stage, rec, target, groupName, prop, sec) {
  const compiled = rec.compiled;
  const gi = compiled.byName.get(groupName);
  if (gi === undefined || !TD[prop]) return null;
  let t = sec;
  if (typeof t !== "number" || !Number.isFinite(t)) {
    const pl = target && stage.players.get(target.id);
    t = pl && pl.record && pl.record.id === rec.id ? pl.sec || 0 : 0;
  }
  t = compiled.infinite ? Math.max(0, t) : Math.max(0, Math.min(t, rec.doc.duration));
  let pose = _scratchPoses.get(compiled);
  if (!pose) _scratchPoses.set(compiled, (pose = new PoseSet(0)));
  const ovs = rec.overridesArray();
  compiled.evaluate(t, pose, stage.dataFor(rec, t), Date.now() / 1000, null, ovs);
  const g = compiled.groups[gi];
  if (prop === "costume") {
    const ov = ovs && ovs[gi];
    if (ov && ov.has("costume")) return ov.get("costume");
    const v = g.costume ? g.costume.sampleAny(t) : "";
    return v === null || typeof v === "undefined" ? "" : v;
  }
  if (prop === "blendMode") return pose.blend[gi];
  if (prop === "fxCustom") return pose.filter[gi];
  if (prop === "relativeTo") return pose.parent[gi] >= 0 ? compiled.groups[pose.parent[gi]].name : "";
  if (prop === "maskSource") return pose.mask[gi] >= 0 ? compiled.groups[pose.mask[gi]].name : "";
  const v = pose.num[gi * NUM_SLOTS + SLOT[prop]];
  if (TD[prop].kind === "color") return hex6(v);
  if (TD[prop].bool) return v !== 0;
  return Math.round(v * 1000) / 1000;
}
function partContains(stage, target, groupName, x, y) {
  const entry = stage.entries.get(target.drawableID);
  if (!entry || !entry.record) return false;
  const compiled = entry.record.compiled;
  const gi = compiled.byName.get(groupName);
  if (gi === undefined || !compiled.isVisible(stage.poseOf(entry), gi)) return false;
  const d = drawCmdFor(stage, entry, gi);
  if (!d) return false;
  const doc = entry.record.doc;
  const [ax, ay] = stageToAnim(target, entry, x, y);
  const X = doc.width / 2 + ax;
  const Y = doc.height / 2 - ay;
  const [A, B, C, D, E, F] = d.canvas;
  const det = A * D - B * C;
  if (Math.abs(det) < 1e-12) return false;
  const gx = (D * (X - E) - C * (Y - F)) / det;
  const gy = (A * (Y - F) - B * (X - E)) / det;
  const u = gx * d.padUV[0] - d.padUV[2];
  const v = gy * d.padUV[1] - d.padUV[3];
  if (u < 0 || v < 0 || u > 1 || v > 1) return false;
  const skin = d.skin;
  try {
    if (skin.updateSilhouette) skin.updateSilhouette([100, 100]);
    return !!skin.isTouchingLinear([u, v]);
  } catch { return true; }
}
const COLOR_SLOTS = new Set(NUM_PROPS.map((k, i) => (TD[k].kind === "color" ? i : -1)).filter((i) => i >= 0));
function mixColor(a, b, w) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * w) << 16) | (Math.round(ag + (bg - ag) * w) << 8) | Math.round(ab + (bb - ab) * w);
}
const DETAIL = { low: 0.5, medium: 1, high: 2 };
function applyPlayMode(t, dur, mode) {
  if (!(dur > 0)) return 0;
  switch (mode) {
    case "loop": { const r = t % dur; return r < 0 ? r + dur : r; }
    case "pingpong": { const p = dur * 2; const r = ((t % p) + p) % p; return r <= dur ? r : p - r; }
    case "reverse":
      return Math.max(0, Math.min(dur - t, dur));
    case "reverseloop": { const r = t % dur; return dur - (r < 0 ? r + dur : r); }
    case "once":
    case "clamp":
    default:
      return Math.max(0, Math.min(t, dur));
  }
}
class Entry {
  constructor(target, skin) {
    this.target = target;
    this.drawableID = target.drawableID;
    this.skin = skin;
    this.pose = new PoseSet(0);
    this.mbPoses = [];
    this.key = "";
    this.lastUsed = 0;
    this.record = null;
    this.evLast = new Map();
    this.fadePose = null;
    this.box = null;
    this.sec = 0;
    this.sharedWith = null;
    this.poseKey = "";
    this.bindings = null;
  }
}
class StageRuntime {
  constructor(ext) {
    this.ext = ext;
    this.runtime = ext.runtime;
    this.entries = new Map();
    this.players = new Map();
    this.shared = new Map();
    this.frame = 0;
    this._lastTick = 0;
    this.data = {};
  }
  get renderer() { return this.runtime.renderer; }
  get pipe() { return GpuPipeline.for(this.renderer); }
  entryFor(target, create = true) {
    const id = target.drawableID;
    let e = this.entries.get(id);
    if (e && e.target !== target) e.target = target;
    if (!e && create) {
      const pipe = this.pipe;
      if (!pipe) return null;
      const skin = createKS5Skin(this.renderer, pipe);
      e = new Entry(target, skin);
      this.entries.set(id, e);
    }
    return e;
  }
  show(record, target, sec, layers = null, blendPose = null) {
    if (!target || target.drawableID === undefined || !record) return false;
    const renderer = this.renderer;
    const pipe = this.pipe;
    if (!renderer || !pipe) return false;
    const e = this.entryFor(target);
    if (!e) return false;
    const compiled = record.compiled;
    const st = record.state;
    e.lastUsed = this.frame;
    e.record = record;
    e.sec = sec;
    this.fireEvents(e, record, sec, target);
    const detail = DETAIL[st.detail ?? this.ext.globalDetail] || 1;
    const aa = (st.aa ?? this.ext.globalAA) !== false;
    const owner = record.ownerSprite || null;
    const sprite = owner || target.sprite;
    const bindings = bindingsFor(this.runtime, compiled, target, owner);
    e.bindings = bindings;
    const key =
      layers || blendPose || compiled.dynamic || compiled.anyAfterimage
        ? ""
        : `${record.serial}|${sec}|${st.dataVersion}|${st.overridesVersion}|${bindingEpoch()}|${spriteSerial(sprite)}|${detail}|${aa}|${this.ext.overridesEnabled}` +
          (compiled.hasRandom ? `|${e.drawableID}` : "");
    const drawable = renderer._allDrawables[e.drawableID];
    if (key && key === e.key && !e.sharedWith && e.skin.contentKey === key) { this.attach(drawable, e.skin); return true; }
    if (key) {
      const src = this.shared.get(key);
      if (src && src !== e && src.skin.contentKey === key && this.entries.get(src.drawableID) === src) {
        e.key = key;
        e.sharedWith = src;
        this.attach(drawable, src.skin);
        return true;
      }
    }
    e.key = key;
    e.sharedWith = null;
    const skin = e.skin;
    const doc = record.doc;
    skin.aa = aa;
    const want = quantize(skin.requestedScale * detail);
    const data = this.dataFor(record, sec);
    const time = Date.now() / 1000;
    const pose = compiled.evaluate(sec, e.pose, data, time, bindings, record.overridesArray());
    if (blendPose) blendPose(pose, bindings);
    e.poseKey = key;
    const passes = [];
    let trailing = compiled.anyMotionBlur || compiled.anyAfterimage;
    if (layers) {
      for (const L of layers) {
        const lc = L.record.compiled;
        const lb = bindingsFor(this.runtime, lc, target, L.record.ownerSprite || null);
        const lp = lc.evaluate(L.sec, (L.pose ||= new PoseSet(0)), this.dataFor(L.record, L.sec), time, lb, L.record.overridesArray());
        passes.push({ compiled: lc, pose: lp, bindings: lb, alpha: L.alpha });
        if (lc.anyMotionBlur || lc.anyAfterimage) trailing = true;
      }
    }
    passes.push({ compiled, pose, bindings, alpha: layers ? layers.mainAlpha ?? 1 : 1, main: true });
    let need = null;
    for (const p of passes) need = unionBox(need, poseBounds(renderer, p.compiled, p.pose, p.bindings));
    if (trailing) need = unionBox(need, { minX: -doc.width / 2, minY: -doc.height / 2, maxX: doc.width / 2, maxY: doc.height / 2 });
    const box = (e.box = nextBox(need, e.box));
    const W = box.maxX - box.minX;
    const H = box.maxY - box.minY;
    const offX = doc.canvasOffsetX || 0;
    const offY = doc.canvasOffsetY || 0;
    skin.setGeometry(W, H, offX - box.minX, box.maxY - offY);
    const resized = skin.surface.ensure(W, H, want);
    if (resized) skin.surface.clearTrails();
    const opts = {
      renderer,
      aa,
      fps: doc.fps,
      texScale: 1,
      cx: (box.minX + box.maxX) / 2,
      cy: (box.minY + box.maxY) / 2,
      poseAt: compiled.anyMotionBlur ? (t2, i) => compiled.evaluate(t2, (e.mbPoses[i] ||= new PoseSet(0)), data, time, bindings, record.overridesArray()) : null,
    };
    let first = true;
    for (const p of passes) {
      renderPose(pipe, skin.surface, p.compiled, p.pose, { ...opts, bindings: p.bindings, alpha: p.alpha, clear: first, poseAt: p.main ? opts.poseAt : null });
      first = false;
    }
    skin.contentKey = key || null;
    if (key) this.shared.set(key, e);
    skin.markContentChanged();
    this.attach(drawable, skin);
    if (drawable && drawable.setConvexHullDirty) drawable.setConvexHullDirty();
    renderer.dirty = true;
    return true;
  }
  poseOf(e) {
    if (!e || !e.record) return null;
    if (e.sharedWith && e.poseKey !== e.key) {
      const rec = e.record;
      rec.compiled.evaluate(e.sec, e.pose, this.dataFor(rec, e.sec), Date.now() / 1000, e.bindings, rec.overridesArray());
      e.poseKey = e.key;
    }
    return e.pose;
  }
  fixShared() {
    for (const e of this.entries.values()) {
      const src = e.sharedWith;
      if (!src) continue;
      if (src.skin.contentKey === e.key && this.entries.get(src.drawableID) === src) continue;
      e.sharedWith = null;
      if (e.record && e.target && !e.target.isDisposed) this.show(e.record, e.target, e.sec);
    }
  }
  attach(drawable, skin) {
    if (!drawable || drawable.skin === skin) return;
    this.renderer.updateDrawableSkinId(drawable.id, skin.id);
  }
  dataFor(record, sec) {
    const compiled = record.compiled;
    const st = record.state;
    if (!compiled.hasDataTracks) return st.data;
    const d = (record._dataObj ||= {});
    return compiled.fillData(sec, st.data, d);
  }
  fireEvents(e, record, sec, target) {
    const compiled = record.compiled;
    if (!compiled.events.length) return;
    const id = record.id;
    let last = e.evLast.has(id) ? e.evLast.get(id) : -1;
    if (sec < last || (sec <= 1e-4 && last > 0)) last = -1;
    if (sec !== last) {
      compiled.eventsBetween(last, sec, (value, at) => {
        record.state.lastEvent = value;
        this.ext.lastEventGlobal = value;
        try { this.runtime.startHats("event_whenbroadcastreceived", { BROADCAST_OPTION: value }); } catch {}
        for (const hat of [this.ext.eventHat, this.ext.eventHatIn]) {
          try {
            const threads = [
              ...(this.runtime.startHats(hat, { EVENT: String(value).toUpperCase() }, target) || []),
              ...(this.runtime.startHats(hat, { EVENT: "(ANY EVENT)" }, target) || []),
            ];
            for (const thread of threads) thread.dimodAnimEvent = record;
          } catch {}
        }
        this.runtime.emit("DIMOD_ANIMATION_EVENT", target, record, value, at);
      });
    }
    e.evLast.set(id, sec);
  }
  restore(target) {
    const e = this.entries.get(target.drawableID);
    const renderer = this.renderer;
    if (!renderer) return;
    const drawable = renderer._allDrawables[target.drawableID];
    if (e) { e.sharedWith = null; e.key = ""; }
    if (drawable && drawable.skin && drawable.skin.isKS5) {
      const costume = target.getCostumes()[target.currentCostume];
      if (costume) renderer.updateDrawableSkinId(target.drawableID, costume.skinId);
    }
  }
  sweep() {
    const renderer = this.renderer;
    if (!renderer) return;
    const dropped = [];
    for (const [id, e] of this.entries) {
      const drawable = renderer._allDrawables[id];
      const gone = !drawable;
      const inUse = [...this.entries.values()].some((x) => x.sharedWith === e);
      const stale = drawable && drawable.skin !== e.skin && !inUse && this.frame - e.lastUsed > 600;
      if (gone || stale) {
        this.entries.delete(id);
        dropped.push(e);
        for (const [tid, p] of this.players) if (p.target && p.target.drawableID === id) this.players.delete(tid);
      }
    }
    if (!dropped.length) return;
    for (const [key, e] of this.shared) if (dropped.includes(e)) this.shared.delete(key);
    this.fixShared();
    for (const e of dropped) {
      try { renderer.destroySkin(e.skin.id); } catch {}
    }
  }
  disposeAll() {
    const renderer = this.renderer;
    for (const [id, e] of this.entries) {
      const drawable = renderer && renderer._allDrawables[id];
      if (drawable && drawable.skin && drawable.skin.isKS5 && e.target) {
        const costume = e.target.getCostumes()[e.target.currentCostume];
        if (costume) renderer.updateDrawableSkinId(id, costume.skinId);
      }
    }
    for (const e of this.entries.values()) {
      try { renderer.destroySkin(e.skin.id); } catch {}
    }
    this.entries.clear();
    this.shared.clear();
    this.players.clear();
  }
  play(target, record, mode = "loop", opts = {}) {
    let p = this.players.get(target.id);
    if (p && opts.crossfade > 0 && p.record) {
      p.prev = { record: p.record, t: p.t, speed: p.speed, mode: p.mode };
      p.fade = { dur: opts.crossfade, elapsed: 0 };
    } else if (p) { p.prev = null; p.fade = null; }
    if (!p) {
      p = { target, record, t: 0, speed: 1, mode, playing: true, prev: null, fade: null, done: false, waiters: [] };
      this.players.set(target.id, p);
    }
    p.target = target;
    p.record = record;
    p.mode = mode;
    p.t = opts.from || 0;
    p.playing = true;
    p.done = false;
    this.tickPlayer(p, 0);
    return p;
  }
  stop(target, restore = true) {
    const p = this.players.get(target.id);
    if (p) { p.done = true; this.players.delete(target.id); }
    if (restore) this.restore(target);
  }
  tick() {
    this.frame++;
    skinFrame.value = this.frame;
    const now = performance.now();
    let dt = this._lastTick ? (now - this._lastTick) / 1000 : 0;
    this._lastTick = now;
    if (dt > 0.25) dt = 0.25;
    if (this.runtime.ioDevices && this.runtime.ioDevices.clock && this.runtime.ioDevices.clock._paused) dt = 0;
    const drawables = this.renderer ? this.renderer._allDrawables : null;
    for (const [id, p] of this.players) {
      if (!p.target || p.target.isDisposed || !drawables || !drawables[p.target.drawableID]) {
        this.players.delete(id);
        continue;
      }
      this.tickPlayer(p, p.playing ? dt : 0);
    }
    this.fixShared();
    if (this.frame % 120 === 0) this.sweep();
  }
  tickPlayer(p, dt) {
    const rec = p.record;
    const dur = rec.compiled.infinite ? Infinity : rec.doc.duration;
    p.t += dt * p.speed;
    let sec;
    if (p.mode === "once") {
      if (p.t >= dur) {
        p.t = dur;
        if (!p.done) { p.done = true; p.playing = false; this.runtime.emit("DIMOD_ANIMATION_END", p.target, rec); }
      }
      sec = Math.max(0, Math.min(p.t, dur));
    } else sec = Number.isFinite(dur) ? applyPlayMode(p.t, dur, p.mode) : Math.max(0, p.t);
    p.sec = sec;
    let layers = null;
    let blend = null;
    if (p.fade) {
      p.fade.elapsed += dt;
      const w = Math.min(1, p.fade.elapsed / p.fade.dur);
      const prev = p.prev;
      prev.t += dt * prev.speed;
      const pdur = prev.record.compiled.infinite ? Infinity : prev.record.doc.duration;
      const psec = Number.isFinite(pdur) ? applyPlayMode(prev.t, pdur, prev.mode === "once" ? "clamp" : prev.mode) : prev.t;
      if (w >= 1) { p.fade = null; p.prev = null; } else if (samePartSet(prev.record, rec)) { blend = makePoseBlender(this, prev.record, psec, p.target, 1 - w); } else { layers = [{ record: prev.record, sec: psec, alpha: 1 - w }]; layers.mainAlpha = w; }
    }
    this.show(rec, p.target, sec, layers, blend);
  }
}
const _spriteSerials = new WeakMap();
let _nextSpriteSerial = 1;
function spriteSerial(sprite) {
  if (!sprite) return 0;
  let n = _spriteSerials.get(sprite);
  if (!n) _spriteSerials.set(sprite, (n = _nextSpriteSerial++));
  return n;
}
function unionBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}
function quantize(s) {
  if (!(s > 0)) return 1;
  const q = Math.round(Math.log2(s) * 4) / 4;
  return Math.min(4, Math.max(0.25, 2 ** q));
}
function samePartSet(a, b) {
  const ga = a.compiled.groups, gb = b.compiled.groups;
  if (ga.length !== gb.length) return false;
  for (let i = 0; i < ga.length; i++) if (!b.compiled.byName.has(ga[i].name)) return false;
  return true;
}
function makePoseBlender(stage, prevRec, psec, target, wPrev) {
  return (pose, bindings) => {
    const pc = prevRec.compiled;
    const pb = bindingsFor(stage.runtime, pc, target, prevRec.ownerSprite || null);
    const tmp = (prevRec._blendPose ||= new PoseSet(0));
    pc.evaluate(psec, tmp, stage.dataFor(prevRec, psec), Date.now() / 1000, pb, prevRec.overridesArray());
    const cur = pose;
    const names = pc.byName;
    const n = cur.n;
    const curCompiled = target && stage.entries.get(target.drawableID)?.record?.compiled;
    const groups = curCompiled ? curCompiled.groups : null;
    for (let gi = 0; gi < n; gi++) {
      const pi = groups ? names.get(groups[gi].name) : gi;
      if (pi === undefined) continue;
      const a = gi * NUM_SLOTS, b = pi * NUM_SLOTS;
      for (let s = 0; s < NUM_SLOTS; s++) {
        cur.num[a + s] = COLOR_SLOTS.has(s) ? mixColor(cur.num[a + s], tmp.num[b + s], wPrev) : cur.num[a + s] * (1 - wPrev) + tmp.num[b + s] * wPrev;
      }
      const wa = gi * 5, wb = pi * 5;
      for (let k = 0; k < 5; k++) cur.world[wa + k] = cur.world[wa + k] * (1 - wPrev) + tmp.world[wb + k] * wPrev;
      if (wPrev > 0.5) cur.costume[gi] = tmp.costume[pi];
    }
    for (let gi = 0; gi < n; gi++) {
      const base = gi * NUM_SLOTS;
      cur.num[base + SLOT.visible] = cur.num[base + SLOT.visible] >= 0.5 ? 1 : 0;
      cur.num[base + SLOT.zIndex] = Math.round(cur.num[base + SLOT.zIndex]);
    }
  };
}
const P = 'looks_dimod_anim_';
const ANIM_OPCODES = {
    animation: `${P}animation`,
    name: `${P}name`,
    duplicate: `${P}duplicate`,
    play: `${P}play`,
    playUntilDone: `${P}playuntildone`,
    crossfade: `${P}crossfade`,
    stop: `${P}stop`,
    pause: `${P}pause`,
    setSpeed: `${P}setspeed`,
    time: `${P}time`,
    playing: `${P}playing`,
    whenEvent: `${P}whenevent`,
    whenEventIn: `${P}wheneventin`,
    render: `${P}render`,
    duration: `${P}duration`,
    property: `${P}property`,
    lastEvent: `${P}lastevent`,
    setPart: `${P}setpart`,
    resetPart: `${P}resetpart`,
    partValue: `${P}partvalue`,
    partProperty: `${P}partproperty`,
    partTouchingMouse: `${P}parttouchingmouse`,
    partTouchingXY: `${P}parttouchingxy`,
    setData: `${P}setdata`,
    getData: `${P}getdata`,
    setTimeMode: `${P}settimemode`,
    mapTime: `${P}maptime`,
    progress: `${P}progress`,
    loopCount: `${P}loopcount`,
    setSmoothing: `${P}setsmoothing`,
    setDetail: `${P}setdetail`,
    menu: `${P}menu`,
    partMenu: `${P}partmenu`,
    eventMenu: `${P}eventmenu`
};
const PART_PROPS = [
    ['x', 'x'], ['y', 'y'], ['rotation', 'rotation'], ['scale x', 'scaleX'], ['scale y', 'scaleY'],
    ['alpha', 'alpha'], ['skew x', 'skewX'], ['skew y', 'skewY'], ['flip x', 'flipX'], ['flip y', 'flipY'], ['color effect', 'fxColor'],
    ['brightness effect', 'fxBrightness'], ['ghost effect', 'fxGhost'], ['pixelate effect', 'fxPixelate'],
    ['mosaic effect', 'fxMosaic'], ['mosaic x', 'fxMosaicX'], ['mosaic y', 'fxMosaicY'], ['whirl effect', 'fxWhirl'], ['fisheye effect', 'fxFisheye'],
    ['glow size', 'glowSize'], ['outline width', 'outlineWidth'], ['tint', 'tint'], ['visible', 'visible'],
    ['z-order', 'zIndex'], ['costume', 'costume']
];
const PART_PROP_KEYS = new Set(PART_PROPS.map(p => p[1]));
const PART_READ_PROPS = PART_PROPS.concat(ALL_TRACKS.filter(k => !PART_PROP_KEYS.has(k))
    .map(k => [TD[k].label.toLowerCase(), k]));
const round3 = v => Math.round(v * 1000) / 1000;
const num = Cast.toNumber;
const TIME_MODE_NAMES = ['clamp', 'loop', 'pingpong', 'reverse', 'reverseloop'];
const normMode = m => {
    m = String(m || 'loop').toLowerCase()
        .replace(/[^a-z]/g, '');
    if (m === 'once') return 'once';
    if (m === 'pingpong') return 'pingpong';
    return 'loop';
};
const ANIM_PROPERTIES = [
    ['duration', 'duration'], ['length in frames', 'frames'], ['frames per second', 'fps'],
    ['number of parts', 'partCount'], ['part names', 'parts'],
    ['event names', 'events'], ['data names', 'data'], ['time mode', 'timeMode'], ['sprite', 'sprite'],
    ['plays forever?', 'infinite']
];
const animationProperty = (rec, key) => {
    const doc = rec.doc;
    switch (key) {
    case 'duration': return doc.duration;
    case 'frames': return Math.round(doc.duration * doc.fps);
    case 'fps': return doc.fps;
    case 'width': return doc.width;
    case 'height': return doc.height;
    case 'partCount': return doc.groups.length;
    case 'parts': return JSON.stringify(doc.groups.map(g => g.name));
    case 'events': return JSON.stringify([...new Set(doc.events.map(e => e.value))]);
    case 'data': return JSON.stringify(doc.dataTracks.map(d => d.name));
    case 'timeMode': return rec.state.playMode || 'clamp';
    case 'sprite': return rec.ownerSprite ? rec.ownerSprite.name : '';
    case 'infinite': return !!doc.infinite;
    default: return '';
    }
};
const animationsOf = sprite => (sprite && Array.isArray(sprite.dimodAnimations) ? sprite.dimodAnimations : []);
class AnimationHost {
    constructor (runtime) {
        this.runtime = runtime;
        this.store = new AnimStore();
        this.stage = new StageRuntime(this);
        this.globalAA = true;
        this.globalDetail = 'medium';
        this.overridesEnabled = true;
        this.lastEventGlobal = '';
        this.eventHat = ANIM_OPCODES.whenEvent;
        this.eventHatIn = ANIM_OPCODES.whenEventIn;
        this._records = new WeakMap();
    }
    recordOf (sprite, doc) {
        let rec = this._records.get(doc);
        if (rec && rec.ownerSprite === sprite) return rec;
        const raw = serializeAnim(doc);
        rec = new AnimRecord(this.store, raw, doc);
        rec.ownerSprite = sprite;
        rec.libraryName = doc.name || '';
        this.store.byId.set(rec.id, rec);
        this._records.set(doc, rec);
        return rec;
    }
    findDoc (sprite, name) {
        const list = animationsOf(sprite);
        return list.find(d => d.name === name) ||
            list.find(d => String(d.name).toLowerCase() === String(name).toLowerCase()) || null;
    }
    spriteNamed (name) {
        const t = this.runtime.targets.find(x => x.isOriginal && x.sprite && x.sprite.name === name);
        return t ? t.sprite : null;
    }
    setAnimations (sprite, docs, opts = {}) {
        if (!sprite) return;
        sprite.dimodAnimations = docs;
        this.runtime.emit('DIMOD_ANIMATIONS_CHANGED', sprite, opts);
    }
    resolve (arg, target) {
        if (arg === null || typeof arg === 'undefined' || arg === '') return null;
        if (typeof arg === 'object' && arg.record instanceof AnimRecord) {
            const rec = arg.record;
            if (rec.ownerSprite) {
                const doc = animationsOf(rec.ownerSprite).find(d => d.id === rec.id);
                if (doc) return this.recordOf(rec.ownerSprite, doc);
            }
            return rec;
        }
        const s = String(arg);
        if (s[0] === '{') return this.store.fromRaw(s);
        const own = target && target.sprite;
        let doc = own ? this.findDoc(own, s) : null;
        if (doc) return this.recordOf(own, doc);
        for (let i = s.indexOf('/'); i > 0; i = s.indexOf('/', i + 1)) {
            const sprite = this.spriteNamed(s.slice(0, i));
            doc = sprite ? this.findDoc(sprite, s.slice(i + 1)) : null;
            if (doc) return this.recordOf(sprite, doc);
        }
        return null;
    }
}
const installValueStrings = () => {
    const proto = AnimValue.prototype;
    if (proto.__dimodRefs) return;
    proto.__dimodRefs = true;
    const ref = rec => (rec.ownerSprite ? `${rec.ownerSprite.name}/${rec.libraryName}` : rec.raw);
    proto.toString = function () { return ref(this.record); };
    proto.toJSON = function () { return ref(this.record); };
};
const cleanList = list => (Array.isArray(list) ? list : [])
    .filter(d => d && typeof d === 'object')
    .map(d => normalizeAnim(d));
const patchStorage = () => {
    if (!sb3.__dimodAnimationsWrapped) {
        sb3.__dimodAnimationsWrapped = true;
        const originalSerialize = sb3.serialize;
        sb3.serialize = (runtime, targetId, ...rest) => {
            const json = originalSerialize(runtime, targetId, ...rest);
            if (!json || typeof json !== 'object' || !runtime) return json;
            const put = (serialized, target) => {
                const list = target && target.sprite ? animationsOf(target.sprite) : [];
                if (list.length) serialized.dimodAnimations = list;
            };
            if (targetId) { put(json, runtime.getTargetById(targetId)); } else {
                const byId = new Map(runtime.targets.map(t => [t.id, t]));
                (json.targets || []).forEach(serialized => put(serialized, byId.get(serialized.id)));
            }
            return json;
        };
        const originalDeserialize = sb3.deserialize;
        sb3.deserialize = (json, runtime, zip, isSingleSprite, ...rest) => {
            const saved = new Map();
            const objects = isSingleSprite ? [json] : ((json && json.targets) || []);
            objects.forEach(o => {
                if (o && Array.isArray(o.dimodAnimations)) saved.set(o.name, o.dimodAnimations);
            });
            return Promise.resolve(originalDeserialize(json, runtime, zip, isSingleSprite, ...rest)).then(result => {
                if (saved.size && result && result.targets) {
                    result.targets.forEach(t => {
                        if (!t.sprite) return;
                        const list = isSingleSprite ? saved.values().next().value : saved.get(t.sprite.name);
                        if (list) t.sprite.dimodAnimations = cleanList(list);
                    });
                }
                return result;
            });
        };
    }
    if (!Sprite.prototype.__dimodAnimationsDup) {
        Sprite.prototype.__dimodAnimationsDup = true;
        const originalDuplicate = Sprite.prototype.duplicate;
        Sprite.prototype.duplicate = function (...args) {
            return originalDuplicate.apply(this, args).then(newSprite => {
                const list = animationsOf(this);
                if (list.length) {
                    newSprite.dimodAnimations = list.map(d => {
                        const copy = normalizeAnim(JSON.parse(serializeAnim(d)));
                        copy.id = makeAnimId();
                        return copy;
                    });
                }
                return newSprite;
            });
        };
    }
};
const installPrimitives = (runtime, host) => {
    const p = runtime._primitives;
    const O = ANIM_OPCODES;
    const stage = host.stage;
    const store = host.store;
    const rec = (args, util) => host.resolve(args.ANIM, util && util.target);
    const player = util => util.target && stage.players.get(util.target.id);
    p[O.animation] = (args, util) => { const r = rec(args, util); return r ? r.value : ''; };
    p[O.name] = (args, util) => { const r = rec(args, util); return r ? (r.libraryName || r.doc.name || '') : ''; };
    p[O.duplicate] = (args, util) => {
        const r = rec(args, util);
        if (!r) return '';
        const doc = normalizeAnim(JSON.parse(r.raw));
        doc.id = makeAnimId();
        const copy = store.fromDoc(doc);
        copy.ownerSprite = null;
        return copy.value;
    };
    p[O.play] = (args, util) => {
        const r = rec(args, util);
        if (r && util.target) stage.play(util.target, r, normMode(args.MODE));
    };
    p[O.playUntilDone] = (args, util) => {
        const target = util.target;
        if (!target) return;
        const frame = util.stackFrame;
        if (!frame.dimodAnimStarted) {
            const r = rec(args, util);
            if (!r) return;
            frame.dimodAnimStarted = true;
            frame.dimodAnimPlayer = stage.play(target, r, 'once');
            util.yield();
            return;
        }
        const pl = frame.dimodAnimPlayer;
        if (pl && !pl.done && stage.players.get(target.id) === pl) util.yield();
    };
    p[O.crossfade] = (args, util) => {
        const r = rec(args, util);
        if (!r || !util.target) return;
        stage.play(util.target, r, normMode(args.MODE), {crossfade: Math.max(0, num(args.SECS))});
    };
    p[O.stop] = (args, util) => {
        if (util.target) stage.stop(util.target, true);
    };
    p[O.pause] = (args, util) => {
        const pl = player(util);
        if (pl) pl.playing = String(args.STATE) !== 'pause';
    };
    p[O.setSpeed] = (args, util) => {
        const pl = player(util);
        if (pl) pl.speed = num(args.SPEED);
    };
    p[O.time] = (args, util) => { const pl = player(util); return pl ? round3(pl.sec || 0) : 0; };
    p[O.playing] = (args, util) => { const pl = player(util); return !!(pl && pl.playing && !pl.done); };
    p[O.whenEvent] = (args, util) => {
        const fired = util.thread && util.thread.dimodAnimEvent;
        if (!fired || typeof args.ANIM === 'undefined' || args.ANIM === '') return true;
        const r = rec(args, util);
        return !!r && r.id === fired.id;
    };
    runtime._hats[O.whenEvent] = {restartExistingThreads: false};
    p[O.whenEventIn] = p[O.whenEvent];
    runtime._hats[O.whenEventIn] = {restartExistingThreads: false};
    p[O.eventMenu] = args => args.EVENT;
    p[O.render] = (args, util) => {
        const r = rec(args, util);
        const target = util.target;
        if (!r || !target) return;
        stage.players.delete(target.id);
        let sec = Math.max(0, num(args.SECS));
        if (!r.compiled.infinite) sec = Math.min(sec, r.doc.duration);
        stage.show(r, target, sec);
    };
    p[O.duration] = (args, util) => {
        const r = rec(args, util);
        if (!r) return 0;
        return r.doc.infinite ? -1 : r.doc.duration;
    };
    p[O.property] = (args, util) => {
        const r = rec(args, util);
        if (!r) return '';
        const v = animationProperty(r, String(args.PROP));
        return typeof v === 'number' ? round3(v) : v;
    };
    p[O.lastEvent] = (args, util) => { const r = rec(args, util); return r ? r.state.lastEvent || '' : ''; };
    p[O.setPart] = (args, util) => {
        const r = rec(args, util);
        const key = String(args.PROP);
        if (!r || !TD[key]) return;
        let v = args.VALUE;
        if (key === 'costume') {
            const n = parseFloat(v);
            v = !isNaN(n) && String(v).trim() === String(n) ? n : String(v);
        } else if (key === 'tint') { v = typeof v === 'string' && v.startsWith('#') ? parseInt(v.slice(1), 16) : num(v); } else {
            v = Number(v);
            if (!Number.isFinite(v)) return;
        }
        store.setOverride(r.id, String(args.PART), key, v);
    };
    p[O.resetPart] = (args, util) => {
        const r = rec(args, util);
        const key = String(args.PROP);
        if (r) store.clearOverride(r.id, String(args.PART), key === 'all' ? null : key);
    };
    p[O.partValue] = (args, util) => {
        const info = util.target && partInfo(stage, util.target, String(args.PART));
        if (!info) return args.PROP === 'visible' ? false : 0;
        const v = info[String(args.PROP)];
        if (typeof v === 'number') return round3(v);
        return typeof v === 'undefined' ? 0 : v;
    };
    p[O.partProperty] = (args, util) => {
        const r = rec(args, util);
        const v = r ? partProperty(stage, r, util.target, String(args.PART), String(args.PROP)) : null;
        if (v !== null) return v;
        return TD[String(args.PROP)] && TD[String(args.PROP)].bool ? false : 0;
    };
    p[O.partTouchingMouse] = (args, util) => {
        const mouse = runtime.ioDevices && runtime.ioDevices.mouse;
        if (!mouse || !util.target) return false;
        return partContains(stage, util.target, String(args.PART), mouse.getScratchX(), mouse.getScratchY());
    };
    p[O.partTouchingXY] = (args, util) => {
        if (!util.target) return false;
        return partContains(stage, util.target, String(args.PART), num(args.X), num(args.Y));
    };
    p[O.setData] = (args, util) => {
        const r = rec(args, util);
        if (!r) return;
        const n = parseFloat(args.VALUE);
        store.setData(r.id, String(args.KEY), isNaN(n) || String(args.VALUE).trim() === '' ? args.VALUE : n);
    };
    p[O.getData] = (args, util) => {
        const r = rec(args, util);
        if (!r) return '';
        const v = r.state.data[String(args.KEY)];
        return typeof v === 'undefined' ? '' : v;
    };
    p[O.setTimeMode] = (args, util) => {
        const r = rec(args, util);
        if (r) r.state.playMode = String(args.MODE || 'clamp');
    };
    p[O.mapTime] = (args, util) => {
        const r = rec(args, util);
        return r ? round3(applyPlayMode(num(args.SECS), r.doc.duration, r.state.playMode)) : 0;
    };
    p[O.progress] = (args, util) => {
        const r = rec(args, util);
        if (!r || !r.doc.duration) return 0;
        const t = applyPlayMode(num(args.SECS), r.doc.duration, r.state.playMode);
        return Math.round((t / r.doc.duration) * 1e4) / 1e4;
    };
    p[O.loopCount] = (args, util) => {
        const r = rec(args, util);
        if (!r || !r.doc.duration) return 0;
        return Math.floor(Math.max(0, num(args.SECS)) / r.doc.duration);
    };
    p[O.setSmoothing] = (args, util) => {
        const on = String(args.AA) !== 'off';
        const r = rec(args, util);
        if (r) { r.state.aa = on; } else {
            host.globalAA = on;
            for (const st of store.states.values()) st.aa = undefined;
        }
    };
    p[O.setDetail] = (args, util) => {
        const d = DETAIL[args.DETAIL] ? String(args.DETAIL) : 'medium';
        const r = rec(args, util);
        if (r) { r.state.detail = d; } else {
            host.globalDetail = d;
            for (const st of store.states.values()) st.detail = undefined;
        }
    };
    compatBlocks.statementBlocks.push(O.play, O.playUntilDone, O.crossfade, O.stop, O.pause, O.setSpeed,
        O.render, O.setPart, O.resetPart, O.setData, O.setTimeMode, O.setSmoothing, O.setDetail);
    compatBlocks.outputBlocks.push(O.animation, O.name, O.duplicate, O.time, O.playing, O.duration, O.property,
        O.lastEvent, O.partValue, O.partProperty, O.partTouchingMouse, O.partTouchingXY, O.getData, O.mapTime, O.progress,
        O.loopCount, O.eventMenu);
};
const installAnimationVM = vm => {
    if (vm.dimodAnimations) return vm.dimodAnimations;
    const runtime = vm.runtime;
    const host = new AnimationHost(runtime);
    vm.dimodAnimations = host;
    runtime.dimodAnimations = host;
    installValueStrings();
    patchStorage();
    installPrimitives(runtime, host);
    for (const opcode of [ANIM_OPCODES.time, ANIM_OPCODES.playing]) {
        runtime.monitorBlockInfo[opcode] = {isSpriteSpecific: true, getId: targetId => `${targetId}_${opcode}`};
    }
    runtime.on('AFTER_EXECUTE', () => host.stage.tick());
    let spriteCount = -1;
    vm.on('targetsUpdate', () => {
        if (runtime.targets.length === spriteCount) return;
        spriteCount = runtime.targets.length;
        bumpBindingEpoch();
    });
    runtime.on('PROJECT_LOADED', () => { bumpBindingEpoch(); host.stage.disposeAll(); host.store.clear(); });
    runtime.on('PROJECT_STOP_ALL', () => {
        for (const pl of host.stage.players.values()) pl.playing = false;
        host.stage.players.clear();
    });
    setOverridesEnabled(true);
    return host;
};
export {ANIM_OPCODES, ANIM_PROPERTIES, AnimationHost, DETAIL, PART_PROPS, PART_READ_PROPS, StageRuntime, TIME_MODE_NAMES, animToStage, animationProperty, animationsOf, applyPlayMode, installAnimationVM, nextBox, normMode, partContains, partInfo, partProperty, poseBounds, stageToAnim};
