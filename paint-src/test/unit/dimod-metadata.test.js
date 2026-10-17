/* eslint-env jest, browser */

import {
    createDoc,
    deserializeDoc,
    isEmptyDoc,
    pruneDoc,
    readDoc,
    serializeDoc,
    writeDoc,
    attributeToDid,
    didToAttribute,
    generateDid,
    ID_LENGTH
} from '../../src/dimod/core';

const parse = string => new DOMParser().parseFromString(string, 'text/xml');
const serialize = function (dom) {
    if (typeof XMLSerializer === 'undefined') return dom.documentElement.outerHTML;
    return new XMLSerializer().serializeToString(dom);
};

test('did attribute round trip', () => {
    const did = generateDid();
    expect(did).toHaveLength(ID_LENGTH);
    expect(attributeToDid(didToAttribute(did))).toBe(did);
    expect(attributeToDid('some-other-id')).toBeNull();
    expect(attributeToDid(null)).toBeNull();
});

test('doc serialization round trip', () => {
    const doc = createDoc();
    doc.axes.push({id: 'a1', origin: [0, 0], angle: 30});
    expect(deserializeDoc(serializeDoc(doc))).toEqual(doc);
});

test('foreign metadata is ignored', () => {
    expect(deserializeDoc('Created with Inkscape')).toBeNull();
    expect(deserializeDoc('dimod-paint/1 {not json')).toBeNull();
});

test('a newer version is dropped rather than misread', () => {
    expect(deserializeDoc(`dimod-paint/1 ${JSON.stringify({v: 99, axes: [{id: 'a1'}]})}`)).toBeNull();
});

test('missing and malformed keys are normalized away', () => {
    const doc = deserializeDoc('dimod-paint/1 {"v":1,"swatches":{"a":"#fff"},"axes":"nope"}');
    expect(doc.swatches).toEqual({a: '#fff'});
    expect(doc.axes).toEqual([]);
    expect(doc.links).toEqual([]);
});

test('svg round trip alongside foreign metadata', () => {
    const doc = createDoc();
    doc.axes.push({id: 'a1', origin: [0, 0], angle: 30});
    const dom = parse('<svg xmlns="http://www.w3.org/2000/svg"><metadata>Created with Inkscape</metadata></svg>');
    writeDoc(dom.documentElement, doc);
    const reparsed = parse(serialize(dom));
    expect(readDoc(reparsed)).toEqual(doc);
    expect(reparsed.getElementsByTagName('metadata')).toHaveLength(2);
});

test('writing is idempotent and empty docs are not written', () => {
    const doc = createDoc();
    doc.axes.push({id: 'a1', origin: [0, 0], angle: 30});
    const dom = parse('<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeDoc(dom.documentElement, doc);
    writeDoc(dom.documentElement, doc);
    expect(dom.getElementsByTagName('metadata')).toHaveLength(1);

    expect(isEmptyDoc(createDoc())).toBe(true);
    writeDoc(dom.documentElement, createDoc());
    expect(dom.getElementsByTagName('metadata')).toHaveLength(0);
});

test('pruning drops half-present links', () => {
    const doc = createDoc();
    doc.links = [
        {id: 'l1', members: [{did: 'alive'}]},
        {id: 'l2', members: [{did: 'alive'}, {did: 'dead'}]},
        {id: 'l3'}
    ];
    pruneDoc(doc, new Set(['alive']));
    expect(doc.links.map(link => link.id)).toEqual(['l1']);
});
