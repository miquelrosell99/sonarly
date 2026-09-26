package opensubsonic

import (
	"encoding/xml"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/miquelrosell99/sonarly/server/internal/buildinfo"
	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
)

// Wire constants of the subsonic-response envelope (v1 responses.ts
// parity: version and type are fixed; serverVersion comes from build info
// instead of v1's stale "0.1.0" constant — quirks doc E2).
const (
	apiVersion = "1.16.1"
	serverType = "sonarly"
)

// Subsonic error codes (quirks doc E3). v1's adapter used 10 (missing
// auth/param), 40 (bad credentials) and — deviating from the spec's 50 —
// 70 for "Data not found"; v2 keeps that mapping at the adapter boundary
// because shipped clients were tested against it.
const (
	CodeNotImplemented = 0
	CodeMissingParam   = 10
	CodeGeneric        = 20
	CodeUnauthorized   = 40
	CodeDataNotFound   = 50 // spec assignment; v1 actually used 70 (CodeForbidden)
	CodeForbidden      = 70 // v1's de-facto data-not-found code, kept for wire parity
)

// Response formats.
const (
	formatJSON = "json"
	formatXML  = "xml"
)

// Envelope is embedded in every response payload struct. Its fields render
// as attributes of <subsonic-response> in XML and as top-level keys in the
// JSON envelope ({"subsonic-response": {...}}).
type Envelope struct {
	Status        string        `xml:"status,attr" json:"status"`
	Version       string        `xml:"version,attr" json:"version"`
	Type          string        `xml:"type,attr" json:"type"`
	ServerVersion string        `xml:"serverVersion,attr" json:"serverVersion"`
	OpenSubsonic  bool          `xml:"openSubsonic,attr" json:"openSubsonic"`
	Error         *ErrorElement `xml:"error" json:"error,omitempty"`
}

// ErrorElement is the subsonic <error> element.
type ErrorElement struct {
	Code    int    `xml:"code,attr" json:"code"`
	Message string `xml:"message,attr" json:"message"`
}

// okEnvelope returns the Envelope for a successful response.
func okEnvelope() Envelope {
	return Envelope{
		Status:        "ok",
		Version:       apiVersion,
		Type:          serverType,
		ServerVersion: buildinfo.Version,
		OpenSubsonic:  true,
	}
}

// failedEnvelope returns the Envelope for a failed response.
func failedEnvelope(code int, message string) Envelope {
	return Envelope{
		Status:        "failed",
		Version:       apiVersion,
		Type:          serverType,
		ServerVersion: buildinfo.Version,
		OpenSubsonic:  true,
		Error:         &ErrorElement{Code: code, Message: message},
	}
}

// emptyPayload is an OK envelope with no data elements (ping).
type emptyPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
}

// errorPayload is a failed envelope carrying only the error element.
type errorPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
}

// respond writes payload — a struct carrying an embedded Envelope plus
// xml/json-tagged data fields — as the subsonic-response envelope in the
// negotiated format, always with HTTP 200 (quirks doc E1).
func respond(w http.ResponseWriter, r *http.Request, payload any) {
	if negotiateFormat(r) == formatXML {
		out, err := xml.MarshalIndent(payload, "", "  ")
		if err != nil {
			httpserver.Error(w, http.StatusInternalServerError, "envelope encoding failed")
			return
		}
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusOK)
		w.Write(out)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"subsonic-response": payload})
}

// Error writes a failed envelope carrying only the error element.
func Error(w http.ResponseWriter, r *http.Request, code int, message string) {
	respond(w, r, errorPayload{Envelope: failedEnvelope(code, message)})
}

// negotiateFormat selects the response format (quirks doc E4): an explicit
// f param wins — exactly "xml" yields XML, anything else JSON, v1 parity —
// and only when f is absent does the Accept header get a say.
func negotiateFormat(r *http.Request) string {
	if f := r.URL.Query().Get("f"); f != "" {
		if f == formatXML {
			return formatXML
		}
		return formatJSON
	}
	return acceptFormat(r.Header.Get("Accept"))
}

// acceptFormat parses an Accept header value and returns xml only when an
// XML media type strictly outranks JSON. */* and empty headers keep the v1
// JSON default.
func acceptFormat(accept string) string {
	best, bestQ := formatJSON, 0.0
	for _, part := range strings.Split(accept, ",") {
		mediaType, params, err := mime.ParseMediaType(strings.TrimSpace(part))
		if err != nil {
			continue
		}
		q := 1.0
		if qs, ok := params["q"]; ok {
			if qv, err := strconv.ParseFloat(qs, 64); err == nil {
				q = qv
			}
		}
		switch mediaType {
		case "application/xml", "text/xml":
			if q > bestQ {
				best, bestQ = formatXML, q
			}
		case "application/json", "*/*":
			if q > bestQ {
				best, bestQ = formatJSON, q
			}
		}
	}
	return best
}
