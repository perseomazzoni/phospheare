// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import SummaryDialog from "./SummaryDialog";
import {
  ModelRunError,
  SummarySourceChangedError,
  SummarySourceMissingError,
  type Assistant,
  type ModelDescriptor,
} from "../../ai";
import { __resetOverlays } from "../../ui/overlay/useOverlay";
import { setConnector } from "../../ai/connectPath";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// There is no global test setup file in this workspace — a suite that renders
// cleans up after itself.
afterEach(() => {
  cleanup();
  __resetOverlays();
});

function model(id: string, kind: "device" | "remote"): ModelDescriptor {
  return {
    id,
    providerId: kind === "device" ? "ollama" : "openrouter",
    label: id,
    kind,
    capabilities: { tools: true, structuredOutput: true, reasoning: false },
  };
}

function open(
  generateSummary: Assistant["summaries"]["generate"],
  models = [model("qwen3:8b", "device"), model("llama3", "device")],
  handlers: { onClose?: () => void; onDone?: (id: string) => void } = {},
) {
  const assistant = {
    listModels: vi.fn(async () => models),
    summaries: { generate: vi.fn(generateSummary) },
  } as unknown as Assistant;
  render(
    <SummaryDialog
      assistant={assistant}
      nodeId="EL2"
      title="Opening"
      update={false}
      onClose={handlers.onClose ?? (() => {})}
      onDone={handlers.onDone ?? (() => {})}
    />,
  );
  return assistant;
}

const dialog = () => screen.getByRole("dialog");
const create = () =>
  within(dialog()).getByRole("button", { name: /summary\.(create|retry)/ });
const select = () =>
  within(dialog()).findByRole("combobox") as Promise<HTMLSelectElement>;

describe("SummaryDialog", () => {
  it("offers the models local first, alphabetical, and groups only when there are two kinds", async () => {
    open(
      async () => undefined,
      [
        model("qwen3:8b", "device"),
        model("anthropic/sonnet", "remote"),
        model("llama3", "device"),
      ],
    );
    const field = await select();
    expect([...field.options].map((option) => option.text)).toEqual([
      "llama3",
      "qwen3:8b",
      "anthropic/sonnet",
    ]);
    expect(
      [...field.querySelectorAll("optgroup")].map((group) => group.label),
    ).toEqual(["dock.modelGroup.device", "dock.modelGroup.remote"]);
  });

  it("holds the page with the dots while it writes, and Escape does not close it", async () => {
    let finish: () => void = () => {};
    const onDone = vi.fn();
    open(() => new Promise<void>((resolve) => (finish = resolve)), undefined, {
      onDone,
    });
    await select();
    fireEvent.click(create());

    expect(within(dialog()).getByRole("status").textContent).toBe(
      "summary.working",
    );
    expect(dialog().querySelector(".ui-dots")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeTruthy();

    finish();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("EL2"));
  });

  it("never closes from behind, before the run or during it", async () => {
    // A click outside would close it, and the close cancels the summary.
    // Cancel and Stop are the ways out.
    const onClose = vi.fn();
    open(() => new Promise<void>(() => {}), undefined, { onClose });
    await select();
    const backdrop = () => {
      const scrim = document.querySelector(".ui-scrim");
      if (!(scrim instanceof HTMLElement)) throw new Error("no scrim");
      fireEvent.mouseDown(scrim);
    };

    backdrop();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(create());
    backdrop();
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog()).getByRole("status")).toBeTruthy();
  });

  it("stops the run on Stop, and closes", async () => {
    // A holder rather than a `let`: TypeScript cannot see the closure
    // assign it, and narrows a bare `null` to `never`.
    const seen: { signal: AbortSignal | null } = { signal: null };
    const onClose = vi.fn();
    open(
      (_id, _model, signal) =>
        new Promise<void>((_resolve, reject) => {
          seen.signal = signal;
          signal.addEventListener("abort", () => reject(new Error("stopped")));
        }),
      undefined,
      { onClose },
    );
    await select();
    fireEvent.click(create());
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "summary.stop" }),
    );
    expect(seen.signal?.aborted).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    [
      new ModelRunError({
        code: "context-too-large",
        message: "too big",
        retryable: false,
      }),
      "dock.modelError.context-too-large",
    ],
    [new SummarySourceChangedError(), "dock.problem.summary-source-changed"],
    // A typed error, never a bare `Error` matched by its message.
    [new SummarySourceMissingError(), "dock.problem.summary-source-missing"],
    [new Error("anything else"), "dock.modelError.unknown"],
  ])(
    "says what went wrong in the dialog, and offers Try again",
    async (error, copy) => {
      open(async () => {
        throw error;
      });
      await select();
      fireEvent.click(create());
      expect((await within(dialog()).findByRole("alert")).textContent).toBe(
        copy,
      );
      expect(create().textContent).toBe("summary.retry");
    },
  );

  it.each([
    ["key-expired", "summary.keyExpired", "summary.renewKey"],
    ["limit-reached", "dock.modelError.limit-reached", "summary.newKey"],
  ] as const)(
    "on %s, the sentence's mend is a link that opens the renew popup",
    async (code, fact, mend) => {
      const connector = vi.fn();
      setConnector(connector);
      open(async () => {
        throw new ModelRunError({ code, message: code, retryable: false });
      });
      await select();
      fireEvent.click(create());
      const alert = await within(dialog()).findByRole("alert");
      expect(alert.textContent).toBe(`${fact} ${mend}`);

      fireEvent.click(within(alert).getByRole("button", { name: mend }));
      // The same approval the chat's strip starts, through the one connector.
      expect(connector).toHaveBeenCalledTimes(1);
      expect(connector).toHaveBeenCalledWith("ollama");
      // The dialog stays, so Try again follows the renewal.
      expect(create().textContent).toBe("summary.retry");
      setConnector(() => {});
    },
  );

  it("says so when there is no model, and offers nothing to press", async () => {
    open(async () => undefined, []);
    expect(await within(dialog()).findByText("summary.noModels")).toBeTruthy();
    expect(create().hasAttribute("disabled")).toBe(true);
  });

  it("remembers the model it last wrote with, for the session", async () => {
    const first = open(async () => undefined);
    const field = await select();
    fireEvent.change(field, { target: { value: "ollama\u0000qwen3:8b" } });
    fireEvent.click(create());
    await waitFor(() =>
      expect(first.summaries.generate).toHaveBeenCalledWith(
        "EL2",
        expect.objectContaining({ modelId: "qwen3:8b" }),
        expect.any(AbortSignal),
      ),
    );
    cleanup();
    __resetOverlays();

    open(async () => undefined);
    expect((await select()).value).toBe("ollama\u0000qwen3:8b");
  });
});
