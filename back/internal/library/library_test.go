package library

import (
	"path/filepath"
	"testing"
)

func TestResolveRejectsEscape(t *testing.T) {
	root := filepath.Join("C:", "lib")
	for _, bad := range []string{"/../x", "../x", "/a/../../x", "C:/Windows"} {
		if _, err := Resolve(root, bad); err == nil {
			t.Errorf("expected error for %q", bad)
		}
	}
	got, err := Resolve(root, "/Series A/Vol 01.cbz")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, "Series A", "Vol 01.cbz")
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestParent(t *testing.T) {
	cases := map[string]string{
		"/a/b/c.cbz": "/a/b",
		"/c.cbz":     "/",
		"/":          "/",
	}
	for in, want := range cases {
		if got := Parent(in); got != want {
			t.Errorf("Parent(%q)=%q want %q", in, got, want)
		}
	}
}
