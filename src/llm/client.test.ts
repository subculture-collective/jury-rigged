import assert from 'node:assert/strict';
import test from 'node:test';
import { llmGenerate, llmGenerateDetailed } from './client.js';

type EnvKey =
    | 'OPENROUTER_API_KEY'
    | 'LLM_MOCK'
    | 'LLM_MODELS'
    | 'LLM_MODEL'
    | 'LLM_PROVIDER'
    | 'LLAMA_LINE_BASE_URL'
    | 'LLAMA_LINE_API_KEY'
    | 'LLAMA_LINE_MODEL'
    | 'OLLAMA_BASE_URL'
    | 'OLLAMA_API_KEY'
    | 'OLLAMA_MODEL';

function withTemporaryEnv(
    updates: Partial<Record<EnvKey, string | undefined>>,
    run: () => Promise<void>,
): Promise<void> {
    const previous = new Map<EnvKey, string | undefined>();

    for (const key of Object.keys(updates) as EnvKey[]) {
        previous.set(key, process.env[key]);
        const value = updates[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }

    return run().finally(() => {
        for (const [key, value] of previous.entries()) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });
}

test('llmGenerate falls back when provider returns empty message content', async () => {
    const originalFetch = globalThis.fetch;
    const originalArgv = [...process.argv];

    globalThis.fetch = async () =>
        new Response(
            JSON.stringify({
                choices: [
                    {
                        message: {
                            role: 'assistant',
                            content: '',
                            reasoning:
                                'Internal reasoning consumed the token budget before final answer.',
                        },
                    },
                ],
            }),
            {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                },
            },
        );

    process.argv = process.argv.filter(arg => arg !== '--test');

    await withTemporaryEnv(
        {
            OPENROUTER_API_KEY: 'test-key',
            LLM_PROVIDER: 'openrouter',
            LLM_MOCK: 'false',
            LLM_MODELS: 'stepfun/step-3.5-flash:free',
            LLAMA_LINE_BASE_URL: undefined,
            LLAMA_LINE_API_KEY: undefined,
            LLAMA_LINE_MODEL: undefined,
            OLLAMA_BASE_URL: undefined,
            OLLAMA_API_KEY: undefined,
            OLLAMA_MODEL: undefined,
        },
        async () => {
            const output = await llmGenerate({
                messages: [
                    {
                        role: 'system',
                        content: 'You are a courtroom defense attorney.',
                    },
                    {
                        role: 'user',
                        content: 'Deliver your opening statement.',
                    },
                ],
                maxTokens: 180,
            });

            assert.ok(output.length > 0, 'Expected non-empty fallback text when model content is empty');
        },
    ).finally(() => {
        globalThis.fetch = originalFetch;
        process.argv = originalArgv;
    });
});

test('llmGenerate returns sanitized provider content when non-empty', async () => {
    const originalFetch = globalThis.fetch;
    const originalArgv = [...process.argv];

    globalThis.fetch = async () =>
        new Response(
            JSON.stringify({
                choices: [
                    {
                        message: {
                            role: 'assistant',
                            content:
                                '"**Objection!** Visit https://example.com for docs"',
                        },
                    },
                ],
            }),
            {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                },
            },
        );

    process.argv = process.argv.filter(arg => arg !== '--test');

    await withTemporaryEnv(
        {
            OPENROUTER_API_KEY: 'test-key',
            LLM_PROVIDER: 'openrouter',
            LLM_MOCK: 'false',
            LLM_MODELS: 'stepfun/step-3.5-flash:free',
            LLAMA_LINE_BASE_URL: undefined,
            LLAMA_LINE_API_KEY: undefined,
            LLAMA_LINE_MODEL: undefined,
            OLLAMA_BASE_URL: undefined,
            OLLAMA_API_KEY: undefined,
            OLLAMA_MODEL: undefined,
        },
        async () => {
            const output = await llmGenerate({
                messages: [
                    { role: 'system', content: 'You are concise.' },
                    { role: 'user', content: 'Say one line.' },
                ],
                maxTokens: 120,
            });

            assert.equal(output, 'Objection! Visit for docs');
        },
    ).finally(() => {
        globalThis.fetch = originalFetch;
        process.argv = originalArgv;
    });
});

test('llmGenerateDetailed reads llama-line SSE chat completions', async () => {
    const originalFetch = globalThis.fetch;
    const originalArgv = [...process.argv];
    let requestedUrl = '';
    let authorization = '';
    let requestBody: any;

    globalThis.fetch = async (url, init) => {
        requestedUrl = String(url);
        authorization = String((init?.headers as Record<string, string>).Authorization);
        requestBody = JSON.parse(String(init?.body));
        return new Response(
            [
                'data: {"request_id":"abc","position":1,"wait_seconds":0,"status":"queued"}',
                '',
                'data: {"choices":[{"message":{"role":"assistant","content":"Court is in **session**."}}]}',
                '',
            ].join('\n'),
            {
                status: 200,
                headers: { 'content-type': 'text/event-stream' },
            },
        );
    };

    process.argv = process.argv.filter(arg => arg !== '--test');

    await withTemporaryEnv(
        {
            LLM_PROVIDER: 'llama-line',
            LLM_MOCK: 'false',
            LLM_MODELS: undefined,
            LLM_MODEL: undefined,
            OPENROUTER_API_KEY: undefined,
            LLAMA_LINE_BASE_URL: 'http://llama-line:11434',
            LLAMA_LINE_API_KEY: 'broker-key',
            LLAMA_LINE_MODEL: 'qwen2.5-coder:14b',
        },
        async () => {
            const result = await llmGenerateDetailed({
                messages: [{ role: 'user', content: 'Say one line.' }],
                temperature: 0.2,
                maxTokens: 32,
            });

            assert.equal(result.text, 'Court is in session.');
            assert.equal(result.provider, 'llama-line');
            assert.equal(result.model, 'qwen2.5-coder:14b');
            assert.equal(requestedUrl, 'http://llama-line:11434/v1/chat/completions');
            assert.equal(authorization, 'Bearer broker-key');
            assert.equal(requestBody.stream, false);
        },
    ).finally(() => {
        globalThis.fetch = originalFetch;
        process.argv = originalArgv;
    });
});

test('llmGenerateDetailed supports llama-line base URLs that already include /v1', async () => {
    const originalFetch = globalThis.fetch;
    const originalArgv = [...process.argv];
    let requestedUrl = '';

    globalThis.fetch = async (url) => {
        requestedUrl = String(url);
        return new Response(
            JSON.stringify({ choices: [{ message: { content: 'Plain JSON works.' } }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        );
    };

    process.argv = process.argv.filter(arg => arg !== '--test');

    await withTemporaryEnv(
        {
            LLM_PROVIDER: 'llama-line',
            LLM_MOCK: 'false',
            LLAMA_LINE_BASE_URL: 'http://10.0.0.50:11434/v1',
            LLAMA_LINE_API_KEY: 'broker-key',
            LLAMA_LINE_MODEL: 'qwen3:14b',
            OPENROUTER_API_KEY: undefined,
            LLM_MODELS: undefined,
        },
        async () => {
            const result = await llmGenerateDetailed({
                messages: [{ role: 'user', content: 'Say one line.' }],
            });
            assert.equal(result.text, 'Plain JSON works.');
            assert.equal(requestedUrl, 'http://10.0.0.50:11434/v1/chat/completions');
        },
    ).finally(() => {
        globalThis.fetch = originalFetch;
        process.argv = originalArgv;
    });
});
