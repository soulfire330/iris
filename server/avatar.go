package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
)

// AvatarStore хранит seed-аватаров сотрудников в data/avatars.json.
// Seed назначается случайно при первом входе и держится вечно.
type AvatarStore struct {
	mu    sync.Mutex
	path  string
	seeds map[string]string
}

func NewAvatarStore(dataDir string) *AvatarStore {
	s := &AvatarStore{
		path:  filepath.Join(dataDir, "avatars.json"),
		seeds: map[string]string{},
	}
	if b, err := os.ReadFile(s.path); err == nil {
		_ = json.Unmarshal(b, &s.seeds)
	}
	return s
}

func (s *AvatarStore) Seed(login string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if seed, ok := s.seeds[login]; ok {
		return seed, nil
	}
	seed, err := newSeed()
	if err != nil {
		return "", err
	}
	s.seeds[login] = seed
	b, err := json.MarshalIndent(s.seeds, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(s.path, b, 0o644); err != nil {
		log.Printf("avatars: не сохранить %s: %v", s.path, err)
	}
	return seed, nil
}

func newSeed() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
