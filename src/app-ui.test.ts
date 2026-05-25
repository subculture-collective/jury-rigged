import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const appDir = join(process.cwd(), 'app');
const srcDir = join(appDir, 'src');

test('fresh Vite React app scaffold exists', () => {
    for (const file of [
        'index.html',
        'src/main.tsx',
        'src/App.tsx',
        'src/components.tsx',
        'src/data.ts',
        'src/styles.css',
        'tsconfig.json',
    ]) {
        assert.ok(existsSync(join(appDir, file)), `missing app/${file}`);
    }
});

test('app implements the design-spec page set without old public UI', () => {
    const app = readFileSync(join(srcDir, 'App.tsx'), 'utf8');
    const data = readFileSync(join(srcDir, 'data.ts'), 'utf8');

    for (const view of [
        'Live Viewer',
        'Broadcast Overlay',
        'Case Directory',
        'Case Details',
        'Jury Voting',
        'Operator Dashboard',
        'About / How It Works',
        'Replay / Recap',
    ]) {
        assert.match(data, new RegExp(view.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    assert.match(app, /function ViewerView/);
    assert.match(app, /function OverlayView/);
    assert.match(app, /function DirectoryView/);
    assert.match(app, /function DetailsView/);
    assert.match(app, /function VotingView/);
    assert.match(app, /function OperatorView/);
});

test('accessibility and reduced-motion affordances are present', () => {
    const components = readFileSync(join(srcDir, 'components.tsx'), 'utf8');
    const styles = readFileSync(join(srcDir, 'styles.css'), 'utf8');

    assert.match(components, /role="log"/);
    assert.match(components, /aria-live="polite"/);
    assert.match(components, /aria-describedby/);
    assert.match(components, /focus-visible:ring/);
    assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});

test('theme tokens match courtroom broadcast spec', () => {
    const styles = readFileSync(join(srcDir, 'styles.css'), 'utf8');

    for (const token of [
        '--bg: 210 42% 7%',
        '--surface: 212 38% 10%',
        '--surface-2: 212 34% 14%',
        '--border: 205 28% 23%',
        '--text: 205 40% 92%',
        '--muted: 207 18% 64%',
        '--cyan: 190 92% 58%',
        '--purple: 260 75% 62%',
        '--red: 3 89% 59%',
        '--gold: 38 68% 60%',
        '--green: 145 64% 50%',
    ]) {
        assert.match(styles, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});
