package testparity

// P10 harness: seeds a tagged library, boots the v1 TypeScript server from
// the main checkout, scans, snapshots the DB, boots the v2 Go server on the
// DB copy, and replays one deterministic request script against both. See
// doc.go for the package overview and parity_norm.go for accepted deltas.

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
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

	"github.com/miquelrosell99/sonarly/v2/internal/audio"
)

const (
	v1Checkout = "/etc/periphery/stacks/sonarly"
	v1Server   = v1Checkout + "/packages/server"

	adminUser = "parity"
	adminPass = "parity-password-123"

	corpusDir = "internal/audio/testdata/corpus"
)

// world carries per-run facts published by steps (created entity ids,
// tokens, resolved catalog ids). Each server run gets its own world; the
// runner remaps published values that differ between runs before diffing.
type world struct {
	values  map[string]any
	remap   map[string]bool // keys whose string values may differ between runs
	catalog map[string]string
}

func newWorld() *world {
	return &world{values: map[string]any{}, remap: map[string]bool{}, catalog: map[string]string{}}
}

func (w *world) set(key string, v any, remap bool) {
	w.values[key] = v
	if remap {
		w.remap[key] = true
	}
}

func (w *world) get(key string) any { return w.values[key] }

func (w *world) str(key string) string {
	s, _ := w.values[key].(string)
	return s
}

// ---------------------------------------------------------------------------
// TestMain orchestration.
// ---------------------------------------------------------------------------

var (
	env *environment // shared across tests in this package
)

type environment struct {
	tmp      string
	libDir   string
	v1Data   string
	v2Data   string
	v2DB     string // copy of the v1 DB v2 boots on
	binPath  string
	v1Port   int
	v2Port   int
	password string
}

func TestMain(m *testing.M) {
	os.Exit(runMain(m))
}

func runMain(m *testing.M) int {
	t0 := time.Now()
	tmp, err := os.MkdirTemp("", "sonarly-p10-*")
	if err != nil {
		fmt.Fprintln(os.Stderr, "p10 setup:", err)
		return 1
	}
	if os.Getenv("P10_KEEP_TMP") != "" {
		logf("keeping temp dir %s", tmp)
	} else {
		defer os.RemoveAll(tmp)
	}

	env = &environment{
		tmp:      tmp,
		libDir:   filepath.Join(tmp, "library"),
		v1Data:   filepath.Join(tmp, "v1data"),
		v2Data:   filepath.Join(tmp, "v2data"),
		password: adminPass,
	}
	env.v2DB = filepath.Join(env.v2Data, "sonarly.db")
	for _, d := range []string{env.libDir, env.v1Data, env.v2Data, filepath.Join(env.v1Data, "ingest")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			fmt.Fprintln(os.Stderr, "p10 setup:", err)
			return 1
		}
	}

	logf("seeding library in %s", env.libDir)
	if err := seedLibrary(env.libDir); err != nil {
		fmt.Fprintln(os.Stderr, "p10 seed:", err)
		return 1
	}

	logf("building v2 binary")
	bin := filepath.Join(tmp, "sonarly-v2")
	if err := buildV2(bin); err != nil {
		fmt.Fprintln(os.Stderr, "p10 build:", err)
		return 1
	}
	env.binPath = bin

	env.v1Port = freePort()
	env.v2Port = freePort()

	v1 := bootV1(env)
	logf("v1 up on :%d after %s", env.v1Port, time.Since(t0).Round(time.Millisecond))
	if err := v1.setupAndScan(); err != nil {
		fmt.Fprintln(os.Stderr, "p10 v1 scan:", err)
		v1.stop()
		return 1
	}

	// Read phase on v1 (no catalog writes), then snapshot the DB so v2
	// starts from the identical pre-write state, then the write phase. One
	// client per server keeps the session cookie across phases.
	v1World := newWorld()
	c1 := newClient(env.v1Port, v1World, env.password, false)
	v1Rec, err := runSteps(c1, v1World, false)
	if err != nil {
		fmt.Fprintln(os.Stderr, "p10 v1 steps:", err)
		v1.stop()
		return 1
	}

	if err := snapshotDB(filepath.Join(env.v1Data, "sonarly.db"), env.v2DB); err != nil {
		fmt.Fprintln(os.Stderr, "p10 snapshot:", err)
		v1.stop()
		return 1
	}

	v1Write, err := runSteps(c1, v1World, true)
	if err != nil {
		fmt.Fprintln(os.Stderr, "p10 v1 write steps:", err)
		v1.stop()
		return 1
	}
	v1Rec = append(v1Rec, v1Write...)
	logf("v1 phases done after %s", time.Since(t0).Round(time.Second))

	// v1 stays up: v2 boots on the snapshot (separate DB file, same library
	// dir — no conflict), and the performance smoke needs both servers.
	v2 := bootV2(env)
	defer v2.stop()
	logf("v2 up on :%d after %s", env.v2Port, time.Since(t0).Round(time.Millisecond))

	v2World := newWorld()
	c2 := newClient(env.v2Port, v2World, env.password, true)
	v2Rec, err := runSteps(c2, v2World, false)
	if err != nil {
		fmt.Fprintln(os.Stderr, "p10 v2 steps:", err)
		return 1
	}
	v2Write, err := runSteps(c2, v2World, true)
	if err != nil {
		fmt.Fprintln(os.Stderr, "p10 v2 write steps:", err)
		return 1
	}
	v2Rec = append(v2Rec, v2Write...)

	results = compareRuns(v1Rec, v2Rec, v1World, v2World)

	if err := runPerformanceSmoke(); err != nil {
		fmt.Fprintln(os.Stderr, "p10 perf smoke:", err)
	}

	code := m.Run()

	v1.stop()
	writeReport(code, time.Since(t0))
	if code != 0 || len(results) > 0 && countFailures(results) > 0 {
		logf("v2 server log tail:\n%s", lastLines(v2Proc.log.String(), 30))
	}
	return code
}

func countFailures(rs []caseResult) int {
	n := 0
	for _, r := range rs {
		n += len(r.Failures)
	}
	return n
}

func logf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "p10: "+format+"\n", args...)
}

func freePort() int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func buildV2(out string) error {
	goBin := "go"
	if _, err := exec.LookPath("go"); err != nil {
		goBin = "/usr/local/go/bin/go"
	}
	wd, _ := os.Getwd() // v2/testparity
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

// ---------------------------------------------------------------------------
// Server processes.
// ---------------------------------------------------------------------------

type serverProc struct {
	name string
	cmd  *exec.Cmd
	log  *bytes.Buffer
}

// v1Proc/v2Proc keep the server logs reachable for post-run diagnosis.
var v1Proc, v2Proc *serverProc

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

// stop SIGTERMs the whole process group, escalating to SIGKILL after 20s.
// Safe to call twice.
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
	url := fmt.Sprintf("http://127.0.0.1:%s%s", p.port(), path)
	for time.Now().Before(deadline) {
		resp, err := http.Get(url) //nolint:gosec // test harness, localhost
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

func (p *serverProc) port() string {
	re := map[string]string{"v1": fmt.Sprint(env.v1Port), "v2": fmt.Sprint(env.v2Port)}
	return re[p.name]
}

func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

func bootV1(e *environment) *serverProc {
	cmd := exec.Command("pnpm", "--dir", v1Server, "exec", "tsx", "src/index.ts")
	cmd.Env = append(os.Environ(),
		"PORT="+fmt.Sprint(e.v1Port),
		"NODE_ENV=development",
		"SESSION_SECRET="+testSecret(),
		"SESSION_COOKIE_SECURE=false",
		"DATA_DIR="+e.v1Data,
		"LIBRARY_PATH="+e.libDir,
		"INGEST_PATH="+filepath.Join(e.v1Data, "ingest"),
		"SCAN_INTERVAL_MINUTES=0",
		"ARTIST_IMAGE_INTERVAL_MINUTES=0",
		"INGEST_INTERVAL_MINUTES=0",
	)
	p := startProc("v1", cmd)
	v1Proc = p
	if err := p.waitHealthy("/healthz", 90*time.Second); err != nil {
		p.stop()
		panic(err)
	}
	return p
}

func bootV2(e *environment) *serverProc {
	cmd := exec.Command(e.binPath)
	cmd.Env = append(os.Environ(),
		"SONARLY_ADDR=127.0.0.1:"+fmt.Sprint(e.v2Port),
		"SONARLY_DB_PATH="+e.v2DB,
		"SONARLY_DATA_DIR="+e.v2Data,
		"SONARLY_LIBRARY_PATH="+e.libDir,
		"SESSION_SECRET="+testSecret(),
		"SONARLY_SCAN_INTERVAL_MINUTES=0",
		"SONARLY_WATCH_POLL_INTERVAL=3600",
		"SONARLY_ARTIST_IMAGE_INTERVAL_MINUTES=0",
		"SONARLY_INGEST_INTERVAL_MINUTES=0",
		"SONARLY_REVIEW_CLEANUP_INTERVAL_MINUTES=0",
	)
	p := startProc("v2", cmd)
	v2Proc = p
	if err := p.waitHealthy("/health", 90*time.Second); err != nil {
		panic(err)
	}
	return p
}

func testSecret() string {
	// Fixed per process tree so both servers share it (the v1-created user's
	// subsonic_password_encrypted column decrypts with it on v2).
	if s := os.Getenv("P10_SESSION_SECRET"); s != "" {
		return s
	}
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	s := hex.EncodeToString(b)
	os.Setenv("P10_SESSION_SECRET", s)
	return s
}

// setupAndScan creates the admin and drives v1's scan to completion.
func (p *serverProc) setupAndScan() error {
	c := newClient(env.v1Port, newWorld(), env.password, false)
	if _, err := c.doRaw("POST", "/api/setup", map[string]any{"username": adminUser, "password": env.password}, nil); err != nil {
		return err
	}
	waitScanIdle(c, 180*time.Second)
	if _, err := c.doRaw("POST", "/api/scans", nil, nil); err != nil {
		return err
	}
	if err := waitScanIdle(c, 180*time.Second); err != nil {
		return err
	}
	// Sanity: v1 must have ingested the seeded library.
	var listing struct {
		Songs []map[string]any `json:"songs"`
	}
	cap, err := c.do("GET", "/api/songs", nil, nil)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(cap.body, &listing); err != nil {
		return err
	}
	if len(listing.Songs) != len(seedPlan) {
		return fmt.Errorf("v1 scanned %d songs, want %d; logs:\n%s",
			len(listing.Songs), len(seedPlan), lastLines(p.log.String(), 60))
	}
	return nil
}

// waitScanIdle polls /api/scans/status until no pending/running scan job.
func waitScanIdle(c *client, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		cap, err := c.do("GET", "/api/scans/status", nil, nil)
		if err != nil {
			return err
		}
		var st struct {
			Job *struct {
				Status string `json:"status"`
				Error  string `json:"error"`
			} `json:"job"`
		}
		if err := json.Unmarshal(cap.body, &st); err != nil {
			return err
		}
		if st.Job == nil {
			time.Sleep(300 * time.Millisecond)
			continue
		}
		switch st.Job.Status {
		case "completed":
			return nil
		case "failed":
			return fmt.Errorf("scan job failed: %s", st.Job.Error)
		}
		time.Sleep(300 * time.Millisecond)
	}
	return fmt.Errorf("scan did not finish within %s", timeout)
}

// snapshotDB copies a WAL-mode SQLite database while the writer is still
// running: the main file plus the -wal sidecar (committed frames not yet
// checkpointed live there; opening the copy replays them). -shm is rebuilt
// by the opener and must NOT be copied.
func snapshotDB(src, dst string) error {
	for _, suffix := range []string{"", "-wal"} {
		in := src + suffix
		if _, err := os.Stat(in); err != nil {
			continue
		}
		data, err := os.ReadFile(in)
		if err != nil {
			return err
		}
		if err := os.WriteFile(dst+suffix, data, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// HTTP client.
// ---------------------------------------------------------------------------

type client struct {
	base   string
	world  *world
	pass   string
	cookie string
	v2     // server flavor: drives the v2-native request contracts where they deliberately differ from v1
	http   *http.Client
}

func newClient(port int, w *world, password string, isV2 bool) *client {
	return &client{
		base:  fmt.Sprintf("http://127.0.0.1:%d", port),
		world: w,
		pass:  password,
		v2:    v2(isV2),
		http:  &http.Client{Timeout: 60 * time.Second},
	}
}

type v2 bool

type capture struct {
	status int
	header http.Header
	body   []byte
	json   any // decoded when content-type is JSON
	err    error
}

func (c *client) do(method, path string, body any, headers map[string]string) (*capture, error) {
	return c.doRaw(method, path, body, headers)
}

func (c *client) doRaw(method, path string, body any, headers map[string]string) (*capture, error) {
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
	// Adopt any session cookie the server set.
	if sc := resp.Header.Get("Set-Cookie"); sc != "" {
		c.cookie = strings.Split(sc, ";")[0]
	}
	return cap, nil
}

// restGET hits /rest with u/t/s token auth (quirks A3): md5(password+salt).
// q values are lists so endpoints with repeated params (songId=..&songId=..)
// can be exercised; headers are extra request headers (Range for streams).
func (c *client) restGET(endpoint string, q map[string][]string, headers map[string]string) (*capture, error) {
	salt := make([]byte, 8)
	_, _ = rand.Read(salt)
	sum := md5.Sum([]byte(c.pass + hex.EncodeToString(salt)))
	params := map[string][]string{
		"u": {adminUser},
		"t": {hex.EncodeToString(sum[:])},
		"s": {hex.EncodeToString(salt)},
		"v": {"1.16.1"},
		"c": {"parity"},
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
	return c.doRaw("GET", sb.String(), nil, headers)
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

// ---------------------------------------------------------------------------
// Step runner.
// ---------------------------------------------------------------------------

type step struct {
	group       string
	name        string
	writes      bool // true: runs in the write phase (after the DB snapshot)
	call        func(c *client, w *world) (*capture, error)
	canonical   func(v any) any // applied to BOTH sides (ordering etc.)
	norms       []normRule      // accepted deltas applied to BOTH sides (recorded when they change either side)
	notes       []Rule          // documented per-case contract decisions (recorded unconditionally)
	compare     func(v1, v2 *capture, w1, w2 *world) ([]string, []Rule)
	compareMode string // "json" (default), "bytes", "custom"
}

type recorded struct {
	step *step
	cap  *capture
}

var allSteps []step

// runSteps executes one phase of the script against one server, publishing
// world facts as steps run.
func runSteps(c *client, w *world, writePhase bool) ([]recorded, error) {
	var out []recorded
	for i := range allSteps {
		st := &allSteps[i]
		if st.writes != writePhase {
			continue
		}
		cap, err := st.call(c, w)
		if err != nil {
			return nil, fmt.Errorf("step %s: %w", st.name, err)
		}
		out = append(out, recorded{step: st, cap: cap})
	}
	return out, nil
}

// compareRuns diffs the two recordings pairwise.
func compareRuns(v1, v2 []recorded, w1, w2 *world) []caseResult {
	var out []caseResult
	for i := range v1 {
		st := v1[i].step
		res := caseResult{Group: st.group, Name: st.name}
		a, b := v1[i].cap, v2[i].cap
		res.RawV1, res.RawV2 = a.json, b.json
		if a.err != nil || b.err != nil {
			res.Failures = append(res.Failures, fmt.Sprintf("capture error: v1=%v v2=%v", a.err, b.err))
			out = append(out, res)
			continue
		}
		if a.status != b.status {
			res.Failures = append(res.Failures, fmt.Sprintf("HTTP status: v1=%d v2=%d", a.status, b.status))
		}
		switch st.compareMode {
		case "bytes":
			if !bytes.Equal(a.body, b.body) {
				res.Failures = append(res.Failures, fmt.Sprintf("body bytes differ: v1 %d bytes (%x…) v2 %d bytes (%x…)",
					len(a.body), shortHash(a.body), len(b.body), shortHash(b.body)))
			}
		case "custom":
			if b.json != nil {
				b.json = remapWorld(b.json, w1, w2)
			}
			failures, accepted := st.compare(a, b, w1, w2)
			res.Failures = append(res.Failures, failures...)
			for _, r := range accepted {
				res.Accepted = append(res.Accepted, r.ID+": "+r.Why)
			}
		default:
			if a.json == nil || b.json == nil {
				if !bytes.Equal(a.body, b.body) {
					res.Failures = append(res.Failures, "non-JSON bodies differ")
				}
				out = append(out, res)
				continue
			}
			va, vb := a.json, b.json
			if st.canonical != nil {
				va, vb = st.canonical(va), st.canonical(vb)
			}
			vb = remapWorld(vb, w1, w2)
			for _, n := range st.norms {
				// Norms canonicalize BOTH sides to the comparable form; the
				// rule is recorded when it actually changed either side
				// (i.e. the covered delta was present in this case).
				appliedA, appliedB := n.apply(va), n.apply(vb)
				if len(diff(va, appliedA, 1))+len(diff(vb, appliedB, 1)) > 0 {
					res.Accepted = append(res.Accepted, n.Rule.ID+": "+n.Rule.Why)
				}
				va, vb = appliedA, appliedB
			}
			for _, note := range st.notes {
				res.Accepted = append(res.Accepted, note.ID+": "+note.Why)
			}
			res.Failures = append(res.Failures, diff(va, vb, 25)...)
		}
		out = append(out, res)
	}
	return out
}

// remapWorld replaces v2-run published values (ids, tokens) with the v1-run
// counterparts (created entity ids are server-generated), so both payloads
// compare in the v1-run id space.
func remapWorld(v2v any, w1, w2 *world) any {
	out := clone(v2v)
	for key := range w1.remap {
		v1s, ok1 := w1.values[key].(string)
		v2s, ok2 := w2.values[key].(string)
		if !ok1 || !ok2 || v1s == "" || v2s == "" || v1s == v2s {
			continue
		}
		replaceString(out, v2s, v1s)
	}
	return out
}

func replaceString(node any, from, to string) {
	switch t := node.(type) {
	case map[string]any:
		for k, v := range t {
			if s, ok := v.(string); ok && s == from {
				t[k] = to
			} else {
				replaceString(v, from, to)
			}
		}
	case []any:
		for _, v := range t {
			replaceString(v, from, to)
		}
	}
}

func shortHash(b []byte) []byte {
	h := md5.Sum(b)
	return h[:4]
}

// ---------------------------------------------------------------------------
// Seeding.
// ---------------------------------------------------------------------------

type seedSong struct {
	key         string // world/catalog key, e.g. "A1"
	file        string // corpus source file
	relpath     string // library-relative target path
	title       string
	artist      []string
	album       string
	albumArtist []string
	track       int
	trackTotal  int
	disc        int
	discTotal   int
	genre       []string
	year        int
	explicit    bool
	lyrics      string
	art         bool // embed a JPEG picture
}

var seedPlan = []seedSong{
	{key: "A1", file: "spike.mp3", relpath: "Aurora Waves/Neon Horizons (2021)/01 - Signal Drift.mp3",
		title: "Signal Drift", artist: []string{"Aurora Waves"}, album: "Neon Horizons", albumArtist: []string{"Aurora Waves"},
		track: 1, disc: 1, genre: []string{"Electronic"}, year: 2021, lyrics: "Drifting through the static\nSignals in the night"},
	{key: "A2", file: "spike.mp3", relpath: "Aurora Waves/Neon Horizons (2021)/02 - Chrome Sunset.mp3",
		title: "Chrome Sunset", artist: []string{"Aurora Waves"}, album: "Neon Horizons", albumArtist: []string{"Aurora Waves"},
		track: 2, disc: 1, genre: []string{"Electronic"}, year: 2021, explicit: true, art: true},
	{key: "A3", file: "spike.flac", relpath: "Aurora Waves/Neon Horizons (2021)/03 - Violet Machines.flac",
		title: "Violet Machines", artist: []string{"Aurora Waves", "Midnight Coil"}, album: "Neon Horizons", albumArtist: []string{"Aurora Waves"},
		track: 3, disc: 1, genre: []string{"Electronic", "Downtempo"}, year: 2021},
	{key: "A4", file: "spike.ogg", relpath: "Aurora Waves/Neon Horizons (2021)/04 - Afterglow.ogg",
		title: "Afterglow", artist: []string{"Aurora Waves"}, album: "Neon Horizons", albumArtist: []string{"Aurora Waves"},
		track: 4, disc: 1, genre: []string{"Electronic"}, year: 2021},
	{key: "A5", file: "spike.m4a", relpath: "Aurora Waves/Neon Horizons (2021)/05 - Static Bloom.m4a",
		title: "Static Bloom", artist: []string{"Aurora Waves"}, album: "Neon Horizons", albumArtist: []string{"Aurora Waves"},
		track: 5, trackTotal: 5, disc: 1, genre: []string{"Electronic"}, year: 2021},
	{key: "B1", file: "spike.mp3", relpath: "The Hollow Pines/Dust and Ember (1998)/01 - Rust Belt Hymn.mp3",
		title: "Rust Belt Hymn", artist: []string{"The Hollow Pines"}, album: "Dust and Ember", albumArtist: []string{"The Hollow Pines"},
		track: 1, disc: 1, genre: []string{"Rock"}, year: 1998},
	{key: "B2", file: "spike.ogg", relpath: "The Hollow Pines/Dust and Ember (1998)/02 - Cinder Road.ogg",
		title: "Cinder Road", artist: []string{"The Hollow Pines"}, album: "Dust and Ember", albumArtist: []string{"The Hollow Pines"},
		track: 2, disc: 1, genre: []string{"Rock"}, year: 1998},
	{key: "B3", file: "spike.m4a", relpath: "The Hollow Pines/Dust and Ember (1998)/01 - Hollow Sky.m4a",
		title: "Hollow Sky", artist: []string{"The Hollow Pines"}, album: "Dust and Ember", albumArtist: []string{"The Hollow Pines"},
		track: 1, trackTotal: 2, disc: 2, discTotal: 2, genre: []string{"Rock"}, year: 1998},
	{key: "B4", file: "spike.flac", relpath: "The Hollow Pines/Dust and Ember (1998)/03 - Ember Line.flac",
		title: "Ember Line", artist: []string{"The Hollow Pines"}, album: "Dust and Ember", albumArtist: []string{"The Hollow Pines"},
		track: 3, disc: 1, genre: []string{"Rock", "Acoustic"}, year: 1998},
	{key: "C1", file: "spike.flac", relpath: "Midnight Coil/Midnight Coil Sessions (2015)/01 - Blue Circuit.flac",
		title: "Blue Circuit", artist: []string{"Midnight Coil"}, album: "Midnight Coil Sessions", albumArtist: []string{"Midnight Coil"},
		track: 1, disc: 1, genre: []string{"Jazz"}, year: 2015},
	{key: "C2", file: "spike.mp3", relpath: "Midnight Coil/Midnight Coil Sessions (2015)/02 - Secondhand Moon.mp3",
		title: "Secondhand Moon", artist: []string{"Sable Rue"}, album: "Midnight Coil Sessions", albumArtist: []string{"Midnight Coil"},
		track: 2, disc: 1, genre: []string{"Jazz"}, year: 2015},
	{key: "C3", file: "spike.ogg", relpath: "Midnight Coil/Midnight Coil Sessions (2015)/03 - Coil & Smoke.ogg",
		title: "Coil & Smoke", artist: []string{"Midnight Coil"}, album: "Midnight Coil Sessions", albumArtist: []string{"Midnight Coil"},
		track: 3, disc: 1, genre: []string{"Jazz", "Blues"}, year: 2015},
}

func seedLibrary(root string) error {
	artJPEG, cleanup, err := makeTestJPEG(filepath.Join(root, ".seed-art"))
	if err != nil {
		return err
	}
	defer cleanup()

	writer := audio.NewMutagenWriter()
	ctx := context.Background()
	wd, _ := os.Getwd()
	corpus := filepath.Join(filepath.Dir(wd), corpusDir)
	// Staggered whole-second mtimes: integer milliseconds (v1 stores
	// mtimeMs; fractions would serialize differently on the two stacks) and
	// a deterministic newest-first album order. Written LAST per file, after
	// every tag rewrite (mutagen re-saves bump mtime).
	base := time.Now().Truncate(time.Second)

	for i, s := range seedPlan {
		src := filepath.Join(corpus, s.file)
		dst := filepath.Join(root, s.relpath)
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		data, err := os.ReadFile(src)
		if err != nil {
			return err
		}
		if err := os.WriteFile(dst, data, 0o644); err != nil {
			return err
		}
		tags := audio.SongTags{
			Title:       ptr(s.title),
			Artist:      s.artist,
			Album:       ptr(s.album),
			AlbumArtist: s.albumArtist,
			Genre:       s.genre,
			Year:        ptr(s.year),
		}
		if s.track > 0 {
			t := s.track
			tags.TrackNumber = &t
		}
		if s.disc > 0 {
			d := s.disc
			tags.DiscNumber = &d
		}
		if s.explicit {
			e := true
			tags.Explicit = &e
		}
		if s.lyrics != "" {
			tags.Lyrics = ptr(s.lyrics)
		}
		if err := writer.Write(ctx, dst, tags); err != nil {
			return fmt.Errorf("tag %s: %w", dst, err)
		}
		if s.art {
			if err := embedPicture(dst, artJPEG); err != nil {
				return fmt.Errorf("embed art %s: %w", dst, err)
			}
		}
		mtime := base.Add(time.Duration(i) * time.Second)
		if err := os.Chtimes(dst, mtime, mtime); err != nil {
			return err
		}
	}
	return nil
}

func ptr[T any](v T) *T { return &v }

// makeTestJPEG renders a tiny deterministic JPEG via ffmpeg and returns its
// path plus a cleanup function.
func makeTestJPEG(dir string) (string, func(), error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", nil, err
	}
	path := filepath.Join(dir, "cover.jpg")
	cmd := exec.Command("ffmpeg", "-y", "-f", "lavfi", "-i",
		"color=c=0x2244AA:size=64x64", "-frames:v", "1", path)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", nil, fmt.Errorf("ffmpeg test jpeg: %v: %s", err, out)
	}
	return path, func() { os.RemoveAll(dir) }, nil
}

// embedPicture replaces any embedded pictures with a single JPEG via
// mutagen (the same mechanism as internal/audio's MutagenWriter; the
// TagWriter interface has no art field, so the harness drives python3
// directly). Stripping existing frames first keeps the file single-picture
// deterministic: v1 (music-metadata picture[0]) and v2 (tagfork first APIC)
// otherwise serve different frames of a multi-picture file.
func embedPicture(path, image string) error {
	script := `
import sys
from mutagen.id3 import ID3, APIC
id3 = ID3(sys.argv[1])
for key in [k for k in id3.keys() if k.startswith('APIC')]:
    del id3[key]
with open(sys.argv[2], 'rb') as fh:
    data = fh.read()
id3['APIC:'] = APIC(encoding=3, mime='image/jpeg', type=3, desc='', data=data)
id3.save()
`
	cmd := exec.Command("python3", "-c", script, path, image)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("mutagen picture: %v: %s", err, out)
	}
	return nil
}

// dumpHTTP is a debugging helper kept for diagnosing harness failures.
func dumpHTTP(cap *capture) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("status=%d\n", cap.status))
	for k := range cap.header {
		sb.WriteString(fmt.Sprintf("%s: %s\n", k, cap.header.Get(k)))
	}
	if cap.json != nil {
		b, _ := json.MarshalIndent(cap.json, "", "  ")
		sb.Write(b)
	} else {
		sb.Write(cap.body)
	}
	return sb.String()
}
