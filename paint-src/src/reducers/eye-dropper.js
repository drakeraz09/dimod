import EyeDropperStyles from '../lib/eye-dropper-styles';

const ACTIVATE_EYE_DROPPER = 'scratch-paint/eye-dropper/ACTIVATE_COLOR_PICKER';
const DEACTIVATE_EYE_DROPPER = 'scratch-paint/eye-dropper/DEACTIVATE_COLOR_PICKER';

const initialState = {
    active: false,
    callback: () => {}, // this will either be `onChangeFillColor` or `onChangeOutlineColor`
    previousTool: null, // the tool that was previously active before eye dropper
    style: EyeDropperStyles.COLOR
};

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case ACTIVATE_EYE_DROPPER:
        return Object.assign(
            {},
            state,
            {
                active: true,
                callback: action.callback,
                previousTool: action.previousMode,
                style: action.style || EyeDropperStyles.COLOR
            }
        );
    case DEACTIVATE_EYE_DROPPER:
        return Object.assign(
            {},
            state,
            {
                active: false,
                callback: () => {},
                previousTool: null,
                style: EyeDropperStyles.COLOR
            }
        );
    default:
        return state;
    }
};

const activateEyeDropper = function (currentMode, callback, style) {
    return {
        type: ACTIVATE_EYE_DROPPER,
        callback: callback,
        previousMode: currentMode,
        style: style || EyeDropperStyles.COLOR
    };
};
const deactivateEyeDropper = function () {
    return {
        type: DEACTIVATE_EYE_DROPPER
    };
};

export {
    reducer as default,
    activateEyeDropper,
    deactivateEyeDropper,
    ACTIVATE_EYE_DROPPER,
    DEACTIVATE_EYE_DROPPER
};
