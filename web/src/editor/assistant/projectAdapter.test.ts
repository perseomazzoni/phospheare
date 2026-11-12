// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { serializeSummary } from "../../ai/adapters/summaryCodec";
import { serializeChat } from "../../ai/adapters/chatCodec";
import { CHARACTER_NAMES_MAX } from "../../ai/application/budgets";
import { JUDGE_RECIPE_REVISION } from "../../ai/domain/judgement";
import { RULE_CHECK_RECIPE_REVISION } from "../../ai/domain/rules";
import {
  LEDGER_RECIPE_REVISION,
  type SectionLedger,
} from "../../ai/domain/ledger";
import type {
  ChatRecord,
  ReviewCheckpoint,
  SummaryMetadata,
} from "../../ai/domain/types";
import { hashOf } from "../../text/hash";
import type {
  DocumentProperties,
  DocumentStructure,
} from "../../project/types";
import { StorageError } from "../../storage";
import type { DirEntry, ProjectRef, StorageProvider } from "../../storage";
import { ProjectAiAdapter } from "./projectAdapter";
import { budgetFor } from "../../ai/application/budgets";
import type { GrepResult } from "../../ai/application/grep";
import { executeTool } from "../../ai/application/tools";

/**
 * Greps the adapter the way a run does: the model's search reads
 * through `read`, the one entry point every source passes.
 */
async function grepVia(
  adapter: ProjectAiAdapter,
  allowed: readonly string[],
  terms: readonly string[],
): Promise<GrepResult> {
  return (await executeTool(
    { id: "g", name: "grep", arguments: { terms } },
    {
      sources: adapter,
      catalog: await adapter.list(),
      allowed: new Set(allowed),
      used: [],
      budget: budgetFor({
        id: "test",
        providerId: "ollama",
        label: "test",
        kind: "device" as const,
        capabilities: { tools: true, structuredOutput: true },
        contextTokens: 131_072,
      }),
    },
  )) as GrepResult;
}

const CHAT_ID = "11111111-1111-4111-8111-111111111111";
const REVIEW_ID = "22222222-2222-4222-8222-222222222222";
const stamp = "2026-09-16T10:00:00.000Z";

function chat(updatedAt = stamp): ChatRecord {
  return {
    schemaVersion: 1,
    id: CHAT_ID,
    title: "Portable chat",
    kind: "general",
    createdAt: stamp,
    updatedAt,
    preferences: {
      personaId: "persona-fixture",
      model: { providerId: "ollama", modelId: "llama" },
      pinnedSourceIds: [],
    },
    turns: [],
    reviewRuns: [
      { runId: REVIEW_ID, file: `memory/review--${REVIEW_ID}.json` },
    ],
  };
}

function review(): ReviewCheckpoint {
  return {
    schemaVersion: 1,
    method: "segments",
    referenceRoom: 0,
    runId: REVIEW_ID,
    chatId: CHAT_ID,
    task: "continuity",
    scope: { kind: "structure" },
    state: "interrupted",
    model: { providerId: "ollama", modelId: "llama" },
    personaId: "persona-fixture",
    recipe: "full-review",
    recipeRevision: "1",
    sources: [],
    segments: [],
    findings: [],
    usage: { steps: 0 },
    createdAt: stamp,
    updatedAt: stamp,
  };
}

class FileStorage {
  files = new Map<string, string>();
  unreadable = new Set<string>();
  /** Every path `removeFile` was handed, for the containment assertions. */
  removed: string[] = [];
  /** Every folder `createDir` was asked for, in order. */
  dirs: string[] = [];
  /** Paths whose write fails, as a full or read-only disk would. */
  refuseWrite: (path: string) => boolean = () => false;

  provider(): StorageProvider {
    return {
      id: "memory",
      kind: "device",
      label: () => "Memory",
      icon: "folder",
      isAvailable: () => true,
      reopenProject: async () => true,
      canAccess: async () => "granted",
      listDir: async (_ref: ProjectRef, path: string) => this.list(path),
      exists: async (_ref: ProjectRef, path: string) => this.files.has(path),
      readFile: async (_ref: ProjectRef, path: string) => {
        if (this.unreadable.has(path)) throw new Error("unreadable");
        const value = this.files.get(path);
        if (value === undefined) throw new Error("missing");
        return value;
      },
      writeFile: async (_ref: ProjectRef, path: string, value: string) => {
        if (this.refuseWrite(path)) throw new Error("disk full");
        this.files.set(path, value);
      },
      createDir: async (_ref: ProjectRef, path: string) => {
        this.dirs.push(path);
      },
      renameFile: async () => undefined,
      moveFile: async () => undefined,
      copyFile: async () => undefined,
      removeFile: async (_ref: ProjectRef, path: string) => {
        this.removed.push(path);
        // The port's own not-found shape, like both real providers: the
        // adapter's delete tolerance is keyed on the code, never a message.
        if (!this.files.delete(path))
          throw new StorageError(`Not found: ${path}`, "not-found");
      },
    } as unknown as StorageProvider;
  }

  private list(path: string): DirEntry[] {
    const prefix = `${path}/`;
    return [...this.files.keys()]
      .filter(
        (file) =>
          file.startsWith(prefix) && !file.slice(prefix.length).includes("/"),
      )
      .map((file) => ({
        path: file,
        name: file.slice(prefix.length),
        kind: "file" as const,
      }));
  }
}

async function setup(options: { activeFile?: () => string | null } = {}) {
  const disk = new FileStorage();
  const firstText = "Live first section with a lantern.";
  const firstHash = await hashOf(firstText);
  const structure: DocumentStructure = {
    version: 1,
    children: [
      {
        kind: "part",
        id: "P1",
        title: "Part one",
        adopted: "part--one.EL1.00.md",
        snapshots: [
          { file: "part--one.EL1.00.md", title: "Part one 1", created: stamp },
        ],
        children: [
          {
            kind: "section",
            id: "S1",
            title: "Opening",
            adopted: "section--opening.EL2.00.md",
            snapshots: [
              {
                file: "section--opening.EL2.00.md",
                title: "Opening 1",
                created: stamp,
                contentHash: firstHash,
              },
              {
                file: "section--opening.EL2.01.md",
                title: "Opening alt",
                created: stamp,
                contentHash: "alternate-hash",
              },
            ],
          },
          {
            kind: "section",
            id: "S2",
            title: "Afterward",
            adopted: "section--afterward.00.md",
            snapshots: [
              {
                file: "section--afterward.00.md",
                title: "Afterward 1",
                created: stamp,
              },
            ],
          },
        ],
      },
    ],
  };
  // Mutable so a test can bind a summary and re-list through the same adapter.
  const properties = {} as unknown as DocumentProperties;
  // Mutable so a test can bar a source and re-list, as the live panel does:
  // the toggle writes the file and the next catalog derivation reads it.
  const barred = new Set<string>();
  let barredUnreadable = false;
  disk.files.set("/document/part--one.EL1.00.md", "Part prose");
  disk.files.set("/document/section--opening.EL2.00.md", "Saved first section");
  disk.files.set("/document/section--opening.EL2.01.md", "Alternate snapshot");
  disk.files.set(
    "/document/section--afterward.00.md",
    "The lantern returns later.",
  );
  disk.files.set("/reference/world--locations.md", "The city gate is blue.");
  disk.files.set("/reference/notes--ideas.md", "Maybe the gate is green.");
  const summaryMetadata: SummaryMetadata = {
    schemaVersion: 1,
    nodeId: "S1",
    scope: "node",
    sources: [{ nodeId: "S1", contentHash: firstHash }],
    model: { providerId: "ollama", modelId: "llama" },
    recipe: "node-summary",
    recipeRevision: "1",
    language: "en",
    generatedAt: stamp,
    bodyHash: await hashOf("Opening summary"),
  };
  disk.files.set(
    "/reference/summary--S1.md",
    serializeSummary(summaryMetadata, "Opening summary"),
  );
  const bindSummary = vi.fn(async () => undefined);
  const referenceChanged = vi.fn();
  const adapter = new ProjectAiAdapter({
    storage: disk.provider(),
    ref: {
      providerId: "memory",
      key: "project",
      name: "Project",
      openedAt: stamp,
    },
    structure: () => structure,
    properties: () => properties,
    barred: async () => {
      if (barredUnreadable) throw new Error("unavailable");
      return barred;
    },
    activeFile: options.activeFile ?? (() => "section--opening.EL2.00.md"),
    liveText: () => firstText,
    bindSummary,
    referenceChanged,
  });
  return {
    adapter,
    disk,
    structure,
    properties,
    barred,
    breakBarred: () => {
      barredUnreadable = true;
    },
    bindSummary,
    referenceChanged,
    firstHash,
  };
}

describe("ProjectAiAdapter", () => {
  // A Section map is dated by `read(id).revision` and is usually made with
  // its Section open, so the live buffer and the saved file answer with one
  // revision for one text. Otherwise every Section map reads "changed" once
  // the writer saves and closes it.
  it("gives a Section one revision whether it is read open or from its saved file", async () => {
    const open = await setup();
    const live = await open.adapter.read("node:S1");
    expect(live.origin).toBe("live-buffer");
    const closed = await setup({ activeFile: () => null });
    closed.disk.files.set(
      "/document/section--opening.EL2.00.md",
      "Live first section with a lantern.",
    );
    const saved = await closed.adapter.read("node:S1");
    expect(saved.origin).toBe("project-file");
    expect(saved.revision).toBe(live.revision);
  });

  it("offers the model only what the writer can see and delete", async () => {
    // The catalog matches the panels, which draw through `groupReference`
    // and skip a file declaring no group, or a `guidebook--`/`world--` file
    // whose stem is not a catalogue id. Such a file has no row and no delete
    // control, so the model does not read it either.
    const { adapter, disk } = await setup();
    disk.files.set("/reference/loose-thoughts.md", "no prefix at all");
    disk.files.set("/reference/world--nordkapp.md", "a retired catalogue id");

    const ids = (await adapter.list()).map((source) => source.id);
    expect(ids).not.toContain("reference:loose-thoughts.md");
    expect(ids).not.toContain("reference:world--nordkapp.md");
    // Nor is it deleted. The reference folder is inside the writer's own
    // project and may hold their own markdown; sweeping what the app does not
    // recognise destroys work.
    expect(disk.files.has("/reference/loose-thoughts.md")).toBe(true);
    expect(disk.files.has("/reference/world--nordkapp.md")).toBe(true);
    // Unreadable as well as unlisted: an id the catalog does not offer is
    // not reachable by guessing it either.
    await expect(adapter.read("reference:loose-thoughts.md")).rejects.toThrow(
      "source-not-found",
    );
  });

  it("names two Sections that share a title apart, for the model", async () => {
    // Titles are free. The model reads titles as text, with no tree
    // beside them, so a shared title reaches it with its place attached.
    const { adapter, structure } = await setup();
    const part = structure.children[0];
    if (part.kind !== "part") throw new Error("expected the fixture's Part");
    part.children[1] = { ...part.children[1], title: "Opening" };
    const titles = (await adapter.list())
      .filter((source) => source.kind === "manuscript")
      .map((source) => source.title);
    expect(titles).toContain("Part one › Opening #1");
    expect(titles).toContain("Part one › Opening #2");
  });

  it("maps manuscript, references, notes, and summaries into sources", async () => {
    const { adapter } = await setup();
    const sources = await adapter.list();
    expect(sources.map((source) => source.id)).toEqual(
      expect.arrayContaining([
        "node:P1",
        "node:S1",
        "node:S2",
        "reference:world--locations.md",
        "reference:notes--ideas.md",
        "reference:summary--S1.md",
      ]),
    );
    expect(
      sources.find((source) => source.id === "reference:world--locations.md"),
    ).toMatchObject({
      kind: "reference",
      // One authority for every reference document.
      authority: "reference",
    });
    expect(
      sources.find((source) => source.id === "reference:notes--ideas.md"),
    ).toMatchObject({
      kind: "note",
      authority: "reference",
    });
    expect(
      sources.find((source) => source.id === "reference:summary--S1.md"),
    ).toMatchObject({
      kind: "summary",
      authority: "derived",
      freshness: "current",
      // The node it is bound to, declared rather than left in the path.
      summarises: "S1",
    });
  });

  it("bars a source from the whole assistant, catalog and address alike", async () => {
    // The writer's standing "never let the assistant read this". It is a
    // project rule, applied at the port before anything downstream can see
    // the source, so it holds for every chat, not only the one it was set
    // from.
    const { adapter, barred } = await setup();
    expect(
      (await adapter.list()).some(
        (one) => one.id === "reference:world--locations.md",
      ),
    ).toBe(true);
    barred.add("reference:world--locations.md");
    expect(
      (await adapter.list()).some(
        (one) => one.id === "reference:world--locations.md",
      ),
    ).toBe(false);
    // The address is refused too, so a guessed id cannot pass a bar the
    // catalog will not name.
    await expect(adapter.read("reference:world--locations.md")).rejects.toThrow(
      "source-not-found",
    );
    // The file itself is untouched: barring is not deleting.
    expect(
      (await adapter.list()).some(
        (one) => one.id === "reference:notes--ideas.md",
      ),
    ).toBe(true);
  });

  it("lists and reads nothing when the barred list cannot be read", async () => {
    // A bar that cannot be read is not an empty bar: the assistant refuses
    // rather than reach a source the writer may have barred.
    const { adapter, breakBarred } = await setup();
    breakBarred();
    await expect(adapter.list()).rejects.toThrow("unavailable");
    await expect(adapter.read("reference:world--locations.md")).rejects.toThrow(
      "unavailable",
    );
  });

  it("marks a Section whose summary is barred, and names nothing of it", async () => {
    // The bar drops the summary from the listing, so the run cannot tell a
    // barred summary from a missing one and would write over the writer's
    // file to fill the gap. The node says so; the summary stays unlisted.
    const { adapter, properties, barred } = await setup();
    properties.summaries = { S1: "summary--S1.md" };
    const node = async () =>
      (await adapter.list()).find((one) => one.id === "node:S1");
    expect((await node())?.summaryBarred).toBeUndefined();
    barred.add("reference:summary--S1.md");
    expect((await node())?.summaryBarred).toBe(true);
    expect(
      (await adapter.list()).some(
        (one) => one.id === "reference:summary--S1.md",
      ),
    ).toBe(false);
    // Only a bound summary marks its node: a barred file bound to nothing
    // marks no node.
    properties.summaries = {};
    expect((await node())?.summaryBarred).toBeUndefined();
  });

  it("offers the model no snapshot and no edit history, ever", async () => {
    // A snapshot is prose the writer set aside, and an assistant that reads
    // one quotes a rejected draft back as the book, with nothing to tell the
    // two apart. The undo journal holds every keystroke of earlier text.
    //
    // Not listing them is the only control: every source in the catalog is
    // allowed (`allowedSourceIds`), readable through `read_source`,
    // searchable, and eligible for automatic retrieval. The fixture's
    // `section--opening.EL2.01.md` is a real unadopted snapshot.
    const { adapter, disk } = await setup();
    const sources = await adapter.list();
    expect(sources.some((one) => one.id.startsWith("snapshot:"))).toBe(false);
    expect(sources.some((one) => one.path.includes(".01.md"))).toBe(false);
    expect(sources.some((one) => one.path.includes("history"))).toBe(false);
    // An id saved in an older chat opens nothing: `read` resolves the id
    // through the catalog, so what is not listed is not addressable.
    await expect(
      adapter.read("snapshot:S1:section--opening.EL2.01.md"),
    ).rejects.toThrow("source-not-found");
    disk.files.set("/document-history.json", JSON.stringify({ secret: "x" }));
    expect((await adapter.list()).map((one) => one.path)).not.toContain(
      "/document-history.json",
    );
  });

  it("reads live editor text, bounded ranges, and rejects unknown or oversized sources", async () => {
    const { adapter, disk } = await setup();
    await expect(adapter.read("node:S1")).resolves.toMatchObject({
      text: "Live first section with a lantern.",
    });
    await expect(
      adapter.read("node:S2", { start: 4, end: 11 }),
    ).resolves.toMatchObject({
      text: "lantern",
    });
    await expect(adapter.read("missing")).rejects.toThrow("source-not-found");
    disk.files.set("/reference/world--locations.md", "x".repeat(2_000_001));
    await expect(adapter.read("reference:world--locations.md")).rejects.toThrow(
      "source-too-large",
    );
  });

  it("lets no note the writer wrote to nobody reach a model", async () => {
    // A comment is the one thing in a document addressed to no reader: a
    // template's hint, a writer's `<!-- fix this scene -->`, a parked passage.
    // `read` is the one entry point every source goes through, so the strip
    // happens there. The revision survives it, because `list()` answers from
    // the stored hash of the raw bytes and the two must agree.
    const { adapter, disk } = await setup();
    disk.files.set(
      "/reference/world--locations.md",
      [
        "The city gate is blue. <!-- Hint: say who painted it -->",
        "It was<!-- x -->painted once.",
      ].join("\n"),
    );
    const read = await adapter.read("reference:world--locations.md");
    expect(read.text).not.toContain("<!--");
    expect(read.text).not.toContain("Hint");
    expect(read.text).toContain("The city gate is blue.");
    // The words on either side of an inline note stay two words.
    expect(read.text).toContain("It was painted once.");
    expect(read.revision).toBeTruthy();

    // A grep reads through the same entry point, so a note cannot make a
    // document look relevant to a question it says nothing about.
    const allowed = ["reference:world--locations.md"];
    expect((await grepVia(adapter, allowed, ["painted"])).total).toBe(1);
    expect((await grepVia(adapter, allowed, ["hint"])).total).toBe(0);
  });

  it("gives a model a summary's words, never its metadata block", async () => {
    // A summary the app wrote is one file: YAML metadata (hashes, the model
    // and its revision, the recipe) above the body. Every summary-routed step
    // reads the body alone, so a cut never spends its share on the metadata.
    const { adapter, disk } = await setup();
    const read = await adapter.read("reference:summary--S1.md");
    expect(read.text).toBe("Opening summary");
    expect(read.text).not.toContain("schemaVersion");
    // The revision is still the raw file's — the bytes `list()` hashes too.
    expect(read.revision).toBe(
      await hashOf(disk.files.get("/reference/summary--S1.md") ?? ""),
    );
  });

  it("greps only authorized readable sources, in manuscript order", async () => {
    const { adapter, disk } = await setup();
    disk.unreadable.add("/reference/world--locations.md");
    const found = await grepVia(
      adapter,
      ["node:S1", "node:S2", "reference:world--locations.md"],
      ["lantern"],
    );
    // An unreadable source is left out, not a failed search.
    expect(found.matches.map((match) => match.sourceId)).toEqual([
      "node:S1",
      "node:S2",
    ]);
    expect(found.matches[1]?.excerpt).toContain("lantern");
    expect((await grepVia(adapter, ["node:S1"], ["absent"])).total).toBe(0);
  });

  it("limits reader knowledge to manuscript sources through the chosen node", async () => {
    const { adapter } = await setup();
    expect([
      ...(await adapter.allowedReaderSources({
        kind: "through",
        nodeId: "S1",
      })),
    ]).toEqual(["node:P1", "node:S1"]);
    // An unknown node fails closed: a deleted one never widens a reader's
    // knowledge to the whole manuscript.
    expect([
      ...(await adapter.allowedReaderSources({
        kind: "through",
        nodeId: "unknown",
      })),
    ]).toEqual([]);
  });

  it("gives the whole-manuscript reader every node, including ones added later", async () => {
    // A horizon pointed at the last node stops meaning "all of it" when the
    // writer adds a chapter, so the whole-manuscript reader has its own kind.
    const { adapter } = await setup();
    expect([
      ...(await adapter.allowedReaderSources({ kind: "whole" })),
    ]).toEqual(["node:P1", "node:S1", "node:S2"]);
  });

  it("persists portable chats and surfaces malformed files without overwriting them", async () => {
    const { adapter, disk } = await setup();
    const newer = chat("2026-09-16T12:00:00.000Z");
    await adapter.saveChat(newer);
    disk.files.set(
      "/assistant/chat--33333333-3333-4333-8333-333333333333.json",
      "not json",
    );
    disk.files.set("/assistant/readme.txt", "leave me");
    const listing = await adapter.listChats();
    expect(listing.chats).toEqual([newer]);
    expect(listing.unreadable.map((one) => one.file)).toEqual([
      "chat--33333333-3333-4333-8333-333333333333.json",
    ]);
    // The malformed file is never overwritten by the listing or the removal
    // of another file.
    expect(
      await disk.provider().readFile(
        {
          providerId: "memory",
          key: "project",
          name: "Project",
          openedAt: stamp,
        },
        "/assistant/chat--33333333-3333-4333-8333-333333333333.json",
      ),
    ).toBe("not json");
    expect(await adapter.loadChat(CHAT_ID)).toEqual(newer);
  });

  it("preserves a conflicting copy before overwriting a changed chat file", async () => {
    const { adapter, disk } = await setup();
    const original = chat();
    await adapter.saveChat(original);
    // Another writer changed the file after this session last saw it.
    const external = { ...chat(), title: "Written elsewhere" };
    disk.files.set(`/assistant/chat--${CHAT_ID}.json`, serializeChat(external));
    const outcome = await adapter.saveChat({
      ...original,
      title: "Mine",
    });
    expect(outcome.conflictFile).toContain("conflict");
    const conflictFile = outcome.conflictFile;
    if (!conflictFile) throw new Error("expected conflict file");
    expect(disk.files.get(conflictFile)).toBe(serializeChat(external));
  });

  // The other writer's copy must exist before this one replaces it: a copy
  // that cannot be kept fails the save, and their file stays as it is.
  it("fails the save when the conflicting copy cannot be kept", async () => {
    const { adapter, disk } = await setup();
    const original = chat();
    await adapter.saveChat(original);
    const path = `/assistant/chat--${CHAT_ID}.json`;
    const external = serializeChat({ ...chat(), title: "Written elsewhere" });
    disk.files.set(path, external);
    disk.refuseWrite = (target) => target.includes(".conflict-");
    await expect(
      adapter.saveChat({ ...original, title: "Mine" }),
    ).rejects.toThrow("disk full");
    expect(disk.files.get(path)).toBe(external);
  });

  // A file's name is the chat's identity: a copied file whose record names
  // another chat lists and saves as itself, never over the other chat's file.
  it("takes a chat's id from its file name, not from the record inside", async () => {
    const { adapter, disk } = await setup();
    const original = chat();
    await adapter.saveChat(original);
    const copyId = "44444444-4444-4444-8444-444444444444";
    disk.files.set(
      `/assistant/chat--${copyId}.json`,
      serializeChat({ ...chat(), title: "The copy" }),
    );
    const listing = await adapter.listChats();
    expect(listing.chats.map((one) => one.id).sort()).toEqual(
      [CHAT_ID, copyId].sort(),
    );
    const copy = await adapter.loadChat(copyId);
    expect(copy.id).toBe(copyId);
    await adapter.saveChat({ ...copy, title: "The copy, renamed" });
    expect(disk.files.get(`/assistant/chat--${CHAT_ID}.json`)).toBe(
      serializeChat(original),
    );
  });

  it("reports a record near the file bound and refuses one past it", async () => {
    const { adapter } = await setup();
    const small = await adapter.saveChat(chat());
    expect(small.nearLimit).toBe(false);

    const big = {
      ...chat(),
      turns: [
        {
          id: "big",
          role: "user" as const,
          text: "x".repeat(6_500_000),
          createdAt: stamp,
          outcome: "complete" as const,
        },
      ],
    };
    const near = await adapter.saveChat(big);
    expect(near.nearLimit).toBe(true);

    const tooBig = {
      ...chat(),
      turns: [
        {
          id: "too-big",
          role: "user" as const,
          text: "x".repeat(8_500_000),
          createdAt: stamp,
          outcome: "complete" as const,
        },
      ],
    };
    await expect(adapter.saveChat(tooBig)).rejects.toThrow("chat-too-large");

    // The bound is measured in UTF-8 bytes, not code units: 2.9 M CJK
    // characters are ~8.7 MB on disk but only 2.9 M `.length`, so a guard
    // on code units would admit a file `parseChat` then refuses.
    const multibyte = {
      ...chat(),
      turns: [
        {
          id: "multibyte",
          role: "user" as const,
          text: "界".repeat(2_900_000),
          createdAt: stamp,
          outcome: "complete" as const,
        },
      ],
    };
    expect(multibyte.turns[0]?.text.length).toBeLessThan(8 * 1024 * 1024);
    await expect(adapter.saveChat(multibyte)).rejects.toThrow("chat-too-large");
  });

  it("keeps a source's ledger in the assistant's memory, under a name no source id shapes", async () => {
    const { adapter, disk } = await setup();
    const ledger: SectionLedger = {
      sourceId: "reference:characters--../Marta Neri.md",
      contentHash: "h",
      recipeRevision: LEDGER_RECIPE_REVISION,
      model: "ollama/qwen3:8b",
      origin: "sheet",
      claims: [],
      dropped: 0,
    };
    expect(await adapter.readLedger(ledger.sourceId)).toBeNull();
    await adapter.writeLedger(ledger);
    const path = `/assistant/memory/facts--${(await hashOf(ledger.sourceId)).slice(0, 40)}.json`;
    expect(disk.files.has(path)).toBe(true);
    expect(await adapter.readLedger(ledger.sourceId)).toEqual(ledger);
    // Not a chat: the chat list neither reads it nor calls it unreadable.
    expect((await adapter.listChats()).unreadable).toEqual([]);
    // A file that is not a ledger, or is another source's, is no ledger.
    disk.files.set(path, "{");
    expect(await adapter.readLedger(ledger.sourceId)).toBeNull();
    disk.files.set(path, JSON.stringify({ ...ledger, sourceId: "node:S1" }));
    expect(await adapter.readLedger(ledger.sourceId)).toBeNull();
  });

  // The prose's ledger is fresh only against the present it was told;
  // a file that lost it would send the prose back to the model
  // on every check that names one.
  it("keeps the story's present a prose ledger was told", async () => {
    const { adapter } = await setup();
    const ledger: SectionLedger = {
      sourceId: "node:S1",
      contentHash: "h",
      recipeRevision: LEDGER_RECIPE_REVISION,
      model: "ollama/qwen3:8b",
      origin: "prose",
      present: "1906",
      claims: [],
      dropped: 0,
    };
    await adapter.writeLedger(ledger);
    expect((await adapter.readLedger(ledger.sourceId))?.present).toBe("1906");
  });

  it("keeps the fact check's verdicts in one file in the assistant's memory", async () => {
    const { adapter, disk } = await setup();
    expect(await adapter.readJudgements()).toBeNull();
    const judgements = {
      recipeRevision: JUDGE_RECIPE_REVISION,
      judgements: {
        a: {
          verdict: "conflict" as const,
          severity: "major" as const,
          title: "T",
          explanation: "E",
          doubt: "",
          model: "ollama/m",
        },
      },
    };
    await adapter.writeJudgements(judgements);
    expect(disk.files.has("/assistant/memory/judgements.json")).toBe(true);
    expect(await adapter.readJudgements()).toEqual(judgements);
    expect((await adapter.listChats()).unreadable).toEqual([]);
    disk.files.set("/assistant/memory/judgements.json", "{");
    expect(await adapter.readJudgements()).toBeNull();
    // The place and thing groups, beside them, the same way.
    expect(await adapter.readEntities()).toBeNull();
    const groups = {
      recipeRevision: "2",
      names: {
        asked: ['"a" (thing)', '"b" (thing)'],
        model: "ollama/m",
        groups: [["a", "b"]],
      },
      labels: { asked: [], model: "", groups: [] },
      values: {
        asked: ['job: "baker"', 'job: "fornaio"'],
        model: "ollama/m",
        groups: [["job|baker", "job|fornaio"]],
      },
    };
    await adapter.writeEntities(groups);
    expect(disk.files.has("/assistant/memory/entities.json")).toBe(true);
    expect(await adapter.readEntities()).toEqual(groups);
    disk.files.set("/assistant/memory/entities.json", "{");
    expect(await adapter.readEntities()).toBeNull();
  });

  it("saves, validates, loads, and deletes review checkpoints with their chat", async () => {
    const { adapter, disk } = await setup();
    await adapter.saveReview(review());
    await adapter.saveChat(chat());
    expect(await adapter.loadReview(REVIEW_ID)).toEqual(review());
    await expect(adapter.loadReview("../bad")).rejects.toThrow(
      "invalid-review-id",
    );
    // The delete path validates the same id shape: a traversal-shaped
    // `runId` never reaches `removeFile`.
    const before = disk.removed.length;
    await expect(adapter.deleteReview("../bad")).rejects.toThrow(
      "invalid-review-id",
    );
    expect(disk.removed.length).toBe(before);
    await adapter.deleteChat(CHAT_ID);
    expect(disk.files.has(`/assistant/chat--${CHAT_ID}.json`)).toBe(false);
    expect(disk.files.has(`/assistant/memory/review--${REVIEW_ID}.json`)).toBe(
      false,
    );
  });

  it("refuses a review file past the bound, at save and at load", async () => {
    const { adapter, disk } = await setup();
    const path = `/assistant/memory/review--${REVIEW_ID}.json`;
    const huge = { ...review(), chatId: "x".repeat(8_500_000) };
    await expect(adapter.saveReview(huge)).rejects.toThrow("review-too-large");
    expect(disk.files.has(path)).toBe(false);
    // A file planted in a shared folder is refused before it is parsed.
    disk.files.set(path, "x".repeat(8 * 1024 * 1024 + 1));
    await expect(adapter.loadReview(REVIEW_ID)).rejects.toThrow(
      "review-too-large",
    );
  });

  // Only chats sit at the top of `assistant/`; review runs, ledgers, verdicts
  // and groups go in its `memory/` folder, made once before the first memory
  // write however many writes arrive together.
  it("writes everything that is not a chat under assistant/memory, making the folder once", async () => {
    const { adapter, disk } = await setup();
    await Promise.all([
      adapter.saveReview(review()),
      adapter.writeJudgements({ recipeRevision: "1", judgements: {} }),
      adapter.writeRuleChecks({
        recipeRevision: RULE_CHECK_RECIPE_REVISION,
        answers: {
          "0a1b2c3d": [
            {
              passage: 1,
              explanation: "Crosses by night.",
              quote: "by night",
              verdict: "breaks",
              severity: "minor",
            },
          ],
        },
      }),
      adapter.writeLedger({
        sourceId: "node:S1",
        contentHash: "h",
        recipeRevision: LEDGER_RECIPE_REVISION,
        model: "m",
        origin: "prose",
        claims: [],
        dropped: 0,
      }),
    ]);
    await adapter.saveChat(chat());
    const top = [...disk.files.keys()].filter(
      (path) =>
        path.startsWith("/assistant/") &&
        !path.slice("/assistant/".length).includes("/"),
    );
    expect(top).toEqual([`/assistant/chat--${CHAT_ID}.json`]);
    expect(
      [...disk.files.keys()].filter((path) =>
        path.startsWith("/assistant/memory/"),
      ),
    ).toHaveLength(4);
    expect(disk.dirs.filter((dir) => dir === "/assistant/memory")).toEqual([
      "/assistant/memory",
    ]);
    // The rule check's kept answers read back.
    expect(
      (await adapter.readRuleChecks())?.answers["0a1b2c3d"]?.[0]?.verdict,
    ).toBe("breaks");
    // The chat list still lists chats only.
    expect((await adapter.listChats()).chats.map((one) => one.id)).toEqual([
      CHAT_ID,
    ]);
  });

  it("lists only the exact lowercase chat file name that saves write", async () => {
    // A save always writes `chat--<id>.json`. A differently cased copy
    // listed under the same id would sit beside that save as a second row.
    const { adapter, disk } = await setup();
    const saved = chat();
    await adapter.saveChat(saved);
    disk.files.set(
      `/assistant/chat--${CHAT_ID}.JSON`,
      JSON.stringify({ ...saved, title: "upper-case copy" }),
    );
    const listing = await adapter.listChats();
    expect(listing.chats.map((one) => one.id)).toEqual([CHAT_ID]);
    expect(listing.chats[0]?.title).toBe(saved.title);
  });

  it("refuses a traversal-shaped chat id before it reaches the provider", async () => {
    const { adapter } = await setup();
    await expect(adapter.loadChat("../../outside")).rejects.toThrow(
      "invalid-chat-id",
    );
    await expect(
      adapter.saveChat({ ...chat(), id: "../../outside" }),
    ).rejects.toThrow("invalid-chat-id");
  });

  it("deletes a chat whose file never existed without reporting a failure", async () => {
    const { adapter, disk } = await setup();
    // A first-save failure leaves no file; the port answers `not-found` and
    // the adapter tolerates it (keyed on the code, never a message), so the
    // writer never sees the storage layer's own prose.
    expect(disk.files.has(`/assistant/chat--${CHAT_ID}.json`)).toBe(false);
    await expect(adapter.deleteChat(CHAT_ID)).resolves.toBeUndefined();
  });

  it("reads and writes generated summaries while preserving the structure binding", async () => {
    const { adapter, disk, bindSummary, referenceChanged } = await setup();
    expect(await adapter.readSummary("S1")).toMatchObject({
      body: "Opening summary",
    });
    const summary = disk.files.get("/reference/summary--S1.md");
    if (!summary) throw new Error("expected summary fixture");
    disk.files.set("/reference/summary--wrong.md", summary);
    expect(await adapter.readSummary("wrong")).toBeNull();
    expect(await adapter.readSummary("missing")).toBeNull();

    const metadata: SummaryMetadata = {
      schemaVersion: 1,
      nodeId: "S2",
      scope: "node",
      sources: [
        {
          nodeId: "S2",
          contentHash: await hashOf("The lantern returns later."),
        },
      ],
      model: { providerId: "ollama", modelId: "llama" },
      recipe: "node-summary",
      recipeRevision: "1",
      language: "en",
      generatedAt: stamp,
      bodyHash: await hashOf("Afterward summary"),
    };
    await adapter.writeSummary("S2", metadata, "Afterward summary");
    expect(disk.files.get("/reference/summary--S2.md")).toContain(
      "Afterward summary",
    );
    expect(bindSummary).toHaveBeenCalledWith("S2", "summary--S2.md");
    // The shelf is told after the binding, so a new summary shows without
    // reopening the dock.
    expect(referenceChanged).toHaveBeenCalledTimes(1);
    expect(referenceChanged.mock.invocationCallOrder[0]).toBeGreaterThan(
      bindSummary.mock.invocationCallOrder[0] ?? Infinity,
    );
    await adapter.deleteReview(REVIEW_ID).catch(() => undefined);
  });

  it("catalogues a summary by the source's current text, not the stored snapshot hash", async () => {
    // Node `S2` has no stored `contentHash`, and the summary was written from
    // its file as it is now. Freshness is judged against the current text,
    // so the missing hash does not mark it outdated.
    const { adapter, disk } = await setup();
    const text = "The lantern returns later.";
    const hash = await hashOf(text);
    disk.files.set(
      "/reference/summary--S2.md",
      serializeSummary(
        {
          schemaVersion: 1,
          nodeId: "S2",
          scope: "node",
          sources: [{ nodeId: "S2", contentHash: hash }],
          model: { providerId: "ollama", modelId: "llama" },
          recipe: "node-summary",
          recipeRevision: "1",
          language: "en",
          generatedAt: stamp,
          bodyHash: await hashOf("Afterward summary"),
        },
        "Afterward summary",
      ),
    );
    const find = async () =>
      (await adapter.list()).find(
        (source) => source.id === "reference:summary--S2.md",
      );
    expect(await find()).toMatchObject({
      freshness: "current",
      // Named for its node, as the Reference tab names it.
      title: "Afterward",
    });

    // A real edit since still reads as one.
    disk.files.set("/document/section--afterward.00.md", "Rewritten.");
    expect((await find())?.freshness).toBe("outdated");
  });

  it("reads each node a summary covers once per listing, however many summaries cover it", async () => {
    const { adapter, disk, firstHash } = await setup();
    disk.files.set(
      "/reference/summary--P1.md",
      serializeSummary(
        {
          schemaVersion: 1,
          nodeId: "P1",
          scope: "node",
          sources: [
            { nodeId: "P1", contentHash: await hashOf("Part prose") },
            { nodeId: "S1", contentHash: firstHash },
          ],
          model: { providerId: "ollama", modelId: "llama" },
          recipe: "node-summary",
          recipeRevision: "1",
          language: "en",
          generatedAt: stamp,
          bodyHash: await hashOf("Part summary"),
        },
        "Part summary",
      ),
    );
    const read = vi.spyOn(adapter, "read");
    const listed = await adapter.list();
    expect(
      listed
        .filter((source) => source.kind === "summary")
        .map((source) => [source.id, source.freshness]),
    ).toEqual([
      ["reference:summary--P1.md", "current"],
      ["reference:summary--S1.md", "current"],
    ]);
    expect(read.mock.calls.filter(([id]) => id === "node:S1")).toHaveLength(1);
  });

  it("answers a reader's allowed set from the structure, without a listing", async () => {
    const { adapter } = await setup();
    const list = vi.spyOn(adapter, "list");
    await adapter.allowedReaderSources({ kind: "through", nodeId: "S1" });
    await adapter.allowedReaderSources({ kind: "whole" });
    expect(list).not.toHaveBeenCalled();
  });

  it("degrades unreadable reference directories and summary freshness safely", async () => {
    const { adapter, disk } = await setup();
    const provider = disk.provider();
    provider.listDir = async () => {
      throw new Error("permission");
    };
    const isolated = new ProjectAiAdapter({
      storage: provider,
      ref: { providerId: "memory", key: "p", name: "P", openedAt: stamp },
      structure: () => ({ version: 1, children: [] }),
      properties: () => ({}) as DocumentProperties,
      barred: async () => new Set(),
      activeFile: () => null,
      liveText: () => "",
      bindSummary: async () => undefined,
      referenceChanged: () => undefined,
    });
    expect(await isolated.list()).toEqual([]);

    disk.unreadable.add("/reference/summary--S1.md");
    expect(
      (await adapter.list()).find(
        (source) => source.id === "reference:summary--S1.md",
      )?.freshness,
    ).toBe("unverified");
  });
});

// The port keeps signal it already computes: a source found by its title,
// and a reference source's group and clean label.
describe("the context seam", () => {
  it("search finds a source by its title", async () => {
    // "Afterward" is the node's title and never appears in its body. A model
    // looking for a named document makes this call, so grep answers it in
    // `titles`.
    const { adapter } = await setup();

    const found = await grepVia(adapter, ["node:S1", "node:S2"], ["Afterward"]);
    expect(found.titles.map((one) => one.sourceId)).toContain("node:S2");
  });

  it("a reference source carries its group and its clean title", async () => {
    // `list()` takes the group and the prefix-stripped label from
    // `groupReference`, so the title is not the filename and the groups stay
    // distinct.
    const { adapter } = await setup();
    const sources = await adapter.list();

    const world = sources.find(
      (one) => one.id === "reference:world--locations.md",
    );
    expect(world?.title).toBe("locations");
    expect(world?.group).toBe("world");
  });
});

describe("what a command can declare it reads, and where a node sits", () => {
  it("names a guidebook or world document by its catalogue id, and nothing else", async () => {
    const { adapter, disk } = await setup();
    disk.files.set("/reference/guidebook--prose-style.md", "Close third.");
    disk.files.set("/reference/character--mira.md", "Mira, the guide.");
    const sources = await adapter.list();
    const section = (id: string) =>
      sources.find((one) => one.id === id)?.sectionId;
    expect(section("reference:world--locations.md")).toBe("locations");
    expect(section("reference:guidebook--prose-style.md")).toBe("prose-style");
    // A character sheet is named by the writer, and a note is a note: neither
    // is a catalogue section.
    expect(section("reference:character--mira.md")).toBeUndefined();
    expect(section("reference:notes--ideas.md")).toBeUndefined();
  });

  it("places each node in its Part and counts its words from the stats", async () => {
    const { adapter, properties } = await setup();
    (properties as { stats?: unknown }).stats = {
      perNode: [
        { nodeId: "S1", words: 1200 },
        { nodeId: "P1", words: 40 },
        // Hand-edited nonsense in the writer's own file is not a count.
        { nodeId: "S2", words: -3 },
      ],
    };
    const sources = await adapter.list();
    const node = (id: string) => sources.find((one) => one.nodeId === id);
    expect(node("P1")?.partId).toBeUndefined();
    expect(node("S1")).toMatchObject({ partId: "P1", words: 1200 });
    expect(node("S2")?.partId).toBe("P1");
    expect(node("S2")?.words).toBeUndefined();
    expect(node("P1")?.words).toBe(40);
  });
});

// `/where` routes by the names the writer recorded: a sheet's title and its
// names field, each place in the world's Locations and its names. They are
// read in the adapter, so the AI core is handed names and never a sheet.
describe("the names the book records", () => {
  const SHEET = [
    "# Aldo",
    "",
    "## Identity",
    "",
    "- **Names and nicknames:**",
    "  <!-- Hint: what are they called? -->",
    "  - the old man",
    "  - Nonno",
    "",
    "- **Fears:**",
    "  - drowning",
  ].join("\n");
  const PLACES = [
    "# Places in the story",
    "",
    "## [Location]",
    "",
    "- **Names:**",
    "  - ",
    "",
    "## The harbour",
    "",
    "- **Names:**",
    "  - the Mouth",
    "",
    "- **Atmosphere:**",
    "  - salt and diesel",
  ].join("\n");

  async function named() {
    const context = await setup();
    context.disk.files.set("/reference/character--Aldo.md", SHEET);
    context.disk.files.set("/reference/arc--Aldo.md", SHEET);
    context.disk.files.set("/reference/world--locations.md", PLACES);
    context.disk.files.set("/reference/world--timeline.md", PLACES);
    return context;
  }

  it("reads a sheet's names and each place's, and nothing else either says", async () => {
    const { adapter } = await named();
    const known = await adapter.knownNames([
      "reference:character--Aldo.md",
      "reference:world--locations.md",
    ]);
    expect(known).toEqual([
      {
        sourceId: "reference:character--Aldo.md",
        kind: "character",
        names: ["Aldo", "the old man", "Nonno"],
      },
      {
        sourceId: "reference:world--locations.md",
        kind: "place",
        names: ["The harbour", "the Mouth"],
      },
    ]);
    expect(JSON.stringify(known)).not.toContain("drowning");
    expect(JSON.stringify(known)).not.toContain("diesel");
  });

  it("gives nothing for an arc, another world page, a note, a summary, prose, or an address it does not manage", async () => {
    const { adapter } = await named();
    expect(
      await adapter.knownNames([
        "reference:arc--Aldo.md",
        "reference:world--timeline.md",
        "reference:notes--ideas.md",
        "reference:summary--S1.md",
        "node:S1",
        "reference:loose.md",
        "reference:../character--Aldo.md",
      ]),
    ).toEqual([]);
  });

  it("gives nothing for a sheet the writer barred", async () => {
    const { adapter, barred } = await named();
    barred.add("reference:character--Aldo.md");
    expect(await adapter.knownNames(["reference:character--Aldo.md"])).toEqual(
      [],
    );
  });

  it("gives the title alone for a sheet whose names field is unanswered", async () => {
    const { adapter, disk } = await named();
    disk.files.set(
      "/reference/character--Aldo.md",
      "# Aldo\n\n- **Names and nicknames:**\n  <!-- Hint: x -->\n  - \n",
    );
    expect(await adapter.knownNames(["reference:character--Aldo.md"])).toEqual([
      {
        sourceId: "reference:character--Aldo.md",
        kind: "character",
        names: ["Aldo"],
      },
    ]);
  });

  it("reads each id once, and skips one it cannot read", async () => {
    const { adapter, disk } = await named();
    disk.files.delete("/reference/world--locations.md");
    const known = await adapter.knownNames([
      "reference:character--Aldo.md",
      "reference:character--Aldo.md",
      "reference:world--locations.md",
    ]);
    expect(known.map((one) => one.sourceId)).toEqual([
      "reference:character--Aldo.md",
    ]);
  });

  // A place the writer headed and filled nothing under is still named; only
  // the placeholder and a letterless heading are skipped. The names
  // are read through `open`, before `read()`'s unanswered-question strip,
  // which removes such a `##` together with its empty fields.
  it("names a place the writer headed and has not described yet", async () => {
    const { adapter, disk } = await named();
    disk.files.set(
      "/reference/world--locations.md",
      [
        "# Places in the story",
        "",
        "## The mill",
        "",
        "- **Names:**",
        "  <!-- Hint: what is it called? -->",
        "  - ",
        "",
        "- **Description:**",
        "  - ",
      ].join("\n"),
    );
    expect(await adapter.knownNames(["reference:world--locations.md"])).toEqual(
      [
        {
          sourceId: "reference:world--locations.md",
          kind: "place",
          names: ["The mill"],
        },
      ],
    );
  });

  // A port query is bounded. `namesBlock` shows at most `CHARACTER_NAMES_MAX`
  // lines, and walking every `##` of a large Locations document is quadratic
  // on the main thread (`placeNames`' `indexOf` dedup and its per-place
  // filter). One past the cap lets the block say that more were left out.
  it("answers a bounded list however many places one document holds", async () => {
    const { adapter, disk } = await named();
    disk.files.set(
      "/reference/world--locations.md",
      Array.from(
        { length: 400 },
        (_, index) => `## Place ${index}\n\n- **Names:**\n  - alias ${index}\n`,
      ).join("\n"),
    );
    const known = await adapter.knownNames(["reference:world--locations.md"]);
    expect(known.length).toBeGreaterThan(0);
    expect(known.length).toBeLessThanOrEqual(CHARACTER_NAMES_MAX + 1);
  });
});
