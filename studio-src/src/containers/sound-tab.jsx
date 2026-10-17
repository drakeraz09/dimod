import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import { defineMessages, intlShape, injectIntl } from 'react-intl';
import VM from 'scratch-vm';

import AssetPanel from '../components/asset-panel/asset-panel.jsx';
import soundIcon from '../components/asset-panel/icon--sound.svg';
import soundIconRtl from '../components/asset-panel/icon--sound-rtl.svg';
import addSoundFromLibraryIcon from '../components/asset-panel/icon--add-sound-lib.svg';
import addSoundFromRecordingIcon from '../components/asset-panel/icon--add-sound-record.svg';
import fileUploadIcon from '../components/action-menu/icon--file-upload.svg';
import surpriseIcon from '../components/action-menu/icon--surprise.svg';
import searchIcon from '../components/action-menu/icon--search.svg';

import RecordModal from './record-modal.jsx';
import SoundEditor from './sound-editor.jsx';
import SoundLibrary from './sound-library.jsx';
import SoundEditorNotSupported from '../components/tw-sound-editor-not-supported/sound-editor-not-supported.jsx';

import { getSoundLibrary } from '../lib/libraries/tw-async-libraries';
import { handleFileUpload, soundUpload } from '../lib/file-uploader.js';
import errorBoundaryHOC from '../lib/error-boundary-hoc.jsx';
import DragConstants from '../lib/drag-constants';
import downloadBlob from '../lib/download-blob';
import SharedAudioContext from '../lib/audio/shared-audio-context.js';
import {
    getRemoteEditedNames,
    clearRemoteEdited
} from '../lib/dimod-collab';
import { registerBulkSource, openSendMenu, bulkActionsFor, nextSelection, bulkDropGroup, assetView, realIndexAt } from '../lib/dimod-assets';

import { connect } from 'react-redux';

import {closeSoundLibrary, openSoundLibrary, openSoundRecorder} from '../reducers/modals';

import {activateTab, COSTUMES_TAB_INDEX} from '../reducers/editor-tab';

import { setRestore } from '../reducers/restore-deletion';
import { showStandardAlert, closeAlertWithId } from '../reducers/alerts';
import { takePendingSelect } from '../lib/dimod-editor';

const dimodConflictWrapperStyle = {
    position: 'relative', display: 'flex', flexGrow: 1, flexShrink: 1, minWidth: 0
};
const dimodConflictWarningStyle = {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    background: 'rgba(0, 0, 0, 0.6)', color: '#fff', fontSize: '0.75rem',
    padding: '.3rem .5rem', textAlign: 'center', pointerEvents: 'none'
};

class SoundTab extends React.Component {
    constructor(props) {
        super(props);
        bindAll(this, [
            'handleSelectSound',
            'handleDeleteSound',
            'handleDuplicateSound',
            'handleExportSound',
            'handleNewSound',
            'handleSurpriseSound',
            'handleFileUploadClick',
            'handleSoundUpload',
            'handleDrop',
            'setFileInput',
            'handleViewingUpdate',
            'handleRemoteEditMark',
            'handleBulkSelect',
            'handleBulkClear',
            'setBulkSelected',
            'getBulkList',
            'getBulkIndexes',
            'objsFor',
            'handleBulkMoved',
            'getTrackedSound',
            'handleSelectSoundEvent'
        ]);
        const wanted = takePendingSelect('sound', props.editingTarget);
        this.state = { selectedSoundIndex: wanted === null ? 0 : wanted, soundConflictUsers: [], bulkObjs: [], bulkAnchor: null };
    }
    componentDidMount () {
        this.unregisterBulk = registerBulkSource('sound', () => this.getBulkIndexes());
        window.addEventListener('dimod:select-sound', this.handleSelectSoundEvent);
        this.broadcastViewingSound();
        window.addEventListener('dimod:viewing-update', this.handleViewingUpdate);
        window.addEventListener('dimod:remote-asset-edit', this.handleRemoteEditMark);
        this.handleViewingUpdate();
    }
    handleRemoteEditMark() {
        this.forceUpdate();
    }
    handleSelectSoundEvent (e) {
        const {targetId, index} = e.detail || {};
        if (targetId !== this.props.editingTarget) return;
        this.setState({ selectedSoundIndex: index, bulkObjs: [], bulkAnchor: null });
    }
    componentDidUpdate (prevProps, prevState) {
        if (prevProps.editingTarget !== this.props.editingTarget ||
            prevState.selectedSoundIndex !== this.state.selectedSoundIndex) {
            this.broadcastViewingSound();
            this.handleViewingUpdate();
        }
    }
    componentWillUnmount () {
        if (this.unregisterBulk) this.unregisterBulk();
        window.removeEventListener('dimod:select-sound', this.handleSelectSoundEvent);
        this.broadcastViewingSound(true );
        window.removeEventListener('dimod:viewing-update', this.handleViewingUpdate);
        window.removeEventListener('dimod:remote-asset-edit', this.handleRemoteEditMark);
    }
    broadcastViewingSound (clear) {
        if (!window.dimodCollab) return;
        const target = this.props.vm.editingTarget;
        if (!target) return;
        window.dimodCollab.sendViewingUpdate({
            targetId: target.id,
            assetKind: clear ? null : 'sound',
            assetIndex: clear ? null : this.state.selectedSoundIndex
        });
    }
    handleViewingUpdate () {
        const target = this.props.vm.editingTarget;
        const viewers = window.dimodCollabViewers;
        if (!target || !viewers) return;
        const conflictUsers = Object.keys(viewers)
            .map(userId => viewers[userId])
            .filter(v => v.targetId === target.id &&
                v.assetKind === 'sound' &&
                v.assetIndex === this.state.selectedSoundIndex)
            .map(v => v.username);
        this.setState({soundConflictUsers: conflictUsers});
    }

    componentWillReceiveProps (nextProps) {
        const {
            editingTarget,
            sprites,
            stage
        } = nextProps;

        const target = editingTarget && sprites[editingTarget] ? sprites[editingTarget] : stage;
        if (!target || !target.sounds) {
            return;
        }

        // If switching editing targets, reset the sound index
        if (this.props.editingTarget !== editingTarget) {
            this.setState({ selectedSoundIndex: 0, bulkObjs: [], bulkAnchor: null });
        } else if (this.state.selectedSoundIndex > target.sounds.length - 1) {
            this.setState({ selectedSoundIndex: Math.max(target.sounds.length - 1, 0) });
        }
    }

    getBulkList() {
        const target = this.props.vm.editingTarget;
        return target ? target.sprite.sounds : [];
    }
    getBulkIndexes() {
        const set = new Set(this.state.bulkObjs);
        if (set.size === 0) return [];
        const out = [];
        this.getBulkList().forEach((o, i) => {
            if (set.has(o)) out.push(i);
        });
        return out;
    }
    objsFor(indexes) {
        const list = this.getBulkList();
        return indexes.map(i => list[i]).filter(Boolean);
    }
    handleBulkSelect(index, e) {
        const list = this.getBulkList();
        const current = this.getBulkIndexes();
        const base = current.length === 0 && !(e && e.dimodSelect) ? [this.state.selectedSoundIndex] : current;
        const anchorIndex = this.state.bulkAnchor && list.indexOf(this.state.bulkAnchor) !== -1 ?
            list.indexOf(this.state.bulkAnchor) : this.state.selectedSoundIndex;
        const next = nextSelection(base, anchorIndex, index, e);
        this.setState({ bulkObjs: this.objsFor(next.selected), bulkAnchor: list[next.anchor] || null });
    }
    handleBulkClear() {
        this.setState({ bulkObjs: [], bulkAnchor: null });
    }
    setBulkSelected(selected) {
        this.setState({ bulkObjs: this.objsFor(selected) });
    }
    getTrackedSound() {
        const target = this.props.vm.editingTarget;
        return target ? target.sprite.sounds[this.state.selectedSoundIndex] : null;
    }
    handleBulkMoved({ selected, tracked }) {
        this.setState({
            bulkObjs: this.objsFor(selected),
            selectedSoundIndex: tracked === -1 ? this.state.selectedSoundIndex : tracked
        });
    }
    handleSelectSound(soundIndex) {
        const picked = this.props.vm.editingTarget && this.props.vm.editingTarget.sprite.sounds[soundIndex];
        if (picked) clearRemoteEdited(this.props.vm.editingTarget.id, 'sound', picked.name);
        if (this.state.bulkObjs.length) this.setState({ bulkObjs: [], bulkAnchor: null });
        this.setState({ selectedSoundIndex: soundIndex });
    }

    handleDeleteSound(soundIndex) {
        const restoreFun = this.props.vm.deleteSound(soundIndex);
        if (soundIndex >= this.state.selectedSoundIndex) {
            this.setState({ selectedSoundIndex: Math.max(0, soundIndex - 1) });
        }
        this.props.dispatchUpdateRestore({ restoreFun, deletedItem: 'Sound' });
    }

    handleExportSound(soundIndex) {
        const item = this.props.vm.editingTarget.sprite.sounds[soundIndex];
        const blob = new Blob([item.asset.data], { type: item.asset.assetType.contentType });
        downloadBlob(`${item.name}.${item.asset.dataFormat}`, blob);
    }

    handleDuplicateSound(soundIndex) {
        this.props.vm.duplicateSound(soundIndex).then(() => {
            this.setState({ selectedSoundIndex: soundIndex + 1 });
        });
    }

    handleNewSound() {
        if (!this.props.vm.editingTarget) {
            return null;
        }
        const sprite = this.props.vm.editingTarget.sprite;
        const sounds = sprite.sounds ? sprite.sounds : [];
        this.setState({ selectedSoundIndex: Math.max(sounds.length - 1, 0) });
    }

    async handleSurpriseSound() {
        const soundLibraryContent = await getSoundLibrary();
        const soundItem = soundLibraryContent[Math.floor(Math.random() * soundLibraryContent.length)];
        const vmSound = {
            format: soundItem.dataFormat,
            md5: soundItem.md5ext,
            rate: soundItem.rate,
            sampleCount: soundItem.sampleCount,
            name: soundItem.name
        };
        if (soundItem.fromPenguinModLibrary) {
            vmSound.fromPenguinModLibrary = true;
            vmSound.libraryId = soundItem.libraryFilePage;
        }
        this.props.vm.addSound(vmSound).then(() => {
            this.handleNewSound();
        });
    }

    handleFileUploadClick() {
        this.fileInput.click();
    }

    handleSoundUpload(e) {
        const storage = this.props.vm.runtime.storage;
        const targetId = this.props.vm.editingTarget.id;
        this.props.onShowImporting();
        handleFileUpload(e.target, (buffer, fileType, fileName, fileIndex, fileCount) => {
            soundUpload(buffer, fileType, storage, newSound => {
                newSound.name = fileName;
                this.props.vm.addSound(newSound, targetId).then(() => {
                    this.handleNewSound();
                    if (fileIndex === fileCount - 1) {
                        this.props.onCloseImporting();
                    }
                });
            }, this.props.onCloseImporting);
        }, this.props.onCloseImporting);
    }

    handleDrop(dropInfo) {
        if (dropInfo.dragType === DragConstants.SOUND && this.getBulkIndexes().length > 1 &&
            this.getBulkIndexes().includes(realIndexAt(assetView(this.props.vm, 'sound'), dropInfo.index))) {
            this.handleBulkMoved(bulkDropGroup(this.props.vm, 'sound', this.getBulkIndexes(),
                dropInfo.index, dropInfo.newIndex, this.getTrackedSound()));
        } else if (dropInfo.dragType === DragConstants.SOUND) {
            const sprite = this.props.vm.editingTarget.sprite;
            const activeSound = sprite.sounds[this.state.selectedSoundIndex];

            this.props.vm.reorderSound(this.props.vm.editingTarget.id,
                dropInfo.index, dropInfo.newIndex);

            this.setState({ selectedSoundIndex: sprite.sounds.indexOf(activeSound) });
        } else if (dropInfo.dragType === DragConstants.BACKPACK_COSTUME) {
            this.props.onActivateCostumesTab();
            this.props.vm.addCostume(dropInfo.payload.body, {
                name: dropInfo.payload.name
            });
        } else if (dropInfo.dragType === DragConstants.BACKPACK_SOUND) {
            this.props.vm.addSound({
                md5: dropInfo.payload.body,
                name: dropInfo.payload.name
            }).then(this.handleNewSound);
        }
    }

    setFileInput(input) {
        this.fileInput = input;
    }

    render() {
        const {
            dispatchUpdateRestore, // eslint-disable-line no-unused-vars
            intl,
            isRtl,
            vm,
            onNewSoundFromLibraryClick,
            onNewSoundFromRecordingClick
        } = this.props;

        if (!vm.editingTarget) {
            return null;
        }

        const isSupported = !!(vm.runtime.audioEngine && new SharedAudioContext());

        const sprite = vm.editingTarget.sprite;

        const bulkIndexes = this.getBulkIndexes();
        const remoteNames = getRemoteEditedNames(vm.editingTarget.id, 'sound');
        const sounds = sprite.sounds ? sprite.sounds.map(sound => (
            {
                url: isRtl ? soundIconRtl : soundIcon,
                name: sound.name,
                details: (sound.sampleCount / sound.rate).toFixed(2),
                dragPayload: sound,
                remoteEdited: !!(remoteNames && remoteNames.has(sound.name))
            }
        )) : [];

        const messages = defineMessages({
            fileUploadSound: {
                defaultMessage: 'Upload Sound',
                description: 'Button to upload sound from file in the editor tab',
                id: 'gui.soundTab.fileUploadSound'
            },
            surpriseSound: {
                defaultMessage: 'Surprise',
                description: 'Button to get a random sound in the editor tab',
                id: 'gui.soundTab.surpriseSound'
            },
            recordSound: {
                defaultMessage: 'Record',
                description: 'Button to record a sound in the editor tab',
                id: 'gui.soundTab.recordSound'
            },
            addSound: {
                defaultMessage: 'Choose a Sound',
                description: 'Button to add a sound in the editor tab',
                id: 'gui.soundTab.addSoundFromLibrary'
            }
        });

        return (
            <AssetPanel
                dimodAssetKind="sound"
                buttons={isSupported ? [{
                    title: intl.formatMessage(messages.addSound),
                    img: addSoundFromLibraryIcon,
                    onClick: onNewSoundFromLibraryClick
                }, {
                    title: intl.formatMessage(messages.fileUploadSound),
                    img: fileUploadIcon,
                    onClick: this.handleFileUploadClick,
                    fileAccept: '.wav, .mp3, .ogg, .flac, .aac, .m4a',
                    fileChange: this.handleSoundUpload,
                    fileInput: this.setFileInput,
                    fileMultiple: true
                }, {
                    title: intl.formatMessage(messages.surpriseSound),
                    img: surpriseIcon,
                    onClick: this.handleSurpriseSound
                }, {
                    title: intl.formatMessage(messages.recordSound),
                    img: addSoundFromRecordingIcon,
                    onClick: onNewSoundFromRecordingClick
                }, {
                    title: intl.formatMessage(messages.addSound),
                    img: searchIcon,
                    onClick: onNewSoundFromLibraryClick
                }] : []}
                dragType={DragConstants.SOUND}
                isRtl={isRtl}
                items={sounds}
                selectedItemIndex={this.state.selectedSoundIndex}
                onDeleteClick={this.handleDeleteSound}
                onDrop={this.handleDrop}
                onDuplicateClick={this.handleDuplicateSound}
                onExportClick={this.handleExportSound}
                onItemClick={this.handleSelectSound}
                bulkSelected={bulkIndexes}
                onSendClick={(index, e) => {
                    const real = realIndexAt(assetView(vm, 'sound'), index);
                    openSendMenu(vm, 'sound', bulkIndexes.length > 1 && bulkIndexes.includes(real) ? bulkIndexes : [real], {x: e.clientX, y: e.clientY});
                }}
                bulkActions={bulkIndexes.length > 0 ? bulkActionsFor({
                    vm,
                    kind: 'sound',
                    selected: bulkIndexes,
                    count: sounds.length,
                    setSelected: this.setBulkSelected,
                    clear: this.handleBulkClear,
                    dispatchUpdateRestore: this.props.dispatchUpdateRestore,
                    downloadBlob,
                    onMoved: this.handleBulkMoved,
                    getTracked: this.getTrackedSound
                }) : null}
                onBulkSelect={this.handleBulkSelect}
                onBulkClear={this.handleBulkClear}
            >
                <div style={dimodConflictWrapperStyle}>
                    {sprite.sounds && sprite.sounds[this.state.selectedSoundIndex] ? (
                        isSupported ? (
                            <SoundEditor soundIndex={this.state.selectedSoundIndex} />
                        ) : (
                            <SoundEditorNotSupported />
                        )
                    ) : null}
                    {this.state.soundConflictUsers.length > 0 ? (
                        <div style={dimodConflictWarningStyle}>
                            {`${this.state.soundConflictUsers.join(', ')} ${
                                this.state.soundConflictUsers.length === 1 ? 'is' : 'are'} also editing this sound`}
                        </div>
                    ) : null}
                </div>
                {this.props.soundRecorderVisible ? (
                    <RecordModal
                        onNewSound={this.handleNewSound}
                    />
                ) : null}
                {this.props.soundLibraryVisible ? (
                    <SoundLibrary
                        vm={this.props.vm}
                        onNewSound={this.handleNewSound}
                        onRequestClose={this.props.onRequestCloseSoundLibrary}
                    />
                ) : null}
            </AssetPanel>
        );
    }
}

SoundTab.propTypes = {
    dispatchUpdateRestore: PropTypes.func,
    editingTarget: PropTypes.string,
    intl: intlShape,
    isRtl: PropTypes.bool,
    onActivateCostumesTab: PropTypes.func.isRequired,
    onCloseImporting: PropTypes.func.isRequired,
    onNewSoundFromLibraryClick: PropTypes.func.isRequired,
    onNewSoundFromRecordingClick: PropTypes.func.isRequired,
    onRequestCloseSoundLibrary: PropTypes.func.isRequired,
    onShowImporting: PropTypes.func.isRequired,
    soundLibraryVisible: PropTypes.bool,
    soundRecorderVisible: PropTypes.bool,
    sprites: PropTypes.shape({
        id: PropTypes.shape({
            sounds: PropTypes.arrayOf(PropTypes.shape({
                name: PropTypes.string.isRequired
            }))
        })
    }),
    stage: PropTypes.shape({
        sounds: PropTypes.arrayOf(PropTypes.shape({
            name: PropTypes.string.isRequired
        }))
    }),
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = state => ({
    editingTarget: state.scratchGui.targets.editingTarget,
    isRtl: state.locales.isRtl,
    sprites: state.scratchGui.targets.sprites,
    stage: state.scratchGui.targets.stage,
    soundLibraryVisible: state.scratchGui.modals.soundLibrary,
    soundRecorderVisible: state.scratchGui.modals.soundRecorder
});

const mapDispatchToProps = dispatch => ({
    onActivateCostumesTab: () => dispatch(activateTab(COSTUMES_TAB_INDEX)),
    onNewSoundFromLibraryClick: e => {
        e.preventDefault();
        dispatch(openSoundLibrary());
    },
    onNewSoundFromRecordingClick: () => {
        dispatch(openSoundRecorder());
    },
    onRequestCloseSoundLibrary: () => {
        dispatch(closeSoundLibrary());
    },
    dispatchUpdateRestore: restoreState => {
        dispatch(setRestore(restoreState));
    },
    onCloseImporting: () => dispatch(closeAlertWithId('importingAsset')),
    onShowImporting: () => dispatch(showStandardAlert('importingAsset'))
});

export default errorBoundaryHOC('Sound Tab')(
    injectIntl(connect(
        mapStateToProps,
        mapDispatchToProps
    )(SoundTab))
);
