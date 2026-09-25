import { useEffect, useState } from 'react';
import { Image as ImageIcon, Loader2 } from 'lucide-react';

const API_BASE = '/api';

/**
 * A company manager photo for a TIN, rendered anywhere in the channel module.
 *
 * A plain `<img src="/api/channel/photo/...">` cannot work: the request would
 * go out without the `Authorization` header and be rejected by the router's
 * access guard. So the photo is fetched with the signed-in user's token and
 * rendered from a blob URL instead.
 *
 * `bust` (a timestamp) forces a re-fetch after an upload or a fresh TIN
 * verification replaces the stored photo.
 */
export default function ManagerPhoto({ tin, alt = 'Company manager photo', className = '', bust = 0 }) {
  const [src, setSrc] = useState(null);
  const [state, setState] = useState('loading'); // loading | ok | missing

  useEffect(() => {
    if (!tin) {
      setState('missing');
      return undefined;
    }
    let cancelled = false;
    let objectUrl = null;
    setState('loading');
    (async () => {
      try {
        const token = localStorage.getItem('vas_token');
        const res = await fetch(
          `${API_BASE}/channel/photo/${encodeURIComponent(tin)}${bust ? `?t=${bust}` : ''}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (!res.ok) throw new Error('No manager photo on record');
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
        setState('ok');
      } catch {
        if (!cancelled) {
          setSrc(null);
          setState('missing');
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [tin, bust]);

  if (state === 'ok' && src) {
    return <img src={src} alt={alt} className={className} />;
  }

  if (state === 'loading') {
    return (
      <div className={`${className} flex items-center justify-center bg-slate-800 text-slate-400`}>
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div
      className={`${className} flex items-center justify-center bg-slate-100 text-slate-300`}
      title={tin ? `No manager photo on record for TIN ${tin}` : 'No TIN on record'}
    >
      <ImageIcon size={16} />
    </div>
  );
}
