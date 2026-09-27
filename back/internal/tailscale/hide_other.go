//go:build !windows

package tailscale

import "os/exec"

func hideWindow(*exec.Cmd) {}
