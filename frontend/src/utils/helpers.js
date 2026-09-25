import { format, parseISO } from 'date-fns';

export function formatCurrency(amount) {
  if (amount === null || amount === undefined) return 'ETB 0';
  return new Intl.NumberFormat('en-ET', {
    style: 'currency',
    currency: 'ETB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(num) {
  if (num === null || num === undefined) return '0';
  return new Intl.NumberFormat('en-US').format(num);
}

export function formatPercent(value) {
  if (value === null || value === undefined) return '0%';
  return `${parseFloat(value).toFixed(1)}%`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
    return format(d, 'MMM dd, yyyy');
  } catch {
    return dateStr;
  }
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '';
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
    return format(d, 'MM/dd');
  } catch {
    return dateStr;
  }
}

export function getAchievementColor(pct) {
  if (pct >= 100) return 'text-green-600';
  if (pct >= 75) return 'text-green-500';
  if (pct >= 50) return 'text-yellow-600';
  return 'text-red-600';
}

export function getAchievementBg(pct) {
  if (pct >= 100) return 'bg-green-100 text-green-800';
  if (pct >= 75) return 'bg-green-50 text-green-700';
  if (pct >= 50) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

export function getProgressBarColor(pct) {
  if (pct >= 100) return 'bg-green-500';
  if (pct >= 75) return 'bg-green-400';
  if (pct >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

export const PERIOD_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

export const MONTH_OPTIONS = [
  '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
  '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
  '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
];

export const CATEGORY_OPTIONS = [
  { value: 'messaging', label: 'Messaging' },
  { value: 'content', label: 'Content' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'utility', label: 'Utility' },
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'other', label: 'Other' },
];

/**
 * Read an image File as the bare base64 payload of its data URL (no
 * `data:...;base64,` prefix) — the shape the manager-photo upload endpoint
 * expects in its JSON body.
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the selected file'));
    reader.readAsDataURL(file);
  });
}
