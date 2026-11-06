// The page icon library: ~220 line icons (Lucide, ISC licence) for funnel pages, drawn in the page's brand colour
// instead of emoji — emoji look different on every phone and are the first thing that makes a page read as
// AI-made. An icon field holds an icon name ("truck") or, as before, an emoji. With theme.icons = 'line' (new
// AI-built funnels, or switched on in Design) the common emoji are drawn as their matching icon too, and a label
// that starts with one ("🔒 Secure checkout") gets the icon in its place. With 'emoji' (older funnels) emoji stay.
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, Apple, Archive, ArrowRight, ArrowUpRight, Award, Baby, BadgeCheck, BadgePercent, Ban, Banknote, Bath, Bed, Bell, BellRing, Bike, Bird, Book, Bookmark, BookMarked, BookOpen, Bot, Box, Boxes, Brain, Briefcase, Brush, Building2, Bus, Cake, CakeSlice, Calculator, Calendar, CalendarCheck, Camera, Candy, Car, Carrot, Cat, ChartBar, ChartLine, ChartPie, Check, CheckCheck, ChefHat, CircleCheck, CircleHelp, CirclePlay, CircleX, Clapperboard, Clock, Code, Coffee, Coins, Compass, Cookie, Cpu, CreditCard, Crown, CupSoda, Dog, DoorOpen, Download, Droplet, Droplets, Dumbbell, Eye, Factory, Feather, FileCheck, FileText, Film, Fish, Flag, Flame, FlaskConical, Flower, Flower2, Footprints, Frown, Gamepad2, Gavel, Gem, Gift, Glasses, Globe, GraduationCap, Hammer, Hand, HandHeart, Handshake, Headphones, Heart, HeartPulse, Hourglass, House, Image, IndianRupee, Infinity, Info, Key, Lamp, Landmark, Languages, Laptop, Layers, LayoutGrid, Leaf, Library, Lightbulb, LightbulbOff, Link, Lock, Mail, Map, MapPin, Medal, Megaphone, MessageCircle, MessagesSquare, Mic, Microscope, Milk, Monitor, Moon, Mountain, Music, Navigation, Newspaper, NotebookPen, Package, PackageCheck, Palette, PartyPopper, PawPrint, PenLine, Percent, Phone, PhoneCall, PiggyBank, Pill, Pizza, Plane, Play, Puzzle, QrCode, Quote, Radio, Receipt, ReceiptIndianRupee, Recycle, RefreshCw, Repeat, Rocket, RotateCcw, Ruler, Salad, Scale, Scan, School, Scissors, Search, Send, Settings, Shield, ShieldCheck, ShieldPlus, Shirt, ShoppingBag, ShoppingCart, Smartphone, Smile, Snowflake, Sofa, Soup, Sparkle, Sparkles, Speech, Sprout, Star, Stethoscope, Store, Sun, Sunrise, Tag, Tags, Target, ThumbsDown, ThumbsUp, Ticket, Timer, Train, TreePine, TrendingUp, TriangleAlert, Trophy, Truck, Tv, Umbrella, Upload, User, UserCheck, Users, UsersRound, Utensils, Video, Wallet, Watch, Waves, Wheat, Wifi, Wind, Wrench, X, Zap } from 'lucide-react';
const L = { Activity, Apple, Archive, ArrowRight, ArrowUpRight, Award, Baby, BadgeCheck, BadgePercent, Ban, Banknote, Bath, Bed, Bell, BellRing, Bike, Bird, Book, Bookmark, BookMarked, BookOpen, Bot, Box, Boxes, Brain, Briefcase, Brush, Building2, Bus, Cake, CakeSlice, Calculator, Calendar, CalendarCheck, Camera, Candy, Car, Carrot, Cat, ChartBar, ChartLine, ChartPie, Check, CheckCheck, ChefHat, CircleCheck, CircleHelp, CirclePlay, CircleX, Clapperboard, Clock, Code, Coffee, Coins, Compass, Cookie, Cpu, CreditCard, Crown, CupSoda, Dog, DoorOpen, Download, Droplet, Droplets, Dumbbell, Eye, Factory, Feather, FileCheck, FileText, Film, Fish, Flag, Flame, FlaskConical, Flower, Flower2, Footprints, Frown, Gamepad2, Gavel, Gem, Gift, Glasses, Globe, GraduationCap, Hammer, Hand, HandHeart, Handshake, Headphones, Heart, HeartPulse, Hourglass, House, Image, IndianRupee, Infinity, Info, Key, Lamp, Landmark, Languages, Laptop, Layers, LayoutGrid, Leaf, Library, Lightbulb, LightbulbOff, Link, Lock, Mail, Map, MapPin, Medal, Megaphone, MessageCircle, MessagesSquare, Mic, Microscope, Milk, Monitor, Moon, Mountain, Music, Navigation, Newspaper, NotebookPen, Package, PackageCheck, Palette, PartyPopper, PawPrint, PenLine, Percent, Phone, PhoneCall, PiggyBank, Pill, Pizza, Plane, Play, Puzzle, QrCode, Quote, Radio, Receipt, ReceiptIndianRupee, Recycle, RefreshCw, Repeat, Rocket, RotateCcw, Ruler, Salad, Scale, Scan, School, Scissors, Search, Send, Settings, Shield, ShieldCheck, ShieldPlus, Shirt, ShoppingBag, ShoppingCart, Smartphone, Smile, Snowflake, Sofa, Soup, Sparkle, Sparkles, Speech, Sprout, Star, Stethoscope, Store, Sun, Sunrise, Tag, Tags, Target, ThumbsDown, ThumbsUp, Ticket, Timer, Train, TreePine, TrendingUp, TriangleAlert, Trophy, Truck, Tv, Umbrella, Upload, User, UserCheck, Users, UsersRound, Utensils, Video, Wallet, Watch, Waves, Wheat, Wifi, Wind, Wrench, X, Zap };

// name → [icon, words people search with]
const DEF = {
  truck: ['Truck', 'delivery shipping courier'], package: ['Package', 'parcel box product order'], 'package-check': ['PackageCheck', 'delivered order'],
  'shield-check': ['ShieldCheck', 'secure safe guarantee trust'], shield: ['Shield', 'secure protect'], lock: ['Lock', 'secure payment private'],
  'badge-check': ['BadgeCheck', 'verified certified quality'], 'badge-percent': ['BadgePercent', 'discount offer sale'], gift: ['Gift', 'bonus free present'],
  clock: ['Clock', 'time hours'], timer: ['Timer', 'countdown fast'], hourglass: ['Hourglass', 'deadline limited'], calendar: ['Calendar', 'date schedule'],
  'calendar-check': ['CalendarCheck', 'booking appointment'], star: ['Star', 'rating review favourite'], heart: ['Heart', 'love care'],
  sparkles: ['Sparkles', 'magic new premium'], sparkle: ['Sparkle', 'shine new'], zap: ['Zap', 'fast instant energy'], flame: ['Flame', 'hot trending'],
  rocket: ['Rocket', 'launch growth fast'], target: ['Target', 'goal aim result'], trophy: ['Trophy', 'win success'], award: ['Award', 'certified best'],
  medal: ['Medal', 'winner top'], crown: ['Crown', 'premium vip best'], gem: ['Gem', 'premium luxury value'], 'circle-check': ['CircleCheck', 'done included yes'],
  check: ['Check', 'tick included'], 'check-check': ['CheckCheck', 'done verified'], x: ['X', 'no not'], 'circle-x': ['CircleX', 'no wrong problem'],
  'triangle-alert': ['TriangleAlert', 'warning problem risk'], info: ['Info', 'information'], 'circle-help': ['CircleHelp', 'question faq help'],
  'message-circle': ['MessageCircle', 'chat whatsapp support'], 'messages-square': ['MessagesSquare', 'community chat discussion'], phone: ['Phone', 'call contact'],
  'phone-call': ['PhoneCall', 'call support'], mail: ['Mail', 'email inbox'], send: ['Send', 'message share'], smartphone: ['Smartphone', 'mobile phone app'],
  laptop: ['Laptop', 'online computer work'], monitor: ['Monitor', 'screen desktop'], wifi: ['Wifi', 'online internet'], video: ['Video', 'class lesson recording'],
  play: ['Play', 'watch start'], 'circle-play': ['CirclePlay', 'watch video'], headphones: ['Headphones', 'audio listen audiobook'], mic: ['Mic', 'podcast voice audio'],
  music: ['Music', 'song audio'], 'book-open': ['BookOpen', 'read ebook learn chapter'], book: ['Book', 'ebook guide'], 'book-marked': ['BookMarked', 'chapter guide'],
  library: ['Library', 'books course collection'], 'graduation-cap': ['GraduationCap', 'course learn student certificate'], school: ['School', 'class education'],
  'pen-line': ['PenLine', 'write edit'], 'notebook-pen': ['NotebookPen', 'worksheet notes'], 'file-text': ['FileText', 'pdf document notes'],
  'file-check': ['FileCheck', 'certificate document'], download: ['Download', 'get save'], upload: ['Upload', 'send'], users: ['Users', 'community people group'],
  user: ['User', 'person profile'], 'user-check': ['UserCheck', 'member verified'], 'users-round': ['UsersRound', 'community team'], baby: ['Baby', 'kids child'],
  'hand-heart': ['HandHeart', 'care support'], handshake: ['Handshake', 'trust deal partner'], 'thumbs-up': ['ThumbsUp', 'like approve'], smile: ['Smile', 'happy'],
  leaf: ['Leaf', 'natural organic herbal'], sprout: ['Sprout', 'growth plant'], 'flower-2': ['Flower2', 'beauty floral'], flower: ['Flower', 'floral'],
  'tree-pine': ['TreePine', 'nature'], sun: ['Sun', 'morning day'], moon: ['Moon', 'night sleep'], droplet: ['Droplet', 'water oil ghee'], droplets: ['Droplets', 'water serum'],
  wind: ['Wind', 'air breath'], mountain: ['Mountain', 'travel trek'], waves: ['Waves', 'sea calm'], house: ['House', 'home'], store: ['Store', 'shop dukaan kirana'],
  'shopping-bag': ['ShoppingBag', 'buy order shop'], 'shopping-cart': ['ShoppingCart', 'cart buy'], 'credit-card': ['CreditCard', 'card payment'], wallet: ['Wallet', 'payment upi money'],
  'indian-rupee': ['IndianRupee', 'rupee price money'], banknote: ['Banknote', 'cash money cod'], coins: ['Coins', 'money savings'], 'piggy-bank': ['PiggyBank', 'savings'],
  receipt: ['Receipt', 'bill invoice'], 'receipt-indian-rupee': ['ReceiptIndianRupee', 'gst invoice bill'], percent: ['Percent', 'discount off'], tag: ['Tag', 'price label'],
  tags: ['Tags', 'offers'], 'trending-up': ['TrendingUp', 'growth profit sales'], 'chart-line': ['ChartLine', 'growth results'], 'chart-bar': ['ChartBar', 'results stats'],
  'chart-pie': ['ChartPie', 'share analysis'], calculator: ['Calculator', 'maths profit'], briefcase: ['Briefcase', 'business work career'],
  'building-2': ['Building2', 'company office'], factory: ['Factory', 'manufacturing'], wrench: ['Wrench', 'repair service'], settings: ['Settings', 'setup'],
  scissors: ['Scissors', 'salon cut tailoring'], brush: ['Brush', 'makeup paint'], palette: ['Palette', 'design colours art'], camera: ['Camera', 'photo shoot'],
  image: ['Image', 'photo picture'], utensils: ['Utensils', 'food meal restaurant'], 'chef-hat': ['ChefHat', 'cooking chef recipe'], coffee: ['Coffee', 'chai tea cafe'],
  'cup-soda': ['CupSoda', 'drink'], cookie: ['Cookie', 'snack biscuit'], cake: ['Cake', 'birthday bakery'], 'cake-slice': ['CakeSlice', 'bakery dessert mithai'],
  pizza: ['Pizza', 'food'], apple: ['Apple', 'fruit healthy'], carrot: ['Carrot', 'vegetable healthy'], salad: ['Salad', 'diet healthy'], soup: ['Soup', 'food meal'],
  wheat: ['Wheat', 'grain atta farm'], milk: ['Milk', 'dairy ghee'], dumbbell: ['Dumbbell', 'gym fitness'], bike: ['Bike', 'cycle fitness'], footprints: ['Footprints', 'steps walk'],
  activity: ['Activity', 'yoga health fitness'], 'heart-pulse': ['HeartPulse', 'health wellness'], stethoscope: ['Stethoscope', 'doctor medical'], pill: ['Pill', 'medicine supplement'],
  brain: ['Brain', 'mind psychology learning'], eye: ['Eye', 'see vision preview'], hand: ['Hand', 'touch'], shirt: ['Shirt', 'clothing fashion'], watch: ['Watch', 'time accessory'],
  glasses: ['Glasses', 'read'], car: ['Car', 'drive'], bus: ['Bus', 'travel'], plane: ['Plane', 'travel flight'], train: ['Train', 'travel'], 'map-pin': ['MapPin', 'location city'],
  map: ['Map', 'route'], globe: ['Globe', 'worldwide online india'], navigation: ['Navigation', 'direction'], compass: ['Compass', 'guide'], key: ['Key', 'access'],
  'door-open': ['DoorOpen', 'welcome entry'], bed: ['Bed', 'sleep stay'], sofa: ['Sofa', 'furniture home'], lamp: ['Lamp', 'diya light diwali'], bath: ['Bath', 'bathroom'],
  hammer: ['Hammer', 'build'], ruler: ['Ruler', 'measure size'], lightbulb: ['Lightbulb', 'idea tip'], puzzle: ['Puzzle', 'solution'], layers: ['Layers', 'modules parts'],
  'layout-grid': ['LayoutGrid', 'templates'], boxes: ['Boxes', 'stock inventory'], box: ['Box', 'pack'], archive: ['Archive', 'store'], recycle: ['Recycle', 'eco'],
  'refresh-cw': ['RefreshCw', 'renew update'], 'rotate-ccw': ['RotateCcw', 'refund return'], repeat: ['Repeat', 'again subscription'], 'arrow-right': ['ArrowRight', 'next go'],
  'arrow-up-right': ['ArrowUpRight', 'growth link'], infinity: ['Infinity', 'lifetime unlimited'], megaphone: ['Megaphone', 'announce marketing ads'], bell: ['Bell', 'reminder notification'],
  'bell-ring': ['BellRing', 'alert reminder'], newspaper: ['Newspaper', 'news blog'], bookmark: ['Bookmark', 'save'], quote: ['Quote', 'testimonial'], feather: ['Feather', 'light write'],
  clapperboard: ['Clapperboard', 'film reel'], film: ['Film', 'movie'], tv: ['Tv', 'watch show'], radio: ['Radio', 'broadcast'], 'gamepad-2': ['Gamepad2', 'game fun'],
  dog: ['Dog', 'pet'], cat: ['Cat', 'pet'], 'paw-print': ['PawPrint', 'pet'], fish: ['Fish', 'food'], bird: ['Bird', 'free'], 'shield-plus': ['ShieldPlus', 'health insurance'],
  scale: ['Scale', 'legal fair'], gavel: ['Gavel', 'law'], landmark: ['Landmark', 'bank government'], flag: ['Flag', 'india goal'], languages: ['Languages', 'hindi english translate'],
  ticket: ['Ticket', 'event entry'], 'party-popper': ['PartyPopper', 'celebrate festival'], candy: ['Candy', 'sweets mithai'], scan: ['Scan', 'qr'], 'qr-code': ['QrCode', 'upi scan pay'],
  link: ['Link', 'url'], sunrise: ['Sunrise', 'morning'], snowflake: ['Snowflake', 'cool winter'], umbrella: ['Umbrella', 'protection'], 'flask-conical': ['FlaskConical', 'lab science'],
  microscope: ['Microscope', 'research'], code: ['Code', 'developer'], cpu: ['Cpu', 'tech'], bot: ['Bot', 'ai automation'], speech: ['Speech', 'talk speak'], search: ['Search', 'find'],
  'lightbulb-off': ['LightbulbOff', 'confused problem'], frown: ['Frown', 'sad problem'], 'thumbs-down': ['ThumbsDown', 'bad'], ban: ['Ban', 'no stop'],
};
export const PAGE_ICONS = Object.fromEntries(Object.entries(DEF).filter(([, [c]]) => L[c]).map(([k, [c, words]]) => [k, { C: L[c], words }]));
export const ICON_NAMES = Object.keys(PAGE_ICONS);

// emoji → the icon that says the same thing (the common ones in templates and AI copy)
const E2I = {
  '🚚': 'truck', '📦': 'package', '🔒': 'lock', '🔐': 'lock', '🛡': 'shield-check', '✅': 'circle-check', '✔': 'check', '✓': 'check', '☑': 'circle-check', '⭐': 'star', '🌟': 'sparkles',
  '✨': 'sparkles', '🔥': 'flame', '⚡': 'zap', '🚀': 'rocket', '🎯': 'target', '🏆': 'trophy', '🥇': 'medal', '🏅': 'award', '👑': 'crown', '💎': 'gem', '🎁': 'gift',
  '⏳': 'hourglass', '⌛': 'hourglass', '⏰': 'clock', '🕒': 'clock', '🕐': 'clock', '⏱': 'timer', '📅': 'calendar', '🗓': 'calendar', '📆': 'calendar', '💬': 'message-circle',
  '🗨': 'message-circle', '📞': 'phone', '☎': 'phone', '📱': 'smartphone', '📲': 'smartphone', '💻': 'laptop', '🖥': 'monitor', '📧': 'mail', '✉': 'mail', '📩': 'mail', '📨': 'mail',
  '🎥': 'video', '📹': 'video', '▶': 'play', '🎧': 'headphones', '🎙': 'mic', '🎤': 'mic', '🎵': 'music', '🎶': 'music', '📚': 'library', '📖': 'book-open', '📘': 'book', '📕': 'book',
  '📗': 'book', '📙': 'book', '🎓': 'graduation-cap', '✏': 'pen-line', '✍': 'pen-line', '📝': 'notebook-pen', '📄': 'file-text', '📃': 'file-text', '📑': 'file-text', '📥': 'download',
  '👥': 'users', '👤': 'user', '🤝': 'handshake', '👍': 'thumbs-up', '😊': 'smile', '🙂': 'smile', '😃': 'smile', '🌿': 'leaf', '🍃': 'leaf', '🌱': 'sprout', '🪴': 'sprout', '🌸': 'flower-2',
  '🌺': 'flower-2', '🌼': 'flower', '🌳': 'tree-pine', '🌲': 'tree-pine', '☀': 'sun', '🌞': 'sun', '🌙': 'moon', '💧': 'droplet', '🧴': 'droplets', '🏠': 'house', '🏡': 'house', '🏪': 'store',
  '🛍': 'shopping-bag', '🛒': 'shopping-cart', '💳': 'credit-card', '👛': 'wallet', '💰': 'coins', '🪙': 'coins', '💵': 'banknote', '💸': 'banknote', '🧾': 'receipt-indian-rupee', '🏷': 'tag',
  '📈': 'trending-up', '📊': 'chart-bar', '📉': 'chart-line', '🧮': 'calculator', '💼': 'briefcase', '🏢': 'building-2', '🏭': 'factory', '🔧': 'wrench', '🧰': 'wrench', '⚙': 'settings',
  '✂': 'scissors', '💇': 'scissors', '🎨': 'palette', '💄': 'brush', '💅': 'brush', '📷': 'camera', '📸': 'camera', '🖼': 'image', '🍽': 'utensils', '🍴': 'utensils', '👨‍🍳': 'chef-hat',
  '👩‍🍳': 'chef-hat', '☕': 'coffee', '🍵': 'coffee', '🥤': 'cup-soda', '🍪': 'cookie', '🎂': 'cake', '🍰': 'cake-slice', '🧁': 'cake-slice', '🍕': 'pizza', '🍎': 'apple', '🥕': 'carrot',
  '🥗': 'salad', '🍲': 'soup', '🌾': 'wheat', '🥛': 'milk', '🧈': 'milk', '💪': 'dumbbell', '🏋': 'dumbbell', '🚴': 'bike', '👣': 'footprints', '🧘': 'activity', '🏃': 'activity',
  '❤': 'heart', '💖': 'heart', '💗': 'heart', '💚': 'heart', '💛': 'heart', '🧡': 'heart', '💜': 'heart', '🩺': 'stethoscope', '💊': 'pill', '🧠': 'brain', '👁': 'eye', '👀': 'eye',
  '👕': 'shirt', '👗': 'shirt', '⌚': 'watch', '👓': 'glasses', '🚗': 'car', '🚌': 'bus', '✈': 'plane', '🚆': 'train', '📍': 'map-pin', '🗺': 'map', '🌍': 'globe', '🌏': 'globe', '🌎': 'globe',
  '🌐': 'globe', '🧭': 'compass', '🔑': 'key', '🚪': 'door-open', '🛏': 'bed', '🛋': 'sofa', '🪔': 'lamp', '🛁': 'bath', '🚿': 'bath', '🔨': 'hammer', '📏': 'ruler', '📐': 'ruler',
  '💡': 'lightbulb', '🧩': 'puzzle', '♻': 'recycle', '🔄': 'refresh-cw', '🔁': 'repeat', '↩': 'rotate-ccw', '➡': 'arrow-right', '👉': 'arrow-right', '♾': 'infinity', '📣': 'megaphone',
  '📢': 'megaphone', '🔔': 'bell', '📰': 'newspaper', '🔖': 'bookmark', '🎬': 'clapperboard', '🎞': 'film', '📺': 'tv', '📻': 'radio', '🎮': 'gamepad-2', '🐶': 'dog', '🐕': 'dog',
  '🐱': 'cat', '🐾': 'paw-print', '🐟': 'fish', '⚖': 'scale', '🏛': 'landmark', '🏦': 'landmark', '🚩': 'flag', '🇮🇳': 'flag', '🎫': 'ticket', '🎟': 'ticket', '🎉': 'party-popper',
  '🎊': 'party-popper', '🍬': 'candy', '🍭': 'candy', '🔍': 'search', '🔎': 'search', '🔗': 'link', '⚠': 'triangle-alert', '❌': 'circle-x', '✖': 'x', '❓': 'circle-help', '❔': 'circle-help',
  'ℹ': 'info', '💯': 'badge-check', '🆓': 'gift', '🌅': 'sunrise', '❄': 'snowflake', '☂': 'umbrella', '🧪': 'flask-conical', '🔬': 'microscope', '🤖': 'bot', '🗣': 'speech', '👶': 'baby',
  '😞': 'frown', '😟': 'frown', '😩': 'frown', '😓': 'frown', '👎': 'thumbs-down', '🚫': 'ban', '⛔': 'ban', '💔': 'frown',
};
const clean = (s) => String(s ?? '').replace(/[︎️]/g, '').trim();
// an icon field's value → an icon name, or null (then it's shown as text/emoji)
export function iconName(v, line = true) {
  const s = clean(v).toLowerCase();
  if (PAGE_ICONS[s]) return s;
  return line ? E2I[clean(v)] || null : null;
}
// a label that starts with an emoji the library has → { name, rest }
const LEAD = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[✓✔])(?:️|‍(?:\p{Extended_Pictographic}))*(?:\p{Regional_Indicator})?)\s*/u;
export function splitLead(text) {
  if (typeof text !== 'string') return null;
  const m = LEAD.exec(text);
  if (!m) return null;
  const name = E2I[clean(m[1])];
  return name ? { name, emoji: m[1], rest: text.slice(m[0].length) } : null;
}

export function PageIcon({ name, size, className = '' }) {
  const I = PAGE_ICONS[name]?.C;
  if (!I) return null;
  return <I className={`pi ${className}`} size={size || '1em'} strokeWidth={1.8} aria-hidden="true" focusable="false" />;
}

// the editor's icon picker: search by meaning ("delivery", "refund", "chai"), click to use; emoji still allowed
export function IconPicker({ value, onPick, onClose }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const w = q.trim().toLowerCase();
    return ICON_NAMES.filter((k) => !w || k.includes(w) || PAGE_ICONS[k].words.includes(w));
  }, [q]);
  const [emoji, setEmoji] = useState('');
  // on top of everything (a section's card would clip it, and the editor canvas may be scaled)
  return createPortal(
    <div className="ip-shade" onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }} onClick={(e) => e.stopPropagation()}>
    <div className="ip-pop" role="dialog" aria-label="Choose an icon" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
      <div className="ip-head"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search icons — delivery, refund, book, chai…" aria-label="Search icons" /><button type="button" onClick={onClose} aria-label="Close">✕</button></div>
      <div className="ip-grid">{list.map((k) => <button type="button" key={k} title={k} className={iconName(value) === k ? 'on' : ''} onClick={() => onPick(k)}><PageIcon name={k} /></button>)}{!list.length && <small>No icon for “{q}” — try another word</small>}</div>
      <div className="ip-foot"><input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="…or type an emoji" aria-label="Emoji" maxLength={8} /><button type="button" disabled={!emoji.trim()} onClick={() => onPick(emoji.trim())}>Use</button></div>
    </div>
    </div>,
    document.body,
  );
}
