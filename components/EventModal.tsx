"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { X, Calendar, Clock, Image as ImageIcon, Trash2, Loader2, Users, Tag, MapPin, User, StickyNote } from "lucide-react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { type Event, type EventInsert } from "@/lib/supabase";
import { uploadImage, deleteImage } from "@/lib/events";
import { getMembers, type Member } from "@/lib/members";
import { getEventTypes, type EventType } from "@/lib/event_types";
import { getClients, getClientOfficeAssignments, type Client, type ClientOfficeAssignment } from "@/lib/clients";

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

// 半角カタカナ→全角カタカナ変換マップ
const HAN_TO_ZEN: Record<string, string> = {
  'ｦ':'ヲ','ｧ':'ァ','ｨ':'ィ','ｩ':'ゥ','ｪ':'ェ','ｫ':'ォ','ｬ':'ャ','ｭ':'ュ','ｮ':'ョ','ｯ':'ッ',
  'ｰ':'ー','ｱ':'ア','ｲ':'イ','ｳ':'ウ','ｴ':'エ','ｵ':'オ','ｶ':'カ','ｷ':'キ','ｸ':'ク','ｹ':'ケ',
  'ｺ':'コ','ｻ':'サ','ｼ':'シ','ｽ':'ス','ｾ':'セ','ｿ':'ソ','ﾀ':'タ','ﾁ':'チ','ﾂ':'ツ','ﾃ':'テ',
  'ﾄ':'ト','ﾅ':'ナ','ﾆ':'ニ','ﾇ':'ヌ','ﾈ':'ネ','ﾉ':'ノ','ﾊ':'ハ','ﾋ':'ヒ','ﾌ':'フ','ﾍ':'ヘ',
  'ﾎ':'ホ','ﾏ':'マ','ﾐ':'ミ','ﾑ':'ム','ﾒ':'メ','ﾓ':'モ','ﾔ':'ヤ','ﾕ':'ユ','ﾖ':'ヨ','ﾗ':'ラ',
  'ﾘ':'リ','ﾙ':'ル','ﾚ':'レ','ﾛ':'ロ','ﾜ':'ワ','ﾝ':'ン',
};
const DAKUTEN: Record<string, string> = {
  'カ':'ガ','キ':'ギ','ク':'グ','ケ':'ゲ','コ':'ゴ','サ':'ザ','シ':'ジ','ス':'ズ','セ':'ゼ','ソ':'ゾ',
  'タ':'ダ','チ':'ヂ','ツ':'ヅ','テ':'デ','ト':'ド','ハ':'バ','ヒ':'ビ','フ':'ブ','ヘ':'ベ','ホ':'ボ','ウ':'ヴ',
};
const HANDAKUTEN: Record<string, string> = { 'ハ':'パ','ヒ':'ピ','フ':'プ','ヘ':'ペ','ホ':'ポ' };

// 半角カタカナ→全角カタカナ（濁点・半濁点も結合）
function hankakuToZenkaku(str: string): string {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const next = str[i + 1];
    const full = HAN_TO_ZEN[ch];
    if (full) {
      if (next === 'ﾞ') { result += DAKUTEN[full] ?? full; i++; }
      else if (next === 'ﾟ') { result += HANDAKUTEN[full] ?? full; i++; }
      else { result += full; }
    } else {
      result += ch;
    }
  }
  return result;
}

// 全角カタカナをひらがなに変換
function toHiragana(str: string): string {
  return str.replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// 検索用正規化：半角カナ→全角カナ→ひらがな
function normalizeKana(str: string): string {
  return toHiragana(hankakuToZenkaku(str));
}

// ── 利用者選択コンポーネント（DB選択 + 直接入力）──────────
function ClientSelector({ clients, selected, manualName, onSelect, onManualName }: {
  clients: Client[];
  selected: Client | null;
  manualName: string;
  onSelect: (c: Client | null) => void;
  onManualName: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return clients.slice(0, 30);
    const qH = normalizeKana(q);
    return clients.filter((c) => {
      const nameH = normalizeKana(c.name);
      const furiH = normalizeKana(c.furigana ?? "");
      return nameH.includes(qH) || furiH.includes(qH);
    }).slice(0, 50);
  }, [clients, query]);

  const displayName = selected?.name ?? manualName;

  function handleClose() { setOpen(false); setQuery(""); }

  function handleManualSelect() {
    if (!query.trim()) return;
    onSelect(null);
    onManualName(query.trim());
    handleClose();
  }

  return (
    <>
      <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
        <User size={16} className="text-gray-400 shrink-0" />
        <button type="button" onClick={() => setOpen(true)} className="flex-1 text-left text-sm">
          {displayName
            ? <span className="text-gray-700">{displayName}{!selected && <span className="text-gray-400 text-xs ml-1">（手動入力）</span>}</span>
            : <span className="text-gray-300">利用者を選択 / 直接入力（任意）</span>
          }
        </button>
        {displayName && (
          <button type="button" onClick={() => { onSelect(null); }}
            className="text-gray-300 hover:text-red-400 p-0.5 shrink-0">
            <X size={14} />
          </button>
        )}
      </div>

      {open && createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col bg-white">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
            <button type="button" onClick={handleClose} className="p-1.5 rounded-xl hover:bg-gray-100">
              <X size={20} className="text-gray-500" />
            </button>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前・フリガナで検索 / 直接入力..."
              className="flex-1 text-sm bg-gray-50 rounded-xl px-3 py-2 placeholder-gray-300 focus:outline-none"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* 直接入力オプション */}
            {query.trim() && (
              <button
                type="button"
                onClick={handleManualSelect}
                className="w-full flex items-center gap-3 px-4 py-3 text-left bg-indigo-50 hover:bg-indigo-100 border-b border-indigo-100"
              >
                <div className="w-9 h-9 bg-indigo-200 rounded-full flex items-center justify-center shrink-0">
                  <User size={16} className="text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-indigo-700">「{query}」で直接入力</p>
                  <p className="text-xs text-indigo-400">タイトルに名前を追加（住所・情報の自動入力なし）</p>
                </div>
              </button>
            )}
            {/* DB検索結果 */}
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onSelect(c); handleClose(); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-50"
              >
                <div className="w-9 h-9 bg-indigo-100 rounded-full flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-indigo-600">{c.name.charAt(0)}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{c.name}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {c.furigana}{c.address ? `　${c.address}` : ""}
                  </p>
                </div>
                {c.care_level && (
                  <span className="shrink-0 text-xs text-indigo-500 font-medium">{c.care_level}</span>
                )}
              </button>
            ))}
            {filtered.length === 0 && !query.trim() && clients.length > 0 && (
              <p className="text-sm text-gray-400 text-center py-12">名前で絞り込んでください</p>
            )}
            {filtered.length === 0 && query.trim() && (
              <p className="text-sm text-gray-400 text-center py-6">データベースに該当者がいません<br /><span className="text-xs">上の「直接入力」を使ってください</span></p>
            )}
            {!query.trim() && clients.length > 30 && (
              <p className="text-xs text-gray-400 text-center py-3">
                名前で絞り込んでください（全{clients.length}件）
              </p>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

type Props = {
  tenantId: string;
  officeId?: string | null;
  event?: Event | null;
  initialData?: Partial<EventInsert>;
  defaultDate?: string;
  currentUser: string;
  clientSelectionEnabled?: boolean;
  onSave: (event: EventInsert) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
};

export default function EventModal({ tenantId, officeId, event, initialData, defaultDate, currentUser, clientSelectionEnabled = true, onSave, onDelete, onClose }: Props) {
  const today = format(new Date(), "yyyy-MM-dd");
  const base = initialData ?? {};
  const [title, setTitle] = useState(event?.title ?? base.title ?? "");
  const [description, setDescription] = useState(event?.description ?? base.description ?? "");
  const [notes, setNotes] = useState(event?.notes ?? base.notes ?? "");
  const [startDate, setStartDate] = useState(event?.start_date ?? base.start_date ?? defaultDate ?? today);
  const [endDate, setEndDate] = useState(event?.end_date ?? base.end_date ?? defaultDate ?? today);
  const [startTime, setStartTime] = useState(event?.start_time ?? base.start_time ?? "");
  const [endTime, setEndTime] = useState(event?.end_time ?? base.end_time ?? "");
  const [allDay, setAllDay] = useState(event?.all_day ?? base.all_day ?? false);
  const [isMemo, setIsMemo] = useState(event?.is_memo ?? base.is_memo ?? false);
  const [color, setColor] = useState(event?.color ?? base.color ?? "#6366f1");
  const [imageUrl, setImageUrl] = useState(event?.image_url ?? base.image_url ?? "");
  const [imageUrls, setImageUrls] = useState<string[]>(event?.image_urls ?? base.image_urls ?? []);
  const [location, setLocation] = useState(event?.location ?? base.location ?? "");
  const [assignees, setAssignees] = useState<string[]>(event?.assignees ?? base.assignees ?? []);
  const [eventType, setEventType] = useState<string[]>(event?.event_type ?? base.event_type ?? []);
  const [members, setMembers] = useState<Member[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientAssignments, setClientAssignments] = useState<ClientOfficeAssignment[]>([]);
  // 利用者: DBから選択 or 手動入力、どちらか一方
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [manualClientName, setManualClientName] = useState<string>("");
  // タイトルに付与したプレフィックス（変更時に除去するために保持）
  const [clientPrefix, setClientPrefix] = useState<string>("");
  // メモ欄に追記したブロック（変更時に正確に除去するために保持）
  const [clientAutoBlock, setClientAutoBlock] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getMembers(tenantId).then(setMembers).catch(() => {});
    getEventTypes(tenantId).then(setEventTypes).catch(() => {});
    getClients(tenantId).then(setClients).catch(() => {});
    getClientOfficeAssignments(tenantId).then(setClientAssignments).catch(() => {});
  }, [tenantId]);

  // 自事業所絞り込み
  //   members: 自事業所のメンバーのみ（未割当は含めない）
  //   eventTypes: 自事業所のもの + 共有(NULL)
  //   clients: client_office_assignments を参照して判定（kaigo-appと連動）
  //   ただし既存イベントで選択済みのメンバー/種別/利用者は必ず残す（編集時に消えないため）
  const visibleMembers = officeId
    ? members.filter((m) => m.office_id === officeId || assignees.includes(m.name))
    : members;
  const visibleEventTypes = officeId
    ? eventTypes.filter((t) => t.office_id === officeId || t.office_id === null || eventType.includes(t.name))
    : eventTypes;

  const clientOfficeSetMap = (() => {
    const m = new Map<string, Set<string>>();
    for (const a of clientAssignments) {
      if (!m.has(a.client_id)) m.set(a.client_id, new Set());
      m.get(a.client_id)!.add(a.office_id);
    }
    return m;
  })();
  const visibleClients = officeId
    ? clients.filter((c) => {
        if (c.id === selectedClient?.id) return true;
        const ids = clientOfficeSetMap.get(c.id);
        if (ids && ids.size > 0) return ids.has(officeId);
        // junction に紐付けが無いとき → clients.office_id フォールバック
        return c.office_id === officeId || c.office_id === null;
      })
    : clients;

  // 編集モード時：タイトルのプレフィックスからクライアントを特定し、prefix/autoBlockを復元する
  useEffect(() => {
    if (!clients.length || !event?.title) return;
    const match = event.title.match(/^(.+?) 様 /);
    if (!match) return;
    const foundClient = clients.find((c) => c.name === match[1]);
    if (foundClient) {
      setSelectedClient(foundClient);
      setClientPrefix(`${foundClient.name} 様 `);
      // descriptionから実際に保存されたautoBlockを抽出（再構築ではなく既存内容を使う）
      // → クライアントデータがDB更新されていても正確に除去できる
      const desc = event.description ?? "";
      const extracted = extractAutoBlockFromDesc(desc);
      setClientAutoBlock(extracted);
    }
  }, [clients]); // eslint-disable-line react-hooks/exhaustive-deps

  // 利用者情報の自動追記ブロックを生成（selectedClientのみ、手動入力時は生成しない）
  function buildAutoBlock(client: Client): string {
    const lines: string[] = [];
    if (client.memo) lines.push(`【メモ】${client.memo}`);
    if (client.phone) lines.push(`【電話番号】${client.phone}`);
    if (client.mobile) lines.push(`【携帯電話】${client.mobile}`);
    if (client.benefit_rate) lines.push(`【給付率】${client.benefit_rate}`);
    if (client.care_level) lines.push(`【要介護度】${client.care_level}`);
    if (client.certification_end_date) lines.push(`【認定有効期限】${client.certification_end_date}`);
    if (client.care_manager_org) lines.push(`【支援事業所】${client.care_manager_org}`);
    if (client.care_manager) lines.push(`【担当ケアマネ】${client.care_manager}`);
    return lines.join("\n");
  }

  // descriptionの末尾にある【keyword】value形式のブロックを抽出する
  function extractAutoBlockFromDesc(desc: string): string {
    if (!desc) return "";
    // "\n\n【" で始まる末尾ブロックを検出
    const sepIdx = desc.lastIndexOf("\n\n【");
    if (sepIdx >= 0) {
      const tail = desc.slice(sepIdx + 2);
      if (tail.split("\n").every((l) => !l || /^【[^】\n]+】/.test(l))) {
        return tail.trimEnd();
      }
    }
    // description全体が【...】ブロックの場合
    if (desc.trim() && desc.split("\n").every((l) => !l || /^【[^】\n]+】/.test(l))) {
      return desc.trimEnd();
    }
    return "";
  }

  // メモ欄から以前追記したブロックを除去する（完全一致 + パターンフォールバック）
  function stripAutoBlock(desc: string, block: string): string {
    if (!desc) return desc;
    // ① 完全一致チェック
    if (block) {
      const withSep = "\n\n" + block;
      if (desc.endsWith(withSep)) return desc.slice(0, desc.length - withSep.length);
      if (desc === block) return "";
    }
    // ② フォールバック: 末尾の【...】パターンブロックを検出して除去
    //    （保存後にクライアントデータが更新されて完全一致しない場合に対応）
    const sepIdx = desc.lastIndexOf("\n\n【");
    if (sepIdx >= 0) {
      const tail = desc.slice(sepIdx + 2);
      if (tail.split("\n").every((l) => !l || /^【[^】\n]+】/.test(l))) {
        return desc.slice(0, sepIdx);
      }
    }
    if (desc.trim() && desc.split("\n").every((l) => !l || /^【[^】\n]+】/.test(l))) {
      return "";
    }
    return desc;
  }

  // タイトルから「xxx 様 」プレフィックスを除去する
  // clientPrefix優先、なければselectedClientから復元、それもなければパターン検出
  function stripTitlePrefix(t: string): string {
    if (clientPrefix && t.startsWith(clientPrefix)) return t.slice(clientPrefix.length);
    if (selectedClient) {
      const p = `${selectedClient.name} 様 `;
      if (t.startsWith(p)) return t.slice(p.length);
    }
    // フォールバック: "xxx 様 " パターンを先頭から除去
    const m = t.match(/^.+? 様 /);
    if (m) return t.slice(m[0].length);
    return t;
  }

  // DBから利用者を選択（住所・情報の自動入力あり）
  function handleSelectClient(client: Client | null) {
    const baseTitlePart = stripTitlePrefix(title);
    const newPrefix = client ? `${client.name} 様 ` : "";

    let newDesc = stripAutoBlock(description, clientAutoBlock);
    let newBlock = "";
    if (client) {
      newBlock = buildAutoBlock(client);
      if (newBlock) newDesc = newDesc ? newDesc + "\n\n" + newBlock : newBlock;
      if (client.address) setLocation(client.address);
    }

    setTitle(newPrefix + baseTitlePart);
    setClientPrefix(newPrefix);
    setDescription(newDesc);
    setClientAutoBlock(newBlock);
    setSelectedClient(client);
    setManualClientName("");
  }

  // 利用者を手動入力（タイトルプレフィックスのみ）
  function handleManualClientName(name: string) {
    const baseTitlePart = stripTitlePrefix(title);
    const newPrefix = name ? `${name} 様 ` : "";

    const newDesc = stripAutoBlock(description, clientAutoBlock);

    setTitle(newPrefix + baseTitlePart);
    setClientPrefix(newPrefix);
    setDescription(newDesc);
    setClientAutoBlock("");
    setSelectedClient(null);
    setManualClientName(name);
  }

  function toggleAssignee(member: Member) {
    setAssignees((prev) => {
      const next = prev.includes(member.name)
        ? prev.filter((n) => n !== member.name)
        : [...prev, member.name];
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
    const allUrls = [...imageUrls, ...(imageUrl ? [imageUrl] : [])];
    const remaining = 10 - allUrls.length;
    if (remaining <= 0) { alert("画像は最大10枚です"); return; }
    const toUpload = files.slice(0, remaining);
    setUploading(true);
    try {
      const uploaded = await Promise.all(toUpload.map((f) => uploadImage(f)));
      setImageUrls((prev) => {
        const combined = [...(imageUrl ? [imageUrl] : []), ...prev, ...uploaded];
        if (combined.length > 0) setImageUrl(combined[0]);
        return combined.slice(1);
      });
    } catch {
      alert("画像のアップロードに失敗しました");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleRemoveImage(url: string) {
    try { await deleteImage(url); } catch {}
    if (url === imageUrl) {
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
      const allImages = [...(imageUrl ? [imageUrl] : []), ...imageUrls];
      const today = format(new Date(), "yyyy-MM-dd");
      await onSave({
        title: title.trim(),
        description: description.trim() || null,
        notes: notes.trim() || null,
        start_date: isMemo ? today : startDate,
        end_date: isMemo ? today : (endDate < startDate ? startDate : endDate),
        start_time: (isMemo || allDay) ? null : startTime || null,
        end_time: (isMemo || allDay) ? null : endTime || null,
        all_day: isMemo ? false : allDay,
        is_memo: isMemo,
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

          {/* 利用者選択 */}
          {clientSelectionEnabled && <ClientSelector
            clients={visibleClients}
            selected={selectedClient}
            manualName={manualClientName}
            onSelect={handleSelectClient}
            onManualName={handleManualClientName}
          />}

          {/* 担当者（メンバーがいる場合のみ） */}
          {visibleMembers.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 text-gray-500">
                <Users size={16} />
                <span className="text-sm font-medium">担当者</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {visibleMembers.map((m) => {
                  const active = assignees.includes(m.name);
                  return (
                  <button key={m.id} onClick={() => toggleAssignee(m)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
                    style={active
                      ? { backgroundColor: m.color, color: "white", border: "2px solid transparent" }
                      : { backgroundColor: "white", border: `2px solid ${m.color}30`, color: "#374151" }}>
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ backgroundColor: active ? "rgba(255,255,255,0.25)" : m.color + "30", color: active ? "white" : m.color }}>
                      {m.name.charAt(0)}
                    </span>
                    {m.name}
                  </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 用件種別 */}
          {visibleEventTypes.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 text-gray-500">
                <Tag size={16} />
                <span className="text-sm font-medium">用件種別</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {visibleEventTypes.map((t) => (
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-gray-500">
                <Calendar size={16} />
                <span className="text-sm font-medium">日付</span>
              </div>
              <button
                type="button"
                onClick={() => setIsMemo(!isMemo)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors font-medium ${
                  isMemo
                    ? "bg-amber-100 text-amber-700 border-amber-300"
                    : "bg-white text-gray-400 border-gray-200 hover:border-amber-300 hover:text-amber-600"
                }`}
              >
                <StickyNote size={12} />
                日付未定（メモ）
              </button>
            </div>
            {isMemo ? (
              <p className="text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                📝 日付未定のメモとして保存されます。後から日付を設定するとカレンダーに表示されます。
              </p>
            ) : (
              <>
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
              </>
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
          <div className="space-y-1">
            <p className="text-xs text-gray-400 px-1">メモ</p>
            <textarea placeholder="メモを追加..." value={description} onChange={(e) => setDescription(e.target.value)}
              rows={3} className="w-full text-sm placeholder-gray-300 bg-gray-50 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          </div>

          {/* 備考 */}
          <div className="space-y-1">
            <p className="text-xs text-gray-400 px-1">備考</p>
            <textarea placeholder="備考を追加..." value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={2} className="w-full text-sm placeholder-gray-300 bg-gray-50 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          </div>

          {/* 画像（複数枚対応） */}
          <div className="space-y-2">
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
            {[...(imageUrl ? [imageUrl] : []), ...imageUrls].length < 10 && (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:border-indigo-300 hover:text-indigo-400 transition-colors text-sm"
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
                {uploading ? "圧縮・アップロード中..." : "画像を添付（最大10枚）"}
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
