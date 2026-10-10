-- Account-scoped friend identity.
-- D1 は PRAGMA defer_foreign_keys を無視するため、外部キーが常時検証される前提で組む。
-- 1) 退避 → 2) 子から順に空にする → 3) friends 再構築 → 4) 親から順に復元 → 5) 退避表を削除
-- どの時点でも外部キー違反が起きない順序になっている。
CREATE TABLE "_a70_friends" AS SELECT * FROM "friends";
CREATE TABLE "_a70_affiliates" AS SELECT * FROM "affiliates";
CREATE TABLE "_a70_automation_logs" AS SELECT * FROM "automation_logs";
CREATE TABLE "_a70_bookings" AS SELECT * FROM "bookings";
CREATE TABLE "_a70_calendar_bookings" AS SELECT * FROM "calendar_bookings";
CREATE TABLE "_a70_chats" AS SELECT * FROM "chats";
CREATE TABLE "_a70_engagement_events" AS SELECT * FROM "engagement_events";
CREATE TABLE "_a70_event_bookings" AS SELECT * FROM "event_bookings";
CREATE TABLE "_a70_form_submissions" AS SELECT * FROM "form_submissions";
CREATE TABLE "_a70_friend_reminders" AS SELECT * FROM "friend_reminders";
CREATE TABLE "_a70_friend_scenarios" AS SELECT * FROM "friend_scenarios";
CREATE TABLE "_a70_friend_scores" AS SELECT * FROM "friend_scores";
CREATE TABLE "_a70_friend_tags" AS SELECT * FROM "friend_tags";
CREATE TABLE "_a70_link_clicks" AS SELECT * FROM "link_clicks";
CREATE TABLE "_a70_meet_consultations" AS SELECT * FROM "meet_consultations";
CREATE TABLE "_a70_messages_log" AS SELECT * FROM "messages_log";
CREATE TABLE "_a70_ref_tracking" AS SELECT * FROM "ref_tracking";
CREATE TABLE "_a70_stripe_events" AS SELECT * FROM "stripe_events";
CREATE TABLE "_a70_webinar_followups" AS SELECT * FROM "webinar_followups";
CREATE TABLE "_a70_webinar_funnel_events" AS SELECT * FROM "webinar_funnel_events";
CREATE TABLE "_a70_webinar_journey_followups" AS SELECT * FROM "webinar_journey_followups";
CREATE TABLE "_a70_webinar_picker_opens" AS SELECT * FROM "webinar_picker_opens";
CREATE TABLE "_a70_webinar_registrations" AS SELECT * FROM "webinar_registrations";
CREATE TABLE "_a70_webinar_user_comments" AS SELECT * FROM "webinar_user_comments";
CREATE TABLE "_a70_webinar_viewers" AS SELECT * FROM "webinar_viewers";
CREATE TABLE "_a70_affiliate_clicks" AS SELECT * FROM "affiliate_clicks";
CREATE TABLE "_a70_affiliate_links" AS SELECT * FROM "affiliate_links";
CREATE TABLE "_a70_booking_reminders" AS SELECT * FROM "booking_reminders";
CREATE TABLE "_a70_conversion_events" AS SELECT * FROM "conversion_events";
CREATE TABLE "_a70_event_booking_reminders" AS SELECT * FROM "event_booking_reminders";
CREATE TABLE "_a70_friend_reminder_deliveries" AS SELECT * FROM "friend_reminder_deliveries";
CREATE TABLE "_a70_meet_consultation_reminders" AS SELECT * FROM "meet_consultation_reminders";
CREATE TABLE "_a70_mileage_event_queue" AS SELECT * FROM "mileage_event_queue";
CREATE TABLE "_a70_mileage_ledger" AS SELECT * FROM "mileage_ledger";
DELETE FROM "mileage_ledger";
DELETE FROM "mileage_event_queue";
DELETE FROM "meet_consultation_reminders";
DELETE FROM "friend_reminder_deliveries";
DELETE FROM "event_booking_reminders";
DELETE FROM "conversion_events";
DELETE FROM "booking_reminders";
DELETE FROM "affiliate_links";
DELETE FROM "affiliate_clicks";
DELETE FROM "webinar_viewers";
DELETE FROM "webinar_user_comments";
DELETE FROM "webinar_registrations";
DELETE FROM "webinar_picker_opens";
DELETE FROM "webinar_journey_followups";
DELETE FROM "webinar_funnel_events";
DELETE FROM "webinar_followups";
DELETE FROM "stripe_events";
DELETE FROM "ref_tracking";
DELETE FROM "messages_log";
DELETE FROM "meet_consultations";
DELETE FROM "link_clicks";
DELETE FROM "friend_tags";
DELETE FROM "friend_scores";
DELETE FROM "friend_scenarios";
DELETE FROM "friend_reminders";
DELETE FROM "form_submissions";
DELETE FROM "event_bookings";
DELETE FROM "engagement_events";
DELETE FROM "chats";
DELETE FROM "calendar_bookings";
DELETE FROM "bookings";
DELETE FROM "automation_logs";
DELETE FROM "affiliates";
DROP TABLE "friends";
CREATE TABLE "friends" (
  id               TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  display_name     TEXT,
  picture_url      TEXT,
  status_message   TEXT,
  is_following     INTEGER NOT NULL DEFAULT 1,
  user_id          TEXT,
  ig_igsid         TEXT,
  score            INTEGER NOT NULL DEFAULT 0,
  last_ref_code    TEXT,
  last_ref_at      TEXT,
  first_followed_at TEXT,
  current_follow_started_at TEXT,
  last_followed_at TEXT,
  last_unfollowed_at TEXT,
  unfollow_count   INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, ref_code TEXT, metadata TEXT NOT NULL DEFAULT '{}', line_account_id TEXT REFERENCES line_accounts(id), first_tracked_link_id TEXT REFERENCES tracked_links (id) ON DELETE SET NULL);
INSERT INTO "friends" SELECT * FROM "_a70_friends";
CREATE INDEX idx_friends_follow_tenure ON friends(is_following, current_follow_started_at);
CREATE INDEX idx_friends_ig_igsid ON friends (ig_igsid);
CREATE INDEX idx_friends_line_user_id ON friends (line_user_id);
CREATE INDEX idx_friends_user_id ON friends (user_id);
CREATE UNIQUE INDEX idx_friends_account_identity ON friends(line_user_id,line_account_id);
CREATE UNIQUE INDEX idx_friends_unassigned_identity ON friends(line_user_id) WHERE line_account_id IS NULL;
INSERT INTO "affiliates" SELECT * FROM "_a70_affiliates";
INSERT INTO "automation_logs" SELECT * FROM "_a70_automation_logs";
INSERT INTO "bookings" SELECT * FROM "_a70_bookings";
INSERT INTO "calendar_bookings" SELECT * FROM "_a70_calendar_bookings";
INSERT INTO "chats" SELECT * FROM "_a70_chats";
INSERT INTO "engagement_events" SELECT * FROM "_a70_engagement_events";
INSERT INTO "event_bookings" SELECT * FROM "_a70_event_bookings";
INSERT INTO "form_submissions" SELECT * FROM "_a70_form_submissions";
INSERT INTO "friend_reminders" SELECT * FROM "_a70_friend_reminders";
INSERT INTO "friend_scenarios" SELECT * FROM "_a70_friend_scenarios";
INSERT INTO "friend_scores" SELECT * FROM "_a70_friend_scores";
INSERT INTO "friend_tags" SELECT * FROM "_a70_friend_tags";
INSERT INTO "link_clicks" SELECT * FROM "_a70_link_clicks";
INSERT INTO "meet_consultations" SELECT * FROM "_a70_meet_consultations";
INSERT INTO "messages_log" SELECT * FROM "_a70_messages_log";
INSERT INTO "ref_tracking" SELECT * FROM "_a70_ref_tracking";
INSERT INTO "stripe_events" SELECT * FROM "_a70_stripe_events";
INSERT INTO "webinar_followups" SELECT * FROM "_a70_webinar_followups";
INSERT INTO "webinar_funnel_events" SELECT * FROM "_a70_webinar_funnel_events";
INSERT INTO "webinar_journey_followups" SELECT * FROM "_a70_webinar_journey_followups";
INSERT INTO "webinar_picker_opens" SELECT * FROM "_a70_webinar_picker_opens";
INSERT INTO "webinar_registrations" SELECT * FROM "_a70_webinar_registrations";
INSERT INTO "webinar_user_comments" SELECT * FROM "_a70_webinar_user_comments";
INSERT INTO "webinar_viewers" SELECT * FROM "_a70_webinar_viewers";
INSERT INTO "affiliate_clicks" SELECT * FROM "_a70_affiliate_clicks";
INSERT INTO "affiliate_links" SELECT * FROM "_a70_affiliate_links";
INSERT INTO "booking_reminders" SELECT * FROM "_a70_booking_reminders";
INSERT INTO "conversion_events" SELECT * FROM "_a70_conversion_events";
INSERT INTO "event_booking_reminders" SELECT * FROM "_a70_event_booking_reminders";
INSERT INTO "friend_reminder_deliveries" SELECT * FROM "_a70_friend_reminder_deliveries";
INSERT INTO "meet_consultation_reminders" SELECT * FROM "_a70_meet_consultation_reminders";
INSERT INTO "mileage_event_queue" SELECT * FROM "_a70_mileage_event_queue";
INSERT INTO "mileage_ledger" SELECT * FROM "_a70_mileage_ledger";
DROP TABLE "_a70_friends";
DROP TABLE "_a70_affiliates";
DROP TABLE "_a70_automation_logs";
DROP TABLE "_a70_bookings";
DROP TABLE "_a70_calendar_bookings";
DROP TABLE "_a70_chats";
DROP TABLE "_a70_engagement_events";
DROP TABLE "_a70_event_bookings";
DROP TABLE "_a70_form_submissions";
DROP TABLE "_a70_friend_reminders";
DROP TABLE "_a70_friend_scenarios";
DROP TABLE "_a70_friend_scores";
DROP TABLE "_a70_friend_tags";
DROP TABLE "_a70_link_clicks";
DROP TABLE "_a70_meet_consultations";
DROP TABLE "_a70_messages_log";
DROP TABLE "_a70_ref_tracking";
DROP TABLE "_a70_stripe_events";
DROP TABLE "_a70_webinar_followups";
DROP TABLE "_a70_webinar_funnel_events";
DROP TABLE "_a70_webinar_journey_followups";
DROP TABLE "_a70_webinar_picker_opens";
DROP TABLE "_a70_webinar_registrations";
DROP TABLE "_a70_webinar_user_comments";
DROP TABLE "_a70_webinar_viewers";
DROP TABLE "_a70_affiliate_clicks";
DROP TABLE "_a70_affiliate_links";
DROP TABLE "_a70_booking_reminders";
DROP TABLE "_a70_conversion_events";
DROP TABLE "_a70_event_booking_reminders";
DROP TABLE "_a70_friend_reminder_deliveries";
DROP TABLE "_a70_meet_consultation_reminders";
DROP TABLE "_a70_mileage_event_queue";
DROP TABLE "_a70_mileage_ledger";
