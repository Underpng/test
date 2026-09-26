package saver

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"shelf/internal/archive"
)

// fakeBook serves generated pages and counts how often each is read.
type fakeBook struct {
	pages [][]byte
	reads atomic.Int64
}

func (b *fakeBook) Len() int { return len(b.pages) }
func (b *fakeBook) Page(i int) ([]byte, string, error) {
	if i < 0 || i >= len(b.pages) {
		return nil, "", errors.New("out of range")
	}
	b.reads.Add(1)
	return b.pages[i], "p.png", nil
}
func (b *fakeBook) Close() error { return nil }

// tallPage draws a noisy page (like scanned art) so that JPEG beats PNG.
func tallPage(t *testing.T, w, h int, c color.RGBA) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	seed := uint32(12345)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			seed = seed*1664525 + 1013904223
			n := uint8(seed >> 26) // 0..63 of noise
			img.SetRGBA(x, y, color.RGBA{c.R/2 + n, c.G/2 + n, c.B/2 + n, 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func newSaver(t *testing.T, warm bool) *Saver {
	s, err := New(Options{Dir: t.TempDir(), MaxHeight: 400, Quality: 70, WarmAhead: warm, Log: log.New(io.Discard, "", 0)})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestConvertShrinksAndCaches(t *testing.T) {
	s := newSaver(t, false)
	book := &fakeBook{pages: [][]byte{tallPage(t, 400, 800, color.RGBA{40, 40, 40, 255})}}
	src := Source{ID: "/a.cbz|1", Open: func() (archive.Book, error) { return book, nil }}

	pg, err := s.Get(src, 1, book)
	if err != nil {
		t.Fatal(err)
	}
	if pg.Mime != "image/jpeg" {
		t.Fatalf("mime %s", pg.Mime)
	}
	img, err := jpeg.Decode(bytes.NewReader(pg.Data))
	if err != nil {
		t.Fatal(err)
	}
	if h := img.Bounds().Dy(); h != 400 {
		t.Fatalf("height %d, want 400", h)
	}
	// Second request comes from disk without reading the archive again.
	if _, err := s.Get(src, 1, book); err != nil {
		t.Fatal(err)
	}
	if n := book.reads.Load(); n != 1 {
		t.Fatalf("archive read %d times, want 1", n)
	}
	if files, _ := s.Usage(); files != 1 {
		t.Fatalf("cache has %d files", files)
	}
}

func TestSmallPageServedAsIs(t *testing.T) {
	s := newSaver(t, false)
	orig := []byte{0xff, 0xd8, 0xff} // not decodable: must fall back to the original
	pg := s.convert(orig, "x.jpg")
	if !bytes.Equal(pg.Data, orig) || pg.Mime != "image/jpeg" {
		t.Fatalf("undecodable page should be returned unchanged")
	}
}

func TestWarmAheadConvertsTheRestOfTheVolume(t *testing.T) {
	s := newSaver(t, true)
	var pages [][]byte
	for i := 0; i < 6; i++ {
		pages = append(pages, tallPage(t, 300, 900, color.RGBA{200, 30, 30, 255}))
	}
	book := &fakeBook{pages: pages}
	src := Source{ID: "/b.cbz|1", Open: func() (archive.Book, error) { return book, nil }}
	if _, err := s.Get(src, 2, book); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if files, _ := s.Usage(); files == 5 { // pages 2..6
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	files, _ := s.Usage()
	t.Fatalf("background conversion produced %d files, want 5", files)
}

func TestPruneKeepsTheCacheUnderBudget(t *testing.T) {
	s := newSaver(t, false)
	s.opt.MaxBytes = 1000
	for i := 0; i < 10; i++ {
		key := s.key("/c.cbz", i+1)
		s.store(key, Page{Data: bytes.Repeat([]byte{1}, 300), Mime: "image/jpeg"})
		// oldest first
		p, _ := s.find(key)
		old := time.Now().Add(time.Duration(i-20) * time.Minute)
		os.Chtimes(p, old, old)
	}
	s.Prune()
	files, size := s.Usage()
	if size > 800 {
		t.Fatalf("cache still %d bytes after prune", size)
	}
	// the newest file survives
	newest, _ := s.find(s.key("/c.cbz", 10))
	if _, err := os.Stat(newest); err != nil {
		t.Fatalf("newest file was pruned (files left: %d)", files)
	}
	oldest := filepath.Join(s.opt.Dir, s.key("/c.cbz", 1)[:2], s.key("/c.cbz", 1)+".jpg")
	if _, err := os.Stat(oldest); err == nil {
		t.Fatal("oldest file should have been pruned")
	}
}
