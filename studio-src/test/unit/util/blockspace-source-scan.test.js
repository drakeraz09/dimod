import {findBlockspaces, applyEdits, payloadEdit} from '../../../src/lib/block-space/runtime';
import {viewOf, codeOf, locate} from '../../../src/lib/block-space/editor';

describe('Blockspace source scan', () => {
    test('finds calls with ids and JSON payloads, in order', () => {
        const src = `var rrr = new Blockspace("rrr", {"params":["a"],"blocks":{}});
const b = new Blockspace('two');
new  Blockspace ( "three" , {"x": "a } string"} , );`;
        const calls = findBlockspaces(src);
        expect(calls.map(c => c.id)).toEqual(['rrr', 'two', 'three']);
        expect(calls[0].payload).toEqual({params: ['a'], blocks: {}});
        expect(calls[1].payload).toBe(null);
        expect(calls[2].payload).toEqual({x: 'a } string'});
        expect(src.slice(calls[0].start, calls[0].end)).toBe('new Blockspace("rrr", {"params":["a"],"blocks":{}})');
    });

    test('ignores comments, strings, templates and regexes', () => {
        const src = `// new Blockspace("c1")
/* new Blockspace("c2") */
const s = "new Blockspace('s')";
const t = \`new Blockspace("t") \${ \`nested new Blockspace("n")\` } \${ {a: 1}.a }\`;
const r = /new Blockspace\\("r"/g;
const x = 4 / 2 / 1;
const real = new Blockspace("real");`;
        expect(findBlockspaces(src).map(c => c.id)).toEqual(['real']);
    });

    test('reports calls it can\'t read (non-literal id) with id null', () => {
        const calls = findBlockspaces('const id = "a"; new Blockspace(id, {});');
        expect(calls.length).toBe(1);
        expect(calls[0].id).toBe(null);
    });

    test('payloadEdit replaces or adds a payload', () => {
        const src = 'new Blockspace("a", {"old":1}); new Blockspace("b");';
        const calls = findBlockspaces(src);
        const out = applyEdits(src, [payloadEdit(calls[0], {n: 1}), payloadEdit(calls[1], {n: 2})]);
        expect(out).toBe('new Blockspace("a", {"n":1}); new Blockspace("b", {"n":2});');
    });

    const code = 'const a = new Blockspace("a", {"n":1});\nnew Blockspace("b", {"n":2});\nlog(1);\n';

    test('the view hides payloads, keeping every line where it was', () => {
        const view = viewOf(code);
        expect(view).toBe('const a = new Blockspace("a");\nnew Blockspace("b");\nlog(1);\n');
        expect(codeOf(view, code)).toBe(code);
    });

    test('typing in the view keeps the current payloads (blocks edited meanwhile win)', () => {
        const edited = code.replace('{"n":1}', '{"n":99}');
        const view = `${viewOf(code)}log(2);\n`;
        expect(codeOf(view, edited)).toBe(`${edited}log(2);\n`);
    });

    test('deleting a line and undoing it brings its payload back', () => {
        const remembered = new Map();
        const withoutB = codeOf('const a = new Blockspace("a");\nlog(1);\n', code, remembered);
        expect(withoutB).toBe('const a = new Blockspace("a", {"n":1});\nlog(1);\n');
        expect(codeOf(viewOf(code), withoutB, remembered)).toBe(code);
    });

    test('renaming one blockspace carries its payload', () => {
        const view = viewOf(code).replace('"b"', '"bee"');
        expect(codeOf(view, code)).toBe(code.replace('"b"', '"bee"'));
    });

    const change = (text, offset, removed) => ({
        offset, removed, before: text.slice(Math.max(0, offset - 12), offset),
        after: text.slice(offset + removed.length, offset + removed.length + 12)
    });

    test('an edit lands where it was made', () => {
        const text = 'me.x = 1;\nme.y = 2;\n';
        expect(locate(text, change(text, 17, '2'))).toBe(17);
    });

    test('an edit follows its text when someone else typed above it meanwhile', () => {
        const theirs = 'me.x = 1;\nme.y = 2;\n';
        const edit = change(theirs, 17, '2');
        const mine = `// my new comment\n${theirs}`;
        expect(locate(mine, edit)).toBe(17 + '// my new comment\n'.length);
    });

    test('an edit whose text is gone is dropped (the hash check repairs it)', () => {
        const theirs = 'me.x = 1;\nme.y = 2;\n';
        expect(locate('something else entirely', change(theirs, 17, '2'))).toBe(-1);
    });

    test('of several matches, the nearest one wins', () => {
        const text = 'a = 1;\nb = 1;\na = 1;\n';
        const edit = {offset: 18, removed: '1', before: 'a = ', after: ';\n'};
        expect(locate(`x${text}`, edit)).toBe(19);
    });
});

