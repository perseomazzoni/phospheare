# once-dark-studio-desktop

The desktop bundle of Phospheare: a Go executable that embeds the built SPA
and serves it on `http://localhost:47821`, runs the identity service
(`identity/`) as a child process and passes `/identity/` to it, serves the
setup page at `/desktop/setup/`, and, on request, serves the home network
over HTTPS. It installs Phospheare on one computer: the identity service it runs is the `identity` binary built
from `identity/`.

No release holds a program. Writers build the archives from a release's
source code with `build.sh`, as "Quickstart, for everyone" in the
[README](../README.md#quickstart-for-everyone) says. Each archive holds
`once-dark-studio-desktop` and `identity` side by side; the writer starts the
first. [docs/architecture.md](../docs/architecture.md)
describes where the program sits, and [docs/install.md](../docs/install.md)
is the writer's guide, with the home-network setup in part 4.

## Layout

A Go module of its own, `github.com/perseomazzoni/phospheare/desktop`. It
imports no code of the identity module: it runs the `identity` binary and
talks to it over HTTP and its command line. Its code is split into
`domain`, `ports`, `application` and `adapters`;
`internal/boundaries_test.go` fails when a `domain` package imports
anything outside the standard library, when a `ports` package imports more
than `domain`, or when any package imports the identity module.

The identity service runs on a free loopback port, configured through its
`IDENTITY_*` environment ([identity/README.md](../identity/README.md)): the
loopback origin and, once the home network has its name, the home-network
origin; and the Google client's id from `config.json`. The client secret
and the seal keyring reach it as one line on its standard input
(`IDENTITY_SECRETS_ON_STDIN`), never in its environment or on disk; the
desktop makes the keyring with `identity keys new` on the first start and
keeps it in its vault (below). The desktop program waits until that port
accepts a connection. When the service exits
on its own or fails to start, the program starts it again after a growing
pause, until a start succeeds, and it stops the service on quit. The loopback
listener answers before the first start, so a second launch finds this copy;
until the service runs, `/identity/*` answers `identity-unavailable`.

The desktop program holds the child's standard input open, and the child
drains and exits when it closes (`IDENTITY_STOP_ON_STDIN_CLOSE`). The system
closes it however the desktop program ends, so a killed program leaves no
child behind. On Windows, the child is also in a job object that closes with
the program, and on Linux it also gets SIGTERM when the program dies. Saving
the Google client, a new home-network origin, or "Disconnect Google Drive and
OpenRouter everywhere" (a keyring from `identity keys new`) starts the
service again. The setup page's Google check runs `identity google-check`.

| Path | Responsibility |
|---|---|
| `cmd/once-dark-studio-desktop` | flags, startup, single instance, shutdown |
| `cmd/fake-services` | development only: the stand-ins for Google, deSEC and Let's Encrypt that `npm run dev:wizard` runs; the release build never builds it |
| `internal/domain` | settings, home-network rules, the language choice, release version comparison |
| `internal/ports` | settings store, vault, certificate source, deSEC account, login list, the identity service |
| `internal/application` | the home-network HTTPS listener, the sign-up for its name, and Start over |
| `internal/adapters/front` | one listener: the program's `/desktop/` paths, `/identity/` passed on to the identity service with the browser's Host, and the SPA with its security headers, behind the program's Host rules |
| `internal/adapters/identityproc` | runs, watches, restarts and stops the identity service; disconnects Google Drive and OpenRouter from every browser; runs the Google check |
| `internal/adapters/problem` | RFC 9457 problem answers |
| `internal/adapters/web` | the embedded SPA |
| `internal/adapters/configfile` | `config.json` in the data folder (mode 0600), with no secret in it |
| `internal/adapters/vault` | the secrets: Windows Credential Manager, the macOS Keychain (through `/usr/bin/security`) or the Linux Secret Service (over D-Bus); `secrets.json` (mode 0600) where none answered at the first start |
| `internal/adapters/durable` | replaces a file whole, on disk before the rename: `config.json`, `secrets.json`, `tls/cert.pem` |
| `internal/adapters/admin` | `/desktop/`: the setup page (embedded HTML/CSS/JS), its API, and `/desktop/info` |
| `internal/adapters/certs` | DNS-01 issuance with Let's Encrypt on the deSEC name |
| `internal/adapters/desec` | deSEC's API: the account, the token, the name's records, lookups on its name servers |
| `internal/adapters/netif` | the LAN address list |
| `internal/adapters/autostart` | start at login (Windows registry, macOS LaunchAgent, Linux autostart entry) |
| `internal/adapters/browser` | opening the default browser |
| `internal/adapters/instance` | port claim and "already running" detection |
| `internal/adapters/tray` | the tray icon and its menu (Windows, and Linux with a StatusNotifierItem host), through `fyne.io/systray`; the menu model is tested without a tray |
| `internal/adapters/console` | where the messages for a person go: the terminal, and on Windows a message box for a failed start |
| `internal/adapters/logs` | the log files: the line format, the levels, the removal of personal data, and how long a file is kept |
| `internal/adapters/locale` | the system language |
| `internal/adapters/words` | the setup page's and the tray menu's texts, in English and Italian |
| `tools/pack` | writes the release `.zip` and `.tar.gz` archives |
| `tools/winres` | writes the Windows icon and manifest object `build.sh` links, and the tray's committed icons |
| `packaging/README.txt` | the read-me shipped in every archive |

## Running

```
once-dark-studio-desktop [--port 47821] [--data-dir DIR] [--spa-dir DIR]
         [--identity FILE] [--no-browser] [--no-tray]
         [--acme-directory URL] [--desec-api URL] [--log-level LEVEL]
         [--dev --dev-origin ORIGIN]
```

- `--identity` names the identity binary; by default it is `identity`
  (`identity.exe` on Windows) beside the program, as the archive lays them
  out.
- `--acme-directory` and `--desec-api` point the home network at other
  ACME and deSEC endpoints, for tests.
- `--log-level` is the lowest level the log files keep: `debug`, `info`
  (the default), `warn` or `error`. The identity service gets the same
  level.
- The data folder is `once-dark-studio-desktop` under the per-user
  configuration folder (`%APPDATA%`, `~/Library/Application Support`,
  `~/.config`). It holds `config.json`, `tls/cert.pem`, the log files in
  `logs/` and, where the computer has no password store, `secrets.json`.
- The secrets are the Google client secret, the deSEC token (and the deSEC
  password until the token exists), the seal keyring, the Let's Encrypt
  account key and the certificate's key. The first start keeps them in the
  system's own store when one answers, and records that choice in
  `config.json` (`"secrets": "system"` or `"file"`). From then on a store
  that does not answer stops the start with a message, rather than start
  again with no secrets. Each item is named for its data folder, so two
  setups (`--data-dir`) never share one: Credential Manager shows
  `once-dark-studio-desktop:<data folder>:<name>`, the Keychain the service
  `once-dark-studio-desktop` with the account `<name> <data folder>`, and
  the Secret Service the attributes `application`, `folder` and `name`.
  This keeps the secrets out of a copy of the data folder, a backup and a
  roaming profile; a program that runs as the same person can still ask the
  store for them. "Wipe every configuration" on the setup page removes every
  item, the certificate included; deleting the data folder alone leaves
  them, to be removed in Credential Manager, Keychain Access or the
  keyring's window.
- The loopback listener binds `127.0.0.1` and, where the computer has IPv6
  loopback, `[::1]`, so no other program can answer `localhost` there; a
  `[::1]` held by another program counts as the port being taken.
  `127.0.0.1:<port>` is redirected to `localhost:<port>` so the browser
  origin is one string. On port 80 both are written without the port, as
  browsers send them.
- When the port is taken, the program asks the holder for `/desktop/info`. If
  it is another copy, it opens the browser there and exits 0; otherwise it
  explains the conflict and exits 1.
- The SPA is served with or without a Google client. Without one, the app
  writes in Local Storage, no identity service runs, and `/identity/*`
  answers `503 google-not-configured`. The home network needs a Google
  client. While the service is down or restarting, `/identity/*` answers
  `identity-unavailable` (`503`, or `502` when it does not answer). The
  browser opens at `/app` unless `--no-browser`.
- On Windows, and on a Linux desktop whose session has a tray host (KDE
  Plasma, Xfce, Cinnamon, MATE, Budgie, Ubuntu's GNOME), the program shows
  the brand's whole figure in the tray, on no ground: light on a dark
  taskbar, dark on a light one (Windows follows the taskbar's theme; Linux
  shows the light one). The icons come from `tools/brand/tray.mjs`
  through `tools/winres -tray`. The menu has Open, Setup, Open on a phone or
  tablet (while the home network is on), the home network's state and, once
  it is set up, a Start or Stop for it, Start at login, and Quit. The menu
  does what the setup page does, and reads the program's state again every
  two seconds. Without a tray host (GNOME without the AppIndicator extension,
  a session with no desktop), with `--no-tray`, with `--dev`, and on macOS,
  the program runs in its terminal.
- The setup API answers only calls that carry the launch's key, so no other
  program on the computer can change the settings. The key is made at start
  and kept in memory only. The program opens the browser on the setup page
  with the key in the address's fragment. On macOS, and wherever there is no
  tray, the terminal shows that address; the Windows log never holds it.
  [docs/identity-contract.md](../docs/identity-contract.md#setup-page-api)
  gives the setup API and how a second launch reaches the running copy.
- The home network starts again with the program when it was left on. At
  login the computer may not be on the network yet, so a start that cannot
  reach deSEC or Let's Encrypt tries again six times, with a pause that starts
  at 30 seconds and doubles each time. A stored certificate that is still
  valid serves when the address record cannot be written or a renewal fails,
  and a check every 12 hours renews it. While the stored certificate serves,
  the address record is written again every five minutes. A Let's Encrypt
  rate limit is reported at once.
  [docs/home-network.md](../docs/home-network.md) describes how to set it
  up.
- `config.json` keeps the address of the Let's Encrypt agreement that the
  person accepted (`lan.certTerms`), and the home network does not start
  without it. Before each request, `internal/adapters/certs` compares it
  with the agreement in the ACME directory. When they differ, it registers
  no account and places no order. For a directory that names no agreement,
  `lan.certTerms` is `none`.
  [docs/home-network.md](../docs/home-network.md#after-the-setup) says what
  the person sees when the agreement changes.
- Start at login repeats the running copy's `--port` and `--data-dir` when
  they were given.
- The process stops on "Quit" in the tray's menu or on the setup page and,
  where it runs in a terminal, when the terminal closes or on Ctrl+C.
- On every system, the program writes `logs/desktop.log` and
  `logs/identity.log` in the data folder, and the same lines to the
  terminal when it is started from one. The setup address, which holds the
  key, goes only to the terminal.
  - A line is: the time, the level (`DEBUG`, `INFO`, `WARN` or `ERROR`),
    the source (`desktop` or `identity`), the writer account or `-`, the
    area, a message, and `key=value` fields. A successful GET is `DEBUG`.
  - Each file starts with a header that says when the file started. It
    moves to `.log.1` when it is 7 days old or past 5 MiB. The `.log.1`
    copy is removed 7 days after its last line, so no line is kept longer
    than 14 days.
  - No line holds personal data, as the
    [log rule](../CONTRIBUTING.md#rules-the-gates-cannot-fully-check) says.
    As a safety net, the program replaces these values with placeholders
    such as `[home]`, `[name]` and `[address]` before it writes a line:
    - the home folder, and the user and computer names;
    - the home network's name and the email of its deSEC account;
    - every email address, and every IP address other than loopback. A
      product's version, such as `Chrome/131.0.0.0`, stays.
  - The identity service writes JSON lines, which the program writes into
    `identity.log` in the same format.
  - The Go runtime writes a crash to `crash.txt` in the data folder, with
    no value removed. The next start empties the file and copies the crash
    into `desktop.log` as `ERROR` lines in the area `crash`. It copies
    them once the settings are read, so the home network's name is removed
    too.
  - "Detailed log" on the setup page keeps `DEBUG` lines for 24 hours, past
    `--log-level`. `config.json` keeps the end (`logDetailedUntil`), so a
    restart keeps it.
  - "Show the files" on the setup page and "Show the log files" in the
    tray's menu open the `logs` folder. "Wipe every configuration" empties
    both files and turns the detailed log off.
  - The files stay on the computer. Nothing sends them.
- The Windows program has no console window (`-H windowsgui`). A failure
  to start that no terminal shows opens a message box. The identity
  service, and the program's other runs of it, start with no window either.
  The executable carries the app icon (`web/public/icon-512.png`) and a
  manifest declaring per-monitor DPI awareness, both from `tools/winres`.

## Development

Run the program behind the Vite dev server, which then serves the SPA:

```
once-dark-studio-desktop --dev --dev-origin http://localhost:5173 --no-browser
```

`--dev` serves only `/identity/*` and `/desktop/*`, and runs the identity
service on the dev origin, so its Google redirect URI is
`http://localhost:5173/identity/google/callback` (which the development
Google client must list) and its cross-site guard and Host check accept only
that origin. The program's own Host check is skipped except for the setup
page. The Vite configuration proxies `/identity` to it and keeps the
browser's Host; set `PHOSPHEARE_IDENTITY_ORIGIN` when the program does not
listen on the default port:

```ts
proxy: {
  "/identity": {
    target: process.env.PHOSPHEARE_IDENTITY_ORIGIN ?? "http://127.0.0.1:47821",
    changeOrigin: false,
  },
},
```

For everyday work, `npm run dev:full` runs the identity service on its own,
without the desktop program
([CONTRIBUTING.md](../CONTRIBUTING.md#with-google)).

`--spa-dir web/dist` serves a fresh SPA build from disk instead of the
embedded copy. A checkout has no `identity` binary beside the program, so
build one (`go build -o identity ./cmd/identity` in `identity/`) and pass
it with `--identity`.

## Build and test

[CONTRIBUTING.md](../CONTRIBUTING.md#tests-and-gates) gives the Go checks,
with and without Go on the machine, and the certificate test against Pebble.
The supervisor's tests build the identity binary from `../identity`.

## Release build

[CONTRIBUTING.md](../CONTRIBUTING.md#building-the-release) gives the
commands. `build.sh` needs Go and a built SPA in `web/dist` (`SPA_DIR` overrides it),
with the third-party notices written into it by `npm run notices`; without
them it stops.
It writes `desktop/dist/once-dark-studio-desktop-<version>-<os>-<arch>.zip`
(Windows) or `.tar.gz` (macOS arm64 and amd64, Linux amd64 and arm64), each
holding `once-dark-studio-desktop`, `identity`, `README.txt` and
`LICENSE`. Both binaries are built with `CGO_ENABLED=0 -trimpath` and
`-ldflags "-s -w -X main.version=$VERSION -X main.productName=<name>"`, where
`<name>` is read from `product.json`; the Windows desktop program also gets
`-H windowsgui`. The version is the one in `web/package.json`, the same one
the SPA build reads, unless `VERSION` is set.

### How the SPA is embedded

`internal/adapters/web` embeds its `webdist` folder with
`//go:embed all:webdist`. The tracked tree holds only a placeholder
`index.html` there, so the module builds and tests without the SPA;
`.gitignore` ignores everything else in that folder. `build.sh` saves the
placeholder, replaces the folder with `web/dist`, builds, and puts the
placeholder back on exit, success or failure, so a release build leaves the
working tree as it found it. A build with `go build` alone serves the
placeholder page.

### Signing

The archives are not signed. Windows SmartScreen and macOS Gatekeeper warn
on first launch; `packaging/README.txt` tells the writer how to proceed.
Signing needs an Authenticode certificate (Windows) and an Apple Developer ID
with notarization (macOS), neither of which this build has.
