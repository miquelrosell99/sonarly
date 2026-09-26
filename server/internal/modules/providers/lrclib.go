// LRCLIB lyrics search client: the old features/lrclib/search.ts port — the
// query builder, the one-retry-on-429/503 backoff, the record mapping with
// LRC synced-lyric parsing, and the non-array error shape.
package providers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
)

// lrclibBaseURL is the old LRCLIB_BASE_URL. Tests override it via the client.
const lrclibBaseURL = "https://lrclib.net/api"

// retryDelay is the old RETRY_DELAY_MS.
const retryDelay = time.Second

// LrcLibMatch is the old LrcLibMatch DTO.
type LrcLibMatch struct {
	ID           int                     `json:"id"`
	Title        string                  `json:"title"`
	ArtistName   string                  `json:"artistName,omitempty"`
	AlbumName    string                  `json:"albumName,omitempty"`
	Duration     float64                 `json:"duration,omitempty"`
	Instrumental bool                    `json:"instrumental"`
	Lyrics       string                  `json:"lyrics,omitempty"`
	SyncedLyrics []audio.SyncedLyricLine `json:"syncedLyrics,omitempty"`
}

// LrcLibQuery is the old searchLrcLib argument.
type LrcLibQuery struct {
	Title    string
	Artist   string
	Album    string
	Duration *float64
}

// LrcLibClient searches LRCLIB through the timeout-bound transport.
type LrcLibClient struct {
	baseURL string
	client  *http.Client
	// sleep is replaceable in tests (the retired server 1s backoff).
	sleep func(time.Duration)
}

// LrcLibOption customizes the client (tests point it at an httptest server
// and skip the retry backoff).
type LrcLibOption func(*LrcLibClient)

// WithLrcLibBaseURL overrides the API base URL.
func WithLrcLibBaseURL(base string) LrcLibOption {
	return func(c *LrcLibClient) { c.baseURL = base }
}

// WithLrcLibSleep overrides the retry backoff sleep.
func WithLrcLibSleep(sleep func(time.Duration)) LrcLibOption {
	return func(c *LrcLibClient) { c.sleep = sleep }
}

// WithLrcLibHTTPClient overrides the transport.
func WithLrcLibHTTPClient(client *http.Client) LrcLibOption {
	return func(c *LrcLibClient) { c.client = client }
}

// NewLrcLibClient constructs the production client.
func NewLrcLibClient(opts ...LrcLibOption) *LrcLibClient {
	c := &LrcLibClient{
		baseURL: lrclibBaseURL,
		client:  &http.Client{},
		sleep:   time.Sleep,
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

type lrcLibApiRecord struct {
	ID           int     `json:"id"`
	Name         string  `json:"name"`
	TrackName    string  `json:"trackName"`
	ArtistName   string  `json:"artistName"`
	AlbumName    string  `json:"albumName"`
	Duration     float64 `json:"duration"`
	Instrumental bool    `json:"instrumental"`
	PlainLyrics  string  `json:"plainLyrics"`
	SyncedLyrics string  `json:"syncedLyrics"`
}

func apiRecordToMatch(record lrcLibApiRecord) LrcLibMatch {
	title := record.TrackName
	if title == "" {
		title = record.Name
	}
	if title == "" {
		title = "Unknown title"
	}
	m := LrcLibMatch{
		ID:           record.ID,
		Title:        title,
		ArtistName:   record.ArtistName,
		AlbumName:    record.AlbumName,
		Duration:     record.Duration,
		Instrumental: record.Instrumental,
		Lyrics:       record.PlainLyrics,
	}
	if record.SyncedLyrics != "" {
		lines := audio.ParseLRC(record.SyncedLyrics)
		if len(lines) > 0 {
			m.SyncedLyrics = lines
		}
	}
	return m
}

func buildLrcLibSearchURL(base string, query LrcLibQuery) string {
	params := url.Values{}
	params.Set("track_name", query.Title)
	if query.Artist != "" {
		params.Set("artist_name", query.Artist)
	}
	if query.Album != "" {
		params.Set("album_name", query.Album)
	}
	if query.Duration != nil {
		params.Set("duration", fmt.Sprintf("%d", int(*query.Duration+0.5)))
	}
	return fmt.Sprintf("%s/search?%s", base, params.Encode())
}

// get fetches one URL with the shared timeout and headers.
func (c *LrcLibClient) get(ctx context.Context, url string) (*http.Response, error) {
	req, cancel, err := newRequest(ctx, url)
	if err != nil {
		return nil, err
	}
	defer cancel()
	return c.client.Do(req)
}

// Search is the old searchLrcLib: one retry with backoff on 429/503.
func (c *LrcLibClient) Search(ctx context.Context, query LrcLibQuery) ([]LrcLibMatch, error) {
	url := buildLrcLibSearchURL(c.baseURL, query)
	resp, err := c.get(ctx, url)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusServiceUnavailable {
		resp.Body.Close()
		c.sleep(retryDelay)
		resp, err = c.get(ctx, url)
		if err != nil {
			return nil, err
		}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lrclib returned %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var records []lrcLibApiRecord
	if err := json.Unmarshal(raw, &records); err != nil {
		// old: a non-array body is an error document {"error": ...}.
		var errDoc struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &errDoc) == nil && errDoc.Error != "" {
			return nil, errors.New(errDoc.Error)
		}
		return nil, fmt.Errorf("lrclib response: %w", err)
	}
	matches := make([]LrcLibMatch, 0, len(records))
	for _, record := range records {
		matches = append(matches, apiRecordToMatch(record))
	}
	return matches, nil
}
