import paper from '@turbowarp/paper';
import {getGuideLayer, getRaster} from '../layer';
import {getSelectedLeafItems, clearSelection} from '../selection';
import {snapDeltaToAngle} from '../math';
import {GUIDE_ACCENT, getGuideColor} from '../guides';
import {maskFromWand, artworkAt} from '../../dimod/items';
import {
    getBrushOptions,
    setHistoryLabel,
    getMirrorLines,
    getMirrorRadial,
    isMirrorActive,
    mirrorPoint,
    getPressure,
    isCustomPreset,
    customBrushFor,
    lineStyleOf,
    setLineStyle,
    getVectorTip,
    makeCustomMark,
    bakeBrush
} from '../../dimod/core';
import {ART_BOARD_WIDTH, ART_BOARD_HEIGHT, clampViewBounds, CENTER} from '../view';
import {styleShape, styleBlob} from '../style-path';
import {getBrushMark, forEachLinePoint} from '../bitmap';
import {isPaintSuspended} from '../../lib/dimod-flags';
import Cursors from '../../lib/cursors';
import {setLiveOverlay, liveOverlayChanged} from '../../dimod/render';
import {setLivePreviewSource} from '../../dimod/collab';
import {getEffectiveSelectionPivot, getSelectionBounds, clearSelectionPivot, snapPivot, isDefaultPivot, setSelectionPivot} from '../../dimod/pivot';
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const rgba = css => {
    if (!css) return [255, 255, 255, 0];
    const color = new paper.Color(css);
    return [color.red * 255, color.green * 255, color.blue * 255, (color.alpha === null ? 1 : color.alpha) * 255];
};
class DimodGradientTool extends paper.Tool {
    constructor (bitmap, getFill, onUpdateImage, setSelectedItems) {
        super();
        this.bitmap = bitmap;
        this.getFill = getFill;
        this.onUpdateImage = onUpdateImage;
        this.setSelectedItems = setSelectedItems;
        this.onMouseDown = this.handleMouseDown;
        this.onMouseDrag = this.handleMouseDrag;
        this.onMouseUp = this.handleMouseUp;
    }
    colors () {
        const fill = this.getFill();
        const c1 = fill.primary || 'rgba(0,0,0,0)';
        const c2 = fill.secondary || (fill.primary ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,0)');
        return {c1, c2, radial: fill.gradientType === 'RADIAL'};
    }
    handleMouseDown (event) {
        if (event.event.button > 0) return;
        this.start = event.point;
        this.dragged = false;
        if (this.bitmap) {
            const whole = event.modifiers.shift;
            this.mask = whole ?
                {rect: new paper.Rectangle(0, 0, ART_BOARD_WIDTH, ART_BOARD_HEIGHT),
                    mask: new Uint8Array(ART_BOARD_WIDTH * ART_BOARD_HEIGHT).fill(1)} :
                maskFromWand(event.point.x, event.point.y, getBrushOptions().fillTolerance);
            this.bounds = this.mask && maskBounds(this.mask);
            return;
        }
        const selected = getSelectedLeafItems().filter(item => item instanceof paper.PathItem ||
            item instanceof paper.PointText);
        if (selected.length) { this.targets = selected; } else {
            const hit = artworkAt(event.point, {fill: true,
                stroke: true,
                segments: true,
                curves: true,
                tolerance: 2 / paper.view.zoom});
            this.targets = hit ? [hit] : [];
        }
    }
    endPoint (event) {
        if (!event.modifiers.shift) return event.point;
        return this.start.add(snapDeltaToAngle(event.point.subtract(this.start), Math.PI / 4));
    }
    handleMouseDrag (event) {
        if (!this.start) return;
        const end = this.endPoint(event);
        if (end.getDistance(this.start) * paper.view.zoom < 3) return;
        this.dragged = true;
        this.drawGuide(end);
        if (this.bitmap) this.previewBitmap(end);
        else this.applyVector(end);
    }
    handleMouseUp (event) {
        if (!this.start) return;
        const end = this.endPoint(event);
        this.removeGuide();
        if (this.dragged) {
            if (this.bitmap) this.commitBitmap(end);
            else this.applyVector(end);
            if (!this.bitmap && !(this.targets && this.targets.length)) { this.start = null; return; }
            setHistoryLabel('gradient');
            this.onUpdateImage();
            if (!this.bitmap) this.setSelectedItems();
        }
        this.start = null;
        this.mask = null;
        this.targets = null;
    }
    drawGuide (end) {
        this.removeGuide();
        const zoom = 1 / paper.view.zoom;
        const line = new paper.Path.Line({from: this.start, to: end, strokeColor: GUIDE_ACCENT, strokeWidth: 1.5 * zoom});
        const a = new paper.Path.Circle({center: this.start,
            radius: 4 * zoom,
            fillColor: 'white',
            strokeColor: GUIDE_ACCENT,
            strokeWidth: 1.5 * zoom});
        const b = new paper.Path.Circle({center: end, radius: 4 * zoom, fillColor: GUIDE_ACCENT});
        const ink = [line, a, b].map(x => {
            const c = x.clone({insert: false});
            c.fillColor = null;
            c.strokeColor = 'black';
            c.strokeWidth = (x === line ? 3.5 : 3) * zoom;
            return c;
        });
        this.guide = new paper.Group([...ink, line, a, b]);
        this.guide.guide = true;
        this.guide.data.isHelperItem = true;
        this.guide.parent = getGuideLayer();
    }
    removeGuide () {
        if (this.guide) this.guide.remove();
        this.guide = null;
        if (this.preview) this.preview.remove();
        this.preview = null;
    }
    applyVector (end) {
        if (!this.targets || !this.targets.length) return;
        const {c1, c2, radial} = this.colors();
        for (const item of this.targets) {
            item.fillColor = {gradient: {stops: [c1, c2], radial}, origin: this.start, destination: end};
        }
    }
    render (end) {
        if (!this.mask || !this.bounds) return null;
        const {rect, mask} = this.mask;
        const b = this.bounds;
        if (!(b.width > 0) || !(b.height > 0)) return null;
        const out = new ImageData(b.width, b.height);
        const {c1, c2, radial} = this.colors();
        const from = rgba(c1);
        const to = rgba(c2);
        const dither = getBrushOptions().gradientDither;
        const dx = end.x - this.start.x;
        const dy = end.y - this.start.y;
        const len2 = Math.max(1e-6, (dx * dx) + (dy * dy));
        const len = Math.sqrt(len2);
        for (let y = 0; y < b.height; y++) {
            for (let x = 0; x < b.width; x++) {
                const gx = b.x + x;
                const gy = b.y + y;
                if (!mask[((gy - rect.y) * rect.width) + (gx - rect.x)]) continue;
                const px = gx + 0.5 - this.start.x;
                const py = gy + 0.5 - this.start.y;
                let t = radial ? Math.sqrt((px * px) + (py * py)) / len : ((px * dx) + (py * dy)) / len2;
                t = Math.max(0, Math.min(1, t));
                const o = ((y * b.width) + x) * 4;
                if (dither) {
                    const pick = t > BAYER[((gy & 3) * 4) + (gx & 3)] ? to : from;
                    out.data[o] = pick[0];
                    out.data[o + 1] = pick[1];
                    out.data[o + 2] = pick[2];
                    out.data[o + 3] = pick[3];
                } else {
                    for (let k = 0; k < 4; k++) out.data[o + k] = from[k] + ((to[k] - from[k]) * t);
                }
            }
        }
        return out;
    }
    previewBitmap (end) {
        const data = this.render(end);
        if (!data) return;
        const canvas = document.createElement('canvas');
        canvas.width = data.width;
        canvas.height = data.height;
        canvas.getContext('2d').putImageData(data, 0, 0);
        if (this.preview) this.preview.remove();
        this.preview = new paper.Raster({canvas, insert: false});
        this.preview.guide = true;
        this.preview.data.isHelperItem = true;
        this.preview.data.collabPreview = true;
        this.preview.position = new paper.Point(this.bounds.x + (data.width / 2), this.bounds.y + (data.height / 2));
        this.preview.parent = getGuideLayer();
        this.preview.sendToBack();
    }
    commitBitmap (end) {
        const data = this.render(end);
        if (!data) return;
        const {rect, mask} = this.mask;
        const b = this.bounds;
        const context = getRaster().getContext(true);
        const existing = context.getImageData(b.x, b.y, b.width, b.height);
        for (let y = 0; y < b.height; y++) {
            for (let x = 0; x < b.width; x++) {
                if (!mask[((b.y + y - rect.y) * rect.width) + (b.x + x - rect.x)]) continue;
                const o = ((y * b.width) + x) * 4;
                for (let k = 0; k < 4; k++) existing.data[o + k] = data.data[o + k];
            }
        }
        context.putImageData(existing, b.x, b.y);
    }
    deactivateTool () { this.removeGuide(); }
}
const maskBounds = function (selection) {
    const {rect, mask} = selection;
    let left = rect.width;
    let top = rect.height;
    let right = -1;
    let bottom = -1;
    for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        const x = i % rect.width;
        const y = (i - x) / rect.width;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
    }
    if (right < 0) return null;
    return {x: rect.x + left, y: rect.y + top, width: right - left + 1, height: bottom - top + 1};
};
class DimodPolygonTool extends paper.Tool {
    constructor (bitmap, callbacks, lasso) {
        super();
        this.bitmap = bitmap;
        this.callbacks = callbacks;
        this.lasso = Boolean(lasso);
        this.path = null;
        this.onMouseDown = this.handleMouseDown;
        this.onMouseMove = this.handleMouseMove;
        this.onMouseDrag = this.handleMouseMove;
        if (this.lasso) { this.onMouseMove = null; this.onMouseDrag = this.handleLassoDrag; this.onMouseUp = this.handleLassoUp; }
        this.handleKey = this.handleKey.bind(this);
    }
    setColorState (colorState) {
        this.colorState = colorState;
        if (this.path && !this.bitmap) this.stylePath();
    }
    setBitmapOptions (color, filled, thickness) {
        this.color = color;
        this.filled = filled;
        this.thickness = Math.max(1, thickness || 1);
    }
    stylePath (path = this.path) {
        if (this.bitmap) {
            path.strokeColor = GUIDE_ACCENT;
            path.strokeWidth = 1.5 / paper.view.zoom;
            path.fillColor = this.filled && this.color ? this.color : null;
            path.opacity = 0.8;
        } else if (this.colorState) { styleShape(path, this.colorState); }
    }
    cornerAt (event) {
        if (!this.path || this.path.segments.length < 2 || !event.modifiers.shift) return event.point;
        const previous = this.path.segments[this.path.segments.length - 2].point;
        return previous.add(snapDeltaToAngle(event.point.subtract(previous), Math.PI / 4));
    }
    handleMouseDown (event) {
        if (event.event.button > 0) return;
        const point = this.cornerAt(event);
        if (this.lasso && this.path) this.cancel();
        if (!this.path) {
            if (!this.bitmap) clearSelection(this.callbacks.clearSelectedItems);
            this.path = new paper.Path({segments: [point, point], closed: false});
            if (this.bitmap) { this.path.guide = true; this.path.data.isHelperItem = true; this.path.data.collabPreview = true; this.path.parent = getGuideLayer(); }
            this.stylePath();
            this.last = {time: Date.now(), point};
            document.addEventListener('keydown', this.handleKey, true);
            return;
        }
        const corners = this.path.segments.length - 1;
        const first = this.path.firstSegment.point;
        const near = (a, b, px) => a.getDistance(b) * paper.view.zoom < px;
        const doubleClick = Date.now() - this.last.time < 350 && near(point, this.last.point, 6);
        if (corners >= 3 && (near(point, first, 9) || doubleClick)) { this.finish(); return; }
        if (doubleClick) return;
        this.path.lastSegment.point = point;
        this.path.add(point);
        this.last = {time: Date.now(), point};
        this.restyle();
    }
    handleLassoDrag (event) {
        if (!this.path) return;
        this.path.lastSegment.point = event.point;
        const previous = this.path.segments[this.path.segments.length - 2].point;
        if (previous.getDistance(event.point) * paper.view.zoom < 3) return;
        this.path.add(event.point);
        this.restyle();
    }
    handleLassoUp () {
        if (this.path) this.finish();
    }
    handleMouseMove (event) {
        if (!this.path) return;
        this.path.lastSegment.point = this.cornerAt(event);
        this.restyle();
    }
    restyle () {
        if (!this.bitmap && this.colorState) styleShape(this.path, this.colorState);
    }
    handleKey (event) {
        if (!this.path || isPaintSuspended()) return;
        if (event.key === 'Enter') this.finish();
        else if (event.key === 'Escape') this.cancel();
        else if (event.key === 'Backspace' || event.key === 'Delete') {
            if (this.path.segments.length > 2) {
                this.path.removeSegment(this.path.segments.length - 2);
                this.restyle();
            } else this.cancel();
        } else return;
        event.preventDefault();
        event.stopPropagation();
    }
    finish () {
        const path = this.path;
        this.path = null;
        document.removeEventListener('keydown', this.handleKey, true);
        path.lastSegment.remove();
        if (path.segments.length < 3) { path.remove(); return; }
        path.closed = true;
        if (this.lasso) {
            const smoothing = Math.max(0, Number(getBrushOptions().lassoSmoothing) || 0);
            if (smoothing > 0) {
                path.simplify(smoothing);
                if (this.bitmap) path.flatten(0.25);
            }
        }
        if (this.bitmap) {
            this.commitBitmap(path);
            path.remove();
            this.callbacks.onUpdateImage();
            return;
        }
        this.stylePath(path);
        path.selected = true;
        this.callbacks.setSelectedItems();
        this.callbacks.onUpdateImage();
    }
    commitBitmap (path) {
        if (!this.color) return;
        const context = getRaster().getContext(true);
        const points = path.segments.map(segment => segment.point);
        if (this.filled) {
            const canvas = document.createElement('canvas');
            canvas.width = ART_BOARD_WIDTH;
            canvas.height = ART_BOARD_HEIGHT;
            const shape = canvas.getContext('2d');
            shape.beginPath();
            points.forEach((p, i) => (i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y)));
            shape.closePath();
            shape.fillStyle = 'black';
            shape.fill();
            const data = shape.getImageData(0, 0, canvas.width, canvas.height);
            const color = new paper.Color(this.color);
            const rgba = [color.red * 255, color.green * 255, color.blue * 255, (color.alpha === null ? 1 : color.alpha) * 255];
            for (let i = 0; i < data.data.length; i += 4) {
                if (data.data[i + 3] >= 128) data.data.set(rgba, i);
                else data.data[i + 3] = 0;
            }
            shape.putImageData(data, 0, 0);
            context.drawImage(canvas, 0, 0);
        } else {
            const mark = getBrushMark(this.thickness, this.color, false);
            const r = Math.ceil(this.thickness / 2);
            for (let i = 0; i < points.length; i++) {
                forEachLinePoint(points[i], points[(i + 1) % points.length], (x, y) => {
                    context.drawImage(mark, ~~x - r, ~~y - r);
                });
            }
        }
    }
    cancel () {
        if (this.path) this.path.remove();
        this.path = null;
        document.removeEventListener('keydown', this.handleKey, true);
    }
    deactivateTool () { this.cancel(); }
}
const panFromDrag = function (start, clientX, clientY) {
    paper.view.matrix.tx = start.tx + (clientX - start.x);
    paper.view.matrix.ty = start.ty + (clientY - start.y);
    clampViewBounds();
};
class HandTool extends paper.Tool {
    constructor (setCursor, onViewChanged) {
        super();
        this.setCursor = setCursor;
        this.onViewChanged = onViewChanged;
        this.start = null;
        this.onMouseDown = this.handleMouseDown;
        this.onMouseDrag = this.handleMouseDrag;
        this.onMouseUp = this.handleMouseUp;
        this.onMouseMove = () => this.setCursor(Cursors.GRAB);
    }
    handleMouseDown (event) {
        if (event.event.button > 0) return;
        this.start = {x: event.event.clientX, y: event.event.clientY, tx: paper.view.matrix.tx, ty: paper.view.matrix.ty};
        this.setCursor(Cursors.GRABBING);
    }
    handleMouseDrag (event) {
        if (!this.start) return;
        panFromDrag(this.start, event.event.clientX, event.event.clientY);
        this.onViewChanged(paper.view.matrix);
    }
    handleMouseUp () { this.start = null; this.setCursor(Cursors.GRAB); }
    deactivateTool () { this.start = null; this.setCursor(Cursors.DEFAULT); }
}
const CENTER_SNAP = 10;
const snapCenter = point => (point.getDistance(CENTER) * paper.view.zoom < CENTER_SNAP ? CENTER.clone() : point);
const ROTATE_HANDLE_DISTANCE = 56;
const HIT = 8;
const SNAP = 15;
const handlesOf = function (line) {
    const center = new paper.Point(line.x, line.y);
    const direction = new paper.Point({angle: line.angle, length: ROTATE_HANDLE_DISTANCE / paper.view.zoom});
    return {center, rotate: center.add(direction)};
};
class MirrorTool extends paper.Tool {
    constructor (setLines, selectLine, getSelected, setCursor, setRadial) {
        super();
        this.setRadial = setRadial;
        this.setLines = setLines;
        this.selectLine = selectLine;
        this.getSelected = getSelected;
        this.setCursor = setCursor;
        this.drag = null;
        this.onMouseDown = this.handleMouseDown;
        this.onMouseDrag = this.handleMouseDrag;
        this.onMouseUp = this.handleMouseUp;
        this.onMouseMove = this.handleMouseMove;
        this.onKeyDown = this.handleKeyDown;
    }
    hit (point) {
        const lines = getMirrorLines();
        const near = (a, b) => a.getDistance(b) * paper.view.zoom < HIT;
        const radial = getMirrorRadial();
        if (radial.n > 1 && near(point, new paper.Point(radial.x, radial.y))) return {part: 'radial'};
        for (let i = lines.length - 1; i >= 0; i--) {
            const handles = handlesOf(lines[i]);
            if (near(point, handles.rotate)) return {index: i, part: 'rotate'};
            if (near(point, handles.center)) return {index: i, part: 'move'};
        }
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            const direction = new paper.Point({angle: line.angle, length: 1});
            const offset = point.subtract(new paper.Point(line.x, line.y));
            const distance = Math.abs((offset.x * direction.y) - (offset.y * direction.x));
            if (distance * paper.view.zoom < HIT / 2) return {index: i, part: 'move'};
        }
        return null;
    }
    handleMouseMove (event) {
        const hit = this.hit(event.point);
        if (!hit) this.setCursor(Cursors.DEFAULT);
        else this.setCursor(hit.part === 'rotate' ? Cursors.GRAB : 'move');
    }
    handleMouseDown (event) {
        if (event.event.button > 0) return;
        const hit = this.hit(event.point);
        const lines = getMirrorLines();
        if (hit && hit.part === 'radial') { this.drag = {part: 'radial', origin: {...getMirrorRadial()}}; return; }
        if (hit) {
            this.selectLine(hit.index);
            this.drag = {...hit, origin: {...lines[hit.index]}};
            if (hit.part === 'rotate') this.setCursor(Cursors.GRABBING);
            return;
        }
        this.drag = {part: 'new', index: lines.length};
        const at = snapCenter(event.point);
        this.drag.at = at;
        this.setLines(lines.concat([{x: at.x, y: at.y, angle: 90}]));
        this.selectLine(lines.length);
    }
    handleMouseDrag (event) {
        if (!this.drag) return;
        if (this.drag.part === 'radial') {
            const moved = snapCenter(new paper.Point(this.drag.origin.x, this.drag.origin.y)
                .add(event.point.subtract(event.downPoint)));
            this.setRadial({...this.drag.origin, x: moved.x, y: moved.y});
            return;
        }
        const lines = getMirrorLines().slice();
        const line = {...lines[this.drag.index]};
        const snap = angle => (event.modifiers.shift ? Math.round(angle / SNAP) * SNAP : angle);
        if (this.drag.part === 'move') {
            const delta = event.point.subtract(event.downPoint);
            const moved = snapCenter(new paper.Point(this.drag.origin.x + delta.x, this.drag.origin.y + delta.y));
            line.x = moved.x;
            line.y = moved.y;
        } else {
            const from = this.drag.part === 'new' ? this.drag.at : new paper.Point(line.x, line.y);
            const vector = event.point.subtract(from);
            if (vector.length * paper.view.zoom < 4) return;
            line.angle = snap(vector.angle);
        }
        lines[this.drag.index] = line;
        this.setLines(lines);
    }
    handleMouseUp () { this.drag = null; this.setCursor(Cursors.DEFAULT); }
    handleKeyDown (event) {
        if (event.key !== 'delete' && event.key !== 'backspace') return;
        const target = event.event && event.event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
        const selected = this.getSelected();
        const lines = getMirrorLines();
        if (selected < 0 || selected >= lines.length) return;
        this.setLines(lines.filter((line, i) => i !== selected));
        this.selectLine(-1);
    }
    deactivateTool () { this.drag = null; this.setCursor(Cursors.DEFAULT); }
}
const NIB_ANGLE = -45;
const CAP_STEPS = 8;
class DimodStrokeBrush {
    constructor () { this.points = null; this.preview = null; this.spray = null; }
    onDown (options, brush, event, tool) {
        this.brush = brush;
        this.options = options;
        tool.minDistance = Math.max(1, 1.5 / paper.view.zoom);
        tool.maxDistance = Math.max(4, options.brushSize / 2);
        this.points = [];
        this.length = 0;
        this.lastTime = event.event.timeStamp;
        this.speed = 0;
        this.custom = isCustomPreset(brush.preset) ? customBrushFor(brush.preset) : null;
        this.tip = this.custom && getVectorTip(this.custom);
        this.tipOnly = Boolean(this.tip);
        this.stamps = [];
        this.nextStamp = 0;
        if (brush.preset === 'SPRAY' || this.custom) {
            this.spray = new paper.CompoundPath({insert: false});
            styleBlob(this.spray, options);
            this.spray.strokeColor = null;
            this.spray.strokeWidth = 0;
            this.startOverlay();
        }
        this.add(event);
    }
    onDrag (event) {
        if (!this.points) return;
        this.add(event);
    }
    onUp (event) {
        if (!this.points) return null;
        this.add(event);
        let result;
        if (this.tip) {
            result = this.buildStampLine();
            this.spray.remove();
            this.spray = null;
            this.marks = null;
            setLiveOverlay(null);
            setLivePreviewSource(null);
        } else if (this.custom || this.brush.preset === 'SPRAY') {
            if (this.custom) this.taperStamps();
            result = this.spray;
            this.spray = null;
            this.marks = null;
            paper.project.activeLayer.addChild(result);
            setLiveOverlay(null);
            setLivePreviewSource(null);
        } else { result = this.build(true); }
        if (this.preview && this.preview !== result) this.preview.remove();
        this.preview = null;
        this.points = null;
        return result;
    }
    get current () { return this.preview; }
    startOverlay () {
        this.marks = [];
        const color = this.spray.fillColor;
        const css = color && color.type !== 'gradient' ? color.toCSS(true) : 'black';
        const custom = this.custom;
        const markCache = new Map();
        const tipD = this.tip ? this.tip.getPathData(null, 3) : null;
        setLivePreviewSource(() => {
            const marks = this.marks;
            if (!marks || !marks.length) return null;
            let out = '';
            for (let i = 0; i < marks.length && i < 700; i++) {
                const m = marks[i];
                if (tipD) out += `<path transform="translate(${m.x.toFixed(1)} ${m.y.toFixed(1)}) scale(${(m.size || 1).toFixed(2)})" d="${tipD}"/>`;
                else out += `<circle cx="${m.x.toFixed(1)}" cy="${m.y.toFixed(1)}" r="${(m.r || 1).toFixed(2)}"/>`;
            }
            return `<g fill="${css}">${out}</g>`;
        });
        const each = (mark, fn) => {
            fn(mark.x, mark.y);
            if (isMirrorActive()) for (const image of mirrorPoint(mark.x, mark.y)) fn(image.x, image.y);
        };
        setLiveOverlay({
            count: () => (this.marks ? this.marks.length : 0),
            drawRange: (ctx, from, to) => {
                const marks = this.marks;
                if (!marks) return;
                if (custom) {
                    const scale = Math.hypot(ctx.getTransform().a, ctx.getTransform().b) || 1;
                    for (let i = from; i < to; i++) {
                        const mark = marks[i];
                        const px = Math.max(1, Math.round(mark.size * scale));
                        let image = markCache.get(px);
                        if (image === undefined) { image = makeCustomMark(custom, px, css); markCache.set(px, image); }
                        if (!image) continue;
                        const w = image.width / scale;
                        const h = image.height / scale;
                        each(mark, (x, y) => ctx.drawImage(image, x - (w / 2), y - (h / 2), w, h));
                    }
                    return;
                }
                ctx.fillStyle = css;
                ctx.beginPath();
                for (let i = from; i < to; i++) {
                    const mark = marks[i];
                    each(mark, (x, y) => { ctx.moveTo(x + mark.r, y); ctx.arc(x, y, mark.r, 0, Math.PI * 2); });
                }
                ctx.fill();
            }
        });
    }
    add (event) {
        const point = event.point;
        const last = this.points[this.points.length - 1];
        if (last) {
            const distance = point.getDistance(last.point);
            if (distance * paper.view.zoom < 0.5) return;
            this.length += distance;
            const time = event.event.timeStamp;
            const dt = Math.max(1, time - this.lastTime);
            this.speed = (this.speed * 0.7) + ((distance * paper.view.zoom / dt) * 0.3);
            this.lastTime = time;
        }
        this.points.push({point, along: this.length, pressure: this.pressureFor(event)});
        if (this.custom) { this.stampTo(this.points.length - 1); } else if (this.brush.preset === 'SPRAY') { this.sprayAt(point); } else {
            if (this.preview) this.preview.remove();
            this.preview = this.build(false);
        }
    }
    pressureFor (event) {
        if (!this.brush.pressure) return 1;
        const real = getPressure(event.event);
        if (real !== null) return Math.max(0.1, real);
        return Math.max(0.3, Math.min(1, 1.15 - (this.speed * 0.35)));
    }
    radiusAt (index, final) { const entry = this.points[index]; return this.radiusFor(entry.along, entry.pressure, final); }
    radiusFor (along, pressure, final) {
        let radius = this.options.brushSize / 2 * pressure;
        let taper = this.brush.taper;
        if (this.brush.preset === 'MARKER' && !taper) taper = 45;
        if (taper > 0) {
            const span = (taper / 100) * Math.max(this.options.brushSize * 5, 60);
            const ease = t => Math.sqrt(Math.max(0, Math.min(1, t)));
            radius *= ease(along / span);
            if (final) radius *= ease((this.length - along) / span);
        }
        return Math.max(radius, 0.35 / paper.view.zoom);
    }
    build (final) {
        const n = this.points.length;
        let path;
        if (n === 1) {
            path = new paper.Path.Circle({center: this.points[0].point, radius: this.radiusAt(0, final)});
        } else if (this.brush.preset === 'CALLIGRAPHY') { path = this.buildNib(final); } else { path = this.buildRound(final); }
        styleBlob(path, this.options);
        if (!final) return path;
        const empty = new paper.Path({insert: false});
        const resolved = path.unite(empty);
        path.remove();
        if (resolved instanceof paper.Path) resolved.simplify(Math.max(0.4, 1 / paper.view.zoom));
        styleBlob(resolved, this.options);
        return resolved;
    }
    normalAt (index) {
        const points = this.points;
        const before = points[Math.max(0, index - 1)].point;
        const after = points[Math.min(points.length - 1, index + 1)].point;
        const direction = after.subtract(before);
        if (direction.length === 0) return new paper.Point(0, 1);
        return direction.normalize().rotate(90);
    }
    buildRound (final) {
        const n = this.points.length;
        const left = [];
        const right = [];
        for (let i = 0; i < n; i++) {
            const normal = this.normalAt(i).multiply(this.radiusAt(i, final));
            left.push(this.points[i].point.add(normal));
            right.push(this.points[i].point.subtract(normal));
        }
        const cap = (index, from) => {
            const center = this.points[index].point;
            const radius = this.radiusAt(index, final);
            const start = from.subtract(center).angle;
            const out = [];
            for (let k = 1; k < CAP_STEPS; k++) {
                out.push(center.add(new paper.Point({angle: start - (180 * k / CAP_STEPS), length: radius})));
            }
            return out;
        };
        const segments = left
            .concat(cap(n - 1, left[n - 1]))
            .concat(right.slice().reverse())
            .concat(cap(0, right[0]));
        return new paper.Path({segments, closed: true});
    }
    buildNib (final) {
        const nib = new paper.Point({angle: NIB_ANGLE, length: 1});
        const left = [];
        const right = [];
        for (let i = 0; i < this.points.length; i++) {
            const offset = nib.multiply(this.radiusAt(i, final));
            left.push(this.points[i].point.add(offset));
            right.push(this.points[i].point.subtract(offset));
        }
        return new paper.Path({segments: left.concat(right.reverse()), closed: true});
    }
    stampTo (index) {
        const b = this.points[index];
        const a = this.points[Math.max(0, index - 1)];
        const size = this.options.brushSize;
        const step = Math.max(0.5 / paper.view.zoom, size * Math.max(1, this.custom.spacing || 25) / 100);
        const scatter = Math.max(0, this.custom.scatter || 0) / 100;
        while (this.nextStamp <= b.along + 1e-6) {
            const span = b.along - a.along;
            const t = span > 0 ? (this.nextStamp - a.along) / span : 0;
            let at = a.point.add(b.point.subtract(a.point).multiply(Math.max(0, Math.min(1, t))));
            const pressure = a.pressure + ((b.pressure - a.pressure) * t);
            const radius = this.radiusFor(this.nextStamp, pressure, false);
            if (scatter) {
                at = at.add(new paper.Point({angle: Math.random() * 360, length: 2 * radius * scatter * Math.sqrt(Math.random())}));
            }
            if (this.tip && this.tipOnly) {
                this.marks.push({x: at.x, y: at.y, size: radius * 2});
                liveOverlayChanged();
                this.nextStamp += step;
                continue;
            }
            let stamp;
            if (this.tip) {
                stamp = this.tip.clone({insert: false});
                stamp.scale(radius * 2, new paper.Point(0, 0));
                if (this.custom.orient && b.point.getDistance(a.point) > 1e-6) {
                    stamp.rotate(b.point.subtract(a.point).angle, new paper.Point(0, 0));
                }
                stamp.translate(at);
            } else { stamp = new paper.Path.Circle({center: at, radius, insert: false}); }
            const parts = stamp instanceof paper.CompoundPath ? stamp.removeChildren() : [stamp];
            this.spray.addChildren(parts);
            if (this.marks) { this.marks.push({x: at.x, y: at.y, size: radius * 2}); liveOverlayChanged(); }
            this.stamps.push({parts, along: this.nextStamp, pressure, at});
            this.nextStamp += step;
        }
    }
    buildStampLine () {
        const points = this.points.map(entry => entry.point);
        if (points.length < 2) points.push(points[0].add(new paper.Point(0.01, 0)));
        const line = new paper.Path({segments: points, insert: false});
        if (points.length > 3) line.simplify(Math.max(0.5, 1 / paper.view.zoom));
        line.strokeColor = this.spray.fillColor ? this.spray.fillColor.clone() : new paper.Color(0, 0, 0);
        line.strokeWidth = this.options.brushSize;
        line.fillColor = null;
        const half = this.options.brushSize / 2;
        const pressure = [];
        let at = 0;
        for (let i = 0; i < 32; i++) {
            const along = this.length * i / 31;
            while (at < this.points.length - 2 && this.points[at + 1].along < along) at++;
            const a = this.points[at];
            const b = this.points[Math.min(at + 1, this.points.length - 1)];
            const span = b.along - a.along;
            const t = span > 0 ? Math.max(0, Math.min(1, (along - a.along) / span)) : 0;
            pressure.push(this.radiusFor(along, a.pressure + ((b.pressure - a.pressure) * t), true) / half);
        }
        setLineStyle(line, lineStyleOf({type: 'BRUSH', brush: this.brush.preset, spacing: this.custom.spacing,
            scatter: this.custom.scatter, seed: 1 + Math.floor(Math.random() * 1e6), pressure}));
        const result = bakeBrush(line) || line;
        paper.project.activeLayer.addChild(result);
        return result;
    }
    taperStamps () {
        if (!(this.brush.taper > 0) || !this.stamps.length) return;
        for (const entry of this.stamps) {
            const before = this.radiusFor(entry.along, entry.pressure, false);
            const after = this.radiusFor(entry.along, entry.pressure, true);
            if (before > 0 && after !== before) entry.parts.forEach(part => part.scale(after / before, entry.at));
        }
    }
    sprayAt (point) {
        const radius = this.options.brushSize / 2;
        const dot = Math.max(0.6 / paper.view.zoom, radius / 12);
        const density = Math.max(1, Math.min(100, this.brush.sprayDensity || 30)) / 30;
        const expected = Math.max(0.3, radius / 3) * density;
        const count = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
        for (let i = 0; i < count; i++) {
            const r = radius * Math.sqrt(Math.random());
            const at = point.add(new paper.Point({angle: Math.random() * 360, length: r}));
            this.spray.addChild(new paper.Path.Circle({center: at, radius: dot, insert: false}));
            if (this.marks) this.marks.push({x: at.x, y: at.y, r: dot});
        }
        liveOverlayChanged();
    }
    cancel () {
        if (this.marks) { setLiveOverlay(null); setLivePreviewSource(null); }
        this.marks = null;
        if (this.preview) this.preview.remove();
        if (this.spray) this.spray.remove();
        this.preview = null;
        this.spray = null;
        this.points = null;
    }
}
const PIVOT_HANDLE_SIZE = 18;
const PIVOT_GRAB_RADIUS = 16;
const PIVOT_PLUS_SIZE = 18;
const drawPivotHandle = function (items, draggable) {
    const position = getEffectiveSelectionPivot(items);
    if (!position) return null;
    const zoom = 1 / paper.view.zoom;
    const data = {isPivotHandle: true, isHelperItem: true, noSelect: true, noHover: true};
    const children = [];
    if (draggable) {
        children.push(new paper.Path.Circle({
            center: new paper.Point(0, 0),
            radius: PIVOT_GRAB_RADIUS * zoom,
            fillColor: new paper.Color(1, 1, 1, 0.01),
            insert: false,
            data: Object.assign({}, data)
        }));
    }
    const plus = new paper.Path.Rectangle({point: [-1, -6], size: [2, 12], radius: 1, insert: false})
        .unite(new paper.Path.Rectangle({point: [-6, -1], size: [12, 2], radius: 1, insert: false}), {insert: false});
    plus.scale(PIVOT_PLUS_SIZE * zoom / plus.bounds.width);
    plus.position = new paper.Point(0, 0);
    plus.fillColor = null;
    plus.strokeColor = getGuideColor();
    plus.strokeWidth = zoom;
    plus.data = Object.assign({}, data);
    const ink = plus.clone({insert: false});
    ink.strokeColor = 'black';
    ink.strokeWidth = 3 * zoom;
    ink.data = {};
    ink.locked = true;
    children.push(ink, plus);
    const handle = new paper.Group(children);
    handle.parent = getGuideLayer();
    handle.position = position;
    handle.data = data;
    handle.locked = !draggable;
    return handle;
};
const REALISTIC_CENTER = '#ffcc00';
const drawPivotDragOverlay = function (items, point, showSnap = true) {
    const bounds = getSelectionBounds(items);
    if (!bounds) return null;
    const zoom = 1 / paper.view.zoom;
    const data = {isPivotHandle: true, isHelperItem: true, noSelect: true, noHover: true};
    const c = bounds.center;
    const snapped = showSnap && c.isClose(point, 1e-6);
    const diamond = new paper.Path({
        segments: [[c.x, c.y - (8 * zoom)], [c.x + (8 * zoom), c.y], [c.x, c.y + (8 * zoom)], [c.x - (8 * zoom), c.y]],
        closed: true,
        strokeColor: REALISTIC_CENTER,
        strokeWidth: 1.5 * zoom,
        fillColor: snapped ? REALISTIC_CENTER : null,
        insert: false,
        data: Object.assign({}, data)
    });
    const cross = new paper.CompoundPath({
        children: [
            new paper.Path.Line({from: [point.x - (14 * zoom), point.y], to: [point.x + (14 * zoom), point.y], insert: false}),
            new paper.Path.Line({from: [point.x, point.y - (14 * zoom)], to: [point.x, point.y + (14 * zoom)], insert: false})
        ],
        strokeColor: getGuideColor(),
        strokeWidth: zoom,
        insert: false,
        data: Object.assign({}, data)
    });
    const ink = [diamond, cross].map(x => {
        const c = x.clone({insert: false});
        c.fillColor = null;
        c.strokeColor = 'black';
        c.strokeWidth = x.strokeWidth + (2 * zoom);
        c.data = {};
        return c;
    });
    const overlay = new paper.Group([...ink, diamond, cross]);
    overlay.parent = getGuideLayer();
    overlay.data = data;
    overlay.locked = true;
    return overlay;
};
class PivotTool {
    constructor (onUpdateImage) {
        this.onUpdateImage = onUpdateImage;
        this.items = null;
        this.handle = null;
        this.dragged = false;
        this.overlay = null;
    }
    onMouseDown (hitResult, selectedItems, doubleClicked, handle) {
        this.items = selectedItems.length ? selectedItems : null;
        this.handle = handle || null;
        this.dragged = false;
        this.overlay = null;
        if (!this.items) return;
        if (doubleClicked) {
            clearSelectionPivot(this.items);
            if (this.handle) this.handle.position = getEffectiveSelectionPivot(this.items);
            this.items = null;
            this.onUpdateImage();
        }
    }
    onMouseDrag (event) {
        if (!this.items) return;
        const point = snapPivot(this.items, event.point);
        if (isDefaultPivot(this.items, point)) { clearSelectionPivot(this.items); } else { setSelectionPivot(this.items, point); }
        if (this.handle) this.handle.position = point;
        if (this.overlay) this.overlay.remove();
        this.overlay = drawPivotDragOverlay(this.items, point);
        this.dragged = true;
    }
    onMouseUp (event) {
        if (event.event.button > 0) return;
        const moved = this.dragged;
        if (this.overlay) this.overlay.remove();
        this.overlay = null;
        this.items = null;
        this.handle = null;
        this.dragged = false;
        if (moved) this.onUpdateImage();
    }
}
export {DimodGradientTool, DimodPolygonTool, DimodStrokeBrush, HandTool, MirrorTool, NIB_ANGLE, PIVOT_GRAB_RADIUS, PIVOT_HANDLE_SIZE, PivotTool, ROTATE_HANDLE_DISTANCE, drawPivotDragOverlay, drawPivotHandle, handlesOf, maskBounds, panFromDrag};
