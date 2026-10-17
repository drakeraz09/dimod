/* eslint-env jest */
import paper from '@turbowarp/paper';

import {applySelectionColor, setupLayers} from '../../src/helper/layer';
import {GUIDE_ACCENT} from '../../src/lib/guide-colors';

const accent = () => new paper.Color(GUIDE_ACCENT);

beforeEach(() => {
    paper.setup(new paper.Size(960, 720));
});

test('paper draws its own selection in the accent, not its built-in blue', () => {
    setupLayers('VECTOR');
    const path = new paper.Path.Rectangle({point: [10, 10], size: [20, 20], fillColor: '#ff0000'});

    expect(path.getSelectedColor(true)).toBeNull();
    const inherited = path.getLayer().getSelectedColor(true);
    expect(inherited.equals(accent())).toBe(true);
});

test('it survives the layers being rebuilt, which is what undo does', () => {
    setupLayers('VECTOR');
    const art = new paper.Path.Rectangle({point: [10, 10], size: [20, 20], fillColor: '#ff0000'});
    expect(art.getLayer().data.isPaintingLayer).toBe(true);
    const json = paper.project.exportJSON({asString: false});

    for (let i = paper.project.layers.length - 1; i >= 0; i--) {
        const layer = paper.project.layers[i];
        if (!layer.data.isBackgroundGuideLayer &&
            !layer.data.isDragCrosshairLayer &&
            !layer.data.isOutlineLayer) {
            layer.removeChildren();
            layer.remove();
        }
    }
    paper.project.importJSON(json);

    const rebuilt = paper.project.layers.find(layer => layer.data.isPaintingLayer);
    expect(rebuilt.getSelectedColor(true)).toBeNull();

    applySelectionColor();
    expect(rebuilt.getSelectedColor(true).equals(accent())).toBe(true);
});
