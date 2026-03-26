"use client";

import { useState, useRef } from "react";
import { X, Calendar, Clock, Image as ImageIcon, Trash2, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { type Event, type EventInsert } from "@/lib/supabase";
import { uploadImage, deleteImage } from "@/lib/events";

const COLORS = [
  { value: "#6366f1", label: "インディゴ" },
  { value: "#ec4899", label: "ピンク" },
  { value: "#f97316", label: "オレンジ" },
  { value: "#10b981", label: "グリーン" },
  { value: "#3b82f6", label: "ブルー" },
  { value: "#8b5cf6", label: "パープル" },
  { value: "#ef4444", label: "レッド" },
  { value: "#f59e0b", label: "アンバー" },
];

type Props = {
  event?: Event | null;
  defaultDate?: string;
  onSave: (event: EventInsert) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
};

export default function EventModal({ event, defaultDate, onSave, onDelete, onClose }: Props) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [startDate, setStartDate] = useState(event?.start_date ?? defaultDate ?? today);
  const [endDate, setEndDate] = useState(event?.end_date ?? defaultDate ?? today);
  const [startTime, setStartTime] = useState(event?.start_time ?? "");
  const [endTime, setEndTime] = useState(event?.end_time ?? "");
  const [allDay, setAllDay] = useState(event?.all_day ?? true);
  const [color, setColor] = useState(event?.color ?? "#6366f1");
  const [imageUrl, setImageUrl] = useState(event?.image_url ?? "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file);
      setImageUrl(url);
    } catch {
      alert("画像のアップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveImage() {
    if (imageUrl) {
      try {
        await deleteImage(imageUrl);
      } catch {
        // ignore
      }
      setImageUrl("");
    }
  }

  async function handleSave() {
    if (!title.trim()) {
      alert("タイトルを入力してください");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim() || null,
        start_date: startDate,
        end_date: endDate < startDate ? startDate : endDate,
        start_time: allDay ? null : startTime || null,
        end_time: allDay ? null : endTime || null,
        all_day: allDay,
        color,
        image_url: imageUrl || null,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("この予定を削除しますか？")) return;
    setDeleting(true);
    try {
      await onDelete?.();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        {/* ヘッダー */}
        <div className="sticky top-0 bg-white flex items-center justify-between px-4 py-3 border-b border-gray-100 rounded-t-2xl">
          <h2 className="text-lg font-semibold text-gray-800">
            {event ? "予定を編集" : "予定を追加"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* タイトル */}
          <div>
            <input
              type="text"
              placeholder="タイトル"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-lg font-medium placeholder-gray-300 border-0 border-b-2 border-gray-200 focus:border-indigo-400 focus:outline-none py-1 transition-colors"
            />
          </div>

          {/* カラー */}
          <div className="flex gap-2 flex-wrap">
            {COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => setColor(c.value)}
                className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                style={{
                  backgroundColor: c.value,
                  outline: color === c.value ? `3px solid ${c.value}` : "none",
                  outlineOffset: "2px",
                }}
                title={c.label}
              />
            ))}
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
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full text-sm bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">終了</label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full text-sm bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400"
                />
              </div>
            </div>

            {/* 終日トグル */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-gray-500">
                <Clock size={16} />
                <span className="text-sm font-medium">時間を指定</span>
              </div>
              <button
                onClick={() => setAllDay(!allDay)}
                className={`w-11 h-6 rounded-full transition-colors relative ${
                  !allDay ? "bg-indigo-500" : "bg-gray-200"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    !allDay ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>

            {!allDay && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">開始時刻</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full text-sm bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">終了時刻</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full text-sm bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-400"
                  />
                </div>
              </div>
            )}
          </div>

          {/* メモ */}
          <textarea
            placeholder="メモを追加..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full text-sm placeholder-gray-300 bg-gray-50 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200 transition-all"
          />

          {/* 画像 */}
          <div>
            {imageUrl ? (
              <div className="relative rounded-xl overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="添付画像" className="w-full max-h-48 object-cover" />
                <button
                  onClick={handleRemoveImage}
                  className="absolute top-2 right-2 bg-black/50 text-white p-1.5 rounded-full hover:bg-black/70 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:border-indigo-300 hover:text-indigo-400 transition-colors text-sm"
              >
                {uploading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ImageIcon size={16} />
                )}
                {uploading ? "アップロード中..." : "画像を添付"}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageUpload}
            />
          </div>
        </div>

        {/* フッター */}
        <div className="sticky bottom-0 bg-white px-4 py-3 border-t border-gray-100 flex gap-2">
          {event && onDelete && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="p-2.5 rounded-xl border border-red-100 text-red-400 hover:bg-red-50 transition-colors"
            >
              {deleting ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 font-medium hover:bg-gray-50 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-indigo-500 text-white font-medium hover:bg-indigo-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
