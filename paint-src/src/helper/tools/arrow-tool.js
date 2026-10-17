import paper from '@turbowarp/paper';
import Modes from '../../lib/modes';
import { styleShape } from '../style-path';
import { clearSelection } from '../selection';
import BoundingBoxTool from '../selection-tools/bounding-box-tool';
import NudgeTool from '../selection-tools/nudge-tool';

const arrowPoints = (len, shaft, headW, headL, double) => {
    const fit = Math.min(1, len / (headL * (double ? 3 : 2)));
    shaft *= fit;
    headW *= fit;
    headL *= fit;
    const hl = Math.min(headL, len * (double ? 0.45 : 0.8));
    const hw = Math.max(headW * (hl / Math.max(headL, 1e-6)), shaft);
    const t = shaft / 2, w = hw / 2;
    const right = [[len - hl, -t], [len - hl, -w], [len, 0], [len - hl, w], [len - hl, t]];
    const left = double ? [[hl, t], [hl, w], [0, 0], [hl, -w], [hl, -t]] : [[0, t], [0, -t]];
    return right.concat(left);
};
const last = {shaft: 20, headW: 60, headL: 50};

/**
 * Tool for drawing arrows.
 */
class ArrowTool extends paper.Tool {
    static get TOLERANCE() {
        return 2;
    }
    /**
     * @param {function} setSelectedItems Callback to set the set of selected items in the Redux state
     * @param {function} clearSelectedItems Callback to clear the set of selected items in the Redux state
     * @param {function} setCursor Callback to set the visible mouse cursor
     * @param {!function} onUpdateImage A callback to call when the image visibly changes
     */
    constructor(setSelectedItems, clearSelectedItems, setCursor, onUpdateImage) {
        super();
        this.setSelectedItems = setSelectedItems;
        this.clearSelectedItems = clearSelectedItems;
        this.onUpdateImage = onUpdateImage;
        this.boundingBoxTool = new BoundingBoxTool(
            Modes.ARROW,
            setSelectedItems,
            clearSelectedItems,
            setCursor,
            onUpdateImage
        );
        const nudgeTool = new NudgeTool(Modes.ARROW, this.boundingBoxTool, onUpdateImage);

        // We have to set these functions instead of just declaring them because
        // paper.js tools hook up the listeners in the setter functions.
        this.onMouseDown = this.handleMouseDown;
        this.onMouseMove = this.handleMouseMove;
        this.onMouseDrag = this.handleMouseDrag;
        this.onMouseUp = this.handleMouseUp;
        this.onKeyUp = nudgeTool.onKeyUp;
        this.onKeyDown = nudgeTool.onKeyDown;

        this.tri = null;
        this.colorState = null;
        this.isBoundingBoxMode = null;
        this.active = false;

    }
    getHitOptions() {
        return {
            segments: true,
            stroke: true,
            curves: true,
            fill: true,
            guide: false,
            match: hitResult =>
                (hitResult.item.data && (hitResult.item.data.isScaleHandle || hitResult.item.data.isRotHandle)) ||
                hitResult.item.selected, // Allow hits on bounding box and selected only
            tolerance: ArrowTool.TOLERANCE / paper.view.zoom
        };
    }
    /**
     * Should be called if the selection changes to update the bounds of the bounding box.
     * @param {Array<paper.Item>} selectedItems Array of selected items.
     */
    onSelectionChanged(selectedItems) {
        this.boundingBoxTool.onSelectionChanged(selectedItems);
    }
    setColorState(colorState) {
        this.colorState = colorState;
    }
    handleMouseDown(event) {
        if (event.event.button > 0) return; // only first mouse button
        this.active = true;
        this.tail = event.point;
        this.tip = event.point;
        this.tipOffset = new paper.Point(0, 0);
        this.sizes = Object.assign({}, last);
        this.wasAlt = false;
        if (this.boundingBoxTool.onMouseDown(
            event, false /* clone */, false /* multiselect */, false /* doubleClicked */, this.getHitOptions())) {
            this.isBoundingBoxMode = true;
        } else {
            this.isBoundingBoxMode = false;
            clearSelection(this.clearSelectedItems);
        }
    }
    handleMouseDrag(event) {
        if (event.event.button > 0 || !this.active) return; // only first mouse button
        if (this.isBoundingBoxMode) {
            this.boundingBoxTool.onMouseDrag(event);
            return;
        }
        const alt = event.modifiers.alt;
        if (!alt) {
            if (this.wasAlt) this.tipOffset = this.tip.subtract(event.point);
            let tip = event.point.add(this.tipOffset);
            if (event.modifiers.shift) {
                const v = tip.subtract(this.tail);
                v.angle = Math.round(v.angle / 15) * 15;
                tip = this.tail.add(v);
            }
            this.tip = tip;
        } else {
            const axis = this.tip.subtract(this.tail);
            const len = axis.length;
            if (len > 0) {
                const local = event.point.subtract(this.tail).rotate(-axis.angle);
                if (event.modifiers.shift) {
                    this.sizes.headL = Math.max(2, len - local.x);
                    this.sizes.headW = Math.max(this.sizes.shaft * 1.2, Math.abs(local.y) * 2);
                } else {
                    this.sizes.shaft = Math.max(1, Math.abs(local.y) * 2);
                    this.sizes.headW = Math.max(this.sizes.headW, this.sizes.shaft * 1.8);
                }
            }
        }
        this.wasAlt = alt;
        this.double = event.modifiers.control || event.modifiers.meta;
        this.draw();
    }
    draw() {
        if (this.tri) this.tri.remove();
        this.tri = null;
        const axis = this.tip.subtract(this.tail);
        if (axis.length < 1e-3) return;
        const {shaft, headW, headL} = this.sizes;
        this.tri = new paper.Path({
            segments: arrowPoints(axis.length, shaft, headW, headL, this.double),
            closed: true
        });
        this.tri.rotate(axis.angle, new paper.Point(0, 0));
        this.tri.translate(this.tail);
        styleShape(this.tri, this.colorState);
    }
    handleMouseUp(event) {
        if (event.event.button > 0 || !this.active) return; // only first mouse button

        if (this.isBoundingBoxMode) {
            this.boundingBoxTool.onMouseUp(event);
            this.isBoundingBoxMode = null;
            return;
        }
        if (this.tri) {
            if (Math.abs(this.tri.area) < ArrowTool.TOLERANCE / paper.view.zoom) {
                // Tiny arrow created unintentionally?
                this.tri.remove();
            } else {
                Object.assign(last, this.sizes);
                this.tri.selected = true;
                this.setSelectedItems();
                this.onUpdateImage();
            }
            this.tri = null;
        }
        this.active = false;
    }
    handleMouseMove(event) {
        this.boundingBoxTool.onMouseMove(event, this.getHitOptions());
    }
    deactivateTool() {
        this.boundingBoxTool.deactivateTool();
    }
}

export default ArrowTool;
