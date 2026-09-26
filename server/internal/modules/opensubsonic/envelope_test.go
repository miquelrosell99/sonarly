package opensubsonic

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/buildinfo"
)

// licenseEnvelope is the respond() input getLicense builds; redeclared here
// so envelope tests stay independent of the system handlers.
type licenseEnvelope struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	License licenseBody `xml:"license" json:"license"`
}

func respondVia(handler func(http.ResponseWriter, *http.Request), target string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

func decodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	env, ok := body["subsonic-response"]
	if !ok {
		t.Fatalf("missing subsonic-response key: %v", body)
	}
	return env
}

func TestNegotiateFormatFParam(t *testing.T) {
	cases := []struct {
		name   string
		target string
		want   string
	}{
		{"xml", "/rest/ping.view?f=xml", formatXML},
		{"json", "/rest/ping.view?f=json", formatJSON},
		{"absent", "/rest/ping.view", formatJSON},
		// wire parity: only the exact string "xml" selects XML; anything else
		// silently falls back to JSON (quirks doc E4).
		{"uppercase XML falls back", "/rest/ping.view?f=XML", formatJSON},
		{"unknown value falls back", "/rest/ping.view?f=jsonp", formatJSON},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.target, nil)
			if got := negotiateFormat(req); got != tc.want {
				t.Fatalf("negotiateFormat(%q) = %q, want %q", tc.target, got, tc.want)
			}
		})
	}
}

func TestNegotiateFormatAcceptHeader(t *testing.T) {
	cases := []struct {
		name   string
		accept string
		want   string
	}{
		{"empty accept keeps json default", "", formatJSON},
		{"xml accept", "application/xml", formatXML},
		{"text xml accept", "text/xml", formatXML},
		{"json accept", "application/json", formatJSON},
		{"wildcard keeps json default", "*/*", formatJSON},
		{"xml outranks json", "application/xml, application/json;q=0.5", formatXML},
		{"json outranks xml by q", "application/xml;q=0.8, application/json;q=1.0", formatJSON},
		{"browser-ish accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", formatXML},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/rest/ping.view", nil)
			if tc.accept != "" {
				req.Header.Set("Accept", tc.accept)
			}
			if got := negotiateFormat(req); got != tc.want {
				t.Fatalf("Accept %q = %q, want %q", tc.accept, got, tc.want)
			}
		})
	}
}

func TestFParamOverridesAccept(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/rest/ping.view?f=xml", nil)
	req.Header.Set("Accept", "application/json")
	if got := negotiateFormat(req); got != formatXML {
		t.Fatalf("f param must win over Accept, got %q", got)
	}
}

func TestJSONEnvelopeRoundTrip(t *testing.T) {
	rec := respondVia(func(w http.ResponseWriter, r *http.Request) {
		respond(w, r, licenseEnvelope{Envelope: okEnvelope(), License: licenseBody{Valid: true}})
	}, "/rest/getLicense.view")

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type = %q, want application/json", ct)
	}
	env := decodeEnvelope(t, rec)
	want := map[string]any{
		"status":        "ok",
		"version":       "1.16.1",
		"type":          "sonarly",
		"serverVersion": buildinfo.Version,
		"openSubsonic":  true,
		"license":       map[string]any{"valid": true},
	}
	for key, wantVal := range want {
		got, ok := env[key]
		if !ok {
			t.Fatalf("envelope missing %q: %v", key, env)
		}
		gotJSON, _ := json.Marshal(got)
		wantJSON, _ := json.Marshal(wantVal)
		if string(gotJSON) != string(wantJSON) {
			t.Fatalf("envelope[%q] = %s, want %s", key, gotJSON, wantJSON)
		}
	}
}

// TestXMLEnvelopeSnapshot pins the Go server XML shape conventions against what the old
// produced for the same payload (js2xml compact, spaces:2):
//
//	retired:  <subsonic-response status="ok" ...>\n  <license valid="true"/>\n</subsonic-response>
//
// Deltas are cosmetic and parse-identical (quirks doc E6): Go emits end
// tags instead of self-closing, and would escape quotes in attribute values
// numerically (&#34;) where the old server used named entities (&quot;).
func TestXMLEnvelopeSnapshot(t *testing.T) {
	rec := respondVia(func(w http.ResponseWriter, r *http.Request) {
		respond(w, r, licenseEnvelope{Envelope: okEnvelope(), License: licenseBody{Valid: true}})
	}, "/rest/getLicense.view?f=xml")

	if ct := rec.Header().Get("Content-Type"); ct != "application/xml" {
		t.Fatalf("content-type = %q, want application/xml", ct)
	}
	want := fmt.Sprintf("<subsonic-response status=\"ok\" version=\"1.16.1\" type=\"sonarly\" serverVersion=\"%s\" openSubsonic=\"true\">\n  <license valid=\"true\"></license>\n</subsonic-response>", buildinfo.Version)
	if rec.Body.String() != want {
		t.Fatalf("XML snapshot mismatch:\ngot:  %s\nwant: %s", rec.Body.String(), want)
	}
	if strings.HasPrefix(rec.Body.String(), "<?xml") {
		t.Fatalf("the old server emitted no XML declaration, the Go server must not either: %s", rec.Body.String())
	}
}

// TestXMLFailedEnvelopeSnapshot covers the error element and the attribute
// escaping both sides must agree on (the old server escapes & < > " in attribute
// values; Go also escapes ' as &#39; — parse-identical).
func TestXMLFailedEnvelopeSnapshot(t *testing.T) {
	rec := respondVia(func(w http.ResponseWriter, r *http.Request) {
		Error(w, r, CodeUnauthorized, "Wrong username & password")
	}, "/rest/ping.view?f=xml")

	if rec.Code != http.StatusOK {
		t.Fatalf("envelope errors keep HTTP 200 (quirks doc E1), got %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `status="failed"`) {
		t.Fatalf("missing failed status: %s", body)
	}
	if !strings.Contains(body, `<error code="40" message="Wrong username &amp; password"></error>`) {
		t.Fatalf("error element shape mismatch: %s", body)
	}
}

func TestJSONErrorEnvelope(t *testing.T) {
	rec := respondVia(func(w http.ResponseWriter, r *http.Request) {
		Error(w, r, CodeMissingParam, "Missing authentication")
	}, "/rest/ping.view")
	env := decodeEnvelope(t, rec)
	if env["status"] != "failed" {
		t.Fatalf("status = %v, want failed", env["status"])
	}
	errObj, ok := env["error"].(map[string]any)
	if !ok {
		t.Fatalf("missing error object: %v", env)
	}
	if errObj["code"] != float64(CodeMissingParam) || errObj["message"] != "Missing authentication" {
		t.Fatalf("error = %v", errObj)
	}
	if _, leaked := env["license"]; leaked {
		t.Fatalf("error payload must not carry data keys: %v", env)
	}
}

// TestEmptyListJSONvsXML pins quirks doc E7/S3: the empty
// openSubsonicExtensions list stays "[]" in JSON but produces no XML
// element — exactly what the old xml-js compact mapping did with empty arrays.
func TestEmptyListJSONvsXML(t *testing.T) {
	handler := func(w http.ResponseWriter, r *http.Request) {
		respond(w, r, extensionsPayload{Envelope: okEnvelope(), OpenSubsonicExtensions: []string{}})
	}

	jsonRec := respondVia(handler, "/rest/getOpenSubsonicExtensions.view")
	env := decodeEnvelope(t, jsonRec)
	list, ok := env["openSubsonicExtensions"].([]any)
	if !ok || len(list) != 0 {
		t.Fatalf(`JSON must keep the empty list as [], got %v`, env["openSubsonicExtensions"])
	}

	xmlRec := respondVia(handler, "/rest/getOpenSubsonicExtensions.view?f=xml")
	if strings.Contains(xmlRec.Body.String(), "openSubsonicExtensions") {
		t.Fatalf("the old server dropped empty arrays from XML (E7), got: %s", xmlRec.Body.String())
	}
}

// TestSongXMLShapeSnapshot compares the Go rendering of a song child
// against the old xml-js output for the equivalent JSON payload:
//
//	<song id="s1" title="T" isDir="false" duration="1">
//	  <artists id="a1" name="A &amp; B"/>
//	  <genres name="Rock"/>
//	  <isrcs>X1</isrcs><isrcs>X2</isrcs>
//	  <isrc>X1</isrc><isrc>X2</isrc>
//	</song>
//
// Same mapping: scalars as attributes, entry objects as child elements,
// string arrays as repeated text elements; Go differs only in end-tag
// style and the full attribute set the Go DTO always carries.
func TestSongXMLShapeSnapshot(t *testing.T) {
	type songEnvelope struct {
		XMLName xml.Name `xml:"subsonic-response" json:"-"`
		Envelope
		Song []Song `xml:"song" json:"song"`
	}
	song := Song{
		ID: "s1", Title: "T", Duration: 1, IsDir: false, IsVideo: false,
		Type: "music", Artists: []Entry{{ID: "a1", Name: "A & B"}},
		AlbumArtists: []Entry{{ID: "a1", Name: "A & B"}},
		Genres:       []NamedRef{{Name: "Rock"}},
		ISRCs:        []string{"X1", "X2"}, ISRC: []string{"X1", "X2"},
	}
	rec := respondVia(func(w http.ResponseWriter, r *http.Request) {
		respond(w, r, songEnvelope{Envelope: okEnvelope(), Song: []Song{song}})
	}, "/x?f=xml")
	body := rec.Body.String()

	checks := []string{
		`<song id="s1"`,
		`title="T"`,
		`isDir="false"`,
		`duration="1"`,
		`<artists id="a1" name="A &amp; B"></artists>`,
		`<genres name="Rock"></genres>`,
		`<isrcs>X1</isrcs>`,
		`<isrcs>X2</isrcs>`,
		`<isrc>X1</isrc>`,
	}
	for _, check := range checks {
		if !strings.Contains(body, check) {
			t.Fatalf("song XML missing %q:\n%s", check, body)
		}
	}
}

// TestGenreTextContent pins the `value` → chardata mapping (quirks doc
// E6): genre text is element content, counts are attributes.
func TestGenreTextContent(t *testing.T) {
	type genresEnvelope struct {
		XMLName xml.Name `xml:"subsonic-response" json:"-"`
		Envelope
		Genre []Genre `xml:"genre" json:"genre"`
	}
	rec := respondVia(func(w http.ResponseWriter, r *http.Request) {
		respond(w, r, genresEnvelope{Envelope: okEnvelope(), Genre: []Genre{{Value: "Rock", AlbumCount: 2, SongCount: 3}}})
	}, "/x?f=xml")
	want := `<genre albumCount="2" songCount="3">Rock</genre>`
	if !strings.Contains(rec.Body.String(), want) {
		t.Fatalf("genre chardata shape: want %s, got %s", want, rec.Body.String())
	}
}
