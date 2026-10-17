import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import SpriteSelectorItem from '../../containers/sprite-selector-item.jsx';
import Box from '../box/box.jsx';
import ActionMenu from '../action-menu/action-menu.jsx';
import SortableAsset from './sortable-asset.jsx';
import BulkBar from './bulk-bar.jsx';
import getCostumeUrl from '../../lib/get-costume-url';
import {groupOrder} from '../../lib/dimod-assets';
import SortableHOC from '../../lib/sortable-hoc.jsx';
import DragConstants from '../../lib/drag-constants';

import {handleListKey, LIST_PROPS} from '../../lib/dimod-ui';
import styles from './selector.css';

const Selector = props => {
    const {
        buttons,
        containerRef,
        dragType,
        isRtl,
        items,
        selectedItemIndex,
        draggingIndex,
        draggingType,
        ordering,
        onAddSortable,
        onRemoveSortable,
        onDeleteClick,
        onDuplicateClick,
        onExportClick,
        onItemClick,
        bulkSelected,
        bulkActions,
        onBulkSelect,
        onBulkClear
    } = props;
    const [selectMode, setSelectMode] = React.useState(false);
    const toggleSelectMode = () => {
        if (selectMode && onBulkClear) onBulkClear();
        setSelectMode(!selectMode);
    };
    const minCount = selectMode ? 1 : 2;
    const bulkSet = (selectMode || (bulkSelected || []).length > 1) ? (bulkSelected || []) : [];
    const realOf = (item, pos) => (item && typeof item.name === 'object' ?
        (typeof item.name.realIndex === 'number' ? item.name.realIndex : null) : pos);
    const bulkPos = bulkSet.map(r => items.findIndex((it, j) => realOf(it, j) === r)).filter(j => j !== -1);
    const captureBulkDown = onBulkSelect ? e => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.stopPropagation();
            e.preventDefault();
        }
    } : undefined;
    const captureBulk = index => (onBulkSelect && index !== null ? e => {
        if (selectMode) {
            e.stopPropagation();
            e.preventDefault();
            onBulkSelect(index, {ctrlKey: true, dimodSelect: true});
        } else if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.stopPropagation();
            e.preventDefault();
            onBulkSelect(index, e);
        }
    } : undefined);

    const isRelevantDrag = draggingType === dragType;
    const groupDrag = isRelevantDrag && bulkSet.length > 1 && bulkPos.includes(draggingIndex);
    let shownOrdering = ordering;
    if (groupDrag && props.mouseOverIndex !== null && props.mouseOverIndex !== undefined) {
        shownOrdering = groupOrder(items.length, bulkPos, draggingIndex, props.mouseOverIndex);
    }
    const shownPos = i => (isRelevantDrag ? shownOrdering.indexOf(i) : i);
    const stackImgs = bulkPos.length > 1 ?
        bulkPos.map(i => items[i] && (items[i].url || (items[i].asset && getCostumeUrl(items[i].asset)))).filter(Boolean) :
        null;

    const groupStyle = index => {
        const on = bulkPos.includes(index);
        const top = on && !bulkPos.includes(index - 1);
        const bottom = on && !bulkPos.includes(index + 1);
        const edge = (x, y) => `inset ${x}px ${y}px 0 0 #ff8c1a`;
        return {
            boxShadow: on ? [edge(3, 0), edge(-3, 0), top ? edge(0, 3) : null, bottom ? edge(0, -3) : null]
                .filter(Boolean).join(', ') : 'none',
            borderRadius: `${top ? 8 : 0}px ${top ? 8 : 0}px ${bottom ? 8 : 0}px ${bottom ? 8 : 0}px`,
            transition: 'box-shadow .16s ease, background-color .16s ease',
            backgroundColor: on ? 'rgba(255,140,26,0.12)' : 'transparent',
        };
    };

    const selectButton = onBulkSelect ? (
        <button
            className={classNames(styles.selectButton, {[styles.selectButtonOn]: selectMode})}
            title={selectMode ? 'Done selecting' : 'Select several'}
            onClick={toggleSelectMode}
        >
            <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#000"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <rect
                    height="16"
                    rx="3"
                    width="16"
                    x="4"
                    y="4"
                />
                <path d="M8.5 12.2l2.5 2.6 4.8-5.4" />
            </svg>
        </button>
    ) : null;
    let newButtonSection = null;

    if (buttons.length > 0 || selectButton) {
        const {img, title, onClick} = buttons[0] || {};
        const moreButtons = buttons.slice(1);
        newButtonSection = (
            <Box className={styles.newButtons}>
                {buttons.length > 0 ? (
                    <ActionMenu
                        img={img}
                        moreButtons={moreButtons}
                        title={title}
                        tooltipPlace={isRtl ? 'left' : 'right'}
                        onClick={onClick}
                    />
                ) : null}
                {selectButton}
            </Box>
        );
    }

    const handleKeyDown = e => {
        const list = e.currentTarget;
        handleListKey(e, items.length, selectedItemIndex, onItemClick,
            i => list.querySelector(`[data-dimod-asset-index="${i}"]`));
    };
    return (
        <Box
            className={styles.wrapper}
            componentRef={containerRef}
        >
            <Box
                className={styles.listArea}
                tabIndex={0}
                onKeyDown={handleKeyDown}
                {...LIST_PROPS}
            >
                {items.map((item, index) => (
                    <SortableAsset
                        id={item.name}
                        index={isRelevantDrag ? shownOrdering.indexOf(index) : index}
                        key={item.name}
                        onAddSortable={onAddSortable}
                        onRemoveSortable={onRemoveSortable}
                        onClickCapture={captureBulk(realOf(item, index))}
                        onMouseDownCapture={captureBulkDown}
                        style={groupStyle(index).wrapper}
                    >
                        <span style={groupStyle(index).ring} />
                        <span
                            style={{
                                position: 'absolute', top: 5, right: 5, width: 18, height: 18, zIndex: 6,
                                borderRadius: '50%', background: '#ff8c1a', color: '#fff', fontSize: 11,
                                lineHeight: '18px', textAlign: 'center', pointerEvents: 'none',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                                transform: bulkPos.includes(index) || selectMode ? 'scale(1)' : 'scale(0)',
                                opacity: bulkPos.includes(index) || selectMode ? 1 : 0,
                                background: bulkPos.includes(index) ? '#ff8c1a' : 'rgba(128,128,128,0.55)',
                                transition: 'transform .18s cubic-bezier(.3,1.6,.5,1), opacity .12s'
                            }}
                        >{bulkPos.includes(index) ? '✓' : ''}</span>
                        {item.remoteEdited && index !== selectedItemIndex ? (
                            <span
                                title="A collaborator changed this"
                                style={{
                                    position: 'absolute', top: 6, left: 6, width: 10, height: 10, zIndex: 5,
                                    borderRadius: '50%', background: '#2ecc71', border: '2px solid #fff',
                                    pointerEvents: 'none'
                                }}
                            />
                        ) : null}
                        <SpriteSelectorItem
                            asset={item.asset}
                            className={classNames(styles.listItem, {
                                [styles.placeholder]: isRelevantDrag && (index === draggingIndex || (groupDrag && bulkPos.includes(index)))
                            })}
                            costumeURL={item.url}
                            details={item.details}
                            dragPayload={item.dragPayload}
                            dragImgs={bulkSet.length > 1 && bulkPos.includes(index) ? stackImgs : null}
                            dragType={dragType}
                            id={index}
                            index={index}
                            name={item.name}
                            number={index + 1 /* 1-indexed */}
                            selected={index === selectedItemIndex || bulkPos.includes(index)}
                            onClick={onItemClick}
                            onDeleteButtonClick={onDeleteClick}
                            onDuplicateButtonClick={onDuplicateClick}
                            onExportButtonClick={onExportClick}
                            onRenameButtonClick={props.onRenameClick}
                            onSendButtonClick={props.onSendClick}
                        />
                    </SortableAsset>
                ))}
            </Box>
            <BulkBar
                count={bulkSet.length}
                minCount={minCount}
                actions={bulkSet.length >= minCount ? bulkActions : null}
                onClear={onBulkClear}
                hidden={isRelevantDrag}
            />
            {newButtonSection}
        </Box>
    );
};

Selector.propTypes = {
    bulkActions: PropTypes.arrayOf(PropTypes.shape({
        label: PropTypes.string.isRequired,
        onClick: PropTypes.func.isRequired,
        danger: PropTypes.bool,
        title: PropTypes.string
    })),
    bulkSelected: PropTypes.arrayOf(PropTypes.number),
    onBulkClear: PropTypes.func,
    onBulkSelect: PropTypes.func,
    buttons: PropTypes.arrayOf(PropTypes.shape({
        title: PropTypes.string.isRequired,
        img: PropTypes.string.isRequired,
        onClick: PropTypes.func
    })),
    containerRef: PropTypes.func,
    dragType: PropTypes.oneOf(Object.keys(DragConstants)),
    draggingIndex: PropTypes.number,
    draggingType: PropTypes.oneOf(Object.keys(DragConstants)),
    isRtl: PropTypes.bool,
    items: PropTypes.arrayOf(PropTypes.shape({
        url: PropTypes.string,
        // eslint-disable-next-line react/forbid-prop-types
        name: PropTypes.any
    })),
    onAddSortable: PropTypes.func,
    onDeleteClick: PropTypes.func,
    onDuplicateClick: PropTypes.func,
    onExportClick: PropTypes.func,
    onItemClick: PropTypes.func.isRequired,
    onRemoveSortable: PropTypes.func,
    onRenameClick: PropTypes.func,
    onSendClick: PropTypes.func,
    ordering: PropTypes.arrayOf(PropTypes.number),
    selectedItemIndex: PropTypes.number.isRequired
};

export default SortableHOC(Selector);
