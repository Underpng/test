package natural

import (
	"reflect"
	"testing"
)

func TestSort(t *testing.T) {
	in := []string{"page10.jpg", "page2.jpg", "Page1.jpg", "cover.jpg", "page010.jpg", "第10巻", "第2巻"}
	Sort(in)
	want := []string{"cover.jpg", "Page1.jpg", "page2.jpg", "page010.jpg", "page10.jpg", "第2巻", "第10巻"}
	if !reflect.DeepEqual(in, want) {
		t.Fatalf("got %v want %v", in, want)
	}
}

func TestKeyStable(t *testing.T) {
	if Key("Vol 07") != Key("vol 7") {
		t.Fatalf("keys differ: %q vs %q", Key("Vol 07"), Key("vol 7"))
	}
	if !Less("v9", "v10") {
		t.Fatal("v9 should come before v10")
	}
}
