package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"shelf/internal/auth"
)

type req struct {
	method, path, remote, host string
	headers                    map[string]string
	body                       string
	cookie                     *http.Cookie
}

func authServer(t *testing.T) (*Server, http.Handler) {
	st, err := auth.Open(filepath.Join(t.TempDir(), "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{Auth: st, Log: log.New(io.Discard, "", 0), Static: fstest.MapFS{"index.html": {Data: []byte("<html></html>")}}, LANURLs: []string{"http://192.168.0.115:50080"}}
	return s, s.Handler()
}

func do(t *testing.T, h http.Handler, q req) *httptest.ResponseRecorder {
	t.Helper()
	var body io.Reader
	if q.body != "" {
		body = strings.NewReader(q.body)
	}
	r := httptest.NewRequest(q.method, q.path, body)
	r.RemoteAddr = q.remote
	if q.host != "" {
		r.Host = q.host
	}
	for k, v := range q.headers {
		r.Header.Set(k, v)
	}
	if q.cookie != nil {
		r.AddCookie(q.cookie)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

const (
	thisPC = "127.0.0.1:50000"
	lan    = "192.168.0.23:5000"
	tailnt = "100.86.76.76:5000"
	public = "203.0.113.9:5000"
)

// A tunnel (Funnel, Cloudflare Tunnel) connects from this PC but adds
// forwarding headers and keeps the public host name.
var viaTunnel = map[string]string{"X-Forwarded-For": "198.51.100.7", "X-Forwarded-Proto": "https"}

func TestAccessRules(t *testing.T) {
	s, h := authServer(t)
	get := func(remote, host string, headers map[string]string) int {
		return do(t, h, req{method: "GET", path: "/api/client", remote: remote, host: host, headers: headers}).Code
	}

	// Default: this PC, the home LAN and Tailscale need no login.
	for _, c := range []struct {
		name   string
		remote string
	}{{"this PC", thisPC}, {"LAN", lan}, {"tailnet", tailnt}} {
		if code := get(c.remote, "localhost:50080", nil); code != 200 {
			t.Errorf("%s: %d, want 200", c.name, code)
		}
	}
	// Through a public tunnel, or straight from the internet: login needed.
	if code := get(thisPC, "pc.example.ts.net", viaTunnel); code != 401 {
		t.Errorf("tunnel: %d, want 401", code)
	}
	if code := get(thisPC, "localhost:50080", map[string]string{"Tailscale-Funnel-Request": "?1"}); code != 401 {
		t.Errorf("funnel header alone: %d, want 401", code)
	}
	if code := get(public, "example.com", nil); code != 401 {
		t.Errorf("public: %d, want 401", code)
	}

	// Turning the LAN exemption off requires login on the LAN too, but
	// never locks this PC out.
	s.Auth.SetLANNoLogin(false)
	if code := get(lan, "192.168.0.115:50080", nil); code != 401 {
		t.Errorf("LAN with login required: %d, want 401", code)
	}
	if code := get(thisPC, "localhost:50080", nil); code != 200 {
		t.Errorf("this PC must always work: %d", code)
	}

	// Static files (the login page itself) stay reachable.
	if code := do(t, h, req{method: "GET", path: "/", remote: public, host: "example.com"}).Code; code != 200 {
		t.Errorf("app shell: %d, want 200", code)
	}
}

func TestAdminOnlyFromThisPC(t *testing.T) {
	_, h := authServer(t)
	admin := func(remote, host string, headers map[string]string) int {
		return do(t, h, req{method: "GET", path: "/api/admin/state", remote: remote, host: host, headers: headers}).Code
	}
	if code := admin(thisPC, "localhost:50080", nil); code != 200 {
		t.Fatalf("this PC: %d", code)
	}
	for name, c := range map[string]struct {
		remote, host string
		headers      map[string]string
	}{
		"LAN":                {lan, "192.168.0.115:50080", nil},
		"tailnet":            {tailnt, "pc:50080", nil},
		"tunnel":             {thisPC, "pc.example.ts.net", viaTunnel},
		"tunnel, local host": {thisPC, "localhost:50080", viaTunnel},
		"DNS rebinding":      {thisPC, "evil.example:50080", nil},
		"Cloudflare header":  {thisPC, "localhost:50080", map[string]string{"Cf-Connecting-Ip": "198.51.100.7"}},
		"public":             {public, "localhost:50080", nil},
	} {
		if code := admin(c.remote, c.host, c.headers); code != 403 {
			t.Errorf("%s: %d, want 403", name, code)
		}
	}
	// Changes need the custom header (blocks cross-site form posts).
	if code := do(t, h, req{method: "POST", path: "/api/admin/pair", remote: thisPC, host: "localhost:50080"}).Code; code != 403 {
		t.Errorf("admin POST without header: %d, want 403", code)
	}
}

func TestPasswordLoginAndPairing(t *testing.T) {
	_, h := authServer(t)
	adminHdr := map[string]string{"X-Shelf-Admin": "1", "Content-Type": "application/json"}

	// Set a password on this PC.
	if w := do(t, h, req{method: "POST", path: "/api/admin/password", remote: thisPC, host: "localhost", headers: adminHdr, body: `{"password":"short"}`}); w.Code != 400 {
		t.Fatalf("short password accepted: %d", w.Code)
	}
	if w := do(t, h, req{method: "POST", path: "/api/admin/password", remote: thisPC, host: "localhost", headers: adminHdr, body: `{"password":"manga-night-42"}`}); w.Code != 200 {
		t.Fatalf("set password: %d %s", w.Code, w.Body)
	}

	remote := func(q req) *httptest.ResponseRecorder {
		q.remote, q.host = thisPC, "pc.example.ts.net"
		hs := map[string]string{"Content-Type": "application/json"}
		for k, v := range viaTunnel {
			hs[k] = v
		}
		q.headers = hs
		return do(t, h, q)
	}

	if w := remote(req{method: "POST", path: "/api/auth/login", body: `{"password":"wrong"}`}); w.Code != 401 {
		t.Fatalf("wrong password: %d", w.Code)
	}
	w := remote(req{method: "POST", path: "/api/auth/login", body: `{"password":"manga-night-42","name":"my phone"}`})
	if w.Code != 200 {
		t.Fatalf("login: %d %s", w.Code, w.Body)
	}
	cookie := w.Result().Cookies()[0]
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("session cookie flags: %+v", cookie)
	}
	if code := remote(req{method: "GET", path: "/api/client", cookie: cookie}).Code; code != 200 {
		t.Fatalf("with session: %d", code)
	}
	var st map[string]any
	json.Unmarshal(remote(req{method: "GET", path: "/api/auth/status", cookie: cookie}).Body.Bytes(), &st)
	if st["authenticated"] != true || st["device"].(map[string]any)["name"] != "my phone" {
		t.Fatalf("status: %v", st)
	}

	// Pairing: a code from this PC logs a new device in exactly once.
	w = do(t, h, req{method: "POST", path: "/api/admin/pair", remote: thisPC, host: "localhost", headers: adminHdr})
	var pair struct {
		Code  string `json:"code"`
		Links []link `json:"links"`
	}
	json.Unmarshal(w.Body.Bytes(), &pair)
	if pair.Code == "" || len(pair.Links) == 0 || !strings.Contains(pair.Links[0].URL, "/pair?code="+pair.Code) {
		t.Fatalf("pair response: %s", w.Body)
	}
	body, _ := json.Marshal(map[string]string{"code": pair.Code})
	if w := remote(req{method: "POST", path: "/api/auth/pair", body: string(body)}); w.Code != 200 {
		t.Fatalf("pair: %d %s", w.Code, w.Body)
	}
	if w := remote(req{method: "POST", path: "/api/auth/pair", body: string(body)}); w.Code != 401 {
		t.Fatalf("code reuse: %d", w.Code)
	}

	// Logging out ends the session.
	remote(req{method: "POST", path: "/api/auth/logout", cookie: cookie})
	if code := remote(req{method: "GET", path: "/api/client", cookie: cookie}).Code; code != 401 {
		t.Fatalf("after logout: %d", code)
	}

	// The QR code renders as SVG.
	qrw := do(t, h, req{method: "GET", path: "/api/admin/qr?text=" + pair.Links[0].URL, remote: thisPC, host: "localhost"})
	if qrw.Code != 200 || !bytes.HasPrefix(qrw.Body.Bytes(), []byte("<svg")) {
		t.Fatalf("qr: %d", qrw.Code)
	}
}
