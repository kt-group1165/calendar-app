"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronRight, Loader2 } from "lucide-react";
import { getTenants, type Tenant } from "@/lib/tenants";

export default function HomePage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTenants()
      .then((data) => setTenants(data.filter((t) => t.id !== "default")))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        {/* ロゴ */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500 rounded-2xl shadow-lg mb-2">
            <CalendarDays size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">カレンダー</h1>
          <p className="text-sm text-gray-400">チームを選択してください</p>
        </div>

        {/* テナント一覧 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={24} className="animate-spin text-indigo-400" />
            </div>
          ) : tenants.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">
              チームが登録されていません
            </p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {tenants.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => router.push(`/${t.id}`)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-indigo-50 transition-colors active:bg-indigo-100"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
                        <CalendarDays size={18} className="text-indigo-500" />
                      </div>
                      <span className="text-sm font-semibold text-gray-800">{t.name}</span>
                    </div>
                    <ChevronRight size={16} className="text-gray-300" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
