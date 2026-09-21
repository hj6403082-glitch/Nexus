import { DEFAULT_GEMINI_MODEL, describeKeyProblem } from './gemini';
import { DEFAULT_OLLAMA_HOST, DEFAULT_OLLAMA_MODEL, listOllamaModels } from './ollama';

export type ProviderName = 'ollama' | 'gemini' | 'none';

export interface Resolved {
  provider: ProviderName;
  model: string;
  host: string;
  key: string;
  /** Why this provider, in one line the HUD can show. */
  reason: string;
}

/**
 * WHICH BRAIN, AND WHY.
 *
 * `NEXUS_AI_PROVIDER` decides when it is set. When it is not, the choice is
 * made by what is actually available, and LOCAL WINS: if Ollama is running,
 * NEXUS uses it. A local model costs nothing per token, needs no credential,
 * works offline, and keeps the conversation on the machine — for an assistant
 * you talk to continuously, those matter more than the last few points of
 * benchmark.
 *
 * Auto-detection probes Ollama with a short timeout, so a machine without it
 * falls through to Gemini quickly rather than hanging the first question.
 */
/**
 * The inputs the choice depends on. Separated from `resolveProvider` so the
 * POLICY can be tested without a network — the probe is the only part that
 * needs one, and it is the part with nothing interesting to decide.
 */
export interface Inputs {
  requested?: string;
  /** null = Ollama unreachable. [] = reachable with nothing pulled. */
  models: string[] | null;
  model: string;
  host: string;
  key: string;
  geminiModel: string;
}

export function decideProvider(inputs: Inputs): Resolved {
  const { models, model, host, key, geminiModel } = inputs;
  const requested = inputs.requested?.trim().toLowerCase();

  if (requested === 'ollama') {
    return { provider: 'ollama', model, host, key: '', reason: 'NEXUS_AI_PROVIDER=ollama' };
  }
  if (requested === 'gemini') {
    return key
      ? { provider: 'gemini', model: geminiModel, host, key, reason: 'NEXUS_AI_PROVIDER=gemini' }
      : {
          provider: 'none',
          model: '',
          host,
          key: '',
          reason: 'NEXUS_AI_PROVIDER=gemini but GEMINI_API_KEY is not set.',
        };
  }

  const geminiUsable = Boolean(key) && !describeKeyProblem(key);

  // Auto. Local first — but only if it can actually answer.
  if (models && models.length > 0) {
    // Prefer the configured model if it is pulled; otherwise use one that is,
    // so a fresh Ollama carrying any model just works.
    const installed = models.some((m) => m === model || m.startsWith(`${model}:`));
    const chosen = installed ? model : models[0];
    return {
      provider: 'ollama',
      model: chosen,
      host,
      key: '',
      reason: installed
        ? `Ollama is running with ${chosen}.`
        : `Ollama is running; ${model} is not pulled, using ${chosen}.`,
    };
  }

  /**
   * RUNNING IS NOT THE SAME AS READY.
   *
   * A fresh Ollama with nothing pulled answers /api/tags with {"models":[]} —
   * a perfectly successful response carrying an EMPTY list. Treating
   * "reachable" as "usable" committed NEXUS to a backend that would 404 every
   * question with "model 'llama3.2' not found", and it did so even when a
   * working Gemini key was sitting right there.
   *
   * Verified against the real server: a stand-in speaking the documented
   * protocol never produced this case, because a stand-in always has models.
   */
  if (models && models.length === 0 && !geminiUsable) {
    return {
      provider: 'none',
      model: '',
      host,
      key: '',
      reason: `Ollama is running at ${host} but has no models. Pull one: ollama pull ${model}`,
    };
  }

  if (geminiUsable) {
    return { provider: 'gemini', model: geminiModel, host, key, reason: 'Gemini key is set.' };
  }
  if (key) {
    return {
      provider: 'gemini',
      model: geminiModel,
      host,
      key,
      reason: 'Gemini key is set but looks wrong.',
    };
  }

  return {
    provider: 'none',
    model: '',
    host,
    key: '',
    reason:
      'No AI backend. Run a local model with "ollama serve" and pull one, or set GEMINI_API_KEY.',
  };
}

/** Reads the environment, probes Ollama, and applies the policy above. */
export async function resolveProvider(): Promise<Resolved> {
  const host = process.env.OLLAMA_HOST?.trim() || DEFAULT_OLLAMA_HOST;
  const model = process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
  const key = process.env.GEMINI_API_KEY?.trim() ?? '';
  const geminiModel = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const requested = process.env.NEXUS_AI_PROVIDER?.trim().toLowerCase();

  // Only probe when the answer can change the outcome.
  const models =
    requested === 'ollama' || requested === 'gemini' ? null : await listOllamaModels(host);

  return decideProvider({ requested, models, model, host, key, geminiModel });
}
