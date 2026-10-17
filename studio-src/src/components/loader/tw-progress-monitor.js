// This file implements some extremely terrible tricks to monitor project loading progress.
// Please don't use this as a reference for "good JS code"

let total = 0;
let complete = 0;

// 0 - none
// 1 - load json
// 2 - load assets
let state = 0;

let currentProgress = 0;

const info = {loaded: 0, totalBytes: 0, rate: 0};

let progressHandler = (state, progress, complete, total, info) => {};

export const setProgressHandler = newHandler => {
    progressHandler = newHandler;
    progressHandler(state, currentProgress, complete, total, info);
};

let progressHandlerTimeout = null;
const fireProgressHandler = () => {
    progressHandler(state, currentProgress, complete, total, info);
    progressHandlerTimeout = null;
};

const queueProgressHandlerUpdate = () => {
    if (progressHandlerTimeout === null) {
        progressHandlerTimeout = requestAnimationFrame(fireProgressHandler);
    }
};

const setProgress = progress => {
    if (progress < 0) {
        progress = 0;
    }
    if (progress > 1) {
        progress = 1;
    }
    currentProgress = progress;
    queueProgressHandlerUpdate();
};

const setState = newState => {
    if (state === newState) {
        return;
    }
    state = newState;
    complete = 0;
    total = 0;
    info.loaded = 0;
    info.totalBytes = 0;
    info.rate = 0;
    setProgress(0);
};

const XHR_RETRY_ATTEMPTS = 3;
const XHR_RETRY_DELAY_MS = 700;

const requestOnce = (url, headers) => new Promise((resolve, reject) => {
    // fetch() does not support progress, so we use XMLHttpRequest
    const xhr = new XMLHttpRequest();
    xhr.responseType = 'blob';
    xhr.onload = () => {
        resolve(new Response(xhr.response, {
            status: xhr.status,
            statusText: xhr.statusText
        }));
    };
    xhr.onloadend = () => setProgress(1);
    xhr.onerror = () => reject(new Error(`[tw-progress-monitor] xhr failed with status ${xhr.status}`));
    const samples = [];
    xhr.onprogress = e => {
        const now = performance.now();
        samples.push([now, e.loaded]);
        while (samples.length > 2 && now - samples[0][0] > 2000) samples.shift();
        const [t0, b0] = samples[0];
        if (now - t0 > 250) info.rate = (e.loaded - b0) / ((now - t0) / 1000);
        info.loaded = e.loaded;
        info.totalBytes = e.lengthComputable ? e.total : 0;
        if (e.lengthComputable) {
            setProgress(e.loaded / e.total);
        } else {
            queueProgressHandlerUpdate();
        }
    };
    xhr.open('GET', url);
    if (headers) Object.keys(headers).forEach(name => xhr.setRequestHeader(name, headers[name]));
    xhr.send();
});

const COSTUME_EXT = /\.(png|jpe?g|gif|svg|bmp|webp)$/i;
const SOUND_EXT = /\.(wav|mp3|ogg|flac|m4a)$/i;
const assetDone = () => {
    if (state !== 3 || complete >= total) return;
    complete++;
    setProgress(complete / total);
};
const instrumented = new WeakSet();
const wrap = (obj, method, after) => {
    if (!obj || typeof obj[method] !== 'function' || instrumented.has(obj[method])) return;
    const original = obj[method];
    const wrapped = function (...args) {
        const result = original.apply(this, args);
        after(result);
        return result;
    };
    instrumented.add(wrapped);
    obj[method] = wrapped;
};
export const beginAssetLoading = (vm, manifest) => {
    if (!vm || !manifest) return;
    const names = Object.keys(manifest).filter(n => !n.startsWith('extraAssets/') && (COSTUME_EXT.test(n) || SOUND_EXT.test(n)));
    if (!names.length) return;
    const runtime = vm.runtime;
    wrap(runtime.renderer, 'createSVGSkin', assetDone);
    wrap(runtime.renderer, 'createBitmapSkin', assetDone);
    wrap(runtime.audioEngine, 'decodeSoundPlayer', result => {
        if (result && typeof result.then === 'function') result.then(assetDone, assetDone);
        else assetDone();
    });
    setState(3);
    total = names.length;
    info.totalBytes = names.reduce((sum, n) => sum + (parseInt(String(manifest[n]).split(':')[1], 10) || 0), 0);
    queueProgressHandlerUpdate();
};

export const fetchWithProgress = async (url, options = {}, attempt = 1) => {
    setState(1);
    info.loaded = 0;
    info.totalBytes = 0;
    info.rate = 0;
    setProgress(0);
    try {
        return await requestOnce(url, options.headers);
    } catch (err) {
        if (attempt >= (options.attempts || XHR_RETRY_ATTEMPTS)) throw err;
        await new Promise(res => setTimeout(res, XHR_RETRY_DELAY_MS * attempt));
        return fetchWithProgress(url, options, attempt + 1);
    }
};

// Scratch uses fetch() to download the project JSON, so we override it to monitor when the project is being downloaded.
const originalFetch = window.fetch;
window.fetch = (url, opts) => {
    const isGET = typeof opts === 'object' && opts && opts.method === 'GET';
    const isProjectURL = typeof url === 'string' && /^https:\/\/projects\.scratch\.mit\.edu\/\d+$/.test(url);
    if (isGET && isProjectURL) {
        return fetchWithProgress(url);
    }
    return originalFetch(url, opts);
};

const handleWorkerMessage = e => {
    const data = e.data;
    if (Array.isArray(data)) {
        complete += data.length;
        setProgress(complete / total);
    }
};

if (window.Worker) {
    let downloadWorker = null;
    const originalPostMessage = window.Worker.prototype.postMessage;
    window.Worker.prototype.postMessage = function (message) {
        if (downloadWorker === null) {
            if (message && message.url && message.id && message.options) {
                downloadWorker = this;
                downloadWorker.addEventListener('message', handleWorkerMessage);
            }
        }
        if (downloadWorker === this) {
            setState(2);
            total++;
        }
        originalPostMessage.call(this, message);
    };
}
