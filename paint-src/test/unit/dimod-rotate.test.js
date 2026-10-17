/* eslint-env jest, browser */
import paper from '@turbowarp/paper';

import RotateTool from '../../src/helper/selection-tools/rotate-tool';
import {setSelectionPivot} from '../../src/dimod/pivot';

let square;
let boundsPath;

const dragEvent = function (point, shift) {
    return {point: point, modifiers: {shift: Boolean(shift)}};
};

beforeEach(() => {
    paper.setup(new paper.Size(960, 720));
    square = new paper.Path.Rectangle({point: [100, 100], size: [100, 100], insert: true});
    square.fillColor = 'red';
    boundsPath = {bounds: square.bounds};
});

test('grabbing the rotation handle does not move the drawing', () => {
    const tool = new RotateTool(() => {});
    const grab = square.bounds.bottomCenter.add(0, 20);
    const before = square.bounds.clone();

    tool.onMouseDown(null, boundsPath, [square], grab);
    tool.onMouseDrag(dragEvent(grab));

    expect(square.bounds.topLeft.round()).toEqual(before.topLeft.round());
    expect(square.bounds.size.round()).toEqual(before.size.round());
});

test('grabbing it with an anchor set does not move the drawing either', () => {
    const tool = new RotateTool(() => {});
    setSelectionPivot([square], square.bounds.topLeft);
    const grab = square.bounds.bottomCenter.add(0, 20);
    const before = square.bounds.clone();

    tool.onMouseDown(null, boundsPath, [square], grab);
    tool.onMouseDrag(dragEvent(grab));

    expect(square.bounds.topLeft.round()).toEqual(before.topLeft.round());
});

test('the drawing rotates around the anchor, not the center of the bounds', () => {
    const tool = new RotateTool(() => {});
    const anchor = square.bounds.topLeft;
    setSelectionPivot([square], anchor);

    const grab = anchor.add(100, 0);
    tool.onMouseDown(null, boundsPath, [square], grab);
    tool.onMouseDrag(dragEvent(anchor.add(0, 100)));

    expect(square.bounds.topRight.round()).toEqual(anchor.round());
});

test('a selection that does not agree on an anchor rotates around its center', () => {
    const other = new paper.Path.Rectangle({point: [300, 300], size: [100, 100], insert: true});
    const items = [square, other];
    const bounds = square.bounds.unite(other.bounds);
    const tool = new RotateTool(() => {});

    setSelectionPivot([square], square.bounds.topLeft);
    const grab = bounds.bottomCenter.add(0, 20);
    tool.onMouseDown(null, {bounds: bounds}, items, grab);
    tool.onMouseDrag(dragEvent(bounds.center.add(bounds.center.subtract(grab))));

    expect(square.bounds.center.round()).toEqual(bounds.center.add(bounds.center.subtract(
        new paper.Point(150, 150))).round());
});
