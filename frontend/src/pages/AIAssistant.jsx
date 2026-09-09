import { useState, useEffect, useRef } from 'react';
import { Bot, Send, Sparkles, Lightbulb, TrendingUp, Users, AlertTriangle, BarChart3, Loader2 } from 'lucide-react';

const API_BASE = '/api';
const getAuthHeaders = () => {
  const token = localStorage.getItem('vas_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem('vas_user') || '{}'); } catch { return {}; }
}

const formatETB = (amount) => {
  if (amount >= 1e9) return `ETB ${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `ETB ${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `ETB ${(amount / 1e3).toFixed(1)}K`;
  return `ETB ${amount.toLocaleString()}`;
};

const suggestedQuestions = [
  { icon: TrendingUp, text: 'What is the overall revenue achievement?', color: 'text-green-600' },
  { icon: AlertTriangle, text: 'Which services are critically underperforming?', color: 'text-red-600' },
  { icon: Users, text: 'Who are the top 3 partners by revenue?', color: 'text-blue-600' },
  { icon: BarChart3, text: 'How is the monthly revenue trend?', color: 'text-purple-600' },
  { icon: Sparkles, text: 'Recommend actions to improve revenue', color: 'text-amber-600' },
  { icon: Lightbulb, text: 'Compare service performance against targets', color: 'text-emerald-600' },
];

const WELCOME_MSG = {
  role: 'assistant',
  content: '👋 Hello! I\'m your **VAS AI Assistant** powered by Gemini AI.\n\nI have access to your VAS revenue data including:\n- 📊 Service achievements & targets\n- 📈 Monthly revenue trends\n- 🤝 Top partner performance\n- 🔔 Revenue alerts & status\n\nAsk me anything about your VAS performance data!',
  timestamp: new Date().toISOString(),
};

export default function AIAssistant() {
  const [messages, setMessages] = useState([WELCOME_MSG]);
  const [sessionId, setSessionId] = useState(() => {
    // Resume last session or create new one
    const saved = localStorage.getItem('vas_ai_session');
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem('vas_ai_session', id);
    return id;
  });
  const [chatSessions, setChatSessions] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [quota, setQuota] = useState(null); // { used, max, remaining }
  const user = getCurrentUser();
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load chat history on mount
  useEffect(() => {
    if (user?.id) {
      // Load quota
      fetch(`${API_BASE}/ai/quota?user_id=${user.id}`, { headers: getAuthHeaders() })
        .then(r => r.json())
        .then(q => { if (q.used !== undefined) setQuota({ used: q.used, max: q.max, remaining: Math.max(0, q.max - q.used) }); })
        .catch(() => {});
      // Load chat history for current session
      fetch(`${API_BASE}/ai/history?user_id=${user.id}&session_id=${sessionId}`, { headers: getAuthHeaders() })
        .then(r => r.json())
        .then(history => {
          if (Array.isArray(history) && history.length > 0) {
            const loadedMessages = [
              WELCOME_MSG,
              ...history.map(m => ({
                role: m.role,
                content: m.content,
                timestamp: m.created_at,
              })),
            ];
            setMessages(loadedMessages);
          }
        })
        .catch(() => {});
      // Load session list
      loadSessions();
    }
  }, []);

  async function loadSessions() {
    if (!user?.id) return;
    try {
      const sessions = await fetch(`${API_BASE}/ai/history/sessions?user_id=${user.id}`, { headers: getAuthHeaders() }).then(r => r.json());
      if (Array.isArray(sessions)) setChatSessions(sessions);
    } catch {}
  }

  async function saveSingleMessage(role, content) {
    try {
      const u = JSON.parse(localStorage.getItem('vas_user') || '{}');
      const sid = localStorage.getItem('vas_ai_session');
      if (!u?.id || !sid || !content) return;
      await fetch(`${API_BASE}/ai/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ user_id: u.id, session_id: sid, role, content }),
      });
    } catch (err) {
      console.error('[AI] Failed to save message:', err);
    }
  }

  function startNewSession() {
    const id = crypto.randomUUID();
    localStorage.setItem('vas_ai_session', id);
    setSessionId(id);
    setMessages([WELCOME_MSG]);
    setShowHistory(false);
  }

  async function loadSession(sid) {
    setSessionId(sid);
    localStorage.setItem('vas_ai_session', sid);
    setShowHistory(false);
    try {
      const history = await fetch(`${API_BASE}/ai/history?user_id=${user.id}&session_id=${sid}`, { headers: getAuthHeaders() }).then(r => r.json());
      if (Array.isArray(history) && history.length > 0) {
        setMessages([
          WELCOME_MSG,
          ...history.map(m => ({ role: m.role, content: m.content, timestamp: m.created_at })),
        ]);
      } else {
        setMessages([WELCOME_MSG]);
      }
    } catch {}
  }

  async function deleteSession(sid) {
    if (!confirm('Delete this chat session?')) return;
    try {
      await fetch(`${API_BASE}/ai/history/${sid}?user_id=${user.id}`, { method: 'DELETE', headers: getAuthHeaders() });
      loadSessions();
      if (sid === sessionId) startNewSession();
    } catch {}
  }

  const sendMessage = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;

    const userMsg = { role: 'user', content: msg, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    // Save user message to DB
    saveSingleMessage('user', msg);
    setInput('');
    setLoading(true);

    try {
      const history = messages.slice(1).map(m => ({ role: m.role, content: m.content }));
      const res = await fetch(`${API_BASE}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ message: msg, history, user_id: user?.id }),
      });
      const data = await res.json();
      if (data.reply) {
        const assistantMsg = { role: 'assistant', content: data.reply, timestamp: data.timestamp };
        setMessages(prev => [...prev, assistantMsg]);
        // Save assistant response to DB
        saveSingleMessage('assistant', data.reply);
        if (data.quota) setQuota(data.quota);
        loadSessions(); // Refresh session list
      } else if (data.error === 'quota_exceeded') {
        setMessages(prev => [...prev, { role: 'assistant', content: data.message || '⚠️ Daily AI quota reached.', timestamp: new Date().toISOString() }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Error: ${data.error || 'Failed to get response'}`, timestamp: new Date().toISOString() }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Connection error: ${err.message}`, timestamp: new Date().toISOString() }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Simple markdown-like formatting
  function formatMessage(text) {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code class="bg-gray-100 px-1 rounded text-xs">$1</code>')
      .replace(/\n/g, '<br/>');
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg">
          <Bot size={22} className="text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            VAS AI Assistant
            <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[10px] font-semibold flex items-center gap-1">
              <Sparkles size={10} /> Powered by Gemini
            </span>
          </h1>
          <p className="text-xs text-gray-500">Ask anything about your VAS revenue data</p>
        </div>          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadSessions(); }}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs text-gray-600 transition"
            >
              📋 History
            </button>
            <button
              onClick={startNewSession}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-green-100 hover:bg-green-200 rounded-lg text-xs text-green-700 transition"
            >
              ✨ New Chat
            </button>
          {quota && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-lg">
              <span className="text-[11px] text-gray-500">Quota:</span>
              <span className={`text-[11px] font-semibold ${quota.remaining <= 5 ? 'text-red-600' : quota.remaining <= 15 ? 'text-amber-600' : 'text-green-600'}`}>
                {quota.used}/{quota.max}
              </span>
              <span className="text-[10px] text-gray-400">({quota.remaining} left)</span>
            </div>
          )}
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <span className="text-xs text-gray-500">Online</span>
        </div>
      </div>

      {/* Chat History Panel */}
      {showHistory && (
        <div className="bg-white border-b border-gray-200 px-6 py-3 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-600">Chat Sessions</p>
            <button onClick={() => setShowHistory(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
          </div>
          {chatSessions.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No previous sessions</p>
          ) : (
            <div className="space-y-1">
              {chatSessions.map(s => (
                <div key={s.session_id} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${
                  s.session_id === sessionId ? 'bg-green-50 border border-green-200' : 'hover:bg-gray-50'
                }`}>
                  <button
                    onClick={() => loadSession(s.session_id)}
                    className="flex-1 text-left truncate"
                  >
                    <span className="font-medium text-gray-700">{s.first_question?.substring(0, 60) || 'New chat'}...</span>
                    <span className="text-gray-400 ml-2">({s.message_count} msgs)</span>
                    <span className="text-gray-400 ml-2">{new Date(s.last_message_at).toLocaleDateString()}</span>
                  </button>
                  <button onClick={() => deleteSession(s.session_id)} className="ml-2 text-gray-400 hover:text-red-500">🗑</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-gradient-to-b from-gray-50 to-white">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] ${msg.role === 'user' ? 'order-2' : 'order-1'}`}>
              {msg.role === 'assistant' && (
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                    <Bot size={12} className="text-white" />
                  </div>
                  <span className="text-xs font-medium text-gray-500">VAS AI</span>
                </div>
              )}
              <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-green-600 text-white rounded-br-md'
                  : 'bg-white border border-gray-200 text-gray-800 rounded-bl-md shadow-sm'
              }`}>
                <div dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }} />
              </div>
              <div className={`text-[10px] text-gray-400 mt-1 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="max-w-[75%]">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                  <Bot size={12} className="text-white" />
                </div>
                <span className="text-xs font-medium text-gray-500">VAS AI</span>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2 text-gray-500">
                  <Loader2 size={14} className="animate-spin text-green-600" />
                  <span className="text-sm">Analyzing your data...</span>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Questions (always visible) */}
      <div className="px-6 py-3 bg-white border-t border-gray-100">
        <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5">
          <Lightbulb size={12} className="text-amber-500" /> Suggested Questions
        </p>
        <div className="flex flex-wrap gap-2">
          {suggestedQuestions.map((q, i) => {
            const Icon = q.icon;
            return (
              <button
                key={i}
                onClick={() => sendMessage(q.text)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-green-50 border border-gray-200 hover:border-green-300 rounded-full text-xs text-gray-700 hover:text-green-700 transition-all"
              >
                <Icon size={12} className={q.color} />
                {q.text}
              </button>
            );
          })}
        </div>
      </div>

      {/* Input Area */}
      <div className="px-6 py-4 bg-white border-t border-gray-200">
        <div className="flex items-end gap-3">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about VAS revenue, services, partners, targets..."
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm resize-none focus:ring-2 focus:ring-green-500 focus:border-green-500 pr-12"
              rows={1}
              style={{ minHeight: '44px', maxHeight: '120px' }}
              onInput={(e) => { e.target.style.height = '44px'; e.target.style.height = e.target.scrollHeight + 'px'; }}
            />
          </div>
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
              input.trim() && !loading
                ? 'bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-200'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Send size={18} />
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-2 text-center">
          AI-generated insights based on your VAS revenue data. Press Enter to send.
        </p>
      </div>
    </div>
  );
}
