package pdf

import (
	"bytes"
	"html"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
)

// Info is the document information of a PDF.
type Info struct {
	Title    string
	Author   string
	Keywords []string
}

// ReadInfo returns the title, author and keywords from the Info
// dictionary, falling back to the XMP metadata stream. Fields the file
// does not carry are left empty.
func ReadInfo(path string) (Info, error) {
	w, f, err := openWindow(path)
	if err != nil {
		return Info{}, err
	}
	defer f.Close()
	return readInfo(w), nil
}

var infoRefRe = regexp.MustCompile(`/Info\s+(\d+)\s+(\d+)\s+R`)

func readInfo(w *window) Info {
	var info Info
	if d := infoDict(w); d != nil {
		info.Title = decodeString(d["Title"])
		info.Author = decodeString(d["Author"])
		for _, k := range strings.Split(decodeString(d["Keywords"]), ",") {
			if k = strings.TrimSpace(k); k != "" {
				info.Keywords = append(info.Keywords, k)
			}
		}
	}
	if info.Title == "" || info.Author == "" {
		x := xmpInfo(w)
		if info.Title == "" {
			info.Title = x.Title
		}
		if info.Author == "" {
			info.Author = x.Author
		}
		if len(info.Keywords) == 0 {
			info.Keywords = x.Keywords
		}
	}
	return info
}

// infoDict locates the Info dictionary through the last trailer (or
// cross-reference stream) that names it. Returns nil when it lives in a
// compressed object stream, which this reader does not open.
func infoDict(w *window) dict {
	// The last trailer wins after incremental updates. Look at the final
	// 64 KB first, then the whole file.
	tailStart := w.size - 64<<10
	if tailStart < 0 {
		tailStart = 0
	}
	tail := w.read(tailStart, w.size-tailStart)
	m := lastMatch(infoRefRe, tail)
	if m == nil {
		off := w.findLast([]byte("/Info"))
		if off < 0 {
			return nil
		}
		m = infoRefRe.FindSubmatch(w.read(off, 64))
		if m == nil {
			return nil
		}
	}
	num, _ := strconv.Atoi(string(m[1]))
	gen, _ := strconv.Atoi(string(m[2]))
	objOff := w.objectAt(num, gen)
	if objOff < 0 {
		return nil
	}
	body := w.read(objOff, 64<<10)
	if end := bytes.Index(body, []byte("endobj")); end >= 0 {
		body = body[:end]
	}
	if !bytes.Contains(body, []byte("<<")) {
		return nil
	}
	return parseDict(body)
}

func lastMatch(re *regexp.Regexp, b []byte) [][]byte {
	all := re.FindAllSubmatch(b, -1)
	if len(all) == 0 {
		return nil
	}
	return all[len(all)-1]
}

// decodeString turns the raw text of a PDF string value into Go text.
// Literal strings are PDFDocEncoding (treated as Latin-1) unless they
// start with a UTF-16BE or UTF-8 byte order mark.
func decodeString(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	var b []byte
	switch raw[0] {
	case '(':
		b, _ = readLiteral([]byte(raw), 0)
	case '<':
		hex := strings.Map(func(r rune) rune {
			if strings.ContainsRune("0123456789abcdefABCDEF", r) {
				return r
			}
			return -1
		}, raw)
		if len(hex)%2 == 1 {
			hex += "0"
		}
		b = make([]byte, 0, len(hex)/2)
		for i := 0; i+1 < len(hex); i += 2 {
			v, err := strconv.ParseUint(hex[i:i+2], 16, 8)
			if err != nil {
				return ""
			}
			b = append(b, byte(v))
		}
	default:
		return ""
	}
	return strings.TrimSpace(bytesToText(b))
}

func bytesToText(b []byte) string {
	switch {
	case len(b) >= 2 && b[0] == 0xFE && b[1] == 0xFF:
		u := make([]uint16, 0, len(b)/2)
		for i := 2; i+1 < len(b); i += 2 {
			u = append(u, uint16(b[i])<<8|uint16(b[i+1]))
		}
		return strings.TrimRight(string(utf16.Decode(u)), "\x00")
	case len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF:
		return string(b[3:])
	}
	// PDFDocEncoding: ASCII plus a Latin-1-like upper half.
	r := make([]rune, len(b))
	for i, c := range b {
		r[i] = rune(c)
	}
	return string(r)
}

// ----- XMP fallback -----

var (
	xmpTitleRe   = regexp.MustCompile(`(?s)<dc:title>.*?<rdf:li[^>]*>(.*?)</rdf:li>`)
	xmpCreatorRe = regexp.MustCompile(`(?s)<dc:creator>.*?<rdf:li[^>]*>(.*?)</rdf:li>`)
	xmpSubjectRe = regexp.MustCompile(`(?s)<rdf:li[^>]*>(.*?)</rdf:li>`)
	xmpSubjBagRe = regexp.MustCompile(`(?s)<dc:subject>(.*?)</dc:subject>`)
)

func xmpInfo(w *window) Info {
	off := w.find([]byte("<x:xmpmeta"), 0)
	if off < 0 {
		off = w.find([]byte("<rdf:RDF"), 0)
	}
	if off < 0 {
		return Info{}
	}
	x := w.read(off, 256<<10)
	if end := bytes.Index(x, []byte("</x:xmpmeta>")); end >= 0 {
		x = x[:end]
	}
	var info Info
	if m := xmpTitleRe.FindSubmatch(x); m != nil {
		info.Title = strings.TrimSpace(html.UnescapeString(string(m[1])))
	}
	if m := xmpCreatorRe.FindSubmatch(x); m != nil {
		info.Author = strings.TrimSpace(html.UnescapeString(string(m[1])))
	}
	if m := xmpSubjBagRe.FindSubmatch(x); m != nil {
		for _, k := range xmpSubjectRe.FindAllSubmatch(m[1], -1) {
			if s := strings.TrimSpace(html.UnescapeString(string(k[1]))); s != "" {
				info.Keywords = append(info.Keywords, s)
			}
		}
	}
	return info
}
