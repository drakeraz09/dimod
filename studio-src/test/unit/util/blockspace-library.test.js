import {
    findImports,
    wrapImport,
    renameCollisions,
    insertImport,
    updateImport
} from '../../../src/lib/block-space/editor';

const entry = {id: 'abc123XY', version: 1, name: 'Save system', author: 'ann'};

describe('Blockspace library', () => {
    test('wrapImport and findImports round trip', () => {
        const wrapped = wrapImport(entry, 'const a = 1;\n');
        expect(wrapped).toBe('// @library abc123XY v1 Save system by ann\nconst a = 1;\n// @end library abc123XY');
        const text = `before();\n${wrapped}\nafter();`;
        const [imp] = findImports(text);
        expect(imp).toMatchObject({id: 'abc123XY', version: 1, label: 'Save system by ann'});
        expect(text.slice(imp.start, imp.end)).toBe(wrapped);
        expect(text.slice(imp.innerStart, imp.innerEnd)).toBe('const a = 1;\n');
    });

    test('an unclosed or mismatched marker is not an import', () => {
        expect(findImports('// @library abc123XY v1\ncode')).toEqual([]);
        expect(findImports('// @library abc123XY v1\ncode\n// @end library zzzzzz9')).toEqual([]);
    });

    test('blockspaces with a taken id get a new one, and the entry follows it', () => {
        const code = 'const j = new Blockspace("jump", {"blocks": {}});\nme.run(j);\nme.run(me.blockspace("jump"));';
        const {code: out, renamed} = renameCollisions(code, new Set(['jump', 'jump2']));
        expect(renamed).toEqual([['jump', 'jump3']]);
        expect(out).toContain('new Blockspace("jump3"');
        expect(out).toContain('me.blockspace("jump3")');
        expect(renameCollisions(code, new Set()).code).toBe(code);
    });

    test('insertImport puts it at the caret, after an import it lands inside, with room around it', () => {
        const text = 'a();\nb();\n';
        const one = insertImport(text, 5, entry, 'x();');
        expect(one.text).toBe('a();\n\n// @library abc123XY v1 Save system by ann\nx();\n// @end library abc123XY\nb();\n');
        expect(one.text.slice(one.start, one.end)).toContain('@library abc123XY v1');
        const other = {id: 'zzzzzz99', version: 3, name: 'Other', author: 'bob'};
        const inside = one.text.indexOf('x();');
        const two = insertImport(one.text, inside, other, 'y();');
        expect(findImports(two.text).map(i => i.id)).toEqual(['abc123XY', 'zzzzzz99']);
    });

    test('updateImport replaces just the entry, keeping its own blockspace ids', () => {
        const v1 = 'const j = new Blockspace("jump", {"blocks": {}});';
        const first = insertImport('me.go();\nnew Blockspace("main");', 9, entry, v1);
        const [imp] = findImports(first.text);
        const updated = updateImport(first.text, imp, {...entry, version: 2}, 'const j = new Blockspace("jump", {"blocks": {"a": 1}});');
        expect(updated.renamed).toEqual([]);
        expect(updated.text).toContain('// @library abc123XY v2 Save system by ann');
        expect(updated.text).toContain('{"a": 1}');
        expect(updated.text.startsWith('me.go();\n')).toBe(true);
        expect(updated.text.endsWith('new Blockspace("main");')).toBe(true);
        expect(updated.text.match(/@library/g).length).toBe(1);
    });
});
