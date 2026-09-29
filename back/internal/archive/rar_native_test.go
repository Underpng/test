package archive

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// rar4Store writes a RAR 2.x/4.x archive with files stored uncompressed.
// solid marks the archive solid, which makes rardecode refuse random
// access and exercises the sequential path.
func rar4Store(t *testing.T, dst string, files map[string][]byte, order []string, solid bool) {
	t.Helper()
	var b bytes.Buffer
	b.Write([]byte("Rar!\x1a\x07\x00"))
	// main header
	var mainFlags uint16
	if solid {
		mainFlags |= 0x0008
	}
	main := make([]byte, 11)
	main[0] = 0x73
	binary.LittleEndian.PutUint16(main[1:], mainFlags)
	binary.LittleEndian.PutUint16(main[3:], 13)
	writeBlock(&b, main)
	for i, name := range order {
		data := files[name]
		nameB := []byte(name)
		h := make([]byte, 30+len(nameB))
		h[0] = 0x74
		var flags uint16 = 0x8000 // LONG_BLOCK: packed size follows
		if solid && i > 0 {
			flags |= 0x0010 // LHD_SOLID
		}
		binary.LittleEndian.PutUint16(h[1:], flags)
		binary.LittleEndian.PutUint16(h[3:], uint16(32+len(nameB)))
		binary.LittleEndian.PutUint32(h[5:], uint32(len(data))) // PACK_SIZE
		binary.LittleEndian.PutUint32(h[9:], uint32(len(data))) // UNP_SIZE
		h[13] = 2                                               // HOST_OS win32
		binary.LittleEndian.PutUint32(h[14:], crc32.ChecksumIEEE(data))
		binary.LittleEndian.PutUint32(h[18:], 0x5A7A1000) // FTIME (dos)
		h[22] = 20                                        // UNP_VER
		h[23] = 0x30                                      // METHOD store
		binary.LittleEndian.PutUint16(h[24:], uint16(len(nameB)))
		binary.LittleEndian.PutUint32(h[26:], 0x20) // ATTR archive
		copy(h[30:], nameB)
		writeBlock(&b, h)
		b.Write(data)
	}
	if err := os.WriteFile(dst, b.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeBlock(b *bytes.Buffer, body []byte) {
	crc := crc32.ChecksumIEEE(body)
	var c [2]byte
	binary.LittleEndian.PutUint16(c[:], uint16(crc))
	b.Write(c[:])
	b.Write(body)
}

var fixturePages = map[string][]byte{
	"vol/010.jpg":  []byte("page ten"),
	"vol/002.png":  []byte("page two"),
	"vol/001.jpg":  []byte("page one"),
	"vol/info.txt": []byte("not a page"),
}

func checkPages(t *testing.T, r *Rar) {
	t.Helper()
	want := []string{"vol/001.jpg", "vol/002.png", "vol/010.jpg"}
	if len(r.Pages) != len(want) {
		t.Fatalf("pages %v", r.Pages)
	}
	for i, w := range want {
		if r.Pages[i] != w {
			t.Fatalf("pages %v", r.Pages)
		}
	}
	for i, w := range []string{"page one", "page two", "page ten"} {
		data, name, err := r.Page(i)
		if err != nil {
			t.Fatalf("page %d: %v", i, err)
		}
		if string(data) != w || name != want[i] {
			t.Fatalf("page %d: %q %q", i, data, name)
		}
	}
	// Reading out of order must work too.
	if data, _, err := r.Page(2); err != nil || string(data) != "page ten" {
		t.Fatalf("page 2 again: %q %v", data, err)
	}
	if data, _, err := r.Page(0); err != nil || string(data) != "page one" {
		t.Fatalf("page 0 again: %q %v", data, err)
	}
}

func TestNativeRarNonSolid(t *testing.T) {
	p := filepath.Join(t.TempDir(), "book.cbr")
	rar4Store(t, p, fixturePages, []string{"vol/010.jpg", "vol/info.txt", "vol/002.png", "vol/001.jpg"}, false)
	r, err := OpenRar("", p)
	if err != nil {
		t.Fatal(err)
	}
	if !r.native {
		t.Fatal("expected the built-in decoder")
	}
	checkPages(t, r)
}

func TestNativeRarSolid(t *testing.T) {
	p := filepath.Join(t.TempDir(), "book.cbr")
	rar4Store(t, p, fixturePages, []string{"vol/010.jpg", "vol/info.txt", "vol/002.png", "vol/001.jpg"}, true)
	r, err := OpenRar("", p)
	if err != nil {
		t.Fatal(err)
	}
	checkPages(t, r)
}

func TestOpenSniffsZipNamedCbr(t *testing.T) {
	dir := t.TempDir()
	// A ZIP with a .cbr extension: the magic bytes must win.
	zipPath := filepath.Join(dir, "really-a-zip.cbr")
	writeZip(t, zipPath, map[string][]byte{"b.jpg": []byte("B"), "a.jpg": []byte("A")})
	b, err := Open("cbr", "", zipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if b.Len() != 2 {
		t.Fatalf("len %d", b.Len())
	}
	if data, name, _ := b.Page(0); string(data) != "A" || name != "a.jpg" {
		t.Fatalf("%q %q", data, name)
	}
	if Sniff(zipPath) != FormatZip {
		t.Fatal("sniff")
	}
	rarPath := filepath.Join(dir, "really-a-rar.cbz")
	rar4Store(t, rarPath, fixturePages, []string{"vol/001.jpg"}, false)
	if Sniff(rarPath) != FormatRar {
		t.Fatal("sniff rar")
	}
	if _, err := Open("cbz", "", rarPath); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenSevenZ("", rarPath); err != ErrNo7z {
		t.Fatalf("7z without tool: %v", err)
	}
}

func TestSevenZipListingUses7zAndCache(t *testing.T) {
	sevenZip, err := exec.LookPath("7z")
	if err != nil {
		t.Skip("7z not installed")
	}
	dir := t.TempDir()
	p := filepath.Join(dir, "book.cbr")
	rar4Store(t, p, fixturePages, []string{"vol/010.jpg", "vol/info.txt", "vol/002.png", "vol/001.jpg"}, true)
	r, err := OpenRar(sevenZip, p)
	if err != nil {
		t.Fatal(err)
	}
	if r.native {
		t.Fatal("expected 7-Zip listing")
	}
	checkPages(t, r)
	key, _ := cacheKey(p)
	if _, hit := listCache.get(key); !hit {
		t.Fatal("listing was not cached")
	}
	// A rewritten file gets a fresh listing.
	rar4Store(t, p, map[string][]byte{"x.jpg": []byte("X")}, []string{"x.jpg"}, false)
	os.Chtimes(p, key.modTime().Add(2e9), key.modTime().Add(2e9))
	r2, err := OpenRar(sevenZip, p)
	if err != nil {
		t.Fatal(err)
	}
	if len(r2.Pages) != 1 || r2.Pages[0] != "x.jpg" {
		t.Fatalf("stale listing: %v", r2.Pages)
	}
}

func TestPageListCacheBounded(t *testing.T) {
	c := &pageListCache{limit: 2, m: map[listKey][]string{}}
	c.put(listKey{path: "a"}, []string{"1"})
	c.put(listKey{path: "b"}, []string{"2"})
	c.put(listKey{path: "c"}, []string{"3"})
	if _, ok := c.get(listKey{path: "a"}); ok {
		t.Fatal("oldest entry should be evicted")
	}
	if len(c.m) != 2 || len(c.order) != 2 {
		t.Fatalf("size %d/%d", len(c.m), len(c.order))
	}
	c.put(listKey{path: "b", size: 9}, []string{"2b"})
	if _, ok := c.get(listKey{path: "b"}); ok {
		t.Fatal("old version of the same path should be dropped")
	}
}

func writeZip(t *testing.T, dst string, files map[string][]byte) {
	t.Helper()
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	for name, data := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		w.Write(data)
	}
	zw.Close()
	if err := os.WriteFile(dst, b.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func (k listKey) modTime() time.Time { return time.Unix(0, k.mtime) }
