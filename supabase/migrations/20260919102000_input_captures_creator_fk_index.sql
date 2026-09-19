-- Issue #376: cover input_captures.created_by_user_id foreign key for production advisor cleanliness.

create index input_captures_created_by_user_id_idx
  on public.input_captures(created_by_user_id)
  where created_by_user_id is not null;
