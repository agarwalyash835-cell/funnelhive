// The dashboard's skins (client/src/skins.js has the look of each): a person picks one for themselves, an agency
// picks the default its client accounts start with, so white-labelled products don't all look alike.
// No imports: the client's tests import this file directly to check the two lists match.
export const SKIN_IDS = ['classic', 'glass', 'softwash', 'midnight', 'warm', 'graphite'];
export const cleanSkin = (v) => (SKIN_IDS.includes(String(v || '')) ? String(v) : '');
