#!/usr/bin/env node
// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Measures the grouping questions against temptation. The fact check
// asks a model which place and thing names are one thing, which labels are
// one fact and which free-word values are one value, and a wrong answer
// erases a disagreement, or invents one, before any judge sees it. This runs
// the app's own grouping step
// (`application/entities.ts`: `groupEntities`, `groupLabels`, `groupValues`,
// in the order `checkFacts` calls them) over the adversarial set in
// `src/ai/eval/grouping.ts`, then the real candidate builder over the
// result, and scores each case three ways:
//
//   raw         the model put the pair in one group (its own answer, read
//               back from the numbered question it was shown)
//   kept        the code kept them as one after its guards
//   candidate   a candidate was raised on the pair exactly when the book
//               disagrees there: what the writer would be shown
//
// Each language's set is asked `--repeats` times, fresh each time (no kept
// answer is reused), so a case the model gets right once and wrong once
// shows as such.
//
//   node scripts/grouping-eval.mjs --provider openrouter
//       --model openai/gpt-6-luna-pro [--lang en,it] [--repeats 3]
//       [--out report.json]
//   node scripts/grouping-eval.mjs --model qwen3:8b …   (Ollama on loopback)
//   node scripts/grouping-eval.mjs --dry …   (a stub that groups nothing)
//
// The key comes from `PHOSPHEARE_OPENROUTER_KEY` alone (`eval-common.mjs`).
// Only the invented set's names, labels and values are sent.

/* global AbortController */
import { writeFile } from "node:fs/promises";
import {
  arg,
  flag,
  Metered,
  modelProvenance,
  moduleServer,
  OpenRouter,
  OPENROUTER,
  openRouterGate,
  stagesOf,
  Stub,
  treeProvenance,
} from "./eval-common.mjs";

const endpoint = (
  process.env.PHOSPHEARE_OLLAMA_URL ?? "http://localhost:11434"
).replace(/\/$/, "");
const dry = flag("dry");
const providerName = dry ? "stub" : arg("provider", "ollama");
const modelId = dry
  ? "stub"
  : arg("model", process.env.PHOSPHEARE_OLLAMA_MODEL);
const languages = arg("lang", "en,it").split(",").filter(Boolean);
const repeats = Number(arg("repeats", "3"));
const out = arg("out");
if (!modelId || !["ollama", "openrouter", "stub"].includes(providerName)) {
  console.error(
    "usage: node scripts/grouping-eval.mjs [--provider ollama|openrouter] --model <model> [--lang en,it] [--repeats 3] [--out report.json] | --dry",
  );
  process.exit(2);
}

/**
 * The provider with each question and its answer kept, in memory, so the
 * model's own groups can be read back before any guard of the code's.
 */
class Recorded {
  calls = [];
  constructor(inner) {
    this.inner = inner;
    this.id = inner.id;
  }
  listModels(...args) {
    return this.inner.listModels(...args);
  }
  describeModel(...args) {
    return this.inner.describeModel(...args);
  }
  estimate(...args) {
    return this.inner.estimate(...args);
  }
  async *generate(request, signal) {
    const call = {
      question: request.messages.at(-1)?.content ?? "",
      answer: "",
    };
    this.calls.push(call);
    for await (const event of this.inner.generate(request, signal)) {
      if (event.type === "text-delta") call.answer += event.text;
      yield event;
    }
  }
  take() {
    const calls = this.calls;
    this.calls = [];
    return calls;
  }
}

async function save(report) {
  if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
}

async function run(listing) {
  const { server, load } = await moduleServer();
  try {
    const [grouping, entities, candidates, ollama, entitiesDomain] =
      await Promise.all([
        load("/src/ai/eval/grouping.ts"),
        load("/src/ai/application/entities.ts"),
        load("/src/ai/domain/candidates.ts"),
        load("/src/ai/adapters/ollama.ts"),
        load("/src/ai/domain/entities.ts"),
      ]);
    const metered = new Metered(
      dry
        ? new Stub()
        : providerName === "openrouter"
          ? new OpenRouter(process.env.PHOSPHEARE_OPENROUTER_KEY, listing)
          : new ollama.OllamaProvider(endpoint),
    );
    const provider = new Recorded(metered);
    const signal = new AbortController().signal;
    const descriptor = await provider.describeModel(
      { providerId: provider.id, modelId },
      signal,
    );
    const report = {
      model: modelId,
      provenance: {
        tree: treeProvenance(),
        provider: providerName,
        model: await modelProvenance({
          dry,
          providerName,
          modelId,
          endpoint,
          listing,
        }),
        endpoint: dry
          ? null
          : providerName === "openrouter"
            ? OPENROUTER
            : endpoint,
        recipes: { entities: entitiesDomain.ENTITY_RECIPE_REVISION },
      },
      configuration: { repeats, languages },
      at: new Date().toISOString(),
      runs: [],
    };
    for (const language of languages) {
      const cases = grouping.GROUPING_CASES[language];
      const book = grouping.groupingBook(cases);
      const ledgers = book.map((one) => one.ledger);
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        // A fresh assistant folder every time: no kept answer is reused.
        const deps = {
          model: provider,
          descriptor,
          modelRef: { providerId: provider.id, modelId },
          artifacts: {
            readEntities: async () => null,
            writeEntities: async () => undefined,
          },
        };
        const started = performance.now();
        provider.take();
        metered.take();
        const asked = async (part, step) => {
          const result = await step();
          return {
            result,
            raw: provider
              .take()
              .flatMap((call) =>
                grouping.rawGroups(part, call.question, call.answer),
              ),
          };
        };
        const names = await asked("names", () =>
          entities.groupEntities(ledgers, deps, signal),
        );
        const labels = await asked("labels", () =>
          entities.groupLabels(ledgers, deps, signal),
        );
        const values = await asked("values", () =>
          entities.groupValues(ledgers, labels.result.grouped, deps, signal),
        );
        const kept = {
          names: names.result.grouped,
          labels: labels.result.grouped,
          values: values.result.grouped,
        };
        const raised = candidates.candidates(book, new Set(), {
          entities: kept.names,
          labels: kept.labels,
          values: kept.values,
        });
        const raw = {
          names: names.raw,
          labels: labels.raw,
          values: values.raw,
        };
        const scored = grouping.scoreGrouping(cases, {
          raw,
          kept,
          candidates: raised,
        });
        const row = {
          language,
          repeat,
          seconds: Math.round((performance.now() - started) / 1000),
          groupedRight: scored.filter((one) => one.groupedRight).length,
          candidateRight: scored.filter((one) => one.candidateRight).length,
          cases: scored,
          raw,
          kept: Object.fromEntries(
            Object.entries(kept).map(([part, map]) => [
              part,
              Object.fromEntries(map),
            ]),
          ),
          candidates: raised.map((one) => one.key),
          stages: stagesOf(metered.take()),
        };
        report.runs.push(row);
        await save(report);
        const wrong = scored
          .filter((one) => !one.groupedRight || !one.candidateRight)
          .map(
            (one) =>
              `${one.id}(${one.join ? "missed" : "merged"}${one.joinedRaw !== one.joinedKept ? ", guard undid the model" : ""}${one.candidateRight ? "" : one.raised ? ", candidate invented" : ", candidate lost"})`,
          );
        console.error(
          `[${language}] run ${repeat}: grouped right ${row.groupedRight}/${cases.length}, candidates right ${row.candidateRight}/${cases.length}, ${row.seconds}s${wrong.length ? `; wrong: ${wrong.join(", ")}` : ""}`,
        );
      }
    }
    await save(report);
  } finally {
    await server.close();
  }
}

const { listing, refusal } = await openRouterGate(providerName, modelId);
if (refusal) {
  console.error(refusal);
  process.exitCode = 2;
} else await run(listing);
