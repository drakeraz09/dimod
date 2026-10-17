import paper from '@turbowarp/paper';
import React from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import bindAll from 'lodash.bindall';

import CopyPasteHOC from '../hocs/copy-paste-hoc.jsx';
import ModeToolsComponent from '../components/mode-tools/mode-tools.jsx';
import {clearSelectedItems, redrawSelectionBox, setSelectedItems} from '../reducers/selected-items';
import {setHistoryLabel, registerCommands, setLineProfile, setLineStyle} from '../dimod/core';
import {getRotationPivot, noteRotation} from '../dimod/pivot';
import {
    setItemSelection,
    deleteSelection,
    getSelectedLeafItems,
    getSelectedRootItems,
    getAllRootItems,
    selectAllItems,
    selectAllSegments
} from '../helper/selection';
import {HANDLE_RATIO, ensureClockwise} from '../helper/math';
import {groupItems, groupSelection, ungroupItems, ungroupSelection} from '../helper/group';
import {getRaster} from '../helper/layer';
import {flipBitmapHorizontal, flipBitmapVertical, selectAllBitmap} from '../helper/bitmap';
import {
    AlignEdges,
    AlignReferences,
    DistributeAxes,
    alignItems,
    distributeItems,
    createSymbol,
    deleteSymbol,
    detachInstance,
    getInstanceSymbolId,
    placeInstance,
    redefineSymbol,
    renameSymbol,
    setSymbolScope,
    artworkAt
} from '../dimod/items';
import {runPass, getPaintingLayer} from '../dimod/store';
import {selectSymbol, setSymbolPickerOpen, syncSymbols} from '../reducers/dimod';
import {CENTER} from '../helper/view';
import Formats, {isBitmap} from '../lib/format';
import Modes from '../lib/modes';
import {bringToFront, sendBackward, sendToBack, bringForward} from '../helper/order';
import opentype from 'opentype.js';
import {clearSelection as clearPaperSelection} from '../helper/selection';
import {getRootItem} from '../helper/item';

class ModeTools extends React.Component {
    constructor (props) {
        super(props);
        this.state = {alignReference: AlignReferences.SELECTION};
        bindAll(this, [
            'handleDuplicate',
            'handleSelectAll',
            'handleSelectAt',
            'handleGroup',
            'handleUngroup',
            'handleSendBackward',
            'handleSendForward',
            'handleSendToBack',
            'handleSendToFront',
            'handleSetSelectedItems',
            '_getSelectedUncurvedPoints',
            '_getSelectedUnpointedPoints',
            'hasSelectedUncurvedPoints',
            'hasSelectedUnpointedPoints',
            'handleCurvePoints',
            'handleFlipHorizontal',
            'handleApplyLineProfile',
            'handleApplyLineStyle',
            'handleRotate',
            'commitRotate',
            'handleFlipVertical',
            'handleCenterSelection',
            'handleAlignToSelection',
            'handleAlignToCanvas',
            'handleAlignToRotationCenter',
            'handleAlignLeftEdges',
            'handleAlignHorizontalCenters',
            'handleAlignRightEdges',
            'handleAlignTopEdges',
            'handleAlignVerticalCenters',
            'handleAlignBottomEdges',
            'handleCreateSymbol',
            'handlePlaceInstance',
            'handleDetachInstance',
            'handleRedefineSymbol',
            'handleDeleteSymbol',
            'handleRenameSymbol',
            'handleSetSymbolScope',
            'handleDistributeHorizontally',
            'handleDistributeVertically',
            'handleDelete',
            'handlePasteFromClipboard',
            'handlePointPoints',
            'handleMergeShape',
            'handleMaskShape',
            'handleSubtractShape',
            'handleExcludeShape',
            'handleRoundEnds',
            'handleSquareEnds',
            'handleMiterLineJoin',
            'handleRoundLineJoin',
            'handleBevelLineJoin'
        ]);

        // defined when merging shapes
        // stores urls for default fonts
        this._defaultCache = undefined;
    }
    _getSelectedUncurvedPoints () {
        const items = [];
        const selectedItems = getSelectedLeafItems();
        for (const item of selectedItems) {
            if (!item.segments) continue;
            for (const seg of item.segments) {
                if (seg.selected) {
                    const prev = seg.getPrevious();
                    const next = seg.getNext();
                    const isCurved =
                        (!prev || seg.handleIn.length > 0) &&
                        (!next || seg.handleOut.length > 0) &&
                        (prev && next ? seg.handleOut.isColinear(seg.handleIn) : true);
                    if (!isCurved) items.push(seg);
                }
            }
        }
        return items;
    }
    _getSelectedUnpointedPoints () {
        const points = [];
        const selectedItems = getSelectedLeafItems();
        for (const item of selectedItems) {
            if (!item.segments) continue;
            for (const seg of item.segments) {
                if (seg.selected) {
                    if (seg.handleIn.length > 0 || seg.handleOut.length > 0) {
                        points.push(seg);
                    }
                }
            }
        }
        return points;
    }
    hasSelectedUncurvedPoints () {
        const points = this._getSelectedUncurvedPoints();
        return points.length > 0;
    }
    hasSelectedUnpointedPoints () {
        const points = this._getSelectedUnpointedPoints();
        return points.length > 0;
    }
    handleCurvePoints () {
        let changed;
        const points = this._getSelectedUncurvedPoints();
        for (const point of points) {
            const prev = point.getPrevious();
            const next = point.getNext();
            const noHandles = point.handleIn.length === 0 && point.handleOut.length === 0;
            if (!prev && !next) {
                continue;
            } else if (prev && next && noHandles) {
                // Handles are parallel to the line from prev to next
                point.handleIn = prev.point.subtract(next.point)
                    .normalize()
                    .multiply(prev.getCurve().length * HANDLE_RATIO);
            } else if (prev && !next && point.handleIn.length === 0) {
                // Point is end point
                // Direction is average of normal at the point and direction to prev point, using the
                // normal that points out from the convex side
                // Lenth is curve length * HANDLE_RATIO
                const convexity = prev.getCurve().getCurvatureAtTime(.5) < 0 ? -1 : 1;
                point.handleIn = (prev.getCurve().getNormalAtTime(1)
                    .multiply(convexity)
                    .add(prev.point.subtract(point.point).normalize()))
                    .normalize()
                    .multiply(prev.getCurve().length * HANDLE_RATIO);
            } else if (next && !prev && point.handleOut.length === 0) {
                // Point is start point
                // Direction is average of normal at the point and direction to prev point, using the
                // normal that points out from the convex side
                // Lenth is curve length * HANDLE_RATIO
                const convexity = point.getCurve().getCurvatureAtTime(.5) < 0 ? -1 : 1;
                point.handleOut = (point.getCurve().getNormalAtTime(0)
                    .multiply(convexity)
                    .add(next.point.subtract(point.point).normalize()))
                    .normalize()
                    .multiply(point.getCurve().length * HANDLE_RATIO);
            }

            // Point guaranteed to have a handle now. Make the second handle match the length and direction of first.
            // This defines a curved point.
            if (point.handleIn.length > 0 && next) {
                point.handleOut = point.handleIn.multiply(-1);
            } else if (point.handleOut.length > 0 && prev) {
                point.handleIn = point.handleOut.multiply(-1);
            }
            changed = true;
        }
        if (changed) {
            this.props.setSelectedItems(this.props.format);
            this.props.onUpdateImage();
        }
    }
    handlePointPoints () {
        let changed;
        const points = this._getSelectedUnpointedPoints();
        for (const point of points) {
            const noHandles = point.handleIn.length === 0 && point.handleOut.length === 0;
            if (!noHandles) {
                point.handleIn = null;
                point.handleOut = null;
                changed = true;
            }
        }
        if (changed) {
            this.props.setSelectedItems(this.props.format);
            this.props.onUpdateImage();
        }
    }
    hasSelectedRoundEnds () {
        const selectedItems = getSelectedLeafItems();
        for (const item of selectedItems) {
            const style = item.getStyle().getStrokeCap();
            if (style === 'round') {
                return true;
            }
        }
        return false;
    }
    hasSelectedSquareEnds () {
        const selectedItems = getSelectedLeafItems();
        for (const item of selectedItems) {
            const style = item.getStyle().getStrokeCap();
            if (style !== 'round') {
                return true;
            }
        }
        return false;
    }
    handleRoundEnds () {
        let changed;
        const selectedItems = getSelectedLeafItems();
        for (const item of selectedItems) {
            const styles = item.getStyle();
            if (styles.getStrokeCap() !== 'round') {
                styles.setStrokeCap('round');
                changed = true;
            }
        }
        if (changed) {
            this.props.setSelectedItems(this.props.format);
            this.props.onUpdateImage();
        }
    }
    handleSquareEnds () {
        let changed;
        const selectedItems = getSelectedLeafItems();
        for (const item of selectedItems) {
            const styles = item.getStyle();
            console.log(styles.getStrokeCap())
            if (styles.getStrokeCap() === 'round') {
                styles.setStrokeCap('butt');
                changed = true;
            }
        }
        if (changed) {
            this.props.setSelectedItems(this.props.format);
            this.props.onUpdateImage();
        }
    }
    hasSelectedMiterLineJoins () {
        const selectedItems = getSelectedLeafItems();
        for (const item of selectedItems) {
            const style = item.getStyle().getStrokeJoin();
            if (style === 'miter') {
                return true;
            }
        }
        return false;
    }
    hasSelectedRoundLineJoins () {
        const selectedItems = getSelectedLeafItems();
        for (const item of selectedItems) {
            const style = item.getStyle().getStrokeJoin();
            if (style === 'round') {
                return true;
            }
        }
        return false;
    }
    hasSelectedBevelLineJoins () {
        const selectedItems = getSelectedLeafItems();
        for (const item of selectedItems) {
            const style = item.getStyle().getStrokeJoin();
            if (style === 'bevel') {
                return true;
            }
        }
        return false;
    }
    handleMiterLineJoin () {
        let changed;
        const selectedItems = getSelectedLeafItems();
        for (const item of selectedItems) {
            const styles = item.getStyle();
            if (styles.getStrokeJoin() !== 'miter') {
                styles.setStrokeJoin('miter');
                changed = true;
            }
        }
        if (changed) {
            this.props.setSelectedItems(this.props.format);
            this.props.onUpdateImage();
        }
    }
    handleRoundLineJoin () {
        let changed;
        const selectedItems = getSelectedLeafItems();
        for (const item of selectedItems) {
            const styles = item.getStyle();
            if (styles.getStrokeJoin() !== 'round') {
                styles.setStrokeJoin('round');
                changed = true;
            }
        }
        if (changed) {
            this.props.setSelectedItems(this.props.format);
            this.props.onUpdateImage();
        }
    }
    handleBevelLineJoin () {
        let changed;
        const selectedItems = getSelectedLeafItems();
        for (const item of selectedItems) {
            const styles = item.getStyle();
            if (styles.getStrokeJoin() !== 'bevel') {
                styles.setStrokeJoin('bevel');
                changed = true;
            }
        }
        if (changed) {
            this.props.setSelectedItems(this.props.format);
            this.props.onUpdateImage();
        }
    }

    /*
        utility funcs for 'handleMergeShape'
        convert text nodes to paths to allow merging
    */
    extractFontURL(fontName) {
        const manager = window.vm ? window.vm.runtime.fontManager : undefined;
        if (!manager) return undefined;

        const customCheck = manager.fonts.find(f => !f.system && fontName.includes(f.family));
        if (customCheck) return customCheck.asset.encodeDataURI();
        else {
            // could be a default font
            if (!this._defaultCache) {
                const defaultFontsCss = document.querySelector(`style[id="scratch-font-styles"]`).sheet;
                this._defaultCache = {};
                for (const rule of defaultFontsCss.cssRules) {
                    if (rule.type === CSSRule.FONT_FACE_RULE) {
                        const name = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
                        this._defaultCache[name] = rule.style.getPropertyValue("src")
                            .replace("url(\"", "").replace("\")", "");
                    }
                }
            }

            if (this._defaultCache[fontName]) return this._defaultCache[fontName];
            else return undefined;
        }
    }

    convertText2Path (textNode) {
        const fontURL = this.extractFontURL(textNode.font);
        return new Promise((resolve) => {
            opentype.load(fontURL, (err, font) => {
                if (err) {
                    console.warn("Font merge load error:", err);
                    resolve(undefined);
                    return;
                }

                const pathData = font.getPath(
                    textNode.content, 0, 0,
                    textNode.fontSize || 16
                ).toPathData();

                const compound = new paper.CompoundPath(pathData);
                compound.fillColor = this.fillColor || "black";
                compound.matrix = textNode.matrix.clone();
                resolve(compound);
            });
        });
    }

    async handleMergeShape (event, operation = "unite") {
        const selectedItems = getSelectedRootItems();
        if (selectedItems.length < 2) {
            // If nothing or not enough items are selected,
            // we probably shouldnt select and merge everything
            return;
        }

        // Convert possible text items to paths
        for (let i = 0; i < selectedItems.length; i++) {
            if (selectedItems[i].className === "PointText") {
                const path = await this.convertText2Path(selectedItems[i]);
                if (path) selectedItems[i] = path;
            }
        }

        let topItem = selectedItems[0];
        if (topItem.className !== "PointText" && !topItem.unite) {
            // we cant unite this item, cancel
            return;
        }

        if (typeof operation !== "string") operation = "unite";

        // unite the shapes together, creating a clone on top of the original
        let oldTopItem;
        for (let i = 1; i < selectedItems.length; i++) {
            topItem = topItem[operation](selectedItems[i]);
            if (oldTopItem) oldTopItem.remove();
            oldTopItem = topItem;
        }

        // if shift is pressed, remove the old items
        if (event.shiftKey) {
            for (const item of selectedItems) {
                item.remove();
            }
        }

        setItemSelection(topItem, true);
        this.props.onUpdateImage();
    }

    handleMaskShape (event) {
        this.handleMergeShape(event, "intersect");
    }
    handleSubtractShape (event) {
        this.handleMergeShape(event, "subtract");
    }
    handleExcludeShape (event) {
        this.handleMergeShape(event, "exclude");
    }

    _handleFlip (horizontalScale, verticalScale, selectedItems) {
        if (selectedItems.length === 0) {
            // If nothing is selected, select everything
            selectedItems = getAllRootItems();
        }
        // Record old indices
        for (const item of selectedItems) {
            item.data.index = item.index;
        }

        // Group items so that they flip as a unit
        const itemGroup = new paper.Group(selectedItems);
        // Flip
        itemGroup.scale(horizontalScale, verticalScale);
        ensureClockwise(itemGroup);

        // Remove flipped item from group and insert at old index. Must insert from bottom index up.
        for (let i = 0; i < selectedItems.length; i++) {
            itemGroup.layer.insertChild(selectedItems[i].data.index, selectedItems[i]);
            selectedItems[i].data.index = null;
        }
        itemGroup.remove();

        this.props.onUpdateImage();
    }
    handleApplyLineProfile (profile) {
        let changed = false;
        for (const item of getSelectedLeafItems()) {
            if (!(item instanceof paper.Path || item instanceof paper.CompoundPath) || !item.strokeColor) continue;
            setLineProfile(item, profile);
            changed = true;
        }
        if (changed) this.props.onUpdateImage();
    }
    handleApplyLineStyle (ls) {
        let changed = false;
        for (let item of getSelectedLeafItems()) {
            if (item.parent instanceof paper.CompoundPath) item = item.parent;
            if (!(item instanceof paper.Path || item instanceof paper.CompoundPath) || !item.strokeColor) continue;
            setLineStyle(item, ls);
            changed = true;
        }
        if (changed) this.props.onUpdateImage();
    }
    handleFlipHorizontal () {
        const selectedItems = getSelectedRootItems();
        if (isBitmap(this.props.format) && selectedItems.length === 0) {
            getRaster().canvas = flipBitmapHorizontal(getRaster().canvas);
            this.props.onUpdateImage();
        } else {
            this._handleFlip(-1, 1, selectedItems);
        }
    }
    handleFlipVertical () {
        const selectedItems = getSelectedRootItems();
        if (isBitmap(this.props.format) && selectedItems.length === 0) {
            getRaster().canvas = flipBitmapVertical(getRaster().canvas);
            this.props.onUpdateImage();
        } else {
            this._handleFlip(1, -1, selectedItems);
        }
    }
    handleCenterSelection () {
        // https://github.com/Nitro-Bolt/scratch-paint/blob/develop/src/containers/mode-tools.jsx#L203-L216
        let selectedItems = getSelectedRootItems();
        if (selectedItems.length === 0) {
            if (isBitmap(this.props.format)) {
                return;
            }
            selectedItems = getAllRootItems();
        }

        for (const item of selectedItems) {
            item.data.originalIndex = item.index;
        }

        const group = new paper.Group(selectedItems);
        group.position = new paper.Point(this.props.width, this.props.height);
        for (let i = 0; i < selectedItems.length; i++) {
            const item = selectedItems[i];
            group.layer.insertChild(item.data.originalIndex, item);
            delete item.data.originalIndex;
        }
        group.remove();

        this.props.setSelectedItems(this.props.format);
        this.props.onUpdateImage();
    }
    _align (edge) {
        let items = getSelectedRootItems();
        if (items.length === 0) items = getAllRootItems();

        if (alignItems(items, edge, this.state.alignReference)) {
            this.props.setSelectedItems(this.props.format);
            this.props.onUpdateImage();
        }
    }

    _afterSymbolChange () {
        runPass();
        this.props.onSyncSymbols();
        this.props.setSelectedItems(this.props.format);
        this.props.onUpdateImage();
    }
    handleCreateSymbol () {
        const items = getSelectedRootItems();
        if (!items.length) return;
        const created = createSymbol(`Symbol ${this.props.symbols.length + 1}`, items);
        if (!created) return;
        created.instance.selected = true;
        this.props.onSelectSymbol(created.symbol.id);
        this._afterSymbolChange();
    }
    handlePlaceInstance () {
        const symbolId = this.props.selectedSymbol;
        if (!symbolId) return;
        const layer = getPaintingLayer() || paper.project.activeLayer;
        const existing = layer.children.length;
        const offset = new paper.Point((existing % 6) * 12, (existing % 6) * 12);
        const instance = placeInstance(symbolId, CENTER.add(offset), layer);
        if (!instance) return;
        this.props.clearSelectedItems();
        instance.selected = true;
        this._afterSymbolChange();
    }
    handleDetachInstance () {
        const items = getSelectedRootItems();
        let detached = 0;
        for (const item of items) {
            if (detachInstance(item)) detached++;
        }
        if (!detached) return;
        this._afterSymbolChange();
    }
    handleRedefineSymbol () {
        const symbolId = this.props.selectedSymbol;
        const items = getSelectedRootItems();
        if (!symbolId || !items.length) return;
        const instance = redefineSymbol(symbolId, items);
        if (!instance) return;
        instance.selected = true;
        this._afterSymbolChange();
    }
    handleRenameSymbol (symbolId, name) {
        if (!renameSymbol(symbolId, name)) return;
        this.props.onSyncSymbols();
        this.props.onUpdateImage();
    }
    handleSetSymbolScope (scope) {
        const symbolId = this.props.selectedSymbol;
        if (!symbolId || !setSymbolScope(symbolId, scope)) return;
        this.props.onSyncSymbols();
        this.props.onUpdateImage();
    }
    handleDeleteSymbol () {
        const symbolId = this.props.selectedSymbol;
        if (!symbolId) return;
        deleteSymbol(symbolId);
        this._afterSymbolChange();
    }
    _distribute (axis) {
        let items = getSelectedRootItems();
        if (items.length === 0) items = getAllRootItems();

        if (distributeItems(items, axis)) {
            this.props.setSelectedItems(this.props.format);
            this.props.onUpdateImage();
        }
    }
    handleAlignToSelection () {
        this.setState({alignReference: AlignReferences.SELECTION});
    }
    handleAlignToCanvas () {
        this.setState({alignReference: AlignReferences.ART_BOARD});
    }
    handleAlignToRotationCenter () {
        this.setState({alignReference: AlignReferences.ROTATION_CENTER});
    }
    handleAlignLeftEdges () {
        this._align(AlignEdges.LEFT);
    }
    handleAlignHorizontalCenters () {
        this._align(AlignEdges.HORIZONTAL_CENTER);
    }
    handleAlignRightEdges () {
        this._align(AlignEdges.RIGHT);
    }
    handleAlignTopEdges () {
        this._align(AlignEdges.TOP);
    }
    handleAlignVerticalCenters () {
        this._align(AlignEdges.VERTICAL_CENTER);
    }
    handleAlignBottomEdges () {
        this._align(AlignEdges.BOTTOM);
    }
    handleDistributeHorizontally () {
        this._distribute(DistributeAxes.HORIZONTAL);
    }
    handleDistributeVertically () {
        this._distribute(DistributeAxes.VERTICAL);
    }
    handlePasteFromClipboard () {
        if (this.props.onPasteFromClipboard()) {
            this.props.onUpdateImage();
        }
    }
    handleDelete () {
        if (!this.props.selectedItems.length) {
            if (isBitmap(this.props.format)) {
                selectAllBitmap(this.props.clearSelectedItems);
            } else if (this.props.mode === Modes.RESHAPE) {
                selectAllSegments();
            } else {
                selectAllItems();
            }
        }
        if (deleteSelection(this.props.mode, this.props.onUpdateImage)) {
            this.props.setSelectedItems(this.props.format);
        }
    }
    componentDidMount () {
        if (this.props.contextBar) {
            this.unregisterCommands = registerCommands({
                copy: this.props.onCopyToClipboard,
                cut: this.props.onCutToClipboard,
                paste: this.handlePasteFromClipboard,
                duplicate: this.handleDuplicate,
                delete: this.handleDelete,
                flipHorizontal: this.handleFlipHorizontal,
                flipVertical: this.handleFlipVertical,
                rotate: this.handleRotate,
                center: this.handleCenterSelection,
                group: this.handleGroup,
                ungroup: this.handleUngroup,
                bringToFront: this.handleSendToFront,
                bringForward: this.handleSendForward,
                sendBackward: this.handleSendBackward,
                sendToBack: this.handleSendToBack,
                selectAll: this.handleSelectAll,
                selectAt: this.handleSelectAt
            });
        }
    }
    componentWillUnmount () {
        if (this.unregisterCommands) this.unregisterCommands();
        if (this.rotateCommit) this.commitRotate();
    }
    handleRotate (degrees, live) {
        const items = getSelectedRootItems();
        if (items.length === 0 || !degrees) return;
        const point = getRotationPivot(items);
        for (const item of items) item.rotate(degrees, point);
        noteRotation(items, point);
        this.props.redrawSelectionBox();
        clearTimeout(this.rotateCommit);
        this.rotateCommit = setTimeout(this.commitRotate, live ? 400 : 0);
    }
    commitRotate () {
        clearTimeout(this.rotateCommit);
        this.rotateCommit = null;
        setHistoryLabel('rotate');
        this.props.onUpdateImage();
    }
    handleDuplicate () {
        if (isBitmap(this.props.format)) {
            if (!getSelectedRootItems().length) return;
            this.props.onCopyToClipboard();
            this.handlePasteFromClipboard();
            return;
        }
        const items = getSelectedRootItems();
        if (!items.length) return;
        clearPaperSelection(this.props.clearSelectedItems);
        const offset = new paper.Point(10, 10);
        for (const item of items) {
            const copy = item.clone();
            copy.translate(offset);
            setItemSelection(copy, true, true );
        }
        this.props.setSelectedItems(this.props.format);
        this.props.onUpdateImage();
    }
    handleSelectAll () {
        if (isBitmap(this.props.format)) {
            selectAllBitmap(this.props.clearSelectedItems);
        } else if (this.props.mode === Modes.RESHAPE) {
            selectAllSegments();
        } else {
            selectAllItems();
        }
        this.props.setSelectedItems(this.props.format);
    }
    handleSelectAt (point) {
        if (isBitmap(this.props.format)) return false;
        const hit = artworkAt(point, {
            segments: true,
            stroke: true,
            curves: true,
            fill: true,
            guide: false,
            tolerance: 2 / paper.view.zoom
        });
        if (!hit) return false;
        const root = getRootItem(hit);
        if (!root.selected) {
            clearPaperSelection(this.props.clearSelectedItems);
            setItemSelection(root, true, true );
            this.props.setSelectedItems(this.props.format);
        }
        return true;
    }
    handleGroup () {
        groupSelection(this.props.clearSelectedItems, this.handleSetSelectedItems, this.props.onUpdateImage);
    }
    handleUngroup () {
        ungroupSelection(this.props.clearSelectedItems, this.handleSetSelectedItems, this.props.onUpdateImage);
    }
    handleSendBackward () {
        sendBackward(this.props.onUpdateImage);
    }
    handleSendForward () {
        bringForward(this.props.onUpdateImage);
    }
    handleSendToBack () {
        sendToBack(this.props.onUpdateImage);
    }
    handleSendToFront () {
        bringToFront(this.props.onUpdateImage);
    }
    handleSetSelectedItems () {
        this.props.setSelectedItems(this.props.format);
    }
    render () {
        const selectedRoots = getSelectedRootItems();
        return (
            <ModeToolsComponent
                contextBar={this.props.contextBar}
                selectionCount={selectedRoots.length}
                onGroup={this.handleGroup}
                onUngroup={this.handleUngroup}
                onSendBackward={this.handleSendBackward}
                onSendForward={this.handleSendForward}
                onSendToBack={this.handleSendToBack}
                onSendToFront={this.handleSendToFront}
                hasSelectedUncurvedPoints={this.hasSelectedUncurvedPoints()}
                hasSelectedUnpointedPoints={this.hasSelectedUnpointedPoints()}
                onCopyToClipboard={this.props.onCopyToClipboard}
                onCutToClipboard={this.props.onCutToClipboard}
                onCurvePoints={this.handleCurvePoints}
                onDelete={this.handleDelete}
                onFlipHorizontal={this.handleFlipHorizontal}
                onApplyLineProfile={this.handleApplyLineProfile}
                onApplyLineStyle={this.handleApplyLineStyle}
                onFlipVertical={this.handleFlipVertical}
                onRotate={this.handleRotate}
                onCenterSelection={this.handleCenterSelection}
                alignReference={this.state.alignReference}
                onAlignToSelection={this.handleAlignToSelection}
                onAlignToCanvas={this.handleAlignToCanvas}
                onAlignToRotationCenter={this.handleAlignToRotationCenter}
                onAlignLeftEdges={this.handleAlignLeftEdges}
                onAlignHorizontalCenters={this.handleAlignHorizontalCenters}
                onAlignRightEdges={this.handleAlignRightEdges}
                onAlignTopEdges={this.handleAlignTopEdges}
                onAlignVerticalCenters={this.handleAlignVerticalCenters}
                onAlignBottomEdges={this.handleAlignBottomEdges}
                onDistributeHorizontally={this.handleDistributeHorizontally}
                onDistributeVertically={this.handleDistributeVertically}
                onManageFonts={this.props.onManageFonts}
                onPasteFromClipboard={this.handlePasteFromClipboard}
                onPointPoints={this.handlePointPoints}
                onUpdateImage={this.props.onUpdateImage}

                hasSelectedRoundEnds={this.hasSelectedRoundEnds()}
                hasSelectedSquareEnds={this.hasSelectedSquareEnds()}
                onRoundEnds={this.handleRoundEnds}
                onSquareEnds={this.handleSquareEnds}
                hasSelectedMiterLineJoin={this.hasSelectedMiterLineJoins()}
                hasSelectedRoundLineJoin={this.hasSelectedRoundLineJoins()}
                hasSelectedBevelLineJoin={this.hasSelectedBevelLineJoins()}
                onMiterLineJoin={this.handleMiterLineJoin}
                onRoundLineJoin={this.handleRoundLineJoin}
                onBevelLineJoin={this.handleBevelLineJoin}

                symbols={this.props.symbols}
                selectedSymbol={this.props.selectedSymbol}
                hasSelectedInstance={selectedRoots.some(getInstanceSymbolId)}
                hasSelection={selectedRoots.length > 0}
                onSelectSymbol={this.props.onSelectSymbol}
                onCreateSymbol={this.handleCreateSymbol}
                onPlaceInstance={this.handlePlaceInstance}
                onDetachInstance={this.handleDetachInstance}
                onRedefineSymbol={this.handleRedefineSymbol}
                onRenameSymbol={this.handleRenameSymbol}
                onSetSymbolScope={this.handleSetSymbolScope}
                onOpenPicker={this.props.onOpenSymbolPicker}
                onDeleteSymbol={this.handleDeleteSymbol}

                onMergeShape={this.handleMergeShape}
                onMaskShape={this.handleMaskShape}
                onSubtractShape={this.handleSubtractShape}
                onExcludeShape={this.handleExcludeShape}
            />
        );
    }
}

ModeTools.propTypes = {
    contextBar: PropTypes.bool,
    clearSelectedItems: PropTypes.func.isRequired,
    format: PropTypes.oneOf(Object.keys(Formats)),
    mode: PropTypes.oneOf(Object.keys(Modes)),
    onCopyToClipboard: PropTypes.func.isRequired,
    onCutToClipboard: PropTypes.func.isRequired,
    onManageFonts: PropTypes.func,
    onPasteFromClipboard: PropTypes.func.isRequired,
    onOpenSymbolPicker: PropTypes.func.isRequired,
    onSelectSymbol: PropTypes.func.isRequired,
    onSyncSymbols: PropTypes.func.isRequired,
    onUpdateImage: PropTypes.func.isRequired,
    redrawSelectionBox: PropTypes.func.isRequired,
    selectedSymbol: PropTypes.string,
    symbols: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string.isRequired,
        name: PropTypes.string.isRequired
    })).isRequired,
    width: PropTypes.number,
    height: PropTypes.number,
    // Listen on selected items to update hasSelectedPoints
    selectedItems:
        PropTypes.arrayOf(PropTypes.instanceOf(paper.Item)), // eslint-disable-line react/no-unused-prop-types
    setSelectedItems: PropTypes.func.isRequired
};

const mapStateToProps = state => ({
    format: state.scratchPaint.format,
    mode: state.scratchPaint.mode,
    selectedItems: state.scratchPaint.selectedItems,
    undoState: state.scratchPaint.undo,
    selectedSymbol: state.scratchPaint.dimodSymbols.selected,
    symbols: state.scratchPaint.dimodSymbols.symbols
});
const mapDispatchToProps = dispatch => ({
    redrawSelectionBox: () => dispatch(redrawSelectionBox()),
    clearSelectedItems: () => {
        dispatch(clearSelectedItems());
    },
    setSelectedItems: format => {
        dispatch(setSelectedItems(getSelectedLeafItems(), isBitmap(format)));
    },
    onSelectSymbol: symbolId => {
        dispatch(selectSymbol(symbolId));
    },
    onSyncSymbols: () => {
        dispatch(syncSymbols());
    },
    onOpenSymbolPicker: () => {
        dispatch(setSymbolPickerOpen(true));
    }
});

export default CopyPasteHOC(connect(
    mapStateToProps,
    mapDispatchToProps
)(ModeTools));
