// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The setup page's behaviour. Every API call carries `X-Phospheare-Admin`
// and the launch's key, which the setup API requires. The program opens the
// page with the key in the address's fragment (`#k=...`); the page keeps it
// for the tab and takes it out of the address bar, so it is not copied,
// bookmarked or shown. The page receives no saved secret; the
// secret fields stay empty and an empty field keeps the saved value. The one
// secret it shows is a new deSEC password, before it is used.
//
// The page has two views: the settings, one card per area, and a flow that
// takes their place and walks through one setup a step at a time. A step is
// a numbered list of rows that can be ticked; a row may say why it matters,
// and how to check it when it may be done already. The flow, its step and
// the ticks are kept for the tab, so a reload comes back to the same place.
"use strict";

(function () {
  var state = null;
  var flow = null;
  var cardVerdict = null;
  var pollTimer = 0;
  var qrURL = "";
  var qrFor = "";
  var nameTimer = 0;
  var existingName = false;

  // The page's texts, in its language, which the host puts in the page.
  // They come first: the tables below are built from them.
  var words = (function () {
    try { return JSON.parse($("words").textContent) || {}; } catch (err) { return {}; }
  })();

  var flowNames = { google: w("flow.google"), home: w("flow.home"), people: w("flow.people") };
  // The tick ids of each setup's rows begin with these.
  var flowTicks = { google: ["g", "step-verdict", "trial-verdict"], home: ["h"], people: ["p"] };

  function $(id) { return document.getElementById(id); }

  // w answers key's text with each {name} of values filled in; {product}
  // is the product's name once the state has it.
  function w(key, values) {
    var text = words[key] !== undefined ? words[key] : key;
    values = values || {};
    return text.replace(/\{(\w+)\}/g, function (all, name) {
      if (Object.prototype.hasOwnProperty.call(values, name)) return String(values[name]);
      if (name === "product") return state ? state.product : "";
      return all;
    });
  }

  // launchKey takes the key from the fragment, keeps it for the tab so a
  // reload still works, and leaves the rest of the fragment, the place on
  // the page, in the address.
  var launchKey = (function () {
    var key = "";
    var rest = [];
    location.hash.replace(/^#/, "").split("&").forEach(function (part) {
      if (part.indexOf("k=") === 0) key = part.slice(2);
      else if (part) rest.push(part);
    });
    try {
      if (key) sessionStorage.setItem("setup.key", key);
      else key = sessionStorage.getItem("setup.key") || "";
    } catch (err) { /* The key then lasts until a reload. */ }
    if (location.hash.indexOf("k=") >= 0) {
      history.replaceState(null, "", location.pathname + location.search + (rest.length ? "#" + rest.join("&") : ""));
    }
    return key;
  })();

  function api(method, path, body) {
    var init = { method: method, headers: { "X-Phospheare-Admin": "1", "X-Phospheare-Setup-Key": launchKey }, credentials: "same-origin" };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch("/desktop/setup/api/" + path, init).then(function (res) {
      if (res.ok) {
        var type = res.headers.get("Content-Type") || "";
        if (type.indexOf("application/json") === 0) return res.json();
        if (type.indexOf("image/") === 0) return res.blob();
        return null;
      }
      return res.json().catch(function () { return {}; }).then(function (p) {
        var err = new Error(p.title || w("hostAnswered", { status: res.status }));
        err.code = p.code || "";
        // A page opened without the key can change nothing; the top of the
        // page says how to open it with one.
        if (err.code === "setup-key-refused") showError(err);
        throw err;
      });
    });
  }

  function say(el, text, kind) {
    el.textContent = text;
    el.className = el.className.replace(/\bis-\w+\b/g, "").trim() + (kind ? " is-" + kind : "");
  }

  function showError(err) {
    var box = $("error");
    if (!err) { box.hidden = true; return; }
    box.textContent = err.message || String(err);
    box.hidden = false;
    box.scrollIntoView({ block: "nearest" });
  }

  // busy shows on a button that its action is under way, and answers a
  // function that puts the button back.
  function busy(button, label) {
    var was = button.textContent;
    button.textContent = label;
    button.disabled = true;
    return function () {
      button.textContent = was;
      button.disabled = false;
    };
  }

  // bind puts the state's values into the page, and the product's name,
  // squeezed to letters and digits, as the example free name.
  function bind(s) {
    document.querySelectorAll("[data-bind]").forEach(function (el) {
      var v = s[el.getAttribute("data-bind")];
      if (v !== undefined) el.textContent = v;
    });
    document.querySelectorAll("[data-hint=name]").forEach(function (el) {
      el.placeholder = (s.product || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    });
  }

  function remember(f) {
    try {
      if (f) sessionStorage.setItem("setup.flow", JSON.stringify(f));
      else sessionStorage.removeItem("setup.flow");
    } catch (err) { /* The flow then starts over after a reload. */ }
  }

  function remembered() {
    try {
      var f = JSON.parse(sessionStorage.getItem("setup.flow") || "null");
      return f && flowNames[f.name] && typeof f.step === "number" ? f : null;
    } catch (err) { return null; }
  }

  // Copy buttons.

  // icon copies an icon from its template in the page.
  function icon(name) {
    return $("icon-" + name).content.firstElementChild.cloneNode(true);
  }

  function copyButton(code) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "copy";
    b.setAttribute("aria-label", w("copy"));
    b.title = w("copy");
    b.appendChild(icon("copy"));
    b.addEventListener("click", function () { copy(code, b); });
    return b;
  }

  function copy(code, button) {
    navigator.clipboard.writeText(code.textContent).then(function () {
      var row = button.closest(".sheet-row");
      if (row && row.querySelector(".tick-mark")) tick(row, true);
      button.replaceChildren(icon("done"));
      button.classList.add("is-done");
      button.setAttribute("aria-label", w("copied"));
      button.title = w("copied");
      setTimeout(function () {
        button.replaceChildren(icon("copy"));
        button.classList.remove("is-done");
        button.setAttribute("aria-label", w("copy"));
        button.title = w("copy");
      }, 1500);
    }, function () {
      // Without the clipboard, the value is selected for copying by hand.
      var range = document.createRange();
      range.selectNodeContents(code);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      button.title = w("copyByHand");
    });
  }

  function sheetRow(label, value) {
    var row = document.createElement("div");
    row.className = "sheet-row";
    var dt = document.createElement("dt");
    dt.textContent = label;
    var dd = document.createElement("dd");
    var code = document.createElement("code");
    code.textContent = value;
    dd.appendChild(code);
    dd.appendChild(copyButton(code));
    row.appendChild(dt);
    row.appendChild(dd);
    return row;
  }

  // appendMarked adds text to el, with each <em>...</em> in it as an em
  // element. It is the only markup the texts carry, and nothing in them is
  // parsed as HTML, so a product name or a translation never becomes markup.
  function appendMarked(el, text) {
    text.split(/(<em>[\s\S]*?<\/em>)/).forEach(function (part) {
      var marked = /^<em>([\s\S]*)<\/em>$/.exec(part);
      if (marked) {
        var em = document.createElement("em");
        em.textContent = marked[1];
        el.appendChild(em);
      } else if (part) {
        el.appendChild(document.createTextNode(part));
      }
    });
  }

  function wideRow(text, id) {
    var row = document.createElement("div");
    row.className = "sheet-row wide";
    row.dataset.row = id;
    var dd = document.createElement("dd");
    appendMarked(dd, text);
    row.appendChild(dd);
    return row;
  }

  // valueRow is a row that says where a value goes, with the value to copy.
  function valueRow(text, value, id) {
    var row = wideRow(text + " ", id);
    var dd = row.firstChild;
    var code = document.createElement("code");
    code.textContent = value;
    dd.appendChild(code);
    dd.appendChild(copyButton(code));
    return row;
  }

  function openRow(label, href, id) {
    var row = document.createElement("div");
    row.className = "sheet-row wide open-row";
    row.dataset.row = id;
    var dd = document.createElement("dd");
    var a = document.createElement("a");
    a.className = "button primary open-page";
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label;
    dd.appendChild(a);
    row.appendChild(dd);
    return row;
  }

  // The tick trail. Copying a row's value or opening its page ticks the row,
  // and the next row to do offers Done. Coming back to the tab scrolls to
  // that row, so the place is found again. Ticks are kept for the tab, so a
  // reload keeps them, and a setup's ticks are cleared when it is left.

  var ticks = loadTicks();

  function loadTicks() {
    try { return JSON.parse(sessionStorage.getItem("setup.ticks") || "{}") || {}; } catch (err) { return {}; }
  }

  function saveTicks() {
    try { sessionStorage.setItem("setup.ticks", JSON.stringify(ticks)); } catch (err) { /* Ticks then last until a reload. */ }
  }

  // scopeRows answers the rows of a scope that can be ticked, in page order.
  function scopeRows(scope) {
    return Array.prototype.filter.call(scope.querySelectorAll(".sheet-row"), function (r) {
      return !r.classList.contains("no-tick") && !r.closest(".ref") && r.closest("[data-scope]") === scope;
    });
  }

  // A row's check shows once it is done. Every row but one that opens a
  // page has a Done button, shown while it is the next to do; copying a
  // row's value ticks it too.
  function tickMark() {
    var m = document.createElement("span");
    m.className = "tick-mark";
    m.appendChild(icon("done"));
    return m;
  }

  function doneButton(row) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "done-button";
    b.textContent = row.dataset.done || w("done");
    b.addEventListener("click", function () { tick(row, true); });
    return b;
  }

  // showTick shows whether a row is done. A row folds its reason and its
  // check away when it becomes done; they can be opened again after.
  function showTick(row) {
    var on = !!ticks[row.dataset.row];
    var m = row.querySelector(".tick-mark");
    var was = row.classList.contains("is-ticked");
    row.classList.toggle("is-ticked", on);
    if (on && !was) {
      showMore(row, ".row-why", false);
      showMore(row, ".row-done", false);
    }
    if (on) {
      m.setAttribute("role", "img");
      m.setAttribute("aria-label", w("done"));
    } else {
      m.removeAttribute("role");
      m.removeAttribute("aria-label");
    }
  }

  // trail gives the rows of a scope their ids and ticks, shows what is
  // ticked, and marks the next row to do: the first one not ticked after the
  // last one ticked. While a row is next, it is the only one of its list that
  // can be used, so the list is followed in order; the other rows keep only
  // their "Why?" and "Already done?", the way to skip ahead.
  function trail(scope) {
    var rows = scopeRows(scope);
    var n = 0;
    var last = -1;
    rows.forEach(function (r, i) {
      if (!r.dataset.row) r.dataset.row = scope.dataset.scope + "-" + n++;
      if (!r.querySelector(".tick-mark")) {
        r.insertBefore(tickMark(), r.firstChild);
        if (!r.querySelector(".open-page")) r.appendChild(doneButton(r));
      }
      showTick(r);
      r.classList.remove("is-next");
      if (ticks[r.dataset.row]) last = i;
    });
    for (var i = last + 1; i < rows.length; i++) {
      if (!ticks[rows[i].dataset.row]) { rows[i].classList.add("is-next"); break; }
    }
    var current = rows.some(function (r) { return r.classList.contains("is-next"); });
    // An Open button is the page's main button only on the next row to do.
    rows.forEach(function (r) {
      var next = r.classList.contains("is-next");
      Array.prototype.forEach.call(r.children, function (c) {
        c.inert = current && !next && !c.matches(".row-links, .row-why, .row-done");
      });
      var open = r.querySelector(".open-page");
      if (open) open.classList.toggle("primary", next);
    });
  }

  // skipTo ticks every row of the list before row, which the person says is
  // done already, so row is the next to do.
  function skipTo(row) {
    var scope = row.closest("[data-scope]");
    var rows = scopeRows(scope);
    rows.slice(0, rows.indexOf(row)).forEach(function (r) { ticks[r.dataset.row] = Date.now(); });
    saveTicks();
    trail(scope);
    showFoot();
  }

  function tick(row, on) {
    if (on) ticks[row.dataset.row] = Date.now();
    else delete ticks[row.dataset.row];
    row.classList.remove("is-suspect");
    saveTicks();
    trail(row.closest("[data-scope]"));
    showFoot();
  }

  function clearTicks(prefixes) {
    Object.keys(ticks).forEach(function (k) {
      if (prefixes.some(function (p) { return k.indexOf(p) === 0; })) delete ticks[k];
    });
    saveTicks();
    document.querySelectorAll("[data-scope]").forEach(trail);
  }

  function shown(el) { return el.offsetParent !== null; }

  // comeBack finds the place again after a visit to another tab: it scrolls
  // to the next row after the last one ticked, and makes it stand out for a
  // moment.
  function comeBack() {
    // Only a row inside a scope has a next row to find.
    var rows = Array.prototype.filter.call(document.querySelectorAll(".sheet-row.is-ticked"), function (row) {
      return shown(row) && row.closest("[data-scope]");
    });
    if (!rows.length) return;
    rows.sort(function (a, b) { return ticks[b.dataset.row] - ticks[a.dataset.row]; });
    var at = rows[0].closest("[data-scope]").querySelector(".sheet-row.is-next") || rows[0];
    at.scrollIntoView({ block: "center", behavior: "smooth" });
    at.classList.remove("is-back");
    void at.offsetWidth;
    at.classList.add("is-back");
  }

  // Google.

  var clientsURL = "https://console.cloud.google.com/auth/clients";
  var redirectFor = { computer: w("redirect.computer"), home: w("redirect.home") };
  var redirectWords = { computer: w("uri.computer"), home: w("uri.home") };

  function googleSet(g) { return g.clientIdSet && g.secretSet; }

  function renderGoogle(g) {
    var set = googleSet(g);
    $("google-unset").hidden = set;
    $("google-set").hidden = !set;
    if (!set) cardVerdict = null;
    renderCardVerdict();
    document.querySelectorAll(".redirect-uris").forEach(function (list) {
      list.textContent = "";
      g.redirectUris.forEach(function (r) {
        list.appendChild(sheetRow(redirectFor[r.for] || r.for, r.uri));
      });
    });
    // A list for one address alone names it as the first.
    document.querySelectorAll(".redirect-rows").forEach(function (list) {
      var scope = list.closest("[data-scope]");
      var only = list.getAttribute("data-for");
      list.textContent = "";
      g.redirectUris.forEach(function (r) {
        if (only && r.for !== only) return;
        var words = only ? redirectWords.computer : redirectWords[r.for] || redirectWords.computer;
        list.appendChild(valueRow(words, r.uri, scope.dataset.scope + "-uri-" + r.for));
      });
      trail(scope);
    });
    var home = $("home-google-uri").querySelector(".redirect-home");
    home.textContent = "";
    g.redirectUris.forEach(function (r) {
      if (r.for === "home") home.appendChild(sheetRow(redirectFor.home, r.uri));
    });
    $("home-google-uri").hidden = !home.firstChild;
  }

  // clientFromFile reads the client from the JSON file the Google Cloud
  // Console downloads: {"web": {client_id, client_secret, redirect_uris}}.
  // A client of another type, or any other file, answers an error that says
  // what to choose instead. uris is null when the file lists none.
  function clientFromFile(text) {
    var doc = null;
    try { doc = JSON.parse(text); } catch (err) { doc = null; }
    if (doc && doc.installed) {
      return { error: w("file.desktop") };
    }
    var web = doc && doc.web;
    if (!web || typeof web.client_id !== "string") {
      return { error: w("file.other") };
    }
    return {
      id: web.client_id,
      secret: typeof web.client_secret === "string" ? web.client_secret : "",
      uris: Array.isArray(web.redirect_uris) ? web.redirect_uris : null
    };
  }

  // The client step. The downloaded file is saved and checked as soon as it
  // arrives; the two values can be pasted instead. The step shows one of:
  // the file, the paste fields, or what became of the client.
  function clientMode(mode) {
    $("client-file").hidden = mode !== "file";
    $("client-paste").hidden = mode !== "paste";
    $("client-received").hidden = mode !== "received" && mode !== "done";
    $("google-done").hidden = mode !== "done";
    showFoot();
  }

  function resetClientStep() {
    var f = $("client-paste");
    f.clientId.value = "";
    f.clientSecret.value = "";
    ["google-file-result", "paste-result", "received-progress"].forEach(function (id) { say($(id), "", ""); });
    $("lost-secret").hidden = true;
    renderVerdict($("step-verdict"), null, "step");
    clientMode("file");
  }

  function readClientFile(file) {
    var out = $("google-file-result");
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { say(out, w("file.unreadable"), "error"); };
    reader.onload = function () {
      $("google-file").value = "";
      var c = clientFromFile(reader.result);
      if (c.error) { say(out, c.error, "error"); return; }
      say(out, "", "");
      if (!c.secret) {
        // Only the secret is missing: the paste fields take it, with the help
        // for finding it.
        var f = $("client-paste");
        f.clientId.value = c.id;
        f.clientSecret.value = "";
        $("lost-secret").hidden = false;
        say($("paste-result"), w("file.noSecret"), "warn");
        clientMode("paste");
        f.clientSecret.focus();
        return;
      }
      saveClient(c.id, c.secret, "file");
    };
    reader.readAsText(file);
  }

  // saveClient saves the client and asks Google about it at once. A refusal
  // of the values themselves goes back to where they came from.
  function saveClient(id, secret, from) {
    $("received-text").textContent = w(from === "file" ? "received.file" : "received.paste");
    say($("received-progress"), w("checkingGoogle"), "");
    renderVerdict($("step-verdict"), null, "step");
    clientMode("received");
    api("PUT", "google", { clientId: id, clientSecret: secret })
      .then(function () { return refresh(false); })
      .then(askGoogle)
      .then(showClientVerdict, function (err) {
        say($("received-progress"), "", "");
        clientMode(from);
        say($(from === "file" ? "google-file-result" : "paste-result"), err.message, "error");
      });
  }

  function askGoogle() {
    return api("POST", "google/check").then(verdictOf, function () { return { kind: "error" }; });
  }

  function showClientVerdict(v) {
    say($("received-progress"), "", "");
    cardVerdict = v;
    if (v.kind === "credentials") $("lost-secret").hidden = false;
    renderVerdict($("step-verdict"), v, "step");
    clientMode(v.kind === "ok" ? "done" : "received");
    if (v.kind === "ok") clearTicks(["g", "step-verdict", "card-verdict"]);
  }

  // verdictOf turns Google's answers, one per address, into one verdict.
  // A wrong ID or secret, or no connection, is about the client as a whole
  // and wins over any single address.
  function verdictOf(res) {
    var by = {};
    res.results.forEach(function (r) { (by[r.result] = by[r.result] || []).push(r.redirectUri); });
    if (by["wrong-credentials"]) return { kind: "credentials" };
    if (by.unreachable) return { kind: "offline" };
    if (by["redirect-mismatch"]) return { kind: "missing", uris: by["redirect-mismatch"] };
    if (by.ok && by.ok.length === res.results.length) return { kind: "ok" };
    return { kind: "unknown" };
  }

  // addressesFor names what addresses are for: "phones and tablets", "this
  // computer and for phones and tablets".
  function addressesFor(uris) {
    var names = uris.map(function (u) {
      var r = state && state.google.redirectUris.filter(function (x) { return x.uri === u; })[0];
      return w(r && r.for === "home" ? "who.home" : "who.computer");
    });
    return names.reduce(function (all, n) { return w("who.join", { first: all, second: n }); });
  }

  // The texts for each verdict, and on the client step where they differ; a
  // verdict about several addresses has its own.
  var verdictWords = {
    credentials: { card: "verdict.credentialsCard", step: "verdict.credentialsStep" },
    missing: { card: "verdict.missingOne", many: "verdict.missingMany" },
    offline: { card: "verdict.offline" },
    unknown: { card: "verdict.unknown" },
    error: { card: "verdict.error" }
  };

  // renderVerdict shows a verdict in box, with only the buttons that fit it.
  // An answer of "it works", or none yet, shows nothing.
  function renderVerdict(box, v, where) {
    box.hidden = !v || v.kind === "ok" || v.kind === "checking";
    if (box.hidden) return;
    var uris = v.uris || [];
    var keys = verdictWords[v.kind];
    var text = w(uris.length > 1 && keys.many || keys[where] || keys.card, { who: addressesFor(uris) });
    var problem = v.kind === "credentials" || v.kind === "missing";
    say(box.querySelector(".verdict-text"), text, problem ? "warn" : "");
    verdictRows(box, v);
    var redo = box.querySelector(".verdict-redo");
    var again = box.querySelector(".verdict-again");
    if (redo) redo.hidden = v.kind !== "credentials";
    if (again) {
      again.hidden = v.kind === "credentials";
      again.disabled = false;
      again.textContent = v.kind === "missing" ? w("checkAgain") : w("tryAgain");
    }
  }

  // verdictRows lists what to do in Google for a missing address, as rows
  // of the tick trail.
  function verdictRows(box, v) {
    var list = box.querySelector(".verdict-rows");
    var id = box.dataset.scope;
    list.textContent = "";
    if (v.kind === "missing") {
      list.appendChild(openRow(w("openClients"), clientsURL, id + "-open"));
      list.appendChild(wideRow(w("clientNewest"), id + "-client"));
      v.uris.forEach(function (u) {
        var r = state.google.redirectUris.filter(function (x) { return x.uri === u; })[0];
        var who = r ? r.for : "computer";
        list.appendChild(valueRow(redirectWords[who] || redirectWords.computer, u, id + "-uri-" + who));
      });
      list.appendChild(wideRow(w("saveWait"), id + "-save"));
    }
    trail(box);
  }

  var verdictChip = {
    checking: [w("checking"), ""],
    ok: [w("chip.working"), "ok"],
    credentials: [w("chip.attention"), "warn"],
    missing: [w("chip.attention"), "warn"],
    unknown: [w("chip.attention"), "warn"],
    offline: [w("chip.notChecked"), ""],
    error: [w("chip.notChecked"), ""]
  };

  // weigh gives a card its weight: "full", "compact", "checking" or
  // "blocked", which `admin.css` draws. A card that turns full opens its
  // body; one that turns compact closes it, and stays as the person leaves
  // it until its weight changes again.
  function weigh(card, weight) {
    var was = card.dataset.weight;
    card.dataset.weight = weight;
    var more = card.querySelector(".card-more");
    if (weight === "full") more.open = true;
    else if (was !== weight) more.open = false;
  }

  // googleState answers where Google stands: "unset", "checking", "ok", or
  // "broken" for any other answer, which the card shows in full.
  function googleState() {
    if (!state || !googleSet(state.google)) return "unset";
    var kind = (cardVerdict || { kind: "checking" }).kind;
    return kind === "ok" || kind === "checking" ? kind : "broken";
  }

  function renderCardVerdict() {
    var g = googleState();
    weigh($("card-google"), g === "ok" ? "compact" : g === "checking" ? "checking" : "full");
    if (state) renderHome(state);
    if (g === "unset") {
      say($("google-chip"), w("chip.notSetUpYet"), "warn");
      return;
    }
    var v = cardVerdict || { kind: "checking" };
    var c = verdictChip[v.kind];
    say($("google-chip"), c[0], c[1]);
    $("google-working").hidden = v.kind !== "ok";
    $("google-change-row").hidden = v.kind !== "ok";
    renderVerdict($("card-verdict"), v, "card");
  }

  // checkGoogle asks Google about the saved client and shows the answer on
  // the card. Asked again from the card, the button shows it is asking.
  function checkGoogle() {
    var again = document.querySelector("#card-verdict .verdict-again");
    if (!$("card-verdict").hidden && !again.hidden) {
      busy(again, w("checking"));
    } else {
      cardVerdict = { kind: "checking" };
      renderCardVerdict();
    }
    return askGoogle().then(function (v) {
      cardVerdict = v;
      if (v.kind === "ok") clearTicks(["card-verdict"]);
      renderCardVerdict();
    });
  }

  function checkClientAgain() {
    busy(document.querySelector("#step-verdict .verdict-again"), w("checking"));
    askGoogle().then(showClientVerdict);
  }

  // The trial sign-in. Entering its step starts a trial at the identity
  // service, so the button can open Google's window at once, and a window the
  // page opens can close itself when Google is done. The answer is asked for
  // when Google's window says it closed, when the page is shown again, and
  // every few seconds while the page waits.

  var trialStep = 5;
  var trial = null;

  function identity(path) {
    var init = { method: "POST", headers: { "X-Phospheare": "1" }, credentials: "same-origin" };
    return fetch("/identity/google/" + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.ok) return body;
        var err = new Error(body.title || w("hostAnswered", { status: res.status }));
        err.code = body.code || "";
        throw err;
      });
    });
  }

  // What each trial answer says, and the step that fixes it. A primary fix
  // is the likely way forward; otherwise trying again is.
  var trialWords = {
    "drive-off": {
      text: w("trial.driveOff"),
      fix: { label: w("trial.driveOffFix"), step: 0, mark: '[data-key="drive"]' }, primary: "fix"
    },
    "scope-missing": {
      text: w("trial.scopeMissing"),
      fix: { label: w("trial.scopeFix"), step: 2, mark: '[data-key="scopes"]' }, primary: "again"
    },
    client: {
      text: w("trial.client"),
      fix: { label: w("trial.clientFix"), step: 4, mark: '[data-key="download"]' }, primary: "fix"
    },
    address: {
      text: w("trial.address")
    },
    blocked: {
      text: w("trial.blocked"),
      fix: { label: w("trial.blockedFix"), step: 3, mark: '[data-key="people"]' }, primary: "fix"
    },
    cancelled: { text: w("trial.cancelled"), primary: "again" },
    unreachable: { text: w("trial.unreachable"), primary: "again" },
    expired: { text: w("trial.expired"), primary: "again" },
    failed: { text: w("trial.failed"), primary: "again" }
  };

  function stopTrial() {
    if (!trial) return;
    clearTimeout(trial.timer);
    clearTimeout(trial.slow);
    if (trial.release) trial.release();
    trial = null;
  }

  // beginTrial starts a new trial, for the next click of the button.
  function beginTrial() {
    stopTrial();
    var t = trial = { id: "", url: "" };
    var start = $("trial-start");
    var again = document.querySelector("#trial-verdict .trial-again");
    start.disabled = again.disabled = true;
    identity("trials").then(function (res) {
      if (trial !== t) return;
      t.id = res.flowId;
      t.url = res.authorizeUrl;
      start.disabled = again.disabled = false;
    }, function (err) {
      if (trial === t) say($("trial-progress"), err.message, "error");
    });
  }

  function openTrial() {
    var t = trial;
    if (!t || !t.url) return;
    if (!window.open(t.url, "_blank")) {
      say($("trial-progress"), w("trial.popup"), "warn");
      return;
    }
    say($("trial-progress"), "", "");
    showTrial(null);
    if (t.release) return;
    t.release = busy($("trial-start"), w("trial.waiting"));
    t.slow = setTimeout(function () { if (trial === t) slowTrial(t); }, 60000);
    askTrialIn(3000);
  }

  // slowTrial explains a sign-in with no answer. Google says Access blocked
  // both for an account that is not on the list and for an address the
  // client does not list, so the check tells the two apart.
  function slowTrial(t) {
    askGoogle().then(function (v) {
      if (trial !== t) return;
      showTrial(v.kind === "missing" ? "address" : v.kind === "credentials" ? "client" : "blocked", v);
    });
  }

  function askTrialIn(delay) {
    clearTimeout(trial.timer);
    trial.timer = setTimeout(askTrial, delay);
  }

  function askTrial() {
    var t = trial;
    if (!t || !t.release || t.asking) return;
    clearTimeout(t.timer);
    t.asking = true;
    identity("trials/" + t.id + "/finish").then(function (report) {
      if (trial === t) endTrial(report.result, report.email);
    }, function (err) {
      if (trial !== t) return;
      t.asking = false;
      if (err.code === "flow-pending") askTrialIn(3000);
      else endTrial(err.code === "flow-expired" ? "expired" : "failed");
    });
  }

  // endTrial shows the answer. Any answer but success starts the next trial
  // at once, so trying again is one click.
  function endTrial(result, email) {
    if (result === "ok") {
      stopTrial();
      $("trial-done-text").textContent = email ? w("trial.doneAs", { email: email }) : w("trial.done");
      $("trial-done").hidden = false;
      $("trial-start").closest("[data-scope]").hidden = true;
      cardVerdict = { kind: "ok" };
      clearTicks(["g"]);
      showFoot();
      return;
    }
    beginTrial();
    showTrial(trialWords[result] ? result : "failed");
  }

  // showTrial shows the trial's answer; v is the check's verdict when the
  // answer is a missing address, whose rows it lists.
  function showTrial(result, v) {
    var box = $("trial-verdict");
    box.hidden = !result;
    if (!result) return;
    verdictRows(box, result === "address" ? v : { kind: result });
    var w = trialWords[result];
    say(box.querySelector(".verdict-text"), w.text, w.fix ? "warn" : "");
    var fix = box.querySelector(".trial-fix");
    var again = box.querySelector(".trial-again");
    fix.hidden = !w.fix;
    fix.textContent = w.fix ? w.fix.label : "";
    fix.classList.toggle("primary", w.primary === "fix");
    again.classList.toggle("primary", w.primary === "again");
    box.dataset.result = result;
  }

  // fixTrial opens the step that fixes the answer, at the row to check, and
  // comes back here once it is done.
  function fixTrial() {
    var f = trialWords[$("trial-verdict").dataset.result].fix;
    if (f.step === 4) resetClientStep();
    flow.returnTo = trialStep;
    go(f.step);
    if (f.mark) suspect(steps("google")[f.step].querySelector(f.mark));
  }

  function enterTrial() {
    delete flow.returnTo;
    say($("trial-progress"), "", "");
    showTrial(null);
    $("trial-done").hidden = true;
    $("trial-start").closest("[data-scope]").hidden = false;
    $("trial-start").classList.add("primary");
    beginTrial();
  }

  function trialAnswered(msg) {
    if (msg && msg.type === "phospheare-oauth" && trial && msg.flowId === trial.id) askTrial();
  }

  // The home network.

  var lanWords = { off: "lan.off", starting: "lan.starting", running: "", error: "lan.error" };

  var lanChip = { off: ["chip.off", ""], starting: ["chip.turningOn", ""], running: ["chip.on", "ok"], error: ["chip.failed", "error"] };

  // renderHome shows the phones card. Phones sign in with Google, so while
  // Google does not work the card is only its head, muted, and while Google
  // is being checked only its head. Otherwise it is open: while phones can
  // open it, the code and the address come first. While the home network is
  // on, the card stays open whatever the Google check says, so its switch
  // can always turn it off.
  function renderHome(s) {
    var n = s.lan.name;
    var chip = $("home-chip");
    var g = googleState();
    var lan = s.lan.status.state;
    var on = (lan === "running" || lan === "starting") && n.state === "linked";
    var shown = on ? "linked" : g === "unset" || g === "broken" ? "needs-google" : n.state === "expired" ? "waiting" : n.state === "none" ? "unset" : n.state;
    weigh($("card-home"), shown === "needs-google" ? "blocked" : g === "checking" && !on ? "checking" : "full");
    $("home-unset").hidden = shown !== "unset";
    $("home-waiting").hidden = shown !== "waiting";
    $("home-linked").hidden = shown !== "linked";
    $("home-linked-more").hidden = shown !== "linked";
    if (shown === "needs-google") say(chip, w("chip.needsGoogle"), "");
    if (shown === "unset") say(chip, w("chip.notSetUp"), "");
    if (shown === "waiting") {
      say(chip, w(n.state === "expired" ? "chip.expired" : "chip.waitingDesec"), n.state === "expired" ? "error" : "warn");
    }
    if (shown === "linked") {
      var c = lanChip[s.lan.status.state];
      if (s.lan.status.terms && lan === "running") c = ["chip.attention", "warn"];
      say(chip, c ? w(c[0]) : s.lan.status.state, c ? c[1] : "");
      var port = s.lan.config.port;
      $("ready-address").textContent = n.domain + (port === 443 ? "" : ":" + port);
      $("ready-link").href = s.lan.status.url || "https://" + n.domain + (port === 443 ? "" : ":" + port) + "/app";
      $("ready-email").textContent = n.email || "";
      $("ready-forgotten").hidden = !n.email;
    }
  }

  // renderLAN shows the switch where it stands and one plain line under it;
  // a failure adds why.
  function renderLAN(lan, fillForm) {
    var st = lan.status;
    renderTerms(lan);
    var text = st.state in lanWords ? lanWords[st.state] && w(lanWords[st.state]) : st.state;
    if (st.state === "error" && st.message) text += " " + st.message;
    say($("lan-status"), text, st.state === "error" ? "error" : "");
    $("lan-on").checked = st.state === "running" || st.state === "starting";
    showProgress(st);
    $("lan-running").hidden = st.state !== "running";
    $("ready-line").hidden = st.state === "running";
    if (st.state === "running") {
      $("lan-url").textContent = st.url;
      if (qrFor !== st.url) loadQR(st.url);
    }
    var key = st.state + " " + lan.config.port;
    if (lan.name.state === "linked" && (fillForm || key !== portsFor)) {
      portsFor = key;
      loadPorts();
    }
    if (fillForm && lan.name.state === "linked") loadAddresses(lan.config.address);
    clearTimeout(pollTimer);
    if (st.state === "starting") pollTimer = setTimeout(refresh, 2000);
    // The listener checks its certificate just after it starts, and again
    // after an acceptance; one later look shows what the authority said.
    if (st.state !== "running") settledFor = "";
    else if (settledFor !== st.url) {
      settledFor = st.url;
      pollTimer = setTimeout(refresh, 5000);
    }
  }

  // The certificate authority's agreement.

  var settledFor = "";
  // terms is the agreement the panel shows: its address, whether the
  // authority names none, whether it is the one accepted, and why it could
  // not be read. read says the authority was asked.
  var terms = noTerms();

  function noTerms() { return { url: "", none: false, read: false, accepted: false, loading: false, failed: "" }; }

  // renderTerms shows the agreement's panel in its two cases. With the
  // listener off, the authority is asked once which agreement is in force:
  // while that one is not accepted, the panel takes the switch's place, so
  // turning on never starts with a refusal. While the authority asks again
  // of a listener that runs, the status carries the address and the switch
  // stays. An authority that names no agreement has no panel: the switch is
  // the acceptance.
  function renderTerms(lan) {
    var st = lan.status;
    var on = st.state === "running" || st.state === "starting";
    var asked = !!st.terms;
    var off = !asked && !on && lan.name.state === "linked";
    var box = $("lan-terms");
    if (!asked && !off) {
      terms = noTerms();
      say($("lan-terms-result"), "", "");
    }
    if (asked) terms.url = st.terms;
    else if (off && !terms.read && !terms.loading && !terms.failed) loadTerms();
    // replaced: an agreement was accepted, and another one is in force now.
    var replaced = off && lan.config.termsAccepted && terms.read && !terms.accepted;
    var first = off && (!lan.config.termsAccepted || replaced);
    var plain = first && terms.none;
    box.hidden = !asked && !first || plain;
    $("lan-switch").hidden = first && !plain;
    if (box.hidden) return;
    $("lan-terms-first").hidden = asked || replaced;
    $("lan-terms-changed").hidden = !asked && !replaced;
    $("lan-terms-keeps").hidden = st.state !== "running";
    // The address comes from the authority's server; only an https address
    // becomes a link.
    var ok = terms.url.indexOf("https://") === 0;
    box.querySelectorAll(".terms-link").forEach(function (a) {
      if (ok) a.href = terms.url;
      else a.removeAttribute("href");
    });
    var accept = $("lan-terms-accept");
    accept.hidden = !ok;
    if (!accept.disabled) accept.textContent = w(st.state === "running" ? "terms.continue" : "terms.turnOn");
    $("lan-terms-retry").hidden = !terms.failed;
  }

  function loadTerms() {
    var out = $("lan-terms-result");
    terms.loading = true;
    say(out, w("terms.reading"), "");
    api("GET", "lan/terms").then(function (t) {
      terms = { url: t.url, none: !t.url, read: true, accepted: t.accepted, loading: false, failed: "" };
      say(out, "", "");
    }, function (err) {
      terms = noTerms();
      terms.failed = err.message;
      say(out, err.message, "error");
    }).then(function () { if (state) renderTerms(state.lan); });
  }

  // acceptTerms sends the acceptance of the agreement shown. With the
  // listener off it first saves the address the list shows, as the switch
  // does, since the acceptance turns the listener on.
  function acceptTerms() {
    var out = $("lan-terms-result");
    var url = terms.url;
    var done = busy($("lan-terms-accept"), w("terms.asking"));
    say(out, "", "");
    var ready = state.lan.status.state === "running" ? Promise.resolve() : api("PUT", "lan", lanBody());
    ready.then(function () { return api("POST", "lan/terms", { url: url }); })
      .then(function () {
        qrFor = "";
        settledFor = "";
        done();
        return refresh(false);
      }, function (err) {
        done();
        terms = noTerms();
        return refresh(false).then(function () { say(out, err.message, "error"); });
      });
  }

  var stageOrder = ["publish", "check"];

  // showProgress shows, while turning on, the stage under way and how far
  // it has come: how many of deSEC's servers show the record or, on a
  // network that hides them, the seconds of the fixed wait. Before deSEC
  // is asked, the first stage is under way with no count.
  function showProgress(st) {
    var box = $("lan-progress");
    box.hidden = st.state !== "starting";
    if (box.hidden) return;
    var p = st.progress || { stage: "publish", done: 0, total: 0 };
    var at = stageOrder.indexOf(p.stage);
    box.querySelectorAll("[data-stage]").forEach(function (row) {
      var i = stageOrder.indexOf(row.dataset.stage);
      var m = row.querySelector(".tick-mark");
      if (!m.firstChild) m.appendChild(icon("done"));
      row.classList.toggle("is-ticked", i < at);
      row.classList.toggle("is-next", i === at);
    });
    var counting = p.stage === "publish" && p.total > 0;
    var bar = $("lan-bar");
    bar.hidden = !counting;
    if (counting) {
      bar.max = p.total;
      bar.value = p.done;
    }
    var line = "";
    if (counting && p.timed) {
      line = w("progress.timed", { left: duration(p.total - p.done) });
    } else if (counting) {
      line = w("progress.count", { done: p.done, total: p.total });
    }
    if (p.again) line = w("progress.again") + (line ? " " + line : "");
    $("lan-bar-words").textContent = line;
    $("lan-elapsed").textContent = w("progress.elapsed", { time: duration(st.elapsed || 0) });
  }

  function duration(secs) {
    var m = Math.floor(secs / 60), s = secs % 60;
    if (!m) return w("duration.s", { s: s });
    return s ? w("duration.ms", { m: m, s: s }) : w("duration.m", { m: m });
  }

  var portWhy = { "in-use": w("port.inUse"), "not-allowed": w("port.notAllowed") };
  var portsFor = "";

  function loadPorts() {
    return api("GET", "lan/ports").then(renderPorts, function () {});
  }

  // renderPorts explains the number at the end of the address whenever
  // there is one, and offers a way out whenever the number can't be used.
  // Only the person changes the number.
  function renderPorts(p) {
    var cur = p.current;
    var running = state && state.lan.status.state === "running";
    var offer = 0, head = "", body = "", kind = "";
    if (cur.use !== "free" && !running) {
      kind = "error";
      head = w("port.unusableHead", { port: cur.port });
      body = w("port.unusableBody", { port: cur.port, why: portWhy[cur.use] });
      if (p.suggested) {
        offer = p.suggested;
        body += " " + (p.suggested === 443 ? w("port.suggest443") : w("port.suggest", { port: p.suggested }));
      } else {
        body += " " + w("port.chooseAnother");
      }
    } else if (cur.port !== 443) {
      kind = "warn";
      head = w("port.endsHead", { port: cur.port });
      if (p.default.use !== "free") {
        body = w("port.blocked443", { why: portWhy[p.default.use], port: cur.port });
      } else {
        body = w("port.free443", { port: cur.port });
        offer = 443;
      }
    }
    var note = $("port-note");
    note.hidden = !kind;
    note.classList.toggle("is-error", kind === "error");
    $("port-note-head").textContent = head;
    $("port-note-body").textContent = body;
    var flowNote = $("flow-port-note");
    flowNote.hidden = !kind;
    flowNote.classList.toggle("is-error", kind === "error");
    flowNote.querySelector(".port-head").textContent = head;
    flowNote.querySelector(".port-body").textContent = body;
    var use = $("port-note-use");
    use.hidden = !offer;
    use.textContent = w("port.useN", { port: offer });
    use.dataset.port = offer;
    fillPortPick(p);
  }

  // fillPortPick lists 443, the usual other number and a free one, each
  // with why it can't be used when it can't, and a number of one's own.
  function fillPortPick(p) {
    var sel = $("lan-port-pick");
    var cur = p.current.port;
    var seen = {};
    sel.textContent = "";
    function add(port, label, use) {
      if (!port || seen[port]) return;
      seen[port] = true;
      var o = document.createElement("option");
      var blocked = use !== "free";
      o.value = String(port);
      if (port === cur) label = w("port.setNow", { label: label });
      if (blocked) label = w("port.cantUse", { label: label, why: portWhy[use] });
      o.textContent = label;
      o.disabled = blocked && port !== cur;
      sel.appendChild(o);
    }
    add(443, w("port.option443"), p.default.use);
    add(p.fallback.port, String(p.fallback.port), p.fallback.use);
    add(p.suggested, String(p.suggested), "free");
    add(cur, String(cur), p.current.use);
    var other = document.createElement("option");
    other.value = "other";
    other.textContent = w("port.another");
    sel.appendChild(other);
    sel.value = String(cur);
    $("lan-port-other-label").hidden = true;
  }

  // usePort sets the number; a switch that is on turns off and on again,
  // so the new address works at once.
  function usePort(port, out) {
    var on = $("lan-on").checked;
    var body = lanBody();
    say(out, "", "");
    if (port === body.port) {
      say(out, w("port.same"), "");
      return;
    }
    body.port = port;
    api("PUT", "lan", body)
      .then(function () { return on ? api("POST", "lan/stop").then(function () { return api("POST", "lan/start"); }) : null; })
      .then(function () {
        qrFor = "";
        var address = "https://" + state.lan.name.domain + (port === 443 ? "" : ":" + port) + "/app";
        say(out, w("port.saved", { address: address }), "ok");
        return refresh(true);
      }, function (err) { say(out, err.message, "error"); });
  }

  function loadQR(url) {
    qrFor = url;
    api("GET", "lan/qr.png").then(function (blob) {
      if (qrURL) URL.revokeObjectURL(qrURL);
      qrURL = URL.createObjectURL(blob);
      $("lan-qr").src = qrURL;
    }, function () { qrFor = ""; });
  }

  function loadAddresses(selected) {
    api("GET", "lan/addresses").then(function (res) {
      var sel = $("lan-address");
      sel.textContent = "";
      if (res.addresses.length === 0) {
        var none = document.createElement("option");
        none.value = "";
        none.textContent = w("addr.none");
        sel.appendChild(none);
        return;
      }
      res.addresses.forEach(function (a) {
        var o = document.createElement("option");
        o.value = a.ip;
        o.textContent = (a.preferred ? w("addr.recommended", { name: a.interface }) : a.interface) + " · " + a.ip;
        o.selected = selected ? a.ip === selected : a.preferred;
        sel.appendChild(o);
      });
    }, showError);
  }

  // renderWaiting shows where deSEC's activation link stands, and asks again
  // in 15 seconds until it is used or expires.
  function renderWaiting(n, first) {
    clearTimeout(nameTimer);
    nameTimer = 0;
    var linked = n.state === "linked";
    $("waiting-on").hidden = linked;
    $("name-done").hidden = !linked;
    if (linked) {
      $("done-domain").textContent = n.domain;
      showFoot();
      return;
    }
    $("waiting-email").textContent = n.email;
    $("waiting-domain").textContent = n.domain;
    var waited = Date.now() - new Date(n.requested).getTime();
    $("waiting-slow").hidden = n.state === "expired" || waited < 5 * 60 * 1000;
    if (n.state === "expired") {
      say($("waiting-status"), w("wait.expired"), "error");
      return;
    }
    say($("waiting-status"), n.problem
      ? w("wait.problem", { problem: n.problem })
      : w("wait.waiting"), n.problem ? "warn" : "");
    nameTimer = setTimeout(checkName, first ? 1000 : 15000);
  }

  // checkName asks the host to ask deSEC whether the link was used.
  function checkName() {
    if (document.hidden) { nameTimer = setTimeout(checkName, 15000); return; }
    api("GET", "lan/name").then(function (n) {
      if (n.state === "linked") return refresh(true);
      if (onStep("home", 2)) renderWaiting(n, false);
    }, function (err) {
      say($("waiting-status"), err.message, "error");
      nameTimer = setTimeout(checkName, 15000);
    });
  }

  function stopWaiting() {
    clearTimeout(nameTimer);
    nameTimer = 0;
  }

  // newPassword shows a fresh password and asks again whether it is saved.
  function newPassword() {
    $("name-password").textContent = "";
    forgetSaved();
    api("POST", "lan/name/password").then(function (r) {
      $("name-password").textContent = r.password;
      showFoot();
    }, showError);
  }

  function forgetSaved() {
    var row = $("saved-row");
    if (row.dataset.row) tick(row, false);
  }


  function clearNameResults() {
    ["name-email-result", "name-name-result", "name-result"].forEach(function (id) { say($(id), "", ""); });
  }

  // nameRefused shows a refusal next to the field it concerns, on the step
  // that has the field.
  function nameRefused(err) {
    var at = { "refused-email": "name-email-result", "refused-name": "name-name-result" }[err.code];
    var text = err.message;
    if (err.code === "refused-name" && text.indexOf("deSEC says") === 0) text += " " + w("name.another");
    if (at) go(0);
    say($(at || "name-result"), text, "error");
  }

  // checkNameForm answers whether the first home step is filled in, and says
  // what is missing next to the field.
  function checkNameForm() {
    var f = $("name-form");
    clearNameResults();
    var ok = true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value.trim())) {
      say($("name-email-result"), w("name.emailMissing"), "error");
      ok = false;
    }
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(f.name.value.trim())) {
      say($("name-name-result"), w("name.nameInvalid"), "error");
      ok = false;
    }
    return ok;
  }

  function createName() {
    var f = $("name-form");
    clearNameResults();
    var done = busy($("flow-next"), w("askingDesec"));
    // The button works only once the row of deSEC's limits is ticked; the
    // click is the acceptance of its terms.
    var accepted = !!ticks[$("limits-row").dataset.row];
    api("POST", "lan/name", { email: f.email.value.trim(), name: f.name.value.trim(), password: $("name-password").textContent, accepted: accepted })
      .then(function () { return refresh(false); }, nameRefused)
      .then(function () { done(); showFoot(); });
  }

  // The flow.

  function steps(name) {
    var all = Array.prototype.slice.call(document.querySelectorAll('.step[data-flow="' + name + '"]'));
    if (name === "home" && existingName) all[0] = document.querySelector('.step[data-flow="home-existing"]');
    return all;
  }

  // useExistingName switches the first phones step between a new free name
  // and a name someone already has at deSEC.
  function useExistingName(yes) {
    existingName = yes;
    var step = flow.step;
    flow.step = -1;
    go(step);
  }

  // suspect marks the row that is probably wrong, opens how to check it, and
  // scrolls to it. The list starts again from that row.
  function suspect(row) {
    if (!row) return;
    var scope = row.closest("[data-scope]");
    var rows = scopeRows(scope);
    rows.slice(rows.indexOf(row)).forEach(function (r) { delete ticks[r.dataset.row]; });
    saveTicks();
    trail(scope);
    showFoot();
    row.classList.add("is-suspect");
    showMore(row, ".row-done", true);
    row.scrollIntoView({ block: "center" });
  }

  // showMore shows or hides a row's reason or its check, which sel names.
  // A row shows one of them at a time.
  function showMore(row, sel, on) {
    var more = row.querySelector(sel);
    if (!more) return;
    if (on) {
      var other = sel === ".row-why" ? ".row-done" : ".row-why";
      if (row.querySelector(other)) showMore(row, other, false);
    }
    more.hidden = !on;
    var b = row.querySelector('.more-link[data-more="' + sel + '"]');
    if (b) b.setAttribute("aria-expanded", on ? "true" : "false");
  }

  function onStep(name, step) {
    return !!flow && flow.name === name && flow.step === step;
  }

  // openFlow opens a setup at step. opts may name a row of it that is
  // probably wrong (mark), or say the setup reuses a Google project made
  // before (existing).
  function openFlow(name, step, opts) {
    opts = opts || {};
    flow = { name: name, step: -1 };
    if (opts.existing) flow.existing = true;
    $("home").hidden = true;
    $("flow").hidden = false;
    if (name === "google") resetClientStep();
    if (name === "home") existingName = false;
    go(step);
    settle();
    if (opts.mark && flow) suspect(steps(name)[flow.step].querySelector(opts.mark));
  }

  function closeFlow() {
    stopWaiting();
    stopTrial();
    if (flow) clearTicks(flowTicks[flow.name]);
    flow = null;
    remember(null);
    $("flow").hidden = true;
    $("home").hidden = false;
    window.scrollTo(0, 0);
    return refresh(true).then(function () {
      if (state && googleSet(state.google)) return checkGoogle();
    });
  }

  function go(step) {
    var all = steps(flow.name);
    step = Math.max(0, Math.min(step, all.length - 1));
    var moved = flow.step !== step;
    flow.step = step;
    remember(flow);
    document.querySelectorAll(".step").forEach(function (el) { el.hidden = el !== all[step]; });
    var dots = $("flow-dots");
    dots.textContent = "";
    all.forEach(function (el, i) {
      var d = document.createElement("span");
      if (i <= step) d.className = i === step ? "is-here" : "is-past";
      dots.appendChild(d);
    });
    dots.setAttribute("aria-label", w("flow.dots", { flow: flowNames[flow.name], step: step + 1, total: all.length }));
    dots.hidden = all.length < 2;
    entered();
    showFoot();
    if (moved) {
      window.scrollTo(0, 0);
      all[step].querySelector("h2").focus({ preventScroll: true });
    }
  }

  function entered() {
    $("existing-lead").hidden = !flow.existing;
    if (flow.name !== "home" || flow.step !== 2) stopWaiting();
    stopTrial();
    if (onStep("google", trialStep)) enterTrial();
    if (onStep("home", 1) && !$("name-password").textContent) newPassword();
    if (onStep("home", 2) && state) renderWaiting(state.lan.name, true);
  }

  // showFoot sets the footer for the step: Back except on the first step or
  // where the step says none, and the next button with the step's own words
  // unless the step has its own action. A step opened to fix what the trial
  // found leads back to the trial. The next button works only once every row
  // of the step is done, and is then the page's main button.
  function showFoot() {
    if (!flow || flow.step < 0) return;
    var el = steps(flow.name)[flow.step];
    var next = el.getAttribute("data-next") || w(flow.returnTo !== undefined ? "flow.trialAgain" : "continue");
    if (onStep("home", 2) && !$("name-done").hidden) next = w("continue");
    var complete = Array.prototype.every.call(el.querySelectorAll("[data-scope]"), function (s) {
      return scopeRows(s).every(function (r) { return !!ticks[r.dataset.row]; });
    });
    $("flow-next").classList.toggle("primary", complete);
    var done = onStep("google", 4) && !$("google-done").hidden || onStep("google", trialStep) && !$("trial-done").hidden;
    $("flow-back").hidden = flow.step === 0 || el.getAttribute("data-back") === "none" || done;
    $("flow-next").hidden = next === "none";
    $("flow-next").textContent = next;
    $("flow-next").disabled = !complete || onStep("home", 1) && !$("name-password").textContent;
  }

  function next() {
    if (onStep("home", 0)) { if (checkNameForm()) go(1); return; }
    if (onStep("home", 1)) return createName();
    if (flow.returnTo !== undefined) {
      var to = flow.returnTo;
      delete flow.returnTo;
      return go(to);
    }
    if (flow.step === steps(flow.name).length - 1) return closeFlow();
    go(flow.step + 1);
  }

  // settle keeps an open flow in line with the state: the home flow follows
  // where the name stands. A name just confirmed is said on the waiting step,
  // which waits for Continue; a name linked from an existing account goes on
  // to the last step.
  function settle() {
    if (!flow || !state) return;
    if (flow.name !== "home") return;
    var n = state.lan.name.state;
    if (!googleSet(state.google)) { closeFlow(); return; }
    if (n === "linked") {
      if (flow.step < 2) go(3);
      else if (flow.step === 2) renderWaiting(state.lan.name, false);
      return;
    }
    if ((n === "waiting" || n === "expired") && flow.step < 2) go(2);
    if (n === "none" && flow.step === 2) go(0);
  }

  // The settings.

  function render(s, fillForms) {
    state = s;
    bind(s);
    document.title = w("title");
    $("google-open").href = s.local;
    renderGoogle(s.google);
    renderHome(s);
    renderLAN(s.lan, fillForms);
    $("start-at-login").checked = s.startAtLogin;
    $("wipe-google").disabled = !googleSet(s.google);
    if (s.startAtLoginError) say($("login-result"), s.startAtLoginError, "error");
    settle();
  }

  function refresh(fillForms) {
    return api("GET", "state").then(function (s) { render(s, fillForms === true); }, showError);
  }

  function lanError(err) {
    return refresh(false).then(function () { say($("lan-status"), err.message, "error"); });
  }

  function lanBody() {
    return { port: state.lan.config.port, address: $("lan-form").address.value };
  }

  // saveLAN stores the connection as soon as it changes; a
  // switch that is on turns off and on again, so they apply at once.
  function saveLAN() {
    var out = $("lan-form-result");
    var on = $("lan-on").checked;
    say(out, "", "");
    api("PUT", "lan", lanBody())
      .then(function () { return on ? api("POST", "lan/stop").then(function () { return api("POST", "lan/start"); }) : null; })
      .then(function () { qrFor = ""; say(out, w("saved"), "ok"); return refresh(true); },
        function (err) { say(out, err.message, "error"); });
  }

  function wire() {
    // A language chosen is saved and the page loads again in it; the tab
    // keeps the key and the place in the flow.
    $("language").addEventListener("change", function (e) {
      e.target.disabled = true;
      api("PUT", "language", { language: e.target.value }).then(function () { location.reload(); }, function (err) {
        e.target.disabled = false;
        showError(err);
      });
    });
    // A block of code is copied from the line that leads into it, so the
    // row's buttons stay with its words.
    document.querySelectorAll(".sheet code").forEach(function (code) {
      code.parentNode.insertBefore(copyButton(code), code.classList.contains("block") ? code : null);
    });
    // A row that says why it matters, or how to check it, offers each on
    // request, at its right.
    document.querySelectorAll(".sheet-row").forEach(function (row) {
      var links = document.createElement("span");
      links.className = "row-links";
      [[".row-why", w("more.why")], [".row-done", w("more.done")]].forEach(function (m) {
        if (!row.querySelector(m[0])) return;
        var b = document.createElement("button");
        b.type = "button";
        b.className = "quiet more-link";
        b.textContent = m[1];
        b.setAttribute("aria-expanded", "false");
        b.dataset.more = m[0];
        b.addEventListener("click", function () { showMore(row, m[0], row.querySelector(m[0]).hidden); });
        links.appendChild(b);
      });
      if (links.firstChild) row.appendChild(links);
    });
    document.querySelectorAll("[data-scope]").forEach(trail);

    $("lan-url").parentNode.appendChild(copyButton($("lan-url")));
    $("google-setup").addEventListener("click", function () { openFlow("google", 0); });
    $("google-existing").addEventListener("click", function () { openFlow("google", 4, { existing: true }); });
    $("google-change").addEventListener("click", function () { openFlow("google", 4); });
    $("google-trial").addEventListener("click", function () { openFlow("google", trialStep); });
    $("google-people").addEventListener("click", function () { openFlow("people", 0); });
    $("google-try").addEventListener("click", function () { go(trialStep); });
    $("trial-start").addEventListener("click", openTrial);
    document.querySelector("#trial-verdict .trial-again").addEventListener("click", openTrial);
    document.querySelector("#trial-verdict .trial-fix").addEventListener("click", fixTrial);
    try { new BroadcastChannel("phospheare-oauth").onmessage = function (e) { trialAnswered(e.data); }; } catch (err) { /* The page then asks every few seconds. */ }
    window.addEventListener("message", function (e) { if (e.origin === location.origin) trialAnswered(e.data); });
    $("home-setup").addEventListener("click", function () { openFlow("home", 0); });
    $("home-continue").addEventListener("click", function () { openFlow("home", 2); });

    $("flow-close").addEventListener("click", closeFlow);
    $("google-finish").addEventListener("click", closeFlow);
    $("flow-back").addEventListener("click", function () { go(flow.step - 1); });
    $("flow-next").addEventListener("click", next);

    // Words that name a control on the page do what it does. A control on a
    // later row of the list skips to that row.
    document.addEventListener("click", function (e) {
      var j = e.target.closest(".jump");
      if (!j) return;
      var target = $(j.getAttribute("data-for"));
      var row = target.closest(".sheet-row");
      if (row && row.closest("[data-scope]")) skipTo(row);
      target.click();
    });
    // An Open button ticks its row and turns plain once used, so what comes
    // next is what stands out.
    document.addEventListener("click", function (e) {
      var a = e.target.closest(".open-page");
      if (!a) return;
      a.classList.remove("primary");
      var row = a.closest(".sheet-row");
      if (row && row.querySelector(".tick-mark")) tick(row, true);
    });

    $("paste-instead").addEventListener("click", function () { clientMode("paste"); $("client-paste").clientId.focus(); });
    $("file-instead").addEventListener("click", function () { clientMode("file"); });
    $("client-paste").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target;
      var id = f.clientId.value.trim();
      var secret = f.clientSecret.value.trim();
      if (!id || !secret) {
        say($("paste-result"), w("paste.both"), "error");
        return;
      }
      say($("paste-result"), "", "");
      saveClient(id, secret, "paste");
    });
    document.querySelector("#step-verdict .verdict-again").addEventListener("click", checkClientAgain);
    document.querySelector("#step-verdict .verdict-redo").addEventListener("click", function () {
      var lost = !$("lost-secret").hidden;
      resetClientStep();
      $("lost-secret").hidden = !lost;
      suspect(steps("google")[4].querySelector('[data-key="download"]'));
    });
    $("google-file").addEventListener("change", function (e) { readClientFile(e.target.files[0]); });
    var drop = $("google-drop");
    drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("is-over"); });
    drop.addEventListener("dragleave", function () { drop.classList.remove("is-over"); });
    drop.addEventListener("drop", function (e) {
      e.preventDefault();
      drop.classList.remove("is-over");
      readClientFile(e.dataTransfer.files[0]);
    });

    document.querySelector("#card-verdict .verdict-again").addEventListener("click", checkGoogle);
    document.querySelector("#card-verdict .verdict-redo").addEventListener("click", function () {
      openFlow("google", 4, { mark: '[data-key="download"]' });
    });

    $("name-form").addEventListener("submit", function (e) { e.preventDefault(); next(); });
    $("use-existing").addEventListener("click", function () { useExistingName(true); });
    $("use-new").addEventListener("click", function () { useExistingName(false); });

    $("link-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target;
      say($("link-result"), "", "");
      var done = busy($("link-save"), w("askingDesec"));
      api("PUT", "lan/name", { name: f.name.value.trim(), token: f.token.value.trim() })
        .then(function () { f.token.value = ""; return refresh(true); }, function (err) { say($("link-result"), err.message, "error"); })
        .then(done);
    });

    $("name-restart").addEventListener("click", function () {
      stopWaiting();
      api("DELETE", "lan/name").then(function () {
        // The next attempt makes a new account, with a new password.
        $("name-password").textContent = "";
        clearTicks(["h"]);
        return refresh(false);
      }, showError);
    });

    // An address that already has a deSEC account gets no new email: the
    // waiting ends, and the first step takes the existing account.
    $("waiting-existing").addEventListener("click", function () {
      stopWaiting();
      api("DELETE", "lan/name").then(function () {
        $("name-password").textContent = "";
        clearTicks(["h"]);
        return refresh(false);
      }).then(function () { if (flow) useExistingName(true); }, showError);
    });

    $("name-unlink").addEventListener("click", function () {
      if (!window.confirm(w("unlink.confirm", { domain: state.lan.name.domain }))) return;
      api("DELETE", "lan/name").then(function () {
        qrFor = "";
        $("name-password").textContent = "";
        clearTicks(["h"]);
        return refresh(true);
      }, lanError);
    });

    $("lan-form").addEventListener("submit", function (e) { e.preventDefault(); saveLAN(); });
    $("lan-address").addEventListener("change", saveLAN);
    $("lan-port-pick").addEventListener("change", function () {
      var other = this.value === "other";
      $("lan-port-other-label").hidden = !other;
      if (other) $("lan-port-other").focus();
    });
    $("lan-port-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var pick = $("lan-port-pick").value;
      var port = parseInt(pick === "other" ? $("lan-port-other").value : pick, 10) || 0;
      if (port < 1 || port > 65535) {
        say($("lan-port-result"), w("port.range"), "error");
        return;
      }
      usePort(port, $("lan-port-result"));
    });
    $("port-note-use").addEventListener("click", function () {
      $("lan-port").open = true;
      usePort(parseInt(this.dataset.port, 10), $("lan-port-result"));
    });
    $("port-note-choose").addEventListener("click", function () {
      $("lan-port").open = true;
      $("lan-port").scrollIntoView({ block: "nearest" });
      $("lan-port-pick").focus();
    });

    // Turning on saves the address the list shows first, so the listener
    // starts on the one the person sees.
    $("lan-on").addEventListener("change", function (e) {
      var on = e.target.checked;
      var change = on
        ? api("PUT", "lan", lanBody()).then(function () {
          // With an authority that names no agreement, the first turn-on
          // is recorded as the acceptance.
          return terms.none && !state.lan.config.termsAccepted ? api("POST", "lan/terms", { url: "" }) : api("POST", "lan/start");
        })
        : api("POST", "lan/stop");
      change.then(function () { qrFor = ""; return refresh(false); }, lanError);
    });

    $("lan-terms-accept").addEventListener("click", acceptTerms);
    $("lan-terms-retry").addEventListener("click", function () {
      terms.failed = "";
      renderTerms(state.lan);
    });

    $("start-at-login").addEventListener("change", function (e) {
      var out = $("login-result");
      api("PUT", "start-at-login", { enabled: e.target.checked }).then(function () {
        say(out, w(e.target.checked ? "login.on" : "login.off"), "ok");
      }, function (err) { say(out, err.message, "error"); refresh(false); });
    });

    $("sign-out-all").addEventListener("click", function () {
      if (!window.confirm(w("browsers.confirm"))) return;
      var out = $("browsers-result");
      api("POST", "sign-out-browsers").then(function () {
        say(out, w("browsers.done"), "ok");
      }, function (err) { say(out, err.message, "error"); });
    });

    // A wipe goes back to the top, where the card to set up again now is.
    function wipe(button, path, question) {
      if (!window.confirm(w(question))) return;
      say($("wipe-result"), "", "");
      var done = busy(button, w("wiping"));
      // The button comes back before the settings do, which may disable it.
      api("POST", path).then(function () {
        done();
        clearTicks([""]);
        remember(null);
        cardVerdict = null;
        qrFor = "";
        $("name-password").textContent = "";
        return refresh(true).then(function () { window.scrollTo(0, 0); });
      }, function (err) {
        done();
        say($("wipe-result"), err.message, "error");
        return refresh(false);
      });
    }
    $("wipe-google").addEventListener("click", function (e) {
      wipe(e.currentTarget, "wipe/google", "wipe.googleConfirm");
    });
    $("wipe-everything").addEventListener("click", function (e) {
      wipe(e.currentTarget, "wipe/everything", "wipe.everythingConfirm");
    });

    $("check-updates").addEventListener("click", function () {
      var out = $("updates-result");
      say(out, "", "");
      var done = busy($("check-updates"), w("checking"));
      api("POST", "updates/check").then(function (res) {
        out.textContent = "";
        var text = w(!res.known ? "updates.newest" : res.newer ? "updates.available" : "updates.current", { version: res.latest }) + " ";
        out.appendChild(document.createTextNode(text));
        var a = document.createElement("a");
        a.href = res.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = w("updates.open");
        out.appendChild(a);
        out.className = "result" + (res.newer ? " is-warn" : " is-ok");
      }, function (err) { say(out, err.message, "error"); }).then(done);
    });

    $("quit").addEventListener("click", function () {
      if (!window.confirm(w("quit.confirm"))) return;
      api("POST", "quit").then(function () {
        say($("quit-result"), w("quit.done"), "ok");
        document.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
      }, function (err) { say($("quit-result"), err.message, "error"); });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    // A new action clears the previous error before its own handler runs.
    document.addEventListener("click", function (e) { if (e.target.closest("button")) showError(null); }, true);
    document.addEventListener("submit", function () { showError(null); }, true);
    // Coming back from the email checks at once.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      comeBack();
      askTrial();
      if (onStep("home", 2) && nameTimer) {
        clearTimeout(nameTimer);
        checkName();
      }
    });
    wire();
    refresh(true).then(function () {
      var f = remembered();
      if (f && state) openFlow(f.name, f.step, { existing: f.existing });
      else if (state && googleSet(state.google)) checkGoogle();
      // The tray's "Open on a phone or tablet" arrives here.
      if (location.hash === "#phones") $("card-home").scrollIntoView({ block: "start" });
    });
  });
})();
