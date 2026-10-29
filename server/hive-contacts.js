// Hive tools for duplicate contacts (contacts-merge.js): { name, description, schema, run(ctx, args), summary } like the
// tools in hive.js. Listing duplicates just reads; merging waits for the seller's Confirm (OK).
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });

export const TOOLS = [
  {
    name: 'find_duplicate_contacts', description: 'List likely duplicate contacts in the CRM (same phone number, same email, or a very similar name in the same city), each group with the reason and the contact suggested to keep. Use before merge_contacts.',
    schema: S({ key: str('Only the groups this contact (its key) is in (optional)') }),
    run: async (ctx, a) => {
      const d = await ctx.call('GET', `/contacts/duplicates${a.key ? `?key=${encodeURIComponent(a.key)}` : ''}`);
      return { total: d.groups.length, groups: d.groups.slice(0, 30).map((g) => ({ reasons: g.reasons, suggested_keep: g.suggested, contacts: g.contacts.map((c) => ({ key: c.key, name: c.name, email: c.email, phone: c.phone, orders: c.orders, city: c.city || undefined })) })) };
    },
    summary: (r) => `Found ${r.total} group${r.total === 1 ? '' : 's'} of likely duplicates`,
  },
  {
    name: 'merge_contacts', description: 'Merge 2–20 duplicate contacts into one (waits for the seller’s Confirm): orders, timeline, chats, automations and tags move to the kept contact; opt-outs are kept; the others are removed. Use the exact keys from find_duplicate_contacts.',
    schema: S({ primary: str('Key of the contact to keep'), keys: { type: 'array', description: 'Keys of the contacts to merge into it', items: { type: 'string' } } }, ['primary', 'keys']),
    run: async (ctx, a) => {
      const r = await ctx.call('POST', '/contacts/merge', { primary: a.primary, keys: [a.primary, ...(a.keys || [])] });
      return { ok: true, kept: r.key, merged: r.merged };
    },
    summary: (r) => `Merged ${r.merged?.length || 0} contact${r.merged?.length === 1 ? '' : 's'} into ${r.kept}`,
  },
];
// the Confirm card's line
export const OK = {
  merge_contacts: (a) => `Merge ${(a.keys || []).filter((k) => k !== a.primary).length} contact(s) into ${a.primary}: ${(a.keys || []).filter((k) => k !== a.primary).join(', ')} — they are removed and everything moves to the kept contact`,
};

