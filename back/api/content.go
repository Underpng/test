package api

import (
	"bytes"
	"net/http"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"shelf/internal/archive"
	"shelf/internal/library"
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

func (s *Server) cbzPages(w http.ResponseWriter, r *http.Request) {
	abs, _, ok := s.resolveBook(w, r)
	if !ok {
		return
	}
	z, err := archive.OpenZip(abs)
	if err != nil {
		s.fail(w, 500, "cannot read archive", err)
		return
	}
	defer z.Close()
	writeJSON(w, map[string]int{"pages": len(z.Pages)})
}

func (s *Server) cbzPage(w http.ResponseWriter, r *http.Request) {
	abs, info, ok := s.resolveBook(w, r)
	if !ok {
		return
	}
	z, err := archive.OpenZip(abs)
	if err != nil {
		s.fail(w, 500, "cannot read archive", err)
		return
	}
	defer z.Close()
	n := pageParam(r)
	if n < 1 || n > len(z.Pages) {
		http.Error(w, "invalid page number", 400)
		return
	}
	data, name, err := z.Page(n - 1)
	if err != nil {
		s.fail(w, 500, "cannot read page", err)
		return
	}
	servePage(w, r, name, info.ModTime(), data)
}

func (s *Server) cbrPages(w http.ResponseWriter, r *http.Request) {
	abs, _, ok := s.resolveBook(w, r)
	if !ok {
		return
	}
	rar, err := archive.OpenRar(s.SevenZip, abs)
	if err != nil {
		s.fail(w, 500, "cannot read archive", err)
		return
	}
	writeJSON(w, map[string]int{"pages": len(rar.Pages)})
}

func (s *Server) cbrPage(w http.ResponseWriter, r *http.Request) {
	abs, info, ok := s.resolveBook(w, r)
	if !ok {
		return
	}
	rar, err := archive.OpenRar(s.SevenZip, abs)
	if err != nil {
		s.fail(w, 500, "cannot read archive", err)
		return
	}
	n := pageParam(r)
	if n < 1 || n > len(rar.Pages) {
		http.Error(w, "invalid page number", 400)
		return
	}
	data, name, err := rar.Page(n - 1)
	if err != nil {
		s.fail(w, 500, "cannot read page", err)
		return
	}
	servePage(w, r, name, info.ModTime(), data)
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
		if p == "" {
			p = "index.html"
		}
		if f, err := s.Static.Open(p); err == nil {
			f.Close()
			switch {
			case p == "index.html":
				w.Header().Set("Cache-Control", "no-cache")
			case hashedAsset.MatchString(p):
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			default:
				w.Header().Set("Cache-Control", "public, max-age=3600")
			}
			http.ServeFileFS(w, r, s.Static, p)
			return
		}
		if path.Ext(p) != "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFileFS(w, r, s.Static, "index.html")
	})
}

func nowUnix() int64 { return time.Now().Unix() }
