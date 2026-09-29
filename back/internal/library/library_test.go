package library

import (
	"path/filepath"
	"runtime"
	"testing"
)

func TestResolveRejectsEscape(t *testing.T) {
	root := filepath.Join("C:", "lib")
	bad := []string{"/../x", "../x", "/a/../../x"}
	if runtime.GOOS == "windows" {
		bad = append(bad, "C:/Windows") // a drive path is only absolute on Windows
	}
	for _, bad := range bad {
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
