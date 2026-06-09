import { useCallback, useEffect, useState } from 'react';

function useTypewriter(text: string, speedMs = 18) {
  const [visible, setVisible] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setVisible('');
    setDone(false);
    if (!text) return;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setVisible(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(timer);
        setDone(true);
      }
    }, speedMs);
    return () => clearInterval(timer);
  }, [text, speedMs]);

  const skip = useCallback(() => {
    setVisible(text);
    setDone(true);
  }, [text]);

  return { visible, done, skip };
}

export function DialogueBox({ speaker, text, onAdvance }: {
  speaker: string; text: string; onAdvance: () => void;
}) {
  const { visible, done, skip } = useTypewriter(text);

  const handleClick = () => {
    if (!done) { skip(); return; }
    onAdvance();
  };

  return (
    <div
      className="absolute bottom-4 left-1/2 w-[90%] max-w-4xl -translate-x-1/2 z-10 cursor-pointer"
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      tabIndex={0}
      role="button"
      aria-label="Advance dialogue"
    >
      <div className="inline-block border border-[hsl(var(--signal))] bg-[hsl(var(--void-900))] px-3 py-1 text-xs uppercase tracking-[0.15em] text-[hsl(var(--signal))]">
        {speaker}
      </div>
      <div className="min-h-24 border border-[hsl(var(--border-faint))] bg-[hsl(var(--void-800))] p-4 text-base leading-relaxed text-[hsl(var(--ink))]">
        {visible}
        <span className="inline-block w-2 h-5 bg-[hsl(var(--signal))] ml-0.5 align-middle animate-blink" aria-hidden="true" />
      </div>
      <p className="mt-1 text-2xs text-[hsl(var(--ink-mute))] text-right">
        {done ? 'Click to continue' : 'Click to skip'}
      </p>
    </div>
  );
}
