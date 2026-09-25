// Package scan keeps the catalogue in sync with the books directory.
package scan

import (
	"context"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"shelf/internal/cover"
	"shelf/internal/db"
	"shelf/internal/library"
	"shelf/internal/meta"
	"shelf/internal/natural"
)

const maxCoverTries = 3

type Scanner struct {
	Lib      *library.Library
	DB       *db.DB
	CoverDir string
	Cover    cover.Options
	PdfInfo  string
	Log      *log.Logger

	mu       sync.Mutex
	lastRun  time.Time
	lastInfo Result
}

type Result struct {
	Added, Updated, Deleted, CoversRetried int
	Duration                               time.Duration
	At                                     time.Time
}

// Run performs one incremental scan. Concurrent calls wait for each other.
func (s *Scanner) Run() (Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	start := time.Now()
	var res Result

	onDisk, err := s.walk()
	if err != nil {
		return res, err
	}
	known, err := s.DB.PathsModded()
	if err != nil {
		return res, err
	}

	for rel, mod := range onDisk {
		old, ok := known[rel]
		switch {
		case !ok:
			if err := s.add(rel, mod); err != nil {
				s.Log.Printf("add %s: %v", rel, err)
			} else {
				res.Added++
			}
		case old != mod:
			if err := s.update(rel, mod); err != nil {
				s.Log.Printf("update %s: %v", rel, err)
			} else {
				res.Updated++
			}
		}
	}
	for rel := range known {
		if _, ok := onDisk[rel]; !ok {
			s.remove(rel)
			res.Deleted++
		}
	}

	// Books whose cover failed earlier get another chance (bounded).
	missing, err := s.DB.MissingCovers(maxCoverTries)
	if err == nil {
		for _, b := range missing {
			if _, ok := onDisk[b.Path]; !ok {
				continue
			}
			if s.tryCover(b.Path, b.Type, b.CoverTries) {
				res.CoversRetried++
			}
		}
	}

	res.Duration = time.Since(start)
	res.At = time.Now()
	s.lastRun, s.lastInfo = res.At, res
	return res, nil
}

// Loop rescans every interval until ctx is cancelled.
func (s *Scanner) Loop(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		return
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if r, err := s.Run(); err != nil {
				s.Log.Printf("scan: %v", err)
			} else if r.Added+r.Updated+r.Deleted+r.CoversRetried > 0 {
				s.Log.Printf("scan: +%d ~%d -%d in %s", r.Added, r.Updated, r.Deleted, r.Duration.Round(time.Millisecond))
				debug.FreeOSMemory()
			}
		}
	}
}

// Last reports the most recent scan result.
func (s *Scanner) Last() Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastInfo
}

func (s *Scanner) walk() (map[string]int64, error) {
	out := map[string]int64{}
	err := filepath.WalkDir(s.Lib.BooksDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			s.Log.Printf("walk %s: %v", p, err)
			return nil
		}
		name := d.Name()
		if d.IsDir() {
			if p != s.Lib.BooksDir && (strings.HasPrefix(name, ".") || name == "@eaDir") {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(name, ".") || library.TypeOf(name) == "" {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel, err := s.Lib.Rel(p)
		if err != nil {
			return nil
		}
		out[rel] = info.ModTime().Unix()
		return nil
	})
	return out, err
}

func (s *Scanner) coverPathFor(rel string) (abs, api string) {
	api = strings.TrimSuffix(rel, filepath.Ext(rel)) + ".jpg"
	abs, _ = library.Resolve(s.CoverDir, api)
	return abs, api
}

func (s *Scanner) tryCover(rel, bookType string, tries int) bool {
	src, err := s.Lib.Abs(rel)
	if err != nil {
		return false
	}
	abs, api := s.coverPathFor(rel)
	if err := cover.Extract(src, bookType, abs, s.Cover); err != nil {
		s.Log.Printf("cover %s: %v", rel, err)
		s.DB.SetCover(rel, "", tries+1)
		return false
	}
	s.DB.SetCover(rel, api, 0)
	return true
}

func (s *Scanner) add(rel string, mod int64) error {
	src, err := s.Lib.Abs(rel)
	if err != nil {
		return err
	}
	bookType := library.TypeOf(rel)
	info := meta.Extract(src, bookType, s.PdfInfo)
	b := db.Book{
		Path:       rel,
		Parent:     library.Parent(rel),
		Type:       bookType,
		Title:      info.Title,
		TitleSort:  natural.Key(info.Title),
		NameSort:   natural.Key(library.Base(rel)),
		AddedTime:  time.Now().Unix(),
		LastModded: mod,
	}
	if err := s.DB.Insert(b); err != nil {
		return err
	}
	s.DB.SetKeywords(rel, info.Keywords)
	s.tryCover(rel, bookType, 0)
	return nil
}

func (s *Scanner) update(rel string, mod int64) error {
	src, err := s.Lib.Abs(rel)
	if err != nil {
		return err
	}
	bookType := library.TypeOf(rel)
	info := meta.Extract(src, bookType, s.PdfInfo)
	if err := s.DB.UpdateMeta(rel, info.Title, natural.Key(info.Title), mod); err != nil {
		return err
	}
	s.DB.SetKeywords(rel, info.Keywords)
	s.tryCover(rel, bookType, 0)
	return nil
}

func (s *Scanner) remove(rel string) {
	abs, _ := s.coverPathFor(rel)
	os.Remove(abs)
	if err := s.DB.Delete(rel); err != nil {
		s.Log.Printf("delete %s: %v", rel, err)
	}
}
