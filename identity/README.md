# identity

The identity service of Phospheare: Google sign-in, the writer session, and
the Drive connections and remembered OpenRouter keys it seals into cookies. It
serves the `/identity/*` routes and nothing else.
[docs/architecture.md](../docs/architecture.md) describes its place in the
product and why it keeps no state.
[docs/identity-contract.md](../docs/identity-contract.md) is its wire
contract.

`once-dark-studio-desktop` (`desktop/`) runs this binary as a child process
on a loopback port and passes `/identity/` to it.

## Run

```
identity [serve]      run the service
identity keys new     print a fresh keyring line
identity google-check check the Google client against every origin's redirect URI
identity version      print the version
```

`serve` reads its settings from the environment. It refuses to start on a
missing or malformed value and names every one that is wrong.

| Variable | Meaning |
|---|---|
| `IDENTITY_PUBLIC_ORIGINS` | Required. The browser origins served, comma-separated, as `scheme://host[:port]`. Plain HTTP only for a loopback host. The request's `Host` picks one: its redirect URI, its `Secure` cookies, the only `Origin` the guard accepts. Any other `Host` gets a `421` page. |
| `IDENTITY_GOOGLE_CLIENT_ID` | Required. The Web application client. |
| `IDENTITY_GOOGLE_CLIENT_SECRET` | Required, unless the secrets come on standard input. The client's secret. |
| `IDENTITY_SEAL_KEYS_FILE` | Required, unless the secrets come on standard input. The keyring file; `serve` writes one with a single key when it does not exist. |
| `IDENTITY_SECRETS_ON_STDIN` | `true` reads the secrets from the first line of standard input, before anything else: `{"googleClientSecret": …, "sealKeys": …}`, where `sealKeys` is the keyring as its file would hold it. Neither is then in the environment or on disk, and the two settings above are not read. `google-check` reads only the client secret. Default `false`. The desktop sets it and keeps both secrets in the system's own store. |
| `IDENTITY_LISTEN` | The routes; default `:8080`. With port 0 the service picks a free port. Once it listens, it prints `listening host:port` on standard output, the one line it writes there. The desktop program starts the service on port 0 and passes `/identity/` to it from its own port, 47821, and the Vite dev server proxies `/identity` to `http://127.0.0.1:47821` unless `PHOSPHEARE_IDENTITY_ORIGIN` says otherwise; a service started by hand on `:8080` is reached by the dev server only with that variable set. |
| `IDENTITY_PRODUCT_NAME` | The name on the pages the service serves; default the build's `-X main.productName`. |
| `IDENTITY_STOP_ON_STDIN_CLOSE` | `true` stops the service as `SIGTERM` does once its standard input closes; default `false`. The desktop sets it, so the child ends with the desktop on every system. |

Every Google client must list `<origin>/identity/google/callback` for each
origin served.

### Keys

The keyring holds one base64url key per line; blank lines and lines starting
with `#` are ignored. The first key seals and every key opens, so a cookie
opens for as long as the key that sealed it is anywhere in the ring. To
rotate the keys without disconnecting anyone, add a key at the top, then drop
the old one after the cookies it sealed have expired. A
browser whose cookies were sealed by none of the keys loses its writer
session, its Drive connections and its kept keys; the app opens a new session,
and nobody is signed out of the app. Sessions last 30 days; connections and
kept keys last up to 400 days. `serve` reads the keyring once, at start; a
changed keyring takes effect when the service starts again.

### At run time

- One text log line per request: method, route pattern, status, duration
  and request id (`X-Request-Id`, kept or made). No query, code, token,
  cookie or email reaches the log.
- The service listens once its settings and keyring have been read.
  `SIGTERM` stops it from accepting new requests, lets the requests in flight
  finish for up to 20 seconds, then exits.
- Request bodies are capped at 16 KiB and flows at ten minutes, and the
  server times out slow headers, bodies and idle connections. Some routes are
  rate-limited per client address
  ([identity-contract.md](../docs/identity-contract.md#rate-limit)).

## Layout

A Go module of its own, `github.com/perseomazzoni/phospheare/identity`, with
no third-party requirements. It never imports the desktop module, and
`boundaries_test.go` fails when it does, when `domain` imports
anything outside the standard library, when `ports` imports more than
`domain`, or when `application` imports more than `domain` and `ports`.

| Path | Layer | Responsibility |
|---|---|---|
| `cmd/identity` | composition | the command: settings, keyring, the listener, signals, the drain |
| `identity.go` | composition | `New`, and `Handler` for every origin served |
| `domain` | domain | flows, origins, sessions and their proof, Drive connection claims, kept-credential claims, trial reports, ID token checks, refusal codes |
| `ports` | ports | Google client source, sealer, Google's OAuth endpoints, the Drive probe |
| `application` | application | flows (single use, carried by the browser), the writer session, the trial sign-in, Drive refresh and revocation |
| `adapters/httpapi` | adapters | the `/identity/` routes (sessions, flows, trials, tokens, kept credentials), origins by `Host`, the wrong-address page, cross-site guard, security headers, cookies and the session proof header, the callback page, the per-address rate limit, request ids, the request log |
| `adapters/google` | adapters | Google token, revocation, client-check and Drive probe calls |
| `adapters/seal` | adapters | the AES-256-GCM keyring |
| `adapters/config` | adapters | the environment settings, checked |
| `adapters/problem` | adapters | RFC 9457 problem answers |

## Test

[CONTRIBUTING.md](../CONTRIBUTING.md#tests-and-gates) gives the Go checks,
with and without Go on the machine.
