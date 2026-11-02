#!/usr/bin/env python3
"""
uinputHelper.py - Virtual Xbox gamepad via uinput.

Creates a virtual Xbox-compatible gamepad device and reads JSON commands
from stdin to emit gamepad events.

Protocol (JSON lines on stdin):
  {"type": "axis",   "axis": "ABS_X",      "value": 0.5}
  {"type": "button", "button": "BTN_A",    "value": 1}
  {"type": "dpad",   "direction": "DPAD_UP","value": 1}
  {"type": "quit"}

No external dependencies - uses raw ioctl calls to /dev/uinput.
"""

import os
import sys
import json
import struct
import fcntl
import time
import signal

# ============================================================
# Constants
# ============================================================

# ioctl numbers (x86_64 / aarch64)
UI_SET_EVBIT  = 0x40045564
UI_SET_KEYBIT = 0x40045565
UI_SET_ABSBIT = 0x40045567
UI_DEV_SETUP  = 0x405c5503
UI_ABS_SETUP  = 0x401c5504
UI_DEV_CREATE = 0x5501
UI_DEV_DESTROY = 0x5502

# Event types
EV_SYN = 0x00
EV_KEY = 0x01
EV_ABS = 0x03

# Sync codes
SYN_REPORT = 0x00

# Axis codes
ABS_X     = 0x00   # Left stick X
ABS_Y     = 0x01   # Left stick Y
ABS_Z     = 0x02   # Left trigger
ABS_RX    = 0x03   # Right stick X
ABS_RY    = 0x04   # Right stick Y
ABS_RZ    = 0x05   # Right trigger
ABS_HAT0X = 0x10   # DPAD X
ABS_HAT0Y = 0x11   # DPAD Y

# Button codes (Xbox-style mapping)
BTN_A      = 0x130  # BTN_SOUTH - A
BTN_B      = 0x131  # BTN_EAST  - B
BTN_X      = 0x133  # BTN_NORTH - X  (note: kernel BTN_NORTH=0x133)
BTN_Y      = 0x134  # BTN_WEST  - Y  (note: kernel BTN_WEST=0x134)
BTN_TL     = 0x136  # Left bumper (LB)
BTN_TR     = 0x137  # Right bumper (RB)
BTN_SELECT = 0x13a  # Select / Back
BTN_START  = 0x13b  # Start / Menu
BTN_MODE   = 0x13c  # Xbox button
BTN_THUMBL = 0x13d  # Left stick click (L3)
BTN_THUMBR = 0x13e  # Right stick click (R3)

# Axis range for analog sticks
AXIS_MIN = -32768
AXIS_MAX =  32767

# Trigger range
TRIGGER_MIN = 0
TRIGGER_MAX = 255

# DPAD values
DPAD_MIN = -1
DPAD_MAX =  1

# Name lookup tables
AXIS_MAP = {
    'ABS_X':     ABS_X,
    'ABS_Y':     ABS_Y,
    'ABS_Z':     ABS_Z,
    'ABS_RX':    ABS_RX,
    'ABS_RY':    ABS_RY,
    'ABS_RZ':    ABS_RZ,
    'ABS_HAT0X': ABS_HAT0X,
    'ABS_HAT0Y': ABS_HAT0Y,
}

BUTTON_MAP = {
    'BTN_A':      BTN_A,
    'BTN_B':      BTN_B,
    'BTN_X':      BTN_X,
    'BTN_Y':      BTN_Y,
    'BTN_TL':     BTN_TL,
    'BTN_TR':     BTN_TR,
    'BTN_SELECT': BTN_SELECT,
    'BTN_START':  BTN_START,
    'BTN_MODE':   BTN_MODE,
    'BTN_THUMBL': BTN_THUMBL,
    'BTN_THUMBR': BTN_THUMBR,
}

# Axes that use trigger range (0-255) vs stick range (-32768 to 32767)
TRIGGER_AXES = {ABS_Z, ABS_RZ}

# ============================================================
# uinput device management
# ============================================================

def emit_event(fd, ev_type, code, value):
    """Write a single input_event to the uinput fd."""
    # struct input_event on 64-bit: { time_t, suseconds_t, __u16, __u16, __s32 }
    # = { 8, 8, 2, 2, 4 } = 24 bytes, format "llHHi"
    now = time.time()
    sec = int(now)
    usec = int((now - sec) * 1e6)
    data = struct.pack('llHHi', sec, usec, ev_type, code, value)
    os.write(fd, data)


def emit_syn(fd):
    """Emit a SYN_REPORT event."""
    emit_event(fd, EV_SYN, SYN_REPORT, 0)


def setup_abs_axis(fd, code, minimum, maximum, fuzz=0, flat=0, resolution=0):
    """Configure an absolute axis on the uinput device."""
    # UI_SET_ABSBIT
    fcntl.ioctl(fd, UI_SET_ABSBIT, code)
    # struct uinput_abs_setup:
    #   __u16 code (+ 2 bytes padding) + struct input_absinfo (6 x __s32 = 24 bytes)
    # Total: 28 bytes, format "Hxx iiiiii" (H=code, xx=pad, 6 ints for absinfo)
    data = struct.pack('Hxx iiiiii', code, 0, minimum, maximum, fuzz, flat, resolution)
    fcntl.ioctl(fd, UI_ABS_SETUP, data)


def create_gamepad():
    """Create a virtual Xbox-like gamepad via /dev/uinput."""
    fd = os.open('/dev/uinput', os.O_WRONLY | os.O_NONBLOCK)

    # Enable event types
    fcntl.ioctl(fd, UI_SET_EVBIT, EV_KEY)
    fcntl.ioctl(fd, UI_SET_EVBIT, EV_ABS)

    # Enable buttons
    for btn_code in BUTTON_MAP.values():
        fcntl.ioctl(fd, UI_SET_KEYBIT, btn_code)

    # Enable analog stick axes (range: -32768 to 32767)
    for axis_code in [ABS_X, ABS_Y, ABS_RX, ABS_RY]:
        setup_abs_axis(fd, axis_code, AXIS_MIN, AXIS_MAX, fuzz=16, flat=128)

    # Enable trigger axes (range: 0 to 255)
    for axis_code in [ABS_Z, ABS_RZ]:
        setup_abs_axis(fd, axis_code, TRIGGER_MIN, TRIGGER_MAX)

    # Enable DPAD axes (range: -1 to 1)
    for axis_code in [ABS_HAT0X, ABS_HAT0Y]:
        setup_abs_axis(fd, axis_code, DPAD_MIN, DPAD_MAX)

    # Device setup
    # struct uinput_setup:
    #   struct input_id { __u16 bustype, vendor, product, version } = 8 bytes
    #   char name[80]
    #   __u32 ff_effects_max = 4 bytes
    # Total: 92 bytes
    BUS_USB = 0x03
    name = b'Virtual Xbox Gamepad'
    name_padded = name + b'\x00' * (80 - len(name))
    # Use Xbox 360 controller IDs for compatibility
    vendor = 0x045e   # Microsoft
    product = 0x028e  # Xbox 360 Controller
    version = 0x0001
    setup_data = struct.pack('HHHH 80s I',
                             BUS_USB, vendor, product, version,
                             name_padded, 0)
    fcntl.ioctl(fd, UI_DEV_SETUP, setup_data)

    # Create the device
    fcntl.ioctl(fd, UI_DEV_CREATE)

    # Wait for device to be registered
    time.sleep(0.3)
    print("Virtual gamepad created successfully", file=sys.stderr)
    return fd


def destroy_gamepad(fd):
    """Destroy the virtual gamepad device."""
    try:
        fcntl.ioctl(fd, UI_DEV_DESTROY)
        os.close(fd)
        print("Virtual gamepad destroyed", file=sys.stderr)
    except Exception as e:
        print(f"Error destroying gamepad: {e}", file=sys.stderr)


# ============================================================
# Command processing
# ============================================================

def process_command(fd, cmd):
    """Process a single JSON command."""
    cmd_type = cmd.get('type')

    if cmd_type == 'axis':
        axis_name = cmd.get('axis', '')
        value = cmd.get('value', 0.0)
        axis_code = AXIS_MAP.get(axis_name)
        if axis_code is None:
            return

        # Convert normalized value to device range
        if axis_code in TRIGGER_AXES:
            # Triggers: 0.0-1.0 -> 0-255
            int_value = int(max(0.0, min(1.0, value)) * TRIGGER_MAX)
        else:
            # Sticks: -1.0 to 1.0 -> -32768 to 32767
            int_value = int(max(-1.0, min(1.0, value)) * AXIS_MAX)

        emit_event(fd, EV_ABS, axis_code, int_value)
        emit_syn(fd)

    elif cmd_type == 'button':
        btn_name = cmd.get('button', '')
        value = cmd.get('value', 0)
        btn_code = BUTTON_MAP.get(btn_name)
        if btn_code is None:
            return

        emit_event(fd, EV_KEY, btn_code, int(value))
        emit_syn(fd)

    elif cmd_type == 'dpad':
        direction = cmd.get('direction', '')
        value = cmd.get('value', 0)

        if direction == 'DPAD_UP':
            emit_event(fd, EV_ABS, ABS_HAT0Y, -1 if value else 0)
        elif direction == 'DPAD_DOWN':
            emit_event(fd, EV_ABS, ABS_HAT0Y, 1 if value else 0)
        elif direction == 'DPAD_LEFT':
            emit_event(fd, EV_ABS, ABS_HAT0X, -1 if value else 0)
        elif direction == 'DPAD_RIGHT':
            emit_event(fd, EV_ABS, ABS_HAT0X, 1 if value else 0)

        emit_syn(fd)

    elif cmd_type == 'quit':
        return False

    return True


# ============================================================
# Main loop
# ============================================================

def main():
    fd = None
    try:
        fd = create_gamepad()
        print("Waiting for commands on stdin...", file=sys.stderr)

        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
                if not process_command(fd, cmd):
                    break
            except json.JSONDecodeError as e:
                print(f"Invalid JSON: {e}", file=sys.stderr)
            except Exception as e:
                print(f"Error processing command: {e}", file=sys.stderr)

    except PermissionError:
        print("ERROR: Permission denied accessing /dev/uinput.", file=sys.stderr)
        print("Fix: sudo chmod 0666 /dev/uinput", file=sys.stderr)
        print("  or: sudo usermod -aG input $USER (then re-login)", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if fd is not None:
            destroy_gamepad(fd)


if __name__ == '__main__':
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    main()
