// Editor icons for sections, elements and steps (Lucide, ISC licence) — one consistent line style.
import {
  LayoutGrid, LayoutTemplate, Type, Image, Images, SquarePlay, ChartNoAxesColumn, Megaphone, UnfoldVertical, Minus, CodeXml,
  CircleAlert, Sparkles, ListOrdered, Scale, MessageSquareQuote, UserRoundCheck, Gift, ShieldCheck, CircleHelp, Tag, Mail,
  ClipboardList, CreditCard, CircleArrowUp, CircleArrowDown, ShoppingBag, PartyPopper, PanelTop, Timer, Eye, Package, BellRing, DoorOpen,
  Pin, MessageCircle, Heading, Pilcrow, MousePointerClick, ListChecks, IndianRupee, House, FileText, Presentation, Box,
} from 'lucide-react';

const BLOCKS = {
  section: LayoutGrid, hero: LayoutTemplate, text: Type, image: Image, gallery: Images, video: SquarePlay, stats: ChartNoAxesColumn,
  cta: Megaphone, spacer: UnfoldVertical, divider: Minus, html: CodeXml, problem: CircleAlert, features: Sparkles, steps: ListOrdered,
  compare: Scale, testimonials: MessageSquareQuote, mentor: UserRoundCheck, bonuses: Gift, guarantee: ShieldCheck, faq: CircleHelp,
  pricing: Tag, optin: Mail, form: ClipboardList, checkout: CreditCard, offer: CircleArrowUp, crosssell: ShoppingBag, thankyou: PartyPopper,
  hellobar: PanelTop, countdown: Timer, livecount: Eye, stock: Package, proof: BellRing, exitpopup: DoorOpen, stickybar: Pin, whatsapp: MessageCircle,
};
const ELEMENTS = { heading: Heading, text: Pilcrow, button: MousePointerClick, image: Image, list: ListChecks, price: IndianRupee, video: SquarePlay, spacer: UnfoldVertical, divider: Minus };
const STEPS = { landing: House, optin: FileText, sales: Presentation, checkout: CreditCard, upsell: CircleArrowUp, downsell: CircleArrowDown, thankyou: PartyPopper };

const make = (map) => function TypeIcon({ type, size = 16, className = '' }) {
  const C = map[type] || Box;
  return <C size={size} strokeWidth={1.75} className={`ti ${className}`} aria-hidden="true" />;
};
export const BlockIcon = make(BLOCKS);
export const ElementIcon = make(ELEMENTS);
export const StepIcon = make(STEPS);
