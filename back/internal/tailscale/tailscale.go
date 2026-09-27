// Package tailscale finds the https address Tailscale Serve gives this
// server (https://<pc>.<tailnet>.ts.net), by asking the local tailscale CLI.
// Nothing here is needed to run; it only lets the admin page offer that
// address for pairing, since offline saving on the phone needs https.
package tailscale

import (
	"context"
	"encoding/json"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

var candidates = []string{"tailscale", `C:\Program Files\Tailscale\tailscale.exe`, "/Applications/Tailscale.app/Contents/MacOS/Tailscale"}

func cli() string {
	for _, c := range candidates {
		if p, err := exec.LookPath(c); err == nil {
			return p
		}
	}
	return ""
}

func run(args ...string) ([]byte, error) {
	bin := cli()
	if bin == "" {
		return nil, exec.ErrNotFound
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	hideWindow(cmd)
	return cmd.Output()
}

// HTTPSURL returns the Tailscale Serve https address that forwards to the
// given local port, or "" when Tailscale, its certificates or such a serve
// rule are missing.
func HTTPSURL(port int) string {
	out, err := run("status", "--json")
	if err != nil {
		return ""
	}
	var st struct {
		Self struct {
			DNSName string `json:"DNSName"`
		} `json:"Self"`
		CertDomains []string `json:"CertDomains"`
	}
	if json.Unmarshal(out, &st) != nil || len(st.CertDomains) == 0 {
		return ""
	}
	host := strings.TrimSuffix(st.Self.DNSName, ".")
	if host == "" {
		return ""
	}
	out, err = run("serve", "status", "--json")
	if err != nil || !ProxiesTo(out, port) {
		return ""
	}
	return "https://" + host
}

// ProxiesTo reports whether a `tailscale serve status --json` document has
// an https handler forwarding to localhost:port.
func ProxiesTo(serveStatus []byte, port int) bool {
	var cfg struct {
		Web map[string]struct {
			Handlers map[string]struct {
				Proxy string `json:"Proxy"`
			} `json:"Handlers"`
		} `json:"Web"`
	}
	if json.Unmarshal(serveStatus, &cfg) != nil {
		return false
	}
	suffix := ":" + strconv.Itoa(port)
	for hostPort, web := range cfg.Web {
		if !strings.HasSuffix(hostPort, ":443") {
			continue
		}
		for _, h := range web.Handlers {
			p := strings.TrimSuffix(h.Proxy, "/")
			if strings.HasSuffix(p, suffix) && (strings.Contains(p, "127.0.0.1") || strings.Contains(p, "localhost") || strings.HasPrefix(p, "http://:") || p == strconv.Itoa(port)) {
				return true
			}
		}
	}
	return false
}
