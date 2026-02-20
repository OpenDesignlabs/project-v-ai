import type { VectraProject } from '../types';
import {
    Sparkles, Layout, CreditCard, User, Mail,
    ShoppingBag, Image as ImageIcon,
    Users,
    type LucideIcon
} from 'lucide-react';

export interface TemplateConfig {
    rootId: string;
    nodes: VectraProject;
    name: string;
    category: string;
    icon: LucideIcon;
}

export const TEMPLATES: Record<string, TemplateConfig> = {

    // ==============================================
    // CATEGORY: LANDING PAGE
    // ==============================================

    hero_saas: {
        name: 'SaaS Hero',
        category: 'Landing Page',
        icon: Sparkles,
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root', type: 'section', name: 'Hero Section',
                children: ['bg', 'nav_logo', 'nav_btn', 'h1', 'p1', 'cta_primary', 'cta_secondary', 'hero_img'],
                props: { className: 'bg-white overflow-hidden relative', layoutMode: 'canvas', style: { position: 'absolute', width: '1200px', height: '800px', left: '0px', top: '0px' } }
            },
            'bg': { id: 'bg', type: 'container', name: 'Background', children: [], locked: true, props: { className: 'bg-gradient-to-b from-slate-50 to-white', style: { position: 'absolute', width: '100%', height: '100%', left: '0px', top: '0px', zIndex: 0 } } },

            'nav_logo': { id: 'nav_logo', type: 'heading', name: 'Logo', content: 'VECTRA.', props: { className: 'text-2xl font-black text-slate-900', style: { position: 'absolute', left: '50px', top: '40px', width: '200px', height: '40px', zIndex: 10 } } },
            'nav_btn': { id: 'nav_btn', type: 'button', name: 'Login', content: 'Sign In', props: { className: 'px-6 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold hover:bg-slate-50', style: { position: 'absolute', left: '1050px', top: '35px', width: '100px', height: '40px', zIndex: 10 } } },

            'h1': { id: 'h1', type: 'heading', name: 'Headline', content: 'Ship your startup faster.', props: { className: 'text-7xl font-black text-slate-900 leading-tight tracking-tighter text-center', style: { position: 'absolute', left: '100px', top: '150px', width: '1000px', height: '160px', zIndex: 10 } } },
            'p1': { id: 'p1', type: 'text', name: 'Sub', content: 'The only visual builder that exports clean, production-ready React code. No lock-in, just speed.', props: { className: 'text-xl text-slate-500 font-medium text-center', style: { position: 'absolute', left: '300px', top: '320px', width: '600px', height: '60px', zIndex: 10 } } },

            'cta_primary': { id: 'cta_primary', type: 'button', name: 'Primary', content: 'Get Started Free', props: { className: 'px-8 py-4 bg-blue-600 text-white rounded-full font-bold text-lg hover:bg-blue-700 shadow-xl shadow-blue-600/20', style: { position: 'absolute', left: '420px', top: '420px', width: '220px', height: '60px', zIndex: 20 } } },
            'cta_secondary': { id: 'cta_secondary', type: 'button', name: 'Secondary', content: 'View Demo', props: { className: 'px-8 py-4 bg-white text-slate-700 border border-slate-200 rounded-full font-bold text-lg hover:bg-slate-50', style: { position: 'absolute', left: '660px', top: '420px', width: '180px', height: '60px', zIndex: 20 } } },

            'hero_img': { id: 'hero_img', type: 'image', name: 'Dashboard', src: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80', props: { className: 'rounded-t-2xl border-4 border-slate-900 shadow-2xl', style: { position: 'absolute', left: '150px', top: '550px', width: '900px', height: '600px', zIndex: 5 } } }
        }
    },

    features_grid: {
        name: 'Feature Grid',
        category: 'Landing Page',
        icon: Layout,
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root', type: 'section', name: 'Features',
                children: ['f_h2', 'f_card1', 'f_card2', 'f_card3'],
                props: { className: 'bg-slate-900', layoutMode: 'canvas', style: { position: 'absolute', width: '1200px', height: '600px', left: '0px', top: '0px' } }
            },
            'f_h2': { id: 'f_h2', type: 'heading', name: 'Title', content: 'Why Choose Us?', props: { className: 'text-4xl font-bold text-white text-center', style: { position: 'absolute', left: '400px', top: '80px', width: '400px', height: '50px' } } },

            'f_card1': { id: 'f_card1', type: 'container', name: 'Card 1', children: ['c1_i', 'c1_t', 'c1_d'], props: { className: 'bg-slate-800 p-8 rounded-2xl border border-slate-700 hover:border-blue-500 transition-colors', layoutMode: 'canvas', style: { position: 'absolute', left: '100px', top: '200px', width: '300px', height: '300px' } } },
            'c1_i': { id: 'c1_i', type: 'text', name: 'Icon', content: '⚡', props: { className: 'text-4xl mb-4', style: { position: 'absolute', left: '32px', top: '32px', width: '50px', height: '50px' } } },
            'c1_t': { id: 'c1_t', type: 'heading', name: 'Title', content: 'Blazing Fast', props: { className: 'text-xl font-bold text-white', style: { position: 'absolute', left: '32px', top: '100px', width: '200px', height: '30px' } } },
            'c1_d': { id: 'c1_d', type: 'text', name: 'Desc', content: 'Optimized for speed with zero runtime overhead.', props: { className: 'text-slate-400 leading-relaxed', style: { position: 'absolute', left: '32px', top: '140px', width: '236px', height: '100px' } } },

            'f_card2': { id: 'f_card2', type: 'container', name: 'Card 2', children: ['c2_i', 'c2_t', 'c2_d'], props: { className: 'bg-slate-800 p-8 rounded-2xl border border-slate-700 hover:border-purple-500 transition-colors', layoutMode: 'canvas', style: { position: 'absolute', left: '450px', top: '200px', width: '300px', height: '300px' } } },
            'c2_i': { id: 'c2_i', type: 'text', name: 'Icon', content: '🛡️', props: { className: 'text-4xl mb-4', style: { position: 'absolute', left: '32px', top: '32px', width: '50px', height: '50px' } } },
            'c2_t': { id: 'c2_t', type: 'heading', name: 'Title', content: 'Secure', props: { className: 'text-xl font-bold text-white', style: { position: 'absolute', left: '32px', top: '100px', width: '200px', height: '30px' } } },
            'c2_d': { id: 'c2_d', type: 'text', name: 'Desc', content: 'Enterprise-grade security standards built-in.', props: { className: 'text-slate-400 leading-relaxed', style: { position: 'absolute', left: '32px', top: '140px', width: '236px', height: '100px' } } },

            'f_card3': { id: 'f_card3', type: 'container', name: 'Card 3', children: ['c3_i', 'c3_t', 'c3_d'], props: { className: 'bg-slate-800 p-8 rounded-2xl border border-slate-700 hover:border-green-500 transition-colors', layoutMode: 'canvas', style: { position: 'absolute', left: '800px', top: '200px', width: '300px', height: '300px' } } },
            'c3_i': { id: 'c3_i', type: 'text', name: 'Icon', content: '💎', props: { className: 'text-4xl mb-4', style: { position: 'absolute', left: '32px', top: '32px', width: '50px', height: '50px' } } },
            'c3_t': { id: 'c3_t', type: 'heading', name: 'Title', content: 'Premium', props: { className: 'text-xl font-bold text-white', style: { position: 'absolute', left: '32px', top: '100px', width: '200px', height: '30px' } } },
            'c3_d': { id: 'c3_d', type: 'text', name: 'Desc', content: 'Top-tier design components included free.', props: { className: 'text-slate-400 leading-relaxed', style: { position: 'absolute', left: '32px', top: '140px', width: '236px', height: '100px' } } },
        }
    },

    // ==============================================
    // CATEGORY: PORTFOLIO
    // ==============================================

    portfolio_hero: {
        name: 'Creative Profile',
        category: 'Portfolio',
        icon: User,
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root', type: 'section', name: 'Profile Hero',
                children: ['p_circle', 'p_img', 'p_name', 'p_role', 'p_bio', 'p_btn'],
                props: { className: 'bg-[#0a0a0a] overflow-hidden', layoutMode: 'canvas', style: { position: 'absolute', width: '1200px', height: '600px', left: '0px', top: '0px' } }
            },
            'p_circle': { id: 'p_circle', type: 'container', name: 'Deco', children: [], props: { className: 'rounded-full border border-white/10', style: { position: 'absolute', left: '300px', top: '-100px', width: '600px', height: '600px' } } },
            'p_img': { id: 'p_img', type: 'image', name: 'Photo', src: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&h=400', props: { className: 'rounded-full object-cover border-4 border-black outline outline-2 outline-white/20', style: { position: 'absolute', left: '500px', top: '100px', width: '200px', height: '200px', zIndex: 10 } } },
            'p_name': { id: 'p_name', type: 'heading', name: 'Name', content: 'Sarah Jenkins', props: { className: 'text-5xl font-bold text-white text-center', style: { position: 'absolute', left: '300px', top: '340px', width: '600px', height: '60px', zIndex: 10 } } },
            'p_role': { id: 'p_role', type: 'text', name: 'Role', content: 'Digital Product Designer', props: { className: 'text-xl text-slate-400 text-center uppercase tracking-widest', style: { position: 'absolute', left: '300px', top: '400px', width: '600px', height: '30px', zIndex: 10 } } },
            'p_bio': { id: 'p_bio', type: 'text', name: 'Bio', content: 'Creating meaningful digital experiences that live at the intersection of design and technology.', props: { className: 'text-slate-500 text-center leading-relaxed', style: { position: 'absolute', left: '400px', top: '450px', width: '400px', height: '60px', zIndex: 10 } } },
            'p_btn': { id: 'p_btn', type: 'button', name: 'Contact', content: 'Get in Touch', props: { className: 'px-8 py-3 bg-white text-black rounded-full font-bold hover:scale-105 transition-transform', style: { position: 'absolute', left: '525px', top: '530px', width: '150px', height: '50px', zIndex: 10 } } }
        }
    },

    portfolio_projects: {
        name: 'Project Gallery',
        category: 'Portfolio',
        icon: ImageIcon,
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root', type: 'section', name: 'Gallery',
                children: ['g_h1', 'g_1', 'g_2', 'g_3', 'g_4'],
                props: { className: 'bg-white', layoutMode: 'canvas', style: { position: 'absolute', width: '1200px', height: '800px', left: '0px', top: '0px' } }
            },
            'g_h1': { id: 'g_h1', type: 'heading', name: 'Title', content: 'Selected Work', props: { className: 'text-3xl font-black text-slate-900 uppercase tracking-tighter', style: { position: 'absolute', left: '100px', top: '60px', width: '400px', height: '40px' } } },

            'g_1': { id: 'g_1', type: 'container', name: 'Project 1', children: ['g1_img', 'g1_lbl'], props: { className: 'group overflow-hidden bg-slate-100', layoutMode: 'canvas', style: { position: 'absolute', left: '100px', top: '140px', width: '600px', height: '400px' } } },
            'g1_img': { id: 'g1_img', type: 'image', name: 'Img', src: 'https://images.unsplash.com/photo-1600607686527-6fb886090705?auto=format&fit=crop&w=800&q=80', props: { className: 'w-full h-full object-cover group-hover:scale-105 transition-transform duration-500', style: { position: 'absolute', left: '0px', top: '0px', width: '600px', height: '400px' } } },
            'g1_lbl': { id: 'g1_lbl', type: 'button', name: 'Label', content: 'Fintech App', props: { className: 'px-4 py-2 bg-white text-black text-sm font-bold absolute bottom-6 left-6 opacity-0 group-hover:opacity-100 transition-opacity', style: { position: 'absolute', left: '24px', top: '340px', width: '120px', height: '36px' } } },

            'g_2': { id: 'g_2', type: 'container', name: 'Project 2', children: ['g2_img'], props: { className: 'group overflow-hidden bg-slate-100', layoutMode: 'canvas', style: { position: 'absolute', left: '720px', top: '140px', width: '380px', height: '620px' } } },
            'g2_img': { id: 'g2_img', type: 'image', name: 'Img', src: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=600&q=80', props: { className: 'w-full h-full object-cover group-hover:scale-105 transition-transform duration-500', style: { position: 'absolute', left: '0px', top: '0px', width: '380px', height: '620px' } } },

            'g_3': { id: 'g_3', type: 'container', name: 'Project 3', children: ['g3_img'], props: { className: 'group overflow-hidden bg-slate-100', layoutMode: 'canvas', style: { position: 'absolute', left: '100px', top: '560px', width: '290px', height: '200px' } } },
            'g3_img': { id: 'g3_img', type: 'image', name: 'Img', src: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&w=400&q=80', props: { className: 'w-full h-full object-cover group-hover:scale-105 transition-transform duration-500', style: { position: 'absolute', left: '0px', top: '0px', width: '290px', height: '200px' } } },

            'g_4': { id: 'g_4', type: 'container', name: 'Project 4', children: ['g4_img'], props: { className: 'group overflow-hidden bg-slate-100', layoutMode: 'canvas', style: { position: 'absolute', left: '410px', top: '560px', width: '290px', height: '200px' } } },
            'g4_img': { id: 'g4_img', type: 'image', name: 'Img', src: 'https://images.unsplash.com/photo-1581291518633-83b4ebd1d83e?auto=format&fit=crop&w=400&q=80', props: { className: 'w-full h-full object-cover group-hover:scale-105 transition-transform duration-500', style: { position: 'absolute', left: '0px', top: '0px', width: '290px', height: '200px' } } },
        }
    },

    // ==============================================
    // CATEGORY: E-COMMERCE
    // ==============================================

    ecommerce_product: {
        name: 'Product Detail',
        category: 'E-Commerce',
        icon: ShoppingBag,
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root', type: 'section', name: 'Product',
                children: ['p_img_main', 'p_tag', 'p_title', 'p_price', 'p_desc', 'p_btn_add', 'p_btn_fav', 'p_spec1', 'p_spec2'],
                props: { className: 'bg-white', layoutMode: 'canvas', style: { position: 'absolute', width: '1200px', height: '700px', left: '0px', top: '0px' } }
            },
            'p_img_main': { id: 'p_img_main', type: 'image', name: 'Main Image', src: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80', props: { className: 'object-contain', style: { position: 'absolute', left: '100px', top: '100px', width: '500px', height: '500px' } } },

            'p_tag': { id: 'p_tag', type: 'button', name: 'Tag', content: 'NEW ARRIVAL', props: { className: 'px-3 py-1 bg-red-50 text-red-600 text-[10px] font-bold tracking-widest rounded-sm uppercase', style: { position: 'absolute', left: '650px', top: '100px', width: '100px', height: '24px' } } },
            'p_title': { id: 'p_title', type: 'heading', name: 'Title', content: 'Nike Air Max 270', props: { className: 'text-5xl font-black text-slate-900', style: { position: 'absolute', left: '650px', top: '140px', width: '500px', height: '60px' } } },
            'p_price': { id: 'p_price', type: 'heading', name: 'Price', content: '$150.00', props: { className: 'text-3xl font-medium text-slate-500', style: { position: 'absolute', left: '650px', top: '210px', width: '200px', height: '40px' } } },
            'p_desc': { id: 'p_desc', type: 'text', name: 'Desc', content: 'The Nike Air Max 270 delivers unrivaled comfort for all-day wear. It features a large Max Air unit and a breathable mesh upper.', props: { className: 'text-slate-500 leading-relaxed', style: { position: 'absolute', left: '650px', top: '270px', width: '450px', height: '80px' } } },

            'p_spec1': { id: 'p_spec1', type: 'button', name: 'Size', content: 'Select Size', props: { className: 'px-4 py-3 border border-slate-300 rounded text-slate-500 text-left text-sm', style: { position: 'absolute', left: '650px', top: '380px', width: '215px', height: '48px' } } },
            'p_spec2': { id: 'p_spec2', type: 'button', name: 'Color', content: 'Select Color', props: { className: 'px-4 py-3 border border-slate-300 rounded text-slate-500 text-left text-sm', style: { position: 'absolute', left: '885px', top: '380px', width: '215px', height: '48px' } } },

            'p_btn_add': { id: 'p_btn_add', type: 'button', name: 'Add', content: 'Add to Cart', props: { className: 'bg-black text-white font-bold rounded hover:bg-slate-800', style: { position: 'absolute', left: '650px', top: '450px', width: '350px', height: '56px' } } },
            'p_btn_fav': { id: 'p_btn_fav', type: 'button', name: 'Fav', content: '♥', props: { className: 'border border-slate-200 text-slate-400 rounded hover:border-red-400 hover:text-red-500 text-xl', style: { position: 'absolute', left: '1020px', top: '450px', width: '80px', height: '56px' } } },
        }
    },

    // ==============================================
    // CATEGORY: contact
    // ==============================================

    contact_split: {
        name: 'Contact Split',
        category: 'Contact',
        icon: Mail,
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root', type: 'section', name: 'Contact',
                children: ['c_map', 'c_form'],
                props: { className: 'bg-white', layoutMode: 'canvas', style: { position: 'absolute', width: '1200px', height: '600px', left: '0px', top: '0px' } }
            },
            'c_map': { id: 'c_map', type: 'image', name: 'Map', src: 'https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=800&q=80', props: { className: 'object-cover grayscale hover:grayscale-0 transition-all duration-700', style: { position: 'absolute', left: '0px', top: '0px', width: '600px', height: '600px' } } },

            'c_form': { id: 'c_form', type: 'container', name: 'Form Container', children: ['cf_h', 'cf_p', 'cf_in1', 'cf_in2', 'cf_btn'], props: { className: 'bg-white p-12', layoutMode: 'canvas', style: { position: 'absolute', left: '600px', top: '0px', width: '600px', height: '600px' } } },
            'cf_h': { id: 'cf_h', type: 'heading', name: 'Heading', content: 'Get in touch', props: { className: 'text-4xl font-bold text-slate-900', style: { position: 'absolute', left: '48px', top: '100px', width: '400px', height: '50px' } } },
            'cf_p': { id: 'cf_p', type: 'text', name: 'Sub', content: 'We’d love to hear from you. Please fill out this form.', props: { className: 'text-slate-500', style: { position: 'absolute', left: '48px', top: '160px', width: '400px', height: '30px' } } },
            'cf_in1': { id: 'cf_in1', type: 'input', name: 'Email', props: { placeholder: 'you@example.com', className: 'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded focus:ring-2 focus:ring-blue-500 outline-none', style: { position: 'absolute', left: '48px', top: '230px', width: '400px', height: '50px' } } },
            'cf_in2': { id: 'cf_in2', type: 'input', name: 'Message', props: { placeholder: 'Your message...', className: 'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded focus:ring-2 focus:ring-blue-500 outline-none', style: { position: 'absolute', left: '48px', top: '300px', width: '400px', height: '120px' } } },
            'cf_btn': { id: 'cf_btn', type: 'button', name: 'Send', content: 'Send Message', props: { className: 'bg-slate-900 text-white font-bold rounded px-8 hover:bg-black', style: { position: 'absolute', left: '48px', top: '450px', width: '160px', height: '50px' } } },
        }
    },

    // ==============================================
    // SECTIONS & MISC (Preserving existing)
    // ==============================================

    pricing_tables: {
        name: 'Pricing Tables',
        category: 'Sections',
        icon: CreditCard,
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root', type: 'section', name: 'Pricing Section',
                children: ['h_title', 'h_desc', 'card_1', 'card_2', 'card_3'],
                props: { className: 'bg-slate-50', layoutMode: 'canvas', style: { position: 'absolute', width: '1200px', height: '800px', left: '0px', top: '0px' } }
            },
            'h_title': { id: 'h_title', type: 'heading', name: 'Title', content: 'Simple Pricing', props: { className: 'text-4xl font-bold text-center text-slate-900', style: { position: 'absolute', left: '400px', top: '60px', width: '400px', height: '50px' } } },
            'h_desc': { id: 'h_desc', type: 'text', name: 'Subtitle', content: 'Choose the plan that fits your needs.', props: { className: 'text-center text-slate-500', style: { position: 'absolute', left: '400px', top: '120px', width: '400px', height: '30px' } } },
            'card_1': { id: 'card_1', type: 'container', name: 'Basic Plan', children: ['c1_t', 'c1_p', 'c1_b'], props: { className: 'bg-white rounded-xl shadow-sm border border-slate-200 p-6', layoutMode: 'canvas', style: { position: 'absolute', left: '100px', top: '200px', width: '300px', height: '400px' } } },
            'c1_t': { id: 'c1_t', type: 'heading', name: 'Plan Name', content: 'Starter', props: { className: 'text-xl font-bold text-slate-900', style: { position: 'absolute', left: '24px', top: '24px', width: '200px', height: '30px' } } },
            'c1_p': { id: 'c1_p', type: 'heading', name: 'Price', content: '$0/mo', props: { className: 'text-4xl font-black text-slate-900', style: { position: 'absolute', left: '24px', top: '70px', width: '200px', height: '50px' } } },
            'c1_b': { id: 'c1_b', type: 'button', name: 'Button', content: 'Get Started', props: { className: 'w-full py-3 bg-slate-100 text-slate-900 font-bold rounded-lg hover:bg-slate-200', style: { position: 'absolute', left: '24px', top: '320px', width: '252px', height: '48px' } } },
            'card_2': { id: 'card_2', type: 'container', name: 'Pro Plan', children: ['c2_t', 'c2_p', 'c2_b', 'c2_badge'], props: { className: 'bg-white rounded-xl shadow-xl border-2 border-blue-600 p-6 relative', layoutMode: 'canvas', style: { position: 'absolute', left: '450px', top: '180px', width: '300px', height: '440px', zIndex: 10 } } },
            'c2_badge': { id: 'c2_badge', type: 'button', name: 'Badge', content: 'MOST POPULAR', props: { className: 'px-3 py-1 bg-blue-600 text-white text-[10px] font-bold rounded-full uppercase', style: { position: 'absolute', left: '95px', top: '-15px', width: '110px', height: '24px' } } },
            'c2_t': { id: 'c2_t', type: 'heading', name: 'Plan Name', content: 'Professional', props: { className: 'text-xl font-bold text-slate-900', style: { position: 'absolute', left: '24px', top: '40px', width: '200px', height: '30px' } } },
            'c2_p': { id: 'c2_p', type: 'heading', name: 'Price', content: '$29/mo', props: { className: 'text-4xl font-black text-slate-900', style: { position: 'absolute', left: '24px', top: '86px', width: '200px', height: '50px' } } },
            'c2_b': { id: 'c2_b', type: 'button', name: 'Button', content: 'Try Pro', props: { className: 'w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700', style: { position: 'absolute', left: '24px', top: '360px', width: '252px', height: '48px' } } },
            'card_3': { id: 'card_3', type: 'container', name: 'Enterprise Plan', children: ['c3_t', 'c3_p', 'c3_b'], props: { className: 'bg-white rounded-xl shadow-sm border border-slate-200 p-6', layoutMode: 'canvas', style: { position: 'absolute', left: '800px', top: '200px', width: '300px', height: '400px' } } },
            'c3_t': { id: 'c3_t', type: 'heading', name: 'Plan Name', content: 'Enterprise', props: { className: 'text-xl font-bold text-slate-900', style: { position: 'absolute', left: '24px', top: '24px', width: '200px', height: '30px' } } },
            'c3_p': { id: 'c3_p', type: 'heading', name: 'Price', content: 'Custom', props: { className: 'text-4xl font-black text-slate-900', style: { position: 'absolute', left: '24px', top: '70px', width: '200px', height: '50px' } } },
            'c3_b': { id: 'c3_b', type: 'button', name: 'Button', content: 'Contact Sales', props: { className: 'w-full py-3 bg-slate-100 text-slate-900 font-bold rounded-lg hover:bg-slate-200', style: { position: 'absolute', left: '24px', top: '320px', width: '252px', height: '48px' } } },
        }
    },

    team_section: {
        name: 'Team Section',
        category: 'Sections',
        icon: Users,
        rootId: 'root',
        nodes: {
            'root': {
                id: 'root', type: 'section', name: 'Team Grid',
                children: ['t_head', 'tm_1', 'tm_2', 'tm_3'],
                props: { className: 'bg-white', layoutMode: 'canvas', style: { position: 'absolute', width: '1200px', height: '600px', left: '0px', top: '0px' } }
            },
            't_head': { id: 't_head', type: 'heading', name: 'Headline', content: 'Meet our experts', props: { className: 'text-4xl font-bold text-center text-slate-900', style: { position: 'absolute', left: '400px', top: '50px', width: '400px', height: '50px' } } },
            'tm_1': { id: 'tm_1', type: 'container', name: 'M1', children: ['tm1_i', 'tm1_n', 'tm1_r'], props: { className: 'bg-white', layoutMode: 'canvas', style: { position: 'absolute', left: '150px', top: '150px', width: '250px', height: '350px' } } },
            'tm1_i': { id: 'tm1_i', type: 'image', name: 'A1', src: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?fit=crop&w=256&h=256', props: { className: 'rounded-xl object-cover shadow-lg', style: { position: 'absolute', left: '25px', top: '0px', width: '200px', height: '200px' } } },
            'tm1_n': { id: 'tm1_n', type: 'text', name: 'N1', content: 'Elara V.', props: { className: 'text-lg font-bold text-center mt-4', style: { position: 'absolute', left: '0px', top: '220px', width: '250px', height: '30px' } } },
            'tm1_r': { id: 'tm1_r', type: 'text', name: 'R1', content: 'Lead Designer', props: { className: 'text-sm text-slate-500 text-center', style: { position: 'absolute', left: '0px', top: '250px', width: '250px', height: '20px' } } },
            'tm_2': { id: 'tm_2', type: 'container', name: 'M2', children: ['tm2_i', 'tm2_n', 'tm2_r'], props: { className: 'bg-white', layoutMode: 'canvas', style: { position: 'absolute', left: '475px', top: '150px', width: '250px', height: '350px' } } },
            'tm2_i': { id: 'tm2_i', type: 'image', name: 'A2', src: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?fit=crop&w=256&h=256', props: { className: 'rounded-xl object-cover shadow-lg', style: { position: 'absolute', left: '25px', top: '0px', width: '200px', height: '200px' } } },
            'tm2_n': { id: 'tm2_n', type: 'text', name: 'N2', content: 'James K.', props: { className: 'text-lg font-bold text-center mt-4', style: { position: 'absolute', left: '0px', top: '220px', width: '250px', height: '30px' } } },
            'tm2_r': { id: 'tm2_r', type: 'text', name: 'R2', content: 'Developer', props: { className: 'text-sm text-slate-500 text-center', style: { position: 'absolute', left: '0px', top: '250px', width: '250px', height: '20px' } } },
            'tm_3': { id: 'tm_3', type: 'container', name: 'M3', children: ['tm3_i', 'tm3_n', 'tm3_r'], props: { className: 'bg-white', layoutMode: 'canvas', style: { position: 'absolute', left: '800px', top: '150px', width: '250px', height: '350px' } } },
            'tm3_i': { id: 'tm3_i', type: 'image', name: 'A3', src: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?fit=crop&w=256&h=256', props: { className: 'rounded-xl object-cover shadow-lg', style: { position: 'absolute', left: '25px', top: '0px', width: '200px', height: '200px' } } },
            'tm3_n': { id: 'tm3_n', type: 'text', name: 'N3', content: 'Sarah L.', props: { className: 'text-lg font-bold text-center mt-4', style: { position: 'absolute', left: '0px', top: '220px', width: '250px', height: '30px' } } },
            'tm3_r': { id: 'tm3_r', type: 'text', name: 'R3', content: 'Manager', props: { className: 'text-sm text-slate-500 text-center', style: { position: 'absolute', left: '0px', top: '250px', width: '250px', height: '20px' } } },
        }
    },
};
