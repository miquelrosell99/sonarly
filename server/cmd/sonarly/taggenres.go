package main

// The tag-genres subcommand: bulk-backfill genres for genreless catalog
// songs from an operator-curated mapping, through the audio.TagWriter +
// library.PersistSong path (see internal/modules/taggenres). The server
// keeps the os.Args[1] != "tag-genres" behavior untouched.
//
//	sonarly tag-genres -db /data/db/sonarly.db -map genres.json            # dry-run
//	sonarly tag-genres -db /data/db/sonarly.db -map genres.json -apply    # write files + DB

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
	"github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/taggenres"
)

func runTagGenres(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("tag-genres", flag.ContinueOnError)
	dbPath := fs.String("db", "", "path to the SQLite database (required)")
	mapPath := fs.String("map", "", `JSON mapping file: {"artists": {"Name": "Genre"}, "albums": {...}} (required)`)
	apply := fs.Bool("apply", false, "write tags into files and the database (default: dry-run)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *dbPath == "" || *mapPath == "" {
		return errors.New("both -db and -map are required")
	}

	mapping, err := taggenres.LoadMapping(*mapPath)
	if err != nil {
		return err
	}
	database, err := db.Open(ctx, *dbPath)
	if err != nil {
		return fmt.Errorf("db: %w", err)
	}
	defer database.Close()
	if err := db.Migrate(ctx, database); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}

	plan, err := taggenres.Build(ctx, database, mapping)
	if err != nil {
		return err
	}
	for _, t := range plan.Targets {
		fmt.Printf("%s\t%s\t%s — %s\n", t.Genre, t.Source, t.Artist, t.Title)
	}
	fmt.Printf("%d songs resolved, %d unresolved\n", len(plan.Targets), len(plan.Unresolved))
	if len(plan.Unresolved) > 0 {
		fmt.Println("uncovered artists:")
		for _, name := range taggenres.SortedUniqueArtists(plan.Unresolved) {
			fmt.Println("  " + name)
		}
	}
	if !*apply {
		if len(plan.Targets) > 0 {
			fmt.Println("dry-run: re-run with -apply to write")
		}
		return nil
	}

	written, failed := taggenres.Apply(ctx, database, audio.NewMutagenWriter(), plan)
	fmt.Printf("applied: %d written, %d failed\n", len(written), len(failed))
	for _, f := range failed {
		fmt.Fprintln(os.Stderr, "failed:", f.Error())
	}
	if len(failed) > 0 {
		return fmt.Errorf("%d songs failed", len(failed))
	}
	return nil
}
