import paper from '@turbowarp/paper';
import {getRaster, getGuideLayer, createCanvas} from '../layer';
import {doesColorRequireMask, forEachLinePoint, getBrushMark} from '../bitmap';
import {snapDeltaToAngle} from '../math';
import {
    isMirrorActive,
    mirrorPoint,
    getBrushOptions,
    getPressure,
    customBrushFor,
    isCustomPreset,
    makeCustomMark
} from '../../dimod/core';

const DIMOD_PRESETS = ['SQUARE', 'CALLIGRAPHY', 'PIXEL', 'SPRAY'];

const makeMark = function (preset, size, color) {
    const side = Math.max(1, Math.ceil(size / 2) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    context.fillStyle = color;
    if (preset === 'CALLIGRAPHY') {
        const thickness = Math.max(1, Math.round(size / 6));
        for (let i = 0; i < size; i++) {
            context.fillRect(i, size - 1 - i, 1, thickness);
        }
    } else {
        context.fillRect(0, 0, size, size);
    }
    return canvas;
};

/**
 * Tool for drawing with the bitmap brush and eraser
 */
class BrushTool extends paper.Tool {
    /**
     * @param {!function} onUpdateImage A callback to call when the image visibly changes
     * @param {boolean} isEraser True if brush should erase
     */
    constructor (onUpdateImage, isEraser) {
        super();
        this.onUpdateImage = onUpdateImage;
        this.isEraser = isEraser;

        // We have to set these functions instead of just declaring them because
        // paper.js tools hook up the listeners in the setter functions.
        this.onMouseMove = this.handleMouseMove;
        this.onMouseDown = this.handleMouseDown;
        this.onMouseDrag = this.handleMouseDrag;
        this.onMouseUp = this.handleMouseUp;

        this.colorState = null;
        this.active = false;
        this.lastPoint = null;
        this.cursorPreview = null;
        this.drawTarget = null;
        this.maskTarget = null;
        this.maskBrush = null;
        this.marks = new Map();
    }
    setColor (color) {
        this.color = color;
        this.tmpCanvas = getBrushMark(this.size, this.color, this.isEraser || !this.color);
        this.marks.clear();
    }
    setBrushSize (size) {
        // For performance, make sure this is an integer
        this.size = Math.max(1, ~~size);
        this.tmpCanvas = getBrushMark(this.size, this.color, this.isEraser || !this.color);
    }
    drawNextLine (previousPoint, nextPoint) {
        const roundedUpRadius = Math.ceil(this.size / 2);
        const context = this.maskTarget || this.drawTarget.getContext('2d');
        if (this.isEraser || !this.color) {
            context.globalCompositeOperation = 'destination-out';
        }
        const mark = this.maskBrush || this.tmpCanvas;
        const mirrored = isMirrorActive();
        forEachLinePoint(previousPoint, nextPoint, (x, y) => {
            context.drawImage(mark, ~~x - roundedUpRadius, ~~y - roundedUpRadius);
            if (mirrored) {
                for (const image of mirrorPoint(x, y)) {
                    context.drawImage(mark, ~~image.x - roundedUpRadius, ~~image.y - roundedUpRadius);
                }
            }
        });
        if (this.isEraser || !this.color) {
            context.globalCompositeOperation = 'source-over';
        }
        this.recolorFromMask();
    }
    recolorFromMask () {
        if (this.maskTarget) {
            const drawContext = this.drawTarget.getContext('2d');
            const {width, height} = drawContext.canvas;
            drawContext.globalCompositeOperation = 'source-over';
            drawContext.drawImage(this.maskTarget.canvas, 0, 0);
            drawContext.globalCompositeOperation = 'source-in';
            drawContext.fillStyle = this.color;
            drawContext.fillRect(0, 0, width, height);
        }
    }


    get usesDimod () {
        const brush = getBrushOptions();
        if (this.isEraser) return brush.pressure || brush.taper > 0;
        return DIMOD_PRESETS.indexOf(brush.bitPreset) !== -1 || isCustomPreset(brush.bitPreset) ||
            brush.pressure || brush.taper > 0;
    }
    get preset () {
        return this.isEraser ? 'ROUND' : getBrushOptions().bitPreset;
    }
    get markColor () {
        if (this.maskTarget) return 'black';
        if (this.isEraser || !this.color) return 'white';
        return this.color;
    }
    markFor (size) {
        const key = `${this.preset}:${size}:${this.markColor}`;
        let mark = this.marks.get(key);
        if (!mark && isCustomPreset(this.preset)) {
            const custom = customBrushFor(this.preset);
            mark = custom && makeCustomMark(custom, size, this.markColor);
            if (!mark) return getBrushMark(size, this.markColor, false);
            this.marks.set(key, mark);
            return mark;
        }
        if (!mark) {
            mark = this.preset === 'ROUND' ?
                getBrushMark(size, this.markColor, false) :
                makeMark(this.preset, size, this.markColor);
            this.marks.set(key, mark);
        }
        return mark;
    }
    pressureFor (event) {
        if (!getBrushOptions().pressure) return 1;
        const real = getPressure(event.event);
        if (real !== null) return Math.max(0.1, real);
        const last = this.points[this.points.length - 1];
        if (!last) return 1;
        const dt = Math.max(1, event.event.timeStamp - last.time);
        const speed = event.point.getDistance(last.point) * paper.view.zoom / dt;
        this.speed = (this.speed * 0.7) + (speed * 0.3);
        return Math.max(0.3, Math.min(1, 1.15 - (this.speed * 0.35)));
    }
    sizeAt (entry, final) {
        let size = this.size * entry.pressure;
        const taper = getBrushOptions().taper;
        if (taper > 0) {
            const span = (taper / 100) * Math.max(this.size * 5, 60);
            const ease = t => Math.sqrt(Math.max(0, Math.min(1, t)));
            size *= ease(entry.along / span);
            if (final) size *= ease((this.length - entry.along) / span);
        }
        return Math.max(1, Math.round(size));
    }
    get context () {
        return this.maskTarget || this.drawTarget.getContext('2d');
    }
    stamp (x, y, size) {
        const context = this.context;
        const mark = this.markFor(size);
        const rx = Math.ceil(mark.width / 2);
        const ry = Math.ceil(mark.height / 2);
        const at = (px, py) => context.drawImage(mark, ~~px - rx, ~~py - ry);
        at(x, y);
        if (isMirrorActive()) for (const image of mirrorPoint(x, y)) at(image.x, image.y);
    }
    plotPixel (x, y) {
        x = Math.floor(x);
        y = Math.floor(y);
        const trail = this.pixelTrail;
        const last = trail[trail.length - 1];
        if (last && last.x === x && last.y === y) return;
        const context = this.context;
        const erasing = context.globalCompositeOperation === 'destination-out';
        const put = (px, py) => context.fillRect(px, py, 1, 1);
        const take = (px, py) => {
            if (erasing) return;
            context.clearRect(px, py, 1, 1);
        };
        const each = (px, py, fn) => {
            fn(px, py);
            if (isMirrorActive()) for (const image of mirrorPoint(px + 0.5, py + 0.5)) fn(Math.floor(image.x), Math.floor(image.y));
        };
        context.fillStyle = this.markColor;
        each(x, y, put);
        const before = trail[trail.length - 2];
        if (before && last &&
                Math.abs(x - before.x) === 1 && Math.abs(y - before.y) === 1 &&
                (last.x === before.x || last.y === before.y)) {
            each(last.x, last.y, take);
            trail.pop();
        }
        trail.push({x, y});
        if (trail.length > 3) trail.shift();
    }
    sprayAt (point) {
        const context = this.context;
        const radius = Math.max(1, this.size / 2);
        const density = Math.max(1, Math.min(100, getBrushOptions().sprayDensity || 30)) / 30;
        const expected = radius * 0.12 * density;
        const count = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
        context.fillStyle = this.markColor;
        for (let i = 0; i < count; i++) {
            const r = radius * Math.sqrt(Math.random());
            const angle = Math.random() * Math.PI * 2;
            const x = Math.floor(point.x + (Math.cos(angle) * r));
            const y = Math.floor(point.y + (Math.sin(angle) * r));
            context.fillRect(x, y, 1, 1);
            if (isMirrorActive()) {
                for (const image of mirrorPoint(x + 0.5, y + 0.5)) {
                    context.fillRect(Math.floor(image.x), Math.floor(image.y), 1, 1);
                }
            }
        }
    }
    dimodSegment (a, b, final) {
        const context = this.context;
        if (this.isEraser || !this.color) context.globalCompositeOperation = 'destination-out';
        const preset = this.preset;
        if (preset === 'SPRAY') {
            if (a === b) this.sprayAt(b.point);
            else forEachLinePoint(a.point, b.point, (x, y) => this.sprayAt({x, y}));
        } else if (isCustomPreset(preset)) {
            this.stampCustom(a, b, final);
        } else if (preset === 'PIXEL') {
            forEachLinePoint(a.point, b.point, (x, y) => this.plotPixel(x, y));
        } else {
            const sa = this.sizeAt(a, final);
            const sb = this.sizeAt(b, final);
            const total = Math.max(1, a.point.getDistance(b.point));
            forEachLinePoint(a.point, b.point, (x, y) => {
                const t = Math.min(1, new paper.Point(x, y).getDistance(a.point) / total);
                this.stamp(x, y, Math.round(sa + ((sb - sa) * t)));
            });
        }
        context.globalCompositeOperation = 'source-over';
        this.recolorFromMask();
    }
    stampCustom (a, b, final) {
        const custom = customBrushFor(this.preset) || {spacing: 25, scatter: 0};
        const sa = this.sizeAt(a, final);
        const sb = this.sizeAt(b, final);
        const step = Math.max(1, Math.max(sa, sb) * Math.max(1, custom.spacing) / 100);
        const scatter = Math.max(0, custom.scatter || 0) / 100;
        const span = b.along - a.along;
        let along = a === b ? a.along : (Math.floor(a.along / step) + 1) * step;
        if (a === b && a.along > 0) return;
        for (; along <= b.along + 1e-6; along += step) {
            const t = span > 0 ? (along - a.along) / span : 0;
            const size = Math.max(1, Math.round(sa + ((sb - sa) * t)));
            let x = a.point.x + ((b.point.x - a.point.x) * t);
            let y = a.point.y + ((b.point.y - a.point.y) * t);
            if (scatter) {
                const angle = Math.random() * Math.PI * 2;
                const r = size * scatter * Math.sqrt(Math.random());
                x += Math.cos(angle) * r;
                y += Math.sin(angle) * r;
            }
            this.stamp(x, y, size);
            if (a === b) break;
        }
    }
    addPoint (event, point) {
        const last = this.points[this.points.length - 1];
        const pressure = this.pressureFor(event);
        if (last) this.length += point.getDistance(last.point);
        const entry = {point, along: this.length, pressure, time: event.event.timeStamp};
        this.points.push(entry);
        this.dimodSegment(last || entry, entry, false);
    }
    finishDimod () {
        if (this.isEraser || getBrushOptions().taper <= 0 || this.preset === 'SPRAY' || this.preset === 'PIXEL') return;
        const clear = context => context.clearRect(0, 0, context.canvas.width, context.canvas.height);
        if (this.maskTarget) clear(this.maskTarget);
        clear(this.drawTarget.getContext('2d'));
        for (let i = 0; i < this.points.length; i++) {
            this.dimodSegment(this.points[Math.max(0, i - 1)], this.points[i], true);
        }
    }


    updateCursorIfNeeded () {
        if (!this.size) {
            return;
        }

        // The cursor preview was unattached from the view by an outside process,
        // such as changing costumes or undo.
        if (this.cursorPreview && !this.cursorPreview.parent) {
            this.cursorPreview = null;
        }

        const preset = this.preset;
        if (!this.cursorPreview ||
            !(this.lastSize === this.size && this.lastColor === this.color && this.lastPreset === preset)) {
            if (this.cursorPreview) {
                this.cursorPreview.remove();
            }

            this.tmpCanvas = this.previewMark(preset);
            this.cursorPreview = new paper.Raster(this.tmpCanvas);
            this.cursorPreview.guide = true;
            this.cursorPreview.parent = getGuideLayer();
            this.cursorPreview.data.isHelperItem = true;
        }

        this.lastSize = this.size;
        this.lastColor = this.color;
        this.lastPreset = preset;
    }
    previewMark (preset) {
        if (this.isEraser || !this.color || preset === 'ROUND') {
            return getBrushMark(this.size, this.color, this.isEraser || !this.color);
        }
        if (preset === 'PIXEL') return makeMark('SQUARE', 1, this.color);
        if (isCustomPreset(preset)) {
            const custom = customBrushFor(preset);
            const mark = custom && makeCustomMark(custom, this.size, this.color);
            if (mark) return mark;
            return getBrushMark(this.size, this.color, false);
        }
        if (preset === 'SPRAY') {
            const side = Math.max(2, Math.ceil(this.size / 2) * 2);
            const canvas = document.createElement('canvas');
            canvas.width = side;
            canvas.height = side;
            const context = canvas.getContext('2d');
            context.fillStyle = this.color;
            const r = (side / 2) - 0.5;
            const dots = Math.max(8, Math.round(Math.PI * side / 4));
            for (let i = 0; i < dots; i++) {
                const a = 2 * Math.PI * i / dots;
                const x = Math.floor((side / 2) + (r * Math.cos(a)));
                const y = Math.floor((side / 2) + (r * Math.sin(a)));
                context.fillRect(x, y, 1, 1);
            }
            return canvas;
        }
        return makeMark(preset, this.size, this.color);
    }
    constrainPoint(currentPoint, lastPoint, modifiers) {
        let delta = currentPoint.subtract(lastPoint);
        if (modifiers.shift) {
            // 45 degree movement
            delta = snapDeltaToAngle(delta, Math.PI / 4);
        } else if (modifiers.alt) {
            // vertical movement
            delta = new paper.Point(0, delta.y);
        } else if (modifiers.control || modifiers.meta) {
            // horizontal movement
            delta = new paper.Point(delta.x, 0);
        }
        return lastPoint.add(delta);
    }
    handleMouseMove (event) {
        this.updateCursorIfNeeded();
        this.cursorPreview.position = new paper.Point(~~event.point.x, ~~event.point.y);
    }
    handleMouseDown (event) {
        if (event.event.button > 0) return; // only first mouse button
        this.active = true;

        if (this.cursorPreview) {
            this.cursorPreview.remove();
        }

        if (this.isEraser) {
            this.drawTarget = getRaster();
        } else {
            const drawCanvas = createCanvas();
            this.drawTarget = new paper.Raster(drawCanvas);
            this.drawTarget.parent = getGuideLayer();
            this.drawTarget.guide = true;
            this.drawTarget.locked = true;
            this.drawTarget.position = getRaster().position;

            if (this.color && doesColorRequireMask(this.color)) {
                this.maskTarget = createCanvas().getContext('2d');
                this.maskBrush = getBrushMark(this.size, 'black', false);
            }
        }

        const point = event.point;
        this.dimod = this.usesDimod;
        if (this.dimod) {
            this.points = [];
            this.length = 0;
            this.speed = 0;
            this.pixelTrail = [];
            this.addPoint(event, point);
        } else {
            this.drawNextLine(point, point);
        }
        this.lastPoint = point;
    }
    handleMouseDrag (event) {
        if (event.event.button > 0 || !this.active) return; // only first mouse button

        const point = this.constrainPoint(event.point, this.lastPoint, event.modifiers);
        if (this.dimod) this.addPoint(event, point);
        else this.drawNextLine(this.lastPoint, point);
        this.lastPoint = point;
    }
    handleMouseUp (event) {
        if (event.event.button > 0 || !this.active) return; // only first mouse button

        const point = this.constrainPoint(event.point, this.lastPoint, event.modifiers);
        if (this.dimod) {
            this.addPoint(event, point);
            this.finishDimod();
        } else {
            this.drawNextLine(this.lastPoint, point);
        }
        if (!this.isEraser) {
            getRaster().drawImage(this.drawTarget.canvas, new paper.Point(0, 0));
            this.drawTarget.remove();
        }
        this.drawTarget = null;
        this.maskTarget = null;
        this.maskBrush = null;
        this.points = null;
        this.onUpdateImage();

        this.lastPoint = null;
        this.active = false;

        this.updateCursorIfNeeded();
        this.cursorPreview.position = new paper.Point(~~event.point.x, ~~event.point.y);
    }
    deactivateTool () {
        this.active = false;
        this.tmpCanvas = null;
        if (this.cursorPreview) {
            this.cursorPreview.remove();
            this.cursorPreview = null;
        }
    }
}

export default BrushTool;
