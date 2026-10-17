import {lint} from '../../../src/lib/block-space/runtime';

const flagged = code => lint(code).map(p => code.slice(p.start, p.end));

describe('blockspace source lint', () => {
    test('a loop that never awaits is an error', () => {
        expect(lint('while (true) { me.x++; }')[0].severity).toBe('error');
        expect(flagged('for (;;) { me.x++ }')).toEqual(['for (;;)']);
    });
    test('a loop that awaits, breaks or returns is fine', () => {
        expect(lint('while (true) { me.x++; await nextFrame(); }')).toEqual([]);
        expect(lint('while (true) { if (a) break; }')).toEqual([]);
    });
    test('comments and strings are ignored', () => {
        expect(lint('// while (true) {}\nconst s = "wait(1)";')).toEqual([]);
    });
    test('wait() without await is a warning', () => {
        expect(flagged('wait(1);\nawait wait(1);\nnextFrame();')).toEqual(['wait', 'nextFrame']);
    });
});
