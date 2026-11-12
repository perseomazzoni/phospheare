// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TFunction } from "i18next";
import { isDefaultChatTitle } from "../../ai/domain/chatTitle";
import type { ChatKind } from "../../ai/domain/types";

/**
 * A chat's name as the screen says it: the one it was given or, while it
 * still carries the stored English default, its kind's name in the writer's
 * language. Every surface that names a chat goes through this, so an English
 * default never heads a dock in another language.
 */
export function chatTitleShown(
  t: TFunction,
  chat: { readonly title: string; readonly kind: ChatKind },
): string {
  return isDefaultChatTitle(chat.title, chat.kind)
    ? t(`dock.chatKind.${chat.kind}`)
    : chat.title;
}
