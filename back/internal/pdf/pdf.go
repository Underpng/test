// Package pdf pulls a cover image and the document information out of a
// PDF without any external tool. It does not parse the cross-reference
// table: it scans the file for the objects it needs, which is enough for
// scanned books (one JPEG per page) and for the Info dictionary of most
// producers. Files are read through a small sliding window, so memory
// stays flat no matter how large the book is.
package pdf

import (
	"bytes"
	"errors"
	"io"
	"os"
	"regexp"
	"strconv"
)

// ErrNoImage is returned when no usable page image was found.
var ErrNoImage = errors.New("pdf: no page image found")

// window reads a file through a bounded buffer and searches it for byte
// patterns without loading the whole file.
type window struct {
	r    io.ReaderAt
	size int64
	buf  []byte
	off  int64 // file offset of buf[0]
	n    int   // valid bytes in buf
}

const windowSize = 1 << 20

func newWindow(r io.ReaderAt, size int64) *window {
	return &window{r: r, size: size, buf: make([]byte, windowSize)}
}

// find returns the offset of the first occurrence of pat at or after from,
// or -1.
func (w *window) find(pat []byte, from int64) int64 {
	if len(pat) == 0 || from < 0 {
		return -1
	}
	for from < w.size {
		n, err := w.r.ReadAt(w.buf, from)
		if n < len(pat) {
			return -1
		}
		if i := bytes.Index(w.buf[:n], pat); i >= 0 {
			return from + int64(i)
		}
		if err != nil {
			return -1
		}
		// Keep an overlap so a match straddling two reads is not lost.
		from += int64(n - len(pat) + 1)
	}
	return -1
}

// findLast returns the offset of the last occurrence of pat, or -1.
func (w *window) findLast(pat []byte) int64 {
	end := w.size
	for end > 0 {
		start := end - int64(len(w.buf))
		if start < 0 {
			start = 0
		}
		n, err := w.r.ReadAt(w.buf[:end-start], start)
		if n < len(pat) {
			return -1
		}
		if i := bytes.LastIndex(w.buf[:n], pat); i >= 0 {
			return start + int64(i)
		}
		if err != nil && err != io.EOF {
			return -1
		}
		if start == 0 {
			return -1
		}
		end = start + int64(len(pat)) - 1
	}
	return -1
}

// read returns up to n bytes at off (fewer at end of file).
func (w *window) read(off, n int64) []byte {
	if off < 0 || off >= w.size || n <= 0 {
		return nil
	}
	if off+n > w.size {
		n = w.size - off
	}
	b := make([]byte, n)
	m, _ := w.r.ReadAt(b, off)
	return b[:m]
}

func openWindow(path string) (*window, *os.File, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, nil, err
	}
	return newWindow(f, st.Size()), f, nil
}

// ----- tiny dictionary reader -----

// dict is a flat view of a PDF dictionary: names map to their raw value
// text. Nested dictionaries and arrays are kept as text.
type dict map[string]string

var nameRe = regexp.MustCompile(`/([^\s/\[\]<>(){}%]+)`)

// parseDict extracts key/value pairs from the text of one dictionary
// (from its "<<" to the matching ">>"). It is deliberately forgiving.
func parseDict(text []byte) dict {
	d := dict{}
	// Strip the outer << >> if present.
	if i := bytes.Index(text, []byte("<<")); i >= 0 {
		text = text[i+2:]
	}
	i := 0
	for i < len(text) {
		loc := nameRe.FindIndex(text[i:])
		if loc == nil {
			break
		}
		key := string(text[i+loc[0]+1 : i+loc[1]])
		i += loc[1]
		val, next := readValue(text, i)
		d[key] = string(bytes.TrimSpace(val))
		i = next
		if i >= len(text) {
			break
		}
	}
	return d
}

// readValue returns the raw text of the value starting at text[i:] and the
// index just after it. Composite values (dict, array, string) are returned
// whole; simple values run until the next delimiter.
func readValue(text []byte, i int) ([]byte, int) {
	for i < len(text) && isSpace(text[i]) {
		i++
	}
	if i >= len(text) {
		return nil, i
	}
	start := i
	switch {
	case bytes.HasPrefix(text[i:], []byte("<<")):
		depth := 0
		for i < len(text) {
			if bytes.HasPrefix(text[i:], []byte("<<")) {
				depth++
				i += 2
				continue
			}
			if bytes.HasPrefix(text[i:], []byte(">>")) {
				depth--
				i += 2
				if depth == 0 {
					return text[start:i], i
				}
				continue
			}
			i++
		}
		return text[start:], i
	case text[i] == '[':
		depth := 0
		for i < len(text) {
			switch text[i] {
			case '[':
				depth++
			case ']':
				depth--
				if depth == 0 {
					return text[start : i+1], i + 1
				}
			case '(':
				_, j := readLiteral(text, i)
				i = j
				continue
			}
			i++
		}
		return text[start:], i
	case text[i] == '(':
		_, j := readLiteral(text, i)
		return text[start:j], j
	case text[i] == '<':
		j := bytes.IndexByte(text[i:], '>')
		if j < 0 {
			return text[start:], len(text)
		}
		return text[start : i+j+1], i + j + 1
	case text[i] == '/':
		i++
		for i < len(text) && !isDelim(text[i]) {
			i++
		}
		return text[start:i], i
	default:
		// number, bool, null or an indirect reference "12 0 R"
		for i < len(text) && !isDelim(text[i]) {
			i++
		}
		// An indirect reference is three tokens; join them.
		rest := text[i:]
		if m := refTail.FindIndex(rest); m != nil && m[0] == 0 {
			i += m[1]
		}
		return text[start:i], i
	}
}

var refTail = regexp.MustCompile(`^\s+\d+\s+R\b`)

// readLiteral returns a literal string "( ... )" (with escapes resolved)
// starting at text[i] == '(' and the index after its closing paren.
func readLiteral(text []byte, i int) ([]byte, int) {
	var out []byte
	depth := 0
	for i < len(text) {
		c := text[i]
		switch c {
		case '\\':
			i++
			if i >= len(text) {
				return out, i
			}
			e := text[i]
			switch e {
			case 'n':
				out = append(out, '\n')
			case 'r':
				out = append(out, '\r')
			case 't':
				out = append(out, '\t')
			case 'b':
				out = append(out, '\b')
			case 'f':
				out = append(out, '\f')
			case '\n':
				// line continuation
			case '\r':
				if i+1 < len(text) && text[i+1] == '\n' {
					i++
				}
			default:
				if e >= '0' && e <= '7' {
					v := 0
					n := 0
					for n < 3 && i < len(text) && text[i] >= '0' && text[i] <= '7' {
						v = v*8 + int(text[i]-'0')
						i++
						n++
					}
					out = append(out, byte(v))
					continue
				}
				out = append(out, e)
			}
			i++
		case '(':
			if depth > 0 {
				out = append(out, c)
			}
			depth++
			i++
		case ')':
			depth--
			i++
			if depth == 0 {
				return out, i
			}
			out = append(out, c)
		default:
			out = append(out, c)
			i++
		}
	}
	return out, i
}

func isSpace(c byte) bool {
	return c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == '\f' || c == 0
}

func isDelim(c byte) bool {
	return isSpace(c) || c == '/' || c == '[' || c == ']' || c == '<' || c == '>' || c == '(' || c == ')' || c == '{' || c == '}' || c == '%'
}

func (d dict) int(key string) (int, bool) {
	v, ok := d[key]
	if !ok {
		return 0, false
	}
	n, err := strconv.Atoi(v)
	return n, err == nil
}

// names returns the name tokens in a value, e.g. "/DCTDecode" or
// "[/FlateDecode /DCTDecode]" -> ["DCTDecode"] / ["FlateDecode","DCTDecode"].
func (d dict) names(key string) []string {
	v, ok := d[key]
	if !ok {
		return nil
	}
	var out []string
	for _, m := range nameRe.FindAllStringSubmatch(v, -1) {
		out = append(out, m[1])
	}
	return out
}

// objectAt finds "<num> <gen> obj" and returns the offset just after "obj".
func (w *window) objectAt(num, gen int) int64 {
	pat := []byte(strconv.Itoa(num) + " " + strconv.Itoa(gen) + " obj")
	var from int64
	for {
		off := w.find(pat, from)
		if off < 0 {
			return -1
		}
		// Make sure we did not match the tail of a longer number.
		if off == 0 || isDelim(w.read(off-1, 1)[0]) {
			return off + int64(len(pat))
		}
		from = off + 1
	}
}
