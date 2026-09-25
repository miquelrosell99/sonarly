// Package config loads and validates server configuration from the environment.
package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	Addr                string // listen address, e.g. ":8080"
	DBPath              string // SQLite database file
	DataDir             string // server-owned state (artist images, uploads)
	LibraryPath         string // root of the music library
	IngestPath          string // drop folder for ingest
	SessionSecret       string // >= 32 chars; never logged
	SessionCookieSecure bool   // mark the session cookie Secure (set behind HTTPS)
}

func Load() (Config, error) {
	cfg := Config{
		Addr:                getEnv("SONARLY_ADDR", ":8080"),
		DBPath:              getEnv("SONARLY_DB_PATH", "./data/sonarly.db"),
		DataDir:             getEnv("SONARLY_DATA_DIR", "./data"),
		LibraryPath:         os.Getenv("SONARLY_LIBRARY_PATH"),
		IngestPath:          os.Getenv("SONARLY_INGEST_PATH"),
		SessionSecret:       os.Getenv("SESSION_SECRET"),
		SessionCookieSecure: getBoolEnv("SESSION_COOKIE_SECURE", false),
	}

	var problems []string
	if len(cfg.SessionSecret) < 32 {
		problems = append(problems, "SESSION_SECRET must be set and at least 32 characters")
	}
	if cfg.LibraryPath == "" {
		problems = append(problems, "SONARLY_LIBRARY_PATH must be set")
	}
	if len(problems) > 0 {
		return Config{}, fmt.Errorf("invalid configuration: %s", strings.Join(problems, "; "))
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getBoolEnv(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	switch strings.ToLower(v) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
