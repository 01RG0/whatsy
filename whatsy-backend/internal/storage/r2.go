package storage

import (
	"bytes"
	"context"
	"fmt"
	"log"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// R2Client uploads objects to Cloudflare R2 and returns their public URLs.
type R2Client struct {
	client    *s3.Client
	bucket    string
	publicURL string
}

// NewR2Client returns nil (disabled) if any credential is empty.
func NewR2Client(accountID, accessKeyID, secretAccessKey, bucket, publicURL string) *R2Client {
	if accountID == "" || accessKeyID == "" || secretAccessKey == "" || bucket == "" || publicURL == "" {
		return nil
	}
	endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID)
	client := s3.New(s3.Options{
		Region:      "auto",
		Credentials: credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, ""),
		BaseEndpoint: aws.String(endpoint),
		UsePathStyle: true,
	})
	return &R2Client{client: client, bucket: bucket, publicURL: publicURL}
}

// Upload stores data at key in R2 and returns the public URL.
func (r *R2Client) Upload(ctx context.Context, key string, data []byte, mimeType string) (string, error) {
	_, err := r.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(r.bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(mimeType),
	})
	if err != nil {
		return "", fmt.Errorf("r2 put %s: %w", key, err)
	}
	url := r.publicURL + "/" + key
	log.Printf("[r2] uploaded %s (%d bytes)", key, len(data))
	return url, nil
}

// Exists returns true if an object with key already exists in R2.
func (r *R2Client) Exists(ctx context.Context, key string) bool {
	_, err := r.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	return err == nil
}

// PublicURL returns the public URL for a given object key.
func (r *R2Client) PublicURL(key string) string {
	return r.publicURL + "/" + key
}
