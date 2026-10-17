import {referencedAssetNames, missingReferencedAssets} from '../../../src/lib/dimod-project';

const encode = obj => new TextEncoder().encode(JSON.stringify(obj));

const projectWith = targets => ({
    'project.json': encode({targets})
});

const asset = () => new Uint8Array([1, 2, 3]);

describe('referencedAssetNames', () => {
    test('collects costume and sound filenames from md5ext', () => {
        const files = projectWith([
            {costumes: [{md5ext: 'aaa.svg'}, {md5ext: 'bbb.png'}], sounds: [{md5ext: 'ccc.wav'}]}
        ]);
        expect(referencedAssetNames(files)).toEqual(new Set(['aaa.svg', 'bbb.png', 'ccc.wav']));
    });

    test('falls back to assetId + dataFormat when md5ext is absent', () => {
        const files = projectWith([
            {costumes: [{assetId: 'ddd', dataFormat: 'svg'}], sounds: []}
        ]);
        expect(referencedAssetNames(files)).toEqual(new Set(['ddd.svg']));
    });

    test('finds assets nested anywhere, not just under targets', () => {
        const files = {'project.json': encode({
            targets: [],
            customFonts: [{md5ext: 'font.ttf'}],
            somethingNew: {deeply: {nested: {md5ext: 'future.svg'}}}
        })};
        expect(referencedAssetNames(files)).toEqual(new Set(['font.ttf', 'future.svg']));
    });

    test('returns null for an unreadable project.json so callers keep everything', () => {
        expect(referencedAssetNames({'project.json': new TextEncoder().encode('{not json')})).toBe(null);
    });

    test('returns an empty set when there is no project.json at all', () => {
        expect(referencedAssetNames({})).toEqual(new Set());
    });
});

describe('missingReferencedAssets', () => {
    test('is empty when every referenced asset is present', () => {
        const files = projectWith([{costumes: [{md5ext: 'aaa.svg'}], sounds: []}]);
        files['aaa.svg'] = asset();
        expect(missingReferencedAssets(files)).toEqual([]);
    });

    test('reports a costume named by project.json whose bytes are missing', () => {
        const files = projectWith([
            {costumes: [{md5ext: 'here.svg'}, {md5ext: 'gone.svg'}], sounds: []}
        ]);
        files['here.svg'] = asset();
        expect(missingReferencedAssets(files)).toEqual(['gone.svg']);
    });

    test('ignores extra files the project no longer references', () => {
        const files = projectWith([{costumes: [{md5ext: 'here.svg'}], sounds: []}]);
        files['here.svg'] = asset();
        files['deleted.svg'] = asset();
        expect(missingReferencedAssets(files)).toEqual([]);
    });

    test('reports nothing when project.json cannot be parsed', () => {
        expect(missingReferencedAssets({'project.json': new TextEncoder().encode('nope')})).toEqual([]);
    });
});
