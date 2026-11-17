import { useState } from 'react';
import {
  Check,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { ChatThread } from '../types/chat';

interface SidebarProps {
  openMobile: boolean;
  onCloseMobile: () => void;
  chats: ChatThread[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onCreateChat: () => void;
  onRenameChat: (chatId: string, newTitle: string) => Promise<void>;
  onDeleteChat: (chatId: string) => Promise<void>;
  loadingChats: boolean;
}

export function Sidebar({
  openMobile,
  onCloseMobile,
  chats,
  activeChatId,
  onSelectChat,
  onCreateChat,
  onRenameChat,
  onDeleteChat,
  loadingChats,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredChats = normalizedQuery
    ? chats.filter(
        (c) =>
          c.title.toLowerCase().includes(normalizedQuery) ||
          c.lastMessagePreview.toLowerCase().includes(normalizedQuery) ||
          c.memorySummary.toLowerCase().includes(normalizedQuery),
      )
    : chats;

  const commitRename = async (chatId: string) => {
    const trimmed = editDraft.trim();
    setEditingChatId(null);
    if (trimmed) {
      await onRenameChat(chatId, trimmed);
    }
  };

  const sidebarContent = (
    <div className="flex flex-col h-full w-[276px] bg-slate-100/80 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      {/* Brand + New Chat */}
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-200 dark:border-slate-800">
        <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
          FolioMind
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              onCreateChat();
              onCloseMobile();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Chat</span>
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close sidebar"
            className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search Remembered Chats */}
      <div className="p-3 border-b border-slate-200/80 dark:border-slate-800">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search remembered chats..."
            aria-label="Search remembered chats"
            className="w-full pl-8 pr-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Remembered Threads List */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
        <div className="px-2 py-1 flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
          <span>Saved Conversations</span>
          <span className="font-mono tabular-nums">{filteredChats.length}</span>
        </div>

        {loadingChats ? (
          <div className="space-y-2 p-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 rounded-lg bg-slate-200/60 dark:bg-slate-800/60 animate-pulse"
              />
            ))}
          </div>
        ) : filteredChats.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
            {normalizedQuery
              ? 'No conversations match your search.'
              : 'Your remembered conversations will appear here.'}
          </div>
        ) : (
          filteredChats.map((chat) => {
            const isActive = chat.chatId === activeChatId;
            const isEditing = editingChatId === chat.chatId;
            const isDeleting = confirmDeleteId === chat.chatId;

            return (
              <div
                key={chat.chatId}
                className={`group rounded-lg border transition-colors ${
                  isActive
                    ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                    : 'border-transparent hover:bg-white/70 dark:hover:bg-slate-800/50'
                }`}
              >
                {isEditing ? (
                  <div className="flex items-center gap-1 p-2">
                    <input
                      type="text"
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename(chat.chatId);
                        if (e.key === 'Escape') setEditingChatId(null);
                      }}
                      autoFocus
                      className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-blue-500 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void commitRename(chat.chatId)}
                      aria-label="Save title"
                      className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : isDeleting ? (
                  <div className="flex items-center justify-between gap-2 p-2.5 text-xs">
                    <span className="text-red-600 dark:text-red-400 font-medium truncate">
                      Delete chat?
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          setConfirmDeleteId(null);
                          await onDeleteChat(chat.chatId);
                        }}
                        className="px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 text-[11px] font-medium cursor-pointer"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-1.5 p-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectChat(chat.chatId);
                        onCloseMobile();
                      }}
                      className="flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <MessageSquare
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isActive
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-slate-400'
                          }`}
                        />
                        <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                          {chat.title}
                        </p>
                      </div>
                      <p className="mt-1 pl-5.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
                        {chat.messageCount} turns · {chat.pdfCount} PDFs
                      </p>
                    </button>

                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingChatId(chat.chatId);
                          setEditDraft(chat.title);
                        }}
                        aria-label={`Rename ${chat.title}`}
                        className="p-1.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(chat.chatId)}
                        aria-label={`Delete ${chat.title}`}
                        className="p-1.5 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="hidden lg:block h-full shrink-0">{sidebarContent}</div>

      {openMobile && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
}
