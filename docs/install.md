# Install Once Dark Studio on your computer

`once-dark-studio-desktop` is one program that runs on your computer and
opens Once Dark Studio in your usual browser. Nothing is installed from the
internet while it runs. Your books stay in folders on your computer or in
your own Google Drive. [architecture.md](architecture.md) describes where each
piece of data goes.

To write on this computer you need only parts 1 and 2: no account, no
Google, nothing to configure. The rest is optional:

- **Google sign-in and Google Drive** (part 3) let your books and settings
  follow you to another computer or browser. Setting up Google takes about 20
  minutes the first time, most of it in the Google Cloud Console.
- **Phones and tablets at home** (part 4) need Google sign-in and a free
  name for your home network; [home-network.md](home-network.md) has the
  steps.

## 1. Build and start

There is no ready-made program to download. You build it from the source code
of the latest release.

1. Follow steps 1 to 4 of "Quickstart, for everyone" in the
   [README](../README.md#quickstart-for-everyone): install the tools,
   download `once-dark-studio-source.zip`, open a terminal in its folder and
   run the four commands.
2. Optional, to check the download: compare the SHA-256 of
   `once-dark-studio-source.zip` with its line in `SHA256SUMS` on the
   [latest release](https://github.com/perseomazzoni/phospheare/releases/latest).
3. Open `desktop/dist` in the source code folder. Unpack the archive for your
   computer:
   - Windows: `once-dark-studio-desktop-<version>-windows-amd64.zip`
   - Mac with Apple silicon: `…-darwin-arm64.tar.gz`; Intel Mac: `…-darwin-amd64.tar.gz`
   - Linux: `…-linux-amd64.tar.gz` or `…-linux-arm64.tar.gz`
4. Move the folder that you get to a place that you keep, for example
   `Documents` on Windows or `Applications` on a Mac. It holds two programs,
   `once-dark-studio-desktop` and `identity` (`.exe` on Windows). Keep them
   together.
5. Start the program:
   - **Windows**: double-click `once-dark-studio-desktop.exe`. If Windows shows
     "Windows protected your PC", choose **More info**, then **Run anyway**.
     The program is not code-signed.
   - **macOS**: double-click `once-dark-studio-desktop`. If macOS says that
     the developer cannot be verified, open **System Settings** › **Privacy &
     Security**, choose **Open Anyway** next to `once-dark-studio-desktop`,
     then double-click it again. If `identity` is blocked the first time,
     allow it the same way.
   - **Linux**: run `./once-dark-studio-desktop` in a terminal.

   On Windows, and on most Linux desktops, the Once Dark Studio icon appears
   in the tray beside the clock; its menu opens Once Dark Studio and quits it.
   Windows may put the icon among the hidden icons, under the arrow. On macOS,
   and on Linux without a tray, a small window opens and stays open instead;
   closing it stops Once Dark Studio.
6. Your browser opens Once Dark Studio at `http://localhost:47821/app`. The
   first time, the welcome page offers **Continue without an account** and
   **Log in with Google**. Google sign-in works only after part 3.

**The setup page.** Parts 3 and 4 each have a wizard on the setup page. It
takes you through the steps one at a time, with the right links and the
values to copy, which is easier than following this guide. To open the setup
page, click the Once Dark Studio icon in the tray and choose **Setup**. On
macOS, and on Linux without a tray, open the Setup address that the small
Once Dark Studio window shows.

## 2. Your first book, without an account

Without an account, your books stay in a folder on this computer, and your
shelf and settings in this browser. Folders need Chrome, Edge or another
Chromium-based browser.

1. On the welcome page, click **Continue without an account**.
2. In the Library, click **Choose local folder** and choose a folder for your
   books, for example `Documents\Books`. Each book becomes a folder inside it.
   The browser asks once whether Once Dark Studio may edit the folder; allow
   it.
3. Click **New project**. Choose **Blank**, then answer the questions: where
   the book lives (the folder you chose), its structure, its type and word
   goal, its language and its title. Click **Create the folder**. The book
   opens.
4. In the Structure panel on the left, click **+ Section**, give the Section a
   title and write. Your text is saved every 30 seconds; **Save** in the bar
   saves at once.
5. To keep this version of the Section, open **Snapshots** in the bar and
   click **Add a new snapshot**. A snapshot can later be compared with your
   text, or taken back.
6. Go back to the Library. On the book's card, open the actions menu and
   choose **Export to file**. Choose a format, for example DOCX or PDF, and
   click **Export**. The file downloads, and a copy goes to the `export`
   folder inside the book's folder.

[features.md](features.md) lists everything else the app does.

## 3. Google sign-in and Google Drive (optional)

Skip this part if you write on one computer only. It lets you sign in with
Google, keep books in Google Drive and find your shelf and settings on
another computer or in another browser. Phones and tablets need it too.

Do this once per household. Everyone at home then uses the same Google
client; each person still signs in with their own Google account.

> **The easiest way is the wizard**: open the setup page (tray icon › **Setup**, as
part 1 says) and click **Set up Google**. It guides you through six steps,
with a link to the right page of the Google Cloud Console for each one.
Parts 3.1 to 3.6 are the same steps, for reference.

Did you create the project before, for an earlier installation? Click **Use
an existing configuration** and give the client's file again. If the file is
gone, create a new client (part 3.5): Google shows a client's secret only
once. The new client replaces the old one, which you can then delete under
**Clients**.

### 3.1 Create a project

1. Open <https://console.cloud.google.com/projectcreate>.
2. For **Project name**, enter `Once Dark Studio` (any name works). Click
   **Create**.
3. Make sure that the new project is selected in the bar at the top.
4. Open <https://console.cloud.google.com/apis/library/drive.googleapis.com>
   and click **Enable**. This turns on the Google Drive API in the project.

### 3.2 Describe the app

1. Open <https://console.cloud.google.com/auth/overview> and click **Get
   started** if Google asks.
2. For **App name**, enter `Once Dark Studio`. For **User support email**,
   choose your own address.
3. For **Audience**, choose **External**.
4. For **Contact information**, enter your own address.
5. Tick the box to agree, then click **Continue** and **Create**.

### 3.3 Choose what it may see

1. Open **Data access** (<https://console.cloud.google.com/auth/scopes>) and
   click **Add or remove scopes**.
2. Under **Manually add scopes**, at the bottom of the panel, paste these
   five scopes:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/drive.appdata`
3. Click **Add to table**, then **Update**, then **Save** at the bottom of
   the page.

Google lists all five as basic scopes. Once Dark Studio sees only the files
that it creates or that you open with it, plus its own hidden settings folder
in your Drive.

### 3.4 Choose who can sign in

1. Open **Audience** (<https://console.cloud.google.com/auth/audience>).
2. Under **Test users**, click **Add users**, enter the Google address of
   everyone at home who will write, yours too, and click **Save**.

The app stays in **Testing**: it is listed nowhere and needs no website, and
Google lets in only the people on this list. To add someone later, click
**Add people** on the Google card of the setup page. While the app is in
Testing, Google ends every Drive connection after seven days, so Drive asks
you to connect again each week.

### 3.5 Create the client

1. Open **Clients** (<https://console.cloud.google.com/auth/clients>) and
   click **Create client**.
2. For **Application type**, choose **Web application**. For **Name**, enter
   `Once Dark Studio`.
3. Under **Authorized redirect URIs**, click **Add URI** and enter:

   ```
   http://localhost:47821/identity/google/callback
   ```

   The setup page lists the same address under **Addresses Google must
   accept**, plus the home-network address after you set it up (part 4). If
   you changed the port, copy the addresses from there.
4. Leave **Authorized JavaScript origins** empty.
5. Click **Create**, then **Download JSON**.
6. On the setup page, drop the downloaded file on the page, or click to
   choose it. Without the file, click **Paste the ID and secret instead** and
   paste the **Client ID** and the **Client secret**. Click **Save and
   check**.

When the page says "Google accepts the client. One last step: try signing
in.", the client is ready. Any other message names what to fix; the usual
cause is a missing or mistyped redirect URI.

The secret is kept with the setup's other passwords and keys, where part 6
says. It is not part of the application files, and the setup page never shows
it again.

### 3.6 Try signing in

Click **Sign in with Google**, choose your own account and tick every box. If
Google says that it has not verified the app, click **Advanced**, then **Go to
Once Dark Studio**: Google says this of every app it has not reviewed, and
this app is yours. One sign-in checks every step at once (the permissions,
Google Drive and the client), and Once Dark Studio keeps nothing from it.

### 3.7 Write with your Google account

1. Open `http://localhost:47821/app`.
2. On the welcome page, click **Log in with Google** and choose your own
   Google account.
3. Local folders work as in part 2, without Drive permission. To keep books
   in Google Drive, connect Remote Storage from the Library. Google asks
   separately for Drive permission, and the account must be the one you
   signed in with.
4. While Remote Storage is connected, your preferences and shelf are also
   kept in your Drive, where your other installations (another computer,
   another browser) find them.

Once you sign in with Google, the app needs internet access to sign in again;
a session that is already open can write locally when it is offline. Someone
else at home uses their own computer account or browser profile (part 7).

## 4. Phones and tablets on your home network (optional)

Phones and tablets at home can open Once Dark Studio from this computer.
Google accepts sign-in only at an `https://` address with a real name, so
Once Dark Studio gives your home network a free public name from deSEC and a
free certificate for it. You need Google sign-in (part 3) and an email
address.

The easiest way is the wizard: open the setup page (tray icon › **Setup**, as
part 1 says) and click **Set up** on the **Phones and tablets at home** card.
[home-network.md](home-network.md) has the same steps for reference, and
what to do when a phone cannot connect.

## 5. Everyday use

- **Start**: start `once-dark-studio-desktop` as in part 1. If it is already
  running, it only opens the browser; where there is no tray icon, as on
  macOS, it opens the setup page, so the settings stay within reach after a
  start at login.
- **Start at login**: setup page, **Other settings** › **Start at login**. The
  program then starts in the background; open `http://localhost:47821/app` to
  write.
- **Stop**: **Quit** in the tray icon's menu, or **Other settings** › **Quit**
  on the setup page, or, where the program runs in a window, close that
  window.
- **Updates**: setup page, **Other settings** › **Updates** › **Check** tells
  you when a newer release exists. Formats can change between releases: before
  you update, make a copy of your book folders. To update, quit the program,
  build the new release as in part 1, and replace both
  `once-dark-studio-desktop` and `identity` (`.exe` on Windows). Your data is
  not in that folder, so it stays.

## 6. Where your data is

- **Books**: in the folders you chose and in your Google Drive. Never inside
  the program.
- **Your shelf, settings and unsent changes**: in your browser's storage for
  `http://localhost:47821` (and, for phones, for the home-network address).
  Clearing that site's data in the browser removes them from that browser;
  books in folders and in Drive stay. While Remote Storage is connected, your
  preferences and shelf are also in your Drive.
- **Google Drive connections and a remembered OpenRouter key**: sealed in a
  cookie of the browser that made them; only the sign-in service on this
  computer can open it.
- **The setup**: `config.json` and `tls/cert.pem` in
  - Windows: `%APPDATA%\once-dark-studio-desktop`
  - macOS: `~/Library/Application Support/once-dark-studio-desktop`
  - Linux: `~/.config/once-dark-studio-desktop`
- **Passwords and keys** (the Google client secret, the deSEC token, the
  keys that seal your browsers' connections, the certificate's key): in
  your computer's own password store, locked with your login. On Windows,
  Credential Manager, under "Windows Credentials", as
  `once-dark-studio-desktop:<folder>:<name>`; on macOS, the Keychain, as
  `once-dark-studio-desktop`; on Linux, your desktop's keyring. A computer
  with no password store keeps them in `secrets.json` in the folder above,
  and the setup page says so. "Wipe every configuration" on the setup page
  removes them. Deleting the folder alone does not: remove them in that
  window too.

**Keep the port.** The browser keeps your shelf under the address it opened,
port included. If you start `once-dark-studio-desktop --port 48000`, it opens
an empty Library, because that is a different address; going back to `47821`
shows your shelf again. If you must change the port (because another program
holds 47821), connect Remote Storage first, so that your shelf and settings
follow you, and add the new redirect URI in the Google Cloud Console.

**Port already in use**: if another copy of `once-dark-studio-desktop` holds
the port, starting it again opens the browser there. If another program holds
the port, `once-dark-studio-desktop` says so and stops; quit that program, or
start with `--port <number>` as above.

### Your books in other programs

Each book is a folder of ordinary files. The text of each Section is a
Markdown file in the book's `document` folder; reference sheets and notes are
Markdown files in its `reference` folder. Any text editor can open them, and
any backup program can copy them.

Once Dark Studio finds its way around a book through three record files at
the top of its folder: `document-properties.json`, `document-structure.yaml`
and `snapshots-catalogue.json`. They list the files in `document` by name, so
the files and the records must agree.

- **Safe**: read, copy and back up any file; copy or move the whole book
  folder; change the text inside a Section's file, a reference sheet or a
  note while the book is not open in Once Dark Studio.
- **Not safe**: rename, move or delete a file in `document`, or change one of
  the three record files. Do these things in Once Dark Studio instead:
  renaming a Section there renames its files and updates the records.

**If a book does not open.** The Structure panel says "This folder cannot be
opened" and lists each problem, with the file it is in. If the record files
themselves cannot be read, the book's card in the Library says "This project
could not be read." instead. The text is still in its files.

1. If you renamed, moved or deleted a file in `document`, or changed a record
   file, put it back as it was, then click **Try again**.
2. If you have a backup of the whole book folder, put it back in place of the
   damaged folder.
3. If neither is possible, the text is still yours to copy. A Section has one
   file for each of its snapshots, with names such as
   `section--the_storm.EL3.01.md`: the title, the Section's id and the
   snapshot number. `document-structure.yaml` names the snapshot in use.
   Copy the text into a new book.

## 7. Sharing one computer

- Each person signs in with their own Google account. A browser keeps a
  record for every account that signed in to it, and one account is signed in
  at a time. A browser also has one account without Google, open to anyone
  who uses it.
- **Sign out** (Settings › Who you are) asks one question. **Leave everything
  as it is** keeps your shelf and settings in this browser for your next
  sign-in. **Clean everything from this browser** removes your shelf,
  settings, saved keys, folder access and the working copy, and disconnects
  Remote Storage in this browser only. Book files are never touched. After a
  clean, your shelf and settings come back at the next sign-in only from
  Remote Storage. Signing out does not sign you out of Google in your
  browser.
- **Disconnect Remote Storage** asks whether to disconnect this browser only,
  or every device, which also removes the app's access at Google. If Google
  cannot confirm a disconnection, remove access at
  <https://myaccount.google.com/connections>.
- This protects against mixing up workspaces; it is not file encryption.
  Anyone who uses the same unlocked computer account may read the files or
  use an open Google session in the browser. To keep people's work apart,
  give each person their own password-protected operating-system account and
  a screen lock.
- **Disconnect Google Drive and OpenRouter everywhere** (setup page, **Other
  settings** › **Browsers**) ends every Google Drive connection and every
  remembered OpenRouter connection held by browsers of this installation,
  here and on the home network. Nobody is signed out and the shelves stay;
  each person connects again.

## 8. Uninstall

1. On the setup page, under **Other settings**, click **Wipe every
   configuration**: it removes the passwords and keys from your computer's
   password store and stops the start at login. Then click **Quit**.
2. Delete the program folder.
3. Delete the setup folder (part 6) to remove the Google client and the
   certificate.
4. If you skipped the wipe in step 1, remove the passwords and keys by hand
   (part 6 says where they are): on Windows, in Credential Manager › Windows
   Credentials, remove each `once-dark-studio-desktop:…` entry; on macOS, in
   Keychain Access, remove the `once-dark-studio-desktop` items; on Linux,
   remove them in your desktop's keyring application.
5. In your browser, remove the site data for `http://localhost:47821` to
   remove your shelf and settings.
6. Optional: remove Once Dark Studio's access from your Google account at
   <https://myaccount.google.com/connections>, and delete the Cloud project at
   <https://console.cloud.google.com/cloud-resource-manager>.

## 9. Troubleshooting

| You see | Do this |
|---|---|
| `command not found` for `npm` or `go` while you build | Close the terminal and open a new one in the source code folder. If you still see it, install that tool again (part 1). |
| `EBADENGINE` or "Unsupported engine" while you build | Your Node.js is too old: install the LTS version, 26 or newer. |
| The welcome page says Google sign-in isn't set up on this computer yet | Finish part 3, including **Try signing in**, or click **Continue without an account** (part 2). |
| "The sign-in service can't be reached right now" | The program is not running: start `once-dark-studio-desktop` again. |
| Google says `redirect_uri_mismatch` | Add the exact address that the setup page lists under **Addresses Google must accept** (part 3.5, or step 6 of [home-network.md](home-network.md)). |
| Google says "Access blocked", or that the app is in testing | Add that Google account under **Test users** (part 3.4, or **Add people** on the setup page). |
| Drive asks you to connect again every week | This is expected: the app stays in Testing, where Google ends Drive connections after seven days. |
| "That Google account isn't the one you sign in with" | Connect again with the account that the message names. |
| "Your browser blocked the Google window" | Allow pop-ups for `localhost:47821`, then click again. |
| A phone or tablet cannot connect | See [home-network.md](home-network.md). |
| A book says "This folder cannot be opened", or its card says "This project could not be read." | Its files and its records no longer agree: see "If a book does not open" in part 6. |
| An empty Library where you expected your books | You are on another address or port (part 6), or the browser's site data was cleared. If you used Remote Storage, sign in with Google and connect Remote Storage to get your shelf back. |

## 10. AI (optional)

The assistant uses models through OpenRouter, paid by you, or a model on your
own computer through Ollama. [ai.md](ai.md) explains how to connect each one,
and what a remembered OpenRouter key can and cannot do.
