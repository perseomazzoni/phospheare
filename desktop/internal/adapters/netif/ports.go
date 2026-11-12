// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package netif

import (
	"errors"
	"net"
	"strconv"
	"syscall"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

// Windows reports a port another program holds, and one it reserves, with
// its own socket errors rather than the POSIX numbers.
const (
	wsaAccess    syscall.Errno = 10013
	wsaAddrInUse syscall.Errno = 10048
)

// probeTimeout bounds the dial that finds a program answering on a port.
const probeTimeout = 100 * time.Millisecond

// PortUse opens port on every interface, as the home network does, and
// closes it again. Windows lets a port be opened twice when the program
// holding it asked to share it, so a port where something answers counts
// as in use even when it opens. The dial waits at most probeTimeout: a
// loopback port nothing listens on refuses at once on Linux and macOS, but
// Windows retries the connection, so a dial there lasts its whole timeout.
func PortUse(port int) domain.PortUse {
	ln, err := net.Listen("tcp", net.JoinHostPort("0.0.0.0", strconv.Itoa(port)))
	if err != nil {
		var errno syscall.Errno
		if errors.As(err, &errno) && (errno == syscall.EACCES || errno == syscall.EPERM || errno == wsaAccess) {
			return domain.PortNotAllowed
		}
		return domain.PortInUse
	}
	ln.Close()
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), probeTimeout)
	if err == nil {
		conn.Close()
		return domain.PortInUse
	}
	return domain.PortFree
}
