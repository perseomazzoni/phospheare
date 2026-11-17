// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package logs writes the log files of the desktop program and of its
// identity service: one line for each event, in one format for every
// source, with personal data removed, and kept for 14 days at most. The
// files stay on the computer; nothing sends them anywhere.
//
// A line is:
//
//	2026-11-15T15:21:40.008+01:00  INFO   desktop   -                       cert      Asking for an order.  k=v
//
// the time, the level, the source, the writer account, the area, the
// message, and the fields.
package logs

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// The sources a line names.
const (
	Desktop  = "desktop"
	Identity = "identity"
)

// The attributes the format shows in columns, not as fields.
const (
	AreaKey    = "area"
	AccountKey = "account"
)

const timeLayout = "2006-01-02T15:04:05.000Z07:00"

// Column widths. An account id is 22 characters: 128 bits in base64url.
const (
	levelWidth   = 5
	sourceWidth  = 8
	accountWidth = 22
	areaWidth    = 8
)

// ParseLevel answers the level that name gives: debug, info, warn or error.
func ParseLevel(name string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "debug":
		return slog.LevelDebug, nil
	case "info", "":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	}
	return 0, fmt.Errorf("%q is not a log level: use debug, info, warn or error", name)
}

// LevelName answers the name ParseLevel reads for l.
func LevelName(l slog.Level) string {
	switch {
	case l < slog.LevelInfo:
		return "debug"
	case l < slog.LevelWarn:
		return "info"
	case l < slog.LevelError:
		return "warn"
	}
	return "error"
}

// Sink is where finished lines go: a file and, when one shows the
// program's words, a terminal. Every handler of one source shares it, so
// lines never interleave.
type Sink struct {
	mu     sync.Mutex
	out    []io.Writer
	redact *Redactor
}

// NewSink answers a sink that removes personal data with redact and
// writes each line to every writer of out that is not nil.
func NewSink(redact *Redactor, out ...io.Writer) *Sink {
	s := &Sink{redact: redact}
	for _, w := range out {
		if w != nil {
			s.out = append(s.out, w)
		}
	}
	return s
}

func (s *Sink) write(line string) {
	if s.redact != nil {
		line = s.redact.Line(line)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, w := range s.out {
		_, _ = io.WriteString(w, line)
	}
}

// Handler is a slog.Handler that writes the format of this package.
type Handler struct {
	sink   *Sink
	level  slog.Leveler
	source string
	// area and account come from With; a record's own attributes win.
	area, account string
	prefix        string
	fields        []field
}

type field struct{ key, value string }

// NewHandler answers a handler for source that writes to sink the records
// at level or above.
func NewHandler(sink *Sink, source string, level slog.Leveler) *Handler {
	if level == nil {
		level = slog.LevelInfo
	}
	return &Handler{sink: sink, level: level, source: source}
}

func (h *Handler) Enabled(_ context.Context, l slog.Level) bool {
	return l >= h.level.Level()
}

func (h *Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	c := *h
	c.fields = append([]field(nil), h.fields...)
	for _, a := range attrs {
		c.add(a)
	}
	return &c
}

func (h *Handler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	c := *h
	c.prefix = h.prefix + name + "."
	return &c
}

// add keeps a, as a column or as a field.
func (h *Handler) add(a slog.Attr) {
	a.Value = a.Value.Resolve()
	if a.Equal(slog.Attr{}) {
		return
	}
	if h.prefix == "" {
		switch a.Key {
		case AreaKey:
			h.area = a.Value.String()
			return
		case AccountKey:
			h.account = a.Value.String()
			return
		}
	}
	if a.Value.Kind() == slog.KindGroup {
		g := *h
		g.prefix = h.prefix + a.Key + "."
		if a.Key == "" {
			g.prefix = h.prefix
		}
		for _, sub := range a.Value.Group() {
			g.add(sub)
		}
		h.fields, h.area, h.account = g.fields, g.area, g.account
		return
	}
	h.fields = append(h.fields, field{h.prefix + a.Key, value(a.Value)})
}

func (h *Handler) Handle(_ context.Context, r slog.Record) error {
	c := *h
	c.fields = append([]field(nil), h.fields...)
	r.Attrs(func(a slog.Attr) bool {
		c.add(a)
		return true
	})
	at := r.Time
	if at.IsZero() {
		at = time.Now()
	}
	var b strings.Builder
	b.WriteString(at.Format(timeLayout))
	b.WriteString("  ")
	column(&b, levelName(r.Level), levelWidth)
	column(&b, c.source, sourceWidth)
	column(&b, or(c.account, "-"), accountWidth)
	column(&b, or(c.area, "-"), areaWidth)
	b.WriteString(escape(strings.TrimSpace(r.Message)))
	for i, f := range c.fields {
		if i == 0 {
			b.WriteString("  ")
		} else {
			b.WriteByte(' ')
		}
		b.WriteString(f.key)
		b.WriteByte('=')
		b.WriteString(f.value)
	}
	b.WriteByte('\n')
	c.sink.write(b.String())
	return nil
}

func levelName(l slog.Level) string {
	switch {
	case l < slog.LevelInfo:
		return "DEBUG"
	case l < slog.LevelWarn:
		return "INFO"
	case l < slog.LevelError:
		return "WARN"
	}
	return "ERROR"
}

// column writes s padded to width, then two spaces; a longer s keeps its
// length.
func column(b *strings.Builder, s string, width int) {
	b.WriteString(s)
	for n := utf8.RuneCountInString(s); n < width; n++ {
		b.WriteByte(' ')
	}
	b.WriteString("  ")
}

func or(s, otherwise string) string {
	if s == "" {
		return otherwise
	}
	return s
}

// value writes v as a field value: quoted when it holds a space, a quote
// or an equals sign, or is empty, so a line splits back into its fields.
func value(v slog.Value) string {
	var s string
	switch v.Kind() {
	case slog.KindString:
		s = v.String()
	case slog.KindDuration:
		s = v.Duration().String()
	case slog.KindTime:
		s = v.Time().Format(timeLayout)
	case slog.KindAny:
		if err, ok := v.Any().(error); ok {
			s = err.Error()
		} else {
			s = fmt.Sprint(v.Any())
		}
	default:
		s = v.String()
	}
	if s == "" || strings.ContainsAny(s, " \"=") {
		return strconv.Quote(s)
	}
	return escape(s)
}

// escape keeps one event on one line, and keeps out the control
// characters that could move a terminal's cursor or colour a line.
func escape(s string) string {
	if strings.IndexFunc(s, unicode.IsControl) < 0 {
		return s
	}
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\r':
			b.WriteString(`\r`)
		case r == '\t':
			b.WriteString(`\t`)
		case unicode.IsControl(r):
			fmt.Fprintf(&b, `\x%02x`, r)
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Standard answers a writer for code that logs through the standard
// library's log package: each line it receives becomes a record of logger
// at level.
func Standard(logger *slog.Logger, level slog.Level) io.Writer {
	return &standard{logger: logger, level: level}
}

type standard struct {
	logger *slog.Logger
	level  slog.Level
}

// panicPrefix starts what net/http writes when a request's handler
// panics: the panic, then the stack.
const panicPrefix = "http: panic serving"

// Write logs each line of p. A request's panic is one call; all its lines
// are ERROR, so the stack stays with the panic.
func (s *standard) Write(p []byte) (int, error) {
	text := strings.TrimRight(string(p), "\n")
	level := s.level
	if strings.HasPrefix(text, panicPrefix) {
		level = max(level, slog.LevelError)
	}
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) != "" {
			s.logger.Log(context.Background(), level, line)
		}
	}
	return len(p), nil
}

// ServerLog answers the ErrorLog of an http.Server: what the server
// complains of, such as a failed TLS handshake, is WARN, one line each; a
// handler's panic is ERROR, with its stack.
func ServerLog(logger *slog.Logger) *log.Logger {
	return log.New(Standard(logger, slog.LevelWarn), "", 0)
}

// ErrClosed is the error a write to a closed file answers.
var ErrClosed = errors.New("logs: the file is closed")
