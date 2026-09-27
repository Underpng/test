package tailscale

import "testing"

func TestProxiesTo(t *testing.T) {
	doc := []byte(`{"TCP":{"443":{"HTTPS":true}},"Web":{"pc.tail1234.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:50080"}}}}}`)
	if !ProxiesTo(doc, 50080) {
		t.Error("serve rule for our port not recognised")
	}
	if ProxiesTo(doc, 8080) {
		t.Error("another port matched")
	}
	if ProxiesTo([]byte(`{}`), 50080) || ProxiesTo([]byte(`not json`), 50080) {
		t.Error("empty or broken config matched")
	}
	other := []byte(`{"Web":{"pc.tail1234.ts.net:8443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:50080"}}}}}`)
	if ProxiesTo(other, 50080) {
		t.Error("non-443 listener matched")
	}
}
