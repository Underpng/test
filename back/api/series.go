package api

import (
	"net/http"
	"sort"
	"strings"

	"shelf/internal/db"
	"shelf/internal/library"
	"shelf/internal/natural"
)

// A series is a folder that directly contains books: one manga title with
// its volumes. Loose files at the top level are not a series.

type series struct {
	Path       string
	Title      string
	Volumes    []db.Book // natural filename order
	Cover      string
	Finished   int
	LastOpened int64
	AddedTime  int64 // newest volume
}

func (s *series) entry() Entry {
	progress := 0.0
	if len(s.Volumes) > 0 {
		progress = float64(s.Finished) / float64(len(s.Volumes))
	}
	return Entry{
		Type:     "Series",
		Path:     s.Path,
		Cover:    s.Cover,
		Title:    s.Title,
		Progress: progress,
		Count:    len(s.Volumes),
		Finished: s.Finished,
	}
}

// continueVolume picks where the reader should resume: the most recently
// opened unfinished volume, else the one after the last finished volume,
// else the first.
func (s *series) continueVolume() *db.Book {
	if len(s.Volumes) == 0 {
		return nil
	}
	var best *db.Book
	for i := range s.Volumes {
		v := &s.Volumes[i]
		if v.LastOpened > 0 && v.Progress < finishedAt && (best == nil || v.LastOpened > best.LastOpened) {
			best = v
		}
	}
	if best != nil {
		return best
	}
	for i := len(s.Volumes) - 1; i >= 0; i-- {
		if s.Volumes[i].Progress >= finishedAt {
			if i+1 < len(s.Volumes) {
				return &s.Volumes[i+1]
			}
			return nil // everything read
		}
	}
	return &s.Volumes[0]
}

func sortVolumes(vs []db.Book) {
	sort.SliceStable(vs, func(i, j int) bool {
		if vs[i].NameSort != vs[j].NameSort {
			return vs[i].NameSort < vs[j].NameSort
		}
		return vs[i].Path < vs[j].Path
	})
}

func buildSeries(path string, volumes []db.Book) *series {
	sortVolumes(volumes)
	s := &series{Path: path, Title: library.Base(path), Volumes: volumes}
	for _, v := range volumes {
		if s.Cover == "" && v.Cover != "" {
			s.Cover = v.Cover
		}
		if v.Progress >= finishedAt {
			s.Finished++
		}
		if v.LastOpened > s.LastOpened {
			s.LastOpened = v.LastOpened
		}
		if v.AddedTime > s.AddedTime {
			s.AddedTime = v.AddedTime
		}
	}
	return s
}

// allSeries groups every book by its folder.
func (s *Server) allSeries() []*series {
	groups := map[string][]db.Book{}
	for _, b := range s.DB.All() {
		if b.Parent == "/" {
			continue
		}
		groups[b.Parent] = append(groups[b.Parent], b)
	}
	out := make([]*series, 0, len(groups))
	for p, vs := range groups {
		out = append(out, buildSeries(p, vs))
	}
	return out
}

func (s *Server) seriesOf(folder string) *series {
	vols, err := s.DB.FolderBooks(folder)
	if err != nil || len(vols) == 0 || folder == "/" {
		return nil
	}
	return buildSeries(folder, vols)
}

func sortSeries(list []*series, sortBy, order string) {
	desc := strings.EqualFold(order, "desc")
	less := func(a, b *series) bool {
		switch sortBy {
		case "added_time":
			if a.AddedTime != b.AddedTime {
				return a.AddedTime < b.AddedTime
			}
		case "last_opened":
			if a.LastOpened != b.LastOpened {
				return a.LastOpened < b.LastOpened
			}
		case "progress":
			pa, pb := a.entry().Progress, b.entry().Progress
			if pa != pb {
				return pa < pb
			}
		default:
			ka, kb := natural.Key(a.Title), natural.Key(b.Title)
			if ka != kb {
				return ka < kb
			}
		}
		return a.Path < b.Path
	}
	sort.SliceStable(list, func(i, j int) bool {
		if desc {
			return less(list[j], list[i])
		}
		return less(list[i], list[j])
	})
}

// GET /api/series: every series, paged like the other listings.
func (s *Server) seriesList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	list := s.allSeries()
	sortSeries(list, q.Get("sort"), q.Get("order"))
	p := s.paging(r)
	entries := make([]Entry, 0, len(list))
	for _, sr := range list {
		entries = append(entries, sr.entry())
	}
	if p.offset >= len(entries) {
		entries = []Entry{}
	} else {
		entries = entries[p.offset:]
	}
	hasMore := false
	if len(entries) > s.PageSize {
		hasMore = true
		entries = entries[:s.PageSize]
	}
	writeJSON(w, map[string]any{"books": entries, "hasMore": hasMore})
}
