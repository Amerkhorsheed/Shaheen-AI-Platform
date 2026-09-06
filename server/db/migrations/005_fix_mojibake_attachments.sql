-- 005 — Repair any attachment filenames or audit log details that were corrupted by Latin-1 / UTF-8 mojibake.

DO $$
DECLARE
  r RECORD;
  fixed_val TEXT;
BEGIN
  -- Fix corrupted attachment JSON blobs in messages table
  FOR r IN SELECT id, attachments FROM messages WHERE attachments LIKE '%Ø%' OR attachments LIKE '%Ù%' LOOP
    BEGIN
      fixed_val := convert_from(convert_to(r.attachments, 'LATIN1'), 'UTF8');
      UPDATE messages SET attachments = fixed_val WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      -- If conversion fails on non-latin1 characters, continue gracefully
    END;
  END LOOP;

  -- Fix corrupted audit log details where filenames were recorded
  FOR r IN SELECT id, details FROM audit_logs WHERE details LIKE '%Ø%' OR details LIKE '%Ù%' LOOP
    BEGIN
      fixed_val := convert_from(convert_to(r.details, 'LATIN1'), 'UTF8');
      UPDATE audit_logs SET details = fixed_val WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      -- Continue gracefully
    END;
  END LOOP;
END $$;
