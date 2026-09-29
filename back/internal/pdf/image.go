package pdf

import (
	"bytes"
	"compress/zlib"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"strconv"
	"strings"
)

// Options for FirstImage.
type Options struct {
	// MinSize rejects images narrower or shorter than this many pixels, so
	// logos and decorations are skipped. 0 means 200.
	MinSize int
	// MaxImages caps how many image objects are examined. 0 means 64.
	MaxImages int
}

// FirstImage returns the first page-sized image in file order. Scanned
// books store one image per page in page order, so this is the cover.
// JPEG (DCTDecode) and raw or Flate-compressed 8-bit Gray/RGB/CMYK
// images are understood; JPEG 2000, JBIG2 and CCITT images are skipped.
func FirstImage(path string, opt Options) (image.Image, error) {
	w, f, err := openWindow(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return firstImage(w, opt)
}

func firstImage(w *window, opt Options) (image.Image, error) {
	minSize := opt.MinSize
	if minSize <= 0 {
		minSize = 200
	}
	maxImages := opt.MaxImages
	if maxImages <= 0 {
		maxImages = 64
	}
	pat := []byte("/Image")
	var from int64
	for examined := 0; examined < maxImages; {
		off := w.find(pat, from)
		if off < 0 {
			break
		}
		from = off + int64(len(pat))
		// "/Image" must be a whole name (not /ImageMask, /ImageB ...).
		if tail := w.read(from, 1); len(tail) == 1 && !isDelim(tail[0]) {
			continue
		}
		img, ok := imageObjectAround(w, off, minSize)
		if img == nil && !ok {
			continue
		}
		examined++
		if img != nil {
			return img, nil
		}
	}
	return nil, ErrNoImage
}

// imageObjectAround decodes the image XObject whose dictionary contains
// the "/Image" name at off. ok reports that an image dictionary was found
// (even if it could not be decoded), so callers can count it.
func imageObjectAround(w *window, off int64, minSize int) (img image.Image, ok bool) {
	// The dictionary starts at the last "obj" before off (within 2 KB) and
	// ends at the "stream" keyword after it (within 4 KB).
	const back, fwd = 2048, 4096
	start := off - back
	if start < 0 {
		start = 0
	}
	head := w.read(start, off-start)
	i := bytes.LastIndex(head, []byte(" obj"))
	if i < 0 {
		return nil, false
	}
	dictStart := start + int64(i) + 4
	tail := w.read(dictStart, fwd)
	j := bytes.Index(tail, []byte("stream"))
	if j < 0 {
		return nil, false
	}
	// Skip "endstream" of a previous object if the search overshot.
	if k := bytes.Index(tail, []byte("endobj")); k >= 0 && k < j {
		return nil, false
	}
	dictText := tail[:j]
	d := parseDict(dictText)
	if d["Subtype"] != "/Image" {
		return nil, false
	}
	if d["ImageMask"] == "true" {
		return nil, true
	}
	width, okW := d.int("Width")
	height, okH := d.int("Height")
	if !okW || !okH || width < minSize || height < minSize {
		return nil, true
	}
	// Stream data begins after "stream" and a CRLF or LF.
	dataOff := dictStart + int64(j) + int64(len("stream"))
	if b := w.read(dataOff, 2); len(b) == 2 && b[0] == '\r' && b[1] == '\n' {
		dataOff += 2
	} else if len(b) >= 1 && b[0] == '\n' {
		dataOff++
	}
	var length int64
	if n, ok := d.int("Length"); ok {
		length = int64(n)
	} else {
		end := w.find([]byte("endstream"), dataOff)
		if end < 0 {
			return nil, true
		}
		length = end - dataOff
		// Trim the EOL that precedes "endstream".
		for length > 0 {
			c := w.read(dataOff+length-1, 1)
			if len(c) == 1 && (c[0] == '\r' || c[0] == '\n') {
				length--
				continue
			}
			break
		}
	}
	if length <= 0 || length > 256<<20 {
		return nil, true
	}
	data := w.read(dataOff, length)

	filters := d.names("Filter")
	switch {
	case len(filters) == 0:
		return rawImage(data, d, width, height), true
	case filters[len(filters)-1] == "DCTDecode":
		if len(filters) > 1 {
			return nil, true // JPEG wrapped in another filter: rare, skip
		}
		img, err := jpeg.Decode(bytes.NewReader(data))
		if err != nil {
			return nil, true
		}
		return img, true
	case len(filters) == 1 && filters[0] == "FlateDecode":
		zr, err := zlib.NewReader(bytes.NewReader(data))
		if err != nil {
			return nil, true
		}
		raw, err := io.ReadAll(io.LimitReader(zr, 512<<20))
		if err != nil && len(raw) == 0 {
			return nil, true
		}
		raw = unpredict(raw, d, width)
		return rawImage(raw, d, width, height), true
	}
	return nil, true // JPX, JBIG2, CCITT, LZW, RunLength...
}

// rawImage builds an image from uncompressed 8-bit samples. The component
// count comes from the colour space when it is a device space, otherwise
// from the data length.
func rawImage(raw []byte, d dict, width, height int) image.Image {
	if bpc, ok := d.int("BitsPerComponent"); ok && bpc != 8 {
		return nil
	}
	comps := 0
	switch cs := d["ColorSpace"]; {
	case cs == "/DeviceGray" || cs == "/CalGray":
		comps = 1
	case cs == "/DeviceRGB" || cs == "/CalRGB":
		comps = 3
	case cs == "/DeviceCMYK":
		comps = 4
	case strings.HasPrefix(cs, "[/Indexed"):
		return nil
	default:
		if width*height > 0 {
			comps = len(raw) / (width * height)
		}
	}
	if comps < 1 || comps > 4 || len(raw) < width*height*comps {
		return nil
	}
	// Decode [1 0] inverts samples.
	invert := strings.HasPrefix(strings.ReplaceAll(d["Decode"], " ", ""), "[10")
	stride := width * comps
	switch comps {
	case 1:
		img := image.NewGray(image.Rect(0, 0, width, height))
		for y := 0; y < height; y++ {
			copy(img.Pix[y*img.Stride:], raw[y*stride:y*stride+width])
		}
		if invert {
			for i := range img.Pix {
				img.Pix[i] = ^img.Pix[i]
			}
		}
		return img
	case 3:
		img := image.NewRGBA(image.Rect(0, 0, width, height))
		for y := 0; y < height; y++ {
			src := raw[y*stride : y*stride+stride]
			dst := img.Pix[y*img.Stride:]
			for x := 0; x < width; x++ {
				dst[x*4], dst[x*4+1], dst[x*4+2], dst[x*4+3] = src[x*3], src[x*3+1], src[x*3+2], 255
			}
		}
		return img
	case 4:
		img := image.NewRGBA(image.Rect(0, 0, width, height))
		for y := 0; y < height; y++ {
			src := raw[y*stride : y*stride+stride]
			for x := 0; x < width; x++ {
				c, m, yy, k := src[x*4], src[x*4+1], src[x*4+2], src[x*4+3]
				if invert {
					c, m, yy, k = ^c, ^m, ^yy, ^k
				}
				r, g, b := color.CMYKToRGB(c, m, yy, k)
				i := y*img.Stride + x*4
				img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = r, g, b, 255
			}
		}
		return img
	case 2:
		// Gray + alpha is not a PDF colour space; treat as gray with padding.
		img := image.NewGray(image.Rect(0, 0, width, height))
		for y := 0; y < height; y++ {
			for x := 0; x < width; x++ {
				img.Pix[y*img.Stride+x] = raw[(y*width+x)*2]
			}
		}
		return img
	}
	return nil
}

// unpredict undoes PNG predictors (DecodeParms /Predictor >= 10), which
// some producers apply before Flate. TIFF predictor 2 is left alone.
func unpredict(raw []byte, d dict, width int) []byte {
	parms := parseDict([]byte(d["DecodeParms"]))
	pred, _ := parms.int("Predictor")
	if pred < 10 {
		return raw
	}
	colors := 1
	if c, ok := parms.int("Colors"); ok {
		colors = c
	}
	if c, ok := parms.int("Columns"); ok {
		width = c
	}
	bpp := colors // bytes per pixel at 8 bpc
	rowLen := width * colors
	rows := len(raw) / (rowLen + 1)
	out := make([]byte, 0, rows*rowLen)
	prev := make([]byte, rowLen)
	for r := 0; r < rows; r++ {
		ft := raw[r*(rowLen+1)]
		row := append([]byte(nil), raw[r*(rowLen+1)+1:(r+1)*(rowLen+1)]...)
		for i := 0; i < rowLen; i++ {
			var a, b, c byte
			if i >= bpp {
				a = row[i-bpp]
				c = prev[i-bpp]
			}
			b = prev[i]
			switch ft {
			case 1:
				row[i] += a
			case 2:
				row[i] += b
			case 3:
				row[i] += byte((int(a) + int(b)) / 2)
			case 4:
				row[i] += paeth(a, b, c)
			}
		}
		out = append(out, row...)
		prev = row
	}
	return out
}

func paeth(a, b, c byte) byte {
	p := int(a) + int(b) - int(c)
	pa, pb, pc := abs(p-int(a)), abs(p-int(b)), abs(p-int(c))
	if pa <= pb && pa <= pc {
		return a
	}
	if pb <= pc {
		return b
	}
	return c
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// itoa is used by tests.
func itoa(n int) string { return strconv.Itoa(n) }
