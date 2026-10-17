import React from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import bindAll from 'lodash.bindall';
import {openRestorePointModal} from '../reducers/modals';
import RestorePointAPI from '../lib/tw-restore-point-api';
import {colorForUserId, contrastTextColor, dimodDragState} from '../lib/dimod-collab';
import {listenToProjectChat, sendProjectChatMessage, getDimodUserId} from '../lib/dimod-project';
import {playNotifSound, isUserTyping} from '../lib/dimod-ui';
import DOMPurify from 'dompurify';
import Modal from './modal.jsx';
import Box from '../components/box/box.jsx';
import Button from '../components/button/button.jsx';
import promptStyles from '../components/prompt/prompt.css';
import uid from '../lib/uid.js';
import VM from 'scratch-vm';
import log from '../lib/log';
class DimodCollabBanner extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['handleDesync', 'handleDismiss', 'handleResync', 'handleRestore']);
        this.state = {notice: null};
    }
    componentDidMount () { window.addEventListener('dimod:collab-desync', this.handleDesync); }
    componentWillUnmount () {
        window.removeEventListener('dimod:collab-desync', this.handleDesync);
        clearTimeout(this._hideTimer);
    }
    handleDesync (e) {
        const detail = (e && e.detail) || {};
        clearTimeout(this._hideTimer);
        this.setState({notice: detail});
        if (detail.reason === 'too-large') this._hideTimer = setTimeout(this.handleDismiss, 15000);
    }
    handleDismiss () { this.setState({notice: null}); }
    handleRestore () { this.props.onOpenRestorePoints(); this.handleDismiss(); }
    handleResync () {
        this.handleDismiss();
        const done = () => window.dispatchEvent(new CustomEvent('dimod:project-resync-needed'));
        RestorePointAPI.createRestorePoint(
            this.props.vm, 'Project (before resync)', RestorePointAPI.TYPE_MANUAL
        ).then(done, done);
    }
    render () {
        const {notice} = this.state;
        if (!notice) return null;
        const btn = {
            marginLeft: 8, padding: '2px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.6)',
            background: 'transparent', color: '#fff', cursor: 'pointer', fontSize: 12
        };
        return (
            <div
                style={{
                    position: 'fixed', top: 52, left: '50%', transform: 'translateX(-50%)', zIndex: 5000,
                    background: '#c0392b', color: '#fff', padding: '8px 14px', borderRadius: 6, fontSize: 13,
                    boxShadow: '0 2px 10px rgba(0,0,0,0.35)', maxWidth: '80vw'
                }}
                role="alert"
            >
                {notice.text || 'Your session may be out of sync with collaborators.'}
                {notice.canRestore ? (
                    <button
                        style={btn}
                        onClick={this.handleRestore}
                    >{notice.reason === 'draft' ? 'Open restore points' : 'Restore my version'}</button>
                ) : null}
                {notice.reason === 'gap' ? (
                    <button style={btn} onClick={this.handleResync}>{'Resync'}</button>
                ) : null}
                <button style={btn} onClick={this.handleDismiss}>{'Dismiss'}</button>
            </div>
        );
    }
}
DimodCollabBanner.propTypes = {onOpenRestorePoints: PropTypes.func, vm: PropTypes.shape({})};
const mapStateToProps = state => ({vm: state.scratchGui.vm});
const mapDispatchToProps = dispatch => ({onOpenRestorePoints: () => dispatch(openRestorePointModal())});
const dimodCollabBanner = connect(mapStateToProps, mapDispatchToProps)(DimodCollabBanner);
const MESSAGE_DURATION = 8000;
const MAX_VISIBLE = 5;
const SUPPRESS_WINDOW = 15000;
const plainText = html => {
    const stripped = String(html || '').replace(/<[^>]*>/g, '');
    const decoder = document.createElement('textarea');
    decoder.innerHTML = stripped;
    return decoder.value.trim();
};
class DimodCollabChat extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'attachCollabListener', 'handleRemoteCursorChat', 'handleChatMessageEvent', 'handleSystemMessage',
            'handleProjectChatMessage', 'tick'
        ]);
        this.state = {messages: []};
        this._nextId = 0;
        this._suppressed = [];
        this._myUserId = getDimodUserId();
    }
    componentDidMount () {
        this.attachCollabListener();
        window.addEventListener('dimod:chat-message', this.handleChatMessageEvent);
        window.addEventListener('dimod:system-message', this.handleSystemMessage);
        this._stopProjectChat = listenToProjectChat(this.handleProjectChatMessage);
        this._tickInterval = setInterval(this.tick, 1000);
    }
    componentWillUnmount () {
        clearInterval(this._tickInterval);
        if (this._stopProjectChat) this._stopProjectChat();
        window.removeEventListener('dimod:collab-ready', this.attachCollabListener);
        window.removeEventListener('dimod:chat-message', this.handleChatMessageEvent);
        window.removeEventListener('dimod:system-message', this.handleSystemMessage);
        if (window.dimodCollab && window.dimodCollab.onCursorChat === this.handleRemoteCursorChat) {
            window.dimodCollab.onCursorChat = null;
        }
    }
    attachCollabListener () {
        if (window.dimodCollab) { window.dimodCollab.onCursorChat = this.handleRemoteCursorChat; return; }
        window.addEventListener('dimod:collab-ready', this.attachCollabListener, {once: true});
    }
    prune (now) { this._suppressed = this._suppressed.filter(e => now - e.at < SUPPRESS_WINDOW); }
    suppress (userId, text) {
        const now = Date.now();
        this.prune(now);
        this._suppressed.push({key: `${userId}\u0000${text}`, at: now});
    }
    isSuppressed (userId, text) {
        const now = Date.now();
        this.prune(now);
        const key = `${userId}\u0000${text}`;
        const i = this._suppressed.findIndex(e => e.key === key);
        if (i === -1) return false;
        this._suppressed.splice(i, 1);
        return true;
    }
    addMessage (userId, username, text) {
        const id = this._nextId++;
        this.setState(state => ({
            messages: [
                ...state.messages,
                {id, userId, username: username || '?', text, expiresAt: Date.now() + MESSAGE_DURATION}
            ].slice(-MAX_VISIBLE)
        }));
    }
    handleRemoteCursorChat (payload, fromUserId) {
        this.suppress(fromUserId, payload.text);
        window.dispatchEvent(new CustomEvent('dimod:chat-message', {
            detail: {
                userId: fromUserId, username: payload.fromUsername, text: payload.text,
                x: payload.x, y: payload.y, local: false
            }
        }));
    }
    handleChatMessageEvent (e) {
        if (!e.detail.local) return;
        this.suppress(e.detail.userId, e.detail.text);
    }
    handleSystemMessage (e) {
        const text = e && e.detail && e.detail.text;
        if (!text) return;
        this.addMessage('system', 'System', text);
    }
    handleProjectChatMessage (msg) {
        const text = plainText(msg.body);
        if (!text || msg.is_system) return;
        if (this.isSuppressed(msg.user_id, text)) return;
        this.addMessage(msg.user_id, msg.username, text);
        if (msg.user_id !== this._myUserId) playNotifSound();
    }
    tick () {
        const now = Date.now();
        this.setState(state => {
            const filtered = state.messages.filter(m => m.expiresAt > now);
            if (filtered.length === state.messages.length) return null;
            return {messages: filtered};
        });
    }
    render () {
        if (this.state.messages.length === 0) return null;
        return (
            <div style={{
                position: 'fixed', left: 12, bottom: 12, zIndex: 500,
                display: 'flex', flexDirection: 'column-reverse', gap: 4,
                pointerEvents: 'none', maxWidth: 320
            }}>
                {this.state.messages.slice().reverse().map(m => {
                    const color = colorForUserId(m.userId);
                    return (
                        <div key={m.id} style={{
                            background: 'rgba(30,30,40,0.92)', color: '#fff', borderRadius: 6,
                            padding: '6px 10px', fontSize: 12, lineHeight: '16px',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                            wordBreak: 'break-word'
                        }}>
                            <span style={{fontWeight: 'bold', color}}>{m.username}: </span>
                            <span>{m.text}</span>
                        </div>
                    );
                })}
            </div>
        );
    }
}
const getMyIdentity = () => {
    try {
        const token = localStorage.getItem('token');
        const payload = token.split('.')[1];
        const json = decodeURIComponent(escape(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))));
        const decoded = JSON.parse(json);
        return {id: decoded.userId, username: decoded.username};
    } catch (e) { return {}; }
};
const CURSOR_TIMEOUT = 10000;
const CURSOR_FADE_MS = 2500;
const CURSOR_FADE_IN_MS = 300;
const CHAT_BUBBLE_DURATION = 6000;
const BROADCAST_THROTTLE = 33;
const CURSOR_GLIDE_TAU_MS = 45;
const CURSOR_GLIDE_SNAP = 0.01;
const CURSOR_GLIDE_TELEPORT_DIST = 2000;
const nameTagStyle = color => ({
    position: 'absolute', left: 16, top: 12, whiteSpace: 'nowrap',
    background: color, color: contrastTextColor(color),
    fontSize: 11, fontWeight: 'bold', lineHeight: '14px',
    padding: '1px 6px', borderRadius: 3, boxShadow: '0 1px 3px rgba(0,0,0,0.35)'
});
const bubbleStyle = color => ({
    position: 'absolute', left: 16, top: -40, whiteSpace: 'nowrap',
    maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis',
    background: '#fff', color: '#222', fontSize: 12, lineHeight: '16px',
    padding: '4px 8px', borderRadius: 6, boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    border: `1px solid ${color}`
});
const arrowStyle = {position: 'absolute', left: 0, top: 0, display: 'block'};
const dragPreviewStyle = colour => ({
    position: 'absolute', left: 0, top: 0, whiteSpace: 'nowrap',
    maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
    background: colour, color: contrastTextColor(colour),
    fontSize: 11, lineHeight: '16px', fontWeight: 'bold',
    padding: '3px 8px', borderRadius: 4, boxShadow: '0 2px 5px rgba(0,0,0,0.35)',
    border: '1px solid rgba(255,255,255,0.5)'
});
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const URI_BEARING_ATTRS = ['href', 'xlink:href', 'src'];
const DATA_IMAGE_URI = /^data:image\//i;
const LOCAL_REF = /^url\(\s*["']?#([^)"']+)["']?\s*\)$/;
const REF_ATTRS = ['filter', 'clip-path', 'mask'];
const isLoadableUri = value => {
    const trimmed = value.replace(/\s/g, '');
    if (!trimmed) return false;
    if (DATA_IMAGE_URI.test(trimmed)) return true;
    try {
        const url = new URL(value, document.baseURI);
        return url.origin === window.location.origin &&
            (url.protocol === 'http:' || url.protocol === 'https:');
    } catch (e) { return false; }
};
const dropDanglingRefs = (el, localIds) => {
    REF_ATTRS.forEach(name => {
        const value = el.getAttribute(name);
        if (value === null) return;
        const match = LOCAL_REF.exec(value.trim());
        if (!match) return;
        if (localIds.has(match[1]) || document.getElementById(match[1])) return;
        el.removeAttribute(name);
    });
};
const stripRemoteUris = root => {
    const localIds = new Set();
    root.querySelectorAll('[id]').forEach(el => localIds.add(el.getAttribute('id')));
    root.querySelectorAll('*').forEach(el => {
        URI_BEARING_ATTRS.forEach(name => {
            const value = el.getAttribute(name);
            if (value !== null && !isLoadableUri(value)) el.removeAttribute(name);
        });
        const nsValue = el.getAttributeNS(XLINK_NS, 'href');
        if (nsValue !== null && !isLoadableUri(nsValue)) el.removeAttributeNS(XLINK_NS, 'href');
        dropDanglingRefs(el, localIds);
    });
};
const sanitizeBlockSvg = (markup, viewBox) => {
    if (!markup || !viewBox) return null;
    const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" ` +
        `viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}" ` +
        `width="100%" height="100%">${markup}</svg>`;
    try {
        const frag = DOMPurify.sanitize(wrapped, {
            USE_PROFILES: {svg: true},
            FORBID_TAGS: ['script', 'foreignObject', 'style'],
            RETURN_DOM_FRAGMENT: true
        });
        if (!frag) return null;
        stripRemoteUris(frag);
        const holder = document.createElement('div');
        holder.appendChild(frag);
        const clean = holder.innerHTML;
        return clean && clean.trim() ? clean : null;
    } catch (e) { return null; }
};
const withSanitizedSvg = (nextDragging, prevDragging) => {
    if (!nextDragging || !nextDragging.svg) return nextDragging;
    if (prevDragging && prevDragging.svg === nextDragging.svg) { return {...nextDragging, safeSvg: prevDragging.safeSvg}; }
    return {...nextDragging, safeSvg: sanitizeBlockSvg(nextDragging.svg, nextDragging.viewBox)};
};
const mergeDragging = (next, prev) => {
    if (!next) return null;
    if (next.svg || next.viewBox) return withSanitizedSvg(next, prev);
    if (prev && prev.dragId === next.dragId) { return {...prev, x: next.x, y: next.y}; }
    return {...next};
};
const renderDraggingBlockPreview = draggingBlock => {
    const {viewBox, safeSvg, colour, text} = draggingBlock;
    if (!(safeSvg && viewBox && viewBox.width > 0 && viewBox.height > 0)) {
        return (
            <div style={dragPreviewStyle(colour)}>
                {text}
            </div>
        );
    }
    return (
        <div
            style={{
                width: viewBox.width, height: viewBox.height, lineHeight: 0, opacity: 0.8,
                filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.35))'
            }}
            dangerouslySetInnerHTML={{__html: safeSvg}}
        />
    );
};
class DimodCollabCursors extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'attachCollabListener',
            'handleRemoteCursor',
            'handleChatMessageEvent',
            'handleMouseMove',
            'handleDragPositionChanged',
            'handleDragStateChanged',
            'flushTrailingBroadcast',
            'handleGlobalKeyDown',
            'handleChatInputKeyDown',
            'handleChatInputBlur',
            'setChatInputRef',
            'setLocalGroupRef',
            'handleUsersChanged',
            'setOverlayRef',
            'tick',
            'syncHiddenBlocks',
            'animationFrame'
        ]);
        this.state = {visibleUserIds: [], chatting: false, hasPeers: false, visible: false};
        this.localPos = {x: 0, y: 0};
        this.lastBroadcastAt = 0;
        this._trailingTimer = null;
        this._lastFrameAt = 0;
        this._sentDragId = null;
        this._hiddenBlocks = new Set();
        this.localBubble = null;
        this.cursors = {};
        const identity = getMyIdentity();
        this.myUserId = identity.id || 'me';
        this.myUsername = identity.username || 'You';
    }
    componentDidMount () {
        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('keydown', this.handleGlobalKeyDown);
        window.addEventListener('dimod:collab-users', this.handleUsersChanged);
        this.handleUsersChanged();
        window.addEventListener('dimod:chat-message', this.handleChatMessageEvent);
        window.addEventListener('dimod:drag-state-changed', this.handleDragStateChanged);
        window.addEventListener('dimod:drag-position-changed', this.handleDragPositionChanged);
        this.attachCollabListener();
        this._tickInterval = setInterval(this.tick, 1000);
        this._rafId = requestAnimationFrame(this.animationFrame);
    }
    componentWillUnmount () {
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('keydown', this.handleGlobalKeyDown);
        window.removeEventListener('dimod:collab-users', this.handleUsersChanged);
        window.removeEventListener('dimod:chat-message', this.handleChatMessageEvent);
        window.removeEventListener('dimod:drag-state-changed', this.handleDragStateChanged);
        window.removeEventListener('dimod:drag-position-changed', this.handleDragPositionChanged);
        clearInterval(this._tickInterval);
        clearTimeout(this._trailingTimer);
        cancelAnimationFrame(this._rafId);
        this._hiddenBlocks.forEach(blockId => this.setBlockHidden(blockId, false));
        this._hiddenBlocks.clear();
        window.removeEventListener('dimod:collab-ready', this.attachCollabListener);
        if (window.dimodCollab && window.dimodCollab.onCursorUpdate === this.handleRemoteCursor) {
            window.dimodCollab.onCursorUpdate = null;
        }
    }
    attachCollabListener () {
        if (window.dimodCollab) { window.dimodCollab.onCursorUpdate = this.handleRemoteCursor; return; }
        window.addEventListener('dimod:collab-ready', this.attachCollabListener, {once: true});
    }
    getSvgRect () {
        const workspace = this.props.getWorkspace();
        if (!workspace) return null;
        const svg = workspace.getParentSvg();
        if (!svg) return null;
        const rect = svg.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return null;
        return rect;
    }
    tick () {
        const now = Date.now();
        let changed = false;
        Object.keys(this.cursors).forEach(userId => {
            const c = this.cursors[userId];
            if (now - c.updatedAt > CURSOR_TIMEOUT) {
                delete this.cursors[userId];
                changed = true;
            } else if (c.bubbleExpiresAt && c.bubbleExpiresAt <= now) {
                c.bubbleExpiresAt = null;
                c.bubbleText = null;
                changed = true;
            }
        });
        if (this.localBubble && this.localBubble.expiresAt <= now) { this.localBubble = null; changed = true; }
        const nowVisible = !!this.getSvgRect();
        if (nowVisible !== this.state.visible) this.setState({visible: nowVisible});
        this.syncHiddenBlocks();
        this.forceUpdate();
    }
    syncHiddenBlocks () {
        const workspace = this.props.getWorkspace();
        const wanted = new Set();
        if (workspace) {
            Object.keys(this.cursors).forEach(userId => {
                const c = this.cursors[userId];
                if (!c.draggingBlock || !c.draggingBlock.blockId) return;
                if (!this.isOnSameTarget(c)) return;
                if (dimodDragState.current && dimodDragState.current.blockId === c.draggingBlock.blockId) { return; }
                wanted.add(c.draggingBlock.blockId);
            });
        }
        this._hiddenBlocks.forEach(blockId => {
            if (wanted.has(blockId)) return;
            this.setBlockHidden(blockId, false);
            this._hiddenBlocks.delete(blockId);
        });
        wanted.forEach(blockId => {
            if (this._hiddenBlocks.has(blockId)) return;
            if (this.setBlockHidden(blockId, true)) this._hiddenBlocks.add(blockId);
        });
    }
    setBlockHidden (blockId, hidden) {
        const workspace = this.props.getWorkspace();
        if (!workspace || !workspace.getBlockById) return false;
        try {
            const block = workspace.getBlockById(blockId);
            const root = block && block.getSvgRoot && block.getSvgRoot();
            if (!root) return false;
            root.style.display = hidden ? 'none' : '';
            return true;
        } catch (e) { return false; }
    }
    isOnSameTarget (cursor) {
        return !!(window.vm && window.vm.editingTarget && cursor.targetId &&
            cursor.targetId === window.vm.editingTarget.id);
    }
    animationFrame () {
        if (!this.state.hasPeers && !this.state.chatting && !this.localBubble &&
            Object.keys(this.cursors).length === 0) {
            this._lastFrameAt = 0;
            this._rafId = requestAnimationFrame(this.animationFrame);
            return;
        }
        const rect = this.getSvgRect();
        const workspace = this.props.getWorkspace();
        if (rect && workspace && this.overlayEl) {
            this.overlayEl.style.left = `${rect.left}px`;
            this.overlayEl.style.top = `${rect.top}px`;
            this.overlayEl.style.width = `${rect.width}px`;
            this.overlayEl.style.height = `${rect.height}px`;
            const ctm = this.getWorkspaceCanvasCTM(workspace);
            const scale = workspace.scale || 1;
            const screenScale = ctm ? ctm.a : scale;
            const toScreen = ctm
                ? (wx, wy) => {
                    const pt = new DOMPoint(wx, wy).matrixTransform(ctm);
                    return {x: pt.x - rect.left, y: pt.y - rect.top};
                }
                : (wx, wy) => ({x: (wx * scale) + workspace.scrollX, y: (wy * scale) + workspace.scrollY});
            if (this.localGroup) {
                const p = toScreen(this.localPos.x, this.localPos.y);
                this.localGroup.style.transform = `translate(${p.x}px, ${p.y}px)`;
            }
            const now = Date.now();
            const dt = Math.min(100, Math.max(1, now - (this._lastFrameAt || now)));
            this._lastFrameAt = now;
            const glide = 1 - Math.exp(-dt / CURSOR_GLIDE_TAU_MS);
            Object.keys(this.cursors).forEach(userId => {
                const c = this.cursors[userId];
                if (!c.ref) return;
                const dx = c.targetX - c.renderX;
                const dy = c.targetY - c.renderY;
                if (Math.abs(dx) + Math.abs(dy) > CURSOR_GLIDE_TELEPORT_DIST) {
                    c.renderX = c.targetX;
                    c.renderY = c.targetY;
                } else {
                    c.renderX += dx * glide;
                    c.renderY += dy * glide;
                    if (Math.abs(c.targetX - c.renderX) < CURSOR_GLIDE_SNAP) c.renderX = c.targetX;
                    if (Math.abs(c.targetY - c.renderY) < CURSOR_GLIDE_SNAP) c.renderY = c.targetY;
                }
                const p = toScreen(c.renderX, c.renderY);
                c.ref.style.transform = `translate(${p.x}px, ${p.y}px)`;
                const quietFor = now - c.updatedAt;
                const exitOpacity = quietFor > CURSOR_TIMEOUT - CURSOR_FADE_MS
                    ? Math.max(0, 1 - ((quietFor - (CURSOR_TIMEOUT - CURSOR_FADE_MS)) / CURSOR_FADE_MS))
                    : 1;
                const entranceOpacity = Math.min(1, (now - c.createdAt) / CURSOR_FADE_IN_MS);
                c.ref.style.opacity = Math.min(exitOpacity, entranceOpacity);
            });
            Object.keys(this.cursors).forEach(userId => {
                const c = this.cursors[userId];
                const drag = c.draggingBlock;
                if (!c.dragRef || !drag) return;
                if (!Number.isFinite(drag.x) || !Number.isFinite(drag.y)) return;
                const box = drag.viewBox;
                const wantX = drag.x + (box ? box.x : 0);
                const wantY = drag.y + (box ? box.y : 0);
                if (!Number.isFinite(c.dragRenderX) ||
                    Math.abs(wantX - c.dragRenderX) + Math.abs(wantY - c.dragRenderY) >
                        CURSOR_GLIDE_TELEPORT_DIST) { c.dragRenderX = wantX; c.dragRenderY = wantY; } else { c.dragRenderX += (wantX - c.dragRenderX) * glide; c.dragRenderY += (wantY - c.dragRenderY) * glide; }
                const p = toScreen(c.dragRenderX, c.dragRenderY);
                c.dragRef.style.transform = `translate(${p.x}px, ${p.y}px) scale(${screenScale})`;
            });
        }
        this._rafId = requestAnimationFrame(this.animationFrame);
    }
    updateVisibleUserIds () {
        const ids = Object.keys(this.cursors);
        this.setState(state => {
            if (state.visibleUserIds.length === ids.length && ids.every(id => state.visibleUserIds.includes(id))) { return null; }
            return {visibleUserIds: ids};
        });
    }
    handleRemoteCursor (payload, fromUserId) {
        const existing = this.cursors[fromUserId];
        const rawNextDragging = 'draggingBlock' in payload
            ? (payload.draggingBlock || null)
            : (existing ? existing.draggingBlock : null);
        const nextDragging = mergeDragging(rawNextDragging, existing ? existing.draggingBlock : null);
        if (existing) {
            existing.targetX = payload.x;
            existing.targetY = payload.y;
            existing.targetId = payload.targetId || null;
            existing.name = payload.fromUsername || existing.name || '?';
            const draggingTextChanged =
                (existing.draggingBlock ? existing.draggingBlock.text : null) !==
                (nextDragging ? nextDragging.text : null);
            const startedOrStopped = !existing.draggingBlock !== !nextDragging ||
                (existing.draggingBlock && nextDragging &&
                    existing.draggingBlock.dragId !== nextDragging.dragId);
            if (startedOrStopped) existing.dragRenderX = null;
            existing.draggingBlock = nextDragging;
            existing.updatedAt = Date.now();
            if (startedOrStopped) this.syncHiddenBlocks();
            if (draggingTextChanged || startedOrStopped) this.forceUpdate();
        } else {
            const now = Date.now();
            this.cursors[fromUserId] = {
                name: payload.fromUsername || '?',
                targetId: payload.targetId || null,
                targetX: payload.x, targetY: payload.y,
                renderX: payload.x, renderY: payload.y,
                draggingBlock: nextDragging,
                bubbleText: null, bubbleExpiresAt: null,
                createdAt: now, updatedAt: now, ref: null, dragRef: null
            };
            this.updateVisibleUserIds();
            if (nextDragging) this.syncHiddenBlocks();
        }
    }
    handleChatMessageEvent (e) {
        const {userId, username, text, x, y, local} = e.detail;
        if (local) { this.localBubble = {text, expiresAt: Date.now() + CHAT_BUBBLE_DURATION}; this.forceUpdate(); return; }
        this.handleRemoteCursor({x, y, fromUsername: username}, userId);
        const c = this.cursors[userId];
        c.bubbleText = text;
        c.bubbleExpiresAt = Date.now() + CHAT_BUBBLE_DURATION;
        this.forceUpdate();
    }
    getWorkspaceCanvasCTM (workspace) {
        const canvas = workspace.getCanvas && workspace.getCanvas();
        if (!canvas || typeof canvas.getScreenCTM !== 'function') return null;
        return canvas.getScreenCTM();
    }
    getWorkspaceXYFromClient (clientX, clientY) {
        const workspace = this.props.getWorkspace();
        if (!workspace) return null;
        const ctm = this.getWorkspaceCanvasCTM(workspace);
        if (ctm) { const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse()); return {x: pt.x, y: pt.y}; }
        const rect = this.getSvgRect();
        if (!rect) return null;
        return {
            x: ((clientX - rect.left) - workspace.scrollX) / workspace.scale,
            y: ((clientY - rect.top) - workspace.scrollY) / workspace.scale
        };
    }
    getWorkspaceXYFromEvent (e) { return this.getWorkspaceXYFromClient(e.clientX, e.clientY); }
    handleMouseMove (e) {
        const workspace = this.props.getWorkspace();
        if (!workspace) return;
        const container = (workspace.getInjectionDiv && workspace.getInjectionDiv()) || workspace.getParentSvg();
        if (!container || !container.contains(e.target)) return;
        this._client = {x: e.clientX, y: e.clientY};
        this.trackAndMaybeBroadcast();
    }
    handleDragPositionChanged (e) {
        if (!e.detail) return;
        this._client = {x: e.detail.clientX, y: e.detail.clientY, d: e.detail};
        this.trackAndMaybeBroadcast();
    }
    get localPos () {
        const c = this._client; // lazy so moves dont force a layout (getScreenCTM) every event
        if (c) { this._client = null; this._lp = (Number.isFinite(c.x) && Number.isFinite(c.y) && this.getWorkspaceXYFromClient(c.x, c.y)) || c.d || this._lp; }
        return this._lp;
    }
    set localPos (p) { this._lp = p; this._client = null; }
    trackAndMaybeBroadcast () {
        if (!window.dimodCollab || this.state.chatting) return;
        const now = Date.now();
        const sinceLast = now - this.lastBroadcastAt;
        if (sinceLast < BROADCAST_THROTTLE) {
            if (!this._trailingTimer) {
                this._trailingTimer = setTimeout(this.flushTrailingBroadcast, BROADCAST_THROTTLE - sinceLast);
            }
            return;
        }
        this.broadcastPosition(this.localPos);
    }
    flushTrailingBroadcast () {
        this._trailingTimer = null;
        if (this.state.chatting) return;
        this.broadcastPosition(this.localPos);
    }
    dragPayload () {
        const state = dimodDragState.current;
        if (!state) { this._sentDragId = null; return null; }
        if (this._sentDragId === state.dragId) {
            return {dragId: state.dragId, blockId: state.blockId, colour: state.colour, text: state.text, x: state.x, y: state.y};
        }
        this._sentDragId = state.dragId;
        return state;
    }
    broadcastPosition (pos) {
        this.lastBroadcastAt = Date.now();
        if (window.dimodCollab) {
            const targetId = (window.vm && window.vm.editingTarget) ? window.vm.editingTarget.id : null;
            window.dimodCollab.sendCursorUpdate({x: pos.x, y: pos.y, targetId, draggingBlock: this.dragPayload()});
        }
    }
    handleDragStateChanged () {
        if (!window.dimodCollab) return;
        if (!this.getSvgRect()) return;
        this.broadcastPosition(this.localPos);
    }
    handleGlobalKeyDown (e) {
        if (this.state.chatting) return;
        if (e.key !== 't' && e.key !== 'T') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (isUserTyping(window.ScratchBlocks)) return;
        const active = document.activeElement;
        const onNeutralGround = !active || active === document.body ||
            active.closest('.blocklyWorkspace, [class*="blocks_blocks"]');
        if (!onNeutralGround) return;
        if (!this.getSvgRect()) return;
        e.preventDefault();
        this.setState({chatting: true});
    }
    handleChatInputKeyDown (e) {
        e.stopPropagation();
        if (e.key === 'Enter') {
            const text = e.target.value.trim().slice(0, 200);
            if (text) {
                if (window.dimodCollab) { window.dimodCollab.sendCursorChat({x: this.localPos.x, y: this.localPos.y, text}); }
                sendProjectChatMessage(text);
                window.dispatchEvent(new CustomEvent('dimod:chat-message', {
                    detail: {userId: this.myUserId, username: this.myUsername, text, local: true}
                }));
            }
            this.setState({chatting: false});
        } else if (e.key === 'Escape') { this.setState({chatting: false}); }
    }
    handleChatInputBlur () { this.setState({chatting: false}); }
    setChatInputRef (el) {
        if (el) el.focus();
    }
    handleUsersChanged () {
        const others = (window.dimodCollabUsers || []).filter(u => u.userId !== this.myUserId);
        const hasPeers = others.length > 0;
        if (hasPeers !== this.state.hasPeers) this.setState({hasPeers});
    }
    setLocalGroupRef (el) { this.localGroup = el; }
    setOverlayRef (el) { this.overlayEl = el; }
    render () {
        if (!this.state.visible) return null;
        const myColor = colorForUserId(this.myUserId);
        const now = Date.now();
        return (
            <div ref={this.setOverlayRef} style={{position: 'fixed', overflow: 'hidden', pointerEvents: 'none', zIndex: 2}}>
                {this.state.visibleUserIds.map(userId => {
                    const c = this.cursors[userId];
                    if (!c || !c.draggingBlock || !this.isOnSameTarget(c)) return null;
                    return (
                        <div
                            key={`drag-${userId}`}
                            ref={el => { c.dragRef = el; }}
                            style={{position: 'absolute', left: 0, top: 0, transformOrigin: 'top left'}}
                        >
                            {renderDraggingBlockPreview(c.draggingBlock)}
                        </div>
                    );
                })}
                {this.state.visibleUserIds.map(userId => {
                    const c = this.cursors[userId];
                    if (!c || !this.isOnSameTarget(c)) return null;
                    const color = colorForUserId(userId);
                    const showBubble = c.bubbleExpiresAt && c.bubbleExpiresAt > now;
                    return (
                        <div key={userId} ref={el => { c.ref = el; }} style={{position: 'absolute', left: 0, top: 0}}>
                            <svg width="20" height="20" viewBox="0 0 20 20" style={arrowStyle}>
                                <path
                                    d="M2 1 L2 17 L6.5 13.5 L9.5 19 L12 17.5 L9 12 L15 12 Z"
                                    fill={color} stroke="#fff" strokeWidth="1"
                                />
                            </svg>
                            <div style={nameTagStyle(color)}>{c.name}</div>
                            {showBubble ? <div style={bubbleStyle(color)}>{c.bubbleText}</div> : null}
                        </div>
                    );
                })}
                <div ref={this.setLocalGroupRef} style={{position: 'absolute', left: 0, top: 0, pointerEvents: 'none'}}>
                    {this.state.chatting ? (
                        <div style={{position: 'absolute', left: 16, top: 10, pointerEvents: 'auto'}}>
                            <input
                                ref={this.setChatInputRef}
                                maxLength={200}
                                placeholder="Say something..."
                                onKeyDown={this.handleChatInputKeyDown}
                                onBlur={this.handleChatInputBlur}
                                style={{
                                    fontSize: 12, padding: '2px 6px', borderRadius: 3,
                                    border: `1px solid ${myColor}`, outline: 'none', minWidth: 140
                                }}
                            />
                        </div>
                    ) : (this.state.hasPeers ? (
                        <div style={nameTagStyle(myColor)}>{this.myUsername}</div>
                    ) : null)}
                    {this.localBubble && this.localBubble.expiresAt > now ? (
                        <div style={bubbleStyle(myColor)}>{this.localBubble.text}</div>
                    ) : null}
                </div>
            </div>
        );
    }
}
DimodCollabCursors.propTypes = {getWorkspace: PropTypes.func.isRequired};
const APPROVAL_TIMEOUT_MS = 45000;
const TICK_MS = 1000;
const labelForUrl = url => {
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'data:') return 'a custom extension';
        return parsed.hostname + (parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '');
    } catch (e) { return 'a custom extension'; }
};
class DimodCollabExtensionApproval extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'attachCollabListener', 'handleRemoteApprovalRequest', 'handleRemoteApprovalVote',
            'handleRemoteApprovalResolved', 'handleAllow', 'handleDeny', 'tick', 'requestApproval'
        ]);
        this.outgoingRequests = new Map();
        this.state = {pendingIncoming: []};
    }
    componentDidMount () {
        this.attachCollabListener();
        this._tickInterval = setInterval(this.tick, TICK_MS);
        window.dimodExtensionApproval = {requestApproval: this.requestApproval};
    }
    componentWillUnmount () {
        clearInterval(this._tickInterval);
        window.removeEventListener('dimod:collab-ready', this.attachCollabListener);
        if (window.dimodExtensionApproval && window.dimodExtensionApproval.requestApproval === this.requestApproval) {
            window.dimodExtensionApproval = null;
        }
        if (window.dimodCollab) {
            if (window.dimodCollab.onExtensionApprovalRequest === this.handleRemoteApprovalRequest) {
                window.dimodCollab.onExtensionApprovalRequest = null;
            }
            if (window.dimodCollab.onExtensionApprovalVote === this.handleRemoteApprovalVote) {
                window.dimodCollab.onExtensionApprovalVote = null;
            }
            if (window.dimodCollab.onExtensionApprovalResolved === this.handleRemoteApprovalResolved) {
                window.dimodCollab.onExtensionApprovalResolved = null;
            }
        }
        this.outgoingRequests.clear();
    }
    attachCollabListener () {
        if (window.dimodCollab) {
            window.dimodCollab.onExtensionApprovalRequest = this.handleRemoteApprovalRequest;
            window.dimodCollab.onExtensionApprovalVote = this.handleRemoteApprovalVote;
            window.dimodCollab.onExtensionApprovalResolved = this.handleRemoteApprovalResolved;
            return;
        }
        window.addEventListener('dimod:collab-ready', this.attachCollabListener, {once: true});
    }
    announce (text) { window.dispatchEvent(new CustomEvent('dimod:system-message', {detail: {text}})); }
    myUserId () {
        try {
            const token = localStorage.getItem('token');
            const payload = token.split('.')[1];
            const json = decodeURIComponent(escape(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))));
            return JSON.parse(json).userId || null;
        } catch (e) { return null; }
    }
    requestApproval (url, unsandboxed) {
        const others = (window.dimodCollabUsers || []).filter(u => u.userId !== this.myUserId());
        if (others.length === 0 || !window.dimodCollab) return Promise.resolve(true);
        const requestId = uid();
        const label = labelForUrl(url);
        return new Promise(resolve => {
            const expectedVoters = new Set(others.map(u => u.userId));
            const votes = new Map();
            let lastDenier = null;
            let settled = false;
            const finish = approved => {
                if (settled) return;
                settled = true;
                this.outgoingRequests.delete(requestId);
                window.dimodCollab.sendExtensionApprovalResolved({requestId, approved});
                const denyReason = lastDenier ? `by ${lastDenier}` : '(timed out)';
                this.announce(approved
                    ? `Everyone approved loading ${label}... going ahead.`
                    : `Extension load denied ${denyReason}... not loading ${label}.`);
                resolve(approved);
            };
            this.outgoingRequests.set(requestId, {
                expiresAt: Date.now() + APPROVAL_TIMEOUT_MS,
                onVote: (fromUserId, approve, fromUsername) => {
                    if (!expectedVoters.has(fromUserId) || settled) return;
                    votes.set(fromUserId, approve);
                    if (!approve) { lastDenier = fromUsername; finish(false); return; }
                    if ([...expectedVoters].every(uid_ => votes.has(uid_))) finish(true);
                },
                onTimeout: () => finish(false)
            });
            this.announce(`Asking ${others.length === 1 ? others[0].username : 'everyone here'} to approve loading ${label}...`);
            window.dimodCollab.sendExtensionApprovalRequest({requestId, url, unsandboxed: !!unsandboxed});
        });
    }
    handleRemoteApprovalVote (payload, fromUserId) {
        const req = this.outgoingRequests.get(payload.requestId);
        if (!req) return;
        req.onVote(fromUserId, !!payload.approve, payload.fromUsername);
    }
    handleRemoteApprovalRequest (payload) {
        if (!payload || !payload.requestId || !payload.url) return;
        this.setState(state => ({
            pendingIncoming: [...state.pendingIncoming, {
                requestId: payload.requestId,
                url: payload.url,
                unsandboxed: !!payload.unsandboxed,
                fromUsername: payload.fromUsername || 'Someone',
                expiresAt: Date.now() + APPROVAL_TIMEOUT_MS
            }]
        }));
    }
    handleRemoteApprovalResolved (payload) {
        if (!payload || !payload.requestId) return;
        this.setState(state => ({pendingIncoming: state.pendingIncoming.filter(r => r.requestId !== payload.requestId)}));
    }
    handleAllow (requestId) {
        if (window.dimodCollab) window.dimodCollab.sendExtensionApprovalVote({requestId, approve: true});
        this.setState(state => ({pendingIncoming: state.pendingIncoming.filter(r => r.requestId !== requestId)}));
    }
    handleDeny (requestId) {
        if (window.dimodCollab) window.dimodCollab.sendExtensionApprovalVote({requestId, approve: false});
        this.setState(state => ({pendingIncoming: state.pendingIncoming.filter(r => r.requestId !== requestId)}));
    }
    tick () {
        const now = Date.now();
        this.outgoingRequests.forEach(req => {
            if (now >= req.expiresAt) req.onTimeout();
        });
        this.setState(state => {
            const filtered = state.pendingIncoming.filter(r => now < r.expiresAt);
            if (filtered.length === state.pendingIncoming.length) return null;
            return {pendingIncoming: filtered};
        });
    }
    render () {
        const current = this.state.pendingIncoming[0];
        if (!current) return null;
        return (
            <Modal
                id="dimodExtensionApprovalModal"
                contentLabel="Approve extension?"
                className={promptStyles.modalContent}
                onRequestClose={() => this.handleDeny(current.requestId)}
            >
                <Box className={promptStyles.body}>
                    <p>
                        <strong>{current.fromUsername}</strong>
                        {' wants to load a custom extension:'}
                    </p>
                    <p style={{wordBreak: 'break-all', fontSize: '0.8rem', opacity: 0.8}}>
                        {current.url.startsWith('data:') ? 'Pasted/uploaded extension code' : current.url}
                    </p>
                    {current.unsandboxed && (
                        <p style={{fontSize: '0.8rem', color: '#e5534b'}}>
                            {'This would run without a sandbox... it can do anything the page itself can.'}
                        </p>
                    )}
                    <div style={{display: 'flex', gap: '.5rem', marginTop: '.75rem'}}>
                        <Button onClick={() => this.handleAllow(current.requestId)}>
                            {'Allow'}
                        </Button>
                        <Button onClick={() => this.handleDeny(current.requestId)}>
                            {'Deny'}
                        </Button>
                    </div>
                </Box>
            </Modal>
        );
    }
}
const POLL_INTERVAL_MS = 2000;
const fullKey = (scope, targetId, key) => (scope === 'runtime' ? `runtime:${key}` : `target:${targetId}:${key}`);
const isSyncableTarget = target => target && (target.isStage || target.isOriginal !== false);
class DimodCollabExtensionData extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['attachCollabListener', 'handleRemoteExtensionData', 'poll']);
        this.snapshots = new Map();
        this._warnedKeys = new Set();
    }
    componentDidMount () {
        this.attachCollabListener();
        this._projectRunning = false;
        this._onProjectRunStart = () => { this._projectRunning = true; };
        this._onProjectRunStop = () => { this._projectRunning = false; };
        this.props.vm.runtime.on('PROJECT_RUN_START', this._onProjectRunStart);
        this.props.vm.runtime.on('PROJECT_RUN_STOP', this._onProjectRunStop);
        this.forEachEntry(entry => { this.snapshots.set(entry.fullKey, this.stringify(entry)); });
        this._pollInterval = setInterval(this.poll, POLL_INTERVAL_MS);
    }
    componentWillUnmount () {
        clearInterval(this._pollInterval);
        this.props.vm.runtime.removeListener('PROJECT_RUN_START', this._onProjectRunStart);
        this.props.vm.runtime.removeListener('PROJECT_RUN_STOP', this._onProjectRunStop);
        window.removeEventListener('dimod:collab-ready', this.attachCollabListener);
        if (window.dimodCollab && window.dimodCollab.onExtensionData === this.handleRemoteExtensionData) {
            window.dimodCollab.onExtensionData = null;
        }
    }
    attachCollabListener () {
        if (window.dimodCollab) { window.dimodCollab.onExtensionData = this.handleRemoteExtensionData; return; }
        window.addEventListener('dimod:collab-ready', this.attachCollabListener, {once: true});
    }
    stringify (entry) {
        try { return JSON.stringify(typeof entry.value === 'undefined' ? null : entry.value); } catch (e) {
            if (!this._warnedKeys.has(entry.fullKey)) {
                this._warnedKeys.add(entry.fullKey);
                log.warn(`Could not serialize extensionStorage.${entry.key} for collab sync`, e);
            }
            return null;
        }
    }
    forEachEntry (fn) {
        const runtime = this.props.vm.runtime;
        Object.keys(runtime.extensionStorage || {}).forEach(key => {
            fn({
                scope: 'runtime',
                targetId: null,
                key,
                value: runtime.extensionStorage[key],
                fullKey: fullKey('runtime', null, key)
            });
        });
        runtime.targets.filter(isSyncableTarget).forEach(target => {
            Object.keys(target.extensionStorage || {}).forEach(key => {
                fn({
                    scope: 'target',
                    targetId: target.id,
                    key,
                    value: target.extensionStorage[key],
                    fullKey: fullKey('target', target.id, key)
                });
            });
        });
    }
    poll () {
        if (this._projectRunning) return;
        const collab = window.dimodCollab;
        const seen = new Set();
        let changed = false;
        this.forEachEntry(entry => {
            seen.add(entry.fullKey);
            const json = this.stringify(entry);
            if (json === null) return;
            if (this.snapshots.get(entry.fullKey) === json) return;
            this.snapshots.set(entry.fullKey, json);
            changed = true;
            if (collab) {
                collab.sendExtensionData({scope: entry.scope, targetId: entry.targetId, key: entry.key, value: entry.value});
            }
        });
        this.snapshots.forEach((json, key) => {
            if (seen.has(key)) return;
            this.snapshots.delete(key);
            changed = true;
            const [scope, targetIdOrKey, maybeKey] = key.split(':');
            const targetId = scope === 'runtime' ? null : targetIdOrKey;
            const storageKey = scope === 'runtime' ? targetIdOrKey : maybeKey;
            if (collab) collab.sendExtensionData({scope, targetId, key: storageKey, deleted: true});
        });
        if (changed) this.props.vm.runtime.emitProjectChanged();
    }
    handleRemoteExtensionData (payload) {
        if (!payload || !payload.scope || !payload.key) return;
        const runtime = this.props.vm.runtime;
        let storage;
        if (payload.scope === 'runtime') { storage = runtime.extensionStorage; } else {
            const target = runtime.getTargetById(payload.targetId);
            if (!target) return;
            storage = target.extensionStorage;
        }
        if (payload.deleted) { delete storage[payload.key]; } else { storage[payload.key] = payload.value; }
        const key = fullKey(payload.scope, payload.targetId, payload.key);
        if (payload.deleted) { this.snapshots.delete(key); } else { this.snapshots.set(key, this.stringify({fullKey: key, key: payload.key, value: payload.value})); }
        runtime.emitProjectChanged();
    }
    render () { return null; }
}
DimodCollabExtensionData.propTypes = {vm: PropTypes.instanceOf(VM).isRequired};
const VIEWER_TIMEOUT = 15000;
const POLL_INTERVAL = 500;
class DimodCollabPresence extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, ['attachCollabListener', 'handleRemoteViewing', 'handleTargetsUpdate', 'tick']);
        this.state = {tickVersion: 0};
        this.viewers = {};
        this.lastBroadcastTargetId = null;
    }
    componentDidMount () {
        this.attachCollabListener();
        this.props.vm.addListener('targetsUpdate', this.handleTargetsUpdate);
        this.handleTargetsUpdate();
        this._pollInterval = setInterval(this.tick, POLL_INTERVAL);
        window.dimodCollabViewers = this.viewers;
    }
    componentWillUnmount () {
        this.props.vm.removeListener('targetsUpdate', this.handleTargetsUpdate);
        clearInterval(this._pollInterval);
        window.removeEventListener('dimod:collab-ready', this.attachCollabListener);
        if (window.dimodCollab && window.dimodCollab.onViewingUpdate === this.handleRemoteViewing) {
            window.dimodCollab.onViewingUpdate = null;
        }
        if (window.dimodCollabViewers === this.viewers) window.dimodCollabViewers = null;
    }
    attachCollabListener () {
        if (window.dimodCollab) { window.dimodCollab.onViewingUpdate = this.handleRemoteViewing; return; }
        window.addEventListener('dimod:collab-ready', this.attachCollabListener, {once: true});
    }
    handleTargetsUpdate () {
        const target = this.props.vm.editingTarget;
        const targetId = target && target.id;
        if (!targetId || targetId === this.lastBroadcastTargetId) return;
        this.lastBroadcastTargetId = targetId;
        if (window.dimodCollab) window.dimodCollab.sendViewingUpdate({targetId});
    }
    handleRemoteViewing (payload, fromUserId) {
        this.viewers[fromUserId] = {
            targetId: payload.targetId,
            assetKind: payload.assetKind || null,
            assetIndex: typeof payload.assetIndex === 'number' ? payload.assetIndex : null,
            username: payload.fromUsername || '?',
            updatedAt: Date.now()
        };
        this.forceUpdate();
        window.dispatchEvent(new CustomEvent('dimod:viewing-update'));
    }
    tick () {
        const now = Date.now();
        let changed = false;
        Object.keys(this.viewers).forEach(userId => {
            if (now - this.viewers[userId].updatedAt > VIEWER_TIMEOUT) { delete this.viewers[userId]; changed = true; }
        });
        if (changed) window.dispatchEvent(new CustomEvent('dimod:viewing-update'));
        this.setState(state => ({tickVersion: state.tickVersion + (changed ? 1 : 0) + 1}));
    }
    renderDot (key, rect, offsetIndex, userId) {
        return (
            <div
                key={key}
                title="Someone's viewing this"
                style={{
                    position: 'fixed',
                    left: rect.right - 8 - (offsetIndex * 10),
                    top: rect.top + 4,
                    width: 10, height: 10, borderRadius: '50%',
                    background: colorForUserId(userId),
                    border: '1.5px solid #fff',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                    zIndex: 10,
                    pointerEvents: 'none'
                }}
            />
        );
    }
    render () {
        const now = Date.now();
        const byTarget = {};
        const byAsset = {};
        Object.keys(this.viewers).forEach(userId => {
            const v = this.viewers[userId];
            if (now - v.updatedAt > VIEWER_TIMEOUT) return;
            (byTarget[v.targetId] = byTarget[v.targetId] || []).push(userId);
            if (v.assetKind && v.assetIndex !== null) {
                const key = `${v.assetKind}:${v.assetIndex}`;
                (byAsset[key] = byAsset[key] || []).push(userId);
            }
        });
        const dots = [];
        Object.keys(byTarget).forEach(targetId => {
            const card = document.querySelector(`[data-dimod-target-id="${CSS.escape(targetId)}"]`);
            if (!card) return;
            const rect = card.getBoundingClientRect();
            byTarget[targetId].forEach((userId, i) => { dots.push(this.renderDot(`t-${targetId}-${userId}`, rect, i, userId)); });
        });
        Object.keys(byAsset).forEach(key => {
            const [kind, index] = key.split(':');
            const card = document.querySelector(
                `[data-dimod-asset-kind="${CSS.escape(kind)}"] [data-dimod-asset-index="${CSS.escape(index)}"]`);
            if (!card) return;
            const rect = card.getBoundingClientRect();
            byAsset[key].forEach((userId, i) => { dots.push(this.renderDot(`a-${key}-${userId}`, rect, i, userId)); });
        });
        if (dots.length === 0) return null;
        return <React.Fragment>{dots}</React.Fragment>;
    }
}
DimodCollabPresence.propTypes = {vm: PropTypes.any.isRequired};
export {dimodCollabBanner as DimodCollabBanner, DimodCollabChat, DimodCollabCursors, DimodCollabExtensionApproval, DimodCollabExtensionData, DimodCollabPresence};
