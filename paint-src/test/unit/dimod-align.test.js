/* eslint-env jest */
import paper from '@turbowarp/paper';

import {
    AlignEdges,
    AlignReferences,
    DistributeAxes,
    alignItems,
    distributeItems,
    getReferenceRect
} from '../../src/dimod/items';
import {ART_BOARD_BOUNDS, CENTER} from '../../src/helper/view';

const rect = (x, y, width, height) => new paper.Path.Rectangle({
    point: [x, y],
    size: [width, height]
});

beforeEach(() => {
    paper.setup(new paper.Size(960, 720));
    paper.project.activeLayer.data.isPaintingLayer = true;
});

test('the reference is the selection, the art board or the rotation center', () => {
    const items = [rect(0, 0, 10, 10), rect(90, 40, 10, 10)];
    expect(getReferenceRect(items, AlignReferences.SELECTION))
        .toEqual(new paper.Rectangle(0, 0, 100, 50));
    expect(getReferenceRect(items, AlignReferences.ART_BOARD)).toEqual(ART_BOARD_BOUNDS);

    const center = getReferenceRect(items, AlignReferences.ROTATION_CENTER);
    expect(center.center.equals(CENTER)).toBe(true);
    expect(center.width).toBe(0);
});

test('aligning to the selection lines up the named edge', () => {
    const left = rect(0, 0, 10, 10);
    const right = rect(90, 40, 20, 20);
    const items = [left, right];

    expect(alignItems(items, AlignEdges.LEFT, AlignReferences.SELECTION)).toBe(true);
    expect(left.bounds.left).toBe(0);
    expect(right.bounds.left).toBe(0);
    expect(right.bounds.top).toBe(40);
});

test('aligning centers on the rotation center', () => {
    const item = rect(0, 0, 40, 20);
    alignItems([item], AlignEdges.HORIZONTAL_CENTER, AlignReferences.ROTATION_CENTER);
    alignItems([item], AlignEdges.VERTICAL_CENTER, AlignReferences.ROTATION_CENTER);
    expect(item.bounds.center.round()).toEqual(CENTER.round());
});

test('aligning to the art board uses its edges', () => {
    const item = rect(100, 100, 40, 20);
    alignItems([item], AlignEdges.BOTTOM, AlignReferences.ART_BOARD);
    expect(item.bounds.bottom).toBe(ART_BOARD_BOUNDS.bottom);
});

test('aligning reports when there was nothing to do', () => {
    const item = rect(0, 0, 10, 10);
    expect(alignItems([item], AlignEdges.LEFT, AlignReferences.SELECTION)).toBe(false);
    expect(alignItems([], AlignEdges.LEFT, AlignReferences.ART_BOARD)).toBe(false);
});

test('distributing equalizes the gaps and keeps the outermost items still', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(20, 0, 30, 10);
    const c = rect(100, 0, 10, 10);

    expect(distributeItems([c, a, b], DistributeAxes.HORIZONTAL)).toBe(true);
    expect(a.bounds.left).toBe(0);
    expect(c.bounds.right).toBe(110);
    expect(b.bounds.left - a.bounds.right).toBe(30);
    expect(c.bounds.left - b.bounds.right).toBe(30);
});

test('distributing works down the other axis too', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(0, 15, 10, 10);
    const c = rect(0, 100, 10, 10);
    distributeItems([a, b, c], DistributeAxes.VERTICAL);
    expect(b.bounds.top - a.bounds.bottom).toBe(c.bounds.top - b.bounds.bottom);
    expect(a.bounds.top).toBe(0);
    expect(c.bounds.bottom).toBe(110);
});

test('distributing fewer than three items is a no-op', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(50, 0, 10, 10);
    expect(distributeItems([a, b], DistributeAxes.HORIZONTAL)).toBe(false);
    expect(b.bounds.left).toBe(50);
});
