"use client";

import { useState, useRef, useEffect } from "react";
import { X, Calendar, Clock, Image as ImageIcon, Trash2, Loader2, Users, Tag, MapPin } from "lucide-react";
import { format } from "date-fns";
import { type Event, type EventInsert } from "@/lib/supabase";
import { uploadImage, deleteImage } from "@/lib/events";
import { getMembers, type Member } from "@/lib/members";
import { getEventTypes, type EventType } from "@/lib/event_types";

function TimeSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const parts = value ? value.split(":") : ["", ""];
  const hh = parts[0] || "";
  const mm = (parts[1] || "").slice(0, 2);
  const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  function handleHour(h: string) {
    onChange(h ? `${h}:${mm || "00"}` : "");
  }
  function handleMinute(m: string) {
    onChange(m !== "" ? `${hh || "00"}:${m}` : "");
  }

  return (
    <div>
      <label className="text-xs text-gray-400 mb-1 block">{label}</label>
      <div className="flex items-center gap-1">
        <select value={hh} onChange={(e) => handleHour(e.target.value)}
          className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400">
          <option value="">--</option>
          {Array.from({ length: 24 }, (_, i) => {
            const h = (6 + i) % 24;
            const v = String(h).padStart(2, "0");
            return <option key={v} value={v}>{v}</option>;
          })}
        </select>
        <span className="text-gray-400 text-sm font-bold">:</span>
        <select value={MINUTES.includes(Number(mm)) ? mm : ""} onChange={(e) => handleMinute(e.target.value)}
          className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400">
          <option value="">--</option>
          {MINUTES.map((m) => {
            const v = String(m).padStart(2, "0");
            return <option key={v} value={v}>{v}</option>;
          })}
        </select>
      </div>
    </div>
  );
}

type Props = {
  event?: Event | null;
  initialData?: Partial<EventInsert>;
  defaultDate?: string;
  currentUser: string;
  onSave: (event: EventInsert) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
};

export default function EventModal({ event, initialData, defaultDate, currentUser, onSave, onDelete, onClose }: Props) {
  const today = format(new Date(), "yyyy-MM-dd");
  const base = initialData ?? {};
  const [title, setTitle] = useState(event?.title ?? base.title ?? "");
  const [description, setDescription] = useState(event?.description ?? base.description ?? "");
  const [startDate, setStartDate] = useState(event?.start_date ?? base.start_date ?? defaultDate ?? today);
  const [endDate, setEndDate] = useState(event?.end_date ?? base.end_date ?? defaultDate ?? today);
  const [startTime, setStartTime] = useState(event?.start_time ?? base.start_time ?? "");
  const [endTime, setEndTime] = useState(event?.end_time ?? base.end_time ?? "");
  const [allDay, setAllDay] = useState(event?.all_day ?? base.all_day ?? false);
  const [color, setColor] = useState(event?.color ?? base.color ?? "#6366f1");
  const [imageUrl, setImageUrl] = useState(event?.image_url ?? base.image_url ?? "");
  const [imageUrls, setImageUrls] = useState<string[]>(event?.image_urls ?? base.image_urls ?? []);
  const [location, setLocation] = useState(event?.location ?? base.location ?? "");
  const [assignees, setAssignees] = useState<string[]>(event?.assignees ?? base.assignees ?? []);
  const [eventType, setEventType] = useState<string[]>(event?.event_type ?? base.event_type ?? []);
  const [members, setMembers] = useState<Member[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getMembers().then(setMembers).catch(() => {});
    getEventTypes().then(setEventTypes).catch(() => {});
  }, []);

  function toggleAssignee(member: Member) {
    setAssignees((prev) => {
      const next = prev.includes(member.name)
        ? prev.filter((n) => n !== member.name)
        : [...prev, member.name];
      // 先頭の担当者の色を自動セット
      if (next.length > 0) {
        const first = members.find((m) => m.name === next[0]);
        if (first) setColor(first.color);
      }
      return next;
    });
  }

  function toggleEventType(name: string) {
    setEventType((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    );
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    // 合計上限5枚
    const allUrls = [...imageUrls, ...(imageUrl ? [imageUrl] : [])];
    const remaining = 5 - allUrls.length;
    if (remaining <= 0) { alert("画像は最大5枚です"); return; }
    const toUpload = files.slice(0, remaining);
    setUploading(true);
    try {
      const uploaded = await Promise.all(toUpload.map((f) => uploadImage(f)));
      setImageUrls((prev) => {
        const combined = [...(imageUrl ? [imageUrl] : []), ...prev, ...uploaded];
        // image_urlは先頭に残す（後方互換）
        if (combined.length > 0) setImageUrl(combined[0]);
        return combined.slice(1);
      });
    } catch {
      alert("画像のアップロードに失敗しました");
    } finally {
      setUploading(false);
      // inputをリセット
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleRemoveImage(url: string) {
    try { await deleteImage(url); } catch {}
    if (url === imageUrl) {
      // 先頭画像を削除 → 次を先頭に
      const next = imageUrls[0] ?? "";
      setImageUrl(next);
      setImageUrls((prev) => prev.slice(1));
    } else {
      setImageUrls((prev) => prev.filter((u) => u !== url));
    }
  }

  async function handleSave() {
    if (!title.trim()) { alert("タイトルを入力してください"); return; }
    setSaving(true);
    try {
      // 全画像リスト（先頭=image_url、残り=image_urls）
      const allImages = [...(imageUrl ? [imageUrl] : []), ...imageUrls];
      await onSave({
        title: title.trim(),
        description: description.trim() || null,
        start_date: startDate,
        end_date: endDate < startDate ? startDate : endDate,
        start_time: allDay ? null : startTime || null,
        end_time: allDay ? null : endTime || null,
        all_day: allDay,
        color,
        image_url: allImages[0] ?? null,
        image_urls: allImages.slice(1),
        location: location.trim() || null,
        assignees,
        event_type: eventType,
        created_by: event ? event.created_by : currentUser,
        updated_by: currentUser,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("この予定をゴミ箱に移しますか？")) return;
    setDeleting(true);
    try { await onDelete?.(); }
    finally { setDeleting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between px-4 py-3 border-b border-gray-100 rounded-t-2xl">
          <h2 className="text-lg font-semibold text-gray-800">{event ? "予定を編集" : "予定を追加"}</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* タイトル */}
          <input type="text" placeholder="タイトル" value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full text-lg font-medium placeholder-gray-300 border-0 border-b-2 border-gray-200 focus:border-indigo-400 focus:outline-none py-1 transition-colors" />

          {/* 担当者（メンバーがいる場合のみ） */}
          {members.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 text-gray-500">
                <Users size={16} />
                <span className="text-sm font-medium">担当者</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => (
                  <button key={m.id} onClick={() => toggleAssignee(m)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all"
                    style={assignees.includes(m.name)
                      ? { backgroundColor: m.color, color: "white" }
                      : { backgroundColor: "white", border: `2px solid ${m.color}20`, color: "#374151" }}>
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{ backgroundColor: assignees.includes(m.name) ? "rgba(255,255,255,0.25)" : m.color + "30", color: assignees.includes(m.name) ? "white" : m.color }}>
                      {m.name.charAt(0)}
                    </span>
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 用件種別 */}
          {eventTypes.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 text-gray-500">
                <Tag size={16} />
                <span className="text-sm font-medium">用件種別</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {eventTypes.map((t) => (
                  <button key={t.id} onClick={() => toggleEventType(t.name)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                      eventType.includes(t.name)
                        ? "bg-indigo-500 text-white border-indigo-500"
                        : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                    }`}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* カラー（手動選択） */}
          <div>
            <p className="text-xs text-gray-400 mb-2">カラー（担当者選択で自動設定）</p>
            <div className="flex gap-2 flex-wrap">
              {["#6366f1","#ec4899","#f97316","#10b981","#3b82f6","#8b5cf6","#ef4444","#f59e0b"].map((c) => (
                <button key={c} onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{ backgroundColor: c, outline: color === c ? `3px solid ${c}` : "none", outlineOffset: "2px" }} />
              ))}
            </div>
          </div>

          {/* 日付 */}
          <div className="bg-gray-50 rounded-xl p-3 space-y-3">
            <div className="flex items-center gap-2 text-gray-500">
              <Calendar size={16} />
              <span className="text-sm font-medium">日付</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">開始</label>
                <input type="date" value={startDate} onChange={(e) => {
                  const v = e.target.value;
                  setStartDate(v);
                  if (endDate < v) setEndDate(v);
                }}
                  className="w-full text-sm bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">終了</label>
                <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)}
                  className="w-full text-sm bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400" />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-gray-500">
                <Clock size={16} />
                <span className="text-sm font-medium">時間を指定</span>
              </div>
              <button onClick={() => setAllDay(!allDay)}
                className={`w-11 h-6 rounded-full transition-colors relative ${!allDay ? "bg-indigo-500" : "bg-gray-200"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${!allDay ? "translate-x-5" : ""}`} />
              </button>
            </div>

            {!allDay && (
              <div className="grid grid-cols-2 gap-2">
                <TimeSelect label="開始時刻" value={startTime} onChange={setStartTime} />
                <TimeSelect label="終了時刻" value={endTime} onChange={setEndTime} />
              </div>
            )}
          </div>

          {/* 場所 */}
          <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
            <MapPin size={16} className="text-gray-400 shrink-0" />
            <input
              type="text"
              placeholder="場所を追加..."
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="flex-1 text-sm bg-transparent placeholder-gray-300 focus:outline-none"
            />
          </div>

          {/* メモ */}
          <textarea placeholder="メモを追加..." value={description} onChange={(e) => setDescription(e.target.value)}
            rows={3} className="w-full text-sm placeholder-gray-300 bg-gray-50 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200" />

          {/* 画像（複数枚対応） */}
          <div className="space-y-2">
            {/* サムネイルグリッド */}
            {(() => {
              const allImgs = [...(imageUrl ? [imageUrl] : []), ...imageUrls];
              if (allImgs.length === 0) return null;
              return (
                <div className="grid grid-cols-3 gap-2">
                  {allImgs.map((url, i) => (
                    <div key={url} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`画像${i + 1}`} className="w-full h-full object-cover" />
                      <button
                        onClick={() => handleRemoveImage(url)}
                        className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full hover:bg-black/70"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()}
            {/* 追加ボタン（5枚未満のとき） */}
            {[...(imageUrl ? [imageUrl] : []), ...imageUrls].length < 5 && (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:border-indigo-300 hover:text-indigo-400 transition-colors text-sm"
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
                {uploading ? "圧縮・アップロード中..." : "画像を添付（最大5枚）"}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white px-4 py-3 border-t border-gray-100 flex gap-2">
          {event && onDelete && (
            <button onClick={handleDelete} disabled={deleting}
              className="p-2.5 rounded-xl border border-red-100 text-red-400 hover:bg-red-50">
              {deleting ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
            </button>
          )}
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 font-medium hover:bg-gray-50">
            キャンセル
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-indigo-500 text-white font-medium hover:bg-indigo-600 disabled:opacity-50 flex items-center justify-center gap-1">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
