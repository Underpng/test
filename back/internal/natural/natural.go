// Package natural implements "natural" string ordering, where runs of
// digits compare by numeric value ("vol 2" < "vol 10").
package natural

import (
	"sort"
	"strings"
	"unicode"
)

const digitWidth = 12

// Key returns a string that orders naturally under plain byte comparison.
// It is stable to store in a database and use in ORDER BY.
func Key(s string) string {
	var b strings.Builder
	b.Grow(len(s) + 16)
	rs := []rune(s)
	for i := 0; i < len(rs); {
		if isDigit(rs[i]) {
			j := i
			for j < len(rs) && isDigit(rs[j]) {
				j++
			}
			digits := strings.TrimLeft(string(rs[i:j]), "0")
			if digits == "" {
				digits = "0"
			}
			if len(digits) < digitWidth {
				b.WriteString(strings.Repeat("0", digitWidth-len(digits)))
			}
			b.WriteString(digits)
			i = j
			continue
		}
		b.WriteRune(unicode.ToLower(rs[i]))
		i++
	}
	return b.String()
}

func isDigit(r rune) bool { return r >= '0' && r <= '9' }

// Less reports whether a sorts before b in natural order.
func Less(a, b string) bool {
	ka, kb := Key(a), Key(b)
	if ka == kb {
		return a < b
	}
	return ka < kb
}

// Sort sorts the slice in natural order.
func Sort(ss []string) {
	sort.SliceStable(ss, func(i, j int) bool { return Less(ss[i], ss[j]) })
}
