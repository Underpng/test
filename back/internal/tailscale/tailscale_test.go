package tailscale

import "testing"

func TestAnalyze(t *testing.T) {
	serve := []byte(`{"TCP":{"443":{"HTTPS":true}},"Web":{"pc.tail1234.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:50080"}}}}}`)
	funnel := []byte(`{"TCP":{"443":{"HTTPS":true}},"Web":{"pc.tail1234.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:50080"}}}},"AllowFunnel":{"pc.tail1234.ts.net:443":true}}`)
	if ok, public := Analyze(serve, 50080); !ok || public {
		t.Errorf("serve: ok=%v public=%v, want true false", ok, public)
	}
	if ok, public := Analyze(funnel, 50080); !ok || !public {
		t.Errorf("funnel: ok=%v public=%v, want true true", ok, public)
	}
	if ok, _ := Analyze(serve, 8080); ok {
		t.Error("another port matched")
	}
	if ok, _ := Analyze([]byte(`{}`), 50080); ok {
		t.Error("empty config matched")
	}
	if ok, _ := Analyze([]byte(`not json`), 50080); ok {
		t.Error("broken config matched")
	}
	other := []byte(`{"Web":{"pc.tail1234.ts.net:8443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:50080"}}}}}`)
	if ok, _ := Analyze(other, 50080); ok {
		t.Error("non-443 listener matched")
	}
}
