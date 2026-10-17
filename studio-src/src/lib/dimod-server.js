import {getDimodUsername, getDimodToken, isCloudProject, whenCloudStateLoaded, onCloudStateChange} from './dimod-project';
import log from './log';
const BEAT_MS = 1000;
const FROZEN_MS = 4000;
const WORKER_SOURCE = `
'use strict';
// No way out: the real server's code can't reach the network either
for (let o = self; o; o = Object.getPrototypeOf(o)) {
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB',
    'caches', 'BroadcastChannel', 'WebTransport', 'Worker', 'SharedWorker', 'Request']) {
    try { if (Object.prototype.hasOwnProperty.call(o, k)) delete o[k]; } catch (e) {}
  }
}
const post = self.postMessage.bind(self);
const MAX_TIMERS = 32, MIN_INTERVAL_MS = 50, DEFAULT_ROOM = 'default', MAX_VALUE = 1024 * 1024;
const PLAYER_MARK = '\\u2601 \\uD83D\\uDC64';
const toValue = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const cloudName = (n) => (String(n).startsWith('\\u2601') ? String(n) : '\\u2601 ' + n);
const playerCloudName = (n) => { const s = String(n); if (s.startsWith('\\u2601')) return s; return s.startsWith('\\uD83D\\uDC64') ? '\\u2601 ' + s : PLAYER_MARK + ' ' + s; };
const isPlayerVar = (n) => typeof n === 'string' && n.startsWith(PLAYER_MARK);
const fmt = (v) => typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch (e) { return String(v); } })();
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

let code = '';
let me = null;           // the one player: {id, username, loggedIn}
let here = null;         // the room they're in
const rooms = new Map(); // name -> {name, vars, handlers, timers}
const savedVars = new Map();
const playerVars = new Map();
const db = new Map();
const storage = {};

const log = (level, text, room) => post({type: 'log', level, text: String(text).slice(0, 2000), room: room || (here && here.name) || DEFAULT_ROOM});
const out = (packet) => post({type: 'out', packet});
const publicMe = () => ({id: me.id, username: me.username, loggedIn: me.loggedIn});
const inRoom = (room) => !!me && here === room;
const targetIsMe = (who) => {
  if (!me || who === null || who === undefined) return false;
  const p = typeof who === 'object' ? who.id : who;
  return p === me.id || String(p).toLowerCase() === me.username.toLowerCase();
};

function startScript (room) {
  for (const t of room.timers.values()) clearTimeout(t.handle), clearInterval(t.handle);
  room.timers.clear();
  room.handlers = {start: [], connect: [], disconnect: [], send: [], ask: [], cloud: []};
  if (!code.trim()) { log('system', 'No server code yet... data you send goes to the other players (there are none on the pretend server)', room.name); return; }
  const h = room.handlers;
  let seq = 0;
  const addTimer = (ms, fn, repeat) => {
    if (typeof fn !== 'function') throw new Error((repeat ? 'every' : 'after') + '(ms, fn) needs a function');
    if (room.timers.size >= MAX_TIMERS) throw new Error('Too many timers (max ' + MAX_TIMERS + ')');
    const id = ++seq;
    const delay = Math.max(MIN_INTERVAL_MS, Math.min(Number(ms) || 0, 86400000));
    const run = () => { if (!repeat) room.timers.delete(id); try { fn(); } catch (e) { log('error', 'Error in timer: ' + (e && e.stack || e), room.name); } };
    room.timers.set(id, {handle: repeat ? setInterval(run, delay) : setTimeout(run, delay)});
    return id;
  };
  const api = {
    on: (event, fn) => {
      if (!h[event]) throw new Error('Unknown event "' + event + '". Use start, connect, disconnect, send, ask or cloud.');
      if (typeof fn !== 'function') throw new Error('on(' + event + ', ...) needs a function');
      h[event].push(fn);
    },
    send: (player, data) => { if (inRoom(room) && targetIsMe(player)) out({method: 'data', data: toValue(clone(data))}); },
    sendAll: (data) => { if (inRoom(room)) out({method: 'data', data: toValue(clone(data))}); },
    sendAllExcept: (player, data) => { if (inRoom(room) && !targetIsMe(player)) out({method: 'data', data: toValue(clone(data))}); },
    players: () => (inRoom(room) ? [publicMe()] : []),
    playerCount: () => (inRoom(room) ? 1 : 0),
    findPlayer: (name) => (inRoom(room) && me.username.toLowerCase() === String(name).toLowerCase() ? publicMe() : null),
    disconnect: (player, reason) => { if (inRoom(room) && targetIsMe(player)) { out({method: 'kicked', reason: String(reason || 'Disconnected by the game')}); post({type: 'close', code: 4100, reason: 'Kicked'}); } },
    getCloud: (name) => room.vars.get(cloudName(name)) ?? room.vars.get(name) ?? null,
    setCloud: (name, value) => {
      const real = cloudName(name);
      if (isPlayerVar(real)) throw new Error('"' + real + '" is a per-player variable... use setPlayerCloud(player, name, value)');
      room.vars.set(real, toValue(clone(value)));
      if (inRoom(room)) out({method: 'set', name: real, value: room.vars.get(real)});
    },
    getPlayerCloud: (player, name) => (targetIsMe(player) ? playerVars.get(playerCloudName(name)) ?? null : null),
    setPlayerCloud: (player, name, value) => {
      if (!targetIsMe(player)) throw new Error('setPlayerCloud: that player is not in this room');
      const real = playerCloudName(name);
      playerVars.set(real, toValue(clone(value)));
      out({method: 'set', name: real, value: playerVars.get(real)});
    },
    storage: Object.freeze({
      get: (k) => clone(storage[String(k)] ?? null),
      set: (k, v) => { if (v === undefined) delete storage[String(k)]; else storage[String(k)] = clone(v); },
      delete: (k) => { delete storage[String(k)]; },
      keys: () => Object.keys(storage),
    }),
    db: Object.freeze({
      get: (k) => (db.has(String(k)) ? JSON.parse(db.get(String(k))) : null),
      set: (k, v) => { if (v === null || v === undefined) db.delete(String(k)); else db.set(String(k), JSON.stringify(v)); return true; },
      delete: (k) => { db.delete(String(k)); },
      has: (k) => db.has(String(k)),
      keys: (prefix) => [...db.keys()].filter(x => x.startsWith(prefix == null ? '' : String(prefix))),
      size: () => [...db].reduce((n, [k, v]) => n + k.length + v.length, 0),
    }),
    every: (ms, fn) => addTimer(ms, fn, true),
    after: (ms, fn) => addTimer(ms, fn, false),
    cancel: (id) => { const t = room.timers.get(id); if (t) { clearTimeout(t.handle); clearInterval(t.handle); room.timers.delete(id); } },
    log: (...a) => log('info', a.map(fmt).join(' '), room.name),
    room: room.name,
  };
  api.console = Object.freeze({log: api.log, info: api.log, warn: (...a) => log('warn', a.map(fmt).join(' '), room.name), error: (...a) => log('error', a.map(fmt).join(' '), room.name)});
  const names = Object.keys(api);
  try {
    // in a block of its own, so the code can declare its own "log" or "room" like on the real server
    new Function(...names, '"use strict";\\n{\\n' + code + '\\n}')(...names.map(n => api[n]));
    log('system', 'Server code started on the pretend server', room.name);
  } catch (e) {
    room.handlers = {start: [], connect: [], disconnect: [], send: [], ask: [], cloud: []};
    log('error', 'Server logic failed to start: ' + (e && e.message || e), room.name);
    return;
  }
  dispatch(room, 'start');
  if (inRoom(room)) dispatch(room, 'connect', publicMe());
}

function dispatch (room, event, ...args) {
  let rejected = false, answer;
  for (const fn of room.handlers[event] || []) {
    try {
      const r = fn(...args.map(clone));
      if (event === 'cloud' && r === false) rejected = true;
      if (event === 'ask' && answer === undefined && r !== undefined) answer = r;
    } catch (e) {
      log('error', 'Error in on("' + event + '"): ' + (e && e.stack || e), room.name);
    }
  }
  return {rejected, answer};
}

function roomNamed (name) {
  let room = rooms.get(name);
  if (!room) {
    room = {name, vars: name === DEFAULT_ROOM ? savedVars : new Map(savedVars), handlers: {}, timers: new Map()};
    rooms.set(name, room);
    startScript(room);
  }
  return room;
}

function enter (name, first) {
  const room = roomNamed(name);
  here = room;
  const info = {room: room.name, players: 1, serverLogic: !!code.trim()};
  out(first ? {method: 'welcome', player: publicMe(), ...info} : {method: 'joined', ...info});
  for (const [n, v] of room.vars) out({method: 'set', name: n, value: v});
  for (const [n, v] of playerVars) out({method: 'set', name: n, value: v});
  out({method: 'roster', players: [publicMe()]});
  out({method: 'players', count: 1});
  log('system', me.username + (first ? ' connected' : ' joined') + ' (1 online)', room.name);
  dispatch(room, 'connect', publicMe());
}

function leave () {
  if (!here || !me) return;
  const room = here;
  here = null;
  log('system', me.username + ' disconnected (0 online)', room.name);
  dispatch(room, 'disconnect', publicMe());
}

function handle (msg) {
  const room = here;
  if (!room || !msg || typeof msg !== 'object') return;
  switch (msg.method) {
  case 'join': {
    const name = String(msg.room ?? '').replace(/\\s+/g, ' ').trim().slice(0, 32) || DEFAULT_ROOM;
    if (name === room.name) return;
    leave();
    enter(name, false);
    return;
  }
  case 'create':
  case 'set': {
    const name = msg.name, value = toValue(msg.value);
    if (typeof name !== 'string' || !name || value.length > MAX_VALUE) return;
    if (room.handlers.cloud.length && dispatch(room, 'cloud', publicMe(), name, value).rejected) {
      const store = isPlayerVar(name) ? playerVars : room.vars;
      if (store.has(name)) out({method: 'set', name, value: store.get(name)});
      return;
    }
    (isPlayerVar(name) ? playerVars : room.vars).set(name, value);
    return;
  }
  case 'rename': {
    const store = isPlayerVar(msg.name) ? playerVars : room.vars;
    if (!store.has(msg.name) || typeof msg.new_name !== 'string' || !msg.new_name) return;
    const value = store.get(msg.name);
    store.delete(msg.name);
    (isPlayerVar(msg.new_name) ? playerVars : room.vars).set(msg.new_name, value);
    return;
  }
  case 'delete': {
    const store = isPlayerVar(msg.name) ? playerVars : room.vars;
    if (room.handlers.cloud.length && store.has(msg.name) && dispatch(room, 'cloud', publicMe(), msg.name, '').rejected) {
      out({method: 'set', name: msg.name, value: store.get(msg.name)});
      return;
    }
    store.delete(msg.name);
    return;
  }
  case 'send':
    // no server code: it would go to the other players, and there aren't any
    if (room.handlers.send.length) dispatch(room, 'send', publicMe(), toValue(msg.data));
    return;
  case 'ask': {
    const answer = room.handlers.ask.length ? dispatch(room, 'ask', publicMe(), toValue(msg.data)).answer : null;
    out({method: 'answer', id: msg.id, data: toValue(answer)});
    return;
  }
  case 'ping':
    out({method: 'pong', id: msg.id});
    return;
  default:
  }
}

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'beat') return post({type: 'beat'});
  if (m.type === 'connect') {
    if (m.code !== code) { code = m.code || ''; for (const r of rooms.values()) startScript(r); }
    me = m.player;
    enter(String(m.room || DEFAULT_ROOM), true);
    return;
  }
  if (m.type === 'disconnect') return leave();
  if (m.type === 'code') {
    if (m.code === code) return;
    code = m.code || '';
    for (const r of rooms.values()) startScript(r);
    return;
  }
  if (m.type === 'raw') {
    for (const line of String(m.raw).split('\\n')) {
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (err) { continue; }
      handle(msg);
    }
  }
};
`;
let vmRef = null;
let worker = null;
let socket = null;
let player = null;
let beatTimer = null;
let lastBeat = 0;
const serverCode = () => {
    const server = vmRef && vmRef.runtime.dimodServer;
    return (server && typeof server.code === 'string') ? server.code : '';
};
const emitLog = entry => {
    const level = entry.level === 'system' ? 'info' : entry.level;
    (console[level] || console.log)(`[pretend server${entry.room !== 'default' ? `: ${entry.room}` : ''}] ${entry.text}`);
    window.dispatchEvent(new CustomEvent('dimod:pseudo-log', {
        detail: {t: Date.now(), level: entry.level, text: entry.text, name: entry.room}
    }));
};
const stopWorker = () => {
    clearInterval(beatTimer);
    beatTimer = null;
    if (worker) worker.terminate();
    worker = null;
};
const startWorker = () => {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], {type: 'text/javascript'}));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = e => {
        const m = e.data || {};
        if (m.type === 'beat') lastBeat = performance.now();
        else if (m.type === 'log') emitLog(m);
        else if (m.type === 'out' && socket) socket.deliver(m.packet);
        else if (m.type === 'close' && socket) socket.serverClose(m.code, m.reason);
    };
    lastBeat = performance.now();
    beatTimer = setInterval(() => {
        if (performance.now() - lastBeat > FROZEN_MS) {
            emitLog({level: 'error', room: 'default', text: 'Server code stopped answering (an endless loop?)... restarted the pretend server'});
            const s = socket;
            stopWorker();
            if (s) s.serverClose(1006, 'Pretend server restarted');
            return;
        }
        worker.postMessage({type: 'beat'});
    }, BEAT_MS);
};
class PseudoServerSocket {
    constructor (room) {
        this.dimodPseudo = true;
        this.readyState = 0;
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;
        this.room = room;
        setTimeout(() => this.open(), 0);
    }
    open () {
        if (this.readyState !== 0) return;
        if (socket && socket !== this) socket.serverClose(1000, 'replaced');
        if (!worker) startWorker();
        if (!player) {
            const username = getDimodUsername();
            player = {
                id: Math.random().toString(36)
                    .slice(2, 10),
                username: username || `player${Math.floor(Math.random() * 9000) + 1000}`,
                loggedIn: !!getDimodToken() && !!username
            };
        }
        socket = this;
        this.readyState = 1;
        if (this.onopen) this.onopen();
        worker.postMessage({type: 'connect', player, room: this.room, code: serverCode()});
    }
    send (raw) {
        if (this.readyState === 1 && worker) worker.postMessage({type: 'raw', raw: String(raw)});
    }
    deliver (packet) {
        if (this.readyState === 1 && this.onmessage) this.onmessage({data: JSON.stringify(packet)});
    }
    close () {
        if (this.readyState > 1) return;
        this.readyState = 3;
        if (socket === this) {
            socket = null;
            if (worker) worker.postMessage({type: 'disconnect'});
        }
        if (this.onclose) this.onclose({code: 1000, reason: ''});
    }
    serverClose (code, reason) {
        if (this.readyState > 1) return;
        this.readyState = 3;
        if (socket === this) socket = null;
        if (this.onclose) this.onclose({code, reason});
    }
}
const installPseudoServer = vm => {
    vmRef = vm;
    vm.on('PROJECT_START', () => {
        if (worker) worker.postMessage({type: 'code', code: serverCode()});
    });
};
const SITE_ORIGIN = (process.env.DIMOD_SITE_ORIGIN || '').replace(/\/+$/, '');
const ANSWER_TIMEOUT_MS = 6000;
const ASK_EVERY_MS = 500;
const REFRESH_AFTER_MS = 60 * 60 * 1000;
let cached = null;
let pending = null;
const lateListeners = new Set();
const onGameOrigin = () => {
    try { return Boolean(SITE_ORIGIN) && location.origin !== SITE_ORIGIN; } catch (e) { return false; }
};
const inFrame = () => {
    try { return window.parent && window.parent !== window; } catch (e) { return false; }
};
const askParent = dimodId => new Promise(resolve => {
    const listening = {timer: null, repeat: null, answered: false, late: false};
    const ask = () => window.parent.postMessage({type: 'dimod-play-token-request', dimodId}, SITE_ORIGIN);
    const onMessage = event => {
        if (event.origin !== SITE_ORIGIN || event.source !== window.parent) return;
        const msg = event.data;
        if (!msg || msg.type !== 'dimod-play-token' || msg.dimodId !== dimodId) return;
        if (listening.answered) return;
        listening.answered = true;
        window.removeEventListener('message', onMessage);
        clearTimeout(listening.timer);
        clearInterval(listening.repeat);
        const token = typeof msg.token === 'string' && msg.token ? msg.token : null;
        if (listening.late) {
            cached = {dimodId, token, at: Date.now()};
            if (token) lateListeners.forEach(fn => fn(token));
        } else { resolve({token}); }
    };
    listening.timer = setTimeout(() => {
        clearInterval(listening.repeat);
        listening.late = true;
        resolve(null);
    }, ANSWER_TIMEOUT_MS);
    listening.repeat = setInterval(ask, ASK_EVERY_MS);
    window.addEventListener('message', onMessage);
    ask();
});
const gameServerToken = context => {
    const own = getDimodToken();
    if (own || !onGameOrigin() || context.mode !== 'play' || !context.dimodId || !inFrame()) { return Promise.resolve(own); }
    const dimodId = context.dimodId;
    if (cached && cached.dimodId === dimodId && Date.now() - cached.at < REFRESH_AFTER_MS) {
        return Promise.resolve(cached.token);
    }
    if (!pending) {
        pending = askParent(dimodId).then(answer => {
            pending = null;
            if (answer) cached = {dimodId, token: answer.token, at: Date.now()};
            return answer ? answer.token : null;
        });
    }
    return pending;
};
const hasPlayToken = () => Boolean(cached && cached.token);
const onLatePlayToken = fn => { lateListeners.add(fn); return () => lateListeners.delete(fn); };
const WS_BASE = process.env.DIMOD_WS_BASE;
const MAX_BACKOFF_MS = 15000;
const CLOUD_FLUSH_MS = 50;
const ASK_TIMEOUT_MS = 10000;
const PING_EVERY_MS = 2000;
const RECONNECT_BLOCK_MIN_MS = 1000;
const DEFAULT_ROOM = 'default';
const MAX_ROOM_NAME = 32;
const normalizeRoom = name => String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ROOM_NAME) || DEFAULT_ROOM;
const getDimodGameContext = () => {
    try {
        const params = new URLSearchParams(location.search);
        if (params.get('dimod_id')) return {dimodId: params.get('dimod_id'), mode: 'play'};
        if (params.get('p') && params.get('test_seat')) {
            const seat = Math.min(8, Math.max(2, parseInt(params.get('test_seat'), 10) || 2));
            return {projectId: params.get('p'), mode: 'test', seat};
        }
        if (/\/editor(\.html)?$/.test(location.pathname) && params.get('p')) {
            return {projectId: params.get('p'), mode: 'test'};
        }
        if (/\/editor(\.html)?$/.test(location.pathname) && params.get('view')) return {mode: 'pseudo'};
        if (/\/editor(\.html)?$/.test(location.pathname)) return {mode: 'pseudo'};
    } catch (e) {
    }
    return null;
};
const buildUrl = (context, room, token) => {
    let base;
    if (WS_BASE) { const url = new URL(WS_BASE); base = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`; } else { base = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host; }
    const params = new URLSearchParams();
    if (context.dimodId) params.set('dimod_id', context.dimodId);
    if (context.projectId) params.set('project', context.projectId);
    params.set('mode', context.mode);
    if (context.seat) params.set('seat', String(context.seat));
    if (room && room !== DEFAULT_ROOM) params.set('room', room);
    if (token) params.set('token', token);
    return `${base}/ws/game?${params}`;
};
class DimodGameClient {
    constructor (vm, context) {
        this.vm = vm;
        this.context = context;
        this.connection = null;
        this.wanted = false;
        this.attempts = 0;
        this.reconnectTimer = null;
        this.stopped = false;
        this.userClosed = false;
        this.lastReconnect = 0;
        this.opening = false;
        this.player = null;
        this.playerCount = 0;
        this.serverLogic = false;
        this.room = DEFAULT_ROOM;
        this.wantedRoom = DEFAULT_ROOM;
        this.queue = [];
        this.pendingCloud = new Map();
        this.cloudTimer = null;
        this.lastData = '';
        this.roster = new Map();
        this.listeners = {relay: new Set(), join: new Set(), leave: new Set()};
        this.asks = new Map();
        this.askSeq = 0;
        this.latency = 0;
        this.pingTimer = null;
        this.pingSent = new Map();
        this.pingSeq = 0;
        this.onData = null;
        this.onConnected = null;
        this.onDisconnected = null;
        onLatePlayToken(() => {
            if (this.connection && this.player && !this.player.loggedIn) this.connection.close();
        });
    }
    listen (event, fn) {
        const set = this.listeners[event];
        if (!set) throw new Error(`no such game client event "${event}"`);
        set.add(fn);
        return () => set.delete(fn);
    }
    emitEvent (event, ...args) {
        for (const fn of [...this.listeners[event]]) {
            try { fn(...args); } catch (e) { log.warn(`dimod game client: a ${event} listener threw`, e); }
        }
    }
    get isGuest () {
        if (this.player) return !this.player.loggedIn;
        return !getDimodToken() && !hasPlayToken();
    }
    get pretend () { return this.context.mode === 'pseudo' || (this.context.mode === 'test' && !isCloudProject()); }
    get connected () { return !!this.connection && this.connection.readyState === WebSocket.OPEN && !!this.player; }
    ensureConnected () {
        this.wanted = true;
        if (this.connection || this.opening || this.stopped || this.userClosed) return;
        this.open();
    }
    disconnect () {
        if (this.userClosed) return;
        const wasConnected = !!this.player;
        this.userClosed = true;
        this.queue = [];
        this.requestCloseConnection();
        this.player = null;
        if (wasConnected && this.onDisconnected) this.onDisconnected();
    }
    reconnect () {
        const now = Date.now();
        if (now - this.lastReconnect < RECONNECT_BLOCK_MIN_MS) return;
        this.lastReconnect = now;
        const wasConnected = !!this.player;
        this.userClosed = false;
        this.stopped = false;
        this.attempts = 0;
        if (this.connection) {
            this.requestCloseConnection();
            this.player = null;
            if (wasConnected && this.onDisconnected) this.onDisconnected();
        }
        this.ensureConnected();
    }
    open () {
        if (this.opening) return;
        this.opening = true;
        clearTimeout(this.reconnectTimer);
        this.attempts += 1;
        const cloudKnown = this.context.mode === 'test' ? whenCloudStateLoaded() : null;
        Promise.all([gameServerToken(this.context).then(token => token, () => null), cloudKnown])
            .then(([token]) => {
                this.opening = false;
                if (this.connection || this.stopped || this.userClosed) return;
                this.connect(token);
            });
    }
    connect (token) {
        let ws;
        try {
            ws = this.pretend ? new PseudoServerSocket(this.wantedRoom) : new WebSocket(buildUrl(this.context, this.wantedRoom, token));
        } catch (e) { log.warn('dimod game server: could not open socket', e); this.scheduleReconnect(); return; }
        this.connection = ws;
        this.vm.setCloudProvider(this);
        ws.onopen = () => {
            this.attempts = 0;
            const queued = this.queue;
            this.queue = [];
            queued.forEach(packet => this.sendPacket(packet));
            this.ping();
            clearInterval(this.pingTimer);
            this.pingTimer = setInterval(() => this.ping(), PING_EVERY_MS);
        };
        ws.onmessage = event => {
            let msg;
            try { msg = JSON.parse(event.data); } catch (e) { return; }
            this.handle(msg);
        };
        ws.onclose = event => {
            if (this.connection !== ws) return;
            const wasConnected = !!this.player;
            this.connection = null;
            this.player = null;
            this.room = this.wantedRoom;
            clearInterval(this.pingTimer);
            this.setRoster([]);
            this.failAsks();
            if (wasConnected && this.onDisconnected) this.onDisconnected();
            if ([4003, 4004, 4005, 4100, 4101].includes(event.code)) {
                log.warn(`dimod game server closed the connection (${event.code} ${event.reason})`);
                this.stopped = true;
                return;
            }
            this.scheduleReconnect();
        };
        ws.onerror = () => {
        };
    }
    scheduleReconnect () {
        if (!this.wanted || this.stopped) return;
        const delay = Math.min(MAX_BACKOFF_MS, 500 * Math.pow(2, Math.min(this.attempts, 5)));
        this.reconnectTimer = setTimeout(() => this.open(), delay * (0.5 + (Math.random() / 2)));
    }
    handle (msg) {
        switch (msg.method) {
        case 'welcome':
            this.player = msg.player;
            this.playerCount = msg.players;
            this.serverLogic = !!msg.serverLogic;
            this.room = msg.room || DEFAULT_ROOM;
            if (this.onConnected) this.onConnected();
            break;
        case 'joined':
            this.playerCount = msg.players;
            this.serverLogic = !!msg.serverLogic;
            this.room = msg.room || DEFAULT_ROOM;
            this.setRoster([]);
            break;
        case 'roster':
            this.setRoster(Array.isArray(msg.players) ? msg.players : []);
            break;
        case 'player-joined':
            if (msg.player && msg.player.id && !this.roster.has(msg.player.id)) {
                this.roster.set(msg.player.id, msg.player);
                this.emitEvent('join', msg.player);
            }
            break;
        case 'player-left': {
            const gone = this.roster.get(msg.id);
            if (gone) { this.roster.delete(msg.id); this.emitEvent('leave', gone); }
            break;
        }
        case 'relay':
            if (typeof msg.channel === 'string') {
                const data = typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data ?? '');
                this.emitEvent('relay', msg.channel, data, msg.from);
            }
            break;
        case 'players':
            this.playerCount = msg.count;
            break;
        case 'set':
            this.vm.postIOData('cloud', {varUpdate: {name: msg.name, value: msg.value}});
            break;
        case 'data': {
            const data = typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data ?? '');
            this.lastData = data;
            if (this.onData) this.onData(data);
            break;
        }
        case 'answer': {
            const pending = this.asks.get(msg.id);
            if (pending) {
                clearTimeout(pending.timer);
                this.asks.delete(msg.id);
                pending.resolve(typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data ?? ''));
            }
            break;
        }
        case 'pong': {
            const sentAt = this.pingSent.get(msg.id);
            if (sentAt) { this.pingSent.delete(msg.id); this.latency = Math.round(performance.now() - sentAt); }
            break;
        }
        case 'kicked':
            log.warn(`dimod game server: kicked (${msg.reason})`);
            break;
        case 'error':
            log.warn(`dimod game server: ${msg.message}`);
            break;
        default:
        }
    }
    setRoster (players) {
        const next = new Map(players.filter(p => p && p.id).map(p => [p.id, p]));
        const mine = this.player && this.player.id;
        for (const [id, player] of this.roster) {
            if (!next.has(id) && id !== mine) this.emitEvent('leave', player);
        }
        const before = this.roster;
        this.roster = next;
        for (const [id, player] of next) {
            if (!before.has(id) && id !== mine) this.emitEvent('join', player);
        }
    }
    relay (channel, data, to) {
        if (!this.connected || this.userClosed) return false;
        this.connection.send(JSON.stringify({
            method: 'relay',
            channel: String(channel),
            data: typeof data === 'string' ? data : JSON.stringify(data),
            ...(to ? {to: String(to)} : {})
        }));
        return true;
    }
    sendPacket (packet) {
        if (this.userClosed) return;
        if (this.connection && this.connection.readyState === WebSocket.OPEN) {
            this.connection.send(JSON.stringify(packet));
        } else {
            this.queue.push(packet);
            if (this.queue.length > 200) this.queue.shift();
            this.ensureConnected();
        }
    }
    send (data) { this.sendPacket({method: 'send', data: String(data)}); }
    joinRoom (name) {
        const room = normalizeRoom(name);
        this.wantedRoom = room;
        if (this.room !== room) this.sendPacket({method: 'join', room});
        this.ensureConnected();
    }
    ask (data) {
        if (this.userClosed) return Promise.resolve('');
        const id = ++this.askSeq;
        return new Promise(resolve => {
            const timer = setTimeout(() => { this.asks.delete(id); resolve(''); }, ASK_TIMEOUT_MS);
            this.asks.set(id, {resolve, timer});
            this.sendPacket({method: 'ask', id, data: String(data)});
        });
    }
    failAsks () { this.asks.forEach(({resolve, timer}) => { clearTimeout(timer); resolve(''); }); this.asks.clear(); }
    ping () {
        if (!this.connection || this.connection.readyState !== WebSocket.OPEN) return;
        const id = ++this.pingSeq;
        this.pingSent.set(id, performance.now());
        if (this.pingSent.size > 10) this.pingSent.delete(this.pingSent.keys().next().value);
        this.connection.send(JSON.stringify({method: 'ping', id}));
    }
    queueCloud (name, value) {
        this.pendingCloud.set(name, value);
        if (this.cloudTimer) return;
        this.cloudTimer = setTimeout(() => {
            this.cloudTimer = null;
            const pending = this.pendingCloud;
            this.pendingCloud = new Map();
            pending.forEach((v, n) => this.sendPacket({method: 'set', name: n, value: typeof v === 'string' ? v : String(v)}));
        }, CLOUD_FLUSH_MS);
    }
    createVariable (name, value) { this.queueCloud(name, value); }
    updateVariable (name, value) { this.queueCloud(name, value); }
    renameVariable (name, newName) { this.sendPacket({method: 'rename', name, new_name: newName}); }
    deleteVariable (name) { this.sendPacket({method: 'delete', name}); }
    requestCloseConnection () {
        this.wanted = false;
        clearTimeout(this.reconnectTimer);
        clearInterval(this.pingTimer);
        this.failAsks();
        const ws = this.connection;
        this.connection = null;
        if (ws) ws.close();
    }
}
const MAX_SEATS = 8;
const READY = 'dimod-test-ready';
const PROJECT = 'dimod-test-project';
const RETRY_MS = 400;
const windows = new Map();
const listeners = new Set();
let installed = null;
const pruned = () => {
    for (const [seat, win] of windows) {
        if (win.closed) windows.delete(seat);
    }
};
const openCount = () => { pruned(); return windows.size; };
const notify = () => listeners.forEach(fn => fn(openCount()));
const testWindowsAvailable = () => {
    const context = getDimodGameContext();
    return Boolean(context && context.mode === 'test' && !context.seat && isCloudProject());
};
const onTestWindowsChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const sending = new Set();
const sendProject = async (vm, win, seat, update = false) => {
    if (sending.has(seat)) return false;
    sending.add(seat);
    let buffer = null;
    try { buffer = await vm.saveProjectSb3('arraybuffer'); } catch (e) { return false; } finally { sending.delete(seat); }
    if (win.closed) return false;
    win.postMessage({type: PROJECT, seat, buffer, update}, location.origin);
    return true;
};
const onMessage = event => {
    if (event.origin !== location.origin || !installed) return;
    const msg = event.data;
    if (!msg || msg.type !== READY) return;
    const win = windows.get(msg.seat);
    if (win && event.source === win) sendProject(installed, win, msg.seat);
};
const installTestWindowsEditor = vm => {
    if (installed) return;
    installed = vm;
    window.addEventListener('message', onMessage);
    onCloudStateChange(() => notify());
    setInterval(() => {
        const before = windows.size;
        pruned();
        if (windows.size !== before) notify();
    }, 1500);
};
const freeSeat = () => {
    pruned();
    for (let seat = 2; seat <= MAX_SEATS; seat++) if (!windows.has(seat)) return seat;
    return null;
};
const openTestWindow = vm => {
    installTestWindowsEditor(vm);
    const context = getDimodGameContext();
    const seat = freeSeat();
    if (!context || !seat) return null;
    const url = new URL('embed.html', location.href);
    url.searchParams.set('p', context.projectId);
    url.searchParams.set('test_seat', String(seat));
    url.searchParams.set('autostart', '1');
    const width = (vm.runtime.stageWidth || 480) + 40;
    const height = (vm.runtime.stageHeight || 360) + 120;
    const win = window.open(url.toString(), `dimod-test-player-${seat}`, `popup,width=${width},height=${height}`);
    if (!win) return null;
    windows.set(seat, win);
    notify();
    return seat;
};
const updateTestWindows = async vm => {
    pruned();
    let sent = 0;
    for (const [seat, win] of windows) {
        if (await sendProject(vm, win, seat, true)) sent += 1;
    }
    return sent;
};
const closeTestWindows = () => {
    for (const win of windows.values()) win.close();
    windows.clear();
    notify();
};
const testSeat = () => {
    try {
        const params = new URLSearchParams(location.search);
        if (!params.get('p') || !params.get('test_seat')) return null;
        return Math.min(MAX_SEATS, Math.max(2, parseInt(params.get('test_seat'), 10) || 2));
    } catch (e) { return null; }
};
const requestEditorProject = seat => new Promise((resolve, reject) => {
    const opener = window.opener;
    if (!opener) { reject(new Error('This window was not opened by the editor')); return; }
    const state = {timer: null, onAnswer: null};
    let tries = 0;
    const finish = (fn, value) => {
        clearInterval(state.timer);
        window.removeEventListener('message', state.onAnswer);
        fn(value);
    };
    state.onAnswer = event => {
        if (event.origin !== location.origin || event.source !== opener) return;
        const msg = event.data;
        if (msg && msg.type === PROJECT && msg.buffer) finish(resolve, msg.buffer);
    };
    window.addEventListener('message', state.onAnswer);
    const ask = () => {
        tries += 1;
        if (opener.closed || tries > 100) { finish(reject, new Error('The editor did not answer')); return; }
        opener.postMessage({type: READY, seat}, location.origin);
    };
    state.timer = setInterval(ask, RETRY_MS);
    ask();
});
const installTestWindowPlayer = (vm, seat) => {
    document.title = `Player ${seat} - test`;
    window.addEventListener('message', event => {
        if (event.origin !== location.origin || event.source !== window.opener) return;
        const msg = event.data;
        if (!msg || msg.type !== PROJECT || !msg.buffer || msg.seat !== seat || !msg.update) return;
        if (!vm.dimodTestWindowLoaded) return;
        vm.stop();
        vm.loadProject(msg.buffer).then(() => { vm.start(); vm.greenFlag(); });
    });
    vm.runtime.once('PROJECT_LOADED', () => { vm.dimodTestWindowLoaded = true; });
};
export {DimodGameClient, MAX_SEATS, PseudoServerSocket, closeTestWindows, gameServerToken, getDimodGameContext, hasPlayToken, installPseudoServer, installTestWindowPlayer, installTestWindowsEditor, normalizeRoom, onGameOrigin, onLatePlayToken, onTestWindowsChange, openTestWindow, requestEditorProject, testSeat, testWindowsAvailable, updateTestWindows};
