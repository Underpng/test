package archive

import "fmt"

// Book is an opened comic archive with its pages in reading order.
type Book interface {
	Len() int
	// Page returns the bytes and entry name of the i-th page (0-based).
	Page(i int) ([]byte, string, error)
	Close() error
}

// Open opens a CBZ ("cbz") or CBR ("cbr") file.
func Open(kind, sevenZip, path string) (Book, error) {
	switch kind {
	case "cbz":
		return OpenZip(path)
	case "cbr":
		return OpenRar(sevenZip, path)
	}
	return nil, fmt.Errorf("unsupported archive kind %q", kind)
}

func (z *Zip) Len() int { return len(z.Pages) }

func (r *Rar) Len() int { return len(r.Pages) }

// Close is a no-op: pages are extracted by separate 7-Zip processes.
func (r *Rar) Close() error { return nil }
