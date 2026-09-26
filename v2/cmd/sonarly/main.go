// Command sonarly runs the Sonarly v2 server (Go rewrite, exploration branch).
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/miquelrosell99/sonarly/v2/internal/audio"
	"github.com/miquelrosell99/sonarly/v2/internal/config"
	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/httpserver"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/admin"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/artistimages"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/autodj"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/catalog"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/events"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/home"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/ingest"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/interactions"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/libraries"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/library"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/opensubsonic"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/playback"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/players"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/playlists"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/providers"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/search"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/statistics"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/suggestions"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/system"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/tags"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/uploads"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/users"
	"github.com/miquelrosell99/sonarly/v2/internal/staticfs"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "sonarly:", err)
		os.Exit(1)
	}
}

// app bundles the background-runtime handles run() needs after route
// mounting. mountRoutes registers every route and returns these handles
// without starting any goroutine, so tests can walk the production router
// (the OpenAPI coverage test does).
type app struct {
	sessionStore  *auth.Store
	libraryQueue  *library.Queue
	libraryWorker *library.Worker
	eventsBroker  *events.Broker
	uploadRepo    *uploads.Repository
}

// mountRoutes registers every module's routes on srv. It is the route
// registry run() serves and the contract test walks — extracting it keeps
// the two from drifting apart.
func mountRoutes(ctx context.Context, srv *httpserver.Server, database *sql.DB, cfg config.Config, log *slog.Logger) (*app, error) {
	system.Register(srv.Router(), system.NewService(database, log))

	sessionStore := auth.NewStore(database)
	authMW := auth.NewMiddleware(sessionStore, database, cfg.SessionSecret, cfg.SessionCookieSecure)
	users.NewHandler(users.NewService(database, sessionStore, cfg.SessionSecret, cfg.DataDir), sessionStore, authMW, cfg.SessionSecret, cfg.SessionCookieSecure).
		Routes(srv.Router())
	catalog.NewHandler(catalog.NewService(database), authMW).Routes(srv.Router())

	// Playlists (P6): static + smart playlists, per-user shares, link
	// sharing, and THE single access policy — the streaming endpoint's
	// share-token hook and (in P9) the OpenSubsonic adapter consult it.
	playlistPolicy := playlists.NewPolicy()
	playlists.NewHandler(playlists.NewService(database, playlistPolicy), authMW).Routes(srv.Router())

	// Playback (P5): streaming (direct + capped transcode), scrobble, and
	// bookmarks. The transcode semaphore and ffmpeg path are configurable;
	// the stream routes carry the /api/stream/ prefix, which httpserver
	// exempts from the global API timeout (a wall-clock deadline would kill
	// ffmpeg mid-song — disconnect handling and the semaphore bound streams).
	playbackService := playback.NewService(database, playback.Options{
		MaxConcurrentTranscodes: cfg.TranscodeConcurrency,
		FFmpegPath:              cfg.FFmpegPath,
	}, log, playlistPolicy)
	// Players (P8): the tracker records EVERY stream through the playback
	// service's recorder hook (v1 only saw Subsonic clients — the players
	// module documents the deviation).
	playersTracker := players.NewTracker()
	playbackService.SetRecorder(playersTracker)
	playback.NewHandler(playbackService, authMW).Routes(srv.Router())
	players.NewHandler(playersTracker, database, authMW).Routes(srv.Router())

	// Search, statistics, home, auto-dj (P8). Search runs on the FTS5
	// indexes PersistSong maintains; statistics consolidates v1's ~20
	// queries per request into six; home aggregates the five landing
	// sections; auto-dj surfaces failures as 502 instead of v1's silent
	// empty 200.
	search.NewHandler(search.NewService(database), authMW).Routes(srv.Router())
	statistics.NewHandler(statistics.NewService(database), authMW).Routes(srv.Router())
	home.NewHandler(home.NewService(database), authMW).Routes(srv.Router())
	autodj.NewHandler(autodj.NewService(database), authMW).Routes(srv.Router())

	// Interactions (P9c): native favorites/ratings — the same user_*
	// junction rows the OpenSubsonic adapter writes (one data path).
	interactions.NewHandler(interactions.NewService(database), authMW).Routes(srv.Router())

	// OpenSubsonic adapter (P6.5 foundation, P9a browsing/retrieval, P9b
	// starring/now-playing/playlists/bookmarks): /rest envelope, auth hook,
	// system endpoints, then the full endpoint set against the quirks doc.
	// stream/download/scrobble/bookmarks delegate to the P5 playback
	// service; getNowPlaying reads the P8 players tracker; the playlist
	// endpoints delegate to the P6 playlists module (the ONE policy). The
	// library path feeds getMusicFolders' basename fallback. The hook runs
	// inside the group, after the shared session middleware it leans on for
	// cookie identity.
	opensubsonic.NewHandler(database, authMW, cfg.SessionSecret, cfg.LibraryPath, playbackService, playersTracker, playlists.NewService(database, playlistPolicy)).Routes(srv.Router())

	// Library runtime (P4b): job queue, worker, filesystem watcher and
	// scheduler, all context-driven so shutdown stops a scan between songs.
	if err := library.EnsureDefaultLibrary(ctx, database, cfg.LibraryPath); err != nil {
		return nil, fmt.Errorf("default library: %w", err)
	}
	libraryQueue := library.NewQueue(database)
	libraryWorker := library.NewWorker(libraryQueue, library.NewScanner(database, log, cfg.LibraryPath), log)
	// Ingest pipeline (P7b): the typed ingest/organize/cleanup_review job
	// handlers live in the ingest module and register here, so the worker
	// dispatches without the library package importing downstream modules.
	ingestService := ingest.NewService(database, log, libraryQueue, ingest.Options{
		IngestPath:          cfg.IngestPath,
		LibraryPath:         cfg.LibraryPath,
		ReviewRetentionDays: cfg.ReviewRetentionDays,
	})
	libraryWorker.Register(library.JobTypeIngest, ingestService.RunIngestJob)
	libraryWorker.Register(library.JobTypeOrganize, ingestService.RunOrganizeJob)
	libraryWorker.Register(library.JobTypeCleanupReview, ingestService.RunReviewCleanupJob)
	library.NewHandler(libraryQueue, authMW).Routes(srv.Router())
	ingest.NewHandler(ingestService, authMW, cfg.IngestPath).Routes(srv.Router())

	// P9c native parity: the libraries admin surface (library CRUD with the
	// is_default transaction invariant, both directions of the
	// user_libraries assignment endpoints, and the scoped picker list),
	// tag editing through the mutagen-backed audio.TagWriter (write →
	// organize → PersistSong → coalesced resync), magic-byte-sniffed
	// cover-art uploads, the admin suggestion whitelist, the MusicBrainz /
	// LRCLIB proxies (rate-limited, timeout-bounded, generically bounded
	// 502s), and the artist image sync as a real P4b job handler.
	libraries.NewHandler(database, authMW).Routes(srv.Router())
	tags.NewHandler(tags.NewService(database, audio.NewMutagenWriter(), ingestService, libraryQueue), authMW).Routes(srv.Router())
	suggestions.NewHandler(suggestions.NewService(database), authMW).Routes(srv.Router())
	providers.NewHandler(providers.NewMusicBrainzClient(), providers.NewLrcLibClient(), authMW).Routes(srv.Router())
	// Artist images (P9c): the images.ts port runs as the real artist_images
	// handler — the P4b scheduler's interval trigger fires it, the admin
	// refetch endpoint enqueues the same payload, and the job no longer
	// lands on the ErrNotImplemented placeholder.
	artistImageSyncer := artistimages.NewSyncer(database, cfg.DataDir, log)
	libraryWorker.Register(library.JobTypeArtistImages, artistImageSyncer.RunJob)
	artistimages.NewHandler(artistImageSyncer, libraryQueue).Routes(srv.Router(), authMW)

	// Admin dashboard (P9c): system-tasks (definitions, manual run, the
	// paginated history), the status counters, missing-file management, and
	// the ingest-runs views — all v1 admin-routes.ts ports.
	admin.NewHandler(admin.NewService(database, libraryQueue, admin.TaskIntervals{
		ScanInterval:          cfg.ScanInterval,
		ArtistImageInterval:   cfg.ArtistImageInterval,
		IngestInterval:        cfg.IngestInterval,
		ReviewCleanupInterval: cfg.ReviewCleanupInterval,
		IngestPath:            cfg.IngestPath,
	}), authMW).Routes(srv.Router())

	// Server-sent events (P8): the broker fans the worker's job-completion
	// channel out to /api/events clients (session auth only; 30s heartbeat;
	// library:changed on content-changing jobs). The SSE route is exempt
	// from the global API timeout in httpserver, like /api/stream/.
	eventsBroker := events.NewBroker(libraryWorker.Events(), log)
	events.NewHandler(eventsBroker, authMW).Routes(srv.Router())

	// Uploads (P7a): chunked upload sessions with streaming reassembly (the
	// audit's F10/B11 fixes) and a stale-session sweeper v1 never had.
	uploadRepo := uploads.NewRepository(database)
	uploads.NewHandler(uploadRepo, libraryQueue, authMW, cfg.DataDir, cfg.IngestPath).Routes(srv.Router())

	return &app{
		sessionStore:  sessionStore,
		libraryQueue:  libraryQueue,
		libraryWorker: libraryWorker,
		eventsBroker:  eventsBroker,
		uploadRepo:    uploadRepo,
	}, nil
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	database, err := db.Open(ctx, cfg.DBPath)
	if err != nil {
		return fmt.Errorf("db: %w", err)
	}
	defer database.Close()

	if err := db.Migrate(ctx, database); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}

	srv := httpserver.New(cfg, log)
	app, err := mountRoutes(ctx, srv, database, cfg, log)
	if err != nil {
		return err
	}

	// Static SPA serving (P11): the built web client is served at the root
	// with index.html fallback for extensionless deep links, installed on
	// the router's NotFound hook AFTER every API mount so /api/* and /rest/*
	// are never intercepted. A missing web-dist directory leaves the router
	// untouched — API-only mode, the behavior since the first scaffold.
	if err := staticfs.Mount(srv.Router(), cfg.WebDist); err != nil {
		return fmt.Errorf("web dist: %w", err)
	}

	// Background runtime: the worker, watcher, scheduler, SSE broker, upload
	// sweeper and session sweeper all run context-driven so shutdown stops
	// them between ticks.
	go app.libraryWorker.Start(ctx)
	go library.NewWatcher(database, app.libraryQueue, log, cfg.WatchPollInterval, cfg.LibraryPath).Run(ctx)
	go library.NewScheduler(database, app.libraryQueue, log, library.SchedulerOptions{
		ScanInterval:          cfg.ScanInterval,
		ArtistImageInterval:   cfg.ArtistImageInterval,
		IngestInterval:        cfg.IngestInterval,
		ReviewCleanupInterval: cfg.ReviewCleanupInterval,
		IngestPath:            cfg.IngestPath,
	}).Run(ctx)
	// Boot push of the initial scan (v1 parity); coalesces with a scan left
	// pending by a previous run instead of queueing a duplicate.
	if _, err := app.libraryQueue.Push(ctx, library.JobTypeScan, library.ScanPayload{}); err != nil {
		log.WarnContext(ctx, "initial scan enqueue failed", "err", err)
	}
	go app.eventsBroker.Run(ctx)
	go uploads.RunSweeper(ctx, app.uploadRepo, cfg.DataDir, log)
	go auth.RunSweeper(ctx, app.sessionStore, log, time.Hour)

	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv,
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", cfg.Addr)
		errCh <- httpServer.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	log.Info("shutdown complete")
	return nil
}
