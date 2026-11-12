#!/usr/bin/env node
// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Measures the prompt layers on matched tasks. The app's own
// assistant (`application/assistant.ts`, one fresh chat per request, its own
// tools over the invented book) answers the matched tasks of
// `src/ai/eval/layers.ts` in two arms that differ only in the layers under
// test:
//
//   layers   the shipped prompt: the persona block `composeVoice` writes
//            (voice, preset obsessions, referrals, skills line, craft
//            lenses) and a declared genre
//   bare     the persona block emptied and no genre declared: the global
//            policy, the project briefing and the room's rules alone
//
// Same model, same rooms (general, editorial), same personas and presets
// (Phos on its default, Nova on line, Spark on structure), same books, same
// requests. Each answer is scored twice: by the facts it must carry (a
// word test) and by a blind grader (the same model, shown the book, the
// request and the answer and never the arm, the room or the persona) on
// whether the request was done, whether any part was handed off instead of
// done, and whether the answer is relevant. Completion and relevance are
// scored, not persona compliance alone.
//
// The persona block is emptied on the instance (`resolvePersona`, which the
// turn calls when it runs), so everything else a persona touches stays the
// same in both arms: the documents its preset reads and the signals its
// obsessions look for. The system prompt of every turn is measured, so the
// report shows that the arms differ.
//
//   node scripts/layers-eval.mjs --provider openrouter
//       --model openai/gpt-6-luna-pro [--lang en,it] [--out report.json]
//   node scripts/layers-eval.mjs --dry …
//
// Remote only: the key comes from `PHOSPHEARE_OPENROUTER_KEY` alone
// (`eval-common.mjs`), and only the invented books are sent.

/* global AbortController, structuredClone */
import { writeFile } from "node:fs/promises";
import {
  arg,
  corpus,
  flag,
  Metered,
  modelProvenance,
  moduleServer,
  OpenRouter,
  OPENROUTER,
  openRouterGate,
  Sources,
  stagesOf,
  Stub,
  treeProvenance,
} from "./eval-common.mjs";

const dry = flag("dry");
const providerName = dry ? "stub" : arg("provider", "openrouter");
const modelId = dry ? "stub" : arg("model");
const languages = arg("lang", "en,it").split(",").filter(Boolean);
const out = arg("out");
const concurrency = Number(arg("concurrency", "4"));
if (!modelId || !["openrouter", "stub"].includes(providerName)) {
  console.error(
    "usage: node scripts/layers-eval.mjs --provider openrouter --model <model> [--lang en,it] [--concurrency 4] [--out report.json] | --dry",
  );
  process.exit(2);
}

const ROOMS = ["general", "editorial"];
const CELLS = [
  { personaId: "10", preset: undefined },
  { personaId: "20", preset: "line" },
  { personaId: "30", preset: "structure" },
];
const ARMS = ["layers", "bare"];
const TITLES = { en: "The Pass", it: "Il faro" };
const LANGUAGE_NAMES = { en: "English", it: "Italian" };

/** The assistant folder, in memory: everything the port offers. */
class MemoryArtifacts {
  chats = new Map();
  reviews = new Map();
  summaries = new Map();
  ledgers = new Map();
  async listChats() {
    return { chats: [...this.chats.values()], unreadable: [] };
  }
  async loadChat(id) {
    const chat = this.chats.get(id);
    if (!chat) throw new Error("missing-chat");
    return chat;
  }
  async saveChat(chat) {
    this.chats.set(chat.id, structuredClone(chat));
    return {};
  }
  async deleteChatFile() {}
  async deleteChat(id) {
    this.chats.delete(id);
  }
  async saveReview(review) {
    this.reviews.set(review.runId, structuredClone(review));
  }
  async loadReview(runId) {
    const review = this.reviews.get(runId);
    if (!review) throw new Error("missing-review");
    return review;
  }
  async deleteReview(runId) {
    this.reviews.delete(runId);
  }
  async readSummary(nodeId) {
    return this.summaries.get(nodeId) ?? null;
  }
  async writeSummary(nodeId, metadata, body) {
    this.summaries.set(nodeId, { metadata, body });
  }
  async readLedger(sourceId) {
    return this.ledgers.get(sourceId) ?? null;
  }
  async writeLedger(ledger) {
    this.ledgers.set(ledger.sourceId, ledger);
  }
  async readJudgements() {
    return null;
  }
  async writeJudgements() {}
  async readEntities() {
    return null;
  }
  async writeEntities() {}
}

/**
 * The provider with each chat request's system prompt measured: the proof
 * that the arms differ where they should, and nowhere else.
 */
class Watched {
  prompts = [];
  /** Characters of the `REFERENCE` fences in each answering request. */
  references = [];
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
  generate(request, signal) {
    if (!request.output) {
      this.prompts.push(request.instructions ?? "");
      this.references.push(referenceCharacters(request.messages ?? []));
    }
    return this.inner.generate(request, signal);
  }
}

/**
 * How many characters of `messages` are attached references: each fence the
 * context writes (`fenced`, `--- REFERENCE … ---`) to the next fence or the
 * end of its message. What the reference pass costs a request.
 */
function referenceCharacters(messages) {
  let total = 0;
  for (const message of messages) {
    const text =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? "");
    const fence = /^--- (SOURCE|REFERENCE|PASSAGE) .* ---$/gmu;
    const marks = [...text.matchAll(fence)];
    marks.forEach((mark, at) => {
      if (mark[1] !== "REFERENCE") return;
      const end = marks[at + 1]?.index ?? text.length;
      total += end - mark.index;
    });
  }
  return total;
}

/** Runs `jobs` with at most `limit` at once, results in order. */
async function pooled(jobs, limit) {
  const results = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      while (next < jobs.length) {
        const at = next;
        next += 1;
        results[at] = await jobs[at]();
      }
    }),
  );
  return results;
}

async function save(report) {
  if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
}

async function run(listing) {
  const { server, load } = await moduleServer();
  try {
    const [assistantModule, personas, layers, plant, reader] =
      await Promise.all([
        load("/src/ai/application/assistant.ts"),
        load("/src/ai/domain/personas.ts"),
        load("/src/ai/eval/layers.ts"),
        load("/src/ai/eval/plant.ts"),
        load("/src/editor/assistant/sourceText.ts"),
      ]);
    const metered = new Metered(
      dry
        ? new Stub()
        : new OpenRouter(process.env.PHOSPHEARE_OPENROUTER_KEY, listing),
    );
    const signal = new AbortController().signal;
    const modelRef = { providerId: metered.id, modelId };
    const names = personas.PERSONAS.map((one) => one.name);
    const report = {
      model: modelId,
      provenance: {
        tree: treeProvenance(),
        provider: providerName,
        model: await modelProvenance({
          dry,
          providerName,
          modelId,
          endpoint: null,
          listing,
        }),
        endpoint: dry ? null : OPENROUTER,
      },
      configuration: {
        languages,
        rooms: ROOMS,
        cells: CELLS,
        arms: ARMS,
        genre: "literary",
      },
      at: new Date().toISOString(),
      rows: [],
      summary: {},
    };

    /** One request in one arm, room and voice: a fresh chat, one turn. */
    async function answer(language, book, task, room, cell, arm, facts) {
      const watched = new Watched(metered);
      const artifacts = new MemoryArtifacts();
      const assistant = new assistantModule.Assistant({
        // Read as the app's port reads.
        sources: new Sources(book, reader),
        artifacts,
        model: watched,
        defaultNode: () => null,
        projectFacts: () => ({
          title: TITLES[language],
          type: "Novel",
          language: LANGUAGE_NAMES[language],
          languageCode: language,
          ...(arm === "layers" ? { genres: ["literary"] } : {}),
        }),
      });
      if (arm === "bare")
        // The persona block emptied where the turn reads it; the persona's
        // preset reads and signals stay, the same in both arms.
        assistant.resolvePersona = (chat) => ({
          ...personas.personaById(chat.preferences.personaId, chat.kind),
          instructions: "",
        });
      const chat = await assistant.chats.create(room);
      await assistant.chats.updatePreferences({
        model: modelRef,
        personaId: cell.personaId,
        ...(cell.preset ? { preset: cell.preset } : {}),
      });
      const started = performance.now();
      await assistant.send(task.prompt);
      const turn = artifacts.chats
        .get(chat.id)
        ?.turns?.findLast((one) => one.role === "assistant");
      const text = turn?.text ?? "";
      const persona = personas.PERSONAS.find(
        (one) => one.id === cell.personaId,
      );
      return {
        language,
        task: task.id,
        specialty: task.specialty,
        room,
        persona: persona?.name ?? cell.personaId,
        preset: cell.preset ?? "default",
        arm,
        text,
        words: text.split(/\s+/u).filter(Boolean).length,
        outcome: turn?.outcome ?? "none",
        errorCode: turn?.errorCode ?? null,
        tools: (turn?.tools ?? []).map((one) => one.name),
        systemPromptChars: watched.prompts[0]?.length ?? 0,
        referenceChars: watched.references[0] ?? 0,
        facts: layers.factsCovered(text, facts),
        referrals: layers.referralsIn(text, persona?.name ?? "", names).length,
        seconds: Math.round((performance.now() - started) / 1000),
      };
    }

    /** The blind grade: the book, the request, the answer; nothing of who. */
    async function grade(row, bookText, prompt) {
      if (!row.text) return null;
      let said = "";
      for await (const event of metered.generate(
        {
          model: modelRef,
          instructions: layers.GRADER_INSTRUCTIONS,
          messages: [
            {
              role: "user",
              content: `THE BOOK:\n${bookText}\n\nTHE WRITER'S REQUEST:\n${prompt}\n\nTHE ANSWER:\n${row.text}`,
            },
          ],
          limits: { inputTokens: 32_000, outputTokens: 1_000 },
          effort: "off",
          output: { name: "grade_answer", schema: layers.GRADE_SCHEMA },
        },
        signal,
      ))
        if (event.type === "text-delta") said += event.text;
      return layers.gradeOf(said);
    }

    for (const language of languages) {
      const clean = await corpus(language);
      const planted = plant.plantErrors(clean, language, { seed: 1 });
      const tasks = layers.LAYER_TASKS[language];
      const jobs = [];
      for (const task of tasks) {
        const book = task.book === "planted" ? planted.sources : clean;
        const facts =
          task.book === "planted"
            ? planted.plants.map((one) => [one.after])
            : task.facts;
        const bookText = book
          .map((one) => `## ${one.title}\n${one.text}`)
          .join("\n\n");
        for (const room of ROOMS)
          for (const cell of CELLS)
            for (const arm of ARMS)
              jobs.push(async () => {
                const row = await answer(
                  language,
                  book,
                  task,
                  room,
                  cell,
                  arm,
                  facts,
                );
                row.grade = await grade(row, bookText, task.prompt);
                report.rows.push(row);
                await save(report);
                console.error(
                  `[${language}] ${task.id.padEnd(10)} ${room.padEnd(9)} ${row.persona.padEnd(5)} ${arm.padEnd(6)} done ${row.grade?.done ?? "?"}, handed off ${row.grade?.handedOff ?? "?"}, relevant ${row.grade?.relevant ?? "?"}, facts ${row.facts.toFixed(2)}, referrals ${row.referrals}, ${row.words} words, prompt ${row.systemPromptChars} chars, ${row.seconds}s${row.errorCode ? `, ${row.errorCode}` : ""}`,
                );
              });
      }
      await pooled(jobs, concurrency);
    }
    report.summary = {
      arms: layers.summarize(report.rows),
      bySpecialty: Object.fromEntries(
        [...new Set(report.rows.map((row) => row.specialty))].map(
          (specialty) => [
            specialty,
            layers.summarize(
              report.rows.filter((row) => row.specialty === specialty),
            ),
          ],
        ),
      ),
      byPersona: Object.fromEntries(
        [...new Set(report.rows.map((row) => row.persona))].map((persona) => [
          persona,
          layers.summarize(
            report.rows.filter((row) => row.persona === persona),
          ),
        ]),
      ),
      byRoom: Object.fromEntries(
        ROOMS.map((room) => [
          room,
          layers.summarize(report.rows.filter((row) => row.room === room)),
        ]),
      ),
      stages: stagesOf(metered.take()),
    };
    await save(report);
    console.log(JSON.stringify(report.summary.arms, null, 2));
  } finally {
    await server.close();
  }
}

const { listing, refusal } = await openRouterGate(providerName, modelId);
if (refusal) {
  console.error(refusal);
  process.exitCode = 2;
} else await run(listing);
