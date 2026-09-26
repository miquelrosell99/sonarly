// MusicBrainz search client: the v1 features/musicbrainz/search.ts port —
// Lucene query building/escaping, the recording/release/artist response
// mapping (coverartarchive URLs, tag-to-genre extraction, artist-credit
// splitting), and the mbid-fetch variants the route uses for exact lookups.
package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// mbBaseURL is v1's MB_BASE_URL. Tests point the client at an httptest
// server by overriding it.
const mbBaseURL = "https://musicbrainz.org/ws/2"

// mbRateLimitDelay is v1's RATE_LIMIT_DELAY_MS: MusicBrainz asks anonymous
// users to stay under 1 req/sec; v1 waited 1.2s between requests.
const mbRateLimitDelay = 1200 * time.Millisecond

// Match is v1's MusicBrainzMatch DTO.
type Match struct {
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Artist         string   `json:"artist,omitempty"`
	Artists        []string `json:"artists,omitempty"`
	Album          string   `json:"album,omitempty"`
	AlbumArtist    string   `json:"albumArtist,omitempty"`
	AlbumArtists   []string `json:"albumArtists,omitempty"`
	Genres         []string `json:"genres,omitempty"`
	Year           int      `json:"year,omitempty"`
	CoverArt       string   `json:"coverArt,omitempty"`
	Disambiguation string   `json:"disambiguation,omitempty"`
}

// MusicBrainzClient searches MusicBrainz through the rate-limited transport.
type MusicBrainzClient struct {
	baseURL string
	client  *http.Client
	limiter *rateLimiter
}

// MBOption customizes the client (tests point it at an httptest server and
// shrink the rate-limit spacing).
type MBOption func(*MusicBrainzClient)

// WithMBBaseURL overrides the API base URL.
func WithMBBaseURL(base string) MBOption {
	return func(c *MusicBrainzClient) { c.baseURL = base }
}

// WithMBRateLimit overrides the inter-request spacing.
func WithMBRateLimit(d time.Duration) MBOption {
	return func(c *MusicBrainzClient) { c.limiter.minInterval = d }
}

// WithMBHTTPClient overrides the transport.
func WithMBHTTPClient(client *http.Client) MBOption {
	return func(c *MusicBrainzClient) { c.client = client }
}

// NewMusicBrainzClient constructs the production client.
func NewMusicBrainzClient(opts ...MBOption) *MusicBrainzClient {
	c := &MusicBrainzClient{
		baseURL: mbBaseURL,
		client:  &http.Client{},
		limiter: &rateLimiter{minInterval: mbRateLimitDelay},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// mbArtistCredit/MbTag/MbRelease/MbRecording mirror v1's interfaces.
type mbArtistCredit struct {
	Name   string `json:"name"`
	Artist *struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"artist"`
}

type mbTag struct {
	Name  string `json:"name"`
	Count *int   `json:"count"`
	Score *int   `json:"score"`
}

type mbReleaseGroup struct {
	ID          string `json:"id"`
	PrimaryType string `json:"primary-type"`
}

type mbRelease struct {
	ID           string           `json:"id"`
	Title        string           `json:"title"`
	Date         string           `json:"date"`
	ArtistCredit []mbArtistCredit `json:"artist-credit"`
	ReleaseGroup *mbReleaseGroup  `json:"release-group"`
	Tags         []mbTag          `json:"tags"`
}

type mbRecording struct {
	ID             string           `json:"id"`
	Title          string           `json:"title"`
	Disambiguation string           `json:"disambiguation"`
	ArtistCredit   []mbArtistCredit `json:"artist-credit"`
	Releases       []mbRelease      `json:"releases"`
	Tags           []mbTag          `json:"tags"`
}

type mbArtist struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Disambiguation string  `json:"disambiguation"`
	Tags           []mbTag `json:"tags"`
}

func extractYear(date string) int {
	if len(date) < 4 {
		return 0
	}
	year, err := strconv.Atoi(date[:4])
	if err != nil {
		return 0
	}
	return year
}

// artistSplitRe is v1's ARTIST_SPLIT_REGEX.
var artistSplitRe = regexp.MustCompile(`\s*[,;/]\s*|\s+&\s+|\s+feat\.\s+|\s+featuring\s+|\s+ft\.\s+`)

func splitArtists(value string) []string {
	parts := []string{}
	for _, p := range artistSplitRe.Split(value, -1) {
		if t := strings.TrimSpace(p); t != "" {
			parts = append(parts, t)
		}
	}
	if len(parts) == 0 {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return []string{trimmed}
		}
		return nil
	}
	return parts
}

func firstArtist(value string) string {
	parts := splitArtists(value)
	if len(parts) == 0 {
		return value
	}
	return parts[0]
}

func extractArtistName(credits []mbArtistCredit) string {
	if len(credits) == 0 {
		return ""
	}
	names := make([]string, 0, len(credits))
	for _, c := range credits {
		names = append(names, c.Name)
	}
	return strings.Join(names, "; ")
}

func extractArtistNames(credits []mbArtistCredit) []string {
	if len(credits) == 0 {
		return nil
	}
	names := make([]string, 0, len(credits))
	for _, c := range credits {
		if c.Name != "" {
			names = append(names, c.Name)
		}
	}
	if len(names) == 0 {
		return nil
	}
	return names
}

func extractGenres(tags []mbTag) []string {
	if len(tags) == 0 {
		return nil
	}
	names := make([]string, 0, len(tags))
	for _, t := range tags {
		score := 1
		if t.Score != nil {
			score = *t.Score
		} else if t.Count != nil {
			score = *t.Count
		}
		if score > 0 && t.Name != "" {
			names = append(names, t.Name)
		}
	}
	if len(names) == 0 {
		return nil
	}
	return names
}

func buildCoverArtURL(mbid string, isReleaseGroup bool) string {
	if isReleaseGroup {
		return "https://coverartarchive.org/release-group/" + mbid + "/front"
	}
	return "https://coverartarchive.org/release/" + mbid + "/front"
}

func recordingToMatch(recording mbRecording) Match {
	var release *mbRelease
	if len(recording.Releases) > 0 {
		release = &recording.Releases[0]
	}
	var releaseMbid, releaseGroupMbid string
	if release != nil {
		releaseMbid = release.ID
		if release.ReleaseGroup != nil {
			releaseGroupMbid = release.ReleaseGroup.ID
		}
	}
	coverArtMbid := releaseMbid
	isReleaseGroup := false
	if coverArtMbid == "" && releaseGroupMbid != "" {
		coverArtMbid = releaseGroupMbid
		isReleaseGroup = true
	}
	var releaseCredits []mbArtistCredit
	var date string
	if release != nil {
		releaseCredits = release.ArtistCredit
		date = release.Date
	}
	m := Match{
		ID:             recording.ID,
		Title:          recording.Title,
		Artist:         extractArtistName(recording.ArtistCredit),
		Artists:        extractArtistNames(recording.ArtistCredit),
		AlbumArtist:    extractArtistName(releaseCredits),
		AlbumArtists:   extractArtistNames(releaseCredits),
		Genres:         extractGenres(recording.Tags),
		Disambiguation: recording.Disambiguation,
	}
	if release != nil {
		m.Album = release.Title
		m.Genres = extractGenres(recording.Tags)
		if m.Genres == nil {
			m.Genres = extractGenres(release.Tags)
		}
		m.Year = extractYear(date)
	}
	if coverArtMbid != "" {
		m.CoverArt = buildCoverArtURL(coverArtMbid, isReleaseGroup)
	}
	return m
}

func releaseToMatch(release mbRelease) Match {
	releaseGroupMbid := ""
	if release.ReleaseGroup != nil {
		releaseGroupMbid = release.ReleaseGroup.ID
	}
	coverArtMbid := release.ID
	isReleaseGroup := false
	if coverArtMbid == "" && releaseGroupMbid != "" {
		coverArtMbid = releaseGroupMbid
		isReleaseGroup = true
	}
	m := Match{
		ID:           release.ID,
		Title:        release.Title,
		AlbumArtist:  extractArtistName(release.ArtistCredit),
		AlbumArtists: extractArtistNames(release.ArtistCredit),
		Genres:       extractGenres(release.Tags),
		Year:         extractYear(release.Date),
	}
	if coverArtMbid != "" {
		m.CoverArt = buildCoverArtURL(coverArtMbid, isReleaseGroup)
	}
	return m
}

func artistToMatch(artist mbArtist) Match {
	return Match{
		ID:             artist.ID,
		Title:          artist.Name,
		Disambiguation: artist.Disambiguation,
		Genres:         extractGenres(artist.Tags),
	}
}

// escapeLucene ports v1's escapeLucene: the Lucene specials get backslash
// escapes, and values containing spaces are wrapped in quotes.
var luceneSpecialRe = regexp.MustCompile(`([+\-!(){}\[\]^"~*?:\\/])`)

func escapeLucene(value string) string {
	escaped := luceneSpecialRe.ReplaceAllString(value, `\$1`)
	if strings.Contains(escaped, " ") {
		return `"` + escaped + `"`
	}
	return escaped
}

func buildRecordingQuery(title, artist, album string) string {
	parts := []string{"recording:" + escapeLucene(title)}
	if strings.TrimSpace(artist) != "" {
		parts = append(parts, "artist:"+escapeLucene(firstArtist(artist)))
	}
	if strings.TrimSpace(album) != "" {
		parts = append(parts, "release:"+escapeLucene(album))
	}
	return strings.Join(parts, " AND ")
}

func buildReleaseQuery(title, artist string) string {
	parts := []string{"release:" + escapeLucene(title)}
	if strings.TrimSpace(artist) != "" {
		parts = append(parts, "artist:"+escapeLucene(firstArtist(artist)))
	}
	return strings.Join(parts, " AND ")
}

// get rate-limits, fetches, and decodes one MusicBrainz GET.
func (c *MusicBrainzClient) get(ctx context.Context, url string, out any) error {
	c.limiter.wait()
	req, cancel, err := newRequest(ctx, url)
	if err != nil {
		return err
	}
	defer cancel()
	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("musicbrainz returned %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// SearchRecordings is v1's searchMusicBrainzRecordings (limit 5 by default).
func (c *MusicBrainzClient) SearchRecordings(ctx context.Context, title, artist, album string, limit int) ([]Match, error) {
	query := buildRecordingQuery(title, artist, album)
	endpoint := fmt.Sprintf("%s/recording/?query=%s&fmt=json&limit=%d",
		c.baseURL, url.QueryEscape(query), limit)
	var result struct {
		Recordings []mbRecording `json:"recordings"`
	}
	if err := c.get(ctx, endpoint, &result); err != nil {
		return nil, err
	}
	matches := make([]Match, 0, len(result.Recordings))
	for _, recording := range result.Recordings {
		matches = append(matches, recordingToMatch(recording))
	}
	return matches, nil
}

// SearchReleases is v1's searchMusicBrainzReleases.
func (c *MusicBrainzClient) SearchReleases(ctx context.Context, title, artist string, limit int) ([]Match, error) {
	query := buildReleaseQuery(title, artist)
	endpoint := fmt.Sprintf("%s/release/?query=%s&fmt=json&limit=%d",
		c.baseURL, url.QueryEscape(query), limit)
	var result struct {
		Releases []mbRelease `json:"releases"`
	}
	if err := c.get(ctx, endpoint, &result); err != nil {
		return nil, err
	}
	matches := make([]Match, 0, len(result.Releases))
	for _, release := range result.Releases {
		matches = append(matches, releaseToMatch(release))
	}
	return matches, nil
}

// SearchArtists is v1's searchMusicBrainzArtists.
func (c *MusicBrainzClient) SearchArtists(ctx context.Context, name string, limit int) ([]Match, error) {
	query := "artist:" + escapeLucene(name)
	endpoint := fmt.Sprintf("%s/artist/?query=%s&fmt=json&limit=%d",
		c.baseURL, url.QueryEscape(query), limit)
	var result struct {
		Artists []mbArtist `json:"artists"`
	}
	if err := c.get(ctx, endpoint, &result); err != nil {
		return nil, err
	}
	matches := make([]Match, 0, len(result.Artists))
	for _, artist := range result.Artists {
		matches = append(matches, artistToMatch(artist))
	}
	return matches, nil
}

// FetchRecording is v1's fetchMusicBrainzRecording: a 404 answers nil.
func (c *MusicBrainzClient) FetchRecording(ctx context.Context, mbid string) (*Match, error) {
	endpoint := fmt.Sprintf("%s/recording/%s?inc=releases+tags&fmt=json",
		c.baseURL, url.PathEscape(mbid))
	var recording mbRecording
	ok, err := c.fetchEntity(ctx, endpoint, &recording)
	if err != nil || !ok {
		return nil, err
	}
	m := recordingToMatch(recording)
	return &m, nil
}

// FetchRelease is v1's fetchMusicBrainzRelease.
func (c *MusicBrainzClient) FetchRelease(ctx context.Context, mbid string) (*Match, error) {
	endpoint := fmt.Sprintf("%s/release/%s?inc=tags&fmt=json",
		c.baseURL, url.PathEscape(mbid))
	var release mbRelease
	ok, err := c.fetchEntity(ctx, endpoint, &release)
	if err != nil || !ok {
		return nil, err
	}
	m := releaseToMatch(release)
	return &m, nil
}

// FetchArtist is v1's fetchMusicBrainzArtistMatch.
func (c *MusicBrainzClient) FetchArtist(ctx context.Context, mbid string) (*Match, error) {
	endpoint := fmt.Sprintf("%s/artist/%s?inc=tags&fmt=json",
		c.baseURL, url.PathEscape(mbid))
	var artist mbArtist
	ok, err := c.fetchEntity(ctx, endpoint, &artist)
	if err != nil || !ok {
		return nil, err
	}
	m := artistToMatch(artist)
	return &m, nil
}

// fetchEntity GETs one entity endpoint and decodes it; a 404 answers
// found=false without an error (v1 returns undefined and the route falls
// through to a search).
func (c *MusicBrainzClient) fetchEntity(ctx context.Context, endpoint string, out any) (bool, error) {
	c.limiter.wait()
	req, cancel, err := newRequest(ctx, endpoint)
	if err != nil {
		return false, err
	}
	defer cancel()
	resp, err := c.client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("musicbrainz returned %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return false, err
	}
	return true, nil
}
