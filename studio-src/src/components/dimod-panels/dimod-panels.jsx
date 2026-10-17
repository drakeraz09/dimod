import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import classNames from 'classnames';
import {getStageScale, setStageScale} from '../../lib/dimod-vm-patches';
import {isFocusMode, FOCUS_MODE_EVENT} from '../../lib/dimod-editor';
import styles from './dimod-panels.css';
const STORAGE_KEY = 'dimod-panel-layout';
const MIN_FLEX_PX = 180;
const readLayout = () => {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (!stored || typeof stored !== 'object') return {};
        return stored;
    } catch (e) { return {}; }
};
const writeLayout = layout => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch (e) {
    }
};
class DimodPanels extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleDragStart', 'handleDragOver', 'handleDrop', 'handleDragEnd',
            'handleResizeStart', 'handleResizeMove', 'handleResizeEnd',
            'handleCollapse', 'handleExpand', 'setContainer', 'handleFocusMode', 'handlePanelOrder'
        ]);
        const stored = readLayout();
        this.container = null;
        this.resize = null;
        this.state = {
            order: this.sanitizeOrder(stored.order, props.panels),
            weights: stored.weights || {},
            collapsed: stored.collapsed || {},
            dragKey: null,
            dropKey: null,
            dropAfter: false,
            resizingIndex: null
        };
    }
    componentDidMount () {
        window.addEventListener(FOCUS_MODE_EVENT, this.handleFocusMode);
        window.addEventListener('dimod:panel-order', this.handlePanelOrder);
    }
    componentWillUnmount () {
        window.removeEventListener(FOCUS_MODE_EVENT, this.handleFocusMode);
        window.removeEventListener('dimod:panel-order', this.handlePanelOrder);
        this.detachResize();
        clearTimeout(this._resizeTimer);
    }
    handlePanelOrder (e) {
        if (Array.isArray(e.detail)) this.persist({order: this.sanitizeOrder(e.detail, this.props.panels)});
    }
    sanitizeOrder (order, panels) {
        const keys = panels.map(p => p.key);
        const result = (Array.isArray(order) ? order : []).filter(key => keys.includes(key));
        keys.forEach((key, i) => {
            if (result.includes(key)) return;
            const next = keys.slice(i + 1).find(k => result.includes(k));
            result.splice(next ? result.indexOf(next) : result.length, 0, key);
        });
        return result;
    }
    orderedPanels () {
        const byKey = new Map(this.props.panels.map(p => [p.key, p]));
        return this.sanitizeOrder(this.state.order, this.props.panels)
            .map(key => byKey.get(key))
            .filter(Boolean);
    }
    persist (patch) {
        this.setState(patch, () => {
            writeLayout({order: this.state.order, weights: this.state.weights, collapsed: this.state.collapsed});
            this.announceResize(true);
        });
    }
    weightOf (panel) {
        const weight = this.state.weights[panel.key];
        if (typeof weight === 'number' && weight > 0) return weight;
        return typeof panel.defaultWeight === 'number' ? panel.defaultWeight : 1;
    }
    isCollapsed (panel) {
        const stored = this.state.collapsed[panel.key];
        return panel.collapsible && (typeof stored === 'undefined' ? !!panel.defaultCollapsed : !!stored);
    }
    setCollapsed (key, value) { this.persist({collapsed: {...this.state.collapsed, [key]: value}}); }
    handleCollapse (e) { this.setCollapsed(e.currentTarget.dataset.key, true); }
    handleExpand (e) { this.setCollapsed(e.currentTarget.dataset.key, false); }
    setContainer (el) { this.container = el; }
    handleDragStart (e) {
        const key = e.currentTarget.dataset.key;
        this.setState({dragKey: key, dropKey: null});
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', key); } catch (err) {
        }
    }
    handleDragOver (e) {
        const key = e.currentTarget.dataset.panelKey;
        if (!this.state.dragKey || this.state.dragKey === key) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        const after = (e.clientX - rect.left) > (rect.width / 2);
        if (this.state.dropKey !== key || this.state.dropAfter !== after) { this.setState({dropKey: key, dropAfter: after}); }
    }
    handleDrop (e) {
        const key = e.currentTarget.dataset.panelKey;
        e.preventDefault();
        const {dragKey, dropAfter} = this.state;
        this.setState({dragKey: null, dropKey: null});
        if (!dragKey || dragKey === key) return;
        const order = this.orderedPanels().map(p => p.key)
            .filter(k => k !== dragKey);
        const target = order.indexOf(key);
        order.splice(target === -1 ? order.length : target + (dropAfter ? 1 : 0), 0, dragKey);
        this.persist({order});
    }
    handleDragEnd () { this.setState({dragKey: null, dropKey: null}); }
    handleResizeStart (e) {
        const index = Number(e.currentTarget.dataset.index);
        if (e.button !== 0) return;
        e.preventDefault();
        const panels = this.visiblePanels();
        const left = panels[index];
        const right = panels[index + 1];
        if (!left || !right) return;
        const touchesStage = left.kind === 'fixed' || right.kind === 'fixed';
        if (e.altKey && touchesStage) {
            this.resize = {stage: true, startX: e.clientX, grows: right.kind === 'fixed', stageScale: getStageScale()};
            this.setState({resizingIndex: index});
            window.addEventListener('mousemove', this.handleResizeMove);
            window.addEventListener('mouseup', this.handleResizeEnd);
            return;
        }
        let before = null;
        for (let i = index; i >= 0 && !before; i--) {
            if (panels[i].kind !== 'fixed') before = panels[i];
        }
        let after = null;
        for (let i = index + 1; i < panels.length && !after; i++) {
            if (panels[i].kind !== 'fixed') after = panels[i];
        }
        if (!before || !after) return;
        const sizes = this.measure();
        this.resize = {
            before,
            after,
            startX: e.clientX,
            beforePx: sizes.get(before.key) || 0,
            afterPx: sizes.get(after.key) || 0,
            beforeWeight: this.weightOf(before),
            afterWeight: this.weightOf(after)
        };
        this.setState({resizingIndex: index});
        window.addEventListener('mousemove', this.handleResizeMove);
        window.addEventListener('mouseup', this.handleResizeEnd);
    }
    measure () {
        const sizes = new Map();
        if (!this.container) return sizes;
        for (const child of this.container.children) {
            const key = child.dataset && child.dataset.panelKey;
            if (key) sizes.set(key, child.getBoundingClientRect().width);
        }
        return sizes;
    }
    handleResizeMove (e) {
        const resize = this.resize;
        if (!resize) return;
        const delta = e.clientX - resize.startX;
        if (resize.stage) {
            setStageScale(resize.stageScale + ((resize.grows ? -delta : delta) / 480));
            this.announceResize();
            return;
        }
        const {before, after} = resize;
        const total = resize.beforePx + resize.afterPx;
        if (total <= 0) return;
        const clamped = Math.max(MIN_FLEX_PX - resize.beforePx, Math.min(resize.afterPx - MIN_FLEX_PX, delta));
        const totalWeight = resize.beforeWeight + resize.afterWeight;
        const beforeWeight = totalWeight * ((resize.beforePx + clamped) / total);
        this.setState({
            weights: {
                ...this.state.weights,
                [before.key]: Math.max(0.05, beforeWeight),
                [after.key]: Math.max(0.05, totalWeight - beforeWeight)
            }
        }, this.announceResize);
    }
    handleResizeEnd () {
        this.detachResize();
        this.setState({resizingIndex: null}, () => { this.persist({}); this.announceResize(true); });
    }
    announceResize (immediate) {
        if (immediate) {
            clearTimeout(this._resizeTimer);
            this._resizeTimer = null;
            window.dispatchEvent(new Event('resize'));
            return;
        }
        if (this._resizeTimer) return;
        this._resizeTimer = setTimeout(() => { this._resizeTimer = null; window.dispatchEvent(new Event('resize')); }, 80);
    }
    detachResize () {
        this.resize = null;
        window.removeEventListener('mousemove', this.handleResizeMove);
        window.removeEventListener('mouseup', this.handleResizeEnd);
    }
    handleFocusMode () { this.forceUpdate(() => this.announceResize(true)); }
    visiblePanels () {
        if (isFocusMode()) return this.orderedPanels().filter(panel => panel.key === 'editor');
        return this.orderedPanels().filter(panel => !this.isCollapsed(panel));
    }
    renderGrip (panel) {
        const dragging = this.state.dragKey === panel.key;
        return (
            <div
                className={classNames(styles.grip, {[styles.gripDragging]: dragging})}
                draggable
                data-key={panel.key}
                title="Drag to move this panel"
                onDragStart={this.handleDragStart}
                onDragEnd={this.handleDragEnd}
            >
                <span className={styles.gripLabel}>{panel.label}</span>
                {panel.collapsible ? (
                    <button
                        className={styles.gripButton}
                        data-key={panel.key}
                        title={`Hide ${panel.label}`}
                        onClick={this.handleCollapse}
                    >{'✕'}</button>
                ) : null}
            </div>
        );
    }
    render () {
        const visible = this.visiblePanels();
        const collapsed = isFocusMode() ? [] : this.orderedPanels().filter(panel => this.isCollapsed(panel));
        const slot = new Map(visible.map((panel, index) => [panel.key, index]));
        return (
            <div
                className={classNames(styles.panels, {
                    [styles.resizing]: this.state.resizingIndex !== null,
                    [styles.dragging]: this.state.dragKey !== null
                })}
                ref={this.setContainer}
            >
                {this.props.panels.map(panel => {
                    const isDropTarget = this.state.dragKey && this.state.dropKey === panel.key;
                    const hidden = !slot.has(panel.key);
                    return (
                        <div
                            key={panel.key}
                            data-panel-key={panel.key}
                            className={classNames(
                                styles.panel,
                                styles[panel.kind === 'fixed' ? 'panelFixed' : 'panelFlex'],
                                {
                                    [styles.panelHidden]: hidden,
                                    [styles.dropBefore]: isDropTarget && !this.state.dropAfter,
                                    [styles.dropAfter]: isDropTarget && this.state.dropAfter
                                }
                            )}
                            style={panel.kind === 'fixed' ? {order: hidden ? 0 : (slot.get(panel.key) * 2) + 1} : {
                                order: hidden ? 0 : (slot.get(panel.key) * 2) + 1,
                                flexGrow: this.weightOf(panel),
                                maxWidth: panel.maxWidth
                            }}
                            onDragOver={this.handleDragOver}
                            onDrop={this.handleDrop}
                        >
                            {this.renderGrip(panel)}
                            <div className={styles.panelBody}>{panel.element}</div>
                        </div>
                    );
                })}
                {visible.slice(1).map((panel, index) => (
                    <div
                        key={`divider-${index}`}
                        className={classNames(styles.divider, {[styles.dividerActive]: this.state.resizingIndex === index})}
                        style={{order: (index + 1) * 2}}
                        data-index={index}
                        title="Drag to resize. Hold Alt next to the stage to resize the stage."
                        onMouseDown={this.handleResizeStart}
                    />
                ))}
                {collapsed.map((panel, index) => (
                    <button
                        key={`rail-${panel.key}`}
                        className={styles.rail}
                        style={{order: 1000 + index}}
                        data-key={panel.key}
                        title={`Show ${panel.label}`}
                        onClick={this.handleExpand}
                    >
                        <span className={styles.railLabel}>{panel.label}</span>
                    </button>
                ))}
            </div>
        );
    }
}
DimodPanels.propTypes = {
    panels: PropTypes.arrayOf(PropTypes.shape({
        key: PropTypes.string.isRequired,
        label: PropTypes.string.isRequired,
        kind: PropTypes.oneOf(['flex', 'fixed']),
        collapsible: PropTypes.bool,
        defaultCollapsed: PropTypes.bool,
        defaultWeight: PropTypes.number,
        maxWidth: PropTypes.string,
        element: PropTypes.node
    })).isRequired
};
export default DimodPanels;
