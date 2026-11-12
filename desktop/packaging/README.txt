@PRODUCT@ @VERSION@
===================

@PRODUCT@ is a writing tool that runs in your web browser. This
folder holds the small program that serves it from your own computer. You
built it from the source code. Nothing is sent to a server run by the author
of the program.


Start
-----

Windows: double-click once-dark-studio-desktop.exe. If Windows shows
"Windows protected your PC", choose "More info", then "Run anyway".

macOS: double-click once-dark-studio-desktop. If macOS says the developer
cannot be verified, open System Settings, Privacy & Security, and choose
"Open Anyway" next to once-dark-studio-desktop, then double-click it again.

Linux: run ./once-dark-studio-desktop in a terminal.

The folder also holds identity.exe (identity on macOS and Linux), the
sign-in service the program starts and stops by itself. Keep the two files
together. On macOS, if identity is blocked the first time, allow it the
same way.

Your browser opens at http://localhost:47821/app. On Windows, and on most
Linux desktops, the @PRODUCT@ icon appears in the tray beside the clock;
its menu opens @PRODUCT@ and its setup page. Windows may put a new icon
among the hidden ones, under the arrow; drag it out to keep it in sight. On
macOS, and on Linux without a tray, a window shows the address of @PRODUCT@
instead. You can write straight away; to connect Google, open the setup
page from the tray menu or, where there is no tray, at the Setup address
that window shows. That address works only while this copy of @PRODUCT@
runs; after a restart, open it again from the menu or the window.


Stop
----

Choose "Quit @PRODUCT@" in the tray icon's menu or on the setup page. Where
@PRODUCT@ runs in a window, closing that window stops it too.


Where your data is
------------------

Your writing stays in your browser, in the folders you choose on this
computer, or in your Google Drive. The program's own settings are in:

  Windows: %APPDATA%\once-dark-studio-desktop
  macOS:   ~/Library/Application Support/once-dark-studio-desktop
  Linux:   ~/.config/once-dark-studio-desktop

Keep the address http://localhost:47821 the same: the browser keeps your
work per address.


What the program itself contacts
--------------------------------

Besides what the app's privacy notice lists, the program contacts:

- GitHub, only when you click "Check" under "Updates" on the setup page, to
  read the latest release.
- For the home network, only if you set it up: deSEC (desec.io), a
  non-profit DNS service in Berlin, which receives your email address when
  it creates your account and publishes the chosen name with this
  computer's home-network address (your writing never passes through
  deSEC), and Let's Encrypt, which issues the certificate; issued names are
  published in Certificate Transparency logs. The setup page asks you to
  accept deSEC's terms of use (desec.io/terms) before it creates the
  account, and Let's Encrypt's subscriber agreement
  (letsencrypt.org/repository) before it asks for the first certificate.


Guide
-----

The full installation guide, with every Google step:
https://github.com/perseomazzoni/phospheare/blob/v@VERSION@/docs/install.md

@PRODUCT@ is free software under the GNU Affero General Public
License, version 3 or later; the full text is in LICENSE. It is free of
charge: it's a project open to everyone and not for profit.

Corresponding Source for release v@VERSION@:
https://github.com/perseomazzoni/phospheare/tree/v@VERSION@
Source archive:
https://github.com/perseomazzoni/phospheare/archive/refs/tags/v@VERSION@.tar.gz
The build steps for everyone are in README.md ("Quickstart") at that tag; the
developer documents are CONTRIBUTING.md and desktop/README.md. A development
build corresponds to the source checkout it was built from.
