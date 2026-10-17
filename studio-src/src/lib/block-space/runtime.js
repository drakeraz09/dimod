import Cast from 'scratch-vm/src/util/cast';
import {TD, SLOT, normalizeAnim, makeAnimId} from '../dimod-animation/core.js';
import {DETAIL, applyPlayMode, partProperty, partInfo, partContains, PART_READ_PROPS, PART_PROPS, animationsOf, TIME_MODE_NAMES, normMode} from '../dimod-animation/runtime.js';
import Variable from 'scratch-vm/src/engine/variable';
import {setSoundOverlap, getSoundOverlap, SOUND_EFFECTS, touchingAtAll} from '../dimod-block-defs.js';
import Color from 'scratch-vm/src/util/color';
import dispatch from 'scratch-vm/src/dispatch/central-dispatch';
import sb3 from 'scratch-vm/src/serialization/sb3';
import Blocks from 'scratch-vm/src/engine/blocks';
import uid from 'scratch-vm/src/util/uid';
import compatBlocks from 'scratch-vm/src/compiler/compat-blocks';
import RenderedTarget from 'scratch-vm/src/sprites/rendered-target';
import Sprite from 'scratch-vm/src/sprites/sprite';
const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case',
    'do', 'else', 'yield', 'await']);
const CONTINUES = new Set(['.', '?', ':', '+', '-', '*', '/', '%', '=', '<', '>', '&', '|', '^', ',']);
const tokenize = src => {
    const tokens = [];
    const tpl = [];
    const n = src.length;
    let i = 0;
    let depth = 0;
    let nl = false;
    const push = (type, start) => { tokens.push({type, value: src.slice(start, i), start, end: i, depth, nl}); nl = false; };
    const regexOk = () => {
        const t = tokens[tokens.length - 1];
        if (!t) return true;
        if (t.type === 'name') return REGEX_AFTER.has(t.value);
        return t.type === 'punct' && t.value !== ')' && t.value !== ']';
    };
    const template = start => {
        while (i < n) {
            const c = src[i];
            if (c === '\\') i += 2;
            else if (c === '`') { i++; break; } else if (c === '$' && src[i + 1] === '{') {
                i += 2;
                tpl.push(depth);
                push('template', start);
                depth++;
                return;
            } else i++;
        }
        push('template', start);
    };
    while (i < n) {
        const c = src[i];
        const start = i;
        if (c === '\n') { nl = true; i++; } else if (c === ' ' || c === '\t' || c === '\r' || /\s/.test(c)) { i++; } else if (c === '/' && src[i + 1] === '/') {
            while (i < n && src[i] !== '\n') i++;
        } else if (c === '/' && src[i + 1] === '*') {
            const e = src.indexOf('*/', i + 2);
            i = e < 0 ? n : e + 2;
            if (src.slice(start, i).includes('\n')) nl = true;
        } else if (c === '"' || c === '\'') {
            i++;
            while (i < n && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
            i++;
            push('string', start);
        } else if (c === '`') { i++; template(start); } else if (c === '}' && tpl.length && tpl[tpl.length - 1] === depth - 1) {
            depth = tpl.pop();
            i++;
            template(start);
        } else if (/[A-Za-z_$\u0080-￿]/.test(c)) {
            while (i < n && /[\w$\u0080-￿]/.test(src[i])) i++;
            push('name', start);
        } else if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1]))) {
            while (i < n && /[\w.]/.test(src[i])) i++;
            push('num', start);
        } else if (c === '/' && regexOk()) {
            let cls = false;
            i++;
            while (i < n && src[i] !== '\n') {
                const d = src[i];
                if (d === '\\') { i += 2; continue; }
                if (d === '[') cls = true;
                else if (d === ']') cls = false;
                else if (d === '/' && !cls) break;
                i++;
            }
            i++;
            while (i < n && /\w/.test(src[i])) i++;
            push('regex', start);
        } else if (c === '(' || c === '{' || c === '[') {
            i++;
            push('punct', start);
            depth++;
        } else if (c === ')' || c === '}' || c === ']') { depth = Math.max(0, depth - 1); i++; push('punct', start); } else { i++; push('punct', start); }
    }
    return tokens;
};
const isName = t => t && t.type === 'name';
const unquote = t => (t.type === 'string' ? JSON.parse(t.value.replace(/^'|'$/g, '"')) : t.value);
const is = (t, value) => t && t.value === value;
const keyOf = t => (t.type === 'string' ? t.value : JSON.stringify(t.value));
const closeOf = (tokens, k) => {
    const d = tokens[k].depth;
    for (let j = k + 1; j < tokens.length; j++) if (tokens[j].depth === d && /^[)}\]]$/.test(tokens[j].value)) return j;
    return tokens.length - 1;
};
const specifiers = (tokens, open) => {
    const close = closeOf(tokens, open);
    const out = [];
    for (let j = open + 1; j < close; j++) {
        const t = tokens[j];
        if (t.value === ',') continue;
        if (is(tokens[j + 1], 'as')) { out.push([t, tokens[j + 2]]); j += 2; } else out.push([t, t]);
    }
    return {list: out, close};
};
const patternNames = (tokens, open, close, into) => {
    for (let j = open + 1; j < close; j++) {
        const t = tokens[j];
        const prev = tokens[j - 1];
        const next = tokens[j + 1];
        const spread = prev && prev.value === '.' && is(tokens[j - 2], '.');
        if (isName(t) && prev && (/^(\{|\[|,|:)$/.test(prev.value) || spread) &&
            next && next.value !== ':' && next.value !== '(') into.push(t.value);
    }
};
const declaredNames = (tokens, k) => {
    const names = [];
    let j = k + 1;
    for (;;) {
        const t = tokens[j];
        if (!t) break;
        if (isName(t)) { names.push(t.value); j++; } else if (t.value === '{' || t.value === '[') {
            const close = closeOf(tokens, j);
            patternNames(tokens, j, close, names);
            j = close + 1;
        } else break;
        let more = false;
        for (; j < tokens.length; j++) {
            const u = tokens[j];
            if (u.depth > 0) continue;
            if (u.value === ',') { more = true; j++; break; }
            if (u.value === ';') break;
            const prev = tokens[j - 1];
            if (u.nl && !(prev.type === 'punct' && !/^[)}\]]$/.test(prev.value)) && !CONTINUES.has(u.value)) break;
        }
        if (!more) break;
    }
    return names;
};
const transformModule = (source, {sameLines = true} = {}) => {
    const src = String(source);
    if (!/\b(?:import|export)\b/.test(src)) return {code: src, exports: [], imports: [], isModule: false};
    const tokens = tokenize(src);
    const edits = [];
    const getters = [];
    const exportNames = [];
    const imports = [];
    let uid = 0;
    const sep = sameLines ? ' ' : '\n';
    const hoisted = [];
    const replace = (from, to, text) => {
        const lines = src.slice(from, to).split('\n').length - 1;
        edits.push({from, to, text: text + '\n'.repeat(lines)});
    };
    const hoist = (from, to, text) => { hoisted.push(text); replace(from, to, ''); };
    const endOf = j => (is(tokens[j + 1], ';') ? tokens[j + 1].end : tokens[j].end);
    const exportAs = (name, expr) => { exportNames.push(name); getters.push(`${JSON.stringify(name)}: () => ${expr}`); };
    for (let k = 0; k < tokens.length; k++) {
        const t = tokens[k];
        if (t.depth !== 0 || !isName(t) || is(tokens[k - 1], '.')) continue;
        const next = tokens[k + 1];
        if (!next) break;
        if (t.value === 'import') {
            if (next.value === '(' || next.value === '.') continue;
            if (next.type === 'string') {
                imports.push(unquote(next));
                hoist(t.start, endOf(k + 1), `await __import(${next.value});`);
                k++;
                continue;
            }
            let j = k + 1;
            let def = null;
            let ns = null;
            let named = null;
            if (isName(tokens[j]) && tokens[j].value !== 'from') {
                def = tokens[j].value;
                j++;
                if (is(tokens[j], ',')) j++;
            }
            if (is(tokens[j], '*') && is(tokens[j + 1], 'as')) {
                ns = tokens[j + 2].value;
                j += 3;
            } else if (is(tokens[j], '{')) { const spec = specifiers(tokens, j); named = spec.list; j = spec.close + 1; }
            if (!is(tokens[j], 'from') || !tokens[j + 1] || tokens[j + 1].type !== 'string') continue;
            const from = tokens[j + 1];
            imports.push(unquote(from));
            const m = `__m${uid++}`;
            const parts = [`const ${m} = await __import(${from.value});`];
            if (def) parts.push(`const ${def} = ${m}.default;`);
            if (ns) parts.push(`const ${ns} = ${m};`);
            if (named && named.length) {
                parts.push(`const {${named.map(([a, b]) => `${keyOf(a)}: ${b.value}`).join(', ')}} = ${m};`);
            }
            hoist(t.start, endOf(j + 1), parts.join(sep));
            k = j + 1;
        } else if (t.value === 'export') {
            if (next.value === 'default') {
                const a = tokens[k + 2];
                const b = tokens[k + 3];
                let decl = null;
                if (is(a, 'class') && isName(b) && b.value !== 'extends') decl = b;
                if (is(a, 'function')) decl = is(b, '*') ? tokens[k + 4] : b;
                if (is(a, 'async') && is(b, 'function')) decl = is(tokens[k + 4], '*') ? tokens[k + 5] : tokens[k + 4];
                if (decl && isName(decl)) { replace(t.start, a.start, ''); exportAs('default', decl.value); } else { replace(t.start, next.end, 'const __default ='); exportAs('default', '__default'); }
                k++;
            } else if (/^(const|let|var)$/.test(next.value)) {
                replace(t.start, next.start, '');
                declaredNames(tokens, k + 1).forEach(name => exportAs(name, name));
            } else if (next.value === 'function' || next.value === 'class' || next.value === 'async') {
                let j = k + 1;
                if (tokens[j].value === 'async') j++;
                j++;
                if (is(tokens[j], '*')) j++;
                replace(t.start, next.start, '');
                if (isName(tokens[j])) exportAs(tokens[j].value, tokens[j].value);
            } else if (next.value === '{') {
                const spec = specifiers(tokens, k + 1);
                const after = tokens[spec.close + 1];
                if (is(after, 'from') && tokens[spec.close + 2] && tokens[spec.close + 2].type === 'string') {
                    const from = tokens[spec.close + 2];
                    imports.push(unquote(from));
                    const m = `__m${uid++}`;
                    hoist(t.start, endOf(spec.close + 2), `const ${m} = await __import(${from.value});`);
                    spec.list.forEach(([a, b]) => exportAs(unquote(b), `${m}[${keyOf(a)}]`));
                    k = spec.close + 2;
                } else {
                    replace(t.start, endOf(spec.close), '');
                    spec.list.forEach(([a, b]) => exportAs(unquote(b), a.value));
                    k = spec.close;
                }
            } else if (next.value === '*') {
                let j = k + 2;
                let ns = null;
                if (is(tokens[j], 'as')) { ns = tokens[j + 1].value; j += 2; }
                if (!is(tokens[j], 'from') || !tokens[j + 1] || tokens[j + 1].type !== 'string') continue;
                const from = tokens[j + 1];
                imports.push(unquote(from));
                if (ns) {
                    const m = `__m${uid++}`;
                    hoist(t.start, endOf(j + 1), `const ${m} = await __import(${from.value});`);
                    exportAs(ns, m);
                } else { hoist(t.start, endOf(j + 1), `__reexport(await __import(${from.value}));`); }
                k = j + 1;
            }
        }
    }
    if (!edits.length) return {code: src, exports: [], imports: [], isModule: false};
    let code = '';
    let at = 0;
    for (const e of edits) { code += src.slice(at, e.from) + e.text; at = e.to; }
    code += src.slice(at);
    const head = [...(getters.length ? [`__export({${getters.join(', ')}});`] : []), ...hoisted];
    if (head.length) code = `${head.join(sep)}${sep}${code}`;
    return {code, exports: exportNames, imports, isModule: true};
};
const commonExports = source => {
    const out = new Set();
    const src = String(source);
    for (const m of src.matchAll(/\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) out.add(m[1]);
    const whole = /\bmodule\.exports\s*=\s*\{([^{}]*)\}/.exec(src);
    if (whole) {
        for (const part of whole[1].split(',')) {
            const m = /^\s*([A-Za-z_$][\w$]*)/.exec(part);
            if (m) out.add(m[1]);
        }
    }
    return [...out];
};
export {commonExports, tokenize, transformModule};
const fromCast = value => {
    if (value && typeof value.then === 'function') return value.then(fromCast);
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed);
    return value;
};
const CAST = Symbol.for('dimod.toCast');
const toCast = value => {
    if (value && typeof value.then === 'function') return value.then(toCast);
    if (value === null || typeof value === 'undefined') return '';
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value[CAST] === 'function') return value[CAST]();
    if (value.isKS5Anim) return value;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
};
const copyValue = value => {
    if (value === null || typeof value !== 'object') return value;
    try { return structuredClone(value); } catch (e) { return value; }
};
const RESET_MODES = ['flag', 'stop', 'never', 'save'];
class HoldStore {
    constructor () {
        this.values = {};
        this.defaults = {};
        this.reset = {};
        this.saved = {};
    }
    hold (defaults, {reset = 'flag'} = {}) {
        if (!defaults || typeof defaults !== 'object') {
            throw new TypeError('hold() takes an object of defaults, e.g. me.hold({score: 0})');
        }
        if (!RESET_MODES.includes(reset)) { throw new TypeError(`hold(): reset must be one of ${RESET_MODES.join(', ')}`); }
        for (const key of Object.keys(defaults)) {
            this.defaults[key] = copyValue(defaults[key]);
            this.reset[key] = reset;
            if (!(key in this.values)) {
                const fromFile = reset === 'save' && Object.prototype.hasOwnProperty.call(this.saved, key);
                this.values[key] = copyValue(fromFile ? this.saved[key] : defaults[key]);
            }
        }
        return this.values;
    }
    resetFor (event) {
        for (const key of Object.keys(this.reset)) {
            if (this.reset[key] === event) this.values[key] = copyValue(this.defaults[key]);
        }
    }
    savedValues () {
        const out = {};
        let any = false;
        for (const key of Object.keys(this.reset)) {
            if (this.reset[key] !== 'save' || !(key in this.values)) continue;
            try {
                const json = JSON.stringify(this.values[key]);
                if (typeof json === 'undefined') continue;
                out[key] = JSON.parse(json);
                any = true;
            } catch (e) {
            }
        }
        return any ? out : null;
    }
    copy () {
        const store = new HoldStore();
        for (const key of Object.keys(this.values)) store.values[key] = copyValue(this.values[key]);
        Object.assign(store.defaults, this.defaults);
        Object.assign(store.reset, this.reset);
        Object.assign(store.saved, this.saved);
        return store;
    }
}
const accessorOf = (obj, name) => {
    for (let o = obj; o; o = Object.getPrototypeOf(o)) {
        const descriptor = Object.getOwnPropertyDescriptor(o, name);
        if (descriptor) return descriptor;
    }
    return null;
};
const withValues = (api, {values, set, label}) => new Proxy(api, {
    get (obj, name) {
        if (typeof name !== 'string' || name in obj) return Reflect.get(obj, name, obj);
        return values()[name];
    },
    set (obj, name, value) {
        if (typeof name !== 'string') return false;
        if (name in obj) {
            const descriptor = accessorOf(obj, name);
            if (descriptor && descriptor.set) return Reflect.set(obj, name, value, obj);
            throw new TypeError(`${label(obj)}.${name} is built in, pick another name for your value`);
        }
        set(name, value);
        return true;
    },
    has: (obj, name) => name in obj || (typeof name === 'string' && name in values()),
    deleteProperty (obj, name) {
        if (typeof name === 'string' && !(name in obj)) delete values()[name];
        return true;
    },
    ownKeys: obj => [...new Set([...Reflect.ownKeys(obj), ...Object.keys(values())])],
    getOwnPropertyDescriptor (obj, name) {
        const own = Reflect.getOwnPropertyDescriptor(obj, name);
        if (own) return own.configurable ? {...own, enumerable: false} : own;
        if (typeof name === 'string' && !(name in obj) && name in values()) {
            return {enumerable: true, configurable: true, writable: true, value: values()[name]};
        }
    }
});
const hostOf = runtime => {
    const host = runtime.dimodAnimations;
    if (!host) throw new Error('Animations aren\'t available in this player');
    return host;
};
const round3 = v => Math.round(v * 1000) / 1000;
const PROP_ALIASES = new Map(PART_READ_PROPS.map(([label, key]) => [label, key]));
const propKey = name => {
    const key = PROP_ALIASES.get(String(name)) || String(name);
    if (!TD[key]) { throw new TypeError(`"${name}" isn't a part property; parts have ${PART_PROPS.map(p => p[1]).join(', ')}`); }
    return key;
};
const slotOf = key => (key in SLOT ? SLOT[key] : key);
const overrideValue = (key, value) => {
    if (key === 'costume') return typeof value === 'number' ? value : String(value);
    if (key === 'tint') {
        return typeof value === 'string' && value.startsWith('#') ? parseInt(value.slice(1), 16) : Cast.toNumber(value);
    }
    if (typeof value === 'boolean') return value ? 1 : 0;
    const n = Number(value);
    if (!Number.isFinite(n)) throw new TypeError(`${key} needs a number, got ${JSON.stringify(value)}`);
    return n;
};
const DETAILS = Object.keys(DETAIL);
class AnimationPartApi {
    constructor (anim, name) {
        Object.defineProperty(this, 'animation', {value: anim, enumerable: true});
        Object.defineProperty(this, 'name', {value: name, enumerable: true});
    }
    set (prop, value) {
        const anim = this.animation;
        anim._owner.assertAlive();
        const rec = anim._rec;
        const entries = prop && typeof prop === 'object' ? Object.entries(prop) : [[prop, value]];
        for (const [k, v] of entries) {
            const key = propKey(k);
            rec.store.setOverride(rec.id, this.name, key, overrideValue(key, v));
        }
        return this;
    }
    reset (prop) {
        const anim = this.animation;
        anim._owner.assertAlive();
        const rec = anim._rec;
        rec.store.clearOverride(rec.id, this.name, typeof prop === 'undefined' ? null : propKey(prop));
        return this;
    }
    value (prop, seconds) {
        const anim = this.animation;
        anim._owner.assertAlive();
        const time = typeof seconds === 'undefined' ? void 0 : Cast.toNumber(seconds);
        return partProperty(anim._host.stage, anim._rec, anim._owner.target, this.name, propKey(prop), time);
    }
    get (prop) {
        const map = this.animation._state.overrides.get(this.name);
        if (!map) return;
        const v = map.get(slotOf(propKey(prop)));
        return typeof v === 'undefined' ? void 0 : v;
    }
    get overrides () {
        const map = this.animation._state.overrides.get(this.name);
        const out = {};
        if (!map) return out;
        for (const [, key] of PART_PROPS) {
            const slot = slotOf(key);
            if (map.has(slot)) out[key] = map.get(slot);
        }
        return out;
    }
}
class AnimationApi {
    constructor (owner, host, {sprite = null, id = '', name = '', record = null}) {
        Object.defineProperty(this, '_owner', {value: owner});
        Object.defineProperty(this, '_host', {value: host});
        Object.defineProperty(this, '_sprite', {value: sprite});
        Object.defineProperty(this, '_id', {value: record ? record.id : id});
        Object.defineProperty(this, '_record', {value: record});
        Object.defineProperty(this, '_name', {value: name, writable: true});
    }
    get _rec () {
        if (this._record) return this._record;
        const doc = animationsOf(this._sprite).find(d => d.id === this._id);
        if (!doc) throw new ReferenceError(`The animation "${this._name}" was deleted from ${this._sprite.name}`);
        this._name = doc.name;
        return this._host.recordOf(this._sprite, doc);
    }
    get _state () { return this._rec.state; }
    get name () {
        if (this._record) return this._record.libraryName || this._record.doc.name || '';
        return this.exists ? this._rec.libraryName : this._name;
    }
    get id () { return this._id; }
    get ref () {
        if (this._record) return this._record.raw;
        return `${this._sprite.name}/${this.name}`;
    }
    get exists () { return Boolean(this._record || animationsOf(this._sprite).some(d => d.id === this._id)); }
    get sprite () {
        if (!this._sprite) return null;
        const target = this._host.runtime.targets.find(t => t.isOriginal && t.sprite === this._sprite);
        return target ? this._owner.wrap(target) : null;
    }
    get isCopy () { return Boolean(this._record); }
    is (other) { return other instanceof AnimationApi && other._id === this._id; }
    get duration () { const doc = this._rec.doc; return doc.infinite ? Infinity : doc.duration; }
    get infinite () { return Boolean(this._rec.doc.infinite); }
    get fps () { return this._rec.doc.fps; }
    get frames () { const doc = this._rec.doc; return Math.round(doc.duration * doc.fps); }
    get parts () { return this._rec.doc.groups.map(g => g.name); }
    get events () { return this._rec.doc.events.map(e => ({name: e.value, time: e.sec})); }
    get dataNames () { return this._rec.doc.dataTracks.map(d => d.name); }
    get lastEvent () { return this._state.lastEvent || ''; }
    get data () {
        const anim = this;
        return new Proxy({}, {
            get: (obj, key) => {
                if (typeof key !== 'string') return;
                const v = anim._state.data[key];
                return typeof v === 'undefined' ? void 0 : v;
            },
            set: (obj, key, value) => {
                anim._owner.assertAlive();
                const rec = anim._rec;
                const v = typeof value === 'number' || typeof value === 'string' ? value : Cast.toNumber(value);
                rec.store.setData(rec.id, String(key), v);
                return true;
            },
            has: (obj, key) => typeof key === 'string' && key in anim._state.data,
            ownKeys: () => Object.keys(anim._state.data),
            getOwnPropertyDescriptor: (obj, key) => {
                if (typeof key !== 'string' || !(key in anim._state.data)) return;
                return {enumerable: true, configurable: true, writable: true, value: anim._state.data[key]};
            },
            deleteProperty: (obj, key) => {
                const st = anim._state;
                delete st.data[key];
                st.dataVersion++;
                return true;
            }
        });
    }
    set data (values) {
        if (!values || typeof values !== 'object') throw new TypeError('anim.data can only be set to an object');
        const data = this.data;
        for (const key of Object.keys(values)) data[key] = values[key];
    }
    part (name) {
        const doc = this._rec.doc;
        if (!doc.groups.some(g => g.name === String(name))) {
            throw new ReferenceError(`"${this.name}" has no part "${name}"; it has ${this.parts.join(', ') || 'none'}`);
        }
        return new AnimationPartApi(this, String(name));
    }
    resetParts () {
        this._owner.assertAlive();
        const rec = this._rec;
        for (const name of [...rec.state.overrides.keys()]) rec.store.clearOverride(rec.id, name, null);
        return this;
    }
    get timeMode () { return this._state.playMode || 'clamp'; }
    set timeMode (mode) {
        this._owner.assertAlive();
        const m = String(mode).toLowerCase()
            .replace(/[^a-z]/g, '');
        if (!TIME_MODE_NAMES.includes(m)) { throw new TypeError(`timeMode is one of ${TIME_MODE_NAMES.join(', ')}`); }
        this._state.playMode = m;
    }
    mapTime (seconds) {
        const rec = this._rec;
        return round3(applyPlayMode(Cast.toNumber(seconds), rec.doc.duration, rec.state.playMode));
    }
    progress (seconds) {
        const rec = this._rec;
        if (!rec.doc.duration) return 0;
        return applyPlayMode(Cast.toNumber(seconds), rec.doc.duration, rec.state.playMode) / rec.doc.duration;
    }
    loopCount (seconds) {
        const rec = this._rec;
        if (!rec.doc.duration) return 0;
        return Math.floor(Math.max(0, Cast.toNumber(seconds)) / rec.doc.duration);
    }
    get smoothing () { const aa = this._state.aa; return typeof aa === 'boolean' ? aa : this._host.globalAA !== false; }
    set smoothing (on) { this._owner.assertAlive(); this._state.aa = Boolean(on); }
    get detail () { return this._state.detail || this._host.globalDetail; }
    set detail (level) {
        this._owner.assertAlive();
        if (!DETAILS.includes(level)) throw new TypeError(`detail is one of ${DETAILS.join(', ')}`);
        this._state.detail = level;
    }
    copy () {
        const doc = normalizeAnim(JSON.parse(this._rec.raw));
        doc.id = makeAnimId();
        const record = this._host.store.fromDoc(doc);
        record.ownerSprite = null;
        return new AnimationApi(this._owner, this._host, {record});
    }
    on (event, fn) {
        if (typeof event === 'function' && typeof fn === 'undefined') { fn = event; event = null; }
        if (typeof fn !== 'function') throw new TypeError('anim.on() needs a function');
        return this._owner.onWorld('animation', event, (name, target, anim, time) => {
            if (anim._id === this._id) return fn(name, target, time);
        });
    }
    toString () { return this.ref; }
    toJSON () { return this.ref; }
    [CAST] () { return this._rec.value; }
}
const animationFor = (owner, record) => {
    const host = hostOf(owner.runtimeHost.runtime);
    if (record.ownerSprite) {
        return new AnimationApi(owner, host, {sprite: record.ownerSprite, id: record.id, name: record.libraryName});
    }
    return new AnimationApi(owner, host, {record});
};
const animationOf = (owner, target, thing) => {
    if (thing instanceof AnimationApi) return thing;
    const host = hostOf(owner.runtimeHost.runtime);
    let record = null;
    if (thing && typeof thing === 'object' && !(thing.record)) { record = host.store.fromDoc(normalizeAnim(thing)); } else { record = host.resolve(thing, target); }
    if (!record) {
        const where = target && !target.isStage ? `${target.getName()} has no animation` : 'No animation';
        throw new ReferenceError(`${where} "${thing}" (another sprite's is "Sprite/name")`);
    }
    return animationFor(owner, record);
};
const animationsIn = (owner, sprite) => {
    const host = hostOf(owner.runtimeHost.runtime);
    return animationsOf(sprite).map(doc => new AnimationApi(owner, host, {sprite, id: doc.id, name: doc.name}));
};
class LivePartApi {
    constructor (animator, name) {
        Object.defineProperty(this, '_animator', {value: animator});
        Object.defineProperty(this, 'name', {value: name, enumerable: true});
    }
    get _info () { const a = this._animator; return partInfo(a._host.stage, a._target, this.name); }
    get shown () { return Boolean(this._info); }
    get x () { const info = this._info; return info ? round3(info.x) : 0; }
    get y () { const info = this._info; return info ? round3(info.y) : 0; }
    get rotation () { const info = this._info; return info ? round3(info.rotation) : 0; }
    get scaleX () { const info = this._info; return info ? round3(info.scaleX) : 0; }
    get scaleY () { const info = this._info; return info ? round3(info.scaleY) : 0; }
    get visible () { const info = this._info; return Boolean(info && info.visible); }
    touching (x, y) {
        const a = this._animator;
        let px = x;
        let py = y;
        if (x === 'mouse') {
            const mouse = a._host.runtime.ioDevices.mouse;
            px = mouse.getScratchX();
            py = mouse.getScratchY();
        } else if (x && typeof x === 'object') { px = x.x; py = x.y; }
        return partContains(a._host.stage, a._target, this.name, Cast.toNumber(px), Cast.toNumber(py));
    }
    set (prop, value) {
        this._animator._currentOrThrow().part(this.name)
            .set(prop, value);
        return this;
    }
    reset (prop) {
        this._animator._currentOrThrow().part(this.name)
            .reset(prop);
        return this;
    }
}
const PLAY_OPTIONS = ['mode', 'loop', 'speed', 'from', 'crossfade'];
const playOptions = options => {
    if (typeof options === 'string') return {mode: options};
    if (typeof options === 'boolean') return {loop: options};
    if (options === null || typeof options === 'undefined') return {};
    if (typeof options !== 'object') {
        throw new TypeError('play(anim, options): options is a mode, true/false, ' +
            'or {mode, loop, speed, from, crossfade}');
    }
    return Object.assign({}, options);
};
const modeOf = opts => {
    if (typeof opts.mode !== 'undefined') return normMode(opts.mode);
    if (typeof opts.loop !== 'undefined') return opts.loop ? 'loop' : 'once';
    return normMode(undefined);
};
class AnimatorApi {
    constructor (owner, target) {
        Object.defineProperty(this, '_owner', {value: owner});
        Object.defineProperty(this, '_target', {value: target});
        Object.defineProperty(this, '_host', {value: hostOf(target.runtime)});
    }
    _alive () {
        this._owner.assertAlive();
        if (this._target.isDisposed) throw new Error('This sprite was deleted');
    }
    get _player () { return this._host.stage.players.get(this._target.id) || null; }
    _resolve (anim) { return animationOf(this._owner, this._target, anim)._rec; }
    get _shownRecord () {
        const player = this._player;
        if (player) return player.record;
        const renderer = this._host.runtime.renderer;
        const drawable = renderer && renderer._allDrawables[this._target.drawableID];
        const entry = this._host.stage.entries.get(this._target.drawableID);
        return entry && drawable && drawable.skin && drawable.skin.isKS5 ? entry.record : null;
    }
    _currentOrThrow () {
        const anim = this.current;
        if (!anim) throw new Error(`${this._target.getName()} isn't showing an animation`);
        return anim;
    }
    play (anim, options) {
        this._alive();
        const opts = playOptions(options);
        for (const key of Object.keys(opts)) {
            if (!PLAY_OPTIONS.includes(key)) {
                throw new TypeError(`play(): unknown option "${key}", it takes ${PLAY_OPTIONS.join(', ')}`);
            }
        }
        const rec = this._resolve(anim);
        const player = this._host.stage.play(this._target, rec, modeOf(opts), {
            crossfade: Math.max(0, Cast.toNumber(opts.crossfade)),
            from: Math.max(0, Cast.toNumber(opts.from))
        });
        if (typeof opts.speed !== 'undefined') player.speed = Cast.toNumber(opts.speed);
        return this;
    }
    playUntilDone (anim, options) {
        const opts = playOptions(options);
        delete opts.loop;
        this.play(anim, Object.assign(opts, {mode: 'once'}));
        return this._waitFor(this._player);
    }
    crossfade (anim, seconds, options) { return this.play(anim, Object.assign(playOptions(options), {crossfade: seconds})); }
    finished () { return this._waitFor(this._player); }
    _waitFor (player) {
        if (!player || player.done) return Promise.resolve();
        const stage = this._host.stage;
        const id = this._target.id;
        return this._owner.runtimeHost.clock.waitUntil(this._owner, () =>
            player.done || stage.players.get(id) !== player || this._target.isDisposed);
    }
    show (anim, seconds) {
        this._alive();
        const rec = this._resolve(anim);
        const stage = this._host.stage;
        stage.players.delete(this._target.id);
        let sec = Math.max(0, Cast.toNumber(seconds));
        if (!rec.compiled.infinite) sec = Math.min(sec, rec.doc.duration);
        stage.show(rec, this._target, sec);
        return this;
    }
    stop () { this._alive(); this._host.stage.stop(this._target, true); return this; }
    pause () {
        this._alive();
        const player = this._player;
        if (player) player.playing = false;
        return this;
    }
    resume () {
        this._alive();
        const player = this._player;
        if (player && !player.done) player.playing = true;
        return this;
    }
    get playing () { const player = this._player; return Boolean(player && player.playing && !player.done); }
    get paused () { const player = this._player; return Boolean(player && !player.playing && !player.done); }
    get done () { const player = this._player; return Boolean(player && player.done); }
    get mode () { const player = this._player; return player ? player.mode : null; }
    get speed () { const player = this._player; return player ? player.speed : 1; }
    set speed (value) {
        this._alive();
        const player = this._player;
        if (player) player.speed = Cast.toNumber(value);
    }
    get time () { const player = this._player; return player ? round3(player.sec || 0) : 0; }
    set time (seconds) {
        this._alive();
        const player = this._player;
        if (!player) return;
        player.t = Math.max(0, Cast.toNumber(seconds));
        player.done = false;
        this._host.stage.tickPlayer(player, 0);
    }
    get current () { const rec = this._shownRecord; return rec ? animationFor(this._owner, rec) : null; }
    get lastEvent () { const rec = this._shownRecord; return rec ? rec.state.lastEvent || '' : ''; }
    get parts () { const rec = this._shownRecord; return rec ? rec.doc.groups.map(g => g.name) : []; }
    part (name) { return new LivePartApi(this, String(name)); }
}
class Stopped extends Error {
    constructor (reason = 'stopped') { super(`Blockspace task stopped (${reason})`); this.name = 'Stopped'; }
}
const MAX_DT = 0.1;
class Clock {
    constructor (runtime) {
        this.runtime = runtime;
        this.now = 0;
        this.dt = 0;
        this._last = null;
        this._waits = new Set();
        this._loops = new Set();
        this._timers = new Set();
        this._frameHooks = new Set();
        this.frame = 0;
        runtime.on('RUNTIME_STEP_START', () => this._stepStart());
        runtime.on('BEFORE_EXECUTE', () => this._beforeExecute());
    }
    _stepStart () {
        const t = performance.now() / 1000;
        const elapsed = this._last === null ? 0 : t - this._last;
        this._last = t;
        if (this.runtime.paused) { this.dt = 0; return; }
        this.now += elapsed;
        this.dt = Math.min(elapsed, MAX_DT);
        this.frame += 1;
        for (const w of this._waits) {
            let done = false;
            if (w.frame) { done = true; } else if (w.poll) {
                try { done = Boolean(w.poll()); } catch (e) { this._waits.delete(w); w.reject(e); continue; }
            } else { done = this.now >= w.until; }
            if (!done && w.timeout !== null && w.timeout !== void 0 && this.now >= w.timeout) {
                this._waits.delete(w);
                w.reject(w.timeoutError());
                continue;
            }
            if (done) { this._waits.delete(w); w.resolve(w.frame ? this.dt : null); }
        }
        for (const timer of this._timers) {
            if (this.now < timer.at) continue;
            if (timer.interval) { timer.at = this.now + timer.interval; } else { this._timers.delete(timer); }
            if (!timer.owner.invokeAs(timer.interval ? 'every' : 'after', timer.fn)) this._timers.delete(timer);
        }
    }
    _beforeExecute () {
        if (this.runtime.paused) return;
        const redraw = this.runtime.redrawRequested;
        try {
            for (const hook of this._frameHooks) hook(this.dt);
            for (const loop of this._loops) {
                if (loop.paused) continue;
                if (!loop.owner.invokeAs(loop.kind, loop.fn, this.dt)) { this._loops.delete(loop); }
            }
        } finally { this.runtime.redrawRequested = redraw; }
    }
    _addWait (owner, spec, made) {
        if (!owner.alive) return Promise.reject(new Stopped('disposed'));
        return new Promise((resolve, reject) => {
            const entry = {...spec, owner, resolve, reject};
            this._waits.add(entry);
            if (made) made(entry);
        });
    }
    wait (owner, seconds) {
        const s = Number(seconds);
        return this._addWait(owner, {until: this.now + (Number.isFinite(s) ? Math.max(0, s) : 0)});
    }
    waitUntil (owner, predicate) {
        if (typeof predicate !== 'function') {
            return Promise.reject(new TypeError('waitUntil() needs a function, e.g. waitUntil(() => me.x > 0)'));
        }
        return this._addWait(owner, {poll: predicate});
    }
    nextFrame (owner) { return this._addWait(owner, {frame: true}); }
    external (owner, {timeout = null, timeoutError = () => new Error('timed out')} = {}) {
        let entry = null;
        const promise = this._addWait(owner, {
            manual: true,
            timeout: timeout === null ? null : this.now + Math.max(0, Number(timeout) || 0),
            timeoutError
        }, e => { entry = e; });
        return {
            promise,
            resolve: value => {
                if (!entry || !this._waits.delete(entry)) return false;
                entry.resolve(value);
                return true;
            },
            cancel: () => {
                if (entry && this._waits.delete(entry)) entry.reject(new Stopped('cancelled'));
            }
        };
    }
    addFrameHook (fn) { this._frameHooks.add(fn); return () => this._frameHooks.delete(fn); }
    loop (owner, fn, {killOnStop = true, onEnd = null, kind = 'loop', meta = null} = {}) {
        const loop = {fn, owner, paused: false, killOnStop, onEnd, kind, meta};
        const loops = this._loops;
        loops.add(loop);
        const handle = {
            stop: () => loops.delete(loop),
            pause: () => { loop.paused = true; },
            resume: () => { loop.paused = false; },
            get running () { return loops.has(loop) && !loop.paused; }
        };
        loop.handle = handle;
        return handle;
    }
    timer (owner, seconds, fn, repeat) {
        const s = Math.max(0, Number(seconds) || 0);
        const timer = {at: this.now + s, interval: repeat ? Math.max(s, 1 / 1000) : 0, fn, owner};
        this._timers.add(timer);
        return {stop: () => this._timers.delete(timer)};
    }
    inspect (owner) {
        const loops = [...this._loops].filter(loop => loop.owner === owner)
            .map(loop => ({
                kind: loop.kind,
                meta: loop.meta,
                paused: loop.paused,
                stop: () => (loop.meta && typeof loop.meta.stop === 'function' ?
                    loop.meta.stop() :
                    this._loops.delete(loop))
            }));
        const timers = [...this._timers].filter(timer => timer.owner === owner)
            .map(timer => ({
                every: timer.interval || null,
                in: Math.max(0, timer.at - this.now),
                stop: () => this._timers.delete(timer)
            }));
        const waits = [...this._waits].filter(w => w.owner === owner).length;
        return {loops, timers, waits};
    }
    stopAll () {
        for (const w of this._waits) w.reject(new Stopped('stop sign'));
        this._waits.clear();
        for (const loop of this._loops) if (loop.killOnStop) this._endLoop(loop, 'stop sign');
        this._timers.clear();
    }
    _endLoop (loop, reason) {
        this._loops.delete(loop);
        if (loop.onEnd) loop.onEnd(reason);
    }
    disposeOwner (owner) {
        for (const w of this._waits) {
            if (w.owner !== owner) continue;
            this._waits.delete(w);
            w.reject(new Stopped('disposed'));
        }
        for (const loop of this._loops) if (loop.owner === owner) this._endLoop(loop, 'disposed');
        for (const timer of this._timers) if (timer.owner === owner) this._timers.delete(timer);
    }
}
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;
const c5 = (2 * Math.PI) / 4.5;
const bounceOut = x => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return (n1 * (x -= 1.5 / d1) * x) + 0.75;
    if (x < 2.5 / d1) return (n1 * (x -= 2.25 / d1) * x) + 0.9375;
    return (n1 * (x -= 2.625 / d1) * x) + 0.984375;
};
const power = n => [
    x => Math.pow(x, n),
    x => 1 - Math.pow(1 - x, n),
    x => (x < 0.5 ? Math.pow(2, n - 1) * Math.pow(x, n) : 1 - (Math.pow((-2 * x) + 2, n) / 2))
];
const [easeInQuad, easeOutQuad, easeInOutQuad] = power(2);
const [easeInCubic, easeOutCubic, easeInOutCubic] = power(3);
const [easeInQuart, easeOutQuart, easeInOutQuart] = power(4);
const [easeInQuint, easeOutQuint, easeInOutQuint] = power(5);
const EASINGS$1 = {
    linear: x => x,
    easeInSine: x => 1 - Math.cos((x * Math.PI) / 2),
    easeOutSine: x => Math.sin((x * Math.PI) / 2),
    easeInOutSine: x => -(Math.cos(Math.PI * x) - 1) / 2,
    easeInQuad,
    easeOutQuad,
    easeInOutQuad,
    easeInCubic,
    easeOutCubic,
    easeInOutCubic,
    easeInQuart,
    easeOutQuart,
    easeInOutQuart,
    easeInQuint,
    easeOutQuint,
    easeInOutQuint,
    easeInExpo: x => (x === 0 ? 0 : Math.pow(2, (10 * x) - 10)),
    easeOutExpo: x => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    easeInOutExpo: x => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ?
        Math.pow(2, (20 * x) - 10) / 2 :
        (2 - Math.pow(2, (-20 * x) + 10)) / 2),
    easeInCirc: x => 1 - Math.sqrt(1 - Math.pow(x, 2)),
    easeOutCirc: x => Math.sqrt(1 - Math.pow(x - 1, 2)),
    easeInOutCirc: x => (x < 0.5 ?
        (1 - Math.sqrt(1 - Math.pow(2 * x, 2))) / 2 :
        (Math.sqrt(1 - Math.pow((-2 * x) + 2, 2)) + 1) / 2),
    easeInBack: x => (c3 * x * x * x) - (c1 * x * x),
    easeOutBack: x => 1 + (c3 * Math.pow(x - 1, 3)) + (c1 * Math.pow(x - 1, 2)),
    easeInOutBack: x => (x < 0.5 ?
        (Math.pow(2 * x, 2) * (((c2 + 1) * 2 * x) - c2)) / 2 :
        ((Math.pow((2 * x) - 2, 2) * (((c2 + 1) * ((x * 2) - 2)) + c2)) + 2) / 2),
    easeInElastic: x => (x === 0 ? 0 : x === 1 ? 1 :
        -Math.pow(2, (10 * x) - 10) * Math.sin(((x * 10) - 10.75) * c4)),
    easeOutElastic: x => (x === 0 ? 0 : x === 1 ? 1 :
        (Math.pow(2, -10 * x) * Math.sin(((x * 10) - 0.75) * c4)) + 1),
    easeInOutElastic: x => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ?
        -(Math.pow(2, (20 * x) - 10) * Math.sin(((20 * x) - 11.125) * c5)) / 2 :
        ((Math.pow(2, (-20 * x) + 10) * Math.sin(((20 * x) - 11.125) * c5)) / 2) + 1),
    easeInBounce: x => 1 - bounceOut(1 - x),
    easeOutBounce: bounceOut,
    easeInOutBounce: x => (x < 0.5 ?
        (1 - bounceOut(1 - (2 * x))) / 2 :
        (1 + bounceOut((2 * x) - 1)) / 2)
};
const EASING_NAMES = Object.keys(EASINGS$1);
const squash = name => String(name).toLowerCase()
    .replace(/[\s_-]/g, '');
const BY_SQUASHED = new Map();
for (const name of EASING_NAMES) {
    BY_SQUASHED.set(squash(name), EASINGS$1[name]);
    if (name.startsWith('ease')) BY_SQUASHED.set(squash(name.slice(4)), EASINGS$1[name]);
}
const easingOf = easing => {
    if (typeof easing === 'undefined' || easing === null) return EASINGS$1.linear;
    if (typeof easing === 'function') return easing;
    const found = BY_SQUASHED.get(squash(easing));
    if (!found) {
        throw new TypeError(`No easing called "${easing}", try one of: ${EASING_NAMES.join(', ')} ` +
            '(see easings.net), or pass a function t => ...');
    }
    return found;
};
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RELATIVE = /^([+-])=\s*(-?[\d.]+(?:e[+-]?\d+)?)$/i;
const parseHex = value => {
    if (typeof value !== 'string' || !HEX.test(value.trim())) return null;
    let hex = value.trim().slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c)
        .join('');
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
};
const toHex = rgb => `#${rgb.map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16)
    .padStart(2, '0')).join('')}`;
const colourOf = value => (Array.isArray(value) && value.length === 3 ? value.map(Number) : parseHex(value));
const lerp = (a, b, t) => a + ((b - a) * t);
const toNumber = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const locate = (subject, path) => {
    const parts = String(path).split('.')
        .map(part => part.trim());
    let parent = subject;
    for (let i = 0; i < parts.length - 1; i++) {
        parent = parent[parts[i]];
        if (parent === null || (typeof parent !== 'object' && typeof parent !== 'function')) {
            throw new TypeError(`Can't tween "${path}": ${parts.slice(0, i + 1).join('.')} is ${parent}`);
        }
    }
    return {parent, key: parts[parts.length - 1]};
};
const makeTrack = (subject, path, to, hasFrom, fromValue) => {
    const {parent, key} = locate(subject, path);
    const current = hasFrom ? fromValue : parent[key];
    const bad = () => new TypeError(`Can't tween "${path}" to ${JSON.stringify(to)}: tweens take numbers, ` +
        '"+=n" / "-=n", "#rrggbb" colours or arrays of numbers');
    let at;
    const relative = typeof to === 'string' ? RELATIVE.exec(to.trim()) : null;
    const toColour = !relative && typeof to === 'string' ? parseHex(to) : null;
    if (relative) {
        const from = toNumber(current);
        const end = from + (Number(relative[2]) * (relative[1] === '-' ? -1 : 1));
        at = t => lerp(from, end, t);
    } else if (toColour) {
        const from = colourOf(current) || toColour;
        at = t => toHex(from.map((c, i) => lerp(c, toColour[i], t)));
    } else if (Array.isArray(to)) {
        const end = to.map(Number);
        if (end.some(n => !Number.isFinite(n))) throw bad();
        const from = end.map((n, i) => (Array.isArray(current) ? toNumber(current[i]) : n));
        at = t => end.map((n, i) => lerp(from[i], n, t));
    } else {
        const end = Number(to);
        if ((typeof to !== 'number' && typeof to !== 'string') || !Number.isFinite(end)) throw bad();
        const from = toNumber(current);
        at = t => lerp(from, end, t);
    }
    return {
        write: t => { parent[key] = at(t); },
        start: () => {
            if (hasFrom) parent[key] = at(0);
        }
    };
};
class Tween {
    constructor (owner, {duration, ease, onStep, tracks, range, delay = 0, repeat = 0, yoyo = false}) {
        this._owner = owner;
        this._clock = owner.runtimeHost.clock;
        this._ease = ease;
        this._onStep = onStep || null;
        this._tracks = tracks;
        this._range = range;
        this._elapsed = 0;
        this._last = this._clock.now;
        this._paused = false;
        this._loop = null;
        this.duration = duration;
        this.delay = delay;
        this.repeat = repeat;
        this.yoyo = yoyo;
        this.iteration = 0;
        this.status = 'running';
        this.progress = 0;
        this.value = range ? range.from : 0;
        this.done = new Promise(resolve => { this._resolveDone = resolve; });
        this._tracks.forEach(track => track.start());
        if (duration === 0 && delay === 0) { this.finish(); return; }
        this._loop = this._clock.loop(owner, () => this._step(), {onEnd: () => this._end('stopped'), kind: 'tween', meta: this});
    }
    get _endT () { return this.yoyo && Number.isFinite(this.repeat) && (this.repeat % 2 === 1) ? 0 : 1; }
    get running () { return this.status === 'running'; }
    get paused () { return this._paused; }
    _step () {
        const now = this._clock.now;
        if (!this._paused) this._elapsed += now - this._last;
        this._last = now;
        if (this._paused || !this.running) return;
        const local = this._elapsed - this.delay;
        if (local < 0) return;
        const plays = this.repeat + 1;
        const play = this.duration === 0 ? plays : Math.floor(local / this.duration);
        if (play >= plays) { this.finish(); return; }
        this.iteration = play;
        let t = (local - (play * this.duration)) / this.duration;
        if (this.yoyo && play % 2 === 1) t = 1 - t;
        this._apply(t);
    }
    _apply (t) {
        if (!this.running) return;
        const eased = this._ease(t);
        this.progress = t;
        this.value = this._range ? lerp(this._range.from, this._range.to, eased) : eased;
        try { this._tracks.forEach(track => track.write(eased)); } catch (e) {
            if (!(e instanceof Stopped)) this._owner.reportError(e);
            this.stop();
            return;
        }
        if (this._onStep && !this._owner.invoke(this._onStep, this.value, t, this)) this.stop();
    }
    _end (status) {
        if (!this.running) return;
        this.status = status;
        if (this._loop) this._loop.stop();
        this._resolveDone({status});
    }
    stop () { this._end('stopped'); }
    finish () {
        if (Number.isFinite(this.repeat)) this.iteration = this.repeat;
        this._apply(this._endT);
        this._end('finished');
    }
    pause () { this._paused = true; return this; }
    resume () { this._paused = false; return this; }
    then (onFulfilled, onRejected) {
        return this.done.then(({status}) => {
            if (status === 'stopped') throw new Stopped('tween stopped');
        }).then(onFulfilled, onRejected);
    }
    catch (onRejected) { return this.then(null, onRejected); }
    finally (fn) { return this.then(v => { fn(); return v; }, e => { fn(); throw e; }); }
}
const optionsOf = (options, nothing) => {
    if (typeof options === 'undefined' || options === null) return {};
    if (typeof options === 'string') return {easing: options};
    if (typeof options === 'function') return nothing ? {onStep: options} : {easing: options};
    if (typeof options === 'object') return options;
    throw new TypeError('A tween\'s options are an easing name, or {easing, onStep, from}');
};
const startTween = (owner, subject, to, seconds, options, nothing = false) => {
    owner.assertAlive();
    const opts = optionsOf(options, nothing);
    const ease = easingOf(opts.easing);
    if (typeof opts.onStep !== 'undefined' && opts.onStep !== null && typeof opts.onStep !== 'function') {
        throw new TypeError('A tween\'s onStep has to be a function, e.g. onStep: (value, progress) => ...');
    }
    const s = Number(seconds);
    const duration = Number.isFinite(s) ? Math.max(0, s) : 0;
    const delay = Math.max(0, toNumber(opts.delay));
    const repeat = opts.repeat === Infinity || opts.repeat === true ? Infinity :
        Math.max(0, Math.floor(toNumber(opts.repeat)));
    if (repeat === Infinity && duration === 0) { throw new TypeError('A tween that repeats forever needs some seconds to take'); }
    let tracks = [];
    let range = null;
    if (nothing) {
        range = {
            from: typeof opts.from === 'undefined' ? 0 : toNumber(opts.from),
            to: typeof opts.to === 'undefined' ? 1 : toNumber(opts.to)
        };
    } else {
        if (!subject || (typeof subject !== 'object' && typeof subject !== 'function')) {
            throw new TypeError('tween() needs something to tween, e.g. tween(me, {x: 100}, 1)... ' +
                'or seconds first to tween nothing: tween(1, {onStep: v => ...})');
        }
        if (!to || typeof to !== 'object' || Array.isArray(to)) {
            throw new TypeError('A tween needs the properties to tween to, e.g. {x: 100, "effects.ghost": 50}');
        }
        const from = opts.from && typeof opts.from === 'object' ? opts.from : {};
        tracks = Object.keys(to).map(path =>
            makeTrack(subject, path, to[path], Object.prototype.hasOwnProperty.call(from, path), from[path]));
    }
    return new Tween(owner, {duration, ease, onStep: opts.onStep, tracks, range, delay, repeat, yoyo: Boolean(opts.yoyo)});
};
const SERVER_HATS = {
    data: 'event_dimod_whenireceive',
    connected: 'event_dimod_whenconnected',
    disconnected: 'event_dimod_whendisconnected'
};
const EVENTS = {
    data: 'server:data',
    connect: 'server:connect',
    disconnect: 'server:disconnect',
    relay: 'server:relay',
    join: 'server:join',
    leave: 'server:leave'
};
const parseServerData = data => {
    if (typeof data !== 'string') return data;
    const trimmed = data.trim();
    if (!trimmed) return data;
    try { return JSON.parse(trimmed); } catch (e) { return data; }
};
const toServerData = data => {
    if (typeof data === 'string') return data;
    if (data === null || typeof data === 'undefined') return '';
    try { return JSON.stringify(data); } catch (e) { return String(data); }
};
class ServerApi {
    constructor (owner) { Object.defineProperty(this, '_owner', {value: owner}); }
    get _client () { return this._owner.runtimeHost.vm.dimodGameClient || null; }
    _use () {
        this._owner.assertAlive();
        const client = this._client;
        if (client) client.ensureConnected();
        return client;
    }
    get available () { return Boolean(this._client); }
    get connected () { const client = this._client; return Boolean(client && client.connected); }
    get ping () {
        const client = this._client;
        if (client) client.ping();
        return client ? client.latency : 0;
    }
    get players () { const client = this._client; return client ? client.playerCount : 0; }
    get room () { const client = this._client; return client ? client.room : 'default'; }
    get me () {
        const client = this._client;
        if (!client || !client.player) return null;
        return {username: client.player.username, id: client.player.id, isGuest: client.isGuest};
    }
    get roster () {
        const client = this._client;
        if (!client) return [];
        const mine = client.player && client.player.id;
        return [...client.roster.values()].filter(p => p.id !== mine)
            .map(p => ({id: p.id, username: p.username, isGuest: !p.loggedIn}));
    }
    send (data) {
        const client = this._use();
        if (client) client.send(toServerData(data));
    }
    relay (channel, data, {to = null} = {}) {
        if (typeof channel !== 'string' || !channel) {
            throw new TypeError('world.server.relay(channel, data) needs a channel name, e.g. "position"');
        }
        const client = this._use();
        return client ? client.relay(channel, data, to) : false;
    }
    ask (data) {
        const client = this._use();
        if (!client) return Promise.resolve(null);
        return client.ask(toServerData(data)).then(answer => (answer === '' ? null : parseServerData(answer)));
    }
    join (room) {
        const client = this._use();
        if (client) client.joinRoom(room);
    }
    connect () { this._use(); }
    disconnect () {
        const client = this._client;
        if (client) client.disconnect();
    }
    reconnect () {
        const client = this._client;
        if (client) client.reconnect();
    }
    on (event, filter, fn) {
        if (typeof filter === 'function' && typeof fn === 'undefined') { fn = filter; filter = null; }
        const name = EVENTS[event];
        if (!name) {
            throw new TypeError(`world.server.on("${event}"): the server's events are ` +
                `${Object.keys(EVENTS).join(', ')}`);
        }
        if (typeof fn !== 'function') throw new TypeError(`world.server.on("${event}") needs a function`);
        if (filter !== null && event !== 'relay') { throw new TypeError(`world.server.on("${event}") doesn't take a filter`); }
        const off = this._owner.onWorld(name, filter, fn);
        this._use();
        return off;
    }
}
const PRESETS = {
    position: ['x', 'y'],
    motion: ['x', 'y', 'direction'],
    appearance: ['costumeIndex', 'visible', 'size', 'direction'],
    everything: ['x', 'y', 'direction', 'costumeIndex', 'visible', 'size']
};
const DEFAULTS$1 = {
    mode: 'ghost',
    rate: 15,
    interpolate: true,
    delay: 100,
    precision: 2,
    threshold: 0,
    snap: null,
    heartbeat: 2,
    timeout: 10,
    onTimeout: 'remove',
    authority: 'anyone'
};
const MAX_RATE = 30;
const MAX_PACKET_BYTES = 12 * 1024;
const REMOTE_HOLD_OFF_MS = 250;
const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());
const round$1 = (value, digits) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || digits === null) return value;
    const f = Math.pow(10, digits);
    return Math.round(value * f) / f;
};
const normalizeProps = props => {
    const out = {};
    const add = (path, options) => {
        out[path] = options === true || options === null || typeof options === 'undefined' ? {} : options;
        if (typeof out[path] !== 'object') {
            throw new TypeError(`me.sync: the options for "${path}" should be an object or true`);
        }
    };
    const expand = item => {
        if (typeof item === 'string') {
            if (PRESETS[item]) PRESETS[item].forEach(path => add(path, {}));
            else add(item, {});
        } else if (Array.isArray(item)) { item.forEach(expand); } else if (item && typeof item === 'object') {
            for (const path of Object.keys(item)) {
                if (item[path] === false) continue;
                add(path, item[path]);
            }
        } else { throw new TypeError('me.sync(props): a list of property names, a preset ("motion") or {name: options}'); }
    };
    expand(props);
    if (!Object.keys(out).length) throw new TypeError('me.sync() needs something to sync, e.g. me.sync(["x", "y"])');
    return out;
};
class SyncHandle {
    constructor (owner, target, props, options) {
        const host = owner.runtimeHost;
        const opts = {...DEFAULTS$1, ...options};
        if (opts.mode !== 'ghost' && opts.mode !== 'shared') { throw new TypeError('me.sync: mode is "ghost" or "shared"'); }
        const interpolate = opts.interpolate === false ? null :
            {delay: opts.delay, ...(opts.interpolate && typeof opts.interpolate === 'object' ? opts.interpolate : {})};
        Object.defineProperty(this, '_s', {value: {
            owner,
            host,
            target,
            api: owner.wrap(target),
            opts,
            interpolate,
            props: normalizeProps(props),
            paths: {},
            client: host.vm.dimodGameClient || null,
            channel: opts.channel ? String(opts.channel) : `sync:${target.getName()}${opts.id ? `:${opts.id}` : ''}`,
            extra: null,
            ghosts: new Map(),
            lastSent: {},
            lastRemote: {},
            since: 0,
            sinceFull: 0,
            needFull: true,
            paused: false,
            alive: true,
            listeners: {spawn: new Set(), remove: new Set(), update: new Set()},
            stats: {sent: 0, received: 0, bytes: 0}
        }});
        const s = this._s;
        const rate = Math.min(MAX_RATE, Math.max(1, Number(opts.rate) || DEFAULTS$1.rate));
        s.interval = 1 / rate;
        for (const path of Object.keys(s.props)) s.paths[path] = locate(s.api, path);
        if (opts.onSpawn) s.listeners.spawn.add(opts.onSpawn);
        if (opts.onRemove) s.listeners.remove.add(opts.onRemove);
        if (opts.onUpdate) s.listeners.update.add(opts.onUpdate);
        this._start();
    }
    _start () {
        const s = this._s;
        const {owner, client, host} = s;
        if (!client) return;
        const offs = [
            client.listen('relay', (channel, data, from) => this._onRelay(channel, data, from)),
            client.listen('leave', player => this._removeGhost(player.id, 'left')),
            client.listen('join', () => { s.needFull = true; })
        ];
        s.loop = host.clock.loop(owner, dt => this._tick(dt), {
            killOnStop: false,
            kind: 'sync',
            meta: {stop: () => this.stop(), sync: this}
        });
        client.ensureConnected();
        owner._addOff(() => this._teardown(offs));
        s.offs = offs;
    }
    _teardown (offs) {
        const s = this._s;
        if (!s.alive) return;
        s.alive = false;
        offs.forEach(off => off());
        s.loop.stop();
        for (const id of [...s.ghosts.keys()]) this._removeGhost(id, 'stopped');
    }
    get available () { return Boolean(this._s.client); }
    get active () { return this._s.alive && !this._s.paused; }
    get channel () { return this._s.channel; }
    get mode () { return this._s.opts.mode; }
    get ghosts () { return new Map([...this._s.ghosts].map(([id, g]) => [id, g.api])); }
    get players () { return [...this._s.ghosts.values()].map(g => g.player); }
    get stats () { return {...this._s.stats, ghosts: this._s.ghosts.size}; }
    get extra () { return this._s.extra; }
    set extra (value) { this._s.extra = value; this._s.needFull = true; }
    ghostOf (playerId) { const g = this._s.ghosts.get(String(playerId)); return g ? g.api : null; }
    pause () { this._s.paused = true; }
    resume () { this._s.paused = false; this._s.needFull = true; }
    stop () { const s = this._s; this._teardown(s.offs || []); }
    flush () { this._s.needFull = true; this._s.since = this._s.interval; }
    on (event, fn) {
        const set = this._s.listeners[event];
        if (!set) throw new TypeError('sync.on("spawn" | "remove" | "update", fn)');
        if (typeof fn !== 'function') throw new TypeError(`sync.on("${event}") needs a function`);
        set.add(fn);
        return () => set.delete(fn);
    }
    _emit (event, ...args) {
        for (const fn of [...this._s.listeners[event]]) this._s.owner.invokeAs(`sync ${event}`, fn, ...args);
    }
    _canSend () {
        const s = this._s;
        const {opts, client} = s;
        if (s.paused || !client || !client.connected || opts.send === false) return false;
        if (typeof opts.send === 'function' && !opts.send()) return false;
        if (opts.mode === 'shared') {
            const authority = opts.authority;
            const me = client.player;
            const others = [...client.roster.values()];
            if (authority === 'host') return !others.length || others[0].id === (me && me.id);
            if (typeof authority === 'function') return Boolean(authority(me, others));
        }
        return true;
    }
    _tick (dt) {
        const s = this._s;
        this._smooth();
        this._expire();
        s.since += dt;
        s.sinceFull += dt;
        if (s.since < s.interval) return;
        if (!this._canSend()) return;
        if (!s.client.roster || s.client.roster.size < 2) return;
        s.since = 0;
        const beat = s.opts.heartbeat > 0 && s.sinceFull >= s.opts.heartbeat;
        const full = s.needFull || beat;
        const changed = {};
        let any = false;
        const t = now();
        for (const path of Object.keys(s.props)) {
            const config = s.props[path];
            const {parent, key} = s.paths[path];
            if (s.opts.mode === 'shared' && t - (s.lastRemote[path] || 0) < REMOTE_HOLD_OFF_MS) continue;
            const digits = typeof config.precision === 'number' ? config.precision : s.opts.precision;
            const value = round$1(parent[key], digits);
            const was = s.lastSent[path];
            const threshold = typeof config.threshold === 'number' ? config.threshold : s.opts.threshold;
            const differs = typeof value === 'number' && typeof was === 'number' ?
                Math.abs(value - was) > threshold :
                !Object.is(value, was);
            if (full || differs) { changed[path] = value; s.lastSent[path] = value; any = true; }
        }
        if (!any) return;
        if (full) { s.needFull = false; s.sinceFull = 0; }
        const packet = {s: changed, f: full ? 1 : 0};
        if (s.extra !== null && (full || s.extraSent !== s.extra)) { packet.x = s.extra; s.extraSent = s.extra; }
        if (typeof s.opts.encode === 'function') {
            const encoded = s.owner.invokeAs('sync encode', () => s.opts.encode(packet.s));
            if (encoded && typeof encoded === 'object') packet.s = encoded;
        }
        const text = JSON.stringify(packet);
        if (text.length > MAX_PACKET_BYTES) {
            s.owner.reportError(new RangeError(`me.sync: an update is ${text.length} bytes, over the ${MAX_PACKET_BYTES} limit`));
            return;
        }
        if (s.client.relay(s.channel, text)) { s.stats.sent += 1; s.stats.bytes += text.length; }
    }
    _onRelay (channel, data, from) {
        const s = this._s;
        if (channel !== s.channel || !s.alive || s.opts.receive === false) return;
        const packet = parseServerData(data);
        if (!packet || typeof packet !== 'object' || typeof packet.s !== 'object' || packet.s === null) return;
        const p = s.client.roster.get(from);
        if (!p) return;
        const player = {id: from, username: p.username, isGuest: !p.loggedIn};
        if (typeof s.opts.filter === 'function' && !s.owner.invokeSafely(() => s.opts.filter(player))) return;
        s.stats.received += 1;
        const t = now();
        let state = packet.s;
        if (typeof s.opts.transform === 'function') {
            const changed = s.owner.invokeSafely(() => s.opts.transform({...state}, player));
            if (changed && typeof changed === 'object') state = changed;
        }
        let ghost = null;
        if (s.opts.mode === 'ghost') {
            ghost = s.ghosts.get(from);
            if (ghost && ghost.target.isDisposed) { s.ghosts.delete(from); s.host.clearGhostInfo(ghost.target); ghost = null; }
            ghost = ghost || this._spawn(player);
            if (!ghost) return;
            ghost.lastSeen = t;
            ghost.player = player;
            if (typeof packet.x !== 'undefined') ghost.extra = packet.x;
        }
        for (const path of Object.keys(state)) {
            if (!(path in s.props)) continue;
            const config = s.props[path];
            const value = state[path];
            const wants = config.interpolate === false ? null :
                (config.interpolate && typeof config.interpolate === 'object' ?
                    {delay: s.interpolate ? s.interpolate.delay : DEFAULTS$1.delay, ...config.interpolate} :
                    s.interpolate);
            s.lastRemote[path] = t;
            if (wants && typeof value === 'number') {
                const buffers = ghost ? ghost.buffers : (s.sharedBuffers || (s.sharedBuffers = new Map()));
                let buffer = buffers.get(path);
                if (!buffer) { buffer = {samples: [], delay: wants.delay}; buffers.set(path, buffer); }
                buffer.delay = wants.delay;
                buffer.samples.push({at: t, value});
                if (buffer.samples.length === 1) this._apply(ghost, path, value);
            } else { this._apply(ghost, path, value); }
        }
        this._emit('update', ghost ? ghost.api : s.api, state, player);
    }
    _target (ghost) { return ghost ? ghost.target : this._s.target; }
    _apply (ghost, path, value) {
        const s = this._s;
        const target = this._target(ghost);
        if (target.isDisposed) return;
        const api = ghost ? ghost.api : s.api;
        try {
            const {parent, key} = locate(api, path);
            parent[key] = value;
            if (!ghost) s.lastSent[path] = value;
        } catch (e) { s.owner.reportError(e); }
    }
    _smooth () {
        const s = this._s;
        const t = now();
        const run = (ghost, buffers) => {
            for (const [path, buffer] of buffers) {
                const samples = buffer.samples;
                const at = t - buffer.delay;
                while (samples.length > 2 && samples[1].at <= at) samples.shift();
                let value;
                const config = s.props[path] || {};
                const snap = typeof config.snap === 'number' ? config.snap : s.opts.snap;
                if (samples.length === 1 || at <= samples[0].at) { value = samples[0].value; } else {
                    const [a, b] = samples;
                    const span = b.at - a.at;
                    const k = span > 0 ? Math.min(1, Math.max(0, (at - a.at) / span)) : 1;
                    value = snap !== null && Math.abs(b.value - a.value) > snap ? (k >= 1 ? b.value : a.value) :
                        a.value + ((b.value - a.value) * k);
                }
                this._apply(ghost, path, value);
            }
        };
        for (const ghost of s.ghosts.values()) run(ghost, ghost.buffers);
        if (s.sharedBuffers) run(null, s.sharedBuffers);
    }
    _expire () {
        const s = this._s;
        if (s.opts.timeout <= 0 || s.opts.onTimeout === 'keep') return;
        const t = now();
        for (const [id, ghost] of s.ghosts) {
            if (t - ghost.lastSeen < s.opts.timeout * 1000) continue;
            if (s.opts.onTimeout === 'hide') {
                if (ghost.api.visible) ghost.api.visible = false;
            } else { this._removeGhost(id, 'timeout'); }
        }
    }
    _spawn (player) {
        const s = this._s;
        const {host, opts} = s;
        const setup = opts.ghost || {};
        let clone = null;
        host.beginGhost({sync: this, player, run: Boolean(setup.run)});
        try {
            const original = s.target.isOriginal ? s.target : (s.target.sprite.clones[0] || s.target);
            clone = s.owner.wrap(original).clone();
        } finally { host.endGhost(); }
        if (!clone) return null;
        const ghost = {target: clone._target, api: clone, buffers: new Map(), lastSeen: now(), extra: null, player};
        s.ghosts.set(player.id, ghost);
        host.setGhostInfo(ghost.target, {sync: this, player, ghost});
        if (setup.show !== false) clone.visible = true;
        for (const path of Object.keys(setup)) {
            if (['run', 'show', 'label'].includes(path)) continue;
            try { const {parent, key} = locate(clone, path); parent[key] = setup[path]; } catch (e) { s.owner.reportError(e); }
        }
        if (setup.label) {
            const text = typeof setup.label === 'function' ? setup.label(player) : player.username;
            if (text) clone.say(text);
        }
        this._emit('spawn', clone, player);
        return ghost;
    }
    _removeGhost (playerId, reason) {
        const s = this._s;
        const ghost = s.ghosts.get(playerId);
        if (!ghost) return;
        s.ghosts.delete(playerId);
        this._emit('remove', ghost.api, ghost.player, reason);
        s.host.clearGhostInfo(ghost.target);
        if (!ghost.target.isDisposed) {
            try { ghost.api.delete(); } catch (e) {
            }
        }
    }
}
class InertSync {
    constructor (reason) { Object.defineProperty(this, '_reason', {value: reason}); }
    get available () { return false; }
    get active () { return false; }
    get channel () { return ''; }
    get mode () { return 'ghost'; }
    get ghosts () { return new Map(); }
    get players () { return []; }
    get stats () { return {sent: 0, received: 0, bytes: 0, ghosts: 0}; }
    get extra () { return null; }
    set extra (value) {
    }
    ghostOf () { return null; }
    pause () {}
    resume () {}
    stop () {}
    flush () {}
    on () { return () => {}; }
}
const callPrimitive = (runtime, opcode, args, target) => {
    const primitive = runtime._primitives[opcode];
    if (!primitive) throw new Error(`No block "${opcode}" in this project`);
    return primitive(args || {}, {target, runtime, thread: null, stackFrame: {}});
};
const extensionLoaded = (runtime, id) => {
    const manager = runtime.dimodBlockspace && runtime.dimodBlockspace.vm.extensionManager;
    return Boolean(manager && manager.isExtensionLoaded(id));
};
const requireExtension = (runtime, id, label) => {
    if (!extensionLoaded(runtime, id)) {
        throw new Error(`${label} needs the ${label} extension, add it from the extension library ` +
            `or call world.useExtension("${id}") first`);
    }
};
class SoundApi {
    constructor (owner, target) { this._owner = owner; this._target = target; }
    get names () { return this._target.getSounds().map(sound => sound.name); }
    _check (name) {
        this._owner.assertAlive();
        if (typeof name === 'string' && this._target.getSoundIndexByName(name) < 0) {
            throw new ReferenceError(`${this._target.getName()} has no sound named "${name}"`);
        }
    }
    play (name) {
        this._check(name);
        return Promise.resolve(callPrimitive(this._target.runtime, 'sound_playuntildone', {SOUND_MENU: name}, this._target));
    }
    start (name) { this._check(name); callPrimitive(this._target.runtime, 'sound_play', {SOUND_MENU: name}, this._target); }
    stop (name) { this._check(name); callPrimitive(this._target.runtime, 'sound_stop', {SOUND_MENU: name}, this._target); }
    stopAll () { callPrimitive(this._target.runtime, 'sound_stopallsounds', {}, this._target); }
    get volume () { return callPrimitive(this._target.runtime, 'sound_volume', {}, this._target); }
    set volume (value) {
        this._owner.assertAlive();
        callPrimitive(this._target.runtime, 'sound_setvolumeto', {VOLUME: Cast.toNumber(value)}, this._target);
    }
    get _effects () {
        const state = this._target.getCustomState('Scratch.sound');
        return (state && state.effects) || {pitch: 0, pan: 0};
    }
    get pitch () { return this._effects.pitch; }
    set pitch (value) {
        this._owner.assertAlive();
        callPrimitive(this._target.runtime, 'sound_seteffectto', {EFFECT: 'PITCH', VALUE: Cast.toNumber(value)}, this._target);
    }
    get pan () { return this._effects.pan; }
    set pan (value) {
        this._owner.assertAlive();
        callPrimitive(this._target.runtime, 'sound_seteffectto', {EFFECT: 'PAN', VALUE: Cast.toNumber(value)}, this._target);
    }
    clearEffects () { callPrimitive(this._target.runtime, 'sound_cleareffects', {}, this._target); }
    overlap (name, on = true) { this._check(name); setSoundOverlap(this._target, name, Boolean(on)); }
    overlaps (name) { this._check(name); return getSoundOverlap(this._target, name); }
}
SOUND_EFFECTS.forEach(({name}) => {
    Object.defineProperty(SoundApi.prototype, name, {
        get () { return this._effects[name] || 0; },
        set (value) {
            this._owner.assertAlive();
            callPrimitive(this._target.runtime, 'sound_seteffectto', {EFFECT: name.toUpperCase(), VALUE: Cast.toNumber(value)},
                this._target);
        }
    });
});
const penOf = runtime => { requireExtension(runtime, 'pen', 'Pen'); return runtime.ext_pen; };
class PenApi {
    constructor (owner, target) { this._owner = owner; this._target = target; }
    get _ext () { return penOf(this._target.runtime); }
    get _state () { return this._ext._getPenState(this._target); }
    _util () { this._owner.assertAlive(); return {target: this._target, runtime: this._target.runtime}; }
    down () { this._ext.penDown({}, this._util()); return this; }
    up () { this._ext.penUp({}, this._util()); return this; }
    get isDown () { return this._state.penDown; }
    stamp () { this._ext.stamp({}, this._util()); return this; }
    get color () {
        const [r, g, b] = this._state.penAttributes.color4f;
        return Color.rgbToHex({r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255)});
    }
    set color (value) {
        const color = Array.isArray(value) ? Color.rgbToHex({r: value[0], g: value[1], b: value[2]}) : value;
        this._ext.setPenColorToColor({COLOR: color}, this._util());
    }
    get size () { return this._state.penAttributes.diameter; }
    set size (value) { this._ext.setPenSizeTo({SIZE: Cast.toNumber(value)}, this._util()); }
    get transparency () { return this._state.transparency; }
    set transparency (value) {
        this._ext.setPenColorParamTo({COLOR_PARAM: 'transparency', VALUE: Cast.toNumber(value)}, this._util());
    }
}
class CameraApi {
    constructor (owner, name) { this._owner = owner; this.name = name; }
    get _runtime () {
        const runtime = this._owner.runtimeHost.runtime;
        requireExtension(runtime, 'pmCamera', 'Camera');
        return runtime;
    }
    get _state () { return this._runtime.getCamera(this.name); }
    _set (state) { this._owner.assertAlive(); this._runtime.updateCamera(this.name, state); }
    get x () { return this._state.pos[0]; }
    set x (value) { this._set({pos: [Cast.toNumber(value), this._state.pos[1]]}); }
    get y () { return this._state.pos[1]; }
    set y (value) { this._set({pos: [this._state.pos[0], Cast.toNumber(value)]}); }
    get angle () { return this._state.dir; }
    set angle (value) { this._set({dir: Cast.toNumber(value)}); }
    get zoom () { return this._state.scale; }
    set zoom (value) { this._set({scale: Math.max(0.0001, Cast.toNumber(value))}); }
    goTo (x, y) {
        const point = typeof x === 'object' && x ? {x: x.x, y: x.y} : {x, y};
        this._set({pos: [Cast.toNumber(point.x), Cast.toNumber(point.y)]});
        return this;
    }
    move (dx, dy) {
        const [x, y] = this._state.pos;
        this._set({pos: [x + Cast.toNumber(dx), y + Cast.toNumber(dy)]});
        return this;
    }
    async glide (seconds, x, y, easing) {
        const ease = easingOf(easing);
        const clock = this._owner.runtimeHost.clock;
        const [fromX, fromY] = this._state.pos;
        const toX = Cast.toNumber(x);
        const toY = Cast.toNumber(y);
        const duration = Math.max(0, Cast.toNumber(seconds));
        const start = clock.now;
        for (;;) {
            const t = ease(duration === 0 ? 1 : Math.min(1, (clock.now - start) / duration));
            this._set({pos: [fromX + ((toX - fromX) * t), fromY + ((toY - fromY) * t)]});
            if (t >= 1) return;
            await clock.nextFrame(this._owner);
        }
    }
    follow (targetApi, {smoothing = 0} = {}) {
        this.unfollow();
        const clock = this._owner.runtimeHost.clock;
        const k = Math.min(0.99, Math.max(0, Cast.toNumber(smoothing)));
        this._follow = clock.loop(this._owner, () => {
            if (!targetApi.exists) return;
            const [x, y] = this._state.pos;
            this._set({pos: [x + ((targetApi.x - x) * (1 - k)), y + ((targetApi.y - y) * (1 - k))]});
        }, {kind: 'follow', meta: {camera: this.name}});
        return this._follow;
    }
    unfollow () {
        if (this._follow) this._follow.stop();
        this._follow = null;
    }
}
const extensionProxy = (owner, target, extensionId) => {
    const runtime = owner.runtimeHost.runtime;
    const category = () => runtime._blockInfo.find(info => info.id === extensionId);
    if (!category()) {
        throw new Error(`Extension "${extensionId}" isn't in this project, add it from the extension library ` +
            `or call world.useExtension("${extensionId}") first`);
    }
    return new Proxy({}, {
        get (obj, name) {
            if (typeof name !== 'string' || name === 'then') return;
            const block = (category().blocks || [])
                .map(b => b.info)
                .find(info => info && info.opcode === name);
            if (!block) throw new ReferenceError(`Extension "${extensionId}" has no block "${name}"`);
            const reporter = block.blockType === 'reporter' || block.blockType === 'Boolean';
            return (args = {}) => owner.runtimeHost.spaces.runBlock(owner, target, `${extensionId}_${name}`, args, reporter);
        }
    });
};
const gamepad = index => {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && pads[index || 0];
    if (!pad) return null;
    return {
        id: pad.id,
        buttons: pad.buttons.map(button => button.pressed),
        axes: pad.axes.slice(),
        button: i => Boolean(pad.buttons[i] && pad.buttons[i].pressed),
        axis: i => pad.axes[i] || 0
    };
};
const ask = (owner, target, question) => {
    owner.assertAlive();
    const runtime = owner.runtimeHost.runtime;
    return Promise.resolve(callPrimitive(runtime, 'sensing_askandwait', {QUESTION: String(toCast(question))}, target))
        .then(() => {
            if (!owner.alive) throw new Stopped('disposed');
            return callPrimitive(runtime, 'sensing_answer', {}, target);
        });
};
const num = (v, d) => (v === null || typeof v === 'undefined' || v === '' ? d : Cast.toNumber(v));
const FIELDS = ['x', 'y', 'direction', 'size', 'stretchX', 'stretchY'];
const DEFAULTS = [0, 0, 90, 100, 100, 100];
const operand = other => (typeof other === 'number' ?
    new Position(other, other, other, other, other, other) :
    Position.from(other));
class Position {
    constructor (x, y, direction, size, stretchX, stretchY) {
        if (x !== null && typeof x === 'object') {
            const o = x;
            FIELDS.forEach((f, i) => { this[f] = num(o[f], DEFAULTS[i]); });
            return;
        }
        [x, y, direction, size, stretchX, stretchY].forEach((v, i) => { this[FIELDS[i]] = num(v, DEFAULTS[i]); });
    }
    static from (value) {
        if (value instanceof Position) return value.clone();
        if (value === null || typeof value === 'undefined' || value === '') return new Position();
        if (typeof value === 'object' && value.position instanceof Position) return value.position;
        if (typeof value === 'string') {
            try { return new Position(JSON.parse(value)); } catch (e) { throw new TypeError(`"${value}" isn't a position`); }
        }
        if (typeof value === 'object') {
            if (typeof value.toJSON === 'function' && !Array.isArray(value)) {
                const json = value.toJSON();
                if (typeof json === 'string') return Position.from(json);
                if (json && typeof json === 'object') return new Position(json);
            }
            return new Position(value);
        }
        throw new TypeError(`${String(value)} isn't a position`);
    }
    clone () { return new Position(this); }
    with (changes) { return new Position(Object.assign({}, this, changes)); }
    add (other) { const o = operand(other); return new Position(...FIELDS.map(f => this[f] + o[f])); }
    subtract (other) { const o = operand(other); return new Position(...FIELDS.map(f => this[f] - o[f])); }
    multiply (other) { const o = operand(other); return new Position(...FIELDS.map(f => this[f] * o[f])); }
    divide (other) { const o = operand(other); return new Position(...FIELDS.map(f => (o[f] === 0 ? 0 : this[f] / o[f]))); }
    relativeTo (parent) {
        const p = Position.from(parent);
        const rad = -(p.direction - 90) * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const sx = this.x * (p.size / 100) * (p.stretchX / 100);
        const sy = this.y * (p.size / 100) * (p.stretchY / 100);
        return new Position(
            p.x + ((sx * cos) - (sy * sin)),
            p.y + ((sx * sin) + (sy * cos)),
            p.direction + this.direction - 90,
            p.size * (this.size / 100),
            p.stretchX * (this.stretchX / 100),
            p.stretchY * (this.stretchY / 100)
        );
    }
    localTo (parent) {
        const p = Position.from(parent);
        const rad = (p.direction - 90) * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = this.x - p.x;
        const dy = this.y - p.y;
        const kx = (p.size / 100) * (p.stretchX / 100) || 1e-9;
        const ky = (p.size / 100) * (p.stretchY / 100) || 1e-9;
        return new Position(
            ((dx * cos) - (dy * sin)) / kx,
            ((dx * sin) + (dy * cos)) / ky,
            this.direction - p.direction + 90,
            p.size ? this.size / (p.size / 100) : 0,
            p.stretchX ? this.stretchX / (p.stretchX / 100) : 0,
            p.stretchY ? this.stretchY / (p.stretchY / 100) : 0
        );
    }
    distanceTo (other) { const o = Position.from(other); return Math.hypot(o.x - this.x, o.y - this.y); }
    angleTo (other) { const o = Position.from(other); return Math.atan2(o.x - this.x, o.y - this.y) * 180 / Math.PI; }
    lerp (other, amount) {
        const o = Position.from(other);
        const t = Cast.toNumber(amount);
        return new Position(...FIELDS.map(f => this[f] + ((o[f] - this[f]) * t)));
    }
    equals (other) { const o = Position.from(other); return FIELDS.every(f => Math.abs(this[f] - o[f]) < 1e-9); }
    toJSON () {
        const out = {};
        for (const f of FIELDS) out[f] = this[f];
        return out;
    }
    toString () { return JSON.stringify(this.toJSON()); }
    [CAST] () { return this.toString(); }
}
const SKIPPED_TYPES = new Set(['hat', 'event', 'conditional', 'loop', 'button', 'label', 'xml']);
const REPORTS = new Set(['reporter', 'Boolean']);
const extensionObject = (runtime, id) => {
    const vm = runtime.dimodBlockspace && runtime.dimodBlockspace.vm;
    const manager = vm && vm.extensionManager;
    const service = manager && manager._loadedExtensions.get(id);
    const object = service && dispatch.services[service];
    return object && typeof object.getInfo === 'function' ? object : null;
};
const customOf = (runtime, id) => {
    const object = extensionObject(runtime, id);
    if (!object) return null;
    try {
        const info = object.getInfo();
        return info && info.blockspace && typeof info.blockspace === 'object' ? info.blockspace : null;
    } catch (e) { return null; }
};
const textOf = info => (Array.isArray(info.text) ? info.text.join(' ') : String(info.text || ''));
const argOrder = info => {
    const names = [];
    const re = /\[([^\]]+)\]/g;
    let m;
    while ((m = re.exec(textOf(info)))) {
        if (info.arguments && info.arguments[m[1]] && !names.includes(m[1])) names.push(m[1]);
    }
    for (const name of Object.keys(info.arguments || {})) if (!names.includes(name)) names.push(name);
    return names;
};
const callableBlocks = category => (category.blocks || [])
    .map(b => b && b.info)
    .filter(info => info && info.opcode && !SKIPPED_TYPES.has(info.blockType) && !info.hideFromCode)
    .map(info => ({opcode: info.opcode, info, args: argOrder(info)}));
const isPlain = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const argValue = v => {
    if (v === null || typeof v === 'undefined') return '';
    if (typeof v === 'object' && typeof v[CAST] === 'function') return v[CAST]();
    return v;
};
const blockFunction = (owner, target, extensionId, block) => {
    const runtime = owner.runtimeHost.runtime;
    const opcode = `${extensionId}_${block.opcode}`;
    const call = (...given) => {
        owner.assertAlive();
        const primitive = runtime._primitives[opcode];
        if (!primitive) throw new Error(`${extensionId}.${block.opcode}() isn't available any more`);
        const named = given.length === 1 && isPlain(given[0]) && block.args.length > 0 &&
            Object.keys(given[0]).length > 0 && Object.keys(given[0]).every(k => block.args.includes(k));
        const args = {};
        block.args.forEach((name, i) => {
            const spec = block.info.arguments[name] || {};
            let v = named ? given[0][name] : given[i];
            if (typeof v === 'undefined') v = typeof spec.defaultValue === 'undefined' ? '' : spec.defaultValue;
            args[name] = argValue(v);
        });
        try { return primitive(args, {target, runtime, thread: null, stackFrame: {}}); } catch (e) {
            if (/thread|stackFrame|yield|startBranch/.test(String(e && e.message))) {
                throw new Error(`${extensionId}.${block.opcode}() has to run as a script: ` +
                    `use await me.ext("${extensionId}").${block.opcode}({...}) instead`);
            }
            throw e;
        }
    };
    Object.defineProperty(call, 'name', {value: block.opcode});
    return call;
};
const buildApi = (owner, target, category) => {
    const runtime = owner.runtimeHost.runtime;
    const api = {};
    for (const block of callableBlocks(category)) api[block.opcode] = blockFunction(owner, target, category.id, block);
    const custom = customOf(runtime, category.id);
    if (custom && custom.api) {
        const context = {target, runtime, vm: runtime.dimodBlockspace.vm, extension: extensionObject(runtime, category.id)};
        const extra = typeof custom.api === 'function' ? custom.api(context) : custom.api;
        if (extra && typeof extra === 'object') Object.assign(api, extra);
    }
    return Object.freeze(api);
};
const extensionsApi = (owner, target) => {
    const runtime = owner.runtimeHost.runtime;
    const cache = new Map();
    const categories = () => runtime._blockInfo.filter(c => c.id && c.blocks && c.blocks.length &&
        (!runtime._primitives || c.blocks.some(b => b.info && runtime._primitives[`${c.id}_${b.info.opcode}`])));
    return new Proxy({}, {
        get (obj, id) {
            if (typeof id !== 'string' || id === 'then') return;
            const category = categories().find(c => c.id === id);
            if (!category) {
                throw new ReferenceError(`The "${id}" extension isn't in this project, add it from the ` +
                    `extension library or call world.useExtension("${id}") first`);
            }
            const hit = cache.get(id);
            if (hit && hit.category === category) return hit.api;
            const api = buildApi(owner, target, category);
            cache.set(id, {category, api});
            return api;
        },
        has (obj, id) { return categories().some(c => c.id === id); },
        ownKeys () { return categories().map(c => c.id); },
        getOwnPropertyDescriptor (obj, id) {
            return categories().some(c => c.id === id) ?
                {enumerable: true, configurable: true, writable: false, value: this.get(obj, id)} :
                undefined;
        }
    });
};
const TS_OF_ARG = {
    number: 'number',
    angle: 'number',
    Boolean: 'boolean',
    string: 'string',
    color: 'string',
    note: 'number',
    matrix: 'string',
    costume: 'string',
    sound: 'string'
};
const tsKey = name => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));
const RESERVED = new Set(('break case catch class const continue debugger default delete do else enum export extends ' +
    'false finally for function if import in instanceof new null return super switch this throw true try typeof var ' +
    'void while with yield let static implements interface package private protected public await arguments eval')
    .split(' '));
const paramName = (name, used) => {
    let p = String(name).toLowerCase()
        .replace(/[^\w$]/g, '_');
    if (!/^[A-Za-z_$]/.test(p)) p = `_${p}`;
    if (RESERVED.has(p)) p = `${p}_`;
    while (used.has(p)) p = `${p}_`;
    used.add(p);
    return p;
};
const docText = text => String(text).replace(/\*\//g, '* /');
const extensionTypes = runtime => {
    const members = [];
    const declarations = [];
    for (const category of runtime._blockInfo) {
        if (!category.id) continue;
        const blocks = callableBlocks(category);
        const custom = customOf(runtime, category.id);
        if (!blocks.length && !custom) continue;
        const lines = blocks.map(({opcode, info, args}) => {
            const used = new Set();
            const params = args.map(name => {
                const spec = info.arguments[name] || {};
                const type = spec.exemptFromNormalization ? 'any' : (TS_OF_ARG[spec.type] || 'any');
                return `${paramName(name, used)}?: ${type}`;
            });
            let returns = 'void | Promise<void>';
            if (info.blockType === 'Boolean') returns = 'boolean';
            else if (REPORTS.has(info.blockType)) returns = 'any';
            const byName = args.map(n => `${tsKey(n)}?: any`).join(', ');
            const named = args.length ? `\n        ${tsKey(opcode)}(args: {${byName}}): ${returns};` : '';
            const doc = `\n        /** "${docText(textOf(info))}" */`;
            return `${doc}\n        ${tsKey(opcode)}(${params.join(', ')}): ${returns};${named}`;
        });
        if (custom && typeof custom.types === 'string') lines.push(`\n        ${custom.types}`);
        if (custom && typeof custom.declarations === 'string') declarations.push(custom.declarations);
        const title = docText(category.name || category.id);
        members.push(`\n    /** The ${title} extension */\n    ${tsKey(category.id)}: {${lines.join('')}\n    };`);
    }
    return `${declarations.join('\n')}\ninterface ExtensionApis {${members.join('')}\n}\n`;
};
const loadImage = url => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Skin.fromURL(): couldn't load the image at "${url}"`));
    img.src = url;
});
const looksLikeSVG = text => /^\s*(<\?xml|<svg)/i.test(text || '');
const restoreTarget = (host, target) => {
    if (!host._skinTargets.delete(target)) return;
    if (!target.isDisposed) target.updateAllDrawableProperties();
};
const skinClassFor = host => {
    if (host._SkinClass) return host._SkinClass;
    const runtime = host.runtime;
    class Skin {
        constructor (kind, source, skinId, owned, name) {
            Object.defineProperty(this, '_kind', {value: kind});
            Object.defineProperty(this, '_source', {value: source});
            Object.defineProperty(this, '_owned', {value: owned});
            this._skinId = skinId;
            this._hitboxOf = null;
            this._disposed = false;
            this.name = name || '';
            host._skins.add(this);
        }
        static async fromURL (url, name) {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Skin.fromURL(): ${response.status} fetching "${url}"`);
            const contentType = (response.headers.get('Content-Type') || '').split(';')[0].trim();
            const isImage = contentType.startsWith('image/') && contentType !== 'image/svg+xml';
            if (!isImage) {
                const text = await response.text();
                if (contentType === 'image/svg+xml' || looksLikeSVG(text)) return Skin.fromSVG(text, name);
            }
            const image = await loadImage(url);
            const skinId = runtime.renderer.createBitmapSkin(image, 1);
            return new Skin('bitmap', url, skinId, true, name);
        }
        static fromSVG (svgText, name) {
            const skinId = runtime.renderer.createSVGSkin(String(svgText));
            return new Skin('svg', String(svgText), skinId, true, name);
        }
        get type () { return this._kind; }
        get source () { return this._kind === 'costume' ? null : this._source; }
        get loaded () {
            const renderSkin = runtime.renderer._allSkins[this._skinId];
            return this._kind !== 'svg' || !renderSkin || Boolean(renderSkin._svgImageLoaded);
        }
        get width () { const renderSkin = runtime.renderer._allSkins[this._skinId]; return renderSkin ? renderSkin.size[0] : 0; }
        get height () { const renderSkin = runtime.renderer._allSkins[this._skinId]; return renderSkin ? renderSkin.size[1] : 0; }
        get rotationCenter () {
            const renderSkin = runtime.renderer._allSkins[this._skinId];
            const c = renderSkin ? renderSkin.rotationCenter : [0, 0];
            return {x: c[0], y: c[1]};
        }
        setRotationCenter (x, y) {
            this._alive();
            const renderSkin = runtime.renderer._allSkins[this._skinId];
            if (!renderSkin) return this;
            renderSkin._rotationCenter[0] = Number(x) || 0;
            renderSkin._rotationCenter[1] = Number(y) || 0;
            renderSkin.emitWasAltered();
            return this;
        }
        get hitbox () { return this._hitboxOf || this; }
        set hitbox (skin) {
            this._alive();
            if (skin !== null && typeof skin !== 'undefined' && !(skin instanceof Skin)) {
                throw new TypeError('hitbox is a Skin, or null to use this skin\'s own shape');
            }
            this._hitboxOf = skin || null;
        }
        get users () {
            const out = [];
            for (const [target, entry] of host._skinTargets) {
                if (entry.skin !== this || target.isDisposed) continue;
                const instance = host.instances.get(target);
                out.push(instance ? instance.wrap(target) : target.getName());
            }
            return out;
        }
        get exists () { return !this._disposed; }
        dispose () {
            if (this._disposed) return;
            this._disposed = true;
            host._skins.delete(this);
            for (const [target, entry] of [...host._skinTargets]) {
                if (entry.skin === this) restoreTarget(host, target);
            }
            if (this._owned) runtime.renderer.destroySkin(this._skinId);
        }
        toString () { return this.name ? `Skin(${this.name})` : `Skin(${this._kind})`; }
        [CAST] () { return this.toString(); }
        _alive () {
            if (this._disposed) throw new Error(`This skin${this.name ? ` ("${this.name}")` : ''} was disposed`);
        }
    }
    host._SkinClass = Skin;
    return Skin;
};
const costumeSkin = (host, target, name) => {
    const index = target.getCostumeIndexByName(String(name));
    if (index < 0) throw new ReferenceError(`${target.getName()} has no costume named "${name}"`);
    const costume = target.getCostumes()[index];
    const Skin = skinClassFor(host);
    return new Skin('costume', `${target.getName()}/${costume.name}`, costume.skinId, false, costume.name);
};
const skinOf = (host, target) => { const entry = host._skinTargets.get(target); return entry ? entry.skin : null; };
const applySkin = (host, target, value) => {
    if (value === null || typeof value === 'undefined') { restoreTarget(host, target); return; }
    const Skin = skinClassFor(host);
    if (!(value instanceof Skin)) {
        throw new TypeError('skin is a Skin (Skin.fromURL/Skin.fromSVG/.skinFromCostume()), or null to restore it');
    }
    value._alive();
    host._skinTargets.set(target, {skin: value});
    host.runtime.renderer.updateDrawableSkinId(target.drawableID, value._skinId);
};
const showHitboxSkins = host => {
    if (!host._skinTargets.size) return;
    const renderer = host.runtime.renderer;
    for (const [target, entry] of host._skinTargets) {
        if (target.isDisposed) continue;
        renderer.updateDrawableSkinId(target.drawableID, entry.skin.hitbox._skinId);
    }
};
const showRealSkins = host => {
    if (!host._skinTargets.size) return;
    const renderer = host.runtime.renderer;
    for (const [target, entry] of host._skinTargets) {
        if (target.isDisposed) continue;
        renderer.updateDrawableSkinId(target.drawableID, entry.skin._skinId);
    }
};
const resetSkins = host => {
    for (const target of [...host._skinTargets.keys()]) restoreTarget(host, target);
};
const forgetSkinTarget = (host, target) => { host._skinTargets.delete(target); };
const disposeAllSkins = host => {
    for (const skin of [...host._skins]) skin.dispose();
    host._skinTargets.clear();
    host._skins.clear();
};
const ID = 'g1nxIrisText';
const STATE_KEY = 'irisText';
const ALIGNS = ['left', 'center', 'right', 'justify'];
const ANIMATED = ['x', 'y', 'rotation', 'opacity', 'scale'];
const EASINGS = ['linear', 'sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ', 'back', 'elastic', 'bounce'];
const TYPING_GROUPS = ['default', 'symbols', 'punctuation', 'numbers'];
const GROUPS = {
    shadow: ['textShadow', ['enabled', 'color', 'opacity', 'blur', 'offsetX', 'offsetY']],
    background: ['textBackground', ['enabled', 'color', 'opacity', 'radius', 'padding']],
    backgroundBorder: ['textBackgroundBorder', ['color', 'size', 'roundness']],
    border: ['textBorder', ['enabled', 'color', 'opacity', 'size']]
};
const onOff = value => (value ? 'on' : 'off');
const extensionOf = runtime => {
    const ext = runtime.ext_irisText;
    if (!ext || !runtime._primitives[`${ID}_setText`]) {
        throw new Error('me.iris needs the Iris Text extension, add it from the extension library first');
    }
    return ext;
};
class IrisCharApi {
    constructor (iris, index) {
        Object.defineProperty(this, '_iris', {value: iris});
        Object.defineProperty(this, 'index', {value: index, enumerable: true});
    }
    get _n () { return this.index + 1; }
    get char () { return this._iris._call('getCharAt', {INDEX: this._n}); }
    get x () { return this._iris._call('getCharX', {INDEX: this._n}); }
    get y () { return this._iris._call('getCharY', {INDEX: this._n}); }
    get width () { return this._iris._call('getCharDimension', {INDEX: this._n, DIMENSION: 'width'}); }
    get height () { return this._iris._call('getCharDimension', {INDEX: this._n, DIMENSION: 'height'}); }
    get hasMask () { return Boolean(this._iris._call('characterHasMask', {INDEX: this._n})); }
    set (props) {
        if (!props || typeof props !== 'object') {
            throw new TypeError('char.set() takes {x, y, rotation, scale, opacity, color}');
        }
        const i = this._iris;
        const INDEX = this._n;
        for (const key of Object.keys(props)) {
            const v = props[key];
            if (key === 'x' || key === 'y') i._call('setCharAxisPos', {INDEX, AXIS: key, VALUE: Cast.toNumber(v)});
            else if (key === 'rotation') i._call('setCharRotation', {INDEX, DEG: Cast.toNumber(v)});
            else if (key === 'scale') i._call('setCharScale', {INDEX, PCT: Cast.toNumber(v)});
            else if (key === 'opacity') i._call('setCharOpacity', {INDEX, PCT: Cast.toNumber(v)});
            else if (key === 'color') {
                if (v === null) i._call('clearCharColor', {INDEX});
                else i._call('setCharColor', {INDEX, COLOR: String(v)});
            } else { throw new TypeError(`char.set(): unknown "${key}", it takes x, y, rotation, scale, opacity, color`); }
        }
        return this;
    }
    move (dx, dy) {
        this._iris._call('changeCharPos', {INDEX: this._n, X: Cast.toNumber(dx), Y: Cast.toNumber(dy)});
        return this;
    }
    turn (degrees) { this._iris._call('changeCharRotation', {INDEX: this._n, DEG: Cast.toNumber(degrees)}); return this; }
    reset () { this._iris._call('resetCharTransform', {INDEX: this._n}); return this; }
    animate (prop, to, seconds, easing = 'linear', direction = 'out') {
        if (!ANIMATED.includes(prop)) throw new TypeError(`char.animate() works on ${ANIMATED.join(', ')}`);
        if (!EASINGS.includes(easing)) throw new TypeError(`easing is one of ${EASINGS.join(', ')}`);
        const dir = String(direction).replace(/[^a-z]+/gi, ' ')
            .trim()
            .toLowerCase();
        if (!['in', 'out', 'in out'].includes(dir)) throw new TypeError('direction is "in", "out" or "in out"');
        return this._iris._run('animateCharNew', {
            INDEX: this._n,
            PROPERTY: prop,
            VALUE: Cast.toNumber(to),
            SECS: Cast.toNumber(seconds),
            EASING: easing,
            DIRECTION: dir,
            WAIT: 'wait'
        });
    }
    stop () { this._iris._call('stopCharAnimations', {INDEX: this._n}); return this; }
    get style () {
        try { return JSON.parse(this._iris._call('getCharacterStyle', {INDEX: this._n})); } catch (e) { return null; }
    }
    set style (value) {
        if (value === null) this._iris._call('resetCharacterStyle', {INDEX: this._n});
        else this._iris._call('setCharacterStyle', {INDEX: this._n, STYLE: JSON.stringify({...this.style, ...value})});
    }
}
class IrisApi {
    constructor (owner, target) {
        Object.defineProperty(this, '_owner', {value: owner});
        Object.defineProperty(this, '_target', {value: target});
    }
    _alive () {
        this._owner.assertAlive();
        if (this._target.isDisposed) throw new Stopped('target deleted');
    }
    _call (opcode, args = {}) {
        this._alive();
        const runtime = this._target.runtime;
        return extensionOf(runtime)[opcode](args, {target: this._target, runtime, thread: null, stackFrame: {}});
    }
    _run (opcode, args) {
        this._alive();
        extensionOf(this._target.runtime);
        return this._owner.runtimeHost.spaces.runBlock(this._owner, this._target, `${ID}_${opcode}`, args, false);
    }
    get _state () { this._call('isTyping'); return this._target.getCustomState(STATE_KEY); }
    _apply (settings) { this._call('applyExportSettings', {SETTINGS: settings, SPRITE: '_myself_'}); }
    show (text) { return this._run('setText', {TEXT: String(toCast(text))}); }
    type (text) { return this._run('typeText', {TEXT: String(toCast(text))}); }
    typeLine (text) { return this._run('typeNewLine', {TEXT: String(toCast(text))}); }
    addLine (text) { this._call('addLine', {TEXT: String(toCast(text))}); return this; }
    hide () { this._call('clearText'); return this; }
    skip () { this._call('skipTyping'); return this; }
    stop () { this._call('stopTyping'); return this; }
    refresh () { return Promise.resolve(this._call('renderNow')); }
    get text () { const state = this._state; return state.visible ? state.typingFullRaw || state.rawText : ''; }
    set text (value) { this.show(value).catch(e => this._owner.reportError(e)); }
    get plainText () { return this._call('getPlainText'); }
    get visible () { return Boolean(this._state.visible); }
    get typing () { return Boolean(this._call('isTyping')); }
    get length () { return this._call('getCharCount'); }
    get width () { return this._call('getExactTextWidth'); }
    get height () { return this._call('getExactTextHeight'); }
    char (index) {
        const i = Math.floor(Cast.toNumber(index));
        if (i < 0) throw new RangeError('char() counts from 0');
        return new IrisCharApi(this, i);
    }
    get chars () { return Array.from({length: this.length}, (_, i) => new IrisCharApi(this, i)); }
    resetChars () { this._call('resetAllCharTransforms'); return this; }
    get color () { return this._state.baseStyle.color; }
    set color (value) { this._call('setBaseColor', {COLOR: String(value)}); }
    get size () { return this._state.baseStyle.size; }
    set size (value) { this._call('setBaseSize', {SIZE: Cast.toNumber(value)}); }
    get font () { return this._state.baseStyle.font; }
    set font (value) { this._call('setFont', {FONT: String(value)}); }
    get align () { return this._state.align; }
    set align (value) {
        if (!ALIGNS.includes(value)) throw new TypeError(`align is one of ${ALIGNS.join(', ')}`);
        this._call('setAlign', {ALIGN: value});
    }
    get bold () { return this._state.baseStyle.bold; }
    set bold (on) { this._apply({baseStyle: {bold: Boolean(on)}}); }
    get italic () { return this._state.baseStyle.italic; }
    set italic (on) { this._apply({baseStyle: {italic: Boolean(on)}}); }
    get underline () { return this._state.baseStyle.underline; }
    set underline (on) { this._apply({baseStyle: {underline: Boolean(on)}}); }
    get strikethrough () { return this._state.baseStyle.strike; }
    set strikethrough (on) { this._apply({baseStyle: {strike: Boolean(on)}}); }
    get letterSpacing () { return this._state.letterSpacing; }
    set letterSpacing (value) { this._call('setLetterSpacing', {SPACE: Cast.toNumber(value)}); }
    get lineHeight () { return this._state.lineSpacing; }
    set lineHeight (value) { this._call('setLineHeight', {HEIGHT: Cast.toNumber(value)}); }
    get maxWidth () { return this._state.maxWidth; }
    set maxWidth (value) { this._apply({maxWidth: value === null ? null : Cast.toNumber(value)}); }
    get maxHeight () { return this._state.maxHeight; }
    set maxHeight (value) { this._apply({maxHeight: value === null ? null : Cast.toNumber(value)}); }
    get smoothing () { return this._state.smoothing; }
    set smoothing (on) { this._call('setSmoothing', {ENABLED: onOff(on)}); }
    get emoji () { return this._state.emojiMode === 2 ? 'native' : 'colored'; }
    set emoji (mode) {
        if (mode !== 'colored' && mode !== 'native') throw new TypeError('emoji is "colored" or "native"');
        this._call('setEmojiMode', {MODE: mode});
    }
    get growDownwardOnly () { return this._state.growDownwardOnly; }
    set growDownwardOnly (on) { this._call('setGrowDownwardOnly', {ENABLED: onOff(on)}); }
    get typingSpeed () {
        const state = this._state;
        return Object.assign({}, state.typingSpeeds, {custom: Object.assign({}, state.customTypingSpeeds)});
    }
    set typingSpeed (value) {
        if (typeof value !== 'object' || value === null) {
            this._call('setAllTypingSpeeds', {SECONDS: Cast.toNumber(value)});
            return;
        }
        for (const key of Object.keys(value)) {
            if (key === 'custom') {
                for (const chars of Object.keys(value.custom || {})) {
                    this._call('setCustomTypingSpeed', {CHARS: chars, SECONDS: Cast.toNumber(value.custom[chars])});
                }
            } else if (TYPING_GROUPS.includes(key)) {
                this._call('setTypingSpeed', {GROUP: key, SECONDS: Cast.toNumber(value[key])});
            } else { throw new TypeError(`typingSpeed: unknown "${key}", it has ${TYPING_GROUPS.join(', ')}, custom`); }
        }
    }
    get settings () { return JSON.parse(this._call('exportSettings')); }
    set settings (value) {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!parsed || typeof parsed !== 'object') throw new TypeError('iris.settings takes an object or its JSON');
        this._apply(parsed);
    }
    on (event, fn) {
        const name = {type: 'iris:type', done: 'iris:done', charanimationdone: 'iris:charanimationdone'}[event];
        if (!name) throw new TypeError('me.iris.on() takes "type", "done" or "charanimationdone"');
        return this._owner.onTarget(this._target, name, null, fn);
    }
}
for (const [prop, [key, fields]] of Object.entries(GROUPS)) {
    Object.defineProperty(IrisApi.prototype, prop, {
        get () { return Object.assign({}, this._state[key]); },
        set (value) {
            const next = typeof value === 'boolean' ? {enabled: value} : value;
            if (!next || typeof next !== 'object') throw new TypeError(`iris.${prop} takes an object or true/false`);
            for (const k of Object.keys(next)) {
                if (!fields.includes(k)) { throw new TypeError(`iris.${prop}: unknown "${k}", it has ${fields.join(', ')}`); }
            }
            this._apply({[key]: next});
        },
        configurable: true
    });
}
const markup = runtime => {
    const call = (opcode, args) => extensionOf(runtime)[opcode](args, {runtime, thread: null, stackFrame: {}});
    return Object.freeze({
        color: (text, color) => call('colorMarkup', {TEXT: text, COLOR: color}),
        gradient: (text, colors, type = 'linear', angle = 0) => call('gradientMarkup',
            {TEXT: text, COLORS: Array.isArray(colors) ? colors.join(',') : colors, TYPE: type, ANGLE: angle}),
        shadow: (text, {color = '#000000', opacity = 50, blur = 8, x = 0, y = 0} = {}) => call('shadowMarkup',
            {TEXT: text, COLOR: color, OPACITY: opacity, BLUR: blur, OFFSET_X: x, OFFSET_Y: y}),
        border: (text, {color = '#000000', opacity = 100, size = 2} = {}) => call('borderMarkup',
            {TEXT: text, COLOR: color, OPACITY: opacity, SIZE: size}),
        style: (text, style) => call('styleMarkup', {TEXT: text, STYLE: style}),
        size: (text, size) => call('sizeMarkup', {TEXT: text, SIZE: size}),
        blur: (text, amount) => call('blurMarkup', {TEXT: text, INTENSITY: amount}),
        font: (text, font) => call('fontMarkup', {TEXT: text, FONT: font}),
        tag: (text, tag) => call('tagMarkup', {TEXT: text, TAG: tag}),
        wait: seconds => call('waitMarkup', {SECONDS: seconds})
    });
};
const IRIS_HATS = {
    [`${ID}_onCharacterType`]: 'iris:type',
    [`${ID}_onTypingFinished`]: 'iris:done',
    [`${ID}_onCharAnimationFinished`]: 'iris:charanimationdone'
};
const irisHatArgs = (opcode, target) => {
    if (opcode !== `${ID}_onCharacterType`) return [];
    const c = target && target._irisTypingChar;
    return c ? [c.char, c.index] : ['', -1];
};
const TARGETS = new WeakMap();
const getRaw = api => TARGETS.get(api) || (api && api._target) || null;
const VARIABLE_TYPES = {vars: Variable.SCALAR_TYPE, lists: Variable.LIST_TYPE};
const SPECIAL_OBJECTS = {edge: '_edge_', mouse: '_mouse_', random: '_random_'};
const isCoordinate = value => typeof value === 'number' ||
    (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
const isColour = value => (typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) ||
    (Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number'));
const rgbList = color => (Array.isArray(color) ? color.slice(0, 3).map(Cast.toNumber) : Cast.toRgbColorList(color));
const tintOf = value => {
    if (value === null || typeof value === 'undefined' || value === '' || value === 'none') return 0xffffff;
    if (typeof value === 'string' && !isColour(value)) {
        throw new TypeError(`tint needs a colour like "#ff0000", got ${JSON.stringify(value)}`);
    }
    if (typeof value === 'number') return Math.max(0, Math.min(0xffffff, Math.round(value)));
    const [r, g, b] = rgbList(value).map(n => Math.max(0, Math.min(255, Math.round(n))));
    return (r << 16) | (g << 8) | b;
};
const newVariableId = () => `bs_${Date.now().toString(36)}_${Math.random().toString(36)
    .slice(2, 8)}`;
const isIndex = key => typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key);
const listProxy = variable => {
    const changed = () => { variable._monitorUpToDate = false; };
    return new Proxy([], {
        get: (shell, key) => Reflect.get(variable.value, key),
        set: (shell, key, value) => { variable.value[key] = isIndex(key) ? toCast(value) : value; changed(); return true; },
        has: (shell, key) => key in variable.value,
        deleteProperty: (shell, key) => { delete variable.value[key]; changed(); return true; },
        ownKeys: () => Reflect.ownKeys(variable.value),
        getOwnPropertyDescriptor: (shell, key) => {
            if (key === 'length') { return {...Reflect.getOwnPropertyDescriptor(shell, 'length'), value: variable.value.length}; }
            return Reflect.getOwnPropertyDescriptor(variable.value, key);
        },
        defineProperty: (shell, key, descriptor) => {
            Object.defineProperty(variable.value, key, descriptor);
            changed();
            return true;
        }
    });
};
const variableProxy = (owner, target, kind, skipStage) => {
    const type = VARIABLE_TYPES[kind];
    const lookup = name => target.lookupVariableByNameAndType(String(name), type, skipStage);
    const describe = name => `${kind === 'lists' ? 'list' : 'variable'} "${String(name)}"`;
    const api = {
        declare (name, value, {scope = 'sprite'} = {}) {
            const into = scope === 'global' || scope === 'cloud' || target.isStage ?
                target.runtime.getTargetForStage() :
                target;
            let variable = into.lookupVariableByNameAndType(String(name), type, true);
            if (!variable) {
                const isCloud = scope === 'cloud';
                const cloudName = isCloud && !String(name).startsWith('☁ ') ? `☁ ${name}` : String(name);
                into.createVariable(newVariableId(), cloudName, type, isCloud);
                variable = into.lookupVariableByNameAndType(cloudName, type, true);
                if (typeof value !== 'undefined') {
                    variable.value = type === Variable.LIST_TYPE ? Array.from(value, toCast) : toCast(value);
                }
                target.runtime.requestBlocksUpdate();
            }
            return type === Variable.LIST_TYPE ? listProxy(variable) : variable.value;
        },
        has: name => Boolean(lookup(name))
    };
    const handler = {
        get (obj, name) {
            if (typeof name !== 'string') return;
            if (Object.prototype.hasOwnProperty.call(obj, name)) return obj[name];
            const variable = lookup(name);
            if (!variable) return;
            return type === Variable.LIST_TYPE ? listProxy(variable) : variable.value;
        },
        set (obj, name, value) {
            owner.assertAlive();
            const variable = lookup(name);
            if (!variable) {
                throw new ReferenceError(`No ${describe(name)}, make it in the Variables ` +
                    `palette or with .declare("${String(name)}", value)`);
            }
            if (type === Variable.LIST_TYPE) {
                if (!value || typeof value[Symbol.iterator] !== 'function') {
                    throw new TypeError(`${describe(name)} can only be set to an array`);
                }
                variable.value = Array.from(value, toCast);
            } else {
                variable.value = toCast(value);
                if (variable.isCloud && target.runtime.ioDevices.cloud) {
                    target.runtime.ioDevices.cloud.requestUpdateVariable(variable.name, variable.value);
                }
            }
            variable._monitorUpToDate = false;
            return true;
        },
        has: (obj, name) => typeof name === 'string' && Boolean(lookup(name)),
        ownKeys: () => {
            const names = new Set();
            const collect = t => Object.values(t.variables).forEach(v => {
                if (v.type === type) names.add(v.name);
            });
            collect(target);
            if (!skipStage && !target.isStage) collect(target.runtime.getTargetForStage());
            return [...names];
        },
        getOwnPropertyDescriptor: (obj, name) => {
            if (typeof name !== 'string' || !lookup(name)) return;
            return {enumerable: true, configurable: true, writable: true, value: handler.get(obj, name)};
        }
    };
    return new Proxy(api, handler);
};
class TargetApi {
    constructor (owner, target) {
        TARGETS.set(this, target);
        Object.defineProperty(this, '_owner', {value: owner});
        Object.defineProperty(this, '_target', {value: target});
        this.effects = new Proxy({}, {
            get: (obj, name) => {
                if (name === 'clear') return () => { this._alive(); target.clearEffects(); };
                return target.effects[name];
            },
            set: (obj, name, value) => { this._alive(); target.setEffect(name, Cast.toNumber(value)); return true; }
        });
        this.vars = variableProxy(owner, target, 'vars', target.isStage);
        this.lists = variableProxy(owner, target, 'lists', target.isStage);
    }
    _alive () {
        this._owner.assertAlive();
        if (this._target.isDisposed) throw new Stopped('target deleted');
    }
    get name () { return this._target.getName(); }
    get id () { return this._target.id; }
    get isStage () { return this._target.isStage; }
    get isClone () { return !this._target.isOriginal; }
    get exists () { return !this._target.isDisposed; }
    get original () { const target = this._target.sprite.clones[0] || this._target; return this._owner.wrap(target); }
    get parent () {
        const parent = this._owner.runtimeHost.parentOf(this._target);
        return parent ? this._owner.wrap(parent) : null;
    }
    get clones () {
        return this._target.sprite.clones.filter(t => !t.isOriginal)
            .map(t => this._owner.wrap(t));
    }
    get scenes () {
        const host = scenesOf(this._owner);
        return host.scenesOf(this._target).map(id => sceneApiFor(this._owner, host.scene(id)));
    }
    set scenes (value) {
        this._alive();
        const host = scenesOf(this._owner);
        if (value === 'all') host.setMembership(this._target, '*');
        else host.setMembership(this._target, [...new Set([].concat(value).map(v => sceneRecord(this._owner, v).id))]);
    }
    inScene (scene) { return scenesOf(this._owner).inScene(this._target, sceneRecord(this._owner, scene).id); }
    addToScene (scene) { this._alive(); scenesOf(this._owner).addTo(this._target, sceneRecord(this._owner, scene).id); }
    removeFromScene (scene) { this._alive(); scenesOf(this._owner).removeFrom(this._target, sceneRecord(this._owner, scene).id); }
    get x () { return this._target.x; }
    set x (value) { this._alive(); this._target.setXY(Cast.toNumber(value), this._target.y); }
    get y () { return this._target.y; }
    set y (value) { this._alive(); this._target.setXY(this._target.x, Cast.toNumber(value)); }
    get angle () { return this._target.direction; }
    set angle (value) { this._alive(); this._target.setDirection(Cast.toNumber(value)); }
    get rotationStyle () { return this._target.rotationStyle; }
    set rotationStyle (value) { this._alive(); this._target.setRotationStyle(value); }
    get draggable () { return this._target.draggable; }
    set draggable (value) { this._alive(); this._target.setDraggable(Boolean(value)); }
    goTo (x, y) {
        this._alive();
        const point = typeof x === 'number' || typeof y !== 'undefined' ?
            {x: Cast.toNumber(x), y: Cast.toNumber(y)} :
            this._pointOf(x);
        this._target.setXY(point.x, point.y);
        return this;
    }
    move (steps) {
        this._alive();
        const radians = (90 - this._target.direction) * Math.PI / 180;
        const n = Cast.toNumber(steps);
        this._target.setXY(this._target.x + (n * Math.cos(radians)), this._target.y + (n * Math.sin(radians)));
        return this;
    }
    turn (degrees) { this._alive(); this._target.setDirection(this._target.direction + Cast.toNumber(degrees)); return this; }
    pointAt (thing, y) {
        this._alive();
        const point = typeof thing === 'number' ? {x: thing, y: Cast.toNumber(y)} : this._pointOf(thing);
        const dx = point.x - this._target.x;
        const dy = point.y - this._target.y;
        this._target.setDirection(90 - (Math.atan2(dy, dx) * 180 / Math.PI));
        return this;
    }
    async glide (seconds, x, y, easing) {
        const xy = isCoordinate(x) && isCoordinate(y);
        const to = xy ? {x: Cast.toNumber(x), y: Cast.toNumber(y)} : this._pointOf(x);
        const ease = easingOf(xy ? easing : y);
        const from = {x: this._target.x, y: this._target.y};
        const duration = Math.max(0, Cast.toNumber(seconds));
        const clock = this._owner.runtimeHost.clock;
        const start = clock.now;
        for (;;) {
            this._alive();
            const t = duration === 0 ? 1 : Math.min(1, (clock.now - start) / duration);
            const e = ease(t);
            this._target.setXY(from.x + ((to.x - from.x) * e), from.y + ((to.y - from.y) * e));
            if (t >= 1) return;
            await clock.nextFrame(this._owner);
        }
    }
    distanceTo (thing, y) {
        const point = typeof thing === 'number' ? {x: thing, y: Cast.toNumber(y)} : this._pointOf(thing);
        return Math.hypot(point.x - this._target.x, point.y - this._target.y);
    }
    _pointOf (thing) {
        const runtime = this._target.runtime;
        if (thing instanceof TargetApi) { const other = getRaw(thing); return {x: other.x, y: other.y}; }
        if (thing && typeof thing === 'object' && 'x' in thing && 'y' in thing) {
            return {x: Cast.toNumber(thing.x), y: Cast.toNumber(thing.y)};
        }
        if (thing === 'mouse') { return {x: runtime.ioDevices.mouse.getScratchX(), y: runtime.ioDevices.mouse.getScratchY()}; }
        if (thing === 'random') {
            return {
                x: Math.round(runtime.stageWidth * (Math.random() - 0.5)),
                y: Math.round(runtime.stageHeight * (Math.random() - 0.5))
            };
        }
        const other = runtime.getSpriteTargetByName(String(thing));
        if (!other) throw new ReferenceError(`No sprite named "${thing}"`);
        return {x: other.x, y: other.y};
    }
    get position () { const t = this._target; return new Position(t.x, t.y, t.direction, t.size, t.stretch[0], t.stretch[1]); }
    set position (value) {
        this._alive();
        const t = this._target;
        if (t.isStage) throw new TypeError('The stage has no position');
        const p = Position.from(value);
        t.setXY(p.x, p.y);
        t.setDirection(p.direction);
        t.setSize(p.size);
        t.setStretch(p.stretchX, p.stretchY);
    }
    get size () { return this._target.size; }
    set size (value) { this._alive(); this._target.setSize(Cast.toNumber(value)); }
    get stretchX () { return this._target.stretch[0]; }
    set stretchX (value) { this._alive(); this._target.setStretch(Cast.toNumber(value), this._target.stretch[1]); }
    get stretchY () { return this._target.stretch[1]; }
    set stretchY (value) { this._alive(); this._target.setStretch(this._target.stretch[0], Cast.toNumber(value)); }
    get visible () { return this._target.visible; }
    set visible (value) { this._alive(); this._target.setVisible(Boolean(value)); }
    get tint () {
        const v = this._target.effects.tintColor;
        const n = typeof v === 'number' && v > 0 ? v - 1 : 0xffffff;
        return `#${n.toString(16).padStart(6, '0')}`;
    }
    set tint (value) { this._alive(); this._target.setEffect('tintColor', tintOf(value) + 1); }
    get layer () { return this._target.getLayerOrder(); }
    set layer (value) { this._alive(); this._target.goForwardLayers(Cast.toNumber(value) - this._target.getLayerOrder()); }
    get costume () { const costume = this._target.getCurrentCostume(); return costume ? costume.name : ''; }
    set costume (value) { this.setCostume(value); }
    get costumeIndex () { return this._target.currentCostume; }
    set costumeIndex (value) { this.setCostume(Cast.toNumber(value)); }
    get costumes () { return this._target.getCostumes().map(c => c.name); }
    setCostume (nameOrIndex) {
        this._alive();
        if (typeof nameOrIndex === 'number') {
            const count = this._target.getCostumes().length;
            this._target.setCostume(((Math.round(nameOrIndex) % count) + count) % count);
            return this;
        }
        const index = this._target.getCostumeIndexByName(String(nameOrIndex));
        if (index < 0) throw new ReferenceError(`${this.name} has no costume named "${nameOrIndex}"`);
        this._target.setCostume(index);
        return this;
    }
    nextCostume () { return this.setCostume(this._target.currentCostume + 1); }
    get skin () { return skinOf(this._owner.runtimeHost, this._target); }
    set skin (value) { this._alive(); applySkin(this._owner.runtimeHost, this._target, value); }
    skinFromCostume (name) { return costumeSkin(this._owner.runtimeHost, this._target, name); }
    say (message, seconds) { return this._bubble('say', message, seconds); }
    think (message, seconds) { return this._bubble('think', message, seconds); }
    _bubble (type, message, seconds) {
        this._alive();
        const text = typeof message === 'undefined' ? '' : String(toCast(message));
        this._target.runtime.emit('SAY', this._target, type, text);
        if (typeof seconds === 'undefined') return Promise.resolve();
        const usage = () => { const state = this._target.getCustomState('Scratch.looks'); return state ? state.usageId : null; };
        const said = usage();
        return this._owner.runtimeHost.clock.wait(this._owner, seconds).then(() => {
            if (!this._target.isDisposed && usage() === said) this._target.runtime.emit('SAY', this._target, type, '');
        });
    }
    touching (thing) {
        const target = this._target;
        if (isColour(thing)) return this.touchingColor(thing);
        if (thing instanceof TargetApi) {
            const other = getRaw(thing);
            const renderer = target.runtime.renderer;
            if (!renderer || other.isDisposed || other === target) return false;
            return renderer.isTouchingDrawables(target.drawableID, [other.drawableID]);
        }
        const name = SPECIAL_OBJECTS[thing] || String(thing);
        return target.isTouchingObject(name);
    }
    touchingAtAll (thing) {
        if (thing instanceof TargetApi) {
            const other = getRaw(thing);
            return !other.isDisposed && touchingAtAll(this._target, other);
        }
        return touchingAtAll(this._target, SPECIAL_OBJECTS[thing] || String(thing));
    }
    touchingAll (spriteName) {
        const target = this._target;
        const other = target.runtime.getSpriteTargetByName(String(spriteName));
        const renderer = target.runtime.renderer;
        if (!other || !renderer) return [];
        return other.sprite.clones
            .filter(t => t !== target && renderer.isTouchingDrawables(target.drawableID, [t.drawableID]))
            .map(t => this._owner.wrap(t));
    }
    touchingColor (color) { return this._target.isTouchingColor(rgbList(color)); }
    colorTouching (color, otherColor) { return this._target.colorIsTouchingColor(rgbList(color), rgbList(otherColor)); }
    clone () {
        this._alive();
        const target = this._target;
        if (target.isStage) throw new TypeError('The stage can\'t be cloned');
        const clone = target.makeClone();
        if (!clone) return null;
        target.runtime.addTarget(clone);
        clone.goBehindOther(target);
        return this._owner.wrap(clone);
    }
    delete () {
        const target = this._target;
        if (target.isOriginal) throw new TypeError(`delete() only works on clones, ${this.name} is the original`);
        if (target.isDisposed) return;
        target.runtime.disposeTarget(target);
        target.runtime.stopForTarget(target);
    }
    get sound () {
        if (!this._sound) this._sound = new SoundApi(this._owner, this._target);
        return this._sound;
    }
    get pen () {
        requireExtension(this._target.runtime, 'pen', 'Pen');
        if (!this._pen) this._pen = new PenApi(this._owner, this._target);
        return this._pen;
    }
    get camera () { requireExtension(this._target.runtime, 'pmCamera', 'Camera'); return this._target.cameraBound; }
    set camera (name) {
        requireExtension(this._target.runtime, 'pmCamera', 'Camera');
        this._alive();
        const screen = name instanceof CameraApi ? name.name : name;
        if (screen === null || typeof screen === 'undefined') { this._target.removeCameraBinding(); } else { this._target.bindToCamera(String(screen)); }
    }
    get animations () { return animationsIn(this._owner, this._target.sprite); }
    animation (thing) { return animationOf(this._owner, this._target, thing); }
    get animator () {
        if (this._target.isStage) throw new TypeError('The stage can\'t play animations, a sprite can');
        if (!this._animator) { Object.defineProperty(this, '_animator', {value: new AnimatorApi(this._owner, this._target)}); }
        return this._animator;
    }
    get iris () {
        if (!this._iris) Object.defineProperty(this, '_iris', {value: new IrisApi(this._owner, this._target)});
        return this._iris;
    }
    get extensions () {
        if (!this._extensions) { Object.defineProperty(this, '_extensions', {value: extensionsApi(this._owner, this._target)}); }
        return this._extensions;
    }
    ask (question) { return ask(this._owner, this._target, question); }
    block (opcode, args) { return this._owner.runtimeHost.spaces.runBlock(this._owner, this._target, opcode, args, false); }
    reporter (opcode, args) { return this._owner.runtimeHost.spaces.runBlock(this._owner, this._target, opcode, args, true); }
    ext (extensionId) { return extensionProxy(this._owner, this._target, String(extensionId)); }
    blockspace (id) {
        const ref = this._owner.runtimeHost.spaces.refFor(this._target.sprite, String(id));
        if (!ref) throw new ReferenceError(`${this.name} has no blockspace "${id}"`);
        return ref;
    }
    run (blockspace, ...args) { return this._owner.runtimeHost.spaces.run(this._owner, blockspace, this._target, args); }
    runWith (blockspace, options, ...args) {
        return this._owner.runtimeHost.spaces.run(this._owner, blockspace, this._target, args, options || {});
    }
    hold (defaults, options) { return this._owner.runtimeHost.holdStoreFor(this._target).hold(defaults, options); }
    tween (to, seconds, options) { this._alive(); return startTween(this._owner, this, to, seconds, options); }
    expose (name, fn) { return this._owner.expose(this._target, name, fn); }
    on (event, filter, fn) { return this._owner.onTarget(this._target, event, filter, fn); }
    once (event, filter, options) {
        this._alive();
        return this._owner.once(this._target, event, typeof filter === 'undefined' ? null : filter, options);
    }
    sync (props, options) {
        this._alive();
        const target = this._target;
        if (target.isStage) {
            throw new TypeError('me.sync(): the stage can\'t be synced, use world.cloud or world.server.relay');
        }
        if (!target.isOriginal || this._owner.runtimeHost.ghostInfo(target)) return new InertSync('clone');
        return new SyncHandle(this._owner, target, props, options || {});
    }
    get remote () {
        const info = this._owner.runtimeHost.ghostInfo(this._target);
        if (!info || !info.ghost) return null;
        return {
            player: info.player,
            extra: info.ghost.extra,
            get ago () {
                const nowMs = typeof performance === 'undefined' ? Date.now() : performance.now();
                return Math.max(0, nowMs - info.ghost.lastSeen) / 1000;
            },
            sync: info.sync
        };
    }
    after (seconds, fn) {
        this._alive();
        if (typeof fn !== 'function') throw new TypeError('me.after() needs a function');
        return this._owner.runtimeHost.clock.timer(this._owner, seconds, fn, false);
    }
    every (seconds, fn) {
        this._alive();
        if (typeof fn !== 'function') throw new TypeError('me.every() needs a function');
        return this._owner.runtimeHost.clock.timer(this._owner, seconds, fn, true);
    }
}
const targetProxy = api => {
    const host = api._owner.runtimeHost;
    return withValues(api, {
        values: () => host.targetValues(api._target),
        set: (name, value) => { api._owner.assertAlive(); host.setTargetValue(api._target, name, value); },
        label: obj => (obj._target === obj._owner.target ? 'me' : obj._target.getName())
    });
};
const TARGET_BUILT_IN_NAMES = [
    ...Object.getOwnPropertyNames(TargetApi.prototype),
    'effects', 'vars', 'lists', '_owner', '_target', '_sound', '_pen', '_animator', '_extensions', '_iris'
].filter(name => name !== 'constructor');
class BlockOwner {
    constructor (host, target) {
        this.runtimeHost = host;
        this.target = target;
        this.alive = true;
        this._wrapped = new Map();
    }
    wrap (target) {
        if (!target) return null;
        let api = this._wrapped.get(target);
        if (!api) { api = targetProxy(new TargetApi(this, target)); this._wrapped.set(target, api); }
        return api;
    }
    assertAlive () {
    }
    invoke (fn, ...args) {
        try {
            const result = fn(...args);
            if (result && typeof result.then === 'function') result.then(null, e => this.reportError(e));
            return true;
        } catch (e) { this.reportError(e); return false; }
    }
    invokeAs (label, fn, ...args) { return this.invoke(fn, ...args); }
    invokeForResultAs (label, fn, ...args) { return this.invokeForResult(fn, ...args); }
    invokeForResult (fn, ...args) {
        try { return Promise.resolve(fn(...args)).then(null, e => this.reportError(e)); } catch (e) { this.reportError(e); return Promise.resolve(); }
    }
    reportError (error) {
        if (error instanceof Stopped) return;
        const text = error && error.name && error.message ? `${error.name}: ${error.message}` : String(error);
        this.runtimeHost.emitLog(this.target, 'error', text, null);
    }
    callerLine () { return null; }
}
const OPCODES = {
    whenCalled: 'event_dimod_blockspace_whencalled',
    argument: 'event_dimod_blockspace_argument',
    returnValue: 'event_dimod_blockspace_return',
    yieldValue: 'event_dimod_blockspace_yield',
    worldValue: 'event_dimod_world_value',
    setWorldValue: 'event_dimod_world_setvalue',
    changeWorldValue: 'event_dimod_world_changevalue',
    myValue: 'event_dimod_my_value',
    setMyValue: 'event_dimod_my_setvalue',
    changeMyValue: 'event_dimod_my_changevalue',
    callJS: 'event_dimod_calljs',
    callJSReporter: 'event_dimod_calljs_reporter',
    callBlockspace: 'event_dimod_callblockspace',
    callBlockspaceReporter: 'event_dimod_callblockspace_reporter',
    tween: 'event_dimod_tween',
    callJSMenu: 'event_dimod_calljs_menu',
    blockspaceMenu: 'event_dimod_blockspace_menu',
    spriteMenu: 'event_dimod_sprite_menu',
    tweenPropMenu: 'event_dimod_tweenprop_menu',
    easingMenu: 'event_dimod_easing_menu'
};
const ARG_BLOCKS = [OPCODES.callJS, OPCODES.callJSReporter, OPCODES.callBlockspace, OPCODES.callBlockspaceReporter];
const argInputName = i => (i === 0 ? 'ARG' : `ARG${i}`);
const argCountOf = mutation => { const n = mutation && Number(mutation.argcount); return Number.isInteger(n) && n >= 0 ? n : 1; };
const argValues = args => {
    const values = [];
    for (let i = 0; Object.prototype.hasOwnProperty.call(args, argInputName(i)); i++) { values.push(args[argInputName(i)]); }
    return values;
};
const TWEEN_PROPERTIES = {
    'x': 'x',
    'y': 'y',
    'direction': 'angle',
    'size': 'size',
    'stretch x': 'stretchX',
    'stretch y': 'stretchY',
    'ghost': 'effects.ghost',
    'color': 'effects.color',
    'brightness': 'effects.brightness',
    'fisheye': 'effects.fisheye',
    'whirl': 'effects.whirl',
    'pixelate': 'effects.pixelate',
    'mosaic': 'effects.mosaic',
    'volume': 'sound.volume',
    'pitch': 'sound.pitch',
    'pan': 'sound.pan'
};
const installBlockSpaceBlocksVM = vm => {
    if (vm.__dimodBlockSpaceInstalled) return;
    vm.__dimodBlockSpaceInstalled = true;
    const runtime = vm.runtime;
    runtime._primitives[OPCODES.whenCalled] = () => true;
    runtime._primitives[OPCODES.argument] = (args, util) => {
        const run = util.thread && util.thread.dimodRun;
        if (!run) return '';
        return Object.prototype.hasOwnProperty.call(run.args, args.NAME) ? run.args[args.NAME] : '';
    };
    runtime._primitives[OPCODES.returnValue] = (args, util) => {
        const run = util.thread && util.thread.dimodRun;
        if (run) run._return(args.VALUE);
        util.stopThisScript();
    };
    runtime._primitives[OPCODES.yieldValue] = (args, util) => {
        const run = util.thread && util.thread.dimodRun;
        if (run) run._yield(args.VALUE);
    };
    const host = () => runtime.dimodBlockspace;
    const name = args => Cast.toString(args.NAME);
    const read = value => (typeof value === 'undefined' ? '' : toCast(value));
    runtime._primitives[OPCODES.worldValue] = args => read(host().worldValues[name(args)]);
    runtime._primitives[OPCODES.setWorldValue] = args => { host().setWorldValue(name(args), args.VALUE); };
    runtime._primitives[OPCODES.changeWorldValue] = args => {
        const key = name(args);
        host().setWorldValue(key, Cast.toNumber(host().worldValues[key]) + Cast.toNumber(args.VALUE));
    };
    runtime._primitives[OPCODES.myValue] = (args, util) => read(host().targetValues(util.target)[name(args)]);
    runtime._primitives[OPCODES.setMyValue] = (args, util) => { host().setTargetValue(util.target, name(args), args.VALUE); };
    runtime._primitives[OPCODES.changeMyValue] = (args, util) => {
        const key = name(args);
        const values = host().targetValues(util.target);
        host().setTargetValue(util.target, key, Cast.toNumber(values[key]) + Cast.toNumber(args.VALUE));
    };
    const callJS = (args, util) => host().callExposed(util.target, name(args), argValues(args));
    runtime._primitives[OPCODES.callJSReporter] = callJS;
    runtime._primitives[OPCODES.callJS] = (args, util) => {
        const result = callJS(args, util);
        if (result && typeof result.then === 'function') return result.then(() => {});
    };
    const callBlockspace = (args, util) =>
        host().callBlockspaceForBlock(util.target, Cast.toString(args.SPRITE), Cast.toString(args.ID), argValues(args));
    runtime._primitives[OPCODES.callBlockspaceReporter] = callBlockspace;
    runtime._primitives[OPCODES.callBlockspace] = (args, util) => {
        const result = callBlockspace(args, util);
        if (result && typeof result.then === 'function') return result.then(() => {});
    };
    runtime._primitives[OPCODES.tween] = (args, util) => {
        const prop = Cast.toString(args.PROP).trim();
        const path = Object.prototype.hasOwnProperty.call(TWEEN_PROPERTIES, prop.toLowerCase()) ?
            TWEEN_PROPERTIES[prop.toLowerCase()] :
            prop;
        return host().tweenForBlock(util.target, util.thread, path, args.VALUE, Cast.toNumber(args.SECS),
            Cast.toString(args.EASING));
    };
    runtime._hats[OPCODES.whenCalled] = {restartExistingThreads: false};
    compatBlocks.outputBlocks.push(OPCODES.argument, OPCODES.worldValue, OPCODES.myValue,
        OPCODES.callJSReporter, OPCODES.callBlockspaceReporter);
    compatBlocks.statementBlocks.push(OPCODES.returnValue, OPCODES.yieldValue, OPCODES.setWorldValue,
        OPCODES.changeWorldValue, OPCODES.setMyValue, OPCODES.changeMyValue, OPCODES.callJS,
        OPCODES.callBlockspace, OPCODES.tween);
};
const isIdentStart = c => /[A-Za-z_$]/.test(c);
const isIdent$1 = c => /[A-Za-z0-9_$]/.test(c);
const isSpace = c => /\s/.test(c);
const REGEX_AFTER_CHARS = '(,=:[!&|?{};+-*%<>~^';
const REGEX_AFTER_WORDS = ['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'throw', 'case', 'do', 'else', 'yield', 'await'];
const skipString = (src, i) => {
    const quote = src[i];
    for (i++; i < src.length; i++) {
        if (src[i] === '\\') { i++; } else if (src[i] === quote || (src[i] === '\n' && quote !== '`')) { return i + 1; }
    }
    return i;
};
const skipComment = (src, i) => {
    if (src[i + 1] === '/') { const end = src.indexOf('\n', i); return end < 0 ? src.length : end; }
    const end = src.indexOf('*/', i + 2);
    return end < 0 ? src.length : end + 2;
};
const skipRegex = (src, i) => {
    let inClass = false;
    for (i++; i < src.length; i++) {
        const c = src[i];
        if (c === '\\') { i++; } else if (c === '[') { inClass = true; } else if (c === ']') { inClass = false; } else if (c === '/' && !inClass) {
            i++;
            while (i < src.length && isIdent$1(src[i])) i++;
            return i;
        } else if (c === '\n') { return i; }
    }
    return i;
};
const skipSpaceAndComments = (src, i) => {
    for (;;) {
        while (i < src.length && isSpace(src[i])) i++;
        if (src[i] === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) { i = skipComment(src, i); } else { return i; }
    }
};
const skipJsonObject = (src, i) => {
    let depth = 0;
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === '"') { i = skipString(src, i) - 1; } else if (c === '{' || c === '[') { depth++; } else if (c === '}' || c === ']') {
            depth--;
            if (depth === 0) return i + 1;
        }
    }
    return -1;
};
const readStringLiteral = (src, i) => {
    const end = skipString(src, i);
    const raw = src.slice(i, end);
    try {
        if (raw[0] === '"') return {value: JSON.parse(raw), end};
        if (raw[0] === '\'') {
            const body = raw.slice(1, -1).replace(/\\'/g, '\'')
                .replace(/"/g, '\\"');
            return {value: JSON.parse(`"${body}"`), end};
        }
    } catch (e) { return null; }
    return null;
};
const parseCall = (src, start, open) => {
    const call = {
        start,
        end: -1,
        id: null,
        idStart: -1,
        idEnd: -1,
        payload: null,
        payloadStart: -1,
        payloadEnd: -1,
        hasPayloadArg: false
    };
    let i = skipSpaceAndComments(src, open + 1);
    if (src[i] === '"' || src[i] === '\'') {
        const literal = readStringLiteral(src, i);
        if (literal) {
            call.id = literal.value;
            call.idStart = i;
            call.idEnd = literal.end;
            i = skipSpaceAndComments(src, literal.end);
            if (src[i] === ',') {
                i = skipSpaceAndComments(src, i + 1);
                call.hasPayloadArg = src[i] !== ')' && i < src.length;
                if (src[i] === '{') {
                    const end = skipJsonObject(src, i);
                    if (end > 0) {
                        try {
                            call.payload = JSON.parse(src.slice(i, end));
                            call.payloadStart = i;
                            call.payloadEnd = end;
                        } catch (e) {
                        }
                        i = skipSpaceAndComments(src, end);
                        if (src[i] === ',') i = skipSpaceAndComments(src, i + 1);
                    }
                }
            }
        }
    }
    let depth = 0;
    for (let j = open; j < src.length; j++) {
        const c = src[j];
        if (c === '"' || c === '\'' || c === '`') {
            j = skipString(src, j) - 1;
        } else if (c === '/' && (src[j + 1] === '/' || src[j + 1] === '*')) { j = skipComment(src, j) - 1; } else if (c === '(') { depth++; } else if (c === ')') {
            depth--;
            if (depth === 0) { call.end = j + 1; break; }
        }
    }
    return call;
};
const findBlockspaces = src => {
    const found = [];
    let prevChar = '';
    let prevWord = '';
    const templateDepths = [];
    let depth = 0;
    for (let i = 0; i < src.length;) {
        const c = src[i];
        if (isSpace(c)) { i++; continue; }
        if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) { i = skipComment(src, i); continue; }
        if (c === '"' || c === '\'') {
            i = skipString(src, i);
            prevChar = c;
            prevWord = '';
            continue;
        }
        if (c === '`' || (c === '}' && templateDepths.length && templateDepths[templateDepths.length - 1] === depth)) {
            if (c === '}') templateDepths.pop();
            let j = i + 1;
            for (; j < src.length; j++) {
                if (src[j] === '\\') { j++; } else if (src[j] === '`') { j++; break; } else if (src[j] === '$' && src[j + 1] === '{') { templateDepths.push(depth); j += 2; break; }
            }
            i = j;
            prevChar = '`';
            prevWord = '';
            continue;
        }
        if (c === '/') {
            const regexAllowed = prevChar === '' || REGEX_AFTER_CHARS.includes(prevChar) ||
                (prevWord && REGEX_AFTER_WORDS.includes(prevWord));
            if (regexAllowed) {
                i = skipRegex(src, i);
                prevChar = '/';
                prevWord = '';
                continue;
            }
        }
        if (isIdentStart(c)) {
            let j = i + 1;
            while (j < src.length && isIdent$1(src[j])) j++;
            const word = src.slice(i, j);
            if (word === 'new' && prevChar !== '.') {
                const k = skipSpaceAndComments(src, j);
                if (src.startsWith('Blockspace', k) && !isIdent$1(src[k + 10] || '')) {
                    const open = skipSpaceAndComments(src, k + 10);
                    if (src[open] === '(') {
                        const call = parseCall(src, i, open);
                        found.push(call);
                        if (call.end > 0) {
                            i = call.end;
                            prevChar = ')';
                            prevWord = '';
                            continue;
                        }
                    }
                }
            }
            prevWord = word;
            prevChar = 'a';
            i = j;
            continue;
        }
        if (c === '{') depth++;
        if (c === '}') depth--;
        prevChar = c;
        prevWord = '';
        i++;
    }
    return found;
};
const stringifyPayload = payload => JSON.stringify(payload);
const applyEdits = (src, edits) => {
    const sorted = [...edits].sort((a, b) => b.start - a.start);
    let out = src;
    for (const edit of sorted) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    return out;
};
const payloadEdit = (call, payload) => {
    const text = stringifyPayload(payload);
    if (call.payloadStart >= 0) return {start: call.payloadStart, end: call.payloadEnd, text};
    return {start: call.idEnd, end: call.idEnd, text: `, ${text}`};
};
const THREAD_DONE = 4;
const EMPTY_PAYLOAD = () => ({params: [], blocks: {}, comments: {}, ext: []});
const normalizePayload = payload => {
    const p = payload && typeof payload === 'object' ? payload : {};
    return {
        params: Array.isArray(p.params) ? p.params.map(String) : [],
        blocks: p.blocks && typeof p.blocks === 'object' ? p.blocks : {},
        comments: p.comments && typeof p.comments === 'object' ? p.comments : {},
        ext: Array.isArray(p.ext) ? p.ext.map(String) : []
    };
};
const clone = value => JSON.parse(JSON.stringify(value));
const ARG_INPUT = /^ARG(\d+)$/;
const shapeHat = (hat, id, params, blocks) => {
    hat.fields.ID = {name: 'ID', value: id};
    delete hat.fields.PARAMS;
    hat.mutation = {tagName: 'mutation', children: [], params: JSON.stringify(params)};
    const argInputs = Object.keys(hat.inputs).filter(name => ARG_INPUT.test(name));
    const inPlace = argInputs.length === params.length && params.every((param, i) => {
        const input = hat.inputs[`ARG${i}`];
        const reporter = input && input.shadow && blocks.get(input.shadow);
        return reporter && reporter.opcode === OPCODES.argument &&
            reporter.fields.NAME && reporter.fields.NAME.value === param;
    });
    if (inPlace) return;
    for (const name of argInputs) {
        const input = hat.inputs[name];
        if (input.block && input.block !== input.shadow) blocks.remove(input.block);
        if (input.shadow) blocks.remove(input.shadow);
        delete hat.inputs[name];
    }
    params.forEach((param, i) => {
        const reporterId = uid();
        blocks.create({
            id: reporterId,
            opcode: OPCODES.argument,
            next: null,
            parent: hat.id,
            inputs: {},
            fields: {NAME: {name: 'NAME', value: param}},
            shadow: true,
            topLevel: false
        });
        hat.inputs[`ARG${i}`] = {name: `ARG${i}`, block: reporterId, shadow: reporterId};
    });
};
const containerBlocks = container => ({
    get: id => container._blocks[id],
    create: block => container.createBlock(block),
    remove: id => container.deleteBlock(id)
});
const collectScriptBlocks = (container, topIds) => {
    const all = container._blocks;
    const ids = new Set();
    const visit = id => {
        if (!id || ids.has(id) || !all[id]) return;
        ids.add(id);
        const block = all[id];
        visit(block.next);
        for (const name in block.inputs) { visit(block.inputs[name].block); visit(block.inputs[name].shadow); }
    };
    topIds.forEach(visit);
    return ids;
};
class RunHandle {
    constructor (host, owner, space, target, thread, args) {
        this._host = host;
        this._owner = owner;
        this.blockspace = space.ref;
        this.target = owner.wrap(target);
        this.thread = thread;
        this.args = args;
        this.status = 'running';
        this.value = null;
        this.line = null;
        this._yields = [];
        this._waiters = [];
        this.done = new Promise(resolve => { this._resolveDone = resolve; });
    }
    get running () { return this.status === 'running'; }
    _return (value) {
        if (!this.running) return;
        this.value = value;
        this._end('returned');
    }
    _yield (value) {
        if (!this.running) return;
        const waiter = this._waiters.shift();
        if (waiter) { waiter.resolve({value, done: false}); } else { this._yields.push(value); }
    }
    _end (status) {
        if (!this.running) return;
        this.status = status;
        this._host.spaces.runs.delete(this);
        this._resolveDone({status, value: this.value});
        for (const waiter of this._waiters) waiter.resolve({done: true});
        this._waiters = [];
    }
    stop () {
        if (!this.running) return;
        this._host.runtime._stopThread(this.thread);
        this._yields = [];
        this._end('stopped');
    }
    then (onFulfilled, onRejected) {
        return this.done.then(({status, value}) => {
            if (status === 'stopped') throw new Stopped('run stopped');
            return value;
        }).then(onFulfilled, onRejected);
    }
    catch (onRejected) { return this.then(null, onRejected); }
    finally (fn) { return this.then(v => { fn(); return v; }, e => { fn(); throw e; }); }
    [Symbol.asyncIterator] () {
        return {
            next: () => {
                if (this._yields.length) return Promise.resolve({value: this._yields.shift(), done: false});
                if (!this.running) return Promise.resolve({done: true});
                return new Promise(resolve => this._waiters.push({resolve}));
            },
            return: () => { this._waiters = []; return Promise.resolve({done: true}); }
        };
    }
}
class BlockspaceRef {
    constructor (spaces, sprite, id) {
        Object.defineProperty(this, '_spaces', {value: spaces});
        Object.defineProperty(this, '_sprite', {value: sprite});
        this.id = id;
    }
    get params () { const entry = this._spaces.entry(this._sprite, this.id); return entry ? entry.params.slice() : []; }
    get exists () { return Boolean(this._spaces.entry(this._sprite, this.id)); }
    toString () { return `Blockspace(${this.id})`; }
}
class Blockspaces {
    constructor (host) {
        this.host = host;
        this.runtime = host.runtime;
        this.runs = new Set();
        this.runtime.on('RUNTIME_STEP_START', () => this._checkRuns());
        this.runtime.on('PROJECT_STOP_ALL', () => {
            for (const run of [...this.runs]) run._end('stopped');
        });
    }
    _of (sprite) {
        if (!sprite.dimodSpaces) sprite.dimodSpaces = new Map();
        return sprite.dimodSpaces;
    }
    entry (sprite, id) { return sprite.dimodSpaces ? sprite.dimodSpaces.get(id) || null : null; }
    refFor (sprite, id) {
        const entry = this.entry(sprite, id);
        if (!entry) return null;
        if (!entry.ref) entry.ref = new BlockspaceRef(this, sprite, id);
        return entry.ref;
    }
    entries (sprite) { return sprite.dimodSpaces ? [...sprite.dimodSpaces.values()] : []; }
    declare (instance, id, payload) {
        if (typeof id !== 'string' || !id) {
            throw new TypeError('new Blockspace() needs an id string first, e.g. new Blockspace("jump")');
        }
        const sprite = instance.target.sprite;
        if (instance.declared) {
            if (instance.declared.has(id)) { throw new Error(`Two blockspaces are called "${id}", each needs its own id`); }
            instance.declared.add(id);
        }
        const entry = this.materialize(sprite, id, payload);
        if (!entry.ref) entry.ref = new BlockspaceRef(this, sprite, id);
        return entry.ref;
    }
    materialize (sprite, id, payload) {
        const spaces = this._of(sprite);
        const normalized = normalizePayload(payload);
        const fresh = typeof payload === 'undefined';
        const key = fresh ? '(fresh)' : JSON.stringify(normalized);
        const existing = spaces.get(id);
        if (existing && (existing.key === key || (fresh && existing.fresh))) return existing;
        const ref = existing ? existing.ref : null;
        if (existing) this.unmaterialize(sprite, existing);
        const container = sprite.blocks;
        let blocks;
        if (fresh) {
            const hatId = uid();
            blocks = {[hatId]: {
                id: hatId,
                opcode: OPCODES.whenCalled,
                next: null,
                parent: null,
                inputs: {},
                fields: {},
                shadow: false,
                topLevel: true,
                x: 0,
                y: 0
            }};
        } else { blocks = clone(normalized.blocks); sb3.deserializeBlocks(blocks); }
        const list = Object.keys(blocks).map(key2 => Object.assign(blocks[key2], {id: blocks[key2].id || key2}));
        const remap = {};
        const ownedElsewhere = blockId => this.entries(sprite).some(e => e.blockIds.has(blockId));
        const collides = list.some(block => container._blocks[block.id] && ownedElsewhere(block.id));
        if (!collides) {
            const stale = list.filter(block => container._blocks[block.id]);
            if (stale.length) {
                const emit = container.emitProjectChanged;
                container.emitProjectChanged = () => {};
                try { stale.forEach(block => container.deleteBlock(block.id)); } finally { container.emitProjectChanged = emit; }
            }
        }
        if (collides) {
            list.forEach(block => { remap[block.id] = uid(); });
            list.forEach(block => {
                block.id = remap[block.id];
                if (block.parent) block.parent = remap[block.parent] || null;
                if (block.next) block.next = remap[block.next] || null;
                for (const name in block.inputs) {
                    const input = block.inputs[name];
                    input.block = input.block ? remap[input.block] || null : null;
                    input.shadow = input.shadow ? remap[input.shadow] || null : null;
                }
            });
        }
        let hatId = null;
        const byId = new Map(list.map(block => [block.id, block]));
        const listBlocks = {
            get: blockId => byId.get(blockId),
            create: block => { list.push(block); byId.set(block.id, block); },
            remove: blockId => {
                const i = list.findIndex(block => block.id === blockId);
                if (i >= 0) list.splice(i, 1);
                byId.delete(blockId);
            }
        };
        for (const block of list.slice()) {
            if (block.opcode !== OPCODES.whenCalled) continue;
            shapeHat(block, id, normalized.params, listBlocks);
            if (!hatId && block.topLevel) hatId = block.id;
        }
        const emitProjectChanged = container.emitProjectChanged;
        container.emitProjectChanged = () => {};
        try { list.forEach(block => container.createBlock(block)); } finally { container.emitProjectChanged = emitProjectChanged; }
        const commentIds = new Set();
        const original = sprite.clones[0];
        if (original) {
            for (const commentId in normalized.comments) {
                const c = normalized.comments[commentId];
                const newId = original.comments[commentId] ? uid() : commentId;
                const blockId = c.blockId ? remap[c.blockId] || c.blockId : null;
                original.createComment(newId, blockId, c.text, c.x, c.y, c.width, c.height, c.minimized);
                commentIds.add(newId);
            }
        }
        this._ensureExtensions(normalized.ext);
        const entry = {
            id,
            key,
            fresh,
            ref,
            params: normalized.params,
            hatId,
            blockIds: new Set(list.map(block => block.id)),
            topIds: list.filter(block => block.topLevel).map(block => block.id),
            commentIds
        };
        spaces.set(id, entry);
        return entry;
    }
    unmaterialize (sprite, entry) {
        const spaces = this._of(sprite);
        if (spaces.get(entry.id) === entry) spaces.delete(entry.id);
        const container = sprite.blocks;
        for (const thread of this.runtime.threads) {
            if (thread.blockContainer === container && entry.blockIds.has(thread.topBlock)) { this.runtime._stopThread(thread); }
        }
        for (const run of [...this.runs]) {
            if (run.blockspace === entry.ref && run.thread.blockContainer === container) run._end('stopped');
        }
        const emitProjectChanged = container.emitProjectChanged;
        container.emitProjectChanged = () => {};
        try {
            entry.topIds.forEach(id => container.deleteBlock(id));
            entry.blockIds.forEach(id => {
                if (container._blocks[id]) container.deleteBlock(id);
            });
        } finally { container.emitProjectChanged = emitProjectChanged; }
        const original = sprite.clones[0];
        if (original) entry.commentIds.forEach(id => delete original.comments[id]);
    }
    prune (sprite, declared) {
        for (const entry of this.entries(sprite)) {
            if (!declared.has(entry.id)) this.unmaterialize(sprite, entry);
        }
    }
    payloadFor (sprite, topIds, params, extraCommentIds) {
        const container = sprite.blocks;
        const ids = collectScriptBlocks(container, topIds);
        const raw = {};
        ids.forEach(id => { raw[id] = container._blocks[id]; });
        const blocks = sb3.serializeBlocks(clone(raw));
        const comments = {};
        const original = sprite.clones[0];
        if (original) {
            for (const commentId in original.comments) {
                const c = original.comments[commentId];
                const attached = c.blockId && ids.has(c.blockId);
                const loose = !c.blockId && extraCommentIds && extraCommentIds.has(commentId);
                if (!attached && !loose) continue;
                comments[commentId] = {
                    blockId: c.blockId,
                    text: c.text,
                    x: c.x,
                    y: c.y,
                    width: c.width,
                    height: c.height,
                    minimized: c.minimized
                };
            }
        }
        const ext = new Set();
        ids.forEach(id => {
            const opcode = container._blocks[id].opcode;
            const extensionId = sb3.getExtensionIdForOpcode(opcode);
            if (extensionId) ext.add(extensionId);
        });
        return {params: params || [], blocks, comments, ext: [...ext]};
    }
    _ensureExtensions (ids) {
        const manager = this.host.vm.extensionManager;
        if (!manager) return;
        for (const id of ids) {
            if (manager.isExtensionLoaded(id)) continue;
            try {
                if (manager.isBuiltinExtension(id)) manager.loadExtensionIdSync(id);
            } catch (e) {
            }
        }
    }
    sync (sprite, id) {
        const entry = this.entry(sprite, id);
        if (!entry) return;
        const container = sprite.blocks;
        const others = this.entries(sprite).filter(e => e !== entry);
        const topIds = container.getScripts().filter(top => !others.some(e => e.blockIds.has(top)));
        const original = sprite.clones[0];
        const looseComments = new Set();
        if (original) {
            for (const commentId in original.comments) {
                if (original.comments[commentId].blockId) continue;
                if (others.some(e => e.commentIds.has(commentId))) continue;
                looseComments.add(commentId);
            }
        }
        let hatId = null;
        for (const top of topIds) {
            const block = container._blocks[top];
            if (block.opcode !== OPCODES.whenCalled) continue;
            shapeHat(block, id, entry.params, containerBlocks(container));
            if (!hatId) hatId = top;
        }
        const payload = this.payloadFor(sprite, topIds, entry.params, looseComments);
        const blockIds = collectScriptBlocks(container, topIds);
        const commentIds = new Set(looseComments);
        if (original) {
            for (const commentId in original.comments) {
                if (blockIds.has(original.comments[commentId].blockId)) commentIds.add(commentId);
            }
        }
        Object.assign(entry, {key: JSON.stringify(normalizePayload(payload)), fresh: false, hatId, topIds, blockIds, commentIds});
        this._writePayload(sprite, id, payload);
    }
    setParams (sprite, id, params) {
        const entry = this.entry(sprite, id);
        if (!entry) return;
        const seen = new Set();
        entry.params = params.map(p => String(p).trim())
            .filter(p => p && !seen.has(p) && seen.add(p));
        this.sync(sprite, id);
    }
    _writePayload (sprite, id, payload) {
        const dimod = sprite.dimod;
        if (!dimod || typeof dimod.source !== 'string') return;
        const call = findBlockspaces(dimod.source).find(c => c.id === id);
        if (!call) return;
        const source = applyEdits(dimod.source, [payloadEdit(call, payload)]);
        if (source === dimod.source) return;
        dimod.source = source;
        this.runtime.emitProjectChanged();
        this.host.vm.emit('DIMOD_BLOCKSPACE_SOURCE_CHANGED', {spriteName: sprite.name});
        this.host._changed(sprite.clones[0], 'payload', {id, payload});
    }
    run (owner, ref, target, args, {restart = false} = {}) {
        owner.assertAlive();
        if (!(ref instanceof BlockspaceRef)) { throw new TypeError('run() needs a blockspace, e.g. me.run(jump, 10)'); }
        const entry = this.entry(ref._sprite, ref.id);
        if (!entry) throw new ReferenceError(`Blockspace "${ref.id}" isn't in the code any more`);
        if (!entry.hatId || !ref._sprite.blocks._blocks[entry.hatId]) {
            throw new Error(`Blockspace "${ref.id}" has no "when called" block to run`);
        }
        if (target.isDisposed) throw new Stopped('target deleted');
        if (restart) {
            for (const run of [...this.runs]) {
                if (run.blockspace === ref && run.thread.target === target) run.stop();
            }
        }
        const named = {};
        entry.params.forEach((name, i) => { named[name] = i < args.length ? toCast(args[i]) : ''; });
        const thread = this.runtime._pushThread(entry.hatId, target, {targetBlockLocation: ref._sprite.blocks});
        const run = new RunHandle(this.host, owner, entry, target, thread, named);
        run.line = owner.callerLine();
        thread.dimodRun = run;
        this.runs.add(run);
        return run;
    }
    runBlock (owner, target, opcode, args, reporter) {
        owner.assertAlive();
        if (typeof opcode !== 'string' || !this.runtime._primitives[opcode]) {
            throw new ReferenceError(`No block "${opcode}" in this project (for an extension's block, ` +
                'use me.ext(extensionId), or check the extension is added)');
        }
        if (target.isDisposed) throw new Stopped('target deleted');
        if (!this._oneOffBlocks) this._oneOffBlocks = new Blocks(this.runtime, true);
        const container = this._oneOffBlocks;
        const create = block => { container.createBlock(block); return block.id; };
        const blockId = uid();
        const block = {id: blockId, opcode, next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: !reporter};
        for (const name of Object.keys(args || {})) {
            const value = toCast(args[name]);
            const shadowId = uid();
            create({
                id: shadowId,
                opcode: 'text',
                next: null,
                parent: blockId,
                inputs: {},
                fields: {TEXT: {name: 'TEXT', value: String(value)}},
                shadow: true,
                topLevel: false
            });
            block.inputs[name] = {name, block: shadowId, shadow: shadowId};
            block.fields[name] = {name, value};
        }
        let topId = create(block);
        if (reporter) {
            topId = uid();
            block.parent = topId;
            create({
                id: topId,
                opcode: OPCODES.returnValue,
                next: null,
                parent: null,
                inputs: {VALUE: {name: 'VALUE', block: blockId, shadow: null}},
                fields: {},
                shadow: false,
                topLevel: true
            });
        }
        const compiler = this.runtime.compilerOptions.enabled;
        this.runtime.compilerOptions.enabled = false;
        let thread;
        try { thread = this.runtime._pushThread(topId, target, {targetBlockLocation: container}); } finally { this.runtime.compilerOptions.enabled = compiler; }
        const run = new RunHandle(this.host, owner, {ref: null}, target, thread, {});
        run.line = owner.callerLine();
        thread.dimodRun = run;
        this.runs.add(run);
        run.done.then(() => container.deleteBlock(topId));
        return run;
    }
    runFailed (run, error) {
        this.runtime._stopThread(run.thread);
        run._end('stopped');
        const what = run.blockspace ? `blockspace "${run.blockspace.id}"` : 'a block';
        const text = error && error.message ? `${error.name || 'Error'}: ${error.message}` : String(error);
        const target = run._owner.target;
        this.host.emitLog(target, 'error', `In ${what} (run as ${run.target.name}): ${text}`, run.line || null);
    }
    _checkRuns () {
        if (!this.runs.size) return;
        const live = new Set(this.runtime.threads);
        for (const run of [...this.runs]) {
            const thread = run.thread;
            if (thread.target.isDisposed) {
                run._end('stopped');
            } else if (thread.isKilled || thread.status === THREAD_DONE || !live.has(thread)) {
                run._end(thread.isKilled ? 'stopped' : 'finished');
            }
        }
    }
    disposeOwner (owner) {
        for (const run of [...this.runs]) if (run._owner === owner) run.stop();
    }
}
const LIMITS = Object.freeze({valueBytes: 1024 * 1024, nameLength: 256, variables: 128});
const PREFIX = '☁ ';
const bare = name => String(name).replace(/^☁\s*/, '');
const CLOUD_TYPE = '';
const byteLength = text => {
    if (text.length * 3 <= LIMITS.valueBytes) return text.length;
    return new TextEncoder().encode(text).length;
};
const fromCloud = value => (typeof value === 'string' ? parseServerData(value) : value);
const METHODS$1 = ['get', 'set', 'has', 'delete', 'names', 'all', 'on', 'raw', 'available', 'connected', 'limits'];
const createCloudApi = (owner, vars, stage) => {
    const variable = name => {
        const found = stage().lookupVariableByNameAndType(`${PREFIX}${bare(name)}`, CLOUD_TYPE, true);
        return found && found.isCloud ? found : null;
    };
    const names = () => Object.values(stage().variables)
        .filter(v => v.isCloud && v.type === CLOUD_TYPE)
        .map(v => bare(v.name));
    const client = () => owner.runtimeHost.vm.dimodGameClient || null;
    const checkName = name => {
        const clean = bare(name);
        if (!clean) throw new TypeError('A cloud variable needs a name');
        if (clean.length > LIMITS.nameLength) {
            throw new RangeError(`Cloud variable names can be ${LIMITS.nameLength} characters at most`);
        }
        return clean;
    };
    const api = {
        get (name, fallback) { const found = variable(checkName(name)); return found ? fromCloud(found.value) : fallback; },
        raw (name) {
            const found = variable(checkName(name));
            if (!found) return;
            return found.value;
        },
        set (name, value) {
            owner.assertAlive();
            const clean = checkName(name);
            const stored = toCast(value);
            if (typeof stored === 'string' && byteLength(stored) > LIMITS.valueBytes) {
                throw new RangeError(`"${clean}" is too big for a cloud variable (1 MB at most)`);
            }
            if (!variable(clean)) {
                if (names().length >= LIMITS.variables) {
                    throw new RangeError(`A game can have ${LIMITS.variables} cloud variables at most`);
                }
                vars.declare(`${PREFIX}${clean}`, '', {scope: 'cloud'});
            }
            vars[`${PREFIX}${clean}`] = stored;
            return value;
        },
        has (name) { return Boolean(variable(checkName(name))); },
        delete (name) {
            owner.assertAlive();
            const found = variable(checkName(name));
            if (!found) return false;
            stage().deleteVariable(found.id);
            return true;
        },
        names,
        all () {
            const out = {};
            for (const name of names()) out[name] = fromCloud(variable(name).value);
            return out;
        },
        on (name, fn) {
            if (typeof name === 'function' && typeof fn === 'undefined') { fn = name; name = null; }
            if (typeof fn !== 'function') throw new TypeError('world.cloud.on() needs a function');
            const filter = name === null ? null : checkName(name);
            const off = owner.onWorld('cloud', filter, (value, changed) => fn(fromCloud(value), changed));
            const c = client();
            if (c) c.ensureConnected();
            return off;
        },
        get available () { return Boolean(client()); },
        get connected () { const c = client(); return Boolean(c && c.connected); },
        limits: LIMITS
    };
    const methods = {};
    for (const key of METHODS$1) { Object.defineProperty(methods, key, Object.getOwnPropertyDescriptor(api, key)); }
    return new Proxy(methods, {
        get: (obj, name) => {
            if (typeof name !== 'string') return;
            if (METHODS$1.includes(name)) return Reflect.get(obj, name);
            const found = variable(name);
            if (!found) return;
            return found.value;
        },
        set: (obj, name, value) => {
            if (typeof name !== 'string') return false;
            if (METHODS$1.includes(name)) {
                throw new TypeError(`world.cloud.${name} is a method: use world.cloud.set("${name}", value)`);
            }
            api.set(name, value);
            return true;
        },
        has: (obj, name) => typeof name === 'string' && (METHODS$1.includes(name) || Boolean(variable(name))),
        deleteProperty: (obj, name) => {
            if (typeof name === 'string' && !METHODS$1.includes(name)) api.delete(name);
            return true;
        },
        ownKeys: () => names(),
        getOwnPropertyDescriptor: (obj, name) => {
            if (typeof name !== 'string' || METHODS$1.includes(name)) return;
            const found = variable(name);
            if (!found) return;
            return {enumerable: true, configurable: true, writable: true, value: found.value};
        }
    });
};
const PAD_BUTTONS = {
    a: 0,
    b: 1,
    x: 2,
    y: 3,
    lb: 4,
    rb: 5,
    lt: 6,
    rt: 7,
    back: 8,
    start: 9,
    ls: 10,
    rs: 11,
    up: 12,
    down: 13,
    left: 14,
    right: 15
};
const PAD_AXES = {lx: 0, ly: 1, rx: 2, ry: 3};
const DEADZONE = 0.2;
const PAD = /^pad(\d*):(.+)$/;
const pads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []) || [];
const parseBinding = text => {
    const raw = String(text).trim();
    const lower = raw.toLowerCase();
    if (lower === 'mouse') return {kind: 'mouse', text: 'mouse'};
    const pad = PAD.exec(lower);
    if (pad) {
        const index = pad[1] ? Number(pad[1]) - 1 : 0;
        const what = pad[2];
        const stick = /^(lx|ly|rx|ry)([+-])$/.exec(what);
        if (stick) { return {kind: 'axis', pad: index, axis: PAD_AXES[stick[1]], sign: stick[2] === '+' ? 1 : -1, text: lower}; }
        if (what in PAD_BUTTONS) return {kind: 'button', pad: index, button: PAD_BUTTONS[what], text: lower};
        if (/^\d+$/.test(what)) return {kind: 'button', pad: index, button: Number(what), text: lower};
        throw new TypeError(`Unknown gamepad input "${raw}", try pad:a, pad:lb, pad:up, pad:lx+ (see world.input)`);
    }
    if (!raw) throw new TypeError('bind() needs a key, "mouse" or a gamepad input');
    return {kind: 'key', key: raw, text: lower};
};
class InputMap {
    constructor (runtime, clock) {
        this.runtime = runtime;
        this.actions = new Map();
        this.captures = new Set();
        this.frame = -1;
        this.deadzone = DEADZONE;
        clock.addFrameHook(() => this.update(clock.frame));
    }
    clear () { this.actions.clear(); }
    action (name, create) {
        const key = String(name);
        let action = this.actions.get(key);
        if (!action && create) {
            action = {name: key, bindings: [], value: 0, down: false, wasDown: false, listeners: new Set(),
                held: false, tapUntil: -1};
            this.actions.set(key, action);
        }
        return action || null;
    }
    _read (binding) {
        if (binding.kind === 'key') return this.runtime.ioDevices.keyboard.getKeyIsDown(binding.key) ? 1 : 0;
        if (binding.kind === 'mouse') return this.runtime.ioDevices.mouse.getIsDown() ? 1 : 0;
        const pad = pads()[binding.pad];
        if (!pad) return 0;
        if (binding.kind === 'button') {
            const button = pad.buttons[binding.button];
            if (!button) return 0;
            if (typeof button.value === 'number' && button.value > 0) return button.value;
            return button.pressed ? 1 : 0;
        }
        const raw = (pad.axes[binding.axis] || 0) * binding.sign;
        return raw > this.deadzone ? (raw - this.deadzone) / (1 - this.deadzone) : 0;
    }
    update (frame) {
        this.frame = frame;
        for (const action of this.actions.values()) {
            let value = 0;
            for (const binding of action.bindings) value = Math.max(value, this._read(binding));
            if (action.held || frame <= action.tapUntil) value = 1;
            action.wasDown = action.down;
            action.value = value;
            action.down = value > 0.5;
            if (action.down !== action.wasDown) {
                const event = action.down ? 'press' : 'release';
                for (const listener of [...action.listeners]) {
                    if (listener.event !== event) continue;
                    listener.owner.invokeAs(`input ${action.name}`, listener.fn, action.value);
                }
            }
        }
        if (this.captures.size) this._checkCaptures();
    }
    held () {
        const keyboard = this.runtime.ioDevices.keyboard;
        const keys = keyboard._keysPressed.map(k => String(k).toLowerCase());
        if (keys.length) return keys[keys.length - 1];
        if (this.runtime.ioDevices.mouse.getIsDown()) return 'mouse';
        const list = pads();
        for (let i = 0; i < list.length; i++) {
            const pad = list[i];
            if (!pad) continue;
            const prefix = i === 0 ? 'pad' : `pad${i + 1}`;
            const button = pad.buttons.findIndex(b => b.pressed);
            if (button >= 0) {
                const name = Object.keys(PAD_BUTTONS).find(n => PAD_BUTTONS[n] === button);
                return `${prefix}:${name || button}`;
            }
            const axis = pad.axes.findIndex((v, n) => n < 4 && Math.abs(v) > 0.6);
            if (axis >= 0) {
                const stick = Object.keys(PAD_AXES).find(n => PAD_AXES[n] === axis);
                return `${prefix}:${stick}${pad.axes[axis] > 0 ? '+' : '-'}`;
            }
        }
        return null;
    }
    _checkCaptures () {
        const held = this.held();
        for (const capture of [...this.captures]) {
            if (held === null) { capture.armed = true; } else if (capture.armed && (!capture.skip.includes(held))) { this.captures.delete(capture); capture.done(held); }
        }
    }
}
class InputApi {
    constructor (owner, map) {
        Object.defineProperty(this, '_owner', {value: owner});
        Object.defineProperty(this, '_map', {value: map});
    }
    _action (name) {
        const action = this._map.action(name, false);
        if (!action) { throw new ReferenceError(`No input action "${name}", make it with world.input.bind("${name}", "space")`); }
        return action;
    }
    bind (name, ...bindings) {
        this._owner.assertAlive();
        if (!bindings.length) throw new TypeError(`world.input.bind("${name}") needs something to bind, e.g. "space"`);
        const action = this._map.action(name, true);
        for (const text of bindings.flat()) {
            const binding = parseBinding(text);
            if (!action.bindings.some(b => b.text === binding.text)) action.bindings.push(binding);
        }
        return this;
    }
    rebind (name, ...bindings) {
        this._owner.assertAlive();
        const action = this._map.action(name, true);
        action.bindings = [];
        return this.bind(name, ...bindings);
    }
    unbind (name, ...bindings) {
        this._owner.assertAlive();
        const action = this._map.action(name, false);
        if (!action) return this;
        if (bindings.length) {
            const drop = new Set(bindings.flat().map(text => parseBinding(text).text));
            action.bindings = action.bindings.filter(b => !drop.has(b.text));
        } else { action.bindings = []; }
        return this;
    }
    actions (map) {
        for (const name of Object.keys(map || {})) this.bind(name, ...[].concat(map[name]));
        return this;
    }
    bindings (name) { const action = this._map.action(name, false); return action ? action.bindings.map(b => b.text) : []; }
    get names () { return [...this._map.actions.keys()]; }
    down (name) { return this._action(name).down; }
    pressed (name) { const action = this._action(name); return action.down && !action.wasDown; }
    released (name) { const action = this._action(name); return !action.down && action.wasDown; }
    value (name) { return this._action(name).value; }
    axis (negative, positive) { return this._action(positive).value - this._action(negative).value; }
    vector (left, right, up, down) {
        const x = this.axis(left, right);
        const y = this.axis(down, up);
        const length = Math.hypot(x, y);
        return length > 1 ? {x: x / length, y: y / length} : {x, y};
    }
    press (name) { this._owner.assertAlive(); this._action(name).held = true; return this; }
    release (name) {
        this._owner.assertAlive();
        const action = this._action(name);
        action.held = false;
        action.tapUntil = -1;
        return this;
    }
    tap (name) { this._owner.assertAlive(); this._action(name).tapUntil = this._map.frame + 1; return this; }
    on (name, event, fn) {
        if (typeof event === 'function' && typeof fn === 'undefined') { fn = event; event = 'press'; }
        if (event !== 'press' && event !== 'release') { throw new TypeError('world.input.on(name, "press" | "release", fn)'); }
        if (typeof fn !== 'function') throw new TypeError(`world.input.on("${name}") needs a function`);
        this._owner.assertAlive();
        const listener = {event, fn, owner: this._owner};
        const listeners = this._map.action(name, true).listeners;
        listeners.add(listener);
        return this._owner._addOff(() => listeners.delete(listener));
    }
    capture ({skip = [], timeout = null} = {}) {
        this._owner.assertAlive();
        const map = this._map;
        const external = this._owner.runtimeHost.clock.external(this._owner, {
            timeout,
            timeoutError: () => Object.assign(new Error('nothing was pressed'), {name: 'TimeoutError'})
        });
        const capture = {armed: false, skip: skip.map(s => String(s).toLowerCase()), done: text => external.resolve(text)};
        map.captures.add(capture);
        external.promise.then(null, () => map.captures.delete(capture));
        return external.promise;
    }
}
const worldProxy = api => withValues(api, {
    values: () => api._owner.runtimeHost.worldValues,
    set: (name, value) => { api._owner.assertAlive(); api._owner.runtimeHost.setWorldValue(name, value); },
    label: () => 'world'
});
const scenesOf = owner => {
    const host = owner.runtimeHost.runtime.dimodScenes;
    if (!host) throw new Error('Scenes are not available here');
    return host;
};
const sceneApis = new WeakMap();
const sceneApiFor = (owner, record) => {
    let map = sceneApis.get(owner);
    if (!map) sceneApis.set(owner, map = new Map());
    if (!map.has(record.id)) map.set(record.id, new SceneApi(owner, record));
    return map.get(record.id);
};
const sceneRecord = (owner, thing) => {
    const record = scenesOf(owner).scene(thing instanceof SceneApi ? thing.id : thing);
    if (!record) throw new Error(`There is no scene "${thing}"`);
    return record;
};
class SceneApi {
    constructor (owner, record) {
        Object.defineProperty(this, '_owner', {value: owner});
        Object.defineProperty(this, '_record', {value: record});
    }
    get id () { return this._record.id; }
    get name () { return this._record.name; }
    set name (value) { this._owner.assertAlive(); scenesOf(this._owner).rename(this._record.id, value); }
    get index () { return scenesOf(this._owner).list.indexOf(this._record); }
    get isCurrent () { return scenesOf(this._owner).current === this._record.id; }
    get isStart () { return scenesOf(this._owner).main === this._record.id; }
    get backdrop () { return this._record.backdrop; }
    set backdrop (name) { this._owner.assertAlive(); scenesOf(this._owner).setBackdrop(this._record.id, name); }
    get sprites () { return scenesOf(this._owner).spritesIn(this._record.id).map(t => this._owner.wrap(t)); }
    go () { this._owner.assertAlive(); scenesOf(this._owner).goTo(this._record.id); }
    makeStart () { this._owner.assertAlive(); scenesOf(this._owner).setMain(this._record.id); }
    has (target) { return scenesOf(this._owner).inScene(getRaw(target), this._record.id); }
    add (target) { this._owner.assertAlive(); scenesOf(this._owner).addTo(getRaw(target), this._record.id); }
    remove (target) { this._owner.assertAlive(); scenesOf(this._owner).removeFrom(getRaw(target), this._record.id); }
    delete () { this._owner.assertAlive(); return scenesOf(this._owner).remove(this._record.id); }
    toString () { return this._record.name; }
}
const assetsOf = owner => {
    const host = owner.runtimeHost.runtime.dimodAssets;
    if (!host) throw new Error('Assets are not available here');
    return host;
};
class AssetApi {
    constructor (owner, record) {
        Object.defineProperty(this, '_owner', {value: owner});
        Object.defineProperty(this, '_record', {value: record});
    }
    get name () { return this._record.name; }
    set name (value) { this._owner.assertAlive(); assetsOf(this._owner).rename(this._record, value); }
    get kind () { return this._record.kind; }
    get format () { return this._record.ext; }
    get size () { return this._record.size; }
    get url () { return assetsOf(this._owner).url(this._record); }
    get bytes () { return assetsOf(this._owner).bytes(this._record).slice(); }
    text () { return assetsOf(this._owner).text(this._record); }
    json () { return JSON.parse(this.text()); }
    write (value) {
        this._owner.assertAlive();
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        assetsOf(this._owner).replace(this._record, new TextEncoder().encode(text));
    }
    delete () { this._owner.assertAlive(); assetsOf(this._owner).remove(this._record); }
    toString () { return this._record.name; }
}
const assetsApi = owner => ({
    get: thing => {
        const record = assetsOf(owner).byRef(thing instanceof AssetApi ? thing.name : thing);
        return record ? new AssetApi(owner, record) : null;
    },
    has: thing => !!assetsOf(owner).byRef(thing),
    list: kind => assetsOf(owner).ofKind(kind).map(record => new AssetApi(owner, record)),
    text: name => {
        const record = assetsOf(owner).byRef(name);
        if (!record) throw new Error(`There is no asset "${name}"`);
        return assetsOf(owner).text(record);
    },
    json: name => JSON.parse(assetsApi(owner).text(name)),
    write: (name, value) => {
        owner.assertAlive();
        const host = assetsOf(owner);
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        const record = host.byRef(name);
        if (record) host.replace(record, new TextEncoder().encode(text));
        else host.addText(String(name), text, typeof value === 'string' ? 'txt' : 'json');
        return new AssetApi(owner, host.byRef(name));
    }
});
class WorldApi {
    constructor (owner) {
        Object.defineProperty(this, '_owner', {value: owner});
        const host = owner.runtimeHost;
        const runtime = host.runtime;
        const stage = () => runtime.getTargetForStage();
        this.vars = variableProxy(owner, stage(), 'vars', true);
        this.lists = variableProxy(owner, stage(), 'lists', true);
        this.cloud = createCloudApi(owner, this.vars, stage);
        const mouse = runtime.ioDevices.mouse;
        this.mouse = Object.freeze({
            get x () { return mouse.getScratchX(); },
            get y () { return mouse.getScratchY(); },
            get down () { return mouse.getIsDown(); },
            get pressed () { return host.mouseEdges.pressed; },
            get released () { return host.mouseEdges.released; }
        });
        const keyboard = runtime.ioDevices.keyboard;
        this.keys = Object.freeze({
            isDown: key => keyboard.getKeyIsDown(String(key)),
            get down () { return new Set(keyboard._keysPressed.map(k => k.toLowerCase())); }
        });
    }
    on (event, filter, fn) { return this._owner.onWorld(event, filter, fn); }
    emit (event, ...args) { this._owner.runtimeHost.emitCustom(event, args); }
    broadcast (name, data) { this._owner.assertAlive(); this._owner.runtimeHost.broadcast(String(name), data); }
    async broadcastAndWait (name, data) {
        this._owner.assertAlive();
        const host = this._owner.runtimeHost;
        const {threads, handlers} = host.broadcast(String(name), data);
        await Promise.all(handlers);
        if (threads.length) {
            const running = th => th.status !== THREAD_DONE && host.runtime.threads.includes(th);
            await host.clock.waitUntil(this._owner, () => !threads.some(running));
        }
    }
    getTarget (name) {
        const target = this._owner.runtimeHost.runtime.getSpriteTargetByName(String(name));
        return target ? this._owner.wrap(target) : null;
    }
    get stage () { return this._owner.wrap(this._owner.runtimeHost.runtime.getTargetForStage()); }
    get sprites () {
        return this._owner.runtimeHost.runtime.targets
            .filter(t => t.isOriginal && !t.isStage)
            .map(t => this._owner.wrap(t));
    }
    get backdrop () {
        const stage = this._owner.runtimeHost.runtime.getTargetForStage();
        const costume = stage.getCurrentCostume();
        return costume ? costume.name : '';
    }
    set backdrop (name) {
        this._owner.assertAlive();
        const runtime = this._owner.runtimeHost.runtime;
        callPrimitive(runtime, 'looks_switchbackdropto', {BACKDROP: name}, runtime.getTargetForStage());
    }
    get backdrops () {
        return this._owner.runtimeHost.runtime.getTargetForStage().getCostumes()
            .map(costume => costume.name);
    }
    get scene () { return sceneApiFor(this._owner, scenesOf(this._owner).currentScene); }
    set scene (value) { this._owner.assertAlive(); scenesOf(this._owner).goTo(sceneRecord(this._owner, value).id); }
    get scenes () { return scenesOf(this._owner).list.map(record => sceneApiFor(this._owner, record)); }
    getScene (name) { const record = scenesOf(this._owner).scene(name); return record ? sceneApiFor(this._owner, record) : null; }
    addScene (name) {
        this._owner.assertAlive();
        return sceneApiFor(this._owner, scenesOf(this._owner).create(name === undefined ? 'Scene' : String(name)));
    }
    nextScene () { this._owner.assertAlive(); scenesOf(this._owner).goRel('next'); }
    previousScene () { this._owner.assertAlive(); scenesOf(this._owner).goRel('previous'); }
    get assets () {
        if (!this._assets) this._assets = assetsApi(this._owner);
        return this._assets;
    }
    animation (thing) { return animationOf(this._owner, null, thing); }
    get animations () {
        const runtime = this._owner.runtimeHost.runtime;
        return runtime.targets.filter(t => t.isOriginal && !t.isStage && t.sprite)
            .flatMap(t => animationsIn(this._owner, t.sprite));
    }
    get animationSmoothing () { return hostOf(this._owner.runtimeHost.runtime).globalAA !== false; }
    set animationSmoothing (on) { this._owner.assertAlive(); hostOf(this._owner.runtimeHost.runtime).globalAA = Boolean(on); }
    get animationDetail () { return hostOf(this._owner.runtimeHost.runtime).globalDetail; }
    set animationDetail (level) {
        this._owner.assertAlive();
        if (!['low', 'medium', 'high'].includes(level)) {
            throw new TypeError('world.animationDetail is "low", "medium" or "high"');
        }
        hostOf(this._owner.runtimeHost.runtime).globalDetail = level;
    }
    get camera () {
        requireExtension(this._owner.runtimeHost.runtime, 'pmCamera', 'Camera');
        if (!this._camera) this._camera = new CameraApi(this._owner, 'default');
        return this._camera;
    }
    get cameras () {
        const owner = this._owner;
        if (!this._cameras) this._cameras = new Map();
        const made = this._cameras;
        return {
            get: name => {
                requireExtension(owner.runtimeHost.runtime, 'pmCamera', 'Camera');
                const key = String(name);
                if (!made.has(key)) made.set(key, key === 'default' ? this.camera : new CameraApi(owner, key));
                return made.get(key);
            }
        };
    }
    get pen () {
        const runtime = this._owner.runtimeHost.runtime;
        requireExtension(runtime, 'pen', 'Pen');
        const owner = this._owner;
        return {
            clear: () => { owner.assertAlive(); runtime.ext_pen.clear(); },
            of: targetApi => new PenApi(owner, targetApi._target)
        };
    }
    useExtension (id) {
        const manager = this._owner.runtimeHost.vm.extensionManager;
        if (manager.isExtensionLoaded(id)) return;
        if (!manager.isBuiltinExtension(id)) throw new Error(`"${id}" isn't a built-in extension`);
        manager.loadExtensionIdSync(id);
    }
    ext (extensionId) {
        return extensionProxy(this._owner, this._owner.runtimeHost.runtime.getTargetForStage(), String(extensionId));
    }
    get extensions () {
        if (!this._extensions) {
            const stage = this._owner.runtimeHost.runtime.getTargetForStage();
            Object.defineProperty(this, '_extensions', {value: extensionsApi(this._owner, stage)});
        }
        return this._extensions;
    }
    ask (question) { return ask(this._owner, this._owner.runtimeHost.runtime.getTargetForStage(), question); }
    gamepad (index = 0) { return gamepad(index); }
    runAll (blockspace, targets, ...args) {
        const list = Array.from(targets || []);
        return Promise.all(list.map(target => target.run(blockspace, ...args)));
    }
    hold (defaults, options) { return this._owner.runtimeHost.worldHold.hold(defaults, options); }
    tween (to, seconds, options) { this._owner.assertAlive(); return startTween(this._owner, this, to, seconds, options); }
    get server () {
        if (!this._server) this._server = new ServerApi(this._owner);
        return this._server;
    }
    watch (expr, fn, options) { return this._owner.watch(expr, fn, options); }
    get stageWidth () { return this._owner.runtimeHost.runtime.stageWidth; }
    get stageHeight () { return this._owner.runtimeHost.runtime.stageHeight; }
    get testing () { return this._owner.runtimeHost.testing > 0; }
    get input () {
        if (!this._input) this._input = new InputApi(this._owner, this._owner.runtimeHost.input);
        return this._input;
    }
    once (event, filter, options) {
        return this._owner.once('world', event, typeof filter === 'undefined' ? null : filter, options);
    }
    expose (name, fn) { return this._owner.expose('world', name, fn); }
    get timer () { return this._owner.runtimeHost.runtime.ioDevices.clock.projectTimer(); }
    resetTimer () { this._owner.runtimeHost.runtime.ioDevices.clock.resetProjectTimer(); }
    get now () { return new Date(); }
    forever (fn) {
        if (typeof fn !== 'function') throw new TypeError('world.forever() needs a function');
        return this._owner.runtimeHost.clock.loop(this._owner, fn, {kind: 'forever'});
    }
    every (seconds, fn) {
        if (typeof fn !== 'function') throw new TypeError('world.every() needs a function');
        return this._owner.runtimeHost.clock.timer(this._owner, seconds, fn, true);
    }
    after (seconds, fn) {
        if (typeof fn !== 'function') throw new TypeError('world.after() needs a function');
        return this._owner.runtimeHost.clock.timer(this._owner, seconds, fn, false);
    }
}
const WORLD_BUILT_IN_NAMES = [
    ...Object.getOwnPropertyNames(WorldApi.prototype),
    'vars', 'lists', 'cloud', 'mouse', 'keys', '_owner', '_camera', '_cameras', '_server', '_input', '_extensions', '_assets'
].filter(name => name !== 'constructor');
const DEFAULT_TIMEOUT_S = 5;
class AssertionError extends Error {
    constructor (message) { super(message); this.name = 'AssertionError'; }
}
const show = value => {
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'function') return `ƒ ${value.name || ''}()`;
    if (value && typeof value === 'object' && typeof value.name === 'string' && '_target' in value) {
        return `sprite "${value.name}"`;
    }
    try {
        const text = JSON.stringify(value);
        return typeof text === 'string' ? (text.length > 80 ? `${text.slice(0, 77)}...` : text) : String(value);
    } catch (e) { return String(value); }
};
const isObject = v => v !== null && typeof v === 'object';
const deepEqual = (a, b, seen = new Set()) => {
    if (Object.is(a, b)) return true;
    if (!isObject(a) || !isObject(b)) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (seen.has(a)) return true;
    seen.add(a);
    if (a instanceof Map && b instanceof Map) {
        return a.size === b.size && [...a].every(([k, v]) => b.has(k) && deepEqual(v, b.get(k), seen));
    }
    if (a instanceof Set && b instanceof Set) return a.size === b.size && [...a].every(v => b.has(v));
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return keysA.length === keysB.length && keysA.every(k => Object.prototype.hasOwnProperty.call(b, k) &&
        deepEqual(a[k], b[k], seen));
};
const expect = actual => {
    const make = negate => {
        const check = (pass, message, notMessage) => {
            if (pass === negate) throw new AssertionError(negate ? notMessage : message);
        };
        const matchers = {
            toBe: expected => check(Object.is(actual, expected),
                `expected ${show(actual)} to be ${show(expected)}`,
                `expected ${show(actual)} not to be ${show(expected)}`),
            toEqual: expected => check(deepEqual(actual, expected),
                `expected ${show(actual)} to equal ${show(expected)}`,
                `expected ${show(actual)} not to equal ${show(expected)}`),
            toBeCloseTo: (expected, digits = 2) => check(
                typeof actual === 'number' && Math.abs(actual - expected) < (Math.pow(10, -digits) / 2),
                `expected ${show(actual)} to be close to ${show(expected)} (${digits} digits)`,
                `expected ${show(actual)} not to be close to ${show(expected)} (${digits} digits)`),
            toBeGreaterThan: n => check(actual > n, `expected ${show(actual)} to be greater than ${show(n)}`,
                `expected ${show(actual)} not to be greater than ${show(n)}`),
            toBeGreaterThanOrEqual: n => check(actual >= n,
                `expected ${show(actual)} to be at least ${show(n)}`,
                `expected ${show(actual)} to be less than ${show(n)}`),
            toBeLessThan: n => check(actual < n, `expected ${show(actual)} to be less than ${show(n)}`,
                `expected ${show(actual)} not to be less than ${show(n)}`),
            toBeLessThanOrEqual: n => check(actual <= n,
                `expected ${show(actual)} to be at most ${show(n)}`,
                `expected ${show(actual)} to be more than ${show(n)}`),
            toBeTruthy: () => check(Boolean(actual), `expected ${show(actual)} to be truthy`,
                `expected ${show(actual)} to be falsy`),
            toBeFalsy: () => check(!actual, `expected ${show(actual)} to be falsy`, `expected ${show(actual)} to be truthy`),
            toBeNull: () => check(actual === null, `expected ${show(actual)} to be null`, 'expected a value, not null'),
            toBeUndefined: () => check(typeof actual === 'undefined', `expected ${show(actual)} to be undefined`,
                'expected a value, not undefined'),
            toBeDefined: () => check(typeof actual !== 'undefined', 'expected a value, not undefined',
                `expected ${show(actual)} to be undefined`),
            toContain: item => {
                const has = typeof actual === 'string' ? actual.includes(String(item)) :
                    Array.from(actual || []).some(v => Object.is(v, item) || deepEqual(v, item));
                check(has, `expected ${show(actual)} to contain ${show(item)}`,
                    `expected ${show(actual)} not to contain ${show(item)}`);
            },
            toHaveLength: n => check(actual && actual.length === n,
                `expected length ${n}, got ${actual && actual.length}`, `expected length not to be ${n}`),
            toMatch: pattern => check(new RegExp(pattern).test(String(actual)),
                `expected ${show(actual)} to match ${pattern}`, `expected ${show(actual)} not to match ${pattern}`),
            toBeInstanceOf: type => check(actual instanceof type,
                `expected ${show(actual)} to be an instance of ${type && type.name}`,
                `expected ${show(actual)} not to be an instance of ${type && type.name}`),
            toThrow: expected => {
                if (typeof actual !== 'function') throw new TypeError('expect(fn).toThrow() needs a function');
                let threw = null;
                try { actual(); } catch (e) { threw = e; }
                const matches = threw && (typeof expected === 'undefined' ||
                    (expected instanceof RegExp ? expected.test(threw.message) :
                        typeof expected === 'string' ? String(threw.message).includes(expected) :
                            typeof expected === 'function' ? threw instanceof expected : true));
                check(Boolean(matches),
                    threw ? `it threw ${show(threw.message)}, expected ${show(expected)}` : 'expected it to throw',
                    'expected it not to throw');
            }
        };
        return matchers;
    };
    const api = make(false);
    api.not = make(true);
    return api;
};
const assert = (condition, message) => {
    if (!condition) throw new AssertionError(message || 'assertion failed');
};
class TestRegistry {
    constructor (owner) {
        this.owner = owner;
        this.tests = [];
        this._suite = [];
        this._hooks = {before: [], after: []};
        this._only = false;
    }
    api () {
        const registry = this;
        const add = (name, fn, options, mode) => {
            if (typeof name !== 'string' || !name) {
                throw new TypeError('test() needs a name, e.g. test("jumps", () => {...})');
            }
            if (typeof fn !== 'function') throw new TypeError(`test("${name}") needs a function`);
            if (mode === 'only') registry._only = true;
            registry.tests.push({
                name: [...registry._suite, name].join(' › '),
                fn,
                mode,
                timeout: options && Number(options.timeout) > 0 ? Number(options.timeout) : DEFAULT_TIMEOUT_S,
                before: registry._hooks.before.slice(),
                after: registry._hooks.after.slice(),
                line: registry.owner.callerLine()
            });
        };
        const test = (name, fn, options) => add(name, fn, options, 'run');
        test.skip = (name, fn, options) => add(name, fn, options, 'skip');
        test.only = (name, fn, options) => add(name, fn, options, 'only');
        const describe = (name, fn) => {
            if (typeof fn !== 'function') throw new TypeError(`describe("${name}") needs a function`);
            const before = registry._hooks.before.length;
            const after = registry._hooks.after.length;
            registry._suite.push(String(name));
            try { fn(); } finally { registry._suite.pop(); registry._hooks.before.length = before; registry._hooks.after.length = after; }
        };
        return {
            test,
            it: test,
            describe,
            expect,
            assert,
            beforeEach: fn => registry._hooks.before.push(fn),
            afterEach: fn => registry._hooks.after.push(fn)
        };
    }
    async run({filter = '', onResult = () => {}} = {}) {
        const results = [];
        const selected = this.tests.filter(t => (!filter || t.name.toLowerCase().includes(filter.toLowerCase())));
        for (const t of selected) { const result = await this._one(t); results.push(result); onResult(result); }
        return results;
    }
    async _one (t) {
        const owner = this.owner;
        const base = {name: t.name, line: t.line};
        if (t.mode === 'skip' || (this._only && t.mode !== 'only')) return {...base, status: 'skip', ms: 0};
        const started = performance.now();
        let timer = null;
        let finished = false;
        const problem = e => ({
            ...base,
            status: 'fail',
            ms: performance.now() - started,
            message: e && e.name && e.message ? `${e.name === 'AssertionError' ? '' : `${e.name}: `}${e.message}` :
                String(e),
            line: owner.lineIn(e && e.stack) || t.line
        });
        try {
            const body = (async () => {
                for (const hook of t.before) await hook();
                try { await t.fn(); } finally {
                    for (const hook of t.after) await hook();
                }
            })();
            const timeout = new Promise((resolve, reject) => {
                timer = setTimeout(() => {
                    if (!finished) { reject(Object.assign(new Error(`took longer than ${t.timeout}s`), {name: 'Timeout'})); }
                }, t.timeout * 1000);
            });
            await Promise.race([body, timeout]);
            finished = true;
            return {...base, status: 'pass', ms: performance.now() - started};
        } catch (e) {
            finished = true;
            if (e instanceof Stopped) {
                return {...base, status: 'fail', ms: performance.now() - started, message: `stopped (${e.message})`};
            }
            return problem(e);
        } finally { clearTimeout(timer); }
    }
}
const MAX_TEXT = 300;
const chainAt = (line, word) => {
    if (!word) return null;
    const upTo = line.slice(0, word.endColumn - 1);
    const match = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)$/.exec(upTo);
    if (!match) return null;
    const startColumn = upTo.length - match[1].length + 1;
    if (/[.)\]]\s*$/.test(line.slice(0, startColumn - 1))) return null;
    if (/^\s*\(/.test(line.slice(word.endColumn - 1))) return null;
    return {parts: match[1].split('.').map(part => part.trim()), startColumn, endColumn: word.endColumn};
};
const isTarget = value => Boolean(value) && typeof value === 'object' &&
    'isStage' in value && 'isClone' in value && typeof value.goTo === 'function';
const describe = value => {
    if (value === null) return 'null';
    if (typeof value === 'undefined') return 'undefined';
    if (typeof value === 'function') return null;
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value !== 'object') return String(value);
    if (isTarget(value)) {
        if (value.isStage) return 'the stage';
        return `sprite "${value.name}"${value.isClone ? ' (a clone)' : ''} at (${Math.round(value.x)}, ` +
            `${Math.round(value.y)})${value.exists ? '' : ', deleted'}`;
    }
    if (value instanceof Set) return `Set of ${value.size}: ${JSON.stringify([...value]).slice(0, MAX_TEXT)}`;
    if (value instanceof Map) return `Map of ${value.size}`;
    try {
        const seen = new WeakSet();
        const text = JSON.stringify(value, (key, v) => {
            if (typeof v === 'function') return;
            if (v && typeof v === 'object') {
                if (seen.has(v)) return '[circular]';
                seen.add(v);
                if (isTarget(v)) return `<${v.name}>`;
            }
            return v;
        });
        const prefix = Array.isArray(value) ? `${value.length} item${value.length === 1 ? '' : 's'}: ` : '';
        return prefix + (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text);
    } catch (e) { return Object.prototype.toString.call(value); }
};
const namesIn = text => {
    const holds = new Map();
    const blockspaces = new Map();
    const holdRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(me|world)\s*\.\s*hold\s*\(/g;
    const bsRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Blockspace\s*\(\s*(["'])((?:(?!\2).)*)\2/g;
    for (let m = holdRe.exec(text); m; m = holdRe.exec(text)) holds.set(m[1], m[2]);
    for (let m = bsRe.exec(text); m; m = bsRe.exec(text)) blockspaces.set(m[1], m[3]);
    return {holds, blockspaces};
};
const liveValue = (host, target, code, parts) => {
    if (!host || !target) return null;
    const instance = host.instances.get(target);
    const [root, ...rest] = parts;
    const {holds, blockspaces} = namesIn(code);
    if (blockspaces.has(root) && rest.length === 0) {
        const entry = host.spaces.entry(target.sprite, blockspaces.get(root));
        if (!entry) return null;
        const blocks = [...entry.blockIds].filter(id => {
            const block = target.blocks._blocks[id];
            return block && !block.shadow;
        }).length;
        const running = [...host.spaces.runs].filter(run => run.blockspace === entry.ref).length;
        return `blockspace "${entry.id}" · ${blocks} block${blocks === 1 ? '' : 's'}` +
            `${entry.params.length ? ` · (${entry.params.join(', ')})` : ''} · ${running} running`;
    }
    let value;
    if (root === 'me' || root === 'world') {
        if (!instance) return '_not running yet_';
        value = root === 'me' ? instance.me : instance.world;
    } else if (holds.has(root)) {
        value = holds.get(root) === 'world' ? host.worldHold.values : host.holdStoreFor(target).values;
    } else { return null; }
    try {
        for (const part of rest) {
            if (value === null || typeof value === 'undefined') return null;
            value = value[part];
        }
    } catch (e) { return null; }
    const text = describe(value);
    if (text === null) return null;
    const clones = target.sprite.clones.length - 1;
    const note = root === 'me' && clones > 0 ?
        `\n\n_the sprite itself, it has ${clones} clone${clones === 1 ? '' : 's'}_` :
        '';
    return `\`${text.replace(/`/g, '\\`')}\`${note}`;
};
const isIdent = c => /[A-Za-z0-9_$]/.test(c || '');
const blank = src => {
    let out = '';
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
            const line = src[i + 1] === '/';
            const end = line ? src.indexOf('\n', i) : src.indexOf('*/', i + 2);
            const stop = end < 0 ? src.length : (line ? end : end + 2);
            out += src.slice(i, stop).replace(/[^\n]/g, ' ');
            i = stop - 1;
        } else if (c === '"' || c === '\'' || c === '`') {
            let j = i + 1;
            for (; j < src.length; j++) {
                if (src[j] === '\\') { j++; } else if (src[j] === c || (src[j] === '\n' && c !== '`')) { break; }
            }
            out += c + src.slice(i + 1, j).replace(/[^\n]/g, ' ') + (src[j] === c ? c : '');
            i = j;
        } else { out += c; }
    }
    return out;
};
const closeOf$1 = (code, open) => {
    let depth = 0;
    for (let i = open; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}' && --depth === 0) return i + 1;
    }
    return -1;
};
const ENDLESS = /\b(?:while\s*\(\s*(?:true|1)\s*\)|for\s*\(\s*;\s*;\s*\)|do\b(?=\s*\{))\s*\{?/g;
const NEEDS_AWAIT = ['wait', 'waitUntil', 'nextFrame', 'repeat', 'broadcastAndWait', 'glide'];
const BACKGROUND_OK = ['glide', 'repeat', 'broadcastAndWait'];
const FLOATING = new RegExp(`(?:^|[;{}\\n])\\s*((?:(?:me|world|this)\\s*\\.\\s*)?(?:${NEEDS_AWAIT.join('|')})\\s*\\()`, 'g');
const lint = source => {
    const code = blank(source);
    const problems = [];
    ENDLESS.lastIndex = 0;
    for (let m = ENDLESS.exec(code); m; m = ENDLESS.exec(code)) {
        const isDo = m[0].startsWith('do');
        const open = code.indexOf('{', m.index + (isDo ? 2 : 0));
        if (open < 0) continue;
        const end = closeOf$1(code, open);
        if (end < 0) continue;
        if (isDo && !/^\s*while\s*\(\s*(?:true|1)\s*\)/.test(code.slice(end))) continue;
        const body = code.slice(open, end);
        if (/\bawait\b|\bbreak\b|\breturn\b|\bthrow\b/.test(body)) continue;
        problems.push({
            start: m.index,
            end: m.index + m[0].replace(/\s*\{$/, '').length,
            severity: 'error',
            message: 'This loop never awaits, so it would freeze the game. ' +
                'Use `for await (const dt of frames()) { ... }` or `await nextFrame()` inside it.'
        });
    }
    FLOATING.lastIndex = 0;
    for (let m = FLOATING.exec(code); m; m = FLOATING.exec(code)) {
        const start = m.index + m[0].length - m[1].length;
        const name = /([A-Za-z]+)\s*\($/.exec(m[1])[1];
        if (isIdent(code[start - 1])) continue;
        problems.push({
            start,
            end: start + m[1].replace(/\s*\($/, '').length,
            severity: 'warning',
            message: `${name}() returns a promise... without \`await\` the code doesn't wait for it${
                BACKGROUND_OK.includes(name) ? ' (fine if you want it to run in the background)' : ''}`
        });
    }
    return problems;
};
const NAME_WIDGETS = ['sprite', 'costume', 'sound', 'backdrop', 'broadcast', 'variable', 'list', 'key', 'easing', 'animation'];
const WIDGETS = ['number', 'slider', 'angle', 'color', 'toggle', 'select', ...NAME_WIDGETS];
const KEY_NAMES = ['space', 'up arrow', 'down arrow', 'left arrow', 'right arrow', 'enter', 'any',
    ...'abcdefghijklmnopqrstuvwxyz0123456789'];
const METHODS = ['props', 'value', 'args', 'snippet'];
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const editorApi = Object.freeze(METHODS.reduce((api, name) => { api[name] = () => {}; return api; }, {}));
const isIdentChar = c => /[\w$]/.test(c || '');
const isQuote = c => c === '"' || c === '\'' || c === '`';
const skipSpace = (code, i) => {
    while (i < code.length && /\s/.test(code[i])) i++;
    return i;
};
const skipExpr = (code, i) => {
    let depth = 0;
    for (; i < code.length; i++) {
        const c = code[i];
        if (isQuote(c)) {
            const close = code.indexOf(c, i + 1);
            if (close < 0) return code.length;
            i = close;
        } else if (c === '(' || c === '[' || c === '{') { depth++; } else if (c === ')' || c === ']' || c === '}') {
            if (depth === 0) return i;
            depth--;
        } else if ((c === ',' || c === ';') && depth === 0) { return i; }
    }
    return i;
};
const unescape = text => text.replace(/\\(.)/g, (m, c) => ({n: '\n', t: '\t'}[c] || c));
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
const WORD = /^(?:true|false|null)(?![\w$])/;
let readValue = null;
const readList = (src, code, open, closer) => {
    const items = [];
    let i = open + 1;
    for (;;) {
        i = skipSpace(code, i);
        if (code[i] === closer) return {type: 'array', start: open, end: i + 1, items};
        if (code[i] === ',') { i++; continue; }
        if (i >= code.length || ')]};'.includes(code[i])) { return {type: 'array', start: open, end: i, items, unclosed: true}; }
        const item = readValue(src, code, i);
        items.push(item);
        i = Math.max(item.next, i + 1);
    }
};
const readObject = (src, code, open) => {
    const entries = [];
    let i = open + 1;
    for (;;) {
        i = skipSpace(code, i);
        if (code[i] === '}') return {type: 'object', start: open, end: i + 1, entries};
        if (code[i] === ',') { i++; continue; }
        if (i >= code.length || ')];'.includes(code[i])) {
            return {type: 'object', start: open, end: i, entries, unclosed: true};
        }
        let key = null;
        const word = /^[A-Za-z_$][\w$]*/.exec(code.slice(i, i + 80));
        if (word) { key = word[0]; i += key.length; } else if (code[i] === '"' || code[i] === '\'') {
            const close = code.indexOf(code[i], i + 1);
            if (close < 0) return {type: 'object', start: open, end: code.length, entries, unclosed: true};
            key = unescape(src.slice(i + 1, close));
            i = close + 1;
        }
        if (key !== null) {
            const colon = skipSpace(code, i);
            if (code[colon] === ':') {
                const value = readValue(src, code, colon + 1);
                entries.push({key, value});
                i = value.next;
                continue;
            }
            entries.push({key, value: null});
        }
        i = Math.max(skipExpr(code, i), i + (key === null ? 1 : 0));
    }
};
readValue = (src, code, at) => {
    const start = skipSpace(code, at);
    const c = code[start];
    let node = null;
    if (c === '{') { node = readObject(src, code, start); } else if (c === '[') { node = readList(src, code, start, ']'); } else if (isQuote(c)) {
        const close = code.indexOf(c, start + 1);
        const inside = close < 0 ? '' : src.slice(start + 1, close);
        if (close >= 0 && !(c === '`' && inside.includes('${')) && !inside.includes('\n')) {
            node = {type: 'string', start, end: close + 1, value: unescape(inside), quote: c};
        }
    } else {
        const number = NUMBER.exec(code.slice(start, start + 40));
        const word = number ? null : WORD.exec(code.slice(start, start + 6));
        if (number) { node = {type: 'number', start, end: start + number[0].length, value: Number(number[0])}; } else if (word) {
            node = {
                type: word[0] === 'null' ? 'null' : 'boolean',
                start,
                end: start + word[0].length,
                value: word[0] === 'null' ? null : word[0] === 'true'
            };
        }
    }
    if (node) {
        const next = skipSpace(code, node.end);
        const ended = next >= code.length || ',)]};'.includes(code[next]) ||
            (code.slice(node.end, next).includes('\n') && isIdentChar(code[next]));
        if (ended || node.unclosed) return {...node, next};
    }
    const end = skipExpr(code, start);
    return {type: 'other', start, end, next: end};
};
const NOT_PLAIN = {};
const toPlain = node => {
    if (!node || node.type === 'other' || node.unclosed) throw NOT_PLAIN;
    if (node.type === 'array') return node.items.map(toPlain);
    if (node.type === 'object') {
        const out = {};
        node.entries.forEach(entry => { out[entry.key] = toPlain(entry.value); });
        return out;
    }
    return node.value;
};
const isScalar = value => typeof value === 'string' || typeof value === 'number';
const numberOr = (value, fallback) => (typeof value === 'number' && isFinite(value) ? value : fallback);
let normalizeFields = null;
const normalizeSpec = raw => {
    if (typeof raw === 'string') return WIDGETS.includes(raw) ? normalizeSpec({type: raw}) : null;
    if (Array.isArray(raw)) return normalizeSpec({type: 'select', options: raw});
    if (!raw || typeof raw !== 'object') return null;
    let type = raw.type;
    if (typeof type === 'undefined') {
        if (raw.fields && typeof raw.fields === 'object') type = 'props';
        else if (Array.isArray(raw.options)) type = 'select';
        else if (typeof raw.min === 'number' && typeof raw.max === 'number') type = 'slider';
        else if (['min', 'max', 'step'].some(name => typeof raw[name] === 'number')) type = 'number';
        else return {type: 'props', fields: normalizeFields(raw)};
    }
    if (type === 'props') return {type, fields: normalizeFields(raw.fields)};
    if (!WIDGETS.includes(type)) return null;
    const spec = {type};
    if (typeof raw.label === 'string') spec.label = raw.label;
    if (isScalar(raw.default) || typeof raw.default === 'boolean') spec.default = raw.default;
    if (type === 'number' || type === 'slider' || type === 'angle') {
        const angle = type === 'angle';
        const bounded = type !== 'number';
        spec.min = numberOr(raw.min, angle ? -180 : (bounded ? 0 : -Infinity));
        spec.max = numberOr(raw.max, angle ? 180 : (bounded ? 100 : Infinity));
        if (spec.max < spec.min) [spec.min, spec.max] = [spec.max, spec.min];
        if (numberOr(raw.step, 0) > 0) spec.step = raw.step;
    }
    if (type === 'select') {
        spec.options = (Array.isArray(raw.options) ? raw.options : []).filter(isScalar);
        if (!spec.options.length) return null;
    }
    return spec;
};
normalizeFields = raw => {
    const fields = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fields;
    Object.keys(raw).forEach(key => {
        const spec = normalizeSpec(raw[key]);
        if (spec) fields[key] = spec;
    });
    return fields;
};
const CALL = new RegExp(`\\beditor\\s*\\.\\s*(${METHODS.join('|')})\\s*\\(`, 'g');
const describeCall = (method, args) => {
    const name = args[0];
    if (!name || name.type !== 'string' || !name.value) {
        return {problem: `editor.${method}() needs a name first, written out as a string`};
    }
    if (method !== 'snippet' && !IDENTIFIER.test(name.value)) {
        return {problem: `"${name.value}" isn't a name code can use (letters, digits, _ and $)`};
    }
    const unreadable = `editor.${method}("${name.value}", ...) is read from the text, without running ` +
        'the code: write its values out (no variables or calculations)';
    try {
        if (method === 'snippet') {
            if (!args[1] || args[1].type !== 'string') {
                return {problem: 'editor.snippet() needs the code it writes, as a string in ordinary quotes'};
            }
            return {snippet: {
                prefix: name.value,
                body: args[1].value,
                description: args[2] && args[2].type === 'string' ? args[2].value : ''
            }};
        }
        const plain = toPlain(args[1]);
        if (method === 'args') {
            if (!Array.isArray(plain)) return {problem: 'editor.args() needs a list: one entry per argument'};
            return {specs: plain.map(normalizeSpec)};
        }
        if (method === 'props') {
            if (!plain || typeof plain !== 'object' || Array.isArray(plain)) {
                return {problem: 'editor.props() needs an object: a widget for each property'};
            }
            return {spec: {type: 'props', fields: normalizeFields(plain)}};
        }
        const spec = normalizeSpec(plain);
        return spec ? {spec} : {problem: `editor.value() doesn't know that widget. There's ${WIDGETS.join(', ')}`};
    } catch (e) {
        if (e !== NOT_PLAIN) throw e;
        return {problem: unreadable};
    }
};
const findEditorCalls = (src, code = blank(src)) => {
    const found = [];
    CALL.lastIndex = 0;
    for (let m = CALL.exec(code); m; m = CALL.exec(code)) {
        if (code[m.index - 1] === '.') continue;
        const list = readList(src, code, m.index + m[0].length - 1, ')');
        const args = list.items;
        found.push({
            method: m[1],
            name: args[0] && args[0].type === 'string' ? args[0].value : null,
            start: m.index,
            end: list.end,
            ...describeCall(m[1], args)
        });
        CALL.lastIndex = Math.max(list.end, m.index + m[0].length);
    }
    return found;
};
const collectHints = sources => {
    const hints = {values: new Map(), args: new Map(), snippets: []};
    sources.forEach(src => {
        if (typeof src !== 'string' || !src.includes('editor')) return;
        findEditorCalls(src).forEach(call => {
            if (call.problem) return;
            if (call.snippet) hints.snippets.push(call.snippet);
            else if (call.specs) hints.args.set(call.name, call.specs);
            else hints.values.set(call.name, call.spec);
        });
    });
    return hints;
};
const fits = (spec, node) => {
    switch (spec.type) {
    case 'number':
    case 'slider':
    case 'angle':
        return node.type === 'number';
    case 'toggle':
        return node.type === 'boolean';
    case 'color':
        return node.type === 'string' && COLOR.test(node.value);
    default:
        return node.type === 'string' || node.type === 'number';
    }
};
const escapeRegExp = text => text.replace(/[$]/g, '\\$');
const findSites = (src, hints) => {
    const sites = new Map();
    const objects = [];
    if (!hints || (!hints.values.size && !hints.args.size)) return {sites: [], objects};
    const code = blank(src);
    const defs = findEditorCalls(src, code);
    const inDef = i => defs.some(def => i >= def.start && i < def.end);
    const apply = (spec, node) => {
        if (!spec || !node) return;
        if (node.type === 'array') { node.items.forEach(item => apply(spec, item)); } else if (spec.type === 'props') {
            if (node.type !== 'object') return;
            objects.push({
                start: node.start,
                end: node.end,
                closed: !node.unclosed,
                fields: spec.fields,
                keys: node.entries.map(entry => entry.key)
            });
            node.entries.forEach(entry => apply(spec.fields[entry.key], entry.value));
        } else if (node.type !== 'object' && node.type !== 'other' && fits(spec, node) && !sites.has(node.start)) {
            sites.set(node.start, {
                start: node.start,
                end: node.end,
                spec,
                valueType: node.type,
                value: node.value,
                quote: node.quote || '"'
            });
        }
    };
    const each = (name, onCall, onValue) => {
        const re = new RegExp(`${escapeRegExp(name)}(?![\\w$])`, 'g');
        for (let m = re.exec(code); m; m = re.exec(code)) {
            if (isIdentChar(code[m.index - 1]) || inDef(m.index)) continue;
            const after = skipSpace(code, m.index + name.length);
            if (code[after] === '(') {
                onCall(readList(src, code, after, ')').items);
            } else if (onValue && (code[after] === ':' ||
                (code[after] === '=' && code[after + 1] !== '=' && code[after + 1] !== '>'))) {
                onValue(readValue(src, code, after + 1));
            }
        }
    };
    hints.args.forEach((specs, name) => { each(name, args => args.forEach((arg, i) => apply(specs[i], arg))); });
    hints.values.forEach((spec, name) => {
        each(name, args => !hints.args.has(name) && args.forEach(arg => apply(spec, arg)), node => apply(spec, node));
    });
    return {sites: [...sites.values()].sort((a, b) => a.start - b.start), objects};
};
const decimalsOf = n => {
    const text = String(n);
    if (/e-/i.test(text)) return Number(text.split(/e-/i)[1]) || 0;
    const dot = text.indexOf('.');
    return dot < 0 ? 0 : text.length - dot - 1;
};
const stepOf = (spec, text) => spec.step || Math.pow(10, -Math.min(decimalsOf(text), 6));
const formatNumber = (value, spec, step) => {
    const clamped = Math.min(spec.max, Math.max(spec.min, value));
    return String(Number(clamped.toFixed(Math.min(decimalsOf(step), 10))));
};
const quoted = (text, quote) => {
    const json = JSON.stringify(String(text));
    if (quote === '"') return json;
    const body = json.slice(1, -1).replace(/\\"/g, '"');
    return quote + body.split(quote).join(`\\${quote}`) + quote;
};
const literalFor = (site, value) => {
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return quoted(value, site.valueType === 'string' ? site.quote : '"');
};
const objectAt = (src, objects, offset) => {
    let best = null;
    objects.forEach(object => {
        if (offset <= object.start || offset > object.end - (object.closed ? 1 : 0)) return;
        if (!best || object.start > best.start) best = object;
    });
    if (!best) return null;
    const before = blank(src.slice(best.start + 1, offset)).replace(/[\w$]*$/, '');
    let depth = 0;
    for (const c of before) {
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
    }
    const last = before.trim().slice(-1);
    return depth === 0 && (last === '' || last === ',') ? best : null;
};
const defaultFor = (spec, names = []) => {
    if (typeof spec.default !== 'undefined') return spec.default;
    switch (spec.type) {
    case 'number':
    case 'slider':
    case 'angle':
        return Math.min(spec.max, Math.max(spec.min, 0));
    case 'toggle':
        return false;
    case 'color':
        return '#ff0000';
    case 'select':
        return spec.options[0];
    case 'props':
        return null;
    default:
        return names.length ? names[0] : '';
    }
};
const COLOR_STRING = /(["'`])(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl)a?\([^()"'`\n]*\))\1/gi;
const clamp01 = v => Math.min(1, Math.max(0, v));
const hslToRgb = (h, s, l) => {
    const a = s * Math.min(l, 1 - l);
    const f = n => { const k = (n + (h / 30)) % 12; return l - (a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
    return {red: f(0), green: f(8), blue: f(4)};
};
const rgbToHsl = ({red, green, blue}) => {
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const l = (max + min) / 2;
    const d = max - min;
    if (!d) return {h: 0, s: 0, l};
    const s = d / (1 - Math.abs((2 * l) - 1));
    let h;
    if (max === red) h = ((green - blue) / d) % 6;
    else if (max === green) h = ((blue - red) / d) + 2;
    else h = ((red - green) / d) + 4;
    return {h: ((h * 60) + 360) % 360, s, l};
};
const parseColor = text => {
    if (text[0] === '#') {
        if (!COLOR.test(text)) return null;
        let hex = text.slice(1);
        if (hex.length < 6) hex = hex.replace(/./g, c => c + c);
        const channel = i => parseInt(hex.slice(i, i + 2), 16) / 255;
        return {red: channel(0), green: channel(2), blue: channel(4), alpha: hex.length === 8 ? channel(6) : 1, format: 'hex'};
    }
    const m = /^(rgb|hsl)a?\(([^)]*)\)$/i.exec(text);
    if (!m) return null;
    const parts = m[2].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    const num = (part, percentOf) => {
        const n = /^[-+]?(?:\d+\.?\d*|\.\d+)(%|deg)?$/.exec(part);
        if (!n) return NaN;
        return n[1] === '%' ? parseFloat(part) / 100 * percentOf : parseFloat(part);
    };
    const alpha = parts.length === 4 ? clamp01(num(parts[3], 1)) : 1;
    const format = m[1].toLowerCase();
    let rgb;
    if (format === 'rgb') {
        rgb = {red: num(parts[0], 255) / 255, green: num(parts[1], 255) / 255, blue: num(parts[2], 255) / 255};
    } else { rgb = hslToRgb(((num(parts[0], 360) % 360) + 360) % 360, clamp01(num(parts[1], 1)), clamp01(num(parts[2], 1))); }
    if ([rgb.red, rgb.green, rgb.blue, alpha].some(v => isNaN(v))) return null;
    return {red: clamp01(rgb.red), green: clamp01(rgb.green), blue: clamp01(rgb.blue), alpha, format};
};
const round = (v, places = 0) => Number(v.toFixed(places));
const colorTexts = color => {
    const {red, green, blue, alpha} = color;
    const part = v => Math.round(v * 255).toString(16)
        .padStart(2, '0');
    const {h, s, l} = rgbToHsl(color);
    const a = alpha < 1 ? `, ${round(alpha, 2)}` : '';
    const fn = alpha < 1 ? 'a' : '';
    return {
        hex: `#${part(red)}${part(green)}${part(blue)}${alpha < 1 ? part(alpha) : ''}`,
        rgb: `rgb${fn}(${round(red * 255)}, ${round(green * 255)}, ${round(blue * 255)}${a})`,
        hsl: `hsl${fn}(${round(h)}, ${round(s * 100)}%, ${round(l * 100)}%${a})`
    };
};
const findColors = src => {
    if (!/#|rgb|hsl/i.test(src)) return [];
    const code = blank(src);
    const found = [];
    COLOR_STRING.lastIndex = 0;
    for (let m = COLOR_STRING.exec(src); m; m = COLOR_STRING.exec(src)) {
        const end = m.index + m[0].length;
        if (code[m.index] !== m[1] || code[end - 1] !== m[1] || code.slice(m.index + 1, end - 1).trim()) continue;
        const color = parseColor(m[2]);
        if (color) found.push({start: m.index, end, color});
    }
    return found;
};
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const WRAPPER_OPENING = '"use strict";{';
const wrapSource = (source, url) => `${WRAPPER_OPENING}${source}\n}\n//# sourceURL=${url}`;
let lineOffset = null;
const measureLineOffset = () => {
    if (lineOffset !== null) return lineOffset;
    lineOffset = 0;
    const probe = new Function('a', wrapSource('return new Error("probe");', 'dimod-blockspace-probe.js'));
    const match = /dimod-blockspace-probe\.js:(\d+)/.exec(String(probe().stack));
    if (match) lineOffset = Number(match[1]) - 1;
    return lineOffset;
};
const RESERVED_WORLD_EVENTS = [
    'flag', 'preflag', 'stop', 'tick', 'key', 'keyup', 'mousedown', 'mouseup', 'broadcast', 'backdrop',
    'change', 'cloud', 'resize', 'animation', 'animationend', 'scene',
    'server:data', 'server:connect', 'server:disconnect', 'server:relay',
    'server:join', 'server:leave'
];
const TARGET_EVENTS = [
    'click', 'delete', 'touch', 'untouch', 'change', 'clone', 'cloned', 'costume', 'say', 'animation', 'animationend',
    'iris:type', 'iris:done', 'iris:charanimationdone'
];
const FILTERED_EVENTS = [
    'key', 'keyup', 'broadcast', 'backdrop', 'touch', 'untouch', 'change', 'cloud', 'animation', 'scene', 'server:relay'
];
const CASE_SENSITIVE_EVENTS = ['change', 'cloud', 'server:relay'];
const normalizeFilter = (event, value) => (typeof value === 'string' && !CASE_SENSITIVE_EVENTS.includes(event) ?
    value.toLowerCase() :
    value);
class ModuleInstance {
    constructor (host, target, source) {
        this.runtimeHost = host;
        this.target = target;
        this.source = source;
        this.alive = true;
        this._wrapped = new Map();
        this._offs = new Set();
        this.declared = null;
        this.url = `blockspace/${encodeURIComponent(target.getName())}.js`;
        this.module = {exports: {}};
        this.exportGetters = null;
        this.reexports = [];
        this.started = false;
        this.waitingOn = new Map();
    }
    wrap (target) {
        if (!target) return null;
        let api = this._wrapped.get(target);
        if (!api) { api = targetProxy(new TargetApi(this, target)); this._wrapped.set(target, api); }
        return api;
    }
    assertAlive () {
        if (!this.alive) throw new Stopped('disposed');
    }
    invoke (fn, ...args) { return this.invokeAs(null, fn, ...args); }
    invokeAs (label, fn, ...args) {
        if (!this.alive) return false;
        const started = performance.now();
        try {
            const result = fn(...args);
            if (result && typeof result.then === 'function') { result.then(null, e => this.reportError(e)); }
            return true;
        } catch (e) { this.reportError(e); return false; } finally { this.runtimeHost.profiler.record(this, label || 'callback', performance.now() - started); }
    }
    invokeSafely (fn) {
        try { return fn(); } catch (e) { this.reportError(e); return null; }
    }
    invokeForResult (fn, ...args) { return this.invokeForResultAs(null, fn, ...args); }
    invokeForResultAs (label, fn, ...args) {
        if (!this.alive) return Promise.resolve();
        const started = performance.now();
        try { return Promise.resolve(fn(...args)).then(null, e => this.reportError(e)); } catch (e) { this.reportError(e); return Promise.resolve(); } finally { this.runtimeHost.profiler.record(this, label || 'callback', performance.now() - started); }
    }
    lineIn (stack) { const where = this.locationsIn(stack); return where.length ? where[0].line : null; }
    locationsIn (stack) {
        const escaped = this.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`${escaped}:(\\d+)(?::(\\d+))?`, 'g');
        const text = String(stack);
        const found = [];
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const line = Number(match[1]) - measureLineOffset();
            let column = match[2] ? Number(match[2]) : null;
            if (column !== null && line === 1) column = Math.max(1, column - WRAPPER_OPENING.length);
            if (line >= 1) found.push({line, column});
        }
        return found;
    }
    callerLine () { return this.lineIn(new Error().stack); }
    reportError (error) {
        if (error instanceof Stopped) return;
        const where = this.locationsIn(error && error.stack);
        const text = error && error.name && error.message ?
            `${error.name}: ${error.message}` :
            String(error);
        this.runtimeHost.emitLog(this.target, 'error', text, where.length ? where[0].line : null, {
            column: where.length ? where[0].column : null,
            frames: where.slice(1, 6)
        });
    }
    _addOff (off) { this._offs.add(off); return () => { off(); this._offs.delete(off); }; }
    onWorld (event, filter, fn) {
        if (typeof filter === 'function' && typeof fn === 'undefined') { fn = filter; filter = null; }
        if (typeof event !== 'string') throw new TypeError('world.on() needs an event name');
        if (typeof fn !== 'function') throw new TypeError(`world.on("${event}") needs a function`);
        if (TARGET_EVENTS.includes(event) && !RESERVED_WORLD_EVENTS.includes(event)) {
            throw new TypeError(`"${event}" is a sprite event, use me.on("${event}", ...)`);
        }
        if (filter !== null && !FILTERED_EVENTS.includes(event) && RESERVED_WORLD_EVENTS.includes(event)) {
            throw new TypeError(`world.on("${event}") doesn't take a filter`);
        }
        const host = this.runtimeHost;
        if (event === 'tick') {
            const loop = host.clock.loop(this, fn, {killOnStop: false, kind: 'tick'});
            return this._addOff(() => loop.stop());
        }
        const handler = {owner: this, scope: 'world', event, filter: normalizeFilter(event, filter), fn};
        host.handlers.add(handler);
        if (this.missed && this.missed.has(event)) this.invokeForResultAs(`on ${event}`, fn);
        return this._addOff(() => host.handlers.delete(handler));
    }
    onTarget (target, event, filter, fn) {
        if (typeof filter === 'function' && typeof fn === 'undefined') { fn = filter; filter = null; }
        if (typeof fn !== 'function') throw new TypeError(`on("${event}") needs a function`);
        if (!TARGET_EVENTS.includes(event)) {
            throw new TypeError(`Unknown sprite event "${event}", sprites have ${TARGET_EVENTS.join(', ')}; ` +
                'everything else is on world.on()');
        }
        const host = this.runtimeHost;
        if (event === 'touch' || event === 'untouch') {
            if (filter === null) {
                throw new TypeError(`on("${event}") needs something to watch, e.g. on("${event}", "edge", fn)`);
            }
            const api = this.wrap(target);
            let was = null;
            const loop = host.clock.loop(this, () => {
                if (target.isDisposed) return;
                const now = api.touching(filter);
                if (was !== null && now !== was && now === (event === 'touch')) { this.invoke(fn); }
                was = now;
            }, {killOnStop: false, kind: event, meta: {watching: filter}});
            return this._addOff(() => loop.stop());
        }
        if (filter !== null && event !== 'change' && event !== 'animation') {
            throw new TypeError(`on("${event}") doesn't take a filter`);
        }
        const handler = {
            owner: this,
            scope: target,
            event,
            filter: filter === null ? null : normalizeFilter(event, String(filter)),
            fn
        };
        host.handlers.add(handler);
        return this._addOff(() => host.handlers.delete(handler));
    }
    once (scope, event, filter, options) {
        if (filter !== null && typeof filter === 'object' && typeof options === 'undefined') { options = filter; filter = null; }
        if (typeof filter === 'undefined') filter = null;
        this.assertAlive();
        const timeout = options && options.timeout !== null && typeof options.timeout !== 'undefined' ?
            Number(options.timeout) : null;
        const external = this.runtimeHost.clock.external(this, {
            timeout,
            timeoutError: () => Object.assign(new Error(`"${event}" didn't happen within ${timeout}s`), {name: 'TimeoutError'})
        });
        let off = null;
        const fn = value => {
            external.resolve(value);
            if (off) off();
        };
        off = scope === 'world' ? this.onWorld(event, filter, fn) : this.onTarget(scope, event, filter, fn);
        external.promise.then(null, () => off());
        return external.promise;
    }
    watch (expr, fn, {on = 'true'} = {}) {
        this.assertAlive();
        if (typeof expr !== 'function') {
            throw new TypeError('world.watch() needs a function to watch, ' +
                'e.g. world.watch(() => world.score > 10, fn)');
        }
        if (typeof fn !== 'function') throw new TypeError('world.watch() needs a function to run');
        if (on !== 'true' && on !== 'change') throw new TypeError('world.watch(): on is "true" or "change"');
        let primed = on === 'true';
        let was = on === 'true' ? false : null;
        const loop = this.runtimeHost.clock.loop(this, () => {
            const now = expr();
            if (on === 'true') {
                if (now && !was) this.invoke(fn, now);
                was = Boolean(now);
            } else {
                if (primed && !Object.is(now, was)) this.invoke(fn, now, was);
                primed = true;
                was = now;
            }
        }, {killOnStop: false, kind: 'watch'});
        return this._addOff(() => loop.stop());
    }
    expose (scope, name, fn) {
        this.assertAlive();
        if (typeof name !== 'string' || !name) {
            throw new TypeError('expose() needs a name first, e.g. me.expose("jump", height => ...)');
        }
        if (typeof fn !== 'function') throw new TypeError(`expose("${name}") needs a function`);
        return this._addOff(this.runtimeHost.expose(scope, name, {owner: this, fn}));
    }
    _globals () {
        const host = this.runtimeHost;
        const clock = host.clock;
        const me = this.wrap(this.target);
        const world = worldProxy(new WorldApi(this));
        const owner = this;
        this.me = me;
        this.world = world;
        this.tests = new TestRegistry(this);
        return {
            me,
            world,
            wait: seconds => clock.wait(owner, seconds),
            waitUntil: predicate => clock.waitUntil(owner, predicate),
            nextFrame: () => clock.nextFrame(owner),
            frames: async function * frames () {
                for (;;) yield await clock.nextFrame(owner);
            },
            tween: (subject, to, seconds, options) => (typeof subject === 'number' ?
                startTween(owner, null, null, subject, to, true) :
                startTween(owner, subject, to, seconds, options)),
            repeat: async (times, fn) => {
                const n = Math.max(0, Math.round(Number(times) || 0));
                for (let i = 0; i < n; i++) { owner.assertAlive(); await fn(i); await clock.nextFrame(owner); }
            },
            fromCast,
            toCast,
            log: (...args) => host.emitLog(this.target, 'log', args.map(a => {
                if (typeof a === 'string') return a;
                try { return JSON.stringify(a); } catch (e) { return String(a); }
            }).join(' '), owner.callerLine()),
            Stopped,
            Position,
            Skin: skinClassFor(host),
            Iris: markup(host.runtime),
            reloaded: Boolean(this.reloaded),
            editor: editorApi,
            ...this.tests.api(),
            Blockspace: function Blockspace (id, payload) { return host.spaces.declare(owner, id, payload); },
            module: this.module,
            exports: this.module.exports,
            require: name => host.requireModule(owner, name),
            __import: name => host.importModule(owner, name),
            __export: getters => {
                if (owner.target.isOriginal && host.instances.get(owner.target) === owner) { owner.exportGetters = getters; }
            },
            __reexport: ns => { owner.reexports.push(ns); }
        };
    }
    start () {
        const globals = this._globals();
        const names = Object.keys(globals);
        let run;
        try { run = new AsyncFunction(...names, wrapSource(transformModule(this.source).code, this.url)); } catch (e) { this.reportError(e); this.runtimeHost.moduleStarted(this); return; }
        this.declared = new Set();
        this.invokeAs('top level', () => run(...names.map(name => globals[name])));
        this.declared = null;
        this.runtimeHost.moduleStarted(this);
    }
    async evaluate (code) {
        this.assertAlive();
        if (!this.replScope) this.replScope = Object.create(null);
        const scope = this.replScope;
        const globals = this._globals();
        const proxy = new Proxy(scope, {
            has: (obj, name) => typeof name === 'string' && name !== 'undefined',
            get: (obj, name) => {
                if (name === Symbol.unscopables) return void 0;
                if (name in obj) return obj[name];
                if (name in globals) return globals[name];
                if (name in globalThis) return globalThis[name];
                throw new ReferenceError(`${String(name)} is not defined`);
            },
            set: (obj, name, value) => { obj[name] = value; return true; }
        });
        const text = transformModule(code, {sameLines: false}).code
            .replace(/^(\s*)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?!=)/gm, '$1$2 =');
        const compile = body => new AsyncFunction('__scope', `with (__scope) {${body}\n}`);
        const bare = text.replace(/;\s*$/, '');
        let fn = null;
        const candidates = [{head: '', tail: bare}];
        for (let i = bare.length - 1; i > 0 && candidates.length < 24; i--) {
            if (bare[i - 1] === ';' || bare[i - 1] === '\n') {
                const tail = bare.slice(i);
                if (tail.trim()) candidates.push({head: bare.slice(0, i), tail});
            }
        }
        for (const {head, tail} of candidates) {
            try { fn = compile(`${head}\nreturn (${tail}\n);`); break; } catch (e) {
            }
        }
        if (!fn) fn = compile(text);
        this.lastEval = {at: Date.now()};
        const started = performance.now();
        try {
            const value = await fn(proxy);
            scope._ = value;
            const hasValue = typeof value !== 'undefined';
            let shown = '';
            if (hasValue) {
                shown = describe(value) ||
                    (typeof value === 'function' ? `ƒ ${value.name || ''}()` : String(value));
            }
            return {value, hasValue, text: shown};
        } finally { this.runtimeHost.profiler.record(this, 'console', performance.now() - started); }
    }
    dispose () {
        if (!this.alive) return;
        this.alive = false;
        for (const off of this._offs) off();
        this._offs.clear();
        this.runtimeHost.clock.disposeOwner(this);
        this.runtimeHost.spaces.disposeOwner(this);
        this._wrapped.clear();
    }
}
const checkSyntax = source => {
    try { new AsyncFunction(wrapSource(transformModule(source).code, 'blockspace/check.js')); return null; } catch (e) { return e; }
};
const WINDOW_MS = 1000;
class Profiler {
    constructor (clock) { this.clock = clock; this._byInstance = new WeakMap(); this._windows = new WeakMap(); }
    record (instance, label, ms) {
        let win = this._windows.get(instance);
        const t = now();
        if (!win) { win = {start: t, frame: this.clock.frame, current: new Map(), last: null}; this._windows.set(instance, win); }
        if (t - win.start >= WINDOW_MS) this._roll(win, t);
        let row = win.current.get(label);
        if (!row) { row = {calls: 0, total: 0, max: 0}; win.current.set(label, row); }
        row.calls += 1;
        row.total += ms;
        if (ms > row.max) row.max = ms;
    }
    _roll (win, t) {
        const frames = Math.max(1, this.clock.frame - win.frame);
        win.last = {seconds: (t - win.start) / 1000, frames, rows: win.current};
        win.current = new Map();
        win.start = t;
        win.frame = this.clock.frame;
    }
    rowsFor (instance) {
        const win = this._windows.get(instance);
        if (!win) return {rows: [], total: 0, frames: 0};
        const t = now();
        if (t - win.start >= WINDOW_MS) this._roll(win, t);
        if (t - win.start >= WINDOW_MS * 3 && win.last) win.last = null;
        const last = win.last || {frames: Math.max(1, this.clock.frame - win.frame), rows: win.current};
        if (!last.rows.size) return {rows: [], total: 0, frames: 0};
        let total = 0;
        const rows = [...last.rows].map(([label, row]) => {
            total += row.total;
            return {label, calls: row.calls, total: row.total, max: row.max, perFrame: row.total / last.frames};
        }).sort((a, b) => b.total - a.total);
        return {rows, total: total / last.frames, frames: last.frames};
    }
}
const STORAGE_KEY = 'dimodBlockspace';
const SAVED_KEY = 'dimodBlockspaceSaved';
const WORLD_SAVED_KEY = 'dimodWorldSaved';
const DEFAULT_SOURCE = `// This sprite is complex.

world.on("flag", async () => {

});
`;
const DEFAULT_STAGE_SOURCE = `// The stage is complex.

world.on("flag", async () => {

});
`;
class BlockspaceRuntime {
    constructor (vm) {
        this.vm = vm;
        this.runtime = vm.runtime;
        this.clock = new Clock(this.runtime);
        this.profiler = new Profiler(this.clock);
        this.input = new InputMap(this.runtime, this.clock);
        this._repls = new Map();
        this.testing = 0;
        this._ghosts = new Map();
        this._ghostNext = null;
        this._testRuns = new Map();
        this.instances = new Map();
        this.handlers = new Set();
        this._parents = new WeakMap();
        this._holds = new Map();
        this.worldHold = new HoldStore();
        this._skinTargets = new Map();
        this._skins = new Set();
        this.worldValues = Object.create(null);
        this._targetValues = new WeakMap();
        this._deferred = [];
        this._pendingStarts = new Set();
        this._forgotten = new WeakSet();
        this._collecting = null;
        this._exposed = new Map();
        this._blockOwners = new WeakMap();
        this.spaces = new Blockspaces(this);
        this._moduleWaiters = [];
        this._importSeq = 0;
        this._namespaces = new WeakMap();
        this.focus = null;
        this._syncTimer = null;
    }
    setFocus (targetId, id) {
        this.flushFocus();
        const target = targetId ? this.runtime.getTargetById(targetId) : null;
        const ok = target && this.isComplex(target) && this.spaces.entry(target.sprite, id);
        this.focus = ok ? {targetId: target.id, id, sprite: target.sprite} : null;
        return Boolean(ok);
    }
    _focusedOn (container) {
        return this.focus && this.focus.sprite.blocks === container &&
            this.runtime.getTargetById(this.focus.targetId) ? this.focus : null;
    }
    _scheduleFocusSync () { clearTimeout(this._syncTimer); this._syncTimer = setTimeout(() => this.flushFocus(), 250); }
    flushFocus () {
        clearTimeout(this._syncTimer);
        this._syncTimer = null;
        const focus = this.focus;
        if (focus && this.isComplex(focus.sprite.clones[0])) this.spaces.sync(focus.sprite, focus.id);
    }
    setFocusedParams (params) {
        const focus = this.focus;
        if (!focus) return;
        this.flushFocus();
        this.spaces.setParams(focus.sprite, focus.id, params);
    }
    focusedParams () {
        const entry = this.focus && this.spaces.entry(this.focus.sprite, this.focus.id);
        return entry ? entry.params.slice() : [];
    }
    isComplex (target) { return Boolean(target && target.sprite && target.sprite.dimod && target.sprite.dimod.complex); }
    moduleStarted (instance) { instance.started = true; this._checkModuleWaiters(); }
    _moduleReady (original, seq) {
        const instance = this.instances.get(original);
        if (!instance || !instance.alive || !instance.started) return false;
        if (!instance.waitingOn.size) return true;
        const seen = new Set();
        const reaches = (from, before) => {
            if (seen.has(from)) return false;
            seen.add(from);
            for (const [sprite, at] of from.waitingOn) {
                if (at >= before) continue;
                if (sprite === this._moduleWaiterSprite) return true;
                const next = this.instances.get(sprite.clones[0]);
                if (next && reaches(next, Infinity)) return true;
            }
            return false;
        };
        return reaches(instance, seq);
    }
    _checkModuleWaiters () {
        let changed = true;
        while (changed) {
            changed = false;
            for (const waiter of this._moduleWaiters) {
                this._moduleWaiterSprite = waiter.owner.target.sprite;
                const ready = !waiter.owner.alive || this._moduleReady(waiter.original, waiter.seq);
                this._moduleWaiterSprite = null;
                if (!ready) continue;
                this._moduleWaiters = this._moduleWaiters.filter(w => w !== waiter);
                waiter.resolve();
                changed = true;
                break;
            }
        }
    }
    _moduleTarget (name) {
        const text = String(name);
        const stage = this.runtime.getTargetForStage();
        const target = stage && (text === 'Stage' || text === stage.getName()) ? stage :
            this.runtime.getSpriteTargetByName(text);
        if (!target) throw new Error(`There is no sprite called "${text}" to import from`);
        const original = target.sprite.clones[0] || target;
        if (!this.isComplex(original)) throw new Error(`${text} isn't a complex sprite, so it has nothing to export`);
        return original;
    }
    _assetModule (owner, name) {
        const host = this.runtime.dimodAssets;
        const record = host && host.byRef(name);
        if (!record) throw new Error(`There is no asset "${name}" to import`);
        if (record.ext === 'json') return JSON.parse(host.text(record));
        if (record.kind === 'text') return host.text(record);
        return new AssetApi(owner, record);
    }
    namespaceOf (original) {
        const sprite = original.sprite;
        let ns = this._namespaces.get(sprite);
        if (ns) return ns;
        const current = () => {
            const instance = this.instances.get(sprite.clones[0]);
            return instance && instance.alive ? instance : null;
        };
        const read = key => {
            const instance = current();
            if (!instance) return void 0;
            const getters = instance.exportGetters;
            if (getters && Object.prototype.hasOwnProperty.call(getters, key)) {
                try { return getters[key](); } catch (e) { return void 0; }
            }
            for (const other of instance.reexports) if (key !== 'default' && key in other) return other[key];
            const exported = instance.module.exports;
            if (key === 'default') return exported;
            return (exported !== null && typeof exported === 'object') || typeof exported === 'function' ?
                exported[key] : void 0;
        };
        const keys = () => {
            const instance = current();
            if (!instance) return [];
            const exported = instance.module.exports;
            const found = new Set(Object.keys(instance.exportGetters || {}));
            instance.reexports.forEach(other => Object.keys(other).forEach(k => k !== 'default' && found.add(k)));
            if (exported && (typeof exported === 'object' || typeof exported === 'function')) {
                Object.keys(exported).forEach(k => found.add(k));
            }
            return [...found];
        };
        ns = new Proxy(Object.create(null), {
            get: (obj, key) => {
                if (key === Symbol.toStringTag) return 'Module';
                if (typeof key !== 'string' || key === 'then') return void 0;
                return read(key);
            },
            has: (obj, key) => typeof key === 'string' && keys().includes(key),
            ownKeys: () => keys(),
            getOwnPropertyDescriptor: (obj, key) => (typeof key === 'string' && keys().includes(key) ?
                {value: read(key), writable: false, enumerable: true, configurable: true} : void 0),
            set: () => {
                const name = original.getName();
                throw new TypeError(`${name}'s exports can only be changed by ${name} itself`);
            },
            defineProperty: () => false,
            deleteProperty: () => false
        });
        this._namespaces.set(sprite, ns);
        return ns;
    }
    async importModule (owner, name) {
        const text = String(name);
        if (text.startsWith('asset:')) {
            const value = this._assetModule(owner, text.slice(6));
            const ns = Object.create(null);
            if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof AssetApi)) {
                Object.assign(ns, value);
            }
            ns.default = value;
            return ns;
        }
        const original = this._moduleTarget(text);
        const seq = ++this._importSeq;
        owner.waitingOn.set(original.sprite, seq);
        try {
            await null;
            await new Promise(resolve => {
                this._moduleWaiters.push({owner, original, seq, resolve});
                this._checkModuleWaiters();
            });
            owner.assertAlive();
            return this.namespaceOf(original);
        } finally {
            owner.waitingOn.delete(original.sprite);
            Promise.resolve().then(() => this._checkModuleWaiters());
            if (owner.missed && !owner.waitingOn.size) {
                setTimeout(() => {
                    if (!owner.waitingOn.size) owner.missed = null;
                }, 0);
            }
        }
    }
    requireModule (owner, name) {
        const text = String(name);
        if (text.startsWith('asset:')) return this._assetModule(owner, text.slice(6));
        const original = this._moduleTarget(text);
        const instance = this.instances.get(original);
        if (instance && instance.alive && instance.started && !instance.exportGetters && !instance.reexports.length) {
            return instance.module.exports;
        }
        return this.namespaceOf(original);
    }
    getSource (target) {
        const dimod = target && target.sprite && target.sprite.dimod;
        if (dimod && typeof dimod.source === 'string') return dimod.source;
        return target && target.isStage ? DEFAULT_STAGE_SOURCE : DEFAULT_SOURCE;
    }
    _resolve (targetOrId) { return typeof targetOrId === 'string' ? this.runtime.getTargetById(targetOrId) : targetOrId; }
    setComplex (targetOrId, complex) {
        const target = this._resolve(targetOrId);
        if (!target || this.isComplex(target) === Boolean(complex)) return;
        const sprite = target.sprite;
        if (complex) {
            const source = this._absorbScripts(target);
            sprite.dimod = {complex: true, source, owners: null};
            this._syncBlocks(target);
            sprite.dimodPending = true;
            this._emitPending(target);
        } else {
            if (this.focus && this.focus.sprite === sprite) { this.flushFocus(); this.focus = null; }
            const owners = {};
            for (const entry of this.spaces.entries(sprite)) {
                const tops = sprite.blocks.getScripts().filter(id => entry.blockIds.has(id));
                tops.forEach(id => { owners[id] = entry.id; });
            }
            sprite.dimodSpaces = new Map();
            sprite.clones.forEach(t => this._stop(t));
            sprite.dimod = {complex: false, source: this.getSource(target), owners};
            if (this.vm.editingTarget && this.vm.editingTarget.sprite === sprite) {
                setTimeout(() => this.vm.emitWorkspaceUpdate(), 0);
            }
        }
        this.vm.emitTargetsUpdate(true);
        this._changed(target, 'complex');
    }
    _changed (target, kind, extra) {
        if (this._applyingRemote || !target) return;
        const original = target.sprite.clones[0] || target;
        this.vm.emit('DIMOD_BLOCKSPACE_CHANGED', {targetId: original.id, kind, ...extra});
    }
    _insertDeclarations (source, declarations) {
        if (!declarations.length) return source;
        const lines = source.split('\n');
        let at = 0;
        while (at < lines.length && lines[at].trim().startsWith('//')) at++;
        const offset = lines.slice(0, at).reduce((n, line) => n + line.length + 1, 0);
        const text = `${at > 0 ? '\n' : ''}${declarations.join('')}`;
        return source.slice(0, offset) + text + source.slice(offset);
    }
    adoptLooseScripts (targetOrId) {
        const target = this._resolve(targetOrId);
        if (!target || !this.isComplex(target)) return;
        const sprite = target.sprite;
        const owned = id => this.spaces.entries(sprite).some(entry => entry.blockIds.has(id));
        const loose = sprite.blocks.getScripts().filter(id => !owned(id));
        if (!loose.length) return;
        if (this.spaces.entry(sprite, 'main')) { this.spaces.sync(sprite, 'main'); return; }
        const payload = this.spaces.payloadFor(sprite, loose, []);
        loose.forEach(id => sprite.blocks.deleteBlock(id));
        const declaration = `new Blockspace("main", ${stringifyPayload(payload)});\n`;
        this.setSource(target, this._insertDeclarations(this.getSource(target), [declaration]));
        this.vm.emit('DIMOD_BLOCKSPACE_SOURCE_CHANGED', {spriteName: sprite.name});
    }
    applyRemotePayload (targetOrId, id, payload) {
        const target = this._resolve(targetOrId);
        if (!target || !this.isComplex(target) || !payload || typeof payload !== 'object') return;
        const sprite = target.sprite;
        const call = findBlockspaces(sprite.dimod.source).find(c => c.id === id);
        if (!call) return;
        this._applyingRemote = true;
        try {
            sprite.dimod = {...sprite.dimod, source: applyEdits(sprite.dimod.source, [payloadEdit(call, payload)])};
            if (this.spaces.entry(sprite, id)) this.spaces.materialize(sprite, id, payload);
            this.runtime.emitProjectChanged();
            this.vm.emit('DIMOD_BLOCKSPACE_SOURCE_CHANGED', {spriteName: sprite.name});
            if (this.focus && this.focus.sprite === sprite && this.focus.id === id) this.vm.emitWorkspaceUpdate();
        } finally { this._applyingRemote = false; }
    }
    applyRemote (targetOrId, dimod) {
        const target = this._resolve(targetOrId);
        if (!target || !dimod || typeof dimod.source !== 'string') return;
        const sprite = target.sprite;
        const next = {
            complex: Boolean(dimod.complex),
            source: dimod.source,
            owners: dimod.owners && typeof dimod.owners === 'object' ? dimod.owners : null
        };
        this._applyingRemote = true;
        try {
            const was = this.isComplex(target);
            if (next.complex && !was) {
                const scripts = sprite.blocks.getScripts().slice();
                for (const thread of this.runtime.threads) {
                    if (thread.blockContainer === sprite.blocks) this.runtime._stopThread(thread);
                }
                scripts.forEach(id => sprite.blocks.deleteBlock(id));
                const original = sprite.clones[0];
                if (original) original.comments = {};
                sprite.dimod = next;
                this._syncBlocks(target);
                sprite.dimodPending = true;
                this._emitPending(target);
            } else if (!next.complex && was) { this.setComplex(target, false); sprite.dimod = next; } else if (next.complex) {
                this.setSource(target, next.source, {apply: false, remote: true});
                sprite.dimod = {...sprite.dimod, owners: next.owners};
            } else { sprite.dimod = next; }
            this.vm.emitTargetsUpdate(false);
            this.vm.emit('DIMOD_BLOCKSPACE_SOURCE_CHANGED', {spriteName: sprite.name});
            if (this.focus && this.focus.sprite === sprite && next.complex) this.vm.emitWorkspaceUpdate();
        } finally { this._applyingRemote = false; }
    }
    _absorbScripts (target) {
        const sprite = target.sprite;
        const dimod = sprite.dimod || {};
        const owners = dimod.owners || {};
        const container = sprite.blocks;
        const scripts = container.getScripts().slice();
        const groups = new Map();
        for (const top of scripts) {
            const id = owners[top] || 'main';
            if (!groups.has(id)) groups.set(id, []);
            groups.get(id).push(top);
        }
        const original = sprite.clones[0];
        const looseComments = new Set(original ?
            Object.keys(original.comments).filter(id => !original.comments[id].blockId) :
            []);
        if (looseComments.size && !groups.has('main')) groups.set('main', []);
        const extraComments = id => (id === 'main' ? looseComments : null);
        let source = this.getSource(target);
        const hadBlockspaces = new Set(Object.values(owners));
        const edits = [];
        for (const call of findBlockspaces(source)) {
            if (!call.id) continue;
            const params = call.payload && Array.isArray(call.payload.params) ? call.payload.params : [];
            if (groups.has(call.id)) {
                edits.push(payloadEdit(call,
                    this.spaces.payloadFor(sprite, groups.get(call.id), params, extraComments(call.id))));
                groups.delete(call.id);
            } else if (hadBlockspaces.has(call.id)) { edits.push(payloadEdit(call, this.spaces.payloadFor(sprite, [], params))); }
        }
        source = applyEdits(source, edits);
        const declarations = [...groups].map(([id, tops]) =>
            `new Blockspace(${JSON.stringify(id)}, ${
                stringifyPayload(this.spaces.payloadFor(sprite, tops, [], extraComments(id)))});\n`);
        source = this._insertDeclarations(source, declarations);
        for (const thread of this.runtime.threads) {
            if (thread.blockContainer === container && scripts.includes(thread.topBlock)) { this.runtime._stopThread(thread); }
        }
        const moved = new Set(Object.keys(container._blocks));
        scripts.forEach(top => container.deleteBlock(top));
        if (original) {
            for (const commentId in original.comments) {
                const c = original.comments[commentId];
                if ((c.blockId && moved.has(c.blockId)) || looseComments.has(commentId)) { delete original.comments[commentId]; }
            }
        }
        return source;
    }
    setSource (targetOrId, source, {apply = true, remote = false, typed = false} = {}) {
        const target = this._resolve(targetOrId);
        if (!target) return;
        const sprite = target.sprite;
        sprite.dimod = {...sprite.dimod, complex: this.isComplex(target), source: String(source)};
        this.runtime.emitProjectChanged();
        if (!remote) this._changed(target, typed ? 'typed' : 'source');
        if (!sprite.dimod.complex) return;
        this._syncBlocks(target);
        if (apply) { this.applySource(target); } else if (!sprite.dimodPending) { sprite.dimodPending = true; this._emitPending(target); }
    }
    applySource (targetOrId, {hot = false} = {}) {
        const target = this._resolve(targetOrId);
        if (!target || !this.isComplex(target)) return;
        const sprite = target.sprite;
        const wasPending = sprite.dimodPending;
        sprite.dimodPending = false;
        this._dropRepl(target);
        for (const t of sprite.clones) { this._stop(t); this._start(t, {hot}); }
        if (wasPending) this._emitPending(target);
    }
    _syncBlocks (target) {
        if (!this.isComplex(target)) return;
        const sprite = target.sprite;
        const seen = new Set();
        for (const call of findBlockspaces(this.getSource(target))) {
            if (!call.id || seen.has(call.id)) continue;
            seen.add(call.id);
            if (call.payloadStart >= 0) {
                this.spaces.materialize(sprite, call.id, call.payload);
            } else if (!call.hasPayloadArg) { this.spaces.materialize(sprite, call.id); }
        }
        this.spaces.prune(sprite, seen);
        if (this.focus && this.focus.sprite === sprite && !seen.has(this.focus.id)) this.focus = null;
    }
    targetValues (target) {
        let values = this._targetValues.get(target);
        if (!values) { values = Object.create(null); this._targetValues.set(target, values); }
        return values;
    }
    setWorldValue (name, value) {
        const old = this.worldValues[name];
        this.worldValues[name] = value;
        if (!Object.is(old, value)) this.dispatchWorld('change', name, [value, old, name]);
    }
    setTargetValue (target, name, value) {
        const values = this.targetValues(target);
        const old = values[name];
        values[name] = value;
        if (!Object.is(old, value)) this.dispatchTarget(target, 'change', name, [value, old, name]);
    }
    _copyTargetValues (from, to) {
        const values = this._targetValues.get(from);
        if (!values) return;
        const copy = Object.create(null);
        for (const name of Object.keys(values)) copy[name] = copyValue(values[name]);
        this._targetValues.set(to, copy);
    }
    expose (scope, name, entry) {
        let names = this._exposed.get(scope);
        if (!names) { names = new Map(); this._exposed.set(scope, names); }
        names.set(name, entry);
        return () => {
            if (names.get(name) === entry) names.delete(name);
        };
    }
    callExposed (target, name, args) {
        const own = this._exposed.get(target);
        const world = this._exposed.get('world');
        const entry = (own && own.get(name)) || (world && world.get(name));
        if (!entry || !entry.owner.alive) {
            this.emitLog(target, 'error', `No JS function "${name}" for the call JS block, expose one ` +
                `with me.expose("${name}", fn) or world.expose("${name}", fn)`, null);
            return '';
        }
        const {owner, fn} = entry;
        let result;
        try { result = fn(...args.map(fromCast), owner.wrap(target)); } catch (e) { owner.reportError(e); return ''; }
        if (result && typeof result.then === 'function') {
            return Promise.resolve(result).then(toCast, e => { owner.reportError(e); return ''; });
        }
        return toCast(result);
    }
    blockOwner (target) {
        let owner = this._blockOwners.get(target);
        if (!owner) { owner = new BlockOwner(this, target); this._blockOwners.set(target, owner); }
        return owner;
    }
    tweenForBlock (target, thread, path, to, seconds, easing) {
        const owner = this.blockOwner(target);
        let tween;
        try {
            tween = startTween(owner, owner.wrap(target), {[path]: to}, seconds, {
                easing: easing || 'linear',
                onStep: () => {
                    if (thread && (thread.isKilled || !this.runtime.threads.includes(thread))) tween.stop();
                }
            });
        } catch (e) { owner.reportError(e); return; }
        if (tween.running) return tween.done.then(() => {});
    }
    callBlockspaceForBlock (caller, spriteName, id, args) {
        const owner = this.blockOwner(caller);
        const name = String(spriteName).trim();
        let runAs = caller;
        if (name && name.toLowerCase() !== 'myself') {
            runAs = name.toLowerCase() === 'stage' ?
                this.runtime.getTargetForStage() :
                this.runtime.getSpriteTargetByName(name);
            if (!runAs) { owner.reportError(new ReferenceError(`call blockspace: no sprite named "${name}"`)); return ''; }
        }
        const ref = this.spaces.refFor(runAs.sprite, String(id));
        if (!ref) {
            owner.reportError(new ReferenceError(`call blockspace: ${runAs.getName()} has no blockspace "${id}"`));
            return '';
        }
        let run;
        try { run = this.spaces.run(owner, ref, runAs, args); } catch (e) { owner.reportError(e); return ''; }
        return run.done.then(({value}) => (value === null || typeof value === 'undefined' ? '' : value));
    }
    inspect (targetOrId) {
        const target = this._resolve(targetOrId);
        if (!target) return [];
        const describeCopy = (t, instance, extra) => {
            const handlers = [...this.handlers].filter(h => h.owner === instance)
                .map(h => ({
                    on: h.scope === 'world' ? 'world' : (h.scope === t ? 'me' : h.scope.getName()),
                    event: h.event,
                    filter: h.filter,
                    stop: () => this.handlers.delete(h)
                }));
            const {loops, timers, waits} = this.clock.inspect(instance);
            const runs = [...this.spaces.runs].filter(run => run._owner === instance)
                .map(run => ({
                    blockspace: run.blockspace ? run.blockspace.id : null,
                    as: run.target.name,
                    stop: () => run.stop()
                }));
            const exposed = [];
            for (const [scope, names] of this._exposed) {
                for (const [name, entry] of names) {
                    if (entry.owner === instance) exposed.push({on: scope === 'world' ? 'world' : 'me', name});
                }
            }
            const store = this._holds.get(t);
            return {
                target: t,
                running: true,
                handlers,
                loops,
                timers,
                waits,
                runs,
                exposed,
                holds: store ? store.values : {},
                ...extra
            };
        };
        const running = target.sprite.clones.filter(t => !(this._ghosts.get(t) && this._ghosts.get(t).run === false));
        const copies = running.map(t => {
            const instance = this.instances.get(t);
            return instance ? describeCopy(t, instance, {}) : {target: t, running: false};
        });
        const original = target.sprite.clones[0] || target;
        const repl = this._repls.get(original);
        if (repl && repl.alive) copies.push(describeCopy(original, repl, {isConsole: true, holds: {}}));
        return copies;
    }
    beginGhost (info) { this._ghostNext = info; }
    endGhost () { this._ghostNext = null; }
    setGhostInfo (target, info) { this._ghosts.set(target, {...this._ghosts.get(target), ...info}); }
    clearGhostInfo (target) { this._ghosts.delete(target); }
    ghostInfo (target) { return this._ghosts.get(target) || null; }
    repl (targetOrId) {
        const target = this._resolve(targetOrId);
        if (!target) return null;
        const original = target.sprite.clones[0] || target;
        let instance = this._repls.get(original);
        if (!instance || !instance.alive) {
            instance = new ModuleInstance(this, original, '');
            this._repls.set(original, instance);
        }
        return instance;
    }
    evaluate (targetOrId, code) {
        const instance = this.repl(targetOrId);
        if (!instance) return Promise.reject(new Error('That sprite is gone'));
        return instance.evaluate(code);
    }
    _dropRepl (target) {
        const instance = this._repls.get(target);
        if (!instance) return;
        this._repls.delete(target);
        instance.dispose();
    }
    resetRepl (targetOrId) {
        const target = this._resolve(targetOrId);
        if (target) this._dropRepl(target.sprite.clones[0] || target);
    }
    checkSyntax (source) { return checkSyntax(source); }
    async runTests (targetOrId, {filter = ''} = {}) {
        const target = this._resolve(targetOrId);
        if (!target || !this.isComplex(target)) return null;
        const original = target.sprite.clones[0] || target;
        const run = {at: Date.now(), running: true, results: [], filter};
        this._testRuns.set(original.id, run);
        this.vm.emit('DIMOD_BLOCKSPACE_TESTS', {targetId: original.id});
        this.testing += 1;
        try {
            this.applySource(original);
            const instance = this.instances.get(original);
            const registry = instance && instance.tests;
            if (!registry || registry.tests.length === 0) {
                this.emitLog(original, 'log', 'No tests here... add some with test("name", () => { expect(...) })', null);
            } else {
                run.results = await registry.run({
                    filter,
                    onResult: result => {
                        run.results = [...run.results.filter(r => r !== result), result];
                        this.vm.emit('DIMOD_BLOCKSPACE_TESTS', {targetId: original.id});
                    }
                });
                const passed = run.results.filter(r => r.status === 'pass').length;
                const failed = run.results.filter(r => r.status === 'fail').length;
                const skipped = run.results.filter(r => r.status === 'skip').length;
                for (const r of run.results) {
                    if (r.status === 'skip') continue;
                    this.emitLog(original, r.status === 'pass' ? 'pass' : 'fail',
                        r.status === 'pass' ? r.name : `${r.name}: ${r.message}`, r.line || null);
                }
                this.emitLog(original, failed ? 'fail' : 'pass',
                    `${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`, null);
            }
        } finally { this.testing -= 1; run.running = false; this.vm.emit('DIMOD_BLOCKSPACE_TESTS', {targetId: original.id}); }
        return run.results;
    }
    testRun (targetOrId) {
        const target = this._resolve(targetOrId);
        if (!target) return null;
        const original = target.sprite.clones[0] || target;
        return this._testRuns.get(original.id) || null;
    }
    profileSprite (targetOrId) {
        const target = this._resolve(targetOrId);
        if (!target) return {rows: [], total: 0, copies: 0};
        const merged = new Map();
        let total = 0;
        let copies = 0;
        const add = instance => {
            const {rows, total: perFrame} = this.profiler.rowsFor(instance);
            if (!rows.length) return;
            copies += 1;
            total += perFrame;
            for (const row of rows) {
                const into = merged.get(row.label) || {label: row.label, calls: 0, total: 0, max: 0, perFrame: 0};
                into.calls += row.calls;
                into.total += row.total;
                into.perFrame += row.perFrame;
                into.max = Math.max(into.max, row.max);
                merged.set(row.label, into);
            }
        };
        for (const t of target.sprite.clones) {
            const instance = this.instances.get(t);
            if (instance) add(instance);
        }
        const repl = this._repls.get(target.sprite.clones[0] || target);
        if (repl) add(repl);
        return {rows: [...merged.values()].sort((a, b) => b.perFrame - a.perFrame), total, copies};
    }
    profileProject () {
        return this.runtime.targets
            .filter(t => t.isOriginal && this.isComplex(t))
            .map(t => ({target: t, ...this.profileSprite(t)}))
            .sort((a, b) => b.total - a.total);
    }
    isPending (target) { return Boolean(target && target.sprite && target.sprite.dimodPending); }
    restartForFlag () {
        this.worldValues = Object.create(null);
        this._targetValues = new WeakMap();
        this._deferred = [];
        this.input.clear();
        this._resetHolds('flag');
        resetSkins(this);
        for (const target of this.runtime.targets) {
            if (!target.isOriginal || !this.isComplex(target)) continue;
            const wasPending = target.sprite.dimodPending;
            target.sprite.dimodPending = false;
            this._stop(target);
            this._start(target);
            if (wasPending) this._emitPending(target);
        }
    }
    _emitPending (target) {
        const original = target.sprite.clones[0] || target;
        this.vm.emit('DIMOD_BLOCKSPACE_PENDING', {targetId: original.id, pending: Boolean(target.sprite.dimodPending)});
    }
    _start (target, {cloned = false, hot = false} = {}) {
        if (!this.isComplex(target) || target.isDisposed) return;
        const ghost = this._ghosts.get(target);
        if (ghost && ghost.run === false) return;
        this._stop(target);
        if (!target.isOriginal && !this._holds.has(target)) {
            const parent = this.parentOf(target) || target.sprite.clones[0];
            const parentStore = parent && this._holds.get(parent);
            if (parentStore) this._holds.set(target, parentStore.copy());
        }
        const instance = new ModuleInstance(this, target, this.getSource(target));
        instance.reloaded = hot;
        instance.ghost = ghost || null;
        this.instances.set(target, instance);
        instance.start();
        if (cloned) {
            this.dispatchTarget(target, 'clone', null, []);
            const parent = this.parentOf(target);
            if (parent) this.dispatchTarget(parent, 'cloned', null, owner => [owner.wrap(target)]);
        }
    }
    _stop (target) {
        if (target.isOriginal) this._dropRepl(target);
        const instance = this.instances.get(target);
        if (!instance) return;
        this.instances.delete(target);
        instance.dispose();
    }
    _forget (target) {
        if (this._forgotten.has(target)) return;
        this._forgotten.add(target);
        this.dispatchTarget(target, 'delete', null, [], true);
        this._stop(target);
        this._holds.delete(target);
        this._exposed.delete(target);
        forgetSkinTarget(this, target);
        this._pendingStarts.delete(target);
        this._ghosts.delete(target);
        for (const handler of this.handlers) {
            if (handler.scope === target) this.handlers.delete(handler);
        }
    }
    _queueStart (target) {
        this._pendingStarts.add(target);
        if (this._pendingStarts.size > 1) return;
        Promise.resolve().then(() => {
            const targets = [...this._pendingStarts];
            this._pendingStarts.clear();
            targets.forEach(t => this._start(t));
        });
    }
    parentOf (target) { return this._parents.get(target) || null; }
    holdStoreFor (target) {
        let store = this._holds.get(target);
        if (!store) { store = new HoldStore(); this._holds.set(target, store); }
        return store;
    }
    savedHolds (target) {
        const out = {};
        const store = this._holds.get(target);
        const own = store && store.savedValues();
        if (own) out[SAVED_KEY] = own;
        if (target.isStage) {
            const world = this.worldHold.savedValues();
            if (world) out[WORLD_SAVED_KEY] = world;
        }
        return Object.keys(out).length ? out : null;
    }
    _loadSavedHolds (target) {
        const data = target.extensionData;
        if (!data || typeof data !== 'object') return;
        if (data[SAVED_KEY] && typeof data[SAVED_KEY] === 'object') { this.holdStoreFor(target).saved = {...data[SAVED_KEY]}; }
        if (target.isStage && data[WORLD_SAVED_KEY] && typeof data[WORLD_SAVED_KEY] === 'object') {
            this.worldHold.saved = {...data[WORLD_SAVED_KEY]};
        }
    }
    _resetHolds (event) {
        this.worldHold.resetFor(event);
        for (const store of this._holds.values()) store.resetFor(event);
    }
    _defer (fn) { return new Promise(resolve => this._deferred.push(() => resolve(fn()))); }
    _flushDeferred () {
        if (this.runtime.paused || !this._deferred.length) return;
        const deferred = this._deferred;
        this._deferred = [];
        deferred.forEach(fn => fn());
    }
    dispatchWorld (event, filter, args) {
        if (this.runtime.paused) return [this._defer(() => Promise.all(this.dispatchWorld(event, filter, args)))];
        const key = typeof filter === 'string' && !CASE_SENSITIVE_EVENTS.includes(event) ?
            filter.toLowerCase() :
            filter;
        if (event === 'flag' || event === 'preflag') {
            for (const instance of this.instances.values()) {
                if (instance.waitingOn.size) (instance.missed || (instance.missed = new Set())).add(event);
            }
        }
        const results = [];
        for (const handler of [...this.handlers]) {
            if (handler.scope !== 'world' || handler.event !== event) continue;
            if (handler.filter !== null && handler.filter !== 'any' && handler.filter !== key) continue;
            const values = typeof args === 'function' ? args(handler.owner) : args;
            results.push(handler.owner.invokeForResultAs(`on ${handler.event}`, handler.fn, ...values));
        }
        return results;
    }
    dispatchTarget (target, event, filter, args, immediate) {
        if (this.runtime.paused && !immediate) { this._defer(() => this.dispatchTarget(target, event, filter, args)); return; }
        const key = typeof filter === 'string' && !CASE_SENSITIVE_EVENTS.includes(event) ?
            filter.toLowerCase() :
            filter;
        for (const handler of [...this.handlers]) {
            if (handler.scope !== target || handler.event !== event) continue;
            if (handler.filter !== null && filter !== null && handler.filter !== key) continue;
            const values = typeof args === 'function' ? args(handler.owner) : args;
            handler.owner.invokeAs(`me.on ${event}`, handler.fn, ...values);
        }
    }
    emitCustom (event, args) {
        if (RESERVED_WORLD_EVENTS.includes(event)) {
            throw new TypeError(`"${event}" is a built-in event and can't be emitted, pick another name`);
        }
        this.dispatchWorld(String(event), null, args);
    }
    broadcast (name, data) {
        const outer = this._collecting;
        const collecting = {data, handlers: []};
        this._collecting = collecting;
        let threads;
        try { threads = this.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: name}) || []; } finally { this._collecting = outer; }
        return {threads, handlers: collecting.handlers};
    }
    _onHatsStarted (opcode, fields, optTarget) {
        switch (opcode) {
        case 'event_whenflagclicked':
            this.dispatchWorld('flag', null, []);
            break;
        case 'event_whenbroadcastreceived': {
            const name = fields && fields.BROADCAST_OPTION;
            const collecting = this._collecting;
            const results = this.dispatchWorld('broadcast', String(name), [collecting ? collecting.data : null]);
            if (collecting) collecting.handlers.push(...results);
            break;
        }
        case 'event_whenbackdropswitchesto':
            this.dispatchWorld('backdrop', String(fields && fields.BACKDROP), []);
            break;
        case 'event_whenthisspriteclicked':
            if (optTarget && !optTarget.isStage) this.dispatchTarget(optTarget, 'click', null, []);
            break;
        case 'event_whenstageclicked':
            if (optTarget && optTarget.isStage) this.dispatchTarget(optTarget, 'click', null, []);
            break;
        case SERVER_HATS.data: {
            const client = this.vm.dimodGameClient;
            this.dispatchWorld('server:data', null, [parseServerData(client ? client.lastData : '')]);
            break;
        }
        case SERVER_HATS.connected:
            this.dispatchWorld('server:connect', null, []);
            break;
        case SERVER_HATS.disconnected:
            this.dispatchWorld('server:disconnect', null, []);
            break;
        default:
            if (IRIS_HATS[opcode] && optTarget) {
                this.dispatchTarget(optTarget, IRIS_HATS[opcode], null, irisHatArgs(opcode, optTarget));
            }
        }
    }
    emitLog (target, level, text, line, extra = {}) {
        const original = target.sprite.clones[0] || target;
        this.vm.emit('DIMOD_BLOCKSPACE_LOG', {
            targetId: original.id,
            spriteName: target.getName(),
            isClone: !target.isOriginal,
            level,
            text,
            line,
            ...extra
        });
    }
    _disposeAll () {
        for (const instance of this.instances.values()) instance.dispose();
        this.instances.clear();
        this.handlers.clear();
        this._exposed.clear();
        this._holds.clear();
        this._pendingStarts.clear();
        disposeAllSkins(this);
        this.worldHold = new HoldStore();
        this.worldValues = Object.create(null);
        this._targetValues = new WeakMap();
        this._deferred = [];
        this.clock.stopAll();
        this.spaces.runs.clear();
        this.focus = null;
    }
}
const pruneArgInputs = (container, blockId) => {
    const block = container._blocks[blockId];
    if (!block || !ARG_BLOCKS.includes(block.opcode)) return;
    const keep = new Set();
    for (let i = 0; i < argCountOf(block.mutation); i++) keep.add(argInputName(i));
    for (const name of Object.keys(block.inputs)) {
        if (!/^ARG\d*$/.test(name) || keep.has(name)) continue;
        const input = block.inputs[name];
        [input.block, input.shadow].forEach(id => {
            if (id && container._blocks[id]) container.deleteBlock(id);
        });
        delete block.inputs[name];
    }
};
const patchStorage = () => {
    if (sb3.__dimodBlockspaceWrapped) return;
    sb3.__dimodBlockspaceWrapped = true;
    const originalSerialize = sb3.serialize;
    sb3.serialize = (runtime, targetId, ...rest) => {
        let json;
        sb3.__dimodSerializing = true;
        try { json = originalSerialize(runtime, targetId, ...rest); } finally { sb3.__dimodSerializing = false; }
        if (!json || typeof json !== 'object') return json;
        const host = runtime.dimodBlockspace;
        const write = (serialized, target) => {
            const saved = host && target && target.isOriginal ? host.savedHolds(target) : null;
            if (serialized && saved) {
                serialized.extensionData = serialized.extensionData || {};
                Object.assign(serialized.extensionData, saved);
            }
            const dimod = target && target.sprite && target.sprite.dimod;
            if (!serialized || !dimod) return;
            serialized.extensionData = serialized.extensionData || {};
            serialized.extensionData[STORAGE_KEY] = {complex: dimod.complex, source: dimod.source, owners: dimod.owners || null};
        };
        if (targetId) { write(json, runtime.getTargetById(targetId)); } else { (json.targets || []).forEach(serialized => write(serialized, runtime.getTargetById(serialized.id))); }
        return json;
    };
};
const readStored = target => {
    const stored = target.extensionData && target.extensionData[STORAGE_KEY];
    if (!stored || typeof stored !== 'object' || typeof stored.source !== 'string') return null;
    const owners = stored.owners && typeof stored.owners === 'object' ? stored.owners : null;
    return {complex: Boolean(stored.complex), source: stored.source, owners};
};
const installBlockspaceRuntime = vm => {
    if (vm.runtime.dimodBlockspace) return vm.runtime.dimodBlockspace;
    const host = new BlockspaceRuntime(vm);
    const runtime = vm.runtime;
    runtime.dimodBlockspace = host;
    installBlockSpaceBlocksVM(vm);
    patchStorage();
    const originalAddTarget = runtime.addTarget.bind(runtime);
    runtime.addTarget = target => {
        const result = originalAddTarget(target);
        if (target.isOriginal) {
            const stored = readStored(target);
            if (stored && !target.sprite.dimod) target.sprite.dimod = stored;
            host._loadSavedHolds(target);
            host._syncBlocks(target);
            if (target.extensionStorage) {
                [STORAGE_KEY, SAVED_KEY, WORLD_SAVED_KEY].forEach(key => delete target.extensionStorage[key]);
            }
            if (host.isComplex(target)) host._queueStart(target);
        } else if (host.isComplex(target)) {
            if (host._ghostNext) host._ghosts.set(target, {...host._ghostNext});
            host._start(target, {cloned: true});
        }
        return result;
    };
    if (!RenderedTarget.prototype.__dimodBlockspaceWrapped) {
        RenderedTarget.prototype.__dimodBlockspaceWrapped = true;
        const originalMakeClone = RenderedTarget.prototype.makeClone;
        RenderedTarget.prototype.makeClone = function (...args) {
            const clone = originalMakeClone.apply(this, args);
            const bs = this.runtime.dimodBlockspace;
            if (clone && bs) { bs._parents.set(clone, this); bs._copyTargetValues(this, clone); }
            return clone;
        };
        const originalSetCostume = RenderedTarget.prototype.setCostume;
        RenderedTarget.prototype.setCostume = function (...args) {
            const before = this.currentCostume;
            const result = originalSetCostume.apply(this, args);
            const bs = this.runtime && this.runtime.dimodBlockspace;
            if (bs && this.currentCostume !== before) {
                const costume = this.getCurrentCostume();
                bs.dispatchTarget(this, 'costume', null, [costume ? costume.name : '', this.currentCostume]);
            }
            return result;
        };
        const originalToJSON = RenderedTarget.prototype.toJSON;
        RenderedTarget.prototype.toJSON = function (...args) {
            const json = originalToJSON.apply(this, args);
            const complex = Boolean(this.sprite && this.sprite.dimod && this.sprite.dimod.complex);
            json.dimodComplex = complex;
            if (complex && sb3.__dimodSerializing && this.sprite.dimodSpaces) {
                const blocks = {...json.blocks};
                const comments = {...json.comments};
                for (const entry of this.sprite.dimodSpaces.values()) {
                    entry.blockIds.forEach(id => delete blocks[id]);
                    entry.commentIds.forEach(id => delete comments[id]);
                }
                json.blocks = blocks;
                json.comments = comments;
            }
            return json;
        };
        const originalDuplicate = Sprite.prototype.duplicate;
        Sprite.prototype.duplicate = function (...args) {
            const dimod = this.dimod;
            return originalDuplicate.apply(this, args).then(newSprite => {
                if (dimod) newSprite.dimod = {...dimod};
                if (dimod && dimod.complex) {
                    newSprite.blocks.getScripts().slice()
                        .forEach(id => newSprite.blocks.deleteBlock(id));
                }
                return newSprite;
            });
        };
    }
    const originalEmitWorkspaceUpdate = vm.emitWorkspaceUpdate.bind(vm);
    vm.emitWorkspaceUpdate = (...args) => {
        const target = vm.editingTarget;
        const focus = target && host._focusedOn(target.blocks);
        const entry = focus && focus.targetId === target.id && host.spaces.entry(target.sprite, focus.id);
        if (!entry) return originalEmitWorkspaceUpdate(...args);
        host.flushFocus();
        const container = target.blocks;
        const comments = target.comments;
        const shown = {};
        for (const commentId in comments) {
            if (entry.commentIds.has(commentId) || (comments[commentId].blockId &&
                entry.blockIds.has(comments[commentId].blockId))) shown[commentId] = comments[commentId];
        }
        const ownToXML = Object.prototype.hasOwnProperty.call(container, 'toXML');
        container.toXML = xmlComments => entry.topIds
            .filter(id => container._blocks[id])
            .map(id => container.blockToXML(id, xmlComments))
            .join('');
        target.comments = shown;
        try { return originalEmitWorkspaceUpdate(...args); } finally {
            target.comments = comments;
            if (!ownToXML) delete container.toXML;
        }
    };
    if (!Blocks.prototype.__dimodBlockspaceWrapped) {
        Blocks.prototype.__dimodBlockspaceWrapped = true;
        const originalBlocklyListen = Blocks.prototype.blocklyListen;
        Blocks.prototype.blocklyListen = function (e, ...rest) {
            const result = originalBlocklyListen.call(this, e, ...rest);
            if (e && e.type === 'change' && e.element === 'mutation') pruneArgInputs(this, e.blockId);
            const bs = this.runtime && this.runtime.dimodBlockspace;
            if (bs && bs._focusedOn(this)) bs._scheduleFocusSync();
            return result;
        };
    }
    const originalShareBlocks = vm.shareBlocksToTarget.bind(vm);
    vm.shareBlocksToTarget = (blocks, targetId, ...rest) =>
        Promise.resolve(originalShareBlocks(blocks, targetId, ...rest)).then(result => {
            host.adoptLooseScripts(targetId);
            return result;
        });
    const originalStartHats = runtime.startHats.bind(runtime);
    runtime.startHats = (opcode, optMatchFields, optTarget) => {
        if (opcode === 'event_whenflagclicked') { host.restartForFlag(); host.dispatchWorld('preflag', null, []); }
        const fields = optMatchFields ? {...optMatchFields} : null;
        const threads = originalStartHats(opcode, optMatchFields, optTarget);
        host._onHatsStarted(opcode, fields, optTarget);
        return threads;
    };
    let flagStarting = false;
    runtime.on('PROJECT_START_BEFORE_RESET', () => { flagStarting = true; });
    runtime.on('PROJECT_STOP_ALL', () => {
        const fromFlag = flagStarting;
        flagStarting = false;
        host._deferred = [];
        host.clock.stopAll();
        host._resetHolds('stop');
        if (!fromFlag) host.dispatchWorld('stop', null, []);
    });
    runtime.on('RUNTIME_STEP_START', () => host._flushDeferred());
    const sequencer = runtime.sequencer;
    const originalStepThread = sequencer.stepThread.bind(sequencer);
    sequencer.stepThread = thread => {
        if (!thread.dimodRun) return originalStepThread(thread);
        try { return originalStepThread(thread); } catch (e) { host.spaces.runFailed(thread.dimodRun, e); }
    };
    runtime.on('BEFORE_EXECUTE', () => showHitboxSkins(host));
    runtime.on('AFTER_EXECUTE', () => showRealSkins(host));
    runtime.on('KEY_PRESSED', key => host.dispatchWorld('key', String(key), [String(key).toLowerCase()]));
    runtime.on('targetWasRemoved', target => host._forget(target));
    runtime.on('SAY', (target, type, text) => {
        if (target) host.dispatchTarget(target, 'say', null, [text, type]);
    });
    runtime.on('STAGE_SIZE_CHANGED', (width, height) => host.dispatchWorld('resize', null, [width, height]));
    runtime.on('DIMOD_ANIMATION_EVENT', (target, record, name, time) => {
        host.dispatchTarget(target, 'animation', name, owner => [name, animationFor(owner, record), time]);
        host.dispatchWorld('animation', name, owner => [name, owner.wrap(target), animationFor(owner, record), time]);
    });
    runtime.on('DIMOD_SCENE_ENTERED', scene => {
        host.dispatchWorld('scene', scene.name, owner => [sceneApiFor(owner, scene)]);
    });
    runtime.on('DIMOD_ANIMATION_END', (target, record) => {
        host.dispatchTarget(target, 'animationend', null, owner => [animationFor(owner, record)]);
        host.dispatchWorld('animationend', null, owner => [owner.wrap(target), animationFor(owner, record)]);
    });
    const cloud = runtime.ioDevices.cloud;
    if (cloud) {
        const originalCloudPost = cloud.postData.bind(cloud);
        cloud.postData = data => {
            const result = originalCloudPost(data);
            const update = data && data.varUpdate;
            if (update && typeof update.name === 'string') {
                const name = update.name.replace(/^☁\s*/, '');
                host.dispatchWorld('cloud', name, [update.value, name]);
            }
            return result;
        };
    }
    const gameClient = vm.dimodGameClient;
    if (gameClient) {
        const publicPlayer = p => ({id: p.id, username: p.username, isGuest: !p.loggedIn});
        gameClient.listen('relay', (channel, data, from) => {
            const known = gameClient.roster.get(from);
            host.dispatchWorld('server:relay', channel,
                [parseServerData(data), known ? publicPlayer(known) : {id: from, username: '', isGuest: true}, channel]);
        });
        gameClient.listen('join', player => host.dispatchWorld('server:join', null, [publicPlayer(player)]));
        gameClient.listen('leave', player => host.dispatchWorld('server:leave', null, [publicPlayer(player)]));
    }
    const originalDisposeTarget = runtime.disposeTarget.bind(runtime);
    runtime.disposeTarget = target => {
        if (target && target.isOriginal) host._forget(target);
        return originalDisposeTarget(target);
    };
    const originalDispose = runtime.dispose.bind(runtime);
    runtime.dispose = (...args) => { host._disposeAll(); return originalDispose(...args); };
    const keyboard = runtime.ioDevices.keyboard;
    const originalKeyPost = keyboard.postData.bind(keyboard);
    keyboard.postData = data => {
        const wasDown = data && data.key ? keyboard._keysPressed.slice() : null;
        originalKeyPost(data);
        if (!wasDown || data.isDown) return;
        const released = wasDown.filter(k => !keyboard._keysPressed.includes(k));
        released.forEach(key => host.dispatchWorld('keyup', key, [key.toLowerCase()]));
    };
    const mouse = runtime.ioDevices.mouse;
    host.mouseEdges = {pressed: false, released: false};
    let mouseWasDown = mouse.getIsDown();
    host.clock.addFrameHook(() => {
        const isDown = mouse.getIsDown();
        host.mouseEdges.pressed = isDown && !mouseWasDown;
        host.mouseEdges.released = !isDown && mouseWasDown;
        mouseWasDown = isDown;
    });
    const originalMousePost = mouse.postData.bind(mouse);
    mouse.postData = data => {
        const wasDown = mouse.getIsDown();
        originalMousePost(data);
        const isDown = mouse.getIsDown();
        if (isDown !== wasDown) host.dispatchWorld(isDown ? 'mousedown' : 'mouseup', null, []);
    };
    if (typeof window !== 'undefined' && !window.__dimodBlockspaceRejections) {
        window.__dimodBlockspaceRejections = true;
        window.addEventListener('unhandledrejection', e => {
            if (e.reason instanceof Stopped) e.preventDefault();
        });
    }
    return host;
};
export {ARG_BLOCKS, AnimationApi, AnimationPartApi, AnimatorApi, AssertionError, BlockOwner, BlockspaceRef, BlockspaceRuntime, Blockspaces, CASE_SENSITIVE_EVENTS, CAST, LIMITS as CLOUD_LIMITS, COLOR, CameraApi, Clock, DEFAULT_SOURCE, EASINGS$1 as EASINGS, EASING_NAMES, EMPTY_PAYLOAD, HoldStore, IRIS_HATS, InertSync, InputApi, InputMap, IrisApi, IrisCharApi, KEY_NAMES, LivePartApi, ModuleInstance, NAME_WIDGETS, OPCODES, PRESETS, PenApi, Position, Profiler, RESERVED_WORLD_EVENTS, RunHandle, SERVER_HATS, ServerApi, SoundApi, Stopped, SyncHandle, TARGET_BUILT_IN_NAMES, TWEEN_PROPERTIES, TargetApi, TestRegistry, Tween, WIDGETS, WORLD_BUILT_IN_NAMES, WorldApi, animationFor, animationOf, animationsIn, applyEdits, applySkin, argCountOf, argInputName, argOrder, ask, assert, blank, installBlockSpaceBlocksVM as blockSpaceBlocksDefault, callPrimitive, chainAt, checkSyntax, collectHints, colorTexts, copyValue, costumeSkin, createCloudApi, deepEqual, defaultFor, describe, disposeAllSkins, easingOf, editorApi, expect, extensionLoaded, extensionProxy, extensionTypes, extensionsApi, findBlockspaces, findColors, findEditorCalls, findSites, forgetSkinTarget, formatNumber, fromCast, gamepad, getRaw, hostOf, installBlockspaceRuntime as indexDefault, installBlockSpaceBlocksVM, installBlockspaceRuntime, irisHatArgs, markup as irisMarkup, lint, literalFor, liveValue, locate, namesIn, normalizePayload, normalizeSpec, objectAt, parseBinding, parseColor, parseServerData, payloadEdit, requireExtension, resetSkins, showHitboxSkins, showRealSkins, skinClassFor, skinOf, lint as sourceLintDefault, startTween, stepOf, stringifyPayload, targetProxy, toCast, toServerData, variableProxy, withValues, worldProxy};
