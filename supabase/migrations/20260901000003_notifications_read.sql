-- Notifications feed (GAPS A4.15): dashboard home only ever showed the 4
-- most recent, with no read state. Nullable — unread is the default for
-- every existing row, which is correct (nothing has been "read" through a
-- feed that didn't exist yet).
alter table notifications add column read_at timestamptz;

create index notifications_member_unread_idx on notifications (member_id) where read_at is null;
