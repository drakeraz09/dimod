import {makeAnimId, uniqueName} from '../dimod-animation/core';
import {animationsOf} from '../dimod-animation/runtime';
import {animFileObject, animFromFileObject, getEditorVM, renderThumbnail, setEditorVM} from '../dimod-animation/editor';
import {arrayBufferToBase64, base64ToArrayBuffer} from '../tw-base64-utils';
const fallbackThumbnail = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = ctx.fillStyle = '#0E9AA7';
    ctx.lineWidth = 6;
    ctx.strokeRect(12, 22, 72, 52);
    ctx.beginPath();
    ctx.moveTo(40, 34);
    ctx.lineTo(40, 62);
    ctx.lineTo(62, 48);
    ctx.fill();
    return canvas.toDataURL('image/png').split(',')[1];
};
const ready = vm => {
    if (!getEditorVM()) setEditorVM(vm);
    return vm.dimodAnimations;
};
const animationPayload = (dragPayload, vm) => {
    const host = ready(vm);
    const target = vm.editingTarget;
    const sprite = target && target.sprite;
    const doc = host && sprite && animationsOf(sprite).find(d => d.id === dragPayload.dimodAnimId);
    if (!doc) return null;
    let thumbnail = '';
    try { thumbnail = renderThumbnail(host, host.recordOf(sprite, doc), target, 48).split(',')[1] || ''; } catch (e) { thumbnail = ''; }
    const json = new TextEncoder().encode(JSON.stringify(animFileObject(doc, target)));
    return {
        type: 'animation',
        mime: 'application/json',
        name: doc.name,
        body: arrayBufferToBase64(json.buffer),
        thumbnail: thumbnail || fallbackThumbnail()
    };
};
const addBackpackAnimation = async (vm, item, targetId) => {
    const host = ready(vm);
    const target = vm.runtime.getTargetById(targetId);
    if (!host || !target || target.isStage || !target.sprite) return null;
    const base64 = item.bodyUrl.slice(item.bodyUrl.indexOf(',') + 1);
    const obj = JSON.parse(new TextDecoder().decode(new Uint8Array(base64ToArrayBuffer(base64))));
    const doc = await animFromFileObject(obj, target);
    const list = animationsOf(target.sprite).slice();
    doc.id = makeAnimId();
    doc.name = uniqueName(item.name || doc.name, new Set(list.map(d => d.name)));
    host.setAnimations(target.sprite, list.concat(doc));
    vm.runtime.emitProjectChanged();
    return doc;
};
export {addBackpackAnimation, animationPayload as default};
