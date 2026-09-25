package api

import "testing"

func TestHashedAsset(t *testing.T) {
	for _, p := range []string{"index_85da.33000657.css", "index_9bd9.3f55ca3f.js", "sleeping.086363a4-b22a23.jpg"} {
		if !hashedAsset.MatchString(p) {
			t.Errorf("%s should be treated as immutable", p)
		}
	}
	for _, p := range []string{"index.html", "favicon.png", "apple-touch-icon.png", "manifest.webmanifest"} {
		if hashedAsset.MatchString(p) {
			t.Errorf("%s must not be cached forever", p)
		}
	}
}
