package auth

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newStore(t *testing.T) (*Store, *time.Time) {
	now := time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC)
	s, err := Open(filepath.Join(t.TempDir(), "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return now }
	return s, &now
}

func TestSessionsSurviveReloadAndStoreOnlyHashes(t *testing.T) {
	s, _ := newStore(t)
	token, d, err := s.NewSession("iPhone")
	if err != nil {
		t.Fatal(err)
	}
	if got, ok := s.Lookup(token); !ok || got.ID != d.ID {
		t.Fatal("new token should log in")
	}
	raw, _ := os.ReadFile(s.path)
	if contains(string(raw), token) {
		t.Fatal("the token itself must not be stored")
	}

	again, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := again.Lookup(token); !ok {
		t.Fatal("token should still work after reload")
	}
	if _, ok := again.Lookup("forged"); ok {
		t.Fatal("unknown token must fail")
	}
	if err := again.Revoke(d.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := again.Lookup(token); ok {
		t.Fatal("revoked device must be logged out")
	}
}

func TestSessionExpires(t *testing.T) {
	s, now := newStore(t)
	token, _, _ := s.NewSession("x")
	*now = now.Add(SessionTTL + time.Hour)
	if _, ok := s.Lookup(token); ok {
		t.Fatal("expired session must fail")
	}
}

func TestPairCodeIsSingleUseAndExpires(t *testing.T) {
	s, now := newStore(t)
	code, _ := s.NewPairCode()
	if err := s.UsePairCode(code); err != nil {
		t.Fatal(err)
	}
	if err := s.UsePairCode(code); err == nil {
		t.Fatal("a code must work only once")
	}
	code2, _ := s.NewPairCode()
	*now = now.Add(PairTTL + time.Second)
	if err := s.UsePairCode(code2); err == nil {
		t.Fatal("an expired code must fail")
	}
}

func TestPassword(t *testing.T) {
	s, _ := newStore(t)
	if err := s.CheckPassword("x"); err != ErrNoPassword {
		t.Fatalf("no password set: %v", err)
	}
	if err := s.SetPassword("correct horse"); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(s.path)
	if contains(string(raw), "correct horse") {
		t.Fatal("password must be stored hashed")
	}
	if err := s.CheckPassword("correct horse"); err != nil {
		t.Fatal(err)
	}
	if err := s.CheckPassword("wrong"); err != ErrBadPassword {
		t.Fatalf("wrong password: %v", err)
	}
	if err := s.SetPassword(""); err != nil || s.PasswordSet() {
		t.Fatal("password should be removable")
	}
}

func TestLANNoLoginDefaultsToOn(t *testing.T) {
	s, _ := newStore(t)
	if !s.LANNoLogin() {
		t.Fatal("default should allow the home network without login")
	}
	s.SetLANNoLogin(false)
	again, _ := Open(s.path)
	if again.LANNoLogin() {
		t.Fatal("setting should persist")
	}
}

func contains(s, sub string) bool {
	return len(sub) > 0 && len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}
