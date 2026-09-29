package db

import (
	"path/filepath"
	"testing"

	"shelf/internal/natural"
)

func book(path, title string) Book {
	return Book{
		Path:      path,
		Parent:    filepath.ToSlash(filepath.Dir(path)),
		Type:      "CBZ",
		Title:     title,
		TitleSort: natural.Key(title),
		NameSort:  natural.Key(filepath.Base(path)),
	}
}

func TestListingsAndPersistence(t *testing.T) {
	file := filepath.Join(t.TempDir(), "library.json")
	d, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	d.Insert(book("/A/Vol 10.cbz", "Vol 10"))
	d.Insert(book("/A/Vol 2.cbz", "Vol 2"))
	d.Insert(book("/A/Vol 1.cbz", "Vol 1"))
	d.Insert(book("/B/Sub/x.cbz", "x"))
	d.SetCover("/A/Vol 2.cbz", "/A/Vol 2.jpg", 0)
	d.SetKeywords("/A/Vol 1.cbz", []string{"Author"})
	d.UpdateProgress("/A/Vol 1.cbz", "5", 0.5)

	books, _ := d.FolderBooks("/A")
	if got := []string{books[0].Title, books[1].Title, books[2].Title}; got[0] != "Vol 1" || got[1] != "Vol 2" || got[2] != "Vol 10" {
		t.Fatalf("natural order wrong: %v", got)
	}

	subs, _ := d.Subfolders("/")
	if len(subs) != 2 || subs[0].Path != "/A" || subs[0].Cover != "/A/Vol 2.jpg" || subs[1].Path != "/B" {
		t.Fatalf("subfolders: %+v", subs)
	}
	subs, _ = d.Subfolders("/B")
	if len(subs) != 1 || subs[0].Path != "/B/Sub" {
		t.Fatalf("nested subfolders: %+v", subs)
	}

	pg, _ := d.ListFolder("/A", OrderBy("title", "desc"), 2, 0)
	if len(pg) != 2 || pg[0].Title != "Vol 10" {
		t.Fatalf("paged desc listing: %+v", pg)
	}

	found, _ := d.Search("vol", nil, OrderBy("title", "asc"), 10, 0)
	if len(found) != 3 {
		t.Fatalf("search: %d", len(found))
	}
	paths, _ := d.PathsByKeywords([]string{"author"})
	if len(paths) != 1 || paths[0] != "/A/Vol 1.cbz" {
		t.Fatalf("keywords: %v", paths)
	}

	if err := d.Close(); err != nil {
		t.Fatal(err)
	}

	again, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	b, err := again.Get("/A/Vol 1.cbz")
	if err != nil || b.Progress != 0.5 || b.CurrentPosition != "5" {
		t.Fatalf("persisted book: %+v %v", b, err)
	}
	if n, _ := again.Count(); n != 4 {
		t.Fatalf("count after reload: %d", n)
	}
}
