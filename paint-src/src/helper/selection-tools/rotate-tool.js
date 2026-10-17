import paper from '@turbowarp/paper';

import {getRotationPivot, noteRotation} from '../../dimod/pivot';

/**
 * Tool to handle rotation when dragging the rotation handle in the bounding box tool.
 */
class RotateTool {
    /**
     * @param {!function} onUpdateImage A callback to call when the image visibly changes
     */
    constructor (onUpdateImage) {
        this.rotItems = [];
        this.rotGroupPivot = null;
        this.prevRot = 90;
        this.onUpdateImage = onUpdateImage;
    }

    onMouseDown (hitResult, boundsPath, selectedItems, point) {
        for (const item of selectedItems) {
            // Rotate only root items
            if (item.parent instanceof paper.Layer) {
                this.rotItems.push(item);
            }
        }
        this.rotGroupPivot = this.rotItems.length ?
            getRotationPivot(this.rotItems) :
            boundsPath.bounds.center;
        this.prevRot = point ?
            point.subtract(this.rotGroupPivot).angle :
            90;
        this.startRot = this.prevRot;
    }
    onMouseDrag (event) {
        let rotAngle = (event.point.subtract(this.rotGroupPivot)).angle;
        if (event.modifiers.shift) {
            rotAngle = this.startRot + (Math.round((rotAngle - this.startRot) / 45) * 45);
        }

        for (let i = 0; i < this.rotItems.length; i++) {
            const item = this.rotItems[i];

            item.rotate(rotAngle - this.prevRot, this.rotGroupPivot);
        }

        this.prevRot = rotAngle;
    }
    onMouseUp (event) {
        if (event.event.button > 0) return; // only first mouse button

        const turned = this.prevRot - this.startRot;
        if (turned) for (const item of this.rotItems) item.data.dimodAngle = (((((item.data.dimodAngle || 0) + turned + 180) % 360) + 360) % 360) - 180;
        noteRotation(this.rotItems, this.rotGroupPivot);
        this.rotItems.length = 0;
        this.rotGroupPivot = null;
        this.prevRot = 90;

        this.onUpdateImage();
    }
}

export default RotateTool;
