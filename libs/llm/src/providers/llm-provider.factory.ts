
export abstract class LlmProviderFactory {
    public abstract sendMessage(messageOptions:): Promise<void>;
}

