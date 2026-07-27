-- MusicBrainz-derived artist metadata and external URL relations.
ALTER TABLE artists ADD COLUMN bio TEXT;
ALTER TABLE artists ADD COLUMN external_urls TEXT;
