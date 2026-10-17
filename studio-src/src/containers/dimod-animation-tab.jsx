import PropTypes from 'prop-types';
import React from 'react';
import bindAll from 'lodash.bindall';
import {connect} from 'react-redux';
import {openSettingsModal} from '../reducers/modals';
import VM from 'scratch-vm';
import AssetPanel from '../components/asset-panel/asset-panel.jsx';
import {AnimationEditor, AnimationDialogs} from '../components/dimod-animation-editor/animation-editor.jsx';
import DragConstants from '../lib/drag-constants';
import {setRestore} from '../reducers/restore-deletion';
import {askAlert} from '../lib/dimod-ui';
import {newAnim, normalizeAnim, serializeAnim, makeAnimId, uniqueName} from '../lib/dimod-animation/core';
import {animationsOf} from '../lib/dimod-animation/runtime';
import {renderThumbnail, setEditorVM, exportAnimFile, pickAndParse, animFromParsed} from '../lib/dimod-animation/editor';
import {bulkActionsFor, nextSelection, bulkDropGroup, assetView, realIndexAt} from '../lib/dimod-assets';
import downloadBlob from '../lib/download-blob';
import {addBackpackAnimation} from '../lib/backpack/animation-payload';
import addIcon from '../components/dimod-animation-editor/icon--add-animation.svg';
import fileUploadIcon from '../components/action-menu/icon--file-upload.svg';
import styles from '../components/dimod-animation-editor/animation-tab.css';
const THUMB_SIZE = 48;
class DimodAnimationTab extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleAnimationsChanged',
            'handleNew',
            'handleUpload',
            'handleItemClick',
            'handleDelete',
            'handleDuplicate',
            'handleExport',
            'handleDrop',
            'handleCommit',
            'handleBulkSelect',
            'handleBulkClear',
            'setBulkSelected',
            'getBulkList',
            'getBulkIndexes',
            'objsFor',
            'handleBulkMoved',
            'getTrackedAnimation'
        ]);
        this.selected = new WeakMap();
        this.thumbs = new WeakMap();
        this.thumbQueue = [];
        this.thumbRaf = 0;
        this.state = {version: 0, bulkObjs: [], bulkAnchor: null};
        setEditorVM(props.vm);
    }
    componentDidMount () {
        this.props.vm.runtime.on('DIMOD_ANIMATIONS_CHANGED', this.handleAnimationsChanged);
        this.props.vm.on('targetsUpdate', this.handleAnimationsChanged);
        window.dimodOpenProjectSettings = this.props.onOpenProjectSettings;
    }
    componentWillUnmount () {
        if (window.dimodOpenProjectSettings === this.props.onOpenProjectSettings) delete window.dimodOpenProjectSettings;
        this.props.vm.runtime.off('DIMOD_ANIMATIONS_CHANGED', this.handleAnimationsChanged);
        this.props.vm.off('targetsUpdate', this.handleAnimationsChanged);
        cancelAnimationFrame(this.thumbRaf);
    }
    handleAnimationsChanged () { this.setState(({version}) => ({version: version + 1})); }
    get host () { return this.props.vm.dimodAnimations; }
    get target () {
        const target = this.props.vm.runtime.getTargetById(this.props.editingTarget);
        return target && !target.isStage ? target : null;
    }
    get sprite () { return this.target ? this.target.sprite : null; }
    list () { return animationsOf(this.sprite); }
    selectedIndex () {
        const list = this.list();
        const id = this.sprite && this.selected.get(this.sprite);
        const i = list.findIndex(d => d.id === id);
        return i >= 0 ? i : Math.min(0, list.length - 1);
    }
    select (doc) {
        if (this.sprite && doc) this.selected.set(this.sprite, doc.id);
        this.handleAnimationsChanged();
    }
    setList (list) {
        const sprite = this.sprite;
        if (!sprite) return;
        this.host.setAnimations(sprite, list);
        this.props.vm.runtime.emitProjectChanged();
    }
    uniqueName (name, except = null) {
        const taken = this.list().filter(d => d !== except)
            .map(d => d.name);
        return uniqueName(String(name || 'animation').trim() || 'animation', new Set(taken));
    }
    handleNew () {
        const doc = newAnim({name: this.uniqueName('animation')});
        this.setList([...this.list(), doc]);
        this.select(doc);
    }
    async handleUpload () {
        try {
            const parsed = await pickAndParse();
            if (!parsed) return;
            const made = await animFromParsed(parsed, this.target);
            if (!made) return;
            const doc = normalizeAnim(made);
            doc.id = makeAnimId();
            doc.name = this.uniqueName(doc.name || 'animation');
            this.setList([...this.list(), doc]);
            this.select(doc);
        } catch (e) { askAlert(e.message || String(e), {title: 'Couldn\'t import that file'}); }
    }
    handleItemClick (index) {
        if (this.state.bulkObjs.length) this.setState({bulkObjs: [], bulkAnchor: null});
        this.select(this.list()[index]);
    }
    getBulkList () { return this.list(); }
    getBulkIndexes () {
        const set = new Set(this.state.bulkObjs);
        if (set.size === 0) return [];
        const out = [];
        this.getBulkList().forEach((o, i) => {
            if (set.has(o)) out.push(i);
        });
        return out;
    }
    objsFor (indexes) { const list = this.getBulkList(); return indexes.map(i => list[i]).filter(Boolean); }
    getTrackedAnimation () { return this.list()[this.selectedIndex()] || null; }
    handleBulkSelect (index, e) {
        const list = this.getBulkList();
        const current = this.getBulkIndexes();
        const base = current.length === 0 ? [this.selectedIndex()] : current;
        const anchorIndex = this.state.bulkAnchor && list.indexOf(this.state.bulkAnchor) !== -1 ?
            list.indexOf(this.state.bulkAnchor) : this.selectedIndex();
        const next = nextSelection(base, anchorIndex, index, e);
        this.setState({bulkObjs: this.objsFor(next.selected), bulkAnchor: list[next.anchor] || null});
    }
    handleBulkClear () { this.setState({bulkObjs: [], bulkAnchor: null}); }
    setBulkSelected (selected) { this.setState({bulkObjs: this.objsFor(selected)}); }
    handleBulkMoved ({selected, tracked}) {
        this.setState({bulkObjs: this.objsFor(selected)});
        if (tracked !== -1) {
            const doc = this.list()[tracked];
            if (doc) this.select(doc);
        }
    }
    handleDelete (index) {
        const before = this.list();
        const doc = before[index];
        if (!doc) return;
        const sprite = this.sprite;
        this.setList(before.filter(d => d !== doc));
        this.props.dispatchUpdateRestore({
            restoreFun: () => {
                const now = animationsOf(sprite).slice();
                now.splice(Math.min(index, now.length), 0, doc);
                this.host.setAnimations(sprite, now);
                this.props.vm.runtime.emitProjectChanged();
            },
            deletedItem: 'Animation'
        });
    }
    handleDuplicate (index) {
        const list = this.list();
        const doc = list[index];
        if (!doc) return;
        const copy = normalizeAnim(JSON.parse(serializeAnim(doc)));
        copy.id = makeAnimId();
        copy.name = this.uniqueName(doc.name);
        const next = list.slice();
        next.splice(index + 1, 0, copy);
        this.setList(next);
        this.select(copy);
    }
    handleExport (index) {
        const doc = this.list()[index];
        if (doc) exportAnimFile(doc, this.target);
    }
    handleDrop (dropInfo) {
        const vm = this.props.vm;
        if (dropInfo.dragType === DragConstants.BACKPACK_ANIMATION) {
            const target = this.target;
            if (!target) return;
            addBackpackAnimation(vm, dropInfo.payload, target.id)
                .then(doc => doc && this.select(doc))
                .catch(e => askAlert(`Couldn't add that animation: ${e.message || e}`));
            return;
        }
        if (dropInfo.dragType !== DragConstants.ANIMATION) return;
        const bulkIndexes = this.getBulkIndexes();
        const draggedReal = realIndexAt(assetView(vm, 'animation'), dropInfo.index);
        if (draggedReal === null) return;
        const indexes = bulkIndexes.length > 1 && bulkIndexes.includes(draggedReal) ? bulkIndexes : [draggedReal];
        this.handleBulkMoved(bulkDropGroup(vm, 'animation', indexes, dropInfo.index, dropInfo.newIndex,
            this.getTrackedAnimation()));
    }
    handleCommit (sprite, doc) {
        const list = animationsOf(sprite);
        const i = list.findIndex(d => d.id === doc.id);
        if (i < 0) return;
        const next = list.slice();
        doc.name = String(doc.name || '').trim() ? doc.name : list[i].name;
        if (doc.name !== list[i].name) {
            const taken = new Set(list.filter((d, j) => j !== i).map(d => d.name));
            doc.name = uniqueName(doc.name, taken);
        }
        next[i] = doc;
        this.host.setAnimations(sprite, next);
        this.props.vm.runtime.emitProjectChanged();
    }
    thumbFor (doc) {
        if (this.thumbs.has(doc)) return this.thumbs.get(doc);
        if (!this.thumbQueue.includes(doc)) this.thumbQueue.push(doc);
        if (!this.thumbRaf) this.thumbRaf = requestAnimationFrame(() => this.renderThumbs());
        return '';
    }
    renderThumbs () {
        this.thumbRaf = 0;
        const sprite = this.sprite;
        const target = this.target;
        let done = 0;
        while (this.thumbQueue.length && done < 3) {
            const doc = this.thumbQueue.shift();
            let url = '';
            try { url = renderThumbnail(this.host, this.host.recordOf(sprite, doc), target, THUMB_SIZE); } catch (e) { url = ''; }
            this.thumbs.set(doc, url);
            done++;
        }
        if (this.thumbQueue.length) this.thumbRaf = requestAnimationFrame(() => this.renderThumbs());
        if (done) this.handleAnimationsChanged();
    }
    renderPanel (items, buttons, index, doc) {
        const {vm} = this.props;
        const sprite = this.sprite;
        const bulkIndexes = this.getBulkIndexes();
        return (
            <AssetPanel
                buttons={buttons}
                collapsible
                dimodAssetKind="animation"
                dragType={DragConstants.ANIMATION}
                isRtl={this.props.isRtl}
                items={items}
                selectedItemIndex={index}
                onDeleteClick={this.handleDelete}
                onDrop={this.handleDrop}
                onDuplicateClick={this.handleDuplicate}
                onExportClick={this.handleExport}
                onItemClick={this.handleItemClick}
                bulkSelected={bulkIndexes.length > 1 ? bulkIndexes : []}
                bulkActions={bulkIndexes.length > 1 ? bulkActionsFor({
                    vm,
                    kind: 'animation',
                    selected: bulkIndexes,
                    count: items.length,
                    setSelected: this.setBulkSelected,
                    clear: this.handleBulkClear,
                    dispatchUpdateRestore: this.props.dispatchUpdateRestore,
                    downloadBlob,
                    onMoved: this.handleBulkMoved,
                    getTracked: this.getTrackedAnimation
                }) : null}
                onBulkSelect={this.handleBulkSelect}
                onBulkClear={this.handleBulkClear}
            >
                {doc ? (
                    <AnimationEditor
                        key={`${this.target.id}:${doc.id}`}
                        doc={doc}
                        host={this.host}
                        sprite={sprite}
                        target={this.target}
                        vm={vm}
                        onCommit={this.handleCommit}
                    />
                ) : (
                    <div className={styles.empty}>
                        <div className={styles.emptyTitle}>{'No animations yet'}</div>
                        <div>
                            {'Animate this sprite\'s costumes with keyframes, ' +
                                'then play them with the Animation blocks.'}
                        </div>
                        <button className={styles.emptyButton} onClick={this.handleNew}>
                            {'New Animation'}
                        </button>
                    </div>
                )}
            </AssetPanel>
        );
    }
    render () {
        const sprite = this.sprite;
        if (!sprite || !this.host) {
            return (
                <div className={styles.empty}>
                    {'Animations belong to sprites. Pick a sprite to see its animations.'}
                </div>
            );
        }
        const list = this.list();
        const index = this.selectedIndex();
        const doc = list[index] || null;
        const items = list.map(d => {
            const length = d.infinite ? 'endless' : `${Math.round(d.duration * 100) / 100}s`;
            const parts = `${d.groups.length} part${d.groups.length === 1 ? '' : 's'}`;
            return {name: d.name, url: this.thumbFor(d), details: `${length} · ${parts}`, dragPayload: {dimodAnimId: d.id}};
        });
        const buttons = [
            {title: 'New Animation', img: addIcon, onClick: this.handleNew},
            {title: 'Upload Animation', img: fileUploadIcon, onClick: this.handleUpload}
        ];
        return (
            <React.Fragment>
                <AnimationDialogs />
                {this.renderPanel(items, buttons, index, doc)}
            </React.Fragment>
        );
    }
}
DimodAnimationTab.propTypes = {
    dispatchUpdateRestore: PropTypes.func.isRequired,
    onOpenProjectSettings: PropTypes.func.isRequired,
    editingTarget: PropTypes.string,
    isRtl: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired
};
const mapStateToProps = state => ({editingTarget: state.scratchGui.targets.editingTarget, isRtl: state.locales.isRtl});
const mapDispatchToProps = dispatch => ({
    dispatchUpdateRestore: restoreState => dispatch(setRestore(restoreState)),
    onOpenProjectSettings: () => dispatch(openSettingsModal())
});
export default connect(mapStateToProps, mapDispatchToProps)(DimodAnimationTab);
