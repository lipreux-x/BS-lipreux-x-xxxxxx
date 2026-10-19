-- Hand-drawn avatars replaced by Lucide icons: keep each choice, under its new id.
UPDATE "profiles" SET "avatar" = CASE "avatar"
  WHEN 'thief' THEN 'mask'
  WHEN 'balaclava' THEN 'spy'
  WHEN 'banker' THEN 'bank'
  WHEN 'safe' THEN 'vault'
  WHEN 'vault' THEN 'vault'
  WHEN 'gold' THEN 'gold'
  WHEN 'moneybag' THEN 'loot'
  WHEN 'diamond' THEN 'gem'
  WHEN 'key' THEN 'key'
  ELSE NULL
END
WHERE "avatar" IS NOT NULL;
