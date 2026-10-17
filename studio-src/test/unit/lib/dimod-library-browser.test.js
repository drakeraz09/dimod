jest.mock('../../../src/lib/dimod-collab', () => ({
    broadcastCostumeAdd: jest.fn(), broadcastSoundAdd: jest.fn(), broadcastTargetCreate: jest.fn()
}));
jest.mock('../../../src/lib/block-space/editor', () => ({libraryApi: {list: jest.fn()}}));

import {assetBrowser, toEntry} from '../../../src/lib/dimod-assets';

const row = over => ({
    id: 'a1', kind: 'costume', name: 'Cat', tags: ['animals'], data_format: 'gif',
    file_url: 'https://cdn.example/x.gif', thumb_url: 'https://cdn.example/x.png',
    rotation_center_x: 10, rotation_center_y: 20, bitmap_resolution: 2, ...over
});

describe('dimod library browser', () => {
    test('a costume row becomes a picker entry the pickers know is from Dimod', () => {
        const e = toEntry(row());
        expect(e).toMatchObject({
            dimodLibraryId: 'a1', name: 'Cat', dataFormat: 'gif', fromPenguinModLibrary: true,
            libraryFilePage: 'https://cdn.example/x.gif', rotationCenterX: 10, rotationCenterY: 20, bitmapResolution: 2
        });
        expect(e._key).toBe('dimod-a1');
    });
    test('sprites carry their file, sounds no image fields', () => {
        expect(toEntry(row({kind: 'sprite', file_url: 'https://cdn.example/s.sprite3'})))
            .toMatchObject({fromDimodLibrary: true, spriteFileUrl: 'https://cdn.example/s.sprite3'});
        expect(toEntry(row({kind: 'sound', data_format: 'ogg'})).rotationCenterX).toBeUndefined();
    });
    test('fetch asks /browse with only the filters that are set, and maps the rows', async () => {
        global.fetch = jest.fn(() => Promise.resolve({ok: true, json: () => Promise.resolve({items: [row()], more: true})}));
        const out = await assetBrowser('costume').fetch({q: 'cat', tag: '', page: 0});
        const url = global.fetch.mock.calls[0][0];
        expect(url).toMatch(/\/library-assets\/browse\?kind=costume&q=cat$/);
        expect(out.more).toBe(true);
        expect(out.items[0].dimodLibraryId).toBe('a1');
    });
    test('a failed request rejects with the server error', async () => {
        global.fetch = jest.fn(() => Promise.resolve({ok: false, status: 500, json: () => Promise.resolve({error: 'nope'})}));
        let error = null;
        try {
            await assetBrowser('sound').fetch({q: '', tag: 'loops', page: 1});
        } catch (e) {
            error = e;
        }
        expect(error && error.message).toBe('nope');
        expect(global.fetch.mock.calls[0][0]).toMatch(/kind=sound&tag=loops&page=1$/);
    });
});
