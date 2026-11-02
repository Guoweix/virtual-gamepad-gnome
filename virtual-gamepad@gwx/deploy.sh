#!/bin/bash
# deploy.sh - Deploy virtual-gamepad extension to test machine
#
# Usage: REMOTE_PASS=<password> ./deploy.sh [install|enable|disable|restart|log|test|setup]
#
# Requirements: sshpass (install: sudo pacman -S sshpass)
# The remote password is read from the REMOTE_PASS environment variable.

set -e

REMOTE_HOST="gwx@192.168.10.220"
REMOTE_PASS="${REMOTE_PASS:-}"
EXT_UUID="virtual-gamepad@gwx"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$SCRIPT_DIR"
REMOTE_EXT_DIR="/home/gwx/.local/share/gnome-shell/extensions/$EXT_UUID"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ssh_cmd() {
    sshpass -p "$REMOTE_PASS" ssh -o StrictHostKeyChecking=no "$REMOTE_HOST" "$@"
}

scp_cmd() {
    sshpass -p "$REMOTE_PASS" scp -o StrictHostKeyChecking=no -r "$@"
}

check_sshpass() {
    if [ -z "$REMOTE_PASS" ]; then
        echo -e "${RED}REMOTE_PASS is not set.${NC}"
        echo "Usage: REMOTE_PASS=<password> $0 [install|enable|disable|restart|log|test|setup]"
        exit 1
    fi
    if ! command -v sshpass &> /dev/null; then
        echo -e "${RED}sshpass is not installed.${NC}"
        echo "Install it with: sudo pacman -S sshpass"
        exit 1
    fi
}

cmd_setup() {
    echo -e "${YELLOW}Setting up test machine...${NC}"

    # Ensure uinput permissions
    ssh_cmd "sudo chmod 0666 /dev/uinput 2>/dev/null || true"
    ssh_cmd "sudo modprobe uinput 2>/dev/null || true"

    # Add user to input group
    ssh_cmd "sudo usermod -aG input gwx 2>/dev/null || true"

    # Create udev rule for persistent uinput permissions
    ssh_cmd "echo 'KERNEL==\"uinput\", MODE=\"0666\", GROUP=\"input\"' | sudo tee /etc/udev/rules.d/99-uinput.rules > /dev/null"
    ssh_cmd "sudo udevadm control --reload-rules && sudo udevadm trigger"

    echo -e "${GREEN}Setup complete. You may need to re-login for group changes to take effect.${NC}"
}

cmd_install() {
    echo -e "${YELLOW}Deploying extension to $REMOTE_HOST...${NC}"

    # Create remote extension directory
    ssh_cmd "mkdir -p $REMOTE_EXT_DIR"

    # Copy extension files
    scp_cmd "$EXT_DIR/metadata.json" "$REMOTE_HOST:$REMOTE_EXT_DIR/"
    scp_cmd "$EXT_DIR/extension.js" "$REMOTE_HOST:$REMOTE_EXT_DIR/"
    scp_cmd "$EXT_DIR/overlay.js" "$REMOTE_HOST:$REMOTE_EXT_DIR/"
    scp_cmd "$EXT_DIR/virtualStick.js" "$REMOTE_HOST:$REMOTE_EXT_DIR/"
    scp_cmd "$EXT_DIR/virtualButton.js" "$REMOTE_HOST:$REMOTE_EXT_DIR/"
    scp_cmd "$EXT_DIR/gamepadManager.js" "$REMOTE_HOST:$REMOTE_EXT_DIR/"
    scp_cmd "$EXT_DIR/uinputHelper.py" "$REMOTE_HOST:$REMOTE_EXT_DIR/"
    scp_cmd "$EXT_DIR/stylesheet.css" "$REMOTE_HOST:$REMOTE_EXT_DIR/"

    # Make helper executable
    ssh_cmd "chmod +x $REMOTE_EXT_DIR/uinputHelper.py"

    echo -e "${GREEN}Extension deployed successfully.${NC}"
}

cmd_enable() {
    echo -e "${YELLOW}Enabling extension...${NC}"
    ssh_cmd "gnome-extensions enable $EXT_UUID"
    echo -e "${GREEN}Extension enabled. Restart GNOME Shell to apply.${NC}"
}

cmd_disable() {
    echo -e "${YELLOW}Disabling extension...${NC}"
    ssh_cmd "gnome-extensions disable $EXT_UUID"
    echo -e "${GREEN}Extension disabled.${NC}"
}

cmd_restart() {
    echo -e "${YELLOW}Restarting GNOME Shell on test machine (Wayland - requires logout)...${NC}"
    echo -e "${RED}WARNING: This will log out the user on the test machine!${NC}"
    read -p "Continue? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ssh_cmd "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$(id -u)/bus dbus-send --session --type=method_call --dest=org.gnome.SessionManager /org/gnome/SessionManager org.gnome.SessionManager.Logout uint32:1" 2>/dev/null || true
        echo -e "${GREEN}Logout signal sent. Wait for re-login.${NC}"
    fi
}

cmd_log() {
    echo -e "${YELLOW}Showing GNOME Shell logs (Ctrl+C to stop)...${NC}"
    ssh_cmd "journalctl --user -f -g 'VirtualGamepad|virtual-gamepad' 2>/dev/null || journalctl -f -g 'VirtualGamepad|virtual-gamepad'"
}

cmd_test() {
    echo -e "${YELLOW}Testing uinput helper locally...${NC}"
    echo '{"type":"axis","axis":"ABS_X","value":0.5}' | timeout 2 python3 "$EXT_DIR/uinputHelper.py" 2>&1 || true
}

cmd_full() {
    echo -e "${YELLOW}=== Full Deploy: install + enable + restart ===${NC}"
    cmd_install
    cmd_enable
    cmd_restart
}

# Main
check_sshpass

case "${1:-full}" in
    setup)   cmd_setup ;;
    install) cmd_install ;;
    enable)  cmd_enable ;;
    disable) cmd_disable ;;
    restart) cmd_restart ;;
    log)     cmd_log ;;
    test)    cmd_test ;;
    full)    cmd_full ;;
    *)
        echo "Usage: $0 [setup|install|enable|disable|restart|log|test|full]"
        echo ""
        echo "  setup   - Setup uinput permissions on test machine"
        echo "  install - Deploy extension files to test machine"
        echo "  enable  - Enable the extension via gnome-extensions"
        echo "  disable - Disable the extension"
        echo "  restart - Restart GNOME Shell (logout on Wayland)"
        echo "  log     - Follow GNOME Shell logs on test machine"
        echo "  test    - Test uinput helper locally"
        echo "  full    - install + enable + restart (default)"
        ;;
esac
