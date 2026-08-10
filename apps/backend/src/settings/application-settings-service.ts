import type {
  ApplicationSettingsResponse,
  EditableApplicationSettingName,
  EnvironmentSettingDto,
  UpdateApplicationSettingsRequest,
} from "@brickr/shared";
import { env } from "../config/env.js";
import { estimateLLMCostUsd } from "../llm/pricing.js";
import type { LLMProviderRegistry } from "../llm/provider-registry.js";
import type { LLMUsageTracker } from "../llm/usage-tracker.js";
import type { ModelProfileRepository } from "../model-profiles/model-profile-repository.js";
import type { ModelProfileService } from "../model-profiles/model-profile-service.js";
import type { ApplicationSettingRepository } from "./application-setting-repository.js";
import type { RuntimeSettings } from "./runtime-settings.js";

export class ApplicationSettingsService {
  constructor(
    private readonly modelProfiles: ModelProfileService,
    private readonly modelProfileRepository: ModelProfileRepository,
    private readonly providers: Pick<LLMProviderRegistry, "availableIds">,
    private readonly usage: LLMUsageTracker,
    private readonly repository: ApplicationSettingRepository,
    private readonly runtime: RuntimeSettings,
  ) {}

  async initialize(): Promise<void> {
    this.runtime.load(await this.repository.findAll());
    await this.syncDefaultModelProfiles();
  }

  async get(): Promise<ApplicationSettingsResponse> {
    const available = new Set(this.providers.availableIds());
    return {
      environment: safeEnvironmentSettings(this.runtime),
      llm: {
        providers: [
          {
            providerId: "openai",
            available: available.has("openai"),
            defaultModel: this.runtime.values.models.openai,
          },
          {
            providerId: "anthropic",
            available: available.has("anthropic"),
            defaultModel: this.runtime.values.models.anthropic,
          },
          {
            providerId: "gemini",
            available: available.has("gemini"),
            defaultModel: this.runtime.values.models.gemini,
          },
          {
            providerId: "mock",
            available: available.has("mock"),
            defaultModel: "mock",
          },
        ],
        models: await this.modelProfiles.listStoredDtos(),
        usage: {
          trackedSince: this.usage.trackedSince.toISOString(),
          entries: this.usage.snapshot().map((entry) => ({
            ...entry,
            estimatedCostUsd: estimateLLMCostUsd(entry),
          })),
        },
      },
    };
  }

  async update(request: UpdateApplicationSettingsRequest): Promise<ApplicationSettingsResponse> {
    const next = this.runtime.preview(request.overrides);
    await this.repository.save(request.overrides);
    this.runtime.load(next);
    await this.syncDefaultModelProfiles();
    return this.get();
  }

  private async syncDefaultModelProfiles(): Promise<void> {
    await Promise.all([
      this.modelProfileRepository.updateModel("openai-default", this.runtime.values.models.openai),
      this.modelProfileRepository.updateModel("anthropic-default", this.runtime.values.models.anthropic),
      this.modelProfileRepository.updateModel("gemini-default", this.runtime.values.models.gemini),
    ]);
  }
}

type DisplayOptions = {
  secret?: boolean;
  editable?: EditableApplicationSettingName;
  inputType?: EnvironmentSettingDto["inputType"];
};

/** Explicit allowlist: credentials and database connection strings never leave the backend. */
function safeEnvironmentSettings(runtime: RuntimeSettings): EnvironmentSettingDto[] {
  const setting = (
    name: string,
    description: string,
    value: string | number | boolean,
    options: DisplayOptions = {},
  ): EnvironmentSettingDto => ({
    name,
    description,
    value: String(value),
    secret: options.secret ?? false,
    editable: options.editable !== undefined,
    source:
      options.editable && runtime.isOverridden(options.editable)
        ? "override"
        : "environment",
    inputType: options.inputType ?? "text",
  });
  const editable = (
    name: EditableApplicationSettingName,
    description: string,
    inputType: EnvironmentSettingDto["inputType"] = "number",
  ): EnvironmentSettingDto =>
    setting(name, description, runtime.effectiveValue(name), {
      editable: name,
      inputType,
    });

  return [
    setting("PORT", "バックエンドが待ち受けるポート番号", env.port, { inputType: "number" }),
    setting("HOST", "バックエンドが待ち受けるホストアドレス", env.host),
    setting("LOG_LEVEL", "バックエンドログの出力レベル", env.logLevel),
    setting("CORS_ORIGIN", "ブラウザーからの接続を許可するオリジン", env.corsOrigins.join(", ")),
    setting("OPENAI_API_KEY", "OpenAI APIの認証キー", env.openai.apiKey ? "設定済み" : "未設定", { secret: true }),
    editable("OPENAI_MODEL", "OpenAIで使用する既定モデル", "text"),
    setting("ANTHROPIC_API_KEY", "Anthropic APIの認証キー", env.anthropic.apiKey ? "設定済み" : "未設定", { secret: true }),
    editable("ANTHROPIC_MODEL", "Anthropicで使用する既定モデル", "text"),
    setting("GEMINI_API_KEY", "Gemini APIの認証キー", env.gemini.apiKey ? "設定済み" : "未設定", { secret: true }),
    editable("GEMINI_MODEL", "Geminiで使用する既定モデル", "text"),
    setting("USE_MOCK_LLM", "実LLMの代わりにMockプロバイダーだけを使用するか", env.llm.useMock ? "ON" : "OFF", { inputType: "toggle" }),
    editable("LLM_TIMEOUT_MS", "1回のLLMリクエストを待つ最大時間（ミリ秒）"),
    editable("LLM_MAX_RETRIES", "失敗したLLMリクエストの最大再試行回数"),
    editable("MIN_RESPONDERS", "投稿に反応するキャラクター数の下限"),
    editable("MAX_RESPONDERS", "投稿に反応するキャラクター数の上限"),
    editable("CONTEXT_POST_LIMIT", "LLMへ文脈として渡す投稿数の上限"),
    editable("MAX_CONCURRENT_CHARACTERS", "同時にLLM応答を生成できるキャラクター数"),
    editable("MAX_CASCADE_DEPTH", "返信・引用が連鎖する最大の深さ"),
  ];
}
