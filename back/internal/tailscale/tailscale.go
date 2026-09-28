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
	"sync"
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

// Address is where Tailscale publishes this server: URL is empty when it
// does not; Public means Funnel, i.e. reachable from any phone on the
// internet, not only from devices running Tailscale.
type Address struct {
	URL    string
	Public bool
}

// Cached remembers Lookup(port) for a while: asking the CLI takes a
// noticeable moment on Windows, and the answer rarely changes.
func Cached(port int, ttl time.Duration) func() Address {
	var (
		mu   sync.Mutex
		val  Address
		when time.Time
	)
	return func() Address {
		mu.Lock()
		defer mu.Unlock()
		if when.IsZero() || time.Since(when) > ttl {
			val, when = Lookup(port), time.Now()
		}
		return val
	}
}

// Lookup finds the Tailscale Serve (or Funnel) https address that forwards
// to the given local port. The URL is empty when Tailscale, its
// certificates or such a rule are missing.
func Lookup(port int) Address {
	out, err := run("status", "--json")
	if err != nil {
		return Address{}
	}
	var st struct {
		Self struct {
			DNSName string `json:"DNSName"`
		} `json:"Self"`
		CertDomains []string `json:"CertDomains"`
	}
	if json.Unmarshal(out, &st) != nil || len(st.CertDomains) == 0 {
		return Address{}
	}
	host := strings.TrimSuffix(st.Self.DNSName, ".")
	if host == "" {
		return Address{}
	}
	out, err = run("serve", "status", "--json")
	if err != nil {
		return Address{}
	}
	ok, public := Analyze(out, port)
	if !ok {
		return Address{}
	}
	return Address{URL: "https://" + host, Public: public}
}

// Analyze reads a `tailscale serve status --json` document: ok when an
// https handler forwards to localhost:port, public when Funnel is on for it.
func Analyze(serveStatus []byte, port int) (ok, public bool) {
	var cfg struct {
		Web map[string]struct {
			Handlers map[string]struct {
				Proxy string `json:"Proxy"`
			} `json:"Handlers"`
		} `json:"Web"`
		AllowFunnel map[string]bool `json:"AllowFunnel"`
	}
	if json.Unmarshal(serveStatus, &cfg) != nil {
		return false, false
	}
	suffix := ":" + strconv.Itoa(port)
	for hostPort, web := range cfg.Web {
		if !strings.HasSuffix(hostPort, ":443") {
			continue
		}
		for _, h := range web.Handlers {
			p := strings.TrimSuffix(h.Proxy, "/")
			if strings.HasSuffix(p, suffix) && (strings.Contains(p, "127.0.0.1") || strings.Contains(p, "localhost") || strings.HasPrefix(p, "http://:") || p == strconv.Itoa(port)) {
				return true, cfg.AllowFunnel[hostPort]
			}
		}
	}
	return false, false
}
