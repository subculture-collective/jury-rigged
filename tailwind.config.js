/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './app/index.html',
        './app/src/**/*.{ts,tsx}',
        './dashboard/index.html',
        './dashboard/**/*.{js,ts,jsx,tsx}',
    ],
    theme: {
        extend: {
            colors: {
                // ── Background hierarchy ──
                void: {
                    DEFAULT: 'hsl(var(--void))',
                    900: 'hsl(var(--void-900))',
                    800: 'hsl(var(--void-800))',
                },
                panel: {
                    DEFAULT: 'hsl(var(--panel))',
                    raised: 'hsl(var(--panel-raised))',
                },
                // ── Borders ──
                border: {
                    DEFAULT: 'hsl(var(--border))',
                    strong: 'hsl(var(--border-strong))',
                    faint: 'hsl(var(--border-faint))',
                },
                // ── Text ──
                ink: {
                    DEFAULT: 'hsl(var(--ink))',
                    dim: 'hsl(var(--ink-dim))',
                    mute: 'hsl(var(--ink-mute))',
                },
                // ── Accents ──
                signal: {
                    DEFAULT: 'hsl(var(--signal))',      // purple #A855F7
                    bright: 'hsl(var(--signal-bright))',
                },
                pulse: {
                    DEFAULT: 'hsl(var(--pulse))',       // indigo #6366F1
                    bright: 'hsl(var(--pulse-bright))',
                },
                // ── State ──
                alert: {
                    DEFAULT: 'hsl(var(--alert))',       // red
                },
                caution: {
                    DEFAULT: 'hsl(var(--caution))',     // amber/gold
                },
                confirm: {
                    DEFAULT: 'hsl(var(--confirm))',      // teal
                },
                dead: {
                    DEFAULT: 'hsl(var(--dead))',         // muted/grey
                },
            },
            fontFamily: {
                mono: ['"JetBrains Mono"', '"SF Mono"', '"Cascadia Code"', '"Fira Code"', 'monospace'],
                body: ['"JetBrains Mono"', '"SF Mono"', 'monospace'],
            },
            fontSize: {
                '2xs': ['0.625rem', { lineHeight: '1rem', letterSpacing: '0.06em' }],
                hud:  ['0.6875rem', { lineHeight: '1.125rem', letterSpacing: '0.08em' }],
                sm:   ['0.75rem', { lineHeight: '1.25rem', letterSpacing: '0.04em' }],
                base: ['0.875rem', { lineHeight: '1.5rem', letterSpacing: '0.02em' }],
                lg:   ['1rem', { lineHeight: '1.625rem' }],
                xl:   ['1.125rem', { lineHeight: '1.75rem' }],
                '2xl':['1.375rem', { lineHeight: '1.875rem' }],
                '3xl':['1.75rem', { lineHeight: '2.125rem' }],
                '4xl':['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.02em' }],
                '5xl':['3rem', { lineHeight: '3rem', letterSpacing: '-0.03em' }],
            },
            spacing: {
                'hud': '0.25rem',
                'px': '1px',
                '0': '0px',
                '1': '0.25rem',
                '2': '0.5rem',
                '3': '0.75rem',
                '4': '1rem',
                '5': '1.25rem',
                '6': '1.5rem',
                '8': '2rem',
                '10': '2.5rem',
                '12': '3rem',
                '16': '4rem',
                '20': '5rem',
                '24': '6rem',
            },
            borderWidth: {
                '3': '3px',
            },
            animation: {
                'blink': 'blink 1s step-end infinite',
                'slide-in-right': 'slideInRight 0.2s ease-out',
                'slide-in-up': 'slideInUp 0.2s ease-out',
                'stinger-shake': 'stingerShake 0.3s ease-out',
                'scan': 'scan 3s linear infinite',
                'pulse-slow': 'pulse 3s ease-in-out infinite',
            },
            keyframes: {
                blink: {
                    '0%, 100%': { opacity: '1' },
                    '50%': { opacity: '0' },
                },
                slideInRight: {
                    '0%': { transform: 'translateX(1rem)', opacity: '0' },
                    '100%': { transform: 'translateX(0)', opacity: '1' },
                },
                slideInUp: {
                    '0%': { transform: 'translateY(0.5rem)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                stingerShake: {
                    '0%, 100%': { transform: 'translateX(0)' },
                    '20%': { transform: 'translateX(-6px)' },
                    '40%': { transform: 'translateX(6px)' },
                    '60%': { transform: 'translateX(-4px)' },
                    '80%': { transform: 'translateX(4px)' },
                },
                scan: {
                    '0%': { transform: 'translateY(-100%)' },
                    '100%': { transform: 'translateY(400%)' },
                },
            },
        },
    },
    plugins: [],
};
