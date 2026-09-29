package meta

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPDFMetaWithoutPoppler(t *testing.T) {
	p := filepath.Join(t.TempDir(), "My Book.pdf")
	body := "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n" +
		"2 0 obj\n<< /Title (Manga Title) /Author (Some Author) /Keywords (a, b) >>\nendobj\n" +
		"trailer\n<< /Root 1 0 R /Info 2 0 R >>\n%%EOF\n"
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	info := Extract(p, "PDF", "")
	if info.Title != "Manga Title" {
		t.Fatalf("title %q", info.Title)
	}
	if len(info.Keywords) != 3 || info.Keywords[0] != "Some Author" || info.Keywords[2] != "b" {
		t.Fatalf("keywords %q", info.Keywords)
	}

	// No Info at all: the file name is the title.
	p2 := filepath.Join(t.TempDir(), "Plain Name.pdf")
	os.WriteFile(p2, []byte("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"), 0o644)
	if info := Extract(p2, "PDF", ""); info.Title != "Plain Name" {
		t.Fatalf("fallback title %q", info.Title)
	}
}
