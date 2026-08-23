-- Backfill listening time for scrobbles recorded before the web client sent
-- duration_listened: a recorded play implies the track played, so estimate
-- with the song's full duration and mark completion as 1.
UPDATE listening_history
SET duration_listened = (SELECT s.duration FROM songs s WHERE s.id = listening_history.song_id),
    completion = COALESCE(completion, 1)
WHERE duration_listened IS NULL;
