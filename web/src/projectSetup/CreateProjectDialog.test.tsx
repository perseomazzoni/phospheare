// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CreateProjectDialog from "./CreateProjectDialog";
import { SHAPE_IDS } from "../project/startingShape";
import { CREATE_STEPS } from "../project/createSteps";
import { DOCUMENT_TYPE_OPTIONS, OTHER_DOCUMENT_TYPE } from "../project/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The shared `onCreate` double is cleared per test, so `mock.calls[0]` is
// always this test's own creation.
beforeEach(() => props.onCreate.mockClear());

// ── The creation wizard ──────────────────────────────────────────────────────
//
// The dialog never arrives with a structure chosen. A preselected scaffold is
// the tool holding an opinion about how the writer works, and a beginner
// would accept it and find Parts in their folder they did not ask for.
//
// It never stores the word "Other" as a type: that option opens a field for
// the writer's own words, and the wizard does not go on until they type some.
//
// Every structure in `SHAPE_IDS` is reachable, picking one says what will be
// created, and every choice (structure, language, type, goal) arrives intact
// in the `CreateRequest` that becomes `document-properties.json`.
//
// One question per step, the title last; the rail is stations, never numbers;
// and the final create keeps the dialog open while the work is reported step
// by step from the same catalogue the bar renders.

const props = {
  open: true,
  driveConnected: false,
  // jsdom has no File System Access API, so availability defaults to false
  // here; the availability pins below pass the prop explicitly.
  localAvailable: false,
  email: "writer@example.com",
  localRootReady: true,
  remoteAvailable: true,
  taken: new Set<string>(),
  onCreate: vi.fn(),
  onCancel: vi.fn(),
  progress: null,
  createError: null,
};

const structureSelect = () =>
  screen.getByLabelText("create.structureLabel") as HTMLSelectElement;
const languageSelect = () =>
  screen.getByLabelText("create.languageLabel") as HTMLSelectElement;
const typeSelect = () =>
  screen.getByLabelText("create.typeLabel") as HTMLSelectElement;
const goalInput = () =>
  screen.getByLabelText("create.goalLabel") as HTMLInputElement;

const continueButton = () =>
  screen.getByText("create.continue") as HTMLButtonElement;
const heading = () =>
  screen.getByRole("heading", { level: 2 })?.textContent ?? "";
// The final step's question is both the heading and the field's label, one
// key, because the heading asks in the writer's voice; the selector pins the
// query to the real input.
const nameInput = () =>
  screen.getByLabelText("create.nameLabel", {
    selector: "input",
  }) as HTMLInputElement;

const STEP_HEADINGS = [
  "create.whereLabel",
  "create.stepStructure",
  "create.stepKind",
  "create.stepGenre",
  "create.nameLabel",
];
/** The last step, where the name is asked and the press creates. */
const NAME = STEP_HEADINGS.length - 1;

/**
 * Walks the wizard from wherever it is to `step` (`0..NAME`): Continue
 * forward, Back backward. The positions are queried live, so the walk works
 * from either side of the target.
 */
function goTo(step: number) {
  let guard = 0;
  while (guard++ < 12) {
    const current = STEP_HEADINGS.indexOf(heading());
    if (current === step) return;
    if (current < step) fireEvent.click(continueButton());
    else fireEvent.click(screen.getByText("create.back"));
  }
}

/**
 * Renders with Drive connected and ends on the final step with the name
 * typed, where a creation press happens. Drive, because jsdom has no File
 * System Access API, and with neither destination usable the wizard refuses
 * to advance.
 */
function fillTitle() {
  render(
    <CreateProjectDialog {...props} driveConnected onCreate={props.onCreate} />,
  );
  goTo(NAME);
  fireEvent.change(nameInput(), {
    target: { value: "Once Dark" },
  });
}

describe("CreateProjectDialog", () => {
  it("opens on No structure rather than on a scaffold", () => {
    fillTitle();
    goTo(1);
    expect(structureSelect().value).toBe("empty");
  });

  it("offers exactly the five structures, in order", () => {
    fillTitle();
    goTo(1);
    const values = [...structureSelect().options].map((o) => o.value);
    expect(values).toEqual([...SHAPE_IDS]);
    expect(values).toEqual([
      "empty",
      "threeact",
      "kishotenketsu",
      "freytagspyramid",
      "herosjourney",
    ]);
  });

  /** The structure card's note, matched on a substring: it joins two keys. */
  const card = (key: string): Element | null =>
    [...document.querySelectorAll(".create-card .ui-input-note")].find((node) =>
      (node.textContent ?? "").includes(key),
    ) ?? null;

  it("shows the beginner description of whatever structure is selected", () => {
    // Two keys in one paragraph: the shape's description also goes to the
    // assistant, while its fit is advice for someone choosing and stays here.
    // The mocked `t` echoes keys, so the match is on the
    // substring rather than the whole node.
    fillTitle();
    goTo(1);
    expect(card("create.shapeDesc.empty")).toBeTruthy();
    expect(card("create.shapeFit.empty")).toBeTruthy();
    fireEvent.change(structureSelect(), { target: { value: "herosjourney" } });
    expect(card("create.shapeDesc.herosjourney")).toBeTruthy();
    expect(card("create.shapeDesc.empty")).toBeNull();
  });

  it("says nothing will be created while No structure is chosen", () => {
    fillTitle();
    goTo(1);
    // The card carries the description and no chips: an empty structure has
    // no Parts, and the card states that once.
    expect(card("create.shapeDesc.empty")).toBeTruthy();
    expect(document.querySelectorAll(".create-chip").length).toBe(0);
  });

  it("names the Parts a chosen structure will write, in the card", () => {
    fillTitle();
    goTo(1);
    fireEvent.change(structureSelect(), { target: { value: "kishotenketsu" } });
    expect(structureSelect().value).toBe("kishotenketsu");
    // The mocked `t` echoes keys, so this is the catalogue's order, resolved.
    // The chips are the only statement of the Parts.
    const chips = [...document.querySelectorAll(".create-chip")].map(
      (chip) => chip.textContent,
    );
    expect(chips).toEqual([
      "create.partKi",
      "create.partSho",
      "create.partTen",
      "create.partKetsu",
    ]);
  });

  it("creates the project with the Parts the chosen structure named, and its facts", () => {
    const onCreate = vi.fn();
    render(
      <CreateProjectDialog
        {...props}
        driveConnected
        progress={null}
        createError={null}
        onCreate={onCreate}
      />,
    );
    goTo(1);
    fireEvent.change(structureSelect(), { target: { value: "threeact" } });
    goTo(NAME);
    fireEvent.change(nameInput(), {
      target: { value: "Once Dark" },
    });
    fireEvent.click(screen.getByText("create.confirm"));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const request = onCreate.mock.calls[0][0];
    expect(request.title).toBe("Once Dark");
    expect(request.structureId).toBe("threeact");
    expect(
      request.shape.structure.children.map((c: { title: string }) => c.title),
    ).toEqual([
      "create.partSetup",
      "create.partConfrontation",
      "create.partResolution",
    ]);
  });

  it("creates an unstructured project when Empty is left alone", () => {
    const onCreate = vi.fn();
    render(
      <CreateProjectDialog
        {...props}
        driveConnected
        progress={null}
        createError={null}
        onCreate={onCreate}
      />,
    );
    goTo(NAME);
    fireEvent.change(nameInput(), {
      target: { value: "Once Dark" },
    });
    fireEvent.click(screen.getByText("create.confirm"));

    const request = onCreate.mock.calls[0][0];
    expect(request.structureId).toBe("empty");
    expect(request.shape.structure.children).toEqual([]);
    expect(request.shape.files).toEqual([]);
  });

  it("defaults language to the interface's own and stores what was picked", () => {
    fillTitle();
    goTo(1);
    expect(languageSelect().value).toBe("en");
    fireEvent.change(languageSelect(), { target: { value: "it" } });
    goTo(NAME);
    fireEvent.click(screen.getByText("create.confirm"));
    expect(props.onCreate.mock.calls[0][0].language).toBe("it");
  });

  it("offers exactly the shipped languages, by their own names", () => {
    fillTitle();
    goTo(1);
    const options = [...languageSelect().options].map((o) => ({
      value: o.value,
      label: o.label,
    }));
    expect(options).toEqual([
      { value: "en", label: "English" },
      { value: "es", label: "Español" },
      { value: "pt", label: "Português" },
      { value: "fr", label: "Français" },
      { value: "de", label: "Deutsch" },
      { value: "it", label: "Italiano" },
    ]);
  });

  it("guides word counts for named types and stays silent for Other", () => {
    fillTitle();
    goTo(2);
    // Novel is the opening selection, and it carries its range.
    expect(screen.getByText("create.typeGuide.novel")).toBeTruthy();

    fireEvent.change(typeSelect(), { target: { value: "Short Story" } });
    expect(screen.getByText("create.typeGuide.shortStory")).toBeTruthy();
    expect(screen.queryByText("create.typeGuide.novel")).toBeNull();

    fireEvent.change(typeSelect(), { target: { value: OTHER_DOCUMENT_TYPE } });
    expect(screen.queryByText(/create\.typeGuide\./)).toBeNull();
  });

  it("offers the six types, named as stored", () => {
    fillTitle();
    goTo(2);
    const values = [...typeSelect().options].map((o) => o.value);
    expect(values).toEqual([...DOCUMENT_TYPE_OPTIONS, OTHER_DOCUMENT_TYPE]);
  });

  it("stores the writer's words for Other, never the word itself", () => {
    fillTitle();
    goTo(2);
    fireEvent.change(typeSelect(), { target: { value: OTHER_DOCUMENT_TYPE } });

    // The custom field appears, and the wizard refuses to continue without it.
    const custom = screen.getByLabelText("create.customTypeLabel");

    fireEvent.change(custom, { target: { value: "  Screenplay  " } });
    // Other clears the goal's prefill; the goal is mandatory, so the writer's
    // own number answers for it here.
    fireEvent.change(goalInput(), { target: { value: "48000" } });
    goTo(NAME);
    fireEvent.click(screen.getByText("create.confirm"));

    const request = props.onCreate.mock.calls[0][0];
    expect(request.type).toBe("Screenplay");
    expect(request.type).not.toBe(OTHER_DOCUMENT_TYPE);
  });

  it("stores the goal as an integer", () => {
    fillTitle();
    goTo(2);
    fireEvent.change(goalInput(), { target: { value: "48000" } });
    goTo(NAME);
    fireEvent.click(screen.getByText("create.confirm"));
    expect(props.onCreate.mock.calls[0][0].goal).toBe(48000);
    expect(Number.isInteger(props.onCreate.mock.calls[0][0].goal)).toBe(true);
  });

  it("refuses an empty goal — the goal is mandatory", () => {
    fillTitle();
    goTo(2);
    // The goal opens prefilled with the type's top value, and a cleared field
    // is not an answer: the spine would have nothing to measure against.
    fireEvent.change(goalInput(), { target: { value: "" } });
    expect(screen.getByText("create.goalRequired")).toBeTruthy();
    expect(continueButton().disabled).toBe(true);
    goTo(NAME);
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it("pre-fills the goal with the selected type's top value", () => {
    fillTitle();
    goTo(2);
    // Novel opens selected, so its range's top lands in the field.
    expect(goalInput().value).toBe("110000");
    goTo(NAME);
    fireEvent.click(screen.getByText("create.confirm"));
    expect(props.onCreate.mock.calls[0][0].goal).toBe(110000);
  });

  it("the untouched goal follows the type; a typed one survives a switch", () => {
    fillTitle();
    goTo(2);
    fireEvent.change(typeSelect(), { target: { value: "Short Story" } });
    expect(goalInput().value).toBe("7500");
    fireEvent.change(typeSelect(), { target: { value: "Novella" } });
    expect(goalInput().value).toBe("50000");
    // The writer's own number stops the prefill from following.
    fireEvent.change(goalInput(), { target: { value: "48000" } });
    fireEvent.change(typeSelect(), { target: { value: "Novel" } });
    expect(goalInput().value).toBe("48000");
  });

  it("Other, which has no guidance, clears an untouched goal", () => {
    fillTitle();
    goTo(2);
    fireEvent.change(typeSelect(), { target: { value: OTHER_DOCUMENT_TYPE } });
    expect(goalInput().value).toBe("");
  });

  it("refuses an unusable goal with a word, never silently dropping it", () => {
    fillTitle();
    goTo(2);
    fireEvent.change(goalInput(), { target: { value: "5.5" } });
    // The refusal shows on the field itself and holds Continue: an unusable
    // number is not a decision.
    expect(screen.getByText("create.goalInvalid")).toBeTruthy();
    expect(continueButton().disabled).toBe(true);
    // Clearing the field is the empty refusal, not a return to valid.
    fireEvent.change(goalInput(), { target: { value: "" } });
    expect(screen.queryByText("create.goalInvalid")).toBeNull();
    expect(screen.getByText("create.goalRequired")).toBeTruthy();
    expect(continueButton().disabled).toBe(true);
  });

  it("stores only a safe integer goal", () => {
    fillTitle();
    goTo(2);
    fireEvent.change(goalInput(), {
      target: { value: "9000000000000000000" },
    });
    expect(screen.getByText("create.goalInvalid")).toBeTruthy();
    expect(continueButton().disabled).toBe(true);
  });

  it("a gated press answers with the reason, never silence", () => {
    fillTitle();
    goTo(2);
    fireEvent.change(typeSelect(), { target: { value: OTHER_DOCUMENT_TYPE } });
    // The custom field's refusal waits for a touch, and the Enter press is
    // one: a gated submission reveals the problem line and stays put.
    expect(screen.queryByText("create.customTypeRequired")).toBeNull();
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(screen.getByText("create.customTypeRequired")).toBeTruthy();
    expect(heading()).toBe("create.stepKind");
  });

  it("Enter advances on the wizard's earlier steps and creates on the last", () => {
    const onCreate = vi.fn();
    render(
      <CreateProjectDialog
        {...props}
        driveConnected
        progress={null}
        createError={null}
        onCreate={onCreate}
      />,
    );
    // The dialog renders through a portal, so the form is on `document.body`.
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(onCreate).not.toHaveBeenCalled();
    expect(heading()).toBe("create.stepStructure");
    // Walk the rest to the last step, then create.
    goTo(NAME);
    fireEvent.change(nameInput(), {
      target: { value: "Once Dark" },
    });
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0][0].title).toBe("Once Dark");
  });

  it("Enter never commits while the final step is gated off", () => {
    const onCreate = vi.fn();
    render(
      <CreateProjectDialog
        {...props}
        driveConnected
        progress={null}
        createError={null}
        onCreate={onCreate}
      />,
    );
    goTo(NAME);
    // No title means nothing to create, and Enter does not pass the gate.
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("defaults to the local device when the disk is available and a root is mapped", () => {
    render(
      <CreateProjectDialog
        {...props}
        driveConnected
        localAvailable
        onCreate={props.onCreate}
      />,
    );
    // jsdom has no File System Access API, so the real provider would force
    // Drive; the pin rests on the mocked availability.
    const local = document.querySelectorAll(".pick")[0] as HTMLElement;
    expect(local.getAttribute("data-on")).toBe("1");
  });

  it("falls back to Drive when the disk is available but no root is mapped", () => {
    render(
      <CreateProjectDialog
        {...props}
        driveConnected
        localAvailable
        localRootReady={false}
        onCreate={props.onCreate}
      />,
    );
    const drive = document.querySelectorAll(".pick")[1] as HTMLElement;
    expect(drive.getAttribute("data-on")).toBe("1");
    const local = document.querySelectorAll(".pick")[0] as HTMLElement;
    expect(local.getAttribute("data-on")).toBe("0");
  });

  it("disables the local destination until a root is mapped, and its hint says why", () => {
    render(
      <CreateProjectDialog
        {...props}
        driveConnected
        localAvailable
        localRootReady={false}
        onCreate={props.onCreate}
      />,
    );
    const local = document.querySelectorAll(".pick")[0] as HTMLElement;
    expect(local.getAttribute("aria-disabled")).toBe("true");
    // The sub owns the reason: the folder is a setup choice, not a
    // create-time pick.
    expect(screen.getByText("create.localSubNoRoot")).toBeTruthy();
  });

  it("refuses to advance when neither a mapped root nor Drive exists", () => {
    render(
      <CreateProjectDialog
        {...props}
        localAvailable
        localRootReady={false}
        onCreate={props.onCreate}
      />,
    );
    expect(screen.getByText("create.noDestinationHint")).toBeTruthy();
    expect(continueButton().disabled).toBe(true);
    // A gated press with nowhere to go stays put.
    fireEvent.click(continueButton());
    expect(heading()).toBe("create.whereLabel");
  });

  it("always promises just the folder — the choose-a-folder label is gone", () => {
    render(
      <CreateProjectDialog
        {...props}
        driveConnected
        localAvailable
        localRootReady={false}
        onCreate={props.onCreate}
      />,
    );
    expect(screen.queryByText("create.confirmChooseFolder")).toBeNull();
    // The final step's promise, once the wizard has walked there.
    goTo(NAME);
    expect(screen.getByText("create.confirm")).toBeTruthy();
  });

  it("names the dialog for assistive tech with the current step's question", () => {
    render(
      <CreateProjectDialog
        {...props}
        driveConnected
        onCreate={props.onCreate}
      />,
    );
    // The per-step heading is the dialog's accessible name.
    expect(
      screen.getByRole("dialog", { name: "create.whereLabel" }),
    ).toBeTruthy();
    goTo(1);
    expect(
      screen.getByRole("dialog", { name: "create.stepStructure" }),
    ).toBeTruthy();
  });

  it("shows the journey rail: one station per step, no numbers", () => {
    render(
      <CreateProjectDialog
        {...props}
        driveConnected
        onCreate={props.onCreate}
      />,
    );
    const dots = [...document.querySelectorAll(".ui-step-dot")];
    expect(dots.length).toBe(STEP_HEADINGS.length);
    expect(dots[0].getAttribute("data-state")).toBe("current");
    expect(dots[1].getAttribute("data-state")).toBe("upcoming");
    // The rail is stations only, never a count; the heading asks.
    expect(heading()).toBe("create.whereLabel");
    expect(screen.queryByText("1/4")).toBeNull();
    goTo(1);
    expect(dots[0].getAttribute("data-state")).toBe("done");
    expect(dots[1].getAttribute("data-state")).toBe("current");
    expect(heading()).toBe("create.stepStructure");
  });

  it("Back and Esc step back; only the first step's cancel closes the dialog", () => {
    render(
      <CreateProjectDialog
        {...props}
        driveConnected
        onCreate={props.onCreate}
      />,
    );
    goTo(1);
    fireEvent.click(screen.getByText("create.back"));
    expect(heading()).toBe("create.whereLabel");
    goTo(1);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(heading()).toBe("create.whereLabel");
    expect(props.onCancel).not.toHaveBeenCalled();
    // On the first step Escape is a cancellation.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("Back preserves every answer on the way and on the way back", () => {
    render(
      <CreateProjectDialog
        {...props}
        driveConnected
        onCreate={props.onCreate}
      />,
    );
    goTo(1);
    fireEvent.change(structureSelect(), { target: { value: "threeact" } });
    goTo(2);
    fireEvent.change(goalInput(), { target: { value: "48000" } });
    goTo(NAME);
    fireEvent.change(nameInput(), {
      target: { value: "Once Dark" },
    });
    // All the way home and back forward again.
    goTo(0);
    expect(heading()).toBe("create.whereLabel");
    goTo(NAME);
    expect(nameInput().value).toBe("Once Dark");
    goTo(2);
    expect(goalInput().value).toBe("48000");
    goTo(1);
    expect(structureSelect().value).toBe("threeact");
  });

  it("restates the earlier choices under the final question (the commit recap)", () => {
    fillTitle();
    goTo(1);
    fireEvent.change(structureSelect(), { target: { value: "threeact" } });
    fireEvent.change(languageSelect(), { target: { value: "it" } });
    goTo(2);
    fireEvent.change(typeSelect(), { target: { value: "Short Story" } });
    goTo(NAME);
    const recap = document.querySelector(".ui-recap") as HTMLElement;
    expect(recap.textContent).toContain("create.shape.threeact");
    // Named in the reader's language; the file keeps the English word.
    expect(recap.textContent).toContain("create.typeName.shortStory");
    expect(recap.textContent).toContain("create.recapGoal");
    expect(recap.textContent).toContain("Italiano");
  });

  it("while creating, the dialog shows the job face from the catalogue and the confirm is busy", () => {
    const { rerender } = render(
      <CreateProjectDialog
        {...props}
        driveConnected
        progress={null}
        createError={null}
        onCreate={props.onCreate}
      />,
    );
    goTo(NAME);
    rerender(
      <CreateProjectDialog
        {...props}
        driveConnected
        progress={{ index: 1 }}
        createError={null}
        onCreate={props.onCreate}
      />,
    );
    // One segment per catalogue entry, states from the index: done, current,
    // the rest upcoming. A new step is one catalogue row.
    const segs = [...document.querySelectorAll(".ui-job-seg")];
    expect(segs.length).toBe(CREATE_STEPS.length);
    expect(segs[0].getAttribute("data-state")).toBe("done");
    expect(segs[1].getAttribute("data-state")).toBe("current");
    expect(segs[2].getAttribute("data-state")).toBe("upcoming");
    expect(screen.getByText("create.progress.documents")).toBeTruthy();
    const bar = document.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuemax")).toBe(
      String(CREATE_STEPS.length),
    );
    // The question is answered; the heading says what is being done instead.
    expect(heading()).toBe("create.creating");
    // The writer watched the work, not the form.
    expect(
      screen.queryByLabelText("create.nameLabel", { selector: "input" }),
    ).toBeNull();
    // The confirm is busy: dots in the button, and nothing can be clicked.
    const confirm = screen.getByText("create.confirm") as HTMLElement;
    const button = confirm.closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("data-loading")).toBe("1");
    fireEvent.click(button);
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it("counts the documents beside the step that writes them", () => {
    const { rerender } = render(
      <CreateProjectDialog
        {...props}
        driveConnected
        progress={null}
        createError={null}
        onCreate={props.onCreate}
      />,
    );
    goTo(NAME);
    rerender(
      <CreateProjectDialog
        {...props}
        driveConnected
        progress={{ index: 1, detail: { done: 12, total: 80 } }}
        createError={null}
        onCreate={props.onCreate}
      />,
    );
    expect(screen.getByText("create.progressCount")).toBeTruthy();
  });

  it("a failed attempt answers inside the dialog, with the wizard back and intact", () => {
    render(
      <CreateProjectDialog
        {...props}
        driveConnected
        progress={null}
        createError="create.failed"
        onCreate={props.onCreate}
      />,
    );
    // The wizard face, not the job face: the error above the foot and the
    // answers still in the fields, so a retry is one press.
    expect(screen.getByText("create.failed")).toBeTruthy();
    expect(heading()).toBe("create.whereLabel");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

// ── The genre step ───────────────────────────────────────────────────────────
//
// The genre is the promise the book makes, declared by the writer. Like the
// structure, it opens on "not said", never gates, and arrives in the request
// as chosen.

describe("the genre step", () => {
  const genreSelect = () =>
    screen.getByLabelText("genre.label") as HTMLSelectElement;
  const blendSelect = () =>
    screen.queryByLabelText("genre.blendLabel") as HTMLSelectElement | null;
  const ageSelect = () =>
    screen.getByLabelText("genre.ageLabel") as HTMLSelectElement;

  it("sits before the name, opens on nothing said, and never gates", () => {
    fillTitle();
    goTo(3);
    expect(heading()).toBe("create.stepGenre");
    expect(genreSelect().value).toBe("");
    expect(ageSelect().value).toBe("");
    // No blend to offer until there is a lead to blend with.
    expect(blendSelect()).toBeNull();
    expect(continueButton().disabled).toBe(false);
    goTo(NAME);
    fireEvent.click(screen.getByText("create.confirm"));
    const request = props.onCreate.mock.calls[0][0];
    expect(request.genres).toEqual([]);
    expect(request.ageCategory).toBeNull();
  });

  it("hands over a lead, a blend and the readers, and recaps the genre", () => {
    fillTitle();
    goTo(3);
    fireEvent.change(genreSelect(), { target: { value: "mystery" } });
    // The blend never offers the lead again.
    const blend = blendSelect();
    expect(
      [...(blend?.options ?? [])].map((option) => option.value),
    ).not.toContain("mystery");
    fireEvent.change(blend as HTMLSelectElement, {
      target: { value: "historical" },
    });
    fireEvent.change(ageSelect(), { target: { value: "young-adult" } });
    goTo(NAME);
    expect(document.querySelector(".ui-recap")?.textContent).toContain(
      "genre.name.mystery + genre.name.historical",
    );
    fireEvent.click(screen.getByText("create.confirm"));
    const request = props.onCreate.mock.calls[0][0];
    expect(request.genres).toEqual(["mystery", "historical"]);
    expect(request.ageCategory).toBe("young-adult");
  });

  it("clears the blend with the lead, so nothing is promoted unasked", () => {
    fillTitle();
    goTo(3);
    fireEvent.change(genreSelect(), { target: { value: "fantasy" } });
    fireEvent.change(blendSelect() as HTMLSelectElement, {
      target: { value: "romance" },
    });
    fireEvent.change(genreSelect(), { target: { value: "" } });
    expect(blendSelect()).toBeNull();
    goTo(NAME);
    fireEvent.click(screen.getByText("create.confirm"));
    expect(props.onCreate.mock.calls[0][0].genres).toEqual([]);
  });

  it("hands over the tropes the writer named, and shows the list it read", () => {
    // Free text, split on commas and shown back as the list.
    fillTitle();
    goTo(3);
    const field = screen.getByLabelText(
      "genre.tropesLabel",
    ) as HTMLInputElement;
    fireEvent.change(field, {
      target: { value: "enemies to lovers, found family, " },
    });
    // The writer's text stays as typed, trailing comma and all.
    expect(field.value).toBe("enemies to lovers, found family, ");
    expect(document.body.textContent).toContain(
      "enemies to lovers · found family",
    );
    goTo(NAME);
    fireEvent.click(screen.getByText("create.confirm"));
    expect(props.onCreate.mock.calls[0][0].tropes).toEqual([
      "enemies to lovers",
      "found family",
    ]);
  });
});

// ── How the project starts ───────────────────────────────────────────────────
//
// Asked only when the Library can import. Blank is the default, so Enter
// carries on into the steps; From a manuscript hands over to the import
// window.

describe("the start step", () => {
  it("is not asked when there is no import to offer", () => {
    render(<CreateProjectDialog {...props} driveConnected />);
    expect(heading()).toBe("create.whereLabel");
  });

  it("opens on Blank, and Continue carries on into today's wizard", () => {
    const onImport = vi.fn();
    render(
      <CreateProjectDialog {...props} driveConnected onImport={onImport} />,
    );
    expect(heading()).toBe("create.start.title");
    const blank = screen.getByLabelText(/create\.start\.blank/, {
      selector: "input",
    }) as HTMLInputElement;
    expect(blank.checked).toBe(true);
    // A rail station for the extra question.
    expect(document.querySelectorAll(".ui-step-dot")).toHaveLength(6);
    fireEvent.click(continueButton());
    expect(heading()).toBe("create.whereLabel");
    expect(onImport).not.toHaveBeenCalled();
    // Back returns to the question; only from it does Cancel close.
    fireEvent.click(screen.getByText("create.back"));
    expect(heading()).toBe("create.start.title");
  });

  it("hands over to the import window for a manuscript", () => {
    const onImport = vi.fn();
    render(
      <CreateProjectDialog {...props} driveConnected onImport={onImport} />,
    );
    fireEvent.click(
      screen.getByLabelText(/create\.start\.manuscript/, { selector: "input" }),
    );
    fireEvent.click(continueButton());
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(props.onCreate).not.toHaveBeenCalled();
  });
});
