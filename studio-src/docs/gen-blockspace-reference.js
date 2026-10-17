const fs = require('fs');
const path = require('path');
const vmModule = require('vm');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');
const babel = require(`${ROOT}/node_modules/@babel/core`);
const orig = Module._extensions['.js'];
Module._extensions['.js'] = function (module, filename) {
    const src = fs.readFileSync(filename, 'utf8');
    const rel = filename.replace(ROOT, '');
    if (/\b(import|export)\b/.test(src) && (rel.startsWith('/src') || /^\/node_modules\/scratch-/.test(rel))) {
        const out = babel.transformSync(src, {filename, babelrc: false, configFile: false,
            presets: [[`${ROOT}/node_modules/@babel/preset-env`, {targets: {node: 'current'}, modules: 'commonjs'}]]});
        return module._compile(out.code, filename);
    }
    return orig(module, filename);
};
for (const ext of ['.css', '.svg', '.png']) Module._extensions[ext] = m => (m.exports = '');
const jsdom = require(`${ROOT}/node_modules/jsdom`);
const doc = jsdom.jsdom('<!doctype html><html><body></body></html>');
global.window = doc.defaultView;
global.document = doc;
const store = {};
global.localStorage = {getItem: k => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem: k => delete store[k]};
for (const k of Object.getOwnPropertyNames(window)) if (!(k in global)) try { global[k] = window[k]; } catch (e) {}
global.requestAnimationFrame = f => setTimeout(f, 0);
global.MutationObserver = class { observe () {} disconnect () {} };

const tsSource = fs.readFileSync(`${ROOT}/node_modules/monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js`, 'utf8')
    .replace(/^export var .*$/mg, '');
const sandbox = {module: {exports: {}}, console};
vmModule.runInNewContext(`${tsSource}\nmodule.exports = ts;`, sandbox);
const ts = sandbox.module.exports;

const editor = require(`${ROOT}/src/lib/block-space/editor.js`);
const file = ts.createSourceFile('api.d.ts', editor.apiTypes, ts.ScriptTarget.Latest, true);

const jsdocOf = node => {
    const docs = node.jsDoc || [];
    const last = docs[docs.length - 1];
    if (!last) return {doc: '', examples: []};
    const text = typeof last.comment === 'string' ? last.comment : (last.comment || []).map(c => c.text).join('');
    const examples = (last.tags || []).filter(t => t.tagName.text === 'example')
        .map(t => (typeof t.comment === 'string' ? t.comment : (t.comment || []).map(c => c.text).join('')).trim());
    return {doc: text.replace(/\s+/g, ' ').trim(), examples};
};
const textOf = node => {
    const full = node.getText(file);
    return full.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, '').replace(/\s+/g, ' ').replace(/;$/, '').trim();
};
const memberName = m => (m.name ? m.name.getText(file) : (ts.isCallSignatureDeclaration(m) ? '(call)' : '[index]'));

const types = [];
const globals = [];
for (const st of file.statements) {
    if (ts.isInterfaceDeclaration(st) || ts.isClassDeclaration(st)) {
        const {doc, examples} = jsdocOf(st);
        const members = [];
        for (const m of st.members) {
            if (ts.isIndexSignatureDeclaration(m)) continue;
            const info = jsdocOf(m);
            const name = memberName(m);
            if (name.startsWith('_')) continue;
            const prev = members.find(x => x.name === name);
            if (prev) {
                prev.signatures.push(textOf(m));
                if (!prev.doc) prev.doc = info.doc;
                continue;
            }
            members.push({name, signatures: [textOf(m)], doc: info.doc, examples: info.examples});
        }
        if ((!members.length && !doc) || /Event(Args|Filters)$/.test(st.name.text)) continue;
        types.push({name: st.name.text, kind: ts.isClassDeclaration(st) ? 'class' : 'interface', doc, examples,
            heritage: (st.heritageClauses || []).map(h => h.getText(file)).join(' '), members});
    } else if (ts.isFunctionDeclaration(st) || ts.isVariableStatement(st)) {
        const {doc, examples} = jsdocOf(st);
        const name = ts.isFunctionDeclaration(st) ? st.name.text : st.declarationList.declarations[0].name.getText(file);
        const prev = globals.find(g => g.name === name);
        if (prev) {
            prev.signatures.push(textOf(st).replace(/^declare /, ''));
            if (!prev.doc) prev.doc = doc;
            continue;
        }
        globals.push({name, signatures: [textOf(st).replace(/^declare /, '')], doc, examples});
    }
}
const events = {};
for (const [kind, list] of Object.entries(editor.CATALOG)) {
    events[kind] = list.map(ev => ({name: ev.name, summary: ev.summary, notes: ev.notes || '',
        params: (ev.params || []).map(p => ({name: p.name, type: p.type, doc: p.note || ''})),
        filter: ev.filter ? `${ev.filter.label}${ev.filter.required ? '' : ' (optional)'}` : '', example: ev.example || ''}));
}
const examples = editor.EXAMPLES.map(({group, label, code}) => ({group, label, code}));
const out = path.resolve(ROOT, '../frontend/src/data/blockspaceReference.json');
fs.writeFileSync(out, `${JSON.stringify({globals, types, events, examples}, null, 1)}\n`);
console.log(`wrote ${out}: ${globals.length} globals, ${types.length} types, ${Object.values(events).flat().length} events, ${examples.length} examples`);
process.exit(0);
