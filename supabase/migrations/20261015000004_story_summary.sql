-- A story's summary, for everywhere a story is shown away from its own page:
-- story cards, the Grid homepage, newsletters, the link preview when it's
-- shared (og:description) and search engines (Luiza, 15 Oct).
--
-- The author's summary (stories.excerpt) when there is one; otherwise the
-- opening of the body as plain text. Only ~10% of stories carry an excerpt —
-- WordPress stories rarely did — so most cards, newsletters and link previews
-- showed no summary at all.
--
-- A PostgREST computed field, not a stored column: selected as
-- `excerpt:story_summary` in the story-card projection (src/lib/queries.ts
-- STORY_CARD) and the two newsletter reads, so every consumer gets the
-- fallback with no code of its own. It is derived on read, so editing the body
-- moves it too, and nothing is written. And it costs no payload: the
-- alternative — sending each card's body (~4.8KB of HTML) to derive it in the
-- app — is what STORY_CARD deliberately avoids. The forms still read and write
-- the raw `excerpt` column, so a blank stays blank there.
--
-- Same rules as src/lib/sanitize.ts excerptFromHtml (the Forge hero's existing
-- fallback): strip tags, decode the entities the WordPress bodies carry, any
-- other entity becomes a space, collapse whitespace, cut at 220 characters on a
-- word boundary with an ellipsis, dropping trailing punctuation.
--
-- Security: `stable`, invoker rights, reads only the row PostgREST has already
-- returned under the caller's own RLS. Executable by the API roles because a
-- computed field has to be; called directly as an RPC it can only summarise a
-- row the caller supplies.

-- The parameter is deliberately unnamed: that is what makes PostgREST — and
-- supabase-js's generated types — treat the function as a column of `stories`.
drop function if exists story_summary(stories);
create function story_summary(stories) returns text
language plpgsql stable as $$
declare
  s stories := $1;
  t text;
  cut text;
  sp int;
begin
  if nullif(btrim(coalesce(s.excerpt, '')), '') is not null then
    return btrim(s.excerpt);
  end if;
  t := coalesce(s.body, '');
  if t = '' then
    return null;
  end if;
  t := regexp_replace(t, '<[^>]+>', ' ', 'g');
  t := replace(t, '&nbsp;', ' ');
  t := replace(t, '&lt;', '<');
  t := replace(t, '&gt;', '>');
  t := replace(t, '&quot;', '"');
  t := replace(t, '&#039;', '''');
  t := replace(t, '&#8216;', '‘');
  t := replace(t, '&#8217;', '’');
  t := replace(t, '&#8220;', '“');
  t := replace(t, '&#8221;', '”');
  t := replace(t, '&#8211;', '–');
  t := replace(t, '&#8212;', '—');
  t := replace(t, '&hellip;', '…');
  -- &amp; last but one, so "&amp;lt;" stays the literal "&lt;" it encodes
  t := regexp_replace(t, '&(?!amp;)[#[:alnum:]]+;', ' ', 'g');
  t := replace(t, '&amp;', '&');
  t := btrim(regexp_replace(t, '\s+', ' ', 'g'));
  if t = '' then
    return null;
  end if;
  if char_length(t) <= 220 then
    return t;
  end if;
  cut := left(t, 220);
  sp := char_length(cut) - strpos(reverse(cut), ' ') + 1;
  if strpos(cut, ' ') > 0 then
    cut := left(cut, sp - 1);
  end if;
  return regexp_replace(cut, '[\s,;:.–—-]+$', '') || '…';
end;
$$;

grant execute on function story_summary(stories) to anon, authenticated, service_role;
