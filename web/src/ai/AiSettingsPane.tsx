// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AccessCard,
  Banner,
  Button,
  DialogText,
  Icon,
  Pick,
  SegmentedControl,
  SettingPair,
  SettingPairs,
  SettingSection,
} from "../ui";
import { appIcons } from "../ui/appIcons";
import type {
  AiConnectionSettings,
  ModelDescriptor,
  ModelRef,
} from "./domain/types";
import { isFreeModel, sameModel } from "./domain/types";
import type {
  ConnectionPreferences,
  RemoteModelPreferences,
  RemoteProviderStatus,
} from "./ports";
import { OllamaProvider } from "./adapters/ollama";
import { DEFAULT_AI, normalizeOllamaEndpoint } from "./settings";
import { kindForDestination } from "./domain/providerKind";
import { appLog, describeError } from "../log";

// AI settings: where the models come from. One card per place a model runs,
// and the division is the one axis anything above the port may branch on:
// a model reached on this machine, and a model reached over the
// network. Each card states where its words go.
//
// The remote half is where a provider's catalogue gets curated, because it is
// too long for the editor's model menu.
//
// Personas are not managed here: a voice is chosen at the persona picker
// above the composer.

export interface AiSettingsPaneProps {
  connection: ConnectionPreferences;
  remoteModels: RemoteModelPreferences;
  /**
   * The remote providers the application offers, connected or not, as the
   * account layer reports them. Empty when it offers none.
   */
  remoteProviders?: readonly RemoteProviderStatus[];
  /**
   * Begin a connection for this provider. A callback rather than a port
   * instance, because starting one needs the session and
   * `boundaries.test.ts` keeps this pane clear of `auth/`.
   */
  onConnect?: (providerId: string) => void;
  /**
   * The window was blocked, so the button becomes the writer's second click.
   */
  connectBlocked?: boolean;
  /**
   * The provider whose connection window is open and has not reported back.
   */
  connecting?: string | null;
  /**
   * Reads a connected provider's catalogue with the writer's key. The
   * composition root binds it, because the key belongs to the open writer
   * and this pane never holds one.
   */
  readCatalogue?: (
    providerId: string,
    signal: AbortSignal,
  ) => Promise<ModelDescriptor[]>;
  /** Removes the key from this device; it still exists at the vendor. */
  onDisconnect?: (providerId: string) => void;
  /** Remembers the connection on this computer, or keeps it in this tab. */
  onRemember?: (providerId: string, remember: boolean) => void;
  /**
   * Whether this computer can remember a connection: `sealed` when the
   * identity service seals the key, `unavailable` when it does not answer.
   */
  credentialProtection?: "sealed" | "unavailable";
}

/** `usd` in the writer's language: "$5" in English, "5 $" in Italian. */
function money(usd: number, language: string): string {
  return new Intl.NumberFormat(language, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: Number.isInteger(usd) ? 0 : 2,
  }).format(usd);
}

/** A date as "12 December", with the year only when it is not this one. */
function day(iso: string, language: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(language, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}

/**
 * How many rows a filtered catalogue will draw at once. Not a page: the
 * filter field is the way to the rest. The cap keeps an unfiltered list from
 * putting hundreds of checkboxes in the sheet and costing a frame per tick.
 */
const CATALOGUE_ROWS = 40;

/**
 * The pane's half of the bound; `validModels` in `portableDoc.ts` holds every
 * profile copy to it.
 */
const MAX_CHOSEN = 24;

export default function AiSettingsPane({
  connection,
  remoteModels,
  remoteProviders = [],
  onConnect,
  connectBlocked = false,
  connecting = null,
  readCatalogue,
  onDisconnect,
  onRemember,
  credentialProtection = "sealed",
}: AiSettingsPaneProps) {
  const { t } = useTranslation();
  // What is saved: the endpoint every chat reaches. The field below edits a
  // draft of it, so a half-typed address is never the one a chat is sent to.
  const [settings, setSettings] = useState<AiConnectionSettings>(() =>
    connection.load(),
  );
  // Default or Custom, derived from the stored endpoint rather than stored
  // beside it: a custom address equal to the default is the default.
  const [address, setAddress] = useState<"default" | "custom">(() =>
    settings.endpoint === DEFAULT_AI.endpoint ? "default" : "custom",
  );
  const [draft, setDraft] = useState(settings.endpoint);
  const [draftInvalid, setDraftInvalid] = useState(false);
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [status, setStatus] = useState<
    "idle" | "checking" | "connected" | "failed"
  >("idle");
  const [probe, setProbe] = useState<
    "idle" | "verified" | "unverified" | "skipped"
  >("idle");
  // One list across every provider, because one preference key holds it.
  // Written through the port on every change; there is no Save button.
  const [chosen, setChosen] = useState<readonly ModelRef[]>(() =>
    remoteModels.chosen(),
  );

  // Which check is current. A new address or a new check supersedes it: its
  // requests are aborted, since a probe is a whole inference on the device,
  // and an answer that still lands is about an endpoint no chat uses now.
  const check = useRef(0);
  const stopCheck = useRef<() => void>(() => undefined);
  const supersede = (): number => {
    stopCheck.current();
    stopCheck.current = () => undefined;
    return (check.current += 1);
  };
  useEffect(() => () => stopCheck.current(), []);

  const commitChosen = (next: readonly ModelRef[]) => {
    setChosen(next);
    remoteModels.choose(next);
  };

  /** A new endpoint means the last check answered for a different one. */
  const adopt = (next: AiConnectionSettings) => {
    supersede();
    connection.save(next);
    setSettings(next);
    setDraft(next.endpoint);
    setDraftInvalid(false);
    setStatus("idle");
    setProbe("idle");
    setModels([]);
  };

  const chooseAddress = (next: "default" | "custom") => {
    setAddress(next);
    // Custom opens on whatever is saved, which from Default is the standard
    // address itself: the writer edits a working value, never a blank field.
    if (next === "custom") {
      setDraft(settings.endpoint);
      setDraftInvalid(false);
    } else if (settings.endpoint !== DEFAULT_AI.endpoint) {
      adopt(DEFAULT_AI);
    }
  };

  /**
   * Save the custom draft, or say why it cannot be. Returns the endpoint that
   * is now in force, or `null` when the draft was refused: the allow-list in
   * `normalizeOllamaEndpoint` refuses rather than corrects.
   */
  const saveDraft = (): string | null => {
    if (address === "default") return settings.endpoint;
    let endpoint: string;
    try {
      endpoint = normalizeOllamaEndpoint(draft);
    } catch {
      setDraftInvalid(true);
      return null;
    }
    if (endpoint !== settings.endpoint) adopt({ endpoint });
    else {
      setDraft(endpoint);
      setDraftInvalid(false);
    }
    return endpoint;
  };

  const testConnection = async () => {
    // Testing an address the writer has typed but not saved would check one
    // endpoint while every chat went on using another, so the test commits
    // the draft first, as the Save button does.
    const endpoint = saveDraft();
    if (endpoint === null) return;
    const run = supersede();
    const current = () => run === check.current;
    setStatus("checking");
    const controller = new AbortController();
    stopCheck.current = () => controller.abort();
    const timer = window.setTimeout(() => controller.abort(), 5_000);
    // The probe targets the first model the endpoint offers, because its
    // question is about this connection ("can anything here run a tool
    // call"), not about one model a writer picked elsewhere.
    let probeTarget: ModelDescriptor | null;
    try {
      const provider = new OllamaProvider(endpoint);
      const listed = await provider.listModels(controller.signal);
      const described = await Promise.all(
        listed.map(async (model) => ({
          ...(await provider.describeModel(
            { providerId: provider.id, modelId: model.id },
            controller.signal,
          )),
          revision: model.revision,
        })),
      );
      const found = described.filter(
        (model) => model.capabilities.structuredOutput,
      );
      if (found.length === 0) throw new Error("ollama-no-chat-models");
      if (!current()) return;
      setModels(found);
      probeTarget = found[0] ?? null;
      setStatus("connected");
      appLog.info("ai", "The Ollama connection test succeeded.", {
        endpoint: kindForDestination({ via: "direct", endpoint }),
        models: found.length,
      });
    } catch (err) {
      if (!current()) return;
      // The endpoint's kind, never its address.
      appLog.warn("ai", "The Ollama connection test failed.", {
        endpoint: kindForDestination({ via: "direct", endpoint }),
        ...describeError(err),
      });
      setStatus("failed");
      setProbe("idle");
      setModels([]);
      return;
    } finally {
      window.clearTimeout(timer);
    }
    if (!probeTarget) {
      setProbe("idle");
      return;
    }
    // The probe is gated on the descriptor's kind, never on a provider's
    // name: it is a whole inference, free on the writer's own machine and a
    // billed request anywhere else. A skipped probe says so, because a
    // missing "agent tools verified" line reads as a failure.
    if (probeTarget.kind !== "device") {
      setProbe("skipped");
      return;
    }
    const target: ModelRef = {
      providerId: probeTarget.providerId,
      modelId: probeTarget.id,
      modelRevision: probeTarget.revision,
    };
    // The probe is a full inference, and a cold model can take minutes, so it
    // gets its own deadline: aborting it at the metadata timeout would
    // mislabel a capable model as chat-only.
    const probeController = new AbortController();
    stopCheck.current = () => probeController.abort();
    const probeTimer = window.setTimeout(
      () => probeController.abort(),
      180_000,
    );
    try {
      const provider = new OllamaProvider(endpoint);
      const verified =
        (await provider.probeTools?.(target, probeController.signal)) ?? false;
      if (current()) setProbe(verified ? "verified" : "unverified");
    } catch {
      if (current()) setProbe("unverified");
    } finally {
      window.clearTimeout(probeTimer);
    }
  };

  return (
    <>
      <SettingSection title={t("settings.aiLocal")}>
        <AccessCard
          icon={appIcons.local}
          name={t("settings.aiLocalName")}
          live={status === "connected"}
          state={t(`settings.aiLocalState.${status}`)}
          can={[t("settings.aiLocalCan")]}
          cannot={[
            t("settings.aiLocalCannot"),
            t("settings.aiLocalCannotCloud"),
          ]}
          action={
            <Button
              variant="outline"
              className="ui-btn-sm"
              disabled={status === "checking"}
              onClick={() => void testConnection()}
            >
              {status === "checking"
                ? t("settings.checkingOllama")
                : t("settings.testOllama")}
            </Button>
          }
        >
          <SettingPairs className="ai-settings-pairs">
            <SettingPair
              className="ai-address"
              label={t("settings.ollamaEndpoint")}
            >
              <SegmentedControl
                label={t("settings.ollamaEndpoint")}
                value={address}
                onChange={chooseAddress}
                options={[
                  {
                    value: "default",
                    label: t("settings.ollamaAddressDefault"),
                  },
                  { value: "custom", label: t("settings.ollamaAddressCustom") },
                ]}
              />
              {address === "custom" ? (
                <div className="ai-address-field">
                  <input
                    value={draft}
                    spellCheck={false}
                    aria-label={t("settings.ollamaEndpoint")}
                    aria-invalid={draftInvalid || undefined}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setDraftInvalid(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveDraft();
                    }}
                  />
                  <Button
                    variant="outline"
                    className="ui-btn-sm"
                    disabled={draft.trim() === settings.endpoint}
                    onClick={() => void saveDraft()}
                  >
                    {t("settings.ollamaAddressSave")}
                  </Button>
                </div>
              ) : null}
            </SettingPair>
            {/* A listing, not a picker: which model answers is chosen per
              chat in the editor's model menu, and a picker here would be a
              default nothing reads. */}
            {models.length > 0 ? (
              <SettingPair label={t("settings.ollamaModel")}>
                <ul className="ai-model-list">
                  {models.map((model) => (
                    <li key={model.id}>
                      {model.label}
                      {model.capabilities.tools
                        ? ` · ${t("settings.aiTools")}`
                        : ` · ${t("settings.aiChatOnly")}`}
                    </li>
                  ))}
                </ul>
              </SettingPair>
            ) : null}
          </SettingPairs>
          {address === "custom" && draftInvalid ? (
            <p className="setting-note ai-address-invalid" role="alert">
              {t("settings.ollamaAddressInvalid", {
                address: DEFAULT_AI.endpoint,
              })}
            </p>
          ) : null}
          {status === "connected" && probe !== "idle" ? (
            <p className={`ai-connection-status is-${probe}`}>
              {t(`settings.aiProbe.${probe}`)}
            </p>
          ) : null}
          <p className="setting-note">{t("settings.ollamaSetup")}</p>
        </AccessCard>
      </SettingSection>

      <SettingSection title={t("settings.aiRemote")}>
        {remoteProviders.length === 0 ? (
          <p className="setting-note">{t("settings.aiRemoteNone")}</p>
        ) : (
          remoteProviders.map((provider) => (
            <RemoteProvider
              key={provider.providerId}
              provider={provider}
              chosen={chosen}
              onChoose={commitChosen}
              onConnect={onConnect}
              blocked={connectBlocked}
              connecting={connecting === provider.providerId}
              readCatalogue={readCatalogue}
              onDisconnect={onDisconnect}
              onRemember={onRemember}
              credentialProtection={credentialProtection}
            />
          ))
        )}
      </SettingSection>
    </>
  );
}

/**
 * One provider, connected or not, and the way in to the other state. It
 * renders for both, because a row filtered out for having no credential is
 * a row with no way to get one.
 */
function RemoteProvider({
  provider,
  chosen,
  onChoose,
  onConnect,
  blocked,
  connecting,
  readCatalogue,
  onDisconnect,
  onRemember,
  credentialProtection,
}: {
  provider: RemoteProviderStatus;
  chosen: readonly ModelRef[];
  onChoose: (next: readonly ModelRef[]) => void;
  onConnect?: (providerId: string) => void;
  blocked: boolean;
  connecting: boolean;
  readCatalogue?: AiSettingsPaneProps["readCatalogue"];
  onDisconnect?: (providerId: string) => void;
  onRemember?: (providerId: string, remember: boolean) => void;
  credentialProtection: "sealed" | "unavailable";
}) {
  const { t, i18n } = useTranslation();
  const amount = (usd: number) => money(usd, i18n.language);
  const facts = provider.connected
    ? [
        t("settings.aiRemoteConnected"),
        provider.limitUsd !== null
          ? t(
              provider.limitReset
                ? `settings.aiRemoteLimitRenews.${provider.limitReset}`
                : "settings.aiRemoteLimit",
              { amount: amount(provider.limitUsd) },
            )
          : null,
        provider.expiresAtOrBefore
          ? t("settings.aiRemoteExpires", {
              date: day(provider.expiresAtOrBefore, i18n.language),
            })
          : null,
      ]
    : [t("settings.aiRemoteDisconnected")];
  const group = `remember-${provider.providerId}`;

  return (
    // The destination names the card, not an internal id: it is the one name
    // the writer can check against their own account.
    <AccessCard
      icon={appIcons.remote}
      name={provider.upstreamHost}
      live={provider.connected}
      state={facts.filter(Boolean).join(" · ")}
      can={
        provider.connected
          ? []
          : [t("settings.aiRemoteTransit", { host: provider.upstreamHost })]
      }
      cannot={[]}
      action={
        provider.connected ? (
          onDisconnect ? (
            <Button
              variant="outline"
              className="ui-btn-sm"
              onClick={() => onDisconnect(provider.providerId)}
            >
              {t("settings.aiRemoteDisconnect")}
            </Button>
          ) : null
        ) : onConnect ? (
          <Button
            variant="primary"
            className="ui-btn-sm"
            disabled={connecting}
            onClick={() => onConnect(provider.providerId)}
          >
            {t(
              connecting
                ? "settings.aiRemoteConnecting"
                : "settings.aiRemoteConnect",
            )}
          </Button>
        ) : null
      }
    >
      {/* Before connecting, the rule: the provider's consent screen lets the
          spend limit be left empty, meaning unlimited, and such a key is
          refused. The number is the check's own, carried on the status. */}
      {provider.connected ? null : (
        <p className="ai-remote-intro">
          {t("settings.aiRemoteRequirement", {
            host: provider.upstreamHost,
            amount: amount(provider.required.limitUsd),
          })}
        </p>
      )}

      {provider.refusal ? (
        <Banner tone="problem">
          {t(`settings.aiRemoteRefusal.${provider.refusal}`, {
            amount: amount(provider.required.limitUsd),
            host: provider.upstreamHost,
          })}
        </Banner>
      ) : null}

      {/* Asked once connected: the tab already holds the key, so either
          answer acts on it at once. */}
      {provider.connected && onRemember ? (
        <div className="ai-remote-remember">
          <h4 id={`${group}-q`}>{t("settings.aiRemoteRememberQuestion")}</h4>
          <div
            className="picks"
            role="radiogroup"
            aria-labelledby={`${group}-q`}
          >
            <Pick
              group={group}
              on={!provider.remembered}
              name={t("settings.aiRemoteRememberNo")}
              onChoose={() => onRemember(provider.providerId, false)}
            >
              <DialogText lead={t("settings.aiRemoteRememberNoMore")} />
            </Pick>
            <Pick
              group={group}
              on={provider.remembered === true}
              disabled={credentialProtection === "unavailable"}
              name={t("settings.aiRemoteRememberYes")}
              onChoose={() => onRemember(provider.providerId, true)}
            >
              <DialogText
                lead={t(
                  credentialProtection === "unavailable"
                    ? "settings.aiRemoteRememberUnavailable"
                    : "settings.aiRemoteRememberYesMore",
                )}
              />
            </Pick>
          </div>
        </div>
      ) : null}

      {blocked ? (
        <Banner tone="attention">{t("settings.aiRemoteBlocked")}</Banner>
      ) : null}

      {!provider.connected ? null : (
        <RemoteModels
          provider={provider}
          chosen={chosen}
          onChoose={onChoose}
          readCatalogue={readCatalogue}
        />
      )}

      {/* A renewal mints a key the way a first connection does: the vendor
          issues no refresh token, so there is no silent path. */}
      {/* A removed key stays valid at the provider until the writer deletes
          it there, so the moment it is removed is the moment to say so. */}
      {provider.keyRemoved && provider.keysUrl ? (
        <p className="ai-remote-intro">
          {t("settings.aiRemoteRemoved", { host: provider.upstreamHost })}
        </p>
      ) : null}

      {/* The keys page is offered disconnected too, for the keys earlier
          connections left at the provider. */}
      {(provider.connected && onConnect) || provider.keysUrl ? (
        <div className="setting-row ai-remote-actions">
          {provider.connected && onConnect ? (
            <Button
              variant="outline"
              className="ui-btn-sm"
              disabled={connecting}
              onClick={() => onConnect(provider.providerId)}
            >
              {t(
                connecting
                  ? "settings.aiRemoteConnecting"
                  : "settings.aiRemoteReconnect",
              )}
            </Button>
          ) : null}
          {provider.keysUrl ? (
            <a
              className="ui-btn ui-btn-outline ui-btn-sm"
              href={provider.keysUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("settings.aiRemoteKeys", { host: provider.upstreamHost })}
              <span className="ui-visually-hidden">
                {" "}
                ({t("dock.web.newTab")})
              </span>
              <Icon name={appIcons.external} size={13} />
            </a>
          ) : null}
        </div>
      ) : null}
    </AccessCard>
  );
}

/**
 * The models a writer has taken from a connected provider.
 *
 * The catalogue is not read on mount: the chosen set renders from the
 * preference alone, and the catalogue is fetched when the writer asks to add
 * to it.
 */
function RemoteModels({
  provider,
  chosen,
  onChoose,
  readCatalogue,
}: {
  provider: RemoteProviderStatus;
  chosen: readonly ModelRef[];
  onChoose: (next: readonly ModelRef[]) => void;
  readCatalogue?: AiSettingsPaneProps["readCatalogue"];
}) {
  const { t } = useTranslation();
  const [catalogue, setCatalogue] = useState<ModelDescriptor[] | null>(null);
  const [reading, setReading] = useState<"idle" | "reading" | "failed">("idle");
  const [filter, setFilter] = useState("");

  const mine = chosen.filter((ref) => ref.providerId === provider.providerId);
  const full = chosen.length >= MAX_CHOSEN;

  const has = (ref: ModelRef) => chosen.some((one) => sameModel(one, ref));

  const toggle = (ref: ModelRef) => {
    if (has(ref)) {
      onChoose(chosen.filter((one) => !sameModel(one, ref)));
      return;
    }
    // Refused rather than trimmed at the other end: dropping the oldest to
    // make room would remove a model the writer chose without telling them,
    // and the sentence under the list says what to do instead.
    if (full) return;
    onChoose([...chosen, { providerId: ref.providerId, modelId: ref.modelId }]);
  };

  const loadCatalogue = async () => {
    setReading("reading");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    try {
      if (!readCatalogue) throw new Error("no catalogue reader");
      const models = await readCatalogue(
        provider.providerId,
        controller.signal,
      );
      // An unreadable catalogue answers no models rather than throwing.
      if (models.length === 0) throw new Error("empty catalogue");
      setCatalogue(models);
      setReading("idle");
    } catch (err) {
      appLog.warn("ai", "The model catalogue could not be read in Settings.", {
        provider: provider.providerId,
        ...describeError(err),
      });
      setReading("failed");
    } finally {
      window.clearTimeout(timer);
    }
  };

  const needle = filter.trim().toLowerCase();
  const offered = (catalogue ?? []).filter(
    (model) =>
      needle === "" ||
      model.id.toLowerCase().includes(needle) ||
      model.label.toLowerCase().includes(needle),
  );

  return (
    <>
      <h4>{t("settings.aiRemoteChoose")}</h4>
      <p className="setting-note">{t("settings.aiRemoteChooseHint")}</p>

      {mine.length > 0 ? (
        <ul className="ai-model-list ai-remote-chosen">
          {mine.map((ref) => (
            <li key={ref.modelId}>
              <button type="button" onClick={() => toggle(ref)}>
                <Icon name={appIcons.confirm} size={13} />
                <span>{ref.modelId}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="setting-row">
        <span className="setting-note">
          {t("settings.aiRemoteChosen", {
            chosen: chosen.length,
            max: MAX_CHOSEN,
          })}
        </span>
        {catalogue === null ? (
          <Button
            variant="outline"
            className="ui-btn-sm"
            disabled={reading === "reading"}
            onClick={() => void loadCatalogue()}
          >
            {reading === "reading"
              ? t("settings.aiRemoteReading")
              : t("settings.aiRemoteFilter")}
          </Button>
        ) : null}
        {reading === "failed" ? (
          <span className="ai-connection-status is-failed">
            {t("settings.aiRemoteUnread")}
          </span>
        ) : null}
      </div>

      {catalogue !== null ? (
        <>
          <input
            className="ai-remote-filter"
            value={filter}
            spellCheck={false}
            placeholder={t("settings.aiRemoteFilter")}
            aria-label={t("settings.aiRemoteFilter")}
            onChange={(event) => setFilter(event.target.value)}
          />
          {offered.length === 0 ? (
            <p className="setting-note">{t("settings.aiRemoteNoMatch")}</p>
          ) : (
            <>
              {/* A truncated list says so: without the count, the only
                  number on screen is the curation cap, which reads as the
                  catalogue's size. */}
              {offered.length > CATALOGUE_ROWS ? (
                <p className="setting-note">
                  {t("settings.aiRemoteShowing", {
                    shown: CATALOGUE_ROWS,
                    matched: offered.length,
                  })}
                </p>
              ) : null}
              <ul className="ai-model-list ai-remote-catalogue">
                {offered.slice(0, CATALOGUE_ROWS).map((model) => {
                  const ref = {
                    providerId: model.providerId,
                    modelId: model.id,
                  };
                  const picked = has(ref);
                  return (
                    <li key={model.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={picked}
                          // A full set disables what is not in it and leaves
                          // what is enabled, so the way out of "full" is always
                          // reachable from the row the writer is looking at.
                          disabled={!picked && full}
                          onChange={() => toggle(ref)}
                        />
                        <span>{model.label}</span>
                        <ModelPrice model={model} />
                        <span className="ai-model-capability">
                          {model.capabilities.tools
                            ? t("settings.aiTools")
                            : t("settings.aiChatOnly")}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {full ? (
            <p className="setting-note">{t("settings.aiRemoteFull")}</p>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/**
 * What a model costs. Three states: free, priced, and unknown, which renders
 * as nothing; a boolean with "Paid" as the else branch would label an
 * unpriced model as costing money.
 *
 * `isFreeModel` derives from the price rather than the id: OpenRouter's
 * `:free` suffix is sound in one direction only.
 */
function ModelPrice({ model }: { model: ModelDescriptor }) {
  const { t } = useTranslation();

  if (isFreeModel(model)) {
    return (
      <span className="ai-model-price is-free">
        {t("settings.aiModelFree")}
      </span>
    );
  }

  if (!model.pricing) return null;

  return (
    <span className="ai-model-price">
      {t("settings.aiModelPrice", {
        input: formatUsdPerMillion(model.pricing.promptUsdPerMillion),
        output: formatUsdPerMillion(model.pricing.completionUsdPerMillion),
      })}
    </span>
  );
}

/**
 * A per-million price as money. Under a cent it keeps four decimals, because
 * two would round a paid price to $0.00, which reads as free.
 */
export function formatUsdPerMillion(usd: number): string {
  if (usd > 0 && usd < 0.01) return `$${usd.toFixed(4)}`;

  return `$${usd.toFixed(2)}`;
}
