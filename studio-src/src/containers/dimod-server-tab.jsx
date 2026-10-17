import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import classNames from 'classnames';
import VM from 'scratch-vm';
import LazyScratchBlocks from '../lib/tw-lazy-scratch-blocks';
import {BLOCKS_DEFAULT_SCALE} from '../lib/layout-constants';
import {serverToolboxXML} from '../lib/dimod-server-blocks';
import {generateServerCode, serverTypes} from '../lib/dimod-server-codegen';
import {getDimodToken, getCloudState, onCloudStateChange, loadCloudState, confirmAndEnableCloud} from '../lib/dimod-project';
import {DitAmount} from './dimod-modals.jsx';
import {askConfirm, loadMonaco, monaco, monacoReady, monacoThemeName} from '../lib/dimod-ui';
import {
    colorForUserId,
    contrastTextColor,
    abandonGesture,
    hasActiveGesture,
    installFieldCarets,
    registerFieldCaretScope
} from '../lib/dimod-collab';
import styles from '../components/dimod-server-tab/dimod-server-tab.css';
import shared from '../components/block-space/block-space-panel.css';
import {Icon, icons} from '../components/block-space/block-space-panel.jsx';
import codeIcon from '../components/gui/icon--code.svg';
import bracesIcon from '../components/dimod-server-tab/icon--braces.svg';
import databaseIcon from '../components/dimod-server-tab/icon--database.svg';
const API_BASE = process.env.DIMOD_API_BASE;
const fmtBytes = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
class DimodServerDb extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['load', 'handleSearch', 'handleOpen', 'handleSave', 'handleDelete', 'handleNew', 'handleClearAll', 'handleMore', 'handleReload', 'handleBackToList']);
        this.state = {entries: [], next: null, count: 0, total: 0, max: 0, q: '', open: null, draftKey: '', draft: '', error: '', busy: false};
        this.searchTimer = null;
    }
    componentDidMount () { this.load(); }
    componentWillUnmount () { clearTimeout(this.searchTimer); }
    async api (path, opts = {}) {
        const res = await fetch(`${API_BASE}/projects/${this.props.projectId}/server-db${path}`, {
            ...opts,
            headers: {'Authorization': `Bearer ${getDimodToken()}`, 'Content-Type': 'application/json'}
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
    }
    async load (after = '') {
        try {
            const data = await this.api(`?q=${encodeURIComponent(this.state.q)}&after=${encodeURIComponent(after)}`);
            this.setState(s => ({
                entries: after ? [...s.entries, ...data.entries] : data.entries,
                next: data.next, count: data.count, total: data.total_bytes, max: data.max_bytes, error: ''
            }));
        } catch (e) { this.setState({error: e.message}); }
    }
    handleMore () { this.load(this.state.next); }
    handleSearch (e) {
        this.setState({q: e.target.value});
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => this.load(), 250);
    }
    async handleOpen (key) {
        try {
            const row = await this.api(`/value?key=${encodeURIComponent(key)}`);
            let pretty = row.value;
            try { pretty = JSON.stringify(JSON.parse(row.value), null, 2); } catch (e) {}
            this.setState({open: key, draftKey: key, draft: pretty, error: ''});
        } catch (e) { this.setState({error: e.message}); }
    }
    handleNew () { this.setState({open: '', draftKey: '', draft: '""', error: ''}); }
    async handleSave () {
        this.setState({busy: true});
        try {
            await this.api('', {method: 'PUT', body: JSON.stringify({key: this.state.draftKey, value: this.state.draft})});
            if (this.state.open && this.state.open !== this.state.draftKey) {
                await this.api(`?key=${encodeURIComponent(this.state.open)}`, {method: 'DELETE'});
            }
            this.setState({open: null});
            await this.load();
        } catch (e) { this.setState({error: e.message}); }
        this.setState({busy: false});
    }
    async handleDelete () {
        const agreed = await askConfirm('', {title: `Delete "${this.state.open}"?`, ok: 'Delete', danger: true});
        if (!agreed) return;
        try {
            await this.api(`?key=${encodeURIComponent(this.state.open)}`, {method: 'DELETE'});
            this.setState({open: null});
            await this.load();
        } catch (e) { this.setState({error: e.message}); }
    }
    handleReload () { this.load(); }
    handleBackToList () { this.setState({open: null, error: ''}); }
    async handleClearAll () {
        const agreed = await askConfirm('Players lose their saved data. This can\'t be undone.', {
            title: 'Delete EVERYTHING in this game\'s database?', ok: 'Delete everything', danger: true
        });
        if (!agreed) return;
        try { await this.api('?all=1', {method: 'DELETE'}); await this.load(); } catch (e) { this.setState({error: e.message}); }
    }
    render () {
        const {entries, next, count, total, max, q, open, draftKey, draft, error, busy} = this.state;
        return (
            <div className={styles.dbPanel}>
                <div className={styles.dbToolbar}>
                    <input className={styles.dbSearch} placeholder="Search keys" value={q} onChange={this.handleSearch} />
                    <span className={styles.dbUsage}>{`${count} keys · ${fmtBytes(total)} of ${fmtBytes(max || 0)}`}</span>
                    <button aria-label="New key" className={shared.iconButton} title="New key" onClick={this.handleNew}>
                        <Icon src={icons.add} tint />
                    </button>
                    <button aria-label="Reload" className={shared.iconButton} title="Reload" onClick={this.handleReload}>
                        <Icon src={icons.reload} tint />
                    </button>
                    {count ? (
                        <button
                            aria-label="Delete everything"
                            className={classNames(shared.iconButton, shared.danger)}
                            title="Delete everything in this game's database"
                            onClick={this.handleClearAll}
                        >
                            <Icon src={icons.trash} tint />
                        </button>
                    ) : null}
                </div>
                {error ? <div className={styles.dbError}>{error}</div> : null}
                {open === null ? (
                    <div className={styles.dbList}>
                        {entries.length ? entries.map(e => (
                            <button key={e.key} className={styles.dbRow} onClick={() => this.handleOpen(e.key)}>
                                <span className={styles.dbKey}>{e.key}</span>
                                <span className={styles.dbPreview}>{e.preview}</span>
                                <span className={styles.dbBytes}>{fmtBytes(e.bytes)}</span>
                            </button>
                        )) : (
                            <div className={shared.logEmpty}>{q ? 'No keys match.' : 'Nothing saved yet. Use db.set("key", value) in your server code.'}</div>
                        )}
                        {next ? <button className={styles.dbMore} onClick={this.handleMore}>{'Load more'}</button> : null}
                    </div>
                ) : (
                    <div className={styles.dbEditor}>
                        <input
                            className={styles.dbSearch}
                            placeholder="key"
                            value={draftKey}
                            onChange={e => this.setState({draftKey: e.target.value})}
                        />
                        <textarea
                            className={styles.dbValue}
                            spellCheck={false}
                            value={draft}
                            onChange={e => this.setState({draft: e.target.value})}
                        />
                        <div className={styles.dbToolbar}>
                            <button
                                aria-label="Save"
                                className={shared.iconButton}
                                disabled={busy || !draftKey}
                                title="Save this value"
                                onClick={this.handleSave}
                            >
                                <Icon src={icons.save} tint />
                            </button>
                            <button
                                aria-label="Back to the list"
                                className={shared.iconButton}
                                title="Back to the list"
                                onClick={this.handleBackToList}
                            >
                                <Icon src={icons.back} />
                            </button>
                            {open ? (
                                <button
                                    aria-label="Delete this key"
                                    className={classNames(shared.iconButton, shared.danger)}
                                    title="Delete this key"
                                    onClick={this.handleDelete}
                                >
                                    <Icon src={icons.trash} tint />
                                </button>
                            ) : null}
                            <span className={styles.dbUsage}>{'JSON: strings need "quotes"'}</span>
                        </div>
                    </div>
                )}
            </div>
        );
    }
}
DimodServerDb.propTypes = {projectId: PropTypes.string.isRequired};
const WS_BASE = process.env.DIMOD_WS_BASE;
const SAVE_DEBOUNCE_MS = 400;
const STATE_BROADCAST_MS = 800;
const MAX_LOG_LINES = 500;
const REMOTE_RETRY_MS = 100;
const CARET_THROTTLE_MS = 80;
const TYPING_MS = 1500;
const CARET_ACTIVE_MS = 2500;
const CARET_TICK_MS = 250;
const newSessionId = () => Date.now().toString(36) + Math.random().toString(36)
    .slice(2, 10);
const isPoint = p => p && Number.isInteger(p.row) && Number.isInteger(p.column) && p.row >= 0 && p.column >= 0;
const deltaFits = (lines, delta) => {
    if (!delta || !isPoint(delta.start) || !isPoint(delta.end) || !Array.isArray(delta.lines) ||
        !delta.lines.length || !delta.lines.every(l => typeof l === 'string')) return false;
    const {start, end} = delta;
    if (start.row >= lines.length || start.column > lines[start.row].length) return false;
    if (delta.action === 'insert') return true;
    if (delta.action !== 'remove') return false;
    if (end.row >= lines.length || end.column > lines[end.row].length) return false;
    const removed = end.row === start.row ?
        [lines[start.row].slice(start.column, end.column)] :
        [lines[start.row].slice(start.column), ...lines.slice(start.row + 1, end.row), lines[end.row].slice(0, end.column)];
    return removed.join('\n') === delta.lines.join('\n');
};
const applyDeltaToText = (text, delta) => {
    const lines = text.split(/\r\n|\r|\n/);
    if (!deltaFits(lines, delta)) return null;
    const {start, end} = delta;
    if (delta.action === 'insert') {
        const line = lines[start.row];
        const inserted = delta.lines.slice();
        inserted[0] = line.slice(0, start.column) + inserted[0];
        inserted[inserted.length - 1] += line.slice(start.column);
        lines.splice(start.row, 1, ...inserted);
    } else {
        lines.splice(start.row, end.row - start.row + 1, lines[start.row].slice(0, start.column) + lines[end.row].slice(end.column));
    }
    return lines.join('\n');
};
const sameContent = (a, b) => a.mode === b.mode &&
    (a.mode === 'code' ? a.code === b.code : (a.xml || null) === (b.xml || null));
const selectionClassFor = color => {
    const name = `dimod-remote-selection-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
    if (!document.getElementById(name)) {
        const style = document.createElement('style');
        style.id = name;
        style.textContent = `.${name} { background: color-mix(in srgb, ${color} 30%, transparent); }`;
        document.head.appendChild(style);
    }
    return name;
};
const endOf = (start, lines) => ({
    row: start.row + lines.length - 1,
    column: lines.length === 1 ? start.column + lines[0].length : lines[lines.length - 1].length
});
let typesRegistered = false;
const registerServerTypes = () => {
    if (typesRegistered) return;
    typesRegistered = true;
    const {typescriptDefaults, ScriptTarget} = monaco.languages.typescript;
    typescriptDefaults.addExtraLib(serverTypes, 'file:///dimod-server.d.ts');
    typescriptDefaults.setCompilerOptions({
        target: ScriptTarget.ES2020,
        allowNonTsExtensions: true,
        allowJs: true,
        checkJs: true,
        lib: ['es2020']
    });
};
const typingText = names => {
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return `${names.length} people are typing…`;
};
const WORKSPACE_OPTIONS = {
    zoom: {controls: true, wheel: true, startScale: BLOCKS_DEFAULT_SCALE},
    grid: {spacing: 40, length: 2, colour: '#ddd'},
    colours: {
        workspace: '#F9F9F9',
        flyout: '#F9F9F9',
        toolbox: '#FFFFFF',
        toolboxSelected: '#E9EEF2',
        scrollbar: '#CECDCE',
        scrollbarHover: '#CECDCE',
        insertionMarker: '#000000',
        insertionMarkerOpacity: 0.2,
        fieldShadow: 'rgba(255, 255, 255, 0.3)',
        dragShadowOpacity: 0.6
    },
    comments: true,
    collapse: false,
    sounds: false
};
const STARTER_XML = `<xml xmlns="http://www.w3.org/1999/xhtml">
<block type="dimodserver_whenconnects" x="40" y="40">
  <value name="PLAYER"><shadow type="dimodserver_player"></shadow></value>
  <next><block type="dimodserver_log"><value name="VALUE"><shadow type="text"><field name="TEXT">someone connected</field></shadow></value></block></next>
</block>
<block type="dimodserver_whensends" x="40" y="220">
  <value name="PLAYER"><shadow type="dimodserver_player"></shadow></value>
  <value name="DATA"><shadow type="dimodserver_data"></shadow></value>
  <next><block type="dimodserver_sendallexcept">
    <value name="PLAYER"><shadow type="text"><field name="TEXT"></field></shadow><block type="dimodserver_player"></block></value>
    <value name="DATA"><shadow type="text"><field name="TEXT"></field></shadow><block type="dimodserver_data"></block></value>
  </block></next>
</block>
</xml>`;
const getParam = name => new URLSearchParams(location.search).get(name);
const fmtTime = t => new Date(t).toLocaleTimeString([], {hour12: false});
class DimodServerTab extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handlePseudoLog',
            'setBlocksRef',
            'setEditorRef',
            'handleEditorChange',
            'setConsoleRef',
            'handleWorkspaceChange',
            'handleServerCodeLoaded',
            'handleCloudState',
            'handleUnlock',
            'handlePublish',
            'handleToggleView',
            'handleEditAsCode',
            'handleBackToBlocks',
            'handleToggleConsole',
            'handleClearConsole',
            'handleCollabMessage',
            'attachCollab',
            'handleThemeChange',
            'reclaimMainWorkspace',
            'flushRemote',
            'sendCaretSoon',
            'renderCarets',
            'tickCarets'
        ]);
        const server = props.vm.runtime.dimodServer;
        const cloud = getCloudState();
        this.state = {
            cloudLoaded: cloud.loaded,
            isCloud: cloud.isCloud,
            cost: cloud.cost,
            balance: cloud.balance,
            unlocking: false,
            publishedCode: null,
            publishing: false,
            publishError: null,
            mode: server && server.mode === 'code' ? 'code' : 'blocks',
            code: (server && server.code) || '',
            showCode: !!(server && server.mode === 'code'),
            consoleOpen: false,
            logs: [],
            drawerTab: 'console',
            unseenErrors: 0,
            consoleConnected: false,
            typingNames: []
        };
        this.live = {mode: this.state.mode, code: this.state.code};
        this.workspace = null;
        this.codeWorkspace = null;
        this.editor = null;
        this.model = null;
        this.editorEl = null;
        this.prevText = '';
        this.settingValue = false;
        this.pendingXml = server ? server.xml : null;
        this.saveTimer = null;
        this.saveBroadcast = true;
        this.stateTimer = null;
        this.consoleWs = null;
        this.consoleRetry = null;
        this.applyingRemote = false;
        this.sessionId = newSessionId();
        this.rev = 0;
        this.remoteQueue = [];
        this.remoteTimer = null;
        this.carets = {};
        this.caretTicker = null;
        this.caretSendTimer = null;
        this.lastCaretSentAt = 0;
        this.caretShared = false;
        this.lastTypedAt = 0;
    }
    setLive (patch, callback) {
        if ('mode' in patch) this.live.mode = patch.mode;
        if ('code' in patch) this.live.code = patch.code;
        this.setState(patch, callback);
    }
    componentDidMount () {
        this.props.vm.on('DIMOD_SERVER_CODE_LOADED', this.handleServerCodeLoaded);
        window.addEventListener('dimod:pseudo-log', this.handlePseudoLog);
        this.offCloudState = onCloudStateChange(this.handleCloudState);
        if (!getCloudState().loaded) loadCloudState();
        this.attachCollab();
        window.addEventListener('dimod:collab-ready', this.attachCollab);
        this.themeObserver = new MutationObserver(this.handleThemeChange);
        this.themeObserver.observe(document.body, {attributes: true, attributeFilter: ['theme']});
        if (this.state.isCloud) { this.connectConsole(); this.loadPublished(); }
        if (this.props.isVisible) this.show();
    }
    componentDidUpdate (prevProps, prevState) {
        if (this.props.isVisible && !prevProps.isVisible) this.show();
        if (!this.props.isVisible && prevProps.isVisible) this.hide();
        if (this.state.isCloud && !prevState.isCloud) {
            this.connectConsole();
            this.loadPublished();
            if (this.props.isVisible) this.show();
        }
        if (prevState.showCode !== this.state.showCode || prevState.mode !== this.state.mode) {
            this.syncWorkspaceVisibility();
            this.syncEditor();
        }
        if (prevProps.isVisible !== this.props.isVisible || prevState.mode !== this.state.mode) {
            this.sendCaretSoon();
            this.renderCarets();
        }
    }
    componentWillUnmount () {
        this.props.vm.removeListener('DIMOD_SERVER_CODE_LOADED', this.handleServerCodeLoaded);
        window.removeEventListener('dimod:pseudo-log', this.handlePseudoLog);
        if (this.offCloudState) this.offCloudState();
        if (this.caretShared && this.collab()) this.collab().send('server-tab-caret', {hidden: true, session: this.sessionId});
        if (this.offCollab) this.offCollab();
        window.removeEventListener('dimod:collab-ready', this.attachCollab);
        if (this.themeObserver) this.themeObserver.disconnect();
        clearTimeout(this.saveTimer);
        clearTimeout(this.stateTimer);
        clearTimeout(this.consoleRetry);
        clearTimeout(this.remoteTimer);
        clearTimeout(this.caretSendTimer);
        clearInterval(this.caretTicker);
        Object.keys(this.carets).forEach(key => this.removeCaret(key));
        if (this.offFieldCarets) this.offFieldCarets();
        const ws = this.consoleWs;
        this.consoleWs = null;
        if (ws) ws.close();
        if (this.editor) {
            Object.values(this.carets).forEach(caret => this.editor.removeContentWidget(caret.widget));
            this.editor.dispose();
            this.model.dispose();
        }
        if (this.workspace) { this.hide(); this.workspace.dispose(); }
    }
    handleCloudState (cloud) {
        this.setState({cloudLoaded: true, isCloud: cloud.isCloud, cost: cloud.cost, balance: cloud.balance});
    }
    async handleUnlock () { this.setState({unlocking: true}); await confirmAndEnableCloud(); this.setState({unlocking: false}); }
    setBlocksRef (el) { this.blocksEl = el; }
    handlePseudoLog (e) {
        if (this.state.isCloud) return;
        const entry = e.detail;
        this.setState(s => ({
            logs: [...s.logs, entry].slice(-MAX_LOG_LINES),
            unseenErrors: s.unseenErrors + (entry.level === 'error' && !s.consoleOpen ? 1 : 0)
        }), () => this.scrollConsole());
    }
    show () {
        if (!this.blocksEl) return;
        const ScratchBlocks = LazyScratchBlocks.get();
        if (!this.workspace) {
            this.codeWorkspace = ScratchBlocks.getMainWorkspace();
            this.workspace = ScratchBlocks.inject(this.blocksEl, Object.assign({}, WORKSPACE_OPTIONS, {
                media: `${this.props.basePath}static/blocks-media/`,
                rtl: this.props.isRtl,
                toolbox: serverToolboxXML()
            }));
            installFieldCarets(ScratchBlocks);
            this.offFieldCarets = registerFieldCaretScope('server', () => this.workspace);
            const flyoutWorkspace = this.workspace.getFlyout().getWorkspace();
            flyoutWorkspace.registerButtonCallback('MAKE_A_VARIABLE', () => ScratchBlocks.Variables.createVariable(this.workspace, null, ''));
            flyoutWorkspace.registerButtonCallback('MAKE_A_LIST', () => ScratchBlocks.Variables.createVariable(this.workspace, null, 'list'));
            this.loadXml(this.pendingXml || STARTER_XML);
            if (this.live.mode === 'blocks') this.setLive({code: generateServerCode(this.workspace)});
            this.workspace.addChangeListener(this.handleWorkspaceChange);
        }
        ScratchBlocks.mainWorkspace = this.workspace;
        this.wrapProcedureDialog(ScratchBlocks);
        this.syncWorkspaceVisibility();
        this.syncEditor();
        window.dispatchEvent(new Event('resize'));
    }
    wrapProcedureDialog (ScratchBlocks) {
        const Procedures = ScratchBlocks.Procedures;
        const current = Procedures.externalProcedureDefCallback;
        if (current && current.dimodServerTab) { current.dimodServerTab = this; return; }
        const wrapped = (mutation, callback) => {
            const tab = wrapped.dimodServerTab;
            const workspace = tab && tab.workspace;
            if (!workspace || ScratchBlocks.getMainWorkspace() !== workspace) return current(mutation, callback);
            const reclaim = () => {
                if (tab.workspace === workspace) ScratchBlocks.mainWorkspace = workspace;
            };
            return current(mutation, result => {
                reclaim();
                callback(result);
                setTimeout(() => {
                    reclaim();
                    if (result && tab.workspace === workspace) workspace.refreshToolboxSelection_();
                }, 0);
                setTimeout(reclaim, 300);
            });
        };
        wrapped.dimodServerTab = this;
        Procedures.externalProcedureDefCallback = wrapped;
    }
    reclaimMainWorkspace () {
        if (this.workspace && this.blocksEl && this.blocksEl.offsetParent !== null) {
            LazyScratchBlocks.get().mainWorkspace = this.workspace;
        }
    }
    hide () {
        if (!this.workspace) return;
        const ScratchBlocks = LazyScratchBlocks.get();
        ScratchBlocks.hideChaff();
        this.workspace.setVisible(false);
        if (this.codeWorkspace) ScratchBlocks.mainWorkspace = this.codeWorkspace;
    }
    syncWorkspaceVisibility () {
        if (!this.workspace) return;
        const visible = this.props.isVisible && this.state.mode === 'blocks' && !this.state.showCode;
        const ScratchBlocks = LazyScratchBlocks.get();
        if (!visible) ScratchBlocks.hideChaff();
        this.workspace.setVisible(visible);
        if (visible) ScratchBlocks.svgResize(this.workspace);
    }
    loadXml (xml) {
        const ScratchBlocks = LazyScratchBlocks.get();
        abandonGesture(ScratchBlocks, this.workspace);
        ScratchBlocks.Events.disable();
        try {
            const dom = ScratchBlocks.Xml.textToDom(xml);
            ScratchBlocks.Xml.clearWorkspaceAndLoadFromXml(dom, this.workspace);
        } catch (e) { this.workspace.clear(); } finally { ScratchBlocks.Events.enable(); }
    }
    handleServerCodeLoaded (server) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        const mode = server && server.mode === 'code' ? 'code' : 'blocks';
        this.pendingXml = server ? server.xml : null;
        this.setLive({mode, code: (server && server.code) || '', showCode: mode === 'code'}, () => this.syncEditor(true));
        if (this.workspace) {
            this.loadXml(this.pendingXml || STARTER_XML);
            if (mode === 'blocks') this.setLive({code: generateServerCode(this.workspace)});
        }
        this.loadPublished();
    }
    handleWorkspaceChange (event) {
        if (event.isUiEvent || event.type === 'ui') return;
        if (!this.applyingRemote) {
            this.rev += 1;
            if (this.collab()) {
                try { this.collab().send('server-tab-event', {event: event.toJson(), rev: this.rev}); } catch (e) {
                }
            }
        }
        this.scheduleCommit(true);
    }
    currentXml () {
        const ScratchBlocks = LazyScratchBlocks.get();
        if (!this.workspace) return this.pendingXml;
        return ScratchBlocks.Xml.domToText(ScratchBlocks.Xml.workspaceToDom(this.workspace));
    }
    scheduleCommit (broadcast) {
        if (!this.saveTimer) this.saveBroadcast = broadcast;
        else if (broadcast) this.saveBroadcast = true;
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flushCommit(), SAVE_DEBOUNCE_MS);
    }
    flushCommit () {
        if (!this.saveTimer) return;
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        this.commit({broadcast: this.saveBroadcast});
    }
    commit ({broadcast = true} = {}) {
        const {mode} = this.live;
        const xml = this.currentXml();
        const code = mode === 'code' ? this.live.code : (this.workspace ? generateServerCode(this.workspace) : this.live.code);
        const previous = this.props.vm.runtime.dimodServer;
        const next = {mode, xml, code};
        this.pendingXml = xml;
        if (mode === 'blocks' && code !== this.live.code) this.setLive({code}, () => this.syncEditor());
        if (previous && previous.mode === next.mode && previous.xml === next.xml && previous.code === next.code) return;
        this.props.vm.runtime.dimodServer = next;
        this.props.vm.runtime.emitProjectChanged();
        if (broadcast) this.broadcastStateSoon();
    }
    async loadPublished () {
        const projectId = getParam('p');
        const token = getDimodToken();
        if (!projectId || !token) return;
        try {
            const res = await fetch(`${API_BASE}/projects/${projectId}/server-logic`, {
                headers: {Authorization: `Bearer ${token}`}
            });
            if (!res.ok) return;
            const data = await res.json();
            this.setState({publishedCode: data.published_code || ''});
        } catch (e) {
        }
    }
    async handlePublish () {
        if (this.state.publishing) return;
        this.flushCommit();
        const mode = this.live.mode;
        const code = mode === 'code' ? this.live.code : (this.workspace ? generateServerCode(this.workspace) : this.live.code);
        this.commit();
        const projectId = getParam('p');
        const token = getDimodToken();
        if (!projectId || !token) { this.setState({publishError: 'Save the project to Dimod first'}); return; }
        this.setState({publishing: true, publishError: null});
        try {
            const res = await fetch(`${API_BASE}/projects/${projectId}/server-logic/publish`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
                body: JSON.stringify({mode, code})
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { this.setState({publishing: false, publishError: data.error || 'Couldn\'t publish'}); return; }
            this.setState({publishing: false, publishedCode: data.published_code ?? code});
            if (this.collab()) this.collab().send('server-tab-published', {});
        } catch (e) { this.setState({publishing: false, publishError: 'Couldn\'t reach Dimod'}); }
    }
    collab () { return window.dimodCollab || null; }
    attachCollab () {
        const collab = this.collab();
        if (!collab || collab === this.attachedCollab) return;
        if (this.offCollab) this.offCollab();
        this.attachedCollab = collab;
        this.offCollab = collab.addMessageListener(this.handleCollabMessage);
        collab.send('server-tab-state-request', {});
    }
    broadcastStateSoon () {
        clearTimeout(this.stateTimer);
        this.stateTimer = setTimeout(() => this.sendState(), STATE_BROADCAST_MS);
    }
    sendState () {
        clearTimeout(this.stateTimer);
        const collab = this.collab();
        if (!collab) return;
        this.flushCommit();
        const state = this.props.vm.runtime.dimodServer;
        if (state) collab.send('server-tab-state', {state, rev: this.rev, author: this.sessionId});
    }
    handleCollabMessage (msg) {
        switch (msg.type) {
        case 'joined':
            this.collab().send('server-tab-state-request', {});
            this.caretShared = false;
            this.sendCaretSoon();
            break;
        case 'server-tab-state-request':
            this.sendState();
            this.caretShared = false;
            this.sendCaretSoon();
            break;
        case 'server-tab-event':
        case 'server-tab-state':
        case 'server-tab-code-delta':
            this.remoteQueue.push(msg);
            this.flushRemote();
            break;
        case 'server-tab-caret':
            this.handleRemoteCaret(msg);
            break;
        case 'presence':
            this.pruneCarets(msg.users);
            break;
        case 'server-tab-published':
            this.loadPublished();
            break;
        default:
        }
    }
    remoteBusy (msg) {
        if (msg.type === 'server-tab-code-delta' || !this.workspace) return false;
        if (hasActiveGesture(this.workspace)) return true;
        if (msg.type !== 'server-tab-state' || !this.props.isVisible) return false;
        const ScratchBlocks = LazyScratchBlocks.get();
        return !!(ScratchBlocks.WidgetDiv && ScratchBlocks.WidgetDiv.isVisible());
    }
    flushRemote () {
        if (this.remoteTimer) return;
        while (this.remoteQueue.length) {
            const msg = this.remoteQueue[0];
            if (this.remoteBusy(msg)) {
                this.remoteTimer = setTimeout(() => { this.remoteTimer = null; this.flushRemote(); }, REMOTE_RETRY_MS);
                return;
            }
            this.remoteQueue.shift();
            if (msg.type === 'server-tab-event') this.applyRemoteEvent(msg);
            else if (msg.type === 'server-tab-state') this.applyRemoteState(msg);
            else this.applyRemoteCodeDelta(msg);
        }
    }
    flushLocalEvents () {
        const Events = LazyScratchBlocks.get().Events;
        if (typeof Events.fireNow_ === 'function') Events.fireNow_();
    }
    applyRemoteEvent (msg) {
        const json = msg.event;
        if (!this.workspace || this.live.mode !== 'blocks' || !json || typeof json !== 'object') return;
        const ScratchBlocks = LazyScratchBlocks.get();
        this.flushLocalEvents();
        const duplicate = json.type === 'create' && json.blockId && this.workspace.getBlockById(json.blockId);
        let applied = !!duplicate;
        if (!duplicate) {
            this.applyingRemote = true;
            ScratchBlocks.Events.disable();
            try { ScratchBlocks.Events.fromJson(json, this.workspace).run(true); applied = true; } catch (e) {
            } finally { ScratchBlocks.Events.enable(); this.applyingRemote = false; }
        }
        if (applied) this.rev = Math.max(this.rev, Number(msg.rev) || 0);
        this.scheduleCommit(false);
    }
    applyRemoteCodeDelta (msg) {
        if (this.live.mode !== 'code' || !msg.delta) return;
        const delta = msg.delta;
        let code;
        if (this.editor) {
            if (!deltaFits(this.model.getLinesContent(), delta)) return;
            const {start, end} = delta;
            this.settingValue = true;
            try {
                this.model.applyEdits([{
                    range: new monaco.Range(start.row + 1, start.column + 1, end.row + 1, end.column + 1),
                    text: delta.action === 'insert' ? delta.lines.join('\n') : ''
                }]);
            } catch (e) { return; } finally { this.settingValue = false; }
            this.prevText = this.model.getValue();
            code = this.prevText;
        } else {
            code = applyDeltaToText(this.live.code, delta);
            if (code === null) return;
        }
        this.rev = Math.max(this.rev, Number(msg.rev) || 0);
        this.setLive({code});
        const caret = this.carets[this.caretKey(msg)];
        if (caret) { caret.typingAt = Date.now(); caret.activeAt = caret.typingAt; }
        this.scheduleCommit(false);
    }
    applyRemoteState (msg) {
        const state = msg.state;
        if (!state || typeof state !== 'object' || typeof state.code !== 'string') return;
        const theirRev = Number(msg.rev) || 0;
        const author = typeof msg.author === 'string' ? msg.author : '';
        this.flushLocalEvents();
        this.flushCommit();
        const mine = {mode: this.live.mode, xml: this.currentXml(), code: this.live.code};
        const incoming = {mode: state.mode === 'code' ? 'code' : 'blocks', xml: typeof state.xml === 'string' ? state.xml : null, code: state.code};
        if (sameContent(mine, incoming)) { this.rev = Math.max(this.rev, theirRev); return; }
        const neverEdited = this.rev === 0 && !this.props.vm.runtime.dimodServer;
        if (neverEdited || theirRev > this.rev || (theirRev === this.rev && author > this.sessionId)) {
            this.rev = Math.max(this.rev, theirRev);
            this.adoptState(incoming);
            return;
        }
        if (theirRev === this.rev) this.rev += 1;
        this.broadcastStateSoon();
    }
    adoptState (next) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        this.props.vm.runtime.dimodServer = next;
        this.pendingXml = next.xml;
        this.setLive({mode: next.mode, code: next.code, showCode: next.mode === 'code' ? true : this.state.showCode}, () => this.syncEditor(true));
        if (this.workspace && next.xml && this.currentXml() !== next.xml) this.loadXml(next.xml);
    }
    caretKey (msg) { return `${msg.from}:${typeof msg.session === 'string' ? msg.session : ''}`; }
    sendCaretSoon () {
        if (this.caretSendTimer) return;
        const wait = Math.max(0, CARET_THROTTLE_MS - (Date.now() - this.lastCaretSentAt));
        this.caretSendTimer = setTimeout(() => { this.caretSendTimer = null; this.sendCaret(); }, wait);
    }
    sendCaret () {
        const collab = this.collab();
        if (!collab) return;
        this.lastCaretSentAt = Date.now();
        const shown = !!(this.editor && this.props.isVisible && this.live.mode === 'code');
        if (!shown) {
            if (this.caretShared) collab.send('server-tab-caret', {hidden: true, session: this.sessionId});
            this.caretShared = false;
            return;
        }
        const selection = this.editor.getSelection();
        const lead = selection.getPosition();
        collab.send('server-tab-caret', {
            session: this.sessionId,
            row: lead.lineNumber - 1,
            column: lead.column - 1,
            anchorRow: selection.selectionStartLineNumber - 1,
            anchorColumn: selection.selectionStartColumn - 1,
            focused: this.editor.hasTextFocus(),
            typing: Date.now() - this.lastTypedAt < TYPING_MS
        });
        this.caretShared = true;
    }
    handleRemoteCaret (msg) {
        if (!msg.from) return;
        const key = this.caretKey(msg);
        if (msg.hidden) { this.removeCaret(key); this.tickCarets(); return; }
        if (!isPoint(msg) || !isPoint({row: msg.anchorRow, column: msg.anchorColumn})) return;
        const now = Date.now();
        let caret = this.carets[key];
        if (!caret) {
            const color = colorForUserId(msg.from);
            caret = this.carets[key] = {
                key,
                userId: msg.from,
                username: typeof msg.fromUsername === 'string' ? msg.fromUsername : 'someone',
                color,
                typingAt: 0,
                activeAt: 0,
                node: null,
                flag: null,
                widget: null,
                decorations: []
            };
        }
        caret.row = msg.row;
        caret.column = msg.column;
        caret.anchorRow = msg.anchorRow;
        caret.anchorColumn = msg.anchorColumn;
        caret.focused = msg.focused !== false;
        caret.activeAt = now;
        if (msg.typing) caret.typingAt = now;
        this.placeCaret(caret);
        this.tickCarets();
        if (!this.caretTicker) this.caretTicker = setInterval(this.tickCarets, CARET_TICK_MS);
    }
    removeCaret (key) {
        const caret = this.carets[key];
        if (!caret) return;
        delete this.carets[key];
        if (caret.widget && this.editor) this.editor.removeContentWidget(caret.widget);
        this.clearCaretDecorations(caret);
    }
    pruneCarets (users) {
        if (!Array.isArray(users)) return;
        const here = new Set(users.map(u => u && u.userId));
        Object.keys(this.carets).forEach(key => {
            if (!here.has(this.carets[key].userId)) this.removeCaret(key);
        });
        this.tickCarets();
    }
    placeCaret (caret) {
        if (!this.editor) return;
        const model = this.model;
        const lead = model.validatePosition({lineNumber: caret.row + 1, column: caret.column + 1});
        const anchor = model.validatePosition({lineNumber: caret.anchorRow + 1, column: caret.anchorColumn + 1});
        const decorations = [{
            range: monaco.Range.fromPositions(lead, lead),
            options: {stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges}
        }];
        if (!lead.equals(anchor)) {
            decorations.push({
                range: monaco.Range.fromPositions(lead, anchor),
                options: {inlineClassName: selectionClassFor(caret.color)}
            });
        }
        caret.decorations = model.deltaDecorations(caret.decorations, decorations);
        if (!caret.widget) this.drawCaret(caret);
        this.editor.layoutContentWidget(caret.widget);
    }
    clearCaretDecorations (caret) {
        if (this.model && !this.model.isDisposed()) this.model.deltaDecorations(caret.decorations, []);
        caret.decorations = [];
    }
    drawCaret (caret) {
        const node = document.createElement('div');
        node.className = shared.remoteCaret;
        node.style.setProperty('--caret-color', caret.color);
        node.style.setProperty('--caret-text-color', contrastTextColor(caret.color));
        node.style.height = `${this.editor.getOption(monaco.editor.EditorOption.lineHeight)}px`;
        const flag = document.createElement('div');
        flag.className = shared.caretFlag;
        const name = document.createElement('span');
        name.textContent = caret.username;
        const dots = document.createElement('span');
        dots.className = shared.typingDots;
        dots.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
        flag.append(name, dots);
        node.appendChild(flag);
        caret.node = node;
        caret.flag = flag;
        caret.widget = {
            getId: () => `dimod.server.caret.${caret.key}`,
            getDomNode: () => node,
            getPosition: () => {
                const range = caret.decorations.length ? this.model.getDecorationRange(caret.decorations[0]) : null;
                return range ? {
                    position: range.getStartPosition(),
                    preference: [monaco.editor.ContentWidgetPositionPreference.EXACT]
                } : null;
            }
        };
        this.editor.addContentWidget(caret.widget);
    }
    renderCarets () {
        if (!this.editor) return;
        const now = Date.now();
        const ranges = this.editor.getVisibleRanges();
        const firstLine = ranges.length ? ranges[0].startLineNumber : 1;
        const showAny = this.live.mode === 'code';
        Object.values(this.carets).forEach(caret => {
            if (!caret.widget) return;
            this.editor.layoutContentWidget(caret.widget);
            const range = caret.decorations.length ? this.model.getDecorationRange(caret.decorations[0]) : null;
            caret.node.style.display = showAny ? '' : 'none';
            caret.node.className = classNames(
                shared.remoteCaret,
                {
                    [shared.remoteCaretTyping]: now - caret.typingAt < TYPING_MS,
                    [shared.remoteCaretActive]: now - caret.activeAt < CARET_ACTIVE_MS,
                    [shared.remoteCaretIdle]: !caret.focused
                }
            );
            caret.flag.className = classNames(shared.caretFlag, {
                [shared.caretFlagBelow]: range && range.startLineNumber <= firstLine
            });
        });
    }
    tickCarets () {
        const now = Date.now();
        const typing = [];
        Object.values(this.carets).forEach(caret => {
            if (now - caret.typingAt < TYPING_MS && !typing.includes(caret.username)) typing.push(caret.username);
        });
        if (typing.join('\n') !== this.state.typingNames.join('\n')) this.setState({typingNames: typing});
        this.renderCarets();
        if (!Object.keys(this.carets).length) { clearInterval(this.caretTicker); this.caretTicker = null; }
    }
    setEditorRef (el) { this.editorEl = el; }
    syncEditor (forceValue = false) {
        const codeVisible = this.live.mode === 'code' || this.state.showCode;
        if (!codeVisible || !this.editorEl) return;
        if (!monacoReady()) return loadMonaco().then(() => this.editorEl && this.syncEditor(true), () => {});
        if (!this.editor) {
            registerServerTypes();
            this.model = monaco.editor.createModel('', 'typescript', monaco.Uri.parse('file:///server/code.js'));
            this.model.setEOL(monaco.editor.EndOfLineSequence.LF);
            this.editor = monaco.editor.create(this.editorEl, {
                model: this.model,
                automaticLayout: true,
                minimap: {enabled: false},
                fixedOverflowWidgets: true,
                scrollBeyondLastLine: false,
                theme: monacoThemeName(),
                tabSize: 2
            });
            this.prevText = '';
            this.editor.onDidChangeModelContent(this.handleEditorChange);
            this.editor.onDidChangeCursorSelection(this.sendCaretSoon);
            this.editor.onDidFocusEditorText(this.sendCaretSoon);
            this.editor.onDidBlurEditorText(this.sendCaretSoon);
            this.editor.onDidScrollChange(this.renderCarets);
            forceValue = true;
        }
        this.editor.updateOptions({readOnly: this.live.mode !== 'code'});
        const value = this.live.code || (this.live.mode === 'code' ? '' : '// Add a "when … connects" or "when … sends" block to get started');
        if (forceValue || this.model.getValue() !== value) {
            const position = this.editor.getPosition();
            this.settingValue = true;
            try { this.model.setValue(value); } finally { this.settingValue = false; }
            this.prevText = this.model.getValue();
            if (position) this.editor.setPosition(this.model.validatePosition(position));
            Object.values(this.carets).forEach(caret => this.placeCaret(caret));
        }
        this.editor.layout();
        this.renderCarets();
    }
    handleEditorChange (e) {
        const before = this.prevText;
        this.prevText = this.model.getValue();
        if (this.settingValue || this.live.mode !== 'code') { this.renderCarets(); return; }
        this.rev += 1;
        this.lastTypedAt = Date.now();
        this.setLive({code: this.prevText});
        const collab = this.collab();
        if (collab) {
            e.changes.forEach(change => {
                const start = {row: change.range.startLineNumber - 1, column: change.range.startColumn - 1};
                const send = delta => collab.send('server-tab-code-delta', {delta, rev: this.rev, session: this.sessionId});
                if (change.rangeLength > 0) {
                    const lines = before.substr(change.rangeOffset, change.rangeLength).split('\n');
                    send({action: 'remove', start, end: endOf(start, lines), lines});
                }
                if (change.text) {
                    const lines = change.text.split('\n');
                    send({action: 'insert', start, end: endOf(start, lines), lines});
                }
            });
        }
        this.sendCaretSoon();
        this.renderCarets();
        this.scheduleCommit(true);
    }
    handleThemeChange () {
        if (monacoReady()) monaco.editor.setTheme(monacoThemeName());
    }
    handleToggleView () {
        if (this.live.mode === 'code') return;
        if (!this.state.showCode && this.workspace) this.setLive({code: generateServerCode(this.workspace)});
        this.setState(s => ({showCode: !s.showCode}));
    }
    async handleEditAsCode () {
        const agreed = await askConfirm(
            "You can't turn code back into blocks. Going back to blocks later throws the code changes away.",
            {title: 'Edit this as JavaScript?', ok: 'Edit as code', danger: true}
        );
        if (!agreed) return;
        const code = this.workspace ? generateServerCode(this.workspace) : this.live.code;
        this.rev += 1;
        this.setLive({mode: 'code', code, showCode: true}, () => {
            this.commit();
            if (this.editor) this.editor.focus();
        });
    }
    async handleBackToBlocks () {
        const agreed = await askConfirm('The JavaScript you wrote is thrown away.', {
            title: 'Go back to blocks?', ok: 'Go back to blocks', danger: true
        });
        if (!agreed) return;
        this.rev += 1;
        this.setLive({mode: 'blocks', showCode: false}, () => {
            if (this.workspace) this.commit();
        });
    }
    connectConsole () {
        if (this.consoleWs) return;
        clearTimeout(this.consoleRetry);
        const projectId = getParam('p');
        const token = getDimodToken();
        if (!projectId || !token) return;
        let base;
        if (WS_BASE) { const url = new URL(WS_BASE); base = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`; } else { base = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host; }
        let ws;
        try {
            ws = new WebSocket(`${base}/ws/game?project=${encodeURIComponent(projectId)}&mode=console&token=${encodeURIComponent(token)}`);
        } catch (e) { return; }
        this.consoleWs = ws;
        ws.onopen = () => this.setState({consoleConnected: true});
        ws.onmessage = event => {
            let msg;
            try { msg = JSON.parse(event.data); } catch (e) { return; }
            if (msg.method === 'logs') {
                this.setState({logs: msg.entries.slice(-MAX_LOG_LINES)}, () => this.scrollConsole());
            } else if (msg.method === 'log') {
                this.setState(s => ({
                    logs: [...s.logs, msg.entry].slice(-MAX_LOG_LINES),
                    unseenErrors: s.unseenErrors + (msg.entry.level === 'error' && !s.consoleOpen ? 1 : 0)
                }), () => this.scrollConsole());
            }
        };
        ws.onclose = event => {
            if (this.consoleWs !== ws) return;
            this.consoleWs = null;
            this.setState({consoleConnected: false});
            if (![4003, 4004, 4005].includes(event.code)) this.consoleRetry = setTimeout(() => this.connectConsole(), 5000);
        };
    }
    setConsoleRef (el) { this.consoleEl = el; }
    scrollConsole () {
        const el = this.consoleEl;
        if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 60) el.scrollTop = el.scrollHeight;
    }
    handleToggleConsole () {
        this.setState(s => ({consoleOpen: !s.consoleOpen, unseenErrors: 0}), () => {
            if (this.consoleEl) this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
            if (this.workspace && this.state.mode === 'blocks' && !this.state.showCode) LazyScratchBlocks.get().svgResize(this.workspace);
            if (this.editor) this.editor.layout();
        });
    }
    handleClearConsole (e) { e.stopPropagation(); this.setState({logs: []}); }
    renderLocked () {
        const {cloudLoaded, cost, balance, unlocking} = this.state;
        if (!cloudLoaded) return <div className={styles.lockedWrapper} />;
        return (
            <div className={styles.lockedWrapper}>
                <div className={styles.lockedCard}>
                    <div className={styles.lockedTitle}>{'Make this a cloud project'}</div>
                    <ul className={styles.lockedList}>
                        <li>{'Client blocks: send data, ask the server, ping'}</li>
                        <li>{'Server code for rounds, scores and checking what players send'}</li>
                        <li>{'A 50 MB database for saves and leaderboards'}</li>
                        <li>{'Cloud variables that hold text, up to 1 MB each'}</li>
                    </ul>
                    <div className={styles.lockedCost}>
                        <DitAmount amount={cost} />
                        {' once, for this project'}
                        {typeof balance === 'number' ? (
                            <span className={styles.lockedBalance}>
                                {' · you have '}
                                <DitAmount amount={balance} />
                            </span>
                        ) : null}
                    </div>
                    <button className={styles.lockedButton} disabled={unlocking} onClick={this.handleUnlock}>
                        {'Make it a cloud project'}
                    </button>
                </div>
            </div>
        );
    }
    renderToolbarButton ({icon, label, title, on, danger, disabled, onClick}) {
        return (
            <button
                aria-label={label}
                aria-pressed={on}
                className={classNames(on ? shared.iconButtonOn : shared.iconButton, danger ? shared.danger : null)}
                disabled={disabled}
                title={title}
                onClick={onClick}
            >
                {icon}
            </button>
        );
    }
    renderPreviewBanner () {
        const {cloudLoaded, cost, unlocking} = this.state;
        const viewing = !!getParam('view');
        return (
            <div className={styles.previewBanner}>
                <span className={styles.previewText}>
                    {viewing ?
                        'This runs on a pretend server in this tab, just for you.' :
                        'Preview: this runs on a pretend server in this tab, just for you. ' +
                        'Make it a cloud project to run it for every player.'}
                </span>
                {!viewing && cloudLoaded ? (
                    <button className={styles.previewButton} disabled={unlocking} onClick={this.handleUnlock}>
                        {'Make it a cloud project · '}
                        <DitAmount amount={cost} />
                    </button>
                ) : null}
            </div>
        );
    }
    renderToolbar (codeVisible, unpublished) {
        const {mode, showCode, typingNames, publishing, publishError} = this.state;
        return (
            <div className={shared.toolbar}>
                <span className={shared.toolbarTitle}>{'Server'}</span>
                {mode === 'code' && typingNames.length ? (
                    <span className={styles.typingIndicator}>{typingText(typingNames)}</span>
                ) : null}
                <span className={shared.toolbarSpacer} />
                {publishError ? <span className={styles.publishError}>{publishError}</span> : null}
                {mode === 'blocks' ? this.renderToolbarButton({
                    icon: <Icon src={codeIcon} />,
                    on: !showCode,
                    label: 'Blocks',
                    title: 'Blocks',
                    onClick: showCode ? this.handleToggleView : null
                }) : null}
                {mode === 'blocks' ? this.renderToolbarButton({
                    icon: <Icon src={bracesIcon} tint />,
                    on: showCode,
                    label: 'Show JavaScript',
                    title: 'Show the JavaScript your blocks make',
                    onClick: showCode ? null : this.handleToggleView
                }) : null}
                {mode === 'blocks' && showCode ? this.renderToolbarButton({
                    icon: <Icon src={bracesIcon} tint />,
                    danger: true,
                    label: 'Edit as code',
                    title: "Edit as code: write the JavaScript yourself (it can't be turned back into blocks)",
                    onClick: this.handleEditAsCode
                }) : null}
                {mode === 'code' ? this.renderToolbarButton({
                    icon: <Icon src={icons.stackBlock} tint />,
                    danger: true,
                    label: 'Go back to blocks',
                    title: 'Go back to blocks: the JavaScript you wrote is thrown away',
                    onClick: this.handleBackToBlocks
                }) : null}
                {this.state.isCloud ? <span className={shared.toolbarDivider} /> : null}
                {this.state.isCloud ? <button
                    className={shared.iconLabelButton}
                    disabled={publishing || !unpublished}
                    title={unpublished ?
                        'Publish changes: players and test sessions run the last published server code' :
                        'Published: players are running this code'}
                    onClick={this.handlePublish}
                >
                    {unpublished ? <Icon src={icons.save} tint /> : <Icon src={icons.success} />}
                    {publishing ? 'Publishing' : (unpublished ? 'Publish changes' : 'Published')}
                </button> : null}
            </div>
        );
    }
    renderConsoleBody () {
        const {logs} = this.state;
        if (!logs.length) {
            return (
                <div className={shared.logEmpty}>
                    {'Press the green flag to test. Anything your server code logs shows up here.'}
                </div>
            );
        }
        return logs.map((e, i) => (
            <div key={i} className={classNames(styles.logLine, styles[e.level])}>
                <span className={styles.logTime}>{fmtTime(e.t)}</span>
                {e.room === 'live' ? <span className={styles.liveTag}>{'live'}</span> : null}
                {e.name && e.name !== 'default' ? <span className={styles.roomTag}>{e.name}</span> : null}
                <span className={styles.logText}>{e.text}</span>
            </div>
        ));
    }
    render () {
        const preview = !this.state.isCloud;
        const {mode, showCode, consoleOpen, unseenErrors, consoleConnected, drawerTab} = this.state;
        const {code, publishedCode} = this.state;
        const codeVisible = mode === 'code' || showCode;
        const unpublished = publishedCode === null || code !== publishedCode;
        return (
            <div className={styles.serverTab}>
                {this.renderToolbar(codeVisible, unpublished)}
                {preview ? this.renderPreviewBanner() : null}
                <div className={styles.workspaceArea} onMouseDownCapture={this.reclaimMainWorkspace}>
                    <div className={classNames(styles.blocks, {[styles.hidden]: mode === 'code'})} ref={this.setBlocksRef} />
                    <div className={classNames(styles.codeView, {[styles.codeViewHidden]: !codeVisible})}>
                        <div className={styles.editor} ref={this.setEditorRef} />
                    </div>
                </div>
                <div
                    className={classNames(shared.logPane, {
                        [styles.logPaneClosed]: !consoleOpen,
                        [styles.logPaneTall]: consoleOpen && drawerTab === 'db'
                    })}
                >
                    <div
                        className={classNames(shared.logHeader, styles.logHeader)}
                        title={consoleOpen ? 'Hide the console' : 'Show the console'}
                        onClick={this.handleToggleConsole}
                    >
                        <span
                            className={classNames(styles.dot, {[styles.dotOn]: consoleConnected || preview})}
                            title={preview ? 'The pretend server in this tab' :
                                (consoleConnected ? 'Connected to the game server' : 'Not connected')}
                        />
                        <button
                            className={drawerTab === 'console' ? shared.logTabActive : shared.logTab}
                            onClick={e => { if (consoleOpen) e.stopPropagation(); this.setState({drawerTab: 'console'}); }}
                        >
                            <Icon src={icons.terminal} />
                            {'Console'}
                        </button>
                        {preview ? null : <button
                            className={drawerTab === 'db' ? shared.logTabActive : shared.logTab}
                            onClick={e => { if (consoleOpen) e.stopPropagation(); this.setState({drawerTab: 'db'}); }}
                        >
                            <Icon src={databaseIcon} tint />
                            {'Database'}
                        </button>}
                        {unseenErrors ? <span className={styles.errorBadge}>{unseenErrors}</span> : null}
                        <span className={shared.toolbarSpacer} />
                        {consoleOpen && drawerTab === 'console' ? (
                            <button
                                aria-label="Clear the console"
                                className={shared.logClear}
                                title="Clear the console"
                                onClick={this.handleClearConsole}
                            >
                                <Icon src={icons.trash} tint />
                            </button>
                        ) : null}
                    </div>
                    {consoleOpen && drawerTab === 'db' && !preview ? (
                        <DimodServerDb projectId={getParam('p')} />
                    ) : null}
                    {consoleOpen && drawerTab === 'console' ? (
                        <div className={shared.logBody} ref={this.setConsoleRef}>
                            {this.renderConsoleBody()}
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }
}
DimodServerTab.propTypes = {
    basePath: PropTypes.string,
    isRtl: PropTypes.bool,
    isVisible: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired
};
DimodServerTab.defaultProps = {basePath: './'};
export {DimodServerDb, DimodServerTab};
