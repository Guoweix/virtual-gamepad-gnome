import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GObject from 'gi://GObject';

/**
 * VirtualStick - A virtual analog stick widget for touch input.
 *
 * Displays a circular pad with a movable thumb indicator.
 * Emits normalized axis values (-1.0 to 1.0) on touch movement.
 *
 * Signals:
 *   axis-changed(xNorm, yNorm) - emitted when thumb position changes
 */
export const VirtualStick = GObject.registerClass({
    Signals: {
        'axis-changed': {param_types: [GObject.TYPE_DOUBLE, GObject.TYPE_DOUBLE]},
    },
}, class VirtualStick extends St.Widget {
    _init(params = {}) {
        const padSize = params.padSize || 200;
        const thumbSize = params.thumbSize || 70;
        const touchMargin = params.touchMargin ?? 0;
        delete params.padSize;
        delete params.thumbSize;
        delete params.touchMargin;

        super._init({
            reactive: true,
            width: padSize,
            height: padSize,
            ...params,
        });

        this._padSize = padSize;
        this._thumbSize = thumbSize;
        this._touchMargin = touchMargin;
        this._padRadius = padSize / 2;
        this._thumbRadius = thumbSize / 2;
        this._maxOffset = this._padRadius - this._thumbRadius;

        this._touchSequence = null;
        this._dragMode = false;
        this._longPressTimeout = null;

        // Pad background (outer circle)
        this._pad = new St.Widget({
            style_class: 'gamepad-stick-pad',
            width: padSize,
            height: padSize,
            x: 0,
            y: 0,
        });
        this.add_child(this._pad);

        // Thumb indicator (inner circle)
        this._thumb = new St.Widget({
            style_class: 'gamepad-stick-thumb',
            width: thumbSize,
            height: thumbSize,
        });
        this.add_child(this._thumb);
        this._centerThumb();
    }

    _centerThumb() {
        this._thumb.set_position(
            this._padRadius - this._thumbRadius,
            this._padRadius - this._thumbRadius
        );
    }

    /**
     * 检查触摸点是否在有效圆形区域内（排除边缘 margin 像素）
     */
    _isTouchInActiveArea(event) {
        const [absX, absY] = event.get_coords();
        const [ok, localX, localY] = this.transform_stage_point(absX, absY);
        if (!ok)
            return false;
        const dx = localX - this._padRadius;
        const dy = localY - this._padRadius;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= this._padRadius - this._touchMargin;
    }

    vfunc_touch_event(event) {
        const type = event.type();
        const sequence = event.get_event_sequence();

        if (type === Clutter.EventType.TOUCH_BEGIN) {
            if (this._touchSequence !== null)
                return Clutter.EVENT_PROPAGATE;
            if (!this._isTouchInActiveArea(event))
                return Clutter.EVENT_PROPAGATE;

            this._touchSequence = sequence;

            // Start long-press detection for drag mode
            this._startLongPress(event);
            this._updateThumbPosition(event);
            return Clutter.EVENT_STOP;
        }

        if (!sequence || !this._touchSequence)
            return Clutter.EVENT_PROPAGATE;

        // Clutter touch sequences are compared by value, not reference
        if (sequence.get_slot && this._touchSequence.get_slot) {
            if (sequence.get_slot() !== this._touchSequence.get_slot())
                return Clutter.EVENT_PROPAGATE;
        }

        if (type === Clutter.EventType.TOUCH_UPDATE) {
            this._cancelLongPress();
            if (this._dragMode) {
                this._handleDrag(event);
            } else {
                this._updateThumbPosition(event);
            }
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.TOUCH_END ||
            type === Clutter.EventType.TOUCH_CANCEL) {
            this._cancelLongPress();
            this._touchSequence = null;
            this._dragMode = false;
            this._centerThumb();
            this.emit('axis-changed', 0.0, 0.0);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    // Also handle mouse events for testing without touch screen
    vfunc_button_press_event(event) {
        if (this._touchSequence !== null)
            return Clutter.EVENT_PROPAGATE;
        if (!this._isTouchInActiveArea(event))
            return Clutter.EVENT_PROPAGATE;
        this._mouseDown = true;
        this._startLongPress(event);
        this._updateThumbFromEvent(event);
        return Clutter.EVENT_STOP;
    }

    vfunc_button_release_event(_event) {
        this._cancelLongPress();
        this._mouseDown = false;
        this._dragMode = false;
        this._centerThumb();
        this.emit('axis-changed', 0.0, 0.0);
        return Clutter.EVENT_STOP;
    }

    vfunc_motion_event(event) {
        if (!this._mouseDown)
            return Clutter.EVENT_PROPAGATE;
        this._cancelLongPress();
        if (this._dragMode) {
            this._handleDrag(event);
        } else {
            this._updateThumbFromEvent(event);
        }
        return Clutter.EVENT_STOP;
    }

    _updateThumbPosition(event) {
        const [absX, absY] = event.get_coords();
        this._updateThumbFromAbsCoords(absX, absY);
    }

    _updateThumbFromEvent(event) {
        const [absX, absY] = event.get_coords();
        this._updateThumbFromAbsCoords(absX, absY);
    }

    _updateThumbFromAbsCoords(absX, absY) {
        // Convert absolute coords to local
        const [ok, localX, localY] = this.transform_stage_point(absX, absY);
        if (!ok)
            return;

        // Calculate offset from center
        let dx = localX - this._padRadius;
        let dy = localY - this._padRadius;

        // Clamp to max offset (circle boundary)
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > this._maxOffset) {
            dx = dx / dist * this._maxOffset;
            dy = dy / dist * this._maxOffset;
        }

        // Update thumb position
        this._thumb.set_position(
            this._padRadius + dx - this._thumbRadius,
            this._padRadius + dy - this._thumbRadius
        );

        // Emit normalized axis values (-1.0 to 1.0)
        const xNorm = dx / this._maxOffset;
        const yNorm = dy / this._maxOffset;
        this.emit('axis-changed', xNorm, yNorm);
    }

    _startLongPress(event) {
        this._cancelLongPress();
        this._longPressStartCoords = event.get_coords();
        this._longPressTimeout = setTimeout(() => {
            this._dragMode = true;
            this._longPressTimeout = null;
            // Visual feedback: add drag style
            this._pad.add_style_class_name('dragging');
        }, 800); // 800ms long press
    }

    _cancelLongPress() {
        if (this._longPressTimeout) {
            clearTimeout(this._longPressTimeout);
            this._longPressTimeout = null;
        }
    }

    _handleDrag(event) {
        const [absX, absY] = event.get_coords();
        if (this._lastDragCoords) {
            const dx = absX - this._lastDragCoords[0];
            const dy = absY - this._lastDragCoords[1];
            const parent = this.get_parent();
            if (parent) {
                this.set_position(this.x + dx, this.y + dy);
            }
        }
        this._lastDragCoords = [absX, absY];
    }

    resetPosition(x, y) {
        this.set_position(x, y);
        this._lastDragCoords = null;
    }

    destroy() {
        this._cancelLongPress();
        super.destroy();
    }
});
