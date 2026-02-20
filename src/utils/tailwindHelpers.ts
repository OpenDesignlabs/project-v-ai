// src/utils/tailwindHelpers.ts
// Utility functions for mapping UI values to Tailwind CSS classes

export const TAILWIND_MAP = {
    // FONT SIZES
    fontSizes: {
        'xs': 'text-xs', 'sm': 'text-sm', 'base': 'text-base',
        'lg': 'text-lg', 'xl': 'text-xl', '2xl': 'text-2xl',
        '3xl': 'text-3xl', '4xl': 'text-4xl', '5xl': 'text-5xl',
        '6xl': 'text-6xl', '7xl': 'text-7xl', '8xl': 'text-8xl', '9xl': 'text-9xl'
    } as Record<string, string>,

    // FONT WEIGHTS
    fontWeights: {
        'thin': 'font-thin', 'extralight': 'font-extralight', 'light': 'font-light',
        'normal': 'font-normal', 'medium': 'font-medium', 'semibold': 'font-semibold',
        'bold': 'font-bold', 'extrabold': 'font-extrabold', 'black': 'font-black'
    } as Record<string, string>,

    // BORDER RADIUS
    radius: {
        'none': 'rounded-none', 'sm': 'rounded-sm', 'md': 'rounded',
        'lg': 'rounded-lg', 'xl': 'rounded-xl', '2xl': 'rounded-2xl',
        '3xl': 'rounded-3xl', 'full': 'rounded-full'
    } as Record<string, string>,

    // SHADOWS
    shadows: {
        'none': 'shadow-none', 'sm': 'shadow-sm', 'md': 'shadow',
        'lg': 'shadow-lg', 'xl': 'shadow-xl', '2xl': 'shadow-2xl',
        'inner': 'shadow-inner'
    } as Record<string, string>,

    // BLURS
    blurs: {
        'none': 'blur-none', 'sm': 'blur-sm', 'md': 'blur',
        'lg': 'blur-lg', 'xl': 'blur-xl', '2xl': 'blur-2xl', '3xl': 'blur-3xl'
    } as Record<string, string>,

    // BACKDROP BLURS
    backdropBlurs: {
        'none': 'backdrop-blur-none', 'sm': 'backdrop-blur-sm', 'md': 'backdrop-blur',
        'lg': 'backdrop-blur-lg', 'xl': 'backdrop-blur-xl', '2xl': 'backdrop-blur-2xl', '3xl': 'backdrop-blur-3xl'
    } as Record<string, string>,

    // OPACITY
    opacities: {
        '0': 'opacity-0', '5': 'opacity-5', '10': 'opacity-10', '20': 'opacity-20',
        '25': 'opacity-25', '30': 'opacity-30', '40': 'opacity-40', '50': 'opacity-50',
        '60': 'opacity-60', '70': 'opacity-70', '75': 'opacity-75', '80': 'opacity-80',
        '90': 'opacity-90', '95': 'opacity-95', '100': 'opacity-100'
    } as Record<string, string>,

    // GRADIENT DIRECTIONS
    gradientDirections: {
        'none': '', 't': 'bg-gradient-to-t', 'tr': 'bg-gradient-to-tr',
        'r': 'bg-gradient-to-r', 'br': 'bg-gradient-to-br',
        'b': 'bg-gradient-to-b', 'bl': 'bg-gradient-to-bl',
        'l': 'bg-gradient-to-l', 'tl': 'bg-gradient-to-tl'
    } as Record<string, string>
};

// Color palette for UI pickers
export const COLOR_PALETTE = {
    grays: ['slate', 'gray', 'zinc', 'neutral', 'stone'],
    colors: ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'],
    shades: ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']
};

/**
 * Remove all classes that start with a given prefix
 */
export const removeClasses = (current: string, prefix: string): string => {
    return current.split(' ').filter(c => !c.startsWith(prefix) && !c.includes(`:${prefix}`)).join(' ');
};

/**
 * Remove a specific class pattern (handles state prefixes like hover:, focus:)
 */
export const removeClass = (current: string, classToRemove: string): string => {
    return current.split(' ').filter(c => c !== classToRemove).join(' ');
};

/**
 * Add or update a class based on state (base, hover, focus)
 * @param current - Current className string
 * @param newClass - New class to add (without state prefix)
 * @param prefixToRemove - Prefix of classes to remove before adding
 * @param state - State mode: 'base', 'hover', or 'focus'
 */
export const updateClass = (
    current: string,
    newClass: string,
    prefixToRemove: string,
    state: 'base' | 'hover' | 'focus' = 'base'
): string => {
    const statePrefix = state === 'base' ? '' : `${state}:`;

    // Remove existing classes with this prefix for this state
    const clean = current.split(' ').filter(c => {
        if (state === 'base') {
            // For base, remove non-prefixed classes with this prefix
            return !c.startsWith(prefixToRemove) || c.includes(':');
        } else {
            // For hover/focus, remove only state-prefixed classes
            return !c.startsWith(`${statePrefix}${prefixToRemove}`);
        }
    }).join(' ');

    if (!newClass) return clean.trim();

    const fullClass = statePrefix ? `${statePrefix}${newClass}` : newClass;
    return `${clean} ${fullClass}`.replace(/\s+/g, ' ').trim();
};

/**
 * Get the value of a class with a given prefix
 */
export const getClassValue = (classes: string, prefix: string, state: 'base' | 'hover' | 'focus' = 'base'): string => {
    const statePrefix = state === 'base' ? '' : `${state}:`;
    const classArray = classes.split(' ');

    for (const c of classArray) {
        if (state === 'base' && !c.includes(':') && c.startsWith(prefix)) {
            return c.replace(prefix, '');
        } else if (state !== 'base' && c.startsWith(`${statePrefix}${prefix}`)) {
            return c.replace(`${statePrefix}${prefix}`, '');
        }
    }
    return '';
};

/**
 * Check if a class exists
 */
export const hasClass = (classes: string, className: string): boolean => {
    return classes.split(' ').includes(className);
};

/**
 * Extract Tailwind color from class string
 */
export const getTailwindColor = (classes: string, prefix: string): string => {
    const match = classes.split(' ').find(c => c.startsWith(prefix) && !c.includes(':'));
    return match || '';
};

/**
 * Generate a complete gradient class string
 */
export const generateGradientClasses = (direction: string, from: string, to: string, via?: string): string => {
    if (!direction || direction === 'none') return '';
    const parts = [TAILWIND_MAP.gradientDirections[direction]];
    if (from) parts.push(`from-${from}`);
    if (via) parts.push(`via-${via}`);
    if (to) parts.push(`to-${to}`);
    return parts.filter(Boolean).join(' ');
};

/**
 * Parse existing gradient from classes
 */
export const parseGradient = (classes: string): { direction: string; from: string; via: string; to: string } => {
    const result = { direction: 'none', from: '', via: '', to: '' };
    const classArray = classes.split(' ');

    for (const c of classArray) {
        if (c.startsWith('bg-gradient-to-')) {
            result.direction = c.replace('bg-gradient-to-', '');
        } else if (c.startsWith('from-')) {
            result.from = c.replace('from-', '');
        } else if (c.startsWith('via-')) {
            result.via = c.replace('via-', '');
        } else if (c.startsWith('to-')) {
            result.to = c.replace('to-', '');
        }
    }

    return result;
};
