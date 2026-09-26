// Package saver serves comic pages shrunk for the phone ("data saver"),
// caching the converted files on disk and converting the rest of a volume
// ahead of the reader in the background.
package saver

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"image"
	"image/jpeg"
	"io/fs"
	"log"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	_ "image/gif"
	_ "image/png"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/webp"

	"shelf/internal/archive"
	"shelf/internal/library"
	"shelf/internal/resize"
)

type Options struct {
	Dir         string // cache directory
	MaxHeight   int    // pages are scaled to at most this many pixels tall
	Quality     int    // JPEG quality
	MaxBytes    int64  // disk budget for the cache
	Foreground  int    // concurrent conversions for pages nobody pre-converted
	Log         *log.Logger
	WarmAhead   bool // convert the rest of the volume in the background
	pruneEvery  int64
	touchWindow time.Duration
}

// Source identifies a book and how to open it for background work.
type Source struct {
	ID   string // stable identity, must change when the file changes
	Open func() (archive.Book, error)
}

type Saver struct {
	opt   Options
	fg    chan struct{}
	mu    sync.Mutex
	calls map[string]*call
	bg    *job

	stores  atomic.Int64
	pruning atomic.Bool
	now     func() time.Time
}

type call struct {
	done chan struct{}
	page Page
	err  error
}

type job struct {
	id     string
	next   atomic.Int64
	cancel context.CancelFunc
}

// Page is a served page: its bytes and MIME type.
type Page struct {
	Data []byte
	Mime string
}

func New(opt Options) (*Saver, error) {
	if opt.MaxHeight <= 0 {
		opt.MaxHeight = 1200
	}
	if opt.Quality <= 0 || opt.Quality > 100 {
		opt.Quality = 70
	}
	if opt.MaxBytes <= 0 {
		opt.MaxBytes = 2 << 30
	}
	if opt.Foreground <= 0 {
		opt.Foreground = 2
	}
	if opt.pruneEvery <= 0 {
		opt.pruneEvery = 25
	}
	if opt.touchWindow <= 0 {
		opt.touchWindow = time.Hour
	}
	if opt.Log == nil {
		opt.Log = log.New(os.Stderr, "", log.LstdFlags)
	}
	if err := os.MkdirAll(opt.Dir, 0o755); err != nil {
		return nil, err
	}
	return &Saver{
		opt:   opt,
		fg:    make(chan struct{}, opt.Foreground),
		calls: map[string]*call{},
		now:   time.Now,
	}, nil
}

// Get returns page n (1-based) of the book in saver quality. book is the
// already opened archive used when the page has to be converted now.
// Afterwards the rest of the volume is converted in the background.
func (s *Saver) Get(src Source, n int, book archive.Book) (Page, error) {
	key := s.key(src.ID, n)
	p, err := s.once(key, func() (Page, error) {
		s.fg <- struct{}{}
		defer func() { <-s.fg }()
		data, name, err := book.Page(n - 1)
		if err != nil {
			return Page{}, err
		}
		pg := s.convert(data, name)
		s.store(key, pg)
		runtime.GC()
		return pg, nil
	})
	if err == nil && s.opt.WarmAhead {
		s.warm(src, n+1, book.Len())
	}
	return p, err
}

// once returns the cached page or runs fn exactly once per key even when
// the foreground and the background ask for the same page together.
func (s *Saver) once(key string, fn func() (Page, error)) (Page, error) {
	if pg, ok := s.load(key); ok {
		return pg, nil
	}
	s.mu.Lock()
	if c, ok := s.calls[key]; ok {
		s.mu.Unlock()
		<-c.done
		return c.page, c.err
	}
	c := &call{done: make(chan struct{})}
	s.calls[key] = c
	s.mu.Unlock()

	// Another caller may have finished between load and lock.
	if pg, ok := s.load(key); ok {
		c.page = pg
	} else {
		c.page, c.err = fn()
	}
	close(c.done)
	s.mu.Lock()
	delete(s.calls, key)
	s.mu.Unlock()
	return c.page, c.err
}

// warm converts pages from..total of src in the background, one at a time.
// A request elsewhere (another book, or a jump) replaces the running job.
func (s *Saver) warm(src Source, from, total int) {
	if from > total {
		return
	}
	s.mu.Lock()
	if j := s.bg; j != nil && j.id == src.ID {
		// Still converting just ahead of the reader: leave it alone.
		if next := int(j.next.Load()); next >= from && next <= from+8 {
			s.mu.Unlock()
			return
		}
	}
	if s.bg != nil {
		s.bg.cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	j := &job{id: src.ID, cancel: cancel}
	j.next.Store(int64(from))
	s.bg = j
	s.mu.Unlock()

	go func() {
		defer func() {
			s.mu.Lock()
			if s.bg == j {
				s.bg = nil
			}
			s.mu.Unlock()
			cancel()
			debug.FreeOSMemory()
		}()
		book, err := src.Open()
		if err != nil {
			s.opt.Log.Printf("saver: open %s: %v", src.ID, err)
			return
		}
		defer book.Close()
		for n := from; n <= total; n++ {
			if ctx.Err() != nil {
				return
			}
			j.next.Store(int64(n))
			key := s.key(src.ID, n)
			if s.exists(key) {
				continue
			}
			_, err := s.once(key, func() (Page, error) {
				data, name, err := book.Page(n - 1)
				if err != nil {
					return Page{}, err
				}
				pg := s.convert(data, name)
				s.store(key, pg)
				return pg, nil
			})
			if err != nil {
				s.opt.Log.Printf("saver: %s page %d: %v", src.ID, n, err)
			}
			runtime.GC() // keep the heap near its live size between pages
		}
	}()
}

// convert shrinks one page. Pages that cannot be decoded, or that would
// not get meaningfully smaller, are served as they are.
func (s *Saver) convert(data []byte, name string) Page {
	origMime, _ := library.ImageMime(name)
	orig := Page{Data: data, Mime: origMime}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return orig
	}
	out := resize.FitHeight(img, s.opt.MaxHeight)
	var buf bytes.Buffer
	buf.Grow(len(data) / 2)
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: s.opt.Quality}); err != nil {
		return orig
	}
	if buf.Len() >= len(data)*9/10 {
		return orig
	}
	return Page{Data: buf.Bytes(), Mime: "image/jpeg"}
}

// ----- disk cache -----

var extByMime = map[string]string{
	"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
	"image/gif": ".gif", "image/bmp": ".bmp", "image/avif": ".avif",
}

func (s *Saver) key(id string, n int) string {
	h := sha1.Sum([]byte(fmt.Sprintf("%s|%d|%d|%d", id, n, s.opt.MaxHeight, s.opt.Quality)))
	return hex.EncodeToString(h[:])
}

func (s *Saver) base(key string) string {
	return filepath.Join(s.opt.Dir, key[:2], key)
}

func (s *Saver) find(key string) (string, string) {
	base := s.base(key)
	for mime, ext := range extByMime {
		if _, err := os.Stat(base + ext); err == nil {
			return base + ext, mime
		}
	}
	return "", ""
}

func (s *Saver) exists(key string) bool {
	p, _ := s.find(key)
	return p != ""
}

func (s *Saver) load(key string) (Page, bool) {
	p, mime := s.find(key)
	if p == "" {
		return Page{}, false
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return Page{}, false
	}
	// Mark as recently used for the LRU, at most once per touch window.
	if info, err := os.Stat(p); err == nil && s.now().Sub(info.ModTime()) > s.opt.touchWindow {
		t := s.now()
		os.Chtimes(p, t, t)
	}
	return Page{Data: data, Mime: mime}, true
}

func (s *Saver) store(key string, pg Page) {
	ext, ok := extByMime[pg.Mime]
	if !ok {
		return
	}
	dst := s.base(key) + ext
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, pg.Data, 0o644); err != nil {
		return
	}
	if err := os.Rename(tmp, dst); err != nil {
		os.Remove(tmp)
		return
	}
	if s.stores.Add(1)%s.opt.pruneEvery == 0 {
		go s.Prune()
	}
}

// Prune deletes the least recently used files once the cache is over its
// budget, down to 80% of it.
func (s *Saver) Prune() {
	if !s.pruning.CompareAndSwap(false, true) {
		return
	}
	defer s.pruning.Store(false)
	type entry struct {
		path string
		size int64
		mod  time.Time
	}
	var files []entry
	var total int64
	filepath.WalkDir(s.opt.Dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || strings.HasSuffix(p, ".tmp") {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		files = append(files, entry{p, info.Size(), info.ModTime()})
		total += info.Size()
		return nil
	})
	if total <= s.opt.MaxBytes {
		return
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mod.Before(files[j].mod) })
	target := s.opt.MaxBytes * 8 / 10
	for _, f := range files {
		if total <= target {
			break
		}
		if os.Remove(f.path) == nil {
			total -= f.size
		}
	}
}

// Usage reports the number of cached pages and their total size.
func (s *Saver) Usage() (files int, bytes int64) {
	filepath.WalkDir(s.opt.Dir, func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && path.Ext(p) != ".tmp" {
			if info, err := d.Info(); err == nil {
				files++
				bytes += info.Size()
			}
		}
		return nil
	})
	return
}
