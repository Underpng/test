package api

import (
	"net/http"
	"sort"

	"shelf/internal/db"
)

const finishedAt = 0.98

// home builds the landing page in one request: books in progress, the
// next volume after each finished one, and recent arrivals.
func (s *Server) home(w http.ResponseWriter, r *http.Request) {
	all := s.DB.All()

	var reading, finished, arrivals []db.Book
	for _, b := range all {
		if b.LastOpened > 0 && b.Progress < finishedAt {
			reading = append(reading, b)
		}
		if b.Progress >= finishedAt {
			finished = append(finished, b)
		}
	}
	byOpened := func(bs []db.Book) {
		sort.Slice(bs, func(i, j int) bool { return bs[i].LastOpened > bs[j].LastOpened })
	}
	byOpened(reading)
	byOpened(finished)

	arrivals = append(arrivals, all...)
	sort.Slice(arrivals, func(i, j int) bool {
		if arrivals[i].AddedTime != arrivals[j].AddedTime {
			return arrivals[i].AddedTime > arrivals[j].AddedTime
		}
		return arrivals[i].Path < arrivals[j].Path
	})

	inReading := map[string]bool{}
	for _, b := range reading {
		inReading[b.Path] = true
	}

	// Suggest the volume that follows each finished book, most recent first.
	var next []db.Book
	seen := map[string]bool{}
	for _, b := range finished {
		if len(next) >= 10 {
			break
		}
		siblings, err := s.DB.FolderBooks(b.Parent)
		if err != nil {
			continue
		}
		for i, sib := range siblings {
			if sib.Path != b.Path || i+1 >= len(siblings) {
				continue
			}
			n := siblings[i+1]
			if n.Progress >= finishedAt || inReading[n.Path] || seen[n.Path] {
				break
			}
			seen[n.Path] = true
			next = append(next, n)
			break
		}
	}

	limit := func(bs []db.Book, n int) []Entry {
		if len(bs) > n {
			bs = bs[:n]
		}
		out := make([]Entry, 0, len(bs))
		for _, b := range bs {
			out = append(out, entryOf(b))
		}
		return out
	}
	writeJSON(w, map[string]any{
		"reading":  limit(reading, 20),
		"next":     limit(next, 10),
		"arrivals": limit(arrivals, 20),
	})
}
