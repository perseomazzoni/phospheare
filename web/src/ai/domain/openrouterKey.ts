// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What an OpenRouter key is, read from its own `GET /api/v1/key` answer, and
// the two rules that judge it: whether the app accepts it at all, and what
// its facts come to now. Pure: the caller fetches, and passes the
// clock in as a number, so every boundary is an ordinary unit test.
//
// The verdict is shaped as the panel already reads it (`state`, `notice`,
// `waitUntil`, the three figures), so the surfaces render it and never
// compare a date or subtract a spend themselves.
//
// The spend windows are UTC calendar periods, because the vendor's
// `usage_daily`, `usage_weekly` (Monday to Sunday) and `usage_monthly` are
// totals over them; their boundaries are when a spent limit frees up.

/** The reset windows the vendor documents, least frequent last. */
export type KeyReset = "daily" | "weekly" | "monthly";

/** One spend total per window, each `null` when the vendor did not state it. */
export interface SpendFigures {
  total: number | null;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
}

/**
 * A key as the vendor describes it, normalised. Every figure is `null` when
 * the vendor did not state it, never zero: an absent limit means unlimited,
 * and a number invented here would arm or disarm a check on nobody's word.
 */
export interface OpenRouterKeyInfo {
  label: string | null;
  limitUsd: number | null;
  limitRemainingUsd: number | null;
  /**
   * The window the limit resets over, lower-cased. A word this module does
   * not know is kept as written, and its spend is then unknown rather than
   * read from the wrong total.
   */
  limitReset: string | null;
  /** Only an explicit `true` counts: absent means BYOK spend is outside it. */
  includeByokInLimit: boolean;
  usage: SpendFigures;
  byokUsage: SpendFigures;
  isFreeTier: boolean;
  isManagementKey: boolean;
  isProvisioningKey: boolean;
  /** Epoch milliseconds; `null` is a key that never expires. */
  expiresAt: number | null;
  /** The day's free-model requests, each figure an integer or `null`. */
  freeModelDailyRequests: {
    limit: number | null;
    remaining: number | null;
    used: number | null;
  } | null;
}

/** The most a key's own limit may be, in US dollars. */
export const KEY_CEILING_USD = 5;

/** How close to its expiry a key is said to be lapsing, in milliseconds. */
export const EXPIRY_NOTICE_MS = 600_000;

/**
 * The share of the limit at which it is said to be mostly used. A reading
 * can trail by one answer, so the notice comes before the last dollar.
 */
export const SPEND_NOTICE_SHARE = 0.8;

// ── Reading the vendor's answer ──────────────────────────────────────────────

/**
 * A finite number, or `null`. A numeric string is believed, as the vendor's
 * decimal strings are elsewhere; anything else is no figure at all.
 */
function figure(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    typeof value === "string" &&
    /^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$/.test(value)
  ) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function figures(data: Record<string, unknown>, prefix: string): SpendFigures {
  return {
    total: figure(data[prefix]),
    daily: figure(data[`${prefix}_daily`]),
    weekly: figure(data[`${prefix}_weekly`]),
    monthly: figure(data[`${prefix}_monthly`]),
  };
}

/**
 * The `data` of a `GET /api/v1/key` answer, normalised, or `null` when the
 * body is not one.
 *
 * An `expires_at` that is present and not a timestamp makes the whole answer
 * unreadable: read as `null` it would mean "never expires", the lenient
 * direction, on a figure nobody could read.
 */
export function readKeyInfo(body: unknown): OpenRouterKeyInfo | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return null;
  const row = data as Record<string, unknown>;

  let expiresAt: number | null = null;
  if (row.expires_at !== null && row.expires_at !== undefined) {
    if (typeof row.expires_at !== "string" || row.expires_at === "")
      return null;
    const parsed = Date.parse(row.expires_at);
    if (!Number.isFinite(parsed)) return null;
    expiresAt = parsed;
  }

  const reset =
    typeof row.limit_reset === "string" && row.limit_reset.trim() !== ""
      ? row.limit_reset.trim().toLowerCase()
      : null;

  const free = row.free_model_daily_requests;
  const freeRow =
    typeof free === "object" && free !== null && !Array.isArray(free)
      ? (free as Record<string, unknown>)
      : null;

  return {
    label: typeof row.label === "string" && row.label !== "" ? row.label : null,
    limitUsd: figure(row.limit),
    limitRemainingUsd: figure(row.limit_remaining),
    limitReset: reset,
    includeByokInLimit: row.include_byok_in_limit === true,
    usage: figures(row, "usage"),
    byokUsage: figures(row, "byok_usage"),
    isFreeTier: row.is_free_tier === true,
    isManagementKey: row.is_management_key === true,
    isProvisioningKey: row.is_provisioning_key === true,
    expiresAt,
    freeModelDailyRequests: freeRow
      ? {
          limit: integer(freeRow.limit),
          remaining: integer(freeRow.remaining),
          used: integer(freeRow.used),
        }
      : null,
  };
}

// ── Spend windows ────────────────────────────────────────────────────────────

/**
 * The spend window `now` falls in, as `[start, end)` in epoch milliseconds,
 * or `null` for a limit that never resets or a window this module does not
 * know. The end is taken from the start, which is always a midnight, a
 * Monday or the 1st, so adding one period never overflows into the wrong
 * month as adding a month to the 31st can.
 */
export function spendWindow(
  reset: string | null,
  now: number,
): { start: number; end: number } | null {
  const at = new Date(now);
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const day = at.getUTCDate();
  switch (reset) {
    case "daily":
      return {
        start: Date.UTC(year, month, day),
        end: Date.UTC(year, month, day + 1),
      };
    case "weekly": {
      const sinceMonday = (at.getUTCDay() + 6) % 7;
      return {
        start: Date.UTC(year, month, day - sinceMonday),
        end: Date.UTC(year, month, day - sinceMonday + 7),
      };
    }
    case "monthly":
      return {
        start: Date.UTC(year, month, 1),
        end: Date.UTC(year, month + 1, 1),
      };
    default:
      return null;
  }
}

/** When the current spend window turns over, or `null` if it never does. */
export function windowEnd(reset: string | null, now: number): number | null {
  return spendWindow(reset, now)?.end ?? null;
}

/**
 * Whether a reading taken at `readAt` still describes the spend window `now`
 * falls in. The vendor's window totals cover the window the reading was
 * taken in, so a reading from before the current window began reports a
 * spend that has since reset, and judging by it would refuse a key that can
 * answer again. A limit that never resets, or a window this module does not
 * know, never goes stale this way.
 */
export function readingCurrent(
  info: OpenRouterKeyInfo,
  readAt: number,
  now: number,
): boolean {
  const window = spendWindow(info.limitReset, now);
  return window === null || readAt >= window.start;
}

const WINDOW_FIELD: Record<KeyReset, keyof SpendFigures> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
};

/** The limit's renewal period, or `null` for none or one the vendor does not document. */
export function keyReset(reset: string | null): KeyReset | null {
  return reset !== null &&
    Object.prototype.hasOwnProperty.call(WINDOW_FIELD, reset)
    ? (reset as KeyReset)
    : null;
}

function windowField(reset: string | null): keyof SpendFigures | null {
  if (reset === null) return "total";
  return Object.prototype.hasOwnProperty.call(WINDOW_FIELD, reset)
    ? WINDOW_FIELD[reset as KeyReset]
    : null;
}

/**
 * What the key has spent in the window its limit resets over: credit usage
 * and external BYOK usage together, since the limit bounds what the writer
 * spends through the app whichever billing path a turn takes.
 *
 * The BYOK figure is required when the vendor's limit leaves it out
 * (`credits-only`), and a reading without it is no reading. `null` when a required
 * figure is missing, so a missing number never arms the refusal it feeds.
 */
export function windowSpend(info: OpenRouterKeyInfo): number | null {
  const field = windowField(info.limitReset);
  if (field === null) return null;
  const credit = info.usage[field];
  if (credit === null) return null;
  const byok = info.byokUsage[field];
  if (byok === null && !info.includeByokInLimit) return null;
  return Math.max(0, credit) + Math.max(0, byok ?? 0);
}

// ── Acceptance ───────────────────────────────────────────────────────────────

export type KeyRejection =
  "management-key" | "no-limit" | "limit-too-high" | "already-expired";

/**
 * Whose spend the vendor's own limit bounds: every billing path, or credits
 * alone. With `credits-only` the app's spend check is the only bound on BYOK
 * spend.
 */
export type KeyCoverage = "credits-and-byok" | "credits-only";

export type KeyAcceptance =
  | { accepted: true; coverage: KeyCoverage }
  | { accepted: false; reason: KeyRejection };

/**
 * Whether the app takes this key, and the first reason it does not.
 *
 * A management or provisioning key mints and revokes other keys, so it is
 * never held, whatever its limit. Every other key needs a limit, at most
 * `KEY_CEILING_USD`, and must not have expired already. No expiry and no
 * reset window are required: the limit is the bound a stolen copy meets.
 */
export function keyAcceptance(
  info: OpenRouterKeyInfo,
  now: number,
): KeyAcceptance {
  if (info.isManagementKey || info.isProvisioningKey)
    return { accepted: false, reason: "management-key" };
  if (info.limitUsd === null) return { accepted: false, reason: "no-limit" };
  if (info.limitUsd > KEY_CEILING_USD)
    return { accepted: false, reason: "limit-too-high" };
  if (info.expiresAt !== null && info.expiresAt <= now)
    return { accepted: false, reason: "already-expired" };
  return {
    accepted: true,
    coverage: info.includeByokInLimit ? "credits-and-byok" : "credits-only",
  };
}

// ── The verdict ──────────────────────────────────────────────────────────────

export interface OpenRouterKeyVerdict {
  /** Whether the key can answer now. */
  state: "ready" | "expired" | "limit-reached";
  /** Worth saying before it stops; only ever beside `ready`. */
  notice: "expiring-soon" | "limit-mostly-used" | null;
  /**
   * ISO 8601, set only when the limit is spent and the key outlives the
   * window's end, when waiting is a real choice.
   */
  waitUntil: string | null;
  spentUsd: number | null;
  /** Floored at zero, since the request that crosses the limit overshoots. */
  remainingUsd: number | null;
  /** 0 to 1. */
  spentShare: number | null;
}

const round = (value: number, places: number) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/**
 * The spend the verdict judges by: the larger of the window's own total and
 * what the vendor's `limit_remaining` implies, so whichever figure is more
 * conservative wins. `limit_remaining` leaves BYOK out of a `credits-only`
 * key, and a window total can trail the vendor's own count; taking the larger
 * covers both.
 */
function judgedSpend(info: OpenRouterKeyInfo): number | null {
  const fromWindow = windowSpend(info);
  const fromRemaining =
    info.limitUsd !== null && info.limitRemainingUsd !== null
      ? Math.max(0, info.limitUsd - info.limitRemainingUsd)
      : null;
  if (fromWindow === null) return fromRemaining;
  if (fromRemaining === null) return fromWindow;
  return Math.max(fromWindow, fromRemaining);
}

/**
 * What a key's facts come to at `now`, in epoch milliseconds.
 *
 * Expired first: a key past its date cannot answer whatever it has left.
 * Then a spent limit. Otherwise ready, with at most one notice, expiry first,
 * because a key about to lapse stops sooner and its remedy is the same
 * button. A key with no expiry outlives every window, so a spent limit on a
 * resetting key always offers the wait.
 *
 * `readAt`, when given, is when the facts were read. A reading from before
 * the current spend window began (`readingCurrent`) counts as no reading of
 * the spend: the figures are `null` and only the expiry is judged, until the
 * key is read again.
 */
export function keyVerdict(
  info: OpenRouterKeyInfo,
  now: number,
  readAt?: number,
): OpenRouterKeyVerdict {
  const limit = info.limitUsd;
  const spent =
    readAt === undefined || readingCurrent(info, readAt, now)
      ? judgedSpend(info)
      : null;
  const figures = {
    spentUsd: spent === null ? null : round(spent, 6),
    remainingUsd:
      limit !== null && spent !== null
        ? round(Math.max(0, limit - spent), 4)
        : null,
    spentShare:
      limit !== null && limit > 0 && spent !== null
        ? round(Math.min(1, Math.max(0, spent / limit)), 4)
        : null,
  };

  if (info.expiresAt !== null && info.expiresAt <= now)
    return { state: "expired", notice: null, waitUntil: null, ...figures };

  if (limit !== null && spent !== null && spent >= limit) {
    const end = windowEnd(info.limitReset, now);
    const outlives =
      end !== null && (info.expiresAt === null || info.expiresAt > end);
    return {
      state: "limit-reached",
      notice: null,
      waitUntil: outlives ? new Date(end).toISOString() : null,
      ...figures,
    };
  }

  const notice =
    info.expiresAt !== null && info.expiresAt <= now + EXPIRY_NOTICE_MS
      ? "expiring-soon"
      : limit !== null &&
          limit > 0 &&
          spent !== null &&
          spent >= limit * SPEND_NOTICE_SHARE
        ? "limit-mostly-used"
        : null;

  return { state: "ready", notice, waitUntil: null, ...figures };
}
