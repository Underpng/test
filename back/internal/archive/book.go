package archive

import "fmt"

// Book is an opened comic archive with its pages in reading order.
type Book interface {
	Len() int
	// Page returns the bytes and entry name of the i-th page (0-based).
	Page(i int) ([]byte, string, error)
	Close() error
}

// Open opens a comic archive. kind is the API kind ("cbz" or "cbr") and
// only decides the fallback when the file's magic bytes are unreadable:
// a ZIP named .cbr opens as a ZIP and vice versa.
func Open(kind, sevenZip, path string) (Book, error) {
	switch Sniff(path) {
	case FormatZip:
		return OpenZip(path)
	case FormatRar:
		return OpenRar(sevenZip, path)
	case FormatSevenZ:
		return OpenSevenZ(sevenZip, path)
	}
	switch kind {
	case "cbz":
		return OpenZip(path)
	case "cbr":
		return OpenRar(sevenZip, path)
	}
	return nil, fmt.Errorf("unsupported archive kind %q", kind)
}

func (z *Zip) Len() int { return len(z.Pages) }
