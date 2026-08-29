package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server    ServerConfig `yaml:"server"`
	Employees []Employee   `yaml:"employees"`
	Rooms     []RoomCfg    `yaml:"rooms"`
}

type ServerConfig struct {
	Listen  string     `yaml:"listen"`
	LiveKit LiveKitCfg `yaml:"livekit"`
	DataDir string     `yaml:"data_dir"`
	WebDir  string     `yaml:"web_dir"`
}

// RoomCfg — комната: name — ID (имя комнаты LiveKit, участвует в путях
// записей), display — подпись в селекте и шапке.
type RoomCfg struct {
	Name    string `yaml:"name" json:"name"`
	Display string `yaml:"display" json:"display"`
}

// roomNameRe — имя комнаты попадает в путь записей (recordings/<room>/):
// только безопасные для пути символы, как loginRe в recordings.go.
var roomNameRe = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)

type LiveKitCfg struct {
	Host      string `yaml:"host"`
	APIKey    string `yaml:"api_key"`
	APISecret string `yaml:"api_secret"`
}

type Employee struct {
	Login        string `yaml:"login"`
	Name         string `yaml:"name"`
	Role         string `yaml:"role"`
	PasswordHash string `yaml:"password_hash"`
}

func LoadConfig(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	// Строгий парсинг: опечатка в ключе (например, passord_hash) — ошибка при
	// старте, а не молча пропущенный сотрудник без пароля.
	dec := yaml.NewDecoder(bytes.NewReader(b))
	dec.KnownFields(true)
	if err := dec.Decode(&cfg); err != nil {
		return nil, err
	}
	if cfg.Server.LiveKit.Host == "" {
		return nil, errors.New("config: server.livekit.host обязателен")
	}
	if len(cfg.Rooms) == 0 {
		return nil, errors.New("config: нужна минимум одна комната (rooms)")
	}
	seen := make(map[string]bool, len(cfg.Rooms))
	for i := range cfg.Rooms {
		r := &cfg.Rooms[i]
		if !roomNameRe.MatchString(r.Name) {
			return nil, fmt.Errorf("config: rooms[%d].name %q — только латиница, цифры, точка, дефис, подчёркивание", i, r.Name)
		}
		if seen[r.Name] {
			return nil, fmt.Errorf("config: дубль комнаты %q", r.Name)
		}
		seen[r.Name] = true
		if r.Display == "" {
			r.Display = r.Name // подпись по умолчанию — имя
		}
	}
	// Пути конфига — относительно файла конфига, не CWD.
	base := filepath.Dir(path)
	cfg.Server.DataDir = resolve(base, cfg.Server.DataDir)
	cfg.Server.WebDir = resolve(base, cfg.Server.WebDir)
	return &cfg, nil
}

func resolve(base, p string) string {
	if p == "" || filepath.IsAbs(p) {
		return p
	}
	return filepath.Join(base, p)
}

// Employee возвращает сотрудника по логину или nil.
func (c *Config) Employee(login string) *Employee {
	for i := range c.Employees {
		if c.Employees[i].Login == login {
			return &c.Employees[i]
		}
	}
	return nil
}

// Room возвращает комнату по имени или nil.
func (c *Config) Room(name string) *RoomCfg {
	for i := range c.Rooms {
		if c.Rooms[i].Name == name {
			return &c.Rooms[i]
		}
	}
	return nil
}
