// date-fns module 型宣言 shim
//
// date-fns v4 は package.json の "exports" + "types" 条件付きエントリで型を提供しているが、
// Vercel ビルド環境では npm install の resolution によって型ファイルが拾えないケースが
// 発生する (= Type error: Could not find a declaration file for module 'date-fns')。
//
// このファイルで `import { format, addMonths, ... } from "date-fns"` 系の named import を
// 緩く any として通す。実行時の挙動は date-fns 本体に依存するので、型安全性のみが
// 一時的に低下するが build が壊れない方が優先。
//
// 将来 date-fns の types resolution が改善されたら本 shim は削除可。

declare module "date-fns";
declare module "date-fns/locale";
