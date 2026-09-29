// Package db is the catalogue of books: an in-memory index persisted to a
// JSON file. A home library is at most a few thousand entries, so this is
// both simpler and far lighter than an embedded SQL engine.
package db

import (
	"shelf/internal/fold"

	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Book struct {
	Path            string     `json:"path"`   // API path, e.g. "/Series/Vol 01.cbz"
	Parent          string     `json:"parent"` // folder API path
	Cover           string     `json:"cover"`  // API cover path or ""
	Type            string     `json:"type"`   // CBZ, CBR, EPUB, PDF
	Title           string     `json:"title"`
	TitleSort       string     `json:"titleSort"`
	NameSort        string     `json:"nameSort"`
	AddedTime       int64      `json:"addedTime"`
	LastModded      int64      `json:"lastModded"`
	LastOpened      int64      `json:"lastOpened"`
	CurrentPosition string     `json:"currentPosition"`
	Progress        float64    `json:"progress"`
	CoverTries      int        `json:"coverTries"`
	Bookmarks       []Bookmark `json:"bookmarks,omitempty"`
}

// Bookmark is a saved place in a book. Position uses the same format as
// CurrentPosition (page number, EPUB CFI...); Label is what the list shows.
type Bookmark struct {
	Position string `json:"position"`
	Label    string `json:"label"`
	Created  int64  `json:"created"`
}

type Folder struct {
	Path  string
	Cover string
}

// Order is a validated sort request for listings.
type Order struct {
	Key  string // titleSort, addedTime, lastOpened, progress
	Desc bool
}

var ErrNotFound = errors.New("book not found")

const saveDelay = 1500 * time.Millisecond

type DB struct {
	path string

	mu       sync.RWMutex
	books    map[string]*Book
	keywords map[string][]string

	saveMu    sync.Mutex
	saveTimer *time.Timer
	dirty     bool
}

type fileFormat struct {
	Version  int                 `json:"version"`
	Books    []Book              `json:"books"`
	Keywords map[string][]string `json:"keywords"`
}

func Open(path string) (*DB, error) {
	d := &DB{path: path, books: map[string]*Book{}, keywords: map[string][]string{}}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return d, nil
	}
	if err != nil {
		return nil, err
	}
	var f fileFormat
	if err := json.Unmarshal(data, &f); err != nil {
		// Keep the unreadable file for inspection and start over.
		os.Rename(path, path+".corrupt")
		return d, nil
	}
	for i := range f.Books {
		b := f.Books[i]
		d.books[b.Path] = &b
	}
	if f.Keywords != nil {
		d.keywords = f.Keywords
	}
	return d, nil
}

// Close flushes pending changes.
func (d *DB) Close() error {
	d.saveMu.Lock()
	if d.saveTimer != nil {
		d.saveTimer.Stop()
		d.saveTimer = nil
	}
	d.saveMu.Unlock()
	return d.Flush()
}

// Flush writes the catalogue to disk if anything changed.
func (d *DB) Flush() error {
	d.saveMu.Lock()
	defer d.saveMu.Unlock()
	if !d.dirty {
		return nil
	}
	d.mu.RLock()
	f := fileFormat{Version: 1, Books: make([]Book, 0, len(d.books)), Keywords: d.keywords}
	for _, b := range d.books {
		f.Books = append(f.Books, *b)
	}
	sort.Slice(f.Books, func(i, j int) bool { return f.Books[i].Path < f.Books[j].Path })
	data, err := json.Marshal(f)
	d.mu.RUnlock()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(d.path), 0o755); err != nil {
		return err
	}
	tmp := d.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, d.path); err != nil {
		return err
	}
	d.dirty = false
	return nil
}

// markDirty schedules a save shortly; bursts (page turns) coalesce.
func (d *DB) markDirty() {
	d.saveMu.Lock()
	defer d.saveMu.Unlock()
	d.dirty = true
	if d.saveTimer == nil {
		d.saveTimer = time.AfterFunc(saveDelay, func() {
			d.saveMu.Lock()
			d.saveTimer = nil
			d.saveMu.Unlock()
			d.Flush()
		})
	}
}

// PathsModded returns every known path with its stored modification time.
func (d *DB) PathsModded() (map[string]int64, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	m := make(map[string]int64, len(d.books))
	for p, b := range d.books {
		m[p] = b.LastModded
	}
	return m, nil
}

func (d *DB) Insert(b Book) error {
	d.mu.Lock()
	d.books[b.Path] = &b
	d.mu.Unlock()
	d.markDirty()
	return nil
}

func (d *DB) Get(path string) (Book, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	b, ok := d.books[path]
	if !ok {
		return Book{}, ErrNotFound
	}
	return *b, nil
}

func (d *DB) update(path string, fn func(*Book)) error {
	d.mu.Lock()
	b, ok := d.books[path]
	if ok {
		fn(b)
	}
	d.mu.Unlock()
	if !ok {
		return ErrNotFound
	}
	d.markDirty()
	return nil
}

func (d *DB) UpdateMeta(path, title, titleSort string, lastModded int64) error {
	return d.update(path, func(b *Book) {
		b.Title, b.TitleSort, b.LastModded = title, titleSort, lastModded
	})
}

func (d *DB) SetCover(path, cover string, tries int) error {
	return d.update(path, func(b *Book) { b.Cover, b.CoverTries = cover, tries })
}

func (d *DB) UpdateProgress(path, position string, progress float64) error {
	return d.update(path, func(b *Book) { b.CurrentPosition, b.Progress = position, progress })
}

// MarkRead sets books as finished, or back to unread: no progress, no
// saved position and not "recently opened", so they leave the reading row.
func (d *DB) MarkRead(paths []string, read bool) int {
	n := 0
	d.mu.Lock()
	for _, p := range paths {
		b, ok := d.books[p]
		if !ok {
			continue
		}
		if read {
			b.Progress = 1
		} else {
			b.Progress, b.CurrentPosition, b.LastOpened = 0, "", 0
		}
		n++
	}
	d.mu.Unlock()
	if n > 0 {
		d.markDirty()
	}
	return n
}

// Bookmarks returns the saved places of a book, oldest first.
func (d *DB) Bookmarks(path string) ([]Bookmark, error) {
	b, err := d.Get(path)
	if err != nil {
		return nil, err
	}
	if b.Bookmarks == nil {
		return []Bookmark{}, nil
	}
	return b.Bookmarks, nil
}

// SetBookmark adds (on) or removes the bookmark at position and returns
// the book's bookmarks afterwards. The slice is replaced, never edited in
// place, so snapshots handed out earlier stay valid.
func (d *DB) SetBookmark(path string, bm Bookmark, on bool) ([]Bookmark, error) {
	var out []Bookmark
	err := d.update(path, func(b *Book) {
		next := make([]Bookmark, 0, len(b.Bookmarks)+1)
		for _, have := range b.Bookmarks {
			if have.Position != bm.Position {
				next = append(next, have)
			}
		}
		if on {
			next = append(next, bm)
		}
		if len(next) == 0 {
			next = nil
		}
		b.Bookmarks = next
		out = next
	})
	if out == nil {
		out = []Bookmark{}
	}
	return out, err
}

func (d *DB) Touch(path string, now int64) error {
	return d.update(path, func(b *Book) { b.LastOpened = now })
}

func (d *DB) Delete(path string) error {
	d.mu.Lock()
	delete(d.books, path)
	delete(d.keywords, path)
	d.mu.Unlock()
	d.markDirty()
	return nil
}

func (d *DB) SetKeywords(path string, kws []string) error {
	d.mu.Lock()
	if len(kws) == 0 {
		delete(d.keywords, path)
	} else {
		d.keywords[path] = append([]string(nil), kws...)
	}
	d.mu.Unlock()
	d.markDirty()
	return nil
}

// All returns a snapshot of every book in no particular order.
func (d *DB) All() []Book {
	return d.collect(func(*Book) bool { return true })
}

func (d *DB) Count() (int, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.books), nil
}

// MissingCovers lists books whose cover failed fewer than maxTries times.
func (d *DB) MissingCovers(maxTries int) ([]Book, error) {
	return d.collect(func(b *Book) bool { return b.Cover == "" && b.CoverTries < maxTries }), nil
}

func (d *DB) collect(keep func(*Book) bool) []Book {
	d.mu.RLock()
	defer d.mu.RUnlock()
	var out []Book
	for _, b := range d.books {
		if keep(b) {
			out = append(out, *b)
		}
	}
	return out
}

var sortKeys = map[string]string{
	"title":       "titleSort",
	"added_time":  "addedTime",
	"last_opened": "lastOpened",
	"progress":    "progress",
}

// OrderBy validates user supplied sort parameters.
func OrderBy(sortBy, order string) Order {
	key, ok := sortKeys[sortBy]
	if !ok {
		key = "titleSort"
	}
	return Order{Key: key, Desc: strings.EqualFold(order, "desc")}
}

func sortBooks(books []Book, o Order) {
	less := func(a, b *Book) bool {
		switch o.Key {
		case "addedTime":
			if a.AddedTime != b.AddedTime {
				return a.AddedTime < b.AddedTime
			}
		case "lastOpened":
			if a.LastOpened != b.LastOpened {
				return a.LastOpened < b.LastOpened
			}
		case "progress":
			if a.Progress != b.Progress {
				return a.Progress < b.Progress
			}
		default:
			if a.TitleSort != b.TitleSort {
				return a.TitleSort < b.TitleSort
			}
		}
		return a.Path < b.Path
	}
	sort.SliceStable(books, func(i, j int) bool {
		if o.Desc {
			return less(&books[j], &books[i])
		}
		return less(&books[i], &books[j])
	})
}

func page(books []Book, limit, offset int) []Book {
	if offset >= len(books) {
		return []Book{}
	}
	end := len(books)
	if limit > 0 && offset+limit < end {
		end = offset + limit
	}
	return books[offset:end]
}

func (d *DB) ListAll(o Order, limit, offset int) ([]Book, error) {
	books := d.collect(func(*Book) bool { return true })
	sortBooks(books, o)
	return page(books, limit, offset), nil
}

// ListFolder returns the books directly inside folder.
func (d *DB) ListFolder(folder string, o Order, limit, offset int) ([]Book, error) {
	books := d.collect(func(b *Book) bool { return b.Parent == folder })
	sortBooks(books, o)
	return page(books, limit, offset), nil
}

// FolderBooks returns every book directly inside folder in natural filename order.
func (d *DB) FolderBooks(folder string) ([]Book, error) {
	books := d.collect(func(b *Book) bool { return b.Parent == folder })
	sort.SliceStable(books, func(i, j int) bool {
		if books[i].NameSort != books[j].NameSort {
			return books[i].NameSort < books[j].NameSort
		}
		return books[i].Path < books[j].Path
	})
	return books, nil
}

// Subfolders lists the immediate child folders of folder, each with the
// cover of its first book (by name) that has one.
func (d *DB) Subfolders(folder string) ([]Folder, error) {
	prefix := folder
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	inside := d.collect(func(b *Book) bool {
		return b.Parent != folder && strings.HasPrefix(b.Parent, prefix)
	})
	sort.SliceStable(inside, func(i, j int) bool {
		if inside[i].NameSort != inside[j].NameSort {
			return inside[i].NameSort < inside[j].NameSort
		}
		return inside[i].Path < inside[j].Path
	})
	index := map[string]int{}
	var out []Folder
	for _, b := range inside {
		rest := strings.TrimPrefix(b.Parent, prefix)
		first, _, _ := strings.Cut(rest, "/")
		child := prefix + first
		i, ok := index[child]
		if !ok {
			index[child] = len(out)
			out = append(out, Folder{Path: child, Cover: b.Cover})
			continue
		}
		if out[i].Cover == "" && b.Cover != "" {
			out[i].Cover = b.Cover
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

// Search finds books whose title, or the folder they are in, contains
// text anywhere, ignoring case, width, kana type and spaces (see fold).
// When paths is not nil only those paths are considered.
func (d *DB) Search(text string, paths []string, o Order, limit, offset int) ([]Book, error) {
	var allowed map[string]bool
	if paths != nil {
		if len(paths) == 0 {
			return []Book{}, nil
		}
		allowed = make(map[string]bool, len(paths))
		for _, p := range paths {
			allowed[p] = true
		}
	}
	needle := fold.String(text)
	books := d.collect(func(b *Book) bool {
		if allowed != nil && !allowed[b.Path] {
			return false
		}
		return needle == "" || fold.Contains(b.Title, needle) || fold.Contains(b.Parent, needle)
	})
	sortBooks(books, o)
	return page(books, limit, offset), nil
}

// PathsByKeywords returns paths tagged with every keyword given.
func (d *DB) PathsByKeywords(kws []string) ([]string, error) {
	if len(kws) == 0 {
		return nil, nil
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	out := []string{}
	for p, have := range d.keywords {
		set := make(map[string]bool, len(have))
		for _, k := range have {
			set[strings.ToLower(k)] = true
		}
		all := true
		for _, k := range kws {
			if !set[strings.ToLower(k)] {
				all = false
				break
			}
		}
		if all {
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out, nil
}
