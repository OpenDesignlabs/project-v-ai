import React from 'react';

interface DeviceChromeProps {
    chromeName: string;
    width: number;
    height: number;
}

// ── Browser Chrome ────────────────────────────────────────────────────────────
const BrowserChrome: React.FC<{ width: number }> = () => (
    <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: '38px',
        background: 'linear-gradient(to bottom, #e8e8e8, #d8d8d8)',
        borderBottom: '1px solid #c0c0c0',
        display: 'flex', alignItems: 'center',
        gap: '8px', padding: '0 12px',
        pointerEvents: 'none', zIndex: 50,
        borderRadius: '16px 16px 0 0',
        userSelect: 'none',
    }}>
        {/* Traffic lights */}
        <div style={{ display: 'flex', gap: '5px', marginRight: '4px' }}>
            {['#ff5f57', '#ffbd2e', '#28c840'].map((c, i) => (
                <div key={i} style={{ width: 11, height: 11, borderRadius: '50%', background: c, border: `1px solid ${c}aa` }} />
            ))}
        </div>
        {/* Address bar */}
        <div style={{
            flex: 1, maxWidth: '400px', margin: '0 auto',
            height: '22px', background: '#fff',
            borderRadius: '4px', border: '1px solid #ccc',
            display: 'flex', alignItems: 'center',
            padding: '0 8px', gap: '4px',
        }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4CAF50' }} />
            <span style={{ fontSize: '10px', color: '#666', fontFamily: 'system-ui', letterSpacing: '0.01em' }}>
                vectra-preview.app
            </span>
        </div>
    </div>
);

// ── iPhone Dynamic Island ─────────────────────────────────────────────────────
const IPhoneDynamicIsland: React.FC<{ width: number }> = () => (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 50 }}>
        {/* Status bar area */}
        <div style={{
            height: '54px', display: 'flex', alignItems: 'flex-end',
            justifyContent: 'space-between', padding: '0 20px 6px',
        }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(0,0,0,0.8)', fontFamily: 'system-ui' }}>9:41</span>
            {/* Dynamic Island pill */}
            <div style={{
                position: 'absolute', left: '50%', top: '10px',
                transform: 'translateX(-50%)',
                width: '120px', height: '34px',
                background: '#000', borderRadius: '20px',
            }} />
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                <div style={{ fontSize: '10px', color: 'rgba(0,0,0,0.7)' }}>●●●</div>
            </div>
        </div>
        {/* Home indicator */}
        <div style={{
            position: 'absolute', bottom: '8px', left: '50%',
            transform: 'translateX(-50%)',
            width: '134px', height: '5px',
            background: 'rgba(0,0,0,0.2)', borderRadius: '3px',
        }} />
    </div>
);

// ── iPhone Notch ──────────────────────────────────────────────────────────────
const IPhoneNotch: React.FC<{ width: number }> = () => (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 50 }}>
        <div style={{
            height: '44px', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', padding: '0 20px',
        }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(0,0,0,0.8)', fontFamily: 'system-ui' }}>9:41</span>
            {/* Notch */}
            <div style={{
                position: 'absolute', left: '50%', top: '0',
                transform: 'translateX(-50%)',
                width: '150px', height: '30px',
                background: '#000', borderRadius: '0 0 20px 20px',
            }} />
        </div>
        {/* Home indicator */}
        <div style={{
            position: 'absolute', bottom: '8px', left: '50%',
            transform: 'translateX(-50%)',
            width: '134px', height: '5px',
            background: 'rgba(0,0,0,0.2)', borderRadius: '3px',
        }} />
    </div>
);

// ── iPhone Home Button ────────────────────────────────────────────────────────
const IPhoneHome: React.FC = () => (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 50 }}>
        <div style={{ height: '20px', display: 'flex', alignItems: 'center', padding: '0 16px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(0,0,0,0.7)', fontFamily: 'system-ui' }}>9:41</span>
        </div>
        {/* Home button circle */}
        <div style={{
            position: 'absolute', bottom: '12px', left: '50%',
            transform: 'translateX(-50%)',
            width: '44px', height: '44px',
            border: '2px solid rgba(0,0,0,0.2)',
            borderRadius: '50%',
        }} />
    </div>
);

// ── Android Punch-hole ────────────────────────────────────────────────────────
const AndroidPunchhole: React.FC = () => (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'none', zIndex: 50 }}>
        <div style={{ height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(0,0,0,0.7)', fontFamily: 'system-ui' }}>9:41</span>
            {/* Camera punch-hole */}
            <div style={{ width: '12px', height: '12px', background: '#000', borderRadius: '50%', marginRight: '4px' }} />
        </div>
    </div>
);

// ── iPad ──────────────────────────────────────────────────────────────────────
const IPad: React.FC = () => (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'none', zIndex: 50 }}>
        <div style={{
            height: '24px', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', padding: '0 20px',
        }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(0,0,0,0.7)', fontFamily: 'system-ui' }}>9:41</span>
            <div style={{ display: 'flex', gap: '6px', fontSize: '10px', color: 'rgba(0,0,0,0.5)' }}>
                <span>●●●</span>
            </div>
        </div>
    </div>
);

// ── Main Export ───────────────────────────────────────────────────────────────
// DEVICE-CHROME-1 [PERMANENT]: DeviceChrome is always pointer-events:none.
// It is a decorative overlay. Never intercept pointer events — all canvas
// interactions pass through to the content underneath.
export const DeviceChrome: React.FC<DeviceChromeProps> = ({ chromeName, width, height }) => {
    // Suppress unused lint — width/height available for future per-device sizing
    void width; void height;
    switch (chromeName) {
        case 'browser': return <BrowserChrome width={width} />;
        case 'iphone-dynamic-island': return <IPhoneDynamicIsland width={width} />;
        case 'iphone-notch': return <IPhoneNotch width={width} />;
        case 'iphone-home': return <IPhoneHome />;
        case 'android-punchhole': return <AndroidPunchhole />;
        case 'ipad': return <IPad />;
        default: return null;
    }
};
