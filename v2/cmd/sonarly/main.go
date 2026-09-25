// Command sonarly runs the Sonarly v2 server (Go rewrite, exploration branch).
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/miquelrosell99/sonarly/v2/internal/config"
	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/httpserver"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/catalog"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/library"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/playback"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/system"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/users"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "sonarly:", err)
		os.Exit(1)
	}
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
	system.Register(srv.Router(), system.NewService(database))

	sessionStore := auth.NewStore(database)
	authMW := auth.NewMiddleware(sessionStore, database, cfg.SessionSecret, cfg.SessionCookieSecure)
	users.NewHandler(users.NewService(database, sessionStore, cfg.SessionSecret), sessionStore, authMW, cfg.SessionSecret, cfg.SessionCookieSecure).
		Routes(srv.Router())
	catalog.NewHandler(catalog.NewService(database), authMW).Routes(srv.Router())

	// Playback (P5): streaming (direct + capped transcode), scrobble, and
	// bookmarks. The transcode semaphore and ffmpeg path are configurable;
	// the stream routes carry the /api/stream/ prefix, which httpserver
	// exempts from the global API timeout (a wall-clock deadline would kill
	// ffmpeg mid-song — disconnect handling and the semaphore bound streams).
	playback.NewHandler(playback.NewService(database, playback.Options{
		MaxConcurrentTranscodes: cfg.TranscodeConcurrency,
		FFmpegPath:              cfg.FFmpegPath,
	}, log), authMW).Routes(srv.Router())

	// Library runtime (P4b): job queue, worker, filesystem watcher and
	// scheduler, all context-driven so shutdown stops a scan between songs.
	if err := library.EnsureDefaultLibrary(ctx, database, cfg.LibraryPath); err != nil {
		return fmt.Errorf("default library: %w", err)
	}
	libraryQueue := library.NewQueue(database)
	libraryWorker := library.NewWorker(libraryQueue, library.NewScanner(database, log, cfg.LibraryPath), log)
	go libraryWorker.Start(ctx)
	go library.NewWatcher(database, libraryQueue, log, cfg.WatchPollInterval, cfg.LibraryPath).Run(ctx)
	go library.NewScheduler(database, libraryQueue, log, library.SchedulerOptions{
		ScanInterval:        cfg.ScanInterval,
		ArtistImageInterval: cfg.ArtistImageInterval,
		IngestInterval:      cfg.IngestInterval,
		IngestPath:          cfg.IngestPath,
	}).Run(ctx)
	library.NewHandler(libraryQueue, authMW).Routes(srv.Router())
	// Boot push of the initial scan (v1 parity); coalesces with a scan left
	// pending by a previous run instead of queueing a duplicate.
	if _, err := libraryQueue.Push(ctx, library.JobTypeScan, library.ScanPayload{}); err != nil {
		log.WarnContext(ctx, "initial scan enqueue failed", "err", err)
	}

	// Purge expired sessions hourly, stopping with the process context.
	go auth.RunSweeper(ctx, sessionStore, log, time.Hour)

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
