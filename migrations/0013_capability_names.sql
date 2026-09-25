-- 0013_capability_names.sql
-- Remove the last legacy tool name during the capability migration.
UPDATE settings SET value = replace(value, 'ai_translate_paid', 'ai_translate')
WHERE key IN ('tools_enable', 'tools_disable', 'tools_default_surface', 'intents', 'email_intents');
