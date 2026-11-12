#!/usr/bin/env node
// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Measures the fact check live on the invented books. The seeded-defect
// harness (`src/ai/eval/plant.ts`) plants slips into the two invented
// books under `src/ai/eval/corpus` (a lighthouse and a mountain hut, no
// writer's manuscript). This runs the app's own fact check over them
// (`ledgerTexts` → `checkFacts`: the ledgers, the grouping, the candidates,
// the judge) against the chosen model, and scores what comes back with the
// contract of `src/ai/eval/score.ts`:
//
//   found         a finding quotes the planted words from their source
//                 (evidence contact, which a mistaken finding makes too)
//   witnessed     … and quotes one of the plant's witnesses, the sentences
//                 where the book states the same fact (the planter records
//                 them when it chooses the plant)
//   diagnosis     witness | self-verifying | contact-only | missed
//   explained     the finding's own title and explanation name both the old
//                 words and the new (a word test, read apart from evidence)
//   stage         where a missed plant was lost: extraction (never in a
//                 ledger, or no counterpart claim), candidate (both sides in
//                 the ledgers, never raised: grouping or ranking), or
//                 judgment (raised; answered no slip, in no shape, or
//                 deferred past the cap). Publication is outside this runner:
//                 it scores `checkFacts` before any review publishes.
//   false         a finding on the planted book that touches no plant
//   control       findings on the unplanted book, every one a false positive
//   unjudged      candidates the judge answered in no shape, by identity;
//                 deferred, the ones past its cap, likewise
//   stages        calls, failures, milliseconds and tokens per request kind
//                 (write_facts, group_names, …, submit_judgement)
//
// Every finding is kept whole (title, explanation, uncertainty, evidence), so
// a reader can judge each one, not a count. The report opens with its
// provenance: commit and dirty flag, corpus digest, the model's digest and
// details from its provider's own listing, the recipe revisions and the caps.
//
// Two knobs the app never sets are exposed for a like-for-like comparison:
// how many times each text is read (`--reads`, the app's 2) and how many
// answers the judge asks for per candidate (`--samples`, the app's 3 on a
// device model). Run the shipped configuration and the single-pass one on
// the same model and seeds, and read the difference as what the repeats buy.
//
//   node scripts/fact-eval.mjs --model qwen3:8b [--lang en,it] [--seeds 1,2]
//                              [--reads 2] [--samples 3] [--out report.json]
//   node scripts/fact-eval.mjs --provider openrouter
//                              --model openai/gpt-6-luna-pro …
//   node scripts/fact-eval.mjs --dry [--out report.json]
//   node scripts/fact-eval.mjs --relabel report.json --out relabelled.json
//   node scripts/fact-eval.mjs --provider openrouter --model …
//                              --frozen report.json --samples 3 …
//
// `--provider openrouter` reaches a remote model directly, as the relay does
// for the app: the same OpenAI-shaped body the server builds
// (`OpenRouterProvider::outboundBody`), with
// `provider: {data_collection: "deny"}`, and the key from
// `PHOSPHEARE_OPENROUTER_KEY` and nowhere else, never an argument, a file or
// a log line. The only prose that leaves is the invented corpus. A remote
// descriptor is `kind: "remote"`, so the judge asks once per candidate unless
// `--samples` says otherwise, as in the app.
//
// `--relabel` re-reads a kept report's misses under the current stage
// rule (`src/ai/eval/stage.ts`), off the ledgers, groupings, plants and
// candidates the report kept for it; no model is called.
//
// `--frozen report.json` seeds every run's assistant folder with the
// ledgers and the kept groupings that report's matching run wrote, so the
// extraction and the grouping are cache hits and the model is asked only
// to judge. The plants are the same (same seed, same planter), the texts
// hash the same, the recipes must match, and the run refuses before any
// request when the report lacks a run it needs. It isolates the judge: two
// frozen runs at `--samples 1` and `--samples 3` differ only in how many
// times each candidate is asked about, whereas two live runs each extract
// afresh and cannot tell the judge's repeats from the extractor's variance.
// Each run records whether the freeze held (no call but the
// judge's) and whether its candidates are the frozen run's.
//
// `--corpus guided` runs the check over the guided book instead
// (`src/ai/eval/guided`): two lives of one woman told in turn, a
// guidebook page saying they are meant to disagree, and one disagreement
// inside a single life the page does not excuse. Nothing is planted; each
// run is scored against the book's `expect.json`. An explained disagreement
// found is a false positive the guidance should have prevented, and an
// unexplained one missed is a slip it hid. `--guidance off` runs the same
// book with the page left out, the arm that says what the guidance changed.
//
// `--corpus references` runs it over the reference fixture book
// (`src/ai/eval/references`): the app's own templates filled (two
// character sheets, one with a renamed field, an arc, the world's rules, a
// timeline, the continuity page) and a free note, against five Sections
// written to hold each case the catalogue must get right: a claim kept
// apart from the fact, a qualification deep in a long answer, a plan not
// yet written, a rule broken where no fact pairs, its exception kept, a
// belief kept a belief, a nickname's guidance. It is scored against its
// `expect.json` as the guided book is, with each rule's coverage and the
// field every reference quote was bound to.
//
// `--dry` runs the whole pipeline against a stub that states no facts: no
// model, seconds, every plant lost at extraction. It proves the runner and
// its report, never the check. With `--frozen` it proves the freeze: the
// frozen candidates are rebuilt and nothing is extracted.
//
// A qualification tool, not a CI gate: a model is not deterministic, and a
// flaky assertion about one would poison the suite. With Ollama nothing
// leaves the machine; `PHOSPHEARE_OLLAMA_URL` names the endpoint.

/* global AbortController, URL */
import { readFile, writeFile } from "node:fs/promises";
import {
  arg,
  corpus,
  flag,
  Metered,
  modelProvenance,
  moduleServer,
  OpenRouter,
  OPENROUTER,
  revisionOf,
  openRouterGate,
  Sources,
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
if (!["ollama", "openrouter", "stub"].includes(providerName)) {
  console.error(`unknown provider ${providerName}: ollama or openrouter`);
  process.exit(2);
}
const languages = arg("lang", "en,it").split(",").filter(Boolean);
const seeds = arg("seeds", "1").split(",").filter(Boolean).map(Number);
const reads = Number(arg("reads", "2"));
const samples = Number(arg("samples", "3"));
const out = arg("out");
const relabel = arg("relabel");
const frozenPath = arg("frozen");
// The book: `corpus` (the planted measurements), `guided`, whose guidebook
// explains two of its three disagreements, or `references`, the
// reference fixture book; `--guidance off` is the same book with
// the guidebook never written.
const corpusSet = arg("corpus", "corpus");
const guidance = arg("guidance", "on") !== "off";
/** The books scored against the disagreements they were written with. */
const EXPECTED = ["guided", "references"];
if (!["corpus", ...EXPECTED].includes(corpusSet)) {
  console.error(`unknown corpus ${corpusSet}: corpus, guided or references`);
  process.exit(2);
}
/** The stages a missed plant can be lost at, as the tally orders them. */
const STAGES = ["extraction", "unpaired", "grouping", "candidate", "judgment"];
if (!modelId && !relabel) {
  console.error(
    "usage: node scripts/fact-eval.mjs [--provider ollama|openrouter] --model <model> [--lang en,it] [--seeds 1] [--reads 2] [--samples 3] [--frozen report.json] [--corpus corpus|guided] [--guidance on|off] [--out report.json] | --dry | --relabel report.json --out relabelled.json",
  );
  process.exit(2);
}

/** The project's assistant folder, in memory: a fresh one per run. */
class Store {
  ledgers = new Map();
  judgements = null;
  entities = null;
  async readLedger(sourceId) {
    return this.ledgers.get(sourceId) ?? null;
  }
  async writeLedger(ledger) {
    this.ledgers.set(ledger.sourceId, ledger);
  }
  async readJudgements() {
    return this.judgements;
  }
  async writeJudgements(judgements) {
    this.judgements = judgements;
  }
  async readEntities() {
    return this.entities;
  }
  async writeEntities(groups) {
    this.entities = groups;
  }
  ruleChecks = null;
  async readRuleChecks() {
    return this.ruleChecks;
  }
  async writeRuleChecks(checks) {
    this.ruleChecks = checks;
  }
}

const identity = (candidate) => ({
  key: candidate.key,
  kind: candidate.kind,
  entity: candidate.entity,
  attribute: candidate.attribute,
  sourceIds: [...new Set(candidate.sides.map((side) => side.sourceId))],
});

async function modules() {
  const { server, load } = await moduleServer();
  const [
    plant,
    score,
    stage,
    ledger,
    factList,
    judge,
    ollama,
    match,
    ledgerDomain,
    entitiesDomain,
    judgementDomain,
    reader,
    validate,
  ] = await Promise.all([
    load("/src/ai/eval/plant.ts"),
    load("/src/ai/eval/score.ts"),
    load("/src/ai/eval/stage.ts"),
    load("/src/ai/application/ledger.ts"),
    load("/src/ai/application/factList.ts"),
    load("/src/ai/application/judge.ts"),
    load("/src/ai/adapters/ollama.ts"),
    load("/src/ai/domain/textMatch.ts"),
    load("/src/ai/domain/ledger.ts"),
    load("/src/ai/domain/entities.ts"),
    load("/src/ai/domain/judgement.ts"),
    load("/src/editor/assistant/sourceText.ts"),
    load("/src/ai/application/validateEvidence.ts"),
  ]);
  return {
    server,
    plant,
    score,
    stage,
    ledger,
    factList,
    judge,
    ollama,
    match,
    ledgerDomain,
    entitiesDomain,
    judgementDomain,
    reader,
    validate,
  };
}

/**
 * One fact check over `sources`, scored against `plants` (none for a
 * control).
 */
async function check(
  m,
  provider,
  descriptor,
  language,
  sources,
  plants,
  frozen = null,
  frozenIdentity = null,
) {
  // Read as the app's port reads: notes and unanswered questions
  // stripped, names as the adapter finds them.
  const port = new Sources(sources, m.reader);
  const store = new Store();
  // A frozen run's ledgers and groupings, as its assistant folder held
  // them: the pipeline finds them fresh (same text hash, same recipe, same
  // Section list) and asks the model for nothing but judgements.
  if (frozen) {
    for (const ledger of frozen.artifacts.ledgers)
      store.ledgers.set(ledger.sourceId, ledger);
    store.entities = frozen.artifacts.groupings;
  }
  const signal = new AbortController().signal;
  const deps = {
    sources: port,
    artifacts: store,
    model: provider,
    descriptor,
    // Kept groupings are bound to the model that answered, so a dry run
    // over frozen artifacts wears that model's name: the stub answers
    // nothing anyway, and the proof is that nothing but judging is asked.
    modelRef:
      dry && frozen && frozenIdentity
        ? frozenIdentity
        : { providerId: provider.id, modelId },
    language: language === "it" ? "Italian" : "English",
    reads,
    samples,
  };
  provider.take();
  const started = performance.now();
  // The check as the chat assembles it (`factCheckInputs`): every
  // Section and fact sheet, and the references the continuity command
  // declares beyond them — the guidebook and the notes — each read once,
  // into ledgers where a fact may be read, to the judge by record, and to
  // the rule check.
  const inputs = await m.factList.factCheckInputs(
    port,
    port.catalog,
    new Set(port.catalog.map((one) => one.id)),
    port.catalog.filter(
      (one) =>
        (one.kind === "reference" && one.group === "guidebook") ||
        one.kind === "note",
    ),
    undefined,
    signal,
  );
  const result = await m.factList.checkFacts(
    {
      task: "continuity",
      ...inputs,
      book: port.catalog.filter((one) => one.kind === "manuscript"),
    },
    deps,
    signal,
  );
  const seconds = (performance.now() - started) / 1000;
  const calls = provider.take();
  // Every finding's evidence against what the check read, by the chat's
  // own evidence check: each quote must still stand in its source,
  // and a reference quote inside the field the finding names, which the
  // check set where it knew the record. The guarantee is structural, so any
  // finding that fails it is a defect, never a model's miss.
  const captures = new Map();
  for (const one of port.catalog) captures.set(one.id, await port.read(one.id));
  const sourceKinds = new Map(port.catalog.map((one) => [one.id, one]));
  const fieldsOf = (evidence) =>
    JSON.stringify(evidence.map((anchor) => anchor.field ?? null));
  const bound = result.findings.map((finding) => {
    const checked = m.validate.validateFinding(finding, captures, sourceKinds);
    return (
      checked.droppedAnchors === 0 &&
      fieldsOf(checked.finding.evidence) === fieldsOf(finding.evidence)
    );
  });
  const scored = m.score.scoreFindings(plants, result.findings);
  const touched = (finding) =>
    plants.find((plant) =>
      finding.evidence.some(
        (anchor) =>
          anchor.sourceId === plant.sourceId &&
          m.match.fold(anchor.quote).includes(m.match.fold(plant.after)),
      ),
    );
  const diagnosed = (one) =>
    one.diagnosis === "witness" || one.diagnosis === "self-verifying";
  const count = (rows, test) => rows.filter(test).length;
  const kinds = [...new Set(plants.map((one) => one.kind))];
  // Where each missed plant was lost (`src/ai/eval/stage.ts`): off the
  // run's own ledgers, its kept groupings and its candidates. The rule
  // lives in that module, with its tests, because matching a counterpart by
  // the exact spelling of `entity|attribute` calls every grouping loss an
  // extraction one.
  const losses = scored.map((one) =>
    m.stage.stageOf(
      one,
      { ledgers: store.ledgers, groupings: store.entities },
      result,
    ),
  );
  // Whether the freeze held: nothing but judgements asked, and the very
  // candidates the frozen run raised. A thawed run is still reported, but
  // it is not a measurement of the judge alone, and says so.
  const keysOf = (raised) => raised.map((one) => one.key).sort();
  const held = frozen
    ? {
        from: frozen.kind === "control" ? "control" : `seed ${frozen.seed}`,
        reused: calls.every((call) => call.stage === "submit_judgement"),
        thawed: stagesOf(
          calls.filter((call) => call.stage !== "submit_judgement"),
        ),
        sameCandidates:
          JSON.stringify(keysOf(result.raised)) ===
          JSON.stringify(keysOf(frozen.artifacts.raised ?? [])),
        frozenCandidates: (frozen.artifacts.raised ?? []).length,
      }
    : null;
  return {
    plants: plants.length,
    // Findings whose every quote stands in its source and field.
    evidenceBound: count(bound, Boolean),
    // Each rule the check held the prose to, and how much of the scope its
    // verdict speaks for: `unmatched` is never "kept".
    rules: result.rules,
    // Each note on who knows what, reported the same way.
    knowing: result.knowing,
    found: count(scored, (one) => one.found),
    witnessed: count(scored, (one) => one.witnessed),
    diagnosed: count(scored, diagnosed),
    contactOnly: count(scored, (one) => one.diagnosis === "contact-only"),
    explained: count(scored, (one) => one.explained === true),
    byKind: Object.fromEntries(
      kinds.map((kind) => {
        const mine = scored.filter((one) => one.plant.kind === kind);
        return [
          kind,
          {
            planted: mine.length,
            found: count(mine, (one) => one.found),
            witnessed: count(mine, (one) => one.witnessed),
            selfVerifying: count(
              mine,
              (one) => one.diagnosis === "self-verifying",
            ),
            contactOnly: count(mine, (one) => one.diagnosis === "contact-only"),
            explained: count(mine, (one) => one.explained === true),
          },
        ];
      }),
    ),
    plantsScored: scored.map((one, at) => ({
      kind: one.plant.kind,
      sourceId: one.plant.sourceId,
      before: one.plant.before,
      after: one.plant.after,
      witnesses: one.plant.witnesses?.length ?? 0,
      selfVerifying: one.plant.selfVerifying === true,
      found: one.found,
      witnessed: one.witnessed,
      diagnosis: one.diagnosis,
      explained: one.explained ?? null,
      stage: `${losses[at].stage}: ${losses[at].detail}`,
    })),
    // The misses by the stage they were lost at, the split that recall work
    // aims by.
    lossByStage: Object.fromEntries(
      STAGES.map((stage) => [
        stage,
        losses.filter((one) => one.stage === stage).length,
      ]),
    ),
    falsePositives: count(result.findings, (one) => !touched(one)),
    findings: result.findings.map((one, at) => {
      const plant = touched(one);
      return {
        bound: bound[at],
        id: one.id,
        severity: one.severity,
        title: one.title,
        explanation: one.explanation,
        uncertainty: one.uncertainty ?? null,
        evidence: one.evidence.map((anchor) => ({
          sourceId: anchor.sourceId,
          quote: anchor.quote,
          ...(anchor.field ? { field: anchor.field } : {}),
        })),
        touchesPlant: plant
          ? `${plant.kind} ${plant.sourceId} «${plant.before}» → «${plant.after}»`
          : null,
      };
    }),
    read: result.read,
    unread: result.unread.map((source) => source.id),
    candidates: result.candidates,
    candidatesByKind: Object.fromEntries(
      [...new Set(result.raised.map((one) => one.kind))].map((kind) => [
        kind,
        count(result.raised, (one) => one.kind === kind),
      ]),
    ),
    judged: result.judged,
    unjudged: result.unresolved.map(identity),
    deferred: result.deferred.map(identity),
    stages: stagesOf(calls),
    frozen: held,
    steps: result.usage.steps,
    inputTokens: result.usage.inputTokens ?? null,
    outputTokens: result.usage.outputTokens ?? null,
    seconds: Math.round(seconds),
    // What the run kept, so its misses can be re-labelled offline when
    // the stage rule changes, without running again.
    artifacts: {
      ledgers: [...store.ledgers.values()],
      groupings: store.entities,
      raised: result.raised,
      // Every verdict the judge gave, with its title and explanation: a
      // candidate raised and then silenced is read here, not guessed at.
      judgements: store.judgements,
      // Each rule the check held the prose to, and how much of the scope
      // its verdict speaks for.
      rules: result.rules,
      ruleChecks: store.ruleChecks,
      plants,
    },
  };
}

/** The report so far, after every run: a run this long may be cut short. */
async function save(report) {
  if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
}

// Refused before anything is sent or the module server starts: a missing
// key or an unlisted model is a reason to do nothing. `exitCode` rather than
// `process.exit`: a fetch dispatcher still open when the process is torn
// down trips a libuv assertion on Windows, and the code would read 127.
const { listing, refusal } = relabel
  ? { listing: [], refusal: null }
  : await openRouterGate(providerName, modelId);
if (relabel) await relabelReport(relabel);
else if (refusal) {
  console.error(refusal);
  process.exitCode = 2;
} else await run();

/** One clause on whether a frozen run's freeze held, for the progress line. */
function frozenNote(run) {
  if (!run.frozen) return "";
  const { reused, sameCandidates } = run.frozen;
  return ` [frozen: ${reused ? "judge only" : "THAWED, extraction ran"}, candidates ${sameCandidates ? "identical" : "DIFFER"}]`;
}

/**
 * The report `--frozen` names, read once, and its run for a language and a
 * seed (`null` for the control). A run the report lacks is a reason to
 * stop before anything is sent: a comparison with half its rows frozen
 * mixes the extractor's variance back in.
 */
async function frozenReport() {
  if (!frozenPath) return null;
  const report = JSON.parse(await readFile(frozenPath, "utf8"));
  const runOf = (language, seed) =>
    report.runs.find(
      (run) =>
        run.language === language &&
        run.seed === seed &&
        run.artifacts?.ledgers?.length,
    ) ?? null;
  const missing = languages.flatMap((language) =>
    [null, ...seeds]
      .filter((seed) => !runOf(language, seed))
      .map(
        (seed) => `${language} ${seed === null ? "control" : `seed ${seed}`}`,
      ),
  );
  if (missing.length) {
    console.error(
      `${frozenPath} holds no ledgers for: ${missing.join(", ")}; nothing was sent.`,
    );
    process.exitCode = 2;
    return null;
  }
  return {
    report,
    runOf,
    identity: {
      providerId: report.provenance.provider,
      modelId: report.model,
    },
  };
}

async function run() {
  const frozen = await frozenReport();
  if (frozenPath && !frozen) return;
  const m = await modules();
  try {
    const provider = new Metered(
      dry
        ? new Stub()
        : providerName === "openrouter"
          ? new OpenRouter(process.env.PHOSPHEARE_OPENROUTER_KEY, listing)
          : new m.ollama.OllamaProvider(endpoint),
    );
    const descriptor = await provider.describeModel(
      { providerId: provider.id, modelId },
      new AbortController().signal,
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
        recipes: {
          ledger: m.ledgerDomain.LEDGER_RECIPE_REVISION,
          entities: m.entitiesDomain.ENTITY_RECIPE_REVISION,
          judge: m.judgementDomain.JUDGE_RECIPE_REVISION,
        },
        caps: {
          ledgerReads: m.ledger.LEDGER_READS,
          judgeMax: m.judge.JUDGE_MAX,
          judgeSamples: m.judge.JUDGE_SAMPLES,
          judgeContext: m.judge.JUDGE_CONTEXT,
        },
        corpus: {},
      },
      descriptor: {
        kind: descriptor.kind,
        contextTokens: descriptor.contextTokens ?? null,
        tools: descriptor.capabilities.tools,
        structuredOutput: descriptor.capabilities.structuredOutput,
      },
      configuration: {
        reads,
        samples,
        task: "continuity",
        frozen: frozenPath ?? null,
        corpus: corpusSet,
        guidance,
      },
      at: new Date().toISOString(),
      runs: [],
    };
    // What the frozen ledgers came from, so the comparison names its
    // extraction once: the report, its tree, its model, its time.
    if (frozen)
      report.provenance.frozen = {
        from: frozenPath,
        at: frozen.report.at,
        tree: frozen.report.provenance.tree,
        model: frozen.report.model,
        configuration: frozen.report.configuration,
        recipes: frozen.report.provenance.recipes,
      };
    for (const language of languages) {
      const book = await corpus(language, { set: corpusSet, guidance });
      report.provenance.corpus[language] = {
        files: book.map((one) => one.id),
        characters: book.reduce((sum, one) => sum + one.text.length, 0),
        digest: revisionOf(
          book.map((one) => `${one.id}\n${one.text}`).join("\n"),
        ),
      };
      // The unmodified book first: what the check says of a book with
      // nothing planted is the false-positive floor every planted run is
      // read against.
      console.error(`[${language}] control…`);
      const control = await check(
        m,
        provider,
        descriptor,
        language,
        book,
        [],
        frozen?.runOf(language, null),
        frozen?.identity,
      );
      // The guided and reference books are scored against the disagreements
      // they were written with, and nothing is planted into them: their
      // expectations are the plants.
      const expected = EXPECTED.includes(corpusSet)
        ? m.score.scoreExpectations(
            JSON.parse(
              await readFile(
                new URL(
                  `../src/ai/eval/${corpusSet}/${language}/expect.json`,
                  import.meta.url,
                ),
                "utf8",
              ),
            ),
            control.findings,
          )
        : null;
      report.runs.push({
        language,
        seed: null,
        kind: "control",
        ...control,
        ...(expected ? { expected } : {}),
      });
      await save(report);
      console.error(
        `[${language}] control: ${control.findings.length} findings, ${control.candidates} candidates, ${control.unjudged.length} unjudged, ${control.deferred.length} deferred, ${control.steps} steps, ${control.seconds}s${frozenNote(control)}`,
      );
      if (expected) {
        for (const one of expected.expectations)
          console.error(
            `  ${one.id.padEnd(15)} ${one.explained ? "explained  " : "unexplained"}${one.known ? ` (known ${one.known})` : ""}: ${one.findings} finding(s)`,
          );
        console.error(`  other findings: ${expected.unexpected}`);
        for (const [what, list] of [
          ["rule", control.rules],
          ["knowing", control.knowing ?? []],
        ])
          for (const rule of list)
            console.error(
              `  ${what} ${rule.label}${rule.entity ? ` (${rule.entity})` : ""}: ${rule.coverage}, ${rule.examined} passage(s)${rule.unanswered ? ", unanswered" : ""}`,
            );
        console.error(
          `  evidence bound: ${control.evidenceBound}/${control.findings.length}`,
        );
        continue;
      }
      for (const seed of seeds) {
        const planted = m.plant.plantErrors(book, language, { seed });
        console.error(
          `[${language}] seed ${seed}: ${planted.plants.length} plants…`,
        );
        const run = await check(
          m,
          provider,
          descriptor,
          language,
          planted.sources,
          planted.plants,
          frozen?.runOf(language, seed),
          frozen?.identity,
        );
        report.runs.push({ language, seed, kind: "planted", ...run });
        await save(report);
        console.error(
          `[${language}] seed ${seed}: found ${run.found}/${run.plants}, witnessed ${run.witnessed}, diagnosed ${run.diagnosed}, contact-only ${run.contactOnly}, false ${run.falsePositives}, candidates ${run.candidates}, judged ${run.judged}, unjudged ${run.unjudged.length}, deferred ${run.deferred.length}, ${run.steps} steps, ${run.seconds}s${frozenNote(run)}`,
        );
        for (const one of run.plantsScored)
          console.error(
            `  ${one.kind.padEnd(8)} «${one.before}» → «${one.after}»: ${one.diagnosis}${one.explained === null ? "" : `, explained ${one.explained}`}; ${one.stage}`,
          );
      }
    }
    const table = [
      "| language | seed | kind | plants | found | witnessed | self-verifying | contact-only | false positives | candidates | judged | unjudged | deferred | steps | in tokens | out tokens | seconds |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
      ...report.runs.map(
        (run) =>
          `| ${run.language} | ${run.seed ?? "—"} | ${run.kind} | ${run.plants} | ${run.found} | ${run.witnessed} | ${run.diagnosed - run.witnessed} | ${run.contactOnly} | ${run.falsePositives} | ${run.candidates} | ${run.judged} | ${run.unjudged.length} | ${run.deferred.length} | ${run.steps} | ${run.inputTokens ?? "?"} | ${run.outputTokens ?? "?"} | ${run.seconds} |`,
      ),
    ].join("\n");
    console.log(
      `\n${modelId}, reads ${reads}, samples ${samples}${frozenPath ? `, frozen from ${frozenPath}` : ""}, ${report.at}\n\n${table}\n`,
    );
    await save(report);
  } finally {
    await m.server.close();
  }
}

/**
 * A kept report re-read under the current stage rule, no model called:
 * each run's ledgers, kept groupings, plants and raised candidates are
 * saved for this (`artifacts`), so a rule that changes does not
 * cost a run to re-label the misses. Written to `--out`, the source
 * untouched; the provenance says which tree re-read it and when.
 */
async function relabelReport(path) {
  if (!out) {
    console.error("--out names where the re-labelled report goes.");
    process.exitCode = 2;
    return;
  }
  const report = JSON.parse(await readFile(path, "utf8"));
  const m = await modules();
  try {
    for (const run of report.runs) {
      if (!run.artifacts?.plants?.length) continue;
      const scored = m.score.scoreFindings(run.artifacts.plants, run.findings);
      const losses = scored.map((one) =>
        m.stage.stageOf(
          one,
          {
            ledgers: new Map(
              run.artifacts.ledgers.map((ledger) => [ledger.sourceId, ledger]),
            ),
            groupings: run.artifacts.groupings,
          },
          {
            raised: run.artifacts.raised ?? [],
            unresolved: run.unjudged,
            deferred: run.deferred,
          },
        ),
      );
      run.plantsScored.forEach((row, at) => {
        row.stage = `${losses[at].stage}: ${losses[at].detail}`;
      });
      run.lossByStage = Object.fromEntries(
        STAGES.map((stage) => [
          stage,
          losses.filter((one) => one.stage === stage).length,
        ]),
      );
      console.log(
        `[${run.language}] seed ${run.seed}: ${JSON.stringify(run.lossByStage)}`,
      );
    }
    report.provenance.relabelled = {
      at: new Date().toISOString(),
      tree: treeProvenance(),
    };
    await save(report);
  } finally {
    await m.server.close();
  }
}
