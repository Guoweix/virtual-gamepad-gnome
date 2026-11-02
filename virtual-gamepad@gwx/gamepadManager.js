import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * GamepadManager - Manages the uinput helper subprocess.
 *
 * Spawns uinputHelper.py as a subprocess and communicates via stdin
 * using a JSON-line protocol to send gamepad events.
 */
export class GamepadManager {
    constructor(extensionPath) {
        this._extensionPath = extensionPath;
        this._subprocess = null;
        this._stdin = null;
        this._pendingWrites = [];
        this._writing = false;
    }

    start() {
        try {
            const helperPath = GLib.build_filenamev([this._extensionPath, 'uinputHelper.py']);

            // Make helper executable
            try {
                GLib.spawn_command_line_sync(`chmod +x ${helperPath}`);
            } catch (e) {
                // Ignore chmod errors
            }

            // Spawn with pkexec for uinput access, or try direct if user has permissions
            // First try direct access (user might be in input group)
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });

            this._subprocess = launcher.spawnv(['python3', helperPath]);
            this._stdin = this._subprocess.get_stdin_pipe();

            // Monitor stderr for errors
            const stderr = this._subprocess.get_stderr_pipe();
            this._readStderr(stderr);

            log('[VirtualGamepad] uinput helper started');
        } catch (e) {
            logError(e, '[VirtualGamepad] Failed to start uinput helper');
        }
    }

    stop() {
        if (this._stdin) {
            try {
                this._sendLine('{"type":"quit"}');
                this._stdin.close(null);
            } catch (e) {
                // Ignore
            }
            this._stdin = null;
        }

        if (this._subprocess) {
            try {
                this._subprocess.force_exit();
            } catch (e) {
                // Ignore
            }
            this._subprocess = null;
        }
    }

    /**
     * Send an axis value.
     * @param {string} axis - Axis name: ABS_X, ABS_Y, ABS_RX, ABS_RY, ABS_Z, ABS_RZ
     * @param {number} value - Normalized value from -1.0 to 1.0 (or 0.0 to 1.0 for triggers)
     */
    sendAxis(axis, value) {
        this._sendLine(JSON.stringify({
            type: 'axis',
            axis: axis,
            value: value,
        }));
    }

    /**
     * Send a button press/release.
     * @param {string} button - Button name: BTN_A, BTN_B, BTN_X, BTN_Y, BTN_TL, BTN_TR, etc.
     * @param {boolean} pressed - true for press, false for release
     */
    sendButton(button, pressed) {
        this._sendLine(JSON.stringify({
            type: 'button',
            button: button,
            value: pressed ? 1 : 0,
        }));
    }

    /**
     * Send a DPAD direction.
     * @param {string} direction - DPAD_UP, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT
     * @param {boolean} pressed - true for press, false for release
     */
    sendDpad(direction, pressed) {
        this._sendLine(JSON.stringify({
            type: 'dpad',
            direction: direction,
            value: pressed ? 1 : 0,
        }));
    }

    _sendLine(line) {
        if (!this._stdin)
            return;

        const data = new TextEncoder().encode(line + '\n');
        this._pendingWrites.push(data);
        this._flushWrites();
    }

    _flushWrites() {
        if (this._writing || this._pendingWrites.length === 0)
            return;

        this._writing = true;
        const data = this._pendingWrites.shift();

        this._stdin.write_bytes_async(
            GLib.Bytes.new(data),
            GLib.PRIORITY_DEFAULT,
            null,
            (stream, result) => {
                try {
                    stream.write_bytes_finish(result);
                } catch (e) {
                    logError(e, '[VirtualGamepad] Write error');
                }
                this._writing = false;
                this._flushWrites();
            }
        );
    }

    _readStderr(stderr) {
        const dataStream = new Gio.DataInputStream({
            base_stream: stderr,
        });

        const readLine = () => {
            dataStream.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, result) => {
                try {
                    const [line] = stream.read_line_finish_utf8(result);
                    if (line !== null) {
                        log(`[VirtualGamepad Helper] ${line}`);
                        readLine();
                    }
                } catch (e) {
                    // Stream closed
                }
            });
        };
        readLine();
    }
}
