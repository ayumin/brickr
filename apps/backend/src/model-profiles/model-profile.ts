/**
 * ModelProfile domain model.
 *
 * A character points at a ModelProfile by id and never at a provider or model
 * directly. Swapping which model backs a character must not touch its persona.
 */
import type { ProviderId } from "../llm/provider.js";

export type ModelProfile = {
  id: string;
  providerId: ProviderId;
  /** Provider-specific model name, e.g. "gpt-4o-mini". */
  model: string;
};
