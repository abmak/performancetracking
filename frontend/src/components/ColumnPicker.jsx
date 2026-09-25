import { useEffect, useRef, useState } from 'react';
import { Settings2, Check } from 'lucide-react';

/**
 * A per-table column-visibility picker.
 *
 * Renders a small gear button; the dropdown lists every hideable column with a
 * checkbox. Selection persists to localStorage under the `storageKey`, so an
 * operator's preferred column set survives reloads — per table, per browser.
 *
 * `columns` is the full ordered list: [{ key, label, always? }]. Columns marked
 * `always` (identity like the name, or the actions cell) render in the dropdown
 * as locked and can never be hidden.
 *
 * `visible`/`setVisible` are owned by the parent (a `useColumnPrefs` state) so
 * the table itself just reads `visible.has(key)`.
 */
export default function ColumnPicker({ columns, visible, setVisible, storageKey, label = 'Columns' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function toggle(key) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch { /* private mode */ }
      return next;
    });
  }

  function showAll() {
    const all = columns.map((c) => c.key);
    setVisible(new Set(all));
    try {
      localStorage.setItem(storageKey, JSON.stringify(all));
    } catch { /* private mode */ }
  }

  const hideable = columns.filter((c) => !c.always);
  const hiddenCount = hideable.filter((c) => !visible.has(c.key)).length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
        title={`${label} — choose which columns to show`}
      >
        <Settings2 size={14} />
        {label}
        {hiddenCount > 0 && (
          <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded-full">
            {hiddenCount} hidden
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-60 bg-white border border-gray-200 rounded-xl shadow-lg py-2 max-h-80 overflow-y-auto">
          <div className="px-3 pb-2 flex items-center justify-between border-b border-gray-100">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Shown columns</p>
            <button
              type="button"
              onClick={showAll}
              className="text-[11px] font-medium text-blue-600 hover:text-blue-800"
            >
              Show all
            </button>
          </div>
          {columns.map((c) => {
            const locked = Boolean(c.always);
            const shown = visible.has(c.key);
            return (
              <label
                key={c.key}
                className={`flex items-center gap-2.5 px-3 py-1.5 text-xs ${locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}
              >
                <input
                  type="checkbox"
                  checked={shown}
                  disabled={locked}
                  onChange={() => !locked && toggle(c.key)}
                  className="h-3.5 w-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <span className="text-gray-700 font-medium">{c.label}</span>
                {locked && (
                  <span className="ml-auto inline-flex items-center gap-0.5 text-[9px] text-gray-400">
                    <Check size={10} /> fixed
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Read a saved column set (or default to "everything") for a storage key. */
export function loadColumnPrefs(storageKey, allKeys) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Set(allKeys);
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return new Set(allKeys);
    const set = new Set(saved.filter((k) => allKeys.includes(k)));
    // A saved set that hides everything would blank the table — always keep
    // at least the first key as a floor.
    if (set.size === 0 && allKeys.length) set.add(allKeys[0]);
    return set;
  } catch {
    return new Set(allKeys);
  }
}
