// date-fns module 型宣言 shim
//
// date-fns v4 は package.json の "exports" + "types" 条件付きエントリで型を提供しているが、
// Vercel ビルド環境 (Node + 特定の TS resolver の組合せ) で types がうまく拾えず
// "Could not find a declaration file for module 'date-fns'" になるケースがある。
//
// このファイルで date-fns / date-fns/locale 系の named import を「とにかく any」で
// 通す。型安全性は一時的に低下するが build を確実に通すことを優先する。
//
// 本来は date-fns 側の types 解決を直すか、lockfile pinning で解決すべきだが、
// 環境依存で再発しやすいので shim を恒久対応として残す。

declare module "date-fns";
declare module "date-fns/locale";
