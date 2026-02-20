// src/data/iconRegistry.ts
import * as Icons from 'lucide-react';

// A curated list of common UI icons
export const ICON_NAMES = [
    'Activity', 'Airplay', 'AlertCircle', 'AlertTriangle', 'AlignCenter', 'AlignJustify', 'AlignLeft', 'AlignRight',
    'Anchor', 'Aperture', 'Archive', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'AtSign', 'Award',
    'BarChart', 'BarChart2', 'Battery', 'BatteryCharging', 'Bell', 'BellOff', 'Bluetooth', 'Bold', 'Book',
    'BookOpen', 'Bookmark', 'Box', 'Briefcase', 'Calendar', 'Camera', 'Cast', 'Check', 'CheckCircle',
    'CheckSquare', 'ChevronDown', 'ChevronLeft', 'ChevronRight', 'ChevronUp', 'ChevronsDown', 'ChevronsUp',
    'Chrome', 'Circle', 'Clipboard', 'Clock', 'Cloud', 'CloudDrizzle', 'CloudLightning', 'CloudOff', 'CloudRain',
    'CloudSnow', 'Code', 'Codepen', 'Codesandbox', 'Coffee', 'Columns', 'Command', 'Compass', 'Copy',
    'CornerDownLeft', 'CornerDownRight', 'Cpu', 'CreditCard', 'Crop', 'Crosshair', 'Database', 'Delete',
    'Disc', 'DollarSign', 'Download', 'DownloadCloud', 'Droplet', 'Edit', 'Edit2', 'Edit3', 'ExternalLink',
    'Eye', 'EyeOff', 'Facebook', 'FastForward', 'Feather', 'Figma', 'File', 'FileMinus', 'FilePlus', 'FileText',
    'Film', 'Filter', 'Flag', 'Folder', 'FolderMinus', 'FolderPlus', 'Framer', 'Frown', 'Gift', 'GitBranch',
    'GitCommit', 'GitMerge', 'GitPullRequest', 'Github', 'Globe', 'Grid', 'HardDrive', 'Hash', 'Headphones',
    'Heart', 'HelpCircle', 'Hexagon', 'Home', 'Image', 'Inbox', 'Info', 'Instagram', 'Italic', 'Key',
    'Layers', 'Layout', 'LifeBuoy', 'Link', 'Link2', 'Linkedin', 'List', 'Loader', 'Lock', 'LogIn', 'LogOut',
    'Mail', 'Map', 'MapPin', 'Maximize', 'Maximize2', 'Meh', 'Menu', 'MessageCircle', 'MessageSquare',
    'Mic', 'MicOff', 'Minimize', 'Minimize2', 'Minus', 'MinusCircle', 'MinusSquare', 'Monitor', 'Moon',
    'MoreHorizontal', 'MoreVertical', 'MousePointer', 'Move', 'Music', 'Navigation', 'Navigation2', 'Octagon',
    'Package', 'Paperclip', 'Pause', 'PauseCircle', 'PenTool', 'Percent', 'Phone', 'PhoneCall', 'PhoneForwarded',
    'PhoneIncoming', 'PhoneMissed', 'PhoneOff', 'PhoneOutgoing', 'PieChart', 'Play', 'PlayCircle', 'Plus',
    'PlusCircle', 'PlusSquare', 'Pocket', 'Power', 'Printer', 'Radio', 'RefreshCcw', 'RefreshCw', 'Repeat',
    'Rewind', 'RotateCcw', 'RotateCw', 'Rss', 'Save', 'Scissors', 'Search', 'Send', 'Server', 'Settings',
    'Share', 'Share2', 'Shield', 'ShieldOff', 'ShoppingBag', 'ShoppingCart', 'Shuffle', 'Sidebar', 'SkipBack',
    'SkipForward', 'Slack', 'Slash', 'Sliders', 'Smartphone', 'Smile', 'Speaker', 'Square', 'Star', 'StopCircle',
    'Sun', 'Sunrise', 'Sunset', 'Tablet', 'Tag', 'Target', 'Terminal', 'Thermometer', 'ThumbsDown', 'ThumbsUp',
    'ToggleLeft', 'ToggleRight', 'Tool', 'Trash', 'Trash2', 'Trello', 'TrendingDown', 'TrendingUp', 'Triangle',
    'Truck', 'Tv', 'Twitch', 'Twitter', 'Type', 'Umbrella', 'Underline', 'Unlock', 'Upload', 'UploadCloud',
    'User', 'UserCheck', 'UserMinus', 'UserPlus', 'UserX', 'Users', 'Video', 'VideoOff', 'Voicemail', 'Volume',
    'Volume1', 'Volume2', 'VolumeX', 'Watch', 'Wifi', 'WifiOff', 'Wind', 'X', 'XCircle', 'XOctagon', 'XSquare',
    'Youtube', 'Zap', 'ZapOff', 'ZoomIn', 'ZoomOut'
];

/**
 * Get an icon component by name dynamically from lucide-react
 */
export const getIconComponent = (name: string) => {
    // @ts-ignore - Dynamic access to Icons
    return Icons[name] || Icons.HelpCircle;
};

/**
 * Get all available icon names
 */
export const getAvailableIconNames = (): string[] => {
    return ICON_NAMES;
};
