package resize

import (
	"image"
	"image/color"
	"math"
	"testing"

	"golang.org/x/image/draw"
)

func TestFitHeightKeepsAspectAndSmallImages(t *testing.T) {
	small := image.NewGray(image.Rect(0, 0, 100, 150))
	if FitHeight(small, 1200) != image.Image(small) {
		t.Fatal("small image should be returned unchanged")
	}
	big := image.NewRGBA(image.Rect(0, 0, 1070, 1600))
	out := FitHeight(big, 1200)
	if b := out.Bounds(); b.Dy() != 1200 || b.Dx() != 803 {
		t.Fatalf("got %v", b)
	}
}

func TestGrayStaysGrayAndFlatStaysFlat(t *testing.T) {
	src := image.NewGray(image.Rect(0, 0, 400, 600))
	for i := range src.Pix {
		src.Pix[i] = 200
	}
	out, ok := Resize(src, 150, 225).(*image.Gray)
	if !ok {
		t.Fatal("gray input should give gray output")
	}
	for _, v := range out.Pix {
		if v != 200 {
			t.Fatalf("flat area changed to %d (ringing)", v)
		}
	}
}

// The result should match x/image's Catmull-Rom closely, for both the
// monochrome (luma only) and the colour path.
func TestMatchesXImageCatmullRom(t *testing.T) {
	for _, tc := range []struct {
		name   string
		cb, cr uint8
	}{{"monochrome", 128, 128}, {"colour", 90, 170}} {
		src := image.NewYCbCr(image.Rect(0, 0, 321, 480), image.YCbCrSubsampleRatio420)
		for y := 0; y < 480; y++ {
			for x := 0; x < 321; x++ {
				// screentone-like dots
				v := uint8(128 + 100*math.Sin(float64(x)*0.9)*math.Sin(float64(y)*0.9))
				src.Y[src.YOffset(x, y)] = v
			}
		}
		for i := range src.Cb {
			src.Cb[i], src.Cr[i] = tc.cb, tc.cr
		}
		ours := Resize(src, 241, 360)
		ref := image.NewRGBA(image.Rect(0, 0, 241, 360))
		draw.CatmullRom.Scale(ref, ref.Rect, src, src.Bounds(), draw.Src, nil)

		var diff, n float64
		for y := 0; y < 360; y++ {
			for x := 0; x < 241; x++ {
				a := color.RGBAModel.Convert(ours.At(x, y)).(color.RGBA)
				b := ref.RGBAAt(x, y)
				diff += math.Abs(float64(a.R)-float64(b.R)) + math.Abs(float64(a.G)-float64(b.G)) + math.Abs(float64(a.B)-float64(b.B))
				n += 3
			}
		}
		if avg := diff / n; avg > 1.5 {
			t.Fatalf("%s: mean abs difference vs x/image CatmullRom = %.2f", tc.name, avg)
		}
	}
}

func TestNRGBAOverWhite(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 40, 40))
	for i := 0; i < len(src.Pix); i += 4 {
		src.Pix[i], src.Pix[i+1], src.Pix[i+2], src.Pix[i+3] = 0, 0, 0, 0 // fully transparent
	}
	out := Resize(src, 20, 20)
	if c := color.RGBAModel.Convert(out.At(10, 10)).(color.RGBA); c.R != 255 || c.G != 255 || c.B != 255 {
		t.Fatalf("transparent pixels should become white, got %v", c)
	}
}

func TestMonochromeJPEGBecomesGray(t *testing.T) {
	src := image.NewYCbCr(image.Rect(0, 0, 200, 300), image.YCbCrSubsampleRatio420)
	for i := range src.Y {
		src.Y[i] = uint8(i % 251)
	}
	for i := range src.Cb {
		src.Cb[i], src.Cr[i] = 129, 127 // neutral within noise
	}
	if _, ok := Resize(src, 100, 150).(*image.Gray); !ok {
		t.Fatal("neutral-chroma JPEG should be resized as gray")
	}
	src.Cb[0], src.Cr[0] = 30, 220 // one strong colour sample is not enough...
	if _, ok := Resize(src, 100, 150).(*image.Gray); !ok {
		t.Fatal("a single stray colour sample should not force colour")
	}
	for i := 0; i < len(src.Cb)/10; i++ { // ...but a coloured area is
		src.Cb[i], src.Cr[i] = 60, 200
	}
	if _, ok := Resize(src, 100, 150).(*image.RGBA); !ok {
		t.Fatal("colour page should stay colour")
	}
}
