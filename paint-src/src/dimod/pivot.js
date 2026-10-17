import {getChangeVersion} from './render';
import paper from '@turbowarp/paper';
import {CENTER} from '../helper/view';
const SNAP_THRESHOLD = 8;
const CENTER_SNAP_THRESHOLD = 20;
const AGREEMENT_TOLERANCE = 1e-6;
const hasPivot = function (item) { return Boolean(item && item.pivot); };
const getPivot = function (item) {
    if (!hasPivot(item)) return null;
    return item.localToGlobal(item.pivot);
};
const getEffectivePivot = function (item) { return getPivot(item) || item.bounds.center; };
const setPivot = function (item, point) { item.pivot = item.globalToLocal(point); };
const clearPivot = function (item) { item.pivot = null; };
let boundsMemo = null;
const getSelectionBounds = function (items) {
    const version = getChangeVersion();
    if (boundsMemo && boundsMemo.version === version && boundsMemo.items.length === items.length &&
            boundsMemo.items.every((item, i) => item === items[i])) { return boundsMemo.rect && boundsMemo.rect.clone(); }
    let rect = null;
    for (const item of items) { rect = rect ? rect.unite(item.bounds) : item.bounds; }
    boundsMemo = {version, items: items.slice(), rect: rect && rect.clone()};
    return rect;
};
const primeSelectionBounds = function (items, rect) {
    boundsMemo = {version: getChangeVersion(), items: items.slice(), rect: rect.clone()};
};
const getSelectionPivot = function (items) {
    if (!items || items.length === 0) return null;
    const first = getPivot(items[0]);
    if (!first) return null;
    for (let i = 1; i < items.length; i++) {
        const other = getPivot(items[i]);
        if (!other || !other.isClose(first, AGREEMENT_TOLERANCE)) return null;
    }
    return first;
};
const getEffectiveSelectionPivot = function (items) {
    const pivot = getSelectionPivot(items);
    if (pivot) return pivot;
    const bounds = getSelectionBounds(items);
    return bounds ? bounds.center : null;
};
const setSelectionPivot = function (items, point) {
    for (const item of items) { setPivot(item, point); }
};
const clearSelectionPivot = function (items) {
    for (const item of items) { clearPivot(item); }
};
const getSnapTargets = function (items) {
    const strong = point => ({point, radius: CENTER_SNAP_THRESHOLD});
    const weak = point => ({point, radius: SNAP_THRESHOLD});
    const bounds = getSelectionBounds(items);
    if (!bounds) return [strong(CENTER)];
    return [
        strong(bounds.center), strong(CENTER),
        weak(bounds.topLeft), weak(bounds.topCenter), weak(bounds.topRight),
        weak(bounds.leftCenter), weak(bounds.rightCenter),
        weak(bounds.bottomLeft), weak(bounds.bottomCenter), weak(bounds.bottomRight)
    ];
};
const snapPivot = function (items, point) {
    let best = null;
    let bestScore = 1;
    for (const target of getSnapTargets(items)) {
        const radius = target.radius / paper.view.zoom;
        const score = target.point.getDistance(point) / radius;
        if (score < bestScore) { best = target.point; bestScore = score; }
    }
    return best ? best.clone() : point;
};
const isDefaultPivot = function (items, point) {
    const bounds = getSelectionBounds(items);
    return Boolean(bounds && bounds.center.isClose(point, AGREEMENT_TOLERANCE));
};
let lastTurn = null;
const unitedBounds = items => items.reduce((bounds, item) => bounds.unite(item.bounds), items[0].bounds);
const getRotationPivot = function (items) {
    const anchor = getSelectionPivot(items);
    if (anchor) return anchor;
    const bounds = unitedBounds(items);
    if (lastTurn && lastTurn.items.length === items.length &&
        items.every((item, i) => item === lastTurn.items[i]) &&
        bounds.topLeft.getDistance(lastTurn.after.topLeft) < 0.01 &&
        bounds.bottomRight.getDistance(lastTurn.after.bottomRight) < 0.01) { return lastTurn.point; }
    return bounds.center;
};
const noteRotation = function (items, point) {
    lastTurn = items.length ? {items: items.slice(), point, after: unitedBounds(items)} : null;
};
export {
    getRotationPivot,
    noteRotation,
    SNAP_THRESHOLD,
    CENTER_SNAP_THRESHOLD,
    hasPivot,
    getPivot,
    getEffectivePivot,
    setPivot,
    clearPivot,
    getSelectionBounds,
    getSelectionPivot,
    getEffectiveSelectionPivot,
    setSelectionPivot,
    clearSelectionPivot,
    getSnapTargets,
    snapPivot,
    isDefaultPivot,
    primeSelectionBounds
};
