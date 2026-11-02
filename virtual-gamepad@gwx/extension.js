import St from 'gi://St';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {GamepadOverlay} from './overlay.js';
import {GamepadManager} from './gamepadManager.js';

const IndicatorButton = GObject.registerClass(
class IndicatorButton extends PanelMenu.Button {
    _init(extensionPath) {
        super._init(0.0, 'Virtual Gamepad');
        this._extensionPath = extensionPath;
        this._active = false;
        this._overlay = null;
        this._gamepadManager = null;

        // Panel icon
        this._icon = new St.Icon({
            icon_name: 'input-gaming-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        // Toggle menu item
        this._toggleItem = new PopupMenu.PopupSwitchMenuItem('Virtual Gamepad', false);
        this._toggleItem.connect('toggled', (_item, state) => {
            this._setActive(state);
        });
        this.menu.addMenuItem(this._toggleItem);

        // Opacity slider
        this._opacityItem = new PopupMenu.PopupBaseMenuItem({reactive: false});
        const opacityLabel = new St.Label({text: 'Opacity', y_align: 2}); // ALIGN_CENTER
        this._opacitySlider = new St.Widget({
            style_class: 'popup-menu-item',
            can_focus: true,
            reactive: true,
            x_expand: true,
        });
        this._opacityItem.add_child(opacityLabel);
        this.menu.addMenuItem(this._opacityItem);

        // Reset positions menu item
        const resetItem = new PopupMenu.PopupMenuItem('Reset Positions');
        resetItem.connect('activate', () => {
            if (this._overlay)
                this._overlay.resetPositions();
        });
        this.menu.addMenuItem(resetItem);
    }

    _setActive(active) {
        if (this._active === active)
            return;

        this._active = active;

        if (active) {
            this._gamepadManager = new GamepadManager(this._extensionPath);
            this._gamepadManager.start();

            this._overlay = new GamepadOverlay(this._gamepadManager);
            this._overlay.show();
        } else {
            if (this._overlay) {
                this._overlay.hide();
                this._overlay.destroy();
                this._overlay = null;
            }
            if (this._gamepadManager) {
                this._gamepadManager.stop();
                this._gamepadManager = null;
            }
        }

        this._icon.style = active ? 'color: #4CAF50;' : '';
    }

    destroy() {
        this._setActive(false);
        super.destroy();
    }
});

export default class VirtualGamepadExtension extends Extension {
    enable() {
        this._indicator = new IndicatorButton(this.path);
        Main.panel.addToStatusArea('virtual-gamepad', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
