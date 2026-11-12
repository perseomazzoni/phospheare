// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package instance

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"syscall"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

// Outcome is what claiming the loopback port found.
type Outcome int

const (
	// Claimed: the port is this process's.
	Claimed Outcome = iota
	// Running: another copy of `once-dark-studio-desktop` holds the port.
	Running
	// Occupied: another program holds the port.
	Occupied
)

// wsaAddrInUse is Windows' own number for an address in use.
const wsaAddrInUse syscall.Errno = 10048

// Claim listens on 127.0.0.1:port and, where the computer has IPv6
// loopback, on [::1]:port too. A browser may try `localhost` on either, so
// another program must not hold the second one. When the port is taken it
// asks the holder whether it is `once-dark-studio-desktop`. Claimed answers
// one listener per address.
func Claim(ctx context.Context, port int) ([]net.Listener, Outcome, error) {
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		if Probe(ctx, addr, domain.LoopbackHost("localhost", port)) {
			return nil, Running, nil
		}
		return nil, Occupied, err
	}
	six, err := net.Listen("tcp", net.JoinHostPort("::1", strconv.Itoa(port)))
	switch {
	case err == nil:
		return []net.Listener{ln, six}, Claimed, nil
	case inUse(err):
		ln.Close()
		return nil, Occupied, err
	}
	// A computer without IPv6 loopback has no [::1] to hold.
	return []net.Listener{ln}, Claimed, nil
}

func inUse(err error) bool {
	var errno syscall.Errno
	return errors.As(err, &errno) && (errno == syscall.EADDRINUSE || errno == wsaAddrInUse)
}

// OccupiedMessage explains to the user of product a port held by another
// program.
func OccupiedMessage(product string, port int) string {
	return fmt.Sprintf(`%[1]s cannot start: another program is using port %[2]d on this computer.

Close that program and start %[1]s again, or start it on another
port with --port, for example:

    once-dark-studio-desktop --port %[3]d

Changing the port changes the address of %[1]s in the browser.
The browser keeps the work it saved per address, so what was saved under
http://localhost:%[2]d is not visible at the new address. The Google client
also needs the new redirect address added.`, product, port, port+1)
}
