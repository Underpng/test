// Package api serves the JSON API, book content and the embedded frontend.
package api

import (
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"runtime"
	"strconv"
	"strings"

	"shelf/internal/db"
	"shelf/internal/library"
	"shelf/internal/saver"
	"shelf/internal/scan"
)

type Server struct {
	Lib      *library.Library
	DB       *db.DB
	Scanner  *scan.Scanner
	CoverDir string
	PageSize int
	SevenZip string
	Saver    *saver.Saver // nil disables data saving
	Static   fs.FS
	Version  string
	Log      *log.Logger
}

// Entry is the JSON shape the frontend expects for books and folders.
type Entry struct {
	Type            string  `json:"type"`
	Path            string  `json:"path"`
	Cover           string  `json:"cover"`
	Title           string  `json:"title"`
	CurrentPosition string  `json:"currentPosition"`
	Progress        float64 `json:"progress"`
	Count           int     `json:"count,omitempty"`    // Series: number of volumes
	Finished        int     `json:"finished,omitempty"` // Series: volumes read
}

func entryOf(b db.Book) Entry {
	return Entry{
		Type:            b.Type,
		Path:            b.Path,
		Cover:           b.Cover,
		Title:           b.Title,
		CurrentPosition: b.CurrentPosition,
		Progress:        b.Progress,
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/home", s.home)
	mux.HandleFunc("GET /api/all", s.all)
	mux.HandleFunc("GET /api/series", s.seriesList)
	mux.HandleFunc("GET /api/root", s.root)
	mux.HandleFunc("GET /api/root/{path...}", s.root)
	mux.HandleFunc("GET /api/search", s.search)
	mux.HandleFunc("GET /api/progress", s.progress)
	mux.HandleFunc("GET /api/access", s.access)
	mux.HandleFunc("GET /api/neighbors", s.neighbors)
	mux.HandleFunc("/api/rescan", s.rescan)
	mux.HandleFunc("GET /api/status", s.status)

	mux.HandleFunc("GET /book/epub", s.wholeFile("application/epub+zip"))
	mux.HandleFunc("GET /book/pdf", s.wholeFile("application/pdf"))
	mux.HandleFunc("GET /book/cbz/pages", s.comicPages("cbz"))
	mux.HandleFunc("GET /book/cbz", s.comicPage("cbz"))
	mux.HandleFunc("GET /book/cbr/pages", s.comicPages("cbr"))
	mux.HandleFunc("GET /book/cbr", s.comicPage("cbr"))
	mux.HandleFunc("GET /api/client", s.client)

	mux.HandleFunc("GET /cover/{path...}", s.cover)

	mux.Handle("/", s.static())
	return mux
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}

func (s *Server) fail(w http.ResponseWriter, code int, msg string, err error) {
	if err != nil {
		s.Log.Printf("%s: %v", msg, err)
	}
	http.Error(w, msg, code)
}

// bookPath reads the ?path= query parameter as an API path.
func bookPath(r *http.Request) string {
	p := r.URL.Query().Get("path")
	if p == "" {
		return ""
	}
	if !strings.HasPrefix(p, "/") {
		if u, err := url.PathUnescape(p); err == nil {
			p = u
		}
	}
	return library.Clean(p)
}

type paging struct {
	orderBy db.Order
	limit   int
	offset  int
}

func (s *Server) paging(r *http.Request) paging {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	return paging{
		orderBy: db.OrderBy(q.Get("sort"), q.Get("order")),
		limit:   s.PageSize + 1,
		offset:  (page - 1) * s.PageSize,
	}
}

// listResponse trims the extra row used to detect more pages.
func (s *Server) listResponse(w http.ResponseWriter, prefix []Entry, books []db.Book) {
	s.listResponseExtra(w, prefix, books, nil)
}

func (s *Server) listResponseExtra(w http.ResponseWriter, prefix []Entry, books []db.Book, extra map[string]any) {
	hasMore := false
	if len(books) > s.PageSize {
		hasMore = true
		books = books[:s.PageSize]
	}
	entries := make([]Entry, 0, len(prefix)+len(books))
	entries = append(entries, prefix...)
	for _, b := range books {
		entries = append(entries, entryOf(b))
	}
	out := map[string]any{"books": entries, "hasMore": hasMore}
	for k, v := range extra {
		out[k] = v
	}
	writeJSON(w, out)
}

func (s *Server) all(w http.ResponseWriter, r *http.Request) {
	p := s.paging(r)
	books, err := s.DB.ListAll(p.orderBy, p.limit, p.offset)
	if err != nil {
		s.fail(w, 500, "db query failed", err)
		return
	}
	s.listResponse(w, nil, books)
}

func (s *Server) root(w http.ResponseWriter, r *http.Request) {
	folder := library.Clean("/" + r.PathValue("path"))
	p := s.paging(r)

	var prefix []Entry
	if p.offset == 0 {
		subs, err := s.DB.Subfolders(folder)
		if err != nil {
			s.fail(w, 500, "db query failed", err)
			return
		}
		for _, f := range subs {
			prefix = append(prefix, Entry{Type: "Folder", Path: f.Path, Cover: f.Cover, Title: library.Base(f.Path)})
		}
	}
	books, err := s.DB.ListFolder(folder, p.orderBy, p.limit, p.offset)
	if err != nil {
		s.fail(w, 500, "db query failed", err)
		return
	}
	extra := map[string]any{}
	if p.offset == 0 {
		if sr := s.seriesOf(folder); sr != nil {
			info := map[string]any{"title": sr.Title, "count": len(sr.Volumes), "finished": sr.Finished}
			if c := sr.continueVolume(); c != nil {
				e := entryOf(*c)
				info["continue"] = e
			}
			extra["series"] = info
		}
	}
	s.listResponseExtra(w, prefix, books, extra)
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	p := s.paging(r)
	q := r.URL.Query().Get("q")
	if u, err := url.QueryUnescape(q); err == nil {
		q = u
	}
	var title string
	var tags []string
	for _, part := range strings.Split(q, ",") {
		part = strings.TrimSpace(part)
		switch {
		case part == "":
		case strings.HasPrefix(part, "#"):
			tags = append(tags, strings.TrimPrefix(part, "#"))
		case title == "":
			title = part
		}
	}
	var paths []string
	if len(tags) > 0 {
		var err error
		paths, err = s.DB.PathsByKeywords(tags)
		if err != nil {
			s.fail(w, 500, "db query failed", err)
			return
		}
	}
	if title == "" && len(tags) == 0 {
		writeJSON(w, map[string]any{"books": []Entry{}, "hasMore": false})
		return
	}
	books, err := s.DB.SearchTitle(title, paths, p.orderBy, p.limit, p.offset)
	if err != nil {
		s.fail(w, 500, "db query failed", err)
		return
	}
	s.listResponse(w, nil, books)
}

func (s *Server) progress(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	progress, _ := strconv.ParseFloat(q.Get("progress"), 64)
	if p := bookPath(r); p != "" {
		s.DB.UpdateProgress(p, q.Get("position"), progress)
	}
	writeJSON(w, "")
}

func (s *Server) access(w http.ResponseWriter, r *http.Request) {
	if p := bookPath(r); p != "" {
		s.DB.Touch(p, nowUnix())
	}
	writeJSON(w, "")
}

// neighbors returns the previous and next book in the same folder, in
// natural filename order, so a reader can continue with the next volume.
// Books lying directly in the library root are not a series: they get no
// neighbours (the other loose files are unrelated titles).
func (s *Server) neighbors(w http.ResponseWriter, r *http.Request) {
	p := bookPath(r)
	book, err := s.DB.Get(p)
	if err != nil {
		s.fail(w, 404, "book not found", nil)
		return
	}
	if book.Parent == "/" {
		writeJSON(w, map[string]any{
			"prev": nil, "next": nil, "index": 0, "total": 0,
			"folder": "/", "series": false,
		})
		return
	}
	siblings, err := s.DB.FolderBooks(book.Parent)
	if err != nil {
		s.fail(w, 500, "db query failed", err)
		return
	}
	idx := -1
	for i, b := range siblings {
		if b.Path == p {
			idx = i
			break
		}
	}
	var prev, next *Entry
	if idx > 0 {
		e := entryOf(siblings[idx-1])
		prev = &e
	}
	if idx >= 0 && idx+1 < len(siblings) {
		e := entryOf(siblings[idx+1])
		next = &e
	}
	writeJSON(w, map[string]any{
		"prev":   prev,
		"next":   next,
		"index":  idx + 1,
		"total":  len(siblings),
		"folder": book.Parent,
		"series": true,
	})
}

func (s *Server) rescan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodGet {
		http.Error(w, "method not allowed", 405)
		return
	}
	go func() {
		if res, err := s.Scanner.Run(); err != nil {
			s.Log.Printf("rescan: %v", err)
		} else {
			s.Log.Printf("rescan: +%d ~%d -%d in %s", res.Added, res.Updated, res.Deleted, res.Duration)
		}
	}()
	writeJSON(w, map[string]any{"started": true})
}

func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	n, _ := s.DB.Count()
	last := s.Scanner.Last()
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	writeJSON(w, map[string]any{
		"version":    s.Version,
		"books":      n,
		"booksDir":   s.Lib.BooksDir,
		"sevenZip":   s.SevenZip != "",
		"saverCache": s.saverUsage(),
		"memoryMB": map[string]uint64{
			"goHeapInUse": m.HeapInuse >> 20,
			"goTotal":     m.Sys >> 20,
		},
		"lastScan": map[string]any{
			"at":       last.At,
			"added":    last.Added,
			"updated":  last.Updated,
			"deleted":  last.Deleted,
			"duration": last.Duration.String(),
		},
	})
}

func (s *Server) saverUsage() map[string]any {
	if s.Saver == nil {
		return map[string]any{"enabled": false}
	}
	files, size := s.Saver.Usage()
	return map[string]any{"enabled": true, "pages": files, "mb": size >> 20}
}
