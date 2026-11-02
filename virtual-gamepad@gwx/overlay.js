import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {VirtualStick} from './virtualStick.js';
import {VirtualButton} from './virtualButton.js';

/**
 * GamepadOverlay - Manages all virtual gamepad controls on screen.
 *
 * 使用一个全屏透明容器挂载到 global.stage 最顶层，
 * 确保在全屏窗口之上渲染。
 */
export class GamepadOverlay {
    constructor(gamepadManager) {
        this._gamepadManager = gamepadManager;
        this._controls = [];
        this._defaultPositions = {};
        this._visible = false;
        this._container = null;
    }

    show() {
        if (this._visible)
            return;
        this._visible = true;
        // 禁用 direct scanout，确保控件能在全屏窗口上方显示
        const compositor = global.display.get_compositor();
        if (compositor && compositor.disable_unredirect)
            compositor.disable_unredirect();
        this._createControls();
    }

    hide() {
        if (!this._visible)
            return;
        this._visible = false;
        this._removeControls();
        // 恢复 direct scanout 优化
        const compositor = global.display.get_compositor();
        if (compositor && compositor.enable_unredirect)
            compositor.enable_unredirect();
    }

    /**
     * 添加控件到容器
     */
    _addControl(actor) {
        this._container.add_child(actor);
        this._controls.push(actor);
    }

    _createControls() {
        const monitor = Main.layoutManager.primaryMonitor;
        const W = monitor.width;
        const H = monitor.height;
        const margin = 40;

        // 打印 stage 层级到日志（递归调试）
        const dumpChildren = (actor, prefix = '') => {
            const nc = actor.get_n_children();
            for (let i = 0; i < nc; i++) {
                const c = actor.get_child_at_index(i);
                log(`[VirtualGamepad] ${prefix}${i}: ${c.constructor.name} name=${c.name} visible=${c.visible}`);
                // 只递归前两层，避免日志爆炸
                if (prefix.length < 4)
                    dumpChildren(c, prefix + '  ');
            }
        };
        log('[VirtualGamepad] === Stage hierarchy ===');
        dumpChildren(global.stage);

        // 创建全屏透明容器
        // 将其插入到 window_group（uiGroup 的第一个 Meta_WindowGroup）内部的最后，
        // 这样它与全屏窗口在同一个合成组中，且排在窗口之后（渲染在上面）。
        // 同时也在 uiGroup 末尾放一份引用不行(窗口在不同平面)，
        // 所以直接放在 global.window_group 里。
        this._container = new St.Widget({
            name: 'virtual-gamepad-container',
            reactive: false,
            x: 0,
            y: 0,
            width: W,
            height: H,
        });
        global.window_group.add_child(this._container);

        // ===== 预计算各区域的边界，用于创建事件挡板 =====
        const stickSize = 200;
        const lsX = margin + 20;
        const lsY = H - stickSize - margin - 60;
        const rsX = W - stickSize - margin - 20;
        const rsY = H - stickSize - margin - 60;

        const dpadBtnSize = 55;
        const dpadCenterX = margin + 120;
        const dpadCenterY = lsY - 100;
        const dpadOffset = 50;

        const faceBtnSize = 60;
        const faceCenterX = W - margin - 140;
        const faceCenterY = rsY - 100;
        const faceOffset = 55;

        const shoulderBtnW = 80;
        const shoulderBtnH = 45;
        const shoulderGap = 15;
        const lbY = dpadCenterY - dpadOffset - dpadBtnSize / 2 - shoulderBtnH - shoulderGap;
        const rbY = faceCenterY - faceOffset - faceBtnSize / 2 - shoulderBtnH - shoulderGap;

        const triggerGap = 10;
        const ltY = lbY - shoulderBtnH - triggerGap;
        const rtY = rbY - shoulderBtnH - triggerGap;

        // ===== 两个大矩形挡板，吞掉控件区域内的所有触摸事件 =====
        const shieldPad = 30;  // 挡板比控件区域多出的边距

        // 左侧挡板：覆盖 LT/LB/DPAD/LeftStick/L3
        const leftShieldX = Math.min(lsX, dpadCenterX - dpadOffset - dpadBtnSize / 2, dpadCenterX - shoulderBtnW / 2) - shieldPad;
        const leftShieldY = ltY - shieldPad;
        const leftShieldR = Math.max(lsX + stickSize, dpadCenterX + dpadOffset + dpadBtnSize / 2, dpadCenterX + shoulderBtnW / 2) + shieldPad;
        const leftShieldB = lsY + stickSize + 35 + 5 + shieldPad;  // +35+5 = L3 按钮

        this._leftShield = new St.Widget({
            reactive: true,
            x: Math.max(0, leftShieldX),
            y: Math.max(0, leftShieldY),
            width: leftShieldR - Math.max(0, leftShieldX),
            height: leftShieldB - Math.max(0, leftShieldY),
            style: 'background-color: transparent;',
        });
        this._container.add_child(this._leftShield);
        this._controls.push(this._leftShield);

        // 右侧挡板：覆盖 RT/RB/ABXY/RightStick/R3
        const rightShieldX = Math.min(rsX, faceCenterX - faceOffset - faceBtnSize / 2, faceCenterX - shoulderBtnW / 2) - shieldPad;
        const rightShieldY = rtY - shieldPad;
        const rightShieldR = Math.max(rsX + stickSize, faceCenterX + faceOffset + faceBtnSize / 2, faceCenterX + shoulderBtnW / 2) + shieldPad;
        const rightShieldB = rsY + stickSize + 35 + 5 + shieldPad;

        this._rightShield = new St.Widget({
            reactive: true,
            x: Math.max(0, rightShieldX),
            y: Math.max(0, rightShieldY),
            width: rightShieldR - Math.max(0, rightShieldX),
            height: rightShieldB - Math.max(0, rightShieldY),
            style: 'background-color: transparent;',
        });
        this._container.add_child(this._rightShield);
        this._controls.push(this._rightShield);

        log(`[VirtualGamepad] Left shield: (${this._leftShield.x},${this._leftShield.y}) ${this._leftShield.width}x${this._leftShield.height}`);
        log(`[VirtualGamepad] Right shield: (${this._rightShield.x},${this._rightShield.y}) ${this._rightShield.width}x${this._rightShield.height}`);

        // ===== LEFT ANALOG STICK =====
        this._leftStick = new VirtualStick({padSize: stickSize, thumbSize: 70});
        this._leftStick.set_position(lsX, lsY);
        this._defaultPositions['leftStick'] = [lsX, lsY];
        this._leftStick.connect('axis-changed', (_w, x, y) => {
            this._gamepadManager.sendAxis('ABS_X', x);
            this._gamepadManager.sendAxis('ABS_Y', y);
        });
        this._addControl(this._leftStick);

        // ===== RIGHT ANALOG STICK =====
        this._rightStick = new VirtualStick({padSize: stickSize, thumbSize: 70});
        this._rightStick.set_position(rsX, rsY);
        this._defaultPositions['rightStick'] = [rsX, rsY];
        this._rightStick.connect('axis-changed', (_w, x, y) => {
            this._gamepadManager.sendAxis('ABS_RX', x);
            this._gamepadManager.sendAxis('ABS_RY', y);
        });
        this._addControl(this._rightStick);

        // ===== DPAD =====
        const dpadButtons = [
            {label: '▲', x: dpadCenterX, y: dpadCenterY - dpadOffset, axis: 'DPAD_UP'},
            {label: '▼', x: dpadCenterX, y: dpadCenterY + dpadOffset, axis: 'DPAD_DOWN'},
            {label: '◀', x: dpadCenterX - dpadOffset, y: dpadCenterY, axis: 'DPAD_LEFT'},
            {label: '▶', x: dpadCenterX + dpadOffset, y: dpadCenterY, axis: 'DPAD_RIGHT'},
        ];

        this._dpadButtons = [];
        for (const def of dpadButtons) {
            const btn = new VirtualButton({
                label: def.label,
                btnSize: dpadBtnSize,
                styleClass: 'gamepad-btn gamepad-dpad',
            });
            btn.set_position(def.x - dpadBtnSize / 2, def.y - dpadBtnSize / 2);
            this._defaultPositions[`dpad_${def.axis}`] = [def.x - dpadBtnSize / 2, def.y - dpadBtnSize / 2];
            btn.connect('state-changed', (_w, pressed) => {
                this._gamepadManager.sendDpad(def.axis, pressed);
            });
            this._addControl(btn);
            this._dpadButtons.push(btn);
        }

        // ===== FACE BUTTONS (A/B/X/Y) - Diamond layout =====
        const faceButtons = [
            {label: 'A', x: faceCenterX, y: faceCenterY + faceOffset, styleClass: 'gamepad-btn gamepad-btn-a', btn: 'BTN_A'},
            {label: 'B', x: faceCenterX + faceOffset, y: faceCenterY, styleClass: 'gamepad-btn gamepad-btn-b', btn: 'BTN_B'},
            {label: 'X', x: faceCenterX - faceOffset, y: faceCenterY, styleClass: 'gamepad-btn gamepad-btn-x', btn: 'BTN_X'},
            {label: 'Y', x: faceCenterX, y: faceCenterY - faceOffset, styleClass: 'gamepad-btn gamepad-btn-y', btn: 'BTN_Y'},
        ];

        this._faceButtons = [];
        for (const def of faceButtons) {
            const btn = new VirtualButton({
                label: def.label,
                btnSize: faceBtnSize,
                styleClass: def.styleClass,
            });
            btn.set_position(def.x - faceBtnSize / 2, def.y - faceBtnSize / 2);
            this._defaultPositions[`face_${def.btn}`] = [def.x - faceBtnSize / 2, def.y - faceBtnSize / 2];
            btn.connect('state-changed', (_w, pressed) => {
                this._gamepadManager.sendButton(def.btn, pressed);
            });
            this._addControl(btn);
            this._faceButtons.push(btn);
        }

        // ===== SHOULDER BUTTONS (LB/RB) =====
        const shoulderButtons = [
            {label: 'LB', x: dpadCenterX - shoulderBtnW / 2, y: lbY, btn: 'BTN_TL'},
            {label: 'RB', x: faceCenterX - shoulderBtnW / 2, y: rbY, btn: 'BTN_TR'},
        ];

        this._shoulderButtons = [];
        for (const def of shoulderButtons) {
            const btn = new VirtualButton({
                label: def.label,
                btnSize: shoulderBtnH,
                styleClass: 'gamepad-btn gamepad-shoulder',
            });
            btn.set_size(shoulderBtnW, shoulderBtnH);
            btn._bg.set_size(shoulderBtnW, shoulderBtnH);
            btn.set_position(def.x, def.y);
            this._defaultPositions[`shoulder_${def.btn}`] = [def.x, def.y];
            btn.connect('state-changed', (_w, pressed) => {
                this._gamepadManager.sendButton(def.btn, pressed);
            });
            this._addControl(btn);
            this._shoulderButtons.push(btn);
        }

        // ===== TRIGGER BUTTONS (LT/RT) =====
        const triggerButtons = [
            {label: 'LT', x: dpadCenterX - shoulderBtnW / 2, y: ltY, axis: 'ABS_Z'},
            {label: 'RT', x: faceCenterX - shoulderBtnW / 2, y: rtY, axis: 'ABS_RZ'},
        ];

        this._triggerButtons = [];
        for (const def of triggerButtons) {
            const btn = new VirtualButton({
                label: def.label,
                btnSize: shoulderBtnH,
                styleClass: 'gamepad-btn gamepad-trigger',
            });
            btn.set_size(shoulderBtnW, shoulderBtnH);
            btn._bg.set_size(shoulderBtnW, shoulderBtnH);
            btn.set_position(def.x, def.y);
            this._defaultPositions[`trigger_${def.axis}`] = [def.x, def.y];
            btn.connect('state-changed', (_w, pressed) => {
                this._gamepadManager.sendAxis(def.axis, pressed ? 1.0 : 0.0);
            });
            this._addControl(btn);
            this._triggerButtons.push(btn);
        }

        // ===== CENTER BUTTONS (SELECT/MODE/START) =====
        const centerBtnW = 50;
        const centerBtnH = 35;
        const centerY = H - margin - centerBtnH - 10;
        const centerBaseX = W / 2;
        const centerGap = 60;

        const centerButtons = [
            {label: 'SEL', x: centerBaseX - centerGap - centerBtnW / 2, y: centerY, btn: 'BTN_SELECT'},
            {label: '⊙', x: centerBaseX - centerBtnW / 2, y: centerY, btn: 'BTN_MODE'},
            {label: 'STA', x: centerBaseX + centerGap - centerBtnW / 2, y: centerY, btn: 'BTN_START'},
        ];

        this._centerButtons = [];
        for (const def of centerButtons) {
            const btn = new VirtualButton({
                label: def.label,
                btnSize: centerBtnH,
                styleClass: 'gamepad-btn gamepad-center',
            });
            btn.set_size(centerBtnW, centerBtnH);
            btn._bg.set_size(centerBtnW, centerBtnH);
            btn.set_position(def.x, def.y);
            this._defaultPositions[`center_${def.btn}`] = [def.x, def.y];
            btn.connect('state-changed', (_w, pressed) => {
                this._gamepadManager.sendButton(def.btn, pressed);
            });
            this._addControl(btn);
            this._centerButtons.push(btn);
        }

        // ===== THUMBSTICK CLICK BUTTONS (L3/R3) =====
        const thumbClickSize = 35;
        const l3btn = new VirtualButton({
            label: 'L3',
            btnSize: thumbClickSize,
            styleClass: 'gamepad-btn gamepad-center',
        });
        l3btn.set_position(lsX + stickSize / 2 - thumbClickSize / 2, lsY + stickSize + 5);
        this._defaultPositions['l3'] = [lsX + stickSize / 2 - thumbClickSize / 2, lsY + stickSize + 5];
        l3btn.connect('state-changed', (_w, pressed) => {
            this._gamepadManager.sendButton('BTN_THUMBL', pressed);
        });
        this._addControl(l3btn);

        const r3btn = new VirtualButton({
            label: 'R3',
            btnSize: thumbClickSize,
            styleClass: 'gamepad-btn gamepad-center',
        });
        r3btn.set_position(rsX + stickSize / 2 - thumbClickSize / 2, rsY + stickSize + 5);
        this._defaultPositions['r3'] = [rsX + stickSize / 2 - thumbClickSize / 2, rsY + stickSize + 5];
        r3btn.connect('state-changed', (_w, pressed) => {
            this._gamepadManager.sendButton('BTN_THUMBR', pressed);
        });
        this._addControl(r3btn);

        log('[VirtualGamepad] All controls created, container added to stage');
    }

    _removeControls() {
        for (const control of this._controls) {
            control.destroy();
        }
        this._controls = [];

        if (this._container) {
            global.window_group.remove_child(this._container);
            this._container.destroy();
            this._container = null;
        }
    }

    resetPositions() {
        if (this._leftStick) {
            const [x, y] = this._defaultPositions['leftStick'];
            this._leftStick.set_position(x, y);
        }
        if (this._rightStick) {
            const [x, y] = this._defaultPositions['rightStick'];
            this._rightStick.set_position(x, y);
        }
    }

    destroy() {
        if (this._visible) {
            this._visible = false;
            this._removeControls();
            const compositor = global.display.get_compositor();
            if (compositor && compositor.enable_unredirect)
                compositor.enable_unredirect();
        }
    }
}
