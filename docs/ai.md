# The AI assistant

How the assistant reaches its models and its web search, how to connect
OpenRouter and Ollama and what the OpenRouter key can and cannot do. The
assistant is optional: the app works without it. The list of what the
assistant does is in [features.md](features.md#ai-assistant).

## What leaves the device

The assistant runs in the browser. It assembles passages, the conversation
and the writer's instructions in the tab, against the writer's own files
([architecture.md](architecture.md#patterns)). The browser then calls each
service itself:

- **OpenRouter**, on the writer's own key, for remote models, the model
  catalogue and provider search. OpenRouter passes the request on to the
  model's vendor, and a search on to Exa, the engine behind its search tool.
- **Wikipedia**, with no key, for web search in the book's language.
- **Ollama** on this computer, over loopback, for a local model.

A local Ollama model sends nothing off the machine. A web search is the one
exception: when the writer approves a search, that query goes to Wikipedia or
OpenRouter, so a local chat that searches is not offline for that search.

### Routing at OpenRouter

Every chat and every provider search asks OpenRouter to route only to model
hosts whose stated policy is not to store the text or train on it
(`provider.data_collection: deny`). A model that no such host serves fails
instead of falling back to another host.

This is a routing request, not a zero-retention guarantee. The request does
not ask for zero data retention (`zdr`). OpenRouter's, the model vendor's and
the search provider's own terms still apply to what they receive.

The app sends the product title as attribution. It does not add the
installation's origin as an `HTTP-Referer`. Browser network metadata can
still identify an origin.

The privacy notice in the app (`/privacy`) states these flows for users.

## OpenRouter

### Connect a key

1. Create an account at <https://openrouter.ai> and add credit.
2. In the app, open **Settings** › **Set up your AI** and click **Connect**.
3. OpenRouter asks you to approve a key on your own account. Set a spend
   limit of $5 or less. A key with no limit, or with a higher one, is
   refused.
4. When the key is connected, the app asks whether this computer should
   remember it.

Settings then shows the limit and, when the key has one, its expiry. The
assistant's meter shows what has been spent.

### The key

- **Approval.** The approval is OAuth PKCE, run in the tab that asked. The
  verifier stays in that tab's memory. OpenRouter returns to
  `/app/connect/openrouter`, which hands the result to the tab and closes
  when the tab confirms it. A closed window or a 10-minute timeout cancels
  the approval. A result that arrives after a sign-out or an account switch is
  dropped, and nothing is stored.
- **Acceptance.** A key is accepted only with a spend limit of at most $5
  set at OpenRouter, and never as a management key. No expiry is required:
  the limit is what bounds a copy of the key. A limit can renew each day,
  week or month. It then allows that much again in every period, and
  Settings names the period beside the limit.
- **Custody.** The key lives in the platform's vault for the open account.
  By default it stays in the tab's memory. If the writer chooses to remember
  it, the identity service seals it into its own `HttpOnly` cookie, which it
  opens only for the account's session
  ([identity-contract.md](identity-contract.md#kept-credentials)). Nothing is
  kept in the app's own browser storage. Where the identity service does not
  answer, the key can only stay in the tab, and the settings pane says so.
- **The check before each request.** The app reads the key's verdict from
  OpenRouter again when the last reading is older than 60 seconds, or when
  it comes from a spend window that has ended. It refuses an expired or
  spent key before anything is sent. This check also counts spend billed to
  the writer's own provider keys at OpenRouter, which OpenRouter can leave
  out of the limit.

A remembered key protects a browser profile that is copied or stolen away
from the computer that runs the identity service: without that service's
keyring, the cookie opens nothing. Replacing the seal keys forgets every kept
key at once. A remembered key does not protect against:

- someone who uses this browser profile, or a script in the page, while the
  app is open, since either can ask the service to open the key;
- a backup or disk image of the computer that runs the service, together
  with the person's login password, or alone where that computer has no
  password store;
- a copied profile of a home-network device, with its session proof,
  replayed on that network while the service runs.

A copied cookie opens until the seal keys are replaced. The spend limit set
at OpenRouter bounds all of these, in each period of the limit. Spend billed
to the writer's own provider keys counts against that limit only when the
key includes it.

## Web search

The writer approves each search, and may edit the exact query first. Only
that query leaves the device. Results reach the model as data, never as
instructions.

- **Wikipedia** is always available, with no key. The app calls MediaWiki's
  search on the Wikipedia of the book's language, with the `Api-User-Agent`
  header that Wikimedia asks for. A `429` answer opens a breaker in that tab
  for as long as Wikimedia asks, usually 60 seconds. There is no server, so
  there is no shared limit across tabs.
- **OpenRouter's search tool**, with Exa as its engine, is used when the
  writer has a ready key and the chat's model is an OpenRouter model. The
  search runs on that model: the code names no model of its own. A chat on a
  local model, or on a model whose identifier has a `:` variant or an `@`,
  searches Wikipedia. The app sends the approved query as the only user
  message, with the `openrouter:web_search` server tool and at most one search
  per approval, so the query reaches OpenRouter, the model's vendor and Exa.
  The model may reword the query for the search engine, and the approval text
  says so. The cost of the search is reported.

A provider search that did not search fails, and Wikipedia is asked instead.

## How the OpenRouter and Wikipedia adapters behave

These points matter to anyone who changes the adapters in `web/src/ai/`. The
key, its approval and its check live in
`web/src/ai/host/openrouterConnection.ts`, which hands the key to the
adapters.

- **No concurrency lock.** Two tabs can spend in parallel. Each is bounded by
  the key's own limit, as OpenRouter enforces it. The check before each
  request is a check, not a guarantee.
- **CORS hides most headers.** OpenRouter exposes only `X-Generation-Id`,
  `X-Provider-Name`, `request-id` and `cf-ray`. Wikimedia exposes none. So the
  rate-limit headers and `Retry-After` are read from the error body when they
  are there. For a free model, the key's remaining daily requests are read
  first.
- **A `402` reads the key once.** The answer is a spent limit when the key's
  own verdict says so, and exhausted credit otherwise.
- **A failed or empty catalogue read** answers an empty list, then waits
  30 seconds before it reads again. Only a non-empty list is kept. The
  catalogue is public, so a `401` or `403` on it is read again without the
  key.
- **Keepalives count as activity.** A vendor that only ever keeps the stream
  alive is stopped after 300 seconds per step.
- **Request bounds.** The body is at most 2,000,000 bytes, with at most 200
  messages. A larger request is refused before it is sent.
- **Header values are Latin-1 only.** The title header drops other
  characters, and `HTTP-Referer` keeps only the scheme, host, port and path.
- **Failure messages** from the adapters are fixed English sentences for
  logs. The assistant panel words every failure from its code.
- The Content-Security-Policy admits `https://openrouter.ai` and
  `https://*.wikipedia.org` for these paths (`web/src/security/csp.ts`).

## Ollama

The assistant can run on the writer's own Ollama, over loopback.

1. Install Ollama from <https://ollama.com> and start it. It listens on
   `http://localhost:11434` by default. Keep it there. Do not expose it on
   every network interface, and do not put it on the internet.
2. Download a model. For reviews, retrieval and evidence, choose a model with
   tool support. Plain chat works with a completion-only model, but reviews
   are refused, with a message that says the model cannot run them.
3. In the app, open **Settings** › **Set up your AI** › **Local AI models**
   and click **Test connection**. The app lists the installed local models
   and runs a small synthetic tool probe, with no project text. The probe
   labels the selected model *agent tools verified* or *chat only*.

The address is stored for each account on this device and is never written
to a project file. Only loopback addresses are accepted.

### Origins (CORS)

By default, Ollama accepts browser requests from `localhost` and `127.0.0.1`
on any port. The app at `http://localhost:47821`, and the dev server at
`http://localhost:5173`, therefore need no further setting. Ollama's
`OLLAMA_ORIGINS` setting adds further origins; the app needs none.

A phone or tablet on the home network cannot use the computer's Ollama: on a
phone, `localhost` is the phone itself.

### Cloud models

The app leaves out Ollama's cloud models and refuses them, because a
localhost address does not prove that inference is local. To make Ollama
itself refuse cloud models, set `OLLAMA_NO_CLOUD=1`.

### Checking a model

[CONTRIBUTING.md](../CONTRIBUTING.md#checks-that-ci-does-not-run) gives the
live protocol test and the evaluation runner that check a real Ollama.
