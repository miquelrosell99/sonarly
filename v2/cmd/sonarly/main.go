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
