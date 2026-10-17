import paper from '@turbowarp/paper';
import keyMirror from 'keymirror';

import {getSelectedRootItems} from '../selection';
import {SELECTION_STROKE_WIDTH, getGuideColor, removeBoundsPath, removeBoundsHandles} from '../guides';
import {getGuideLayer, setGuideItem} from '../layer';

import Cursors from '../../lib/cursors';
import Modes, {BitmapModes} from '../../lib/modes';
import ScaleTool from './scale-tool';
import RotateTool from './rotate-tool';
import MoveTool from './move-tool';
import {PivotTool, drawPivotHandle, drawPivotDragOverlay} from '../tools/dimod-tools';
import {getEffectiveSelectionPivot} from '../../dimod/pivot';
import {LIVETEST} from '../../lib/dimod-flags';
import {getPaintOptions} from '../../dimod/core';

/** SVG for the rotation icon on the bounding box */
const ARROW_PATH = 'M19.28,1.09C19.28.28,19,0,18.2,0c-1.67,0-3.34,0-5,0-.34,0-.88.24-1,.47a1.4,1.4,' +
    '0,0,0,.36,1.08,15.27,15.27,0,0,0,1.46,1.36A6.4,6.4,0,0,1,6.52,4,5.85,5.85,0,0,1,5.24,3,15.27,15.27,' +
    '0,0,0,6.7,1.61,1.4,1.4,0,0,0,7.06.54C7,.3,6.44.07,6.1.06c-1.67,0-3.34,0-5,0C.28,0,0,.31,0,1.12c0,1.67,' +
    '0,3.34,0,5a1.23,1.23,0,0,0,.49,1,1.22,1.22,0,0,0,1-.31A14.38,14.38,0,0,0,2.84,5.26l.73.62a9.45,9.45,' +
    '0,0,0,7.34,2,9.45,9.45,0,0,0,4.82-2.05l.73-.62a14.38,14.38,0,0,0,1.29,1.51,1.22,1.22,' +
    '0,0,0,1,.31,1.23,1.23,0,0,0,.49-1C19.31,4.43,19.29,2.76,19.28,1.09Z';
/** Modes of the bounding box tool, which can do many things depending on how it's used. */
const SMALL_ART = 48;
const SMALL_ART_PIVOT_RADIUS = 12;
const CORNER_ROTATE_REACH = 22;
const SCALE_GRAB_RADIUS = 9;

const BoundingBoxModes = keyMirror({
    SCALE: null,
    ROTATE: null,
    MOVE: null,
    PIVOT: null
});

/**
 * Tool that handles transforming the selection and drawing a bounding box with handles.
 * On mouse down, the type of function (move, scale, rotate) is determined based on what is clicked
 * (scale handle, rotate handle, the object itself). This determines the mode of the tool, which then
 * delegates actions to the MoveTool, RotateTool or ScaleTool accordingly.
 * @param {!function} onUpdateImage A callback to call when the image visibly changes
 */
class BoundingBoxTool {
    /**
     * @param {Modes} mode Paint editor mode
     * @param {function} setSelectedItems Callback to set the set of selected items in the Redux state
     * @param {function} clearSelectedItems Callback to clear the set of selected items in the Redux state
     * @param {function} setCursor Callback to set the visible mouse cursor
     * @param {!function} onUpdateImage A callback to call when the image visibly changes
     * @param {?function} switchToTextTool A callback to call to switch to the text tool
     */
    constructor (mode, setSelectedItems, clearSelectedItems, setCursor, onUpdateImage, switchToTextTool) {
        this.dispatchSetCursor = setCursor;
        this.onUpdateImage = onUpdateImage;
        this.paintMode = mode;
        this.mode = null;
        this.boundsPath = null;
        this.boundsScaleHandles = [];
        this.boundsRotHandles = [];
        this.pivotHandle = null;
        this._modeMap = {};
        this._modeMap[BoundingBoxModes.SCALE] = new ScaleTool(mode, onUpdateImage);
        this._modeMap[BoundingBoxModes.ROTATE] = new RotateTool(onUpdateImage);
        this._modeMap[BoundingBoxModes.MOVE] =
            new MoveTool(mode, setSelectedItems, clearSelectedItems, onUpdateImage, switchToTextTool);
        this._modeMap[BoundingBoxModes.PIVOT] = new PivotTool(onUpdateImage);
        this._currentCursor = null;
    }

    /**
     * Should be called if the selection changes to update the bounds of the bounding box.
     * @param {?Array<paper.Item>} selectedItems Array of selected items.
     */
    onSelectionChanged (selectedItems) {
        if (selectedItems && selectedItems.length) {
            this.setSelectionBounds();
        } else {
            this.removeBoundsPath();
        }
    }

    /**
     * @param {!MouseEvent} event The mouse event
     * @param {boolean} clone Whether to clone on mouse down (e.g. alt key held)
     * @param {boolean} multiselect Whether to multiselect on mouse down (e.g. shift key held)
     * @param {?boolean} doubleClicked True if this is the second click in a short amout of time
     * @param {paper.hitOptions} hitOptions The options with which to detect whether mouse down has hit
     *     anything editable
     * @return {boolean} True if there was a hit, false otherwise
     */
    onMouseDown (event, clone, multiselect, doubleClicked, hitOptions) {
        if (event.event.button > 0) return; // only first mouse button
        const {hitResult, mode} = this._determineMode(event, multiselect, hitOptions);
        if (!hitResult) {
            if (!multiselect) {
                this.removeBoundsPath();
            }
            return false;
        }
        this.mode = mode;

        const hitProperties = {
            hitResult: hitResult,
            clone: clone,
            multiselect: multiselect,
            doubleClicked: doubleClicked && !hitResult.insideBounds
        };
        if (this.mode === BoundingBoxModes.MOVE) {
            this._modeMap[this.mode].onMouseDown(hitProperties);
            this.removeBoundsHandles();
        } else if (this.mode === BoundingBoxModes.SCALE) {
            this._modeMap[this.mode].onMouseDown(hitResult, this.boundsPath, getSelectedRootItems());
            this.removeBoundsHandles();
        } else if (this.mode === BoundingBoxModes.ROTATE) {
            this.setCursor(Cursors.ROTATE);
            this._modeMap[this.mode].onMouseDown(
                hitResult, this.boundsPath, getSelectedRootItems(), event.point);
            // While transforming, don't show bounds
            this.removeBoundsPath();
        } else if (this.mode === BoundingBoxModes.PIVOT) {
            this.setCursor(Cursors.GRABBING);
            this._modeMap[this.mode].onMouseDown(
                hitResult, getSelectedRootItems(), doubleClicked, this.pivotHandle);
        }

        return true;
    }
    _buildRotHandle (point, distance, angle) {
        const offset = new paper.Point(0, distance);
        const arrows = new paper.Path(ARROW_PATH);
        arrows.translate(point.add(offset).add(-10.5, -5));
        const line = new paper.Path.Rectangle(point.add(offset).subtract(1, 0), point);
        const rotHandle = arrows.unite(line);
        line.remove();
        arrows.remove();
        const data = {
            offset: offset,
            isRotHandle: true,
            isHelperItem: true,
            noSelect: true,
            noHover: true
        };
        rotHandle.data = Object.assign({}, data);
        rotHandle.fillColor = getGuideColor();
        const ink = rotHandle.clone({insert: false});
        ink.fillColor = null;
        ink.strokeColor = 'black';
        ink.strokeWidth = 2.5;
        ink.strokeJoin = 'round';
        ink.data = {};
        ink.locked = true;
        const grab = new paper.Path.Circle({
            center: point.add(offset),
            radius: 20,
            fillColor: new paper.Color(1, 1, 1, 0.01),
            data: Object.assign({}, data)
        });
        const group = new paper.Group([ink, rotHandle, grab]);
        group.data = Object.assign({}, data);
        group.scale(1 / paper.view.zoom, point);
        group.rotate(angle - 90, point);
        group.parent = getGuideLayer();
        return group;
    }
    _placeRotHandle (point, distance, angle) {
        const old = this.boundsRotHandles[7];
        if (old) old.remove();
        this.boundsRotHandles[7] = this._buildRotHandle(point, distance, angle);
        if (this.pivotHandle && this.pivotHandle.bringToFront) this.pivotHandle.bringToFront();
    }
    _followRotHandle (event) {
        if (this.mode || !this.boundsRect || !this.boundsRotHandles[7]) return;
        const options = getPaintOptions();
        if (!options.rotFollow) return;
        const local = this.localAngle && this.boundsPath && this.boundsPath.data.local;
        if (this.localAngle && !local) return;
        const bounds = local ? local.rect : this.boundsRect.bounds;
        const turn = local ? local.a : 0;
        const pivot = local ? local.c : null;
        const toLocal = pt => (local ? pt.rotate(-turn, pivot) : pt);
        const toWorld = pt => (local ? pt.rotate(turn, pivot) : pt);
        const zoom = paper.view.zoom;
        const p = toLocal(event.point);
        const edge = new paper.Point(
            Math.min(Math.max(p.x, bounds.left), bounds.right),
            Math.min(Math.max(p.y, bounds.top), bounds.bottom));
        const distance = edge.getDistance(p) * zoom;
        if (distance < Math.max(1, options.rotStart) || distance > options.rotReach) {
            if (this._rotAt) {
                this._rotAt = null;
                this._placeRotHandle(this.boundsRect.segments[3].point, 20, turn - 90);
            }
            return;
        }
        const anchors = [bounds.topLeft, bounds.topRight, bounds.bottomLeft, bounds.bottomRight,
            bounds.topCenter, bounds.bottomCenter, bounds.leftCenter, bounds.rightCenter];
        let anchor = null;
        for (const candidate of anchors) {
            const gap = candidate.getDistance(edge) * zoom;
            if (gap < 30 && (!anchor || gap < anchor.gap)) anchor = {point: candidate, gap};
        }
        if (anchor) {
            const snapped = anchor.point.subtract(bounds.center).angle + turn;
            const at = this._rotAt;
            const world = toWorld(anchor.point);
            if (at && at.point.getDistance(world) * zoom < 1 && Math.abs(at.angle - snapped) < 2) return;
            this._rotAt = {point: world, angle: snapped};
            this._placeRotHandle(world, 22, snapped);
            return;
        }
        const angle = p.subtract(edge).angle + turn;
        const at = this._rotAt;
        const world = toWorld(edge);
        if (at && at.point.getDistance(world) * zoom < 1 && Math.abs(at.angle - angle) < 2) return;
        this._rotAt = {point: world, angle};
        this._placeRotHandle(world, Math.min(Math.max(distance, 14), 30), angle);
    }
    onMouseMove (event, hitOptions) {
        this._followRotHandle(event);
        this._updateCursor(event, hitOptions);
    }
    _updateCursor (event, hitOptions) {
        const {mode, hitResult} = this._determineMode(event, false, hitOptions);
        if (hitResult) {
            if (mode === BoundingBoxModes.MOVE) {
                this.setCursor(Cursors.DEFAULT);
            } else if (mode === BoundingBoxModes.PIVOT) {
                this.setCursor(Cursors.GRAB);
            } else if (mode === BoundingBoxModes.ROTATE) {
                this.setCursor(Cursors.ROTATE);
            } else if (mode === BoundingBoxModes.SCALE) {
                this.setSelectionBounds();
                if (this._impreciseEqual(hitResult.item.position.x, this.boundsPath.position.x)) {
                    this.setCursor(Cursors.RESIZE_NS);
                } else if (this._impreciseEqual(hitResult.item.position.y, this.boundsPath.position.y)) {
                    this.setCursor(Cursors.RESIZE_EW);
                } else if (
                    hitResult.item.position.equals(this.boundsPath.bounds.bottomLeft) ||
                    hitResult.item.position.equals(this.boundsPath.bounds.topRight)
                ) {
                    this.setCursor(Cursors.RESIZE_NESW);
                } else {
                    this.setCursor(Cursors.RESIZE_NWSE);
                }
            }
        } else {
            this.setCursor(Cursors.DEFAULT);
        }
    }
    _impreciseEqual (a, b) {
        // This is the same math paper.js uses to check if two numbers are "equal".
        return Math.abs(a - b) < 1e-8;
    }
    _determineMode (event, multiselect, hitOptions) {
        const hitResults = paper.project.hitTestAll(event.point, hitOptions);

        let mode;

        let hitResult = hitResults[0];
        let pivotHitResult = null;
        for (let i = 0; i < hitResults.length; i++) {
            if (hitResults[i].item.data && hitResults[i].item.data.isScaleHandle) {
                hitResult = hitResults[i];
                mode = BoundingBoxModes.SCALE;
                break;
            } else if (hitResults[i].item.data && hitResults[i].item.data.isRotHandle) {
                hitResult = hitResults[i];
                mode = BoundingBoxModes.ROTATE;
            } else if (hitResults[i].item.data && hitResults[i].item.data.isPivotHandle) {
                pivotHitResult = hitResults[i];
            }
        }
        if (!mode && pivotHitResult) {
            const forceObject = event.modifiers && (event.modifiers.control || event.modifiers.meta);
            const artHit = hitResults.find(r => r.item.layer && r.item.layer.data.isPaintingLayer);
            const fromCentre = event.point.getDistance(pivotHitResult.item.bounds.center) * paper.view.zoom;
            const artSize = artHit ?
                Math.max(artHit.item.bounds.width, artHit.item.bounds.height) * paper.view.zoom : 0;
            const pivotWins = artSize >= SMALL_ART || fromCentre <= SMALL_ART_PIVOT_RADIUS;
            if (artHit && (forceObject || !pivotWins)) {
                hitResult = artHit;
            } else {
                hitResult = pivotHitResult;
                mode = BoundingBoxModes.PIVOT;
            }
        }
        if (!mode && this.boundsRect && !this.localAngle &&
                (this.paintMode === Modes.SELECT || this.paintMode === Modes.BIT_SELECT)) {
            const p = event.point;
            const zoom = paper.view.zoom;
            const inside = this.boundsRect.contains(p);
            const items = getSelectedRootItems();
            if (!hitResult && inside && !multiselect && items.length) {
                hitResult = {item: items[0], type: 'fill', point: p, insideBounds: true};
            } else if (!inside && (!hitResult || !hitResult.item.layer || !hitResult.item.layer.data.isPaintingLayer)) {
                const b = this.boundsRect.bounds;
                const near = [b.topLeft, b.topRight, b.bottomLeft, b.bottomRight]
                    .some(c => c.getDistance(p) * zoom <= CORNER_ROTATE_REACH);
                if (near) {
                    hitResult = {item: this.boundsRect, type: 'rotate-zone', point: p};
                    mode = BoundingBoxModes.ROTATE;
                }
            }
        }
        if (!mode) {
            mode = BoundingBoxModes.MOVE;
        }

        return {mode, hitResult};
    }
    onMouseDrag (event) {
        if (event.event.button > 0 || !this.mode) return; // only first mouse button
        this._modeMap[this.mode].onMouseDrag(event);
        if (this.mode !== BoundingBoxModes.PIVOT) this._drawDragMarks(event);

        // Set the cursor for moving a sprite once the drag has actually started (i.e. the mouse has been moved while
        // pressed), so that the mouse doesn't "flash" to the grabbing cursor every time a sprite is clicked.
        if (this.mode === BoundingBoxModes.MOVE) {
            this.setCursor(Cursors.GRABBING);
        }
    }
    onMouseUp (event, hitOptions) {
        if (event.event.button > 0 || !this.mode) return; // only first mouse button
        this._modeMap[this.mode].onMouseUp(event);
        this._removeDragMarks();

        // After transforming, show bounds again
        this.setSelectionBounds();
        this.mode = null;
        this._updateCursor(event, hitOptions);
    }
    _drawDragMarks (event) {
        this._removeDragMarks();
        const items = getSelectedRootItems();
        const pivot = items.length && getEffectiveSelectionPivot(items);
        if (!pivot) return;
        this.dragMarks = [
            drawPivotDragOverlay(items, pivot, false),
            drawPivotHandle(items, false),
            event && this._drawReadout(items, event.point)
        ].filter(Boolean);
    }
    _drawReadout (items, point) {
        let text;
        if (this.mode === BoundingBoxModes.ROTATE) {
            const tool = this._modeMap[this.mode];
            const turned = ((((tool.prevRot - tool.startRot + 180) % 360) + 360) % 360) - 180;
            text = `${Math.round(turned)}°`;
        } else if (this.mode === BoundingBoxModes.SCALE) {
            let r = null;
            for (const item of items) r = r ? r.unite(item.bounds) : item.bounds;
            const unit = this.paintMode in BitmapModes ? 0.5 : 1;
            text = `${Math.round(r.width * unit)} × ${Math.round(r.height * unit)}`;
        } else {
            return null;
        }
        const zoom = paper.view.zoom;
        const label = new paper.PointText({
            point: point.add(new paper.Point(16, 30).divide(zoom)),
            content: text,
            fillColor: 'white',
            fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif',
            fontSize: 11 / zoom,
            fontWeight: 'bold'
        });
        const pill = new paper.Path.Rectangle({
            rectangle: label.bounds.expand(10 / zoom, 6 / zoom),
            radius: 4 / zoom,
            fillColor: getGuideColor()
        });
        const group = new paper.Group([pill, label]);
        group.data = {isHelperItem: true, noSelect: true, noHover: true};
        group.parent = getGuideLayer();
        return group;
    }
    _removeDragMarks () {
        if (this.dragMarks) this.dragMarks.forEach(mark => mark.remove());
        this.dragMarks = null;
    }
    setSelectionBounds () {
        this.removeBoundsPath();

        const items = getSelectedRootItems();
        if (items.length <= 0) return;

        let rect = null;
        for (const item of items) {
            if (item instanceof paper.Raster && item.loaded === false) {
                item.onLoad = this.setSelectionBounds.bind(this);
                return;
            }

            if (rect) {
                rect = rect.unite(item.bounds);
            } else {
                rect = item.bounds;
            }
        }

        const angles = items.map(item => item.data.dimodAngle || 0);
        const a = getPaintOptions().localGizmo && Math.abs(angles[0]) > 0.01 &&
            angles.every(x => Math.abs(x - angles[0]) < 0.5) ? angles[0] : 0;
        let local = null;
        if (a) {
            const c = rect.center;
            let lr = null;
            for (const item of items) {
                const copy = item.clone({insert: false});
                copy.rotate(-a, c);
                lr = lr ? lr.unite(copy.bounds) : copy.bounds;
                copy.remove();
            }
            local = {a, c, rect: lr};
            rect = lr;
        }
        if (!this.boundsPath) {
            this.boundsPath = new paper.Group();
            this.boundsRect = paper.Path.Rectangle(rect);
            this.boundsRect.curves[0].divideAtTime(0.5);
            this.boundsRect.curves[2].divideAtTime(0.5);
            this.boundsRect.curves[4].divideAtTime(0.5);
            this.boundsRect.curves[6].divideAtTime(0.5);
            if (local) this.boundsRect.rotate(local.a, local.c);
            this.boundsInk = this.boundsRect.clone({insert: false});
            this.boundsInk.locked = true;
            this.boundsPath.addChild(this.boundsInk);
            this.boundsPath.addChild(this.boundsRect);
            this._modeMap[BoundingBoxModes.MOVE].setBoundsPath(this.boundsPath);
        }
        setGuideItem(this.boundsPath);
        this.boundsPath.data.isSelectionBound = true;
        this.boundsPath.data.local = local;
        this.localAngle = local ? local.a : 0;
        this.boundsPath.data.isHelperItem = true;
        this.boundsPath.fillColor = null;
        this.boundsPath.parent = getGuideLayer();
        this.boundsPath.strokeWidth = SELECTION_STROKE_WIDTH / paper.view.zoom;
        this.boundsPath.strokeColor = getGuideColor();
        if (this.boundsInk) {
            this.boundsInk.strokeColor = 'black';
            this.boundsInk.strokeWidth = (SELECTION_STROKE_WIDTH + 2) / paper.view.zoom;
        }

        // Make a template to copy
        const boundsScaleCircleShadow =
            new paper.Path.Circle({
                center: new paper.Point(0, 0),
                radius: 5.5 / paper.view.zoom,
                fillColor: 'black',
                data: {
                    isHelperItem: true,
                    noSelect: true,
                    noHover: true
                }
            });
        const boundsScaleCircle =
            new paper.Path.Circle({
                center: new paper.Point(0, 0),
                radius: 4 / paper.view.zoom,
                fillColor: getGuideColor(),
                data: {
                    isScaleHandle: true,
                    isHelperItem: true,
                    noSelect: true,
                    noHover: true
                }
            });
        const boundsScaleGrab =
            new paper.Path.Circle({
                center: new paper.Point(0, 0),
                radius: SCALE_GRAB_RADIUS / paper.view.zoom,
                fillColor: new paper.Color(1, 1, 1, 0.01),
                data: {
                    isScaleHandle: true,
                    isHelperItem: true,
                    noSelect: true,
                    noHover: true
                }
            });
        const boundsScaleHandle = new paper.Group([boundsScaleGrab, boundsScaleCircleShadow, boundsScaleCircle]);
        boundsScaleHandle.parent = getGuideLayer();

        for (let index = 0; index < this.boundsRect.segments.length; index++) {
            const segment = this.boundsRect.segments[index];

            if (index === 3) {
                this._rotAt = null;
                this.boundsRotHandles[7] = this._buildRotHandle(segment.point, 20, (local ? local.a : 0) - 90);
            }

            this.boundsScaleHandles[index] = boundsScaleHandle.clone();
            this.boundsScaleHandles[index].position = segment.point;
            for (const child of this.boundsScaleHandles[index].children) {
                child.data.index = index;
            }
            this.boundsScaleHandles[index].data = {
                index: index,
                isScaleHandle: true,
                isHelperItem: true,
                noSelect: true,
                noHover: true
            };
        }
        // Remove the template
        boundsScaleHandle.remove();

        this.pivotHandle = drawPivotHandle(items, LIVETEST || !(this.paintMode in BitmapModes));
    }
    removeBoundsPath () {
        removeBoundsPath();
        this.boundsPath = null;
        this.boundsRect = null;
        this.boundsInk = null;
        this.boundsScaleHandles.length = 0;
        this.boundsRotHandles.length = 0;
        this.pivotHandle = null;
        this._rotAt = null;
        this.localAngle = 0;
    }
    removeBoundsHandles () {
        removeBoundsHandles();
        this.boundsScaleHandles.length = 0;
        this.boundsRotHandles.length = 0;
        this.pivotHandle = null;
    }
    deactivateTool () {
        this.removeBoundsPath();
        this.setCursor(Cursors.DEFAULT);
    }

    setCursor (cursorString) {
        if (this._currentCursor !== cursorString) {
            this.dispatchSetCursor(cursorString);
            this._currentCursor = cursorString;
        }
    }
}

export default BoundingBoxTool;
