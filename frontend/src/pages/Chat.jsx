import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Users, Plus, Search, Send, ArrowLeft, Settings, Trash2, X, UserPlus, Hash, Smile, Image, Mic, Square, Paperclip, FileText, Volume2, VolumeX } from 'lucide-react';
import { chatAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { playSentSound, playIncomingSound, playSoundPreview, isChatSoundMuted, setChatSoundMuted } from '../utils/chatSounds';

// Common emojis for the picker
const EMOJI_CATEGORIES = [
  { name: 'Smileys', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥'] },
  { name: 'Gestures', emojis: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👏', '🙌', '🤝', '🙏', '💪', '🦾', '👋'] },
  { name: 'Objects', emojis: ['📊', '📈', '📉', '💰', '💳', '🏦', '📧', '📱', '💻', '🖥️', '⌨️', '📁', '📂', '📋', '📌', '📎', '🔍', '🔒', '🔑', '🎁', '🎯', '🏆', '⭐', '🔥'] },
  { name: 'Hearts', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '💖', '💗', '💓', '💞', '💕', '❣️', '♥️'] },
];

function formatTime(d) {
  if (!d) return '';
  const date = new Date(d);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function getLastMessagePreview(msg) {
  if (!msg) return 'No messages yet';
  const text = msg.message_text || '';
  return text.length > 40 ? text.substring(0, 40) + '…' : text;
}

const senderColors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500', 'bg-indigo-500', 'bg-red-500', 'bg-amber-500', 'bg-cyan-500'];

// Max allowed attachment size — must match the backend limit (50MB)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

function formatFileSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function validateFileSize(file) {
  if (file && file.size > MAX_FILE_SIZE) {
    alert(`"${file.name}" is ${formatFileSize(file.size)}, larger than the 50 MB limit. Please attach a smaller file.`);
    return false;
  }
  return true;
}

export default function Chat() {
  const { user } = useAuth();
  const currentUserId = user?.id;

  // Sidebar state
  const [sidebarTab, setSidebarTab] = useState('chats');
  const [conversations, setConversations] = useState([]);
  const [groups, setGroups] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Chat state
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  // Sound effects + typing indicator
  const [soundMuted, setSoundMuted] = useState(() => isChatSoundMuted());
  const [typingUsers, setTypingUsers] = useState([]);
  const maxMessageIdRef = useRef(null);
  const lastTypingSentRef = useRef(0);

  // Emoji picker
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState(0);
  const emojiRef = useRef(null);

  // Image upload
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const imageInputRef = useRef(null);

  // File attachment (documents, PDFs, etc.)
  const [fileAttachment, setFileAttachment] = useState(null); // { name, size, file }
  const fileInputRef = useRef(null);

  // Voice recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  // Message context menu
  const [contextMenu, setContextMenu] = useState(null);

  // Group creation
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);

  // Group settings
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [groupDetail, setGroupDetail] = useState(null);

  // New DM
  const [showNewChat, setShowNewChat] = useState(false);

  const loadData = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const convos = await chatAPI.getConversations(currentUserId).catch(() => []);
      setConversations(convos);
    } catch (err) { console.error('Conversations error:', err); }
    try {
      const userGroups = await chatAPI.getGroups(currentUserId).catch(() => []);
      setGroups(userGroups);
    } catch (err) { console.error('Groups error:', err); }
    try {
      // Chat's own contact list: everyone in the sections this user can chat in,
      // including people who switch into this section from another one.
      const users = await chatAPI.getContacts().catch(() => []);
      setAllUsers(Array.isArray(users) ? users : (users?.data || []));
    } catch (err) { console.error('Contacts error:', err); }
  }, [currentUserId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh messages + typing status every 3 seconds
  useEffect(() => {
    if (!activeChat) return;
    loadTyping(activeChat);
    const interval = setInterval(() => { loadMessages(activeChat); loadTyping(activeChat); }, 3000);
    return () => clearInterval(interval);
  }, [activeChat?.id, activeChat?.type]);

  // Close emoji picker on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (emojiRef.current && !emojiRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup recording on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  async function loadMessages(chat) {
    if (!chat) return;
    try {
      let msgs;
      if (chat.type === 'dm') {
        msgs = await chatAPI.getMessages(currentUserId, chat.id);
      } else {
        msgs = await chatAPI.getGroupMessages(chat.id);
      }
      const list = Array.isArray(msgs) ? msgs : [];
      const highestId = list.reduce((max, m) => (m.id > max ? m.id : max), 0);
      const previousHigh = maxMessageIdRef.current;
      if (list.length) maxMessageIdRef.current = highestId;
      // Chime only for genuinely new messages from other people.
      if (previousHigh !== null && list.some(m => m.id > previousHigh && m.sender_id !== currentUserId)) {
        playIncomingSound();
      }
      setMessages(list);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err) { console.error(err); }
  }

  // Who is typing in the open chat — best effort, never blocks the UI
  async function loadTyping(chat) {
    if (!chat || !currentUserId) return;
    try {
      const params = chat.type === 'dm'
        ? { user_id: currentUserId, other_user_id: chat.id }
        : { user_id: currentUserId, group_id: chat.id };
      const data = await chatAPI.getTyping(params);
      setTypingUsers(Array.isArray(data?.typing) ? data.typing : []);
    } catch (err) { /* typing indicator is best-effort */ }
  }

  // Throttled "I am typing" heartbeat; the server expires it automatically.
  function handleDraftChange(value) {
    setNewMessage(value);
    if (!activeChat || !currentUserId || !value.trim()) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2500) return;
    lastTypingSentRef.current = now;
    const payload = activeChat.type === 'dm'
      ? { user_id: currentUserId, receiver_id: activeChat.id }
      : { user_id: currentUserId, group_id: activeChat.id };
    chatAPI.sendTyping(payload).catch(() => {});
  }

  function toggleSound() {
    const next = !soundMuted;
    setSoundMuted(next);
    setChatSoundMuted(next);
    if (!next) playSoundPreview();
  }

  async function openChat(chat) {
    setActiveChat(chat);
    setMessages([]);
    setNewMessage('');
    maxMessageIdRef.current = null;
    setTypingUsers([]);
    setImagePreview(null);
    setImageFile(null);
    setAudioBlob(null);
    setShowEmojiPicker(false);
    setContextMenu(null);
    await loadMessages(chat);
    loadData();
  }

  // ===== SEND MESSAGE =====
  async function handleSend() {
    if ((!newMessage.trim() && !imageFile && !audioBlob && !fileAttachment) || !activeChat || sending) return;
    setSending(true);
    try {
      let messageText = newMessage.trim();
      let messageType = 'text';
      let mediaUrl = null;

      // Upload image if selected
      if (imageFile) {
        const formData = new FormData();
        formData.append('file', imageFile);
        const uploadResult = await chatAPI.uploadMedia(formData);
        mediaUrl = uploadResult.url;
        messageType = 'image';
        if (!messageText) messageText = '📷 Image';
      }

      // Upload a file attachment if selected
      if (fileAttachment && !imageFile) {
        const formData = new FormData();
        formData.append('file', fileAttachment.file);
        const uploadResult = await chatAPI.uploadMedia(formData);
        mediaUrl = uploadResult.url;
        messageType = 'file';
        if (!messageText) messageText = `📎 ${fileAttachment.name} (${formatFileSize(fileAttachment.size)})`;
      }

      // Upload voice if recorded
      if (audioBlob) {
        const formData = new FormData();
        formData.append('file', audioBlob, 'voice-message.webm');
        const uploadResult = await chatAPI.uploadMedia(formData);
        mediaUrl = uploadResult.url;
        messageType = 'voice';
        if (!messageText) messageText = '🎤 Voice message';
      }

      const payload = {
        sender_id: currentUserId,
        message_text: messageText,
        message_type: messageType,
        media_url: mediaUrl,
      };

      if (activeChat.type === 'dm') {
        await chatAPI.sendMessage({ ...payload, receiver_id: activeChat.id });
      } else {
        await chatAPI.sendGroupMessage(activeChat.id, payload);
      }
      playSentSound();
      lastTypingSentRef.current = 0;
      setNewMessage('');
      setImagePreview(null);
      setImageFile(null);
      setAudioBlob(null);
      setFileAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadMessages(activeChat);
      loadData();
    } catch (err) { alert(err.message); }
    setSending(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ===== DELETE MESSAGE =====
  async function handleDeleteMessage(msgId) {
    if (!confirm('Delete this message?')) return;
    try {
      await chatAPI.deleteMessage(msgId, currentUserId);
      setContextMenu(null);
      await loadMessages(activeChat);
    } catch (err) { alert(err.message); }
  }

  // ===== EMOJI PICKER =====
  function handleEmojiClick(emoji) {
    setNewMessage(prev => prev + emoji);
  }

  // ===== IMAGE UPLOAD =====
  function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!validateFileSize(file)) {
      e.target.value = '';
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  }

  function removeImagePreview() {
    setImagePreview(null);
    setImageFile(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  // ===== FILE ATTACHMENT =====
  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!validateFileSize(file)) {
      e.target.value = '';
      return;
    }
    setFileAttachment({ name: file.name, size: file.size, file });
    setImageFile(null);
    setImagePreview(null);
  }

  function removeFileAttachment() {
    setFileAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ===== VOICE RECORDING =====
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch (err) {
      alert('Microphone access denied. Please allow microphone access to record voice messages.');
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
  }

  function cancelRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setAudioBlob(null);
    setRecordingTime(0);
  }

  function formatRecordingTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ===== GROUP MANAGEMENT =====
  async function handleCreateGroup() {
    if (!groupName.trim()) return alert('Enter group name');
    try {
      await chatAPI.createGroup({ name: groupName, description: groupDesc, created_by: currentUserId, member_ids: selectedMembers });
      setShowCreateGroup(false);
      setGroupName(''); setGroupDesc(''); setSelectedMembers([]);
      loadData();
    } catch (err) { alert(err.message); }
  }

  async function handleDeleteGroup(id) {
    if (!confirm('Delete this group? All messages will be lost.')) return;
    try {
      await chatAPI.deleteGroup(id);
      setShowGroupSettings(false);
      setActiveChat(null);
      loadData();
    } catch (err) { alert(err.message); }
  }

  async function handleRemoveMember(groupId, userId) {
    if (!confirm('Remove this member?')) return;
    try {
      await chatAPI.removeGroupMember(groupId, userId);
      const detail = await chatAPI.getGroup(groupId);
      setGroupDetail(detail);
      loadData();
    } catch (err) { alert(err.message); }
  }

  async function handleAddMembers() {
    if (selectedMembers.length === 0) return;
    try {
      await chatAPI.addGroupMembers(groupDetail.id, selectedMembers);
      const detail = await chatAPI.getGroup(groupDetail.id);
      setGroupDetail(detail);
      setSelectedMembers([]);
      loadData();
    } catch (err) { alert(err.message); }
  }

  async function openGroupSettings(group) {
    try {
      const detail = await chatAPI.getGroup(group.id);
      setGroupDetail(detail);
      setShowGroupSettings(true);
    } catch (err) { alert(err.message); }
  }

  const filteredConversations = conversations.filter(c => !searchQuery || c.full_name?.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredGroups = groups.filter(g => !searchQuery || g.name?.toLowerCase().includes(searchQuery.toLowerCase()));
  const availableUsers = allUsers.filter(u => u.id !== currentUserId && !selectedMembers.includes(u.id));

  const typingLabel = typingUsers.length === 1
    ? `${typingUsers[0].name} is typing…`
    : typingUsers.length === 2
      ? `${typingUsers[0].name} and ${typingUsers[1].name} are typing…`
      : `${typingUsers.length} people are typing…`;

  // Render message content based on type
  function renderMessageContent(msg, isOwn) {
    switch (msg.message_type) {
      case 'image':
        return (
          <div>
            {msg.media_url && (
              <img src={msg.media_url} alt="shared" className="rounded-lg max-w-[250px] max-h-[200px] object-cover mb-1 cursor-pointer" onClick={() => window.open(msg.media_url, '_blank')} />
            )}
            {msg.message_text && msg.message_text !== '📷 Image' && <p className="whitespace-pre-wrap break-words">{msg.message_text}</p>}
          </div>
        );
      case 'voice':
        return (
          <div className="flex items-center gap-2 min-w-[180px]">
            {msg.media_url && (
              <audio controls src={msg.media_url} className="h-8 flex-1" preload="metadata" />
            )}
          </div>
        );
      case 'file':
        return (
          <div className="min-w-[200px]">
            {msg.media_url ? (
              <a href={msg.media_url} target="_blank" rel="noopener noreferrer" download
                className="flex items-center gap-2 bg-white/80 border border-gray-200 hover:border-blue-300 hover:bg-blue-50 rounded-lg px-3 py-2 transition group">
                <span className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                  <FileText size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-800 truncate max-w-[220px] group-hover:text-blue-700">
                    {(msg.message_text || '').replace(/^📎\s*/, '') || 'Attachment'}
                  </span>
                  <span className="block text-[10px] text-gray-400">Click to open / download</span>
                </span>
              </a>
            ) : (
              <p className="whitespace-pre-wrap break-words">{msg.message_text}</p>
            )}
          </div>
        );
      default:
        return <p className="whitespace-pre-wrap break-words">{msg.message_text}</p>;
    }
  }

  return (
    <div className="flex h-full min-w-0 bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
      {/* Sidebar */}
      <div className="w-72 min-w-[280px] border-r border-gray-200 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-900">Chat</h2>
            <div className="flex gap-1">
              {sidebarTab === 'groups' && (
                <button onClick={() => setShowCreateGroup(true)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" title="Create Group">
                  <Plus size={18} />
                </button>
              )}
              {sidebarTab === 'chats' && (
                <button onClick={() => setShowNewChat(true)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" title="New Chat">
                  <Plus size={18} />
                </button>
              )}
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm bg-gray-50 focus:bg-white focus:ring-1 focus:ring-blue-500" />
          </div>
          <div className="flex gap-1 mt-3">
            <button onClick={() => setSidebarTab('chats')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${sidebarTab === 'chats' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}>
              <MessageCircle size={14} /> Direct
            </button>
            <button onClick={() => setSidebarTab('groups')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${sidebarTab === 'groups' ? 'bg-purple-100 text-purple-700' : 'text-gray-500 hover:bg-gray-100'}`}>
              <Users size={14} /> Groups
            </button>
          </div>
        </div>

        {/* Conversations / Groups List */}
        <div className="flex-1 overflow-y-auto">
          {sidebarTab === 'chats' && (
            <>
              {filteredConversations.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">
                  {searchQuery ? 'No matching conversations' : 'No conversations yet.\nClick + to start chatting.'}
                </div>
              ) : (
                filteredConversations.map(c => (
                  <div key={c.user_id}
                    onClick={() => openChat({ type: 'dm', id: c.user_id, name: c.full_name })}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-gray-50 transition hover:bg-gray-50 ${activeChat?.type === 'dm' && activeChat?.id === c.user_id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                      {c.full_name?.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-900 truncate">{c.full_name}</span>
                        <span className="text-xs text-gray-400 flex-shrink-0">{formatTime(c.last_message_at)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-500 truncate">{getLastMessagePreview(c)}</p>
                        {c.unread_count > 0 && (
                          <span className="ml-2 px-1.5 py-0.5 bg-blue-500 text-white text-xs rounded-full font-medium">{c.unread_count}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
          {sidebarTab === 'groups' && (
            <>
              {filteredGroups.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">
                  {searchQuery ? 'No matching groups' : 'No groups yet.\nClick + to create a group.'}
                </div>
              ) : (
                filteredGroups.map(g => (
                  <div key={g.id}
                    onClick={() => openChat({ type: 'group', id: g.id, name: g.name })}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-gray-50 transition hover:bg-gray-50 ${activeChat?.type === 'group' && activeChat?.id === g.id ? 'bg-purple-50 border-l-2 border-l-purple-500' : ''}`}>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-white flex-shrink-0">
                      <Hash size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-900 truncate">{g.name}</span>
                        <span className="text-xs text-gray-400 flex-shrink-0">{formatTime(g.last_message_at)}</span>
                      </div>
                      <p className="text-xs text-gray-500">{g.member_count} members · {g.message_count} messages</p>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {!activeChat ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <MessageCircle size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">Select a conversation or group</p>
              <p className="text-sm mt-1">to start chatting</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm ${activeChat.type === 'dm' ? 'bg-gradient-to-br from-blue-400 to-blue-600' : 'bg-gradient-to-br from-purple-400 to-purple-600'}`}>
                  {activeChat.type === 'dm' ? activeChat.name?.charAt(0) : <Hash size={16} />}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{activeChat.name}</h3>
                  {typingUsers.length > 0 ? (
                    <p className="text-xs text-blue-600 font-medium flex items-center gap-1.5">
                      <span className="flex items-center gap-0.5">
                        <span className="w-1 h-1 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1 h-1 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '140ms' }} />
                        <span className="w-1 h-1 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '280ms' }} />
                      </span>
                      {typingLabel}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500">{activeChat.type === 'group' ? 'Group Chat' : 'Direct Message'}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={toggleSound}
                  className={`p-2 rounded-lg transition ${soundMuted ? 'text-gray-400 hover:bg-gray-200' : 'text-blue-600 hover:bg-blue-50'}`}
                  title={soundMuted ? 'Chat sounds are off — click to enable' : 'Chat sounds are on — click to mute'}>
                  {soundMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                {activeChat.type === 'group' && (
                  <button onClick={() => openGroupSettings(activeChat)} className="p-2 rounded-lg hover:bg-gray-200 text-gray-600">
                    <Settings size={18} />
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-gray-50/50">
              {messages.length === 0 ? (
                <div className="text-center text-gray-400 py-12">No messages yet. Say hello!</div>
              ) : (
                messages.map((msg, i) => {
                  const isOwn = msg.sender_id === currentUserId;
                  const showSender = activeChat.type === 'group' && (i === 0 || messages[i - 1]?.sender_id !== msg.sender_id);
                  const senderColorIdx = msg.sender_id ? (msg.sender_id % senderColors.length) : 0;
                  const senderColor = senderColors[senderColorIdx];
                  return (
                    <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'} items-end gap-2`}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (isOwn) setContextMenu({ x: e.clientX, y: e.clientY, messageId: msg.id });
                      }}>
                      {!isOwn && showSender ? (
                        msg.sender_avatar ? (
                          <img src={msg.sender_avatar} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className={`w-8 h-8 rounded-full ${senderColor} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                            {msg.sender_name?.charAt(0) || '?'}
                          </div>
                        )
                      ) : !isOwn ? (
                        <div className="w-8 flex-shrink-0" />
                      ) : null}
                      <div className={`max-w-[70%] ${isOwn ? 'order-1' : ''}`}>
                        {showSender && activeChat.type === 'group' && !isOwn && (
                          <p className="text-xs text-gray-600 mb-1 ml-1 font-semibold">{msg.sender_name || 'Unknown'}</p>
                        )}
                        <div className={`px-4 py-2.5 rounded-2xl text-sm ${isOwn
                          ? 'bg-blue-600 text-white rounded-br-md'
                          : 'bg-white border border-gray-200 text-gray-900 rounded-bl-md'
                        }`}>
                          {renderMessageContent(msg, isOwn)}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <p className={`text-xs text-gray-400 ${isOwn ? 'mr-1' : 'ml-1'}`}>{formatTime(msg.created_at)}</p>
                          {isOwn && (
                            <button onClick={() => setContextMenu({ x: null, y: null, messageId: msg.id })}
                              className="text-gray-400 hover:text-red-500 transition p-0.5 rounded" title="Delete message">
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Inline Context Menu (Delete) */}
            {contextMenu && (
              <div className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1" style={{ left: contextMenu.x || 'auto', right: contextMenu.x ? 'auto' : 10, top: contextMenu.y || 'auto', bottom: contextMenu.y ? 'auto' : 80 }}>
                <button onClick={() => handleDeleteMessage(contextMenu.messageId)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 w-full text-left">
                  <Trash2 size={14} /> Delete Message
                </button>
                <button onClick={() => setContextMenu(null)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 w-full text-left">
                  <X size={14} /> Cancel
                </button>
              </div>
            )}

            {/* Image Preview */}
            {imagePreview && (
              <div className="px-6 py-2 border-t border-gray-200 bg-gray-50">
                <div className="relative inline-block">
                  <img src={imagePreview} alt="preview" className="h-20 rounded-lg object-cover" />
                  <button onClick={removeImagePreview} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5">
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}

            {/* File Attachment Preview */}
            {fileAttachment && !imagePreview && (
              <div className="px-6 py-2 border-t border-gray-200 bg-gray-50">
                <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-3 py-2 max-w-sm">
                  <span className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                    <FileText size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800 truncate">{fileAttachment.name}</p>
                    <p className="text-[10px] text-gray-400">{formatFileSize(fileAttachment.size)}</p>
                  </div>
                  <button onClick={removeFileAttachment} className="p-1 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50">
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Voice Recording Preview */}
            {audioBlob && !isRecording && (
              <div className="px-6 py-2 border-t border-gray-200 bg-gray-50">
                <div className="flex items-center gap-3">
                  <audio controls src={URL.createObjectURL(audioBlob)} className="h-8" />
                  <button onClick={() => { setAudioBlob(null); }} className="text-red-500 hover:text-red-600">
                    <Trash2 size={16} />
                  </button>
                  <button onClick={handleSend} className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Send Voice</button>
                </div>
              </div>
            )}

            {/* Recording indicator */}
            {isRecording && (
              <div className="px-6 py-2 border-t border-red-200 bg-red-50">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-sm font-medium text-red-700">Recording... {formatRecordingTime(recordingTime)}</span>
                  <button onClick={stopRecording} className="p-1.5 bg-red-600 text-white rounded-full hover:bg-red-700">
                    <Square size={12} fill="white" />
                  </button>
                  <button onClick={cancelRecording} className="text-gray-500 hover:text-gray-700">
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* Emoji Picker */}
            {showEmojiPicker && (
              <div ref={emojiRef} className="absolute bottom-20 left-20 bg-white border border-gray-200 rounded-xl shadow-xl w-80 z-50">
                <div className="flex gap-1 p-2 border-b border-gray-100 overflow-x-auto">
                  {EMOJI_CATEGORIES.map((cat, idx) => (
                    <button key={cat.name} onClick={() => setEmojiCategory(idx)}
                      className={`px-2 py-1 text-xs rounded-lg whitespace-nowrap ${emojiCategory === idx ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}>
                      {cat.name}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-8 gap-1 p-2 max-h-48 overflow-y-auto">
                  {EMOJI_CATEGORIES[emojiCategory].emojis.map((emoji, idx) => (
                    <button key={idx} onClick={() => handleEmojiClick(emoji)}
                      className="w-8 h-8 flex items-center justify-center text-lg hover:bg-gray-100 rounded-lg transition">
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message Input */}
            <div className="px-6 py-4 border-t border-gray-200 bg-white">
              <div className="flex items-end gap-2">
                {/* Emoji Button */}
                <div className="relative">
                  <button onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition">
                    <Smile size={20} />
                  </button>
                </div>

                {/* Image Upload */}
                <input type="file" ref={imageInputRef} accept="image/*" className="hidden" onChange={handleImageSelect} />
                <button onClick={() => imageInputRef.current?.click()}
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition" title="Send image">
                  <Image size={20} />
                </button>

                {/* File Upload */}
                <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileSelect} />
                <button onClick={() => fileInputRef.current?.click()}
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition" title="Send file (max 50 MB)">
                  <Paperclip size={20} />
                </button>

                {/* Voice Recording */}
                <button onClick={isRecording ? stopRecording : startRecording}
                  className={`p-2 rounded-lg transition ${isRecording ? 'bg-red-100 text-red-600' : 'hover:bg-gray-100 text-gray-500'}`}
                  title={isRecording ? 'Stop recording' : 'Record voice message'}>
                  {isRecording ? <Square size={20} /> : <Mic size={20} />}
                </button>

                {/* Text Input */}
                <textarea
                  value={newMessage}
                  onChange={e => handleDraftChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  rows={1}
                  className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 max-h-32"
                  style={{ minHeight: '42px' }}
                />

                {/* Send Button */}
                <button onClick={handleSend} disabled={(!newMessage.trim() && !imageFile && !audioBlob && !fileAttachment) || sending}
                  className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 transition">
                  <Send size={18} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ===== MODALS ===== */}

      {/* New Chat Modal */}
      {showNewChat && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowNewChat(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[70vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-900">Start a Conversation</h3>
              <button onClick={() => setShowNewChat(false)} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto max-h-[60vh]">
              {allUsers.filter(u => u.id !== currentUserId).map(u => (
                <div key={u.id}
                  onClick={() => { setShowNewChat(false); openChat({ type: 'dm', id: u.id, name: u.full_name }); }}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 border-b border-gray-50">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold text-sm">
                    {u.full_name?.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{u.full_name}</p>
                    <p className="text-xs text-gray-500">{u.email}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {showCreateGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowCreateGroup(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-900">Create Group</h3>
              <button onClick={() => setShowCreateGroup(false)} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
                <input type="text" value={groupName} onChange={e => setGroupName(e.target.value)}
                  placeholder="e.g., VAS Team, Marketing Group"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                <input type="text" value={groupDesc} onChange={e => setGroupDesc(e.target.value)}
                  placeholder="What is this group about?"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Add Members</label>
                <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                  {allUsers.filter(u => u.id !== currentUserId).map(u => (
                    <label key={u.id}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 border-b border-gray-50 ${selectedMembers.includes(u.id) ? 'bg-blue-50' : ''}`}>
                      <input type="checkbox" checked={selectedMembers.includes(u.id)}
                        onChange={() => setSelectedMembers(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id])}
                        className="rounded" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{u.full_name}</p>
                        <p className="text-xs text-gray-500">{u.department || u.email}</p>
                      </div>
                    </label>
                  ))}
                </div>
                {selectedMembers.length > 0 && (
                  <p className="text-xs text-blue-600 mt-1">{selectedMembers.length} member(s) selected</p>
                )}
              </div>
              <button onClick={handleCreateGroup}
                className="w-full py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700">
                Create Group
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Group Settings Modal */}
      {showGroupSettings && groupDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowGroupSettings(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-900">{groupDetail.name}</h3>
              <button onClick={() => setShowGroupSettings(false)} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto max-h-[60vh]">
              {groupDetail.description && <p className="text-sm text-gray-600">{groupDetail.description}</p>}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Members ({groupDetail.members?.length || 0})</h4>
                <div className="space-y-1">
                  {groupDetail.members?.map(m => (
                    <div key={m.user_id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-semibold">
                          {m.full_name?.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{m.full_name}</p>
                          <p className="text-xs text-gray-500">{m.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {m.role === 'admin' && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Admin</span>}
                        {m.user_id !== groupDetail.created_by && (
                          <button onClick={() => handleRemoveMember(groupDetail.id, m.user_id)} className="p-1 rounded hover:bg-red-50 text-red-500">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Add Members</h4>
                <div className="flex gap-2">
                  <select className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" id="add-member-select">
                    <option value="">Select user...</option>
                    {availableUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name} ({u.department || u.email})</option>
                    ))}
                  </select>
                  <button onClick={() => {
                    const sel = document.getElementById('add-member-select');
                    if (sel.value) { setSelectedMembers([parseInt(sel.value)]); handleAddMembers(); sel.value = ''; }
                  }} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
                    <UserPlus size={14} />
                  </button>
                </div>
              </div>
              <div className="border-t pt-4">
                <button onClick={() => handleDeleteGroup(groupDetail.id)}
                  className="flex items-center gap-2 text-red-600 text-sm font-medium hover:text-red-700">
                  <Trash2 size={14} /> Delete Group
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
