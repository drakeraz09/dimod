import {ANY, ASSET_OPCODES, KINDS, MEDIA_OPCODES, MYSELF, REL, SCENE_OPCODES, STAGE} from './dimod-scenes';
const SCENE_COLOURS = {primary: '#4C6EF5', secondary: '#3F5CCC', tertiary: '#3450B0'};
const ASSET_COLOURS = {primary: '#C97B2A', secondary: '#A96520', tertiary: '#8F541A'};
const LOOKS_COLOURS = {primary: '#9966FF', secondary: '#855CD6', tertiary: '#774DCB'};
const SOUND_COLOURS = {primary: '#CF63CF', secondary: '#C94FC9', tertiary: '#BD42BD'};
const escapeXML = text => String(text).replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&apos;', '"': '&quot;'
}[c]));
let menuVM = null;
const setScenesMenuVM = vm => { menuVM = vm; };
const sceneNames = () => (menuVM && menuVM.dimodScenes ? menuVM.dimodScenes.names : []);
const assetNames = kind => (menuVM && menuVM.dimodAssets ? menuVM.dimodAssets.ofKind(kind).map(a => a.name) : []);
const originals = () => (menuVM ? menuVM.runtime.targets.filter(t => t.isOriginal) : []);
const spriteOptions = () => [['myself', MYSELF], ...originals().filter(t => !t.isStage).map(t => [t.getName(), t.getName()]),
    ['Stage', STAGE]];
const ownerOfValue = value => {
    const editing = menuVM && menuVM.editingTarget;
    if (value === MYSELF) return editing ? (editing.isStage || editing.isOriginal ? editing : editing.sprite.clones[0]) : null;
    return originals().find(t => (value === STAGE ? t.isStage : !t.isStage && t.getName() === value)) || null;
};
const mediaNames = (value, kind) => {
    const owner = ownerOfValue(value);
    if (!owner) return [];
    return (kind === 'costume' ? owner.getCostumes() : owner.sprite.sounds).map(item => item.name);
};
const options = names => (names.length ? names.map(n => [n, n]) : [['', '']]);
const defineScenesBlocks = ScratchBlocks => {
    const make = (colours, opcode, json) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit(Object.assign({id: opcode}, {
                    colour: colours.primary, colourSecondary: colours.secondary, colourTertiary: colours.tertiary
                }, json));
            }
        };
    };
    const input = name => ({type: 'input_value', name});
    const dropdown = (name, list) => ({type: 'field_dropdown', name, options: list});
    const statement = (message, args = []) => ({message0: message, args0: args, extensions: ['shape_statement']});
    const reporter = (message, args = []) => ({
        message0: message, args0: args, output: null, outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND
    });
    const bool = (message, args = []) => ({
        message0: message, args0: args, output: 'Boolean', outputShape: ScratchBlocks.OUTPUT_SHAPE_HEXAGONAL
    });
    const menu = (colours, opcode, field, list) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit({
                    message0: '%1',
                    args0: [{type: 'field_textdropdown', name: field, text: '', options: list}],
                    output: 'String',
                    outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND,
                    colour: '#FFFFFF', colourSecondary: '#FFFFFF', colourTertiary: '#FFFFFF'
                });
            }
        };
    };
    const S = SCENE_OPCODES;
    const scene = (opcode, json) => make(SCENE_COLOURS, opcode, json);
    menu(SCENE_COLOURS, S.menu, 'SCENE', () => options(sceneNames()));
    menu(SCENE_COLOURS, S.relMenu, 'WHICH', () => REL.map(r => [r, r]));
    scene(S.goTo, statement('go to scene %1', [input('SCENE')]));
    scene(S.goToRel, statement('go to %1 scene', [input('WHICH')]));
    scene(S.whenEntered, {
        message0: 'when scene %1 starts',
        args0: [dropdown('SCENE', () => options([ANY, ...sceneNames()]))],
        extensions: ['shape_hat'],
        tooltip: 'Runs when the project starts in this scene or when anything switches to it'
    });
    scene(S.current, reporter('scene name'));
    scene(S.index, reporter('scene number'));
    scene(S.count, reporter('number of scenes'));
    scene(S.nameOf, reporter('name of scene %1', [input('INDEX')]));
    scene(S.add, statement('add this sprite to scene %1', [input('SCENE')]));
    scene(S.remove, statement('remove this sprite from scene %1', [input('SCENE')]));
    scene(S.names, reporter('scene names'));
    scene(S.sprites, reporter('sprites in scene %1', [input('SCENE')]));
    scene(S.ofSprite, reporter('scenes of this sprite'));
    scene(S.isIn, bool('this sprite in scene %1 ?', [input('SCENE')]));
    const media = (colours, opcode, kind, field) => {
        ScratchBlocks.Blocks[opcode] = {
            init: function () {
                this.jsonInit({
                    message0: `${kind} %1 of %2`,
                    args0: [
                        {type: 'field_textdropdown', name: field, text: '', options: function () {
                            const block = this.sourceBlock_;
                            return options(mediaNames(block ? block.getFieldValue('SPRITE') : MYSELF, kind));
                        }},
                        {type: 'field_dropdown', name: 'SPRITE', options: spriteOptions}
                    ],
                    output: null,
                    outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND,
                    colour: colours.primary, colourSecondary: colours.secondary, colourTertiary: colours.tertiary,
                    tooltip: `A ${kind} from any sprite. Put it in ${kind === 'costume' ?
                        'switch costume or switch backdrop: the sprite borrows the look without copying it' :
                        'any sound block: it plays through this sprite with its own effects and volume'}`
                });
            },
            onchange: function (event) {
                if (event.type !== 'change' || event.blockId !== this.id || event.name !== 'SPRITE') return;
                const names = mediaNames(event.newValue, kind);
                if (names.length && !names.includes(this.getFieldValue(field))) this.setFieldValue(names[0], field);
            }
        };
    };
    media(LOOKS_COLOURS, MEDIA_OPCODES.costumeOf, 'costume', 'COSTUME');
    media(SOUND_COLOURS, MEDIA_OPCODES.soundOf, 'sound', 'SOUND');
    const A = ASSET_OPCODES;
    const asset = (opcode, json) => make(ASSET_COLOURS, opcode, json);
    menu(ASSET_COLOURS, A.menu, 'ASSET', () => options(assetNames('any')));
    menu(ASSET_COLOURS, A.kindMenu, 'KIND', () => [['any', 'any'], ...KINDS.map(k => [k, k])]);
    asset(A.ref, {
        message0: 'asset %1',
        args0: [{type: 'field_textdropdown', name: 'ASSET', text: '', options: () => options(assetNames('any'))}],
        output: null,
        outputShape: ScratchBlocks.OUTPUT_SHAPE_ROUND,
        tooltip: 'An asset from the Assets tab. Put it in switch costume, switch backdrop or any sound block'
    });
    const looks = (opcode, json) => make(LOOKS_COLOURS, opcode, json);
    looks(A.setSkin, statement('set skin to %1', [input('ASSET')]));
    looks(A.clearSkin, statement('clear skin'));
    looks(A.skinName, reporter('skin name'));
    asset(A.text, reporter('text of asset %1', [input('ASSET')]));
    asset(A.info, reporter('%1 of asset %2', [
        dropdown('PROP', [['type', 'type'], ['format', 'format'], ['size (bytes)', 'size'], ['name', 'name']]),
        input('ASSET')
    ]));
    asset(A.exists, bool('asset %1 exists?', [input('ASSET')]));
    asset(A.count, reporter('number of %1 assets', [input('KIND')]));
    asset(A.nameOf, reporter('name of %1 asset %2', [input('KIND'), input('INDEX')]));
    asset(A.names, reporter('%1 asset names', [input('KIND')]));
    asset(A.array, reporter('array from asset %1', [input('ASSET')]));
    asset(A.url, reporter('URL of asset %1', [input('ASSET')]));
    asset(A.write, statement('write %1 to text asset %2', [input('TEXT'), input('ASSET')]));
    asset(A.costume, statement('switch costume to image asset %1', [input('ASSET')]));
    asset(A.backdrop, statement('switch backdrop to image asset %1', [input('ASSET')]));
    asset(A.sound, statement('play sound asset %1', [input('ASSET')]));
};
const SEPARATOR = '<sep gap="36"/>';
const textInput = (name, value) =>
    `<value name="${name}"><shadow type="text"><field name="TEXT">${escapeXML(value)}</field></shadow></value>`;
const numberInput = (name, value) =>
    `<value name="${name}"><shadow type="math_number"><field name="NUM">${value}</field></shadow></value>`;
const menuInput = (name, opcode, value) =>
    `<value name="${name}"><shadow type="${opcode}"><field name="${name}">${escapeXML(value)}</field></shadow></value>`;
const scenesCategoryXML = () => {
    const S = SCENE_OPCODES;
    const host = menuVM && menuVM.dimodScenes;
    const scene = menuInput('SCENE', S.menu, host && host.currentScene ? host.currentScene.name : sceneNames()[0] || '');
    return `
    <category
        name="Scenes"
        id="dimodScenes"
        colour="${SCENE_COLOURS.primary}"
        secondaryColour="${SCENE_COLOURS.secondary}">
        <block type="${S.whenEntered}"/>
        <block type="${S.goTo}">${scene}</block>
        <block type="${S.goToRel}">${menuInput('WHICH', S.relMenu, 'next')}</block>
        ${SEPARATOR}
        <block type="${S.current}"/>
        <block type="${S.index}"/>
        <block type="${S.count}"/>
        <block type="${S.nameOf}">${numberInput('INDEX', 1)}</block>
        ${SEPARATOR}
        <block type="${S.add}">${scene}</block>
        <block type="${S.remove}">${scene}</block>
        <block type="${S.isIn}">${scene}</block>
        ${SEPARATOR}
        <block type="${S.names}"/>
        <block type="${S.sprites}">${scene}</block>
        <block type="${S.ofSprite}"/>
    </category>`;
};
const refBlock = name => `<block type="${ASSET_OPCODES.ref}"><field name="ASSET">${escapeXML(name)}</field></block>`;
const withRef = (name, shadow, field, value, ref) =>
    `<value name="${name}"><shadow type="${shadow}"><field name="${field}">${escapeXML(value || '')}</field></shadow>${ref}</value>`;
const refInput = (name, shadow, field, value) => withRef(name, shadow, field, value, refBlock(value || ''));
const firstOf = kind => assetNames(kind)[0] || '';
const editing = () => (menuVM && menuVM.editingTarget) || null;
const ownSound = () => (editing() && editing().sprite.sounds[0] ? editing().sprite.sounds[0].name : '');
const ownCostume = () => {
    const target = editing();
    const costume = target && target.getCostumes()[target.currentCostume];
    return costume ? costume.name : '';
};
const soundInput = ref => withRef('SOUND_MENU', 'sound_sounds_menu', 'SOUND_MENU', ownSound(), ref);
const otherOwner = (kind, isStage) => {
    const list = originals().filter(t => t !== editing() && !(isStage && t.isStage));
    const has = t => (kind === 'costume' ? t.getCostumes() : t.sprite.sounds).length;
    return list.find(t => !t.isStage && has(t)) || list.find(has) || null;
};
const mediaBlock = (kind, isStage) => {
    const owner = otherOwner(kind, isStage);
    const self = editing();
    const list = owner ? (kind === 'costume' ? owner.getCostumes() : owner.sprite.sounds) :
        self ? (kind === 'costume' ? self.getCostumes() : self.sprite.sounds) : [];
    const M = MEDIA_OPCODES;
    const field = kind === 'costume' ? 'COSTUME' : 'SOUND';
    const sprite = owner ? (owner.isStage ? STAGE : escapeXML(owner.getName())) : MYSELF;
    return `<block type="${kind === 'costume' ? M.costumeOf : M.soundOf}"><field name="${field}">${
        escapeXML(list[0] ? list[0].name : '')}</field><field name="SPRITE">${sprite}</field></block>`;
};
const looksAssetsXML = isStage => mediaBlock('costume', isStage);
const soundAssetsXML = () => mediaBlock('sound', false);
const assetsCategoryXML = isStage => {
    const A = ASSET_OPCODES;
    const first = firstOf('any');
    const image = firstOf('image');
    const sound = firstOf('sound');
    const anyAsset = menuInput('ASSET', A.menu, first);
    const text = menuInput('ASSET', A.menu, firstOf('text') || first);
    const kind = menuInput('KIND', A.kindMenu, 'any');
    return `
    <category
        name="Assets"
        id="dimodAssets"
        colour="${ASSET_COLOURS.primary}"
        secondaryColour="${ASSET_COLOURS.secondary}">
        ${refBlock(first)}
        ${SEPARATOR}
        ${isStage ? '' : `<block type="looks_switchcostumeto">${refInput('COSTUME', 'looks_costume', 'COSTUME', image)}</block>`}
        <block type="looks_switchbackdropto">${refInput('BACKDROP', 'looks_backdrops', 'BACKDROP', image)}</block>
        <block type="sound_playuntildone">${soundInput(refBlock(sound))}</block>
        <block type="sound_play">${soundInput(refBlock(sound))}</block>
        <block type="sound_stop">${soundInput(refBlock(sound))}</block>
        ${SEPARATOR}
        <block type="${A.text}">${text}</block>
        <block type="${A.write}">${textInput('TEXT', 'hello')}${menuInput('ASSET', A.menu, firstOf('text') || 'notes')}</block>
        <block type="${A.array}">${text}</block>
        ${SEPARATOR}
        <block type="${A.info}">${anyAsset}</block>
        <block type="${A.exists}">${anyAsset}</block>
        <block type="${A.url}">${anyAsset}</block>
        <block type="${A.names}">${kind}</block>
    </category>`;
};
export {ASSET_COLOURS, SCENE_COLOURS, assetsCategoryXML, looksAssetsXML, soundAssetsXML, defineScenesBlocks, scenesCategoryXML, setScenesMenuVM};
