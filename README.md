# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## 🦀 Rust Engine Setup

The project uses a high-performance Rust-based engine for code transformation. Since this is handled as a separate module, follow these steps to set it up:

### Prerequisites
- [Rust](https://www.rust-lang.org/tools/install) (latest stable version)
- `wasm-pack` for WebAssembly compilation:
  ```bash
  cargo install wasm-pack
  ```

### Installation & Compilation
1. Navigate to the engine directory:
   ```bash
   cd vectra-engine
   ```
2. Build the WebAssembly package:
   ```bash
   wasm-pack build --target web
   ```
3. The compiled artifacts will be placed in `vectra-engine/pkg/`. The React frontend will automatically import the WASM module from this location.

### Dependencies
The engine relies on:
- `swc_core`: For JavaScript/TypeScript transformation.
- `wasm-bindgen`: For Rust-JS communication.
- `serde`: For efficient data serialization.
