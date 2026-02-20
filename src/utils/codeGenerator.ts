import type { VectraProject, Page, DataSource } from '../types';

export interface GeneratedFileMap {
    files: Record<string, string>;
    dependencies: Set<string>;
}

class ImportManager {
    private imports: Map<string, Set<string>> = new Map();
    public dependencies: Set<string> = new Set();

    add(module: string, items: string | string[]) {
        if (!module.startsWith('.') && module !== 'react') this.dependencies.add(module);
        if (!this.imports.has(module)) this.imports.set(module, new Set());
        const set = this.imports.get(module)!;
        if (Array.isArray(items)) items.forEach(i => set.add(i));
        else set.add(items);
    }

    generate(): string {
        let code = `import React from 'react';\n`;
        this.imports.forEach((items, module) => {
            const list = Array.from(items);
            const defaultEntry = list.find(i => i.startsWith('default:'));
            if (defaultEntry) {
                code += `import ${defaultEntry.split(':')[1]} from '${module}';\n`;
            } else if (list.includes('*')) {
                const name = list.find(i => i.startsWith('* as ')) || '*';
                code += `import ${name} from '${module}';\n`;
            } else {
                code += `import { ${list.join(', ')} } from '${module}';\n`;
            }
        });
        return code;
    }
}

const cleanClass = (c: string) => c ? c.replace(/\s+/g, ' ').trim() : '';
const injectBindings = (t: string) => t ? t.replace(/{{([^}]+)}}/g, (_, p) => `{data?.${p.split('.').join('?.')} ?? ''}`) : '';

const serializeStyle = (styleObj: any) => {
    if (!styleObj || Object.keys(styleObj).length === 0) return '';
    const clean: any = {};
    Object.entries(styleObj).forEach(([k, v]) => { if (v !== undefined && v !== '' && k !== 'animationName') clean[k] = v; });
    return Object.keys(clean).length ? `style={${JSON.stringify(clean)}}` : '';
};

const generateMotionProps = (props: any): string[] => {
    const motionAttributes: string[] = [];

    if (props.hoverEffect && props.hoverEffect !== 'none') {
        let hoverObj = '';
        switch (props.hoverEffect) {
            case 'lift': hoverObj = '{ y: -5 }'; break;
            case 'scale': hoverObj = '{ scale: 1.05 }'; break;
            case 'glow': hoverObj = '{ boxShadow: "0 0 15px rgba(59, 130, 246, 0.6)" }'; break;
            case 'border': hoverObj = '{ borderColor: "#3b82f6", borderWidth: "1px", borderStyle: "solid" }'; break;
            case 'opacity': hoverObj = '{ opacity: 0.7 }'; break;
        }
        if (hoverObj) motionAttributes.push(`whileHover={${hoverObj}}`);
        motionAttributes.push(`transition={{ type: "spring", stiffness: 300, damping: 20 }}`);
    }

    if (props.animation && props.animation !== 'none') {
        const dur = props.animationDuration || 0.5;
        const dly = props.animationDelay || 0;

        if (!motionAttributes.some(p => p.startsWith('transition'))) {
            motionAttributes.push(`transition={{ duration: ${dur}, delay: ${dly}, ease: "easeOut" }}`);
        }

        switch (props.animation) {
            case 'fade':
                motionAttributes.push(`initial={{ opacity: 0 }}`);
                motionAttributes.push(`animate={{ opacity: 1 }}`);
                break;
            case 'slide-up':
                motionAttributes.push(`initial={{ opacity: 0, y: 30 }}`);
                motionAttributes.push(`animate={{ opacity: 1, y: 0 }}`);
                break;
            case 'slide-left':
                motionAttributes.push(`initial={{ opacity: 0, x: -30 }}`);
                motionAttributes.push(`animate={{ opacity: 1, x: 0 }}`);
                break;
            case 'scale-in':
                motionAttributes.push(`initial={{ opacity: 0, scale: 0.8 }}`);
                motionAttributes.push(`animate={{ opacity: 1, scale: 1 }}`);
                break;
        }
    }

    return motionAttributes;
};

const generateNodeCode = (nodeId: string, project: VectraProject, imports: ImportManager, depth: number): string => {
    const node = project[nodeId];
    if (!node) return '';
    const indent = '  '.repeat(depth);

    let tagName = 'div';
    let content = '';
    const isComponent = ['hero_geometric', 'feature_hover', 'geometric_shapes'].includes(node.type);

    if (isComponent) {
        const name = node.type.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
        tagName = name;
        imports.add(`../components/marketplace/${name}`, `default:${name}`);
    } else {
        switch (node.type) {
            case 'text': tagName = 'p'; content = injectBindings(node.content || ''); break;
            case 'heading': tagName = 'h1'; content = injectBindings(node.content || ''); break;
            case 'image': tagName = 'img'; break;
            case 'input': tagName = 'input'; break;
            case 'button': tagName = 'button'; content = node.content || 'Click'; break;
            case 'icon':
                tagName = `Lucide.${node.props.iconName || 'HelpCircle'}`;
                imports.add('lucide-react', '* as Lucide');
                break;
        }
    }

    const motionProps = generateMotionProps(node.props);
    const hasMotion = motionProps.length > 0;

    if (hasMotion && !tagName.includes('.') && !isComponent) {
        imports.add('framer-motion', 'motion');
        tagName = `motion.${tagName}`;
    }

    const props: string[] = [];
    if (node.props.className) props.push(`className="${cleanClass(node.props.className)}"`);
    const styleStr = serializeStyle(node.props.style);
    if (styleStr) props.push(styleStr);

    if (node.type === 'image') props.push(`src="${node.src || 'https://via.placeholder.com/150'}"`);
    if (node.type === 'input') props.push(`placeholder="${node.props.placeholder || ''}"`);

    if (isComponent) {
        Object.entries(node.props).forEach(([k, v]) => {
            if (['className', 'style', 'children'].includes(k)) return;
            if (typeof v === 'string') props.push(`${k}="${v}"`);
            else if (typeof v === 'number' || typeof v === 'boolean') props.push(`${k}={${v}}`);
        });
    }

    props.push(...motionProps);

    let childrenCode = '';
    if (node.children && !isComponent) {
        childrenCode = node.children.map((cid: string) => generateNodeCode(cid, project, imports, depth + 1)).join('');
    }

    const propsStr = props.length ? ' ' + props.join(' ') : '';
    let code = '';

    if (['img', 'input', 'hr', 'br'].includes(node.type) || (tagName.includes('Lucide') && !hasMotion)) {
        code = `${indent}<${tagName}${propsStr} />\n`;
    } else {
        const safeContent = content ? `\n${indent}  ${content}` : '';
        const safeChildren = childrenCode ? `\n${childrenCode}${indent}` : '';
        if (!safeContent && !safeChildren) {
            code = `${indent}<${tagName}${propsStr} />\n`;
        } else {
            code = `${indent}<${tagName}${propsStr}>${safeContent}${safeChildren}</${tagName}>\n`;
        }
    }

    if (node.props.linkTo) {
        imports.add('react-router-dom', 'Link');
        return `${indent}<Link to="${node.props.linkTo}" className="contents">\n${code}${indent}</Link>\n`;
    }

    return code;
};

export const generateProjectCode = (
    project: VectraProject,
    pages: Page[],
    _dataSources: DataSource[]
): GeneratedFileMap => {
    const files: Record<string, string> = {};
    const allDependencies = new Set<string>();

    allDependencies.add('react');
    allDependencies.add('react-dom');
    allDependencies.add('react-router-dom');
    allDependencies.add('clsx');
    allDependencies.add('tailwind-merge');

    pages.forEach(page => {
        const compName = page.name.replace(/[^a-zA-Z0-9]/g, '');
        const imports = new ImportManager();
        const rootNode = project[page.rootId];

        let rootFrameId = rootNode?.children?.find(cid => project[cid]?.type === 'webpage');
        if (!rootFrameId && rootNode?.children?.length) rootFrameId = rootNode.children[0];

        let jsxContent = '';
        if (rootFrameId) {
            if (project[rootFrameId].children) {
                jsxContent = project[rootFrameId].children!.map((cid: string) => generateNodeCode(cid, project, imports, 3)).join('');
            }
        } else {
            jsxContent = `      <div className="text-center p-10">Empty Page</div>`;
        }

        const code = `${imports.generate()}

export default function ${compName}() {
  return (
    <div className="min-h-screen bg-white">
${jsxContent}    </div>
  );
}`;
        files[`src/pages/${compName}.tsx`] = code;
        imports.dependencies.forEach(d => allDependencies.add(d));
    });

    const routerImports = new ImportManager();
    routerImports.add('react-router-dom', ['BrowserRouter', 'Routes', 'Route']);

    const routeJSX = pages.map(p => {
        const name = p.name.replace(/[^a-zA-Z0-9]/g, '');
        routerImports.add(`./pages/${name}`, `default:${name}`);
        return `<Route path="${p.slug}" element={<${name} />} />`;
    }).join('\n        ');

    files['src/App.tsx'] = `${routerImports.generate()}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        ${routeJSX}
      </Routes>
    </BrowserRouter>
  );
}`;

    return { files, dependencies: allDependencies };
};

export const generateCode = (project: VectraProject, rootId: string): string => {
    return generateNodeCode(rootId, project, new ImportManager(), 0);
};

export const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Failed to copy: ', err);
        return false;
    }
};
