package archive

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
)

// Format is the container format of a comic archive as found on disk.
// Extensions lie often enough (a ".cbr" that is really a ZIP) that the
// magic bytes decide.
type Format string

const (
	FormatZip     Format = "zip"
	FormatRar     Format = "rar"
	FormatSevenZ  Format = "7z"
	FormatUnknown Format = ""
)

var (
	magicZip    = []byte("PK\x03\x04")
	magicRar    = []byte("Rar!\x1a\x07")
	magicSevenZ = []byte("7z\xbc\xaf\x27\x1c")
)

// Sniff reports the container format of the file by its leading bytes,
// falling back to the extension when the file cannot be read.
func Sniff(path string) Format {
	f, err := os.Open(path)
	if err == nil {
		defer f.Close()
		var head [8]byte
		n, _ := f.Read(head[:])
		switch {
		case bytes.HasPrefix(head[:n], magicZip):
			return FormatZip
		case bytes.HasPrefix(head[:n], magicRar):
			return FormatRar
		case bytes.HasPrefix(head[:n], magicSevenZ):
			return FormatSevenZ
		}
	}
	switch strings.ToLower(filepath.Ext(path)) {
	case ".zip", ".cbz":
		return FormatZip
	case ".rar", ".cbr":
		return FormatRar
	case ".7z", ".cb7":
		return FormatSevenZ
	}
	return FormatUnknown
}
