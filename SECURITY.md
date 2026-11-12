# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub's private reporting: open the repository's
[Security tab](https://github.com/perseomazzoni/phospheare/security) and choose
**Report a vulnerability**. Only the maintainer can see the report.

Please include:

- what an attacker can do, and what they need first (a writer profile, access
  to the device, a page open in the same browser, a position on the home
  network);
- the steps or a proof of concept that reproduce it;
- the commit or release you tested.

The maintainer reads every report and answers as soon as possible. This is a
project made in free time. Once the problem is confirmed, the fix is developed
in a private fork and released with a GitHub security advisory. You will be
credited in the advisory unless you prefer not to be.

## Which versions get fixes

Phospheare is pre-production. Fixes go into `main` and the next release; older
releases are not patched.

## Scope

In scope:

- the web app (`web/`), with or without the identity service;
- the identity service (`identity/`) and `once-dark-studio-desktop`
  (`desktop/`): Google sign-in, the cookies the identity service seals, the
  setup page, the home-network HTTPS listener and the update check;
- the files published on the repository's Releases page (the source code
  and the site archive) and their `SHA256SUMS`, and the archives that
  `desktop/build.sh` builds from that source code.

There is no hosted service to test. The public website serves static files
only: a page, and a demo build of the editor that keeps nothing and talks to
no service.
[docs/architecture.md](docs/architecture.md) describes the pieces and their
security posture.

Out of scope:

- the Vite dev server and `once-dark-studio-desktop --dev`, which are for
  development only;
- the Google Cloud project and OAuth client that the person who installs the
  app creates and supplies;
- vulnerabilities in third-party services such as Google, OpenRouter,
  Wikipedia or Ollama; report those to the vendors;
- reports from automated scanners with no demonstrated impact.
