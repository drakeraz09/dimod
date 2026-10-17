import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';
import {
    Editor,
    prefs,
    savePrefs,
    showMenu,
    evalNumber,
    installTooltips,
    iconsIcon as icon,
    keyAt,
    hasKeyAt,
    removeKeyAt,
    setKey,
    canBeRandom,
    setKeysRandom,
    setKeysRandomEnd,
    staticParent,
    isAncestor,
    setTrackExpr,
    canHaveExpr,
    setKeysExpr,
    addImagesAsParts,
    setAnimationDialogHost,
    SNIPPETS,
    DRAW_TOOLS,
    drawTarget,
    newDrawingFrame
} from '../../lib/dimod-animation/editor';
import undoIcon from '../sound-editor/icon--undo.svg';
import redoIcon from '../sound-editor/icon--redo.svg';
import gridIcon from './grid.svg';
import onionIcon from './onion-toggle.svg';
import snapIcon from './snap-toggle.svg';
import drawPenIcon from './draw-pen.svg';
import drawLineIcon from './draw-line.svg';
import drawRectIcon from './draw-rect.svg';
import drawEllipseIcon from './draw-ellipse.svg';
import drawSelectIcon from './draw-select.svg';
import drawFrameIcon from './draw-frame.svg';
import drawDupeIcon from './draw-dupe.svg';
import drawFillIcon from './draw-fill.svg';
import drawEraserIcon from './draw-eraser.svg';
import zoomInIcon from './zoom-in.svg';
import zoomOutIcon from './zoom-out.svg';
import styles from './animation-editor.css';
import {
    TD,
    BLEND_MODES,
    STYLE_TRACKS,
    MASK_TRACKS,
    easeFnFor,
    applyEase,
    splitEase,
    EASE_FAMS,
    THIS_SPRITE,
    sameSec,
    pickFiles,
    EXPR_COMPLETIONS,
    compileExpr,
    exprBody,
    checkExpr,
    EXPR_HELP,
    Sampler
} from '../../lib/dimod-animation/core';
import DeleteButton from '../delete-button/delete-button.jsx';
import itemStyles from '../sprite-selector-item/sprite-selector-item.css';
import selectorStyles from '../asset-panel/selector.css';
import {DimodFullscreenButton} from '../dimod-fullscreen/dimod-fullscreen.jsx';
import Box from '../box/box.jsx';
import Modal from '../../containers/modal.jsx';
import promptStyles from '../prompt/prompt.css';
import settingsStyles from '../tw-settings-modal/settings-modal.css';
import styles$1 from './dialogs/dialogs.css';
import {
    setExprDataNames,
    exprToolboxXML,
    EXPR_BLOCK,
    blocksToExpr,
    isExprBlocksXML,
    exprToBlocksXML
} from '../../lib/dimod-animation/blocks';
import {loadMonaco, monaco, monacoReady, monacoThemeName} from '../../lib/dimod-ui';
import styles$2 from './dialogs/expression-dialog.css';
import LazyScratchBlocks from '../../lib/tw-lazy-scratch-blocks';
import {BLOCKS_DEFAULT_SCALE} from '../../lib/layout-constants';
const KIcon = ({name, className}) => (
    <span aria-hidden="true" className={classNames(styles.kicon, className)} dangerouslySetInnerHTML={{__html: icon(name)}} />
);
KIcon.propTypes = {className: PropTypes.string, name: PropTypes.string.isRequired};
const ToolButton = ({icon: iconName, title, kbd, on, disabled, danger, onClick, children, className}) => (
    <button
        aria-label={title}
        aria-pressed={typeof on === 'boolean' ? on : undefined}
        className={classNames(children ? styles.labelButton : styles.toolButton, {
            [styles.on]: on,
            [styles.danger]: danger
        }, className)}
        disabled={disabled}
        title={kbd ? `${title} (${kbd})` : title}
        type="button"
        onClick={onClick}
    >
        {iconName ? <KIcon name={iconName} /> : null}
        {children ? <span>{children}</span> : null}
    </button>
);
ToolButton.propTypes = {
    children: PropTypes.node,
    className: PropTypes.string,
    danger: PropTypes.bool,
    disabled: PropTypes.bool,
    icon: PropTypes.string,
    kbd: PropTypes.string,
    on: PropTypes.bool,
    onClick: PropTypes.func,
    title: PropTypes.string.isRequired
};
class TextField extends React.Component {
    constructor (props) {
        super(props);
        this.state = {text: null};
        this.handleChange = e => this.setState({text: e.target.value});
        this.handleBlur = () => this.commit();
        this.handleKeyDown = e => {
            e.stopPropagation();
            if (e.key === 'Enter') e.target.blur();
            if (e.key === 'Escape') this.setState({text: null}, () => e.target.blur());
        };
    }
    commit () {
        if (this.state.text !== null && this.state.text !== this.props.value) this.props.onCommit(this.state.text);
        this.setState({text: null});
    }
    render () {
        const {value, placeholder, className, title} = this.props;
        return (
            <input
                aria-label={title || placeholder}
                className={classNames(styles.textField, className)}
                placeholder={placeholder}
                spellCheck="false"
                title={title}
                type="text"
                value={this.state.text === null ? value : this.state.text}
                onBlur={this.handleBlur}
                onChange={this.handleChange}
                onKeyDown={this.handleKeyDown}
            />
        );
    }
}
TextField.propTypes = {
    className: PropTypes.string,
    onCommit: PropTypes.func.isRequired,
    placeholder: PropTypes.string,
    title: PropTypes.string,
    value: PropTypes.string
};
const handler = (owner, id, fn) => {
    if (!owner.dimodHandlers) owner.dimodHandlers = new Map();
    let entry = owner.dimodHandlers.get(id);
    if (entry) { entry.fn = fn; } else { entry = {fn, call: (...args) => entry.fn(...args)}; owner.dimodHandlers.set(id, entry); }
    return entry.call;
};
const optionOf = o => (o !== null && typeof o === 'object' ? o : {value: o, label: String(o)});
class Dropdown extends React.Component {
    constructor (props) { super(props); this.handleOpen = this.handleOpen.bind(this); }
    handleOpen (e) {
        const el = e.currentTarget;
        const {options, value, onChange} = this.props;
        showMenu(options.map(optionOf).map(o => ({
            label: o.label,
            checked: String(o.value) === String(value),
            action: () => onChange(o.value)
        })), el, {minWidth: el.offsetWidth});
    }
    render () {
        const {className, options, placeholder, title, value} = this.props;
        const current = options.map(optionOf).find(o => String(o.value) === String(value));
        let text = String(value);
        if (current) text = current.label;
        else if (placeholder) text = placeholder;
        return (
            <button
                aria-haspopup="menu"
                aria-label={title}
                className={classNames(styles.dropdown, className)}
                title={title}
                type="button"
                onClick={this.handleOpen}
            >
                <span className={styles.dropdownText}>{text}</span>
                <KIcon className={styles.dropdownCaret} name="chevronDown" />
            </button>
        );
    }
}
Dropdown.propTypes = {
    className: PropTypes.string,
    onChange: PropTypes.func.isRequired,
    options: PropTypes.arrayOf(PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.number,
        PropTypes.shape({
            label: PropTypes.string.isRequired,
            value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired
        })
    ])).isRequired,
    placeholder: PropTypes.string,
    title: PropTypes.string.isRequired,
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired
};
const fmt = (v, precision) => {
    if (!Number.isFinite(v)) return '0';
    const k = Math.pow(10, precision);
    return String(Math.round(v * k) / k);
};
class ScrubField extends React.Component {
    constructor (props) {
        super(props);
        this.state = {editing: false, text: ''};
        this.inputRef = React.createRef();
        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.handleFocus = this.handleFocus.bind(this);
        this.handleBlur = this.handleBlur.bind(this);
        this.handleChange = this.handleChange.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleDoubleClick = this.handleDoubleClick.bind(this);
    }
    clamp (v) { const {min, max} = this.props; return Math.min(max, Math.max(min, v)); }
    handleMouseDown (e) {
        if (e.button !== 0 || this.state.editing) return;
        e.preventDefault();
        const startX = e.clientX;
        const startV = Number(this.props.value) || 0;
        let moved = false;
        let last = startV;
        const move = ev => {
            const dx = ev.clientX - startX;
            if (!moved && Math.abs(dx) < 3) return;
            if (!moved) { moved = true; this.props.onChange(startV, 'start'); document.body.style.cursor = 'ew-resize'; }
            let k = 1;
            if (ev.shiftKey) k = 0.1;
            else if (ev.ctrlKey || ev.metaKey) k = 10;
            last = this.clamp(startV + (dx * this.props.step * k));
            this.props.onChange(last, 'drag');
        };
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            document.body.style.cursor = '';
            if (moved) { this.props.onChange(last, 'end'); } else {
                this.setState({editing: true, text: fmt(startV, this.props.precision)}, () => {
                    const input = this.inputRef.current;
                    if (input) { input.focus(); input.select(); }
                });
            }
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    }
    handleFocus () {
        if (!this.state.editing) this.setState({editing: true, text: fmt(Number(this.props.value), this.props.precision)});
    }
    commit () {
        const v = evalNumber(this.state.text);
        this.setState({editing: false});
        if (v === null) return;
        this.props.onChange(this.clamp(v), 'typed');
    }
    handleBlur () {
        if (this.state.editing) this.commit();
    }
    handleChange (e) { this.setState({text: e.target.value}); }
    handleKeyDown (e) {
        e.stopPropagation();
        if (e.key === 'Enter') { this.inputRef.current.blur(); } else if (e.key === 'Escape') {
            this.setState({editing: false});
            this.inputRef.current.blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const step = this.props.step < 1 ? this.props.step * 10 : this.props.step;
            const v = this.clamp((Number(this.props.value) || 0) + ((e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
            this.props.onChange(v, 'typed');
            this.setState({text: fmt(v, this.props.precision)});
        }
    }
    handleDoubleClick (e) {
        if (this.props.onReset && e.target.getAttribute('data-label')) this.props.onReset();
    }
    render () {
        const {label, unit, value, precision, title, state, className, onContextMenu} = this.props;
        return (
            <div
                className={classNames(styles.scrub, {
                    [styles.keyed]: state === 'keyed',
                    [styles.animated]: state === 'animated',
                    [styles.expr]: state === 'expr'
                }, className)}
                title={title}
                onContextMenu={onContextMenu}
                onDoubleClick={this.handleDoubleClick}
                onMouseDown={this.handleMouseDown}
            >
                {label ? <span className={styles.scrubLabel} data-label="1">{label}</span> : null}
                <input
                    className={styles.scrubInput}
                    ref={this.inputRef}
                    spellCheck="false"
                    type="text"
                    value={this.state.editing ? this.state.text : fmt(Number(value), precision)}
                    onBlur={this.handleBlur}
                    onChange={this.handleChange}
                    onFocus={this.handleFocus}
                    onKeyDown={this.handleKeyDown}
                />
                {unit ? <span className={styles.scrubUnit}>{unit}</span> : null}
            </div>
        );
    }
}
ScrubField.propTypes = {
    className: PropTypes.string,
    label: PropTypes.string,
    max: PropTypes.number,
    min: PropTypes.number,
    onChange: PropTypes.func.isRequired,
    onContextMenu: PropTypes.func,
    onReset: PropTypes.func,
    precision: PropTypes.number,
    state: PropTypes.oneOf(['keyed', 'animated', 'expr', '']),
    step: PropTypes.number,
    title: PropTypes.string,
    unit: PropTypes.string,
    value: PropTypes.number
};
ScrubField.defaultProps = {max: Infinity, min: -Infinity, precision: 2, state: '', step: 1, value: 0};
class Switch extends React.Component {
    constructor (props) { super(props); this.handleChange = this.handleChange.bind(this); }
    handleChange (e) { this.props.onChange(e.target.checked); }
    render () {
        const {checked, title} = this.props;
        return (
            <label className={styles.switch} title={title}>
                <input aria-label={title} checked={!!checked} type="checkbox" onChange={this.handleChange} />
                <span />
            </label>
        );
    }
}
Switch.propTypes = {checked: PropTypes.bool, onChange: PropTypes.func.isRequired, title: PropTypes.string};
const toHex = n => `#${(Math.max(0, Math.min(0xffffff, Math.round(n))) >>> 0).toString(16)
    .padStart(6, '0')}`;
class ColorSwatch extends React.Component {
    constructor (props) {
        super(props);
        this.inputRef = React.createRef();
        this.handleNativeChange = e => this.props.onCommit(parseInt(e.target.value.slice(1), 16));
        this.handleInput = e => this.props.onChange(parseInt(e.target.value.slice(1), 16));
    }
    componentDidMount () { this.inputRef.current.addEventListener('change', this.handleNativeChange); }
    componentWillUnmount () { this.inputRef.current.removeEventListener('change', this.handleNativeChange); }
    render () {
        const {value, onStart, title} = this.props;
        return (
            <label className={styles.swatch} style={{background: toHex(value)}} title={title}>
                <input
                    aria-label={title}
                    ref={this.inputRef}
                    type="color"
                    value={toHex(value)}
                    onChange={this.handleInput}
                    onClick={onStart}
                />
            </label>
        );
    }
}
ColorSwatch.propTypes = {
    onChange: PropTypes.func.isRequired,
    onCommit: PropTypes.func.isRequired,
    onStart: PropTypes.func,
    title: PropTypes.string,
    value: PropTypes.number
};
const closedSections = new Set(['Effects', 'Style', 'Mask', 'Advanced', 'Music']);
class Section extends React.Component {
    constructor (props) {
        super(props);
        this.state = {closed: closedSections.has(props.title)};
        this.handleToggle = this.handleToggle.bind(this);
    }
    handleToggle () {
        const closed = !this.state.closed;
        if (closed) closedSections.add(this.props.title);
        else closedSections.delete(this.props.title);
        this.setState({closed});
    }
    render () {
        const {title, badge, children} = this.props;
        return (
            <div className={classNames(styles.section, {[styles.sectionClosed]: this.state.closed})}>
                <button
                    aria-expanded={!this.state.closed}
                    className={styles.sectionHead}
                    type="button"
                    onClick={this.handleToggle}
                >
                    <KIcon className={styles.caret} name="chevronDown" />
                    <span>{title}</span>
                    {badge ? <span className={styles.badge}>{badge}</span> : null}
                </button>
                {this.state.closed ? null : <div className={styles.sectionBody}>{children}</div>}
            </div>
        );
    }
}
Section.propTypes = {badge: PropTypes.string, children: PropTypes.node, title: PropTypes.string.isRequired};
const EFFECT_TRACKS = ['fxColor', 'fxBrightness', 'fxGhost', 'fxPixelate', 'fxMosaic', 'fxWhirl', 'fxFisheye',
    'tint', 'blendMode', 'fxCustom', 'fxChromaticX', 'fxChromaticY'];
const ADVANCED_TRACKS = ['skewX', 'skewY', 'pivotX', 'pivotY', 'padding', 'afterimageIntensity', 'afterimageFade',
    'afterimageInterval', 'clipTop', 'clipBottom', 'clipLeft', 'clipRight'];
const LAYER_TRACKS = ['relativeTo', 'followPos', 'followRot', 'followScale', 'visible', 'zIndex'];
const SNAPS = [[1, 'every frame'], [2, '2 frames'], [4, '4 frames'], [0.5, 'half frames'],
    [0.25, 'quarter frames'], [1 / 512, 'off']];
const BEAT_SNAPS = [[32, '1/32 beat'], [16, '1/16 beat'], [12, '1/12 beat (triplet)'], [8, '1/8 beat'],
    [6, '1/6 beat (triplet)'], [4, '1/4 beat'], [3, '1/3 beat (triplet)'], [2, '1/2 beat'], [1, 'beat'],
    [1 / 2, '2 beats'], [1 / 4, 'bar (4)']];
const Row$1 = ({label, color, children}) => (
    <div className={styles.row}>
        {label ? (
            <span className={styles.rowLabel}>
                {color ? <i style={{background: color}} /> : null}
                {label}
            </span>
        ) : null}
        {children}
    </div>
);
Row$1.propTypes = {children: PropTypes.node, color: PropTypes.string, label: PropTypes.string};
const Hint = ({children}) => <div className={styles.hint}>{children}</div>;
Hint.propTypes = {children: PropTypes.node};
const EaseCurve = ({name, kf}) => {
    const w = 60;
    const h = 28;
    const bez = kf && kf.ease === 'Bezier' ? kf.bez : null;
    const fn = name === 'Bezier' ? easeFnFor(bez ? {ease: 'Bezier', bez} : {ease: 'Bezier'}) : x => applyEase(name, x);
    let d = '';
    for (let i = 0; i <= w; i += 2) {
        const x = i / w;
        let v;
        if (name === 'Step') v = x < 0.999 ? 0 : 1;
        else v = fn(x);
        d += `${i ? 'L' : 'M'}${i},${(h - 4 - (v * (h - 8))).toFixed(1)}`;
    }
    return (
        <svg className={styles.easeCurve} viewBox={`0 0 ${w} ${h}`}>
            <path d={d} />
        </svg>
    );
};
EaseCurve.propTypes = {kf: PropTypes.object, name: PropTypes.string.isRequired};
class CostumeGrid extends React.PureComponent {
    render () {
        const {binding, current, g, owner} = this.props;
        const st = owner.st;
        const ed = owner.props.ed;
        return (
            <div className={styles.costumes}>
                {binding.costumes.map((c, i) => {
                    const url = ed.costumeThumb(c).url;
                    return (
                        <button
                            className={classNames(styles.costume, {[styles.on]: current === i})}
                            draggable
                            key={`${i}:${c.name}`}
                            style={url ? {backgroundImage: `url("${url}")`} : null}
                            title={`${c.name}... click to key it, or drag it onto the preview`}
                            type="button"
                            onClick={owner.h(`costume:${i}`, () => st.mutate('Set costume',
                                () => setKey(g, 'costume', owner.editTime(g), {name: c.name, index: i}, {ease: 'Step'})))}
                            onDragStart={owner.h(`costumeDrag:${i}`, e => {
                                e.dataTransfer.setData('application/x-ks5-costume', JSON.stringify({
                                    sprite: binding.sprite.name, costume: c.name, index: i, group: g.name
                                }));
                                e.dataTransfer.effectAllowed = 'copy';
                            })}
                        >
                            <em>{i + 1}</em>
                            <span>{c.name}</span>
                        </button>
                    );
                })}
            </div>
        );
    }
}
CostumeGrid.propTypes = {
    binding: PropTypes.object.isRequired,
    current: PropTypes.number,
    g: PropTypes.object.isRequired,
    owner: PropTypes.object.isRequired
};
class Inspector extends React.Component {
    get st () { return this.props.ed.st; }
    h (id, fn) { return handler(this, id, fn); }
    editTime (g) {
        const st = this.st;
        const infos = st.selectedKeyInfos();
        if (infos.length === 1 && infos[0].kind === 'track' && infos[0].group === g) return infos[0].kf.sec;
        return st.playing ? st.sec : st.snap(st.sec);
    }
    keyState (g, key) {
        const tr = g.tracks[key];
        const on = !!(tr && keyAt(tr, this.editTime(g)));
        const hasKeys = !!(tr && tr.keyframes.length);
        let diamond = hasKeys ? 'part' : '';
        if (on) diamond = 'on';
        const here = tr ? keyAt(tr, this.editTime(g)) : null;
        let field = '';
        if ((here && here.expr) || g.exprs[key]) field = 'expr';
        else if (on) field = 'keyed';
        else if (tr && tr.keyframes.length > 1) field = 'animated';
        return {field, diamond};
    }
    diamond (g, key, state, discrete = false) {
        const st = this.st;
        const on = state === 'on';
        const toggle = this.h(`${key}:diamond`, () => {
            const t = this.editTime(g);
            if (hasKeyAt(g, key, t)) { st.mutate('Remove keyframe', () => removeKeyAt(g, key, t)); return; }
            let v = st.currentPose().get(st.groupIndex(g.name), key);
            if (discrete) v = v ? 1 : 0;
            const opts = discrete ? {exact: true, ease: 'Step'} : {exact: true};
            st.mutate('Add keyframe', () => setKey(g, key, t, v, opts));
        });
        return (
            <button
                aria-label={on ? 'Remove keyframe here' : 'Add keyframe here'}
                className={classNames(styles.diamond, {[styles.diamondOn]: on, [styles.diamondPart]: state === 'part'})}
                title={on ? 'Remove keyframe here' : 'Add keyframe here'}
                type="button"
                onClick={toggle}
            >
                <span aria-hidden="true" className={styles.diamondShape} />
            </button>
        );
    }
    propMenu (g, key, e) {
        e.preventDefault();
        const st = this.st;
        const ed = this.props.ed;
        const d = TD[key];
        const tr = g.tracks[key];
        const items = [{heading: d.label}];
        if (!d.str) {
            const here = tr ? keyAt(tr, this.editTime(g)) : null;
            items.push({
                label: here && here.expr ? 'Edit expression here…' : 'Expression here…',
                icon: 'expr',
                action: () => ed.openPropertyExpr(g, key, this.editTime(g))
            });
            items.push({
                label: tr && tr.expr ? 'Edit default expression…' : 'Default expression for every key…',
                icon: 'expr',
                action: () => ed.openTrackExpr(g, key, this.editTime(g))
            });
            if (tr && tr.expr) {
                items.push({
                    label: 'Remove default expression',
                    icon: 'close',
                    action: () => setTrackExpr(st, g.name, key, '', null)
                });
            }
        }
        if (g.exprs[key]) {
            items.push({
                label: 'Remove part-wide expression',
                icon: 'close',
                action: () => st.mutate('Remove expression', () => { delete g.exprs[key]; })
            });
        }
        if (tr) {
            items.push({
                label: 'Show in graph',
                icon: 'graph',
                action: () => { st.selTrack = {group: g.name, key}; ed.timeline.setMode('graph'); }
            });
            items.push({label: 'Select keys', icon: 'marquee', action: () => st.selectKeys(tr.keyframes.map(k => k.id))});
            items.push({
                label: tr.tlHidden ? 'Show in timeline' : 'Hide from timeline',
                icon: tr.tlHidden ? 'eye' : 'eyeOff',
                action: () => ed.timeline.setTrackHidden(g, key, !tr.tlHidden)
            });
        }
        items.push('sep');
        items.push({
            label: 'Reset to default',
            icon: 'undo',
            action: () => st.mutate('Reset', () => setKey(g, key, this.editTime(g), d.def))
        });
        if (tr) {
            items.push({
                label: 'Delete track',
                icon: 'trash',
                danger: true,
                action: () => st.mutate('Delete track', () => { delete g.tracks[key]; })
            });
        }
        showMenu(items, {x: e.clientX, y: e.clientY}, {ctx: true});
    }
    flip (g, key) {
        const st = this.st;
        const t = this.editTime(g);
        const v = st.currentPose().get(st.groupIndex(g.name), key);
        st.mutate(key === 'scaleY' ? 'Flip vertically' : 'Flip horizontally', () => setKey(g, key, t, -v));
    }
    animatedCount (g, keys) {
        const n = keys.filter(k => g.tracks[k] && g.tracks[k].keyframes.length).length;
        return n ? String(n) : null;
    }
    propScrub (g, key, opts = {}) {
        const st = this.st;
        const d = TD[key];
        const gi = st.groupIndex(g.name);
        if (gi < 0) return null;
        const ks = this.keyState(g, key);
        return (
            <div className={styles.cell} key={key}>
                <ScrubField
                    label={opts.short || d.label}
                    max={typeof d.max === 'number' ? d.max : Infinity}
                    min={typeof d.min === 'number' ? d.min : -Infinity}
                    precision={typeof opts.precision === 'number' ? opts.precision : 2}
                    state={ks.field}
                    step={opts.step || (d.unit === 's' ? 0.01 : 1)}
                    title={opts.tip || d.label}
                    unit={d.unit}
                    value={st.currentPose().get(gi, key)}
                    onChange={this.h(`${key}:change`, (v, phase) => {
                        const t = this.editTime(g);
                        if (phase === 'start') st.beginChange(`Set ${d.label}`);
                        else if (phase === 'drag') st.live(() => setKey(g, key, t, v));
                        else if (phase === 'end') st.endChange();
                        else st.mutate(`Set ${d.label}`, () => setKey(g, key, t, v));
                    })}
                    onContextMenu={this.h(`${key}:menu`, e => this.propMenu(g, key, e))}
                    onReset={this.h(`${key}:reset`,
                        () => st.mutate(`Reset ${d.label}`, () => setKey(g, key, this.editTime(g), d.def)))}
                />
                {this.diamond(g, key, ks.diamond)}
            </div>
        );
    }
    propToggle (g, key, label) {
        const st = this.st;
        const gi = st.groupIndex(g.name);
        return (
            <Row$1 color={TD[key].color} key={key} label={label || TD[key].label}>
                <span className={styles.grow} />
                <Switch
                    checked={!!st.currentPose().get(gi, key)}
                    title={label || TD[key].label}
                    onChange={this.h(`${key}:toggle`, v => st.mutate(`Set ${TD[key].label}`,
                        () => setKey(g, key, this.editTime(g), v ? 1 : 0, {ease: 'Step'})))}
                />
                {this.diamond(g, key, this.keyState(g, key).diamond, true)}
            </Row$1>
        );
    }
    propColor (g, key, label) {
        const st = this.st;
        const gi = st.groupIndex(g.name);
        const name = TD[key].label;
        return (
            <Row$1 color={TD[key].color} key={key} label={label || name}>
                <span className={styles.grow} />
                <ToolButton
                    className={styles.mini}
                    icon="undo"
                    title={`Reset ${name}`}
                    onClick={this.h(`${key}:reset`,
                        () => st.mutate(`Reset ${name}`, () => setKey(g, key, this.editTime(g), TD[key].def)))}
                />
                <ColorSwatch
                    title={label || name}
                    value={st.currentPose().get(gi, key)}
                    onChange={this.h(`${key}:color`, v => st.live(() => setKey(g, key, this.editTime(g), v)))}
                    onCommit={this.h(`${key}:colorDone`, () => st.endChange())}
                    onStart={this.h(`${key}:colorStart`, () => st.beginChange(`Set ${name}`))}
                />
                {this.diamond(g, key, this.keyState(g, key).diamond)}
            </Row$1>
        );
    }
    propSelect (g, key, label, options) {
        const st = this.st;
        const tr = g.tracks[key];
        let cur = TD[key].def;
        if (tr && tr.keyframes.length) {
            cur = tr.keyframes[0].value;
            for (const k of tr.keyframes) if (k.sec <= st.sec + 1e-9) cur = k.value;
        }
        return (
            <Row$1 color={TD[key].color} key={key} label={label || TD[key].label}>
                <Dropdown
                    className={styles.grow}
                    options={options}
                    title={label || TD[key].label}
                    value={cur}
                    onChange={this.h(`${key}:select`, v => st.mutate(`Set ${TD[key].label}`,
                        () => setKey(g, key, this.editTime(g), v, {ease: 'Step'})))}
                />
            </Row$1>
        );
    }
    timeField (i) {
        const st = this.st;
        return (
            <ScrubField
                className={styles.grow}
                label="Time"
                min={0}
                precision={3}
                step={1 / st.doc.fps}
                title="When this key is"
                unit="s"
                value={i.kf.sec}
                onChange={this.h('key:time', (v, phase) => {
                    const apply = () => {
                        const tr = i.kind === 'event' ? null : i.track;
                        i.kf.sec = Math.max(0, Math.round(st.snap(v) * 1e6) / 1e6);
                        if (tr) {
                            tr.keyframes = tr.keyframes.filter(k => k === i.kf || !sameSec(k.sec, i.kf.sec));
                            tr.keyframes.sort((a, b) => a.sec - b.sec);
                        } else { st.doc.events.sort((a, b) => a.sec - b.sec); }
                    };
                    if (phase === 'start') st.beginChange('Move key');
                    else if (phase === 'drag') st.live(apply);
                    else if (phase === 'end') st.endChange();
                    else st.mutate('Move key', apply);
                })}
            />
        );
    }
    easePicker (infos) {
        const ed = this.props.ed;
        const eases = [...new Set(infos.map(i => i.kf.ease || 'Linear_Out'))];
        const cur = eases.length === 1 ? eases[0] : null;
        const [fam0, dir0] = cur ? splitEase(cur) : ['', 'Out'];
        let current = fam0;
        if (cur === 'Step' || cur === 'Bezier') current = cur;
        const nameFor = fam => {
            if (fam === 'Step' || fam === 'Bezier') return fam;
            return `${fam}_${fam === 'Linear' ? 'Out' : dir0 || 'Out'}`;
        };
        const options = [
            {value: 'Step', label: 'Hold'},
            ...EASE_FAMS.map(fam => ({value: fam, label: fam})),
            {value: 'Bezier', label: 'Curve'}
        ];
        const directional = cur && cur !== 'Step' && cur !== 'Bezier' && fam0 !== 'Linear';
        return (
            <React.Fragment>
                <Row$1 label="Ease">
                    <Dropdown
                        className={styles.grow}
                        options={options}
                        placeholder="Mixed"
                        title="Easing into these keys"
                        value={cur ? current : ''}
                        onChange={this.h('ease', fam => ed.setEase(nameFor(fam)))}
                    />
                    {cur ? (
                        <EaseCurve kf={infos[0].kf} name={cur} />
                    ) : null}
                </Row$1>
                {directional ? (
                    <div className={styles.segmented}>
                        {['In', 'Out', 'InOut'].map(d => (
                            <button
                                className={classNames(styles.segment, {[styles.on]: d === dir0})}
                                key={d}
                                type="button"
                                onClick={this.h(`easeDir:${d}`, () => ed.setEase(`${fam0}_${d}`))}
                            >
                                {d === 'InOut' ? 'In and out' : d}
                            </button>
                        ))}
                    </div>
                ) : null}
            </React.Fragment>
        );
    }
    keyNumber (id, label, value, unit, apply, title) {
        const st = this.st;
        return (
            <ScrubField
                className={styles.grow}
                label={label}
                title={title || label}
                unit={unit}
                value={value}
                onChange={this.h(id, (v, phase) => {
                    if (phase === 'start') st.beginChange(`Edit ${label.toLowerCase()}`);
                    else if (phase === 'drag') st.live(() => apply(v));
                    else if (phase === 'end') st.endChange();
                    else st.mutate(`Edit ${label.toLowerCase()}`, () => apply(v));
                })}
            />
        );
    }
    valueRows (infos) {
        const st = this.st;
        const rand = infos.filter(canBeRandom);
        const one = infos.length === 1 ? infos[0] : null;
        const numeric = one && ((one.kind === 'track' && TD[one.key].kind === 'num') || one.kind === 'data');
        if (!rand.length && !numeric) return null;
        const allRandom = rand.length > 0 && rand.every(i => i.kf.rand);
        const noneRandom = rand.every(i => !i.kf.rand);
        const unit = one && one.kind === 'track' ? TD[one.key].unit : '';
        const setRandom = on => st.mutate(on ? 'Random value' : 'Fixed value', () => setKeysRandom(rand, on));
        return (
            <React.Fragment>
                {rand.length ? (
                    <div className={styles.segmented}>
                        <button
                            className={classNames(styles.segment, {[styles.on]: noneRandom})}
                            title="The key has one value"
                            type="button"
                            onClick={this.h('value:fixed', () => setRandom(false))}
                        >
                            {'Fixed'}
                        </button>
                        <button
                            className={classNames(styles.segment, {[styles.on]: allRandom})}
                            title={'Each time playback comes to the key (or you scrub over it) ' +
                                'it picks a value between min and max'}
                            type="button"
                            onClick={this.h('value:random', () => setRandom(true))}
                        >
                            {'Random'}
                        </button>
                    </div>
                ) : null}
                {allRandom ? (
                    <div className={styles.grid2}>
                        {this.keyNumber('key:min', 'Min', rand[0].kf.rand.min, unit,
                            v => setKeysRandomEnd(rand, 'min', v), 'The lowest it can pick')}
                        {this.keyNumber('key:max', 'Max', rand[0].kf.rand.max, unit,
                            v => setKeysRandomEnd(rand, 'max', v), 'The highest it can pick')}
                    </div>
                ) : null}
                {numeric && !(one.kf.rand) ? (
                    <Row$1>
                        {this.keyNumber('key:value', 'Value', Number(one.kf.value), unit, v => { one.kf.value = v; })}
                    </Row$1>
                ) : null}
            </React.Fragment>
        );
    }
    keySection (infos) {
        const st = this.st;
        const ed = this.props.ed;
        const n = infos.length;
        const remove = (
            <ToolButton
                danger
                icon="trash"
                kbd="Del"
                title={n === 1 ? 'Delete key' : `Delete ${n} keys`}
                onClick={this.h('key:delete', () => ed.cmd('deleteKeys'))}
            />
        );
        if (n === 1 && infos[0].kind === 'event') {
            const ev = infos[0].kf;
            return (
                <Section title="Event">
                    <Row$1 label="Message">
                        <TextField
                            className={styles.grow}
                            title="Message"
                            value={String(ev.value)}
                            onCommit={this.h('event:rename', v => st.mutate('Rename event', () => {
                                ev.value = v.trim() || 'event';
                            }))}
                        />
                    </Row$1>
                    <Row$1>
                        {this.timeField(infos[0])}
                        {remove}
                    </Row$1>
                </Section>
            );
        }
        const easable = infos.filter(i => i.kind !== 'event');
        const one = n === 1 ? infos[0] : null;
        let title = `${n} keyframes`;
        if (one && one.kind === 'track') title = `${TD[one.key].label} key`;
        else if (one) title = 'Keyframe';
        return (
            <Section title={title}>
                <Row$1>
                    {one ? this.timeField(one) : <span className={classNames(styles.grow, styles.muted)}>
                        {`${n} selected`}
                    </span>}
                    {remove}
                </Row$1>
                {this.valueRows(infos)}
                {easable.length ? this.easePicker(easable) : null}
            </Section>
        );
    }
    exprBar () {
        const st = this.st;
        const ed = this.props.ed;
        const infos = st.selectedKeyInfos().filter(canHaveExpr);
        const exprs = [...new Set(infos.map(i => i.kf.expr || ''))];
        const same = exprs.length === 1 ? exprs[0] : null;
        let note = 'Select keyframes to give them one';
        if (st.selKeys.size && !infos.length) note = 'Events and data keys don\'t have one';
        else if (infos.length && exprs.length > 1) note = 'Different on each key';
        else if (infos.length) note = infos.length === 1 ? 'None on this key' : `None on these ${infos.length} keys`;
        return (
            <div className={styles.exprBar}>
                <div className={styles.exprBarHead}>
                    <KIcon name="expr" />
                    <b>{'Expression'}</b>
                    {infos.length > 1 ? <span className={styles.muted}>{`${infos.length} keys`}</span> : null}
                    <span className={styles.grow} />
                    {infos.some(i => i.kf.expr) ? (
                        <button
                            className={styles.exprClear}
                            title="Remove the expression from the selected keys"
                            type="button"
                            onClick={this.h('expr:clear', () => setKeysExpr(st, infos.map(i => i.kf.id), '', null))}
                        >
                            {'Clear'}
                        </button>
                    ) : null}
                </div>
                <button
                    className={classNames(styles.exprBox, {[styles.exprBoxSet]: !!same})}
                    disabled={!infos.length}
                    title={infos.length ? 'Open the expression editor' : 'Select keyframes first'}
                    type="button"
                    onClick={this.h('expr:open', () => ed.openExpr(infos.map(i => i.kf.id)))}
                >
                    {same ? <code>{`return ${same};`}</code> : <span>{note}</span>}
                </button>
            </div>
        );
    }
    partHead (g) {
        const ed = this.props.ed;
        const thumb = ed.costumeThumbForGroup(g);
        return (
            <div className={styles.partHead}>
                <div className={styles.partThumb} style={thumb ? {backgroundImage: `url("${thumb}")`} : null} />
                <div className={styles.column}>
                    <TextField title="Part name" value={g.name} onCommit={this.h('part:rename', v => ed.renamePart(g, v))} />
                    <div className={styles.row}>
                        <ToolButton
                            icon="sprite"
                            title="Where this part's costumes come from"
                            onClick={this.h('part:sprite', () => ed.changeSpriteDialog(g))}
                        >
                            {g.spriteName === THIS_SPRITE ? 'This sprite' : (g.spriteName || '?')}
                        </ToolButton>
                        <span className={styles.grow} />
                        <ToolButton
                            icon="copy"
                            kbd="Ctrl+D"
                            title="Duplicate part"
                            onClick={this.h('part:duplicate', () => ed.cmd('duplicatePart'))}
                        />
                        <ToolButton
                            icon="trash"
                            kbd="Del"
                            title="Delete part"
                            onClick={this.h('part:delete', () => ed.cmd('deletePart'))}
                        />
                    </div>
                </div>
            </div>
        );
    }
    costumeSection (g, binding) {
        return (
            <Section title="Costume">
                <CostumeGrid
                    binding={binding}
                    current={this.st.currentPose().costume[this.st.groupIndex(g.name)]}
                    g={g}
                    owner={this}
                />
            </Section>
        );
    }
    noCostumes (g) {
        const ed = this.props.ed;
        return (
            <div className={styles.emptyNote}>
                <b>{'No costumes'}</b>
                <div>
                    {g.spriteName === THIS_SPRITE ?
                        'This part draws the costumes of the sprite the animation belongs to.' :
                        `Sprite "${g.spriteName}" isn't in this project.`}
                </div>
                <ToolButton
                    icon="sprite"
                    title="Pick a sprite"
                    onClick={this.h('part:pickSprite', () => ed.changeSpriteDialog(g))}
                >
                    {'Pick a sprite…'}
                </ToolButton>
            </div>
        );
    }
    nineField (g, k, label) {
        const st = this.st;
        const nine = g.nineSlice || {l: 0, r: 0, t: 0, b: 0};
        return (
            <div className={styles.cell} key={k}>
                <ScrubField
                    label={label}
                    min={0}
                    precision={0}
                    unit="px"
                    value={nine[k]}
                    onChange={this.h(`nine:${k}`, (v, phase) => {
                        const apply = () => {
                            g.nineSlice = Object.assign({}, g.nineSlice || {l: 0, r: 0, t: 0, b: 0}, {[k]: v});
                            const n = g.nineSlice;
                            if (!n.l && !n.r && !n.t && !n.b) delete g.nineSlice;
                        };
                        if (phase === 'start') st.beginChange('Nine-slice');
                        else if (phase === 'drag') st.live(apply);
                        else if (phase === 'end') st.endChange();
                        else st.mutate('Nine-slice', apply);
                    })}
                />
            </div>
        );
    }
    partSections (g) {
        const st = this.st;
        const ed = this.props.ed;
        const gi = st.groupIndex(g.name);
        const binding = st.bindings()[gi];
        const par = staticParent(g);
        const others = st.doc.groups.filter(o => o !== g);
        const parents = others.filter(o => !isAncestor(st.doc, g, o));
        let cssFilter = '';
        if (g.tracks.fxCustom) {
            for (const k of g.tracks.fxCustom.keyframes) {
                if (k.sec <= st.sec + 1e-9 || cssFilter === '') cssFilter = k.value;
            }
        }
        const followsSomething = par || (g.tracks.relativeTo && g.tracks.relativeTo.keyframes.length > 1);
        return (
            <React.Fragment>
                {this.partHead(g)}
                {binding ? this.costumeSection(g, binding) : this.noCostumes(g)}
                <Section title="Transform">
                    <div className={styles.grid2}>
                        {this.propScrub(g, 'x', {short: 'X'})}
                        {this.propScrub(g, 'y', {short: 'Y'})}
                        {this.propScrub(g, 'scaleX', {short: 'W'})}
                        {this.propScrub(g, 'scaleY', {short: 'H'})}
                        {this.propScrub(g, 'rotation', {short: 'Turn'})}
                        {this.propScrub(g, 'alpha', {short: 'Alpha'})}
                    </div>
                    <Row$1>
                        <ToolButton
                            icon="mirror"
                            title="Flip horizontally (negates W)"
                            onClick={this.h('flipH', () => this.flip(g, 'scaleX'))}
                        >
                            {'Flip H'}
                        </ToolButton>
                        <ToolButton
                            icon="mirrorV"
                            title="Flip vertically (negates H)"
                            onClick={this.h('flipV', () => this.flip(g, 'scaleY'))}
                        >
                            {'Flip V'}
                        </ToolButton>
                    </Row$1>
                </Section>
                <Section badge={this.animatedCount(g, LAYER_TRACKS)} title="Layer">
                    <Row$1 color={TD.relativeTo.color} label="Parent">
                        <Dropdown
                            className={styles.grow}
                            options={[{value: '', label: 'none'}, ...parents.map(o => ({value: o.name, label: o.name}))]}
                            title="Parent"
                            value={par || ''}
                            onChange={this.h('parent', v => ed.setParent(g.name, v || null))}
                        />
                    </Row$1>
                    {followsSomething ? (
                        <React.Fragment>
                            {this.propToggle(g, 'followPos', 'Follow move')}
                            {this.propToggle(g, 'followRot', 'Follow turn')}
                            {this.propToggle(g, 'followScale', 'Follow size')}
                        </React.Fragment>
                    ) : null}
                    {this.propToggle(g, 'visible', 'Visible')}
                    <div className={styles.grid2}>
                        {this.propScrub(g, 'zIndex', {short: 'Z', step: 0.2, precision: 0, tip: 'Higher Z draws further back'})}
                    </div>
                </Section>
                <Section badge={this.animatedCount(g, EFFECT_TRACKS)} title="Effects">
                    <div className={styles.grid2}>
                        {this.propScrub(g, 'fxColor', {short: 'Color'})}
                        {this.propScrub(g, 'fxBrightness', {short: 'Bright'})}
                        {this.propScrub(g, 'fxGhost', {short: 'Ghost'})}
                        {this.propScrub(g, 'fxPixelate', {short: 'Pixel'})}
                        {this.propScrub(g, 'fxMosaic', {short: 'Mosaic'})}
                        {this.propScrub(g, 'fxWhirl', {short: 'Whirl'})}
                        {this.propScrub(g, 'fxFisheye', {short: 'Fisheye'})}
                        {this.propScrub(g, 'fxChromaticX', {short: 'RGB X'})}
                        {this.propScrub(g, 'fxChromaticY', {short: 'RGB Y'})}
                    </div>
                    {this.propColor(g, 'tint', 'Tint')}
                    {this.propSelect(g, 'blendMode', 'Blend', BLEND_MODES)}
                    <Row$1 color={TD.fxCustom.color} label="CSS filter">
                        <TextField
                            className={styles.grow}
                            placeholder="blur(2px)"
                            value={String(cssFilter || '')}
                            onCommit={this.h('cssFilter', v => st.mutate('Set CSS filter',
                                () => setKey(g, 'fxCustom', this.editTime(g), v.trim(), {ease: 'Step'})))}
                        />
                    </Row$1>
                    <Row$1>
                        <ToolButton
                            danger
                            icon="trash"
                            title="Remove every effect track of this part"
                            onClick={this.h('clearEffects', () => st.mutate('Clear effects', () => {
                                for (const k of EFFECT_TRACKS) delete g.tracks[k];
                            }))}
                        >
                            {'Clear effects'}
                        </ToolButton>
                    </Row$1>
                </Section>
                <Section badge={this.animatedCount(g, STYLE_TRACKS)} title="Style">
                    <div className={styles.grid2}>
                        {this.propScrub(g, 'glowSize', {short: 'Glow'})}
                        {this.propScrub(g, 'glowStrength', {short: 'Strength'})}
                    </div>
                    {this.propColor(g, 'glowColor', 'Glow color')}
                    <div className={styles.grid2}>
                        {this.propScrub(g, 'outlineWidth', {short: 'Outline', step: 0.25})}
                    </div>
                    {this.propColor(g, 'outlineColor', 'Outline color')}
                    <div className={styles.grid2}>
                        {this.propScrub(g, 'shadowX', {short: 'Shadow X'})}
                        {this.propScrub(g, 'shadowY', {short: 'Shadow Y'})}
                        {this.propScrub(g, 'shadowBlur', {short: 'Blur'})}
                        {this.propScrub(g, 'shadowAlpha', {short: 'Opacity'})}
                    </div>
                    {this.propColor(g, 'shadowColor', 'Shadow color')}
                    <div className={styles.grid2}>
                        {this.propScrub(g, 'motionBlur', {short: 'Motion blur', tip: 'Motion blur (shutter, % of two frames)'})}
                    </div>
                </Section>
                <Section badge={this.animatedCount(g, MASK_TRACKS)} title="Mask">
                    {this.propSelect(g, 'maskSource', 'Mask',
                        [{value: '', label: 'none'}, ...others.map(o => ({value: o.name, label: o.name}))])}
                    {this.propToggle(g, 'maskInvert', 'Invert')}
                </Section>
                <Section badge={this.animatedCount(g, ADVANCED_TRACKS)} title="Advanced">
                    <div className={styles.grid2}>
                        {this.propScrub(g, 'skewX', {short: 'Skew X'})}
                        {this.propScrub(g, 'skewY', {short: 'Skew Y'})}
                        {this.propScrub(g, 'pivotX', {short: 'Pivot X'})}
                        {this.propScrub(g, 'pivotY', {short: 'Pivot Y'})}
                        {this.propScrub(g, 'padding',
                            {short: 'Padding', tip: 'Extra room around the costume for effects like whirl'})}
                    </div>
                    <div className={styles.groupLabel}>{'Afterimage'}</div>
                    <div className={styles.grid2}>
                        {this.propScrub(g, 'afterimageIntensity', {short: 'Trail'})}
                        {this.propScrub(g, 'afterimageFade', {short: 'Fade'})}
                        {this.propScrub(g, 'afterimageInterval', {short: 'Gap', step: 0.005, precision: 3})}
                    </div>
                    <div className={styles.groupLabel}>{'Clip (% from each side)'}</div>
                    <div className={styles.grid2}>
                        {this.propScrub(g, 'clipTop', {short: 'Top'})}
                        {this.propScrub(g, 'clipBottom', {short: 'Bottom'})}
                        {this.propScrub(g, 'clipLeft', {short: 'Left'})}
                        {this.propScrub(g, 'clipRight', {short: 'Right'})}
                    </div>
                    <div className={styles.groupLabel}>{'Nine-slice (pixels kept at each edge)'}</div>
                    <div className={styles.grid2}>
                        {this.nineField(g, 'l', 'L')}
                        {this.nineField(g, 'r', 'R')}
                        {this.nineField(g, 't', 'T')}
                        {this.nineField(g, 'b', 'B')}
                    </div>
                </Section>
            </React.Fragment>
        );
    }
    setting (id, label, apply) {
        return this.h(id, (v, phase) => {
            if (phase === 'start' || phase === 'drag') return;
            this.st.mutate(label, () => apply(v));
        });
    }
    animSettings () {
        const st = this.st;
        const d = st.doc;
        return (
            <Section title="Animation">
                <Row$1>
                    <ScrubField
                        className={styles.grow}
                        label="Length"
                        min={0.05}
                        step={0.05}
                        title="How long the animation is"
                        unit="s"
                        value={d.duration}
                        onChange={this.h('anim:length', (v, p) => {
                            const apply = () => { d.duration = v; };
                            if (p === 'start') st.beginChange('Length');
                            else if (p === 'drag') st.live(apply);
                            else if (p === 'end') st.endChange();
                            else st.mutate('Length', apply);
                        })}
                    />
                </Row$1>
                <Row$1 label="Endless">
                    <span className={styles.grow} />
                    <Switch
                        checked={!!d.infinite}
                        title="Endless: no fixed length (for live or expression-driven animations)"
                        onChange={this.h('anim:endless', v => st.mutate('Endless', () => { d.infinite = v; }))}
                    />
                </Row$1>
                <Row$1>
                    <ScrubField
                        className={styles.grow}
                        label="FPS"
                        max={240}
                        min={1}
                        precision={0}
                        title="Frames per second (the timeline's grid)"
                        value={d.fps}
                        onChange={this.setting('anim:fps', 'FPS', v => { d.fps = Math.round(v); })}
                    />
                </Row$1>
                {d.musicMode ? null : (
                    <Row$1 label="Snap to">
                        <Dropdown
                            className={styles.grow}
                            options={SNAPS.map(([v, l]) => ({value: v, label: l}))}
                            title="Keys snap to"
                            value={d.snapFrames}
                            onChange={this.h('snap', v => st.mutate('Snap', () => { d.snapFrames = Number(v); }))}
                        />
                    </Row$1>
                )}
                <Hint>{this.summary()}</Hint>
            </Section>
        );
    }
    summary () {
        const d = this.st.doc;
        const keysOf = g => Object.values(g.tracks).reduce((m, t) => m + t.keyframes.length, 0);
        const keys = d.groups.reduce((n, g) => n + keysOf(g), 0);
        const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
        return `${plural(d.groups.length, 'part')}, ${plural(keys, 'keyframe')}, ${plural(d.events.length, 'event')}`;
    }
    animMusic () {
        const st = this.st;
        const ed = this.props.ed;
        const d = st.doc;
        return (
            <Section title="Music">
                <Row$1 label="Beat grid">
                    <span className={styles.grow} />
                    <Switch
                        checked={!!d.musicMode}
                        title="Snap to beats instead of frames"
                        onChange={this.h('music:mode', v => st.mutate('Music mode', () => { d.musicMode = v; }))}
                    />
                </Row$1>
                {d.musicMode ? (
                    <React.Fragment>
                        <Row$1>
                            <ScrubField
                                className={styles.grow}
                                label="BPM"
                                max={999}
                                min={1}
                                precision={1}
                                value={d.bpm}
                                onChange={this.setting('music:bpm', 'BPM', v => { d.bpm = v; })}
                            />
                            <ScrubField
                                className={styles.grow}
                                label="Beats/bar"
                                max={32}
                                min={1}
                                precision={0}
                                value={d.beatsPerBar}
                                onChange={this.setting('music:bpb', 'Beats per bar', v => { d.beatsPerBar = Math.round(v); })}
                            />
                        </Row$1>
                        <Row$1 label="Snap to">
                            <Dropdown
                                className={styles.grow}
                                options={BEAT_SNAPS.map(([v, l]) => ({value: v, label: l}))}
                                title="Snap to"
                                value={d.snapDiv}
                                onChange={this.h('music:snap', v => st.mutate('Beat snap', () => { d.snapDiv = Number(v); }))}
                            />
                        </Row$1>
                    </React.Fragment>
                ) : null}
                <Row$1>
                    <ToolButton
                        icon="music"
                        title="Play a project sound with the timeline and show its waveform"
                        onClick={this.h('music:pick', () => ed.pickAudio())}
                    >
                        {d.audioSoundName ? d.audioSoundName : 'Pick a sound…'}
                    </ToolButton>
                    {d.audioSoundName ? (
                        <ToolButton icon="close" title="Remove sound" onClick={this.h('music:clear', () => ed.clearAudio())} />
                    ) : null}
                </Row$1>
            </Section>
        );
    }
    animSections () {
        const st = this.st;
        const ed = this.props.ed;
        const d = st.doc;
        return (
            <React.Fragment>
                {this.animSettings()}
                {this.animMusic()}
                <Section badge={d.dataTracks.length ? String(d.dataTracks.length) : null} title="Data">
                    {d.dataTracks.map(dt => (
                        <Row$1 key={dt.name}>
                            <i className={styles.dot} style={{background: dt.color}} />
                            <b className={styles.grow}>{`data.${dt.name}`}</b>
                            <span className={styles.muted}>
                                {`${dt.keyframes.length} key${dt.keyframes.length === 1 ? '' : 's'}`}
                            </span>
                        </Row$1>
                    ))}
                    <Row$1>
                        <ToolButton
                            icon="plus"
                            title="Add a data track (expressions read it as data.name)"
                            onClick={this.h('data:add', () => ed.cmd('addDataTrack'))}
                        >
                            {'Add data track'}
                        </ToolButton>
                    </Row$1>
                </Section>
            </React.Fragment>
        );
    }
    render () {
        const st = this.st;
        const g = st.primaryGroup;
        const keys = st.selectedKeyInfos();
        let title = 'Animation';
        if (g) title = g.name;
        else if (keys.length) title = 'Keyframes';
        return (
            <div className={styles.inspector}>
                <div className={styles.paneHead}>
                    <span className={styles.paneTitle}>{title}</span>
                </div>
                <div className={styles.inspectorBody}>
                    {keys.length ? this.keySection(keys) : null}
                    {g ? this.partSections(g) : null}
                    {!g && !keys.length ? this.animSections() : null}
                </div>
                {this.exprBar()}
            </div>
        );
    }
}
Inspector.propTypes = {ed: PropTypes.object.isRequired};
const PART_TYPE = 'application/x-ks5-part';
class PartsList extends React.Component {
    constructor (props) {
        super(props);
        this.state = {dragging: null, drop: null};
        this.handleListClick = e => {
            if (e.target === e.currentTarget) this.props.ed.st.selectGroup(null);
        };
        this.handleListDragOver = e => {
            if (this.state.dragging && e.target === e.currentTarget) e.preventDefault();
        };
        this.handleListDrop = e => {
            if (e.target !== e.currentTarget) return;
            const name = e.dataTransfer.getData(PART_TYPE);
            const g = name && this.props.ed.st.group(name);
            if (g && staticParent(g)) this.props.ed.setParent(name, null);
            this.setState({dragging: null, drop: null});
        };
        this.handleAddMenu = e => {
            const ed = this.props.ed;
            showMenu([
                {label: 'Part from a costume…', icon: 'sprite', action: () => ed.addPartDialog()},
                {label: 'Upload images as parts…', icon: 'image',
                    action: () => pickFiles('image/*', true).then(fs => fs.length && addImagesAsParts(ed, fs, 0, 0))},
                {label: 'Import a part file (.ks5group, .ks4group…)', icon: 'import', action: () => ed.cmd('importParts')}
            ], e.currentTarget);
        };
    }
    h (id, fn) { return handler(this, id, fn); }
    peopleOn (name) {
        const people = this.props.ed.remotePeople().filter(p => p.sel.includes(name));
        if (!people.length) return null;
        return (
            <div className={styles.partPeople}>
                {people.map(p => (
                    <span
                        className={styles.personDot}
                        key={p.userId}
                        style={{background: p.color}}
                        title={`${p.name} has this part selected`}
                    />
                ))}
            </div>
        );
    }
    tree () {
        const st = this.props.ed.st;
        const groups = st.doc.groups;
        const names = new Set(groups.map(g => g.name));
        const children = new Map();
        const roots = [];
        for (const g of groups) {
            const p = staticParent(g);
            if (p && names.has(p) && p !== g.name && !isAncestor(st.doc, g, st.group(p))) {
                if (!children.has(p)) children.set(p, []);
                children.get(p).push(g);
            } else { roots.push(g); }
        }
        const out = [];
        const walk = (g, depth) => {
            out.push({g, depth});
            for (const c of children.get(g.name) || []) walk(c, depth + 1);
        };
        for (const g of roots) walk(g, 0);
        return out;
    }
    tile ({g, depth}, num) {
        const ed = this.props.ed;
        const st = ed.st;
        const selected = st.selGroups.has(g.name);
        const parent = staticParent(g);
        let details = g.spriteName === THIS_SPRITE ? 'this sprite' : g.spriteName;
        if (parent) details = `in ${parent}`;
        const thumb = ed.costumeThumbForGroup(g);
        const drop = this.state.drop && this.state.drop.name === g.name ? this.state.drop.mode : null;
        return (
            <div
                className={classNames(selectorStyles.listItem, itemStyles.spriteSelectorItem, styles.partTile, {
                    [itemStyles.isSelected]: selected,
                    [styles.partHidden]: !g.visible,
                    [styles.dropAbove]: drop === 'above',
                    [styles.dropBelow]: drop === 'below',
                    [styles.dropIn]: drop === 'in'
                })}
                draggable
                key={g.name}
                style={depth ? {marginLeft: `${Math.min(depth, 4) * 0.75}rem`} : null}
                title={g.name}
                onClick={this.h(`${g.name}:onClick`, e => st.selectGroup(g.name, e.shiftKey || e.ctrlKey || e.metaKey))}
                onContextMenu={this.h(`${g.name}:onContextMenu`, e => {
                    e.preventDefault();
                    if (!st.selGroups.has(g.name)) st.selectGroup(g.name);
                    ed.partMenu(g.name, {x: e.clientX, y: e.clientY});
                })}
                onDoubleClick={this.h(`${g.name}:onDoubleClick`, () => ed.renamePartPrompt(g))}
                onDragEnd={this.h(`${g.name}:onDragEnd`, () => this.setState({dragging: null, drop: null}))}
                onDragOver={this.h(`${g.name}:onDragOver`, e => {
                    const dragging = this.state.dragging;
                    if (!dragging || dragging === g.name) return;
                    const src = st.group(dragging);
                    if (!src || isAncestor(st.doc, src, g)) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    const y = (e.clientY - r.top) / r.height;
                    let mode = 'in';
                    if (y < 0.25) mode = 'above';
                    else if (y > 0.75) mode = 'below';
                    if (!drop || drop !== mode) this.setState({drop: {name: g.name, mode}});
                })}
                onDragStart={this.h(`${g.name}:onDragStart`, e => {
                    e.dataTransfer.setData(PART_TYPE, g.name);
                    e.dataTransfer.effectAllowed = 'move';
                    this.setState({dragging: g.name});
                })}
                onDrop={this.h(`${g.name}:onDrop`, e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const name = e.dataTransfer.getData(PART_TYPE);
                    const mode = drop || 'below';
                    this.setState({dragging: null, drop: null});
                    if (!name || name === g.name) return;
                    if (mode === 'in') ed.setParent(name, g.name);
                    else ed.reorderPart(name, g.name, mode === 'above');
                })}
            >
                <div className={itemStyles.number}>{num}</div>
                {this.peopleOn(g.name)}
                <div className={itemStyles.spriteImageOuter}>
                    <div className={itemStyles.spriteImageInner}>
                        {thumb ? (
                            <img className={itemStyles.spriteImage} draggable={false} src={thumb} />
                        ) : null}
                    </div>
                </div>
                <div className={itemStyles.spriteInfo}>
                    <div className={itemStyles.spriteName}>{g.name}</div>
                    <div className={itemStyles.spriteDetails}>{details}</div>
                </div>
                {selected ? (
                    <DeleteButton
                        className={itemStyles.deleteButton}
                        onClick={this.h(`${g.name}:delete`, e => {
                            e.stopPropagation();
                            st.selGroups = new Set([g.name]);
                            ed.cmd('deletePart');
                        })}
                    />
                ) : null}
            </div>
        );
    }
    render () {
        const rows = this.tree();
        return (
            <div className={styles.parts}>
                <div className={styles.paneHead}>
                    <span className={styles.paneTitle}>{'Parts'}</span>
                    <span className={styles.grow} />
                    <ToolButton className={styles.mini} icon="plus" title="Add a part" onClick={this.handleAddMenu} />
                </div>
                <div
                    className={styles.partsList}
                    onClick={this.handleListClick}
                    onDragOver={this.handleListDragOver}
                    onDrop={this.handleListDrop}
                >
                    {rows.length ? rows.map((row, i) => this.tile(row, i + 1)) : (
                        <div className={styles.partsEmpty}>
                            {'No parts yet. Add one from a costume, or drop images here.'}
                        </div>
                    )}
                </div>
            </div>
        );
    }
}
PartsList.propTypes = {ed: PropTypes.object.isRequired};
const PLAYING_UI_MS = 80;
const COMPACT_WIDTH = 720;
const NARROW_WIDTH = 1000;
const formatTime = (sec, fps, frames) => {
    if (!Number.isFinite(sec)) return '∞';
    if (frames) return String(Math.round(sec * fps));
    return sec.toFixed(2);
};
class AnimationEditor extends React.Component {
    constructor (props) {
        super(props);
        this.rootRef = React.createRef();
        this.viewportRef = React.createRef();
        this.timelineRef = React.createRef();
        this.ed = null;
        this.uiTimer = 0;
        this.uiRaf = 0;
        this.state = {
            ready: false,
            compact: false,
            narrow: false,
            inspectorOpen: false,
            timelineHeight: Math.min(prefs.timelineHeight || 220, 320)
        };
        this.handleUI = this.handleUI.bind(this);
        this.handleSplitterDown = this.handleSplitterDown.bind(this);
        this.handleDragOver = e => {
            if ([...(e.dataTransfer && e.dataTransfer.types) || []].includes('Files')) e.preventDefault();
        };
        this.handleDrop = e => {
            if (e.defaultPrevented || !this.ed) return;
            if (e.dataTransfer && e.dataTransfer.files.length) {
                e.preventDefault();
                this.ed.dropFiles([...e.dataTransfer.files], 0, 0);
            }
        };
    }
    componentDidMount () {
        installTooltips();
        const {host, doc, target, sprite, onCommit} = this.props;
        this.ed = new Editor(host, doc, {
            target,
            sprite,
            root: this.rootRef.current,
            onCommit: committed => onCommit(sprite, committed)
        });
        this.rootRef.current.dimodAnimationEditor = this.ed;
        this.viewportRef.current.appendChild(this.ed.viewport.el);
        this.timelineRef.current.appendChild(this.ed.timeline.el);
        this.unsubscribe = this.ed.st.on('ui', this.handleUI);
        this.resizeObserver = new ResizeObserver(entries => {
            const width = entries[0].contentRect.width;
            requestAnimationFrame(() => {
                const compact = width > 0 && width < COMPACT_WIDTH;
                const narrow = width > 0 && width < NARROW_WIDTH;
                if (this.ed && (compact !== this.state.compact || narrow !== this.state.narrow)) {
                    this.setState({compact, narrow});
                }
            });
        });
        this.resizeObserver.observe(this.rootRef.current);
        this.ed.attached();
        this.setState({ready: true});
    }
    componentWillUnmount () {
        clearTimeout(this.uiTimer);
        cancelAnimationFrame(this.uiRaf);
        if (this.unsubscribe) this.unsubscribe();
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.ed) this.ed.destroy();
        this.ed = null;
    }
    h (id, fn) { return handler(this, id, fn); }
    handleUI () {
        if (!this.ed) return;
        if (this.ed.st.playing) {
            if (this.uiTimer) return;
            this.uiTimer = setTimeout(() => {
                this.uiTimer = 0;
                if (this.ed) this.forceUpdate();
            }, PLAYING_UI_MS);
            return;
        }
        if (this.uiRaf) return;
        this.uiRaf = requestAnimationFrame(() => {
            this.uiRaf = 0;
            if (this.ed) this.forceUpdate();
        });
    }
    handleSplitterDown (e) {
        e.preventDefault();
        const startY = e.clientY;
        const start = this.state.timelineHeight;
        const move = ev => {
            const h = Math.max(110, Math.min(600, start - (ev.clientY - startY)));
            prefs.timelineHeight = h;
            this.setState({timelineHeight: h});
            if (this.ed) this.ed.invalidate('all');
        };
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            savePrefs();
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    }
    renderToolbar () {
        const ed = this.ed;
        const st = ed.st;
        const d = st.doc;
        const frames = ed.timeFormat === 'frames';
        const menu = (id, items) => this.h(id, e => showMenu(items(), e.currentTarget, {minWidth: 200}));
        return (
            <div className={styles.toolbar}>
                <span className={styles.fieldLabel}>{'Name'}</span>
                <TextField
                    className={styles.nameField}
                    title="Animation name"
                    value={d.name}
                    onCommit={this.h('onCommit1', v => st.mutate('Rename animation', () => (d.name = v.trim() || d.name)))}
                />
                <div className={styles.buttonGroup}>
                    <button
                        aria-label="Undo"
                        className={styles.toolButton}
                        disabled={!st.undoStack.length}
                        title={st.undoStack.length ? `Undo ${st.undoStack[st.undoStack.length - 1].label} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
                        type="button"
                        onClick={this.h('onClick2', () => ed.cmd('undo'))}
                    >
                        <img alt="" className={styles.studioIcon} draggable={false} src={undoIcon} />
                    </button>
                    <button
                        aria-label="Redo"
                        className={styles.toolButton}
                        disabled={!st.redoStack.length}
                        title={st.redoStack.length ? `Redo ${st.redoStack[st.redoStack.length - 1].label} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)'}
                        type="button"
                        onClick={this.h('onClick3', () => ed.cmd('redo'))}
                    >
                        <img alt="" className={styles.studioIcon} draggable={false} src={redoIcon} />
                    </button>
                </div>
                <div className={styles.divider} />
                <div className={styles.buttonGroup}>
                    <ToolButton icon="first" kbd="Home" title="Go to start" onClick={this.h('onClick4', () => st.setTime(0))} />
                    <ToolButton
                        icon="prev"
                        kbd="Left"
                        title="Previous frame"
                        onClick={this.h('onClick5', () => ed.cmd('prevFrame'))}
                    />
                    <ToolButton
                        className={styles.playButton}
                        icon={st.playing ? 'pause' : 'play'}
                        kbd="Space"
                        on={st.playing}
                        title={st.playing ? 'Pause' : 'Play'}
                        onClick={this.h('onClick6', () => ed.togglePlay())}
                    />
                    <ToolButton
                        icon="next"
                        kbd="Right"
                        title="Next frame"
                        onClick={this.h('onClick7', () => ed.cmd('nextFrame'))}
                    />
                    <ToolButton icon="last" kbd="End" title="Go to end" onClick={this.h('onClick8', () => ed.cmd('toEnd'))} />
                    <ToolButton
                        icon="loop"
                        kbd="L"
                        on={st.loop}
                        title="Loop playback"
                        onClick={this.h('onClick9', () => ed.cmd('toggleLoop'))}
                    />
                    <ToolButton
                        className={styles.rateButton}
                        on={st.rate !== 1}
                        title="Playback speed (preview only)"
                        onClick={menu('rateMenu', () => ed.rateMenu())}
                    >
                        {`${st.rate}×`}
                    </ToolButton>
                </div>
                <button
                    className={styles.timeReadout}
                    title={frames ? 'Frame / total frames (click for seconds)' : 'Time / length in seconds (click for frames)'}
                    type="button"
                    onClick={this.h('onClick10', () => { ed.timeFormat = frames ? 'seconds' : 'frames'; ed.invalidate('all'); })}
                >
                    <b>{formatTime(st.sec, d.fps, frames)}</b>
                    {' / '}
                    {formatTime(st.maxSec, d.fps, frames)}
                    <span className={styles.muted}>{frames ? ' f' : ' s'}</span>
                </button>
                <span className={styles.grow} />
                {this.renderPeople()}
                <ToolButton icon="plus" title="Add a part" onClick={this.h('onClick11', () => ed.addPartDialog())}>
                    {this.state.narrow ? null : 'Part'}
                </ToolButton>
                <ToolButton
                    icon="addKey"
                    kbd="I"
                    title="Key the selected parts' transform at the playhead"
                    onClick={this.h('onClick12', () => ed.cmd('keyTransform'))}
                >
                    {this.state.narrow ? null : 'Key'}
                </ToolButton>
                <div className={styles.divider} />
                <ToolButton
                    icon="folder"
                    title="File: import, export, GIF, video, sprite sheet, costumes"
                    onClick={menu('fileMenu', () => [...ed.fileMenu(), 'sep', ...ed.exportMenu()])}
                />
                <ToolButton
                    icon="gear"
                    title="Settings: preferences, onion skin, shortcuts and project settings"
                    onClick={this.h('onClick-settings', () => ed.settingsDialog())}
                />
                <ToolButton
                    icon="dots"
                    title="More: edit, animation, view and help"
                    onClick={menu('moreMenu', () => [...ed.editMenu(), 'sep', ...ed.animMenu(), 'sep', ...ed.viewMenu(),
                        'sep', ...ed.helpMenu()])}
                />
                <div className={styles.toolbarEnd}>
                    <DimodFullscreenButton />
                </div>
            </div>
        );
    }
    renderPeople () {
        const people = this.ed.remotePeople();
        if (!people.length) return null;
        return (
            <div className={styles.people}>
                {people.map(p => (
                    <span
                        className={styles.person}
                        key={p.userId}
                        style={{background: p.color}}
                        title={`${p.name} is in this animation`}
                    >
                        {p.name.slice(0, 1).toUpperCase()}
                    </span>
                ))}
            </div>
        );
    }
    renderCanvasControls () {
        const ed = this.ed;
        const v = ed.st.view;
                return (
            <div className={styles.canvasControls}>
                <div className={styles.buttonGroup}>
                    {this.props.vm.isLiveTest ? (
                        <ToolButton
                            icon="image"
                            on={!!this.state.drawMode}
                            title="Draw (experimental): draw vector frames right into the animation"
                            onClick={this.h('drawMode', () => this.setState({drawMode: !this.state.drawMode}))}
                        />
                    ) : null}
                    <OnionControls ed={ed} />
                    <GridControls ed={ed} />
                    <SnapControls ed={ed} />
                    <ToolButton
                        icon="path"
                        on={v.motionPath}
                        title="Motion path of the selected part"
                        onClick={this.h('onClick15', () => ed.viewport.toggle('motionPath'))}
                    />
                    <ToolButton icon="expr" on={v.noExprs} title="Toggle expressions (E): turn them all off while you position things" onClick={this.h('toggleExprs', () => ed.cmd('toggleExprs'))} />
                    <ToolButton
                        icon="target"
                        on={v.showBounds}
                        title="Show the origin"
                        onClick={this.h('onClick16', () => ed.viewport.toggle('showBounds'))}
                    />
                    <ToolButton
                        icon="moon"
                        on={v.checker === 1}
                        title="Flip the canvas between light and dark"
                        onClick={this.h('onClick17', () => { ed.viewport.cycleBg(); this.forceUpdate(); })}
                    />
                </div>
                <span className={styles.grow} />
                {this.state.compact ? (
                    <ToolButton
                        icon="gear"
                        on={this.state.inspectorOpen}
                        title="Properties"
                        onClick={this.h('onClick18', () => this.setState(s => ({inspectorOpen: !s.inspectorOpen})))}
                    />
                ) : null}
                <div className={styles.buttonGroup}>
                    <button
                        aria-label="Zoom out"
                        className={styles.toolButton}
                        title="Zoom out"
                        type="button"
                        onClick={this.h('onClick19', () => ed.viewport.zoomBy(1 / 1.25))}
                    >
                        <img
                            alt=""
                            className={classNames(styles.studioIcon, styles.paintIcon)}
                            draggable={false}
                            src={zoomOutIcon}
                        />
                    </button>
                    <button
                        className={styles.zoomReadout}
                        title="Fit the animation in view (F)"
                        type="button"
                        onClick={this.h('onClick20', () => ed.viewport.fit())}
                    >
                        {`${Math.round(v.pvZoom * 100)}%`}
                    </button>
                    <button
                        aria-label="Zoom in"
                        className={styles.toolButton}
                        title="Zoom in"
                        type="button"
                        onClick={this.h('onClick21', () => ed.viewport.zoomBy(1.25))}
                    >
                        <img
                            alt=""
                            className={classNames(styles.studioIcon, styles.paintIcon)}
                            draggable={false}
                            src={zoomInIcon}
                        />
                    </button>
                </div>
            </div>
        );
    }
    renderTimelineHeader () {
        const ed = this.ed;
        const st = ed.st;
        const v = st.view;
        const n = st.selKeys.size;
        const collapseAll = () => {
            const any = st.doc.groups.some(g => !g.tlCollapsed);
            st.mutate('Collapse tracks', doc => doc.groups.forEach(g => {
                if (any) g.tlCollapsed = true;
                else delete g.tlCollapsed;
            }), 'ui');
        };
        return (
            <div className={styles.timelineHead}>
                <div className={styles.segmented}>
                    <button
                        className={classNames(styles.segment, {[styles.on]: v.tlMode === 'dope'})}
                        title="Dope sheet: keyframes on rows (1)"
                        type="button"
                        onClick={this.h('onClick23', () => ed.timeline.setMode('dope'))}
                    >
                        <KIcon name="dope" />
                        <span>{'Keys'}</span>
                    </button>
                    <button
                        className={classNames(styles.segment, {[styles.on]: v.tlMode === 'graph'})}
                        title="Graph: value curves with handles (2)"
                        type="button"
                        onClick={this.h('onClick24', () => ed.timeline.setMode('graph'))}
                    >
                        <KIcon name="graph" />
                        <span>{'Graph'}</span>
                    </button>
                </div>
                <div className={styles.buttonGroup}>
                    <ToolButton
                        className={styles.mini}
                        icon="data"
                        title="Add a data track (data.name in expressions)"
                        onClick={this.h('onClick25', () => ed.cmd('addDataTrack'))}
                    />
                    <ToolButton
                        className={styles.mini}
                        icon="flag"
                        title="Add an event marker at the playhead"
                        onClick={this.h('onClick26', () => ed.cmd('addEvent'))}
                    />
                    <ToolButton
                        className={styles.mini}
                        icon="chevronDown"
                        title="Collapse or expand every part's tracks"
                        onClick={collapseAll}
                    />
                </div>
                <span className={styles.muted}>{n ? `${n} key${n === 1 ? '' : 's'} selected` : ''}</span>
                <span className={styles.grow} />
                <ToolButton
                    className={styles.mini}
                    disabled={n < 2}
                    icon="reverse"
                    title="Reverse the selected keyframes"
                    onClick={this.h('onClick27', () => ed.cmd('reverseKeys'))}
                />
                <ToolButton
                    className={styles.mini}
                    icon="star"
                    title="Motion presets"
                    onClick={this.h('onClick28', e => ed.presetsMenu(e.currentTarget))}
                />
                <ToolButton
                    className={styles.mini}
                    icon="magnet"
                    on={v.snapToKeys}
                    title="Snap the playhead and keys to other keyframes"
                    onClick={this.h('onClick29', () => {
                        v.snapToKeys = !v.snapToKeys;
                        prefs.kfSnap = v.snapToKeys;
                        savePrefs();
                        this.forceUpdate();
                    })}
                />
                <ToolButton
                    className={styles.mini}
                    icon="fit"
                    kbd="Shift+F"
                    title="Fit the timeline to the animation"
                    onClick={this.h('onClick30', () => ed.timeline.fit())}
                />
                <ToolButton
                    className={styles.mini}
                    disabled={!n}
                    icon="trash"
                    title="Delete the selected keys"
                    onClick={this.h('onClick31', () => ed.cmd('deleteKeys'))}
                />
            </div>
        );
    }
    render () {
        const ready = this.state.ready && this.ed;
        return (
            <div
                className={classNames('ks5', styles.editor, {
                    [styles.compact]: this.state.compact,
                    [styles.narrow]: this.state.narrow
                })}
                ref={this.rootRef}
                onDragOver={this.handleDragOver}
                onDrop={this.handleDrop}
            >
                {ready ? this.renderToolbar() : <div className={styles.toolbar} />}
                <div className={styles.middle}>
                    {ready ? <PartsList ed={this.ed} /> : <div className={styles.parts} />}
                    {ready && this.state.drawMode ? <DrawTools ed={this.ed} /> : null}
                    <div className={styles.stageColumn}>
                        <div className={styles.viewportHost} ref={this.viewportRef} />
                        {ready ? this.renderCanvasControls() : null}
                    </div>

                    {ready && (!this.state.compact || this.state.inspectorOpen) ? <Inspector ed={this.ed} /> : null}
                </div>
                <div
                    aria-label="Resize the timeline"
                    className={styles.splitter}
                    role="separator"
                    onMouseDown={this.handleSplitterDown}
                />
                <div className={styles.timeline} style={{height: `${this.state.timelineHeight}px`}}>
                    {ready ? this.renderTimelineHeader() : null}
                    <div className={styles.timelineHost} ref={this.timelineRef} />
                </div>
            </div>
        );
    }
}
AnimationEditor.propTypes = {
    doc: PropTypes.object.isRequired,
    host: PropTypes.object.isRequired,
    onCommit: PropTypes.func.isRequired,
    sprite: PropTypes.object.isRequired,
    target: PropTypes.object.isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};
const DRAW_ICONS = {select: drawSelectIcon, pen: drawPenIcon, eraser: drawEraserIcon, line: drawLineIcon, rect: drawRectIcon, ellipse: drawEllipseIcon};
const DRAW_NAMES = {select: 'Select', pen: 'Brush', eraser: 'Eraser (drag over shapes)', line: 'Line', rect: 'Rectangle', ellipse: 'Circle'};
class DrawTools extends React.Component {
    constructor (props) { super(props); this.handleUI = () => this.forceUpdate(); }
    componentDidMount () {
        const st = this.props.ed.st;
        const offs = ['ui', 'sel', 'doc'].map(ch => st.on(ch, this.handleUI));
        this.unsubscribe = () => offs.forEach(off => off());
    }
    componentWillUnmount () {
        if (this.unsubscribe) this.unsubscribe();
        const v = this.props.ed.st.view;
        if (DRAW_TOOLS.includes(v.tool)) v.tool = 'select';
    }
    set (key, value) {
        const {ed} = this.props;
        ed.st.view[key] = value;
        ed.invalidate('view');
        ed.st.emit('ui');
    }
    big (key, icon, title, on, onClick, disabled) {
        return (
            <button
                aria-pressed={on}
                className={classNames(styles.drawTool, {[styles.drawToolOn]: on})}
                disabled={disabled}
                key={key}
                title={title}
                type="button"
                onClick={onClick}
            >
                <img alt="" draggable={false} src={icon} />
            </button>
        );
    }
    render () {
        const {ed} = this.props;
        const v = ed.st.view;
        const target = drawTarget(ed.st);
        return (
            <div className={styles.drawTools}>
                {Object.keys(DRAW_ICONS).map(t => this.big(t, DRAW_ICONS[t], DRAW_NAMES[t], v.tool === t,
                    handler(this, `tool:${t}`, () => this.set('tool', t))))}
                <hr />
                <span className={styles.drawLabel}>{'Outline'}</span>
                <ColorSwatch
                    title="Outline color"
                    value={v.drawColor}
                    onChange={handler(this, 'color', c => this.set('drawColor', c))}
                    onCommit={handler(this, 'color2', c => this.set('drawColor', c))}
                />
                <span className={styles.drawLabel}>{'Fill'}</span>
                <ColorSwatch
                    title="Fill color"
                    value={v.drawFillColor}
                    onChange={handler(this, 'fcolor', c => this.set('drawFillColor', c))}
                    onCommit={handler(this, 'fcolor2', c => this.set('drawFillColor', c))}
                />
                {this.big('fill', drawFillIcon, 'Fill shapes with the color', v.drawFill,
                    handler(this, 'fill', () => this.set('drawFill', !v.drawFill)))}
                <input
                    className={styles.drawWidth}
                    max={64}
                    min={0}
                    title="Line width"
                    type="number"
                    value={v.drawWidth}
                    onChange={handler(this, 'width', e => this.set('drawWidth', Math.max(0, Math.min(64, Number(e.target.value) || 0))))}
                />
                <hr />
                {this.big('frame', drawFrameIcon, 'New blank drawing frame at the playhead (select a drawn part first)', false,
                    handler(this, 'frame', () => newDrawingFrame(ed, false)), !target)}
                {this.big('dupe', drawDupeIcon, 'Copy this drawing frame to the playhead', false,
                    handler(this, 'dupe', () => newDrawingFrame(ed, true)), !target)}
            </div>
        );
    }
}
DrawTools.propTypes = {ed: PropTypes.object.isRequired};
class OnionControls extends React.Component {
    constructor (props) {
        super(props);
        this.setRoot = el => { this.root = el; };
        this.state = {open: false};
        this.handleToggle = () => this.update('onion', !this.props.ed.st.view.onion);
        this.handleSettings = () => this.setState({open: !this.state.open});
    }
    componentDidMount () { this.unwatch = watchDismiss(this); }
    componentWillUnmount () { this.unwatch(); }
    update (key, value) {
        const {ed} = this.props;
        const v = ed.st.view;
        v[key] = value;
        if (key !== 'onion' && key !== 'onionMode' && key !== 'onionLayer' && !/Before|After/.test(key) &&
            !v.onion && (v.onionPrev > 0 || v.onionNext > 0) && v.onionOpacity > 0) v.onion = true;
        ed.invalidate('view');
        ed.st.emit('ui');
        this.forceUpdate();
    }
    stepper (key, label, min, max, scale) {
        const v = this.props.ed.st.view;
        const value = Math.round(v[key] * scale);
        const set = n => this.update(key, Math.min(max, Math.max(min, n)) / scale);
        return (
            <div className={styles.onionLine} key={key}>
                <span>{label}</span>
                <span className={styles.onionStepper}>
                    <button
                        className={styles.onionStep}
                        type="button"
                        onClick={handler(this, `${key}:dec`, () => set(value - 1))}
                    >{'−'}</button>
                    <input
                        className={styles.onionValue}
                        max={max}
                        min={min}
                        type="number"
                        value={value}
                        onChange={handler(this, `${key}:in`, e => set(Number(e.target.value) || 0))}
                    />
                    <button
                        className={styles.onionStep}
                        type="button"
                        onClick={handler(this, `${key}:inc`, () => set(value + 1))}
                    >{'+'}</button>
                </span>
            </div>
        );
    }
    choice (key, label, options) {
        const v = this.props.ed.st.view;
        return (
            <div className={styles.onionLine} key={key}>
                <span>{label}</span>
                <span className={styles.onionStepper}>
                    {options.map(([value, text]) => (
                        <button
                            className={classNames(styles.onionChoice, {[styles.onionChoiceOn]: v[key] === value})}
                            key={value}
                            type="button"
                            onClick={handler(this, `${key}:${value}`, () => this.update(key, value))}
                        >{text}</button>
                    ))}
                </span>
            </div>
        );
    }
    render () {
        const v = this.props.ed.st.view;
        return (
            <div className={styles.onionGroup} ref={this.setRoot}>
                <button
                    aria-pressed={v.onion}
                    className={classNames(styles.viewButton, {[styles.viewButtonOn]: v.onion})}
                    title="Onion skin (O)"
                    type="button"
                    onClick={this.handleToggle}
                >
                    <img alt="" className={styles.viewIcon} draggable={false} src={onionIcon} />
                </button>
                <ExpandArrow open={this.state.open} title="Onion skin settings" onClick={this.handleSettings} />
                {this.state.open ? (
                    <div className={styles.onionPanel}>
                        {this.stepper('onionPrev', 'Previous frames', 0, 8, 1)}
                        {this.stepper('onionNext', 'Next frames', 0, 8, 1)}
                        {this.stepper('onionOpacity', 'Opacity (%)', 0, 100, 100)}
                        {this.stepper('onionStep', 'Opacity step (%)', 0, 50, 100)}
                        {this.choice('onionMode', 'Mode', [['merge', 'Merge'], ['tint', 'Tint']])}
                        {this.choice('onionLayer', 'Layering', [['front', 'Front'], ['behind', 'Behind']])}
                        {v.onionMode === 'tint' ? (
                            <div className={styles.onionLine}>
                                <span>{'Tints'}</span>
                                <span className={styles.onionStepper}>
                                    <ColorSwatch
                                        title="Previous tint"
                                        value={v.onionBefore}
                                        onChange={handler(this, 'tintB', c => this.update('onionBefore', c))}
                                        onCommit={handler(this, 'tintB2', c => this.update('onionBefore', c))}
                                    />
                                    <ColorSwatch
                                        title="Next tint"
                                        value={v.onionAfter}
                                        onChange={handler(this, 'tintA', c => this.update('onionAfter', c))}
                                        onCommit={handler(this, 'tintA2', c => this.update('onionAfter', c))}
                                    />
                                </span>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        );
    }
}
OnionControls.propTypes = {ed: PropTypes.object.isRequired};
class GridControls extends React.Component {
    constructor (props) {
        super(props);
        this.setRoot = el => { this.root = el; };
        this.state = {open: false};
        this.handleToggle = () => this.update('grid', !this.props.ed.st.view.grid);
        this.handleMenu = e => { e.preventDefault(); this.setState({open: !this.state.open}); };
    }
    componentDidMount () { this.unwatch = watchDismiss(this); }
    componentWillUnmount () { this.unwatch(); }
    update (key, value) {
        const {ed} = this.props;
        ed.st.view[key] = value;
        if (key === 'gridSize') ed.st.view.grid = true;
        ed.invalidate('view');
        ed.st.emit('ui');
        this.forceUpdate();
    }
    render () {
        const v = this.props.ed.st.view;
        return (
            <div className={styles.onionGroup} ref={this.setRoot}>
                <button
                    aria-pressed={v.grid}
                    className={classNames(styles.viewButton, {[styles.viewButtonOn]: v.grid})}
                    title={`Grid (${v.gridSize})`}
                    type="button"
                    onClick={this.handleToggle}
                    onContextMenu={this.handleMenu}
                >
                    <img alt="" className={styles.viewIcon} draggable={false} src={gridIcon} />
                </button>
                <ExpandArrow open={this.state.open} title="Grid size and snapping" onClick={this.handleMenu} />
                {this.state.open ? (
                    <div className={styles.onionPanel}>
                        <label className={styles.onionLine}>
                            {'Snap to grid (hold Alt to place freely)'}
                            <input
                                checked={v.snap}
                                type="checkbox"
                                onChange={handler(this, 'snap', e => this.update('snap', e.target.checked))}
                            />
                        </label>
                        <div className={styles.onionLine}>
                            {'Grid size'}
                            <span className={styles.onionStepper}>
                                {[4, 8, 16, 32, 64].map(size => (
                                    <button
                                        className={classNames(styles.onionChoice, {[styles.onionChoiceOn]: v.gridSize === size})}
                                        key={size}
                                        type="button"
                                        onClick={handler(this, `size${size}`, () => this.update('gridSize', size))}
                                    >{size}</button>
                                ))}
                            </span>
                        </div>
                    </div>
                ) : null}
            </div>
        );
    }
}
GridControls.propTypes = {ed: PropTypes.object.isRequired};
const ExpandArrow = ({open, title, onClick}) => (
    <button
        aria-expanded={open}
        className={classNames(styles.expandArrow, {[styles.expandArrowOpen]: open})}
        title={title}
        type="button"
        onClick={onClick}
    >
        <KIcon name="chevronDown" />
    </button>
);
ExpandArrow.propTypes = {onClick: PropTypes.func, open: PropTypes.bool, title: PropTypes.string};
const watchDismiss = comp => {
    const onDown = e => {
        if (comp.state.open && comp.root && !comp.root.contains(e.target)) comp.setState({open: false});
    };
    const onKey = e => {
        if (e.key === 'Escape' && comp.state.open) comp.setState({open: false});
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
        document.removeEventListener('mousedown', onDown, true);
        document.removeEventListener('keydown', onKey, true);
    };
};
class SnapControls extends React.Component {
    constructor (props) {
        super(props);
        this.setRoot = el => { this.root = el; };
        this.state = {open: false};
        this.handleToggle = () => this.update('objSnap', !this.props.ed.st.view.objSnap);
        this.handleMenu = () => this.setState({open: !this.state.open});
    }
    componentDidMount () { this.unwatch = watchDismiss(this); }
    componentWillUnmount () { this.unwatch(); }
    update (key, value) {
        const {ed} = this.props;
        ed.st.view[key] = value;
        try { localStorage.setItem(`dimod:anim-${key}`, JSON.stringify(value)); } catch (e) {}
        ed.invalidate('view');
        ed.st.emit('ui');
        this.forceUpdate();
    }
    render () {
        const v = this.props.ed.st.view;
        const check = (key, label) => (
            <label className={styles.onionLine}>
                {label}
                <input checked={v[key]} type="checkbox" onChange={handler(this, key, e => this.update(key, e.target.checked))} />
            </label>
        );
        return (
            <div className={styles.onionGroup} ref={this.setRoot}>
                <button
                    aria-pressed={v.objSnap}
                    className={classNames(styles.viewButton, {[styles.viewButtonOn]: v.objSnap})}
                    title="Snapping: parts snap to other parts and the center (hold Alt to place freely)"
                    type="button"
                    onClick={this.handleToggle}
                >
                    <img alt="" className={styles.viewIcon} draggable={false} src={snapIcon} />
                </button>
                <ExpandArrow open={this.state.open} title="Snapping settings" onClick={this.handleMenu} />
                {this.state.open ? (
                    <div className={styles.onionPanel}>
                        {check('snapEdges', 'Snap to part edges')}
                        {check('snapCenters', 'Snap to part centers')}
                        {check('snapStage', 'Snap to the canvas center')}
                        <div className={styles.onionLine}>
                            {'Distance'}
                            <span className={styles.onionStepper}>
                                {[4, 8, 12, 20].map(n => (
                                    <button
                                        className={classNames(styles.onionChoice, {[styles.onionChoiceOn]: v.snapDist === n})}
                                        key={n}
                                        type="button"
                                        onClick={handler(this, `d${n}`, () => this.update('snapDist', n))}
                                    >{n}</button>
                                ))}
                            </span>
                        </div>
                        <div className={styles.onionLine}>
                            {'Guide color'}
                            <span className={styles.onionStepper}>
                                <ColorSwatch
                                    title="Guide color"
                                    value={v.snapColor}
                                    onChange={handler(this, 'sc', c => this.update('snapColor', c))}
                                    onCommit={handler(this, 'sc2', c => this.update('snapColor', c))}
                                />
                            </span>
                        </div>
                    </div>
                ) : null}
            </div>
        );
    }
}
SnapControls.propTypes = {ed: PropTypes.object.isRequired};
const DialogFrame = ({title, size, children, buttons, left, onClose, settings}) => (
    <Modal
        className={classNames(settings ? settingsStyles.modalContent : promptStyles.modalContent, {
            [styles$1.wide]: size === 'wide',
            [styles$1.full]: size === 'full',
            [styles$1.medium]: size === 'medium'
        })}
        contentLabel={title}
        id="dimodAnimationDialog"
        onRequestClose={onClose}
    >
        <Box className={classNames(settings ? settingsStyles.body : promptStyles.body, styles$1.body)}>
            {children}
            <div className={classNames(promptStyles.buttonRow, styles$1.buttonRow)}>
                {left ? <div className={styles$1.buttonRowLeft}>{left}</div> : null}
                {buttons.map(b => (
                    <button
                        className={b.primary ? promptStyles.okButton : promptStyles.cancelButton}
                        disabled={b.disabled}
                        key={b.label}
                        style={b.danger ? {background: 'hsla(0, 80%, 52%, 1)', borderColor: 'hsla(0, 80%, 52%, 1)', color: 'white'} : null}
                        onClick={b.onClick}
                    >
                        {b.label}
                    </button>
                ))}
            </div>
        </Box>
    </Modal>
);
DialogFrame.propTypes = {
    settings: PropTypes.bool,
    buttons: PropTypes.arrayOf(PropTypes.shape({
        danger: PropTypes.bool,
        disabled: PropTypes.bool,
        label: PropTypes.string.isRequired,
        onClick: PropTypes.func.isRequired,
        primary: PropTypes.bool
    })).isRequired,
    children: PropTypes.node,
    left: PropTypes.node,
    onClose: PropTypes.func.isRequired,
    size: PropTypes.oneOf(['small', 'medium', 'wide', 'full']),
    title: PropTypes.string.isRequired
};
class TileGrid extends React.Component {
    constructor (props) { super(props); this.handleClick = this.handleClick.bind(this); }
    handleClick (e) {
        const i = Number(e.currentTarget.getAttribute('data-index'));
        const option = this.props.options[i];
        if (option) this.props.onPick(option.value);
    }
    render () {
        return (
            <div className={styles$1.tiles}>
                {this.props.options.map((o, i) => (
                    <button
                        className={classNames(itemStyles.spriteSelectorItem, styles$1.tile, {
                            [itemStyles.isSelected]: o.selected
                        })}
                        data-index={i}
                        key={`${i}:${o.label}`}
                        title={o.label}
                        type="button"
                        onClick={this.handleClick}
                    >
                        <div className={itemStyles.spriteImageOuter}>
                            <div className={itemStyles.spriteImageInner}>
                                <div className={styles$1.tileImage} style={o.img ? {backgroundImage: `url("${o.img}")`} : null} />
                            </div>
                        </div>
                        <div className={itemStyles.spriteInfo}>
                            <div className={itemStyles.spriteName}>{o.label}</div>
                            {o.sub ? <div className={itemStyles.spriteDetails}>{o.sub}</div> : null}
                        </div>
                    </button>
                ))}
            </div>
        );
    }
}
TileGrid.propTypes = {
    onPick: PropTypes.func.isRequired,
    options: PropTypes.arrayOf(PropTypes.shape({
        img: PropTypes.string,
        label: PropTypes.string.isRequired,
        selected: PropTypes.bool,
        sub: PropTypes.string,
        value: PropTypes.any
    })).isRequired
};
class AddPartDialog extends React.Component {
    constructor (props) {
        super(props);
        this.state = {sprite: null};
        this.handlePickSprite = this.handlePickSprite.bind(this);
        this.handlePickCostume = this.handlePickCostume.bind(this);
        this.handleBack = this.handleBack.bind(this);
        this.handleAll = this.handleAll.bind(this);
        this.handleCancel = this.handleCancel.bind(this);
    }
    handlePickSprite (i) { this.setState({sprite: i}); }
    handlePickCostume (c) { this.props.onDone({sprite: this.state.sprite, costume: c}); }
    handleBack () { this.setState({sprite: null}); }
    handleAll () { this.props.onDone({sprite: this.state.sprite, all: true}); }
    handleCancel () { this.props.onDone(null); }
    render () {
        const {sprites, title, allowAll} = this.props;
        const picked = this.state.sprite === null ? null : sprites[this.state.sprite];
        if (!picked) {
            return (
                <DialogFrame
                    buttons={[{label: 'Cancel', onClick: this.handleCancel}]}
                    size="wide"
                    title={title}
                    onClose={this.handleCancel}
                >
                    <div className={styles$1.hint}>
                        {'Pick the sprite whose costumes this part uses. "This sprite" is the sprite the animation ' +
                            'belongs to, so it keeps working on its clones and on copies of the sprite.'}
                    </div>
                    <div className={styles$1.scroll}>
                        <TileGrid
                            options={sprites.map((s, i) => ({value: i, label: s.label, sub: s.sub, img: s.img, selected: s.selected}))}
                            onPick={this.handlePickSprite}
                        />
                    </div>
                </DialogFrame>
            );
        }
        const buttons = [{label: 'Cancel', onClick: this.handleCancel}];
        if (allowAll && picked.costumes.length > 1) {
            buttons.unshift({label: `One part per costume (${picked.costumes.length})`, onClick: this.handleAll});
        }
        return (
            <DialogFrame
                buttons={buttons}
                left={(
                    <button className={promptStyles.cancelButton} onClick={this.handleBack}>
                        {'Back'}
                    </button>
                )}
                size="wide"
                title={title}
                onClose={this.handleCancel}
            >
                <div className={styles$1.hint}>
                    {`Costumes of ${picked.label === 'This sprite' ? 'this sprite' : `"${picked.label}"`}... pick the one ` +
                        'the part starts with. Every costume stays available for costume keys.'}
                </div>
                <div className={styles$1.scroll}>
                    <TileGrid
                        options={picked.costumes.map((c, i) => ({value: i, label: c.name, sub: `#${i + 1}`, img: c.img}))}
                        onPick={this.handlePickCostume}
                    />
                </div>
            </DialogFrame>
        );
    }
}
AddPartDialog.propTypes = {
    allowAll: PropTypes.bool,
    onDone: PropTypes.func.isRequired,
    sprites: PropTypes.arrayOf(PropTypes.shape({
        costumes: PropTypes.arrayOf(PropTypes.shape({img: PropTypes.string, name: PropTypes.string})),
        img: PropTypes.string,
        label: PropTypes.string,
        selected: PropTypes.bool,
        sub: PropTypes.string
    })).isRequired,
    title: PropTypes.string
};
AddPartDialog.defaultProps = {allowAll: true, title: 'Add part'};
const Row = ({label, hint, children}) => (
    <div className={styles$1.formRow}>
        <div className={styles$1.formLabel}>
            <b>{label}</b>
            {hint ? <div className={styles$1.hint}>{hint}</div> : null}
        </div>
        <div className={styles$1.formControl}>{children}</div>
    </div>
);
Row.propTypes = {children: PropTypes.node, hint: PropTypes.string, label: PropTypes.string};
class SettingsDialog extends React.Component {
    constructor (props) {
        super(props);
        this.handleDone = () => this.props.onDone(true);
        this.handleReset = () => { this.props.onReset(); this.props.onDone(true); };
    }
    change (key, value) { this.props.onChange(key, value); this.forceUpdate(); }
    control (f, value) {
        const onValue = handler(this, f.key, v => this.change(f.key, v));
        switch (f.type) {
        case 'switch':
            return (<Switch checked={!!value} title={f.label} onChange={onValue} />);
        case 'select':
            return (
                <Dropdown
                    className={styles.grow}
                    options={f.options}
                    title={f.label}
                    value={value}
                    onChange={handler(this, `${f.key}:select`, v => this.change(f.key, String(v)))}
                />
            );
        case 'color':
            return (<ColorSwatch title={f.label} value={value} onChange={onValue} onCommit={onValue} />);
        default:
            return (<ScrubField
                max={f.max}
                min={f.min}
                precision={typeof f.precision === 'number' ? f.precision : 2}
                step={f.step || 1}
                title={f.label}
                unit={f.unit}
                value={Number(value)}
                onChange={handler(this, `${f.key}:scrub`, (v, phase) => {
                    if (phase !== 'start') this.change(f.key, v);
                })}
            />);
        }
    }
    renderRow (f, value) {
        if (f.type === 'switch') {
            return (
                <label
                    className={classNames(settingsStyles.setting, {[settingsStyles.active]: !!value})}
                    key={f.key}
                    title={f.hint}
                >
                    <span className={settingsStyles.label}>
                        <input
                            checked={!!value}
                            className={settingsStyles.checkbox}
                            type="checkbox"
                            onChange={handler(this, `${f.key}:check`, e => this.change(f.key, e.target.checked))}
                        />
                        {f.label}
                    </span>
                    {f.hint ? <span className={styles$1.settingHint}>{f.hint}</span> : null}
                </label>
            );
        }
        return (
            <div className={settingsStyles.setting} key={f.key} title={f.hint}>
                <span className={classNames(settingsStyles.label, styles$1.settingLine)}>
                    <span className={styles.grow}>{f.label}</span>
                    {this.control(f, value)}
                </span>
                {f.hint ? <span className={styles$1.settingHint}>{f.hint}</span> : null}
            </div>
        );
    }
    render () {
        const values = this.props.values();
        const extra = (this.props.extra || []).filter(Boolean);
        return (
            <DialogFrame
                buttons={[]}
                left={this.props.onReset || extra.length ? (
                    <React.Fragment>
                        {extra.map(b => (
                            <button
                                className={promptStyles.cancelButton}
                                key={b.label}
                                onClick={handler(this, `extra:${b.label}`, () => { this.props.onDone(true); b.onClick(); })}
                            >
                                {b.label}
                            </button>
                        ))}
                        {this.props.onReset ? (
                            <button className={promptStyles.cancelButton} onClick={this.handleReset}>
                                {'Reset to defaults'}
                            </button>
                        ) : null}
                    </React.Fragment>
                ) : null}
                settings
                size="medium"
                title={this.props.title}
                onClose={this.handleDone}
            >
                <div>
                    {this.props.fields.map(f => this.renderRow(f, values[f.key]))}
                </div>
            </DialogFrame>
        );
    }
}
SettingsDialog.propTypes = {
    extra: PropTypes.arrayOf(PropTypes.object),
    fields: PropTypes.arrayOf(PropTypes.object).isRequired,
    onChange: PropTypes.func.isRequired,
    onDone: PropTypes.func.isRequired,
    onReset: PropTypes.func,
    title: PropTypes.string.isRequired,
    values: PropTypes.func.isRequired
};
class FormDialog extends React.Component {
    constructor (props) {
        super(props);
        this.state = {values: Object.assign({}, props.initial)};
        this.handleOk = () => this.props.onDone(this.state.values);
        this.handleCancel = () => this.props.onDone(null);
    }
    set (key, value) { this.setState(({values}) => ({values: Object.assign({}, values, {[key]: value})})); }
    control (f, value) {
        const onValue = handler(this, f.key, v => this.set(f.key, v));
        switch (f.type) {
        case 'switch':
            return (<Switch checked={!!value} title={f.label} onChange={onValue} />);
        case 'select':
            return (
                <Dropdown
                    className={styles.grow}
                    options={f.options}
                    title={f.label}
                    value={value}
                    onChange={handler(this, `${f.key}:select`, v => this.set(f.key, f.numeric ? Number(v) : v))}
                />
            );
        case 'color':
            return (<ColorSwatch title={f.label} value={value} onChange={onValue} onCommit={onValue} />);
        case 'text':
            return (<input
                aria-label={f.label}
                className={styles$1.textInput}
                spellCheck="false"
                type="text"
                value={value}
                onChange={handler(this, `${f.key}:text`, e => this.set(f.key, e.target.value))}
                onKeyDown={handler(this, `${f.key}:key`, e => {
                    e.stopPropagation();
                    if (e.key === 'Enter') this.handleOk();
                })}
            />);
        default:
            return (<ScrubField
                max={f.max}
                min={f.min}
                precision={typeof f.precision === 'number' ? f.precision : 2}
                step={f.step || 1}
                title={f.label}
                unit={f.unit}
                value={Number(value)}
                onChange={handler(this, `${f.key}:scrub`, (v, phase) => {
                    if (phase !== 'start') this.set(f.key, f.round ? Math.round(v) : v);
                })}
            />);
        }
    }
    render () {
        const {values} = this.state;
        const {title, fields, info, okLabel, hint, size} = this.props;
        return (
            <DialogFrame
                buttons={[{label: 'Cancel', onClick: this.handleCancel}, {label: okLabel, primary: true, onClick: this.handleOk}]}
                size={size}
                title={title}
                onClose={this.handleCancel}
            >
                {hint ? <div className={styles$1.hint}>{hint}</div> : null}
                <div className={styles$1.form}>
                    {fields.filter(f => !f.show || f.show(values)).map(f => (
                        <Row hint={f.hint} key={f.key} label={f.label}>
                            {this.control(f, values[f.key])}
                        </Row>
                    ))}
                </div>
                {info ? <div className={styles$1.hint}>{info(values)}</div> : null}
            </DialogFrame>
        );
    }
}
FormDialog.propTypes = {
    fields: PropTypes.arrayOf(PropTypes.object).isRequired,
    hint: PropTypes.string,
    info: PropTypes.func,
    initial: PropTypes.object.isRequired,
    okLabel: PropTypes.string,
    onDone: PropTypes.func.isRequired,
    size: PropTypes.string,
    title: PropTypes.string.isRequired
};
FormDialog.defaultProps = {okLabel: 'OK', size: 'medium'};
class ProgressDialog extends React.Component {
    constructor (props) {
        super(props);
        this.handleUpdate = () => this.forceUpdate();
        this.handleCancel = () => { this.props.handle.cancelled = true; this.forceUpdate(); };
        this.handleNothing = () => {};
    }
    componentDidMount () { this.props.handle.listeners.add(this.handleUpdate); }
    componentWillUnmount () { this.props.handle.listeners.delete(this.handleUpdate); }
    render () {
        const {handle, title} = this.props;
        return (
            <DialogFrame
                buttons={[{label: handle.cancelled ? 'Stopping…' : 'Cancel', disabled: handle.cancelled, onClick: this.handleCancel}]}
                size="medium"
                title={title}
                onClose={this.handleNothing}
            >
                <div className={styles$1.progress}>
                    <div className={styles$1.progressFill} style={{width: `${Math.round(handle.fraction * 100)}%`}} />
                </div>
                <div className={styles$1.hint}>{handle.text}</div>
            </DialogFrame>
        );
    }
}
ProgressDialog.propTypes = {
    handle: PropTypes.shape({
        cancelled: PropTypes.bool,
        fraction: PropTypes.number,
        listeners: PropTypes.instanceOf(Set),
        text: PropTypes.string
    }).isRequired,
    title: PropTypes.string.isRequired
};
const LANGUAGE = 'dimod-anim-expr';
let registered = false;
let completionData = [];
const register = () => {
    if (registered) return;
    registered = true;
    monaco.languages.register({id: LANGUAGE});
    monaco.languages.setMonarchTokensProvider(LANGUAGE, {
        keywords: ['return', ...EXPR_COMPLETIONS.map(c => c.name)],
        tokenizer: {
            root: [
                [/\d*\.?\d+([eE][-+]?\d+)?/, 'number'],
                [/"([^"\\]|\\.)*"/, 'string'],
                [/'([^'\\]|\\.)*'/, 'string'],
                [/[A-Za-z_$][\w$]*/, {cases: {'@keywords': 'keyword', '@default': 'identifier'}}],
                [/[+\-*/%<>=!&|?:]+/, 'operator']
            ]
        }
    });
    monaco.languages.registerCompletionItemProvider(LANGUAGE, {
        provideCompletionItems: (model, position) => {
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn
            };
            return {
                suggestions: [...EXPR_COMPLETIONS, ...completionData].map(c => ({
                    label: c.name,
                    kind: c.meta === 'function' ? monaco.languages.CompletionItemKind.Function :
                        monaco.languages.CompletionItemKind.Variable,
                    detail: c.meta,
                    insertText: c.meta === 'function' ? `${c.name}(` : c.name,
                    range
                }))
            };
        }
    });
};
class ExprCodeEditor extends React.Component {
    constructor (props) { super(props); this.hostRef = React.createRef(); this.applying = false; }
    componentDidMount () {
        if (!monacoReady()) return loadMonaco().then(() => !this.unmounted && this.componentDidMount(), () => {});
        register();
        completionData = this.props.dataNames.map(n => ({name: `data.${n}`, meta: 'data track'}));
        this.editor = monaco.editor.create(this.hostRef.current, {
            value: this.props.value,
            language: LANGUAGE,
            theme: monacoThemeName(),
            automaticLayout: true,
            minimap: {enabled: false},
            lineNumbers: 'off',
            glyphMargin: false,
            folding: false,
            wordWrap: 'on',
            fontSize: 15,
            lineHeight: 22,
            fontFamily: 'Menlo, Monaco, "Droid Sans Mono", "Courier New", monospace',
            scrollBeyondLastLine: false,
            fixedOverflowWidgets: true,
            renderLineHighlight: 'none'
        });
        this.editor.onDidChangeModelContent(() => {
            if (!this.applying) this.props.onChange(this.editor.getValue());
        });
        this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => this.props.onApply());
        this.editor.focus();
    }
    componentDidUpdate () {
        if (this.editor && this.editor.getValue() !== this.props.value) {
            this.applying = true;
            this.editor.setValue(this.props.value);
            this.applying = false;
        }
    }
    componentWillUnmount () {
        this.unmounted = true;
        if (this.editor) { this.editor.getModel().dispose(); this.editor.dispose(); }
    }
    render () {
        return (
            <div className={styles$2.codeHost} ref={this.hostRef} />
        );
    }
}
ExprCodeEditor.propTypes = {
    dataNames: PropTypes.arrayOf(PropTypes.string).isRequired,
    onApply: PropTypes.func.isRequired,
    onChange: PropTypes.func.isRequired,
    value: PropTypes.string.isRequired
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
    comments: false,
    collapse: false,
    sounds: false
};
const CHANGE_MS = 60;
class ExprBlocksEditor extends React.Component {
    constructor (props) {
        super(props);
        this.hostRef = React.createRef();
        this.workspace = null;
        this.loading = false;
        this.timer = 0;
        this.handleChange = this.handleChange.bind(this);
        this.handleResize = this.handleResize.bind(this);
    }
    componentDidMount () {
        LazyScratchBlocks.load().then(ScratchBlocks => {
            if (!this.hostRef.current) return;
            this.ScratchBlocks = ScratchBlocks;
            setExprDataNames(this.props.dataNames);
            this.previousMain = ScratchBlocks.getMainWorkspace();
            const media = this.previousMain && this.previousMain.options && this.previousMain.options.pathToMedia;
            this.workspace = ScratchBlocks.inject(this.hostRef.current, Object.assign({}, WORKSPACE_OPTIONS, {
                media: media || 'static/blocks-media/',
                toolbox: exprToolboxXML()
            }));
            ScratchBlocks.mainWorkspace = this.workspace;
            this.load(this.props.xml);
            this.workspace.addChangeListener(this.handleChange);
            this.resizeObserver = new ResizeObserver(this.handleResize);
            this.resizeObserver.observe(this.hostRef.current);
        });
    }
    componentDidUpdate (prevProps) {
        const replaced = this.props.xml !== prevProps.xml && this.props.xml !== this.lastXml;
        if (this.workspace && replaced) this.load(this.props.xml);
    }
    componentWillUnmount () {
        clearTimeout(this.timer);
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.workspace) {
            const ScratchBlocks = this.ScratchBlocks;
            ScratchBlocks.hideChaff();
            this.workspace.removeChangeListener(this.handleChange);
            this.workspace.dispose();
            if (ScratchBlocks.getMainWorkspace() === this.workspace || !ScratchBlocks.getMainWorkspace()) {
                ScratchBlocks.mainWorkspace = this.previousMain;
            }
            this.workspace = null;
        }
    }
    load (xml) {
        const ScratchBlocks = this.ScratchBlocks;
        this.loading = true;
        try {
            this.workspace.clear();
            ScratchBlocks.Xml.domToWorkspace(ScratchBlocks.Xml.textToDom(xml), this.workspace);
            this.lastXml = xml;
            this.clearFlyout();
        } finally { this.loading = false; }
    }
    clearFlyout () {
        const ws = this.workspace;
        const root = ws.getTopBlocks(false).find(b => b.type === EXPR_BLOCK.called);
        const flyout = ws.getFlyout && ws.getFlyout();
        const host = this.hostRef.current;
        if (!root || !flyout || !flyout.svgGroup_ || !host) return;
        const flyoutBox = flyout.svgGroup_.getBoundingClientRect();
        const blockBox = root.getSvgRoot().getBoundingClientRect();
        const hostBox = host.getBoundingClientRect();
        const dx = (flyoutBox.right + 24) - blockBox.left;
        const dy = (hostBox.top + 24) - blockBox.top;
        root.moveBy(dx / ws.scale, dy / ws.scale);
    }
    handleResize () {
        if (this.workspace) this.ScratchBlocks.svgResize(this.workspace);
    }
    handleChange (e) {
        if (this.loading || !this.workspace || (e && e.type === 'ui')) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            if (!this.workspace) return;
            const ScratchBlocks = this.ScratchBlocks;
            const xml = ScratchBlocks.Xml.domToText(ScratchBlocks.Xml.workspaceToDom(this.workspace));
            this.lastXml = xml;
            this.props.onChange(blocksToExpr(this.workspace), xml);
        }, CHANGE_MS);
    }
    render () {
        return (
            <div className={styles$2.blocksHost} ref={this.hostRef} />
        );
    }
}
ExprBlocksEditor.propTypes = {
    dataNames: PropTypes.arrayOf(PropTypes.string).isRequired,
    onChange: PropTypes.func.isRequired,
    xml: PropTypes.string.isRequired
};
class ExprPlot extends React.Component {
    constructor (props) { super(props); this.canvasRef = React.createRef(); }
    componentDidMount () { this.draw(); }
    componentDidUpdate () { this.draw(); }
    draw () {
        const canvas = this.canvasRef.current;
        const {ed, group, trackKey, keyIds, text} = this.props;
        if (!canvas || !group) return;
        const st = ed.st;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth || 600;
        const h = canvas.clientHeight || 110;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const tr = group.tracks[trackKey];
        const numeric = TD[trackKey].kind !== 'costume' && !TD[trackKey].str;
        const sampler = tr && tr.keyframes.length && numeric ? new Sampler(tr, trackKey) : null;
        const fn = compileExpr(text);
        const editing = new Set(keyIds);
        const exprAt = t => {
            if (!sampler) return fn;
            const kf = tr.keyframes[sampler.activeIndex(t)];
            if (!kf) return null;
            return editing.has(kf.id) ? fn : compileExpr(kf.expr || tr.expr);
        };
        const end = st.doc.infinite ? 4 : st.doc.duration;
        const data = st.dataAt(0);
        const now = Date.now() / 1000;
        const n = Math.max(2, Math.floor(w / 2));
        const base = [];
        const out = [];
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i <= n; i++) {
            const t = (end * i) / n;
            const v = sampler ? sampler.sampleNum(t) : (TD[trackKey].def || 0);
            let o = v;
            const f = exprAt(t);
            if (f) { const r = f(t, v, data, now + t); o = r === null || !Number.isFinite(Number(r)) ? NaN : Number(r); }
            base.push(v);
            out.push(o);
            for (const x of [v, o]) {
                if (Number.isFinite(x)) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
            }
        }
        if (!Number.isFinite(lo)) return;
        if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
        const y = v => h - 8 - (((v - lo) / (hi - lo)) * (h - 16));
        const colors = ed.colors();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = colors.text2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        base.forEach((v, i) => (i ? ctx.lineTo((i / n) * w, y(v)) : ctx.moveTo(0, y(v))));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let pen = false;
        out.forEach((v, i) => {
            if (!Number.isFinite(v)) { pen = false; return; }
            if (pen) ctx.lineTo((i / n) * w, y(v));
            else ctx.moveTo((i / n) * w, y(v));
            pen = true;
        });
        ctx.stroke();
        ctx.fillStyle = colors.accent;
        ctx.fillRect((st.sec / end) * w, 0, 1.5, h);
        ctx.font = `bold 10px ${ed.font()}`;
        ctx.fillStyle = colors.text2;
        ctx.fillText(hi.toFixed(1), 4, 11);
        ctx.fillText(lo.toFixed(1), 4, h - 3);
    }
    render () {
        return (
            <canvas aria-label="What the expression does over the animation" className={styles$2.plot} ref={this.canvasRef} />
        );
    }
}
ExprPlot.propTypes = {
    ed: PropTypes.object.isRequired,
    group: PropTypes.object,
    keyIds: PropTypes.arrayOf(PropTypes.string).isRequired,
    text: PropTypes.string.isRequired,
    trackKey: PropTypes.string.isRequired
};
const labelOf = key => (TD[key] ? TD[key].label : key);
const isNothing = text => !text || text === 'value';
const codeOf = text => `return ${text || 'value'};`;
class ExpressionDialog extends React.Component {
    constructor (props) {
        super(props);
        const infos = this.infos();
        const tr = this.track();
        const exprs = tr ? [tr.expr || ''] : [...new Set(infos.map(i => i.kf.expr || ''))];
        const text = exprs.length === 1 ? exprs[0] : '';
        const xmls = tr ? [tr.exprBlocks || ''] : [...new Set(infos.map(i => i.kf.exprBlocks || ''))];
        const saved = exprs.length === 1 && xmls.length === 1 && isExprBlocksXML(xmls[0]) ? xmls[0] : null;
        let mode = prefs.exprMode === 'blocks' ? 'blocks' : 'code';
        if (text) mode = saved ? 'blocks' : 'code';
        this.mixed = exprs.length > 1;
        this.hadExpr = exprs.some(Boolean);
        const state = {
            text,
            code: codeOf(text),
            xml: saved,
            xmlText: saved ? text : null,
            mode,
            blocksProblem: '',
            blocksError: ''
        };
        if (mode === 'blocks' && !this.blocksFor(state)) state.mode = 'code';
        this.state = state;
        this.handleApply = () => this.apply(false);
        this.handleClear = () => this.apply(true);
        this.handleCancel = () => this.props.onDone(null);
        this.handleCode = () => this.setMode('code');
        this.handleBlocks = () => this.setMode('blocks');
        this.handleCodeChange = code => this.setState({code, text: exprBody(code)});
        this.handleBlocksChange = (result, xml) => {
            if (result.error) this.setState({xml, blocksProblem: result.error});
            else {
                const made = result.text;
                this.setState({text: made, code: codeOf(made), xml, xmlText: made, blocksProblem: ''});
            }
        };
    }
    infos () {
        const st = this.props.ed.st;
        const tr = this.track();
        if (this.props.track) {
            if (!tr) return [];
            const own = tr.keyframes.filter(kf => !kf.expr);
            return (own.length ? own : tr.keyframes).map(kf => st.index.get(kf.id))
                .filter(i => i && i.kind === 'track');
        }
        return this.props.keyIds.map(id => st.index.get(id)).filter(i => i && i.kind === 'track');
    }
    track () {
        const t = this.props.track;
        if (!t) return null;
        const g = this.props.ed.st.group(t.group);
        return (g && g.tracks[t.key]) || null;
    }
    blocksFor (into) {
        if (into.xml && into.xmlText === into.text) return true;
        try {
            into.xml = exprToBlocksXML(into.text);
            into.xmlText = into.text;
            into.blocksError = '';
            return true;
        } catch (e) { into.blocksError = `This can't be shown as blocks yet: ${e.message}`; return false; }
    }
    setMode (mode) {
        if (this.state.mode === mode) return;
        if (mode === 'blocks') {
            const next = Object.assign({}, this.state);
            if (!this.blocksFor(next)) { this.setState({blocksError: next.blocksError}); return; }
            this.setState({xml: next.xml, xmlText: next.xmlText, blocksError: '', mode});
        } else { this.setState({code: codeOf(this.state.text), blocksError: '', mode}); }
        prefs.exprMode = mode;
        savePrefs();
    }
    insertSnippet (text) {
        if (this.state.mode === 'blocks') {
            const next = {text, xml: null, xmlText: null};
            if (!this.blocksFor(next)) { this.setState({blocksError: next.blocksError}); return; }
            this.setState({text, code: codeOf(text), xml: next.xml, xmlText: text, blocksProblem: '', blocksError: ''});
            return;
        }
        this.setState({text, code: codeOf(text)});
    }
    problem () {
        const {mode, blocksProblem, text} = this.state;
        if (mode === 'blocks' && blocksProblem) return blocksProblem;
        return checkExpr(text);
    }
    apply (clear) {
        const text = clear ? '' : exprBody(this.state.text);
        if (!clear && this.problem()) return;
        if (isNothing(text)) this.props.apply('', null);
        else this.props.apply(text, this.state.mode === 'blocks' ? this.state.xml : null);
        this.props.onDone(true);
    }
    describe (infos) {
        if (this.props.track) return `${this.props.track.group} ${labelOf(this.props.track.key)}: default expression`;
        if (infos.length === 1) { const i = infos[0]; return `${i.group.name} ${labelOf(i.key)} at ${i.kf.sec.toFixed(2)}s`; }
        const names = [...new Set(infos.map(i => `${i.group.name} ${labelOf(i.key)}`))];
        const shown = names.slice(0, 3).join(', ');
        const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
        return `${infos.length} keyframes: ${shown}${more}`;
    }
    trackHint () {
        const tr = this.track();
        const own = tr ? tr.keyframes.filter(kf => kf.expr).length : 0;
        const wins = own ? `${own} key${own === 1 ? ' has its' : 's have their'} own expression, which wins. ` : '';
        return `Every key of this track runs it, including keys you add later. ${wins}` +
            'value is what the keyframes say there; return what to use instead.';
    }
    renderEditor () {
        const dataNames = this.props.ed.st.doc.dataTracks.map(dt => dt.name);
        if (this.state.mode === 'blocks') {
            return (
                <ExprBlocksEditor dataNames={dataNames} xml={this.state.xml} onChange={this.handleBlocksChange} />
            );
        }
        return (
            <div className={styles$2.codeFrame}>
                <div className={styles$2.codeLine}>
                    <span className={styles$2.codeKeyword}>{'function'}</span>
                    {' (value) {'}
                </div>
                <div className={styles$2.codeBody}>
                    <ExprCodeEditor
                        dataNames={dataNames}
                        value={this.state.code}
                        onApply={this.handleApply}
                        onChange={this.handleCodeChange}
                    />
                </div>
                <div className={styles$2.codeLine}>{'}'}</div>
            </div>
        );
    }
    renderSide () {
        return (
            <div className={styles$2.side}>
                <div className={styles$2.sideTitle}>{'Presets'}</div>
                {SNIPPETS.map(([group, label, code], i) => (
                    <React.Fragment key={label}>
                        {i === 0 || SNIPPETS[i - 1][0] !== group ?
                            <div className={styles$2.groupLabel}>{group}</div> : null}
                        <button
                            className={styles$2.snippet}
                            title={codeOf(code)}
                            type="button"
                            onClick={handler(this, `snippet:${label}`, () => this.insertSnippet(code))}
                        >
                            {label}
                        </button>
                    </React.Fragment>
                ))}
                <div className={classNames(styles$2.sideTitle, styles$2.sideGap)}>{'Reference'}</div>
                {EXPR_HELP.map(([k, desc]) => (
                    <div className={styles$2.help} key={k}>
                        <code>{k}</code>
                        {desc ? <span>{desc}</span> : null}
                    </div>
                ))}
            </div>
        );
    }
    render () {
        const infos = this.infos();
        const first = infos[0];
        const err = this.problem();
        const {mode, text} = this.state;
        let status = 'Looks good';
        let statusKind = 'good';
        if (err) { status = err; statusKind = 'bad'; } else if (isNothing(exprBody(text))) {
            status = 'Returns the value unchanged, so the keyframes decide.';
            statusKind = '';
        }
        const buttons = [
            {label: 'Cancel', onClick: this.handleCancel},
            {label: 'Apply', primary: true, disabled: !!err, onClick: this.handleApply}
        ];
        const clear = this.hadExpr ? (
            <button className={styles$2.clearButton} type="button" onClick={this.handleClear}>
                {infos.length === 1 || this.props.track ? 'Clear expression' : 'Clear from all'}
            </button>
        ) : <span className={styles$2.footHint}>{'Ctrl+Enter applies'}</span>;
        return (
            <DialogFrame buttons={buttons} left={clear} size="full" title="Expression" onClose={this.handleCancel}>
                <div className={styles$2.layout}>
                    <div className={styles$2.main}>
                        <div className={styles$2.head}>
                            <div className={styles$2.titles}>
                                <b>{first ? this.describe(infos) : 'These keyframes are gone'}</b>
                                <span>
                                    {this.props.track ? this.trackHint() : this.mixed ?
                                        'These keys have different expressions. Applying gives them all this one.' :
                                        'Runs every frame from each key to the next. value is what the keyframes ' +
                                        'say there; return what to use instead.'}
                                </span>
                            </div>
                            <div className={styles$2.segmented} role="tablist">
                                <button
                                    aria-selected={mode === 'code'}
                                    className={classNames(styles$2.segment, {[styles$2.segmentOn]: mode === 'code'})}
                                    role="tab"
                                    type="button"
                                    onClick={this.handleCode}
                                >
                                    {'Code'}
                                </button>
                                <button
                                    aria-selected={mode === 'blocks'}
                                    className={classNames(styles$2.segment, {[styles$2.segmentOn]: mode === 'blocks'})}
                                    role="tab"
                                    type="button"
                                    onClick={this.handleBlocks}
                                >
                                    {'Blocks'}
                                </button>
                            </div>
                        </div>
                        <div className={classNames(styles$2.editorArea, {[styles$2.editorAreaBlocks]: mode === 'blocks'})}>
                            {first ? this.renderEditor() : null}
                        </div>
                        {this.state.blocksError ? (
                            <div className={styles$2.statusBad}>{this.state.blocksError}</div>
                        ) : null}
                        <div
                            className={classNames(styles$2.status, {
                                [styles$2.statusGood]: statusKind === 'good',
                                [styles$2.statusBad]: statusKind === 'bad'
                            })}
                        >
                            {status}
                        </div>
                        {first ? (
                            <ExprPlot
                                ed={this.props.ed}
                                group={first.group}
                                keyIds={infos.filter(i => i.group === first.group && i.key === first.key)
                                    .map(i => i.kf.id)}
                                text={exprBody(text)}
                                trackKey={first.key}
                            />
                        ) : null}
                    </div>
                    {this.renderSide()}
                </div>
            </DialogFrame>
        );
    }
}
ExpressionDialog.propTypes = {
    apply: PropTypes.func.isRequired,
    ed: PropTypes.object.isRequired,
    keyIds: PropTypes.arrayOf(PropTypes.string).isRequired,
    onDone: PropTypes.func.isRequired,
    track: PropTypes.shape({group: PropTypes.string, key: PropTypes.string})
};
const ChooseDialog = ({title, hint, options, onDone, onCancel}) => (
    <DialogFrame buttons={[{label: 'Cancel', onClick: onCancel}]} size="wide" title={title} onClose={onCancel}>
        {hint ? <div className={styles$1.hint}>{hint}</div> : null}
        <div className={styles$1.scroll}>
            <TileGrid options={options} onPick={onDone} />
        </div>
    </DialogFrame>
);
ChooseDialog.propTypes = {
    hint: PropTypes.string,
    onCancel: PropTypes.func.isRequired,
    onDone: PropTypes.func.isRequired,
    options: PropTypes.arrayOf(PropTypes.object).isRequired,
    title: PropTypes.string.isRequired
};
const formatLength = seconds => (seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : `${seconds.toFixed(1)}s`);
const SoundDialog = ({sounds, onCancel, onPick}) => {
    const [query, setQuery] = React.useState('');
    const [closed, setClosed] = React.useState({});
    const [playing, setPlaying] = React.useState(-1);
    const audio = React.useRef(null);
    const stop = () => {
        if (audio.current) audio.current.pause();
        audio.current = null;
        setPlaying(-1);
    };
    React.useEffect(() => () => {
        if (audio.current) audio.current.pause();
    }, []);
    const preview = (event, index) => {
        event.stopPropagation();
        const wasPlaying = playing === index;
        stop();
        if (wasPlaying) return;
        const url = sounds[index].url();
        if (!url) return;
        const player = new Audio(url);
        player.onended = stop;
        audio.current = player;
        setPlaying(index);
        player.play().catch(stop);
    };
    const q = query.trim().toLowerCase();
    const groups = [];
    sounds.forEach((sound, index) => {
        if (q && !sound.sound.toLowerCase().includes(q) && !sound.where.toLowerCase().includes(q)) return;
        let group = groups.find(g => g.where === sound.where);
        if (!group) groups.push(group = {where: sound.where, mine: sound.isThisSprite, rows: []});
        group.rows.push({sound, index});
    });
    groups.sort((x, y) => Number(y.mine) - Number(x.mine));
    return (
        <DialogFrame buttons={[{label: 'Cancel', onClick: onCancel}]} size="wide" title="Pick a sound" onClose={onCancel}>
            <input
                autoFocus
                className={styles$1.soundSearch}
                placeholder={`Search ${sounds.length} sounds`}
                value={query}
                onChange={e => setQuery(e.target.value)}
            />
            <div className={styles$1.scroll}>
                {groups.map(group => {
                    const open = q ? true : !closed[group.where];
                    return (
                        <div key={group.where}>
                            <button
                                className={styles$1.soundHead}
                                type="button"
                                onClick={() => setClosed(Object.assign({}, closed, {[group.where]: open}))}
                            >
                                {`${open ? '▾' : '▸'} ${group.where}${group.mine ? ' (this sprite)' : ''}`}
                                <span className={styles$1.soundCount}>{group.rows.length}</span>
                            </button>
                            {open ? group.rows.map(({sound, index}) => (
                                <div
                                    className={styles$1.soundRow}
                                    key={index}
                                    onClick={() => onPick({currentTarget: {getAttribute: () => String(index)}})}
                                >
                                    <button
                                        className={styles$1.soundPlay}
                                        title={playing === index ? 'Stop' : 'Preview'}
                                        type="button"
                                        onClick={e => preview(e, index)}
                                    >{playing === index ? '■' : '▶'}</button>
                                    <span className={styles$1.soundName}>{sound.sound}</span>
                                    <span className={styles$1.soundCount}>{formatLength(sound.duration)}</span>
                                </div>
                            )) : null}
                        </div>
                    );
                })}
                {!groups.length ? (
                    <div className={styles$1.hint}>
                        {sounds.length ? 'No sound matches that search.' : 'This project has no sounds.'}
                    </div>
                ) : null}
            </div>
        </DialogFrame>
    );
};
SoundDialog.propTypes = {
    onCancel: PropTypes.func.isRequired,
    onPick: PropTypes.func.isRequired,
    sounds: PropTypes.arrayOf(PropTypes.object).isRequired
};
const ShortcutsDialog = ({list, onCancel}) => (
    <DialogFrame
        buttons={[{label: 'Close', primary: true, onClick: onCancel}]}
        size="wide"
        title="Keyboard shortcuts"
        onClose={onCancel}
    >
        <div className={styles$1.scroll}>
            <div className={styles$1.shortcuts}>
                {list.map(([k, d]) => (
                    <React.Fragment key={k}>
                        <kbd>{k}</kbd>
                        <span>{d}</span>
                    </React.Fragment>
                ))}
            </div>
        </div>
    </DialogFrame>
);
ShortcutsDialog.propTypes = {list: PropTypes.arrayOf(PropTypes.array).isRequired, onCancel: PropTypes.func.isRequired};
class AnimationDialogs extends React.Component {
    constructor (props) {
        super(props);
        this.state = {current: null};
        this.queue = [];
        this.handleDone = this.handleDone.bind(this);
        this.handleCancel = () => this.handleDone(null);
    }
    componentDidMount () {
        this.unregister = setAnimationDialogHost((kind, props, resolve) => {
            const request = {kind, props, resolve};
            if (kind === 'progress') props.handle.resolve = value => this.finish(request, value);
            this.queue.push(request);
            if (!this.state.current) this.next();
        });
    }
    componentWillUnmount () {
        if (this.unregister) this.unregister();
        if (this.state.current) this.state.current.resolve(null);
        this.queue.forEach(r => r.resolve(null));
        this.queue = [];
    }
    next () { this.setState({current: this.queue.shift() || null}); }
    finish (request, value) {
        request.resolve(typeof value === 'undefined' ? null : value);
        if (this.state.current === request) this.next();
        else this.queue = this.queue.filter(r => r !== request);
    }
    handleDone (value) {
        if (this.state.current) this.finish(this.state.current, value);
    }
    render () {
        const current = this.state.current;
        if (!current) return null;
        const {kind, props} = current;
        switch (kind) {
        case 'choose':
            return (<ChooseDialog {...props} onCancel={this.handleCancel} onDone={this.handleDone} />);
        case 'addPart':
            return (<AddPartDialog {...props} onDone={this.handleDone} />);
        case 'sound':
            return (<SoundDialog
                {...props}
                onCancel={this.handleCancel}
                onPick={handler(this, 'sound', e => {
                    this.handleDone(props.sounds[Number(e.currentTarget.getAttribute('data-index'))] || null);
                })}
            />);
        case 'settings':
            return (<SettingsDialog {...props} onDone={this.handleDone} />);
        case 'form':
            return (<FormDialog {...props} onDone={this.handleDone} />);
        case 'shortcuts':
            return (<ShortcutsDialog {...props} onCancel={this.handleCancel} />);
        case 'progress':
            return <ProgressDialog {...props} />;
        case 'expression':
            return (<ExpressionDialog {...props} onDone={this.handleDone} />);
        default:
            return null;
        }
    }
}
export {AddPartDialog, AnimationDialogs, AnimationEditor, ColorSwatch, DialogFrame, Dropdown, ExprBlocksEditor, ExprCodeEditor, ExprPlot, ExpressionDialog, FormDialog, Inspector, KIcon, PartsList, ProgressDialog, Row, ScrubField, Section, SettingsDialog, Switch, TextField, TileGrid, ToolButton, handler};
