-- ========================================================================
-- 36-invoice-bundle-audit-ignore-2026-09-18.sql
-- 允許管理員將被偵測為 bundle 重複帳單的單筆 invoice 標記為「不處理」。
-- 標記會跟著 invoice 存在雲端；帳單內容、金額與狀態均不變。
-- ========================================================================

alter table public.invoices
  add column if not exists bundle_audit_ignored boolean not null default false;

comment on column public.invoices.bundle_audit_ignored is
  '管理員確認此 invoice 不參與 bundle 重複帳單自動校正；true 時開機 audit 不再提示';

