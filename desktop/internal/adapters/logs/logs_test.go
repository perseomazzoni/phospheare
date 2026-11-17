// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package logs

import (
	"bytes"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strings"
	"testing"
	"time"
)

// ── Format ──────────────────────────────────────────────────────────────────

var at = time.Date(2026, 11, 15, 15, 21, 40, 8_000_000, time.FixedZone("CET", 3600))

func rec(level slog.Level, msg string, attrs ...slog.Attr) slog.Record {
	r := slog.NewRecord(at, level, msg, 0)
	r.AddAttrs(attrs...)
	return r
}

func handle(t *testing.T, h slog.Handler, r slog.Record) {
	t.Helper()
	if err := h.Handle(t.Context(), r); err != nil {
		t.Fatal(err)
	}
}

func TestALineHasItsColumnsThenItsFields(t *testing.T) {
	var out bytes.Buffer
	h := NewHandler(NewSink(nil, &out), Desktop, slog.LevelDebug).WithAttrs([]slog.Attr{slog.String(AreaKey, "cert")})
	handle(t, h, rec(slog.LevelInfo, "Asking Let's Encrypt for an order.", slog.Int("tries", 2), slog.String("why", "a reason")))
	want := "2026-11-15T15:21:40.008+01:00  INFO   desktop   -                       cert      Asking Let's Encrypt for an order.  tries=2 why=\"a reason\"\n"
	if out.String() != want {
		t.Fatalf("line\n%q\nwant\n%q", out.String(), want)
	}
}

func TestTheAccountColumnShowsTheWriter(t *testing.T) {
	var out bytes.Buffer
	h := NewHandler(NewSink(nil, &out), Identity, nil)
	handle(t, h, rec(slog.LevelWarn, "The session has expired.", slog.String(AccountKey, "Q2x5bmF0dGhlRXhhbXBs"), slog.String(AreaKey, "session")))
	if !strings.Contains(out.String(), "  WARN   identity  Q2x5bmF0dGhlRXhhbXBs    session   The session has expired.\n") {
		t.Fatalf("line %q", out.String())
	}
}

func TestALevelBelowTheThresholdIsNotWritten(t *testing.T) {
	var out bytes.Buffer
	level := new(slog.LevelVar)
	logger := slog.New(NewHandler(NewSink(nil, &out), Desktop, level))
	logger.Debug("hidden")
	logger.Info("shown")
	level.Set(slog.LevelDebug)
	logger.Debug("shown too")
	got := out.String()
	if strings.Contains(got, "hidden") || !strings.Contains(got, "shown\n") || !strings.Contains(got, "DEBUG  ") {
		t.Fatalf("log %q", got)
	}
}

func TestOneEventStaysOnOneLine(t *testing.T) {
	var out bytes.Buffer
	h := NewHandler(NewSink(nil, &out), Desktop, nil)
	handle(t, h, rec(slog.LevelError, "first\nsecond", slog.Any("error", errors.New("a\nb")), slog.String("empty", "")))
	got := out.String()
	if strings.Count(got, "\n") != 1 || !strings.Contains(got, `first\nsecond`) || !strings.Contains(got, `error=a\nb `) || !strings.Contains(got, `empty=""`) {
		t.Fatalf("line %q", got)
	}
}

// A control character could move a terminal's cursor or colour a line.
func TestControlCharactersAreEscaped(t *testing.T) {
	var out bytes.Buffer
	h := NewHandler(NewSink(nil, &out), Desktop, nil)
	handle(t, h, rec(slog.LevelWarn, "red \x1b[31mtext", slog.String("raw", "a\x1bb"), slog.String("spaced", "a \x07b")))
	got := out.String()
	if strings.ContainsAny(got, "\x1b\x07") || !strings.Contains(got, `red \x1b[31mtext`) || !strings.Contains(got, `raw=a\x1bb`) || !strings.Contains(got, `spaced="a \ab"`) {
		t.Fatalf("line %q", got)
	}
}

// A field that holds a space is quoted, which doubles the backslashes of a
// Windows path; the home folder still goes, even with a user name too
// short to remove on its own.
func TestAQuotedWindowsPathIsRedacted(t *testing.T) {
	var out bytes.Buffer
	r := &Redactor{Known: func() []Known {
		return []Known{{Value: `C:\Users\Al`, As: AsHome}, {Value: "Al", As: AsUser, Word: true}}
	}}
	h := NewHandler(NewSink(r, &out), Desktop, nil)
	handle(t, h, rec(slog.LevelError, "could not open", slog.String("error", `open C:\Users\Al\data x: denied`)))
	if got := out.String(); strings.Contains(got, `Al\`) || !strings.Contains(got, `error="open [home]\\data x: denied"`) {
		t.Fatalf("line %q", got)
	}
}

func TestAGroupNamesItsFields(t *testing.T) {
	var out bytes.Buffer
	h := NewHandler(NewSink(nil, &out), Desktop, nil).WithGroup("req")
	handle(t, h, rec(slog.LevelInfo, "m", slog.String("method", "GET"), slog.Group("at", slog.Int("port", 443))))
	if !strings.Contains(out.String(), "req.method=GET req.at.port=443") {
		t.Fatalf("line %q", out.String())
	}
}

func TestTheStandardLoggerBecomesRecords(t *testing.T) {
	var out bytes.Buffer
	logger := slog.New(NewHandler(NewSink(nil, &out), Desktop, nil)).With(AreaKey, "homenet")
	w := Standard(logger, slog.LevelWarn)
	if _, err := w.Write([]byte("http: TLS handshake error\n")); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "WARN   desktop   -                       homenet   http: TLS handshake error\n") {
		t.Fatalf("line %q", out.String())
	}
}

func TestLevelsParseByName(t *testing.T) {
	for name, want := range map[string]slog.Level{"debug": slog.LevelDebug, "INFO": slog.LevelInfo, "warn": slog.LevelWarn, "error": slog.LevelError} {
		got, err := ParseLevel(name)
		if err != nil || got != want || !strings.EqualFold(LevelName(got), name) {
			t.Errorf("%s: %v %v %s", name, got, err, LevelName(got))
		}
	}
	if _, err := ParseLevel("loud"); err == nil {
		t.Fatal("an unknown level parsed")
	}
}

// ── Redaction ───────────────────────────────────────────────────────────────

func TestTheRedactorRemovesPersonalData(t *testing.T) {
	r := &Redactor{Known: func() []Known {
		return []Known{
			{Value: `C:\Users\Perseo`, As: AsHome},
			{Value: "Perseo", As: AsUser, Word: true},
			{Value: "DESKTOP-7Q", As: AsComputer, Word: true},
			{Value: "example.org", As: AsName},
		}
	}}
	for line, want := range map[string]string{
		`data in C:\Users\Perseo\AppData`:                 `data in [home]\AppData`,
		`data in c:\users\perseo\AppData`:                 `data in [home]\AppData`,
		"signed in as perseo on DESKTOP-7Q":               "signed in as [user] on [computer]",
		"Perseomania stays":                               "Perseomania stays",
		"serving https://oncedarkstudio.dedyn.io:443":     "serving https://[name]:443",
		"name example.org":                                "name [name]",
		"mail ada.lovelace+x@mail.example.com now":        "mail [email] now",
		"from 192.168.1.23:5432 and 8.8.8.8":              "from [address]:5432 and [address]",
		"from [fe80::a16:5ff:fe42:ade0%eth0]:53":          "from [[address]]:53",
		"from 2001:db8::1 to ::ffff:10.0.0.1":             "from [address] to ::ffff:[address]",
		"listen=127.0.0.1:61625 and [::1]:80 and 0.0.0.0": "listen=127.0.0.1:61625 and [::1]:80 and 0.0.0.0",
		"at 2026-11-15T15:21:40.008+01:00 took 1.5ms":     "at 2026-11-15T15:21:40.008+01:00 took 1.5ms",
	} {
		if got := r.Line(line); got != want {
			t.Errorf("%q\n got %q\nwant %q", line, got, want)
		}
	}
}

func TestAWholeWordMayStartOrEndWithAnAccentedLetter(t *testing.T) {
	r := &Redactor{Known: func() []Known {
		return []Known{
			{Value: "José", As: AsUser, Word: true},
			{Value: "Élise", As: AsComputer, Word: true},
		}
	}}
	for line, want := range map[string]string{
		"signed in as José on Élise": "signed in as [user] on [computer]",
		"josé,josé (JOSÉ)":           "[user],[user] ([user])",
		"Joséphine and Élisette":     "Joséphine and Élisette",
		"x_José and José2 stay":      "x_José and José2 stay",
	} {
		if got := r.Line(line); got != want {
			t.Errorf("%q\n got %q\nwant %q", line, got, want)
		}
	}
}

func TestASecretInAQueryIsRemoved(t *testing.T) {
	r := &Redactor{}
	for line, want := range map[string]string{
		"GET /callback?code=abc123&state=xyz":    "GET /callback?code=[secret]&state=[secret]",
		"open https://localhost/setup/#k=f00d42": "open https://localhost/setup/#k=[secret]",
		"GET /search?q=storm&page=2":             "GET /search?q=storm&page=2",
	} {
		if got := r.Line(line); got != want {
			t.Errorf("%q\n got %q\nwant %q", line, got, want)
		}
	}
}

func TestAProductsVersionIsNoAddress(t *testing.T) {
	line := "Chrome/131.0.0.0 Safari/537.36 from 192.168.1.20 at http://10.0.0.7/"
	want := "Chrome/131.0.0.0 Safari/537.36 from [address] at http://[address]/"
	if got := (&Redactor{}).Line(line); got != want {
		t.Errorf("\n got %q\nwant %q", got, want)
	}
}

func TestAShortWordIsNotRemoved(t *testing.T) {
	r := &Redactor{Known: func() []Known { return []Known{{Value: "al", As: AsUser, Word: true}} }}
	if got := r.Line("all is well, al"); got != "all is well, al" {
		t.Fatalf("got %q", got)
	}
}

func TestTheRedactorFollowsTheKnownValues(t *testing.T) {
	name := "first.example"
	r := &Redactor{Known: func() []Known { return []Known{{Value: name, As: AsName}} }}
	if got := r.Line("first.example"); got != AsName {
		t.Fatalf("got %q", got)
	}
	name = "second.example"
	if got := r.Line("first.example second.example"); got != "first.example "+AsName {
		t.Fatalf("got %q", got)
	}
}

func TestTheSinkWritesRedactedLines(t *testing.T) {
	var file, terminal bytes.Buffer
	h := NewHandler(NewSink(&Redactor{}, &file, nil, &terminal), Desktop, nil)
	handle(t, h, rec(slog.LevelInfo, "from 192.168.1.7"))
	if !strings.Contains(file.String(), "from [address]") || file.String() != terminal.String() {
		t.Fatalf("file %q, terminal %q", file.String(), terminal.String())
	}
}

// ── Files ───────────────────────────────────────────────────────────────────

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func header(started time.Time) string {
	return Header("Product", "1.0", "test/os", Desktop, started)
}

func openAt(t *testing.T, dir string, c *clock, max int64) *File {
	t.Helper()
	f, err := open(dir, "desktop", header, c.now, max, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Close() })
	return f
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(b)
}

func TestANewFileStartsWithItsHeader(t *testing.T) {
	dir := t.TempDir()
	c := &clock{at}
	f := openAt(t, dir, c, MaxSize)
	f.Write([]byte("line\n"))
	got := read(t, filepath.Join(dir, "desktop.log"))
	if got != "━━ Product 1.0 · test/os · desktop · log started 2026-11-15T15:21:40+01:00 ━━\nline\n" {
		t.Fatalf("file %q", got)
	}
	if st, _ := os.Stat(filepath.Join(dir, "desktop.log")); st.Mode().Perm()&0o077 != 0 && os.PathSeparator == '/' {
		t.Fatalf("mode %v", st.Mode())
	}
}

func TestAFreshFileIsAppendedTo(t *testing.T) {
	dir := t.TempDir()
	c := &clock{at}
	f := openAt(t, dir, c, MaxSize)
	f.Write([]byte("first\n"))
	f.Close()
	c.t = at.Add(Span - time.Hour)
	g := openAt(t, dir, c, MaxSize)
	g.Write([]byte("second\n"))
	got := read(t, filepath.Join(dir, "desktop.log"))
	if !strings.HasSuffix(got, "first\nsecond\n") || strings.Count(got, "━━ Product") != 1 {
		t.Fatalf("file %q", got)
	}
}

func TestAFullFileMovesAside(t *testing.T) {
	dir := t.TempDir()
	c := &clock{at}
	size := int64(len(header(at))) + 12
	f := openAt(t, dir, c, size)
	for _, line := range []string{"first\n", "second\n", "third\n"} {
		f.Write([]byte(line))
	}
	current, older := read(t, filepath.Join(dir, "desktop.log")), read(t, filepath.Join(dir, "desktop.log.1"))
	if !strings.HasSuffix(current, "━━\nthird\n") || !strings.HasSuffix(older, "━━\nsecond\n") {
		t.Fatalf("current %q, older %q", current, older)
	}
}

// No line outlives two spans: a file moves aside at one span old, and the
// older copy goes one span after its last line.
func TestNoLineIsKeptLongerThanTwoSpans(t *testing.T) {
	dir := t.TempDir()
	c := &clock{at}
	f := openAt(t, dir, c, MaxSize)
	f.Write([]byte("oldest\n"))
	c.t = at.Add(Span)
	f.Write([]byte("next span\n"))
	older := filepath.Join(dir, "desktop.log.1")
	if !strings.Contains(read(t, older), "oldest") || strings.Contains(read(t, filepath.Join(dir, "desktop.log")), "oldest") {
		t.Fatal("a file one span old did not move aside")
	}
	f.Close()
	if err := os.Chtimes(older, at, at); err != nil {
		t.Fatal(err)
	}
	c.t = at.Add(2 * Span)
	openAt(t, dir, c, MaxSize)
	if strings.Contains(read(t, older), "oldest") || strings.Contains(read(t, filepath.Join(dir, "desktop.log")), "oldest") {
		t.Fatal("a line outlived two spans")
	}
	if !strings.Contains(read(t, older), "next span") {
		t.Fatal("the line of the second span is gone too early")
	}
}

func TestTheAgeCheckRunsWithoutWrites(t *testing.T) {
	dir := t.TempDir()
	c := &clock{at}
	f, err := open(dir, "desktop", header, func() time.Time { return c.t }, MaxSize, time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	f.Write([]byte("quiet\n"))
	f.mu.Lock()
	c.t = at.Add(Span)
	f.mu.Unlock()
	deadline := time.Now().Add(5 * time.Second)
	for read(t, filepath.Join(dir, "desktop.log.1")) == "" {
		if time.Now().After(deadline) {
			t.Fatal("a quiet file did not move aside")
		}
		time.Sleep(time.Millisecond)
	}
	f.Close()
}

func TestAFileWithoutAHeaderMovesAside(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "desktop.log")
	if err := os.WriteFile(path, []byte("2026/11/14 18:25:19 an older format\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	openAt(t, dir, &clock{at}, MaxSize)
	if !strings.Contains(read(t, path+".1"), "older format") || strings.Contains(read(t, path), "older format") {
		t.Fatal("a file that cannot say its age stayed")
	}
}

// A file that could not be made again, as when another program holds it
// on Windows, is tried again a minute later rather than never.
func TestAFileThatCouldNotBeMadeIsTriedAgain(t *testing.T) {
	c := &clock{t: at}
	f := openAt(t, t.TempDir(), c, MaxSize)
	f.mu.Lock()
	_ = f.f.Close()
	f.f, f.retry = nil, c.t.Add(retryEvery)
	f.mu.Unlock()
	if _, err := f.Write([]byte("too soon\n")); !errors.Is(err, ErrClosed) {
		t.Fatalf("err %v", err)
	}
	c.t = c.t.Add(retryEvery)
	if _, err := f.Write([]byte("again\n")); err != nil {
		t.Fatal(err)
	}
	if got, want := read(t, f.Path()), header(c.t)+"again\n"; got != want {
		t.Fatalf("file %q, want %q", got, want)
	}
}

func TestAClosedFileRefusesWrites(t *testing.T) {
	f := openAt(t, t.TempDir(), &clock{at}, MaxSize)
	f.Close()
	if _, err := f.Write([]byte("late\n")); !errors.Is(err, ErrClosed) {
		t.Fatalf("err %v", err)
	}
}

func TestAClearedFileStartsAgainWithoutItsOlderCopy(t *testing.T) {
	dir := t.TempDir()
	c := &clock{t: at}
	f := openAt(t, dir, c, MaxSize)
	if err := os.WriteFile(f.Path()+".1", []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("a line\n")); err != nil {
		t.Fatal(err)
	}
	c.t = at.Add(time.Hour)
	if err := f.Clear(); err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("after\n")); err != nil {
		t.Fatal(err)
	}
	if got, want := read(t, f.Path()), header(c.t)+"after\n"; got != want {
		t.Fatalf("file %q, want %q", got, want)
	}
	if _, err := os.Stat(f.Path() + ".1"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("older copy: %v", err)
	}
}

// ── Crashes ─────────────────────────────────────────────────────────────────

// The test runs itself again as a child that crashes, then reads what the
// child left, as the next start does.
func TestACrashIsKeptForTheNextRun(t *testing.T) {
	if path := os.Getenv("LOGS_CRASH_FILE"); path != "" {
		if _, err := KeepCrashes(path); err != nil {
			os.Exit(3)
		}
		panic("crash for the test")
	}
	path := filepath.Join(t.TempDir(), CrashFile)
	child := exec.Command(os.Args[0], "-test.run=^TestACrashIsKeptForTheNextRun$")
	child.Env = append(os.Environ(), "LOGS_CRASH_FILE="+path)
	if out, err := child.CombinedOutput(); err == nil {
		t.Fatalf("the child did not crash: %s", out)
	}
	// The runtime holds the file open; Windows removes no open file.
	defer debug.SetCrashOutput(nil, debug.CrashOptions{})
	lines, err := KeepCrashes(path)
	if err != nil {
		t.Fatal(err)
	}
	text := strings.Join(lines, "\n")
	if !strings.Contains(text, "panic: crash for the test") || !strings.Contains(text, "TestACrashIsKeptForTheNextRun") {
		t.Fatalf("crash %q", text)
	}
	if got := read(t, path); got != "" {
		t.Fatalf("the file still holds %q", got)
	}
	// A run that did not crash leaves nothing to report.
	if lines, err := KeepCrashes(path); err != nil || len(lines) != 0 {
		t.Fatalf("lines %q, err %v", lines, err)
	}
}

// net/http writes a handler's panic and its stack in one call.
func TestARequestsPanicIsAnErrorWithItsStack(t *testing.T) {
	var out bytes.Buffer
	logger := ServerLog(slog.New(NewHandler(NewSink(nil, &out), Desktop, nil)))
	logger.Print("http: TLS handshake error from 127.0.0.1:5000: EOF")
	logger.Print("http: panic serving 127.0.0.1:5001: boom\ngoroutine 7 [running]:\nmain.handler()\n\t/src/main.go:12 +0x1d")
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 5 || !strings.Contains(lines[0], " WARN ") {
		t.Fatalf("lines %q", lines)
	}
	for _, l := range lines[1:] {
		if !strings.Contains(l, " ERROR ") {
			t.Fatalf("line %q", l)
		}
	}
	if !strings.Contains(lines[4], "/src/main.go:12 +0x1d") {
		t.Fatalf("stack line %q", lines[4])
	}
}

// ── Detail ──────────────────────────────────────────────────────────────────

func TestTheDetailLowersTheLevelUntilItsEnd(t *testing.T) {
	c := &clock{t: at}
	var out bytes.Buffer
	d := &Detail{Level: new(slog.LevelVar), Base: slog.LevelInfo, now: c.now,
		Log: slog.New(NewHandler(NewSink(nil, &out), Desktop, nil))}
	d.Set(at.Add(time.Hour))
	if d.Level.Level() != slog.LevelDebug || !d.Until().Equal(at.Add(time.Hour)) {
		t.Fatalf("level %s, until %s", d.Level.Level(), d.Until())
	}
	// A settings file changed by hand cannot keep it on longer.
	d.Set(at.Add(30 * 24 * time.Hour))
	if !d.Until().Equal(at.Add(DetailFor)) {
		t.Fatalf("until %s", d.Until())
	}
	d.Set(time.Time{})
	if d.Level.Level() != slog.LevelInfo || !d.Until().IsZero() {
		t.Fatalf("off: level %s, until %s", d.Level.Level(), d.Until())
	}
	// An end already passed, as after a long stop, leaves it off.
	d.Set(at.Add(-time.Minute))
	if d.Level.Level() != slog.LevelInfo {
		t.Fatalf("passed: level %s", d.Level.Level())
	}
	if !strings.Contains(out.String(), "The detailed log is on.") || !strings.Contains(out.String(), "The detailed log is off.") {
		t.Fatalf("log %q", out.String())
	}
}

func TestTheDetailEndsByItself(t *testing.T) {
	at := time.Date(2026, 11, 17, 9, 0, 0, 0, time.UTC)
	// Each timer waits here until the test runs it.
	var timers []func()
	d := &Detail{
		Level: new(slog.LevelVar),
		Base:  slog.LevelWarn,
		now:   func() time.Time { return at },
		after: func(_ time.Duration, f func()) func() bool {
			timers = append(timers, f)
			return func() bool { return true }
		},
	}
	d.Set(at.Add(time.Hour))
	d.Set(at.Add(2 * time.Hour))
	if len(timers) != 2 {
		t.Fatalf("%d timers", len(timers))
	}
	// A later end replaced the first; its timer, had it fired anyway, finds
	// the other end and stays quiet.
	at = at.Add(time.Hour)
	timers[0]()
	if d.Level.Level() != slog.LevelDebug {
		t.Fatal("the first timer ended the second detailed time")
	}
	at = at.Add(time.Hour)
	timers[1]()
	if d.Level.Level() != slog.LevelWarn {
		t.Fatalf("level %v after its end", d.Level.Level())
	}
	if !d.Until().IsZero() {
		t.Fatalf("until %s", d.Until())
	}
}

// ── Relay ───────────────────────────────────────────────────────────────────

func TestTheRelayWritesAChildsJSONInTheFormat(t *testing.T) {
	var out bytes.Buffer
	logger := slog.New(NewHandler(NewSink(nil, &out), Identity, nil))
	r := NewRelay(logger)
	// Written in two pieces, as a pipe may deliver it.
	lines := `{"time":"2026-11-15T15:22:03.117+01:00","level":"WARN","msg":"request","area":"http","method":"POST","status":401,"took":"1ms","g":{"b":2,"a":1}}` + "\n" +
		"panic: something broke\n" +
		`{"time":"2026-11-15T15:22:04+01:00","level":"DEBUG","msg":"hidden"}` + "\n" +
		`{"time":"2026-11-15T15:22:05+01:00","level":"INFO","msg":"POST /identity/session","area":"http","status":200,"account":"Q2x5bmF0dGhlRXhhbXBs"}` + "\n"
	r.Write([]byte(lines[:40]))
	r.Write([]byte(lines[40:]))
	got := out.String()
	want := regexp.MustCompile(`(?m)^2026-11-15T15:22:03\.117\+01:00  WARN   identity  -\s+http\s+request  method=POST status=401 took=1ms g\.a=1 g\.b=2$`)
	// The service's account field fills the account column.
	account := regexp.MustCompile(`(?m)^2026-11-15T15:22:05\.000\+01:00  INFO   identity  Q2x5bmF0dGhlRXhhbXBs    http      POST /identity/session  status=200$`)
	if !want.MatchString(got) || !account.MatchString(got) || !strings.Contains(got, "ERROR  identity  -") || !strings.Contains(got, "panic: something broke\n") || strings.Contains(got, "hidden") {
		t.Fatalf("log\n%s", got)
	}
}
