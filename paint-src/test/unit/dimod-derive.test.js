/* eslint-env jest */
import {
    MAX_ITERATIONS,
    addLink,
    breakLink,
    clearDirty,
    getLink,
    getLinks,
    hasDirty,
    markDirty,
    registerKind,
    removeLink,
    runPass,
    schedulePass,
    setScheduler,
    resetDimod
} from '../../src/dimod/store';

beforeEach(() => {
    resetDimod();
    clearDirty();
});

test('a pass propagates every dirty key once and then stops', () => {
    const seen = [];
    registerKind('test-once', {propagate: keys => {
        seen.push([...keys].sort());
    }});
    markDirty('test-once', 'a');
    markDirty('test-once', 'b');
    markDirty('test-once', 'a');
    expect(hasDirty()).toBe(true);

    expect(runPass()).toEqual({changed: true, broken: []});
    expect(seen).toEqual([['a', 'b']]);
    expect(hasDirty()).toBe(false);

    expect(runPass()).toEqual({changed: false, broken: []});
});

test('a chain of kinds runs to convergence', () => {
    const order = [];
    registerKind('test-upstream', {propagate: keys => {
        order.push(`upstream:${[...keys].join()}`);
        return [{kind: 'test-downstream', key: 'd'}];
    }});
    registerKind('test-downstream', {propagate: keys => {
        order.push(`downstream:${[...keys].join()}`);
    }});
    markDirty('test-upstream', 'u');
    runPass();
    expect(order).toEqual(['upstream:u', 'downstream:d']);
});

test('a cycle is broken rather than chased, and the break is reported', () => {
    let propagations = 0;
    const broken = [];
    registerKind('test-cycle', {
        propagate: keys => {
            propagations++;
            return [...keys].map(key => ({kind: 'test-cycle', key}));
        },
        onBreak: key => broken.push(key)
    });
    markDirty('test-cycle', 'loop');

    const result = runPass();
    expect(propagations).toBeLessThanOrEqual(MAX_ITERATIONS);
    expect(result.broken).toEqual([{kind: 'test-cycle', key: 'loop'}]);
    expect(broken).toEqual(['loop']);
    expect(hasDirty()).toBe(false);
});

test('dirt for an unregistered kind is dropped, not thrown', () => {
    markDirty('test-nobody-home', 'x');
    expect(() => runPass()).not.toThrow();
    expect(hasDirty()).toBe(false);
});

test('a scheduled pass coalesces repeated marks into one run', () => {
    let pending = null;
    setScheduler({
        request: callback => {
            pending = callback;
            return 1;
        },
        cancel: () => {
            pending = null;
        }
    });
    let runs = 0;
    registerKind('test-scheduled', {propagate: () => {
        runs++;
    }});

    markDirty('test-scheduled', 'a');
    schedulePass();
    markDirty('test-scheduled', 'b');
    schedulePass();
    expect(runs).toBe(0);

    pending();
    expect(runs).toBe(1);
    setScheduler(null);
});

test('link records live in the document and can be broken without losing them', () => {
    addLink({id: 'l1', kind: 'symmetry', members: [{did: 'aaa'}]});
    addLink({id: 'l2', kind: 'other', members: [{did: 'bbb'}]});
    expect(getLinks('symmetry').map(link => link.id)).toEqual(['l1']);
    expect(getLink('l1').state).toBe('ok');

    expect(breakLink('l1', 'boolean op').state).toBe('broken');
    expect(getLink('l1').reason).toBe('boolean op');
    expect(getLinks()).toHaveLength(2);

    expect(removeLink('l1')).toBe(true);
    expect(removeLink('l1')).toBe(false);
    expect(getLinks()).toHaveLength(1);
});
