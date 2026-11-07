// Mission configuration every agent reads at start-up (like the house site): which house design to
// build and which single wood type it is made of. Set HOUSE_DESIGN / HOUSE_WOOD in .env; the stage
// script writes HOUSE_WOOD for the most common wood near the site it picks.

export const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry'];
export const DESIGNS = ['starter', 'nordic'];

export const WOOD = (process.env.HOUSE_WOOD || 'oak').trim().toLowerCase();
if (!WOODS.includes(WOOD)) throw new Error(`HOUSE_WOOD must be one of ${WOODS.join(', ')}`);
export const DESIGN = (process.env.HOUSE_DESIGN || 'starter').trim().toLowerCase();
if (!DESIGNS.includes(DESIGN)) throw new Error(`HOUSE_DESIGN must be one of ${DESIGNS.join(', ')}`);

/** The house wood's version of an item, e.g. wood('planks') -> 'spruce_planks'. */
export const wood = suffix => `${WOOD}_${suffix}`;
/** Readable item name for chat: 'spruce_stairs' -> 'spruce stairs'. */
export const pretty = name => name.replace(/_/g, ' ');
