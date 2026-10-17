const SET_BLOCKSPACE_FOCUS = 'scratch-gui/blockspace/SET_BLOCKSPACE_FOCUS';

const initialState = {
    focus: null
};

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case SET_BLOCKSPACE_FOCUS:
        return {...state, focus: action.focus};
    default:
        return state;
    }
};

const setBlockspaceFocus = focus => ({
    type: SET_BLOCKSPACE_FOCUS,
    focus: focus ? {targetId: focus.targetId, id: focus.id} : null
});

export {
    reducer as default,
    initialState as blockspaceInitialState,
    setBlockspaceFocus
};
