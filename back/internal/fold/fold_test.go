package fold

import "testing"

func TestString(t *testing.T) {
	same := [][]string{
		{"シャーマンキング", "しゃーまんきんぐ", "ｼｬｰﾏﾝｷﾝｸﾞ", "シャーマン キング"},
		{"ONE PIECE", "one piece", "ＯＮＥ　ＰＩＥＣＥ", "onepiece"},
		{"ヴァイオレット", "ｳﾞｧｲｵﾚｯﾄ"},
	}
	for _, group := range same {
		want := String(group[0])
		for _, s := range group[1:] {
			if got := String(s); got != want {
				t.Errorf("String(%q) = %q, want %q (as %q)", s, got, want, group[0])
			}
		}
	}
}

func TestContains(t *testing.T) {
	if !Contains("Shaman King v01", String("king")) {
		t.Error("substring in the middle not found")
	}
	if !Contains("シャーマンキング v01-v35", String("きんぐ")) {
		t.Error("hiragana query did not match katakana title")
	}
	if Contains("Shaman King", String("queen")) {
		t.Error("unexpected match")
	}
}
