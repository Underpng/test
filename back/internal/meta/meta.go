// Package meta extracts a title and keywords from a book file.
package meta

import (
	"bytes"
	"encoding/xml"
	"os/exec"
	"path/filepath"
	"strings"

	"shelf/internal/archive"
)

type Info struct {
	Title    string
	Keywords []string
}

// Extract never fails: when nothing better is available the title is the
// filename without extension.
func Extract(src, bookType, pdfInfo string) Info {
	fallback := Info{Title: strings.TrimSuffix(filepath.Base(src), filepath.Ext(src))}
	var info Info
	switch bookType {
	case "EPUB":
		info = epubMeta(src)
	case "PDF":
		info = pdfMeta(src, pdfInfo)
	}
	if info.Title == "" {
		info.Title = fallback.Title
	}
	return info
}

func epubMeta(src string) Info {
	container, err := archive.ReadZipEntry(src, "META-INF/container.xml")
	if err != nil {
		return Info{}
	}
	var c struct {
		Rootfiles struct {
			Rootfile []struct {
				FullPath string `xml:"full-path,attr"`
			} `xml:"rootfile"`
		} `xml:"rootfiles"`
	}
	if xml.Unmarshal(container, &c) != nil || len(c.Rootfiles.Rootfile) == 0 {
		return Info{}
	}
	opf, err := archive.ReadZipEntry(src, c.Rootfiles.Rootfile[0].FullPath)
	if err != nil {
		return Info{}
	}
	var pkg struct {
		Metadata struct {
			Title   []string `xml:"title"`
			Creator []string `xml:"creator"`
			Subject []string `xml:"subject"`
		} `xml:"metadata"`
	}
	if xml.Unmarshal(opf, &pkg) != nil {
		return Info{}
	}
	var info Info
	if len(pkg.Metadata.Title) > 0 {
		info.Title = strings.TrimSpace(pkg.Metadata.Title[0])
	}
	for _, s := range append(pkg.Metadata.Creator, pkg.Metadata.Subject...) {
		if s = strings.TrimSpace(s); s != "" {
			info.Keywords = append(info.Keywords, s)
		}
	}
	return info
}

func pdfMeta(src, pdfInfo string) Info {
	if pdfInfo == "" {
		return Info{}
	}
	out, err := exec.Command(pdfInfo, src).Output()
	if err != nil {
		return Info{}
	}
	var info Info
	for _, line := range bytes.Split(out, []byte("\n")) {
		key, val, ok := strings.Cut(string(line), ":")
		if !ok {
			continue
		}
		val = strings.TrimSpace(val)
		switch strings.TrimSpace(key) {
		case "Title":
			info.Title = val
		case "Author":
			if val != "" {
				info.Keywords = append(info.Keywords, val)
			}
		case "Keywords":
			for _, k := range strings.Split(val, ",") {
				if k = strings.TrimSpace(k); k != "" {
					info.Keywords = append(info.Keywords, k)
				}
			}
		}
	}
	return info
}
