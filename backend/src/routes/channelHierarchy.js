/**
 * Hierarchy relink — the repair pass that keeps child counts honest.
 *
 * Every "how many Sub-Distributors / Retailers sit under this user" figure in
 * the channel module is counted from `channel_entities.parent_id` /
 * `owner_id`. Those foreign keys are resolved from `parent_mobile` /
 * `owner_mobile` when a row is written — but the registry changes shape after
 * the fact:
 *
 *   • a Distributor is deleted (force) and later re-registered with the same
 *     mobile — a NEW row id. Every child still points its FKs at the dead id,
 *     so the distributor's Sub-Distributor / Retailer counts read 0 forever,
 *     even though each child's mobile columns still name it correctly.
 *   • rows are written before their upline exists (out-of-order files) — the
 *     FKs stay NULL and never fill in on their own.
 *   • an upline row's FKs dangle after its own distributor was removed.
 *
 * `relinkHierarchy()` re-derives the links with three conservative rules, so a
 * single call after any of those events restores the whole tree:
 *
 *   1. RESOLVE — when a row's own mobile columns name a registered user, the
 *      FKs follow them (this is what re-attaches children to a re-registered
 *      distributor). An owner column that resolves to nothing falls back to
 *      the parent's owner, then the parent itself — the same convention the
 *      import uses.
 *   2. KEEP   — when the mobile columns say nothing (auto-created uplines
 *      carry none by design) but the existing FKs point at real rows, they are
 *      left untouched. A working link is never "repaired" into nothing.
 *   3. CLEAR  — FKs that point at a row which no longer exists are re-resolved
 *      from the mobile columns or nulled, so no count ever reads a ghost.
 *
 * A row is never made its own parent or owner.
 */

const pool = require('../config/database');

const CHUNK = 500;

const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

async function relinkHierarchy() {
  const [all] = await pool.query(
    `SELECT e.id, e.mobile_number, e.parent_mobile, e.owner_mobile, e.parent_id, e.owner_id
       FROM channel_entities e`
  );
  if (!all.length) return { scanned: 0, fixed: 0, cleared: 0 };

  const byMobile = new Map(all.map((r) => [String(r.mobile_number), r]));
  const byId = new Map(all.map((r) => [Number(r.id), r]));

  let fixed = 0;
  let cleared = 0;
  const pending = []; // [parentId, ownerId, id]

  const sameId = (a, b) => Number(a || 0) === Number(b || 0);

  for (const row of all) {
    const self = Number(row.id);

    // Rule 1 — follow the row's own mobile columns wherever they lead.
    let parentId = row.parent_mobile ? byMobile.get(String(row.parent_mobile))?.id ?? null : null;
    let ownerId = row.owner_mobile ? byMobile.get(String(row.owner_mobile))?.id ?? null : null;
    const mobilesResolve = parentId !== null || ownerId !== null;

    if (mobilesResolve) {
      // Owner completion, importer-style: an unresolvable owner falls back to
      // the parent's owner, then to the parent itself.
      if (!ownerId && parentId) {
        const p = byId.get(Number(parentId));
        ownerId = p?.owner_id || parentId;
      }
      // Direct-child convention, also importer-style: a row that names its
      // owner but no parent is a direct child — its parent IS its owner
      // (`resolveUplines` writes both FKs to the same id). Without this the
      // relink would null parent_id on every direct child and the
      // "Direct" / downstream counts would drop to 0.
      if (ownerId && !parentId) parentId = ownerId;
    } else {
      // Rule 2 — mobiles say nothing; keep FKs that still point at real rows.
      const parentAlive = row.parent_id ? byId.has(Number(row.parent_id)) : false;
      const ownerAlive = row.owner_id ? byId.has(Number(row.owner_id)) : false;
      if ((!row.parent_id || parentAlive) && (!row.owner_id || ownerAlive)) continue;

      // Rule 3 — dangling links: try the mobiles once more (they were already
      // null here), otherwise clear the ghosts so counts read honestly.
      parentId = null;
      ownerId = null;
      cleared += 1;
    }

    if (sameId(parentId, self)) parentId = null;
    if (sameId(ownerId, self)) ownerId = null;

    if (sameId(parentId, row.parent_id) && sameId(ownerId, row.owner_id)) continue;
    pending.push([parentId, ownerId, self]);
  }

  for (const chunk of chunkArray(pending, CHUNK)) {
    const cases = chunk.map(() => 'WHEN ? THEN ?').join(' ');
    const ids = chunk.map(([, , id]) => id);
    await pool.query(
      `UPDATE channel_entities
          SET parent_id = CASE id ${cases} END,
              owner_id  = CASE id ${cases} END
        WHERE id IN (${ids.map(() => '?').join(',')})`,
      [
        ...ids.flatMap((id, i) => [id, chunk[i][0]]),
        ...ids.flatMap((id, i) => [id, chunk[i][1]]),
        ...ids,
      ]
    );
    fixed += chunk.length;
  }

  return { scanned: all.length, fixed, cleared };
}

module.exports = { relinkHierarchy };
