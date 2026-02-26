// ─── HOT-RELOAD SHELL HTML ────────────────────────────────────────────────────
// Lives in a plain .ts file (not .tsx) so that the HTML string literal is NOT
// parsed by the TypeScript JSX compiler. Even a single `<html>` tag inside a
// template literal in a .tsx file causes hundreds of spurious JSX errors.
//
// ── PHASE 6: Babel removed ────────────────────────────────────────────────────
// Previously this shell loaded /babel.min.js (~3MB) and ran a 3-tier Babel
// transform on every UPDATE_CODE message — 100–300ms of JS parsing per edit.
//
// Now the code arriving via postMessage is ALREADY compiled ES5/CommonJS JS
// (produced by the Rust SWC engine on the host side). The shell only needs to:
//   1. Inject a preamble declaring React hook aliases and Lucide proxies.
//   2. Execute the pre-compiled code string via new Function().
//   3. Resolve the CJS default export and hand it to ReactDOM.createRoot().
//
// This reduces preview latency from 100–300ms (Babel) to ~1ms (new Function).
//
// Architecture: Loaded ONCE into the iframe (srcdoc). Code updates arrive via
// postMessage({ type: 'UPDATE_CODE', code }). React re-renders via a persistent
// root.render() call — React's reconciler preserves DOM state (scroll, inputs,
// Framer Motion animations) between AI edits.

export const SHELL_HTML = `<!DOCTYPE html>
<html class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="/tailwind.js"></script>
  <script>tailwind.config={darkMode:'class',theme:{extend:{}}}</script>
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/framer-motion@10.16.4/dist/framer-motion.js" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js" crossorigin="anonymous"></script>
  <!-- NOTE: babel.min.js intentionally removed (Phase 6). Code is pre-compiled by Rust SWC. -->
  <style>
    *,*::before,*::after{box-sizing:border-box}
    html,body{margin:0;padding:0;min-height:100vh;background:#000;color:#fff;font-family:system-ui,sans-serif}
    ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#09090b}::-webkit-scrollbar-thumb{background:#27272a;border-radius:3px}
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    var _root = null;

    // ─── runCode ──────────────────────────────────────────────────────────────
    // Receives PRE-COMPILED ES5/CJS JavaScript from the host (Rust SWC engine).
    // No transpilation happens here — new Function() executes directly.
    function runCode(src) {
      if (!src || !src.trim()) return;
      try {
        var fakeExports = {};
        var fakeModule  = { exports: fakeExports };

        // Framer Motion: normalise window.Motion (UMD bundle key)
        var Motion = window.Motion || {};

        // cn helper (Tailwind class merge, no dependencies)
        var _cn = function() {
          return Array.prototype.filter.call(arguments, Boolean).join(' ');
        };

        // ── Lucide proxy ─────────────────────────────────────────────────────
        // Handles three export shapes from the Lucide UMD bundle:
        //  a) React component function (most icons in lucide@latest)
        //  b) Icon definition array  (legacy lucide bundle format)
        //  c) Missing icon           (graceful SVG fallback)
        var _Lucide = new Proxy(window.lucide || {}, {
          get: function(t, p) {
            var e = t[p];
            // Already a React component or element type
            if (typeof e === 'function' || (e && e.$$typeof)) return e;
            // Legacy array format: [tag, attrs, children[]]
            if (Array.isArray(e)) {
              return function LI(pr) {
                var s  = (pr && pr.size)        || 24;
                var c  = (pr && pr.color)       || 'currentColor';
                var sw = (pr && pr.strokeWidth) || 2;
                var toEl = function(n) {
                  return Array.isArray(n)
                    ? React.createElement(n[0], n[1], (n[2] || []).map(toEl))
                    : null;
                };
                return React.createElement(
                  'svg',
                  {
                    xmlns:'http://www.w3.org/2000/svg',
                    width:s, height:s, viewBox:'0 0 24 24',
                    fill:'none', stroke:c, strokeWidth:sw,
                    strokeLinecap:'round', strokeLinejoin:'round',
                  },
                  ((e[2] || [])).map(toEl)
                );
              };
            }
            // Fallback: placeholder SVG so the preview never crashes
            return function() { return React.createElement('svg', { width:24, height:24 }); };
          }
        });

        // DynamicIcon: resolves icon name at runtime (used by <DynamicIcon name="X" />)
        var _DynamicIcon = function(pr) {
          var Comp = _Lucide[pr.name] || _Lucide.HelpCircle || function() { return null; };
          return React.createElement(
            typeof Comp === 'function' ? Comp : function() { return null; },
            pr
          );
        };

        // ── Preamble ─────────────────────────────────────────────────────────
        // Declares shorthand aliases expected by SWC-compiled code.
        // SWC's Classic runtime emits React.createElement, hence no need to
        // import React — it is already in scope as a global.
        var preamble = [
          'const {useState,useEffect,useRef,useCallback,useMemo,useLayoutEffect,useReducer,useContext,Fragment}=React;',
          'const {motion,AnimatePresence,useAnimation,useInView,useMotionValue,useTransform}=_Motion;',
          'const cn=_cn, Lucide=_Lucide, DynamicIcon=_DynamicIcon;',
        ].join('');

        // ── Execute pre-compiled code ─────────────────────────────────────────
        // The code string was produced by Rust SWC (TSX→JS, ESM→CJS shimmed).
        // It uses 'exports.default = ' for its default export.
        new Function(
          'React','ReactDOM','_Motion','_cn','_Lucide','_DynamicIcon',
          'exports','module','require',
          preamble + src
        )(
          React, ReactDOM, Motion, _cn, _Lucide, _DynamicIcon,
          fakeExports, fakeModule,
          function() { throw new Error('require() is not available in preview sandbox'); }
        );

        // ── Resolve default export ────────────────────────────────────────────
        var Comp =
          fakeExports['default']         ||
          fakeModule.exports['default']  ||
          Object.values(fakeExports).find(function(v) { return typeof v === 'function'; });

        if (!Comp) {
          document.getElementById('root').innerHTML =
            '<div style="color:#f87171;padding:2rem;font-family:monospace">' +
            '<strong>No default export found.</strong><br/>' +
            'Ensure the component uses: <code>export default function MyComponent() {...}</code>' +
            '</div>';
          return;
        }

        // ── Render ────────────────────────────────────────────────────────────
        // Persistent root — React diffs on re-render, preserving DOM state
        // (scroll position, form values, Framer Motion animations).
        if (!_root) _root = ReactDOM.createRoot(document.getElementById('root'));
        _root.render(React.createElement(Comp, null));

      } catch(err) {
        document.getElementById('root').innerHTML =
          '<div style="color:#f87171;padding:2rem;font-family:monospace;' +
          'border:1px solid #f87171;border-radius:8px;margin:2rem">' +
          '<strong>Preview Error</strong><br/><br/>' +
          (err.message || err) + '</div>';
      }
    }

    // Hot-reload listener: host sends { type:'UPDATE_CODE', code } on every edit
    window.addEventListener('message', function(ev) {
      if (!ev.data || ev.data.type !== 'UPDATE_CODE') return;
      runCode(ev.data.code);
    });

    // Signal host that the shell is alive and ready to receive code
    window.parent.postMessage({ type: 'SHELL_READY' }, '*');
  </script>
</body>
</html>`;
