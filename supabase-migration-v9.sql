-- Migration v9: 利用者テーブル作成

CREATE TABLE IF NOT EXISTS clients (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_number text NOT NULL UNIQUE,
  name text NOT NULL,
  furigana text,
  address text,
  postal_code text,
  phone text,
  mobile text,
  memo text,
  benefit_rate text,
  care_level text,
  care_manager_org text,
  care_manager text,
  certification_end_date text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all clients" ON clients;
CREATE POLICY "Allow all clients" ON clients
  FOR ALL USING (true) WITH CHECK (true);
