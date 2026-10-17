
const SITE = 'https://dimod.test';

const load = () => {
    jest.resetModules();
    process.env.DIMOD_SITE_ORIGIN = SITE;
    return require('../../../src/lib/dimod-server'); // eslint-disable-line global-require
};

const fakeParent = (answer, {origin = SITE, source} = {}) => {
    const asked = [];
    const parent = {
        postMessage: (msg, targetOrigin) => {
            asked.push({msg, targetOrigin});
            if (answer === null) return;
            setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
                data: {type: 'dimod-play-token', dimodId: msg.dimodId, token: answer},
                origin,
                source: source || parent
            })), 0);
        }
    };
    Object.defineProperty(window, 'parent', {value: parent, configurable: true});
    return asked;
};

describe('game tokens on the game origin', () => {
    afterEach(() => {
        Object.defineProperty(window, 'parent', {value: window, configurable: true});
    });

    test('asks the site page, only there, and uses its answer', async () => {
        const {gameServerToken, onGameOrigin} = load();
        expect(onGameOrigin()).toBe(true);
        const asked = fakeParent('game-token-1');
        const token = await gameServerToken({mode: 'play', dimodId: 'abcd1234'});
        expect(token).toBe('game-token-1');
        expect(asked).toEqual([{msg: {type: 'dimod-play-token-request', dimodId: 'abcd1234'}, targetOrigin: SITE}]);
        expect(await gameServerToken({mode: 'play', dimodId: 'abcd1234'})).toBe('game-token-1');
        expect(asked.length).toBe(1);
    });

    test('ignores answers from anywhere but the site page', async () => {
        jest.useFakeTimers();
        const {gameServerToken} = load();
        fakeParent('stolen', {origin: 'https://evil.test'});
        const result = gameServerToken({mode: 'play', dimodId: 'abcd1234'});
        jest.runAllTimers();
        expect(await result).toBe(null);
        jest.useRealTimers();
    });

    test('no token outside play mode, or not in a frame', async () => {
        const {gameServerToken} = load();
        expect(await gameServerToken({mode: 'test', projectId: 'x'})).toBe(null);
        expect(await gameServerToken({mode: 'play', dimodId: 'abcd1234'})).toBe(null);
    });
});
