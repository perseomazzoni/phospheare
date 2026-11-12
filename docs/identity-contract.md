# The identity service contract

The wire contract of the identity service (`identity/`): its routes, cookies
and flows, and the API of the desktop program's setup page. Each point is
covered by the tests in `identity/`, `desktop/` and `web/src/platform/`.
[architecture.md](architecture.md) describes where the service sits and why
it keeps no state. [identity/README.md](../identity/README.md) describes how
to run it and how its keyring works.

## Rules for every route

All identity routes live under `/identity/`. Every non-GET route requires the
header `X-Phospheare: 1` and `Sec-Fetch-Site: same-origin` (or no
`Sec-Fetch-Site` header), so another site cannot call them from a page. Every
route that uses the writer session also requires `X-Phospheare-Session:
<proof>`, the proof that `POST /identity/session` returned. The SPA keeps the
proof in its origin's `localStorage` as `identity.proof.<writerId>`.
Refusals are RFC 9457 problems with a machine-readable `code`. Nothing here
logs a query string, a code or a token.

## Cookies

- `phospheare_session`: sealed `{sid, writerId, iat, proof}`; `HttpOnly`,
  `SameSite=Strict`, `Path=/identity`, `Max-Age` 30 days, `Secure` on HTTPS.
  Set when a writer session opens, cleared when it ends. Together with the
  proof the request carries, it binds every token operation to the open
  writer session.
- `phospheare_g_<connectionId>`: sealed `{v, connectionId, writerId, sub,
  email, refreshToken, scopes, createdAt}`; `HttpOnly`, `SameSite=Strict`,
  `Path=/identity/google`, `Max-Age` 400 days, `Secure` on HTTPS. Holds the
  Drive refresh token.
- `phospheare_flow_<flowId>`: one per flow in progress, sealed `{id,
  verifier, nonce, purpose, sid, writerId, expectedSub, redirectUri, created,
  status}` and, after the callback, its outcome; `HttpOnly`, `SameSite=Lax`,
  `Path=/identity/google`, `Max-Age` the rest of its ten minutes, `Secure` on
  HTTPS. The flow lives only here, so a callback that lands in another browser
  finds nothing to settle.
- `phospheare_k_<slot>`: one per account and kept credential. Holds a
  remembered OpenRouter key ("Kept credentials" below).

Every cookie is sealed with AES-256-GCM under the service's keyring.

## Routes

| Route | Body | Answer |
|---|---|---|
| `GET /identity/session` | — | `{writerId}`, with `null` when no session is open (also without the proof) |
| `POST /identity/session` | `{writerId}` | `{proof}`; sets `phospheare_session` with a new `sid` and proof, or keeps the cookie and returns its proof when the request carries that proof for this account |
| `DELETE /identity/session` | — | `204`; clears `phospheare_session` |
| `POST /identity/google/flows` | `{purpose:"identity"|"drive", writerId, expectedSub?, loginHint?}` | `{flowId, authorizeUrl}`; sets `phospheare_flow_<flowId>`. Refuses `no-session`, `writer-mismatch` when the session's account differs, `bad-request` for any other purpose, `google-not-configured` |
| `GET /identity/google/callback` | Google's redirect | A page that tells the opener `{flowId, status}` and closes ("Callback page" below) |
| `POST /identity/google/flows/{flowId}/finish` | — | Identity: `{identity:{iss, sub, email, emailVerified, name, picture}}`. Drive: `{connection:{connectionId, sub, email, scopes}, accessToken, expiresIn}`, and sets `phospheare_g_<id>`. Refuses `flow-pending` (cookie kept), `flow-session-mismatch`, `account-mismatch`, `scope-missing`, `flow-expired`, `flow-failed`, `flow-cancelled` (declined at Google), `bad-request` (a trial flow) |
| `POST /identity/google/trials` | — | Loopback origin only. `{flowId, authorizeUrl}`; sets `phospheare_flow_<flowId>`. Needs no session. Refuses `google-not-configured` |
| `POST /identity/google/trials/{flowId}/finish` | — | Loopback origin only. `{result, email?}` ("Trial sign-in" below). Refuses `flow-pending`, `flow-expired`, `bad-request` (not a trial) |
| `POST /identity/google/token` | `{connectionId}` | `{accessToken, expiresIn, scope}`. Refuses `no-session`, `writer-mismatch`, `no-connection`, `grant-invalid` (cookie cleared), `google-refused`, `google-unreachable` |
| `DELETE /identity/google/connections/{connectionId}` | `{revoke:boolean}` | `{revokedAtGoogle:boolean}`; clears the cookie. `revoke:true` needs the session and its proof |

The kept-credential routes are in "Kept credentials" below.

## The Google window

Google's consent screen runs in a popup that the SPA opens within the
writer's click. A blocked popup is refused as `popup-blocked`, and the writer
clicks again. The SPA never turns a flow into a full-page redirect, because a
redirect would unload an editor that holds unsaved prose. If the writer closes
the popup, the flow ends as `flow-cancelled` once the SPA's tab has focus
again, and the app says nothing. A flow whose start meets `no-session` or
`writer-mismatch` is started once more in the same open popup after the
session is opened again. A flow is never run again once Google has shown its
window.

## Sessions

- `POST /identity/session {writerId}` answers `200 {proof}`. The proof is
  32 random bytes as base64url, sealed into `phospheare_session` beside the
  `sid`. When the request carries a live session for that `writerId` and its
  proof in `X-Phospheare-Session`, the cookie (and its `sid`) is left
  unchanged and the same proof is returned, so two tabs of the same account
  do not end each other's flows. Another account, a missing or unreadable
  cookie, a missing or wrong proof, or a session past its thirty days gets a
  new `sid` and a new proof.
- Every route that uses the session requires `X-Phospheare-Session: <proof>`
  and treats a missing or wrong proof as no session: `GET /identity/session`,
  `POST /identity/google/flows`, `POST /identity/google/flows/{id}/finish`,
  `POST /identity/google/token`, `DELETE /identity/google/connections/{id}`
  with `revoke:true`, `PUT /identity/credentials/{name}` and
  `POST /identity/credentials/{name}/open`. `DELETE /identity/session`,
  `DELETE /identity/credentials/{name}` and a disconnect without `revoke` ask
  for none; they only clear a cookie.
- The proof exists because a browser sends localhost cookies to every port
  of the host: another program on the computer can receive the session and
  connection cookies and replay them. The SPA keeps the proof in its own
  origin's `localStorage`, which no other port reads, so the cookies alone
  open nothing. A session sealed without a proof is no session.
- `GET /identity/session` answers `200 {writerId}`, and `200 {"writerId": null}`
  when no session is open. No session is an answer, not an error, so a page
  load logs nothing. After the identity service restarts, the SPA uses it to
  learn whether it must open the session again.
- `writerId` must match `^[A-Za-z0-9._:-]{1,128}$`; anything else is
  `400 bad-request`.
- A session is honoured for 30 days from its sealed `iat`, and
  `phospheare_session` has `Max-Age` 30 days, so the writer session survives
  a browser restart. An older one is `no-session`, and the SPA opens a new
  one. Signing out (`DELETE /identity/session`) clears it.

## Flows

- `POST /identity/google/flows` needs an open session: without one it answers
  `401 no-session`. A `writerId` that differs from the session's is
  `403 writer-mismatch`. A Drive flow without `expectedSub`, or a purpose
  other than `identity`/`drive` (`trial` included), is `400 bad-request`.
- An identity flow may carry `expectedSub` too (signing in again as a bound
  writer); a different account is then refused with `account-mismatch`.
- The authorize URL always carries `response_type=code`, `state`, `nonce`,
  `code_challenge` (S256), `include_granted_scopes=true` and, when given,
  `login_hint`. Identity: `scope=openid email profile`, no `access_type`,
  `prompt=select_account`. Drive: `scope=openid email profile .../drive.file
  .../drive.appdata`, `access_type=offline`, `prompt=consent`.
- An ID token is accepted up to five minutes past its `exp`, so a service
  whose clock runs ahead of Google's does not refuse a fresh one.
- The redirect URI is the origin the request's `Host` names plus
  `/identity/google/callback`. The service answers the origins
  `IDENTITY_PUBLIC_ORIGINS` lists. The desktop program passes
  `http://localhost:<port>` and, once a home-network name is linked,
  `https://<hostname>[:<port>]` (no `:443`); in development it passes the
  `--dev-origin` value.
- Each flow is its own cookie, `phospheare_flow_<flowId>`, and `state` is the
  flow id, so two flows started in one browser stay apart.
- A Drive grant whose token answer has no refresh token fails
  (`flow-failed`).

## Callback page

- It posts `{type:"phospheare-oauth", flowId, status}` where `status` is `done`,
  `failed`, `cancelled` or `expired`; `flowId` is `null` when this browser
  carries no live flow cookie for the callback's `state`. `cancelled` is
  Google's `error=access_denied`: the person declined at Google.
- It posts on `BroadcastChannel("phospheare-oauth")` always and to `window.opener`
  (target origin = its own) when there is one, then calls `window.close()`.
  If the window is still open 400 ms later (it was a full-page redirect, not
  a popup), it navigates to `/app?oauth=<flowId>`. The channel reaches the
  SPA even when the hop through Google severed `window.opener`.
- It carries no `Cross-Origin-Opener-Policy` header, and its CSP allows only
  its inline script by hash.
- The callback seals its outcome (the verified identity, the Drive tokens,
  or the refusal code) into the same flow cookie for `finish` to read.
- A callback whose `state` has no flow cookie in this browser (a redirect
  opened in another browser, or login CSRF) settles nothing: it answers
  `expired`, exchanges no code, and the starting browser's flow stays
  pending.

## Finish

- `flow-pending` (`409`): the callback has not run yet. The flow cookie is
  kept, so the SPA may retry. The SPA asks once more when the writer closes
  the Google window, and reads `flow-pending` then as cancelled.
- `flow-cancelled` (`409`): the person declined at Google. The SPA says
  nothing.
- No session at all, or a missing or wrong proof, is
  `flow-session-mismatch`, like a closed or changed session; the flow cookie
  is cleared. Opening the session again cannot rescue the flow, which
  belongs to the session that started it.
- A flow cookie that is missing, past its ten minutes or does not open under
  the keys is `flow-expired`.
- Every other answer also clears the flow cookie (single use).

## Trial sign-in

- The setup page proves the Google setup with one sign-in. The two trial
  routes exist only on the loopback origin; any other origin answers
  `404 not-found`, so a device on the home network cannot start one.
- `POST /identity/google/trials` needs no session; it is the only way a
  trial flow is made. Its authorize URL asks for the Drive scopes with
  `prompt=select_account consent`, no `access_type` and no
  `include_granted_scopes`, so Google issues no refresh token and the grant
  does not join the account's earlier ones.
- The callback runs a trial only on the loopback origin; a trial flow cookie
  that reaches the callback on another origin settles nothing (`expired`).
- The callback redeems the code, lists one file of the app's hidden Drive
  folder with the access token, and seals only `{result, email}` into the
  flow cookie. It revokes nothing: revoking a token ends the account's whole
  grant to the client, which may hold a live Drive connection in a browser,
  and the trial's access token lapses within the hour on its own.
  Its page has no return address: a window it cannot close says
  to go back to the setup page.
- `result`: `cancelled` (`access_denied` at Google), `client` (Google
  refused the client's ID or secret), `scope-missing` (a Drive scope not
  granted, or refused by Drive), `drive-off` (the Drive API is off in the
  project), `unreachable`, `failed` (anything else).
- `finish` follows the flow rules above, without a session: `flow-pending`
  keeps the cookie; every other answer clears it. A sign-in flow cannot
  finish as a trial, nor a trial as a sign-in (`bad-request`).

## Token and disconnect

- `POST /identity/google/token` also refuses `bad-request` (malformed
  `connectionId`), `google-not-configured` (`503`) and `google-refused`
  (`502`: Google answered an error other than `invalid_grant`, such as
  `invalid_client` after the client secret changed). A cookie that does not
  open, or that was sealed for another `connectionId`, is `no-connection`
  and is cleared. A new refresh token from Google is resealed into the same
  cookie, with the scopes Google reported.
- `DELETE /identity/google/connections/{id}`: the body is optional
  (`revoke` defaults to `false`). `revoke:false` needs no session; it only
  clears the cookie. `revoke:true` needs the session of the writer that owns
  the connection (`no-session`, `writer-mismatch`). A missing cookie answers
  `200 {revokedAtGoogle:false}`. Once ownership checks pass, local deletion
  always clears the cookie, even if Google cannot confirm revocation. The
  response reports that outcome without claiming revocation succeeded. An
  unreachable identity service leaves the client's connection identifier
  intact, so the client can try again. Deleting the account and disconnecting Remote Storage from
  every device ask with `revoke:true`, which ends the grant for every
  browser and phone of the account on this client and can affect this same
  user's other clients in the Cloud project. A sign-out that cleans the
  browser and a disconnect from this browser only ask with `revoke:false`,
  so only this browser's connection ends.
- A refresh token the service does not keep is not revoked: one from a Drive
  flow that `finish` refuses (`account-mismatch`, `scope-missing`, a late or
  changed session), or one Google replaced on refresh. Revoking ends the
  account's whole grant to the client, and a service that keeps no state
  cannot tell whether the same account holds a live connection in another
  browser or on another device, which revoking would end. The token stays
  unused until Google expires it.

## Kept credentials

A writer may keep an OpenRouter key sealed in this browser. The
browser still calls OpenRouter itself; the service never relays a model
call, it only seals and opens the key. `{name}` is `openrouter.key`; any
other answers `404 not-found`.

| Route | Needs | Answer |
|---|---|---|
| `PUT /identity/credentials/{name}` `{value}` | session + proof | `204`; seals `{v, writerId, name, value}` into this writer's cookie. `400 bad-request` for a value that is empty, over 512 bytes, or not printable ASCII without spaces |
| `POST /identity/credentials/{name}/open` | session + proof | `200 {value}`. `404 no-credential` when there is no cookie, it does not open (the keys were replaced), or it holds another writer's claims; the last two also clear it |
| `DELETE /identity/credentials/{name}` `{writerId}` | nothing | `204`; clears that writer's cookie. Clearing only removes a credential from this browser, so it needs no session |

- The cookie is `phospheare_k_<16 hex>`, the first 8 bytes of
  SHA-256(`writerId` NUL `name`), so no identifier is readable in it and
  two accounts in one browser profile keep their own. Sealed for the purpose
  `phospheare_k:<name>`; `HttpOnly`, `SameSite=Strict`, path
  `/identity/credentials`, `Secure` on HTTPS, 400 days.
- Opening is a `POST`: it hands out a secret, like the token call, so no
  prefetch or cache can trigger it.
- On the home-network listener, `open` takes a token from the same bucket as
  opening a session.
- [ai.md](ai.md#the-key) says what a kept key protects against and what it
  does not.

## Rate limit

- On every listener but the loopback one, `POST /identity/session`,
  `POST /identity/google/flows`, `GET /identity/google/callback` and
  `POST /identity/credentials/{name}/open` take a token from their client
  address's bucket: 30 at once, one more every two
  seconds. An empty bucket answers `429 rate-limited` with
  `retryAfterSeconds` and `Retry-After`.
- The client address is the connection's peer, or, when the peer is a
  loopback address (the desktop's front), the last entry of
  `X-Forwarded-For`. A peer elsewhere cannot choose its own address.

## Guard, Host check, headers

- The cross-site guard also refuses an `Origin` header that is present and
  differs from the listener's origin (the `--dev-origin` value in
  development). A request with no `Sec-Fetch-Site` passes; with one, only
  `same-origin` passes. Code: `csrf-refused` (`403`).
- The identity service answers only the `Host` values of the origins it
  serves, and sends any other a `421` page that links the first origin served
  (the loopback one under the desktop program). The desktop program runs it
  as a child behind its own front, which passes the browser's `Host` on and
  applies its own rules first. On the loopback listener
  (`Host: localhost:<port>`), `127.0.0.1:<port>` gets a `308` to the same path
  on `http://localhost:<port>`. The home-network listener answers only
  `<hostname>:<port>` (or `<hostname>` on port 443), and its `421` page says
  why a numeric address does not work; a visit to it from the computer itself
  gets a `307` to the same path on the loopback origin. Development mode (`--dev`) skips the
  front's Host check except for the setup page; the identity service still
  checks for the dev origin.
- `/identity/*` answers carry `Cache-Control: no-store`,
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
  (the callback and setup pages set their own) and
  `Cross-Origin-Opener-Policy: same-origin` (not on the callback).

## Problem statuses

| Code | Status |
|---|---|
| `bad-request` | 400 |
| `no-session` | 401 |
| `writer-mismatch` | 403 |
| `csrf-refused` | 403 |
| `no-connection`, `no-credential`, `not-found` | 404 |
| `flow-pending`, `flow-failed`, `flow-cancelled`, `flow-session-mismatch`, `account-mismatch`, `scope-missing`, `grant-invalid` | 409 |
| `flow-expired` | 410 |
| `rate-limited` (with `retryAfterSeconds` and `Retry-After`) | 429 |
| `google-unreachable` (with `retryAfterSeconds: 30` and `Retry-After`), `google-refused` | 502 |
| `google-not-configured` | 503 |
| `identity-unavailable` (the desktop's front, while the identity service is down or restarting) | 503, or 502 when it does not answer |

## Setup page API

All under `/desktop/setup/api/`, loopback only, `Host: localhost:<port>` only
(`localhost` on port 80; otherwise `421 wrong-host`), `X-Phospheare-Admin: 1`
on every call including GET, and, when the browser sends them,
`Sec-Fetch-Site: same-origin` and the loopback `Origin`. On the home-network
listener every `/desktop/*` path is `404`.

Every call also carries `X-Phospheare-Setup-Key` with the launch's key: 256
random bits that the program makes at start and keeps in memory only. The
program gives the key to the browser it opens on the setup page (from the
tray's Setup and Open on a phone or tablet and, where there is no tray, at a
second launch) in the address's fragment, `/desktop/setup/#k=<key>`, which no
request, log or `Referer` carries. On macOS, and wherever there is no tray,
the terminal shows that address. The page keeps the key in the tab's
`sessionStorage` and removes it from the address bar. A call without the key,
or with another key, gets `403 setup-key-refused`, whose title tells the
person where to open the page again. The page, its files, `GET /desktop/info`
and `POST /desktop/open-again` (which a second launch calls, with
`X-Phospheare-Admin: 1`) answer without it. `GET /desktop/info` returns
`{program:"once-dark-studio-desktop", version}`, so a second launch finds the
first.

| Route | Body | Answer |
|---|---|---|
| `GET state` | | product, version, data folder, the local address, `google {clientIdSet, clientIdEnd, secretSet, redirectUris:[{for: computer\|home, uri}]}`, `lan {config:{port, address, autoStart, termsAccepted}, name, status}`, `startAtLogin`, `startAtLoginError`. `termsAccepted` says that an agreement of the certificate authority was accepted; `status.terms` is the address of an agreement that waits for the person, when there is one. The route asks no other server |
| `PUT google` | `{clientId, clientSecret}` (an empty secret keeps the saved one) | `204` once the identity service runs with it; `400 invalid` when the client ID does not end in `.apps.googleusercontent.com` or no secret was ever saved; `500 identity-failed` when the service does not start (the client stays saved) |
| `POST google/check` | | `{results:[{redirectUri, result: ok\|wrong-credentials\|redirect-mismatch\|unreachable\|unexpected, detail}]}` |
| `GET lan/addresses` | | `{addresses:[{ip, interface, preferred}]}` |
| `GET lan/ports` | | `{current, default, fallback, suggested}`: the state of each candidate port, and the port the page suggests |
| `PUT lan` | `{port, address}` | `204`; the switch's own state changes only through `lan/start` and `lan/stop`. Turning the switch on sends this first, with the address the page shows |
| `POST lan/name/password` | | `{password}`, a new deSEC password that nothing keeps |
| `POST lan/name` | `{email, name, password, accepted}` | the name's state; `400 refused-email`, `refused-name` or `refused` with deSEC's reason; `400 refused-accepted` without `accepted: true`, before deSEC is asked |
| `GET lan/name` | | `{state: none\|waiting\|expired\|linked, domain, email, requested, problem}`; while waiting it asks deSEC once, at most every 10 s |
| `PUT lan/name` | `{name, token}` | the name's state; `400 refused-name` or `refused-token` |
| `DELETE lan/name` | | the name's state; stops the listener and forgets the name |
| `GET lan/terms` | | `{url, accepted}`: the agreement that the certificate authority has in force, and whether it is the accepted one; `url` is empty when the authority names none. The route asks the authority, so the page calls it only to show the agreement. `502 terms-unreachable` or `terms-unshown` |
| `POST lan/terms` | `{url}` | `202` with the listener status. `url` is the agreement in force (empty when the authority names none), which the call saves, or the address in `status.terms`, which it does not save. The call then turns the listener on; a listener that runs asks for its certificate again. `409 terms-changed` for another `url`; `502 terms-unreachable` or `terms-unshown`; `500 save-failed`; `400 invalid` when the listener cannot start, with the acceptance already saved |
| `POST lan/start` / `POST lan/stop` | | the listener status; `lan/start` answers `400` until an agreement is accepted |
| `GET lan/qr.png` | | PNG of the running address, `404 lan-off` otherwise |
| `PUT start-at-login` | `{enabled}` | `204`; the login entry repeats the running copy's `--port` and `--data-dir` when they were given |
| `PUT language` | `{language}` | `204`; the language of the setup page and the tray menu. `400 invalid` for an unknown language |
| `POST sign-out-browsers` | | `204`; replaces every seal key and starts the identity service again, which disconnects Google Drive and the kept OpenRouter keys from every browser; nobody is signed out of the app |
| `POST wipe/google` | | `204`; forgets the Google client, then disconnects Google Drive and OpenRouter from every browser as above. `500 wipe-failed` keeps what was already done |
| `POST wipe/everything` | | `204`; also stops home-network access, forgets its name, settings and certificate, stops starting at login, and removes the seal keys rather than replacing them, so the system's store keeps nothing for this setup; the program's own port (the app's address) stays, and so does the token at deSEC |
| `POST updates/check` | | `{current, latest, url, newer, known}`; `404 no-release` when GitHub has none |
| `POST quit` | | `202`; the process stops |

`clientIdEnd` is the last four characters of the client ID before the
`.apps.googleusercontent.com` suffix that every client ID shares; the client
secret, the deSEC token and a deSEC password still kept are never answered.
