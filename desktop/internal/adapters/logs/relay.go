// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package logs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"strings"
	"sync"
	"time"
)

// maxLine bounds a line the relay holds while it waits for the line's end.
const maxLine = 64 << 10

// Relay is the writer for a child process that logs JSON lines, one
// object for each record, as slog's JSON handler writes them. Each line
// becomes a record of the relay's logger, with the child's time, level,
// message and fields; a line that is not such an object, as a crash's
// trace, becomes an ERROR record that carries the line as its message.
type Relay struct {
	logger *slog.Logger

	mu  sync.Mutex
	buf []byte
}

// NewRelay answers a relay into logger.
func NewRelay(logger *slog.Logger) *Relay { return &Relay{logger: logger} }

func (r *Relay) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.buf = append(r.buf, p...)
	for {
		i := bytes.IndexByte(r.buf, '\n')
		if i < 0 {
			break
		}
		r.line(r.buf[:i])
		r.buf = r.buf[i+1:]
	}
	if len(r.buf) > maxLine {
		r.line(r.buf)
		r.buf = nil
	}
	return len(p), nil
}

func (r *Relay) line(raw []byte) {
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return
	}
	rec, ok := record(text)
	if !ok {
		rec = slog.NewRecord(time.Now(), slog.LevelError, text, 0)
	}
	h := r.logger.Handler()
	if h.Enabled(context.Background(), rec.Level) {
		_ = h.Handle(context.Background(), rec)
	}
}

// record reads one JSON object, keeping its fields in their order.
func record(text string) (slog.Record, bool) {
	dec := json.NewDecoder(strings.NewReader(text))
	dec.UseNumber()
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return slog.Record{}, false
	}
	at := time.Now()
	level := slog.LevelInfo
	message, haveMessage := "", false
	var attrs []slog.Attr
	for dec.More() {
		t, err := dec.Token()
		if err != nil {
			return slog.Record{}, false
		}
		key, ok := t.(string)
		if !ok {
			return slog.Record{}, false
		}
		var v any
		if err := dec.Decode(&v); err != nil {
			return slog.Record{}, false
		}
		switch key {
		case slog.TimeKey:
			if s, ok := v.(string); ok {
				if parsed, err := time.Parse(time.RFC3339Nano, s); err == nil {
					at = parsed
				}
			}
		case slog.LevelKey:
			if s, ok := v.(string); ok {
				var l slog.Level
				if l.UnmarshalText([]byte(s)) == nil {
					level = l
				}
			}
		case slog.MessageKey:
			message, haveMessage = fmt.Sprint(v), true
		default:
			attrs = append(attrs, attr(key, v))
		}
	}
	if !haveMessage {
		return slog.Record{}, false
	}
	rec := slog.NewRecord(at, level, message, 0)
	rec.AddAttrs(attrs...)
	return rec, true
}

// attr turns a decoded JSON value into an attribute; an object becomes a
// group, so its fields keep their names.
func attr(key string, v any) slog.Attr {
	switch v := v.(type) {
	case string:
		return slog.String(key, v)
	case json.Number:
		return slog.String(key, v.String())
	case bool:
		return slog.Bool(key, v)
	case nil:
		return slog.String(key, "null")
	case map[string]any:
		var group []any
		for _, k := range slices.Sorted(maps.Keys(v)) {
			group = append(group, attr(k, v[k]))
		}
		return slog.Group(key, group...)
	}
	b, _ := json.Marshal(v)
	return slog.String(key, string(b))
}
