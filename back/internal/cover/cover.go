// Package cover renders JPEG thumbnails for books.
package cover

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"

	_ "image/gif"
	_ "image/png"

	_ "golang.org/x/image/bmp"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"

	"shelf/internal/archive"
)

type Options struct {
	Size     int // width in pixels of the short side
	Quality  int // JPEG quality 1-100
	SevenZip string
	PdfToPpm string // path to poppler's pdftoppm, "" when unavailable
}

var ErrNoTool = errors.New("required external tool is not available")

// Extract renders the cover of the book at src into the JPEG file dst.
func Extract(src, bookType, dst string, opt Options) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	var data []byte
	var err error
	switch bookType {
	case "CBZ":
		data, err = firstZipImage(src)
	case "CBR":
		data, err = firstRarImage(src, opt.SevenZip)
	case "EPUB":
		data, err = epubCover(src)
	case "PDF":
		return pdfCover(src, dst, opt)
	default:
		return fmt.Errorf("unsupported type %q", bookType)
	}
	if err != nil {
		return err
	}
	return FromBytes(data, dst, opt)
}

// FromBytes decodes an image, scales it down and writes it as JPEG.
func FromBytes(data []byte, dst string, opt Options) error {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("decode image: %w", err)
	}
	return Save(img, dst, opt)
}

func Save(img image.Image, dst string, opt Options) error {
	img = shrink(img, opt.Size)
	tmp := dst + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	q := opt.Quality
	if q <= 0 || q > 100 {
		q = 75
	}
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: q}); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

func shrink(img image.Image, size int) image.Image {
	if size <= 0 {
		return img
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	short := w
	if h < w {
		short = h
	}
	if short <= size {
		return img
	}
	scale := float64(size) / float64(short)
	dst := image.NewRGBA(image.Rect(0, 0, int(float64(w)*scale), int(float64(h)*scale)))
	draw.CatmullRom.Scale(dst, dst.Rect, img, b, draw.Src, nil)
	return dst
}

func firstZipImage(src string) ([]byte, error) {
	z, err := archive.OpenZip(src)
	if err != nil {
		return nil, err
	}
	defer z.Close()
	if len(z.Pages) == 0 {
		return nil, errors.New("no images in archive")
	}
	data, _, err := z.Page(0)
	return data, err
}

func firstRarImage(src, sevenZip string) ([]byte, error) {
	r, err := archive.OpenRar(sevenZip, src)
	if err != nil {
		return nil, err
	}
	if len(r.Pages) == 0 {
		return nil, errors.New("no images in archive")
	}
	data, _, err := r.Page(0)
	return data, err
}

// epubCover looks for the cover declared in the OPF package, falling back
// to the first image in the archive.
func epubCover(src string) ([]byte, error) {
	if name := epubCoverEntry(src); name != "" {
		if data, err := archive.ReadZipEntry(src, name); err == nil {
			return data, nil
		}
	}
	z, err := archive.OpenZip(src)
	if err != nil {
		return nil, err
	}
	defer z.Close()
	if len(z.Pages) == 0 {
		return nil, errors.New("no images in epub")
	}
	// Prefer an entry that is literally called cover, else the first page.
	for i, p := range z.Pages {
		if strings.Contains(strings.ToLower(path.Base(p.Name)), "cover") {
			data, _, err := z.Page(i)
			return data, err
		}
	}
	data, _, err := z.Page(0)
	return data, err
}

func epubCoverEntry(src string) string {
	container, err := archive.ReadZipEntry(src, "META-INF/container.xml")
	if err != nil {
		return ""
	}
	var c struct {
		Rootfiles struct {
			Rootfile []struct {
				FullPath string `xml:"full-path,attr"`
			} `xml:"rootfile"`
		} `xml:"rootfiles"`
	}
	if xml.Unmarshal(container, &c) != nil || len(c.Rootfiles.Rootfile) == 0 {
		return ""
	}
	opfPath := c.Rootfiles.Rootfile[0].FullPath
	opf, err := archive.ReadZipEntry(src, opfPath)
	if err != nil {
		return ""
	}
	var pkg struct {
		Metadata struct {
			Meta []struct {
				Name    string `xml:"name,attr"`
				Content string `xml:"content,attr"`
			} `xml:"meta"`
		} `xml:"metadata"`
		Manifest struct {
			Item []struct {
				ID         string `xml:"id,attr"`
				Href       string `xml:"href,attr"`
				MediaType  string `xml:"media-type,attr"`
				Properties string `xml:"properties,attr"`
			} `xml:"item"`
		} `xml:"manifest"`
	}
	if xml.Unmarshal(opf, &pkg) != nil {
		return ""
	}
	coverID := ""
	for _, m := range pkg.Metadata.Meta {
		if m.Name == "cover" {
			coverID = m.Content
		}
	}
	base := path.Dir(opfPath)
	for _, it := range pkg.Manifest.Item {
		if strings.Contains(it.Properties, "cover-image") || (coverID != "" && it.ID == coverID) {
			if strings.HasPrefix(it.MediaType, "image/") {
				return path.Join(base, it.Href)
			}
		}
	}
	return ""
}

// pdfCover renders page one through poppler's pdftoppm when available.
func pdfCover(src, dst string, opt Options) error {
	if opt.PdfToPpm == "" {
		return fmt.Errorf("pdf cover: %w (pdftoppm)", ErrNoTool)
	}
	prefix := dst + ".tmp"
	cmd := exec.Command(opt.PdfToPpm, "-f", "1", "-l", "1", "-r", "72", "-jpeg", "-singlefile", src, prefix)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("pdftoppm: %v: %s", err, out)
	}
	tmp := prefix + ".jpg"
	defer os.Remove(tmp)
	data, err := os.ReadFile(tmp)
	if err != nil {
		return err
	}
	return FromBytes(data, dst, opt)
}
