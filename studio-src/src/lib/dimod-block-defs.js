import compatBlocks from 'scratch-vm/src/compiler/compat-blocks';
import Cast from 'scratch-vm/src/util/cast';
import log from 'scratch-vm/src/util/log';
import Effect from 'scratch-audio/src/effects/Effect';
import RenderedTarget from 'scratch-vm/src/sprites/rendered-target';
import Scratch3SoundBlocks from 'scratch-vm/src/blocks/scratch3_sound';
const EXTRA = {
    setBlend: 'looks_dimod_setblendmode',
    blendMode: 'looks_dimod_blendmode',
    mapRange: 'operator_dimod_maprange',
    wrap: 'operator_dimod_wrap',
    roundTo: 'operator_dimod_roundto',
    commas: 'operator_dimod_withcommas',
    distance: 'operator_dimod_distancexy',
    angle: 'operator_dimod_angletoxy',
    moveToward: 'motion_dimod_movetoward',
    width: 'looks_dimod_width',
    height: 'looks_dimod_height',
    secondsSince2000: 'sensing_dimod_secondssince2000',
    fps: 'sensing_dimod_fps',
    deltaTime: 'sensing_dimod_deltatime',
    focused: 'sensing_dimod_focused',
    touchingAtAll: 'sensing_dimod_touchingatall',
    pressKey: 'sensing_dimod_presskey',
    releaseKey: 'sensing_dimod_releasekey',
    colorAt: 'sensing_dimod_colorat',
    split: 'operator_dimod_split',
    repeatText: 'operator_dimod_repeattext',
    ifNot: 'control_dimod_ifnot',
    broadcastWith: 'event_dimodbc_broadcast',
    broadcastWithWait: 'event_dimodbc_broadcastandwait',
    whenReceiveWith: 'event_dimodbc_whenreceive',
    waitReceiveWith: 'event_dimodbc_waitreceive',
    broadcastData: 'event_dimodbc_data',
    messageMenu: 'event_dimodbc_menu'
};
const PLAIN_HAT = 'event_whenbroadcastreceived';
const MAX_REPEAT_LENGTH = 1e7;
const num = Cast.toNumber;
const touchingAtAll = (target, thing) => {
    const renderer = target.renderer;
    if (!renderer || target.isStage) return false;
    const exact = thing && typeof thing === 'object';
    let others;
    if (exact) {
        if (thing === target || thing.isStage) return false;
        others = [thing];
    } else {
        const first = target.runtime.getSpriteTargetByName(Cast.toString(thing));
        others = first ? first.sprite.clones : [];
    }
    const hidden = [target, ...others]
        .map(t => renderer._allDrawables[t.drawableID])
        .filter(drawable => drawable && !drawable._visible);
    hidden.forEach(drawable => { drawable._visible = true; });
    try {
        if (exact) return renderer.isTouchingDrawables(target.drawableID, [thing.drawableID]);
        return target.isTouchingObject(Cast.toString(thing));
    } finally { hidden.forEach(drawable => { drawable._visible = false; }); }
};
const installExtraBlocksVM = vm => {
    if (vm.__dimodExtraInstalled) return;
    vm.__dimodExtraInstalled = true;
    const runtime = vm.runtime;
    const p = runtime._primitives;
    for (const opcode of [EXTRA.width, EXTRA.height, EXTRA.blendMode]) {
        runtime.monitorBlockInfo[opcode] = {isSpriteSpecific: true, getId: targetId => `${targetId}_${opcode}`};
    }
    p[EXTRA.mapRange] = args => {
        const x = num(args.X), a = num(args.A), b = num(args.B), c = num(args.C), d = num(args.D);
        if (a === b) return c;
        return c + ((x - a) * (d - c) / (b - a));
    };
    p[EXTRA.wrap] = args => {
        const x = num(args.X);
        let min = num(args.MIN), max = num(args.MAX);
        if (min > max) [min, max] = [max, min];
        const range = max - min;
        if (range === 0) return min;
        return (((x - min) % range) + range) % range + min;
    };
    p[EXTRA.roundTo] = args => {
        const places = Math.max(0, Math.min(10, Math.round(num(args.PLACES))));
        const f = Math.pow(10, places);
        return Math.round(num(args.X) * f) / f;
    };
    p[EXTRA.commas] = args => num(args.X).toLocaleString('en-US', {maximumFractionDigits: 10});
    p[EXTRA.distance] = args => Math.hypot(num(args.X2) - num(args.X1), num(args.Y2) - num(args.Y1));
    p[EXTRA.angle] = args => {
        const dx = num(args.X2) - num(args.X1);
        const dy = num(args.Y2) - num(args.Y1);
        if (dx === 0 && dy === 0) return 90;
        let dir = 90 - (Math.atan2(dy, dx) * 180 / Math.PI);
        if (dir > 180) dir -= 360;
        if (dir <= -180) dir += 360;
        return Math.round(dir * 1e6) / 1e6;
    };
    p[EXTRA.moveToward] = (args, util) => {
        const target = util.target;
        if (target.isStage) return;
        const steps = num(args.STEPS);
        const dx = num(args.X) - target.x;
        const dy = num(args.Y) - target.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) return;
        const move = Math.min(steps, dist);
        target.setXY(target.x + (dx / dist) * move, target.y + (dy / dist) * move);
    };
    const bounds = util => {
        const target = util.target;
        if (target.isStage || !runtime.renderer || target.drawableID === null) return null;
        return runtime.renderer.getBounds(target.drawableID);
    };
    p[EXTRA.width] = (args, util) => { const b = bounds(util); return b ? Math.round((b.right - b.left) * 100) / 100 : 0; };
    p[EXTRA.height] = (args, util) => { const b = bounds(util); return b ? Math.round((b.top - b.bottom) * 100) / 100 : 0; };
    const START_OF_2000 = Date.UTC(2000, 0, 1);
    p[EXTRA.secondsSince2000] = () => (Date.now() - START_OF_2000) / 1000;
    let last = 0;
    let delta = 0;
    const frames = [];
    runtime.on('BEFORE_EXECUTE', () => {
        const now = performance.now();
        if (last) delta = (now - last) / 1000;
        last = now;
        frames.push(now);
        while (frames.length && now - frames[0] > 1000) frames.shift();
    });
    p[EXTRA.fps] = () => frames.length;
    p[EXTRA.deltaTime] = () => Math.round(delta * 10000) / 10000;
    p[EXTRA.focused] = () => (typeof document !== 'undefined' && document.hasFocus());
    p[EXTRA.touchingAtAll] = (args, util) => touchingAtAll(util.target, args.TOUCHINGOBJECTMENU);
    const KEY_EVENTS = {'space': ' ', 'up arrow': 'ArrowUp', 'down arrow': 'ArrowDown', 'left arrow': 'ArrowLeft',
        'right arrow': 'ArrowRight', 'enter': 'Enter'};
    const keyEvent = name => {
        const text = Cast.toString(name);
        return KEY_EVENTS[text.toLowerCase()] || (text.length > 1 ? text : text.toLowerCase());
    };
    const pressed = new Set();
    const postKey = (key, isDown) => runtime.ioDevices.keyboard.postData({key, isDown});
    p[EXTRA.pressKey] = args => {
        const key = keyEvent(args.KEY_OPTION);
        if (!key || key.toLowerCase() === 'any') return;
        pressed.add(key);
        postKey(key, true);
    };
    p[EXTRA.releaseKey] = args => {
        const key = keyEvent(args.KEY_OPTION);
        if (!key) return;
        if (key.toLowerCase() === 'any') { pressed.forEach(k => postKey(k, false)); pressed.clear(); return; }
        pressed.delete(key);
        postKey(key, false);
    };
    runtime.on('PROJECT_STOP_ALL', () => { pressed.forEach(k => postKey(k, false)); pressed.clear(); });
    p[EXTRA.colorAt] = args => {
        const r = runtime.renderer;
        if (!r || !r._gl) return '#000000';
        const gl = r._gl;
        const x = num(args.X), y = num(args.Y);
        const [left, right, bottom, top] = [x - 0.5, x + 0.5, y - 0.5, y + 0.5];
        r._doExitDrawRegion();
        gl.bindFramebuffer(gl.FRAMEBUFFER, r._queryBufferInfo.framebuffer);
        gl.viewport(0, 0, 1, 1);
        const proj = new Float32Array(16);
        proj[0] = 2 / (right - left);
        proj[5] = 2 / (bottom - top);
        proj[10] = -1;
        proj[12] = (right + left) / (left - right);
        proj[13] = (bottom + top) / (top - bottom);
        proj[15] = 1;
        gl.clearColor(...r._backgroundColor4f);
        gl.clear(gl.COLOR_BUFFER_BIT);
        r._drawThese(r._drawList, r._shaderManager.constructor.DRAW_MODE.default, proj);
        const px = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return `#${[px[0], px[1], px[2]].map(c => c.toString(16).padStart(2, '0')).join('')}`;
    };
    p[EXTRA.split] = args => {
        const parts = Cast.toString(args.TEXT).split(Cast.toString(args.DIV));
        return vm.jwArray ? new vm.jwArray.Type(parts, true) : JSON.stringify(parts);
    };
    p[EXTRA.repeatText] = args => {
        const text = Cast.toString(args.TEXT);
        if (!text) return '';
        const times = Math.max(0, Math.floor(num(args.TIMES)));
        return text.repeat(Math.min(times, Math.floor(MAX_REPEAT_LENGTH / text.length)));
    };
    let sending = '';
    const waiters = new Set();
    const startHats = runtime.startHats.bind(runtime);
    runtime.startHats = (opcode, fields, target) => {
        const threads = startHats(opcode, fields, target);
        if (opcode !== PLAIN_HAT || !fields) return threads;
        const data = sending;
        sending = '';
        let mine = [];
        try { mine = startHats(EXTRA.whenReceiveWith, {MESSAGE: fields.BROADCAST_OPTION}, target) || []; } catch (e) { log.warn('broadcast with data: a "when I receive" has no message', e); }
        for (const t of mine) t.dimodBroadcastData = data;
        const sent = Cast.toString(fields.BROADCAST_OPTION).toLowerCase();
        for (const w of waiters) {
            if (runtime.threads.indexOf(w.thread) === -1) waiters.delete(w);
            else if (w.name === sent) { w.done = true; w.thread.dimodBroadcastData = data; waiters.delete(w); }
        }
        return (threads || []).concat(mine);
    };
    runtime._hats[EXTRA.whenReceiveWith] = {restartExistingThreads: true};
    p[EXTRA.whenReceiveWith] = () => true;
    p[EXTRA.messageMenu] = args => args.MESSAGE;
    p[EXTRA.broadcastData] = (args, util) => {
        const t = util.thread;
        return t && t.dimodBroadcastData !== undefined ? t.dimodBroadcastData : '';
    };
    const send = (args, util) => {
        const name = Cast.toString(args.MESSAGE);
        const known = runtime.getTargetForStage().lookupBroadcastByInputValue(name);
        if (known) known.isSent = true;
        sending = args.DATA;
        return util.startHats(PLAIN_HAT, {BROADCAST_OPTION: name}) || [];
    };
    p[EXTRA.broadcastWith] = (args, util) => { send(args, util); };
    p[EXTRA.broadcastWithWait] = (args, util) => {
        const frame = util.stackFrame;
        if (!frame.started) {
            frame.started = send(args, util);
            if (!frame.started.length) return;
        }
        if (frame.started.some(t => runtime.threads.indexOf(t) !== -1)) {
            if (frame.started.every(t => runtime.isWaitingThread(t))) util.yieldTick();
            else util.yield();
        }
    };
    p[EXTRA.waitReceiveWith] = (args, util) => {
        const frame = util.stackFrame;
        if (!frame.waiter) {
            frame.waiter = {name: Cast.toString(args.MESSAGE).toLowerCase(), thread: util.thread, done: false};
            waiters.add(frame.waiter);
        }
        if (!frame.waiter.done) util.yield();
    };
    const BLENDS = ['normal', 'multiply', 'screen', 'add', 'subtract', 'lighten', 'exclusion', 'erase', 'darken', 'difference', 'overlay', 'hardlight', 'softlight', 'dodge', 'burn'];
    p[EXTRA.setBlend] = (args, util) => {
        const m = String(args.MODE).toLowerCase();
        if (util.target.setBlendMode) util.target.setBlendMode(BLENDS.includes(m) ? m : 'normal');
    };
    p[EXTRA.blendMode] = (args, util) => util.target.blendMode || 'normal';
    p[EXTRA.ifNot] = args => (Cast.toBoolean(args.A) ? args.A : args.B);
    compatBlocks.statementBlocks.push(EXTRA.moveToward, EXTRA.pressKey, EXTRA.releaseKey,
        EXTRA.broadcastWith, EXTRA.broadcastWithWait, EXTRA.waitReceiveWith, EXTRA.setBlend);
    compatBlocks.outputBlocks.push(
        EXTRA.colorAt, EXTRA.split, EXTRA.repeatText, EXTRA.messageMenu, EXTRA.broadcastData,
        EXTRA.mapRange, EXTRA.wrap, EXTRA.roundTo, EXTRA.commas, EXTRA.distance, EXTRA.angle,
        EXTRA.width, EXTRA.height, EXTRA.secondsSince2000, EXTRA.fps, EXTRA.deltaTime, EXTRA.focused,
        EXTRA.touchingAtAll, EXTRA.ifNot, EXTRA.blendMode
    );
};
const input = name => ({type: 'input_value', name});
const STRING_OPCODES = ['operator_contains', 'operator_expandablejoininputs', 'operator_getLettersFromIndexToIndexInTextFixed',
    'operator_indexOfTextInText', 'operator_join', 'operator_lastIndexOfTextInText', 'operator_length', 'operator_letter_of',
    'operator_newLine', 'operator_regexmatch', 'operator_replaceAll', 'operator_replaceFirst', 'operator_tabCharacter',
    'operator_textStartsOrEndsWith', 'operator_toUpperLowerCase', 'operator_dimod_split', 'operator_dimod_repeattext'];
const colourStringBlocks = ScratchBlocks => {
    for (const type of STRING_OPCODES) {
        const def = ScratchBlocks.Blocks[type];
        if (!def || def.__dimodStrings) continue;
        const init = def.init;
        def.init = function () { init.apply(this, arguments); this.setColourFromRawValues_('#2BB3A0', '#228F80', '#1D7D70'); };
        def.__dimodStrings = true;
    }
};
const defineExtraBlocks = ScratchBlocks => {
    const define = (opcode, json) => {
        ScratchBlocks.Blocks[opcode] = {init: function () { this.jsonInit(Object.assign({id: opcode}, json)); }};
    };
    define(EXTRA.mapRange, {
        message0: 'map %1 from %2 - %3 to %4 - %5',
        args0: ['X', 'A', 'B', 'C', 'D'].map(input),
        tooltip: 'Turns a value in one range into the same spot in another range',
        extensions: ['colours_operators', 'output_number']
    });
    define(EXTRA.wrap, {
        message0: 'wrap %1 between %2 and %3',
        args0: ['X', 'MIN', 'MAX'].map(input),
        tooltip: 'Loops a value around, like an angle or a screen edge that wraps',
        extensions: ['colours_operators', 'output_number']
    });
    define(EXTRA.roundTo, {
        message0: 'round %1 to %2 decimals',
        args0: ['X', 'PLACES'].map(input),
        extensions: ['colours_operators', 'output_number']
    });
    define(EXTRA.commas, {
        message0: '%1 with commas',
        args0: [input('X')],
        tooltip: '1234567 becomes 1,234,567',
        extensions: ['colours_operators', 'output_string']
    });
    define(EXTRA.distance, {
        message0: 'distance from x: %1 y: %2 to x: %3 y: %4',
        args0: ['X1', 'Y1', 'X2', 'Y2'].map(input),
        extensions: ['colours_operators', 'output_number']
    });
    define(EXTRA.angle, {
        message0: 'direction from x: %1 y: %2 to x: %3 y: %4',
        args0: ['X1', 'Y1', 'X2', 'Y2'].map(input),
        tooltip: 'The direction to point in to face the second point',
        extensions: ['colours_operators', 'output_number']
    });
    define(EXTRA.moveToward, {
        message0: 'move %1 steps toward x: %2 y: %3',
        args0: ['STEPS', 'X', 'Y'].map(input),
        tooltip: 'Moves closer to a point, stopping when it gets there',
        extensions: ['colours_motion', 'shape_statement']
    });
    define(EXTRA.setBlend, {
        message0: 'set blend mode to %1',
        args0: [{type: 'field_dropdown', name: 'MODE', options: ['normal', 'multiply', 'screen', 'add', 'subtract', 'lighten', 'exclusion', 'erase', 'darken', 'difference', 'overlay', 'hardlight', 'softlight', 'dodge', 'burn'].map(o => [o, o])}],
        extensions: ['colours_looks', 'shape_statement']
    });
    define(EXTRA.blendMode, {message0: 'blend mode', checkboxInFlyout: true, extensions: ['colours_looks', 'output_string']});
    define(EXTRA.width, {message0: 'width', checkboxInFlyout: true, extensions: ['colours_looks', 'output_number']});
    define(EXTRA.height, {message0: 'height', checkboxInFlyout: true, extensions: ['colours_looks', 'output_number']});
    define(EXTRA.secondsSince2000, {
        message0: 'seconds since 2000',
        checkboxInFlyout: true,
        tooltip: 'Seconds since midnight UTC on 1 January 2000, with the fraction. Same for everyone, wherever they are',
        extensions: ['colours_sensing', 'output_number']
    });
    define(EXTRA.fps, {message0: 'frame rate', checkboxInFlyout: true, extensions: ['colours_sensing', 'output_number']});
    define(EXTRA.deltaTime, {
        message0: 'delta time',
        checkboxInFlyout: true,
        tooltip: 'Seconds since the last frame. Multiply speeds by this to move the same on any frame rate',
        extensions: ['colours_sensing', 'output_number']
    });
    define(EXTRA.focused, {
        message0: 'window focused?',
        checkboxInFlyout: true,
        extensions: ['colours_sensing', 'output_boolean']
    });
    define(EXTRA.pressKey, {
        message0: 'press key %1',
        args0: [input('KEY_OPTION')],
        tooltip: 'Holds a key down, as if the player did: key hats, key pressed? and input actions see it. ' +
            'For on-screen buttons on touch screens',
        extensions: ['colours_sensing', 'shape_statement']
    });
    define(EXTRA.releaseKey, {
        message0: 'release key %1',
        args0: [input('KEY_OPTION')],
        tooltip: 'Lets go of a key pressed with "press key" ("any" lets go of all of them)',
        extensions: ['colours_sensing', 'shape_statement']
    });
    define(EXTRA.colorAt, {
        message0: 'color at x: %1 y: %2',
        args0: ['X', 'Y'].map(input),
        tooltip: 'The colour of the stage at a point, everything drawn (pen too), as #rrggbb',
        extensions: ['colours_sensing', 'output_string']
    });
    define(EXTRA.split, {
        message0: 'split %1 by %2',
        args0: ['TEXT', 'DIV'].map(input),
        tooltip: 'Cuts text into a list of pieces. An array with the Arrays extension, otherwise a JSON array',
        output: null,
        outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND,
        extensions: ['colours_operators']
    });
    define(EXTRA.ifNot, {
        message0: 'if not %1 then %2',
        args0: ['A', 'B'].map(input),
        tooltip: 'The first value, unless it is empty, 0 or false. Then the second one instead',
        output: null,
        outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND,
        extensions: ['colours_control']
    });
    define(EXTRA.repeatText, {
        message0: 'repeat %1 %2 times',
        args0: ['TEXT', 'TIMES'].map(input),
        extensions: ['colours_operators', 'output_string']
    });
    const messageNames = () => {
        const ws = ScratchBlocks.getMainWorkspace();
        const names = new Set();
        if (ws) {
            ws.getVariablesOfType('broadcast_msg').forEach(v => names.add(v.name));
            ws.getAllBlocks().forEach(b => {
                if (b.type === EXTRA.messageMenu) {
                    const v = b.getFieldValue('MESSAGE');
                    if (v) names.add(v);
                }
            });
        }
        if (!names.size) names.add('message1');
        return [...names].sort((a, b) => a.localeCompare(b)).map(n => [n, n]);
    };
    ScratchBlocks.Blocks[EXTRA.messageMenu] = {
        init: function () {
            this.jsonInit({
                message0: '%1',
                args0: [{type: 'field_textdropdown', name: 'MESSAGE', text: 'message1', options: messageNames}],
                output: ['String', 'DimodMessage'],
                outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND,
                colour: ScratchBlocks.Colours.event.secondary,
                colourSecondary: ScratchBlocks.Colours.event.secondary,
                colourTertiary: ScratchBlocks.Colours.event.tertiary
            });
        }
    };
    define(EXTRA.whenReceiveWith, {
        message0: 'when I receive %1 with %2',
        args0: [{type: 'input_value', name: 'MESSAGE', check: 'DimodMessage'}, input('DATA')],
        tooltip: 'Runs when this message is broadcast. Drag "data" out for what was sent with it',
        extensions: ['colours_event', 'shape_hat']
    });
    define(EXTRA.waitReceiveWith, {
        message0: 'wait until I receive %1 with %2',
        args0: [{type: 'input_value', name: 'MESSAGE', check: 'DimodMessage'}, input('DATA')],
        tooltip: 'Pauses this script until the message is broadcast. Drag "data" out for what was sent with it',
        extensions: ['colours_event', 'shape_statement']
    });
    define(EXTRA.broadcastData, {
        message0: 'data',
        canDragDuplicate: true,
        output: null,
        outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND,
        extensions: ['colours_event']
    });
    define(EXTRA.broadcastWith, {
        message0: 'broadcast %1 with %2',
        args0: ['MESSAGE', 'DATA'].map(input),
        tooltip: 'Sends a message with some data. Plain "when I receive" hats get the message too',
        extensions: ['colours_event', 'shape_statement']
    });
    define(EXTRA.broadcastWithWait, {
        message0: 'broadcast %1 with %2 and wait',
        args0: ['MESSAGE', 'DATA'].map(input),
        extensions: ['colours_event', 'shape_statement']
    });
    define(EXTRA.touchingAtAll, {
        message0: 'touching %1 at all?',
        args0: [input('TOUCHINGOBJECTMENU')],
        tooltip: 'Like touching, but hidden sprites count too',
        extensions: ['colours_sensing', 'output_boolean']
    });
};
const numShadow = (name, value) => `<value name="${name}"><shadow type="math_number"><field name="NUM">${value}</field></shadow></value>`;
const pos = (x, y, sx = 'X', sy = 'Y') => numShadow(sx, x) + numShadow(sy, y);
const extraOperatorsXML = () => `
        <sep gap="36"/>
        <block type="${EXTRA.mapRange}">${numShadow('X', 50)}${numShadow('A', 0)}${numShadow('B', 100)}${numShadow('C', 0)}${numShadow('D', 1)}</block>
        <block type="${EXTRA.wrap}">${numShadow('X', 370)}${numShadow('MIN', 0)}${numShadow('MAX', 360)}</block>
        <block type="${EXTRA.roundTo}">${numShadow('X', 3.14159)}${numShadow('PLACES', 2)}</block>
        <block type="${EXTRA.commas}">${numShadow('X', 1234567)}</block>`;
const extraMotionXML = () => `
        <block type="${EXTRA.moveToward}">${numShadow('STEPS', 10)}${pos(0, 0)}</block>`;
const extraBlendXML = targetId => `
        <block type="${EXTRA.setBlend}"/>
        <block id="${targetId}_${EXTRA.blendMode}" type="${EXTRA.blendMode}"/>`;
const extraLooksXML = targetId => `
        <block id="${targetId}_${EXTRA.width}" type="${EXTRA.width}"/>
        <block id="${targetId}_${EXTRA.height}" type="${EXTRA.height}"/>`;
const extraTouchingAtAllXML = () => `
            <block type="${EXTRA.touchingAtAll}">
                <value name="TOUCHINGOBJECTMENU">
                    <shadow type="sensing_touchingobjectmenu"/>
                </value>
            </block>`;
const extraSecondsSince2000XML = () => `
        <block id="${EXTRA.secondsSince2000}" type="${EXTRA.secondsSince2000}"/>`;
const keyShadow = key => `<value name="KEY_OPTION"><shadow type="sensing_keyoptions"><field name="KEY_OPTION">${key}</field></shadow></value>`;
const msgShadow = `<value name="MESSAGE"><shadow type="${EXTRA.messageMenu}"><field name="MESSAGE">message1</field></shadow></value>`;
const textShadow = (name, value) => `<value name="${name}"><shadow type="text"><field name="TEXT">${value}</field></shadow></value>`;
const extraBroadcastXML = () => `
        <block type="${EXTRA.whenReceiveWith}">
            ${msgShadow}
            <value name="DATA"><shadow type="${EXTRA.broadcastData}"/></value>
        </block>
        <block type="${EXTRA.waitReceiveWith}">
            ${msgShadow}
            <value name="DATA"><shadow type="${EXTRA.broadcastData}"/></value>
        </block>
        <block type="${EXTRA.broadcastWith}">${msgShadow}${textShadow('DATA', 'hello')}</block>
        <block type="${EXTRA.broadcastWithWait}">${msgShadow}${textShadow('DATA', 'hello')}</block>`;
const extraColorAtXML = () => `
            <block type="${EXTRA.colorAt}">${pos(0, 0)}</block>`;
const extraTextXML = () => `
            <block type="${EXTRA.split}">${textShadow('TEXT', 'a,b,c')}${textShadow('DIV', ',')}</block>
            <block type="${EXTRA.repeatText}">${textShadow('TEXT', 'ha')}${numShadow('TIMES', 3)}</block>`;
const extraControlXML = () => `
        <block type="${EXTRA.ifNot}">${textShadow('A', '')}${textShadow('B', 'bar')}</block>`;
const extraSensingXML = () => `
        <sep gap="36"/>
        <block type="${EXTRA.pressKey}">${keyShadow('space')}</block>
        <block type="${EXTRA.releaseKey}">${keyShadow('space')}</block>
        <sep gap="36"/>
        <block id="${EXTRA.fps}" type="${EXTRA.fps}"/>
        <block id="${EXTRA.deltaTime}" type="${EXTRA.deltaTime}"/>
        <block id="${EXTRA.focused}" type="${EXTRA.focused}"/>`;
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const LOOKS_EFFECTS = [
    {name: 'mosaic_x', label: 'mosaic x', uniformName: 'u_mosaicX', converter: x => x / 100, shapeChanges: true},
    {name: 'mosaic_y', label: 'mosaic y', uniformName: 'u_mosaicY', converter: x => x / 100, shapeChanges: true},
    {name: 'mosaic_width', label: 'mosaic width', uniformName: 'u_mosaicWidth',
        converter: x => clamp(Math.abs(x), 1, 512), shapeChanges: true},
    {name: 'mosaic_height', label: 'mosaic height', uniformName: 'u_mosaicHeight',
        converter: x => clamp(Math.abs(x), 1, 512), shapeChanges: true},
    {name: 'invert', label: 'invert', uniformName: 'u_invert', converter: x => clamp(x, 0, 100) / 100, shapeChanges: false},
    {name: 'glow', label: 'glow', uniformName: 'u_glow', converter: x => clamp(Math.abs(x), 0, 100), shapeChanges: false},
    {name: 'outline', label: 'outline', uniformName: 'u_outline', converter: x => clamp(Math.abs(x), 0, 64), shapeChanges: false},
    {name: 'shadow', label: 'shadow', uniformName: 'u_shadow', converter: x => clamp(x, -100, 100), shapeChanges: false},
    {name: 'blur', label: 'blur', uniformName: 'u_blur', converter: x => clamp(Math.abs(x), 0, 100), shapeChanges: false},
    {name: 'motion_blur', label: 'motion blur', uniformName: 'u_motionBlur',
        converter: x => clamp(x, 0, 400) / 100, shapeChanges: false},
    {name: 'contrast', label: 'contrast', uniformName: 'u_contrast',
        converter: x => (x < 0 ? 1 + (clamp(x, -100, 0) / 100) : 1 + ((clamp(x, 0, 100) / 100) * 3)), shapeChanges: false}
];
const SOUND_EFFECTS = [
    {name: 'echo', label: 'echo'},
    {name: 'reverb', label: 'reverb'},
    {name: 'lowpass', label: 'low pass'},
    {name: 'highpass', label: 'high pass'},
    {name: 'distortion', label: 'distortion'}
];
const PADDED_DEFINED = ['glow', 'outline', 'shadow', 'blur', 'motion_blur']
    .map(name => `defined(ENABLE_${name})`).join(' || ');
const GLSL_UNIFORMS = `
#ifdef ENABLE_mosaic_x
uniform float u_mosaicX;
#endif
#ifdef ENABLE_mosaic_y
uniform float u_mosaicY;
#endif
#ifdef ENABLE_mosaic_width
uniform float u_mosaicWidth;
#endif
#ifdef ENABLE_mosaic_height
uniform float u_mosaicHeight;
#endif
#ifdef ENABLE_invert
uniform float u_invert;
#endif
#ifdef ENABLE_contrast
uniform float u_contrast;
#endif
#ifdef ENABLE_glow
uniform float u_glow;
#endif
#ifdef ENABLE_outline
uniform float u_outline;
#endif
#ifdef ENABLE_shadow
uniform float u_shadow;
uniform vec2 u_dimodShadow;
#endif
#ifdef ENABLE_blur
uniform float u_blur;
#endif
#ifdef ENABLE_motion_blur
uniform vec2 u_dimodMotion;
#endif
#if ${PADDED_DEFINED}
#define DIMOD_PAD
#ifndef ENABLE_pixelate
uniform vec2 u_skinSize;
#endif
// where the costume was sampled, for the effects drawn underneath it once main is done
vec2 dimodUV;
// The quad is padded (see the vertex shader), so nothing outside the costume itself counts.
// uv has been through the other effects, raw has not; both have to be inside.
vec4 dimodAt(vec2 uv, vec2 raw) {
	vec2 low = step(vec2(0.0), min(uv, raw));
	vec2 high = step(max(uv, raw), vec2(1.0));
	return texture2D(u_skin, uv) * (low.x * low.y * high.x * high.y);
}
vec2 dimodPixels(float pixels) {
	return vec2(pixels) / max(u_skinSize, vec2(1.0));
}
// a soft disc: a golden-angle spiral out from the middle, which has no rings to show through
vec4 dimodDisc(vec2 uv, vec2 raw, vec2 radius) {
	vec4 sum = dimodAt(uv, raw);
	float total = 1.0;
	for (int i = 1; i < 44; i++) {
		float t = float(i) / 43.0;
		float a = float(i) * 2.3999632;
		vec2 d = vec2(cos(a), sin(a)) * radius * sqrt(t);
		float weight = 1.0 - (0.75 * t);
		sum += dimodAt(uv + d, raw + d) * weight;
		total += weight;
	}
	return sum / total;
}
#endif
`;
const GLSL_UV = `
	#if defined(ENABLE_mosaic_width) || defined(ENABLE_mosaic_x)
	{
		#ifdef ENABLE_mosaic_width
		texcoord0.x *= u_mosaicWidth;
		#endif
		#ifdef ENABLE_mosaic_x
		texcoord0.x -= u_mosaicX;
		#endif
		texcoord0.x = fract(texcoord0.x);
	}
	#endif
	#if defined(ENABLE_mosaic_height) || defined(ENABLE_mosaic_y)
	{
		#ifdef ENABLE_mosaic_height
		texcoord0.y *= u_mosaicHeight;
		#endif
		#ifdef ENABLE_mosaic_y
		texcoord0.y += u_mosaicY;
		#endif
		texcoord0.y = fract(texcoord0.y);
	}
	#endif
`;
const GLSL_COLOR = `
	#ifdef DIMOD_PAD
	dimodUV = texcoord0;
	gl_FragColor = dimodAt(texcoord0, v_texCoord);
	#ifdef ENABLE_blur
	gl_FragColor = dimodDisc(texcoord0, v_texCoord, dimodPixels(u_blur));
	#endif
	#ifdef ENABLE_motion_blur
	{
		// u_dimodMotion is how far the sprite came since the last frame, as the renderer
		// measures it each draw (see trackDrawables)
		vec4 sum = gl_FragColor;
		for (int i = 1; i < 12; i++) {
			vec2 o = u_dimodMotion * (float(i) / 11.0);
			#ifdef ENABLE_blur
			vec4 tap = dimodAt(texcoord0 + o, v_texCoord + o) * 2.0;
			for (int j = 0; j < 6; j++) {
				float a = float(j) * 1.0471976;
				vec2 d = o + (vec2(cos(a), sin(a)) * dimodPixels(u_blur) * 0.7);
				tap += dimodAt(texcoord0 + d, v_texCoord + d);
			}
			sum += tap / 8.0;
			#else
			sum += dimodAt(texcoord0 + o, v_texCoord + o);
			#endif
		}
		gl_FragColor = sum / 12.0;
	}
	#endif
	#endif
	#ifdef ENABLE_contrast
	{
		vec3 straight = gl_FragColor.rgb / (gl_FragColor.a + 0.001);
		straight = clamp(((straight - 0.5) * u_contrast) + 0.5, 0.0, 1.0);
		gl_FragColor.rgb = straight * gl_FragColor.a;
	}
	#endif
	#ifdef ENABLE_invert
	gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(gl_FragColor.a) - gl_FragColor.rgb, u_invert);
	#endif
`;
const GLSL_MAIN = `
void main()
{
	dimodMain();
	#if defined(DIMOD_PAD) && !(${['silhouette', 'colorMask', 'line', 'background']
        .map(mode => `defined(DRAW_MODE_${mode})`).join(' || ')})
	#if defined(ENABLE_shadow) || defined(ENABLE_glow) || defined(ENABLE_outline)
	vec4 under = vec4(0.0);
	#ifdef ENABLE_shadow
	{
		vec2 soft = dimodPixels(abs(u_shadow) * 0.35);
		float a = dimodAt(dimodUV + u_dimodShadow, v_texCoord + u_dimodShadow).a * 2.0;
		for (int i = 0; i < 8; i++) {
			float t = float(i) * 0.7853982;
			vec2 d = u_dimodShadow + (vec2(cos(t), sin(t)) * soft);
			a += dimodAt(dimodUV + d, v_texCoord + d).a;
		}
		under = vec4(0.0, 0.0, 0.0, a * 0.05);
	}
	#endif
	#ifdef ENABLE_glow
	{
		// the sprite's own colours, spread out and lifted towards white
		vec4 spread = dimodDisc(dimodUV, v_texCoord, dimodPixels(u_glow));
		float a = clamp(spread.a * 2.5, 0.0, 1.0);
		vec3 colour = mix(clamp(spread.rgb / (spread.a + 0.001), 0.0, 1.0), vec3(1.0), 0.3);
		under = vec4(colour * a, a) + (under * (1.0 - a));
	}
	#endif
	#ifdef ENABLE_outline
	{
		vec2 width = dimodPixels(u_outline);
		float a = 0.0;
		for (int i = 0; i < 32; i++) {
			float t = float(i) * 0.1963495;
			vec2 d = vec2(cos(t), sin(t)) * width;
			a = max(a, dimodAt(dimodUV + d, v_texCoord + d).a);
		}
		for (int i = 0; i < 12; i++) {
			float t = float(i) * 0.5235988;
			vec2 d = vec2(cos(t), sin(t)) * width * 0.5;
			a = max(a, dimodAt(dimodUV + d, v_texCoord + d).a);
		}
		under = vec4(0.0, 0.0, 0.0, a) + (under * (1.0 - a));
	}
	#endif
	#ifdef ENABLE_ghost
	under *= u_ghost;
	#endif
	#ifdef DRAW_MODE_straightAlpha
	gl_FragColor.rgb *= gl_FragColor.a;
	#endif
	gl_FragColor += under * (1.0 - gl_FragColor.a);
	#ifdef DRAW_MODE_straightAlpha
	gl_FragColor.rgb /= gl_FragColor.a + 0.001;
	#endif
	#endif
	#endif
}
`;
const ANCHOR_UNIFORMS = 'uniform sampler2D u_skin;';
const ANCHOR_UV = 'vec2 texcoord0 = v_texCoord;';
const ANCHOR_COLOR = 'gl_FragColor = texture2D(u_skin, texcoord0);';
const ANCHOR_MAIN = 'void main()';
const VERTEX_UNIFORMS = `
#if !(defined(DRAW_MODE_line) || defined(DRAW_MODE_background)) && (${PADDED_DEFINED})
#define DIMOD_PAD
uniform vec2 u_skinSize;
#ifdef ENABLE_glow
uniform float u_glow;
#endif
#ifdef ENABLE_outline
uniform float u_outline;
#endif
#ifdef ENABLE_shadow
uniform float u_shadow;
uniform vec2 u_dimodShadow;
#endif
#ifdef ENABLE_blur
uniform float u_blur;
#endif
#ifdef ENABLE_motion_blur
uniform vec2 u_dimodMotion;
#endif
#endif
`;
const VERTEX_PAD = `
	#ifdef DIMOD_PAD
	{
		// as a fraction of the costume, each side
		vec2 dimodSkin = max(u_skinSize, vec2(1.0));
		vec2 dimodPad = vec2(0.0);
		#ifdef ENABLE_glow
		dimodPad = max(dimodPad, vec2(u_glow) / dimodSkin);
		#endif
		#ifdef ENABLE_outline
		dimodPad = max(dimodPad, vec2(u_outline) / dimodSkin);
		#endif
		#ifdef ENABLE_shadow
		dimodPad = max(dimodPad, abs(u_dimodShadow) + (vec2(abs(u_shadow) * 0.35) / dimodSkin));
		#endif
		#ifdef ENABLE_blur
		dimodPad = max(dimodPad, vec2(u_blur) / dimodSkin);
		#endif
		#ifdef ENABLE_motion_blur
		dimodPad += abs(u_dimodMotion);
		#endif
		mat4 dimodMatrix = u_projectionMatrix * u_modelMatrix;
		gl_Position += (dimodMatrix[0] * (a_position.x * 2.0 * dimodPad.x)) +
			(dimodMatrix[1] * (a_position.y * 2.0 * dimodPad.y));
		v_texCoord = ((v_texCoord - 0.5) * (1.0 + (2.0 * dimodPad))) + 0.5;
	}
	#endif
`;
const ANCHOR_VERTEX_UNIFORMS = 'attribute vec2 a_position;';
const ANCHOR_VERTEX_UV = 'v_texCoord = a_texCoord;';
const injectVertexShader = src => {
    if (!src.includes(ANCHOR_VERTEX_UNIFORMS) || !src.includes(ANCHOR_VERTEX_UV) ||
        !src.includes('u_modelMatrix') || src.includes('dimodPad')) return src;
    return src
        .replace(ANCHOR_VERTEX_UNIFORMS, `${ANCHOR_VERTEX_UNIFORMS}\n${VERTEX_UNIFORMS}`)
        .replace(ANCHOR_VERTEX_UV, `${ANCHOR_VERTEX_UV}\n${VERTEX_PAD}`);
};
const injectShader = src => {
    if (typeof src !== 'string') return src;
    if (!src.includes(ANCHOR_UV) || !src.includes(ANCHOR_UNIFORMS) ||
        !src.includes(ANCHOR_COLOR) || src.includes('u_mosaicWidth')) return injectVertexShader(src);
    return `${src
        .replace(ANCHOR_UNIFORMS, `${ANCHOR_UNIFORMS}\n${GLSL_UNIFORMS}`)
        .replace(ANCHOR_UV, `${ANCHOR_UV}\n${GLSL_UV}`)
        .replace(ANCHOR_COLOR, `${ANCHOR_COLOR}\n${GLSL_COLOR}`)
        .replace(ANCHOR_MAIN, 'void dimodMain()')}\n${GLSL_MAIN}`;
};
const MAX_MOTION = 120;
const MOTION_HOLD_MS = 60;
const stageToUV = (matrix, x, y) => {
    const det = (matrix[0] * matrix[5]) - (matrix[4] * matrix[1]);
    if (!det) return [0, 0];
    return [-((x * matrix[5]) - (y * matrix[4])) / det, ((y * matrix[0]) - (x * matrix[1])) / det];
};
const trackDrawables = (renderer, SM) => {
    const tracked = new Set();
    const shadowMask = SM.EFFECT_INFO.shadow ? SM.EFFECT_INFO.shadow.mask : 0;
    const motionMask = SM.EFFECT_INFO.motion_blur ? SM.EFFECT_INFO.motion_blur.mask : 0;
    if (!shadowMask && !motionMask) return;
    const {updateDrawableEffect, draw} = renderer;
    renderer.updateDrawableEffect = function (drawableID, effectName, value) {
        const result = updateDrawableEffect.call(this, drawableID, effectName, value);
        if (value && (effectName === 'shadow' || effectName === 'motion_blur')) tracked.add(drawableID);
        return result;
    };
    const update = (drawable, now) => {
        const uniforms = drawable.getUniforms();
        const matrix = uniforms.u_modelMatrix;
        if (drawable.enabledEffects & shadowMask) {
            const reach = uniforms.u_shadow * (Math.abs(drawable.scale[0]) / 100);
            uniforms.u_dimodShadow = stageToUV(matrix, -reach, reach);
        }
        if (!(drawable.enabledEffects & motionMask)) { drawable.__dimodMotion = null; return false; }
        const [x, y] = drawable._position;
        const state = drawable.__dimodMotion || (drawable.__dimodMotion = {x, y, dx: 0, dy: 0, time: now});
        const wasMoving = state.dx !== 0 || state.dy !== 0;
        if (x !== state.x || y !== state.y) {
            state.dx = x - state.x;
            state.dy = y - state.y;
            const length = Math.hypot(state.dx, state.dy);
            if (length > MAX_MOTION) state.dx = state.dy = 0;
            state.x = x;
            state.y = y;
            state.time = now;
        } else if (now - state.time > MOTION_HOLD_MS) { state.dx = state.dy = 0; }
        uniforms.u_dimodMotion = stageToUV(matrix, state.dx * uniforms.u_motionBlur, state.dy * uniforms.u_motionBlur);
        return wasMoving || state.dx !== 0 || state.dy !== 0;
    };
    renderer.draw = function () {
        if (tracked.size) {
            const now = Date.now();
            tracked.forEach(id => {
                const drawable = this._allDrawables[id];
                if (!drawable || !(drawable.enabledEffects & (shadowMask | motionMask))) {
                    if (drawable) drawable.__dimodMotion = null;
                    tracked.delete(id);
                    return;
                }
                if (update(drawable, now)) this.dirty = true;
            });
        }
        return draw.call(this);
    };
};
const patchRenderer = renderer => {
    if (!renderer || renderer.__dimodEffects || !renderer._shaderManager || !renderer._gl) return;
    renderer.__dimodEffects = true;
    const SM = renderer._shaderManager.constructor;
    if (!SM.__dimodEffects) {
        SM.__dimodEffects = true;
        LOOKS_EFFECTS.forEach(e => {
            if (SM.EFFECT_INFO[e.name]) return;
            if (SM.EFFECTS.length >= 31) return;
            SM.EFFECT_INFO[e.name] = {
                uniformName: e.uniformName, mask: 1 << SM.EFFECTS.length, converter: e.converter, shapeChanges: e.shapeChanges
            };
            SM.EFFECTS.push(e.name);
        });
    }
    trackDrawables(renderer, SM);
    const gl = renderer._gl;
    const shaderSource = gl.shaderSource;
    gl.shaderSource = function (shader, src) { return shaderSource.call(this, shader, injectShader(src)); };
};
const EFFECT_DEFAULTS = {};
LOOKS_EFFECTS.forEach(e => { EFFECT_DEFAULTS[e.name] = 0; });
const patchTargetEffects = () => {
    if (RenderedTarget.prototype.__dimodEffects) return;
    RenderedTarget.prototype.__dimodEffects = true;
    Object.defineProperty(RenderedTarget.prototype, 'effects', {
        configurable: true,
        get () { return this._dimodEffects; },
        set (value) {
            if (value && typeof value === 'object') {
                Object.keys(EFFECT_DEFAULTS).forEach(name => {
                    if (!Object.prototype.hasOwnProperty.call(value, name)) value[name] = 0;
                });
            }
            this._dimodEffects = value;
        }
    });
};
const ramp = (engine, param, value) => {
    const {currentTime, DECAY_WAIT, DECAY_DURATION} = engine;
    param.setTargetAtTime(value, currentTime + DECAY_WAIT, DECAY_DURATION);
};
const amount = value => clamp(Cast.toNumber(value), 0, 100) / 100;
const disconnectAll = nodes => nodes.forEach(n => n && n.disconnect());
class EchoEffect extends Effect {
    get name () { return 'echo'; }
    initialize () {
        const ctx = this.audioEngine.audioContext;
        this.inputNode = ctx.createGain();
        this.outputNode = ctx.createGain();
        this.delay = ctx.createDelay(1);
        this.delay.delayTime.value = 0.28;
        this.feedback = ctx.createGain();
        this.feedback.gain.value = 0;
        this.wet = ctx.createGain();
        this.wet.gain.value = 0;
        this.inputNode.connect(this.outputNode);
        this.inputNode.connect(this.delay);
        this.delay.connect(this.feedback);
        this.feedback.connect(this.delay);
        this.delay.connect(this.wet);
        this.wet.connect(this.outputNode);
        this.initialized = true;
    }
    _set (value) {
        this.value = value;
        const v = amount(value);
        ramp(this.audioEngine, this.wet.gain, v * 0.7);
        ramp(this.audioEngine, this.feedback.gain, v * 0.6);
    }
    dispose () {
        if (!this.initialized) return;
        disconnectAll([this.inputNode, this.outputNode, this.delay, this.feedback, this.wet]);
        this.delay = this.feedback = this.wet = null;
        super.dispose();
    }
}
let impulse = null;
const impulseFor = ctx => {
    if (impulse && impulse.sampleRate === ctx.sampleRate) return impulse;
    const length = Math.floor(ctx.sampleRate * 2.5);
    impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
        const data = impulse.getChannelData(c);
        for (let i = 0; i < length; i++) data[i] = ((Math.random() * 2) - 1) * Math.pow(1 - (i / length), 3);
    }
    return impulse;
};
class ReverbEffect extends Effect {
    get name () { return 'reverb'; }
    initialize () {
        const ctx = this.audioEngine.audioContext;
        this.inputNode = ctx.createGain();
        this.outputNode = ctx.createGain();
        this.dry = ctx.createGain();
        this.wet = ctx.createGain();
        this.wet.gain.value = 0;
        this.convolver = ctx.createConvolver();
        this.convolver.buffer = impulseFor(ctx);
        this.inputNode.connect(this.dry);
        this.dry.connect(this.outputNode);
        this.inputNode.connect(this.convolver);
        this.convolver.connect(this.wet);
        this.wet.connect(this.outputNode);
        this.initialized = true;
    }
    _set (value) {
        this.value = value;
        const v = amount(value);
        ramp(this.audioEngine, this.wet.gain, v * 0.8);
        ramp(this.audioEngine, this.dry.gain, 1 - (v * 0.4));
    }
    dispose () {
        if (!this.initialized) return;
        disconnectAll([this.inputNode, this.outputNode, this.dry, this.wet, this.convolver]);
        this.dry = this.wet = this.convolver = null;
        super.dispose();
    }
}
const filterEffect = (name, type, frequencyFor) => class extends Effect {
    get name () { return name; }
    initialize () {
        this.filter = this.audioEngine.audioContext.createBiquadFilter();
        this.filter.type = type;
        this.filter.frequency.value = frequencyFor(0);
        this.inputNode = this.filter;
        this.outputNode = this.filter;
        this.initialized = true;
    }
    _set (value) { this.value = value; ramp(this.audioEngine, this.filter.frequency, frequencyFor(amount(value))); }
    dispose () {
        if (!this.initialized) return;
        this.filter.disconnect();
        this.filter = null;
        super.dispose();
    }
};
const LowPassEffect = filterEffect('lowpass', 'lowpass', v => 20000 * Math.pow(250 / 20000, v));
const HighPassEffect = filterEffect('highpass', 'highpass', v => 10 * Math.pow(400, v));
const distortionCurve = v => {
    const k = v * 60;
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
        const x = ((i * 2) / curve.length) - 1;
        curve[i] = ((1 + k) * x) / (1 + (k * Math.abs(x)));
    }
    return curve;
};
class DistortionEffect extends Effect {
    get name () { return 'distortion'; }
    initialize () {
        const ctx = this.audioEngine.audioContext;
        this.inputNode = ctx.createWaveShaper();
        this.inputNode.oversample = '2x';
        this.outputNode = ctx.createGain();
        this.inputNode.connect(this.outputNode);
        this.initialized = true;
    }
    _set (value) {
        this.value = value;
        const v = amount(value);
        this.inputNode.curve = distortionCurve(v);
        ramp(this.audioEngine, this.outputNode.gain, 1 / (1 + (v * 0.8)));
    }
    dispose () {
        if (!this.initialized) return;
        disconnectAll([this.inputNode, this.outputNode]);
        super.dispose();
    }
}
const AUDIO_EFFECT_CLASSES = [EchoEffect, ReverbEffect, LowPassEffect, HighPassEffect, DistortionEffect];
const patchSoundBlocks = () => {
    if (Scratch3SoundBlocks.__dimodEffects) return;
    Scratch3SoundBlocks.__dimodEffects = true;
    const extra = () => { const out = {}; SOUND_EFFECTS.forEach(e => { out[e.name] = 0; }); return out; };
    const ranges = getter => () => {
        const out = getter();
        SOUND_EFFECTS.forEach(e => { out[e.name] = {min: 0, max: 100}; });
        return out;
    };
    const state = Object.getOwnPropertyDescriptor(Scratch3SoundBlocks, 'DEFAULT_SOUND_STATE').get;
    const range = Object.getOwnPropertyDescriptor(Scratch3SoundBlocks, 'EFFECT_RANGE').get;
    const larger = Object.getOwnPropertyDescriptor(Scratch3SoundBlocks, 'LARGER_EFFECT_RANGE').get;
    Object.defineProperty(Scratch3SoundBlocks, 'DEFAULT_SOUND_STATE', {configurable: true, get: () => {
        const s = state();
        Object.assign(s.effects, extra());
        return s;
    }});
    Object.defineProperty(Scratch3SoundBlocks, 'EFFECT_RANGE', {configurable: true, get: ranges(range)});
    Object.defineProperty(Scratch3SoundBlocks, 'LARGER_EFFECT_RANGE', {configurable: true, get: ranges(larger)});
};
const overlaps = (target, soundId) => Boolean(target && target.sprite && target.sprite.dimodSoundOverlap &&
    target.sprite.dimodSoundOverlap.has(soundId));
const patchSoundBank = bank => {
    const proto = Object.getPrototypeOf(bank);
    if (proto.__dimodOverlap) return;
    proto.__dimodOverlap = true;
    const {playSound, stop, stopAllSounds} = proto;
    const copiesOf = (self, soundId) => {
        if (!self._dimodCopies) self._dimodCopies = new Map();
        if (!self._dimodCopies.has(soundId)) self._dimodCopies.set(soundId, []);
        return self._dimodCopies.get(soundId);
    };
    proto.playSound = function (target, soundId, seconds) {
        const player = this.soundPlayers[soundId];
        if (player && player.isPlaying && overlaps(target, soundId) && typeof player.take === 'function') {
            const taken = player.take();
            const copies = copiesOf(this, soundId);
            const entry = {target, player: taken};
            copies.push(entry);
            taken.finished().then(() => {
                const i = copies.indexOf(entry);
                if (i >= 0) copies.splice(i, 1);
                taken.dispose();
            });
        }
        return playSound.call(this, target, soundId, seconds);
    };
    const stopCopies = (self, test) => {
        if (!self._dimodCopies) return;
        self._dimodCopies.forEach(copies => copies.slice().forEach(c => {
            if (test(c)) c.player.stop();
        }));
    };
    proto.stop = function (target, soundId) {
        if (this._dimodCopies && this._dimodCopies.has(soundId)) {
            this._dimodCopies.get(soundId).slice()
                .forEach(c => {
                    if (c.target === target) c.player.stop();
                });
        }
        return stop.call(this, target, soundId);
    };
    proto.stopAllSounds = function (target = '*') {
        stopCopies(this, c => target === '*' || c.target === target);
        return stopAllSounds.call(this, target);
    };
};
const patchAudioEngine = engine => {
    if (!engine || engine.__dimodEffects) return;
    engine.__dimodEffects = true;
    AUDIO_EFFECT_CLASSES.forEach(E => engine.effects.push(E));
    const createBank = engine.createBank;
    engine.createBank = function (...args) { const bank = createBank.apply(this, args); patchSoundBank(bank); return bank; };
};
const soundIndexOf = (target, value) => {
    const sounds = target.sprite.sounds;
    if (!sounds.length) return -1;
    const byName = target.getSoundIndexByName(Cast.toString(value));
    if (byName !== -1) return byName;
    const n = Math.round(Cast.toNumber(value));
    if (!n || (typeof value === 'string' && !/^\s*-?\d/.test(value))) return -1;
    return (((n - 1) % sounds.length) + sounds.length) % sounds.length;
};
const setSoundOverlap = (target, sound, on) => {
    const index = soundIndexOf(target, sound);
    if (index < 0) return;
    const id = target.sprite.sounds[index].soundId;
    if (!target.sprite.dimodSoundOverlap) target.sprite.dimodSoundOverlap = new Set();
    if (on) target.sprite.dimodSoundOverlap.add(id);
    else target.sprite.dimodSoundOverlap.delete(id);
};
const getSoundOverlap = (target, sound) => {
    const index = soundIndexOf(target, sound);
    return index >= 0 && overlaps(target, target.sprite.sounds[index].soundId);
};
const OVERLAP_OPCODE = 'sound_dimod_setoverlap';
const isTrue = value => value === true || Cast.toString(value).toLowerCase() === 'true' || value === 1 || value === '1';
const installMediaEffectsVM = vm => {
    if (vm.__dimodMediaEffects) return;
    vm.__dimodMediaEffects = true;
    patchTargetEffects();
    patchSoundBlocks();
    const {attachRenderer, attachAudioEngine} = vm;
    vm.attachRenderer = function (renderer) { patchRenderer(renderer); return attachRenderer.call(this, renderer); };
    vm.attachAudioEngine = function (engine) { patchAudioEngine(engine); return attachAudioEngine.call(this, engine); };
    if (vm.renderer) patchRenderer(vm.renderer);
    if (vm.runtime.audioEngine) patchAudioEngine(vm.runtime.audioEngine);
    vm.runtime._primitives[OVERLAP_OPCODE] = (args, util) => {
        setSoundOverlap(util.target, args.SOUND_MENU, isTrue(args.OVERLAP));
    };
    compatBlocks.statementBlocks.push(OVERLAP_OPCODE);
};
const addOptions = (ScratchBlocks, opcode, options) => {
    const block = ScratchBlocks.Blocks[opcode];
    if (!block || block.__dimodEffects) return;
    const init = block.init;
    block.__dimodEffects = true;
    block.init = function () {
        const jsonInit = this.jsonInit;
        this.jsonInit = function (json) {
            (json.args0 || []).forEach(arg => {
                if (arg.name === 'EFFECT' && Array.isArray(arg.options)) {
                    const have = new Set(arg.options.map(o => o[1]));
                    arg.options = arg.options.concat(options.filter(o => !have.has(o[1])));
                }
            });
            return jsonInit.call(this, json);
        };
        try { return init.call(this); } finally { delete this.jsonInit; }
    };
};
const defineMediaEffectBlocks = ScratchBlocks => {
    const looks = LOOKS_EFFECTS.map(e => [e.label, e.name.toUpperCase()]);
    const sound = SOUND_EFFECTS.map(e => [e.label, e.name.toUpperCase()]);
    ['looks_seteffectto', 'looks_changeeffectby', 'looks_getEffectValue'].forEach(op => addOptions(ScratchBlocks, op, looks));
    ['sound_seteffectto', 'sound_changeeffectby', 'sound_getEffectValue'].forEach(op => addOptions(ScratchBlocks, op, sound));
    ScratchBlocks.Blocks[OVERLAP_OPCODE] = {
        init: function () {
            this.jsonInit({
                id: OVERLAP_OPCODE,
                message0: 'set overlap to %1 on %2',
                args0: [
                    {type: 'field_dropdown', name: 'OVERLAP', options: [['true', 'true'], ['false', 'false']]},
                    {type: 'input_value', name: 'SOUND_MENU'}
                ],
                tooltip: 'True: playing this sound while it plays starts another copy, instead of starting it over',
                extensions: ['colours_sounds', 'shape_statement']
            });
        }
    };
};
const overlapBlockXML = soundName => `
        <block type="${OVERLAP_OPCODE}">
            <field name="OVERLAP">true</field>
            <value name="SOUND_MENU">
                <shadow type="sound_sounds_menu">
                    <field name="SOUND_MENU">${soundName}</field>
                </shadow>
            </value>
        </block>`;
export {EXTRA, colourStringBlocks, LOOKS_EFFECTS, OVERLAP_OPCODE, SOUND_EFFECTS, defineExtraBlocks, defineMediaEffectBlocks, extraBroadcastXML, extraColorAtXML, extraControlXML, extraBlendXML, extraLooksXML, extraMotionXML, extraOperatorsXML, extraSecondsSince2000XML, extraSensingXML, extraTextXML, extraTouchingAtAllXML, getSoundOverlap, injectShader, installExtraBlocksVM, installMediaEffectsVM, overlapBlockXML, setSoundOverlap, soundIndexOf, touchingAtAll};
