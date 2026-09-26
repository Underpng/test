package api

import (
	"net/http"
	"sort"

	"shelf/internal/db"
)

const finishedAt = 0.98

// home builds the landing page in one request: volumes in progress (one
// per series), the next volume after each finished one, and arrivals
// grouped by series.
func (s *Server) home(w http.ResponseWriter, r *http.Request) {
	all := s.DB.All()

	var reading, finished, loose []db.Book
	for _, b := range all {
		if b.LastOpened > 0 && b.Progress < finishedAt {
			reading = append(reading, b)
		}
		if b.Progress >= finishedAt {
			finished = append(finished, b)
		}
		if b.Parent == "/" {
			loose = append(loose, b)
		}
	}
	byOpened := func(bs []db.Book) {
		sort.Slice(bs, func(i, j int) bool { return bs[i].LastOpened > bs[j].LastOpened })
	}
	byOpened(reading)
	byOpened(finished)

	// One in-progress volume per series: the most recently opened.
	var readingEntries []Entry
	seenSeries := map[string]bool{}
	inReading := map[string]bool{}
	for _, b := range reading {
		if b.Parent != "/" {
			if seenSeries[b.Parent] {
				continue
			}
			seenSeries[b.Parent] = true
		}
		inReading[b.Path] = true
		readingEntries = append(readingEntries, entryOf(b))
		if len(readingEntries) >= 20 {
			break
		}
	}

	// Suggest the volume that follows each finished book, most recent first.
	var next []Entry
	seen := map[string]bool{}
	for _, b := range finished {
		if len(next) >= 10 {
			break
		}
		if b.Parent == "/" {
			continue // a loose book has no "next volume"
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
			next = append(next, entryOf(n))
			break
		}
	}

	// Arrivals: series (by their newest volume) and loose files together.
	type arrival struct {
		added int64
		entry Entry
	}
	var arrivals []arrival
	for _, sr := range s.allSeries() {
		arrivals = append(arrivals, arrival{sr.AddedTime, sr.entry()})
	}
	for _, b := range loose {
		arrivals = append(arrivals, arrival{b.AddedTime, entryOf(b)})
	}
	sort.SliceStable(arrivals, func(i, j int) bool {
		if arrivals[i].added != arrivals[j].added {
			return arrivals[i].added > arrivals[j].added
		}
		return arrivals[i].entry.Path < arrivals[j].entry.Path
	})
	arrivalEntries := make([]Entry, 0, len(arrivals))
	for i, a := range arrivals {
		if i >= 20 {
			break
		}
		arrivalEntries = append(arrivalEntries, a.entry)
	}

	if readingEntries == nil {
		readingEntries = []Entry{}
	}
	if next == nil {
		next = []Entry{}
	}
	writeJSON(w, map[string]any{
		"reading":  readingEntries,
		"next":     next,
		"arrivals": arrivalEntries,
	})
}
