//go:build windows

package archive

import (
	"os/exec"
	"syscall"
)

// hideWindow stops child processes from flashing a console window.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
