package archive

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"

	"github.com/nwaples/rardecode/v2"

	"shelf/internal/library"
	"shelf/internal/natural"
)

// ErrNo7z is returned for 7z / CB7 archives when 7-Zip is not installed.
// RAR files do not need it: they fall back to a pure Go decoder.
var ErrNo7z = errors.New("7-Zip is not available; 7z/CB7 files need it")

// Rar is an opened RAR (or, through 7-Zip, 7z) archive. Pages are entry
// names in reading order.
type Rar struct {
	sevenZip string
	path     string
	Pages    []string

	// native is set when the archive is read by the built-in RAR decoder
	// instead of 7-Zip. files then holds the page entries in Pages order.
	native bool
	files  []*rardecode.File
}

func (r *Rar) Len() int { return len(r.Pages) }

// Close is a no-op: pages are read by separate 7-Zip processes or by
// reopening the archive.
func (r *Rar) Close() error { return nil }

// OpenRar lists a RAR archive. With 7-Zip available it is used (fast
// random access on solid archives); otherwise the archive is read in Go.
func OpenRar(sevenZip, path string) (*Rar, error) {
	if sevenZip == "" {
		return openRarNative(path)
	}
	pages, err := listWith7z(sevenZip, path)
	if err != nil {
		// 7-Zip may be present but unable to read this file (e.g. a RAR5
		// archive with an old 7-Zip). Try the built-in decoder.
		if r, nerr := openRarNative(path); nerr == nil {
			return r, nil
		}
		return nil, err
	}
	return &Rar{sevenZip: sevenZip, path: path, Pages: pages}, nil
}

// OpenSevenZ lists a 7z archive through 7-Zip.
func OpenSevenZ(sevenZip, path string) (*Rar, error) {
	if sevenZip == "" {
		return nil, ErrNo7z
	}
	pages, err := listWith7z(sevenZip, path)
	if err != nil {
		return nil, err
	}
	return &Rar{sevenZip: sevenZip, path: path, Pages: pages}, nil
}

// Page extracts the i-th page (0-based) to memory.
func (r *Rar) Page(i int) ([]byte, string, error) {
	if i < 0 || i >= len(r.Pages) {
		return nil, "", fmt.Errorf("page %d out of range", i+1)
	}
	name := r.Pages[i]
	if r.native {
		data, err := r.readNative(i)
		return data, name, err
	}
	cmd := exec.Command(r.sevenZip, "x", "-so", r.path, name)
	hideWindow(cmd)
	data, err := cmd.Output()
	if err != nil {
		return nil, "", fmt.Errorf("7z extract %q: %w", name, err)
	}
	return data, name, nil
}

// ----- 7-Zip listing with a cache -----

// listWith7z runs "7z l" once per file version: listing spawns a process,
// so the page names are remembered per path, size and modification time.
func listWith7z(sevenZip, path string) ([]string, error) {
	key, ok := cacheKey(path)
	if ok {
		if pages, hit := listCache.get(key); hit {
			return pages, nil
		}
	}
	// -slt prints one "Key = Value" block per entry, so names with spaces
	// survive intact. -ba drops the banner.
	cmd := exec.Command(sevenZip, "l", "-slt", "-ba", path)
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("7z list: %w", err)
	}
	pages := parseSLT(out)
	sorted := make([]string, 0, len(pages))
	for _, p := range pages {
		if library.IsPageImage(p) {
			sorted = append(sorted, p)
		}
	}
	natural.Sort(sorted)
	if ok {
		listCache.put(key, sorted)
	}
	return sorted, nil
}

type listKey struct {
	path  string
	size  int64
	mtime int64
}

func cacheKey(path string) (listKey, bool) {
	st, err := os.Stat(path)
	if err != nil {
		return listKey{}, false
	}
	return listKey{path: path, size: st.Size(), mtime: st.ModTime().UnixNano()}, true
}

// pageListCache remembers the page names of recently listed archives.
// It is bounded: when full, the oldest entry goes.
type pageListCache struct {
	mu    sync.Mutex
	limit int
	m     map[listKey][]string
	order []listKey
}

var listCache = &pageListCache{limit: 64, m: map[listKey][]string{}}

func (c *pageListCache) get(k listKey) ([]string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.m[k]
	return v, ok
}

func (c *pageListCache) put(k listKey, v []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.m[k]; !ok {
		// Drop stale versions of the same path and the oldest entries.
		kept := c.order[:0]
		for _, o := range c.order {
			if o.path == k.path {
				delete(c.m, o)
				continue
			}
			kept = append(kept, o)
		}
		c.order = kept
		for len(c.order) >= c.limit {
			delete(c.m, c.order[0])
			c.order = c.order[1:]
		}
		c.order = append(c.order, k)
	}
	c.m[k] = v
}

// parseSLT extracts file (not directory) paths from `7z l -slt` output.
func parseSLT(out []byte) []string {
	var files []string
	var path string
	isDir := false
	flush := func() {
		if path != "" && !isDir {
			files = append(files, path)
		}
		path, isDir = "", false
	}
	sc := bufio.NewScanner(bytes.NewReader(out))
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			flush()
			continue
		}
		key, val, ok := strings.Cut(line, " = ")
		if !ok {
			continue
		}
		switch key {
		case "Path":
			flush()
			path = strings.ReplaceAll(val, "\\", "/")
		case "Folder":
			if val == "+" {
				isDir = true
			}
		case "Attributes":
			if strings.HasPrefix(val, "D") {
				isDir = true
			}
		}
	}
	flush()
	return files
}

// ----- built-in RAR decoder -----

func openRarNative(path string) (*Rar, error) {
	files, err := rardecode.List(path)
	if err != nil {
		return nil, fmt.Errorf("open rar: %w", err)
	}
	var pages []*rardecode.File
	for _, f := range files {
		if f.IsDir || !library.IsPageImage(f.Name) {
			continue
		}
		pages = append(pages, f)
	}
	sort.SliceStable(pages, func(i, j int) bool { return natural.Less(pages[i].Name, pages[j].Name) })
	r := &Rar{path: path, native: true, files: pages, Pages: make([]string, len(pages))}
	for i, f := range pages {
		r.Pages[i] = f.Name
	}
	return r, nil
}

// readNative returns the i-th page through the Go decoder. Non-solid
// entries are read directly; a solid archive is decoded from the start
// up to the wanted entry, since each file depends on the previous ones.
func (r *Rar) readNative(i int) ([]byte, error) {
	f := r.files[i]
	rc, err := f.Open()
	if err == nil {
		defer rc.Close()
		return io.ReadAll(rc)
	}
	if !errors.Is(err, rardecode.ErrSolidOpen) {
		return nil, fmt.Errorf("rar read %q: %w", f.Name, err)
	}
	ar, err := rardecode.OpenReader(r.path)
	if err != nil {
		return nil, err
	}
	defer ar.Close()
	for {
		h, err := ar.Next()
		if err == io.EOF {
			return nil, fmt.Errorf("rar read %q: entry not found", f.Name)
		}
		if err != nil {
			return nil, err
		}
		if h.Name == f.Name {
			return io.ReadAll(ar)
		}
		// Decode the preceding entry so the dictionary is right for the
		// next one; directories and empty files have nothing to read.
		if _, err := io.Copy(io.Discard, ar); err != nil {
			return nil, err
		}
	}
}
