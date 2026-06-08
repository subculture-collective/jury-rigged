import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIrcToken, runtimeTokenFromRefresh, stripIrcPrefix } from './oauth.js';

describe('twitch oauth helpers', () => {
    it('normalizes IRC token prefix', () => {
        assert.equal(normalizeIrcToken('abc123'), 'oauth:abc123');
        assert.equal(normalizeIrcToken('oauth:abc123'), 'oauth:abc123');
        assert.equal(stripIrcPrefix('oauth:abc123'), 'abc123');
    });

    it('creates runtime token records from refresh results', () => {
        const token = runtimeTokenFromRefresh({
            accessToken: 'access',
            refreshToken: 'refresh',
            expiresIn: 3600,
            scopes: ['chat:read'],
        });

        assert.equal(token.accessToken, 'access');
        assert.equal(token.refreshToken, 'refresh');
        assert.deepEqual(token.scopes, ['chat:read']);
        assert.ok(Date.parse(token.expiresAt) > Date.now());
    });
});
