-- A ticket's conversation now includes answerLoops's own replies, so the thread
-- reads in full: the customer's message, the answer answerLoops posted, the
-- customer's follow-up. Such a reply is stored in ticket_replies with the role
-- 'ai', tagged with the id the channel gave the posted message. The role check
-- is replaced to allow it; every existing row keeps its meaning.
ALTER TABLE ticket_replies DROP CONSTRAINT IF EXISTS ticket_replies_author_role_check;
--> statement-breakpoint
ALTER TABLE ticket_replies
  ADD CONSTRAINT ticket_replies_author_role_check CHECK (author_role IN ('staff', 'customer', 'context', 'ai'));
