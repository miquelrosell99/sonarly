package testdualrun

// P10b harness: snapshot of the live production DB + data dir, v2 boot on a
// DB copy against the real library, reconciliation wait, and shared test
// infrastructure. See doc.go for the package overview.

import (
	"bytes"
	"crypto/md5"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"golang.org/x/crypto/bcrypt"
)

const (
	// Live production state (READ-ONLY for this harness; copies are made
	// before anything opens them).
	liveDataDir     = "/etc/periphery/stacks/sonarly/config/sonarly/data"
	liveLibraryPath = "/etc/periphery/stacks/sonarly/config/sonarly/library"
	liveV1HealthURL = "http://127.0.0.1:4534/healthz" // compose.yaml maps ${SONARLY_PORT:-4533}; actual deployment uses 4534

	adminUser = "p10badmin"
	adminPass = "p10b-dualrun-pass-7381"
	// subsonicPass is what we seal into users.subsonic_password_encrypted;
	// the /rest u/t/s token is md5(subsonicPass+salt).
	subsonicPass = "p10b-subsonic-pass-2910"
)

var audioExts = map[string]bool{".mp3": true, ".flac": true, ".ogg": true, ".m4a": true}

type environment struct {
	tmp      string
	v2DB     string // v2-processed copy of the production DB
	pristine string // untouched second copy of the snapshot
	v2Data   string
	ingest   string
	libDir   string
	binPath  string
	port     int
	secret   string
	setupLog []string // human-readable setup facts for the report

	// Populated during the run.
	baseline  *catalogState
	onDisk    []diskFile
	scan      *scanOutcome
	v2proc    *serverProc
	startedAt time.Time
	snapDB    int64
	snapWAL   int64
}

type diskFile struct {
	Path    string
	Size    int64
	ModTime time.Time
	Abs     string
}

type catalogState struct {
	Counts map[string]int
	Active int // songs.active=1 rows in the pristine snapshot
}

type scanOutcome struct {
	JobID         string
	Status        string
	Stats         scanStats
	Failures      []scanFailure
	Error         string
	WallClock     time.Duration // process boot -> observed completed
	JobStartedAt  string
	JobFinishedAt string
}

type scanStats struct {
	Scanned int `json:"scanned"`
	Added   int `json:"added"`
	Updated int `json:"updated"`
	Removed int `json:"removed"`
	Moved   int `json:"moved"`
	Failed  int `json:"failed"`
}

type scanFailure struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

var (
	env      *environment
	adminUID string
)

func TestMain(m *testing.M) { os.Exit(runMain(m)) }

func runMain(m *testing.M) int {
	if st, err := os.Stat(liveDataDir); err != nil || !st.IsDir() {
		fmt.Fprintf(os.Stderr, "p10b: live data dir %s unavailable (%v) — skipping production dual-run\n", liveDataDir, err)
		return 0
	}
	t0 := time.Now()
	root := os.Getenv("P10B_TMP_ROOT")
	tmp, err := os.MkdirTemp(root, "sonarly-p10b-*")
	if err != nil {
		fmt.Fprintln(os.Stderr, "p10b setup:", err)
		return 1
	}
	if os.Getenv("P10B_KEEP_TMP") != "" {
		logf("keeping temp dir %s", tmp)
	} else {
		defer os.RemoveAll(tmp)
	}

	env = &environment{
		tmp:      tmp,
		v2DB:     filepath.Join(tmp, "v2db", "sonarly.db"),
		pristine: filepath.Join(tmp, "pristinedb", "sonarly.db"),
		v2Data:   filepath.Join(tmp, "v2data"),
		ingest:   filepath.Join(tmp, "ingest"),
		libDir:   liveLibraryPath,
		secret:   testSecret(),
	}
	for _, d := range []string{filepath.Dir(env.v2DB), filepath.Dir(env.pristine), env.v2Data, env.ingest,
		filepath.Join(env.v2Data, "artist-images"), filepath.Join(env.v2Data, "avatars")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			fmt.Fprintln(os.Stderr, "p10b setup:", err)
			return 1
		}
	}

	logf("snapshotting production DB (db+wal+shm) and data dir into %s", tmp)
	if err := snapshotProduction(); err != nil {
		fmt.Fprintln(os.Stderr, "p10b snapshot:", err)
		return 1
	}

	if err := walkLibrary(); err != nil {
		fmt.Fprintln(os.Stderr, "p10b library walk:", err)
		return 1
	}

	logf("reading baseline catalog state from pristine copy")
	base, err := readBaseline()
	if err != nil {
		fmt.Fprintln(os.Stderr, "p10b baseline:", err)
		return 1
	}
	env.baseline = base

	logf("preparing v2 DB copy (libraries path rewrite + admin user insert)")
	if err := prepareV2Copy(); err != nil {
		fmt.Fprintln(os.Stderr, "p10b prepare:", err)
		return 1
	}

	logf("building v2 binary")
	bin := filepath.Join(tmp, "sonarly-v2")
	if err := buildV2(bin); err != nil {
		fmt.Fprintln(os.Stderr, "p10b build:", err)
		return 1
	}
	env.binPath = bin
	env.port = freePort()

	env.startedAt = time.Now()
	logf("booting v2 on the DB copy (library=%s)", env.libDir)
	v2 := bootV2(env)
	env.v2proc = v2
	logf("v2 up on :%d after %s", env.port, time.Since(env.startedAt).Round(time.Millisecond))

	if err := loginAdmin(); err != nil {
		fmt.Fprintln(os.Stderr, "p10b login:", err)
		v2.stop()
		return 1
	}

	logf("waiting for the boot-pushed initial scan to complete")
	scan, err := waitScanComplete(15 * time.Minute)
	if err != nil {
		fmt.Fprintln(os.Stderr, "p10b scan:", err)
		v2.stop()
		return 1
	}
	env.scan = scan
	logf("scan completed: %s", scan.Stats)

	probeLiveV1()

	code := m.Run()

	v2.stop()
	finalizeReport(code, time.Since(t0))
	return code
}

func logf(format string, args ...any) { fmt.Fprintf(os.Stderr, "p10b: "+format+"\n", args...) }

func testSecret() string {
	if s := os.Getenv("P10B_SESSION_SECRET"); s != "" {
		return s
	}
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	s := hex.EncodeToString(b)
	os.Setenv("P10B_SESSION_SECRET", s)
	return s
}

// ---------------------------------------------------------------------------
// Snapshot + setup.
// ---------------------------------------------------------------------------

// snapshotProduction copies the live DB trio (main + WAL + SHM) into BOTH
// the v2-processing dir and the pristine dir, then copies the v1-owned data
// subdirs (artist images, avatars) into the temp DATA_DIR. The live v1
// server keeps running; copying the WAL before the main file yields a
// consistent committed state on open (SQLite validates the frame chain and
// ignores mismatched tails), and the -shm copy is rebuilt by the opener if
// it disagrees with the WAL.
func snapshotProduction() error {
	src := filepath.Join(liveDataDir, "sonarly.db")
	for _, suffix := range []string{"-wal", "-shm", ""} {
		in := src + suffix
		if _, err := os.Stat(in); err != nil {
			continue
		}
		data, err := os.ReadFile(in)
		if err != nil {
			return err
		}
		for _, dst := range []string{env.v2DB + suffix, env.pristine + suffix} {
			if err := os.WriteFile(dst, data, 0o644); err != nil {
				return err
			}
		}
	}
	for _, sub := range []string{"artist-images", "avatars"} {
		if err := copyDir(filepath.Join(liveDataDir, sub), filepath.Join(env.v2Data, sub)); err != nil {
			return err
		}
	}
	env.snapDB = dbSize(env.v2DB)
	env.snapWAL = dbSize(env.v2DB + "-wal")
	return nil
}

func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		out := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(out, 0o755)
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(out, data, 0o644)
	})
}

func walkLibrary() error {
	return filepath.WalkDir(env.libDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !audioExts[strings.ToLower(filepath.Ext(p))] {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return err
		}
		env.onDisk = append(env.onDisk, diskFile{Path: p, Abs: p, Size: fi.Size(), ModTime: fi.ModTime()})
		return nil
	})
}

func openCopy(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

var countTables = []string{
	"songs", "albums", "artists", "genres", "labels",
	"song_artists", "album_artists", "song_genres", "album_genres", "song_composers", "album_labels",
	"playlists", "playlist_songs", "playlist_shares",
	"user_songs", "user_albums", "user_artists", "user_playlists", "user_libraries",
	"listening_history", "bookmarks", "cover_arts",
	"users", "libraries", "sessions", "settings", "scan_jobs", "ingest_jobs", "upload_sessions",
}

// readBaseline folds the pristine WAL and records the pre-v2 catalog state.
func readBaseline() (*catalogState, error) {
	db, err := openCopy(env.pristine)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	var integrity string
	if err := db.QueryRow(`PRAGMA quick_check`).Scan(&integrity); err != nil {
		return nil, fmt.Errorf("integrity check: %w", err)
	}
	if integrity != "ok" {
		return nil, fmt.Errorf("pristine snapshot failed quick_check: %s", integrity)
	}
	env.setupLog = append(env.setupLog, "pristine copy: PRAGMA quick_check = "+integrity)
	if _, err := db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		return nil, err
	}
	st := &catalogState{Counts: map[string]int{}}
	for _, t := range countTables {
		var n int
		if err := db.QueryRow(`SELECT COUNT(1) FROM ` + t).Scan(&n); err != nil {
			return nil, fmt.Errorf("count %s: %w", t, err)
		}
		st.Counts[t] = n
	}
	var active, inactive int
	if err := db.QueryRow(`SELECT COUNT(1) FROM songs WHERE active=1`).Scan(&active); err != nil {
		return nil, err
	}
	if err := db.QueryRow(`SELECT COUNT(1) FROM songs WHERE active=0`).Scan(&inactive); err != nil {
		return nil, err
	}
	st.Active = active
	env.setupLog = append(env.setupLog,
		fmt.Sprintf("pre-scan: songs active=%d inactive=%d (total %d)", active, inactive, active+inactive))
	return st, nil
}

// prepareV2Copy applies test-only setup to the copies. The production rows
// carry the v1 container prefix /media/music; the host library lives
// elsewhere, so BOTH copies get the identical path rebase
// (songs.file_path + libraries.path) to the host library root — this is the
// layout the v2 container will actually see in production (same mounts as
// v1), and identical treatment keeps the pristine copy a fair diff
// baseline. Then a fresh admin (bcrypt hash + v1-wire-compatible sealed
// Subsonic password) is inserted into the v2 copy only.
func prepareV2Copy() error {
	prefix, err := pathPrefix()
	if err != nil {
		return err
	}
	abs, err := filepath.Abs(env.libDir)
	if err != nil {
		return err
	}
	for _, dbPath := range []string{env.v2DB, env.pristine} {
		db, err := openCopy(dbPath)
		if err != nil {
			return err
		}
		var leftover int
		if err := db.QueryRow(`SELECT COUNT(1) FROM songs WHERE SUBSTR(file_path, 1, LENGTH(?)) <> ?`, prefix, prefix).Scan(&leftover); err != nil {
			db.Close()
			return err
		}
		res, err := db.Exec(`UPDATE songs SET file_path = ? || SUBSTR(file_path, LENGTH(?) + 1)
			WHERE SUBSTR(file_path, 1, LENGTH(?)) = ?`, abs, prefix, prefix, prefix)
		if err != nil {
			db.Close()
			return fmt.Errorf("rebase songs in %s: %w", dbPath, err)
		}
		n, _ := res.RowsAffected()
		if _, err := db.Exec(`UPDATE libraries SET path = ?`, abs); err != nil {
			db.Close()
			return err
		}
		db.Close()
		env.setupLog = append(env.setupLog,
			fmt.Sprintf("%s: rebased %d song paths %q -> %q (%d rows used another prefix)", filepath.Base(filepath.Dir(dbPath)), n, prefix, abs, leftover))
	}

	db, err := openCopy(env.v2DB)
	if err != nil {
		return err
	}
	defer db.Close()

	var libID string
	if err := db.QueryRow(`SELECT id FROM libraries ORDER BY is_default DESC, path LIMIT 1`).Scan(&libID); err != nil {
		return fmt.Errorf("libraries row: %w", err)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(adminPass), 12)
	if err != nil {
		return err
	}
	enc, err := auth.EncryptSecret(subsonicPass, env.secret)
	if err != nil {
		return err
	}
	uid := uuid.NewString()
	adminUID = uid
	res, err := db.Exec(`INSERT INTO users (id, username, password_hash, is_admin, created_at, subsonic_password_encrypted)
		VALUES (?, ?, ?, 1, datetime('now'), ?)`, uid, adminUser, string(hash), enc)
	if err != nil {
		return fmt.Errorf("insert admin: %w", err)
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return fmt.Errorf("insert admin: rows affected %d", n)
	}
	if _, err := db.Exec(`INSERT INTO user_libraries (user_id, library_id) VALUES (?, ?)`, uid, libID); err != nil {
		return fmt.Errorf("insert user_libraries: %w", err)
	}
	env.setupLog = append(env.setupLog,
		fmt.Sprintf("admin %q inserted on the copy (id %s) with bcrypt hash + v1-wire-compatible sealed subsonic password", adminUser, uid))
	return nil
}

// ---------------------------------------------------------------------------
// Server process (mirrors testparity's harness).
// ---------------------------------------------------------------------------

// pathPrefix returns the production library root prefix stored in the
// snapshot (the v1 container path the song rows are rooted under).
func pathPrefix() (string, error) {
	db, err := openCopy(env.v2DB)
	if err != nil {
		return "", err
	}
	defer db.Close()
	var prefix string
	if err := db.QueryRow(`SELECT path FROM libraries ORDER BY is_default DESC, path LIMIT 1`).Scan(&prefix); err != nil {
		return "", fmt.Errorf("libraries row: %w", err)
	}
	return strings.TrimRight(prefix, "/"), nil
}

func buildV2(out string) error {
	goBin := "go"
	if _, err := exec.LookPath("go"); err != nil {
		goBin = "/usr/local/go/bin/go"
	}
	wd, _ := os.Getwd()
	root := filepath.Dir(wd)
	cmd := exec.Command(goBin, "build", "-o", out, "./cmd/sonarly")
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
	outBuf, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("go build: %v: %s", err, strings.TrimSpace(string(outBuf)))
	}
	return nil
}

type serverProc struct {
	name string
	cmd  *exec.Cmd
	log  *bytes.Buffer
}

func startProc(name string, cmd *exec.Cmd) *serverProc {
	p := &serverProc{name: name, cmd: cmd, log: &bytes.Buffer{}}
	cmd.Stdout = p.log
	cmd.Stderr = p.log
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		panic(fmt.Sprintf("start %s: %v", name, err))
	}
	return p
}

func (p *serverProc) stop() {
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return
	}
	pgid := p.cmd.Process.Pid
	done := make(chan struct{})
	go func() {
		_, _ = p.cmd.Process.Wait()
		close(done)
	}()
	_ = syscall.Kill(-pgid, syscall.SIGTERM)
	select {
	case <-done:
		return
	case <-time.After(20 * time.Second):
	}
	_ = syscall.Kill(-pgid, syscall.SIGKILL)
	<-done
}

func (p *serverProc) waitHealthy(path string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	url := fmt.Sprintf("http://127.0.0.1:%d%s", env.port, path)
	for time.Now().Before(deadline) {
		resp, err := http.Get(url) //nolint:gosec // harness, localhost
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("%s not healthy at %s within %s; last logs:\n%s",
		p.name, url, timeout, lastLines(p.log.String(), 40))
}

func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

func bootV2(e *environment) *serverProc {
	cmd := exec.Command(e.binPath)
	cmd.Env = append(os.Environ(),
		"SONARLY_ADDR=127.0.0.1:"+fmt.Sprint(e.port),
		"SONARLY_DB_PATH="+e.v2DB,
		"SONARLY_DATA_DIR="+e.v2Data,
		"SONARLY_LIBRARY_PATH="+e.libDir,
		"SONARLY_INGEST_PATH="+e.ingest,
		"SESSION_SECRET="+e.secret,
		"SESSION_COOKIE_SECURE=false",
		"SONARLY_SCAN_INTERVAL_MINUTES=0",
		"SONARLY_WATCH_POLL_INTERVAL=3600",
		"SONARLY_ARTIST_IMAGE_INTERVAL_MINUTES=0",
		"SONARLY_INGEST_INTERVAL_MINUTES=0",
		"SONARLY_REVIEW_CLEANUP_INTERVAL_MINUTES=0",
	)
	p := startProc("v2", cmd)
	if err := p.waitHealthy("/health", 90*time.Second); err != nil {
		p.stop()
		panic(err)
	}
	return p
}

func freePort() int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

// ---------------------------------------------------------------------------
// HTTP client.
// ---------------------------------------------------------------------------

type client struct {
	base   string
	cookie string
	http   *http.Client
}

type capture struct {
	status int
	header http.Header
	body   []byte
	json   any
}

func newClient(port int) *client {
	return &client{
		base: fmt.Sprintf("http://127.0.0.1:%d", port),
		http: &http.Client{Timeout: 10 * time.Minute},
	}
}

func (c *client) do(method, path string, body any, headers map[string]string) (*capture, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, rd)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if c.cookie != "" {
		req.Header.Set("Cookie", c.cookie)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	cap := &capture{status: resp.StatusCode, header: resp.Header.Clone(), body: data}
	if ct := resp.Header.Get("Content-Type"); strings.Contains(ct, "application/json") ||
		strings.HasPrefix(ct, "text/json") {
		var v any
		if err := json.Unmarshal(data, &v); err == nil {
			cap.json = v
		}
	}
	if sc := resp.Header.Get("Set-Cookie"); sc != "" {
		c.cookie = strings.Split(sc, ";")[0]
	}
	return cap, nil
}

func sortedKeys(m map[string][]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func urlQueryEscape(s string) string {
	var sb strings.Builder
	for _, r := range []byte(s) {
		switch {
		case r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' ||
			r == '-' || r == '_' || r == '.' || r == '~':
			sb.WriteByte(r)
		case r == ' ':
			sb.WriteString("+")
		default:
			sb.WriteString(fmt.Sprintf("%%%02X", r))
		}
	}
	return sb.String()
}

// restGET hits /rest with u/t/s token auth (md5(password+salt), quirks A3).
func (c *client) restGET(endpoint string, q map[string][]string, headers map[string]string) (*capture, error) {
	salt := make([]byte, 8)
	_, _ = rand.Read(salt)
	sum := md5Sum([]byte(subsonicPass + hex.EncodeToString(salt)))
	params := map[string][]string{
		"u": {adminUser},
		"t": {hex.EncodeToString(sum)},
		"s": {hex.EncodeToString(salt)},
		"v": {"1.16.1"},
		"c": {"p10b-dualrun"},
		"f": {"json"},
	}
	for k, vs := range q {
		params[k] = vs
	}
	var sb strings.Builder
	sb.WriteString("/rest/" + endpoint)
	sep := "?"
	for _, k := range sortedKeys(params) {
		for _, v := range params[k] {
			sb.WriteString(sep + k + "=" + urlQueryEscape(v))
			sep = "&"
		}
	}
	return c.do("GET", sb.String(), nil, headers)
}

func md5Sum(b []byte) []byte {
	sum := md5.Sum(b)
	return sum[:]
}

// ---------------------------------------------------------------------------
// Login + scan wait.
// ---------------------------------------------------------------------------

func loginAdmin() error {
	c := newClient(env.port)
	cap, err := c.do("POST", "/api/login", map[string]any{"username": adminUser, "password": adminPass}, nil)
	if err != nil {
		return err
	}
	if cap.status != http.StatusOK {
		return fmt.Errorf("login: status %d: %s", cap.status, lastLines(string(cap.body), 5))
	}
	apiClient = c
	return nil
}

var apiClient *client

func waitScanComplete(timeout time.Duration) (*scanOutcome, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		cap, err := apiClient.do("GET", "/api/scans/status", nil, nil)
		if err != nil {
			return nil, err
		}
		if cap.status != http.StatusOK {
			return nil, fmt.Errorf("scans/status: status %d", cap.status)
		}
		var st struct {
			Job *struct {
				ID         string          `json:"id"`
				Type       string          `json:"type"`
				Status     string          `json:"status"`
				StartedAt  string          `json:"startedAt"`
				FinishedAt string          `json:"finishedAt"`
				Stats      json.RawMessage `json:"stats"`
				Error      string          `json:"error"`
			} `json:"job"`
		}
		if err := json.Unmarshal(cap.body, &st); err != nil {
			return nil, err
		}
		if st.Job == nil {
			time.Sleep(500 * time.Millisecond)
			continue
		}
		if st.Job.Status != "completed" && st.Job.Status != "failed" {
			time.Sleep(1 * time.Second)
			continue
		}
		out := &scanOutcome{
			JobID:         st.Job.ID,
			Status:        st.Job.Status,
			Error:         st.Job.Error,
			WallClock:     time.Since(env.startedAt),
			JobStartedAt:  st.Job.StartedAt,
			JobFinishedAt: st.Job.FinishedAt,
		}
		if len(st.Job.Stats) > 0 {
			if err := json.Unmarshal(st.Job.Stats, &out.Stats); err != nil {
				return nil, fmt.Errorf("scan stats: %w", err)
			}
			var withFailures struct {
				Failures []scanFailure `json:"failures"`
			}
			_ = json.Unmarshal(st.Job.Stats, &withFailures)
			out.Failures = withFailures.Failures
		}
		if out.Status != "completed" {
			return out, fmt.Errorf("scan job %s ended %s: %s", out.JobID, out.Status, out.Error)
		}
		return out, nil
	}
	return nil, fmt.Errorf("scan did not complete within %s; logs:\n%s", timeout, lastLines(env.v2proc.log.String(), 60))
}

// probeLiveV1 records (but never fails on) the live v1 server's health —
// evidence the production container was untouched during the dual-run.
// We deliberately do NOT attempt any login against v1.
func probeLiveV1() {
	req, err := http.NewRequest("GET", liveV1HealthURL, nil)
	if err != nil {
		return
	}
	httpc := &http.Client{Timeout: 5 * time.Second}
	resp, err := httpc.Do(req)
	if err != nil {
		env.setupLog = append(env.setupLog, "live v1 probe: unreachable ("+err.Error()+") — skipped by design")
		return
	}
	_ = resp.Body.Close()
	env.setupLog = append(env.setupLog,
		fmt.Sprintf("live v1 probe: GET %s -> %d (no login attempted; parity evidence stands on the testparity suite)", liveV1HealthURL, resp.StatusCode))
}
