import type { LLMGenerateOptions } from '../types.js';

const FALLBACK_MODELS = [
    'google/gemma-3-27b-it:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
];

type LLMProvider = 'openrouter' | 'llama-line' | 'mock';

function runtimeLLMConfig(env: NodeJS.ProcessEnv = process.env): {
    provider: LLMProvider;
    openRouterApiKey: string;
    llamaLineApiKey: string;
    llamaLineBaseUrl: string;
    models: string[];
    forceMock: boolean;
} {
    const openRouterApiKey = (env.OPENROUTER_API_KEY ?? '').trim();
    const llamaLineApiKey = (env.LLAMA_LINE_API_KEY ?? env.OLLAMA_API_KEY ?? '').trim();
    const llamaLineBaseUrl = (env.LLAMA_LINE_BASE_URL ?? env.OLLAMA_BASE_URL ?? '').trim().replace(/\/$/, '');
    const requestedProvider = (env.LLM_PROVIDER ?? '').trim().toLowerCase();
    const provider: LLMProvider =
        requestedProvider === 'llama-line' || requestedProvider === 'llamaline' || requestedProvider === 'ollama' ? 'llama-line'
        : requestedProvider === 'openrouter' ? 'openrouter'
        : requestedProvider === 'mock' ? 'mock'
        : llamaLineBaseUrl && llamaLineApiKey ? 'llama-line'
        : 'openrouter';
    const modelsRaw = (env.LLM_MODELS ?? '').trim();
    const singleModel =
        provider === 'llama-line' ?
            (env.LLAMA_LINE_MODEL ?? env.OLLAMA_MODEL ?? env.LLM_MODEL ?? '').trim()
        :   (env.LLM_MODEL ?? '').trim();
    const models =
        modelsRaw ?
            modelsRaw
                .split(',')
                .map(m => m.trim())
                .filter(Boolean)
        : singleModel ? [singleModel]
        : provider === 'llama-line' ? ['qwen2.5-coder:14b']
        : FALLBACK_MODELS;
    const runningNodeTests = process.argv.includes('--test');
    const forceMock = env.LLM_MOCK === 'true' || runningNodeTests;
    return { provider, openRouterApiKey, llamaLineApiKey, llamaLineBaseUrl, models, forceMock };
}

export interface LLMGenerateDetailedResult {
    text: string;
    provider: LLMProvider;
    model: string;
    status: 'mock' | 'succeeded' | 'fallback';
    latencyMs: number;
    errors: string[];
}

function extractFromXml(text: string): string {
    const contentMatch = text.match(
        /<parameter\s+name=["']content["'][^>]*>([\s\S]*?)<\/parameter>/i,
    );
    if (contentMatch?.[1]) {
        return contentMatch[1].trim();
    }

    return text
        .replace(
            /<\/?(?:function_?calls?|invoke|parameter|tool_call|antml:[a-z_]+)[^>]*>/gi,
            '',
        )
        .trim();
}

export function sanitizeDialogue(text: string): string {
    return extractFromXml(text)
        .replace(/<\/?[a-z_][a-z0-9_-]*(?:\s[^>]*)?\s*>/gi, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
        .replace(/^["']|["']$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

const MOCK_LINES: Array<{ pattern: RegExp; lines: string[] }> = [
    {
        pattern: /opening|statement/i,
        lines: [
            'The facts in this case are stranger than fiction, and the fiction is not great either. We intend to prove every last strange bit of it.',
            'The evidence will speak for itself — loudly, incoherently, and with unusual conviction.',
            'What you are about to hear is either a crime or a misunderstanding of historic proportions. Possibly both.',
            'The prosecution will demonstrate, beyond reasonable doubt, that something happened. The exact nature of that something will become abundantly clear.',
            'We ask only that you keep an open mind — and perhaps a strong stomach.',
            'The defense maintains our client is innocent, and also maintains several other positions that will be revealed at the worst possible moment.',
        ],
    },
    {
        pattern: /witness|testimony|cross/i,
        lines: [
            'I can state with certainty that I observed something. The details are fuzzy, but the certainty is very high.',
            'At the time I thought nothing of it. In retrospect I should have thought quite a lot of it.',
            'I was present. I was observing. What I observed is what you might call difficult to categorize.',
            'Everything I am about to say is accurate to the best of my recollection, which is doing its best.',
            'There was an incident. I was adjacent to it. My proximity was noted by several parties, including myself.',
            'I remember it clearly: there was a moment, and I was in it. The moment was notable. That is my testimony.',
        ],
    },
    {
        pattern: /closing/i,
        lines: [
            'The evidence has spoken. It has spoken at length, somewhat repetitively, and with great emotional commitment.',
            'We ask you to weigh the facts — not the feelings, not the drama, not the seventeen things that went unexpectedly sideways.',
            'One truth remains: something happened, someone did it, and this court must decide what happens next.',
            'The defense rests — on the bedrock of reasonable doubt and a sincere belief that this has all gone far enough.',
            'Justice demands a verdict. Logic demands clarity. The circumstances demand a stiff drink and a long lie-down.',
            'I leave you with this: whatever you decide, decide it with the full weight of your conscience and at least two of your five senses.',
        ],
    },
    {
        pattern: /ruling|verdict/i,
        lines: [
            'On the matter before this court, I have considered the evidence, the arguments, and my own rising blood pressure. The verdict stands.',
            'This court finds the evidence compelling in ways that are difficult to articulate but impossible to ignore.',
            'I have heard enough. The court has heard enough. The court reporter has definitely heard enough.',
            'The ruling of this court is final. The chaos leading to it was anything but. Proceedings are concluded.',
            'After careful deliberation — I wrote things down — this court delivers its judgment.',
            'This court has seen many things. Most of them were other cases. Nevertheless, a verdict is reached.',
        ],
    },
];

const MOCK_LINES_DEFAULT = [
    'Noted. The court acknowledges the point and invites us all to move forward with cautious optimism.',
    'Order. We proceed. Whatever just happened, we proceed from it.',
    'The record reflects the current state of affairs. The current state of affairs is noted.',
    'This court will take that under advisement. We advise ourselves to continue.',
    'The relevant determination having been made, proceedings continue.',
    'So noted. The court is, as always, moving forward.',
];

function pickRandom<T>(arr: [T, ...T[]]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function mockReply(prompt: string): string {
    for (const { pattern, lines } of MOCK_LINES) {
        if (pattern.test(prompt)) {
            return pickRandom(lines as [string, ...string[]]);
        }
    }
    return pickRandom(MOCK_LINES_DEFAULT as [string, ...string[]]);
}

async function tryModelGenerate(
    model: string,
    apiKey: string,
    messages: LLMGenerateOptions['messages'],
    temperature: number,
    maxTokens: number,
): Promise<
    { success: true; text: string } | { success: false; reason: string }
> {
    try {
        const response = await fetch(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature,
                    max_tokens: maxTokens,
                }),
            },
        );

        if (!response.ok) {
            return {
                success: false,
                reason: `HTTP ${response.status}`,
            };
        }

        const data = (await response.json()) as {
            choices?: [{ message?: { content?: unknown } }];
        };

        const rawContent = data.choices?.[0]?.message?.content;
        const text = typeof rawContent === 'string' ? rawContent : '';
        const sanitized = sanitizeDialogue(text);

        if (!sanitized) {
            return {
                success: false,
                reason: 'Empty content after sanitization',
            };
        }

        return { success: true, text: sanitized };
    } catch (error) {
        return {
            success: false,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}

function parseSseDataEvents(body: string): unknown[] {
    const events: unknown[] = [];
    for (const frame of body.split(/\n\n+/)) {
        const data = frame
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.replace(/^data:\s?/, ''))
            .join('\n')
            .trim();
        if (!data || data === '[DONE]') continue;
        try {
            events.push(JSON.parse(data));
        } catch {
            // Ignore malformed broker/status frames and let caller fail on no content.
        }
    }
    return events;
}

function extractChatCompletionText(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return '';
    const record = payload as Record<string, unknown>;
    const choices = Array.isArray(record.choices) ? record.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const content = message?.content ?? first?.text;
    return typeof content === 'string' ? content : '';
}

async function tryLlamaLineGenerate(input: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: LLMGenerateOptions['messages'];
    temperature: number;
    maxTokens: number;
}): Promise<{ success: true; text: string } | { success: false; reason: string }> {
    if (!input.baseUrl) return { success: false, reason: 'Missing LLAMA_LINE_BASE_URL' };
    if (!input.apiKey) return { success: false, reason: 'Missing LLAMA_LINE_API_KEY' };

    try {
        const endpoint = input.baseUrl.endsWith('/v1') ? `${input.baseUrl}/chat/completions` : `${input.baseUrl}/v1/chat/completions`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${input.apiKey}`,
            },
            body: JSON.stringify({
                model: input.model,
                messages: input.messages,
                temperature: input.temperature,
                max_tokens: input.maxTokens,
                stream: false,
            }),
        });

        if (!response.ok) return { success: false, reason: `HTTP ${response.status}` };

        const body = await response.text();
        const contentType = response.headers.get('content-type') ?? '';
        const payloads =
            contentType.includes('text/event-stream') || body.trim().startsWith('data:') ?
                parseSseDataEvents(body)
            :   [JSON.parse(body)];

        for (const payload of payloads) {
            const record = payload as Record<string, unknown>;
            const status = typeof record?.status === 'string' ? record.status : '';
            if (status === 'queued' || status === 'running') continue;
            if (status === 'ollama_unavailable' || status === 'dropped_by_admin') {
                return { success: false, reason: status };
            }
            const sanitized = sanitizeDialogue(extractChatCompletionText(payload));
            if (sanitized) return { success: true, text: sanitized };
        }

        return { success: false, reason: 'Empty content after sanitization' };
    } catch (error) {
        return { success: false, reason: error instanceof Error ? error.message : String(error) };
    }
}

export async function llmGenerateDetailed(
    options: LLMGenerateOptions,
): Promise<LLMGenerateDetailedResult> {
    const startedAt = Date.now();
    const config = runtimeLLMConfig();
    const { messages, temperature = 0.7, maxTokens = 300 } = options;

    const latestUserMessage = [...messages]
        .reverse()
        .find(message => message.role === 'user')?.content;

    if (config.provider === 'mock' || config.forceMock) {
        return {
            text: mockReply(latestUserMessage ?? ''),
            provider: 'mock',
            model: 'mock',
            status: 'mock',
            latencyMs: Date.now() - startedAt,
            errors: [],
        };
    }

    // Try each model in sequence until one succeeds
    const errors: string[] = [];
    for (const model of config.models) {
        const result =
            config.provider === 'llama-line' ?
                await tryLlamaLineGenerate({
                    baseUrl: config.llamaLineBaseUrl,
                    apiKey: config.llamaLineApiKey,
                    model,
                    messages,
                    temperature,
                    maxTokens,
                })
            : !config.openRouterApiKey ?
                { success: false as const, reason: 'Missing OPENROUTER_API_KEY' }
            :   await tryModelGenerate(
                    model,
                    config.openRouterApiKey,
                    messages,
                    temperature,
                    maxTokens,
                );

        if (result.success) {
            if (errors.length > 0) {
                // eslint-disable-next-line no-console
                console.info(
                    `[llm] model="${model}" succeeded after ${errors.length} failures`,
                );
            }
            return {
                text: result.text,
                provider: config.provider,
                model,
                status: 'succeeded',
                latencyMs: Date.now() - startedAt,
                errors,
            };
        }

        errors.push(`${model}: ${result.reason}`);
        // eslint-disable-next-line no-console
        console.warn(`[llm] model="${model}" failed: ${result.reason}`);
    }

    // All models failed, fall back to mock
    // eslint-disable-next-line no-console
    console.warn(
        `[llm] All ${config.models.length} models failed; falling back to mock dialogue. Errors:\n${errors.join('\n')}`,
    );
    return {
        text: mockReply(latestUserMessage ?? ''),
        provider: 'mock',
        model: 'mock',
        status: 'fallback',
        latencyMs: Date.now() - startedAt,
        errors,
    };
}

export async function llmGenerate(
    options: LLMGenerateOptions,
): Promise<string> {
    return (await llmGenerateDetailed(options)).text;
}
