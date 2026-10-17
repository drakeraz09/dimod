import {
    collectHints,
    colorTexts,
    defaultFor,
    findColors,
    findEditorCalls,
    findSites,
    formatNumber,
    literalFor,
    normalizeSpec,
    objectAt,
    parseColor,
    stepOf
} from '../../../src/lib/block-space/runtime';

/* eslint-disable no-template-curly-in-string */
const LIB = [
    'editor.props("spawnEnemy", {',
    '    hp: {type: "slider", min: 1, max: 20},',
    '    speed: {step: 10},',
    '    tint: "color",',
    '    kind: ["slime", "bat"], // choices',
    '    flying: "toggle",',
    '    skin: \'costume\',',
    '    body: {fields: {w: "number"}}',
    '});',
    'editor.value("GRAVITY", {min: 0, max: 2000, step: 50});',
    'editor.args("shake", [{type: "slider", max: 50}, "easing"]);',
    'editor.snippet("enemy", \'spawnEnemy({hp: ${1:3}});\', "spawn one");'
].join('\n');
const hints = collectHints([LIB]);
const found = code => findSites(code, hints).sites.map(site => `${code.slice(site.start, site.end)}:${site.spec.type}`);

describe('blockspace editor hints', () => {
    test('editor.*() calls are read from the text', () => {
        expect(findEditorCalls(LIB).map(call => [call.method, call.name, Boolean(call.problem)])).toEqual([
            ['props', 'spawnEnemy', false],
            ['value', 'GRAVITY', false],
            ['args', 'shake', false],
            ['snippet', 'enemy', false]
        ]);
        expect(hints.snippets).toEqual([
            {prefix: 'enemy', body: 'spawnEnemy({hp: ${1:3}});', description: 'spawn one'}
        ]);
    });
    test('what is not written out is a problem, not a hint', () => {
        const calls = findEditorCalls(
            'editor.props("a", {hp: someVar});\neditor.value(name, "color");\nmy.editor.props("b", {});');
        expect(calls.length).toBe(2);
        expect(calls.every(call => call.problem)).toBe(true);
        expect(collectHints(['editor.props("a", {hp: someVar});']).values.size).toBe(0);
    });
    test('calls in comments and strings do not count', () => {
        expect(findEditorCalls('// editor.props("a", {})\nconst s = "editor.props(\\"a\\", {})";')).toEqual([]);
    });
    test('short forms of a widget', () => {
        expect(normalizeSpec('color')).toEqual({type: 'color'});
        expect(normalizeSpec(['a', 'b'])).toEqual({type: 'select', options: ['a', 'b']});
        expect(normalizeSpec({min: 0, max: 5}).type).toBe('slider');
        expect(normalizeSpec({step: 2}).type).toBe('number');
        expect(normalizeSpec({w: 'number'})).toEqual({type: 'props', fields: {w: normalizeSpec('number')}});
        expect(normalizeSpec('nonsense')).toBe(null);
    });
    test('the properties of a described object get their widgets', () => {
        expect(found('spawnEnemy({hp: 3, speed: base * 2, tint: \'#ff0000\', kind: "bat", flying: true, ' +
            'skin: "", body: {w: 1.5}, other: 5});')).toEqual([
            '3:slider', '\'#ff0000\':color', '"bat":select', 'true:toggle', '"":costume', '1.5:number'
        ]);
    });
    test('methods, lists of objects, assignments and arguments', () => {
        expect(found('world.spawnEnemy([{hp: 1}, {hp: -2.5, }]);')).toEqual(['1:slider', '-2.5:slider']);
        expect(found('const GRAVITY = 900\nif (GRAVITY == 3) me.GRAVITY = 1200;'))
            .toEqual(['900:slider', '1200:slider']);
        expect(found('shake(12, "easeOutQuad");')).toEqual(['12:slider', '"easeOutQuad":easing']);
    });
    test('a value of the wrong kind, a comment, a string and the definition itself get none', () => {
        expect(found('spawnEnemy({hp: "3", tint: "red", flying: 1});')).toEqual([]);
        expect(found('// spawnEnemy({hp: 9})\nconst s = "spawnEnemy({hp: 9})";')).toEqual([]);
        expect(found(LIB)).toEqual([]);
    });
    test('where a property name can go', () => {
        const code = 'spawnEnemy({hp: 3, body: {w: 1}, });';
        const {objects} = findSites(code, hints);
        const at = text => objectAt(code, objects, code.indexOf(text));
        expect(at(' });').keys).toEqual(['hp', 'body']);
        expect(at('3,')).toBe(null);
        expect(at('w: 1').keys).toEqual(['w']);
        const open = 'spawnEnemy({hp: 4, ';
        expect(objectAt(open, findSites(open, hints).objects, open.length).keys).toEqual(['hp']);
    });
    test('colour strings anywhere get the picker; comments and longer strings do not', () => {
        const code = 'me.pen.color = "#F80"; const a = \'rgba(255, 0, 0, 0.5)\'; // "#fff"\n' +
            'say("it is #fff"); const b = "hsl(120, 100%, 50%)"; const c = "#12";';
        expect(findColors(code).map(c => code.slice(c.start, c.end)))
            .toEqual(['"#F80"', '\'rgba(255, 0, 0, 0.5)\'', '"hsl(120, 100%, 50%)"']);
        expect(parseColor('#F80')).toEqual({red: 1, green: 136 / 255, blue: 0, alpha: 1, format: 'hex'});
        expect(parseColor('hsl(120, 100%, 50%)')).toEqual({red: 0, green: 1, blue: 0, alpha: 1, format: 'hsl'});
        expect(parseColor('rgb(a, b, c)')).toBe(null);
        expect(colorTexts({red: 1, green: 0, blue: 0, alpha: 0.5}))
            .toEqual({hex: '#ff000080', rgb: 'rgba(255, 0, 0, 0.5)', hsl: 'hsla(0, 100%, 50%, 0.5)'});
    });
    test('writing values back', () => {
        const gravity = hints.values.get('GRAVITY');
        expect(stepOf(gravity, '900')).toBe(50);
        expect(stepOf(normalizeSpec('number'), '1.25')).toBe(0.01);
        expect(formatNumber(5000, gravity, 50)).toBe('2000');
        expect(formatNumber(1.5 + (0.1 * 3), normalizeSpec('number'), 0.1)).toBe('1.8');
        expect(literalFor({valueType: 'string', quote: '\''}, 'it\'s')).toBe('\'it\\\'s\'');
        expect(literalFor({valueType: 'number'}, 'bat')).toBe('"bat"');
        expect(literalFor({valueType: 'string', quote: '"'}, 3)).toBe('3');
        expect(defaultFor(normalizeSpec({min: 5, max: 9}))).toBe(5);
        expect(defaultFor(normalizeSpec(['a', 'b']))).toBe('a');
    });
});
