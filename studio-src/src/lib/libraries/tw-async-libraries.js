import {getDimodCustomLibrary} from '../dimod-project';

const asyncLibrary = (callback, kind) => {
    let data = null;
    return () => {
        if (data) return data;
        return Promise.all([
            callback().then(mod => mod.default),
            getDimodCustomLibrary(kind)
        ]).then(([builtin, custom]) => (data = custom.length ? custom.concat(builtin) : builtin));
    };
};

export const getBackdropLibrary = asyncLibrary(
    () => import(/* webpackChunkName: "library-backdrops" */ './backdrops.json'),
    'backdrop'
);
export const getCostumeLibrary = asyncLibrary(
    () => import(/* webpackChunkName: "library-costumes" */ './costumes.json'),
    'costume'
);
export const getSoundLibrary = asyncLibrary(
    () => import(/* webpackChunkName: "library-sounds" */ './sounds.json'),
    'sound'
);
export const getSpriteLibrary = asyncLibrary(
    () => import(/* webpackChunkName: "library-sprites" */ './sprites.json'),
    'sprite'
);
