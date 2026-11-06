// Studio edit recipes: one-click "industry edit templates" for Reels. A recipe is the whole edit decided up front for a
// kind of business: which hook and structure the script uses (standard.js HOOKS / STRUCTURES), how fast it cuts, the
// caption look, transitions, on-screen overlays (price tag, location pin, counters), the colour grade, the music mood,
// sound effects and the call to action. The seller picks "Walkthrough tour" and gets a Reel edited the way the best
// real-estate Reels are edited, without knowing what a speed ramp is.
// Built from the per-industry research (docs/studio-research/group-a.md, group-b.md) and well-known Indian Reel
// formats. Pure data: nothing here spends credits or touches the database.
// Industries with rules about claims (health, money, visas, lab tests) never get hype calls to action: no "guaranteed",
// no "hurry", and the script writer is told not to promise results.
import { HOOKS, STRUCTURES } from './standard.js';

export const GRADES = Object.freeze(['natural', 'cinematic', 'matte', 'warm_luxe', 'clean_bright', 'moody', 'food_pop']);
export const TRANSITIONS = Object.freeze(['whip', 'zoom', 'cut', 'dissolve', 'cinematic', 'mixed']);
export const OVERLAY_TYPES = Object.freeze(['price', 'counter', 'pin', 'lowerThird', 'progress', 'badge']);
export const OVERLAY_FROM = Object.freeze(['offer', 'price', 'location', 'business', 'stat', 'deadline', 'name']);
export const OVERLAY_AT = Object.freeze(['hook', 'middle', 'end']);
export const SFX_KINDS = Object.freeze(['whoosh', 'riser', 'pop', 'impact']);
export const CAPTION_STYLES = Object.freeze(['pop', 'lower', 'karaoke', 'minimal', 'matte', 'punch', 'strip']);
export const PUNCH = Object.freeze(['emphasis', 'time', 'off']);
export const SPLITS = Object.freeze(['before_after', 'side_by_side']);
export const CTA_CHANNELS = Object.freeze(['whatsapp', 'call', 'visit', 'dm', 'link', 'book']);
export const LENGTHS = Object.freeze([15, 30, 45]);
// health, money, visas and lab tests: calm calls to action, no promised results (see recipePrompt)
export const CAREFUL_INDUSTRIES = Object.freeze(['clinic', 'finance', 'loans', 'abroad', 'lab']);

const freeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && freeze(v)); return Object.freeze(o); };
// what most recipes share, so each one below only says what makes it different
const BASE = { seconds: 30, transitions: 'cut', overlays: [], grade: 'natural', sfx: [], beatSync: false, speedRamp: false, broll: true, split: null };
const r = (industry, slug, name, about, o) => ({
  id: `${industry}-${slug}`, industry, name, about, ...BASE, ...o,
  pace: { cutEvery: 2.5, jumpCut: false, punch: 'emphasis', ...o.pace },
  captions: { style: 'pop', keywords: 'auto', ...o.captions },
});
// overlay shorthand: ov('price', 'price', 'hook')
const ov = (type, from, at) => (at ? { type, from, at } : { type, from });

const LIST = [
  // ---------- Coach & creator ----------
  r('general', 'listicle', '3-point listicle', 'You on camera counting through three quick points, each with a big number on screen.', {
    hook: 'number_list', structure: 'aida', seconds: 30, pace: { cutEvery: 2.5, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'zoom',
    overlays: [ov('progress', 'stat', 'middle'), ov('lowerThird', 'name', 'hook')], grade: 'natural',
    music: 'Light lo-fi beat, mid tempo, kept low under the voice', sfx: ['whoosh', 'pop'],
    cta: { text: 'Comment “GUIDE” for the full list', channel: 'dm' },
    brief: 'Face in frame from the first word, no intro; “3 mistakes…” style hook; one short B-roll insert per point.' }),
  r('general', 'story', 'Story to lesson', 'A short personal story that turns into one useful lesson.', {
    hook: 'curiosity', structure: 'founder', seconds: 45, pace: { cutEvery: 3, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'cut',
    overlays: [ov('lowerThird', 'name', 'hook')], grade: 'cinematic',
    music: 'Soft piano with a slow build, emotional but not sad', sfx: ['riser'],
    cta: { text: 'Follow for more', channel: 'link' },
    brief: 'Open mid-story (“I almost quit in 2021…”), cut away to two or three B-roll moments, land the lesson in one line.' }),
  r('general', 'myth', 'Myth vs fact', 'A common belief on screen, crossed out, then the truth in one line.', {
    hook: 'pattern_interrupt', structure: 'pas', seconds: 15, pace: { cutEvery: 2, jumpCut: true, punch: 'emphasis' }, captions: { style: 'punch' }, transitions: 'whip',
    overlays: [ov('badge', 'stat', 'middle')], grade: 'natural',
    music: 'Punchy modern beat, fast tempo', sfx: ['impact', 'whoosh'],
    cta: { text: 'Save this for later', channel: 'link' },
    brief: 'First frame says the myth in big text; hard cut to you saying “Wrong.”; two quick reasons; end on the fact.' }),

  // ---------- Real estate ----------
  r('realestate', 'walkthrough', 'Walkthrough tour', 'A drone shot of the building, then quick cuts room by room with the price and location on screen.', {
    hook: 'pattern_interrupt', structure: 'aida', seconds: 30, pace: { cutEvery: 2.5, punch: 'time' }, captions: { style: 'lower' }, transitions: 'cinematic',
    overlays: [ov('price', 'price', 'hook'), ov('pin', 'location', 'middle')], grade: 'warm_luxe',
    music: 'Ambient cinematic bed with soft risers, slow to mid tempo', sfx: ['whoosh', 'riser'], speedRamp: true,
    cta: { text: 'Book a site visit', channel: 'whatsapp' },
    brief: 'Drone or exterior hook with the price on screen; door-open walk-in; fast room cuts (living, kitchen, bedroom, balcony view); detail close-ups.' }),
  r('realestate', 'reasons', '3 reasons to buy here', 'Three reasons the locality is worth it, over a map pin and site shots.', {
    hook: 'number_list', structure: 'aida', seconds: 30, pace: { cutEvery: 2.5, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'zoom',
    overlays: [ov('pin', 'location', 'hook'), ov('counter', 'stat', 'middle'), ov('price', 'price', 'end')], grade: 'clean_bright',
    music: 'Upbeat corporate pop, mid tempo', sfx: ['pop', 'whoosh'],
    cta: { text: 'WhatsApp for the price list', channel: 'whatsapp' },
    brief: 'Open on the locality name and pin; reason 1 connectivity, 2 schools/offices nearby, 3 price trend; show the project last.' }),
  r('realestate', 'progress', 'Construction progress', 'Construction footage over months sped up to the finished home.', {
    hook: 'before_after', structure: 'demo', seconds: 30, pace: { cutEvery: 2 }, captions: { style: 'minimal' }, transitions: 'dissolve',
    overlays: [ov('progress', 'stat', 'middle'), ov('badge', 'deadline', 'end')], grade: 'natural',
    music: 'Steady building beat, driving and hopeful', sfx: ['riser', 'impact'], speedRamp: true, split: 'before_after',
    cta: { text: 'Visit the site this weekend', channel: 'visit' },
    brief: 'Bare plot first, then month-by-month time-lapse, end on the ready tower or show flat; possession date on screen.' }),

  // ---------- Clinic & healthcare (careful) ----------
  r('clinic', 'myth', 'Doctor myth vs fact', 'The doctor clears up one common myth, calmly, with a simple diagram.', {
    hook: 'question', structure: 'pas', seconds: 30, pace: { cutEvery: 3, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'cut',
    overlays: [ov('lowerThird', 'name', 'hook')], grade: 'clean_bright',
    music: 'Light calm bed, soft and slow', sfx: [],
    cta: { text: 'Book a consultation', channel: 'book' },
    brief: 'Doctor in the clinic asks the myth as a question; myth in red, fact in green; one diagram insert; no promises of cure.' }),
  r('clinic', 'explainer', 'Patient explainer', 'What happens in a common treatment, step by step, so patients feel at ease.', {
    hook: 'number_list', structure: 'demo', seconds: 45, pace: { cutEvery: 3.5, jumpCut: true }, captions: { style: 'lower' }, transitions: 'dissolve',
    overlays: [ov('progress', 'stat', 'middle'), ov('lowerThird', 'business', 'end')], grade: 'clean_bright',
    music: 'Gentle acoustic, slow tempo', sfx: [],
    cta: { text: 'Call to ask a question', channel: 'call' },
    brief: 'Walk through the steps (“3 things that happen at your first visit”) with calm clinic B-roll; equipment close-ups; no before/after claims.' }),
  r('clinic', 'tour', 'Clinic tour', 'A welcoming walk through the reception, rooms and equipment with the doctor.', {
    hook: 'pov', structure: 'aida', seconds: 30, pace: { cutEvery: 2.5 }, captions: { style: 'minimal' }, transitions: 'dissolve',
    overlays: [ov('pin', 'location', 'middle'), ov('lowerThird', 'name', 'end')], grade: 'clean_bright',
    music: 'Soft warm acoustic, mid tempo', sfx: ['whoosh'],
    cta: { text: 'Book an appointment', channel: 'book' },
    brief: '“POV: your first visit” walking in the door; reception, waiting area, consultation room, equipment; doctor greets the camera.' }),

  // ---------- Consultant / agency / B2B ----------
  r('consultant', 'result', 'Result first', 'The client result on screen first, then how it was done.', {
    hook: 'bold_claim', structure: 'pas', seconds: 30, pace: { cutEvery: 2.5, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'zoom',
    overlays: [ov('counter', 'stat', 'hook'), ov('lowerThird', 'name', 'middle')], grade: 'clean_bright',
    music: 'Minimal modern electronic, mid tempo', sfx: ['pop', 'whoosh'],
    cta: { text: 'Book a free call', channel: 'book' },
    brief: 'Open on the number (“Saved 12 hours a week”); screen recording or whiteboard with zoom-ins; you explaining the fix.' }),
  r('consultant', 'casestudy', 'Case study', 'Before and after numbers from one real client, side by side.', {
    hook: 'before_after', structure: 'ugc', seconds: 45, pace: { cutEvery: 3, jumpCut: true }, captions: { style: 'lower' }, transitions: 'cut',
    overlays: [ov('counter', 'stat', 'middle'), ov('badge', 'business', 'end')], grade: 'clean_bright',
    music: 'Confident corporate beat, mid tempo', sfx: ['riser'], split: 'side_by_side',
    cta: { text: 'DM “AUDIT” for a free review', channel: 'dm' },
    brief: 'Before metrics on the left, after on the right; the client or you telling what changed; dashboard close-ups.' }),
  r('consultant', 'hottake', 'Hot take', 'One strong opinion about your field, said straight to camera.', {
    hook: 'pattern_interrupt', structure: 'founder', seconds: 15, pace: { cutEvery: 2, jumpCut: true }, captions: { style: 'punch' }, transitions: 'cut',
    overlays: [ov('lowerThird', 'name', 'hook')], grade: 'moody',
    music: 'Dark minimal beat, mid tempo', sfx: ['impact'], broll: false,
    cta: { text: 'Follow for more', channel: 'link' },
    brief: 'Close-up, first line is the unpopular opinion; two reasons; no B-roll, just tight punch-ins.' }),

  // ---------- Coaching institute ----------
  r('education', 'topper', 'Topper story', 'A topper shares their rank and the one thing that helped.', {
    hook: 'social_proof', structure: 'ugc', seconds: 30, pace: { cutEvery: 2.5, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'zoom',
    overlays: [ov('badge', 'stat', 'hook'), ov('lowerThird', 'name', 'middle')], grade: 'natural',
    music: 'Upbeat inspiring pop, mid-fast tempo', sfx: ['impact', 'pop'],
    cta: { text: 'Join the next batch', channel: 'link' },
    brief: 'Rank or score huge on screen in the first second; topper on camera; classroom and celebration B-roll.' }),
  r('education', 'trick', 'Solve it in 10 seconds', 'A teacher solves a hard question with a smart trick.', {
    hook: 'curiosity', structure: 'demo', seconds: 30, pace: { cutEvery: 2.5, jumpCut: true }, captions: { style: 'pop' }, transitions: 'cut',
    overlays: [ov('counter', 'stat', 'middle')], grade: 'clean_bright',
    music: 'Quirky ticking beat, mid tempo', sfx: ['pop'], broll: false,
    cta: { text: 'Book a free demo class', channel: 'book' },
    brief: 'Question on the board first frame; “most students take 2 minutes”; teacher solves it fast with a timer counting.' }),
  r('education', 'admissions', 'Admissions countdown', 'Batch start date, seats left and what students get.', {
    hook: 'number_list', structure: 'offer_first', seconds: 15, pace: { cutEvery: 2 }, captions: { style: 'punch' }, transitions: 'whip',
    overlays: [ov('badge', 'deadline', 'hook'), ov('price', 'offer', 'end')], grade: 'clean_bright',
    music: 'Energetic pop beat, fast tempo', sfx: ['whoosh', 'impact'], beatSync: true,
    cta: { text: 'Reserve your seat', channel: 'whatsapp' },
    brief: 'Batch date and seats left up front; quick cuts of classroom, faculty, study material; fee offer at the end.' }),

  // ---------- Gym, salon & spa ----------
  r('fitness', 'transformation', 'Transformation reveal', 'Day 1 next to Day 90, then the journey in quick cuts.', {
    hook: 'before_after', structure: 'ugc', seconds: 30, pace: { cutEvery: 1.5 }, captions: { style: 'punch' }, transitions: 'whip',
    overlays: [ov('counter', 'stat', 'middle'), ov('price', 'offer', 'end')], grade: 'moody',
    music: 'High-energy workout beat, fast tempo, heavy drop', sfx: ['impact', 'whoosh'], beatSync: true, speedRamp: true, split: 'before_after',
    cta: { text: 'Book a free trial', channel: 'whatsapp' },
    brief: 'Split screen Day 1 vs Day 90 in the first frame; beat-cut training clips; member says one line at the end.' }),
  r('fitness', 'asmr', 'Salon ASMR', 'Slow close-ups of a treatment with the real sounds: snips, sprays, brushes.', {
    hook: 'pattern_interrupt', structure: 'demo', seconds: 30, pace: { cutEvery: 3.5 }, captions: { style: 'minimal' }, transitions: 'dissolve',
    overlays: [ov('price', 'price', 'end')], grade: 'warm_luxe',
    music: 'Soft chill ambient, slow tempo, very low so the real sounds lead', sfx: [], speedRamp: true,
    cta: { text: 'Book your slot', channel: 'book' },
    brief: 'Macro of hands and tools, mirror shot, slow-mo hair flip reveal at the end; let the natural sound play.' }),
  r('fitness', 'tip', 'Trainer tip', 'A trainer fixes one common mistake in a popular exercise.', {
    hook: 'question', structure: 'pas', seconds: 15, pace: { cutEvery: 2, jumpCut: true }, captions: { style: 'pop' }, transitions: 'zoom',
    overlays: [ov('lowerThird', 'name', 'hook')], grade: 'moody',
    music: 'Gym hip-hop beat, mid-fast tempo', sfx: ['pop'], split: 'side_by_side',
    cta: { text: 'DM “FORM” for a free check', channel: 'dm' },
    brief: '“Doing squats like this?” wrong form vs right form side by side; trainer explains in two lines.' }),

  // ---------- Financial advisor / insurance (careful) ----------
  r('finance', 'myth', 'Money myth vs fact', 'One common money belief explained simply, with the numbers on screen.', {
    hook: 'question', structure: 'pas', seconds: 30, pace: { cutEvery: 3, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'cut',
    overlays: [ov('counter', 'stat', 'middle'), ov('lowerThird', 'name', 'hook')], grade: 'clean_bright',
    music: 'Calm modern bed, mid tempo', sfx: ['pop'],
    cta: { text: 'Talk to an advisor', channel: 'whatsapp' },
    brief: 'Ask the myth as a question; amounts in big numbers; phone screen or whiteboard insert; end with “investments carry risk” line.' }),
  r('finance', 'compounding', '₹ per month counter', 'What a small monthly amount can grow to, with a counter ticking up.', {
    hook: 'curiosity', structure: 'demo', seconds: 30, pace: { cutEvery: 3 }, captions: { style: 'lower' }, transitions: 'dissolve',
    overlays: [ov('counter', 'stat', 'middle'), ov('progress', 'stat', 'end')], grade: 'clean_bright',
    music: 'Gentle hopeful piano, slow build', sfx: ['riser'],
    cta: { text: 'Book a free review', channel: 'book' },
    brief: '“₹2,000 a month for 15 years” as an illustration, not a promise; growth bar animates; say returns are not guaranteed.' }),

  // ---------- Interior designer / architect ----------
  r('interior', 'beforeafter', 'Before / after', 'The empty or old room snaps to the finished design.', {
    hook: 'before_after', structure: 'demo', seconds: 30, pace: { cutEvery: 2 }, captions: { style: 'minimal' }, transitions: 'whip',
    overlays: [ov('price', 'price', 'end')], grade: 'warm_luxe',
    music: 'Smooth deep-house groove, mid tempo', sfx: ['whoosh', 'impact'], beatSync: true, speedRamp: true, split: 'before_after',
    cta: { text: 'Book a free site visit', channel: 'whatsapp' },
    brief: 'Bare room first, whip to the finished room in 2 seconds; then details: lights, wardrobe, textures.' }),
  r('interior', 'budget', 'Budget home tour', 'A finished home tour with the budget for each room on screen.', {
    hook: 'bold_claim', structure: 'aida', seconds: 45, pace: { cutEvery: 2.5 }, captions: { style: 'lower' }, transitions: 'cinematic',
    overlays: [ov('price', 'price', 'hook'), ov('lowerThird', 'business', 'end')], grade: 'warm_luxe',
    music: 'Warm lounge beat, mid tempo', sfx: ['whoosh'], speedRamp: true,
    cta: { text: 'Get a quote for your home', channel: 'whatsapp' },
    brief: '“2BHK done in ₹X lakh” on the hook; walk-in speed ramp; room name and cost tags as you move.' }),
  r('interior', 'render', 'Plan to render to real', '2D plan, then the 3D design, then the built room.', {
    hook: 'curiosity', structure: 'demo', seconds: 30, pace: { cutEvery: 2.5 }, captions: { style: 'minimal' }, transitions: 'dissolve',
    overlays: [ov('lowerThird', 'business', 'end')], grade: 'cinematic',
    music: 'Ambient electronic, slow build to a drop', sfx: ['riser', 'whoosh'],
    cta: { text: 'DM to start your design', channel: 'dm' },
    brief: 'Floor plan dissolves to 3D render, dissolves to the real finished room from the same angle.' }),

  // ---------- Wedding & events ----------
  r('events', 'highlight', 'Highlight film', 'A cinematic 30-second wedding highlight cut to the beat.', {
    hook: 'pattern_interrupt', structure: 'aida', seconds: 30, pace: { cutEvery: 1.5, punch: 'off' }, captions: { style: 'minimal', keywords: [] }, transitions: 'cinematic',
    overlays: [ov('lowerThird', 'name', 'end')], grade: 'cinematic',
    music: 'Emotional cinematic strings with a big beat drop, mid tempo', sfx: ['riser', 'whoosh'], beatSync: true, speedRamp: true,
    cta: { text: 'Book your date', channel: 'whatsapp' },
    brief: 'Open on the emotional peak (entry or varmala); slow-mo, drone, mehendi and ring close-ups; names and date only, no talking.' }),
  r('events', 'story', 'Getting ready to vidaai', 'The whole day in order, from getting ready to the farewell.', {
    hook: 'pov', structure: 'founder', seconds: 45, pace: { cutEvery: 2 }, captions: { style: 'minimal' }, transitions: 'dissolve',
    overlays: [ov('lowerThird', 'name', 'hook')], grade: 'matte',
    music: 'Soft emotional piano and strings, slow tempo', sfx: ['riser'], beatSync: true,
    cta: { text: 'Check dates for your wedding', channel: 'dm' },
    brief: '“POV: your wedding day” — getting ready, entry, rituals, candid laughs, vidaai; light flash between parts.' }),
  r('events', 'decor', 'Decor reveal', 'An empty venue turning into the finished setup.', {
    hook: 'before_after', structure: 'demo', seconds: 15, pace: { cutEvery: 1.5 }, captions: { style: 'minimal' }, transitions: 'whip',
    overlays: [ov('pin', 'location', 'end')], grade: 'warm_luxe',
    music: 'Festive dhol-led beat, fast tempo', sfx: ['whoosh', 'impact'], beatSync: true, speedRamp: true, split: 'before_after',
    cta: { text: 'WhatsApp for packages', channel: 'whatsapp' },
    brief: 'Bare hall time-lapse into the lit-up decor; the reveal lands on the beat drop.' }),

  // ---------- Travel ----------
  r('travel', 'itinerary', 'Day-by-day itinerary', 'Each day of the trip in a few fast shots, with the package price.', {
    hook: 'number_list', structure: 'offer_first', seconds: 30, pace: { cutEvery: 1.5 }, captions: { style: 'pop' }, transitions: 'whip',
    overlays: [ov('price', 'price', 'hook'), ov('pin', 'location', 'middle'), ov('counter', 'stat', 'middle')], grade: 'clean_bright',
    music: 'Upbeat travel pop, fast tempo', sfx: ['whoosh'], beatSync: true, speedRamp: true,
    cta: { text: 'WhatsApp for dates', channel: 'whatsapp' },
    brief: '“Kashmir 5N/6D ₹X” over a drone shot; Day 1, Day 2… each a few cuts (sights, food, hotel).' }),
  r('travel', 'gems', 'Hidden gems', 'A few places most tourists miss, as a fast montage.', {
    hook: 'curiosity', structure: 'aida', seconds: 30, pace: { cutEvery: 2 }, captions: { style: 'karaoke' }, transitions: 'mixed',
    overlays: [ov('pin', 'location', 'middle')], grade: 'cinematic',
    music: 'Adventurous indie folk, mid-fast tempo', sfx: ['whoosh', 'riser'], beatSync: true,
    cta: { text: 'DM to plan this trip', channel: 'dm' },
    brief: 'POV walking shots, landscapes, local food; a location pin for each place.' }),
  r('travel', 'cost', 'Trip cost breakdown', 'What a trip really costs, item by item.', {
    hook: 'question', structure: 'demo', seconds: 30, pace: { cutEvery: 2.5, jumpCut: true }, captions: { style: 'lower' }, transitions: 'zoom',
    overlays: [ov('counter', 'price', 'middle'), ov('price', 'offer', 'end')], grade: 'clean_bright',
    music: 'Light ukulele pop, mid tempo', sfx: ['pop'],
    cta: { text: 'Get this package', channel: 'whatsapp' },
    brief: '“How much does Goa cost for 2?” flights, stay, food, activities each with a running total.' }),

  // ---------- Car / bike dealership ----------
  r('auto', 'delivery', 'Delivery moment', 'The cover comes off, keys are handed over, the family smiles.', {
    hook: 'pattern_interrupt', structure: 'ugc', seconds: 15, pace: { cutEvery: 1.5, punch: 'off' }, captions: { style: 'minimal' }, transitions: 'whip',
    overlays: [ov('lowerThird', 'business', 'end')], grade: 'cinematic',
    music: 'Celebratory bass-heavy beat, fast tempo', sfx: ['impact', 'riser'], beatSync: true, speedRamp: true,
    cta: { text: 'Book your test drive', channel: 'call' },
    brief: 'Cover pull in the first second; garland, keys, family reaction; slow-mo on the reveal.' }),
  r('auto', 'walkaround', 'Walkaround with price', 'A 30-second tour of a model with on-road price and features.', {
    hook: 'bold_claim', structure: 'aida', seconds: 30, pace: { cutEvery: 2 }, captions: { style: 'lower' }, transitions: 'whip',
    overlays: [ov('price', 'price', 'hook'), ov('badge', 'stat', 'middle')], grade: 'moody',
    music: 'Bass-heavy electronic, fast tempo', sfx: ['whoosh', 'impact'], beatSync: true, speedRamp: true,
    cta: { text: 'Book a test drive', channel: 'whatsapp' },
    brief: 'Low-angle front shot with on-road price; badge and wheel close-ups; interior; three feature chips.' }),
  r('auto', 'offer', 'EMI offer countdown', 'This month’s EMI and exchange offer, with a deadline.', {
    hook: 'number_list', structure: 'offer_first', seconds: 15, pace: { cutEvery: 1.5 }, captions: { style: 'punch' }, transitions: 'zoom',
    overlays: [ov('price', 'offer', 'hook'), ov('badge', 'deadline', 'end')], grade: 'clean_bright',
    music: 'Driving pop beat, fast tempo', sfx: ['impact', 'pop'], beatSync: true,
    cta: { text: 'Call the showroom', channel: 'call' },
    brief: 'EMI amount huge in the first frame; showroom and car shots on the beat; offer end date at the end.' }),

  // ---------- CA / lawyer ----------
  r('professional', 'deadline', 'Deadline alert', 'An upcoming due date, who it affects, and the penalty for missing it.', {
    hook: 'question', structure: 'pas', seconds: 30, pace: { cutEvery: 3, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'cut',
    overlays: [ov('badge', 'deadline', 'hook'), ov('lowerThird', 'name', 'middle')], grade: 'clean_bright',
    music: 'Subtle ticking corporate bed, mid tempo', sfx: ['pop'],
    cta: { text: 'Book a consultation', channel: 'book' },
    brief: '“Filed your ITR yet?” date chip on screen; talking head with document zoom-ins; penalty amount in big numbers.' }),
  r('professional', 'checklist', 'Step-by-step checklist', 'What to do when a notice arrives, as a short checklist.', {
    hook: 'number_list', structure: 'demo', seconds: 45, pace: { cutEvery: 3, jumpCut: true }, captions: { style: 'lower' }, transitions: 'cut',
    overlays: [ov('progress', 'stat', 'middle'), ov('lowerThird', 'business', 'end')], grade: 'natural',
    music: 'Minimal calm piano, slow tempo', sfx: ['pop'],
    cta: { text: 'WhatsApp us your notice', channel: 'whatsapp' },
    brief: '“Notice mila? Do these 4 things.” each step a tick on screen; desk and document close-ups.' }),

  // ---------- Recruitment ----------
  r('recruitment', 'hiring', 'We are hiring', 'The role, salary and location on job cards, fast.', {
    hook: 'bold_claim', structure: 'offer_first', seconds: 15, pace: { cutEvery: 2 }, captions: { style: 'punch' }, transitions: 'whip',
    overlays: [ov('badge', 'offer', 'hook'), ov('pin', 'location', 'middle')], grade: 'clean_bright',
    music: 'Upbeat light pop, fast tempo', sfx: ['whoosh', 'pop'], beatSync: true,
    cta: { text: 'Apply on WhatsApp', channel: 'whatsapp' },
    brief: 'Role and salary in the first frame; office or site B-roll; three requirement chips.' }),
  r('recruitment', 'tips', 'Interview tips', 'Three quick answers that work in interviews.', {
    hook: 'number_list', structure: 'pas', seconds: 30, pace: { cutEvery: 2.5, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'zoom',
    overlays: [ov('lowerThird', 'name', 'hook')], grade: 'natural',
    music: 'Light motivating beat, mid tempo', sfx: ['pop'], split: 'side_by_side',
    cta: { text: 'Send your CV', channel: 'whatsapp' },
    brief: 'Wrong answer vs right answer role-play side by side; recruiter explains in one line each.' }),

  // ---------- Solar / home services ----------
  r('homeservices', 'bill', 'Bill before / after', 'The electricity bill before and after installation.', {
    hook: 'before_after', structure: 'pas', seconds: 30, pace: { cutEvery: 2.5 }, captions: { style: 'pop' }, transitions: 'zoom',
    overlays: [ov('counter', 'stat', 'middle'), ov('badge', 'offer', 'end')], grade: 'clean_bright',
    music: 'Bright upbeat pop, mid tempo', sfx: ['impact', 'pop'], split: 'before_after',
    cta: { text: 'Book a free site survey', channel: 'whatsapp' },
    brief: 'Old bill vs new bill in the first frame; rooftop drone; customer says the saving per month.' }),
  r('homeservices', 'install', 'Install time-lapse', 'A full day’s installation sped up into 15 seconds.', {
    hook: 'pattern_interrupt', structure: 'demo', seconds: 15, pace: { cutEvery: 1.5, punch: 'off' }, captions: { style: 'minimal' }, transitions: 'cut',
    overlays: [ov('progress', 'stat', 'middle'), ov('lowerThird', 'business', 'end')], grade: 'clean_bright',
    music: 'Driving percussion, fast tempo', sfx: ['whoosh'], beatSync: true, speedRamp: true,
    cta: { text: 'Call for a quote', channel: 'call' },
    brief: 'Empty roof to finished panels; tool and team close-ups; inverter display at the end.' }),

  // ---------- Hotel / homestay / banquet ----------
  r('hospitality', 'tour', 'Room tour', 'A drone reveal, then the room, the view and the food.', {
    hook: 'pov', structure: 'aida', seconds: 30, pace: { cutEvery: 2 }, captions: { style: 'minimal' }, transitions: 'cinematic',
    overlays: [ov('price', 'price', 'middle'), ov('pin', 'location', 'end')], grade: 'warm_luxe',
    music: 'Chill tropical house, mid tempo', sfx: ['whoosh', 'riser'], speedRamp: true,
    cta: { text: 'Book your stay', channel: 'link' },
    brief: '“POV: you checked in here” door-open walk-in; balcony view; pool at golden hour; breakfast close-ups.' }),
  r('hospitality', 'price', '₹ stay reveal', 'Guess the price, then the reveal.', {
    hook: 'curiosity', structure: 'offer_first', seconds: 15, pace: { cutEvery: 1.5 }, captions: { style: 'punch' }, transitions: 'whip',
    overlays: [ov('price', 'price', 'end')], grade: 'warm_luxe',
    music: 'Playful upbeat pop, fast tempo', sfx: ['riser', 'impact'], beatSync: true,
    cta: { text: 'WhatsApp for dates', channel: 'whatsapp' },
    brief: '“Guess the price of this stay” over the best shots; the price lands on the beat drop.' }),

  // ---------- D2C brand / online store ----------
  r('store', 'problem', 'Problem to product', 'A relatable problem, the product fixing it, proof and the offer.', {
    hook: 'question', structure: 'pas', seconds: 30, pace: { cutEvery: 2, jumpCut: true }, captions: { style: 'pop' }, transitions: 'zoom',
    overlays: [ov('badge', 'stat', 'middle'), ov('price', 'offer', 'end')], grade: 'clean_bright',
    music: 'Trendy pop beat, fast tempo', sfx: ['pop', 'whoosh'],
    cta: { text: 'Shop now, link in bio', channel: 'link' },
    brief: 'Pain point as a question in 1 second (“Hair fall not stopping?”); creator uses the product; texture close-ups; review stars; offer.' }),
  r('store', 'reasons', '3 reasons to love it', 'Three quick reasons with product close-ups.', {
    hook: 'number_list', structure: 'aida', seconds: 15, pace: { cutEvery: 1.5 }, captions: { style: 'punch' }, transitions: 'whip',
    overlays: [ov('price', 'price', 'end'), ov('badge', 'offer', 'end')], grade: 'food_pop',
    music: 'Bouncy pop beat, fast tempo', sfx: ['pop', 'whoosh'], beatSync: true,
    cta: { text: 'Order now', channel: 'link' },
    brief: 'Product hero shot; reason 1, 2, 3 each a macro shot; COD and free-shipping chips at the end.' }),
  r('store', 'unboxing', 'Unboxing ASMR', 'Slow unboxing with the real sounds of opening and using it.', {
    hook: 'pov', structure: 'demo', seconds: 30, pace: { cutEvery: 3 }, captions: { style: 'minimal' }, transitions: 'cut',
    overlays: [ov('price', 'offer', 'end')], grade: 'clean_bright',
    music: 'Soft lo-fi, slow tempo, kept low under the real sounds', sfx: [],
    cta: { text: 'Get yours, link in bio', channel: 'link' },
    brief: '“POV: your order just arrived” — box, tape, tissue, product reveal, first use; let the natural sound play.' }),

  // ---------- Manufacturer / factory ----------
  r('manufacturer', 'process', 'Process ASMR', 'Machines making the product step by step, no talking, just the sound.', {
    hook: 'pattern_interrupt', structure: 'demo', seconds: 30, pace: { cutEvery: 2, punch: 'off' }, captions: { style: 'minimal', keywords: [] }, transitions: 'cut',
    overlays: [ov('lowerThird', 'business', 'end')], grade: 'natural',
    music: 'Low industrial ambient, mid tempo, under the machine sounds', sfx: [], beatSync: true,
    cta: { text: 'WhatsApp for dealer rates', channel: 'whatsapp' },
    brief: 'Continuous machine close-ups in order; clean, gloved, PPE visuals; finished product stack at the end.' }),
  r('manufacturer', 'raw', 'Raw to finished', 'Raw material at the start, finished product at the end.', {
    hook: 'before_after', structure: 'demo', seconds: 30, pace: { cutEvery: 2 }, captions: { style: 'lower' }, transitions: 'zoom',
    overlays: [ov('progress', 'stat', 'middle'), ov('counter', 'stat', 'end')], grade: 'natural',
    music: 'Driving electronic build, mid-fast tempo', sfx: ['whoosh', 'impact'], speedRamp: true, split: 'before_after',
    cta: { text: 'Ask for a sample', channel: 'whatsapp' },
    brief: 'Raw material and finished product side by side, then the steps sped up; units-per-day counter.' }),
  r('manufacturer', 'howmade', 'Kaise banta hai', '“How X is made” with step numbers and quality checks.', {
    hook: 'curiosity', structure: 'founder', seconds: 45, pace: { cutEvery: 2.5, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'cut',
    overlays: [ov('progress', 'stat', 'middle'), ov('badge', 'stat', 'end')], grade: 'natural',
    music: 'Steady corporate beat, mid tempo', sfx: ['pop'],
    cta: { text: 'Become a dealer', channel: 'call' },
    brief: 'Owner voice-over; workers, QC checks, packing and dispatch trucks; certifications at the end.' }),

  // ---------- Retail shop / showroom ----------
  r('retailer', 'tour', 'Showroom tour', 'A quick walk through the shop showing the range.', {
    hook: 'pov', structure: 'aida', seconds: 30, pace: { cutEvery: 2 }, captions: { style: 'lower' }, transitions: 'whip',
    overlays: [ov('pin', 'location', 'end'), ov('lowerThird', 'business', 'hook')], grade: 'clean_bright',
    music: 'Upbeat shopping pop, fast tempo', sfx: ['whoosh'], beatSync: true,
    cta: { text: 'Visit the store today', channel: 'visit' },
    brief: '“POV: you walk into our store” entrance, aisles, best sellers, billing counter smile; map pin at the end.' }),
  r('retailer', 'drop', 'New arrivals', 'This week’s new stock, one item per beat with prices.', {
    hook: 'bold_claim', structure: 'offer_first', seconds: 15, pace: { cutEvery: 1.5 }, captions: { style: 'punch' }, transitions: 'zoom',
    overlays: [ov('price', 'price', 'middle'), ov('badge', 'offer', 'end')], grade: 'clean_bright',
    music: 'Trendy dance-pop beat, fast tempo', sfx: ['pop', 'impact'], beatSync: true,
    cta: { text: 'WhatsApp to reserve', channel: 'whatsapp' },
    brief: '“Just in!” first frame; one product per beat with a price tag; offer badge to finish.' }),
  // ---------- Trader / distributor ----------
  r('distributor', 'godown', 'Godown walk', 'A walk through stocked shelves to show range and scale.', {
    hook: 'social_proof', structure: 'aida', seconds: 30, pace: { cutEvery: 2 }, captions: { style: 'lower' }, transitions: 'whip',
    overlays: [ov('counter', 'stat', 'hook'), ov('pin', 'location', 'end')], grade: 'natural',
    music: 'Confident mid-tempo beat', sfx: ['whoosh'], speedRamp: true,
    cta: { text: 'WhatsApp for the rate list', channel: 'whatsapp' },
    brief: '“500+ shops trust us” over the godown; stocked racks, loading, delivery vans.' }),
  r('distributor', 'ratecard', 'Rate card', 'This week’s rates for top items, clear and quick.', {
    hook: 'number_list', structure: 'offer_first', seconds: 15, pace: { cutEvery: 2 }, captions: { style: 'strip' }, transitions: 'cut',
    overlays: [ov('price', 'price', 'middle'), ov('badge', 'deadline', 'end')], grade: 'clean_bright',
    music: 'Simple upbeat beat, mid tempo', sfx: ['pop'],
    cta: { text: 'Order on WhatsApp', channel: 'whatsapp' },
    brief: 'Each product with its rate on screen; minimum order and validity at the end.' }),

  // ---------- Study abroad (careful) ----------
  r('abroad', 'success', 'Student success story', 'A student shares their visa journey in their own words.', {
    hook: 'social_proof', structure: 'ugc', seconds: 30, pace: { cutEvery: 2.5, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'cut',
    overlays: [ov('lowerThird', 'name', 'hook'), ov('pin', 'location', 'middle')], grade: 'natural',
    music: 'Warm hopeful acoustic, mid tempo', sfx: ['riser'],
    cta: { text: 'Book a free counselling session', channel: 'book' },
    brief: 'Student on camera with the university; campus B-roll; no promises of a visa for everyone.' }),
  r('abroad', 'cost', 'Country cost guide', 'What studying in one country really costs, item by item.', {
    hook: 'question', structure: 'demo', seconds: 30, pace: { cutEvery: 2.5, jumpCut: true }, captions: { style: 'lower' }, transitions: 'zoom',
    overlays: [ov('counter', 'price', 'middle'), ov('pin', 'location', 'hook')], grade: 'clean_bright',
    music: 'Light modern pop, mid tempo', sfx: ['pop'],
    cta: { text: 'Talk to a counsellor', channel: 'whatsapp' },
    brief: '“How much does a Master’s in Canada cost?” fees, rent, food with a running total; say figures are approximate.' }),
  r('abroad', 'myth', 'Visa myth vs fact', 'One common visa myth cleared up, calmly.', {
    hook: 'pattern_interrupt', structure: 'pas', seconds: 15, pace: { cutEvery: 2, jumpCut: true }, captions: { style: 'pop' }, transitions: 'cut',
    overlays: [ov('lowerThird', 'name', 'hook')], grade: 'natural',
    music: 'Calm modern bed, mid tempo', sfx: ['pop'], broll: false,
    cta: { text: 'Ask us your question', channel: 'dm' },
    brief: 'The myth in big text first frame; counsellor explains the fact in two lines; no shortcuts promised.' }),

  // ---------- Astrology / healing / wellness ----------
  r('wellness', 'daily', 'Daily guidance', 'A calm daily message for each sign or number.', {
    hook: 'question', structure: 'aida', seconds: 30, pace: { cutEvery: 3.5, jumpCut: true }, captions: { style: 'matte' }, transitions: 'dissolve',
    overlays: [ov('lowerThird', 'name', 'hook')], grade: 'moody',
    music: 'Soft meditative ambient with bells, slow tempo', sfx: [],
    cta: { text: 'Book a session', channel: 'book' },
    brief: '“What does today hold for you?” calm talking head; candle, crystals, sky B-roll.' }),
  r('wellness', 'remedy', 'Simple remedy', 'One easy practice explained step by step.', {
    hook: 'number_list', structure: 'demo', seconds: 30, pace: { cutEvery: 3 }, captions: { style: 'matte' }, transitions: 'dissolve',
    overlays: [ov('progress', 'stat', 'middle')], grade: 'warm_luxe',
    music: 'Gentle flute and drone, slow tempo', sfx: [],
    cta: { text: 'DM for a consultation', channel: 'dm' },
    brief: 'Hands doing the practice in close-up; steps numbered on screen; peaceful setting.' }),

  // ---------- NGO ----------
  r('ngo', 'onestory', 'One story', 'One person’s life before and after your help.', {
    hook: 'before_after', structure: 'founder', seconds: 45, pace: { cutEvery: 3 }, captions: { style: 'lower' }, transitions: 'dissolve',
    overlays: [ov('lowerThird', 'name', 'hook'), ov('counter', 'stat', 'end')], grade: 'cinematic',
    music: 'Emotional piano and strings, slow build', sfx: ['riser'],
    cta: { text: 'Donate now, 80G receipt', channel: 'link' },
    brief: 'One face, one story (with consent); then the change; total helped so far at the end.' }),
  r('ngo', 'rupee', '₹ to impact', 'What ₹500 or ₹1,000 does, shown plainly.', {
    hook: 'curiosity', structure: 'offer_first', seconds: 15, pace: { cutEvery: 2 }, captions: { style: 'punch' }, transitions: 'cut',
    overlays: [ov('price', 'offer', 'hook'), ov('counter', 'stat', 'middle')], grade: 'natural',
    music: 'Warm hopeful acoustic, mid tempo', sfx: ['pop'],
    cta: { text: 'Give ₹500 today', channel: 'link' },
    brief: '“₹500 = a month of meals for a child” over field footage; each amount with its impact.' }),

  // ---------- Diagnostic lab / pharmacy (careful) ----------
  r('lab', 'whichtest', 'Which test when', 'Which test to get for a common worry, explained simply.', {
    hook: 'question', structure: 'pas', seconds: 30, pace: { cutEvery: 3, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'cut',
    overlays: [ov('badge', 'stat', 'middle'), ov('lowerThird', 'name', 'hook')], grade: 'clean_bright',
    music: 'Light calm bed, mid tempo', sfx: ['pop'],
    cta: { text: 'Book a test', channel: 'book' },
    brief: '“Always tired?” the tests usually suggested; say “ask your doctor”; lab and report close-ups.' }),
  r('lab', 'homecollect', 'Home collection walk-through', 'How a home sample visit works, start to finish.', {
    hook: 'pov', structure: 'demo', seconds: 30, pace: { cutEvery: 2.5 }, captions: { style: 'lower' }, transitions: 'dissolve',
    overlays: [ov('progress', 'stat', 'middle'), ov('price', 'price', 'end')], grade: 'clean_bright',
    music: 'Soft friendly acoustic, mid tempo', sfx: [],
    cta: { text: 'Book a home collection', channel: 'whatsapp' },
    brief: '“POV: your blood test at home” booking, visit, sealed kit, report on phone; hygiene shown clearly.' }),

  // ---------- Jewellery ----------
  r('jewellery', 'sparkle', 'Macro sparkle reveal', 'Slow-motion close-ups of a piece catching the light, then the price.', {
    hook: 'pattern_interrupt', structure: 'aida', seconds: 15, pace: { cutEvery: 2, punch: 'off' }, captions: { style: 'minimal' }, transitions: 'cinematic',
    overlays: [ov('counter', 'price', 'middle'), ov('price', 'offer', 'end')], grade: 'warm_luxe',
    music: 'Elegant festive strings with a soft beat drop, mid tempo', sfx: ['riser', 'whoosh'], beatSync: true, speedRamp: true, broll: false,
    cta: { text: 'WhatsApp for today’s rate', channel: 'whatsapp' },
    brief: 'Slow-mo macro of the piece turning in warm light; sparkle on the beat; today’s gold rate or price as the final card.' }),
  r('jewellery', 'emotion', 'Emotional story', 'A family moment, the jewellery only at the very end.', {
    hook: 'curiosity', structure: 'founder', seconds: 45, pace: { cutEvery: 3, punch: 'off' }, captions: { style: 'lower' }, transitions: 'dissolve',
    overlays: [ov('lowerThird', 'business', 'end')], grade: 'cinematic',
    music: 'Soft emotional piano and strings, slow tempo', sfx: ['riser'],
    cta: { text: 'Visit our store', channel: 'visit' },
    brief: 'A mother and daughter, a wedding morning, a gift; no product until the last 2 seconds; no hard sell.' }),
  r('jewellery', 'karigar', 'Karigar craft', 'Hands making a piece, with the hours it took on screen.', {
    hook: 'curiosity', structure: 'demo', seconds: 30, pace: { cutEvery: 2.5, punch: 'off' }, captions: { style: 'minimal' }, transitions: 'dissolve',
    overlays: [ov('counter', 'stat', 'middle'), ov('badge', 'business', 'end')], grade: 'warm_luxe',
    music: 'Traditional instrumental with sitar, slow build', sfx: ['riser'], speedRamp: true,
    cta: { text: 'Order a custom piece', channel: 'whatsapp' },
    brief: 'Macro of the karigar’s hands, tools, flame and polishing; an hours counter; finished piece on velvet.' }),

  // ---------- School / preschool ----------
  r('school', 'tour', 'Campus tour', 'Classrooms, play area and labs, with kids’ happy moments.', {
    hook: 'pov', structure: 'aida', seconds: 30, pace: { cutEvery: 2 }, captions: { style: 'lower' }, transitions: 'dissolve',
    overlays: [ov('pin', 'location', 'end'), ov('badge', 'deadline', 'end')], grade: 'clean_bright',
    music: 'Cheerful playful acoustic, mid tempo', sfx: ['pop'],
    cta: { text: 'Book a campus visit', channel: 'book' },
    brief: '“POV: your child’s first day” gate, classroom, play area, lab, smiling teachers; admissions date at the end.' }),
  r('school', 'parent', 'Parent testimonial', 'A parent says what changed for their child.', {
    hook: 'social_proof', structure: 'ugc', seconds: 30, pace: { cutEvery: 2.5, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'cut',
    overlays: [ov('lowerThird', 'name', 'hook')], grade: 'natural',
    music: 'Warm gentle piano, mid tempo', sfx: [],
    cta: { text: 'Enquire for admission', channel: 'whatsapp' },
    brief: 'Parent on camera; cut to the child in class and on stage; one line from the principal.' }),

  // ---------- PG / hostel ----------
  r('pg', 'roomtour', 'Room tour POV', 'A walk into the room with the rent on screen.', {
    hook: 'pov', structure: 'offer_first', seconds: 15, pace: { cutEvery: 2 }, captions: { style: 'pop' }, transitions: 'whip',
    overlays: [ov('price', 'price', 'hook'), ov('pin', 'location', 'end')], grade: 'clean_bright',
    music: 'Chill lo-fi beat, mid tempo', sfx: ['whoosh'], beatSync: true,
    cta: { text: 'WhatsApp to book a visit', channel: 'whatsapp' },
    brief: '“POV: your new room for ₹X/month” door open, bed, wardrobe, washroom, food area.' }),
  r('pg', 'amenities', 'What’s included', 'Wi-Fi, food, laundry and more, each in one shot.', {
    hook: 'number_list', structure: 'aida', seconds: 30, pace: { cutEvery: 2 }, captions: { style: 'punch' }, transitions: 'zoom',
    overlays: [ov('counter', 'stat', 'middle'), ov('price', 'price', 'end')], grade: 'clean_bright',
    music: 'Upbeat indie pop, mid-fast tempo', sfx: ['pop'], beatSync: true,
    cta: { text: 'Book a bed', channel: 'whatsapp' },
    brief: '“7 things included in rent” one amenity per beat; resident smiling at the end.' }),

  // ---------- Agri / tractor ----------
  r('agri', 'anthem', 'Farmer pride', 'A proud farmer, wide fields and the tractor as the hero.', {
    hook: 'pattern_interrupt', structure: 'founder', seconds: 30, pace: { cutEvery: 2, punch: 'off' }, captions: { style: 'lower' }, transitions: 'cinematic',
    overlays: [ov('lowerThird', 'business', 'end')], grade: 'cinematic',
    music: 'Regional folk-style anthem with dhol, mid-fast tempo', sfx: ['impact', 'riser'], beatSync: true, speedRamp: true,
    cta: { text: 'Visit your nearest dealer', channel: 'visit' },
    brief: 'Drone over green fields at sunrise; low-angle tractor hero shots; the farmer’s proud face.' }),
  r('agri', 'demo', 'Field demo', 'The machine or product working in a real field.', {
    hook: 'bold_claim', structure: 'demo', seconds: 30, pace: { cutEvery: 2.5 }, captions: { style: 'pop' }, transitions: 'cut',
    overlays: [ov('badge', 'stat', 'middle'), ov('price', 'offer', 'end')], grade: 'natural',
    music: 'Earthy upbeat folk beat, mid tempo', sfx: ['impact'],
    cta: { text: 'Call to book a field demo', channel: 'call' },
    brief: 'Ploughing or spraying in a real field; horsepower or yield on screen; farmer says one line.' }),

  // ---------- Caterer / tiffin / cloud kitchen ----------
  r('caterer', 'macro', 'Food macro', 'Sizzling, pouring, plating close-ups cut to the beat.', {
    hook: 'pattern_interrupt', structure: 'aida', seconds: 15, pace: { cutEvery: 1.5, punch: 'off' }, captions: { style: 'minimal' }, transitions: 'whip',
    overlays: [ov('price', 'price', 'end')], grade: 'food_pop',
    music: 'Funky upbeat groove, fast tempo', sfx: ['whoosh', 'pop'], beatSync: true, speedRamp: true,
    cta: { text: 'Order on WhatsApp', channel: 'whatsapp' },
    brief: 'Tadka sizzle in the first frame; ghee pour, roti puff, plating; slow-mo steam.' }),
  r('caterer', 'kitchen', 'Kitchen process', 'A clean kitchen making a full meal, start to finish.', {
    hook: 'curiosity', structure: 'demo', seconds: 30, pace: { cutEvery: 2 }, captions: { style: 'lower' }, transitions: 'cut',
    overlays: [ov('counter', 'stat', 'middle'), ov('lowerThird', 'business', 'end')], grade: 'food_pop',
    music: 'Warm acoustic groove, mid tempo', sfx: ['pop'], speedRamp: true,
    cta: { text: 'Start a tiffin plan', channel: 'whatsapp' },
    brief: 'Hairnets and gloves visible; chopping, cooking, packing; plates-served-today counter.' }),
  r('caterer', 'menu', 'Menu and price pack', 'The party menu with per-plate prices.', {
    hook: 'number_list', structure: 'offer_first', seconds: 15, pace: { cutEvery: 1.5 }, captions: { style: 'punch' }, transitions: 'zoom',
    overlays: [ov('price', 'price', 'hook'), ov('badge', 'offer', 'end')], grade: 'food_pop',
    music: 'Festive dhol beat, fast tempo', sfx: ['pop', 'impact'], beatSync: true,
    cta: { text: 'WhatsApp for your party menu', channel: 'whatsapp' },
    brief: '“₹X per plate, 12 dishes” then one dish per beat; buffet spread to finish.' }),

  // ---------- Franchise ----------
  r('franchise', 'roi', 'Investment and returns', 'Investment, space needed and payback, plainly.', {
    hook: 'number_list', structure: 'offer_first', seconds: 30, pace: { cutEvery: 2.5, jumpCut: true }, captions: { style: 'lower' }, transitions: 'zoom',
    overlays: [ov('counter', 'stat', 'middle'), ov('price', 'price', 'hook')], grade: 'clean_bright',
    music: 'Confident corporate beat, mid tempo', sfx: ['pop'],
    cta: { text: 'Book a discovery call', channel: 'book' },
    brief: 'Investment amount up front; outlet B-roll; space, staff and payback as on-screen chips; say returns vary.' }),
  r('franchise', 'owner', 'Owner testimonial', 'A franchise owner on how their outlet is doing.', {
    hook: 'social_proof', structure: 'ugc', seconds: 30, pace: { cutEvery: 2.5, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'cut',
    overlays: [ov('lowerThird', 'name', 'hook'), ov('pin', 'location', 'middle')], grade: 'natural',
    music: 'Warm upbeat acoustic, mid tempo', sfx: [],
    cta: { text: 'Own an outlet in your city', channel: 'whatsapp' },
    brief: 'Owner in their outlet; busy counter and customers; outlets-open counter at the end.' }),

  // ---------- Packers & movers ----------
  r('movers', 'skit', 'Shifting stress skit', 'A funny moving-day mess, then your team makes it easy.', {
    hook: 'pattern_interrupt', structure: 'pas', seconds: 15, pace: { cutEvery: 1.5, jumpCut: true }, captions: { style: 'pop' }, transitions: 'whip',
    overlays: [ov('lowerThird', 'business', 'end')], grade: 'natural',
    music: 'Comic quirky beat, fast tempo', sfx: ['impact', 'whoosh'],
    cta: { text: 'Get a free quote', channel: 'call' },
    brief: 'Chaos of boxes and a stressed family; whip to your team packing calmly; relieved smile.' }),
  r('movers', 'timelapse', 'Pack and load time-lapse', 'A full home packed and loaded, sped up.', {
    hook: 'curiosity', structure: 'demo', seconds: 30, pace: { cutEvery: 2, punch: 'off' }, captions: { style: 'minimal' }, transitions: 'cut',
    overlays: [ov('counter', 'stat', 'middle'), ov('pin', 'location', 'end')], grade: 'clean_bright',
    music: 'Driving percussion, fast tempo', sfx: ['whoosh'], beatSync: true, speedRamp: true,
    cta: { text: 'WhatsApp for a quote', channel: 'whatsapp' },
    brief: 'Bubble wrap, boxes, labelled cartons, loading the truck; items-packed counter.' }),

  // ---------- Matrimony ----------
  r('matrimony', 'couple', 'Couple story', 'How one couple met through you, told warmly.', {
    hook: 'social_proof', structure: 'ugc', seconds: 30, pace: { cutEvery: 2.5 }, captions: { style: 'lower' }, transitions: 'dissolve',
    overlays: [ov('lowerThird', 'name', 'hook')], grade: 'warm_luxe',
    music: 'Romantic acoustic guitar, slow tempo', sfx: ['riser'],
    cta: { text: 'Register your profile', channel: 'link' },
    brief: 'The couple on camera (with consent); wedding photos; families together.' }),
  r('matrimony', 'funny', 'Relatable rishta skit', 'A funny family rishta moment with a warm ending.', {
    hook: 'pov', structure: 'pas', seconds: 15, pace: { cutEvery: 1.5, jumpCut: true }, captions: { style: 'pop' }, transitions: 'whip',
    overlays: [ov('lowerThird', 'business', 'end')], grade: 'natural',
    music: 'Playful upbeat pop, fast tempo', sfx: ['pop', 'impact'],
    cta: { text: 'Find your match', channel: 'whatsapp' },
    brief: '“POV: every relative has a rishta for you” quick skit; switch to a calm, matched couple.' }),

  // ---------- Loan DSA (careful) ----------
  r('loans', 'documents', 'Document checklist', 'The documents needed for a loan, as a simple checklist.', {
    hook: 'number_list', structure: 'demo', seconds: 30, pace: { cutEvery: 2.5, jumpCut: true }, captions: { style: 'lower' }, transitions: 'cut',
    overlays: [ov('progress', 'stat', 'middle'), ov('lowerThird', 'name', 'hook')], grade: 'clean_bright',
    music: 'Calm modern bed, mid tempo', sfx: ['pop'],
    cta: { text: 'Check your eligibility', channel: 'whatsapp' },
    brief: '“5 documents for a home loan” each ticked on screen; desk and paper close-ups; no approval promises.' }),
  r('loans', 'emi', 'EMI example', 'What the EMI looks like for a sample amount and tenure.', {
    hook: 'question', structure: 'pas', seconds: 30, pace: { cutEvery: 3, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'cut',
    overlays: [ov('counter', 'stat', 'middle')], grade: 'clean_bright',
    music: 'Light calm bed, mid tempo', sfx: ['pop'],
    cta: { text: 'Talk to a loan advisor', channel: 'call' },
    brief: '“₹20 lakh loan, what’s the EMI?” worked example; say rates depend on the bank and your profile.' }),

  // ---------- SaaS / software (now part of Consultant, kept for older accounts) ----------
  r('saas', 'demo', 'Screen demo', 'The product doing one job, recorded on screen with zoom-ins.', {
    hook: 'bold_claim', structure: 'demo', seconds: 30, pace: { cutEvery: 2, jumpCut: true }, captions: { style: 'karaoke' }, transitions: 'zoom',
    overlays: [ov('counter', 'stat', 'hook'), ov('lowerThird', 'business', 'end')], grade: 'clean_bright',
    music: 'Minimal modern electronic, mid tempo', sfx: ['pop', 'whoosh'],
    cta: { text: 'Start a free trial', channel: 'link' },
    brief: 'Result first (“invoices in 10 seconds”); screen recording with cursor highlight and zoom into the UI.' }),
  r('saas', 'workflow', 'Old way vs new way', 'The messy old workflow next to the clean new one.', {
    hook: 'before_after', structure: 'pas', seconds: 15, pace: { cutEvery: 1.5 }, captions: { style: 'punch' }, transitions: 'whip',
    overlays: [ov('badge', 'stat', 'end')], grade: 'clean_bright',
    music: 'Upbeat tech beat, fast tempo', sfx: ['whoosh', 'impact'], split: 'side_by_side',
    cta: { text: 'Book a demo', channel: 'book' },
    brief: 'Spreadsheets and chaos on the left, the app on the right; time saved as the end badge.' }),
];

export const RECIPES = Object.freeze(LIST.map(freeze));
export const RECIPE_IDS = Object.freeze(RECIPES.map((x) => x.id));
const BY_ID = new Map(RECIPES.map((x) => [x.id, x]));

// an industry's recipes; an unknown or empty industry gets the general ones (coach & creator: they suit anyone)
export function recipesFor(industry) {
  const list = RECIPES.filter((x) => x.industry === industry);
  return list.length ? list : RECIPES.filter((x) => x.industry === 'general');
}
export const recipeById = (id) => BY_ID.get(id) || null;

// what the seller's picker shows
export const recipeView = (x) => ({ id: x.id, industry: x.industry, name: x.name, about: x.about, seconds: x.seconds, grade: x.grade, transitions: x.transitions, captions: x.captions.style });

const CHANNEL = { whatsapp: 'on WhatsApp', call: 'by phone', visit: 'in person', dm: 'by DM', link: 'through the link', book: 'by booking a slot' };
// the recipe as direction for the script writer: hook, structure, pace, shots, call to action
export function recipePrompt(x) {
  const h = HOOKS[x.hook], s = STRUCTURES[x.structure];
  const pace = [`a new shot about every ${x.pace.cutEvery}s`];
  if (x.pace.jumpCut) pace.push('talking parts tightened (no pauses or fillers)');
  if (x.beatSync) pace.push('cuts on the music beat');
  if (x.speedRamp) pace.push('a speed ramp into the reveal');
  const shots = [x.brief];
  if (x.broll) shots.push('Cover the talking with matching B-roll.');
  if (x.split === 'before_after') shots.push('Show the before and after split on screen.');
  if (x.split === 'side_by_side') shots.push('Show two things side by side.');
  const careful = CAREFUL_INDUSTRIES.includes(x.industry) ? ' Keep it calm and factual: no promised results, no pressure, add a short disclaimer line.' : '';
  return [
    `Edit: “${x.name}”, about ${x.seconds}s. Hook: ${x.hook} (${h.how}). Structure: ${x.structure} (${s.label}).`,
    `Pace: ${pace.join(', ')}.`,
    `Shots: ${shots.join(' ')}`,
    `End with: “${x.cta.text}” — the viewer acts ${CHANNEL[x.cta.channel]}.${careful}`,
  ].join('\n');
}

// what the editor needs, as fresh copies it can change
export const renderOptions = (x) => ({
  captions: { style: x.captions.style, keywords: Array.isArray(x.captions.keywords) ? [...x.captions.keywords] : x.captions.keywords },
  look: { base: x.grade },
  transitions: x.transitions,
  punch: x.pace.punch,
  cutEvery: x.pace.cutEvery,
  jumpCut: x.pace.jumpCut,
  sfx: [...x.sfx],
  beatSync: x.beatSync,
  speedRamp: x.speedRamp,
  broll: x.broll,
  split: x.split,
  overlays: x.overlays.map((o) => ({ ...o })),
  cta: { ...x.cta },
  musicMood: x.music,
});
