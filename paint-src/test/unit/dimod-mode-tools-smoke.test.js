/* eslint-env jest */

import ConnectedModeTools, {ModeToolsComponent} from '../../src/components/mode-tools/mode-tools.jsx';
import ModeToolsContainer from '../../src/containers/mode-tools.jsx';
import {AlignReferences} from '../../src/dimod/items';

test('the mode tools component and container load', () => {
    expect(typeof ConnectedModeTools).toBe('function');
    expect(typeof ModeToolsContainer).toBe('function');
});

test('the align handlers are declared props', () => {
    const propTypes = ModeToolsComponent.propTypes;
    for (const name of [
        'onAlignLeftEdges', 'onAlignHorizontalCenters', 'onAlignRightEdges',
        'onAlignTopEdges', 'onAlignVerticalCenters', 'onAlignBottomEdges',
        'onDistributeHorizontally', 'onDistributeVertically',
        'onAlignToSelection', 'onAlignToCanvas', 'onAlignToRotationCenter',
        'alignReference'
    ]) {
        expect(propTypes[name]).toBeDefined();
    }
});

test('the align references are the three the spec calls for', () => {
    expect(Object.keys(AlignReferences)).toEqual(['SELECTION', 'ART_BOARD', 'ROTATION_CENTER']);
});
