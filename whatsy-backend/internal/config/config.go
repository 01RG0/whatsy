package config

import (
	"errors"
	"os"
)

// Config contains the runtime configuration for the API server.
type Config struct {
	Port                string
	DatabaseURL         string
	JWTSecret           string
	ZernioAPIKey        string
	ZernioWebhookSecret string
	SupabaseURL         string
	SupabaseServiceKey  string
}

// Load reads configuration from environment variables.
// PORT defaults to 8080; DATABASE_URL is required.
func Load() (Config, error) {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	config := Config{
		Port:                port,
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		JWTSecret:           os.Getenv("JWT_SECRET"),
		ZernioAPIKey:        os.Getenv("ZERNIO_API_KEY"),
		ZernioWebhookSecret: os.Getenv("ZERNIO_WEBHOOK_SECRET"),
		SupabaseURL:         os.Getenv("SUPABASE_URL"),
		SupabaseServiceKey:  os.Getenv("SUPABASE_SERVICE_KEY"),
	}
	if config.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if config.JWTSecret == "" {
		return Config{}, errors.New("JWT_SECRET is required")
	}
	if config.ZernioAPIKey == "" {
		return Config{}, errors.New("ZERNIO_API_KEY is required")
	}

	return config, nil
}
