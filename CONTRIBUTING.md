# Contributing to Phospheare

Thank you for wanting to help. Bug reports, fixes, tests, documentation and
translations are all welcome.

For anything larger than a small fix, please open an issue first and describe
what you want to change. Phospheare has firm design and architecture rules, and
agreeing on the approach before you write the code saves time for both of us.

To report a security problem, do not open an issue: follow
[SECURITY.md](SECURITY.md).

## Current priorities

1. **The setup, for everyone.** Make the install and the setup page's
   wizards as clear and simple as they can be. Anyone, technical or not, can
   then set the program up in a few steps and with little effort. The person
   on the setup page is not necessarily a developer. For a wizard
   (`desktop/internal/adapters/admin/`, with its words in
   `desktop/internal/adapters/words/`), that means:
   - plain words: a technical term appears only when the person must copy
     it or find it on another site, and one sentence says what it is for;
   - one step at a time, each saying what to do, where and how the person
     knows that it is done;
   - direct questions, and buttons that name what they do;
   - the exact values to copy, and links to the exact page of the other
     site;
   - a check of each step wherever the program can make one, and a clear
     word when the step worked;
   - a problem message that says what went wrong and what to do next, in
     the same plain words;
   - a person can stop and come back later without losing what they did.

   Test a change to a wizard by following it from start to end as someone
   who has never set the program up.

   Every time you work on a wizard, look at the whole of it again and
   simplify, ruthlessly, everything that can be simplified: remove a step
   the program can do by itself, a question it can answer by itself, a
   choice most people never need and any word the person does not need.
   When the program does a step by itself, tell the person what it did, in
   one plain sentence.

2. **Stabilization**: fixing bugs and making what exists reliable.

3. **The app on phones and tablets**: fix and polish the interface on small
   and touch screens. Every control fits the screen and is easy to reach
   with a finger, and no text or panel is cut off or hidden by the
   keyboard. Check a change in portrait and landscape, with the mobile
   [Playwright projects](#playwright-projects) and on a real device when
   you can.

After that, the work in view is:

- **The editor engine** (`web/src/editor/engine/`): improve the core that
  holds and edits the text.
- **The assistants**: review the AI assistants and make them more effective.
- **Faster, more reliable sorting**: the assistant sorts what a book names (a
  character, a place, a thing) and the facts it reads about them. A quick
  first pass, a "system 1", could make this faster and more reliable; its
  design is still open.
- **Reference documents**: a proper interface for writers to compile their
  reference documents.
- **To-do marks**: let writers leave to-do marks in the text.
- **Suggestions in the prose**: let the AI suggest changes directly in the
  text, for the writer to review and be inspired by them.

Before you start on one of these, open an issue: most of them need a design
agreed first.

## Good first contributions

- Issues labelled
  [good first issue](https://github.com/perseomazzoni/phospheare/labels/good%20first%20issue).
- A bug report with the steps to reproduce it, or a fix with a test that fails
  without it.
- A test for behaviour that has none. The pure modules in the `domain/`
  folders (for example `web/src/ai/domain/`) need no browser, so they are the
  easiest place to start.
- The documentation: follow [docs/install.md](docs/install.md) as a new user
  and report or fix any step that does not match the app.
- Accessibility problems, under the `accessibility` label.

The editor's chrome is the hardest place for a first patch;
[Reviews and merging](#reviews-and-merging) says why.

## Contents

- [Setting up](#setting-up)
- [Repository map](#repository-map)
- [Tests and gates](#tests-and-gates)
- [Rules the gates cannot fully check](#rules-the-gates-cannot-fully-check)
- [Pull request titles](#pull-request-titles)
- [Licence of contributions](#licence-of-contributions)
- [Reviews and merging](#reviews-and-merging)
- [Releasing](#releasing)

## Setting up

Phospheare is a single-page application (`web/`), the identity service
(`identity/`) and the desktop program (`desktop/`). Read
[docs/architecture.md](docs/architecture.md) for how the pieces fit together.

You need Node, in the version in [`.nvmrc`](.nvmrc). Go, in the version in
`identity/go.mod` and `desktop/go.mod`, builds the identity service and the
desktop program. If you do not have Go, use the `golang:1.26` Docker image.
The commands below work in bash and in PowerShell, from the repository root,
unless they say otherwise.

### The web app

```bash
npm ci
npm run dev
```

Vite serves the SPA on `:5173`. Open
<http://localhost:5173/app/editor/demo> for the full editor on a sample novel.
The sample is held in memory, so a reload starts it again. Its assistant
answers from ShAIne, a built-in demo model that gives fixed sample replies and
never uses the network.

The rest of the app is at <http://localhost:5173/app>. Continue without an
account and keep books in a folder on your computer. Without the identity
service, the app does not offer Google sign-in, and Remote Storage stays
unavailable. The next section adds them.

### With Google

Google sign-in and Remote Storage need an OAuth client from a Google Cloud
project of your own. The project ships none.

1. Create a Google Cloud project and a Web application client, as part 3 of
   [docs/install.md](docs/install.md) describes. Use
   `http://localhost:5173/identity/google/callback` as its redirect URI.
2. Copy `.env.example` to `.env`.
3. Fill in `IDENTITY_GOOGLE_CLIENT_ID` and `IDENTITY_GOOGLE_CLIENT_SECRET`. Use
   an editor for this, so the secret stays out of the shell's history.
4. Start the app:

   ```bash
   npm run dev:full
   ```

This starts the web app on `:5173` and the identity service behind it, in one
terminal. Each line is marked `[web]` or `[identity]`. Ctrl+C stops both. The
service runs with `go run` when Go is installed, and in the `golang:1.26`
Docker image otherwise. The first run compiles it and writes its keyring to
`identity/.keys/`.

- `npm run dev:identity` starts the service alone, for a web app that you
  started separately with `npm run dev`.
- `IDENTITY_PUBLIC_ORIGINS` and `IDENTITY_LISTEN` in `.env` change the two
  ports. The redirect URI changes with them.

To run the desktop program behind the Vite dev server instead, see
"Development" in [desktop/README.md](desktop/README.md#development).

For the assistant on a local Ollama or on OpenRouter, see
[docs/ai.md](docs/ai.md).

### Building the release

```bash
npm run build                      # the SPA, into web/dist
npm run notices                    # the third-party notices, into web/dist
sh desktop/build.sh                # needs Go; writes desktop/dist/*.zip and *.tar.gz
```

The build takes its version from `web/package.json`; `VERSION=1.2.0` before
a command overrides it. A production build checks GitHub for newer releases.

Without Go, run the same script in the `golang:1.26` image. From Git Bash:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/repo" -v phospheare-gomod:/go/pkg/mod \
  -w /repo golang:1.26 sh desktop/build.sh
```

From PowerShell:

```powershell
docker run --rm -v "${PWD}:/repo" -v phospheare-gomod:/go/pkg/mod `
  -w /repo golang:1.26 sh desktop/build.sh
```

[desktop/README.md](desktop/README.md#release-build) says what `build.sh`
writes and how it embeds the SPA.

## Repository map

```
web/                   the SPA
  src/editor/          the editor: its core (engine, views), the shell (components,
                       workspace), the assistant panel, the structure tree, the
                       reference panel, comments, export, import, henosis
  src/ai/              the assistant: domain, ports, adapters, application, host, eval
  src/webapp/          library, settings, the Google gate, public pages
  src/platform/        the platform port: the identity service's wire
  src/writers/         the installation's accounts, their Google identity and the writer session
  src/storage/         StorageProvider port, local, Drive, memory, mirrored, OPFS cache
  src/project/         project model and its sync
  src/projectSetup/    the new-project dialog and its fields
  src/profile/         the account's data: library, profile and its Drive copy
  src/preferences/     the writer's preferences
  src/release/         the notice of a new release
  src/demo/            the demo site's entry, and the build-time render of its text pages
  src/auth/            the open account, its state and the cross-tab session check
  src/fault/           what a failure leaves the writer with: error pages and reload policy
  src/log/             the app's log: its lines, their redaction, the store and the page
  src/legal/           the legal, privacy and terms pages; their facts (the date
                       the texts last changed, the author's details) in domain/facts.ts
  src/security/        the Content-Security-Policy and its Trusted Types policy
  src/theme/           the four typed themes: Matte, Radiant, Shine, Vision
  src/ui/              shared component kit and overlay layer
  src/brand/           the mark as components
  src/styles/          the base and frame sheets
  src/text/            shared text helpers
  src/locales/         en.json, it.json
  public/              icons, landing images, fonts and their licences
  e2e/                 Playwright specs
  scripts/             AI evaluation scripts (run by hand against real models),
                       the landing-page screenshots, the export matrix dump
identity/              the identity service (Go): sign-in, session, Drive tokens, kept keys
desktop/               once-dark-studio-desktop, the desktop program (Go)
.github/workflows/     CI (with CodeQL), the release build, the site deployment
tools/                 notices, licence and header checks, CSS order check, lockfile
                       audit, SARIF check, changelog (git-cliff), Go module licences,
                       the files-only server for the demo site's suite, dev-wizard.mjs
                       (npm run dev:wizard)
docs/                  architecture, internals, features, the identity contract,
                       the install guide, the home-network guide, the AI guide
docs/brand/            logo assets
docs/images/           the README's picture
AGENTS.md, CLAUDE.md   directions for coding agents; .claude/ holds their skills,
                       references, hooks and settings, .opencode/ the OpenCode
                       commands
GLOSSARY.md            the vocabulary of accounts, sessions and connections,
                       and the code's own words (lane, latch, station, spine...)
product.json           the public product name
LICENSE                GNU AGPLv3; each build lists the dependencies' licences
```

## Tests and gates

Start with the checks for the area being changed. Record the commands and
results in the pull request, including any check that could not run. Give
each result one evidence label:

- **Automated**: a test in this repository. Fakes replace Google,
  OpenRouter and the operating system.
- **Packaged smoke**: a run against a built release archive.
- **Probed live**: a real request to the real service.
- **Not verified**: not established. Say why, and give the smallest step that
  would establish it.

A mocked callback, a simulated expiry or a successful build is never proof
that the real service works.

| Change                                 | Local verification                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Documentation                          | Check links, commands and consistency with the implementation.                                                                  |
| Web behaviour                          | Run the affected suites with `npm --prefix web test -- src/path/example.test.ts`; run web lint and the build before submitting. |
| Layout, themes or browser interactions | Add the relevant Playwright specs and device profiles to the affected web tests.                                                |
| Go code                                | Run formatting, vet and race tests in each affected module, as below.                                                           |
| Tools or workflows                     | Run `node --test tools/*.test.mjs`; validate any changed build commands locally.                                                |

CI runs the full gates on every pull request. For a broad refactor or a full
local pre-merge run, use the commands below. The coverage command includes the
unit suite, so a separate `npm test` run is unnecessary in that case.

```bash
npm ci
npm --prefix web run build                       # typecheck (app and scripts) + production build
npm --prefix web run test:coverage               # web unit suite and coverage floor
npm --prefix web run lint                        # ESLint, zero warnings
npm --prefix web run format:check                # Prettier
npm --prefix web exec -- playwright install chromium webkit   # once
npm --prefix web run test:e2e -- --project=desktop            # the desktop run, on Chromium
npm run headers:check                            # every source file opens with the licence header
npm run licenses:check                           # every dependency's licence is on the allow-list
npm run audit:lockfiles                          # npm audit over every lockfile
node --test tools/*.test.mjs                     # the tools and the workflows' scripts
```

The tools' tests run the workflows' scripts in `bash`. On Windows that must be
Git Bash: if `bash` on your `PATH` is WSL's (`C:\Windows\System32\bash.exe`),
the tests fail. From PowerShell, put Git Bash first for that run:

```powershell
$env:PATH = "C:\Program Files\Git\bin;$env:PATH"; node --test tools/*.test.mjs
```

If you changed the Go code, run these checks in `identity/` and in `desktop/`:

```bash
test -z "$(gofmt -l .)"           # fails when a file is not formatted
go vet ./...
go test -race ./...
```

Without Go, run the same checks for both modules in the `golang:1.26` image.
The desktop module reads `../identity`, so mount the whole repository. From
Git Bash:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/repo" -v phospheare-gomod:/go/pkg/mod \
  -w /repo golang:1.26 sh -c 'for m in identity desktop; do (cd $m && test -z "$(gofmt -l .)" && go vet ./... && go test -race ./...) || exit 1; done'
```

From PowerShell:

```powershell
docker run --rm -v "${PWD}:/repo" -v phospheare-gomod:/go/pkg/mod `
  -w /repo golang:1.26 sh -c 'for m in identity desktop; do (cd $m && test -z "$(gofmt -l .)" && go vet ./... && go test -race ./...) || exit 1; done'
```

### Playwright projects

Playwright runs seven projects: `desktop` on Chromium, and six mobile profiles
(three phones, a tablet and two phones in landscape). Five of them use WebKit
device presets, so WebKit is installed too. The Pixel 7 profile runs on
Chromium. Name a project with `--project` to run it alone. CI runs `desktop`,
`iphone-14-pro` and `pixel-7`; the remaining profiles run before a release.
The Pixel profile emulates size and touch, without a real Android keyboard.

### Checks that CI does not run

Run these by hand when you change the code they cover.

- **The certificate source against Pebble**, Let's Encrypt's test authority.
  The test runs only when two variables are set. From Git Bash:

  ```bash
  docker network create phospheare-pebble
  docker run -d --rm --name phospheare-challtestsrv --network phospheare-pebble \
    ghcr.io/letsencrypt/pebble-challtestsrv:latest \
    -management :8055 -dnsserver :8053 -http01 "" -https01 "" -tlsalpn01 "" -doh ""
  docker run -d --rm --name phospheare-pebble --network phospheare-pebble \
    -e PEBBLE_VA_NOSLEEP=1 -e PEBBLE_WFE_NONCEREJECT=0 \
    ghcr.io/letsencrypt/pebble:latest \
    -config /test/config/pebble-config.json -dnsserver phospheare-challtestsrv:8053
  MSYS_NO_PATHCONV=1 docker run --rm --network phospheare-pebble \
    -e PHOSPHEARE_PEBBLE_DIRECTORY=https://phospheare-pebble:14000/dir \
    -e PHOSPHEARE_CHALLTESTSRV=http://phospheare-challtestsrv:8055 \
    -v "$PWD:/repo" -v phospheare-gomod:/go/pkg/mod -w /repo/desktop golang:1.26 \
    go test -run Pebble -v ./internal/adapters/certs/
  docker stop phospheare-pebble phospheare-challtestsrv && docker network rm phospheare-pebble
  ```

- **The setup page, by hand.** This runs the desktop program against
  stand-ins for Google, deSEC and Let's Encrypt. You need no account, no
  email and no real certificate. It needs Go and Docker running:

  ```bash
  npm run dev:wizard
  ```

  - The program prints the setup page's address.
  - The control page of `desktop/cmd/fake-services` gives the Google test
    client, chooses what Google answers and clicks the link of deSEC's
    email.
  - The setup page's links to Google Cloud Console open local pages. Each
    step that needs an action outside the page says what to do.
  - The script builds the program and the identity service with the
    `devfake` tag and the address of the stand-ins, so the release binaries
    hold none of that code. CI checks this.
  - Each run starts from an empty data folder and keeps its secrets in a
    file, apart from your own copy of the program. Ctrl+C stops it and
    removes the containers and its folder.
  - A phone cannot open the home address in this mode.

- **The Ollama protocol against a real Ollama.** The browser specs in
  `web/e2e/ai-assistant.spec.ts` replace Ollama with synthetic responses. They
  prove the wiring, not real model behaviour or loopback CORS. This test talks
  to your own Ollama and checks the model list, the capabilities, the
  synthetic tool probe and a native tool round trip. From `web/`, in bash:

  ```bash
  PHOSPHEARE_OLLAMA_LIVE=1 npx vitest run src/ai/adapters/ollama.live.test.ts
  ```

- **The AI evaluation runners** in `web/scripts/` run labelled synthetic cases
  in English and Italian against a real model, and write a report with
  latency and token counts. For example, from `web/`:

  ```bash
  node scripts/ai-eval.mjs --model <id> [--lang en,it] [--out report.json]
  ```

  The address comes from `PHOSPHEARE_OLLAMA_URL` (default
  `http://localhost:11434`). The results are evidence, not a gate.

### What CI runs

CI (`.github/workflows/ci.yml`) runs the gates on each pull request:

- for the web app: the typecheck and build, the unit suite with coverage,
  lint, format and the Playwright runs;
- for the identity service and the desktop program: gofmt, go vet,
  govulncheck and the Go tests with the race detector;
- for the repository: the licence allow-list, the header check, the tools'
  own tests, `npm audit` over every lockfile and the workflow linters
  (actionlint, zizmor);
- Semgrep's secrets rules, without an account or a custom image, while the
  repository has no native GitHub secret scanning;
- CodeQL over the TypeScript, the Go and the workflows.

The jobs run in two stages. The browser suites start only when every fast
check has passed (web, identity, desktop and repository), so a cheap failure
stops the expensive jobs. The demo site's boundary build is one of the fast
checks. The one required verdict, "Required checks" (`ci-ok`), waits for
every job. The same CI workflow runs weekly on
`main` to detect newly published advisories and query findings.

## Rules the gates cannot fully check

- **No migrations.** The project has no production data yet. To change a
  stored shape (a storage key, the fields of a record, the on-disk format),
  change it directly. Write no code that adopts, converts or tolerates the
  old shape. Let old local data break.
- **Coverage changes are explained.** A pull request that changes the floor
  in `web/vite.config.ts` says why, and the review checks it. A new floor must
  keep meaningful assurance for important behaviour, and it never changes
  only to make a run pass.
- **Tests change with their behaviour.** When behaviour changes, change or
  delete its tests in the same pull request. When code is removed, its tests
  go with it. Skip a test only for a short time: the skip message names an
  open issue and a date to review the skip.
- **A test fails when its behaviour breaks.** Before you rely on a test,
  break the code it protects for a moment and check that the test fails.
  A good test:
  - checks what a user or a caller can see, not one way to write the code,
    so an equivalent selector, spelling or rule order still passes; it
    checks results, not the exact calls made inside;
  - cannot pass by checking nothing: when it searches files or rules, it
    also fails if the search finds none;
  - waits for a signal or a condition, never a fixed time, and proves that
    something did not happen by letting something else finish first;
  - sets the clock it reads, and does not fail on a slow machine;
  - passes alone or in any order, and leaves no timers or work running into
    the next test;
  - names what broke when it fails, such as the file and line of a bad
    import;
  - says what it does not cover when its name could promise more.

  A number that is a budget, not a measurement, says so in its test.

- **Hexagonal modules, where they pay.** A module's rules live in pure
  functions that import no React, DOM or storage, and its boundary tests fail
  on an illegal import. Add a port only when it isolates a second real
  adapter, a slow or volatile outside dependency, or a trust boundary.
  Otherwise pass the concrete dependency (`StorageProvider`, for example, is
  already a port) and add no `ports/` or `adapters/` folder.
- **A feature's layout lives beside it.** `web/src/editor/editor.css` keeps
  the frame's geometry and the rules several features share; a feature's own
  layout goes in a sheet in the feature's folder, such as
  `web/src/editor/assistant/assistant.css`, imported by
  `web/src/editor/frame.css` after `editor.css`. When you change a section of
  `editor.css` that belongs to one feature, move it to that feature's sheet in
  its own commit. The sheets share one cascade layer, so a move can change
  which of two rules wins: run `tools/check-css-order.mjs`, as its header
  shows, and examine each pair it reports.
- **A theme hides nothing.** A theme restyles every control of the app. It
  never hides one, even when its design leaves the control out.
- **Split a component when you work in it.** A long component is split
  when a change needs it, not ahead of time. Each part gives a maintainer one
  complete responsibility they can understand without reading the others;
  a part that only moves lines and needs its parent to make sense stays in
  the parent. A file's length is a reason to look at it, never automatically
  a reason to split it. Before you split, check that:
  - you can name the part's responsibility without listing unrelated jobs;
  - it owns the state, rules and transitions that responsibility needs;
  - callers can use it without knowing how it works inside;
  - its inside can change without edits to the files around it;
  - a change needs less reading afterwards, not more.

  A helper with one caller lives beside that caller.

- **A custom hook serves one concrete use case.** These are the principles of
  React's guide,
  [keep your custom hooks focused on concrete high-level use cases](https://react.dev/learn/reusing-logic-with-custom-hooks#keep-your-custom-hooks-focused-on-concrete-high-level-use-cases):
  - Name a hook after what it does for its caller, such as `useWorkspaceSave`
    or `useBarPanels`, so that someone who reads the name can guess
    what it takes and what it returns.
  - Do not write lifecycle wrappers such as `useMount` or `useEffectOnce`:
    they hide what an effect is for and work against the rules React checks.
  - A good hook limits what its callers can do. It returns actions that keep
    its rules, such as `openFind()`, not raw setters that let a caller break
    them.
  - A hook shares logic, not state: each call has its own state. Extract one
    only when it gives a use case a name, not for every repeated line.
- **Test helpers end in `.fixture.ts`.** A fake, a sample document or a
  suite that several test files share is named `*.fixture.ts` and sits
  beside the code it serves. The coverage count leaves it out, as it does
  the tests.
- **A failure leaves a line in the log.** The app keeps its log in the
  browser (`web/src/log`). The desktop program writes its own log and the
  identity service's to files (`desktop/internal/adapters/logs`).
  [Internals](docs/internals.md#the-apps-log) says how the app keeps it.
  - When code catches a real failure, it writes one line: `warn` when the
    work goes on, `error` when the writer loses something or the work
    stops. The line names its area, says what happened in one sentence and
    carries the failure with its stack (`describeError` in the app).
  - A catch that answers an expected case writes nothing, such as an
    optional file that is not there or a feature test.
  - An `info` line marks a step that explains a later failure, such as a
    page or a project that opens.
  - A line holds no personal data. It names no person, no email or network
    address, title, file or folder name, path or URL. It holds no
    manuscript or chat text, prompt, query, key or token. The writer
    account id is the only exception. The redaction in each log is a safety
    net behind this rule, not a way around it.
  - Nothing sends a log by itself.
- **Interface text in both languages.** A new string goes in both
  `web/src/locales/en.json` and `web/src/locales/it.json`. The desktop
  program's setup page and tray menu keep theirs in
  `desktop/internal/adapters/words/`. If you do not write Italian, say so in
  the pull request, and the maintainer will write it.
- **The product name.** Interface text writes `{{product}}` and never the
  working name. Guard tests enforce this. See
  [The product name](#the-product-name).
- **New dependencies** must use a permissive licence (MIT, Apache-2.0, BSD,
  ISC or similar). `npm run licenses:check` enforces it. A new Go module also
  needs its licence recorded in `tools/go-modules.mjs`, after you have read
  the module's `LICENSE`. The third-party notices are generated for each
  release, so there is nothing to commit.
- **New source files** open with the licence header (the copyright line, the
  SPDX identifier and a pointer to `LICENSE`). `npm run headers:fix` writes
  it, and `npm run headers:check` enforces it.

### Writing documentation

Technical documentation uses a form of
[ASD-STE100 Simplified Technical English](https://www.asd-ste100.org/), so
that text from people and from AI agents is clear to technical readers. This
applies to `docs/`, `CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, the text
under `.claude/` and every `README.md` except the root one. The root
`README.md` speaks to writers first, so it keeps its own voice.

- One word has one meaning. The same thing has the same name everywhere, and
  `GLOSSARY.md` decides the name. Use the simplest word: "use", not
  "utilize"; "start", not "initiate".
- An instruction has 20 words or fewer. A descriptive sentence has 25 words
  or fewer. Write one instruction or one topic in each sentence.
- Use the active voice and the simple tenses. Do not use an "-ing" form as
  the verb. Write instructions in the imperative.
- Keep "the", "a", "is" and "are". Do not omit them to make a sentence
  shorter.
- A paragraph has one topic and six sentences or fewer. Put the result first,
  then the details. Put a condition before its instruction, and a warning
  before the step it applies to.
- Put steps and parallel items in a list. Keep a line of argument in prose.
- Do not use idioms, metaphors, slang, humour or filler.
- Use British spelling with the Oxford "-ize", no serial comma, sentence-case
  headings and the present tense.
- Say each fact in one place, and link to it from the other pages.
  `AGENTS.md` may repeat the commands that agents run most.
- Add to the docs only the lines that state what is now true. Add no plan,
  study or decision record to the repository.
- Do not tell the history of a change. Do not use tracker IDs or phase
  numbers, in the docs or in commit messages.

The `tech-docs` skill applies these rules and checks a page against them.

### Code comments

- A comment states what the code cannot say: an invariant, a constraint, or
  the decision behind a shape. It never tells the story of how the code came
  to be; git holds that.
- Keep what prevents a plausible mistake; dismiss what the names and the
  implementation already say. A familiar icon or a simple choice needs no
  explanation.
- Present tense, neutral, no "we" or "you", no emphasis (no capitals, no bold).
- No issue or tracker IDs: state the reason in words.
- No `TODO` or `FIXME`: open an issue instead.
- No commented-out code.
- Write a docblock only where the type does not state the contract. Use
  `@param` and `@returns` only for a unit, a range or the meaning of `null`.
- In a file with two or more sections, a banner `// ── Title ──` filled with
  `─` to column 80 starts each section. The title has six words or fewer.
- Directive comments (`eslint-disable-next-line`, `@ts-expect-error`,
  `prettier-ignore`, `@vitest-environment`) are code. Do not reword them.

### The product name

**Phospheare** is the project's internal name. It names the repository, the
packages, the modules, the code and the developer documentation.

The product's public name is what writers see: the logo, the interface text,
the exported files, the About pane, the release artifacts and the install
guide, which is written for them. It lives in one place,
[`product.json`](product.json), and no source file spells it out:
interface text writes `{{product}}`, SPA code imports `PRODUCT`, the Go builds
take it with `-X main.productName=...` (see
[desktop/README.md](desktop/README.md)) and the tools read the file. Guard
tests fail the build if any shipped string contains the working name. To
rename the product, edit `product.json` and rebuild. The desktop program
carries the public name in its binary file name, `once-dark-studio-desktop`.
`product.json` also holds `site`, the origin of the public site. The demo
build writes it into the canonical link of each text page and into
`sitemap.xml`.

Everything the browser stores (storage keys, the IndexedDB database, channel
names) has a neutral name that uses neither the working name nor the product
name, and the identity service's cookies carry a fixed `phospheare_` prefix.
Renaming the product therefore never signs anyone out or orphans their
browser data.

## Pull request titles

Pull requests are squash-merged. The title becomes the commit on `main` and
a line in the release notes, which git-cliff writes in its default
configuration. Write it as a
[Conventional Commit](https://www.conventionalcommits.org/): a type, an
optional scope, a colon, then one short imperative sentence with no full
stop:

```
feat: carry review comments from odt files into the margin
fix(editor): keep the save chip steady while the command bar folds
docs: explain the home network setup
```

The type chooses the section of the release notes: `feat` (Features), `fix`
(Bug Fixes), `perf`, `refactor`, `style`, `test`, `docs`, and `chore` or
`ci` (Miscellaneous Tasks). A title in another form is left out of the
notes, and `chore(deps)` is left out too.

## Licence of contributions

When you open a pull request, you confirm that you wrote the change, or
otherwise have the right to submit it, and you license it under the
[GNU AGPL v3 or later](LICENSE), the same licence as the rest of the project.

## Reviews and merging

The maintainer reviews pull requests. Your diff is reviewed and merged as
you wrote it: review comments ask you for changes, and no agent writes the
change again in your place. When the checks are green and the review is
approved, the maintainer squash-merges it. A release is a version tag on
`main`, so a merged change reaches writers in the next release, not
immediately.

The editor's chrome is the hardest place for a first patch: `EditorRoute`,
`Library` and `AiPanel` are long components, `web/src/editor/editor.css`
lays out most of the editor, and the theme sheets in `web/src/theme/themes/`
paint every control: `shared.css` holds the paint all four themes share, and
each theme's own sheet holds what differs. A control added to the editor is
placed once, painted in `shared.css` and given its own look in a theme sheet
only where that theme departs; `sheets.test.ts` tells placing from painting.
Open a pull request there as a draft and ask for the maintainer in the review
from the start, so the change lands where the maintainer would have put it.

## Releasing

A release is a version tag and its page on the repository's Releases page.
The page holds no program: writers download the tag's source code and build
it, as "Quickstart, for everyone" in the [README](README.md) says. When you
publish a release that is not a pre-release, its site goes to GitHub Pages.

1. **Pick the commit**: one on `main` whose **Required checks** passed. To
   read the notes since the last release before you choose the version:

   ```bash
   npm ci --prefix tools/changelog
   tools/changelog/node_modules/.bin/git-cliff --unreleased --tag-pattern '^v[0-9]+\.[0-9]+\.[0-9]+$'
   ```

   The pattern counts only release tags, as the Release workflow does, so
   the notes hold everything since the last release.

2. **Run every device profile** on that commit, against the E2E build. CI
   runs only some of them ([Playwright projects](#playwright-projects) says
   which).

   ```bash
   npm --prefix web run build:e2e
   E2E_BUILD=1 npm --prefix web run test:e2e
   ```

3. **Set the version** in both `package.json` files and the lockfile, and
   merge that change into `main` like any other. A writer's build of the
   tag's source code reads its version from there.

   ```bash
   npm version 1.2.0 --workspaces --include-workspace-root --no-git-tag-version
   ```

4. **Tag it** and push the tag. A tag with a suffix, such as
   `v1.2.0-beta.1`, becomes a pre-release.

   ```bash
   git tag -a v1.2.0 -m "v1.2.0" <commit>
   git push origin v1.2.0
   ```

5. **The Release workflow** runs on the tag. It first checks that the tag's
   commit is on `main`, that CI passed on it and that both `package.json`
   files carry the tag's version, and stops otherwise. It
   then builds the app once, packs `once-dark-studio-desktop` for Windows,
   macOS and Linux, starts each archive on its own platform as a smoke test
   (`tools/smoke-desktop.mjs`), drives the Linux one in Chromium
   (`web/e2e/release-smoke.spec.ts`). It also builds the site into
   `site-<version>.tar.gz` and runs the demo site's suite on that archive,
   served as files only (`tools/serve-site.mjs`). When all pass, it drafts a
   release with the tag's source code as `once-dark-studio-source.zip` (the
   README links the newest one), the site archive, their `SHA256SUMS` and
   release notes written by git-cliff. The desktop archives are never
   attached, and the run deletes them when it ends. To build the draft
   again, run the whole workflow from the Actions tab with the tag, not its
   failed jobs alone.
6. **Publish the draft** after you have checked its files. Installed copies of
   `once-dark-studio-desktop` see the update only after that. For a release
   that is not a pre-release, the Site workflow then checks the site archive
   against `SHA256SUMS` and deploys it to GitHub Pages. If the deployment
   fails, run the failed jobs again from the run's page.
