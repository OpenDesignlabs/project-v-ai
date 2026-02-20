import { motion } from "framer-motion";
import { cn } from "../../lib/utils";
import * as Lucide from "lucide-react";

// --- UPDATED: Accepts Dynamic Props ---
export default function FeatureHover({
    title = "Smart Feature",
    description = "Interactive cards that respond to your cursor.",
    icon = "Sparkles",
    style,
    className
}: any) {
    // Dynamic Icon Resolution
    const Icon = (Lucide as any)[icon] || Lucide.Sparkles;

    return (
        <motion.div
            whileHover={{ y: -5 }}
            transition={{ type: "spring", stiffness: 300 }}
            className={cn(
                "group relative p-8 bg-zinc-900/50 border border-white/10 rounded-2xl overflow-hidden cursor-pointer backdrop-blur-sm",
                className
            )}
            style={style}
        >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-transparent to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="relative z-10 flex flex-col h-full">
                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 text-zinc-300 group-hover:text-blue-400 group-hover:scale-110 transition-all duration-300">
                    <Icon size={24} />
                </div>

                <h3 className="text-xl font-bold text-white mb-3 group-hover:text-blue-200 transition-colors">
                    {title}
                </h3>

                <p className="text-zinc-400 text-sm leading-relaxed group-hover:text-zinc-300 transition-colors">
                    {description}
                </p>
            </div>
        </motion.div>
    );
}

// Keep the old export for backward compatibility
export { FeatureHover };
export function FeaturesSectionWithHoverEffects(props: any) {
    return <FeatureHover {...props} />;
}
