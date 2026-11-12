// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import DeviceNotice from "./DeviceNotice";

vi.mock("react-i18next", () => ({
  // Keys and options: a `t` returning the bare key erases plural selection,
  // so this file pins which key is asked for and with what count. The strings
  // are pinned against real i18next in `deviceNotice.i18n.test.ts`.
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count === undefined ? key : `${key}:${opts.count}`,
  }),
}));

afterEach(() => cleanup());

// Pins when the device notice speaks and what it says. The rows find the pill
// by its class, not by a role: the pill carries no live region, because its
// count moves on every save and a polite region re-announces on every change,
// so permanent regions in `App` announce for it. A role query returns null
// whether or not the pill rendered.
//
// The notice's lifetime follows the queue, not the connection: it leaves on
// reconnect only when the queue is empty. Hiding it whenever the browser is
// online would hide changes the queue still holds.

/** `navigator.onLine` is a read-only accessor; tests have to redefine it. */
function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

/** The pill, by the class the seam names. */
function pill() {
  return document.querySelector(".device-notice");
}

beforeEach(() => setOnline(true));

describe("the offline face", () => {
  it("says nothing at all while the connection is up and nothing is held", () => {
    // Absent, not hidden: an invisible notice is still in the accessibility
    // tree and still read out.
    render(<DeviceNotice status={null} />);
    expect(pill()).toBeNull();
  });

  it("appears when the connection drops", () => {
    render(<DeviceNotice status={null} />);
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(pill()?.textContent).toContain("app.offline");
    // The tone separates this face from the other two at a glance.
    expect(pill()?.getAttribute("data-tone")).toBe("attention");
  });

  it("removes itself when the connection returns — while the queue is empty", () => {
    render(<DeviceNotice status={null} />);
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(pill()).not.toBeNull();

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    // It leaves on its own, with nothing to dismiss, but only because the
    // queue is empty; the held-work rows pin the other half.
    expect(pill()).toBeNull();
  });

  it("offers nothing to press", () => {
    render(<DeviceNotice status={null} />);
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    // Scoped to the pill rather than the page: a page-wide button query also
    // passes when no notice rendered.
    expect(pill()?.querySelectorAll("button, a, input").length).toBe(0);
  });

  it("catches an offline state that was already true on first render", () => {
    // A component mounted while already offline gets no transition event, so
    // it reads `navigator.onLine` at first render.
    setOnline(false);
    render(<DeviceNotice status={null} />);
    expect(pill()).not.toBeNull();
  });
});

describe("the held-work faces", () => {
  it("shows the count while ONLINE — the queue owns the lifetime, not the connection", () => {
    // Coming back online starts a drain; it does not empty one. A notice that
    // hides whenever the browser is online goes dark while the writer believes
    // the work is safe and nothing has landed yet.
    render(<DeviceNotice status={{ kind: "held", files: 2, stuck: true }} />);
    expect(pill()?.textContent).toBe("app.onlyOnDevice:2");
    expect(pill()?.getAttribute("data-tone")).toBe("alert");
  });

  it("counts structural work in the same face, with the same words", () => {
    // Structural work is held work: it is counted and said in the same
    // sentence as prose, because telling the two apart changes nothing the
    // writer would do.
    render(<DeviceNotice status={{ kind: "held", files: 1, stuck: true }} />);
    expect(pill()?.textContent).toBe("app.onlyOnDevice:1");
    expect(pill()?.getAttribute("data-tone")).toBe("alert");
  });

  it("shows ONE pill when both offline and holding work, and it is the count", () => {
    // Asserted as a cardinality, because a pill painting both faces would pass
    // a presence check. Offline is the cause and the count the consequence,
    // so one sentence says both.
    setOnline(false);
    const { container } = render(
      <DeviceNotice status={{ kind: "held", files: 3, stuck: true }} />,
    );
    expect(container.querySelectorAll(".device-notice").length).toBe(1);
    expect(pill()?.textContent).toBe("app.onlyOnDevice:3");
    expect(pill()?.textContent).not.toContain("app.offline");
  });

  it("falls back to the offline face when the queue drains while still offline", () => {
    // Re-rendered rather than mounted twice: two separate renders pass on a
    // component that early-returns on a memoized branch. Still offline, the
    // notice does not vanish; it says the smaller true thing.
    setOnline(false);
    const { rerender } = render(
      <DeviceNotice status={{ kind: "held", files: 2, stuck: true }} />,
    );
    expect(pill()?.textContent).toBe("app.onlyOnDevice:2");

    rerender(<DeviceNotice status={null} />);
    expect(pill()?.textContent).toContain("app.offline");
    expect(pill()?.getAttribute("data-tone")).toBe("attention");
  });

  it("appears on the same mounted instance when work arrives while online", () => {
    // The ordinary path: nothing held, connection fine, then a save lands in
    // the working copy.
    const { rerender } = render(<DeviceNotice status={null} />);
    expect(pill()).toBeNull();

    rerender(<DeviceNotice status={{ kind: "held", files: 1, stuck: true }} />);
    expect(pill()?.textContent).toBe("app.onlyOnDevice:1");
  });

  it("offers nothing to press on the held-work face either", () => {
    // The held-work face has no retry control either.
    render(<DeviceNotice status={{ kind: "held", files: 2, stuck: true }} />);
    expect(pill()?.querySelectorAll("button, a, input").length).toBe(0);
  });

  it("says nothing while the queue is draining normally online", () => {
    // Work moving on a working connection resolves in seconds, and a standing
    // notice over the prose for a condition that fixes itself is a
    // distraction. The save chip says it in place.
    render(<DeviceNotice status={{ kind: "held", files: 3, stuck: false }} />);
    expect(pill()).toBeNull();
  });

  it("appears for held work once the connection goes", () => {
    // Offline, the held work will not drain until the writer acts, so the
    // notice appears.
    setOnline(false);
    render(<DeviceNotice status={{ kind: "held", files: 3, stuck: false }} />);
    expect(pill()?.textContent).toBe("app.onlyOnDevice:3");
  });

  it("appears for a stuck queue even while online", () => {
    // The destination refused a push and nothing retries until the cause is
    // fixed or a new session starts; the connection is not what is wrong.
    render(<DeviceNotice status={{ kind: "held", files: 1, stuck: true }} />);
    expect(pill()?.textContent).toBe("app.onlyOnDevice:1");
    expect(pill()?.getAttribute("data-tone")).toBe("alert");
  });

  it("goes away rather than green when the work reaches its destination", () => {
    // The column is for things that are wrong, so a drained queue shows no
    // confirmation pill. The save chip's move from the sync ring to the tick
    // tells a drain from a discard, in place.
    const { rerender } = render(
      <DeviceNotice status={{ kind: "held", files: 2, stuck: true }} />,
    );
    expect(pill()).toBeTruthy();

    rerender(<DeviceNotice status={null} />);
    expect(pill()).toBeNull();
  });

  it("keeps the offline face when the queue drains while the connection is still gone", () => {
    // The drain and the connection are separate facts. With nothing held and
    // no connection, the plain offline notice remains: not silence, and no
    // confirmation over it.
    setOnline(false);
    render(<DeviceNotice status={null} />);
    expect(pill()?.textContent).toBe("app.offline");
    expect(pill()?.getAttribute("data-tone")).toBe("attention");
  });

  it("has no tone that is good news", () => {
    // The column's tones: one for something to act on, one for something that
    // clears itself, and none for good news, which the save chip carries.
    setOnline(false);
    const { rerender } = render(<DeviceNotice status={null} />);
    const tones = new Set<string | null | undefined>();
    tones.add(pill()?.getAttribute("data-tone"));
    rerender(<DeviceNotice status={{ kind: "held", files: 1, stuck: true }} />);
    tones.add(pill()?.getAttribute("data-tone"));
    expect(tones).toEqual(new Set(["attention", "alert"]));
  });

  it("carries no live region of its own — the column announces", () => {
    // Its text carries a count that moves on every save, and a polite region
    // re-announces on every change.
    render(<DeviceNotice status={{ kind: "held", files: 2, stuck: true }} />);
    expect(pill()?.getAttribute("role")).toBeNull();
    expect(pill()?.getAttribute("aria-live")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

// The lost-change notice cannot clear itself, since no drain brings a lost
// change back, so it is the one pill with a control and the destructive tone.
// It has its own class, apart from `.device-notice`, so the held
// and offline rows keep their meaning.
describe("the lost face", () => {
  const lostPill = () => document.querySelector(".device-loss");

  it("says nothing when nothing was lost", () => {
    render(<DeviceNotice status={null} lost={0} />);
    expect(lostPill()).toBeNull();
  });

  it("says how many files lost a change, in the loss tone", () => {
    render(<DeviceNotice status={null} lost={2} />);
    expect(lostPill()?.textContent).toBe("app.changesLost:2");
    expect(lostPill()?.getAttribute("data-tone")).toBe("loss");
  });

  it("has one control, and it dismisses the loss", () => {
    const onDismissLost = vi.fn();
    render(
      <DeviceNotice status={null} lost={1} onDismissLost={onDismissLost} />,
    );
    const buttons = lostPill()?.querySelectorAll("button") ?? [];
    expect(buttons.length).toBe(1);
    expect(buttons[0].getAttribute("aria-label")).toBe(
      "app.changesLostDismiss",
    );
    fireEvent.click(buttons[0]);
    expect(onDismissLost).toHaveBeenCalledTimes(1);
  });

  it("stands beside the held face rather than replacing it", () => {
    // One change gone and other work still held are both true, and each pill
    // says one of them.
    render(
      <DeviceNotice
        status={{ kind: "held", files: 3, stuck: true }}
        lost={1}
      />,
    );
    expect(lostPill()?.textContent).toBe("app.changesLost:1");
    expect(pill()?.textContent).toBe("app.onlyOnDevice:3");
  });

  it("leaves the offline face standing too", () => {
    setOnline(false);
    render(<DeviceNotice status={null} lost={1} />);
    expect(lostPill()).not.toBeNull();
    expect(pill()?.textContent).toBe("app.offline");
  });
});
