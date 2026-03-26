"use client";

import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { X, Loader2, ChevronRight } from "lucide-react";
import { getActivityLogs, type ActivityLog } from "@/lib/events";

type Props = {
  currentUser: string;
  onClose: () => void;
  onEventClick?: (eventId: string) => void;
};

const LIMIT = 10;

function ActionBadge({ action }: { action: ActivityLog["action"] }) {
  const map: Record<ActivityLog["action"], { label: string; cls: string }> = {
    created:       { label: "追加",    cls: "bg-green-100 text-green-700" },
    updated:       { label: "編集",    cls: "bg-yellow-100 text-yellow-700" },
    deleted:       { label: "削除",    cls: "bg-red-100 text-red-700" },
    comment_added: { label: "コメント", cls: "bg-blue-100 text-blue-700" },
  };
  const { label, cls } = map[action] ?? { label: action, cls: "bg-gray-100 text-gray-600" };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${cls}`}>
      {label}
    </span>
  );
}

function actionVerb(action: ActivityLog["action"]): string {
  switch (action) {
    case "created":       return "を追加しました";
    case "updated":       return "を編集しました";
    case "deleted":       return "を削除しました";
    case "comment_added": return "にコメントしました";
    default:              return "を操作しました";
  }
}

export default function ActivityLogView({ currentUser, onClose, onEventClick }: Props) {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const offsetRef = useRef(0);

  useEffect(() => {
    offsetRef.current = 0;
    setLogs([]);
    setHasMore(true);
    fetchLogs(0, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function fetchLogs(offset: number, reset = false) {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const data = await getActivityLogs(
        LIMIT,
        offset,
        filter === "mine" ? currentUser : undefined
      );
      setLogs((prev) => (reset ? data : [...prev, ...data]));
      setHasMore(data.length === LIMIT);
      offsetRef.current = offset + data.length;
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f8f9fa]">
      {/* ヘッダー */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
        <h2 className="text-base font-bold text-gray-800 flex-1">更新履歴</h2>

        {/* 全て / 自分の担当 トグル */}
        <div className="flex bg-gray-100 rounded-xl p-0.5 gap-0.5">
          {(["all", "mine"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                filter === f ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500"
              }`}
            >
              {f === "all" ? "全て" : "自分の担当"}
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-500"
        >
          <X size={18} />
        </button>
      </div>

      {/* ログリスト */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-gray-300" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm">履歴はありません</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {logs.map((log) => {
              const assigneeChanged =
                log.action === "updated" &&
                JSON.stringify([...log.assignees_before].sort()) !==
                  JSON.stringify([...log.assignees_after].sort());

              return (
                <div
                  key={log.id}
                  className={`bg-white px-4 py-3 flex items-start gap-3 ${
                    log.event_id && onEventClick ? "cursor-pointer active:bg-gray-50" : ""
                  }`}
                  onClick={() => log.event_id && onEventClick?.(log.event_id)}
                >
                  {/* アバター */}
                  <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-sm font-bold text-indigo-600">
                      {log.actor.charAt(0)}
                    </span>
                  </div>

                  {/* 内容 */}
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <ActionBadge action={log.action} />
                      <span className="text-sm text-gray-800">
                        <span className="font-semibold">{log.actor}</span>
                        {actionVerb(log.action)}
                      </span>
                    </div>

                    <p className="text-sm text-gray-700 font-medium truncate">
                      「{log.event_title}」
                    </p>

                    {/* 担当者変更の表示 */}
                    {assigneeChanged && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        担当変更：{log.assignees_before.join("・") || "なし"}
                        {" → "}
                        {log.assignees_after.join("・") || "なし"}
                      </p>
                    )}

                    {/* 担当者（追加・削除・コメント時） */}
                    {(log.action === "created" || log.action === "comment_added") &&
                      log.assignees_after.length > 0 && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          担当：{log.assignees_after.join("・")}
                        </p>
                    )}

                    <p className="text-xs text-gray-400 mt-0.5">
                      {format(new Date(log.created_at), "M月d日 HH:mm")}
                    </p>
                  </div>

                  {/* 矢印（タップ可能なら表示） */}
                  {log.event_id && onEventClick && (
                    <ChevronRight size={16} className="text-gray-300 shrink-0 mt-1" />
                  )}
                </div>
              );
            })}

            {/* さらに読み込む */}
            {hasMore && (
              <div className="py-4 flex justify-center bg-white">
                <button
                  onClick={() => fetchLogs(offsetRef.current)}
                  disabled={loadingMore}
                  className="flex items-center gap-2 text-sm text-indigo-500 font-medium px-4 py-2 rounded-xl hover:bg-indigo-50 transition-colors disabled:opacity-50"
                >
                  {loadingMore && <Loader2 size={14} className="animate-spin" />}
                  さらに読み込む
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
