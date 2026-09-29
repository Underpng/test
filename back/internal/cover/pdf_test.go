package cover

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
)

// scannedPDF writes a one-page "scanned" PDF: a single JPEG XObject.
func scannedPDF(t *testing.T, dir string, w, h int) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{200, 30, 30, 255})
		}
	}
	var jp bytes.Buffer
	if err := jpeg.Encode(&jp, img, nil); err != nil {
		t.Fatal(err)
	}
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	b.WriteString("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
	b.WriteString("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
	b.WriteString("3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 4 0 R >> >> >>\nendobj\n")
	fmt.Fprintf(&b, "4 0 obj\n<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n", w, h, jp.Len())
	b.Write(jp.Bytes())
	b.WriteString("\nendstream\nendobj\n")
	b.WriteString("5 0 obj\n<< /Title (Scanned Book) >>\nendobj\n")
	b.WriteString("trailer\n<< /Root 1 0 R /Info 5 0 R >>\n%%EOF\n")
	p := filepath.Join(dir, "scan.pdf")
	if err := os.WriteFile(p, b.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPDFCoverWithoutPoppler(t *testing.T) {
	dir := t.TempDir()
	src := scannedPDF(t, dir, 600, 900)
	dst := filepath.Join(dir, "covers", "scan.jpg")
	if err := Extract(src, "PDF", dst, Options{Size: 120, Quality: 70}); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := jpeg.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 120 || b.Dy() != 180 {
		t.Fatalf("thumbnail %v", b)
	}
	r, g, _, _ := img.At(5, 5).RGBA()
	if r>>8 < 150 || g>>8 > 80 {
		t.Fatalf("unexpected colour %d %d", r>>8, g>>8)
	}
}

func TestPDFCoverTextOnlyFails(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "text.pdf")
	os.WriteFile(p, []byte("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"), 0o644)
	if err := Extract(p, "PDF", filepath.Join(dir, "c.jpg"), Options{}); err == nil {
		t.Fatal("expected an error for a PDF without images")
	}
}
