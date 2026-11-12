// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect, useState } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import type { NavigateFunction } from "react-router";
import type { ProjectRef } from "../storage";

// Pins that each project gets an editor of its own: a URL that names another
// project mounts a new `EditorScreen` rather than handing the open one a new
// key, so no buffer, lane or engine carries from one project into the next.

const life: string[] = [];

vi.mock(".", () => ({
  EditorScreen: ({ projectKey }: { projectKey: string }) => {
    const [first] = useState(projectKey);
    useEffect(() => {
      life.push(`mount ${first}`);
      return () => {
        life.push(`unmount ${first}`);
      };
    }, [first]);
    return null;
  },
}));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "writer" } }),
}));
vi.mock("./useProjectStore", () => ({ useProjectStore: () => null }));
vi.mock("./services/account", () => ({ accountServices: {} }));
vi.mock("../project/sync/resolve", () => ({
  providerFor: () => ({ id: "fake" }),
}));
vi.mock("./useProjectRef", () => {
  const refs = new Map<string, ProjectRef>();
  return {
    useProjectRef: (projectId: string) => {
      if (!refs.has(projectId))
        refs.set(projectId, {
          providerId: "fake",
          key: projectId,
          name: projectId,
          openedAt: "2026-01-01T00:00:00.000Z",
        });
      return refs.get(projectId);
    },
  };
});

const { default: ProjectRoute } = await import("./ProjectRoute");

let go: NavigateFunction = () => {};
function Steering() {
  go = useNavigate();
  return null;
}

afterEach(() => {
  cleanup();
  life.length = 0;
});

describe("the project route", () => {
  it("mounts a new editor when the URL names another project", () => {
    render(
      <MemoryRouter initialEntries={["/app/project/a"]}>
        <Steering />
        <Routes>
          <Route path="/app/project/:projectId" element={<ProjectRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    act(() => {
      void go("/app/project/b");
    });
    expect(life).toEqual(["mount a", "unmount a", "mount b"]);
  });
});
