// ─── FRAME PRESETS ────────────────────────────────────────────────────────────
// All device presets for the CF-1 Frame Picker.
// chromeName maps to a DeviceChrome SVG overlay in RenderNode.
// mirrorWidth: if set, a mobile mirror is auto-rendered at this width.
//   Desktop frames always get a 390px mirror.
//   Tablet frames get a scaled-down tablet mirror if mirrorWidth is set.
//   Mobile frames: no mirror (they ARE the mobile view).

export interface FramePreset {
    id: string;
    label: string;
    category: 'desktop' | 'tablet' | 'mobile';
    width: number;
    height: number;
    chromeName: 'browser' | 'iphone-dynamic-island' | 'iphone-notch' | 'iphone-home' | 'android-punchhole' | 'ipad' | 'none';
    mirrorWidth?: number; // if set, shows a responsive mirror at this width
}

export const FRAME_PRESETS: FramePreset[] = [
    // ── Desktop ──────────────────────────────────────────────────────────────
    {
        id: 'macbook-14',
        label: 'MacBook Pro 14"',
        category: 'desktop',
        width: 1512, height: 982,
        chromeName: 'browser',
        mirrorWidth: 390,
    },
    {
        id: 'macbook-16',
        label: 'MacBook Pro 16"',
        category: 'desktop',
        width: 1728, height: 1117,
        chromeName: 'browser',
        mirrorWidth: 390,
    },
    {
        id: 'desktop-1440',
        label: 'Desktop 1440p',
        category: 'desktop',
        width: 1440, height: 1024,
        chromeName: 'browser',
        mirrorWidth: 390,
    },
    {
        id: 'desktop-1080',
        label: 'Windows 1080p',
        category: 'desktop',
        width: 1920, height: 1080,
        chromeName: 'browser',
        mirrorWidth: 390,
    },
    {
        id: 'imac-27',
        label: 'iMac 27"',
        category: 'desktop',
        width: 2560, height: 1440,
        chromeName: 'browser',
        mirrorWidth: 390,
    },

    // ── Tablet ───────────────────────────────────────────────────────────────
    {
        id: 'ipad-pro-129',
        label: 'iPad Pro 12.9"',
        category: 'tablet',
        width: 1024, height: 1366,
        chromeName: 'ipad',
    },
    {
        id: 'ipad-air',
        label: 'iPad Air 10.9"',
        category: 'tablet',
        width: 820, height: 1180,
        chromeName: 'ipad',
    },
    {
        id: 'ipad-mini',
        label: 'iPad Mini',
        category: 'tablet',
        width: 768, height: 1024,
        chromeName: 'ipad',
    },
    {
        id: 'android-tablet',
        label: 'Android Tablet',
        category: 'tablet',
        width: 800, height: 1280,
        chromeName: 'none',
    },

    // ── Mobile ───────────────────────────────────────────────────────────────
    {
        id: 'iphone-15-pro',
        label: 'iPhone 15 Pro',
        category: 'mobile',
        width: 393, height: 852,
        chromeName: 'iphone-dynamic-island',
    },
    {
        id: 'iphone-14',
        label: 'iPhone 14',
        category: 'mobile',
        width: 390, height: 844,
        chromeName: 'iphone-notch',
    },
    {
        id: 'iphone-se',
        label: 'iPhone SE',
        category: 'mobile',
        width: 375, height: 667,
        chromeName: 'iphone-home',
    },
    {
        id: 'pixel-8-pro',
        label: 'Pixel 8 Pro',
        category: 'mobile',
        width: 412, height: 915,
        chromeName: 'android-punchhole',
    },
    {
        id: 'galaxy-s24',
        label: 'Galaxy S24',
        category: 'mobile',
        width: 384, height: 854,
        chromeName: 'android-punchhole',
    },
];

export const PRESET_BY_CATEGORY = {
    desktop: FRAME_PRESETS.filter(p => p.category === 'desktop'),
    tablet: FRAME_PRESETS.filter(p => p.category === 'tablet'),
    mobile: FRAME_PRESETS.filter(p => p.category === 'mobile'),
};
