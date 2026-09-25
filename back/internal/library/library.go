// Package library maps API paths ("/Series/Vol 01.cbz", always forward
// slashes, rooted at the books directory) to filesystem paths and back.
package library

import (
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
)

var ErrOutside = errors.New("path escapes the library")

type Library struct {
	BooksDir string
}

func New(dir string) (*Library, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, err
	}
	return &Library{BooksDir: abs}, nil
}

// Abs converts an API path into a filesystem path inside BooksDir.
func (l *Library) Abs(rel string) (string, error) {
	return Resolve(l.BooksDir, rel)
}

// Rel converts a filesystem path inside BooksDir into an API path.
func (l *Library) Rel(abs string) (string, error) {
	r, err := filepath.Rel(l.BooksDir, abs)
	if err != nil {
		return "", err
	}
	if r == "." {
		return "/", nil
	}
	if r == ".." || strings.HasPrefix(r, ".."+string(filepath.Separator)) {
		return "", ErrOutside
	}
	return "/" + filepath.ToSlash(r), nil
}

// Resolve joins an API path onto root, refusing anything that escapes it.
func Resolve(root, rel string) (string, error) {
	rel = strings.TrimPrefix(rel, "/")
	clean := filepath.Clean(filepath.FromSlash(rel))
	if clean == "." {
		return root, nil
	}
	if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", ErrOutside
	}
	return filepath.Join(root, clean), nil
}

// Clean normalises an API path: forward slashes, leading slash, no trailing slash.
func Clean(rel string) string {
	rel = strings.ReplaceAll(rel, "\\", "/")
	if !strings.HasPrefix(rel, "/") {
		rel = "/" + rel
	}
	rel = path.Clean(rel)
	return rel
}

// Parent returns the folder containing rel ("/" for top level entries).
func Parent(rel string) string {
	i := strings.LastIndex(rel, "/")
	if i <= 0 {
		return "/"
	}
	return rel[:i]
}

// Base returns the last element of an API path.
func Base(rel string) string { return path.Base(rel) }

// TypeOf returns the book type for a filename, or "" if unsupported.
func TypeOf(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".epub":
		return "EPUB"
	case ".pdf":
		return "PDF"
	case ".cbz":
		return "CBZ"
	case ".cbr":
		return "CBR"
	}
	return ""
}

var imageMimes = map[string]string{
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".webp": "image/webp",
	".gif":  "image/gif",
	".bmp":  "image/bmp",
	".avif": "image/avif",
}

// ImageMime returns the MIME type for an image filename.
func ImageMime(name string) (string, bool) {
	m, ok := imageMimes[strings.ToLower(path.Ext(name))]
	return m, ok
}

// IsPageImage reports whether an archive entry should count as a page.
func IsPageImage(entry string) bool {
	if strings.HasPrefix(entry, "__MACOSX/") {
		return false
	}
	base := path.Base(entry)
	if strings.HasPrefix(base, ".") {
		return false
	}
	_, ok := ImageMime(base)
	return ok
}
