import LazyScratchBlocks from '../../lib/tw-lazy-scratch-blocks';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import React, {useState, useMemo, useCallback, useEffect} from 'react';
import bindAll from 'lodash.bindall';
import {connect} from 'react-redux';
import VM from 'scratch-vm';
import {
    apiTypes,
    projectTypes,
    viewOf,
    codeOf,
    openBlockspace,
    confirmSetComplex,
    closeBlockspace,
    setOpenBlockspaceParams,
    EXAMPLES,
    GROUPS,
    CATALOG,
    WORLD_ONCE_EXTRA,
    insertTextFor,
    documentationFor,
    subscribeCollab,
    sendCollab,
    setEditorModels,
    isApplyingRemote,
    sendViewEdit,
    subscribeConsole,
    markSeen,
    unseenErrors,
    errorSpots,
    logFor,
    clearLog,
    libraryApi,
    findImports,
    insertImport,
    updateImport,
    explainError
} from '../../lib/block-space/editor';
import {
    findBlockspaces,
    lint,
    chainAt,
    liveValue,
    describe,
    WORLD_BUILT_IN_NAMES,
    TARGET_BUILT_IN_NAMES,
    collectHints,
    findSites,
    KEY_NAMES,
    NAME_WIDGETS,
    objectAt,
    defaultFor,
    literalFor,
    parseColor,
    colorTexts,
    findColors,
    stepOf,
    formatNumber,
    findEditorCalls,
    EASING_NAMES
} from '../../lib/block-space/runtime';
import {setBlockspaceFocus} from '../../reducers/blockspace';
import {CODE_THEMES, isDarkTheme, askConfirm, loadMonaco, monaco, monacoReady, monacoThemeName} from '../../lib/dimod-ui';
import {colorForUserId, contrastTextColor} from '../../lib/dimod-collab';
import LibraryComponent from '../library/library.jsx';
import LibraryUpload from '../library/library-upload.jsx';
import {codeBrowser} from '../../lib/dimod-assets';
import {getDimodToken} from '../../lib/dimod-project';
import codeCard from './library-code-card.svg';
import styles from './library-modal.css';
import styles$1 from './examples-modal.css';
import styles$2 from './icon.css';
import {
    FullscreenIcon,
    onFullscreenChange,
    exitFullscreen,
    isFullscreen,
    panelOf,
    toggleFullscreen
} from '../dimod-fullscreen/dimod-fullscreen.jsx';
import warning from '../../addons/addons/debugger/icons/warning.svg';
import error from '../../addons/addons/debugger/icons/error.svg';
import terminal from '../../addons/addons/debugger/icons/debug.svg';
import performance from '../../addons/addons/debugger/icons/performance.svg';
import trash from '../../addons/addons/debugger/icons/delete.svg';
import threads from '../../addons/addons/debugger/icons/threads.svg';
import turbo from '../turbo-mode/icon--turbo.svg';
import success from '../../lib/assets/icon--success.svg';
import back from '../../lib/assets/icon--back.svg';
import variables from '../gui/icon--variables.svg';
import extension from '../../addons/settings/icons/extension.svg';
import stackBlock from '../custom-procedures/icon--stack-block.svg';
import eyeShow from '../sprite-info/icon--show.svg';
import eyeHide from '../sprite-info/icon--hide.svg';
import reload from '../crash-message/reload.svg';
import save from '../tw-fonts-modal/export.svg';
import add from '../../addons/addons/multi-tab-code/add.svg';
import close from '../../addons/settings/icons/clear.svg';
import undo from '../../addons/settings/icons/undo.svg';
import search from '../action-menu/icon--search.svg';
import examples from './icon--examples.svg';
import docs from './icon--docs.svg';
import more from './icon--more.svg';
import play from './icon--play.svg';
import blocksIcon from './icon--blocks.svg';
import Variable from 'scratch-vm/src/engine/variable';
import {animationsOf} from '../../lib/dimod-animation/runtime';
import styles$3 from './block-space-panel.css';
const MAX_WIDTH = 440;
const MAX_HEIGHT = 320;
const PADDING = 10;
const SCALE = 0.55;
const GAP = 6;
class BlockPreview {
    constructor ({vm, getTargetId, media, className}) {
        this.vm = vm;
        this.getTargetId = getTargetId;
        this.media = media;
        this.className = className;
        this.node = null;
        this.workspace = null;
    }
    xmlFor (id) {
        const runtime = this.vm.runtime;
        const host = runtime.dimodBlockspace;
        const target = runtime.getTargetById(this.getTargetId());
        const entry = host && target && host.spaces.entry(target.sprite, id);
        if (!entry) return null;
        const container = target.blocks;
        const scripts = entry.topIds
            .filter(topId => container._blocks[topId])
            .map(topId => container.blockToXML(topId, {}))
            .join('');
        const stage = runtime.getTargetForStage();
        const variables = [
            ...(stage && stage !== target ? Object.values(stage.variables).map(v => v.toXML(false)) : []),
            ...Object.values(target.variables).map(v => v.toXML(!target.isStage))
        ].join('');
        return {
            xml: `<xml xmlns="http://www.w3.org/1999/xhtml"><variables>${variables}</variables>${scripts}</xml>`,
            empty: !scripts
        };
    }
    show (id, anchor) {
        this.hide();
        if (!LazyScratchBlocks.isLoaded()) return;
        let found;
        try { found = this.xmlFor(id); } catch (e) { return; }
        if (!found || found.empty) return;
        const node = document.createElement('div');
        node.className = this.className;
        node.style.width = `${MAX_WIDTH}px`;
        node.style.height = `${MAX_HEIGHT}px`;
        document.body.appendChild(node);
        this.node = node;
        const ScratchBlocks = LazyScratchBlocks.get();
        const main = ScratchBlocks.mainWorkspace;
        let size;
        try {
            const workspace = ScratchBlocks.inject(node, {
                readOnly: true,
                media: this.media,
                scrollbars: false,
                sounds: false,
                trashcan: false,
                comments: false,
                zoom: {controls: false, wheel: false, startScale: SCALE}
            });
            this.workspace = workspace;
            ScratchBlocks.Xml.clearWorkspaceAndLoadFromXml(ScratchBlocks.Xml.textToDom(found.xml), workspace);
            const box = workspace.getBlocksBoundingBox();
            size = {
                width: Math.min(MAX_WIDTH, Math.ceil((box.width * SCALE) + (2 * PADDING))),
                height: Math.min(MAX_HEIGHT, Math.ceil((box.height * SCALE) + (2 * PADDING)))
            };
            node.style.width = `${size.width}px`;
            node.style.height = `${size.height}px`;
            ScratchBlocks.svgResize(workspace);
            workspace.translate((-box.x * SCALE) + PADDING, (-box.y * SCALE) + PADDING);
        } catch (e) { this.hide(); return; } finally { ScratchBlocks.mainWorkspace = main; }
        const rect = anchor.getBoundingClientRect();
        const below = rect.bottom + GAP + size.height <= window.innerHeight;
        node.style.top = `${below ? rect.bottom + GAP : Math.max(GAP, rect.top - GAP - size.height)}px`;
        node.style.left = `${Math.max(GAP, Math.min(rect.left, window.innerWidth - size.width - GAP))}px`;
    }
    hide () {
        if (this.workspace) {
            try { this.workspace.dispose(); } catch (e) {
            }
            this.workspace = null;
        }
        if (this.node) this.node.remove();
        this.node = null;
    }
}
const INFO_REFRESH_MS = 500;
const PREVIEW_DELAY_MS = 350;
class InlineBlockspaceButtons {
    constructor (editor, {info, onOpen, preview, className, runningClassName}) {
        this.editor = editor;
        this.info = info;
        this.onOpen = onOpen;
        this.preview = preview;
        this.className = className;
        this.runningClassName = runningClassName;
        this.widgets = [];
        this.timer = null;
        this.hoverTimer = null;
        this.ticker = setInterval(() => this.updateAll(), INFO_REFRESH_MS);
    }
    refreshSoon () { clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh(), 150); }
    refresh () {
        clearTimeout(this.timer);
        this.clear();
        const model = this.editor.getModel();
        if (!model) return;
        const usedLines = new Set();
        findBlockspaces(model.getValue()).forEach((call, i) => {
            if (!call.id || call.end < 0) return;
            const lineNumber = model.getPositionAt(call.end).lineNumber;
            if (usedLines.has(lineNumber)) return;
            usedLines.add(lineNumber);
            this.add(call.id, lineNumber, i);
        });
    }
    update (item) {
        const info = this.info(item.id);
        let text = 'open blocks';
        if (info) {
            text += ` · ${info.blocks}`;
            if (info.params.length) text += ` · (${info.params.join(', ')})`;
        }
        const running = Boolean(info && info.running);
        const className = running ? `${this.className} ${this.runningClassName}` : this.className;
        if (item.node.textContent !== text) item.node.textContent = text;
        if (item.node.className !== className) item.node.className = className;
        item.node.title = running ?
            `Open blockspace "${item.id}" as blocks (${info.running} running)` :
            `Open blockspace "${item.id}" as blocks`;
    }
    updateAll () { this.widgets.forEach(item => this.update(item)); }
    add (id, lineNumber, index) {
        const model = this.editor.getModel();
        const node = document.createElement('span');
        const item = {id, node, widget: null};
        this.update(item);
        node.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
        node.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            this.hidePreview();
            this.onOpen(id);
        });
        if (this.preview) {
            node.addEventListener('mouseenter', () => {
                clearTimeout(this.hoverTimer);
                this.hoverTimer = setTimeout(() => this.preview.show(id, node), PREVIEW_DELAY_MS);
            });
            node.addEventListener('mouseleave', () => this.hidePreview());
        }
        item.widget = {
            getId: () => `dimod.blockspace.${index}.${id}`,
            getDomNode: () => node,
            getPosition: () => ({
                position: {lineNumber, column: model.getLineMaxColumn(lineNumber)},
                preference: [monaco.editor.ContentWidgetPositionPreference.EXACT]
            })
        };
        this.editor.addContentWidget(item.widget);
        this.widgets.push(item);
    }
    hidePreview () {
        clearTimeout(this.hoverTimer);
        if (this.preview) this.preview.hide();
    }
    clear () {
        this.hidePreview();
        this.widgets.forEach(item => this.editor.removeContentWidget(item.widget));
        this.widgets = [];
    }
    dispose () { clearTimeout(this.timer); clearInterval(this.ticker); this.clear(); }
}
const installClipboard = (editor, node, {toFullText, remember, enabled}) => {
    const selectionRange = () => {
        const model = editor.getModel();
        const selection = editor.getSelection();
        if (!model || !selection) return null;
        if (!selection.isEmpty()) return selection;
        const line = selection.startLineNumber;
        return line < model.getLineCount() ?
            new monaco.Range(line, 1, line + 1, 1) :
            new monaco.Range(line, 1, line, model.getLineMaxColumn(line));
    };
    const onCopy = e => {
        if (!enabled()) return;
        const range = selectionRange();
        if (!range || !e.clipboardData) return;
        const text = editor.getModel().getValueInRange(range);
        const full = toFullText(text);
        if (full === text) return;
        e.clipboardData.setData('text/plain', full);
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'cut') editor.executeEdits('dimod-cut', [{range, text: ''}]);
    };
    node.addEventListener('copy', onCopy, true);
    node.addEventListener('cut', onCopy, true);
    const convert = (start, end) => {
        const model = editor.getModel();
        const pasted = model.getValue().slice(start, end);
        const calls = findBlockspaces(pasted).filter(call => call.id && call.payloadStart >= 0);
        if (!calls.length) return;
        const all = model.getValue();
        const taken = new Set(findBlockspaces(all.slice(0, start) + all.slice(end)).map(call => call.id));
        const edits = [];
        for (const call of calls) {
            let id = call.id;
            if (taken.has(id)) {
                const base = id.replace(/\d+$/, '');
                let n = 2;
                while (taken.has(`${base}${n}`)) n++;
                id = `${base}${n}`;
            }
            taken.add(id);
            remember(id, pasted.slice(call.payloadStart, call.payloadEnd));
            edits.push({
                range: monaco.Range.fromPositions(
                    model.getPositionAt(start + call.idStart),
                    model.getPositionAt(start + call.payloadEnd)
                ),
                text: JSON.stringify(id)
            });
        }
        editor.executeEdits('dimod-paste', edits);
    };
    const pasteListener = editor.onDidPaste(({range}) => {
        if (!enabled()) return;
        const model = editor.getModel();
        convert(model.getOffsetAt(range.getStartPosition()), model.getOffsetAt(range.getEndPosition()));
    });
    return {
        convert: (start, end) => {
            if (enabled()) convert(start, end);
        },
        dispose: () => {
            node.removeEventListener('copy', onCopy, true);
            node.removeEventListener('cut', onCopy, true);
            pasteListener.dispose();
        }
    };
};
const SNIPPETS = [
    ['flag', 'when the green flag is clicked', 'world.on("flag", async () => {\n\t$0\n});'],
    ['key', 'when a key is pressed', 'world.on("key", "${1:space}", () => {\n\t$0\n});'],
    ['broadcast', 'when I receive a broadcast', 'world.on("broadcast", "${1:message1}", data => {\n\t$0\n});'],
    ['click', 'when this sprite is clicked', 'me.on("click", () => {\n\t$0\n});'],
    ['touch', 'when this sprite starts touching something', 'me.on("touch", "${1:edge}", () => {\n\t$0\n});'],
    ['forever', 'forever loop, once per frame', 'for await (const dt of frames()) {\n\t$0\n}'],
    ['repeat', 'repeat, once per frame', 'await repeat(${1:10}, i => {\n\t$0\n});'],
    ['clone', 'code only clones run', 'if (me.isClone) {\n\t$0\n}'],
    ['hold', 'values that survive code edits', 'const ${1:state} = me.hold({${2:score}: ${3:0}});'],
    ['blockspace', 'a new blockspace', 'const ${1:name} = new Blockspace("${1:name}");'],
    ['run', 'run a blockspace and wait for its result', 'const ${1:result} = await fromCast(me.run(${2:blockspace}$0));'],
    ['stop', 'when the stop sign is clicked', 'world.on("stop", () => {\n\t$0\n});'],
    ['tween', 'tween properties along an easing', 'await me.tween({${1:x}: ${2:100}}, ${3:1}, "${4:easeOutQuad}");'],
    ['tweennothing', 'tween nothing, a value per frame', 'await tween(${1:1}, {from: ${2:0}, to: ${3:1}, easing: "${4:easeInOutSine}", onStep: value => {\n\t$0\n}});'],
    ['expose', 'a function the "call JS" blocks can call', 'me.expose("${1:name}", ${2:arg} => {\n\t$0\n});'],
    ['preflag', 'setup, before any green flag code runs', 'world.on("preflag", () => {\n\t$0\n});'],
    ['startasclone', 'when I start as a clone', 'me.on("clone", () => {\n\t$0\n});'],
    ['watch', 'when something becomes true', 'world.watch(() => ${1:world.score >= 10}, () => {\n\t$0\n});'],
    ['server', 'when the game server sends data', 'world.server.on("data", data => {\n\t$0\n});'],
    ['cloud', 'when someone else changes a cloud variable', 'world.cloud.on("${1:name}", (value, name) => {\n\t$0\n});'],
    ['once', 'wait for the next time something happens', 'const ${1:key} = await world.once("key", "${2:space}");'],
    ['input', 'named actions for keys, mouse and gamepad', 'world.input.actions({\n\t${1:jump}: ["${2:space}", "pad:a"],\n\t$0\n});'],
    ['test', 'a test, run by Run tests', 'test("${1:does something}", async () => {\n\texpect(${2:me.x}).toBe(${3:0});$0\n});'],
    ['sync', 'keep this sprite the same for every player', 'me.sync(["x", "y", "direction"], {ghost: {label: true}});'],
    ['relay', 'send data straight to the other players', 'world.server.relay("${1:channel}", ${2:data});'],
    ['hot', 'skip set-up when the code is hot reloaded', 'if (!reloaded) {\n\t$0\n}'],
    ['move', 'move with the input actions, once per frame', 'for await (const dt of frames()) {\n\tme.x += world.input.axis("${1:left}", "${2:right}") * ${3:200} * dt;\n\t$0\n}'],
    ['glide', 'glide to a place and wait', 'await me.glide(${1:1}, ${2:0}, ${3:0}, "${4:easeInOutSine}");'],
    ['say', 'say something for a while', 'await me.say("${1:Hello!}", ${2:2});'],
    ['touching', 'react while touching something', 'for await (const dt of frames()) {\n\tif (me.touching("${1:edge}")) {\n\t\t$0\n\t}\n}'],
    ['spawn', 'make a clone that runs its own code', 'const ${1:clone} = me.clone();\n${1:clone}.x = ${2:0};\n${1:clone}.y = ${3:0};'],
    ['every', 'do something every so often', 'const ${1:timer} = world.every(${2:1}, () => {\n\t$0\n});'],
    ['after', 'do something once, later', 'world.after(${1:1}, () => {\n\t$0\n});'],
    ['try', 'catch a stop or an error in an async task', 'try {\n\t$0\n} catch (e) {\n\tif (!(e instanceof Stopped)) throw e;\n}'],
    ['ask', 'ask the server something', 'const ${1:answer} = await world.server.ask(${2:{type: "hello"}});'],
    ['roster', 'everyone else in the room', 'for (const ${1:player} of world.server.roster) {\n\t$0\n}'],
    ['syncevents', 'when other players\' copies of a sprite appear or leave', 'const ${1:handle} = me.sync(["x", "y"]);\n${1:handle}.on("spawn", (ghost, player) => {\n\t$0\n});\n${1:handle}.on("remove", (ghost, player) => {});'],
    ['cloudset', 'set a cloud variable for the whole room', 'world.cloud.set("${1:name}", ${2:value});'],
    ['join', 'move to another room', 'world.server.join("${1:lobby}");'],
    ['import', 'use what another sprite exports', 'import {${1:name}} from "${2:Sprite}";'],
    ['importall', 'use everything another sprite exports, kept up to date', 'import * as ${1:Player} from "${2:Player}";'],
    ['importasset', 'read an asset (JSON is parsed, text is a string)', 'import ${1:data} from "asset:${2:levels.json}";'],
    ['export', 'share a function with other sprites', 'export function ${1:name}(${2}) {\n\t$0\n}'],
    ['exportconst', 'share a value with other sprites', 'export const ${1:name} = ${2:0};'],
    ['require', 'CommonJS: use what another sprite exports', 'const ${1:Player} = require("${2:Player}");'],
    ['moduleexports', 'CommonJS: share things with other sprites', 'module.exports = {\n\t$0\n};']
];
const expansion = text => text.replace(/\$\{\d+:([^}]*)\}|\$\{?\d+\}?/g, (m, d) => d || '');
let snippetsRegistered = false;
const registerSnippets = isOurModel => {
    if (snippetsRegistered) return;
    snippetsRegistered = true;
    monaco.languages.registerCompletionItemProvider('javascript', {
        provideCompletionItems: (model, position) => {
            if (!isOurModel(model)) return {suggestions: []};
            const word = model.getWordUntilPosition(position);
            const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
            if (/\.\s*$/.test(before)) return {suggestions: []};
            const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
            const examples = /^ex/i.test(word.word) ? EXAMPLES.map(({group, label, code}) => ({
                label: `example: ${label.toLowerCase()}`,
                detail: group,
                documentation: {value: `\`\`\`js\n${code}\n\`\`\``},
                kind: monaco.languages.CompletionItemKind.File,
                insertText: code,
                sortText: `~~${label}`,
                range
            })) : [];
            return {
                suggestions: examples.concat(SNIPPETS.map(([label, detail, insertText]) => ({
                    label,
                    detail,
                    documentation: {value: `\`\`\`js\n${expansion(insertText)}\n\`\`\``},
                    sortText: `~${label}`,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    insertText,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range
                })))
            };
        }
    });
};
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s*)(["'])([^"']*)$/;
let moduleVM = null;
let moduleCompletions = false;
const registerModuleCompletions = (isOurModel, vm) => {
    moduleVM = vm;
    if (moduleCompletions) return;
    moduleCompletions = true;
    monaco.languages.registerCompletionItemProvider('javascript', {
        triggerCharacters: ['"', '\'', ':'],
        provideCompletionItems: (model, position) => {
            if (!isOurModel(model) || !moduleVM) return {suggestions: []};
            const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
            const match = SPECIFIER.exec(before);
            if (!match) return {suggestions: []};
            const typed = match[2];
            const range = new monaco.Range(position.lineNumber, position.column - typed.length,
                position.lineNumber, position.column);
            const assets = moduleVM.dimodAssets ? moduleVM.dimodAssets.list : [];
            const suggestions = assets.map(a => ({
                label: `asset:${a.name}.${a.ext}`,
                kind: monaco.languages.CompletionItemKind.File,
                detail: a.ext === 'json' ? 'asset, gives the parsed JSON' : (a.kind === 'text' ? 'asset, gives its text' :
                    `${a.kind} asset`),
                insertText: `asset:${a.name}.${a.ext}`,
                sortText: `b${a.name}`,
                range
            }));
            if (/require/.test(before)) {
                for (const target of moduleVM.runtime.targets) {
                    const dimod = target.isOriginal && target.sprite.dimod;
                    if (!dimod || !dimod.complex) continue;
                    const name = target.isStage ? 'Stage' : target.getName();
                    suggestions.push({label: name, kind: monaco.languages.CompletionItemKind.Module,
                        detail: 'complex sprite', insertText: name, sortText: `a${name}`, range});
                }
            }
            return {suggestions};
        }
    });
};
const DOCS_URL = '/docs/blockspace';
const openDocs = (anchor = '') => window.open(`${DOCS_URL}${anchor}`, '_blank', 'noopener');
const CALL = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*|\))\s*\.\s*(on|once)\s*\(\s*(["'`])([^"'`]*)$/;
const TYPE_KINDS = [
    [/\bWorldApi\b/, 'world'],
    [/\bServerApi\b/, 'server'],
    [/\bSyncHandle\b/, 'sync'],
    [/\b(?:MeApi|TargetApi)\b/, 'target']
];
const kindByName = receiver => {
    const text = receiver.replace(/\s+/g, '');
    if (text === 'world') return 'world';
    if (text === 'me') return 'target';
    if (/(?:^|\.)server$/.test(text)) return 'server';
    if (/(?:^|\.)(?:input|cloud)$/.test(text)) return 'none';
    if (text === ')') return 'target';
    return null;
};
const kindByType = async (model, position, receiver) => {
    try {
        const getWorker = await monaco.languages.typescript.getJavaScriptWorker();
        const worker = await getWorker(model.uri);
        const name = receiver.trim();
        const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const start = before.lastIndexOf(name);
        const offset = model.getOffsetAt({lineNumber: position.lineNumber, column: start + name.length});
        const info = await worker.getQuickInfoAtPosition(model.uri.toString(), offset);
        const shown = info && info.displayParts ? info.displayParts.map(part => part.text).join('') : '';
        if (!shown) return null;
        for (const [pattern, kind] of TYPE_KINDS) if (pattern.test(shown)) return kind;
        return 'none';
    } catch (e) { return null; }
};
const suggestionsAt = async (model, position) => {
    const line = model.getLineContent(position.lineNumber);
    const before = line.slice(0, position.column - 1);
    const match = CALL.exec(before);
    if (!match) return [];
    const [, receiver, method, quote, typed] = match;
    let kind = kindByName(receiver);
    if (kind === null) kind = (await kindByType(model, position, receiver)) || 'target';
    if (kind === 'none') return [];
    const once = method === 'once';
    let events = CATALOG[kind] || [];
    if (once && kind === 'world') events = events.concat(WORLD_ONCE_EXTRA);
    if (once && (kind === 'server' || kind === 'sync')) return [];
    const after = line.slice(position.column - 1);
    const closing = after.indexOf(quote);
    const restIsWord = closing >= 0 && /^[\w:.-]*$/.test(after.slice(0, closing));
    const range = new monaco.Range(position.lineNumber, position.column - typed.length,
        position.lineNumber, position.column + (restIsWord ? closing + 1 : 0));
    return events.map((ev, i) => ({
        label: ev.name,
        kind: monaco.languages.CompletionItemKind.Event,
        detail: ev.summary,
        documentation: {value: documentationFor(ev)},
        insertText: insertTextFor(ev, {once}),
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: String(i).padStart(3, '0'),
        range
    }));
};
let registered$3 = false;
const registerEventCompletions = isOurModel => {
    if (registered$3) return;
    registered$3 = true;
    monaco.languages.registerCompletionItemProvider('javascript', {
        triggerCharacters: ['"', '\'', '`'],
        provideCompletionItems: async (model, position) => (
            isOurModel(model) ? {suggestions: await suggestionsAt(model, position)} : {suggestions: []}
        )
    });
};
const THROTTLE_MS = 80;
const TICK_MS = 500;
const TYPING_MS = 1500;
const ACTIVE_MS = 2500;
const selectionClasses = new Map();
const selectionClassFor = color => {
    if (selectionClasses.has(color)) return selectionClasses.get(color);
    const className = `dimod-bs-selection-${selectionClasses.size}`;
    const style = document.createElement('style');
    style.textContent = `.${className} { background-color: ${color}; opacity: 0.3; }`;
    document.head.appendChild(style);
    selectionClasses.set(color, className);
    return className;
};
class RemoteCarets {
    constructor (editor, {getTargetId, styles}) {
        this.editor = editor;
        this.getTargetId = getTargetId;
        this.styles = styles;
        this.session = Math.random().toString(36)
            .slice(2);
        this.carets = new Map();
        this.lastTypedAt = 0;
        this.lastSentAt = 0;
        this.sendTimer = null;
        this.shared = false;
        this.disposables = [
            editor.onDidChangeCursorSelection(() => this.sendSoon()),
            editor.onDidFocusEditorText(() => this.sendSoon()),
            editor.onDidBlurEditorText(() => this.sendSoon()),
            editor.onDidChangeModelContent(() => { this.lastTypedAt = Date.now(); this.layout(); }),
            editor.onDidScrollChange(() => this.layout()),
            editor.onDidChangeModel(() => this.targetChanged())
        ];
        this.off = subscribeCollab(msg => this.onMessage(msg));
        this.ticker = setInterval(() => this.tick(), TICK_MS);
    }
    sendSoon () {
        if (this.sendTimer) return;
        const wait = Math.max(0, THROTTLE_MS - (Date.now() - this.lastSentAt));
        this.sendTimer = setTimeout(() => { this.sendTimer = null; this.send(); }, wait);
    }
    send () {
        this.lastSentAt = Date.now();
        const model = this.editor.getModel();
        const selection = this.editor.getSelection();
        const targetId = this.getTargetId();
        if (!model || !selection || !targetId) { this.hide(); return; }
        sendCollab('blockspace-caret', {
            session: this.session,
            targetId,
            offset: model.getOffsetAt(selection.getPosition()),
            anchor: model.getOffsetAt({lineNumber: selection.selectionStartLineNumber, column: selection.selectionStartColumn}),
            focused: this.editor.hasTextFocus(),
            typing: Date.now() - this.lastTypedAt < TYPING_MS
        });
        this.shared = true;
    }
    hide () {
        if (this.shared) sendCollab('blockspace-caret', {session: this.session, hidden: true});
        this.shared = false;
    }
    onMessage (msg) {
        switch (msg.type) {
        case 'blockspace-caret':
            this.onCaret(msg);
            break;
        case 'presence': {
            if (!Array.isArray(msg.users)) break;
            const here = new Set(msg.users.map(user => user && user.userId));
            for (const [key, caret] of this.carets) if (!here.has(caret.userId)) this.remove(key);
            break;
        }
        case 'joined':
        case 'blockspace-state-request':
            this.shared = false;
            this.sendSoon();
            break;
        default:
        }
    }
    onCaret (msg) {
        if (!msg.from) return;
        const key = `${msg.from}:${typeof msg.session === 'string' ? msg.session : ''}`;
        if (msg.hidden) { this.remove(key); return; }
        const offset = Number(msg.offset);
        const anchor = Number(msg.anchor);
        if (!Number.isFinite(offset) || !Number.isFinite(anchor)) return;
        let caret = this.carets.get(key);
        if (!caret) {
            const color = colorForUserId(msg.from);
            caret = {
                key,
                userId: msg.from,
                username: typeof msg.fromUsername === 'string' ? msg.fromUsername : 'someone',
                color,
                decorations: [],
                model: null,
                widget: null,
                node: null,
                flag: null
            };
            this.carets.set(key, caret);
        }
        const now = Date.now();
        caret.targetId = msg.targetId;
        caret.offset = offset;
        caret.anchor = anchor;
        caret.focused = msg.focused !== false;
        caret.activeAt = now;
        if (msg.typing) caret.typingAt = now;
        this.place(caret);
    }
    place (caret) {
        const model = this.editor.getModel();
        const shown = model && caret.targetId === this.getTargetId();
        if (!shown) { this.undraw(caret); return; }
        const length = model.getValueLength();
        const lead = model.getPositionAt(Math.min(caret.offset, length));
        const anchor = model.getPositionAt(Math.min(caret.anchor, length));
        const decorations = [{
            range: monaco.Range.fromPositions(lead, lead),
            options: {stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges}
        }];
        if (!lead.equals(anchor)) {
            decorations.push({
                range: monaco.Range.fromPositions(lead, anchor),
                options: {className: selectionClassFor(caret.color)}
            });
        }
        this.clearDecorations(caret);
        caret.decorations = model.deltaDecorations([], decorations);
        caret.model = model;
        if (!caret.widget) this.draw(caret);
        this.editor.layoutContentWidget(caret.widget);
        this.tick();
    }
    draw (caret) {
        const {styles} = this;
        const node = document.createElement('div');
        node.className = styles.remoteCaret;
        node.style.setProperty('--caret-color', caret.color);
        node.style.setProperty('--caret-text-color', contrastTextColor(caret.color));
        node.style.height = `${this.editor.getOption(monaco.editor.EditorOption.lineHeight)}px`;
        const flag = document.createElement('div');
        flag.className = styles.caretFlag;
        const name = document.createElement('span');
        name.textContent = caret.username;
        const dots = document.createElement('span');
        dots.className = styles.typingDots;
        dots.innerHTML = '<span></span><span></span><span></span>';
        flag.append(name, dots);
        node.appendChild(flag);
        caret.node = node;
        caret.flag = flag;
        caret.widget = {
            getId: () => `dimod.caret.${caret.key}`,
            getDomNode: () => node,
            getPosition: () => {
                const model = this.editor.getModel();
                const range = model && caret.decorations.length ? model.getDecorationRange(caret.decorations[0]) : null;
                return range ? {
                    position: range.getStartPosition(),
                    preference: [monaco.editor.ContentWidgetPositionPreference.EXACT]
                } : null;
            }
        };
        this.editor.addContentWidget(caret.widget);
    }
    clearDecorations (caret) {
        if (caret.model && !caret.model.isDisposed()) caret.model.deltaDecorations(caret.decorations, []);
        caret.decorations = [];
        caret.model = null;
    }
    undraw (caret) {
        if (caret.widget) this.editor.removeContentWidget(caret.widget);
        caret.widget = null;
        this.clearDecorations(caret);
    }
    remove (key) {
        const caret = this.carets.get(key);
        if (!caret) return;
        this.undraw(caret);
        this.carets.delete(key);
    }
    layout () {
        for (const caret of this.carets.values()) {
            if (caret.widget) this.editor.layoutContentWidget(caret.widget);
        }
    }
    tick () {
        const now = Date.now();
        const {styles} = this;
        const ranges = this.editor.getVisibleRanges();
        const firstLine = ranges.length ? ranges[0].startLineNumber : 1;
        for (const caret of this.carets.values()) {
            if (!caret.node) continue;
            const typing = now - (caret.typingAt || 0) < TYPING_MS;
            const active = now - caret.activeAt < ACTIVE_MS;
            caret.node.className = [
                styles.remoteCaret,
                typing ? styles.remoteCaretTyping : '',
                active ? styles.remoteCaretActive : '',
                caret.focused ? '' : styles.remoteCaretIdle
            ].join(' ');
            const position = caret.widget && caret.widget.getPosition();
            const top = position && position.position.lineNumber <= firstLine;
            caret.flag.className = `${styles.caretFlag} ${top ? styles.caretFlagBelow : ''}`;
        }
    }
    targetChanged () {
        for (const caret of this.carets.values()) this.place(caret);
        this.sendSoon();
    }
    dispose () {
        clearTimeout(this.sendTimer);
        clearInterval(this.ticker);
        this.hide();
        this.off();
        this.disposables.forEach(d => d.dispose());
        for (const key of [...this.carets.keys()]) this.remove(key);
    }
}
let source$2 = null;
const setLiveValueSource = value => { source$2 = value; };
let registered$2 = false;
const registerLiveValues = isOurModel => {
    if (registered$2) return;
    registered$2 = true;
    monaco.languages.registerHoverProvider('javascript', {
        provideHover: (model, position) => {
            if (!isOurModel(model) || !source$2) return null;
            const chain = chainAt(model.getLineContent(position.lineNumber), model.getWordAtPosition(position));
            if (!chain) return null;
            const host = source$2.vm.runtime.dimodBlockspace;
            const target = source$2.vm.runtime.getTargetById(source$2.getTargetId());
            const value = liveValue(host, target, model.getValue(), chain.parts);
            if (!value) return null;
            return {
                range: new monaco.Range(position.lineNumber, chain.startColumn, position.lineNumber, chain.endColumn),
                contents: [{value: `**now** · \`${chain.parts.join('.')}\` = ${value}`}]
            };
        }
    });
};
const TAGS = ['math', 'tween', 'save', 'ui', 'physics', 'multiplayer', 'helpers']
    .map(tag => ({tag, intlLabel: tag[0].toUpperCase() + tag.slice(1)}));
const when = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(); };
const metaOf = entry => `v${entry.latest_version} · by ${entry.author} · ${entry.uses} use${entry.uses === 1 ? '' : 's'}`;
const toItem = entry => ({
    ...entry,
    _key: `code-${entry.id}`,
    featured: true,
    rawURL: codeCard,
    description: entry.description ? `${metaOf(entry)}. ${entry.description}` : metaOf(entry)
});
const Card = ({entry}) => (
    <div className={styles.card}>
        <span className={styles.cardTitle}>{entry.name}</span>
        <span className={styles.cardMeta}>
            {metaOf(entry)}
            {entry.visibility === 'public' ? '' : ` · ${entry.visibility}`}
        </span>
        {entry.description ? <span className={styles.cardText}>{entry.description}</span> : null}
        {entry.tags.length ? <span className={styles.cardTags}>{entry.tags.map(t => `#${t}`).join(' ')}</span> : null}
    </div>
);
Card.propTypes = {
    entry: PropTypes.shape({
        name: PropTypes.string,
        description: PropTypes.string,
        author: PropTypes.string,
        uses: PropTypes.number,
        latest_version: PropTypes.number,
        visibility: PropTypes.string,
        tags: PropTypes.arrayOf(PropTypes.string)
    }).isRequired
};
const LibraryModal = ({spriteName, getContext, onInsert, onUpdate, onClose}) => {
    const [tab, setTab] = useState('browser');
    const [mineList, setMineList] = useState({items: [], loading: false, error: null});
    const [selected, setSelected] = useState(null);
    const [note, setNote] = useState(null);
    const [statuses, setStatuses] = useState({});
    const [versionOf, setVersionOf] = useState('');
    const [busy, setBusy] = useState(false);
    const signedIn = Boolean(getDimodToken());
    const context = getContext();
    const browser = useMemo(() => ({...codeBrowser(toItem), label: 'Browse'}), []);
    const loadMine = useCallback(() => {
        if (!signedIn) return;
        setMineList(l => ({...l, loading: true, error: null}));
        libraryApi.list({mine: true}).then(
            data => setMineList({items: data.items, loading: false, error: null}),
            e => setMineList(l => ({...l, loading: false, error: e.message}))
        );
    }, [signedIn]);
    useEffect(() => {
        if (tab === 'mine') loadMine();
    }, [tab, loadMine]);
    useEffect(() => {
        if (tab !== 'imported') return;
        const ids = context.imports.map(imp => imp.id);
        if (!ids.length) return;
        libraryApi.latest(ids).then(data => setStatuses(data.latest || {}), () => setStatuses({}));
    }, [tab]);
    const changeTab = id => { setNote(null); setTab(id); };
    const open = useCallback(entry => {
        setNote(null);
        Promise.all([libraryApi.get(entry.id), libraryApi.versions(entry.id)]).then(
            ([full, found]) => setSelected({entry: full, code: full.code, version: full.version, versions: found.versions}),
            e => setNote(e.message)
        );
    }, []);
    const pickVersion = useCallback(version => {
        if (!selected) return;
        libraryApi.get(selected.entry.id, version).then(
            full => setSelected(s => ({...s, code: full.code, version: full.version})),
            e => setNote(e.message)
        );
    }, [selected]);
    const insert = () => {
        const {entry, code, version} = selected;
        const result = onInsert({id: entry.id, version, name: entry.name, author: entry.author}, code);
        libraryApi.used(entry.id);
        setNote(result && result.renamed && result.renamed.length ?
            `Inserted. ${result.renamed.map(([a, b]) => `"${a}" is "${b}" here`).join(', ')}, since ${
                result.renamed.length === 1 ? 'that id was' : 'those ids were'} already used.` :
            'Inserted into the code.');
    };
    const update = async imp => {
        setBusy(true);
        try {
            const latest = await libraryApi.get(imp.id);
            const result = onUpdate(imp, {
                id: imp.id,
                version: latest.version,
                name: latest.name,
                author: latest.author
            }, latest.code);
            setNote(`Updated ${latest.name} to v${latest.version}${result && result.renamed && result.renamed.length ?
                `, with ${result.renamed.map(([a, b]) => `"${a}" as "${b}"`).join(', ')}` : ''}.`);
            setStatuses(s => ({...s, [imp.id]: {version: latest.version, name: latest.name}}));
        } catch (e) { setNote(e.message); }
        setBusy(false);
    };
    const changeMine = async (entry, changes) => {
        try { await libraryApi.update(entry.id, changes); loadMine(); } catch (e) { setNote(e.message); }
    };
    const removeMine = async entry => {
        const agreed = await askConfirm('Code already inserted into a sprite keeps working.', {
            title: `Delete "${entry.name}" from the library?`, ok: 'Delete', danger: true
        });
        if (!agreed) return;
        try { await libraryApi.remove(entry.id); loadMine(); } catch (e) { setNote(e.message); }
    };
    const noteLine = note ? <div className={styles.note}>{note}</div> : null;
    const renderDetail = () => {
        if (!selected) return noteLine;
        const {entry, code, version, versions} = selected;
        return (
            <div className={styles.detail}>
                <div className={styles.row}>
                    <span className={styles.detailTitle}>{entry.name}</span>
                    <span className={styles.spacer} />
                    <button aria-label="Close" className={styles.button} onClick={() => setSelected(null)}>
                        {'×'}
                    </button>
                </div>
                {noteLine}
                <div className={styles.cardMeta}>
                    {`by ${entry.author} · updated ${when(entry.updated_at)}`}
                </div>
                {entry.description ? <div className={styles.cardText}>{entry.description}</div> : null}
                <div className={styles.row}>
                    <label>
                        {'Version '}
                        <select value={version} onChange={e => pickVersion(Number(e.target.value))}>
                            {versions.map(v => (
                                <option key={v.version} value={v.version}>
                                    {`v${v.version}${v.notes ? ` - ${v.notes}` : ''}`}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button className={styles.primary} onClick={insert}>
                        {`Insert into ${spriteName}`}
                    </button>
                </div>
                <div className={styles.warning}>
                    {'This is code from another person. Read it first: once you run it, it can do anything ' +
                        'your own code can.'}
                </div>
                <pre className={styles.code}>{code}</pre>
            </div>
        );
    };
    const renderImported = () => (
        <div className={styles.single}>
            {noteLine}
            {context.imports.length === 0 ? (
                <div className={styles.empty}>{`Nothing from the library in ${spriteName} yet`}</div>
            ) : context.imports.map(imp => {
                const latest = statuses[imp.id];
                const outdated = latest && latest.version > imp.version;
                return (
                    <div className={styles.importRow} key={`${imp.id}-${imp.start}`}>
                        <span className={styles.cardTitle}>{imp.label || imp.id}</span>
                        <span className={styles.cardMeta}>
                            {`v${imp.version}${latest ? (outdated ? ` → v${latest.version} is out` : ', up to date') :
                                ''}`}
                        </span>
                        {outdated ? (
                            <button className={styles.primary} disabled={busy} onClick={() => update(imp)}>
                                {`Update to v${latest.version}`}
                            </button>
                        ) : null}
                    </div>
                );
            })}
            {context.imports.length ? (
                <div className={styles.warning}>
                    {'Updating replaces everything between the entry\'s @library and @end library comments, ' +
                        'so changes you made there are lost.'}
                </div>
            ) : null}
        </div>
    );
    const renderMine = ({setTab: show}) => (
        <div className={styles.single}>
            {noteLine}
            {signedIn ? null : <div className={styles.empty}>{'Log in to publish and manage your own'}</div>}
            {mineList.error ? <div className={styles.error}>{mineList.error}</div> : null}
            {signedIn && !mineList.loading && mineList.items.length === 0 ?
                <div className={styles.empty}>{'You haven\'t published anything yet'}</div> : null}
            {mineList.items.map(entry => (
                <div className={styles.mineRow} key={entry.id}>
                    <Card entry={entry} />
                    <div className={styles.row}>
                        <select
                            value={entry.visibility}
                            title="Who can find it. Unlisted: anyone with the link. Private: only you."
                            onChange={e => changeMine(entry, {visibility: e.target.value})}
                        >
                            <option value="public">{'public'}</option>
                            <option value="unlisted">{'unlisted'}</option>
                            <option value="private">{'private'}</option>
                        </select>
                        <button className={styles.button} onClick={() => { setVersionOf(entry.id); show('upload'); }}>
                            {'New version…'}
                        </button>
                        <button className={styles.button} onClick={() => removeMine(entry)}>
                            {'Delete'}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
    const extraTabs = [
        {id: 'imported', label: 'In this sprite', render: renderImported},
        {id: 'mine', label: 'Mine', render: renderMine},
        {id: 'upload', label: 'Upload', render: ({setTab: show}) => (
            <LibraryUpload
                codeContext={context}
                initialTarget={versionOf}
                kind="code"
                suggestedTags={TAGS.map(t => t.tag)}
                onDone={() => { setVersionOf(''); show('browser'); }}
            />
        )}
    ];
    return (
        <LibraryComponent
            keepOpen
            browser={browser}
            extraTabs={extraTabs}
            header="Code"
            id="blockspaceLibrary"
            sidePanel={tab === 'browser' ? renderDetail() : null}
            tags={TAGS}
            title="Choose Code"
            onItemSelected={open}
            onRequestClose={onClose}
            onTabChange={changeTab}
        />
    );
};
LibraryModal.propTypes = {
    getContext: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired,
    onInsert: PropTypes.func.isRequired,
    onUpdate: PropTypes.func.isRequired,
    spriteName: PropTypes.string
};
LibraryModal.defaultProps = {spriteName: 'this sprite'};
const ExamplesModal = ({spriteName, onInsert, onClose}) => {
    const [picked, setPicked] = useState(EXAMPLES[0]);
    const [note, setNote] = useState('');
    const [colored, setColored] = useState('');
    const dark = isDarkTheme();
    const [themeName, setThemeName] = useState(monacoThemeName);
    useEffect(() => {
        const sync = () => setThemeName(monacoThemeName());
        window.addEventListener('dimod-editor-theme', sync);
        return () => window.removeEventListener('dimod-editor-theme', sync);
    }, []);
    const codeColors = useMemo(() => {
        const theme = CODE_THEMES.find(t => t.monaco === themeName);
        const [background, color] = theme ? theme.swatch.map(c => `#${c}`) :
            (themeName === 'vs' ? ['#fffffe', '#000000'] : ['#1e1e1e', '#d4d4d4']);
        const options = monacoReady() && monaco.editor.EditorOptions;
        return {
            background,
            color,
            fontFamily: options ? options.fontFamily.defaultValue : 'Consolas, "Courier New", monospace',
            fontSize: options ? `${options.fontSize.defaultValue}px` : '14px'
        };
    }, [themeName, colored]);
    useEffect(() => {
        const onKey = e => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    useEffect(() => {
        let stale = false;
        setColored('');
        loadMonaco().then(() => {
            if (stale) return;
            monaco.editor.setTheme(monacoThemeName());
            return monaco.editor.colorize(picked.code, 'javascript', {tabSize: 4}).then(html => {
                if (!stale) setColored(html);
            });
        }).catch(() => {});
        return () => { stale = true; };
    }, [picked, dark, themeName]);
    const groups = useMemo(() => GROUPS
        .map(name => ({name, items: EXAMPLES.filter(e => e.group === name)}))
        .filter(g => g.items.length), []);
    const insert = example => { onInsert(example.code); };
    const copy = () => {
        try { navigator.clipboard.writeText(picked.code).then(() => setNote('Copied'), () => setNote('')); } catch (e) { setNote(''); }
    };
    return (
        <div
            className={styles.backdrop}
            onMouseDown={e => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div aria-label="Examples" className={styles.modal} role="dialog">
                <div className={styles.header}>
                    <span className={styles.title}>{'Examples'}</span>
                    <span className={styles.spacer} />
                    <button aria-label="Close" className={styles.close} onClick={onClose}>
                        {'✕'}
                    </button>
                </div>
                <div className={styles.body}>
                    <div className={styles.split}>
                        <div className={styles.listSide}>
                            {groups.map(group => (
                                <React.Fragment key={group.name}>
                                    <div className={styles$1.group}>{group.name}</div>
                                    {group.items.map(example => (
                                        <button
                                            className={picked === example ? styles.cardActive : styles.card}
                                            key={example.label}
                                            onClick={() => { setPicked(example); setNote(''); }}
                                            onDoubleClick={() => insert(example)}
                                        >
                                            <span className={styles.cardTitle}>{example.label}</span>
                                        </button>
                                    ))}
                                </React.Fragment>
                            ))}
                        </div>
                        <div className={styles.detailSide}>
                            {picked ? (
                                <div className={styles.detail}>
                                    <div className={styles.detailTitle}>{picked.label}</div>
                                    {colored ? (
                                        <pre
                                            className={styles$1.code}
                                            dangerouslySetInnerHTML={{__html: colored}}
                                            style={codeColors}
                                        />
                                    ) : (
                                        <pre className={styles$1.code} style={codeColors}>
                                            {picked.code}
                                        </pre>
                                    )}
                                    <div className={styles.row}>
                                        <button className={styles.primary} onClick={() => insert(picked)}>
                                            {`Put in ${spriteName}`}
                                        </button>
                                        <button className={styles.button} onClick={copy}>
                                            {'Copy'}
                                        </button>
                                        <span className={styles$1.hint}>{note || 'Double-click one to put it in'}</span>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
ExamplesModal.propTypes = {onClose: PropTypes.func.isRequired, onInsert: PropTypes.func.isRequired, spriteName: PropTypes.string};
const Icon = ({src, tint, className}) => (tint ? (
    <span
        aria-hidden="true"
        className={classNames(styles$2.mask, className)}
        style={{WebkitMaskImage: `url(${src})`, maskImage: `url(${src})`}}
    />
) : (
    <img alt="" className={classNames(styles$2.image, className)} draggable={false} src={src} />
));
Icon.propTypes = {className: PropTypes.string, src: PropTypes.string.isRequired, tint: PropTypes.bool};
const icons = {
    add,
    back,
    blocks: blocksIcon,
    close,
    docs,
    more,
    play,
    error,
    examples,
    extension,
    eyeHide,
    eyeShow,
    performance,
    reload,
    save,
    search,
    stackBlock,
    success,
    terminal,
    threads,
    trash,
    turbo,
    undo,
    variables,
    warning
};
let source$1 = null;
const WORLD_BUILT_IN = new Set(WORLD_BUILT_IN_NAMES);
const TARGET_BUILT_IN = new Set(TARGET_BUILT_IN_NAMES);
const ASSIGN = '\\s*(?:\\*\\*|<<|>>>|>>|&&|\\|\\||\\?\\?|[-+*/%&|^])?=(?!=)';
const assignmentsIn = (model, owner, name) => {
    const text = model.getValue();
    const re = new RegExp(`\\b${owner}\\s*\\.\\s*${name}${ASSIGN}`, 'g');
    const ranges = [];
    for (let m = re.exec(text); m; m = re.exec(text)) {
        const start = text.indexOf(name, m.index + owner.length);
        ranges.push(monaco.Range.fromPositions(model.getPositionAt(start), model.getPositionAt(start + name.length)));
    }
    return ranges;
};
const patchOpener = editor => {
    const service = editor._codeEditorService;
    if (!service || service.__dimodPatched) return;
    service.__dimodPatched = true;
    const original = service.openCodeEditor.bind(service);
    service.openCodeEditor = (input, from, sideBySide) => {
        const current = from && from.getModel();
        const targetId = source$1 && input && input.resource ? source$1.targetIdOf(input.resource) : null;
        if (targetId && current && current.uri.toString() !== input.resource.toString()) {
            const s = input.options && input.options.selection;
            source$1.openSprite(targetId, s ? new monaco.Range(s.startLineNumber, s.startColumn,
                s.endLineNumber || s.startLineNumber, s.endColumn || s.startColumn) : null);
            return Promise.resolve(from);
        }
        return original(input, from, sideBySide);
    };
};
const setDefinitionSource = (value, editor) => {
    source$1 = value;
    if (editor) patchOpener(editor);
};
let registered$1 = false;
const registerDefinitions = isOurModel => {
    if (registered$1) return;
    registered$1 = true;
    monaco.languages.registerDefinitionProvider('javascript', {
        provideDefinition: (model, position) => {
            if (!isOurModel(model) || !source$1) return null;
            const chain = chainAt(model.getLineContent(position.lineNumber), model.getWordAtPosition(position));
            if (!chain || chain.parts.length !== 2) return null;
            const [owner, name] = chain.parts;
            const runtime = source$1.vm.runtime;
            const locations = [];
            const addFrom = (targetId, ownerName) => {
                const m = source$1.modelFor(targetId);
                if (!m) return;
                assignmentsIn(m, ownerName, name).forEach(range => locations.push({uri: m.uri, range}));
            };
            if (owner === 'world' && !WORLD_BUILT_IN.has(name)) {
                const current = source$1.getTargetId();
                const others = runtime.targets
                    .filter(t => t.isOriginal && t.id !== current && t.sprite.dimod && t.sprite.dimod.complex)
                    .map(t => t.id);
                [current, ...others].forEach(targetId => addFrom(targetId, 'world'));
            } else if (owner === 'me' && !TARGET_BUILT_IN.has(name)) { addFrom(source$1.getTargetId(), 'me'); } else { return null; }
            return locations.length ? locations : null;
        }
    });
};
let source = null;
const setPropertyEditorSource = value => { source = value; };
let hintsKey = null;
let hintsValue = null;
const currentHints = () => {
    const sources = source ? source.getSources() : [];
    const key = sources.join('\u0000');
    if (key !== hintsKey) { hintsKey = key; hintsValue = collectHints(sources); }
    return hintsValue;
};
const sitesIn = model => findSites(model.getValue(), currentHints());
const variablesOf = (target, type) => (target ? Object.values(target.variables) : [])
    .filter(v => v.type === type)
    .map(v => v.name);
const projectNames = type => {
    const runtime = source && source.runtime;
    const target = source && source.getTarget();
    if (type === 'key') return KEY_NAMES;
    if (type === 'easing') return EASING_NAMES;
    if (!runtime) return [];
    const stage = runtime.getTargetForStage();
    const own = target && !target.isStage ? target : null;
    const both = variableType => [...variablesOf(stage, variableType), ...variablesOf(own, variableType)];
    switch (type) {
    case 'sprite':
        return runtime.targets.filter(t => t.isOriginal && !t.isStage).map(t => t.getName());
    case 'costume':
        return target ? target.getCostumes().map(c => c.name) : [];
    case 'sound':
        return target ? target.getSounds().map(s => s.name) : [];
    case 'backdrop':
        return stage ? stage.getCostumes().map(c => c.name) : [];
    case 'broadcast':
        return variablesOf(stage, Variable.BROADCAST_MESSAGE_TYPE);
    case 'variable':
        return both(Variable.SCALAR_TYPE);
    case 'list':
        return both(Variable.LIST_TYPE);
    case 'animation':
        return own ? animationsOf(own.sprite).map(d => d.name) : [];
    default:
        return [];
    }
};
const optionsOf = spec => (spec.type === 'select' ? spec.options : projectNames(spec.type));
const isNumeric = spec => spec.type === 'number' || spec.type === 'slider' || spec.type === 'angle';
const hasList = spec => spec.type === 'select' || NAME_WIDGETS.includes(spec.type);
const rangeOf = (model, start, end) => monaco.Range.fromPositions(model.getPositionAt(start), model.getPositionAt(end));
const snippetText = text => String(text).replace(/[\\$}]/g, '\\$&');
const keySuggestions = (model, position, objects) => {
    const text = model.getValue();
    const object = objectAt(text, objects, model.getOffsetAt(position));
    if (!object) return [];
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    return Object.keys(object.fields)
        .filter(key => !object.keys.includes(key) || key === word.word)
        .map((key, i) => {
            const spec = object.fields[key];
            const start = defaultFor(spec, hasList(spec) ? optionsOf(spec) : []);
            const literal = start === null ? '{$1}' : `\${1:${snippetText(literalFor({}, start))}}`;
            const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
            return {
                label: key,
                kind: monaco.languages.CompletionItemKind.Property,
                detail: spec.label || spec.type,
                insertText: `${name}: ${literal}`,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                sortText: `!${String(i).padStart(3, '0')}`,
                range
            };
        });
};
const choiceSuggestions = (model, position, sites) => {
    const offset = model.getOffsetAt(position);
    const site = sites.find(s => s.valueType === 'string' && offset > s.start && offset < s.end && hasList(s.spec));
    if (!site) return [];
    const range = rangeOf(model, site.start + 1, site.end - 1);
    return optionsOf(site.spec).filter(option => typeof option === 'string')
        .map((option, i) => ({
            label: option,
            kind: monaco.languages.CompletionItemKind.EnumMember,
            detail: site.spec.label || site.spec.type,
            insertText: literalFor(site, option).slice(1, -1),
            filterText: option,
            sortText: `!${String(i).padStart(3, '0')}`,
            range
        }));
};
const snippetSuggestions = (model, position, snippets) => {
    const word = model.getWordUntilPosition(position);
    const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
    if (/\.\s*$/.test(before)) return [];
    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    return snippets.map(({prefix, body, description}) => ({
        label: prefix,
        detail: description || 'this project\'s snippet',
        documentation: {value: `\`\`\`js\n${body.replace(/\$\{\d+:([^}]*)\}|\$\{?\d+\}?/g, (m, d) => d || '')}\n\`\`\``},
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: body,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: `~${prefix}`,
        range
    }));
};
let registered = false;
const registerPropertyEditors = isOurModel => {
    if (registered) return;
    registered = true;
    monaco.languages.registerCompletionItemProvider('javascript', {
        triggerCharacters: ['"', '\'', '`'],
        provideCompletionItems: (model, position) => {
            if (!isOurModel(model) || !source) return {suggestions: []};
            const hints = currentHints();
            const {sites, objects} = sitesIn(model);
            const inside = choiceSuggestions(model, position, sites);
            if (inside.length) return {suggestions: inside};
            return {suggestions: [
                ...keySuggestions(model, position, objects),
                ...snippetSuggestions(model, position, hints.snippets)
            ]};
        }
    });
    monaco.languages.registerColorProvider('javascript', {
        provideDocumentColors: model => {
            if (!isOurModel(model)) return [];
            return findColors(model.getValue()).map(({start, end, color}) => ({
                range: rangeOf(model, start, end),
                color: {red: color.red, green: color.green, blue: color.blue, alpha: color.alpha}
            }));
        },
        provideColorPresentations: (model, info) => {
            const text = model.getValueInRange(info.range);
            const quote = /["'`]/.test(text[0]) ? text[0] : '"';
            const was = parseColor(text.slice(1, -1));
            const texts = colorTexts(info.color);
            const formats = ['hex', 'rgb', 'hsl'];
            if (was) formats.unshift(...formats.splice(formats.indexOf(was.format), 1));
            return formats.map(format => ({label: `${quote}${texts[format]}${quote}`}));
        }
    });
};
const CHIP = /(?:^|\s)dimod-prop-(\d+)(?:\s|$)/;
const SCRUB_START_PX = 3;
const SCRUB_PX_PER_STEP = 4;
const SLIDER_SCRUB_PX = 240;
const FILTER_FROM = 9;
class PropertyEditors {
    constructor (editor, node, styles) {
        this.editor = editor;
        this.node = node;
        this.styles = styles;
        this.sites = [];
        this.decorations = [];
        this.decoratedModel = null;
        this.version = -1;
        this.timer = null;
        this.active = null;
        this.popup = null;
        this.endScrub = null;
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onOutsideDown = this.onOutsideDown.bind(this);
        node.addEventListener('mousedown', this.onMouseDown, true);
        this.listeners = [
            editor.onDidChangeModel(() => this.closePopup()),
            editor.onKeyDown(e => {
                if (e.keyCode === monaco.KeyCode.Escape && this.popup) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.closePopup();
                }
            })
        ];
    }
    refreshSoon () { clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh(), 150); }
    chipClass (site) {
        const styles = this.styles;
        if (site.spec.type === 'toggle') return site.value ? styles.propToggleOn : styles.propToggleOff;
        if (site.spec.type === 'angle') return styles.propAngle;
        return isNumeric(site.spec) ? styles.propNumber : styles.propSelect;
    }
    refresh () {
        clearTimeout(this.timer);
        const model = this.editor.getModel();
        if (this.decoratedModel && this.decoratedModel !== model && !this.decoratedModel.isDisposed()) {
            this.decoratedModel.deltaDecorations(this.decorations, []);
            this.decorations = [];
        }
        this.decoratedModel = model;
        if (!model) return;
        this.sites = source ? sitesIn(model).sites : [];
        this.version = model.getVersionId();
        const decorations = [];
        this.sites.forEach((site, i) => {
            if (site.spec.type === 'color') return;
            decorations.push({
                range: rangeOf(model, site.start, site.end),
                options: {
                    beforeContentClassName: `${this.styles.propChip} ${this.chipClass(site)} dimod-prop-${i}`,
                    stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
                }
            });
        });
        this.decorations = model.deltaDecorations(this.decorations, decorations);
    }
    onMouseDown (e) {
        const className = e.target && typeof e.target.className === 'string' ? e.target.className : '';
        const match = CHIP.exec(className);
        if (!match || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const model = this.editor.getModel();
        if (!model || this.editor.getOption(monaco.editor.EditorOption.readOnly)) return;
        if (model.getVersionId() !== this.version) { this.refresh(); return; }
        const site = this.sites[Number(match[1])];
        if (!site) return;
        this.closePopup();
        this.active = {model, start: site.start, text: model.getValue().slice(site.start, site.end), site};
        if (site.spec.type === 'toggle') {
            this.write(String(!site.value));
            this.editor.pushUndoStop();
            this.active = null;
        } else if (isNumeric(site.spec)) { this.scrub(e); } else { this.openPopup(); }
    }
    write (text) {
        const active = this.active;
        if (!active || active.model.isDisposed() || this.editor.getModel() !== active.model) return false;
        if (text === active.text) return true;
        const range = rangeOf(active.model, active.start, active.start + active.text.length);
        if (active.model.getValueInRange(range) !== active.text) { this.closePopup(); this.active = null; return false; }
        this.editor.executeEdits('dimod-property', [{range, text}]);
        active.text = text;
        return true;
    }
    scrub (down) {
        const {site, text} = this.active;
        const spec = site.spec;
        const step = stepOf(spec, text);
        const bounded = isFinite(spec.min) && isFinite(spec.max);
        const perPixel = bounded && spec.type !== 'number' ?
            (spec.max - spec.min) / SLIDER_SCRUB_PX :
            step / SCRUB_PX_PER_STEP;
        let moved = false;
        this.editor.pushUndoStop();
        const move = e => {
            const dx = e.clientX - down.clientX;
            if (!moved && Math.abs(dx) < SCRUB_START_PX) return;
            moved = true;
            const by = step * (e.shiftKey ? 10 : (e.altKey ? 0.1 : 1));
            const value = site.value + (Math.round((dx * perPixel) / by) * by);
            if (!this.write(formatNumber(value, spec, by)) && this.endScrub) this.endScrub();
        };
        this.endScrub = () => {
            document.removeEventListener('mousemove', move, true);
            document.removeEventListener('mouseup', this.endScrub, true);
            document.body.style.cursor = '';
            this.endScrub = null;
            this.editor.pushUndoStop();
            if (!moved && this.active && spec.type !== 'number') this.openPopup();
            else if (!this.popup) this.active = null;
        };
        document.body.style.cursor = 'ew-resize';
        document.addEventListener('mousemove', move, true);
        document.addEventListener('mouseup', this.endScrub, true);
    }
    openPopup () {
        const {model, start, site} = this.active;
        const styles = this.styles;
        const node = document.createElement('div');
        node.className = styles.propPopup;
        node.addEventListener('mousedown', e => e.stopPropagation());
        if (site.spec.label) {
            const label = document.createElement('div');
            label.className = styles.propPopupLabel;
            label.textContent = site.spec.label;
            node.appendChild(label);
        }
        if (site.spec.type === 'slider') this.buildSlider(node);
        else if (site.spec.type === 'angle') this.buildDial(node);
        else this.buildList(node);
        const widget = {
            allowEditorOverflow: true,
            getId: () => 'dimod.property.popup',
            getDomNode: () => node,
            getPosition: () => ({
                position: model.getPositionAt(start),
                preference: [
                    monaco.editor.ContentWidgetPositionPreference.BELOW,
                    monaco.editor.ContentWidgetPositionPreference.ABOVE
                ]
            })
        };
        this.popup = {widget, node};
        this.editor.pushUndoStop();
        this.editor.addContentWidget(widget);
        document.addEventListener('mousedown', this.onOutsideDown, true);
        const focus = node.querySelector('input');
        if (focus) setTimeout(() => this.popup && this.popup.node === node && focus.focus(), 0);
    }
    onOutsideDown (e) {
        if (this.popup && !this.popup.node.contains(e.target)) this.closePopup();
    }
    closePopup () {
        if (this.endScrub) this.endScrub();
        if (!this.popup) return;
        document.removeEventListener('mousedown', this.onOutsideDown, true);
        this.editor.removeContentWidget(this.popup.widget);
        this.popup = null;
        this.active = null;
        this.editor.pushUndoStop();
    }
    buildSlider (node) {
        const {site, text} = this.active;
        const spec = site.spec;
        const step = stepOf(spec, text);
        const input = document.createElement('input');
        input.type = 'range';
        input.className = this.styles.propSlider;
        input.min = spec.min;
        input.max = spec.max;
        input.step = step;
        input.value = site.value;
        const readout = document.createElement('span');
        readout.className = this.styles.propReadout;
        readout.textContent = text;
        input.addEventListener('input', () => {
            const next = formatNumber(Number(input.value), spec, step);
            if (this.write(next)) readout.textContent = next;
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Escape' || e.key === 'Enter') this.closeAndFocus(e);
        });
        node.appendChild(input);
        node.appendChild(readout);
    }
    buildDial (node) {
        const {site, text} = this.active;
        const spec = site.spec;
        const dial = document.createElement('div');
        dial.className = this.styles.propDial;
        const hand = document.createElement('div');
        hand.className = this.styles.propDialHand;
        dial.appendChild(hand);
        const readout = document.createElement('span');
        readout.className = this.styles.propReadout;
        const show = (value, shown) => { hand.style.transform = `rotate(${value}deg)`; readout.textContent = shown; };
        show(site.value, text);
        const set = e => {
            const box = dial.getBoundingClientRect();
            const dx = e.clientX - (box.left + (box.width / 2));
            const dy = e.clientY - (box.top + (box.height / 2));
            if (!dx && !dy) return;
            const snap = e.shiftKey ? 15 : (spec.step || 1);
            let value = Math.round((Math.atan2(dx, -dy) * 180 / Math.PI) / snap) * snap;
            if (value < spec.min) value += 360;
            if (value > spec.max) value -= 360;
            const next = formatNumber(value, spec, snap);
            if (this.write(next)) show(Number(next), next);
        };
        dial.addEventListener('mousedown', down => {
            down.preventDefault();
            set(down);
            const up = () => {
                document.removeEventListener('mousemove', set, true);
                document.removeEventListener('mouseup', up, true);
            };
            document.addEventListener('mousemove', set, true);
            document.addEventListener('mouseup', up, true);
        });
        node.appendChild(dial);
        node.appendChild(readout);
    }
    buildList (node) {
        const {site} = this.active;
        const styles = this.styles;
        const options = optionsOf(site.spec);
        const list = document.createElement('div');
        list.className = styles.propList;
        const fill = filter => {
            list.textContent = '';
            const wanted = filter.trim().toLowerCase();
            const shown = options.filter(option => String(option).toLowerCase()
                .includes(wanted));
            shown.forEach(option => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = option === site.value ?
                    `${styles.propOption} ${styles.propOptionCurrent}` :
                    styles.propOption;
                item.textContent = String(option);
                item.addEventListener('click', e => { this.write(literalFor(site, option)); this.closeAndFocus(e); });
                list.appendChild(item);
            });
            if (!shown.length) {
                const empty = document.createElement('div');
                empty.className = styles.propEmpty;
                empty.textContent = options.length ?
                    'Nothing matches' :
                    `This project has no ${site.spec.type} to pick`;
                list.appendChild(empty);
            }
        };
        if (options.length >= FILTER_FROM) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = styles.propFilter;
            input.placeholder = 'Search';
            input.addEventListener('input', () => fill(input.value));
            input.addEventListener('keydown', e => {
                if (e.key === 'Escape') { this.closeAndFocus(e); } else if (e.key === 'Enter') {
                    const first = list.querySelector('button');
                    if (first) first.click();
                }
            });
            node.appendChild(input);
        }
        fill('');
        node.appendChild(list);
    }
    closeAndFocus (e) {
        e.preventDefault();
        e.stopPropagation();
        this.closePopup();
        this.editor.focus();
    }
    dispose () {
        clearTimeout(this.timer);
        this.closePopup();
        this.node.removeEventListener('mousedown', this.onMouseDown, true);
        this.listeners.forEach(listener => listener.dispose());
        if (this.decoratedModel && !this.decoratedModel.isDisposed()) {
            this.decoratedModel.deltaDecorations(this.decorations, []);
        }
        this.decorations = [];
    }
}
const RELOAD_DELAY_MS = 700;
const TYPES_DELAY_MS = 1000;
const VALUES_REFRESH_MS = 300;
const MAX_INSPECTED = 20;
const CHECK_DELAY_MS = 150;
const HOT_KEY = 'dimodBlockspaceHotReload';
const MAX_HISTORY = 100;
const SLOW_MS_PER_FRAME = 4;
const REPL_MAX_LINES = 6;
const readHot = () => {
    try { return localStorage.getItem(HOT_KEY) === '1'; } catch (e) { return false; }
};
const writeHot = on => {
    try { localStorage.setItem(HOT_KEY, on ? '1' : '0'); } catch (e) {
    }
};
const monacoTheme = monacoThemeName;
let typesRegistered = false;
let projectTypesLib = null;
const registerTypes = () => {
    if (typesRegistered) return;
    typesRegistered = true;
    monaco.languages.typescript.javascriptDefaults.addExtraLib(apiTypes, 'file:///dimod-blockspace.d.ts');
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2020,
        allowNonTsExtensions: true,
        checkJs: true,
        lib: ['es2020']
    });
    const defaults = monaco.languages.typescript.javascriptDefaults;
    defaults.setDiagnosticsOptions({...defaults.getDiagnosticsOptions(), diagnosticCodesToIgnore: [1375, 1378]});
};
const setProjectTypes = text => {
    if (projectTypesLib) projectTypesLib.dispose();
    projectTypesLib = monaco.languages.typescript.javascriptDefaults.addExtraLib(text, 'file:///dimod-project.d.ts');
};
const MODEL_PREFIX = 'file:///sprites/';
const REPL_URI = 'file:///console/repl.js';
const isOurModel = model => { const uri = model.uri.toString(); return uri.startsWith(MODEL_PREFIX) || uri === REPL_URI; };
const replHistory = [];
const models = new Map();
const uriFor = targetId => monaco.Uri.parse(`${MODEL_PREFIX}${encodeURIComponent(targetId)}.js`);
const targetIdOf = uri => {
    for (const [targetId, model] of models) if (model.uri.toString() === uri.toString()) return targetId;
    return null;
};
const remembered = new Map();
const rememberedFor = targetId => {
    if (!remembered.has(targetId)) remembered.set(targetId, new Map());
    return remembered.get(targetId);
};
const previousText = new Map();
let externalChange = false;
const changeFromOutside = fn => {
    externalChange = true;
    try { fn(); } finally { externalChange = false; }
};
const modelFor = (targetId, text) => {
    let model = models.get(targetId);
    if (!model || model.isDisposed()) {
        model = monaco.editor.createModel(text, 'javascript', uriFor(targetId));
        models.set(targetId, model);
    } else if (model.getValue() !== text) { changeFromOutside(() => model.setValue(text)); }
    previousText.set(targetId, model.getValue());
    return model;
};
setEditorModels({get: targetId => { const model = models.get(targetId); return model && !model.isDisposed() ? model : null; }});
class BlockSpacePanel extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'setEditorNode', 'handleConsoleChange', 'handleMakeBlocks', 'handleClearLog', 'handleThemeChange',
            'handleToggleData', 'handleSourceChanged', 'handleProjectChanged', 'handleOpenBlocks',
            'handleAddBlockspace', 'handleGoToLine', 'handleRerun', 'handleShowConsole',
            'handleShowValues', 'refreshValues', 'openSprite', 'handleSave', 'handleShowInspector',
            'refreshInspector', 'handleShowProfiler', 'refreshProfiler', 'handleShowTests', 'handleRunTests',
            'handleTestsChanged', 'handleToggleHot', 'handleNextError', 'setReplNode', 'handleResetRepl',
            'handleRowClick', 'handleFocusRepl', 'handleOpenLibrary', 'handleCloseLibrary', 'libraryContext',
            'handleLibraryInsert', 'handleLibraryUpdate', 'handleOpenExamples', 'handleCloseExamples',
            'handleInsertExample', 'setPanelNode', 'handleFullscreenChange', 'handleToggleFullscreen',
            'handleToggleMore', 'handleCloseMore', 'handleDismissError'
        ]);
        this.state = {
            logVersion: 0,
            showData: false,
            tab: 'console',
            values: null,
            inspected: null,
            saved: false,
            profile: null,
            testsVersion: 0,
            hot: readHot(),
            errorCursor: 0,
            libraryOpen: false,
            examplesOpen: false,
            fullscreen: false,
            moreOpen: false,
            errorsVersion: 0
        };
        this.dismissedError = null;
        this.repl = null;
        this.replHistoryAt = -1;
        this.reloadTimer = null;
        this.savedTimer = null;
        this.typesTimer = null;
        this.checkTimer = null;
        this.valuesTimer = null;
        this.markedErrors = new Map();
        this.pendingReveal = null;
    }
    componentDidMount () {
        this.offConsole = subscribeConsole(this.handleConsoleChange);
        this.offFullscreen = onFullscreenChange(this.handleFullscreenChange);
        markSeen(this.props.editingTargetId);
        this.props.vm.on('DIMOD_BLOCKSPACE_SOURCE_CHANGED', this.handleSourceChanged);
        this.props.vm.on('DIMOD_BLOCKSPACE_TESTS', this.handleTestsChanged);
        this.props.vm.on('targetsUpdate', this.handleProjectChanged);
        this.props.vm.on('EXTENSION_ADDED', this.handleProjectChanged);
        this.props.vm.on('BLOCKSINFO_UPDATE', this.handleProjectChanged);
        this.themeObserver = new MutationObserver(this.handleThemeChange);
        this.themeObserver.observe(document.body, {attributes: true, attributeFilter: ['theme']});
    }
    componentDidUpdate (prevProps) {
        if (prevProps.editingTargetId !== this.props.editingTargetId && this.editor) {
            this.flushReload(prevProps.editingTargetId);
            const arriving = this.props.editingTargetId;
            if (unseenErrors(arriving) > 0 && !this.pendingReveal) {
                const spot = errorSpots().find(found => found.targetId === arriving);
                if (spot && spot.entry.line) {
                    this.pendingReveal = {targetId: arriving, selection: this.selectionFor(spot.entry)};
                }
            }
            this.showTarget(arriving);
            markSeen(arriving);
            if (this.state.tab === 'values') this.refreshValues();
            if (this.state.tab === 'inspector') this.refreshInspector();
            if (this.state.tab === 'profiler') this.refreshProfiler();
        }
    }
    componentWillUnmount () {
        if (this.offConsole) this.offConsole();
        if (this.offFullscreen) this.offFullscreen();
        if (this.state.fullscreen) exitFullscreen();
        clearInterval(this.valuesTimer);
        clearTimeout(this.checkTimer);
        setDefinitionSource(null);
        setPropertyEditorSource(null);
        this.props.vm.off('DIMOD_BLOCKSPACE_SOURCE_CHANGED', this.handleSourceChanged);
        this.props.vm.off('DIMOD_BLOCKSPACE_TESTS', this.handleTestsChanged);
        this.props.vm.off('targetsUpdate', this.handleProjectChanged);
        this.props.vm.off('EXTENSION_ADDED', this.handleProjectChanged);
        this.props.vm.off('BLOCKSINFO_UPDATE', this.handleProjectChanged);
        if (this.repl) this.repl.dispose();
        this.repl = null;
        if (this.themeObserver) this.themeObserver.disconnect();
        clearTimeout(this.typesTimer);
        clearTimeout(this.savedTimer);
        this.flushReload(this.props.editingTargetId);
        this.disposeEditorExtras();
        if (this.editor) this.editor.dispose();
        this.editor = null;
    }
    get host () { return this.props.vm.runtime.dimodBlockspace; }
    getTarget (targetId) { return targetId ? this.props.vm.runtime.getTargetById(targetId) : null; }
    textFor (target) { const code = this.host.getSource(target); return this.state.showData ? code : viewOf(code); }
    setEditorNode (node) {
        if (!node) return;
        if (!monacoReady()) {
            this.editorNode = node;
            return loadMonaco().then(() => this.editorNode === node && node.isConnected && this.setEditorNode(node), () => {});
        }
        if (this.editor) { this.disposeEditorExtras(); this.editor.dispose(); this.editor = null; }
        node.innerHTML = '';
        registerTypes();
        this.editor = monaco.editor.create(node, {
            automaticLayout: true,
            minimap: {enabled: false},
            fixedOverflowWidgets: true,
            theme: monacoTheme(),
            tabSize: 4,
            quickSuggestions: {other: true, comments: false, strings: true},
            quickSuggestionsDelay: 60,
            wordBasedSuggestions: false,
            suggestSelection: 'recentlyUsedByPrefix',
            snippetSuggestions: 'inline',
            suggest: {
                showWords: false,
                showSnippets: true,
                preview: true,
                showIcons: true,
                showStatusBar: true,
                localityBonus: true,
                shareSuggestSelections: true
            },
            parameterHints: {enabled: true, cycle: true},
            acceptSuggestionOnCommitCharacter: true,
            tabCompletion: 'on',
            hover: {delay: 250, sticky: true},
            autoClosingBrackets: 'always',
            autoClosingQuotes: 'always',
            autoSurround: 'languageDefined',
            bracketPairColorization: {enabled: true},
            guides: {bracketPairs: true, indentation: true},
            renderWhitespace: 'selection',
            smoothScrolling: true,
            stickyTabStops: true,
            scrollBeyondLastLine: false
        });
        registerSnippets(isOurModel);
        registerEventCompletions(isOurModel);
        registerModuleCompletions(isOurModel, this.props.vm);
        registerLiveValues(isOurModel);
        setLiveValueSource({vm: this.props.vm, getTargetId: () => this.props.editingTargetId});
        registerDefinitions(isOurModel);
        setDefinitionSource({
            vm: this.props.vm,
            getTargetId: () => this.props.editingTargetId,
            modelFor: targetId => {
                const target = this.getTarget(targetId);
                return target ? modelFor(targetId, this.textFor(target)) : null;
            },
            targetIdOf,
            openSprite: this.openSprite
        }, this.editor);
        this.preview = new BlockPreview({
            vm: this.props.vm,
            getTargetId: () => this.props.editingTargetId,
            media: `${this.props.basePath}static/blocks-media/`,
            className: styles$3.blockPreview
        });
        this.inlineButtons = new InlineBlockspaceButtons(this.editor, {
            info: id => this.blockspaceInfo(id),
            onOpen: this.handleOpenBlocks,
            preview: this.preview,
            className: styles$3.inlineOpen,
            runningClassName: styles$3.inlineOpenRunning
        });
        registerPropertyEditors(isOurModel);
        setPropertyEditorSource({
            runtime: this.props.vm.runtime,
            getTarget: () => this.getTarget(this.props.editingTargetId),
            getSources: () => this.complexSources()
        });
        this.propertyEditors = new PropertyEditors(this.editor, node, styles$3);
        this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, this.handleRerun);
        this.editor.onKeyDown(e => {
            if (e.keyCode === monaco.KeyCode.KEY_S && (e.ctrlKey || e.metaKey) && !e.altKey) this.handleSave();
        });
        this.clipboard = installClipboard(this.editor, node, {
            enabled: () => !this.state.showData,
            toFullText: text => {
                const target = this.getTarget(this.props.editingTargetId);
                return target ?
                    codeOf(text, this.host.getSource(target), rememberedFor(this.props.editingTargetId)) :
                    text;
            },
            remember: (id, payload) => rememberedFor(this.props.editingTargetId).set(id, payload)
        });
        this.remoteCarets = new RemoteCarets(this.editor, {getTargetId: () => this.props.editingTargetId, styles: styles$3});
        this.changeListener = this.editor.onDidChangeModelContent(e => {
            const model = this.editor.getModel();
            const targetId = (model && targetIdOf(model.uri)) || this.props.editingTargetId;
            if (!externalChange && !isApplyingRemote() && !this.state.showData && previousText.has(targetId)) {
                sendViewEdit(targetId, e.changes, previousText.get(targetId));
            }
            if (model) previousText.set(targetId, model.getValue());
            this.scheduleReload(targetId);
            this.inlineButtons.refreshSoon();
            this.propertyEditors.refreshSoon();
            this.checkSoon();
        });
        this.showTarget(this.props.editingTargetId);
    }
    disposeEditorExtras () {
        if (this.changeListener) this.changeListener.dispose();
        if (this.inlineButtons) this.inlineButtons.dispose();
        if (this.propertyEditors) this.propertyEditors.dispose();
        if (this.clipboard) this.clipboard.dispose();
        if (this.remoteCarets) this.remoteCarets.dispose();
        if (this.preview) this.preview.hide();
        this.changeListener = this.inlineButtons = this.clipboard = this.remoteCarets = this.preview = null;
        this.propertyEditors = null;
    }
    complexSources () {
        if (!this.host) return [];
        return this.props.vm.runtime.targets
            .filter(target => target.isOriginal && this.host.isComplex(target))
            .map(target => {
                const model = models.get(target.id);
                return model && !model.isDisposed() ? model.getValue() : this.host.getSource(target);
            });
    }
    blockspaceInfo (id) {
        const target = this.getTarget(this.props.editingTargetId);
        const entry = target && this.host.spaces.entry(target.sprite, id);
        if (!entry) return null;
        const blocks = [...entry.blockIds].filter(blockId => {
            const block = target.blocks._blocks[blockId];
            return block && !block.shadow;
        }).length;
        const running = [...this.host.spaces.runs].filter(run => run.blockspace && run.blockspace === entry.ref).length;
        return {blocks, params: entry.params, running};
    }
    showTarget (targetId) {
        const target = this.getTarget(targetId);
        if (!target || !this.host || !this.editor) return;
        this.editor.setModel(modelFor(targetId, this.textFor(target)));
        this.updateProjectTypes();
        if (this.inlineButtons) this.inlineButtons.refresh();
        if (this.propertyEditors) this.propertyEditors.refresh();
        this.checkIds();
        const reveal = this.pendingReveal;
        if (reveal && reveal.targetId === targetId) {
            this.pendingReveal = null;
            if (reveal.selection) {
                this.editor.setSelection(reveal.selection);
                this.editor.revealRangeInCenter(reveal.selection);
            }
            this.editor.focus();
        }
    }
    openSprite (targetId, selection) {
        if (targetId === this.props.editingTargetId) {
            if (selection) { this.editor.setSelection(selection); this.editor.revealRangeInCenter(selection); }
            return;
        }
        this.pendingReveal = {targetId, selection};
        this.props.vm.setEditingTarget(targetId);
    }
    checkSoon () { clearTimeout(this.checkTimer); this.checkTimer = setTimeout(() => this.checkIds(), CHECK_DELAY_MS); }
    checkIds () {
        clearTimeout(this.checkTimer);
        const model = this.editor && this.editor.getModel();
        if (!model) return;
        const text = model.getValue();
        const seen = new Set();
        const markers = [];
        const mark = (start, end, message) => {
            const from = model.getPositionAt(start);
            const to = model.getPositionAt(end);
            markers.push({
                severity: monaco.MarkerSeverity.Error,
                message,
                startLineNumber: from.lineNumber,
                startColumn: from.column,
                endLineNumber: to.lineNumber,
                endColumn: to.column
            });
        };
        for (const call of findBlockspaces(text)) {
            if (call.id === null) {
                mark(call.start, call.end > 0 ? call.end : call.start + 3,
                    'new Blockspace() needs a plain string id, like new Blockspace("jump")');
            } else if (seen.has(call.id)) {
                mark(call.idStart, call.idEnd, `Another blockspace is already called "${call.id}"`);
            } else { seen.add(call.id); }
        }
        monaco.editor.setModelMarkers(model, 'blockspace-ids', markers);
        const lintMarkers = lint(text).map(problem => {
            const from = model.getPositionAt(problem.start);
            const to = model.getPositionAt(problem.end);
            return {
                severity: problem.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
                message: problem.message,
                startLineNumber: from.lineNumber,
                startColumn: from.column,
                endLineNumber: to.lineNumber,
                endColumn: to.column
            };
        });
        monaco.editor.setModelMarkers(model, 'blockspace-lint', lintMarkers);
        const hintMarkers = findEditorCalls(text).filter(call => call.problem)
            .map(call => {
                const from = model.getPositionAt(call.start);
                const to = model.getPositionAt(call.end);
                return {
                    severity: monaco.MarkerSeverity.Warning,
                    message: call.problem,
                    startLineNumber: from.lineNumber,
                    startColumn: from.column,
                    endLineNumber: to.lineNumber,
                    endColumn: to.column
                };
            });
        monaco.editor.setModelMarkers(model, 'blockspace-editor-hints', hintMarkers);
    }
    updateProjectTypes () {
        clearTimeout(this.typesTimer);
        this.typesTimer = null;
        const target = this.getTarget(this.props.editingTargetId);
        if (target) setProjectTypes(projectTypes(this.props.vm.runtime, target));
    }
    scheduleReload (targetId = this.props.editingTargetId) {
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => this.reload(targetId), RELOAD_DELAY_MS);
    }
    flushReload (targetId) {
        if (this.reloadTimer === null) return;
        clearTimeout(this.reloadTimer);
        this.reload(targetId);
    }
    reload (targetId) {
        this.reloadTimer = null;
        const target = this.getTarget(targetId);
        const model = models.get(targetId);
        if (!target || !model || !this.host) return false;
        const current = this.host.getSource(target);
        const code = this.state.showData ?
            model.getValue() :
            codeOf(model.getValue(), current, rememberedFor(targetId));
        if (code === current) return false;
        this.clearErrorMarkers(targetId);
        this.host.setSource(target, code, {apply: false, typed: !this.state.showData});
        if (this.state.hot) this.hotApply(target);
        if (this.inlineButtons) this.inlineButtons.refresh();
        this.handleProjectChanged();
        return true;
    }
    hotApply (target) {
        const model = models.get(target.id);
        const problem = this.host.checkSyntax(this.host.getSource(target));
        if (problem) {
            if (model) monaco.editor.setModelMarkers(model, 'blockspace-hot', []);
            return;
        }
        if (model) monaco.editor.setModelMarkers(model, 'blockspace-hot', []);
        this.host.applySource(target, {hot: true});
    }
    setPanelNode (node) { this.panelNode = node; }
    handleFullscreenChange () { this.setState({fullscreen: isFullscreen(panelOf(this.panelNode))}); }
    handleToggleFullscreen () { toggleFullscreen(panelOf(this.panelNode)); }
    handleToggleHot () {
        const hot = !this.state.hot;
        writeHot(hot);
        this.setState({hot});
        if (hot) {
            const target = this.getTarget(this.props.editingTargetId);
            if (target && this.host && this.host.isPending(target)) { this.flushReload(target.id); this.hotApply(target); }
        }
    }
    handleSourceChanged () {
        const target = this.getTarget(this.props.editingTargetId);
        if (target && this.reloadTimer === null) {
            const model = models.get(this.props.editingTargetId);
            const text = this.textFor(target);
            if (model && model.getValue() !== text) {
                changeFromOutside(() => model.pushEditOperations([], [{range: model.getFullModelRange(), text}], () => null));
                previousText.set(this.props.editingTargetId, model.getValue());
            }
        }
        if (this.inlineButtons) this.inlineButtons.refreshSoon();
        this.handleProjectChanged();
    }
    handleProjectChanged () {
        if (this.typesTimer !== null) return;
        this.typesTimer = setTimeout(() => this.updateProjectTypes(), TYPES_DELAY_MS);
    }
    handleOpenBlocks (id) {
        const targetId = this.props.editingTargetId;
        this.flushReload(targetId);
        if (this.preview) this.preview.hide();
        if (openBlockspace(this.props.vm, targetId, id)) { this.props.onOpenBlockspace(targetId, id); } else {
            this.props.vm.emit('DIMOD_BLOCKSPACE_LOG', {
                targetId,
                level: 'error',
                line: null,
                text: `Blockspace "${id}" isn't there, check its line in the code`
            });
        }
    }
    handleAddBlockspace () {
        const targetId = this.props.editingTargetId;
        const model = models.get(targetId);
        if (!this.editor || !model) return;
        const taken = new Set(findBlockspaces(model.getValue()).map(call => call.id));
        let n = 1;
        while (taken.has(`blockspace${n}`)) n++;
        const name = `blockspace${n}`;
        const position = this.editor.getPosition() || {lineNumber: model.getLineCount()};
        const line = position.lineNumber;
        const column = model.getLineMaxColumn(line);
        const blank = model.getLineContent(line).trim() === '';
        this.editor.executeEdits('dimod-add-blockspace', [{
            range: new monaco.Range(line, blank ? 1 : column, line, column),
            text: `${blank ? '' : '\n'}const ${name} = new Blockspace("${name}");`
        }]);
        this.flushReload(targetId);
        this.handleOpenBlocks(name);
    }
    selectionFor (entry, model = null) {
        const m = model || (this.editor && this.editor.getModel());
        const line = m ? Math.min(entry.line, m.getLineCount()) : entry.line;
        if (!entry.column || !m) { return new monaco.Range(line, 1, line, m ? m.getLineMaxColumn(line) : 1); }
        const word = m.getWordAtPosition({lineNumber: line, column: entry.column});
        const endColumn = word ? Math.max(word.endColumn, entry.column + 1) : entry.column + 1;
        return new monaco.Range(line, entry.column, line, endColumn);
    }
    handleGoToLine (e) {
        const line = Number(e.currentTarget.dataset.line);
        if (!this.editor || !line) return;
        e.stopPropagation();
        this.jumpTo({line, column: Number(e.currentTarget.dataset.column) || 0});
    }
    jumpTo (entry) {
        if (!this.editor || !entry || !entry.line) return;
        this.editor.revealLineInCenter(entry.line);
        this.editor.setSelection(this.selectionFor(entry));
        this.editor.focus();
    }
    handleRowClick (e) {
        const index = Number(e.currentTarget.dataset.index);
        const entry = logFor(this.props.editingTargetId)[index];
        if (!entry) return;
        if (entry.level === 'input' && this.repl) { this.repl.setValue(entry.text); this.repl.focus(); } else if (entry.line) { this.jumpTo(entry); }
    }
    handleNextError () {
        const spots = errorSpots();
        if (!spots.length) return;
        const cursor = this.state.errorCursor % spots.length;
        const spot = spots[cursor];
        this.setState({errorCursor: cursor + 1});
        if (spot.entry.line) {
            this.openSprite(spot.targetId, this.selectionFor(spot.entry, models.get(spot.targetId) || null));
        } else { this.props.vm.setEditingTarget(spot.targetId); }
    }
    handleToggleData () {
        const targetId = this.props.editingTargetId;
        this.flushReload(targetId);
        this.setState(state => ({showData: !state.showData}), () => {
            const target = this.getTarget(targetId);
            if (target && this.editor) { const model = modelFor(targetId, this.textFor(target)); this.editor.setModel(model); }
        });
    }
    handleConsoleChange (targetId) {
        if (targetId !== this.props.editingTargetId) return;
        markSeen(targetId);
        this.setState(state => ({logVersion: state.logVersion + 1}));
        const log = logFor(targetId);
        const entry = log[log.length - 1];
        const model = models.get(targetId);
        const byLine = this.markedErrors.get(targetId);
        if (!entry || (byLine && byLine.get(entry.line) === entry) || entry.level !== 'error' || !entry.line ||
            !model || entry.line > model.getLineCount()) return;
        (byLine || this.newErrorMap(targetId)).set(entry.line, entry);
        this.applyErrorMarkers(targetId);
    }
    newErrorMap (targetId) { const byLine = new Map(); this.markedErrors.set(targetId, byLine); return byLine; }
    applyErrorMarkers (targetId) {
        const model = models.get(targetId);
        if (!model) return;
        const byLine = this.markedErrors.get(targetId);
        const markers = byLine ? [...byLine.values()].map(entry => {
            const range = this.selectionFor(entry, model);
            const help = explainError(entry.text, model.getValue());
            return {
                severity: monaco.MarkerSeverity.Error,
                message: help ? `${help.title}. ${help.hint}\n${entry.text}` : entry.text,
                startLineNumber: range.startLineNumber,
                startColumn: range.startColumn,
                endLineNumber: range.endLineNumber,
                endColumn: range.endColumn
            };
        }) : [];
        monaco.editor.setModelMarkers(model, 'blockspace', markers);
        this.setState(state => ({errorsVersion: state.errorsVersion + 1}));
    }
    clearErrorMarkers (targetId) {
        if (this.markedErrors.has(targetId)) this.setState(state => ({errorsVersion: state.errorsVersion + 1}));
        this.markedErrors.delete(targetId);
        const model = models.get(targetId);
        if (model) monaco.editor.setModelMarkers(model, 'blockspace', []);
    }
    handleThemeChange () {
        if (monacoReady()) monaco.editor.setTheme(monacoTheme());
    }
    handleClearLog () { this.clearErrorMarkers(this.props.editingTargetId); clearLog(this.props.editingTargetId); }
    handleSave () {
        const targetId = this.props.editingTargetId;
        clearTimeout(this.reloadTimer);
        const changed = this.reload(targetId);
        if (this.state.hot && !changed) {
            const target = this.getTarget(targetId);
            if (target && this.host) this.hotApply(target);
        }
        clearTimeout(this.savedTimer);
        this.setState({saved: true});
        this.savedTimer = setTimeout(() => this.setState({saved: false}), 1200);
    }
    handleRerun () {
        const targetId = this.props.editingTargetId;
        const target = this.getTarget(targetId);
        if (!target || !this.host) return;
        this.flushReload(targetId);
        this.clearErrorMarkers(targetId);
        this.host.applySource(target);
    }
    handleShowConsole () { clearInterval(this.valuesTimer); this.setState({tab: 'console'}); }
    handleShowProfiler () {
        this.setState({tab: 'profiler'});
        this.refreshProfiler();
        clearInterval(this.valuesTimer);
        this.valuesTimer = setInterval(this.refreshProfiler, 500);
    }
    refreshProfiler () {
        if (!this.host) return;
        this.setState({profile: {
            sprite: this.host.profileSprite(this.props.editingTargetId),
            project: this.host.profileProject().slice(0, 8),
            frameMs: this.props.vm.runtime.currentStepTime || 1000 / 30
        }});
    }
    handleShowTests () { clearInterval(this.valuesTimer); this.setState({tab: 'tests'}); }
    handleTestsChanged () { this.setState(state => ({testsVersion: state.testsVersion + 1})); }
    handleRunTests () {
        const targetId = this.props.editingTargetId;
        if (!this.host || !this.getTarget(targetId)) return;
        this.flushReload(targetId);
        this.handleShowTests();
        this.host.runTests(targetId);
    }
    handleOpenLibrary () { this.flushReload(this.props.editingTargetId); this.setState({libraryOpen: true}); }
    handleCloseLibrary () { this.setState({libraryOpen: false}); }
    handleToggleMore () { this.setState(state => ({moreOpen: !state.moreOpen})); }
    handleCloseMore () { this.setState({moreOpen: false}); }
    handleDismissError () {
        this.dismissedError = this.currentError();
        this.setState(state => ({errorsVersion: state.errorsVersion + 1}));
    }
    currentError () {
        const byLine = this.markedErrors.get(this.props.editingTargetId);
        if (!byLine || byLine.size === 0) return null;
        const list = [...byLine.values()];
        return list[list.length - 1];
    }
    renderErrorBar () {
        const entry = this.currentError();
        if (!entry || entry === this.dismissedError) return null;
        const model = this.editor && this.editor.getModel();
        const help = explainError(entry.text, model ? model.getValue() : '');
        return (
            <div className={styles$3.errorBar} role="alert">
                <Icon src={icons.error} />
                <div className={styles$3.errorText}>
                    <div className={styles$3.errorTitle}>
                        {entry.line ? `Line ${entry.line}: ` : ''}{help ? help.title : entry.text}
                    </div>
                    {help ? <div className={styles$3.errorHint}>{help.hint}<span>{entry.text}</span></div> : null}
                </div>
                {entry.line ? (
                    <button
                        className={styles$3.iconLabelButton}
                        data-line={entry.line}
                        data-column={entry.column || 0}
                        onClick={this.handleGoToLine}
                    >{'Show me'}</button>
                ) : null}
                <button
                    aria-label="Hide this error"
                    className={styles$3.introClose}
                    title="Hide this error"
                    onClick={this.handleDismissError}
                >
                    <Icon src={icons.close} tint />
                </button>
            </div>
        );
    }
    handleOpenExamples () { this.setState({examplesOpen: true}); }
    handleCloseExamples () { this.setState({examplesOpen: false}); }
    handleInsertExample (code) {
        const model = this.editor && this.editor.getModel();
        if (!model) return;
        const {lineNumber} = this.editor.getPosition();
        const blank = model.getLineContent(lineNumber).trim() === '';
        const column = model.getLineMaxColumn(lineNumber);
        const range = blank ? new monaco.Range(lineNumber, 1, lineNumber, column) :
            new monaco.Range(lineNumber, column, lineNumber, column);
        this.editor.executeEdits('dimod-example', [{range, text: `${blank ? '' : '\n\n'}${code}\n`}]);
        const first = blank ? lineNumber : lineNumber + 2;
        this.editor.setSelection(new monaco.Range(first, 1, first + code.split('\n').length - 1, 1));
        this.editor.revealLineInCenterIfOutsideViewport(first);
        this.editor.focus();
        this.setState({examplesOpen: false});
    }
    libraryContext () {
        const targetId = this.props.editingTargetId;
        const target = this.getTarget(targetId);
        const model = models.get(targetId);
        const text = model ? model.getValue() : '';
        const selected = model && this.editor ? model.getValueInRange(this.editor.getSelection()) : '';
        const current = target && this.host ? this.host.getSource(target) : text;
        return {
            imports: findImports(text),
            selection: selected && !this.state.showData ? codeOf(selected, current, rememberedFor(targetId)) : selected,
            whole: current
        };
    }
    applyLibraryEdit (edit) {
        const model = this.editor && this.editor.getModel();
        if (!model) return;
        this.editor.executeEdits('dimod-library', [{
            range: monaco.Range.fromPositions(model.getPositionAt(edit.from), model.getPositionAt(edit.to)),
            text: edit.text
        }]);
        if (this.clipboard) this.clipboard.convert(edit.from, edit.from + edit.text.length);
        this.editor.revealPositionInCenterIfOutsideViewport(model.getPositionAt(edit.from));
    }
    handleLibraryInsert (entry, code) {
        const model = models.get(this.props.editingTargetId);
        if (!model || !this.editor) return null;
        const line = (this.editor.getPosition() || {lineNumber: model.getLineCount()}).lineNumber;
        const offset = model.getOffsetAt({lineNumber: line, column: model.getLineMaxColumn(line)});
        const result = insertImport(model.getValue(), offset, entry, code);
        this.applyLibraryEdit(result.edit);
        return result;
    }
    handleLibraryUpdate (imp, entry, code) {
        const model = models.get(this.props.editingTargetId);
        if (!model) return null;
        const now = findImports(model.getValue()).find(found => found.id === imp.id && found.start === imp.start) ||
            findImports(model.getValue()).find(found => found.id === imp.id);
        if (!now) return null;
        const result = updateImport(model.getValue(), now, entry, code);
        this.applyLibraryEdit(result.edit);
        return result;
    }
    handleResetRepl () {
        if (this.host) this.host.resetRepl(this.props.editingTargetId);
        this.emitConsole('log', 'Console reset: what it had set up is stopped, its variables are gone');
    }
    handleFocusRepl () {
        if (this.repl) this.repl.focus();
    }
    emitConsole (level, text) {
        const target = this.getTarget(this.props.editingTargetId);
        if (target && this.host) this.host.emitLog(target, level, text, null);
    }
    runRepl () {
        const code = this.repl ? this.repl.getValue() : '';
        if (!code.trim() || !this.host) return;
        const targetId = this.props.editingTargetId;
        const target = this.getTarget(targetId);
        if (!target) return;
        if (replHistory[replHistory.length - 1] !== code) replHistory.push(code);
        if (replHistory.length > MAX_HISTORY) replHistory.shift();
        this.replHistoryAt = -1;
        this.repl.setValue('');
        this.host.emitLog(target, 'input', code, null);
        this.host.evaluate(targetId, code).then(result => {
            if (result.hasValue) this.host.emitLog(target, 'result', result.text, null);
        }, e => {
            const text = e && e.name && e.message ? `${e.name}: ${e.message}` : String(e);
            this.host.emitLog(target, 'error', text, null);
        });
    }
    replHistoryStep (direction) {
        if (!replHistory.length) return false;
        const next = this.replHistoryAt === -1 ?
            (direction < 0 ? replHistory.length - 1 : -1) :
            this.replHistoryAt + direction;
        if (next < -1 || next >= replHistory.length) return true;
        this.replHistoryAt = next;
        this.repl.setValue(next === -1 ? '' : replHistory[next]);
        const model = this.repl.getModel();
        this.repl.setPosition({lineNumber: model.getLineCount(), column: model.getLineMaxColumn(model.getLineCount())});
        return true;
    }
    setReplNode (node) {
        if (!node) return;
        if (!monacoReady()) {
            this.replNode = node;
            return loadMonaco().then(() => this.replNode === node && node.isConnected && this.setReplNode(node), () => {});
        }
        if (this.repl) { this.repl.dispose(); this.repl = null; }
        node.innerHTML = '';
        registerTypes();
        const uri = monaco.Uri.parse(REPL_URI);
        const model = monaco.editor.getModel(uri) || monaco.editor.createModel('', 'javascript', uri);
        this.repl = monaco.editor.create(node, {
            model,
            automaticLayout: true,
            minimap: {enabled: false},
            lineNumbers: 'off',
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
            scrollBeyondLastLine: false,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            renderLineHighlight: 'none',
            contextmenu: false,
            wordWrap: 'on',
            fontSize: 12,
            fixedOverflowWidgets: true,
            scrollbar: {vertical: 'hidden', horizontal: 'hidden', alwaysConsumeMouseWheel: false},
            theme: monacoTheme(),
            tabSize: 4,
            quickSuggestions: {other: true, comments: false, strings: true},
            quickSuggestionsDelay: 60,
            wordBasedSuggestions: false,
            suggestSelection: 'recentlyUsedByPrefix',
            snippetSuggestions: 'inline',
            suggest: {
                showWords: false,
                showSnippets: true,
                preview: true,
                showIcons: true,
                showStatusBar: true,
                localityBonus: true,
                shareSuggestSelections: true
            },
            parameterHints: {enabled: true, cycle: true},
            acceptSuggestionOnCommitCharacter: true,
            tabCompletion: 'on',
            hover: {delay: 250, sticky: true},
            occurrencesHighlight: false
        });
        const idle = '!suggestWidgetVisible && !parameterHintsVisible';
        this.repl.addCommand(monaco.KeyCode.Enter, () => this.runRepl(), idle);
        this.repl.addCommand(monaco.KeyCode.UpArrow, () => {
            const line = this.repl.getPosition().lineNumber;
            if (line > 1 || !this.replHistoryStep(-1)) this.repl.trigger('keyboard', 'cursorUp', null);
        }, idle);
        this.repl.addCommand(monaco.KeyCode.DownArrow, () => {
            const position = this.repl.getPosition();
            const last = this.repl.getModel().getLineCount();
            if (position.lineNumber < last || !this.replHistoryStep(1)) { this.repl.trigger('keyboard', 'cursorDown', null); }
        }, idle);
        const fit = () => {
            const lines = Math.min(REPL_MAX_LINES, Math.max(1, this.repl.getModel().getLineCount()));
            const height = (lines * 18) + 6;
            node.style.height = `${height}px`;
            this.repl.layout();
        };
        this.repl.onDidChangeModelContent(fit);
        fit();
    }
    handleShowValues () {
        this.setState({tab: 'values'});
        this.refreshValues();
        clearInterval(this.valuesTimer);
        this.valuesTimer = setInterval(this.refreshValues, VALUES_REFRESH_MS);
    }
    handleShowInspector () {
        this.setState({tab: 'inspector'});
        this.refreshInspector();
        clearInterval(this.valuesTimer);
        this.valuesTimer = setInterval(this.refreshInspector, VALUES_REFRESH_MS);
    }
    refreshInspector () {
        if (!this.host) return;
        this.setState({inspected: this.host.inspect(this.props.editingTargetId)});
    }
    refreshValues () {
        const target = this.getTarget(this.props.editingTargetId);
        if (!target || !this.host) return;
        const rows = values => Object.keys(values).sort()
            .map(name => ({name, text: describe(values[name]) || 'a function'}));
        this.setState({values: {
            world: rows(this.host.worldValues),
            mine: rows(this.host.targetValues(target)),
            clones: target.sprite.clones.length - 1
        }});
    }
    async handleMakeBlocks () {
        const target = this.getTarget(this.props.editingTargetId);
        if (!target || !this.host || !await confirmSetComplex(target.getName(), false)) return;
        this.flushReload(this.props.editingTargetId);
        this.host.setComplex(this.props.editingTargetId, false);
    }
    renderToolbarButton ({icon, label, text, low, title, on, danger, onClick}) {
        return (
            <button
                aria-label={label}
                aria-pressed={on}
                className={classNames(on ? styles$3.iconButtonOn : styles$3.iconButton, danger ? styles$3.danger : null,
                    text ? styles$3.textButton : null, low ? styles$3.textButtonLow : null)}
                title={title}
                onClick={onClick}
            >
                {icon}
                {text ? <span className={styles$3.buttonText}>{text}</span> : null}
            </button>
        );
    }
    renderLog () {
        const log = logFor(this.props.editingTargetId);
        if (log.length === 0) {
            return <div className={styles$3.logEmpty}>{'Nothing yet... type below to run code as this sprite'}</div>;
        }
        const classFor = level => {
            switch (level) {
            case 'error': return styles$3.logError;
            case 'fail': return styles$3.logError;
            case 'pass': return styles$3.logPass;
            case 'input': return styles$3.logInput;
            case 'result': return styles$3.logResult;
            default: return styles$3.logLine;
            }
        };
        const prefix = level => {
            switch (level) {
            case 'input': return '> ';
            case 'result': return '← ';
            case 'pass': return (<Icon src={icons.success} className={styles$3.statusIcon} />);
            case 'fail': return (<Icon src={icons.error} className={styles$3.statusIcon} />);
            default: return '';
            }
        };
        return log.map((entry, i) => (
            <div
                className={classNames(classFor(entry.level), (entry.line || entry.level === 'input') ?
                    styles$3.logClickable : null)}
                key={i}
                data-index={i}
                title={entry.line ? 'Go to this line' : (entry.level === 'input' ? 'Put it back in the prompt' : null)}
                onClick={this.handleRowClick}
            >
                {entry.isClone ? <span className={styles$3.logTag}>{'clone'}</span> : null}
                {entry.line ? (
                    <button
                        className={styles$3.logLineLink}
                        title="Go to this line"
                        data-line={entry.line}
                        data-column={entry.column || 0}
                        onClick={this.handleGoToLine}
                    >
                        {`line ${entry.line}`}
                    </button>
                ) : null}
                {prefix(entry.level)}{entry.text}
                {entry.level === 'error' && explainError(entry.text) ? (
                    <span className={styles$3.logHint}>
                        {`${explainError(entry.text).title}. ${explainError(entry.text).hint}`}
                    </span>
                ) : null}
                {entry.count > 1 ? <span className={styles$3.logCount}>{`×${entry.count}`}</span> : null}
                {(entry.frames || []).map((frame, n) => (
                    <button
                        className={styles$3.logFrame}
                        key={n}
                        title="Called from here"
                        data-line={frame.line}
                        data-column={frame.column || 0}
                        onClick={this.handleGoToLine}
                    >
                        {`← line ${frame.line}`}
                    </button>
                ))}
            </div>
        ));
    }
    renderProfiler () {
        const profile = this.state.profile;
        if (!profile) return null;
        const {sprite, project, frameMs} = profile;
        const target = this.getTarget(this.props.editingTargetId);
        const fixed = n => (n >= 10 ? n.toFixed(0) : n.toFixed(2));
        const share = ms => Math.min(100, (ms / frameMs) * 100);
        const barFor = ms => (
            <span className={styles$3.profileBar}>
                <span
                    className={ms >= SLOW_MS_PER_FRAME ? styles$3.profileFillSlow : styles$3.profileFill}
                    style={{width: `${Math.max(1, share(ms))}%`}}
                />
            </span>
        );
        return (
            <div className={styles$3.values}>
                <div className={styles$3.valuesGroup}>
                    <div className={styles$3.valuesTitle}>
                        {`${target ? target.getName() : 'sprite'}: ${fixed(sprite.total)} ms a frame ` +
                            `(${Math.round(share(sprite.total))}% of ${Math.round(frameMs)} ms)` +
                            `${sprite.copies > 1 ? `, ${sprite.copies} copies` : ''}`}
                    </div>
                    {sprite.rows.length === 0 ? (
                        <div className={styles$3.logEmpty}>{'Its code has run nothing in the last second'}</div>
                    ) : sprite.rows.map(row => (
                        <div
                            className={styles$3.valuesRow}
                            key={row.label}
                            title={`${row.calls} calls, the slowest took ${row.max.toFixed(2)} ms`}
                        >
                            <span className={styles$3.valuesValue}>{row.label}</span>
                            <span className={styles$3.profileNumber}>{`${row.calls}×`}</span>
                            <span className={styles$3.profileNumber}>{`${fixed(row.perFrame)} ms`}</span>
                            {barFor(row.perFrame)}
                        </div>
                    ))}
                    <div className={styles$3.logEmpty}>
                        {'Callbacks are timed (loops, handlers, timers, top level); code after an await is not'}
                    </div>
                </div>
                <div className={styles$3.valuesGroup}>
                    <div className={styles$3.valuesTitle}>{'Slowest sprites'}</div>
                    {project.length === 0 ? <div className={styles$3.logEmpty}>{'No complex sprites'}</div> :
                        project.map(entry => (
                            <div className={styles$3.valuesRow} key={entry.target.id}>
                                <span className={styles$3.valuesValue}>{entry.target.getName()}</span>
                                <span className={styles$3.profileNumber}>{`${fixed(entry.total)} ms`}</span>
                                {barFor(entry.total)}
                            </div>
                        ))}
                </div>
            </div>
        );
    }
    renderTests () {
        const run = this.host ? this.host.testRun(this.props.editingTargetId) : null;
        if (!run) {
            return (
                <div className={styles$3.logEmpty}>
                    {'No tests run yet. Write them in the code... test("jumps", () => { expect(me.y).toBe(0) })... ' +
                        'then press Run tests (the green tick in the toolbar)'}
                </div>
            );
        }
        const icon = status => {
            if (status === 'pass') return (<Icon src={icons.success} className={styles$3.statusIcon} />);
            if (status === 'fail') return (<Icon src={icons.error} className={styles$3.statusIcon} />);
            return <span className={styles$3.statusDash}>{status === 'skip' ? '–' : '·'}</span>;
        };
        const passed = run.results.filter(r => r.status === 'pass').length;
        const failed = run.results.filter(r => r.status === 'fail').length;
        return (
            <div>
                <div className={styles$3.valuesTitle}>
                    {run.running ? 'Running…' : `${passed} passed, ${failed} failed`}
                </div>
                {run.results.map((result, i) => (
                    <div
                        className={classNames(result.status === 'fail' ? styles$3.logError : styles$3.logLine,
                            result.line ? styles$3.logClickable : null)}
                        key={i}
                        data-index={i}
                        data-line={result.line || 0}
                        onClick={result.line ? this.handleGoToLine : null}
                    >
                        {icon(result.status)}{result.name}
                        <span className={styles$3.logCount}>{`${Math.round(result.ms)} ms`}</span>
                        {result.message ? <div className={styles$3.testMessage}>{result.message}</div> : null}
                    </div>
                ))}
            </div>
        );
    }
    renderInspector () {
        const copies = this.state.inspected;
        if (!copies) return null;
        const stopper = stop => () => { stop(); this.refreshInspector(); };
        const quote = value => JSON.stringify(String(value));
        const loopText = loop => {
            const meta = loop.meta || {};
            let text = loop.kind;
            if (loop.kind === 'tween') {
                text = `tween · ${Math.round(meta.progress * 100)}%` +
                    `${meta.repeat ? ` · play ${meta.iteration + 1}` : ''}${meta.paused ? ' · paused' : ''}`;
            } else if (loop.kind === 'touch' || loop.kind === 'untouch') {
                const watching = meta.watching;
                text = `on("${loop.kind}", ${watching && typeof watching === 'object' && 'name' in watching ?
                    watching.name : quote(watching)})`;
            } else if (loop.kind === 'follow') {
                text = `camera ${quote(meta.camera)} following`;
            } else if (loop.kind === 'sync' && meta.sync) {
                const sync = meta.sync;
                text = `sync ${quote(sync.channel)} · ${sync.mode}${sync.available ? '' : ' · no server'} · ` +
                    `${sync.stats.sent} sent, ${sync.stats.received} received, ${sync.stats.ghosts} ghost` +
                    `${sync.stats.ghosts === 1 ? '' : 's'}`;
            }
            return loop.paused ? `${text} · paused` : text;
        };
        const section = copy => {
            const rows = [];
            if (copy.running) {
                copy.handlers.forEach(h => rows.push({
                    text: `${h.on}.on(${quote(h.event)}${h.filter === null ? '' : `, ${quote(h.filter)}`})`,
                    stop: h.stop
                }));
                copy.loops.forEach(loop => rows.push({text: loopText(loop), stop: loop.stop}));
                copy.timers.forEach(timer => rows.push({
                    text: timer.every ? `every ${timer.every}s` : `after, in ${timer.in.toFixed(1)}s`,
                    stop: timer.stop
                }));
                copy.runs.forEach(run => rows.push({
                    text: `run ${run.blockspace === null ? 'a block' : quote(run.blockspace)} as ${run.as}`,
                    stop: run.stop
                }));
                if (copy.waits) rows.push({text: `${copy.waits} waiting (wait, waitUntil, nextFrame...)`});
                copy.exposed.forEach(e => rows.push({text: `${e.on}.expose(${quote(e.name)})`}));
                Object.keys(copy.holds).sort()
                    .forEach(key => rows.push({text: `held ${key}: ${describe(copy.holds[key]) || 'a function'}`}));
            }
            let empty = null;
            if (!copy.running) empty = 'Not running';
            else if (rows.length === 0) empty = 'Nothing going';
            return (
                <div className={styles$3.valuesGroup} key={`${copy.target.id}${copy.isConsole ? '-console' : ''}`}>
                    <div className={styles$3.valuesTitle}>
                        {copy.isConsole ? `the console of ${copy.target.getName()}` :
                            (copy.target.isOriginal ? copy.target.getName() : `a clone of ${copy.target.getName()}`)}
                    </div>
                    {empty ? <div className={styles$3.logEmpty}>{empty}</div> : null}
                    {rows.map((row, i) => (
                        <div className={styles$3.valuesRow} key={i}>
                            <span className={styles$3.valuesValue}>{row.text}</span>
                            {row.stop ? (
                                <button
                                    className={styles$3.logClear}
                                    aria-label="Stop it"
                                    title="Stop it"
                                    onClick={stopper(row.stop)}
                                >
                                    <Icon src={icons.close} tint />
                                </button>
                            ) : null}
                        </div>
                    ))}
                </div>
            );
        };
        const shown = copies.slice(0, MAX_INSPECTED);
        return (
            <div className={styles$3.values}>
                {shown.map(section)}
                {copies.length > shown.length ? (
                    <div className={styles$3.logEmpty}>{`and ${copies.length - shown.length} more clones`}</div>
                ) : null}
            </div>
        );
    }
    renderValues () {
        const values = this.state.values;
        if (!values) return null;
        const table = (title, rows, empty) => (
            <div className={styles$3.valuesGroup}>
                <div className={styles$3.valuesTitle}>{title}</div>
                {rows.length === 0 ? <div className={styles$3.logEmpty}>{empty}</div> : rows.map(row => (
                    <div className={styles$3.valuesRow} key={row.name}>
                        <span className={styles$3.valuesName}>{row.name}</span>
                        <span className={styles$3.valuesValue}>{row.text}</span>
                    </div>
                ))}
            </div>
        );
        const target = this.getTarget(this.props.editingTargetId);
        const self = target && target.isStage ? 'the stage' : 'me';
        return (
            <div className={styles$3.values}>
                {table('world', values.world, 'None yet, world.score = 0 makes one')}
                {table(`${self}${values.clones > 0 ? ` (not its ${values.clones} clone` +
                    `${values.clones === 1 ? '' : 's'})` : ''}`, values.mine,
                `None yet, ${self === 'me' ? 'me' : 'world.stage'}.hp = 123 makes one`)}
            </div>
        );
    }
    render () {
        const {tab, hot, fullscreen} = this.state;
        const problems = errorSpots().length;
        const editing = this.getTarget(this.props.editingTargetId);
        const toolbarName = editing ? (editing.isStage ? 'Stage' : editing.getName()) : 'Code';
        return (
            <div className={styles$3.panel} ref={this.setPanelNode}>
                <div className={styles$3.toolbar}>
                    <span className={styles$3.toolbarTitle}>{toolbarName}</span>
                    {problems > 0 ? (
                        <button
                            aria-label={`${problems} error${problems === 1 ? '' : 's'}: go to the next one`}
                            className={styles$3.problemsButton}
                            title="Go to the next error, in whichever sprite it is"
                            onClick={this.handleNextError}
                        >
                            <Icon src={icons.warning} />
                            {problems}
                        </button>
                    ) : null}
                    <span className={styles$3.toolbarSpacer} />
                    {this.renderToolbarButton({
                        icon: <Icon src={icons.play} tint />,
                        text: 'Run',
                        label: 'Run',
                        title: "Run this sprite's code again from the top. The rest of the project keeps going (Ctrl+Enter)",
                        onClick: this.handleRerun
                    })}
                    {this.renderToolbarButton({
                        icon: this.state.saved ? <Icon src={icons.success} /> : <Icon src={icons.save} tint />,
                        text: this.state.saved ? 'Saved' : 'Save',
                        low: true,
                        label: this.state.saved ? 'Saved' : 'Save',
                        title: "Save the code to the sprite without running it (Ctrl+S). It saves by itself anyway, this is just for peace of mind",
                        onClick: this.handleSave
                    })}
                    <span className={styles$3.toolbarDivider} />
                    {this.renderToolbarButton({
                        icon: <Icon src={icons.blocks} tint />,
                        text: 'Add blocks',
                        label: 'Add a blockspace',
                        title: 'Add a blockspace: real blocks living inside the code, put below the caret. ' +
                            'Code can run them and they can run code back',
                        onClick: this.handleAddBlockspace
                    })}
                    {this.renderToolbarButton({
                        icon: <Icon src={icons.examples} tint />,
                        text: 'Examples',
                        low: true,
                        label: 'Examples',
                        title: 'Little scripts to start from... moving, clones, scores, multiplayer...',
                        onClick: this.handleOpenExamples
                    })}
                    {this.renderToolbarButton({
                        icon: <Icon src={icons.docs} tint />,
                        text: 'Docs',
                        label: 'Docs',
                        title: 'How all this works, recipes, and every function there is (new tab)',
                        onClick: () => openDocs()
                    })}
                    <span className={styles$3.toolbarDivider} />
                    {this.renderToolbarButton({
                        icon: <Icon src={icons.turbo} />,
                        on: hot,
                        label: hot ? 'Hot reload is on' : 'Hot reload',
                        title: `Hot reload${hot ? ' is on' : ''}: code that compiles runs again as soon as you stop ` +
                            'typing, without restarting the project. Held values stay, and `reloaded` is true in the code',
                        onClick: this.handleToggleHot
                    })}
                    {this.renderToolbarButton({
                        icon: <FullscreenIcon on={fullscreen} />,
                        on: fullscreen,
                        label: fullscreen ? 'Exit fullscreen' : 'Fullscreen',
                        title: fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen',
                        onClick: this.handleToggleFullscreen
                    })}
                    <span className={styles$3.moreWrap}>
                        {this.renderToolbarButton({
                            icon: <Icon src={icons.more} tint />,
                            on: this.state.moreOpen,
                            label: 'More',
                            title: 'More',
                            onClick: this.handleToggleMore
                        })}
                        {this.state.moreOpen ? (
                            <React.Fragment>
                                <div className={styles$3.moreBackdrop} onClick={this.handleCloseMore} />
                                <div className={styles$3.moreMenu} role="menu" onClick={this.handleCloseMore}>
                                    {[
                                        [icons.extension, 'Library', 'Share code with other people, and grab theirs', this.handleOpenLibrary],
                                        [icons.success, 'Run tests', 'Reruns the code, then its test() blocks', this.handleRunTests],
                                        [this.state.showData ? icons.eyeHide : icons.eyeShow,
                                            this.state.showData ? 'Hide block data' : 'Show block data',
                                            "The blocks' raw data inside each new Blockspace(...)", this.handleToggleData]
                                    ].map(([src, text, note, onClick]) => (
                                        <button className={styles$3.moreItem} key={text} role="menuitem" onClick={onClick}>
                                            <Icon src={src} tint />
                                            <span>{text}<small>{note}</small></span>
                                        </button>
                                    ))}
                                    <div className={styles$3.moreSeparator} />
                                    <button
                                        className={classNames(styles$3.moreItem, styles$3.moreDanger)}
                                        role="menuitem"
                                        onClick={this.handleMakeBlocks}
                                    >
                                        <Icon src={icons.stackBlock} tint />
                                        <span>{'Turn back into blocks'}<small>{"The code doesn't go anywhere, make it complex again and it's back"}</small></span>
                                    </button>
                                </div>
                            </React.Fragment>
                        ) : null}
                    </span>
                </div>
                {this.renderErrorBar()}
                <div className={styles$3.editorHost} ref={this.setEditorNode} />
                <div className={styles$3.logPane}>
                    <div className={styles$3.logHeader}>
                        <button
                            className={tab === 'console' ? styles$3.logTabActive : styles$3.logTab}
                            onClick={this.handleShowConsole}
                        >
                            <Icon src={icons.terminal} />
                            {'Console'}
                        </button>
                        <button
                            className={tab === 'values' ? styles$3.logTabActive : styles$3.logTab}
                            onClick={this.handleShowValues}
                        >
                            <Icon src={icons.variables} />
                            {'Values'}
                        </button>
                        <button
                            className={tab === 'inspector' ? styles$3.logTabActive : styles$3.logTab}
                            onClick={this.handleShowInspector}
                        >
                            <Icon src={icons.threads} />
                            {'Inspector'}
                        </button>
                        <button
                            className={tab === 'profiler' ? styles$3.logTabActive : styles$3.logTab}
                            onClick={this.handleShowProfiler}
                        >
                            <Icon src={icons.performance} />
                            {'Profiler'}
                        </button>
                        <button
                            className={tab === 'tests' ? styles$3.logTabActive : styles$3.logTab}
                            onClick={this.handleShowTests}
                        >
                            <Icon src={icons.success} />
                            {'Tests'}
                        </button>
                        <span className={styles$3.toolbarSpacer} />
                        {tab === 'console' ? (
                            <button
                                aria-label="Reset the console"
                                className={styles$3.logClear}
                                title={'Reset the console: stop what it started (handlers, loops...) and ' +
                                    'forget its variables'}
                                onClick={this.handleResetRepl}
                            >
                                <Icon src={icons.undo} tint />
                            </button>
                        ) : null}
                        {tab === 'console' ? (
                            <button
                                aria-label="Clear the console"
                                className={styles$3.logClear}
                                title="Clear the console"
                                onClick={this.handleClearLog}
                            >
                                <Icon src={icons.trash} tint />
                            </button>
                        ) : null}
                        {tab === 'tests' ? (
                            <button
                                aria-label="Run the tests again"
                                className={styles$3.logClear}
                                title="Run the tests again"
                                onClick={this.handleRunTests}
                            >
                                <Icon src={icons.reload} tint />
                            </button>
                        ) : null}
                    </div>
                    <div className={styles$3.logBody}>
                        {tab === 'console' ? this.renderLog() : null}
                        {tab === 'values' ? this.renderValues() : null}
                        {tab === 'inspector' ? this.renderInspector() : null}
                        {tab === 'profiler' ? this.renderProfiler() : null}
                        {tab === 'tests' ? this.renderTests() : null}
                    </div>
                    <div className={tab === 'console' ? styles$3.replRow : styles$3.replRowHidden} onClick={this.handleFocusRepl}>
                        <span className={styles$3.replPrompt}>{'>'}</span>
                        <div className={styles$3.replHost} ref={this.setReplNode} />
                    </div>
                </div>
                {this.state.examplesOpen ? (
                    <ExamplesModal
                        spriteName={(this.getTarget(this.props.editingTargetId) || {getName: () => ''}).getName() ||
                            'this sprite'}
                        onInsert={this.handleInsertExample}
                        onClose={this.handleCloseExamples}
                    />
                ) : null}
                {this.state.libraryOpen ? (
                    <LibraryModal
                        spriteName={(this.getTarget(this.props.editingTargetId) || {getName: () => ''}).getName() ||
                            'this sprite'}
                        getContext={this.libraryContext}
                        onInsert={this.handleLibraryInsert}
                        onUpdate={this.handleLibraryUpdate}
                        onClose={this.handleCloseLibrary}
                    />
                ) : null}
            </div>
        );
    }
}
BlockSpacePanel.propTypes = {
    basePath: PropTypes.string,
    editingTargetId: PropTypes.string,
    onOpenBlockspace: PropTypes.func.isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};
BlockSpacePanel.defaultProps = {basePath: './'};
const mapDispatchToProps$1 = dispatch => ({onOpenBlockspace: (targetId, id) => dispatch(setBlockspaceFocus({targetId, id}))});
const blockSpacePanel = connect(null, mapDispatchToProps$1)(BlockSpacePanel);
class BlockspaceFocusBar extends React.Component {
    constructor (props) { super(props); bindAll(this, ['handleBack', 'handleEditParams']); }
    componentDidMount () { this.registerParamsButton(); }
    componentWillUnmount () {
        clearTimeout(this.registerTimer);
        closeBlockspace(this.props.vm);
        if (this.props.focus) this.props.onClose();
    }
    registerParamsButton (attempt = 0) {
        const ScratchBlocks = window.ScratchBlocks;
        const workspace = ScratchBlocks && ScratchBlocks.getMainWorkspace && ScratchBlocks.getMainWorkspace();
        const flyout = workspace && workspace.getFlyout && workspace.getFlyout();
        if (flyout) {
            flyout.getWorkspace().registerButtonCallback('DIMOD_BLOCKSPACE_PARAMS', this.handleEditParams);
        } else if (attempt < 40) { this.registerTimer = setTimeout(() => this.registerParamsButton(attempt + 1), 50); }
    }
    handleBack () { this.props.onClose(); }
    handleEditParams () {
        const host = this.props.vm.runtime.dimodBlockspace;
        const ScratchBlocks = window.ScratchBlocks;
        if (!host || !ScratchBlocks) return;
        ScratchBlocks.prompt(
            'Parameter names, separated by commas:',
            host.focusedParams().join(', '),
            value => {
                if (value === null || typeof value === 'undefined') return;
                setOpenBlockspaceParams(this.props.vm, String(value).split(','));
            },
            'Blockspace parameters',
            ScratchBlocks.BROADCAST_MESSAGE_VARIABLE_TYPE
        );
    }
    render () {
        const {focus, spriteName} = this.props;
        if (!focus) return null;
        return (
            <div className={styles$3.focusBar}>
                <button className={styles$3.iconLabelButton} onClick={this.handleBack}>
                    <Icon src={icons.back} tint />
                    {'Back to code'}
                </button>
                <span className={styles$3.toolbarTitle}>{`Blockspace "${focus.id}"`}</span>
                <span className={styles$3.toolbarNote}>
                    {`in ${spriteName}`}
                </span>
            </div>
        );
    }
}
BlockspaceFocusBar.propTypes = {
    focus: PropTypes.shape({targetId: PropTypes.string, id: PropTypes.string}),
    onClose: PropTypes.func.isRequired,
    spriteName: PropTypes.string,
    vm: PropTypes.instanceOf(VM).isRequired
};
const mapStateToProps = state => {
    const focus = state.scratchGui.blockspace.focus;
    const sprite = focus && state.scratchGui.targets.sprites[focus.targetId];
    return {focus, spriteName: sprite ? sprite.name : 'the stage'};
};
const mapDispatchToProps = dispatch => ({onClose: () => dispatch(setBlockspaceFocus(null))});
const blockspaceFocusBar = connect(mapStateToProps, mapDispatchToProps)(BlockspaceFocusBar);
export {BlockPreview, blockSpacePanel as BlockSpacePanel, blockspaceFocusBar as BlockspaceFocusBar, ExamplesModal, Icon, InlineBlockspaceButtons, LibraryModal, PropertyEditors, RemoteCarets, icons, installClipboard, registerDefinitions, registerEventCompletions, registerLiveValues, registerPropertyEditors, registerSnippets, setDefinitionSource, setLiveValueSource, setPropertyEditorSource, suggestionsAt};
