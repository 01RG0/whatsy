package config

import (
	"errors"
	"os"
	"strings"
)

// Config contains the runtime configuration for the API server.
type Config struct {
	Port                string
	DatabaseURL         string
	JWTSecret           string
	ZernioAPIKey        string
	ZernioWebhookSecret string
	RedisURL            string
	R2AccountID         string
	R2AccessKeyID       string
	R2SecretAccessKey   string
	R2Bucket            string
	R2PublicURL         string
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
		RedisURL:            os.Getenv("REDIS_URL"),
		R2AccountID:         os.Getenv("R2_ACCOUNT_ID"),
		R2AccessKeyID:       os.Getenv("R2_ACCESS_KEY_ID"),
		R2SecretAccessKey:   os.Getenv("R2_SECRET_ACCESS_KEY"),
		R2Bucket:            os.Getenv("R2_BUCKET"),
		R2PublicURL:         os.Getenv("R2_PUBLIC_URL"),
	}
	if config.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if !strings.Contains(config.DatabaseURL, "prepare=") {
		if strings.Contains(config.DatabaseURL, "?") {
			config.DatabaseURL += "&prepare=false"
		} else {
			config.DatabaseURL += "?prepare=false"
		}
	}
	// Force read-write mode on every connection so Supabase's pooler never
	// routes an INSERT to a read replica.
	if !strings.Contains(config.DatabaseURL, "default_transaction_read_only") {
		config.DatabaseURL += "&options=-c+default_transaction_read_only%3Doff"
	}
	if config.JWTSecret == "" {
		return Config{}, errors.New("JWT_SECRET is required")
	}
	if config.ZernioAPIKey == "" {
		return Config{}, errors.New("ZERNIO_API_KEY is required")
	}

	return config, nil
}
