// Package fold normalises text for forgiving search: letter case, full- and
// half-width forms, hiragana vs katakana and spaces are all ignored, so
// "ｼｬｰﾏﾝ", "しゃーまん" and "シャーマン" find the same titles.
package fold

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// String returns the search form of s.
func String(s string) string {
	// NFKC folds full-width ASCII to ASCII and half-width katakana (with
	// its separate voicing marks) to ordinary katakana.
	s = norm.NFKC.String(s)
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case unicode.IsSpace(r):
			continue
		case r >= 'ァ' && r <= 'ヶ':
			r -= 'ァ' - 'ぁ' // katakana to hiragana
		case r == 'ヽ' || r == 'ヾ':
			r -= 'ヽ' - 'ゝ'
		default:
			r = unicode.ToLower(r)
		}
		b.WriteRune(r)
	}
	return b.String()
}

// Contains reports whether needle (already folded) occurs in hay.
func Contains(hay, foldedNeedle string) bool {
	return strings.Contains(String(hay), foldedNeedle)
}
