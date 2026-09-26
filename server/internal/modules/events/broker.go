// Package events is the server-sent-events feed (P8): one stream per
// client, fed by the library worker's job-completion channel through a
// fan-out broker, with a 30-second heartbeat and library:changed broadcasts.
//
// Deviations from the retired server, deliberate and documented:
//
//   - Session auth only: API keys are rejected here even though the rest of
//     of the native API accepts them (old was session-only too). A long-
//     lived stream is a bigger exposure than a round trip, and EventSource
//     cannot set headers anyway.
//   - No replay (old had none either): events are dropped for clients that
//     fall behind, and there is no buffer to reconnect to. The client
//     refetches on reconnect (the web app's useServerEvents hook already
//     does). The queue table stays the durable record.
//   - Failed jobs broadcast nothing (the old job:completed was success-only):
//     a failed scan does not mark the library changed.
package events

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// heartbeatInterval is the SSE comment keepalive (wire parity).
const heartbeatInterval = 30 * time.Second

// subscriberBuffer bounds each client's queue; a slow consumer drops events
// (logged) instead of stalling the broker — the same policy the worker's
// own events channel uses.
const subscriberBuffer = 16

// Event is one wire payload. Stats carries the job's stats document.
type Event struct {
	Type   string         `json:"type"`
	Source string         `json:"source,omitempty"`
	JobID  string         `json:"jobId,omitempty"`
	Stats  map[string]any `json:"stats,omitempty"`
}

// shouldBroadcast applies the old changed-decision: content-changing job types
// with a non-zero change counter broadcast library:changed; everything else
// stays quiet.
func shouldBroadcast(jobType library.JobType, stats json.RawMessage) bool {
	var doc map[string]any
	if len(stats) > 0 {
		if err := json.Unmarshal(stats, &doc); err != nil {
			return false
		}
	}
	positive := func(keys ...string) bool {
		for _, key := range keys {
			if n, ok := doc[key].(float64); ok && n > 0 {
				return true
			}
		}
		return false
	}
	switch jobType {
	case library.JobTypeIngest:
		return positive("imported", "updated")
	case library.JobTypeScan, library.JobTypeResync, library.JobTypeOrganize:
		return positive("added", "updated", "moved", "removed")
	default:
		return false
	}
}

// Broker fans the single worker events channel out to any number of SSE
// clients. Exactly one Run consumer per broker; Run returns with ctx.
type Broker struct {
	incoming <-chan library.Event
	log      *slog.Logger

	mu   sync.Mutex
	subs map[chan Event]struct{}
}

func NewBroker(incoming <-chan library.Event, log *slog.Logger) *Broker {
	if log == nil {
		log = slog.Default()
	}
	return &Broker{incoming: incoming, log: log, subs: map[chan Event]struct{}{}}
}

// Run consumes the worker channel until ctx ends, broadcasting every
// change-worthy completion. It must be started exactly once (main does).
func (b *Broker) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case jobEvent, ok := <-b.incoming:
			if !ok {
				return
			}
			if jobEvent.Error != "" {
				// Failed jobs are not completions: nothing changed.
				continue
			}
			if !shouldBroadcast(jobEvent.Type, jobEvent.Stats) {
				continue
			}
			var stats map[string]any
			if len(jobEvent.Stats) > 0 {
				_ = json.Unmarshal(jobEvent.Stats, &stats)
			}
			b.broadcast(Event{
				Type:   "library:changed",
				Source: string(jobEvent.Type),
				JobID:  jobEvent.JobID,
				Stats:  stats,
			})
		}
	}
}

// broadcast delivers to every subscriber; full buffers drop the event for
// that client only.
func (b *Broker) broadcast(ev Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- ev:
		default:
			b.log.Warn("events: client not keeping up, dropping event", "type", ev.Type)
		}
	}
}

// Subscribe registers a client; the returned func removes it (idempotent).
func (b *Broker) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, subscriberBuffer)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	var once sync.Once
	unsubscribe := func() {
		once.Do(func() {
			b.mu.Lock()
			delete(b.subs, ch)
			b.mu.Unlock()
		})
	}
	return ch, unsubscribe
}

// ClientCount reports the live subscriber count (routes/tests).
func (b *Broker) ClientCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.subs)
}
