// Hive tools for running the Academy (the members area, school.js), beside the ones in hive.js that build it
// (create_course, add_quiz, create_space, post_to_community): who is stuck, who finished, students' unanswered
// questions and community posts; answering them, changing the Academy's settings and editing a course's lessons.
// Reading runs; anything a student will see, a setting, or removing lessons waits for the seller's Confirm (OK).
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const DAY = 86400000;
const clip = (v, n) => String(v ?? '').slice(0, n);

export const TOOLS = [
  {
    name: 'academy_students', description: 'The Academy’s students and how far along they are: per course lessons done / total, last seen, points and level. Filter: stuck (no visit for `days`, not finished), not_started, finished, active (seen in `days`). Use it to answer “who is stuck”, “who finished”, “how is my course doing”.',
    schema: S({ course: str('Only this course (name or id), optional'), filter: { type: 'string', enum: ['all', 'stuck', 'not_started', 'finished', 'active'] }, days: { type: 'number', description: 'For stuck / active: days (default 7)' } }),
    run: async (ctx, a) => {
      const list = await ctx.call('GET', '/school/students');
      const days = Math.max(1, Math.min(365, Number(a.days) || 7)), now = Date.now();
      const all = list.filter((s) => !s.banned).map((s) => {
        const cs = s.courses.filter((c) => !a.course || c.id === a.course || c.name.toLowerCase().includes(String(a.course).toLowerCase()));
        return { id: s.id, name: s.name || s.email, email: s.email, lastSeenDaysAgo: s.lastSeenAt ? Math.floor((now - s.lastSeenAt) / DAY) : null, level: s.level, points: s.points, courses: cs.map((c) => ({ course: c.name, done: c.done, lessons: c.lessons, percent: Math.round((c.done / c.lessons) * 100) })) };
      }).filter((s) => !a.course || s.courses.length);
      const quiet = (s) => s.lastSeenDaysAgo == null || s.lastSeenDaysAgo >= days;
      const pick = {
        stuck: (s) => quiet(s) && s.courses.some((c) => c.percent < 100),
        not_started: (s) => s.courses.length && s.courses.every((c) => c.done === 0),
        finished: (s) => s.courses.some((c) => c.percent === 100),
        active: (s) => !quiet(s),
      }[a.filter] || (() => true);
      const hit = all.filter(pick);
      return { total: all.length, matching: hit.length, students: hit.slice(0, 50) };
    },
    summary: (r) => `Looked at ${r.total} student${r.total === 1 ? '' : 's'} (${r.matching} matching)`,
  },
  {
    name: 'academy_questions', description: 'Students’ questions under lessons (unanswered first): id, student, course, lesson, question. Use before answer_question.',
    schema: S({ unansweredOnly: { type: 'boolean', description: 'Default true' } }),
    run: async (ctx, a) => {
      const rows = await ctx.call('GET', '/school/questions');
      const list = rows.filter((r) => !r.parentId && (a.unansweredOnly === false || !r.answered));
      return { total: list.length, questions: list.slice(0, 40).map((r) => ({ id: r.id, student: r.author?.name || '', course: r.course, lesson: r.lesson, question: clip(r.body, 600), answered: !!r.answered, at: new Date(r.at).toISOString().slice(0, 10) })) };
    },
    summary: (r) => `Found ${r.total} question${r.total === 1 ? '' : 's'} from students`,
  },
  {
    name: 'answer_question', description: 'Answer a student’s question under a lesson, as the Academy (waits for the seller’s Confirm; the student is notified). Write a warm, clear answer in the student’s language.',
    schema: S({ questionId: str('The question id from academy_questions'), answer: str('The answer') }, ['questionId', 'answer']),
    run: async (ctx, a) => { await ctx.call('POST', `/school/questions/${encodeURIComponent(a.questionId)}/answer`, { body: a.answer }); return { ok: true }; },
    summary: () => 'Answered the student’s question',
  },
  {
    name: 'academy_posts', description: 'Recent community posts in the Academy (all spaces, or one): id, space, author, text, comments count — to spot posts that need a reply.',
    schema: S({ spaceId: str('Only this space (id from school_overview), optional') }),
    run: async (ctx, a) => {
      const school = await ctx.call('GET', '/school');
      const spaces = (school.spaces || []).filter((s) => !a.spaceId || s.id === a.spaceId).slice(0, 8);
      const posts = [];
      for (const sp of spaces) for (const p of (await ctx.call('GET', `/school/spaces/${sp.id}/posts`)).slice(0, 15)) posts.push({ id: p.id, space: sp.name, author: p.author?.name || '', byYou: p.author?.kind === 'owner', title: p.title, text: clip(p.body, 400), comments: p.comments ?? null, at: new Date(p.at).toISOString().slice(0, 10) });
      posts.sort((x, y) => (x.at < y.at ? 1 : -1));
      return { total: posts.length, posts: posts.slice(0, 40) };
    },
    summary: (r) => `Read ${r.total} community post${r.total === 1 ? '' : 's'}`,
  },
  {
    name: 'reply_to_post', description: 'Comment on a community post as the Academy (waits for the seller’s Confirm).',
    schema: S({ postId: str('Post id from academy_posts'), text: str('The comment') }, ['postId', 'text']),
    run: async (ctx, a) => { await ctx.call('POST', `/school/posts/${encodeURIComponent(a.postId)}/comments`, { body: a.text }); return { ok: true }; },
    summary: () => 'Replied in the community',
  },
  {
    name: 'academy_settings', description: 'Change the Academy’s settings (waits for the seller’s Confirm): name, tagline, welcome message, language (en, hi, mr, gu, bn, ta, te, kn, ml, pa, or, hinglish), open sign-up, AI tutor, and protection — noDownloads (nothing can be saved), watermark (off / subtle / strong), appOnly (on Android, lessons play only in the AiHive Academy app). Only send what changes.',
    schema: S({ name: str('Academy name'), tagline: str('One line under the name'), welcome: str('Welcome message'), lang: str('Language code'), openJoin: { type: 'boolean' }, tutor: { type: 'boolean' }, noDownloads: { type: 'boolean' }, watermark: { type: 'string', enum: ['off', 'subtle', 'strong'] }, appOnly: { type: 'boolean' } }),
    run: async (ctx, a) => { if (!Object.keys(a || {}).length) throw new Error('Say which setting to change'); const s = await ctx.call('PUT', '/school/settings', a); return { ok: true, settings: { name: s.name, lang: s.lang, openJoin: s.openJoin, tutor: s.tutor, noDownloads: s.noDownloads, watermark: s.watermark, appOnly: s.appOnly } }; },
    summary: (r, a) => `Changed the Academy settings (${Object.keys(a).join(', ')})`,
  },
  {
    name: 'give_course_access', description: 'Give someone a course (or any product) directly by email — a team member who wants to check it, a guest, a buyer who paid offline. They get it in their Academy library; notify sends them an email with the link. Use this instead of coupons, checkouts or price changes. Waits for the seller’s Confirm.',
    schema: S({ productId: str('Course (product) id from school_overview / list_products'), email: str('Their email'), name: str('Their name (optional)'), notify: { type: 'boolean', description: 'Email them the link (default true)' } }, ['productId', 'email']),
    run: async (ctx, a) => {
      const r = await ctx.call('POST', `/products/${encodeURIComponent(a.productId)}/grant`, { email: a.email, name: a.name || '', notify: a.notify !== false });
      return { ok: true, email: a.email, library: r.library, emailed: a.notify !== false };
    },
    summary: (r) => `Gave ${r.email} access${r.emailed ? ' and emailed them the link' : ''}`,
  },
  {
    name: 'edit_course', description: 'Edit an existing course’s lessons: rename the course; rename lessons or move them between modules (section); drip (dripDays after joining); level gate (minLevel 1–9); free preview; reorder (order = all lesson ids in the new order); remove lessons (waits for Confirm). Get lesson ids from get_course first. Lesson text, videos and files stay as they are.',
    schema: S({
      productId: str('Course (product) id'), name: str('New course name (optional)'),
      lessons: { type: 'array', description: 'Changes per lesson', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, section: { type: 'string' }, dripDays: { type: 'number' }, minLevel: { type: 'number' }, free: { type: 'boolean' } }, required: ['id'], additionalProperties: false } },
      order: { type: 'array', description: 'Every lesson id, in the new order (optional)', items: { type: 'string' } },
      remove: { type: 'array', description: 'Lesson ids to delete (optional)', items: { type: 'string' } },
    }, ['productId']),
    run: async (ctx, a) => {
      const p = await ctx.call('GET', `/products/${encodeURIComponent(a.productId)}`);
      const known = new Set(p.lessons.map((l) => l.id));
      const bad = [...(a.lessons || []).map((l) => l.id), ...(a.order || []), ...(a.remove || [])].filter((id) => !known.has(id));
      if (bad.length) throw new Error(`Unknown lesson id(s): ${[...new Set(bad)].join(', ')} — use get_course for the ids`);
      const patch = Object.fromEntries((a.lessons || []).map((l) => [l.id, l]));
      let lessons = p.lessons.filter((l) => !(a.remove || []).includes(l.id)).map((l) => { const c = patch[l.id] || {}; const { id, ...rest } = c; return { ...l, ...rest, ...('minLevel' in c && Number(c.minLevel) <= 1 ? { minLevel: undefined } : {}) }; });
      if (a.order?.length) { const pos = new Map(a.order.map((id, i) => [id, i])); lessons = [...lessons].sort((x, y) => (pos.get(x.id) ?? 1e9) - (pos.get(y.id) ?? 1e9)); }
      const r = await ctx.call('PUT', `/products/${encodeURIComponent(p.id)}`, { ...(a.name ? { name: a.name } : {}), lessons });
      return { id: r.id, name: r.name, lessons: r.lessons.map((l) => ({ id: l.id, title: l.title, section: l.section || '', dripDays: l.dripDays || 0, ...(l.minLevel ? { minLevel: l.minLevel } : {}), ...(l.free ? { free: true } : {}) })) };
    },
    summary: (r) => `Updated “${r.name}” (${r.lessons.length} lessons)`,
  },
];

// the Confirm card's line: students see these, settings change, or lessons go
export const OK = {
  answer_question: (a) => `Answer a student’s question: “${clip(a.answer, 80)}${String(a.answer || '').length > 80 ? '…' : ''}”`,
  give_course_access: (a) => `Give ${clip(a.email, 80)} access to this course${a.notify === false ? '' : ' (they get an email with the link)'}`,
  reply_to_post: (a) => `Reply in your community: “${clip(a.text, 80)}${String(a.text || '').length > 80 ? '…' : ''}”`,
  academy_settings: (a) => (!Object.keys(a || {}).length ? null : `Change Academy settings: ${Object.entries(a).map(([k, v]) => `${k} → ${typeof v === 'string' ? clip(v, 40) : v}`).join(', ')}`),
  edit_course: (a) => (a.remove?.length ? `Edit the course and DELETE ${a.remove.length} lesson${a.remove.length === 1 ? '' : 's'} (students lose their progress in them)` : null),
};
