import {animationsOf, ANIM_OPCODES, ANIM_PROPERTIES, PART_PROPS, PART_READ_PROPS} from './runtime';
import {AnimValue, exprBody, parseExpr} from './core';
import {renderThumbnail} from './editor';
const ANIM_COLOURS = {primary: '#0E9AA7', secondary: '#0B8591', tertiary: '#097079'};
const escapeXML = text => String(text).replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&apos;', '"': '&quot;'
}[c]));
let menuVM = null;
const thumbCache = new WeakMap();
const renderBubble = record => {
    const el = document.createElement('span');
    el.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
    let url = thumbCache.get(record);
    if (typeof url === 'undefined') {
        try { url = menuVM ? renderThumbnail(menuVM.dimodAnimations, record, null, 24) : ''; } catch (e) { url = ''; }
        thumbCache.set(record, url);
    }
    if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.style.cssText = 'width:24px;height:24px;border-radius:4px;object-fit:contain;';
        el.appendChild(img);
    }
    const name = record.libraryName || record.doc.name || 'animation';
    el.appendChild(document.createTextNode(record.ownerSprite ? `${name} (${record.ownerSprite.name})` : name));
    return el;
};
const setAnimationMenuVM = vm => { menuVM = vm; AnimValue.renderBubble = renderBubble; };
const editingSprite = () => (menuVM && menuVM.editingTarget && menuVM.editingTarget.sprite) || null;
const asOptions = list => (list.length ? list.map(text => [String(text), String(text)]) : [['', '']]);
const ALL_KEY = 'dimod:animation-menu-all';
const menuShowsAll = () => {
    try { return localStorage.getItem(ALL_KEY) === '1'; } catch (e) { return false; }
};
const toggleMenuShowsAll = () => {
    try { localStorage.setItem(ALL_KEY, menuShowsAll() ? '0' : '1'); } catch (e) {
    }
};
const animationChoices = () => {
    if (!menuVM) return [];
    const own = editingSprite();
    const names = animationsOf(own).map(d => d.name);
    if (!menuShowsAll()) return names;
    for (const t of menuVM.runtime.targets) {
        if (!t.isOriginal || t.isStage || !t.sprite || t.sprite === own) continue;
        for (const d of animationsOf(t.sprite)) names.push(`${t.sprite.name}/${d.name}`);
    }
    return names;
};
const partChoices = () => {
    const names = new Set();
    for (const d of animationsOf(editingSprite())) {
        for (const g of d.groups || []) names.add(g.name);
    }
    return [...names];
};
const docForRef = ref => {
    if (!menuVM || !ref) return null;
    const host = menuVM.dimodAnimations;
    const own = editingSprite();
    let doc = own ? host.findDoc(own, ref) : null;
    for (let i = ref.indexOf('/'); !doc && i > 0; i = ref.indexOf('/', i + 1)) {
        const sprite = host.spriteNamed(ref.slice(0, i));
        doc = sprite ? host.findDoc(sprite, ref.slice(i + 1)) : null;
    }
    return doc;
};
const animRefOf = block => {
    const b = block && block.getInputTargetBlock('ANIM');
    if (!b) return '';
    if (b.type === ANIM_OPCODES.menu) return String(b.getFieldValue('ANIM') || '');
    if (b.type === ANIM_OPCODES.animation || b.type === ANIM_OPCODES.duplicate) return animRefOf(b);
    return null;
};
const eventsOf = doc => (doc.events || []).filter(ev => ev && ev.value)
    .map(ev => String(ev.value));
const eventChoices = block => {
    const names = new Set();
    const doc = docForRef(animRefOf(block));
    if (doc) { eventsOf(doc).forEach(n => names.add(n)); } else if (menuVM) {
        for (const t of menuVM.runtime.targets) {
            if (!t.isOriginal || !t.sprite) continue;
            for (const d of animationsOf(t.sprite)) eventsOf(d).forEach(n => names.add(n));
        }
    }
    const list = doc ? [...names] : [...names].sort();
    return [['(any event)', '(any event)'], ...list.map(n => [n, n])];
};
const MODES = [['looping', 'loop'], ['once', 'once'], ['ping-pong', 'pingpong']];
const TIME_MODES = [['clamp', 'clamp'], ['loop', 'loop'], ['ping-pong', 'pingpong'], ['reverse', 'reverse'],
    ['reverse loop', 'reverseloop']];
const defineAnimationBlocks = ScratchBlocks => {
    const define = (opcode, json) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit(Object.assign({
                    id: opcode,
                    colour: ANIM_COLOURS.primary,
                    colourSecondary: ANIM_COLOURS.secondary,
                    colourTertiary: ANIM_COLOURS.tertiary
                }, json));
            }
        };
    };
    const input = name => ({type: 'input_value', name});
    const dropdown = (name, options) => ({type: 'field_dropdown', name, options});
    const statement = (message, args = []) => ({message0: message, args0: args, extensions: ['shape_statement']});
    const reporter = (message, args = []) => ({
        message0: message, args0: args, output: null, outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND
    });
    const bool = (message, args = []) => ({
        message0: message, args0: args, output: 'Boolean', outputShape: ScratchBlocks.OUTPUT_SHAPE_HEXAGONAL
    });
    const defineMenu = (opcode, field, options) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit({
                    message0: '%1',
                    args0: [{type: 'field_textdropdown', name: field, text: '', options}],
                    output: 'String',
                    outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND,
                    colour: '#FFFFFF',
                    colourSecondary: '#FFFFFF',
                    colourTertiary: '#FFFFFF'
                });
            }
        };
    };
    defineMenu(ANIM_OPCODES.menu, 'ANIM', () => asOptions(animationChoices()));
    defineMenu(ANIM_OPCODES.partMenu, 'PART', () => asOptions(partChoices()));
    define(ANIM_OPCODES.animation, {
        message0: 'animation %1',
        args0: [input('ANIM')],
        output: null,
        outputShape: ScratchBlocks.OUTPUT_SHAPE_LEAF,
        tooltip: 'An animation from the ANIMATIONS tab, as a value you can keep in a variable or list'
    });
    define(ANIM_OPCODES.name, reporter('name of %1', [input('ANIM')]));
    define(ANIM_OPCODES.duplicate, Object.assign(reporter('copy of %1', [input('ANIM')]), {
        outputShape: ScratchBlocks.OUTPUT_SHAPE_LEAF,
        tooltip: 'A copy with its own data and part settings'
    }));
    define(ANIM_OPCODES.play, statement('play %1 %2', [input('ANIM'), dropdown('MODE', MODES)]));
    define(ANIM_OPCODES.playUntilDone, statement('play %1 until done', [input('ANIM')]));
    define(ANIM_OPCODES.crossfade, statement('crossfade to %1 %2 over %3 secs',
        [input('ANIM'), dropdown('MODE', MODES), input('SECS')]));
    define(ANIM_OPCODES.stop, Object.assign(statement('stop animation'), {
        tooltip: 'Stops the animation on this sprite and shows its costume again'
    }));
    define(ANIM_OPCODES.pause, statement('%1 animation', [dropdown('STATE', [['pause', 'pause'], ['resume', 'resume']])]));
    define(ANIM_OPCODES.setSpeed, statement('set animation speed to %1', [input('SPEED')]));
    define(ANIM_OPCODES.time, Object.assign(reporter('animation time'), {checkboxInFlyout: true}));
    define(ANIM_OPCODES.playing, Object.assign(bool('animation playing?'), {checkboxInFlyout: true}));
    define(ANIM_OPCODES.whenEvent, {
        message0: 'when %1 fires %2',
        args0: [input('ANIM'), {
            type: 'field_dropdown',
            name: 'EVENT',
            options: function () { return eventChoices(this.sourceBlock_); }
        }],
        extensions: ['shape_hat'],
        tooltip: 'Runs when this animation, playing on this sprite, reaches the event. ' +
            'Leave the animation empty to hear every animation'
    });
    ScratchBlocks.Blocks[ANIM_OPCODES.whenEvent].onchange = function () {
        if (this.isInFlyout || this.isShadow()) return;
        const ref = animRefOf(this);
        if (typeof this.dimodAnimRef === 'undefined' || ref === this.dimodAnimRef) { this.dimodAnimRef = ref; return; }
        this.dimodAnimRef = ref;
        const doc = docForRef(ref);
        const current = this.getFieldValue('EVENT');
        if (doc && current !== '(any event)' && !eventsOf(doc).includes(current)) { this.setFieldValue('(any event)', 'EVENT'); }
    };
    ScratchBlocks.Blocks[ANIM_OPCODES.eventMenu] = {
        init: function () {
            this.jsonInit({
                message0: '%1',
                args0: [{
                    type: 'field_textdropdown',
                    name: 'EVENT',
                    text: '',
                    options: function () { return eventChoices(this.sourceBlock_ && this.sourceBlock_.getParent()); }
                }],
                output: ['String', 'AnimEvent'],
                outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND,
                colour: '#FFFFFF',
                colourSecondary: '#FFFFFF',
                colourTertiary: '#FFFFFF'
            });
        }
    };
    define(ANIM_OPCODES.whenEventIn, {
        message0: 'when %1 fires in %2',
        args0: [{type: 'input_value', name: 'EVENT', check: 'AnimEvent'}, input('ANIM')],
        extensions: ['shape_hat'],
        tooltip: 'Runs when this animation, playing on this sprite, reaches the event. ' +
            'Leave the animation empty to hear every animation'
    });
    ScratchBlocks.Blocks[ANIM_OPCODES.whenEventIn].onchange = function () {
        if (this.isInFlyout || this.isShadow()) return;
        const ref = animRefOf(this);
        if (typeof this.dimodAnimRef === 'undefined' || ref === this.dimodAnimRef) { this.dimodAnimRef = ref; return; }
        this.dimodAnimRef = ref;
        const doc = docForRef(ref);
        const menu = this.getInputTargetBlock('EVENT');
        if (!doc || !menu || menu.type !== ANIM_OPCODES.eventMenu) return;
        const current = menu.getFieldValue('EVENT');
        if (current !== '(any event)' && !eventsOf(doc).includes(current)) menu.setFieldValue('(any event)', 'EVENT');
    };
    define(ANIM_OPCODES.render, statement('show %1 at %2 secs', [input('ANIM'), input('SECS')]));
    define(ANIM_OPCODES.duration, reporter('duration of %1', [input('ANIM')]));
    define(ANIM_OPCODES.lastEvent, reporter('last event of %1', [input('ANIM')]));
    define(ANIM_OPCODES.property, Object.assign(reporter('%1 of %2', [dropdown('PROP', ANIM_PROPERTIES), input('ANIM')]), {
        tooltip: 'Details of an animation. Part, event and data names come as a JSON list'
    }));
    const props = PART_PROPS.map(([text, value]) => [text, value]);
    define(ANIM_OPCODES.setPart, statement('set %1 of part %2 in %3 to %4',
        [dropdown('PROP', props), input('PART'), input('ANIM'), input('VALUE')]));
    define(ANIM_OPCODES.resetPart, statement('reset %1 of part %2 in %3',
        [dropdown('PROP', [['all properties', 'all'], ...props]), input('PART'), input('ANIM')]));
    define(ANIM_OPCODES.partProperty, Object.assign(reporter('%1 of part %2 in %3', [
        dropdown('PROP', PART_READ_PROPS.map(([text, value]) => [text, value])), input('PART'), input('ANIM')
    ]), {
        tooltip: 'What the animation gives this part right now: its keyframes, expressions and ' +
            'overrides, at this sprite\'s time in it (or 0 when it isn\'t playing it)'
    }));
    define(ANIM_OPCODES.partValue, Object.assign(reporter('%1 of part %2 on stage', [
        dropdown('PROP', [['x', 'x'], ['y', 'y'], ['rotation', 'rotation'], ['scale x', 'scaleX'],
            ['scale y', 'scaleY'], ['visible', 'visible']]),
        input('PART')
    ]), {
        tooltip: 'Where this sprite\'s animation part is on the stage right now (position, turn and size ' +
            'with the sprite\'s own placement and parts above it included)'
    }));
    define(ANIM_OPCODES.partTouchingMouse, bool('part %1 touching mouse-pointer?', [input('PART')]));
    define(ANIM_OPCODES.partTouchingXY, bool('part %1 touching x: %2 y: %3?', [input('PART'), input('X'), input('Y')]));
    define(ANIM_OPCODES.setData, statement('set data %1 to %2 in %3', [input('KEY'), input('VALUE'), input('ANIM')]));
    define(ANIM_OPCODES.getData, reporter('data %1 in %2', [input('KEY'), input('ANIM')]));
    define(ANIM_OPCODES.setTimeMode, statement('set time mode of %1 to %2', [input('ANIM'), dropdown('MODE', TIME_MODES)]));
    define(ANIM_OPCODES.mapTime, reporter('map time %1 for %2', [input('SECS'), input('ANIM')]));
    define(ANIM_OPCODES.progress, reporter('progress of %1 at %2 secs', [input('ANIM'), input('SECS')]));
    define(ANIM_OPCODES.loopCount, reporter('loop count of %1 at %2 secs', [input('ANIM'), input('SECS')]));
    define(ANIM_OPCODES.setSmoothing, statement('set smoothing %1 for %2',
        [dropdown('AA', [['on', 'on'], ['off', 'off']]), input('ANIM')]));
    define(ANIM_OPCODES.setDetail, statement('set render detail %1 for %2',
        [dropdown('DETAIL', [['low', 'low'], ['medium', 'medium'], ['high', 'high']]), input('ANIM')]));
};
const SEPARATOR = '<sep gap="36"/>';
const numberInput = (name, value) =>
    `<value name="${name}"><shadow type="math_number"><field name="NUM">${value}</field></shadow></value>`;
const textInput = (name, value) =>
    `<value name="${name}"><shadow type="text"><field name="TEXT">${escapeXML(value)}</field></shadow></value>`;
const menuInput = (name, opcode, value) =>
    `<value name="${name}"><shadow type="${opcode}"><field name="${name}">${escapeXML(value)}</field></shadow></value>`;
const animInput = value => menuInput('ANIM', ANIM_OPCODES.menu, value);
const partInput = value => menuInput('PART', ANIM_OPCODES.partMenu, value);
const monitorId = opcode => { const target = menuVM && menuVM.editingTarget; return target ? `${target.id}_${opcode}` : opcode; };
const animationCategoryXML = isStage => {
    if (isStage) return '';
    const choices = animationChoices();
    const first = choices[0] || '';
    const sprite = editingSprite();
    const firstPart = (() => {
        const d = animationsOf(sprite)[0];
        return (d && d.groups && d.groups[0] && d.groups[0].name) || 'Object 1';
    })();
    const anim = animInput(first);
    return `
    <category
        name="Animation"
        id="dimodAnimation"
        colour="${ANIM_COLOURS.primary}"
        secondaryColour="${ANIM_COLOURS.secondary}">
        <button
            text="${menuShowsAll() ? 'Show only this sprite\'s animations' : 'Show every sprite\'s animations'}"
            callbackKey="DIMOD_ANIMATION_MENU_ALL"></button>
        <block type="${ANIM_OPCODES.play}">${anim}</block>
        <block type="${ANIM_OPCODES.playUntilDone}">${anim}</block>
        <block type="${ANIM_OPCODES.crossfade}">${anim}${numberInput('SECS', 0.3)}</block>
        <block type="${ANIM_OPCODES.stop}"/>
        <block type="${ANIM_OPCODES.pause}"/>
        <block type="${ANIM_OPCODES.setSpeed}">${numberInput('SPEED', 1)}</block>
        <block id="${monitorId(ANIM_OPCODES.time)}" type="${ANIM_OPCODES.time}"/>
        <block id="${monitorId(ANIM_OPCODES.playing)}" type="${ANIM_OPCODES.playing}"/>
        <block type="${ANIM_OPCODES.whenEventIn}">${menuInput('EVENT', ANIM_OPCODES.eventMenu, '(any event)')}${anim}</block>
        ${SEPARATOR}
        <block type="${ANIM_OPCODES.animation}">${anim}</block>
        <block type="${ANIM_OPCODES.duplicate}">${anim}</block>
        <block type="${ANIM_OPCODES.name}">${anim}</block>
        <block type="${ANIM_OPCODES.property}">${anim}</block>
        <block type="${ANIM_OPCODES.lastEvent}">${anim}</block>
        <block type="${ANIM_OPCODES.render}">${anim}${numberInput('SECS', 0)}</block>
        ${SEPARATOR}
        <block type="${ANIM_OPCODES.partProperty}">${partInput(firstPart)}${anim}</block>
        <block type="${ANIM_OPCODES.partValue}">${partInput(firstPart)}</block>
        <block type="${ANIM_OPCODES.partTouchingMouse}">${partInput(firstPart)}</block>
        <block type="${ANIM_OPCODES.partTouchingXY}">${partInput(firstPart)}${numberInput('X', 0)}${numberInput('Y', 0)}</block>
        ${SEPARATOR}
        <block type="${ANIM_OPCODES.setData}">${textInput('KEY', 'dataVar')}${textInput('VALUE', '1')}${anim}</block>
    </category>`;
};
const P = 'anim_expr_';
const EXPR_BLOCK = {
    called: `${P}called`,
    ret: `${P}return`,
    time: `${P}time`,
    value: `${P}value`,
    clock: `${P}clock`,
    data: `${P}data`,
    constant: `${P}const`,
    pow: `${P}pow`,
    rem: `${P}rem`,
    compare: `${P}compare`,
    ifElse: `${P}if`,
    func1: `${P}func1`,
    func2: `${P}func2`,
    jitter: `${P}jitter`,
    wobble: `${P}wobble`,
    noise: `${P}noise`,
    random: `${P}random`,
    clamp: `${P}clamp`,
    lerp: `${P}lerp`,
    smooth: `${P}smoothstep`
};
const B = EXPR_BLOCK;
const FUNC1 = [['sin', 'sin'], ['cos', 'cos'], ['tan', 'tan'], ['asin', 'asin'], ['acos', 'acos'], ['atan', 'atan'],
    ['abs', 'abs'], ['floor', 'floor'], ['ceiling', 'ceil'], ['round', 'round'], ['sqrt', 'sqrt'], ['cbrt', 'cbrt'],
    ['e ^', 'exp'], ['ln', 'log'], ['log2', 'log2'], ['log10', 'log10'], ['sign', 'sign'], ['trunc', 'trunc']];
const FUNC2 = [['min', 'min'], ['max', 'max'], ['power', 'pow'], ['mod', 'mod'], ['atan2', 'atan2'], ['hypot', 'hypot']];
const CONSTANTS = [['π', 'PI'], ['τ (2π)', 'TAU'], ['e', 'E']];
const COMPARE = [['>', '>'], ['<', '<'], ['=', '=='], ['≥', '>='], ['≤', '<='], ['≠', '!=']];
let dataNames = [];
const setExprDataNames = names => { dataNames = names.slice(); };
const defineExprBlocks = ScratchBlocks => {
    const colours = {
        colour: ANIM_COLOURS.primary,
        colourSecondary: ANIM_COLOURS.secondary,
        colourTertiary: ANIM_COLOURS.tertiary
    };
    const define = (opcode, json, anim = true) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () { this.jsonInit(Object.assign({id: opcode}, anim ? colours : {}, json)); }
        };
    };
    const input = name => ({type: 'input_value', name});
    const boolInput = name => ({type: 'input_value', name, check: 'Boolean'});
    const menu = (name, options) => ({type: 'field_dropdown', name, options});
    const number = {output: null, outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND};
    const operator = json => Object.assign({extensions: ['colours_operators', 'output_number']}, json);
    ScratchBlocks.Blocks[B.called] = {
        init: function () {
            this.jsonInit(Object.assign({
                id: B.called,
                message0: 'when expression is called %1',
                args0: [input('VALUE')],
                extensions: ['shape_hat'],
                tooltip: 'Runs every frame from this keyframe to the next. ' +
                    'Drag "value" out to use what the keyframes say.'
            }, colours));
            this.setDeletable(false);
        }
    };
    define(B.time, Object.assign({message0: 'time', tooltip: 'Seconds since the animation started'}, number));
    define(B.value, Object.assign({
        message0: 'value',
        canDragDuplicate: true,
        tooltip: 'What the keyframes say at this moment'
    }, number));
    define(B.ret, {
        message0: 'return %1',
        args0: [input('VALUE')],
        extensions: ['shape_end'],
        tooltip: 'The value to use instead. Leave it empty and the keyframes decide.'
    });
    define(B.clock, Object.assign({
        message0: 'clock seconds',
        tooltip: 'Real-world seconds. Using it keeps the animation moving even when paused'
    }, number));
    define(B.data, Object.assign({
        message0: 'data %1',
        args0: [{type: 'field_textdropdown',
            name: 'NAME',
            text: 'myVar',
            options: () => { const names = dataNames.length ? dataNames : ['myVar']; return names.map(n => [n, n]); }}],
        tooltip: 'A data track, or a value blocks set with "set data"'
    }, number));
    define(B.constant, Object.assign({message0: '%1', args0: [menu('C', CONSTANTS)]}, number));
    define(B.pow, operator({message0: '%1 ^ %2', args0: [input('A'), input('B')]}), false);
    define(B.rem, operator({message0: 'remainder of %1 ÷ %2', args0: [input('A'), input('B')]}), false);
    define(B.compare, {
        message0: '%1 %2 %3',
        args0: [input('A'), menu('OP', COMPARE), input('B')],
        inputsInline: true,
        extensions: ['colours_operators', 'output_boolean']
    }, false);
    define(B.ifElse, operator({
        message0: 'if %1 then %2 else %3',
        args0: [boolInput('COND'), input('THEN'), input('ELSE')],
        inputsInline: true
    }), false);
    define(B.func1, operator({
        message0: '%1 of %2',
        args0: [menu('FN', FUNC1), input('A')],
        tooltip: 'Angles are in radians (a full turn is τ)'
    }), false);
    define(B.func2, operator({message0: '%1 of %2 and %3', args0: [menu('FN', FUNC2), input('A'), input('B')]}), false);
    define(B.clamp, operator({message0: 'keep %1 between %2 and %3', args0: [input('V'), input('LO'), input('HI')]}), false);
    define(B.lerp, operator({message0: 'blend %1 to %2 by %3',
        args0: [input('A'), input('B'), input('K')],
        tooltip: 'By 0 is the first, by 1 the second'}), false);
    define(B.smooth, operator({message0: 'smooth step of %1 from %2 to %3',
        args0: [input('X'), input('E0'), input('E1')],
        tooltip: '0 before "from", 1 after "to", easing in between'}), false);
    define(B.wobble, Object.assign({
        message0: 'jitter %1 by %2 speed %3 smoothness %4 at %5',
        args0: [input('VALUE'), input('AMP'), input('FREQ'), input('SMOOTH'), input('T')],
        inputsInline: true,
        tooltip: 'The value plus a random wobble: new values "speed" times a second, eased by smoothness (0 to 1)'
    }, number));
    define(B.jitter, Object.assign({
        message0: 'jitter by %1 speed %2 smoothness %3 at %4',
        args0: [input('AMP'), input('FREQ'), input('SMOOTH'), input('T')],
        inputsInline: true,
        tooltip: 'Random wobble: new values "speed" times a second, eased by smoothness (0 to 1)'
    }, number));
    define(B.noise, Object.assign({
        message0: 'noise at %1 seed %2',
        args0: [input('X'), input('SEED')],
        tooltip: 'Smooth random drift between -1 and 1'
    }, number));
    define(B.random, Object.assign({
        message0: 'random 0 to 1',
        tooltip: 'A new random number every frame (keeps the animation moving)'
    }, number));
};
const XML_ESCAPES = {'<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&apos;', '"': '&quot;'};
const esc = s => String(s).replace(/[<>&'"]/g, c => XML_ESCAPES[c]);
const numberShadowXml = v => `<shadow type="math_number"><field name="NUM">${v}</field></shadow>`;
const num = (name, v) => `<value name="${name}">${numberShadowXml(v)}</value>`;
const withBlock = (name, blockXml, shadowValue = 0) =>
    `<value name="${name}">${numberShadowXml(shadowValue)}${blockXml}</value>`;
const cat = (name, id, colour, secondary, body) =>
    `<category name="${name}" id="${id}" colour="${colour}" secondaryColour="${secondary}">${body}</category>`;
const OPERATOR_COLOURS = ['#59C059', '#46B946'];
const exprToolboxXML = () => {
    const time = `<block type="${B.time}"/>`;
    const timesSpeed = `<block type="operator_multiply">${withBlock('NUM1', time)}${num('NUM2', 6.28)}</block>`;
    const wave = `<block type="${B.func1}">${withBlock('A', timesSpeed)}</block>`;
    return `<xml style="display: none">
    ${cat('Values', 'animExprValues', ANIM_COLOURS.primary, ANIM_COLOURS.secondary, `
        <block type="${B.ret}">${num('VALUE', '')}</block>
        <block type="${B.value}"/>
        <block type="${B.time}"/>
        <block type="${B.data}"><field name="NAME">${esc(dataNames[0] || 'myVar')}</field></block>
        <block type="${B.clock}"/>
        <block type="${B.constant}"/>
    `)}
    ${cat('Operators', 'animExprOperators', OPERATOR_COLOURS[0], OPERATOR_COLOURS[1], `
        <block type="operator_add">${num('NUM1', '')}${num('NUM2', '')}</block>
        <block type="operator_subtract">${num('NUM1', '')}${num('NUM2', '')}</block>
        <block type="operator_multiply">${num('NUM1', '')}${num('NUM2', '')}</block>
        <block type="operator_divide">${num('NUM1', '')}${num('NUM2', '')}</block>
        <block type="${B.pow}">${num('A', '')}${num('B', 2)}</block>
        <block type="${B.rem}">${num('A', '')}${num('B', 1)}</block>
        <sep gap="36"/>
        <block type="${B.compare}">${num('A', '')}${num('B', 50)}</block>
        <block type="operator_and"/>
        <block type="operator_or"/>
        <block type="operator_not"/>
        <block type="${B.ifElse}">${num('THEN', 1)}${num('ELSE', 0)}</block>
    `)}
    ${cat('Math', 'animExprMath', OPERATOR_COLOURS[0], OPERATOR_COLOURS[1], `
        <block type="${B.func1}">${num('A', '')}</block>
        <block type="${B.func1}"><field name="FN">round</field>${num('A', '')}</block>
        <block type="${B.func2}">${num('A', '')}${num('B', '')}</block>
        <block type="${B.clamp}">${num('V', '')}${num('LO', 0)}${num('HI', 100)}</block>
        <block type="${B.lerp}">${num('A', 0)}${num('B', 100)}${num('K', 0.5)}</block>
        <block type="${B.smooth}">${withBlock('X', time)}${num('E0', 0)}${num('E1', 1)}</block>
    `)}
    ${cat('Wobble', 'animExprWobble', ANIM_COLOURS.primary, ANIM_COLOURS.secondary, `
        <block type="${B.wobble}">${withBlock('VALUE', `<block type="${B.value}"/>`)}${num('AMP', 10)}${num('FREQ', 8)}
            ${num('SMOOTH', 0.5)}${withBlock('T', time)}</block>
        <block type="${B.jitter}">${num('AMP', 10)}${num('FREQ', 8)}${num('SMOOTH', 0.5)}${withBlock('T', time)}</block>
        <block type="${B.noise}">${withBlock('X', time)}${num('SEED', 0)}</block>
        <block type="${B.random}"/>
        <sep gap="36"/>
        <label text="A wave: size × sin of (time × speed)"/>
        <block type="operator_multiply">${num('NUM1', 20)}${withBlock('NUM2', wave)}</block>
    `)}
</xml>`;
};
const numberText = v => { const n = Number(v); return Number.isFinite(n) ? String(n) : '0'; };
class BlocksError extends Error {}
const genBlock = block => {
    if (!block) return {code: '0', prec: 10};
    const inp = name => genBlock(block.getInputTargetBlock(name));
    const wrap = (g, min) => (g.prec < min ? `(${g.code})` : g.code);
    const binary = (op, prec, a, b, rightAssoc = false) => ({
        code: `${wrap(a, rightAssoc ? prec + 1 : prec)} ${op} ${wrap(b, rightAssoc ? prec : prec + 1)}`,
        prec
    });
    const call = (name, ...args) => ({code: `${name}(${args.map(a => a.code).join(', ')})`, prec: 10});
    switch (block.type) {
    case 'math_number':
    case 'math_positive_number':
    case 'math_whole_number':
    case 'math_integer': {
        const code = numberText(block.getFieldValue('NUM'));
        return {code, prec: code.startsWith('-') ? 7 : 10};
    }
    case 'text': {
        const v = block.getFieldValue('TEXT');
        if (String(v).trim() !== '' && Number.isFinite(Number(v))) {
            const code = numberText(v);
            return {code, prec: code.startsWith('-') ? 7 : 10};
        }
        return {code: JSON.stringify(String(v)), prec: 10};
    }
    case B.time: return {code: 't', prec: 10};
    case B.value: return {code: 'value', prec: 10};
    case B.clock: return {code: 'time', prec: 10};
    case B.random: return {code: 'random()', prec: 10};
    case B.constant: return {code: block.getFieldValue('C') || 'PI', prec: 10};
    case B.data: {
        const name = String(block.getFieldValue('NAME') || '');
        return {code: /^[A-Za-z_$][\w$]*$/.test(name) ? `data.${name}` : `data[${JSON.stringify(name)}]`, prec: 10};
    }
    case 'operator_add': return binary('+', 5, inp('NUM1'), inp('NUM2'));
    case 'operator_subtract': return binary('-', 5, inp('NUM1'), inp('NUM2'));
    case 'operator_multiply': return binary('*', 6, inp('NUM1'), inp('NUM2'));
    case 'operator_divide': return binary('/', 6, inp('NUM1'), inp('NUM2'));
    case B.pow: return binary('**', 8, inp('A'), inp('B'), true);
    case B.rem: return binary('%', 6, inp('A'), inp('B'));
    case B.compare: {
        const op = block.getFieldValue('OP') || '>';
        return binary(op, op === '==' || op === '!=' ? 3 : 4, inp('A'), inp('B'));
    }
    case 'operator_and': return binary('&&', 2, inp('OPERAND1'), inp('OPERAND2'));
    case 'operator_or': return binary('||', 1, inp('OPERAND1'), inp('OPERAND2'));
    case 'operator_not': return {code: `!${wrap(inp('OPERAND'), 7)}`, prec: 7};
    case B.ifElse: {
        const c = inp('COND');
        const a = inp('THEN');
        const b = inp('ELSE');
        return {code: `${wrap(c, 1)} ? ${wrap(a, 1)} : ${wrap(b, 0)}`, prec: 0};
    }
    case B.func1: return call(block.getFieldValue('FN') || 'sin', inp('A'));
    case B.func2: return call(block.getFieldValue('FN') || 'min', inp('A'), inp('B'));
    case B.clamp: return call('clamp', inp('V'), inp('LO'), inp('HI'));
    case B.lerp: return call('lerp', inp('A'), inp('B'), inp('K'));
    case B.smooth: return call('smoothstep', inp('E0'), inp('E1'), inp('X'));
    case B.jitter: return call('jitter', inp('T'), inp('AMP'), inp('FREQ'), inp('SMOOTH'));
    case B.wobble: return call('jitter', inp('T'), inp('VALUE'), inp('AMP'), inp('FREQ'), inp('SMOOTH'));
    case B.noise: return call('noise', inp('X'), inp('SEED'));
    default:
        throw new BlocksError(`The "${block.type}" block can't be used in an expression`);
    }
};
const blocksToExpr = workspace => {
    const root = workspace.getTopBlocks(false).find(b => b.type === B.called);
    if (!root) return {error: 'The "when expression is called" block is missing'};
    try {
        const ret = root.getNextBlock();
        if (!ret) return {text: ''};
        if (ret.type !== B.ret) return {error: 'Put a "return" block under "when expression is called"'};
        const value = ret.getInputTargetBlock('VALUE');
        const empty = value && value.type === 'math_number' && String(value.getFieldValue('NUM')).trim() === '';
        if (!value || empty) return {text: ''};
        return {text: genBlock(value).code};
    } catch (e) { return {error: e.message}; }
};
const UNARY_FUNCS = new Map(FUNC1.map(([, name]) => [name, name]));
const BINARY_FUNCS = new Map(FUNC2.map(([, name]) => [name, name]));
const COMPARE_OPS = {'>': '>', '<': '<', '==': '==', '===': '==', '>=': '>=', '<=': '<=', '!=': '!=', '!==': '!='};
const numShadow = v => `<shadow type="math_number"><field name="NUM">${esc(v)}</field></shadow>`;
const textShadow = v => `<shadow type="text"><field name="TEXT">${esc(v)}</field></shadow>`;
const blockXml = n => {
    const blk = (type, inner) => `<block type="${type}">${inner}</block>`;
    const field = (name, v) => `<field name="${name}">${esc(v)}</field>`;
    const val = (name, child) => `<value name="${name}">${inputXml(child)}</value>`;
    const bool = (name, child) => `<value name="${name}">${boolXml(child)}</value>`;
    switch (n.k) {
    case 'num':
    case 'str':
        return blk('operator_add', val('NUM1', n) + val('NUM2', {k: 'num', v: 0}));
    case 'var':
        if (n.name === 't' || n.name === 'sec') return blk(B.time, '');
        if (n.name === 'value') return blk(B.value, '');
        if (n.name === 'time') return blk(B.clock, '');
        throw new BlocksError('"data" on its own has no block... use data.name');
    case 'const': return blk(B.constant, field('C', n.name));
    case 'data': return blk(B.data, field('NAME', n.key));
    case 'dataIdx':
        if (n.key.k === 'str') return blk(B.data, field('NAME', n.key.v));
        throw new BlocksError('data[...] with a computed name has no block');
    case 'un':
        if (n.op === '-') return blk('operator_subtract', val('NUM1', {k: 'num', v: 0}) + val('NUM2', n.a));
        if (n.op === '+') return blockXml(n.a);
        return blk('operator_not', bool('OPERAND', n.a));
    case 'bin': {
        const ops = {'+': 'operator_add', '-': 'operator_subtract', '*': 'operator_multiply', '/': 'operator_divide'};
        if (ops[n.op]) return blk(ops[n.op], val('NUM1', n.a) + val('NUM2', n.b));
        if (n.op === '**') return blk(B.pow, val('A', n.a) + val('B', n.b));
        if (n.op === '%') return blk(B.rem, val('A', n.a) + val('B', n.b));
        if (n.op === '&&') return blk('operator_and', bool('OPERAND1', n.a) + bool('OPERAND2', n.b));
        if (n.op === '||') return blk('operator_or', bool('OPERAND1', n.a) + bool('OPERAND2', n.b));
        if (COMPARE_OPS[n.op]) return blk(B.compare, val('A', n.a) + field('OP', COMPARE_OPS[n.op]) + val('B', n.b));
        throw new BlocksError(`"${n.op}" has no block`);
    }
    case 'cond': return blk(B.ifElse, bool('COND', n.c) + val('THEN', n.a) + val('ELSE', n.b));
    case 'call': {
        const a = n.args;
        const num1 = v => ({k: 'num', v});
        if (UNARY_FUNCS.has(n.name) && a.length === 1) return blk(B.func1, field('FN', n.name) + val('A', a[0]));
        if (BINARY_FUNCS.has(n.name) && a.length === 2) {
            return blk(B.func2, field('FN', n.name) + val('A', a[0]) + val('B', a[1]));
        }
        if (n.name === 'clamp' && a.length === 3) { return blk(B.clamp, val('V', a[0]) + val('LO', a[1]) + val('HI', a[2])); }
        if (n.name === 'lerp' && a.length === 3) return blk(B.lerp, val('A', a[0]) + val('B', a[1]) + val('K', a[2]));
        if (n.name === 'smoothstep' && a.length === 3) {
            return blk(B.smooth, val('X', a[2]) + val('E0', a[0]) + val('E1', a[1]));
        }
        if (n.name === 'random' && !a.length) return blk(B.random, '');
        if (n.name === 'jitter' && a.length === 5) {
            return blk(B.wobble, val('VALUE', a[1]) + val('AMP', a[2]) + val('FREQ', a[3]) +
                val('SMOOTH', a[4]) + val('T', a[0]));
        }
        if (n.name === 'jitter' && a.length >= 1 && a.length <= 4) {
            return blk(B.jitter, val('AMP', a[1] || num1(1)) + val('FREQ', a[2] || num1(1)) +
                val('SMOOTH', a[3] || num1(0.5)) + val('T', a[0]));
        }
        if (n.name === 'noise' && (a.length === 1 || a.length === 2)) {
            return blk(B.noise, val('X', a[0]) + val('SEED', a[1] || num1(0)));
        }
        throw new BlocksError(`${n.name}() with ${a.length} input${a.length === 1 ? '' : 's'} has no block`);
    }
    }
    throw new BlocksError('That has no block');
};
const inputXml = n => {
    if (n.k === 'num') return numShadow(n.v);
    if (n.k === 'str') return textShadow(n.v);
    if (n.k === 'un' && n.op === '-' && n.a.k === 'num') return numShadow(-n.a.v);
    return numShadow('') + blockXml(n);
};
const boolXml = n => {
    if (n.k === 'num' || n.k === 'str') return blockXml({k: 'bin', op: '!=', a: n, b: {k: 'num', v: 0}});
    return blockXml(n);
};
const exprToBlocksXML = text => {
    const src = exprBody(text);
    const value = `<value name="VALUE">${src ? inputXml(parseExpr(src)) : numShadow('')}</value>`;
    return `<xml xmlns="http://www.w3.org/1999/xhtml"><block type="${B.called}" x="40" y="40">` +
        `<value name="VALUE"><shadow type="${B.value}"/></value>` +
        `<next><block type="${B.ret}">${value}</block></next></block></xml>`;
};
const isExprBlocksXML = xml => typeof xml === 'string' && xml.includes(`"${B.called}"`);
export {ANIM_COLOURS, EXPR_BLOCK, animationCategoryXML, animationChoices, blocksToExpr, defineAnimationBlocks, defineExprBlocks, exprToBlocksXML, exprToolboxXML, isExprBlocksXML, menuShowsAll, setAnimationMenuVM, setExprDataNames, toggleMenuShowsAll};
