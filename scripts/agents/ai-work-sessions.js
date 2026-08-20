export class AiWorkSessionError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'AiWorkSessionError';
    this.statusCode = statusCode;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function findCodexModel(models, value) {
  const key = nonEmptyString(value);
  if (!key) return null;
  return (
    (Array.isArray(models) ? models : []).find(
      (model) => model?.model === key || model?.id === key,
    ) || null
  );
}

export function resolveCodexDefaults(
  models,
  {
    configuredModel = process.env.CODEX_MODEL || null,
    configuredEffort = process.env.CODEX_EFFORT || null,
  } = {},
) {
  const visible = (Array.isArray(models) ? models : []).filter((model) => !model.hidden);
  const advertisedDefault = visible.find((model) => model.isDefault) || visible[0] || null;
  const requestedModel = nonEmptyString(configuredModel);
  const model = requestedModel || advertisedDefault?.model || null;
  const descriptor = findCodexModel(visible, model);
  const effort =
    nonEmptyString(configuredEffort) ||
    descriptor?.defaultReasoningEffort ||
    advertisedDefault?.defaultReasoningEffort ||
    null;

  return { model, effort };
}

function validateModelSelection(models, model) {
  if (!model) return null;
  const descriptor = findCodexModel(models, model);
  if (!descriptor) {
    throw new AiWorkSessionError(`Model is not available from Codex app-server: ${model}`);
  }
  return descriptor;
}

function validateEffortSelection(descriptor, effort) {
  if (!effort || !descriptor) return effort || null;
  const supported = descriptor.supportedReasoningEfforts || [];
  if (!supported.some((option) => option.reasoningEffort === effort)) {
    throw new AiWorkSessionError(
      `Reasoning effort ${effort} is not supported by model ${descriptor.model}`,
    );
  }
  return effort;
}

function validSessionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

export class AiWorkSessionStore {
  constructor({ maxEntries = 256 } = {}) {
    this.maxEntries = maxEntries;
    this.sessions = new Map();
  }

  get(aiSessionId) {
    if (!validSessionId(aiSessionId)) return null;
    return this.sessions.get(aiSessionId) || null;
  }

  prepare(
    aiSessionId,
    selection = {},
    { models = [], defaults = { model: null, effort: null } } = {},
  ) {
    if (!validSessionId(aiSessionId)) {
      throw new AiWorkSessionError('aiSessionId must be a safe opaque identifier');
    }

    let session = this.sessions.get(aiSessionId);
    if (!session) {
      session = {
        id: aiSessionId,
        threadId: null,
        model: null,
        effort: null,
        contextReset: false,
        contextResetReason: null,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      };
      this.sessions.set(aiSessionId, session);
      this.#prune();
    }

    session.lastUsedAt = Date.now();
    session.contextReset = false;
    session.contextResetReason = null;

    const hasExplicitModel = Object.hasOwn(selection, 'model') && nonEmptyString(selection.model);
    const hasExplicitEffort =
      Object.hasOwn(selection, 'effort') && nonEmptyString(selection.effort);
    const requestedModel = hasExplicitModel ? nonEmptyString(selection.model) : null;
    const requestedEffort = hasExplicitEffort ? nonEmptyString(selection.effort) : null;

    let model = requestedModel || session.model || defaults.model || null;
    let descriptor = model ? findCodexModel(models, model) : null;

    if (requestedModel) {
      descriptor = validateModelSelection(models, requestedModel);
      model = descriptor.model;
    } else if (descriptor) {
      model = descriptor.model;
    }

    const modelChanged = Boolean(session.model && model && session.model !== model);
    let effort;

    if (requestedEffort) {
      effort = validateEffortSelection(descriptor, requestedEffort);
    } else if (modelChanged) {
      effort = descriptor?.defaultReasoningEffort || defaults.effort || null;
    } else {
      effort = session.effort || defaults.effort || descriptor?.defaultReasoningEffort || null;
      if (
        effort &&
        descriptor &&
        !(descriptor.supportedReasoningEfforts || []).some(
          (option) => option.reasoningEffort === effort,
        )
      ) {
        effort = descriptor.defaultReasoningEffort || null;
      }
    }

    if (effort && descriptor) validateEffortSelection(descriptor, effort);

    session.model = model;
    session.effort = effort;
    return session;
  }

  reset(aiSessionId) {
    const session = this.get(aiSessionId);
    if (!session) {
      if (!validSessionId(aiSessionId)) {
        throw new AiWorkSessionError('aiSessionId must be a safe opaque identifier');
      }
      const created = {
        id: aiSessionId,
        threadId: null,
        model: null,
        effort: null,
        contextReset: true,
        contextResetReason: 'user_reset',
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      };
      this.sessions.set(aiSessionId, created);
      this.#prune();
      return created;
    }

    session.threadId = null;
    session.contextReset = true;
    session.contextResetReason = 'user_reset';
    session.lastUsedAt = Date.now();
    return session;
  }

  publicState(sessionOrId) {
    const session = typeof sessionOrId === 'string' ? this.get(sessionOrId) : sessionOrId || null;
    if (!session) {
      return {
        id: typeof sessionOrId === 'string' ? sessionOrId : null,
        status: 'new',
        model: null,
        effort: null,
        contextReset: false,
        contextResetReason: null,
      };
    }

    return {
      id: session.id,
      status: session.threadId ? 'continuing' : session.contextReset ? 'reset' : 'new',
      model: session.model,
      effort: session.effort,
      contextReset: Boolean(session.contextReset),
      contextResetReason: session.contextResetReason || null,
    };
  }

  #prune() {
    if (this.sessions.size <= this.maxEntries) return;
    const oldest = [...this.sessions.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (oldest) this.sessions.delete(oldest.id);
  }
}
