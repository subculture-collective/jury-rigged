/**
 * Twitch Chat Command Parser
 *
 * Parses chat commands like !prompt, !press, !present, !vote, !sentence
 * and validates parameters.
 */

export interface CommandParseResult {
    action: 'prompt' | 'press' | 'present' | 'vote' | 'sentence';
    username: string;
    timestamp: number;
    params: Record<string, any>;
}

/**
 * Parse a chat message into a command
 * Returns null if invalid or not a command
 */
export function parseCommand(
    rawMessage: string,
    username: string,
): CommandParseResult | null {
    const trimmed = rawMessage.trim();

    // Must start with !
    if (!trimmed.startsWith('!')) {
        return null;
    }

    const parts = trimmed.split(/\s+/);
    const command = parts[0].toLowerCase();

    try {
        switch (command) {
            case '!prompt':
                return parsePromptCommand(parts, username);

            case '!press':
                return parsePressCommand(parts, username);

            case '!present':
                return parsePresentCommand(parts, username);

            case '!vote':
                return parseVoteCommand(parts, username);

            case '!sentence':
                return parseSentenceCommand(parts, username);

            default:
                return null;
        }
    } catch (err) {
        console.warn(`Failed to parse command: ${rawMessage}`, err);
        return null;
    }
}

/**
 * Parse !prompt command
 * Format: !prompt <fictional case idea>
 */
function parsePromptCommand(
    parts: string[],
    username: string,
): CommandParseResult | null {
    const prompt = parts.slice(1).join(' ').trim().replace(/\s+/g, ' ');
    if (prompt.length < 10 || prompt.length > 500) {
        console.warn(`Invalid !prompt command length: ${prompt.length}`);
        return null;
    }

    return {
        action: 'prompt',
        username,
        timestamp: Date.now(),
        params: { prompt },
    };
}

/**
 * Parse !press command
 * Format: !press <statementNumber>
 */
function parsePressCommand(
    parts: string[],
    username: string,
): CommandParseResult | null {
    if (parts.length < 2) {
        console.warn(`Invalid !press command: missing statementNumber`);
        return null;
    }

    const statementNumber = parseInt(parts[1], 10);
    if (
        isNaN(statementNumber) ||
        statementNumber < 1 ||
        statementNumber > 100
    ) {
        console.warn(`Invalid statement number: ${parts[1]}`);
        return null;
    }

    return {
        action: 'press',
        username,
        timestamp: Date.now(),
        params: { statementNumber },
    };
}

/**
 * Parse !present command
 * Format: !present <evidenceId> [statementNumber]
 */
function parsePresentCommand(
    parts: string[],
    username: string,
): CommandParseResult | null {
    if (parts.length < 2) {
        console.warn(`Invalid !present command: missing evidenceId`);
        return null;
    }

    const evidenceId = parts[1].toLowerCase();
    if (!evidenceId || evidenceId.length > 64) {
        console.warn(`Invalid evidenceId: ${parts[1]}`);
        return null;
    }

    const statementNumber = parts[2] ? parseInt(parts[2], 10) : undefined;
    if (statementNumber && (isNaN(statementNumber) || statementNumber < 1)) {
        console.warn(`Invalid statement number: ${parts[2]}`);
        return null;
    }

    return {
        action: 'present',
        username,
        timestamp: Date.now(),
        params: { evidenceId, statementNumber },
    };
}

/**
 * Parse !vote command
 * Format: !vote <choice>
 */
function parseVoteCommand(
    parts: string[],
    username: string,
): CommandParseResult | null {
    if (parts.length < 2) {
        console.warn(`Invalid !vote command: missing choice`);
        return null;
    }

    const choice = parts[1].toLowerCase();
    if (!choice || choice.length > 64) {
        console.warn(`Invalid vote choice: ${parts[1]}`);
        return null;
    }

    return {
        action: 'vote',
        username,
        timestamp: Date.now(),
        params: { voteType: 'verdict', choice },
    };
}

/**
 * Parse !sentence command
 * Format: !sentence <choice>
 */
function parseSentenceCommand(
    parts: string[],
    username: string,
): CommandParseResult | null {
    if (parts.length < 2) {
        console.warn(`Invalid !sentence command: missing sentence choice`);
        return null;
    }

    const choice = parts[1].toLowerCase();
    if (!choice || choice.length > 64) {
        console.warn(`Invalid sentence choice: ${parts[1]}`);
        return null;
    }

    return {
        action: 'sentence',
        username,
        timestamp: Date.now(),
        params: { voteType: 'sentence', choice },
    };
}

/**
 * Validate a command result (check for required fields, etc.)
 */
export function validateCommand(cmd: CommandParseResult): boolean {
    if (!cmd.action || !cmd.username || cmd.timestamp <= 0) {
        return false;
    }

    switch (cmd.action) {
        case 'press':
            return (
                !isNaN(cmd.params.statementNumber) &&
                cmd.params.statementNumber > 0
            );

        case 'prompt':
            return (
                typeof cmd.params.prompt === 'string' &&
                cmd.params.prompt.length >= 10 &&
                cmd.params.prompt.length <= 500
            );

        case 'present':
            return (
                typeof cmd.params.evidenceId === 'string' &&
                cmd.params.evidenceId.length > 0
            );

        case 'vote':
        case 'sentence':
            return (
                typeof cmd.params.choice === 'string' &&
                cmd.params.choice.length > 0
            );

        default:
            return false;
    }
}
