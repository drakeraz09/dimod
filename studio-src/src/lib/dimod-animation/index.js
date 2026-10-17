import {animationsOf} from './runtime';
import {normalizeAnim, serializeAnim, makeAnimId, uniqueName} from './core';
import {colorForUserId} from '../dimod-collab';
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)));
const keyFieldOf = list => {
    if (!list.length) return null;
    for (const f of ['id', 'name']) {
        const seen = new Set();
        let ok = true;
        for (const el of list) {
            if (!isObject(el) || typeof el[f] !== 'string' || seen.has(el[f])) { ok = false; break; }
            seen.add(el[f]);
        }
        if (ok) return f;
    }
    return null;
};
const equal = (a, b) => {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
        return true;
    }
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !equal(a[k], b[k])) return false;
    return true;
};
const diffInto = (a, b, path, ops) => {
    if (equal(a, b)) return;
    if (isObject(a) && isObject(b)) {
        for (const k of Object.keys(b)) {
            if (Object.prototype.hasOwnProperty.call(a, k)) diffInto(a[k], b[k], [...path, k], ops);
            else ops.push({p: [...path, k], v: clone(b[k])});
        }
        for (const k of Object.keys(a)) {
            if (!Object.prototype.hasOwnProperty.call(b, k)) ops.push({p: [...path, k], d: 1});
        }
        return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        const fa = keyFieldOf(a);
        const fb = keyFieldOf(b);
        const f = fa && (fa === fb || !b.length) ? fa : (!a.length && fb) || null;
        if (f) {
            const before = new Map(a.map(el => [el[f], el]));
            const after = new Set(b.map(el => el[f]));
            for (const el of a) if (!after.has(el[f])) ops.push({p: [...path, {k: el[f], f}], d: 1});
            for (const el of b) {
                const old = before.get(el[f]);
                if (old) diffInto(old, el, [...path, {k: el[f], f}], ops);
                else ops.push({p: [...path, {k: el[f], f}], v: clone(el)});
            }
            const kept = a.filter(el => after.has(el[f])).map(el => el[f]);
            const order = b.map(el => el[f]);
            const inserted = order.filter(k => !before.has(k));
            if (!equal([...kept, ...inserted], order)) ops.push({p: path, order, f});
            return;
        }
        if (a.length === b.length) {
            for (let i = 0; i < a.length; i++) diffInto(a[i], b[i], [...path, i], ops);
            return;
        }
    }
    ops.push({p: path, v: clone(b)});
};
const diff = (a, b) => { const ops = []; diffInto(a, b, [], ops); return ops; };
const step = (node, s) => {
    if (node === null || typeof node !== 'object') return null;
    if (isObject(s)) return Array.isArray(node) ? (node.find(el => isObject(el) && el[s.f] === s.k) || null) : null;
    return node[s];
};
const validStep = s => typeof s === 'string' || typeof s === 'number' ||
    (isObject(s) && typeof s.k === 'string' && (s.f === 'id' || s.f === 'name'));
const applyOp = (doc, op) => {
    if (!op || !Array.isArray(op.p) || !op.p.every(validStep)) return false;
    if (op.p.some(s => s === '__proto__' || s === 'constructor' || s === 'prototype')) return false;
    if (typeof op.order !== 'undefined') {
        let list = doc;
        for (const s of op.p) list = step(list, s);
        if (!Array.isArray(list) || !Array.isArray(op.order)) return false;
        const f = op.f === 'name' ? 'name' : 'id';
        const rank = new Map(op.order.map((k, i) => [k, i]));
        const sorted = list.slice().sort((x, y) => {
            const rx = rank.has(x[f]) ? rank.get(x[f]) : Infinity;
            const ry = rank.has(y[f]) ? rank.get(y[f]) : Infinity;
            return rx - ry;
        });
        list.splice(0, list.length, ...sorted);
        return true;
    }
    if (!op.p.length) return false;
    let parent = doc;
    for (const s of op.p.slice(0, -1)) {
        parent = step(parent, s);
        if (parent === null || typeof parent !== 'object') return false;
    }
    const last = op.p[op.p.length - 1];
    if (isObject(last)) {
        if (!Array.isArray(parent)) return false;
        const i = parent.findIndex(el => isObject(el) && el[last.f] === last.k);
        if (op.d) {
            if (i >= 0) parent.splice(i, 1);
            return i >= 0;
        }
        if (i >= 0) parent[i] = clone(op.v);
        else parent.push(clone(op.v));
        return true;
    }
    if (op.d) {
        if (Array.isArray(parent)) return false;
        delete parent[last];
        return true;
    }
    if (Array.isArray(parent) && (typeof last !== 'number' || last > parent.length)) return false;
    parent[last] = clone(op.v);
    return true;
};
const apply = (doc, ops) => {
    let n = 0;
    if (!Array.isArray(ops)) return 0;
    for (const op of ops) if (applyOp(doc, op)) n++;
    return n;
};
const FLUSH_MS = 40;
const HASH_DELAY_MS = 1200;
const PRESENCE_MS = 100;
const PRESENCE_HEARTBEAT_MS = 3000;
const PRESENCE_EXPIRE_MS = 10000;
const ATTACH_INTERVAL_MS = 2000;
const stable = v => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    return `{${Object.keys(v).sort()
        .filter(k => typeof v[k] !== 'undefined')
        .map(k => `${JSON.stringify(k)}:${stable(v[k])}`)
        .join(',')}}`;
};
const hash = text => {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return `${h.toString(36)}:${text.length}`;
};
let instance = null;
const getAnimationCollab = () => instance;
class AnimationCollab {
    constructor (vm) {
        this.vm = vm;
        this.host = vm.dimodAnimations;
        this.session = Math.random().toString(36)
            .slice(2);
        this.known = new Map();
        this.knownOrder = new Map();
        this.edited = new Set();
        this.editors = new Set();
        this.pending = new Set();
        this.flushTimer = 0;
        this.hashTimers = new Map();
        this.presence = new Map();
        this.presenceSent = new Map();
        this.listeners = new Set();
        this.attached = null;
        this.off = null;
        vm.runtime.on('DIMOD_ANIMATIONS_CHANGED', (sprite, opts) => this.onLocalList(sprite, opts));
        vm.runtime.on('PROJECT_LOADED', () => { this.known.clear(); this.knownOrder.clear(); });
        this.attach();
        setInterval(() => this.attach(), ATTACH_INTERVAL_MS);
        setInterval(() => this.expirePresence(), PRESENCE_HEARTBEAT_MS);
    }
    collab () { return (typeof window !== 'undefined' && window.dimodCollab) || null; }
    send (type, data) {
        const c = this.collab();
        if (c) c.send(type, Object.assign({}, data, {author: this.session}));
    }
    attach () {
        const c = this.collab();
        if (!c || c === this.attached) return;
        if (this.off) this.off();
        this.attached = c;
        this.off = c.addMessageListener(msg => this.onMessage(msg));
        this.send('anim-state-request', {});
    }
    targetFor (msg) {
        const rt = this.vm.runtime;
        const target = rt.getTargetById(msg.targetId) ||
            (typeof msg.name === 'string' ? rt.getSpriteTargetByName(msg.name) : null);
        return target && target.isOriginal && !target.isStage ? target : null;
    }
    originalOf (sprite) { return this.vm.runtime.targets.find(t => t.isOriginal && t.sprite === sprite) || null; }
    editorFor (target, animId) {
        for (const ed of this.editors) {
            if (ed.st.target === target && ed.st.doc.id === animId) return ed;
        }
        return null;
    }
    liveDocs (target) {
        return animationsOf(target.sprite).map(d => { const ed = this.editorFor(target, d.id); return ed ? ed.st.doc : d; });
    }
    remember (targetId, docs) {
        this.knownOrder.set(targetId, docs.map(d => d.id));
        for (const d of docs) this.known.set(d.id, clone(d));
    }
    subscribe (fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    notify () {
        this.listeners.forEach(fn => {
            try { fn(); } catch (e) {
            }
        });
    }
    registerEditor (ed) {
        this.editors.add(ed);
        const target = ed.st.target;
        if (target && !this.known.has(ed.st.doc.id)) this.known.set(ed.st.doc.id, clone(ed.st.doc));
        return () => {
            this.flushEditor(ed);
            this.editors.delete(ed);
            this.pending.delete(ed);
            this.presenceSent.delete(ed);
            if (target) this.send('anim-presence', {targetId: target.id, name: target.getName(), animId: null});
        };
    }
    localEdit (ed) {
        this.pending.add(ed);
        if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
    }
    flush () {
        this.flushTimer = 0;
        for (const ed of this.pending) this.flushEditor(ed);
        this.pending.clear();
    }
    flushEditor (ed) {
        const target = ed.st.target;
        const doc = ed.st.doc;
        if (!target || !this.pending.has(ed)) return;
        this.pending.delete(ed);
        const before = this.known.get(doc.id);
        if (!before) { this.known.set(doc.id, clone(doc)); return; }
        const ops = diff(before, doc);
        if (!ops.length) return;
        this.known.set(doc.id, clone(doc));
        this.edited.add(target.id);
        this.send('anim-patch', {targetId: target.id, name: target.getName(), animId: doc.id, ops});
        this.hashSoon(target);
    }
    localPresence (ed, force = false) {
        const target = ed.st.target;
        if (!target) return;
        const st = ed.st;
        const key = `${st.doc.id}|${st.playing}|${st.rate}|${[...st.selGroups].join(',')}`;
        const now = performance.now();
        const last = this.presenceSent.get(ed);
        if (!force && last && now - last.at < PRESENCE_MS && last.key === key) return;
        if (!force && last && now - last.at < PRESENCE_MS) {
            clearTimeout(last.timer);
            last.timer = setTimeout(() => this.localPresence(ed, true), PRESENCE_MS);
            return;
        }
        if (last) clearTimeout(last.timer);
        this.presenceSent.set(ed, {at: now, key});
        this.send('anim-presence', {
            targetId: target.id,
            name: target.getName(),
            animId: st.doc.id,
            sec: st.sec,
            playing: st.playing,
            rate: st.rate,
            sel: [...st.selGroups]
        });
    }
    peopleIn (target, animId) {
        const out = [];
        if (!target) return out;
        const now = performance.now();
        for (const [userId, p] of this.presence) {
            if (p.targetId !== target.id || p.animId !== animId) continue;
            let sec = p.sec;
            if (p.playing) sec += ((now - p.at) / 1000) * (p.rate || 1);
            out.push({userId, name: p.name, color: p.color, sec, playing: p.playing, sel: p.sel || []});
        }
        return out;
    }
    peopleOnSprite (target) {
        const out = new Map();
        if (!target) return out;
        for (const [userId, p] of this.presence) {
            if (p.targetId !== target.id || !p.animId) continue;
            if (!out.has(p.animId)) out.set(p.animId, []);
            out.get(p.animId).push({userId, name: p.name, color: p.color});
        }
        return out;
    }
    expirePresence () {
        const now = performance.now();
        let changed = false;
        for (const [userId, p] of this.presence) {
            if (now - p.at > PRESENCE_EXPIRE_MS && !p.playing) { this.presence.delete(userId); changed = true; }
        }
        for (const ed of this.editors) this.localPresence(ed, true);
        if (changed) this.notify();
    }
    onLocalList (sprite, opts) {
        const target = this.originalOf(sprite);
        if (!target) return;
        const docs = animationsOf(sprite);
        if (opts && opts.remote) { this.remember(target.id, docs); return; }
        this.edited.add(target.id);
        const order = docs.map(d => d.id);
        const knownOrder = this.knownOrder.get(target.id) || [];
        if (order.join('\n') !== knownOrder.join('\n')) {
            const fresh = {};
            for (const d of docs) if (!this.known.has(d.id)) fresh[d.id] = d;
            this.send('anim-list', {targetId: target.id, name: target.getName(), order, docs: fresh, reason: 'edit'});
            this.knownOrder.set(target.id, order);
            for (const id of Object.keys(fresh)) this.known.set(id, clone(fresh[id]));
        }
        for (const d of docs) {
            if (this.editorFor(target, d.id)) continue;
            const before = this.known.get(d.id);
            if (!before) continue;
            const ops = diff(before, d);
            if (!ops.length) continue;
            this.known.set(d.id, clone(d));
            this.send('anim-patch', {targetId: target.id, name: target.getName(), animId: d.id, ops});
        }
        this.hashSoon(target);
    }
    hashSoon (target) {
        clearTimeout(this.hashTimers.get(target.id));
        this.hashTimers.set(target.id, setTimeout(() => {
            this.hashTimers.delete(target.id);
            const docsHash = hash(stable(this.liveDocs(target)));
            this.send('anim-hash', {targetId: target.id, name: target.getName(), hash: docsHash});
        }, HASH_DELAY_MS));
    }
    sendList (target, reason) {
        const docs = {};
        const live = this.liveDocs(target);
        for (const d of live) docs[d.id] = d;
        this.send('anim-list', {targetId: target.id, name: target.getName(), order: live.map(d => d.id), docs, reason});
    }
    onMessage (msg) {
        switch (msg.type) {
        case 'joined':
            this.send('anim-state-request', {});
            break;
        case 'anim-state-request':
            for (const t of this.vm.runtime.targets) {
                if (t.isOriginal && !t.isStage && animationsOf(t.sprite).length) this.sendList(t, 'join');
            }
            break;
        case 'anim-patch':
            this.onPatch(msg);
            break;
        case 'anim-list':
            this.onList(msg);
            break;
        case 'anim-hash':
            this.onHash(msg);
            break;
        case 'anim-presence':
            this.onPresence(msg);
            break;
        default:
        }
    }
    onPatch (msg) {
        const target = this.targetFor(msg);
        if (!target || typeof msg.animId !== 'string' || !Array.isArray(msg.ops)) return;
        const known = this.known.get(msg.animId);
        if (known) apply(known, msg.ops);
        const ed = this.editorFor(target, msg.animId);
        if (ed) { ed.st.applyRemote(msg.ops); } else {
            const list = animationsOf(target.sprite);
            const i = list.findIndex(d => d.id === msg.animId);
            if (i < 0) return;
            const doc = clone(list[i]);
            if (!apply(doc, msg.ops)) return;
            const next = list.slice();
            next[i] = normalizeAnim(doc);
            this.host.setAnimations(target.sprite, next, {remote: true});
        }
        this.hashSoon(target);
    }
    onList (msg) {
        const target = this.targetFor(msg);
        if (!target || !Array.isArray(msg.order)) return;
        if (msg.reason === 'join' && this.edited.has(target.id)) return;
        const whole = msg.reason === 'join' || msg.reason === 'repair';
        const incoming = msg.docs && typeof msg.docs === 'object' ? msg.docs : {};
        const mine = new Map(animationsOf(target.sprite).map(d => [d.id, d]));
        const next = [];
        for (const id of msg.order) {
            if (typeof id !== 'string') continue;
            const theirs = incoming[id] && typeof incoming[id] === 'object' ? incoming[id] : null;
            if (theirs && (whole || !mine.has(id))) {
                const doc = normalizeAnim(theirs);
                doc.id = id;
                const ed = this.editorFor(target, id);
                if (ed && whole) ed.st.replaceRemote(doc);
                next.push(doc);
                this.known.set(id, clone(doc));
            } else if (mine.has(id)) { next.push(mine.get(id)); }
        }
        this.host.setAnimations(target.sprite, next, {remote: true});
        this.hashSoon(target);
    }
    onHash (msg) {
        const target = this.targetFor(msg);
        if (!target || this.hashTimers.has(target.id) || this.pending.size) return;
        if (msg.hash === hash(stable(this.liveDocs(target)))) return;
        if (this.session > String(msg.author)) this.sendList(target, 'repair');
    }
    onPresence (msg) {
        if (!msg.from) return;
        const target = this.targetFor(msg);
        if (msg.animId && target) {
            this.presence.set(msg.from, {
                targetId: target.id,
                animId: String(msg.animId),
                sec: Number(msg.sec) || 0,
                playing: !!msg.playing,
                rate: Number(msg.rate) || 1,
                sel: Array.isArray(msg.sel) ? msg.sel.map(String) : [],
                at: performance.now(),
                name: String(msg.fromUsername || 'someone'),
                color: colorForUserId(String(msg.from))
            });
        } else { this.presence.delete(msg.from); }
        this.notify();
    }
}
const installAnimationCollab = vm => {
    if (instance || typeof window === 'undefined' || !vm.dimodAnimations) return instance;
    instance = new AnimationCollab(vm);
    return instance;
};
const draggedIds = payload => {
    if (!payload) return [];
    if (Array.isArray(payload.sa_folder_items)) {
        return payload.sa_folder_items
            .map(item => item && item.dragPayload && item.dragPayload.dimodAnimId)
            .filter(Boolean);
    }
    return payload.dimodAnimId ? [payload.dimodAnimId] : [];
};
const shareAnimationsToTarget = (vm, payload, fromSprite, targetId) => {
    const host = vm.dimodAnimations;
    const target = vm.runtime.getTargetById(targetId);
    if (!host || !fromSprite || !target || target.isStage || !target.sprite) return 0;
    const source = animationsOf(fromSprite);
    const docs = draggedIds(payload)
        .map(id => source.find(d => d.id === id))
        .filter(Boolean);
    if (!docs.length) return 0;
    const next = animationsOf(target.sprite).slice();
    const taken = new Set(next.map(d => d.name));
    for (const doc of docs) {
        const copy = normalizeAnim(JSON.parse(serializeAnim(doc)));
        copy.id = makeAnimId();
        copy.name = uniqueName(doc.name, taken);
        taken.add(copy.name);
        next.push(copy);
    }
    host.setAnimations(target.sprite, next);
    vm.runtime.emitProjectChanged();
    return docs.length;
};
export {apply, clone, diff, equal, getAnimationCollab, installAnimationCollab, shareAnimationsToTarget};
