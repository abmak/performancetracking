// Date filter persistence using localStorage
// Saves filter selections so they persist across page navigation

const FILTER_KEY = 'vas_date_filters';

// Generate dynamic defaults based on current month
function getCurrentMonthDefaults() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    global_start: `${y}-${m}-01`,
    global_end: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
    dashboard_start: `${y}-${m}-01`,
    dashboard_end: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
    targets_start: `${y}-${m}-01`,
    targets_end: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
    alerts_start: `${y}-${m}-01`,
    alerts_end: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
    reports_start: `${y}-${m}-01`,
    reports_end: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
    ai_start: `${y}-${m}-01`,
    ai_end: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
    partner_start: `${y}-${m}-01`,
    partner_end: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
    partner_month: '',
  };
}

const DEFAULTS = getCurrentMonthDefaults();

export function getDateFilter(key) {
  try {
    const stored = localStorage.getItem(FILTER_KEY);
    if (stored) {
      const filters = JSON.parse(stored);
      if (filters[key] !== undefined && filters[key] !== '') return filters[key];
    }
  } catch (e) {
    // ignore
  }
  // Auto-persist the default so subsequent reads return it too
  const def = DEFAULTS[key];
  if (def) {
    try {
      const stored = localStorage.getItem(FILTER_KEY);
      const filters = stored ? JSON.parse(stored) : {};
      filters[key] = def;
      localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    } catch {}
  }
  return def;
}

export function setDateFilter(key, value) {
  try {
    const stored = localStorage.getItem(FILTER_KEY);
    const filters = stored ? JSON.parse(stored) : {};
    filters[key] = value;
    localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
  } catch (e) {
    // ignore
  }
}
