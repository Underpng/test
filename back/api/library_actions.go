package api

import (
	"net/http"
	"strings"
	"time"

	"shelf/internal/db"
)

// mark sets a book, or every volume of a series folder, as read or unread.
//
//	POST /api/mark {"path": "/Series/Vol 01.cbz", "read": true}
func (s *Server) mark(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
		Read bool   `json:"read"`
	}
	if err := readJSON(r, &req); err != nil || !strings.HasPrefix(req.Path, "/") {
		http.Error(w, "bad request", 400)
		return
	}
	paths := []string{req.Path}
	if _, err := s.DB.Get(req.Path); err != nil {
		// Not a book: a series folder, so all of its volumes.
		books, _ := s.DB.FolderBooks(req.Path)
		paths = paths[:0]
		for _, b := range books {
			paths = append(paths, b.Path)
		}
	}
	n := s.DB.MarkRead(paths, req.Read)
	if n == 0 {
		http.Error(w, "not found", 404)
		return
	}
	writeJSON(w, map[string]int{"changed": n})
}

// bookmarks lists the bookmarks of ?path=.
func (s *Server) bookmarks(w http.ResponseWriter, r *http.Request) {
	list, err := s.DB.Bookmarks(bookPath(r))
	if err != nil {
		http.Error(w, "not found", 404)
		return
	}
	writeJSON(w, map[string]any{"bookmarks": list})
}

// setBookmark adds or removes one bookmark and returns the new list.
//
//	POST /api/bookmarks {"path": "...", "position": "12", "label": "12 ページ", "on": true}
func (s *Server) setBookmark(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path     string `json:"path"`
		Position string `json:"position"`
		Label    string `json:"label"`
		On       bool   `json:"on"`
	}
	if err := readJSON(r, &req); err != nil || req.Path == "" || req.Position == "" || len(req.Position) > 2000 {
		http.Error(w, "bad request", 400)
		return
	}
	if r := []rune(req.Label); len(r) > 120 {
		req.Label = string(r[:120])
	}
	list, err := s.DB.SetBookmark(req.Path, db.Bookmark{Position: req.Position, Label: req.Label, Created: time.Now().Unix()}, req.On)
	if err != nil {
		http.Error(w, "not found", 404)
		return
	}
	writeJSON(w, map[string]any{"bookmarks": list})
}
