package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"rsc.io/qr"

	"shelf/internal/auth"
)

const sessionCookie = "shelf_session"

// Headers that reverse proxies and tunnels (Tailscale Funnel, Cloudflare
// Tunnel, nginx...) add. A request carrying any of them came from outside
// even though the TCP connection is from this PC.
var proxyHeaders = []string{
	"X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "Forwarded",
	"X-Real-Ip", "Cf-Connecting-Ip", "Tailscale-Funnel-Request",
}

func remoteIP(r *http.Request) net.IP {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if i := strings.IndexByte(host, '%'); i >= 0 {
		host = host[:i]
	}
	return net.ParseIP(host)
}

// proxied reports whether the request arrived through a local proxy or
// tunnel (loopback connection carrying forwarding headers).
func proxied(r *http.Request) bool {
	ip := remoteIP(r)
	if ip == nil || !ip.IsLoopback() {
		return false
	}
	for _, h := range proxyHeaders {
		if r.Header.Get(h) != "" {
			return true
		}
	}
	return false
}

func localHost(host string) bool {
	h, _, err := net.SplitHostPort(host)
	if err != nil {
		h = host
	}
	h = strings.Trim(strings.ToLower(h), "[]")
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

// isLocalAdmin: the request is from a browser on this PC itself. The
// admin page and pairing QR codes are only reachable this way; checking
// the Host header as well defeats DNS-rebinding pages.
func isLocalAdmin(r *http.Request) bool {
	ip := remoteIP(r)
	return ip != nil && ip.IsLoopback() && !proxied(r) && localHost(r.Host)
}

// trustedNetwork: this PC, the home LAN, or the user's Tailscale network,
// reached directly (not through a public tunnel).
func trustedNetwork(r *http.Request) bool {
	if proxied(r) {
		return false
	}
	ip := remoteIP(r)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || tailnet4.Contains(ip) || tailnet6.Contains(ip)
}

func requestIsHTTPS(r *http.Request) bool {
	return r.TLS != nil || (proxied(r) && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"))
}

func (s *Server) session(r *http.Request) (*auth.Device, bool) {
	if s.Auth == nil {
		return nil, false
	}
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil, false
	}
	return s.Auth.Lookup(c.Value)
}

// allowed decides whether a request may read the library.
func (s *Server) allowed(r *http.Request) bool {
	if s.Auth == nil || isLocalAdmin(r) {
		return true
	}
	if trustedNetwork(r) && s.Auth.LANNoLogin() {
		return true
	}
	_, ok := s.session(r)
	return ok
}

// guard applies the access rules in front of every route.
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch {
		case strings.HasPrefix(p, "/api/admin/"):
			if s.Auth == nil || !isLocalAdmin(r) {
				writeJSONStatus(w, http.StatusForbidden, map[string]string{"error": "admin_only"})
				return
			}
			// State-changing admin calls need a custom header: a web page
			// on another site cannot send it without a CORS preflight,
			// which this server never approves.
			if r.Method != http.MethodGet && r.Header.Get("X-Shelf-Admin") != "1" {
				writeJSONStatus(w, http.StatusForbidden, map[string]string{"error": "admin_header"})
				return
			}
		case strings.HasPrefix(p, "/api/auth/"):
			// login, pairing and status are open to everyone
		case strings.HasPrefix(p, "/api/"), strings.HasPrefix(p, "/book/"), strings.HasPrefix(p, "/cover/"):
			if !s.allowed(r) {
				writeJSONStatus(w, http.StatusUnauthorized, map[string]string{"error": "login_required"})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSONStatus(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 16<<10)
	return json.NewDecoder(r.Body).Decode(v)
}

func (s *Server) setSession(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   int(auth.SessionTTL / time.Second),
		HttpOnly: true,
		Secure:   requestIsHTTPS(r),
		SameSite: http.SameSiteLaxMode,
	})
}

// deviceName guesses a readable name from the User-Agent.
func deviceName(r *http.Request) string {
	ua := r.UserAgent()
	for _, k := range []string{"iPhone", "iPad", "Android", "Windows", "Macintosh", "Linux"} {
		if strings.Contains(ua, k) {
			if k == "Macintosh" {
				return "Mac"
			}
			return k
		}
	}
	return "端末"
}

// ----- /api/auth -----

func (s *Server) authStatus(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{
		"enabled":       s.Auth != nil,
		"authenticated": s.allowed(r),
		"admin":         isLocalAdmin(r),
		"passwordSet":   s.Auth != nil && s.Auth.PasswordSet(),
	}
	if d, ok := s.session(r); ok {
		out["device"] = map[string]string{"id": d.ID, "name": d.Name}
	}
	writeJSON(w, out)
}

type loginRequest struct {
	Password string `json:"password"`
	Code     string `json:"code"`
	Name     string `json:"name"`
}

func (s *Server) authLogin(w http.ResponseWriter, r *http.Request) {
	if s.Auth == nil {
		writeJSONStatus(w, http.StatusNotFound, map[string]string{"error": "disabled"})
		return
	}
	var req loginRequest
	if err := readJSON(r, &req); err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]string{"error": "bad_request"})
		return
	}
	switch err := s.Auth.CheckPassword(req.Password); {
	case errors.Is(err, auth.ErrNoPassword):
		writeJSONStatus(w, http.StatusBadRequest, map[string]string{"error": "no_password"})
		return
	case err != nil:
		writeJSONStatus(w, http.StatusUnauthorized, map[string]string{"error": "bad_password"})
		return
	}
	s.startSession(w, r, req.Name)
}

func (s *Server) authPair(w http.ResponseWriter, r *http.Request) {
	if s.Auth == nil {
		writeJSONStatus(w, http.StatusNotFound, map[string]string{"error": "disabled"})
		return
	}
	var req loginRequest
	if err := readJSON(r, &req); err != nil || req.Code == "" {
		writeJSONStatus(w, http.StatusBadRequest, map[string]string{"error": "bad_request"})
		return
	}
	if err := s.Auth.UsePairCode(req.Code); err != nil {
		writeJSONStatus(w, http.StatusUnauthorized, map[string]string{"error": "bad_code"})
		return
	}
	s.startSession(w, r, req.Name)
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, name string) {
	if strings.TrimSpace(name) == "" {
		name = deviceName(r)
	}
	token, d, err := s.Auth.NewSession(name)
	if err != nil {
		s.fail(w, 500, "cannot save session", err)
		return
	}
	s.setSession(w, r, token)
	writeJSON(w, map[string]any{"ok": true, "device": map[string]string{"id": d.ID, "name": d.Name}})
}

func (s *Server) authLogout(w http.ResponseWriter, r *http.Request) {
	if d, ok := s.session(r); ok {
		s.Auth.Revoke(d.ID)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, map[string]bool{"ok": true})
}

// ----- /api/admin (this PC only) -----

type link struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

// baseURLs lists the addresses a phone can use to reach the server.
func (s *Server) baseURLs() []link {
	var out []link
	if s.PublicURL != "" {
		out = append(out, link{Label: "公開 URL（家の外からも使える）", URL: strings.TrimRight(s.PublicURL, "/")})
	}
	for _, a := range s.LANURLs {
		out = append(out, link{Label: "LAN内/Wi-Fi", URL: a})
	}
	return out
}

func (s *Server) adminState(w http.ResponseWriter, r *http.Request) {
	devices := []map[string]any{}
	for _, d := range s.Auth.Devices() {
		devices = append(devices, map[string]any{"id": d.ID, "name": d.Name, "created": d.Created, "lastSeen": d.LastSeen})
	}
	writeJSON(w, map[string]any{
		"passwordSet": s.Auth.PasswordSet(),
		"lanNoLogin":  s.Auth.LANNoLogin(),
		"devices":     devices,
		"addresses":   s.baseURLs(),
	})
}

func (s *Server) adminPair(w http.ResponseWriter, r *http.Request) {
	code, exp := s.Auth.NewPairCode()
	links := []link{}
	for _, b := range s.baseURLs() {
		links = append(links, link{Label: b.Label, URL: b.URL + "/pair?code=" + code})
	}
	writeJSON(w, map[string]any{"code": code, "expires": exp, "links": links})
}

// adminQR renders text as an SVG QR code (used for pairing links).
func (s *Server) adminQR(w http.ResponseWriter, r *http.Request) {
	text := r.URL.Query().Get("text")
	if text == "" || len(text) > 500 {
		http.Error(w, "bad text", 400)
		return
	}
	code, err := qr.Encode(text, qr.M)
	if err != nil {
		http.Error(w, "cannot encode", 500)
		return
	}
	const quiet = 4
	n := code.Size + quiet*2
	var b strings.Builder
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges"><rect width="%d" height="%d" fill="#fff"/><path fill="#000" d="`, n, n, n, n)
	for y := 0; y < code.Size; y++ {
		for x := 0; x < code.Size; x++ {
			if code.Black(x, y) {
				fmt.Fprintf(&b, "M%d %dh1v1h-1z", x+quiet, y+quiet)
			}
		}
	}
	b.WriteString(`"/></svg>`)
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(b.String()))
}

func (s *Server) adminPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]string{"error": "bad_request"})
		return
	}
	if req.Password != "" && len([]rune(req.Password)) < 8 {
		writeJSONStatus(w, http.StatusBadRequest, map[string]string{"error": "too_short"})
		return
	}
	if err := s.Auth.SetPassword(req.Password); err != nil {
		s.fail(w, 500, "cannot save password", err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true, "passwordSet": req.Password != ""})
}

func (s *Server) adminLAN(w http.ResponseWriter, r *http.Request) {
	var req struct {
		NoLogin bool `json:"noLogin"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]string{"error": "bad_request"})
		return
	}
	if err := s.Auth.SetLANNoLogin(req.NoLogin); err != nil {
		s.fail(w, 500, "cannot save", err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) adminRevoke(w http.ResponseWriter, r *http.Request) {
	if err := s.Auth.Revoke(r.PathValue("id")); err != nil {
		s.fail(w, 500, "cannot save", err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}
