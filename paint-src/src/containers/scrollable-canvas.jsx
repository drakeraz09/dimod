import paper from '@turbowarp/paper';
import PropTypes from 'prop-types';

import React from 'react';
import {connect} from 'react-redux';
import ScrollableCanvasComponent from '../components/scrollable-canvas/scrollable-canvas.jsx';

import {clampViewBounds, pan, zoomOnFixedPoint, getWorkspaceBounds} from '../helper/view';
import {updateViewBounds} from '../reducers/view-bounds';
import {redrawSelectionBox} from '../reducers/selected-items';

import {getEventXY} from '../lib/touch-utils';
import {hasCommand, runCommand} from '../dimod/core';
import {getSelectedRootItems} from '../helper/selection';
import bindAll from 'lodash.bindall';
import {LIVETEST} from '../lib/dimod-flags';
import {panFromDrag} from '../helper/tools/dimod-tools';
import {isPaintSuspended} from '../lib/dimod-flags';

class ScrollableCanvas extends React.Component {
    static get ZOOM_INCREMENT () {
        return 0.5;
    }
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleMouseDown',
            'handleDragMove',
            'handleDragEnd',
            'handleHorizontalScrollbarMouseDown',
            'handleHorizontalScrollbarMouseMove',
            'handleHorizontalScrollbarMouseUp',
            'handleVerticalScrollbarMouseDown',
            'handleVerticalScrollbarMouseMove',
            'handleVerticalScrollbarMouseUp',
            'handleWheel',
            'handleGesture',
            'handleSpaceDown',
            'handleSpaceUp',
            'handleSpacePanStart',
            'handleSpacePanMove',
            'handleSpacePanEnd'
        ]);
    }
    componentDidMount () {
        if (LIVETEST) {
            document.addEventListener('keydown', this.handleSpaceDown);
            document.addEventListener('keyup', this.handleSpaceUp);
            window.addEventListener('blur', this.handleSpaceUp);
            window.addEventListener('pointerdown', this.handleSpacePanStart, true);
            window.addEventListener('mousedown', this.handleSpacePanStart, true);
        }
        if (this.props.canvas) {
            this.props.canvas.addEventListener('wheel', this.handleWheel);
            this.props.canvas.addEventListener('gesturestart', this.handleGesture);
            this.props.canvas.addEventListener('gesturechange', this.handleGesture);
            this.props.canvas.addEventListener('mousedown', this.handleMouseDown);
        }
    }
    componentWillReceiveProps (nextProps) {
        if (nextProps.canvas) {
            if (this.props.canvas) {
                this.props.canvas.removeEventListener('wheel', this.handleWheel);
                this.props.canvas.removeEventListener('gesturestart', this.handleGesture);
                this.props.canvas.removeEventListener('gesturechange', this.handleGesture);
                this.props.canvas.removeEventListener('mousedown', this.handleMouseDown);
            }
            nextProps.canvas.addEventListener('wheel', this.handleWheel);
            nextProps.canvas.addEventListener('gesturestart', this.handleGesture);
            nextProps.canvas.addEventListener('gesturechange', this.handleGesture);
            nextProps.canvas.addEventListener('mousedown', this.handleMouseDown);
        }
    }
    componentWillUnmount () {
        if (LIVETEST) {
            document.removeEventListener('keydown', this.handleSpaceDown);
            document.removeEventListener('keyup', this.handleSpaceUp);
            window.removeEventListener('blur', this.handleSpaceUp);
            window.removeEventListener('pointerdown', this.handleSpacePanStart, true);
            window.removeEventListener('mousedown', this.handleSpacePanStart, true);
            window.removeEventListener('pointermove', this.handleSpacePanMove, true);
            window.removeEventListener('pointerup', this.handleSpacePanEnd, true);
        }
    }
    handleSpaceDown (event) {
        if (event.code !== 'Space' || isPaintSuspended()) return;
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
            (target && target.isContentEditable)) return;
        const canvas = this.props.canvas;
        if (!canvas || !canvas.matches(':hover')) return;
        event.preventDefault();
        if (this.spaceHeld) return;
        this.spaceHeld = true;
        this.cursorBeforeSpace = canvas.style.cursor;
        canvas.style.cursor = 'grab';
    }
    handleSpaceUp (event) {
        if (event && event.type === 'keyup' && event.code !== 'Space') return;
        if (!this.spaceHeld) return;
        this.spaceHeld = false;
        if (!this.spacePan && this.props.canvas) this.props.canvas.style.cursor = this.cursorBeforeSpace || '';
    }
    handleSpacePanStart (event) {
        if (!this.spaceHeld || event.button !== 0 || event.target !== this.props.canvas) return;
        event.preventDefault();
        event.stopPropagation();
        if (this.spacePan) return;
        this.spacePan = {
            x: event.clientX,
            y: event.clientY,
            tx: paper.view.matrix.tx,
            ty: paper.view.matrix.ty
        };
        this.props.canvas.style.cursor = 'grabbing';
        window.addEventListener('pointermove', this.handleSpacePanMove, true);
        window.addEventListener('pointerup', this.handleSpacePanEnd, true);
    }
    handleSpacePanMove (event) {
        if (!this.spacePan) return;
        event.preventDefault();
        event.stopPropagation();
        panFromDrag(this.spacePan, event.clientX, event.clientY);
        this.props.updateViewBounds(paper.view.matrix);
    }
    handleSpacePanEnd (event) {
        if (event) event.stopPropagation();
        setTimeout(() => {
            this.spacePan = null;
        }, 0);
        window.removeEventListener('pointermove', this.handleSpacePanMove, true);
        window.removeEventListener('pointerup', this.handleSpacePanEnd, true);
        if (this.props.canvas) {
            this.props.canvas.style.cursor = this.spaceHeld ? 'grab' : (this.cursorBeforeSpace || '');
        }
    }
    handleMouseDown (event) {
        if (event.button === 1) {
            event.preventDefault();
            const {x, y} = getEventXY(event);
            this.initialMouseX = x;
            this.initialMouseY = y;
            this.initialScreenX = paper.view.matrix.tx;
            this.initialScreenY = paper.view.matrix.ty;
            this.initialCursor = this.props.canvas.style.cursor;
            this.props.canvas.style.cursor = 'move';
            window.addEventListener('mousemove', this.handleDragMove);
            window.addEventListener('mouseup', this.handleDragEnd);
        }
    }
    handleDragMove (event) {
        event.preventDefault();
        const {x, y} = getEventXY(event);
        paper.view.matrix.ty = this.initialScreenY - (this.initialMouseY - y);
        paper.view.matrix.tx = this.initialScreenX - (this.initialMouseX - x);
        clampViewBounds();
        this.props.updateViewBounds(paper.view.matrix);
        if (this.props.canvas) {
            this.props.canvas.style.cursor = 'move';
        }
    }
    handleDragEnd (event) {
        event.preventDefault();
        window.removeEventListener('mousemove', this.handleDragMove);
        window.removeEventListener('mouseup', this.handleDragEnd);
        if (this.props.canvas) {
            this.props.canvas.style.cursor = this.initialCursor;
        }
    }
    handleHorizontalScrollbarMouseDown (event) {
        this.initialMouseX = getEventXY(event).x;
        this.initialScreenX = paper.view.matrix.tx;
        window.addEventListener('mousemove', this.handleHorizontalScrollbarMouseMove);
        window.addEventListener('touchmove', this.handleHorizontalScrollbarMouseMove, {passive: false});
        window.addEventListener('mouseup', this.handleHorizontalScrollbarMouseUp);
        window.addEventListener('touchend', this.handleHorizontalScrollbarMouseUp);
        event.preventDefault();
    }
    handleHorizontalScrollbarMouseMove (event) {
        const dx = this.initialMouseX - getEventXY(event).x;
        paper.view.matrix.tx = this.initialScreenX + (dx * paper.view.zoom * 2);
        clampViewBounds();
        this.props.updateViewBounds(paper.view.matrix);
        event.preventDefault();
    }
    handleHorizontalScrollbarMouseUp () {
        window.removeEventListener('mousemove', this.handleHorizontalScrollbarMouseMove);
        window.removeEventListener('touchmove', this.handleHorizontalScrollbarMouseMove, {passive: false});
        window.removeEventListener('mouseup', this.handleHorizontalScrollbarMouseUp);
        window.removeEventListener('touchend', this.handleHorizontalScrollbarMouseUp);
        this.initialMouseX = null;
        this.initialScreenX = null;
        event.preventDefault();
    }
    handleVerticalScrollbarMouseDown (event) {
        this.initialMouseY = getEventXY(event).y;
        this.initialScreenY = paper.view.matrix.ty;
        window.addEventListener('mousemove', this.handleVerticalScrollbarMouseMove);
        window.addEventListener('touchmove', this.handleVerticalScrollbarMouseMove, {passive: false});
        window.addEventListener('mouseup', this.handleVerticalScrollbarMouseUp);
        window.addEventListener('touchend', this.handleVerticalScrollbarMouseUp);
        event.preventDefault();
    }
    handleVerticalScrollbarMouseMove (event) {
        const dy = this.initialMouseY - getEventXY(event).y;
        paper.view.matrix.ty = this.initialScreenY + (dy * paper.view.zoom * 2);
        clampViewBounds();
        this.props.updateViewBounds(paper.view.matrix);
        event.preventDefault();
    }
    handleVerticalScrollbarMouseUp (event) {
        window.removeEventListener('mousemove', this.handleVerticalScrollbarMouseMove);
        window.removeEventListener('touchmove', this.handleVerticalScrollbarMouseMove, {passive: false});
        window.removeEventListener('mouseup', this.handleVerticalScrollbarMouseUp);
        window.removeEventListener('touchend', this.handleVerticalScrollbarMouseUp);
        this.initialMouseY = null;
        this.initialScreenY = null;
        event.preventDefault();
    }
    handleGesture (event) {
        event.preventDefault();
        if (event.type === 'gesturestart') {
            this.gestureAngle = 0;
            return;
        }
        if (!hasCommand('rotate') || getSelectedRootItems().length === 0) return;
        const whole = Math.trunc(event.rotation - this.gestureAngle);
        if (!whole) return;
        this.gestureAngle += whole;
        runCommand('rotate', whole, true);
    }
    handleWheel (event) {
        // Multiplier variable, so that non-pixel-deltaModes are supported. Needed for Firefox.
        // See #529 (or LLK/scratch-blocks#1190).
        const multiplier = event.deltaMode === 0x1 ? 15 : 1;
        const deltaX = event.deltaX * multiplier;
        const deltaY = event.deltaY * multiplier;
        const canvasRect = this.props.canvas.getBoundingClientRect();
        const offsetX = event.clientX - canvasRect.left;
        const offsetY = event.clientY - canvasRect.top;
        const fixedPoint = paper.view.viewToProject(
            new paper.Point(offsetX, offsetY)
        );
        if (event.altKey && hasCommand('rotate') && getSelectedRootItems().length > 0) {
            const delta = Math.abs(deltaY) > Math.abs(deltaX) ? deltaY : deltaX;
            this.wheelTurn = (this.wheelTurn || 0) + (delta / 8);
            const whole = Math.trunc(this.wheelTurn);
            this.wheelTurn -= whole;
            if (whole) runCommand('rotate', whole, true);
        } else if (event.metaKey || event.ctrlKey) {
            // Zoom keeping mouse location fixed
            zoomOnFixedPoint(-deltaY / 500, fixedPoint);
            this.props.updateViewBounds(paper.view.matrix);
            this.props.redrawSelectionBox(); // Selection handles need to be resized after zoom
        } else if (event.shiftKey && event.deltaX === 0) {
            // Scroll horizontally (based on vertical scroll delta)
            // This is needed as for some browser/system combinations which do not set deltaX.
            // See #156.
            const dx = deltaY / paper.view.zoom;
            pan(dx, 0);
            this.props.updateViewBounds(paper.view.matrix);
        } else {
            const dx = deltaX / paper.view.zoom;
            const dy = deltaY / paper.view.zoom;
            pan(dx, dy);
            this.props.updateViewBounds(paper.view.matrix);
            if (paper.tool) {
                paper.tool.view._handleMouseEvent('mousemove', event, fixedPoint);
            }
        }
        event.preventDefault();
    }
    render () {
        let widthPercent = 0;
        let heightPercent = 0;
        let topPercent = 0;
        let leftPercent = 0;
        if (paper.project) {
            const bounds = getWorkspaceBounds();
            const {x, y, width, height} = paper.view.bounds;
            widthPercent = Math.min(100, 100 * width / bounds.width);
            heightPercent = Math.min(100, 100 * height / bounds.height);
            const centerX = (x + (width / 2) - bounds.x) / bounds.width;
            const centerY = (y + (height / 2) - bounds.y) / bounds.height;
            topPercent = Math.max(0, (100 * centerY) - (heightPercent / 2));
            leftPercent = Math.max(0, (100 * centerX) - (widthPercent / 2));
        }
        return (
            <ScrollableCanvasComponent
                hideScrollbars={this.props.hideScrollbars}
                horizontalScrollLengthPercent={widthPercent}
                horizontalScrollStartPercent={leftPercent}
                style={this.props.style}
                verticalScrollLengthPercent={heightPercent}
                verticalScrollStartPercent={topPercent}
                onHorizontalScrollbarMouseDown={this.handleHorizontalScrollbarMouseDown}
                onVerticalScrollbarMouseDown={this.handleVerticalScrollbarMouseDown}
            >
                {this.props.children}
            </ScrollableCanvasComponent>
        );
    }
}

ScrollableCanvas.propTypes = {
    canvas: PropTypes.instanceOf(Element),
    children: PropTypes.node.isRequired,
    hideScrollbars: PropTypes.bool,
    redrawSelectionBox: PropTypes.func.isRequired,
    style: PropTypes.string,
    updateViewBounds: PropTypes.func.isRequired
};

const mapStateToProps = state => ({
    viewBounds: state.scratchPaint.viewBounds
});
const mapDispatchToProps = dispatch => ({
    redrawSelectionBox: () => {
        dispatch(redrawSelectionBox());
    },
    updateViewBounds: matrix => {
        dispatch(updateViewBounds(matrix));
    }
});


export default connect(
    mapStateToProps,
    mapDispatchToProps
)(ScrollableCanvas);
