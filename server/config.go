package main

import (
	"errors"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server    ServerConfig `yaml:"server"`
	Employees []Employee   `yaml:"employees"`
}

type ServerConfig struct {
	Listen  string     `yaml:"listen"`
	LiveKit LiveKitCfg `yaml:"livekit"`
	Room    string     `yaml:"room"`
	DataDir string     `yaml:"data_dir"`
	WebDir  string     `yaml:"web_dir"`
}

type LiveKitCfg struct {
	Host      string `yaml:"host"`
	APIKey    string `yaml:"api_key"`
	APISecret string `yaml:"api_secret"`
}

type Employee struct {
	Login        string `yaml:"login"`
	Name         string `yaml:"name"`
	PasswordHash string `yaml:"password_hash"`
}

func LoadConfig(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := yaml.Unmarshal(b, &cfg); err != nil {
		return nil, err
	}
	if cfg.Server.Room == "" || cfg.Server.LiveKit.Host == "" {
		return nil, errors.New("config: server.room и server.livekit.host обязательны")
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
