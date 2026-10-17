import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import {connect} from 'react-redux';
import styles from '../components/menu-bar/menu-bar.css';
import Button from '../components/button/button.jsx';
import Box from '../components/box/box.jsx';
import Modal from '../containers/modal.jsx';
import promptStyles from '../components/prompt/prompt.css';
import shareButtonStyles from '../components/menu-bar/share-button.css';
import {setProjectUnchanged} from '../reducers/project-changed';
import log from './log';
import {
    getSaveHealth,
    getUnsavedEditCount,
    attachEditClock,
    hasUnsavedLocalEdits,
    getLastLocalEditAt,
    getLocalEditSeq,
    setSaveHealth,
    markSavedThrough,
    touchRecentProject,
    referencedAssetNames,
    totalSize,
    zipFiles,
    captureProjectFiles,
    captureProjectFilesSync,
    jsonPatchFor,
    buildJsonDiff,
    manifestFor,
    manifestsEqual,
    missingReferencedAssets,
    projectCache,
    getSeeInsideId,
    getDimodToken,
    loadSeeInside,
    remixSeenProject
} from './dimod-project';
import RestorePointAPI from './tw-restore-point-api';
import {colorForUserId} from './dimod-collab';
import {getDefaultPfp, askConfirm, askAlert, showErrorToast} from './dimod-ui';
import {unsaveableProjectReason} from './dimod-vm';
import styles$1 from './dimod-see-inside-bar.css';
import VM from 'scratch-vm';
import {addDimodLibraryItem} from './dimod-assets';
const LOOK = {
    saved: {color: '#2ecc71', label: 'Saved'},
    saving: {color: '#f0ad4e', label: 'Saving…', pulse: true},
    unsaved: {color: '#f0ad4e', label: 'Unsaved'},
    retrying: {color: '#e67e22', label: 'Retrying', pulse: true},
    conflict: {color: '#e74c3c', label: 'Resolving'},
    offline: {color: '#95a5a6', label: 'Offline, will save when back'}
};
class DimodSavePill extends React.Component {
    constructor (props) {
        super(props);
        this.state = {unsaved: getUnsavedEditCount(), health: getSaveHealth()};
        this.refresh = this.refresh.bind(this);
    }
    componentDidMount () {
        this._timer = setInterval(this.refresh, 700);
        window.addEventListener('dimod:save-health', this.refresh);
    }
    componentWillUnmount () { clearInterval(this._timer); window.removeEventListener('dimod:save-health', this.refresh); }
    refresh () {
        const unsaved = getUnsavedEditCount();
        const health = getSaveHealth();
        if (unsaved !== this.state.unsaved || health !== this.state.health) this.setState({unsaved, health});
    }
    render () {
        const {unsaved, health} = this.state;
        let key = 'saved';
        if (health === 'saving') key = 'saving';
        else if (health === 'retrying') key = 'retrying';
        else if (health === 'conflict') key = 'conflict';
        else if (health === 'offline') key = 'offline';
        else if (unsaved > 0) key = 'unsaved';
        const look = LOOK[key];
        const label = key === 'unsaved' || key === 'retrying' ?
            `${look.label} (${unsaved} edit${unsaved === 1 ? '' : 's'})` : look.label;
        const info = this.props.buildInfo;
        return (
            <span
                title={`${label}${info ? `\nBuild ${info.studio} / paint ${info.paint} (${info.builtAt})` : ''}`}
                style={{display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', userSelect: 'none'}}
            >
                <span
                    style={{
                        width: 8, height: 8, flex: 'none', borderRadius: '50%', background: look.color,
                        boxShadow: '0 0 0 2px rgba(255,255,255,0.35)', opacity: look.pulse ? 0.7 : 1
                    }}
                />
                {this.props.children}
            </span>
        );
    }
}
DimodSavePill.propTypes = {
    buildInfo: PropTypes.shape({studio: PropTypes.string, paint: PropTypes.string, builtAt: PropTypes.string}),
    children: PropTypes.node
};
const STATUS_TEXT = {'added-since': 'added after this save', 'removed-since': 'deleted since this save', changed: 'changed'};
const thumbStyle = {
    width: 44, height: 44, objectFit: 'contain', background: '#fff', borderRadius: 4,
    border: '1px solid rgba(0,0,0,0.2)'
};
class Thumb extends React.Component {
    constructor (props) { super(props); this.state = {url: null, failed: false}; }
    componentDidMount () {
        const {apiBase, projectId, snapshotId, md5ext, headers} = this.props;
        fetch(`${apiBase}/projects/${projectId}/source/history/${snapshotId}/asset/${md5ext}`, {headers})
            .then(r => (r.ok ? r.blob() : Promise.reject(new Error('missing'))))
            .then(blob => {
                if (this._gone) return;
                this._objectUrl = URL.createObjectURL(blob);
                this.setState({url: this._objectUrl});
            })
            .catch(() => !this._gone && this.setState({failed: true}));
    }
    componentWillUnmount () {
        this._gone = true;
        if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);
    }
    render () {
        const {url, failed} = this.state;
        return (
            <div style={{display: 'inline-block', textAlign: 'center', margin: '0 6px 6px 0', maxWidth: 96}}>
                {url ? (
                    <img src={url} style={thumbStyle} alt={this.props.label} />
                ) : (
                    <div style={{...thumbStyle, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                        {failed ? '?' : '…'}
                    </div>
                )}
                <div
                    style={{fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}
                >{this.props.label}</div>
            </div>
        );
    }
}
Thumb.propTypes = {
    apiBase: PropTypes.string,
    headers: PropTypes.shape({}),
    label: PropTypes.string,
    md5ext: PropTypes.string,
    projectId: PropTypes.string,
    snapshotId: PropTypes.string
};
class DimodHistoryPreview extends React.Component {
    constructor (props) { super(props); this.state = {diff: null, error: null}; }
    componentDidMount () {
        const {apiBase, projectId, snapshotId, headers} = this.props;
        fetch(`${apiBase}/projects/${projectId}/source/history/${snapshotId}/diff`, {headers})
            .then(r => r.json().then(body => (r.ok ? body : Promise.reject(new Error(body.error || 'failed')))))
            .then(diff => !this._gone && this.setState({diff}))
            .catch(e => !this._gone && this.setState({error: e.message}));
    }
    componentWillUnmount () { this._gone = true; }
    render () {
        const {diff, error} = this.state;
        const {apiBase, projectId, snapshotId, headers} = this.props;
        const box = {padding: '6px 10px', margin: '0 0 8px 24px', borderLeft: '3px solid #ff8c1a', fontSize: 12};
        if (error) return <div style={box}>{`Couldn't load a preview: ${error}`}</div>;
        if (!diff) return <div style={box}>{'Comparing with the current save…'}</div>;
        if (diff.sprites.length === 0) return <div style={box}>{'Identical to the current save.'}</div>;
        return (
            <div style={box}>
                <div style={{opacity: 0.7, marginBottom: 4}}>
                    {'Compared with the current save. Restoring this would bring back the left side.'}
                </div>
                {diff.sprites.map(sp => (
                    <div key={sp.name} style={{marginBottom: 8}}>
                        <div style={{fontWeight: 'bold'}}>
                            {`${sp.name}... ${STATUS_TEXT[sp.status] || sp.status}`}
                            {sp.blocksChanged ? ` · scripts differ (${sp.blockDelta >= 0 ? '+' : ''}${sp.blockDelta} blocks now)` : ''}
                            {sp.soundsChanged ? ' · sounds differ' : ''}
                        </div>
                        {sp.costumes.map(c => (
                            <span key={`${c.name}-${c.status}`}>
                                <Thumb
                                    apiBase={apiBase}
                                    projectId={projectId}
                                    snapshotId={c.side === 'current' ? 'current' : snapshotId}
                                    md5ext={c.md5ext}
                                    headers={headers}
                                    label={`${c.name} (${c.status === 'changed' ? 'then' : STATUS_TEXT[c.status]})`}
                                />
                                {c.status === 'changed' ? (
                                    <Thumb
                                        apiBase={apiBase}
                                        projectId={projectId}
                                        snapshotId="current"
                                        md5ext={c.currentMd5ext}
                                        headers={headers}
                                        label={`${c.name} (now)`}
                                    />
                                ) : null}
                            </span>
                        ))}
                    </div>
                ))}
            </div>
        );
    }
}
DimodHistoryPreview.propTypes = {
    apiBase: PropTypes.string,
    headers: PropTypes.shape({}),
    projectId: PropTypes.string,
    snapshotId: PropTypes.string
};
const API_BASE = process.env.DIMOD_API_BASE;
const buttonClass = (...extra) => classNames(styles.menuBarButton, shareButtonStyles.shareButton, ...extra);
const collabDot = {display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0};
const collabAvatarStack = {
    display: 'flex',
    alignItems: 'center',
    marginLeft: '.2rem',
    paddingLeft: '.5rem',
    borderLeft: '1px solid rgba(255,255,255,0.3)'
};
const collabAvatarDot = {
    width: 20,
    height: 20,
    borderRadius: '50%',
    borderWidth: 2,
    borderStyle: 'solid',
    boxSizing: 'border-box',
    objectFit: 'cover',
    background: '#222',
    filter: 'none',
    marginLeft: -6,
    flexShrink: 0
};
const avatarSrc = u => u.avatarUrl || getDefaultPfp(u.username || '');
const avatarFail = u => e => { const d = getDefaultPfp(u.username || ''); if (e.currentTarget.src !== d) e.currentTarget.src = d; };
const membersModalRow = {display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.35rem 0'};
const membersModalAvatar = {
    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
    borderWidth: 2, borderStyle: 'solid', boxSizing: 'border-box', objectFit: 'cover', background: '#222'
};
const collabToggleRow = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
    marginTop: '.75rem', paddingTop: '.75rem', borderTop: '1px solid rgba(128, 128, 128, 0.3)', cursor: 'pointer'
};
const collabSwitch = on => ({
    position: 'relative', flexShrink: 0, width: 36, height: 20, borderRadius: 10,
    background: on ? '#3fb950' : 'rgba(128, 128, 128, 0.5)', transition: 'background .15s'
});
const collabSwitchKnob = on => ({
    position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%',
    background: '#fff', transition: 'left .15s'
});
const historyRow = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '.75rem',
    padding: '.4rem 0',
    borderBottom: '1px solid rgba(0,0,0,0.1)'
};
const historyRowInfo = {fontSize: '0.8rem'};
const historyOneLine = {whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'};
const historyRowButton = {fontSize: '0.75rem', padding: '.2rem .5rem', height: 'auto', flexShrink: 0, whiteSpace: 'nowrap'};
const historyRowMeta = {opacity: 0.65, fontSize: '0.75rem'};
const formatSize = bytes => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${bytes}B`;
};
const formatRelativeTime = isoString => {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
};
const formatExactTime = isoString => new Date(isoString).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
});
const buildSaveDiff = (files, manifest, previousManifest, {allowEmpty = false, force = false} = {}) => {
    const changed = Object.keys(manifest).filter(f => manifest[f] !== previousManifest[f]);
    const referenced = referencedAssetNames(files);
    const removed = Object.keys(previousManifest)
        .filter(f => !(f in manifest))
        .filter(f => !referenced || !referenced.has(f));
    if (!allowEmpty && changed.length === 0 && removed.length === 0) return null;
    const changedSize = changed.reduce((sum, f) => sum + files[f].length, 0);
    if (!force && changedSize > totalSize(files) * 0.8) return null;
    const patch = {'__dimod_diff_manifest.json': new TextEncoder().encode(JSON.stringify({removed, changed}))};
    for (const f of changed) patch[f] = files[f];
    return zipFiles(patch);
};
const MAX_EDGE_UPLOAD_BYTES = 100 * 1024 * 1024;
const AUTO_SAVE_DEBOUNCE_MS = 3000;
const AUTO_SAVE_MAX_INTERVAL_MS = 15000;
const KEEPALIVE_MAX_BYTES = 60000;
const ONWARD_SAVE_THROTTLE_MS = 2500;
const SAVE_DEFERRED = 'deferred';
const DRAFT_INTERVAL_MS = 60000;
const SAVE_SCALE_FREE_MB = 5;
const SAVE_SCALE_PER_MB = 15;
const SAVE_SCALE_MAX = 6;
const ONWARD_SCALE_MAX = 3;
const getParam = name => new URLSearchParams(location.search).get(name);
const authHeaders = () => {
    const token = localStorage.getItem('token');
    return token ? {Authorization: `Bearer ${token}`} : {};
};
const decodeMyToken = () => {
    try {
        const token = localStorage.getItem('token');
        const payload = token.split('.')[1];
        const json = decodeURIComponent(escape(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))));
        return JSON.parse(json);
    } catch (e) { return {}; }
};
const getMyUsername = () => decodeMyToken().username || null;
const JOIN_CHECK_DELAY_MS = 5000;
const getMyUserId = () => decodeMyToken().userId || null;
const isCollabDisabled = () => localStorage.getItem('dimod-collab-disabled') === '1';
const toggleCollabDisabled = () => {
    localStorage.setItem('dimod-collab-disabled', isCollabDisabled() ? '0' : '1');
    location.reload();
};
const isAutosaveOff = () => {
    try { return localStorage.getItem('dimod-autosave-off') === '1'; } catch (e) { return false; }
};
const COLLAB_STATUS_INFO = {
    disabled: {color: '#8b949e', label: 'Collab off', pulse: false},
    connecting: {color: '#f0ad4e', label: 'Connecting…', pulse: true},
    reconnecting: {color: '#f0ad4e', label: 'Reconnecting…', pulse: true},
    connected: {color: '#3fb950', label: 'Live', pulse: false},
    forbidden: {color: '#e5534b', label: "Can't collaborate here", pulse: false},
    error: {color: '#e5534b', label: 'Collab offline', pulse: false},
    'rate-limited': {color: '#f0ad4e', label: 'Slowing down…', pulse: true},
    'room-full': {color: '#f0ad4e', label: 'Room is full... waiting for a spot…', pulse: true}
};
class DimodToolbar extends React.Component {
    constructor (props) {
        super(props);
        this.state = {
            saveStatus: 'idle',
            saveProgress: 0,
            publishStatus: 'idle',
            publishProgress: 0,
            collabStatus: isCollabDisabled() ? 'disabled' : 'connecting',
            autosaveOff: isAutosaveOff(),
            moreOpen: false,
            collabUsers: [],
            membersModalOpen: false,
            historyModalOpen: false,
            templatesOpen: false,
            templates: null,
            templateError: '',
            applyingTemplate: null,
            historyEntries: null,
            historyError: null,
            restoringId: null,
            renamingId: null,
            renamingText: '',
            saveNameModalOpen: false,
            saveNameInput: '',
            saveNameAction: 'save',
            historyTab: 'manual',
            selectedIds: [],
            deletingId: null,
            bulkDeleting: false
        };
        this.performSave = this.performSave.bind(this);
        this.performPublish = this.performPublish.bind(this);
        this.performFirstPublish = this.performFirstPublish.bind(this);
        this.handleGoOutside = this.handleGoOutside.bind(this);
        this.handleCollabStatusChange = this.handleCollabStatusChange.bind(this);
        this.handleCollabPresenceUpdate = this.handleCollabPresenceUpdate.bind(this);
        this.handleRemoteSourceRestored = this.handleRemoteSourceRestored.bind(this);
        this.handleOpenMembersModal = this.handleOpenMembersModal.bind(this);
        this.handleCloseMembersModal = this.handleCloseMembersModal.bind(this);
        this.handleOpenHistoryModal = this.handleOpenHistoryModal.bind(this);
        this.handleOpenTemplates = this.handleOpenTemplates.bind(this);
        this.handleApplyTemplate = this.handleApplyTemplate.bind(this);
        this.handleCloseHistoryModal = this.handleCloseHistoryModal.bind(this);
        this.attachCollabListeners = this.attachCollabListeners.bind(this);
        this.attachVmListener = this.attachVmListener.bind(this);
        this.handleProjectChanged = this.handleProjectChanged.bind(this);
        this.handleAutoSave = this.handleAutoSave.bind(this);
        this.handleToggleAutosave = this.handleToggleAutosave.bind(this);
        this.handleToolbarAction = this.handleToolbarAction.bind(this);
        this.handleMoreOutside = this.handleMoreOutside.bind(this);
        this.setMoreRoot = el => { this.moreRoot = el; };
        this.handleOnwardSave = this.handleOnwardSave.bind(this);
        this.handleStartRename = this.handleStartRename.bind(this);
        this.handleRenameChange = this.handleRenameChange.bind(this);
        this.handleCancelRename = this.handleCancelRename.bind(this);
        this.handleSubmitRename = this.handleSubmitRename.bind(this);
        this.handleSaveClick = this.handleSaveClick.bind(this);
        this.handleSaveNow = this.handleSaveNow.bind(this);
        this.handleSaveNewClick = this.handleSaveNewClick.bind(this);
        this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
        this.handlePageHide = this.handlePageHide.bind(this);
        this.handleOnline = this.handleOnline.bind(this);
        this.handlePublishClick = this.handlePublishClick.bind(this);
        this.handlePlaytestClick = this.handlePlaytestClick.bind(this);
        this.handleSaveNameInputChange = this.handleSaveNameInputChange.bind(this);
        this.handleCloseSaveNameModal = this.handleCloseSaveNameModal.bind(this);
        this.handleConfirmSaveName = this.handleConfirmSaveName.bind(this);
        this.handleHistoryTabChange = this.handleHistoryTabChange.bind(this);
        this.handleToggleSelect = this.handleToggleSelect.bind(this);
        this.handleToggleSelectAll = this.handleToggleSelectAll.bind(this);
        this.handleDeleteSnapshot = this.handleDeleteSnapshot.bind(this);
        this.handleBulkDelete = this.handleBulkDelete.bind(this);
        this.checkJoinFreshness = this.checkJoinFreshness.bind(this);
        this._knownUserIds = new Set();
        this._lastSavedManifest = null;
        this._jcrcs = null;
        this._lastSavedRevision = null;
        this._lastSavedSize = null;
        this._autoSaveInFlight = false;
    }
    componentDidMount () {
        window.addEventListener('beforeunload', this.handleBeforeUnload);
        window.addEventListener('pagehide', this.handlePageHide);
        window.addEventListener('online', this.handleOnline);
        document.addEventListener('visibilitychange', this.handlePageHide);
        window.addEventListener('dimod:toolbar-action', this.handleToolbarAction);
        document.addEventListener('mousedown', this.handleMoreOutside);
        document.addEventListener('keydown', this.handleMoreOutside);
        this.loadBuildInfo();
        this._draftTimer = setInterval(() => this.writeUnsavedDraft(), DRAFT_INTERVAL_MS);
        setTimeout(() => this.checkForLeftoverDraft(), 8000);
        setTimeout(() => this.touchRecent({opened: true}), 3000);
        this.attachCollabListeners();
        this.attachVmListener();
        this.fetchCurrentRevision();
    }
    componentWillUnmount () {
        window.removeEventListener('beforeunload', this.handleBeforeUnload);
        window.removeEventListener('pagehide', this.handlePageHide);
        window.removeEventListener('online', this.handleOnline);
        document.removeEventListener('visibilitychange', this.handlePageHide);
        window.removeEventListener('dimod:toolbar-action', this.handleToolbarAction);
        document.removeEventListener('mousedown', this.handleMoreOutside);
        document.removeEventListener('keydown', this.handleMoreOutside);
        clearInterval(this._draftTimer);
        window.removeEventListener('dimod:collab-ready', this.attachCollabListeners);
        window.removeEventListener('dimod:vm-ready', this.attachVmListener);
        if (this._collab) {
            if (this._collab.onStatusChange === this.handleCollabStatusChange) this._collab.onStatusChange = null;
            if (this._collab.onPresenceUpdate === this.handleCollabPresenceUpdate) this._collab.onPresenceUpdate = null;
            if (this._collab.onSourceRestored === this.handleRemoteSourceRestored) this._collab.onSourceRestored = null;
        }
        if (window.dimodCollabUsers === this.state.collabUsers) window.dimodCollabUsers = null;
        if (window.vm) window.vm.removeListener('PROJECT_CHANGED', this.handleProjectChanged);
        clearTimeout(this._autoSaveTimeout);
        clearTimeout(this._autoSaveMaxTimeout);
        clearTimeout(this._onwardSaveTimeout);
        clearTimeout(this._autoSaveRetryTimeout);
        clearTimeout(this._joinCheckTimeout);
        clearTimeout(this._collabStatusDebounce);
        clearTimeout(this._cacheStoreTimeout);
    }
    fetchCurrentRevision () {
        const projectId = getParam('p');
        if (!projectId) return;
        fetch(`${API_BASE}/projects/${projectId}/source`, {headers: authHeaders(), cache: 'no-store'})
            .then(res => {
                if (res.status === 404) this._revisionKnown = true;
                return res.ok ? res.json() : null;
            })
            .then(data => {
                if (data && Number.isInteger(data.revision)) {
                    this._lastSavedRevision = data.revision;
                    this._revisionKnown = true;
                }
            })
            .catch(() => {
            });
    }
    attachVmListener () {
        if (window.vm) { attachEditClock(window.vm); window.vm.on('PROJECT_CHANGED', this.handleProjectChanged); return; }
        window.addEventListener('dimod:vm-ready', this.attachVmListener, {once: true});
    }
    saveIntervalScale (cap) {
        const mb = (this._lastSavedSize || 0) / (1024 * 1024);
        if (!(mb > SAVE_SCALE_FREE_MB)) return 1;
        return Math.min(cap, 1 + ((mb - SAVE_SCALE_FREE_MB) / SAVE_SCALE_PER_MB));
    }
    handleProjectChanged () {
        if (!getParam('p')) return;
        if (!this._recentUnsaved && window.vm && window.vm.__dimodProjectFullyLoaded) {
            this._recentUnsaved = true;
            this.touchRecent({unsaved: true});
        }
        if (this.state.collabUsers.length > 0) {
            clearTimeout(this._autoSaveTimeout);
            clearTimeout(this._autoSaveMaxTimeout);
            this._autoSaveMaxTimeout = null;
            clearTimeout(this._onwardSaveTimeout);
            this._onwardSaveTimeout = setTimeout(
                this.handleOnwardSave, ONWARD_SAVE_THROTTLE_MS * this.saveIntervalScale(ONWARD_SCALE_MAX));
            return;
        }
        clearTimeout(this._onwardSaveTimeout);
        clearTimeout(this._autoSaveTimeout);
        if (this.state.autosaveOff) return;
        this._autoSaveTimeout = setTimeout(this.handleAutoSave, AUTO_SAVE_DEBOUNCE_MS * this.saveIntervalScale(SAVE_SCALE_MAX));
        if (!this._autoSaveMaxTimeout) {
            this._autoSaveMaxTimeout = setTimeout(
                this.handleAutoSave, AUTO_SAVE_MAX_INTERVAL_MS * this.saveIntervalScale(SAVE_SCALE_MAX));
        }
    }
    handleToolbarAction (e) {
        const busy = this.state.saveStatus === 'busy' || this.state.publishStatus === 'busy';
        const act = {
            save: () => !busy && this.handleSaveClick(),
            publish: () => !busy && this.handlePublishClick(),
            playtest: () => !busy && this.handlePlaytestClick(),
            history: this.handleOpenHistoryModal,
            templates: this.handleOpenTemplates,
            outside: this.handleGoOutside,
            autosave: this.handleToggleAutosave
        }[e.detail];
        if (act) act();
    }
    handleMoreOutside (e) {
        if (!this.state.moreOpen) return;
        if (e.type === 'keydown' ? e.key === 'Escape' : !(this.moreRoot && this.moreRoot.contains(e.target))) {
            this.setState({moreOpen: false});
        }
    }
    handleToggleAutosave () {
        const off = !this.state.autosaveOff;
        try { localStorage.setItem('dimod-autosave-off', off ? '1' : '0'); } catch (e) {
        }
        this.setState({autosaveOff: off}, () => {
            if (off) {
                clearTimeout(this._autoSaveTimeout);
                clearTimeout(this._autoSaveMaxTimeout);
                this._autoSaveMaxTimeout = null;
                clearTimeout(this._autoSaveRetryTimeout);
            } else if (hasUnsavedLocalEdits()) { this.handleAutoSave(); }
        });
    }
    handleAutoSave () {
        clearTimeout(this._autoSaveMaxTimeout);
        this._autoSaveMaxTimeout = null;
        if (this.state.autosaveOff) return;
        if (!window.vm || !window.vm.__dimodProjectFullyLoaded) return;
        if (this.state.saveStatus === 'busy' || this.state.publishStatus === 'busy' || this._autoSaveInFlight) {
            this._autoSaveTimeout = setTimeout(
                this.handleAutoSave, AUTO_SAVE_DEBOUNCE_MS * this.saveIntervalScale(SAVE_SCALE_MAX));
            return;
        }
        this.performSave({isAuto: true});
    }
    handleOnwardSave () {
        clearTimeout(this._autoSaveTimeout);
        clearTimeout(this._autoSaveMaxTimeout);
        this._autoSaveMaxTimeout = null;
        clearTimeout(this._onwardSaveTimeout);
        if (!window.vm || !window.vm.__dimodProjectFullyLoaded) return;
        if (this.state.saveStatus === 'busy' || this.state.publishStatus === 'busy' || this._autoSaveInFlight) {
            this._onwardSaveTimeout = setTimeout(() => this.handleOnwardSave(), 1000);
            return;
        }
        this.performSave({isAuto: true, label: 'Onward save'});
    }
    attachCollabListeners () {
        if (window.dimodCollab) {
            this._collab = window.dimodCollab;
            this._collab.onStatusChange = this.handleCollabStatusChange;
            this._collab.onPresenceUpdate = this.handleCollabPresenceUpdate;
            this._collab.onSourceRestored = this.handleRemoteSourceRestored;
            this.setState({collabStatus: this._collab.status});
        } else { window.addEventListener('dimod:collab-ready', this.attachCollabListeners, {once: true}); }
    }
    handleCollabStatusChange (status) {
        clearTimeout(this._collabStatusDebounce);
        const TRANSIENT_STATUSES = ['connecting', 'reconnecting'];
        if (TRANSIENT_STATUSES.includes(status) && this.state.collabStatus !== status) {
            this._collabStatusDebounce = setTimeout(() => { this.setState({collabStatus: status}); }, 600);
            return;
        }
        this.setState({collabStatus: status});
    }
    handleRemoteSourceRestored () {
        window.dispatchEvent(new CustomEvent('dimod:system-message', {
            detail: {text: 'A collaborator restored a previous version... resyncing...'}
        }));
        window.dispatchEvent(new CustomEvent('dimod:project-resync-needed'));
    }
    handleCollabPresenceUpdate (users) {
        const myId = getMyUserId();
        const incomingIds = new Set(users.map(u => u.userId));
        if (this._knownUserIds.size > 0) {
            const hasNewJoiner = users.some(u => u.userId !== myId && !this._knownUserIds.has(u.userId));
            if (hasNewJoiner) this.handleOnwardSave();
        } else if (users.some(u => u.userId !== myId)) {
            this._joinChecks = 0;
            clearTimeout(this._joinCheckTimeout);
            this._joinCheckTimeout = setTimeout(this.checkJoinFreshness, JOIN_CHECK_DELAY_MS);
        }
        this._knownUserIds = incomingIds;
        window.dimodCollabUsers = users;
        window.dispatchEvent(new CustomEvent('dimod:collab-users'));
        this.setState({collabUsers: users});
    }
    checkJoinFreshness () {
        const projectId = getParam('p');
        const vm = window.vm;
        if (!projectId || !vm) return;
        this._joinChecks = (this._joinChecks || 0) + 1;
        if (!vm.__dimodProjectFullyLoaded) {
            if (this._joinChecks < 30) this._joinCheckTimeout = setTimeout(this.checkJoinFreshness, 1000);
            return;
        }
        const loaded = window.dimodLoadedSource;
        if (!loaded || loaded.projectId !== projectId) return;
        const seq0 = getLocalEditSeq();
        fetch(`${API_BASE}/projects/${projectId}/source`, {headers: authHeaders(), cache: 'no-store'})
            .then(res => (res.ok ? res.json() : null))
            .then(data => {
                if (!data || !Number.isInteger(data.revision)) return;
                if (data.revision === loaded.revision || data.revision === this._lastSavedRevision) return;
                if (hasUnsavedLocalEdits() || getLocalEditSeq() !== seq0 || Date.now() - getLastLocalEditAt() < 10000) return;
                window.dispatchEvent(new CustomEvent('dimod:system-message', {
                    detail: {text: 'Picking up your collaborators\' latest changes...'}
                }));
                window.dispatchEvent(new CustomEvent('dimod:project-resync-needed'));
            })
            .catch(() => {
            });
    }
    handleOpenMembersModal () { this.setState({membersModalOpen: true}); }
    handleCloseMembersModal () { this.setState({membersModalOpen: false}); }
    handleOpenTemplates () {
        this.setState({templatesOpen: true, templateError: ''});
        fetch(`${API_BASE}/examples`)
            .then(res => res.json())
            .then(list => this.setState({templates: Array.isArray(list) ? list : []}))
            .catch(() => this.setState({templates: [], templateError: 'Could not load templates'}));
    }
    async handleApplyTemplate (t) {
        const agreed = await askConfirm('Your current draft is kept in History.', {
            title: `Start over from "${t.name}"?`, ok: 'Start over'
        });
        if (!agreed) return;
        this.setState({applyingTemplate: t.slug, templateError: ''});
        fetch(`${API_BASE}/projects/${getParam('p')}/source/from-example/${encodeURIComponent(t.slug)}`, {
            method: 'POST',
            headers: authHeaders()
        })
            .then(async res => {
                if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not use that template');
                window.dispatchEvent(new CustomEvent('dimod:project-resync-needed'));
                this.setState({applyingTemplate: null, templatesOpen: false});
            })
            .catch(err => this.setState({applyingTemplate: null, templateError: err.message}));
    }
    renderTemplatesModal () {
        if (!this.state.templatesOpen) return null;
        const {templates, templateError, applyingTemplate} = this.state;
        return (
            <Modal
                id="dimodTemplates"
                contentLabel="Templates"
                className={promptStyles.modalContent}
                onRequestClose={() => this.setState({templatesOpen: false})}
            >
                <Box className={promptStyles.body}>
                    {templateError ? <div style={{color: '#d33', marginBottom: '.5rem'}}>{templateError}</div> : null}
                    {templates === null ? 'Loading…' : null}
                    {templates && !templates.length ? 'No templates yet.' : null}
                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))', gap: '.6rem', maxHeight: '60vh', overflowY: 'auto'}}>
                        {(templates || []).map(t => (
                            <button
                                key={t.slug}
                                disabled={!!applyingTemplate}
                                onClick={() => this.handleApplyTemplate(t)}
                                style={{display: 'flex', flexDirection: 'column', gap: '.3rem', padding: '.5rem', textAlign: 'left', border: '1px solid rgba(0,0,0,.15)', borderRadius: '.5rem', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit'}}
                            >
                                {t.thumbnail_url ? <img src={`${API_BASE.replace(/\/api$/, '')}${t.thumbnail_url}`} alt="" style={{width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: '.3rem'}} /> : null}
                                <strong>{applyingTemplate === t.slug ? 'Loading…' : t.name}</strong>
                                {t.multiplayer ? <span style={{fontSize: '.75rem', opacity: 0.75}}>{'Multiplayer (needs multiplayer unlocked)'}</span> : null}
                                {t.description ? <span style={{fontSize: '.75rem', opacity: 0.75}}>{t.description}</span> : null}
                            </button>
                        ))}
                    </div>
                    <div className={promptStyles.buttonRow}>
                        <button
                            className={promptStyles.cancelButton}
                            onClick={() => this.setState({templatesOpen: false})}
                        >{'Close'}</button>
                    </div>
                </Box>
            </Modal>
        );
    }
    handleOpenHistoryModal () {
        this.setState({historyModalOpen: true, historyEntries: null, historyError: null, historyTab: 'manual', selectedIds: []});
        fetch(`${API_BASE}/projects/${getParam('p')}/source/history`, {headers: authHeaders()})
            .then(res => {
                if (!res.ok) throw new Error('Failed to load history');
                return res.json();
            })
            .then(entries => this.setState({historyEntries: entries}))
            .catch(() => this.setState({historyError: "Couldn't load save history"}));
    }
    handleCloseHistoryModal () { this.setState({historyModalOpen: false}); }
    handleOpenSnapshotCopy (snapshotId) {
        const ref = encodeURIComponent(`${getParam('p')}:${snapshotId}`);
        window.open(`${location.pathname}?history=${ref}`, '_blank');
    }
    handleDownloadSnapshot (snapshotId) {
        if (this.state.downloadingId) return;
        this.setState({downloadingId: snapshotId});
        fetch(`${API_BASE}/projects/${getParam('p')}/source/history/${snapshotId}/access`, {headers: authHeaders()})
            .then(res => {
                if (!res.ok) throw new Error('Download failed');
                return res.json();
            })
            .then(access => {
                const a = document.createElement('a');
                a.href = access.url;
                a.download = access.filename || 'project.warp';
                document.body.appendChild(a);
                a.click();
                a.remove();
                this.setState({downloadingId: null});
            })
            .catch(() => { this.setState({downloadingId: null, historyError: 'Download failed... try again'}); });
    }
    async handleRestoreSnapshot (snapshotId) {
        const agreed = await askConfirm('Your current draft will be kept in history too.', {
            title: 'Restore this version?', ok: 'Restore'
        });
        if (!agreed) return;
        this.setState({restoringId: snapshotId});
        fetch(`${API_BASE}/projects/${getParam('p')}/source/history/${snapshotId}/restore`, {
            method: 'POST',
            headers: authHeaders()
        })
            .then(res => {
                if (!res.ok) throw new Error('Restore failed');
                window.dispatchEvent(new CustomEvent('dimod:project-resync-needed'));
                this.setState({restoringId: null, historyModalOpen: false});
            })
            .catch(() => { this.setState({restoringId: null, historyError: 'Restore failed... try again'}); });
    }
    saveQueryString ({label, isAuto, isDiff, isJp, baseRevision}) {
        const qs = new URLSearchParams();
        qs.set('jpok', '1');
        if (isJp) qs.set('jp', '1');
        if (label) qs.set('label', label);
        if (isAuto) qs.set('auto', '1');
        if (isDiff) qs.set('diff', '1');
        if ((isAuto || isDiff) && Number.isInteger(baseRevision)) qs.set('baseRevision', String(baseRevision));
        return qs.toString();
    }
    async uploadSourceChunked (blob, options, onProgress) {
        const projectId = getParam('p');
        const headers = {...authHeaders()};
        const begin = await fetch(`${API_BASE}/projects/${projectId}/source/chunked`, {method: 'POST', headers});
        if (!begin.ok) throw new Error('save failed');
        const {uploadId, chunkSize} = await begin.json();
        const size = Math.min(chunkSize || MAX_EDGE_UPLOAD_BYTES, MAX_EDGE_UPLOAD_BYTES);
        const chunks = Math.ceil(blob.size / size);
        for (let i = 0; i < chunks; i++) {
            const part = blob.slice(i * size, Math.min((i + 1) * size, blob.size));
            const res = await fetch(
                `${API_BASE}/projects/${projectId}/source/chunked/${uploadId}/${i}`,
                {method: 'PUT', headers: {...headers, 'Content-Type': 'application/octet-stream'}, body: part}
            );
            if (!res.ok) throw new Error('save failed');
            if (onProgress) onProgress(Math.round(((i + 1) / chunks) * 95));
        }
        const query = this.saveQueryString(options);
        const done = await fetch(
            `${API_BASE}/projects/${projectId}/source/chunked/${uploadId}/complete?chunks=${chunks}${query ? `&${query}` : ''}`,
            {method: 'POST', headers}
        );
        const body = await done.json().catch(() => null);
        if (!done.ok) {
            const err = new Error('save failed');
            if (done.status === 422 && body && body.code === 'invalid-project') err.invalidProject = true;
            else if (options.isDiff && (done.status === 422 || done.status === 400)) err.diffApplyFailed = true;
            if (done.status === 422 && body && body.code === 'missing-assets') err.missingAssets = body.missing;
            if (done.status === 409 && body && body.code === 'revision-conflict') err.revisionConflict = true;
            err.body = body;
            throw err;
        }
        if (onProgress) onProgress(100);
        return body || {};
    }
    uploadSource (blob, {label, isAuto, isDiff, isJp, baseRevision}, onProgress) {
        if (blob.size > MAX_EDGE_UPLOAD_BYTES) {
            return this.uploadSourceChunked(blob, {label, isAuto, isDiff, isJp, baseRevision}, onProgress);
        }
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const query = this.saveQueryString({label, isAuto, isDiff, isJp, baseRevision});
            xhr.open('PUT', `${API_BASE}/projects/${getParam('p')}/source${query ? `?${query}` : ''}`);
            const headers = authHeaders();
            if (headers.Authorization) xhr.setRequestHeader('Authorization', headers.Authorization);
            xhr.setRequestHeader('Content-Type', isDiff ? 'application/x.dimod.sb3-diff' : 'application/x.scratch.sb3');
            xhr.upload.onprogress = e => {
                if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
            };
            xhr.onload = () => {
                let body = null;
                try { body = JSON.parse(xhr.responseText); } catch (e) {
                }
                if (xhr.status >= 200 && xhr.status < 300) { resolve(body || {}); return; }
                const err = new Error('save failed');
                if (xhr.status === 422 && body && body.code === 'invalid-project') {
                    err.invalidProject = true;
                } else if (isDiff && (xhr.status === 422 || xhr.status === 400)) { err.diffApplyFailed = true; }
                if (xhr.status === 422 && body && body.code === 'missing-assets') err.missingAssets = body.missing;
                if (xhr.status === 409 && body && body.code === 'revision-conflict') { err.revisionConflict = true; }
                err.body = body;
                reject(err);
            };
            xhr.onerror = () => { const err = new Error('save failed'); err.offline = true; reject(err); };
            xhr.send(blob);
        });
    }
    async saveSource (onProgress, {label, isAuto, tries = 0} = {}) {
        if (!window.vm) throw new Error('not ready');
        if (window.dimodFlushPaint) window.dimodFlushPaint();
        const unsaveable = unsaveableProjectReason(window.vm);
        if (unsaveable) {
            log.warn(`not saving: ${unsaveable}`);
            if (isAuto) { this._lastDeferReason = 'invalid'; return SAVE_DEFERRED; }
            showErrorToast(`Not saved: ${unsaveable}`, 'Save');
            throw new Error(`not saved: ${unsaveable}`);
        }
        const projectId = getParam('p');
        const files = await captureProjectFiles(window.vm);
        const manifest = manifestFor(files);
        this.adoptLoadedBaseline();
        const base = this._lastSavedManifest;
        if (isAuto && base && manifestsEqual(base, manifest)) return;
        if (isAuto && !Number.isInteger(this._lastSavedRevision) && !this._revisionKnown) {
            this.fetchCurrentRevision();
            this._lastDeferReason = 'conflict';
            return SAVE_DEFERRED;
        }
        const missingAssets = missingReferencedAssets(files);
        const canDiff = base && Number.isInteger(this._lastSavedRevision);
        if (missingAssets.length) {
            log.warn(
                `${missingAssets.length} asset(s) referenced by this project could not be read and would be ` +
                `lost by a full save: ${missingAssets.slice(0, 5).join(', ')}${missingAssets.length > 5 ? '...' : ''}`
            );
            if (!canDiff) {
                if (isAuto) { this._lastDeferReason = 'assets'; return SAVE_DEFERRED; }
                const saveAnyway = await askConfirm(
                    `${missingAssets.length} costume/sound file(s) in this project could not be read... ` +
                    'they may have failed to load when the project was opened. Saving now would remove ' +
                    'them from the saved copy permanently.\n\nReload the page and try again, or save ' +
                    'without them.',
                    {title: 'Some files could not be read', ok: 'Save without them', danger: true}
                );
                if (!saveAnyway) throw new Error('save cancelled: missing assets');
            }
        }
        const fullWouldBeOversized = totalSize(files) > MAX_EDGE_UPLOAD_BYTES;
        const jp = canDiff && this._jcrcs ? jsonPatchFor(files, this._jcrcs) : null;
        let diffBlob = null;
        if (jp) {
            const changed = Object.keys(manifest).filter(f => f !== 'project.json' && manifest[f] !== base[f]);
            const removed = Object.keys(base).filter(f => !(f in manifest) && !missingAssets.includes(f));
            if (isAuto && jp.empty && !changed.length && !removed.length) { this._lastSavedManifest = manifest; return; }
            diffBlob = buildJsonDiff(files, jp.patch, changed, removed);
        } else if (canDiff) {
            diffBlob = buildSaveDiff(files, manifest, base, {allowEmpty: !isAuto, force: fullWouldBeOversized || missingAssets.length > 0});
        }
        let result;
        try {
            result = await this.uploadSource(
                diffBlob || zipFiles(files),
                {label, isAuto, isDiff: !!diffBlob, isJp: !!jp, baseRevision: this._lastSavedRevision},
                onProgress
            );
        } catch (err) {
            const b = err.body || {};
            if (err.revisionConflict && tries < 3 && (b.jcrcs || (b.retry && jp))) {
                if (b.jcrcs) { this._jcrcs = b.jcrcs; this._lastSavedRevision = b.revision; }
                await new Promise(ok => setTimeout(ok, 300 * (tries + 1)));
                return this.saveSource(onProgress, {label, isAuto, tries: tries + 1});
            }
            if (err.missingAssets && tries < 3 && err.missingAssets.some(f => f in files)) {
                const m = {...base};
                for (const f of err.missingAssets) delete m[f];
                this._lastSavedManifest = m;
                return this.saveSource(onProgress, {label, isAuto, tries: tries + 1});
            }
            if (err.offline) throw err;
            this._jcrcs = null;
            if (err.revisionConflict && isAuto) {
                this._lastSavedManifest = null;
                this.fetchCurrentRevision();
                this._lastDeferReason = 'conflict';
                return SAVE_DEFERRED;
            }
            if (!err.revisionConflict && !err.diffApplyFailed) throw err;
            this._lastSavedManifest = null;
            if (missingAssets.length) { this.fetchCurrentRevision(); throw err; }
            result = await this.uploadSource(zipFiles(files), {label, isAuto, isDiff: false}, onProgress);
        }
        const preserved = {};
        if (diffBlob && base) {
            for (const name of missingAssets) {
                if (name in base) preserved[name] = base[name];
            }
        }
        this._lastSavedManifest = Object.keys(preserved).length ? {...manifest, ...preserved} : manifest;
        this._jcrcs = result.jcrcs || null;
        if (Number.isInteger(result.size)) this._lastSavedSize = result.size;
        if (Number.isInteger(result.revision)) {
            this._lastSavedRevision = result.revision;
            if (!missingAssets.length) { this.scheduleCacheStore(projectId, result.revision, files, manifest); }
        }
    }
    adoptLoadedBaseline () {
        const loaded = window.dimodLoadedSource;
        if (!loaded || loaded.seq === this._adoptedLoadSeq || loaded.projectId !== getParam('p')) return;
        this._adoptedLoadSeq = loaded.seq;
        this._lastSavedManifest = loaded.manifest;
        this._jcrcs = null;
        this._lastSavedRevision = loaded.revision;
        this._revisionKnown = true;
    }
    scheduleCacheStore (projectId, revision, files, manifest) {
        clearTimeout(this._cacheStoreTimeout);
        this._cacheStoreTimeout = setTimeout(() => { projectCache.storeFiles(projectId, revision, files, manifest); }, 3000);
    }
    scheduleAutoSaveRetry () {
        if (!hasUnsavedLocalEdits()) return;
        if ((this._autoSaveRetries || 0) >= 8 && navigator.onLine !== false) return;
        this._autoSaveRetries = (this._autoSaveRetries || 0) + 1;
        const delay = Math.min(60000, 5000 * Math.pow(2, this._autoSaveRetries - 1));
        clearTimeout(this._autoSaveRetryTimeout);
        this._autoSaveRetryTimeout = setTimeout(() => {
            if (this.state.collabUsers.length > 0) this.handleOnwardSave();
            else this.handleAutoSave();
        }, delay);
    }
    async performSave ({isAuto = false, label = null} = {}) {
        if (isAuto) {
            this._autoSaveInFlight = true;
            const seqAtStart = getLocalEditSeq();
            let saved = false;
            this._lastDeferReason = null;
            setSaveHealth('saving');
            try {
                const outcome = await this.saveSource(null, {label, isAuto: true});
                saved = outcome !== SAVE_DEFERRED;
                if (saved) { markSavedThrough(seqAtStart); this._autoSaveRetries = 0; this.props.onProjectUnchanged(); }
            } catch (err) { if (err && err.offline) this._lastDeferReason = 'offline'; } finally { this._autoSaveInFlight = false; }
            if (saved) {
                setSaveHealth('ok');
                if (!hasUnsavedLocalEdits()) this.onFullySaved();
                this.reloadIntoNewProject();
            }
            else {
                const off = this._lastDeferReason === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false);
                setSaveHealth(off ? 'offline' : this._lastDeferReason === 'conflict' ? 'conflict' : 'retrying');
                this.scheduleAutoSaveRetry();
            }
            return;
        }
        this.setState({saveStatus: 'busy', saveProgress: 0});
        try {
            const seqAtStart = getLocalEditSeq();
            await this.saveSource(pct => this.setState({saveProgress: pct}), {label, isAuto});
            markSavedThrough(seqAtStart);
            setSaveHealth('ok');
            if (!hasUnsavedLocalEdits()) this.onFullySaved();
            this.setState({saveStatus: 'done'});
            this.props.onProjectUnchanged();
            if (this.reloadIntoNewProject()) return;
            setTimeout(() => this.setState({saveStatus: 'idle', saveProgress: 0}), 1500);
        } catch (err) {
            this.setState({saveStatus: 'error'});
            setTimeout(() => this.setState({saveStatus: 'idle', saveProgress: 0}), 2500);
        }
    }
    async uploadAutoThumbnail () {
        const vm = window.vm;
        if (!vm || !vm.renderer || typeof vm.renderer.requestSnapshot !== 'function') return;
        try {
            const dataURL = await new Promise(resolve => vm.renderer.requestSnapshot(resolve));
            const blob = await (await fetch(dataURL)).blob();
            const form = new FormData();
            form.append('thumbnail', blob, 'stage.png');
            await fetch(`${API_BASE}/projects/${getParam('p')}/thumbnail?auto=1`, {
                method: 'POST',
                headers: authHeaders(),
                body: form
            });
        } catch (e) {
        }
    }
    async performPublish (label) {
        this.setState({publishStatus: 'busy', publishProgress: 0});
        try {
            await this.saveSource(pct => this.setState({publishProgress: pct}));
            this.props.onProjectUnchanged();
            const res = await fetch(`${API_BASE}/projects/${getParam('p')}/publish`, {
                method: 'POST',
                headers: {...authHeaders(), 'Content-Type': 'application/json'},
                body: JSON.stringify({changelog: label || null})
            });
            if (!res.ok) throw new Error('publish failed');
            await this.uploadAutoThumbnail();
            this.setState({publishStatus: 'done'});
            setTimeout(() => this.setState({publishStatus: 'idle', publishProgress: 0}), 1500);
        } catch (err) {
            this.setState({publishStatus: 'error'});
            setTimeout(() => this.setState({publishStatus: 'idle', publishProgress: 0}), 2500);
        }
    }
    handleSaveNow () {
        if (!hasUnsavedLocalEdits()) return;
        clearTimeout(this._autoSaveTimeout);
        clearTimeout(this._onwardSaveTimeout);
        clearTimeout(this._autoSaveRetryTimeout);
        this._autoSaveRetries = 0;
        this.handleAutoSave();
    }
    handleOnline () {
        if (!hasUnsavedLocalEdits()) return;
        this._autoSaveRetries = 0;
        clearTimeout(this._autoSaveRetryTimeout);
        this._autoSaveRetryTimeout = setTimeout(() => {
            if (this.state.collabUsers.length > 0) this.handleOnwardSave();
            else this.handleAutoSave();
        }, 500);
    }
    handlePageHide (e) {
        if (e && e.type === 'visibilitychange' && document.visibilityState !== 'hidden') return;
        if (window.dimodFlushPaint) window.dimodFlushPaint();
        const vm = window.vm;
        const projectId = getParam('p');
        if (!projectId || !vm || !vm.__dimodProjectFullyLoaded || !hasUnsavedLocalEdits()) return;
        const hiding = e && e.type === 'visibilitychange';
        if ((hiding && this._autoSaveInFlight) || this.state.saveStatus === 'busy' || !this._jcrcs || !this._lastSavedManifest) return;
        if (this.state.autosaveOff && !this.state.collabUsers.length) return;
        try {
            if (unsaveableProjectReason(vm)) return;
            const files = captureProjectFilesSync(vm);
            const manifest = manifestFor(files);
            const base = this._lastSavedManifest;
            const jp = jsonPatchFor(files, this._jcrcs);
            if (!jp) return;
            const changed = Object.keys(manifest).filter(f => f !== 'project.json' && manifest[f] !== base[f]);
            if (jp.empty && !changed.length) return;
            const blob = buildJsonDiff(files, jp.patch, changed, []);
            if (blob.size > KEEPALIVE_MAX_BYTES) return;
            const query = this.saveQueryString({isAuto: true, isDiff: true, isJp: true, baseRevision: this._lastSavedRevision});
            const seq = getLocalEditSeq();
            const sent = fetch(`${API_BASE}/projects/${projectId}/source?${query}`, {
                method: 'PUT', keepalive: true, body: blob,
                headers: {...authHeaders(), 'Content-Type': 'application/x.dimod.sb3-diff'}
            });
            if (hiding) {
                this._autoSaveInFlight = true;
                sent.then(res => (res.ok ? res.json() : null)).then(body => {
                    if (!body || !Number.isInteger(body.revision)) return;
                    this._lastSavedRevision = body.revision;
                    this._jcrcs = body.jcrcs || null;
                    this._lastSavedManifest = {...base, ...manifest};
                    markSavedThrough(seq);
                    setSaveHealth('ok');
                    if (!hasUnsavedLocalEdits()) this.onFullySaved();
                }).catch(() => {}).then(() => { this._autoSaveInFlight = false; });
            }
        } catch (err) {}
    }
    handleBeforeUnload (e) {
        if (window.dimodFlushPaint) window.dimodFlushPaint();
        if (!getParam('p') || !hasUnsavedLocalEdits()) return undefined;
        this.handleSaveNow();
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
    touchRecent (patch) { touchRecentProject(getParam('p'), {title: this.props.projectTitle || 'Untitled', ...patch}); }
    draftKey () { return `dimodDraft:${getParam('p')}`; }
    writeUnsavedDraft () {
        const vm = window.vm;
        if (!getParam('p') || !vm || !vm.__dimodProjectFullyLoaded) return;
        if (!hasUnsavedLocalEdits()) { this.discardDraft(); return; }
        if (this._draftBusy) return;
        this._draftBusy = true;
        const seq = getLocalEditSeq();
        RestorePointAPI.createRestorePoint(vm, `${this.props.projectTitle || 'Project'} (unsaved draft)`,
            RestorePointAPI.TYPE_AUTOMATIC)
            .then(id => {
                const old = this._draftId;
                this._draftId = id;
                try { localStorage.setItem(this.draftKey(), String(id)); } catch (e) {}
                if (old !== undefined && old !== null && old !== id) RestorePointAPI.deleteRestorePoint(old).catch(() => {});
                this._draftSeq = seq;
            })
            .catch(() => {})
            .then(() => { this._draftBusy = false; });
    }
    onFullySaved () { this._recentUnsaved = false; this.touchRecent({unsaved: false, savedAt: Date.now()}); this.discardDraft(); }
    discardDraft () {
        const id = this._draftId;
        this._draftId = null;
        try { localStorage.removeItem(this.draftKey()); } catch (e) {}
        if (id !== undefined && id !== null) RestorePointAPI.deleteRestorePoint(id).catch(() => {});
    }
    checkForLeftoverDraft () {
        let id = null;
        try { id = localStorage.getItem(this.draftKey()); } catch (e) { return; }
        if (!id) return;
        RestorePointAPI.getAllRestorePoints().then(({restorePoints}) => {
            const found = restorePoints.some(r => String(r.id) === String(id));
            if (!found) {
                try { localStorage.removeItem(this.draftKey()); } catch (e) {}
                return;
            }
            this._draftId = Number(id);
            window.dispatchEvent(new CustomEvent('dimod:collab-desync', {
                detail: {reason: 'draft', text: 'Unsaved work from your last session was kept as a draft.', canRestore: true}
            }));
        }).catch(() => {});
    }
    loadBuildInfo () {
        fetch('build-info.json', {cache: 'no-store'})
            .then(r => (r.ok ? r.json() : null))
            .then(info => {
                if (!info) return;
                window.dimodBuildInfo = info;
                log.info(`Dimod Studio build ${info.studio} / paint ${info.paint} @ ${info.builtAt}`);
                this.setState({buildInfo: info});
            })
            .catch(() => {});
    }
    handleSaveClick () {
        if (this.state.saveStatus === 'busy' || this.state.publishStatus === 'busy') return;
        this.setState({saveNameModalOpen: true, saveNameInput: '', saveNameAction: 'save'});
    }
    handleSaveNewClick () {
        if (this.state.saveStatus === 'busy') return;
        if (!localStorage.getItem('token')) { this.askLogin(); return; }
        this.setState({saveNameModalOpen: true, saveNameInput: this.props.projectTitle || '', saveNameAction: 'create'});
    }
    async askLogin () {
        const go = await askConfirm(
            'Saving needs a Dimod account. The log in page opens in a new tab, so nothing here is lost... ' +
            'come back and press Save again.',
            {title: 'Log in to save', ok: 'Log in'}
        );
        if (go) window.open('/login', '_blank', 'noopener');
    }
    async performCreate (name) {
        const unsaveable = window.vm ? unsaveableProjectReason(window.vm) : 'not ready';
        if (unsaveable) { showErrorToast(`Not saved: ${unsaveable}`, 'Save'); return; }
        this.setState({saveStatus: 'busy', saveProgress: 0});
        let id = null;
        try {
            const res = await fetch(`${API_BASE}/projects/warp`, {
                method: 'POST',
                headers: {...authHeaders(), 'Content-Type': 'application/json'},
                body: JSON.stringify({name: (name || 'Untitled Warp Project').slice(0, 128), visibility: 'unlisted'})
            });
            if (res.status === 401) { this.setState({saveStatus: 'idle'}); this.askLogin(); return; }
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.id) throw new Error(body.error || `error ${res.status}`);
            id = body.id;
        } catch (err) {
            showErrorToast(`Could not create the project: ${err.message}`, 'Save');
            this.setState({saveStatus: 'error'});
            setTimeout(() => this.setState({saveStatus: 'idle', saveProgress: 0}), 2500);
            return;
        }
        const params = new URLSearchParams();
        params.set('p', id);
        if (getParam('livetests') !== null) params.set('livetests', getParam('livetests'));
        history.replaceState(history.state, '', `${location.pathname}?${params}`);
        this._reloadWhenSaved = true;
        await this.performSave({isAuto: false, label: null});
    }
    reloadIntoNewProject () {
        if (!this._reloadWhenSaved || hasUnsavedLocalEdits()) return false;
        this._reloadWhenSaved = false;
        location.reload();
        return true;
    }
    async handlePlaytestClick () {
        if (!getParam('p')) return;
        this.setState({playtestOpen: true, playtest: null, playtestError: null, playtestBusy: true, playtestCopied: false});
        try {
            if (hasUnsavedLocalEdits()) {
                await this.saveSource(pct => this.setState({saveStatus: 'busy', saveProgress: pct}));
                this.props.onProjectUnchanged();
                this.setState({saveStatus: 'idle', saveProgress: 0});
            }
            await this.requestPlaytest('POST');
        } catch (e) { this.setState({saveStatus: 'idle', saveProgress: 0, playtestError: e.message, playtestBusy: false}); }
    }
    playtestSettings () {
        const vm = window.vm;
        if (!vm) return {};
        const rt = vm.runtime;
        const options = rt.runtimeOptions || {};
        return {
            fps: rt.frameLoop ? rt.frameLoop.framerate : 30,
            interpolate: Boolean(rt.interpolationEnabled),
            turbo: Boolean(rt.turboMode),
            nohqpen: Boolean(vm.renderer && vm.renderer.useHighQualityRender === false),
            stuck: Boolean(rt.compilerOptions && rt.compilerOptions.warpTimer),
            clones: options.maxClones,
            offscreen: options.fencing === false,
            limitless: options.miscLimits === false
        };
    }
    async requestPlaytest (method, query = '') {
        this.setState({playtestBusy: true, playtestError: null});
        const res = await fetch(`${API_BASE}/projects/${getParam('p')}/playtest${query}`, method === 'POST' ? {
            method,
            headers: {...authHeaders(), 'Content-Type': 'application/json'},
            body: JSON.stringify({settings: this.playtestSettings()})
        } : {method, headers: authHeaders()});
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        this.setState({playtest: method === 'DELETE' ? null : data, playtestBusy: false, playtestCopied: false,
            playtestOff: method === 'DELETE'});
    }
    renderPlaytestModal () {
        if (!this.state.playtestOpen) return null;
        const {playtest, playtestError, playtestBusy, playtestCopied, playtestOff} = this.state;
        const close = () => this.setState({playtestOpen: false, playtestOff: false});
        const act = (method, query) => this.requestPlaytest(method, query).catch(e =>
            this.setState({playtestError: e.message, playtestBusy: false}));
        const copy = () => navigator.clipboard.writeText(playtest.url).then(
            () => this.setState({playtestCopied: true}), () => this.setState({playtestError: 'Copying is blocked here'}));
        return (
            <Modal id="dimodPlaytest" contentLabel="Playtest link" className={promptStyles.modalContent} onRequestClose={close}>
                <Box className={promptStyles.body}>
                    <Box className={promptStyles.label}>
                        {'Anyone with this link can play your latest save, without it being published. ' +
                            'They see new saves when they reload. It lasts a week.'}
                    </Box>
                    {playtestError ? <Box style={{color: '#d6334d', fontWeight: 'bold'}}>{playtestError}</Box> : null}
                    {playtestOff ? <Box>{'The link is off. Nobody can use it now.'}</Box> : null}
                    {playtest ? (
                        <Box>
                            <input
                                readOnly
                                className={promptStyles.variableNameTextInput}
                                value={playtest.url}
                                onFocus={e => e.target.select()}
                            />
                            <Box style={{opacity: 0.75, fontSize: '.85em', marginTop: '.35rem'}}>
                                {`Works until ${new Date(playtest.expires_at).toLocaleString()}.`}
                            </Box>
                        </Box>
                    ) : (playtestBusy ? <Box>{'Saving and making the link…'}</Box> : null)}
                    <Box className={promptStyles.buttonRow}>
                        {playtest ? (
                            <React.Fragment>
                                <button
                                    className={promptStyles.cancelButton}
                                    disabled={playtestBusy}
                                    title="Stop this link working for everyone"
                                    onClick={() => act('DELETE')}
                                >
                                    {'Turn off'}
                                </button>
                                <button
                                    className={promptStyles.cancelButton}
                                    disabled={playtestBusy}
                                    title="Replace it: the old link stops working"
                                    onClick={() => act('POST', '?new=1')}
                                >
                                    {'New link'}
                                </button>
                                <a
                                    className={promptStyles.cancelButton}
                                    href={playtest.url}
                                    rel="noopener noreferrer"
                                    style={{textDecoration: 'none', display: 'inline-flex', alignItems: 'center'}}
                                    target="_blank"
                                >
                                    {'Open'}
                                </a>
                                <button className={promptStyles.okButton} onClick={copy}>
                                    {playtestCopied ? 'Copied!' : 'Copy link'}
                                </button>
                            </React.Fragment>
                        ) : (
                            <React.Fragment>
                                <button className={promptStyles.cancelButton} onClick={close}>
                                    {'Close'}
                                </button>
                                {playtestOff ? (
                                    <button className={promptStyles.okButton} disabled={playtestBusy} onClick={() => act('POST')}>
                                        {'Make a new link'}
                                    </button>
                                ) : null}
                            </React.Fragment>
                        )}
                    </Box>
                </Box>
            </Modal>
        );
    }
    async handlePublishClick () {
        if (this.state.saveStatus === 'busy' || this.state.publishStatus === 'busy') return;
        let firstPublish = false;
        let allowRemix = null;
        try {
            const res = await fetch(`${API_BASE}/projects/${getParam('p')}`, {headers: authHeaders()});
            if (res.ok) {
                const g = await res.json();
                firstPublish = !(g.current_version && g.current_version.file_url);
                allowRemix = Boolean(g.allow_remix);
            }
        } catch (e) {
        }
        if (firstPublish) { this.performFirstPublish(); return; }
        this.setState({saveNameModalOpen: true, saveNameInput: '', saveNameAction: 'publish',
            publishAllowRemix: allowRemix, publishAllowRemixWas: allowRemix});
    }
    async performFirstPublish () {
        this.setState({publishStatus: 'busy', publishProgress: 0});
        try {
            await this.saveSource(pct => this.setState({publishProgress: pct}));
            this.props.onProjectUnchanged();
            await this.uploadAutoThumbnail();
            location.href = `/game/${getParam('p')}/publish`;
        } catch (err) {
            this.setState({publishStatus: 'error'});
            setTimeout(() => this.setState({publishStatus: 'idle', publishProgress: 0}), 2500);
        }
    }
    handleSaveNameInputChange (e) { this.setState({saveNameInput: e.target.value}); }
    handleCloseSaveNameModal () { this.setState({saveNameModalOpen: false}); }
    handleConfirmSaveName () {
        const label = this.state.saveNameInput.trim() || null;
        const action = this.state.saveNameAction;
        this.setState({saveNameModalOpen: false});
        if (action === 'create') { this.performCreate(label); } else if (action === 'publish') {
            const {publishAllowRemix, publishAllowRemixWas} = this.state;
            if (publishAllowRemix !== null && publishAllowRemix !== publishAllowRemixWas) {
                fetch(`${API_BASE}/projects/${getParam('p')}`, {
                    method: 'PATCH',
                    headers: {...authHeaders(), 'Content-Type': 'application/json'},
                    body: JSON.stringify({allow_remix: publishAllowRemix})
                }).catch(() => {});
            }
            this.performPublish(label);
        } else { this.performSave({isAuto: false, label}); }
    }
    handleStartRename (entry) { this.setState({renamingId: entry.id, renamingText: entry.label || ''}); }
    handleRenameChange (e) { this.setState({renamingText: e.target.value}); }
    handleCancelRename () { this.setState({renamingId: null, renamingText: ''}); }
    handleSubmitRename (snapshotId) {
        const label = this.state.renamingText.trim();
        fetch(`${API_BASE}/projects/${getParam('p')}/source/history/${snapshotId}`, {
            method: 'PATCH',
            headers: {...authHeaders(), 'Content-Type': 'application/json'},
            body: JSON.stringify({label: label || null})
        })
            .then(res => {
                if (!res.ok) throw new Error('rename failed');
                this.setState(state => ({
                    renamingId: null,
                    renamingText: '',
                    historyEntries: state.historyEntries.map(e => (e.id === snapshotId ? {...e, label: label || null} : e))
                }));
            })
            .catch(() => this.setState({renamingId: null, historyError: 'Rename failed... try again'}));
    }
    handleHistoryTabChange (tab) { this.setState({historyTab: tab, selectedIds: []}); }
    handleToggleSelect (id) {
        this.setState(state => ({
            selectedIds: state.selectedIds.includes(id)
                ? state.selectedIds.filter(x => x !== id)
                : [...state.selectedIds, id]
        }));
    }
    handleToggleSelectAll () {
        const visible = this.visibleHistoryEntries().filter(e => !e.is_current);
        this.setState(state => {
            const allSelected = visible.length > 0 && visible.every(e => state.selectedIds.includes(e.id));
            return {selectedIds: allSelected ? [] : visible.map(e => e.id)};
        });
    }
    async handleDeleteSnapshot (snapshotId) {
        const agreed = await askConfirm("This can't be undone.", {title: 'Delete this save?', ok: 'Delete', danger: true});
        if (!agreed) return;
        this.setState({deletingId: snapshotId});
        fetch(`${API_BASE}/projects/${getParam('p')}/source/history/${snapshotId}`, {method: 'DELETE', headers: authHeaders()})
            .then(res => {
                if (!res.ok) throw new Error('delete failed');
                this.setState(state => ({
                    deletingId: null,
                    historyEntries: state.historyEntries.filter(e => e.id !== snapshotId),
                    selectedIds: state.selectedIds.filter(id => id !== snapshotId)
                }));
            })
            .catch(() => this.setState({deletingId: null, historyError: 'Delete failed... try again'}));
    }
    async handleBulkDelete () {
        const {selectedIds} = this.state;
        if (selectedIds.length === 0) return;
        const plural = selectedIds.length === 1 ? '' : 's';
        const agreed = await askConfirm("This can't be undone.", {
            title: `Delete ${selectedIds.length} save${plural}?`, ok: 'Delete', danger: true
        });
        if (!agreed) return;
        this.setState({bulkDeleting: true});
        fetch(`${API_BASE}/projects/${getParam('p')}/source/history`, {
            method: 'DELETE',
            headers: {...authHeaders(), 'Content-Type': 'application/json'},
            body: JSON.stringify({ids: selectedIds})
        })
            .then(res => {
                if (!res.ok) throw new Error('bulk delete failed');
                this.setState(state => ({
                    bulkDeleting: false,
                    selectedIds: [],
                    historyEntries: state.historyEntries.filter(e => !selectedIds.includes(e.id))
                }));
            })
            .catch(() => this.setState({bulkDeleting: false, historyError: 'Delete failed... try again'}));
    }
    visibleHistoryEntries () {
        const {historyEntries, historyTab} = this.state;
        if (!historyEntries) return [];
        return historyEntries.filter(e => (historyTab === 'auto' ? e.is_auto : !e.is_auto));
    }
    async handleGoOutside () {
        const projectId = getParam('p');
        try {
            const res = await fetch(`${API_BASE}/projects/${projectId}`, {headers: authHeaders()});
            const g = await res.json();
            if (g.team_slug && g.slug) { location.href = `/teams/${g.team_slug}/game/${g.slug}`; return; }
            if (g.slug) { location.href = `/${g.owner_username}/${g.slug}`; return; }
        } catch (e) {
        }
        location.href = `/game/${projectId}`;
    }
    render () {
        const projectId = getParam('p');
        if (!projectId && (getSeeInsideId() || getParam('dimod_id'))) return null;
        const {saveStatus, saveProgress, publishStatus, publishProgress} = this.state;
        const anyBusy = saveStatus === 'busy' || publishStatus === 'busy';
        const saveLabel = saveStatus === 'busy'
            ? `Saving… ${saveProgress}%`
            : saveStatus === 'done' ?
                <React.Fragment><span className="dimod-saved-tick">{'✓'}</span>{'Saved'}</React.Fragment> :
                {idle: 'Save', done: 'Saved!', error: 'Failed :('}[saveStatus];
        const publishLabel = publishStatus === 'busy'
            ? `Publishing… ${publishProgress}%`
            : {idle: 'Publish', done: 'Published!', error: 'Failed :('}[publishStatus];
        const fixedWidth = width => ({minWidth: width, textAlign: 'center', justifyContent: 'center'});
        const withProgress = (busy, pct, width) => ({
            ...fixedWidth(width),
            ...(busy ? {
                backgroundImage:
                    `linear-gradient(to right, rgba(255,255,255,0.3) ${pct}%, rgba(255,255,255,0) ${pct}%)`
            } : {})
        });
        if (!projectId) {
            return (
                <React.Fragment>
                    <div className={styles.menuBarItem}>
                        <Button
                            className={buttonClass({[shareButtonStyles.disabled]: anyBusy})}
                            style={withProgress(saveStatus === 'busy', saveProgress, '7.5em')}
                            title="Save this to your Dimod account as a new project"
                            onClick={anyBusy ? null : this.handleSaveNewClick}
                        >
                            {saveLabel}
                        </Button>
                    </div>
                    {this.renderSaveNameModal()}
                </React.Fragment>
            );
        }
        return (
            <React.Fragment>
                <div className={styles.menuBarItem}>
                    <Button
                        className={buttonClass({[shareButtonStyles.disabled]: anyBusy})}
                        style={withProgress(saveStatus === 'busy', saveProgress, '7.5em')}
                        onClick={anyBusy ? null : this.handleSaveClick}
                    >
                        <DimodSavePill buildInfo={this.state.buildInfo}>{saveLabel}</DimodSavePill>
                    </Button>
                </div>
                <div className={styles.menuBarItem}>
                    <Button
                        className={buttonClass({[shareButtonStyles.disabled]: anyBusy})}
                        style={withProgress(publishStatus === 'busy', publishProgress, '9.5em')}
                        onClick={anyBusy ? null : this.handlePublishClick}
                    >
                        {publishLabel}
                    </Button>
                </div>
                {this.renderSaveNameModal()}
                {this.renderPlaytestModal()}
                {this.renderCollabStatus()}
                {this.renderHistoryModal()}
                {this.renderTemplatesModal()}
                <div className={styles.menuBarItem}>
                    <Button
                        className={buttonClass()}
                        title="Leave the editor for this project's page"
                        onClick={this.handleGoOutside}
                    >
                        {'Go outside'}
                    </Button>
                </div>
                {this.renderMore(anyBusy)}
            </React.Fragment>
        );
    }
    renderMore (anyBusy) {
        const {moreOpen, autosaveOff} = this.state;
        const ico = d => (
            <svg
                viewBox="0 0 20 20"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{flexShrink: 0}}
            >
                <path d={d} />
            </svg>
        );
        const items = [
            {id: 'playtest', label: 'Playtest', tip: 'A private link that plays your latest save, without publishing.', busy: anyBusy,
                icon: ico('M6 4l10 6-10 6z')},
            {id: 'history', label: 'History', tip: 'Earlier saves of this project', icon: ico('M3 10a7 7 0 1 0 2-5M3 3v4h4M10 6v4l3 2')},
            {id: 'templates', label: 'Templates', tip: 'Start from or apply a template', icon: ico('M3 4h14v5H3zM3 12h6v4H3zM12 12h5v4h-5z')},
            {id: 'autosave', label: autosaveOff ? 'Autosave: off' : 'Autosave: on',
                tip: autosaveOff ? 'Nothing saves until you press Save (it still does while others are in the project).' :
                    'Changes save by themselves a few seconds after you make them.',
                icon: ico(autosaveOff ? 'M4 10h12' : 'M4 10l4 4 8-8')}
        ];
        return (
            <div className={styles.menuBarItem} ref={this.setMoreRoot} style={{position: 'relative'}}>
                <Button
                    className={buttonClass({[shareButtonStyles.disabled]: false})}
                    title="Playtest, history, templates and more"
                    onClick={() => this.setState({moreOpen: !moreOpen})}
                >
                    <span style={{display: 'inline-flex', alignItems: 'center', gap: '.35rem'}}>
                        {'More'}
                        <svg
                            viewBox="0 0 20 20"
                            width="12"
                            height="12"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{transition: 'transform .2s', transform: moreOpen ? 'rotate(180deg)' : 'none'}}
                        >
                            <path d="M5 7.5l5 5 5-5" />
                        </svg>
                    </span>
                </Button>
                {moreOpen && (
                    <div
                        style={{
                            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 600, minWidth: '11rem',
                            padding: '.25rem', borderRadius: '.5rem', background: 'var(--ui-primary, #fff)',
                            color: 'var(--text-primary, #575e75)', border: '1px solid var(--ui-black-transparent, #0002)',
                            boxShadow: '0 .25rem .75rem rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column'
                        }}
                    >
                        {items.map(it => (
                            <button
                                key={it.id}
                                type="button"
                                title={it.tip}
                                disabled={it.busy}
                                onClick={() => {
                                    this.setState({moreOpen: false});
                                    window.dispatchEvent(new CustomEvent('dimod:toolbar-action', {detail: it.id}));
                                }}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.4rem .6rem',
                                    border: 'none', borderRadius: '.375rem', background: 'transparent', color: 'inherit',
                                    font: 'inherit', fontSize: '.8rem', cursor: it.busy ? 'default' : 'pointer',
                                    opacity: it.busy ? 0.5 : 1, textAlign: 'left', whiteSpace: 'nowrap'
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.background = 'var(--dimod-motion-light-transparent, #6c5ce726)';
                                }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                            >
                                {it.icon}
                                {it.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }
    renderSaveNameModal () {
        if (!this.state.saveNameModalOpen) return null;
        const isPublish = this.state.saveNameAction === 'publish';
        const isCreate = this.state.saveNameAction === 'create';
        return (
            <Modal
                id="dimodSaveName"
                contentLabel={isCreate ? 'Name your project' : (isPublish ? 'Name this version' : 'Name this save')}
                className={promptStyles.modalContent}
                onRequestClose={this.handleCloseSaveNameModal}
            >
                <Box className={promptStyles.body}>
                    <Box className={promptStyles.label}>
                        {isCreate ?
                            'This becomes a new project on your Dimod account.' :
                            'Leave blank if you don\'t want one.'}
                    </Box>
                    <Box>
                        <input
                            autoFocus
                            className={promptStyles.variableNameTextInput}
                            maxLength={200}
                            value={this.state.saveNameInput}
                            onChange={this.handleSaveNameInputChange}
                            onKeyDown={e => {
                                if (e.key === 'Enter') this.handleConfirmSaveName();
                            }}
                        />
                    </Box>
                    {isPublish && this.state.publishAllowRemix !== null ? (
                        <label
                            style={{display: 'flex', alignItems: 'flex-start', gap: '.5rem', marginTop: '.75rem', cursor: 'pointer'}}
                        >
                            <input
                                checked={this.state.publishAllowRemix}
                                type="checkbox"
                                onChange={e => this.setState({publishAllowRemix: e.target.checked})}
                            />
                            <span>
                                <strong>{'Allow remixes'}</strong>
                                <br />
                                <span style={{opacity: 0.75, fontSize: '.85em'}}>
                                    {'Anyone can make their own copy of this version in Studio. Remixes credit you.'}
                                </span>
                            </span>
                        </label>
                    ) : null}
                    <Box className={promptStyles.buttonRow}>
                        <button className={promptStyles.cancelButton} onClick={this.handleCloseSaveNameModal}>
                            {'Cancel'}
                        </button>
                        <button className={promptStyles.okButton} onClick={this.handleConfirmSaveName}>
                            {isPublish ? 'Publish' : 'Save'}
                        </button>
                    </Box>
                </Box>
            </Modal>
        );
    }
    renderHistoryModal () {
        if (!this.state.historyModalOpen) return null;
        const {historyEntries, historyError, restoringId, renamingId, renamingText, historyTab,
            selectedIds, deletingId, bulkDeleting} = this.state;
        const visible = this.visibleHistoryEntries();
        const selectableVisible = visible.filter(e => !e.is_current);
        const allSelected = selectableVisible.length > 0 && selectableVisible.every(e => selectedIds.includes(e.id));
        return (
            <Modal
                id="dimodHistory"
                contentLabel="Save history"
                className={promptStyles.modalContent}
                styleContent={{width: 'min(860px, calc(100vw - 2rem))'}}
                onRequestClose={this.handleCloseHistoryModal}
            >
                <Box
                    className={promptStyles.body}
                    style={{padding: '1.25rem 1.5rem', maxHeight: 'calc(100vh - 9rem)', overflowY: 'auto'}}
                >
                    {historyEntries && historyEntries.length > 0 && (
                        <div style={{display: 'flex', gap: '.4rem', marginBottom: '.6rem'}}>
                            <Button
                                className={buttonClass({[shareButtonStyles.disabled]: historyTab !== 'manual'})}
                                style={{fontSize: '0.75rem', padding: '.25rem .6rem', height: 'auto'}}
                                onClick={() => this.handleHistoryTabChange('manual')}
                            >
                                {'Manual saves'}
                            </Button>
                            <Button
                                className={buttonClass({[shareButtonStyles.disabled]: historyTab !== 'auto'})}
                                style={{fontSize: '0.75rem', padding: '.25rem .6rem', height: 'auto'}}
                                onClick={() => this.handleHistoryTabChange('auto')}
                            >
                                {'Auto-saves'}
                            </Button>
                        </div>
                    )}
                    {historyError ? (
                        <div>{historyError}</div>
                    ) : historyEntries === null ? (
                        <div>{'Loading…'}</div>
                    ) : historyEntries.length === 0 ? (
                        <div>{'No earlier saves yet... your first Save (or auto-save) will start showing up here.'}</div>
                    ) : (
                        <React.Fragment>
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '.5rem',
                                    paddingBottom: '.3rem'
                                }}
                            >
                                <label
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '.35rem',
                                        fontSize: '0.75rem',
                                        opacity: selectableVisible.length ? 1 : 0.5
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        disabled={selectableVisible.length === 0}
                                        onChange={this.handleToggleSelectAll}
                                    />
                                    {'Select all'}
                                </label>
                                {selectedIds.length > 0 && (
                                    <Button
                                        className={buttonClass({[shareButtonStyles.disabled]: bulkDeleting})}
                                        style={historyRowButton}
                                        onClick={bulkDeleting ? null : this.handleBulkDelete}
                                    >
                                        {bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.length} selected`}
                                    </Button>
                                )}
                            </div>
                            {visible.length === 0 ? (
                                <div>{`No ${historyTab === 'auto' ? 'auto-' : 'manual '}saves in this tab yet.`}</div>
                            ) : visible.map(entry => {
                                const isRenaming = renamingId === entry.id;
                                const displayLabel = entry.label || (entry.is_auto ? 'Auto-save' : 'Manual save');
                                return (
                                    <React.Fragment key={entry.id}>
                                    <div style={historyRow}>
                                        {entry.is_current ? (
                                            <div style={{width: '1rem'}} />
                                        ) : (
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(entry.id)}
                                                onChange={() => this.handleToggleSelect(entry.id)}
                                            />
                                        )}
                                        <div style={{...historyRowInfo, flex: 1, minWidth: 0}}>
                                            {isRenaming ? (
                                                <input
                                                    type="text"
                                                    autoFocus
                                                    maxLength={200}
                                                    value={renamingText}
                                                    onChange={this.handleRenameChange}
                                                    onBlur={() => this.handleSubmitRename(entry.id)}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') this.handleSubmitRename(entry.id);
                                                        if (e.key === 'Escape') this.handleCancelRename();
                                                    }}
                                                    style={{fontSize: '0.8rem', width: '100%'}}
                                                />
                                            ) : (
                                                <div
                                                    onClick={() => this.handleStartRename(entry)}
                                                    title={`${displayLabel}\nClick to rename`}
                                                    style={{cursor: 'pointer', ...historyOneLine}}
                                                >
                                                    {displayLabel}
                                                    {entry.is_current && (
                                                        <span style={{opacity: 0.6, fontSize: '0.7rem'}}>
                                                            {' · current'}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                            <div style={{...historyRowMeta, ...historyOneLine}}>
                                                {`${formatExactTime(entry.created_at)} · `}
                                                {`${formatRelativeTime(entry.created_at)} · ${formatSize(entry.size)}`}
                                                {entry.created_by_username ? ` · ${entry.created_by_username}` : ''}
                                            </div>
                                        </div>
                                        <Button
                                            className={buttonClass()}
                                            style={historyRowButton}
                                            title="Open this save in a new tab as a separate copy. Saving there makes a new project; this one isn't changed."
                                            onClick={() => this.handleOpenSnapshotCopy(entry.id)}
                                        >
                                            {'Open copy'}
                                        </Button>
                                        <Button
                                            className={buttonClass(
                                                {[shareButtonStyles.disabled]: this.state.downloadingId === entry.id}
                                            )}
                                            style={historyRowButton}
                                            title="Download this save as a file"
                                            onClick={() => this.handleDownloadSnapshot(entry.id)}
                                        >
                                            {'Download'}
                                        </Button>
                                        {!entry.is_current && (
                                            <Button
                                                className={buttonClass()}
                                                style={historyRowButton}
                                                onClick={() => this.setState({
                                                    previewId: this.state.previewId === entry.id ? null : entry.id
                                                })}
                                            >
                                                {this.state.previewId === entry.id ? 'Hide' : 'Changes'}
                                            </Button>
                                        )}
                                        {!entry.is_current && (
                                            <Button
                                                className={buttonClass({[shareButtonStyles.disabled]: restoringId === entry.id})}
                                                style={historyRowButton}
                                                onClick={
                                                    restoringId ? null : () => this.handleRestoreSnapshot(entry.id)
                                                }
                                            >
                                                {restoringId === entry.id ? 'Restoring…' : 'Restore'}
                                            </Button>
                                        )}
                                        {!entry.is_current && (
                                            <Button
                                                className={buttonClass({[shareButtonStyles.disabled]: deletingId === entry.id})}
                                                style={historyRowButton}
                                                onClick={
                                                    deletingId ? null : () => this.handleDeleteSnapshot(entry.id)
                                                }
                                            >
                                                {deletingId === entry.id ? 'Deleting…' : 'Delete'}
                                            </Button>
                                        )}
                                    </div>
                                    {this.state.previewId === entry.id ? (
                                        <DimodHistoryPreview
                                            apiBase={API_BASE}
                                            projectId={getParam('p')}
                                            snapshotId={entry.id}
                                            headers={authHeaders()}
                                        />
                                    ) : null}
                                    </React.Fragment>
                                );
                            })}
                        </React.Fragment>
                    )}
                </Box>
            </Modal>
        );
    }
    renderCollabStatus () {
        const {collabStatus, collabUsers} = this.state;
        const info = COLLAB_STATUS_INFO[collabStatus] || COLLAB_STATUS_INFO.connecting;
        const hasMembers = collabUsers.length > 0;
        return (
            <div className={styles.menuBarItem}>
                <style>{`
                    @keyframes dimodCollabPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
                `}</style>
                <Button
                    className={buttonClass()}
                    style={{cursor: 'pointer', minWidth: '8em', justifyContent: 'center'}}
                    onClick={this.handleOpenMembersModal}
                    title={hasMembers ? 'See who\'s here' : 'Collaboration settings'}
                >
                    <span style={{display: 'flex', alignItems: 'center', gap: '.4rem'}}>
                        <span
                            style={{
                                ...collabDot,
                                background: info.color,
                                animation: info.pulse ? 'dimodCollabPulse 1.2s ease-in-out infinite' : 'none'
                            }}
                        />
                        <span>{info.label}</span>
                        {hasMembers && (
                            <span style={collabAvatarStack}>
                                {collabUsers.slice(0, 5).map((u, i) => (
                                    <img
                                        key={u.userId + i}
                                        src={avatarSrc(u)}
                                        onError={avatarFail(u)}
                                        alt={u.username}
                                        title={u.username}
                                        draggable={false}
                                        style={{...collabAvatarDot, borderColor: colorForUserId(u.userId)}}
                                    />
                                ))}
                            </span>
                        )}
                    </span>
                </Button>
                {this.renderMembersModal()}
            </div>
        );
    }
    renderMembersModal () {
        if (!this.state.membersModalOpen) return null;
        const {collabUsers} = this.state;
        const myUsername = getMyUsername();
        return (
            <Modal
                id="dimodMembers"
                contentLabel={isCollabDisabled() ? 'Collaboration' : `Who's here (${collabUsers.length})`}
                className={promptStyles.modalContent}
                onRequestClose={this.handleCloseMembersModal}
            >
                <Box className={promptStyles.body}>
                    {collabUsers.map((u, i) => {
                        const color = colorForUserId(u.userId);
                        return (
                            <div key={u.userId + i} style={membersModalRow}>
                                <img
                                    src={avatarSrc(u)}
                                    onError={avatarFail(u)}
                                    alt=""
                                    draggable={false}
                                    style={{...membersModalAvatar, borderColor: color}}
                                />
                                <span>{u.username}{u.username === myUsername ? ' (you)' : ''}</span>
                            </div>
                        );
                    })}
                    {collabUsers.length === 0 && (
                        <div style={{opacity: 0.7, padding: '.35rem 0'}}>
                            {isCollabDisabled() ? 'Live collaboration is off.' : 'Nobody else is here.'}
                        </div>
                    )}
                    <label style={collabToggleRow} title="Turn off if the editor is acting up. Reloads the page.">
                        <span>
                            <div>{'Live collaboration'}</div>
                            <div style={{fontSize: '.75rem', opacity: 0.65}}>{'Changing this reloads the page'}</div>
                        </span>
                        <span style={collabSwitch(!isCollabDisabled())}>
                            <span style={collabSwitchKnob(!isCollabDisabled())} />
                        </span>
                        <input
                            type="checkbox"
                            checked={!isCollabDisabled()}
                            onChange={toggleCollabDisabled}
                            style={{display: 'none'}}
                        />
                    </label>
                </Box>
            </Modal>
        );
    }
}
DimodToolbar.propTypes = {onProjectUnchanged: PropTypes.func.isRequired, projectTitle: PropTypes.string};
const mapDispatchToProps = dispatch => ({onProjectUnchanged: () => dispatch(setProjectUnchanged())});
const mapStateToProps = state => ({projectTitle: state.scratchGui.projectTitle});
const dimodToolbar = connect(mapStateToProps, mapDispatchToProps)(DimodToolbar);
class DimodSeeInsideBar extends React.Component {
    constructor (props) {
        super(props);
        this.state = {info: null, remixing: false};
        this.handleRemix = this.handleRemix.bind(this);
    }
    componentDidMount () {
        if (!getSeeInsideId()) return;
        loadSeeInside().then(info => {
            if (info && !info.error) this.setState({info});
        });
    }
    handleRemix () {
        if (!getDimodToken()) {
            location.href = `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`;
            return;
        }
        this.setState({remixing: true});
        remixSeenProject()
            .then(id => { location.href = `${location.pathname}?p=${encodeURIComponent(id)}`; })
            .catch(e => { this.setState({remixing: false}); askAlert(e.message, {title: 'Couldn\'t remix'}); });
    }
    render () {
        const {info, remixing} = this.state;
        if (!info) return null;
        return (
            <div className={styles$1.bar} title="Changes here aren't saved. Remix to keep your own copy">
                <span className={styles$1.text}>
                    {'Inside '}
                    <b>{info.name}</b>
                    {` by ${info.owner_username}`}
                </span>
                {info.allow_remix ? (
                    <button className={styles$1.remix} disabled={remixing} onClick={this.handleRemix}>
                        {remixing ? 'Remixing...' : 'Remix'}
                    </button>
                ) : null}
            </div>
        );
    }
}
const SITE = process.env.DIMOD_SITE_ORIGIN || window.location.origin;
const SITE_ORIGIN = new URL(SITE, window.location.href).origin;
class DimodLibraryWindow extends React.Component {
    constructor (props) {
        super(props);
        this.frame = null;
        this.handleMessage = this.handleMessage.bind(this);
        this.setFrame = el => { this.frame = el; };
    }
    componentDidMount () { window.addEventListener('message', this.handleMessage); }
    componentWillUnmount () { window.removeEventListener('message', this.handleMessage); }
    reply (id, ok, error) {
        if (this.frame && this.frame.contentWindow) {
            this.frame.contentWindow.postMessage({type: 'dimod-library-added', id, ok, error}, SITE_ORIGIN);
        }
    }
    handleMessage (e) {
        if (e.origin !== SITE_ORIGIN || !this.frame || e.source !== this.frame.contentWindow) return;
        const msg = e.data || {};
        if (msg.type !== 'dimod-library-add' || typeof msg.id !== 'string') return;
        addDimodLibraryItem(this.props.vm, msg.id).then(
            () => this.reply(msg.id, true),
            err => { this.reply(msg.id, false, err.message); showErrorToast(err, 'Library'); }
        );
    }
    render () {
        return (
            <Modal fullScreen contentLabel="Library" id="dimodLibraryWindow" onRequestClose={this.props.onRequestClose}>
                <iframe
                    ref={this.setFrame}
                    src={`${SITE}/library`}
                    style={{height: 'calc(100% - 3.125rem)', width: '100%', border: 0, display: 'block'}}
                    title="Library"
                />
            </Modal>
        );
    }
}
DimodLibraryWindow.propTypes = {onRequestClose: PropTypes.func.isRequired, vm: PropTypes.instanceOf(VM).isRequired};
export {DimodHistoryPreview, DimodLibraryWindow, DimodSavePill, DimodSeeInsideBar, dimodToolbar as DimodToolbar};
