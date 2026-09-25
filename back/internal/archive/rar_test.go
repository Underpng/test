package archive

import (
	"reflect"
	"testing"
)

func TestParseSLT(t *testing.T) {
	out := []byte(`Path = Shaman King v01 {KC Complete Edtion}
Folder = +
Size = 0
Attributes = D

Path = Shaman King v01 {KC Complete Edtion}/cover.jpeg
Folder = -
Size = 399864
Attributes = A

Path = Shaman King v01 {KC Complete Edtion}\page0001.jpeg
Size = 30816
Attributes = A
`)
	got := parseSLT(out)
	want := []string{
		"Shaman King v01 {KC Complete Edtion}/cover.jpeg",
		"Shaman King v01 {KC Complete Edtion}/page0001.jpeg",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}
