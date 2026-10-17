import {FILL_INS} from './dimod-server-blocks';
const HELPERS = {
    toNum: 'const toNum = v => { const n = Number(v); return Number.isNaN(n) ? 0 : n; };',
    toText: 'const toText = v => (v == null ? \'\' : typeof v === \'object\' ? JSON.stringify(v) : String(v));',
    toBool: 'const toBool = v => (typeof v === \'string\' ? !(v === \'\' || v === \'0\' || v.toLowerCase() === \'false\') : !!v);',
    compare: [
        'const compare = (a, b) => {',
        '  const n1 = Number(a), n2 = Number(b);',
        '  const blank = v => typeof v === \'string\' && v.trim() === \'\';',
        '  if (Number.isNaN(n1) || Number.isNaN(n2) || blank(a) || blank(b)) {',
        '    const s1 = toText(a).toLowerCase(), s2 = toText(b).toLowerCase();',
        '    return s1 < s2 ? -1 : s1 > s2 ? 1 : 0;',
        '  }',
        '  return n1 - n2;',
        '};'
    ].join('\n'),
    random: [
        'const random = (from, to) => {',
        '  const lo = Math.min(toNum(from), toNum(to)), hi = Math.max(toNum(from), toNum(to));',
        '  return Number.isInteger(lo) && Number.isInteger(hi) ? lo + Math.floor(Math.random() * (hi - lo + 1)) : lo + Math.random() * (hi - lo);',
        '};'
    ].join('\n'),
    mathop: [
        'const mathop = (op, n) => {',
        '  const r = x => x * Math.PI / 180, d = x => x * 180 / Math.PI;',
        '  switch (op) {',
        '    case \'abs\': return Math.abs(n); case \'floor\': return Math.floor(n); case \'ceiling\': return Math.ceil(n);',
        '    case \'sqrt\': return Math.sqrt(n); case \'sin\': return Math.round(Math.sin(r(n)) * 1e10) / 1e10;',
        '    case \'cos\': return Math.round(Math.cos(r(n)) * 1e10) / 1e10; case \'tan\': return Math.tan(r(n));',
        '    case \'asin\': return d(Math.asin(n)); case \'acos\': return d(Math.acos(n)); case \'atan\': return d(Math.atan(n));',
        '    case \'ln\': return Math.log(n); case \'log\': return Math.log10(n); case \'e ^\': return Math.exp(n); case \'10 ^\': return Math.pow(10, n);',
        '    default: return n;',
        '  }',
        '};'
    ].join('\n'),
    cloudName: 'const cloudName = n => (toText(n).startsWith(\'☁\') ? toText(n) : \'☁ \' + toText(n));',
    usernameOf: 'const usernameOf = p => (typeof p === \'string\' ? p : (p && p.username) || \'\');',
    keyOf: 'const keyOf = (o, k) => (Array.isArray(o) && /^\\d+$/.test(toText(k)) ? Number(k) - 1 : toText(k));',
    getItem: 'const getItem = (o, k) => (o == null || typeof o !== \'object\' ? \'\' : (o[keyOf(o, k)] ?? \'\'));',
    setItem: 'const setItem = (o, k, v) => { if (o != null && typeof o === \'object\') o[keyOf(o, k)] = v; };',
    removeItem: 'const removeItem = (o, k) => { if (Array.isArray(o)) o.splice(keyOf(o, k), 1); else if (o != null && typeof o === \'object\') delete o[toText(k)]; };',
    addItem: 'const addItem = (l, v) => { if (Array.isArray(l)) l.push(v); };',
    hasItem: 'const hasItem = (o, k) => o != null && typeof o === \'object\' && Object.prototype.hasOwnProperty.call(o, keyOf(o, k));',
    lengthOf: 'const lengthOf = v => (Array.isArray(v) ? v.length : v != null && typeof v === \'object\' ? Object.keys(v).length : toText(v).length);',
    namesIn: 'const namesIn = v => (Array.isArray(v) ? v.map((_, i) => i + 1) : v != null && typeof v === \'object\' ? Object.keys(v) : []);',
    readJSON: 'const readJSON = t => { try { return JSON.parse(toText(t)); } catch (e) { return \'\'; } };',
    typeOf: 'const typeOf = v => (v == null || v === \'\' ? \'nothing\' : Array.isArray(v) ? \'list\' : typeof v === \'object\' ? \'object\' : typeof v === \'boolean\' ? \'boolean\' : Number.isNaN(Number(v)) ? \'text\' : \'number\');',
    listOf: 'const listOf = v => (Array.isArray(v) ? v : v != null && typeof v === \'object\' ? Object.values(v) : []);',
    listItem: [
        'const listItem = (l, i) => {',
        '  if (!l.length) return \'\';',
        '  const s = toText(i).toLowerCase();',
        '  const n = s === \'last\' ? l.length : s === \'random\' || s === \'any\' ? 1 + Math.floor(Math.random() * l.length) : Math.floor(toNum(i));',
        '  return n >= 1 && n <= l.length ? l[n - 1] : \'\';',
        '};'
    ].join('\n'),
    idOf: 'const idOf = p => (p && typeof p === \'object\' ? p.id : toText(p));',
    isOnline: 'const isOnline = p => players().some(x => x.id === idOf(p) || x.username.toLowerCase() === usernameOf(p).toLowerCase());',
    guestOf: [
        'const guestOf = p => {',
        '  if (p && typeof p === \'object\') return !p.loggedIn;',
        '  const u = usernameOf(p).toLowerCase(), i = idOf(p);',
        '  const q = players().find(x => x.id === i || x.username.toLowerCase() === u);',
        '  return q ? !q.loggedIn : true;',
        '};'
    ].join('\n'),
    currentDate: [
        'const currentDate = part => {',
        '  const d = new Date();',
        '  return { year: d.getFullYear(), month: d.getMonth() + 1, date: d.getDate(), day: d.getDay() + 1, hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() }[part];',
        '};'
    ].join('\n'),
    randomItem: 'const randomItem = l => { const items = listOf(l); return items.length ? items[Math.floor(Math.random() * items.length)] : \'\'; };',
    sortList: 'const sortList = (l, order) => [...listOf(l)].sort((a, b) => (order === \'desc\' ? -compare(a, b) : compare(a, b)));',
    copyOf: 'const copyOf = v => (v != null && typeof v === \'object\' ? JSON.parse(JSON.stringify(v)) : v);',
    listIndex: [
        'const listIndex = (l, i, extra = 0) => {',
        '  const s = toText(i).toLowerCase();',
        '  if (s === \'last\') return l.length + extra;',
        '  if (s === \'random\' || s === \'any\') return 1 + Math.floor(Math.random() * (l.length + extra));',
        '  return Math.floor(toNum(i));',
        '};'
    ].join('\n'),
    samePlayer: [
        'const samePlayer = (a, b) => {',
        '  const ua = usernameOf(a), ub = usernameOf(b);',
        '  return (idOf(a) !== \'\' && idOf(a) === idOf(b)) || (ua !== \'\' && ua.toLowerCase() === ub.toLowerCase());',
        '};'
    ].join('\n'),
    roundTo: 'const roundTo = (n, places) => { const f = Math.pow(10, Math.max(0, Math.min(15, Math.round(toNum(places))))); return Math.round(toNum(n) * f) / f; };',
    clamp: 'const clamp = (n, a, b) => Math.min(Math.max(toNum(a), toNum(b)), Math.max(Math.min(toNum(a), toNum(b)), toNum(n)));',
    letters: 'const letters = (t, from, to) => toText(t).slice(Math.max(0, Math.round(toNum(from)) - 1), Math.max(0, Math.round(toNum(to))));',
    uniqueId: 'const uniqueId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);',
    aggregate: [
        'const aggregate = (op, l) => {',
        '  const nums = listOf(l).map(toNum);',
        '  if (!nums.length) return 0;',
        '  const sum = nums.reduce((a, b) => a + b, 0);',
        '  if (op === \'sum\') return sum;',
        '  if (op === \'average\') return sum / nums.length;',
        '  return nums.reduce((a, b) => (op === \'min\' ? Math.min(a, b) : Math.max(a, b)));',
        '};'
    ].join('\n'),
    sortBy: 'const sortBy = (l, k, order) => [...listOf(l)].sort((a, b) => (order === \'desc\' ? -1 : 1) * compare(getItem(a, k), getItem(b, k)));',
    listSlice: 'const listSlice = (l, from, to) => listOf(l).slice(Math.max(0, Math.round(toNum(from)) - 1), Math.max(0, Math.round(toNum(to))));',
    shuffled: [
        'const shuffled = l => {',
        '  const a = [...listOf(l)];',
        '  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }',
        '  return a;',
        '};'
    ].join('\n'),
    insertItem: 'const insertItem = (l, at, v) => { if (Array.isArray(l)) l.splice(Math.min(l.length, Math.max(0, Math.round(toNum(at)) - 1)), 0, v); };',
    timerIds: 'const timerIds = new Set();'
};
const DEPENDS = {
    compare: ['toText'], random: ['toNum'], cloudName: ['toText'], keyOf: ['toText'],
    getItem: ['keyOf'], setItem: ['keyOf'], removeItem: ['keyOf', 'toText'], hasItem: ['keyOf'],
    lengthOf: ['toText'], readJSON: ['toText'], listItem: ['toText', 'toNum'], listIndex: ['toText', 'toNum'],
    idOf: ['toText'], isOnline: ['idOf', 'usernameOf'], randomItem: ['listOf'], sortList: ['listOf', 'compare'],
    guestOf: ['idOf', 'usernameOf'],
    samePlayer: ['idOf', 'usernameOf'], roundTo: ['toNum'], clamp: ['toNum'], letters: ['toText', 'toNum'],
    aggregate: ['listOf', 'toNum'], sortBy: ['listOf', 'compare', 'getItem'], listSlice: ['listOf', 'toNum'],
    shuffled: ['listOf'], insertItem: ['toNum']
};
const HANDLER_HATS = {
    dimodserver_whenstarts: ['start', []],
    dimodserver_whenconnects: ['connect', ['player']],
    dimodserver_whendisconnects: ['disconnect', ['player']],
    dimodserver_whensends: ['send', ['player', 'data']],
    dimodserver_whenasks: ['ask', ['player', 'question']]
};
const generateServerCode = workspace => {
    const used = new Set();
    const use = (...names) => {
        for (const n of names) {
            if (used.has(n)) continue;
            used.add(n);
            use(...(DEPENDS[n] || []));
        }
    };
    const varNames = new Map();
    const takenNames = new Set();
    const ident = variable => {
        if (varNames.has(variable.getId())) return varNames.get(variable.getId());
        let base = `${variable.type === 'list' ? 'list' : 'var'}_${String(variable.name).replace(/[^A-Za-z0-9_]/g, '_')}`;
        let name = base;
        for (let i = 2; takenNames.has(name); i++) name = `${base}_${i}`;
        takenNames.add(name);
        varNames.set(variable.getId(), name);
        return name;
    };
    const fieldVar = (block, field) => {
        const f = block.getField(field);
        const variable = f && f.getVariable && f.getVariable();
        return variable ? ident(variable) : 'undefined';
    };
    const procNames = new Map();
    const procName = proccode => {
        if (procNames.has(proccode)) return procNames.get(proccode);
        const base = `block_${String(proccode).replace(/%[sbn]/g, '').trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed'}`;
        let name = base;
        for (let i = 2; [...procNames.values()].includes(name); i++) name = `${base}_${i}`;
        procNames.set(proccode, name);
        return name;
    };
    const mutation = block => {
        const m = block.mutationToDom && block.mutationToDom();
        const attr = (name, fallback) => {
            const v = m && m.getAttribute(name);
            if (v === null || v === undefined) return fallback;
            try { return JSON.parse(v); } catch (e) { return v; }
        };
        return {proccode: m ? m.getAttribute('proccode') : '', ids: attr('argumentids', []), names: attr('argumentnames', [])};
    };
    let currentArgs = null;
    const LOOP_BLOCKS = new Set(['control_repeat', 'control_repeat_until', 'control_while', 'dimodserver_foreach', 'dimodserver_count']);
    const tracksTimers = workspace.getAllBlocks(false).some(b => b.type === 'dimodserver_stoptimers' && (!b.isEnabled || b.isEnabled()));
    const FUNCTION_BOUNDARIES = new Set(['dimodserver_every', 'dimodserver_after']);
    const insideLoop = b => {
        for (let p = b.getSurroundParent(); p; p = p.getSurroundParent()) {
            if (LOOP_BLOCKS.has(p.type)) return true;
            if (FUNCTION_BOUNDARIES.has(p.type)) return false;
        }
        return false;
    };
    const indentOf = code => code.split('\n').map(l => (l ? `  ${l}` : l)).join('\n');
    const expr = (block, name, fallback = '\'\'') => {
        const target = block.getInputTargetBlock(name);
        return target ? value(target) : fallback;
    };
    const num = (block, name) => {
        const target = block.getInputTargetBlock(name);
        if (target && /^math_/.test(target.type)) {
            const n = Number(target.getFieldValue('NUM'));
            if (target.getFieldValue('NUM') !== '' && !Number.isNaN(n)) return String(n);
        }
        use('toNum');
        return `toNum(${target ? value(target) : 0})`;
    };
    const BOOLEAN_BLOCKS = new Set([
        'operator_gt', 'operator_lt', 'operator_equals', 'operator_and', 'operator_or', 'operator_not', 'operator_contains',
        'data_listcontainsitem', 'dimodserver_hasitem', 'dimodserver_loggedin', 'dimodserver_isonline', 'dimodserver_contains',
        'dimodserver_sameplayer', 'dimodserver_hassaved', 'dimodserver_startswith', 'dimodserver_endswith', 'dimodserver_dbhas'
    ]);
    const cond = (block, name) => {
        const target = block.getInputTargetBlock(name);
        if (!target) return 'false';
        if (BOOLEAN_BLOCKS.has(target.type)) return value(target);
        use('toBool');
        return `toBool(${value(target)})`;
    };
    const text = (block, name) => { use('toText'); return `toText(${expr(block, name)})`; };
    const value = b => {
        if (FILL_INS[b.type]) return FILL_INS[b.type];
        switch (b.type) {
        case 'math_number': case 'math_positive_number': case 'math_whole_number': case 'math_integer': case 'math_angle': {
            const raw = b.getFieldValue('NUM');
            const n = Number(raw);
            return raw !== '' && !Number.isNaN(n) ? String(n) : JSON.stringify(raw);
        }
        case 'text': return JSON.stringify(b.getFieldValue('TEXT'));
        case 'data_variable': return fieldVar(b, 'VARIABLE');
        case 'data_listcontents': use('toText'); return `${fieldVar(b, 'LIST')}.map(toText).join(' ')`;
        case 'data_itemoflist': use('listItem'); return `listItem(${fieldVar(b, 'LIST')}, ${expr(b, 'INDEX', 1)})`;
        case 'data_itemnumoflist': use('compare'); return `(${fieldVar(b, 'LIST')}.findIndex(x => compare(x, ${expr(b, 'ITEM')}) === 0) + 1)`;
        case 'data_lengthoflist': return `${fieldVar(b, 'LIST')}.length`;
        case 'data_listcontainsitem': use('compare'); return `${fieldVar(b, 'LIST')}.some(x => compare(x, ${expr(b, 'ITEM')}) === 0)`;
        case 'operator_add': return `(${num(b, 'NUM1')} + ${num(b, 'NUM2')})`;
        case 'operator_subtract': return `(${num(b, 'NUM1')} - ${num(b, 'NUM2')})`;
        case 'operator_multiply': return `(${num(b, 'NUM1')} * ${num(b, 'NUM2')})`;
        case 'operator_divide': return `(${num(b, 'NUM1')} / ${num(b, 'NUM2')})`;
        case 'operator_mod': { const n = num(b, 'NUM1'), m = num(b, 'NUM2'); return `(((${n}) % (${m})) + (${m})) % (${m})`; }
        case 'operator_round': return `Math.round(${num(b, 'NUM')})`;
        case 'operator_mathop': use('mathop'); return `mathop(${JSON.stringify(b.getFieldValue('OPERATOR'))}, ${num(b, 'NUM')})`;
        case 'operator_random': use('random'); return `random(${expr(b, 'FROM', 1)}, ${expr(b, 'TO', 10)})`;
        case 'operator_gt': use('compare'); return `(compare(${expr(b, 'OPERAND1')}, ${expr(b, 'OPERAND2')}) > 0)`;
        case 'operator_lt': use('compare'); return `(compare(${expr(b, 'OPERAND1')}, ${expr(b, 'OPERAND2')}) < 0)`;
        case 'operator_equals': use('compare'); return `(compare(${expr(b, 'OPERAND1')}, ${expr(b, 'OPERAND2')}) === 0)`;
        case 'operator_and': return `(${cond(b, 'OPERAND1')} && ${cond(b, 'OPERAND2')})`;
        case 'operator_or': return `(${cond(b, 'OPERAND1')} || ${cond(b, 'OPERAND2')})`;
        case 'operator_not': return `!${cond(b, 'OPERAND')}`;
        case 'operator_join': return `(${text(b, 'STRING1')} + ${text(b, 'STRING2')})`;
        case 'operator_letter_of': return `${text(b, 'STRING')}.charAt(${num(b, 'LETTER')} - 1)`;
        case 'operator_length': return `${text(b, 'STRING')}.length`;
        case 'operator_contains': return `${text(b, 'STRING1')}.toLowerCase().includes(${text(b, 'STRING2')}.toLowerCase())`;
        case 'dimodserver_players': return 'players()';
        case 'dimodserver_playercount': return 'playerCount()';
        case 'dimodserver_room': return 'room';
        case 'dimodserver_playernamed': return `findPlayer(${expr(b, 'NAME')})`;
        case 'dimodserver_username': use('usernameOf'); return `usernameOf(${expr(b, 'PLAYER')})`;
        case 'dimodserver_loggedin': return `!!((${expr(b, 'PLAYER')}) || {}).loggedIn`;
        case 'dimodserver_isguest': use('guestOf'); return `guestOf(${expr(b, 'PLAYER')})`;
        case 'dimodserver_getcloud': return `getCloud(${expr(b, 'NAME')})`;
        case 'dimodserver_getplayercloud': return `getPlayerCloud(${expr(b, 'PLAYER')}, ${expr(b, 'NAME')})`;
        case 'dimodserver_saved': return `storage.get(${expr(b, 'KEY')})`;
        case 'dimodserver_newobject': return '{}';
        case 'dimodserver_newlist': return '[]';
        case 'dimodserver_getitem': use('getItem'); return `getItem(${expr(b, 'OBJECT')}, ${expr(b, 'KEY')})`;
        case 'dimodserver_hasitem': use('hasItem'); return `hasItem(${expr(b, 'OBJECT')}, ${expr(b, 'KEY')})`;
        case 'dimodserver_length': use('lengthOf'); return `lengthOf(${expr(b, 'OBJECT')})`;
        case 'dimodserver_names': use('namesIn'); return `namesIn(${expr(b, 'OBJECT')})`;
        case 'dimodserver_readjson': use('readJSON'); return `readJSON(${expr(b, 'TEXT')})`;
        case 'dimodserver_tojson': return `JSON.stringify(${expr(b, 'VALUE', 'null')})`;
        case 'dimodserver_typeof': use('typeOf'); return `typeOf(${expr(b, 'VALUE')})`;
        case 'dimodserver_playerid': use('idOf'); return `idOf(${expr(b, 'PLAYER')})`;
        case 'dimodserver_isonline': use('isOnline'); return `isOnline(${expr(b, 'PLAYER')})`;
        case 'dimodserver_savednames': return 'storage.keys()';
        case 'dimodserver_ifelse': return `(${cond(b, 'CONDITION')} ? ${expr(b, 'THEN')} : ${expr(b, 'ELSE')})`;
        case 'dimodserver_min': return `Math.min(${num(b, 'NUM1')}, ${num(b, 'NUM2')})`;
        case 'dimodserver_max': return `Math.max(${num(b, 'NUM1')}, ${num(b, 'NUM2')})`;
        case 'dimodserver_split': return `${text(b, 'TEXT')}.split(${text(b, 'SEPARATOR')})`;
        case 'dimodserver_joinlist': use('listOf', 'toText'); return `listOf(${expr(b, 'LIST', '[]')}).map(toText).join(${text(b, 'SEPARATOR')})`;
        case 'dimodserver_replace': return `${text(b, 'TEXT')}.split(${text(b, 'FIND')}).join(${text(b, 'REPLACE')})`;
        case 'dimodserver_case': return `${text(b, 'TEXT')}.${b.getFieldValue('CASE') === 'lower' ? 'toLowerCase' : 'toUpperCase'}()`;
        case 'dimodserver_now': return 'Date.now()';
        case 'dimodserver_currentdate': use('currentDate'); return `currentDate(${JSON.stringify(b.getFieldValue('PART'))})`;
        case 'dimodserver_values': use('listOf'); return `listOf(${expr(b, 'OBJECT')})`;
        case 'dimodserver_contains': use('listOf', 'compare'); return `listOf(${expr(b, 'LIST', '[]')}).some(x => compare(x, ${expr(b, 'VALUE')}) === 0)`;
        case 'dimodserver_indexof': use('listOf', 'compare'); return `(listOf(${expr(b, 'LIST', '[]')}).findIndex(x => compare(x, ${expr(b, 'VALUE')}) === 0) + 1)`;
        case 'dimodserver_randomitem': use('randomItem'); return `randomItem(${expr(b, 'LIST', '[]')})`;
        case 'dimodserver_sort': use('sortList'); return `sortList(${expr(b, 'LIST', '[]')}, ${JSON.stringify(b.getFieldValue('ORDER'))})`;
        case 'dimodserver_copy': use('copyOf'); return `copyOf(${expr(b, 'VALUE')})`;
        case 'dimodserver_dbget': use('toText'); return `db.get(toText(${expr(b, 'KEY')}))`;
        case 'dimodserver_dbgetor': use('toText'); return `(db.get(toText(${expr(b, 'KEY')})) ?? ${expr(b, 'DEFAULT')})`;
        case 'dimodserver_dbhas': use('toText'); return `db.has(toText(${expr(b, 'KEY')}))`;
        case 'dimodserver_dbkeys': use('toText'); return `db.keys(toText(${expr(b, 'PREFIX')}))`;
        case 'dimodserver_dbsize': return '(Math.round(db.size() / 10485.76) / 100)';
        case 'dimodserver_host': return '(players()[0] || \'\')';
        case 'dimodserver_playernumber': return `(players()[${num(b, 'INDEX')} - 1] || '')`;
        case 'dimodserver_randomplayer': use('randomItem'); return 'randomItem(players())';
        case 'dimodserver_sameplayer': use('samePlayer'); return `samePlayer(${expr(b, 'PLAYER1')}, ${expr(b, 'PLAYER2')})`;
        case 'dimodserver_savedor': return `(storage.get(${expr(b, 'KEY')}) ?? ${expr(b, 'DEFAULT')})`;
        case 'dimodserver_hassaved': return `(storage.get(${expr(b, 'KEY')}) !== null)`;
        case 'dimodserver_secondssince': return `((Date.now() - ${num(b, 'TIME')}) / 1000)`;
        case 'dimodserver_roundto': use('roundTo'); return `roundTo(${expr(b, 'NUM', 0)}, ${expr(b, 'PLACES', 0)})`;
        case 'dimodserver_clamp': use('clamp'); return `clamp(${expr(b, 'NUM', 0)}, ${expr(b, 'MIN', 0)}, ${expr(b, 'MAX', 0)})`;
        case 'dimodserver_distance': return `Math.hypot(${num(b, 'X2')} - ${num(b, 'X1')}, ${num(b, 'Y2')} - ${num(b, 'Y1')})`;
        case 'dimodserver_startswith': return `${text(b, 'TEXT')}.toLowerCase().startsWith(${text(b, 'PREFIX')}.toLowerCase())`;
        case 'dimodserver_endswith': return `${text(b, 'TEXT')}.toLowerCase().endsWith(${text(b, 'SUFFIX')}.toLowerCase())`;
        case 'dimodserver_letters': use('letters'); return `letters(${expr(b, 'TEXT')}, ${expr(b, 'FROM', 1)}, ${expr(b, 'TO', 1)})`;
        case 'dimodserver_trim': return `${text(b, 'TEXT')}.trim()`;
        case 'dimodserver_uniqueid': use('uniqueId'); return 'uniqueId()';
        case 'dimodserver_sortby': use('sortBy'); return `sortBy(${expr(b, 'LIST', '[]')}, ${expr(b, 'KEY')}, ${JSON.stringify(b.getFieldValue('ORDER'))})`;
        case 'dimodserver_slice': use('listSlice'); return `listSlice(${expr(b, 'LIST', '[]')}, ${expr(b, 'FROM', 1)}, ${expr(b, 'TO', 1)})`;
        case 'dimodserver_shuffle': use('shuffled'); return `shuffled(${expr(b, 'LIST', '[]')})`;
        case 'dimodserver_aggregate': use('aggregate'); return `aggregate(${JSON.stringify(b.getFieldValue('OP'))}, ${expr(b, 'LIST', '[]')})`;
        case 'argument_reporter_string_number':
        case 'argument_reporter_boolean': {
            const name = b.getFieldValue('VALUE');
            return currentArgs && currentArgs.has(name) ? currentArgs.get(name) : '\'\'';
        }
        case 'procedures_call': return callProc(b);
        default: return `'' /* ${b.type} isn't a server block */`;
        }
    };
    const statement = b => {
        switch (b.type) {
        case 'control_if':
            return `if (${cond(b, 'CONDITION')}) {\n${stack(b.getInputTargetBlock('SUBSTACK'))}}\n`;
        case 'control_if_else':
            return `if (${cond(b, 'CONDITION')}) {\n${stack(b.getInputTargetBlock('SUBSTACK'))}} else {\n${stack(b.getInputTargetBlock('SUBSTACK2'))}}\n`;
        case 'control_repeat':
            return `for (let i = Math.round(${num(b, 'TIMES')}); i > 0; i--) {\n${stack(b.getInputTargetBlock('SUBSTACK'))}}\n`;
        case 'control_repeat_until':
            return `while (!${cond(b, 'CONDITION')}) {\n${stack(b.getInputTargetBlock('SUBSTACK'))}}\n`;
        case 'control_while':
            return `while (${cond(b, 'CONDITION')}) {\n${stack(b.getInputTargetBlock('SUBSTACK'))}}\n`;
        case 'dimodserver_foreach':
            use('listOf');
            return `{\n  const items = listOf(${expr(b, 'LIST', '[]')});\n  for (const item of items) {\n${indentOf(stack(b.getInputTargetBlock('SUBSTACK')))}  }\n}\n`;
        case 'dimodserver_count':
            return `{\n  const from = Math.round(${num(b, 'FROM')}), to = Math.round(${num(b, 'TO')}), step = from <= to ? 1 : -1;\n` +
                `  for (let index = from; step > 0 ? index <= to : index >= to; index += step) {\n${indentOf(stack(b.getInputTargetBlock('SUBSTACK')))}  }\n}\n`;
        case 'dimodserver_every':
            if (tracksTimers) {
                use('timerIds');
                return `timerIds.add(every(${num(b, 'SECONDS')} * 1000, () => {\n${stack(b.getInputTargetBlock('SUBSTACK'))}}));\n`;
            }
            return `every(${num(b, 'SECONDS')} * 1000, () => {\n${stack(b.getInputTargetBlock('SUBSTACK'))}});\n`;
        case 'dimodserver_after':
            if (tracksTimers) {
                use('timerIds');
                return `{\n  const id = after(${num(b, 'SECONDS')} * 1000, () => {\n    timerIds.delete(id);\n${indentOf(stack(b.getInputTargetBlock('SUBSTACK')))}  });\n  timerIds.add(id);\n}\n`;
            }
            return `after(${num(b, 'SECONDS')} * 1000, () => {\n${stack(b.getInputTargetBlock('SUBSTACK'))}});\n`;
        case 'dimodserver_stoptimers':
            use('timerIds');
            return 'timerIds.forEach(id => cancel(id));\ntimerIds.clear();\n';
        case 'dimodserver_stop': return 'return;\n';
        case 'dimodserver_respond': return `return ${expr(b, 'DATA')};\n`;
        case 'dimodserver_reject': return 'return false;\n';
        case 'data_setvariableto': return `${fieldVar(b, 'VARIABLE')} = ${expr(b, 'VALUE')};\n`;
        case 'data_changevariableby': { use('toNum'); const v = fieldVar(b, 'VARIABLE'); return `${v} = toNum(${v}) + ${num(b, 'VALUE')};\n`; }
        case 'data_addtolist': return `${fieldVar(b, 'LIST')}.push(${expr(b, 'ITEM')});\n`;
        case 'data_deleteoflist': {
            use('listIndex', 'toText');
            const l = fieldVar(b, 'LIST');
            return `if (toText(${expr(b, 'INDEX', 1)}).toLowerCase() === 'all') ${l}.length = 0; else ${l}.splice(listIndex(${l}, ${expr(b, 'INDEX', 1)}) - 1, 1);\n`;
        }
        case 'data_deletealloflist': return `${fieldVar(b, 'LIST')}.length = 0;\n`;
        case 'data_insertatlist': { use('listIndex'); const l = fieldVar(b, 'LIST'); return `${l}.splice(listIndex(${l}, ${expr(b, 'INDEX', 1)}, 1) - 1, 0, ${expr(b, 'ITEM')});\n`; }
        case 'data_replaceitemoflist': {
            use('listIndex');
            const l = fieldVar(b, 'LIST');
            return `{ const at = listIndex(${l}, ${expr(b, 'INDEX', 1)}); if (at >= 1 && at <= ${l}.length) ${l}[at - 1] = ${expr(b, 'ITEM')}; }\n`;
        }
        case 'data_showvariable': case 'data_hidevariable': case 'data_showlist': case 'data_hidelist': return '';
        case 'dimodserver_send': return `send(${expr(b, 'PLAYER')}, ${expr(b, 'DATA')});\n`;
        case 'dimodserver_sendall': return `sendAll(${expr(b, 'DATA')});\n`;
        case 'dimodserver_sendallexcept': return `sendAllExcept(${expr(b, 'PLAYER')}, ${expr(b, 'DATA')});\n`;
        case 'dimodserver_disconnect': return `disconnect(${expr(b, 'PLAYER')}, ${expr(b, 'REASON')});\n`;
        case 'dimodserver_changecloud': use('toNum'); return `setCloud(${expr(b, 'NAME')}, toNum(getCloud(${expr(b, 'NAME')})) + ${num(b, 'VALUE')});\n`;
        case 'dimodserver_deletesaved': return `storage.delete(${expr(b, 'KEY')});\n`;
        case 'dimodserver_break': return insideLoop(b) ? 'break;\n' : '/* "stop this loop" needs to be inside a loop */\n';
        case 'procedures_call': return `${callProc(b)};\n`;
        case 'procedures_return': return `return ${expr(b, 'return')};\n`;
        case 'dimodserver_setcloud': return `setCloud(${expr(b, 'NAME')}, ${expr(b, 'VALUE')});\n`;
        case 'dimodserver_setplayercloud': return `setPlayerCloud(${expr(b, 'PLAYER')}, ${expr(b, 'NAME')}, ${expr(b, 'VALUE')});\n`;
        case 'dimodserver_changeplayercloud': use('toNum'); return `setPlayerCloud(${expr(b, 'PLAYER')}, ${expr(b, 'NAME')}, toNum(getPlayerCloud(${expr(b, 'PLAYER')}, ${expr(b, 'NAME')})) + ${num(b, 'VALUE')});\n`;
        case 'dimodserver_save': return `storage.set(${expr(b, 'KEY')}, ${expr(b, 'VALUE')});\n`;
        case 'dimodserver_log': return `log(${expr(b, 'VALUE')});\n`;
        case 'dimodserver_setitem': use('setItem'); return `setItem(${expr(b, 'OBJECT')}, ${expr(b, 'KEY')}, ${expr(b, 'VALUE')});\n`;
        case 'dimodserver_removeitem': use('removeItem'); return `removeItem(${expr(b, 'OBJECT')}, ${expr(b, 'KEY')});\n`;
        case 'dimodserver_additem': use('addItem'); return `addItem(${expr(b, 'LIST')}, ${expr(b, 'VALUE')});\n`;
        case 'dimodserver_dbset': use('toText'); return `db.set(toText(${expr(b, 'KEY')}), ${expr(b, 'VALUE')});\n`;
        case 'dimodserver_dbdelete': use('toText'); return `db.delete(toText(${expr(b, 'KEY')}));\n`;
        case 'dimodserver_dbchange': {
            use('toText', 'toNum');
            return `{\n  const key = toText(${expr(b, 'KEY')});\n  db.set(key, toNum(db.get(key)) + ${num(b, 'VALUE')});\n}\n`;
        }
        case 'dimodserver_insertitem': use('insertItem'); return `insertItem(${expr(b, 'LIST')}, ${expr(b, 'INDEX', 1)}, ${expr(b, 'VALUE')});\n`;
        case 'dimodserver_changesaved': use('toNum'); return `storage.set(${expr(b, 'KEY')}, toNum(storage.get(${expr(b, 'KEY')})) + ${num(b, 'VALUE')});\n`;
        case 'dimodserver_sendeach':
            use('listOf');
            return `{\n  const payload = ${expr(b, 'DATA')};\n  for (const target of listOf(${expr(b, 'LIST', '[]')})) send(target, payload);\n}\n`;
        default: return `/* ${b.type} isn't a server block */\n`;
        }
    };
    function callProc (b) {
        const {proccode, ids} = mutation(b);
        const args = (Array.isArray(ids) ? ids : []).map(id => expr(b, id));
        return `${procName(proccode)}(${args.join(', ')})`;
    }
    const stack = first => {
        let out = '';
        for (let b = first; b; b = b.getNextBlock()) {
            if (!b.isEnabled || b.isEnabled()) out += statement(b);
        }
        return indentOf(out);
    };
    const handlers = [];
    const functions = [];
    const tops = workspace.getTopBlocks(true);
    for (const top of tops) {
        const next = top.getNextBlock();
        if (top.type === 'procedures_definition' || top.type === 'procedures_definition_return') {
            const prototype = top.getInputTargetBlock('custom_block');
            if (!prototype) continue;
            const {proccode, names} = mutation(prototype);
            const params = [];
            currentArgs = new Map();
            (Array.isArray(names) ? names : []).forEach((argName, i) => {
                let param = `arg_${String(argName).replace(/[^A-Za-z0-9_]/g, '_') || i}`;
                while (params.includes(param)) param += '_';
                params.push(param);
                currentArgs.set(argName, param);
            });
            functions.push(`function ${procName(proccode)}(${params.join(', ')}) {\n${stack(next)}}`);
            currentArgs = null;
            continue;
        }
        if (HANDLER_HATS[top.type]) {
            const [event, params] = HANDLER_HATS[top.type];
            handlers.push(`on('${event}', (${params.join(', ')}) => {\n${stack(next)}});`);
        } else if (top.type === 'dimodserver_whencloud') {
            use('cloudName');
            handlers.push(
                `on('cloud', (player, name, value) => {\n` +
                `  if (name !== cloudName(${expr(top, 'NAME')})) return;\n${stack(next)}});`
            );
        }
    }
    const declarations = workspace.getAllVariables()
        .filter(v => v.type === '' || v.type === 'list')
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map(v => `let ${ident(v)} = ${v.type === 'list' ? '[]' : '0'}; // ${v.name}`);
    const ordered = [];
    const visit = n => {
        if (ordered.includes(n)) return;
        (DEPENDS[n] || []).forEach(visit);
        ordered.push(n);
    };
    [...used].forEach(visit);
    const parts = [];
    if (ordered.length) parts.push(ordered.map(n => HELPERS[n]).join('\n'));
    if (declarations.length) parts.push(declarations.join('\n'));
    if (functions.length) parts.push(functions.join('\n\n'));
    if (handlers.length) parts.push(handlers.join('\n\n'));
    return parts.join('\n\n') + (parts.length ? '\n' : '');
};
const dimodServerTypes = `
/** Someone connected to this room. */
interface Player {
    /** Stable for as long as they are connected. */
    id: string;
    username: string;
    /** false for guests. */
    loggedIn: boolean;
}

/** Run when this room's code starts. */
declare function on(event: 'start', handler: () => void): void;
/** Run when a player joins. */
declare function on(event: 'connect', handler: (player: Player) => void): void;
/** Run when a player leaves. */
declare function on(event: 'disconnect', handler: (player: Player) => void): void;
/** Run when a player's project sends data to the server. */
declare function on(event: 'send', handler: (player: Player, data: any) => void): void;
/** Run when a player asks a question. The first handler that returns something answers it. */
declare function on(event: 'ask', handler: (player: Player, question: any) => any): void;
/** Run when a player changes a cloud variable. Return false to reject the change. */
declare function on(event: 'cloud', handler: (player: Player, name: string, value: any) => boolean | void): void;

/** Send data to one player's "when I receive". */
declare function send(player: Player | string, data: any): void;
/** Send data to everyone in this room. */
declare function sendAll(data: any): void;
/** Send data to everyone in this room but one player. */
declare function sendAllExcept(player: Player | string, data: any): void;
/** Kick a player. */
declare function disconnect(player: Player | string, reason?: string): void;
/** Everyone in this room. */
declare function players(): Player[];
/** How many players are online in this room. */
declare function playerCount(): number;
/** A player by username, or null. */
declare function findPlayer(username: string): Player | null;

/**
 * The room this copy of your code is running for. Each room has its own players, cloud
 * variables and copy of your code; the database is shared.
 */
declare const room: string;

/** Read a cloud variable (the cloud symbol is optional in the name). */
declare function getCloud(name: string): any;
/** Set a cloud variable for everyone in this room. */
declare function setCloud(name: string, value: any): void;
/**
 * Read one player's own value of a per-player cloud variable ("☁ 👤 name"; both symbols
 * are optional). null when they don't have one or aren't in this room.
 */
declare function getPlayerCloud(player: Player | string, name: string): any;
/** Set one player's own value of a per-player cloud variable. Only they see it; it's saved to their account. */
declare function setPlayerCloud(player: Player | string, name: string, value: any): void;

/** Database kept between sessions: 50 MB per game, 1 MB per value. */
declare const db: {
    get(key: string): any;
    /** Returns false (and logs why) when the value doesn't fit. Setting null deletes the key. */
    set(key: string, value: any): boolean;
    delete(key: string): void;
    has(key: string): boolean;
    keys(prefix?: string): string[];
    /** Bytes in use. */
    size(): number;
};

/** Older 1 MB of saved values. Use db for new games. */
declare const storage: {
    get(key: string): any;
    set(key: string, value: any): void;
    delete(key: string): void;
    keys(): string[];
};

/** Repeat every so many milliseconds. Returns an id for cancel(). */
declare function every(ms: number, fn: () => void): number;
/** Run once after so many milliseconds. Returns an id for cancel(). */
declare function after(ms: number, fn: () => void): number;
/** Stop a timer. */
declare function cancel(id: number): void;

/** Print to the console under the editor. */
declare function log(...values: any[]): void;
`;
export {generateServerCode, dimodServerTypes as serverTypes};
