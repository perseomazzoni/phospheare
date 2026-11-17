// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Command fake-services stands in for Google, deSEC and Let's Encrypt, so
// the setup page can be walked by hand, from the Google client to a
// certificate for the home network, with no real account and no email. It
// is for development only: the release build never builds it. `npm run
// dev:wizard` starts it with Pebble and the devfake builds of the desktop
// program and the identity service; see CONTRIBUTING.md.
//
// On one loopback address it serves:
//
//   - /desec/, the deSEC stand-in (internal/adapters/desec/desectest). Its
//     challenge records go to pebble-challtestsrv, the DNS that Pebble asks.
//   - /acme/dir, Pebble's ACME directory with its agreement address
//     replaced by an https one: the setup page offers to accept only an
//     agreement at an https address, and Pebble names a data: one.
//   - /google/, the Google stand-in (google.go), which the identity
//     service of a devfake build reaches.
//   - /console/, a page for each Google Cloud Console page that the setup
//     page opens, where the devfake build of the desktop program leads
//     the setup page's links.
//   - /, the control page: Google's test client and the answer Google
//     gives, and deSEC's accounts, with the activation link of deSEC's
//     email for each one that waits.
package main

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"html/template"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/desec/desectest"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:47890", "loopback address to serve on")
	pebble := flag.String("pebble", "https://localhost:14000/dir", "Pebble's ACME directory")
	challtestsrv := flag.String("challtestsrv", "http://localhost:8055", "pebble-challtestsrv's management API")
	terms := flag.String("terms", "https://letsencrypt.org/repository/", "the https agreement address the directory names instead of Pebble's")
	flag.Parse()

	host, _, err := net.SplitHostPort(*addr)
	if err != nil || !net.ParseIP(host).IsLoopback() {
		log.Fatalf("--addr must be a loopback address with a port, such as 127.0.0.1:47890")
	}
	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatal(err)
	}

	desec := desectest.NewUnstarted()
	desec.OnTXT = dnsMirror{base: strings.TrimSuffix(*challtestsrv, "/")}.txt
	// Pebble serves ACME with a certificate from its own test CA.
	pebbleClient := &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}

	google := newFakeGoogle()
	mux := http.NewServeMux()
	google.routes(mux)
	mux.Handle("/desec/", http.StripPrefix("/desec", desec.Config.Handler))
	mux.HandleFunc("GET /acme/dir", func(w http.ResponseWriter, r *http.Request) {
		directory(w, pebbleClient, *pebble, *terms)
	})
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := page.Execute(w, map[string]any{
			"Accounts": desec.Accounts(),
			"Answers":  googleAnswers,
			"Answer":   google.Answer(),
			"ClientID": testClientID,
			"Secret":   testClientSecret,
		}); err != nil {
			log.Print(err)
		}
	})
	mux.HandleFunc("POST /activate", func(w http.ResponseWriter, r *http.Request) {
		email := r.FormValue("email")
		desec.Activate(email)
		log.Printf("deSEC: activation link used for %s", email)
		http.Redirect(w, r, "/", http.StatusSeeOther)
	})

	fmt.Fprintf(os.Stdout, "Fake services on http://%s\n  Control page: http://%s/\n", ln.Addr(), ln.Addr())
	srv := &http.Server{Handler: guard(ln.Addr().(*net.TCPAddr).Port, mux), ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.Serve(ln))
}

// guard answers only at this server's own loopback names, which a page
// that rebinds its own name to loopback cannot send, and refuses a form
// that another site posts.
func guard(port int, next http.Handler) http.Handler {
	hosts := map[string]bool{}
	for _, h := range []string{"127.0.0.1", "localhost"} {
		hosts[net.JoinHostPort(h, strconv.Itoa(port))] = true
	}
	protected := http.NewCrossOriginProtection().Handler(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hosts[r.Host] {
			http.Error(w, "fake-services answers only at its loopback address", http.StatusMisdirectedRequest)
			return
		}
		protected.ServeHTTP(w, r)
	})
}

// directory answers Pebble's directory with the agreement address replaced.
func directory(w http.ResponseWriter, client *http.Client, pebble, terms string) {
	resp, err := client.Get(pebble)
	if err != nil {
		http.Error(w, "Pebble did not answer: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	var dir map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&dir); err != nil {
		http.Error(w, "Pebble's directory did not read: "+err.Error(), http.StatusBadGateway)
		return
	}
	meta, _ := dir["meta"].(map[string]any)
	if meta == nil {
		meta = map[string]any{}
		dir["meta"] = meta
	}
	meta["termsOfService"] = terms
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dir)
}

// dnsMirror copies the stand-in's TXT writes into pebble-challtestsrv,
// where Pebble looks for the challenge records. The stand-in calls it while
// it holds its lock, so a call that hangs would stop the stand-in: the
// client gives up after a few seconds.
type dnsMirror struct {
	base string
}

var mirrorClient = &http.Client{Timeout: 5 * time.Second}

func (m dnsMirror) txt(fqdn, value string) {
	path, body := "/set-txt", map[string]string{"host": fqdn + ".", "value": value}
	if value == "" {
		path, body = "/clear-txt", map[string]string{"host": fqdn + "."}
	}
	raw, _ := json.Marshal(body)
	resp, err := mirrorClient.Post(m.base+path, "application/json", bytes.NewReader(raw))
	if err != nil {
		log.Printf("challtestsrv %s: %v", path, err)
		return
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("challtestsrv %s: %d", path, resp.StatusCode)
	}
}

var page = template.Must(template.New("page").Parse(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fake services</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
  li { margin: .75rem 0; }
  form { display: inline; }
  form.answers { display: block; }
  label { display: block; }
  code { word-break: break-all; }
</style>
<h1>Fake Google</h1>
<p>On the setup page, use this client. Paste the two values, or upload
the client file.</p>
<ul>
<li>Client ID: <code>{{.ClientID}}</code></li>
<li>Client secret: <code>{{.Secret}}</code></li>
<li><a href="/google/client.json">Download the client file</a></li>
</ul>
<p>Choose what Google answers to the setup page's check and to its trial
sign-in. Then click <em>Check again</em> or <em>Try again</em> on the setup
page.</p>
<form class="answers" method="post" action="/google/answer">
{{range .Answers}}<label><input type="radio" name="answer" value="{{.Key}}"{{if eq .Key $.Answer}} checked{{end}}> {{.Label}}</label>
{{end}}<p><button>Use this answer</button></p>
</form>
<h1>Fake deSEC</h1>
<p>Each account that the setup page makes shows here. Click the button to
act as the person who opens deSEC's email and clicks its link.</p>
{{if .Accounts}}<ul>
{{range .Accounts}}<li><strong>{{.Domain}}</strong>, {{.Email}}:
  {{if .Active}}confirmed{{else}}<form method="post" action="/activate">
    <input type="hidden" name="email" value="{{.Email}}">
    <button>Click the activation link</button></form>{{end}}</li>
{{end}}</ul>
{{else}}<p>No account yet. Choose a name on the setup page first.</p>{{end}}
<p><a href="/">Refresh</a></p>
`))
