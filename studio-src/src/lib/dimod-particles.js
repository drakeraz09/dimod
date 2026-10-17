import BlockType from 'scratch-vm/src/extension-support/block-type';
import ArgumentType from 'scratch-vm/src/extension-support/argument-type';
import Cast from 'scratch-vm/src/util/cast';
import {toTopOfGroup} from './dimod-vm.js';
import {partInfo} from './dimod-animation/runtime.js';
const SHAPES = ['circle', 'square', 'spark', 'drop', 'zap', 'star', 'costume'];
const MAX_PARTICLES = 3000;
const BASE = {
    burst: 10, rate: 20, lifetime: 0.8, lifetimeRandom: 0.2, speed: 80, speedRandom: 30,
    direction: 0, spread: 360, gravity: 0, drag: 0, sizeStart: 10, sizeEnd: 0,
    colorStart: '#ffffff', colorEnd: '#ffffff', rainbow: false, opacityStart: 1, opacityEnd: 0,
    shape: 'circle', spin: 0, glow: false, offsetX: 0, offsetY: 0, behind: false,
    texture: null
};
const PRESETS = {
    'smoke poof': {burst: 14, lifetime: 0.7, lifetimeRandom: 0.25, speed: 70, speedRandom: 40, gravity: -20,
        drag: 2.5, sizeStart: 14, sizeEnd: 34, colorStart: '#dddddd', colorEnd: '#9a9a9a', opacityStart: 0.8},
    'sweat': {burst: 3, lifetime: 0.6, lifetimeRandom: 0.15, speed: 110, speedRandom: 30, spread: 70,
        gravity: 420, sizeStart: 7, sizeEnd: 5, colorStart: '#9be0ff', colorEnd: '#4aa8ff', opacityEnd: 0.5,
        shape: 'drop'},
    'zap': {burst: 6, lifetime: 0.18, lifetimeRandom: 0.08, speed: 30, speedRandom: 20, sizeStart: 28,
        sizeEnd: 10, colorStart: '#fffbd6', colorEnd: '#7ad7ff', shape: 'zap', glow: true},
    'sparkle': {burst: 10, lifetime: 0.6, speed: 80, speedRandom: 50, gravity: 60, drag: 1.5, sizeStart: 9,
        colorStart: '#fff6a8', colorEnd: '#ffcc33', shape: 'star', spin: 180, glow: true},
    'confetti': {burst: 30, lifetime: 1.4, lifetimeRandom: 0.4, speed: 220, speedRandom: 80, spread: 80,
        gravity: 380, drag: 0.8, sizeStart: 6, sizeEnd: 6, rainbow: true, opacityStart: 1, opacityEnd: 1,
        shape: 'square', spin: 360},
    'dust': {burst: 8, lifetime: 0.5, speed: 60, speedRandom: 30, spread: 160, gravity: 120, drag: 2,
        sizeStart: 6, sizeEnd: 14, colorStart: '#c8b49a', colorEnd: '#a89377', opacityStart: 0.7},
    'fire': {rate: 40, burst: 12, lifetime: 0.6, speed: 60, speedRandom: 20, spread: 25, gravity: -60,
        sizeStart: 14, sizeEnd: 2, colorStart: '#ffd36b', colorEnd: '#ff4b1f', opacityStart: 0.9, glow: true},
    'hit sparks': {burst: 8, lifetime: 0.25, lifetimeRandom: 0.1, speed: 260, speedRandom: 80, drag: 4,
        sizeStart: 12, sizeEnd: 2, colorStart: '#ffffff', colorEnd: '#ffb13b', shape: 'spark', glow: true}
};
const emitterFrom = preset => ({...BASE, ...(PRESETS[preset] || {})});
const NUMBER_PROPS = [
    ['rate', 'rate'], ['burst size', 'burst'], ['lifetime', 'lifetime'], ['lifetime randomness', 'lifetimeRandom'],
    ['speed', 'speed'], ['speed randomness', 'speedRandom'], ['direction', 'direction'], ['spread', 'spread'],
    ['gravity', 'gravity'], ['drag', 'drag'], ['start size', 'sizeStart'], ['end size', 'sizeEnd'],
    ['start opacity', 'opacityStart'], ['end opacity', 'opacityEnd'], ['spin', 'spin'],
    ['x offset', 'offsetX'], ['y offset', 'offsetY']
];
const hexToRgb = hex => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
};
const lerp = (a, b, t) => a + ((b - a) * t);
const jitter = (v, r) => v + ((Math.random() * 2 - 1) * r);
const RAD = Math.PI / 180;
class ParticleSystem {
    constructor () { this.list = []; }
    spawn (em, x, y, n) {
        const count = Math.max(0, Math.min(Math.floor(n), MAX_PARTICLES - this.list.length));
        const from = hexToRgb(em.colorStart);
        const to = hexToRgb(em.colorEnd);
        for (let i = 0; i < count; i++) {
            const dir = (em.direction + ((Math.random() - 0.5) * em.spread)) * RAD;
            const speed = Math.max(0, jitter(em.speed, em.speedRandom));
            const life = Math.max(0.02, jitter(em.lifetime, em.lifetimeRandom));
            const hue = em.rainbow ? Math.floor(Math.random() * 360) : -1;
            this.list.push({
                x: x + em.offsetX, y: y + em.offsetY,
                vx: Math.sin(dir) * speed, vy: Math.cos(dir) * speed,
                age: 0, life, rot: em.shape === 'costume' && !em.spin ? 0 : Math.random() * 360, from, to, hue, em,
                seed: Math.random() * 1000
            });
        }
    }
    step (dt) {
        const keep = [];
        for (const p of this.list) {
            p.age += dt;
            if (p.age >= p.life) continue;
            const em = p.em;
            p.vy -= em.gravity * dt;
            if (em.drag) { const k = Math.max(0, 1 - (em.drag * dt)); p.vx *= k; p.vy *= k; }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += em.spin * dt;
            keep.push(p);
        }
        this.list = keep;
    }
    clear (em) { this.list = em ? this.list.filter(p => p.em !== em) : []; }
    countOf (em) { return em ? this.list.filter(p => p.em === em).length : this.list.length; }
    draw (ctx, toCanvas, scale, only) {
        for (const p of this.list) {
            if (only && !only(p)) continue;
            const em = p.em;
            const t = p.age / p.life;
            const size = Math.max(0, lerp(em.sizeStart, em.sizeEnd, t)) * scale;
            const alpha = Math.max(0, Math.min(1, lerp(em.opacityStart, em.opacityEnd, t)));
            if (size <= 0.05 || alpha <= 0.003) continue;
            const [cx, cy] = toCanvas(p.x, p.y);
            ctx.globalAlpha = alpha;
            ctx.globalCompositeOperation = em.glow ? 'lighter' : 'source-over';
            const colour = p.hue >= 0 ? `hsl(${p.hue},90%,60%)` :
                `rgb(${Math.round(lerp(p.from[0], p.to[0], t))},${Math.round(lerp(p.from[1], p.to[1], t))},` +
                `${Math.round(lerp(p.from[2], p.to[2], t))})`;
            ctx.fillStyle = colour;
            ctx.strokeStyle = colour;
            if (em.shape === 'costume') drawTexture(ctx, em.texture, p, cx, cy, size);
            else drawShape(ctx, em.shape, p, cx, cy, size, scale);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }
}
const drawTexture = (ctx, tex, p, cx, cy, size) => {
    if (!tex || !tex.image || !tex.width) {
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    const h = size * (tex.height / tex.width);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(p.rot * RAD);
    ctx.drawImage(tex.image, -size / 2, -h / 2, size, h);
    ctx.restore();
};
const drawShape = (ctx, shape, p, cx, cy, size, scale) => {
    switch (shape) {
    case 'square':
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(p.rot * RAD);
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
        return;
    case 'spark': {
        const v = Math.hypot(p.vx, p.vy) || 1;
        ctx.lineWidth = Math.max(1, size / 4);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - ((p.vx / v) * size), cy + ((p.vy / v) * size));
        ctx.stroke();
        return;
    }
    case 'drop': {
        const ang = Math.atan2(-p.vy, p.vx) + (Math.PI / 2);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.quadraticCurveTo(size * 0.7, 0, 0, size * 0.5);
        ctx.quadraticCurveTo(-size * 0.7, 0, 0, -size);
        ctx.fill();
        ctx.restore();
        return;
    }
    case 'zap': {
        const v = Math.hypot(p.vx, p.vy) || 1;
        const ux = p.vx / v, uy = -p.vy / v;
        const steps = 5;
        let s = Math.floor(p.seed + (p.age * 30));
        const rnd = () => { s = ((s * 9301) + 49297) % 233280; return (s / 233280) - 0.5; };
        ctx.lineWidth = Math.max(1, 2 * scale);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let i = 1; i <= steps; i++) {
            const d = (size * i) / steps;
            const off = i === steps ? 0 : rnd() * size * 0.5;
            ctx.lineTo(cx + (ux * d) - (uy * off), cy + (uy * d) + (ux * off));
        }
        ctx.stroke();
        return;
    }
    case 'star': {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(p.rot * RAD);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const r = i % 2 ? size * 0.25 : size;
            const a = (i * Math.PI) / 4;
            ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        return;
    }
    default:
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        ctx.fill();
    }
};
const PARTICLE_EVENT_MARK = '✦';
const parseParticleEvent = value => {
    const text = String(value || '').trim();
    if (!text.startsWith(PARTICLE_EVENT_MARK)) return null;
    let rest = text.slice(PARTICLE_EVENT_MARK.length).trim();
    let part = '';
    const at = rest.lastIndexOf(' @');
    if (at !== -1) { part = rest.slice(at + 2).trim(); rest = rest.slice(0, at).trim(); }
    let count = null;
    const m = rest.match(/\s+x(\d+)$/i);
    if (m) { count = Math.min(500, parseInt(m[1], 10)); rest = rest.slice(0, m.index).trim(); }
    return rest ? {name: rest, count, part} : null;
};
const particleEventText = (name, part) => `${PARTICLE_EVENT_MARK} ${name}${part ? ` @${part}` : ''}`;
const EXTENSION_ID = 'basicParticles';
const COLOUR = '#E8743B';
const ICON = `data:image/svg+xml;base64,${btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9.5" fill="#E8743B" ' +
    'stroke="#C25A26"/><circle cx="7" cy="12" r="2.6" fill="#fff"/><circle cx="12.5" cy="7.5" r="1.8" fill="#fff"/>' +
    '<circle cx="13.5" cy="13" r="1.2" fill="#fff"/><circle cx="6.5" cy="6.5" r="1" fill="#fff"/></svg>')}`;
const PROP_KEYS = new Map(NUMBER_PROPS.map(([label, key]) => [label, key]));
class BasicParticles {
    constructor (runtime) {
        this.runtime = runtime;
        this.emitters = new Map();
        this.system = new ParticleSystem();
        this.textures = new Map();
        this.layers = null;
        this.last = 0;
        runtime.ext_basicParticles = this;
        runtime.on('AFTER_EXECUTE', () => this.tick());
        runtime.on('PROJECT_STOP_ALL', () => {
            this.system.clear();
            for (const em of this.emitters.values()) em.running = false;
            this.draw();
        });
        runtime.on('DIMOD_ANIMATION_EVENT', (target, record, value) => this.onAnimationEvent(target, value));
    }
    getInfo () {
        const name = {type: ArgumentType.STRING, defaultValue: 'poof'};
        return {
            id: EXTENSION_ID,
            name: 'BasicParticles',
            color1: COLOUR,
            color2: '#D4652F',
            color3: '#C25A26',
            menuIconURI: ICON,
            blocks: [
                {opcode: 'create', blockType: BlockType.COMMAND, text: 'create emitter [NAME] like [PRESET]',
                    arguments: {NAME: name, PRESET: {type: ArgumentType.STRING, menu: 'presets', defaultValue: 'smoke poof'}}},
                {opcode: 'burst', blockType: BlockType.COMMAND, text: 'burst emitter [NAME]', arguments: {NAME: name}},
                {opcode: 'burstCount', blockType: BlockType.COMMAND, text: 'burst [COUNT] particles from emitter [NAME]',
                    arguments: {NAME: name, COUNT: {type: ArgumentType.NUMBER, defaultValue: 10}}},
                {opcode: 'burstAt', blockType: BlockType.COMMAND,
                    text: 'burst [COUNT] particles from emitter [NAME] at x: [X] y: [Y]',
                    arguments: {NAME: name, COUNT: {type: ArgumentType.NUMBER, defaultValue: 10},
                        X: {type: ArgumentType.NUMBER, defaultValue: 0}, Y: {type: ArgumentType.NUMBER, defaultValue: 0}}},
                {opcode: 'start', blockType: BlockType.COMMAND, text: 'start emitter [NAME]', arguments: {NAME: name}},
                {opcode: 'stop', blockType: BlockType.COMMAND, text: 'stop emitter [NAME]', arguments: {NAME: name}},
                '---',
                {opcode: 'moveTo', blockType: BlockType.COMMAND, text: 'move emitter [NAME] to x: [X] y: [Y]',
                    arguments: {NAME: name, X: {type: ArgumentType.NUMBER, defaultValue: 0},
                        Y: {type: ArgumentType.NUMBER, defaultValue: 0}}},
                {opcode: 'attach', blockType: BlockType.COMMAND, text: 'attach emitter [NAME] to [SPRITE]',
                    arguments: {NAME: name, SPRITE: {type: ArgumentType.STRING, menu: 'sprites', defaultValue: '_myself_'}}},
                {opcode: 'detach', blockType: BlockType.COMMAND, text: 'detach emitter [NAME]', arguments: {NAME: name}},
                '---',
                {opcode: 'setProp', blockType: BlockType.COMMAND, text: 'set [PROP] of emitter [NAME] to [VALUE]',
                    arguments: {NAME: name, PROP: {type: ArgumentType.STRING, menu: 'props', defaultValue: 'speed'},
                        VALUE: {type: ArgumentType.NUMBER, defaultValue: 100}}},
                {opcode: 'changeProp', blockType: BlockType.COMMAND, text: 'change [PROP] of emitter [NAME] by [VALUE]',
                    arguments: {NAME: name, PROP: {type: ArgumentType.STRING, menu: 'props', defaultValue: 'direction'},
                        VALUE: {type: ArgumentType.NUMBER, defaultValue: 15}}},
                {opcode: 'setColor', blockType: BlockType.COMMAND, text: 'set [WHICH] color of emitter [NAME] to [COLOR]',
                    arguments: {NAME: name, WHICH: {type: ArgumentType.STRING, menu: 'ends', defaultValue: 'start'},
                        COLOR: {type: ArgumentType.COLOR, defaultValue: '#ffcc33'}}},
                {opcode: 'setShape', blockType: BlockType.COMMAND, text: 'set shape of emitter [NAME] to [SHAPE]',
                    arguments: {NAME: name, SHAPE: {type: ArgumentType.STRING, menu: 'shapes', defaultValue: 'circle'}}},
                {opcode: 'setTexture', blockType: BlockType.COMMAND,
                    text: 'set texture of emitter [NAME] to costume [COSTUME] of [SPRITE]',
                    arguments: {NAME: name, COSTUME: {type: ArgumentType.STRING, defaultValue: 'costume1'},
                        SPRITE: {type: ArgumentType.STRING, menu: 'sprites', defaultValue: '_myself_'}}},
                {opcode: 'setToggle', blockType: BlockType.COMMAND, text: 'set [WHAT] of emitter [NAME] to [ON]',
                    arguments: {NAME: name, WHAT: {type: ArgumentType.STRING, menu: 'toggles', defaultValue: 'glow'},
                        ON: {type: ArgumentType.STRING, menu: 'onOff', defaultValue: 'on'}}},
                '---',
                {opcode: 'clear', blockType: BlockType.COMMAND, text: 'clear particles of emitter [NAME]',
                    arguments: {NAME: name}},
                {opcode: 'clearAll', blockType: BlockType.COMMAND, text: 'clear all particles'},
                {opcode: 'remove', blockType: BlockType.COMMAND, text: 'delete emitter [NAME]', arguments: {NAME: name}},
                '---',
                {opcode: 'getProp', blockType: BlockType.REPORTER, text: '[PROP] of emitter [NAME]',
                    arguments: {NAME: name, PROP: {type: ArgumentType.STRING, menu: 'props', defaultValue: 'speed'}}},
                {opcode: 'count', blockType: BlockType.REPORTER, text: 'particles of emitter [NAME]', arguments: {NAME: name}},
                {opcode: 'total', blockType: BlockType.REPORTER, text: 'all particles'},
                {opcode: 'exists', blockType: BlockType.BOOLEAN, text: 'emitter [NAME] exists?', arguments: {NAME: name}},
                {opcode: 'emitterNames', blockType: BlockType.REPORTER, text: 'emitter names'}
            ],
            menus: {
                presets: {acceptReporters: true, items: ['blank', ...Object.keys(PRESETS)]},
                props: {acceptReporters: true, items: NUMBER_PROPS.map(([label]) => label)},
                ends: {acceptReporters: false, items: ['start', 'end', 'both']},
                shapes: {acceptReporters: true, items: SHAPES},
                toggles: {acceptReporters: false, items: ['glow', 'rainbow', 'behind sprites']},
                onOff: {acceptReporters: true, items: ['on', 'off']},
                sprites: {acceptReporters: true, items: 'spriteMenu'}
            }
        };
    }
    spriteMenu () {
        const items = [{text: 'myself', value: '_myself_'}];
        for (const t of this.runtime.targets) {
            if (t.isOriginal && !t.isStage) items.push(t.sprite.name);
        }
        return items;
    }
    make (name, preset) {
        const em = {...emitterFrom(preset), x: 0, y: 0, running: false, follow: null, carry: 0};
        this.emitters.set(name, em);
        return em;
    }
    get (args) { const name = Cast.toString(args.NAME); return this.emitters.get(name) || this.make(name, 'blank'); }
    origin (em) {
        if (em.follow) {
            const t = this.runtime.getTargetById(em.follow);
            if (t) return [t.x, t.y];
            em.follow = null;
            em.running = false;
        }
        return [em.x, em.y];
    }
    create (args) { this.make(Cast.toString(args.NAME), Cast.toString(args.PRESET)); }
    burst (args) { const em = this.get(args); this.system.spawn(em, ...this.origin(em), em.burst); }
    burstCount (args) { const em = this.get(args); this.system.spawn(em, ...this.origin(em), Cast.toNumber(args.COUNT)); }
    burstAt (args) { this.system.spawn(this.get(args), Cast.toNumber(args.X), Cast.toNumber(args.Y), Cast.toNumber(args.COUNT)); }
    start (args) { this.get(args).running = true; }
    stop (args) { this.get(args).running = false; }
    moveTo (args) {
        const em = this.get(args);
        em.follow = null;
        em.x = Cast.toNumber(args.X);
        em.y = Cast.toNumber(args.Y);
    }
    attach (args, util) {
        const em = this.get(args);
        const which = Cast.toString(args.SPRITE);
        const t = which === '_myself_' ? util.target : this.runtime.getSpriteTargetByName(which);
        em.follow = t && !t.isStage ? t.id : null;
    }
    detach (args) {
        const em = this.get(args);
        if (em.follow) [em.x, em.y] = this.origin(em);
        em.follow = null;
    }
    setProp (args) {
        const key = PROP_KEYS.get(Cast.toString(args.PROP));
        if (key) this.get(args)[key] = Cast.toNumber(args.VALUE);
    }
    changeProp (args) {
        const key = PROP_KEYS.get(Cast.toString(args.PROP));
        if (key) this.get(args)[key] += Cast.toNumber(args.VALUE);
    }
    setColor (args) {
        const em = this.get(args);
        const rgb = Cast.toRgbColorObject(args.COLOR);
        const hex = `#${[rgb.r, rgb.g, rgb.b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
        const which = Cast.toString(args.WHICH);
        if (which !== 'end') em.colorStart = hex;
        if (which !== 'start') em.colorEnd = hex;
        em.rainbow = false;
    }
    setShape (args) {
        const shape = Cast.toString(args.SHAPE);
        if (SHAPES.includes(shape)) this.get(args).shape = shape;
    }
    setTexture (args, util) {
        const em = this.get(args);
        const which = Cast.toString(args.SPRITE);
        const t = which === '_myself_' ? util.target : this.runtime.getSpriteTargetByName(which);
        const tex = t && this.textureOf(t, args.COSTUME);
        if (!tex) return;
        em.texture = tex;
        em.shape = 'costume';
    }
    setToggle (args) {
        const em = this.get(args);
        const on = Cast.toBoolean(args.ON) && Cast.toString(args.ON) !== 'off';
        const what = Cast.toString(args.WHAT);
        if (what === 'glow') em.glow = on;
        else if (what === 'rainbow') em.rainbow = on;
        else if (what === 'behind sprites') em.behind = on;
    }
    clear (args) {
        const em = this.emitters.get(Cast.toString(args.NAME));
        if (em) this.system.clear(em);
    }
    clearAll () { this.system.clear(); }
    remove (args) {
        const name = Cast.toString(args.NAME);
        const em = this.emitters.get(name);
        if (!em) return;
        this.system.clear(em);
        this.emitters.delete(name);
    }
    getProp (args) {
        const em = this.emitters.get(Cast.toString(args.NAME));
        const key = PROP_KEYS.get(Cast.toString(args.PROP));
        return em && key ? em[key] : 0;
    }
    count (args) { const em = this.emitters.get(Cast.toString(args.NAME)); return em ? this.system.countOf(em) : 0; }
    total () { return this.system.list.length; }
    exists (args) { return this.emitters.has(Cast.toString(args.NAME)); }
    emitterNames () { return JSON.stringify([...this.emitters.keys()]); }
    textureOf (target, ref) {
        const costumes = target.getCostumes();
        const name = Cast.toString(ref);
        let costume = costumes.find(c => c.name === name);
        if (!costume) {
            const n = Math.round(Cast.toNumber(ref));
            if (n >= 1 && n <= costumes.length) costume = costumes[n - 1];
        }
        if (!costume || !costume.asset) return null;
        const key = costume.asset.assetId;
        if (this.textures.has(key)) return this.textures.get(key);
        const tex = {image: null, width: 0, height: 0};
        this.textures.set(key, tex);
        if (typeof Image === 'undefined') return tex;
        const img = new Image();
        const res = costume.bitmapResolution || 1;
        img.onload = () => { tex.width = img.naturalWidth / res; tex.height = img.naturalHeight / res; tex.image = img; };
        img.src = costume.asset.encodeDataURI();
        return tex;
    }
    onAnimationEvent (target, value) {
        const ev = parseParticleEvent(value);
        if (!ev || !target) return;
        const em = this.emitters.get(ev.name) || (PRESETS[ev.name] ? emitterFrom(ev.name) : null);
        if (!em) return;
        let x = target.x, y = target.y;
        const anim = this.runtime.dimodVm && this.runtime.dimodVm.dimodAnimations;
        if (ev.part && anim && anim.stage) {
            const info = partInfo(anim.stage, target, ev.part);
            if (info) [x, y] = [info.x, info.y];
        }
        this.system.spawn(em, x, y, ev.count === null ? em.burst : ev.count);
    }
    tick () {
        const now = performance.now();
        const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
        this.last = now;
        for (const em of this.emitters.values()) {
            if (!em.running) continue;
            em.carry += em.rate * dt;
            const n = Math.floor(em.carry);
            if (n > 0) { em.carry -= n; this.system.spawn(em, ...this.origin(em), n); }
        }
        this.system.step(dt);
        this.draw();
    }
    ensureLayers () {
        const r = this.runtime.renderer;
        if (!r || typeof document === 'undefined') return null;
        const w = this.runtime.stageWidth || 480, h = this.runtime.stageHeight || 360;
        if (this.layers && this.layers.w === w && this.layers.h === h) return this.layers;
        const make = (group, old) => {
            const canvas = old ? old.canvas : document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const skinId = old ? old.skinId : r.createBitmapSkin(canvas, 1);
            const drawableId = old ? old.drawableId : r.createDrawable(group);
            if (!old) r.updateDrawableSkinId(drawableId, skinId);
            r.updateDrawableVisible(drawableId, false);
            return {canvas, ctx: canvas.getContext('2d'), skinId, drawableId, shown: false, group};
        };
        const old = this.layers;
        this.layers = {w, h, front: make('sprite', old && old.front), back: make('pen', old && old.back)};
        if (!old) this.hideFromQueries(r);
        return this.layers;
    }
    hideFromQueries (r) {
        const mine = () => [this.layers.front.drawableId, this.layers.back.drawableId];
        const pick = r.pick.bind(r);
        r.pick = (x, y, w, h, candidates) => pick(x, y, w, h, (candidates || r._drawList).filter(id => !mine().includes(id)));
        const touching = r._candidatesTouching.bind(r);
        r._candidatesTouching = (id, candidates) => touching(id, candidates.filter(c => !mine().includes(c)));
    }
    draw () {
        const layers = this.ensureLayers();
        if (!layers) return;
        const r = this.runtime.renderer;
        const toCanvas = (x, y) => [x + (layers.w / 2), (layers.h / 2) - y];
        for (const [layer, behind] of [[layers.front, false], [layers.back, true]]) {
            const any = this.system.list.some(p => !!p.em.behind === behind);
            if (!any && !layer.shown) continue;
            layer.ctx.clearRect(0, 0, layers.w, layers.h);
            if (any) this.system.draw(layer.ctx, toCanvas, 1, p => !!p.em.behind === behind);
            r.updateBitmapSkin(layer.skinId, layer.canvas, 1);
            if (any !== layer.shown) r.updateDrawableVisible(layer.drawableId, any);
            layer.shown = any;
            if (any) toTopOfGroup(r, layer.drawableId, layer.group);
        }
    }
}
const installBasicParticlesVM = vm => {
    if (vm.__dimodParticlesInstalled) return;
    vm.__dimodParticlesInstalled = true;
    vm.runtime.dimodVm = vm;
    vm.extensionManager.addBuiltinExtension(EXTENSION_ID, BasicParticles);
};
export {BasicParticles, EXTENSION_ID, MAX_PARTICLES, NUMBER_PROPS, PARTICLE_EVENT_MARK, PRESETS, ParticleSystem, SHAPES, emitterFrom, installBasicParticlesVM, parseParticleEvent, particleEventText};
