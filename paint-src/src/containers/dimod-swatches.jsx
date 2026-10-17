import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, intlShape, injectIntl} from 'react-intl';
import {BarButton, BarGroup} from '../components/dimod-context-bar/dimod-context-bar.jsx';
import {styleToCss, styleKey, styleToSave, deletePalette, openPalette, savePaletteAs, getPaintingLayer} from '../dimod/store.js';
import addSwatchIcon from '../components/dimod-swatches/icons/add-swatch.svg';
import openPaletteIcon from '../components/dimod-swatches/icons/open-palette.svg';
import savePaletteIcon from '../components/dimod-swatches/icons/save-palette.svg';
import lockPaletteIcon from '../components/dimod-swatches/icons/lock-palette.svg';
import unlockPaletteIcon from '../components/dimod-swatches/icons/unlock-palette.svg';
import styles from '../components/dimod-swatches/dimod-swatches.css';
import {DimodDialog} from '../components/dimod-widgets.jsx';
import deleteIcon from '../components/dimod-swatches/icons/delete-palette.svg';
import dialogStyles from '../components/dimod-dialog/dimod-dialog.css';
import optionStyles from '../components/dimod-options/dimod-options.css';
import bindAll from 'lodash.bindall';
import {connect} from 'react-redux';
import {applyStyleToSelection, readStyle, commonBitmapColors} from '../dimod/items.js';
import {addSwatchColor, removeSwatchColor, setPaletteDialog, setSwatchLock, syncPalettes, syncSwatches, setBrushOption} from '../reducers/dimod.js';
import {changeFillColor, changeFillColor2, changeFillGradientType} from '../reducers/fill-style.js';
import {changeStrokeColor, changeStrokeGradientType} from '../reducers/stroke-style.js';
import {changeStrokeWidth} from '../reducers/stroke-width.js';
import {setSelectedItems} from '../reducers/selected-items.js';
import {getSelectedLeafItems, getSelectedRootItems} from '../helper/selection.js';
import Formats, {isBitmap} from '../lib/format.js';
import GradientTypes from '../lib/gradient-types.js';
import paper from '@turbowarp/paper';
import {MIXED} from '../helper/style-path.js';
const messages$2 = defineMessages({
    palette: {
        defaultMessage: 'Palette',
        description: 'Label for the saved style palette beside the canvas',
        id: 'paint.swatches.palette'
    },
    add: {
        defaultMessage: 'Save the current fill and outline',
        description: 'Tooltip for the button that adds the current style to the palette',
        id: 'paint.swatches.add'
    },
    remove: {
        defaultMessage: 'Right-click a swatch to remove it',
        description: 'Tooltip explaining how to remove a style from the palette',
        id: 'paint.swatches.remove'
    },
    lock: {
        defaultMessage: 'Snap colours to the palette',
        description: 'Tooltip for the toggle that restricts colours to the saved palette',
        id: 'paint.swatches.lock'
    },
    open: {
        defaultMessage: 'Open a palette',
        description: 'Tooltip for the button that opens the saved palette list',
        id: 'paint.swatches.open'
    },
    saveAs: {
        defaultMessage: 'Name this palette',
        description: 'Tooltip for the button that saves the current colours under a name',
        id: 'paint.swatches.saveAs'
    },
    locked: {
        defaultMessage: 'Snapping to palette',
        description: 'Shown while new colours are being snapped to the nearest saved swatch',
        id: 'paint.swatches.locked'
    },
    unsaved: {
        defaultMessage: 'Unsaved',
        description: 'Shown where a palette name would be when the colours are not from a saved palette',
        id: 'paint.swatches.unsaved'
    },
    collect: {
        defaultMessage: 'Collect every colour used in this costume',
        description: 'Tooltip for the button that adds the costume\'s colours to the palette',
        id: 'paint.swatches.collect'
    },
    empty: {
        defaultMessage: 'Save a fill, gradient or outline with +',
        description: 'Shown in place of the palette when nothing has been saved to it',
        id: 'paint.swatches.empty'
    }
});
const swatchShape = PropTypes.shape({
    fill: PropTypes.string,
    fill2: PropTypes.string,
    gradientType: PropTypes.string.isRequired,
    stroke: PropTypes.string,
    strokeWidth: PropTypes.number,
    line: PropTypes.object,
    profile: PropTypes.string
});
const describe = function (entry) {
    const parts = [];
    if (entry.fill && entry.fill2) {
        parts.push(`${entry.gradientType.toLowerCase()} ${entry.fill} → ${entry.fill2}`);
    } else if (entry.fill) { parts.push(entry.fill); }
    if (entry.stroke) parts.push(`outline ${entry.stroke} ${entry.strokeWidth}${entry.line ? ` ${entry.line.type.toLowerCase().replace(/_/g, ' ')}` : ''}${entry.profile ? `, ${entry.profile.toLowerCase().replace(/_/g, ' ')}` : ''}`);
    return parts.join(', ');
};
class Chip extends React.Component {
    constructor (props) {
        super(props);
        this.handleClick = this.handleClick.bind(this);
        this.handleContextMenu = this.handleContextMenu.bind(this);
    }
    handleClick () { this.props.onSelect(this.props.entry); }
    handleContextMenu (event) { event.preventDefault(); this.props.onRemove(this.props.entry); }
    render () {
        return (
            <div
                className={classNames(styles.chip, this.props.className, {[styles.chipActive]: this.props.active})}
                style={styleToCss(this.props.entry)}
                title={describe(this.props.entry)}
                onClick={this.handleClick}
                onContextMenu={this.handleContextMenu}
            />
        );
    }
}
Chip.propTypes = {
    active: PropTypes.bool,
    className: PropTypes.string,
    entry: swatchShape.isRequired,
    onRemove: PropTypes.func.isRequired,
    onSelect: PropTypes.func.isRequired
};
const FullPalette = props => (
    <div className={styles.palette}>
        <div className={styles.header}>
            <span className={styles.label}>{props.intl.formatMessage(messages$2.palette)}</span>
        </div>
        <div className={styles.paletteName} title={props.paletteName || props.intl.formatMessage(messages$2.unsaved)}>
            {props.paletteName || props.intl.formatMessage(messages$2.unsaved)}
        </div>
        {props.lock ? (
            <div className={styles.lockedNote}>
                {props.intl.formatMessage(messages$2.locked)}
            </div>
        ) : null}
        <div className={styles.buttons}>
            <button
                className={styles.headerButton}
                title={props.intl.formatMessage(messages$2.open)}
                onClick={props.onOpenDialog}
            >
                <img className={styles.headerIcon} draggable={false} src={openPaletteIcon} />
            </button>
            <button
                className={styles.headerButton}
                title={props.intl.formatMessage(messages$2.saveAs)}
                onClick={props.onSaveDialog}
            >
                <img className={styles.headerIcon} draggable={false} src={savePaletteIcon} />
            </button>
            <button
                className={classNames(styles.headerButton, {[styles.headerButtonActive]: props.lock})}
                title={props.intl.formatMessage(messages$2.lock)}
                onClick={props.onToggleLock}
            >
                <img className={styles.headerIcon} draggable={false} src={props.lock ? lockPaletteIcon : unlockPaletteIcon} />
            </button>
            <button
                className={styles.headerButton}
                disabled={!props.canAdd}
                title={props.intl.formatMessage(messages$2.add)}
                onClick={props.onAdd}
            >
                <img className={styles.headerIcon} draggable={false} src={addSwatchIcon} />
            </button>
        </div>
        {props.swatches.length === 0 ?
            null :
            <div className={styles.chips} title={props.intl.formatMessage(messages$2.remove)}>
                {props.swatches.map(entry => (
                    <Chip
                        key={styleKey(entry)}
                        active={styleKey(entry) === props.activeKey}
                        entry={entry}
                        onRemove={props.onRemove}
                        onSelect={props.onSelect}
                    />
                ))}
            </div>
        }
    </div>
);
const CompactPalette = props => (
    <div className={styles.bar}>
        {props.swatches.length === 0 ?
            null :
            <div className={styles.barChips} title={props.intl.formatMessage(messages$2.remove)}>
                {props.swatches.map(entry => (
                    <Chip
                        active={styleKey(entry) === props.activeKey}
                        className={styles.barChip}
                        entry={entry}
                        key={styleKey(entry)}
                        onRemove={props.onRemove}
                        onSelect={props.onSelect}
                    />
                ))}
            </div>
        }
        <BarGroup>
            <BarButton
                disabled={!props.canAdd}
                icon={addSwatchIcon}
                title={props.intl.formatMessage(messages$2.add)}
                onClick={props.onAdd}
            />
            <BarButton
                active={props.lock}
                icon={props.lock ? lockPaletteIcon : unlockPaletteIcon}
                title={props.intl.formatMessage(messages$2.lock)}
                onClick={props.onToggleLock}
            />
            <BarButton
                icon={openPaletteIcon}
                title={`${props.intl.formatMessage(messages$2.palette)}: ${
                    props.paletteName || props.intl.formatMessage(messages$2.unsaved)}`}
                onClick={props.onOpenDialog}
            />
        </BarGroup>
    </div>
);
FullPalette.propTypes = CompactPalette.propTypes = {
    onCollect: PropTypes.func,
    activeKey: PropTypes.string,
    canAdd: PropTypes.bool,
    intl: intlShape.isRequired,
    lock: PropTypes.bool,
    onAdd: PropTypes.func.isRequired,
    onOpenDialog: PropTypes.func.isRequired,
    onRemove: PropTypes.func.isRequired,
    onSaveDialog: PropTypes.func.isRequired,
    onSelect: PropTypes.func.isRequired,
    onToggleLock: PropTypes.func.isRequired,
    paletteName: PropTypes.string,
    swatches: PropTypes.arrayOf(swatchShape).isRequired
};
const DimodSwatchesComponent = props => {
    const Layout = props.compact ? CompactPalette : FullPalette;
    return <Layout {...props} />;
};
DimodSwatchesComponent.propTypes = {
    activeKey: PropTypes.string,
    canAdd: PropTypes.bool,
    compact: PropTypes.bool,
    intl: intlShape.isRequired,
    lock: PropTypes.bool,
    onAdd: PropTypes.func.isRequired,
    onOpenDialog: PropTypes.func.isRequired,
    onSaveDialog: PropTypes.func.isRequired,
    paletteName: PropTypes.string,
    onRemove: PropTypes.func.isRequired,
    onSelect: PropTypes.func.isRequired,
    onToggleLock: PropTypes.func.isRequired,
    swatches: PropTypes.arrayOf(swatchShape).isRequired
};
DimodSwatchesComponent.defaultProps = {canAdd: true, compact: false, lock: false, swatches: []};
const dimodSwatches = injectIntl(DimodSwatchesComponent);
const messages$1 = defineMessages({
    remove: {
        defaultMessage: 'Delete this palette',
        description: 'Tooltip for the button that deletes a saved palette',
        id: 'paint.palettes.remove'
    },
    swatchCount: {
        defaultMessage: '{count, plural, one {# colour} other {# colours}}',
        description: 'How many swatches a saved palette holds',
        id: 'paint.palettes.swatchCount'
    }
});
const paletteShape$1 = PropTypes.shape({
    entries: PropTypes.arrayOf(PropTypes.shape({gradientType: PropTypes.string.isRequired})),
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired
});
class PaletteRow extends React.Component {
    constructor (props) {
        super(props);
        this.handleClick = this.handleClick.bind(this);
        this.handleDelete = this.handleDelete.bind(this);
    }
    handleClick () { this.props.onOpen(this.props.palette.id); }
    handleDelete (event) { event.stopPropagation(); this.props.onDelete(this.props.palette.id); }
    render () {
        const {palette} = this.props;
        const entries = palette.entries || [];
        return (
            <div
                className={classNames(dialogStyles.row, {[dialogStyles.rowActive]: this.props.active})}
                onClick={this.handleClick}
            >
                <span className={styles.rowName}>{palette.name}</span>
                <span className={styles.rowChips}>
                    {entries.slice(0, 10).map(entry => (
                        <span key={styleKey(entry)} className={styles.rowChip} style={styleToCss(entry)} />
                    ))}
                </span>
                <span className={styles.rowCount}>
                    {this.props.intl.formatMessage(messages$1.swatchCount, {count: entries.length})}
                </span>
                <button
                    className={styles.rowDelete}
                    title={this.props.intl.formatMessage(messages$1.remove)}
                    onClick={this.handleDelete}
                >
                    <img className={styles.headerIcon} draggable={false} src={deleteIcon} />
                </button>
            </div>
        );
    }
}
PaletteRow.propTypes = {
    active: PropTypes.bool,
    intl: intlShape.isRequired,
    onDelete: PropTypes.func.isRequired,
    onOpen: PropTypes.func.isRequired,
    palette: paletteShape$1.isRequired
};
const messages = defineMessages({
    title: {defaultMessage: 'Palette', description: 'Title of the palette dialog', id: 'paint.palettes.title'},
    openTitle: {
        defaultMessage: 'Open a palette',
        description: 'Title of the dialog that lists saved palettes',
        id: 'paint.palettes.openTitle'
    },
    saveTitle: {
        defaultMessage: 'Name this palette',
        description: 'Title of the dialog that saves the current colours under a name',
        id: 'paint.palettes.saveTitle'
    },
    close: {
        defaultMessage: 'Close',
        description: 'Label for the button that closes a palette dialog',
        id: 'paint.palettes.close'
    },
    empty: {
        defaultMessage: 'No saved palettes yet. Name this one to keep it.',
        description: 'Shown when there are no saved palettes to open',
        id: 'paint.palettes.empty'
    },
    nameLabel: {defaultMessage: 'Palette name', description: 'Label for the palette name field', id: 'paint.palettes.nameLabel'},
    save: {defaultMessage: 'Save', description: 'Label for the button that saves the palette', id: 'paint.palettes.save'},
    overwrite: {
        defaultMessage: 'Replaces the palette already called that.',
        description: 'Warning shown when the typed palette name is already taken',
        id: 'paint.palettes.overwrite'
    },
    autosave: {
        defaultMessage: 'Changes to a palette are kept as you make them.',
        description: 'Note explaining that palettes do not need saving after an edit',
        id: 'paint.palettes.autosave'
    }
});
const paletteShape = PropTypes.shape({
    entries: PropTypes.arrayOf(PropTypes.shape({gradientType: PropTypes.string.isRequired})),
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired
});
class PaletteSaveField extends React.Component {
    constructor (props) {
        super(props);
        this.state = {name: props.paletteName || ''};
        this.handleChange = event => this.setState({name: event.target.value});
        this.handleSave = () => {
            const name = this.state.name.trim();
            if (name) this.props.onSave(name);
        };
        this.handleKeyDown = event => {
            event.stopPropagation();
            if (event.key === 'Enter') this.handleSave();
        };
    }
    render () {
        const f = this.props.intl.formatMessage;
        const name = this.state.name.trim().toLowerCase();
        const clash = name && this.props.palettes.some(palette =>
            palette.name.toLowerCase() === name && palette.id !== this.props.paletteId);
        return (
            <div>
                <div className={styles.saveLine}>
                    <input
                        className={dialogStyles.textInput}
                        placeholder={f(messages.nameLabel)}
                        value={this.state.name}
                        onChange={this.handleChange}
                        onKeyDown={this.handleKeyDown}
                    />
                    <button
                        className={dialogStyles.primary}
                        disabled={!name}
                        onClick={this.handleSave}
                    >{f(messages.save)}</button>
                </div>
                <p className={dialogStyles.none}>{f(clash ? messages.overwrite : messages.autosave)}</p>
            </div>
        );
    }
}
PaletteSaveField.propTypes = {
    intl: intlShape.isRequired,
    onSave: PropTypes.func.isRequired,
    paletteId: PropTypes.string,
    paletteName: PropTypes.string,
    palettes: PropTypes.arrayOf(paletteShape).isRequired
};
const PaletteOpenDialog = props => (
    <DimodDialog
        closeLabel={props.intl.formatMessage(messages.close)}
        title={props.intl.formatMessage(messages.title)}
        onClose={props.onClose}
    >
        {props.onSave ? (
            <PaletteSaveField
                intl={props.intl}
                paletteId={props.paletteId}
                paletteName={props.paletteName}
                palettes={props.palettes}
                onSave={props.onSave}
            />
        ) : null}
        {props.onToggleLock ? (
            <div className={classNames(optionStyles.setting, {[optionStyles.active]: props.lock})}>
                <label className={optionStyles.label}>
                    <input
                        checked={Boolean(props.lock)}
                        className={optionStyles.checkbox}
                        type="checkbox"
                        onChange={props.onToggleLock}
                    />
                    {props.intl.formatMessage(messages$2.lock)}
                </label>
            </div>
        ) : null}
        {props.onCollect ? (
            <button
                className={dialogStyles.secondary}
                onClick={props.onCollect}
            >{props.intl.formatMessage(messages$2.collect)}</button>
        ) : null}
        {props.palettes.length === 0 ?
            <p className={dialogStyles.none}>{props.intl.formatMessage(messages.empty)}</p> :
            <div className={dialogStyles.rows}>
                {props.palettes.map(palette => (
                    <PaletteRow
                        key={palette.id}
                        active={palette.id === props.paletteId}
                        intl={props.intl}
                        palette={palette}
                        onDelete={props.onDelete}
                        onOpen={props.onOpen}
                    />
                ))}
            </div>
        }
    </DimodDialog>
);
PaletteOpenDialog.propTypes = {
    intl: intlShape.isRequired,
    lock: PropTypes.bool,
    onCollect: PropTypes.func,
    onSave: PropTypes.func,
    onToggleLock: PropTypes.func,
    paletteName: PropTypes.string,
    onClose: PropTypes.func.isRequired,
    onDelete: PropTypes.func.isRequired,
    onOpen: PropTypes.func.isRequired,
    paletteId: PropTypes.string,
    palettes: PropTypes.arrayOf(paletteShape).isRequired
};
class PaletteSaveDialog extends React.Component {
    constructor (props) {
        super(props);
        this.state = {name: props.paletteName || ''};
        this.handleChange = this.handleChange.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleSave = this.handleSave.bind(this);
    }
    handleChange (event) { this.setState({name: event.target.value}); }
    handleKeyDown (event) {
        event.stopPropagation();
        if (event.key === 'Enter') this.handleSave();
    }
    handleSave () {
        const name = this.state.name.trim();
        if (name) this.props.onSave(name);
    }
    render () {
        const name = this.state.name.trim().toLowerCase();
        const clash = name && this.props.palettes.some(palette =>
            palette.name.toLowerCase() === name && palette.id !== this.props.paletteId);
        return (
            <DimodDialog
                closeLabel={this.props.intl.formatMessage(messages.close)}
                footer={
                    <button className={dialogStyles.primary} disabled={!name} onClick={this.handleSave}>
                        {this.props.intl.formatMessage(messages.save)}
                    </button>
                }
                title={this.props.intl.formatMessage(messages.saveTitle)}
                onClose={this.props.onClose}
            >
                <label className={styles.fieldLabel}>
                    {this.props.intl.formatMessage(messages.nameLabel)}
                </label>
                <input
                    autoFocus
                    className={dialogStyles.textInput}
                    value={this.state.name}
                    onChange={this.handleChange}
                    onKeyDown={this.handleKeyDown}
                />
                <p className={dialogStyles.none}>
                    {this.props.intl.formatMessage(clash ? messages.overwrite : messages.autosave)}
                </p>
            </DimodDialog>
        );
    }
}
PaletteSaveDialog.propTypes = {
    intl: intlShape.isRequired,
    onClose: PropTypes.func.isRequired,
    onSave: PropTypes.func.isRequired,
    paletteId: PropTypes.string,
    paletteName: PropTypes.string,
    palettes: PropTypes.arrayOf(paletteShape).isRequired
};
const WrappedOpen = injectIntl(PaletteOpenDialog);
const WrappedSave = injectIntl(PaletteSaveDialog);
export {Chip, dimodSwatches as DimodSwatches, WrappedOpen as PaletteOpenDialog, PaletteRow, WrappedSave as PaletteSaveDialog, describe, paletteShape as paletteDialogsPaletteShape, paletteShape$1 as paletteRowPaletteShape};
class DimodSwatches extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleAdd',
            'handleCollect',
            'handleRemove',
            'handleSelect',
            'handleToggleLock',
            'handleOpenDialog',
            'handleSaveDialog',
            'handleCloseDialog',
            'handleOpenPalette',
            'handleSavePalette',
            'handleDeletePalette'
        ]);
    }
    currentStyle () {
        const mixed = value => value === MIXED;
        const selection = getSelectedRootItems();
        const selectionStyle = selection.length === 1 ? readStyle(selection[0]) : null;
        if (!selectionStyle &&
            (mixed(this.props.fillColor) || mixed(this.props.fillColor2) || mixed(this.props.strokeColor))) { return null; }
        return styleToSave(selectionStyle, this.props.colorState);
    }
    handleAdd () {
        const style = this.currentStyle();
        if (style) this.props.onAddSwatch(style);
    }
    handleCollect () {
        const existing = new Set(this.props.swatches.map(styleKey));
        const found = [];
        const add = style => {
            if (!style) return;
            const key = styleKey(style);
            if (existing.has(key)) return;
            existing.add(key);
            found.push(style);
        };
        if (isBitmap(this.props.format)) {
            commonBitmapColors(16).forEach(color => add(styleToSave({
                fillColor: color,
                gradientType: GradientTypes.SOLID
            }, null)));
        } else {
            const layer = getPaintingLayer();
            const leaves = layer ? layer.getItems({
                recursive: true,
                match: item => (item instanceof paper.Path || item instanceof paper.CompoundPath ||
                    item instanceof paper.PointText) && !item.guide &&
                    !(item.parent instanceof paper.CompoundPath) && !(item.data && item.data.isHelperItem)
            }) : [];
            leaves.forEach(item => add(styleToSave(readStyle(item), null)));
        }
        found.slice(0, Math.max(0, 64 - this.props.swatches.length)).forEach(style => this.props.onAddSwatch(style));
    }
    handleRemove (entry) { this.props.onRemoveSwatch(entry); }
    handleSelect (entry) {
        this.props.onApplyStyle(entry);
        if (isBitmap(this.props.format)) return;
        const applied = applyStyleToSelection({
            fillColor: entry.fill,
            fillColor2: entry.fill2,
            gradientType: entry.gradientType,
            strokeColor: entry.stroke,
            strokeWidth: entry.strokeWidth,
            line: entry.line || null,
            profile: entry.profile || null
        }, this.props.textEditTargetId);
        if (applied) { this.props.setSelectedItems(this.props.format); this.props.onUpdateImage(); }
    }
    handleToggleLock () { this.props.onSetSwatchLock(!this.props.lock); }
    handleOpenDialog () { this.props.onSetDialog('open'); }
    handleSaveDialog () { this.props.onSetDialog('save'); }
    handleCloseDialog () { this.props.onSetDialog(null); }
    handleOpenPalette (id) {
        if (openPalette(id)) this.props.onPaletteChanged();
        this.props.onSetDialog(null);
    }
    handleSavePalette (name) {
        if (savePaletteAs(name)) this.props.onPaletteChanged();
        this.props.onSetDialog(null);
    }
    handleDeletePalette (id) {
        if (deletePalette(id)) this.props.onPaletteChanged();
    }
    render () {
        const current = this.currentStyle();
        return (
            <React.Fragment>
                {this.props.dialog === 'open' ? (
                    <WrappedOpen
                        lock={this.props.lock}
                        paletteId={this.props.paletteId}
                        paletteName={this.props.paletteName}
                        palettes={this.props.palettes}
                        onClose={this.handleCloseDialog}
                        onDelete={this.handleDeletePalette}
                        onCollect={this.handleCollect}
                        onOpen={this.handleOpenPalette}
                        onSave={this.handleSavePalette}
                        onToggleLock={this.handleToggleLock}
                    />
                ) : null}
                {this.props.dialog === 'save' ? (
                    <WrappedSave
                        paletteId={this.props.paletteId}
                        paletteName={this.props.paletteName}
                        palettes={this.props.palettes}
                        onClose={this.handleCloseDialog}
                        onSave={this.handleSavePalette}
                    />
                ) : null}
                <dimodSwatches
                    activeKey={current ? styleKey(current) : null}
                    canAdd={Boolean(current)}
                    onCollect={this.handleCollect}
                    compact={this.props.compact}
                    lock={this.props.lock}
                    paletteName={this.props.paletteName}
                    swatches={this.props.swatches}
                    onAdd={this.handleAdd}
                    onOpenDialog={this.handleOpenDialog}
                    onRemove={this.handleRemove}
                    onSaveDialog={this.handleSaveDialog}
                    onSelect={this.handleSelect}
                    onToggleLock={this.handleToggleLock}
                />
            </React.Fragment>
        );
    }
}
DimodSwatches.propTypes = {
    compact: PropTypes.bool,
    colorState: PropTypes.shape({strokeWidth: PropTypes.number, line: PropTypes.object, profile: PropTypes.string}).isRequired,
    dialog: PropTypes.oneOf(['open', 'save']),
    fillColor: PropTypes.string,
    fillColor2: PropTypes.string,
    format: PropTypes.oneOf(Object.keys(Formats)),
    lock: PropTypes.bool,
    onAddSwatch: PropTypes.func.isRequired,
    onApplyStyle: PropTypes.func.isRequired,
    onRemoveSwatch: PropTypes.func.isRequired,
    onPaletteChanged: PropTypes.func.isRequired,
    onSetDialog: PropTypes.func.isRequired,
    onSetSwatchLock: PropTypes.func.isRequired,
    paletteId: PropTypes.string,
    paletteName: PropTypes.string,
    palettes: PropTypes.arrayOf(PropTypes.shape({id: PropTypes.string.isRequired, name: PropTypes.string.isRequired})).isRequired,
    onUpdateImage: PropTypes.func.isRequired,
    setSelectedItems: PropTypes.func.isRequired,
    strokeColor: PropTypes.string,
    swatches: PropTypes.arrayOf(PropTypes.shape({gradientType: PropTypes.string.isRequired})).isRequired,
    textEditTargetId: PropTypes.number
};
const mapStateToProps = state => ({
    colorState: state.scratchPaint.color,
    fillColor: state.scratchPaint.color.fillColor.primary,
    fillColor2: state.scratchPaint.color.fillColor.secondary,
    format: state.scratchPaint.format,
    dialog: state.scratchPaint.dimodSwatches.dialog,
    lock: state.scratchPaint.dimodSwatches.lock,
    paletteId: state.scratchPaint.dimodSwatches.paletteId,
    paletteName: state.scratchPaint.dimodSwatches.paletteName,
    palettes: state.scratchPaint.dimodSwatches.palettes,
    strokeColor: state.scratchPaint.color.strokeColor.primary,
    swatches: state.scratchPaint.dimodSwatches.entries,
    textEditTargetId: state.scratchPaint.textEditTarget
});
const mapDispatchToProps = dispatch => ({
    onAddSwatch: style => { dispatch(addSwatchColor(style)); },
    onRemoveSwatch: style => { dispatch(removeSwatchColor(style)); },
    onSetSwatchLock: lock => { dispatch(setSwatchLock(lock)); },
    onSetDialog: dialog => { dispatch(setPaletteDialog(dialog)); },
    onPaletteChanged: () => { dispatch(syncSwatches()); dispatch(syncPalettes()); },
    onApplyStyle: entry => {
        dispatch(changeFillGradientType(entry.gradientType));
        dispatch(changeFillColor(entry.fill));
        if (entry.gradientType !== GradientTypes.SOLID) { dispatch(changeFillColor2(entry.fill2)); }
        dispatch(changeStrokeGradientType(GradientTypes.SOLID));
        dispatch(changeStrokeColor(entry.stroke));
        dispatch(changeStrokeWidth(entry.strokeWidth));
        dispatch(setBrushOption('lineStyle', entry.line || null));
        dispatch(setBrushOption('lineProfile', entry.profile || 'UNIFORM'));
    },
    setSelectedItems: format => { dispatch(setSelectedItems(getSelectedLeafItems(), isBitmap(format))); }
});
export default connect(mapStateToProps, mapDispatchToProps)(DimodSwatches);
