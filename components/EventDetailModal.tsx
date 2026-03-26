"use client";

import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { X, Edit2, Trash2, Clock, AlignLeft, Image as ImageIcon, Loader2, MessageCircle, Send, User } from "lucide-react";
import { useState, useEffect } from "react";
import { type Event } from "@/lib/supabase";
import { getComments, addComment, deleteComment, type Comment } from "@/lib/events";

type Props = {
  event: Event;
  currentUser: string;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onClose: () => void;
};

export default function EventDetailModal({ event, currentUser, onEdit, onDelete, onClose }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingComments, setLoadingComments] = useState(true);

  useEffect(() => {
    loadComments();
  }, [event.id]);

  async function loadComments() {
    setLoadingComments(true);
    try {
      const data = await getComments(event.id);
      setComments(data);
    } catch {
      // ignore
    } finally {
      setLoadingComments(false);
    }
  }

  async function handleDelete() {
    if (!confirm("この予定を削除しますか？")) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  }

  async function handleAddComment() {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const newComment = await addComment(event.id, currentUser, trimmed);
      setComments((prev) => [...prev, newComment]);
      setCommentText("");
    } catch {
      alert("コメントの送信に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteComment(id: string) {
    if (!confirm("このコメントを削除しますか？")) return;
    try {
      await deleteComment(id);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch {
      alert("削除に失敗しました");
    }
  }

  const startDate = format(new Date(event.start_date), "M月d日(E)", { locale: ja });
  const endDate = format(new Date(event.end_date), "M月d日(E)", { locale: ja });
  const isSameDay = event.start_date === event.end_date;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* カラーバー */}
        <div className="h-2 shrink-0" style={{ backgroundColor: event.color }} />

        {/* ヘッダー */}
        <div className="flex items-start justify-between px-4 pt-3 pb-0 shrink-0">
          <h2 className="text-xl font-bold text-gray-800 flex-1 pr-2 leading-snug">
            {event.title}
          </h2>
          <div className="flex gap-1 shrink-0">
            <button onClick={onEdit} className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-500">
              <Edit2 size={16} />
            </button>
            <button onClick={handleDelete} disabled={deleting} className="p-2 rounded-full hover:bg-red-50 transition-colors text-gray-400 hover:text-red-400">
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            </button>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-500">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-3 mt-3">
          {/* 日付・時間 */}
          <div className="flex items-center gap-2 text-gray-600">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: event.color + "20" }}>
              <span style={{ color: event.color }} className="text-sm">📅</span>
            </div>
            <div>
              <p className="text-sm font-medium">
                {isSameDay ? startDate : `${startDate} 〜 ${endDate}`}
              </p>
              {!event.all_day && (event.start_time || event.end_time) && (
                <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                  <Clock size={10} />
                  {event.start_time?.slice(0, 5)}
                  {event.end_time && ` 〜 ${event.end_time.slice(0, 5)}`}
                </p>
              )}
              {event.all_day && <p className="text-xs text-gray-400 mt-0.5">終日</p>}
            </div>
          </div>

          {/* 作成者・編集者 */}
          {(event.created_by || event.updated_by) && (
            <div className="flex items-center gap-2 text-gray-500">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                <User size={14} className="text-gray-400" />
              </div>
              <div className="text-xs space-y-0.5">
                {event.created_by && <p>作成：<span className="font-medium text-gray-700">{event.created_by}</span></p>}
                {event.updated_by && event.updated_by !== event.created_by && (
                  <p>最終編集：<span className="font-medium text-gray-700">{event.updated_by}</span></p>
                )}
              </div>
            </div>
          )}

          {/* メモ */}
          {event.description && (
            <div className="flex items-start gap-2 text-gray-600">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                <AlignLeft size={14} className="text-gray-400" />
              </div>
              <p className="text-sm leading-relaxed pt-1 whitespace-pre-wrap">{event.description}</p>
            </div>
          )}

          {/* 画像 */}
          {event.image_url && (
            <div className="rounded-xl overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={event.image_url} alt="添付画像" className="w-full max-h-64 object-cover" />
            </div>
          )}

          {/* コメント */}
          <div className="border-t border-gray-100 pt-3">
            <div className="flex items-center gap-1.5 mb-3">
              <MessageCircle size={15} className="text-indigo-400" />
              <span className="text-sm font-semibold text-gray-700">コメント</span>
              {comments.length > 0 && (
                <span className="text-xs bg-indigo-100 text-indigo-600 rounded-full px-1.5 py-0.5 font-medium">
                  {comments.length}
                </span>
              )}
            </div>

            {loadingComments ? (
              <div className="flex justify-center py-4">
                <Loader2 size={18} className="animate-spin text-gray-300" />
              </div>
            ) : comments.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">まだコメントはありません</p>
            ) : (
              <div className="space-y-2.5 mb-3">
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-2 group">
                    <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-indigo-600">
                        {c.author.charAt(0)}
                      </span>
                    </div>
                    <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-semibold text-gray-700">{c.author}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-400">
                            {format(new Date(c.created_at), "M/d HH:mm")}
                          </span>
                          {c.author === currentUser && (
                            <button
                              onClick={() => handleDeleteComment(c.id)}
                              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all p-0.5"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* コメント入力 */}
        <div className="shrink-0 px-4 pb-4 pt-2 border-t border-gray-100 bg-white">
          <div className="flex gap-2 items-end">
            <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-indigo-600">
                {currentUser.charAt(0)}
              </span>
            </div>
            <div className="flex-1 bg-gray-50 rounded-2xl px-3 py-2 flex items-end gap-2">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleAddComment();
                  }
                }}
                placeholder="コメントを追加..."
                rows={1}
                className="flex-1 bg-transparent text-sm placeholder-gray-400 focus:outline-none resize-none leading-5"
                style={{ maxHeight: "80px" }}
              />
              <button
                onClick={handleAddComment}
                disabled={submitting || !commentText.trim()}
                className="shrink-0 w-7 h-7 bg-indigo-500 disabled:bg-gray-200 text-white rounded-full flex items-center justify-center transition-colors"
              >
                {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
