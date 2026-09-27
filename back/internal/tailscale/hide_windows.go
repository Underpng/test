package tailscale

import (
	"os/exec"
	"syscall"
)

// hideWindow keeps the console window of the CLI from flashing up when the
// server runs without one (shelfw.exe).
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}
