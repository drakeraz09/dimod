import {defineClientBlocks, defineServerBlocks} from './dimod-server-blocks';
import {colourStringBlocks, defineExtraBlocks, defineMediaEffectBlocks} from './dimod-block-defs';
import {defineAnimationBlocks, defineExprBlocks} from './dimod-animation/blocks';
import {installReportColours} from './dimod-ui';
import {defineScenesBlocks} from './dimod-scenes-blocks';
import {defineBlockspaceBlocks} from './block-space/editor';
let _ScratchBlocks = null;
let _WasNameYourmom = false;

// eslint-disable-next-line no-return-assign
const isNameUrMom = () => _WasNameYourmom = (() => {
    const username = localStorage
        .getItem('tw:username');
    return username && ((username.toLowerCase() === 'yourmom') || (username.toLowerCase() === 'yourmother') ||
        (username.toLowerCase() === 'urmom') || (username.toLowerCase() === 'urmother'));
})();

const wasNameYourmom = () => {
    const old = _WasNameYourmom;
    _WasNameYourmom = isNameUrMom();
    return old;
};

const callbacks = [];
const isLoaded = () => !!_ScratchBlocks && (isNameUrMom() === wasNameYourmom());

const get = () => {
    if (!_ScratchBlocks) {
        throw new Error('scratch-blocks is not loaded yet');
    }
    return _ScratchBlocks;
};

const load = () => {
    if (_ScratchBlocks && (isNameUrMom() === wasNameYourmom())) {
        window.ScratchBlocks = _ScratchBlocks;
        return Promise.resolve(_ScratchBlocks);
    }
    _ScratchBlocks = null;
    return import(/* webpackChunkName: "sb" */ 'scratch-blocks')
        .then(m => {
            _ScratchBlocks = m.default;

            defineClientBlocks(_ScratchBlocks);
            defineServerBlocks(_ScratchBlocks);
            defineExtraBlocks(_ScratchBlocks);
            defineMediaEffectBlocks(_ScratchBlocks);
            defineAnimationBlocks(_ScratchBlocks);
            defineExprBlocks(_ScratchBlocks);
            defineScenesBlocks(_ScratchBlocks);
            installReportColours(_ScratchBlocks);
            defineBlockspaceBlocks(_ScratchBlocks);
            colourStringBlocks(_ScratchBlocks);

            _ScratchBlocks.Blocks.control_from_to = {
                init: function () {
                    this.jsonInit({
                        message0: 'for %1 of %2 to %3',
                        args0: [
                            { type: 'input_value', name: 'SHADOW' },
                            { type: 'input_value', name: 'FROM' },
                            { type: 'input_value', name: 'TO' }
                        ],
                        message1: '%1',
                        args1: [
                            { type: 'input_statement', name: 'SUBSTACK' }
                        ],
                        inputsInline: true,
                        previousStatement: null,
                        nextStatement: null,
                        colour: '#FFAB19',
                        colourSecondary: '#CF8B17',
                        colourTertiary: '#CF8B17'
                    });
                }
            };
            _ScratchBlocks.Blocks.control_from_to_index = {
                init: function () {
                    this.jsonInit({
                        message0: 'index',
                        inputsInline: true,
                        colour: '#FFAB19',
                        colourSecondary: '#CF8B17',
                        colourTertiary: '#CF8B17'
                    });
                    this.setOutput(true);
                    this.setOutputShape(_ScratchBlocks.OUTPUT_SHAPE_ROUND);
                },
                onchange: function (event) {
                    if (event.type !== 'move' || event.blockId !== this.id) return;
                    if (!event.oldParentId || event.newParentId || event.oldInputName !== 'SHADOW') return;
                    const oldParent = this.workspace.getBlockById(event.oldParentId);
                    if (!oldParent || oldParent.type !== 'control_from_to') return;
                    const input = oldParent.getInput('SHADOW');
                    if (!input || input.connection.targetBlock()) return;
                    const replacement = this.workspace.newBlock('control_from_to_index');
                    replacement.initSvg();
                    replacement.render();
                    input.connection.connect(replacement.outputConnection);
                }
            };

            for (const callback of callbacks) {
                callback(_ScratchBlocks);
            }
            callbacks.length = 0;

            if (isNameUrMom()) {
                _ScratchBlocks.Blocks.your_mom = {
                    init() {
                        this.jsonInit({
                            message0: 'your mom %1',
                            args0: [
                                {
                                    type: 'field_image',
                                    src: 'https://cdn.discordapp.com/emojis/1039714598959452261.webp?size=128&quality=lossless',
                                    width: 15,
                                    height: 15,
                                    alt: '*',
                                    flipRtl: false
                                }
                            ],
                            inputsInline: true,
                            previousStatement: null,
                            nextStatement: null,
                            colour: '#ff0000',
                            tooltip: 'your mom :trel:',
                            helpUrl: 'https://tenor.com/view/urmom-your-mom-baldi-defaultdance-gif-19665250'
                        });
                    }
                };

                const oldFieldRenderer = _ScratchBlocks.BlockSvg.prototype.renderFields_;
                _ScratchBlocks.BlockSvg.prototype.renderFields_ = function (fieldList, cursorX,
                    cursorY) {
                    if (
                        !fieldList[0] ||
                        !fieldList[0].getValue ||
                        fieldList[0].getValue() !== 'your mom'
                    ) {
                        for (const field of fieldList) {
                            for (const propName in field) {
                                const prop = field[propName];
                                if (!prop || !prop.style || prop.style.display === 'none') continue;
                                prop.style.display = 'none';
                            }
                        }
                        return cursorX;
                    }
                    return oldFieldRenderer.call(this, fieldList, cursorX, cursorY);
                };
                const oldConstructor = _ScratchBlocks.Block.prototype.constructor;
                // eslint-disable-next-line no-loop-func
                _ScratchBlocks.Block.prototype.constructor = function (...args) {
                    const [_, prototypeName] = [...args];
                    if (prototypeName && !_ScratchBlocks.Blocks[prototypeName].yourMomed) {
                        _ScratchBlocks.Blocks[prototypeName].yourMomed = true;
                        const oldInit = _ScratchBlocks.Blocks[prototypeName].init;
                        _ScratchBlocks.Blocks[prototypeName].init = function () {
                            oldInit.call(this);
                            if (this.inputList.length < 1 || this.inputList[0].name !== 'yourMom') {
                                this.appendDummyInput('yourMom')
                                    .appendField('your mom')
                                    .appendField(new _ScratchBlocks.FieldImage(
                                        'https://penguinmod.com/dump/1039714598959452261.webp',
                                        15,
                                        15,
                                        '*',
                                        false
                                    ));
                            }
                            if (this.inputList.length > 1) {
                                this.moveInputBefore('yourMom', this.inputList[0].name);
                            }
                            this.setColour('#ff0000');
                            this.setTooltip('your mom :trel:');
                            this.setHelpUrl('https://penguinmod.com/dump/urmom-your-mom.gif');
                        };
                    }
                    const oldLoad = _ScratchBlocks.Blocks[prototypeName].domToMutation;
                    _ScratchBlocks.Blocks[prototypeName].domToMutation = function (dom) {
                        if (oldLoad) oldLoad.call(this, dom);
                        if (this.inputList.length < 1 || this.inputList[0].name !== 'yourMom') {
                            this.appendDummyInput('yourMom')
                                .appendField('your mom')
                                .appendField(new _ScratchBlocks.FieldImage(
                                    'https://penguinmod.com/dump/1039714598959452261.webp',
                                    15,
                                    15,
                                    '*',
                                    false
                                ));
                        }
                        if (this.inputList.length > 1) {
                            this.moveInputBefore('yourMom', this.inputList[0].name);
                        }
                        this.setColour('#ff0000');
                        this.setTooltip('your mom :trel:');
                        this.setHelpUrl('https://penguinmod.com/dump/urmom-your-mom.gif');
                    };
                    oldConstructor.call(this, ...args);
                };
            }

            return _ScratchBlocks;
        });
};

const onLoaded = callback => {
    if (_ScratchBlocks) {
        callback(_ScratchBlocks);
    } else {
        callbacks.push(callback);
    }
};

export default {
    get,
    isLoaded,
    isNameUrMom,
    wasNameYourmom,
    load,
    onLoaded
};
