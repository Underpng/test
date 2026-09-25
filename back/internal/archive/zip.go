// Package archive reads comic archives: CBZ/EPUB through archive/zip and
// CBR through an external 7-Zip binary.
package archive

import (
	"archive/zip"
	"fmt"
	"io"
	"sort"

	"shelf/internal/library"
	"shelf/internal/natural"
)

// Zip is an opened CBZ with its page entries in reading order.
type Zip struct {
	rc    *zip.ReadCloser
	Pages []*zip.File
}

func OpenZip(path string) (*Zip, error) {
	rc, err := zip.OpenReader(path)
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}
	var pages []*zip.File
	for _, f := range rc.File {
		if f.FileInfo().IsDir() || !library.IsPageImage(f.Name) {
			continue
		}
		pages = append(pages, f)
	}
	sort.SliceStable(pages, func(i, j int) bool { return natural.Less(pages[i].Name, pages[j].Name) })
	return &Zip{rc: rc, Pages: pages}, nil
}

func (z *Zip) Close() error { return z.rc.Close() }

// Page returns the bytes of the i-th page (0-based) and its entry name.
func (z *Zip) Page(i int) ([]byte, string, error) {
	if i < 0 || i >= len(z.Pages) {
		return nil, "", fmt.Errorf("page %d out of range", i+1)
	}
	f := z.Pages[i]
	r, err := f.Open()
	if err != nil {
		return nil, "", err
	}
	defer r.Close()
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, "", err
	}
	return data, f.Name, nil
}

// ReadZipEntry returns the contents of one named entry (used for EPUB).
func ReadZipEntry(path, name string) ([]byte, error) {
	rc, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	for _, f := range rc.File {
		if f.Name == name {
			r, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer r.Close()
			return io.ReadAll(r)
		}
	}
	return nil, fmt.Errorf("entry %q not found", name)
}
