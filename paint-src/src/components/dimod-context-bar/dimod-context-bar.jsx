import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import ReactDOM from 'react-dom';
import styles from './dimod-context-bar.css';
import {defineMessages} from 'react-intl';
import Dropdown from '../dropdown/dropdown.jsx';
import FontDropdown from '../../containers/font-dropdown.jsx';
import Input from '../forms/input.jsx';
import InputGroup from '../input-group/input-group.jsx';
import LabeledIconButton from '../labeled-icon-button/labeled-icon-button.jsx';
import LiveInputHOC from '../forms/live-input-hoc.jsx';
import Modes from '../../lib/modes';
import toolMessages from '../../lib/messages.js';
import {AlignReferences, SelectStyles, WandMatches, applyBitmapEffect} from '../../dimod/items';
import {isBitmap} from '../../lib/format';
import {selectStyleMessage, handMessages} from '../dimod-widgets.jsx';
import {mirrorMessages, gradientMessages, polygonMessages} from '../../containers/dimod-modes.jsx';
import {
    loadSettings,
    saveSettings,
    kaleidoscope,
    setHistoryLabel,
    labelled,
    getCustomBrushes,
    preloadCustomBrushes,
    subscribeCustomBrushes,
    addCustomBrushFromFile,
    presetFor,
    removeCustomBrush,
    customBrushFor,
    updateCustomBrush,
    LineProfiles,
    LINE_STYLES,
    lineDash,
    lineStyleOf,
    getLineTextures,
    getTextureBrushes,
    tipIcon,
    brushSource,
    profileWidth
} from '../../dimod/core';
import linearIcon from './icons/gradient-linear.svg';
import radialIcon from './icons/gradient-radial.svg';
import smoothIcon from './icons/gradient-smooth.svg';
import ditherIcon from './icons/gradient-dither.svg';
import outlineFxIcon from './icons/fx-outline.svg';
import shadowFxIcon from './icons/fx-shadow.svg';
import {CENTER} from '../../helper/view';
import mirrorIcon from '../dimod-mirror-mode/mirror.svg';
import {MAX_STROKE_WIDTH} from '../../reducers/stroke-width';
import {shouldShowGroup, shouldShowUngroup} from '../../helper/group';
import {shouldShowBringForward, shouldShowSendBackward} from '../../helper/order';
import {generateShapeSVG, selectableShapes, categorizeShapes, categories} from '../../helper/selectable-shapes.js';
import copyIcon from '../mode-tools/icons/copy.svg';
import cutIcon from '../mode-tools/icons/cut.svg';
import pasteIcon from '../mode-tools/icons/paste.svg';
import deleteIcon from '../mode-tools/icons/delete.svg';
import roundLineIcon from '../mode-tools/icons/round-line.svg';
import squareLineIcon from '../mode-tools/icons/square-line.svg';
import miterLineJoinIcon from '../mode-tools/icons/miter-line-join.svg';
import roundLineJoinIcon from '../mode-tools/icons/round-line-join.svg';
import bevelLineJoinIcon from '../mode-tools/icons/bevel-line-join.svg';
import mergeIcon from '../mode-tools/icons/merge.svg';
import maskIcon from '../mode-tools/icons/mask.svg';
import subtractIcon from '../mode-tools/icons/subtract.svg';
import filterIcon from '../mode-tools/icons/filter.svg';
import alignMenuIcon from '../mode-tools/icons/align.svg';
import textAlignLeftIcon from '../mode-tools/icons/alignLeft.svg';
import textAlignRightIcon from '../mode-tools/icons/alignRight.svg';
import textAlignCenterIcon from '../mode-tools/icons/alignCenter.svg';
import curvedPointIcon from '../mode-tools/icons/curved-point.svg';
import straightPointIcon from '../mode-tools/icons/straight-point.svg';
import flipHorizontalIcon from '../mode-tools/icons/flip-horizontal.svg';
import flipVerticalIcon from '../mode-tools/icons/flip-vertical.svg';
import centerSelectionIcon from '../mode-tools/icons/centerSelection.svg';
import alignLeftEdgeIcon from '../mode-tools/icons/align-left.svg';
import alignCenterHIcon from '../mode-tools/icons/align-center-h.svg';
import alignRightEdgeIcon from '../mode-tools/icons/align-right.svg';
import alignTopIcon from '../mode-tools/icons/align-top.svg';
import alignCenterVIcon from '../mode-tools/icons/align-center-v.svg';
import alignBottomIcon from '../mode-tools/icons/align-bottom.svg';
import distributeHIcon from '../mode-tools/icons/distribute-h.svg';
import distributeVIcon from '../mode-tools/icons/distribute-v.svg';
import groupIcon from '../fixed-tools/icons/group.svg';
import ungroupIcon from '../fixed-tools/icons/ungroup.svg';
import sendBackIcon from '../fixed-tools/icons/send-back.svg';
import sendBackwardIcon from '../fixed-tools/icons/send-backward.svg';
import sendForwardIcon from '../fixed-tools/icons/send-forward.svg';
import sendFrontIcon from '../fixed-tools/icons/send-front.svg';
import bitOvalIcon from '../bit-oval-mode/oval.svg';
import bitRectIcon from '../bit-rect-mode/rectangle.svg';
import bitOvalOutlinedIcon from '../bit-oval-mode/oval-outlined.svg';
import bitRectOutlinedIcon from '../bit-rect-mode/rectangle-outlined.svg';
import circleBrushIcon from './icons/brush-circle.svg';
import matchFillIcon from './icons/match-fill.svg';
import calligraphyIcon from './icons/brush-calligraphy.svg';
import markerIcon from './icons/brush-marker.svg';
import sprayIcon from './icons/brush-spray.svg';
import pixelIcon from './icons/brush-pixel.svg';
import pressureIcon from './icons/pressure.svg';
import matchOutlineIcon from './icons/match-outline.svg';
import matchBothIcon from './icons/match-both.svg';
import matchNearIcon from './icons/match-near.svg';
import squareBrushIcon from './icons/brush-square.svg';
class BarBubble extends React.Component {
    constructor (props) {
        super(props);
        this.state = {open: false, placed: false, left: 0, top: 0, arrow: 0};
        this.trigger = null;
        this.bubble = null;
        this.setTrigger = el => { this.trigger = el; };
        this.setBubble = el => { this.bubble = el; };
        this.handleToggle = this.handleToggle.bind(this);
        this.handleClose = this.handleClose.bind(this);
        this.handleDocumentDown = this.handleDocumentDown.bind(this);
        this.handleKey = this.handleKey.bind(this);
    }
    componentDidUpdate (prevProps, prevState) {
        if (this.state.open && !prevState.open) this.place();
    }
    componentWillUnmount () { this.unlisten(); }
    place () {
        if (!this.trigger || !this.bubble) return;
        const button = this.trigger.getBoundingClientRect();
        const width = this.bubble.offsetWidth;
        const center = button.left + (button.width / 2);
        const left = Math.max(6, Math.min(center - (width / 2), window.innerWidth - width - 6));
        this.setState({placed: true, left, top: button.bottom + 9, arrow: center - left});
    }
    unlisten () {
        document.removeEventListener('mousedown', this.handleDocumentDown, true);
        document.removeEventListener('keydown', this.handleKey, true);
    }
    handleToggle () {
        if (this.state.open) { this.handleClose(); return; }
        this.setState({open: true, placed: false});
        document.addEventListener('mousedown', this.handleDocumentDown, true);
        document.addEventListener('keydown', this.handleKey, true);
    }
    handleClose () { this.unlisten(); this.setState({open: false}); }
    handleDocumentDown (event) {
        if (this.bubble && this.bubble.contains(event.target)) return;
        if (this.trigger && this.trigger.contains(event.target)) return;
        this.handleClose();
    }
    handleKey (event) {
        if (event.key === 'Escape') { event.stopPropagation(); this.handleClose(); }
    }
    render () {
        const host = this.state.open && this.trigger &&
            (this.trigger.closest('[data-paint-theme]') || document.body);
        return (
            <div className={styles.bubbleAnchor}>
                <button
                    className={classNames(styles.button, styles.bubbleTrigger, {
                        [styles.buttonActive]: this.props.active,
                        [styles.bubbleTriggerOpen]: this.state.open
                    })}
                    ref={this.setTrigger}
                    title={this.props.title}
                    onClick={this.handleToggle}
                >
                    <img
                        alt={this.props.title}
                        className={classNames(styles.icon, this.props.iconClassName)}
                        draggable={false}
                        src={this.props.icon}
                    />
                </button>
                {host ? ReactDOM.createPortal((
                    <div
                        className={classNames(styles.bubble, this.props.className)}
                        ref={this.setBubble}
                        style={{
                            'left': this.state.left,
                            'top': this.state.top,
                            'visibility': this.state.placed ? 'visible' : 'hidden',
                            '--arrow-x': `${this.state.arrow}px`
                        }}
                    >
                        {typeof this.props.children === 'function' ?
                            this.props.children(this.handleClose) :
                            this.props.children}
                    </div>
                ), host) : null}
            </div>
        );
    }
}
BarBubble.propTypes = {
    active: PropTypes.bool,
    children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]),
    className: PropTypes.string,
    icon: PropTypes.string.isRequired,
    iconClassName: PropTypes.string,
    title: PropTypes.string.isRequired
};
const BubbleTile = props => (
    <button
        className={classNames(styles.bubbleTile, {[styles.bubbleTileActive]: props.active})}
        disabled={props.disabled}
        title={props.title}
        onClick={props.onClick}
    >
        <img alt={props.title} className={classNames(styles.icon, props.iconClassName)} draggable={false} src={props.icon} />
        {props.children}
    </button>
);
BubbleTile.propTypes = {
    active: PropTypes.bool,
    children: PropTypes.node,
    disabled: PropTypes.bool,
    icon: PropTypes.string.isRequired,
    iconClassName: PropTypes.string,
    onClick: PropTypes.func,
    title: PropTypes.string.isRequired
};
const LiveInput = LiveInputHOC(Input);
const messages = defineMessages({
    size: {defaultMessage: 'Size', description: 'Label for the brush size input', id: 'paint.modeTools.brushSize'},
    smoothing: {
        defaultMessage: 'Smoothing',
        description: 'Label for the brush smoothing input, higher numbers control how much the drawn line will be ' +
            'corrected',
        id: 'paint.modeTools.brushSimplify'
    },
    thickness: {
        defaultMessage: 'Thickness',
        description: 'Label for the number input to choose the line thickness',
        id: 'paint.modeTools.thickness'
    },
    brushRound: {defaultMessage: 'Round', description: 'Brush preset', id: 'paint.contextBar.brushRound'},
    brushSquareName: {defaultMessage: 'Square', description: 'Brush preset', id: 'paint.contextBar.brushSquare'},
    brushCalligraphy: {
        defaultMessage: 'Calligraphy... a flat nib at 45°',
        description: 'Brush preset',
        id: 'paint.contextBar.brushCalligraphy'
    },
    brushMarker: {
        defaultMessage: 'Marker... tapers at both ends',
        description: 'Brush preset',
        id: 'paint.contextBar.brushMarker'
    },
    density: {defaultMessage: 'Density', description: 'How many spray dots, 1 to 100', id: 'paint.contextBar.density'},
    brushMenu: {defaultMessage: 'Brush', description: 'Button that opens the brush picker', id: 'paint.contextBar.dimodBrushMenu'},
    addBrush: {
        defaultMessage: 'Add a brush from an image',
        description: 'Button to upload an image to use as a brush',
        id: 'paint.contextBar.dimodAddBrush'
    },
    removeBrush: {defaultMessage: 'Remove this brush', description: 'Deletes a custom brush', id: 'paint.contextBar.dimodRemoveBrush'},
    lineBrushReroll: {defaultMessage: 'Reroll', description: 'Re-randomize the texture of a brush line', id: 'paint.contextBar.dimodLineBrushReroll'},
    brushName: {defaultMessage: 'Name', description: 'Name of a custom brush', id: 'paint.contextBar.dimodBrushName'},
    brushSpacing: {
        defaultMessage: 'Spacing',
        description: 'Gap between stamps of a custom brush, percent of its size',
        id: 'paint.contextBar.dimodBrushSpacing'
    },
    brushScatter: {
        defaultMessage: 'Scatter',
        description: 'How far stamps of a custom brush stray from the line, percent of its size',
        id: 'paint.contextBar.dimodBrushScatter'
    },
    brushUploadHint: {
        defaultMessage: 'Any image works: its solid (or dark) parts become the brush tip.',
        description: 'Hint under the custom brush upload button',
        id: 'paint.contextBar.dimodBrushUploadHint'
    },
    outlineProfile: {
        defaultMessage: 'Outline shape',
        description: 'Button that opens the tapered outline choices',
        id: 'paint.contextBar.dimodOutlineProfile'
    },
    outlineProfileSelect: {
        defaultMessage: 'Changes the selected outlines',
        description: 'Hint in the outline shape menu in the select tool',
        id: 'paint.contextBar.dimodOutlineProfileSelect'
    },
    lineStyle: {defaultMessage: 'Line style', description: 'Button that opens the dashed/dotted line choices', id: 'paint.contextBar.dimodLineStyle'},
    lineSOLID: {defaultMessage: 'Solid', description: 'Line style', id: 'paint.contextBar.dimodLineSolid'},
    lineDASHED: {defaultMessage: 'Dashed', description: 'Line style', id: 'paint.contextBar.dimodLineDashed'},
    lineLONG_DASH: {defaultMessage: 'Long dashes', description: 'Line style', id: 'paint.contextBar.dimodLineLongDash'},
    lineDOTTED: {defaultMessage: 'Dotted', description: 'Line style', id: 'paint.contextBar.dimodLineDotted'},
    lineDASH_DOT: {defaultMessage: 'Dash dot', description: 'Line style', id: 'paint.contextBar.dimodLineDashDot'},
    lineDASH_DOT_DOT: {defaultMessage: 'Dash dot dot', description: 'Line style', id: 'paint.contextBar.dimodLineDashDotDot'},
    lineDash: {defaultMessage: 'Dash', description: 'Dash length, in line widths', id: 'paint.contextBar.dimodLineDashLen'},
    lineGap: {defaultMessage: 'Gap', description: 'Gap length, in line widths', id: 'paint.contextBar.dimodLineGap'},
    lineOffset: {defaultMessage: 'Offset', description: 'Dash offset, in line widths', id: 'paint.contextBar.dimodLineOffset'},
    lineCap: {defaultMessage: 'Ends', description: 'Line cap choice', id: 'paint.contextBar.dimodLineCap'},
    lineCapbutt: {defaultMessage: 'Flat', description: 'Line cap', id: 'paint.contextBar.dimodLineCapButt'},
    lineCapround: {defaultMessage: 'Round', description: 'Line cap', id: 'paint.contextBar.dimodLineCapRound'},
    lineCapsquare: {defaultMessage: 'Square', description: 'Line cap', id: 'paint.contextBar.dimodLineCapSquare'},
    lineStyleSelect: {
        defaultMessage: 'Changes the selected outlines. Sizes are in line widths.',
        description: 'Hint in the line style menu in the select tool',
        id: 'paint.contextBar.dimodLineStyleSelect'
    },
    profileUniform: {defaultMessage: 'Even', description: 'Outline profile', id: 'paint.contextBar.dimodProfileUniform'},
    profileTaperBoth: {defaultMessage: 'Taper both ends', description: 'Outline profile', id: 'paint.contextBar.dimodProfileBoth'},
    profileTaperStart: {defaultMessage: 'Taper the start', description: 'Outline profile', id: 'paint.contextBar.dimodProfileStart'},
    profileTaperEnd: {defaultMessage: 'Taper the end', description: 'Outline profile', id: 'paint.contextBar.dimodProfileEnd'},
    profileSwell: {defaultMessage: 'Thick in the middle', description: 'Outline profile', id: 'paint.contextBar.dimodProfileSwell'},
    profilePinch: {defaultMessage: 'Thin in the middle', description: 'Outline profile', id: 'paint.contextBar.dimodProfilePinch'},
    brushSpray: {defaultMessage: 'Spray', description: 'Brush preset', id: 'paint.contextBar.brushSpray'},
    brushPixel: {
        defaultMessage: 'Pixel pencil... 1px, no doubled corners',
        description: 'Bitmap brush preset',
        id: 'paint.contextBar.brushPixel'
    },
    pressure: {
        defaultMessage: 'Pressure... a pen draws thinner when pressed lightly; with a mouse, fast strokes go thin',
        description: 'Toggle for pressure-sensitive brush width',
        id: 'paint.contextBar.pressure'
    },
    taper: {defaultMessage: 'Taper', description: 'How much the stroke thins at its ends, 0 to 100', id: 'paint.contextBar.taper'},
    brushCircle: {
        defaultMessage: 'Circle Brush',
        description: 'Label for the circle brush shape',
        id: 'paint.modeTools.circleSquare'
    },
    brushSquare: {
        defaultMessage: 'Square Brush',
        description: 'Label for the square brush shape',
        id: 'paint.modeTools.brushSquare'
    },
    corners: {
        defaultMessage: 'Corners',
        description: 'Short label for the rounded corner size input in the tool options bar',
        id: 'paint.contextBar.corners'
    },
    sides: {
        defaultMessage: 'Sides',
        description: 'Short label for the polygon side count input in the tool options bar',
        id: 'paint.contextBar.sides'
    },
    spikes: {
        defaultMessage: 'Spikes',
        description: 'Short label for the star spoke ratio input in the tool options bar',
        id: 'paint.contextBar.spikes'
    },
    shape: {
        defaultMessage: 'Shape',
        description: 'Label for the menu that picks which shape the Shapes tool draws',
        id: 'paint.contextBar.shape'
    },
    copy: {defaultMessage: 'Copy', description: 'Label for the copy button', id: 'paint.modeTools.copy'},
    cut: {defaultMessage: 'Cut', description: 'Label for the cut button', id: 'paint.modeTools.cut'},
    paste: {defaultMessage: 'Paste', description: 'Label for the paste button', id: 'paint.modeTools.paste'},
    delete: {defaultMessage: 'Delete', description: 'Label for the delete button', id: 'paint.modeTools.delete'},
    curved: {
        defaultMessage: 'Curved',
        description: 'Label for the button that converts selected points to curves',
        id: 'paint.modeTools.curved'
    },
    pointed: {
        defaultMessage: 'Pointed',
        description: 'Label for the button that converts selected points to sharp points',
        id: 'paint.modeTools.pointed'
    },
    group: {defaultMessage: 'Group', description: 'Label for the button to group shapes', id: 'paint.paintEditor.group'},
    ungroup: {defaultMessage: 'Ungroup', description: 'Label for the button to ungroup shapes', id: 'paint.paintEditor.ungroup'},
    forward: {
        defaultMessage: 'Forward',
        description: 'Label for the `Send forward on canvas` button',
        id: 'paint.paintEditor.forward'
    },
    backward: {
        defaultMessage: 'Backward',
        description: 'Label for the `Send backward on canvas` button',
        id: 'paint.paintEditor.backward'
    },
    front: {
        defaultMessage: 'Front',
        description: 'Label for the `Send to front of canvas` button',
        id: 'paint.paintEditor.front'
    },
    back: {defaultMessage: 'Back', description: 'Label for the `Send to back of canvas` button', id: 'paint.paintEditor.back'},
    lassoShapeHint: {
        defaultMessage: 'Drag round an outline and let go to fill it in. Esc cancels.',
        description: 'Hint shown while the Lasso Shape tool is chosen',
        id: 'paint.contextBar.lassoShapeHint'
    },
    rotateStep: {
        defaultMessage: 'Step for the rotate arrows and Shift, in degrees',
        description: 'Tooltip on the number box that sets the rotate step',
        id: 'paint.contextBar.rotateStep'
    },
    rotateDial: {
        defaultMessage: 'Rotate... drag the dial, scroll over it, or Alt + scroll on the canvas (Shift: steps)',
        description: 'Tooltip on the dial that rotates the selection',
        id: 'paint.contextBar.rotateDial'
    },
    flipHorizontal: {
        defaultMessage: 'Flip Horizontal',
        description: 'Label for the button to flip the image horizontally',
        id: 'paint.modeTools.flipHorizontal'
    },
    flipVertical: {
        defaultMessage: 'Flip Vertical',
        description: 'Label for the button to flip the image vertically',
        id: 'paint.modeTools.flipVertical'
    },
    center: {
        defaultMessage: 'Center',
        description: 'Label for the button that moves the selected objects to the center of the canvas',
        id: 'paint.modeTools.movementCenter'
    },
    align: {
        defaultMessage: 'Align',
        description: 'Label for the menu of alignment and distribution tools',
        id: 'paint.modeTools.align'
    },
    alignToSelection: {
        defaultMessage: 'Selection',
        description: 'Label for aligning relative to the bounds of the selection',
        id: 'paint.modeTools.alignToSelection'
    },
    alignToCanvas: {
        defaultMessage: 'Canvas',
        description: 'Label for aligning relative to the whole canvas',
        id: 'paint.modeTools.alignToCanvas'
    },
    alignToRotationCenter: {
        defaultMessage: 'Center',
        description: 'Label for aligning relative to the rotation center',
        id: 'paint.modeTools.alignToRotationCenter'
    },
    alignLeftEdges: {
        defaultMessage: 'Left',
        description: 'Label for the button that aligns the left edges of the selection',
        id: 'paint.modeTools.alignLeftEdges'
    },
    alignHorizontalCenters: {
        defaultMessage: 'Center',
        description: 'Label for the button that aligns the selection horizontally about its center',
        id: 'paint.modeTools.alignHorizontalCenters'
    },
    alignRightEdges: {
        defaultMessage: 'Right',
        description: 'Label for the button that aligns the right edges of the selection',
        id: 'paint.modeTools.alignRightEdges'
    },
    alignTopEdges: {
        defaultMessage: 'Top',
        description: 'Label for the button that aligns the top edges of the selection',
        id: 'paint.modeTools.alignTopEdges'
    },
    alignVerticalCenters: {
        defaultMessage: 'Middle',
        description: 'Label for the button that aligns the selection vertically about its center',
        id: 'paint.modeTools.alignVerticalCenters'
    },
    alignBottomEdges: {
        defaultMessage: 'Bottom',
        description: 'Label for the button that aligns the bottom edges of the selection',
        id: 'paint.modeTools.alignBottomEdges'
    },
    distributeHorizontally: {
        defaultMessage: 'Spread Across',
        description: 'Label for the button that spaces the selection evenly from left to right',
        id: 'paint.modeTools.distributeHorizontally'
    },
    distributeVertically: {
        defaultMessage: 'Spread Down',
        description: 'Label for the button that spaces the selection evenly from top to bottom',
        id: 'paint.modeTools.distributeVertically'
    },
    filled: {
        defaultMessage: 'Filled',
        description: 'Label for the button that sets the bitmap rectangle/oval mode to draw outlines',
        id: 'paint.modeTools.filled'
    },
    outlined: {
        defaultMessage: 'Outlined',
        description: 'Label for the button that sets the bitmap rectangle/oval mode to draw filled-in shapes',
        id: 'paint.modeTools.outlined'
    },
    joinSpiked: {
        defaultMessage: 'Spiked',
        description: 'Label for the button that sets the line join to miter',
        id: 'pm.paint.modeTools.joinSpiked'
    },
    joinRounded: {
        defaultMessage: 'Rounded',
        description: 'Label for the button that sets the line join to round',
        id: 'pm.paint.modeTools.joinRounded'
    },
    joinBeveled: {
        defaultMessage: 'Beveled',
        description: 'Label for the button that sets the line join to bevel',
        id: 'pm.paint.modeTools.joinBeveled'
    },
    endRounded: {
        defaultMessage: 'Rounded',
        description: 'Label for the button that sets the line cap to round',
        id: 'pm.paint.modeTools.endRounded'
    },
    endSquared: {
        defaultMessage: 'Squared',
        description: 'Label for the button that sets the line cap to square',
        id: 'pm.paint.modeTools.endSquared'
    },
    merge: {
        defaultMessage: 'Merge',
        description: 'Label for the button that merges two selected objects together',
        id: 'pm.paint.modeTools.merge'
    },
    subtract: {
        defaultMessage: 'Subtract',
        description: 'Label for the button that subtracts selected objects from eachother',
        id: 'pm.paint.modeTools.subtract'
    },
    mask: {
        defaultMessage: 'Mask',
        description: 'Label for the button that ands two selected objects together',
        id: 'pm.paint.modeTools.mask'
    },
    filter: {
        defaultMessage: 'Filter',
        description: 'Label for the button that xors two selected objects together',
        id: 'pm.paint.modeTools.filter'
    },
    leftAlign: {
        defaultMessage: 'Left Align',
        description: 'Label for the button that sets text alignment to the left',
        id: 'pm.paint.modeTools.leftAlign'
    },
    rightAlign: {
        defaultMessage: 'Right Align',
        description: 'Label for the button that sets text alignment to the right',
        id: 'pm.paint.modeTools.rightAlign'
    },
    centerAlign: {
        defaultMessage: 'Center Align',
        description: 'Label for the button that sets text alignment to the center',
        id: 'pm.paint.modeTools.centerAlign'
    },
    match: {
        defaultMessage: 'Match',
        description: 'Label for what the magic wand compares between shapes',
        id: 'paint.contextBar.match'
    },
    matchFill: {
        defaultMessage: 'Same fill',
        description: 'Magic wand option: select shapes with the same fill colour',
        id: 'paint.contextBar.matchFill'
    },
    matchOutline: {
        defaultMessage: 'Same outline',
        description: 'Magic wand option: select shapes with the same outline colour and width',
        id: 'paint.contextBar.matchOutline'
    },
    matchBoth: {
        defaultMessage: 'Same fill and outline',
        description: 'Magic wand option: select shapes whose fill and outline both match',
        id: 'paint.contextBar.matchBoth'
    },
    matchNear: {
        defaultMessage: 'Everything near the click',
        description: 'Magic wand option: select every shape within a radius of the click',
        id: 'paint.contextBar.matchNear'
    },
    radius: {
        defaultMessage: 'Radius',
        description: 'Label for how far from the click the magic wand reaches in nearby mode',
        id: 'paint.contextBar.radius'
    },
    polygonHint: {
        defaultMessage: 'Click corners · click the first one or double-click to finish · Esc cancels',
        description: 'Hint shown while the polygon lasso selection style is active',
        id: 'paint.contextBar.polygonHint'
    },
    tolerance: {
        defaultMessage: 'Tolerance',
        description: 'Label for how different a colour may be and still be picked up by the magic wand',
        id: 'paint.contextBar.tolerance'
    },
    needsTwo: {
        defaultMessage: 'Select two or more shapes',
        description: 'Tooltip on the merge/mask/subtract/filter buttons while fewer than two shapes are selected',
        id: 'paint.contextBar.needsTwo'
    },
    arrowHint: {
        defaultMessage: 'Shift: snap angle · Alt: drag the shaft width · Alt + Shift: drag the head · Ctrl: two heads',
        description: 'Hint shown in the tool options bar while the arrow tool is active',
        id: 'paint.contextBar.arrowHint'
    },
    shapeHint: {
        defaultMessage: 'Hold Shift for a perfect shape',
        description: 'Hint shown in the tool options bar for shape tools with no other options',
        id: 'paint.contextBar.shapeHint'
    },
    lineHint: {
        defaultMessage: 'Hold Shift to snap the angle',
        description: 'Hint shown in the tool options bar while the line tool is active',
        id: 'paint.contextBar.lineHint'
    },
    mirrorOn: {
        defaultMessage: 'Mirroring is on... click to draw without it (the lines stay)',
        description: 'Tooltip for the mirror on/off toggle while on',
        id: 'paint.contextBar.mirrorOn'
    },
    mirrorOff: {
        defaultMessage: 'Mirroring is off... click to turn it back on',
        description: 'Tooltip for the mirror on/off toggle while off',
        id: 'paint.contextBar.mirrorOff'
    },
    mirrorRadial: {
        defaultMessage: 'Radial',
        description: 'How many turned copies around the radial centre (1 is off)',
        id: 'paint.contextBar.mirrorRadial'
    },
    kaleidoscope: {
        defaultMessage: 'Kaleidoscope',
        description: 'Label for the buttons that place evenly spaced mirror lines around the centre',
        id: 'paint.contextBar.kaleidoscope'
    },
    kaleidoscopeN: {
        defaultMessage: '{n} lines through the centre ({images} images)',
        description: 'Tooltip for a kaleidoscope preset',
        id: 'paint.contextBar.kaleidoscopeN'
    },
    kaleidoSegments: {
        defaultMessage: 'Segments',
        description: 'Label for the number of kaleidoscope segments',
        id: 'paint.contextBar.kaleidoSegments'
    },
    kaleidoMirror: {
        defaultMessage: 'Mirror',
        description: 'Kaleidoscope mode: mirror lines through the centre',
        id: 'paint.contextBar.kaleidoMirror'
    },
    kaleidoSpin: {
        defaultMessage: 'Spin',
        description: 'Kaleidoscope mode: turned copies around the centre, no mirroring',
        id: 'paint.contextBar.kaleidoSpin'
    },
    kaleidoSave: {
        defaultMessage: 'Save preset',
        description: 'Button that saves the current mirror setup as a preset',
        id: 'paint.contextBar.kaleidoSave'
    },
    kaleidoPreset: {
        defaultMessage: 'Your preset {n}... {images} images',
        description: 'Tooltip for a saved mirror preset',
        id: 'paint.contextBar.kaleidoPreset'
    },
    kaleidoRemove: {
        defaultMessage: 'Remove preset {n}',
        description: 'Tooltip for the button that deletes a saved mirror preset',
        id: 'paint.contextBar.kaleidoRemove'
    },
    clearMirrors: {
        defaultMessage: 'Clear lines',
        description: 'Button that removes every mirror line',
        id: 'paint.contextBar.clearMirrors'
    },
    mirrorHint: {
        defaultMessage: 'Drag to add a line · drag dots to move or turn · Del removes · centres snap to the middle',
        description: 'Hint shown while the mirror tool is active',
        id: 'paint.contextBar.mirrorHint'
    },
    bitFillHint: {
        defaultMessage: 'Tolerance above 0 also fills colours close to the one clicked · Shift fills every match',
        description: 'Hint for the bitmap fill tool',
        id: 'paint.contextBar.bitFillHint'
    },
    linear: {defaultMessage: 'Linear', description: 'Gradient type', id: 'paint.contextBar.linear'},
    radial: {defaultMessage: 'Radial', description: 'Gradient type', id: 'paint.contextBar.radial'},
    smooth: {defaultMessage: 'Smooth', description: 'Bitmap gradient style', id: 'paint.contextBar.smooth'},
    dither: {
        defaultMessage: 'Dithered... two colours in a pixel pattern',
        description: 'Bitmap gradient style',
        id: 'paint.contextBar.dither'
    },
    gradientHint: {
        defaultMessage: 'Drag across a shape (or the selection) · uses the Fill colours · Shift snaps to 45°',
        description: 'Hint for the vector gradient tool',
        id: 'paint.contextBar.gradientHint'
    },
    bitGradientHint: {
        defaultMessage: 'Drag across an area to fill it · Shift at the start fills everything',
        description: 'Hint for the bitmap gradient tool',
        id: 'paint.contextBar.bitGradientHint'
    },
    fxOutline: {
        defaultMessage: 'Outline in the fill colour (the selection, or the whole costume)',
        description: 'Bitmap effect button',
        id: 'paint.contextBar.fxOutline'
    },
    fxShadow: {
        defaultMessage: 'Drop shadow in the fill colour (the selection, or the whole costume)',
        description: 'Bitmap effect button',
        id: 'paint.contextBar.fxShadow'
    },
    fxSize: {defaultMessage: 'px', description: 'Size of the bitmap outline or shadow', id: 'paint.contextBar.fxSize'},
    polygonToolHint: {
        defaultMessage: 'Click each corner · click the first one, double-click or Enter to close · Shift keeps sides at 45°',
        description: 'Hint for the polygon tool',
        id: 'paint.contextBar.polygonToolHint'
    },
    handHint: {
        defaultMessage: 'Drag to move around. Hold Space to do this with any tool',
        description: 'Hint shown in the tool options bar while the hand tool is active',
        id: 'paint.contextBar.handHint'
    },
    fillHint: {
        defaultMessage: 'Click a shape to fill it with the current fill',
        description: 'Hint shown in the tool options bar while the fill tool is active',
        id: 'paint.contextBar.fillHint'
    }
});
const TOOL_NAMES = {
    [Modes.SELECT]: toolMessages.select,
    [Modes.BIT_SELECT]: toolMessages.select,
    [Modes.RESHAPE]: toolMessages.reshape,
    [Modes.BRUSH]: toolMessages.brush,
    [Modes.BIT_BRUSH]: toolMessages.brush,
    [Modes.PEN]: {defaultMessage: 'Pen', description: 'Label for the pen tool', id: 'paint.penMode.pen'},
    [Modes.ERASER]: toolMessages.eraser,
    [Modes.BIT_ERASER]: toolMessages.eraser,
    [Modes.FILL]: toolMessages.fill,
    [Modes.BIT_FILL]: toolMessages.fill,
    [Modes.TEXT]: toolMessages.text,
    [Modes.BIT_TEXT]: toolMessages.text,
    [Modes.LINE]: toolMessages.line,
    [Modes.BIT_LINE]: toolMessages.line,
    [Modes.OVAL]: toolMessages.oval,
    [Modes.BIT_OVAL]: toolMessages.oval,
    [Modes.RECT]: toolMessages.rect,
    [Modes.BIT_RECT]: toolMessages.rect,
    [Modes.ROUNDED_RECT]: toolMessages.roundedRect,
    [Modes.TRIANGLE]: toolMessages.triangle,
    [Modes.SUSSY]: toolMessages.sussy,
    [Modes.ARROW]: toolMessages.arrow,
    [Modes.HAND]: handMessages.hand,
    [Modes.MIRROR]: mirrorMessages.mirror,
    [Modes.POLYGON]: polygonMessages.polygon,
    [Modes.BIT_POLYGON]: polygonMessages.polygon,
    [Modes.LASSO_SHAPE]: polygonMessages.lassoShape,
    [Modes.BIT_LASSO_SHAPE]: polygonMessages.lassoShape,
    [Modes.GRADIENT]: gradientMessages.gradient,
    [Modes.BIT_GRADIENT]: gradientMessages.gradient,
    [Modes.BIT_MIRROR]: mirrorMessages.mirror,
    [Modes.BIT_HAND]: handMessages.hand
};
const withKey = (title, key) => {
    if (!key) return title;
    return `${title} (${key})`;
};
const MOD = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';
class ScrollRow extends React.Component {
    constructor (props) {
        super(props);
        this.handleScroll = this.handleScroll.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
        this.setRef = this.setRef.bind(this);
        this.state = {fadeStart: false, fadeEnd: false};
    }
    componentDidMount () {
        this.measure();
        if (typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(() => this.measure());
            this.observer.observe(this.el);
        }
    }
    componentDidUpdate () { this.measure(); }
    componentWillUnmount () {
        if (this.observer) this.observer.disconnect();
    }
    measure () {
        const el = this.el;
        if (!el) return;
        const max = el.scrollWidth - el.clientWidth;
        const fadeStart = el.scrollLeft > 1;
        const fadeEnd = max - el.scrollLeft > 1;
        if (fadeStart !== this.state.fadeStart || fadeEnd !== this.state.fadeEnd) { this.setState({fadeStart, fadeEnd}); }
    }
    handleScroll () { this.measure(); }
    handleWheel (event) {
        const el = this.el;
        if (!el || el.scrollWidth <= el.clientWidth || event.deltaX !== 0) return;
        el.scrollLeft += event.deltaY;
    }
    setRef (el) { this.el = el; }
    render () {
        return (
            <div
                className={classNames(styles.bar, {
                    [styles.fadeStart]: this.state.fadeStart,
                    [styles.fadeEnd]: this.state.fadeEnd
                })}
                ref={this.setRef}
                onScroll={this.handleScroll}
                onWheel={this.handleWheel}
            >
                {this.props.children}
            </div>
        );
    }
}
ScrollRow.propTypes = {children: PropTypes.node};
const BarButton = props => (
    <button
        className={classNames(styles.button, {[styles.buttonActive]: props.active})}
        disabled={props.disabled}
        title={props.title}
        onClick={props.onClick}
    >
        <img alt={props.title} className={styles.icon} draggable={false} src={props.icon} />
    </button>
);
BarButton.propTypes = {
    active: PropTypes.bool,
    disabled: PropTypes.bool,
    icon: PropTypes.string.isRequired,
    onClick: PropTypes.func,
    title: PropTypes.string.isRequired
};
const BarGroup = props => <div className={styles.group}>{props.children}</div>;
BarGroup.propTypes = {children: PropTypes.node};
const Field = props => (
    <label className={styles.field}>
        <span className={styles.fieldLabel}>{props.label}</span>
        {props.children}
    </label>
);
Field.propTypes = {children: PropTypes.node, label: PropTypes.string.isRequired};
class RotateDial extends React.Component {
    constructor (props) {
        super(props);
        this.state = {angle: 0, step: Number(loadSettings().rotateStep) || 15};
        this.knob = null;
        this.setKnob = el => { this.knob = el; };
        this.handleDown = this.handleDown.bind(this);
        this.handleMove = this.handleMove.bind(this);
        this.handleUp = this.handleUp.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
        this.turnLeft = () => this.turn(-this.state.step, false);
        this.turnRight = () => this.turn(this.state.step, false);
        this.handleStep = this.handleStep.bind(this);
    }
    componentDidMount () { this.knob.addEventListener('wheel', this.handleWheel, {passive: false}); }
    componentWillUnmount () { this.knob.removeEventListener('wheel', this.handleWheel); this.handleUp(); }
    turn (degrees, live) {
        if (!degrees) return;
        this.setState(state => ({angle: (((state.angle + degrees) % 360) + 540) % 360 - 180}));
        this.props.onRotate(degrees, live);
    }
    pointerAngle (event) {
        const r = this.knob.getBoundingClientRect();
        return Math.atan2(event.clientY - (r.top + (r.height / 2)), event.clientX - (r.left + (r.width / 2))) *
            180 / Math.PI;
    }
    handleDown (event) {
        event.preventDefault();
        this.last = this.pointerAngle(event);
        this.carry = 0;
        document.addEventListener('pointermove', this.handleMove);
        document.addEventListener('pointerup', this.handleUp);
    }
    handleMove (event) {
        let delta = this.pointerAngle(event) - this.last;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        this.last += delta;
        this.carry += delta;
        const step = event.shiftKey ? this.state.step : 1;
        const whole = Math.trunc(this.carry / step) * step;
        this.carry -= whole;
        this.turn(whole, true);
    }
    handleStep (event) {
        const value = Number(event.target.value);
        if (!(value > 0)) return;
        const step = Math.min(180, value);
        this.setState({step});
        saveSettings({rotateStep: step});
    }
    handleUp () {
        document.removeEventListener('pointermove', this.handleMove);
        document.removeEventListener('pointerup', this.handleUp);
    }
    handleWheel (event) {
        event.preventDefault();
        const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        if (event.shiftKey) { this.turn(Math.sign(delta) * this.state.step, true); return; }
        this.wheelCarry = (this.wheelCarry || 0) + (delta * (event.deltaMode === 1 ? 15 : 1) / 8);
        const whole = Math.trunc(this.wheelCarry);
        this.wheelCarry -= whole;
        this.turn(whole, true);
    }
    render () {
        return (
            <div className={styles.dial} title={this.props.title}>
                <button
                    className={styles.dialArrow}
                    disabled={this.props.disabled}
                    title={`-${this.state.step}°`}
                    onClick={this.turnLeft}
                >{'↺'}</button>
                <div
                    className={classNames(styles.dialKnob, {[styles.dialDisabled]: this.props.disabled})}
                    ref={this.setKnob}
                    onPointerDown={this.props.disabled ? null : this.handleDown}
                >
                    <div className={styles.dialPointer} style={{transform: `rotate(${this.state.angle}deg)`}} />
                </div>
                <button
                    className={styles.dialArrow}
                    disabled={this.props.disabled}
                    title={`+${this.state.step}°`}
                    onClick={this.turnRight}
                >{'↻'}</button>
                <input
                    className={styles.dialStep}
                    disabled={this.props.disabled}
                    max="180"
                    min="0.1"
                    step="any"
                    title={this.props.stepTitle}
                    type="number"
                    value={this.state.step}
                    onChange={this.handleStep}
                />
                <span className={styles.dialStepUnit}>{'°'}</span>
            </div>
        );
    }
}
RotateDial.propTypes = {
    disabled: PropTypes.bool,
    onRotate: PropTypes.func.isRequired,
    stepTitle: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired
};
const Hint = props => <span className={styles.hint}>{props.children}</span>;
const lassoSmoothingField = (props, f) => (
    <Field label={f(messages.smoothing)}>
        <NumberField
            max={100}
            min="0"
            value={props.lassoSmoothing}
            onSubmit={value => props.onBrushOption('lassoSmoothing', Math.max(0, Math.min(100, Number(value) || 0)))}
        />
    </Field>
);
Hint.propTypes = {children: PropTypes.node};
const NumberField = props => (
    <LiveInput
        range
        small
        max={props.max}
        min={props.min}
        step={props.step}
        type="number"
        value={props.value}
        onSubmit={props.onSubmit}
    />
);
NumberField.propTypes = {
    max: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    min: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    onSubmit: PropTypes.func.isRequired,
    step: PropTypes.string,
    value: PropTypes.number
};
const VECTOR_BRUSHES = [
    ['ROUND', 'brushRound', circleBrushIcon],
    ['SQUARE', 'brushSquareName', squareBrushIcon],
    ['CALLIGRAPHY', 'brushCalligraphy', calligraphyIcon],
    ['MARKER', 'brushMarker', markerIcon],
    ['SPRAY', 'brushSpray', sprayIcon]
];
const BITMAP_BRUSHES = [
    ['ROUND', 'brushRound', circleBrushIcon],
    ['SQUARE', 'brushSquareName', squareBrushIcon],
    ['PIXEL', 'brushPixel', pixelIcon],
    ['CALLIGRAPHY', 'brushCalligraphy', calligraphyIcon],
    ['SPRAY', 'brushSpray', sprayIcon]
];
const brushPicker = (props, f, bitmap) => {
    const current = bitmap ? props.bitBrushPreset : props.brushPreset;
    const pick = preset => {
        props.onBrushOption(bitmap ? 'bitPreset' : 'preset', preset);
        if (!bitmap && (preset === 'ROUND' || preset === 'SQUARE')) {
            props.onBrushChange(preset === 'ROUND' ? 'CIRCLE' : 'SQUARE');
        }
    };
    return (
        <React.Fragment>
            <BrushMenu bitmap={bitmap} current={current} f={f} onPick={pick} />
            <BarGroup>
                <BarButton
                    active={props.brushPressure}
                    icon={pressureIcon}
                    title={f(messages.pressure)}
                    onClick={() => props.onBrushOption('pressure', !props.brushPressure)}
                />
            </BarGroup>
            {current === 'SPRAY' ? (
                <Field label={f(messages.density)}>
                    <NumberField
                        max={100}
                        min="1"
                        value={props.sprayDensity}
                        onSubmit={value => props.onBrushOption('sprayDensity', Math.max(1, Math.min(100, Number(value) || 1)))}
                    />
                </Field>
            ) : null}
            <Field label={f(messages.taper)}>
                <NumberField
                    max={100}
                    min="0"
                    value={props.brushTaper}
                    onSubmit={value => props.onBrushOption('taper', Math.max(0, Math.min(100, Number(value) || 0)))}
                />
            </Field>
        </React.Fragment>
    );
};
const PLUS_ICON = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" ' +
    'stroke="#575e75" stroke-width="1.6" stroke-linecap="round"/></svg>')}`;
class BrushMenu extends React.Component {
    constructor (props) {
        super(props);
        this.state = {brushes: getCustomBrushes().slice(), error: null};
        this.file = null;
        this.setFile = el => { this.file = el; };
        this.handleAdd = () => this.file && this.file.click();
        this.handleFile = this.handleFile.bind(this);
    }
    componentDidMount () {
        preloadCustomBrushes();
        this.unsubscribe = subscribeCustomBrushes(brushes => this.setState({brushes: brushes.slice()}));
    }
    componentWillUnmount () { this.unsubscribe(); }
    handleFile (event) {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) return;
        addCustomBrushFromFile(file)
            .then(brush => { this.setState({error: null}); this.props.onPick(presetFor(brush)); })
            .catch(error => this.setState({error: error.message}));
    }
    remove (brush) {
        if (this.props.current === presetFor(brush)) this.props.onPick('ROUND');
        removeCustomBrush(brush.id);
    }
    render () {
        const {bitmap, current, f} = this.props;
        const builtIn = bitmap ? BITMAP_BRUSHES : VECTOR_BRUSHES;
        const custom = customBrushFor(current);
        const builtInEntry = builtIn.find(([preset]) => preset === current);
        return (
            <BarBubble
                active={false}
                icon={custom ? custom.mask : (builtInEntry || builtIn[0])[2]}
                iconClassName={custom ? styles.brushThumb : null}
                title={f(messages.brushMenu)}
            >
                <div className={styles.bubbleRow}>
                    {builtIn.map(([preset, label, icon]) => (
                        <BubbleTile
                            active={current === preset}
                            icon={icon}
                            key={preset}
                            title={f(messages[label])}
                            onClick={() => this.props.onPick(preset)}
                        />
                    ))}
                </div>
                <div className={styles.bubbleDivider} />
                <div className={styles.bubbleRow}>
                    {getTextureBrushes().map(brush => (
                        <BubbleTile
                            active={current === presetFor(brush)}
                            icon={brush.mask}
                            iconClassName={styles.brushThumb}
                            key={brush.id}
                            title={brush.name}
                            onClick={() => this.props.onPick(presetFor(brush))}
                        />
                    ))}
                </div>
                <div className={styles.bubbleRow}>
                    {this.state.brushes.map(brush => (
                        <BubbleTile
                            active={current === presetFor(brush)}
                            icon={brush.mask}
                            iconClassName={styles.brushThumb}
                            key={brush.id}
                            title={brush.name}
                            onClick={() => this.props.onPick(presetFor(brush))}
                        >
                            <span
                                className={styles.bubbleRemove}
                                role="button"
                                title={f(messages.removeBrush)}
                                onClick={e => { e.stopPropagation(); this.remove(brush); }}
                            >{'×'}</span>
                        </BubbleTile>
                    ))}
                    <BubbleTile icon={PLUS_ICON} title={f(messages.addBrush)} onClick={this.handleAdd} />
                    <input
                        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
                        className={styles.hiddenInput}
                        ref={this.setFile}
                        type="file"
                        onChange={this.handleFile}
                    />
                </div>
                {custom && !custom.builtin ? (
                    <div className={styles.bubbleLine}>
                        <input
                            aria-label={f(messages.brushName)}
                            maxLength={40}
                            type="text"
                            value={custom.name}
                            onChange={e => updateCustomBrush(custom.id, {name: e.target.value})}
                        />
                    </div>
                ) : null}
                {custom && !custom.builtin ? (
                    <div className={styles.bubbleLine}>
                        <Field label={f(messages.brushSpacing)}>
                            <NumberField
                                max={400}
                                min="1"
                                value={custom.spacing}
                                onSubmit={v => updateCustomBrush(custom.id, {spacing: Math.max(1, Math.min(400, Number(v) || 25))})}
                            />
                        </Field>
                        <Field label={f(messages.brushScatter)}>
                            <NumberField
                                max={300}
                                min="0"
                                value={custom.scatter}
                                onSubmit={v => updateCustomBrush(custom.id, {scatter: Math.max(0, Math.min(300, Number(v) || 0))})}
                            />
                        </Field>
                    </div>
                ) : null}
                {this.state.brushes.length || this.state.error ? null : (
                    <div className={styles.bubbleNote}>{f(messages.brushUploadHint)}</div>
                )}
                {this.state.error ? <div className={styles.bubbleError}>{this.state.error}</div> : null}
            </BarBubble>
        );
    }
}
BrushMenu.propTypes = {
    bitmap: PropTypes.bool,
    current: PropTypes.string,
    f: PropTypes.func.isRequired,
    onPick: PropTypes.func.isRequired
};
const PROFILES = [
    [LineProfiles.UNIFORM, 'profileUniform'],
    [LineProfiles.TAPER_BOTH, 'profileTaperBoth'],
    [LineProfiles.TAPER_START, 'profileTaperStart'],
    [LineProfiles.TAPER_END, 'profileTaperEnd'],
    [LineProfiles.SWELL, 'profileSwell'],
    [LineProfiles.PINCH, 'profilePinch']
];
const profileIcon = profile => {
    const top = [];
    const bottom = [];
    for (let i = 0; i <= 20; i++) {
        const x = 2 + (i * 0.8);
        const r = Math.max(0.3, 3.6 * profileWidth(profile, i / 20));
        top.push(`${x.toFixed(2)},${(10 - r).toFixed(2)}`);
        bottom.unshift(`${x.toFixed(2)},${(10 + r).toFixed(2)}`);
    }
    return `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><polygon fill="#575e75" ` +
        `points="${top.concat(bottom).join(' ')}"/></svg>`)}`;
};
const PROFILE_ICONS = {};
PROFILES.forEach(([profile]) => { PROFILE_ICONS[profile] = profileIcon(profile); });
const lineIcon = ls => {
    ls = lineStyleOf(ls);
    const dash = lineDash(ls, 2.4).map(n => Math.max(n, 0.01).toFixed(2)).join(' ');
    return `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2.5 10h15" stroke="#575e75" ` +
        `stroke-width="2.4" stroke-linecap="${ls.cap}"${dash ? ` stroke-dasharray="${dash}"` : ''} fill="none"/></svg>`)}`;
};
const LINE_ICONS = {};
Object.keys(LINE_STYLES).forEach(type => { LINE_ICONS[type] = lineIcon({type}); });
class LineStyleBody extends React.Component {
    constructor (props) { super(props); this.state = {ls: lineStyleOf(props.current)}; }
    brushRefs () {
        const refs = getLineTextures().map(t => [t.ref, t.name, tipIcon(t.ref)]);
        getCustomBrushes().forEach(b => refs.push([presetFor(b), b.name, b.mask]));
        return refs;
    }
    set (patch) { const ls = lineStyleOf(Object.assign({}, this.state.ls, patch)); this.setState({ls}); this.props.onChange(ls); }
    render () {
        const {f} = this.props;
        const ls = this.state.ls;
        return (
            <div className={styles.lineStyleBody}>
                <div className={styles.lineStyleRow}>
                    {Object.keys(LINE_STYLES).map(type => (
                        <BubbleTile
                            active={ls.type === type}
                            icon={LINE_ICONS[type]}
                            key={type}
                            title={f(messages[`line${type}`])}
                            onClick={() => this.set(Object.assign({type}, LINE_STYLES[type]))}
                        />
                    ))}
                </div>
                <div className={styles.lineStyleRow}>
                    {this.brushRefs().map(([ref, name, icon]) => (
                        <BubbleTile
                            active={ls.type === 'BRUSH' && ls.brush === ref}
                            icon={icon}
                            iconClassName={styles.brushThumb}
                            key={ref}
                            title={name}
                            onClick={() => this.set({type: 'BRUSH', brush: ref, spacing: undefined, scatter: undefined,
                                seed: ls.seed > 1 ? ls.seed : 1 + Math.floor(Math.random() * 1e6)})}
                        />
                    ))}
                </div>
                {ls.type === 'BRUSH' ? (
                    <div className={styles.lineStyleRow}>
                        <Field label={f(messages.brushSpacing)}>
                            <NumberField max={400} min="1" value={ls.spacing} onSubmit={v => this.set({spacing: Number(v)})} />
                        </Field>
                        <Field label={f(messages.brushScatter)}>
                            <NumberField max={300} min="0" value={ls.scatter} onSubmit={v => this.set({scatter: Number(v)})} />
                        </Field>
                        <button
                            className={styles.bubbleTile}
                            title={f(messages.lineBrushReroll)}
                            onClick={() => this.set({seed: 1 + Math.floor(Math.random() * 1e6)})}
                        >{f(messages.lineBrushReroll)}</button>
                    </div>
                ) : null}
                {ls.type === 'SOLID' || ls.type === 'BRUSH' ? null : (
                    <div className={styles.lineStyleRow}>
                        {ls.type === 'DOTTED' ? null : (
                            <Field label={f(messages.lineDash)}>
                                <NumberField
                                    max={50}
                                    min="0"
                                    step="0.5"
                                    value={ls.dash}
                                    onSubmit={v => this.set({dash: Number(v)})}
                                />
                            </Field>
                        )}
                        <Field label={f(messages.lineGap)}>
                            <NumberField max={50} min="0" step="0.5" value={ls.gap} onSubmit={v => this.set({gap: Number(v)})} />
                        </Field>
                        <Field label={f(messages.lineOffset)}>
                            <NumberField
                                max={50}
                                min="0"
                                step="0.5"
                                value={ls.offset}
                                onSubmit={v => this.set({offset: Number(v)})}
                            />
                        </Field>
                    </div>
                )}
                {ls.type === 'SOLID' || ls.type === 'BRUSH' ? null : (
                    <div className={styles.lineStyleRow}>
                        <span className={classNames(styles.fieldLabel, styles.lineStyleLabel)}>{f(messages.lineCap)}</span>
                        {['butt', 'round', 'square'].map(cap => (
                            <button
                                className={classNames(styles.bubbleTile, {[styles.bubbleTileActive]: ls.cap === cap})}
                                key={cap}
                                onClick={() => this.set({cap})}
                            >{f(messages[`lineCap${cap}`])}</button>
                        ))}
                    </div>
                )}
                {this.props.apply ? <div className={styles.bubbleNote}>{f(messages.lineStyleSelect)}</div> : null}
            </div>
        );
    }
}
LineStyleBody.propTypes = {
    apply: PropTypes.bool,
    current: PropTypes.object,
    f: PropTypes.func.isRequired,
    onChange: PropTypes.func.isRequired
};
const lineStyleMenu = (props, f, apply) => {
    const current = lineStyleOf(props.lineStyle);
    return (
        <BarBubble
            active={current.type !== 'SOLID'}
            icon={current.type === 'BRUSH' ? tipIcon(current.brush) || LINE_ICONS.SOLID : LINE_ICONS[current.type]}
            title={f(messages.lineStyle)}
        >
            {() => (
                <LineStyleBody
                    apply={apply}
                    current={current}
                    f={f}
                    onChange={ls => {
                        props.onBrushOption('lineStyle', ls);
                        if (apply && props.onApplyLineStyle) { setHistoryLabel('lineStyle'); props.onApplyLineStyle(ls); }
                    }}
                />
            )}
        </BarBubble>
    );
};
const profileMenu = (props, f, apply) => {
    const current = props.lineProfile || LineProfiles.UNIFORM;
    return (
        <BarBubble
            active={!apply && current !== LineProfiles.UNIFORM}
            icon={PROFILE_ICONS[apply ? LineProfiles.TAPER_BOTH : current]}
            title={f(messages.outlineProfile)}
        >
            {close => (
                <React.Fragment>
                    <div className={styles.bubbleRow}>
                        {PROFILES.map(([profile, label]) => (
                            <BubbleTile
                                active={!apply && current === profile}
                                icon={PROFILE_ICONS[profile]}
                                key={profile}
                                title={f(messages[label])}
                                onClick={() => {
                                    if (apply) { setHistoryLabel('outlineProfile'); props.onApplyLineProfile(profile); } else { props.onBrushOption('lineProfile', profile); }
                                    close();
                                }}
                            />
                        ))}
                    </div>
                    {apply ? <div className={styles.bubbleNote}>{f(messages.outlineProfileSelect)}</div> : null}
                </React.Fragment>
            )}
        </BarBubble>
    );
};
const toleranceField = (props, f) => (
    <Field label={f(messages.tolerance)}>
        <NumberField
            max={255}
            min="0"
            value={props.fillTolerance}
            onSubmit={value => props.onBrushOption('fillTolerance', Math.max(0, Math.min(255, Number(value) || 0)))}
        />
    </Field>
);
const effectButtons = (props, f) => {
    const run = kind => {
        if (applyBitmapEffect(kind, props.effectSize, props.fillPrimary)) { setHistoryLabel('effect'); props.onUpdateImage(); }
    };
    return (
        <React.Fragment>
            <BarGroup>
                <BarButton
                    disabled={!props.fillPrimary}
                    icon={outlineFxIcon}
                    title={f(messages.fxOutline)}
                    onClick={() => run('outline')}
                />
                <BarButton
                    disabled={!props.fillPrimary}
                    icon={shadowFxIcon}
                    title={f(messages.fxShadow)}
                    onClick={() => run('shadow')}
                />
            </BarGroup>
            <Field label={f(messages.fxSize)}>
                <NumberField
                    max={64}
                    min="1"
                    value={props.effectSize}
                    onSubmit={value => props.onBrushOption('effectSize', Math.max(1, Math.min(64, Number(value) || 1)))}
                />
            </Field>
        </React.Fragment>
    );
};
const brushShapeButtons = (props, f) => (
    <BarGroup>
        <BarButton
            active={props.brushType !== 'SQUARE'}
            icon={circleBrushIcon}
            title={f(messages.brushCircle)}
            onClick={() => props.onBrushChange('CIRCLE')}
        />
        <BarButton
            active={props.brushType === 'SQUARE'}
            icon={squareBrushIcon}
            title={f(messages.brushSquare)}
            onClick={() => props.onBrushChange('SQUARE')}
        />
    </BarGroup>
);
const ALIGN_BUTTONS = [
    [[alignLeftEdgeIcon, 'alignLeftEdges', 'onAlignLeftEdges'],
        [alignCenterHIcon, 'alignHorizontalCenters', 'onAlignHorizontalCenters'],
        [alignRightEdgeIcon, 'alignRightEdges', 'onAlignRightEdges'],
        [distributeHIcon, 'distributeHorizontally', 'onDistributeHorizontally']],
    [[alignTopIcon, 'alignTopEdges', 'onAlignTopEdges'],
        [alignCenterVIcon, 'alignVerticalCenters', 'onAlignVerticalCenters'],
        [alignBottomIcon, 'alignBottomEdges', 'onAlignBottomEdges'],
        [distributeVIcon, 'distributeVertically', 'onDistributeVertically']]
];
const alignMenu = (props, f) => (
    <BarBubble icon={alignMenuIcon} title={f(messages.align)}>
        <div className={styles.bubbleRow}>
            {[
                [AlignReferences.SELECTION, 'alignToSelection', 'onAlignToSelection'],
                [AlignReferences.ART_BOARD, 'alignToCanvas', 'onAlignToCanvas'],
                [AlignReferences.ROTATION_CENTER, 'alignToRotationCenter', 'onAlignToRotationCenter']
            ].map(([reference, label, handler]) => (
                <button
                    className={classNames(styles.bubbleChip, {[styles.bubbleChipActive]: props.alignReference === reference})}
                    key={reference}
                    onClick={props[handler]}
                >
                    {f(messages[label])}
                </button>
            ))}
        </div>
        {ALIGN_BUTTONS.map(row => (
            <div className={styles.bubbleRow} key={row[0][1]}>
                {row.map(([icon, label, handler]) => (
                    <BubbleTile icon={icon} key={label} title={f(messages[label])} onClick={props[handler]} />
                ))}
            </div>
        ))}
    </BarBubble>
);
const shapeIcon = shape => `data:image/svg+xml,${encodeURIComponent(generateShapeSVG(shape))}`;
const sussyMenu = props => {
    const selected = selectableShapes.filter(shape => shape.id === props.currentlySelectedShape)[0] ||
        selectableShapes[0];
    const categorized = categorizeShapes(selectableShapes);
    return (
        <Dropdown
            className={styles.menu}
            enterExitTransitionDurationMs={20}
            popoverContent={
                <InputGroup className={classNames(styles.popover, styles.shapeList)} rtl={props.rtl}>
                    {Object.keys(categorized)
                        .filter(id => categorized[id].length > 0)
                        .map(categoryId => (
                            <React.Fragment key={categoryId}>
                                <p className={styles.shapeCategory}>{categories[categoryId]}</p>
                                {categorized[categoryId].map(shape => (
                                    <LabeledIconButton
                                        className={styles.shapeItem}
                                        hideLabel
                                        imgSrc={shapeIcon(shape)}
                                        key={shape.id}
                                        title={shape.name}
                                        onClick={() => props.onCurrentlySelectedShapeChange(shape.id)}
                                    />
                                ))}
                            </React.Fragment>
                        ))}
                </InputGroup>
            }
            tipSize={.01}
        >
            <span className={styles.menuLabel} title={selected.name}>
                <img alt={selected.name} className={styles.icon} draggable={false} src={shapeIcon(selected)} />
                <span className={styles.menuText}>{selected.name}</span>
            </span>
        </Dropdown>
    );
};
const KALEIDO_PICKS = [1, 2, 3, 4, 6, 8];
const KALEIDO_MAX = 36;
const KALEIDO_SAVED = 12;
const savedPresets = () => { const list = loadSettings().mirrorPresets; return Array.isArray(list) ? list : []; };
class KaleidoscopeFields extends React.Component {
    constructor (props) {
        super(props);
        this.state = {presets: savedPresets()};
        this.handleSave = this.handleSave.bind(this);
        this.handleSegments = this.handleSegments.bind(this);
        this.handleMirror = this.handleMirror.bind(this);
        this.handleSpin = this.handleSpin.bind(this);
    }
    isSpin () {
        const {mirrorLines, mirrorRadial} = this.props;
        return Boolean(mirrorRadial && mirrorRadial.n > 1 && !(mirrorLines && mirrorLines.length));
    }
    segments () {
        const {mirrorLines, mirrorRadial} = this.props;
        if (mirrorLines && mirrorLines.length) return mirrorLines.length;
        return mirrorRadial && mirrorRadial.n > 1 ? mirrorRadial.n : 0;
    }
    apply (n, spin) {
        const {mirrorLines, mirrorRadial} = this.props;
        const at = (mirrorRadial && mirrorRadial.n > 1 && mirrorRadial) || (mirrorLines && mirrorLines[0]) || CENTER;
        const count = Math.max(1, Math.min(KALEIDO_MAX, Math.round(Number(n) || 1)));
        this.props.onMirrorLines(spin ? [] : kaleidoscope(count, {x: at.x, y: at.y}));
        this.props.onMirrorRadial({n: spin ? count : 1, x: at.x, y: at.y});
        this.props.onMirrorEnabled(true);
    }
    handleSegments (value) { this.apply(value, this.isSpin()); }
    handleMirror () { this.apply(this.segments() || 6, false); }
    handleSpin () { this.apply(this.segments() || 6, true); }
    store (presets) { saveSettings({mirrorPresets: presets}); this.setState({presets}); }
    handleSave () {
        const {mirrorLines, mirrorRadial} = this.props;
        const preset = {lines: (mirrorLines || []).map(l => ({x: l.x, y: l.y, angle: l.angle})),
            radial: {n: mirrorRadial ? mirrorRadial.n : 1, x: mirrorRadial ? mirrorRadial.x : CENTER.x,
                y: mirrorRadial ? mirrorRadial.y : CENTER.y}};
        this.store(this.state.presets.concat([preset]).slice(-KALEIDO_SAVED));
    }
    render () {
        const {f} = this.props;
        const spin = this.isSpin();
        const active = Boolean(this.segments());
        return (
            <div className={styles.kaleidoFields}>
                <Field label={f(messages.kaleidoscope)}>
                    <div className={styles.chips}>
                        {KALEIDO_PICKS.map(n => (
                            <button
                                className={classNames(styles.chip, {[styles.chipActive]: active && this.segments() === n})}
                                key={n}
                                title={f(messages.kaleidoscopeN, {n, images: n * 2})}
                                onClick={() => this.apply(n, spin)}
                            >{n}</button>
                        ))}
                    </div>
                </Field>
                <Field label={f(messages.kaleidoSegments)}>
                    <NumberField max={KALEIDO_MAX} min="1" value={this.segments() || 1} onSubmit={this.handleSegments} />
                </Field>
                <div className={styles.chips}>
                    <button
                        className={classNames(styles.chip, styles.chipWide, {[styles.chipActive]: active && !spin})}
                        onClick={this.handleMirror}
                    >{f(messages.kaleidoMirror)}</button>
                    <button
                        className={classNames(styles.chip, styles.chipWide, {[styles.chipActive]: spin})}
                        onClick={this.handleSpin}
                    >{f(messages.kaleidoSpin)}</button>
                </div>
                <div className={styles.chips}>
                    {this.state.presets.map((preset, i) => (
                        <span className={styles.presetChip} key={i}>
                            <button
                                className={styles.chip}
                                title={f(messages.kaleidoPreset, {n: i + 1, images: (preset.lines.length * 2 || 1) *
                                    Math.max(1, preset.radial.n)})}
                                onClick={() => {
                                    this.props.onMirrorLines(preset.lines);
                                    this.props.onMirrorRadial(preset.radial);
                                    this.props.onMirrorEnabled(true);
                                }}
                            >{`★${i + 1}`}</button>
                            <button
                                className={styles.presetRemove}
                                title={f(messages.kaleidoRemove, {n: i + 1})}
                                onClick={() => this.store(this.state.presets.filter((p, j) => j !== i))}
                            >{'×'}</button>
                        </span>
                    ))}
                    <button
                        className={styles.textButton}
                        disabled={!active}
                        onClick={this.handleSave}
                    >{f(messages.kaleidoSave)}</button>
                </div>
            </div>
        );
    }
}
KaleidoscopeFields.propTypes = {
    f: PropTypes.func.isRequired,
    mirrorLines: PropTypes.arrayOf(PropTypes.shape({x: PropTypes.number, y: PropTypes.number, angle: PropTypes.number})),
    mirrorRadial: PropTypes.shape({n: PropTypes.number, x: PropTypes.number, y: PropTypes.number}),
    onMirrorEnabled: PropTypes.func.isRequired,
    onMirrorLines: PropTypes.func.isRequired,
    onMirrorRadial: PropTypes.func.isRequired
};
const DimodContextBarInner = props => {
    const f = props.intl.formatMessage;
    let toolName = TOOL_NAMES[props.mode] ? f(TOOL_NAMES[props.mode]) : '';
    const isSelect = props.mode === Modes.SELECT || props.mode === Modes.BIT_SELECT;
    if (isSelect) toolName = f(selectStyleMessage(props.selectStyle));
    const bitmap = isBitmap(props.format);
    let content = null;
    switch (props.mode) {
    case Modes.SELECT:
    case Modes.BIT_SELECT: {
        const canCombine = props.selectionCount >= 2;
        const combineTitle = title => {
            if (canCombine) return title;
            return `${title}... ${f(messages.needsTwo)}`;
        };
        content = (
            <div className={styles.options}>
                {!bitmap && props.selectStyle === SelectStyles.WAND ? (
                    <Field label={f(messages.match)}>
                        <BarGroup>
                            {[
                                [WandMatches.FILL, messages.matchFill, matchFillIcon],
                                [WandMatches.OUTLINE, messages.matchOutline, matchOutlineIcon],
                                [WandMatches.BOTH, messages.matchBoth, matchBothIcon],
                                [WandMatches.NEAR, messages.matchNear, matchNearIcon]
                            ].map(([match, label, icon]) => (
                                <BarButton
                                    active={props.wandMatch === match}
                                    icon={icon}
                                    key={match}
                                    title={f(label)}
                                    onClick={() => props.onWandMatchChange(match)}
                                />
                            ))}
                        </BarGroup>
                    </Field>
                ) : null}
                {!bitmap && props.selectStyle === SelectStyles.WAND && props.wandMatch === WandMatches.NEAR ? (
                    <Field label={f(messages.radius)}>
                        <NumberField max={255} min="0" value={props.wandTolerance} onSubmit={props.onWandToleranceChange} />
                    </Field>
                ) : null}
                {props.selectStyle === SelectStyles.POLYGON ? (
                    <Hint>{f(messages.polygonHint)}</Hint>
                ) : null}
                {bitmap && props.selectStyle === SelectStyles.WAND ? (
                    <Field label={f(messages.tolerance)}>
                        <NumberField max={255} min="0" value={props.wandTolerance} onSubmit={props.onWandToleranceChange} />
                    </Field>
                ) : null}
                <BarGroup>
                    <BarButton icon={copyIcon} title={withKey(f(messages.copy), `${MOD}C`)} onClick={props.onCopyToClipboard} />
                    <BarButton
                        disabled={!(props.clipboardItems.length > 0)}
                        icon={pasteIcon}
                        title={withKey(f(messages.paste), `${MOD}V`)}
                        onClick={labelled('paste', props.onPasteFromClipboard)}
                    />
                    <BarButton
                        icon={cutIcon}
                        title={withKey(f(messages.cut), `${MOD}X`)}
                        onClick={labelled('cut', props.onCutToClipboard)}
                    />
                    <BarButton
                        icon={deleteIcon}
                        title={withKey(f(messages.delete), 'Del')}
                        onClick={labelled('delete', props.onDelete)}
                    />
                </BarGroup>
                {bitmap ? null : (
                    <BarGroup>
                        <BarButton
                            disabled={!shouldShowGroup()}
                            icon={groupIcon}
                            title={withKey(f(messages.group), `${MOD}G`)}
                            onClick={labelled('group', props.onGroup)}
                        />
                        <BarButton
                            disabled={!shouldShowUngroup()}
                            icon={ungroupIcon}
                            title={withKey(f(messages.ungroup), `${MOD}Shift+G`)}
                            onClick={labelled('ungroup', props.onUngroup)}
                        />
                    </BarGroup>
                )}
                {bitmap ? null : (
                    <BarGroup>
                        <BarButton
                            disabled={!shouldShowBringForward()}
                            icon={sendFrontIcon}
                            title={f(messages.front)}
                            onClick={labelled('bringToFront', props.onSendToFront)}
                        />
                        <BarButton
                            disabled={!shouldShowBringForward()}
                            icon={sendForwardIcon}
                            title={f(messages.forward)}
                            onClick={labelled('bringForward', props.onSendForward)}
                        />
                        <BarButton
                            disabled={!shouldShowSendBackward()}
                            icon={sendBackwardIcon}
                            title={f(messages.backward)}
                            onClick={labelled('sendBackward', props.onSendBackward)}
                        />
                        <BarButton
                            disabled={!shouldShowSendBackward()}
                            icon={sendBackIcon}
                            title={f(messages.back)}
                            onClick={labelled('sendToBack', props.onSendToBack)}
                        />
                    </BarGroup>
                )}
                <BarGroup>
                    <BarButton
                        icon={flipHorizontalIcon}
                        title={f(messages.flipHorizontal)}
                        onClick={labelled('flipHorizontal', props.onFlipHorizontal)}
                    />
                    <BarButton
                        icon={flipVerticalIcon}
                        title={f(messages.flipVertical)}
                        onClick={labelled('flipVertical', props.onFlipVertical)}
                    />
                    <BarButton
                        icon={centerSelectionIcon}
                        title={f(messages.center)}
                        onClick={labelled('center', props.onCenterSelection)}
                    />
                </BarGroup>
                {props.onRotate ? (
                    <RotateDial
                        disabled={!(props.selectionCount > 0)}
                        stepTitle={f(messages.rotateStep)}
                        title={f(messages.rotateDial)}
                        onRotate={props.onRotate}
                    />
                ) : null}
                {bitmap ? null : alignMenu(props, f)}
                {bitmap ? null : profileMenu(props, f, true)}
                {bitmap ? null : lineStyleMenu(props, f, true)}
                {bitmap ? effectButtons(props, f) : null}
                {bitmap ? null : (
                    <BarGroup>
                        <BarButton
                            disabled={!canCombine}
                            icon={mergeIcon}
                            title={combineTitle(f(messages.merge))}
                            onClick={labelled('merge', props.onMergeShape)}
                        />
                        <BarButton
                            disabled={!canCombine}
                            icon={subtractIcon}
                            title={combineTitle(f(messages.subtract))}
                            onClick={labelled('subtract', props.onSubtractShape)}
                        />
                        <BarButton
                            disabled={!canCombine}
                            icon={maskIcon}
                            title={combineTitle(f(messages.mask))}
                            onClick={labelled('mask', props.onMaskShape)}
                        />
                        <BarButton
                            disabled={!canCombine}
                            icon={filterIcon}
                            title={combineTitle(f(messages.filter))}
                            onClick={labelled('filter', props.onExcludeShape)}
                        />
                    </BarGroup>
                )}
            </div>
        );
        break;
    }
    case Modes.RESHAPE: {
        const only = flags => { const on = Object.keys(flags).filter(key => flags[key]); return on.length === 1 ? on[0] : null; };
        const ends = only({round: props.hasSelectedRoundEnds, square: props.hasSelectedSquareEnds});
        const join = only({
            miter: props.hasSelectedMiterLineJoin,
            round: props.hasSelectedRoundLineJoin,
            bevel: props.hasSelectedBevelLineJoin
        });
        content = (
            <div className={styles.options}>
                <BarGroup>
                    <BarButton
                        disabled={!props.hasSelectedUncurvedPoints}
                        icon={curvedPointIcon}
                        title={f(messages.curved)}
                        onClick={props.onCurvePoints}
                    />
                    <BarButton
                        disabled={!props.hasSelectedUnpointedPoints}
                        icon={straightPointIcon}
                        title={f(messages.pointed)}
                        onClick={props.onPointPoints}
                    />
                </BarGroup>
                <BarGroup>
                    <BarButton
                        active={ends === 'round'}
                        icon={roundLineIcon}
                        title={f(messages.endRounded)}
                        onClick={props.onRoundEnds}
                    />
                    <BarButton
                        active={ends === 'square'}
                        icon={squareLineIcon}
                        title={f(messages.endSquared)}
                        onClick={props.onSquareEnds}
                    />
                </BarGroup>
                <BarGroup>
                    <BarButton
                        active={join === 'miter'}
                        icon={miterLineJoinIcon}
                        title={f(messages.joinSpiked)}
                        onClick={props.onMiterLineJoin}
                    />
                    <BarButton
                        active={join === 'round'}
                        icon={roundLineJoinIcon}
                        title={f(messages.joinRounded)}
                        onClick={props.onRoundLineJoin}
                    />
                    <BarButton
                        active={join === 'bevel'}
                        icon={bevelLineJoinIcon}
                        title={f(messages.joinBeveled)}
                        onClick={props.onBevelLineJoin}
                    />
                </BarGroup>
                <BarGroup>
                    <BarButton
                        icon={deleteIcon}
                        title={withKey(f(messages.delete), 'Del')}
                        onClick={labelled('delete', props.onDelete)}
                    />
                </BarGroup>
            </div>
        );
        break;
    }
    case Modes.BRUSH:
    case Modes.BIT_BRUSH:
        content = (
            <div className={styles.options}>
                <Field label={f(messages.size)}>
                    <NumberField
                        max={MAX_STROKE_WIDTH}
                        min="1"
                        value={bitmap ? props.bitBrushSize : props.brushValue}
                        onSubmit={bitmap ? props.onBitBrushSliderChange : props.onBrushSliderChange}
                    />
                </Field>
                {props.mode === Modes.BRUSH ? (
                    <Field label={f(messages.smoothing)}>
                        <NumberField max={1000} min="0" value={props.simplifyValue} onSubmit={props.onSimplifySliderChange} />
                    </Field>
                ) : null}
                {brushPicker(props, f, bitmap)}
            </div>
        );
        break;
    case Modes.ERASER:
    case Modes.BIT_ERASER:
        content = (
            <div className={styles.options}>
                <Field label={f(messages.size)}>
                    <NumberField
                        max={MAX_STROKE_WIDTH}
                        min="1"
                        value={bitmap ? props.bitEraserSize : props.eraserValue}
                        onSubmit={bitmap ? props.onBitEraserSliderChange : props.onEraserSliderChange}
                    />
                </Field>
                {props.mode === Modes.ERASER ? (
                    <Field label={f(messages.smoothing)}>
                        <NumberField
                            max={1000}
                            min="0"
                            value={props.eraserSimplifyValue}
                            onSubmit={props.onEraserSimplifySliderChange}
                        />
                    </Field>
                ) : null}
                {props.mode === Modes.ERASER ? brushShapeButtons(props, f) : null}
            </div>
        );
        break;
    case Modes.PEN:
        content = (
            <div className={styles.options}>
                <Field label={f(messages.smoothing)}>
                    <NumberField max={1000} min="0" value={props.penSimplifyValue} onSubmit={props.onPenSimplifySliderChange} />
                </Field>
                {profileMenu(props, f, false)}
                {lineStyleMenu(props, f, false)}
            </div>
        );
        break;
    case Modes.BIT_LINE:
        content = (
            <Field label={f(messages.thickness)}>
                <NumberField max={MAX_STROKE_WIDTH} min="1" value={props.bitBrushSize} onSubmit={props.onBitBrushSliderChange} />
            </Field>
        );
        break;
    case Modes.RECT:
    case Modes.ROUNDED_RECT: {
        const rounded = props.mode === Modes.ROUNDED_RECT;
        content = (
            <div className={styles.options}>
                {lineStyleMenu(props, f, false)}
                <Field label={f(messages.corners)}>
                    <NumberField
                        max={1000}
                        min={0}
                        value={rounded ? props.roundedRectCornerValue : props.roundedCornerValue}
                        onSubmit={rounded ? props.onRoundedRectCornerSliderChange : props.onRoundedCornerSliderChange}
                    />
                </Field>
                <Hint>{f(messages.shapeHint)}</Hint>
            </div>
        );
        break;
    }
    case Modes.TRIANGLE:
        content = (
            <div className={styles.options}>
                <Field label={f(messages.sides)}>
                    <NumberField max={1000} min="3" value={props.trianglePolyValue} onSubmit={props.onPolyCountSliderChange} />
                </Field>
                <Field label={f(messages.spikes)}>
                    <NumberField
                        max={1000}
                        min="0"
                        step="0.1"
                        value={props.trianglePointValue}
                        onSubmit={props.onPointCountSliderChange}
                    />
                </Field>
            </div>
        );
        break;
    case Modes.SUSSY:
        content = (
            <Field label={f(messages.shape)}>
                {sussyMenu(props)}
            </Field>
        );
        break;
    case Modes.POLYGON:
        content = <Hint>{f(messages.polygonToolHint)}</Hint>;
        break;
    case Modes.LASSO_SHAPE:
        content = (
            <div className={styles.options}>
                {lassoSmoothingField(props, f)}
                <Hint>{f(messages.lassoShapeHint)}</Hint>
            </div>
        );
        break;
    case Modes.BIT_LASSO_SHAPE:
    case Modes.BIT_POLYGON:
    case Modes.BIT_RECT:
    case Modes.BIT_OVAL: {
        const isRect = props.mode !== Modes.BIT_OVAL;
        content = (
            <div className={styles.options}>
                <BarGroup>
                    <BarButton
                        active={props.fillBitmapShapes}
                        icon={isRect ? bitRectIcon : bitOvalIcon}
                        title={f(messages.filled)}
                        onClick={props.onFillShapes}
                    />
                    <BarButton
                        active={!props.fillBitmapShapes}
                        icon={isRect ? bitRectOutlinedIcon : bitOvalOutlinedIcon}
                        title={f(messages.outlined)}
                        onClick={props.onOutlineShapes}
                    />
                </BarGroup>
                <Field label={f(messages.thickness)}>
                    <span className={classNames({[styles.fieldDisabled]: props.fillBitmapShapes})}>
                        <NumberField
                            max={MAX_STROKE_WIDTH}
                            min="1"
                            value={props.bitBrushSize}
                            onSubmit={props.onBitBrushSliderChange}
                        />
                    </span>
                </Field>
                {props.mode === Modes.BIT_LASSO_SHAPE ? lassoSmoothingField(props, f) : null}
            </div>
        );
        break;
    }
    case Modes.TEXT:
    case Modes.BIT_TEXT:
        content = (
            <div className={styles.options}>
                <div className={styles.font}>
                    <FontDropdown onManageFonts={props.onManageFonts} onUpdateImage={props.onUpdateImage} />
                </div>
                <BarGroup>
                    <BarButton
                        active={props.textAlignment === 'left'}
                        icon={textAlignLeftIcon}
                        title={f(messages.leftAlign)}
                        onClick={props.onTextAlignLeft}
                    />
                    <BarButton
                        active={props.textAlignment === 'center'}
                        icon={textAlignCenterIcon}
                        title={f(messages.centerAlign)}
                        onClick={props.onTextAlignCenter}
                    />
                    <BarButton
                        active={props.textAlignment === 'right'}
                        icon={textAlignRightIcon}
                        title={f(messages.rightAlign)}
                        onClick={props.onTextAlignRight}
                    />
                </BarGroup>
            </div>
        );
        break;
    case Modes.ARROW:
        content = <Hint>{f(messages.arrowHint)}</Hint>;
        break;
    case Modes.MIRROR:
    case Modes.BIT_MIRROR:
        content = (
            <div className={styles.options}>
                <BarGroup>
                    <BarButton
                        active={props.mirrorEnabled}
                        icon={mirrorIcon}
                        title={f(props.mirrorEnabled ? messages.mirrorOn : messages.mirrorOff)}
                        onClick={() => props.onMirrorEnabled(!props.mirrorEnabled)}
                    />
                </BarGroup>
                <KaleidoscopeFields
                    f={f}
                    mirrorLines={props.mirrorLines}
                    mirrorRadial={props.mirrorRadial}
                    onMirrorEnabled={props.onMirrorEnabled}
                    onMirrorLines={props.onMirrorLines}
                    onMirrorRadial={props.onMirrorRadial}
                />
                <button
                    className={styles.textButton}
                    disabled={(!props.mirrorLines || props.mirrorLines.length === 0) &&
                        !(props.mirrorRadial && props.mirrorRadial.n > 1)}
                    onClick={() => { props.onMirrorLines([]); props.onMirrorRadial({n: 1, x: CENTER.x, y: CENTER.y}); }}
                >{f(messages.clearMirrors)}</button>
                <Hint>{f(messages.mirrorHint)}</Hint>
            </div>
        );
        break;
    case Modes.HAND:
    case Modes.BIT_HAND:
        content = <Hint>{f(messages.handHint)}</Hint>;
        break;
    case Modes.OVAL:
        content = (
            <div className={styles.options}>
                {lineStyleMenu(props, f, false)}
                <Hint>{f(messages.shapeHint)}</Hint>
            </div>
        );
        break;
    case Modes.LINE:
        content = (
            <div className={styles.options}>
                {profileMenu(props, f, false)}
                {lineStyleMenu(props, f, false)}
                <Hint>{f(messages.lineHint)}</Hint>
            </div>
        );
        break;
    case Modes.FILL:
        content = <Hint>{f(messages.fillHint)}</Hint>;
        break;
    case Modes.BIT_FILL:
        content = (
            <div className={styles.options}>
                {toleranceField(props, f)}
                <Hint>{f(messages.bitFillHint)}</Hint>
            </div>
        );
        break;
    case Modes.GRADIENT:
    case Modes.BIT_GRADIENT: {
        const radial = props.fillGradientType === 'RADIAL';
        content = (
            <div className={styles.options}>
                <BarGroup>
                    <BarButton
                        active={!radial}
                        icon={linearIcon}
                        title={f(messages.linear)}
                        onClick={() => props.onFillGradientType('HORIZONTAL')}
                    />
                    <BarButton
                        active={radial}
                        icon={radialIcon}
                        title={f(messages.radial)}
                        onClick={() => props.onFillGradientType('RADIAL')}
                    />
                </BarGroup>
                {bitmap ? (
                    <BarGroup>
                        <BarButton
                            active={!props.gradientDither}
                            icon={smoothIcon}
                            title={f(messages.smooth)}
                            onClick={() => props.onBrushOption('gradientDither', false)}
                        />
                        <BarButton
                            active={props.gradientDither}
                            icon={ditherIcon}
                            title={f(messages.dither)}
                            onClick={() => props.onBrushOption('gradientDither', true)}
                        />
                    </BarGroup>
                ) : null}
                {bitmap ? toleranceField(props, f) : null}
                <Hint>{f(bitmap ? messages.bitGradientHint : messages.gradientHint)}</Hint>
            </div>
        );
        break;
    }
    default:
        content = null;
    }
    return (
        <ScrollRow>
            <span className={styles.toolName}>{toolName}</span>
            <div className={styles.options}>{content}</div>
        </ScrollRow>
    );
};
DimodContextBarInner.propTypes = {
    alignReference: PropTypes.string,
    bitBrushSize: PropTypes.number,
    bitEraserSize: PropTypes.number,
    brushType: PropTypes.string,
    brushValue: PropTypes.number,
    clipboardItems: PropTypes.arrayOf(PropTypes.array),
    currentlySelectedShape: PropTypes.string,
    eraserSimplifyValue: PropTypes.number,
    eraserValue: PropTypes.number,
    fillBitmapShapes: PropTypes.bool,
    format: PropTypes.string,
    hasSelectedBevelLineJoin: PropTypes.bool,
    hasSelectedMiterLineJoin: PropTypes.bool,
    hasSelectedRoundEnds: PropTypes.bool,
    hasSelectedRoundLineJoin: PropTypes.bool,
    hasSelectedSquareEnds: PropTypes.bool,
    hasSelectedUncurvedPoints: PropTypes.bool,
    hasSelectedUnpointedPoints: PropTypes.bool,
    intl: PropTypes.shape({formatMessage: PropTypes.func.isRequired}).isRequired,
    mode: PropTypes.string.isRequired,
    onBevelLineJoin: PropTypes.func,
    onBitBrushSliderChange: PropTypes.func,
    onBitEraserSliderChange: PropTypes.func,
    onBrushChange: PropTypes.func,
    onBrushSliderChange: PropTypes.func,
    onCenterSelection: PropTypes.func,
    onCopyToClipboard: PropTypes.func,
    onCurvePoints: PropTypes.func,
    onCutToClipboard: PropTypes.func,
    onDelete: PropTypes.func,
    onEraserSimplifySliderChange: PropTypes.func,
    onEraserSliderChange: PropTypes.func,
    onExcludeShape: PropTypes.func,
    onFillShapes: PropTypes.func,
    onFlipHorizontal: PropTypes.func,
    onApplyLineProfile: PropTypes.func,
    lineProfile: PropTypes.string,
    lineStyle: PropTypes.object,
    onApplyLineStyle: PropTypes.func,
    lassoSmoothing: PropTypes.number,
    onRotate: PropTypes.func,
    onFlipVertical: PropTypes.func,
    onGroup: PropTypes.func,
    onManageFonts: PropTypes.func,
    onMaskShape: PropTypes.func,
    onMergeShape: PropTypes.func,
    onMiterLineJoin: PropTypes.func,
    onOutlineShapes: PropTypes.func,
    onPasteFromClipboard: PropTypes.func,
    onPenSimplifySliderChange: PropTypes.func,
    onPointCountSliderChange: PropTypes.func,
    onPointPoints: PropTypes.func,
    onPolyCountSliderChange: PropTypes.func,
    onRoundEnds: PropTypes.func,
    onRoundLineJoin: PropTypes.func,
    onRoundedCornerSliderChange: PropTypes.func,
    onRoundedRectCornerSliderChange: PropTypes.func,
    onSendBackward: PropTypes.func,
    onSendForward: PropTypes.func,
    onSendToBack: PropTypes.func,
    onSendToFront: PropTypes.func,
    onSimplifySliderChange: PropTypes.func,
    onSquareEnds: PropTypes.func,
    onSubtractShape: PropTypes.func,
    onTextAlignCenter: PropTypes.func,
    onTextAlignLeft: PropTypes.func,
    onTextAlignRight: PropTypes.func,
    onUngroup: PropTypes.func,
    onUpdateImage: PropTypes.func,
    penSimplifyValue: PropTypes.number,
    roundedCornerValue: PropTypes.number,
    roundedRectCornerValue: PropTypes.number,
    rtl: PropTypes.bool,
    selectStyle: PropTypes.string,
    selectionCount: PropTypes.number,
    onWandToleranceChange: PropTypes.func,
    wandTolerance: PropTypes.number,
    onWandMatchChange: PropTypes.func,
    wandMatch: PropTypes.string,
    simplifyValue: PropTypes.number,
    textAlignment: PropTypes.string,
    trianglePointValue: PropTypes.number,
    trianglePolyValue: PropTypes.number
};
const orderState = () => [shouldShowGroup(), shouldShowUngroup(), shouldShowBringForward(), shouldShowSendBackward()].join();
class DimodContextBar extends React.Component {
    componentDidMount () {
        this.shown = orderState();
        this.poll = setInterval(() => {
            if (orderState() !== this.shown) this.forceUpdate();
        }, 150);
    }
    componentWillUnmount () { clearInterval(this.poll); }
    render () { this.shown = orderState(); return <DimodContextBarInner {...this.props} />; }
}
export {BarBubble, BarButton, BarGroup, BubbleTile, DimodContextBar, TOOL_NAMES};
