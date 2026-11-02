import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GObject from 'gi://GObject';

/**
 * VirtualButton - A virtual gamepad button for touch input.
 *
 * Displays a circular or rounded button with a label.
 * Emits pressed/released signals on touch.
 *
 * Signals:
 *   state-changed(pressed) - emitted when button state changes (true=pressed, false=released)
 */
export const VirtualButton = GObject.registerClass({
    Signals: {
        'state-changed': {param_types: [GObject.TYPE_BOOLEAN]},
    },
}, class VirtualButton extends St.Widget {
    _init(params = {}) {
        const label = params.label || '';
        const btnSize = params.btnSize || 60;
        const styleClass = params.styleClass || 'gamepad-btn';
        const touchMargin = params.touchMargin ?? 0;
        delete params.label;
        delete params.btnSize;
        delete params.styleClass;
        delete params.touchMargin;

        super._init({
            reactive: true,
            width: btnSize,
            height: btnSize,
            ...params,
        });

        this._btnSize = btnSize;
        this._touchMargin = touchMargin;
        this._pressed = false;
        this._touchSequence = null;
        this._dragMode = false;
        this._longPressTimeout = null;

        // Button background (St.Bin centers its child automatically)
        this._bg = new St.Bin({
            style_class: styleClass,
            width: btnSize,
            height: btnSize,
            x: 0,
            y: 0,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._bg);

        // Label
        if (label) {
            this._label = new St.Label({
                text: label,
                style_class: 'gamepad-btn-label',
            });
            this._bg.set_child(this._label);
        }
    }

    /**
     * 检查触摸点是否在有效区域内（排除边缘 margin 像素）
     */
    _isTouchInActiveArea(event) {
        const [absX, absY] = event.get_coords();
        const [ok, localX, localY] = this.transform_stage_point(absX, absY);
        if (!ok)
            return false;
        const m = this._touchMargin;
        const w = this.width;
        const h = this.height;
        return localX >= m && localX <= w - m && localY >= m && localY <= h - m;
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
            this._startLongPress(event);
            this._setPressed(true);
            return Clutter.EVENT_STOP;
        }

        if (!sequence || !this._touchSequence)
            return Clutter.EVENT_PROPAGATE;

        if (sequence.get_slot && this._touchSequence.get_slot) {
            if (sequence.get_slot() !== this._touchSequence.get_slot())
                return Clutter.EVENT_PROPAGATE;
        }

        if (type === Clutter.EventType.TOUCH_UPDATE) {
            this._cancelLongPress();
            if (this._dragMode)
                this._handleDrag(event);
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.TOUCH_END ||
            type === Clutter.EventType.TOUCH_CANCEL) {
            this._cancelLongPress();
            this._touchSequence = null;
            this._dragMode = false;
            this._setPressed(false);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    // Mouse support for testing
    vfunc_button_press_event(event) {
        if (!this._isTouchInActiveArea(event))
            return Clutter.EVENT_PROPAGATE;
        this._startLongPress(event);
        this._setPressed(true);
        return Clutter.EVENT_STOP;
    }

    vfunc_button_release_event(_event) {
        this._cancelLongPress();
        this._dragMode = false;
        this._setPressed(false);
        return Clutter.EVENT_STOP;
    }

    vfunc_motion_event(event) {
        if (this._dragMode)
            this._handleDrag(event);
        return Clutter.EVENT_PROPAGATE;
    }

    _setPressed(pressed) {
        if (this._pressed === pressed)
            return;
        this._pressed = pressed;
        if (pressed)
            this._bg.add_style_class_name('pressed');
        else
            this._bg.remove_style_class_name('pressed');
        this.emit('state-changed', pressed);
    }

    _startLongPress(event) {
        this._cancelLongPress();
        this._longPressStartCoords = event.get_coords();
        this._longPressTimeout = setTimeout(() => {
            this._dragMode = true;
            this._longPressTimeout = null;
            this._bg.add_style_class_name('dragging');
        }, 800);
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
            this.set_position(this.x + dx, this.y + dy);
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
