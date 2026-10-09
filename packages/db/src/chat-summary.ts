export async function getChatSummary(db: D1Database, accountId?: string) {
  const statement = db.prepare(`
    SELECT c.status, COUNT(*) AS count FROM friends f
    INNER JOIN chats c ON c.id = (
      SELECT id FROM chats WHERE friend_id = f.id ORDER BY created_at DESC LIMIT 1
    )
    ${accountId ? 'WHERE f.line_account_id = ?' : ''}
    GROUP BY c.status
  `);
  const { results } = await (accountId ? statement.bind(accountId) : statement)
    .all<{ status: string; count: number }>();
  const data = { unread: 0, inProgress: 0, resolved: 0 };
  for (const row of results) {
    if (row.status === 'unread') data.unread = row.count;
    if (row.status === 'in_progress') data.inProgress = row.count;
    if (row.status === 'resolved') data.resolved = row.count;
  }
  return data;
}
