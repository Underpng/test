package tailscale

import (
	"net/netip"
	"testing"
	"time"
)

func TestParseNetcheck(t *testing.T) {
	v4, v6, ok := parseNetcheck([]byte(`{"GlobalV4":"14.10.40.129:63324","GlobalV6":"[240b:250:2881:7500:754d:608f:28b6:981d]:55727"}`))
	if !ok || v4.String() != "14.10.40.129" || v6.String() != "240b:250:2881:7500:754d:608f:28b6:981d" {
		t.Fatalf("got %v %v %v", v4, v6, ok)
	}
	if _, _, ok := parseNetcheck([]byte(`{"GlobalV4":"","GlobalV6":""}`)); ok {
		t.Error("no addresses should not be ok")
	}
}

func TestHomeContains(t *testing.T) {
	h := &Home{every: time.Hour, check: func() (netip.Addr, netip.Addr, bool) {
		return netip.MustParseAddr("14.10.40.129"), netip.MustParseAddr("240b:250:2881:7500:754d:608f:28b6:981d"), true
	}}
	h.refresh()
	for i := 0; i < 100 && h.running.Load(); i++ {
		time.Sleep(10 * time.Millisecond)
	}
	cases := map[string]bool{
		"14.10.40.129":                           true,  // same router
		"::ffff:14.10.40.129":                    true,  // v4-mapped
		"14.10.40.130":                           false, // neighbour
		"240b:250:2881:7500:1234:5678:9abc:def0": true,  // same home /64
		"240b:250:2881:7501::1":                  false, // another network
	}
	for ip, want := range cases {
		if got := h.Contains(netip.MustParseAddr(ip)); got != want {
			t.Errorf("%s: %v, want %v", ip, got, want)
		}
	}
}
