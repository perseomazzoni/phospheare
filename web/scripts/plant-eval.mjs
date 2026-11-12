#!/usr/bin/env node
// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The seeded-defect harness over a real project on this disk. Three
// commands, one book at a time, nothing sent anywhere.
//
//   node scripts/plant-eval.mjs seed <project> <copy> [--seed 1] [--per-kind 1]
//     Writes a planted copy of the project (a new id and title, no chats, no
//     summaries, no history) and its key beside it as `<copy>.key.json`,
//     outside the project, so no run can read it. Open the copy in the app
//     and run the reviews to measure.
//
//   node scripts/plant-eval.mjs score <copy> [--chat <file>]
//     Reads the copy's key and its chats (the newest, or the one named), and
//     reports per kind how many plants a finding quoted.
//
//   node scripts/plant-eval.mjs ledgers <copy>
//     After a fact check has run on the copy: for each plant, whether the
//     model wrote it into its Section's ledger, and whether the candidates
//     (`domain/candidates.ts`) raised it, so a miss is placed at the
//     extraction, the comparison or the judge. Also each ledger's
//     claims and dropped counts, and the ranked candidates with the verdict
//     the judge kept for each. Reads the stored files; calls no model.
//
// A qualification tool, not a CI gate: the gate over the same code runs on
// invented books in `src/ai/eval/harness.test.ts`. A writer's manuscript is
// read here from their own disk and never leaves it, and nothing of it is
// written into the repository.
//
// The TypeScript it measures is loaded through Vite, so it is the same code
// the app runs, not a copy.

import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";
import { parse } from "yaml";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
}

/**
 * A project folder read the way the app reads it: Sections in order, sheets
 * by shelf.
 */
async function loadProject(dir) {
  const properties = JSON.parse(
    await readFile(join(dir, "document-properties.json"), "utf8"),
  );
  const structure = parse(
    await readFile(join(dir, "document-structure.yaml"), "utf8"),
  );
  const sections = [];
  const walk = async (nodes) => {
    for (const node of nodes ?? []) {
      if (node.section && node.adopted)
        sections.push({
          id: `node:${node.id}`,
          title: node.section,
          file: join("document", node.adopted),
          text: await readFile(join(dir, "document", node.adopted), "utf8"),
        });
      await walk(node.children);
    }
  };
  await walk(structure.document);
  const shelves = { character: "characters", arc: "arcs", world: "world" };
  const sheets = [];
  const referenceDir = join(dir, "reference");
  const names = await readdir(referenceDir).catch(() => []);
  for (const name of names) {
    const shelf = shelves[name.split("--")[0]];
    if (!shelf || !name.endsWith(".md")) continue;
    sheets.push({
      id: `reference:${name}`,
      title: name.replace(/^[a-z]+--/, "").replace(/\.md$/, ""),
      group: shelf,
      file: join("reference", name),
      text: await readFile(join(referenceDir, name), "utf8"),
    });
  }
  return { language: properties.document.language ?? "en", sections, sheets };
}

async function modules() {
  const server = await createServer({
    root: WEB,
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  const load = (path) => server.ssrLoadModule(path);
  const [plant, score] = await Promise.all([
    load("/src/ai/eval/plant.ts"),
    load("/src/ai/eval/score.ts"),
  ]);
  return { server, plant, score };
}

async function seedCopy(dir, copy) {
  const seed = Number(arg("seed", "1"));
  const perKind = Number(arg("per-kind", "1"));
  if (
    await stat(copy).then(
      () => true,
      () => false,
    )
  )
    throw new Error(`${copy} already exists`);
  const book = await loadProject(dir);
  const m = await modules();
  try {
    const all = [...book.sections, ...book.sheets];
    const planted = m.plant.plantErrors(all, book.language, { seed, perKind });
    await cp(dir, copy, { recursive: true });
    // A fresh project: no chat, summary or history may carry the book as it
    // was before the plants.
    await rm(join(copy, "assistant"), { recursive: true, force: true });
    await mkdir(join(copy, "assistant"));
    for (const name of await readdir(join(copy, "reference")).catch(() => []))
      if (name.startsWith("summary--")) await rm(join(copy, "reference", name));
    await rm(join(copy, "history"), { recursive: true, force: true });
    const propertiesPath = join(copy, "document-properties.json");
    const properties = JSON.parse(await readFile(propertiesPath, "utf8"));
    properties.document.id = randomUUID();
    properties.document.title = basename(copy);
    await writeFile(propertiesPath, `${JSON.stringify(properties, null, 2)}\n`);
    for (const source of planted.sources) {
      const original = all.find((one) => one.id === source.id);
      if (original && original.text !== source.text)
        await writeFile(join(copy, original.file), source.text);
    }
    await writeFile(
      `${copy}.key.json`,
      `${JSON.stringify({ project: basename(dir), seed, perKind, plants: planted.plants }, null, 2)}\n`,
    );
    console.log(
      `planted ${planted.plants.length} errors into ${copy}; key at ${copy}.key.json`,
    );
    for (const plant of planted.plants)
      console.log(
        `  ${plant.kind.padEnd(8)} ${plant.sourceId}  «${plant.before}» → «${plant.after}»`,
      );
  } finally {
    await m.server.close();
  }
}

async function scoreCopy(copy) {
  const key = JSON.parse(await readFile(`${copy}.key.json`, "utf8"));
  const chats = (await readdir(join(copy, "assistant"))).filter(
    (name) => name.startsWith("chat--") && name.endsWith(".json"),
  );
  const named = arg("chat");
  const withTimes = await Promise.all(
    chats.map(async (name) => ({
      name,
      time: (await stat(join(copy, "assistant", name))).mtimeMs,
    })),
  );
  const picked = named
    ? [basename(named)]
    : withTimes
        .sort((a, b) => b.time - a.time)
        .slice(0, 1)
        .map((one) => one.name);
  const m = await modules();
  try {
    for (const name of picked) {
      const chat = JSON.parse(
        await readFile(join(copy, "assistant", name), "utf8"),
      );
      const findings = chat.turns.flatMap((turn) => turn.findings ?? []);
      const results = m.score.scoreFindings(key.plants, findings);
      console.log(`${name} — "${chat.title}", ${findings.length} findings`);
      // Two recalls: contact, when a finding quotes the planted words, and
      // diagnosis, when it also quotes the plant's witness (the sentence
      // where the book states the fact elsewhere) or the plant stands on its
      // own. The gap between them is the checker touching a plant without
      // the other side of the slip.
      const touched = m.score.recallByKind(
        results.map((one) => ({ plant: one.plant, hit: one.found })),
        m.plant.PLANT_KINDS,
      );
      const diagnosed = m.score.recallByKind(
        results.map((one) => ({
          plant: one.plant,
          hit:
            one.diagnosis === "witness" || one.diagnosis === "self-verifying",
        })),
        m.plant.PLANT_KINDS,
      );
      for (const [at, row] of touched.entries())
        console.log(
          `  ${row.kind.padEnd(8)} touched ${row.hit}/${row.planted}, diagnosed ${diagnosed[at].hit}/${row.planted}`,
        );
      for (const one of results)
        console.log(
          `  ${one.diagnosis.padEnd(14)} ${one.plant.kind.padEnd(8)} ${one.plant.sourceId} «${one.plant.after}»${one.explained === undefined ? "" : one.explained ? " (explained)" : " (not explained)"}`,
        );
    }
  } finally {
    await m.server.close();
  }
}

async function ledgersOf(copy) {
  const key = JSON.parse(await readFile(`${copy}.key.json`, "utf8"));
  const book = await loadProject(copy);
  const dir = join(copy, "assistant");
  const stored = new Map();
  for (const name of await readdir(dir))
    if (name.startsWith("facts--")) {
      const ledger = JSON.parse(await readFile(join(dir, name), "utf8"));
      stored.set(ledger.sourceId, ledger);
    }
  const server = await createServer({
    root: WEB,
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  try {
    const [cands, match, entities] = await Promise.all([
      server.ssrLoadModule("/src/ai/domain/candidates.ts"),
      server.ssrLoadModule("/src/ai/domain/textMatch.ts"),
      server.ssrLoadModule("/src/ai/domain/entities.ts"),
    ]);
    const all = [...book.sections, ...book.sheets];
    for (const source of all) {
      const ledger = stored.get(source.id);
      console.log(
        `${source.id.padEnd(40)} ${ledger ? `${String(ledger.claims.length).padStart(3)} claims, ${ledger.dropped ?? "?"} dropped` : "NO LEDGER"}`,
      );
    }
    const inBook = all.flatMap((source) => {
      const ledger = stored.get(source.id);
      return ledger ? [{ ledger, text: source.text }] : [];
    });
    // The kept groups of names, labels and values,
    // applied as the check does.
    const groupings = {};
    try {
      const kept = JSON.parse(
        await readFile(join(dir, "entities.json"), "utf8"),
      );
      const counted = (keyOf) => {
        const counts = new Map();
        for (const { ledger } of inBook)
          for (const claim of ledger.claims) {
            const key = keyOf(claim);
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        return counts;
      };
      groupings.entities = entities.aliasesOf(
        kept.names.groups,
        counted((claim) => entities.entityKey(claim.entity)),
      );
      groupings.labels = entities.aliasesOf(
        kept.labels.groups,
        counted((claim) => cands.labelKey(claim)),
      );
      const labelOf = (claim) =>
        groupings.labels.get(cands.labelKey(claim)) ?? cands.labelKey(claim);
      groupings.values = new Map(
        [
          ...entities.aliasesOf(
            kept.values.groups,
            counted((claim) => cands.valueKey(labelOf(claim), claim.norm)),
          ),
        ].map(([key, lead]) => [key, lead.split("|").slice(1).join("|")]),
      );
      console.log(
        `${kept.names.groups.length} name, ${kept.labels.groups.length} label and ${kept.values.groups.length} value groups`,
      );
    } catch {
      // No check has grouped any yet.
    }
    const found = cands.candidates(inBook, new Set(), groupings);
    console.log(`${found.length} candidates`);
    // The judge's kept verdicts, newest last, by candidate key.
    const verdicts = new Map();
    try {
      const kept = JSON.parse(
        await readFile(join(dir, "judgements.json"), "utf8"),
      );
      for (const [id, one] of Object.entries(kept.judgements))
        verdicts.set(decodeURIComponent(id.split(" ")[0]), one);
    } catch {
      // No check has kept any yet.
    }
    found.forEach((one, at) => {
      const verdict = verdicts.get(one.key);
      console.log(
        `  ${String(at + 1).padStart(3)} ${one.kind.padEnd(8)} ${one.key}  [${one.counts.join("/")}]${verdict ? `  → ${verdict.verdict}: ${verdict.explanation}` : ""}`,
      );
    });
    const holds = (quote, word) =>
      match.findTerms(quote, [word], { wholeWord: true }).length > 0;
    for (const plant of key.plants) {
      const claims = (stored.get(plant.sourceId)?.claims ?? []).filter(
        (claim) => holds(claim.quote, plant.after),
      );
      const raised = found.filter((one) =>
        one.sides.some(
          (side) =>
            side.sourceId === plant.sourceId && holds(side.quote, plant.after),
        ),
      );
      console.log(
        `  ${plant.kind.padEnd(8)} ${plant.sourceId} «${plant.after}»: ${claims.length ? `in the ledger (${claims.map((c) => `${c.entity}|${c.attribute}|${c.norm}`).join("; ")})` : "NOT in the ledger"}; ${raised.length ? `raised (${raised.map((one) => one.key).join("; ")})` : "not raised"}`,
      );
    }
  } finally {
    await server.close();
  }
}

const [command, first, second] = process.argv.slice(2);
if (command === "seed" && first && second) await seedCopy(first, second);
else if (command === "score" && first) await scoreCopy(first);
else if (command === "ledgers" && first) await ledgersOf(first);
else {
  console.error(
    "usage: plant-eval.mjs seed <project> <copy> | score <copy> [--chat <file>] | ledgers <copy>",
  );
  process.exit(2);
}
