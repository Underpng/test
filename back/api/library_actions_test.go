package api

import (
	"encoding/json"
	"image/jpeg"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"shelf/internal/db"
	"shelf/internal/saver"
)

func actionServer(t *testing.T) (*Server, http.Handler, *db.DB) {
	s, _ := testServer(t)
	d, err := db.Open(filepath.Join(t.TempDir(), "library.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range []db.Book{
		{Path: "/シャーマンキング/Shaman King v01.cbz", Parent: "/シャーマンキング", Type: "CBZ", Title: "Shaman King v01", Progress: 0.4, CurrentPosition: "30", LastOpened: 5},
		{Path: "/シャーマンキング/Shaman King v02.cbz", Parent: "/シャーマンキング", Type: "CBZ", Title: "Shaman King v02"},
		{Path: "/ＯＮＥ　ＰＩＥＣＥ 01.cbz", Parent: "/", Type: "CBZ", Title: "ＯＮＥ　ＰＩＥＣＥ 01"},
	} {
		d.Insert(b)
	}
	s.DB = d
	s.PageSize = 50
	s.Thumbs, err = saver.New(saver.Options{Dir: filepath.Join(t.TempDir(), "thumbs"), MaxHeight: 400, Quality: 60, Foreground: 1, Log: log.New(io.Discard, "", 0)})
	if err != nil {
		t.Fatal(err)
	}
	return s, s.Handler(), d
}

func call(t *testing.T, h http.Handler, method, url, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, url, strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:1"
	r.Host = "localhost"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func titles(t *testing.T, w *httptest.ResponseRecorder) []string {
	var out struct {
		Books []Entry `json:"books"`
	}
	json.Unmarshal(w.Body.Bytes(), &out)
	var ts []string
	for _, b := range out.Books {
		ts = append(ts, b.Title)
	}
	return ts
}

func TestSearchMatchesAnywhereAndIgnoresKanaAndWidth(t *testing.T) {
	_, h, _ := actionServer(t)
	cases := map[string]int{
		"king":      2, // middle of the title
		"しゃーまん":     2, // hiragana finds the katakana series folder
		"ｼｬｰﾏﾝ":     2, // half-width katakana
		"one piece": 1, // full-width title, half-width query, spaces ignored
		"v02":       1,
		"naruto":    0,
	}
	for q, want := range cases {
		w := call(t, h, "GET", "/api/search?q="+url.QueryEscape(q), "")
		if got := titles(t, w); len(got) != want {
			t.Errorf("%q: got %v, want %d results", q, got, want)
		}
	}
}

func TestMarkReadAndUnread(t *testing.T) {
	_, h, d := actionServer(t)
	book := "/シャーマンキング/Shaman King v01.cbz"

	if w := call(t, h, "POST", "/api/mark", `{"path":"`+book+`","read":true}`); w.Code != 200 {
		t.Fatalf("mark read: %d %s", w.Code, w.Body)
	}
	if b, _ := d.Get(book); b.Progress != 1 {
		t.Fatalf("progress after read = %v", b.Progress)
	}

	call(t, h, "POST", "/api/mark", `{"path":"`+book+`","read":false}`)
	if b, _ := d.Get(book); b.Progress != 0 || b.CurrentPosition != "" || b.LastOpened != 0 {
		t.Fatalf("unread left %+v", b)
	}

	// A series folder marks all of its volumes.
	w := call(t, h, "POST", "/api/mark", `{"path":"/シャーマンキング","read":true}`)
	if !strings.Contains(w.Body.String(), `"changed":2`) {
		t.Fatalf("series mark: %s", w.Body)
	}
	if w := call(t, h, "POST", "/api/mark", `{"path":"/nope","read":true}`); w.Code != 404 {
		t.Fatalf("unknown path: %d", w.Code)
	}
}

func TestBookmarks(t *testing.T) {
	_, h, _ := actionServer(t)
	book := "/シャーマンキング/Shaman King v01.cbz"
	list := func(w *httptest.ResponseRecorder) []db.Bookmark {
		var out struct{ Bookmarks []db.Bookmark }
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
		return out.Bookmarks
	}
	call(t, h, "POST", "/api/bookmarks", `{"path":"`+book+`","position":"12","label":"12 ページ","on":true}`)
	got := list(call(t, h, "POST", "/api/bookmarks", `{"path":"`+book+`","position":"40","label":"40 ページ","on":true}`))
	if len(got) != 2 || got[0].Position != "12" || got[1].Label != "40 ページ" {
		t.Fatalf("after adding: %+v", got)
	}
	// Adding the same place twice keeps one.
	call(t, h, "POST", "/api/bookmarks", `{"path":"`+book+`","position":"12","label":"12 ページ","on":true}`)
	call(t, h, "POST", "/api/bookmarks", `{"path":"`+book+`","position":"40","on":false}`)
	got = list(call(t, h, "GET", "/api/bookmarks?path="+url.QueryEscape(book), ""))
	if len(got) != 1 || got[0].Position != "12" {
		t.Fatalf("after removing: %+v", got)
	}
}

func TestThumbnailIsSmall(t *testing.T) {
	s, h, _ := actionServer(t)
	_ = s
	w := call(t, h, "GET", "/book/cbz/thumb?path=/S/v1.cbz&page=2", "")
	if w.Code != 200 || w.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("thumb: %d %s", w.Code, w.Header().Get("Content-Type"))
	}
	img, err := jpeg.DecodeConfig(w.Body)
	if err != nil || img.Height != 400 {
		t.Fatalf("thumb size %dx%d err %v", img.Width, img.Height, err)
	}
	if w := call(t, h, "GET", "/book/cbz/thumb?path=/S/v1.cbz&page=9", ""); w.Code != 400 {
		t.Fatalf("bad page: %d", w.Code)
	}
}
