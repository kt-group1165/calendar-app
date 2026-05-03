import { NextResponse } from "next/server";

// 旧 calendar-app の招待 API。
// 旧 user_tenants テーブルへ書込む実装だったが、Phase 2-5b で旧 schema が
// DROP されたため使用不能。
// 後継：Phase 2-7 で構築する `/api/admin/invite-staff`（自前トークン方式の
// スタッフ招待 API）。設計詳細は HANDOVER §13 を参照。
//
// 当面は 410 Gone を返して、呼出側に「この経路は廃止された」ことを通知する。

export function POST() {
  return NextResponse.json(
    {
      error: "この招待 API は廃止されました（Phase 2-5b）。",
      detail:
        "後継のスタッフ招待 UI は Phase 2-7 で実装予定です。" +
        "暫定的にユーザを追加する場合は Supabase Studio から user_offices に直接 INSERT してください。",
    },
    { status: 410 }
  );
}
