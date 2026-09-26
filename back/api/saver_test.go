package api

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"shelf/internal/library"
	"shelf/internal/saver"
)

func TestRemoteClient(t *testing.T) {
	cases := map[string]bool{
		"127.0.0.1:5000":           false, // this PC
		"[::1]:5000":               false,
		"192.168.0.23:5000":        false, // home Wi-Fi
		"10.0.0.5:5000":            false,
		"100.86.76.76:5000":        true, // Tailscale
		"[fd7a:115c:a1e0::1]:5000": true, // Tailscale IPv6
		"203.0.113.9:5000":         true, // public internet
		"[fe80::1%eth0]:5000":      false,
		"not-an-address":           false,
	}
	for addr, want := range cases {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = addr
		if got := remoteClient(r); got != want {
			t.Errorf("%s: remote=%v, want %v", addr, got, want)
		}
	}
}

// noisyPNG looks like a scanned page, so JPEG beats PNG on size.
func noisyPNG(t *testing.T, w, h int) []byte {
	img := image.NewGray(image.Rect(0, 0, w, h))
	seed := uint32(7)
	for i := range img.Pix {
		seed = seed*1664525 + 1013904223
		img.Pix[i] = uint8(128 + int(seed>>27) - 16)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func testServer(t *testing.T) (*Server, string) {
	dir := t.TempDir()
	books := filepath.Join(dir, "books")
	os.MkdirAll(filepath.Join(books, "S"), 0o755)
	var zbuf bytes.Buffer
	zw := zip.NewWriter(&zbuf)
	for _, name := range []string{"p1.png", "p2.png"} {
		f, _ := zw.Create(name)
		f.Write(noisyPNG(t, 600, 1800))
	}
	zw.Close()
	os.WriteFile(filepath.Join(books, "S", "v1.cbz"), zbuf.Bytes(), 0o644)

	lib, err := library.New(books)
	if err != nil {
		t.Fatal(err)
	}
	sv, err := saver.New(saver.Options{Dir: filepath.Join(dir, "saver"), MaxHeight: 1200, Quality: 70, Log: log.New(io.Discard, "", 0)})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{Lib: lib, Saver: sv, Log: log.New(io.Discard, "", 0), Static: fstest.MapFS{}}
	return s, "/S/v1.cbz"
}

func getPage(t *testing.T, h http.Handler, book, q, remote string) *httptest.ResponseRecorder {
	url := "/book/cbz?path=" + book + "&page=1"
	if q != "" {
		url += "&q=" + q
	}
	r := httptest.NewRequest("GET", url, nil)
	r.RemoteAddr = remote
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("%s: status %d: %s", url, w.Code, w.Body.String())
	}
	return w
}

func TestPageQualityFollowsClientAndOverride(t *testing.T) {
	s, book := testServer(t)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /book/cbz", s.comicPage("cbz"))

	// Home LAN: original PNG.
	w := getPage(t, mux, book, "", "192.168.0.23:1")
	if q := w.Header().Get("X-Shelf-Quality"); q != "original" || w.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("LAN: quality %q type %q", q, w.Header().Get("Content-Type"))
	}

	// Over Tailscale: shrunk JPEG, 1200 px tall.
	w = getPage(t, mux, book, "", "100.86.76.76:1")
	if q := w.Header().Get("X-Shelf-Quality"); q != "saver" {
		t.Fatalf("tailnet: quality %q", q)
	}
	img, err := jpeg.Decode(w.Body)
	if err != nil {
		t.Fatal(err)
	}
	if h := img.Bounds().Dy(); h != 1200 {
		t.Fatalf("saver height %d", h)
	}
	if _, gray := img.(*image.Gray); !gray {
		t.Fatalf("monochrome page should be a grayscale JPEG, got %T", img)
	}

	// The reader's setting wins in both directions.
	if q := getPage(t, mux, book, "original", "100.86.76.76:1").Header().Get("X-Shelf-Quality"); q != "original" {
		t.Fatalf("q=original over tailnet gave %q", q)
	}
	if q := getPage(t, mux, book, "saver", "192.168.0.23:1").Header().Get("X-Shelf-Quality"); q != "saver" {
		t.Fatalf("q=saver on LAN gave %q", q)
	}
}

func TestGzippedStaticAssets(t *testing.T) {
	js := []byte("console.log('hello');" + string(bytes.Repeat([]byte(" "), 2000)))
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	zw.Write(js)
	zw.Close()
	s := &Server{Static: fstest.MapFS{
		"index.html":         {Data: []byte("<html></html>")},
		"app.0123abcd.js.gz": {Data: gz.Bytes()},
	}}
	h := s.static()

	r := httptest.NewRequest("GET", "/app.0123abcd.js", nil)
	r.Header.Set("Accept-Encoding", "gzip, deflate, br")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Header().Get("Content-Encoding") != "gzip" || !bytes.Equal(w.Body.Bytes(), gz.Bytes()) {
		t.Fatalf("expected the gzipped bytes, got encoding %q", w.Header().Get("Content-Encoding"))
	}
	if ct := w.Header().Get("Content-Type"); ct != "text/javascript; charset=utf-8" {
		t.Fatalf("content type %q", ct)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Fatalf("cache control %q", cc)
	}

	// A client without gzip gets the plain file.
	r = httptest.NewRequest("GET", "/app.0123abcd.js", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Header().Get("Content-Encoding") != "" || !bytes.Equal(w.Body.Bytes(), js) {
		t.Fatal("expected decompressed content for a client without gzip")
	}
}

func TestAwayIconsAndAppName(t *testing.T) {
	s := &Server{Static: fstest.MapFS{
		"index.html":                {Data: []byte(`<!doctype html><meta name=apple-mobile-web-app-title content=shelf><title>shelf | Book</title>`)},
		"apple-touch-icon.png":      {Data: []byte("home-icon")},
		"away/apple-touch-icon.png": {Data: []byte("away-icon")},
		"manifest.webmanifest":      {Data: []byte(`{"name":"shelf"}`)},
		"away/manifest.webmanifest": {Data: []byte(`{"name":"shelf 外"}`)},
		"favicon.png":               {Data: []byte("home-fav")},
	}}
	h := s.static()
	get := func(url, remote string) string {
		r := httptest.NewRequest("GET", url, nil)
		r.RemoteAddr = remote
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Body.String()
	}
	const home, away = "192.168.0.23:1", "100.86.76.76:1"

	if got := get("/apple-touch-icon.png", home); got != "home-icon" {
		t.Fatalf("home icon: %q", got)
	}
	if got := get("/apple-touch-icon.png", away); got != "away-icon" {
		t.Fatalf("away icon: %q", got)
	}
	if got := get("/manifest.webmanifest", away); got != `{"name":"shelf 外"}` {
		t.Fatalf("away manifest: %q", got)
	}
	// The reader chose the home icon explicitly.
	if got := get("/apple-touch-icon.png?v=home", away); got != "home-icon" {
		t.Fatalf("explicit home icon: %q", got)
	}
	// Files without an away variant fall back to the normal one.
	if got := get("/favicon.png", away); got != "home-fav" {
		t.Fatalf("away favicon fallback: %q", got)
	}
	// The app name suggested for the home screen differs too.
	if got := get("/", away); !strings.Contains(got, `content="shelf 外"`) {
		t.Fatalf("away index: %s", got)
	}
	if got := get("/series", home); !strings.Contains(got, `content=shelf>`) {
		t.Fatalf("home index should be untouched: %s", got)
	}
}
