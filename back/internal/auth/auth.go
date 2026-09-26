// Package auth keeps the devices allowed to read the library, an optional
// password, and one-time pairing codes shown as QR codes on the PC.
//
// Session tokens and the password are stored only as hashes, so a copy of
// the data file does not let anyone log in.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	SessionTTL      = 365 * 24 * time.Hour
	PairTTL         = 5 * time.Minute
	lastSeenPersist = 10 * time.Minute
	bcryptCost      = 12
)

var (
	ErrBadPassword = errors.New("password is incorrect")
	ErrNoPassword  = errors.New("no password is set")
	ErrBadCode     = errors.New("pairing code is invalid or expired")
)

type Device struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	TokenHash string    `json:"tokenHash"`
	Created   time.Time `json:"created"`
	LastSeen  time.Time `json:"lastSeen"`
	Expires   time.Time `json:"expires"`
}

type fileFormat struct {
	PasswordHash string    `json:"passwordHash,omitempty"`
	LANNoLogin   *bool     `json:"lanNoLogin,omitempty"`
	Devices      []*Device `json:"devices"`
}

type Store struct {
	path string
	now  func() time.Time

	mu      sync.Mutex
	data    fileFormat
	pairs   map[string]time.Time // code -> expiry
	existed bool
}

// Open loads (or starts) the auth file.
func Open(path string) (*Store, error) {
	s := &Store{path: path, now: time.Now, pairs: map[string]time.Time{}}
	b, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return nil, err
	default:
		s.existed = true
		if err := json.Unmarshal(b, &s.data); err != nil {
			return nil, err
		}
	}
	return s, nil
}

// FirstRun reports whether no auth file existed when the store was opened.
func (s *Store) FirstRun() bool { return !s.existed }

func (s *Store) saveLocked() error {
	b, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func randomString(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashToken(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

// ----- settings -----

// LANNoLogin reports whether readers on the home network (and Tailscale)
// may skip logging in. Default: yes.
func (s *Store) LANNoLogin() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.data.LANNoLogin == nil || *s.data.LANNoLogin
}

func (s *Store) SetLANNoLogin(v bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.LANNoLogin = &v
	return s.saveLocked()
}

// ----- password -----

func (s *Store) PasswordSet() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.data.PasswordHash != ""
}

// SetPassword sets or (with "") removes the password.
func (s *Store) SetPassword(pw string) error {
	var h string
	if pw != "" {
		b, err := bcrypt.GenerateFromPassword([]byte(pw), bcryptCost)
		if err != nil {
			return err
		}
		h = string(b)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.PasswordHash = h
	return s.saveLocked()
}

// CheckPassword verifies pw. bcrypt makes every attempt deliberately slow.
func (s *Store) CheckPassword(pw string) error {
	s.mu.Lock()
	hash := s.data.PasswordHash
	s.mu.Unlock()
	if hash == "" {
		return ErrNoPassword
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) != nil {
		return ErrBadPassword
	}
	return nil
}

// ----- pairing -----

// NewPairCode returns a one-time code valid for PairTTL.
func (s *Store) NewPairCode() (string, time.Time) {
	code := randomString(18)
	exp := s.now().Add(PairTTL)
	s.mu.Lock()
	defer s.mu.Unlock()
	for c, e := range s.pairs {
		if s.now().After(e) {
			delete(s.pairs, c)
		}
	}
	s.pairs[code] = exp
	return code, exp
}

// UsePairCode consumes a code. It can be used only once.
func (s *Store) UsePairCode(code string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	exp, ok := s.pairs[code]
	if !ok {
		return ErrBadCode
	}
	delete(s.pairs, code)
	if s.now().After(exp) {
		return ErrBadCode
	}
	return nil
}

// ----- devices / sessions -----

// NewSession registers a device and returns its bearer token.
func (s *Store) NewSession(name string) (string, *Device, error) {
	token := randomString(32)
	now := s.now()
	d := &Device{
		ID:        randomString(9),
		Name:      cleanName(name),
		TokenHash: hashToken(token),
		Created:   now,
		LastSeen:  now,
		Expires:   now.Add(SessionTTL),
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Devices = append(s.data.Devices, d)
	return token, d, s.saveLocked()
}

// Lookup finds the device for a token, extending its session.
func (s *Store) Lookup(token string) (*Device, bool) {
	if token == "" {
		return nil, false
	}
	h := hashToken(token)
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, d := range s.data.Devices {
		if subtle.ConstantTimeCompare([]byte(d.TokenHash), []byte(h)) != 1 {
			continue
		}
		if now.After(d.Expires) {
			return nil, false
		}
		if now.Sub(d.LastSeen) > lastSeenPersist {
			d.LastSeen = now
			d.Expires = now.Add(SessionTTL)
			s.saveLocked()
		}
		copy := *d
		return &copy, true
	}
	return nil, false
}

// Devices lists registered devices, most recently seen first.
func (s *Store) Devices() []Device {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Device, 0, len(s.data.Devices))
	for _, d := range s.data.Devices {
		if s.now().Before(d.Expires) {
			out = append(out, *d)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastSeen.After(out[j].LastSeen) })
	return out
}

// Revoke logs a device out.
func (s *Store) Revoke(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := s.data.Devices[:0]
	for _, d := range s.data.Devices {
		if d.ID != id {
			kept = append(kept, d)
		}
	}
	s.data.Devices = kept
	return s.saveLocked()
}

func cleanName(n string) string {
	n = strings.TrimSpace(n)
	if n == "" {
		n = "端末"
	}
	if r := []rune(n); len(r) > 40 {
		n = string(r[:40])
	}
	return n
}
