// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

export * from "./domain/types";
export * from "./domain/personas";
export * from "./domain/policy";
export * from "./ports";
export * from "./settings";
export { Assistant, askWaiting } from "./application/assistant";
export { ModelRunError } from "./application/runStep";
export { MAP_ANCHORS_MAX } from "./application/budgets";
export {
  SummarySourceChangedError,
  SummarySourceMissingError,
} from "./application/summaries";
export type {
  AssistantDependencies,
  AssistantProblem,
  AssistantSnapshot,
  AnswerText,
  AnswerTextContext,
  ChatSearchDocument,
} from "./application/assistant";
export { OllamaProvider } from "./adapters/ollama";
export { ScriptedModelProvider } from "./adapters/scripted";
export { OpenRouterDirectProvider } from "./adapters/openrouterDirect";
export {
  OpenRouterDirectSearchEngine,
  WikipediaDirectSearchEngine,
} from "./adapters/directSearch";
export { RoutingModelProvider } from "./adapters/routingProvider";
export { parseChat, serializeChat } from "./adapters/chatCodec";
export {
  parseSummary,
  serializeSummary,
  summaryState,
} from "./adapters/summaryCodec";
