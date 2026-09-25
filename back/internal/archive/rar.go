package archive

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"os/exec"
	"strings"

	"shelf/internal/library"
	"shelf/internal/natural"
)

var ErrNo7z = errors.New("7-Zip is not available; CBR files need it")

// Rar is a CBR listed through 7-Zip. Pages are entry names in reading order.
type Rar struct {
	sevenZip string
	path     string
	Pages    []string
}

func OpenRar(sevenZip, path string) (*Rar, error) {
	if sevenZip == "" {
		return nil, ErrNo7z
	}
	// -slt prints one "Key = Value" block per entry, so names with spaces
	// survive intact. -ba drops the banner.
	cmd := exec.Command(sevenZip, "l", "-slt", "-ba", path)
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("7z list: %w", err)
	}
	pages := parseSLT(out)
	sort := make([]string, 0, len(pages))
	for _, p := range pages {
		if library.IsPageImage(p) {
			sort = append(sort, p)
		}
	}
	natural.Sort(sort)
	return &Rar{sevenZip: sevenZip, path: path, Pages: sort}, nil
}

// parseSLT extracts file (not directory) paths from `7z l -slt` output.
func parseSLT(out []byte) []string {
	var files []string
	var cur string
	isDir := false
	flush := func() {
		if cur != "" && !isDir {
			files = append(files, cur)
		}
		cur, isDir = "", false
	}
	sc := bufio.NewScanner(bytes.NewReader(out))
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			flush()
			continue
		}
		key, val, ok := strings.Cut(line, " = ")
		if !ok {
			continue
		}
		switch key {
		case "Path":
			flush()
			cur = strings.ReplaceAll(val, "\\", "/")
		case "Attributes":
			if strings.HasPrefix(val, "D") {
				isDir = true
			}
		case "Folder":
			if val == "+" {
				isDir = true
			}
		}
	}
	flush()
	return files
}

// Page extracts the i-th page (0-based) to memory.
func (r *Rar) Page(i int) ([]byte, string, error) {
	if i < 0 || i >= len(r.Pages) {
		return nil, "", fmt.Errorf("page %d out of range", i+1)
	}
	name := r.Pages[i]
	cmd := exec.Command(r.sevenZip, "x", "-so", r.path, name)
	hideWindow(cmd)
	data, err := cmd.Output()
	if err != nil {
		return nil, "", fmt.Errorf("7z extract %q: %w", name, err)
	}
	return data, name, nil
}
