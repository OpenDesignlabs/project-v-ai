import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { cn } from '../../lib/utils';

// --- 1. ACCORDION ---
export const SmartAccordion = ({ items = [], className, activeColor = 'bg-blue-50' }: any) => {
    const [openIndex, setOpenIndex] = useState<number | null>(0);

    const safeItems = items.length > 0 ? items : [
        { title: "Is this responsive?", content: "Yes! This component is built with Tailwind CSS and scales perfectly." },
        { title: "Can I customize it?", content: "Absolutely. You can change colors, fonts, and spacing via the sidebar." },
        { title: "How does it work?", content: "It uses Framer Motion for smooth, jitter-free height animations." }
    ];

    return (
        <div className={cn("w-full flex flex-col gap-2", className)}>
            {safeItems.map((item: any, i: number) => (
                <div key={i} className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                    <button
                        onClick={() => setOpenIndex(openIndex === i ? null : i)}
                        className={cn(
                            "w-full flex items-center justify-between p-4 text-left font-medium transition-colors",
                            openIndex === i ? activeColor : "hover:bg-slate-50"
                        )}
                    >
                        <span className="text-slate-800 text-sm">{item.title}</span>
                        <ChevronDown
                            size={16}
                            className={cn("text-slate-400 transition-transform duration-300", openIndex === i && "rotate-180 text-blue-600")}
                        />
                    </button>
                    <AnimatePresence initial={false}>
                        {openIndex === i && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
                            >
                                <div className="p-4 pt-0 text-sm text-slate-600 leading-relaxed border-t border-transparent">
                                    {item.content}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            ))}
        </div>
    );
};

// --- 2. CAROUSEL ---
export const SmartCarousel = ({ images = [], className }: any) => {
    const [current, setCurrent] = useState(0);

    const safeImages = images.length > 0 ? images : [
        "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?ixlib=rb-4.0.3&auto=format&fit=crop&w=2940&q=80",
        "https://images.unsplash.com/photo-1518173946687-a4c88928d9fd?ixlib=rb-4.0.3&auto=format&fit=crop&w=2940&q=80",
        "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?ixlib=rb-4.0.3&auto=format&fit=crop&w=2940&q=80"
    ];

    const next = (e: any) => { e.stopPropagation(); setCurrent((prev) => (prev + 1) % safeImages.length); };
    const prev = (e: any) => { e.stopPropagation(); setCurrent((prev) => (prev - 1 + safeImages.length) % safeImages.length); };

    return (
        <div className={cn("relative w-full h-64 overflow-hidden rounded-xl group bg-slate-900", className)}>
            <AnimatePresence mode='wait'>
                <motion.img
                    key={current}
                    src={safeImages[current]}
                    initial={{ opacity: 0, scale: 1.1 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5 }}
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                />
            </AnimatePresence>

            {/* Controls */}
            <div className="absolute inset-0 flex items-center justify-between p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={prev} className="p-2 bg-black/50 text-white rounded-full hover:bg-white hover:text-black transition-all backdrop-blur-sm"><ChevronLeft size={20} /></button>
                <button onClick={next} className="p-2 bg-black/50 text-white rounded-full hover:bg-white hover:text-black transition-all backdrop-blur-sm"><ChevronRight size={20} /></button>
            </div>

            {/* Dots */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                {safeImages.map((_: any, idx: number) => (
                    <button
                        key={idx}
                        onClick={(e) => { e.stopPropagation(); setCurrent(idx); }}
                        className={cn("w-2 h-2 rounded-full transition-all", idx === current ? "bg-white w-4" : "bg-white/50 hover:bg-white/80")}
                    />
                ))}
            </div>
        </div>
    );
};

// --- 3. TABLE ---
export const SmartTable = ({ className }: any) => {
    return (
        <div className={cn("w-full overflow-hidden border border-slate-200 rounded-xl bg-white shadow-sm", className)}>
            <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                    <tr>
                        <th className="px-6 py-3">Project</th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3">Price</th>
                        <th className="px-6 py-3 text-right">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {[1, 2, 3].map((row) => (
                        <tr key={row} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4 font-medium text-slate-900">Redesign Landing Page</td>
                            <td className="px-6 py-4">
                                <span className={cn("px-2 py-1 rounded-full text-[10px] font-bold uppercase", row === 2 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700")}>
                                    {row === 2 ? 'Pending' : 'Active'}
                                </span>
                            </td>
                            <td className="px-6 py-4 text-slate-600">$2,400</td>
                            <td className="px-6 py-4 text-right text-blue-600 font-medium cursor-pointer hover:underline">Edit</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
