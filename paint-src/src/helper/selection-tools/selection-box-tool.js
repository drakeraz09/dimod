import paper from '@turbowarp/paper';
import {rectSelect, styleSelectionGuide} from '../guides';
import Modes from '../../lib/modes';
import {
    SelectStyles,
    extendLasso,
    getSelectStyle,
    getWandTolerance,
    liftBitmapSelection,
    maskFromLasso,
    maskFromWand,
    startLasso
} from '../../dimod/items';
import {clearSelection, processRectangularSelection} from '../selection';
import {getRaster} from '../layer';
import {ART_BOARD_WIDTH, ART_BOARD_HEIGHT} from '../view';
import {getHitBounds} from '../../helper/bitmap';
import {isPaintSuspended} from '../../lib/dimod-flags';

class SelectionBoxTool {
    /**
     * @param {!Modes} mode Current paint editor mode
     * @param {function} setSelectedItems Callback to set the set of selected items in the Redux state
     * @param {function} clearSelectedItems Callback to clear the set of selected items in the Redux state
     */
    constructor (mode, setSelectedItems, clearSelectedItems) {
        this.selectionRect = null;
        this.mode = mode;
        this.setSelectedItems = setSelectedItems;
        this.clearSelectedItems = clearSelectedItems;
        this.polygon = null;
        this.handlePolygonKey = this.handlePolygonKey.bind(this);
    }
    isBusy () {
        return Boolean(this.polygon);
    }
    onMouseDown (multiselect, event) {
        if (this.polygon) {
            this.addPolygonCorner(event);
            return;
        }
        this.style = getSelectStyle();
        if (this.style === SelectStyles.WAND && this.mode === Modes.RESHAPE) this.style = SelectStyles.BOX;
        if (!multiselect) {
            clearSelection(this.clearSelectedItems);
            this.clearSelectedItems();
        }
        if (this.style === SelectStyles.POLYGON && event) this.startPolygon(event, multiselect);
    }
    startPolygon (event, multiselect) {
        this.polygon = new paper.Path({segments: [event.point, event.point]});
        styleSelectionGuide(this.polygon);
        this.polygon.closed = false;
        this.polygon.data.isLassoSelect = true;
        this.polygonMultiselect = multiselect;
        this.lastCorner = {time: Date.now(), point: event.point};
        document.addEventListener('keydown', this.handlePolygonKey, true);
    }
    addPolygonCorner (event) {
        const point = event.point;
        const corners = this.polygon.segments.length - 1;
        const first = this.polygon.firstSegment.point;
        const near = (a, b, px) => a.getDistance(b) * paper.view.zoom < px;
        const doubleClick = Date.now() - this.lastCorner.time < 350 && near(point, this.lastCorner.point, 6);
        if ((corners >= 3 && near(point, first, 9)) || (doubleClick && corners >= 3)) {
            this.finishPolygon();
            return;
        }
        if (doubleClick) return;
        this.polygon.lastSegment.point = point;
        this.polygon.add(point);
        this.lastCorner = {time: Date.now(), point};
    }
    onMouseMove (event) {
        if (this.polygon) this.polygon.lastSegment.point = event.point;
    }
    handlePolygonKey (event) {
        if (!this.polygon || isPaintSuspended()) return;
        if (event.key === 'Escape') {
            this.cancel();
        } else if (event.key === 'Enter') {
            this.finishPolygon();
        } else if (event.key === 'Backspace' || event.key === 'Delete') {
            if (this.polygon.segments.length > 2) this.polygon.removeSegment(this.polygon.segments.length - 2);
            else this.cancel();
        } else {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    }
    finishPolygon () {
        const path = this.polygon;
        this.detachPolygon();
        path.lastSegment.remove();
        path.closed = true;
        if (path.segments.length >= 3) {
            if (this.mode === Modes.BIT_SELECT) {
                if (liftBitmapSelection(maskFromLasso(path))) this.setSelectedItems();
            } else {
                processRectangularSelection({modifiers: {shift: this.polygonMultiselect}}, path, this.mode);
                this.setSelectedItems();
            }
        }
        path.remove();
    }
    detachPolygon () {
        document.removeEventListener('keydown', this.handlePolygonKey, true);
        this.polygon = null;
    }
    cancel () {
        if (this.polygon) {
            this.polygon.remove();
            this.detachPolygon();
        }
        if (this.selectionRect) {
            this.selectionRect.remove();
            this.selectionRect = null;
        }
    }
    onMouseDrag (event) {
        if (event.event.button > 0) return; // only first mouse button
        if (this.polygon) {
            this.onMouseMove(event);
            return;
        }
        if (this.style === SelectStyles.WAND || this.style === SelectStyles.POLYGON) return;
        if (this.style === SelectStyles.LASSO) {
            if (!this.selectionRect) this.selectionRect = startLasso(event.downPoint, styleSelectionGuide);
            extendLasso(this.selectionRect, event.point);
            return;
        }
        if (this.selectionRect) {
            this.selectionRect.remove();
        }
        this.selectionRect = rectSelect(event);
        if (this.mode === Modes.BIT_SELECT) {
            this.selectionRect.bounds = new paper.Rectangle(event.downPoint.round(), event.point.round());
        }
    }
    onMouseUpVector (event) {
        if (event.event.button > 0) return; // only first mouse button
        if (this.style === SelectStyles.POLYGON) return;
        if (this.selectionRect) {
            processRectangularSelection(event, this.selectionRect, this.mode);
            this.selectionRect.remove();
            this.selectionRect = null;
            this.setSelectedItems();
        }
    }
    onMouseUpBitmap (event) {
        if (event.event.button > 0) return; // only first mouse button
        if (this.style === SelectStyles.POLYGON) return;
        if (this.style === SelectStyles.WAND || this.style === SelectStyles.LASSO) {
            const mask = this.style === SelectStyles.WAND ?
                maskFromWand(event.point.x, event.point.y, getWandTolerance()) :
                this.selectionRect && maskFromLasso(this.selectionRect);
            if (mask && liftBitmapSelection(mask)) this.setSelectedItems();
            if (this.selectionRect) this.selectionRect.remove();
            this.selectionRect = null;
            return;
        }
        if (this.selectionRect) {
            let rect = new paper.Rectangle({
                from: new paper.Point(
                    Math.max(0, Math.round(this.selectionRect.bounds.topLeft.x)),
                    Math.max(0, Math.round(this.selectionRect.bounds.topLeft.y))),
                to: new paper.Point(
                    Math.min(ART_BOARD_WIDTH, Math.round(this.selectionRect.bounds.bottomRight.x)),
                    Math.min(ART_BOARD_HEIGHT, Math.round(this.selectionRect.bounds.bottomRight.y)))
            });

            // Trim/tighten selection bounds inwards to only the opaque region, excluding transparent pixels
            rect = getHitBounds(getRaster(), rect);

            if (rect.area) {
                // Pull selected raster to active layer
                const raster = getRaster().getSubRaster(rect);
                raster.parent = paper.project.activeLayer;
                raster.canvas.getContext('2d').imageSmoothingEnabled = false;
                raster.selected = true;
                // Gather a bit of extra data so that we can avoid aliasing at edges
                const expanded = getRaster().getSubRaster(rect.expand(4));
                expanded.remove();
                raster.data = {expanded: expanded};

                // Clear area from raster layer
                const context = getRaster().getContext(true /* modify */);
                context.clearRect(rect.x, rect.y, rect.width, rect.height);
                this.setSelectedItems();
            }

            // Remove dotted rectangle
            this.selectionRect.remove();
            this.selectionRect = null;
        }
    }
}

export default SelectionBoxTool;
