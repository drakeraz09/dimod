import VM from 'scratch-vm';
import Sprite from 'scratch-vm/src/sprites/sprite';
import {BlocksContainer} from '../../../src/containers/blocks.jsx';


const makeTarget = (runtime, name, isStage) => {
    const sprite = new Sprite(null, runtime);
    sprite.name = name;
    const target = sprite.createClone();
    target.isStage = Boolean(isStage);
    runtime.addTarget(target);
    return target;
};
const newVM = () => {
    const vm = new VM();
    makeTarget(vm.runtime, 'Stage', true);
    return vm;
};
const createEvent = (blockId, targetId) => ({
    type: 'create',
    blockId,
    dimodTargetId: targetId,
    xml: {outerHTML: `<block type="motion_movesteps" id="${blockId}" x="0" y="0"></block>`},
    ids: [blockId]
});

const route = BlocksContainer.prototype.handleVmBlockEvent;

describe('block event routing', () => {
    test('an event made on one sprite goes to it, not the sprite open now', () => {
        const vm = newVM();
        const a = makeTarget(vm.runtime, 'A');
        const b = makeTarget(vm.runtime, 'B');
        vm.setEditingTarget(b.id);
        route.call({props: {vm}}, createEvent('fromA', a.id));
        expect(a.blocks.getBlock('fromA')).toBeTruthy();
        expect(b.blocks.getBlock('fromA')).toBeFalsy();
        expect(vm.runtime.getEditingTarget()).toBe(b);
    });
    test('unstamped or same-sprite events go to the open sprite, as before', () => {
        const vm = newVM();
        const a = makeTarget(vm.runtime, 'A');
        vm.setEditingTarget(a.id);
        route.call({props: {vm}}, createEvent('plain', null));
        route.call({props: {vm}}, createEvent('same', a.id));
        expect(a.blocks.getBlock('plain')).toBeTruthy();
        expect(a.blocks.getBlock('same')).toBeTruthy();
    });
    test('an event for a sprite that is gone (or "(none)") goes nowhere', () => {
        const vm = newVM();
        const a = makeTarget(vm.runtime, 'A');
        vm.setEditingTarget(a.id);
        route.call({props: {vm}}, createEvent('lost', '(none)'));
        expect(a.blocks.getBlock('lost')).toBeFalsy();
    });
});
