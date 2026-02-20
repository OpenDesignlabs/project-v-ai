import {
    Type, Square, Box, Layout, Grid, Image as ImageIcon, Video,
    FormInput, CheckSquare, List, Link, Frame, Columns, AlignCenter, CreditCard, Globe, Monitor,
    Sparkles, Zap, ListOrdered, Table as TableIcon, GalleryHorizontal
} from 'lucide-react';
import type { ComponentConfig, VectraProject } from '../types';

export const STORAGE_KEY = 'vectra_design_v68'; // Bump version to force update

export const COMPONENT_TYPES: Record<string, ComponentConfig> = {
    // --- BASIC (No layoutMode needed, usually leaf nodes) ---
    text: {
        icon: Type, label: 'Text', category: 'basic',
        defaultProps: { className: 'text-slate-800 text-base' }, defaultContent: 'Type something...'
    },
    heading: {
        icon: Type, label: 'Heading', category: 'basic',
        defaultProps: { className: 'text-slate-900 text-3xl font-bold mb-4' }, defaultContent: 'Big Heading'
    },
    button: {
        icon: Square, label: 'Button', category: 'basic',
        defaultProps: { className: 'px-5 py-2.5 bg-blue-600 text-white rounded-lg shadow-sm hover:bg-blue-700 font-medium transition-all active:scale-95' }, defaultContent: 'Click Me'
    },
    link: {
        icon: Link, label: 'Link', category: 'basic',
        defaultProps: { className: 'text-blue-600 hover:underline cursor-pointer' }, defaultContent: 'Read more'
    },

    // --- LAYOUT (CRITICAL FIX: Added layoutMode) ---
    container: {
        icon: Box, label: 'Container', category: 'layout',
        defaultProps: {
            className: 'p-6 border border-dashed border-slate-300 rounded bg-slate-50/50 min-h-[100px] flex flex-col gap-4',
            layoutMode: 'flex' // <--- ENABLE DROPPING
        }
    },
    card: {
        icon: CreditCard, label: 'Card', category: 'layout',
        defaultProps: {
            className: 'p-6 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col gap-4 hover:shadow-md transition-shadow',
            layoutMode: 'flex' // <--- ENABLE DROPPING
        }
    },
    stack_v: {
        icon: List, label: 'Vertical Stack', category: 'layout',
        defaultProps: { className: 'flex flex-col gap-4 p-4 min-h-[50px]', layoutMode: 'flex', stackOnMobile: true }
    },
    stack_h: {
        icon: Columns, label: 'Horizontal Stack', category: 'layout',
        defaultProps: { className: 'flex flex-row gap-4 p-4 min-h-[50px] items-center', layoutMode: 'flex', stackOnMobile: true }
    },
    grid: {
        icon: Grid, label: 'Grid', category: 'layout',
        defaultProps: {
            className: 'grid grid-cols-2 gap-4 p-4 w-full',
            layoutMode: 'grid'
        }
    },
    section: {
        icon: Layout, label: 'Section', category: 'layout',
        defaultProps: {
            className: 'w-full py-16 px-8 bg-white flex flex-col gap-4',
            layoutMode: 'flex' // <--- ENABLE DROPPING
        }
    },

    // --- FORMS ---
    input: {
        icon: FormInput, label: 'Input Field', category: 'forms',
        defaultProps: { className: 'w-full px-4 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none', placeholder: 'Enter text...' }
    },
    checkbox: {
        icon: CheckSquare, label: 'Checkbox', category: 'forms',
        defaultProps: { className: 'w-5 h-5 text-blue-600 rounded focus:ring-blue-500' }
    },

    // --- MEDIA ---
    image: {
        icon: ImageIcon, label: 'Image', category: 'media',
        defaultProps: { className: 'w-full h-64 object-cover rounded-xl bg-slate-100' }, src: 'https://via.placeholder.com/400x300'
    },
    video: {
        icon: Video, label: 'Video', category: 'media',
        defaultProps: { className: 'w-full aspect-video bg-slate-900 rounded-xl flex items-center justify-center text-white' }, defaultContent: 'Video Placeholder'
    },

    // --- SMART COMPONENTS ---
    accordion: {
        icon: ListOrdered, label: 'Accordion', category: 'sections',
        defaultProps: { className: 'w-full max-w-md' },
        defaultContent: 'Smart Accordion'
    },
    carousel: {
        icon: GalleryHorizontal, label: 'Carousel', category: 'media',
        defaultProps: { className: 'w-full max-w-2xl' },
        defaultContent: 'Smart Carousel'
    },
    table: {
        icon: TableIcon, label: 'Table', category: 'layout',
        defaultProps: { className: 'w-full' },
        defaultContent: 'Data Table'
    },

    // --- MARKETPLACE ---
    hero_geometric: { icon: Sparkles, label: 'Geometric Hero', category: 'sections', defaultProps: {}, defaultContent: '' },
    feature_hover: { icon: Zap, label: 'Hover Features', category: 'sections', defaultProps: { className: 'w-full relative bg-white', layoutMode: 'canvas' }, defaultContent: '' },

    // --- PRE-MADE SECTIONS (Fixed: Added layoutMode) ---
    hero: {
        icon: AlignCenter, label: 'Hero Section', category: 'sections',
        defaultProps: {
            className: 'w-full py-20 bg-slate-900 text-center flex flex-col items-center gap-6',
            layoutMode: 'flex' // <--- FIX
        }
    },
    pricing: {
        icon: CreditCard, label: 'Pricing Card', category: 'sections',
        defaultProps: {
            className: 'p-8 border border-slate-200 rounded-2xl shadow-sm hover:shadow-xl transition-all bg-white flex flex-col gap-4 max-w-sm',
            layoutMode: 'flex' // <--- FIX
        }
    },
    navbar: {
        icon: Globe, label: 'Navbar', category: 'sections',
        defaultProps: {
            className: 'w-full px-8 py-4 flex items-center justify-between bg-white border-b border-slate-100 sticky top-0 z-50',
            layoutMode: 'flex' // <--- FIX
        }
    },

    // --- ARTBOARDS ---
    webpage: {
        icon: Monitor, label: 'Desktop Frame', category: 'layout',
        defaultProps: {
            className: 'shadow-2xl overflow-hidden',
            layoutMode: 'canvas',
            style: { width: '1200px', height: '1000px', position: 'absolute', backgroundColor: '#f2f0ef' }
        }
    },
    canvas: {
        icon: Frame, label: 'Mobile Frame', category: 'layout',
        defaultProps: {
            className: 'shadow-2xl overflow-hidden rounded-[40px] border-[8px] border-slate-900',
            layoutMode: 'canvas',
            style: { width: '375px', height: '812px', position: 'absolute', backgroundColor: '#f2f0ef' }
        }
    },
};

export const INITIAL_DATA: VectraProject = {
    'application-root': { id: 'application-root', type: 'app', name: 'App', children: ['page-home'], props: {} },
    'page-home': { id: 'page-home', type: 'page', name: 'Home', children: ['frame-desktop', 'frame-mobile'], props: { layoutMode: 'canvas' } },
    'frame-desktop': {
        id: 'frame-desktop', type: 'webpage', name: 'Desktop', children: [],
        props: {
            layoutMode: 'canvas',
            className: 'shadow-lg overflow-hidden',
            style: { position: 'absolute', left: '100px', top: '100px', width: '1200px', height: '1200px', backgroundColor: '#f2f0ef' }
        }
    },
    'frame-mobile': {
        id: 'frame-mobile', type: 'canvas', name: 'Mobile', children: [],
        props: {
            layoutMode: 'canvas',
            className: 'shadow-lg overflow-hidden border border-slate-200',
            style: { position: 'absolute', left: '1400px', top: '100px', width: '375px', height: '812px', backgroundColor: '#f2f0ef' }
        }
    }
};
