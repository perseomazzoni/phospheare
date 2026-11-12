// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import Button from "./Button";
import { Icon } from "./icons";
import StatusNotice from "./StatusNotice";
import { useOnline } from "./useOnline";

// Where the writer's work is: one notice, one place, two faces, and both mean
// something is wrong. The column holds one notice per place (`DriveNotice`
// names a place too, not a state), so connection trouble is one pill rather
// than two that cover the same fact and disagree about how bad it is.
//
// The faces, in precedence order:
//
//   Held: the queue is holding work and the writer can do something about it.
//   `alert`, with a count of files. Two conditions qualify: the queue has
//   given up on something (`stuck`: a destination refused a push, and nothing
//   retries until the cause is fixed or a new session starts), or the
//   connection is gone. Ordinary pending work while online drains in seconds
//   and does not raise it; the save chip says that state calmly and in place.
//
//   Offline: nothing is held, and the connection is gone. `attention`.
//
// There is no face for good news: this column is for things that are wrong,
// which is also why coming back online never hides the count.
//
// The lifetime is the queue's, not the connection's: coming back
// online starts a drain, it does not finish one. `if (online) return null`
// would hide the count in the seconds that matter most, when the writer has
// reconnected, believes the work is safe, and it has not landed yet. Do not
// add an early return on `online` anywhere in this file.
//
// It does not promise the work is safe. It promises not to stay quiet: the
// app can hold the writer's only copy, and it must never do so silently.
//
// `pointer-events: none` comes from the column, so the notice never impedes
// work. Neither face has a dismiss control: neither condition is an opinion
// the writer can disagree with, and each clears itself when the fact does.
//
// Lost: a queued change is gone and will never land. It is its
// own pill beside whichever face stands, in crimson, the colour the column
// keeps for something destroyed. It is the one fact that cannot clear itself,
// since no drain brings the bytes back, so it is the one pill with a dismiss
// and the one control in the column that takes pointer events. A later save
// of the file does not clear it, because that save may have been made from
// the remote's older text. Besides the dismiss, the editor clears it by
// restoring the change from an open buffer that still holds it,
// usually before the pill has drawn.

export default function DeviceNotice({
  status,
  lost = 0,
  onDismissLost,
}: {
  /**
   * What the queue is holding, from `project/sync/deviceWork.ts`.
   *
   * The shape is declared here rather than imported: `ui/` imports no domain
   * module, so `App` joins the two facts and this component renders its
   * inputs, as `DriveNotice` does. Structural drift between the two
   * declarations is a compile error at the wrapper in `App.tsx`.
   *
   * `null` means there is nothing to say. `files` is never zero on a `held`
   * status, since every queued op names at least one file, and `held` alone
   * does not earn the column; the header's precedence order says what does.
   */
  status: { kind: "held"; files: number; stuck: boolean } | null;
  /** Files whose queued change was lost for good; 0, the default, is none. */
  lost?: number;
  /** The writer has read it. `App` forgets the lost rows. */
  onDismissLost?: () => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();

  const lostPill =
    lost > 0 ? (
      <StatusNotice
        tone="loss"
        className="device-loss"
        action={
          <Button
            variant="icon"
            className="status-notice-dismiss"
            aria-label={t("app.changesLostDismiss")}
            onClick={onDismissLost}
          >
            <Icon name="x" size={12} />
          </Button>
        }
      >
        {t("app.changesLost", { count: lost })}
      </StatusNotice>
    ) : null;

  return (
    <>
      {lostPill}
      <DeviceFace status={status} online={online} />
    </>
  );
}

/** The held and offline faces, independent of the lost pill beside them. */
function DeviceFace({
  status,
  online,
}: {
  status: { kind: "held"; files: number; stuck: boolean } | null;
  online: boolean;
}) {
  const { t } = useTranslation();

  // Held work earns the column only when the writer can act on it. `online`
  // is read here rather than upstream so the component decides which
  // combination is worth a notice, as `DriveNotice` does.
  if (status?.kind === "held" && (status.stuck || !online)) {
    return (
      // `alert`, not `attention`: this face does not clear itself. It clears
      // when the queue drains, which may need the writer to fix the
      // connection, and it can stand for hours.
      <StatusNotice tone="alert" className="device-notice">
        {t("app.onlyOnDevice", { count: status.files })}
      </StatusNotice>
    );
  }

  // Held-but-draining reaches here and shows nothing: the chip has it. So
  // does a healthy online session with an empty queue.
  if (online || status) return null;

  return (
    // `attention`, not `alert`: this face clears itself when the connection
    // returns, and the writer is not asked for anything.
    <StatusNotice tone="attention" className="device-notice">
      {t("app.offline")}
    </StatusNotice>
  );
}
