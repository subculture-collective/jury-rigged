import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface TwitchTokenValidation {
    valid: boolean;
    login?: string;
    scopes: string[];
    expiresIn?: number;
    message?: string;
}

export interface TwitchRefreshResult {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    scopes: string[];
}

export interface RuntimeTwitchToken {
    accessToken: string;
    refreshToken?: string;
    expiresAt: string;
    scopes: string[];
    updatedAt: string;
}

export function normalizeIrcToken(token: string): string {
    const trimmed = token.trim();
    if (!trimmed) return '';
    return trimmed.startsWith('oauth:') ? trimmed : `oauth:${trimmed}`;
}

export function stripIrcPrefix(token: string): string {
    return token.trim().replace(/^oauth:/, '');
}

export async function validateTwitchToken(
    token: string,
): Promise<TwitchTokenValidation> {
    if (!token.trim()) return { valid: false, scopes: [], message: 'missing token' };
    const res = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `OAuth ${stripIrcPrefix(token)}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
        login?: string;
        scopes?: string[];
        expires_in?: number;
        message?: string;
    };
    return {
        valid: res.ok,
        login: body.login,
        scopes: Array.isArray(body.scopes) ? body.scopes : [],
        expiresIn: body.expires_in,
        message: body.message,
    };
}

export async function refreshTwitchToken(input: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
}): Promise<TwitchRefreshResult> {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
        client_id: input.clientId,
        client_secret: input.clientSecret,
    });
    const res = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    const payload = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string[];
        message?: string;
    };
    if (!res.ok || !payload.access_token || !payload.expires_in) {
        throw new Error(payload.message ?? `Twitch refresh failed (${res.status})`);
    }
    return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        expiresIn: payload.expires_in,
        scopes: Array.isArray(payload.scope) ? payload.scope : [],
    };
}

export async function readRuntimeTwitchToken(
    filePath: string,
): Promise<RuntimeTwitchToken | null> {
    try {
        const parsed = JSON.parse(await readFile(filePath, 'utf8')) as RuntimeTwitchToken;
        if (!parsed.accessToken || !parsed.expiresAt) return null;
        return parsed;
    } catch {
        return null;
    }
}

export async function writeRuntimeTwitchToken(
    filePath: string,
    token: RuntimeTwitchToken,
): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(token, null, 2), { mode: 0o600 });
    await chmod(filePath, 0o600).catch(() => {});
}

export function runtimeTokenFromRefresh(
    refreshed: TwitchRefreshResult,
): RuntimeTwitchToken {
    return {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
        scopes: refreshed.scopes,
        updatedAt: new Date().toISOString(),
    };
}
