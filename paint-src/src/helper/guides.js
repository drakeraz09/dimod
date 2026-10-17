import paper from '@turbowarp/paper';
import {getGuideLayer} from './layer';
import {getAllRootItems} from './selection';
import {GUIDE_ACCENT, GUIDE_ACCENT_WASH, GUIDE_HALO, SELECTION_STROKE_WIDTH} from '../lib/guide-colors';

const setDefaultGuideStyle = function (item) {
    item.strokeWidth = 1 / paper.view.zoom;
    item.opacity = 1;
    item.blendMode = 'normal';
    item.guide = true;
};

const setSelectionStrokeWidth = function (item) {
    item.strokeWidth = SELECTION_STROKE_WIDTH / paper.view.zoom;
};

const hoverItem = function (item) {
    const segments = item.segments;
    const clone = new paper.Path(segments);
    setDefaultGuideStyle(clone);
    if (item.closed) {
        clone.closed = true;
    }
    clone.parent = getGuideLayer();
    clone.matrix = item.globalMatrix;
    setSelectionStrokeWidth(clone);
    clone.strokeColor = GUIDE_ACCENT;
    clone.fillColor = null;
    clone.data.isHelperItem = true;
    clone.data.origItem = item;
    clone.bringToFront();

    return clone;
};

const hoverBounds = function (item, expandBy) {
    let bounds = item.internalBounds;
    if (expandBy) {
        bounds = bounds.expand(expandBy);
    }
    const rect = new paper.Path.Rectangle(bounds);
    rect.matrix = item.globalMatrix;
    setDefaultGuideStyle(rect);
    rect.parent = getGuideLayer();
    setSelectionStrokeWidth(rect);
    rect.strokeColor = GUIDE_ACCENT;
    rect.fillColor = null;
    rect.data.isHelperItem = true;
    rect.data.origItem = item;
    rect.bringToFront();

    return rect;
};

// hack: black line under the marquee/lasso, resynced every frame cuz they change while dragging
const inkUnder = function (path) {
    const ink = new paper.Path({insert: false});
    ink.guide = true;
    ink.locked = true;
    ink.data.isHelperItem = true;
    ink.strokeColor = 'black';
    ink.fillColor = null;
    let sig = '';
    const sync = () => {
        if (!path.isInserted()) {
            ink.remove();
            return;
        }
        const b = path.bounds;
        const last = path.lastSegment ? path.lastSegment.point : null;
        const next = `${path.segments.length}|${b.x}|${b.y}|${b.width}|${b.height}|${path.closed}|${last && last.x}|${last && last.y}|${paper.view.zoom}`;
        if (next === sig) return;
        sig = next;
        ink.removeSegments();
        ink.addSegments(path.segments.map(seg => seg.clone()));
        ink.closed = path.closed;
        ink.strokeWidth = (SELECTION_STROKE_WIDTH + 2) / paper.view.zoom;
    };
    ink.insertBelow(path);
    sync();
    ink.onFrame = sync;
    return ink;
};
const rectSelect = function (event, color) {
    const half = new paper.Point(0.5 / paper.view.zoom, 0.5 / paper.view.zoom);
    const start = event.downPoint.add(half);
    const end = event.point.add(half);
    const rect = new paper.Path.Rectangle(start, end);
    const zoom = 1.0 / paper.view.zoom;
    setDefaultGuideStyle(rect);
    rect.parent = getGuideLayer();
    rect.strokeColor = color || GUIDE_ACCENT;
    rect.strokeWidth = SELECTION_STROKE_WIDTH * zoom;
    rect.fillColor = color ? null : GUIDE_ACCENT_WASH;
    rect.data.isRectSelect = true;
    rect.data.isHelperItem = true;
    rect.dashArray = [4.0 * zoom, 3.0 * zoom];
    inkUnder(rect);
    return rect;
};

const styleSelectionGuide = function (path) {
    const zoom = 1.0 / paper.view.zoom;
    setDefaultGuideStyle(path);
    path.parent = getGuideLayer();
    path.strokeColor = GUIDE_ACCENT;
    path.strokeWidth = SELECTION_STROKE_WIDTH * zoom;
    path.fillColor = GUIDE_ACCENT_WASH;
    path.data.isHelperItem = true;
    path.dashArray = [4.0 * zoom, 3.0 * zoom];
    inkUnder(path);
};

const getGuideColor = function () {
    return GUIDE_ACCENT;
};

const _removePaperItemsByDataTags = function (tags) {
    const allItems = getAllRootItems(true);
    for (const item of allItems) {
        for (const tag of tags) {
            if (item.data && item.data[tag]) {
                item.remove();
            }
        }
    }
};

const _removePaperItemsByTags = function (tags) {
    const allItems = getAllRootItems(true);
    for (const item of allItems) {
        for (const tag of tags) {
            if (item[tag]) {
                item.remove();
            }
        }
    }
};

const removeBoundsPath = function () {
    _removePaperItemsByDataTags(['isSelectionBound', 'isRotHandle', 'isScaleHandle', 'isPivotHandle']);
};

const removeBoundsHandles = function () {
    _removePaperItemsByDataTags(['isRotHandle', 'isScaleHandle', 'isPivotHandle']);
};

const removeAllGuides = function () {
    _removePaperItemsByTags(['guide']);
};

const removeHitPoint = function () {
    _removePaperItemsByDataTags(['isHitPoint']);
};

const drawHitPoint = function (point) {
    removeHitPoint();
    if (point) {
        const hitPoint = paper.Path.Circle(point, 4 / paper.view.zoom /* radius */);
        hitPoint.strokeWidth = 1 / paper.view.zoom;
        hitPoint.strokeColor = GUIDE_ACCENT;
        hitPoint.fillColor = new paper.Color(1, 1, 1, 0.5);
        hitPoint.parent = getGuideLayer();
        hitPoint.data.isHitPoint = true;
        hitPoint.data.isHelperItem = true;
    }
};

export {
    SELECTION_STROKE_WIDTH,
    GUIDE_ACCENT,
    GUIDE_ACCENT_WASH,
    GUIDE_HALO,
    hoverItem,
    hoverBounds,
    rectSelect,
    styleSelectionGuide,
    removeAllGuides,
    removeBoundsHandles,
    removeBoundsPath,
    drawHitPoint,
    removeHitPoint,
    getGuideColor,
    setDefaultGuideStyle
};
