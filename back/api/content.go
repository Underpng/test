package api

import (
	"bytes"
	"compress/gzip"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"shelf/internal/archive"
	"shelf/internal/library"
	"shelf/internal/saver"
)

const pageCache = "public, max-age=86400"

// resolveBook validates ?path= and returns the filesystem path.
func (s *Server) resolveBook(w http.ResponseWriter, r *http.Request) (string, os.FileInfo, bool) {
	p := bookPath(r)
	if p == "" || p == "/" {
		http.Error(w, "missing path", 400)
		return "", nil, false
	}
	abs, err := s.Lib.Abs(p)
	if err != nil {
		http.Error(w, "invalid path", 400)
		return "", nil, false
	}
	info, err := os.Stat(abs)
	if err != nil || info.IsDir() {
		http.Error(w, "not found", 404)
		return "", nil, false
	}
	return abs, info, true
}

// wholeFile streams an EPUB or PDF with range support.
func (s *Server) wholeFile(mime string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		abs, info, ok := s.resolveBook(w, r)
		if !ok {
			return
		}
		f, err := os.Open(abs)
		if err != nil {
			s.fail(w, 500, "open failed", err)
			return
		}
		defer f.Close()
		w.Header().Set("Content-Type", mime)
		w.Header().Set("Cache-Control", pageCache)
		http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	}
}

func pageParam(r *http.Request) int {
	n, _ := strconv.Atoi(r.URL.Query().Get("page"))
	return n
}

func servePage(w http.ResponseWriter, r *http.Request, name string, mod time.Time, data []byte) {
	mime, _ := library.ImageMime(name)
	if mime == "" {
		mime = http.DetectContentType(data)
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", pageCache)
	http.ServeContent(w, r, path.Base(name), mod, bytes.NewReader(data))
}

// comicPages reports how many pages a CBZ/CBR has.
func (s *Server) comicPages(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		abs, _, ok := s.resolveBook(w, r)
		if !ok {
			return
		}
		book, err := archive.Open(kind, s.SevenZip, abs)
		if err != nil {
			s.fail(w, 500, "cannot read archive", err)
			return
		}
		defer book.Close()
		writeJSON(w, map[string]int{"pages": book.Len()})
	}
}

// comicPage serves one page, shrunk for the phone when data saving applies.
func (s *Server) comicPage(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		abs, info, ok := s.resolveBook(w, r)
		if !ok {
			return
		}
		book, err := archive.Open(kind, s.SevenZip, abs)
		if err != nil {
			s.fail(w, 500, "cannot read archive", err)
			return
		}
		defer book.Close()
		n := pageParam(r)
		if n < 1 || n > book.Len() {
			http.Error(w, "invalid page number", 400)
			return
		}

		if s.Saver != nil && s.wantSaver(r) {
			id := bookPath(r) + "|" + strconv.FormatInt(info.ModTime().UnixNano(), 10) + "|" + strconv.FormatInt(info.Size(), 10)
			src := saver.Source{ID: id, Open: func() (archive.Book, error) { return archive.Open(kind, s.SevenZip, abs) }}
			pg, err := s.Saver.Get(src, n, book)
			if err != nil {
				s.fail(w, 500, "cannot read page", err)
				return
			}
			w.Header().Set("X-Shelf-Quality", "saver")
			w.Header().Set("Content-Type", pg.Mime)
			w.Header().Set("Cache-Control", pageCache)
			http.ServeContent(w, r, "", info.ModTime(), bytes.NewReader(pg.Data))
			return
		}

		data, name, err := book.Page(n - 1)
		if err != nil {
			s.fail(w, 500, "cannot read page", err)
			return
		}
		w.Header().Set("X-Shelf-Quality", "original")
		servePage(w, r, name, info.ModTime(), data)
	}
}

// wantSaver decides the page quality: ?q=saver or ?q=original come from
// the reader settings, otherwise it depends on where the request is from.
func (s *Server) wantSaver(r *http.Request) bool {
	switch r.URL.Query().Get("q") {
	case "saver":
		return true
	case "original":
		return false
	}
	return remoteClient(r)
}

var tailnet4 = mustCIDR("100.64.0.0/10")       // Tailscale (CGNAT range)
var tailnet6 = mustCIDR("fd7a:115c:a1e0::/48") // Tailscale IPv6

func mustCIDR(s string) *net.IPNet {
	_, n, err := net.ParseCIDR(s)
	if err != nil {
		panic(err)
	}
	return n
}

// remoteClient reports whether the request comes from outside the home
// LAN: over Tailscale or from a public address. Loopback and private LAN
// addresses count as home.
func remoteClient(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	switch {
	case ip.IsLoopback():
		return false
	case tailnet4.Contains(ip), tailnet6.Contains(ip):
		return true
	case ip.IsPrivate(), ip.IsLinkLocalUnicast():
		return false
	}
	return true
}

// client tells the reader which quality "auto" resolves to right now.
func (s *Server) client(w http.ResponseWriter, r *http.Request) {
	remote := remoteClient(r)
	writeJSON(w, map[string]bool{"remote": remote, "saver": remote && s.Saver != nil})
}

func (s *Server) cover(w http.ResponseWriter, r *http.Request) {
	abs, err := library.Resolve(s.CoverDir, r.PathValue("path"))
	if err != nil {
		http.Error(w, "invalid path", 400)
		return
	}
	info, err := os.Stat(abs)
	if err != nil || info.IsDir() {
		http.Error(w, "not found", 404)
		return
	}
	f, err := os.Open(abs)
	if err != nil {
		http.Error(w, "not found", 404)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", pageCache)
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

// Build outputs carry a content hash (Farm: "name.<8hex>.js" for code,
// "name.<8hex>-<6hex>.jpg" for imported assets), so they never change.
var hashedAsset = regexp.MustCompile(`\.[0-9a-f]{8}(-[0-9a-f]{6})?\.(js|css|map|jpg|png|webp|svg|wasm)$`)

// static serves the embedded frontend, falling back to index.html so the
// client-side router owns every unknown path.
func (s *Server) static() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if p == "" || p == "index.html" {
			s.serveIndex(w, r)
			return
		}
		// Readers away from home get their own icons and app name, so the
		// home-screen shortcut added over Tailscale looks different from
		// the one added on the home Wi-Fi.
		// An explicit ?v=home (the reader picked the home icon) wins.
		if remoteClient(r) && r.URL.Query().Get("v") != "home" && !strings.HasPrefix(p, awayDir+"/") {
			if f, err := s.Static.Open(awayDir + "/" + p); err == nil {
				f.Close()
				w.Header().Set("Cache-Control", "public, max-age=3600")
				http.ServeFileFS(w, r, s.Static, awayDir+"/"+p)
				return
			}
		}
		if f, err := s.Static.Open(p); err == nil {
			f.Close()
			setStaticCache(w, p)
			http.ServeFileFS(w, r, s.Static, p)
			return
		}
		// The build stores compressible assets gzipped only (build.ps1).
		if gz, err := fs.ReadFile(s.Static, p+".gz"); err == nil {
			setStaticCache(w, p)
			serveGzipped(w, r, p, gz)
			return
		}
		if path.Ext(p) != "" {
			http.NotFound(w, r)
			return
		}
		s.serveIndex(w, r)
	})
}

// awayDir holds the icon and manifest variants for readers away from home.
const awayDir = "away"

var appTitleMeta = regexp.MustCompile(`<meta\s+name=["']?apple-mobile-web-app-title["']?\s+content=(?:"[^"]*"|'[^']*'|[^\s>]+)\s*/?>`)

// serveIndex sends the app shell. For readers away from home the default
// home-screen name becomes "shelf 外".
func (s *Server) serveIndex(w http.ResponseWriter, r *http.Request) {
	html, err := fs.ReadFile(s.Static, "index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if remoteClient(r) {
		html = appTitleMeta.ReplaceAll(html, []byte(`<meta name="apple-mobile-web-app-title" content="shelf 外">`))
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	if r.Method != http.MethodHead {
		w.Write(html)
	}
}

func setStaticCache(w http.ResponseWriter, p string) {
	switch {
	case p == "index.html":
		w.Header().Set("Cache-Control", "no-cache")
	case hashedAsset.MatchString(p):
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	default:
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
}

// serveGzipped sends a precompressed asset as is to clients that accept
// gzip (every browser) and decompresses it for the rest.
func serveGzipped(w http.ResponseWriter, r *http.Request, name string, gz []byte) {
	ctype := mime.TypeByExtension(path.Ext(name))
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	h := w.Header()
	h.Set("Content-Type", ctype)
	h.Add("Vary", "Accept-Encoding")
	if acceptsGzip(r) {
		h.Set("Content-Encoding", "gzip")
		h.Set("Content-Length", strconv.Itoa(len(gz)))
		if r.Method != http.MethodHead {
			w.Write(gz)
		}
		return
	}
	zr, err := gzip.NewReader(bytes.NewReader(gz))
	if err != nil {
		http.Error(w, "corrupt asset", 500)
		return
	}
	defer zr.Close()
	if r.Method != http.MethodHead {
		io.Copy(w, zr)
	}
}

func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		enc, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if !strings.EqualFold(strings.TrimSpace(enc), "gzip") {
			continue
		}
		q := strings.ReplaceAll(params, " ", "")
		if q == "q=0" || q == "q=0.0" || q == "q=0.00" || q == "q=0.000" {
			return false
		}
		return true
	}
	return false
}

func nowUnix() int64 { return time.Now().Unix() }
