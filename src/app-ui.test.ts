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

test('public views and shell match the current nav model', () => {
    const app = readFileSync(join(srcDir, 'App.tsx'), 'utf8');
    const data = readFileSync(join(srcDir, 'data.ts'), 'utf8');

    for (const view of ['Dashboard', 'Broadcast', 'Transcripts', 'Submit Prompt', 'About']) {
        assert.match(data, new RegExp(`label: '${view}'`));
    }

    assert.equal((data.match(/note: ''/g) ?? []).length, 5);
    assert.doesNotMatch(data, /note: undefined/);

    assert.doesNotMatch(data, /Operator Dashboard|Replay \/ Recap|Live Viewer|Broadcast Overlay|Case Directory|Case Details|Jury Voting|About \/ How It Works/);

    assert.match(app, /function App\(\)/);
    assert.match(app, /className="flex min-h-screen flex-col overflow-x-hidden bg-\[hsl\(var\(--void\)\)\]/);
    assert.match(app, /role="tablist"/);
    assert.match(app, /navigableViews\.map\(\(view\) => \(/);
    assert.match(app, /url\.searchParams\.delete\('case'\);/);
    assert.match(app, /if \(view !== 'transcripts'\) \{\s+url\.searchParams\.delete\('case'\);\s+\}/s);
});

test('dashboard and transcripts keep current live/detail behaviors', () => {
    const app = readFileSync(join(srcDir, 'App.tsx'), 'utf8');

    assert.match(app, /const liveFeedRef = useRef<HTMLDivElement \| null>\(null\);/);
    assert.match(app, /node\.scrollTop = node\.scrollHeight;/);
    assert.match(app, /role="log" aria-live="polite" aria-relevant="additions text"/);
    assert.match(app, /<MetricCard label="Turns" value=\{String\(activeTurnCount\)\} tone="pulse" \/>/);
    assert.match(app, /const transcriptHref = `\/app\/\?view=transcripts&case=\$\{encodeURIComponent\(s\.id\)\}`;/);

    assert.match(app, /const \[selectedTranscriptId, setSelectedTranscriptId\] = useState\(getCaseParam\);/);
    assert.match(app, /window\.addEventListener\('popstate', syncCaseFromUrl\);/);
    assert.match(app, /detailScrollRef\.current\?\.scrollTo\(\{ top: 0 \}\);/);
    assert.match(app, /selectedTranscriptId \? 'min-h-\[70vh\] max-h-\[72vh\]' : 'min-h-56'/);
    assert.match(app, /className="mt-3 flex-1 min-h-0 overflow-y-auto pr-1" role="log" aria-live="polite"/);
});

test('components accessibility and current semantic tokens are present', () => {
    const components = readFileSync(join(srcDir, 'components.tsx'), 'utf8');
    const app = readFileSync(join(srcDir, 'App.tsx'), 'utf8');
    const styles = readFileSync(join(srcDir, 'styles.css'), 'utf8');

    assert.match(components, /role="tab"/);
    assert.match(components, /aria-selected=\{active\}/);
    assert.match(components, /tabIndex=\{active \? 0 : -1\}/);
    assert.match(components, /focus-visible:ring/);
    assert.match(components, /aria-describedby/);
    assert.match(app, /role="log" aria-live="polite" aria-relevant="additions text"/);
    assert.match(app, /role="log" aria-live="polite"/);
    assert.match(styles, /prefers-reduced-motion:\s*reduce/);

    for (const token of ['--void', '--void-800', '--panel', '--panel-raised', '--border', '--border-faint', '--ink', '--ink-dim', '--ink-mute', '--signal', '--pulse', '--alert', '--caution', '--confirm', '--dead']) {
        assert.match(styles, new RegExp(`${token}:`));
    }
    assert.doesNotMatch(styles, /--bg:|--surface:/);
});
