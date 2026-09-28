package tailscale

import (
	"encoding/json"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"
)

// Home knows this PC's public internet address, so a reader coming in
// through Funnel from the same address can be recognised as being at home
// (same router): full-quality pages and the home icon, with one URL.
//
// It is only a convenience hint, never a permission: a public IPv4 address
// can be shared with other households (v6 plus / MAP-E, carrier NAT).
//
// The address comes from `tailscale netcheck` (about 5 s, a few STUN
// packets), at most once per refresh interval and always in the
// background: a request never waits for it.
type Home struct {
	every time.Duration
	check func() (v4 netip.Addr, v6 netip.Addr, ok bool)

	mu      sync.RWMutex
	v4      netip.Addr
	v6      netip.Prefix // the home network's /64
	checked time.Time

	running atomic.Bool
}

// NewHome starts learning the public address right away.
func NewHome(every time.Duration) *Home {
	h := &Home{every: every, check: netcheck}
	h.refresh()
	return h
}

// Contains reports whether ip is this PC's public address (IPv4), or in its
// network (same IPv6 /64). It starts a background refresh when the known
// address is getting old.
func (h *Home) Contains(ip netip.Addr) bool {
	h.mu.RLock()
	v4, v6, checked := h.v4, h.v6, h.checked
	h.mu.RUnlock()
	if time.Since(checked) > h.every {
		h.refresh()
	}
	ip = ip.Unmap()
	switch {
	case ip.Is4():
		return v4.IsValid() && ip == v4
	case ip.Is6():
		return v6.IsValid() && v6.Contains(ip)
	}
	return false
}

func (h *Home) refresh() {
	if !h.running.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer h.running.Store(false)
		v4, v6, ok := h.check()
		h.mu.Lock()
		defer h.mu.Unlock()
		h.checked = time.Now()
		if !ok {
			return // keep the last known address
		}
		h.v4 = v4
		h.v6 = netip.Prefix{}
		if v6.IsValid() {
			h.v6, _ = v6.Prefix(64)
		}
	}()
}

func netcheck() (netip.Addr, netip.Addr, bool) {
	out, err := runFor(15*time.Second, "netcheck", "--format=json")
	if err != nil {
		return netip.Addr{}, netip.Addr{}, false
	}
	return parseNetcheck(out)
}

func parseNetcheck(out []byte) (v4, v6 netip.Addr, ok bool) {
	var r struct {
		GlobalV4 string `json:"GlobalV4"`
		GlobalV6 string `json:"GlobalV6"`
	}
	if json.Unmarshal(out, &r) != nil {
		return
	}
	if ap, err := netip.ParseAddrPort(r.GlobalV4); err == nil {
		v4 = ap.Addr().Unmap()
	}
	if ap, err := netip.ParseAddrPort(r.GlobalV6); err == nil {
		v6 = ap.Addr()
	}
	return v4, v6, v4.IsValid() || v6.IsValid()
}
