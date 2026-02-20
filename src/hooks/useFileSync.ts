import { useEffect, useRef } from 'react';
import { useEditor } from '../context/EditorContext';
import { useContainer } from '../context/ContainerContext';
import { RENDERER_CODE } from '../data/fileSystemTemplates';

export const useFileSync = () => {
  const { elements, pages, interaction, theme } = useEditor();
  const { writeFile, status, instance } = useContainer();

  const lastJson = useRef<string>("");
  const lastClasses = useRef<string>("");
  const isSyncing = useRef<boolean>(false);

  useEffect(() => {
    if (status !== 'ready' || !instance) return;
    if (interaction?.type === 'MOVE' || interaction?.type === 'RESIZE') return;

    const sync = async () => {
      if (isSyncing.current) return;
      isSyncing.current = true;

      try {
        // 1. SYNC DATA (project.json)
        const projectData = { pages, elements };
        const jsonString = JSON.stringify(projectData, null, 2);

        if (lastJson.current !== jsonString) {
          await writeFile('src/data/project.json', jsonString);
          lastJson.current = jsonString;

          // 2. SYNC TAILWIND CLASSES (The Ghost File)
          // We extract every single className from the project elements
          const allClasses = Object.values(elements)
            .map(el => (el.props as any)?.className || '')
            .join(' ');

          if (lastClasses.current !== allClasses) {
            // We write a dummy JS file that just contains the class strings.
            // Tailwind will scan this file and generate the CSS.
            const ghostContent = `// Auto-generated for Tailwind JIT\nexport const classes = "${allClasses}";`;
            await writeFile('src/tailwind-gen.js', ghostContent);
            lastClasses.current = allClasses;
          }
        }

        // 4. SYNC APP.TSX (Universal Renderer)
        // Write the latest renderer code to keep animations working
        await writeFile('src/App.tsx', RENDERER_CODE);

        // 3. SYNC THEME (tailwind.config.js)
        // Using ESM 'export default' to prevent "module not defined" crash
        // We only write this if it actually changed to prevent restart loops
        const themeKey = JSON.stringify(theme);
        if ((window as any)._lastSyncedTheme !== themeKey) {
          const twConfig = `/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: '${theme.primary}',
        secondary: '${theme.secondary}',
        accent: '${theme.accent}',
      },
      borderRadius: {
        DEFAULT: '${theme.radius}',
      },
      fontFamily: {
        sans: ['${theme.font}', 'sans-serif'],
      }
    },
  },
  plugins: [],
}`;
          await writeFile('tailwind.config.js', twConfig);
          (window as any)._lastSyncedTheme = themeKey;
        }

      } catch (e) {
        console.error("Sync Error", e);
      } finally {
        isSyncing.current = false;
      }
    };

    const timer = setTimeout(sync, 500);
    return () => clearTimeout(timer);

  }, [elements, pages, interaction, status, writeFile, instance, theme]);
};
