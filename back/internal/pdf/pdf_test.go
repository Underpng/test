package pdf

import (
	"bytes"
	"compress/zlib"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
)

// build writes a PDF whose body objects are given as raw text/bytes, with
// a trailer that names the Info object (0 = none).
func build(t *testing.T, objects [][]byte, infoNum int) string {
	t.Helper()
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")
	offsets := make([]int, len(objects)+1)
	for i, o := range objects {
		offsets[i+1] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n", i+1)
		b.Write(o)
		b.WriteString("\nendobj\n")
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, off := range offsets[1:] {
		fmt.Fprintf(&b, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R", len(objects)+1)
	if infoNum > 0 {
		fmt.Fprintf(&b, " /Info %d 0 R", infoNum)
	}
	fmt.Fprintf(&b, " >>\nstartxref\n%d\n%%%%EOF\n", xref)
	p := filepath.Join(t.TempDir(), "book.pdf")
	if err := os.WriteFile(p, b.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func stream(dict string, data []byte, withLength bool) []byte {
	var b bytes.Buffer
	if withLength {
		fmt.Fprintf(&b, "<< %s /Length %d >>\nstream\n", dict, len(data))
	} else {
		fmt.Fprintf(&b, "<< %s /Length 9 0 R >>\r\nstream\r\n", dict)
	}
	b.Write(data)
	b.WriteString("\nendstream")
	return b.Bytes()
}

func jpegBytes(t *testing.T, w, h int, c color.Color) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 80}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestFirstImageJPEGSkipsSmallAndMask(t *testing.T) {
	logo := jpegBytes(t, 64, 64, color.RGBA{255, 0, 0, 255})
	page := jpegBytes(t, 400, 600, color.RGBA{0, 0, 255, 255})
	objs := [][]byte{
		[]byte("<< /Type /Catalog /Pages 2 0 R >>"),
		[]byte("<< /Type /Pages /Kids [] /Count 0 >>"),
		stream("/Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", logo, true),
		stream("/Type /XObject /Subtype /Image /Width 400 /Height 600 /ImageMask true", bytes.Repeat([]byte{0}, 400*600/8), true),
		stream("/Type/XObject/Subtype/Image/Width 400/Height 600/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode", page, true),
	}
	p := build(t, objs, 0)
	img, err := FirstImage(p, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 400 || b.Dy() != 600 {
		t.Fatalf("got %v", b)
	}
	r, g, bl, _ := img.At(10, 10).RGBA()
	if r>>8 > 40 || g>>8 > 40 || bl>>8 < 200 {
		t.Fatalf("expected blue page, got %d %d %d", r>>8, g>>8, bl>>8)
	}
}

func TestFirstImageFlateWithPredictorAndIndirectLength(t *testing.T) {
	const w, h = 300, 200
	// Gray gradient encoded with the PNG "Up" predictor (filter type 2).
	var rows bytes.Buffer
	prev := make([]byte, w)
	for y := 0; y < h; y++ {
		row := make([]byte, w)
		for x := 0; x < w; x++ {
			row[x] = byte((x + y) % 256)
		}
		rows.WriteByte(2)
		for x := 0; x < w; x++ {
			rows.WriteByte(row[x] - prev[x])
		}
		prev = row
	}
	var z bytes.Buffer
	zw := zlib.NewWriter(&z)
	zw.Write(rows.Bytes())
	zw.Close()
	objs := [][]byte{
		[]byte("<< /Type /Catalog >>"),
		stream(fmt.Sprintf("/Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 12 /Colors 1 /Columns %d >>", w, h, w), z.Bytes(), false),
	}
	p := build(t, objs, 0)
	img, err := FirstImage(p, Options{})
	if err != nil {
		t.Fatal(err)
	}
	g, ok := img.(*image.Gray)
	if !ok {
		t.Fatalf("expected gray image, got %T", img)
	}
	for _, pt := range [][2]int{{0, 0}, {10, 5}, {299, 199}, {255, 1}} {
		want := byte((pt[0] + pt[1]) % 256)
		if got := g.GrayAt(pt[0], pt[1]).Y; got != want {
			t.Fatalf("pixel %v: got %d want %d", pt, got, want)
		}
	}
}

func TestFirstImageNoneFound(t *testing.T) {
	objs := [][]byte{
		[]byte("<< /Type /Catalog >>"),
		stream("/Type /XObject /Subtype /Image /Width 800 /Height 1200 /Filter /JPXDecode", []byte("not really jpx"), true),
	}
	p := build(t, objs, 0)
	if _, err := FirstImage(p, Options{}); err != ErrNoImage {
		t.Fatalf("expected ErrNoImage, got %v", err)
	}
}

func TestReadInfoDictionary(t *testing.T) {
	// Title as UTF-16BE hex, author as a literal with escapes and nested parens.
	title := "<FEFF" + "30C6" + "30B9" + "30C8" + "0020" + "7B2C" + "0031" + "5DFB" + ">" // テスト 第1巻
	objs := [][]byte{
		[]byte("<< /Type /Catalog /Outlines 3 0 R >>"),
		[]byte("<< /Title " + title + " /Author (Yama\\(neko\\) \\101uthor) /Keywords (manga, scan ,, test) /Producer (x) >>"),
		[]byte("<< /Title (Chapter 1) /Count 1 >>"), // an outline item must not win
	}
	p := build(t, objs, 2)
	info, err := ReadInfo(p)
	if err != nil {
		t.Fatal(err)
	}
	if info.Title != "テスト 第1巻" {
		t.Fatalf("title %q", info.Title)
	}
	if info.Author != "Yama(neko) Author" {
		t.Fatalf("author %q", info.Author)
	}
	if len(info.Keywords) != 3 || info.Keywords[0] != "manga" || info.Keywords[2] != "test" {
		t.Fatalf("keywords %q", info.Keywords)
	}
}

func TestReadInfoXMPFallback(t *testing.T) {
	xmp := `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">XMP &amp; Title</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>Someone</rdf:li></rdf:Seq></dc:creator>
<dc:subject><rdf:Bag><rdf:li>a</rdf:li><rdf:li>b</rdf:li></rdf:Bag></dc:subject>
</rdf:Description></rdf:RDF></x:xmpmeta>`
	objs := [][]byte{
		[]byte("<< /Type /Catalog /Metadata 2 0 R >>"),
		stream("/Type /Metadata /Subtype /XML", []byte(xmp), true),
	}
	p := build(t, objs, 0)
	info, err := ReadInfo(p)
	if err != nil {
		t.Fatal(err)
	}
	if info.Title != "XMP & Title" || info.Author != "Someone" || len(info.Keywords) != 2 {
		t.Fatalf("got %+v", info)
	}
}

func TestReadInfoEmptyWhenAbsent(t *testing.T) {
	p := build(t, [][]byte{[]byte("<< /Type /Catalog >>")}, 0)
	info, err := ReadInfo(p)
	if err != nil {
		t.Fatal(err)
	}
	if info.Title != "" || info.Author != "" || len(info.Keywords) != 0 {
		t.Fatalf("got %+v", info)
	}
}

func TestParseDictAndReadValue(t *testing.T) {
	d := parseDict([]byte(`<< /Width 10 /Filter [/FlateDecode /DCTDecode] /Length 12 0 R /DecodeParms << /Predictor 15 >> /Name /Foo /S (a(b)c) >>`))
	if w, _ := d.int("Width"); w != 10 {
		t.Fatalf("width %v", d["Width"])
	}
	if f := d.names("Filter"); len(f) != 2 || f[1] != "DCTDecode" {
		t.Fatalf("filter %v", f)
	}
	if d["Length"] != "12 0 R" {
		t.Fatalf("length %q", d["Length"])
	}
	if d["DecodeParms"] != "<< /Predictor 15 >>" {
		t.Fatalf("parms %q", d["DecodeParms"])
	}
	if d["Name"] != "/Foo" || d["S"] != "(a(b)c)" {
		t.Fatalf("%q %q", d["Name"], d["S"])
	}
}

func TestWindowFindAcrossBoundary(t *testing.T) {
	data := bytes.Repeat([]byte("x"), windowSize-3)
	data = append(data, []byte("needle")...)
	data = append(data, bytes.Repeat([]byte("y"), 100)...)
	w := newWindow(bytes.NewReader(data), int64(len(data)))
	if got := w.find([]byte("needle"), 0); got != int64(windowSize-3) {
		t.Fatalf("find got %d", got)
	}
	if got := w.findLast([]byte("needle")); got != int64(windowSize-3) {
		t.Fatalf("findLast got %d", got)
	}
	if got := w.find([]byte("absent"), 0); got != -1 {
		t.Fatalf("absent got %d", got)
	}
}
