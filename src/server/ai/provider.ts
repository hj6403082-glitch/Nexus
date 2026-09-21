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
export async function resolveProvider(): Promise<Resolved> {
  const host = process.env.OLLAMA_HOST?.trim() || DEFAULT_OLLAMA_HOST;
  const model = process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
  const key = process.env.GEMINI_API_KEY?.trim() ?? '';
  const geminiModel = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const requested = process.env.NEXUS_AI_PROVIDER?.trim().toLowerCase();

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

  // Auto. Local first.
  const models = await listOllamaModels(host);
  if (models) {
    // Prefer the configured model if it is actually pulled; otherwise use the
    // first one that is, so a fresh Ollama with any model just works.
    const installed = models.some((m) => m === model || m.startsWith(`${model}:`));
    const chosen = installed ? model : (models[0] ?? model);
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

  if (key && !describeKeyProblem(key)) {
    return { provider: 'gemini', model: geminiModel, host, key, reason: 'Gemini key is set.' };
  }
  if (key) {
    return { provider: 'gemini', model: geminiModel, host, key, reason: 'Gemini key is set but looks wrong.' };
  }

  return {
    provider: 'none',
    model: '',
    host,
    key: '',
    reason:
      'No AI backend. Run a local model with "ollama serve" (nothing else to configure), or set GEMINI_API_KEY.',
  };
}
