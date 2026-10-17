import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import VM from 'scratch-vm';
import PaintEditor, {flushPaint, setPaintFlushHost, setSymbolSource} from '../lib/tw-scratch-paint';
import {DimodFullscreenButton} from '../components/dimod-fullscreen/dimod-fullscreen.jsx';

const FULLSCREEN_BUTTON = <DimodFullscreenButton />;
import {inlineSvgFonts} from 'scratch-svg-renderer';
import ErrorBoundaryHOC from '../lib/error-boundary-hoc.jsx';
import {openFontsModal} from '../reducers/modals';
import {
    flushCostumeBroadcast,
    handleRemotePaintPacket,
    installPaintCollab,
    isApplyingRemotePaint,
    remotely,
    uninstallPaintCollab
} from '../lib/dimod-collab';

import {runAsRemote} from '../lib/dimod-project';

import {connect} from 'react-redux';

let flushPendingImage = null;
const flushBeforeTargetSwitch = vm => {
    if (vm.__dimodFlushPaintOnSwitch) return;
    vm.__dimodFlushPaintOnSwitch = true;
    const original = vm.setEditingTarget.bind(vm);
    vm.setEditingTarget = (...args) => {
        flushPaint();
        return original(...args);
    };
};

class PaintEditorWrapper extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleUpdateImage',
            'flushImage',
            'handleUpdateName',
            'handleUpdateFonts',
            'handleRemoteCostumeUpdated',
            'attachCollabListener',
            'handleRemotePaint'
        ]);
        this.state = {
            fonts: this.props.vm.runtime.fontManager.getFonts()
        };
    }
    componentDidMount() {
        this.shownCostumeIndex = this.props.selectedCostumeIndex;
        this.props.vm.runtime.fontManager.on('change', this.handleUpdateFonts);
        window.addEventListener('dimod:costume-updated', this.handleRemoteCostumeUpdated);
        this.attachCollabListener();
        this.syncPaintCollab();
        const {vm} = this.props;
        const refsCache = new Map();
        const assetCache = new Map();
        const refsOf = costume => {
            if (costume.dataFormat !== 'svg' || !costume.asset) return [];
            if (!refsCache.has(costume.assetId)) {
                const found = [];
                const text = costume.asset.decodeText();
                const pattern = /data-dimod-symbol="([^"]*)"/g;
                let match = pattern.exec(text);
                while (match) {
                    try {
                        found.push(JSON.parse(match[1].replace(/&quot;/g, '"')));
                    } catch (e) {
                    }
                    match = pattern.exec(text);
                }
                refsCache.set(costume.assetId, found);
            }
            return refsCache.get(costume.assetId);
        };
        const costumeOf = (id, name) => {
            const target = vm.runtime.getTargetById(id);
            return target && target.sprite.costumes.find(c => c.name === name);
        };
        const blocked = (id, name) => {
            const editing = vm.editingTarget;
            const self = editing && editing.sprite.costumes[this.props.selectedCostumeIndex];
            if (!self) return false;
            const seen = new Set();
            const visit = (spriteId, costumeName) => {
                if (spriteId === editing.id && costumeName === self.name) return true;
                const key = `${spriteId}/${costumeName}`;
                if (seen.has(key)) return false;
                seen.add(key);
                const costume = costumeOf(spriteId, costumeName);
                return Boolean(costume) && refsOf(costume).some(ref => visit(ref.sprite, ref.costume));
            };
            return visit(id, name);
        };
        setSymbolSource({
            list: () => vm.runtime.targets.filter(target => target.isOriginal).map(target => ({
                id: target.id,
                name: target.isStage ? 'Stage' : target.sprite.name,
                current: target === vm.editingTarget,
                costumes: target.sprite.costumes.map(costume => ({name: costume.name, assetId: costume.assetId, blocked: blocked(target.id, costume.name)}))
            })),
            get: (id, name) => {
                const costume = costumeOf(id, name);
                if (!costume || !costume.asset || !vm.renderer || blocked(id, name)) return null;
                const size = vm.renderer.getSkinSize(costume.skinId);
                const vector = costume.dataFormat === 'svg';
                if (!assetCache.has(costume.assetId)) {
                    assetCache.set(costume.assetId, {url: costume.asset.encodeDataURI(), svg: vector ? costume.asset.decodeText() : null});
                }
                return Object.assign({costume: name, assetId: costume.assetId, width: size[0], height: size[1],
                    rotationCenter: [costume.rotationCenterX, costume.rotationCenterY]}, assetCache.get(costume.assetId));
            }
        });
    }
    shouldComponentUpdate(nextProps, nextState) {
        return this.props.imageId !== nextProps.imageId ||
            this.props.rtl !== nextProps.rtl ||
            this.props.name !== nextProps.name ||
            this.props.isDark !== nextProps.isDark ||
            this.props.customStageSize !== nextProps.customStageSize ||
            this.state.fonts !== nextState.fonts;
    }
    componentDidUpdate() {
        this.shownCostumeIndex = this.props.selectedCostumeIndex;
        this.syncPaintCollab();
    }
    componentWillUnmount() {
        flushPaint();
        this.flushImage();
        if (flushPendingImage === this.flushImage) flushPendingImage = null;
        setPaintFlushHost(null);
        flushCostumeBroadcast();
        this.props.vm.runtime.fontManager.off('change', this.handleUpdateFonts);
        window.removeEventListener('dimod:costume-updated', this.handleRemoteCostumeUpdated);
        window.removeEventListener('dimod:collab-ready', this.attachCollabListener);
        if (window.dimodCollab && window.dimodCollab.onPaintUpdate === this.handleRemotePaint) {
            window.dimodCollab.onPaintUpdate = null;
        }
        uninstallPaintCollab();
    }
    attachCollabListener() {
        if (window.dimodCollab) {
            window.dimodCollab.onPaintUpdate = this.handleRemotePaint;
            return;
        }
        window.addEventListener('dimod:collab-ready', this.attachCollabListener, {once: true});
    }
    syncPaintCollab() {
        const target = this.props.vm.editingTarget;
        if (!target) return;
        installPaintCollab({targetId: target.id, costumeIndex: this.props.selectedCostumeIndex});
    }
    handleRemotePaint(payload, fromUserId) {
        runAsRemote(() => handleRemotePaintPacket(payload, fromUserId));
    }
    handleRemoteCostumeUpdated (e) {
        const target = this.props.vm.editingTarget;
        if (!target || target.id !== e.detail.targetId) return;
        if (this.props.selectedCostumeIndex !== e.detail.index) return;
        this.forceUpdate();
    }
    handleUpdateFonts() {
        this.setState({
            fonts: this.props.vm.runtime.fontManager.getFonts()
        });
    }
    handleUpdateName (name) {
        this.props.vm.renameCostume(this.props.selectedCostumeIndex, name);
    }
    handleUpdateImage (isVector, image, rotationCenterX, rotationCenterY) {
        flushBeforeTargetSwitch(this.props.vm);
        flushPendingImage = this.flushImage;
        setPaintFlushHost(this.flushImage);
        const remote = isApplyingRemotePaint();
        if (this._pendingImage && this._pendingImage.remote !== remote) this.flushImage();
        this._pendingImage = {
            isVector, image, rotationCenterX, rotationCenterY, remote,
            costumeIndex: this.shownCostumeIndex === undefined ?
                this.props.selectedCostumeIndex : this.shownCostumeIndex,
            targetId: this.props.vm.editingTarget && this.props.vm.editingTarget.id
        };
        const now = performance.now();
        if (!this._pendingSince) this._pendingSince = now;
        clearTimeout(this._pendingFrame);
        this._pendingFrame = setTimeout(() => {
            this._pendingFrame = null;
            this.flushImage();
        }, Math.max(0, Math.min(120, 500 - (now - this._pendingSince))));
    }
    flushImage () {
        if (this._pendingFrame) {
            clearTimeout(this._pendingFrame);
            this._pendingFrame = null;
        }
        this._pendingSince = 0;
        const pending = this._pendingImage;
        this._pendingImage = null;
        if (!pending) return;
        const target = this.props.vm.editingTarget;
        if (!target || target.id !== pending.targetId) return;
        this.applyImage(pending);
    }
    applyImage (pending) {
        if (pending.remote) return remotely(() => this.applyImage({...pending, remote: false}));
        const {isVector, image, rotationCenterX, rotationCenterY, costumeIndex} = pending;
        if (isVector) {
            this.props.vm.updateSvg(
                costumeIndex,
                image,
                rotationCenterX,
                rotationCenterY);
        } else {
            this.props.vm.updateBitmap(
                costumeIndex,
                image,
                rotationCenterX,
                rotationCenterY,
                2 /* bitmapResolution */);
        }
    }
    render () {
        if (!this.props.imageId) return null;
        const {
            selectedCostumeIndex,
            vm,
            ...componentProps
        } = this.props;

        return (
            <PaintEditor
                extraViewControls={FULLSCREEN_BUTTON}
                {...componentProps}
                image={vm.getCostume(selectedCostumeIndex)}
                spriteId={vm.editingTarget ? vm.editingTarget.id : null}
                onUpdateImage={this.handleUpdateImage}
                onUpdateName={this.handleUpdateName}
                fontInlineFn={inlineSvgFonts}
                theme={this.props.isDark ? 'dark' : 'light'}
                customFonts={this.state.fonts}
                width={this.props.customStageSize.width}
                height={this.props.customStageSize.height}
            />
        );
    }
}

PaintEditorWrapper.propTypes = {
    customStageSize: PropTypes.shape({
        width: PropTypes.width,
        height: PropTypes.number
    }),
    onManageFonts: PropTypes.func.isRequired,
    imageFormat: PropTypes.string.isRequired,
    imageId: PropTypes.string.isRequired,
    isDark: PropTypes.bool,
    name: PropTypes.string,
    rotationCenterX: PropTypes.number,
    rotationCenterY: PropTypes.number,
    rtl: PropTypes.bool,
    selectedCostumeIndex: PropTypes.number.isRequired,
    vm: PropTypes.instanceOf(VM)
};

const mapStateToProps = (state, {selectedCostumeIndex}) => {
    const targetId = state.scratchGui.vm.editingTarget.id;
    const sprite = state.scratchGui.vm.editingTarget.sprite;
    // Make sure the costume index doesn't go out of range.
    const index = selectedCostumeIndex < sprite.costumes.length ?
        selectedCostumeIndex : sprite.costumes.length - 1;
    const costume = state.scratchGui.vm.editingTarget.sprite.costumes[index];
    return {
        customStageSize: state.scratchGui.customStageSize,
        name: costume && costume.name,
        rotationCenterX: costume && costume.rotationCenterX,
        rotationCenterY: costume && costume.rotationCenterY,
        imageFormat: costume && costume.dataFormat,
        imageId: targetId && `${targetId}${costume.skinId}`,
        rtl: state.locales.isRtl,
        selectedCostumeIndex: index,
        vm: state.scratchGui.vm,
        zoomLevelId: targetId
    };
};

const mapDispatchToProps = dispatch => ({
    onManageFonts: () => dispatch(openFontsModal())
});

export default ErrorBoundaryHOC('paint', {recover: true, label: 'Costume editor'})(connect(
    mapStateToProps,
    mapDispatchToProps
)(PaintEditorWrapper));
