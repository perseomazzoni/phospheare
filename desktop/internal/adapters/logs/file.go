// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package logs

import (
	"bufio"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

// Dir is the folder of the log files inside the data folder.
const Dir = "logs"

// MaxSize is the size past which a log moves aside; with the one older
// copy, a source keeps twice this at most.
const MaxSize = 5 << 20

// Span is how long a file collects lines before it moves aside, and how
// long the older copy stays after that: no line is kept longer than twice
// Span, 14 days.
const Span = 7 * 24 * time.Hour

// checkEvery is how often an open file checks its age, so a program that
// writes little still drops old lines.
const checkEvery = time.Hour

// File is one source's log: name.log, which moves to name.log.1 once it
// is Span old or MaxSize big, replacing the copy there. Its first line is
// a header that says when it started, which is the age the limits read.
type File struct {
	path   string
	header func(started time.Time) string
	now    func() time.Time
	max    int64

	mu      sync.Mutex
	f       *os.File
	size    int64
	started time.Time
	// closed is set by Close. A file that is nil without it could not be
	// made again, as when another program holds it on Windows; a write
	// after retry tries again.
	closed bool
	retry  time.Time
	stop   chan struct{}
	done   chan struct{}
}

// retryEvery is how long a file that could not be made waits before a
// write tries again.
const retryEvery = time.Minute

// Header answers a file's first line for a source started at started.
func Header(product, version, system, source string, started time.Time) string {
	return "━━ " + product + " " + version + " · " + system + " · " + source +
		" · log started " + started.Format(time.RFC3339) + " ━━\n"
}

var startedRE = regexp.MustCompile(`log started (\S+) ━━`)

// Open opens name.log in dir, made with only its owner's access. A file
// with no header that says when it started, or one older than Span, moves
// aside first; an older copy past its time is removed.
func Open(dir, name string, header func(started time.Time) string) (*File, error) {
	return open(dir, name, header, time.Now, MaxSize, checkEvery)
}

func open(dir, name string, header func(time.Time) string, now func() time.Time, max int64, every time.Duration) (*File, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	l := &File{path: filepath.Join(dir, name+".log"), header: header, now: now, max: max}
	l.prune()
	if err := l.openCurrent(); err != nil {
		return nil, err
	}
	if every > 0 {
		l.stop, l.done = make(chan struct{}), make(chan struct{})
		go l.watch(every)
	}
	return l, nil
}

// Path answers the file's path.
func (l *File) Path() string { return l.path }

func (l *File) watch(every time.Duration) {
	defer close(l.done)
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-l.stop:
			return
		case <-t.C:
			l.mu.Lock()
			l.prune()
			if l.f != nil && l.now().Sub(l.started) >= Span {
				_ = l.rotate()
			}
			l.mu.Unlock()
		}
	}
}

// prune removes the older copy once Span has passed since its last line.
func (l *File) prune() {
	old := l.path + ".1"
	if st, err := os.Stat(old); err == nil && l.now().Sub(st.ModTime()) >= Span {
		_ = os.Remove(old)
	}
}

func (l *File) openCurrent() error {
	started, ok := readStarted(l.path)
	if _, err := os.Stat(l.path); err == nil && (!ok || l.now().Sub(started) >= Span) {
		// A file that cannot say its age is treated as too old.
		return l.rotate()
	} else if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if !ok {
		return l.create()
	}
	f, err := os.OpenFile(l.path, os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	l.f, l.size, l.started = f, st.Size(), started
	return nil
}

// readStarted answers the start time in the header of the file at path.
func readStarted(path string) (time.Time, bool) {
	f, err := os.Open(path)
	if err != nil {
		return time.Time{}, false
	}
	defer f.Close()
	line, err := bufio.NewReader(f).ReadString('\n')
	if err != nil {
		return time.Time{}, false
	}
	m := startedRE.FindStringSubmatch(line)
	if m == nil {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, m[1])
	return t, err == nil
}

// create starts a new, empty file with its header.
func (l *File) create() error {
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		l.retry = l.now().Add(retryEvery)
		return err
	}
	l.started = l.now()
	n, err := f.WriteString(l.header(l.started))
	if err != nil {
		f.Close()
		l.retry = l.now().Add(retryEvery)
		return err
	}
	l.f, l.size = f, int64(n)
	return nil
}

// rotate moves the file aside and starts a new one. When the file cannot
// move, as when another program holds it open on Windows, the new one
// replaces it: kept, it would stay full and every line would try again.
func (l *File) rotate() error {
	if l.f != nil {
		_ = l.f.Close()
		l.f = nil
	}
	_ = os.Rename(l.path, l.path+".1")
	return l.create()
}

func (l *File) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.f == nil {
		if l.closed || l.now().Before(l.retry) {
			return 0, ErrClosed
		}
		if err := l.create(); err != nil {
			return 0, err
		}
	}
	if l.size+int64(len(p)) > l.max || l.now().Sub(l.started) >= Span {
		if err := l.rotate(); err != nil {
			return 0, err
		}
	}
	n, err := l.f.Write(p)
	l.size += int64(n)
	return n, err
}

// Clear empties the file and removes its older copy, as a wipe of the
// settings asks. The file then starts again with its header.
func (l *File) Clear() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return ErrClosed
	}
	if l.f != nil {
		_ = l.f.Close()
		l.f = nil
	}
	err := l.create()
	if rerr := os.Remove(l.path + ".1"); rerr != nil && !errors.Is(rerr, fs.ErrNotExist) {
		err = errors.Join(err, rerr)
	}
	return err
}

// Close stops the age checks and closes the file.
func (l *File) Close() error {
	if l.stop != nil {
		close(l.stop)
		<-l.done
		l.stop = nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.closed = true
	if l.f == nil {
		return nil
	}
	err := l.f.Close()
	l.f = nil
	return err
}
