// Package resize shrinks images with a Catmull-Rom filter (the same
// quality as x/image/draw.CatmullRom) while keeping memory small.
//
// x/image/draw keeps its intermediate pass as float64 RGBA for every
// destination column of every source row (about 40 MB for one 1070x1600
// comic page). Here the two passes are separable and the intermediate is
// stored as 8-bit samples, which needs a few MB and gives the same result
// to within rounding.
package resize

import (
	"image"
	"image/color"
	"math"
	"sync"
)

// Scratch buffers are reused between pages so converting a volume does not
// keep allocating (and waiting for the GC to return) several MB per page.
var (
	bytePool  = sync.Pool{New: func() any { return new([]uint8) }}
	floatPool = sync.Pool{New: func() any { return new([]float32) }}
)

func getBytes(n int) *[]uint8 {
	p := bytePool.Get().(*[]uint8)
	if cap(*p) < n {
		*p = make([]uint8, n)
	}
	*p = (*p)[:n]
	return p
}

func getFloats(n int) *[]float32 {
	p := floatPool.Get().(*[]float32)
	if cap(*p) < n {
		*p = make([]float32, n)
	}
	*p = (*p)[:n]
	return p
}

// FitHeight scales img down so it is at most maxH pixels tall, keeping the
// aspect ratio. Images that are already small enough are returned as is.
func FitHeight(img image.Image, maxH int) image.Image {
	b := img.Bounds()
	if maxH <= 0 || b.Dy() <= maxH {
		return img
	}
	dh := maxH
	dw := int(math.Round(float64(b.Dx()) * float64(dh) / float64(b.Dy())))
	if dw < 1 {
		dw = 1
	}
	return Resize(img, dw, dh)
}

// Resize resamples img to dw x dh. Grayscale sources (including JPEGs
// whose colour planes are flat, which is what black-and-white manga pages
// are) give *image.Gray, everything else *image.RGBA.
func Resize(img image.Image, dw, dh int) image.Image {
	b := img.Bounds()
	sw, sh := b.Dx(), b.Dy()
	src := newRowReader(img)
	ch := src.channels

	hw := weights(sw, dw)
	vw := weights(sh, dh)

	// Horizontal pass: every source row -> dw samples, stored as bytes.
	interBuf := getBytes(dw * sh * ch)
	defer bytePool.Put(interBuf)
	inter := *interBuf
	rowBuf := getFloats(sw * ch)
	defer floatPool.Put(rowBuf)
	row := *rowBuf
	acc := make([]float32, ch)
	for y := 0; y < sh; y++ {
		src.read(y, row)
		out := inter[y*dw*ch : (y+1)*dw*ch]
		for x, c := range hw {
			for k := range acc {
				acc[k] = 0
			}
			base := c.start * ch
			for i, w := range c.w {
				p := row[base+i*ch : base+i*ch+ch]
				for k := range acc {
					acc[k] += w * p[k]
				}
			}
			for k := range acc {
				out[x*ch+k] = clamp8(acc[k])
			}
		}
	}

	// Vertical pass: combine whole intermediate rows (cache friendly).
	lineBuf := getFloats(dw * ch)
	defer floatPool.Put(lineBuf)
	line := *lineBuf
	var gray *image.Gray
	var rgba *image.RGBA
	if ch == 1 {
		gray = image.NewGray(image.Rect(0, 0, dw, dh))
	} else {
		rgba = image.NewRGBA(image.Rect(0, 0, dw, dh))
	}
	for y, c := range vw {
		for i := range line {
			line[i] = 0
		}
		for i, w := range c.w {
			r := inter[(c.start+i)*dw*ch : (c.start+i+1)*dw*ch]
			for j, v := range r {
				line[j] += w * float32(v)
			}
		}
		if gray != nil {
			o := gray.Pix[y*gray.Stride : y*gray.Stride+dw]
			for x := range o {
				o[x] = clamp8(line[x])
			}
			continue
		}
		o := rgba.Pix[y*rgba.Stride : y*rgba.Stride+dw*4]
		for x := 0; x < dw; x++ {
			o[x*4] = clamp8(line[x*3])
			o[x*4+1] = clamp8(line[x*3+1])
			o[x*4+2] = clamp8(line[x*3+2])
			o[x*4+3] = 0xff
		}
	}
	if gray != nil {
		return gray
	}
	return rgba
}

func clamp8(v float32) uint8 {
	v += 0.5
	if v <= 0 {
		return 0
	}
	if v >= 255 {
		return 255
	}
	return uint8(v)
}

// catmullRom is the cubic convolution kernel with a = -0.5.
func catmullRom(x float64) float64 {
	x = math.Abs(x)
	switch {
	case x < 1:
		return (1.5*x-2.5)*x*x + 1
	case x < 2:
		return ((-0.5*x+2.5)*x-4)*x + 2
	}
	return 0
}

type contrib struct {
	start int
	w     []float32
}

// weights precomputes, for every destination index, the source span and
// normalised kernel weights. When shrinking, the kernel is widened by the
// scale factor so it averages over the whole footprint (no aliasing or
// moire on screentones).
func weights(src, dst int) []contrib {
	scale := float64(src) / float64(dst)
	fs := math.Max(scale, 1)
	support := 2 * fs
	out := make([]contrib, dst)
	for i := range out {
		center := (float64(i)+0.5)*scale - 0.5
		lo := int(math.Ceil(center - support))
		hi := int(math.Floor(center + support))
		if lo < 0 {
			lo = 0
		}
		if hi > src-1 {
			hi = src - 1
		}
		ws := make([]float32, hi-lo+1)
		sum := 0.0
		for j := lo; j <= hi; j++ {
			v := catmullRom((float64(j) - center) / fs)
			ws[j-lo] = float32(v)
			sum += v
		}
		if sum != 0 {
			for k := range ws {
				ws[k] = float32(float64(ws[k]) / sum)
			}
		}
		out[i] = contrib{start: lo, w: ws}
	}
	return out
}

// rowReader converts one source row at a time to float samples, with fast
// paths for the formats comic pages actually come in.
type rowReader struct {
	img      image.Image
	min      image.Point
	width    int
	channels int
	lumaOnly bool // YCbCr with neutral chroma: read the Y plane as gray
}

func newRowReader(img image.Image) *rowReader {
	b := img.Bounds()
	r := &rowReader{img: img, min: b.Min, width: b.Dx(), channels: 3}
	switch p := img.(type) {
	case *image.Gray:
		r.channels = 1
	case *image.YCbCr:
		if neutralChroma(p) {
			r.channels, r.lumaOnly = 1, true
		}
	}
	return r
}

// neutralChroma reports whether a YCbCr image carries no visible colour.
// Scanned black-and-white pages have Cb/Cr within a few steps of 128.
func neutralChroma(p *image.YCbCr) bool {
	const tol = 6
	off := 0
	for i := range p.Cb {
		cb, cr := int(p.Cb[i])-128, int(p.Cr[i])-128
		if cb > tol || cb < -tol || cr > tol || cr < -tol {
			off++
			// allow a few stray samples (compression noise, a coloured logo dot)
			if off > len(p.Cb)/1000 {
				return false
			}
		}
	}
	return true
}

func (r *rowReader) read(y int, row []float32) {
	sy := r.min.Y + y
	if r.lumaOnly {
		p := r.img.(*image.YCbCr)
		for x := 0; x < r.width; x++ {
			row[x] = float32(p.Y[p.YOffset(r.min.X+x, sy)])
		}
		return
	}
	switch p := r.img.(type) {
	case *image.Gray:
		off := p.PixOffset(r.min.X, sy)
		for x := 0; x < r.width; x++ {
			row[x] = float32(p.Pix[off+x])
		}
	case *image.YCbCr:
		for x := 0; x < r.width; x++ {
			sx := r.min.X + x
			yi := p.YOffset(sx, sy)
			ci := p.COffset(sx, sy)
			cr, cg, cb := color.YCbCrToRGB(p.Y[yi], p.Cb[ci], p.Cr[ci])
			row[x*3], row[x*3+1], row[x*3+2] = float32(cr), float32(cg), float32(cb)
		}
	case *image.RGBA:
		off := p.PixOffset(r.min.X, sy)
		for x := 0; x < r.width; x++ {
			row[x*3] = float32(p.Pix[off+x*4])
			row[x*3+1] = float32(p.Pix[off+x*4+1])
			row[x*3+2] = float32(p.Pix[off+x*4+2])
		}
	case *image.NRGBA:
		// Pages are opaque; composite any transparency over white.
		off := p.PixOffset(r.min.X, sy)
		for x := 0; x < r.width; x++ {
			a := float32(p.Pix[off+x*4+3]) / 255
			for k := 0; k < 3; k++ {
				row[x*3+k] = float32(p.Pix[off+x*4+k])*a + 255*(1-a)
			}
		}
	default:
		for x := 0; x < r.width; x++ {
			cr, cg, cb, ca := r.img.At(r.min.X+x, sy).RGBA()
			// premultiplied: composite over white
			white := float32(0xffff-ca) / 257
			row[x*3] = float32(cr)/257 + white
			row[x*3+1] = float32(cg)/257 + white
			row[x*3+2] = float32(cb)/257 + white
		}
	}
}
