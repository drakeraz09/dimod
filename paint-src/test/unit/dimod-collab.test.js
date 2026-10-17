/* eslint-env jest, browser */
import paper from '@turbowarp/paper';

import {
    beginGesture,
    clearCollabTransport,
    commitLocalChanges,
    endGesture,
    getPeers,
    isApplyingRemote,
    receivePacket,
    remoteSeq,
    replayRemoteOpsSince,
    resetCollab,
    setCollabCostume,
    setCollabDocHost,
    setCollabHost,
    setCollabTransport
} from '../../src/dimod/collab';
import {getDid} from '../../src/dimod/core';
import {getDoc, rebuildIndex, resetDimod, setDoc} from '../../src/dimod/store';
import {getPivot, setPivot} from '../../src/dimod/pivot';
import {syncItemData} from '../../src/dimod/items';

const COSTUME = {targetId: 'sprite-1', costumeIndex: 0};
const PEER = 'peer-1';

let layer;
let sent;
let updateImage;
let syncStores;

const lastSent = () => sent[sent.length - 1];

const addSquare = (x, color) => {
    const square = new paper.Path.Rectangle({point: [x, 100], size: [50, 50], insert: true});
    square.fillColor = color;
    return square;
};

const asFreshPeer = () => {
    resetCollab();
    resetDimod();
    paper.setup(new paper.Size(960, 720));
    layer = paper.project.activeLayer;
    layer.data.isPaintingLayer = true;
    rebuildIndex();
    sent = [];
    setCollabCostume(COSTUME);
};

const layerShape = () => layer.children.map(item => ({
    did: getDid(item),
    fill: item.fillColor && item.fillColor.toCSS(true),
    bounds: item.bounds.toString()
}));

beforeEach(() => {
    paper.setup(new paper.Size(960, 720));
    resetDimod();
    resetCollab();
    layer = paper.project.activeLayer;
    layer.data.isPaintingLayer = true;
    rebuildIndex();

    sent = [];
    updateImage = jest.fn();
    syncStores = jest.fn();
    setCollabTransport({send: packet => sent.push(packet)});
    setCollabHost({updateImage});
    setCollabDocHost({syncStores});
    setCollabCostume(COSTUME);
});

afterEach(() => {
    clearCollabTransport();
    setCollabHost(null);
    setCollabDocHost(null);
    setCollabCostume(null);
});

describe('committing local changes', () => {
    test('the first commit of a session sends the whole layer, not a diff', () => {
        addSquare(100, 'red');
        commitLocalChanges(true);

        expect(sent).toHaveLength(1);
        expect(lastSent().op).toBe('reset');
        expect(lastSent().items).toHaveLength(1);
        expect(lastSent().targetId).toBe(COSTUME.targetId);
        expect(lastSent().costumeIndex).toBe(COSTUME.costumeIndex);
    });

    test('a reset gives every item a did, so both sides can agree on one', () => {
        addSquare(100, 'red');
        addSquare(200, 'blue');
        commitLocalChanges(true);

        const dids = lastSent().items.map(entry => entry.did);
        expect(dids.filter(Boolean)).toHaveLength(2);
        expect(new Set(dids).size).toBe(2);
    });

    test('later commits send only what changed', () => {
        const first = addSquare(100, 'red');
        commitLocalChanges(true);
        sent = [];

        addSquare(300, 'green');
        commitLocalChanges(true);

        expect(sent).toHaveLength(1);
        expect(lastSent().op).toBe('ops');
        expect(lastSent().ops).toHaveLength(1);
        expect(lastSent().ops[0].op).toBe('add');
        expect(lastSent().ops[0].did).not.toBe(getDid(first));
    });

    test('moving an item is a modify carrying its whole new state', () => {
        const square = addSquare(100, 'red');
        commitLocalChanges(true);
        sent = [];

        square.position = square.position.add(new paper.Point(40, 0));
        commitLocalChanges(true);

        expect(lastSent().ops).toEqual([
            expect.objectContaining({op: 'modify', did: getDid(square)})
        ]);
        expect(lastSent().ops[0].json).toBeTruthy();
    });

    test('deleting an item is a remove', () => {
        const square = addSquare(100, 'red');
        commitLocalChanges(true);
        const did = getDid(square);
        sent = [];

        square.remove();
        commitLocalChanges(true);

        expect(lastSent().ops).toEqual([{op: 'remove', did}]);
    });

    test('restacking items that were all already there sends the z-order', () => {
        const bottom = addSquare(100, 'red');
        const top = addSquare(200, 'blue');
        commitLocalChanges(true);
        sent = [];

        bottom.bringToFront();
        commitLocalChanges(true);

        expect(lastSent().ops).toEqual([
            {op: 'order', dids: [getDid(top), getDid(bottom)]}
        ]);
    });

    test('a commit that changed nothing says nothing', () => {
        addSquare(100, 'red');
        commitLocalChanges(true);
        sent = [];

        commitLocalChanges(true);

        expect(sent).toHaveLength(0);
    });

    test('bitmap commits are left to the host\'s whole-costume sync', () => {
        addSquare(100, 'red');
        commitLocalChanges(false );

        expect(sent).toHaveLength(0);
    });

    test('nothing is sent at all without a session', () => {
        clearCollabTransport();
        addSquare(100, 'red');
        commitLocalChanges(true);

        expect(sent).toHaveLength(0);
    });
});

describe('applying a peer\'s stream', () => {
    test('a peer who replays the whole stream ends up with the same layer', () => {
        const first = addSquare(100, 'red');
        const second = addSquare(200, 'blue');
        commitLocalChanges(true);
        second.position = second.position.add(new paper.Point(0, 60));
        commitLocalChanges(true);
        first.remove();
        commitLocalChanges(true);
        const authorShape = layerShape();
        const stream = sent.slice();

        asFreshPeer();
        stream.forEach(packet => receivePacket(packet, PEER));

        expect(layerShape()).toEqual(authorShape);
    });

    test('applying a peer\'s ops does not echo them back', () => {
        addSquare(100, 'red');
        commitLocalChanges(true);
        const reset = lastSent();

        asFreshPeer();
        receivePacket(reset, PEER);
        expect(sent).toHaveLength(0);

        commitLocalChanges(true);
        expect(sent).toHaveLength(0);
    });

    test('a peer\'s edit is pushed into the costume without an undo snapshot', () => {
        addSquare(100, 'red');
        commitLocalChanges(true);
        const reset = lastSent();

        asFreshPeer();
        updateImage.mockClear();
        receivePacket(reset, PEER);

        expect(updateImage).toHaveBeenCalled();
    });

    test('the flag is still set while the costume is being updated', () => {
        addSquare(100, 'red');
        commitLocalChanges(true);
        const reset = lastSent();

        asFreshPeer();
        let seenDuringUpdate = null;
        setCollabHost({updateImage: () => {
            seenDuringUpdate = isApplyingRemote();
        }});
        receivePacket(reset, PEER);

        expect(seenDuringUpdate).toBe(true);
        expect(isApplyingRemote()).toBe(false);
    });

    test('packets for another costume are ignored', () => {
        addSquare(100, 'red');
        commitLocalChanges(true);
        const reset = lastSent();

        asFreshPeer();
        receivePacket(Object.assign({}, reset, {costumeIndex: 3}), PEER);
        expect(layer.children).toHaveLength(0);

        receivePacket(Object.assign({}, reset, {targetId: 'other-sprite'}), PEER);
        expect(layer.children).toHaveLength(0);
    });

    test('an op for an item we have never heard of asks for a resync', () => {
        addSquare(100, 'red');
        commitLocalChanges(true);
        sent = [];

        receivePacket({
            v: 1,
            ...COSTUME,
            op: 'ops',
            ops: [{op: 'remove', did: 'not-a-did'}]
        }, PEER);

        expect(sent).toEqual([expect.objectContaining({op: 'resync-request'})]);
    });

    test('a resync request is answered with the whole layer', () => {
        addSquare(100, 'red');
        commitLocalChanges(true);
        sent = [];

        receivePacket({v: 1, ...COSTUME, op: 'resync-request'}, PEER);

        expect(lastSent().op).toBe('reset');
        expect(lastSent().items).toHaveLength(1);
    });

    test('nobody answers a resync request before anyone has edited anything', () => {
        receivePacket({v: 1, ...COSTUME, op: 'resync-request'}, PEER);
        expect(sent).toHaveLength(0);
    });
});

describe('undo against a live session', () => {
    test('a peer\'s edits survive an undo taken before they arrived', () => {
        addSquare(100, 'red');
        commitLocalChanges(true);
        const snapshotSeq = remoteSeq();

        const peerSquare = addSquare(400, 'purple');
        const peerDid = getDid(peerSquare);
        const peerJson = peerSquare.exportJSON({asString: false});
        peerSquare.remove();
        rebuildIndex();
        receivePacket({
            v: 1,
            ...COSTUME,
            op: 'ops',
            ops: [{op: 'add', did: peerDid, index: 1, json: peerJson}]
        }, PEER);
        expect(remoteSeq()).toBe(snapshotSeq + 1);

        layer.removeChildren();
        addSquare(100, 'red');
        rebuildIndex();
        expect(layer.children).toHaveLength(1);

        replayRemoteOpsSince(snapshotSeq);

        expect(layer.children).toHaveLength(2);
        expect(layer.children.map(getDid)).toContain(peerDid);
    });

    test('replaying leaves the baseline alone, so the undo still reaches peers', () => {
        const square = addSquare(100, 'red');
        commitLocalChanges(true);
        const snapshotSeq = remoteSeq();
        sent = [];

        square.remove();
        rebuildIndex();
        replayRemoteOpsSince(snapshotSeq);
        commitLocalChanges(true);

        expect(lastSent().ops).toEqual([{op: 'remove', did: expect.any(String)}]);
    });

    test('an undo older than the replay log asks for the truth instead of guessing', () => {
        addSquare(100, 'red');
        commitLocalChanges(true);
        receivePacket({v: 1, ...COSTUME, op: 'ops', ops: [{op: 'order', dids: []}]}, PEER);
        sent = [];

        replayRemoteOpsSince(remoteSeq() - 50);

        expect(sent).toEqual([expect.objectContaining({op: 'resync-request'})]);
    });
});

describe('in-progress strokes', () => {
    test('a peer\'s preview is a ghost, never an item in the project', () => {
        receivePacket({
            v: 1,
            ...COSTUME,
            op: 'preview',
            svg: '<path d="M0 0 L10 10"/>',
            username: 'someone',
            color: '#ff0000'
        }, PEER);

        expect(getPeers()).toEqual([expect.objectContaining({
            peerId: PEER,
            username: 'someone',
            preview: expect.objectContaining({svg: '<path d="M0 0 L10 10"/>'})
        })]);
        expect(layer.children).toHaveLength(0);
    });

    test('one ghost per peer - a stroke replaces its own earlier frames', () => {
        const frame = svg => receivePacket({v: 1, ...COSTUME, op: 'preview', svg}, PEER);
        frame('<path d="M0 0 L10 10"/>');
        frame('<path d="M0 0 L20 20"/>');

        expect(getPeers()).toHaveLength(1);
        expect(getPeers()[0].preview.svg).toBe('<path d="M0 0 L20 20"/>');
    });

    test('finishing a stroke takes its ghost down', () => {
        receivePacket({v: 1, ...COSTUME, op: 'preview', svg: '<path d="M0 0 L10 10"/>'}, PEER);
        receivePacket({v: 1, ...COSTUME, op: 'preview-end'}, PEER);

        expect(getPeers()).toHaveLength(1);
        expect(getPeers()[0].preview).toBeNull();
    });

    test('the real edit landing also takes the ghost of it down', () => {
        receivePacket({v: 1, ...COSTUME, op: 'preview', svg: '<path d="M0 0 L10 10"/>'}, PEER);
        receivePacket({v: 1, ...COSTUME, op: 'ops', ops: []}, PEER);

        expect(getPeers()[0].preview).toBeNull();
    });

    test('a ghost expires well before the person holding it does', () => {
        receivePacket({v: 1, ...COSTUME, op: 'preview', svg: '<path d="M0 0 L10 10"/>'}, PEER);
        receivePacket({v: 1, ...COSTUME, op: 'cursor', x: 10, y: 20}, PEER);

        const realNow = Date.now;
        try {
            Date.now = () => realNow() + 6000;
            expect(getPeers()).toHaveLength(1);
            expect(getPeers()[0].preview).toBeNull();
            expect(getPeers()[0].cursor).toEqual({x: 10, y: 20});

            Date.now = () => realNow() + 60000;
            expect(getPeers()).toHaveLength(0);
        } finally {
            Date.now = realNow;
        }
    });

    test('ending a gesture tells peers to stop drawing the ghost', () => {
        beginGesture({isVector: true});
        sent = [];
        endGesture();

        expect(sent).toEqual([expect.objectContaining({op: 'preview-end'})]);
    });

    test('a gesture outside a session does nothing', () => {
        clearCollabTransport();
        beginGesture({isVector: true});
        endGesture();

        expect(sent).toHaveLength(0);
    });
});

describe('the costume\'s own metadata, not just its art', () => {
    test('a pivot set on an item rides along with it', () => {
        const square = addSquare(100, 'red');
        setPivot(square, new paper.Point(120, 120));
        syncItemData(square);
        commitLocalChanges(true);
        const reset = lastSent();

        asFreshPeer();
        receivePacket(reset, PEER);

        const theirs = layer.children[0];
        expect(getPivot(theirs)).not.toBeNull();
        expect(getPivot(theirs).round()).toEqual(new paper.Point(120, 120));
    });

    test('a reset carries the metadata document', () => {
        setDoc({...getDoc(), swatches: {red: '#ff0000'}});
        addSquare(100, 'red');
        commitLocalChanges(true);
        const reset = lastSent();
        expect(reset.doc).toEqual(expect.any(String));

        asFreshPeer();
        receivePacket(reset, PEER);

        expect(getDoc().swatches).toEqual({red: '#ff0000'});
    });

    test('changing the document alone is still a change worth sending', () => {
        addSquare(100, 'red');
        commitLocalChanges(true);
        sent = [];

        setDoc({...getDoc(), swatches: {blue: '#0000ff'}});
        commitLocalChanges(true);

        expect(lastSent().ops).toEqual([{op: 'doc', doc: expect.any(String)}]);
    });

    test('a document arriving refreshes the UI that draws it', () => {
        addSquare(100, 'red');
        commitLocalChanges(true);
        setDoc({...getDoc(), swatches: {green: '#00ff00'}});
        commitLocalChanges(true);
        const docOps = lastSent();

        asFreshPeer();
        syncStores.mockClear();
        receivePacket(docOps, PEER);

        expect(getDoc().swatches).toEqual({green: '#00ff00'});
        expect(syncStores).toHaveBeenCalled();
    });

    test('a document we cannot make sense of leaves a usable one behind', () => {
        receivePacket({v: 1, ...COSTUME, op: 'ops', ops: [{op: 'doc', doc: 'not a document'}]}, PEER);

        expect(getDoc().swatches).toEqual({});
        expect(getDoc().axes).toEqual([]);
    });
});

describe('who else is here', () => {
    test('a peer\'s cursor arrives with their tool and their colour', () => {
        receivePacket({
            v: 1,
            ...COSTUME,
            op: 'cursor',
            x: 40,
            y: 80,
            tool: 'BRUSH',
            username: 'someone',
            color: '#ff00ff'
        }, PEER);

        expect(getPeers()).toEqual([expect.objectContaining({
            peerId: PEER,
            username: 'someone',
            color: '#ff00ff',
            cursor: {x: 40, y: 80},
            tool: 'BRUSH'
        })]);
    });

    test('a selection is carried as ids, so it follows the items', () => {
        const square = addSquare(100, 'red');
        commitLocalChanges(true);
        const did = getDid(square);

        receivePacket({v: 1, ...COSTUME, op: 'selection', dids: [did]}, PEER);

        expect(getPeers()[0].selection).toEqual([did]);
    });

    test('one peer, one record, however many kinds of thing they send', () => {
        receivePacket({v: 1, ...COSTUME, op: 'cursor', x: 1, y: 2, username: 'someone'}, PEER);
        receivePacket({v: 1, ...COSTUME, op: 'selection', dids: []}, PEER);
        receivePacket({v: 1, ...COSTUME, op: 'preview', svg: '<path d="M0 0 L1 1"/>'}, PEER);

        const peers = getPeers();
        expect(peers).toHaveLength(1);
        expect(peers[0].cursor).toEqual({x: 1, y: 2});
        expect(peers[0].preview).not.toBeNull();
        expect(peers[0].username).toBe('someone');
    });

    test('their name and colour are not theirs to choose twice', () => {
        receivePacket({v: 1, ...COSTUME, op: 'cursor', x: 1, y: 2, username: 'a', color: '#111111'}, PEER);
        receivePacket({v: 1, ...COSTUME, op: 'cursor', x: 3, y: 4, username: 'b', color: '#222222'}, PEER);

        expect(getPeers()[0].username).toBe('b');
        expect(getPeers()[0].color).toBe('#222222');
    });

    test('cursors from another costume are ignored like everything else', () => {
        receivePacket({v: 1, ...COSTUME, costumeIndex: 7, op: 'cursor', x: 1, y: 2}, PEER);
        expect(getPeers()).toHaveLength(0);
    });
});

describe('switching costume', () => {
    test('the next commit starts over rather than diffing against the old costume', () => {
        addSquare(100, 'red');
        commitLocalChanges(true);
        sent = [];

        resetCollab();
        layer.removeChildren();
        addSquare(300, 'green');
        rebuildIndex();
        commitLocalChanges(true);

        expect(lastSent().op).toBe('reset');
        expect(lastSent().items).toHaveLength(1);
    });

    test('nobody from the old costume follows you to the new one', () => {
        receivePacket({v: 1, ...COSTUME, op: 'preview', svg: '<path d="M0 0 L10 10"/>'}, PEER);
        receivePacket({v: 1, ...COSTUME, op: 'cursor', x: 10, y: 20}, PEER);
        resetCollab();

        expect(getPeers()).toHaveLength(0);
    });
});
