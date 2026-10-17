const PM_LIBRARY_API = 'https://library.penguinmod.com/';

const isAbsolute = page => /^https?:\/\//i.test(String(page || ''));

const libraryAssetUrl = page => (isAbsolute(page) ? page : `${PM_LIBRARY_API}files/${page}`);

const libraryAssetThumbUrl = page => {
    const url = libraryAssetUrl(page);
    if (!isAbsolute(page)) return url;
    return `${url}${url.includes('?') ? '&' : '?'}thumb=1`;
};

export {PM_LIBRARY_API, isAbsolute, libraryAssetUrl, libraryAssetThumbUrl};
