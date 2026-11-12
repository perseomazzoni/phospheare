# Trust boundaries

The security skills read this table. Each row is one trust boundary. It names
where untrusted data or a secret crosses the boundary and the doc section that
states its controls. It also names what a reviewer checks. Do not restate the
controls here. What is out of scope is in
[SECURITY.md](../../SECURITY.md#scope).

## Table

| Boundary | Entry points | Controls stated in | Reviewer checks |
| --- | --- | --- | --- |
| SPA origin | `web/src/security/csp.ts`, `web/src/security/trustedHtml.ts`, `web/src/security/csp.test.ts`; HTML sinks in `web/src/editor/assistant/AiTurn.tsx`, `web/src/editor/reference/ReferenceReader.tsx`, `web/src/editor/components/SnapshotPanel.tsx` | [architecture: security posture](../../docs/architecture.md#security-posture), [ai: adapters](../../docs/ai.md#how-the-openrouter-and-wikipedia-adapters-behave) | A new fetch target needs a `connect-src` entry in `csp.ts` and a case in `csp.test.ts`. Every `innerHTML`, `DOMParser` or `__html` goes through `trustedHtml.ts`. A new element or attribute in rendered markup goes into the `checkRendered` dialect. |
| Untrusted input | `web/src/editor/import/domain/limits.ts`, `web/src/editor/import/adapters/zip.ts`, `web/src/editor/import/adapters/readers/`, `web/src/editor/import/domain/sniff.ts`, `web/src/editor/engine/domain/limits.ts`, `web/src/editor/engine/adapters/browserHtml.ts`, `web/src/editor/components/safeMarkdown.ts`, `web/src/editor/reference/referenceTemplates.ts`, `web/src/ai/adapters/chatCodec.ts`, `web/src/editor/assistant/projectAdapter.ts` | [architecture: security posture](../../docs/architecture.md#security-posture), [features: import and export](../../docs/features.md#import-and-export), [ai: web search](../../docs/ai.md#web-search) | A new reader enforces the caps in `limits.ts` before it inflates or parses. Paste stays on the allow-list parser, and its caps refuse before parsing. Raw HTML stays off in `safeMarkdown.ts`. A reference file, an imported file, a chat or review file in the project folder and a model answer are attacker input. Each parser checks a byte cap before `JSON.parse`. |
| Identity service | `identity/cmd/identity/main.go`, `identity/adapters/httpapi/server.go`, `routes.go`, `ratelimit.go`, `credentials.go`, `callback.go`; `identity/adapters/problem/problem.go`; `identity/adapters/seal/seal.go`; on the SPA side `web/src/platform/identityPlatform.ts`, `identityProof.ts` | [contract: rules for every route](../../docs/identity-contract.md#rules-for-every-route), [cookies](../../docs/identity-contract.md#cookies), [rate limit](../../docs/identity-contract.md#rate-limit), [guard and Host check](../../docs/identity-contract.md#guard-host-check-headers), [problems](../../docs/identity-contract.md#problem-statuses), [identity: at run time](../../identity/README.md#at-run-time) | A new route that is not GET sits behind the guard. A route that uses the session requires the proof header. A refusal is an RFC 9457 problem with a code from the contract table. Nothing logs a query, code, token, cookie or email. |
| Google | `identity/application/flows.go`, `identity/application/connections.go`, `identity/domain/google.go`, `identity/domain/idtoken.go`, `identity/adapters/google/client.go`; `web/src/storage/useDriveConnection.ts`, `web/src/storage/driveToken.ts`, `web/src/writers/application/deleteAccount.ts` | [architecture: accounts, sessions and connections](../../docs/architecture.md#accounts-sessions-and-connections), [contract: flows](../../docs/identity-contract.md#flows), [token and disconnect](../../docs/identity-contract.md#token-and-disconnect) | The scopes stay `drive.file` and `drive.appdata`. `finish` verifies `sub` before it stores anything. A flow is bound to the session that started it. Only writer account deletion and disconnect from every device send `revoke: true`. |
| OpenRouter | `web/src/ai/adapters/openrouterAuth.ts`, `web/src/ai/host/openrouterConnection.ts`, `web/src/ai/domain/openrouterKey.ts`, `web/src/ai/adapters/openrouterRequest.ts`, `web/src/ai/adapters/directSearch.ts`, `web/src/ai/application/searchAsk.ts`, `web/src/platform/identityVault.ts` | [ai: the key](../../docs/ai.md#the-key), [routing](../../docs/ai.md#routing-at-openrouter), [web search](../../docs/ai.md#web-search), [contract: kept credentials](../../docs/identity-contract.md#kept-credentials) | Every request carries `provider.data_collection: "deny"`. A key above the limit, without a limit or with management rights is refused. The key is never written to the app's own storage. No search runs without the writer's approval of the exact query. |
| Ollama | `web/src/ai/adapters/ollama.ts`, `web/src/ai/settings.ts` | [ai: Ollama](../../docs/ai.md#ollama), [cloud models](../../docs/ai.md#cloud-models), [origins](../../docs/ai.md#origins-cors) | Only loopback addresses are accepted, and `csp.test.ts` admits each address that `normalizeOllamaEndpoint` returns. Cloud models stay refused. The address is never written to a project file. |
| Desktop program | `desktop/internal/adapters/front/front.go`, `instance/claim.go`, `admin/admin.go`, `vault/`, `identityproc/supervisor.go`, `configfile/store.go`, `certs/acme.go`, `desec/`; `desktop/internal/application/lan.go` | [architecture: how the desktop program runs](../../docs/architecture.md#how-once-dark-studio-desktop-runs), [contract: setup page API](../../docs/identity-contract.md#setup-page-api), [desktop: running](../../desktop/README.md#running), [home network](../../docs/home-network.md#why-a-name-and-a-certificate) | A new setup call requires the setup key and a loopback `Host`. Every `/desktop/*` path is a 404 on the home-network listener. No saved secret goes in the environment, `config.json` or an API answer. One answer is an exception: `POST lan/name/password` returns a new deSEC password that nothing keeps. The identity service gets its secrets on stdin, binds loopback only and reports the address that it bound to the supervisor. The supervisor never chooses the identity port by a probe. After a failed settings write, the store tries to put back each secret that it wrote. The error names a put-back that fails. The home network is HTTPS only. |
| Build and CI | `.github/workflows/ci.yml`, `codeql.yml`, `release.yml`; `tools/audit-lockfiles.mjs`, `tools/audit-exceptions.json`, `tools/check-licenses.mjs`, `tools/check-sarif.mjs`; `identity/boundaries_test.go`, `desktop/internal/boundaries_test.go` | [contributing: tests and gates](../../CONTRIBUTING.md#tests-and-gates), [what CI runs](../../CONTRIBUTING.md#what-ci-runs), [desktop: signing](../../desktop/README.md#signing) | A new action is pinned by SHA with a version comment. An audit exception has an advisory id, a reason and a date when it lapses. A CodeQL suppression has `// codeql[<rule>] <reason>` on the line above. |
| Demo build | `web/build/demoBoundary.ts`, `web/build/demoBuild.ts`, `web/vite.config.ts`, `web/src/demo/main.tsx`; the demo mode of `web/src/security/csp.ts` | [SECURITY: scope](../../SECURITY.md#scope), [contributing: what CI runs](../../CONTRIBUTING.md#what-ci-runs) | Do not widen a forbidden source; cut the import instead. The demo CSP connects only to its own origin. `npm --prefix web run build:demo` passes. |
| Browser storage | `web/src/profile/forgetAccount.ts`, `web/src/profile/purgeLatch.ts`, `web/src/storage/idb.ts`, `web/src/storage/handleStore.ts`, `web/src/webapp/shell/useSignOutFlow.ts` | [architecture: accounts](../../docs/architecture.md#accounts-sessions-and-connections), [where the manuscript lives](../../docs/architecture.md#where-the-manuscript-lives-and-where-it-does-not) | A new store for each writer account is keyed by the writer account id and purged by `purgeLocalData`. A stored name is neutral: it spells neither the working name nor the product name. No credential goes in browser storage. |

## Assets

- **Manuscript:** the folder that the writer chose, or the app folder in
  Remote Storage. See
  [where the manuscript lives](../../docs/architecture.md#where-the-manuscript-lives-and-where-it-does-not).
- **Google refresh token:** sealed in a cookie. See
  [cookies](../../docs/identity-contract.md#cookies).
- **OpenRouter key:** in tab memory, or sealed in a cookie when the writer
  keeps it. See [the key](../../docs/ai.md#the-key).
- **Session cookie and session proof:** see
  [rules for every route](../../docs/identity-contract.md#rules-for-every-route).
- **Setup key:** in the memory of the desktop program and in the URL fragment.
  See [setup page API](../../docs/identity-contract.md#setup-page-api).
- **Seal keyring, Google client secret, deSEC credentials, TLS keys:** in the
  system secret store, or in `secrets.json` in the data folder when the
  computer has none. See [running](../../desktop/README.md#running).
- **Release archives and checksums:** see
  [SECURITY: scope](../../SECURITY.md#scope).

## Local scanners

Run these from the repository root. The `verify` skill gives the Windows
notes.

```bash
npm run audit:lockfiles
npm run licenses:check
npm run headers:check
node --test tools/*.test.mjs
go -C identity run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
go -C desktop run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
go -C identity test -race ./...
go -C desktop test -race ./...
semgrep scan --config p/secrets --metrics=off --error     # if Semgrep is installed
node tools/check-sarif.mjs <report.sarif>
```

Without Go, run the two Go commands in the `golang:1.26` image as
`CONTRIBUTING.md` shows. actionlint, zizmor and CodeQL run in CI only.
