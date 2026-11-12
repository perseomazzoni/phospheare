# Phones and tablets on your home network

This guide is optional. It lets phones and tablets at home open Once Dark
Studio from the computer where it runs. It continues the
[install guide](install.md): Once Dark Studio must already run on the
computer (part 1), and Google sign-in must work (part 3), because phones sign
in with Google.

> You do not need to follow this guide step by step. **The setup page has a
wizard that takes you through the same steps one at a time, with the values
to copy, which is easier**. To open it, click the Once Dark Studio icon in the
tray and choose **Setup**; on macOS, and on Linux without a tray, open the
Setup address that the small Once Dark Studio window shows. Then click **Set
up** on the **Phones and tablets at home** card. This guide gives the same
steps for reference, with more detail.

## Why a name and a certificate

Google accepts sign-in only at `localhost` or at an `https://` address with a
real name and a trusted certificate. A numeric address such as `192.168.1.20`
cannot be used. Once Dark Studio therefore gives your home network a free
name under `dedyn.io` from deSEC, a non-profit DNS service in Berlin, and a
free Let's Encrypt certificate for it. You need only an email address.

The name is public: it is published in DNS and in the public logs of web
certificates. deSEC receives your email address. Only the name and this
computer's home-network address are published; your manuscripts never pass
through deSEC.

## Set it up

1. On the setup page, on the **Phones and tablets at home** card, click
   **Set up**. Type your email address and a name: `oncedark` and a number
   of your own works well, for example `oncedark317`, which becomes
   `oncedark317.dedyn.io`. The name is public, so leave out anything
   personal. If someone already has the name, choose another number.
2. The page shows the password of your new deSEC account. Save it in your
   password manager or write it down. Then tick "I have saved the password in
   my password manager, or on a note I keep." Once Dark Studio forgets the
   password when the name is ready; with it, you can look at your account on
   <https://desec.io>.
3. On the same page, read the limits of deSEC's free names and click **Yes,
   they are fine**. Then click **Accept and create the name**: with it you
   accept deSEC's terms of use (<https://desec.io/terms>), which include its
   privacy policy.
4. deSEC emails you a link that works for 12 hours. Open it and solve the
   small picture puzzle on deSEC's page. If no email arrives within a few
   minutes, look in the spam folder. deSEC then shows **Domain Registration
   Completed**, with a token, a password and router settings: you need none
   of them. Copy nothing and leave your router as it is; Once Dark Studio
   makes its own token and keeps the name up to date by itself.
5. Come back to the setup page. Within about 15 seconds it says that the name
   is yours; click **Continue**.
6. The page then shows how to add the phones' address to your Google client
   (<https://console.cloud.google.com/auth/clients>), for example:

   ```
   https://oncedark317.dedyn.io/identity/google/callback
   ```

   Click **Done** when it is saved.

7. On the setup page, the card shows a link to Let's Encrypt's subscriber
   agreement. Read it and click **Accept and turn on**. Once Dark Studio asks
   Let's Encrypt for nothing before that. The page shows each stage while the
   certificate is issued: first deSEC sends the proof that the name is yours
   to its servers, with a count of how many have it, then Let's Encrypt
   checks the proof. The first time takes a few minutes, at most a quarter of
   an hour. Some routers answer name lookups themselves, which hides deSEC's
   servers; with these routers, the page waits a fixed three minutes instead
   of counting.
8. On the phone, open the address shown (or scan the QR code), for example
   `https://oncedark317.dedyn.io/app`. While the home network is on, the
   tray's **Open on a phone or tablet** shows the code and the address.

## After the setup

After the first acceptance, the card shows the switch **Let phones and
tablets open Once Dark Studio**. The switch stays on, also after the computer
restarts, until you turn it off. The tray menu can also start and stop the
home network.

Your acceptance of Let's Encrypt's agreement stays valid for the renewals of
the certificate. When Let's Encrypt changes its agreement, the card and the
tray menu ask you to accept the new one. The certificate in use works until
it expires.

A computer that has just started may not be on the network yet: Once Dark
Studio then tries again for about half an hour. When the certificate exists,
home-network access starts even while deSEC or Let's Encrypt cannot be
reached, and the certificate is renewed later. **Stop using this name** stops
home-network access and forgets the name and your acceptance of Let's
Encrypt's agreement; the name and the account stay yours at deSEC.

The browser keeps saved work and folder permissions separately for each
address. So that this computer has one library, opening the home address on
this computer leads to `http://localhost:47821/app` instead; phones and
tablets keep the home address.

The address needs nothing after the name when Once Dark Studio can use port
443, the usual port for secure web pages. If another program on the computer
uses that port, or the system keeps it for programs with special permission
(as Linux does), Once Dark Studio uses 30483, or the next free number after
it. The address then ends in that number after a colon, for example
`https://oncedark317.dedyn.io:30483/app`, and the setup page says so on
the phones card. Once Dark Studio picks the number once, when the name becomes
yours; under **The number at the end of the address** you can choose another
one. A new number makes a new address: add it to the Google client again.
Work saved only in a phone's browser stays with the old address.

If your email address already has a deSEC account, deSEC sends no new email.
Click **Already have a deSEC account? Use it**, make a token on
<https://desec.io/tokens>, and enter your existing `dedyn.io` name with that
token. A deSEC account holds one `dedyn.io` name.

## Things that commonly get in the way

- **Firewall**: when the computer asks whether to allow Once Dark Studio on
  private networks, allow it. If you missed the question, allow
  `once-dark-studio-desktop` in the firewall settings for private networks.
- **Guest Wi-Fi**: guest networks usually keep devices apart. Put the phone
  on the main network.
- **Router DNS rebinding protection**: some routers refuse names that lead to
  home addresses. If the phone says that the name cannot be found, add the
  name as an exception in the router's DNS rebinding settings.
- **Sleep**: phones can write only while this computer is on and awake.
- **Folders**: a phone cannot open folders on this computer. Keep the books
  you want on the phone in Google Drive.
- **Address changes**: when the router gives this computer a new address,
  Once Dark Studio updates the name by itself, but phones can take up to an
  hour to see the change. To avoid this, give the computer a fixed address in
  the router. If the computer is connected in more than one way, for example
  by cable and by Wi-Fi, choose the connection under **Show the code and
  settings** › **Which connection should phones use?**; access restarts by
  itself.

| You see | Do this |
|---|---|
| The phone cannot find the address | Use the same Wi-Fi, not a guest network; check the router's DNS rebinding protection (above); make sure the setup page shows home-network access as on. |
| Turning on stops with "took longer than usual" or "a quarter of an hour" | deSEC's servers share a new record within a few minutes; turn the switch off and on again later. |
| The phone shows a certificate warning | The certificate has not been issued yet, or the host name differs; check the home-network status on the setup page. |
| Google says `redirect_uri_mismatch` on the phone | Add the phones' address that the setup page lists under **Addresses Google must accept** to the Google client (step 6). |
