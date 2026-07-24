ALTER TABLE songs ADD COLUMN bpm INTEGER;
ALTER TABLE songs ADD COLUMN music_brainz_id TEXT;
ALTER TABLE songs ADD COLUMN replay_gain REAL;
ALTER TABLE songs ADD COLUMN average_rating REAL;
ALTER TABLE songs ADD COLUMN comment TEXT;
ALTER TABLE songs ADD COLUMN sort_name TEXT;
ALTER TABLE songs ADD COLUMN mood TEXT;
ALTER TABLE songs ADD COLUMN media_type TEXT;
ALTER TABLE songs ADD COLUMN original_release_date TEXT;
ALTER TABLE songs ADD COLUMN release_date TEXT;
ALTER TABLE songs ADD COLUMN remix_of TEXT;
ALTER TABLE songs ADD COLUMN display_artist TEXT;
ALTER TABLE songs ADD COLUMN display_album_artist TEXT;

ALTER TABLE artists ADD COLUMN artist_image_url TEXT;

UPDATE songs SET average_rating = (
  SELECT AVG(rating)
  FROM user_songs
  WHERE user_songs.song_id = songs.id
);
