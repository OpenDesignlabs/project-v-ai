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

  <style>
    *,*::before,*::after{box-sizing:border-box}
    html,body{margin:0;padding:0;min-height:100vh;background:#000;color:#fff;font-family:system-ui,sans-serif}
    ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#09090b}::-webkit-scrollbar-thumb{background:#27272a;border-radius:3px}
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    // Shared React via esm.sh — no ?bundle flag so all packages use the SAME
    // React module instance. ?bundle would embed React into each package
    // separately, causing framer-motion.useContext() to hit a different React
    // than ReactDOM, returning null and crashing renders.
    import React       from 'https://esm.sh/react@18';
    import ReactDOM    from 'https://esm.sh/react-dom@18/client?deps=react@18';
    import * as Motion from 'https://esm.sh/framer-motion@11?deps=react@18,react-dom@18';
    import * as LucideReact from 'https://esm.sh/lucide-react@0.577.0?deps=react@18';

    // Expose on window so the new Function() sandbox can reference them
    window.React       = React;
    window.ReactDOM    = ReactDOM;
    window.Motion      = Motion;
    window.LucideReact = LucideReact;

    var _root = null;

    function runCode(src) {
      if (!src || !src.trim()) return;
      try {
        var fakeExports = {};
        var fakeModule  = { exports: fakeExports };

        var _cn = function() {
          return Array.prototype.filter.call(arguments, Boolean).join(' ');
        };

        // Lucide proxy — unknown names fall back to a placeholder info-icon
        var _lucideSource = LucideReact || {};
        var _iconPlaceholder = function(pr) {
          var s=(pr&&pr.size)||24, c=(pr&&pr.color)||'currentColor';
          return React.createElement('svg',{xmlns:'http://www.w3.org/2000/svg',width:s,height:s,
            viewBox:'0 0 24 24',fill:'none',stroke:c,strokeWidth:2},
            React.createElement('circle',{cx:12,cy:12,r:10}),
            React.createElement('line',{x1:12,y1:8,x2:12,y2:12}),
            React.createElement('line',{x1:12,y1:16,x2:12.01,y2:16})
          );
        };
        var _Lucide = new Proxy(_lucideSource, {
          get: function(t, p) {
            if (typeof p !== 'string') return t[p];
            var e = t[p];
            if (typeof e === 'function' || (e && e.$$typeof)) return e;
            return _iconPlaceholder;
          }
        });

        var _DynamicIcon = function(pr) {
          var Comp = _Lucide[pr.name] || _Lucide.HelpCircle || _iconPlaceholder;
          return React.createElement(typeof Comp === 'function' ? Comp : function(){ return null; }, pr);
        };

        // Preamble: destructure React hooks & Motion into scope for SWC-compiled code
        var preamble = [
          'const {useState,useEffect,useRef,useCallback,useMemo,useLayoutEffect,useReducer,useContext,Fragment}=React;',
          'const {motion,AnimatePresence,useAnimation,useInView,useMotionValue,useTransform}=_Motion;',
          'const cn=_cn, Lucide=_Lucide, DynamicIcon=_DynamicIcon;',
        ].join('');

        new Function(
          'React','ReactDOM','_Motion','_cn','_Lucide','_DynamicIcon',
          'exports','module','require',
          preamble + src
        )(
          React, ReactDOM, Motion, _cn, _Lucide, _DynamicIcon,
          fakeExports, fakeModule,
          function() { throw new Error('require() is not available in preview sandbox'); }
        );

        var Comp =
          fakeExports['default']        ||
          fakeModule.exports['default'] ||
          Object.values(fakeExports).find(function(v) { return typeof v === 'function'; });

        if (!Comp) {
          document.getElementById('root').innerHTML =
            '<div style="color:#f87171;padding:2rem;font-family:monospace">' +
            '<strong>No default export found.</strong><br/>' +
            'Ensure the component uses: <code>export default function MyComponent() {...}</code>' +
            '</div>';
          return;
        }

        // Persistent root — React diffs on re-render, preserving scroll/form/animation state
        if (!_root) _root = ReactDOM.createRoot(document.getElementById('root'));
        _root.render(React.createElement(Comp, null));

        // Ask Tailwind runtime to rescan DOM for new classes after paint
        setTimeout(function() {
          var tw = window.tailwind;
          if (tw && tw.scan) { try { tw.scan(); } catch(e) { /* non-fatal */ } }
        }, 50);

      } catch(err) {
        document.getElementById('root').innerHTML =
          '<div style="color:#f87171;padding:2rem;font-family:monospace;' +
          'border:1px solid #f87171;border-radius:8px;margin:2rem">' +
          '<strong>Preview Error</strong><br/><br/>' +
          (err.message || err) + '</div>';
      }
    }

    window.addEventListener('message', function(ev) {
      if (!ev.data || ev.data.type !== 'UPDATE_CODE') return;
      runCode(ev.data.code);
    });

    window.parent.postMessage({ type: 'SHELL_READY' }, '*');
  </script>
</body>
</html>`;

// ─── MOBILE MIRROR SHELL ──────────────────────────────────────────────────────
// //   Identical to SHELL_HTML but with two critical differences:
//   1. Background is transparent — the canvas frame provides the bg colour.
//   2. Sends 'MOBILE_SHELL_READY' instead of 'SHELL_READY' so ContainerPreview
//      can track both iframes independently.
//
//   WHY AN IFRAME IS THE ONLY CORRECT SOLUTION:
//   Tailwind md: = @media (min-width: 768px). This fires against the BROWSER's
//   window.innerWidth — always ~1400px in Vectra. A <div> at 390px does NOT
//   create a new viewport. An <iframe> has its own Window object, and its
//   window.innerWidth equals its CSS width (390px). All md: breakpoints
//   evaluate to FALSE. Sections fully reflow to single-column mobile layout.
//   This is the same approach used by Plasmic, Framer, and Webflow.
export const MOBILE_SHELL_HTML = `<!DOCTYPE html>
<html class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="/tailwind.js"></script>
  <script>tailwind.config={darkMode:'class',theme:{extend:{}}}</script>
  <style>
    *,*::before,*::after{box-sizing:border-box}
    html,body{
      margin:0;padding:0;
      background:transparent;
      color:#fff;font-family:system-ui,sans-serif;
      overflow-x:hidden;width:100%;
    }
    ::-webkit-scrollbar{width:4px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:#27272a;border-radius:3px}
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React       from 'https://esm.sh/react@18';
    import ReactDOM    from 'https://esm.sh/react-dom@18/client?deps=react@18';
    import * as Motion from 'https://esm.sh/framer-motion@11?deps=react@18,react-dom@18';
    import * as LucideReact from 'https://esm.sh/lucide-react@0.577.0?deps=react@18';

    window.React       = React;
    window.ReactDOM    = ReactDOM;
    window.Motion      = Motion;
    window.LucideReact = LucideReact;

    var _root = null;
    function runCode(src) {
      if (!src || !src.trim()) return;
      try {
        var fakeExports = {};
        var fakeModule  = { exports: fakeExports };
        var _cn = function() { return Array.prototype.filter.call(arguments, Boolean).join(' '); };
        var _lucideSource = LucideReact || {};
        var _iP = function(pr) {
          var s=(pr&&pr.size)||24, c=(pr&&pr.color)||'currentColor';
          return React.createElement('svg',{xmlns:'http://www.w3.org/2000/svg',width:s,height:s,
            viewBox:'0 0 24 24',fill:'none',stroke:c,strokeWidth:2},
            React.createElement('circle',{cx:12,cy:12,r:10}));
        };
        var _Lucide = new Proxy(_lucideSource, {
          get: function(t, p) {
            if (typeof p !== 'string') return t[p];
            var e = t[p];
            if (typeof e === 'function' || (e && e.$$typeof)) return e;
            return _iP;
          }
        });
        var _DynamicIcon = function(pr) {
          var Comp = _Lucide[pr.name] || _Lucide.HelpCircle || function(){ return null; };
          return React.createElement(typeof Comp === 'function' ? Comp : function(){ return null; }, pr);
        };
        var preamble = [
          'const {useState,useEffect,useRef,useCallback,useMemo,useLayoutEffect,useReducer,useContext,Fragment}=React;',
          'const {motion,AnimatePresence,useAnimation,useInView,useMotionValue,useTransform}=_Motion;',
          'const cn=_cn, Lucide=_Lucide, DynamicIcon=_DynamicIcon;',
        ].join('');
        new Function('React','ReactDOM','_Motion','_cn','_Lucide','_DynamicIcon','exports','module','require', preamble+src)(
          React, ReactDOM, Motion, _cn, _Lucide, _DynamicIcon, fakeExports, fakeModule,
          function(){ throw new Error('require() not available in mobile shell'); }
        );
        var Comp = fakeExports['default'] || fakeModule.exports['default'] ||
          Object.values(fakeExports).find(function(v){ return typeof v === 'function'; });
        if (!Comp) return;
        if (!_root) _root = ReactDOM.createRoot(document.getElementById('root'));
        _root.render(React.createElement(Comp, null));
        setTimeout(function() {
          var tw = window.tailwind;
          if (tw && tw.scan) { try { tw.scan(); } catch(e) { /* non-fatal */ } }
        }, 50);
      } catch(err) {
        document.getElementById('root').innerHTML =
          '<div style="color:#f87171;padding:1rem;font-family:monospace;font-size:11px">' +
          (err.message||err) + '</div>';
      }
    }
    window.addEventListener('message', function(ev) {
      if (!ev.data || ev.data.type !== 'UPDATE_CODE') return;
      runCode(ev.data.code);
    });
    window.parent.postMessage({ type: 'MOBILE_SHELL_READY' }, '*');
  </script>
</body>
</html>`;