// ─── FRAME PRESETS — CF-1 ─────────────────────────────────────────────────────
// Source of truth for device frame dimensions used by the FramePicker.
//
// FRAME-PRESET-1 [PERMANENT]:
//   'desktop' | 'tablet' → creates type:'webpage' node with props.mirrorOf set.
//   'mobile'             → creates type:'webpage' node with a narrow width.
//   ALL spawned frames have props.mirrorOf = sourceFrameId (e.g. 'frame-desktop').
//   They are NEVER independent content nodes — they mirror the source frame.
//   runAI MUST still only target the source frame (no mirrorOf prop).
//
// NO chromeName — no DeviceChrome overlays. These are clean design surfaces.
// The frame dimensions communicate the device. Chrome decorations would
// obscure content and confuse design measurements.

export interface FramePreset {
    id: string;
    label: string;
    category: 'desktop' | 'tablet' | 'mobile';
    width: number;
    height: number;
}

export const FRAME_PRESETS: FramePreset[] = [
    // ── Desktop ──────────────────────────────────────────────────────────────
    { id: 'desktop-1440', label: 'Desktop 1440', category: 'desktop', width: 1440, height: 1024 },
    { id: 'macbook-14', label: 'MacBook Pro 14"', category: 'desktop', width: 1512, height: 982 },
    { id: 'macbook-16', label: 'MacBook Pro 16"', category: 'desktop', width: 1728, height: 1117 },
    { id: 'desktop-1080', label: 'Windows 1080p', category: 'desktop', width: 1920, height: 1080 },
    { id: 'imac-27', label: 'iMac 27"', category: 'desktop', width: 2560, height: 1440 },

    // ── Tablet ───────────────────────────────────────────────────────────────
    { id: 'ipad-pro-129', label: 'iPad Pro 12.9"', category: 'tablet', width: 1024, height: 1366 },
    { id: 'ipad-air', label: 'iPad Air 10.9"', category: 'tablet', width: 820, height: 1180 },
    { id: 'ipad-mini', label: 'iPad Mini', category: 'tablet', width: 768, height: 1024 },
    { id: 'android-tablet', label: 'Android Tablet', category: 'tablet', width: 800, height: 1280 },

    // ── Mobile ───────────────────────────────────────────────────────────────
    { id: 'iphone-15-pro', label: 'iPhone 15 Pro', category: 'mobile', width: 393, height: 852 },
    { id: 'iphone-14', label: 'iPhone 14', category: 'mobile', width: 390, height: 844 },
    { id: 'iphone-se', label: 'iPhone SE', category: 'mobile', width: 375, height: 667 },
    { id: 'pixel-8-pro', label: 'Pixel 8 Pro', category: 'mobile', width: 412, height: 915 },
    { id: 'galaxy-s24', label: 'Galaxy S24', category: 'mobile', width: 384, height: 854 },
];

export const PRESETS_BY_CATEGORY = {
    desktop: FRAME_PRESETS.filter(p => p.category === 'desktop'),
    tablet: FRAME_PRESETS.filter(p => p.category === 'tablet'),
    mobile: FRAME_PRESETS.filter(p => p.category === 'mobile'),
};
