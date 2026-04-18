"use client";

import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { X, Edit2, Trash2, Copy, Clock, AlignLeft, Loader2, MessageCircle, Send, User, Users, Tag, MapPin, Mail } from "lucide-react";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { type Event } from "@/lib/supabase";
import { getComments, addComment, deleteComment, logActivity, type Comment } from "@/lib/events";
import { getEventAreas, type EventArea } from "@/lib/event_areas";
import { getOrderEmailSettings, type OrderEmailSettings } from "@/lib/settings";
import OrderEmailModal from "@/components/OrderEmailModal";

type Props = {
  tenantId: string;
  event: Event;
  currentUser: string;
  isMaster?: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => Promise<void>;
  onClose: () => void;
};

export default function EventDetailModal({ tenantId, event, currentUser, isMaster, onEdit, onDuplicate, onDelete, onClose }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingComments, setLoadingComments] = useState(true);
  const [orderEmailSettings, setOrderEmailSettings] = useState<OrderEmailSettings | null>(null);
  const [showOrderEmail, setShowOrderEmail] = useState(false);
  const [eventAreas, setEventAreas] = useState<EventArea[]>([]);

  useEffect(() => {
    loadComments();
    getOrderEmailSettings(tenantId).then((s) => {
      if (s.enabled) setOrderEmailSettings(s);
    }).catch(() => {});
    getEventAreas(tenantId).then(setEventAreas).catch(() => {});
  }, [event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const areaName = event.area_id
    ? eventAreas.find((a) => a.id === event.area_id)?.name ?? null
    : null;

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
      logActivity(event.id, event.title, "comment_added", currentUser, event.assignees, event.assignees, tenantId).catch(() => {});
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
    <>
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
            {orderEmailSettings && (
              <button onClick={() => setShowOrderEmail(true)} className="p-2 rounded-full hover:bg-indigo-50 transition-colors text-indigo-400" title="発注メール送信">
                <Mail size={16} />
              </button>
            )}
            <button onClick={onEdit} className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-500" title="編集">
              <Edit2 size={16} />
            </button>
            <button onClick={onDuplicate} className="p-2 rounded-full hover:bg-indigo-50 transition-colors text-gray-400 hover:text-indigo-400" title="複製">
              <Copy size={16} />
            </button>
            <button onClick={handleDelete} disabled={deleting} className="p-2 rounded-full hover:bg-red-50 transition-colors text-gray-400 hover:text-red-400" title="削除">
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

          {/* エリア */}
          {areaName && (
            <div className="flex items-center gap-2 text-gray-600">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                <MapPin size={14} className="text-gray-400" />
              </div>
              <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium border border-emerald-100">
                {areaName}
              </span>
            </div>
          )}

          {/* 用件種別 */}
          {event.event_type && event.event_type.length > 0 && (
            <div className="flex items-start gap-2 text-gray-600">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                <Tag size={14} className="text-gray-400" />
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {event.event_type.map((t) => (
                  <span key={t} className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium border border-indigo-100">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 担当者 */}
          {event.assignees && event.assignees.length > 0 && (
            <div className="flex items-start gap-2 text-gray-600">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                <Users size={14} className="text-gray-400" />
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {event.assignees.map((name) => (
                  <span key={name} className="flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-600 rounded-full text-xs font-medium">
                    <span className="w-4 h-4 bg-indigo-200 rounded-full flex items-center justify-center text-xs font-bold">
                      {name.charAt(0)}
                    </span>
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 場所 */}
          {event.location && (
            <div className="flex items-center gap-2 text-gray-600">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                <MapPin size={14} className="text-gray-400" />
              </div>
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(event.location)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-indigo-500 hover:text-indigo-700 underline underline-offset-2 break-all"
              >
                {event.location}
              </a>
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

          {/* 備考 */}
          {event.notes && (
            <div className="flex items-start gap-2 text-gray-600">
              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                <AlignLeft size={14} className="text-amber-400" />
              </div>
              <div className="flex-1 pt-1">
                <p className="text-xs text-amber-500 font-medium mb-0.5">備考</p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{event.notes}</p>
              </div>
            </div>
          )}

          {/* 画像ギャラリー（複数枚対応） */}
          {(() => {
            const allImgs = [
              ...(event.image_url ? [event.image_url] : []),
              ...(event.image_urls ?? []),
            ];
            if (allImgs.length === 0) return null;
            return (
              <>
                <div className={`grid gap-2 ${allImgs.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                  {allImgs.map((url, i) => (
                    <button
                      key={url}
                      onTouchEnd={(e) => { e.preventDefault(); setLightboxIdx(i); }}
                      onClick={() => setLightboxIdx(i)}
                      className="rounded-xl overflow-hidden block w-full"
                      style={{ touchAction: "manipulation" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`添付画像${i + 1}`}
                        className="w-full object-cover pointer-events-none"
                        style={{ maxHeight: allImgs.length === 1 ? "16rem" : "8rem" }}
                      />
                    </button>
                  ))}
                </div>
                {/* ライトボックス（Android対応: portalでbody直下に描画） */}
                {lightboxIdx !== null && createPortal(
                  <div
                    className="fixed inset-0 bg-black/95 flex items-center justify-center"
                    style={{ zIndex: 9999, touchAction: "manipulation" }}
                    onTouchEnd={(e) => { e.preventDefault(); setLightboxIdx(null); }}
                    onClick={() => setLightboxIdx(null)}
                  >
                    {/* 閉じるボタン */}
                    <button
                      className="absolute top-4 right-4 text-white/80 p-3 bg-black/30 rounded-full"
                      style={{ zIndex: 10000, touchAction: "manipulation" }}
                      onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); setLightboxIdx(null); }}
                      onClick={(e) => { e.stopPropagation(); setLightboxIdx(null); }}
                    >
                      <X size={24} />
                    </button>
                    {/* 前/次ボタン（複数枚のとき） */}
                    {allImgs.length > 1 && (
                      <>
                        <button
                          className="absolute left-3 text-white/80 p-3 bg-black/30 rounded-full"
                          style={{ zIndex: 10000, touchAction: "manipulation" }}
                          onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); setLightboxIdx((lightboxIdx - 1 + allImgs.length) % allImgs.length); }}
                          onClick={(e) => { e.stopPropagation(); setLightboxIdx((lightboxIdx - 1 + allImgs.length) % allImgs.length); }}
                        >
                          ‹
                        </button>
                        <button
                          className="absolute right-14 text-white/80 p-3 bg-black/30 rounded-full"
                          style={{ zIndex: 10000, touchAction: "manipulation" }}
                          onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); setLightboxIdx((lightboxIdx + 1) % allImgs.length); }}
                          onClick={(e) => { e.stopPropagation(); setLightboxIdx((lightboxIdx + 1) % allImgs.length); }}
                        >
                          ›
                        </button>
                      </>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={allImgs[lightboxIdx]}
                      alt="添付画像"
                      className="max-w-full max-h-full object-contain pointer-events-none select-none"
                      style={{ zIndex: 9998 }}
                    />
                    {/* 枚数インジケーター */}
                    {allImgs.length > 1 && (
                      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-1.5" style={{ zIndex: 10000 }}>
                        {allImgs.map((_, idx) => (
                          <span key={idx} className={`w-2 h-2 rounded-full ${idx === lightboxIdx ? "bg-white" : "bg-white/40"}`} />
                        ))}
                      </div>
                    )}
                  </div>,
                  document.body
                )}
              </>
            );
          })()}

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

    {showOrderEmail && orderEmailSettings && (
      <OrderEmailModal
        event={event}
        settings={orderEmailSettings}
        currentUser={currentUser}
        onClose={() => setShowOrderEmail(false)}
      />
    )}
    </>
  );
}
