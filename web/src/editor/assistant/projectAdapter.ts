// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  Artifacts,
  ChatListing,
  ProjectSources,
  SaveOutcome,
} from "../../ai/ports";
import type {
  ChatRecord,
  KnownName,
  ReaderScope,
  ReviewCheckpoint,
  SourceDescriptor,
  SourceText,
  SummaryMetadata,
} from "../../ai/domain/types";
import {
  parseChat,
  parseReview,
  serializeChat,
  serializeReview,
  CHAT_CONTINUATION_BYTES,
  CHAT_MAX_BYTES,
  REVIEW_MAX_BYTES,
} from "../../ai/adapters/chatCodec";
import {
  parseSummary,
  serializeSummary,
  summaryState,
} from "../../ai/adapters/summaryCodec";
import { hashOf } from "../../text/hash";
import { entityGroupsOf, type EntityGroups } from "../../ai/domain/entities";
import { judgementsOf, type Judgements } from "../../ai/domain/judgement";
import { ruleChecksOf, type RuleChecks } from "../../ai/domain/rules";
import { ledgerOf, type SectionLedger } from "../../ai/domain/ledger";
import { modelText, NAMES_MOST, namesOf, withoutAsides } from "./sourceText";
import { groupReference, referenceGroupOf } from "../../project/reference";
import { sectionIdOf } from "../../project/referenceSections";
import { pooled } from "../../project/pool";
import { nodeLabels } from "../../project/structure";
import {
  ASSISTANT_DIR,
  ASSISTANT_MEMORY_DIR,
  REFERENCE_DIR,
  SUMMARY_PREFIX,
  chatFilePath,
  filePath,
} from "../../project/naming";
import type {
  DocNode,
  DocumentProperties,
  DocumentStructure,
} from "../../project/types";
import type { ProjectRef, StorageProvider } from "../../storage";
import { StorageError } from "../../storage/types";

/**
 * The exact name `chatFilePath` writes, case included. A file the listing
 * accepts under another casing would list beside its own save as a second
 * row with the same id.
 */
const CHAT_RE = /^chat--([0-9a-f-]{36})\.json$/;
/** The fact check's kept verdicts, beside the chats (`readJudgements`). */
const JUDGEMENTS_FILE = "judgements.json";
/** The fact check's kept place and thing groups (`readEntities`). */
const ENTITIES_FILE = "entities.json";
/** The rule check's kept answers (`readRuleChecks`). */
const RULE_CHECKS_FILE = "rule-checks.json";
const REVIEW_RE = /^review--([0-9a-f-]{36})\.json$/i;
const MAX_SOURCE_CHARACTERS = 2_000_000;
/** Summary files a listing reads at once: Drive is a round trip per file. */
const SUMMARY_READS = 4;

interface AdapterOptions {
  storage: StorageProvider;
  ref: ProjectRef;
  structure: () => DocumentStructure;
  properties: () => DocumentProperties;
  /**
   * The writer's barred source ids, read afresh. Rejects when they cannot be
   * read, and every listing and read then fails closed.
   */
  barred: () => Promise<ReadonlySet<string>>;
  activeFile: () => string | null;
  liveText: () => string;
  bindSummary: (nodeId: string, fileName: string) => Promise<void>;
  /**
   * Tell the dock's reference shelf that `reference/` changed. A summary is
   * the one file this adapter writes there, and without the call a new one
   * reaches the shelf only when the dock reopens. Required, so a second
   * writer cannot forget it.
   */
  referenceChanged: () => void;
}

function orderedNodes(structure: DocumentStructure): DocNode[] {
  return placedNodes(structure).map(({ node }) => node);
}

/** Every node in reading order, with the Part it sits in. */
function placedNodes(
  structure: DocumentStructure,
): { node: DocNode; partId?: string }[] {
  const out: { node: DocNode; partId?: string }[] = [];
  const visit = (nodes: readonly DocNode[], partId?: string) => {
    for (const node of nodes) {
      out.push(partId ? { node, partId } : { node });
      if (node.kind === "part") visit(node.children, node.id);
    }
  };
  visit(structure.children);
  return out;
}

/**
 * The host side of the assistant's two ports for one open project: source
 * discovery/reads (with live-buffer precedence) and artifact persistence
 * (chats, review plans, generated summaries). It knows the editor's storage
 * and structure; the AI core knows neither.
 */
export class ProjectAiAdapter implements ProjectSources, Artifacts {
  /** Bytes this session last saw per chat, to detect a conflicting write. */
  private seen = new Map<string, string>();

  constructor(private readonly options: AdapterOptions) {}

  // ── Sources ────────────────────────────────────────────────────────────────

  async list(): Promise<SourceDescriptor[]> {
    const sources: SourceDescriptor[] = [];
    // Words from the project's own stats, and only a count that is one: the
    // properties file is the writer's and can be hand-edited.
    const words = new Map(
      (this.options.properties().stats?.perNode ?? []).flatMap((stat) =>
        Number.isInteger(stat.words) && stat.words >= 0
          ? [[stat.nodeId, stat.words] as const]
          : [],
      ),
    );
    // The writer's standing bar, read once: it drops a barred reference doc
    // below, and marks a node whose bound summary it drops.
    const barred = await this.options.barred();
    const bound = this.options.properties().summaries ?? {};
    // A label, not the bare title: titles are free, and the model is
    // handed them as text with no tree to tell two "Anna"s apart by.
    const labels = nodeLabels(this.options.structure());
    placedNodes(this.options.structure()).forEach(({ node, partId }, order) => {
      const adopted = node.snapshots.find((one) => one.file === node.adopted);
      const counted = words.get(node.id);
      const summary = bound[node.id];
      sources.push({
        id: `node:${node.id}`,
        kind: "manuscript",
        title: labels.get(node.id) ?? node.title,
        path: filePath(node.adopted),
        nodeId: node.id,
        nodeKind: node.kind,
        order,
        ...(partId ? { partId } : {}),
        ...(counted !== undefined ? { words: counted } : {}),
        ...(summary && barred.has(`reference:${summary}`)
          ? { summaryBarred: true as const }
          : {}),
        authority: "manuscript",
        revision: adopted?.contentHash,
      });
      // The node's other snapshots are not listed: a snapshot is
      // prose the writer set aside, and a source whose provenance they cannot
      // see in an answer.
    });
    const entries = await this.options.storage
      .listDir(this.options.ref, REFERENCE_DIR)
      .catch(() => []);
    // The folder is read through `groupReference`, the function the reference
    // and notes panels draw from. A file it does not draw (no group, or a
    // `guidebook--`/`world--` stem that is not a catalogue id) has no row and
    // no delete control, so offering it to the model would make it readable
    // by an assistant and removable by nobody. Such files are not deleted
    // either: the folder may hold the writer's own markdown.
    //
    // This catalog is the whole control over what the model can reach:
    // `list_sources`, `search_sources`, `read_source`, the pins and a
    // review's scope all derive from it, so a source not listed here, a
    // snapshot or a barred doc, is unreachable by all of them. The bar is a
    // project rule, so it holds in every chat, not only the one it was set
    // from.
    const managed = groupReference(
      entries
        .filter((entry) => entry.kind === "file")
        .map((entry) => entry.name),
      this.options.structure(),
    ).flatMap((group) => group.docs);
    const offered = managed.filter(
      (doc) => !barred.has(`reference:${doc.fileName}`),
    );
    // One read per covered node per listing: a Section covered by its own
    // summary and its Part's is read and hashed once.
    const revisions = new Map<string, Promise<string | null>>();
    const freshnesses = await pooled(offered, SUMMARY_READS, (doc) =>
      referenceGroupOf(doc.fileName) === "summaries"
        ? this.freshnessOf(doc.fileName, revisions)
        : Promise.resolve(undefined),
    );
    for (const [index, doc] of offered.entries()) {
      const group = referenceGroupOf(doc.fileName);
      const sectionId = group ? sectionIdOf(group, doc.fileName) : null;
      const summary = group === "summaries";
      const freshness = freshnesses[index];
      sources.push({
        id: `reference:${doc.fileName}`,
        kind: summary ? "summary" : group === "notes" ? "note" : "reference",
        // The title and the group are the ones `groupReference` computed. The
        // group is the finer axis: guidebook, characters, arcs and world all
        // share the one `reference` kind, and without it the model cannot
        // tell a character sheet from a worldbuilding note. A summary is named
        // by its node's title, not by its stem (`summary--S1`).
        title: doc.title,
        // `referenceGroupOf` answers null for a file whose prefix names no
        // group. A doc `groupReference` drew is always grouped, but the type
        // allows null, and `undefined` reads as "this source sits on no shelf".
        group: group ?? undefined,
        // The catalogue's own constant, matched from the file name, never
        // the stem itself; `groupReference` draws only matched ones.
        ...(sectionId ? { sectionId } : {}),
        path: `${REFERENCE_DIR}/${doc.fileName}`,
        // Read from the file name. An orphan summary (its node deleted)
        // names a node no manuscript source has, so it routes nowhere.
        summarises: summary ? doc.boundTo : undefined,
        authority: summary ? "derived" : "reference",
        freshness,
      });
    }
    return sources;
  }

  /**
   * The current content hash of each named node, read through `read()`, the
   * entry point a summary is generated through, so the two hashes are the same
   * function of the same text (the live buffer for the open file). The
   * stored snapshot hash does not serve: the live structure's copy is
   * attached at open and no save moves it, and a node never hashed has none,
   * so a fresh summary would be catalogued outdated. An
   * unreadable node is absent, and its summary reads outdated.
   *
   * `revisions` is shared by every summary of one listing, so a node is read
   * once however many summaries cover it.
   */
  private async currentRevisions(
    nodeIds: readonly string[],
    revisions: Map<string, Promise<string | null>>,
  ): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();
    for (const nodeId of nodeIds) {
      let pending = revisions.get(nodeId);
      if (!pending) {
        pending = this.read(`node:${nodeId}`).then(
          (capture) => capture.revision,
          () => null,
        );
        revisions.set(nodeId, pending);
      }
      const revision = await pending;
      if (revision !== null) hashes.set(nodeId, revision);
    }
    return hashes;
  }

  /** A summary file's freshness; anything unreadable is unverified. */
  private async freshnessOf(
    fileName: string,
    revisions: Map<string, Promise<string | null>>,
  ): Promise<SourceDescriptor["freshness"]> {
    try {
      const raw = await this.options.storage.readFile(
        this.options.ref,
        `${REFERENCE_DIR}/${fileName}`,
      );
      const current = await this.currentRevisions(
        parseSummary(raw)?.metadata.sources.map((source) => source.nodeId) ??
          [],
        revisions,
      );
      return await summaryState(raw, current);
    } catch {
      return "unverified";
    }
  }

  /**
   * Where a source id points, and whether it points anywhere it may.
   *
   * A source id is already an address (`node:<id>`, `reference:<name>`), so
   * resolving one needs no listing. `list()` costs a directory read plus one
   * file read per generated summary, and the model calls `read_source`
   * several times per step.
   *
   * It answers `null` for anything the application does not manage: the
   * catalog hides an unprefixed file and a `guidebook--`/`world--` file with
   * a retired catalogue stem, so a model that guesses such an id cannot read
   * it.
   */
  private async locate(
    sourceId: string,
  ): Promise<{ path: string; kind: SourceDescriptor["kind"] } | null> {
    if (sourceId.startsWith("node:")) {
      const nodeId = sourceId.slice("node:".length);
      const node = orderedNodes(this.options.structure()).find(
        (one) => one.id === nodeId,
      );
      return node ? { path: filePath(node.adopted), kind: "manuscript" } : null;
    }
    if (!sourceId.startsWith("reference:")) return null;
    const fileName = sourceId.slice("reference:".length);
    const drawn = groupReference([fileName], this.options.structure()).some(
      (group) => group.docs.length > 0,
    );
    if (!drawn) return null;
    // Barred here as well as in `list`: `locate` is the other way into a
    // file, and a read that resolved an address the catalog refuses to name
    // would let a guessed id past the bar.
    if ((await this.options.barred()).has(sourceId)) return null;
    const group = referenceGroupOf(fileName);
    return {
      path: `${REFERENCE_DIR}/${fileName}`,
      kind:
        group === "summaries"
          ? "summary"
          : group === "notes"
            ? "note"
            : "reference",
    };
  }

  async read(
    sourceId: string,
    range?: { start: number; end: number },
  ): Promise<SourceText> {
    const { source, text: noted, revision, live } = await this.open(sourceId);
    // A question nobody answered does not reach the model either, in a
    // reference only: a reference document is born as a template and
    // its empty questions are scaffolding, while an empty bullet in a
    // manuscript or a note is something the writer put there. A summary is
    // read for what it says, never its metadata block: every
    // summary-routed step (`/where`, `/map`, the wide review, a reader's
    // context) reads summaries through here and cuts a row to its room, which
    // the block would spend. The evaluation runners call the same function.
    let text = modelText(source.kind, noted);
    if (range)
      text = text.slice(
        Math.max(0, range.start),
        Math.max(range.start, range.end),
      );
    return {
      text,
      revision,
      origin: live ? "live-buffer" : "project-file",
    };
  }

  /**
   * The first half of every read: resolve the address (the bar, managed files
   * only), take the live buffer or the file, bound it, hash the raw bytes and
   * take the writer's notes out. `read()` goes on to strip what only a model
   * reading the document must not see; `knownNames` stops here, because the
   * unanswered-question strip would take a place the writer headed but has
   * not described yet away with its empty fields, and the names
   * extractor already drops an empty answer by itself.
   */
  private async open(sourceId: string): Promise<{
    source: { path: string; kind: SourceDescriptor["kind"] };
    text: string;
    revision: string;
    live: boolean;
  }> {
    const source = await this.locate(sourceId);
    if (!source) throw new Error("source-not-found");
    const live = source.path === filePath(this.options.activeFile() ?? "");
    const text = live
      ? this.options.liveText()
      : await this.options.storage.readFile(this.options.ref, source.path);
    if (text.length > MAX_SOURCE_CHARACTERS)
      throw new Error("source-too-large");
    // The revision is the file's, hashed before the strip below. It answers
    // "is this the same version of this document", and `list()` answers the
    // same question from the project's stored content hash of the raw bytes.
    // Hashing the stripped text would make every summary read as outdated,
    // because the two numbers could never agree.
    const revision = await hashOf(text);
    // Nothing a writer wrote to nobody reaches a model. This is the
    // one entry point: every source the assistant can see (manuscript,
    // reference, note, summary, snapshot) is read through here, and so is
    // every grep over the book. It runs before the range slice, so the
    // offsets a tool hands back describe the text the model got.
    return { source, text: withoutAsides(text), revision, live };
  }

  /**
   * The reader's allowed set: adopted manuscript in reading order, either the
   * whole of it or everything through one node inclusively.
   *
   * An unknown node fails closed, to an empty set, because a deleted node
   * must never silently open the whole manuscript. "Whole" is its own case
   * rather than the absence of a node for the same reason: the two answers
   * are opposites, and a shape where they look the same lets a deletion widen
   * the set.
   */
  async allowedReaderSources(scope: ReaderScope): Promise<ReadonlySet<string>> {
    const allowed = new Set<string>();
    if (scope.kind === "through") {
      const nodes = orderedNodes(this.options.structure());
      if (!nodes.some((node) => node.id === scope.nodeId)) return allowed;
    }
    // The catalogue's manuscript sources, in its order, with no I/O: `list()`
    // lists exactly the placed nodes as `node:<id>`.
    for (const { node } of placedNodes(this.options.structure())) {
      allowed.add(`node:${node.id}`);
      if (scope.kind === "through" && node.id === scope.nodeId) break;
    }
    return allowed;
  }

  /**
   * The names the given sources record: a character sheet's title and
   * the answers under its names field, and each place the world's Locations
   * names, with the names under it. Nothing else from either document, and
   * nothing from any other kind of source (an arc, a guidebook page, another
   * world page, a note, a summary, a manuscript node).
   *
   * Each id is resolved here, through `locate()`, so one the catalogue does
   * not manage, or one the writer barred, gives nothing whoever asked. It is
   * read through `open()`, the first half of `read()`, so the live buffer, the
   * size bound and the notes strip apply before a name is looked for, but not
   * the unanswered-question strip, which would remove a place the writer has
   * headed and not yet described along with its empty fields. An
   * unreadable document gives nothing rather than failing the run.
   *
   * At most `CHARACTER_NAMES_MAX + 1` entries in all: the block
   * shows at most `CHARACTER_NAMES_MAX`, and the one past it is how the
   * caller knows there were more than it could list. The walk stops there.
   */
  async knownNames(sourceIds: readonly string[]): Promise<KnownName[]> {
    const out: KnownName[] = [];
    const most = NAMES_MOST;
    for (const sourceId of new Set(sourceIds)) {
      if (out.length >= most) break;
      const source = await this.locate(sourceId);
      if (!source || source.kind !== "reference") continue;
      const fileName = sourceId.slice("reference:".length);
      const group = referenceGroupOf(fileName);
      const sectionId = group ? sectionIdOf(group, fileName) : null;
      const place = group === "world" && sectionId === "locations";
      if (group !== "characters" && !place) continue;
      let text: string;
      try {
        text = (await this.open(sourceId)).text;
      } catch {
        continue;
      }
      // The title the catalogue gives the sheet (`list()`'s own reading), so
      // the name a summary spells by and the one `/where` routes by agree.
      const title = groupReference([fileName], this.options.structure())
        .flatMap((one) => one.docs)
        .find((doc) => doc.fileName === fileName)?.title;
      if (!place && !title) continue;
      out.push(
        ...namesOf(
          {
            id: sourceId,
            group: group ?? undefined,
            ...(sectionId ? { sectionId } : {}),
            title: title ?? "",
          },
          text,
          most - out.length,
        ),
      );
    }
    return out;
  }

  // ── Artifacts ──────────────────────────────────────────────────────────────

  async listChats(): Promise<ChatListing> {
    const entries = await this.options.storage
      .listDir(this.options.ref, ASSISTANT_DIR)
      .catch(() => []);
    const chats: ChatRecord[] = [];
    const unreadable: ChatListing["unreadable"] = [];
    for (const entry of entries) {
      const match = entry.kind === "file" ? CHAT_RE.exec(entry.name) : null;
      if (!match) continue;
      const path = `${ASSISTANT_DIR}/${entry.name}`;
      try {
        const raw = await this.options.storage.readFile(this.options.ref, path);
        // The file name is the chat's identity, the one every save and
        // delete reaches. A copied file still names its original inside, and
        // trusting that would write or remove the original's file.
        const chat = { ...parseChat(raw), id: match[1] };
        chats.push(chat);
        this.seen.set(chat.id, raw);
      } catch (error) {
        // The writer's file stays untouched; it is surfaced by name with a
        // way to remove it rather than silently vanishing.
        unreadable.push({
          file: entry.name,
          message: error instanceof Error ? error.message : "unreadable-chat",
        });
      }
    }
    return {
      chats: chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      unreadable,
    };
  }

  async loadChat(id: string): Promise<ChatRecord> {
    const path = this.chatPath(id);
    const raw = await this.options.storage.readFile(this.options.ref, path);
    // The id it was read by, as the listing names it (`listChats`).
    const chat = { ...parseChat(raw), id };
    this.seen.set(chat.id, raw);
    return chat;
  }

  async saveChat(chat: ChatRecord): Promise<SaveOutcome> {
    const path = this.chatPath(chat.id);
    const content = serializeChat(chat);
    // The bounds are byte bounds: the file is UTF-8 wherever it is stored,
    // and accented or CJK prose is longer as bytes than as code units.
    // Measuring `.length` would admit a file the read bound then refuses.
    const bytes = new TextEncoder().encode(content).length;
    // Writing past the read bound would create a file the app itself cannot
    // open again. Refuse instead; the writer's answer is still in memory and
    // the surface offers Continue in a new chat.
    if (bytes > CHAT_MAX_BYTES) throw new Error("chat-too-large");
    let conflictFile: string | undefined;
    const known = this.seen.get(chat.id);
    if (known !== undefined) {
      let current: string | undefined;
      try {
        current = await this.options.storage.readFile(this.options.ref, path);
      } catch {
        // No file there yet (or unreadable): this save creates it.
      }
      if (current !== undefined && current !== known) {
        // Both copies survive: the other writer's bytes are preserved under
        // a name the chat listing will never treat as a chat. Derived from
        // the one chat-path spelling, so the two cannot drift. A copy that
        // cannot be written fails the save, which would otherwise replace
        // the only one.
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        conflictFile = chatFilePath(chat.id).replace(
          /\.json$/i,
          `.conflict-${stamp}.json`,
        );
        await this.options.storage.writeFile(
          this.options.ref,
          conflictFile,
          current,
        );
      }
    }
    await this.options.storage.writeFile(this.options.ref, path, content);
    this.seen.set(chat.id, content);
    return {
      ...(conflictFile ? { conflictFile } : {}),
      nearLimit: bytes > CHAT_CONTINUATION_BYTES,
    };
  }

  /**
   * The one place a chat id becomes a file name, validated: `loadChat`,
   * `saveChat` and `deleteChat` all reach the provider with it, and a
   * traversal-shaped id must reach none of them. `reviewPath` gives review
   * ids the same containment.
   */
  private chatPath(id: string): string {
    if (!CHAT_RE.test(`chat--${id}.json`)) throw new Error("invalid-chat-id");
    return chatFilePath(id);
  }

  async deleteChatFile(file: string): Promise<void> {
    const safe = this.safeChatFileName(file);
    await this.options.storage.removeFile(
      this.options.ref,
      `${ASSISTANT_DIR}/${safe}`,
    );
  }

  private safeChatFileName(file: string): string {
    if (
      !file ||
      file.includes("/") ||
      file.includes("\\") ||
      file.includes("..")
    )
      throw new Error("invalid-chat-file");
    return file;
  }

  async deleteChat(id: string): Promise<void> {
    const chat = await this.loadChat(id).catch(() => null);
    const failures: string[] = [];
    for (const review of chat?.reviewRuns ?? []) {
      try {
        await this.deleteReview(review.runId);
      } catch {
        failures.push(review.file);
      }
    }
    // A chat whose first save failed has no file to remove. The absence is
    // known here (the port's own not-found code), so it is tolerated here
    // rather than reported as a failure the writer cannot act on.
    try {
      await this.options.storage.removeFile(
        this.options.ref,
        this.chatPath(id),
      );
    } catch (error) {
      if (!(error instanceof StorageError && error.code === "not-found"))
        throw error;
    }
    this.seen.delete(id);
    if (failures.length > 0)
      throw new Error(
        `The chat was deleted, but some review files remain: ${failures.join(", ")}`,
      );
  }

  async saveReview(review: ReviewCheckpoint): Promise<void> {
    const content = serializeReview(review);
    // The read refuses a file past this bound, so a larger one is never made.
    if (new TextEncoder().encode(content).length > REVIEW_MAX_BYTES)
      throw new Error("review-too-large");
    await this.writeMemory(this.reviewPath(review.runId), content);
  }

  async loadReview(runId: string): Promise<ReviewCheckpoint> {
    return parseReview(
      await this.options.storage.readFile(
        this.options.ref,
        this.reviewPath(runId),
      ),
    );
  }

  async deleteReview(runId: string): Promise<void> {
    await this.options.storage.removeFile(
      this.options.ref,
      this.reviewPath(runId),
    );
  }

  /**
   * The one place a review id becomes a file name, validated: the id reaches
   * `writeFile`, `readFile` and `removeFile`, and a traversal-shaped id must
   * reach none of them. The chat path carries the same shape of id and the
   * same guard (`chatPath`), so both id kinds flow through one containment.
   */
  private reviewPath(runId: string): string {
    if (!REVIEW_RE.test(`review--${runId}.json`))
      throw new Error("invalid-review-id");
    return `${ASSISTANT_MEMORY_DIR}/review--${runId}.json`;
  }

  async readSummary(nodeId: string) {
    const file = `${SUMMARY_PREFIX}${nodeId}.md`;
    try {
      const raw = await this.options.storage.readFile(
        this.options.ref,
        `${REFERENCE_DIR}/${file}`,
      );
      const summary = parseSummary(raw);
      return summary?.metadata.nodeId === nodeId ? summary : null;
    } catch {
      return null;
    }
  }

  async writeSummary(
    nodeId: string,
    metadata: SummaryMetadata,
    body: string,
  ): Promise<void> {
    const file = `${SUMMARY_PREFIX}${nodeId}.md`;
    await this.options.storage.writeFile(
      this.options.ref,
      `${REFERENCE_DIR}/${file}`,
      serializeSummary(metadata, body),
    );
    await this.options.bindSummary(nodeId, file);
    // After the binding, not after the write: the shelf re-lists on this, and
    // a row drawn before the node points at its summary is a row the tree and
    // the shelf disagree about.
    this.options.referenceChanged();
  }

  /**
   * A source's ledger lives in the assistant's memory, as machine data the
   * catalogue never lists: `assistant/memory/facts--<hash of source id>.json`.
   * The id is hashed because it is a path-shaped string the writer named
   * (`reference:characters--Marta Neri.md`), and no such string reaches a
   * file name here; the id is kept inside the file and checked on read, as a
   * summary's node id is. The ledger holds quotes of the prose, so it is as
   * private as a chat and travels where the chats do.
   */
  private async ledgerPath(sourceId: string): Promise<string> {
    return `${ASSISTANT_MEMORY_DIR}/facts--${(await hashOf(sourceId)).slice(0, 40)}.json`;
  }

  async readLedger(sourceId: string): Promise<SectionLedger | null> {
    try {
      const raw = await this.options.storage.readFile(
        this.options.ref,
        await this.ledgerPath(sourceId),
      );
      const ledger = ledgerOf(JSON.parse(raw) as unknown);
      return ledger?.sourceId === sourceId ? ledger : null;
    } catch {
      return null;
    }
  }

  async writeLedger(ledger: SectionLedger): Promise<void> {
    await this.writeMemory(
      await this.ledgerPath(ledger.sourceId),
      JSON.stringify(ledger),
    );
  }

  /**
   * The fact check's kept verdicts, one file beside the ledgers and as
   * private as they are.
   */
  async readJudgements(): Promise<Judgements | null> {
    try {
      return judgementsOf(
        JSON.parse(
          await this.options.storage.readFile(
            this.options.ref,
            `${ASSISTANT_MEMORY_DIR}/${JUDGEMENTS_FILE}`,
          ),
        ) as unknown,
      );
    } catch {
      return null;
    }
  }

  async writeJudgements(judgements: Judgements): Promise<void> {
    await this.writeMemory(
      `${ASSISTANT_MEMORY_DIR}/${JUDGEMENTS_FILE}`,
      JSON.stringify(judgements),
    );
  }

  /**
   * The rule check's kept answers, beside the ledgers under
   * `assistant/memory`, never with the chats, and as private as they are.
   */
  async readRuleChecks(): Promise<RuleChecks | null> {
    try {
      return ruleChecksOf(
        JSON.parse(
          await this.options.storage.readFile(
            this.options.ref,
            `${ASSISTANT_MEMORY_DIR}/${RULE_CHECKS_FILE}`,
          ),
        ) as unknown,
      );
    } catch {
      return null;
    }
  }

  async writeRuleChecks(checks: RuleChecks): Promise<void> {
    await this.writeMemory(
      `${ASSISTANT_MEMORY_DIR}/${RULE_CHECKS_FILE}`,
      JSON.stringify(checks),
    );
  }

  /**
   * The fact check's kept place and thing groups: the ledgers' names for
   * one thing, beside them and as private as they are.
   */
  async readEntities(): Promise<EntityGroups | null> {
    try {
      return entityGroupsOf(
        JSON.parse(
          await this.options.storage.readFile(
            this.options.ref,
            `${ASSISTANT_MEMORY_DIR}/${ENTITIES_FILE}`,
          ),
        ) as unknown,
      );
    } catch {
      return null;
    }
  }

  async writeEntities(groups: EntityGroups): Promise<void> {
    await this.writeMemory(
      `${ASSISTANT_MEMORY_DIR}/${ENTITIES_FILE}`,
      JSON.stringify(groups),
    );
  }

  /**
   * A write into the assistant's memory, after the folder exists. Every
   * provider creates a missing parent on write, so this is not about
   * existence: the fact check writes several ledgers at once, and on Drive
   * two first writes into a folder nobody has made yet would each create a
   * `memory` folder (Drive allows two of one name, and `createFolders` holds
   * no lock). Creating it once, before the first write, serialises that
   * within this adapter. It does not serialise two adapters or two tabs on
   * one project: that race is Drive's and stays open.
   */
  private memoryDir: Promise<void> | null = null;

  private async writeMemory(path: string, content: string): Promise<void> {
    this.memoryDir ??= this.options.storage
      .createDir(this.options.ref, ASSISTANT_MEMORY_DIR)
      .catch((error: unknown) => {
        // A failed create is not remembered: the next write tries again,
        // and this one still goes ahead, since the write makes its parent.
        this.memoryDir = null;
        throw error;
      });
    await this.memoryDir.catch(() => undefined);
    await this.options.storage.writeFile(this.options.ref, path, content);
  }
}
